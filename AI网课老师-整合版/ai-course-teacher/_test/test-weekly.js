// 学情周报链路端到端测试：mock 云环境，跑真实云函数代码
'use strict';
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-wx-server-sdk');

// 拦截 require('wx-server-sdk')，注入 mock
const origLoad = Module._load;
let currentCtx = { OPENID: 'o_userA' };
const sentMessages = [];
let mockCloud = null;

// sendWeeklyReport 从环境变量读模板 ID，测试里注入一致的值，避免命中占位符保护
process.env.WEEKLY_TEMPLATE_ID = 'TPL_WEEKLY';

function buildCloud(db) {
  return {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    openapi: {
      subscribeMessage: {
        send: async (payload) => {
          // 未配置模板 → 抛错，模拟发送失败路径
          if (process.env.FORCE_SEND_FAIL === '1') throw new Error('47003 template invalid');
          sentMessages.push(payload);
          return { errCode: 0 };
        }
      }
    }
  };
}

const CF_DIR = path.join(__dirname, '..', 'cloudfunctions');
function loadFn(name, db) {
  mockCloud = buildCloud(db);
  const fnPath = path.join(CF_DIR, name, 'index.js');
  delete require.cache[require.resolve(fnPath)]; // 每次重新加载，避免旧 db 闭包
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
function resetSend() { sentMessages.length = 0; }

/* ★ R11：与云函数同口径的北京时间日键 + 事件序号（造作答事实事件用） */
function bjDayKey(ms) {
  const bj = new Date(ms + 8 * 3600 * 1000);
  return bj.getUTCFullYear() + '-' +
    String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(bj.getUTCDate()).padStart(2, '0');
}
let evSeq = 0;

// 本周一 00:00（北京时间）——与云函数同算法
function weekStartMs() {
  const d = new Date();
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const day = bj.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3600 * 1000 - diff * 86400000;
}

async function run() {
  const ws = weekStartMs();
  const inWeek = new Date(ws + 3 * 86400000);
  const lastWeek = new Date(ws - 3 * 86400000);

  console.log('\n=== 1. subscribeWeekly：授权落库 ===');
  let db = createDb({});
  currentCtx = { OPENID: 'o_userA' };
  const subFn = loadFn('subscribeWeekly', db);
  let r = await subFn.main({ count: 2, templateId: 'TPL_WEEKLY' });
  assert(r.code === 0, 'subscribeWeekly 返回 code 0');
  assert(r.count === 2, '记录 2 条授权（count=2）');
  assert(db._store.subscriptions.rows.length === 2, 'subscriptions 集合写入 2 条 pending');
  assert(db._store.subscriptions.rows.every(s => s.status === 'pending' && s.openid === 'o_userA'), 'pending 状态 + openid 正确');
  assert(db._store.learner_prefs.rows[0].weeklyReport === true, 'learner_prefs.weeklyReport = true');

  currentCtx = { OPENID: '' };
  r = await subFn.main({ count: 1 });
  assert(r.code === 401, '未登录返回 401');

  console.log('\n=== 2. sendWeeklyReport：生成 + 推送 + 幂等 ===');
  /* ★ R11 更新：本周学习天数与正确率改由**作答事实事件**派生。
     老 fixture 是照着旧口径造的（从 checkins 数天数、从 wrong_books 的
     rightCount/wrongCount 反推正确率），这里换成造 answer_events，
     并**故意保留** checkins 与 wrong_books 的旧数据做反向对照：
     新口径必须完全忽略它们（见下面的反向断言）。 */
  const evDay1 = bjDayKey(inWeek.getTime() + 12 * 3600 * 1000);
  const evDay2 = bjDayKey(inWeek.getTime() + 86400000 + 12 * 3600 * 1000);
  const mkEvent = (dayKey, correct, opts) => Object.assign({
    openid: 'o_userA', itemId: 'ev_' + (++evSeq), courseId: 'math',
    correct, graded: true, source: 'quiz', attemptId: '',
    dayKey, ts: Date.parse(dayKey + 'T04:00:00Z'), createTime: new Date()
  }, opts || {});

  db = createDb({
    subscriptions: [
      { openid: 'o_userA', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date() },
      { openid: 'o_userA', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date() } // 订阅 2 次
    ],
    progress: [
      { openid: 'o_userA', itemId: 'k1', courseId: 'math', updateTime: inWeek },
      { openid: 'o_userA', itemId: 'k2', courseId: 'math', updateTime: inWeek },
      { openid: 'o_userA', itemId: 'k3', courseId: 'old', updateTime: lastWeek } // 上周，不计入
    ],
    answer_events: [
      // 两天、6 次判定作答、3 次对 → 正确率 50%，学习天数 2
      mkEvent(evDay1, true), mkEvent(evDay1, true), mkEvent(evDay1, false),
      mkEvent(evDay2, true), mkEvent(evDay2, false), mkEvent(evDay2, false),
      // 自评：不进分子分母（否则正确率会变成 4/7）
      mkEvent(evDay2, true, { graded: false, source: 'self_mark' })
    ],
    // 旧数据源，保留以证明新口径不再读它们
    checkins: [
      { openid: 'o_userA', createTime: inWeek },
      { openid: 'o_userA', createTime: new Date(inWeek.getTime() + 86400000) },
      { openid: 'o_userA', createTime: new Date(inWeek.getTime() + 86400000) } // 同天重复，去重
    ],
    wrong_books: [
      // 3 道 reviewing。这里**故意**把计数写成全对（right10/wrong0）：
      // 老口径会据此报 100%，新口径必须仍报事件里的 50% —— 这就是判别点。
      { openid: 'o_userA', courseId: 'math', courseName: '数学', status: 'reviewing', wrongCount: 0, rightCount: 10, updateTime: inWeek },
      { openid: 'o_userA', courseId: 'math', courseName: '数学', status: 'reviewing', wrongCount: 0, rightCount: 10, updateTime: inWeek },
      { openid: 'o_userA', courseId: 'eng', courseName: '英语', status: 'reviewing', wrongCount: 0, rightCount: 10, updateTime: inWeek },
      // resolved：不计入"待复习"
      { openid: 'o_userA', courseId: 'phy', courseName: '物理', status: 'resolved', wrongCount: 5, rightCount: 5, updateTime: lastWeek }
    ],
    learners: [{ _id: 'o_userA', lastLevel: 'S', lastLevelName: '提升', lastLevelCourseId: 'alevel_math', lastLevelCourseName: 'A-Level数学', system: 'A-Level' }]
  });

  currentCtx = { OPENID: 'o_userA' };
  const sendFn = loadFn('sendWeeklyReport', db);
  r = await sendFn.main({});
  assert(r.code === 0, 'sendWeeklyReport 返回 code 0');
  assert(r.sent === 1, '成功推送 1 个用户（sent=1，订阅2次只推1次）');
  assert(r.failed === 0, '无失败（failed=0）');
  assert(sentMessages.length === 1, '调用了 1 次 subscribeMessage.send');
  const report = db._store.weekly_reports.rows[0];
  assert(!!report, 'weekly_reports 落库');
  assert(report.learnedThisWeek === 2, '本周新学 = 2（排除上周那条）');
  assert(report.studyDays === 2, '学习天数 = 2（来自作答事件的北京时间自然日去重）');
  assert(report.accuracy === 50, '本周正确率 = 50%（事件里 3/6 对；自评不进分子分母）');
  assert(report.attempts === 6 && report.correctAttempts === 3, '同时落库样本量 6 / 答对 3（百分数可追溯）');
  // 判别性反向断言：wrong_books 的计数是"全对"，老口径会报 100%
  assert(report.accuracy !== 100, '正确率不再从 wrong_books 的 rightCount/wrongCount 反推（老口径会报 100%）');
  assert(report.studyDays !== 0, '学习天数不再依赖没有任何写入路径的 checkins');
  assert(report.pendingWrongs === 3, '待复习错题 = 3（resolved 不计）');
  assert(report.pushed === true, '推送成功后 pushed = true');
  assert(report.level === 'S' && report.levelName === '提升', '等级 S/提升 带入周报');
  assert(report.levelCourseName === 'A-Level数学', 'R16：周报带上等级所属课程');
  assert(sentMessages[0].touser === 'o_userA', '推送对象 openid 正确');
  assert(sentMessages[0].data.thing1.value.length <= 20, 'thing1 字段已截断 ≤ 20 字');
  assert(sentMessages[0].data.number2.value === 2, 'number2 = 本周新学数');

  // 订阅消费：2 条 pending 里只消费 1 条（第 1 条）
  const remainingPending = db._store.subscriptions.rows.filter(s => s.status === 'pending').length;
  assert(remainingPending === 1, '订阅 2 次，推送后剩 1 条 pending 额度');

  // 幂等：再跑一次（还剩 1 条 pending，但本周已 pushed），应跳过不重复推
  resetSend();
  r = await sendFn.main({});
  assert(r.sent === 0 && r.skipped >= 1, '第二次运行跳过（幂等，本周已推送）');
  assert(sentMessages.length === 0, '第二次无新推送');
  assert(db._store.weekly_reports.rows.length === 1, '不重复落库（仍 1 条周报）');

  console.log('\n=== 3. 推送失败可重试（关键 bug 验证）===');
  db = createDb({
    subscriptions: [
      { openid: 'o_userB', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date() }
    ],
    progress: [{ openid: 'o_userB', itemId: 'k1', updateTime: inWeek }],
    checkins: [],
    wrong_books: [],
    learners: []
  });
  currentCtx = { OPENID: 'o_userB' };
  const sendFn2 = loadFn('sendWeeklyReport', db);
  process.env.FORCE_SEND_FAIL = '1';
  r = await sendFn2.main({});
  assert(r.failed === 1 && r.sent === 0, '发送失败 → failed=1, sent=0');
  assert(db._store.weekly_reports.rows[0].pushed === false, '失败后 pushed = false（记录保留）');
  assert(db._store.subscriptions.rows[0].status === 'pending', '失败后订阅仍 pending（可重试，未消耗额度）');
  assert(db._store.subscriptions.rows[0].attempt === 1, '失败已记录 attempt = 1');

  // 恢复发送能力，再跑一次：应重试成功，且不新增周报
  delete process.env.FORCE_SEND_FAIL;
  resetSend();
  r = await sendFn2.main({});
  assert(r.sent === 1, '重试成功（sent=1，证明失败不阻塞重试）');
  assert(db._store.weekly_reports.rows.length === 1, '重试不重复落库（upsert 仍 1 条）');
  assert(db._store.weekly_reports.rows[0].pushed === true, '重试成功后 pushed = true');
  assert(db._store.subscriptions.rows[0].status === 'used', '重试成功后订阅置 used');

  console.log('\n=== 4. 连续失败 3 次放弃 ===');
  db = createDb({
    subscriptions: [
      { openid: 'o_userC', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date() }
    ],
    progress: [], checkins: [], wrong_books: [], learners: []
  });
  currentCtx = { OPENID: 'o_userC' };
  const sendFn3 = loadFn('sendWeeklyReport', db);
  process.env.FORCE_SEND_FAIL = '1';
  await sendFn3.main({});
  await sendFn3.main({});
  r = await sendFn3.main({});
  delete process.env.FORCE_SEND_FAIL;
  assert(r.failed === 1, '第 3 次仍失败');
  assert(db._store.subscriptions.rows[0].status === 'failed', '连续失败 3 次 → 订阅置 failed 放弃');
  assert(db._store.subscriptions.rows[0].attempt === 3, 'attempt = 3');

  console.log('\n=== 5. getWeeklyReport：读取最新 + 订阅状态 ===');
  db = createDb({
    weekly_reports: [
      { openid: 'o_userA', weekKey: '2026-W38', weekStart: '2026-09-14', learnedThisWeek: 1, pushed: true },
      { openid: 'o_userA', weekKey: '2026-W39', weekStart: '2026-09-21', learnedThisWeek: 2, pushed: true }
    ],
    subscriptions: [{ openid: 'o_userA', status: 'pending' }]
  });
  currentCtx = { OPENID: 'o_userA' };
  const getFn = loadFn('getWeeklyReport', db);
  r = await getFn.main({ limit: 1 });
  assert(r.code === 0, 'getWeeklyReport 返回 code 0');
  assert(r.latest && r.latest.weekKey === '2026-W39', 'latest 取最新一期（按 weekStart desc）');
  assert(r.subscribed === true, '有 pending 订阅 → subscribed = true');

  console.log('\n========================');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('测试异常:', e); process.exit(2); });
