const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const [progressRes, wrongRes] = await Promise.all([
    db.collection('progress').where({ openid: OPENID }).limit(1000).get(),
    db.collection('wrong_books').where({ openid: OPENID }).limit(1000).get()
  ]);

  const days = new Set(
    progressRes.data.map(p => {
      const d = new Date(p.updateTime || p.createTime);
      return d.toDateString();
    })
  ).size;

  return {
    code: 0,
    stats: {
      days,
      done: progressRes.data.length,
      wrongs: wrongRes.data.length
    }
  };
};
