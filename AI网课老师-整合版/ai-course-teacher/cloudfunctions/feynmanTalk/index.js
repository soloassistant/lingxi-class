/* ============================================================
   「讲给我听」云函数 —— 费曼学习法的课后验收环节（2026-10-01 新增）

   为什么单独建一个云函数，而不是复用 aiInterject：
     ① **角色完全不同**。aiInterject 是"老师回答学生"，这个是"什么都不懂的人
        向学生提问"。两者在提示词层面是相反的指令，混在一个函数里迟早会被改串。
     ② **验收需要服务端判定**。学生讲了多少（几次、几个字）必须由**服务端**自己数
        history 算出来，不能接受客户端传进来的统计值 —— 否则前端一个 bug
        就能让"一句话没讲"拿到一份"你讲得很好"的验收。这也是 R12 的同一条教训：
        凡是"能不能给结论"的判断，判据要从可信来源取。

   两个 action：
     listen  （默认）→ 小白听众回一句追问            { code:0, reply }
     verdict         → 出一份验收记录                { code:0, verdict:{...} }
   ============================================================ */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ★ 与 Web 端保持一致的两个阈值。改这里必须同步改
   _extract/lingxi-class/ai-live-class/js/app.js 的 FEYNTALK_MIN_TURNS / _MIN_CHARS，
   否则同一个学生在两端会得到不同结论。 */
const MIN_TURNS = 2;
const MIN_CHARS = 60;

/* 只数**学生**说过的话。空白不算 —— 防止敲几个空格凑够字数。 */
function studentStats(hist) {
  const mine = (Array.isArray(hist) ? hist : []).filter(h => h && h.role === 'user');
  const chars = mine.reduce((n, h) => n + String(h.content || '').replace(/\s/g, '').length, 0);
  return { turns: mine.length, chars };
}

function listenerPrompt(topic, subject, covered, hist) {
  /* ★ 必须把对话历史写进提示词 —— 本函数是无状态的，aiProxy 每次只收到这一条 prompt。
     漏掉它会发生什么（本文件第一版就是这个 bug，被测试 C12 抓到）：
     听众每次都用同一句"那为什么呢？"，学生讲了五遍，它还在问第一遍的问题 ——
     多轮变成了复读，整个环节就废了。 */
  const convo = (Array.isArray(hist) ? hist : [])
    .map(h => (h.role === 'user' ? '学生' : '你') + '：' + String(h.content || '').trim())
    .join('\n');
  return '你现在扮演一个**完全不懂' + subject + '的初学者**，坐在学生对面。'
    + '学生刚上完一节课《' + topic + '》，现在轮到他讲给你听 —— 这正是费曼学习法：'
    + '能不能把一件事讲给外行听懂，是检验他有没有真学会的唯一标准。'
    + (covered ? '\n本节课大致讲过这些内容（供你判断他有没有讲漏，但**不要主动报出来**）：' + covered : '')
    + '\n\n【你们刚才的对话】\n' + (convo || '（还没开始）')
    + '\n（★ 请**接着往下**问：不要重复你已经问过的问题，不要回头讲你已经表示听懂的部分。'
    + '他现在刚说完最后那句"学生：…"，你就针对**那一句**继续问。）\n'
    + '\n【你的角色：只当听众，不是老师】\n'
    + '  · 你**真的什么都不懂**。你唯一的目标是"让他把我讲明白"。\n'
    + '  · **绝对不要替学生总结、不要复述他刚说过的话**。他一听你归纳了，就不会再自己组织语言了。\n'
    + '  · **绝对不要补充知识点、不要纠正他的错误、不要告诉他正确答案**。你现在是学生不是老师。\n'
    + '  · 他讲错了怎么办：不要指出"你错了"，而是**用听不懂的方式表达出来** ——'
    + '比如"等一下，你刚说 A 又说是 B，这两个是同一个东西吗？"让他自己发现矛盾。\n'
    + '  · 不要夸他讲得好，也不要评价。你只是个想听懂的初学者。\n'
    + '\n【你怎么说话】\n'
    + '  · 一次只问**一个**问题，问完就停下来等他讲。\n'
    + '  · 句子短、口语化，可以用"嗯……""等一下""那是为什么呀"这类真实的听感。\n'
    + '  · 问题要**只基于他刚讲过的内容**，不要引入他没提过的概念。\n'
    + '  · 三种最有用的问题形态：① 听不懂术语（"你说的这个词是什么意思呀？能用别的话说吗？"）'
    + '② 要一个例子（"能举个例子吗？"）③ 逻辑断点（"那为什么这里就变成那样了呢？"）。\n'
    + '  · 他讲得含糊（只背了结论、跳过一步）时，就**盯着那一点追问**，不要礼貌地放过。\n'
    + '  · 每轮 1~2 句，不要长。这是聊天，不是讲课。\n'
    + '\n【红线】不许出现"作为老师""我帮你总结一下""你刚才讲的其实是……"。'
    + '你一变成老师，这个环节就没有意义了。';
}

function verdictPrompt(topic, subject, covered, hist) {
  const stats = studentStats(hist);
  const said = (Array.isArray(hist) ? hist : [])
    .filter(h => h && h.role === 'user')
    .map((h, i) => '第' + (i + 1) + '次：' + String(h.content || '').trim())
    .join('\n');
  return '你是' + subject + '的老师，刚在门外听完学生给别人讲《' + topic + '》。\n'
    + '现在请你评估他**讲得怎么样**，并只输出一个 JSON 对象。\n\n'
    + '【评估依据】\n'
    + '—— 学生讲的原话（共 ' + stats.turns + ' 次发言、' + stats.chars + ' 字）——\n'
    + (said || '（他什么也没讲）') + '\n'
    + (covered ? '\n—— 本节课的知识点清单 ——\n' + covered + '\n' : '')
    + '\n【判定规则，必须严格遵守】\n'
    + '  · explained（讲清楚了的地方）：**只能写他确实讲出来、且讲对了的内容**。\n'
    + '    他没有提到过的知识点，不管多重要，都**不许**写进 explained。\n'
    + '  · skipped（绕过去/没讲清的地方）：指他提到了但说得含糊的，或者清单里有、他**完全没提**的。\n'
    + '    每一条要写清"哪里没说清"。\n'
    + '  · 每项最多 4 条，每条一句话、口语化、不要术语堆砌。\n'
    + '  · 如果学生讲得很少，explained 就给空数组 —— 少写不扣分，编一条才是错的。\n'
    + '  · comment：一两句总评，**对事不对人**。\n\n'
    + '只输出 JSON，不要任何其它文字，格式：\n'
    + '{"explained":["..."],"skipped":["..."],"comment":"..."}';
}

/* ★ 确定性守卫（与 Web 端 guardFeynTalkVerdict 同一套语义）。
   没有它会发生什么：学生只回一句"嗯，就是那样"，模型照样输出三条 explained ——
   因为它在**复述知识点清单**，不是在评价这个学生。
   判据来自服务端自己数的 history，客户端传什么都不影响它。 */
function guardVerdict(v, stats) {
  if (!v || typeof v !== 'object') return null;
  const enough = stats.turns >= MIN_TURNS && stats.chars >= MIN_CHARS;
  const out = {
    explained: Array.isArray(v.explained) ? v.explained.filter(x => typeof x === 'string' && x.trim()).slice(0, 4) : [],
    skipped: Array.isArray(v.skipped) ? v.skipped.filter(x => typeof x === 'string' && x.trim()).slice(0, 4) : [],
    comment: typeof v.comment === 'string' ? v.comment.trim() : '',
  };
  if (!enough) {
    out.explained = [];
    out.skipped = [];
    out.insufficient = true;
    out.stats = stats;
  }
  return out;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action === 'verdict' ? 'verdict' : 'listen';
  const topic = String(event.topic || '本节课').slice(0, 80);
  const subject = String(event.subject || '这门课').slice(0, 40);
  const covered = String(event.covered || '').slice(0, 600);
  const hist = (Array.isArray(event.history) ? event.history : []).slice(-20)
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string');

  if (action === 'listen') {
    if (!hist.length) return { code: 1, msg: '还没有开始讲哦' };
    const ai = await cloud.callFunction({
      name: 'aiProxy',
      data: { prompt: listenerPrompt(topic, subject, covered, hist), format: 'text' }
    }).catch(() => null);
    const ok = !!(ai && ai.result && ai.result.code === 0 && typeof ai.result.text === 'string' && ai.result.text.trim());
    if (!ok) {
      /* 失败要如实说，而且**不能**把它当成听众的提问返回 ——
         否则学生会去回答一个根本不存在的问题（与 aiInterject 的 R13 同类问题）。 */
      return {
        code: 502,
        msg: '听众走神了（AI 服务繁忙），请再讲一遍刚才那句',
        retryable: true
      };
    }
    return { code: 0, reply: ai.result.text.trim() };
  }

  // ---- verdict ----
  const stats = studentStats(hist);
  if (stats.turns === 0) {
    /* 一句话都没讲就别去评 —— 既没意义，也白烧一次调用 */
    return { code: 1, msg: '先讲一段再结束吧，一句话都没讲是没法验收的' };
  }

  const ai = await cloud.callFunction({
    name: 'aiProxy',
    data: { prompt: verdictPrompt(topic, subject, covered, hist), format: 'json' }
  }).catch(() => null);

  const okUpstream = !!(ai && ai.result && ai.result.code === 0 && ai.result.data);
  if (!okUpstream) {
    await db.collection('feynman_logs').add({
      data: {
        openid: OPENID, topic, action: 'verdict', failed: true,
        failCode: (ai && ai.result && ai.result.code) || 0,
        turns: stats.turns, chars: stats.chars,
        createTime: db.serverDate()
      }
    }).catch(() => {});
    /* 解析/调用失败就**不给结论**，也不要用兜底文案假装验收过 */
    return { code: 502, msg: '这次没能整理出验收记录，你刚才讲的内容还在', retryable: true };
  }

  const verdict = guardVerdict(ai.result.data, stats);
  if (!verdict) return { code: 502, msg: '验收记录格式异常，你刚才讲的内容还在', retryable: true };

  await db.collection('feynman_logs').add({
    data: {
      openid: OPENID, topic, action: 'verdict', failed: false,
      turns: stats.turns, chars: stats.chars,
      explainedCount: verdict.explained.length,
      insufficient: !!verdict.insufficient,
      createTime: db.serverDate()
    }
  }).catch(() => {});

  return { code: 0, verdict };
};
