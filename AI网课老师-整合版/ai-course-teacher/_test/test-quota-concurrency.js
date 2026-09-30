/* R12 验证：服务端配额必须能约束**并发**，且失败请求也要计费次
   ------------------------------------------------------------
   报告原文（含复核补充）：
     · 流程是「先查余额 → 调用付费模型 → 成功后计数」。并发调用会同时看到旧余额；
       计数本身也使用读改写，首次并发还可能创建多份当天记录；
       上游已消耗 token 但 JSON 解析失败的请求完全不计数；
       数据库计数查询失败还按 0 放行。
     · 复现：全站日限额与单用户分钟限额均设为 1，**8 个并发请求全部调用上游并成功**。
       这不是注释所描述的"极端并发少计 1 次"。
     · 复核补充：`logCall`（分钟级频控的计数来源）只在成功路径被调用 →
       `RATE_MAX` 对**连续失败的调用完全不生效**；另有三处计数查询是 fail-open。

   修复要求（报告原文）：调用前原子预留配额、设置唯一计数键，并计入失败/重试预算。
   仅把自增改为原子操作**仍不能**修复"检查后调用"的竞争窗口。

   这组测试跑**真实云函数**（内存版 wx-server-sdk 桩），不 grep 源码。
   分七块：
     A. 并发：限额 1 + 8 个并发请求 → 只应有 1 个到上游（旧实现 8 个全到）
     B. 唯一计数键：并发首次调用不得建出多份当天记录
     C. 失败也要计费：上游报错 / HTTP 5xx / 响应体不是 JSON（token 已花）都计入
     D. 频控对失败调用同样生效（复核补充的那条）
     E. 计数不可用时 fail-closed（不再按"未超限"放行）
     F. 调用明细账本：尝试先落、结果回填（失败请求也有记录）
     G. 已到上限时不误判、也不多建文档

   运行：node _test/test-quota-concurrency.js
   ============================================================ */
'use strict';
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-wx-server-sdk');

const CF_DIR = path.join(__dirname, '..', 'cloudfunctions');

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

const origLoad = Module._load;
const OPENID = 'o_load';
let currentCtx = { OPENID };

let upstreamCalls = 0;
let upstream = 'ok';   // ok | error | http500 | badjson

global.fetch = async () => {
  upstreamCalls++;
  if (upstream === 'error') throw new Error('upstream down');
  if (upstream === 'http500') return { ok: false, status: 500, json: async () => ({}) };
  if (upstream === 'badjson') {
    // 上游已经生成完、token 已经花了，但内容不是 JSON
    return { ok: true, json: async () => ({ choices: [{ message: { content: '当然是选 B 啦。' } }] }) };
  }
  return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
};

function loadFn(db) {
  const mockCloud = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    callFunction: async () => ({ result: { code: 0, pass: true } })   // secCheck 通过
  };
  const fnPath = path.join(CF_DIR, 'aiProxy', 'index.js');
  delete require.cache[require.resolve(fnPath)];
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return mockCloud;
    return origLoad.call(this, request, parent, isMain);
  };
  const fn = require(fnPath);
  Module._load = origLoad;
  return fn;
}

const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const qKey = () => 'q_' + OPENID + '_' + today();
const gKey = () => 'g_' + today();
const rows = (db, name) => (db._store[name] ? db._store[name].rows : []);
const countOf = (db, name, id) => {
  const r = rows(db, name).find(x => x._id === id);
  return r ? r.count : null;
};

/* 每次都用全新的 db + 新装载的模块实例：计数状态与模块级 failCount 都不串 */
function setup(env, seed) {
  process.env.AI_KEY_PRIMARY = 'sk-test-key';
  process.env.AI_RATE_MAX = env.rate === undefined ? '10' : String(env.rate);
  process.env.AI_DAILY_QUOTA = env.daily === undefined ? '10' : String(env.daily);
  process.env.AI_GLOBAL_QUOTA = env.global === undefined ? '100' : String(env.global);
  currentCtx = { OPENID };
  const db = createDb(seed || {});
  const fn = loadFn(db);
  return { db, fn };
}

(async () => {

  /* ============ A 组：并发（报告里的复现条件） ============ */
  sec('A. 并发：限额 1 + 8 个并发请求');
  {
    upstream = 'ok';
    const { db, fn } = setup({ rate: 1, daily: 1, global: 1 });
    upstreamCalls = 0;

    // 8 个请求**同时**发出（旧实现：全部读到旧余额 → 全部调用上游）
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => fn.main({ prompt: 'q' + i }))
    );
    const okCount = results.filter(r => r.code === 0).length;
    const rateLimited = results.filter(r => r.code === 429).length;

    t('A1 ★★ 8 个并发请求里只有 1 个成功', okCount === 1, 'ok=' + okCount);
    t('A2 ★★ 上游只被调用 1 次（修复前是 8 次）', upstreamCalls === 1, 'calls=' + upstreamCalls);
    t('A3 其余 7 个被 429 拦下', rateLimited === 7, '429=' + rateLimited);
    // ⚠ 下面这些断言刻意不直接用 rows(...)[0]._id —— 实现一旦坏了，
    //   桩里可能一条记录都没有，直接取下标会抛异常，把后面的诊断全部吞掉
    //   （实测：变异验证时正是这样，只看到一条 TypeError 而不是"哪里坏了"）。
    const rateRow = rows(db, 'ai_rate')[0];
    t('A4 计数恰好等于限额（不多放、也不重复扣）', !!(rateRow && rateRow.count === 1),
      JSON.stringify(rows(db, 'ai_rate')));
    t('A5 单用户日用量也停在 1', countOf(db, 'ai_quota', qKey()) === 1, String(countOf(db, 'ai_quota', qKey())));
    t('A6 全站用量也停在 1', countOf(db, 'ai_usage_global', gKey()) === 1, String(countOf(db, 'ai_usage_global', gKey())));
  }

  /* ============ B 组：唯一计数键 ============ */
  sec('B. 唯一计数键：并发首次调用不得建出多份记录');
  {
    upstream = 'ok';
    const { db, fn } = setup({ rate: 50, daily: 50, global: 500 });
    await Promise.all(Array.from({ length: 8 }, (_, i) => fn.main({ prompt: 'q' + i })));

    t('B1 ★ 并发 8 次后 ai_quota 只有 1 条（旧实现会建出多份当天记录）',
      rows(db, 'ai_quota').length === 1, 'rows=' + rows(db, 'ai_quota').length);
    t('B2 ★ ai_usage_global 只有 1 条', rows(db, 'ai_usage_global').length === 1,
      'rows=' + rows(db, 'ai_usage_global').length);
    t('B3 ★ ai_rate 只有 1 条', rows(db, 'ai_rate').length === 1, 'rows=' + rows(db, 'ai_rate').length);
    const qRow = rows(db, 'ai_quota')[0];
    const gRow = rows(db, 'ai_usage_global')[0];
    const rRow = rows(db, 'ai_rate')[0];
    t('B4 计数键是确定性的（q_<openid>_<date>）', !!(qRow && qRow._id === qKey()),
      qRow && qRow._id);
    t('B5 全局键是 g_<date>', !!(gRow && gRow._id === gKey()), gRow && gRow._id);
    t('B6 频控键带分钟桶号', !!(rRow && /^r_o_load_\d+$/.test(String(rRow._id))), rRow && rRow._id);
    t('B7 ★ 计数准确等于成功次数（8）—— 少计就等于多花钱',
      countOf(db, 'ai_quota', qKey()) === 8, String(countOf(db, 'ai_quota', qKey())));
    t('B8 计数文档带 openid（注销时才能删干净）', !!(qRow && qRow.openid === OPENID));
  }

  /* ============ C 组：失败的调用也要计费次 ============ */
  sec('C. 失败/格式错误也计费：token 花了就要记账');
  for (const [behavior, label] of [
    ['error', '上游抛异常'],
    ['http500', '上游返回 HTTP 500'],
    ['badjson', '上游返回非 JSON（解析失败，token 已消耗）'],
  ]) {
    upstream = behavior;
    const { db, fn } = setup({ rate: 10, daily: 10, global: 100 });
    upstreamCalls = 0;
    const r = await fn.main({ prompt: 'q' });
    t('C-' + behavior + ' ' + label + ' → code 500', r.code === 500, JSON.stringify(r));
    t('C-' + behavior + ' ★ 这一失败调用**已计入**日配额（count=1）',
      countOf(db, 'ai_quota', qKey()) === 1, String(countOf(db, 'ai_quota', qKey())));
    t('C-' + behavior + ' 也计入了全站用量', countOf(db, 'ai_usage_global', gKey()) === 1);
    t('C-' + behavior + ' 上游确实被调用了', upstreamCalls === 1, 'calls=' + upstreamCalls);
  }

  /* ============ D 组：频控对失败调用同样生效（复核补充） ============ */
  sec('D. 频控不能只约束成功路径');
  {
    upstream = 'error';
    const { db, fn } = setup({ rate: 2, daily: 100, global: 100 });
    upstreamCalls = 0;
    const r1 = await fn.main({ prompt: 'q1' });
    const r2 = await fn.main({ prompt: 'q2' });
    const r3 = await fn.main({ prompt: 'q3' });
    t('D1 前两次失败 → 500', r1.code === 500 && r2.code === 500, JSON.stringify([r1.code, r2.code]));
    t('D2 ★★ 第 3 次被频控拦下（修复前：连续失败可以无限刷）',
      r3.code === 429 && r3.msg.indexOf('频繁') >= 0, JSON.stringify(r3));
    t('D3 ★★ 被拦下的那次没有再去调用上游', upstreamCalls === 2, 'calls=' + upstreamCalls);
    const dRow = rows(db, 'ai_rate')[0];
    t('D4 频控桶计数 = 2', !!(dRow && dRow.count === 2), JSON.stringify(dRow));
    t('D5 日配额记到 2（失败也计）', countOf(db, 'ai_quota', qKey()) === 2);
  }

  /* ============ E 组：计数不可用 → fail-closed ============ */
  sec('E. 计数不可用时必须拒绝放行');
  {
    upstream = 'ok';
    // ① 计数自增本身失败
    let s = setup({ rate: 10, daily: 10, global: 100 });
    s.db._updateDenied = ['ai_rate'];
    upstreamCalls = 0;
    let r = await s.fn.main({ prompt: 'q' });
    t('E1 频控计数 update 失败 → 503 且不放行', r.code === 503, JSON.stringify(r));
    t('E2 ★ 且没有调用上游（旧实现会 fail-open 放行）', upstreamCalls === 0, 'calls=' + upstreamCalls);

    // ② 日配额计数失败
    s = setup({ rate: 10, daily: 10, global: 100 });
    s.db._updateDenied = ['ai_quota'];
    upstreamCalls = 0;
    r = await s.fn.main({ prompt: 'q' });
    t('E3 日配额计数 update 失败 → 503 且不放行', r.code === 503 && upstreamCalls === 0,
      'code=' + r.code + ' calls=' + upstreamCalls);

    // ③ 全局计数失败
    s = setup({ rate: 10, daily: 10, global: 100 });
    s.db._updateDenied = ['ai_usage_global'];
    upstreamCalls = 0;
    r = await s.fn.main({ prompt: 'q' });
    t('E4 全局计数 update 失败 → 503 且不放行', r.code === 503 && upstreamCalls === 0,
      'code=' + r.code + ' calls=' + upstreamCalls);

    // ④ 计数文档建不起来（add 被拒）→ 不能当成"你额度用完了"
    s = setup({ rate: 10, daily: 10, global: 100 });
    s.db._addDenied = ['ai_rate'];
    upstreamCalls = 0;
    r = await s.fn.main({ prompt: 'q' });
    t('E5 ★ 计数文档建不起来 → 503（而不是骗用户"今日额度已用完"）',
      r.code === 503, 'code=' + r.code + ' msg=' + r.msg);
    t('E6 且没有调用上游', upstreamCalls === 0, 'calls=' + upstreamCalls);
  }

  /* ============ F 组：调用明细账本 ============ */
  sec('F. 调用明细：失败请求也要有记录');
  {
    upstream = 'ok';
    let s = setup({ rate: 10, daily: 10, global: 100 });
    await s.fn.main({ prompt: 'q' });
    t('F1 成功调用留下 1 条明细', rows(s.db, 'ai_calls').length === 1);
    const fRow = rows(s.db, 'ai_calls')[0];
    t('F2 成功明细回填 phase=ok', !!(fRow && fRow.phase === 'ok'), JSON.stringify(fRow));
    t('F3 明细带 openid 与时间戳', !!(fRow && fRow.openid === OPENID && fRow.ts));

    upstream = 'error';
    s = setup({ rate: 10, daily: 10, global: 100 });
    await s.fn.main({ prompt: 'q' });
    t('F4 ★ 失败调用同样留下明细（1 条）', rows(s.db, 'ai_calls').length === 1,
      'rows=' + rows(s.db, 'ai_calls').length);
    const eRow = rows(s.db, 'ai_calls')[0];
    t('F5 失败明细 phase=error', !!(eRow && eRow.phase === 'error'), JSON.stringify(eRow));

    // 写明细失败不能拖垮主流程，但也不能假装成功
    upstream = 'ok';
    s = setup({ rate: 10, daily: 10, global: 100 });
    s.db._addDenied = ['ai_calls'];
    const r = await s.fn.main({ prompt: 'q' });
    t('F6 明细写入失败时调用本身仍成功（账本不阻塞业务）', r.code === 0, JSON.stringify(r));
  }

  /* ============ G 组：到上限时的判定 ============ */
  sec('G. 已到上限：不误判、也不多建文档');
  {
    upstream = 'ok';
    // 预置已用完的日配额
    const s = setup({ rate: 10, daily: 2, global: 100 },
      { ai_quota: [{ _id: qKey(), openid: OPENID, date: today(), count: 2 }] });
    upstreamCalls = 0;
    const r = await s.fn.main({ prompt: 'q' });
    t('G1 日配额已满 → 429 且提示"今日"', r.code === 429 && r.msg.indexOf('今日') >= 0, JSON.stringify(r));
    t('G2 不调用上游', upstreamCalls === 0, 'calls=' + upstreamCalls);
    t('G3 不因为"满了"而再多建一条记录', rows(s.db, 'ai_quota').length === 1,
      'rows=' + rows(s.db, 'ai_quota').length);
    t('G4 计数没有被继续加到限额之上', countOf(s.db, 'ai_quota', qKey()) === 2,
      String(countOf(s.db, 'ai_quota', qKey())));
  }
  {
    upstream = 'ok';
    // 预置已用完的全站配额
    const s = setup({ rate: 10, daily: 10, global: 2 },
      { ai_usage_global: [{ _id: gKey(), date: today(), count: 2 }] });
    upstreamCalls = 0;
    const r = await s.fn.main({ prompt: 'q' });
    t('G5 全站已满 → 429 且提示"全站"', r.code === 429 && r.msg.indexOf('全站') >= 0, JSON.stringify(r));
    t('G6 不调用上游', upstreamCalls === 0, 'calls=' + upstreamCalls);
  }
  {
    upstream = 'ok';
    // 限额配成 0：应直接拒绝，而不是"因为 limit>0 才检查"漏掉
    const s = setup({ rate: 10, daily: 0, global: 100 });
    upstreamCalls = 0;
    const r = await s.fn.main({ prompt: 'q' });
    t('G7 日限额为 0 → 429 且不调用上游', r.code === 429 && upstreamCalls === 0,
      'code=' + r.code + ' calls=' + upstreamCalls);
  }

  console.log('\n_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL 测试自身异常: ' + ((e && e.stack) || e));
  console.log('\n_RESULT pass=' + pass + ' fail=' + (fail + 1));
  process.exit(1);
});
