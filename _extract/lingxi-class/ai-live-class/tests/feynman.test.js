/* 费曼学习法（Web 端）· 课堂内教学法 + 课后「讲给我听」环节
   ============================================================
   「添加费曼学习法」这件事有两个独立的失败模式，分开测：

   ① **提示词没进去**（开关开了但老师没按费曼的方式教）。
      这类用"组装出来的提示词里有没有那一段"就能测，且必须带反向对照 ——
      只测"开了有"会漏掉"关了也照样有"这种更常见的 bug。

   ② **验收记录是编的**（学生只讲了两句，AI 照样给出三条"你讲清楚了"）。
      这是 R17 同一类事故：模型在**复述知识点清单**，不是在评价这个学生。
      提示词是请求、不是保证 —— 所以必须有一条**确定性守卫**，
      而守卫的判据是"学生到底讲了几句、几个字"，这是可数的。
      本文件的 N 组与 P 组就是钉死这件事。

   注意 P 组：**同一份"不守纪律"的模型输出**，在"讲得够多"与"讲得太少"
   两种输入下必须得到**相反**的结论 —— 否则一个"永远判 insufficient"的
   退化实现也能全绿（那种绿比红更危险）。
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const SITE = 'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host/';

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (typeof cond !== 'boolean') {
    fail++; console.log('FAIL ' + label + '   ←  断言写法错误：条件必须是 boolean，实际收到 ' + typeof cond);
    return;
  }
  if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

/* 小结 JSON：给「讲给我听」提供"这节课讲过什么"的清单 */
const SUMMARY_JSON = JSON.stringify({
  mastered: ['勾股定理', '逆定理的判定'],
  weakPoints: ['为什么是平方和'],
  homework: ['做 3 道题'],
  cards: [{ q: '勾股定理讲的是什么关系？', a: '两直角边平方和等于斜边平方。' }],
  reviewPlan: [],
  memoryFacts: [],
  errorCauses: [],
  comment: '继续加油',
});

/* ★ 刻意"不守纪律"的验收输出：学生可能只讲了两句，模型却给了 3 条"你讲清楚了"。
   守卫的职责就是把它清掉。两个场景共用这一份，才测得出"守卫真的在判断"。 */
const UNRULY_VERDICT = JSON.stringify({
  explained: ['勾股定理', '逆定理的判定', '平方和的意义'],
  skipped: ['为什么必须是最长边'],
  comment: '整体讲得不错，回去再看一眼证明。',
});

/* 云服务桩：捕获每一次请求的 messages 与生成参数 */
function makeCloud(captured) {
  const noopChain = () => ({
    select() { return this; }, limit() { return this; }, order() { return this; },
    eq() { return this; }, maybeSingle() { return this; }, update() { return this; },
    insert() { return this; }, upsert() { return this; }, delete() { return this; },
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
    catch: (r) => Promise.resolve({ data: [], error: null }).catch(r),
  });
  return {
    llm: {
      models: { list: async () => [{ id: 'm1', name: 'M1', disabled: false }] },
      chat: { completions: {
        create: function (body) {
          const msgs = (body && body.messages) || [];
          const sys = String((msgs[0] && msgs[0].content) || '');
          let kind = 'other';
          if (sys.indexOf('"explained"') >= 0) kind = 'verdict';
          else if (sys.indexOf('完全不懂') >= 0 && sys.indexOf('只当听众') >= 0) kind = 'listener';
          else if (sys.indexOf('"mastered"') >= 0) kind = 'summary';
          captured.push({ kind, system: sys, messages: msgs, body });
          const text = kind === 'verdict' ? UNRULY_VERDICT
            : kind === 'summary' ? SUMMARY_JSON
            : '那……为什么会这样呢？你能举个例子吗？';
          /* ★ 必须同步返回 async generator 实例（见 R17 测试里的同类注释） */
          return (async function* () {
            for (let i = 0; i < text.length; i += 60) {
              yield { choices: [{ delta: { content: text.slice(i, i + 60) } }] };
            }
          })();
        },
      } },
    },
    auth: {
      getSession: async () => ({ data: null, error: null }),
      getUser: async () => ({ data: null, error: { kind: 'unauthenticated' } }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => () => {},
    },
    database: { from: noopChain, rpc: async () => ({ data: null, error: null }) },
  };
}

function makeCourse() {
  return {
    id: 'fey1', title: '勾股定理', subject: '数学', grade: '初二', level: '提高', duration: '45 分钟',
    system: 'cn', systemName: '国内课程', systemIco: 'CN', createdAt: Date.now(), progress: 0,
    boards: [], boardNames: [],
    outline: {
      title: '勾股定理', knowledgePoints: ['勾股定理'],
      stages: [{ name: '导入', duration: '5', content: 'c' }], homework: ['h'],
      slides: [
        { type: 'cover', title: '勾股定理', subtitle: 's' },
        { type: 'content', title: '勾股定理', bullets: ['平方和'], note: 'n' },
        { type: 'summary', title: '小结', bullets: ['x'], note: '' },
      ],
    },
  };
}

/* 注入方式必须用 runScripts:'dangerously' + 插入 <script> 元素 ——
   outside-only 下动态 append 的 script 不执行；window.eval 下顶层函数声明不挂 window。 */
function freshApp(captured) {
  const dom = new JSDOM(html, { url: SITE, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true; w.alert = () => {};
  w.scrollTo = () => {};
  w.speechSynthesis = { getVoices: () => [{ name: 'Xiaoxiao', lang: 'zh-CN' }], speak() {}, cancel() {}, onvoiceschanged: null };
  w.SpeechSynthesisUtterance = function (txt) { this.text = txt; };
  w.WorkBuddyCloud = { createWorkBuddyCloud: () => makeCloud(captured) };
  const sc = w.document.createElement('script');
  sc.textContent = appJs;
  w.document.head.appendChild(sc);
  return w;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openApp(captured) {
  const w = freshApp(captured || []);
  await wait(30);                                   // 等 init()，否则后面写的 state 会被会话恢复覆盖
  w.state.user = { id: 'u-fey', email: 'fey@example.com', anonymous: false };
  w.state.memLoaded = false;
  w.state.model = { id: 'm1', name: 'M1' };
  return w;
}

/* 直接构造一个"讲了多少"的会话，避免每个用例都要跑一遍真实对话 */
function mkTalk(contents) {
  return {
    course: makeCourse(),
    covered: '勾股定理；逆定理的判定',
    messages: [{ role: 'assistant', content: 'W' }].concat(
      contents.reduce((acc, c, i) => acc.concat([{ role: 'user', content: c }, { role: 'assistant', content: 'A' + i }]), [])),
    busy: false, done: false, verdict: null,
  };
}

/* ============================================================ */
(async () => {

  /* ---------------- K 组：开关本身 ---------------- */
  sec('K. 费曼开关：状态、持久化、与其它开关互不干扰');
  {
    const w = await openApp([]);
    t('K0 toggleFeynman 已导出', typeof w.toggleFeynman === 'function');
    t('K1 renderFeynmanSwitch 已导出', typeof w.renderFeynmanSwitch === 'function');

    t('K2 默认关闭（它是加在苏格拉底之上的额外要求，不该默认开）', w.state.feynman === false);

    const sw = w.document.getElementById('guide-feynman');
    t('K3 面板里真的有这个开关（不是只写了函数没接线）', !!sw);
    t('K4 初始 aria-checked=false', sw.getAttribute('aria-checked') === 'false');
    t('K5 初始不带 .on', sw.classList.contains('on') === false);

    /* 真实点击，而不是直接调函数 —— 要证明接线也在 */
    sw.click();
    t('K6 点一下 → state.feynman 变 true', w.state.feynman === true);
    t('K7 点一下 → 开关视觉同步（.on）', sw.classList.contains('on') === true);
    t('K8 点一下 → aria-checked 同步', sw.getAttribute('aria-checked') === 'true');
    t('K9 写入 localStorage（换设备/刷新还能记住）', w.localStorage.getItem('lingxi_feynman') === '1');

    sw.click();
    t('K10 再点一下 → 关闭', w.state.feynman === false);
    t('K11 关闭也写入 localStorage（不是只在开的时候写）', w.localStorage.getItem('lingxi_feynman') === '0');

    /* 反向对照：费曼开关不能顺手改掉元认知与引导强度 */
    w.state.meta = true; w.state.guide = 'balanced';
    w.toggleFeynman(true);
    t('K12 开费曼不动元认知', w.state.meta === true);
    t('K13 开费曼不动引导强度', w.state.guide === 'balanced');

    /* 恢复：显式 '1' 才开，其它值都关 */
    w.state.feynman = false;
    w.localStorage.setItem('lingxi_feynman', '1');
    w.restoreGuidePref();
    t('K14 恢复：存的是 1 → 打开', w.state.feynman === true);
    w.state.feynman = false;
    w.localStorage.setItem('lingxi_feynman', 'garbage');
    w.restoreGuidePref();
    t('K15 恢复：存了脏值 → 保持关闭（不因为读不懂就默认开）', w.state.feynman === false);
    w.localStorage.removeItem('lingxi_feynman');
    w.restoreGuidePref();
    t('K16 恢复：没有这个键 → 保持关闭', w.state.feynman === false);
  }

  /* ---------------- L 组：提示词组装 ---------------- */
  sec('L. 提示词：开了才进，且不动其它段落');
  {
    const w = await openApp([]);
    const c = makeCourse();

    w.state.feynman = false;
    const off = w.teacherSystemPrompt(c);
    t('L1 关闭时不出现【费曼学习法】', off.indexOf('【费曼学习法】') < 0);
    t('L2 关闭时也不出现费曼的核心要求（防止"半开"）', off.indexOf('讲给外行听') < 0);
    t('L3 苏格拉底那一段始终在（费曼是叠加，不是替换）', off.indexOf('【苏格拉底式提问】') >= 0);

    w.state.feynman = true;
    const on = w.teacherSystemPrompt(c);
    t('L4 开启后出现【费曼学习法】', on.indexOf('【费曼学习法】') >= 0);
    t('L5 开启后仍有【苏格拉底式提问】（两者共存）', on.indexOf('【苏格拉底式提问】') >= 0);
    t('L6 提示词里点明了"讲给外行听"', on.indexOf('讲给外行听') >= 0);
    t('L7 提示词里点明了"找出卡壳处"', on.indexOf('卡壳') >= 0);
    t('L8 提示词里点明了"回补再讲"', on.indexOf('重讲一遍') >= 0);
    t('L9 ★ 明令禁止替学生总结（这是环节成败的关键）', on.indexOf('绝对不要替学生总结') >= 0);
    t('L10 提示词说明了它与"苏格拉底综合"的分工（否则模型会合并成一次）',
      on.indexOf('不要合并成一次') >= 0);
    t('L11 开启只多出费曼那一段，不是整篇重写（长度增加在合理区间）',
      on.length > off.length && on.length - off.length < 1400);

    /* 开关切换要让老师"当场"知道 —— 与 setGuide 同一套隐藏指令机制 */
    await w.enterLive(c);
    await wait(600);                                   // 等开场白吐完，否则 before 会少算一条
    const before = w.state.live.messages.length;
    w.toggleFeynman(true);
    /* ⚠ 必须等一下再断言：sendLive 的第一句是 `await requireModel()`，
       隐藏指令是在那个 await **之后**才推进 messages 的 —— 同步断言会读到 0 条
       （不是功能坏了，是我读得太早）。 */
    await wait(120);
    /* ★ 不能断言"新增恰好 1 条"：老师收到隐藏指令后还会**回一句话**，
       所以新增通常是 2 条（指令 + 回复）。要断言的是"其中有一条隐藏指令" ——
       写死条数会随无关的实现细节（比如老师回不回话）变红。 */
    const added = w.state.live.messages.slice(before);
    const hiddenMsg = added.filter((m) => m.hidden === true)[0];
    t('L12 课中切换会立刻告诉老师（发了隐藏指令）', !!hiddenMsg);
    t('L13 那条指令是 hidden（学生看不到）', !!(hiddenMsg && hiddenMsg.hidden === true));
    t('L14 指令内容确实是费曼的（不是把引导强度那条复制过来）',
      !!(hiddenMsg && String(hiddenMsg.content).indexOf('费曼') >= 0));
    t('L15 指令里要求"不要解释这条设置"（否则模型会回一句"好的，我们开始用费曼"）',
      !!(hiddenMsg && String(hiddenMsg.content).indexOf('不要解释这条设置') >= 0));
    t('L15b 关闭时也发指令，且说的是"回到原来的节奏"', await (async () => {
      const b2 = w.state.live.messages.length;
      w.toggleFeynman(false);
      await wait(120);
      const h2 = w.state.live.messages.slice(b2).filter((m) => m.hidden === true)[0];
      return !!(h2 && String(h2.content).indexOf('不必再要求') >= 0);
    })());
    w.toggleFeynman(true);                             // 复原，供下面 L16/L17 用
    await wait(120);

    /* 隐藏指令不能污染模型上下文 */
    const msgs = w.buildLiveMessages();
    t('L16 隐藏指令不进模型上下文（否则学生会听到"（学生开启了费曼学习法）"）',
      msgs.every((m) => String(m.content).indexOf('不要解释这条设置') < 0));
    t('L17 但切换之后的提示词已经带上了费曼段',
      msgs[0] && String(msgs[0].content).indexOf('【费曼学习法】') >= 0);
  }

  /* ---------------- M 组：小白听众的角色约束 ---------------- */
  sec('M. 小白听众：只提问，不许帮忙');
  {
    const w = await openApp([]);
    t('M0 feynmanListenerPrompt 已导出', typeof w.feynmanListenerPrompt === 'function');
    const p = w.feynmanListenerPrompt(makeCourse(), { covered: '勾股定理；逆定理的判定' });

    t('M1 角色设定是"完全不懂"', p.indexOf('完全不懂') >= 0);
    t('M2 明确"只当听众，不是老师"', p.indexOf('只当听众') >= 0);
    t('M3 ★ 禁止替学生总结', p.indexOf('绝对不要替学生总结') >= 0);
    t('M4 ★ 禁止补充知识点 / 给答案', p.indexOf('绝对不要补充知识点') >= 0);
    t('M5 不许评价或表扬（"不要夸他讲得好"）', p.indexOf('不要夸他讲得好') >= 0);
    t('M6 一次只问一个问题', p.indexOf('一次只问') >= 0);
    t('M7 提问只基于学生讲过的内容（否则会把他引到自己没讲的地方）',
      p.indexOf('只基于他刚讲过的内容') >= 0);
    t('M8 带上了课程标题', p.indexOf('勾股定理') >= 0);
    t('M9 带上了本节课要点清单', p.indexOf('逆定理的判定') >= 0);
    t('M10 明说清单"不要主动报出来"（否则学生会被喂答案）',
      p.indexOf('不要主动报出来') >= 0);
    t('M11 红线：不许自称老师、不许替学生归纳', p.indexOf('【红线】') >= 0);

    const p2 = w.feynmanListenerPrompt(makeCourse(), {});
    t('M12 没有清单时也不崩、仍然保留全部角色约束',
      p2.indexOf('完全不懂') >= 0 && p2.indexOf('绝对不要替学生总结') >= 0);
    t('M13 没有清单时不出现空的"清单"残留', p2.indexOf('知识点清单') < 0);
  }

  /* ---------------- N 组：验收守卫的边界 ---------------- */
  sec('N. guardFeynTalkVerdict：讲得太少就不许给正面结论');
  {
    const w = await openApp([]);
    const g = w.guardFeynTalkVerdict;
    t('N0 守卫已导出', typeof g === 'function');
    t('N1 阈值常量已导出（测试据它构造边界，不写死数字）',
      typeof w.FEYNTALK_MIN_TURNS === 'number' && typeof w.FEYNTALK_MIN_CHARS === 'number');

    const mk = () => ({ explained: ['a', 'b', 'c'], skipped: ['x'], comment: 'c' });

    const r1 = g(mk(), { turns: 0, chars: 0 });
    t('N2 一句没讲 → 清空 explained', r1.explained.length === 0);
    t('N3 一句没讲 → 连 skipped 也清掉（没讲就谈不上"绕过了什么"）', r1.skipped.length === 0);
    t('N4 标记 insufficient', r1.insufficient === true);
    t('N5 记录被丢弃的条数（不是静默丢弃）', r1.droppedUnverified === 3);
    t('N6 comment 原样保留（总评不算"结论"，可以留）', r1.comment === 'c');

    const r2 = g(mk(), { turns: 1, chars: 200 });
    t('N7 只讲 1 次（哪怕字多）→ 仍算不够', r2.explained.length === 0 && r2.insufficient === true);
    const r3 = g(mk(), { turns: 5, chars: 10 });
    t('N8 讲了 5 次但统共 10 个字（"嗯""哦""对"）→ 也算不够',
      r3.explained.length === 0 && r3.insufficient === true);

    const r4 = g(mk(), { turns: w.FEYNTALK_MIN_TURNS, chars: w.FEYNTALK_MIN_CHARS });
    t('N9 ★ 恰好到阈值 → 原样保留（反向对照：守卫不是"永远清空"）',
      r4.explained.length === 3 && r4.insufficient === undefined);
    const r5 = g(mk(), { turns: 3, chars: 300 });
    t('N10 讲得足够多 → 原样保留', r5.explained.length === 3);
    t('N11 讲得足够多 → 不写 droppedUnverified', r5.droppedUnverified === undefined);

    const r6 = g(mk());                      // 没传 stats
    t('N12 stats 缺失时按"没讲"保守处理（宁可说没讲够）',
      r6.explained.length === 0 && r6.insufficient === true);

    t('N13 null 输入原样返回不崩', g(null, { turns: 9, chars: 999 }) === null);
    t('N14 字符串输入原样返回不崩', g('x', { turns: 9, chars: 999 }) === 'x');
    t('N15 原地返回同一对象', (() => { const o = mk(); return g(o, { turns: 9, chars: 999 }) === o; })());
    t('N16 explained 缺字段时不崩', (() => { const o = { skipped: ['x'] }; g(o, { turns: 0, chars: 0 }); return Array.isArray(o.explained) && o.explained.length === 0; })());
  }

  /* ---------------- O 组：统计口径 ---------------- */
  sec('O. feynTalkStudentStats：只数学生、忽略空白');
  {
    const w = await openApp([]);
    const s = w.feynTalkStudentStats;
    t('O0 已导出', typeof s === 'function');

    const a = s(mkTalk(['你好', '我再讲讲']));
    t('O1 只数 user 消息（AI 的提问不算学生讲的）', a.turns === 2);
    t('O2 字数为学生原文去空白后的长度（2 + 4 = 6）', a.chars === 6, String(a.chars));

    const b = s(mkTalk(['  ', '\n\t']));
    t('O3 纯空白不算内容（防止"敲了几个空格"凑够字数）', b.chars === 0);

    const c = s(null);
    t('O4 null 输入返回 0/0 不崩', c.turns === 0 && c.chars === 0);
    const d = s({ messages: null });
    t('O5 messages 非数组时返回 0/0 不崩', d.turns === 0 && d.chars === 0);
  }

  /* ---------------- P 组：端到端 ---------------- */
  sec('P. 端到端：从小结进入 → 讲一轮 → 验收');
  {
    const captured = [];
    const w = await openApp(captured);
    const c = makeCourse();

    /* 先跑一节真实的课并下课，拿到真实小结（顺便验证入口真的挂在小结里） */
    await w.enterLive(c);
    await wait(400);
    const body = w.document.getElementById('summary-body');
    w.renderSummary(JSON.parse(SUMMARY_JSON), null, null, c);
    const entry = w.document.getElementById('btn-open-feyntalk');
    t('P1 小结里真的有「讲给我听」入口', !!entry);
    t('P2 入口文案点明这是费曼学习法',
      body.textContent.indexOf('费曼学习法') >= 0);
    t('P3 文案里承诺"不会替你总结"（与角色设定一致）',
      body.textContent.indexOf('不会替你总结') >= 0);

    t('P4 进入前弹窗是关的', w.document.getElementById('feyntalk-modal').hidden === true);
    entry.click();
    t('P5 点入口 → 弹窗打开', w.document.getElementById('feyntalk-modal').hidden === false);
    t('P6 标题带上了课程名', w.document.getElementById('feyntalk-title').textContent.indexOf('勾股定理') >= 0);

    const log = w.document.getElementById('feyntalk-log');
    t('P7 听众先开口（学生不用凭空起头）', log.textContent.indexOf('讲给我听') >= 0);
    t('P8 ★ 开场白里就说明了"别用课本上的说法"（费曼的关键约束前置）',
      log.textContent.indexOf('别用课本上的说法') >= 0);

    /* 听众的系统提示词确实进了请求 */
    const built = w.buildFeynTalkMessages(w.state.feynTalk);
    t('P9 首条是 system', built[0] && built[0].role === 'system');
    t('P10 system 就是小白听众提示词', String(built[0].content).indexOf('完全不懂') >= 0);
    t('P11 首条之后不是 assistant（否则部分模型直接报错）', built[1] && built[1].role === 'user');
    t('P12 清单已从小结带进来', String(built[0].content).indexOf('逆定理的判定') >= 0);

    /* ★ 讲得足够多：模型给的那份"不守纪律"的输出应当被原样接受 */
    w.state.feynTalk = mkTalk([
      '勾股定理就是说，一个直角三角形，两条直角边各自乘自己再加起来，等于斜边乘自己。',
      '我举个例子，一个直角三角形两条直角边是三和四，那斜边就是五，因为九加十六等于二十五。',
    ]);
    w.closeFeynTalk();
    w.document.getElementById('feyntalk-modal').hidden = false;
    w.renderFeynTalk();
    await w.finishFeynTalk();
    const v = w.state.feynTalk.verdict;
    t('P13 讲得够多 → 验收记录给出结论', !!(v && v.explained.length === 3));
    t('P14 讲得够多 → 不标记 insufficient', !!(v && v.insufficient === undefined));
    t('P15 ★ 验收请求用的是"评估员"提示词，不是听众提示词（让一无所知的人来评判是错的）',
      captured.some((x) => x.kind === 'verdict'));
    t('P16 验收提示词要求"没提到的不许写进 explained"',
      (captured.find((x) => x.kind === 'verdict') || {}).system.indexOf('不许') >= 0);
    t('P17 验收提示词里带上了学生原话',
      (captured.find((x) => x.kind === 'verdict') || {}).system.indexOf('两条直角边') >= 0);
    t('P18 结果渲染进了 DOM', w.document.getElementById('feyntalk-verdict').textContent.indexOf('你讲清楚了') >= 0);
    t('P19 结束后按钮禁用（防止重复提交）', w.document.getElementById('feyntalk-send').disabled === true);

    /* ★★ 同一份模型输出，学生只讲一句 → 必须得到**相反**的结论 */
    const cap2 = [];
    const w2 = await openApp(cap2);
    await w2.enterLive(c);
    await wait(400);
    w2.state.feynTalk = mkTalk(['嗯……就是那个，直角边和斜边的关系吧。']);
    await w2.finishFeynTalk();
    const v2 = w2.state.feynTalk.verdict;
    t('P20 ★ 同样一份"不讲纪律"的模型输出，学生讲得太少 → 结论被拦下',
      !!(v2 && v2.explained.length === 0 && v2.insufficient === true));
    const vtext = w2.document.getElementById('feyntalk-verdict').textContent;
    t('P21 ★ 界面如实说明"还不足以看出哪里讲清楚了"', vtext.indexOf('还不足以看出哪里讲清楚了') >= 0);
    t('P22 ★ 那三条编出来的"你讲清楚了"一条也没显示出来',
      vtext.indexOf('逆定理的判定') < 0);
    t('P23 但给出了下一步怎么做（不是只说不行）', vtext.indexOf('卡在哪里都比不讲有价值') >= 0);

    /* 一句话都没讲就要验收 → 直接拦住，且不调用模型 */
    const cap3 = [];
    const w3 = await openApp(cap3);
    w3.state.feynTalk = mkTalk([]);
    await w3.finishFeynTalk();
    t('P24 一句没讲 → 不给验收记录', !w3.state.feynTalk.verdict);
    t('P25 一句没讲 → 连模型都不调用（不烧 token 去评一份空白）',
      cap3.filter((x) => x.kind === 'verdict').length === 0);
    t('P26 一句没讲 → 也没有置 done（学生还能继续讲）', w3.state.feynTalk.done === false);

    /* 学生真的讲一轮时，发出的是听众提示词 */
    const cap4 = [];
    const w4 = await openApp(cap4);
    await w4.enterLive(c);
    await wait(400);
    w4.state.feynTalk = { course: c, covered: '', messages: [{ role: 'assistant', content: 'W' }], busy: false, done: false, verdict: null };
    await w4.sendFeynTalk('勾股定理就是两条直角边的平方和等于斜边的平方。');
    const listeners = cap4.filter((x) => x.kind === 'listener');
    t('P27 学生讲一轮 → 用的是听众提示词（不是老师提示词）', listeners.length === 1);
    t('P28 学生那句话真的进了请求', listeners.length === 1 &&
      listeners[0].messages.some((m) => m.role === 'user' && String(m.content).indexOf('平方和') >= 0));
    t('P29 听众的回复进了对话记录', w4.state.feynTalk.messages.filter((m) => m.role === 'assistant').length === 2);
    t('P30 结束后不再让讲（busy 已复位，未 done）',
      w4.state.feynTalk.busy === false && w4.state.feynTalk.done === false);

    /* 空输入不该产生请求 */
    const n0 = cap4.length;
    await w4.sendFeynTalk('   ');
    t('P31 空白输入不发请求', cap4.length === n0);
  }

  console.log('\n----------------------------------------');
  console.log('费曼学习法（Web）通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试脚本异常: ' + (e && e.stack || e));
  process.exit(2);
});
