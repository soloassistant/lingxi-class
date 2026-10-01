/* 费曼学习法（小程序端）· 课堂内费曼模式 + 课后「讲给我听」云函数
   ============================================================
   两个独立的失败模式，分开测：

   ① **课堂内**：aiTeach 收到 feynman:true 之后，提示词要真的换成
      "先外行话与类比、再术语"的顺序，并要求额外输出 feynmanCheck。
      同时要保证：没开的时候一个字都不该多出来（否则等于默认全开）。

   ② **验收记录**：学生讲了什么、讲了多少，必须由**服务端**自己数 history 得出。
      本文件的 D 组专门做一件"坏客户端"的事 —— 传一个假的 stats 进去，
      看服务端会不会采信。这一条对应 R12 的教训：
      凡是"够不够格下结论"的判断，判据必须来自可信来源。

   跑真实云函数（内存版 wx-server-sdk 桩），不 grep 源码。
   运行：node _test/test-feynman.js
   ============================================================ */
'use strict';
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-wx-server-sdk');

const ROOT = path.join(__dirname, '..');
const CF_DIR = path.join(ROOT, 'cloudfunctions');

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (typeof cond !== 'boolean') {
    fail++; console.log('FAIL ' + label + '  ← 断言写法错误：条件必须是 boolean（收到 ' + typeof cond + '）');
    return;
  }
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

/* ---------------------------------------------------------------- 云函数装载 */
const origLoad = Module._load;
let currentCtx = { OPENID: 'o_student' };

function loadFn(name, db, callFunctionImpl) {
  const mockCloud = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    callFunction: callFunctionImpl || (async () => ({ result: { code: 0 } })),
  };
  const fnPath = path.join(CF_DIR, name, 'index.js');
  delete require.cache[require.resolve(fnPath)];
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return mockCloud;
    return origLoad.call(this, request, parent, isMain);
  };
  const fn = require(fnPath);
  Module._load = origLoad;
  return fn;
}

/* 记录每次 aiProxy 调用的参数 */
function recorder(reply) {
  const calls = [];
  const impl = async (opts) => {
    calls.push((opts && opts.data) || {});
    return { result: reply === undefined ? { code: 1, msg: '上游挂了' } : reply };
  };
  return { calls, impl };
}

const rowsOf = async (db, name) => (await db.collection(name).limit(1000).get()).data;

/* ================================================================ 开跑 */
(async () => {

  /* ---------------- A 组：aiTeach 的费曼提示词 ---------------- */
  sec('A. aiTeach：开了才改讲法，并要求 feynmanCheck');
  {
    const mk = async (feynman) => {
      const db = createDb({});
      const r = recorder({ code: 0, data: { sections: [{ text: 'x', board: { steps: [] } }], summary: 's', quiz: { question: 'q', options: ['a'], answerIndex: 0 } } });
      const fn = loadFn('aiTeach', db, r.impl);
      await fn.main({ system: 'A-Level', subject: '数学', topic: '勾股定理', feynman });
      return r.calls[0].prompt;
    };

    const off = await mk(false);
    t('A1 未开启时不出现费曼模式指令', off.indexOf('费曼学习法模式') < 0);
    t('A2 未开启时也不要求 feynmanCheck 字段', off.indexOf('feynmanCheck') < 0);
    t('A3 未开启时原提示词仍在（不是把整条改坏）', off.indexOf('结构化授课 JSON') >= 0);

    const on = await mk(true);
    t('A4 开启后出现费曼模式指令', on.indexOf('费曼学习法模式') >= 0);
    t('A5 ★ 要求"先外行话与类比、再术语"且顺序不能反', on.indexOf('顺序不能反') >= 0);
    t('A6 要求明确指出"哪一步最容易讲不清"', on.indexOf('最容易讲不清') >= 0);
    t('A7 ★ 要求额外输出 feynmanCheck 字段', on.indexOf('feynmanCheck') >= 0);
    t('A8 feynmanCheck 的格式被写死了（要能直接布置给学生）',
      on.indexOf('请你合上页面') >= 0);
    t('A9 说明 feynmanCheck 不要写成对老师的说明', on.indexOf('不要写成对老师的说明') >= 0);
    t('A10 原有字段要求仍然保留（不能为了加费曼把 JSON 契约弄丢）',
      on.indexOf('sections') >= 0 && on.indexOf('quiz') >= 0);
    t('A11 开启只多出一段，不是整篇重写', on.length > off.length && on.length - off.length < 900);
  }

  /* ---------------- B 组：feynmanCheck 的透传与不编造 ---------------- */
  sec('B. aiTeach：feynmanCheck 如实透传，缺了不编');
  {
    const run = async (data, ev) => {
      const db = createDb({});
      const r = recorder({ code: 0, data });
      const fn = loadFn('aiTeach', db, r.impl);
      const res = await fn.main(Object.assign({ subject: '数学', topic: 'T' }, ev || {}));
      return { res, db };
    };
    const base = { sections: [{ text: 'x', board: { steps: [] } }], summary: 's', quiz: { question: 'q', options: ['a'], answerIndex: 0 } };

    const a = await run(Object.assign({ feynmanCheck: '  请你合上页面，用自己的话把勾股定理讲一遍。  ' }, base), { feynman: true });
    t('B1 模型给了 feynmanCheck → 原样透传', a.res.data && a.res.data.feynmanCheck === '请你合上页面，用自己的话把勾股定理讲一遍。');

    const b = await run(Object.assign({}, base), { feynman: true });
    t('B2 ★ 模型没给 → 就留空，不拿通用口号顶上（否则学生以为做了费曼）',
      b.res.data && b.res.data.feynmanCheck === undefined);

    const c = await run(Object.assign({ feynmanCheck: '   ' }, base), { feynman: true });
    t('B3 只有空白 → 同样删掉（空字符串会渲染出一张空卡片）',
      c.res.data && c.res.data.feynmanCheck === undefined);

    const d = await run(Object.assign({ feynmanCheck: 12345 }, base), { feynman: true });
    t('B4 非字符串 → 删掉（不能把它渲染进模板）',
      d.res.data && d.res.data.feynmanCheck === undefined);

    /* AI 完全不可用 → fallback 路径。开了费曼就必须带上任务，
       否则"AI 挂了"会顺带把费曼环节一起吞掉（而它本来不依赖 AI 也能做）。 */
    const dbE = createDb({});
    const rE = { calls: [], impl: async (o) => { rE.calls.push(o && o.data); return { result: { code: 500 } }; } };
    const fnE = loadFn('aiTeach', dbE, rE.impl);
    const resE = await fnE.main({ subject: '数学', topic: 'T', feynman: true });
    t('B5 AI 不可用 → 走 fallback', resE.code !== 0 && !!resE.fallback);
    t('B6 ★ fallback 里也带 feynmanCheck（费曼不依赖 AI，不该被一起吞掉）',
      !!(resE.fallback && typeof resE.fallback.feynmanCheck === 'string' && resE.fallback.feynmanCheck.length > 10));

    const dbF = createDb({});
    const rF = { calls: [], impl: async (o) => { rF.calls.push(o && o.data); return { result: { code: 500 } }; } };
    const fnF = loadFn('aiTeach', dbF, rF.impl);
    const resF = await fnF.main({ subject: '数学', topic: 'T', feynman: false });
    t('B7 没开费曼时 fallback 不带 feynmanCheck', !(resF.fallback && resF.fallback.feynmanCheck));
  }

  /* ---------------- C 组：feynmanTalk「听」—— 角色与失败纪律 ---------------- */
  sec('C. feynmanTalk / listen：只当听众，失败不伪装成提问');
  {
    const hist = [{ role: 'assistant', content: '讲给我听' }, { role: 'user', content: '勾股定理就是两直角边平方和等于斜边平方。' }];

    const db = createDb({});
    const r = recorder({ code: 0, text: '那为什么一定是斜边呢？' });
    const fn = loadFn('feynmanTalk', db, r.impl);
    const res = await fn.main({ action: 'listen', topic: '勾股定理', subject: '数学', covered: '勾股定理；逆定理', history: hist });

    t('C1 返回听众的追问', res.code === 0 && res.reply === '那为什么一定是斜边呢？');
    const p = r.calls[0].prompt;
    t('C2 ★ 用的是纯文本模式（不是 JSON —— 听众说的是话，不是数据）', r.calls[0].format === 'text');
    t('C3 角色是"完全不懂的初学者"', p.indexOf('完全不懂') >= 0);
    t('C4 ★ 禁止替学生总结', p.indexOf('绝对不要替学生总结') >= 0);
    t('C5 ★ 禁止补充知识点/给答案', p.indexOf('绝对不要补充知识点') >= 0);
    t('C6 不许表扬', p.indexOf('不要夸他讲得好') >= 0);
    t('C7 一次只问一个问题', p.indexOf('一次只问') >= 0);
    t('C8 提问只基于学生讲过的内容', p.indexOf('只基于他刚讲过的内容') >= 0);
    t('C9 带上了课程主题', p.indexOf('勾股定理') >= 0);
    t('C10 带上了知识点清单，并要求不要主动报出来', p.indexOf('逆定理') >= 0 && p.indexOf('不要主动报出来') >= 0);
    t('C11 有红线段', p.indexOf('【红线】') >= 0);
    t('C12 提示词里带上了学生刚才说的那句话（多轮上下文）',
      p.indexOf('平方和等于斜边平方') >= 0);

    /* 上游失败：必须返回错误码，绝不能把错误文案当成听众的提问 */
    const db2 = createDb({});
    const r2 = recorder(undefined);
    const fn2 = loadFn('feynmanTalk', db2, r2.impl);
    const res2 = await fn2.main({ action: 'listen', topic: 'T', history: hist });
    t('C13 上游失败 → 返回错误码', res2.code === 502);
    t('C14 ★ 失败时不返回 reply（否则学生会去回答一个不存在的问题）', res2.reply === undefined);
    t('C15 且标明可重试', res2.retryable === true);

    /* 空历史 → 直接拒绝，不烧调用 */
    const db3 = createDb({});
    const r3 = recorder({ code: 0, text: 'x' });
    const fn3 = loadFn('feynmanTalk', db3, r3.impl);
    const res3 = await fn3.main({ action: 'listen', topic: 'T', history: [] });
    t('C16 空历史 → 拒绝', res3.code === 1);
    t('C17 空历史 → 不调用上游', r3.calls.length === 0);
  }

  /* ---------------- D 组：verdict 守卫 + 不信客户端的统计 ---------------- */
  sec('D. feynmanTalk / verdict：判据来自服务端的 history');
  {
    const LONG = '勾股定理就是说，一个直角三角形，两条直角边各自乘自己再加起来，等于斜边乘自己。'
      + '我举个例子，两条直角边是三和四，那斜边就是五，因为九加十六等于二十五。';
    const unruly = { explained: ['勾股定理', '逆定理的判定', '平方和的意义'], skipped: ['为什么必须是最长边'], comment: '整体不错' };

    const runVerdict = async (history, extra) => {
      const db = createDb({});
      const r = recorder({ code: 0, data: unruly });
      const fn = loadFn('feynmanTalk', db, r.impl);
      const res = await fn.main(Object.assign({ action: 'verdict', topic: '勾股定理', subject: '数学', history }, extra || {}));
      return { res, db, calls: r.calls };
    };

    /* 讲得够多 */
    const a = await runVerdict([
      { role: 'assistant', content: '讲给我听' },
      { role: 'user', content: LONG },
      { role: 'assistant', content: '为什么？' },
      { role: 'user', content: '因为正方形面积的关系，自己画一下就明白了。' },
    ]);
    t('D1 讲得够多 → 原样给出结论', a.res.code === 0 && a.res.verdict.explained.length === 3);
    t('D2 讲得够多 → 不标记 insufficient', a.res.verdict.insufficient === undefined);
    t('D3 验收用的是 JSON 模式', a.calls[0].format === 'json');
    t('D4 验收提示词要求"没提到的不许写进 explained"', a.calls[0].prompt.indexOf('不许') >= 0);
    t('D5 验收提示词里带上了学生原话', a.calls[0].prompt.indexOf('两条直角边是三和四') >= 0);
    t('D6 验收提示词说明了评估者身份（不是让一无所知的听众来评）',
      a.calls[0].prompt.indexOf('你是数学的老师') >= 0);

    /* ★★ 同一份"不守纪律"的输出，学生只讲一句 → 结论必须被拦下 */
    const b = await runVerdict([
      { role: 'assistant', content: '讲给我听' },
      { role: 'user', content: '嗯……就是那个，直角边和斜边的关系吧。' },
    ]);
    t('D7 ★ 讲得太少 → explained 被清空', b.res.verdict.explained.length === 0);
    t('D8 ★ 讲得太少 → skipped 也清空', b.res.verdict.skipped.length === 0);
    t('D9 ★ 讲得太少 → 标记 insufficient', b.res.verdict.insufficient === true);
    t('D10 讲得太少 → 带上统计供前端说明原因', !!(b.res.verdict.stats && b.res.verdict.stats.turns === 1));

    /* 讲了很多次但全是水话 */
    const c = await runVerdict([
      { role: 'user', content: '嗯' }, { role: 'user', content: '哦' },
      { role: 'user', content: '对' }, { role: 'user', content: '是' },
    ]);
    t('D11 次数够但字数不够（全是"嗯哦对是"）→ 同样拦下',
      c.res.verdict.explained.length === 0 && c.res.verdict.insufficient === true);

    /* ★★★ 坏客户端：传一个假的 stats，服务端必须无视它 */
    const d = await runVerdict(
      [{ role: 'user', content: '嗯。' }],
      { turns: 99, chars: 9999, stats: { turns: 99, chars: 9999 } }
    );
    t('D12 ★★ 客户端伪造 stats 无效 —— 服务端自己数（只讲 1 次就该拦下）',
      !!(d.res.verdict && d.res.verdict.explained.length === 0 && d.res.verdict.insufficient === true));
    /* 断言要写成不依赖字段存在（先取出来再判）——
       否则实现一旦真去信客户端，这里会抛 TypeError 把后续诊断全吞掉，
       报出来的是"测试自身异常"而不是"哪一条坏了"。 */
    const dStats = (d.res.verdict && d.res.verdict.stats) || null;
    t('D13 ★★ 且回传的统计是服务端算出来的真值（1 次 / 2 字）',
      !!(dStats && dStats.turns === 1 && dStats.chars === 2),
      JSON.stringify(dStats));

    /* 一句没讲 → 直接拒绝，且不烧调用 */
    const e = await runVerdict([{ role: 'assistant', content: '讲给我听' }]);
    t('D14 一句没讲 → 返回 code 1', e.res.code === 1);
    t('D15 一句没讲 → 不给 verdict', e.res.verdict === undefined);
    t('D16 一句没讲 → 不调用上游（不花一次调用去评一份空白）', e.calls.length === 0);

    /* 上游给了垃圾 → 不给结论，也不编 */
    const db5 = createDb({});
    const r5 = recorder({ code: 0, data: { explained: 'not-an-array', skipped: null, comment: 42 } });
    const fn5 = loadFn('feynmanTalk', db5, r5.impl);
    const res5 = await fn5.main({
      action: 'verdict', topic: 'T',
      history: [{ role: 'user', content: LONG }, { role: 'user', content: LONG }]
    });
    t('D17 字段类型全错时不崩，且归一成空数组', res5.code === 0 && !!res5.verdict && Array.isArray(res5.verdict.explained) && res5.verdict.explained.length === 0,
      JSON.stringify(res5).slice(0, 160));
    t('D17b comment 非字符串时归一成空串（不能渲染出 [object] 之类）',
      !!(res5.verdict && res5.verdict.comment === ''));
    t('D18 上游失败 → 不给结论（不用兜底文案假装验收过）', await (async () => {
      const db6 = createDb({});
      const r6 = recorder(undefined);
      const fn6 = loadFn('feynmanTalk', db6, r6.impl);
      const res6 = await fn6.main({
        action: 'verdict', topic: 'T',
        history: [{ role: 'user', content: LONG }, { role: 'user', content: LONG }]
      });
      return res6.code === 502 && res6.verdict === undefined;
    })());

    /* 条数上限：不要一次甩给学生十条 */
    const f = await runVerdict([
      { role: 'user', content: LONG }, { role: 'user', content: LONG },
    ]);
    t('D19 explained/skipped 最多各 4 条', f.res.verdict.explained.length <= 4 && f.res.verdict.skipped.length <= 4);

    /* 日志 */
    const logRows = await rowsOf(a.db, 'feynman_logs');
    t('D20 成功时记一条日志', logRows.length === 1);
    t('D21 日志里记了服务端数的次数与字数', !!(logRows[0] && logRows[0].turns > 0 && logRows[0].chars > 0));
    t('D22 日志里记了是否 insufficient（便于事后核对拦截比例）',
      logRows[0] && logRows[0].insufficient === false);

    const db7 = createDb({});
    const r7 = recorder(undefined);
    const fn7 = loadFn('feynmanTalk', db7, r7.impl);
    await fn7.main({ action: 'verdict', topic: 'T', history: [{ role: 'user', content: LONG }, { role: 'user', content: LONG }] });
    const logs7 = await rowsOf(db7, 'feynman_logs');
    t('D23 失败时记一条 failed=true 的日志', !!(logs7[0] && logs7[0].failed === true));
  }

  console.log('\n_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL 测试自身异常: ' + (e && e.stack || e));
  console.log('\n_RESULT pass=' + pass + ' fail=' + (fail + 1));
  process.exit(1);
});
