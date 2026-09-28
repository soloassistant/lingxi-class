const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const coll = db.collection('progress');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const itemId = event.itemId || '';
  if (!itemId) return { code: 1, msg: '参数错误' };

  const courseId = event.courseId || '';

  try {
    // 幂等 upsert：where { openid, itemId, courseId }
    const existRes = await coll
      .where({ openid: OPENID, itemId, courseId })
      .limit(1)
      .get();

    if (existRes.data.length > 0) {
      await coll.doc(existRes.data[0]._id).update({
        data: {
          learned: true,
          updateTime: db.serverDate()
        }
      });
    } else {
      await coll.add({
        data: {
          openid: OPENID,
          itemId,
          courseId,
          learned: true,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
    }
    return { code: 0 };
  } catch (e) {
    return { code: 500, msg: e.message };
  }
};
