const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  try {
    const res = await db.collection('posts')
      .orderBy('time', 'desc')
      .limit(50)
      .get();

    // 归一化：前端需要 id 字段与数字时间戳 ts
    const list = res.data.map(p => ({
      ...p,
      id: p._id,
      ts: p.time ? new Date(p.time).getTime() : Date.now()
    }));

    return { code: 0, list };
  } catch (e) {
    return { code: 0, list: [] };
  }
};
