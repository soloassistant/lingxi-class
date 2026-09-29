/* 间隔复习晋级验证（外部审查 R09）
   ------------------------------------------------------------
   报告复现：对**尚未到期**的同一题连续调用 5 次，
   修复前返回 `resolved:true, interval:30` —— 几秒内把题目"毕业"了，
   而这没有提供任何跨天记忆保持的证据。

   这组测试把 updateWrong 真跑起来（内存版 wx-server-sdk 桩），
   用"到期 / 未到期"和"重复令牌"两种输入去钉住行为。

   运行：node _test/test-review-schedule.js
   ============================================================ */
'use strict';
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-wx-server-sdk');

const origLoad = Module._load;
let currentCtx = { OPENID: 'o_student' };
let mockCloud = null;

const CF_DIR = path.join(__dirname, '..', 'cloudfunctions');
function loadFn(name, db) {
  mockCloud = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
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

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (typeof cond !== 'boolean') { fail++; console.log('FAIL ' + label + '  ← 断言写法错误：条件必须是 boolean'); return; }
  if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

const DAY = 86400000;
/* 造一条错题记录。dueInMs < 0 表示"已经到期"。 */
function seed(db, itemId, opts) {
  const o = opts || {};
  db._store.wrong_books = {
    seq: 1,
    rows: [{
      _id: 'w_1', openid: o.openid || 'o_student', itemId,
      question: 'q', options: ['a', 'b'], answerIndex: 0,
      wrongCount: 1, rightCount: 0, reviewCount: 0,
      interval: o.interval || 0,
      status: 'reviewing', resolved: false,
      nextReviewTime: new Date(Date.now() + (o.dueInMs == null ? -DAY : o.dueInMs)),
    }],
  };
  return db;
}
const row = (db) => db._store.wrong_books.rows[0];

(async () => {
  sec('R09-A：未到期不允许晋级');
  {
    const db = seed(createDb({}), 'i1', { dueInMs: +7 * DAY });   // 7 天后才到期
    const fn = loadFn('updateWrong', db);
    currentCtx = { OPENID: 'o_student' };
    const r = await fn.main({ itemId: 'i1', correct: true });
    t('A1 ★★ 未到期时答对不晋级（修复前会直接晋级）', r.resolved === false && r.interval === 0);
    t('A2 ★ 明确回一个 tooEarly（不静默吞掉，学生才知道为什么没变化）', r.tooEarly === true);
    t('A3 真实状态没被改动', row(db).interval === 0 && row(db).resolved === false);
    t('A4 复习次数没被刷高', row(db).reviewCount === 0);
  }

  sec('R09-B：报告里的复现用例 —— 连点 5 次');
  {
    const db = seed(createDb({}), 'i2', { dueInMs: -DAY });       // 已到期
    const fn = loadFn('updateWrong', db);
    currentCtx = { OPENID: 'o_student' };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await fn.main({ itemId: 'i2', correct: true }));
    t('B1 第一次晋级到 1 天', results[0].interval === 1 && results[0].resolved === false);
    t('B2 ★★ 后 4 次全部被"未到期"拦下（修复前会一路推到 30 天并毕业）',
      results.slice(1).every((r) => r.tooEarly === true));
    t('B3 ★★ 最终 interval 仍是 1，不是 30', row(db).interval === 1);
    t('B4 ★★ 题目没有被标记已掌握', row(db).resolved === false && row(db).status === 'reviewing');
    t('B5 复习次数只记了 1 次（不是 5 次）', row(db).reviewCount === 1);
  }

  sec('R09-C：真的跨过到期时间才继续晋级（时间旅行）');
  {
    const db = seed(createDb({}), 'i3', { dueInMs: -DAY });
    const fn = loadFn('updateWrong', db);
    currentCtx = { OPENID: 'o_student' };
    const ladder = [];
    for (let step = 0; step < 5; step++) {
      const r = await fn.main({ itemId: 'i3', correct: true });
      ladder.push(r.interval);
      row(db).nextReviewTime = new Date(Date.now() - DAY);        // 把时间"拨"到到期之后
    }
    t('C1 ★ 每次都到期时才逐级晋级：1 → 3 → 7 → 15 → 30',
      JSON.stringify(ladder) === JSON.stringify([1, 3, 7, 15, 30]));
    t('C2 到 30 天才标记已掌握', row(db).resolved === true && row(db).status === 'resolved');
  }

  sec('R09-D：幂等令牌（网络重试不会多升一级）');
  {
    const db = seed(createDb({}), 'i4', { dueInMs: -DAY });
    const fn = loadFn('updateWrong', db);
    currentCtx = { OPENID: 'o_student' };
    const r1 = await fn.main({ itemId: 'i4', correct: true, attemptId: 'tok-1' });
    t('D1 第一次带令牌成功晋级', r1.interval === 1);
    // 模拟"网络重试：同一个令牌再发一次"（此时已未到期，两条守卫都会拦）
    row(db).nextReviewTime = new Date(Date.now() - DAY);          // 就算把时间拨回去
    const r2 = await fn.main({ itemId: 'i4', correct: true, attemptId: 'tok-1' });
    t('D2 ★★ 同一令牌重复提交被判为重复（不晋级）', r2.duplicated === true && r2.interval === 1);
    const r3 = await fn.main({ itemId: 'i4', correct: true, attemptId: 'tok-2' });
    t('D3 换一个新令牌（真的是新的一次作答）可以正常晋级', r3.interval === 3);
  }

  sec('R09-E：答错重置');
  {
    const db = seed(createDb({}), 'i5', { interval: 7, dueInMs: +3 * DAY });
    const fn = loadFn('updateWrong', db);
    currentCtx = { OPENID: 'o_student' };
    const r = await fn.main({ itemId: 'i5', correct: false });
    t('E1 答错把间隔归零', r.interval === undefined && row(db).interval === 0);
    t('E2 答错后立即到期', new Date(row(db).nextReviewTime).getTime() <= Date.now() + 1000);
    t('E3 答错不看成到期与否（立刻可重来）', row(db).status === 'reviewing');
  }

  sec('R09-F：边界与归属');
  {
    const db = seed(createDb({}), 'i6', { dueInMs: -DAY, openid: 'o_other' });
    const fn = loadFn('updateWrong', db);
    currentCtx = { OPENID: 'o_student' };   // 不是这条记录的主人
    const r = await fn.main({ itemId: 'i6', correct: true });
    t('F1 ★ 别人的错题读不到、也不会被改（按 openid 查）',
      r.code === 0 && row(db).interval === 0 && row(db).reviewCount === 0);
    t('F2 缺 itemId 返回参数错误', (await fn.main({ correct: true })).code === 1);
  }
  {
    // 老数据没有 nextReviewTime：不能因此永远卡着不能晋级
    const db = createDb({});
    db._store.wrong_books = { seq: 1, rows: [{ _id: 'w_9', openid: 'o_student', itemId: 'i9', interval: 0, rightCount: 0, reviewCount: 0, resolved: false, status: 'reviewing' }] };
    const fn = loadFn('updateWrong', db);
    currentCtx = { OPENID: 'o_student' };
    const r = await fn.main({ itemId: 'i9', correct: true });
    t('F3 缺 nextReviewTime 的历史数据仍可晋级（不能被新规则锁死）', r.interval === 1);
  }

  console.log('\nREVIEW_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('REVIEW_ERROR ' + ((e && e.stack) || e)); process.exit(2); });
