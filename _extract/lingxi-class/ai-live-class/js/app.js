/* ============================================================
   灵犀课堂 · AI 一对一直播课
   基于WorkBuddy 云服务 LLM API（免密钥）
   ============================================================ */
'use strict';

/* ---------- 云服务配置（来自云服务环境 publicConfig） ---------- */
/* ★★ endpoint 必须**跟随当前页面的域名**，不能写死。
   为什么（2026-09-28 真实事故，代价很大）：
   这里原本写死 `https://lingxi-class.app.workbuddy.host`。页面在这个域名上时，云端请求是
   **同源**的 —— 同源请求不走 CORS，所以一直没事。
   后来应用被发布到了另一个域名（`<sandboxId>.app.workbuddy.host`），于是云端请求变成**跨源**，
   浏览器开始做预检，而云端白名单里**没有 `x-conversation-id` 这个自定义头**：

     Access to fetch at '…/.cloud/llm/chat/completions' from origin '…' has been blocked by
     CORS policy: Request header field x-conversation-id is not allowed by Access-Control-Allow-Headers

   后果不是"某个次要功能坏了"，而是**整节课都是哑的**：老师的话根本发不出去 →
   没有文本 → 朗读无事可做 → 用户听到的是**完全没声音**，而且界面上只有一句
   "网络异常，请检查网络后重试"（连"没声音"和"网络异常"之间的因果关系都看不出来）。
   实测对照：跨源时真发声 0 次；把请求改到同源后真发声 5 次、老师正常讲课。

   用 location.origin 还带来一个好处：**应用从此与域名解耦** —— 以后再换域名/多域名部署，
   云端调用都不会因为跨源而失效（这正是本次故障的根因）。
   本地用 `npm start` 跑时 origin 是 localhost、没有 `.cloud/*` 代理，云端功能本就用不了
   （会走"云服务未就绪"的既有降级路径），所以这里不需要为本地做特例。 */
/* ★ 2026-09-29 修（检查 agent 复查查出）：
   ① `file://` 下 `location.origin` 是**字符串 "null"**（真值！），会走 origin 分支，
      于是兜底常量永远到不了，反而把 `endpoint: 'null'` 递给 SDK → 初始化直接抛错。
      所以判真值之外还要排除 "null" 与非 http(s)。
   ② 兜底**不再写死域名** —— 旧域名 `lingxi-class.app.workbuddy.host` 现在本身就是 404，
      写死它只有坏处。改成空串：SDK 的 resolveEndpoint 对空值会自己回落到 location.origin。 */
/* 判定云端 endpoint。抽成纯函数是为了**能被行为测试直接覆盖** ——
   这段逻辑踩过一次坑（见下），靠 grep 源码是测不出来的。 */
function resolveCloudEndpoint(origin) {
  const o = String(origin == null ? '' : origin);
  return (/^https?:\/\//.test(o) && o !== 'null') ? o : '';
}
const _origin = (typeof window !== 'undefined' && window.location) ? String(window.location.origin || '') : '';
const CLOUD_ENDPOINT = resolveCloudEndpoint(_origin);

const PUBLIC_CONFIG = {
  endpoint: CLOUD_ENDPOINT,
  publishableKey: 'wbpk_Pq3DhJIr74vvC8YpuqkMPA_lgoEQ7iPSjSnnQx9ZsLOpjoB6dFoKCSh',
  /* 运营方联系邮箱：填写后会出现在《隐私政策》「联系我们」与注销确认里。
     留空时，界面只展示可自助的数据权利入口，不会出现死链接。 */
  supportEmail: '',
};

/* ---------- 全局状态 ---------- */
const state = {
  cloud: null,
  models: [],
  model: null,
  courses: [],
  homeSystem: 'cn',
  gen: { system: 'cn', subject: '数学', boards: [], duration: '45 分钟', level: '基础巩固', type: 'new' },
  live: null, // { course, conversationId, messages, controller, busy, seconds, timerInt, stageIndex, savedProgress }
  /* 教学偏好：苏格拉底引导等级 + 元认知提示，长期记忆在 localStorage */
  guide: 'balanced',   // 'more' 更多引导 | 'balanced' 均衡 | 'less' 更多自主
  meta: true,          // 是否启用元认知提问（"哪一步让你困惑？"）
  /* 账号与长期记忆 */
  user: null,          // 已登录用户 { id, email, phone }
  mem: null,           // 当前学生的长期记忆档案（云端）
  memLoaded: false,    // 是否已尝试拉取
  smsReady: null,      // 短信通道是否可用（null=未知，false=本环境未开通）
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ============================================================
   长期记忆（Per-user memory）
   三个云端表（均 owner-only RLS，owner_id 由 DEFAULT auth.uid() 填充）：
     student_profiles — 学生画像（学段/目标/风格/掌握度/优势/薄弱点）
     student_facts    — 老师记住的每条具体事实（偏好/误区/进度）
     student_sessions — 每节课的小结与逐字记录
   记忆的用法：① 开课前置入 system prompt；② 课后自动提炼并写回。
   未登录时一切照旧（纯本地），登录后自动升级为跨设备长期记忆。
   ============================================================ */

const FACT_KINDS = {
  weak: { label: '薄弱点', cls: 'k-weak' },
  strength: { label: '优势', cls: 'k-strength' },
  preference: { label: '偏好', cls: 'k-preference' },
  progress: { label: '进度', cls: 'k-progress' },
  misconception: { label: '易错点', cls: 'k-weak' },
  context: { label: '背景', cls: 'k-preference' },
};

const MASTERY_LEVELS = {
  need: { label: '待巩固', cls: 'm-need' },
  learning: { label: '学习中', cls: 'm-learning' },
  mastered: { label: '已掌握', cls: 'm-mastered' },
};

/* 知识点掌握度：把散落的记忆事实按 topic 聚合成「掌握度」。
   定级取"最需要关注"的信号（易错点 > 薄弱点 > 进度 > 优势），
   而不是简单平均 —— 一个知识点哪怕有 3 条优势、只要有 1 条易错点，就不能算已掌握。
   preference / context 与掌握度无关，不参与。

   ★ 2026-09-29 修（外部审查 R07，P2）。原文的判据只有"取最差"，导致：
     · 只用 topic 分组、**不含学科** —— "分数"在数学和物理里被算成同一个知识点；
     · 早期任何一条 weak/misconception 会**永久**压过后来的 strength：
       实测"旧 weak（置信度 1）+ 10 次命中的新 strength"仍然显示"待巩固"。
       只要那条旧事实还在加载集合里，老师就会一直被它带偏截止。
   改法：
     · 分组键带上学科；
     · 引入**退役规则** —— 负面结论之后出现了足够的"已掌握"证据（时间更晚 + 次数达标），
       就把它降级为**历史**，不再压着当前掌握度；
     · 同时把 wasWeak 暴露出去，让学生看到"曾经薄弱、现已掌握"（结论不能被悄悄抹掉）。
   为什么要有次数门槛：一次答对可能只是蒙对，不足以退役一条错因结论。 */
const MASTERY_SUPERSEDE_HITS = 3;

/* 取事实的时间点。字段来源不统一（last_seen 是 ISO 串，其余可能是毫秒数），
   这里统一成可比较的毫秒；取不到就当 0（最旧）。 */
function factTime(f) {
  if (!f) return 0;
  const t = (f.last_seen != null ? f.last_seen : (f.updatedAt != null ? f.updatedAt : (f.createdAt != null ? f.createdAt : f.at)));
  if (t == null) return 0;
  if (typeof t === 'number') return isFinite(t) ? t : 0;
  const ms = Date.parse(String(t));
  return isNaN(ms) ? 0 : ms;
}

function buildMastery(facts) {
  const agg = {};
  (facts || []).forEach((f) => {
    if (!f) return;
    const rank = { misconception: 0, weak: 1, progress: 2, strength: 3 }[f.kind];
    if (rank === undefined) return;      // 非掌握度相关的事实（偏好/背景）不计入
    const topic = String(f.topic || '').trim();
    if (!topic) return;
    /* ★ 分组键必须带学科（R07）：原来只用 topic，跨学科同名知识点互相污染 */
    const subject = String(f.subject || '').trim();
    const key = subject + '｜' + topic;
    const t = agg[key] || (agg[key] = {
      topic, subject, rank: 3, conf: 0, hits: 0,
      posAt: 0, posHits: 0,      // 最近的"已掌握"证据：时间 + 累计命中
      negAt: 0, posHistoric: false,
    });
    const at = factTime(f);
    const hits = Number(f.hits || 0);
    if (Number(f.confidence || 0) > t.conf) t.conf = Number(f.confidence || 0);
    t.hits += hits;
    if (rank <= 1 && at > t.negAt) t.negAt = at;
    if (rank === 3) { if (at > t.posAt) t.posAt = at; t.posHits += hits; }
    if (rank < t.rank) t.rank = rank;
  });

  Object.keys(agg).forEach((k) => {
    const t = agg[k];
    /* ★ 退役规则：负面结论之后有足够的"已掌握"证据 → 降级为历史，不再压着当前定级。
       三个条件缺一不可：时间更晚、次数达标、确实存在过负面结论。 */
    if (t.negAt && t.posAt > t.negAt && t.posHits >= MASTERY_SUPERSEDE_HITS) {
      t.posHistoric = true;
      t.rank = 3;
    }
  });

  const levelOf = (rank) => (rank <= 1 ? 'need' : rank === 2 ? 'learning' : 'mastered');
  const ord = { need: 0, learning: 1, mastered: 2 };
  return Object.keys(agg)
    .map((k) => ({
      topic: agg[k].topic, subject: agg[k].subject,
      level: levelOf(agg[k].rank), conf: agg[k].conf, hits: agg[k].hits,
      wasWeak: agg[k].posHistoric,     // 曾经薄弱、现已掌握
    }))
    .sort((a, b) => ord[a.level] - ord[b.level] || b.conf - a.conf);
}

/* ============================================================
   错因分析（Error-cause analysis）
   只判"对/错"没有教学价值 —— 真正决定怎么补的是"为什么错"。
   四维归类参照数学教育研究里最常用的一种错误分类（Newman 分析框架的简化版）：
     knowledge  知识漏洞：概念/公式根本没掌握        → 要重讲
     concept    概念混淆：把相近概念/条件弄混了      → 要辨析对比
     careless   计算失误：思路对、算错了            → 要建立检查习惯
     reading    审题偏差：看漏/看错条件，答非所问    → 要练审题
   前两类是"真不会"，后两类是"会但没做对"，两者的补救方式完全相反。
   这一点必须显式告诉学生，否则"我明明会"的挫败感会伤害学习动机。
   ============================================================ */
const ERROR_CAUSES = {
  knowledge: {
    label: '知识漏洞',
    short: '漏洞',
    cls: 'e-knowledge',
    icon: '📕',
    // 一句话说清"这意味着什么"，避免学生把错因当成指责
    meaning: '这个概念本身还没学会',
    action: '需要把定义和原理重新讲一遍，从最简单的例子入手。',
  },
  concept: {
    label: '概念混淆',
    short: '混淆',
    cls: 'e-concept',
    icon: '🔀',
    meaning: '把两个相近的概念、公式或适用条件弄混了',
    action: '要把容易混的几组放在一起对比辨析，逐条说清"什么情况用哪个"。',
  },
  careless: {
    label: '计算失误',
    short: '算错',
    cls: 'e-careless',
    icon: '🧮',
    meaning: '思路是对的，但运算或书写过程出了问题',
    action: '这类错是"会但没做对"，重点是养成验算和逐步检查的习惯，不用重学知识。',
  },
  reading: {
    label: '审题偏差',
    short: '审题',
    cls: 'e-reading',
    icon: '👀',
    meaning: '漏看或看错了题目条件，理解的方向偏了',
    action: '读题时先把条件逐条划出来、把问句圈出来，再动笔。',
  },
  other: {
    label: '其它原因',
    short: '其它',
    cls: 'e-other',
    icon: '❓',
    meaning: '暂时无法归入上述四类',
    action: '下节课请老师现场看看你是怎么做的。',
  },
};

const ERROR_CAUSE_KEYS = ['knowledge', 'concept', 'careless', 'reading'];
const ERROR_CAUSE_MAX = ERROR_CAUSE_KEYS.length;

function normErrorCause(c) {
  const k = String(c || '').trim().toLowerCase();
  if (ERROR_CAUSES[k] && k !== 'other') return k;
  // 容错：模型偶尔会给中文或同义词
  const alias = {
    知识漏洞: 'knowledge', 概念不清: 'knowledge', 不会: 'knowledge',
    概念混淆: 'concept', 混淆: 'concept', 弄混: 'concept',
    计算错误: 'careless', 计算失误: 'careless', 粗心: 'careless', 马虎: 'careless',
    审题偏差: 'reading', 审题错误: 'reading', 看错题: 'reading', 没看清: 'reading',
  };
  const s = String(c || '').trim();
  return alias[s] || 'other';
}

function emptyCauseStat() {
  const o = {};
  ERROR_CAUSE_KEYS.forEach((k) => { o[k] = 0; });
  return o;
}

/* 归一化一节课的错因清单：只保留有意义的条目，最多四类各一条 */
function cleanErrorCauses(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((e) => {
    if (!e) return;
    const cause = normErrorCause(typeof e === 'string' ? e : e.cause);
    if (cause === 'other') return;
    if (out.some((x) => x.cause === cause)) return;   // 同类只留第一条
    const topic = String((typeof e === 'object' && e.topic) || '').trim().slice(0, 120);
    const detail = String((typeof e === 'object' && (e.detail || e.wrong || e.mistake)) || '').trim().slice(0, 240);
    const fix = String((typeof e === 'object' && (e.fix || e.suggestion || e.action)) || '').trim().slice(0, 240);
    out.push({ cause, topic, detail, fix });
  });
  return out.slice(0, ERROR_CAUSE_MAX);
}

/* 跨课程聚合错因：按"科目 · 知识点"分组，统计四维分布 */
function buildErrorProfile(sessions) {
  const groups = {};
  let total = 0;
  (sessions || []).forEach((s) => {
    const list = Array.isArray(s && s.error_causes) ? s.error_causes : [];
    list.forEach((raw) => {
      if (!raw) return;
      // 与 cleanErrorCauses 保持一致：字符串条目也要能容错（历史数据 / 手工写的行）
      const e = typeof raw === 'string' ? { cause: raw } : raw;
      const cause = normErrorCause(e.cause);
      if (cause === 'other') return;
      total++;
      const topic = String(e.topic || '').trim() || '未归类知识点';
      const subject = String((s && s.subject) || '').trim();
      const key = (subject ? subject + ' · ' : '') + topic;
      const g = groups[key] || (groups[key] = { key, subject, topic, counts: emptyCauseStat(), total: 0 });
      if (!g.counts || typeof g.counts[cause] !== 'number') g.counts = emptyCauseStat();
      g.counts[cause]++;
      g.total++;
    });
  });
  const hasCareless = Object.keys(groups).some((k) => groups[k].counts.careless > 0);
  const hasReading = Object.keys(groups).some((k) => groups[k].counts.reading > 0);
  const list = Object.keys(groups).map((k) => {
    const g = groups[k];
    // 主导错因：次数最多；并列时优先"更该补"的知识性错因
    const prio = { knowledge: 0, concept: 1, careless: 2, reading: 3 };
    const top = ERROR_CAUSE_KEYS
      .filter((c) => g.counts[c] > 0)
      .sort((a, b) => g.counts[b] - g.counts[a] || prio[a] - prio[b])[0];
    return Object.assign({}, g, { top });
  }).sort((a, b) => {
    const ka = a.counts.knowledge + a.counts.concept;
    const kb = b.counts.knowledge + b.counts.concept;
    return kb - ka || b.total - a.total;
  });
  return {
    total,
    list,
    // 会但没做对（粗心 + 审题）/ 真不会（漏洞 + 混淆）：这个比例最该被学生看到
    carelessish: total ? (list.reduce((n, g) => n + g.counts.careless + g.counts.reading, 0)) : 0,
    hasCareless,
    hasReading,
  };
}

/* ============================================================
   入学诊断（起点画像）
   ------------------------------------------------------------
   为什么要有它：一对一最大的优势是"从学生真实起点开始"，但开课前
   老师其实一无所知 —— 只能靠学生自己填的"基础巩固/进阶提升"，
   那是个自我评价，常常不准（学生普遍高估或低估自己）。
   代价也最大：**把已经会的东西讲一遍，是消耗信任最快的方式**。

   所以这里做一件很具体的事：课前出 5-8 道**诊断题**，
   不是考分，而是**定位**：每道题对应一个知识点，用结果把学生
   分成三档（掌握 / 模糊 / 未掌握），再据此生成一张"起点画像"，
   直接决定第一节课从哪里讲起、哪些可以跳过。

   与「错因四维」的关系：诊断只分三档（会不会），不判错因 ——
   错因需要看解题过程，那是直播课里老师边问边判断的事。
   诊断负责**圈出范围**，错因负责**解释原因**。两者互补，不重复。
   ============================================================ */

/* 诊断结果分档。注意"未作答"是独立一档，不能算错 ——
   学生可能只是没来得及做，把它当"不会"会冤枉人。 */
const DIAG_LEVELS = {
  ok: { label: '已掌握', cls: 'd-ok', icon: '✅', order: 0 },
  fuzzy: { label: '待确认', cls: 'd-fuzzy', icon: '🔶', order: 1 },
  gap: { label: '未掌握', cls: 'd-gap', icon: '🔴', order: 2 },
  na: { label: '未作答', cls: 'd-na', icon: '⬜', order: 3 },
};

/* 诊断题量：5-8 题。少于 5 题定位不出范围，多于 8 题开课前就把人劝退了。 */
const DIAG_MIN = 5;
const DIAG_MAX = 8;

function normDiagLevel(v) {
  const k = String(v || '').trim().toLowerCase();
  if (DIAG_LEVELS[k] && k !== 'na') return k;
  // 容错：模型可能直接说结论
  if (/^(true|yes|correct|对|会|掌握|熟练|是)$/i.test(k)) return 'ok';
  if (/^(false|no|wrong|错|不会|没掌握|否)$/i.test(k)) return 'gap';
  return 'na';
}

/* 单题判定：优先按"选项字母对不对"，其次按"是否作答 + 自评"。
   为什么要分 na / fuzzy：诊断题里有简答题，学生可能答了但没答对，
   这和"空着没写"在诊断上是两回事 —— 前者是 gap 的强信号，后者是没信息。 */
function judgeDiagItem(item, ans) {
  if (!item) return { level: 'na', reason: '' };
  const a = ans || {};
  const answered = a.value !== undefined && a.value !== null && String(a.value).trim() !== '';
  if (!answered) return { level: 'na', reason: '没有作答' };

  if (item.type === 'choice') {
    const correct = String(a.value).trim().toUpperCase();
    const answer = String(item.answer || '').trim().toUpperCase();
    if (!answer) return { level: 'fuzzy', reason: '这道题缺参考答案，先按待确认' };
    return correct === answer
      ? { level: 'ok', reason: '选对了' }
      : { level: 'gap', reason: '选错（正确答案 ' + answer + '）' };
  }
  // 简答/填空：没有客观标准，交给"学生自评 + 是否写了"两档
  const self = String(a.self || '').trim();
  if (self === 'sure') return { level: 'ok', reason: '自己确认做对了' };
  if (self === 'unsure') return { level: 'fuzzy', reason: '做了但不确定' };
  return { level: 'fuzzy', reason: '有作答但未自评' };
}

/* 把逐题结果聚合成"起点画像"。
   ★ 关键设计：**按知识点聚合，且同一知识点取最差的一档**。
   一个知识点出两道题、对一道错一道 —— 那不是"掌握一半"，
   而是"不稳定"，必须按待确认/未掌握处理（和掌握度图谱用同一套哲学：
   不能因为有几条好信号就把坏信号平均掉）。 */
function buildDiagnostic(items, answers) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const byTopic = {};
  const order = [];
  list.forEach((it, i) => {
    const key = String(it.topic || '').trim() || ('第 ' + (i + 1) + ' 题');
    if (!byTopic[key]) {
      byTopic[key] = { topic: key, subject: it.subject || '', levels: [], reasons: [] };
      order.push(key);
    }
    const j = judgeDiagItem(it, (answers || {})[i]);
    byTopic[key].levels.push(j.level);
    if (j.reason) byTopic[key].reasons.push(j.reason);
  });

  const topics = order.map((k) => {
    const g = byTopic[k];
    // 最差档胜出：gap > fuzzy > ok；全是 na 则该知识点确实没被评估
    const real = g.levels.filter((x) => x !== 'na');
    let level = 'na';
    if (real.length) {
      if (real.includes('gap')) level = 'gap';
      else if (real.includes('fuzzy')) level = 'fuzzy';
      else level = 'ok';
    }
    return { topic: g.topic, level, reason: g.reasons[0] || '', count: g.levels.length };
  });

  const counts = { ok: 0, fuzzy: 0, gap: 0, na: 0 };
  topics.forEach((t) => { counts[t.level]++; });
  const judged = topics.filter((t) => t.level !== 'na');
  const score = judged.length ? Math.round((counts.ok / judged.length) * 100) : 0;

  // 学习建议：先看"未掌握"有多少，再看整体水平，别一上来就喊加油
  let verdict;
  if (!judged.length) {
    verdict = '这次没有作答记录，暂时无法判断起点 —— 直接开始上课，老师会在课上一对一确认。';
  } else if (counts.gap === 0 && counts.fuzzy === 0) {
    verdict = '这些知识点你<b>全都答对了</b>，基础很扎实。这节课我们会<b>直接跳到更难的题型和综合应用</b>，不做重复铺垫。';
  } else if (counts.gap === 0) {
    verdict = '整体掌握得不错，只有个别点不太确定。上课时老师会先<b>快速带你确认这几个点</b>，再进入提升内容。';
  } else if (counts.gap >= Math.ceil(judged.length / 2)) {
    verdict = '有<b>多个知识点还没掌握</b>，这完全正常 —— 说明这节课正好讲在你需要的地方。' +
      '老师会从最基础的一步开始，不预设你已经会了。';
  } else {
    verdict = '你的情况是<b>部分掌握、部分不牢</b>。老师会跳过你已经会的，集中把薄弱的那几个点讲透。';
  }

  return {
    topics,
    counts,
    total: topics.length,
    judged: judged.length,
    score,
    verdict,
    // 优先级：未掌握最该先讲，其次待确认；已掌握的直接跳过
    focus: topics.filter((t) => t.level === 'gap')
      .concat(topics.filter((t) => t.level === 'fuzzy'))
      .map((t) => t.topic),
    skip: topics.filter((t) => t.level === 'ok').map((t) => t.topic),
  };
}

/* 诊断题出题 prompt。要点：题目必须**短、可自答、能区分会不会**，
   不要出需要长篇演算的题 —— 开课前没人愿意做压轴题。 */
function buildDiagnosticPrompt(opt) {
  const o = opt || {};
  const sys = getSystem(o.system || state.gen.system);
  const isIntl = sys.id === 'intl';
  const n = Math.min(DIAG_MAX, Math.max(DIAG_MIN, o.count || 6));
  const boards = (o.boards || []).filter(Boolean);
  return '请为一位准备开始一对一辅导的学生出一份**课前诊断卷**，用来定位他/她的真实起点。\n' +
    '科目：' + (o.subject || state.gen.subject) + '\n' +
    '课程体系：' + sys.name + (isIntl ? '（对标考纲：' + (boards.length ? boards.join('、') : '国际通行标准') + '）' : '') + '\n' +
    '学段：' + (o.grade || '') + '\n' +
    '学习目标：' + (o.goal || '未填写，请按该学段该科目的典型学习需求设计') + '\n' +
    '题量：' + n + ' 题\n' +
    '题目要求：\n' +
    '1. 每题只考察**一个**知识点，并在 topic 字段写出该知识点的名称（4-10 字，如"配方法"、"韦达定理"）；\n' +
    '2. **难度要有梯度**：前 2 题是该学段最基础的（几乎必须会），中间 3-4 题是标准难度，最后 1-2 题稍难，' +
    '这样既能查出"地基有没有塌"，也能看出上限；\n' +
    '3. 每题都能在 1-2 分钟内独立做完，**不要出需要长篇演算的压轴题**；\n' +
    '4. 优先用选择题（4 个选项，题干和选项都要具体，数学要给出真实数字/式子）；' +
    '   最多 2 道简答题（此时 options 留空数组，answer 写简要答案）；\n' +
    '5. 干扰项要真实：选那些"用错方法/记混公式"就会选中的答案，不要放明显可笑的选项；\n' +
    '6. 覆盖该目标下**最关键**的知识点，而不是随便凑 6 个知识点。' +
    (isIntl ? '\n7. 专业术语给出英文原名（如 "判别式 discriminant"）。' : '');
}

/* 诊断卷的系统提示词：只吐 JSON，并明确 topic 的作用（后面靠它做聚合） */
function langNote(fieldWord) {
  // 统一的语言指令片段：让诊断卷 / 课件 / 小结等所有由模型生成的产物
  // 跟老师的授课语言保持一致，避免"英文课配中文诊断卷"这种精神分裂
  return teachLang() === 'en'
    ? '★ 全部内容（' + (fieldWord || '标题、题干、选项、说明文字') + '）必须用英语（English）书写，不要出现中文。'
    : '';
}

function diagnosticSystemPrompt() {
  return '你是「灵犀课堂」的资深学科教研员，擅长设计**课前诊断卷**来快速定位学生的真实水平。' +
    '你既熟悉中国国家课程与中高考考纲，也熟悉 IB、A-Level、AP、IGCSE 等国际课程体系。' +
    langNote('诊断卷标题、说明、题干、选项') +
    '只输出一个 JSON 对象，禁止输出 markdown 代码块或任何解释文字。JSON 结构：' +
    '{"title":"诊断卷标题","intro":"一两句话向学生说明这份诊断是做什么的（不要吓人，说明只是为定制课程）",' +
    '"items":[{"topic":"知识点名称（4-10字，必须能被复用作为知识点的唯一标识）",' +
    '"type":"choice","question":"完整题干",' +
    '"options":["A. 选项一","B. 选项二","C. 选项三","D. 选项四"],' +
    '"answer":"B","why":"这个知识点为什么会错（一句话，老师看）",' +
    '"ifWrong":"答错说明什么（一句话，老师看：是概念没懂还是方法没掌握）"}]}。' +
    '注意：简答题的 options 必须是空数组 []，answer 写简要答案文字。';
}

/* 清洗诊断卷：模型输出经常有小毛病（选项前缀缺失、answer 是中文整句、
   topic 重复），这里做归一化，保证后面聚合算法拿到的是干净数据。 */
function cleanDiagnostic(raw, opt) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const src = Array.isArray(o.items) ? o.items : [];
  const items = [];
  const seen = {};
  src.forEach((it) => {
    if (!it || !it.question) return;
    if (items.length >= DIAG_MAX) return;
    let type = String(it.type || '').toLowerCase() === 'choice' ? 'choice' : 'short';
    let topic = String(it.topic || '').trim().slice(0, 40);
    if (!topic) topic = '第 ' + (items.length + 1) + ' 题';
    // 同一知识点重复出题：保留（能测稳定性），但最多两条，避免整卷只考一个点
    seen[topic] = (seen[topic] || 0) + 1;
    if (seen[topic] > 2) return;
    let options = [];
    if (type === 'choice' && Array.isArray(it.options)) {
      options = it.options.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6);
      // 补上 A. B. C. 前缀（模型时常漏）
      options = options.map((x, i) => (/^[A-F][.、)]/.test(x) ? x : String.fromCharCode(65 + i) + '. ' + x));
    }
    if (!options.length) type = 'short';
    let answer = String(it.answer == null ? '' : it.answer).trim().slice(0, 60);
    // 把"答案是 B"这类整句压成单个字母
    const m = /(?:^|[^A-Za-z])([A-F])(?:[^A-Za-z]|$)/.exec(answer);
    if (type === 'choice' && m) answer = m[1].toUpperCase();
    items.push({
      topic,
      type,
      question: String(it.question).trim().slice(0, 500),
      options,
      answer,
      why: String(it.why || '').trim().slice(0, 200),
      ifWrong: String(it.ifWrong || it.if_wrong || '').trim().slice(0, 200),
    });
  });
  return {
    title: String(o.title || '').trim() || '课前诊断',
    intro: String(o.intro || '').trim() ||
      '这不是考试，只是为了知道你从哪里开始 —— 有几道不会做很正常，直接跳过也没关系。',
    subject: (opt && opt.subject) || state.gen.subject,
    system: (opt && opt.system) || state.gen.system,
    grade: (opt && opt.grade) || '',
    goal: (opt && opt.goal) || '',
    items,
  };
}

/* PostgREST 查询结果统一拆包 */
function dbPick(res) {
  if (!res) return null;
  if (res.error) throw res.error;
  return res.data;
}

/* 当前是否具备云端记忆能力 */
function memReady() {
  return !!(state.cloud && state.cloud.database && state.user && !state.user.anonymous);
}

/* 拉取当前学生的完整记忆（画像 + 事实 + 最近上课记录） */
async function loadMemory(force) {
  if (!state.cloud || !state.user) { state.mem = null; state.memLoaded = true; return null; }
  if (state.user.anonymous) { state.mem = null; state.memLoaded = true; return null; }
  if (state.memLoaded && !force) return state.mem;

  const db = state.cloud.database;
  try {
    const [profRes, factsRes, sessRes] = await Promise.all([
      db.from('student_profiles').select('*').maybeSingle(),
      db.from('student_facts').select('*').order('last_seen', { ascending: false }).limit(80),
      // 带 error_causes 查一次；若该列还没建（老库），降级到不带它的字段集，
      // 保证"错因分析"缺失时其余档案功能完全不受影响
      // 带 error_causes / cards / review_plan 查一次；老库可能还没建这几列，逐级降级，
      // 保证任何一级缺失都不会让整个档案读不出来（已有模式，这里多了一级）。
      /* ★ 2026-09-25 修：**存了却读不出来**
         saveSession 一直把 cards（闪卡）与 review_plan（间隔复习计划）写进数据库，
         但这条 select 从来没查过这两列 —— 结果是每节课的闪卡与复习计划白存了，
         学生下课后想复习，档案页里看不到任何入口。
         而"主动回忆 + 间隔重复"正是产品自己在生成提示词里写的教学法依据。 */
      (async () => {
        const L1 = 'id, course_title, subject, grade, duration_secs, mastered, weak_points, homework, comment, error_causes, cards, review_plan, created_at';
        const L2 = 'id, course_title, subject, grade, duration_secs, mastered, weak_points, homework, comment, error_causes, created_at';
        const base = 'id, course_title, subject, grade, duration_secs, mastered, weak_points, homework, comment, created_at';
        const q = (cols) => db.from('student_sessions').select(cols)
          .order('created_at', { ascending: false }).limit(20);
        for (const cols of [L1, L2, base]) {
          const r = await q(cols);
          if (r && !r.error) return r;
        }
        return q(base);
      })(),
    ]);
    const profile = dbPick(profRes) || null;
    const facts = dbPick(factsRes) || [];
    const sessions = dbPick(sessRes) || [];
    state.mem = { profile, facts, sessions };
    state.memLoaded = true;
    return state.mem;
  } catch (e) {
    // 登录态失效会连带把记忆读取打成 401：清掉残留会话，避免"明明登录着却什么都不能用"
    if (isAuthError(e)) {
      /* ★ 2026-09-29 修：原来这里 healSession() 成功后又 toast 一次
         「已切回访客模式，可以继续上课」—— 而 healSession 内部**已经**提示过
         「登录状态已过期，请重新登录」，两句话自相矛盾；而且"可以继续上课"与
         「没有游客模式 / 未登录不允许跑」直接冲突。这里不再补第二句。 */
      try { await healSession(); } catch (_) {}
    }
    console.warn('[memory] 读取失败:', (e && e.message) || e);
    state.mem = { profile: null, facts: [], sessions: [], error: e };
    state.memLoaded = true;
    return state.mem;
  }
}

/* 画像 upsert：owner 唯一索引保证一人一行 */
async function saveProfile(patch) {
  if (!memReady()) return null;
  const db = state.cloud.database;
  try {
    // 先按 owner 查是否已有画像；RLS 保证只能看到自己的
    const { data: rows } = await db.from('student_profiles').select('id, sessions_count, total_seconds').limit(1);
    const cur = Array.isArray(rows) && rows.length ? rows[0] : null;
    const body = Object.assign({}, patch);
    if (cur) {
      // patch 里若带 sessions_count/total_seconds 增量，这里做累加
      if (typeof patch._addSessions === 'number') {
        body.sessions_count = (cur.sessions_count || 0) + patch._addSessions;
        delete body._addSessions;
      }
      if (typeof patch._addSeconds === 'number') {
        body.total_seconds = (cur.total_seconds || 0) + patch._addSeconds;
        delete body._addSeconds;
      }
      body.updated_at = new Date().toISOString();
      const res = await db.from('student_profiles').update(body).eq('id', cur.id).select();
      const out = dbPick(res);
      // 空数组 = RLS 拦下（不属于自己），必须显式处理而不是当作成功
      if (Array.isArray(out) && out.length === 0) {
        console.warn('[memory] 画像更新被 RLS 拒绝');
        return null;
      }
      return Array.isArray(out) ? out[0] : null;
    }
    // 首次创建
    if (typeof patch._addSessions === 'number') { body.sessions_count = patch._addSessions; delete body._addSessions; }
    if (typeof patch._addSeconds === 'number') { body.total_seconds = patch._addSeconds; delete body._addSeconds; }
    const res = await db.from('student_profiles').insert(body).select();
    const out = dbPick(res);
    return Array.isArray(out) ? out[0] : null;
  } catch (e) {
    console.warn('[memory] 画像写入失败:', e);
    return null;
  }
}

/* 批量写入「老师记住的事」，同内容去重（命中则提升 confidence + hits） */
async function saveFacts(facts) {
  if (!memReady() || !Array.isArray(facts) || !facts.length) return 0;
  const db = state.cloud.database;
  /* ★ R07 的一条未竟事项（如实记下，不猜）：报告建议给事实补上
     「课程体系（system）」和「知识点 ID」，这样跨体系同名知识点也能分开、
     并且能精确地"用新证据退役旧结论"。
     但**业务表的建表语句与迁移不在仓库里**（仓库 SQL 只有设备/手机号台账），
     盲加列会让 insert 直接失败、把整条记忆写入打断。
     所以这里只用**已有字段**做退役判定：`last_seen`（时间）+ `hits`（次数）——
     这两个字段已经足够支撑 buildMastery 的新规则，不依赖 schema 变更。
     补列这件事要连迁移脚本一起交付，见 README 的部署前置条件。 */
  const list = facts
    .filter((f) => f && f.content && String(f.content).trim())
    .map((f) => ({
      kind: FACT_KINDS[f.kind] ? f.kind : 'context',
      content: String(f.content).trim().slice(0, 400),
      subject: f.subject ? String(f.subject).slice(0, 60) : null,
      topic: f.topic ? String(f.topic).slice(0, 120) : null,
      confidence: typeof f.confidence === 'number' ? Math.min(1, Math.max(0, f.confidence)) : 0.6,
      source: f.source ? String(f.source).slice(0, 60) : 'class',
    }))
    // 同一次返回里也去重
    .filter((f, i, arr) => arr.findIndex((x) => x.content === f.content) === i);
  if (!list.length) return 0;

  // 拿已有内容做去重（只取自己的，RLS 保证）
  let existing = [];
  try {
    const res = await db.from('student_facts').select('id, content, hits, confidence').limit(500);
    existing = dbPick(res) || [];
  } catch (_) {}

  const byContent = new Map(existing.map((r) => [String(r.content), r]));
  const fresh = list.filter((f) => !byContent.has(f.content));
  let written = 0;

  // 命中已有：更新 last_seen / hits / confidence
  for (const f of list) {
    const hit = byContent.get(f.content);
    if (!hit) continue;
    try {
      await db.from('student_facts').update({
        last_seen: new Date().toISOString(),
        hits: (hit.hits || 0) + 1,
        confidence: Math.min(1, (hit.confidence || 0.6) + 0.12),
      }).eq('id', hit.id);
      written++;
    } catch (_) {}
  }
  if (fresh.length) {
    try {
      const res = await db.from('student_facts').insert(fresh).select('id');
      const out = dbPick(res);
      written += Array.isArray(out) ? out.length : 0;
    } catch (e) { console.warn('[memory] 事实写入失败:', e); }
  }
  return written;
}

async function saveSession(rec) {
  if (!memReady()) return null;
  const db = state.cloud.database;
  const body = {
    course_title: String(rec.courseTitle || '未命名课程').slice(0, 200),
    subject: rec.subject || null,
    grade: rec.grade || null,
    duration_secs: Math.max(0, Math.round(rec.durationSecs || 0)),
    mastered: Array.isArray(rec.mastered) ? rec.mastered.slice(0, 12) : [],
    weak_points: Array.isArray(rec.weakPoints) ? rec.weakPoints.slice(0, 12) : [],
    homework: Array.isArray(rec.homework) ? rec.homework.slice(0, 12) : [],
    cards: Array.isArray(rec.cards) ? rec.cards.slice(0, 12) : [],
    review_plan: Array.isArray(rec.reviewPlan) ? rec.reviewPlan.slice(0, 12) : [],
    comment: rec.comment ? String(rec.comment).slice(0, 1200) : null,
    transcript: rec.transcript ? String(rec.transcript).slice(0, 20000) : null,
  };
  const causes = cleanErrorCauses(rec.errorCauses);
  try {
    const res = await db.from('student_sessions').insert(
      causes.length ? Object.assign({ error_causes: causes }, body) : body
    ).select('id');
    const out = dbPick(res);
    return Array.isArray(out) ? out[0] : null;
  } catch (e) {
    // error_causes 列尚未创建时，退回写入不带错因的记录 —— 丢的只是增强字段，不是整节课
    if (causes.length) {
      try {
        const res2 = await db.from('student_sessions').insert(body).select('id');
        const out2 = dbPick(res2);
        console.warn('[memory] error_causes 列缺失，本节课错因未写入（不影响其它数据）');
        return Array.isArray(out2) ? out2[0] : null;
      } catch (e2) {
        // ★ 2026-09-24：这里原来只有 console.warn —— 意味着"这节课的记忆没存上"
        //   在用户侧和统计侧都完全不可见（学生以为存了，我们也不知道丢了多少）。
        //   加上埋点，至少能统计出写入失败率。
        console.warn('[memory] 上课记录写入失败:', e2);
        try { track('memory_write_failed', { stage: 'fallback' }); } catch (_) {}
        return null;
      }
    }
    console.warn('[memory] 上课记录写入失败:', e);
    try { track('memory_write_failed', { stage: 'insert' }); } catch (_) {}
    return null;
  }
}

async function deleteFact(id) {
  if (!memReady()) return false;
  try {
    const res = await state.cloud.database.from('student_facts').delete().eq('id', id).select('id');
    const out = dbPick(res);
    return Array.isArray(out) && out.length > 0;
  } catch (e) { return false; }
}

/* 把记忆渲染成一段可注入 system prompt 的文本（省 token 且信息密度高） */
function memoryPromptBlock() {
  const m = state.mem;
  if (!m) return '';
  const p = m.profile;
  const facts = Array.isArray(m.facts) ? m.facts : [];
  const sessions = Array.isArray(m.sessions) ? m.sessions : [];
  if (!p && !facts.length && !sessions.length) return '';

  const lines = [];
  if (p) {
    const bits = [];
    if (p.grade) bits.push('学段：' + p.grade);
    if (p.system) bits.push('体系：' + p.system);
    if (p.goal) bits.push('目标：' + p.goal);
    if (p.level) bits.push('水平：' + p.level);
    if (p.teaching_style) bits.push('偏好教学风格：' + p.teaching_style);
    if (p.pace) bits.push('节奏：' + p.pace);
    if (bits.length) lines.push('· 画像：' + bits.join('；'));
    if (typeof p.sessions_count === 'number' && p.sessions_count > 0) {
      lines.push('· 已上过 ' + p.sessions_count + ' 节课，累计 ' + Math.round((p.total_seconds || 0) / 60) + ' 分钟');
    }
  }

  // 薄弱点 / 易错点优先（最该被"记住"的部分），最多各取几条
  const pick = (kinds, n) => facts.filter((f) => kinds.includes(f.kind)).slice(0, n);
  const weak = pick(['weak', 'misconception'], 6);
  const strong = pick(['strength'], 4);
  const pref = pick(['preference', 'context'], 5);
  const prog = pick(['progress'], 4);

  if (weak.length) lines.push('· 需要重点关注的薄弱点/易错点：\n   - ' + weak.map((f) => f.content).join('\n   - '));
  if (strong.length) lines.push('· 已展现的优势（可以更快推进）：\n   - ' + strong.map((f) => f.content).join('\n   - '));
  if (pref.length) lines.push('· 学生的偏好与背景：\n   - ' + pref.map((f) => f.content).join('\n   - '));
  if (prog.length) lines.push('· 上次学到哪里：\n   - ' + prog.map((f) => f.content).join('\n   - '));

  if (sessions.length) {
    const last = sessions[0];
    if (last && last.course_title) {
      lines.push('· 上一节课是《' + last.course_title + '》' +
        (last.subject ? '（' + last.subject + '）' : '') +
        (last.comment ? '，当时评价：' + String(last.comment).slice(0, 140) : ''));
    }
  }

  // 错因画像：把"曾经怎么错的"明确交给模型，否则它会反复用同一种无效讲法
  const ep = buildErrorProfile(sessions);
  if (ep.total) {
    const top = ep.list.slice(0, 4);
    lines.push('· 以前出错的原因分析（这决定你这次该怎么讲，不要忽略）：\n   - ' +
      top.map((g) => {
        const c = ERROR_CAUSES[g.top] || ERROR_CAUSES.other;
        return g.topic + '：主要是「' + c.label + '」' +
          (g.counts[g.top] > 1 ? '（出现过 ' + g.counts[g.top] + ' 次）' : '') +
          ' → ' + c.action;
      }).join('\n   - '));
    if (ep.list.some((g) => g.counts.careless > 0)) {
      lines.push('   - 注意：他有「思路对但算错」的情况。讲这类题时不要重讲概念，' +
        '而是带他把验算和逐步骤检查变成习惯。');
    }
    if (ep.list.some((g) => g.counts.reading > 0)) {
      lines.push('   - 注意：他有「读题漏条件」的情况。出题后先让他把条件逐条复述出来再动笔。');
    }
  }
  if (!lines.length) return '';
  return '【关于这个学生的长期记忆（你以前教过他/她，请自然地体现出你记得，但不要生硬复述）】\n' +
    lines.join('\n') + '\n';
}

/* 记忆 → 教学动作的指令：让"记住"真正影响教法，而不只是念档案 */
const MEMORY_USE_RULE =
  '【怎么使用这些记忆】\n' +
  '1. 开场用一两句话自然地衔接上次（例如"上次你对判别式的符号还有点犹豫，今天我们先把它彻底解决"），不要机械念档案。\n' +
  '2. 不要重复讲解学生已掌握的内容，直接推进；但如果学生显露出遗忘，就快速回补一句。\n' +
  '3. 针对"薄弱点/易错点"要主动设计追问去验证是否真的解决了，而不是假设已经学会。\n' +
  '4. 尊重学生的偏好（例子类型、节奏、讲解风格），但不要主动点破你是在"照着偏好讲"。\n' +
  '5. 如果记忆里有明显过时或与学生当前说法矛盾的信息，以学生现在说的为准，并自然更新你的理解。';


/* ============================================================
   法律合规（中国法）
   依据：《个人信息保护法》《网络安全法》《数据安全法》《生成式人工智能服务管理暂行办法》
   落地要点：① 处理前告知并取得同意 ② 最小必要收集 ③ 明示处理目的与保存期限
            ④ 保障查阅/复制/更正/删除/注销等个人权利 ⑤ 未成年人特别提示
            ⑥ 生成式 AI 内容标识提示
   ============================================================ */

/* 协议版本分三个概念，别混在一起（原来只用一个 '2026-09-24.2' 当展示日期，
   界面上就出现了"生效日期：2026-09-24.2"这种把版本号塞进日期的写法）：
   · LEGAL_VERSION    —— 同意记录比对用的键，**改任何条文都必须同步改它**，
                         否则已同意的用户不会被要求重新阅读（hasConsent 就是比它）
   · LEGAL_EFFECTIVE  —— 展示给人看的生效日期
   · LEGAL_REVISION   —— 展示给人看的版本号 */
const LEGAL_VERSION = '2026-09-25.1';       // 本次变更：短信验证码通道已开通，修正相关表述
const LEGAL_EFFECTIVE = '2026-09-25';
const LEGAL_REVISION = 'V1.3';

/* 隐私政策：说明我们收集什么、为什么、存多久、你的权利怎么行使 */
const PRIVACY_DOC = [
  { h: '一、我们收集哪些信息', p: [
    '为向你提供 AI 一对一直播课与跨课程长期记忆服务，我们会收集以下信息：',
    '1）账号信息：你注册或登录时提供的邮箱地址，以及你在登录时使用的验证信息。这是识别你身份、把你的学习数据还给你所必需的。',
    '2）手机号：用于两件事 —— ① 你选择「手机号登录」时，通过短信验证码核验该号码确为你本人所有；② 登录后登记到你的个人档案，用于课后联系你本人或家长、以及你以后找回账号。该号码仅你自己可见，不用于任何营销用途；你也可以选择用邮箱注册登录，之后在「学习档案」或账号面板登记手机号。',
    '3）学习信息：你选择的课程体系、学科、学段、学习目标，你在课堂中的提问与作答、AI 老师对你学习情况的评估结论（已掌握/待巩固的知识点、薄弱点、学习偏好、学习进度）。这些信息用于让 AI 老师跨课程记住你，从而提供更连贯的教学。',
    '4）课堂记录：课堂对话的逐字记录与课堂小结，用于生成学习档案与课堂回放。',
    '5）设备标识：为保障服务公平（一个学习者只使用一个账号，避免重复注册占用课程与算力资源），我们会记录你所用设备的特征标识（由浏览器型号、屏幕尺寸、时区等技术参数计算得到的哈希值，不含你的姓名、电话、位置等身份信息）。该标识仅用于账号唯一性校验与多开风控，作为不可逆哈希保存。',
    '我们不会收集你的身份证号、生物识别信息、精确地理位置、通讯录、相册等与你学习无关的信息。',
  ]},
  { h: '二、我们如何使用这些信息', p: [
    '1）向你提供课程生成、AI 讲解答疑、学习档案与长期记忆等核心功能。',
    '2）向你本人展示并管理你的学习档案。',
    '我们不会将你的个人信息用于广告推送，也不会将其出售给任何第三方。',
  ]},
  { h: '三、AI 处理说明', p: [
    '本服务的讲解内容、课程大纲、课堂小结与分析结论由人工智能模型生成。AI 生成的内容可能存在错误或偏差，仅供学习参考，不构成任何形式的成绩承诺或专业建议。',
    '你的课堂上内容会被发送至模型服务进行推理，以生成本次回复；该处理仅用于完成你所请求的功能。',
    '依据《生成式人工智能服务管理暂行办法》，AI 生成的内容会向你明示其 AI 生成属性。',
  ]},
  { h: '四、保存期限与存储', p: [
    '你的学习数据保存在为你提供服务的云端环境中，保存至你主动删除或注销账号为止。',
    '注销账号后，我们会删除你的学生画像、全部记忆条目与课堂记录，并解除登录方式与你学习数据之间的关联，且不可恢复。为便于你日后重新开始，用于登录的邮箱或手机号会保留为一个没有任何学习记录的空白账号；如需连同该登录方式一并删除，可通过「联系我们」提出。',
  ]},
  { h: '五、你的权利', p: [
    '依据《个人信息保护法》，你对自身个人信息享有以下权利，且可随时行使：',
    '1）查阅、复制：在「学习档案」页可查看全部记忆条目与上课记录，也可一键导出为 JSON 文件。',
    '2）更正、补充：可逐条删除不准确的记忆，或重新添加正确的内容。',
    '3）删除、注销：可删除单条记忆，也可在「账号与个人信息」中注销账号并删除全部数据。',
    '4）撤回同意：你可随时退出登录并使用访客模式，此时我们不再处理你的学习数据。',
  ]},
  { h: '六、未成年人保护', p: [
    '若你未满 14 周岁，请在父母或其他监护人的陪同下阅读本政策，并在取得监护人同意后使用本服务。',
    '我们建议未成年人在监护人指导下使用，且我们会以最小必要原则处理未成年人信息。监护人若需查询、更正或删除未成年人的信息，可通过下方方式联系我们。',
  ]},
  { h: '七、信息安全', p: [
    '我们采用按用户隔离的访问控制机制：每位用户的云端数据仅能由该用户本人读取和写入，其他用户无法访问你的学习档案。',
    '请你妥善保管账号与验证码，不要将其提供给他人。',
  ]},
  { h: '八、联系我们', p: [
    '如你对本政策有任何疑问，或需要行使上述个人权利（包括删除用于登录的邮箱或手机号本身），可通过以下方式联系我们：',
    '1）应用内「账号与个人信息」面板：可自助完成查阅、导出、更正、删除与注销，这是本服务的数据权利受理入口。',
    '2）' + (PUBLIC_CONFIG.supportEmail
      ? '联系邮箱：' + PUBLIC_CONFIG.supportEmail + '。'
      : '如需人工协助，请通过你注册时使用的邮箱与我们联系。'),
    '本政策自 ' + LEGAL_VERSION + ' 起生效。若政策发生重大变更，我们会以显著方式提示你重新阅读并确认。',
  ]},
];

/* 用户协议 */
const TERMS_DOC = [
  { h: '一、服务内容', p: [
    '灵犀课堂（下称"本服务"）为你提供由人工智能驱动的课程生成、一对一在线讲解、课堂互动问答、学习档案与长期记忆等功能。',
    '本服务为学习辅助工具，不能替代学校教育教学，也不提供学历、学位或任何官方认证。',
  ]},
  { h: '二、账号与实名', p: [
    '你可使用邮箱或手机号注册与登录。为遵守《网络安全法》关于网络实名制的要求，你在注册与登录时需通过短信验证码或邮箱验证码完成真实身份验证。',
    '你需要对账号项下的一切行为负责，并妥善保管账号信息与验证码。',
  ]},
  { h: '三、使用规范', p: [
    '你承诺不利用本服务从事违法违规活动，不输入、上传、传播含有下列内容的信息：',
    '1）违反国家法律法规的；2）危害国家安全、荣誉和利益的；3）煽动民族仇恨、破坏民族团结的；4）宣扬淫秽、色情、赌博、暴力、恐怖或者教唆犯罪的；5）侮辱、诽谤他人或侵害他人合法权益的；6）其他违背公序良俗的。',
    '若你输入上述内容，我们有权拒绝处理，并在必要时停止向你提供服务。',
  ]},
  { h: '四、AI 生成内容的说明与责任', p: [
    '本服务中的课程大纲、讲解内容、练习题、解析与学习分析均由人工智能模型生成，可能存在不准确、不完整或不适用于你具体学习阶段的内容。',
    '请在教师或家长指导下甄别使用。你基于 AI 生成内容作出的学习决策与由此产生的后果，由你自行承担。',
  ]},
  { h: '五、知识产权', p: [
    '本服务的界面、代码与产品设计等相关知识产权归我们所有。',
    '你在课堂中输入的问题与你自行上传的学习材料，其权利仍归你所有；你授权我们在为你提供服务的必要范围内处理这些内容。',
  ]},
  { h: '六、服务变更与终止', p: [
    '我们可能因业务调整、技术升级或法律法规要求而变更、中断或终止部分或全部服务，并会提前以适当方式通知你。',
    '你可随时停止使用本服务，并可在「账号与个人信息」中注销账号。',
  ]},
  { h: '七、免责声明', p: [
    '因不可抗力、网络故障、第三方服务（含模型服务、验证码送达）异常等非我们可控的原因导致的服务中断或数据延迟，我们在法律允许范围内不承担责任。',
    '请勿将本服务用于考试作弊等违反学术诚信的用途。',
  ]},
  { h: '八、适用法律与争议解决', p: [
    '本协议的订立、效力、解释、履行及争议解决均适用中华人民共和国法律。',
    '如发生争议，双方应先友好协商；协商不成的，可向有管辖权的人民法院提起诉讼。',
    '本协议自 ' + LEGAL_VERSION + ' 起生效。',
  ]},
];

const DOCS = {
  privacy: { title: '隐私政策', body: PRIVACY_DOC },
  terms: { title: '用户协议', body: TERMS_DOC },
};

/* 同意状态持久化：勾选后记住，但政策版本变化需重新确认 */
const CONSENT_KEY = 'lingxi_consent_v1';
function hasConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    return !!(o && o.version === LEGAL_VERSION);
  } catch (_) { return false; }
}
function setConsent(yes) {
  try {
    if (yes) localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: LEGAL_VERSION, at: Date.now() }));
    else localStorage.removeItem(CONSENT_KEY);
  } catch (_) {}
}
function consentChecked() {
  const box = $('#au-consent');
  return !!(box && box.checked);
}
/* 需要同意才能继续的操作统一走这里 */
function requireConsent() {
  if (consentChecked()) return true;
  authMsg('请先阅读并勾选同意《用户协议》和《隐私政策》');
  return false;
}

/* 渲染并打开协议 / 政策弹窗 */
function openDoc(which, needAgree) {
  const d = DOCS[which];
  if (!d) return;
  const t = $('#doc-title'), b = $('#doc-body'), foot = $('#doc-foot'), m = $('#doc-modal');
  if (!t || !b || !m) return;
  t.textContent = d.title;
  b.innerHTML =
    '<p class="doc-meta">生效日期：' + LEGAL_EFFECTIVE + ' · 版本 ' + LEGAL_REVISION + '</p>' +
    d.body.map((s) => '<h4>' + esc(s.h) + '</h4>' + s.p.map((x) => '<p>' + esc(x) + '</p>').join('')).join('');
  if (foot) foot.hidden = !needAgree;
  if (foot) foot.dataset.doc = which;
  m.hidden = false;
  b.scrollTop = 0;
}
function closeDoc() { const m = $('#doc-modal'); if (m) m.hidden = true; }

/* 用户点击"同意并继续"：记录同意 + 自动勾选 */
function agreeDoc() {
  setConsent(true);
  const box = $('#au-consent');
  if (box) box.checked = true;
  closeDoc();
  authMsg('已记录你的同意，可以继续操作了', 'ok');
}

/* 手机号：只接受中国大陆号段（与 SDK 的归一化规则保持一致） */
function normalizeCNPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
    .replace(/^0086/, '').replace(/^86(?=\d{11}$)/, '');
  return /^1[3-9]\d{9}$/.test(digits) ? digits : null;
}
function phoneMask(p) {
  const raw = String(p || '').trim();
  if (!raw) return '—';
  // 显式写了别的国家码（+1 / +44 …）就不是中国大陆号，原样展示：
  // 光靠 1[3-9] 判断不够，"+1 4155552671" 的第二位 4 也在 [3-9] 里
  if (/^\+/.test(raw) && !/^\+86[\s-]?/.test(raw)) return raw;
  // SDK 回传的是归一化号（"+86 13800138000"），必须先去非数字、再去国家码，
  // 否则 11 位判断失败会退化成 "—"（曾导致手机用户顶栏显示成破折号）
  const digits = raw.replace(/\D/g, '').replace(/^0086/, '').replace(/^86(?=\d{11}$)/, '');
  // 与 normalizeCNPhone 同一条号段规则
  if (/^1[3-9]\d{9}$/.test(digits)) return digits.slice(0, 3) + '****' + digits.slice(7);
  return raw; // 认不出来的号：原样展示，绝不吞成占位符
}


/* ============================================================
   账号（Auth）—— 登录后长期记忆才跨设备生效
   未登录 = 访客：课程照旧存在本机，老师不跨课记忆。
   ============================================================ */

function authUI() {
  /* ★ 身份一变就同步门禁（登录 → 解锁；登出 / 会话失效 → 重新上锁）。
     authUI() 是"身份变化"的唯一收口：doSignOut / onAuthStateChange / healSession
     三条失去登录态的路径都会调它 —— 挂在最前面，一处就覆盖全。 */
  try { syncLoginGate(); } catch (e) { console.warn('[auth] 门禁同步失败:', e); }
  /* ★ 身份一变就切换内容存储的命名空间（R01）。
     必须在这里、且必须**早于** syncCourses() —— 否则上传的仍是上一个账号的课程。
     authUI() 是身份变化的唯一收口，所以放这一处就够。 */
  try { switchStorageOwner(); } catch (e) { console.warn('[auth] 存储归属切换失败:', e); }
  /* R02：同步状态行也跟着身份走（未登录时隐藏 —— 那时谈"同步到云端"会误导） */
  try { renderSyncStatus(); } catch (_) {}
  const btn = $('#btn-auth');
  if (!btn) return;
  const u = state.user;
  if (u && !u.anonymous) {
    const name = (u.nickname || (u.phone ? phoneMask(u.phone) : (u.email ? String(u.email).split('@')[0] : '同学')));
    const initial = String(name).trim().charAt(0).toUpperCase() || '学';
    btn.className = 'user-chip';
    btn.innerHTML = '<span class="uc-av">' + esc(initial) + '</span>' +
      '<span class="uc-name">' + esc(name) + '</span>';
    btn.title = '已登录，点击管理账号与个人信息';
  } else {
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = '登录 / 注册';
    btn.title = '登录后，灵犀老师会跨课程记住你';
  }
}

/* 面板内的提示条 —— 唯一实现。
   原来有 6 份逐字相同的实现（auth / reset / acct / acct-phone / su-phone / gate），
   只有选择器不同。合并后改样式或加"自动消失"只需动这一处。
   这里保留 6 个函数声明（而不是 const），是为了不改变原有的提升语义。 */
function setMsg(sel, text, kind) {
  const el = $(sel);
  if (!el) return;
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'auth-msg ' + (kind === 'ok' ? 'ok' : 'err');
  el.textContent = text;
}
function authMsg(text, kind) { setMsg('#auth-msg', text, kind); }
function resetMsg(text, kind) { setMsg('#rs-msg', text, kind); }
function acctMsg(text, kind) { setMsg('#acct-msg', text, kind); }
function acctPhoneMsg(text, kind) { setMsg('#acct-phone-msg', text, kind); }
function phoneGateMsg(text, kind) { setMsg('#phone-gate-msg', text, kind); }
function suPhoneMsg(text, kind) { setMsg('#au-su-phone-msg', text, kind); }

/* 短信相关错误的语义化文案：不暴露"该手机号是否已注册" */
function smsErr(e) {
  const kind = e && e.kind;
  const raw = (e && e.message) || '';
  if (/not.*(support|enable)|unsupported|not enabled|disabled/i.test(raw)) {
    return '短信登录暂未开通，请改用邮箱登录';
  }
  if (kind === 'network' || kind === 'backend-unavailable') return '网络异常，请稍后重试';
  if (/frequen|too many|rate|限|频繁/i.test(raw)) return '发送过于频繁，请稍后再试';
  if (/expired|invalid.*code|验证码/i.test(raw)) return '验证码不正确或已过期';
  return authErr(e);
}

/* 手机号验证成功后的统一收尾：补齐 phone，拉记忆 */
async function signInFromPhone(u, phone) {
  setConsent(true);          // 用户已在勾选后完成验证，落库同意状态
  const box = $('#au-consent');
  if (box) box.checked = true;
  await onSignedIn(u ? { ...u, phone: u.phone || phone } : null);
  try { await seedProfileFromLocal(); } catch (_) {}
  /* ★ 2026-09-24 修：短信登录时这个号**已经被验证过了**，但门禁读的是
     档案里的 phone（state.mem.profile.phone），而登录只写了 state.user.phone ——
     结果用户会被再问一遍同一个号码（"我不是刚用这个号登录吗？"）。
     登录已验证的号，直接写进档案。 */
  try {
    const p = normalizeCNPhone(phone);
    if (p && !currentPhone() && memReady()) {
      await saveProfile({ phone: p });
      if (state.mem) { state.mem.profile = state.mem.profile || {}; state.mem.profile.phone = p; }
    }
  } catch (_) {}
}

/* 语义化 auth 错误：不暴露"该邮箱是否已注册" */
function authErr(e) {
  const kind = e && e.kind;
  const raw = (e && e.message) || '';
  if (kind === 'unauthenticated' || kind === 'invalid_grant') return '账号或密码不正确';
  if (kind === 'network' || kind === 'backend-unavailable') return '网络异常，请稍后重试';
  if (/rate|too many|频繁/i.test(raw)) return '操作过于频繁，请稍后再试';
  if (/expired|invalid.*code|验证码/i.test(raw)) return '验证码不正确或已过期';
  if (/password/i.test(raw) && /short|weak|least|length/i.test(raw)) return '密码至少 8 位，并包含字母和数字';
  return raw || '操作失败，请重试';
}

/* ── 登录门禁（2026-09-28，按产品要求）────────────────────────────
   要求原话：「**未登录不允许跑（跳出登录界面）**」。
   即：未登录时进来就弹登录界面，且**不允许绕过去使用**。

   为什么要有 state.loginGate 这个开关、而不是"直接把弹窗设成不可关"：
   同一个弹窗在两种场景下语义完全不同 ——
     · 用户主动点「登录 / 注册」（或课程列表里的登录链接）→ 是个**可关的**弹窗，点✕/点遮罩就该关掉；
     · 未登录进站被门禁拦住 → **必须登录**，关掉等于绕过门禁。
   所以用开关区分，而不是把关闭能力永远拿掉。

   同时要**堵掉三条绕过路径**：✕ 关闭、点遮罩关闭、以及「按访客继续」按钮
   （产品明确"没有游客模式"，这个后门必须隐藏 —— 只禁用不隐藏会让人以为还能用）。 */
let loginGateOn = false;
/* 门禁是否已"武装"（首次判定是否已完成）。init 之前为 false ——
   会话恢复期间 authUI() 会被调用，那时候不能弹窗，否则老用户刷新会看到登录界面闪一下。 */
let gateArmed = false;
function isSignedIn() { return !!(state.user && !state.user.anonymous); }

/* ============================================================
   内容存储的归属隔离（外部审查 R01，P1）
   ------------------------------------------------------------
   问题：课程 / 题库 / 导入前备份原先都存在**全局键**里，没有任何归属信息：
     · lingxi_courses_v1          ← 含学生提问、课堂回放
     · lingxi_question_bank_v1
     · lingxi_progress_pre_import
   同一台电脑上 A 退出、B 登录时，syncCourses() 会把**内存里 A 的课程**
   当作 B 的课程上传。云端 RLS 本身是对的（只能写自己的行），但它没法判断
   "这次写入的载荷属于谁" —— B 合法写自己的行时，RLS 没有理由拒绝。
   所以串数据**完全在客户端**，必须在这里修。共享电脑（家庭 / 学校）尤其明显。

   做法：内容类键加 `::<owner>` 后缀，身份一变就切换命名空间。
   ★ 偏好类键（主题 / 教学语言 / 语速 / 模型 / 形象）是"这台设备"的属性，
     **不隔离** —— 换个账号连主题都变掉反而更奇怪。

   owner 前缀用 `u_<userId>` / `guest`，**不用邮箱或手机号** ——
   键名在开发者工具里一眼可见，不该把 PII 写进去。
   ============================================================ */
const CONTENT_KEYS = {
  courses: 'lingxi_courses_v1',
  bank: 'lingxi_question_bank_v1',
  preImport: 'lingxi_progress_pre_import',
};
function storageOwnerKey() {
  const u = state.user;
  return (u && !u.anonymous && u.id) ? ('u_' + String(u.id)) : 'guest';
}
function scopedContentKey(base, owner) { return base + '::' + (owner || storageOwnerKey()); }

/* 读内容：**只读本账号命名空间**，读不到时不回落到别处 —— 那正是要修的缺陷。 */
function readContentRaw(base, fallbackRaw) {
  try {
    const v = localStorage.getItem(scopedContentKey(base));
    return v == null ? fallbackRaw : v;
  } catch (_) { return fallbackRaw; }
}
function writeContentRaw(base, raw) {
  try { localStorage.setItem(scopedContentKey(base), raw); return true; } catch (_) { return false; }
}

/* 旧版全局键的一次性认领。
   ★ 必须等身份确定（已登录）之后再认领：init 早期 state.user 还是 null，
     那时认领会把上一个账号留下的数据记到 guest 名下，真正的账号反而拿不到。
   ★ 认领后**立刻删掉旧键** —— 否则下一个登录的账号会再继承一次，等于没修。 */
let legacyContentClaimed = false;
function claimLegacyContent() {
  if (legacyContentClaimed) return;
  if (!isSignedIn()) return;
  legacyContentClaimed = true;
  Object.keys(CONTENT_KEYS).forEach((name) => {
    const base = CONTENT_KEYS[name];
    try {
      const legacy = localStorage.getItem(base);
      if (legacy == null) return;
      const k = scopedContentKey(base);
      if (localStorage.getItem(k) == null) localStorage.setItem(k, legacy);
      localStorage.removeItem(base);
    } catch (_) {}
  });
}

/* 身份变化时切换命名空间。挂在 authUI() 里 ——
   登录成功 / doSignOut / SIGNED_OUT / healSession 四条路径都会走到那里。 */
let activeStorageOwner = null;
function switchStorageOwner() {
  const next = storageOwnerKey();
  if (activeStorageOwner === next) { claimLegacyContent(); return; }
  const prev = activeStorageOwner;
  /* 先把**旧 owner 的**内容取出来（此刻 activeStorageOwner 还是 prev，读的就是旧键） */
  const prevBank = (prev === null) ? null : loadBank();
  const prevPreImport = (prev === null) ? null : readJson(CONTENT_KEYS.preImport, null);
  activeStorageOwner = next;
  claimLegacyContent();
  if (prev === null) return;                  // 首次只是记录，还没有"旧内容"要存回
  /* ① 内存里的内容属于 prev —— 存回 prev 的命名空间（期间的修改不能丢） */
  try {
    if (Array.isArray(state.courses) && state.courses.length) {
      localStorage.setItem(scopedContentKey(CONTENT_KEYS.courses, prev), JSON.stringify(state.courses));
    }
    if (prevBank && prevBank.length) {
      localStorage.setItem(scopedContentKey(CONTENT_KEYS.bank, prev), JSON.stringify(prevBank));
    }
    if (prevPreImport) {
      localStorage.setItem(scopedContentKey(CONTENT_KEYS.preImport, prev), JSON.stringify(prevPreImport));
    }
  } catch (_) {}
  /* ② 载入 next 的内容。★ 这一步必须**早于** syncCourses()，
        否则上传的还是上一个账号的课程（这正是 R01 的成因）。 */
  state.courses = [];
  loadCourses();
  try { renderCourses(); } catch (_) {}
  try { renderBank(); } catch (_) {}
}

/* 清掉**指定账号**留在本机的全部内容（注销用）。偏好类键不动 —— 那些不归账号管。 */
function clearContentForOwner(owner) {
  Object.keys(CONTENT_KEYS).forEach((name) => {
    try { localStorage.removeItem(scopedContentKey(CONTENT_KEYS[name], owner)); } catch (_) {}
  });
  /* ★ R02：待同步队列也归账号，注销时要一起清 ——
     留着的话，下次这个账号登录会去推一批早已删除的课程。 */
  try { localStorage.removeItem(syncQueueKey(owner)); } catch (_) {}
  try { localStorage.removeItem(SYNC_QUEUE_BASE); } catch (_) {}   // 旧版无归属的队列键
}

/* 清掉/恢复门禁态下的绕过入口可见性 */
function setGateBypassesHidden(hidden) {
  ['#au-skip', '#btn-auth-close'].forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = !!hidden;
  });
  const tip = $('#au-gate-tip');
  if (tip) tip.hidden = !hidden;      // 门禁态下显示"需要登录后才能使用"的说明
}

function openAuthModal() {
  const m = $('#auth-modal');
  if (!m) return;
  authMsg('');
  m.hidden = false;
  if (loginGateOn) setGateBypassesHidden(true);
  const e1 = $('#au-pw-email');
  if (e1) setTimeout(() => { try { e1.focus(); } catch (_) {} }, 60);
}
function closeAuthModal() {
  /* 门禁期间不允许关闭 —— 关掉就等于"未登录也能用"，与要求相反。
     （点击遮罩、按 Esc、点✕ 都会走到这里，一处拦住即可覆盖全部路径。） */
  if (loginGateOn && !isSignedIn()) return;
  const m = $('#auth-modal');
  if (m) m.hidden = true;
}

/* 登录成功后自动解除门禁，并恢复弹窗的正常关闭行为 */
function releaseLoginGate() {
  if (!loginGateOn) return;
  loginGateOn = false;
  setGateBypassesHidden(false);
}

/* ★ 2026-09-29 修（检查 agent 复查查出，P1）：
   原来 `enforceLoginGate()` 全仓库**只在 init() 里被调用一次**。
   后果：**登出之后门禁不再上锁** —— 用户点一次「退出登录」，就能在未登录状态下
   把整节课跑完，正好和「未登录不允许跑」相反。三条会失去登录态的路径全都没接上：
   `doSignOut()`、`onAuthStateChange('SIGNED_OUT')`、`healSession()` 凭据失效。
   改法：不再"启动时判一次"，而是**跟着身份走** —— 统一收口在 authUI()（上面三处都会调它），
   以后新增路径也不会漏。 */
function enforceLoginGate() {
  gateArmed = true;
  if (isSignedIn()) { releaseLoginGate(); return; }
  const already = loginGateOn;
  loginGateOn = true;
  setGateBypassesHidden(true);
  if (!already) openAuthModal();      // 已经锁着就别重复弹、重复抢焦点
}

/* 身份一变就同步门禁。首次判定（init）之前不动 —— 会话恢复是异步的，
   提前弹窗会让已登录用户在刷新时先看到一次登录界面。 */
function syncLoginGate() {
  if (!gateArmed) return;
  if (isSignedIn()) releaseLoginGate();
  else enforceLoginGate();
}

/* 门禁状态快照 —— 给测试用（行为断言要比"grep 源码里有没有 enforceLoginGate"可靠得多）。 */
function getGateState() {
  const m = $('#auth-modal');
  return {
    armed: !!gateArmed,
    on: !!loginGateOn,
    signedIn: isSignedIn(),
    modalOpen: !!(m && !m.hidden),
    skipHidden: !!($('#au-skip') || {}).hidden,
    closeHidden: !!($('#btn-auth-close') || {}).hidden,
    tipVisible: !!(($('#au-gate-tip') || {}).hidden === false),
  };
}

/* ★ 动作侧的硬校验（不只是 UI 遮住）。
   检查 agent 指出：门禁只靠"遮罩盖住按钮"，处理函数里没有任何校验 ——
   只要有一条路径能触发 click（脚本、快捷键、将来新增的入口），门禁就形同虚设。
   这里给"生成课程 / 进直播间"两个真正消耗算力的动作补上同一条判据。 */
function requireSignedIn() {
  if (isSignedIn()) return true;
  try { enforceLoginGate(); } catch (_) {}
  try { toast('请先登录后再开始上课', 'err'); } catch (_) {}
  return false;
}

function switchAuthTab(name) {
  $$('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.authTab === name));
  $$('.auth-pane').forEach((p) => p.classList.toggle('active', p.id === 'auth-pane-' + name));
  authMsg('');
  // 手机号页签：若环境尚未开通短信通道，明确告知并给出可用的替代路径
  if (name === 'phone' && state.smsReady === false) {
    authMsg('短信登录暂未开通，请使用「邮箱登录」或「注册」——记忆功能完全一致', 'err');
  }
  // 注册页签：回到"填邮箱"的初始状态，避免上次注册留下的收尾步骤残留
  if (name === 'signup') {
    const s2 = $('#au-su-step2'); if (s2) s2.hidden = true;
    const s3 = $('#au-su-step3'); if (s3) s3.hidden = true;
    suPhoneMsg('');
  }
}

/* ============================================================
   会话 / 用户对象的形状适配
   依据 SDK 源码，三种返回结构并不一致，必须归一后才能用：
   · getSession().data  = { accessToken, refreshToken, expiresAt,
                            user: { id, isAnonymous, raw } }   ← user 里没有 email / phone
   · signInWithPassword / verifyOtp / signUp 的 .data 就是同一个 session 对象，
     用户位于 data.user（不存在 data.session.user）
   · getUser().data     = { id, email, phone, isAnonymous, raw } ← 唯一带 email/phone 的来源
   ============================================================ */
function pickUser(src) {
  if (!src) return null;
  const u = src.user || (src.session && src.session.user) || (src.id || src.sub ? src : null);
  if (!u) return null;
  const raw = u.raw || {};
  const meta = u.user_metadata || {};
  const id = u.id || raw.sub || raw.uid || '';
  if (!id) return null;
  const rawPhone = u.phone || raw.phone_number || raw.phone || '';
  return {
    id: String(id),
    email: u.email || raw.email || meta.email || null,
    // 统一归一化：SDK 给的是 "+86 13800138000"，前端一律存本地 11 位形式，
    // 这样掩码、去重、提示文案三处用的是同一个值
    phone: normalizeCNPhone(rawPhone) || rawPhone || null,
    nickname: u.nickname || meta.nickname || null,
    anonymous: u.isAnonymous === true || u.anonymous === true,
  };
}

/* 取当前登录用户的权威资料：先 getUser（带 email/phone），不可用再退回 getSession */
async function fetchAuthUser() {
  const auth = state.cloud && state.cloud.auth;
  if (!auth) return null;
  try {
    const res = await auth.getUser();
    if (res && !res.error) { const u = pickUser(res.data); if (u) return u; }
  } catch (_) { /* 旧版 SDK / 测试桩没有 getUser 时静默退回 */ }
  try {
    const res = await auth.getSession();
    return pickUser(res && res.data);
  } catch (_) { return null; }
}

/* 合并新旧用户对象：不让降级对象（缺 email/phone）覆盖掉已拿到的完整资料 */
/* 合并用户资料。
   ★ 2026-09-24 修 P0「进入直播间丢登录态」：
   原实现在 id 不同时直接 `return next` —— 而 SDK 会发出**匿名会话**事件
   （实测访客 uid 是字符串 'anon'），它的 id 与真实用户不同，
   于是真实登录态被匿名会话整个顶掉，表现就是"一进直播间就退出登录了"。
   进课堂会立刻发一次 AI 请求，正是这个事件容易到达的时机。
   原则：**匿名会话永远不能覆盖已登录的真实账号**；反之（匿名→真实）必须换。 */
function mergeUser(prev, next) {
  if (next && next.anonymous && prev && !prev.anonymous) return prev;   // 匿名不许顶掉真实账号
  if (!prev || !next || prev.id !== next.id) return next || prev || null;
  const out = { ...prev };
  Object.keys(next).forEach((k) => {
    if (next[k] == null) return;
    // 同一账号也不允许把 anonymous 从 false 翻成 true
    if (k === 'anonymous' && prev.anonymous === false && next[k] === true) return;
    out[k] = next[k];
  });
  return out;
}

/* 登录成功后的统一收尾：刷新 UI + 拉取记忆 */
async function onSignedIn(user) {
  let u = pickUser(user);
  // 兜底：登录接口只回 session（无 email/phone）时，再取一次权威资料；取不到才算失败
  if (!u || !u.email) {
    const full = await fetchAuthUser();
    u = mergeUser(u, full) || full || u;
  }
  if (!u) { authMsg('登录状态异常，请重试'); return; }
  state.user = mergeUser(state.user, u);
  state.memLoaded = false;
  authUI();
  closeAuthModal();
  toast('已登录，灵犀老师会一直记得你', 'ok');
  try {
    await loadMemory(true);
    renderMemoryView();
    await syncCourses();
  } catch (_) {}
  flushPendingTracks();     // 补报注册环节（登录前）攒下的风控事件
  // 设备归属：登录成功即把本设备登记到该账号名下（'taken' = 设备已被别的账号占用，
  // 共享设备场景下不拦登录，只提示 + 留风控记录）
  try {
    const claimed = await deviceClaim();
    if (claimed === 'taken') {
      toast('提示：这台设备上已有另一个账号，请确认你用的是自己的账号', 'err');
    }
  } catch (_) {}
}

  async function doSignOut() {
    /* ★ 2026-09-27 修（代码审计查出）：这里原来是 `try { await signOut(); } catch (_) {}` ——
       登出请求失败被**静默吞掉**，而下面**无条件**清空本地状态、并无条件提示「已退出登录」。
       于是用户被告知一件可能没发生的事：服务端的会话可能仍然有效，
       下次打开页面"莫名又登录回来" —— 看起来登出了，其实没有。

       改法：本地状态**照清**（用户点的是登出，不该因为网络问题把他卡在登录态），
       但**不再假装成功** —— 失败就如实说，并留下埋点。
       （服务端若确实已登出，onAuthStateChange 的 SIGNED_OUT 稍后也会同步，两条路不冲突。） */
    let serverOk = true;
    if (state.cloud && state.cloud.auth) {
      try { await state.cloud.auth.signOut(); }
      catch (e) {
        serverOk = false;
        try { console.warn('[auth] 登出请求失败:', (e && e.message) || e); } catch (_) {}
        try { track('signout_server_failed', { msg: String((e && e.message) || '').slice(0, 60) }); } catch (_) {}
      }
    }
    state.user = null;
    state.mem = null;
    state.memLoaded = false;
    authUI();
    renderMemoryView();
    if (serverOk) toast('已退出登录，老师暂时不记得你了');
    else toast('本机已清除登录信息，但登出没能通知服务器 —— 建议联网后重试一次', 'err');
  }

/* 会话恢复 + 登录态监听 */
async function initAuth() {
  if (!state.cloud || !state.cloud.auth) { renderMemoryView(); return; }
  const auth = state.cloud.auth;

  try {
    // getSession 的 user 不含 email/phone，必须用 getUser 补齐，否则刷新后账号资料会丢
    const u = await fetchAuthUser();
    if (u) state.user = mergeUser(state.user, u);
  } catch (e) { console.warn('[auth] 会话恢复失败:', e); }
  authUI();

  try {
    auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        state.user = null; state.mem = null; state.memLoaded = false;
        authUI(); renderMemoryView();
      } else if (session && session.user) {
        // 事件里拿到的是 session.user（只有 id），合并保留已有的 email/phone
        const u = pickUser(session);
        // ★ 匿名会话事件不要动已有登录态（详见 mergeUser 的注释：
        //   SDK 的访客会话会把真实用户顶掉，表现为"进直播间就退出登录"）
        if (u && u.anonymous && state.user && !state.user.anonymous) return;
        if (u) {
          state.user = mergeUser(state.user, u);
          authUI();
          // ★ 登录成功 → 解除登录门禁，登录界面恢复成"可关闭的普通弹窗"
          if (isSignedIn()) { releaseLoginGate(); try { closeAuthModal(); } catch (_) {} }
          // 资料不完整时异步补一次，不阻塞回调
          if (!state.user.email && !state.user.phone) {
            fetchAuthUser().then((full) => {
              if (full) { state.user = mergeUser(state.user, full); authUI(); }
            }).catch(() => {});
          }
        }
      }
    });
  } catch (e) { console.warn('[auth] onAuthStateChange 失败:', e); }

  if (state.user) {
    try { await loadMemory(true); } catch (_) {}
    try { await syncCourses(); } catch (_) {}
  }
  renderMemoryView();
}

/* 访客模式：不建任何本地假身份，只是明确"不启用记忆" */
function continueAsGuest() {
  closeAuthModal();
  toast('已按访客继续，老师不会跨课程记住你');
}

function bindAuthEvents() {
  const btnAuth = $('#btn-auth');
  if (btnAuth) btnAuth.addEventListener('click', () => {
    if (isSignedIn()) {
      if (window.confirm('要退出登录吗？退出后灵犀老师将暂时不再跨课程记住你（记忆仍在云端，重新登录即可恢复）。')) doSignOut();
    } else {
      openAuthModal();
    }
  });
  /* 登录界面上的"先测一下设备能不能出声"：设备/音量/静音开关的问题与账号无关，
     让用户在还没登录时就能先确认，省得登录后才发现没声音又回头怀疑产品。
     它只做一次本地发声实测，不提供任何产品功能，不构成绕过登录门禁。 */
  const auSound = $('#au-soundtest');
  if (auSound && !auSound._bound) {
    auSound._bound = true;
    auSound.addEventListener('click', (ev) => {
      ev.preventDefault();
      /* ★ 2026-09-29 修（检查 agent 复查查出，P1）：
         原来这里把课堂的 #tts-notice 用 appendChild **搬**进登录弹窗。
         appendChild 是移动不是复制 —— 搬走之后课堂里那块常驻的「老师的声音没出来」
         提示（含自检 / 再试一次 / ✕ 三个按钮）就永远回不到 #live-room 了，
         而 #live-room 全程只切 hidden、从不重建。等于"用户在登录页点过一次试音，
         之后在课堂里再也看不到那条提示"。
         改成就地渲染：结果直接落进登录界面自己的容器，课堂那块一个字节都不动。 */
      const box = $('#au-soundtest-box');
      if (box) { box.hidden = false; try { box.scrollIntoView({ block: 'nearest' }); } catch (_) {} }
      runTTSSelfCheck('auth');
    });
  }
  const c1 = $('#btn-auth-close');
  if (c1) c1.addEventListener('click', closeAuthModal);
  const c2 = $('#au-skip');
  if (c2) c2.addEventListener('click', continueAsGuest);
  const am = $('#auth-modal');
  if (am) am.addEventListener('click', (ev) => { if (ev.target === am) closeAuthModal(); });

  $$('.auth-tab').forEach((t) => t.addEventListener('click', () => switchAuthTab(t.dataset.authTab)));

  const A = () => state.cloud && state.cloud.auth;

  // —— 手机号登录 / 注册（走 SDK 的 phone 通道）——
  const phSend = $('#au-ph-send');
  if (phSend) phSend.addEventListener('click', async () => {
    if (!requireConsent()) return;
    const raw = ($('#au-ph-phone').value || '').trim();
    const phone = normalizeCNPhone(raw);
    if (!phone) return authMsg('请输入正确的 11 位中国大陆手机号');
    if (!A()) return authMsg('云服务未连接，请刷新页面重试');
    phSend.disabled = true; phSend.textContent = '发送中…';
    try {
      // 必须用 signInWithOtp：它的返回值带 verify 闭包；sendOtp 只返回裸 verificationId
      const sent = await A().signInWithOtp({ phone });
      if (sent.error) {
        // 渠道未开通时记下来：切回手机号页签时能给出明确指引，而不是让用户反复试
        if (/not.*(support|enable)|unsupported|not enabled|disabled/i.test((sent.error && sent.error.message) || '')) {
          state.smsReady = false;
        }
        authMsg(smsErr(sent.error)); return;
      }
      state.smsReady = true;
      window.__phHandle = sent.data;
      $('#au-ph-step2').hidden = false;
      const tip = $('#au-ph-tip');
      if (tip) tip.textContent = '验证码已发送至 ' + phoneMask(phone) + '，5 分钟内有效。';
      authMsg(sent.data && sent.data.isExistingUser ? '验证码已发送，欢迎回来' : '验证码已发送，完成验证后将为你创建账号', 'ok');
    } catch (e) { authMsg(smsErr(e)); }
    finally { phSend.disabled = false; phSend.textContent = '重新获取验证码'; }
  });

  const phSubmit = $('#au-ph-submit');
  if (phSubmit) phSubmit.addEventListener('click', async () => {
    if (!requireConsent()) return;
    const phone = normalizeCNPhone(($('#au-ph-phone').value || '').trim());
    const token = ($('#au-ph-code').value || '').trim();
    if (!phone) return authMsg('请输入正确的手机号');
    if (!token) return authMsg('请填写短信验证码');
    if (!window.__phHandle) return authMsg('请先获取短信验证码');
    if (!A()) return authMsg('云服务未连接，请刷新页面重试');
    phSubmit.disabled = true; phSubmit.textContent = '验证中…';
    try {
      // 复用 signInWithOtp 返回的 verify 闭包：它会按 isExistingUser 自动走登录或注册
      const done = await window.__phHandle.verify({ token });
      if (done.error) { authMsg(smsErr(done.error)); return; }
      await signInFromPhone(pickUser(done.data), phone);
    } catch (e) { authMsg(smsErr(e)); }
    finally { phSubmit.disabled = false; phSubmit.textContent = '登录 / 注册'; }
  });

  // —— 邮箱密码登录 ——
  const pw = $('#au-pw-submit');
  if (pw) pw.addEventListener('click', async () => {
    if (!requireConsent()) return;
    const email = ($('#au-pw-email').value || '').trim();
    const password = $('#au-pw-pass').value || '';
    if (!email || !password) return authMsg('请填写邮箱和密码');
    if (!A()) return authMsg('云服务未连接，请刷新页面重试');
    pw.disabled = true; pw.textContent = '登录中…';
    try {
      const { data, error } = await A().signInWithPassword({ email, password });
      if (error) { authMsg(authErr(error)); return; }
      // 注意：返回的 data 本身就是 session（用户位于 data.user），不是 data.session.user
      await onSignedIn(pickUser(data));
    } catch (e) { authMsg(authErr(e)); }
    finally { pw.disabled = false; pw.textContent = '登录'; }
  });

  // —— 验证码登录 ——
  const otpSend = $('#au-otp-send');
  if (otpSend) otpSend.addEventListener('click', async () => {
    if (!requireConsent()) return;
    const email = ($('#au-otp-email').value || '').trim();
    if (!email) return authMsg('请填写邮箱');
    if (!A()) return authMsg('云服务未连接，请刷新页面重试');
    otpSend.disabled = true; otpSend.textContent = '发送中…';
    try {
      const started = await A().signInWithOtp({ email });
      if (started.error) { authMsg(authErr(started.error)); return; }
      window.__otpHandle = started.data;
      $('#au-otp-step2').hidden = false;
      authMsg('验证码已发送，请查收邮件（含垃圾箱）', 'ok');
    } catch (e) { authMsg(authErr(e)); }
    finally { otpSend.disabled = false; otpSend.textContent = '重新发送验证码'; }
  });
  const otpVerify = $('#au-otp-verify');
  if (otpVerify) otpVerify.addEventListener('click', async () => {
    const token = ($('#au-otp-code').value || '').trim();
    if (!token) return authMsg('请填写验证码');
    if (!window.__otpHandle) return authMsg('请先获取验证码');
    otpVerify.disabled = true; otpVerify.textContent = '验证中…';
    try {
      const done = await window.__otpHandle.verify({ token });
      if (done.error) { authMsg(authErr(done.error)); return; }
      await onSignedIn(pickUser(done.data));
    } catch (e) { authMsg(authErr(e)); }
    finally { otpVerify.disabled = false; otpVerify.textContent = '验证并登录'; }
  });

  // —— 注册（OTP 验证 + 设置密码）——
  const suSend = $('#au-su-send');
  if (suSend) suSend.addEventListener('click', async () => {
    if (!requireConsent()) return;
    const email = ($('#au-su-email').value || '').trim();
    if (!email) return authMsg('请填写邮箱');
    if (!A()) return authMsg('云服务未连接，请刷新页面重试');
    suSend.disabled = true; suSend.textContent = '发送中…';
    try {
      // ① 一次性邮箱：抬高批量开小号的成本（在设备检查之前，因为它更快也更常见）
      if (isThrowawayMail(email)) {
        trackLater('mail_blocked', { domain: String(email).split('@').pop().slice(0, 40) });
        authMsg('请使用常用邮箱注册（这个域名属于一次性邮箱，课程记录与它绑定，收不到后续通知）。学校或企业邮箱都可以。');
        return;
      }
      // ② 设备闸门：这台设备已经注册过账号 → 不再允许开新账号（服务端判定，客户端绕不过）
      const used = await deviceAlreadyUsed();
      if (used) {
        // 顺序要紧：switchAuthTab 内部会 authMsg('') 清空提示，
        // 先切页签再给提示，否则用户只看到"莫名跳转"、看不到原因
        switchAuthTab('password');
        const pe0 = $('#au-pw-email');
        if (pe0) pe0.value = email;
        authMsg('这台设备已经注册过账号了。请用原账号登录；如果原账号进不去，请点下面的「忘记密码」找回。');
        return;
      }
      const sent = await A().sendOtp({ email });
      if (sent.error) { authMsg(authErr(sent.error)); return; }
      // 已是老用户：不暴露账号存在性，引导到登录
      if (sent.data.isExistingUser) {
        authMsg('这个邮箱已有账号，请直接登录（已切到密码登录）', 'ok');
        switchAuthTab('password');
        const pe = $('#au-pw-email');
        if (pe) pe.value = email;
        return;
      }
      window.__suHandle = sent.data;
      $('#au-su-step2').hidden = false;
      authMsg('验证码已发送，请查收邮件', 'ok');
    } catch (e) { authMsg(authErr(e)); }
    finally { suSend.disabled = false; suSend.textContent = '重新发送验证码'; }
  });
  const suSubmit = $('#au-su-submit');
  if (suSubmit) suSubmit.addEventListener('click', async () => {
    const token = ($('#au-su-code').value || '').trim();
    const password = $('#au-su-pass').value || '';
    const email = ($('#au-su-email').value || '').trim();
    if (!token) return authMsg('请填写验证码');
    if (!password || password.length < 8) return authMsg('密码至少 8 位，并包含字母和数字');
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return authMsg('密码需同时包含字母和数字');
    if (!window.__suHandle) return authMsg('请先获取验证码');
    suSubmit.disabled = true; suSubmit.textContent = '注册中…';
    try {
      const done = await A().verifyOtp({
        verificationId: window.__suHandle.verificationId,
        token,
        email,
        isExistingUser: false,
        password,
      });
      if (done.error) { authMsg(authErr(done.error)); return; }
      const u = pickUser(done.data);
      await onSignedIn(u ? { ...u, nickname: u.nickname || String(email).split('@')[0] } : null);
      try { await seedProfileFromLocal(); } catch (_) {}
      // 注册成功 → 把本设备登记到这个账号名下（此后这台设备不能再注册新账号）
      const claimed = await deviceClaim();
      if (claimed === 'taken') {
        // 同一设备已有别的账号：不阻止新账号，但要让用户知道，并留下风控记录
        track('device_conflict', { at_register: 1 });
      }
      // 注册成功 → 收尾一步：登记手机号（可跳过）。账号已建好，这一步失败不影响注册结果
      if (memReady() && !currentPhone()) {
        $('#au-su-step2').hidden = true;
        const step3 = $('#au-su-step3');
        if (step3) step3.hidden = false;
        suPhoneMsg('');
      } else {
        authMsg('注册成功，已自动登录', 'ok');
      }
    } catch (e) { authMsg(authErr(e)); }
    finally { suSubmit.disabled = false; suSubmit.textContent = '注册并登录'; }
  });

  // —— 忘记密码 ——
  const forgot = $('#au-forgot');
  if (forgot) forgot.addEventListener('click', () => {
    closeAuthModal();
    resetMsg('');
    const rm = $('#reset-modal');
    if (rm) rm.hidden = false;
    const e = $('#rs-email');
    if (e) e.value = ($('#au-pw-email').value || '').trim();
  });
  const rc = $('#btn-reset-close');
  if (rc) rc.addEventListener('click', () => { const m = $('#reset-modal'); if (m) m.hidden = true; });
  const rmm = $('#reset-modal');
  if (rmm) rmm.addEventListener('click', (ev) => { if (ev.target === rmm) rmm.hidden = true; });

  const rsSend = $('#rs-send');
  if (rsSend) rsSend.addEventListener('click', async () => {
    const email = ($('#rs-email').value || '').trim();
    if (!email) return resetMsg('请填写邮箱');
    if (!A()) return resetMsg('云服务未连接，请刷新页面重试');
    rsSend.disabled = true; rsSend.textContent = '发送中…';
    try {
      const started = await A().resetPasswordForEmail(email);
      if (started.error) { resetMsg(authErr(started.error)); return; }
      window.__rsHandle = started.data;
      $('#rs-step2').hidden = false;
      resetMsg('验证码已发送，请查收邮件', 'ok');
    } catch (e) { resetMsg(authErr(e)); }
    finally { rsSend.disabled = false; rsSend.textContent = '重新发送验证码'; }
  });
  const rsSubmit = $('#rs-submit');
  if (rsSubmit) rsSubmit.addEventListener('click', async () => {
    const nonce = ($('#rs-code').value || '').trim();
    const password = $('#rs-pass').value || '';
    if (!nonce) return resetMsg('请填写验证码');
    if (!password || password.length < 8) return resetMsg('新密码至少 8 位，并包含字母和数字');
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return resetMsg('新密码需同时包含字母和数字');
    if (!window.__rsHandle) return resetMsg('请先获取验证码');
    rsSubmit.disabled = true; rsSubmit.textContent = '提交中…';
    try {
      const done = await window.__rsHandle.updateUser({ nonce, password });
      if (done.error) { resetMsg(authErr(done.error)); return; }
      const m = $('#reset-modal'); if (m) m.hidden = true;
      toast('密码已重置并登录', 'ok');
      await onSignedIn(await fetchAuthUser());
    } catch (e) { resetMsg(authErr(e)); }
    finally { rsSubmit.disabled = false; rsSubmit.textContent = '重置密码并登录'; }
  });
}

/* 首次登录时，用本机已有课程把画像填个初值（只在画像为空时执行） */
async function seedProfileFromLocal() {
  if (!memReady()) return;
  const m = await loadMemory(true);
  if (m && m.profile) return;   // 已有画像，不覆盖
  const last = (state.courses && state.courses.length) ? state.courses[state.courses.length - 1] : null;
  if (!last) return;
  await saveProfile({
    grade: last.grade || null,
    system: last.systemName || null,
    goal: last.goal || null,
    level: last.level || null,
    teaching_style: guideProfile().name,
    pace: '默认',
  });
}


/* ============================================================
   账号与个人信息（PIPL 权利落地）
   查阅 / 复制 / 更正 / 删除 / 注销 —— 全部在界面内可自助完成
   ============================================================ */

function openAccountModal() {
  const m = $('#account-modal');
  if (!m) return;
  acctMsg('');
  const u = state.user || {};
  const idEl = $('#acct-ident');
  if (idEl) {
    // 只显示脱敏后的账号标识，避免完整手机号/邮箱出现在界面上被旁人看到
    idEl.textContent = u.phone ? phoneMask(u.phone) : (u.email ? String(u.email).replace(/^(.{1,2}).*(@.*)$/, '$1***$2') : '—');
  }
  const memEl = $('#acct-mem');
  if (memEl) {
    const f = (state.mem && Array.isArray(state.mem.facts)) ? state.mem.facts.length : 0;
    const s = (state.mem && Array.isArray(state.mem.sessions)) ? state.mem.sessions.length : 0;
    memEl.textContent = f + ' 条记忆 · ' + s + ' 节课记录';
  }
  renderAcctPhone();
  const phoneForm = $('#acct-phone-form');
  if (phoneForm) phoneForm.hidden = true;
  acctPhoneMsg('');
  m.hidden = false;
}
function closeAccountModal() { const m = $('#account-modal'); if (m) m.hidden = true; }

/* 导出：把云端 + 本机属于本人的全部数据打包成 JSON 交给用户（PIPL 查阅复制权） */
async function exportMyData() {
  if (!state.user) { acctMsg('请先登录'); return; }
  acctMsg('正在整理你的数据…', 'ok');
  const out = {
    exportedAt: new Date().toISOString(),
    legalVersion: LEGAL_VERSION,
    account: { id: state.user.id, phone: state.user.phone || null, email: state.user.email || null },
    memory: {},
    localCourses: [],
  };
  try {
    const m = await loadMemory(true);
    out.memory = {
      profile: (m && m.profile) || null,
      facts: (m && m.facts) || [],
      sessions: (m && m.sessions) || [],
    };
  } catch (e) { out.memory = { error: String(e && e.message || e) }; }

  try {
    out.localCourses = (state.courses || []).map((c) => ({
      id: c.id, title: c.title, subject: c.subject, grade: c.grade,
      system: c.systemName, createdAt: c.createdAt,
      outline: c.outline || null, slides: c.slides || [],
    }));
  } catch (_) {}

  try {
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lingxi-my-data-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    acctMsg('已导出，请查看下载文件', 'ok');
  } catch (e) {
    acctMsg('导出失败，请稍后重试');
  }
}

/* 注销：删除云端全部个人数据 + 本机该账号的全部内容。
   ★ 外部审查 R04（P1）修了什么：
     ① 云端删除列表原来只有 student_facts / student_sessions / student_profiles，
        **遗漏了 courses**（课程与课堂回放就存在那里）和 **analytics_events**（埋点）。
        于是"全部个人数据已删除"这句话是假的 —— 同一登录方式再登录，云端课程会重新下载。
        现在按"代码里实际用到的全部表"逐个删（见 CLOUD_USER_TABLES）。
     ② 本机只清了课程键，**题库与导入前备份都还在**。现在按账号命名空间整体清。
     ③ 原来是"删失败也照样提示成功"。现在逐个重试一次，仍失败就**不谎报成功**，
        并且**不把用户登出**（登出后就没有会话可以重试了），把还剩哪些数据如实说出来。 */
const CLOUD_USER_TABLES = [
  { t: 'student_facts', label: '老师记住的事' },
  { t: 'student_sessions', label: '上课记录' },
  { t: 'student_profiles', label: '学生画像' },
  { t: 'courses', label: '课程与课堂回放' },
  { t: 'analytics_events', label: '使用埋点' },
];

async function deleteMyAccount() {
  if (!state.user) { acctMsg('请先登录'); return; }
  const ok1 = window.confirm(
    '⚠️ 注销将永久删除以下数据，且不可恢复：\n\n' +
    '· 学生画像与全部「老师记住的事」\n' +
    '· 全部上课记录与课堂回放\n' +
    '· 全部课程（含课件与你的提问）\n' +
    '· 本机的课程、题库与导入前备份\n' +
    '· 使用埋点\n\n' +
    '（设备与手机号的风控台账会按平台合规要求保留，不含你的学习内容。）\n\n' +
    '注销后仍可用同一登录方式重新登录，但那将是一个没有任何学习记录的空白账号。\n' +
    '如需连同登录方式本身一并删除，请在注销后联系我们。\n\n' +
    '确定要继续吗？'
  );
  if (!ok1) return;
  const typed = window.prompt('请输入「确认注销」四个字以最终确认：');
  if (typed !== '确认注销') { acctMsg('输入不匹配，已取消注销'); return; }

  acctMsg('正在删除你的数据…', 'ok');
  const db = state.cloud && state.cloud.database;
  const owner = state.user.id;
  const failed = [];

  if (db) {
    for (const item of CLOUD_USER_TABLES) {
      let done = false, lastErr = '';
      /* 每个表重试一次：网络抖动不该让用户看到"部分删除"这种半吊子结果 */
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try {
          const res = await db.from(item.t).delete().eq('owner_id', owner).select('id');
          if (res && res.error) lastErr = res.error.message || 'error';
          else done = true;
        } catch (e) { lastErr = (e && e.message) || String(e); }
      }
      if (!done) failed.push(item.label + '（' + item.t + '）' + (lastErr ? '：' + lastErr : ''));
    }
  } else {
    failed.push('云端未连接 —— 一条都没删成');
  }

  if (failed.length) {
    /* 云端没删干净 → 本机内容**先不删**，也**不登出**：
       本机删了、云端还在，用户下次登录又会看到，只会更混乱；
       不登出才留着会话让他能重试。 */
    acctMsg('部分数据删除失败，已保留本机数据与会话以便重试', 'err');
    toast('注销未完成：还有 ' + failed.length + ' 项没删掉，请重试', 'err');
    try { console.warn('[account] 删除失败明细:', failed); } catch (_) {}
    return;
  }

  // 云端干净了 —— 再清本机该账号的全部内容（课程 / 题库 / 导入前备份）
  clearContentForOwner(owner);
  state.courses = [];
  try { renderCourses(); } catch (_) {}
  try { renderBank(); } catch (_) {}

  // 撤销同意标记
  setConsent(false);

  try { await state.cloud.auth.signOut(); } catch (_) {}
  state.user = null; state.mem = null; state.memLoaded = false;
  authUI(); renderMemoryView();
  closeAccountModal();
  toast('账号已注销，云端与本机的个人数据都已删除', 'ok');
}


/* 协议 / 政策 / 账号面板的事件绑定 */
/* ============================================================
   手机号登记（应用层）
   平台侧边界（2026-09-24 更新）：SDK 没有"绑定"类方法，且 signUp 明确拒绝
   "email and phone number can not be set and same time" —— 邮箱账号无法
   真正**绑定**手机号到登录凭据。
   注意：早先探测结论"没有可用的短信校验通道"**已经过时** ——
   `/.cloud/auth/v1/verification` 现在可用（返回 verificationId + verify 闭包），
   所以「手机号登录」是真实可用的，不要误删。
   但"档案里登记的手机号"仍是**声明式**的：登记流程本身不校验短信，
   界面上必须写明未验证的事实，写入走 RLS，只有本人能读改。
   ============================================================ */
function currentPhone() {
  const p = state.mem && state.mem.profile && state.mem.profile.phone;
  return normalizeCNPhone(p || '') || '';
}

/* ============================================================
   一次性邮箱拦截（注册环节）
   目的：抬高"批量开小号"的成本 —— 匿名邮箱是重复注册最常见的入口。
   原则：
     · 只匹配 @ 后面的域名，且以**明确的域名清单**为准，不用 'mail' 这类宽泛词，
       避免把 gmail / outlook / 学校邮箱误伤。
     · 明确告知理由，不静默失败；提示里给出替代方案。
     · 这是启发式，不是权威判定：名单可维护，遇到误伤就加白名单。
   ============================================================ */
const THROWAWAY_MAIL_DOMAINS = [
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'guerrillamail.com', 'guerrillamail.net',
  'sharklasers.com', 'grr.la', 'mailinator.com', 'mailinator.net', 'tempmail.com', 'tempmail.net',
  'temp-mail.org', 'temp-mail.io', 'throwawaymail.com', 'yopmail.com', 'yopmail.fr', 'trashmail.com',
  'trashmail.de', 'maildrop.cc', 'getnada.com', 'nada.email', 'dispostable.com', 'mailnesia.com',
  'fakeinbox.com', 'mytemp.email', 'mohmal.com', 'spam4.me', 'tempr.email', 'discard.email',
  'emailondeck.com', 'linshiyouxiang.net', '24mail.chacuo.net', 'eyunbk.com', 'snapmail.cc',
  'mailcatch.com', 'mailsac.com', 'inboxkitten.com', 'burnermail.io', 'tempinbox.com',
  'email-temp.com', 'luxusmail.org', 'mail7.io', 'vomoto.com', 'zippymail.info',
];
/* 明确的白名单：即使命中关键词也放行（学校/企业邮箱常见形态） */
const MAIL_ALLOWLIST = ['stu.', 'student.', 'edu.', 'ac.', 'school.', 'mail.tsinghua', 'pku.edu'];

/* 命中返回 true（说明原因供埋点用） */
function isThrowawayMail(email) {
  const s = String(email || '').toLowerCase().trim();
  const at = s.lastIndexOf('@');
  if (at < 0) return false;
  const domain = s.slice(at + 1);
  if (!domain) return false;
  if (MAIL_ALLOWLIST.some((w) => domain.indexOf(w) === 0 || domain.indexOf('.' + w) >= 0)) return false;
  if (THROWAWAY_MAIL_DOMAINS.indexOf(domain) >= 0) return true;
  // 子域形式，如 xxx.mailinator.com
  return THROWAWAY_MAIL_DOMAINS.some((d) => domain.length > d.length && domain.slice(-(d.length + 1)) === '.' + d);
}

/* ============================================================
   手机号共用检测（服务端计数，不做拦截）
   为什么只检测不拦：登记流程本身不做短信校验 → 号码只是声明，拦不住故意乱填；
   而家长用一个号给两个孩子登记是**正当场景** —— 拦了就是误伤。
   所以：识别 + 如实告知 + 留下可统计的风控记录。
   隐私最小化：只把**加盐 SHA-256 哈希**送到服务端，服务端不接触明文号码。
   ============================================================ */
/* 无 crypto.subtle 时的确定性兜底哈希（8 路 FNV-1a，输出 64 hex，形状与 SHA-256 对齐）。
   注意：这是**非加密**哈希，只用于"同一号码是否重复"的去重统计，不做安全用途。
   它与 SHA-256 的结果不互通 —— 极端情况下同一号码在不同环境会算出两种哈希，
   统计上可能分裂，但不会误判（不同号码的哈希仍然不同）。站点是 HTTPS（安全上下文），
   实际都会走 SHA-256；兜底只是不让功能静默失效。 */
function fallbackPhoneHash(s) {
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0x2545f491];
  return seeds.map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h = (h ^ (s.length + seed)) >>> 0;
    h = Math.imul(h, 2246822519) >>> 0;
    return h.toString(16).padStart(8, '0');
  }).join('');
}

async function phoneHash(p) {
  const s = 'lingxi-phone-v1|' + String(p || '');
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (_) { /* 落到兜底 */ }
  try { return fallbackPhoneHash(s); } catch (_) { return ''; }
}

/* 返回 'ok' 首次 | 'shared' 该号码已在别的账号登记过 | 'skip' 未登录/失败 */
async function phoneClaim(p) {
  if (!memReady() || !p) return 'skip';
  if (!state.cloud || !state.cloud.database) return 'skip';
  const h = await phoneHash(p);
  if (!h) return 'skip';
  try {
    const r = await state.cloud.database.rpc('phone_claim', { h });
    if (r && r.error) return 'skip';
    const status = r && r.data;
    if (status === 'shared') track('phone_shared', {});
    return status || 'skip';
  } catch (_) { return 'skip'; }
}

/* 把手机号写进本人档案。返回 {ok:phone} 或 {error:文案} */
async function registerPhone(rawPhone, { emptyText } = {}) {
  if (!memReady()) return { error: '请先登录后再登记手机号' };
  const raw = String(rawPhone || '').trim();
  if (!raw) return { error: emptyText || '请填写手机号' };
  const p = normalizeCNPhone(raw);
  if (!p) return { error: '请输入正确的 11 位中国大陆手机号' };
  if (p === currentPhone()) return { ok: p, unchanged: true };
  const saved = await saveProfile({ phone: p });
  if (!saved) return { error: '保存失败，请检查网络后重试' };
  if (state.mem) {
    if (state.mem.profile) state.mem.profile.phone = p;
    else state.mem.profile = { phone: p };
  }
  track('phone_register', { phone_masked: phoneMask(p) });
  // 共用检测：不拦，但如实告知（家长共用同一号码是正当场景）
  const claim = await phoneClaim(p);
  return { ok: p, shared: claim === 'shared' };
}

/* 账号弹窗里的手机号展示 */
function renderAcctPhone() {
  const el = $('#acct-phone-val');
  if (!el) return;
  const p = currentPhone();
  el.textContent = p ? phoneMask(p) : '未登记';
  const edit = $('#btn-acct-phone-edit');
  if (edit) edit.textContent = p ? '修改手机号' : '登记手机号';
}

/* ============================================================
   手机号门禁（2026-09-24 起：邮箱注册保留，登记手机号改为要求）
   产品理由：档案里的手机号是**声明式**的联系方式（登记流程不做短信校验；
   短信验证码只用于「手机号登录」那条路径）；
   但它是"课后联系家长/学生"与"账号找回"的唯一现实通道，所以设为开课前置条件。
   设计取舍：
     · 门禁只拦**核心消费动作**（生成课程方案、进入直播间），浏览/回看/档案不受限 ——
       否则新用户第一步就被拦住，直接流失。
     · 给一条**人工出路**（"我没有手机号"）：不是静默跳过，而是提示联系人工核对。
       硬性拦死会把没有手机的海外学生挡在门外，而产品是支持 IB/A-Level 这类体系的。
     · 不做手机号唯一约束：无法验证真实性，且家长用一个号给两个孩子登记是正当场景，
       加了只会误伤。同号多账号按风控信号统计（phone_register 事件带脱敏号码）。
   ============================================================ */
function needsPhone() {
  if (!memReady()) return false;                 // 访客不是"账号"，不拦
  // 记忆还没加载完时不要误拦（已有手机号的老用户会被错伤），顺手把它拉起来
  if (!state.memLoaded) { try { loadMemory(true); } catch (_) {} return false; }
  return !currentPhone();
}

/* 需要手机号才能继续：满足返回 true；否则弹出登记窗并返回 false */
function ensurePhone(what) {
  if (needsPhone()) {
    phoneGateMsg('');
    const w = $('#phone-gate-what');
    if (w) w.textContent = what || '继续使用';
    const inp = $('#phone-gate-input');
    if (inp) inp.value = '';
    track('phone_gate', { blocked: String(what || '').slice(0, 40) });
    $('#phone-gate-modal').hidden = false;
    setTimeout(() => { try { $('#phone-gate-input').focus(); } catch (_) {} }, 120);
    return false;
  }
  return true;
}

/* 共用号码的统一提示文案（家长共用同一号码是正当场景，所以措辞不带指责） */
function sharedPhoneNote() {
  return '（提示：这个号码此前已在另一个账号登记过。家长用一个号码代管多个孩子是正常的，无需处理；如果这不是你的号码，请改成你自己的。）';
}

/* 门禁窗里的保存：成功即关闭并继续 */
async function saveGatePhone() {
  const btn = $('#btn-phone-gate-save');
  btn.disabled = true; btn.textContent = '保存中…';
  const r = await registerPhone(($('#phone-gate-input') || {}).value);
  btn.disabled = false; btn.textContent = '保存并继续';
  if (r.error) return phoneGateMsg(r.error);
  phoneGateMsg('已登记：' + phoneMask(r.ok) + (r.shared ? sharedPhoneNote() : ''), 'ok');
  renderAcctPhone();
  setTimeout(() => { $('#phone-gate-modal').hidden = true; closeAuthModal(); }, r.shared ? 4000 : 900);
}

/* 注册成功后的收尾一步：登记手机号（要求项） */
function bindPhoneEvents() {
  const edit = $('#btn-acct-phone-edit');
  if (edit) edit.addEventListener('click', () => {
    const form = $('#acct-phone-form');
    if (!form) return;
    if (form.hidden) {
      form.hidden = false;
      acctPhoneMsg('');
      const inp = $('#acct-phone-input');
      if (inp) { inp.value = currentPhone(); try { inp.focus(); } catch (_) {} }
    } else {
      form.hidden = true;
      acctPhoneMsg('');
    }
  });
  const cancel = $('#btn-acct-phone-cancel');
  if (cancel) cancel.addEventListener('click', () => {
    const form = $('#acct-phone-form');
    if (form) form.hidden = true;
    acctPhoneMsg('');
  });
  const save = $('#btn-acct-phone-save');
  if (save) save.addEventListener('click', async () => {
    save.disabled = true; save.textContent = '保存中…';
    const r = await registerPhone(($('#acct-phone-input') || {}).value);
    save.disabled = false; save.textContent = '保存手机号';
    if (r.error) return acctPhoneMsg(r.error);
    renderAcctPhone();
    acctPhoneMsg(r.unchanged ? '手机号没有变化' : '已登记：' + phoneMask(r.ok) + '（未做短信验证）' + (r.shared ? sharedPhoneNote() : ''), 'ok');
    const form = $('#acct-phone-form');
    if (form && !r.unchanged) setTimeout(() => { form.hidden = true; acctPhoneMsg(''); }, r.shared ? 5000 : 1600);
  });

  // 注册成功后的收尾一步（要求项：登记手机号）
  const suSave = $('#btn-su-phone-save');
  if (suSave) suSave.addEventListener('click', async () => {
    suSave.disabled = true; suSave.textContent = '保存中…';
    const r = await registerPhone(($('#au-su-phone') || {}).value);
    suSave.disabled = false; suSave.textContent = '保存并开始学习';
    if (r.error) return suPhoneMsg(r.error);
    suPhoneMsg('已登记：' + phoneMask(r.ok) + (r.shared ? sharedPhoneNote() : ''), 'ok');
    renderAcctPhone();
    setTimeout(() => closeAuthModal(), r.shared ? 4000 : 1200);
  });
  // "我没有手机号"：不是静默跳过，而是给出手工核对的路子（避免把海外/无号用户挡死）
  const suSkip = $('#btn-su-phone-skip');
  if (suSkip) suSkip.addEventListener('click', () => {
    const box = $('#au-su-no-phone');
    if (box && box.hidden) {
      box.hidden = false;
      suSkip.textContent = '知道了，先这样';
      return;
    }
    // 第二次点击＝确认已知悉，允许关闭（但核心动作仍会被门禁拦下）
    track('phone_gate', { path: 'no_phone' });
    closeAuthModal();
  });

  // 手机号门禁
  const gs = $('#btn-phone-gate-save');
  if (gs) gs.addEventListener('click', saveGatePhone);
  const gl = $('#btn-phone-gate-later');
  if (gl) gl.addEventListener('click', () => {
    track('phone_gate', { path: 'later' });
    $('#phone-gate-modal').hidden = true;
    toast('已跳过。要生成课程或进课堂时，还是会请你先登记手机号', 'err');
  });
  const gw = $('#btn-phone-gate-why');
  if (gw) gw.addEventListener('click', () => openDoc('privacy', false));
}

/* 埋点的少量事件委托（闪卡展开等无法在渲染时直接挂的交互） */
function bindTrackEvents() {
  document.body.addEventListener('click', (ev) => {
    const s = ev.target.closest && ev.target.closest('.flash-card > summary');
    if (s) track('flashcard_open', {});
  });
}

function bindLegalEvents() {
  // 页面上所有 data-doc 入口（注册勾选框、页脚）
  document.body.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-doc]');
    if (!a) return;
    ev.preventDefault();
    // 从注册勾选框里点开时，带上"同意并继续"按钮，读完即可一步同意
    const inConsent = !!ev.target.closest('#au-consent-wrap');
    openDoc(a.dataset.doc, inConsent);
  });
  const c = $('#btn-doc-close'); if (c) c.addEventListener('click', closeDoc);
  const cancel = $('#btn-doc-cancel'); if (cancel) cancel.addEventListener('click', closeDoc);
  const agree = $('#btn-doc-agree'); if (agree) agree.addEventListener('click', agreeDoc);
  const dm = $('#doc-modal');
  if (dm) dm.addEventListener('click', (ev) => { if (ev.target === dm) closeDoc(); });

  const ac = $('#btn-acct-close'); if (ac) ac.addEventListener('click', closeAccountModal);
  const am = $('#account-modal');
  if (am) am.addEventListener('click', (ev) => { if (ev.target === am) closeAccountModal(); });
  const exp = $('#btn-acct-export'); if (exp) exp.addEventListener('click', exportMyData);
  const del = $('#btn-acct-delete'); if (del) del.addEventListener('click', deleteMyAccount);
  const tBtn = $('#btn-acct-terms'); if (tBtn) tBtn.addEventListener('click', () => openDoc('terms', false));
  const pBtn = $('#btn-acct-privacy'); if (pBtn) pBtn.addEventListener('click', () => openDoc('privacy', false));

  const memAcct = $('#btn-mem-account'); if (memAcct) memAcct.addEventListener('click', openAccountModal);
}


/* 课程体系：国内 + 国际 */
const SYSTEMS = [
  {
    id: 'cn',
    name: '国内课程',
    short: '国内',
    ico: '🇨🇳',
    desc: '中高考 · 同步辅导 · 竞赛',
    grades: ['小学', '初中', '高中', '大学 / 成人'],
    stages: [
      { name: '小学', ico: '🎒' },
      { name: '初中', ico: '📗' },
      { name: '高中', ico: '📘' },
      { name: '大学 / 成人', ico: '🎓' },
    ],
    subjects: [
      { name: '数学', ico: '📐', color: '#EEEDFD', desc: '代数 · 几何 · 函数' },
      { name: '英语', ico: '🔤', color: '#FFF1E6', desc: '语法 · 词汇 · 听说' },
      { name: '语文', ico: '📖', color: '#FEF3C7', desc: '阅读 · 写作 · 文言' },
      { name: '物理', ico: '⚛️', color: '#E0F2FE', desc: '力学 · 电学 · 实验' },
      { name: '化学', ico: '🧪', color: '#D9F6F1', desc: '方程 · 实验 · 推断' },
      { name: '生物', ico: '🌿', color: '#DCFCE7', desc: '细胞 · 遗传 · 生态' },
      { name: '历史', ico: '🏛️', color: '#FFE4E6', desc: '脉络 · 史料 · 答题' },
      { name: '地理', ico: '🌏', color: '#E0F2FE', desc: '自然 · 人文 · 图表' },
      { name: '编程', ico: '💻', color: '#EDE9FE', desc: 'Python · 算法启蒙' },
      /* ★ 2026-09-24 新增：与"编程"分工不同 ——
         编程偏青少年启蒙（Python 入门），计算机科学偏系统知识（算法/数据结构/网络/数据库），
         服务"大学 / 成人"这一段。会计同理：职高、大学、成人考证都常见。 */
      { name: '计算机科学', ico: '🖥️', color: '#E0E7FF', desc: '算法 · 数据结构 · 网络' },
      { name: '会计', ico: '🧾', color: '#FEF9C3', desc: '记账 · 报表 · 成本' },
      { name: '竞赛数学', ico: '🏆', color: '#FEF3C7', desc: '奥数 · 思维 · 压轴' },
    ],
    goals: [
      '同步课内进度，把没听懂的地方补上',
      '月考 / 期中期末考试冲刺，主攻失分点',
      '中考 / 高考系统复习，按考纲梳理考点',
      '奥数思维训练，冲击竞赛奖项',
    ],
  },
  {
    id: 'intl',
    name: '国际课程',
    short: '国际',
    ico: '🌐',
    desc: 'IB · A-Level · HKDSE · AP',
    // 国际考纲/考试局：用户可多选，AI 按考纲授课
    boards: [
      { id: 'ib', name: 'IB', full: 'IB DP', ico: '🌍', desc: 'MYP / DP · HL SL · IA/EE', marks: ['IB DP (HL/SL)', 'MYP'] },
      { id: 'alevel', name: 'A-Level', full: 'A-Level', ico: '🇬🇧', desc: 'CAIE · Edexcel · A2/AS', marks: ['A-Level (AS/A2)', 'IGCSE'] },
      { id: 'hkdse', name: 'HKDSE', full: 'HKDSE 香港中学文凭', ico: '🇭🇰', desc: '香港文凭试 · 核心+选修', marks: ['HKDSE 香港中学文凭'] },
      { id: 'ap', name: 'AP', full: 'AP', ico: '🇺🇸', desc: 'College Board · 5 分制', marks: ['AP'] },
    ],
    grades: ['IGCSE / MYP', 'AS / A2 / DP1-2', '本科 / 研究生', '标化与竞赛备考'],
    subjects: [
      { name: 'Mathematics 数学', ico: '📐', color: '#EEEDFD', desc: 'AA/AI · Pure · Calculus', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: 'Further Math 进阶数学', ico: '🧮', color: '#EDE9FE', desc: 'Further Pure · 向量矩阵', boards: ['alevel', 'hkdse'] },
      { name: 'English 英语', ico: '🔤', color: '#FFF1E6', desc: 'Lang & Lit · Paper 1/2', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: 'Physics 物理', ico: '⚛️', color: '#E0F2FE', desc: 'Mechanics · Fields · 实验', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: 'Chemistry 化学', ico: '🧪', color: '#D9F6F1', desc: 'Organic · 机理 · 实验', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: 'Biology 生物', ico: '🌿', color: '#DCFCE7', desc: 'Cell · Genetics · 生态', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: 'Economics 经济', ico: '📈', color: '#FEF3C7', desc: 'Micro · Macro · 图表题', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: 'Business 商科', ico: '💼', color: '#E0F2FE', desc: 'Case · Finance · 分析', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      // 命名统一成"英文 + 中文"（跟上面几条一致，便于中文学生一眼找到）
      { name: 'Computer Science 计算机科学', ico: '🖥️', color: '#E0E7FF', desc: 'Algorithm · Data · 编程实现', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      /* ★ 2026-09-24 新增会计：A-Level Accounting(9706)、HKDSE BAFS(会计模块)、
         IB Business Management 的财务部分都常考；AP 没有独立会计科目，所以不挂 ap。 */
      { name: 'Accounting 会计', ico: '🧾', color: '#FEF9C3', desc: 'Financial · Cost · 报表分析', boards: ['ib', 'alevel', 'hkdse'] },
      { name: 'History 历史', ico: '🏛️', color: '#FFE4E6', desc: 'Source · Essay 论文', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: 'Geography 地理', ico: '🌏', color: '#E0F2FE', desc: 'Human · Physical · 数据', boards: ['ib', 'alevel', 'hkdse', 'ap'] },
      { name: '中文 Chinese', ico: '📖', color: '#FEF3C7', desc: 'HKDSE 中文 · IB 中文', boards: ['hkdse', 'ib', 'alevel'] },
      { name: '公民与社会 CSD', ico: '🤝', color: '#FFE4E6', desc: 'HKDSE 公民与社会发展', boards: ['hkdse'] },
      { name: 'IELTS / TOEFL', ico: '🎧', color: '#DCFCE7', desc: '听说读写 · 冲分' },
      { name: 'SAT / ACT', ico: '✏️', color: '#FFF1E6', desc: 'Reading · Math · 文法' },
      { name: 'AMC 竞赛', ico: '🏆', color: '#FEF3C7', desc: 'AMC/AIME · 逻辑推理' },
    ],
    goals: [
      'IB：跟上 DP 进度，把概念彻底讲清楚，理清 IA/EE 选题',
      'A-Level：按 CAIE/Edexcel 考纲过一遍重点，刷 past papers',
      'HKDSE：核心科目与选修一起冲 Level 5**，主攻 Paper 2 选择题',
      'AP：备考 5 月大考，冲 5 分，重点攻克 FRQ 自由问答题',
      '标化考试冲分，突破瓶颈分数段',
    ],
  },
];
const SUBJECTS = SYSTEMS.flatMap((s) => s.subjects);
function getSystem(id) { return SYSTEMS.find((s) => s.id === id) || SYSTEMS[0]; }
function getBoards(sys) { return sys.boards || []; }

/* ---------- 小工具 ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function mdLite(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return m + ':' + s;
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
/* ============================================================
   不可信输入的归一化（一处收口）
   为什么放在这里而不是每个使用点各加防御：
   课程与记忆有**三个数据来源** —— localStorage、云端数据库、AI 模型输出。
   三者都可能是畸形或旧版本：[null]、字符串当数组、缺字段、类型不对。
   逐个使用点防御必然遗漏（实测已抓到 4 处崩溃），所以在入口统一洗一遍，
   下游就可以放心假定形状正确。
   ============================================================ */
function asArray(v) { return Array.isArray(v) ? v : []; }
function asObject(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }

/* 记忆事实条目：丢掉 null / 非对象 / 没有正文的脏数据。
   ★ 必须**保留原始字段**再覆盖需要归正的项 —— 早先我写成白名单式重建，
   结果把 id（删除按钮要用）和 subject（学科标签要用）丢掉了，测试当场抓到。
   归一化的原则是"补齐/纠正"，不是"裁剪"。 */
function normalizeFacts(list) {
  return asArray(list)
    .filter((f) => f && typeof f === 'object' && typeof f.content === 'string' && f.content.trim())
    .map((f) => Object.assign({}, f, {
      kind: typeof f.kind === 'string' ? f.kind : 'context',
      content: f.content,
      topic: typeof f.topic === 'string' ? f.topic : '',
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.7,
    }));
}

/* 课程对象：把数组类字段全部归正，脏 replay 直接丢弃 */
function normalizeCourse(c) {
  const o = asObject(c);
  if (!o) return null;
  o.slides = asArray(o.slides).filter((s) => asObject(s));
  o.boards = asArray(o.boards).filter((x) => typeof x === 'string');
  o.boardNames = asArray(o.boardNames);
  o.outline = asObject(o.outline);
  if (o.outline) {
    o.outline.stages = asArray(o.outline.stages).filter((s) => asObject(s));
    o.outline.knowledgePoints = asArray(o.outline.knowledgePoints);
    o.outline.homework = asArray(o.outline.homework);
  }
  if (o.replay && !Array.isArray(o.replay.events)) o.replay = null;   // 半截回放比没有更糟
  o.title = typeof o.title === 'string' && o.title.trim() ? o.title : (o.rawOutline ? '未命名课程' : '未命名课程');
  o.subject = typeof o.subject === 'string' ? o.subject : '';
  o.grade = typeof o.grade === 'string' ? o.grade : '';
  o.level = typeof o.level === 'string' ? o.level : '';
  o.duration = typeof o.duration === 'string' ? o.duration : '';
  o.progress = typeof o.progress === 'number' ? Math.min(1, Math.max(0, o.progress)) : 0;
  return o;
}
function normalizeCourses(list) {
  return asArray(list).map(normalizeCourse).filter(Boolean);
}

/* 课前诊断画像：模型输出最容易缺字段，这里给全默认值。
   字段清单是从 renderDiagProfile 实际用到的成员反查出来的（counts/total/topics/
   verdict/judged/focus/skip）—— 上一版只补了前四项，focus/skip 漏了，实测当场崩。 */
function normalizeDiagProfile(p) {
  const o = asObject(p);
  if (!o) return null;
  const c = asObject(o.counts) || {};
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const strs = (v) => asArray(v).filter((x) => typeof x === 'string');
  o.counts = { ok: num(c.ok), fuzzy: num(c.fuzzy), gap: num(c.gap), na: num(c.na) };
  o.total = num(o.total);
  o.judged = num(o.judged);
  o.topics = asArray(o.topics).filter((t) => asObject(t) && typeof t.topic === 'string');
  o.focus = strs(o.focus);
  o.skip = strs(o.skip);
  o.verdict = typeof o.verdict === 'string' ? o.verdict : '';
  return o;
}

function quizCountOf(course) {
  const slides = asArray(course && course.slides);
  return slides.filter((s) => s && s.type === 'quiz' && s.question).length;
}
function toast(text, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = text;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 3200);
  setTimeout(() => el.remove(), 3700);
}
/* ============================================================
   语音合成（TTS）：让灵犀老师真的开口讲课
   使用浏览器内置 SpeechSynthesis，零成本、零依赖
   ============================================================ */
const TTS = {
  // 只有真正拿到了可用对象才算支持（某些环境属性存在但为 null）
  supported: typeof window !== 'undefined' && !!window.speechSynthesis &&
    typeof window.speechSynthesis.speak === 'function',
  voice: null,
  enabled: false,      // 用户是否开启朗读
  speaking: false,
  rate: 1.0,           // 由 loadSpeechRate() 在启动时按偏好覆盖
    queue: [],           // 待朗读句子
    _speakingNow: false,
    /* 连续卡住（开口后 onend 不触发）的句数 —— 用来区分"偶发"与"这台设备基本读不出来" */
    _stuckCount: 0,
    _gestureArmed: false,   // 是否已挂上"点一下重试"的一次性手势监听
    _pendingRetry: '',      // 被引擎拒绝、等手势后重试的那一句
};

/* ---------- 授课语言（中文 / English） ----------
   ⚠️ 关键认识：语言**不能只换音色**。中文讲课内容用英文音色读出来是怪音；
   反过来英文内容用中文音色也一样。所以一处设置要联动三件事：
     ① 系统提示词 → 老师用什么语言讲课（决定内容）
     ② TTS 音色    → 用哪种语言的语音（决定声音）
     ③ 朗读清洗规则 → 符号怎么念（"×"在中文读"乘"，英文读"times"）
   ============================================================ */
const TEACH_LANGS = {
  zh: {
    id: 'zh', label: '中文', flag: '🇨🇳',
    prompt: '全程使用简体中文，口语化、亲切、有耐心。',
    speakName: '简体中文',
    voiceRe: /^(zh|cmn)|Chinese|中文|Xiaoxiao|Xiaoyi|Yunxi|Huihui|Tingting/i,
    utteranceLang: 'zh-CN',
  },
  en: {
    id: 'en', label: 'English', flag: '🇬🇧',
    prompt: '全程使用英语（English）授课：讲解、追问、点评、鼓励一律用英语；'
      + '关键术语首次出现时可以加一句中文注释帮助理解，但主体必须是英语。'
      + '英语要口语化、语速自然，适合中学生听懂。',
    speakName: 'English',
    voiceRe: /^en[-_]|English|United States|United Kingdom/i,
    utteranceLang: 'en-US',
  },
};

function teachLang() {
  return TEACH_LANGS[state.teachLang] ? state.teachLang : 'zh';
}
function teachLangProfile() {
  return TEACH_LANGS[teachLang()];
}
function setTeachLang(id, opts) {
  if (!TEACH_LANGS[id]) return;
  const changed = state.teachLang !== id;
  state.teachLang = id;
  try { localStorage.setItem('lingxi_teach_lang', id); } catch (_) {}
  TTS.voice = null;                     // 音色必须重新挑：语言换了，旧音色不再适用
  TTS.voice = pickVoice();
  if (!(opts && opts.quiet)) {
    track('teach_lang', { lang: id });
    toast(changed
      ? '老师将改用' + TEACH_LANGS[id].label + '讲课（当前这节课立即生效；课件仍是生成时的语言）'
      : '授课语言已是' + TEACH_LANGS[id].label, changed ? 'ok' : '');
  }
  renderVoiceSettings();
}
function loadTeachLang() {
  try {
    const v = localStorage.getItem('lingxi_teach_lang');
    if (TEACH_LANGS[v]) return v;
  } catch (_) {}
  return 'zh';
}

/* 挑选一个中文女声（各平台名称不同，做优先级匹配）
   顺序很重要：微软新一代自然音（Xiaoxiao/晓晓 等）明显比 Huihui 这类老音色好听，
   所以新的排前面；最后才退到"任意中文"。 */
function pickVoice(langId) {
  if (!TTS.supported || !window.speechSynthesis) return null;
  let vs = [];
  try { vs = window.speechSynthesis.getVoices() || []; } catch (_) { return null; }
  if (!vs.length) return null;
  const want = TEACH_LANGS[langId || teachLang()] || TEACH_LANGS.zh;
  /* ★ 2026-09-24：先按**自然度等级**挑，而不是只看名字列表。
     原来只看名字，可能出现"列表里靠前那个恰好是老式合成音色"的情况 ——
     明明系统里装着 Natural 音色，却选中了机械嗓子。 */
  const langOk = vs.filter((x) => {
    const hay = (x.name || '') + ' ' + (x.lang || '');
    if (want.voiceRe.test(x.name || '') || want.voiceRe.test(x.lang || '')) return true;
    return want.id === 'zh' ? /^zh|Chinese/i.test(hay) : /^en|English/i.test(hay);
  });
  if (langOk.length) {
    let best = null; let bestScore = -1;
    langOk.forEach((v) => {
      // 等级优先；同等级优先本地音色（在线音色断网时会静默不出声，可靠性更重要）
      const score = voiceTier(v.name || '').tier * 10 + (v.localService ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = v; }
    });
    if (best) return best;
  }
  // 再按目标语言的音色优先级挑
  const names = want.id === 'en'
    ? [/Aria|Jenny|Guy|Michelle|Ana|Zira|Emma|Ava/i, /Natural|Online/i, want.voiceRe]
    : [/Xiaoxiao|晓晓/i, /Xiaoyi|晓伊/i, /Xiaomo|晓墨/i, /Xiaohan|晓涵/i, /Xiaoshuang|晓双/i, /Xiaoxuan|晓萱/i,
       /Yunxi|云希/i, /Yunyang|云扬/i, /Yunjian|云健/i, /Yunxia|云夏/i, /Xiaochen|晓辰/i, /Xiaoyan|晓颜/i,
       /Tingting|婷婷/i, /Huihui|慧慧/i, /Yaoyao|瑶瑶/i, /Mei[i-]?Jia|美佳/i, /Sinji|善怡/i, /Lili|丽丽/i,
       /Natural|Online/i, /Chinese.*(Female|女)/i, /zh[-_]CN/i, /zh[-_]HK/i, /zh/i];
  for (const re of names) {
    const v = vs.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  // 目标语言没有对应音色时：不硬用错语言的音色（那会读出怪音），交给上层提示
  return vs.find((x) => want.voiceRe.test((x.name || '') + ' ' + (x.lang || ''))) || null;
}

/* 当前音色质量（用于设置面板如实展示）。
   设备上只有老式音色时，与其让用户以为"这产品就是个机器人嗓子"，
   不如直接告诉他怎么装一个更自然的。 */
function currentVoiceQuality() {
  if (!TTS.supported) return { tier: 0, label: '不支持', hint: '当前浏览器不支持语音朗读' };
  const v = TTS.voice || pickVoice();
  if (!v) return { tier: 0, label: '无可用音色', hint: '系统里没有找到中文语音' };
  const t = voiceTier(v.name || '');
  return { tier: t.tier, label: t.label, hint: t.hint, name: v.name || '' };
}

function initTTS() {
  if (!TTS.supported || TTS._inited) return;
  TTS._inited = true;
  try {
    TTS.voice = pickVoice();
    // 部分浏览器 voice 列表异步就绪
    window.speechSynthesis.onvoiceschanged = () => { TTS.voice = TTS.voice || pickVoice(); };
    if (!TTS.voice) {
      setTimeout(() => { try { TTS.voice = pickVoice(); } catch (_) {} }, 600);
    }
  } catch (e) { console.warn('TTS 初始化失败，已降级为无语音', e); }
}

/* 提取文本中"已完整结束"的句子（末尾标点闭合），用于增量朗读。
    ★ 2026-09-29 修（外部审查 R06）：原来只认中文句末 + !?;，**不认英文句号** ——
      而实时课堂走的正是这个函数（`splitSentences` 虽然认英文，但它在完整文本上工作，
      实时路径根本到不了那里）。后果：**用英文讲课、句子以 `.` 结尾时，文本进不了朗读队列，
      表现为"老师不开口"**；这正是"没声音"的一类独立成因。
    ★ 增量契约：每次传入**累积文本**，只返还"结尾标点已闭合"的句子；
      不完整的尾巴必须留到下一次调用（调用方用 spokenLen 计数，多返或少返都会串音）。
    ★ 排除项：小数点（3.14）与常见缩写（Mr. / e.g. / i.e.）不能当句末。 */
const SENT_END_BASIC = '。！？!?；;';
/* 缩写：点号前是这些词就不算句末 */
const SENT_ABBR_RE = /(?:^|[\s(（])(?:mr|mrs|ms|dr|prof|st|vs|etc|e\.g|i\.e|a\.m|p\.m|no|fig|approx|inc|ltd)\.$/i;
function scanSentences(text) {
  const src = String(text || '');
  const out = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    /* 换行只是"屏障"不是句末 —— 保持原有语义（原文里 \n 被排除在内容类之外） */
    if (ch === '\n') { buf = ''; continue; }
    buf += ch;
    let isEnd = SENT_END_BASIC.indexOf(ch) >= 0;
    if (!isEnd && ch === '.') {
      const prev = src[i - 1] || '';
      const next = src[i + 1] || '';
      const isDecimal = /\d/.test(prev) && /\d/.test(next);   // 3.14
      const isAbbr = SENT_ABBR_RE.test(buf);                  // Mr. / e.g.
      const nextIsWord = /[A-Za-z]/.test(next);               // "e.g. the" 里的第一个点
      if (!isDecimal && !isAbbr && !nextIsWord) isEnd = true;
    }
    if (isEnd) {
      const s = buf.replace(/[*#`>_~]/g, '').trim();
      if (s.length > 1) out.push(s);
      buf = '';
    }
  }
  const clean = (x) => x.replace(/[*#`>_~]/g, '').trim();
  const rawTail = clean(buf);
  return { done: out, tail: rawTail.length > 1 ? rawTail : '' };
}
function completeSentences(text) { return scanSentences(text).done; }
/* 讲完后补读"最后那段没打标点的尾巴"。
   ★ 2026-09-29 修（外部审查 R06 后半）：模型收尾不写标点很常见，
     原来这里只取 completeSentences()，尾巴被**静默丢掉** —— 最后一个字永远读不出来。 */
function sentencesWithTail(text) {
  const r = scanSentences(text);
  return r.tail ? r.done.concat([r.tail]) : r.done;
}

/* 朗读前的文本清洗 —— 屏幕上好看的，念出来未必好听。
   实测证据：老师讲"假如有两块蛋糕🍰"时，emoji 被原样送进语音引擎；
   教学场景还有 × ÷ % = —— 这类符号念出来要么是怪音、要么直接跳字。
   这里把"给眼睛看的写法"翻译成"给耳朵听的读法"。 */
function speakableText(raw, langId) {
  const L = langId || teachLang();
  let s = String(raw == null ? '' : raw);
  s = s.replace(/```[\s\S]*?```/g, ' ');          // 代码块不念
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/[*#~>_|]/g, ' ');                 // markdown 记号
  // emoji / 图标 / 箭头：念不出来，直接去掉（避免怪音与吞字）
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ');
  if (L === 'en') {
    // 英文授课：符号按英语读法，且**不能**去掉词间空格（英文靠空格断词）
    s = s.replace(/(\d+(?:\.\d+)?)\s*[%％]/g, '$1 percent');
    s = s.replace(/[%％]/g, ' percent ');
    s = s.replace(/\s*×\s*/g, ' times ').replace(/\s*÷\s*/g, ' divided by ')
      .replace(/\s*≈\s*/g, ' approximately ').replace(/\s*≠\s*/g, ' is not equal to ')
      .replace(/\s*≥\s*/g, ' greater than or equal to ').replace(/\s*≤\s*/g, ' less than or equal to ')
      .replace(/\s*[=＝]\s*/g, ' equals ')
      .replace(/\s*[+＋]\s*/g, ' plus ').replace(/\s*[－]\s*/g, ' minus ')
      .replace(/\s*°\s*/g, ' degrees ');
    s = s.replace(/cm²|cm2/g, 'square centimeters').replace(/m²|m2/g, 'square meters').replace(/km²|km2/g, 'square kilometers');
    s = s.replace(/——|—|--/g, ', ').replace(/\.{3,}|…+/g, ', ');
    s = s.replace(/[【】\[\]{}「」『』《》]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }
  // 百分号要连数字一起读："50%" → "百分之50"，不能读成"50百分之"
  s = s.replace(/(\d+(?:\.\d+)?)\s*[%％]/g, '百分之$1');
  s = s.replace(/[%％]/g, '百分之');
  // 数学符号口语化（教学场景的高频符号）
  // ★ 符号两侧的空格要一起吃掉：中文里保留空格会让语音引擎在空格处微停顿，
  //   "长 乘 宽"听着就是断的；连起来念成"长乘宽"才自然。
  s = s.replace(/\s*×\s*/g, '乘').replace(/\s*÷\s*/g, '除以')
    .replace(/\s*≈\s*/g, '约等于').replace(/\s*≠\s*/g, '不等于')
    .replace(/\s*≥\s*/g, '大于等于').replace(/\s*≤\s*/g, '小于等于')
    .replace(/\s*[=＝]\s*/g, '等于')
    .replace(/\s*[+＋]\s*/g, '加').replace(/\s*[－]\s*/g, '减')
    .replace(/\s*°\s*/g, '度');
  // 面积单位缩写
  s = s.replace(/cm²|cm2/g, '平方厘米').replace(/m²|m2/g, '平方米').replace(/km²|km2/g, '平方千米');
  // 破折号、省略号 → 自然停顿（念"破折号"很出戏）
  s = s.replace(/——|—|--/g, '，').replace(/\.{3,}|…+/g, '，');
  // 书括号类符号去掉（保留中文括号，它有语义停顿）
  s = s.replace(/[【】\[\]{}「」『』《》]/g, ' ');
  // ★ 中文之间的空格要去掉：中文 TTS 会在空格处微停顿，
  //   "蛋糕 ，怎么分" 听起来就是断的（这是实测发现的，不是理论）。
  //   注意字符类要包含**中文标点**（\u3000-\u303f、\uff00-\uffef），
  //   否则 "蛋糕 ，"（逗号是 U+FF0C）这种最常见的情况漏掉。
  const CJKX = '\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef0-9';
  s = s.replace(new RegExp('([' + CJKX + '])\\s+(?=[' + CJKX + '])', 'g'), '$1');
  // ★ 符号替换成标点后可能产生连续标点（"这是 ， ， 很重要"），合并掉
  s = s.replace(/[，,]{2,}/g, '，').replace(/[。]{2,}/g, '。');
  s = s.replace(/，\s*[，、]/g, '，').replace(/[，、]\s*，/g, '，');
  return s.replace(/\s+/g, ' ').trim();
}

/* 把长文切成适合朗读的短句。
   两个实测痛点：① 碎片句（"好。""对。"）会让朗读一顿一顿；
   ② 超长句一口气念不完，学生想打断也要等很久。 */
const SPEAK_MIN = 12;      // 短于此就尝试并进相邻句
const SPEAK_MAX = 80;      // 单句上限（超出在逗号处二次切分）
const SPEAK_TARGET = 42;   // 二次切分的累积目标

function splitLongSpeech(s) {
  const parts = [];
  let cur = '';
  s.split(/(?<=[，、,；;：:])/).forEach((piece) => {
    if (cur && (cur + piece).length > SPEAK_TARGET) { parts.push(cur); cur = piece; }
    else cur += piece;
  });
  if (cur) parts.push(cur);
  // ★ 切完还要把过短的碎片并回去：实测 "同学们注意，我们一步一步…" 会被切成
  //   ["同学们注意，"(6 字), "我们一步一步…"] —— 开头一个 6 字碎片读起来很突兀。
  //   碎片合并**不再受总长上限约束**：超长交给下面的硬切，比留着碎片好听。
  const merged = [];
  parts.forEach((p) => {
    const prev = merged[merged.length - 1];
    if (prev && (prev.length < SPEAK_MIN || (p.length < SPEAK_MIN && (prev.length + p.length) <= SPEAK_MAX))) {
      merged[merged.length - 1] = prev + p;
    } else {
      merged.push(p);
    }
  });
  // 无标点的长串：按目标长度均分，比一律切 80 字更自然，打断也更灵敏
  const out = [];
  merged.forEach((p) => {
    if (p.length <= SPEAK_MAX) { out.push(p); return; }
    const n = Math.ceil(p.length / SPEAK_TARGET) || 1;
    const size = Math.ceil(p.length / n);
    for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
  });
  return out.filter((x) => x.trim().length > 1);
}

function splitSentences(text, langId) {
  const L = langId || teachLang();
  const clean = speakableText(text, L);
  if (!clean) return [];
  // 英文按句末标点切；中文额外认分号
  const re = L === 'en' ? /(?<=[.!?])\s+/ : /(?<=[。！？!?；;])/;
  const raw = clean.split(re).map((s) => s.trim()).filter((s) => s.length > 1);
  // ① 合并碎片：任一侧过短就并起来，读起来才连贯
  const merged = [];
  raw.forEach((s) => {
    const prev = merged[merged.length - 1];
    if (prev && (prev.length < SPEAK_MIN || s.length < SPEAK_MIN) && (prev.length + s.length) <= SPEAK_MAX) {
      merged[merged.length - 1] = prev + s;
    } else {
      merged.push(s);
    }
  });
  // ② 超长句二次切分，保证打断灵敏、呼吸自然
  const out = [];
  merged.forEach((s) => {
    if (s.length > SPEAK_MAX) splitLongSpeech(s).forEach((x) => out.push(x));
    else out.push(s);
  });
  return out.filter((s) => s.trim().length > 1);
}

/* 语速：教学场景给三档，默认 1.0。长按「语音」按钮循环切换（见 bindSpeakRate）。 */
const SPEECH_RATES = [0.9, 1.0, 1.15];
function loadSpeechRate() {
  try {
    const v = parseFloat(localStorage.getItem('lingxi_tts_rate'));
    if (SPEECH_RATES.indexOf(v) >= 0) return v;
  } catch (_) {}
  return 1.0;
}
function cycleSpeechRate() {
  const cur = TTS.rate || 1.0;
  const i = SPEECH_RATES.indexOf(cur);
  return setSpeechRate(SPEECH_RATES[(i + 1) % SPEECH_RATES.length] || 1.0);
}

/* 设定语速：记住偏好，并在朗读中立刻用新语速念一句（让改动听得见） */
function setSpeechRate(next) {
  if (SPEECH_RATES.indexOf(next) < 0) next = 1.0;
  TTS.rate = next;
  try { localStorage.setItem('lingxi_tts_rate', String(next)); } catch (_) {}
  renderVoiceSettings();
  if (TTS.enabled) { stopSpeech(); speak('好，我就按这个速度讲。'); }
  return next;
}
function rateLabel(v) {
  return v < 1 ? '稍慢' : v > 1 ? '稍快' : '正常';
}

/* 声音设置面板：语速 + 授课语言。
   为什么长按打开面板而不是直接循环：语言是个"选一次就不再动"的设置，
   循环式切换既难发现又容易切错；给个小面板更清楚。 */
function openVoiceModal() {
  renderVoiceSettings();
  const m = $('#voice-modal');
  if (m) m.hidden = false;
}
function closeVoiceModal() {
  const m = $('#voice-modal');
  if (m) m.hidden = true;
}

function renderVoiceSettings() {
  // 生成页的语言选择（源头决定课程语言：课件 + 讲课 + 声音一次对齐）
  const genLang = $('#gen-lang');
  if (genLang) {
    genLang.innerHTML = Object.keys(TEACH_LANGS).map((id) => {
      const L = TEACH_LANGS[id];
      return '<button class="chip' + (teachLang() === id ? ' active' : '') + '" data-lang="' + id + '">' +
        L.flag + ' ' + esc(L.label) + '</button>';
    }).join('');
  }
  const langs = $('#voice-langs');
  if (langs) {
    langs.innerHTML = Object.keys(TEACH_LANGS).map((id) => {
      const L = TEACH_LANGS[id];
      return '<button class="chip' + (teachLang() === id ? ' active' : '') + '" data-lang="' + id + '">' +
        L.flag + ' ' + esc(L.label) + '</button>';
    }).join('');
  }
  const rates = $('#voice-rates');
  if (rates) {
    rates.innerHTML = SPEECH_RATES.map((v) => {
      return '<button class="chip' + ((TTS.rate || 1.0) === v ? ' active' : '') + '" data-rate="' + v + '">' +
        rateLabel(v) + '</button>';
    }).join('');
  }
  // 老师形象：插画（默认，安全）/ 真人照片（可选）。真人资源不可用时该项置灰说明。
  const avRow = $('#voice-avatars');
  if (avRow) {
    const cur = avatarStyle();
    const photoOk = AVATAR.ready;
    avRow.innerHTML =
      '<button class="chip' + (cur === 'illust' ? ' active' : '') + '" data-avatar="illust">🎨 插画形象（推荐）</button>' +
      '<button class="chip' + (cur === 'photo' ? ' active' : '') + '" data-avatar="photo"' +
        (photoOk ? '' : ' disabled title="这台设备上暂时没有真人形象资源"') + '>' +
        '📷 真人形象' + (photoOk ? '' : '（不可用）') + '</button>';
  }
  const note = $('#voice-note');
  if (note) {
    const h = ttsHealth();
    const vname = TTS.voice ? TTS.voice.name : '';
    if (!h.usable) {
      note.textContent = '⚠️ 这台设备暂时没有可用语音：' + (h.reason === 'no_voice' ? '未安装语音包' : h.reason === 'unsupported' ? '浏览器不支持' : '缺少所选语言的语音') + '，老师会以字幕讲课。';
    } else if (teachLang() === 'en' && !TTS.voice) {
      // 实测常见情况：设备装的是中文音色，没有英文音色。
      // 这时引擎仍能用 en-US 读出英文（我们做了 locale 兜底），但音质可能一般 —— 要如实说明。
      note.textContent = '当前音色：系统默认英文引擎（这台设备没装英文音色，仍可朗读，但音质一般。想要更自然，可在系统里添加英语语音，或用 Edge 打开）。';
    } else {
      /* ★ 如实展示音色档位。设备上只有老式合成音色时（tier ≤ 2），
         与其让用户以为"这产品就是个机器人嗓子"，不如直接给他一个可操作的办法 ——
         装一个"自然"语音包，听感差别非常大。 */
      const q = currentVoiceQuality();
      note.textContent = '当前音色：' + (vname || '系统默认') + '（' + q.label + ' · ' + q.hint + '）' +
        (teachLang() === 'zh' && !h.hasZh ? '（未检测到中文语音）' : '');
      if (q.tier <= 2) {
        note.textContent += '\n💡 想要更像真人？Windows：设置 → 时间和语言 → 语音 → 添加「中文(简体)」并安装带“自然/Natural”的音色；macOS：系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音。用 Edge 打开本页通常也能拿到更自然的音色。';
      }
    }
  }
}

function bindVoiceSettingsEvents() {
  // 生成页的语言选择（换语言后，已生成的课件仍是旧语言 —— 明确提示怎么补救）
  const genLang = $('#gen-lang');
  if (genLang) genLang.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-lang]');
    if (!b) return;
    const before = teachLang();
    setTeachLang(b.dataset.lang, { quiet: true });
    track('teach_lang', { lang: b.dataset.lang, from: 'generate' });
    const stale = (state.courses || []).filter((c) => c.genLang && c.genLang !== teachLang());
    toast('老师将改用' + teachLangProfile().label + '授课'
      + (stale.length ? '；已有 ' + stale.length + ' 节课是旧语言，重新生成可全套切换' : ''), 'ok');
    renderVoiceSettings();
    if (before !== teachLang()) renderGenChips();
  });
  const langs = $('#voice-langs');
  if (langs) langs.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-lang]');
    if (b) setTeachLang(b.dataset.lang);
  });
  const rates = $('#voice-rates');
  if (rates) rates.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rate]');
    if (b) {
      setSpeechRate(parseFloat(b.dataset.rate));
      toast('老师讲课语速：' + rateLabel(TTS.rate), 'ok');
    }
  });
  const avRow = $('#voice-avatars');
  if (avRow) avRow.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-avatar]');
    if (!b || b.disabled) return;
    const v = setAvatarStyle(b.dataset.avatar);
    toast(v === 'photo' ? '已切换到真人形象' : '已切换到插画形象', 'ok');
  });
  const close = $('#btn-voice-close'); if (close) close.addEventListener('click', closeVoiceModal);
  const ok = $('#btn-voice-ok'); if (ok) ok.addEventListener('click', closeVoiceModal);
  const m = $('#voice-modal');
  if (m) m.addEventListener('click', (ev) => { if (ev.target === m) closeVoiceModal(); });
}

/* 语音按钮：短按=开关朗读，长按(550ms)=打开声音设置（语速 + 授课语言）。
   工具条已经很挤，复用这个按钮比新加控件省空间，而且"想调的时候就在手边"。 */
let speakRatePressed = false;
function bindSpeakRateLongPress() {
  const btn = $('#tb-voice');
  if (!btn || btn.dataset.rateBound) return;
  btn.dataset.rateBound = '1';
  let timer = 0;
  const start = () => {
    speakRatePressed = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      speakRatePressed = true;          // 标记：随后的 click 必须忽略，否则会顺带开关朗读
      openVoiceModal();
    }, 550);
  };
  const cancel = () => clearTimeout(timer);
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
  // 注意：同一个元素上的监听器按**注册顺序**触发，capture 标记在目标元素上不改变顺序，
  // 所以不靠 stopImmediatePropagation，而是在 toggleTTS 的处理器里显式看这个标记。
  btn.title = '老师语音朗读（短按开关声音；长按设置语速与语言）';
}

/* 讲一句（内部） */
/* ============================================================
   语音自然度（2026-09-24 新增）
   原来的朗读听感"像机器人"，是三个原因叠出来的：
     ① 每句都用同一个 rate/pitch —— 没有语气起伏，像播报；
     ② 音色只按"名字"匹配，不看质量等级 —— 可能选中老式合成音色；
     ③ 句子之间零停顿 —— 一句接一句，像机枪。
   下面分别处理。韵律幅度**刻意做小**（±0.05 上下）：调大了就成变声，反而更假。
   ============================================================ */

/* 句间停顿（毫秒）。留白是"像真人"的关键：人说话句间必然有呼吸。 */
const SPEECH_PAUSE = { end: 200, question: 340, concl: 300, para: 420 };

/* 语气 → 韵律。纯函数，便于回归测试。
   判据只取最稳的几类（问句/鼓励/结论/步骤/定义），不做过度分类。 */
function speechProsody(text) {
  const s = String(text || '').trim();
  const out = { rate: 1, pitch: 1, pause: SPEECH_PAUSE.end };
  if (!s) return out;
  const isQuestion = /[？?]$/.test(s) || /(吗|呢|对不对|是不是|好不好|行不行|想想看|你觉得)[？?]?$/.test(s);
  const isCheer = /(很好|太棒|厉害|不错|答对了|就是这样|真棒|有进步|非常好|漂亮)/.test(s);
  const isConcl = /(所以|因此|总之|一句话|结论|记住|关键是|要注意|划重点)/.test(s);
  const isStep = /(第一步|第二步|第三步|首先|然后|接着|最后|下一步|我们来看)/.test(s);
  const isDef = /(叫做|称为|定义为|记作|意思是|也就是说)/.test(s);
  const hasNum = /[0-9０-９]/.test(s) || /[+\-×÷=<>≈%°]/.test(s);

  if (isQuestion) { out.pitch = 1.07; out.rate = 0.97; out.pause = SPEECH_PAUSE.question; }
  else if (isCheer) { out.pitch = 1.05; out.rate = 0.99; out.pause = 220; }
  else if (isConcl) { out.pitch = 0.96; out.rate = 0.95; out.pause = SPEECH_PAUSE.concl; }
  else if (isDef || isStep) { out.rate = 0.96; out.pause = 240; }
  // 数字与算式放慢：听不清数字等于这节课白讲
  if (hasNum) out.rate = Math.min(out.rate, 0.94);
  // 很短的句子别拖长停顿，否则会一顿一顿
  if (s.length <= 10) out.pause = Math.min(out.pause, 150);
  return out;
}

/* 音色自然度分级：越靠前越像真人。既用于"优先挑好音色"，
   也用于**如实告诉用户当前用的是什么档**（设备只有老式音色时给安装建议，
   而不是让他以为产品就是个机器人嗓子）。 */
const VOICE_TIERS = [
  { tier: 4, re: /Natural|Neural|神经|自然音/i, label: '自然音色', hint: '接近真人' },
  { tier: 3, re: /Online|Premium|Enhanced|晓晓|晓伊|晓墨|晓涵|晓双|云希|云扬/i, label: '在线音色', hint: '较自然' },
  { tier: 2, re: /Google|Chrome|普通话|Tingting|婷婷|Huihui|慧慧|Yaoyao|瑶瑶|Kangkang/i, label: '常规音色', hint: '可用，略机械' },
];
function voiceTier(name) {
  const s = String(name || '');
  for (const t of VOICE_TIERS) if (t.re.test(s)) return t;
  return { tier: 1, re: null, label: '基础音色', hint: '偏机械' };
}

/* 把一段文本编成"朗读计划"：每项带自己的韵律与停顿。
   纯函数，便于单测。 */
function speechPlan(text, langId) {
  return splitSentences(text, langId)
    .map((s) => Object.assign({ text: s }, speechProsody(s)));
}

function speakOne(item) {
  return new Promise((resolve) => {
    // 兼容两种入参：朗读计划项 {text,rate,pitch,pause} 或纯字符串（旧调用/测试）
    const plan = (item && typeof item === 'object')
      ? item
      : Object.assign({ text: String(item == null ? '' : item) }, speechProsody(item));
    const text = plan.text;
    if (!TTS.supported || !TTS.enabled || !text) { resolve(); return; }
    if (!TTS.voice) TTS.voice = pickVoice();          // 语音可能晚到，临用前再取一次
    const u = new SpeechSynthesisUtterance(text);
    /* ★★ 2026-09-25 修「学生听不到老师说话」的真根因：
       这里原来直接 `u.voice = TTS.voice`，**没有保护**。而缓存下来的 voice 对象在真机上会失效
       （系统语音包更新/卸载、浏览器刷新语音列表、部分安卓 WebView 的兼容问题），
       此时给 u.voice 赋值会**直接抛异常**（"Failed to convert value to SpeechSynthesisVoice"）。
       后果不是"这一句没声"，见下面 drainSpeechQueue 的说明 —— 会**永久静音**。 */
    if (TTS.voice) {
      try {
        u.voice = TTS.voice;
      } catch (e) {
        // 赋值失败说明这个缓存对象已经没用了：丢掉它，下次重新挑一个，然后靠 locale 兜底
        try { console.warn('[tts] voice 对象失效，已丢弃并回退到 locale', e && e.message); } catch (_) {}
        TTS.voice = null;
        track('tts_voice_stale', {});
      }
    }
    // 音色缺失时按所选语言的 locale 兜底，别拿中文音色去念英文
    u.lang = (TTS.voice && TTS.voice.lang) || teachLangProfile().utteranceLang;
    // 用户语速 × 该句韵律微调（问句略慢、结论略沉稳、含数字更慢）
    u.rate = Math.max(0.5, Math.min(2, TTS.rate * (plan.rate || 1)));
    // 音高：原来 1.06 偏高，听感偏"播报"；回到 1.0 更像成年人正常说话，再按语气微调
    u.pitch = Math.max(0.5, Math.min(2, plan.pitch || 1.0));
    u.volume = 1;
    let started = false;
    let settled = false;
    const timers = [];
    // ★ 句间留白：人说话句间必有呼吸，一句接一句（零间隔）正是"像机器人"的主因之一
    const done = () => {
      /* ★★ 2026-09-27 改：让 done 幂等，并清掉所有兜底计时器。
         onend / onerror / 两条兜底都有可能来调它，重复 resolve 会叠加句间留白。 */
      if (settled) return;
      settled = true;
      timers.forEach((t) => { try { clearTimeout(t); } catch (_) {} });
      TTS._speakingNow = false;
      const wait = Math.max(0, Number(plan.pause) || 0);
      if (wait > 0 && TTS.enabled) setTimeout(resolve, wait);
      else resolve();
    };
    u.onstart = () => {
      started = true;
      TTS._stuckCount = 0;
      /* 记下"这节课累计成功发声多少句" —— 自检报告里要用它区分
         "从来没念过" 与 "念了但你没听到"（这两种的排查方向完全不同）。 */
      TTS._startedTotal = (TTS._startedTotal || 0) + 1;
      /* ★ 真的开口了 → 把"声音没出来"的常驻提示收起来（自愈）。
         注意：这里**不能**顺手把"没声音？"自检入口也隐藏 ——
         onstart 只证明"引擎接了活"，不证明**用户听到了**（静音开关/音量 0 时 onstart 照样触发）。
         那个入口只在自检里用户亲口答"听到了"之后才隐藏。 */
      try { hideTTSNotice(); ttsNotified = ''; } catch (_) {}
    };
    u.onend = done;
    u.onerror = done;
    TTS._speakingNow = true;
    /* ★★ 第三层防护（2026-09-25）：Chrome 有个老问题 —— 语音引擎会静默卡死，
       此时 onstart / onend / onerror **一个都不触发**，这个 promise 就永不 resolve，
       朗读队列跟着永久卡住（现象同样是"听不到老师"）。
       另外 Chrome 在页面切到后台后常把 synthesis 置为 paused，之后 speak 全部无声。
       所以：① 开始前若处于 paused 就 resume；② 超时未开口就 cancel 重置并跳过这一条，
       保证队列能继续往下走；③ 整段包 try/catch，任何异常都不许打断队列。 */
    if (!started) {
      try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch (_) {}
    }
    try {
      window.speechSynthesis.speak(u);
    } catch (e) {
      try { console.warn('[tts] speak 抛错，跳过这一条', e && e.message); } catch (_) {}
      done();
      return;
    }
    // 兜底 1：1.5 秒还没开始发音，说明被系统/浏览器拦了或引擎卡死 —— 说出来，别让用户干等
    timers.push(setTimeout(() => {
      if (started || settled) return;
      if (TTS.enabled) {
        notifyTTSProblem('silent');
        /* ★ 关键补上（2026-09-27，依据线上上报的 reason=silent）：
           光提示不够 —— 线上数据里用户在被拒之后**确实点过界面**，
           但产品不理会，用户感觉"点了也没用"。
           这里挂一次性手势重试：用户随手一点，就把这句重新排进队列、重新开口。 */
        armGestureRetry(text);
      }
      // 卡死的引擎只能靠 cancel 重置，否则整节课都读不出来
      try { window.speechSynthesis.cancel(); } catch (_) {}
      done();
    }, 1500));

    /* ★★ 兜底 2（2026-09-27 新增，修「还是没有声音」的真根因）：
       上面那条只在"**从未开口**"时生效（`if (started) return`）。但 Chrome 还有另一种更隐蔽的毛病：
       **开口了，但 onend / onerror 永远不触发**（长句、页面切到后台、cancel 之后、部分安卓 WebView）。
       此时这个 promise 永不 resolve → `await speakOne()` 挂死 →
       drainSpeechQueue 的 finally **永远不执行** → TTS.speaking 永久为 true →
       而 speak() 是 `if (!TTS.speaking) drainSpeechQueue()` →
       **之后老师说的每一句都被静默跳过**：队列越积越多、页面不报任何错、用户只感到"没声音"。
       （这与 09-25 修的"voice 对象失效"是同一个终局，但走的是另一扇门 —— 前两次修的都是"没开口"，
         这一次是"开口了不结束"，所以必须单独堵。）

       做法：加一条**与 started 无关**的总时长上限。按中文约 4 字/秒 × 语速估时长，给 2 倍余量 + 2.5 秒固定量。
       超时就 cancel 强制重置并 resolve，保证队列一定继续往下走。 */
    /* 上限的估算依据（**来自实测，不是估的**）：
       用真实引擎在这台机器上逐句朗读，实测约 **3.4 字/秒**：
         8 字 2.9s ｜ 16 字 4.7s ｜ 30 字 8.4s ｜ 45 字 11.5s ｜ 70 字 20.8s
       第一版我按 4 字/秒 估（比实测**快**），等效余量只剩 1.27x —— 设备更慢就可能说到一半被掐断。
       所以取 **3.2 字/秒**（比实测再慢一点，让估算偏长），再乘 1.5 倍余量 + 1.5 秒固定量。
       回归实测（真引擎，5 种长度）：全部自然结束，最紧的一句仍有 1.6x 余量。
       下限 4 秒：很短的句子不该被误杀。 */
    const estMs = Math.max(4000, Math.round((text.length / (3.2 * (u.rate || 1))) * 1000 * 1.5) + 1500);
    timers.push(setTimeout(() => {
      if (settled) return;
      try { window.speechSynthesis.cancel(); } catch (_) {}
      TTS._stuckCount = (TTS._stuckCount || 0) + 1;
      /* 偶尔卡一句是引擎的常态，不该每次都弹提示刷屏；
         但**连续**卡住说明这台设备基本读不出来 —— 那时必须告诉用户，并给可操作的出路。 */
      if (TTS._stuckCount >= 3 && TTS.enabled) notifyTTSProblem('silent');
      else { try { console.warn('[tts] 这一句超过预估时长仍未结束，已强制跳过（第 ' + TTS._stuckCount + ' 次）'); } catch (_) {} }
      try { track('tts_utterance_stuck', { len: text.length, n: TTS._stuckCount }); } catch (_) {}
      done();
    }, estMs));
  });
}

/* 入口：把一段文本加入朗读队列（顺序播放，不叠音） */
function speak(text) {
  if (!TTS.supported || !TTS.enabled) return;
  const plan = speechPlan(text);
  if (!plan.length) return;
  TTS.queue.push(...plan);
  if (!TTS.speaking) drainSpeechQueue();
}

async function drainSpeechQueue() {
  if (TTS.speaking) return;
  TTS.speaking = true;
  setSpeakingUI(true);
  /* ★★ 2026-09-25 修「学生听不到老师说话」的真根因（第二层）：
     原来 while 循环后面直接写 TTS.speaking = false —— 一旦 speakOne 抛异常，
     这两行**永远不会执行**，TTS.speaking 就永久卡在 true；
     而 speak() 里是 `if (!TTS.speaking) drainSpeechQueue()`，
     于是**此后每一次朗读都被直接跳过**：队列一直积压、老师永久静音、语音按钮状态也不对。
     只有打断或离开课堂才会复位 —— 学生在上课中途遇到就再也听不到老师了。
     实测现象：speaking=true、队列积压 3 条、一条都没发出去。
     修法：用 try/finally 保证状态一定复位，并逐条兜住异常（坏一句不能拖垮整节课）。 */
  try {
    while (TTS.queue.length && TTS.enabled) {
      const s = TTS.queue.shift();
      try {
        await speakOne(s);
      } catch (e) {
        // 单条失败只跳过这一条：绝不能让它中断整个队列
        try { console.warn('[tts] 单条朗读失败，已跳过', e && e.message); } catch (_) {}
      }
    }
  } finally {
    TTS.speaking = false;
    setSpeakingUI(false);
  }
}

function stopSpeech() {
  TTS.queue.length = 0;
  TTS.speaking = false;
  TTS._speakingNow = false;
  if (TTS.supported) { try { window.speechSynthesis.cancel(); } catch (_) {} }
  setSpeakingUI(false);
}

function toggleTTS(on) {
  TTS.enabled = typeof on === 'boolean' ? on : !TTS.enabled;
  const btn = $('#tb-voice');
  if (btn) {
    btn.classList.toggle('active', TTS.enabled);
    btn.querySelector('.mt-ico').textContent = TTS.enabled ? '🔊' : '🔈';
    btn.querySelector('.mt-label').textContent = TTS.enabled ? '朗读中' : '语音';
  }
  try { localStorage.setItem('lingxi_tts', TTS.enabled ? '1' : '0'); } catch (_) {}
  if (!TTS.enabled) { stopSpeech(); toast('已关闭语音朗读'); return; }
  if (!TTS.supported) { toast('当前浏览器不支持语音朗读', 'err'); TTS.enabled = false; return; }
  if (!TTS.voice) TTS.voice = pickVoice();
  // 浏览器要求首次发音由用户手势触发，这里正是点击事件，可安全"解锁"
  try {
    const warm = new SpeechSynthesisUtterance(' ');
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
  } catch (_) {}
  toast('已开启老师语音朗读（首次可能需 1 秒）', 'ok');
}

/* 用户是否**明确关闭过**语音（只有点过关闭才会写入 '0'） */
function ttsPrefOff() {
  try { return localStorage.getItem('lingxi_tts') === '0'; } catch (_) { return false; }
}

/* 恢复上次的语音偏好
   ⚠️ 2026-09-24 修：原来只在 saved === '1' 时开启，等于**首次使用必然无声** ——
   而"听不到老师讲课"对这个产品是致命的（它就是靠老师开口讲课）。
   现在改为默认开启，只有用户**主动关过**（saved === '0'）才保持关闭。
   注意必须**显式赋值**，不能依赖初始值 —— 自动化开启逻辑会改它。 */
function restoreTTSPref() {
  if (!TTS.supported) return;
  TTS.enabled = !ttsPrefOff();
  TTS.rate = loadSpeechRate();
  state.teachLang = loadTeachLang();
  TTS.voice = pickVoice();
  syncVoiceBtn();
}

/* 语音按钮状态同步（TTS.enabled → 按钮外观），空元素安全 */
function syncVoiceBtn() {
  const btn = $('#tb-voice');
  if (!btn) return;
  btn.classList.toggle('active', TTS.enabled);
  const ico = btn.querySelector('.mt-ico'); if (ico) ico.textContent = TTS.enabled ? '🔊' : '🔈';
  const lb = btn.querySelector('.mt-label'); if (lb) lb.textContent = TTS.enabled ? '朗读中' : '语音';
}

/* 语音可用性自检。
   为什么要自检：pickVoice() 拿不到语音时，浏览器会**静默不出声** ——
   用户点了「语音」、按钮也亮了，却什么也听不到，只会以为产品坏了。
   这类失败必须说出来，并且给出可操作的办法。 */
function ttsHealth() {
  if (!TTS.supported) return { usable: false, reason: 'unsupported', count: 0, hasZh: false };
  let vs = [];
  try { vs = window.speechSynthesis.getVoices() || []; } catch (_) { vs = []; }
  const hasZh = vs.some((v) => /zh|Chinese|中文|Xiaoxiao|Tingting|Huihui|Yaoyao|Mei[i-]?Jia/i.test((v.name || '') + ' ' + (v.lang || '')));
  if (!vs.length) return { usable: false, reason: 'no_voice', count: 0, hasZh: false };
  if (!hasZh) return { usable: true, reason: 'no_zh', count: vs.length, hasZh: false };
  return { usable: true, reason: 'ok', count: vs.length, hasZh: true };
}

  let ttsNotified = '';

  /* ★★ 2026-09-27 新增（依据线上真实上报）：
     数据库里有一条 `tts_unavailable { reason: "silent" }` —— 意思是
     **speak() 调了、但 1.5 秒内 onstart 从未触发：引擎拒绝发声**（浏览器要求用户手势、或引擎被拦）。
     而当时的处理是：提示一次 → 丢掉这句 → **永不重试**。

     上报里还有一条关键信息：用户在 2 分钟后**点过界面**（有真实手势了），
     但产品不理会 —— 于是用户的感觉是"我点了也没用，还是没声音"。

     所以这里挂一个**一次性手势重试**：等用户下一次点屏幕/按键，
     就 resume 引擎 + 把被丢掉的那句重新排进队列。
     这就是"让用户随手一点就能恢复"，而不是让他去猜要做什么。 */
  function armGestureRetry(text) {
    if (TTS._gestureArmed) return;            // 只挂一次，别叠监听器
    TTS._gestureArmed = true;
    TTS._pendingRetry = String(text || '');
    let hitWhy = 'gesture';                   // 记下是被什么触发的（上报时要区分）
    /* onVis 必须在 fire 之前声明：fire 里要 removeEventListener(onVis)，
       若 onVis 还在 TDZ 里而 fire 先被调用就会抛 ReferenceError。 */
    const onVis = () => {
      if (document.visibilityState === 'visible') { hitWhy = 'visible'; fire(); }
    };
    const fire = () => {
      document.removeEventListener('pointerdown', fire, true);
      document.removeEventListener('keydown', fire, true);
      document.removeEventListener('visibilitychange', onVis, true);
      TTS._gestureArmed = false;
      ttsNotified = '';                       // 允许"还是不行"时再提示一次（否则第二次就哑了）
      /* 重试逻辑统一走 retryPendingSpeech()：
         它做的是 cancel + 重取音色 + resume + 把被丢掉的那句重新排队
         （线上只报了 reason=silent，没法确证是哪种原因，所以三件事都做，成本都很低）。 */
      const did = retryPendingSpeech();
      if (did) { try { toast('已重新试着开口，稍等 1 秒…', 'ok'); } catch (_) {} }
      try { track('tts_gesture_retry', { how: hitWhy }); } catch (_) {}
    };
    /* ★ 为什么还要监听"回到前台"：
       Chrome 在页面切到后台时会**暂停 speechSynthesis**，此时发起的朗读 onstart 根本不触发 ——
       这正好产生 `reason:"silent"`。而学生的实际动作很可能就是：
       点「进入直播间」→ 趁 AI 生成切去别的窗口 → 切回来时老师已经哑了。
       所以"切回前台"本身就是最该重试的时刻，不该非要用户再点一下。 */
    document.addEventListener('pointerdown', fire, true);
    document.addEventListener('keydown', fire, true);
    document.addEventListener('visibilitychange', onVis, true);
  }

  /* ── 语音自检（2026-09-28）───────────────────────────────────────
     为什么必须做这个：产品有**一个自己看不见的盲区** ——
     引擎报告"我念完了"（onstart/onend 都触发），但用户因为
     系统音量 / iPhone 侧边静音开关 / 蓝牙耳机 / 标签页被静音 而**什么都听不到**。
     这种情况下所有自动检测与埋点都不触发，界面看起来完全正常，
     用户只能反复说"没声音"，而我远程查不出任何东西（这条已经卡了好几轮）。

     破解办法：让**用户的耳朵**当传感器。
       代码知道的事实：引擎有没有接受这次朗读（onstart）、onend 有没有回来、有没有音色…
       只有用户知道的事实：**到底有没有声音**。
     两者一组合，四种组合各自对应一个明确结论（见 renderSelfCheck）。 */

  /* 收集环境事实（都是能直接读到的，不含猜测） */
  function ttsFacts() {
    const f = {};
    try {
      const ss = window.speechSynthesis;
      f.hasApi = !!(ss && typeof ss.speak === 'function');
      const vs = (ss && ss.getVoices) ? (ss.getVoices() || []) : [];
      f.voices = vs.length;
      f.zhVoices = vs.filter((v) => /^zh/i.test(v.lang || '')).length;
      f.voiceName = TTS.voice ? (TTS.voice.name + ' / ' + TTS.voice.lang) : '(未选中)';
      f.paused = ss ? !!ss.paused : null;
      f.speaking = ss ? !!ss.speaking : null;
      f.pending = ss ? !!ss.pending : null;
      f.enabled = TTS.enabled;
      f.rate = TTS.rate;
      f.visible = document.visibilityState;
      f.focused = (typeof document.hasFocus === 'function') ? document.hasFocus() : null;
      const ua = navigator.userActivation;
      f.activated = ua ? !!ua.hasBeenActive : null;
      f.startedTotal = TTS._startedTotal || 0;
      f.stuck = TTS._stuckCount || 0;
      f.ua = String(navigator.userAgent || '').slice(0, 80);
    } catch (e) { f.err = String(e && e.message); }
    return f;
  }

  /* 念一句短句，看引擎接不接受。返回 { accepted, ended, ms } */
  function probeUtterance(text, timeoutMs) {
    return new Promise((resolve) => {
      const out = { accepted: false, ended: false, ms: 0, err: '' };
      let done = false;
      const finish = () => { if (done) return; done = true; out.ms = Date.now() - t0; resolve(out); };
      const t0 = Date.now();
      try {
        if (!TTS.supported) { out.err = 'no_api'; finish(); return; }
        try { window.speechSynthesis.cancel(); } catch (_) {}
        try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch (_) {}
        const u = new SpeechSynthesisUtterance(text);
        if (TTS.voice) { try { u.voice = TTS.voice; } catch (_) {} }
        u.lang = (TTS.voice && TTS.voice.lang) || teachLangProfile().utteranceLang;
        u.rate = TTS.rate || 1;
        u.volume = 1;
        u.onstart = () => { out.accepted = true; };
        u.onend = () => { out.ended = true; finish(); };
        u.onerror = (e) => { out.err = String((e && e.error) || 'error'); finish(); };
        window.speechSynthesis.speak(u);
        setTimeout(finish, timeoutMs || 3000);
      } catch (e) { out.err = String(e && e.message); finish(); }
    });
  }

  /* 在提示区里问一句"你听到了吗"，等用户点。只有他知道答案。 */
  /* ★ 自检要能在**两个地方**跑：
       · 课堂里（"没听到老师的声音？"入口）—— 结果渲染在字幕下面那条提示区
       · 声音设置面板里（不需要登录、不需要进课堂）—— 结果渲染在面板内
     为什么必须支持后者：进课堂要过**登录 + 手机号**两道门，而"没声音"的人
     很可能正卡在门外 —— 把诊断工具锁在他进不去的地方，等于没有。 */
  let ttsCheckHost = null;

  function askHeard() {
    return new Promise((resolve) => {
      const box = (ttsCheckHost && ttsCheckHost.box) || $('#tts-notice-result');
      if (!box) { resolve(null); return; }
      box.hidden = false;
      box.innerHTML = '';
      const q = document.createElement('div');
      q.className = 'tcr-q';
      q.textContent = '刚才那句「灵犀老师语音自检」，你听到了吗？';
      const btns = document.createElement('div');
      btns.className = 'tcr-btns';
      const yes = document.createElement('button');
      yes.className = 'btn btn-sm';
      yes.textContent = '✅ 听到了';
      const no = document.createElement('button');
      no.className = 'btn btn-sm';
      no.textContent = '🔇 没听到';
      const pick = (heard) => { btns.remove(); q.remove(); resolve(heard); };
      yes.addEventListener('click', () => pick(true));
      no.addEventListener('click', () => pick(false));
      btns.appendChild(yes);
      btns.appendChild(no);
      box.appendChild(q);
      box.appendChild(btns);
      try { box.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    });
  }

  const FACTS_LABEL = {
    hasApi: '语音接口', voices: '音色数', zhVoices: '中文音色', voiceName: '选中音色',
    paused: '引擎暂停中', speaking: '引擎正在读', pending: '引擎有排队', enabled: '朗读开关',
    rate: '语速', visible: '页面可见性', focused: '窗口聚焦', activated: '曾获用户激活',
    startedTotal: '本课已成功发声', stuck: '句中卡住次数',
  };

  function factsText(f) {
    return Object.keys(FACTS_LABEL)
      .filter((k) => f[k] !== undefined)
      .map((k) => FACTS_LABEL[k] + '：' + f[k]).join('\n');
  }

  /* 自检主流程：先读环境 → 再实测一句 → 再问用户听到没有 → 给结论
     `where` 决定结果渲染到哪儿，三个落点：
       · 'class'（默认，传空）→ 课堂提示区 #tts-notice-result
       · 'panel'（传 true）  → 声音设置面板 #voice-tts-result
       · 'auth'（传 'auth'） → 登录界面的试音结果区 #au-soundtest-result
     ★ 2026-09-29：新增 'auth' 落点，用来替掉原来"把课堂提示区搬进弹窗"的野路子。 */
  async function runTTSSelfCheck(fromModal) {
    const where = (fromModal === 'auth') ? 'auth' : (fromModal ? 'panel' : 'class');
    /* 先把"结果渲染到哪儿"定下来，后面几个函数都用它 */
    ttsCheckHost = (where === 'panel')
      ? {
        where: 'panel', box: $('#voice-tts-result'), title: $('#voice-tts-title'),
        why: $('#voice-tts-why'), ico: null, acts: null, fromModal: true,
      }
      : (where === 'auth')
        ? {
          where: 'auth', box: $('#au-soundtest-result'), title: $('#au-soundtest-title'),
          why: $('#au-soundtest-why'), ico: null, acts: null, fromModal: true,
        }
        : {
          where: 'class', box: $('#tts-notice-result'), title: $('#tts-notice-title'),
          why: $('#tts-notice-why'), ico: $('#tts-notice-ico'),
          acts: document.querySelector('.tts-notice-acts'), fromModal: false,
        };

    /* 课堂那条提示：只在课堂入口触发时才去动它（从设置面板/登录界面进来时不该影响课堂 UI） */
    if (where === 'class') showTTSNotice('checking');
    const title = ttsCheckHost.title;
    const why = ttsCheckHost.why;
    const box = ttsCheckHost.box;
    const acts = ttsCheckHost.acts;
    if (title) {
      /* 设置面板里的标题是固定的小标题，不自作主张改它；课堂提示区与登录界面才改 */
      if (where !== 'panel') title.textContent = '语音自检中…';
    }
    if (why) why.textContent = '会念一句给你听，大约 3 秒。请先把系统音量调到一半以上。';
    if (box) { box.hidden = false; box.innerHTML = ''; }
    if (box) {
      const t = document.createElement('div');
      t.className = 'tcr-q';
      t.textContent = '正在念一句给你听，请留意有没有声音…';
      box.appendChild(t);
    }
    if (acts) acts.style.display = 'none';       // 自检期间先把按钮收起来，避免误点
    try { track('tts_selfcheck_start', { fromModal: !!fromModal }); } catch (_) {}

    const facts = ttsFacts();
    const probe = await probeUtterance('灵犀老师语音自检，一二三四五。', 3000);

    let heard = null;
    if (probe.accepted) {
      heard = await askHeard();                   // 引擎接受过才问"听到了吗"
    }
    if (acts) acts.style.display = '';

    renderSelfCheck(facts, probe, heard);
    try {
      track('tts_selfcheck_result', {
        accepted: probe.accepted, ended: probe.ended, heard: heard === null ? 'na' : heard,
        voices: facts.voices, zh: facts.zhVoices, paused: facts.paused, vis: facts.visible,
      });
    } catch (_) {}
  }

  /* 结论矩阵：代码知道"引擎接不接受"，用户知道"有没有声音"，两两组合四种情况 */
  function renderSelfCheck(facts, probe, heard) {
    const host = ttsCheckHost || {};
    const box = host.box || $('#tts-notice-result');
    const title = host.title;
    const why = host.why;
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '';

    let head = '', todo = [], ok = false;

    if (!facts.hasApi) {
      head = '这个浏览器没有语音接口。';
      todo = ['换 Chrome 或 Edge 打开（手机上也一样）', '若是微信内打开，请点右上角「···」→ 用浏览器打开'];
    } else if (facts.voices === 0) {
      head = '浏览器在线，但**这台设备一个语音都没有**。';
      todo = [
        'Windows：设置 → 时间和语言 → 语音 → 添加「中文（简体）」语音包',
        'Mac：系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音（下载中文）',
        'Android：系统设置 → 语言与输入 → 文字转语音 → 安装中文语音数据',
        'iPhone：系统设置 → 辅助功能 → 朗读内容 → 声音 → 中文',
        '实在不行先用 Edge 打开（它带在线语音，不依赖系统语音包）',
      ];
    } else if (!facts.zhVoices) {
      head = '设备上有语音，但**没有中文语音** —— 读中文会没声或发音很怪。';
      todo = ['按上面同样的路径添加「中文」语音包', '或换 Edge 打开'];
    } else if (!probe.accepted) {
      head = '引擎**拒绝发声**（朗读指令发出去了，但它一声没吭）。';
      todo = [
        '先点「再试一次」（会重置引擎并换一个音色重读）',
        '若这一页曾被切到别的窗口/标签：切回来再多等 1 秒，浏览器会暂停语音引擎',
        '检查是否有另一个标签页正在朗读（同一浏览器同时只能有一路语音）',
        '刷新页面后，**先点任意位置再进课堂**（浏览器要求用户动作后才允许发声）',
      ];
    } else if (heard === false) {
      /* ★ 关键的一格：引擎明明说它念了，用户却没听到 —— 这是产品自己发现不了的情况 */
      head = '引擎说它念完了，但你没听到 —— 这是**声音输出**的问题，不是网页的问题。';
      todo = [
        'iPhone：**侧边静音开关**（拨到静音时网页语音会完全没声）',
        '系统音量是否为 0、是否静音',
        '蓝牙耳机/外接音响是否连上但没戴、或没通电',
        '浏览器标签页是否被右键「网站静音」（标签上会出现小喇叭斜杠）',
        '系统音量合成器里，浏览器这一路是否被单独调成 0（Windows）',
        '换一副耳机或换台设备试一句 —— 能立刻区分是"网页问题"还是"这台设备没声"',
      ];
    } else if (heard === true) {
      ok = true;
      head = '语音是好的 —— 刚才这句你听到了。';
      todo = ['如果课上还是没声，点「再试一次」，并把本条提示截图发给我'];
      /* 用户亲口确认听到了 → 课堂里那个"没声音？"入口从此不再出现（不再骚扰）。
         从设置面板进来时不碰课堂 UI。 */
      if (!(host && host.fromModal)) hideTTSCheckEntry();
    } else {
      head = '引擎接受了朗读，但没能确认你是否听到。';
      todo = ['点「再试一次」听一句；仍没声就再来一次自检'];
    }

    /* 课堂提示区 / 登录界面的标题、图标由我们掌管；设置面板里那个是固定的小标题，不改它。
       ★ 注意 `ico` 的兜底：原来是 `host.ico || $('#tts-notice-ico')` —— 在登录界面这条
       路径上会把**课堂**那块提示的图标改掉（跨落点污染）。现在按 where 精确分开。 */
    if (host && host.where !== 'panel') {
      if (title) title.textContent = ok ? '语音正常 ✅' : '语音自检结果';
      if (why) why.textContent = '';
      const ico = (host && host.ico) || (host && host.where === 'class' ? $('#tts-notice-ico') : null);
      if (ico) ico.textContent = ok ? '🔊' : '🔇';
    }

    const h = document.createElement('div');
    h.className = ok ? 'tcr-ok' : 'tcr-q';
    h.textContent = head;
    box.appendChild(h);

    if (todo.length) {
      const ul = document.createElement('ul');
      ul.className = 'tcr-todo';
      todo.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      box.appendChild(ul);
    }

    const pre = document.createElement('div');
    pre.className = 'tcr-facts';
    pre.textContent = '引擎接受朗读：' + (probe.accepted ? '是' : '否')
      + '｜读完回调：' + (probe.ended ? '是' : '否')
      + '｜耗时：' + probe.ms + 'ms'
      + (probe.err ? '｜错误：' + probe.err : '')
      + (heard === null ? '' : '｜你听到：' + (heard ? '是' : '否'))
      + '\n' + factsText(facts);
    box.appendChild(pre);

    if (facts.ua) {
      const ua = document.createElement('div');
      ua.className = 'tcr-facts';
      ua.textContent = 'UA：' + facts.ua;
      box.appendChild(ua);
    }
  }

  /* 一次性的"没声音？"入口：课堂开始 20 秒后出现（避免打扰），
     一旦确认听到过声音就永久隐藏（不再骚扰）。 */
  let ttsCheckEntryTimer = null;
  function armTTSCheckEntry() {
    const btn = $('#tts-check-entry');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => { btn.hidden = true; runTTSSelfCheck(); });
    if (ttsCheckEntryTimer) clearTimeout(ttsCheckEntryTimer);
    ttsCheckEntryTimer = setTimeout(() => {
      /* 已经确认听到过 → 不再显示 */
      if (TTS._heardOk) return;
      if (!state.live || state.live.ended) return;
      btn.hidden = false;
    }, 20000);
  }
  function hideTTSCheckEntry() {
    TTS._heardOk = true;
    const btn = $('#tts-check-entry');
    if (btn) btn.hidden = true;
    if (ttsCheckEntryTimer) { clearTimeout(ttsCheckEntryTimer); ttsCheckEntryTimer = null; }
  }

  /* ── 语音问题的常驻提示 ────────────────────────────────────────
     ★ 为什么要有它（2026-09-28）：线上只上报了 `tts_unavailable{reason:"silent"}`，
     我据此排查了很久；**但用户那边从头到尾只看到"没声音"三个字**——
     因为原来只有一条 2 秒就消失的 toast，而且是去重的一次性提示。
     这暴露了两个问题：
       ① 用户看不到原因，没法自助，也没法告诉我；
       ② 我把"查库"当成了主要诊断手段，可 track() 要求**已登录**——
          未登录的访客一条事件都没有，我却在拿"没有事件"当"没进过课堂"的证据（那是我推错了）。
     所以改成**把诊断放到用户眼前**：常驻、不自动消失、写明原因与办法、带一个能立刻点的「再试一次」，
     声音恢复正常后自己隐藏。这样无论登录与否，用户都能直接看到发生了什么。 */
  let ttsNoticeReason = '';

  /* ★ 自检入口的**事件绑定**必须放在页面初始化（init）里，不能放在 showTTSNotice 里。
     踩过的坑（2026-09-28，E2E 抓到）：我一开始把"声音设置面板里那个实测按钮"的绑定
     写在 showTTSNotice 里 —— 而 showTTSNotice **只在"语音出问题时"才会被调用**。
     于是语音正常（或还没出问题）时，那个按钮是个**点了没反应的死按钮**：
     入口看得见、点下去什么都不发生 —— 正是用户报的"看不到 / 点了没用"那一类。
     放在 init 里还有一个好处：它**不需要登录**，而进课堂要过登录 + 手机号两道门，
     正卡在门外的人依然能用到自检（这才是它存在的意义）。 */
  function bindTTSCheckButtons() {
    const check = $('#tts-notice-check');
    if (check && !check._bound) {
      check._bound = true;
      check.addEventListener('click', () => { runTTSSelfCheck(); });
    }
    const vcheck = $('#btn-voice-tts-test');
    if (vcheck && !vcheck._bound) {
      vcheck._bound = true;
      vcheck.addEventListener('click', () => {
        vcheck.hidden = true;                       // 结果出来后收起入口，避免重复点
        const t = $('#voice-tts-title');
        if (t) { t.hidden = false; t.textContent = '语音实测结果'; }
        runTTSSelfCheck(true);
      });
    }
    /* ★ 首页的"会前试音"入口：这是**唯一一个不需要登录就能到达**的自检入口
       （课堂里的那条要进课堂，声音设置面板要先进课堂再长按语音按钮）。
       点它 → 打开声音设置面板并直接跑实测，结果就显示在面板里。 */
    const hero = $('#btn-hero-soundtest');
    if (hero && !hero._bound) {
      hero._bound = true;
      hero.addEventListener('click', () => {
        openVoiceModal();
        const t = $('#voice-tts-title');
        if (t) { t.hidden = false; t.textContent = '语音实测结果'; }
        const v = $('#btn-voice-tts-test');
        if (v) v.hidden = true;
        runTTSSelfCheck(true);
      });
    }
  }

  function ttsNoticeTip(reason) {
    const tips = {
      unsupported: '这个浏览器不支持网页语音朗读（换 Chrome 或 Edge 就有声音）。老师会继续用字幕讲课。',
      no_voice: '这台设备还没装语音包。Windows：设置 → 时间和语言 → 语音 → 添加「中文（简体）」；或用 Edge 打开。',
      no_zh: '设备上没有中文语音，读中文会不自然。建议在系统里添加中文语音包，或用 Edge 打开。',
      silent: '朗读指令发出去了，但语音引擎没有出声。最常见的原因是这一页曾被切到后台（浏览器会暂停语音），'
        + '或系统/浏览器被静音。点「再试一次」通常就能恢复。',
      stuck: '语音引擎卡住了（某一句读了很久不结束）。已经自动跳过那一句，继续往下读。',
      checking: '会念一句给你听，大约 3 秒。请先把系统音量调到一半以上。',
    };
    return tips[reason] || '语音暂时不可用，老师会以字幕讲课。';
  }

  function showTTSNotice(reason) {
    const el = $('#tts-notice');
    if (!el) return;
    ttsNoticeReason = reason;
    const why = $('#tts-notice-why');
    if (why) why.textContent = ttsNoticeTip(reason);
    const ico = $('#tts-notice-ico');
    if (ico) ico.textContent = reason === 'ok' ? '🔊' : '🔇';
    const title = $('#tts-notice-title');
    if (title) title.textContent = (reason === 'no_voice' || reason === 'no_zh' || reason === 'unsupported')
      ? '这台设备暂时读不出声音' : '老师的声音没出来';
    el.hidden = false;
    /* 「再试一次」就是走同一条重置+重排路径（cancel / 重取音色 / resume / 重排那一句） */
    const retry = $('#tts-notice-retry');
    if (retry && !retry._bound) {
      retry._bound = true;
      retry.addEventListener('click', () => {
        ttsNotified = '';
        try { toast('正在重试语音…', 'ok'); } catch (_) {}
        retryPendingSpeech();
      });
    }
    /* 两个自检入口的事件绑定统一在 init 里的 bindTTSCheckButtons() 做 ——
       放在这里会让按钮在"还没出问题"时是死的（详见 bindTTSCheckButtons 的注释）。 */
    const x = $('#tts-notice-close');
    if (x && !x._bound) {
      x._bound = true;
      x.addEventListener('click', () => { el.hidden = true; });
    }
  }

  function hideTTSNotice() {
    const el = $('#tts-notice');
    if (el && !el.hidden) el.hidden = true;
    ttsNoticeReason = '';
  }

  /* 统一的"重置并重试"入口：cancel + 重取音色 + resume + 把被丢掉那句重新排队 */
  function retryPendingSpeech() {
    try { window.speechSynthesis.cancel(); } catch (_) {}
    try { TTS.voice = null; TTS.voice = pickVoice(); } catch (_) {}
    try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch (_) {}
    const t = TTS._pendingRetry || '';
    TTS._pendingRetry = '';
    if (t && TTS.enabled) {
      try { TTS.queue.unshift({ text: t, rate: 1, pitch: 1, pause: 0 }); } catch (_) {}
      if (!TTS.speaking) { try { drainSpeechQueue(); } catch (_) {} }
      return true;
    }
    /* 没有待重试的句子（比如问题出在设备无语音）→ 用一句话试音，好让用户立刻听到有没有恢复 */
    if (TTS.enabled) {
      try { TTS.queue.push({ text: '能听到我说话吗？', rate: 1, pitch: 1, pause: 0 }); } catch (_) {}
      if (!TTS.speaking) { try { drainSpeechQueue(); } catch (_) {} }
      return true;
    }
    return false;
  }

  /* 语音没出声时：常驻提示 + 一次性 toast
     ⚠️ 注意签名要保留 diag —— 函数体里在用（我上一版把参数删了却留着用法，会抛 ReferenceError）。 */
  function notifyTTSProblem(reason, diag) {
    /* ★ 常驻提示不受"只提示一次"的去重限制：它是要用户看清的，
       去重只用于避免 toast 刷屏。 */
    showTTSNotice(reason);
    if (ttsNotified === reason) return;
    ttsNotified = reason;
    /* ★ 2026-09-27：把**判断所需的现场信息**一起上报。
       线上只报了 `reason:"silent"`（speak 调了但引擎不开口），信息量太少，
       没法区分到底是"页面切到后台被 Chrome 暂停""引擎没有用户激活""音色失效"还是"设备真没声"。
       这些字段都能直接读到，下次一出问题就能从数据里定位，不用再猜。
       （注：track 要求已登录，访客不留痕 —— 所以真正托底的是上面那条**常驻提示**，
         它不依赖登录，用户自己就能看到原因。） */
    let info = diag || {};
    try {
      info.vis = (typeof document !== 'undefined' && document.visibilityState) || '';
      info.focus = (typeof document !== 'undefined' && typeof document.hasFocus === 'function') ? document.hasFocus() : null;
      const ua = (typeof navigator !== 'undefined' && navigator.userActivation) || null;
      info.act = ua ? !!ua.hasBeenActive : null;      // 页面是否曾获得过用户激活
      info.actNow = ua ? !!ua.isActive : null;
      const ss = (typeof window !== 'undefined' && window.speechSynthesis) || null;
      if (ss) {
        info.paused = !!ss.paused;
        info.ssSpeaking = !!ss.speaking;
        info.ssPending = !!ss.pending;
      }
      info.voices = (ss && ss.getVoices) ? (ss.getVoices() || []).length : 0;
    } catch (_) {}
    track('tts_unavailable', Object.assign({ reason: reason }, info));
    const tips = {
      unsupported: '当前浏览器不支持语音朗读，老师会以文字字幕讲课（换 Chrome / Edge 可听到声音）',
      no_voice: '这台设备没有安装语音包，老师暂时只能以字幕讲课。Windows：设置 → 时间和语言 → 语音 → 添加中文语音；或用 Edge 打开',
      no_zh: '设备上没有中文语音，老师读中文会不自然。建议在系统里添加中文语音包，或用 Edge 打开',
      /* silent = 引擎在，但拒绝发声。经验上最常见的是"页面在后台被 Chrome 暂停了语音"，
         所以文案直接给出"点一下"这个动作 —— 我们挂了手势/回到前台自动重试，点完真的会重试。 */
      silent: '老师的声音没能出来：**点一下屏幕任意处**就会重新试一次；若还是不行，请检查系统/浏览器是否静音',
    };
    toast(tips[reason] || '语音暂时不可用，老师会以字幕讲课', 'err');
  }

  /* 进入课堂时做一次自检：把"听不到老师"这件事在第一时间说清楚 */
function ensureVoiceReady() {
  // 用户明确关过语音 → 尊重，不自作主张打开（只在出问题时保持沉默，不打扰）
  const userOff = ttsPrefOff();
  if (!TTS.supported) { notifyTTSProblem('unsupported'); return; }
  if (!TTS.voice) TTS.voice = pickVoice();
  const h = ttsHealth();
  if (h.reason === 'ok') {
    if (!userOff) { TTS.enabled = true; syncVoiceBtn(); }
    return;
  }
  // 列表可能是异步就绪的，先给它一点时间再下结论
  if (h.reason === 'no_voice') {
    window.speechSynthesis.onvoiceschanged = () => {
      TTS.voice = TTS.voice || pickVoice();
      const h2 = ttsHealth();
      if (h2.reason === 'ok' && !ttsPrefOff()) { TTS.enabled = true; syncVoiceBtn(); }
    };
    setTimeout(() => {
      const h2 = ttsHealth();
      notifyTTSProblem(h2.reason === 'ok' ? 'silent' : h2.reason);
    }, 1800);
    return;
  }
  notifyTTSProblem(h.reason);
}

/* ---------- 教学引导强度（苏格拉底支持等级） ---------- */
function setGuide(level, opts) {
  const o = opts || {};
  if (!GUIDE_PROFILES[level]) level = 'balanced';
  state.guide = level;
  try { localStorage.setItem('lingxi_guide', level); } catch (_) {}
  renderGuideBtn();
  if (o.silent) return;
  const g = GUIDE_PROFILES[level];
  toast('已切换为「' + g.name + '」：' + g.tip, 'ok');
  // 让老师立刻感知到新的支持等级（隐藏指令，学生看不到）
  if (state.live && !state.live.ended) {
    sendLive('（学生把引导强度调整成了「' + g.name + '」。请从下一句开始就按新的节奏来，' +
      '不要解释这条设置。）', { hidden: true });
  }
}

function renderGuideBtn() {
  const btn = $('#tb-guide');
  if (!btn) return;
  const g = guideProfile();
  const ico = { more: '🤝', balanced: '⚖️', less: '🎯' }[state.guide] || '⚖️';
  const i = btn.querySelector('.mt-ico');
  const l = btn.querySelector('.mt-label');
  if (i) i.textContent = ico;
  if (l) l.textContent = g.name;
  btn.title = '引导强度：' + g.name + '（' + g.tip + '）';
  btn.classList.toggle('active', state.guide !== 'balanced');
}

function restoreGuidePref() {
  let saved = null;
  try { saved = localStorage.getItem('lingxi_guide'); } catch (_) {}
  if (saved && GUIDE_PROFILES[saved]) state.guide = saved;
  let meta = null;
  try { meta = localStorage.getItem('lingxi_meta'); } catch (_) {}
  if (meta === '0') state.meta = false;
  renderGuideBtn();
}

function toggleMeta(on) {
  state.meta = typeof on === 'boolean' ? on : !state.meta;
  try { localStorage.setItem('lingxi_meta', state.meta ? '1' : '0'); } catch (_) {}
  const btn = $('#guide-meta');
  if (btn) {
    btn.classList.toggle('on', state.meta);
    btn.setAttribute('aria-checked', state.meta ? 'true' : 'false');
  }
  toast(state.meta ? '已开启元认知提问：老师会常问"你卡在哪一步"' : '已关闭元认知提问');
}

/* 引导强度选择面板 */
function openGuideModal() {
  const m = $('#guide-modal');
  if (!m) return;
  const wrap = $('#guide-options');
  if (wrap) {
    wrap.innerHTML = Object.keys(GUIDE_PROFILES).map((k) => {
      const g = GUIDE_PROFILES[k];
      const ico = { more: '🤝', balanced: '⚖️', less: '🎯' }[k];
      return `<button class="guide-opt${state.guide === k ? ' cur' : ''}" data-guide="${k}">
        <span class="go-ico">${ico}</span>
        <span class="go-body"><b>${esc(g.name)}</b><small>${esc(g.tip)}</small></span>
        <span class="go-check">${state.guide === k ? '✓' : ''}</span>
      </button>`;
    }).join('');
  }
  m.hidden = false;
}
function closeGuideModal() {
  const m = $('#guide-modal');
  if (m) m.hidden = true;
}

/* 头像"开口说话"的视觉联动 */
function setSpeakingUI(on) {
  const av = $('#teacher-avatar');
  if (av) av.classList.toggle('talking', !!on);
  const wave = $('#voice-wave');
  if (wave && on) wave.classList.add('on');
  else if (wave && !on && !(state.live && state.live.busy)) wave.classList.remove('on');
  // 参会者列表里的老师状态
  const badge = $('#p-teacher-state');
  if (badge) badge.textContent = on ? '正在讲话' : '主讲 · AI 教师';
}

/* ============================================================
   多学生参会者 + 宫格视图
   ============================================================ */
const PEER_NAMES = ['小美', '子航', '若曦', '嘉禾', '一诺', '思远', '雨桐', '承宇'];
const PEER_AVATAR_COLORS = ['#F472B6', '#34D399', '#FBBF24', '#60A5FA', '#A78BFA', '#FB923C'];

/* 新参会者对象 */
function makePeer(name, idx) {
  return {
    id: 'peer-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    name: name || PEER_NAMES[idx % PEER_NAMES.length],
    color: PEER_AVATAR_COLORS[idx % PEER_AVATAR_COLORS.length],
    muted: Math.random() < 0.45,
    handUp: false,
    camOn: Math.random() < 0.7,
    isMe: false,
    isTeacher: false,
  };
}

/* 我的参会者对象 */
function mePeer() {
  const live = state.live;
  return {
    id: 'me', name: '你', color: '#6366F1', isMe: true,
    muted: live ? !!live.muted : false,
    handUp: live ? !!live.handUp : false,
    camOn: true,
  };
}

function teacherPeer() {
  return { id: 'teacher', name: '灵犀老师', color: '#F97316', isTeacher: true, muted: false, camOn: true };
}

/* 全部参会者（老师 + 我 + 同学们） */
function allPeers() {
  const live = state.live;
  if (!live) return [];
  // 学习助教是常驻角色（不是摆设）：它真的在随堂记录 —— 提问、错因、翻页进度
  // 都由页面实时采集，见 assistantLog()。之前它只写在静态 HTML 里，
  // 一开课就被 renderPeople() 重建掉，等于"到场就消失"。
  return [teacherPeer(), mePeer(), assistantPeer(), ...(live.peers || [])];
}

/* 学习助教：只做记录，不发言（不假装有人在线答疑） */
function assistantPeer() {
  return { id: 'assistant', name: '学习助教', isAssistant: true, muted: true, handUp: false };
}

/* 助教随堂记录：全部来自本节课真实采集到的事件，不编造 */
function assistantLog() {
  const live = state.live;
  if (!live) return { count: 0, items: [] };
  const rec = Array.isArray(live.recording) ? live.recording : [];
  const asks = rec.filter((e) => e && e.type === 'ask');
  const causes = [];
  rec.filter((e) => e && e.type === 'cause').forEach((e) => {
    (Array.isArray(e.v) ? e.v : []).forEach((c) => { if (causes.indexOf(c) < 0) causes.push(c); });
  });
  const slides = rec.filter((e) => e && e.type === 'slide');
  const items = [];
  if (causes.length) {
    const names = causes.map((c) => {
      const found = (typeof ERROR_CAUSES !== 'undefined' && ERROR_CAUSES[c]) ? ERROR_CAUSES[c] : null;
      return (found && (found.label || found.name)) || String(c);
    });
    items.push({ k: '原因', v: '记下 ' + causes.length + ' 类出错原因：' + names.join('、') });
  }
  if (asks.length) {
    const last = asks.slice(-2).map((e) => String(e.who || '你') + '："' + clipText(String(e.v || ''), 26) + '"');
    items.push({ k: '提问', v: '本节课提问 ' + asks.length + ' 次，最近：' + last.join('、') });
  }
  if (slides.length || live.slideIndex > 0) {
    const total = (live.course && live.course.slides) ? live.course.slides.length : 0;
    items.push({ k: '进度', v: '讲到第 ' + (live.slideIndex + 1) + (total ? ' / ' + total : '') + ' 页' });
  }
  return { count: items.length, items };
}

/* 把助教记录画到侧栏（课前/无记录时给出明确说明，而不是空着） */
function renderAssistantLog() {
  const box = $('#assistant-log');
  if (!box) return;
  const { count, items } = assistantLog();
  const live = state.live;
  if (!live) { box.innerHTML = '<p class="al-empty">进入课堂后，助教会在这里记下你需要关注的地方。</p>'; return; }
  box.innerHTML =
    '<div class="al-head">📋 助教随堂记录 <span class="al-n">' + count + '</span></div>' +
    (items.length
      ? '<ul class="al-list">' + items.map((it) => '<li><b>' + esc(it.k) + '</b>' + esc(it.v) + '</li>').join('') + '</ul>'
      : '<p class="al-empty">助教在听 —— 目前还没有记到需要特别关注的地方。你提问、答错或卡住的地方，助教会记在这里，下课后一并整理进小结。</p>');
  const badge = $('#p-assistant-state');
  if (badge) badge.textContent = count ? ('随堂记录 · 已记 ' + count + ' 条') : '随堂记录 · 待记录';
  // 聊天页的入口：学生默认停在聊天页，助教记了东西却不告诉他，等于白记
  const mini = $('#assistant-mini');
  if (mini) {
    if (!live) { mini.hidden = true; }
    else if (count) {
      mini.hidden = false;
      mini.innerHTML = '📋 助教随堂记录：<b>' + count + ' 条</b>（提问 / 出错原因 / 进度）<span class="al-mini-go">查看 ›</span>';
    } else {
      mini.hidden = false;
      mini.innerHTML = '📋 助教在记录你的课堂表现<span class="al-mini-go">看看有什么 ›</span>';
    }
  }
}

/* 切到"参会者"页并高亮助教记录 */
function focusAssistantLog() {
  const tab = document.querySelector('.side-tab[data-panel="people"]');
  if (tab) tab.click();
  const box = $('#assistant-log');
  if (!box) return;
  setTimeout(() => {
    try { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    box.classList.add('al-flash');
    setTimeout(() => box.classList.remove('al-flash'), 1800);
  }, 120);
}

/* 邀请一位同学加入 */
function invitePeer() {
  const live = state.live;
  if (!live) return;
  if (!live.peers) live.peers = [];
  if (live.peers.length >= 6) { toast('课堂最多 8 人（含老师和助教）'); return; }
  const p = makePeer(null, live.peers.length);
  live.peers.push(p);
  renderPeople();
  renderGallery();
  updatePeerCount();
  // 明确说清加入的是"模拟同学"：按钮原来写"邀请同学加入"，容易被理解成
  // 分享链接邀请真人 —— 这里给一句说明，避免期待落空（实测反馈）
  toast('「' + p.name + '」已进入课堂（模拟同学，用于讨论与提问练习）', 'ok');
  // 老师欢迎新同学
  if (!live.busy) {
    sendLive('（新同学 ' + p.name + ' 刚进入课堂，请简短欢迎一下，并问他/她是否跟得上。）', { hidden: true });
  }
}

/* 移除参会者 */
function removePeer(id) {
  const live = state.live;
  if (!live || !live.peers) return;
  const i = live.peers.findIndex((p) => p.id === id);
  if (i < 0) return;
  const name = live.peers[i].name;
  live.peers.splice(i, 1);
  renderPeople();
  renderGallery();
  updatePeerCount();
  toast('「' + name + '」已离开课堂');
}

function updatePeerCount() {
  const n = allPeers().length;
  const c = $('#people-count');
  if (c) c.textContent = String(n);
  const g = $('#gal-count');
  if (g) g.textContent = String(n);
}

/* 渲染参会者列表 */
function renderPeople() {
  const list = $('#people-list');
  if (!list) return;
  const live = state.live;
  if (!live) return;
  const peers = allPeers();
  list.innerHTML = peers.map((p) => {
    const badge = p.isTeacher
      ? '<small id="p-teacher-state">' + (TTS.speaking ? '正在讲话' : '主讲 · AI 教师') + '</small>'
      : p.isAssistant
        ? '<small id="p-assistant-state">随堂记录 · 待记录</small>'
        : p.isMe
          ? '<small>学生 · 参会者</small>'
          : '<small>学生 · 受邀参会' + (p.handUp ? ' · ✋ 已举手' : '') + '</small>';
    const av = p.isMe ? '我' : p.isTeacher ? '灵' : p.isAssistant ? '助' : esc(p.name.slice(0, 1));
    const avCls = p.isTeacher ? 'p-host' : p.isMe ? 'p-me' : p.isAssistant ? 'p-ta' : 'p-peer';
    const avStyle = (!p.isTeacher && !p.isMe && !p.isAssistant) ? ' style="background:' + p.color + '"' : '';
    const micId = p.isTeacher ? ' id="p-teacher-mic"'
      : p.isMe ? ' id="p-me-mic"' : '';
    // 学生自己那一路没有麦克风上行（课堂是文字问答 + 老师语音朗读），
    // 所以这里不能显示成"麦克风开启"，只显示一个中性提示，避免造成"老师在听我"的误解
    // 助教不做语音答疑，图标同样不显示为收音状态
    const mic = p.isMe
      ? '<span class="p-mic off" id="p-me-mic" title="课堂为文字问答；可用输入法语音键说话">💬</span>'
      : p.isAssistant
        ? '<span class="p-mic off" id="p-assistant-mic" title="助教只记录，不在课上发言">📝</span>'
        : ((p.muted)
          ? '<span class="p-mic off"' + micId + '>🔇</span>'
          : '<span class="p-mic on"' + micId + '>🎙</span>');
    const hand = p.handUp ? '<span class="p-hand">✋</span>' : '';
    const kick = (!p.isTeacher && !p.isMe && !p.isAssistant)
      ? '<button class="p-kick" data-kick="' + esc(p.id) + '" title="移出课堂">✕</button>' : '';
    return '<div class="person">' +
      '<span class="p-avatar ' + avCls + '"' + avStyle + '>' + av + '</span>' +
      '<div class="p-info"><b>' + esc(p.name) + '</b>' + badge + '</div>' +
      hand + mic + kick + '</div>';
  }).join('');
}

/* 渲染宫格 */
function renderGallery() {
  const grid = $('#gal-grid');
  if (!grid) return;
  const peers = allPeers();
  const n = peers.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
  grid.innerHTML = peers.map((p) => {
    const isSpeaking = p.isTeacher && (TTS.speaking || (state.live && state.live.busy));
    const off = !p.camOn;
    const av = p.isMe ? '我' : p.isTeacher ? '灵' : esc(p.name.slice(0, 1));
    const bg = p.isTeacher ? '#EEF0FF' : p.isMe ? '#EEF0FF' : p.color + '33';
    const fg = p.isTeacher ? '#6366F1' : p.isMe ? '#6366F1' : p.color;
    // 老师格子：有真人形象就显示照片
    const camInner = (p.isTeacher && AVATAR.ready)
      ? '<img class="gal-photo" src="' + AVATAR.thumb + '" alt="">' +
        (off ? '<span class="gal-off">摄像头已关闭</span>' : '')
      : '<span class="gal-av" style="background:' + bg + ';color:' + fg + '">' + av + '</span>' +
        (off ? '<span class="gal-off">摄像头已关闭</span>' : '');
    return '<div class="gal-tile' + (isSpeaking ? ' speaking' : '') + (off ? ' cam-off' : '') + '">' +
      '<div class="gal-cam">' + camInner + '</div>' +
      '<div class="gal-bar">' +
        '<span class="gal-name">' + esc(p.name) + (p.isTeacher ? ' <em>（主讲）</em>' : '') + '</span>' +
        '<span class="gal-mic">' + ((p.isMe ? state.live && state.live.muted : p.muted) ? '🔇' : '🎙') + '</span>' +
      '</div>' +
      (p.handUp ? '<span class="gal-hand">✋</span>' : '') +
      (isSpeaking ? '<div class="gal-wave"><i></i><i></i><i></i><i></i></div>' : '') +
      '</div>';
  }).join('');
}

function toggleGallery(force) {
  const g = $('#meet-gallery');
  if (!g) return;
  const show = typeof force === 'boolean' ? force : g.hidden;
  g.hidden = !show;
  const btn = $('#tb-gallery');
  if (btn) {
    btn.classList.toggle('active', show);
    btn.querySelector('.mt-label').textContent = show ? '返回画面' : '宫格';
  }
  if (show) renderGallery();
}

/* 参会者角色扮演：让某位同学"发言" */
async function peerAsk(id, question) {
  const live = state.live;
  if (!live || live.busy) return;
  const p = (live.peers || []).find((x) => x.id === id);
  if (!p) return;
  appendMessage('user', p.name + '：' + question, 'peer-msg');
  recordEvent('ask', question, { who: p.name });
  if (TTS.enabled) setCaptions(p.name + ' 正在提问…');
  await sendLive('（同学【' + p.name + '】举手提问："' + question + '"。请以老师身份先回应这位同学，' +
    '再顺势照顾一下全班其他同学的进度。）', { hidden: true, asPeer: p.name });
}

/* ============================================================
   课堂回放：录制时间轴事件（翻页 / 发言），课后可回放
   ============================================================ */
/* 回放事件上限。实测 51 秒课堂约 20 条 → 45 分钟约 1000 条，
   3000 条足够覆盖 2 小时以上的超长课堂；真到上限时丢**最旧**的，
   并留一条标记让回放界面知道开头被裁掉了（否则时间轴会莫名从中间开始）。 */
const REC_MAX_EVENTS = 3000;

function recordEvent(type, payload, extra) {
  const live = state.live;
  if (!live || !live.recStart) return;
  const t = (Date.now() - live.recStart) / 1000;
  const ev = Object.assign({ t: Math.round(t * 10) / 10, type: type, v: payload }, extra || {});
  live.recording.push(ev);
  if (live.recording.length > REC_MAX_EVENTS) {
    // 注意：标记插在最前面，而裁剪也是从最前面切 —— 所以每次裁剪后都要重新放回，
    // 否则它会被下一次裁剪顺手带走（我第一版就踩了这个坑，测试当场抓到）。
    // 裁到 REC_MAX_EVENTS - 1 再插入标记，长度就稳定在上限内。
    live.recording.splice(0, live.recording.length - (REC_MAX_EVENTS - 1));
    live.recording.unshift({ t: ev.t, type: 'trimmed', v: '（本节回放已超过上限，只保留最近的部分）' });
    live._recTrimmed = true;
  }
  // 助教记录是实时刷新的：刚记下的提问/错因立刻出现在侧栏，课后进小结
  if (type === 'ask' || type === 'cause') { try { renderAssistantLog(); } catch (_) {} }
}

/* 保存回放数据到课程对象（localStorage） */
/* 课堂进行中的检查点。
   ★ 2026-09-24 修：原来进度与回放**只在下课时**才落盘，
   学生上到一半刷新页面 / 网络断了重连，这节课的回放和进度就全没了（实测进度 0%、无回放）。
   现在每 30 秒 + 页面离开前各存一次，下课时再全量覆盖。
   开销很小（只在有新增录音事件时才写），但避免了"白上一节课"。 */
function checkpointLive() {
  const live = state.live;
  if (!live || live.ended || !live.course) return false;
  const rec = live.recording || [];
  if (!rec.length) return false;
  // 事件数没变就不必重复序列化整份课程列表（检查点每 30 秒跑一次）
  if (rec.length === live._cpEventCount) return false;
  live._cpEventCount = rec.length;
  const course = live.course;
  const idx = state.courses.findIndex((c) => c.id === course.id);
  if (idx < 0) return false;
  const seconds = Math.max(1, Math.round((Date.now() - (live.recStart || Date.now())) / 1000));
  // 回放与进度都用"到目前为止"的快照
  persistRecording(course, rec, seconds);
  const total = (course.outline && Array.isArray(course.outline.stages) && course.outline.stages.length) || 1;
  const stageIndex = Math.max(0, Math.min(total, (live.stageIndex || 0)));
  course.progress = Math.max(course.progress || 0, Math.min(1, (stageIndex + (seconds > 60 ? 1 : 0)) / total));
  state.courses[idx] = course;
  saveCourse(course, false);
  return true;
}

function startLiveCheckpoint() {
  stopLiveCheckpoint();
  liveCheckpointTimer = setInterval(() => { try { checkpointLive(); } catch (_) {} }, 30000);
  // 刷新/关页/切到后台时补存一次，覆盖"没等到 30 秒就离开"的情况
  if (!liveCheckpointBound) {
    liveCheckpointBound = true;
    window.addEventListener('beforeunload', () => { try { checkpointLive(); } catch (_) {} });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { try { checkpointLive(); } catch (_) {} }
    });
  }
}
function stopLiveCheckpoint() {
  if (liveCheckpointTimer) { clearInterval(liveCheckpointTimer); liveCheckpointTimer = null; }
}
let liveCheckpointTimer = null;
let liveCheckpointBound = false;

function persistRecording(course, recording, durationSec) {
  if (!recording || !recording.length) return;
  course.replay = {
    duration: Math.round(durationSec),
    events: recording,
    createdAt: Date.now(),
  };
  const idx = state.courses.findIndex((c) => c.id === course.id);
  if (idx >= 0) { state.courses[idx] = course; }
  markCourseDirty(course);          // ★ R02：下课存回放也是一次本地改动
  persistCourses();
}

/* ---------- 回放播放器 ---------- */
const replay = {
  course: null,
  events: [],
  duration: 0,
  t: 0,
  playing: false,
  speed: 1,
  raf: null,
  lastTick: 0,
  lastApplied: -1,   // 上一次应用的播放位置（用于判断是否需要回退重建）
  cursor: 0,         // 已应用事件指针
};

function openReplay(course) {
  if (!course || !course.replay || !course.replay.events || !course.replay.events.length) {
    toast('这节课还没有回放记录', 'err');
    return;
  }
  replay.course = course;
  replay.events = course.replay.events;
  track('replay_play', { course: String(course.title || '').slice(0, 80), seconds: Math.round(replay.duration || 0) });
  replay.duration = course.replay.duration || Math.max(1, replay.events[replay.events.length - 1].t);
  replay.t = 0;
  replay.playing = false;
  replay.cursor = 0;

  $('#replay-modal').hidden = false;
  $('#replay-title').textContent = '⏺ 回放 · ' + course.title;
  $('#rp-seek').max = String(Math.max(1, Math.round(replay.duration)));
  $('#rp-seek').value = '0';
  renderReplayMeta();
  renderReplayTimeline();
  applyReplayTo(0, true);
  updateReplayTime();

  // 若已有数字人视频，作为回放主画面
  if (course.avatarVideo) {
    renderReplayVideo(course);
  }
}

function renderReplayMeta() {
  const c = replay.course;
  const evs = replay.events;
  const talkCount = evs.filter((e) => e.type === 'speak').length;
  const slideCount = (c.slides || []).length;
  $('#replay-meta').innerHTML =
    '<div class="rm-row"><span>课程</span><b>' + esc(c.title) + '</b></div>' +
    '<div class="rm-row"><span>时长</span><b>' + fmtTime(replay.duration) + '</b></div>' +
    '<div class="rm-row"><span>课件</span><b>' + slideCount + ' 页</b></div>' +
    '<div class="rm-row"><span>讲解</span><b>' + talkCount + ' 段</b></div>' +
    '<div class="rm-row"><span>录制</span><b>' + fmtDate((c.replay && c.replay.createdAt) || Date.now()) + '</b></div>' +
    (c.avatarVideo ? '<div class="rm-row"><span>数字人</span><b class="rm-ok">已生成</b></div>' : '');
}

function renderReplayTimeline() {
  const wrap = $('#replay-timeline');
  const evs = replay.events;
  const total = Math.max(1, replay.duration);
  wrap.innerHTML = '<div class="tl-head">📌 时间轴（点击跳转）</div>' +
    evs.filter((e) => e.type === 'speak' || e.type === 'slide' || e.type === 'ask').map((e) => {
      const left = Math.min(100, (e.t / total) * 100);
      const ico = e.type === 'slide' ? '📊' : e.type === 'ask' ? '✋' : '💬';
      const short = String(e.v || '').slice(0, 46) + (String(e.v || '').length > 46 ? '…' : '');
      /* ★ 2026-09-24 修「回放里的幽灵发言」：ask 事件可能是**模拟同学**提的
         （recordEvent('ask', …, { who: 同学名 })），而时间轴原来只显示内容不显示发言人 ——
         学生看到一句自己没说过的话，会以为是自己说的。
         这里把发言人标出来，自己的发言也明确写"你"。 */
      const who = e.type === 'ask' ? String(e.who || '你') : '';
      const head = who ? '<b class="tl-who">' + esc(who) + '：</b>' : '';
      return '<div class="tl-item" data-seek="' + e.t + '">' +
        '<span class="tl-bar" style="left:' + left + '%"></span>' +
        '<span class="tl-ico">' + ico + '</span>' +
        '<span class="tl-t">' + fmtTime(Math.round(e.t)) + '</span>' +
        '<span class="tl-txt">' + head + esc(short) + '</span></div>';
    }).join('');
}

/* 把回放状态应用到 UI（t 秒处） */
function applyReplayTo(t, reset) {
  const c = replay.course;
  // 回退（seek 往回拖）：从头重建，避免残留
  const needRebuild = reset || (replay.lastApplied != null && replay.lastApplied > t);
  if (needRebuild) {
    replay.cursor = 0;
    replay.lastApplied = -1;
    $('#replay-cap').textContent = '';
    $('#replay-slide').innerHTML = '';
  }
  // 应用所有 t 之前的事件
  for (let i = replay.cursor; i < replay.events.length; i++) {
    const e = replay.events[i];
    if (e.t > t) break;
    replay.cursor = i + 1;
    if (e.type === 'slide') {
      const slides = c.slides || [];
      const s = slides[e.v];
      if (s) $('#replay-slide').innerHTML = slideHTML(s, e.v, slides.length, slideTheme(c));
    } else if (e.type === 'speak') {
      $('#replay-cap').textContent = e.v;
    } else if (e.type === 'ask') {
      // who 可能缺失（旧录制数据）—— 兜底成"你"，避免字幕出现 "undefined："
      $('#replay-cap').textContent = String(e.who || '你') + '：' + e.v;
    }
  }
  replay.lastApplied = t;
}

function updateReplayTime() {
  $('#rp-time').textContent = fmtTime(Math.round(replay.t)) + ' / ' + fmtTime(Math.round(replay.duration));
  $('#rp-seek').value = String(Math.min(replay.duration, Math.round(replay.t)));
}

function tickReplay(now) {
  if (!replay.playing) return;
  if (!replay.lastTick) replay.lastTick = now;
  const dt = (now - replay.lastTick) / 1000;
  replay.lastTick = now;
  replay.t += dt * replay.speed;
  if (replay.t >= replay.duration) {
    replay.t = replay.duration;
    applyReplayTo(replay.t);
    updateReplayTime();
    pauseReplay();
    return;
  }
  applyReplayTo(replay.t);
  updateReplayTime();
  replay.raf = requestAnimationFrame(tickReplay);
}

function playReplay() {
  if (replay.playing) return;
  if (replay.t >= replay.duration) { // 播完了重播
    replay.t = 0; replay.lastApplied = -1; applyReplayTo(0, true);
  }
  replay.playing = true;
  replay.lastTick = 0;
  $('#rp-play').textContent = '⏸';
  // 按钮只有符号 ▶/⏸，读屏念不出含义 —— 名字要跟着状态走
  try { $('#rp-play').setAttribute('aria-label', '暂停回放'); } catch (_) {}
  // 回放时同步朗读
  if (TTS.enabled) {
    const upcoming = replay.events.filter((e) => e.type === 'speak' && e.t >= replay.t).slice(0, 3);
    upcoming.forEach((e) => setTimeout(() => {
      if (replay.playing && TTS.enabled) speak(e.v);
    }, Math.max(0, (e.t - replay.t) * 1000 / replay.speed)));
  }
  replay.raf = requestAnimationFrame(tickReplay);
}

function pauseReplay() {
  replay.playing = false;
  if (replay.raf) cancelAnimationFrame(replay.raf);
  replay.raf = null;
  replay.lastTick = 0;
  $('#rp-play').textContent = '▶';
  try { $('#rp-play').setAttribute('aria-label', '播放回放'); } catch (_) {}
  stopSpeech();
}

/* 数字人视频回放画面 */
function renderReplayVideo(course) {
  const v = course.avatarVideo;
  if (!v) return;
  const url = (v && (v.url || v.videoUrl)) || '';
  if (!url) return;
  $('#replay-screen').classList.add('has-video');
  const old = $('#replay-screen .rp-video');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.className = 'rp-video';
  wrap.innerHTML = '<video src="' + esc(url) + '" controls playsinline preload="metadata"></video>' +
    '<span class="rp-video-tag">🎬 AI 数字人老师</span>';
  $('#replay-screen').insertBefore(wrap, $('#replay-screen').firstChild);
  $('#replay-cap').textContent = '数字人视频已嵌入，可与课件时间轴配合观看';
}

function closeReplay() {
  pauseReplay();
  $('#replay-modal').hidden = true;
  $('#replay-screen').classList.remove('has-video');
  const v = $('#replay-screen .rp-video');
  if (v) v.remove();
  replay.course = null;
  replay.events = [];
}

function seekReplay(sec) {
  sec = Math.max(0, Math.min(replay.duration, Number(sec) || 0));
  replay.t = sec;
  replay.lastApplied = -1;
  applyReplayTo(sec, true);
  updateReplayTime();
}

/* ============================================================
   数字人老师：真人形象 + 说话动效 + 演示视频
   ============================================================ */
/* ============================================================
   老师形象（插画）—— **唯一来源**
   三处复用：聊天头像 / "正在输入"占位 / 直播间画面。
   ★ 为什么要统一：原来这三处各画了一份，笔触还不一样（聊天头像是圆脸，
     直播间版本多了耳机），同一个老师在不同位置长得不同，很出戏。
   ★ 为什么默认用插画而不是真人照片：插画每一笔都可控，**不存在恐怖谷**。
     真人或 AI 生成形象一旦比例、神态、光影不对，小孩第一反应是"怪"而不是"亲切"。
     真人形象（assets/teacher-avatar.jpg）仍然保留，改为用户在「声音与形象」里主动选择。
   ★ 画法上的取舍：眼睛用**微笑的弧线**而不是圆眼珠 —— 弧线自带亲和感，
     圆眼珠在缩小到 32px 时会变成两个点，看起来发愣。
   ============================================================ */
function teacherFaceSVG(opts) {
  const o = opts || {};
  const size = o.size || 96;
  const headset = o.headset !== false;
  const gid = 'tf' + (o.uid || Math.floor(size));
  return '<svg viewBox="0 0 96 96" width="' + size + '" height="' + size + '" fill="none" aria-hidden="true">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#EEF1FF"/><stop offset="1" stop-color="#E2E7FF"/></linearGradient></defs>' +
    '<circle cx="48" cy="48" r="48" fill="url(#' + gid + ')"/>' +
    // 肩与衣领（靛蓝上衣，和品牌色一致）
    '<path d="M20 96c0-14 12.5-24 28-24s28 10 28 24z" fill="#6366F1"/>' +
    '<path d="M40.5 73.5 48 81l7.5-7.5" stroke="#E7EAFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    // 脖子
    '<path d="M41 62h14v9.5a7 7 0 0 1-14 0z" fill="#F3C09C"/>' +
    // 脸（鹅蛋脸，比正圆更柔和）
    '<path d="M48 23c11.6 0 19.5 8.6 19.5 20.8C67.5 56.4 58.8 65 48 65s-19.5-8.6-19.5-21.2C28.5 31.6 36.4 23 48 23z" fill="#FFD9BE"/>' +
    // 头发：刘海收在额头，两侧遮到耳上
    '<path d="M27.4 45.2C25.8 31.4 35.4 20.5 48 20.5s22.2 10.9 20.6 24.7c-.9-6-3-9.6-6.2-11.9-3.6 3.8-9 5.7-16 5.7s-11.9-1.9-15.5-5.7c-3.2 2.3-5.3 5.9-6.2 11.9z" fill="#4A3F4C"/>' +
    // 腮红（低透明度，避免"假脸"）
    '<ellipse cx="35.8" cy="50.6" rx="5.2" ry="3.2" fill="#F79C8E" opacity="0.32"/>' +
    '<ellipse cx="60.2" cy="50.6" rx="5.2" ry="3.2" fill="#F79C8E" opacity="0.32"/>' +
    // 微笑的眼睛（弧线）
    '<path d="M39.4 45.6c1.7-2.1 4.5-2.1 6.2 0" stroke="#3F3D56" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M50.4 45.6c1.7-2.1 4.5-2.1 6.2 0" stroke="#3F3D56" stroke-width="2.2" stroke-linecap="round"/>' +
    // 鼻
    '<path d="M48 50.2v3" stroke="#E8AE8C" stroke-width="1.6" stroke-linecap="round"/>' +
    // 温柔的笑
    '<path d="M43 57.6c2.7 3.3 7.3 3.3 10 0" stroke="#C97B5A" stroke-width="2.2" stroke-linecap="round"/>' +
    // 耳机（直播课形象：老师在上课）
    (headset
      ? '<path d="M25 44.5a23 23 0 0 1 46 0" stroke="#F97316" stroke-width="3.2" stroke-linecap="round"/>' +
        '<rect x="18.6" y="42.5" width="8.6" height="12.4" rx="4.3" fill="#F97316"/>' +
        '<rect x="68.8" y="42.5" width="8.6" height="12.4" rx="4.3" fill="#F97316"/>'
      : '') +
    '</svg>';
}

/* 老师形象偏好：默认插画（安全），真人照片需用户主动选择 */
const AVATAR_STYLE_KEY = 'lingxi_avatar_style';
function avatarStyle() {
  try { return localStorage.getItem(AVATAR_STYLE_KEY) === 'photo' ? 'photo' : 'illust'; } catch (_) { return 'illust'; }
}
function setAvatarStyle(style) {
  const v = style === 'photo' ? 'photo' : 'illust';
  try { localStorage.setItem(AVATAR_STYLE_KEY, v); } catch (_) {}
  applyAvatarStyle();
  if (window.speechSynthesis) { /* 无需重载 */ }
  return v;
}

/* 把选择应用到界面：照片层与插画层二选一。
   注意：照片加载失败时**自动回退插画**，绝不出现空白或裂图。 */
function applyAvatarStyle() {
  const style = avatarStyle();
  const photo = $('#teacher-photo');
  const illust = $('#teacher-avatar');
  const wantPhoto = style === 'photo' && AVATAR.ready;
  if (photo) photo.hidden = !wantPhoto;
  if (illust) illust.style.display = wantPhoto ? 'none' : '';
  // 切到真人时才去创建/加载那个 4.6MB 的视频（插画形象下不碰它）
  try { initAvatarVideo(); } catch (_) {}
  renderVoiceSettings();
}

const AVATAR = {
  photo: 'assets/teacher-avatar.jpg',
  thumb: 'assets/teacher-thumb.jpg',
  video: 'assets/teacher-demo.mp4',
  ready: false,
  videoReady: false,
};

/* 探测资源是否存在，存在则切到真人形象 */
function initAvatar() {
  const img = $('#teacher-img');
  if (!img || img.dataset.bound) return;
  img.dataset.bound = '1';
  /* ★ 2026-09-24 改：照片加载成功后**不再自动顶掉插画**。
     原来只要 assets/teacher-avatar.jpg 存在，就会把插画换成真人照片 ——
     而真人/AI 生成形象一旦神态或比例不对，小孩会觉得"怪"。
     现在默认用插画（每一笔都可控、不存在恐怖谷），真人形象改为
     用户在「声音与形象」里主动选择（avatarStyle()），且加载失败自动回退插画。 */
  img.onload = () => {
    AVATAR.ready = true;
    applyAvatarStyle();
    if ($('#gal-grid')) renderGallery();
  };
  img.onerror = () => {
    AVATAR.ready = false;      // 照片不可用 → 永远走插画，不会出现空白或裂图
    applyAvatarStyle();
  };
  img.src = AVATAR.photo;
}

/* 数字人视频资源探测与展示（头像 HTML 生成曾有一份无人调用的重复实现，已删） */
function openAvatarModal() {
  const live = state.live;
  const course = live ? live.course : null;
  if (!course) { toast('请先进入课堂', 'err'); return; }
  const has = !!course.avatarVideo;
  $('#avatar-body').innerHTML =
    '<div class="av-intro">' +
      '<div class="av-preview">' +
        '<img src="' + AVATAR.thumb + '" alt="灵犀老师形象">' +
        '<span class="av-tag">🎬 灵犀老师形象视频</span>' +
      '</div>' +
      '<div class="av-desc">' +
        '<b>让课堂画面出现会讲话的老师形象视频</b>' +
        '<p>使用已准备好的灵犀老师形象片段，替掉手绘头像，让直播画面更接近真人授课。</p>' +
        '<ul class="av-notes">' +
          '<li>这是一段固定的循环片段，不是为每节课单独生成的视频</li>' +
          '<li>点击后即时生效，下课后在「课堂回放」里也能看到</li>' +
          '<li>不需要额外付费，也不消耗任何积分</li>' +
        '</ul>' +
        (has ? '<p class="av-has">✅ 本节课已启用老师形象视频，可直接前往回放观看。</p>' : '') +
      '</div>' +
    '</div>';
  // 内联 onerror 会被 CSP 拦，改成事件监听（图片加载失败时隐藏，不破坏页面）
  const avImg = $('#avatar-body img');
  if (avImg) avImg.addEventListener('error', () => { avImg.style.display = 'none'; });
  $('#btn-avatar-gen').textContent = has ? '重新应用' : '用这段视频';
  $('#avatar-modal').hidden = false;
}

/* 把已生成的视频挂到直播画面 & 回放 */
function applyAvatarVideo(course) {
  const v = course && course.avatarVideo;
  if (!v) return;
  AVATAR.videoReady = true;
  const url = v.url || v.videoUrl;
  if (!url) return;
  // 直播间：主画面加一个循环播放的数字人视频层
  const host = $('#teacher-video');
  if (host && !$('#teacher-video .tp-livevideo')) {
    const d = document.createElement('div');
    d.className = 'tp-livevideo';
    d.innerHTML = '<video src="' + esc(url) + '" autoplay loop muted playsinline></video>';
    host.appendChild(d);
  }
}

/* 数字人视频（assets/teacher-demo.mp4，4.6MB）
   ★ 2026-09-24 性能修复：原来这个 video 元素在**启动时**就被创建，src 直接指向 4.6MB 的 mp4，
     而本页的静态服务器**不支持 Range 请求** —— 于是 preload="metadata" 实际会把整个文件拉下来。
     实测首屏合计 6.19MB 里有 4665KB 是它（占 75%），在慢网络上足以让首屏卡住。
     现在：① 默认形象是插画，视频**根本不创建**；只有用户主动选"真人形象"时才加载；
           ② 即便创建也用 preload="none"，绝不预取。 */
function initAvatarVideo() {
  const host = $('#teacher-video');
  if (!host) return;
  if (avatarStyle() !== 'photo') return;      // 插画形象不需要视频，一个字节都不拉
  if (host.querySelector('.tp-video')) {      // 已初始化，避免重复插入
    const ex = host.querySelector('.tp-video');
    if (AVATAR.ready) ex.style.display = '';
    return;
  }
  const v = document.createElement('video');
  v.className = 'tp-video';
  v.id = 'tp-video';
  v.src = AVATAR.video;
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'none';                          // 服务器不支持 Range，绝不让它预取整个文件
  v.style.display = 'none';
  v.addEventListener('loadeddata', () => {
    AVATAR.videoReady = true;
    if (AVATAR.ready) v.style.display = '';
  });
  v.addEventListener('error', () => { v.style.display = 'none'; AVATAR.videoReady = false; });
  host.insertBefore(v, host.firstChild);
  // 有照片时也尝试播放（照片作为封面，视频作为动态层）
  // 注意：play() 在不同引擎下可能返回 undefined 或抛同步异常，必须整体兜住，
  // 否则异常会冒泡到 init()，导致后续所有事件绑定失败（页面看起来"点不动"）
  try {
    const p = v.play && v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) { /* 自动播放被拦截时静默 */ }
}

/* 应用 / 取消数字人视频到当前课程
   注意：这里**没有生成能力**（生成走外部视频服务，平台未提供）。
   之前按钮叫"生成数字人视频"、文案许诺"1-3 分钟、消耗积分"，全是假的 —— 改掉了。 */
async function generateAvatarVideo() {
  const live = state.live;
  const course = live ? live.course : null;
  if (!course) { toast('请先进入课堂', 'err'); return; }
  const btn = $('#btn-avatar-gen');
  btn.disabled = true;
  btn.textContent = '正在应用…';

  // 探测随站点一起部署的老师形象视频
  const url = await probeVideo(AVATAR.video);
  btn.disabled = false;

  if (!url) {
    btn.textContent = '用这段视频';
    toast('老师形象视频暂时不可用，先用头像上课吧', 'err');
    return;
  }

  course.avatarVideo = { url: url, poster: AVATAR.photo, createdAt: Date.now() };
  const i = state.courses.findIndex((c) => c.id === course.id);
  if (i >= 0) { state.courses[i] = course; }
  markCourseDirty(course);          // ★ R02
  persistCourses();

  applyAvatarVideo(course);
  renderCourses();
  $('#avatar-modal').hidden = true;
  toast('老师形象视频已启用，可进入课堂或回放观看', 'ok');
}

/* 初始化时探测一次：站点里没有老师形象视频，就把入口藏起来 ——
   绝不让入口把学生带进一个注定失败的弹窗。
   ★ 探测走 probeVideo()，它现在是 HEAD 优先（不会把 4.6MB 拉下来）。 */
async function initAvatarVideoEntry() {
  const btn = $('#tb-avatar');
  if (!btn) return;
  if (typeof fetch !== 'function') return;      // 极老环境直接跳过，不冒险
  const url = await probeVideo(AVATAR.video);
  AVATAR.videoReady = !!url;
  if (!AVATAR.videoReady) btn.hidden = true;
}

/* 探测媒体资源是否可用
   ★ 2026-09-24 性能修复：原来只用 <video preload="metadata"> 探测，而本页的静态服务器
   **不支持 Range 请求**（实测响应头没有 Accept-Ranges）—— 于是浏览器没法只取头部，
   会把**整个 4.6MB** 视频拉下来，只为判断"文件在不在"。
   实测这就是首屏 5.3MB 里最大的一块。
   现在先发 HEAD（实测 0.86s、零正文），拿不到结果才退回原来的 video 探测。 */
function probeVideo(src) {
  // fetch 在很老的环境/测试环境里可能不存在，或同步抛出 —— 都要能退回原路径
  if (typeof fetch !== 'function') return probeVideoByElement(src);
  let p;
  try { p = fetch(src, { method: 'HEAD' }); } catch (_) { return probeVideoByElement(src); }
  return Promise.resolve(p)
    .then((r) => {
      if (r && r.ok) return src;
      // 405/501 = 服务器不支持 HEAD，或 403 等 → 交给下面的兜底探测
      return probeVideoByElement(src);
    })
    .catch(() => probeVideoByElement(src));   // 跨域/断网 → 兜底
}
function probeVideoByElement(src) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok ? src : null); } };
    v.preload = 'metadata';
    v.onloadedmetadata = () => finish(true);
    v.onerror = () => finish(false);
    v.src = src;
    setTimeout(() => finish(false), 6000);
  });
}

/* ---------- 登录态失效（401）的识别与自愈 ----------
   背景：SDK 只在会话「即将过期」时才去刷新。若本地残留一个 expiresAt 未到、
   但已被服务端判废的会话，SDK 会一直带着它发请求，云端持续返回
   401 invalid_grant —— 页面就永久卡在「AI 暂不可用」，而云端 AI 其实是好的。
   这里补三件事：识别这种错误、清掉残留会话（自愈）、匿名重试。 */

/* 兼容两种错误形态：
   ① LLM 调用：CloudOpenAIError，code 在 e.error.code，HTTP 状态在 e.status
   ② 云服务 auth/db：普通对象 { kind, message, status, code } */
function isAuthError(e) {
  if (!e) return false;
  if (e.status === 401 || e.status === 403) return true;
  if (e.kind === 'unauthenticated' || e.kind === 'permission-denied') return true;
  const inner = e.error;
  if (typeof inner === 'string') return /invalid_grant|unauthorized|unauthenticated/i.test(inner);
  if (inner && typeof inner === 'object') {
    if (inner.code === 'invalid_grant') return true;
    if (inner.kind === 'unauthenticated' || inner.kind === 'permission-denied') return true;
    if (typeof inner.type === 'string' && /auth|permission/i.test(inner.type)) return true;
  }
  return typeof e.message === 'string' && /invalid_grant|HTTP\s*40[13]/i.test(e.message);
}

let healInflight = null;
/* 自愈：凭据被服务端拒绝 → 清掉本地残留会话，随后以访客身份重试即可恢复。
   网络/后端故障不动登录态，避免把好端端的登录误登出。返回 true 表示确实清理过。 */
async function healSession() {
  if (healInflight) return healInflight;
  const auth = state.cloud && state.cloud.auth;
  healInflight = (async () => {
    if (!auth) return false;
    let r;
    try {
      if (typeof auth.refreshSession === 'function') r = await auth.refreshSession();
      else return false;
    } catch (_) { return false; }
    if (!r) return false;
    if (r.data) return false;                                  // 刷新成功，账号仍在
    if (!r.error || !isAuthError(r.error)) return false;        // 网络/后端问题：不登出
    // 凭据被判废：SDK 内部已清存储，这里再兜一层，确保不会二次踩坑
    if (typeof auth.signOut === 'function') { try { await auth.signOut(); } catch (_) {} }
    state.user = null; state.mem = null; state.memLoaded = false;
    try { authUI(); renderMemoryView(); } catch (_) {}
    // 不能静默变未登录：用户会以为"莫名其妙被登出"（曾在课堂中途发生）
    try {
      track('session_expired', {});
      toast('登录状态已过期，请重新登录。你的课程与学习记录都还在。', 'err');
    } catch (_) {}
    return true;
  })();
  try { return await healInflight; } finally { healInflight = null; }
}

/* 启动时先校验本地会话：getUser 会打到服务端，凭据失效时 SDK 自己就会清存储。
   返回 true 表示清掉了失效会话。 */
async function ensureSessionHealthy() {
  const auth = state.cloud && state.cloud.auth;
  if (!auth || typeof auth.getSession !== 'function') return false;
  let alive = false;
  try {
    const s = await auth.getSession();
    alive = !!(s && s.data && s.data.accessToken);
  } catch (_) {}
  if (!alive) return false;
  try {
    const r = await auth.getUser();
    if (r && r.error && isAuthError(r.error)) return await healSession();
  } catch (_) {}
  return false;
}

/* ============================================================
   AI 调用闸门（成本保护 —— 这是额度账本上唯一的防线）
   为什么必须有：模型调用走平台免密钥通道，消耗的是**应用创建者的平台额度**；
   而平台不暴露剩余额度（SDK 没有用量/额度接口，模型清单里的 credits 只是展示文案），
   错误码 quota_ 只会在额度真的烧完时才出现 —— 那时已经晚了。
   所以边界必须自己设：每分钟 + 每天 + 连续失败冷却，本地按设备计数。
   局限要说清：客户端计数可被清缓存绕过，它不是安全机制，只是"防止链接扩散后
   被一次性抽干"的兜底。真要强隔离得靠账号级配额（平台暂未提供）。
   ============================================================ */
const AI_LIMIT = {
  perMinute: 6,       // 每分钟最多 6 次：防连点、防脚本刷
  perDay: 80,         // 每设备每天最多 80 次（一节完整课约 6-8 次，够上 10 节课）
  failStreak: 4,      // 连续失败 4 次
  cooldownMs: 60000,  // 进入 1 分钟冷却（避免模型侧故障时被无限重试烧额度）
};
const AI_GATE_KEY = 'lingxi.ai.gate.v1';

function aiGateRead() {
  const today = new Date().toISOString().slice(0, 10);
  let s = null;
  try { s = JSON.parse(localStorage.getItem(AI_GATE_KEY) || 'null'); } catch (_) { s = null; }
  if (!s || typeof s !== 'object' || s.day !== today) s = { day: today, count: 0, marks: [], fails: 0, until: 0 };
  if (!Array.isArray(s.marks)) s.marks = [];
  return s;
}
function aiGateWrite(s) {
  try { localStorage.setItem(AI_GATE_KEY, JSON.stringify(s)); } catch (_) {}
}
/* 闸门检查：返回 {ok:true} 或 {ok:false, msg} */
function aiGateCheck() {
  const now = Date.now();
  const s = aiGateRead();
  if (s.until && now < s.until) {
    const secs = Math.ceil((s.until - now) / 1000);
    return { ok: false, code: 'cooldown', msg: `AI 刚刚连续出错，已暂停 ${secs} 秒，稍等一下再试（避免重复请求继续消耗额度）。` };
  }
  const recent = s.marks.filter((t) => now - t < 60000);
  if (recent.length >= AI_LIMIT.perMinute) {
    return { ok: false, code: 'minute', msg: `操作有点快 —— 每分钟最多 ${AI_LIMIT.perMinute} 次 AI 请求，请等一分钟再继续。` };
  }
  if (s.count >= AI_LIMIT.perDay) {
    return { ok: false, code: 'day', msg: `今天的免费体验次数已用完（每天 ${AI_LIMIT.perDay} 次），明天会自动恢复。已经生成的课程和数据都还在。` };
  }
  return { ok: true };
}
/* 记一次调用结果；失败连续到阈值就进冷却 */
function aiGateRecord(ok) {
  const now = Date.now();
  const s = aiGateRead();
  s.marks = s.marks.filter((t) => now - t < 60000);
  s.marks.push(now);
  if (ok) {
    s.count = (s.count || 0) + 1;
    s.fails = 0;
    s.until = 0;
  } else {
    s.fails = (s.fails || 0) + 1;
    if (s.fails >= AI_LIMIT.failStreak) {
      s.until = now + AI_LIMIT.cooldownMs;
      s.fails = 0;
    }
  }
  aiGateWrite(s);
}
function aiGateError(gate) {
  const msg = (gate && gate.msg) || 'AI 调用已达上限，请稍后再试。';
  const e = new Error(msg);
  e.name = 'CloudOpenAIError';
  e.kind = 'invalid-request';
  e.status = 0;
  e.code = 'local_ai_gate';
  // errCode() 读的是 e.error.code（与服务端错误同构），这里必须同样嵌套，
  // 否则 mapLLMError 认不出这是本地闸门拦下的请求
  e.error = { message: msg, type: 'client_error', param: null, code: 'local_ai_gate' };
  return e;
}
/* 供"我的数据/排查"用：当前设备的用量快照 */
function aiGateSnapshot() {
  const s = aiGateRead();
  return { day: s.day, used: s.count || 0, limit: AI_LIMIT.perDay, cooldownUntil: s.until || 0 };
}

/* ============================================================
   埋点：只写事件，不阻塞任何交互
   目的：回答"测评→上课"漏斗、"差异化机制有没有被真用"、"AI 讲解在哪出错"。
   写入失败一律静默 —— 埋点绝不能影响上课。
   隐私：只记事件名与必要上下文（不放对话全文），且只有本人能读自己那几行；
   产品侧想看聚合数据，用管理端 SQL 读（客户端读不到别人的）。
   ============================================================ */
const TRACK_EVENTS = [
  'course_generate',   // 生成课程方案
  'diag_generate',     // 出诊断卷
  'diag_complete',     // 提交诊断（测评完成）
  'class_start',       // 进入直播间
  'interrupt_ask',     // 打断提问（差异化机制是否被真用）
  'live_ask',          // 课堂内提问（含快捷提问，未打断也在问）
  // 注：曾经声明过 'quiz_answer' 但从未调用 —— 练习页只展示题干/答案，
  //     学生是**口头作答**给老师，没有可埋的应用内交互点，所以移除，避免误导。
  'class_end',         // 下课
  'summary_view',      // 看课堂小结
  'flashcard_open',    // 点开闪卡（主动回忆）
  'replay_play',       // 看回放
  'ai_correction',     // 学生反馈"这里讲错了"
  'phone_register',    // 登记手机号
  'device_conflict',   // 同一设备出现多个账号（多开风控信号）
  'phone_gate',        // 手机号门禁触发（blocked=被拦的动作 / path=later|no_phone）
  'mail_blocked',      // 一次性邮箱被拦（domain=域名）
  'phone_shared',      // 手机号在多个账号间共用（家长共用号等，仅统计不拦）
  'teach_lang',        // 切换授课语言（lang=zh|en）
  'session_expired',   // 凭据被判废、被动登出（用于排查"莫名被登出"）
  'storage_full',      // 本机存储写满、课程未能落盘（loggedIn=是否已登录）
  'tts_unavailable',   // 设备无可用语音（讲课没声音=产品失效，必须能统计到）
  'memory_write_failed', // 课堂小结/记忆写入失败（stage=insert|fallback，用于统计丢失率）
  'outline_parse_failed', // 课程大纲 JSON 解析失败、走了兜底课件（用户看到的是简化版）
  'boot_slow',         // 首屏加载明显偏慢（ms=domContentLoaded 耗时），用于判断站点延迟影响面
  'tts_voice_stale',   // 缓存的语音对象失效（系统语音包更新/卸载等），已自动丢弃并回退
  'tts_utterance_stuck', // 某句开口后 onend 不触发、超过预估时长被强制跳过（连续 3 次才提示用户）
  'tts_gesture_retry',   // 引擎拒绝发声后，用户点了一下、触发了自动重试
  'tts_selfcheck_start',   // 用户点了「语音自检」
  'tts_selfcheck_result',  // 自检结论（含"引擎说念了但用户没听到"这一格）—— 这是排查"没声音"最有用的一条

  'figure_backfill',   // 生成时缺图，已自动补图（n=补了几张）—— 用于衡量"配图不稳定"的实际发生率
  'parent_report_open',   // 打开家长学情报告（家长这一侧是我们原来的空白，先用埋点看是否有人用）
  'parent_report_copy',   // 复制报告文字
  'parent_report_image',  // 下载报告长图
  'paper_official_open',  // 从真题库点开考试局官方入口
  'paper_practice_gen',   // 按真题规格生成 AI 原创练习
  'own_paper_extract',    // 从学生自带真题里抽出文字（kind=pdf|text）
  'own_paper_run',        // 用学生自带真题做讲解或出变式（mode=explain|variant）
  'bank_split',           // 拆题入库（n=拆出几道，added=实际新增）
  'bank_export',          // 导出题库（n=导出几道）
  'progress_export',      // 导出学习进度备份
  'progress_import',      // 导入学习进度（mode=merge|replace）
  'signout_server_failed', // 登出请求失败（本地已清、服务端可能没清）—— 用来衡量"看着登出了其实没有"的发生率
];
/* 注册环节的埋点发生在**登录之前**，而 track() 要求已登录（否则 RLS 写不进去）。
   所以先落到本地队列，登录成功后补报一次 —— 否则"被拦的一次性邮箱"这类
   注册前风控事件永远统计不到，黑名单就没法按数据维护。 */
const TRACK_PENDING_KEY = 'lingxi.track.pending.v1';

function trackLater(name, props) {
  try {
    if (!trackGuard(name)) return;
    const q = JSON.parse(localStorage.getItem(TRACK_PENDING_KEY) || '[]');
    q.push({ name, props: props || {}, at: Date.now() });
    localStorage.setItem(TRACK_PENDING_KEY, JSON.stringify(q.slice(-20)));   // 只留最近 20 条
  } catch (_) {}
}

function flushPendingTracks() {
  try {
    const q = JSON.parse(localStorage.getItem(TRACK_PENDING_KEY) || '[]');
    if (!q.length) return;
    localStorage.removeItem(TRACK_PENDING_KEY);
    q.slice(-20).forEach((e) => track(e.name, e.props));
  } catch (_) {}
}

/* 埋点白名单守卫。
   ★ 2026-09-24 改：原来未声明的事件名是**静默 return** —— 结果 track('tts_unavailable')
   调了但没写进白名单，"设备没语音"这个重要信号一直在被无声丢掉，谁都不知道。
   现在告警一次（同类只报一次，不刷屏），让这类遗漏当场暴露。 */
const __trackWarned = {};
function trackGuard(name) {
  if (TRACK_EVENTS.indexOf(name) >= 0) return true;
  if (!__trackWarned[name]) {
    __trackWarned[name] = true;
    try { console.warn('[track] 未在白名单里的事件名（本条不会上报）: ' + name); } catch (_) {}
  }
  return false;
}

function track(name, props) {
  try {
    if (!trackGuard(name)) return;
    if (!state.cloud || !state.cloud.database || !memReady()) return;  // 未登录不记（RLS 也写不进去）
    const body = { name };
    if (props && typeof props === 'object') {
      const clean = {};
      Object.keys(props).slice(0, 8).forEach((k) => {
        const v = props[k];
        if (v === undefined || v === null) return;
        clean[k] = typeof v === 'string' ? v.slice(0, 300) : v;
      });
      body.props = clean;
    }
    // 故意不 await：埋点永远不参与交互时序
    state.cloud.database.from('analytics_events').insert(body).then(() => {}).catch(() => {});
  } catch (_) {}
}

/* 授课页"讲错了？"一键反馈：教育产品的信任底线，成本极低 */
function addFixButton(bubbleDiv, text) {
  try {
    const t = String(text || '').trim();
    if (!bubbleDiv || t.length < 20) return;      // 太短的内容没有复核价值
    if (bubbleDiv.querySelector('.msg-fix')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-fix';
    btn.textContent = '讲错了？';
    btn.title = '这处讲解有问题？点一下我们会复核';
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const course = state.live && state.live.course ? state.live.course : {};
      track('ai_correction', {
        course: String(course.title || '').slice(0, 80),
        subject: String(course.subject || ''),
        excerpt: t.slice(0, 240),
        at: new Date().toISOString(),
      });
      btn.disabled = true;
      btn.textContent = '已反馈，谢谢';
      btn.classList.add('done');
      toast('已记录，谢谢你的反馈 —— 我们会复核这处讲解');
    });
    bubbleDiv.appendChild(btn);
  } catch (_) {}
}

/* ============================================================
   「一个人一个账号」的设备闸门
   为什么这么做：平台不提供手机号登录/绑定（已核实：协议层邮箱与手机互斥、
   平台只开通 email provider），所以拿不到"实名级"唯一标识。退而求其次，
   用**设备维度**做去重 —— 而且必须是服务端强制，不能写在客户端里：
     · 唯一约束在数据库：device_ledger.fingerprint UNIQUE
     · 检查与写入都走 SECURITY DEFINER 函数 device_taken / device_claim
     · 表本身收回 INSERT/UPDATE/DELETE 权限，函数是唯一写入口
   这样客户端最多只能"伪造指纹值"，无法绕过"一个设备一个账号"的判定。
   局限必须写在明处：换设备、清浏览器标识、用无痕窗口仍可绕过 —— 它挡的是
   "同一台设备反复注册"这种最常见的薅法，不是实名级的身份唯一。

   ★ 踩过的坑（2026-09-24，实测）：**访客会话的 auth.uid() 返回字符串 'anon'，不是 NULL**。
   服务端函数最初只判 NULL，结果匿名调用竟然认领成功（写入 owner_id='anon'），
   访客一进页面就会把设备额度占掉、把真用户的注册挡在门外。
   现在函数侧把 NULL / '' / 'anon' 一律视为未登录返回 noauth（服务端守），
   客户端侧 memReady() 也排除 anonymous（客户端守）。两处都不能省。
   ============================================================ */
const DEVICE_KEY = 'lingxi.device.v1';

/* 设备指纹：只用环境特征（不掺随机串）—— 随机串一清缓存就变，等于没拦；
   环境特征在同一设备+浏览器上稳定，正合需要。（不含任何个人身份信息） */
function deviceFingerprint() {
  try {
    const n = navigator || {};
    const s = screen || {};
    const parts = [
      n.userAgent || '',
      n.language || '',
      (n.languages || []).join(','),
      n.platform || '',
      n.hardwareConcurrency || '',
      n.maxTouchPoints || '',
      s.width + 'x' + s.height + 'x' + (s.colorDepth || ''),
      new Date().getTimezoneOffset(),
      (n.deviceMemory || ''),
    ].join('|');
    // 稳定哈希（FNV-1a 32 位），避免把原始特征直接存库
    let h = 0x811c9dc5;
    for (let i = 0; i < parts.length; i++) {
      h ^= parts.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return 'd' + h.toString(36) + '-' + parts.length.toString(36);
  } catch (_) { return ''; }
}

/* 注册前询问：这台设备是否已经注册过账号（匿名可调用，只返回布尔） */
async function deviceAlreadyUsed() {
  const fp = deviceFingerprint();
  if (!fp || !state.cloud || !state.cloud.database) return false;
  try {
    const r = await state.cloud.database.rpc('device_taken', { fp });
    if (r && r.error) { return false; }        // 探测失败不拦人（宁可漏拦，不可误伤）
    return r && r.data === true;
  } catch (_) { return false; }
}

/* 登录/注册成功后认领本设备：'ok' 首次 | 'mine' 就是我自己的 | 'taken' 已被别的账号占用 */
async function deviceClaim() {
  const fp = deviceFingerprint();
  if (!fp || !state.cloud || !state.cloud.database || !memReady()) return 'skip';
  try {
    const r = await state.cloud.database.rpc('device_claim', {
      fp, ua_in: (navigator && navigator.userAgent) || '', platform_in: (navigator && navigator.platform) || '',
    });
    if (r && r.error) return 'skip';
    const status = r && r.data;
    if (status === 'taken') {
      // 共享设备（家里一台电脑两个孩子）也会走到这里 —— 登录不拦，只记录并提示，
      // 把"抢占式硬拦"留给注册环节（那才是"限制多开账号"的落点）
      track('device_conflict', { fp_tail: String(fp).slice(-6) });
    }
    return status || 'skip';
  } catch (_) { return 'skip'; }
}

function mapLLMError(e) {
  const inner = (e && e.error && typeof e.error === 'object') ? e.error : {};
  const code = errCode(e);
  const status = (e && e.status) || 0;
  // 本地闸门拦下的请求：文案已经写好了，原样透出，不要被下面的英文兜底覆盖
  if (code === 'local_ai_gate') return (e && e.message) || 'AI 调用已达上限，请稍后再试。';
  /* ★ 2026-09-29 修：原来是「已切回访客模式，请重试一次」——
     "切回访客模式"这个说法已经不成立（产品没有游客模式），且会让用户以为
     "不用登录也能接着用"。改成明确要求重新登录。 */
  if (isAuthError(e)) return '登录状态已过期，请重新登录后再试。';
  if (code === 'client_model_slow') return '当前模型响应太慢，可换个模型再试（右上角状态条 / 生成页的模型选择）。';
  if (code === 'client_empty_answer') return '模型这次没返回内容，请重试一次。';
  // 流到一半断掉（生成卡住，已由看门狗中断）：不是用户的错，要明确说"再试一次"
  if (code === 'client_stream_stalled') return '生成过程卡住了（模型中途没有继续返回），请点「重新生成」再试一次。';
  if (code === 'gateway_network_error') return '网络异常，请检查网络后重试。';
  // 连接被中途掐断：Node/undici 会把 message 写成 "terminated" / "other side closed"，
  // 不能把这种英文黑话直接甩给用户
  if (e && typeof e.message === 'string' &&
      /^(terminated|other side closed|socket hang up|ECONNRESET|fetch failed|network)/i.test(e.message)) {
    return '网络连接中断了，请检查网络后重试。';
  }
  if (status === 429 || code.startsWith('quota_')) return 'AI 额度已用尽或触发限流，请稍后再试。';
  if (status >= 500 || code.startsWith('gateway_') || code.startsWith('internal_')) return 'AI 服务开小差了，请点击重试。';
  if (code.startsWith('model_')) return '当前模型暂时不可用，请点击重试。';
  if (code === 'request_stream_required') return '请求参数错误（需要流式调用）。';
  if (code.startsWith('request_')) return '请求参数有误：' + (inner.message || code);
  return (e && e.message) ? ('出错了：' + e.message) : '网络异常，请检查网络后重试。';
}
function errorRequestId(e) {
  // requestId 来自服务端，但照样会被拼进 innerHTML —— 转义纪律不能有例外
  return (e && e.requestId) ? ('（诊断 ID：' + esc(e.requestId) + '）') : '';
}

/* ---------- 模型 ---------- */
/* 目录里除了对话模型还混着图像/向量之类的模型，别把它们当成聊天模型选中 */
const NON_CHAT_MODEL = /(?:^|[-_])(image|embed|embedding|rerank|tts|asr|whisper)(?:$|[-_])/i;

/* 默认模型白名单（按实测的首字延迟与成功率排序，同一份「生成整节课 JSON」请求实测）：
     deepseek-v4.1-flash  首字 1.1s / 总 8.7s   ✅ 9 页 3 题
     deepseek-v4-flash    首字 1.2s / 总 10.4s  ✅ 9 页 3 题
     kimi-k2.6            首字 1.1s / 总 61.6s  ✅ 10 页 3 题（慢但可用）
   踩过的坑（都实测过，所以写在这里当"禁令"）：
     · auto            路由到高档位思考模型，4 分钟一个字都不吐 → 用户看到「AI 服务不可用」
     · minimax-m2.5    直接 400 request_invalid_parameter（不吃 response_format）
     · glm-5.3-flash   首字 121s / 总 158s，体验上等同不可用
     · hunyuan-chat    输出上限 8k，课件 JSON 会被截断成非法 JSON
   所以默认值必须显式指定，绝不能用"取列表第一个"。 */
const MODEL_PREFERENCE = [
  'deepseek-v4.1-flash',
  'deepseek-v4-flash',
  'kimi-k2.6',
];
const MODEL_KEY = 'lingxi_model_v1';
const MIN_OUTPUT_TOKENS = 16000;   // 一次要产出 7~10 页课件 JSON，输出空间太小会被截断

function isChatModel(m) {
  return !!m && !!m.id && m.enabled !== false && m.disabled !== true && !NON_CHAT_MODEL.test(m.id);
}
/* 评分只用来排序；白名单命中直接给一个压倒性的分值，
   避免"惩罚项加起来超过偏好差距"导致默认模型又滑回慢模型（这个坑真踩过）。 */
function modelScore(m) {
  if (!isChatModel(m)) return -Infinity;
  const pref = MODEL_PREFERENCE.indexOf(m.id);
  if (pref >= 0) return 1000 - pref;
  let s = 0;
  if ((m.maxOutputTokens || 0) >= MIN_OUTPUT_TOKENS) s += 40; else s -= 40;
  if (m.onlyReasoning === true) s -= 50;                       // 只思考型模型首字延迟不可控
  if (m.id === 'auto') s -= 20;                                // 路由模型延迟随任务浮动，不宜当默认
  if (m.reasoning && m.reasoning.effort === 'high' && m.reasoning.canDisableThinking !== true) s -= 10;
  return s;
}
function rankModels(models) {
  return (models || []).filter(isChatModel).slice().sort((a, b) => modelScore(b) - modelScore(a));
}
function pickPreferredModel(models) {
  const ranked = rankModels(models);
  return ranked.length ? ranked[0] : null;
}

let loadModelsInflight = null;

function setAIStatus(kind, text, retryable) {
  const el = $('#ai-status');
  if (!el) return;
  // kind 只允许固定几个枚举值（用于拼 class），text 必须转义——即便调用方目前都传字面量
  const k = ['ok', 'bad', 'wait', 'off'].indexOf(String(kind)) >= 0 ? String(kind) : 'off';
  el.innerHTML = '<i class="dot dot-' + k + '"></i>' + esc(text);
  el.classList.toggle('is-retryable', !!retryable);
  el.setAttribute('title', retryable ? '点击重试' : '');
}

/* 落地当前模型：优先用户上次手选，其次偏好列表 */
function applyModel(models) {
  const list = (models || []).filter(isChatModel);
  if (!list.length) return null;
  let saved = null;
  try { saved = localStorage.getItem(MODEL_KEY); } catch (_) {}
  const bySaved = saved ? list.find((m) => m.id === saved) : null;
  state.model = bySaved || pickPreferredModel(list);
  return state.model;
}

function setModel(id, opts) {
  const m = (state.models || []).find((x) => x.id === id);
  if (!m) return null;
  state.model = m;
  if (!opts || opts.persist !== false) {
    try { localStorage.setItem(MODEL_KEY, id); } catch (_) {}
  }
  syncModelSelect();
  if (!opts || !opts.quiet) setAIStatus('ok', 'AI 已就绪', false);
  return m;
}

/* 首字延迟预算：超时就认为这个模型不适合当前请求，自动换一个更快的重来。
   这一步是"AI 服务不可用"的兜底 —— 思考型模型可能几分钟不吐一个字，
   用户无法区分"在思考"和"挂了"，所以宁可自动换模型。 */
const FIRST_CONTENT_BUDGET_MS = 45000;

/* 无进展预算：已经开始出字之后，这么久没有新 chunk 就判定"卡死"。
   比首字预算短一些 —— 停顿超过 45 秒基本不是"在想"，而是连接断了或被掐了。
   （首字预算只管"开口前"，开口后原来没有任何看门狗，见 streamChat 里的说明） */
const STALL_BUDGET_MS = 45000;

function fastestAlternativeModel() {
  const cur = state.model && state.model.id;
  const ranked = rankModels(state.models).filter((m) => m.id !== cur);
  return ranked.length ? ranked[0] : null;
}

/* 模型选择器：把可用的对话模型列出来，用户可手动切（慢的时候有得选） */
function renderModelSelect() {
  const sel = $('#model-select');
  const field = $('#model-field');
  if (!sel) return;
  const list = (state.models || []).filter(isChatModel);
  const cur = state.model && state.model.id;
  /* ★ 2026-09-24 修「下拉选项重复」：平台返回的数据里 hy3 与 hy3-x 的显示名**都是「Hy3」**，
     hy4-preview 与 hy4-preview-x 都是「Hy4 preview」—— 下拉会出现两条一模一样的选项，
     用户根本分不清点的是哪个（实测确认：Hy3 ×2、Hy4 preview ×2）。
     重名时统一补上 id 作为区分，既不丢模型也不误导。 */
  const nameCount = {};
  list.forEach((m) => { const n = m.name || m.id; nameCount[n] = (nameCount[n] || 0) + 1; });
  sel.innerHTML = list.map((m) => {
    const n = m.name || m.id;
    const label = nameCount[n] > 1 ? n + '（' + m.id + '）' : n;
    return '<option value="' + esc(m.id) + '"' + (m.id === cur ? ' selected' : '') + '>' +
      esc(label) + '</option>';
  }).join('');
  if (field) field.hidden = list.length <= 1;
  sel.hidden = list.length <= 1;
  syncModelSelect();
}
function syncModelSelect() {
  const sel = $('#model-select');
  if (!sel || !state.model) return;
  sel.value = state.model.id;
}
async function onModelChange(e) {
  const id = e.target.value;
  const m = setModel(id, { quiet: true });
  if (!m) return;
  toast('已切换到「' + (m.name || m.id) + '」', 'ok');
  setAIStatus('ok', 'AI 已就绪', false);
}
function bindModelSelect() {
  const sel = $('#model-select');
  if (!sel || sel.dataset.bound === '1') return;
  sel.dataset.bound = '1';
  sel.addEventListener('change', onModelChange);
}

/* 拉取模型目录。失败不再永久锁死：带退避重试、登录态自愈，并留一个可点的重试入口。 */
async function loadModels() {
  if (loadModelsInflight) return loadModelsInflight;
  loadModelsInflight = (async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ac = new AbortController();
        // 实测云端网关冷启动时，仅"拉模型目录"就可能要 12 秒以上（波动很大），
        // 超时给太紧会把"慢但正常"误判成不可用
        const timer = setTimeout(() => { try { ac.abort(); } catch (_) {} }, 20000);
        let models;
        try { models = await state.cloud.llm.models.list(ac.signal); }
        finally { clearTimeout(timer); }

        state.models = Array.isArray(models) ? models : [];
        const usable = applyModel(state.models);
        if (!usable) {
          state.model = null;
          setAIStatus('bad', '暂无可用模型', false);
          return false;
        }
        renderModelSelect();
        setAIStatus('ok', 'AI 已就绪', false);
        return true;
      } catch (e) {
        lastErr = e;
        // ① 登录态失效 → ★ 2026-09-29 改：原来靠"匿名重试"接着跑，等于把用户**降级成游客继续用**，
        //    与「没有游客模式 / 未登录不允许跑」直接冲突。现在确认凭据失效就重新上锁并停下。
        if (attempt === 0 && isAuthError(e)) {
          const healed = await healSession();   // 内部会清会话、并提示"请重新登录"
          if (healed) { try { enforceLoginGate(); } catch (_) {} break; }
          continue;
        }
        // ② 网络/后端抖动 → 退避重试
        if (!isAuthError(e) && attempt < 2) { await sleep(700 * (attempt + 1)); continue; }
        break;
      }
    }
    state.model = null;
    setAIStatus('bad', 'AI 暂不可用 · 点此重试', true);
    console.error('模型列表获取失败', lastErr);
    return false;
  })();
  try { return await loadModelsInflight; } finally { loadModelsInflight = null; }
}

/* 状态条点击即重试（窄屏下状态条隐藏，不影响桌面主流程） */
function bindAIStatusRetry() {
  const el = $('#ai-status');
  if (!el || el.dataset.retryBound === '1') return;
  el.dataset.retryBound = '1';
  el.addEventListener('click', () => {
    if (!state.cloud) return;
    setAIStatus('wait', 'AI 连接中…', false);
    loadModels();
  });
}

/* 统一的「AI 是否可用」闸门 —— 一律 await 使用。
   踩过的坑：打开页面后 SDK 要先建会话再拉模型目录，实测在真实云端约 4~5 秒。
   老实现是同步判定，用户手快在这 5 秒里点「生成课程」就会被直接拒绝，
   明明再等两秒就好，体感却是「AI 服务不可用」。
   现在它会在预算内等首次加载（或进行中的重试）落地，只有真的等不到才拦。 */
const MODEL_WAIT_BUDGET_MS = 12000;
async function requireModel({ budget = MODEL_WAIT_BUDGET_MS } = {}) {
  if (state.model) return true;
  if (!state.cloud) { toast('云服务未就绪，请刷新页面后重试', 'err'); return false; }
  setAIStatus('wait', 'AI 连接中…', false);
  // loadModels 自带去重：已有在途请求会直接复用，不会重复打接口
  await Promise.race([loadModels(), sleep(budget)]);
  if (state.model) return true;
  toast('AI 还在连接中，稍等一两秒再点一次就好', 'err');
  return false;
}

/* 统一的流式调用封装：所有调用都带 system 首消息 + stream:true
   - 登录态失效（401）→ 自愈后重试一次
   - 模型不支持 response_format → 降级重试一次
   - 首字迟迟不来（思考型模型可能几分钟不出字）→ 自动换更快的模型重来
   - 纯推理模型（onlyReasoning）会先吐 reasoning_content，通过 onReasoning 透出，
     避免"半天没反应"被误判成 AI 不可用 */
async function streamChat({ messages, temperature = 0.7, conversationId, responseFormat, signal, onDelta, onReasoning, onNotice,
                            firstContentBudget = FIRST_CONTENT_BUDGET_MS }) {
  const params = { model: state.model && state.model.id, messages, stream: true, temperature };
  if (conversationId) params.conversationId = conversationId;

  // 成本闸门：所有 AI 调用都从这里过，超限直接拦下（不再发出去）
  const gate = aiGateCheck();
  if (!gate.ok) throw aiGateError(gate);

  let useFormat = responseFormat;
  // 这次调用是否"要求 JSON"：要在降级重试（useFormat 被置空）之后仍然记得住，
  // 否则卡死时会把半截 JSON 当成功结果返回 → 解析失败 → 静默降级
  const wantsJson = !!responseFormat;
  let healed = false;
  let switched = false;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    params.model = (state.model && state.model.id) || params.model;   // 换了模型必须同步，否则重试还在打旧模型
    if (useFormat) params.response_format = { type: 'json_object' };
    else delete params.response_format;

    // 外层取消信号（用户点"打断"）与内部超时要能叠加
    const ac = new AbortController();
    const relay = () => { try { ac.abort(); } catch (_) {} };
    if (signal) {
      if (signal.aborted) return '';
      signal.addEventListener('abort', relay, { once: true });
    }
    let timedOut = false;
    let gotContent = false;
    const cap = setTimeout(() => { if (!gotContent) { timedOut = true; relay(); } }, firstContentBudget);
    /* ★ 2026-09-24 修「生成卡死、按钮永久转圈」：
       原来只有"首字预算"（firstContentBudget）—— 一旦开始出字就把它 clearTimeout 掉，
       之后再没有任何看门狗。实测遇到：已生成 18 字、标题都出来了，然后
       **连续 60 秒一个新 chunk 都没有**，而按钮一直是"生成中，请稍候"且 disabled，
       用户只能刷新页面（这节课等于白等）。网关侧 400/断流都不会触发 onerror。
       这里加"无进展"看门狗：只要 STALL_BUDGET 内没有新内容，就判定卡死、主动中断，
       交给上面的重试/报错链路（可自动换模型或提示用户重试）。 */
    /* ★ R18：这两个提到 try 之外 —— catch 里的"中止"分支也要能拿到已生成的部分文本。
       原来它们在 try 内部，catch 里只能返回空串，等于把学生刚看到的讲解抹掉。 */
    let full = '';
    let thinking = '';
    let lastProgressAt = Date.now();
    let stalled = false;
    const stall = setInterval(() => {
      if (Date.now() - lastProgressAt > STALL_BUDGET_MS) { stalled = true; relay(); }
    }, 5000);

    try {
      params.signal = ac.signal;
      full = '';
      thinking = '';
      for await (const chunk of state.cloud.llm.chat.completions.create(params)) {
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (!delta) continue;
        // 任何一段内容（含推理片段）到达都算"还在动"
        if (delta.reasoning_content || delta.content) lastProgressAt = Date.now();
        if (delta.reasoning_content) {
          thinking += delta.reasoning_content;
          if (onReasoning) onReasoning(delta.reasoning_content, thinking, full);
        }
        if (delta.content) {
          if (!gotContent) { gotContent = true; clearTimeout(cap); }   // 只有正文才算"开口"
          full += delta.content;
          if (onDelta) onDelta(delta.content, full);
        }
      }
      if (signal && signal.aborted) { aiGateRecord(true); return full; }   // 用户主动打断：不是错误
      /* 卡死导致的截断：**不能当成功结果返回**。
         要求 JSON 的调用（课程大纲/诊断卷）拿到半截 JSON 一定解析失败，
         而解析失败会走"兜底课件"——用户看到的是一个悄悄降级的劣质结果，
         比直接报错更糟。所以这里交回重试链路（可自动换模型）。
         散文场景（课堂对话）半截也是有用内容，照常返回。 */
      if (stalled) {
        if (wantsJson) { lastErr = stalledError(state.model && state.model.id); }
        else if (full) { aiGateRecord(true); return full; }
        else { lastErr = stalledError(state.model && state.model.id); }
      } else if (full) { aiGateRecord(true); return full; }
      else if (timedOut) { lastErr = slowModelError(state.model && state.model.id); }
      else { lastErr = emptyAnswerError(); }
    } catch (e) {
      lastErr = e;
      // ① 登录态失效 → 清残留会话后以访客身份重试一次
      if (!healed && isAuthError(e)) {
        healed = true;
        await healSession();
        continue;
      }
      /* ② 个别模型不支持 response_format 时降级重试一次 */
      const code = String((e && e.error && e.error.code) || '');
      if (useFormat && code.startsWith('request_')) { useFormat = null; continue; }
      /* ★ 2026-09-29 修（外部审查 R18）：这里原来返回**空串**。
         而上面 try 里那条"中止后正常结束"的分支返回的是 `full`（部分文本）——
         同一个"用户点了打断"，两条路径给出完全不同的结果，这就是缺陷本身。
         现在两条路径等价：都把已经生成的部分交回去。
         调用方用自己手里的 signal.aborted 判断"这是被打断"（见 sendLive）。 */
      if (signal && signal.aborted) { aiGateRecord(true); return full || ''; }
      // ③ 首字超时是我们自己掐的：中止请求后，流的落地方式**有两种**——
      //    有时 async generator 直接"正常结束"（走下面 try 里那条 timedOut 分支），
      //    有时抛出 AbortError（Node/undici 侧还会变成 message="terminated" 的错）。
      //    两条路径必须等价，都算"模型太慢"交给换模型分支；
      //    否则自动切换会随中止的落地方式时灵时不灵，用户直接吃到报错。
      // 非超时错误：默认立刻抛出；但 429/quota 这类"换个模型就能好"的错误要先交给
      // 下面的换模型分支处理（只换一次）。之前这里无条件 throw，导致 429 永远走不到
      // 自愈逻辑，学生上到一半直接被弹报错。
      if (!timedOut && !stalled) {
        if (!(isQuotaOrRateError(e) && !switched)) { aiGateRecord(false); throw e; }
        lastErr = e;
      } else if (stalled) {
        // 看门狗主动中断也会以 AbortError 的形式抛进来，必须和"首字超时"一样
        // 交给换模型重试分支，否则卡死仍然只能报错、不能自愈
        lastErr = stalledError(state.model && state.model.id);
      } else {
        lastErr = slowModelError(state.model && state.model.id);
      }
    } finally {
      clearTimeout(cap);
      clearInterval(stall);
      if (signal) { try { signal.removeEventListener('abort', relay); } catch (_) {} }
    }

    // ③ 一个字都没等到：换一个更快的模型重来（只换一次，避免来回横跳）
    //    流到一半卡死（stalled）同样值得换模型重试 —— 实测换一个模型立刻就能出完整结果。
    //    两种原因的提示要分开说：用户有权知道是"一直不说话"还是"说到一半不说了"。
    if (!switched && (errCode(lastErr) === 'client_model_slow' || errCode(lastErr) === 'client_stream_stalled')) {
      const alt = fastestAlternativeModel();
      if (alt) {
        const wasStalled = errCode(lastErr) === 'client_stream_stalled';
        switched = true;
        setModel(alt.id, { quiet: true, persist: false });
        if (onNotice) onNotice(wasStalled
          ? '当前模型讲到一半没有继续返回，已自动切换到「' + (alt.name || alt.id) + '」重试'
          : '当前模型响应太慢，已自动切换到「' + (alt.name || alt.id) + '」重试');
        continue;
      }
    }
    // ④ 429 / quota_*：实测这多半是**单个模型**被限流（换成另一个模型就能立刻恢复，
    //    2026-09-24 现场验证过：deepseek-v4.1-flash 报 429，切 deepseek-v4-flash 立刻 200）。
    //    以前这种情况直接把错误抛给学生、要他手动换模型 —— 上课上到一半弹报错的体验很差，
    //    这里自动换一个模型重试一次；仍然失败才把真实错误暴露出来。
    if (!switched && isQuotaOrRateError(lastErr)) {
      const alt = fastestAlternativeModel();
      if (alt) {
        switched = true;
        setModel(alt.id, { quiet: true, persist: false });
        if (onNotice) onNotice('当前模型有点忙，已自动切换到「' + (alt.name || alt.id) + '」继续');
        continue;
      }
    }
    aiGateRecord(false);
    throw lastErr;
  }
  aiGateRecord(false);
  throw lastErr || new Error('AI 调用失败');
}

/* 限流 / 额度类错误：429 或 code 以 quota_ 开头（配额相关的可自动换模型重试） */
function isQuotaOrRateError(e) {
  if (!e) return false;
  const status = (e && e.status) || 0;
  const code = errCode(e);
  return status === 429 || code.indexOf('quota_') === 0;
}

/* 首字超时 / 空回答：用可识别的 code，便于上层给不同文案 */
function errCode(e) {
  const inner = e && e.error;
  if (inner && typeof inner === 'object' && inner.code) return String(inner.code);
  if (typeof inner === 'string') return inner;
  return '';
}
function slowModelError(id) {  const e = new Error('模型响应超时（' + (id || '未知') + '）');
  e.name = 'CloudOpenAIError';
  e.error = { message: 'model too slow to respond', type: 'server_error', param: null, code: 'client_model_slow' };
  return e;
}
function emptyAnswerError() {
  const e = new Error('模型没有返回内容');
  e.name = 'CloudOpenAIError';
  e.error = { message: 'empty completion', type: 'server_error', param: null, code: 'client_empty_answer' };
  return e;
}
/* 流到一半卡死（长时间没有任何新 chunk）。用户看到的文案要说人话，
   不能只说"错误" —— 得告诉他可以重试。 */
function stalledError(id) {
  const e = new Error('模型响应中断（' + (id || '未知') + '）');
  e.name = 'CloudOpenAIError';
  e.error = { message: 'stream stalled', type: 'server_error', param: null, code: 'client_stream_stalled' };
  return e;
}

/* 解析模型输出的 JSON（容错：剥掉 markdown 代码块围栏） */
/* 修复模型爱犯的 JSON 语法病：
   · 字符串内部出现裸英文双引号（如 "对"面积"的理解"）——最常见的失败原因
   · 字符串内部出现裸换行
   做法是逐字符扫描，只在"引号后面跟着 , } ] : 或结尾"时才认定为字符串结束，
   其余位置的引号一律转义成 \" —— 比正则可靠，也不会破坏已经正确的 JSON。 */
function repairJSONText(t) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (ch === '\\') { out += ch + (t[i + 1] || ''); i++; continue; }
    if (ch === '\n' || ch === '\r' || ch === '\t') { out += (ch === '\t' ? '\\t' : '\\n'); continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < t.length && /\s/.test(t[j])) j++;
      const next = t[j];
      if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
        inStr = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function parseJSONLoose(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s > 0 || (e >= 0 && e < t.length - 1)) t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch (_) { /* 落到下面的修复 */ }
  try { return JSON.parse(repairJSONText(t)); } catch (_) { return null; }
}

/* 从题干/知识点里造一道兜底练习题（无 AI 可用时保证课件里有题） */
function fallbackQuiz(course, outline, idx) {
  const kp = (outline && Array.isArray(outline.knowledgePoints) && outline.knowledgePoints.length)
    ? String(outline.knowledgePoints[idx % outline.knowledgePoints.length])
    : (course.subject + '重点');
  const stage = (outline && Array.isArray(outline.stages) && outline.stages.length)
    ? String(outline.stages[idx % outline.stages.length].name || '') : '';
  const stem = stage
    ? '关于「' + kp + '」，下面说法正确的是：'
    : '关于本节课「' + kp + '」，下面说法正确的是：';
  return {
    type: 'quiz',
    title: '随堂练习 ' + (idx + 1),
    subtitle: '限时 2 分钟',
    question: stem,
    options: [
      'A. 它是本节课的核心概念，需要重点掌握',
      'B. 它只在本节课出现，与后续学习无关',
      'C. 掌握它不需要任何前置知识',
      'D. 它只有一种固定解法，不能变通',
    ],
    answer: 'A',
    analysis: 'A 正确：「' + kp + '」是本节的核心内容，也是后续学习的基础；' +
      'B、C、D 都忽略了知识点之间的关联与前置基础。请结合老师刚才的讲解再回顾一遍。',
    note: '我们来做一道随堂练习，检查一下刚才讲的「' + kp + '」有没有真正掌握。你先自己选，选完告诉我是哪个选项，我再带你分析。',
  };
}

/* 把 AI 输出的 slides 规范化；缺课件时用课程大纲兜底生成 */
/* ============================================================
   课件图示（2026-09-24 新增）
   起因：课件原来只支持 cover/content/quiz/summary 四种页型，字段只有标题/要点/讲稿 ——
   **完全没有图**。于是数学课讲数轴、几何、函数图象只能干念文字，
   而"探究三角形内角和"这类课没图几乎没法上。
   ★ 关键设计：**不让模型返回裸 SVG**。模型画的 SVG 一是容易画歪（坐标乱写），
     二是等于把任意标记注入页面。改成让模型返回**结构化数据**（几个数字 + 标签），
     由前端在这里渲染——数据是可控的，图形也就可控。
   支持类型（够覆盖中小学数学/物理的常见图示）：
     numberline 数轴 / bars 对比条形 / pie 占比 / rect 面积模型 / triangle 三角形 / function 函数图象
   ============================================================ */
const FIGURE_KINDS = ['numberline', 'bars', 'pie', 'rect', 'triangle', 'function'];

/* 数值收敛：模型给的坐标可能是字符串、NaN 或离谱的大数，一律夹到合理区间 */
function figNum(v, def, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}
function figText(v, max) {
  return esc(String(v == null ? '' : v).slice(0, max || 18));
}

/* 渲染成 SVG。返回空串表示"这个 figure 不合法，别渲染"（宁可不画，也不画错）。 */
function figureSVG(fig, theme) {
  if (!fig || typeof fig !== 'object') return '';
  const kind = String(fig.kind || '').toLowerCase();
  if (FIGURE_KINDS.indexOf(kind) < 0) return '';
  const ink = '#2A2F45', muted = '#8A90A6', line = '#C9CDDE';
  const accent = theme === 'ocean' ? '#0284C7' : '#5B5CE6';
  const accent2 = theme === 'ocean' ? '#0EA5E9' : '#8B5CF6';
  const W = 640, H = 320, PAD = 56;
  const parts = [];

  if (kind === 'numberline') {
    const min = figNum(fig.min, -5, -100, 100);
    const max = figNum(fig.max, 5, -100, 100);
    if (max - min < 0.5) return '';
    const y = H / 2;
    const sx = (v) => PAD + ((v - min) / (max - min)) * (W - PAD * 2);
    // 轴线 + 右端箭头
    parts.push('<line x1="' + PAD + '" y1="' + y + '" x2="' + (W - PAD + 14) + '" y2="' + y + '" stroke="' + ink + '" stroke-width="2.5" stroke-linecap="round"/>');
    parts.push('<path d="M' + (W - PAD + 8) + ' ' + (y - 7) + ' l12 7 l-12 7 z" fill="' + ink + '"/>');
    // 刻度：整数优先，范围大就按步长
    const span = max - min;
    const step = span <= 12 ? 1 : Math.ceil(span / 12);
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
      const x = sx(v);
      parts.push('<line x1="' + x.toFixed(1) + '" y1="' + (y - 7) + '" x2="' + x.toFixed(1) + '" y2="' + (y + 7) + '" stroke="' + line + '" stroke-width="2"/>');
      parts.push('<text x="' + x.toFixed(1) + '" y="' + (y + 26) + '" fill="' + muted + '" font-size="13" text-anchor="middle">' + figText(Number(v.toFixed(2))) + '</text>');
    }
    // 标记点
    (Array.isArray(fig.marks) ? fig.marks.slice(0, 10) : []).forEach((m, i) => {
      const at = figNum(m && m.at, 0, min, max);
      const x = sx(at);
      const up = i % 2 === 0;
      const ty = up ? y - 26 : y + 48;
      parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + y + '" r="6.5" fill="' + (i ? accent2 : accent) + '"/>');
      const lb = figText(m && m.label != null ? m.label : at, 12);
      parts.push('<text x="' + x.toFixed(1) + '" y="' + ty + '" fill="' + ink + '" font-size="15" font-weight="700" text-anchor="middle">' + lb + '</text>');
    });
  }

  if (kind === 'bars') {
    const items = (Array.isArray(fig.items) ? fig.items : []).slice(0, 6)
      .map((it) => ({ label: figText(it && it.label, 10), value: figNum(it && it.value, 0, -1e6, 1e6) }));
    if (items.length < 2) return '';
    const maxV = Math.max.apply(null, items.map((x) => Math.abs(x.value))) || 1;
    const rowH = Math.min(52, (H - 40) / items.length);
    const barMax = W - PAD * 2 - 90;
    const colors = [accent, accent2, '#F59E0B', '#10B981', '#EF4444', '#0EA5E9'];
    items.forEach((it, i) => {
      const y = 24 + i * rowH + rowH / 2;
      const bw = Math.max(4, (Math.abs(it.value) / maxV) * barMax);
      parts.push('<text x="' + (PAD - 10) + '" y="' + (y + 5) + '" fill="' + ink + '" font-size="14" text-anchor="end">' + it.label + '</text>');
      parts.push('<rect x="' + PAD + '" y="' + (y - 11) + '" width="' + bw.toFixed(1) + '" height="22" rx="6" fill="' + colors[i % colors.length] + '"/>');
      parts.push('<text x="' + (PAD + bw + 8).toFixed(1) + '" y="' + (y + 5) + '" fill="' + muted + '" font-size="13" font-weight="600">' + figText(it.value) + '</text>');
    });
  }

  if (kind === 'pie') {
    const slices = (Array.isArray(fig.slices) ? fig.slices : []).slice(0, 6)
      .map((s) => ({ label: figText(s && s.label, 10), value: Math.abs(figNum(s && s.value, 0, 0, 1e6)) }))
      .filter((s) => s.value > 0);
    if (slices.length < 2) return '';
    const total = slices.reduce((a, b) => a + b.value, 0) || 1;
    const cx = 190, cy = H / 2, r = 108;
    const colors = [accent, accent2, '#F59E0B', '#10B981', '#EF4444', '#0EA5E9'];
    let ang = -Math.PI / 2;
    slices.forEach((s, i) => {
      const sweep = (s.value / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(ang + sweep), y2 = cy + r * Math.sin(ang + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      // 整圆时弧线画不出来，退化成 circle
      if (sweep >= Math.PI * 2 - 1e-3) {
        parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + colors[i % colors.length] + '"/>');
      } else {
        parts.push('<path d="M' + cx + ' ' + cy + ' L' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
          ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' Z" fill="' + colors[i % colors.length] + '"/>');
      }
      ang += sweep;
      // 图例
      const ly = 62 + i * 32;
      parts.push('<rect x="' + (cx + r + 56) + '" y="' + (ly - 11) + '" width="16" height="16" rx="4" fill="' + colors[i % colors.length] + '"/>');
      parts.push('<text x="' + (cx + r + 80) + '" y="' + (ly + 2) + '" fill="' + ink + '" font-size="14">' + s.label +
        ' <tspan fill="' + muted + '">' + figText(Math.round((s.value / total) * 100)) + '%</tspan></text>');
    });
  }

  if (kind === 'rect') {
    const gw = figNum(fig.w, 4, 1, 20), gh = figNum(fig.h, 3, 1, 20);
    const maxW = W - PAD * 2 - 40, maxH = H - 110;
    const sc = Math.min(maxW / gw, maxH / gh);
    const bw = Math.max(40, gw * sc), bh = Math.max(40, gh * sc);
    const x = (W - bw) / 2, y = (H - bh) / 2 + 8;
    parts.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) +
      '" rx="8" fill="' + accent + '" fill-opacity="0.12" stroke="' + accent + '" stroke-width="2.5"/>');
    // 网格线暗示面积（按整数格）
    if (gw <= 10 && gh <= 10) {
      for (let i = 1; i < Math.round(gw); i++) {
        const gx = x + (bw / Math.round(gw)) * i;
        parts.push('<line x1="' + gx.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + gx.toFixed(1) + '" y2="' + (y + bh).toFixed(1) + '" stroke="' + accent + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.5"/>');
      }
      for (let i = 1; i < Math.round(gh); i++) {
        const gy = y + (bh / Math.round(gh)) * i;
        parts.push('<line x1="' + x.toFixed(1) + '" y1="' + gy.toFixed(1) + '" x2="' + (x + bw).toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="' + accent + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.5"/>');
      }
    }
    const ls = Array.isArray(fig.labels) ? fig.labels : [];
    parts.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y + bh + 28).toFixed(1) + '" fill="' + ink + '" font-size="15" font-weight="700" text-anchor="middle">' + figText(ls[0] != null ? ls[0] : gw) + '</text>');
    parts.push('<text x="' + (x - 14).toFixed(1) + '" y="' + (y + bh / 2).toFixed(1) + '" fill="' + ink + '" font-size="15" font-weight="700" text-anchor="middle">' + figText(ls[1] != null ? ls[1] : gh) + '</text>');
  }

  if (kind === 'triangle') {
    const ax = W / 2, ay = 46, bx = W / 2 - 190, by = H - 52, cx2 = W / 2 + 190, cy2 = H - 52;
    parts.push('<path d="M' + ax + ' ' + ay + ' L' + bx + ' ' + by + ' L' + cx2 + ' ' + cy2 + ' Z" fill="' + accent + '" fill-opacity="0.1" stroke="' + accent + '" stroke-width="2.8" stroke-linejoin="round"/>');
    const ls = Array.isArray(fig.labels) ? fig.labels : ['A', 'B', 'C'];
    const put = (x, y, t, dx, dy) => {
      if (t == null || t === '') return;
      parts.push('<text x="' + (x + dx) + '" y="' + (y + dy) + '" fill="' + ink + '" font-size="16" font-weight="700" text-anchor="middle">' + figText(t, 10) + '</text>');
    };
    put(ax, ay, ls[0] != null ? ls[0] : 'A', 0, -16);
    put(bx, by, ls[1] != null ? ls[1] : 'B', -20, 12);
    put(cx2, cy2, ls[2] != null ? ls[2] : 'C', 20, 12);
    // 顶角画个小弧，暗示"内角和"要看角
    parts.push('<path d="M' + (ax - 26) + ' ' + (ay + 44) + ' a30 30 0 0 1 ' + 52 + ' 0" fill="none" stroke="' + accent2 + '" stroke-width="2.5"/>');
  }

  if (kind === 'function') {
    const pts = (Array.isArray(fig.points) ? fig.points : []).slice(0, 40)
      .map((p) => [figNum(p && p[0], 0, -1000, 1000), figNum(p && p[1], 0, -1000, 1000)]);
    if (pts.length < 2) return '';
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const dx = (x1 - x0) || 1, dy = (y1 - y0) || 1;
    const px = (v) => PAD + ((v - x0) / dx) * (W - PAD * 2);
    const py = (v) => (H - PAD) - ((v - y0) / dy) * (H - PAD * 2);
    // 坐标轴（放在范围内 0 的位置，没有 0 就贴左边/下边）
    const axY = (y0 <= 0 && y1 >= 0) ? py(0) : py(y0);
    const axX = (x0 <= 0 && x1 >= 0) ? px(0) : px(x0);
    parts.push('<line x1="' + PAD + '" y1="' + axY.toFixed(1) + '" x2="' + (W - PAD + 10) + '" y2="' + axY.toFixed(1) + '" stroke="' + line + '" stroke-width="2"/>');
    parts.push('<line x1="' + axX.toFixed(1) + '" y1="' + (H - PAD) + '" x2="' + axX.toFixed(1) + '" y2="' + (PAD - 10) + '" stroke="' + line + '" stroke-width="2"/>');
    parts.push('<polyline points="' + pts.map((p) => px(p[0]).toFixed(1) + ',' + py(p[1]).toFixed(1)).join(' ') +
      '" fill="none" stroke="' + accent + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>');
    pts.forEach((p, i) => {
      parts.push('<circle cx="' + px(p[0]).toFixed(1) + '" cy="' + py(p[1]).toFixed(1) + '" r="' + (i === 0 ? 5.5 : 4) + '" fill="' + (i === 0 ? accent2 : accent) + '"/>');
    });
    if (fig.xLabel) parts.push('<text x="' + (W - PAD + 6) + '" y="' + (axY + 20).toFixed(1) + '" fill="' + muted + '" font-size="14">' + figText(fig.xLabel, 8) + '</text>');
    if (fig.yLabel) parts.push('<text x="' + (axX + 8).toFixed(1) + '" y="' + (PAD - 16) + '" fill="' + muted + '" font-size="14">' + figText(fig.yLabel, 8) + '</text>');
  }

  if (!parts.length) return '';
  const title = fig.title ? '<text x="' + (W / 2) + '" y="26" fill="' + ink + '" font-size="16" font-weight="700" text-anchor="middle">' + figText(fig.title, 30) + '</text>' : '';
  /* ★ xmlns 必须带上（2026-09-25）：
     内联进 HTML 时不需要它（走 HTML 解析），但**一旦作为独立图片使用**
     （导出 PPT 时转 PNG、或任何"把这个 SVG 变成图片"的用法），SVG 会被当 **XML** 解析，
     缺 xmlns 直接解析失败 —— 实测后果是 5 张图全部静默跳过、导出的 PPT 一张图都没有。
     在这里从源头补上最稳妥：内联时多余的 xmlns 完全无害，独立使用时才不会踩坑。 */
  return '<svg xmlns="http://www.w3.org/2000/svg" class="fig-svg" viewBox="0 0 ' + W + ' ' + H +
    '" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' +
    figText(fig.title || '示意图', 40) + '">' + title + parts.join('') + '</svg>';
}

/* 图的类型名，用于给老师和学生描述"这页画的是什么" */
const FIGURE_LABELS = {
  numberline: '数轴', bars: '对比条形图', pie: '占比图',
  rect: '面积模型', triangle: '几何图形', function: '函数图象',
};
function figureCaption(fig) {
  if (!fig) return '';
  return fig.title ? fig.title : (FIGURE_LABELS[fig.kind] || '示意图');
}

/* 从模型输出里收敛出一个合法的 figure（宁缺勿错） */
function normalizeFigure(f) {
  if (!f || typeof f !== 'object') return null;
  const kind = String(f.kind || '').toLowerCase();
  if (FIGURE_KINDS.indexOf(kind) < 0) return null;
  // 只保留该类型需要的字段，避免把模型多余的输出带进渲染
  const keep = {
    numberline: ['min', 'max', 'marks'],
    bars: ['items'],
    pie: ['slices'],
    rect: ['w', 'h', 'labels'],
    triangle: ['labels'],
    function: ['points', 'xLabel', 'yLabel'],
  }[kind];
  const out = { kind };
  if (f.title) out.title = String(f.title).slice(0, 30);
  keep.forEach((k) => { if (f[k] != null) out[k] = f[k]; });
  // 渲染一遍验证合法性（渲染不出来就当没有，别在页面上留个空框）
  return figureSVG(out, 'indigo') ? out : null;
}

function normalizeSlides(outline, course) {
  const arr = outline && Array.isArray(outline.slides) ? outline.slides : null;
  if (arr && arr.length) {
    const mapped = arr.map((s, i) => {
      // 类型判定：显式 type 优先，否则按位置推断
      let type = String(s.type || '').toLowerCase();
      if (!['cover', 'content', 'quiz', 'summary'].includes(type)) {
        if (i === 0) type = 'cover';
        else if (i === arr.length - 1) type = 'summary';
        else type = 'content';
      }
      const out = {
        type,
        title: String(s.title || '第 ' + (i + 1) + ' 页'),
        subtitle: s.subtitle ? String(s.subtitle) : '',
        bullets: Array.isArray(s.bullets) ? s.bullets.map(String).filter(Boolean) : [],
        note: s.note ? String(s.note) : '',
      };
      if (type === 'quiz') {
        out.question = String(s.question || '').trim();
        out.options = Array.isArray(s.options) ? s.options.map(String).filter(Boolean) : [];
        out.answer = String(s.answer || '').trim();
        out.analysis = String(s.analysis || '').trim();
      } else if (s.figure) {
        // 内容页可带一张示意图（数据驱动的，见 figureSVG）
        const fig = normalizeFigure(s.figure);
        if (fig) out.figure = fig;
      }
      return out;
    });
    // 丢弃没有题干的空题页；若一页题都不剩，稍后在 summary 前补一道
    let list = mapped.filter((s) => s.type !== 'quiz' || (s.question && s.answer));
    if (!list.some((s) => s.type === 'quiz')) {
      const si = list.findIndex((s) => s.type === 'summary');
      const quiz = fallbackQuiz(course, outline, 0);
      if (si >= 0) list.splice(si, 0, quiz); else list.push(quiz);
    }
    return list.slice(0, 14);
  }

  // 兜底：用大纲信息拼一份最小课件（含封皮 + 知识点 + 练习 + 小结）
  const cover = {
    type: 'cover',
    title: (outline && outline.title) || course.title,
    subtitle: [course.subject, course.grade, course.boardNames && course.boardNames[0]].filter(Boolean).join(' · '),
    bullets: [],
    note: '开场：介绍本节课的目标与安排。',
  };
  const body = [];
  const kps = (outline && Array.isArray(outline.knowledgePoints)) ? outline.knowledgePoints.map(String) : [];
  if (kps.length) {
    body.push({
      type: 'content', title: '本课知识点', subtitle: '',
      bullets: kps.slice(0, 5),
      note: '先带学生整体过一遍知识框架。',
    });
  }
  if (outline && Array.isArray(outline.stages)) {
    outline.stages.forEach((s, i) => {
      body.push({
        type: 'content',
        title: s.name || ('环节 ' + (i + 1)),
        subtitle: s.duration ? String(s.duration) : '',
        bullets: String(s.content || '').split(/[；;。]/).map((x) => x.trim()).filter(Boolean).slice(0, 3),
        note: String(s.content || ''),
      });
    });
  }
  const quiz = fallbackQuiz(course, outline, 0);
  const tail = {
    type: 'summary',
    title: '课堂小结', subtitle: '',
    bullets: (outline && Array.isArray(outline.homework) ? outline.homework.slice(0, 3) : ['回顾本课重点']).map(String),
    note: '总结要点，布置作业。',
  };
  return [cover, ...body, quiz, tail].slice(0, 12);
}

/* ---------- 视图切换 ---------- */
function switchView(name) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#view-' + name).classList.add('active');
  $$('.nav-links a, .mobile-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  if (name === 'courses') renderCourses();
  if (name === 'memory') { renderMemoryView(); try { renderProgressCard(); } catch (_) {} }
  if (name === 'papers') renderPapers();
  if (name === 'bank') renderBank();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- 学习档案（AI 记忆） ---------- */

/* 渲染「知识点掌握度」图谱：把记忆事实聚合成待巩固/学习中/已掌握三档 */
function renderMastery(facts) {
  const el = $('#mem-mastery');
  if (!el) return;
  const list = buildMastery(facts);
  if (!list.length) {
    el.innerHTML = '<p class="mem-empty">还没有知识点记录。上完一节课，老师会把你每个知识点的掌握程度标在这里。</p>';
    return;
  }
  el.innerHTML = list.map((m) => {
    const L = MASTERY_LEVELS[m.level] || MASTERY_LEVELS.need;
    /* ★ R07：曾经薄弱、后来靠新证据掌握了 —— 明确说出来。
       直接显示"已掌握"会把学习过程抹掉，学生看不到"我确实进步了"。 */
    const hist = m.wasWeak ? '<span class="mastery-was" title="早期曾是薄弱点，后来被多次答对的证据覆盖">曾薄弱</span>' : '';
    return '<div class="mastery-item">' +
      '<span class="mastery-dot ' + L.cls + '"></span>' +
      '<b>' + esc(m.topic) + '</b>' +
      (m.subject ? '<span class="mastery-sub">' + esc(m.subject) + '</span>' : '') +
      hist +
      '<span class="mastery-tag ' + L.cls + '">' + L.label + '</span>' +
      '</div>';
  }).join('');
}

function renderMemoryView() {
  const gate = $('#mem-gate');
  const body = $('#mem-body');
  if (!gate || !body) return;

  const loggedIn = !!(state.user && !state.user.anonymous);
  gate.hidden = loggedIn;
  body.hidden = !loggedIn;
  if (!loggedIn) return;

  // 未拉取完（或正在拉取）
  if (!state.memLoaded) {
    body.innerHTML = '<div class="mem-loading">正在读取你的学习档案…</div>';
    loadMemory().then(() => renderMemoryView()).catch(() => {
      body.innerHTML = '<div class="mem-loading">读取失败，请稍后重试</div>';
    });
    return;
  }

  const m = state.mem || { profile: null, facts: [], sessions: [] };
  const p = m.profile || {};
  // 归一化：数据库里可能有 null 行或半截数据（实测 facts:[null] 会让档案页直接崩）
  const facts = normalizeFacts(m.facts);
  const sessions = asArray(m.sessions).filter(Boolean);

  const item = (label, val) => val
    ? '<div class="mp-item"><span>' + esc(label) + '</span><b>' + esc(val) + '</b></div>' : '';

  const profileHtml = [
    item('学段', p.grade),
    item('课程体系', p.system),
    item('学习目标', p.goal),
    item('当前水平', p.level),
    item('偏好风格', p.teaching_style),
    item('上课节奏', p.pace),
  ].filter(Boolean).join('');
  $('#mem-profile-body').innerHTML = profileHtml ||
    '<p class="mp-empty">还没有画像。上完第一节课后，老师会自动总结出你的学段、目标与偏好。</p>';

  const mins = Math.round((p.total_seconds || 0) / 60);
  $('#mem-stats-body').innerHTML = [
    '<div class="ms-item"><b>' + (p.sessions_count || sessions.length || 0) + '</b><span>已上课程</span></div>',
    '<div class="ms-item"><b>' + mins + '</b><span>累计分钟</span></div>',
    '<div class="ms-item"><b>' + facts.length + '</b><span>记住的事</span></div>',
  ].join('');

  // 事实列表
  const order = ['weak', 'misconception', 'strength', 'preference', 'context', 'progress'];
  const sorted = facts.slice().sort((a, b) => {
    const ia = order.indexOf(a.kind), ib = order.indexOf(b.kind);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  $('#mem-facts').innerHTML = sorted.length ? sorted.map((f) => {
    const k = FACT_KINDS[f.kind] || { label: '记忆', cls: '' };
    const when = f.last_seen ? new Date(f.last_seen).toLocaleDateString('zh-CN') : '';
    const hits = (f.hits > 0) ? '<span>被提及 ' + f.hits + ' 次</span>' : '';
    const subj = f.subject ? '<span>' + esc(f.subject) + (f.topic ? ' · ' + esc(f.topic) : '') + '</span>' : '';
    return '<div class="fact-row">' +
      '<span class="fact-kind ' + k.cls + '">' + esc(k.label) + '</span>' +
      '<div class="fact-body"><p>' + esc(f.content) + '</p>' +
      '<div class="fact-meta">' + subj + hits + (when ? '<span>' + when + '</span>' : '') + '</div></div>' +
      '<button class="fact-del" data-fact-del="' + esc(f.id) + '" title="忘掉这条">✕</button>' +
      '</div>';
  }).join('') : '<p class="mem-empty">还没有记住的事。上完一节课后，老师会把你的薄弱点、优势和偏好记在这里。</p>';

  // 知识点掌握度图谱（由事实聚合，待巩固/学习中/已掌握）
  renderMastery(facts);
  // 错因分布图谱（由上课记录聚合，四维错因 + 会/不会比例）
  renderErrorProfile(sessions);
  // 起点画像（由入学诊断沉淀的 diagnostic 来源事实聚合）
  renderMemoryDiag(facts);

  // 上课记录
  $('#mem-sessions').innerHTML = sessions.length ? sessions.map((s) => {
    const when = s.created_at ? new Date(s.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const mins2 = Math.round((s.duration_secs || 0) / 60);
    const list = (t, arr) => (Array.isArray(arr) && arr.length)
      ? '<div class="sess-list"><span>' + t + '</span><ul>' + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '';
    const causes = renderCauses(s.error_causes);
    /* 闪卡与复习计划：下课时的"课堂小结"里出现过一次，之后就再也看不到了 ——
       而间隔复习的价值恰恰在"之后回来复习"。数据本来就在库里（saveSession 一直有存），
       这里把它显示出来即可。闪卡沿用小结页的 details/summary 结构：
       默认只显示问题、点开才看答案（强制"先回忆再核对"），且原生支持键盘操作。 */
    const cards = (Array.isArray(s.cards) ? s.cards : []).filter((c) => c && (c.q || c.a));
    const cardsHtml = cards.length
      ? '<details class="sess-extra"><summary>🃏 课后自测闪卡（' + cards.length + ' 张）</summary>' +
        '<p class="sess-hint">先在心里作答，再点开对答案 —— 直接看答案效果会差很多。</p>' +
        '<div class="flash-list">' + cards.map((c, i) =>
          '<details class="flash-card"><summary><span class="fc-no">' + (i + 1) + '</span>' +
          '<span class="fc-q">' + esc(c.q || '（略）') + '</span>' +
          '<span class="fc-toggle">看答案</span></summary>' +
          '<div class="fc-a"><b>答案：</b>' + esc(c.a || '（略）') + '</div></details>').join('') +
        '</div></details>'
      : '';
    const plan = (Array.isArray(s.review_plan) ? s.review_plan : []).filter(Boolean);
    const planHtml = plan.length
      ? '<div class="sess-plan"><span>🔁 间隔复习计划</span><ol class="review-plan">' +
        plan.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ol></div>'
      : '';
    return '<div class="sess-row">' +
      '<div class="sess-head"><b>' + esc(s.course_title || '未命名课程') + '</b>' +
      '<span class="sess-meta">' + esc([s.subject, s.grade].filter(Boolean).join(' · ')) +
      (mins2 ? ' · ' + mins2 + ' 分钟' : '') + (when ? ' · ' + when : '') + '</span></div>' +
      '<div class="sess-lists">' + list('✅ 已掌握', s.mastered) + list('📌 待巩固', s.weak_points) + list('✏️ 作业', s.homework) + '</div>' +
      (causes ? '<div class="sess-causes"><span>🔍 错因</span>' + causes + '</div>' : '') +
      (s.comment ? '<div class="sess-comment">' + esc(s.comment) + '</div>' : '') +
      planHtml + cardsHtml +
      // 每条上课记录都能出家长报告（历史记录同样需要能补发给家长）
      '<div class="sess-report"><button class="btn btn-sm btn-ghost" data-parent-report="' + esc(s.id) + '">📤 发给家长</button>' +
      '<span class="sess-report-hint">一页学情报告，可复制文字或下载长图</span></div>' +
      '</div>';
  }).join('') : '<p class="mem-empty">还没有上课记录。</p>';
}

/* 手动添加一条记忆 */
async function addMemoryFact() {
  if (!memReady()) { toast('请先登录', 'err'); return; }
  const content = window.prompt('想让灵犀老师记住什么？（例如：我更习惯先看例题再做题）');
  if (!content || !content.trim()) return;
  const n = await saveFacts([{ kind: 'preference', content: content.trim(), source: 'manual', confidence: 0.9 }]);
  if (n) {
    toast('已记住', 'ok');
    await loadMemory(true);
    renderMemoryView();
  } else {
    toast('保存失败，请稍后重试', 'err');
  }
}

function bindMemoryEvents() {
  const gateBtn = $('#btn-mem-login');
  if (gateBtn) gateBtn.addEventListener('click', openAuthModal);
  const addBtn = $('#btn-mem-add');
  if (addBtn) addBtn.addEventListener('click', addMemoryFact);

  const facts = $('#mem-facts');
  if (facts) facts.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-fact-del]');
    if (!btn) return;
    if (!window.confirm('让老师忘掉这条记忆？')) return;
    const ok = await deleteFact(btn.dataset.factDel);
    if (ok) {
      toast('已忘掉这条');
      await loadMemory(true);
      renderMemoryView();
    } else {
      toast('删除失败，请稍后重试', 'err');
    }
  });

  /* 上课记录 → 家长报告：从已加载的档案数据里按 id 取回那条记录。
     用真实数据而不是 DOM 文本 —— 报告需要 cards / review_plan 这些没渲染成文字的结构化字段。 */
  const sess = $('#mem-sessions');
  if (sess) sess.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-parent-report]');
    if (!btn) return;
    const id = btn.dataset.parentReport;
    const all = asArray((state.mem || {}).sessions).filter(Boolean);
    const rec = all.find((x) => String(x && x.id) === String(id));
    if (!rec) { toast('找不到这节课的记录，刷新后再试', 'err'); return; }
    openParentReport(rec);
  });
}

/* ---------- 首页渲染 ---------- */
function renderHome() {
  // 体系切换
  $('#system-tabs').innerHTML = SYSTEMS.map((s) => `
    <button class="sys-tab${s.id === state.homeSystem ? ' active' : ''}" data-sys="${s.id}">
      <span class="sys-ico">${s.ico}</span>
      <span class="sys-name">${esc(s.name)}</span>
      <span class="sys-desc">${esc(s.desc)}</span>
    </button>`).join('');

  const sys = getSystem(state.homeSystem);
  const grid = $('#subject-grid');
  grid.innerHTML = sys.subjects.map((s) => `
    <button class="subject-card" data-subject="${esc(s.name)}" data-sys="${sys.id}">
      <span class="s-ico" style="background:${s.color}">${s.ico}</span>
      <b>${esc(s.name)}</b>
      <span>${esc(s.desc)}</span>
    </button>`).join('');
  $('#subject-count').textContent = sys.subjects.length;
  $('#subject-sys-name').textContent = sys.name;
}

/* 切换课程体系的**唯一入口**（一处收口）。
   ★ 2026-09-24 修「国内课程被挂 IB 标签」：
   原来三个入口各自处理，而且考纲只在"新体系有考纲"时才赋值 ——
   偏偏 state.gen.boards 的默认值是 ['ib']，而国内课程（cn）体系本身**没有考纲字段**，
   于是国内课程会一直带着 IB：生成的课挂上「🇨🇳 国内课程 + 🌍 IB」双标签。
   这不需要任何操作，默认状态就会发生（实测确认）。
   所以考纲必须**跟着体系无条件重置**，不能只在国际课程方向赋值。 */
function applyGenSystem(sysId, opts) {
  const o = opts || {};
  const sys = getSystem(sysId);
  state.gen.system = sys.id;
  state.gen.boards = (sys.boards && sys.boards.length) ? [sys.boards[0].id] : [];
  state.gen.subject = (o.subject && sys.subjects.some((s) => s.name === o.subject))
    ? o.subject
    : sys.subjects[0].name;
  state.homeSystem = sys.id;
  return sys;
}

function bindHomeEvents() {
  $('#system-tabs').addEventListener('click', (ev) => {
    const tab = ev.target.closest('.sys-tab');
    if (!tab || tab.dataset.sys === state.homeSystem) return;
    // 首页切换体系后，生成页的选择同步跟上（考纲一并重置）
    applyGenSystem(tab.dataset.sys);
    renderHome();
    renderGenChips();
    renderGradeOptions();
  });
  $('#subject-grid').addEventListener('click', (ev) => {
    const card = ev.target.closest('.subject-card');
    if (!card) return;
    applyGenSystem(card.dataset.sys, { subject: card.dataset.subject });
    renderGenChips();
    renderGradeOptions();
    setGenSubject(card.dataset.subject);
    switchView('generate');
  });
}

/* ---------- 生成课程 ---------- */
let __genChipsBound = false;
function renderGenChips() {
  const sys = getSystem(state.gen.system);
  const boards = getBoards(sys);
  renderVoiceSettings();     // 生成页也要显示授课语言选择（源头决定语言）

  // 体系切换
  $('#gen-systems').innerHTML = SYSTEMS.map((s) => `
    <button class="chip${s.id === state.gen.system ? ' active' : ''}" data-v="${s.id}">
      ${s.ico} ${esc(s.name)}
    </button>`).join('');

  // 考纲/考试局（仅国际体系；可多选）
  const boardField = $('#gen-boards-field');
  if (boards.length) {
    boardField.hidden = false;
    $('#gen-boards').innerHTML = boards.map((b) => `
      <button class="board-chip${state.gen.boards.includes(b.id) ? ' active' : ''}" data-board="${b.id}">
        <span class="bc-ico">${b.ico}</span>
        <span class="bc-name">${esc(b.name)}</span>
        <span class="bc-desc">${esc(b.desc)}</span>
      </button>`).join('');
  } else {
    boardField.hidden = true;
    $('#gen-boards').innerHTML = '';
  }

  // 课型（决定"这节课怎么上"：大纲结构和老师教法都跟着变）
  $('#gen-types').innerHTML = COURSE_TYPES.map((t) => `
    <button class="chip type-chip${t.id === state.gen.type ? ' active' : ''}" data-v="${t.id}" title="${esc(t.desc)}">
      ${t.ico} ${esc(t.name)}
    </button>`).join('');

  // 科目（按考纲过滤：无 boards 标注的通用科目始终显示）
  const list = sys.subjects.filter((s) => {
    if (!Array.isArray(s.boards)) return true;
    if (!state.gen.boards.length) return true;
    return s.boards.some((b) => state.gen.boards.includes(b));
  });
  if (!list.some((s) => s.name === state.gen.subject)) {
    state.gen.subject = list.length ? list[0].name : sys.subjects[0].name;
  }
  $('#gen-subjects').innerHTML = list.map((s) =>
    `<button class="chip${s.name === state.gen.subject ? ' active' : ''}" data-v="${esc(s.name)}">${esc(s.name)}</button>`
  ).join('');

  // 学习目标预设（该体系下）
  $('#gen-goal-presets').innerHTML = sys.goals.map((g) =>
    `<button class="goal-chip" data-goal="${esc(g)}">${esc(g)}</button>`).join('');
  $('#gen-sys-note').textContent = sys.id === 'intl'
    ? '国际课程默认中英双语授课；可多选考纲，AI 将按对应考纲与评分标准授课'
    : '国内课程按考纲与教材进度授课';

  if (__genChipsBound) return;
  __genChipsBound = true;
  bindChips('#gen-systems', (v) => {
    // 同一入口：考纲跟着体系重置，避免国内课程残留 IB
    applyGenSystem(v);
    renderGenChips();
    renderGradeOptions();
    $('#gen-goal').value = '';
    $('#gen-goal').placeholder = v === 'intl'
      ? '例如：IB HL 物理，力学部分概念混乱，11 月大考想提高到 6 分；希望多用英文术语讲解'
      : '例如：下个月要考一元二次方程单元测，基础一般，想系统复习并多做典型题';
  });
  // 考纲多选
  $('#gen-boards').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.board-chip');
    if (!chip) return;
    const id = chip.dataset.board;
    const arr = state.gen.boards;
    if (arr.includes(id)) {
      if (arr.length === 1) { toast('至少保留一个考纲', 'err'); return; }
      state.gen.boards = arr.filter((x) => x !== id);
    } else {
      state.gen.boards = [...arr, id];
    }
    renderGenChips();
  });
  bindChips('#gen-subjects', (v) => { state.gen.subject = v; });
  bindChips('#gen-duration', (v) => { state.gen.duration = v; });
  bindChips('#gen-types', (v) => { state.gen.type = v; });
  bindChips('#gen-level', (v) => { state.gen.level = v; });
  $('#gen-goal-presets').addEventListener('click', (ev) => {
    const g = ev.target.closest('.goal-chip');
    if (!g) return;
    $('#gen-goal').value = g.dataset.goal;
    $$('#gen-goal-presets .goal-chip').forEach((x) => x.classList.toggle('active', x === g));
  });
}

/* 年级/学习阶段下拉，随体系联动 */
function renderGradeOptions(keepCurrent) {
  const sys = getSystem(state.gen.system);
  const sel = $('#gen-grade');
  const cur = sel.value;
  sel.innerHTML = sys.grades.map((g) => `<option>${esc(g)}</option>`).join('');
  if (keepCurrent && sys.grades.includes(cur)) {
    sel.value = cur;
  } else if (sys.id === 'intl') {
    // 国际课程默认停在中段（IB / A-Level / AP）
    sel.value = sys.grades[1] || sys.grades[0];
  }
  $$('#gen-level .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  state.gen.level = '基础巩固';
}

function setGenSubject(name) {
  state.gen.subject = name;
  renderGenChips();
}
function bindChips(sel, cb) {
  const row = $(sel);
  row.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    row.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    cb(chip.dataset.v);
  });
}

/* 返回当前选中的考纲显示名，如 ["IB DP (HL/SL)", "HKDSE 香港中学文凭"] */
function selectedBoardNames() {
  const sys = getSystem(state.gen.system);
  const boards = getBoards(sys);
  if (!boards.length) return [];
  return state.gen.boards
    .map((id) => boards.find((b) => b.id === id))
    .filter(Boolean)
    .flatMap((b) => b.marks || [b.full || b.name]);
}

const BOARD_GUIDE = {
  ib: 'IB：按 IB DP 考纲与 assessment objectives 设计，注意 HL/SL 差异；环节中体现 IA（Internal Assessment）、' +
      'EE（Extended Essay）与 TOK 的关联；题目引述 past paper 风格并说明 mark scheme 给分点。',
  alevel: 'A-Level：按 CAIE / Edexcel / AQA 考纲设计，区分 AS 与 A2 内容；' +
      '强调 Paper 结构与 past papers 训练，说明 mark scheme（如 M1/A1/B1 给分点）与常见失分陷阱。',
  hkdse: 'HKDSE（香港中学文凭）：按香港教育局课程指引与文凭试考纲设计，覆盖核心科目与选修；' +
      '强调 Paper 1（长题目）与 Paper 2（选择题）的答题技巧、评分准则与 Level 5** 冲分策略。',
  ap: 'AP：按 College Board AP 课程大纲设计，锚定 CED（Course and Exam Description）的知识框架；' +
      '强调 MCQ 与 FRQ（Free Response）题型训练、AP 5 分制评分标准与高分答题要点。',
};

function buildCourseOutlinePrompt() {
  const sys = getSystem(state.gen.system);
  const grade = $('#gen-grade').value;
  const goal = $('#gen-goal').value.trim();
  const bnames = selectedBoardNames();
  let sysLine;
  if (sys.id === 'intl') {
    const guides = state.gen.boards.map((id) => BOARD_GUIDE[id]).filter(Boolean);
    sysLine = '课程体系：国际课程（' + grade + '）。对标考纲：' +
      (bnames.length ? bnames.join('、') : '国际通行标准') + '。\n' +
      '请严格按上述考纲设计：使用国际教材通行的章节结构；专业术语首次出现时给出英文原名' +
      '（如 Newton\'s second law）；体现 inquiry-based learning 与 past paper 训练。\n' +
      (guides.length ? guides.join('\n') : '');
  } else {
    sysLine = '课程体系：国内课程（' + grade + '）。请贴合国内课标与教材进度，对标中高考/单元考的考查方式，' +
      '强调典型例题与易错点。';
  }
  return '请为以下学生设计一节' + state.gen.duration + '的 AI 一对一直播课。\n' +
    (teachLang() === 'en'
      ? '★ 本节课全程用英语授课：课程标题、知识点、环节名称、题目与解析全部用英文书写（English）。\n'
      : '') +
    courseTypeBlock() +
    '科目：' + state.gen.subject + '\n' + sysLine + '\n难度：' + state.gen.level +
    '\n学习目标：' + (goal || '未填写，请按该体系、该阶段的典型学习需求设计') +
    diagnosticPromptBlock() +
    '\n要求：环节由浅入深、可互动、贴合一对一场景；content 要具体到"讲什么、怎么互动"；' +
    '**环节必须体现上面课型的推进方式**，不要把任何课型都写成"讲知识→做练习→总结"。' +
    (sys.id === 'intl' ? '标题与知识点可用中英双语，正文说明用简体中文。' : '全部使用简体中文。');
}

/* ============================================================
   课型（2026-09-24 新增）
   为什么加这个：原来所有课的骨架都是"讲—练—结"，一节复习课和一节新课长得一样，
   学生上到第三节课就觉得"又是这套"。课型不是标签，它要真的换教法：
     · 新课       → 情境引入、概念建构、动手试
     · 复习课     → 先诊断再补漏，知识串联，变式训练
     · 错题讲评   → 从错题出发找错因，改题、再练同类型
     · 冲刺提分   → 按考纲切考点，讲采分点与时间分配
     · 概念纠错   → 专治"似懂非懂"：找冲突、辨反例、说清楚
     · 探究实验   → 情境提问 → 猜想 → 验证 → 结论 → 迁移
   每项都给：生成大纲时的取向 + 老师授课时的行为要求 + 环节骨架建议。
   ============================================================ */
const COURSE_TYPES = [
  {
    id: 'new', name: '新课精讲', ico: '📘', desc: '从零讲清楚一个新知识',
    outline: '按"情境引入 → 概念建构 → 例题示范 → 学生试做 → 小结"推进；'
      + '重点是让学生**自己说出**结论，不要直接给定义。',
    teach: '你是第一次讲这个知识点。多用生活情境引入；每讲完一个小结论就停下来问他"你是怎么想的"；'
      + '宁可少讲一个知识点，也要让第一个知识点真的立住。',
    stages: '情境/问题引入、概念建构（含追问）、例题示范、学生动手试、总结归纳',
  },
  {
    id: 'review', name: '复习巩固', ico: '🔁', desc: '把学过的串成体系',
    outline: '按"快速诊断 → 知识串联（画关系/对比表）→ 典型题 → 易错点 → 综合题"推进；'
      + '必须体现"由散到整"的串联过程，不能只是把新课再讲一遍。',
    teach: '不要再从零讲定义。先用一两个问题探他哪里松了，再按"知识网"的顺序补；'
      + '多用对比和归纳（"这两个公式什么时候用哪个"）；每讲一块就让他自己复述一句。',
    stages: '摸底诊断、知识串联、典型题、易错点专攻、综合应用',
  },
  {
    id: 'error', name: '错题讲评', ico: '🔍', desc: '从错题找出真正的原因',
    outline: '按"呈现错题 → 让他重讲思路 → 定位错因 → 改题重做 → 同类型变式"推进；'
      + '错因要归到概念不清/审题失误/计算/方法缺失中的一类，不能只说"粗心"。',
    teach: '先让他把当时怎么想的讲一遍 —— 错因往往不在他说的那一步。'
      + '定位到具体是"概念不清"还是"方法不会"再对症下药；'
      + '改完必须再给一道同类型的题当场做，确认真的会了。',
    stages: '错题复现、思路复盘、错因定位、订正重做、变式再练',
  },
  {
    id: 'exam', name: '考前冲刺', ico: '🎯', desc: '按考点提分，讲采分点',
    outline: '按"考情/分值分布 → 高频考点逐个突破 → 采分点与答题规范 → 时间分配 → 自查清单"推进；'
      + '要有"考试怎么拿分"的具体指导，不只是讲知识。',
    teach: '带着"这次考试怎么多拿几分"的目标讲。每个考点都要说清：考什么、怎么问、'
      + '答案要写到什么程度才给分、最容易丢分的地方在哪。最后给一份可以带进考场的自查清单。',
    stages: '考情分析、高频考点、采分点与规范、限时训练、考场自查',
  },
  {
    id: 'fix', name: '概念纠错', ico: '💡', desc: '专治似懂非懂的错觉',
    outline: '按"暴露原有理解 → 制造认知冲突 → 反例辨析 → 重建正确概念 → 检验迁移"推进；'
      + '必须先让他说出自己的想法，再用反例让他自己发现矛盾。',
    teach: '核心手法是**先让他说错**，再用反例让他自己发现问题 —— 直接纠正记不住。'
      + '他改口之后，追问他"那你原来的想法错在哪一步"，把纠错过程变成他的方法。',
    stages: '暴露原想法、反例冲突、辨析讨论、重建概念、检验迁移',
  },
  {
    id: 'inquiry', name: '探究实验', ico: '🧪', desc: '自己发现规律',
    outline: '按"情境提问 → 提出猜想 → 设计/观察验证 → 得出结论 → 迁移应用"推进；'
      + '结论必须由学生自己说出来，老师只做引导。',
    teach: '不要先给结论。抛出问题后让他猜，猜完再一起验证（算一算/画一画/看数据），'
      + '让他自己发现规律；最后一定要把规律用到一个新情境里检验。',
    stages: '提出问题、作出猜想、验证探究、归纳结论、迁移应用',
  },
];
function getCourseType(id) {
  return COURSE_TYPES.find((t) => t.id === id) || COURSE_TYPES[0];
}
/* 课型 → 老师的行为要求。
   没有 type 字段的老课程返回空串（按通用规则上课），保持向后兼容。 */
function courseTypeTeachBlock(course) {
  const t = COURSE_TYPES.find((x) => x.id === (course && course.type));
  if (!t) return '';
  return '【本节课型】' + t.name + '（' + t.desc + '）—— 请**严格按这个课型的方式来上**，'
    + '不要套用"讲知识 → 做练习 → 总结"的通用套路：' + t.teach + '\n';
}
function courseTypeBlock() {
  const t = getCourseType(state.gen.type);
  return '【课型】' + t.name + '（' + t.desc + '）\n'
    + '本课型的推进方式：' + t.outline + '\n'
    + '环节骨架参考（可微调，但要保留这个课型的特征）：' + t.stages + '\n';
}

/* 从"还没闭合的 JSON"里偷看标题，用于生成课程过程中的友好提示。
   只在 title 已经出现闭合引号时才取，避免把半截字符串显示出来。 */
function peekCourseTitle(partial) {
  const s = String(partial || '');
  const m = s.match(/"title"\s*:\s*"((?:[^"\\]|\\.){2,40})"/);
  if (!m) return '';
  try { return JSON.parse('"' + m[1] + '"'); } catch (_) { return m[1]; }
}

/* 生成中的状态与取消（2026-09-24）
   实测生成可能几十秒到两分钟。原来这段时间按钮是 **disabled**、没有任何取消途径 ——
   用户要么硬等，要么刷新页面（刷新会丢掉刚填的表单）。现在按钮变成「取消生成」，
   点击即中断请求；请求侧的 AbortController 挂在这里，供按钮调用。 */
let genBusy = false;
let genController = null;

function syncGenButton() {
  const btn = $('#btn-generate');
  if (!btn) return;
  if (genBusy) {
    btn.disabled = false;                 // 必须可点，否则根本取消不了
    btn.textContent = '✕ 取消生成';
    btn.setAttribute('aria-label', '取消生成');
    btn.classList.add('btn-cancel');
  } else {
    btn.disabled = false;
    btn.textContent = '✨ AI 生成课程';
    btn.setAttribute('aria-label', 'AI 生成课程');
    btn.classList.remove('btn-cancel');
  }
}

/* 生成按钮的统一入口：生成中再点就是"取消"，而不是重复触发一次生成 */
function onGenerateClick() {
  if (genBusy) {
    try { if (genController) genController.abort(); } catch (_) {}
    return;
  }
  /* ★ 2026-09-29 加：动作侧硬校验。门禁原来只靠"遮罩盖住按钮"，
     检查 agent 指出处理函数里没有任何判据 —— 一旦有别的路径能触发 click 就形同虚设。 */
  if (!requireSignedIn()) return;
  generateCourse();
}

/* 定向补图（2026-09-25）
   为什么需要：巡检程序实测发现**配图是不稳定的** ——
   同一门物理课，上一次生成出 4 张图，下一次一张都没有（提示词里明明要求了）。
   而"图形是知识载体"的学科没图，课件就退化成文字目录。
   做法：生成完之后检测一次；若该学科**应有图却一张没有**，就为现有页面补一次图。
   成本可控：只发一次很小的请求（输出只有若干 figure 对象），并且：
     · 走同一个 AI 闸门与超时（streamChat）
     · 只接受 figureSVG 真能画出来的 kind（画不出来等于没配）
     · 任何失败都**保留原课件**，不阻断、不降级
   ============================================================ */
function buildFigureFixPrompt(course) {
  const slides = (course.slides || []);
  const lines = slides.map((s, i) => {
    const b = (Array.isArray(s.bullets) ? s.bullets : []).filter(Boolean).slice(0, 4).join('；');
    return (i + 1) + '. ' + (s.title || '') + (b ? '｜' + b : '');
  }).filter((x) => x.length > 4).join('\n');
  return '下面是一节「' + (course.subject || '') + '」课件的页面。请为**适合配图的页面**各设计一个示意图，'
    + '只输出 JSON，不要解释。\n\n页面列表：\n' + lines + '\n\n'
    + '输出格式：[{"i":页面序号,"figure":{...}}]（页面序号从 1 开始）\n'
    + 'figure 的 kind 只能是这六种之一，并附上它需要的字段：\n'
    + '  numberline 数轴：{"kind":"numberline","title":"…","min":-5,"max":5,"marks":[{"v":2,"label":"…"}]}\n'
    + '  bars 条形对比：{"kind":"bars","title":"…","items":[{"label":"…","value":3},{"label":"…","value":5}]}\n'
    + '  pie 扇形占比：{"kind":"pie","title":"…","segments":[{"label":"…","value":1},{"label":"…","value":3}]}\n'
    + '  rect 矩形/面积模型：{"kind":"rect","title":"…","rows":2,"cols":3,"shade":2}\n'
    + '  triangle 三角形：{"kind":"triangle","title":"…","labels":["a","b","c"]}\n'
    + '  function 函数图象：{"kind":"function","title":"…","expr":"linear","a":2,"b":1,"xmin":-5,"xmax":5}\n'
    + '要求：① 只给真正需要图形的页面配图，不需要的一律不要出现在结果里；'
    + '② 图形描述的知识必须和该页内容对得上（不要为了配图而配图）；'
    + '③ 最多 4 个；④ 若确实没有适合配图的页面，输出 []。';
}

async function ensureCourseFigures(course) {
  if (!course || !Array.isArray(course.slides) || !course.slides.length) return 0;
  if (!figureAllowed(course.subject)) return 0;                 // 概念类学科本来就不该配图
  if (course.slides.some((s) => s.figure)) return 0;            // 已经有图就不动
  if (!state.cloud) return 0;                                   // 没连上云端就别硬试
  let added = 0;
  try {
    const raw = await streamChat({
      messages: [
        { role: 'system', content: '你是教学图表示意专家，只输出严格 JSON。不要输出解释或 Markdown 代码块。' },
        { role: 'user', content: buildFigureFixPrompt(course) },
      ],
      temperature: 0.2,
      responseFormat: true,
      onDelta: () => {}, onReasoning: () => {}, onNotice: () => {},
    });
    const arr = parseJSONLoose(raw);
    const list = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.figures) ? arr.figures : []);
    list.forEach((it) => {
      const idx = Number(it && (it.i != null ? it.i : it.index)) - 1;
      const fig = it && it.figure;
      if (!(idx >= 0 && idx < course.slides.length) || !fig) return;
      if (course.slides[idx].figure) return;
      // 必须真能画出来才算配上（figureSVG 对不合法入参会返回空串）
      let svg = '';
      try { svg = figureSVG(fig, course.system === 'intl' ? 'ocean' : 'indigo'); } catch (_) { svg = ''; }
      if (!svg) return;
      course.slides[idx].figure = fig;
      added++;
    });
    if (added) track('figure_backfill', { n: added, subject: String(course.subject || '').slice(0, 20) });
  } catch (e) {
    // 补图失败无所谓：原课件照常可用，不要打扰用户
    try { console.warn('[figure] 补图失败，保留原课件', e && e.message); } catch (_) {}
  }
  return added;
}

async function generateCourse() {
  /* ★ 2026-09-29 修（外部审查 R14）：`requireModel()` 是 async，原来写成
     `if (!requireModel()) return;` —— Promise 对象永远为真，这道门禁**从来没生效过**。
     冷启动（模型列表还没加载回来）时会带着空模型直接发请求。 */
  if (!(await requireModel())) return;
  if (!ensurePhone('生成课程')) return;      // 手机号是要求项：没登记就先补
  const btn = $('#btn-generate');
  genBusy = true;
  genController = new AbortController();
  syncGenButton();
  $('#gen-empty').hidden = true;
  $('#gen-course').hidden = true;
  const streamBox = $('#gen-stream');
  const streamText = $('#gen-stream-text');
  streamBox.hidden = false;
  streamText.textContent = '';

  // 有诊断结果就把它写进长期记忆（登录后生效），让"从哪里讲起"跨课留得住。
  // 放在生成之前，而不是之后 —— 即使这次生成失败，诊断结论也不该丢。
  if (diagState.profile && diagState.profile.judged) {
    persistDiagnostic(diagState.profile, {
      subject: state.gen.subject,
      system: state.gen.system,
      grade: ($('#gen-grade') || {}).value || '',
      goal: (($('#gen-goal') || {}).value || '').trim(),
    }).catch(() => {});
  }

  const sysObj = getSystem(state.gen.system);
  const system = courseSystemPrompt();

  // 用上面那个 genController：按钮"取消生成"就是 abort 它
  const controller = genController;
  try {
    const raw = await streamChat({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: buildCourseOutlinePrompt() },
      ],
      temperature: 0.7,
      responseFormat: true,
      signal: controller.signal,
      // ★ 2026-09-24 修：生成课程要求模型输出 JSON，而原来这里直接把流式原文
      //   （也就是一大段 {"title":"...","knowledgePoints":[...]）贴给学生看 ——
      //   实测会闪出原始 JSON，非常"半成品"。改成只给进度感 + 已能读到的标题。
      onDelta: (_d, full) => {
        const peek = peekCourseTitle(full);
        const n = String(full || '').length;
        streamText.textContent = peek
          ? '灵犀老师正在设计《' + peek + '》…'
          : '灵犀老师正在设计这节课…（已生成 ' + n + ' 字）';
      },
      // 纯推理模型先"想"后"写"，这段静默期里给个明确反馈，别让人以为 AI 挂了
      onReasoning: (_d, _thinking, full) => {
        if (full) return;
        streamText.textContent = '灵犀老师正在设计这节课的讲法与随堂题…';
      },
      onNotice: (msg) => { streamText.textContent = msg; },
    });
    /* ★ 2026-09-24 修「点了取消还是生成出一门课」：
       streamChat 在**用户主动 abort 时是"正常返回"半截内容**（不是抛 AbortError）——
       所以下面那句 parseJSONLoose(半截 JSON) 必然失败，再走兜底课件，
       结果就是"用户点了取消，却得到一门悄悄降级的课"，还留在了课程列表里。
       取消必须是真取消：这里直接返回，不产出任何课程。 */
    if (controller && controller.signal.aborted) {
      streamBox.hidden = true;
      $('#gen-empty').hidden = false;
      toast('已取消生成');
      return;
    }
    const outline = parseJSONLoose(raw);
    const boardNames = selectedBoardNames();
    const course = {
      id: 'c' + Date.now(),
      system: sysObj.id,
      systemName: sysObj.name,
      systemIco: sysObj.ico,
      boards: state.gen.boards.slice(),
      boardNames: boardNames,
      subject: state.gen.subject,
      grade: $('#gen-grade').value,
      level: state.gen.level,
      type: state.gen.type,          // 课型：决定大纲结构与老师教法，卡片上要标出来
      duration: state.gen.duration,
      genLang: teachLang(),          // 生成时的授课语言：课程卡片要标出来，也用于识别"旧语言的课程"
      goal: $('#gen-goal').value.trim(),
      createdAt: Date.now(),
      progress: 0,
      saved: false,
      outline: outline || null,
      rawOutline: outline ? null : raw,
      // 诊断画像随课程走：直播时老师能直接引用，不必依赖已登录的记忆
      diag: diagState.profile ? {
        focus: diagState.profile.focus.slice(0, 8),
        skip: diagState.profile.skip.slice(0, 8),
        counts: Object.assign({}, diagState.profile.counts),
        score: diagState.profile.score,
      } : null,
    };
    if (outline && outline.title) {
      course.title = outline.title;
    } else {
      /* ★ 2026-09-24 修「静默降级」：模型返回的 JSON 解析失败时，原来只是**悄悄**把标题换成
         默认值（"学科 · 难度 一对一课"）并走 3 页兜底课件 —— 用户看到卡片出现了，
         会以为生成成功，实际上这节课的大纲根本不是为他设计的，上课质量也差。
         这种情况必须说出来，并且给一次重试的机会。 */
      course.title = state.gen.subject + ' · ' + state.gen.level + '一对一课';
      course.outlineFailed = true;
      try { track('outline_parse_failed', { subject: String(state.gen.subject || ''), rawLen: String(raw || '').length }); } catch (_) {}
    }
    course.slides = normalizeSlides(outline, course);
    /* 配图补全：实测配图不稳定（同一门物理课，上次 4 张图、这次 0 张）。
       "图形即知识载体"的学科缺图会让课件退化成文字目录，所以这里补一次。
       失败不阻断 —— 补不上就照原样给。 */
    try {
      const nFig = await ensureCourseFigures(course);
      if (nFig) toast('已为这节课补上 ' + nFig + ' 张示意图', 'ok');
    } catch (_) {}
    streamBox.hidden = true;
    renderGenCourse(course);
    window.__lastGenerated = course;
    if (course.outlineFailed) {
      toast('这节课的结构没生成完整，已先用简化版顶上。建议点「重新生成」再试一次。', 'err');
    }
    track('course_generate', {
      title: String(course.title || '').slice(0, 80), subject: String(course.subject || ''),
      grade: String(course.grade || ''), slides: (course.slides || []).length,
      hasOutline: !!outline, model: (state.model && state.model.id) || '',
    });
    if (!outline) toast('AI 返回的格式略有偏差，已按原文展示，仍可上课', 'err');
  } catch (e) {
    if (e && e.name === 'AbortError') {
      toast('已取消生成');
      streamBox.hidden = true;
    } else {
      const msg = mapLLMError(e) + errorRequestId(e);
      toast(msg, 'err');
      // 失败原因留在页面上：只闪一个 3 秒的 toast，用户会以为"点了没反应"
      streamText.textContent = '生成失败：' + msg +
        '\n\n可以点右上角「AI 状态」重试，或换一个模型再试。';
      streamBox.hidden = false;
      $('#gen-empty').hidden = true;
    }
  } finally {
    genBusy = false;
    genController = null;
    syncGenButton();          // 恢复成「✨ AI 生成课程」，且保证可点（含取消后）
  }
}

function courseTags(course) {
  const sysTag = course.systemName
    ? `<span class="tag sys">${esc(course.systemIco || '')} ${esc(course.systemName)}</span>` : '';
  const boardTag = (course.boards && course.boards.length)
    ? course.boards.map((id) => {
      const b = getBoards(getSystem('intl')).find((x) => x.id === id);
      return b ? `<span class="tag board">${b.ico} ${esc(b.name)}</span>` : '';
    }).join('')
    : '';
  // 课型标签：让"这节课怎么上"一眼可见（不同课型的教法确实不同）
  const t = COURSE_TYPES.find((x) => x.id === course.type);
  const typeTag = t ? `<span class="tag type">${t.ico} ${esc(t.name)}</span>` : '';
  return `${sysTag}${boardTag}${typeTag}
        <span class="tag">${esc(course.subject)} · ${esc(course.grade)}</span>
        <span class="tag orange">${esc(course.level)}</span>
        <span class="tag teal">${esc(course.duration)}</span>`;
}

function renderGenCourse(course) {
  const o = course.outline;
  const el = $('#gen-course');
  const tags = courseTags(course);
  if (!o) {
    /* 走兜底的分支：**必须明说这是降级结果**，否则用户以为生成成功了
       （原来只有一行小字"AI 未返回结构化大纲"，藏在原文里不显眼） */
    el.innerHTML = `
      <div class="cc-degraded">⚠️ 这节课的结构没生成完整 —— 下面是模型返回的原文方案，已可先用，
        但讲解节奏与课件都会比较粗糙。建议点下方「重新生成」再试一次。</div>
      <h3>${esc(course.title)}</h3>
      <div class="cc-tags">${tags}</div>
      <div class="cc-summary" style="white-space:pre-wrap">${esc(course.rawOutline)}</div>
      <div class="cc-actions">
        <button class="btn btn-ghost" id="btn-save-only">暂存到我的课程</button>
        <button class="btn btn-primary" id="btn-go-live">进入直播间</button>
      </div>`;
  } else {
    const stages = Array.isArray(o.stages) ? o.stages : [];
    const kps = Array.isArray(o.knowledgePoints) ? o.knowledgePoints : [];
    const hw = Array.isArray(o.homework) ? o.homework : [];
    el.innerHTML = `
      <div class="cc-top">
        <div>
          <h3>${esc(o.title || course.title)}</h3>
          <div class="cc-tags">${tags}</div>
        </div>
      </div>
      <p class="cc-summary">${esc(o.summary || '')}</p>
      ${kps.length ? `<div class="cc-block"><b>🎯 本课知识点</b><div class="kp-wrap">${
        kps.map((k) => `<span class="kp">${esc(k)}</span>`).join('')
      }</div></div>` : ''}
      ${stages.length ? `<div class="cc-block"><b>🧭 教学环节</b>${stages.map((s, i) => `
        <div class="stage-item">
          <span class="st-no">${i + 1}</span>
          <div><b>${esc(s.name || '环节' + (i + 1))}<span class="st-dur">${esc(s.duration || '')}</span></b>
          <p>${esc(s.content || '')}</p></div>
        </div>`).join('')}</div>` : ''}
      ${hw.length ? `<div class="cc-block"><b>✏️ 课后练习</b><div class="kp-wrap">${
        hw.map((h) => `<span class="kp">${esc(h)}</span>`).join('')
      }</div></div>` : ''}
      ${o.tips ? `<div class="cc-block"><b>💡 灵犀小贴士</b><p class="cc-summary">${esc(o.tips)}</p></div>` : ''}
      ${(course.slides && course.slides.length) ? `
      <div class="cc-block">
        <b>📊 配套课件 <span class="slide-count">${course.slides.length} 页</span></b>
        <div class="slide-strip">
          ${course.slides.map((s, i) => `
            <div class="slide-thumb" data-slide="${i}">
              <span class="sth-no">${i + 1}</span>
              <span class="sth-title">${esc(s.title)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
      <div class="cc-actions">
        <button class="btn btn-ghost" id="btn-save-only">暂存到我的课程</button>
        ${(course.slides && course.slides.length) ? '<button class="btn btn-ghost" id="btn-preview-slides">预览课件</button>' : ''}
        <button class="btn btn-primary" id="btn-go-live">进入直播间开课</button>
      </div>`;
  }
  el.hidden = false;
  const saveOnly = $('#btn-save-only');
  if (saveOnly) saveOnly.addEventListener('click', () => saveCourse(course, true));
  const goLive = $('#btn-go-live');
  if (goLive) goLive.addEventListener('click', () => {
    saveCourse(course, false);
    enterLive(course);
  });
  const pv = $('#btn-preview-slides');
  if (pv) pv.addEventListener('click', () => openSlidePreview(course));
  const strip = el.querySelector('.slide-strip');
  if (strip) {
    strip.addEventListener('click', (ev) => {
      const t = ev.target.closest('.slide-thumb');
      if (!t) return;
      openSlidePreview(course, Number(t.dataset.slide));
    });
  }
}

/* ==================== 入学诊断：生成 / 作答 / 起点画像 ==================== */
/* 状态：diag 为当前诊断卷（含 items 与学生作答），profile 为聚合出的起点画像 */
const diagState = { paper: null, answers: {}, profile: null };

/* 渲染整份诊断卷。用原生 radio/textarea，不用自定义组件 ——
   开课前少一个"点不动"的可能。 */
function renderDiagnostic() {
  const el = $('#gen-diag');
  if (!el) return;
  const p = diagState.paper;
  if (!p || !p.items.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const answered = p.items.filter((it, i) => {
    const a = diagState.answers[i];
    return a && String(a.value || '').trim() !== '';
  }).length;

  el.innerHTML =
    '<div class="diag-head">' +
      '<b>📝 ' + esc(p.title) + '</b>' +
      '<span class="diag-prog" id="diag-prog">' + answered + ' / ' + p.items.length + ' 已作答</span>' +
    '</div>' +
    '<p class="diag-intro">' + esc(p.intro) + '</p>' +
    '<div class="diag-list">' + p.items.map((it, i) => diagItemHTML(it, i)).join('') + '</div>' +
    '<div class="diag-actions">' +
      '<button class="btn btn-primary" id="btn-diag-submit">提交，生成起点画像</button>' +
      '<button class="btn btn-ghost" id="btn-diag-skip">跳过诊断，直接生成课程</button>' +
    '</div>' +
    '<p class="form-hint">诊断只用来决定这节课从哪里讲起，<b>不影响</b>你能生成的课程内容。</p>';

  bindDiagEvents();
}

function diagItemHTML(it, i) {
  const a = diagState.answers[i] || {};
  const head = '<div class="diag-q-head"><span class="diag-no">' + (i + 1) + '</span>' +
    '<span class="diag-topic">' + esc(it.topic) + '</span></div>' +
    '<div class="diag-stem">' + mdLite(it.question) + '</div>';

  if (it.type === 'choice' && it.options.length) {
    const opts = it.options.map((o, k) => {
      const letter = String(o).trim().charAt(0).toUpperCase();
      const checked = String(a.value || '').toUpperCase() === letter ? ' checked' : '';
      return '<label class="diag-opt">' +
        '<input type="radio" name="diag-' + i + '" value="' + esc(letter) + '"' + checked + '>' +
        '<span class="diag-opt-key">' + esc(letter) + '</span>' +
        '<span class="diag-opt-txt">' + esc(String(o).replace(/^[A-Fa-f][.、．)）]\s*/, '')) + '</span>' +
        '</label>';
    }).join('');
    return '<div class="diag-item" data-i="' + i + '">' + head + '<div class="diag-opts">' + opts + '</div></div>';
  }

  // 简答题：写上答案 + 自评（自评是简答题唯一可用的判据，必须让填）
  const self = String(a.self || '');
  return '<div class="diag-item" data-i="' + i + '">' + head +
    '<textarea class="diag-open" rows="2" data-i="' + i + '" placeholder="写下你的答案或思路；不会就直接留空，也可以的">' +
      esc(a.value || '') + '</textarea>' +
    '<div class="diag-self">' +
      '<span>自评：</span>' +
      '<label><input type="radio" name="diag-self-' + i + '" value="sure"' + (self === 'sure' ? ' checked' : '') + '>做对了</label>' +
      '<label><input type="radio" name="diag-self-' + i + '" value="unsure"' + (self === 'unsure' ? ' checked' : '') + '>不确定</label>' +
    '</div></div>';
}

function updateDiagProgress() {
  const el = $('#diag-prog');
  const p = diagState.paper;
  if (!el || !p) return;
  const answered = p.items.filter((it, i) => {
    const a = diagState.answers[i];
    return a && String(a.value || '').trim() !== '';
  }).length;
  el.textContent = answered + ' / ' + p.items.length + ' 已作答';
}

function bindDiagEvents() {
  const el = $('#gen-diag');
  if (!el) return;
  // 选择题：点选即记
  el.querySelectorAll('input[type=radio][name^="diag-"]').forEach((r) => {
    const m = /^diag-(\d+)$/.exec(r.name);
    if (!m) return;
    r.addEventListener('change', () => {
      const i = Number(m[1]);
      diagState.answers[i] = Object.assign({}, diagState.answers[i], { value: r.value });
      updateDiagProgress();
    });
  });
  // 简答题：输入即记（用 input 而非 change，避免点"提交"时还没 blur 导致丢答案）
  el.querySelectorAll('textarea.diag-open').forEach((ta) => {
    ta.addEventListener('input', () => {
      const i = Number(ta.dataset.i);
      diagState.answers[i] = Object.assign({}, diagState.answers[i], { value: ta.value });
      updateDiagProgress();
    });
  });
  el.querySelectorAll('input[type=radio][name^="diag-self-"]').forEach((r) => {
    const m = /^diag-self-(\d+)$/.exec(r.name);
    if (!m) return;
    r.addEventListener('change', () => {
      const i = Number(m[1]);
      diagState.answers[i] = Object.assign({}, diagState.answers[i], { self: r.value });
    });
  });
  const sub = $('#btn-diag-submit');
  if (sub) sub.addEventListener('click', () => submitDiagnostic());
  const skip = $('#btn-diag-skip');
  if (skip) skip.addEventListener('click', () => {
    diagState.paper = null;
    diagState.answers = {};
    diagState.profile = null;
    const box = $('#gen-diag');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    toast('已跳过诊断，直接生成课程');
  });
}

/* 生成诊断卷（LLM） */
async function generateDiagnostic() {
  /* ★ 2026-09-29 修（外部审查 R14）：同 generateCourse，漏了 await。 */
  if (!(await requireModel())) return;
  const btn = $('#btn-diag-gen');
  const box = $('#gen-diag');
  if (btn) { btn.disabled = true; btn.textContent = '诊断卷生成中…'; }
  const prev = $('#gen-course');
  if (prev) prev.hidden = true;
  const empty = $('#gen-empty');
  if (empty) empty.hidden = true;
  if (box) {
    box.hidden = false;
    box.innerHTML = '<div class="diag-loading"><i class="dot dot-live"></i>正在根据你的目标出诊断题…</div>';
  }

  const opt = {
    system: state.gen.system,
    subject: state.gen.subject,
    grade: ($('#gen-grade') || {}).value || '',
    goal: (($('#gen-goal') || {}).value || '').trim(),
    boards: selectedBoardNames(),
    count: 6,
  };
  try {
    const raw = await streamChat({
      messages: [
        { role: 'system', content: diagnosticSystemPrompt() },
        { role: 'user', content: buildDiagnosticPrompt(opt) },
      ],
      temperature: 0.6,
      responseFormat: true,
      onDelta: (_d, full) => {
        if (box && full) box.querySelector('.diag-loading').textContent = '正在出题…（' + full.length + ' 字）';
      },
      onNotice: (msg) => {
        if (box && box.querySelector('.diag-loading')) box.querySelector('.diag-loading').textContent = msg;
      },
    });
    const parsed = parseJSONLoose(raw);
    const paper = cleanDiagnostic(parsed, opt);
    if (!paper.items.length) {
      if (box) { box.hidden = true; box.innerHTML = ''; }
      toast('诊断卷生成失败，可直接生成课程', 'err');
      return;
    }
    diagState.paper = paper;
    diagState.answers = {};
    diagState.profile = null;
    // 以前白名单里声明了 diag_generate 却从未调用 → 这个指标一直是瞎的，这里补上
    try { track('diag_generate', { subject: opt.subject, count: paper.items.length, system: opt.system }); } catch (_) {}
    renderDiagnostic();
  } catch (e) {
    if (e && e.name === 'AbortError') {
      toast('已取消');
    } else {
      toast(mapLLMError(e) + errorRequestId(e), 'err');
    }
    if (box) { box.hidden = true; box.innerHTML = ''; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📝 先做课前诊断（可选）'; }
  }
}

/* 提交诊断 → 算起点画像 → 渲染 → 为用户下一步生成课程做好准备 */
function submitDiagnostic() {
  const p = diagState.paper;
  if (!p || !p.items.length) return;
  const answers = p.items.map((_, i) => diagState.answers[i] || {});
  const profile = buildDiagnostic(p.items, answers);
  diagState.profile = profile;
  renderDiagProfile(profile);
  // 提交后收起答题区，只留画像
  const list = $('#gen-diag .diag-list');
  if (list) list.hidden = true;
  const acts = $('#gen-diag .diag-actions');
  if (acts) acts.hidden = true;
  toast('起点画像已生成，课程会从这里讲起');
  track('diag_complete', {
    subject: String(p.subject || ''), grade: String(p.grade || ''),
    total: profile.total, ok: profile.counts.ok, fuzzy: profile.counts.fuzzy, gap: profile.counts.gap, na: profile.counts.na,
  });
}

/* 渲染起点画像 */
function renderDiagProfile(profileRaw) {
  const el = $('#gen-diag');
  const profile = normalizeDiagProfile(profileRaw);      // 模型输出最容易缺字段，先进归一化
  if (!el || !profile) return;
  const c = profile.counts;
  const chip = '<span class="dp-chip">' +
    esc(DIAG_MIN) + '~' + esc(DIAG_MAX) + ' 题 · 覆盖 ' + esc(profile.total) + ' 个知识点</span>';

  // 单个知识点一行：topic / reason 都是模型或学生输入，必须转义
  const topicRow = (t) => {
    const L = DIAG_LEVELS[t.level] || DIAG_LEVELS.na;
    return '<div class="dp-topic ' + L.cls + '">' +
      '<span class="dp-ico">' + L.icon + '</span>' +
      '<b>' + esc(t.topic) + '</b>' +
      '<span class="dp-lv">' + L.label + '</span>' +
      (t.reason ? '<span class="dp-why">' + esc(t.reason) + '</span>' : '') +
      '</div>';
  };

  // verdict 里有我故意写进去的 <b> 强调标签，但它是 buildDiagnostic 里
  // 我自己拼的固定文案（不含任何模型/用户输入），所以只做定长白名单式放行：
  // 先把 <b></b> 抠出来，其余字符一律走 esc()，这样即便将来文案里混进变量也不会漏。
  const safeVerdict = esc(String(profile.verdict || ''))
    .replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');

  // 把画像 HTML 插到答题区上方（答题区已隐藏）。
  // 下面每一处动态值都当场走 esc()/mdLite() —— 不依赖"上面的 helper 已经转过了"，
  // 因为那种间接转义既无法被静态审查看到，将来改 helper 时也会静默变脏。
  const box = document.createElement('div');
  box.className = 'dp-wrap';
  box.innerHTML =
    // chip 是自己拼的固定结构（DIAG_MIN/MAX 为常量，只有 total 是数值），
    // 必须原样插入 HTML —— 若走 mdLite() 会被转义成可见的源码文本
    '<div class="dp-top">' + mdLite('🎯 你的起点画像') + chip + '</div>' +
    '<div class="dp-stats">' +
      '<div class="dp-stat ok"><b>' + esc(c.ok) + '</b><span>已掌握</span></div>' +
      '<div class="dp-stat fuzzy"><b>' + esc(c.fuzzy) + '</b><span>待确认</span></div>' +
      '<div class="dp-stat gap"><b>' + esc(c.gap) + '</b><span>未掌握</span></div>' +
      (c.na ? '<div class="dp-stat na"><b>' + esc(c.na) + '</b><span>未作答</span></div>' : '') +
    '</div>' +
    // verdict 里的 <b> 是我自己写的固定强调；safeVerdict 已做"先全转义再放回 b 标签"
    '<div class="dp-verdict">' + safeVerdict + '</div>' +
    (profile.focus.length ? '<div class="dp-block"><b>▶ 这节课重点讲</b><div class="dp-topics">' +
      profile.topics.filter((t) => profile.focus.indexOf(t.topic) >= 0).map((t) => topicRow(t)).join('') +
      '</div></div>' : '') +
    (profile.skip.length ? '<div class="dp-block"><b>⏭ 可以跳过（已掌握）</b><div class="dp-skips">' +
      profile.skip.map((t) => '<span class="dp-skip">' + esc(t) + '</span>').join('') +
      '</div></div>' : '') +
    '<p class="dp-hint">这份画像会一起交给老师 —— 上课时他/她<b>不会再讲你已经会的部分</b>，' +
    '而是直接从标红的知识点开始。多错几道反而是好事，说的是真话才能真的帮到你。</p>' +
    '<div class="dp-actions">' +
      '<button class="btn btn-ghost btn-sm" id="btn-diag-retry">重做一遍</button>' +
      '<button class="btn btn-primary btn-sm" id="btn-diag-tocourse">继续生成课程 →</button>' +
    '</div>';
  el.appendChild(box);

  const retry = box.querySelector('#btn-diag-retry');
  if (retry) retry.addEventListener('click', () => {
    diagState.answers = {};
    diagState.profile = null;
    const old = $('#gen-diag .dp-wrap');
    if (old) old.remove();
    const list = $('#gen-diag .diag-list');
    if (list) list.hidden = false;
    const acts = $('#gen-diag .diag-actions');
    if (acts) acts.hidden = false;
    if (list) list.querySelectorAll('input, textarea').forEach((x) => {
      if (x.type === 'radio' || x.type === 'checkbox') x.checked = false;
      else x.value = '';
    });
    updateDiagProgress();
  });
  const toc = box.querySelector('#btn-diag-tocourse');
  if (toc) toc.addEventListener('click', () => {
    const g = $('#btn-generate');
    if (g) {
      g.scrollIntoView({ behavior: 'smooth', block: 'center' });
      g.classList.add('pulse');
      setTimeout(() => g.classList.remove('pulse'), 1600);
    }
    toast('点「✨ AI 生成课程」，会带上你的起点画像');
  });
}

/* 把起点画像写进长期记忆：让"这节课从哪里讲起"跨课生效 */
async function persistDiagnostic(profile, opt) {
  if (!profile || !profile.judged) return 0;
  const o = opt || {};
  const facts = [];
  // 未掌握 / 待确认 → 薄弱点，直接进 prompt 的"需要重点关注"
  profile.topics.filter((t) => t.level === 'gap').forEach((t) => {
    facts.push({
      kind: 'weak', topic: t.topic, subject: o.subject || state.gen.subject,
      confidence: 0.9, source: 'diagnostic',
      content: '课前诊断显示「' + t.topic + '」还没掌握' + (t.reason ? '（' + t.reason + '）' : '') +
        '，第一节课要从这里开始讲。',
    });
  });
  profile.topics.filter((t) => t.level === 'fuzzy').forEach((t) => {
    facts.push({
      kind: 'weak', topic: t.topic, subject: o.subject || state.gen.subject,
      confidence: 0.65, source: 'diagnostic',
      content: '课前诊断显示「' + t.topic + '」掌握得不牢' + (t.reason ? '（' + t.reason + '）' : '') +
        '，需要再确认一遍。',
    });
  });
  // 已掌握 → 优势，用于让老师跳过铺垫
  profile.topics.filter((t) => t.level === 'ok').forEach((t) => {
    facts.push({
      kind: 'strength', topic: t.topic, subject: o.subject || state.gen.subject,
      confidence: 0.8, source: 'diagnostic',
      content: '课前诊断中「' + t.topic + '」答对了，已掌握，讲课时可以直接略过基础铺垫。',
    });
  });
  facts.push({
    kind: 'context', subject: o.subject || state.gen.subject,
    confidence: 0.75, source: 'diagnostic',
    content: '入学诊断起步水平：' + profile.counts.ok + ' 个知识点已掌握、' +
      profile.counts.fuzzy + ' 个待确认、' + profile.counts.gap + ' 个未掌握（共判断 ' +
      profile.judged + ' 个知识点）。',
  });
  const n = await saveFacts(facts);
  // 画像里的 goal / level 也顺手补上，让 memoryPromptBlock 更完整
  try {
    await saveProfile({
      grade: o.grade || undefined,
      system: getSystem(o.system || state.gen.system).name,
      goal: o.goal || undefined,
      level: profile.counts.gap > profile.counts.ok ? '基础巩固' : '进阶提升',
    });
  } catch (_) {}
  return n;
}

/* 起点画像 → 课程生成提示词的一段。
   ★ 这是整个诊断功能的落点：**把"哪些可以不讲"明确交给课程设计模型**。
   只告诉它"学生薄弱"是不够的 —— 必须同时说"这些他已经会了，别讲"。 */
function diagnosticPromptBlock() {
  const pf = diagState.profile;
  if (!pf || !pf.judged) return '';
  const lines = [];
  if (pf.focus.length) lines.push('· 诊断显示**尚未掌握 / 需要确认**的知识点：' + pf.focus.join('、'));
  if (pf.skip.length) {
    lines.push('· 诊断显示**已经掌握**的知识点：' + pf.skip.join('、') +
      ' —— 这些**不要再花时间从零讲**，最多用一道小题快速带过。');
  }
  lines.push('· 请按此调整这节课的重心：把主要时间给到上面"尚未掌握"的知识点，' +
    '难度从它们的基础形态切入，不要因为学生选了"' + state.gen.level + '"就默认他已具备全部前置知识。');
  return '\n【课前诊断结果（这位学生刚做的起点测验）】\n' + lines.join('\n') + '\n';
}

/* ==================== 课件：预览 / 放映 / 导出 PPTX ==================== */
const slideState = { course: null, index: 0, mode: 'preview' };

/* 生成一页幻灯片的 HTML（16:9），封面 / 内容 / 练习 / 小结 四种版式 */
function slideHTML(slide, i, total, theme) {
  const t = theme || 'indigo';
  // 类型：显式 type 优先，兼容老的 cover 判定
  let type = slide.type;
  if (!type) type = (slide.cover === true || ((slide.bullets || []).length === 0 && i === 0)) ? 'cover' : 'content';
  const isCover = type === 'cover';
  const isQuiz = type === 'quiz';
  const isSummary = type === 'summary';
  const cls = 'sl sl-' + t + (isCover ? ' sl-cover' : '') + (isQuiz ? ' sl-quiz' : '') + (isSummary ? ' sl-summary' : '');

  if (isCover) {
    return `<div class="${cls}">
      <div class="sl-deco"></div>
      <div class="sl-body">
        <h2>${esc(slide.title)}</h2>
        ${slide.subtitle ? `<p class="sl-sub">${esc(slide.subtitle)}</p>` : ''}
        <div class="sl-foot">灵犀课堂 · AI 一对一直播课</div>
      </div>
      <span class="sl-page">${i + 1} / ${total}</span>
    </div>`;
  }

  const head = `<div class="sl-head">
      <h3>${esc(slide.title)}</h3>
      ${slide.subtitle ? `<span class="sl-sub-inline">${esc(slide.subtitle)}</span>` : ''}
    </div>`;

  if (isQuiz) {
    // 练习页：题干 + 选项（点击可高亮）+ 折叠的答案与解析
    const opts = (slide.options || []).map((o, k) => {
      const letter = String(o).trim().charAt(0).toUpperCase();
      const isRight = slide.answer && letter === String(slide.answer).trim().toUpperCase();
      return `<li class="qz-opt${isRight ? ' qz-right' : ''}" data-opt="${esc(letter)}">
        <span class="qz-key">${esc(letter)}</span>
        <span class="qz-txt">${mdLite(String(o).replace(/^[A-Da-d][.、．)）]\s*/, ''))}</span>
      </li>`;
    }).join('');
    const ansBlock = (slide.answer || slide.analysis) ? `
      <details class="qz-ans">
        <summary>查看答案与解析</summary>
        <div class="qz-ans-body">
          ${slide.answer ? `<p class="qz-ans-line"><b>正确答案：</b><span class="qz-ans-key">${esc(slide.answer)}</span></p>` : ''}
          ${slide.analysis ? `<p class="qz-ans-txt">${mdLite(slide.analysis)}</p>` : ''}
        </div>
      </details>` : '';
    return `<div class="${cls}">
      ${head}
      <div class="qz-body">
        <div class="qz-stem"><span class="qz-badge">练习</span>${mdLite(slide.question || '请完成本题')}</div>
        ${opts ? `<ul class="qz-opts">${opts}</ul>` : '<div class="qz-open">请写出你的解答过程，完成后我们一起对照检查。</div>'}
        ${ansBlock}
      </div>
      <span class="sl-page">${i + 1} / ${total}</span>
    </div>`;
  }

  // 内容页 / 小结页
  const bullets = (slide.bullets || []).map((b) => `<li>${mdLite(b)}</li>`).join('');
  // 有示意图时：图文左右分栏（图占右侧，讲课时视线有落点）
  const fig = slide.figure ? figureSVG(slide.figure, theme) : '';
  if (fig) {
    return `<div class="${cls} sl-has-fig">
    ${head}
    <div class="sl-fig-wrap">
      <ul class="sl-bullets">${bullets || '<li>重点讲解</li>'}</ul>
      <div class="sl-figure">${fig}</div>
    </div>
    <span class="sl-page">${i + 1} / ${total}</span>
  </div>`;
  }
  return `<div class="${cls}">
    ${head}
    <ul class="sl-bullets">${bullets || '<li>重点讲解</li>'}</ul>
    <span class="sl-page">${i + 1} / ${total}</span>
  </div>`;
}

/* 课件主题（按体系区分配色） */
function slideTheme(course) {
  if (course && course.system === 'intl') return 'ocean';
  return 'indigo';
}

function openSlidePreview(course, startIndex) {
  const modal = $('#slide-modal');
  const slides = course.slides || [];
  if (!slides.length) { toast('这节课还没有课件', 'err'); return; }
  slideState.course = course;
  slideState.mode = 'preview';
  slideState.index = Number.isFinite(startIndex) ? startIndex : 0;
  $('#slide-modal-title').textContent = '课件预览 · ' + course.title;
  modal.hidden = false;
  renderSlideViewer();
}

function renderSlideViewer() {
  const { course, index, mode } = slideState;
  const slides = course.slides || [];
  const total = slides.length;
  const theme = slideTheme(course);
  // 主画面：放映模式加上下页提示
  $('#slide-stage').innerHTML = slideHTML(slides[index], index, total, theme);
  $('#slide-pageinfo').textContent = (index + 1) + ' / ' + total;
  // 缩略图
  $('#slide-nav').innerHTML = slides.map((s, i) => `
    <button class="snav-item${i === index ? ' active' : ''}" data-goto="${i}">
      <span class="snav-no">${i + 1}</span>
      <span class="snav-title">${esc(s.title)}</span>
    </button>`).join('');
  // 讲稿备注（预览模式下显示）
  const note = slides[index].note || '';
  const noteEl = $('#slide-note');
  noteEl.hidden = !note;
  noteEl.innerHTML = note ? `<b>🎙 讲稿：</b>${esc(note)}` : '';
  $('#btn-slide-prev').disabled = index === 0;
  $('#btn-slide-next').disabled = index === total - 1;
}

function slideGo(delta) {
  const slides = slideState.course.slides || [];
  const next = slideState.index + delta;
  if (next < 0 || next >= slides.length) return;
  slideState.index = next;
  renderSlideViewer();
}

function closeSlidePreview() {
  $('#slide-modal').hidden = true;
  slideState.course = null;
}

/* 导出为真实 .pptx（浏览器端生成，无需后端） */
/* 把示意图 SVG 转成 PNG data URL（2026-09-25）
   为什么不用 SVG 直接插：
   ① 原写法 `data: 'image/svg+xml;base64,' + b64` **缺 `data:` 前缀** ——
      pptxgen 会把整串当作图片内容、并按 png 处理，生成 `image/svg+xml;base64,....=png`
      这种废数据，随后在 **write() 阶段**报 "Unable to load image" 并让**整个导出失败**。
      注意这个失败发生在稍后（图片是异步加载的），所以 `try { addImage } catch` **兜不住** ——
      实测：课件带图时点导出直接失败。
   ② 即便修好前缀，老版 PowerPoint / 部分 WPS 对 SVG 支持不稳。
   所以统一走 canvas 转 PNG：兼容性最好，且矢量在小画布上转出来足够清晰。 */
function svgToPngDataURL(svg, pxW, pxH) {
  return new Promise((resolve) => {
    try {
      /* ★★ 必须补 xmlns（2026-09-25 实测）：
         figureSVG() 生成的 <svg> 没有 xmlns —— 这在**内联进 HTML** 时没问题（走 HTML 解析），
         但把它当**独立图片**加载时（blob URL → Image），SVG 是按 **XML** 解析的，
         缺 xmlns 会直接解析失败 → img.onerror → 转 PNG 失败。
         实测后果：5 张图全部静默跳过，导出的 PPT 一张图都没有。 */
      let src = String(svg || '');
      if (!/xmlns\s*=/.test(src)) {
        src = src.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const blob = new Blob([src], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = pxW;
          cv.height = pxH;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#FFFFFF';          // 透明底在 PPT 深色主题下会看不清，铺白底
          ctx.fillRect(0, 0, pxW, pxH);
          ctx.drawImage(img, 0, 0, pxW, pxH);
          resolve(cv.toDataURL('image/png'));
        } catch (_) { resolve(null); }
        try { URL.revokeObjectURL(url); } catch (_) {}
      };
      img.onerror = () => {
        try { URL.revokeObjectURL(url); } catch (_) {}
        resolve(null);
      };
      img.src = url;
    } catch (_) { resolve(null); }
  });
}

/* 兜底：转 PNG 失败时，退回用 **带正确 data: 前缀** 的 SVG data URI。
   （原写法缺 `data:`，会让整个导出失败；补上前缀后新版 PowerPoint/WPS 可以正常显示。
     只作为兜底 —— 优先还是 PNG，兼容性最好。） */
function svgDataURI(svg) {
  try {
    let src = String(svg || '');
    if (!/xmlns\s*=/.test(src)) src = src.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(src)));
  } catch (_) { return null; }
}

async function exportPPTX(course, btn) {
  state._pptTried = true;          // 供自检判断"已尝试导出却加载不上组件"
  /* pptxgen 改为按需加载（466KB，服务器又不压缩，不该每次访问都拖）。
     第一次点导出时现场取回来 —— 会有几秒等待，所以先给提示，别让用户以为没反应。 */
  if (!window.PptxGenJS && !(window.pptxgen && window.pptxgen.default)) {
    toast('正在准备导出组件（首次约需几秒）…', 'ok');
    await ensureVendors('PptxGenJS');
  }
  const PptxGenJS = window.PptxGenJS || (window.pptxgen && window.pptxgen.default);
  if (!PptxGenJS) { toast('PPT 导出组件加载失败，请检查网络后重试', 'err'); return; }

  const slides = course.slides || [];
  if (!slides.length) { toast('这节课还没有课件', 'err'); return; }

  /* 导出前先跑课件质量校验：有缺项就在下载的同时如实告知（不阻断 ——
     用户可能就是要这份；但"课件没图/没例子"这种事必须说出来，不能让他拿到手才发现） */
  try { reportCoursewareQuality(course); } catch (_) {}

  const isIntl = course.system === 'intl';
  const PRIMARY = isIntl ? '0284C7' : '5B5CE6';
  const PRIMARY2 = isIntl ? '0EA5E9' : '8B5CF6';
  const INK = '1D2130';
  const MUTED = '6B7186';
  const FONT = '微软雅黑';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = '灵犀课堂';
  pptx.company = '灵犀课堂 LingXi Classroom';
  pptx.title = course.title;

  /* ★ 2026-09-25 导出优化：让这份 PPT 真的能当"教案"用
     原来只导出了 slides，而 course.outline 里的**环节安排（stages）与知识点**从没导出过 ——
     老师下载下来只有一堆内容页，看不到"这节课怎么推进、每段多长时间"。
     现在补齐：封面加课程信息 → 本课安排 → 本课知识点 → 内容/练习页 → 小结。
     另外给长文本加 fit:'shrink'（原来固定高度，要点一多就溢出到页面外）。 */
  const o = course.outline || {};
  const stageList = Array.isArray(o.stages) ? o.stages.filter((x) => x && x.name) : [];
  const kpList = Array.isArray(o.knowledgePoints) ? o.knowledgePoints.filter(Boolean) : [];
  const metaParts = [course.subject, course.grade,
    // 时长：duration 本身常常已经带"分钟"了，别再补一个（实测出现过"45 分钟 分钟"）
    (function () {
      const d = String(course.duration == null ? '' : course.duration).trim();
      if (!d) return '';
      return /分钟|分|hour|min/i.test(d) ? d : d + ' 分钟';
    })(),
    (function () {                              // 课型：老课程没有 type 字段，取不到就不显示
      const t = COURSE_TYPES.find((x) => x.id === course.type);
      return t ? t.name : '';
    })()].filter(Boolean);
  const metaLine = metaParts.join(' · ');

  /* 页脚：课程名 + 页码（原来只有页码，打印出来分不清是哪节课） */
  const addFooter = (slide, idx, total) => {
    const t = String(course.title || '').slice(0, 28);
    slide.addText(t, {
      x: 0.7, y: 5.16, w: 6.4, h: 0.3, fontSize: 9, color: MUTED, fontFace: FONT, align: 'left',
    });
    slide.addText(String(idx) + ' / ' + total, {
      x: 8.2, y: 5.16, w: 1.1, h: 0.3, fontSize: 9, color: MUTED, fontFace: FONT, align: 'right',
    });
  };
  // 前面会比 slides 多出"本课安排""本课知识点"这类附加页
  const extraCount = (stageList.length ? 1 : 0) + (kpList.length ? 1 : 0) + (o.homework ? 1 : 0);
  const totalPages = slides.length + extraCount;
  let figureFallback = 0;      // 转 PNG 失败、退回 SVG 的页数
  let figureFailed = 0;        // 图完全插不进去的页数（要告诉用户，不能静默）

  /* 改成 for...of：下面要把 SVG 转 PNG 再插，需要 await */
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const isCover = s.type === 'cover' || (s.cover === true) ||
      ((s.bullets || []).length === 0 && i === 0 && s.type !== 'quiz');
    const isQuiz = !isCover && s.type === 'quiz';
    const isSummary = !isCover && s.type === 'summary';
    const slide = pptx.addSlide();

    if (isCover) {
      slide.background = { color: PRIMARY };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 3.35, w: 10, h: 0.06, fill: { color: PRIMARY2 } });
      slide.addText(s.title || course.title, {
        x: 0.8, y: 1.35, w: 8.4, h: 1.1, fontSize: 36, bold: true,
        color: 'FFFFFF', fontFace: FONT, align: 'left', fit: 'shrink',
      });
      // 课程信息（科目/学段/时长/课型）—— 老师拿到文件一眼知道这是哪节课
      if (metaLine) {
        slide.addText(metaLine, {
          x: 0.8, y: 2.5, w: 8.4, h: 0.35, fontSize: 13, color: 'C7D2FE', fontFace: FONT,
        });
      }
      const sub = s.subtitle || o.summary || '';
      if (sub) {
        slide.addText(String(sub).slice(0, 120), {
          x: 0.8, y: 2.86, w: 8.4, h: 0.5, fontSize: 14, color: 'E0E7FF', fontFace: FONT, fit: 'shrink',
        });
      }
      if (o.goal) {
        slide.addText('学习目标：' + String(o.goal).slice(0, 90), {
          x: 0.8, y: 3.55, w: 8.4, h: 0.4, fontSize: 12, color: 'C7D2FE', fontFace: FONT, fit: 'shrink',
        });
      }
      slide.addText('灵犀课堂 · AI 一对一直播课', {
        x: 0.8, y: 4.55, w: 8.4, h: 0.4, fontSize: 12, color: 'C7D2FE', fontFace: FONT,
      });
      // 封面之后插入"本课安排"，让老师先看到整节课怎么走
      if (i === 0 && stageList.length) {
        const ag = pptx.addSlide();
        ag.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: PRIMARY } });
        ag.addText('本课安排', {
          x: 0.7, y: 0.5, w: 7.6, h: 0.8, fontSize: 26, bold: true, color: INK, fontFace: FONT,
        });
        ag.addShape(pptx.ShapeType.rect, { x: 0.72, y: 1.32, w: 1.1, h: 0.05, fill: { color: PRIMARY2 } });
        const rows = stageList.slice(0, 6).map((st) => ({
          text: st.name + (st.duration ? '（' + st.duration + '）' : '') +
            (st.content ? '：' + String(st.content).slice(0, 70) : ''),
          options: {
            bullet: { code: '25CF' }, color: INK, fontSize: 14, breakLine: true, paraSpaceAfter: 10,
          },
        }));
        ag.addText(rows, {
          x: 0.85, y: 1.75, w: 8.3, h: 3.1, fontFace: FONT, valign: 'top',
          lineSpacingMultiple: 1.3, fit: 'shrink',
        });
        addFooter(ag, 2, totalPages);
      }
      // 知识点页
      if (i === 0 && kpList.length) {
        const kp = pptx.addSlide();
        kp.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: PRIMARY } });
        kp.addText('本课知识点', {
          x: 0.7, y: 0.5, w: 7.6, h: 0.8, fontSize: 26, bold: true, color: INK, fontFace: FONT,
        });
        kp.addShape(pptx.ShapeType.rect, { x: 0.72, y: 1.32, w: 1.1, h: 0.05, fill: { color: PRIMARY2 } });
        kp.addText(kpList.slice(0, 8).map((k, n) => ({
          text: String(k),
          options: { bullet: { code: '25CF' }, color: INK, fontSize: 16, breakLine: true, paraSpaceAfter: 12 },
        })), {
          x: 0.85, y: 1.8, w: 8.3, h: 3.0, fontFace: FONT, valign: 'top',
          lineSpacingMultiple: 1.35, fit: 'shrink',
        });
        addFooter(kp, 3 - (stageList.length ? 0 : 1), totalPages);
      }
    } else if (isQuiz) {
      // 顶部橙色标题条（练习页与内容页区分开）
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: 'F59E0B' } });
      slide.addText('✎ ' + (s.title || '随堂练习'), {
        x: 0.7, y: 0.5, w: 7.6, h: 0.8, fontSize: 24, bold: true, color: INK, fontFace: FONT,
      });
      slide.addShape(pptx.ShapeType.rect, { x: 0.72, y: 1.32, w: 1.1, h: 0.05, fill: { color: 'F59E0B' } });
      // 题干
      if (s.question) {
        slide.addText(String(s.question), {
          x: 0.75, y: 1.6, w: 8.5, h: 0.9, fontSize: 17, bold: true, color: '2A2F45',
          fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.25, fit: 'shrink',
        });
      }
      // 选项
      const opts = s.options || [];
      if (opts.length) {
        const objs = opts.map((o) => {
          const letter = String(o).trim().charAt(0).toUpperCase();
          const right = s.answer && letter === String(s.answer).trim().toUpperCase();
          return {
            text: String(o),
            options: {
              color: right ? '16A34A' : INK, bold: !!right, fontSize: 15,
              breakLine: true, paraSpaceAfter: 8, bullet: false,
            },
          };
        });
        slide.addText(objs, {
          x: 0.95, y: 2.62, w: 8.3, h: 1.9, fontFace: FONT, valign: 'top',
          lineSpacingMultiple: 1.25, fit: 'shrink',
        });
      }
      // 答案与解析（放右下角浅色块）
      if (s.answer || s.analysis) {
        const lines = [];
        if (s.answer) lines.push({ text: '正确答案：' + s.answer, options: { color: '16A34A', bold: true, fontSize: 13, breakLine: true, paraSpaceAfter: 4 } });
        if (s.analysis) lines.push({ text: s.analysis, options: { color: MUTED, fontSize: 12, breakLine: true } });
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 0.75, y: 4.5, w: 8.5, h: s.analysis ? 0.95 : 0.5, fill: { color: 'F5F7FF' },
          line: { color: 'E2E6F7', width: 0.5 }, rectRadius: 0.06,
        });
        slide.addText(lines, {
          x: 0.92, y: 4.6, w: 8.2, h: s.analysis ? 0.78 : 0.34,
          fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.2, fit: 'shrink',
        });
      }
      if (s.note) slide.addNotes(s.note);
      addFooter(slide, i + 1 + extraCount, totalPages);
    } else if (isSummary) {
      /* 小结页单独给一套视觉（原来和内容页长得一样，翻到最后分不清"结束了"）：
         浅色底 + 居中标题 + 要点分条，翻到就知道这节课收尾了 */
      slide.background = { color: 'F7F8FF' };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: PRIMARY } });
      slide.addText(s.title || '课堂小结', {
        x: 0.7, y: 0.55, w: 8.6, h: 0.8, fontSize: 26, bold: true, color: PRIMARY, fontFace: FONT,
      });
      slide.addShape(pptx.ShapeType.rect, { x: 0.72, y: 1.36, w: 1.1, h: 0.05, fill: { color: PRIMARY2 } });
      const sum = (s.bullets || []).map((b) => ({
        text: String(b), options: { bullet: { code: '2713' }, color: INK, fontSize: 16, breakLine: true, paraSpaceAfter: 12 },
      }));
      if (sum.length) {
        slide.addText(sum, {
          x: 0.95, y: 1.8, w: 8.2, h: 2.9, fontFace: FONT, valign: 'top',
          lineSpacingMultiple: 1.35, fit: 'shrink',
        });
      }
      if (s.note) slide.addNotes(s.note);
      addFooter(slide, i + 1 + extraCount, totalPages);
    } else {
      // 顶部标题条
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: PRIMARY } });
      slide.addText(s.title || '', {
        x: 0.7, y: 0.5, w: 7.6, h: 0.8, fontSize: 26, bold: true, color: INK, fontFace: FONT,
      });
      if (s.subtitle) {
        slide.addText(s.subtitle, {
          x: 7.0, y: 0.65, w: 2.3, h: 0.5, fontSize: 12, color: PRIMARY, fontFace: FONT, align: 'right',
        });
      }
      slide.addShape(pptx.ShapeType.rect, { x: 0.72, y: 1.32, w: 1.1, h: 0.05, fill: { color: PRIMARY2 } });

      const bullets = (s.bullets || []).map((b) => ({
        text: String(b),
        options: { bullet: { code: '25CF' }, color: INK, fontSize: 17, breakLine: true, paraSpaceAfter: 12 },
      }));
      /* 有示意图时：文字缩到左侧、图放右侧（16:9 的 powerpoint 单位是英寸，页面 10×5.63）。
         用 base64 SVG 作为图片插入 —— PptxGenJS 3.x 支持 image/svg+xml。 */
      if (s.figure) {
        if (bullets.length) {
          slide.addText(bullets, {
            x: 0.85, y: 1.75, w: 4.1, h: 3.1, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.3,
            fontSize: 14,
          });
        }
        try {
          const svg = figureSVG(s.figure, isIntl ? 'ocean' : 'indigo');
          if (svg) {
            // 优先转 PNG（兼容性最好）；转不出来退回 SVG data URI（补上 data: 前缀）
            const png = await svgToPngDataURL(svg, 900, 450);
            const data = png || svgDataURI(svg);
            if (data) {
              slide.addImage({ data: data, x: 5.1, y: 1.7, w: 4.3, h: 2.15 });
              if (!png) figureFallback++;
            } else {
              figureFailed++;
            }
          }
        } catch (_) { figureFailed++; }
      } else if (bullets.length) {
        slide.addText(bullets, {
          x: 0.85, y: 1.75, w: 8.3, h: 3.1, fontFace: FONT, valign: 'top',
          lineSpacingMultiple: 1.3, fit: 'shrink',
        });
      }
      // 讲稿备注（PPT 演讲者备注）
      if (s.note) slide.addNotes(s.note);
      addFooter(slide, i + 1 + extraCount, totalPages);
    }
  }

  /* 作业页（course.outline.homework）—— 原来完全没导出，老师布置作业还得自己找 */
  if (o.homework) {
    const hw = pptx.addSlide();
    hw.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: 'F59E0B' } });
    hw.addText('课后作业', {
      x: 0.7, y: 0.5, w: 7.6, h: 0.8, fontSize: 26, bold: true, color: INK, fontFace: FONT,
    });
    hw.addShape(pptx.ShapeType.rect, { x: 0.72, y: 1.32, w: 1.1, h: 0.05, fill: { color: 'F59E0B' } });
    const hwText = Array.isArray(o.homework) ? o.homework.map((x) => String(x)) : [String(o.homework)];
    hw.addText(hwText.map((t) => ({
      text: t, options: { bullet: { code: '25CF' }, color: INK, fontSize: 16, breakLine: true, paraSpaceAfter: 12 },
    })), {
      x: 0.9, y: 1.8, w: 8.3, h: 2.9, fontFace: FONT, valign: 'top',
      lineSpacingMultiple: 1.35, fit: 'shrink',
    });
    addFooter(hw, totalPages, totalPages);
  }

  const safeName = String(course.title || '课件').replace(/[\\/:*?"<>|]/g, '_');
  /* ★ 2026-09-24 修：原来只在完成后才 toast —— 而生成 10 页课件有可感知耗时，
     用户点完看到"页面毫无变化"，会以为按钮没生效（实测反馈）。
     现在先给"正在进行"的反馈，完成/失败再各给一次；禁用触发按钮防重复点击。
     btn 由调用方传入 —— 导出有两个入口（预览弹窗 / 课程卡片），不能硬编码 id。 */
  toast('正在生成 PPT（' + slides.length + ' 页），请稍候…', 'ok');
  const restore = (b) => {
    if (!b) return;
    b.disabled = false;
    if (b.dataset.origText) b.textContent = b.dataset.origText;
  };
  if (btn && !btn.disabled) {
    btn.dataset.origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在导出…';
    setTimeout(() => restore(btn), 6000);      // 兜底：无论成败都恢复可点
  }
  pptx.writeFile({ fileName: safeName + '.pptx' })
    .then(() => {
      // 图没能插进去时要如实说，不能让用户以为课件的图都在
      if (figureFailed > 0) {
        toast('PPT 已下载，但有 ' + figureFailed + ' 张示意图没能插进去（其余内容正常）', 'err');
      } else if (figureFallback > 0) {
        toast('PPT 已开始下载（' + figureFallback + ' 张图以矢量方式插入，个别老版 Office 可能不显示）', 'ok');
      } else {
        toast('PPT 已开始下载', 'ok');
      }
    })
    .catch((e) => { console.error(e); toast('PPT 导出失败：' + (e.message || '未知错误'), 'err'); });
}

/* 统一写本地课程列表。
   ★ 2026-09-24 修：原来各处的写法是 `try { setItem } catch(_) {}` —— 存储满时**静默失败**。
   实测（塞 6MB 数据）确实抛 QuotaExceededError 且界面零提示：
   未登录用户的课程只在本机，这等于"以为存好了，刷新就没了"。
   现在写入失败会（只）提示一次，并区分登录/未登录：未登录必须说清会丢。 */
let storageWarned = false;
/* ============================================================
   课程同步：待同步队列 + 冲突判定 + 删除不复活（外部审查 R02，P1）
   ------------------------------------------------------------
   原实现三个问题（都能复现）：
     ① 新课程 / 课堂检查点 / 下课保存**只写本地**；syncCourses() 只在登录与
        会话初始化时调用 —— 正常 saveCourse() 一次云端请求都不发。
     ② 同步时"先把本地全部覆盖到云端，再拉回来"，**没有任何版本判定**：
        旧设备上那份 20% 会把云端已经 90% 的进度覆盖成 20%。
     ③ 删除只删本地，下一次拉取云端会把课程**复活**。

   改法：
     · 每门课带 `updatedAt` —— **本地修改时刻**，不是上传时刻。
       （上传时重写时间戳再拿它当"较新"的证据，等于永远本地赢，那就白判了。）
     · 本地改动进"待同步队列"（按账号存），可重试；离线 / 失败都不丢。
     · 合并规则：**只有确实有未同步改动的本地副本才有资格盖掉云端**；
       其余情况比 `updatedAt`，新的赢；两边一样新时保持本地。
     · 删除记墓碑（tombstone），同步时真删云端；拉取时按墓碑时间决定是否复活。
     · 脏检测用"显式标脏 + id 集合差异"两手：
       显式标脏覆盖已知的修改点；id 集合差异兜住新增 / 删除 ——
       这样**将来新增的落盘路径也不会漏**（不依赖每个调用点都记得调 markCourseDirty）。
   ============================================================ */
const SYNC_QUEUE_BASE = 'lingxi_sync_queue';
function syncQueueKey(owner) { return SYNC_QUEUE_BASE + '::' + (owner || storageOwnerKey()); }
function loadSyncQueue() {
  let q = null;
  try { q = JSON.parse(localStorage.getItem(syncQueueKey()) || 'null'); } catch (_) { q = null; }
  if (!q || typeof q !== 'object') return { u: {}, d: {} };
  return {
    u: (q.u && typeof q.u === 'object' && !Array.isArray(q.u)) ? q.u : {},
    d: (q.d && typeof q.d === 'object' && !Array.isArray(q.d)) ? q.d : {},
  };
}
function saveSyncQueue(q) {
  try { localStorage.setItem(syncQueueKey(), JSON.stringify(q)); return true; } catch (_) { return false; }
}
function pendingSyncCount() {
  const q = loadSyncQueue();
  return Object.keys(q.u).length + Object.keys(q.d).length;
}

/* 上一轮落盘时的课程 id 集合，用来做差异检测（见文件头注释） */
let lastPersistedCourseIds = null;

/* 显式标脏：这门课的本地内容变了，盖上修改时刻并进队列 */
function markCourseDirty(course) {
  if (!course || !course.id) return;
  course.updatedAt = Date.now();
  course.syncState = 'pending';
  const q = loadSyncQueue();
  q.u[course.id] = course.updatedAt;
  delete q.d[course.id];                 // 又被改回来了 → 撤掉墓碑
  saveSyncQueue(q);
  scheduleSyncFlush();
  renderSyncStatus();
}

/* 标墓碑：这门课在本地被删了，云端也要删；同步前不能被拉取复活 */
function markCourseDeleted(id) {
  if (!id) return;
  const q = loadSyncQueue();
  delete q.u[id];
  q.d[id] = Date.now();
  saveSyncQueue(q);
  scheduleSyncFlush();
  renderSyncStatus();
}

/* 同步节流：本地连续改动（检查点每 30 秒一次）不该每次都打云端 */
let syncFlushTimer = null;
function scheduleSyncFlush() {
  if (!isSignedIn() || !state.cloud || !state.cloud.database) return;   // 离线/未登录：留在队列里
  if (syncFlushTimer) return;
  syncFlushTimer = setTimeout(() => {
    syncFlushTimer = null;
    syncCourses().catch(() => {});
  }, 1500);
}

/* 同步状态行：让"有没有存进去"这件事在界面上看得见，
   而不是只靠一个 toast 然后什么都不知道（原报告的诉求之一） */
function renderSyncStatus() {
  const el = $('#sync-status');
  if (!el) return;
  const n = pendingSyncCount();
  if (!isSignedIn()) {
    el.hidden = true;                    // 未登录：走门禁，不显示同步状态（会误导）
    return;
  }
  el.hidden = false;
  el.classList.toggle('is-pending', n > 0);
  if (syncRunning) el.textContent = '正在同步…';
  else if (n > 0) el.textContent = '有 ' + n + ' 项改动待同步（会自动重试）';
  else el.textContent = '已同步到云端';
}
let syncRunning = false;

function persistCourses() {
  try {
    /* ★ R01：写进当前账号的命名空间 */
    localStorage.setItem(scopedContentKey(CONTENT_KEYS.courses), JSON.stringify(state.courses));
    /* ★ R02：落盘的同时做一次 id 集合差异检测 ——
       新增的课进待同步队列、消失的课记墓碑。
       放在这里而不是各个调用点，是为了"将来新增的落盘路径也不会漏"。 */
    try {
      const nowIds = new Set((Array.isArray(state.courses) ? state.courses : []).map((c) => c && c.id).filter(Boolean));
      if (lastPersistedCourseIds) {
        const q = loadSyncQueue();
        let changed = false;
        nowIds.forEach((id) => {
          if (!lastPersistedCourseIds.has(id)) {
            const c = (state.courses || []).find((x) => x && x.id === id);
            const at = (c && c.updatedAt) || Date.now();
            if (!q.u[id]) { q.u[id] = at; changed = true; }
          }
        });
        lastPersistedCourseIds.forEach((id) => {
          if (!nowIds.has(id) && !q.d[id]) { q.d[id] = Date.now(); changed = true; }
        });
        if (changed) { saveSyncQueue(q); scheduleSyncFlush(); renderSyncStatus(); }
      }
      lastPersistedCourseIds = nowIds;
    } catch (_) {}
    return true;
  } catch (_) {
    if (!storageWarned) {
      storageWarned = true;
      const loggedIn = !!(state.user && !state.user.anonymous);
      try { track('storage_full', { loggedIn: loggedIn }); } catch (_) {}
      try {
        toast(loggedIn
          ? '本机存储已满，本地缓存没能更新（云端记录不受影响）'
          : '本机存储已满，新内容可能保存不下来。登录后会自动存到云端，换设备也能看到。', 'err');
      } catch (_) {}
    }
    return false;
  }
}

function saveCourse(course, notify) {
  // 注意：这里必须是 state.courses（历史上有过引用未定义的 arr，会让"进入直播间"直接抛 ReferenceError）
  const idx = state.courses.findIndex((c) => c.id === course.id);
  course.saved = true;
  if (idx >= 0) state.courses[idx] = course; else state.courses.unshift(course);
  markCourseDirty(course);          // ★ R02：这是一次本地改动，进待同步队列
  persistCourses();
  if (notify) {
    toast('已保存到「我的课程」', 'ok');
    const b = $('#btn-save-only');
    if (b) { b.textContent = '已保存 ✓'; b.disabled = true; }
  }
}

function loadCourses() {
  try {
    /* ★ R01：按当前账号的命名空间读。读不到就是空 ——
       绝不回落到"上一个账号留下的那份"，那正是要修的串数据缺陷。 */
    state.courses = normalizeCourses(JSON.parse(readContentRaw(CONTENT_KEYS.courses, '[]') || '[]'));
  } catch (_) { state.courses = []; }
  /* ★ R02：记下基线 id 集合，作为后续 persistCourses 差异检测的参照。
     不重置的话，切账号后的第一次落盘会把"新账号的空列表"误判成一堆删除。 */
  try {
    lastPersistedCourseIds = new Set((state.courses || []).map((c) => c && c.id).filter(Boolean));
  } catch (_) { lastPersistedCourseIds = null; }
}

/* 课程同步（重写，外部审查 R02）
   顺序很关键：**先推本地未同步的改动（可重试）→ 再拉云端按时间戳合并**。
   反过来的话，本轮的本地改动会被拉回来的旧版本盖掉。
   返回 true 表示"推的部分全部成功"（拉取失败不算失败 —— 只影响看到的内容新旧）。 */
async function syncCourses() {
  if (!state.cloud || !state.cloud.database) return false;
  if (!state.user || state.user.anonymous) return false;
  if (syncRunning) return false;              // 同一时刻只跑一次，避免并发互相覆盖
  syncRunning = true;
  const db = state.cloud.database;
  let pushFailed = 0;
  try {
    /* ── ① 推：先把本地未同步的改动送上去 ── */
    const q = loadSyncQueue();
    const localById = {};
    (Array.isArray(state.courses) ? state.courses : []).forEach((c) => { if (c && c.id) localById[c.id] = c; });

    // 云端已有的行（RLS 保证只能拿到自己的）
    const existing = new Map();
    try {
      const { data: rows } = await db.from('courses').select('id, course_id').limit(1000);
      (rows || []).forEach((r) => { if (r && r.course_id) existing.set(r.course_id, r.id); });
    } catch (_) { /* 索引拿不到就先当"云端没有"处理，下面的插入会失败并留在队列里重试 */ }

    for (const id of Object.keys(q.u)) {
      const c = localById[id];
      if (!c) { delete q.u[id]; continue; }    // 本地已不存在 → 交给墓碑分支
      try {
        const rid = existing.get(id);
        if (rid) await db.from('courses').update({ data: c, updated_at: new Date().toISOString() }).eq('id', rid);
        else {
          await db.from('courses').insert({ course_id: id, data: c });
          existing.set(id, id);
        }
        delete q.u[id];
        c.syncState = 'synced';
      } catch (_) { pushFailed++; }            // 留在队列里，下次重试（离线不丢）
    }

    for (const id of Object.keys(q.d)) {
      try {
        const rid = existing.get(id);
        if (rid) await db.from('courses').delete().eq('id', rid);
        delete q.d[id];
      } catch (_) { pushFailed++; }
    }
    saveSyncQueue(q);

    /* ── ② 拉：按时间戳合并，本地"未同步的改动"优先，其次是较新的 ── */
    try {
      const { data: rows } = await db.from('courses').select('data').order('updated_at', { ascending: false }).limit(500);
      const cloud = (rows || []).map((r) => r && r.data).filter((d) => d && d.id);
      const q2 = loadSyncQueue();
      const map = {};
      (Array.isArray(state.courses) ? state.courses : []).forEach((c) => { if (c && c.id) map[c.id] = c; });
      cloud.forEach((cc) => {
        /* 墓碑：本地删过，且删除时间不早于云端这一版 → 不复活。
           （如果云端比删除还新，说明另一台设备删后又改了 —— 那种情况让云端赢。） */
        if (q2.d[cc.id] && Number(cc.updatedAt || 0) <= Number(q2.d[cc.id])) { delete map[cc.id]; return; }
        const loc = map[cc.id];
        if (loc && q2.u[cc.id]) return;        // 本地有未同步改动 → 本地赢（它更新且还没推上去）
        const ct = Number(cc.updatedAt || 0);
        const lt = loc ? Number(loc.updatedAt || 0) : -1;
        if (!loc || ct > lt) map[cc.id] = cc;  // 谁更新谁赢；一样新时保持本地
      });
      state.courses = normalizeCourses(Object.values(map));
      persistCourses();
      renderCourses();
    } catch (_) {}
  } finally {
    syncRunning = false;
    renderSyncStatus();
  }
  return pushFailed === 0;
}

function renderCourses() {
  const list = $('#course-list');
  const empty = $('#course-empty');
  const filterRow = $('#course-filter');
  // ★ R02：课程列表一刷新就顺手同步一次状态行（"已同步 / 有几项待同步"）
  try { renderSyncStatus(); } catch (_) {}
  // 访客提示：课程只在本机，讲清登录的价值（原来只有个"登录/注册"按钮，没说为什么）
  const guestHint = $('#courses-guest-hint');
  if (guestHint) guestHint.hidden = !!(state.user && !state.user.anonymous);
  // 兜底归一化：state.courses 也可能被别处（渲染前）改脏
  state.courses = normalizeCourses(state.courses);
  const all = state.courses;
  if (!all.length) {
    list.innerHTML = '';
    if (filterRow) filterRow.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  // 按体系筛选（仅在存在国际课程时显示筛选条）
  const hasIntl = all.some((c) => c.system === 'intl');
  const hasCn = all.some((c) => c.system !== 'intl');
  if (filterRow) {
    filterRow.hidden = !(hasIntl && hasCn);
    filterRow.innerHTML = [['all', '全部'], ['cn', '🇨🇳 国内课程'], ['intl', '🌐 国际课程']]
      .map(([k, label]) => `<button class="chip${(state.courseFilter || 'all') === k ? ' active' : ''}" data-filter="${k}">${label}</button>`)
      .join('');
  }
  const f = state.courseFilter || 'all';
  const rows = all.filter((c) => f === 'all' || (f === 'intl' ? c.system === 'intl' : c.system !== 'intl'));

  list.innerHTML = rows.map((c) => `
    <div class="course-item">
      <h3>${esc(c.title)}</h3>
      <div class="ci-meta">
        ${c.systemName ? `<span class="tag sys">${esc(c.systemIco || '')} ${esc(c.systemName)}</span>` : ''}
        ${c.genLang === 'en' ? '<span class="tag lang-en">🇬🇧 English 授课</span>' : ''}
        ${(c.boards || []).map((id) => {
          const b = getBoards(getSystem('intl')).find((x) => x.id === id);
          return b ? `<span class="tag board">${b.ico} ${esc(b.name)}</span>` : '';
        }).join('')}
        <span class="tag">${esc(c.subject)} · ${esc(c.grade)}</span>
        <span class="tag orange">${esc(c.level)}</span>
        <span class="ci-date">${fmtDate(c.createdAt)}</span>
      </div>
      <div class="ci-progress"><i style="width:${Math.round((c.progress || 0) * 100)}%"></i></div>
      <small style="color:var(--muted)">课程进度 ${Math.round((c.progress || 0) * 100)}%${(c.slides && c.slides.length) ? ' · 课件 ' + c.slides.length + ' 页' + (quizCountOf(c) ? '（含 ' + quizCountOf(c) + ' 道题）' : '') : ''}${(c.replay && c.replay.events && c.replay.events.length) ? ' · <span class="ci-replay-dot"></span>回放 ' + fmtTime(c.replay.duration) : ''}${c.avatarVideo ? ' · 🎬 数字人' : ''}</small>
      <div class="ci-foot">
        <button class="btn btn-primary btn-sm" data-enter="${esc(c.id)}">进入课堂</button>
        ${(c.replay && c.replay.events && c.replay.events.length)
          ? `<button class="btn btn-ghost btn-sm btn-replay" data-replay="${esc(c.id)}">⏺ 回放</button>` : ''}
        ${(c.slides && c.slides.length)
          ? `<button class="btn btn-ghost btn-sm" data-slides="${esc(c.id)}">📊 课件</button>
             <button class="btn btn-ghost btn-sm" data-ppt="${esc(c.id)}">导出 PPT</button>`
          : `<button class="btn btn-ghost btn-sm" data-mkslides="${esc(c.id)}">✨ 生成课件</button>`}
        <button class="ci-del" data-del="${esc(c.id)}">删除</button>
      </div>
    </div>`).join('');
}

/* ---------- 直播课堂 ---------- */

/* ===== 苏格拉底式教学引擎 =====
   参考 2025 年 AI 辅导（AI tutoring）教学法研究：
   - 苏格拉底四阶段：Elicitation 引出 → Probing 追问 → Contradiction/Extension 矛盾或延伸 → Synthesis 综合
   - 反「答案倾倒」：1-2 个针对性追问后才给一个小提示；两次尝试失败后才给示范解答
   - 元认知提示：先让学生说清"卡在哪一步、为什么"
   - 主动回忆与间隔重复：讲完知识点用小题复述检验，课后生成闪卡
   - 成长型思维：把错误归因为"策略还没找到"，而不是"你不会"
   - 可调支持等级：学生可随时要求"更多引导 / 让我自己试"                                     */

const GUIDE_PROFILES = {
  more: {
    name: '更多引导',
    tip: '多给提示与脚手架，拆小步子',
    rule:
      '学生当前选择了「更多引导」支持等级：\n' +
      '     · 把每个知识点再拆成 2-3 个小步子，每步都先确认学生跟上再继续。\n' +
      '     · 追问不超过 1 轮；学生一旦显露出困难，立刻给出一个明确的小提示或类比。\n' +
      '     · 多用"我们一起来看""我陪你走一遍"这类陪伴式措辞，降低学生的畏难感。',
  },
  balanced: {
    name: '均衡',
    tip: '先追问、再给提示的默认节奏',
    rule:
      '学生当前使用默认的「均衡」引导节奏：\n' +
      '     · 每个知识点先用 1-2 个追问把学生的思路掏出来，再决定给提示还是推进。\n' +
      '     · 提示与放手交替：一次由你示范，下一次让学生自己说思路。',
  },
  less: {
    name: '更多自主',
    tip: '让学生先自己想，只在卡死时出手',
    rule:
      '学生当前选择了「更多自主」支持等级：\n' +
      '     · 先让学生自己完整说一遍思路与答案，**不要抢先提示**。\n' +
      '     · 只在学生明确说"我不会"或连续两次尝试都卡住时才介入，且只给方向不给结论。\n' +
      '     · 学生答对后不要只夸结果，追问"如果条件反过来，结论还成立吗"来拓展迁移。',
  },
};

/* 讲解长度可以调，但"提问密度"必须保持：这是苏格拉底式辅导的关键 */
const META_RULE =
  '元认知提问（必须贯穿全程，不要省略）：\n' +
  '     · 学生答错或说不会时，先问"你能指一下自己卡在哪一步吗？是概念没懂，还是步骤不会用？"再给帮助。\n' +
  '     · 每讲完一个较难的知识点，问一句"这一块如果让你讲给别人听，你会怎么说？"来检验真正的理解。\n' +
  '     · 学生答对时，追问"你为什么选这个思路？当时是怎么想到的？"，把正确直觉变成可复用的方法。';

/* 像真人说话 —— "AI 味"最集中的地方。
   必须写成**可执行的禁令**，而不是"要口语化"这种空话：
   模型默认产出书面报告腔（列表、加粗、编号、套话开头），
   而这些格式标记被 TTS 念出来尤其假（读成"横杠""星号"、句子断得很怪）。 */
const REAL_TALK_RULE =
  '【说话方式：像一个坐在旁边的真人老师，不是在念讲稿】\n' +
  '  · 句子要短：一句基本 20 字以内，一回合 2~4 句。宁可多聊几轮，不要一口气讲一大段。\n' +
  '  · 用口语词："咱们""你看""来""也就是说""对吧""这样啊"。不要用书面连接词' +
  '（"首先""其次""最后""综上所述""需要注意的是""值得一提的是"）。\n' +
  '  · **绝对不要用任何格式标记**：不用 - 或 1. 2. 3. 做列表，不用 **加粗**，不用 # 标题，不要排版换行。\n' +
  '    你现在是用嘴说，不是写文档 —— 列表和加粗念出来是"横杠""星号"，一听就假。\n' +
  '  · 不要念课件。课件在学生屏幕上，用你自己的话讲（"你看这一页上面那个图……"），不要逐条念要点。\n' +
  '  · 数字和符号用口语读法：说"三分之一"不说 1/3；说"长乘宽"不说 长×宽；说"平方厘米"不说 cm²；说"百分之五十"不说 50%。\n' +
  '  · 自然的思考痕迹可以有，但一回合最多一处（"嗯……让我想想怎么说""哦对，这里得说清楚"）。\n' +
  '  · 学生说"没听懂""不会"时，先接住情绪再讲内容（"别急，这块确实容易绕"），不要立刻又抛新内容。\n' +
  '  · 用"你"，永远别说"该学生""学生应该"。\n' +
  '  · 一次只问一个问题；想连问几个时只留最关键的那个。\n' +
  '  · 允许偶尔自我修正："我换个说法""刚才那句有点绕"—— 真人会这样。\n' +
  '  · 禁止"我是 AI""作为你的老师""让我来帮你分析"这类自我指涉开场，直接说话。';

const SOCRATIC_RULE =
  '苏格拉底式提问（本课最重要的教学方式）：\n' +
  '        a) 引出：新知识点先别急着讲，用一个问题把学生已有的经验"勾"出来（"你觉得……会怎么样？你已经会哪些相关的？"）。\n' +
  '        b) 追问：针对学生回答里的**具体主张**追问，一次只问一个问题，问完停下来等他答。\n' +
  '        c) 矛盾或延伸：如果他的推理有问题，给一个反例或极端情形让他自己发现矛盾；如果是对的，就换一个更难的变式继续延伸。\n' +
  '        d) 综合：一个知识点收尾时，请学生用自己的话把结论复述一遍，你再补一句精炼总结。\n' +
  '     · 绝不做"答案倾倒"：连续 1-2 个追问之后才给**一个小提示**（不是答案）；\n' +
  '       只有当学生连续两次尝试都失败、或明确说"直接告诉我吧"，才给出完整示范解答（worked example），\n' +
  '       并且示范完立刻让他用同类题自己做一遍。';

function guideProfile() {
  return GUIDE_PROFILES[state.guide] || GUIDE_PROFILES.balanced;
}

/* 课程大纲/课件的 system 提示词
   2026-09-24 从 generateCourse 里抽出：这段 3400 多字的提示词原来内联在一个 200 行的
   async 函数内部，是个局部变量 —— **既没法单测，也不好维护**（改提示词要在大函数里翻）。
   抽成独立函数后与 teacherSystemPrompt 对称，可直接构造出来做断言。 */
/* ============================================================
   课件质量校验（2026-09-25）
   为什么要有它：一门课"能不能上"和"课件好不好用"是两件事。
   这段时间修的几类问题（课件没图、配了装饰图、要点挤成一坨、练习没解析）
   都属于**质量**而非**功能**——功能测试全绿，但拿到的课件还是不好用。
   所以把课件的质量要求写成**可判定的规则**，在三个时机各跑一次：
     · 生成之后（存进 course._quality，便于自检与导出提示）
     · 导出 PPT 之前（不阻断导出，但如实告知缺什么）
     · 内置自检里（作为一个检查项）
   ★ 判定原则：只检查**能确定**的东西（结构、字段、数量、长度），
     不做"这段文字算不算好例子"这种主观判断 —— 那种事交给提示词，不交给校验器。
   ============================================================ */
/* 例子信号（判据必须覆盖**不同学科的例子的形态**）
   ★ 实测教训：第一版只认"数字 / 情境词"，结果一门语文课被判"4 个内容页全都没有例子"，
     而它的每一页都有具体例句：
       「句子：晚霞像打翻的颜料盘」「本体：被比的景物（晚霞）」「坑一：同类比较（像爸爸）」
     —— 数理化靠数字与量，语言类学科靠引文、例句、篇名，计算机靠操作步骤。
     判据太窄 → 误报 → 我会去改本来没问题的生成逻辑，比漏报更伤。
     所以这里把各学科的"例子形态"都列进来。 */
const CW_EXAMPLE_HINTS = new RegExp([
  '比如|例如|举个例子|举例|比方|好比|假设|假如|如果|设想|试想|想象|如同|好像|像',
  '小明|小红|同学|老师|爸爸|妈妈|朋友',
  '一块|两块|一个|两个|三个|几个|第[一二三四五]',
  '\\d|元|米|千克|分钟|厘米|平方|摄氏度|块|张|杯|本|次|遍|人|份',
  '\\u201c|\\u201d|\\u300a|\\u300b|"',                 // 中文引号 / 书名号 / 英文引号（引文与篇名）
  '\\uff08[^\\uff09]{2,}\\uff09',                      // 括号里的具体例子：（像爸爸）（晚霞）
  '折出|涂|画|数一数|口算|计算|测量|观察|列举|写出|读出|操作|试做|演示|判断|选出',
].join('|'));

function validateCourseware(course) {
  const c = course || {};
  const slides = Array.isArray(c.slides) ? c.slides.filter(Boolean) : [];
  const issues = [];
  const bad = (id, label, detail, fix) => issues.push({ id: id, level: 'error', label: label, detail: detail, fix: fix || '' });
  const warn = (id, label, detail, fix) => issues.push({ id: id, level: 'warn', label: label, detail: detail, fix: fix || '' });

  if (!slides.length) {
    bad('empty', '课间内容', '这门课没有任何课件页', '重新生成课程');
    return { ok: false, score: 0, issues: issues, stats: { pages: 0 } };
  }

  const isQuiz = (s) => s.type === 'quiz';
  const isCover = (s, i) => s.type === 'cover' || s.cover === true ||
    ((s.bullets || []).length === 0 && i === 0 && !isQuiz(s));
  const body = slides.filter((s, i) => !isCover(s, i) && s.type !== 'summary');
  const contents = body.filter((s) => !isQuiz(s));
  const quizzes = body.filter(isQuiz);
  const bullets = (s) => (Array.isArray(s.bullets) ? s.bullets.filter((x) => String(x || '').trim()) : []);

  const stats = {
    pages: slides.length,
    contents: contents.length,
    quizzes: quizzes.length,
    figures: slides.filter((s) => s.figure).length,
    notes: slides.filter((s) => String(s.note || '').trim()).length,
    examplePages: contents.filter((s) => CW_EXAMPLE_HINTS.test(bullets(s).join(' '))).length,
  };

  /* ① 结构完整：课件要能支撑一节完整课 */
  if (!slides.some((s, i) => isCover(s, i))) warn('no-cover', '封面', '没有封面页', '一般由生成流程自动补齐');
  if (contents.length < 3) {
    bad('few-contents', '内容页太少', '只有 ' + contents.length + ' 页内容页（建议 ≥3）', '重新生成，或换更具体的学习目标');
  }
  if (!quizzes.length) {
    bad('no-quiz', '没有练习', '整份课件没有一道随堂练习 —— 没有练习就没有检验', '重新生成课程');
  }
  if (!slides.some((s) => s.type === 'summary')) warn('no-summary', '小结', '没有课堂小结页', '可在课程小结弹窗里查看，课件里补一个更好');

  /* ② 讲稿备注：PPT 是给老师用的，没有备注就只剩标题可念。
     ⚠ 封面页不算 —— 封面本来就不需要讲稿。第一版把封面也算进去，
     于是每门课都稳定挂着一条"2/10 页没有备注"的建议；**假建议会淹没真问题**，
     这种永远存在的提示最终会被人忽略。 */
  const needNote = slides.filter((s, i) => !isCover(s, i));
  const hasNote = needNote.filter((s) => String(s.note || '').trim()).length;
  stats.notes = slides.filter((s) => String(s.note || '').trim()).length;
  stats.noteCoverage = needNote.length ? hasNote + '/' + needNote.length : '—';
  if (needNote.length && hasNote < needNote.length) {
    warn('few-notes', '讲稿备注', (needNote.length - hasNote) + '/' + needNote.length + ' 页（不含封面）没有讲稿备注',
      '备注不影响学生看课件，但老师照着讲会更有把握');
  }

  /* ③ 例子：没有具体情境的课件就是"知识点的目录"
     —— 这里只判"有没有具体的东西"（数字/情境词/操作动词），不判例子好不好 */
  if (contents.length && stats.examplePages === 0) {
    bad('no-example', '没有例子', '所有内容页都没有具体情境或数字，全是大概念',
      '在生成页把学习目标写具体（例如"用一个蛋糕讲清 1/4"），再重新生成');
  } else if (contents.length >= 3 && stats.examplePages < Math.ceil(contents.length / 2)) {
    warn('few-example', '例子偏少', contents.length + ' 页内容里只有 ' + stats.examplePages + ' 页有具体例子',
      '建议把学习目标写得更具体，模型会更倾向给具体情境');
  }

  /* ④ 图示：分两种错 —— 该有图没有，以及不该有图硬配（之前修过的"凑数图"） */
  const figAllowed = figureAllowed(c.subject);
  if (figAllowed && !stats.figures) {
    bad('no-figure', '缺少图示', '「' + (c.subject || '该学科') + '」的图形本身就是知识载体，但这份课件一张图都没有',
      '重新生成试试；若仍未出图，把学习目标指向可用图形表达的内容（如"数轴""面积""受力分析"）');
  }
  if (!figAllowed && stats.figures > 0) {
    warn('extra-figure', '多余图示', '「' + (c.subject || '该学科') + '」属概念类学科，配了 ' + stats.figures +
      ' 张图（概念类学科的配图多为装饰）', '已知问题，生成流程已按学科控制，出现即说明规则未生效');
  }

  /* ⑤ 练习质量：光有题不够 —— 没有解析的题，学生错了也不知道为什么 */
  quizzes.forEach((q, i) => {
    const no = '第 ' + (i + 1) + ' 道练习';
    if (!String(q.question || '').trim()) bad('quiz-no-q', no + '缺题干', '没有题目内容', '重新生成课程');
    const opts = (Array.isArray(q.options) ? q.options : []).filter((o) => String(o || '').trim());
    if (opts.length && opts.length < 2) warn('quiz-few-opt', no + '选项太少', '只有 ' + opts.length + ' 个选项', '选择题建议 3~4 个选项');
    if (!String(q.answer || '').trim()) bad('quiz-no-ans', no + '缺答案', '没有给出正确答案', '重新生成课程');
    if (!String(q.analysis || '').trim()) {
      warn('quiz-no-analysis', no + '缺解析', '只有答案没有解析 —— 学生对了不知道为什么对、错了不知道为什么错',
        '解析是这道题最重要的部分，建议重新生成');
    }
  });

  /* ⑥ 单页密度：要点太多会挤成一坨（PPT 上一屏塞 9 条基本看不清） */
  const dense = slides.filter((s) => bullets(s).length > 8);
  if (dense.length) {
    warn('too-dense', '单页要点过多', dense.length + ' 页超过 8 条要点，投屏会显得很挤',
      '导出时已启用文本自适应（自动缩小），不影响使用');
  }
  /* ⑦ 空页：有页面但什么都没有 */
  const blank = slides.filter((s, i) => !isCover(s, i) &&
    !String(s.title || '').trim() && !bullets(s).length && !String(s.question || '').trim());
  if (blank.length) bad('blank', '空白页', blank.length + ' 页既没有标题也没有内容', '重新生成课程');

  const errs = issues.filter((x) => x.level === 'error').length;
  return {
    ok: errs === 0,
    score: Math.max(0, 100 - errs * 25 - (issues.length - errs) * 6),
    issues: issues,
    stats: stats,
  };
}

/* 导出前跑一次质量校验，把缺什么如实说给用户（不阻断导出 —— 用户可能就是要这份） */
function reportCoursewareQuality(course) {
  let r = null;
  try { r = validateCourseware(course); } catch (_) { return null; }
  try { if (course && typeof course === 'object') course._quality = r; } catch (_) {}
  if (r && r.ok && !r.issues.length) return r;              // 没问题就不打扰
  const errs = r.issues.filter((x) => x.level === 'error');
  if (errs.length) {
    toast('课件有 ' + errs.length + ' 处问题：' + errs.map((x) => x.label).join('、') + '（仍会正常导出）', 'err');
  } else if (r.issues.length) {
    toast('课件提示：' + r.issues.slice(0, 2).map((x) => x.label).join('、'), 'ok');
  }
  return r;
}

function courseSystemPrompt() {
  return '你是「灵犀课堂」的资深课程设计师，专为 AI 一对一直播课设计方案与课件，' +
    '既熟悉中国国家课程与中高考考纲，也熟悉 IB、A-Level、AP、IGCSE 等国际课程体系与标化考试。' +
    '只输出一个 JSON 对象，禁止输出 markdown 代码块或任何解释文字。JSON 结构：' +
    '{"title":"课程标题","summary":"一两句话说明这节课解决什么问题",' +
    '"knowledgePoints":["知识点1","知识点2","知识点3","知识点4"],' +
    '"stages":[{"name":"环节名","duration":"如 10 分钟","content":"具体教学安排，2-3句，含互动方式"}],' +
    '"slides":[' +
      '{"type":"cover","title":"课程标题","subtitle":"副标题"},' +
      '{"type":"content","title":"知识模块名","bullets":["要点1","要点2"],"note":"老师讲解词"' +
    // ★ 关键：JSON 结构示例里**也要**按学科去掉 figure 字段。
    //   只在下文规则里说"别配图"是没用的 —— 模型看到 schema 里有这个字段就会去填，
    //   这正是我前几版提示词（配额/默认不加图/分类映射）全都压不住的真实原因。
    (figureAllowed(genSubjectContext().subject)
      ? ',"figure":{"kind":"numberline","min":-5,"max":5,"marks":[{"at":-2,"label":"-2"}]}},' : '},') +
      '{"type":"quiz","title":"随堂练习","question":"题干（完整可作答）","options":["A. 选项一","B. 选项二","C. 选项三","D. 选项四"],"answer":"B","analysis":"解析，说明为什么选它、其他选项错在哪","note":"老师讲这道题的话"},' +
      '{"type":"summary","title":"课堂小结","bullets":["小结1","小结2"]}' +
    '],' +
    '"homework":["课后练习1","课后练习2"],"tips":"给这位学生的一两句学习建议"}。' +
    'stages 数量 3-5 个，知识要点 4-6 个。\n' +
    '【配套课件要求】共 7-10 页，必须包含以下三类页面：\n' +
    '① 第 1 页 type=cover（封面，用 title + subtitle）；\n' +
    '② 中间若干页 type=content（知识模块），每页 bullets 2-4 条、每条不超过 28 字（要精炼到可直接投影），' +
    /* ★ 2026-09-25 补：原来只要求"例子放 note"，而 note 是**演讲者备注**——
       导出 PPT 后它只给老师看，投影页上仍是抽象概括，学生复习时也看不到例子。
       实测反例：一门语文课的 4 个内容页全是大概念（"比喻让景物有画面感"），
       具体例句反而只躺在备注里。所以现在要求 bullets **本身**至少有具体的东西。 */
    '**这 2-4 条里至少有一条必须落在具体的东西上**（具体数字/量、引文例句、书名篇名、'
    + '带括号的具体对象、可执行的操作步骤），不能整页都是抽象概括 —— '
    + '学生复习课件时看的是这几条，例子藏在备注里等于没有。' +
    'note 写这一页老师要展开讲的话（2-3 句），**其中必须包含这一页要用的具体例子**；\n' +
    '③ **必须包含 2-3 页 type=quiz 的练习页**，分散在相关知识点之后（不要全堆在最后）。每页一道题：\n' +
    '   - question 是完整题干（数学要给出具体数字/式子，不能写"举例说明"这类空话）；\n' +
    '   - options 给 4 个选项（选择题），数组元素自带 "A. " 前缀；若是计算/推导题则 options 留空数组；\n' +
    '   - answer 填正确选项字母（如 "B"）或简要答案；\n' +
    '   - analysis 写解析：为什么选它、其他选项错在哪，2-3 句，要能让学生看懂；\n' +
    '   - 题目难度与该节课阶段匹配，第一道题偏基础，最后一道题可稍难。\n' +
    '④ 最后 1 页 type=summary（课堂小结）。\n' +
    /* ★ 2026-09-24 三次迭代才定下来这一段，过程记下来免得以后又改回去：
       ① 第一版：「至少 2 页要带图」的配额 → 实测两门 CS 课都硬配 5 张装饰图
          （数轴表示"循环次数"、函数图象表示"三步流程"）。**配额本身在鼓励凑数。**
       ② 第二版：「默认不加图」 → 矫枉过正，连数学课都一张不画了。
       ③ 现在这版：**按知识点类型做"分类 → 动作"的映射**，该配的必须配、不该配的明确禁止。
          关键是给模型一个可执行的判断动作，而不是给它一个倾向。 */
    (figureAllowed(genSubjectContext().subject) ?
      '【示意图 figure】按这一页的知识点属于哪一类，决定要不要配图（**不要写 SVG 代码**，只给结构化数据）：\n' +
    '   【必须配图】出现下面任一情况时，这一页就要加对应类型的图：\n' +
    '     · 几个量在比较（谁多谁少、谁快谁慢、不同方案/介质对照） → bars：' +
    '{"kind":"bars","title":"三种解法用时","items":[{"label":"甲","value":3},{"label":"乙","value":5}]}\n' +
    '     · 占比 / 几分之几 / 百分比 → pie：{"kind":"pie","title":"蛋糕的分配","slices":[{"label":"已分","value":3},{"label":"剩下","value":1}]}\n' +
    '     · 数轴上的位置、正负数、不等式解集、坐标 → numberline：' +
    '{"kind":"numberline","min":-5,"max":5,"marks":[{"at":-2,"label":"-2"},{"at":3,"label":"x"}]}\n' +
    '     · 两个量成对变化、要看趋势或函数关系（含实验数据） → function：' +
    '{"kind":"function","points":[[0,0],[1,2],[2,4]],"xLabel":"x","yLabel":"y"}\n' +
    '     · 面积 / 平均分 / 乘法分配律 / 比例模型 → rect：{"kind":"rect","w":4,"h":3,"labels":["4","3"]}\n' +
    '     · 就是几何图形本身（内角和、全等、相似） → triangle：{"kind":"triangle","labels":["A","B","C"]}\n' +
    '   【禁止配图】下面这些内容**一律不要写 figure 字段**（写了就是凑数）：\n' +
    '     概念定义、操作流程与步骤、变量与循环、语法与句型、史实与事件、性质与结论。\n' +
    '     实测反例（都错过）：用数轴表示"循环次数"、用函数图象表示"三步流程"、\n' +
    '     用面积模型表示"变量"、用三角形表示"声音传播" —— 学生会在图上找不到任何对应物。\n' +
    '   【两条硬校验】\n' +
    '     ① 图上的数字必须是**这一页知识点里真实出现的数字**，不能临时编一组数来画图；\n' +
    '     ② 自检：把这张图遮住，这一页的意思会不会变？**不会变，就说明它多余，删掉**。\n' +
    '   一节课 7-10 页里，通常是 2-4 页配图（数学/物理类）；像"变量""循环"这种纯概念课，\n' +
    '   可能一页都不需要 —— 把抽象概念讲清楚靠的是例子，不是图形。\n'
      : '') +
    '【举例子（这条决定课上得生不生动，务必写进 note）】每个知识模块都必须在 note 里写清'
    + '**这一个概念要用什么例子来讲**，而且是有画面的具体例子：\n'
    + '   · 禁止"小明买了 3 个苹果"这种空例子；要带具体数字/场景/后果。\n'
    +     '   · 学段尺度：' + exampleScaleHint(genSubjectContext()) + '。\n'
    + (subjectExampleHint(genSubjectContext()) ? '   · 这门学科好用的例子来源（可参考、也可自选更好的）：' + subjectExampleHint(genSubjectContext()) + '。\n' : '   · 例子要贴近这个学生的日常生活，别用他没见过的东西。\n')
    + '   · 各页之间的例子**不要重复**；同一个概念尽量用"他会有感觉"的那个场景。\n'
    + '   · 例子之后要接一句"折回定义"，把例子和概念挂上，别只讲故事。\n'
    + '所有内容与 stages 呼应，可直接当讲课 PPT 使用。';
}

function teacherSystemPrompt(course) {
  const o = course.outline;
  const isIntl = course.system === 'intl';
  let outlineText = '';
  if (o && Array.isArray(o.stages)) {
    outlineText = o.stages.map((s, i) => `${i + 1}. ${s.name}（${s.duration || ''}）：${s.content || ''}`).join('\n');
  } else if (course.rawOutline) {
    outlineText = course.rawOutline;
  }
  const boardLine = (course.boardNames && course.boardNames.length)
    ? '；对标考纲：' + course.boardNames.join('、') : '';
  const boardRules = (course.boards || []).map((id) => BOARD_GUIDE[id]).filter(Boolean);
  const slides = course.slides || [];
  const slideText = slides.length
    ? slides.map((s, i) => {
        const tag = s.type === 'quiz' ? '【练习页】' : (s.type === 'summary' ? '【小结页】' : (s.type === 'cover' ? '【封面】' : ''));
        let line = `第 ${i + 1} 页${tag}「${s.title}」`;
        if (s.type === 'quiz') {
          if (s.question) line += ' 题目：' + s.question;
          if (s.options && s.options.length) line += ' 选项：' + s.options.join(' / ');
          if (s.answer) line += ' 正确答案：' + s.answer;
          if (s.analysis) line += ' 解析：' + s.analysis;
        } else if (s.bullets && s.bullets.length) {
          line += ' 要点：' + s.bullets.join('；');
        }
        // 有示意图时必须让老师知道，否则它只会念要点、不会引导学生看图
        if (s.figure) line += ' 本页有一张「' + figureCaption(s.figure) + '」示意图，' +
          '讲解时要明确让学生看图（如"看这一页的图"），并指着图上的元素说。';
        if (s.note) line += ' 讲解：' + s.note;
        return line;
      }).join('\n')
    : '';
  const quizCount = slides.filter((s) => s.type === 'quiz').length;
  const guide = guideProfile();
  const memBlock = memoryPromptBlock();

  // 课前诊断：即使未登录（没有长期记忆），这次诊断的结果也必须让老师知道
  const dg = course.diag;
  let diagBlock = '';
  if (dg && (dg.focus.length || dg.skip.length)) {
    const seg = ['【课前诊断结果（这节课开课前学生刚做的）】'];
    if (dg.focus.length) seg.push('· 尚未掌握/需要确认：' + dg.focus.join('、') + ' —— 这些是本节课的重点。');
    if (dg.skip.length) {
      seg.push('· 已经掌握：' + dg.skip.join('、') +
        ' —— **不要再从零讲这些**，最多用一句"这个你已经会了，我们直接看下一块"带过，' +
        '把时间留给上面那些没掌握的。');
    }
    seg.push('· 诊断不等于定论：如果课上一问发现他其实会，就立刻往下走，不要照着诊断硬讲。');
    diagBlock = seg.join('\n') + '\n';
  }

  // 语言：用户显式选的授课语言优先；国际课程在未指定时保留"术语给英文原名"的既有行为
  const L = teachLangProfile();
  const langRule = L.id === 'en'
    ? ''
    : (isIntl
      ? '本课属于国际课程体系：讲解以简体中文为主、关键术语给出英文原名（如 "牛顿第二定律 Newton\'s second law"），' +
        '并按国际课堂习惯使用英文题干引述；学生要求全英授课时再切换为全英文。'
      : '');

  return '你是「灵犀课堂」的 AI 一对一老师，名叫"灵犀老师"，正在给学生上一节一对一直播课。' +
    L.prompt + '你既能辅导中国国家课程与中高考，' +
    '也能辅导 IB、A-Level、HKDSE、AP 等国际课程与标化考试。\n' +
    REAL_TALK_RULE + '\n' +
    (langRule ? langRule + '\n' : '') +
    '你的教学信条：**不是把知识讲给学生听，而是用问题把知识从学生心里"问"出来。**\n' +
    courseTypeTeachBlock(course) +
    '【课程信息】体系：' + (course.systemName || '国内课程') + boardLine + '；标题：' + course.title +
    '；科目：' + course.subject + '；阶段：' + course.grade +
    '；难度：' + course.level + '；时长：' + course.duration + '。\n' +
    (course.goal ? '【学生的学习目标】' + course.goal + '\n' : '') +
    diagBlock +
    (memBlock ? memBlock + MEMORY_USE_RULE + '\n' : '') +
    (outlineText ? '【课程大纲】\n' + outlineText + '\n' : '') +
    (slideText ? '【配套课件（正在投屏给学生看）】\n' + slideText + '\n' : '') +
    (isIntl && boardRules.length ? '【考纲要求】\n' + boardRules.join('\n') + '\n' : '') +
    '【教学规则】\n' +
    '1. 一次只讲一小段（不超过 120 字），讲完必须抛出一个问题让学生回应，' +
    '并且在学生回答之前**不要自问自答**。保持真正的一对一问答节奏。\n' +
    '2. 每次开始讲解新知识点前，先让学生用自己的话说一遍"你目前怎么理解它"或"你会从哪一步入手"，' +
    '再决定从哪里讲起——不要跳过这一步直接开讲。\n' +
    '3. 学生答错时**绝不要直接给正确答案**：先指出他思路里值得肯定的部分，' +
    '再用 1-2 个针对性追问帮他自己找到出错的那一步（"你这一步用到了哪个条件？那个条件在这里满足吗？"）。\n' +
    '4. 给帮助时遵循"最小帮助原则"：一次只给**一个小提示**（一个方向、一个类比、一个更简单的例子），' +
    '给完就停下等他再试一次；只有学生连续两次尝试都失败、或他明确说"直接告诉我吧"，' +
    '才给出完整示范解答，并且示范完立刻让他用一道同类题自己复现一遍。\n' +
    '5. 每讲完一个知识点，用**一道小题**检验理解（口头出题即可，不必等课件练习页），' +
    '要求学生不仅说答案、还要说理由。\n' +
    '6. 多鼓励但不空洞：表扬要指向具体的方法和努力（"你这个分类讨论的思路很稳""你能自己发现这个矛盾点，很棒"），' +
    '不要只说"你真聪明"。学生犯错时把它归因为"这一步的策略还没找到"，而不是"你不会"。\n' +
    '7. ★【举例子：这是让课堂"活起来"的关键，不是可选项】每讲到一个抽象概念、公式或规则，'
    + '**必须马上配一个具体例子**，而且要是学生能在脑子里"看见画面"的例子：\n'
    + '     · **不要用"小明买了 3 个苹果"这类没有画面的空例子** —— 那是走过场。'
    + '要带具体数字、具体场景、具体后果（"你每天刷短视频 40 分钟，一学期就是 60 小时"）。\n'
    + '     · 学段尺度：' + exampleScaleHint(course) + '。\n'
    + (subjectExampleHint(course) ? '     · 这门学科好用的例子来源：' + subjectExampleHint(course) + '。\n' : '')
    + '     · **讲完例子一定要"折回定义"**：用一句话把例子和概念挂上（"所以你看，这个过程其实就是…"），'
    + '否则学生只记住了热闹、没记住知识。\n'
    + '     · 同一节课里**不要重复用同一个例子**；讲第二个概念时换个场景。\n'
    + '     · 如果学生对你举的例子没反应（答非所问、敷衍），立刻换一个更贴近他的例子，别硬讲下去。\n'
    + '8. 可以适度"有趣"：反直觉的现象、一个小故事、一句类比都行，但**类比不能失真** ——'
    + '宁可用平实的例子，也不要为了生动把原理讲歪（学生记住错的结论，比没记住更糟）。\n'
    + '9. 可适量使用 1-2 个 emoji 增加亲和力，但不要每句都加，也不要用 emoji 代替讲清楚。\n'
    + '10. 只讨论与本次课程学习相关的内容；无关或敏感话题礼貌拉回课程。\n'
    + '11. 当前环节讲完时，明确说"我们进入下一环节"，并按大纲顺序推进。\n'
    + '12. 学生可以随时打断你插话提问，这是正常的一对一课堂节奏：'
    + '收到学生插话后要立刻停下当前讲解、认真回应他的问题，不要抱怨被打断；'
    + '答完之后自然地说一句"那我们接着刚才的往下讲"，把话接回被打断的位置，不要从头重讲。\n' +
    '【苏格拉底式提问】\n     ' + SOCRATIC_RULE + '\n' +
    (state.meta ? '【元认知脚手架】\n     ' + META_RULE + '\n' : '') +
    '【本轮引导强度】\n     ' + guide.rule + '\n' +
    (slideText ? '【课件配合】课件正投屏给学生：讲到某一页时，请自然地说"大家看这一页""我们翻到下一页"等，' +
      '讲解内容与当前页要点保持一致；不要念完整页文字，而是展开讲、边讲边问。\n' : '') +
    (quizCount > 0 ? '【练习页处理】课件里安排了 ' + quizCount + ' 页随堂练习。讲到练习页时要切换到出题模式：' +
      '先把题目完整读一遍，让学生自己思考并作答，**绝对不要立刻公布答案**；' +
      '学生作答后先让他说理由再点评：答对就肯定并追问"为什么"，' +
      '答错就按解析里的思路一步步引导他自己找到正确选项（可以给选项级的小提示，但不说出字母）。\n' : '') +
    (isIntl ? '【国际课程作答】涉及考题时，按上述考纲的题型与评分标准示范作答（如 mark scheme 给分点）。' +
      '涉及标化考试（雅思/托福/SAT）时，给出可操作的分数提升策略与时间分配建议。\n' : '') +
    '【错因诊断（每道错题必做，且必须说出来）】学生答错时，除了引导他自己找出错在哪，' +
    '还要在心里判断这属于哪一类，并用一句自然的话点明（不要用分类术语）：\n' +
    '     · 概念/公式本身没学会 → 说"我们把这个定义重新捋一遍"，然后回到最基础的地方重建。\n' +
    '     · 把相近的概念或适用条件弄混了 → 说"你是不是把它和 XX 记混了"，然后**放在一起对比**讲清区别。\n' +
    '     · 思路对、只是算错/写错 → 说"你的方法完全没问题，这一步算错了"，**不要重讲知识点**，' +
    '带他把这一步重新算一遍并教他一个验算方法。\n' +
    '     · 看漏/看错题目条件 → 说"我们一起把题目再读一遍"，让他逐条把条件划出来。\n' +
    '     关键：**"不会"和"会但错"要用完全不同的方式处理**，把算错当成不会来重讲会让学生非常受挫。\n' +
    '【红线】' + langRule;
}

async function enterLive(course) {
  switchView('live');
  try {
    await startLive(course);
  } catch (e) {
    console.error('进入直播间失败', e);
    toast('开课失败：' + (e && e.message ? e.message : '未知错误') + '，请刷新页面重试', 'err');
  }
}

async function startLive(course) {
  /* ★ 2026-09-29 加：进直播间同样要过登录校验（动作侧，不依赖遮罩）。 */
  if (!requireSignedIn()) return;
  if (!(await requireModel())) {
    switchView('courses');
    return;
  }
  // 手机号是要求项：进课堂前必须登记（浏览课程/回放不受限，见 ensurePhone 注释）
  if (!ensurePhone('进入课堂')) {
    switchView('courses');
    return;
  }
  // 若已有进行中的课堂且是同一节课，直接展示
  if (state.live && state.live.course.id === course.id && !state.live.ended) {
    $('#live-empty').hidden = true;
    $('#live-room').hidden = false;
    return;
  }
  endLiveSilent();
  track('class_start', { course: String(course.title || '').slice(0, 80), subject: String(course.subject || ''), grade: String(course.grade || '') });

  state.live = {
    course,
    conversationId: 'live-' + course.id + '-' + Date.now(),
    messages: [],
    busy: false,
    seconds: 0,
    stageIndex: 0,
    slideIndex: 0,
    sharing: true,
    muted: false,
    camOn: true,
    handUp: false,
    ended: false,
    peers: [],          // 受邀加入的其他同学
    recording: [],      // 回放录制：时间轴事件
    recStart: 0,
    gallery: false,
    pendingInterrupt: null,   // 打断上下文（老师讲到哪儿）
    interruptedSeg: false,    // 当前正在生成的段是否已被打断
    currentSegStart: null,    // 本段讲解的起始时间点
    curHidden: false,         // 本段是否由隐藏指令触发
    pendingCauses: [],        // 当前页面累积的错因诊断（翻页时落盘）
    causeSummary: [],         // 本节课诊断出过的错因（课后传给小结模型）
    controller: null,
    timerInt: null,
  };
  const live = state.live;

  $('#live-empty').hidden = true;
  $('#live-room').hidden = false;
  $('#live-title').textContent = course.title;
  const mn = $('#meet-no');
  if (mn) mn.textContent = meetNo(course);
  $('#chat-messages').innerHTML = '';
  setCaptions('课程即将开始…');
  setTeacherStatus('正在准备课程…');

  // ★ 先渲染参会者列表（会重建 #people-list 的 DOM），再重置控件外观，
  //   否则对 #p-me-mic 等元素的操作会被随后的重建覆盖
  renderPeople();
  updatePeerCount();
  renderAssistantLog();

  // 重置会议控件外观（全部加空值保护，避免任一元素缺失导致开课中断）
  const tbMic = $('#tb-mic');
  if (tbMic) {
    tbMic.classList.remove('off');
    const l = tbMic.querySelector('.mt-label');
    if (l) l.textContent = '语音提问';
  }
  // 学生侧没有麦克风上行，这里刻意不点亮"正在收音"，避免让学生以为老师在听自己说话
  const meMic = $('#p-me-mic');
  if (meMic) { meMic.classList.remove('on'); meMic.classList.add('off'); }
  const tbCam = $('#tb-cam');
  if (tbCam) {
    tbCam.classList.remove('off');
    const l = tbCam.querySelector('.mt-label');
    if (l) l.textContent = '隐藏画面';
    tbCam.title = '隐藏老师的画面（不影响你的摄像头）';
  }
  const tbShare = $('#tb-share');
  if (tbShare) tbShare.classList.add('active');
  const tbHand = $('#tb-hand');
  if (tbHand) tbHand.classList.remove('active');
  const board = $('#meet-board');
  if (board) board.hidden = true;
  const avatar = $('#teacher-avatar');
  if (avatar) avatar.classList.remove('speaking');
  const tbRec = $('#tb-rec');
  if (tbRec) tbRec.classList.remove('active');
  const tbGal = $('#tb-gallery');
  if (tbGal) {
    tbGal.classList.remove('active');
    const l = tbGal.querySelector('.mt-label');
    if (l) l.textContent = '宫格';
  }
  toggleGallery(false);
  switchSidePane('chat');
  renderGuideBtn();

  renderStageList(course);
  renderLiveSlide();

  // 回放初始化
  live.recStart = Date.now();
  live.recording = [];
  recordEvent('slide', live.slideIndex);
  recordEvent('start', 0);

  // 数字人：优先用本节课已生成的视频，否则用站点自带形象
  try {
    if (course.avatarVideo) applyAvatarVideo(course);
    else initAvatarVideo();
  } catch (e) { console.warn('数字人初始化跳过', e); }

  // 没有课件的旧课程：后台补生成，完成后自动上屏
  if (!(course.slides && course.slides.length)) {
    ensureSlides(course).then((slides) => {
      if (slides && state.live && state.live.course.id === course.id) {
        state.live.slideIndex = 0;
        renderLiveSlide();
        toast('课件已生成，正在共享', 'ok');
      }
    });
  }

  state.live.timerInt = setInterval(() => {
    state.live.seconds += 1;
    $('#live-timer').textContent = fmtTime(state.live.seconds);
  }, 1000);

  // 课堂中途定期落盘：误刷新/断网重连后还能看到进度与部分回放（原来只在"下课"时保存）
  startLiveCheckpoint();

  // 开场（对模型隐藏的指令，不在界面渲染）
  // 有长期记忆时，让老师先自然衔接上次，而不是从零开始
  // 语音就绪自检：默认开启朗读（讲课没声音等于产品失效），
  // 但若设备没有可用语音，必须当场说清楚，不能静默不出声
  ensureVoiceReady();

  /* 挂上"没听到声音？点这里自检"的入口（20 秒后才显示，用户确认听到过就永久隐藏）。
     为什么需要它：产品有一个自己看不见的盲区 —— 引擎报告"念完了"，
     但用户因系统音量/iPhone 静音开关/标签页静音而听不到，此时所有自动检测都不触发。 */
  armTTSCheckEntry();

  /* 2026-09-27 加的一次静默暖机（点击那一刻说一个 volume=0 的空串）。
     ⚠ **如实说明：这一条我没有验证出它有效。**
     我原本的假设是"Chrome 的用户激活窗口只有几秒，而开场白要等 AI 流式返回好几秒，
     等 speak() 真被调用时窗口已过期" —— 但后来意识到 speechSynthesis 用的是
     **sticky activation（一旦获得就长期有效）**，这个假设站不住；
     我构造的假引擎也没能证明暖机有解锁作用（暖机被接受，但延迟的朗读照样被拒）。
     所以它只是**一次成本极低的尝试**（一个空串），**不是已证实的修复**。
     真正被证实有效的是下面那层"点一下重试"。要不要保留由后续实测决定。 */
  try {
    if (TTS.supported && TTS.enabled) {
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      warm.lang = (TTS.voice && TTS.voice.lang) || teachLangProfile().utteranceLang;
      window.speechSynthesis.speak(warm);
    }
  } catch (_) {}

  const hasMem = !!memoryPromptBlock();
  sendLive(
    hasMem
      ? '（课程正式开始。你以前教过这个学生，档案见上方【关于这个学生的长期记忆】。' +
        '请先用一两句话自然衔接上次的学习（不要机械念档案、不要罗列），简短欢迎，' +
        '说明这节课的目标，然后从学生上次的薄弱点或进度接着往下讲。）'
      : '（课程正式开始。请灵犀老师简短开场：欢迎学生、用一两句话介绍这节课的目标，然后直接开始第一环节的讲解。）',
    { hidden: true }
  );

  // 引导：语音朗读需用户手势解锁
  if (TTS.supported && !TTS.enabled) {
    setTimeout(() => {
      if (state.live && !state.live.ended) {
        toast('小提示：点底部「语音」按钮，灵犀老师就能开口讲课啦', 'ok');
      }
    }, 2200);
  }
}

/* 会议号：由课程 id 派生的 9 位数字，形如 532 617 842 */
function meetNo(course) {
  let h = 0;
  const s = String(course.id || course.title || 'lingxi');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  const n = String(100000000 + (h % 900000000));
  return n.slice(0, 3) + ' ' + n.slice(3, 6) + ' ' + n.slice(6, 9);
}

function setCaptions(text) {
  const el = $('#teacher-status');
  if (!el) return;
  const t = String(text == null ? '' : text).trim();
  el.textContent = t.length > 120 ? t.slice(0, 118) + '…' : t;
  const cap = $('#meet-caption');
  if (cap) cap.style.display = t ? '' : 'none';
}
function setTeacherStatus(text) { setCaptions(text); }

/* 切换右侧面板 */
function switchSidePane(name) {
  $$('.side-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
  $$('.side-pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
}

/* ---------- 直播间课件放映（会议共享屏） ---------- */
function renderLiveSlide() {
  const live = state.live;
  const share = $('#tile-share');
  if (!share) return;
  const slides = (live && live.course.slides) || [];
  if (!slides.length) {
    share.hidden = true;
    return;
  }
  if (live.sharing === false) { share.hidden = true; return; }
  share.hidden = false;
  const i = Math.min(live.slideIndex, slides.length - 1);
  const stage = $('#live-slide-stage');
  if (stage) stage.innerHTML = slideHTML(slides[i], i, slides.length, slideTheme(live.course));
  const now = $('#live-slide-now');
  if (now) now.textContent = (i + 1) + ' / ' + slides.length;
}

function liveSlideGo(target) {
  const live = state.live;
  if (!live) return;
  const slides = live.course.slides || [];
  if (!slides.length) return;
  let next = typeof target === 'number' ? target : live.slideIndex + target;
  next = Math.max(0, Math.min(slides.length - 1, next));
  if (next === live.slideIndex) return;
  flushLiveCauses();            // 离开当前页：先行保存这一页累积的错因诊断
  live.slideIndex = next;
  renderLiveSlide();
  recordEvent('slide', next);
}

/* 把当前页面累积的错因诊断落成一条时间轴事件。
   挂在"翻页"上而不是"每段讲解"上：一页里老师可能来回讲好几轮，
   合并成一条更干净，也避免录制时间轴被刷屏。 */
function flushLiveCauses() {
  const live = state.live;
  if (!live || !live.recStart) return;
  const list = Array.isArray(live.pendingCauses) ? live.pendingCauses : [];
  if (!list.length) return;
  const slide = (live.course.slides || [])[live.slideIndex];
  recordEvent('cause', list.slice(0, ERROR_CAUSE_MAX), {
    slide: live.slideIndex,
    title: (slide && slide.title) || '',
  });
  live.pendingCauses = [];
}

/* 老师讲完一段后，若提到翻页/下一环节，自动跟进一页 */
function maybeAdvanceSlide(text) {
  const live = state.live;
  if (!live) return;
  const slides = live.course.slides || [];
  if (slides.length <= 1) return;
  const t = String(text || '');
  const wantsNext = /下一页|翻到下一|翻页|下一张|进入下一环节|看下一页|滑到下一/.test(t);
  const wantsPrev = /上一页|翻回去|回到上一页/.test(t);
  if (wantsNext) {
    setTimeout(() => liveSlideGo(1), 700);
  } else if (wantsPrev) {
    setTimeout(() => liveSlideGo(-1), 700);
  }
}

/* 错因诊断：老师每讲完一段，判断这段里有没有"诊断出学生为什么错"，
   顺手记到时间轴上，供课后生成错因报告。刻意做成"关键词启发式"：
   零额外网络开销、零额外 token，宁可漏记也不误记 —— 真正的结构化错因
   由课后小结模型统一判定（那道 prompt 能看到完整对话）。 */
const CAUSE_SIGNALS = [
  { cause: 'concept', re: /记混|弄混|混淆|区别在哪|把它和|区分|分不清|不是一回事/ },
  { cause: 'careless', re: /算错|算错了|计算错|抄错|笔误|粗心|马虎|符号写错|思路.{0,6}(对|没问题).{0,10}(错|错)/ },
  { cause: 'reading', re: /看漏|漏了条件|看错题|没看清|审题|读到哪|条件.{0,4}(划|圈)/ },
  { cause: 'knowledge', re: /没学过|没掌握|不懂|不会|重新捋|从最基础|这个定义|先把.{0,6}搞清楚/ },
];

function noteCauseSignals(text) {
  const live = state.live;
  if (!live || !live.recStart) return;
  const t = String(text || '');
  if (t.length < 8) return;
  CAUSE_SIGNALS.forEach((s) => {
    if (!s.re.test(t)) return;
    if (live.pendingCauses.indexOf(s.cause) >= 0) return;
    live.pendingCauses.push(s.cause);
  });
}

/* 为老课程补生成课件（同步生成，不阻塞直播） */
async function ensureSlides(course) {
  if (course.slides && course.slides.length) return course.slides;
  if (!state.model) return null;
  try {
    const sys = '你是课件设计师。根据给定课程大纲，输出配套 PPT 内容，只输出 JSON，禁止其他文字：' +
      langNote('每页标题、副标题、要点、题干、选项、解析、讲解词') +
      '{"slides":[' +
      '{"type":"cover","title":"课程标题","subtitle":"副标题"},' +
      '{"type":"content","title":"页标题","subtitle":"可选副标题","bullets":["要点1","要点2"],"note":"老师讲解词"},' +
      '{"type":"quiz","title":"随堂练习","question":"完整题干","options":["A. 选项一","B. 选项二","C. 选项三","D. 选项四"],"answer":"B","analysis":"解析：为什么选它、其他选项错在哪","note":"老师讲这道题的话"},' +
      '{"type":"summary","title":"课堂小结","bullets":["小结1","小结2"]}' +
      ']}。' +
      '共 7-9 页：第 1 页 type=cover（title 用课程标题，无 bullets）；' +
      '中间每页对应一个知识模块 type=content，bullets 2-4 条、每条不超过 28 字；' +
      '**必须安排 2 页 type=quiz 的练习页**（分散在知识点之间，第一道偏基础、第二道稍难，每题给 4 个选项、明确答案与解析）；' +
      '最后 1 页 type=summary 课堂小结。';
    const o = course.outline;
    const body = o ? JSON.stringify({
      title: o.title, summary: o.summary, kps: o.knowledgePoints, stages: o.stages, hw: o.homework,
    }) : (course.rawOutline || course.title);
    const raw = await streamChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: '课程信息：' + course.subject + ' / ' + course.grade + ' / ' +
          (course.systemName || '国内课程') + '\n大纲：' + body },
      ],
      temperature: 0.6,
      responseFormat: true,
    });
    const parsed = parseJSONLoose(raw);
    course.slides = normalizeSlides(parsed, course);
    const idx = state.courses.findIndex((c) => c.id === course.id);
    if (idx >= 0) { state.courses[idx] = course; saveCourse(course, false); }
    return course.slides;
  } catch (e) {
    console.error('补生成课件失败', e);
    return null;
  }
}

/* ============================================================
   课堂打断机制：学生随时插话，老师停下回应，答完接着讲
   ============================================================ */
async function interruptTeacher(askText) {
  const live = state.live;
  if (!live || !live.busy) return false;

  // 1) 立刻掐断正在进行的流式生成
  if (live.controller) { try { live.controller.abort(); } catch (_) {} }
  // 2) 立刻停止朗读，避免和后面的回答叠音
  stopSpeech();

  // 3) 记下"被打断时讲到哪儿了"，供答完后接续
  const last = lastTeacherBubbleText();
  // 存到 pendingInterrupt（独立字段），不会被上一轮的 finally 清掉
  live.pendingInterrupt = {
    spoken: clipText(last, 180),
    at: (Date.now() - live.recStart) / 1000,
    ask: askText,
  };
  live.interruptedSeg = true;
  track('interrupt_ask', {
    ask: String(askText || '').slice(0, 120),
    course: String((live.course && live.course.title) || '').slice(0, 80),
    at: Math.round((Date.now() - live.recStart) / 1000),
  });

  // 4) 等忙锁释放（abort 后 finally 会复位），最多 1.2 秒
  for (let i = 0; i < 24 && live.busy; i++) {
    await sleep(50);
  }
  // 5) 给被掐断的气泡盖上"已打断"标记
  markLastBubbleInterrupted();
  setCaptions('老师已停下，正在听你说…');
  toast('已打断老师，老师正在听你说', 'ok');
  return true;
}

/* 取最后一条老师气泡的纯文本 */
function lastTeacherBubbleText() {
  const wrap = $('#chat-messages');
  if (!wrap) return '';
  const ais = wrap.querySelectorAll('.msg.ai');
  if (!ais.length) return '';
  const el = ais[ais.length - 1].querySelector('.msg-bubble');
  return el ? el.textContent.replace(/（已打断）|（已停止生成）/g, '').trim() : '';
}

function markLastBubbleInterrupted() {
  const wrap = $('#chat-messages');
  if (!wrap) return;
  const ais = wrap.querySelectorAll('.msg.ai');
  if (!ais.length) return;
  const b = ais[ais.length - 1].querySelector('.msg-bubble');
  if (b && !b.querySelector('.sys-note')) {
    b.insertAdjacentHTML('beforeend', '<span class="sys-note">（学生插话，老师已停下）</span>');
  }
  ais[ais.length - 1].classList.add('interrupted');
}

function clipText(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* 把打断上下文转成给模型的追问提示 */
function interruptHint(ctx, askText) {
  if (!ctx) return '';
  const isPause = /^（学生(要求暂停|按了暂停)/.test(ctx.ask || '');
  if (isPause) {
    return '（刚才你正在讲课，讲到"' + ctx.spoken + '"的时候学生按了暂停。' +
      '请先简短确认"好的，我停一下"，然后等他继续；如果他接着问了问题就直接回答。' +
      '回答或确认完，记得把话接回被打断的地方继续讲，不要从头重讲。）';
  }
  return '（刚才你正在讲课，讲到"' + ctx.spoken + '"的时候被学生打断了，学生的问题是："' +
    askText + '"。请先回答学生的问题，回答完再自然地把话接回被打断的地方继续讲，' +
    '不要重头开始。如果学生的问题与本课无关，简单回应后也回到刚才的讲解。）';
}

function renderStageList(course) {
  const list = $('#stage-list');
  const o = course && course.outline;
  if (!o || !Array.isArray(o.stages) || !o.stages.length) {
    list.innerHTML = '<li class="current"><span class="sg-no">★</span>按 AI 生成方案灵活授课</li>';
    $('#board-tip').textContent = '本课程为自由形式，AI 老师将按生成方案授课';
    list.onclick = null;
    return;
  }
  list.innerHTML = o.stages.map((s, i) => `
    <li data-i="${i}" class="${i === 0 ? 'current' : ''}">
      <span class="sg-no">${i + 1}</span>
      <span class="sg-name">${esc(s.name)}</span>
      <span class="sg-dur">${esc(s.duration || '')}</span>
    </li>`).join('');
  list.onclick = (ev) => {
    const li = ev.target.closest('li[data-i]');
    if (!li || !state.live || state.live.busy) return;
    const i = Number(li.dataset.i);
    if (i === state.live.stageIndex) return;
    state.live.stageIndex = i;
    $$('#stage-list li').forEach((x, j) => {
      x.classList.toggle('current', j === i);
      x.classList.toggle('done', j < i);
    });
    const stage = course.outline.stages[i];
    sendLive('老师，我们看第 ' + (i + 1) + ' 环节吧：' + stage.name + '。');
  };
}

/* 对话窗口与"遗忘"补偿。
   ★ 2026-09-24 修：原来只保留最近 14 条可见消息（≈7 轮），
   而一节 45 分钟的课有 30~60 轮 —— 老师会忘掉 7 轮之前学生说过的**所有**话，
   包括"我卡在哪""我们老师说不考这个""我觉得分母是下面的数字"这类关键信息。
   做法：①窗口放宽到 30 条（≈15 轮）；②被挤出去的**学生发言**做规则化摘要
   （纯字符串处理，零额外 AI 调用），注入 system 让老师"别忘了"。
   为什么优先保留学生发言：学生的表达最能代表他理解到哪、卡在哪；
   老师自己说过的话，system 里的大纲/课件已经覆盖了大部分。 */
const LIVE_HISTORY_KEEP = 30;
const LIVE_DROPPED_KEEP = 12;

function droppedStudentNotes(dropped) {
  const asks = (dropped || []).filter((m) => m.role === 'user' && m.content && String(m.content).trim());
  if (!asks.length) return '';
  const lines = asks.slice(-LIVE_DROPPED_KEEP).map((m) => '· ' + clipText(String(m.content).replace(/\s+/g, ' ').trim(), 60));
  return '【本节更早聊过的内容（已滑出对话窗口，但请不要忘记）】\n' +
    '学生先前说过：\n' + lines.join('\n') + '\n' +
    '如果与他现在的说法冲突，先确认一下；不要重复问他已经回答过的事。\n';
}

function buildLiveMessages(ivCtx) {
  // 防御：没有进行中的课堂时直接返回空（调用方 sendLive 本就有守卫，
  // 但这是被导出的函数，测试与将来的调用方都可能直接调 —— 不要让它抛 TypeError）
  if (!state.live || !state.live.course) return [];
  const sys = teacherSystemPrompt(state.live.course);
  // 1) 取出可见历史（隐藏消息只是内部的"指令"，学生看不到，不入模型上下文）
  const visible = state.live.messages.filter((m) => !m.hidden);
  const dropped = visible.length > LIVE_HISTORY_KEEP ? visible.slice(0, visible.length - LIVE_HISTORY_KEEP) : [];
  let history = visible
    .slice(-LIVE_HISTORY_KEEP)
    .map((m) => ({ role: m.role, content: m.content }));
  // 把被挤出去的学生发言补进 system，避免"聊到一半像失忆了"
  const notes = droppedStudentNotes(dropped);
  const sysFull = notes ? sys + '\n' + notes : sys;

  // 2) 打断场景：把"你刚被打断，答完接着讲"的指令并入最后一条学生消息，
  //    避免出现连续两条 user 消息（部分模型对角色交替有严格要求）
  if (ivCtx && history.length) {
    const last = history[history.length - 1];
    const hint = interruptHint(ivCtx, last.content);
    if (last.role === 'user') last.content = last.content + '\n\n' + hint;
    else history.push({ role: 'user', content: hint });
  }

  // 3) ★ 强制修复角色交替：合并相邻同角色消息、并保证首条不是 assistant。
  //    任何历史写入异常（abort、隐藏消息被过滤等）都不该让整节课卡死，
  //    这里做一次兜底归一化，模型侧永远看到合法的 user/assistant 交替。
  const fixed = [];
  for (const m of history) {
    const prev = fixed[fixed.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = String(prev.content) + '\n' + String(m.content);
    } else if (!prev && m.role === 'assistant') {
      // 首条不能是 assistant，补一句学生消息把它接住
      fixed.push({ role: 'user', content: '（继续）' }, m);
    } else {
      fixed.push({ role: m.role, content: m.content });
    }
  }
  return [{ role: 'system', content: sysFull }, ...fixed];
}

function appendMessage(role, text, extraClass) {
  const wrap = $('#chat-messages');
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'me' : 'ai') + (extraClass ? ' ' + extraClass : '');
  if (role === 'user') {
    div.innerHTML = '<div class="msg-bubble">' + mdLite(text) + '</div>';
  } else {
    div.innerHTML = `
      <div class="msg-avatar">${teacherFaceSVG({ uid: 'm1' })}</div>
      <div class="msg-bubble">${mdLite(text)}</div>`;
  }
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function appendTyping() {
  const wrap = $('#chat-messages');
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.innerHTML = `
    <div class="msg-avatar">${teacherFaceSVG({ uid: 'm2' })}</div>
    <div class="msg-bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

/* 把"这段讲解被学生打断"这件事落进历史与界面。
   ★ 2026-09-29 新增（外部审查 R18）：原来这段逻辑只写在 `catch (AbortError)` 里，
     而用户点"打断"时 SDK 的取消有**两条落地路径** ——
       ① async generator 直接正常结束 → streamChat 正常 return；
       ② 抛出 AbortError。
     只有 ② 会走进那段逻辑；① 会被当成"老师正常讲完"，
     拿一个**空字符串**去覆盖气泡与历史（回放也不保存）。
     现在两条路径都调这一个函数，行为不可能再走散。
   另外：无论已生成多少内容都要补一条 assistant 轮次，
   否则连续插话会留下两条相邻的 user 消息、破坏角色交替。 */
function finishInterruptedSegment(bubbleDiv, bubbleEl, seg) {
  const live = state.live;
  if (!live) return;
  const text = String(seg || '');
  if (live.curHidden && !text) {
    // 被隐藏指令触发的段落不产生学生可见的气泡，但必须补占位保证 user/assistant 成对
    live.messages.push({ role: 'assistant', content: '（未及回答，学生已插话）' });
    try { if (bubbleDiv) bubbleDiv.remove(); } catch (_) {}
  } else if (text) {
    live.messages.push({ role: 'assistant', content: text + '\n（讲解被学生打断）' });
    if (bubbleEl) bubbleEl.innerHTML = mdLite(text) + '<span class="sys-note">（学生插话，老师已停下）</span>';
    try { addFixButton(bubbleDiv, text); } catch (_) {}
    try { if (bubbleDiv) bubbleDiv.classList.add('interrupted'); } catch (_) {}
  } else {
    live.messages.push({ role: 'assistant', content: '（老师刚开口就被打断了）' });
    if (bubbleEl) bubbleEl.innerHTML = '<span class="sys-note">已停下，老师正在听你说…</span>';
    try { if (bubbleDiv) bubbleDiv.classList.add('interrupted'); } catch (_) {}
  }
  live.interruptedSeg = false;
}

async function sendLive(text, opts = {}) {
  const live = state.live;
  if (!live || live.ended) return;
  if (!(await requireModel())) return;

  // ★ 打断机制：老师正在讲课时学生插话 → 立刻掐断当前生成，记下讲到哪儿
  let interrupted = false;
  if (live.busy) {
    interrupted = await interruptTeacher(text);
    if (!interrupted && live.busy) return;   // 掐断失败且仍在忙，放弃本次
  }
  // 取走打断上下文（存放在 pendingInterrupt，避免被上一轮 finally 清掉）
  const ivCtx = live.pendingInterrupt || null;
  live.pendingInterrupt = null;

  live.messages.push({ role: 'user', content: text, hidden: !!opts.hidden });
  if (!opts.hidden) {
    appendMessage('user', text);
    recordEvent('ask', text, { who: opts.asPeer || '你' });
    track('live_ask', { ask: String(text).slice(0, 120), quick: opts.quick === true ? 1 : 0 });
    const input = $('#chat-input');
    input.value = '';
    input.style.height = 'auto';
  }

  setLiveBusy(true);
  const bubbleDiv = appendTyping();
  const bubbleEl = bubbleDiv.querySelector('.msg-bubble');
  const controller = new AbortController();
  live.controller = controller;
  const lastRecT = (Date.now() - live.recStart) / 1000;   // 本段讲解的起始时间点
  live.currentSegStart = lastRecT;
  live.curHidden = !!opts.hidden;   // 记录本段是否由隐藏指令触发

  let full = '';
  let partial = '';    // ★ R18：onDelta 同步保存的部分文本 —— 万一 full 没拿到也能兜底
  let spokenLen = 0;   // 已送入朗读队列的字符数（保证不重不漏）
  try {
    const r = await streamChat({
      messages: buildLiveMessages(ivCtx),
      temperature: 0.8,
      conversationId: live.conversationId,
      signal: controller.signal,
      onDelta: (_d, acc) => {
        partial = String(acc);       // ★ R18：每来一段就同步存下"已经显示出来的内容"
        bubbleEl.innerHTML = mdLite(acc);
        const wrap = $('#chat-messages');
        wrap.scrollTop = wrap.scrollHeight;
        // 实时字幕：滚动显示老师正在讲的最后一段
        const segs = String(acc).split(/[\n。！？!?]/).filter((s) => s.trim());
        const tail = segs.length ? segs[segs.length - 1] : acc;
        if (tail && tail.trim()) setCaptions(tail.trim());
        // 语音朗读：把"已说完的整句"增量送给 TTS
        if (TTS.enabled) {
          const done = completeSentences(String(acc));
          if (done.length > spokenLen) {
            speak(done.slice(spokenLen));
            spokenLen = done.length;
          }
        }
      },
      // 纯推理模型先"想"后"写"：静默期给出明确反馈，避免被误判成 AI 不可用
      onReasoning: (_d, _thinking, acc) => {
        if (acc) return;
        bubbleEl.innerHTML = '<span class="teach-thinking">灵犀老师正在思考…</span>';
        const wrap = $('#chat-messages');
        wrap.scrollTop = wrap.scrollHeight;
        setCaptions('灵犀老师正在思考…');
      },
      onNotice: (msg) => { bubbleEl.innerHTML = '<span class="teach-thinking">' + esc(msg) + '</span>'; },
    });
    /* ★ R18：把"已经生成的部分"接住。streamChat 在两条取消路径上都返回 partial，
       这里再用 onDelta 存下的 partial 兜一层底（避免 SDK 在某条路径上给空）。 */
    full = String(r || partial || '');
    /* ★★ R18 的核心修法：被打断时 streamChat 是**正常返回**的（不是抛 AbortError），
       所以必须自己看 signal —— 否则"被打断"会被当成"正常讲完"，
       把刚显示出来的讲解用空内容覆盖掉，而且会继续做"讲完"才该做的事
       （记因果标记、自动翻页、收尾朗读）。 */
    if (controller.signal.aborted) {
      finishInterruptedSegment(bubbleDiv, bubbleEl, full);
      return;                       // finally 里仍会按 full 录制回放，这段讲解不会消失
    }
    live.messages.push({ role: 'assistant', content: full });
    bubbleEl.innerHTML = mdLite(full);
    addFixButton(bubbleDiv, full);
    noteCauseSignals(full);
    maybeAdvanceSlide(full);
    // 收尾：朗读剩余内容（含"最后一段没打标点的尾巴"，见 sentencesWithTail 注释）
    if (TTS.enabled) {
      const done = sentencesWithTail(String(full));
      if (done.length > spokenLen) speak(done.slice(spokenLen));
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      /* ★ R18：这条是"另半条"取消路径（SDK 抛 AbortError）。
         与上面正常返回那条走**同一个函数** —— 两条路径行为必须完全一致。
         `full || partial`：即使 streamChat 在这条路径上没来得及把文本带出来，
         也用 onDelta 存下的部分文本兜底，绝不让已经显示出来的讲解消失。 */
      full = full || partial;      // ★ R18：finally 里按 full 录制回放 —— 这条路径也要能录上
      finishInterruptedSegment(bubbleDiv, bubbleEl, full);
    } else {
      // 出错也要占位，否则同样会造成角色错位
      live.messages.push({ role: 'assistant', content: '（讲解中断：' + mapLLMError(e) + '）' });
      bubbleEl.innerHTML = '<span class="sys-note">' + esc(mapLLMError(e)) + errorRequestId(e) + '</span>';
      toast(mapLLMError(e), 'err');
    }
    stopSpeech();
  } finally {
    setLiveBusy(false);
    live.controller = null;
    live.currentSegStart = null;
    live.curHidden = false;
    // 讲完后字幕停留在最后一句，3 秒后回到待机提示
    if (full) {
      const segs = String(full).split(/[\n。！？!?]/).filter((s) => s.trim());
      if (segs.length) setCaptions(segs[segs.length - 1].trim());
      // 录制：按句记时间轴，回放可逐句还原讲解（含收尾那段没打标点的尾巴，与实际发声一致）
      const spoken = sentencesWithTail(full);
      const now = (Date.now() - live.recStart) / 1000;
      const span = Math.min(now - lastRecT, 24);   // 本段讲解占用的时间
      const each = spoken.length ? span / spoken.length : 0;
      spoken.forEach((s, i) => {
        live.recording.push({ t: Math.round((lastRecT + each * i) * 10) / 10, type: 'speak', v: s });
      });
      live.recording.sort((a, b) => a.t - b.t);
    }
    setTimeout(() => {
      if (state.live && !state.live.busy && !state.live.ended) setCaptions('等待你的提问');
    }, 3000);
  }
}

function setLiveBusy(busy) {
  const live = state.live;
  if (!live) return;
  live.busy = busy;

  // ★ 关键：老师讲课时不禁用输入，学生可以随时插话
  const input = $('#chat-input');
  if (input) {
    input.disabled = false;
    input.placeholder = busy
      ? '老师正在讲…（随时插话提问，Enter 发送即打断）'
      : '发送消息…（Enter 发送）';
    input.classList.toggle('can-interrupt', !!busy);
  }
  const send = $('#btn-send');
  if (send) {
    send.disabled = false;
    send.textContent = busy ? '打断提问' : '发送';
    send.classList.toggle('btn-interrupt', !!busy);
  }
  // 快捷提问在讲课时也保持可用（它们同样能打断）
  $$('#quick-row .quick-chip').forEach((b) => (b.disabled = false));
  $('#btn-stop').hidden = !busy;

  // 会议式状态：说话光环 + 语音波形 + 连接标识
  const av = $('#teacher-avatar');
  if (av) av.classList.toggle('speaking', busy);
  const wave = $('#voice-wave');
  if (wave) wave.classList.toggle('on', busy);
  const conn = $('#teacher-conn');
  if (conn) conn.textContent = busy ? '正在发言 · 可随时打断' : '连接良好';
  if (!busy) setCaptions('等待你的提问');
  const tmic = $('#teacher-mic');
  if (tmic) tmic.textContent = live.muted ? '🔇' : '🎙';
  // 老师在讲课时，闪烁提示"可打断"
  const hint = $('#interrupt-hint');
  if (hint) hint.hidden = !busy;
}

function endLiveSilent() {
  const live = state.live;
  if (!live) return;
  try { checkpointLive(); } catch (_) {}   // 结束前最后一存（后面下课路径还会全量覆盖一次）
  stopLiveCheckpoint();
  live.ended = true;
  if (live.controller) { try { live.controller.abort(); } catch (_) {} }
  if (live.timerInt) clearInterval(live.timerInt);
  stopSpeech();
  live.pendingInterrupt = null;
  live.interruptedSeg = false;
  live.curHidden = false;
  live.controller = null;
  state.live = null;
  // 复位输入区与打断提示
  const hint = $('#interrupt-hint');
  if (hint) hint.hidden = true;
  const input = $('#chat-input');
  if (input) {
    input.classList.remove('can-interrupt');
    input.placeholder = '发送消息…（Enter 发送）';
  }
  const send = $('#btn-send');
  if (send) {
    send.disabled = false;
    send.textContent = '发送';
    send.classList.remove('btn-interrupt');
  }
}

/* ============================================================
   下课二次确认
   为什么需要：顶栏「结束会议」和工具栏「结束」两个入口，误点一次就直接下课 ——
   而下课是不可逆的（会生成小结、结束回放录制、退出直播间），还附带一次 AI 调用。
   做成"同一个按钮 3 秒内再点一次"：比弹窗轻，又能挡住误触。
   ============================================================ */
let endConfirm = { btn: null, timer: 0 };
function confirmEndLive(btn) {
  const live = state.live;
  if (!live || live.ended) return;
  if (endConfirm.btn === btn) {           // 第二次点击 → 真的结束
    clearTimeout(endConfirm.timer);
    endConfirm.btn = null;
    btn.textContent = btn.dataset.origin || '结束';
    endLive();
    return;
  }
  if (endConfirm.btn) resetEndConfirm();
  endConfirm.btn = btn;
  if (!btn.dataset.origin) btn.dataset.origin = btn.textContent;
  btn.textContent = '再点一次确认';
  toast('再点一次就下课：会生成课堂小结并保存回放');
  endConfirm.timer = setTimeout(resetEndConfirm, 3000);
}
function resetEndConfirm() {
  clearTimeout(endConfirm.timer);
  if (endConfirm.btn) {
    endConfirm.btn.textContent = endConfirm.btn.dataset.origin || '结束';
    endConfirm.btn = null;
  }
}

async function endLive() {
  const live = state.live;
  if (!live) return;
  const course = live.course;
  const transcript = live.messages.filter((m) => !m.hidden).map((m) =>
    (m.role === 'user' ? '学生：' : '灵犀老师：') + m.content).join('\n');
  const seconds = live.seconds;
  // 收尾：把最后一页还没落盘的错因诊断补上；再算出会话期间诊断过的错因概览
  flushLiveCauses();
  const causeEvents = (live.recording || []).filter((e) => e && e.type === 'cause');
  const causeSeen = [];
  causeEvents.forEach((e) => {
    (Array.isArray(e.v) ? e.v : []).forEach((c) => {
      if (causeSeen.indexOf(c) < 0) causeSeen.push(c);
    });
  });
  live.causeSummary = causeSeen;
  const stageIndex = live.stageIndex;
  const recording = live.recording.slice();
  track('class_end', {
    course: String(course.title || '').slice(0, 80),
    seconds: Math.round(seconds || 0),
    studentMsgs: live.messages.filter((m) => m.role === 'user' && !m.hidden).length,
    causes: (live.causeSummary || []).length,
  });
  const courseRef = live.course;
  endLiveSilent();

  $('#live-room').hidden = true;
  $('#live-empty').hidden = false;
  $('#tile-share').hidden = true;

  // 保存课堂回放
  persistRecording(courseRef, recording, seconds);
  renderCourses();

  // 更新课程进度
  const idx = state.courses.findIndex((c) => c.id === course.id);
  const total = (course.outline && Array.isArray(course.outline.stages)) ? course.outline.stages.length : 1;
  course.progress = Math.min(1, (stageIndex + (seconds > 60 ? 1 : 0)) / total);
  if (idx >= 0) { state.courses[idx] = course; saveCourse(course, false); }

  // 生成课堂小结
  openSummaryLoading();
  try {
    // 教学法依据：主动回忆（active recall）+ 间隔重复（spaced repetition）显著优于重复阅读。
    // 因此小结除掌握度评估外，还输出 3 张"闪卡"式复习卡与复习时间表。
    const sys = '你是「灵犀课堂」的教学顾问，熟悉认知科学与学习科学（主动回忆、间隔重复、成长型思维）。' +
      langNote('课堂小结、作业建议、自测卡片、复习计划、总评') +
      '请根据课堂对话记录输出一个 JSON 对象，禁止输出其他文字：' +
      '{"mastered":["已掌握的知识点"],"weakPoints":["仍薄弱或需要注意的点"],' +
      '"homework":["针对性作业建议1","作业建议2"],' +
      '"cards":[{"q":"自测问题（一句话，能直接作答）","a":"标准答案（1-2 句）"}],' +
      '"reviewPlan":["今晚：……","明天：……","三天后：……","一周后：……"],' +
      '"memoryFacts":[{"kind":"weak|strength|preference|progress|misconception|context",' +
      '"content":"一条关于这个学生的、值得长期记住的事实","topic":"对应知识点","confidence":0.8}],' +
      '"studentStyle":{"teaching_style":"他偏好的讲解方式（如喜欢先看例题/需要图像帮助）",' +
      '"pace":"他的节奏（如反应快可加速/需要放慢）","note":"其它值得长期记住的观察"},' +
      '"errorCauses":[{"cause":"knowledge|concept|careless|reading","topic":"出错的知识点",' +
      '"detail":"他具体是怎么错的（一句话，写清错误表现）","fix":"下次针对这个原因该怎么补（一句话）"}],' +
      '"comment":"给学生和家长的两三句总评，语气温和鼓励，用成长型思维措辞（把不足说成' +
      '\"这一步的策略还有提升空间\"而不是\"你不行\"）"}。' +
      '要求：mastered/weakPoints/homework 各 0-3 条 —— **有依据才写，没有依据就给空数组 []**，' +
      '绝对不要为了凑数编造；cards 给 3 张，问题要覆盖本节课最核心的 3 个知识点、' +
      '必须能脱离上下文作答（不要出现"这道题""刚才那个"这类指代）；reviewPlan 4 条，按遗忘曲线安排；' +
      'memoryFacts 给 2-6 条，只写**对以后教学真正有用**的信息（薄弱知识点、反复出现的错误、有效的讲解方式、' +
      '学习偏好、当前进度），不要写"今天上了XX课"这类流水账，每条要具体可执行、脱离本节课也能看懂；' +
      'studentStyle 若无法判断则给空字符串；全部使用简体中文。\n' +
      '【JSON 卫生，必须遵守】所有字段值内部**不得出现英文双引号 "**，需要引用词语时用中文引号「」或“”；' +
      '字段值内部不得换行；不要在 JSON 之外输出任何解释文字。\n' +
      '【errorCauses 是本节课最重要的产出，请认真判断】只针对本节课里**学生真正做错或卡住**的地方填写，' +
      '没有就返回空数组 []，绝对不要为了凑数编造。每一类错误最多一条，允许只写 1-2 条。四个维度互斥的定义：\n' +
      '  · knowledge（知识漏洞）——相关概念、公式、定理他**根本没学会**，答不出或纯属瞎猜。\n' +
      '  · concept（概念混淆）——他其实学过，但把相近的概念/公式/适用条件**弄混了**（如把充分条件和必要条件搞反、' +
      '把平方差和完全平方弄混）；表现为"我知道那个公式，但用错地方了"。\n' +
      '  · careless（计算失误）——**解题思路和方法是对的**，只是运算、移项、去括号、抄写、符号出现错误。\n' +
      '  · reading（审题偏差）——漏看或错看了题目条件、单位、问法（如求"最大值"他答了"最小值"、漏掉"至少"）。\n' +
      '判定时优先看学生**自己说的解题过程**：如果他复述思路正确却算错，就是 careless，不要误判成 knowledge —— ' +
      '把"会但算错"当成"不会"去重讲，是伤害学习信心最常见的一种误诊。\n' +
      /* ★ R17（2026-09-29）："未作答"必须与"做对/做错"三分，不能二分成"掌握/薄弱"。
         原来要求 mastered 至少 1 条，等于强迫模型在"学生整节课没答题"时也要凑一个已掌握出来 ——
         那不是评估，是编造。现在由提示词 + 下面的确定性守卫一起保证。 */
      '【关于"未作答"，必须遵守】学生**没有作答**的知识点既不算"已掌握"，也不算"薄弱" —— ' +
      '它属于"未验证"，不要写进 mastered，也不要写进 weakPoints。\n' +
      '  · 本节课学生**完全没有作答**时，mastered 必须是空数组 []，weakPoints 里也不能出现"没掌握"这类断言，' +
      '并在 comment 里如实说明"本节课以讲解为主，还没有作答证据，掌握情况待验证"。\n' +
      '  · 只有学生**答对**（或明确复述对了）才能进 mastered；只有出现**错误的作答或明确的卡点**才能进 weakPoints。\n' +
      '  · 宁可少写、写空，也不要为了让小结"看起来完整"而编造结论。';
    /* ★ R17（2026-09-29）：把课中**已经采集到**的作答证据一并交给小结模型。
       live.recording 里 type='cause' 的事件是课中逐轮累积的错因，
       live.causeSummary 早就算好了、track 里也上报了，却一直没进过提示词 ——
       于是模型只能从对话文本里再猜一遍，典型的"证据采了但没用上"。 */
    const studentMsgCount = live.messages.filter((m) => m.role === 'user' && !m.hidden).length;
    const causeEvidence = (live.causeSummary || []).filter(Boolean);
    const answerEvidence = '\n【本节课的作答证据（结构化采集，以它为准）】' +
      '\n· 学生作答/发言次数：' + studentMsgCount +
      '\n· 课中诊断出的错因：' + (causeEvidence.length ? causeEvidence.join('、') : '（无）') +
      '\n· 说明：次数为 0 表示学生整节课没有作答 —— 此时 mastered 必须为空，不要给出任何"已掌握"结论。';
    const raw = await streamChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: '课程：' + course.title + '（' + course.subject + ' · ' + course.grade + '，时长 ' + fmtTime(seconds) + '）' +
          (memoryPromptBlock() ? '\n【已有的学生长期记忆（请勿重复记录，只补新的或更新的）】\n' + memoryPromptBlock() : '') +
          answerEvidence +
          '\n课堂对话记录：\n' + (transcript || '（学生本节课未发言）') },
      ],
      temperature: 0.4,
      responseFormat: true,
    });
    const sum = guardSummaryEvidence(parseJSONLoose(raw), { studentMessages: studentMsgCount });
    renderSummary(sum, raw, null, course);
    track('summary_view', {
      course: String(course.title || '').slice(0, 80), parsed: !!sum,
      weak: sum && Array.isArray(sum.weakPoints) ? sum.weakPoints.length : 0,
      cards: sum && Array.isArray(sum.cards) ? sum.cards.length : 0,
      causes: sum && Array.isArray(sum.errorCauses) ? sum.errorCauses.length : 0,
    });
    // 课后沉淀长期记忆（异步，不阻塞小结展示）
    persistMemoryAfterClass(course, sum, transcript, seconds).catch((e) => console.warn('[memory] 课后写入失败:', e));
  } catch (e) {
    renderSummary(null, null, mapLLMError(e), course);
  }
}

/* 课后：把本节课沉淀成长期记忆（画像 + 事实 + 上课记录） */
async function persistMemoryAfterClass(course, sum, transcript, seconds) {
  if (!memReady() || !sum) return;
  const facts = Array.isArray(sum.memoryFacts) ? sum.memoryFacts : [];
  const style = sum.studentStyle || {};
  const causes = cleanErrorCauses(sum.errorCauses);

  // 1) 上课记录（含错因四维归类；列不存在时 saveSession 内部自动降级）
  await saveSession({
    courseTitle: course.title,
    subject: course.subject,
    grade: course.grade,
    durationSecs: seconds,
    mastered: sum.mastered,
    weakPoints: sum.weakPoints,
    homework: sum.homework,
    cards: sum.cards,
    reviewPlan: sum.reviewPlan,
    errorCauses: causes,
    comment: sum.comment,
    transcript: transcript ? transcript.slice(0, 20000) : null,
  });

  // 2) 记忆事实（带学科/知识点，方便以后按学科召回）
  const mapped = facts.map((f) => ({
    kind: f.kind, content: f.content, topic: f.topic,
    subject: course.subject, confidence: f.confidence, source: 'class',
  }));

  /* 2b) 错因 → 记忆事实：模型有时写不好 memoryFacts，但错因是结构化字段，
     这里确定性地产出，保证"老师明天还记得你为什么错"不会被模型漏掉。
     按维度而不是按题目措辞，天然可跨课程去重累积（hits 会一直累加）。 */
  const causeFacts = causes.map((e) => {
    const c = ERROR_CAUSES[e.cause];
    const where = e.topic ? '在「' + e.topic + '」上' : '在本节课的题目上';
    return {
      kind: 'misconception',
      topic: e.topic || '',
      subject: course.subject,
      confidence: 0.82,
      source: 'class',
      content: '错因类型：' + c.label + ' —— ' + where +
        (e.detail ? '，具体表现是' + e.detail : '') +
        '。下次要' + (e.fix || c.action),
    };
  });
  if (causes.length) {
    causeFacts.push({
      kind: 'misconception',
      topic: '',
      subject: course.subject,
      confidence: 0.75,
      source: 'class',
      content: '错因画像：本节课的错误集中在' +
        causes.map((e) => ERROR_CAUSES[e.cause].label).join('、') + '。',
    });
  }

  await saveFacts(mapped.concat(causeFacts));

  // 3) 画像：计数累加 + 风格/节奏（有值才覆盖，避免把已有信息冲掉）
  const patch = { _addSessions: 1, _addSeconds: Math.round(seconds) };
  if (style.teaching_style) patch.teaching_style = String(style.teaching_style).slice(0, 200);
  if (style.pace) patch.pace = String(style.pace).slice(0, 100);
  if (style.note) patch.notes = String(style.note).slice(0, 2000);
  if (course.grade) patch.grade = course.grade;
  if (course.systemName) patch.system = course.systemName;
  if (course.goal) patch.goal = course.goal;
  await saveProfile(patch);

  // 4) 刷新本地记忆缓存（下次开课即可用上）
  await loadMemory(true);
}

/* ---------- 小结弹窗 ---------- */
function openSummaryLoading() {
  $('#summary-modal').hidden = false;
  $('#summary-body').innerHTML = '<div style="text-align:center;padding:30px 0;color:var(--muted)">AI 正在整理课堂小结…</div>';
}
/* 渲染「错因分析」列表：一节课的错因清单（原因徽章 + 知识点 + 具体表现 + 建议） */
function renderCauses(list) {
  const items = cleanErrorCauses(list);
  if (!items.length) return '';
  return '<div class="cause-list">' + items.map((e) => {
    const c = ERROR_CAUSES[e.cause] || ERROR_CAUSES.other;
    return '<div class="cause-item ' + c.cls + '">' +
      '<div class="cause-head">' +
      '<span class="cause-badge ' + c.cls + '">' + c.icon + ' ' + esc(c.label) + '</span>' +
      (e.topic ? '<b>' + esc(e.topic) + '</b>' : '') +
      '</div>' +
      '<p class="cause-meaning">' + esc(c.meaning) + '</p>' +
      (e.detail ? '<p class="cause-detail">当时的表现：' + esc(e.detail) + '</p>' : '') +
      '<p class="cause-fix">👉 ' + esc(e.fix || c.action) + '</p>' +
      '</div>';
  }).join('') + '</div>';
}

/* 渲染「错因分布」：跨课程的错因聚合图谱（学习档案页） */
function renderErrorProfile(sessions) {
  const el = $('#mem-causes');
  if (!el) return;
  const ep = buildErrorProfile(sessions);
  if (!ep.total) {
    el.innerHTML = '<p class="mem-empty">还没有错因记录。做错题时，老师会判断是' +
      '<b>知识漏洞</b>、<b>概念混淆</b>、<b>计算失误</b>还是<b>审题偏差</b>，然后记在这里。</p>';
    return;
  }
  const totalOf = (k) => ep.list.reduce((a, g) => a + g.counts[k], 0);
  /* 用"出现该错因的知识点数 / 出现过错因的知识点数"而不是纯次数：
     同一个知识点反复算错 5 次，不代表它比 5 个都完全没掌握的知识点更严重。
     占比衡量的是"这种毛病波及多广"，次数只作为参考数字。 */
  const topicCount = ep.list.length;

  const bar = (k) => {
    const n = totalOf(k);
    if (!n) return '';
    const pct = Math.round((ep.list.filter((g) => g.counts[k] > 0).length / topicCount) * 100);
    const c = ERROR_CAUSES[k];
    return '<div class="ep-bar-row">' +
      '<span class="ep-bar-label">' + c.icon + ' ' + c.label + '</span>' +
      '<span class="ep-bar-track" role="img" aria-label="' + esc(c.label) + '：影响 ' +
        ep.list.filter((g) => g.counts[k] > 0).length + ' 个知识点，共 ' + n + ' 次">' +
        '<i class="ep-bar-fill ' + c.cls + '" style="width:' + pct + '%"></i></span>' +
      '<b class="ep-bar-num">' + n + '</b>' +
      '</div>';
  };

  const carelessish = ep.list.reduce((a, g) => a + g.counts.careless + g.counts.reading, 0);
  const knowledgeish = ep.total - carelessish;
  // 这个比例是"会但没做对" vs "真不会"，直接决定下一步该补什么
  const verdict = carelessish > knowledgeish
    ? '你的错<b>大多是"会但没做对"</b>——知识其实是掌握的，重点放在审题和验算习惯上。'
    : knowledgeish > carelessish
      ? '你的错<b>大多来自知识点本身</b>——先把概念和公式夯实，比多刷题更有效。'
      : '你的错误里"知识点没掌握"和"会但没做对"各占一半，两边都要兼顾。';

  el.innerHTML =
    '<div class="ep-verdict">' + verdict + '</div>' +
    '<div class="ep-topics">' + ep.list.slice(0, 6).map((g) => {
      const c = ERROR_CAUSES[g.top] || ERROR_CAUSES.other;
      return '<div class="ep-topic">' +
        '<span class="ep-topic-name">' + esc(g.topic) + '</span>' +
        (g.subject ? '<span class="ep-topic-subj">' + esc(g.subject) + '</span>' : '') +
        '<span class="cause-badge ' + c.cls + '">' + c.icon + ' ' + esc(c.label) + '</span>' +
        '<span class="ep-topic-n">' + g.total + ' 次</span>' +
        '</div>';
    }).join('') + '</div>' +
    '<div class="ep-bars">' +
      ERROR_CAUSE_KEYS.map(bar).join('') +
    '</div>' +
    '<p class="ep-bars-hint">每组占比 = 出现过这类错误的<b>知识点</b>占全部出错知识点的比例（括号里是累计次数）。</p>';
}

/* 渲染「起点画像」：把入学诊断沉淀的 facts（source='diagnostic'）还原成一张图。
   为什么要单独做：诊断是**一次性**的定位（开课前），和每节课动态生长的
   掌握度/错因不是一回事。混在一起看，学生会分不清"这是我起点的样子"
   还是"我现在的样子" —— 起点必须单独呈现，才能看出进步。 */
function renderMemoryDiag(facts) {
  const el = $('#mem-diag');
  if (!el) return;
  const list = (Array.isArray(facts) ? facts : []).filter((f) => f && f.source === 'diagnostic');
  if (!list.length) {
    // 纯静态文案（无任何插值），写成单行字面量让静态审查可直接判定
    el.innerHTML = '<p class="mem-empty">还没有做过课前诊断。生成课程前点「先做课前诊断」，老师就能知道该从哪里讲起，不会把你会的内容再讲一遍。</p>';
    return;
  }

  /* 按 **学科 + 知识点** 归组，取"最需要关注"的那条。
     ★ 2026-09-29 修（外部审查 R07 的第二处同构聚合点）：
       ① 原来只用 topic 当键，跨学科同名知识点会混在一起；
       ② 原来 levelOf 只认 weak / strength 两档 —— 只存在 `misconception`（易错点）
          的知识点掉进第三档 'info'，被显示成"评估记录"，
          而不是如实标成"起点薄弱"。误解本来就是薄弱的一种，不该有兜底档位把它藏起来。
       （两处聚合必须一起改 —— 只修一处，起点画像和掌握度会给出互相矛盾的结论。） */
  const byTopic = {};
  const order = [];
  list.forEach((f) => {
    const topicName = String(f.topic || '').trim() || '综合评估';
    const subjectName = String(f.subject || '').trim();
    const key = subjectName + '｜' + topicName;
    if (!byTopic[key]) {
      byTopic[key] = { topic: topicName, subject: subjectName, kinds: [], when: f.last_seen || '' };
      order.push(key);
    }
    if (byTopic[key].kinds.indexOf(f.kind) < 0) byTopic[key].kinds.push(f.kind);
    if (f.last_seen && (!byTopic[key].when || f.last_seen > byTopic[key].when)) byTopic[key].when = f.last_seen;
  });

  const levelOf = (kinds) => {
    if (kinds.indexOf('weak') >= 0 || kinds.indexOf('misconception') >= 0) return 'need';
    if (kinds.indexOf('strength') >= 0) return 'ok';
    return 'info';
  };
  const rows = order.map((k) => {
    const g = byTopic[k];
    const lv = levelOf(g.kinds);
    const L = lv === 'need' ? { label: '起点薄弱', cls: 'd-gap', icon: '🔴' }
      : lv === 'ok' ? { label: '起点已会', cls: 'd-ok', icon: '✅' }
        : { label: '评估记录', cls: 'd-fuzzy', icon: '🔶' };
    return { topic: g.topic, subject: g.subject, when: g.when, lv, L };
  }).sort((a, b) => (a.lv === b.lv ? 0 : a.lv === 'need' ? -1 : 1));

  const need = rows.filter((r) => r.lv === 'need');
  const ok = rows.filter((r) => r.lv === 'ok');
  const overall = list.filter((f) => f.kind === 'context')[0];

  const head = '<div class="md-sum">' +
    '<div class="md-stat need"><b>' + need.length + '</b><span>起点薄弱</span></div>' +
    '<div class="md-stat ok"><b>' + ok.length + '</b><span>起点已会</span></div>' +
    '</div>' +
    (overall ? '<p class="md-overall">' + esc(overall.content) + '</p>' : '');

  const body = '<div class="md-topics">' + rows.slice(0, 12).map((r) =>
    '<div class="md-topic ' + r.L.cls + '">' +
    '<span class="md-ico">' + r.L.icon + '</span>' +
    '<b>' + esc(r.topic) + '</b>' +
    (r.subject ? '<span class="md-subj">' + esc(r.subject) + '</span>' : '') +
    '<span class="md-lv">' + r.L.label + '</span>' +
    '</div>').join('') + '</div>';

  el.innerHTML = head + body +
    '<p class="md-hint">这是你<b>开课前</b>的起点快照。真正的进步看上面的「知识点掌握度」——' +
    '当某个"起点薄弱"的标签在掌握度里变成"已掌握"，那才是真的学会了。</p>';
}

/* ★ R17（2026-09-29）：小结的"已掌握"必须由作答证据支撑，不能靠模型自觉。
   提示词里已经写明"未作答不算已掌握、没有证据就给空数组"，但提示词是**请求**不是**保证** ——
   模型仍然可能为了把小结写满而列出没验证过的知识点。
   这里做一道确定性守卫：学生整节课没有任何作答/发言 → mastered 一律清空，
   并在小结上标注"掌握情况待验证"。宁可空着，也不要给学生和家长一个没有依据的结论。

   注意：只清 mastered，不动 weakPoints —— 薄弱点可以由老师自己的观察支撑
   （学生在讲解中出现卡顿、反复追问都算），并不要求他先作答。
   而"已掌握"按定义是一种**正面验证结果**，没有作答就不可能有。 */
function guardSummaryEvidence(sum, ctx) {
  if (!sum || typeof sum !== 'object') return sum;
  const studentMessages = (ctx && typeof ctx.studentMessages === 'number') ? ctx.studentMessages : 0;
  if (studentMessages <= 0) {
    const dropped = Array.isArray(sum.mastered) ? sum.mastered.length : 0;
    sum.mastered = [];
    sum.noAnswerEvidence = true;
    if (dropped > 0) {
      // 这不是静默丢弃：留下痕迹，便于排查模型为什么在无证据时给出了结论
      sum.droppedUnverified = dropped;
      console.warn('[summary] 学生本节课无作答记录，已清空 ' + dropped + ' 条无依据的"已掌握"');
    }
  }
  return sum;
}

function renderSummary(sum, raw, errMsg, course) {
  const body = $('#summary-body');
  if (!sum) {
    // 学生看不懂原始 JSON，也读不出信息；把原文留在控制台给排查用，界面只给可读的说明
    if (raw) console.warn('[summary] 小结解析失败，原始输出：', raw);
    body.innerHTML = '<div class="sum-comment">' +
      esc(errMsg || '这次课堂小结没能整理出来，但本节课的内容已经保存，可以稍后重试。') + '</div>';
    return;
  }
  const list = (arr) => Array.isArray(arr) && arr.length
    ? '<ul>' + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
    : '<ul><li>暂无</li></ul>';

  // 闪卡：正面问题，点开才看答案 —— 强制"先回忆再核对"，这是主动回忆的关键
  const cards = (Array.isArray(sum.cards) ? sum.cards : []).filter((c) => c && (c.q || c.a));
  const cardsHtml = cards.length
    ? `<div class="sum-block sum-cards"><b>🃏 课后自测闪卡</b>
        <p class="sum-hint">先在心里作答，再点开对答案 —— 直接看答案效果会差很多。</p>
        <div class="flash-list">${cards.map((c, i) => `
          <details class="flash-card">
            <summary><span class="fc-no">${i + 1}</span><span class="fc-q">${esc(c.q || '（略）')}</span>
              <span class="fc-toggle">看答案</span></summary>
            <div class="fc-a"><b>答案：</b>${esc(c.a || '（略）')}</div>
          </details>`).join('')}</div>
      </div>`
    : '';

  const plan = Array.isArray(sum.reviewPlan) ? sum.reviewPlan.filter(Boolean) : [];
  const planHtml = plan.length
    ? `<div class="sum-block"><b>🔁 间隔复习计划</b>
        <ol class="review-plan">${plan.map((p) => '<li>' + esc(p) + '</li>').join('')}</ol></div>`
    : '';

  const hasReplay = course && course.replay && course.replay.events && course.replay.events.length;
  const causeHtml = renderCauses(sum.errorCauses);
  /* ★ R17：无作答证据时，这一栏如实显示"待验证"，而不是"暂无"了事 ——
     "没答过"和"没掌握"是两件事，学生和家长都需要知道这一栏现在空着的原因。 */
  const masteredHtml = sum.noAnswerEvidence
    ? '<div class="sum-block"><b>✅ 已掌握</b><ul><li>暂无 —— 本节课没有作答记录，掌握情况待验证</li></ul>' +
      '<p class="sum-hint">"没答过"既不代表已掌握，也不代表没学会。等你有作答之后再回来看这一栏。</p></div>'
    : '<div class="sum-block"><b>✅ 已掌握</b>' + list(sum.mastered) + '</div>';
  body.innerHTML = `
    ${masteredHtml}
    <div class="sum-block"><b>📌 待巩固</b>${list(sum.weakPoints)}</div>
    ${causeHtml ? '<div class="sum-block sum-causes"><b>🔍 错因分析</b>' +
      '<p class="sum-hint">知道"为什么错"比知道"错了"重要 —— 不同原因要用完全不同的方式补。</p>' +
      causeHtml + '</div>' : ''}
    <div class="sum-block"><b>✏️ 作业建议</b>${list(sum.homework)}</div>
    ${cardsHtml}
    ${planHtml}
    ${sum.comment ? '<div class="sum-comment">' + esc(sum.comment) + '</div>' : ''}
    ${hasReplay ? '<div class="sum-replay"><b>⏺ 课堂回放已生成</b>（' + fmtTime(course.replay.duration) + '，' +
      course.replay.events.length + ' 个时间点）<br>到「我的课程」点击 <b>回放</b> 即可重温本节课。</div>' : ''}
    <div class="sum-report"><b>📤 发给家长</b>
      <p class="sum-hint">生成一页学情报告（学什么 / 掌握什么 / 错在哪怎么办 / 作业与复习计划），
        可复制文字或下载长图，直接发微信给家长。</p>
      <button class="btn btn-primary btn-sm" id="btn-sum-parent-report">生成家长报告</button>
    </div>`;
  // 小结里的报告：直接用这份小结数据（不必等落库）
  const prBtn = $('#btn-sum-parent-report');
  if (prBtn) prBtn.addEventListener('click', () => {
    openParentReport(sum, { title: (course && course.title) || '', subject: (course && course.subject) || '' });
  });
}

/* ---------- 事件绑定 ---------- */
/* ============================================================
   弹窗可访问性：集中给全部 .modal-mask 补 ARIA、Esc 关闭、
   焦点归还与滚动锁。改这里即可覆盖 9 个弹窗，无需逐个改结构。
   ============================================================ */
function allMasks() {
  return Array.prototype.slice.call(document.querySelectorAll('.modal-mask'));
}
function openMasks() {
  return allMasks().filter((m) => !m.hidden);
}
function syncBodyScrollLock() {
  document.body.style.overflow = openMasks().length ? 'hidden' : '';
}
function enhanceModalA11y() {
  allMasks().forEach((mask) => {
    try {
      if (!mask.getAttribute('role')) mask.setAttribute('role', 'dialog');
      mask.setAttribute('aria-modal', 'true');
      if (!mask.getAttribute('aria-label')) {
        const head = mask.querySelector('.modal-head');
        const t = head ? String(head.textContent || '').replace(/[✕×]/g, '').trim() : '';
        if (t) mask.setAttribute('aria-label', t);
      }
      Array.prototype.forEach.call(mask.querySelectorAll('.modal-close'), (b) => {
        // 关闭按钮原本只有 ✕ 符号，读屏无法朗读
        if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', '关闭');
        if (!b.getAttribute('type')) b.setAttribute('type', 'button');
      });
    } catch (_) {}
  });
}
function watchModalFocus() {
  let lastOpen = [];
  let restoreTo = null;
  const sync = () => {
    try {
      const open = openMasks();
      if (open.length > lastOpen.length) {
        // 新打开：记住来源，把焦点移进弹窗
        restoreTo = document.activeElement;
        const top = open[open.length - 1];
        const first = top.querySelector('input:not([type="hidden"]), textarea, select, a[href]')
          || top.querySelector('.modal-close');
        if (first) setTimeout(() => { try { first.focus(); } catch (_) {} }, 40);
      } else if (!open.length && lastOpen.length) {
        // 全部关闭：把焦点还给打开它的元素
        const back = restoreTo;
        restoreTo = null;
        if (back && typeof back.focus === 'function') {
          setTimeout(() => { try { back.focus(); } catch (_) {} }, 0);
        }
      }
      lastOpen = open;
      syncBodyScrollLock();
    } catch (_) {}
  };
  try {
    if (typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver(sync);
    allMasks().forEach((m) => mo.observe(m, { attributes: true, attributeFilter: ['hidden'] }));
    sync();
  } catch (_) {}
}
/* 弹窗焦点陷阱（2026-09-24 补）
   watchModalFocus() 原来只做了"打开时把焦点移进来 / 关闭时还原"，
   **没有拦 Tab** —— 实测在登录弹窗里按 12 次 Tab，有 7 次焦点跑到了背景页面
   （跑到 #brand 甚至 BODY 上）。而弹窗已经声明了 role=dialog + aria-modal=true，
   等于对外承诺"这是模态"，实际却不管焦点 —— 键盘用户会看不见自己在哪，
   甚至误触背景的导航和按钮。这里把焦点锁在弹窗内循环。 */
function trapModalFocus(ev) {
  if (ev.key !== 'Tab') return;
  let open = [];
  try { open = openMasks(); } catch (_) { return; }
  if (!open.length) return;
  const top = open[open.length - 1];
  const items = Array.prototype.filter.call(
    top.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),'
      + ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    (el) => {
      if (el.hidden || el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    });
  // 弹窗里没有可聚焦元素时，也别让焦点跑到背景
  if (!items.length) { ev.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!top.contains(active)) {                    // 焦点已在弹窗外 → 拉回第一个
    ev.preventDefault();
    try { first.focus(); } catch (_) {}
    return;
  }
  if (ev.shiftKey && active === first) {
    ev.preventDefault();
    try { last.focus(); } catch (_) {}
  } else if (!ev.shiftKey && active === last) {
    ev.preventDefault();
    try { first.focus(); } catch (_) {}
  }
}

function bindModalA11yKeys() {
  // 捕获阶段先于直播间那个 Esc 打断监听，避免两者互相抢
  document.addEventListener('keydown', (ev) => {
    trapModalFocus(ev);          // Tab 焦点陷阱（不拦则焦点会跑到背景页面）
    if (ev.key !== 'Escape') return;
    // ① 弹窗优先
    const open = openMasks();
    if (open.length) {
      if (state.live && state.live.busy) return;   // 讲解中：Esc 留给「打断老师」
      const btn = open[open.length - 1].querySelector('.modal-close');
      if (btn) {
        btn.click();
        ev.preventDefault();
        // ★ 必须阻止继续冒泡：preventDefault 不能阻止传播，
        //   否则直播间那个 Esc 处理器还会再跑一次 —— 学生只想关个弹窗，
        //   却顺带把老师的讲解打断了（实测确认）。
        ev.stopPropagation();
      }
      return;
    }
    // ② 大纲抽屉：它不是 .modal-mask，之前被漏掉 —— 键盘用户按 Esc 没反应，
    //    只能鼠标去点 ✕（实测发现）。这里补上，且不影响"Esc 打断老师"。
    const board = $('#meet-board');
    if (board && !board.hidden) {
      board.hidden = true;
      const tb = $('#tb-board');
      if (tb) tb.classList.remove('active');
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);
}

/* 移动端导航抽屉：宽屏隐藏了 .nav-links，手机上必须另有入口，
   否则「我的课程 / 学习档案」在手机上完全进不去。 */
function bindMobileNav() {
  const btn = $('#btn-burger');
  const menu = $('#mobile-nav');
  if (!btn || !menu) return;
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.classList.toggle('on', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
  };
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setOpen(menu.hidden);
  });
  // 点菜单项后自动收起；真正的跳转由 body 上的 [data-nav] 委托处理
  menu.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-nav]')) setOpen(false);
  });
  document.addEventListener('click', (ev) => {
    if (menu.hidden) return;
    if (ev.target.closest('#mobile-nav') || ev.target.closest('#btn-burger')) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !menu.hidden) setOpen(false);
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 1000) setOpen(false); });
  window.__closeMobileNav = () => setOpen(false);
}

function bindNav() {
  document.body.addEventListener('click', (ev) => {
    // ① 所有 href="#" / javascript: 的伪链接，统一拦截默认跳转。
    //    既避免页面跳到顶部，也避免 CSP（script-src 无 unsafe-inline）把它们
    //    当成内联脚本拦掉而刷控制台报错。
    const dead = ev.target.closest('a[href="#"], a[href^="javascript:"]');
    if (dead) ev.preventDefault();
    // ② 真正的导航：点击 [data-nav] 切换视图
    const nav = ev.target.closest('[data-nav]');
    if (nav) { switchView(nav.dataset.nav); return; }
  });
}

function bindLiveEvents() {
  const input = $('#chat-input');
  // 直播间画面里的老师形象：与聊天头像同一来源，避免"同一个老师长得不一样"
  const avBox = $('#teacher-avatar');
  if (avBox && !avBox.dataset.filled) { avBox.dataset.filled = '1'; avBox.innerHTML = teacherFaceSVG({ uid: 'lr' }); }
  // 发送前先清空输入框：sendLive 是 async，它清空输入框要等第一个 await 之后才执行，
  // 这中间手快连点（或连按 Enter）会让同一条消息被重复发出 —— 结果是重复烧额度、
  // 而且在老师正讲课时第二次点击会触发"打断"，把老师刚说的话掐断重答一遍。
  const takeInput = () => {
    const t = input.value.trim();
    if (!t) return '';
    input.value = '';
    input.style.height = 'auto';
    return t;
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const t = takeInput();
      if (t) sendLive(t);
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  });
  $('#btn-send').addEventListener('click', () => {
    const t = takeInput();
    if (t) sendLive(t);
  });
  $('#btn-stop').addEventListener('click', () => {
    if (state.live && state.live.controller) {
      state.live.pendingInterrupt = {
        spoken: clipText(lastTeacherBubbleText(), 180),
        ask: '（学生要求暂停一下）',
      };
      state.live.controller.abort();
      // ★ 打断的语义是"立刻停下"：只 abort 网络流不够 ——
      //   TTS 队列里已排好的句子会继续念下去（实测按了暂停还要再听十几秒）。
      stopSpeech();
    }
  });

  // Esc 键：快速打断 / 停止老师讲解
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if ($('#live-room').hidden) return;
    const live = state.live;
    // ① 老师正在生成/讲解：中断网络流 + 停朗读
    if (live && live.busy && live.controller) {
      live.pendingInterrupt = {
        spoken: clipText(lastTeacherBubbleText(), 180),
        ask: '（学生按了暂停）',
      };
      live.controller.abort();
      stopSpeech();
      ev.preventDefault();
      return;
    }
    // ② 老师**话已说完但声音还在念**：这时 busy 已经是 false，
    //    只处理 ① 会导致按 Esc 完全没反应（实测：队列里还有句子在念，按键无效）。
    if (TTS.speaking || TTS.queue.length) {
      stopSpeech();
      ev.preventDefault();
    }
  });
  $('#quick-row').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.quick-chip');
    if (chip && !chip.disabled) sendLive(chip.dataset.q);
  });
  $('#btn-end').addEventListener('click', () => confirmEndLive($('#btn-end')));

  // 键盘翻页：预览弹窗打开时优先控制弹窗，否则控制直播间课件
  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const d = ev.key === 'ArrowRight' ? 1 : -1;
    if (!$('#slide-modal').hidden) {
      slideGo(d);
      ev.preventDefault();
    } else if (!$('#live-room').hidden && !$('#tile-share').hidden) {
      liveSlideGo(d);
      ev.preventDefault();
    }
  });
}

function bindModalEvents() {
  const close = () => { $('#summary-modal').hidden = true; };
  $('#btn-summary-close').addEventListener('click', close);
  $('#btn-summary-close2').addEventListener('click', close);
  $('#btn-summary-back').addEventListener('click', () => { close(); switchView('home'); });
  $('#summary-modal').addEventListener('click', (ev) => {
    if (ev.target === $('#summary-modal')) close();
  });

  // 课件预览弹窗
  $('#btn-slide-close').addEventListener('click', closeSlidePreview);
  $('#slide-modal').addEventListener('click', (ev) => {
    if (ev.target === $('#slide-modal')) closeSlidePreview();
  });
  $('#btn-slide-prev').addEventListener('click', () => slideGo(-1));
  $('#btn-slide-next').addEventListener('click', () => slideGo(1));
  $('#slide-nav').addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-goto]');
    if (!item) return;
    slideState.index = Number(item.dataset.goto);
    renderSlideViewer();
  });
  $('#btn-slide-export').addEventListener('click', (ev) => {
    if (slideState.course) exportPPTX(slideState.course, ev.currentTarget);
  });

  // 直播间课件翻页（会议共享屏）
  $('#btn-live-slide-prev').addEventListener('click', () => liveSlideGo(-1));
  $('#btn-live-slide-next').addEventListener('click', () => liveSlideGo(1));

  // 右侧面板切换
  $$('.side-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchSidePane(tab.dataset.panel));
  });
  const assistMini = $('#assistant-mini');
  if (assistMini) assistMini.addEventListener('click', focusAssistantLog);

  // 会议控制栏：麦克风
  // 语音提问（学生侧）
  // 这里**不做"假装已开启麦克风"**：课堂里没有任何麦克风采集代码（平台模型只收文本+图片，
  // 浏览器语音识别在微信内置浏览器与国内 Chrome 上都不可用），所以按钮只能给出真实可行的路径。
  // 学生真正能用的是输入法的语音键 —— 明说出来，比一个点了没反应的假开关有用。
  $('#tb-mic').addEventListener('click', () => {
    if (!state.live) return;
    toast('课堂语音对讲暂未开通。想说话：点下方输入框，用键盘上的语音键说，字会自动打进去。', 'ok');
    const box = $('#chat-input');
    if (box) { try { box.focus(); } catch (_) {} }
  });

  // 摄像头开关（实际是"你看到的老师画面"，不是你的摄像头 —— 文案必须说清）
  $('#tb-cam').addEventListener('click', () => {
    const live = state.live;
    if (!live) return;
    live.camOn = !live.camOn;
    const btn = $('#tb-cam');
    btn.classList.toggle('off', !live.camOn);
    btn.querySelector('.mt-ico').textContent = live.camOn ? '📹' : '🚫';
    btn.querySelector('.mt-label').textContent = live.camOn ? '隐藏画面' : '显示画面';
    btn.title = live.camOn ? '隐藏老师的画面（不影响你的摄像头）' : '重新显示老师的画面';
    $('#teacher-video').classList.toggle('cam-off', !live.camOn);
  });

  // 共享屏幕（课件）
  $('#tb-share').addEventListener('click', () => {
    const live = state.live;
    if (!live) return;
    live.sharing = !live.sharing;
    $('#tb-share').classList.toggle('active', live.sharing);
    renderLiveSlide();
    toast(live.sharing ? '正在共享课件' : '已停止共享');
  });

  // 举手
  $('#tb-hand').addEventListener('click', () => {
    const live = state.live;
    if (!live) return;
    if (live.handUp) {
      live.handUp = false;
      $('#tb-hand').classList.remove('active');
      return;
    }
    live.handUp = true;
    $('#tb-hand').classList.add('active');
    toast('已举手，老师会回应你', 'ok');
    // 学生举手时让提示条出现一下
    const hint = $('#people-hint');
    if (hint) {
      hint.textContent = '✋ 你举手了，正在等待老师回应…';
      setTimeout(() => { hint.textContent = '课堂小结会在下课后自动生成'; }, 4000);
    }
    sendLive('（学生举手了，请先回应他的问题。）', { hidden: true });
  });

  // 聊天 / 参会者 / 大纲
  $('#tb-chat').addEventListener('click', () => switchSidePane('chat'));
  $('#tb-people').addEventListener('click', () => switchSidePane('people'));
  $('#tb-board').addEventListener('click', () => {
    const board = $('#meet-board');
    board.hidden = !board.hidden;
    $('#tb-board').classList.toggle('active', !board.hidden);
  });
  $('#mb-close').addEventListener('click', () => {
    $('#meet-board').hidden = true;
    $('#tb-board').classList.remove('active');
  });

  // 底部结束按钮 / 顶栏结束会议：统一走二次确认
  const leaveBtn = $('#tb-leave');
  if (leaveBtn) leaveBtn.addEventListener('click', () => confirmEndLive(leaveBtn));
  const topEndBtn = $('#btn-end');
  if (topEndBtn) topEndBtn.addEventListener('click', () => confirmEndLive(topEndBtn));

  // 语音朗读（长按切语速时不要顺带开关朗读）
  const tbVoice = $('#tb-voice');
  if (tbVoice) tbVoice.addEventListener('click', () => {
    if (speakRatePressed) { speakRatePressed = false; return; }
    toggleTTS();
  });
  bindSpeakRateLongPress();
  safeInit('bindVoiceSettingsEvents', bindVoiceSettingsEvents);

  // 引导强度（苏格拉底支持等级）
  const tbGuide = $('#tb-guide');
  if (tbGuide) tbGuide.addEventListener('click', openGuideModal);
  const gm = $('#guide-modal');
  if (gm) {
    gm.addEventListener('click', (ev) => { if (ev.target === gm) closeGuideModal(); });
    const opts = $('#guide-options');
    if (opts) opts.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-guide]');
      if (!b) return;
      setGuide(b.dataset.guide);
      openGuideModal();   // 重绘选中态
    });
    const metaSw = $('#guide-meta');
    if (metaSw) metaSw.addEventListener('click', () => toggleMeta());
  }
  const gc = $('#btn-guide-close');
  if (gc) gc.addEventListener('click', closeGuideModal);
  const gok = $('#btn-guide-ok');
  if (gok) gok.addEventListener('click', closeGuideModal);

  // 宫格视图
  const tbGal = $('#tb-gallery');
  if (tbGal) tbGal.addEventListener('click', () => toggleGallery());
  const galBack = $('#gal-back');
  if (galBack) galBack.addEventListener('click', () => toggleGallery(false));

  // 邀请同学 / 移出同学 / 同学提问
  const inviteBtn = $('#btn-invite');
  if (inviteBtn) inviteBtn.addEventListener('click', invitePeer);
  const plist = $('#people-list');
  if (plist) plist.addEventListener('click', (ev) => {
    const kick = ev.target.closest('[data-kick]');
    if (kick) { removePeer(kick.dataset.kick); return; }
    const person = ev.target.closest('.person');
    if (!person) return;
    // 点助教 → 滚到它的随堂记录（不参与"让 TA 提问"的角色扮演）
    const idxFirst = Array.from(plist.querySelectorAll('.person')).indexOf(person);
    const pFirst = allPeers()[idxFirst];
    if (pFirst && pFirst.isAssistant) {
      const box = $('#assistant-log');
      if (box) {
        try { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
        box.classList.add('al-flash');
        setTimeout(() => box.classList.remove('al-flash'), 1800);
      }
      return;
    }
    // 点击同学 → 让 TA 提问（角色扮演）
    const idx = Array.from(plist.querySelectorAll('.person')).indexOf(person);
    const peers = allPeers();
    const p = peers[idx];
    if (p && !p.isTeacher && !p.isMe && !p.isAssistant) {
      const qs = ['老师，这一步我没跟上，能再讲一遍吗？',
                  '这个知识点考试会怎么考呀？',
                  '能帮我举个例子说明一下吗？',
                  '为什么这里要这样算呢？'];
      peerAsk(p.id, qs[Math.floor(Math.random() * qs.length)]);
    }
  });

  // 课堂回放
  const tbRec = $('#tb-rec');
  if (tbRec) tbRec.addEventListener('click', () => {
    if (!state.live) return;
    openReplay(state.live.course);
  });
  const rpClose = $('#btn-replay-close');
  if (rpClose) rpClose.addEventListener('click', closeReplay);
  $('#replay-modal').addEventListener('click', (ev) => {
    if (ev.target === $('#replay-modal')) closeReplay();
  });
  $('#rp-play').addEventListener('click', () => replay.playing ? pauseReplay() : playReplay());
  $('#rp-restart').addEventListener('click', () => { seekReplay(0); });
  $('#rp-seek').addEventListener('input', (ev) => seekReplay(ev.target.value));
  $('#rp-speed').addEventListener('change', (ev) => { replay.speed = Number(ev.target.value) || 1; });
  $('#replay-timeline').addEventListener('click', (ev) => {
    const it = ev.target.closest('[data-seek]');
    if (it) seekReplay(it.dataset.seek);
  });
  $('#btn-replay-clear').addEventListener('click', () => {
    const c = replay.course || (state.live && state.live.course);
    if (!c) return;
    delete c.replay;
    const i = state.courses.findIndex((x) => x.id === c.id);
    if (i >= 0) { state.courses[i] = c; }
    markCourseDirty(c);             // ★ R02
    persistCourses();
    closeReplay();
    renderCourses();
    toast('已删除本节回放');
  });

  // 数字人视频
  const tbAv = $('#tb-avatar');
  if (tbAv) tbAv.addEventListener('click', openAvatarModal);
  $('#btn-avatar-close').addEventListener('click', () => { $('#avatar-modal').hidden = true; });
  $('#btn-avatar-cancel').addEventListener('click', () => { $('#avatar-modal').hidden = true; });
  $('#avatar-modal').addEventListener('click', (ev) => {
    if (ev.target === $('#avatar-modal')) $('#avatar-modal').hidden = true;
  });
  $('#btn-avatar-gen').addEventListener('click', generateAvatarVideo);
}

function bindCourseListEvents() {
  const guestLogin = $('#courses-guest-login');
  if (guestLogin) guestLogin.addEventListener('click', (ev) => {
    ev.preventDefault();
    openAuthModal();
  });
  const filterRow = $('#course-filter');
  if (filterRow) {
    filterRow.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-filter]');
      if (!chip) return;
      state.courseFilter = chip.dataset.filter;
      renderCourses();
    });
  }
  $('#course-list').addEventListener('click', (ev) => {
    const enter = ev.target.closest('[data-enter]');
    const regen = ev.target.closest('[data-regen]');
    const del = ev.target.closest('[data-del]');
    const slidesBtn = ev.target.closest('[data-slides]');
    const pptBtn = ev.target.closest('[data-ppt]');
    const mkBtn = ev.target.closest('[data-mkslides]');
    const replayBtn = ev.target.closest('[data-replay]');
    if (enter) {
      const c = state.courses.find((x) => x.id === enter.dataset.enter);
      if (c) enterLive(c);
    } else if (replayBtn) {
      const c = state.courses.find((x) => x.id === replayBtn.dataset.replay);
      if (c) openReplay(c);
    } else if (slidesBtn) {
      const c = state.courses.find((x) => x.id === slidesBtn.dataset.slides);
      if (c) openSlidePreview(c);
    } else if (pptBtn) {
      const c = state.courses.find((x) => x.id === pptBtn.dataset.ppt);
      if (c) exportPPTX(c, pptBtn);
    } else if (mkBtn) {
      const c = state.courses.find((x) => x.id === mkBtn.dataset.mkslides);
      if (!c) return;
      // requireModel 现在要等首次加载落地，用 IIFE 保持点击回调本身的非阻塞性
      (async () => {
        if (!(await requireModel())) return;
        mkBtn.disabled = true;
        mkBtn.textContent = '生成中…';
        const slides = await ensureSlides(c).catch(() => null);
        if (slides) {
          renderCourses();
          toast('课件已生成', 'ok');
          openSlidePreview(c);
        } else {
          mkBtn.disabled = false;
          mkBtn.textContent = '✨ 生成课件';
          toast('课件生成失败，请重试', 'err');
        }
      })();
    } else if (regen) {
      const c = state.courses.find((x) => x.id === regen.dataset.regen);
      if (c) { window.__lastGenerated = c; renderGenCourse(c); switchView('generate'); }
    } else if (del) {
      const id = del.dataset.del;
      const c = state.courses.find((x) => x.id === id);
      if (c && window.confirm('确定删除课程《' + c.title + '》吗？')) {
        state.courses = state.courses.filter((x) => x.id !== id);
        /* ★ R02：记墓碑。只删本地的话，下一次从云端拉取会把课程**复活**。 */
        markCourseDeleted(id);
        persistCourses();
        renderCourses();
        toast('已删除');
      }
    }
  });
}

/* ---------- 启动 ---------- */
/* 每个初始化步骤独立兜底：任一步失败都不影响其它步骤与后续事件绑定 */
function safeInit(label, fn) {
  try { fn(); } catch (e) {
    console.error('[init] ' + label + ' 失败:', e);
  }
}

/* 依赖兜底 / 按需加载：本地 vendor 缺失时（例如发布时漏带了 vendor 目录）从 CDN 补一份。
   ★ 为什么放在这里而不是 index.html 的内联 <script> 里：
   本页 CSP 是 `script-src 'self' https://cdn.jsdelivr.net`，**没有 'unsafe-inline'** ——
   内联脚本会被浏览器**静默拦掉**（我第一版就是这么写的，运行时控制台才发现，
   等于兜底从来没生效过）。放到这个外部文件里做：既不必放宽 CSP（那会开 XSS 口子），
   又能保证在需要时把库取回来。
   ★ 2026-09-24 起这里也承担 pptxgen 的**按需加载**：它 466KB，只为"导出 PPT"服务，
   而服务器不做 gzip，首屏多拉这么多会明显变慢、甚至在高延迟下超时。
   注入的 <script src> 指向 CSP 白名单内的 jsdelivr / 同源 vendor，都能正常加载。 */
const VENDOR_FALLBACK = [
  ['WorkBuddyCloud', 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@0.1.2-dev.1b37f73.202609222026/lib/index.global.js'],
  ['PptxGenJS', 'vendor/pptxgen.bundle.js'],
  ['PptxGenJS', 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'],
  /* ★ pdf.js **没有采用**：本机实测 jsdelivr / unpkg / cdnjs / npm registry
     全部 ETIMEDOUT 或 ECONNRESET（中国大陆访问这些 CDN 本就不稳），
     拿不到就没法验证 —— 不能把一个我验证不了的依赖挂上去当承诺。
     改为**自研 PDF 文本抽取**（见 extractPdfTextLocal）：
     零外部依赖、离线可用，浏览器原生 DecompressionStream 就能解 FlateDecode。
     A-Level / AP 的卷子是英文的，正好落在自研解析擅长的那一档。 */
];
/* ★ 关键：区分"启动必备"与"按需加载"。
   第一版我只把 pptxgen 从 index.html 挪走，却忘了 ensureVendors() 会检查**所有**依赖 ——
   而 init() 会调 ensureVendors()，于是 pptxgen 又在启动时被拉了回来（实测首屏仍见 466KB）。
   所以按需的那部分必须**点名才加载**：默认只保 WorkBuddyCloud。 */
const VENDOR_REQUIRED = ['WorkBuddyCloud'];
function ensureVendors(alsoNeed) {
  const want = VENDOR_REQUIRED.concat(Array.isArray(alsoNeed) ? alsoNeed : (alsoNeed ? [alsoNeed] : []));
  // 同一全局名有多条候选（本地优先、CDN 兜底）：逐个尝试，拿到就停
  const groups = {};
  VENDOR_FALLBACK.forEach(([g, url]) => {
    if (want.indexOf(g) < 0) return;
    (groups[g] = groups[g] || []).push(url);
  });
  const need = Object.keys(groups).filter((g) => !window[g]);
  if (!need.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    let left = need.length;
    const done = () => { left -= 1; if (left <= 0) resolve(true); };
    need.forEach((g) => {
      const urls = groups[g];
      const tryOne = (i) => {
        if (i >= urls.length) {
          try { console.warn('[boot] 依赖本地与 CDN 均不可用: ' + g); } catch (_) {}
          done();
          return;
        }
        if (window[g]) { done(); return; }
        const s = document.createElement('script');
        s.src = urls[i];
        s.async = false;
        s.onload = () => { window[g] ? done() : tryOne(i + 1); };   // 加载了但没挂上全局也算失败
        s.onerror = () => tryOne(i + 1);
        document.head.appendChild(s);
      };
      tryOne(0);
    });
    // 绝不因为第三方库卡住整个流程
    setTimeout(() => resolve(true), 8000);
  });
}

/* 开屏动画的收尾。
   ★ 关闭时机：init() 走完 → 立即收。云服务/模型目录是异步的，
     **不能拿它当"加载完成"的门槛**（慢网下会很晚）；"云服务未连接"
     本来就由右上角 #ai-status 如实显示，不在开屏里重复。
   ★ 兜底：即使这个函数从未被调用，CSS 里的 splash-auto-out 也会在 7 秒后淡出 ——
     这样 app.js 加载失败时也不会永久遮屏。 */
function hideSplash() {
  const el = $('#splash');
  if (!el || el.dataset.done) return;
  el.dataset.done = '1';
  el.classList.add('gone');
  // 动画结束后彻底移出文档流，避免它继续占着点击层
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 700);
}

/* 启动耗时诊断。
   起因：实测同一站点、同一个文件，加载耗时能在 2 秒到 90 秒+ 之间波动
   （静态服务器不做 gzip、单文件 400KB），但**我手上没有任何数据能说明影响面**。
   这里在明显偏慢时记一笔，便于判断这是不是普遍问题。
   只在超过 4 秒时才上报，避免污染埋点。 */
function reportBootTime() {
  try {
    const nav = (typeof performance !== 'undefined' && performance.timing)
      ? performance.timing : null;
    const ms = nav ? (nav.domContentLoadedEventEnd - nav.navigationStart) : 0;
    if (ms > 4000) track('boot_slow', { ms: Math.round(ms) });
  } catch (_) {}
}

/* 哪些学科才允许配图（2026-09-24，试了三版提示词之后的结论）
   ── 经过过程，记下来免得以后又走回头路：
   ① 用「至少 2 页要带图」的配额驱动 → 两门计算机科学课都硬配 5 张装饰图
      （数轴表示"循环次数"、函数图象表示"三步流程"）。
   ② 改成「默认不加图」 → 矫枉过正，连数学课都一张不画。
   ③ 改成「按知识点分类 → 配对应图」的映射 → 概念课仍然配 4 张，
      而且数学课也开始出现"什么是方程 → 条形图""等式性质 → 面积模型"这种装饰图。
   **结论：靠提示词劝阻无效。**模型只要知道有 figure 这个字段，就会为了"课件丰富"而配图。
   所以改成**工程手段**：不在白名单里的学科，提示词里根本不提 figure 字段 —— 模型无从输出。
   白名单只放"图形本身就是知识载体"的学科：数轴/函数图象/几何/面积模型是文字替代不了的；
   而计算机、语文、历史、英语这些概念类学科的配图**永远是装饰**（实测反例已列在规则里）。 */
const FIGURE_SUBJECTS = [
  '数学', '物理', '化学', '竞赛数学',
  'Mathematics', 'Further Math', 'Physics', 'Chemistry', 'AMC',
];
function figureAllowed(subject) {
  const s = String(subject || '');
  return FIGURE_SUBJECTS.some((k) => s.indexOf(k) >= 0);
}

/* 学科例子锚点（2026-09-24）
   为什么需要它：原来提示词只写了"多用生活化的例子"这种**软要求**，
   模型很容易退化成"小明买了 3 个苹果"这类**没有画面的空例子**。
   这里给每个学科一组具体、可感知的例子来源，把模型"锚"在真实场景上。
   ★ 匹配用 includes，容错中英文命名（"Computer Science 计算机科学"也能命中"计算机"）。
   ★ 顺序有意义：更具体的键放前面（"计算机"要在"数学"之前匹配不到才算，见下）。
   ============================================================ */
const SUBJECT_EXAMPLES = [
  ['计算机', '变量像"储物柜（贴了名字的格子）"、循环像"把同一件事重复做 N 次（洗牌/贴标签/列队报数）"、'
    + '数组像"一排信箱，按编号取信"、函数像"把一段流程打包成一个按钮，按一下就跑一遍"、'
    + '调试像侦探破案（先找复现条件、再缩小范围）、递归像"俄罗斯套娃/查字典时又遇到要查的词"、'
    + '排序像"整理一手扑克牌"、缓存像"把常用的书放在手边而不是每次跑图书馆"'],
  ['编程', '变量像储物柜、循环像重复贴标签、条件判断像"下雨就带伞"、'
    + '列表像一排信箱、函数像打包好的按钮、报错像"学校门口保安拦住你说哪儿不对"'],
  ['会计', '奶茶店一天的收入与成本、零花钱记账、压岁钱怎么记、开店进货与卖货的差额、'
    + '折旧像"手机用一年就不值原价了"、资产与负债像"你有的东西 vs 你欠别人的钱"、'
    + '利润表像"一个月下来到底赚了还是亏了"、现金流像"钱包里还剩多少能花"'],
  ['经济', '食堂涨价后的选择、奶茶第二杯半价、打车高峰加价、演唱会门票被炒、'
    + '通货膨胀像"同样的 100 块能买的东西变少了"'],
  ['商科', '校门口文具店的进货与定价、外卖平台的抽成、同类店铺为什么扎堆开'],
  ['数学', '购物找零与打折、路程与速度（骑车上学要多久）、分蛋糕与切披萨、'
    + '游戏伤害/血量的百分比计算、存款利息、地图上的比例尺'],
  ['物理', '刹车距离与车速、电梯里体重秤的读数、手机充电发热、'
    + '自行车为什么不会倒、洗衣机脱水桶、冬天摸铁比摸木头凉'],
  ['化学', '铁锅生锈、小苏打蒸馒头、洗洁精去油、汽水开瓶冒泡、电池为什么能放电'],
  ['生物', '为什么熬夜会困、疫苗怎么起作用、运动后为什么会酸、'
    + '植物的向光性、饭后血糖的变化'],
  ['语文', '一句歌词的修辞、广告语里的歧义、朋友圈文案的镜头感、新闻标题的用词取舍'],
  ['英语', '点餐/问路/网购退货的真实句型、影视剧里的一句话、'
    + '中英文语序差异造成的笑点'],
  ['历史', '同一个事件的两份史料说法不同、把你放到当时的位置上你会怎么选、'
    + '一件文物能推出什么'],
  ['地理', '为什么这里下雨那里晴、房价与地形/交通的关系、天气预报图怎么看、'
    + '同纬度为什么温差大'],
];

/* 生成阶段没有 course 对象（它要等大纲返回后才构造），但提示词需要"学科 + 学段"
   才能给出对的例子尺度 —— 这里从生成表单状态现取一份。
   （第一版我直接在 buildCourseOutlinePrompt() 里用了 course，
     而那是个无参函数、course 要等 streamChat 之后才定义 → 必然 ReferenceError。） */
function genSubjectContext() {
  const grade = ($('#gen-grade') || {}).value || '';
  return {
    subject: (state.gen && state.gen.subject) || '',
    grade: grade || (state.gen && state.gen.level) || '',
  };
}

/* 取出该门课适用的例子锚点（拼接成一行提示词片段） */
function subjectExampleHint(course) {
  const s = String((course && course.subject) || '');
  const hits = SUBJECT_EXAMPLES.filter(([k]) => s.indexOf(k) >= 0).map(([, v]) => v);
  return hits.join('；');
}

/* 按学段给出"例子该取自哪里"的尺度 —— 例子贴近学生才可能"生动" */
function exampleScaleHint(course) {
  const g = String((course && course.grade) || '');
  if (/小学|IGCSE|MYP/.test(g)) return '小学/低龄：用零食、玩具、游戏、动画、班级里的场景';
  if (/初中/.test(g)) return '初中：用游戏机制、体育比赛、零花钱、短视频、校园生活';
  if (/高中|AS|A2|DP|HKDSE|AP/.test(g)) return '高中：用考试分数、时间管理、兼职、手机与算法推荐、社会热点';
  if (/本科|研究生|大学|成人/.test(g)) return '大学/成人：用工作场景、真实数据、职业决策、行业案例、钱与时间成本';
  return '按学生学段选例子：年龄越小越用具体看得见的东西，越大越可以用真实场景与数据';
}

/* ============================================================
   自检程序（2026-09-25）
   为什么要有它：这段时间排查的问题（听不到老师、课件带图导出失败、SVG 缺 xmlns……）
   全都是「功能看着在、实际不出声/不出图/导不出」的**静默失败** ——
   用户只能看到"没反应"，而开发者（我）每次都要现场写探针才能定位。
   所以把这套检查固化进产品：一个按钮 + 一个可被外部脚本调用的函数。
   ★ 设计原则：
     · 只检查"能给出确定结论"的东西，不猜
     · 每项失败都要带**具体处理办法**，不能只说"失败"
     · 把踩过的坑做成检查项（例如"SVG 必须有 xmlns"）——这类回归最容易复发
     · 检查本身绝不能抛错：单项失败就记该项失败，继续跑完
   ============================================================ */
function checkupStorage() {
  try {
    const k = '__lx_check__';
    window.localStorage.setItem(k, '1');
    const v = window.localStorage.getItem(k);
    window.localStorage.removeItem(k);
    return v === '1';
  } catch (_) { return false; }
}

function runSelfCheck() {
  const items = [];
  const add = (id, name, ok, detail, fix) => items.push({
    id: id, name: name, ok: !!ok, detail: String(detail == null ? '' : detail), fix: fix || '',
  });
  const probe = (fn) => { try { return fn(); } catch (e) { return { __err: e && e.message }; } };

  /* ① 页面结构：关键节点在不在（漏一个就会"点了没反应"）
     ⚠ 只列 **index.html 里静态存在** 的节点。
     我第一版把 btn-go-live 也列了进来，而它是课程卡片渲染时**动态注入**的 ——
     页面初始状态下当然不存在，于是自检每次误报"缺少 1 个关键节点"。
     **自检误报比漏报更伤**：用户会不再信任它，真出问题时也不当回事。 */
  const needIds = ['view-home', 'view-generate', 'view-live', 'btn-generate',
    'tb-voice', 'chat-input', 'btn-send', 'gen-subjects', 'meet-board'];
  const missIds = needIds.filter((d) => !document.getElementById(d));
  add('dom', '页面结构', missIds.length === 0,
    missIds.length ? '缺少 ' + missIds.length + ' 个关键节点：' + missIds.join('、') : '关键节点齐全',
    '多为资源未加载完或版本不一致，刷新页面重试；仍不行请清缓存');

  /* ② 语音：老师能不能出声（最常被投诉的一项） */
  const tts = probe(() => (typeof ttsHealth === 'function' ? ttsHealth() : null));
  if (!tts || tts.__err) {
    add('tts', '语音朗读', false, '检查自身出错：' + (tts && tts.__err), '刷新页面重试');
  } else if (tts.reason === 'unsupported') {
    add('tts', '语音朗读', false, '当前浏览器不支持语音合成',
      '换 Chrome 或 Edge 打开；老师会以字幕方式讲课');
  } else if (tts.reason === 'no_voice') {
    add('tts', '语音朗读', false, '这台设备没有安装任何语音包',
      'Windows：设置 → 时间和语言 → 语音 → 添加中文语音；或直接用 Edge 打开');
  } else if (tts.reason === 'no_zh') {
    add('tts', '语音朗读', true, '有 ' + tts.count + ' 个语音，但没有中文语音（读中文会不自然）',
      '建议在系统里补装中文语音包，音色会自然很多');
    } else {
      /* ★ 2026-09-28：这里**只能**确认"引擎可用"，确认不了"用户听得到"。
         引擎报告念完了、但用户因系统音量/iPhone 静音开关/标签页静音而听不到时，
         这几项静态检查会**全绿** —— 用户却什么都没听见（这正是投诉里最难缠的一类）。
         所以这里主动把用户指向课堂里那个"会真念一句并问你听到没有"的实测自检。 */
      add('tts', '语音朗读', true, '可用，共 ' + tts.count + ' 个语音（含中文）'
        + (TTS.enabled ? '，当前为开启' : '，当前被关闭'),
        (TTS.enabled ? '' : '点右下角「语音」按钮即可打开。')
        + '若你实际听不到声音，进课堂后点「🔇 没听到老师的声音？点这里自检」做一次实测'
        + '（会真念一句并问你听到没有）—— 上面几项只能确认引擎可用，确认不了你的设备有没有出声');
    }
  // 朗读队列是否卡死（之前"永久静音"就是这个状态：speaking=true 但队列不动）
  add('tts-queue', '朗读队列', !(TTS.speaking && !TTS.queue.length && !TTS._speakingNow),
    TTS.speaking ? ('正在朗读，队列剩 ' + TTS.queue.length + ' 条') : '空闲',
    '若上方显示"正在朗读"但实际没声音，点右下角「语音」按钮关掉再打开即可复位');

    /* ③ 云服务 */
    const cloudOk = !!state.cloud;
    add('cloud', '云端连接', cloudOk,
      cloudOk ? '已连接（AI 可用）' : '未连接（生成课程与直播课不可用）',
      '检查网络后刷新页面；若反复失败，可能是云端服务暂时不可用');

    /* ③b ★ 身份与门禁（2026-09-28 加）
       由来：用户反复反馈"要登录才能用"，而我按代码与实测都复现不出对**访客**的登录要求
       （`needsPhone()` 里明确写着"访客不是账号，不拦"）。说明用户遇到的多半是
       **已登录但没登记手机号**那个状态，或者他的浏览器里还有别的门禁在起作用。
       与其继续猜，不如把"当前身份 + 到底哪道门会拦你"直接显示出来 ——
       这类"为什么又要我登录"的问题以后不用再靠问。 */
    const acc = (() => {
      /* ★ 2026-09-29 修：这段文案原来写的是「不需要登录也不需要手机号就能生成课程、进直播间」——
         那是**旧策略**（还允许游客）。现在产品明确"未登录不允许跑"，这段话会在自检报告里
         自相矛盾地告诉用户"不用登录也能用"。改成如实描述当前门禁。 */
      if (!state.user) return { id: 'guest', label: '访客（未登录）', needPhone: false, detail: '未登录会被登录门禁拦住（登录界面弹出并锁住）—— 生成课程 / 进直播间都必须先登录。登录后额外获得跨设备长期记忆' };
      const phone = (typeof currentPhone === 'function') ? currentPhone() : '';
      const hasEmail = !!state.user.email;
      const need = (function () { try { return needsPhone(); } catch (_) { return false; } })();
      /* 邮箱只显示前两位 + 域名，避免自检报告被截图转发时带出完整邮箱。
         （不引入新的脱敏工具函数 —— 就地做，少一个可能写错的名字。） */
      const emailHint = hasEmail
        ? (String(state.user.email).replace(/^(.{1,2})[^@]*(@.*)$/, '$1***$2'))
        : '';
      return {
        id: 'signed',
        label: hasEmail ? ('已登录（邮箱 ' + emailHint + '）') : '已登录',
        needPhone: need,
        detail: need
          ? '已登录但**还没登记手机号** → 点「生成课程」或「进入课堂」会被手机号门禁拦住（这是要你登记，不是要你登录）'
          : ('已登记手机号 ' + (phone ? phone : '(读取中)') + '；各功能均可使用'),
      };
    })();
    add('account', '身份与门禁', !acc.needPhone, acc.label + '｜' + acc.detail,
      acc.needPhone ? '在「学习档案」里补登记手机号即可（不需要验证码），补完就能继续生成课程/进课堂' : '');

    /* ③c AI 用量（本地闸门，按设备计数；每次生成/对话都消耗） */
    const gate = (function () { try { return aiGateSnapshot(); } catch (_) { return null; } })();
    if (gate) {
      const left = Math.max(0, (gate.limit || 0) - (gate.used || 0));
      add('aigate', 'AI 用量（本机）', left > 0,
        '今天已用 ' + (gate.used || 0) + '/' + (gate.limit || 0) + ' 次' + (left > 0 ? ('，还剩 ' + left + ' 次') : '，今天已用完（明天自动恢复）'),
        left > 0 ? '' : '这是防额度过快消耗的本地上限；明天会自动恢复，已生成的课程与数据都还在');
    }

  /* ④ 本地存储：未登录时课程只存在本机，写不进去等于"刷新就没了" */
  add('storage', '本地存储', checkupStorage(),
    checkupStorage() ? '可正常读写' : '无法写入（浏览器隐私模式或空间已满）',
    '未登录时课程只保存在本机 —— 写不进去会丢失；请退出隐私模式或清理一些空间');

  /* ⑤ 图示渲染 + ★ 独立加载能力（把之前踩过的 xmlns 坑做成检查项） */
  const figKind = probe(() => {
    const svg = figureSVG({ kind: 'bars', title: '自检', items: [{ label: '甲', value: 3 }, { label: '乙', value: 5 }] });
    return { svg: svg, hasXmlns: /xmlns\s*=/.test(svg || '') };
  });
  if (!figKind || figKind.__err) {
    add('figure', '课件图示', false, '生成图示时出错：' + (figKind && figKind.__err), '刷新页面重试');
  } else {
    add('figure', '课件图示', !!figKind.svg && figKind.hasXmlns,
      figKind.svg ? (figKind.hasXmlns ? '可生成，且带 xmlns（可独立导出/转图片）' : '可生成，但缺少 xmlns')
        : '未能生成 SVG',
      '缺 xmlns 会导致导出的 PPT 里插图失败（实测过），需要修复 figureSVG');
  }

  /* ⑥ 导出组件：**未加载不算失败** —— 它是按需加载的（466KB，不该为首屏拖慢）。
     只有"用户在本次会话里已经触发过导出、却仍然没加载上"才算问题。 */
  const pptTried = !!state._pptTried;
  const pptLoaded = !!(window.PptxGenJS || (window.pptxgen && window.pptxgen.default));
  add('ppt', 'PPT 导出组件', pptLoaded || !pptTried,
    pptLoaded ? '已加载，可直接导出'
      : (pptTried ? '本次已尝试导出但组件没加载上' : '尚未加载（按需加载，首次点导出时自动获取，属正常）'),
    '若点导出提示"组件加载失败"，多为网络拦截，请确认能访问 vendor 目录与 cdn.jsdelivr.net');

  /* ⑦ 提示词可构造：生成/讲课都依赖它，构造失败就等于功能不可用 */
  const prompts = probe(() => {
    const a = typeof courseSystemPrompt === 'function' ? courseSystemPrompt() : '';
    const b = typeof teacherSystemPrompt === 'function'
      ? teacherSystemPrompt({ subject: '数学', grade: '小学', system: 'cn', title: '自检', outline: {}, slides: [] })
      : '';
    return { a: a, b: b };
  });
  add('prompt', '课程生成逻辑', !prompts.__err && prompts.a && prompts.b,
    prompts.__err ? '构造提示词出错：' + prompts.__err
      : ('大纲提示词 ' + String(prompts.a || '').length + ' 字 / 讲课提示词 ' + String(prompts.b || '').length + ' 字'),
    '这是程序内部错误，请反馈（附上本页自检结果）');

  /* ⑧ 已存课程的数据完整性（结构坏了会在上课时才崩） */
  const courses = (state.courses || []);
  const badCourses = courses.filter((c) => !c || !c.title || !Array.isArray(c.slides));
  add('data', '已存课程数据', badCourses.length === 0,
    courses.length ? ('共 ' + courses.length + ' 门' + (badCourses.length ? '，其中 ' + badCourses.length + ' 门结构异常' : '，结构均正常')) : '本机还没有课程',
    badCourses.length ? '异常课程无法正常上课，可在「我的课程」里删除后重新生成' : '');

  /* ⑨ 课件质量：检查最近一门课的课件有没有例子/图形/练习解析
     —— 功能能跑 ≠ 课件好用，这一项专门盯"拿到手的课件是否像样" */
  const latest = courses.filter((c) => c && Array.isArray(c.slides) && c.slides.length)[0];
  if (!latest) {
    add('courseware', '课件质量', true, '本机还没有课件可检查', '');
  } else {
    const q = probe(() => validateCourseware(latest));
    if (q.__err) {
      add('courseware', '课件质量', false, '校验自身出错：' + q.__err, '请反馈（附上本页自检结果）');
    } else {
      const errs = (q.issues || []).filter((x) => x.level === 'error');
      const warns = (q.issues || []).filter((x) => x.level === 'warn');
      add('courseware', '课件质量', errs.length === 0,
        '「' + String(latest.title || '').slice(0, 16) + '」' + q.stats.pages + ' 页 · 内容 ' + q.stats.contents +
        ' 页 · 练习 ' + q.stats.quizzes + ' 道 · 图 ' + q.stats.figures + ' 张 · 有例子的页 ' + q.stats.examplePages +
        (errs.length ? '｜缺：' + errs.map((x) => x.label).join('、') : '')
        + (warns.length ? '｜建议：' + warns.map((x) => x.label).join('、') : ''),
        errs.length ? (errs[0].fix || '重新生成课程，并把学习目标写得更具体') : '');
    }
  }

  const failed = items.filter((x) => !x.ok);
  return {
    ok: failed.length === 0,
    ts: new Date().toISOString(),
    items: items,
    failed: failed.length,
    ua: (function () { try { return navigator.userAgent.slice(0, 160); } catch (_) { return ''; } })(),
  };
}

/* 自检结果展示与入口（runSelfCheck 见下方"自检程序"一节） */
function renderCheckup(rep) {
  const box = $('#checkup-list');
  const sum = $('#checkup-sum');
  if (!box) return;
  box.innerHTML = rep.items.map((it) => (
    '<div class="checkup-item ' + (it.ok ? 'good' : 'bad') + '">' +
      '<span class="ck-ico">' + (it.ok ? '✅' : '❌') + '</span>' +
      '<div class="ck-main">' +
        '<div class="ck-name">' + esc(it.name) + '</div>' +
        (it.detail ? '<div class="ck-detail">' + esc(it.detail) + '</div>' : '') +
        (!it.ok && it.fix ? '<div class="ck-fix">→ ' + esc(it.fix) + '</div>' : '') +
      '</div>' +
    '</div>'
  )).join('');
  if (sum) {
    sum.textContent = rep.ok
      ? ('全部 ' + rep.items.length + ' 项检查通过，这台设备可以正常上课。')
      : ('发现 ' + rep.failed + ' 项问题（共 ' + rep.items.length + ' 项），请按上面的提示处理；'
        + '若处理后仍不正常，可点「复制结果」把这份报告发给我们。');
  }
}

function openCheckup() {
  const modal = $('#checkup-modal');
  if (!modal) return;
  modal.hidden = false;
  try { renderCheckup(runSelfCheck()); } catch (e) {
    try { console.warn('[checkup] 自检失败', e); } catch (_) {}
  }
}

function bindCheckupEvents() {
  const modal = $('#checkup-modal');
  if (!modal) return;
  const open = $('#btn-checkup-open');
  if (open) open.addEventListener('click', () => {
    // 从声音设置直接进自检：先把声音设置收起来，避免两个弹窗叠着
    const vm = $('#voice-modal');
    if (vm) vm.hidden = true;
    openCheckup();
  });
  const close = () => { modal.hidden = true; };
  const c1 = $('#btn-checkup-close'); if (c1) c1.addEventListener('click', close);
  const c2 = $('#btn-checkup-ok'); if (c2) c2.addEventListener('click', close);
  const run = $('#btn-checkup-run');
  if (run) run.addEventListener('click', () => {
    try { renderCheckup(runSelfCheck()); toast('已重新检查', 'ok'); } catch (_) {}
  });
  const copy = $('#btn-checkup-copy');
  if (copy) copy.addEventListener('click', () => {
    let text = '';
    try {
      const rep = runSelfCheck();
      text = '灵犀课堂 · 自检报告\n时间：' + new Date().toLocaleString() + '\n'
        + '结论：' + (rep.ok ? '全部通过' : ('发现 ' + rep.failed + ' 项问题')) + '\n\n'
        + rep.items.map((it) => (it.ok ? '✅ ' : '❌ ') + it.name + '：' + it.detail
            + (!it.ok && it.fix ? ('（建议：' + it.fix + '）') : '')).join('\n')
        + '\n\n浏览器：' + rep.ua;
    } catch (_) { text = '自检报告生成失败'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('自检结果已复制，可直接粘贴发给我们', 'ok'))
        .catch(() => toast('复制失败，请手动截图', 'err'));
    } else {
      toast('当前浏览器不支持自动复制，请手动截图', 'err');
    }
  });
  // 点遮罩关闭
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
}

/* ============================================================
   护眼模式（2026-09-25）
   定位：**暖色纸感**而不是深色模式 —— 中文语境下（尤其教育类产品）"护眼"指的是
   背景调暖、降低蓝光与刺眼感；把界面变黑是另一件事（深色模式）。
   实现方式：<html data-theme="eye"> 切换 + CSS 变量/定向覆盖（见 style.css 顶部说明）。
   为什么不用全局 filter 做（指 html/body 根级）：`filter` 会为 fixed 定位元素创建新的包含块，
   直播间的底部工具栏、各种弹窗遮罩都可能因此错位 —— 那是真事故。
   （**叶子元素**上为柔化单点使用 filter 是安全的，例如 .s-ico 降饱和 —— 它只含文字。）
   变量的代价是"要盯覆盖面"，而这个我可以用扫描器量化（见 tools 里的主题扫描脚本）。
   ============================================================ */
const THEME_KEY = 'lingxi_theme';

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'eye' ? 'eye' : 'day';
}

function applyTheme(t) {
  const theme = t === 'eye' ? 'eye' : 'day';
  if (theme === 'eye') document.documentElement.setAttribute('data-theme', 'eye');
  else document.documentElement.removeAttribute('data-theme');
  // 同步开关外观（桌面 + 移动两个入口）
  const on = theme === 'eye';
  [['#btn-theme', '.theme-ico', '.theme-label'], ['#btn-theme-m', null, null]].forEach(([sel, ico, lb]) => {
    const btn = $(sel);
    if (!btn) return;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('active', on);
    if (ico && lb) {
      const i = btn.querySelector(ico);
      const l = btn.querySelector(lb);
      if (i) i.textContent = on ? '☀️' : '🍵';
      if (l) l.textContent = on ? '日间' : '护眼';
    } else {
      btn.textContent = on ? '☀️ 日间模式' : '🍵 护眼模式';
    }
  });
  // 手机浏览器地址栏配色跟着变（不然暖色页面配一条冷白状态栏会很割裂）
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', on ? '#EFE8DA' : '#F6F7FB');
}

function setTheme(t) {
  const theme = t === 'eye' ? 'eye' : 'day';
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  return theme;
}

function toggleTheme() {
  const next = currentTheme() === 'eye' ? 'day' : 'eye';
  setTheme(next);
  toast(next === 'eye' ? '已开启护眼模式（暖色纸感）' : '已切回日间模式', 'ok');
}

function loadTheme() {
  let saved = '';
  try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (_) {}
  // 老用户没选过就保持默认日间：护眼模式属于"用户偏好"，不该替用户决定
  applyTheme(saved === 'eye' ? 'eye' : 'day');
}

function bindThemeEvents() {
  const a = $('#btn-theme');
  if (a) a.addEventListener('click', toggleTheme);
  const b = $('#btn-theme-m');
  if (b) b.addEventListener('click', () => {
    toggleTheme();
    const mn = $('#mobile-nav');
    if (mn) mn.hidden = true;          // 点完顺手收起移动导航
  });
}

/* ============================================================
   家长学情报告（2026-09-25）
   为什么做：和学而思对比后最刺眼的一条是 —— 他们每个学员有个辅导老师，
   "每周给家长出学情报告、作业全批全改"，家长**始终看得见**；
   而我们下课那一刻，和家长的关系就断了。学生上完课，家长什么也收不到。
   这是"付费决策者看不到价值"的致命缺口。

   ★ 设计取舍：
   · **不做家长端 App**（那是另一个量级）—— 先做"一页能发给家长的东西"。
   · 三个出口，覆盖家长的真实收件场景（微信）：
       ① 站内预览（家长若在旁边可以直接看）
       ② 复制文本（粘到微信对话框，最轻）
       ③ **下载长图**（微信里发图最自然，且不会被截断、不依赖网络）
   · 长图用 **canvas 手绘**，不引第三方库（html2canvas 体积大、且对 CSS 支持不稳）。
   · 数据全部来自已有的课堂小结 / 上课记录 —— **不需要新采集、不动课堂流程**。
   ============================================================ */

/* 把"小结"或"上课记录"统一成报告数据（两种来源字段名不同，这里做归一化） */
function buildParentReport(src, opt) {
  const s = src || {};
  const o = opt || {};
  const arr = (x) => (Array.isArray(x) ? x.filter((v) => String(v == null ? '' : v).trim()).map(String) : []);
  const mins = Math.round((Number(s.duration_secs || s.durationSecs || 0)) / 60);
  const when = s.created_at ? new Date(s.created_at) : new Date();
  return {
    title: String(s.course_title || s.courseTitle || o.title || '本节课').trim(),
    subject: String(s.subject || o.subject || '').trim(),
    grade: String(s.grade || o.grade || '').trim(),
    minutes: mins,
    date: when.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
    mastered: arr(s.mastered),
    weak: arr(s.weak_points || s.weakPoints),
    homework: arr(s.homework),
    comment: String(s.comment || '').trim(),
    causes: cleanErrorCauses(s.error_causes || s.errorCauses),
    cards: Array.isArray(s.cards) ? s.cards.filter((c) => c && (c.q || c.a)).slice(0, 6) : [],
    plan: arr(s.review_plan || s.reviewPlan),
    brand: '灵犀课堂 · AI 一对一直播课',
  };
}

/* 纯文本版：家长粘到微信里就能看，不依赖任何东西打开 */
function parentReportText(r) {
  const L = [];
  L.push('【' + r.title + '】课堂学情报告');
  L.push(r.date + (r.subject ? ' · ' + r.subject : '') + (r.grade ? ' · ' + r.grade : '') +
    (r.minutes ? ' · 上课 ' + r.minutes + ' 分钟' : ''));
  L.push('');
  if (r.mastered.length) { L.push('✅ 这节课已经掌握'); r.mastered.forEach((x) => L.push('  · ' + x)); L.push(''); }
  if (r.weak.length) { L.push('📌 还需要巩固'); r.weak.forEach((x) => L.push('  · ' + x)); L.push(''); }
  if (r.causes.length) {
    L.push('🔍 出错在哪、为什么（比"错了"更重要）');
    r.causes.forEach((c) => {
      const k = ERROR_CAUSES[c.cause] || ERROR_CAUSES.other;
      L.push('  · [' + k.label + ']' + (c.topic || '') + (c.ifWrong ? '：' + c.ifWrong : ''));
      const fix = c.fix || k.action;
      if (fix) L.push('      → ' + fix);
    });
    L.push('');
  }
  if (r.homework.length) { L.push('✏️ 课后作业'); r.homework.forEach((x) => L.push('  · ' + x)); L.push(''); }
  if (r.plan.length) { L.push('🔁 建议复习节奏'); r.plan.forEach((x, i) => L.push('  ' + (i + 1) + '. ' + x)); L.push(''); }
  if (r.comment) { L.push('👩‍🏫 老师的话'); L.push('  ' + r.comment); L.push(''); }
  L.push('—— ' + r.brand);
  return L.join('\n');
}

/* 长图版：微信里发图片最自然。canvas 手绘，含自动换行与分区配色。 */
function parentReportImage(r) {
  const W = 750, PAD = 44, FONT = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext ? cvs.getContext('2d') : null;
  /* 拿不到 2D 上下文时给出**明确**的失败信息，而不是让后面 measureText 抛
     "Cannot set properties of null (setting 'font')" 这种看不懂的错。
     （无 canvas 的环境确实存在：jsdom、部分低端浏览器/隐私模式。） */
  if (!ctx) throw new Error('当前环境不支持画布绘制，无法生成长图，请改用「复制文字」');
  // 先把要画的"块"排好，再按总高建画布（两遍：先量高，再绘制）
  const blocks = [];
  const push = (t, kind, color) => { if (String(t == null ? '' : t).trim()) blocks.push({ t: String(t), kind: kind, color: color }); };
  push(r.title, 'h1'); push([r.date, r.subject, r.grade, r.minutes ? '上课 ' + r.minutes + ' 分钟' : ''].filter(Boolean).join(' · '), 'meta');
  push('这节课已经掌握', 'h2', '#15803D'); r.mastered.forEach((x) => push('· ' + x, 'li', '#166534'));
  push('还需要巩固', 'h2', '#B45309'); r.weak.forEach((x) => push('· ' + x, 'li', '#92400E'));
  if (r.causes.length) {
    push('出错在哪、为什么', 'h2', '#4F46E5');
    r.causes.forEach((c) => {
      const k = ERROR_CAUSES[c.cause] || ERROR_CAUSES.other;
      push('【' + k.label + '】' + (c.topic || '') + (c.ifWrong ? '　' + c.ifWrong : ''), 'li', '#3730A3');
      // 家长最需要的是"我能做什么" —— 把补法带上，报告才有行动价值
      const fix = c.fix || k.action;
      if (fix) push('　→ ' + fix, 'li', '#059669');
    });
  }
  push('课后作业', 'h2', '#0F766E'); r.homework.forEach((x) => push('· ' + x, 'li', '#115E59'));
  if (r.plan.length) { push('建议复习节奏（间隔重复）', 'h2', '#7C3AED'); r.plan.forEach((x, i) => push((i + 1) + '. ' + x, 'li', '#5B21B6')); }
  if (r.comment) { push('老师的话', 'h2', '#BE185D'); push(r.comment, 'p', '#831843'); }

  ctx.font = '400 15px ' + FONT;
  const wrap = (text, font, size, maxW) => {
    ctx.font = font;
    const lines = [];
    let cur = '';
    for (const ch of String(text)) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else { cur += ch; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };
  const STYLE = {
    h1: { font: '700 26px ' + FONT, size: 26, lh: 38, gapTop: 0, gapBot: 6, color: '#1D2130' },
    meta: { font: '400 14px ' + FONT, size: 14, lh: 22, gapTop: 0, gapBot: 22, color: '#6B7186' },
    h2: { font: '700 17px ' + FONT, size: 17, lh: 26, gapTop: 20, gapBot: 8, color: null },
    li: { font: '400 15.5px ' + FONT, size: 15.5, lh: 25, gapTop: 0, gapBot: 3, color: null },
    p: { font: '400 15.5px ' + FONT, size: 15.5, lh: 26, gapTop: 0, gapBot: 6, color: null },
  };
  // 第一遍：算高度，并把换行结果缓存下来
  let h = PAD;
  const laid = [];
  blocks.forEach((b) => {
    const st = STYLE[b.kind] || STYLE.p;
    h += st.gapTop;
    const lines = wrap(b.t, st.font, st.size, W - PAD * 2 - (b.kind === 'li' ? 10 : 0));
    laid.push({ b: b, st: st, lines: lines });
    h += lines.length * st.lh + st.gapBot;
  });
  h += 26 + 30 + PAD;

  cvs.width = W; cvs.height = Math.round(h);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  // 顶部品牌条
  ctx.fillStyle = '#5B5CE6';
  ctx.fillRect(0, 0, W, 6);

  let y = PAD;
  laid.forEach((it) => {
    const st = it.st, b = it.b;
    y += st.gapTop;
    ctx.fillStyle = b.color || st.color || '#1D2130';
    ctx.font = st.font;
    ctx.textBaseline = 'top';
    it.lines.forEach((ln) => {
      const x = b.kind === 'li' ? PAD + 8 : PAD;
      ctx.fillText(ln, x, y);
      y += st.lh;
    });
    // 正文小灰底分隔（给"老师的话"一点重量）
    if (b.kind === 'p') {
      y += 2;
    }
    y += st.gapBot;
  });
  // 页脚
  ctx.fillStyle = '#9AA0B4';
  ctx.font = '400 13px ' + FONT;
  ctx.fillText(r.brand, PAD, y + 6);
  ctx.textAlign = 'right';
  ctx.fillText('由 AI 生成 · 请结合孩子实际情况参考', W - PAD, y + 6);
  ctx.textAlign = 'left';
  return cvs;
}

/* 报告弹窗：预览 + 三种出口 */
let _parentReport = null;
function openParentReport(src, opt) {
  let r;
  try { r = buildParentReport(src, opt); } catch (_) { r = null; }
  if (!r) { toast('报告生成失败', 'err'); return; }
  _parentReport = r;
  const modal = $('#parent-report-modal');
  if (!modal) { toast('报告界面缺失', 'err'); return; }
  const list = (arr, cls) => (arr && arr.length)
    ? '<ul class="pr-list ' + (cls || '') + '">' + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '';
  const causes = r.causes.length ? '<div class="pr-sec"><h4>🔍 出错在哪、为什么</h4>' +
    '<p class="pr-hint">知道"为什么错"才有用 —— 不同原因要用完全不同的补法。</p>' +
    '<ul class="pr-list">' + r.causes.map((c) => {
      const k = ERROR_CAUSES[c.cause] || ERROR_CAUSES.other;
      const fix = c.fix || k.action;
      return '<li><b>' + esc(k.icon + ' ' + k.label) + '</b>　' + esc(c.topic || '') +
        (c.ifWrong ? '<br><span class="pr-sub">' + esc(c.ifWrong) + '</span>' : '') +
        (fix ? '<br><span class="pr-fix">👉 ' + esc(fix) + '</span>' : '') + '</li>';
    }).join('') + '</ul></div>' : '';
  $('#parent-report-body').innerHTML =
    '<div class="pr-head"><h3>' + esc(r.title) + '</h3><p class="pr-meta">' +
      esc([r.date, r.subject, r.grade, r.minutes ? '上课 ' + r.minutes + ' 分钟' : ''].filter(Boolean).join(' · ')) + '</p></div>' +
    (r.mastered.length ? '<div class="pr-sec"><h4>✅ 这节课已经掌握</h4>' + list(r.mastered) + '</div>' : '') +
    (r.weak.length ? '<div class="pr-sec"><h4>📌 还需要巩固</h4>' + list(r.weak) + '</div>' : '') +
    causes +
    (r.homework.length ? '<div class="pr-sec"><h4>✏️ 课后作业</h4>' + list(r.homework) + '</div>' : '') +
    (r.plan.length ? '<div class="pr-sec"><h4>🔁 建议复习节奏</h4><ol class="pr-plan">' +
      r.plan.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol></div>' : '') +
    (r.comment ? '<div class="pr-comment"><b>👩‍🏫 老师的话</b><p>' + esc(r.comment) + '</p></div>' : '') +
    '<p class="pr-foot">— ' + esc(r.brand) + '　·　由 AI 生成，请结合孩子实际情况参考</p>';
  modal.hidden = false;
  try { track('parent_report_open', { subject: r.subject.slice(0, 20), mins: r.minutes }); } catch (_) {}
}

function bindParentReportEvents() {
  const modal = $('#parent-report-modal');
  if (!modal) return;
  const close = () => { modal.hidden = true; };
  const c1 = $('#btn-parent-report-close'); if (c1) c1.addEventListener('click', close);
  const c2 = $('#btn-parent-report-ok'); if (c2) c2.addEventListener('click', close);
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });

  const copy = $('#btn-parent-report-copy');
  if (copy) copy.addEventListener('click', () => {
    if (!_parentReport) return;
    const text = parentReportText(_parentReport);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('已复制，可直接粘贴到微信发给家长', 'ok'))
        .catch(() => toast('复制失败，请用「下载长图」', 'err'));
    } else { toast('当前浏览器不支持自动复制，请用「下载长图」', 'err'); }
    try { track('parent_report_copy', {}); } catch (_) {}
  });

  const img = $('#btn-parent-report-img');
  if (img) img.addEventListener('click', () => {
    if (!_parentReport) return;
    try {
      const cvs = parentReportImage(_parentReport);
      const name = '灵犀课堂-学情报告-' + String(_parentReport.date).replace(/[年月]/g, '-').replace('日', '') + '.png';
      cvs.toBlob((blob) => {
        if (!blob) { toast('长图生成失败', 'err'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 4000);
        toast('长图已开始下载，发到微信给家长即可', 'ok');
      }, 'image/png');
      try { track('parent_report_image', { h: cvs.height }); } catch (_) {}
    } catch (e) { toast('长图生成失败：' + (e.message || ''), 'err'); }
  });
}

/* ============================================================
   真题库（2026-09-25）
   用户提出"A-Level 能不能上网找真题来做，单开一个真题库"。
   先查了版权，结论**决定了这个功能只能怎么做**：

   ★ Cambridge International 官方帮助页原话：
     "we do not grant permission for the use of complete examination papers,
      nor do we grant permission for electronic publication, in any format,
      of questions from past examination papers"
     —— 不授权整卷使用、**也不授权以任何形式电子发布真题**；复制还要按题量付费
     （£200~400/次）且仍不批电子版。只有剑桥学校老师可在校内下载打印给学生。
   ★ AQA / Pearson Edexcel / OCR 则**官方免费公开**真题与 Mark Scheme。
   ★ AP（College Board）公开**近三年 FRQ 真题 + 评分标准 + 学生范文**。
   ★ IB 不公开，需通过学校。
   ★ 业内成熟做法（PMT Education、Maths Genie、gcsemathsai 等）高度一致：
     **自己不托管真题，只链到考试局官方** + **自己写"原创练习卷"并明确标注"非真题"**。

   所以这个"真题库"是**索引 + 官方入口 + 考点导航**，而不是把真题搬进我们网站：
     · 我们**不托管、不复制、不改编**任何考题内容
     · 只提供：考试局 / 科目 / 试卷代码 / 官方获取入口 / 考点说明
     · 我们能自己产出的部分是 **AI 按该卷规格生成"同构练习"**（明确标注非真题）——
       这既合规，也比"重做原题"更有训练价值（学生会背答案，但背不了新题）
   ★ 下面每条 url 都是**实测可达**才写进来的（见 _authtest/check-exam-urls*.js）。
     实测中 AQA 计算机 7517 返回 404，已舍弃；另有几条会 timeout，
     但同一条 URL 在不同批次结果不同（如 OCR 数学 H240 一次 200 一次 timeout），
     说明 timeout 不能当死链 —— 不要因为超时就删掉可用入口。
   ============================================================ */
const EXAM_ACCESS = {
  public: { label: '官方免费公开', cls: 'ok', note: '考试局官网可免费下载试卷与评分标准' },
  school: { label: '需通过学校获取', cls: 'warn', note: '考试局不向第三方电子分发，真题经学校 / 官方教师平台发放' },
};
const EXAM_LIBRARY = [
  // ---- Cambridge International (CAIE)：科目页公开，真题需学校账号 ----
  { board: 'Cambridge International', system: 'A-Level', subject: '数学', code: '9709', access: 'school',
    papers: 'Paper 1 纯数1 / Paper 3 纯数3 / Paper 4 力学 / Paper 5 概率统计',
    topics: '代数、对数与指数、三角、微分积分、力学、概率统计',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-mathematics-9709/' },
  { board: 'Cambridge International', system: 'A-Level', subject: '物理', code: '9702', access: 'school',
    papers: 'Paper 1 选择 / Paper 2 AS 结构化 / Paper 4 A2 结构化 / Paper 5 实验',
    topics: '力学、波、电学、场、热物理、核物理、实验设计与误差分析',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-physics-9702/' },
  { board: 'Cambridge International', system: 'A-Level', subject: '化学', code: '9701', access: 'school',
    papers: 'Paper 1 选择 / Paper 2 AS 结构化 / Paper 4 A2 结构化 / Paper 5 实验',
    topics: '原子结构、化学键、有机合成路线、焓变与熵、平衡与速率、滴定计算',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-chemistry-9701/' },
  { board: 'Cambridge International', system: 'A-Level', subject: '生物', code: '9700', access: 'school',
    papers: 'Paper 1 选择 / Paper 2 AS 结构化 / Paper 4 A2 结构化 / Paper 5 实验',
    topics: '细胞结构与分裂、运输、酶、遗传与进化、生态、实验设计',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-biology-9700/' },
  { board: 'Cambridge International', system: 'A-Level', subject: '经济', code: '9708', access: 'school',
    papers: 'Paper 1 选择 / Paper 2 数据回应 / Paper 3 选择 / Paper 4 论述',
    topics: '价格机制、市场失灵、宏观政策、国际收支、经济发展',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-economics-9708/' },
  { board: 'Cambridge International', system: 'A-Level', subject: '计算机科学', code: '9618', access: 'school',
    papers: 'Paper 1 理论 / Paper 2 问题解决与编程 / Paper 3 进阶理论 / Paper 4 实践',
    topics: '数据表示、处理器与指令、算法与数据结构、数据库、面向对象编程',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-computer-science-9618/' },

  // ---- Pearson Edexcel：官方公开 ----
  { board: 'Pearson Edexcel', system: 'A-Level', subject: '数学（International A Level）', code: 'WMA / WME 系列', access: 'public',
    papers: 'P1~P4 纯数 / S1~S2 统计 / M1~M2 力学 / FP 进阶纯数',
    topics: '代数与函数、数列、三角恒等变换、微分积分、统计分布、动力学',
    url: 'https://qualifications.pearson.com/en/qualifications/edexcel-international-advanced-levels/mathematics.html' },
  { board: 'Pearson Edexcel', system: 'A-Level', subject: '全科真题总入口', code: '各科', access: 'public',
    papers: '按科目 → 按考季筛选（含 Mark Scheme）', topics: '全部科目',
    url: 'https://qualifications.pearson.com/en/support/support-topics/exams/past-papers.html' },

  // ---- AQA：官方公开 ----
  { board: 'AQA', system: 'A-Level', subject: '数学', code: '7357', access: 'public',
    papers: 'Paper 1 / Paper 2 / Paper 3', topics: '证明、代数、坐标几何、数列、三角、微积分、统计与力学',
    url: 'https://www.aqa.org.uk/subjects/mathematics/a-level/mathematics-7357/assessment-resources' },
  { board: 'AQA', system: 'A-Level', subject: '物理', code: '7408', access: 'public',
    papers: 'Paper 1 / Paper 2 / Paper 3（含实践考核）', topics: '测量与误差、粒子、波、力学、电学、场、热、核',
    url: 'https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/assessment-resources' },
  { board: 'AQA', system: 'A-Level', subject: '化学', code: '7405', access: 'public',
    papers: 'Paper 1 / Paper 2 / Paper 3（含实践考核）', topics: '物理化学、无机化学、有机化学、实验技能',
    url: 'https://www.aqa.org.uk/subjects/chemistry/a-level/chemistry-7405/assessment-resources' },
  { board: 'AQA', system: 'A-Level', subject: '生物', code: '7402', access: 'public',
    papers: 'Paper 1 / Paper 2 / Paper 3（含实践考核）', topics: '生物分子与细胞、遗传、能量转移、生物体与环境',
    url: 'https://www.aqa.org.uk/subjects/biology/a-level/biology-7402/assessment-resources' },
  { board: 'AQA', system: 'A-Level', subject: '经济', code: '7136', access: 'public',
    papers: 'Paper 1 市场与市场失灵 / Paper 2 国民经济 / Paper 3 综合论述',
    topics: '价格机制、市场结构、宏观政策、国际经济',
    url: 'https://www.aqa.org.uk/subjects/economics/a-level/economics-7136/assessment-resources' },
  { board: 'AQA', system: 'A-Level', subject: '全科真题总入口', code: '各科', access: 'public',
    papers: '按科目与考季查找（含 Mark Scheme）', topics: '全部科目',
    url: 'https://www.aqa.org.uk/find-past-papers-and-mark-schemes' },

  // ---- OCR：官方公开 ----
  { board: 'OCR', system: 'A-Level', subject: '数学 A', code: 'H240', access: 'public',
    papers: 'Paper 1 纯数 / Paper 2 纯数与统计 / Paper 3 纯数与力学',
    topics: '证明、代数、三角、微积分、统计、力学',
    url: 'https://www.ocr.org.uk/qualifications/as-and-a-level/mathematics-a-h230-h240-from-2017/' },
  { board: 'OCR', system: 'A-Level', subject: '物理 A', code: 'H556', access: 'public',
    papers: 'Modelling physics / Exploring physics / Unified physics（含实践）',
    topics: '力学、材料、电学、波、量子物理、天体物理',
    url: 'https://www.ocr.org.uk/qualifications/as-and-a-level/physics-a-h156-h556-from-2015/' },
  { board: 'OCR', system: 'A-Level', subject: '真题查找器', code: '各科', access: 'public',
    papers: '按科目与考季筛选', topics: '全部科目',
    url: 'https://www.ocr.org.uk/qualifications/past-paper-finder/' },

  // ---- AP（College Board）：近三年 FRQ 公开 ----
  { board: 'College Board', system: 'AP', subject: '微积分 AB', code: 'AP Calculus AB', access: 'public',
    papers: 'Free-Response Questions（近三年，含评分标准与范文）',
    topics: '极限、导数应用、积分技巧、微分方程、级数（BC）',
    url: 'https://apcentral.collegeboard.org/courses/ap-calculus-ab/exam/past-exam-questions' },
  { board: 'College Board', system: 'AP', subject: '微积分 BC', code: 'AP Calculus BC', access: 'public',
    papers: 'Free-Response Questions（近三年）', topics: '含 AB 全部 + 参数方程、级数、极坐标',
    url: 'https://apcentral.collegeboard.org/courses/ap-calculus-bc/exam/past-exam-questions' },
  { board: 'College Board', system: 'AP', subject: '统计', code: 'AP Statistics', access: 'public',
    papers: 'Free-Response Questions（近三年）', topics: '抽样与实验、概率分布、推断、回归',
    url: 'https://apcentral.collegeboard.org/courses/ap-statistics/exam/past-exam-questions' },
  { board: 'College Board', system: 'AP', subject: '物理 1', code: 'AP Physics 1', access: 'public',
    papers: 'Free-Response Questions（近三年）', topics: '运动学、牛顿定律、能量、动量、简谐、电路',
    url: 'https://apcentral.collegeboard.org/courses/ap-physics-1/exam/past-exam-questions' },
  { board: 'College Board', system: 'AP', subject: '计算机科学 A', code: 'AP CSA', access: 'public',
    papers: 'Free-Response Questions（近三年）', topics: '类与对象、继承、数组与 ArrayList、递归与算法',
    url: 'https://apcentral.collegeboard.org/courses/ap-computer-science-a/exam/past-exam-questions' },

  // ---- IB：不公开 ----
  { board: 'IBO', system: 'IB', subject: '全科', code: 'IB DP', access: 'school',
    papers: 'Paper 1 / Paper 2 / Paper 3 / IA（由学校统一发放）',
    topics: '各学科组（按学校选课）',
    url: 'https://www.ibo.org/' },

  /* ---- Cambridge IGCSE（科目页公开；真题同 CAIE 规则：不授权电子再发布）----
     ★ 关于 CAIE 的"公开资源"说明依据的是 Cambridge **官方帮助文档**（help.cambridgeinternational.org）
       的一手表述：科目页可看到 Past papers / examiner reports / specimen papers；
       真题由学校在 School Support Hub 获取，教师可校内下载打印但**不可再发布**。
       我实测过：从本机用 HTTP 与真实浏览器都**打不开**这些页面（HEAD 偶尔 200、完整加载超时/重置），
       所以**无法代为核实每页当前公开了哪些文件** —— 因此文案只说官方文档确认存在的东西，
       不写"点这里就能下到真题"。 */
  { board: 'Cambridge International', system: 'IGCSE', subject: '数学', code: '0580', access: 'school',
    papers: 'Paper 1/2 核心 / Paper 3/4 拓展（Core & Extended）',
    topics: '数与代数、比例、几何与测量、统计与概率、坐标几何',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-mathematics-0580/' },
  { board: 'Cambridge International', system: 'IGCSE', subject: '物理', code: '0625', access: 'school',
    papers: 'Paper 1/2 选择 / Paper 3/4 理论 / Paper 5/6 实验',
    topics: '运动与力、热物理、波、电与磁、原子物理',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/' },
  { board: 'Cambridge International', system: 'IGCSE', subject: '化学', code: '0620', access: 'school',
    papers: 'Paper 1/2 选择 / Paper 3/4 理论 / Paper 5/6 实验',
    topics: '粒子、化学式与方程式、化学计量、电化学、有机化学、实验',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-chemistry-0620/' },
  { board: 'Cambridge International', system: 'IGCSE', subject: '生物', code: '0610', access: 'school',
    papers: 'Paper 1/2 选择 / Paper 3/4 理论 / Paper 5/6 实验',
    topics: '细胞与生命过程、植物与动物生理、遗传、生态、生物技术',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-biology-0610/' },
  { board: 'Cambridge International', system: 'IGCSE', subject: '经济', code: '0455', access: 'school',
    papers: 'Paper 1 选择 / Paper 2 结构化',
    topics: '基本经济问题、价格机制、政府作用、国际经济',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-economics-0455/' },
  { board: 'Cambridge International', system: 'IGCSE', subject: '计算机科学', code: '0478', access: 'school',
    papers: 'Paper 1 理论 / Paper 2 算法与编程',
    topics: '数据表示、硬件、网络、算法、编程、数据库',
    url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-computer-science-0478/' },

  /* ---- 国内高考 ----
     ★ 国内高考真题由**各省教育考试院在考后公布**（属官方公开行为），
       我们不汇总、不转载、不重新排版，只给官方入口。
       注意：市面上大量"高考真题汇编"是出版社的版权作品，转载是另一回事。 */
  { board: '教育部教育考试院', system: '高考', subject: '全国统考（政策与信息）', code: '教育部教育考试院', access: 'public',
    papers: '考试大纲 / 试题评析 / 考试成绩与政策发布',
    topics: '全国统一命题科目的官方说明与发布',
    url: 'https://www.neea.edu.cn/' },
  { board: '北京教育考试院', system: '高考', subject: '北京卷', code: '北京', access: 'public',
    papers: '考后公布本省（市）试题与参考答案', topics: '北京自主命题科目',
    url: 'https://www.bjeea.cn/' },
  { board: '上海市教育考试院', system: '高考', subject: '上海卷', code: '上海', access: 'public',
    papers: '考后公布本省（市）试题与参考答案', topics: '上海自主命题科目（含等级考）',
    url: 'https://www.shmeea.edu.cn/' },
  { board: '广东省教育考试院', system: '高考', subject: '广东卷', code: '广东', access: 'public',
    papers: '考后公布本省试题与参考答案', topics: '广东新高考科目组合',
    url: 'https://eea.gd.gov.cn/' },
  { board: '江苏省教育考试院', system: '高考', subject: '江苏卷', code: '江苏', access: 'public',
    papers: '考后公布本省试题与参考答案', topics: '江苏新高考科目组合',
    url: 'https://www.jseea.cn/' },
  { board: '浙江省教育考试院', system: '高考', subject: '浙江卷', code: '浙江', access: 'public',
    papers: '考后公布本省试题与参考答案', topics: '浙江选考与统考科目',
    url: 'https://www.zjzs.net/' },
  { board: '山东省教育招生考试院', system: '高考', subject: '山东卷', code: '山东', access: 'public',
    papers: '考后公布本省试题与参考答案', topics: '山东新高考科目组合',
    url: 'https://www.sdzk.cn/' },
  { board: '四川省教育考试院', system: '高考', subject: '四川卷', code: '四川', access: 'public',
    papers: '考后公布本省试题与参考答案', topics: '四川高考科目',
    url: 'https://www.sceea.cn/' },
  /* ★ 湖北省教育考试院（hbea.edu.cn）**未收录**：它的 http 会 301 到 https，
     但 https 稳定返回 503 / 连接被重置（间隔 12 秒连测三次都一样，不是限流）。
     无法验证可用的入口不放进产品 —— 一个打不开的官方链接比"少一个省"更伤信任。 */
];

function papersBySystem(sys, subj) {
  return EXAM_LIBRARY.filter((x) => (!sys || x.system === sys) && (!subj || x.subject === subj));
}

/* 渲染真题库：筛选 + 卡片（官方入口 + 我们的同构练习） */
function renderPapers() {
  const box = $('#papers-list');
  if (!box) return;
  const sys = (($('#papers-system') || {}).value) || '';
  const subj = (($('#papers-subject') || {}).value) || '';
  const list = papersBySystem(sys, subj);
  if (!list.length) {
    box.innerHTML = '<p class="mem-empty">这个筛选条件下还没有收录，换一个找找。</p>';
    return;
  }
  box.innerHTML = list.map((x, i) => {
    const acc = EXAM_ACCESS[x.access] || EXAM_ACCESS.school;
    return '<div class="paper-card">' +
      '<div class="paper-head">' +
        '<div>' +
          '<h3>' + esc(x.subject) + (x.code ? '　<span class="paper-code">' + esc(x.code) + '</span>' : '') + '</h3>' +
          '<p class="paper-board">' + esc(x.board) + ' · ' + esc(x.system) + '</p>' +
        '</div>' +
        '<span class="paper-access ' + acc.cls + '">' + esc(acc.label) + '</span>' +
      '</div>' +
      (x.papers ? '<p class="paper-line"><b>试卷构成</b>' + esc(x.papers) + '</p>' : '') +
      (x.topics ? '<p class="paper-line"><b>考点范围</b>' + esc(x.topics) + '</p>' : '') +
      '<p class="paper-note">' + esc(acc.note) + '</p>' +
      '<div class="paper-acts">' +
        '<a class="btn btn-sm btn-primary" href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer"' +
          ' data-paper-open="' + i + '">去官方下载真题 ↗</a>' +
        '<button class="btn btn-sm btn-ghost" data-paper-practice="' + i + '">按这份卷的规格出练习</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

/* 「按这份卷的规格出练习」—— 我们不提供真题，但可以**按同样的规格**现场出题。
   这既避开版权（不复制原题），又比"重做原题"更有训练价值（背不了答案）。 */
async function makePaperStylePractice(idx) {
  const item = EXAM_LIBRARY[Number(idx)];
  if (!item) return;
  const box = $('#papers-practice');
  if (!box) return;
  if (!state.cloud) { toast('需要先连上云端才能出题', 'err'); return; }
  box.hidden = false;
  box.innerHTML = '<div class="pp-head"><b>' + esc(item.subject) + ' · ' + esc(item.code) + ' 规格练习</b>' +
    '<span class="pp-tag">AI 原创题 · 非真题</span></div>' +
    '<p class="pp-load">正在按这个考试的题型与分值出题…</p>';
  try {
    const raw = await streamChat({
      messages: [
        { role: 'system', content: '你是国际课程命题老师。你**不能复制任何真题**，'
          + '只能按题型规格原创新题。只输出严格 JSON，不要解释。' },
        { role: 'user', content: '请按 ' + item.board + ' ' + item.system + ' ' + item.subject
          + '（' + item.code + '）的题型规格，原创 3 道练习题。\n'
          + '试卷构成：' + (item.papers || '') + '\n考点范围：' + (item.topics || '') + '\n\n'
          + '要求：① 完全原创，**不得照抄任何真实考题**；② 题型、分值、答题形式要与该考试一致；'
          + '③ 难度对标该考试的中等偏上；④ 每题给出答案与评分要点（Mark Scheme 式的得分点）。\n'
          + '输出：[{"question":"题干","marks":分值数字,"answer":"答案","scheme":["得分点1","得分点2"]}]' },
      ],
      temperature: 0.6,
      responseFormat: true,
      onDelta: () => {}, onReasoning: () => {}, onNotice: () => {},
    });
    const arr = parseJSONLoose(raw);
    const qs = (Array.isArray(arr) ? arr : (arr && Array.isArray(arr.questions) ? arr.questions : []))
      .filter((q) => q && q.question);
    if (!qs.length) throw new Error('没有取到题目');
    box.innerHTML = '<div class="pp-head"><b>' + esc(item.subject) + ' · ' + esc(item.code) + ' 规格练习</b>' +
      '<span class="pp-tag">AI 原创题 · 非真题</span></div>' +
      qs.slice(0, 3).map((q, i) =>
        '<div class="pp-q"><div class="pp-qhead"><span class="pp-no">' + (i + 1) + '</span>' +
        '<span class="pp-marks">' + esc(String(q.marks || '—')) + ' 分</span></div>' +
        '<p class="pp-text">' + esc(q.question) + '</p>' +
        '<details class="pp-ans"><summary>看答案与评分要点</summary>' +
        '<p><b>答案：</b>' + esc(q.answer || '（略）') + '</p>' +
        ((Array.isArray(q.scheme) && q.scheme.length)
          ? '<div class="pp-scheme"><b>评分要点</b><ul>' + q.scheme.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div>' : '') +
        '</details></div>').join('') +
      '<p class="pp-foot">⚠️ 这些题由 AI 按题型规格原创，**不是真题**，用于针对性训练；'
      + '真题请点上方「去官方下载真题」到 ' + esc(item.board) + ' 官网获取。</p>';
    try { track('paper_practice_gen', { board: item.board.slice(0, 24), subject: item.subject.slice(0, 24) }); } catch (_) {}
  } catch (e) {
    box.innerHTML = '<div class="pp-head"><b>出题失败</b></div>' +
      '<p class="pp-load">' + esc(mapLLMError(e)) + '　可以稍后重试，或先去做官方真题。</p>';
  }
}

function bindPapersEvents() {
  const box = $('#papers-list');
  if (box) box.addEventListener('click', (ev) => {
    const p = ev.target.closest('[data-paper-practice]');
    if (p) { makePaperStylePractice(p.dataset.paperPractice); return; }
    const a = ev.target.closest('[data-paper-open]');
    if (a) { try { track('paper_official_open', { i: a.dataset.paperOpen }); } catch (_) {} }
  });
  ['#papers-system', '#papers-subject'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('change', renderPapers);
  });
  // 学科下拉随体系变化（避免选了不存在组合后一片空白）
  const sys = $('#papers-system');
  if (sys) sys.addEventListener('change', () => {
    const cur = sys.value;
    const subs = [...new Set(EXAM_LIBRARY.filter((x) => !cur || x.system === cur).map((x) => x.subject))];
    const sj = $('#papers-subject');
    if (sj) {
      sj.innerHTML = '<option value="">全部学科</option>' + subs.map((s) => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    }
    renderPapers();
  });
}

/* ============================================================
   「自带真题」通道（2026-09-25）
   #1 的落地：Cambridge 不授权电子发布真题，但学生**在学校合法拿到**真题是完全正常的。
   所以我们不去分发任何东西，只提供**处理学生自己那份材料的工具**：
   上传 PDF / 粘贴文字 → 抽出题目文字 → 交给 AI 做「逐题讲解」或「同类型变式练习」。

   ★ 这是唯一既合规又能让"Cambridge 线"真正跑起来的路：
     版权风险不在我们这（我们不存储、不公开、不传播），
     而学生获得了原本只有"有老师陪着"才能得到的讲解与针对性练习。
   ★ 不做 OCR：扫描件 PDF 抽不出文字是正常的，这时引导他去复制文字或拍照转文字，
     不假装能识别（扫描件 OCR 是另一个量级）。
   ============================================================ */
const OWN_PAPER_MAX_CHARS = 12000;   // 单份卷子交给模型的文字上限（超长截断并如实告知）

/* 自研 PDF 文本抽取（零外部依赖）
   为什么自己做：pdf.js 的四条 CDN 通道在本机全部不可达（实测超时/重置），
   而项目里能稳定用上的第三方库（PptxGenJS）都是**本地 vendor**。既然拿不到，
   就不把它当承诺。PDF 文本抽取的核心其实不难：
     ① PDF 的页面内容流通常是 FlateDecode（zlib）压缩的 —— 浏览器原生
        DecompressionStream('deflate') 就能解，不必引库；
     ② 解出来后按文本操作符取字符串（Tj / TJ / ' / "）即可。
   ★ 适用边界（如实写在 UI 上）：**英文/数字卷子效果好**；
     中文若用了 CID 子集字体会乱码；扫描件（无文字层）抽不出任何东西 —— 那种要 OCR，我们不假装能做。 */
async function inflateBytes(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  /* ★ 关键：把已解出的数据保留下来。
     实测踩到的坑：我从 stream 到 endstream 之间切字节，尾部常带换行/空白，
     于是 DecompressionStream 在**解完正文后**才报 "Junk found after end of compressed data"。
     如果像第一版那样把 chunks 声明在 try 内部，抛错时这些已经解好的数据会一起丢掉 ——
     明明是"多带了尾巴"，却被当成"完全失败"。所以这里 chunks 放外面，读到的都留下。 */
  const concat = (chunks) => {
    let n = 0;
    chunks.forEach((c) => { n += c.length; });
    const out = new Uint8Array(n);
    let off = 0;
    chunks.forEach((c) => { out.set(c, off); off += c.length; });
    return out;
  };
  const tryFmt = async (fmt) => {
    const chunks = [];
    try {
      const ds = new DecompressionStream(fmt);
      const w = ds.writable.getWriter();
      w.write(bytes);
      w.close().catch(() => {});
      const reader = ds.readable.getReader();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        if (r.value && r.value.length) chunks.push(r.value);
      }
    } catch (_) { /* 尾部有垃圾很正常，已读到的部分照用 */ }
    return chunks.length ? concat(chunks) : null;
  };
  let out = await tryFmt('deflate');
  if (out && out.length) return out;
  out = await tryFmt('deflate-raw');
  return out && out.length ? out : null;
}

/* 从字典里读 /Length，用于**精确**切出流字节（避免多带尾部导致解压报错） */
function pdfStreamLength(dict, raw, streamStart) {
  const m = dict.match(/\/Length\s+(\d+)/);
  if (!m) return -1;
  const n = parseInt(m[1], 10);
  if (!(n > 0) || streamStart + n > raw.length) return -1;
  return n;
}

function pdfStringsToText(content) {
  /* 从内容流里取文本。只处理最常见的几种： (..) Tj  /  [(..) ..] TJ  /  (..) '  "  */
  const out = [];
  const dec = (s) => s
    .replace(/\\([nrtbf])/g, (m, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || ''))
    .replace(/\\([0-7]{1,3})/g, (m, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\([\\()])/g, '$1');
  // 逐个 ( ... ) 字符串，带上它后面紧跟的操作符，判断是不是文本操作符
  const re = /\(((?:\\.|[^\\()])*)\)\s*(Tj|TJ|'|")?/g;
  let m;
  let line = '';
  while ((m = re.exec(content)) !== null) {
    const str = dec(m[1]);
    const op = m[2];
    if (op) {
      line += str;
      if (op === "'" || op === '"') { out.push(line); line = ''; }
    } else {
      // TJ 数组里的分段，先攒着；遇到换行/大间距时切句
      line += str + ' ';
    }
  }
  if (line.trim()) out.push(line);
  // TJ 数组里 -1000 以上的负位移通常表示空格，这里统一压一下多余空白
  return out.join('\n').replace(/[ \t]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractPdfTextLocal(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // PDF 结构是 ASCII，用 latin1 扫描定位 stream/endstream
  let raw = '';
  const CH = 65536;
  for (let i = 0; i < bytes.length; i += CH) {
    raw += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
  }
  const texts = [];
  const re = /stream\r?\n?/g;
  let m;
  let idx = 0;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    // stream 前的字典（往前 400 字符）判断是否 FlateDecode
    const dict = raw.slice(Math.max(0, m.index - 400), m.index);
    const isFlate = /\/FlateDecode/.test(dict);
    let content = '';
    if (isFlate) {
      // 优先按 /Length 精确切（真实 PDF 都带这个字段），切不到再用 endstream 兜底
      const exact = pdfStreamLength(dict, raw, start);
      const seg = exact > 0 ? bytes.subarray(start, start + exact) : bytes.subarray(start, end);
      const inf = await inflateBytes(seg);
      if (inf && inf.length) content = String.fromCharCode.apply(null, inf.subarray(0, Math.min(inf.length, 300000)));
    } else if (/\/Filter\s*\[?\s*\/(?!Flate)/.test(dict)) {
      content = '';                       // 其它滤镜（LZW/DCT 等）不处理，跳过
    } else {
      content = raw.slice(start, end);     // 未压缩内容流直接用
    }
    if (content && /\b(Tj|TJ)\b/.test(content)) {
      const t = pdfStringsToText(content);
      if (t) texts.push(t);
    }
    idx += 1;
    if (idx > 200) break;                  // 防御：异常 PDF 不至于把页面卡死
    re.lastIndex = end;
  }
  return texts.join('\n\n');
}

/* 抽文字总入口：优先自研解析（零依赖），拿不到文字时如实说明原因 */
async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isPdf = String.fromCharCode.apply(null, head).indexOf('%PDF') === 0;
  if (!isPdf) throw new Error('这个文件看起来不是 PDF');
  const text = await extractPdfTextLocal(buf);
  return { pages: 0, read: 0, text: text };
}

async function handleOwnPaperFile(file) {
  const st = $('#own-paper-status');
  const ta = $('#own-paper-text');
  if (!st || !ta) return;
  if (!file) return;
  const name = String(file.name || '');
  st.hidden = false;
  st.className = 'own-status';
  if (/\.pdf$/i.test(name)) {
    st.textContent = '正在从 PDF 里抽取文字…';
    try {
      const r = await extractPdfText(file);
      if (!r.text || r.text.length < 40) {
        st.className = 'own-status warn';
        st.textContent = '这份 PDF 里几乎抽不到文字 —— 大概是"扫描件/图片版"，或者用了我们解不了的字体编码。'
          + '扫描件我们不假装能识别（那需要 OCR）。可以：① 用手机拍照后转成文字再粘贴；'
          + '② 或者直接把题目文字复制过来。';
        return;
      }
      ta.value = r.text.slice(0, OWN_PAPER_MAX_CHARS);
      st.className = 'own-status ok';
      st.textContent = '已从 PDF 抽取 ' + r.text.length + ' 个字符'
        + (r.text.length > OWN_PAPER_MAX_CHARS ? '，超出部分已截断' : '') + '。接着选下面两个按钮之一。';
      try { track('own_paper_extract', { kind: 'pdf', chars: r.text.length }); } catch (_) {}
    } catch (e) {
      st.className = 'own-status warn';
      st.textContent = '抽取失败：' + (e && e.message ? e.message : '未知原因') + '　可以改用"粘贴文字"。';
    }
    return;
  }
  // 纯文本文件直接读
  try {
    const txt = await file.text();
    ta.value = String(txt || '').slice(0, OWN_PAPER_MAX_CHARS);
    st.className = 'own-status ok';
    st.textContent = '已读入 ' + ta.value.length + ' 个字符。接着选下面两个按钮之一。';
    try { track('own_paper_extract', { kind: 'text', chars: ta.value.length }); } catch (_) {}
  } catch (e) {
    st.className = 'own-status warn';
    st.textContent = '读取失败，可以改用"粘贴文字"。';
  }
}

/* 把学生自己的材料交给 AI：mode = 'explain'（逐题讲解）| 'variant'（同类型变式） */
async function runOwnPaper(mode) {
  const ta = $('#own-paper-text');
  const box = $('#own-paper-result');
  const st = $('#own-paper-status');
  if (!ta || !box) return;
  const text = String(ta.value || '').trim();
  if (text.length < 30) {
    toast('先把题目文字放进来（至少几十个字）', 'err');
    return;
  }
  if (!state.cloud) { toast('需要先连上云端才能用 AI 讲解', 'err'); return; }
  box.hidden = false;
  box.innerHTML = '<p class="own-load">' + (mode === 'explain'
    ? '正在逐题分析你这份卷子…' : '正在按这份卷子的题型出同类型新题…') + '</p>';
  if (st) { st.hidden = true; }
  const sys = mode === 'explain'
    ? '你是国际课程/A-Level 的阅卷与讲题老师。学生提供的是**他自己合法获得的**练习材料，'
      + '你负责帮他弄懂。**不要评价材料来源**，也不需要他提供出处。'
    : '你是命题老师。参考学生提供的题目**风格**，原创同类型新题。'
      + '**不得照抄原文题目**，只借鉴题型、考点与难度。';
  const ask = mode === 'explain'
    ? '下面是学生的一份练习/真题材料（可能是节选）。请：\n'
      + '① 先列出这份材料覆盖的**知识点清单**（按出现顺序）；\n'
      + '② 逐题讲解：每题说清**考点 → 解题思路 → 关键步骤 → 常见扣分点**；'
      + '③ 最后指出**最值得优先补的 2~3 个薄弱点**，并各给一句可执行的练习建议。\n'
      + '用中文，讲清楚"为什么这么做"，不要只给答案。\n\n'
      + '输出严格 JSON：{"topics":["知识点"],"items":[{"no":"题号","point":"考点","how":"解题思路",'
      + '"steps":["关键步骤"],"trap":"常见扣分点"}],"weak":["薄弱点+建议"]}\n\n材料：\n' + text
    : '参考下面材料的**题型与考点**，原创 3 道同类型新题（不得照抄原题）。\n'
      + '输出严格 JSON：[{"question":"题干","marks":分值数字,"answer":"答案","scheme":["评分要点"]}]\n\n材料：\n' + text;
  try {
    const raw = await streamChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: ask },
      ],
      temperature: mode === 'explain' ? 0.3 : 0.6,
      responseFormat: true,
      onDelta: () => {}, onReasoning: () => {}, onNotice: () => {},
    });
    const data = parseJSONLoose(raw);
    if (mode === 'explain') {
      const topics = Array.isArray(data && data.topics) ? data.topics.filter(Boolean) : [];
      const items = (Array.isArray(data && data.items) ? data.items : []).filter((x) => x && (x.no || x.point));
      const weak = Array.isArray(data && data.weak) ? data.weak.filter(Boolean) : [];
      if (!items.length && !topics.length) throw new Error('没有解析出内容');
      box.innerHTML =
        '<div class="pp-head"><b>这份材料讲了什么 · 逐题讲解</b><span class="pp-tag">基于你提供的材料</span></div>' +
        (topics.length ? '<div class="own-sec"><b>覆盖的知识点</b><div class="own-chips">' +
          topics.map((t) => '<span class="own-chip">' + esc(t) + '</span>').join('') + '</div></div>' : '') +
        items.map((x, i) =>
          '<div class="pp-q"><div class="pp-qhead"><span class="pp-no">' + esc(String(x.no || (i + 1))) + '</span>' +
          '<span class="pp-marks">' + esc(String(x.point || '')) + '</span></div>' +
          (x.how ? '<p class="pp-text"><b>思路：</b>' + esc(x.how) + '</p>' : '') +
          ((Array.isArray(x.steps) && x.steps.length)
            ? '<div class="pp-scheme"><b>关键步骤</b><ul>' + x.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div>' : '') +
          (x.trap ? '<p class="pp-text"><b>容易扣分的地方：</b>' + esc(x.trap) + '</p>' : '') +
          '</div>').join('') +
        (weak.length ? '<div class="own-sec"><b>最值得优先补的</b><ul class="own-list">' +
          weak.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '') +
        '<p class="pp-foot">这份材料是你自己提供的，我们只在你这里用它做讲解，不存储、不公开。</p>';
    } else {
      const qs = (Array.isArray(data) ? data : (data && Array.isArray(data.questions) ? data.questions : []))
        .filter((q) => q && q.question);
      if (!qs.length) throw new Error('没有生成出题目');
      box.innerHTML =
        '<div class="pp-head"><b>同类型变式练习</b><span class="pp-tag">AI 原创题 · 非原文</span></div>' +
        qs.slice(0, 3).map((q, i) =>
          '<div class="pp-q"><div class="pp-qhead"><span class="pp-no">' + (i + 1) + '</span>' +
          '<span class="pp-marks">' + esc(String(q.marks || '—')) + ' 分</span></div>' +
          '<p class="pp-text">' + esc(q.question) + '</p>' +
          '<details class="pp-ans"><summary>看答案与评分要点</summary>' +
          '<p><b>答案：</b>' + esc(q.answer || '（略）') + '</p>' +
          ((Array.isArray(q.scheme) && q.scheme.length)
            ? '<div class="pp-scheme"><b>评分要点</b><ul>' + q.scheme.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div>' : '') +
          '</details></div>').join('') +
        '<p class="pp-foot">这些题是 AI 参考你材料的题型**原创**的，不是原文题目 —— 用来检验你是否真的会了。</p>';
    }
    try { track('own_paper_run', { mode: mode, chars: text.length }); } catch (_) {}
  } catch (e) {
    box.innerHTML = '<p class="own-load">处理失败：' + esc(mapLLMError(e)) + '　可以稍后重试。</p>';
  }
}

function bindOwnPaperEvents() {
  const file = $('#own-paper-file');
  if (file) file.addEventListener('change', () => { handleOwnPaperFile(file.files && file.files[0]); });
  // 拖拽投放（学生从文件夹拖过来最顺手）
  const drop = $('#own-paper-drop');
  if (drop) {
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.add('on');
    }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.remove('on');
    }));
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleOwnPaperFile(f);
    });
  }
  const b1 = $('#btn-own-explain');
  if (b1) b1.addEventListener('click', () => runOwnPaper('explain'));
  const b3 = $('#btn-own-split');
  if (b3) b3.addEventListener('click', doSplitToBank);
  const b2 = $('#btn-own-variant');
  if (b2) b2.addEventListener('click', () => runOwnPaper('variant'));
}

/* ============================================================
   我的题库（2026-09-26）
   用户提出"把卷子拆题分类做题库"。这一步的意义不只是"存题"——
   它把之前**卡住的「错题本/重练」解锁了**：那时因为没有存原题，
   只能做"按薄弱知识点出新题"；现在有了拆出来的题目，才能真正"重做原来那道题"。

   ★ 合规前提（与「自带真题」一致）：题目来自学生**自己合法获得**的卷子，
     所以题库**只存在他自己的浏览器里**（localStorage），我们不上传、不公开、不分发。
     这也顺带绕开了"我们托管真题"的版权问题 —— 我们从来没拿到过这些数据。
   ★ 容量：localStorage 通常 5MB。题干做长度截断 + 条目上限 + 满时明确告知，
     不搞"悄悄丢数据"（那是这个项目里已经修过好几次的同类问题）。
   ============================================================ */
const BANK_KEY = 'lingxi_question_bank_v1';
const BANK_MAX_ITEMS = 600;
const BANK_STEM_MAX = 600;
const BANK_TYPES = { choice: '选择题', calc: '计算题', proof: '证明题', short: '简答题', other: '其他' };
const BANK_DIFF = { easy: '基础', mid: '中等', hard: '较难' };

function loadBank() {
  let list = [];
  /* ★ R01：题库同样按账号隔离（里面是学生自己导入的题） */
  try { list = JSON.parse(readContentRaw(BANK_KEY, '[]') || '[]'); } catch (_) { list = []; }
  return Array.isArray(list) ? list.filter((x) => x && x.stem) : [];
}
function saveBank(list) {
  const arr = Array.isArray(list) ? list : [];
  try {
    localStorage.setItem(scopedContentKey(BANK_KEY), JSON.stringify(arr));
    return { ok: true, n: arr.length };
  } catch (e) {
    /* 写失败必须说出来 —— 这个项目里"存储满静默失败导致课程丢失"已经踩过一次 */
    return { ok: false, err: (e && e.name === 'QuotaExceededError') ? '浏览器存储空间满了' : (e && e.message) || '写入失败' };
  }
}
function bankStats(list) {
  const l = Array.isArray(list) ? list : loadBank();
  const topics = {}, sources = {}, types = {};
  l.forEach((q) => {
    if (q.topic) topics[q.topic] = (topics[q.topic] || 0) + 1;
    if (q.source) sources[q.source] = (sources[q.source] || 0) + 1;
    if (q.type) types[q.type] = (types[q.type] || 0) + 1;
  });
  return { total: l.length, topics: topics, sources: sources, types: types, topicCount: Object.keys(topics).length };
}
/* 清洗模型输出的题目（脏数据不能进库） */
function cleanBankItems(raw, meta) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.questions) ? raw.questions : []);
  const m = meta || {};
  const out = [];
  arr.forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const stem = String(x.stem || x.question || x.text || '').replace(/\s+/g, ' ').trim();
    if (stem.length < 8) return;                       // 太短的不是题
    const type = BANK_TYPES[x.type] ? x.type : 'other';
    const diff = BANK_DIFF[x.difficulty] ? x.difficulty : 'mid';
    const mk = Number(x.marks);
    out.push({
      id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      subject: String(m.subject || '').slice(0, 24),
      board: String(m.board || '').slice(0, 32),
      source: String(m.source || '未命名来源').slice(0, 60),
      no: String(x.no || '').slice(0, 12),
      type: type,
      topic: String(x.topic || '未归类').slice(0, 40),
      tags: (Array.isArray(x.tags) ? x.tags : []).map((t) => String(t).slice(0, 20)).filter(Boolean).slice(0, 5),
      difficulty: diff,
      marks: (mk > 0 && mk < 200) ? mk : null,
      stem: stem.slice(0, BANK_STEM_MAX),
      options: (Array.isArray(x.options) ? x.options : []).map((o) => String(o).slice(0, 200)).filter(Boolean).slice(0, 6),
      answerHint: String(x.answerHint || x.answer || '').slice(0, 400),
      addedAt: Date.now(),
      tries: 0, right: 0,
    });
  });
  return out;
}
/* 入库（按题干前 60 字去重，避免同一份卷子重复拆两次灌进去） */
function bankAdd(items, meta) {
  const list = loadBank();
  const seen = {};
  list.forEach((q) => { seen[String(q.stem).slice(0, 60)] = 1; });
  let added = 0, dup = 0;
  (items || []).forEach((q) => {
    const k = String(q.stem).slice(0, 60);
    if (seen[k]) { dup += 1; return; }
    seen[k] = 1;
    list.unshift(q);
    added += 1;
  });
  let overflow = 0;
  while (list.length > BANK_MAX_ITEMS) { list.pop(); overflow += 1; }
  const r = saveBank(list);
  return { ok: r.ok, added: added, dup: dup, overflow: overflow, err: r.err };
}
function bankDelete(id) {
  const list = loadBank().filter((q) => q.id !== id);
  return saveBank(list);
}
function bankClearSource(src) {
  const list = loadBank().filter((q) => q.source !== src);
  return saveBank(list);
}
function bankAll() { return loadBank(); }

/* 从**可能被截断**的 JSON 文本里抢救出完整的对象（2026-09-26）
   为什么必须有它：实测拆整份卷子时模型返回 125KB，**输出被截断**，
   `parseJSONLoose` 对不完整的数组无能为力 → 返回 null → 我报"没有拆出题目"，
   可实际上模型拆得好好的，只是最后一条没写完。
   真实场景里"整份卷子 → 长输出 → 截断"几乎必然发生，所以不能只靠"解析成功/失败"二选一。
   做法：逐字符扫描，跟踪 {} 深度与字符串/转义状态，
   每凑齐一个完整的顶层对象就 JSON.parse 一次 —— 能收多少收多少。 */
function salvageObjects(text) {
  const s = String(text || '');
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const chunk = s.slice(start, i + 1);
        try {
          const o = JSON.parse(chunk);
          if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o);
        } catch (_) { /* 这一条本身坏了就跳过，不影响其它 */ }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

/* 拆题结果解析：先走常规解析；拿不到就抢救（应对截断） */
function parseSplitResult(raw) {
  const normal = parseJSONLoose(raw);
  if (Array.isArray(normal) && normal.length) return { items: normal, salvaged: false };
  if (normal && Array.isArray(normal.questions) && normal.questions.length) return { items: normal.questions, salvaged: false };
  const saved = salvageObjects(raw);
  if (saved.length) return { items: saved, salvaged: true };
  return { items: [], salvaged: false };
}

/* AI 拆题：把一份卷子拆成「题目 + 分类」
   分类维度取老师真正会用的那几个：知识点（topic）、题型、难度、分值、涉及的小标签。 */
async function splitPaperToBank(text, meta) {
  const src = String(text || '').trim();
  if (src.length < 30) throw new Error('文字太少，拆不出题');
  if (!state.cloud) throw new Error('需要先连上云端');
  const raw = await streamChat({
    messages: [
      { role: 'system', content: '你是命题与教研老师，负责把整份卷子**拆成一道一道独立题目**并分类。'
        + '只输出严格 JSON，不要解释、不要 Markdown 代码块。' },
      { role: 'user', content: '把下面这份练习材料拆成独立题目，并逐题分类。\n\n'
        + '要求：\n'
        + '① 一题一条；题干要**完整可作答**（含题目中的条件与数字），不要只写题号；\n'
        + '② topic 用**中文学科知识点名**（如"一元二次方程""微分积分""受力分析"），同一知识点的叫法要一致；\n'
        + '③ type 只能取 choice（选择）/ calc（计算）/ proof（证明）/ short（简答）/ other（其他）；\n'
        + '④ difficulty 只能取 easy（基础）/ mid（中等）/ hard（较难）；\n'
        + '⑤ marks 是这道题的分值（数字）；材料里没写就按题型惯例给一个合理值；\n'
        + '⑥ 选择题要把选项抄全（options 数组，元素自带 "A. " 前缀）；\n'
        + '⑦ answerHint 写答案要点或关键一步（学生自己核对用）；\n'
        + '⑧ tags 给 1~3 个细标签（如"配方法""链式法则"）；\n'
        + '⑨ 最多拆 20 道（**宁可少拆也不要写不完**，写不完会被截断，后面的题就丢了）；\n'
        + '   材料里不是题目的部分（标题、说明、页脚、版权声明）不要当成题；\n'
        + '⑩ stem 控制在 120 字以内，只保留解题必需的条件与数字，不要抄无关的排版文字。\n\n'
        + '输出格式：[{"no":"题号","type":"calc","topic":"知识点","tags":["细标签"],'
        + '"difficulty":"mid","marks":5,"stem":"完整题干","options":[],"answerHint":"答案要点"}]\n\n'
        + '材料：\n' + src },
    ],
    temperature: 0.2,
    responseFormat: true,
    onDelta: () => {}, onReasoning: () => {}, onNotice: () => {},
  });
  const parsed = parseSplitResult(raw);
  const items = cleanBankItems(parsed.items, meta);
  if (!items.length) {
    throw new Error(parsed.items.length
      ? '拆出的内容不成题（可能材料里没有完整题目）'
      : '没有拆出题目（材料可能不是题目，或格式太乱）');
  }
  if (parsed.salvaged) {
    // 抢救成功要说出来：用户该知道"这份卷子只拆到一部分"
    try { toast('这份卷子较长，已拆到前 ' + items.length + ' 道（输出被截断，后面的没拿到）', 'ok'); } catch (_) {}
  }
  return items;
}

/* 拆题入库的主流程（UI 调它） */
async function doSplitToBank() {
  const ta = $('#own-paper-text');
  const box = $('#own-paper-result');
  const st = $('#own-paper-status');
  if (!ta) return;
  const text = String(ta.value || '').trim();
  if (text.length < 30) { toast('先把卷子文字放进来', 'err'); return; }
  const fileEl = $('#own-paper-file');
  const sourceName = (fileEl && fileEl.files && fileEl.files[0] && fileEl.files[0].name)
    ? String(fileEl.files[0].name).replace(/\.[a-z0-9]+$/i, '') : '粘贴的材料';
  if (box) {
    box.hidden = false;
    box.innerHTML = '<p class="own-load">正在拆题并分类…（一道一道归到知识点上）</p>';
  }
  if (st) st.hidden = true;
  try {
    const items = await splitPaperToBank(text, { subject: '', board: '', source: sourceName });
    const r = bankAdd(items, {});
    if (!r.ok) {
      if (box) box.innerHTML = '<p class="own-load">入库失败：' + esc(r.err || '写入失败') + '</p>';
      toast('题库写入失败：' + (r.err || ''), 'err');
      return;
    }
    const stt = bankStats();
    if (box) {
      const byTopic = stt.topics;
      box.innerHTML = '<div class="pp-head"><b>拆出 ' + items.length + ' 道题，已入库</b>' +
        '<span class="pp-tag">存在你这台设备上</span></div>' +
        '<p class="own-load">新增 ' + r.added + ' 道' +
        (r.dup ? '，跳过重复 ' + r.dup + ' 道' : '') +
        (r.overflow ? '，超出上限丢弃最早 ' + r.overflow + ' 道' : '') + '。</p>' +
        '<div class="own-chips">' + Object.keys(byTopic).slice(0, 12)
          .map((t) => '<span class="own-chip">' + esc(t) + ' × ' + byTopic[t] + '</span>').join('') + '</div>' +
        '<p class="pp-foot">题库现在共 ' + stt.total + ' 道题，覆盖 ' + stt.topicCount + ' 个知识点。' +
        '到「我的题库」可以按知识点筛、也可以导出。</p>';
    }
    toast('已入库 ' + r.added + ' 道题', 'ok');
    try { track('bank_split', { n: items.length, added: r.added, topics: stt.topicCount }); } catch (_) {}
    try { if (typeof renderBank === 'function') renderBank(); } catch (_) {}
  } catch (e) {
    if (box) box.innerHTML = '<p class="own-load">拆题失败：' + esc(mapLLMError(e)) + '</p>';
  }
}

/* ── 我的题库视图 ──────────────────────────────────────────────
   筛选维度取"复习时真正会用的"：知识点 / 题型 / 难度 / 来源。
   刻意不做"按学科"（大多数学生一次只备一门，学科筛选帮不上忙还占地方）。 */
function bankFiltered() {
  const topic = (($('#bank-topic') || {}).value) || '';
  const type = (($('#bank-type') || {}).value) || '';
  const diff = (($('#bank-diff') || {}).value) || '';
  const src = (($('#bank-source') || {}).value) || '';
  return loadBank().filter((q) =>
    (!topic || q.topic === topic) && (!type || q.type === type) &&
    (!diff || q.difficulty === diff) && (!src || q.source === src));
}

function renderBank() {
  const box = $('#bank-list');
  if (!box) return;
  const all = loadBank();
  const stt = bankStats(all);
  // 统计条
  const sum = $('#bank-summary');
  if (sum) {
    sum.innerHTML = stt.total
      ? '<b>' + stt.total + '</b> 道题 · <b>' + stt.topicCount + '</b> 个知识点 · 来自 <b>' +
        Object.keys(stt.sources).length + '</b> 份材料'
      : '';
  }
  // 筛选下拉（选项随题库变化重建，避免出现空选项）
  const fill = (id, map, keepAll) => {
    const el = $(id);
    if (!el) return;
    const cur = el.value;
    const keys = Object.keys(map);
    el.innerHTML = '<option value="">' + keepAll + '</option>' +
      keys.sort().map((k) => '<option value="' + esc(k) + '">' + esc(k) + '（' + map[k] + '）</option>').join('');
    if (keys.indexOf(cur) >= 0) el.value = cur;
  };
  fill('#bank-topic', stt.topics, '全部知识点');
  fill('#bank-source', stt.sources, '全部来源');
  fill('#bank-type', stt.types, '全部题型');
  const diffMap = {};
  all.forEach((q) => { diffMap[BANK_DIFF[q.difficulty] || '中等'] = (diffMap[BANK_DIFF[q.difficulty] || '中等'] || 0) + 1; });
  fill('#bank-diff', diffMap, '全部难度');

  const list = bankFiltered();
  const emptyEl = $('#bank-empty');
  if (emptyEl) emptyEl.hidden = stt.total > 0;
  if (!list.length) {
    box.innerHTML = stt.total
      ? '<p class="mem-empty">这个筛选条件下没有题目，换个条件试试。</p>' : '';
    return;
  }
  box.innerHTML = list.slice(0, 200).map((q) => {
    const t = BANK_TYPES[q.type] || '其他';
    const d = BANK_DIFF[q.difficulty] || '中等';
    return '<div class="bank-item">' +
      '<div class="bank-head">' +
        '<span class="bank-topic">' + esc(q.topic) + '</span>' +
        '<span class="bank-meta">' + esc(t) + (q.marks ? ' · ' + q.marks + ' 分' : '') + ' · ' + esc(d) + '</span>' +
      '</div>' +
      '<p class="bank-stem">' + (q.no ? '<b>' + esc(q.no) + '</b> ' : '') + esc(q.stem) + '</p>' +
      ((q.options && q.options.length) ? '<ul class="bank-opts">' +
        q.options.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>' : '') +
      (q.answerHint ? '<details class="bank-ans"><summary>看答案要点</summary><p>' + esc(q.answerHint) + '</p></details>' : '') +
      '<div class="bank-foot">' +
        '<span class="bank-src">' + esc(q.source) + '</span>' +
        ((q.tags && q.tags.length) ? '<span class="bank-tags">' + q.tags.map((x) => '#' + esc(x)).join(' ') + '</span>' : '') +
        '<button class="bank-del" data-bank-del="' + esc(q.id) + '" aria-label="删除这道题">删除</button>' +
      '</div>' +
      '</div>';
  }).join('') + (list.length > 200 ? '<p class="mem-empty">只显示前 200 道，用筛选缩小范围。</p>' : '');
}

function bankExport() {
  const list = bankFiltered();
  if (!list.length) { toast('没有可导出的题目', 'err'); return; }
  const lines = ['# 我的题库导出（' + new Date().toLocaleDateString('zh-CN') + '）',
    '共 ' + list.length + ' 道题', ''];
  const byTopic = {};
  list.forEach((q) => { (byTopic[q.topic] = byTopic[q.topic] || []).push(q); });
  Object.keys(byTopic).forEach((t) => {
    lines.push('## ' + t + '（' + byTopic[t].length + ' 道）');
    byTopic[t].forEach((q) => {
      lines.push((q.no ? q.no + '. ' : '- ') + q.stem);
      if (q.options && q.options.length) q.options.forEach((o) => lines.push('   ' + o));
      lines.push('   [题型] ' + (BANK_TYPES[q.type] || '其他') + '　[难度] ' + (BANK_DIFF[q.difficulty] || '中等') +
        (q.marks ? '　[分值] ' + q.marks : '') + '　[来源] ' + q.source);
      if (q.answerHint) lines.push('   [答案要点] ' + q.answerHint);
      lines.push('');
    });
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '我的题库-' + new Date().toISOString().slice(0, 10) + '.md';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 4000);
  toast('已导出 ' + list.length + ' 道题（Markdown，按知识点分组）', 'ok');
  try { track('bank_export', { n: list.length }); } catch (_) {}
}

function bindBankEvents() {
  ['#bank-topic', '#bank-type', '#bank-diff', '#bank-source'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('change', renderBank);
  });
  const box = $('#bank-list');
  if (box) box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-bank-del]');
    if (!btn) return;
    const id = btn.dataset.bankDel;
    const r = bankDelete(id);
    if (r.ok) { toast('已删除这道题'); renderBank(); }
    else toast('删除失败：' + (r.err || ''), 'err');
  });
  const ex = $('#btn-bank-export');
  if (ex) ex.addEventListener('click', bankExport);
  const cl = $('#btn-bank-clear');
  if (cl) cl.addEventListener('click', () => {
    const src = (($('#bank-source') || {}).value) || '';
    const n = (src ? loadBank().filter((q) => q.source === src) : loadBank()).length;
    if (!n) { toast('没有可清除的题目', 'err'); return; }
    if (!window.confirm(src
      ? '清空来源「' + src + '」的 ' + n + ' 道题？此操作不可恢复。'
      : '清空整个题库（' + n + ' 道题）？此操作不可恢复。')) return;
    const r = src ? bankClearSource(src) : saveBank([]);
    if (r.ok) { toast(src ? '已清空该来源' : '题库已清空'); renderBank(); }
    else toast('清空失败：' + (r.err || ''), 'err');
  });
}

/* ============================================================
   学习进度：保存 + 导入导出（2026-09-27）
   为什么做：学生的课程、题库、偏好都只在**本机 localStorage** 里 ——
   清一次浏览器数据、换一台设备，这段学习历程就没了。
   而"长期记忆、越上越懂你"是这个产品的核心承诺，
   所以"能带走、能接回来"不是附属功能，是**这个承诺的兜底**。

   ★ 设计取舍（哪些进备份、哪些不进）：
     进：课程（含每节课进度）、题库（含重练记录）、学习偏好（主题/授课语言/语速）
     **不进**：AI 闸门计数、埋点队列、同意记录 —— 这些是运行时状态，
       带过去会污染新设备的额度/合规记录（同意必须在新设备上重新取得）。
   ★ 导入安全三件套（缺一不可）：
     ① 先校验再落盘（格式/版本/结构/校验和），失败**明确说原因**，绝不半途改数据
     ② 导入前**自动存一份当前数据**，并提供"撤销上次导入"
     ③ 合并策略：默认按 id 取较新，不静默覆盖用户数据
   ============================================================ */
const PROGRESS_FORMAT = 'lingxi-progress';
const PROGRESS_VERSION = 1;
const PROGRESS_PRE_IMPORT_KEY = 'lingxi_progress_pre_import';

/* 参与备份的键（显式列出，避免把运行时状态一起带走） */
const PROGRESS_KEYS = {
  courses: 'lingxi_courses_v1',
  bank: 'lingxi_question_bank_v1',
};
const PROGRESS_PREF_KEYS = {
  theme: 'lingxi_theme',
  teachLang: 'lingxi_teach_lang',
  tts: 'lingxi_tts',
  ttsRate: 'lingxi_tts_rate',
};

/* 简单校验和（FNV-1a）：用途是**检出文件被截断/改坏**，
   不是防篡改 —— 不引 crypto 依赖，也不假装它是安全机制。 */
function progressChecksum(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; }
}

/* 组装快照 */
function buildProgressSnapshot() {
  const courses = Array.isArray(state.courses) ? state.courses : [];
  const bank = loadBank();
  const prefs = {};
  Object.keys(PROGRESS_PREF_KEYS).forEach((k) => {
    try { const v = localStorage.getItem(PROGRESS_PREF_KEYS[k]); if (v != null) prefs[k] = v; } catch (_) {}
  });
  /* ★ 2026-09-29 修（外部审查 R08）：两处口径都错了。
     ① 完成课数：`progress` 全站都是 **0–1** 的比例（写入处一律 `Math.min(1, …)`，见录制与检查点），
        这里却拿 `>= 100` 比 —— 恒为假，导出摘要里"已完成课程"**永远是 0**。
     ② 课次：课程对象上根本没有 `sessions` 字段（课堂记录存的是 `replay`），
        所以 `sessions` 也永远是 0。改成"优先用 sessions，缺失时按是否有回放计一节"，
        与卡片/小结里判断"这节课上过没有"的既有口径（`c.replay.events.length`）保持一致。 */
  const isFinished = (c) => c && Number(c.progress) >= 0.999;
  const courseSessions = (c) => {
    if (!c) return 0;
    if (Array.isArray(c.sessions)) return c.sessions.length;
    return (c.replay && Array.isArray(c.replay.events) && c.replay.events.length) ? 1 : 0;
  };
  const sessions = courses.reduce((a, c) => a + courseSessions(c), 0);
  const done = courses.filter(isFinished).length;
  const snapshot = {
    format: PROGRESS_FORMAT,
    version: PROGRESS_VERSION,
    app: '灵犀课堂',
    exportedAt: new Date().toISOString(),
    summary: {
      courses: courses.length,
      finished: done,
      sessions: sessions,
      questions: bank.length,
      topics: bankStats(bank).topicCount,
    },
    data: { courses: courses, bank: bank, prefs: prefs },
  };
  snapshot.checksum = progressChecksum(JSON.stringify(snapshot.data));
  return snapshot;
}

/* 校验导入文件：返回 {ok, snapshot, error, warn}
   ★ 每种失败都要**说清是哪一种** —— 不要"文件无效"这种等于没说的提示。 */
function validateProgressFile(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: '这个文件是空的。' };
  if (raw.length > 40 * 1024 * 1024) return { ok: false, error: '文件超过 40MB，不像学习进度备份。' };
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) {
    return { ok: false, error: '这不是有效的备份文件（JSON 解析失败：' + String(e && e.message).slice(0, 60) + '）。请确认选的是「学习进度」导出的 .json 文件。' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: '备份文件结构不对（顶层应该是对象）。' };
  if (obj.format !== PROGRESS_FORMAT) {
    return { ok: false, error: '这不是灵犀课堂的学习进度备份。' + (obj.format ? '（文件标识是「' + String(obj.format).slice(0, 30) + '」）' : '') };
  }
  const v = Number(obj.version);
  if (!(v >= 1)) return { ok: false, error: '备份文件缺少版本号，无法判断兼容性。' };
  if (v > PROGRESS_VERSION) {
    return { ok: false, error: '这份备份来自更新的版本（v' + v + '），当前程序只到 v' + PROGRESS_VERSION + '。请先更新页面再导入。' };
  }
  const d = obj.data;
  if (!d || typeof d !== 'object') return { ok: false, error: '备份文件里没有数据段。' };
  if (d.courses != null && !Array.isArray(d.courses)) return { ok: false, error: '数据段里的「课程」不是列表，文件可能被改坏了。' };
  if (d.bank != null && !Array.isArray(d.bank)) return { ok: false, error: '数据段里的「题库」不是列表，文件可能被改坏了。' };
  // 校验和：只报"可能不完整"，不阻断 —— 用户可能手工编辑过，那是他的权利
  let warn = '';
  if (obj.checksum) {
    const calc = progressChecksum(JSON.stringify(d));
    if (calc !== obj.checksum) warn = '文件的校验和与内容不一致 —— 可能被截断或手工编辑过。内容仍会导入，但请留意。';
  } else {
    warn = '这份备份没有校验和（可能是旧版导出的），无法确认是否完整。';
  }
  return { ok: true, snapshot: obj, warn: warn };
}

/* 预览导入影响（先让用户看清会发生什么，再动手） */
function previewProgressImport(snapshot) {
  const inc = snapshot.data || {};
  const incCourses = Array.isArray(inc.courses) ? inc.courses : [];
  const incBank = Array.isArray(inc.bank) ? inc.bank : [];
  const curCourses = Array.isArray(state.courses) ? state.courses : [];
  const curBank = loadBank();
  const curCourseIds = curCourses.reduce((m, c) => { if (c && c.id) m[c.id] = c; return m; }, {});
  const curBankStems = curBank.reduce((m, q) => { m[String(q.stem).slice(0, 60)] = q; return m; }, {});
  let newCourses = 0, newerCourses = 0;
  incCourses.forEach((c) => {
    if (!c || !c.id) return;
    if (!curCourseIds[c.id]) newCourses += 1;
    else if (Number(c.progress || 0) > Number(curCourseIds[c.id].progress || 0)) newerCourses += 1;
  });
  let newQs = 0, dupQs = 0;
  incBank.forEach((q) => {
    if (!q || !q.stem) return;
    if (curBankStems[String(q.stem).slice(0, 60)]) dupQs += 1; else newQs += 1;
  });
  const when = snapshot.exportedAt ? new Date(snapshot.exportedAt) : null;
  return {
    exportedAt: when && !isNaN(when.getTime()) ? when.toLocaleString('zh-CN') : '未知时间',
    version: snapshot.version,
    incCourses: incCourses.length, newCourses: newCourses, newerCourses: newerCourses,
    incQs: incBank.length, newQs: newQs, dupQs: dupQs,
    curCourses: curCourses.length, curQs: curBank.length,
    prefs: inc.prefs && typeof inc.prefs === 'object' ? Object.keys(inc.prefs) : [],
    sum: snapshot.summary || null,
  };
}

/* 执行导入。mode: 'merge'（默认，按 id 取较新）| 'replace'（覆盖） */
function applyProgressImport(snapshot, mode) {
  const d = snapshot.data || {};
  const incCourses = (Array.isArray(d.courses) ? d.courses : []).filter((c) => c && c.id);
  const incBank = (Array.isArray(d.bank) ? d.bank : []).filter((q) => q && q.stem);
  // ① 先给当前数据留一份（可撤销）
  let backupOk = true;
  try {
    /* ★ R01：导入前备份同样按账号隔离 —— 它整份含课程与回放 */
    localStorage.setItem(scopedContentKey(PROGRESS_PRE_IMPORT_KEY), JSON.stringify({
      at: Date.now(),
      courses: Array.isArray(state.courses) ? state.courses : [],
      bank: loadBank(),
    }));
  } catch (_) { backupOk = false; }

  let result = { courses: { added: 0, updated: 0, skipped: 0 }, bank: { added: 0, dup: 0 }, prefs: 0, backupOk: backupOk };

  if (mode === 'replace') {
    state.courses = incCourses.slice();
    result.courses.added = incCourses.length;
    const r = saveBank(incBank.slice());
    result.bank.added = incBank.length;
    if (!r.ok) return { ok: false, error: '题库写入失败：' + (r.err || '') };
  } else {
    const byId = {};
    const cur = Array.isArray(state.courses) ? state.courses : [];
    cur.forEach((c) => { if (c && c.id) byId[c.id] = c; });
    incCourses.forEach((c) => {
      const old = byId[c.id];
      if (!old) { cur.unshift(c); result.courses.added += 1; }
      else if (Number(c.progress || 0) > Number(old.progress || 0) ||
               Number(c.createdAt || 0) > Number(old.createdAt || 0)) {
        const i = cur.indexOf(old);
        if (i >= 0) cur[i] = c;
        result.courses.updated += 1;
      } else result.courses.skipped += 1;
    });
    state.courses = cur;
    const r = bankAdd(incBank, {});
    if (!r.ok) return { ok: false, error: '题库写入失败：' + (r.err || '') };
    result.bank.added = r.added; result.bank.dup = r.dup;
  }

  // 偏好：只补空缺（已设置的不动 —— 换设备后本地习惯更该被尊重）
  const prefs = (d.prefs && typeof d.prefs === 'object') ? d.prefs : {};
  Object.keys(prefs).forEach((k) => {
    const key = PROGRESS_PREF_KEYS[k];
    if (!key) return;
    try {
      if (localStorage.getItem(key) == null) { localStorage.setItem(key, String(prefs[k])); result.prefs += 1; }
    } catch (_) {}
  });

  /* 落盘课程。
     ★ 2026-09-29 修（外部审查 R03）：原来这里调的是 `saveCourses(false)` ——
     这个函数**根本不存在**，异常被空 catch 吞掉，然后**照样返回 ok:true**。
     用户看到"导入成功"，实际课程只在内存里，一刷新就没了（题库倒是真存了，所以是半成功）。
     真实的保存函数是 `persistCourses()`，并且它有返回值，必须检查。 */
  if (!persistCourses()) {
    return { ok: false, error: '课程没能写入本机（可能是本机存储已满）。题库已导入，课程未保存，请清理空间后重试。' };
  }
  if (typeof currentTheme === 'function') { try { loadTheme(); } catch (_) {} }
  return { ok: true, result: result };
}

/* 撤销上次导入 */
function undoProgressImport() {
  const b = readJson(scopedContentKey(PROGRESS_PRE_IMPORT_KEY), null);
  if (!b || !Array.isArray(b.courses)) return { ok: false, error: '没有可撤销的导入记录。' };
  state.courses = b.courses;
  const r = saveBank(Array.isArray(b.bank) ? b.bank : []);
  if (!r.ok) return { ok: false, error: '恢复题库失败：' + (r.err || '') };
  /* ★ 2026-09-29 修（外部审查 R03）：同 applyProgressImport，`saveCourses` 不存在。
     失败时不删备份键 —— 让用户还能再撤一次，而不是把退路也一起丢掉。 */
  if (!persistCourses()) {
    return { ok: false, error: '课程没能恢复到本机（可能是本机存储已满）。题库已恢复，可清理空间后重试撤销。' };
  }
  try { localStorage.removeItem(scopedContentKey(PROGRESS_PRE_IMPORT_KEY)); } catch (_) {}
  return { ok: true, at: b.at };
}

function hasProgressBackup() {
  const b = readJson(scopedContentKey(PROGRESS_PRE_IMPORT_KEY), null);
  return !!(b && Array.isArray(b.courses));
}

/* ── 进度备份的 UI ─────────────────────────────────────────── */
function renderProgressCard() {
  const box = $('#progress-card-body');
  if (!box) return;
  /* ★ 保住已有的结果提示。
     这个函数会整体重绘 #progress-card-body，直接重建会把刚写进去的结果清空 ——
     实测就是这样：点完「合并导入」后统计刷新了，但"新增 2 门课程"的提示被抹掉，
     用户看不到到底导进去了什么。**修在这一处**（而不是要求每个调用方记得先重绘再提示），
     这样以后谁再加调用都不会重新踩到。 */
  const keep = $('#progress-result');
  const keepHtml = (keep && !keep.hidden) ? keep.outerHTML : '';
  const snap = buildProgressSnapshot();
  const s = snap.summary;
  box.innerHTML =
    '<div class="pg-stats">' +
      '<div class="pg-stat"><b>' + s.courses + '</b><span>门课程</span></div>' +
      '<div class="pg-stat"><b>' + s.finished + '</b><span>已上完</span></div>' +
      '<div class="pg-stat"><b>' + s.questions + '</b><span>道题</span></div>' +
      '<div class="pg-stat"><b>' + s.topics + '</b><span>个知识点</span></div>' +
    '</div>' +
    (s.courses || s.questions
      ? '<p class="pg-hint">导出的文件包含这些课程、题库和学习偏好，可以带到另一台设备上接着学。</p>'
      : '<p class="pg-hint">还没有可保存的内容 —— 生成一节课或攒几道题之后，这里就有东西可带走了。</p>') +
    '<div class="pg-acts">' +
      '<button class="btn btn-primary" id="btn-progress-export"' +
        ((s.courses || s.questions) ? '' : ' disabled') + '>打包带走</button>' +
      '<label class="btn" for="progress-import-file">接回来<input type="file" id="progress-import-file" accept=".json,application/json" hidden></label>' +
      (hasProgressBackup() ? '<button class="btn btn-ghost" id="btn-progress-undo">撤销上次导入</button>' : '') +
    '</div>' +
    '<div class="pg-result" id="progress-result" hidden></div>';
  if (keepHtml) {
    const fresh = $('#progress-result');
    if (fresh) fresh.outerHTML = keepHtml;
  }
  bindProgressCardEvents();
}

/* 导出并下载 */
function exportProgress() {
  const snap = buildProgressSnapshot();
  if (!snap.summary.courses && !snap.summary.questions) { toast('还没有可保存的内容', 'err'); return; }
  const json = JSON.stringify(snap, null, 2);
  const d = new Date();
  const name = '灵犀课堂-学习进度-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
  try {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 4000);
    showProgressResult('ok', '已导出 ' + name,
      '含 ' + snap.summary.courses + ' 门课程、' + snap.summary.questions + ' 道题' +
      '（' + (json.length / 1024).toFixed(0) + ' KB）。把它存到网盘或发给自己，换设备时用「接回来」导入。');
    try { track('progress_export', { courses: snap.summary.courses, qs: snap.summary.questions }); } catch (_) {}
  } catch (e) {
    showProgressResult('err', '导出失败', (e && e.message) || '浏览器拒绝了下载，可以换一个浏览器再试。');
  }
}

function showProgressResult(kind, title, body, extraHtml) {
  const el = $('#progress-result');
  if (!el) return;
  el.hidden = false;
  el.className = 'pg-result ' + (kind || '');
  el.setAttribute('role', 'status');
  el.innerHTML = '<b>' + esc(title) + '</b><p>' + esc(body) + '</p>' + (extraHtml || '');
}

/* 选好文件后：先校验 + 预览，让用户确认再落盘 */
let _pendingProgress = null;
async function handleProgressFile(file) {
  const el = $('#progress-result');
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) { showProgressResult('err', '文件太大了', '超过 40MB，不像学习进度备份。'); return; }
  let text = '';
  try { text = await file.text(); }
  catch (e) { showProgressResult('err', '读不到这个文件', '可能是权限或文件损坏：' + ((e && e.message) || '')); return; }
  const v = validateProgressFile(text);
  if (!v.ok) {
    _pendingProgress = null;
    showProgressResult('err', '这个文件不能用', v.error + ' 你当前的数据没有被改动。');
    return;
  }
  _pendingProgress = v.snapshot;
  const p = previewProgressImport(v.snapshot);
  const lines =
    '<ul class="pg-list">' +
    '<li>备份时间：' + esc(p.exportedAt) + '（版本 v' + esc(String(p.version)) + '）</li>' +
    '<li><b>课程</b>：新增 ' + p.newCourses + ' 门' +
      (p.newerCourses ? '，更新 ' + p.newerCourses + ' 门（进度更新）' : '') +
      '；你本机现有 ' + p.curCourses + ' 门</li>' +
    '<li><b>题目</b>：新增 ' + p.newQs + ' 道' +
      (p.dupQs ? '，已有重复 ' + p.dupQs + ' 道（会跳过）' : '') +
      '；你本机现有 ' + p.curQs + ' 道</li>' +
    (p.prefs.length ? '<li><b>学习偏好</b>：' + p.prefs.length + ' 项（已设置过的不会被改动）</li>' : '') +
    '</ul>';
  const actions =
    '<div class="pg-choose">' +
      '<button class="btn btn-primary" id="btn-progress-merge">合并导入</button>' +
      '<button class="btn btn-ghost" id="btn-progress-replace">完全覆盖</button>' +
      '<button class="btn btn-ghost" id="btn-progress-cancel">先不动</button>' +
    '</div>';
  showProgressResult(v.warn ? 'warn' : 'ok', '这份备份里有什么', '', lines + actions +
    (v.warn ? '<p class="pg-warn">⚠ ' + esc(v.warn) + '</p>' : '') +
    '<p class="pg-note">导入前会自动存一份当前数据，导入后可以用「撤销上次导入」还原。</p>');
  const merge = $('#btn-progress-merge');
  if (merge) merge.addEventListener('click', () => runProgressImport('merge'));
  const rep = $('#btn-progress-replace');
  if (rep) rep.addEventListener('click', () => {
    if (!window.confirm('「完全覆盖」会用备份里的内容替换你本机的全部课程和题库。\n\n当前数据会先自动存一份，之后可以撤销。确定继续？')) return;
    runProgressImport('replace');
  });
  const cancel = $('#btn-progress-cancel');
  if (cancel) cancel.addEventListener('click', () => {
    _pendingProgress = null;
    const el2 = $('#progress-result');
    if (el2) el2.hidden = true;
  });
}

function runProgressImport(mode) {
  if (!_pendingProgress) { showProgressResult('err', '没有待导入的备份', '请重新选择文件。'); return; }
  let r = null;
  try { r = applyProgressImport(_pendingProgress, mode); }
  catch (e) { r = { ok: false, error: (e && e.message) || '未知错误' }; }
  if (!r.ok) { showProgressResult('err', '导入失败', r.error + ' 你当前的数据没有被改动。'); return; }
  const x = r.result;
  const parts = [];
  parts.push('<li><b>课程</b>：新增 ' + x.courses.added + ' 门' +
    (x.courses.updated ? '，更新 ' + x.courses.updated + ' 门' : '') +
    (x.courses.skipped ? '，跳过 ' + x.courses.skipped + ' 门（本机版本更新）' : '') + '</li>');
  parts.push('<li><b>题目</b>：新增 ' + x.bank.added + ' 道' + (x.bank.dup ? '，跳过重复 ' + x.bank.dup + ' 道' : '') + '</li>');
  if (x.prefs) parts.push('<li><b>学习偏好</b>：补上 ' + x.prefs + ' 项</li>');
  _pendingProgress = null;
  // 先刷新统计（会重绘卡片），**再**写结果 —— 反过来的话结果会被重绘抹掉
  renderProgressCard();
  showProgressResult('ok', mode === 'replace' ? '已用备份覆盖' : '已经接回来了',
    x.backupOk ? '当前数据已自动存了一份，需要的话可以撤销。' : '⚠ 当前数据没能自动备份（存储空间可能不足），这次导入不可撤销。',
    '<ul class="pg-list">' + parts.join('') + '</ul>' +
    '<div class="pg-choose"><button class="btn btn-ghost" id="btn-progress-close">看看我的课程</button></div>');
  if (typeof renderCourses === 'function') { try { renderCourses(); } catch (_) {} }
  if (typeof renderBank === 'function') { try { renderBank(); } catch (_) {} }
  try { toast(mode === 'replace' ? '已从备份恢复' : '学习进度已接回来', 'ok'); } catch (_) {}
  try { track('progress_import', { mode: mode, courses: x.courses.added, qs: x.bank.added }); } catch (_) {}
  const c = $('#btn-progress-close');
  if (c) c.addEventListener('click', () => { try { switchView('courses'); } catch (_) {} });
}

function bindProgressCardEvents() {
  const ex = $('#btn-progress-export');
  if (ex) ex.addEventListener('click', exportProgress);
  const f = $('#progress-import-file');
  if (f) f.addEventListener('change', () => {
    const file = f.files && f.files[0];
    if (file) handleProgressFile(file);
    f.value = '';                       // 允许重复选同一个文件
  });
  const u = $('#btn-progress-undo');
  if (u) u.addEventListener('click', () => {
    if (!window.confirm('用导入前留存的数据还原？这会丢弃这次导入带来的内容。')) return;
    const r = undoProgressImport();
    if (!r.ok) { showProgressResult('err', '撤销失败', r.error); return; }
    try { renderCourses(); } catch (_) {}
    try { renderBank(); } catch (_) {}
    renderProgressCard();                       // 先重绘（会刷新统计与撤销按钮），再写结果
    showProgressResult('ok', '已还原到导入前的状态', '课程与题库都回到了导入之前。');
  });
}

/* 云服务初始化（单独抽出：vendor 兜底到位后需要能"补做"这一步） */
function initCloud() {
  if (!window.WorkBuddyCloud || state.cloud) return;
  try {
    state.cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      publishableKey: PUBLIC_CONFIG.publishableKey,
    });
    // ★ 先校验本地会话再拉模型：残留的失效会话会被清掉，
    //   否则它会一直 401，让页面永久停在「AI 暂不可用」。
    ensureSessionHealthy().catch(() => {}).then(() => loadModels());
  } catch (e) {
    console.error('[init] 云服务初始化失败:', e);
    const st = $('#ai-status');
    if (st) st.innerHTML = '<i class="dot dot-bad"></i>云服务初始化失败';
  }
}

function init() {
  if (!window.WorkBuddyCloud) {
    $('#ai-status').innerHTML = '<i class="dot dot-bad"></i>云服务未连接';
    toast('云服务 SDK 加载失败，请检查网络后刷新页面', 'err');
    /* 本地 vendor 缺失时才走 CDN 兜底：**异步补**，绝不阻塞 init ——
       否则第三方库慢/不可达会把整个应用卡在启动上（我第一版把启动"串"在兜底之后，
       在加载不到外部资源的环境里直接白屏 8 秒，测试环境 44 个用例当场全挂）。
       库到位后只补"云服务初始化"这一步，页面其余部分不受影响。 */
    ensureVendors().then(() => {
      if (window.WorkBuddyCloud && !state.cloud) initCloud();
    });
  } else {
    initCloud();
  }

  // ★ 事件绑定优先：只要绑定成功，页面就不会"点不动"
  safeInit('renderHome', renderHome);
  safeInit('renderGenChips', renderGenChips);
  safeInit('renderGradeOptions', renderGradeOptions);
  safeInit('loadCourses', loadCourses);
  safeInit('bindNav', bindNav);
  safeInit('bindAIStatusRetry', bindAIStatusRetry);
  safeInit('bindModelSelect', bindModelSelect);
  safeInit('bindMobileNav', bindMobileNav);
  safeInit('bindHomeEvents', bindHomeEvents);
  safeInit('bindLiveEvents', bindLiveEvents);
  safeInit('bindModalEvents', bindModalEvents);
  safeInit('bindModalA11yKeys', bindModalA11yKeys);
  safeInit('bindCheckupEvents', bindCheckupEvents);
  safeInit('loadTheme', loadTheme);            // 主题要在首屏就位，别等用户看到闪白
  safeInit('bindThemeEvents', bindThemeEvents);
  safeInit('bindParentReportEvents', bindParentReportEvents);
  safeInit('bindPapersEvents', bindPapersEvents);
  safeInit('renderPapers', renderPapers);
  safeInit('bindOwnPaperEvents', bindOwnPaperEvents);
  safeInit('bindBankEvents', bindBankEvents);
  safeInit('renderBank', renderBank);
  safeInit('renderProgressCard', renderProgressCard);
  safeInit('enhanceModalA11y', enhanceModalA11y);
  safeInit('watchModalFocus', watchModalFocus);
  safeInit('bindCourseListEvents', bindCourseListEvents);
  safeInit('bindAuthEvents', bindAuthEvents);
  safeInit('bindMemoryEvents', bindMemoryEvents);
  safeInit('bindLegalEvents', bindLegalEvents);
  safeInit('bindPhoneEvents', bindPhoneEvents);
  safeInit('bindTrackEvents', bindTrackEvents);
  safeInit('btn-generate', () => {
    $('#btn-generate').addEventListener('click', onGenerateClick);
    const dg = $('#btn-diag-gen');
    if (dg) dg.addEventListener('click', generateDiagnostic);
  });

  // 装饰性初始化放最后，失败也不影响交互
  safeInit('initAvatar', initAvatar);
  safeInit('initAvatarVideoEntry', initAvatarVideoEntry);
  safeInit('initAvatarVideo', initAvatarVideo);
  safeInit('initTTS', initTTS);
  /* 语音自检入口的绑定：必须在 init（不依赖登录），不能等 showTTSNotice —— 见其注释 */
  safeInit('bindTTSCheckButtons', bindTTSCheckButtons);
  safeInit('restoreTTSPref', restoreTTSPref);
  safeInit('restoreGuidePref', restoreGuidePref);
  // 账号与长期记忆：异步恢复会话，失败不影响页面
  safeInit('authUI', authUI);

  /* ★ 登录门禁（2026-09-29 重做，检查 agent 查出两处问题）：
     ① 必须在**同步阶段**先锁上。「未登录不允许跑」不能等异步的会话恢复 ——
        检查 agent 实测：老用户回来时 SDK 要先打一次 token 刷新，那段时间页面无门禁，
        未登录也能点到「生成课程」。同步锁**不会误伤已登录用户**，因为开屏这时还盖着。
     ② 开屏必须等门禁判定完再收 —— 否则上面那次同步锁会让老用户刷新时
        看到登录界面闪一下（这正是当初把判定推到 finally 的原因，现在两个诉求都满足了）。
     ③ 兜底：CSS 的 splash-auto-out 在 7 秒后强制淡出，auth 挂住也不会永久遮屏。 */
  try { enforceLoginGate(); } catch (e) { console.warn('[init] 登录门禁失败:', e); }
  initAuth()
    .catch((e) => { console.warn('[init] initAuth 失败:', e); renderMemoryView(); })
    .finally(() => {
      /* 会话恢复结束后再同步一次：已登录 → 解锁（开屏还没收，用户看不到这一下） */
      try { syncLoginGate(); } catch (e) { console.warn('[init] 登录门禁同步失败:', e); }
      /* 开屏收尾：门禁判定已定，现在把开屏收掉。
         云服务/模型目录是异步的，**不能拿它当"加载完成"的门槛**（慢网下会很晚），
         而"云服务未连接"本来就由右上角 #ai-status 如实显示 —— 不在这里重复。 */
      try { hideSplash(); } catch (_) {}
    });
  reportBootTime();
}

/* 启动：init 同步执行，绝不等第三方库（依赖缺失时只影响云功能，页面照常可用） */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* 测试钩子：把 const 声明的内部状态/常量挂到 window，供 jsdom 回归测试读写。
   生产运行时无副作用（仅暴露引用，不改变行为）。 */
try {
  Object.assign(window, {
    state, GUIDE_PROFILES, TTS, FACT_KINDS, MASTERY_LEVELS, buildMastery, renderMastery,
    /* R07：掌握度的退役判定 —— 时间解析与门槛都是可测的纯逻辑 */
    factTime, MASTERY_SUPERSEDE_HITS,
    ERROR_CAUSES, ERROR_CAUSE_KEYS, ERROR_CAUSE_MAX, normErrorCause, cleanErrorCauses,
    buildErrorProfile, renderCauses, renderErrorProfile,
    noteCauseSignals, flushLiveCauses, CAUSE_SIGNALS, setAIStatus,
    /* 入学诊断（起点画像） */
    DIAG_LEVELS, DIAG_MIN, DIAG_MAX, diagState,
    normDiagLevel, judgeDiagItem, buildDiagnostic, cleanDiagnostic,
    buildDiagnosticPrompt, diagnosticSystemPrompt, diagnosticPromptBlock,
    renderDiagnostic, renderDiagProfile, submitDiagnostic, generateDiagnostic,
    persistDiagnostic, renderMemoryDiag,
    guideProfile, setGuide, renderGuideBtn, restoreGuidePref, toggleMeta,
    openGuideModal, closeGuideModal,
    appendMessage, appendTyping, setCaptions,
    teacherSystemPrompt, renderSummary, buildLiveMessages, parseJSONLoose, repairJSONText,
    LIVE_HISTORY_KEEP, LIVE_DROPPED_KEEP, droppedStudentNotes,
    normalizeSlides, slideHTML, quizCountOf,
    /* 账号与长期记忆 */
    memoryPromptBlock, loadMemory, saveProfile, saveFacts, saveSession, deleteFact,
    memReady, authUI, authErr, onSignedIn, doSignOut, initAuth, openAuthModal, closeAuthModal,
    pickUser, fetchAuthUser, mergeUser,
    switchAuthTab, renderMemoryView, addMemoryFact, persistMemoryAfterClass, seedProfileFromLocal,
    continueAsGuest, dbPick, bindAuthEvents, bindMemoryEvents, switchView, bindMobileNav,
    /* AI 可用性与登录态自愈 */
    loadModels, setAIStatus, bindAIStatusRetry, requireModel, streamChat,
    isAuthError, healSession, ensureSessionHealthy, mapLLMError, PUBLIC_CONFIG,
    isChatModel, modelScore, rankModels, pickPreferredModel, applyModel, setModel, renderModelSelect,
    bindModelSelect, fastestAlternativeModel, errCode, slowModelError, emptyAnswerError,
    MODEL_PREFERENCE, MODEL_KEY, FIRST_CONTENT_BUDGET_MS,
    /* 弹窗可访问性 */
    allMasks, openMasks, enhanceModalA11y, watchModalFocus, bindModalA11yKeys, syncBodyScrollLock,
    /* 法律合规 */
    LEGAL_VERSION, LEGAL_EFFECTIVE, LEGAL_REVISION, PRIVACY_DOC, TERMS_DOC, DOCS, hasConsent, setConsent, consentChecked, requireConsent,
    openDoc, closeDoc, agreeDoc, normalizeCNPhone, phoneMask, smsErr, signInFromPhone,
    openAccountModal, closeAccountModal, exportMyData, deleteMyAccount, acctMsg, bindLegalEvents, CONSENT_KEY,
    /* 内容存储的归属隔离（R01/R04）：测试要能直接驱动"切账号"这件事 */
    CONTENT_KEYS, CLOUD_USER_TABLES, storageOwnerKey, scopedContentKey,
    readContentRaw, writeContentRaw, claimLegacyContent, switchStorageOwner, clearContentForOwner,
    /* 手机号登记（应用层） */
    currentPhone, registerPhone, renderAcctPhone, bindPhoneEvents,
    /* 成本闸门与埋点 */
    AI_LIMIT, aiGateCheck, aiGateRecord, aiGateRead, aiGateWrite, aiGateSnapshot, aiGateError, track, TRACK_EVENTS,
    addFixButton, bindTrackEvents,
    /* 数字人形象视频（无生成能力，只是应用/取消） */
    AVATAR, initAvatarVideoEntry, generateAvatarVideo, probeVideo, openAvatarModal,
    /* 学习助教（常驻角色 + 真实随堂记录） */
    assistantPeer, assistantLog, renderAssistantLog, focusAssistantLog,
    /* 下课二次确认 */
    confirmEndLive, resetEndConfirm,
    /* 限流自愈 */
    isQuotaOrRateError,
    /* 一个人一个账号：设备闸门（服务端强制） */
    deviceFingerprint, deviceAlreadyUsed, deviceClaim, DEVICE_KEY,
    /* 手机号要求（门禁） */
    needsPhone, ensurePhone, saveGatePhone, phoneGateMsg,
    /* 注册风控：一次性邮箱 + 手机号共用检测 */
    isThrowawayMail, THROWAWAY_MAIL_DOMAINS, phoneHash, fallbackPhoneHash, phoneClaim, sharedPhoneNote,
    /* 不可信输入归一化（云端/本地/模型三路收口） */
    asArray, asObject, normalizeFacts, normalizeCourse, normalizeCourses, normalizeDiagProfile,
    applyGenSystem, peekCourseTitle,
    COURSE_TYPES, getCourseType, courseTypeBlock, courseTypeTeachBlock,
    speechProsody, voiceTier, speechPlan, currentVoiceQuality, SPEECH_PAUSE, VOICE_TIERS,
    teacherFaceSVG, avatarStyle, setAvatarStyle, applyAvatarStyle, AVATAR_STYLE_KEY,
    FIGURE_KINDS, figureSVG, normalizeFigure, figureCaption,
    hideSplash, reportBootTime, syncGenButton, onGenerateClick,
    runSelfCheck, renderCheckup, openCheckup,
    validateCourseware, reportCoursewareQuality,
    buildParentReport, parentReportText, parentReportImage, openParentReport,
    EXAM_LIBRARY, EXAM_ACCESS, papersBySystem, renderPapers, makePaperStylePractice,
    extractPdfText, handleOwnPaperFile, runOwnPaper, doSplitToBank,
    loadBank, saveBank, bankStats, cleanBankItems, bankAdd, bankDelete, bankClearSource, bankAll,
    salvageObjects, parseSplitResult,
    PROGRESS_FORMAT, PROGRESS_VERSION, PROGRESS_KEYS, PROGRESS_PREF_KEYS, progressChecksum,
    buildProgressSnapshot, validateProgressFile, previewProgressImport, applyProgressImport,
    undoProgressImport, hasProgressBackup, renderProgressCard, exportProgress, handleProgressFile,
    armGestureRetry, notifyTTSProblem, ttsHealth,
    runTTSSelfCheck, ttsFacts, renderSelfCheck, hideTTSCheckEntry,
    renderBank, bankFiltered, bankExport, BANK_KEY, BANK_TYPES, BANK_DIFF,
    currentTheme, applyTheme, setTheme, toggleTheme, loadTheme,
    SUBJECT_EXAMPLES, subjectExampleHint, exampleScaleHint, genSubjectContext,
    FIGURE_SUBJECTS, figureAllowed,
    SYSTEMS, buildCourseOutlinePrompt, teacherSystemPrompt, courseSystemPrompt,
    persistCourses, REC_MAX_EVENTS, recordEvent,
    trackLater, flushPendingTracks, TRACK_PENDING_KEY,
    /* 语音朗读（听不到老师讲课的修复 + 听感优化） */
    ttsHealth, ensureVoiceReady, notifyTTSProblem, syncVoiceBtn, ttsPrefOff,
    speakableText, splitSentences, SPEECH_RATES, cycleSpeechRate, loadSpeechRate, bindSpeakRateLongPress,
    /* 增量分句：实时朗读的入口，必须有行为测试（之前全是 grep 源码，等于没测） */
    completeSentences, scanSentences, sentencesWithTail,
    /* 云端 endpoint 判定（含 file:// 兜底） */
    resolveCloudEndpoint,
    /* 课程读写：导入/撤销"有没有真的落盘"要靠这两支来做行为断言 */
    persistCourses, loadCourses,
    /* 同步：R01 的实质断言要验"上传的载荷里有没有别的账号的课程" */
    syncCourses,
    /* R02：待同步队列 / 墓碑 / 冲突判定 —— 都要能被行为测试直接驱动 */
    SYNC_QUEUE_BASE, syncQueueKey, loadSyncQueue, saveSyncQueue, pendingSyncCount,
    markCourseDirty, markCourseDeleted, renderSyncStatus, saveCourse,
    /* R18：流式取消的两条路径必须等价 —— 直接驱动 streamChat 来验 */
    streamChat, finishInterruptedSegment,
    /* R17：小结的"已掌握"必须有作答证据 —— 这是确定性守卫，必须能被行为测试直接驱动。
       提示词纪律（0-3 条 / 未作答不给结论）无法被测试断言，但守卫可以。 */
    guardSummaryEvidence,
    /* 登录门禁：测试要能直接驱动它（登出后是否重新上锁等） */
    isSignedIn, enforceLoginGate, releaseLoginGate, syncLoginGate, requireSignedIn,
    getGateState,
    checkpointLive, startLiveCheckpoint, stopLiveCheckpoint,
    setSpeechRate, rateLabel, TEACH_LANGS, teachLang, teachLangProfile, setTeachLang, loadTeachLang,
    langNote,
    openVoiceModal, closeVoiceModal, renderVoiceSettings, bindVoiceSettingsEvents,
  });
} catch (_) {}
