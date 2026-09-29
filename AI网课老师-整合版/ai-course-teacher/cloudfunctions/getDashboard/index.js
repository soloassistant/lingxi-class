const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ===== ★ R11（2026-09-29）：仪表盘改为"由作答事实事件派生" =====
   改之前的两个毛病：

   ① 正确率口径不成立。原实现：
        wrong_books.where({status:'reviewing'}) → rightCount/(rightCount+wrongCount)
      三重偏差叠在一起：首次答对不进 wrong_books（分子缺一块）；
      "毕业"（status='resolved'）的题被排除（分子又缺一块）；
      再次答错会把 rightCount 归零（历史被改写）。
      结果：正常保存一个答对的知识点，`learned=1, accuracy=0` —— 自相矛盾的反馈。

   ② 活跃/连续天数来自 checkins 集合，而**全仓没有任何写入路径**。
      于是 activeDays 恒为 0、streak 恒为 0、热力图恒为空白。
      现在改为由作答事件派生（有作答即活跃），并把 checkins 的读取删掉 ——
      读一个没人写的集合只能得到"看起来是真实数据"的 0。

   同时修掉两个日期缺陷：
     · 原 dayKey 是 `Y-M-D` **不补零**，既与它自己的 `key.slice(5)` 标签不一致，
       也让字符串排序把 9 月和 10 月排反（'2026-9-30' > '2026-10-01'）；
     · 原"今天没打卡就从昨天起算"分支只在 i===0 生效，且游标递减写错，
       连续 3 天以上会算断。

   日期一律按**北京时间**计算（云函数跑在 UTC）：不然早上 8 点前的学习会被记到前一天，
   还会和周报（本来就是按 +8 算的）互相打架。

   指标口径（也写在 cloudfunctions/学习事件与指标口径.md）：
     · 正确率 = 服务端判定过的作答里答对的比例，只看 graded=true 的事件；
       学生自评"我已掌握"（graded=false）**不进分子也不进分母**，单独报 selfMarks。
     · 没有作答记录时 accuracy 返回 **null**，不是 0 —— 0% 和"还没有数据"是两件事。
     · 活跃天/连续天数：任何作答事件都算（含自评），按北京时间自然日去重。 */

const BJ_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;
const WINDOW_DAYS = 400;      // 连续天数要往回走，窗口给足
const WINDOW_LIMIT = 1000;    // 云数据库单次 get 上限
const CALENDAR_DAYS = 30;
const WEEK_DAYS = 7;

function bjDayKey(ms) {
  const bj = new Date(ms + BJ_OFFSET_MS);
  return bj.getUTCFullYear() + '-' +
    String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(bj.getUTCDate()).padStart(2, '0');
}

// 第 n 天前的北京时间日键（中国无夏令时，直接按毫秒回退即可）
function dayKeyAgo(n) { return bjDayKey(Date.now() - n * DAY_MS); }

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  const _ = db.command;
  const events = db.collection('answer_events');
  const sinceMs = Date.now() - WINDOW_DAYS * DAY_MS;

  // 并行拉取：进度 / 待复习错题 / 学习者画像 / 作答事件窗口 / 三个精确计数
  const [progress, wrong, learner, windowRes, totalCnt, correctCnt, selfCnt, firstEvt] = await Promise.all([
    db.collection('progress').where({ openid: OPENID }).limit(1000).get().catch(() => ({ data: [] })),
    db.collection('wrong_books').where({ openid: OPENID, status: 'reviewing' }).limit(500).get().catch(() => ({ data: [] })),
    db.collection('learners').doc(OPENID).get().catch(() => null),
    events.where({ openid: OPENID, ts: _.gte(sinceMs) }).orderBy('ts', 'desc').limit(WINDOW_LIMIT).get().catch(() => ({ data: [] })),
    events.where({ openid: OPENID, graded: true }).count().catch(() => ({ total: 0 })),
    events.where({ openid: OPENID, graded: true, correct: true }).count().catch(() => ({ total: 0 })),
    events.where({ openid: OPENID, graded: false }).count().catch(() => ({ total: 0 })),
    events.where({ openid: OPENID, graded: true }).orderBy('ts', 'asc').limit(1).get().catch(() => ({ data: [] }))
  ]);

  const learnedCount = progress.data.length;

  /* ---------- 正确率：来自作答事实事件，而非错题当前状态 ---------- */
  const attempts = totalCnt.total || 0;
  const correct = correctCnt.total || 0;
  const selfMarks = selfCnt.total || 0;
  const accuracy = attempts > 0 ? Math.round((correct / attempts) * 100) : null;

  const first = firstEvt.data && firstEvt.data[0];
  const accuracySince = first ? (first.dayKey || bjDayKey(first.ts || Date.now())) : '';
  // 统计窗口：有事件就是"全部历史"，没事件就是空的 —— 别让界面以为窗口是从今天开始
  const accuracyWindow = attempts > 0 ? ('all-since-' + accuracySince) : 'empty';

  /* ---------- 活跃日历 / 连续天数：也来自作答事件 ---------- */
  const win = windowRes.data || [];
  const windowComplete = win.length < WINDOW_LIMIT;   // 被截断时连续天数只能算下界

  const perDay = {};
  win.forEach(e => {
    const k = e.dayKey || bjDayKey(e.ts || Date.now());
    perDay[k] = (perDay[k] || 0) + 1;
  });

  const calendar = [];
  for (let i = CALENDAR_DAYS - 1; i >= 0; i--) {
    const key = dayKeyAgo(i);
    calendar.push({ date: key, label: key.slice(5), count: perDay[key] || 0 });
  }
  const activeDays = calendar.filter(c => c.count > 0).length;

  const hasToday = (perDay[dayKeyAgo(0)] || 0) > 0;
  let streak = 0;
  for (let i = hasToday ? 0 : 1; i < WINDOW_DAYS; i++) {
    if (!perDay[dayKeyAgo(i)]) break;
    streak++;
  }

  /* ---------- 近 7 天：每天的作答量与正确率（没作答的那天是 null，不是 0%） ---------- */
  const weekAgg = {};
  win.forEach(e => {
    const k = e.dayKey || bjDayKey(e.ts || Date.now());
    if (!weekAgg[k]) weekAgg[k] = { attempts: 0, correct: 0 };
    if (e.graded !== false) {
      weekAgg[k].attempts++;
      if (e.correct) weekAgg[k].correct++;
    }
  });
  const weekAccuracy = [];
  for (let i = WEEK_DAYS - 1; i >= 0; i--) {
    const key = dayKeyAgo(i);
    const a = weekAgg[key] || { attempts: 0, correct: 0 };
    weekAccuracy.push({
      date: key.slice(5),
      active: (perDay[key] || 0) > 0,
      attempts: a.attempts,
      accuracy: a.attempts > 0 ? Math.round((a.correct / a.attempts) * 100) : null
    });
  }

  /* ---------- 其余保持原样 ---------- */
  const wrongCount = wrong.data.length;
  const wrongListTruncated = wrongCount >= 500;   // 薄弱点只在前 500 条里聚合
  const achievements = buildAchievements({ streak, learned: learnedCount, wrongCount });
  const weakPoints = buildWeakPoints(wrong.data);
  const today = new Date();

  return {
    code: 0,
    data: {
      streak,
      streakIsLowerBound: !windowComplete,
      learned: learnedCount,
      wrongCount,
      pendingReview: wrongCount,
      wrongListTruncated,
      accuracy,
      accuracySample: attempts,
      correctAttempts: correct,
      selfMarks,
      accuracySince,
      accuracyWindow,
      accuracyIsEstimate: false,
      weekAccuracy,
      calendar,
      activeDays,
      achievements,
      weakPoints,
      metricsNote: attempts > 0
        ? '正确率 = 已判定作答中答对的比例（不含"我已掌握"这类自评），样本 ' + attempts + ' 次'
        : '还没有判定过的作答记录，正确率暂时无法计算（不显示 0%）',
      target: learner ? {
        system: learner.data.system || '',
        examDate: learner.data.examDate ? new Date(learner.data.examDate).toISOString().slice(0, 10) : '',
        daysLeft: learner.data.examDate
          ? Math.max(0, Math.ceil((new Date(learner.data.examDate) - today) / DAY_MS))
          : 0
      } : null
    }
  };
};

// 成就定义与计算：progress 取 [0, target] 百分比，unlocked 表示是否已点亮
function buildAchievements(s) {
  const defs = [
    { id: 'first_learn', name: '初学乍练', desc: '完成第 1 个知识点', icon: '🌱', target: 1, cur: s.learned },
    { id: 'learn_10', name: '渐入佳境', desc: '掌握 10 个知识点', icon: '📚', target: 10, cur: s.learned },
    { id: 'learn_20', name: '小有所成', desc: '掌握 20 个知识点', icon: '🎓', target: 20, cur: s.learned },
    { id: 'streak_3', name: '三日之约', desc: '连续学习 3 天', icon: '🔥', target: 3, cur: s.streak },
    { id: 'streak_7', name: '七日恒心', desc: '连续学习 7 天', icon: '⚡', target: 7, cur: s.streak },
    { id: 'streak_21', name: '习惯养成', desc: '连续学习 21 天', icon: '🏆', target: 21, cur: s.streak },
    { id: 'zero_wrong', name: '清空错题', desc: '待复习错题为 0', icon: '✨', target: 0, cur: s.wrongCount, zeroBased: true }
  ];
  return defs.map(d => {
    const unlocked = d.zeroBased ? d.cur === 0 && s.learned >= 1 : d.cur >= d.target;
    const progress = d.zeroBased
      ? (s.learned >= 1 && d.cur === 0 ? 100 : 0)
      : Math.min(100, Math.round((d.cur / d.target) * 100));
    return { id: d.id, name: d.name, desc: d.desc, icon: d.icon, unlocked, progress };
  });
}

// 薄弱点：按 courseId 聚合待复习错题，倒序取前 5
function buildWeakPoints(wrongs) {
  const map = {};
  wrongs.forEach(w => {
    const cid = w.courseId || '其他';
    if (!map[cid]) map[cid] = { courseId: cid, courseName: w.courseName || cid, count: 0 };
    map[cid].count++;
  });
  return Object.values(map)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}
