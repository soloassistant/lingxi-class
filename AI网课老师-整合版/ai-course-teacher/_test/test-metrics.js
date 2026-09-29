/* R11 验证：学习指标必须由"作答事实事件"派生，不能从当前状态反推
   ------------------------------------------------------------
   报告原文（含复核补充）：
     · 正确率只统计仍在复习中的错题 → 首次答对不在样本内、毕业错题被排除；
     · checkins 被仪表盘/周报/exportUserData 读取，但**全仓没有写入路径**；
     · 读取方比上文更多：exportUserData 把 checkinCount 写进用户可见的导出文件；
     · deleteAccount 删了 checkins（没人写），却没删真正在写的 analytics；
     · 另有日期字符串不补零、以及"昨天起算"游标问题。

   这组测试跑**真实云函数**（内存版 wx-server-sdk 桩），不 grep 源码。
   分四块：
     A. 事件写入：三个作答入口都留事实；幂等与"未到期"不计数（防刷）
     B. getDashboard 口径：正确率/活跃/连续/日历，以及"没有数据时是 null 不是 0"
     C. sendWeeklyReport：studyDays 与本周正确率不再读 checkins
     D. 导出与注销：不再报不成立的打卡数；真正在写的集合要随账号删除

   运行：node _test/test-metrics.js
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

/* ---------------------------------------------------------------- 云函数装载 */
const origLoad = Module._load;
let currentCtx = { OPENID: 'o_student' };
let mockCloud = null;

function buildCloud(db, callFunctionImpl) {
  return {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    callFunction: callFunctionImpl || (async () => ({ result: { code: 0 } })),
    openapi: { subscribeMessage: { send: async () => ({ errCode: 0 }) } }
  };
}

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

/* ------------------------------------------------- 与云函数同口径的北京时间日键 */
const BJ_OFFSET_MS = 8 * 3600 * 1000;
function bjDayKey(ms) {
  const bj = new Date(ms + BJ_OFFSET_MS);
  return bj.getUTCFullYear() + '-' +
    String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(bj.getUTCDate()).padStart(2, '0');
}
function dayKeyAgo(n) { return bjDayKey(Date.now() - n * 86400000); }
// dayKey（北京日期）→ 当天北京时间中午的时间戳，用来造种子事件
function tsOfDayKey(key) {
  const p = key.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2], 4, 0, 0);
}

let seq = 0;
function seedEvent(openid, dayKey, correct, opts) {
  opts = opts || {};
  return {
    openid,
    itemId: opts.itemId || ('item_' + (++seq)),
    courseId: opts.courseId || 'ielts_listening',
    correct,
    graded: opts.graded !== false,
    source: opts.source || 'quiz',
    attemptId: opts.attemptId || '',
    dayKey,
    ts: tsOfDayKey(dayKey),
    createTime: new Date(tsOfDayKey(dayKey))
  };
}

const eventsOf = async (db, openid) =>
  (await db.collection('answer_events').where({ openid }).limit(1000).get()).data;

/* ================================================================ 开始 */

(async () => {

  /* ============================ A 组：事件写入 ============================ */
  sec('A. 事件写入：三个作答入口都留事实；幂等与未到期不计数');

  {
    const db = createDb({});
    const saveProgress = loadFn('saveProgress', db);

    const r1 = await saveProgress.main({ itemId: 'k1', courseId: 'ielts_listening' });
    let evs = await eventsOf(db, 'o_student');
    t('A1 答对落一条 correct=true 的事件', r1.code === 0 && r1.recorded === true && evs.length === 1,
      JSON.stringify([r1, evs.length]));
    t('A2 事件带 courseId / itemId / correct', evs[0].courseId === 'ielts_listening' && evs[0].itemId === 'k1' && evs[0].correct === true);
    t('A3 默认 graded=true（客观判定）', evs[0].graded === true);
    t('A4 dayKey 是补零的北京时间日键（不是 Y-M-D）',
      /^\d{4}-\d{2}-\d{2}$/.test(evs[0].dayKey) && evs[0].dayKey === bjDayKey(Date.now()), evs[0].dayKey);

    // 自评：graded=false，不能进正确率
    const r2 = await saveProgress.main({ itemId: 'k2', courseId: 'ielts_listening', graded: false, source: 'self_mark' });
    evs = await eventsOf(db, 'o_student');
    const self = evs.find(e => e.itemId === 'k2');
    t('A5 自评记 graded=false 并保留 source', r2.recorded === true && self && self.graded === false && self.source === 'self_mark',
      JSON.stringify(self));

    // 幂等：同一 attemptId 重放不重复计数
    await saveProgress.main({ itemId: 'k1', courseId: 'ielts_listening', attemptId: 'att_1' });
    await saveProgress.main({ itemId: 'k1', courseId: 'ielts_listening', attemptId: 'att_1' });
    evs = await eventsOf(db, 'o_student');
    const att1 = evs.filter(e => e.attemptId === 'att_1');
    t('A6 同一 attemptId 重放只记一条（正确率样本不被网络重试刷高）', att1.length === 1, '记了 ' + att1.length + ' 条');
    // 没有 attemptId 时按"每次调用即一次作答"追加
    await saveProgress.main({ itemId: 'k1', courseId: 'ielts_listening' });
    evs = await eventsOf(db, 'o_student');
    t('A7 不带 attemptId 时按每次作答追加（调用方自行决定是否给令牌）',
      evs.filter(e => e.itemId === 'k1' && !e.attemptId).length === 2,
      JSON.stringify(evs.map(e => e.itemId + ':' + e.attemptId)));

    // progress 的幂等 upsert 不受影响
    const prog = (await db.collection('progress').where({ openid: 'o_student' }).get()).data;
    t('A8 progress 仍是幂等 upsert（k1 只有 1 条）',
      prog.filter(p => p.itemId === 'k1').length === 1 && prog.filter(p => p.itemId === 'k2').length === 1,
      JSON.stringify(prog.map(p => p.itemId)));
  }

  {
    // 事件写入失败：不能拖垮作答主流程，但也不能谎报"记上了"
    const db = createDb({});
    db._addDenied = ['answer_events'];
    const saveProgress = loadFn('saveProgress', db);
    const r = await saveProgress.main({ itemId: 'k9', courseId: 'ap_calc' });
    const prog = (await db.collection('progress').where({ openid: 'o_student' }).get()).data;
    t('A9 事件写失败时作答本身仍然成功（progress 已落库）',
      r.code === 0 && prog.length === 1, JSON.stringify(r));
    t('A10 但如实回传 recorded=false，不假装记上了', r.recorded === false, JSON.stringify(r));
  }

  {
    const db = createDb({});
    const saveWrong = loadFn('saveWrong', db);
    const r = await saveWrong.main({
      itemId: 'k3', courseId: 'alevel_mech', courseName: 'A-Level力学',
      question: 'q', options: ['a', 'b'], answerIndex: 0, userAnswer: 1,
      explanation: 'e', source: 'lesson', attemptId: 'att_x'
    });
    const evs = await eventsOf(db, 'o_student');
    t('A11 答错落一条 correct=false 的事件（原来只改错题本当前状态）',
      r.code === 0 && evs.length === 1 && evs[0].correct === false, JSON.stringify(evs));
    t('A12 事件保留来源课程与 attemptId', evs[0].courseId === 'alevel_mech' && evs[0].source === 'lesson' && evs[0].attemptId === 'att_x');

    await saveWrong.main({
      itemId: 'k3', courseId: 'alevel_mech', answerIndex: 0, userAnswer: 1, attemptId: 'att_x'
    });
    t('A13 答错同样按 attemptId 幂等', (await eventsOf(db, 'o_student')).length === 1);
  }

  {
    // updateWrong：只有被计入的作答才落事件
    const dueDoc = (extra) => Object.assign({
      _id: 'w1', openid: 'o_student', itemId: 'k3', courseId: 'alevel_mech',
      wrongCount: 1, rightCount: 0, reviewCount: 0, interval: 0,
      status: 'reviewing', resolved: false,
      nextReviewTime: new Date(Date.now() - 3600000)   // 已到期
    }, extra || {});

    const db = createDb({ wrong_books: [dueDoc()] });
    const updateWrong = loadFn('updateWrong', db);

    const r1 = await updateWrong.main({ itemId: 'k3', correct: true, attemptId: 'r1' });
    let evs = await eventsOf(db, 'o_student');
    t('A14 到期的答对落一条 correct=true 事件',
      r1.code === 0 && evs.length === 1 && evs[0].correct === true && evs[0].source === 'review',
      JSON.stringify(evs));

    // 重复作答令牌 → 不落事件（否则重试就能把正确率刷高）
    const r2 = await updateWrong.main({ itemId: 'k3', correct: true, attemptId: 'r1' });
    evs = await eventsOf(db, 'o_student');
    t('A15 duplicated 不落事件', r2.duplicated === true && evs.length === 1, JSON.stringify(evs));

    // 未到期 → 不落事件（否则连点按钮就能刷满正确率）
    const db2 = createDb({ wrong_books: [dueDoc({ nextReviewTime: new Date(Date.now() + 86400000) })] });
    const updateWrong2 = loadFn('updateWrong', db2);
    const r3 = await updateWrong2.main({ itemId: 'k3', correct: true, attemptId: 'r2' });
    const evs2 = await eventsOf(db2, 'o_student');
    t('A16 tooEarly 不落事件（防连点刷正确率）',
      r3.tooEarly === true && evs2.length === 0, JSON.stringify([r3, evs2.length]));

    // 答错 → 落 correct=false
    const db3 = createDb({ wrong_books: [dueDoc()] });
    const updateWrong3 = loadFn('updateWrong', db3);
    const r4 = await updateWrong3.main({ itemId: 'k3', correct: false, attemptId: 'r3' });
    const evs3 = await eventsOf(db3, 'o_student');
    t('A17 答错落 correct=false（间隔归零也是一次作答事实）',
      r4.code === 0 && evs3.length === 1 && evs3[0].correct === false, JSON.stringify(evs3));
  }

  /* ============================ B 组：getDashboard ============================ */
  sec('B. getDashboard：指标由事件派生；没有数据时是 null 不是 0');

  {
    const db = createDb({});
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B1 全空账号：accuracy 是 null（不是 0%）',
      r.code === 0 && r.data.accuracy === null, JSON.stringify(r.data.accuracy));
    t('B2 accuracySample = 0，窗口标记为空', r.data.accuracySample === 0 && r.data.accuracyWindow === 'empty');
    t('B3 空账号的 metricsNote 说明"无法计算"', /无法计算/.test(r.data.metricsNote || ''), r.data.metricsNote);
    t('B4 空账号 activeDays/streak 都是 0', r.data.activeDays === 0 && r.data.streak === 0);
  }

  {
    // 关键反向：有"答对过"的 progress，但没有任何作答事件 → 仍不许编出正确率
    const db = createDb({
      progress: [{ _id: 'p1', openid: 'o_student', itemId: 'k1', courseId: 'ielts_listening', learned: true }]
    });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B5 只有 progress 没有事件时 accuracy 仍为 null（不从当前状态反推历史）',
      r.data.accuracy === null && r.data.learned === 1, JSON.stringify([r.data.accuracy, r.data.learned]));
  }

  {
    const db = createDb({
      answer_events: [
        seedEvent('o_student', dayKeyAgo(0), true),
        seedEvent('o_student', dayKeyAgo(0), true),
        seedEvent('o_student', dayKeyAgo(0), false),
        seedEvent('o_student', dayKeyAgo(0), true, { graded: false, source: 'self_mark' })
      ]
    });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B6 正确率 = 2/3 = 67%（自评不进分子分母）', r.data.accuracy === 67, String(r.data.accuracy));
    t('B7 样本量只算判定作答（3），自评单独报（1）',
      r.data.accuracySample === 3 && r.data.selfMarks === 1,
      JSON.stringify([r.data.accuracySample, r.data.selfMarks]));
    t('B8 accuracySince 标出统计从哪天开始', r.data.accuracySince === dayKeyAgo(0), r.data.accuracySince);
  }

  {
    // 毕业错题的答对也算（这是老口口径最大的漏洞：学得越好，分子掉得越多）
    const db = createDb({
      wrong_books: [{ _id: 'w1', openid: 'o_student', itemId: 'k1', courseId: 'x', status: 'resolved', resolved: true, rightCount: 9, wrongCount: 1 }],
      answer_events: [
        seedEvent('o_student', dayKeyAgo(0), true, { itemId: 'k1' }),
        seedEvent('o_student', dayKeyAgo(0), false, { itemId: 'k2' })
      ]
    });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B9 毕业（resolved）错题的答对仍在分子里，不被排除',
      r.data.accuracy === 50, String(r.data.accuracy));
    t('B10 待复习错题数单独报（口径是"当前待复习"，不是正确率的分母）',
      r.data.wrongCount === 0 && r.data.pendingReview === 0, String(r.data.wrongCount));
  }

  {
    // 活跃 / 连续 / 日历
    const db = createDb({
      answer_events: [
        seedEvent('o_student', dayKeyAgo(0), true),
        seedEvent('o_student', dayKeyAgo(1), true),
        seedEvent('o_student', dayKeyAgo(2), true),
        seedEvent('o_student', dayKeyAgo(5), true)      // 断档
      ]
    });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B11 连续 3 天（今天、昨天、前天），第 4 天断掉', r.data.streak === 3, String(r.data.streak));
    t('B12 近 30 天活跃天数 = 4 天', r.data.activeDays === 4, String(r.data.activeDays));
    t('B13 日历 30 格且第 0/1/2/5 天有计数',
      r.data.calendar.length === 30 &&
      r.data.calendar[29].count === 1 && r.data.calendar[28].count === 1 &&
      r.data.calendar[27].count === 1 && r.data.calendar[24].count === 1,
      JSON.stringify(r.data.calendar.slice(24).map(c => c.date + ':' + c.count)));
    t('B14 日历日键补零（YYYY-MM-DD，9 月与 10 月不会排反）',
      r.data.calendar.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
    t('B15 日历标签与日键一致（原来 slice(5) 会得到 9-3 而非 09-03）',
      r.data.calendar.every(c => c.date.slice(5) === c.label));
  }

  {
    // 今天没学、昨天学了 → streak = 1（原来那个"昨天起算"分支算不对）
    const db = createDb({
      answer_events: [seedEvent('o_student', dayKeyAgo(1), true), seedEvent('o_student', dayKeyAgo(2), true)]
    });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B16 今天没学、昨天前天都学了 → streak = 2（从昨天起算，不是 0）',
      r.data.streak === 2, String(r.data.streak));
  }

  {
    // 今天没学、昨天也没学 → 0
    const db = createDb({ answer_events: [seedEvent('o_student', dayKeyAgo(2), true)] });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B17 今天与昨天都没学 → streak = 0（不虚报）', r.data.streak === 0, String(r.data.streak));
  }

  {
    // 跨月：9 月 30 日与 10 月 1 日都要出现在正确的格子（补零前会排反）
    const db = createDb({
      answer_events: [seedEvent('o_student', dayKeyAgo(0), true), seedEvent('o_student', dayKeyAgo(1), true)]
    });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    const keys = r.data.calendar.map(c => c.date);
    const sorted = keys.slice().sort();
    t('B18 日历按时间正序（字符串排序与时间顺序一致）',
      JSON.stringify(keys) === JSON.stringify(sorted), JSON.stringify(keys.slice(26)));
  }

  {
    // 近 7 天：没作答的那天是 null，不是 0%
    const db = createDb({
      answer_events: [
        seedEvent('o_student', dayKeyAgo(0), true),
        seedEvent('o_student', dayKeyAgo(0), false),
        seedEvent('o_student', dayKeyAgo(3), true)
      ]
    });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    const w = r.data.weekAccuracy;
    t('B19 近 7 天固定 7 格', w.length === 7);
    t('B20 有作答的那天报了 attempts 与 accuracy',
      w[6].attempts === 2 && w[6].accuracy === 50, JSON.stringify(w[6]));
    t('B21 没作答的那天 accuracy 是 null（不是 0%）',
      w[5].attempts === 0 && w[5].accuracy === null && w[5].active === false, JSON.stringify(w[5]));
    t('B22 3 天前有作答：attempts=1 且 accuracy=100',
      w[3].attempts === 1 && w[3].accuracy === 100, JSON.stringify(w[3]));
  }

  {
    /* 判别性最强的一条：造一堆 checkins 数据。
       老实现会读出 activeDays=3、streak=3；新实现必须完全忽略它们，
       因为 checkins 从来没有人写，读它只会得到"看起来像真的"的数。 */
    const ck = (n) => ({ _id: 'c' + n, openid: 'o_student', createTime: new Date(Date.now() - n * 86400000) });
    const db = createDb({ checkins: [ck(0), ck(1), ck(2)] });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B23 只读事件的现在完全忽略 checkins（老实现会报 activeDays=3）',
      r.data.activeDays === 0 && r.data.streak === 0,
      JSON.stringify([r.data.activeDays, r.data.streak]));
  }

  {
    // 窗口被截断 → 连续天数只能算下界，必须标注
    const many = [];
    for (let i = 0; i < 1000; i++) many.push(seedEvent('o_student', dayKeyAgo(0), true));
    const db = createDb({ answer_events: many });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B24 事件窗口被截断时标记 streakIsLowerBound', r.data.streakIsLowerBound === true, JSON.stringify(r.data.streakIsLowerBound));
    t('B25 未截断时不标下界', (await (async () => {
      const db2 = createDb({ answer_events: [seedEvent('o_student', dayKeyAgo(0), true)] });
      const gd = loadFn('getDashboard', db2);
      return (await gd.main()).data.streakIsLowerBound;
    })()) === false);
  }

  {
    // 400 天前的事件不该影响"今天"的窗口（下界过滤生效）
    const old = seedEvent('o_student', dayKeyAgo(500), true);
    const db = createDb({ answer_events: [old] });
    const getDashboard = loadFn('getDashboard', db);
    const r = await getDashboard.main();
    t('B26 窗口下界生效：500 天前的事件不进日历，但仍在全量正确率分子里',
      r.data.activeDays === 0 && r.data.accuracy === 100 && r.data.accuracySample === 1,
      JSON.stringify([r.data.activeDays, r.data.accuracy, r.data.accuracySample]));
  }

  /* ============================ C 组：周报 ============================ */
  sec('C. sendWeeklyReport：studyDays / 本周正确率不再读 checkins');

  {
    process.env.WEEKLY_TEMPLATE_ID = 'TPL_WEEKLY';
    const ws = (() => {   // 本周一 00:00（北京时间）
      const bj = new Date(Date.now() + 8 * 3600 * 1000);
      const day = bj.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3600 * 1000 - diff * 86400000);
    })();
    const inWeekKey = bjDayKey(ws.getTime() + 12 * 3600 * 1000);

    const db = createDb({
      learners: [{ _id: 'o_student', openid: 'o_student' }],
      subscriptions: [{ _id: 'sub1', openid: 'o_student', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date() }],
      progress: [],
      wrong_books: [],
      // 故意不造 checkins —— 老实现会因此报 studyDays=0
      answer_events: [
        seedEvent('o_student', inWeekKey, true),
        seedEvent('o_student', inWeekKey, false),
        seedEvent('o_student', inWeekKey, false),
        seedEvent('o_student', inWeekKey, true, { graded: false, source: 'self_mark' })
      ]
    });
    const sendWeeklyReport = loadFn('sendWeeklyReport', db);
    const r = await sendWeeklyReport.main({});
    const rep = (await db.collection('weekly_reports').where({ openid: 'o_student' }).get()).data[0] || {};

    t('C1 周报生成成功', r.code === 0 && !!rep.weekKey, JSON.stringify(r));
    t('C2 本周学习天数来自作答事件（有作答就是 1 天）', rep.studyDays === 1, String(rep.studyDays));
    t('C3 本周正确率 = 1/3 = 33%（自评不进分子分母）', rep.accuracy === 33, String(rep.accuracy));
    t('C4 落库带上样本量（只给百分数无法判断有没有依据）', rep.attempts === 3 && rep.correctAttempts === 1,
      JSON.stringify([rep.attempts, rep.correctAttempts]));
  }

  {
    // 本周没有判定过的作答 → accuracy 为 null，不是 0
    process.env.WEEKLY_TEMPLATE_ID = 'TPL_WEEKLY';
    const db = createDb({
      learners: [{ _id: 'o_student', openid: 'o_student' }],
      subscriptions: [{ _id: 'sub1', openid: 'o_student', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date() }],
      progress: [], wrong_books: [], answer_events: []
    });
    const sendWeeklyReport = loadFn('sendWeeklyReport', db);
    await sendWeeklyReport.main({});
    const rep = (await db.collection('weekly_reports').where({ openid: 'o_student' }).get()).data[0] || {};
    t('C5 本周无判定作答时 accuracy 为 null（不是 0%）', rep.accuracy === null, String(rep.accuracy));
    t('C6 同时 attempts = 0', rep.attempts === 0);
  }

  {
    // 只读 checkins 的老实现会报 studyDays=3 —— 判别性反向断言
    process.env.WEEKLY_TEMPLATE_ID = 'TPL_WEEKLY';
    const ck = (n) => ({ _id: 'c' + n, openid: 'o_student', createTime: new Date(Date.now() - n * 3600000) });
    const db = createDb({
      learners: [{ _id: 'o_student', openid: 'o_student' }],
      subscriptions: [{ _id: 'sub1', openid: 'o_student', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date() }],
      progress: [], wrong_books: [], answer_events: [],
      checkins: [ck(1), ck(2), ck(3)]
    });
    const sendWeeklyReport = loadFn('sendWeeklyReport', db);
    await sendWeeklyReport.main({});
    const rep = (await db.collection('weekly_reports').where({ openid: 'o_student' }).get()).data[0] || {};
    t('C7 周报同样不再从 checkins 推学习天数（老实现会报 3）', rep.studyDays === 0, String(rep.studyDays));
  }

  /* ============================ D 组：导出与注销 ============================ */
  sec('D. 导出与注销：不再报不成立的打卡数；真正在写的集合随账号删除');

  {
    const db = createDb({
      progress: [{ _id: 'p1', openid: 'o_student', itemId: 'k1', learned: true }],
      wrong_books: [{ _id: 'w1', openid: 'o_student', itemId: 'k2', status: 'reviewing' }],
      answer_events: [
        seedEvent('o_student', dayKeyAgo(0), true, { source: 'quiz' }),
        seedEvent('o_student', dayKeyAgo(0), false, { source: 'review' }),
        seedEvent('o_student', dayKeyAgo(1), true, { graded: false, source: 'self_mark' })
      ],
      homework: [],
      checkins: []
    });
    const exportUserData = loadFn('exportUserData', db);
    const r = await exportUserData.main();
    t('D1 导出 summary 里不再有 checkinCount', !('checkinCount' in r.summary), JSON.stringify(Object.keys(r.summary)));
    t('D2 改为导出作答事件条数', r.summary.answerEventCount === 3, JSON.stringify(r.summary));
    t('D3 区分判定作答与自评', r.summary.gradedAttemptCount === 2 && r.summary.selfMarkCount === 1,
      JSON.stringify(r.summary));
    t('D4 作答事件本体也导出（数据可携带）', Array.isArray(r.data.answerEvents) && r.data.answerEvents.length === 3);
    t('D5 历史遗留的 checkins 仍导出但不冒充现役指标',
      Array.isArray(r.data.legacyCheckins) && r.data.legacyCheckins.length === 0);
  }

  {
    const db = createDb({
      progress: [{ _id: 'p1', openid: 'o_student', itemId: 'k1' }],
      answer_events: [seedEvent('o_student', dayKeyAgo(0), true)],
      analytics: [{ _id: 'a1', openid: 'o_student', event: 'quiz_complete' }],
      checkins: [{ _id: 'c1', openid: 'o_student' }],
      wrong_books: [], learners: [{ _id: 'o_student', openid: 'o_student' }]
    });
    const deleteAccount = loadFn('deleteAccount', db);
    const r = await deleteAccount.main();
    t('D6 注销返回成功', r.code === 0, JSON.stringify(r));
    t('D7 answer_events 被清除', (await eventsOf(db, 'o_student')).length === 0, JSON.stringify(r.removed));
    t('D8 analytics 也被清除（原来漏掉了真正在写的集合）',
      (await db.collection('analytics').where({ openid: 'o_student' }).get()).data.length === 0,
      JSON.stringify(r.removed));
    t('D9 progress / checkins / learners 一并清除',
      (await db.collection('progress').where({ openid: 'o_student' }).get()).data.length === 0 &&
      (await db.collection('checkins').where({ openid: 'o_student' }).get()).data.length === 0 &&
      (await db.collection('learners').where({ _id: 'o_student' }).get()).data.length === 0,
      JSON.stringify(r.removed));
  }

  /* --------------------------- 文档与口径说明 --------------------------- */
  sec('E. 口径文档');

  {
    const fs = require('fs');
    const docPath = path.join(CF_DIR, '学习事件与指标口径.md');
    const exists = fs.existsSync(docPath);
    t('E1 口径文档存在', exists, docPath);
    if (exists) {
      const doc = fs.readFileSync(docPath, 'utf8');
      t('E2 文档写明 answer_events 是部署前置条件', /部署前置条件/.test(doc) && /answer_events/.test(doc));
      t('E3 文档写明"没有数据时返回 null 而不是 0"', /null，不是 0|不是 0/.test(doc));
      t('E4 文档写明自评不进分子分母', /不进正确率的分子也不进分母|不进分子/.test(doc));
      t('E5 文档说明为什么不做历史回填', /不做历史回填|不回填/.test(doc));
    }
  }

  console.log('\nMETRICS_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('METRICS_ERROR ' + ((e && e.stack) || e));
  process.exit(2);
});
