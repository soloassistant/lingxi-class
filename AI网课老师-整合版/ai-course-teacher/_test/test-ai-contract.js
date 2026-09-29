/* AI 契约一致性验证（外部审查 R13）
   ------------------------------------------------------------
   报告的问题有两层，两层都要钉：
     ① 契约相反：aiInterject / aiExplain 的提示词要"散文、不要 JSON"，
        而 aiProxy **无条件**强制 JSON（system 指令 + response_format + JSON.parse）；
     ② 失败被包装成成功：aiInterject 把「AI 暂时无法回答」当 code:0 返回，
        还写进教学日志的 reply 字段 —— 错误提示于是成了"老师的回答"。

   这组测试把两个云函数都真跑起来（内存版 wx-server-sdk 桩 + 可控的 fetch）。

   运行：node _test/test-ai-contract.js
   ============================================================ */
'use strict';
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-wx-server-sdk');

const origLoad = Module._load;
const origFetch = global.fetch;

let currentCtx = { OPENID: 'o_student' };
let mockCloud = null;
/* 上游桩：captured 记录发出去的请求体，replyBody 决定返回什么 */
let captured = [];
let upstreamReply = { content: '这是老师的一段口语化讲解。' };
let upstreamFail = null;

function buildCloud(db, callFunctionImpl) {
  return {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    callFunction: callFunctionImpl || (async () => ({ result: { code: 0 } })),
  };
}

const CF_DIR = path.join(__dirname, '..', 'cloudfunctions');
function loadFn(name, db, callFunctionImpl) {
  mockCloud = buildCloud(db, callFunctionImpl);
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
const t = (label, cond, extra) => {
  if (typeof cond !== 'boolean') { fail++; console.log('FAIL ' + label + '  ← 断言写法错误：条件必须是 boolean'); return; }
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  -> ' + extra : '')); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

(async () => {
  process.env.AI_KEY_PRIMARY = 'k1';
  delete process.env.AI_KEY_SECONDARY;
  process.env.AI_BASE_URL = 'https://upstream.test/v1';

  /* ===== A. aiProxy 的格式契约 ===== */
  sec('A. aiProxy 按调用方声明决定要不要 JSON');
  {
    captured = [];
    upstreamReply = { content: '你好，这是一段纯文本。' };
    global.fetch = async (url, init) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(upstreamReply.content) } }] }) };
    };
    const fn = loadFn('aiProxy', createDb({}));
    const r = await fn.main({ prompt: '问一句', format: 'text' });
    t('A1 ★★ 声明 format:text 时返回 { code:0, text }（不再走 JSON.parse）',
      r.code === 0 && typeof r.text === 'string' && r.text.indexOf('纯文本') >= 0);
    t('A2 ★★ 且**不带** response_format（这是契约相反的那一半）',
      captured.length > 0 && !('response_format' in captured[0]));
    t('A3 ★ system 指令也改成"纯文本、不要 JSON"',
      captured.length > 0 && /plain text only/i.test(captured[0].messages[0].content) &&
      !/valid JSON only/i.test(captured[0].messages[0].content));
    t('A4 返回里没有 data 字段（契约只有一种形状，调用方不用猜）', !('data' in r));
  }
  {
    captured = [];
    upstreamReply = { ok: true };
    global.fetch = async (url, init) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    };
    const fn = loadFn('aiProxy', createDb({}));
    const r = await fn.main({ prompt: '问一句' });
    t('A5 默认（不声明 format）仍然是 JSON 契约，返回 { code:0, data }',
      r.code === 0 && r.data && r.data.ok === true && !('text' in r));
    t('A6 默认路径仍然带 response_format: json_object',
      captured.length > 0 && captured[0].response_format && captured[0].response_format.type === 'json_object');
  }
  {
    // 上游返回散文而调用方要 JSON → 必须失败（不能把散文硬塞进 data）
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '这不是 JSON' } }] }) });
    const fn = loadFn('aiProxy', createDb({}));
    const r = await fn.main({ prompt: 'x' });
    t('A7 ★ 要 JSON 却拿到散文时如实报错（不静默产出半成品）', r.code !== 0);
  }
  {
    // text 模式拿到空串 → 也算失败，不能返回空回答
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '   ' } }] }) });
    const fn = loadFn('aiProxy', createDb({}));
    const r = await fn.main({ prompt: 'x', format: 'text' });
    t('A8 ★ text 模式拿到空内容时如实报错', r.code !== 0);
  }

  /* ===== B. aiInterject 的调用契约与失败语义 ===== */
  sec('B. aiInterject：只认一个字段，失败不冒充成功');
  {
    const db = createDb({});
    let asked = null;
    const fn = loadFn('aiInterject', db, async (arg) => {
      asked = arg;
      return { result: { code: 0, text: '这是老师真正说的一句话。' } };
    });
    const r = await fn.main({ itemId: 'i1', question: '为什么这里要这样？' });
    t('B1 ★★ aiInterject 显式声明 format:text（不再和代理互相下相反命令）',
      asked && asked.data && asked.data.format === 'text');
    t('B2 ★★ 只从 `text` 字段取回答（原来是 reply||answer||text||content 四个蒙一个）',
      r.code === 0 && r.reply === '这是老师真正说的一句话。');
    t('B3 成功时写入教学日志的 reply 是真实回答',
      db._store.teach_interrupt_logs.rows[0].reply === '这是老师真正说的一句话。');
  }
  {
    const db = createDb({});
    const fn = loadFn('aiInterject', db, async () => ({ result: { code: 500, msg: 'AI 服务暂时不可用' } }));
    const r = await fn.main({ itemId: 'i2', question: '再问一句' });
    t('B4 ★★ 上游失败时返回**非 0** 错误码（修复前是 code:0 + 一句假回答）', r.code === 502);
    t('B5 ★ 明确标成可重试，前端才给得出"重试一次"', r.retryable === true);
    t('B6 ★★ 日志里的 reply **不是**错误文案（修复前错误提示会变成"老师的回答"）',
      db._store.teach_interrupt_logs.rows[0].reply === '');
    t('B7 ★ 日志明确记了这次是失败的', db._store.teach_interrupt_logs.rows[0].failed === true);
    t('B8 return 里没有 reply 字段（调用方不会误当成回答）', !('reply' in r));
  }
  {
    // 上游"成功"但 text 是空串 / 不是字符串
    const db = createDb({});
    const fn = loadFn('aiInterject', db, async () => ({ result: { code: 0, text: '   ' } }));
    const r = await fn.main({ itemId: 'i3', question: 'x' });
    t('B9 ★ 上游成功但内容为空时同样按失败处理', r.code === 502);
  }
  {
    const db = createDb({});
    const fn = loadFn('aiInterject', db, async () => { throw new Error('callFunction boom'); });
    const r = await fn.main({ itemId: 'i4', question: 'x' });
    t('B10 callFunction 抛异常也走失败分支（不是 unhandled）', r.code === 502);
  }
  {
    const db = createDb({});
    const fn = loadFn('aiInterject', db, async () => ({ result: { code: 0, text: 'ok' } }));
    const r = await fn.main({ itemId: 'i5', question: '   ' });
    t('B11 空问题仍然是参数错误', r.code === 1);
  }

  /* ===== C. aiExplain 同样走文本契约，并如实标注回退 ===== */
  sec('C. aiExplain：文本契约 + 回退要标出来');
  {
    let asked = null;
    const fn = loadFn('aiExplain', createDb({}), async (arg) => {
      asked = arg;
      return { result: { code: 0, text: '这道题的关键是先把单位统一。' } };
    });
    const r = await fn.main({ question: 'q', explanation: '标准解析' });
    t('C1 ★ aiExplain 也声明 format:text', asked && asked.data && asked.data.format === 'text');
    t('C2 取到 AI 讲解时 fallback 为 false', r.data.content.indexOf('单位统一') >= 0 && r.fallback === false);
  }
  {
    const fn = loadFn('aiExplain', createDb({}), async () => ({ result: { code: 500, msg: 'busy' } }));
    const r = await fn.main({ question: 'q', explanation: '标准解析内容' });
    t('C3 ★★ 回退到标准解析时明确标 fallback:true（不冒充 AI 讲解）', r.fallback === true);
    t('C4 回退时给出可读的说明', /退回标准解析/.test(r.msg || ''));
    t('C5 回退内容用的是标准解析，不是错误文案', r.data.content === '标准解析内容');
  }

  /* ===== D. 反向：调用方里不应再出现"猜字段"的兜底链 ===== */
  sec('D. 不许再猜字段');
  {
    const fs = require('fs');
    const codeOf = (p) => fs.readFileSync(path.join(CF_DIR, p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    t('D1 ★ aiInterject 不再有 reply||answer||text||content 的兜底链',
      !/data\.reply \|\| data\.answer \|\| data\.text \|\| data\.content/.test(codeOf('aiInterject/index.js')));
    t('D2 ★ aiExplain 不再有 explanation||content||text 的兜底链',
      !/data\.explanation \|\| ai\.result\.data\.content \|\| ai\.result\.data\.text/.test(codeOf('aiExplain/index.js')));
  }

  global.fetch = origFetch;
  delete process.env.AI_KEY_PRIMARY;
  console.log('\nCONTRACT_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { global.fetch = origFetch; console.log('CONTRACT_ERROR ' + ((e && e.stack) || e)); process.exit(2); });
