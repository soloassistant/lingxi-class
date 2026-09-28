const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const res = await db.collection('progress')
    .where({ openid: OPENID })
    .limit(200)
    .get();
  return { code: 0, list: res.data };
};
