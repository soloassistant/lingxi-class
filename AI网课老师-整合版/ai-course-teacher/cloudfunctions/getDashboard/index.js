const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  // 并行拉取四类数据
  const [progress, wrong, checkins, learner] = await Promise.all([
    db.collection('progress').where({ openid: OPENID }).limit(1000).get().catch(() => ({ data: [] })),
    db.collection('wrong_books').where({ openid: OPENID, status: 'reviewing' }).limit(500).get().catch(() => ({ data: [] })),
    db.collection('checkins').where({ openid: OPENID }).orderBy('createTime', 'desc').limit(60).get().catch(() => ({ data: [] })),
    db.collection('learners').doc(OPENID).get().catch(() => null)
  ]);

  const learnedCount = progress.data.length;

  // 连续学习天数：从最近一次打卡向前数连续天数
  const days = checkins.data
    .map(c => {
      const d = new Date(c.createTime);
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    })
    .filter((v, i, a) => a.indexOf(v) === i) // 去重
    .sort()
    .reverse();

  let streak = 0;
  const today = new Date();
  const dayStr = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  let cursor = today;

  for (let i = 0; i < days.length; i++) {
    if (days[i] === dayStr(cursor)) {
      streak++;
      cursor = new Date(cursor.getTime() - 86400000);
    } else if (i === 0 && days[i] !== dayStr(today) && days[i] === dayStr(new Date(today.getTime() - 86400000))) {
      // 今天没打卡，从昨天开始算
      streak++;
      cursor = new Date(cursor.getTime() - 86400000);
    } else {
      break;
    }
  }

  // 正确率：有 wrongCount 的记录占比
  const totalAttempts = wrong.data.reduce((s, w) => s + (w.wrongCount || 0) + (w.rightCount || 0), 0);
  const correctAttempts = wrong.data.reduce((s, w) => s + (w.rightCount || 0), 0);
  const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0;

  // 近 7 天正确率曲线
  const weekAccuracy = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    const dayLogs = checkins.data.filter(c => {
      const cd = new Date(c.createTime);
      return (cd.getFullYear() + '-' + (cd.getMonth() + 1) + '-' + cd.getDate()) === key;
    });
    weekAccuracy.push({ date: key.slice(5), count: dayLogs.length });
  }

  // 近 30 天打卡日历（热力图，留存 + 晒图钩子）
  const dayKey = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  const checkinSet = {};
  checkins.data.forEach(c => {
    const k = dayKey(new Date(c.createTime));
    checkinSet[k] = (checkinSet[k] || 0) + 1;
  });
  const calendar = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = dayKey(d);
    calendar.push({
      date: key,
      label: key.slice(5),
      count: checkinSet[key] || 0
    });
  }
  const activeDays = calendar.filter(c => c.count > 0).length;

  // 学习成就（对标粉笔/得到/Duolingo 勋章体系）
  const achievements = buildAchievements({ streak, learned: learnedCount, wrongCount: wrong.data.length });

  // 薄弱知识点 TOP（对标作业帮/高途学情报告，按错误次数聚合）
  const weakPoints = buildWeakPoints(wrong.data);

  return {
    code: 0,
    data: {
      streak,
      learned: learnedCount,
      wrongCount: wrong.data.length,
      accuracy,
      weekAccuracy,
      calendar,
      activeDays,
      achievements,
      weakPoints,
      target: learner ? {
        system: learner.data.system || '',
        examDate: learner.data.examDate ? new Date(learner.data.examDate).toISOString().slice(0, 10) : '',
        daysLeft: learner.data.examDate
          ? Math.max(0, Math.ceil((new Date(learner.data.examDate) - today) / 86400000))
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
