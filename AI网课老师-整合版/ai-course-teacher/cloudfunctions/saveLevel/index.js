const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const { level, levelName, accuracy } = event;
  if (!level) return { code: 1, msg: '等级不能为空' };

  // 更新 learners（保留 system/examDate 等既有字段）
  await db.collection('learners').doc(OPENID).update({
    data: {
      level,
      levelName: levelName || '',
      accuracy: accuracy !== undefined ? accuracy : null,
      updateTime: db.serverDate()
    }
  }).catch(async () => {
    // 记录不存在则创建
    await db.collection('learners').doc(OPENID).set({
      data: {
        openid: OPENID,
        level,
        levelName: levelName || '',
        accuracy: accuracy !== undefined ? accuracy : null,
        updateTime: db.serverDate()
      }
    }).catch(() => {});
  });

  return { code: 0 };
};
