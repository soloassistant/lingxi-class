const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const itemId = event.itemId || '';
  if (!itemId) return { code: 1, msg: '参数缺失' };

  const res = await db.collection('homework').add({
    data: {
      openid: OPENID,
      itemId,
      courseId: event.courseId || '',
      userAnswer: event.userAnswer !== undefined ? event.userAnswer : -1,
      answerIndex: event.answerIndex !== undefined ? event.answerIndex : -1,
      status: event.status || 'submitted',
      createTime: db.serverDate(),
      submittedAt: db.serverDate()
    }
  }).catch(() => null);

  return { code: 0, submissionId: res ? res._id : null };
};
