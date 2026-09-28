const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const system = event.systemId;
  const examDate = event.examDate;
  const subject = event.subject;
  const targetScore = event.targetScore;
  const dailyMinutes = event.dailyMinutes;

  if (!system) return { code: 1, msg: '体系不能为空' };

  await db.collection('learners').doc(OPENID).set({
    data: {
      openid: OPENID,
      system: system || '',
      subject: subject || '',
      examDate: examDate ? new Date(examDate) : new Date(Date.now() + 90 * 86400000),
      targetScore: targetScore || '',
      dailyMinutes: dailyMinutes || 30,
      updateTime: db.serverDate()
    }
  }).catch(() => {});

  return { code: 0, msg: '已保存' };
};
