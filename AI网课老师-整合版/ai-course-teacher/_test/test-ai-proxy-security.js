// aiProxy 安全加固验证：确认鉴权/频控/配额/错误泛化都生效
'use strict';
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-wx-server-sdk');

const origLoad = Module._load;
let currentCtx = { OPENID: 'o_userA' };
let mockCloud = null;
let upstreamCalls = 0;
let upstreamBehavior = 'ok';

function buildCloud(db) {
  return {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    callFunction: async () => ({ result: { code: 0, pass: true } }) // secCheck 通过
  };
}

const CF_DIR = path.join(__dirname, '..', 'cloudfunctions');
function loadFn(name, db) {
  mockCloud = buildCloud(db);
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

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

// 全局 fetch mock
global.fetch = async (url, opts) => {
  upstreamCalls++;
  if (upstreamBehavior === 'error') throw new Error('upstream boom: key sk-SECRET leaked in message');
  if (upstreamBehavior === 'http500') return { ok: false, status: 500, json: async () => ({}) };
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] })
  };
};

async function run() {
  console.log('\n=== 1. 鉴权：无 OPENID 拒绝 ===');
  let db = createDb({});
  currentCtx = { OPENID: '' };
  process.env.AI_KEY_PRIMARY = 'sk-test-key';
  const fn = loadFn('aiProxy', db);
  let r = await fn.main({ prompt: '你好' });
  assert(r.code === 401, '无 OPENID → 401 未授权调用');
  assert(upstreamCalls === 0, '未授权时不发起上游请求');

  console.log('\n=== 2. 密钥未配置：明确报错且不泄露 ===');
  delete process.env.AI_KEY_PRIMARY;
  currentCtx = { OPENID: 'o_userA' };
  const fn2 = loadFn('aiProxy', db);
  r = await fn2.main({ prompt: '你好' });
  assert(r.code === 503, '无密钥 → 503');
  assert(r.msg === 'AI 密钥未配置', '提示准确');
  process.env.AI_KEY_PRIMARY = 'sk-test-key';

  console.log('\n=== 3. 输入长度限制 ===');
  db = createDb({});
  const fn3 = loadFn('aiProxy', db);
  r = await fn3.main({ prompt: '啊'.repeat(5000) });
  assert(r.code === 400, '超长输入 → 400');
  assert(upstreamCalls === 0, '超长输入不发上游请求');

  console.log('\n=== 4. 正常调用 + 配额记录 ===');
  upstreamCalls = 0;
  r = await fn3.main({ prompt: '讲一下微分方程' });
  assert(r.code === 0, '正常调用 → code 0');
  assert(upstreamCalls === 1, '发起了 1 次上游请求');
  assert(db._store.ai_quota.rows.length === 1, 'ai_quota 记录 1 条');
  assert(db._store.ai_quota.rows[0].count === 1, 'count = 1');
  assert(db._store.ai_usage_global.rows.length === 1, '全局用量 ai_usage_global 记录 1 条');
  assert(db._store.ai_calls.rows.length === 1, '调用明细 ai_calls 记录 1 条');

  console.log('\n=== 5. 单用户每分钟频控（AI_RATE_MAX）===');
  process.env.AI_RATE_MAX = '3';
  db = createDb({});
  const fn4 = loadFn('aiProxy', db);
  await fn4.main({ prompt: 'q1' });
  await fn4.main({ prompt: 'q2' });
  await fn4.main({ prompt: 'q3' });
  r = await fn4.main({ prompt: 'q4' });
  assert(r.code === 429, '第 4 次触发频控 → 429');
  assert(r.msg.indexOf('频繁') >= 0, '提示"操作过于频繁"');
  assert(db._store.ai_quota.rows[0].count === 3, '被拦截的调用不计入配额（仍 3）');

  console.log('\n=== 6. 单用户每日配额（AI_DAILY_QUOTA）===');
  process.env.AI_RATE_MAX = '100';
  process.env.AI_DAILY_QUOTA = '2';
  db = createDb({});
  const fn5 = loadFn('aiProxy', db);
  await fn5.main({ prompt: 'q1' });
  await fn5.main({ prompt: 'q2' });
  r = await fn5.main({ prompt: 'q3' });
  assert(r.code === 429, '超出日配额 → 429');
  assert(r.msg.indexOf('今日') >= 0, '提示今日上限');

  console.log('\n=== 7. 全站每日上限（AI_GLOBAL_QUOTA）===');
  process.env.AI_DAILY_QUOTA = '100';
  process.env.AI_GLOBAL_QUOTA = '2';
  db = createDb({
    // 预置：其他用户已把全站额度用完
    ai_usage_global: [{ date: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10), count: 2 }]
  });
  const fn6 = loadFn('aiProxy', db);
  r = await fn6.main({ prompt: 'q1' });
  assert(r.code === 429, '全站额度耗尽 → 429');
  assert(r.msg.indexOf('全站') >= 0, '提示全站上限（预算封顶生效）');

  console.log('\n=== 8. 错误泛化：不泄露上游细节/密钥 ===');
  process.env.AI_GLOBAL_QUOTA = '9999';
  upstreamBehavior = 'error';
  db = createDb({});
  const fn7 = loadFn('aiProxy', db);
  r = await fn7.main({ prompt: 'q1' });
  assert(r.code === 500, '上游异常 → 500');
  assert(!r.err, '返回值不含 err 字段（不透传 lastErr）');
  assert(JSON.stringify(r).indexOf('SECRET') < 0, '错误信息中不含上游泄露的敏感串');
  assert(JSON.stringify(r).indexOf('sk-') < 0, '错误信息中不含 sk- 前缀');
  assert(r.msg === 'AI 服务暂时不可用', '仅返回泛化提示');

  console.log('\n=== 9. 连续失败触发冷却 ===');
  db = createDb({});
  const fn8 = loadFn('aiProxy', db);
  // 已累计失败次数（前面测试），继续触发
  let coolTriggered = false;
  for (let i = 0; i < 6; i++) {
    const rr = await fn8.main({ prompt: 'q' + i });
    if (rr.code === 503 && rr.msg.indexOf('冷却') >= 0) { coolTriggered = true; break; }
  }
  assert(coolTriggered, '连续失败后进入冷却（返回 503 冷却中）');

  console.log('\n========================');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('测试异常:', e); process.exit(2); });
