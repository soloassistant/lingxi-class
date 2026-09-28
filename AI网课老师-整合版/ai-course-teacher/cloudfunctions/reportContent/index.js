const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const REASONS = ['广告', '色情', '暴力', '诈骗', '侵权', '骚扰', '其他'];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { targetType, targetId, reason } = event;

  if (!targetId || !targetType) return { code: 1, msg: '参数缺失' };

  if (reason && !REASONS.includes(reason) && reason.length > 20) {
    return { code: 1, msg: '举报原因不合法' };
  }

  // 检查是否已举报过同一条
  const exist = await db.collection('reports')
    .where({ openid: OPENID, targetType, targetId })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));

  if (exist.data.length > 0) {
    return { code: 2, msg: '你已经举报过这条内容' };
  }

  await db.collection('reports').add({
    data: {
      openid: OPENID,
      targetType,       // 'checkin' / 'post' / 'comment'
      targetId,
      reason: reason || '其他',
      status: 'pending', // pending / reviewed / rejected
      createTime: db.serverDate()
    }
  }).catch(() => {});

  return { code: 0, msg: '已提交举报，我们会尽快处理' };
};
