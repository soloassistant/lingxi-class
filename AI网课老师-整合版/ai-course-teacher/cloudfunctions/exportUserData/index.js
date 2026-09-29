const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ★ R11（2026-09-29）：把"打卡条数"从导出里换掉。
   checkins 全仓没有任何写入路径，所以 checkinCount 恒为 0 ——
   而这个 0 会经由个人中心直接呈现给用户（"打卡 0 条"），
   变成一句用户看得见、却毫无依据的陈述。
   换成真正在写的 answer_events（每次作答一条的作答事实），
   并把每次作答的对错、来源、北京时间日键一并导出 —— 这才叫"数据可携带"。
   旧 checkins 若存在历史数据仍会导出（legacyCheckins），不隐瞒也不冒充现役指标。 */
exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const safeGet = (name) =>
    db.collection(name).where({ openid: OPENID }).limit(1000).get().catch(() => ({ data: [] }));

  const [progress, wrongs, answerEvents, checkins, homework] = await Promise.all([
    safeGet('progress'),
    safeGet('wrong_books'),
    safeGet('answer_events'),
    safeGet('checkins'),
    safeGet('homework')
  ]);

  const graded = answerEvents.data.filter(e => e.graded !== false);

  return {
    code: 0,
    summary: {
      progressCount: progress.data.length,
      wrongCount: wrongs.data.length,
      answerEventCount: answerEvents.data.length,
      gradedAttemptCount: graded.length,
      selfMarkCount: answerEvents.data.length - graded.length,
      homeworkCount: homework.data.length,
      legacyCheckinCount: checkins.data.length
    },
    data: {
      progress: progress.data,
      wrongs: wrongs.data,
      answerEvents: answerEvents.data,
      homework: homework.data,
      legacyCheckins: checkins.data
    }
  };
};
