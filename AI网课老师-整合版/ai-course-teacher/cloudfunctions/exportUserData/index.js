const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const safeGet = (name) =>
    db.collection(name).where({ openid: OPENID }).limit(1000).get().catch(() => ({ data: [] }));

  const [progress, wrongs, checkins, homework] = await Promise.all([
    safeGet('progress'),
    safeGet('wrong_books'),
    safeGet('checkins'),
    safeGet('homework')
  ]);

  return {
    code: 0,
    summary: {
      progressCount: progress.data.length,
      wrongCount: wrongs.data.length,
      checkinCount: checkins.data.length,
      homeworkCount: homework.data.length
    },
    data: {
      progress: progress.data,
      wrongs: wrongs.data,
      checkins: checkins.data,
      homework: homework.data
    }
  };
};
