const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 学情周报订阅消息模板 ID（在微信公众平台「订阅消息」中申请后填入）
const TEMPLATE_ID = 'REPLACE_WITH_SUBSCRIBE_TEMPLATE_ID';

/**
 * 记录一次「学情周报」订阅授权。
 * 前端 wx.requestSubscribeMessage 成功后调用，每次授权计一次可发送额度。
 * event.count 为本次授权次数（默认 1）。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  const count = Math.max(1, Math.min(10, Number(event.count) || 1));
  const templateId = event.templateId || TEMPLATE_ID;

  // 一次授权 = 一条待消费记录（微信一次性订阅：授权一次只能推一条）
  const tasks = [];
  for (let i = 0; i < count; i++) {
    tasks.push(db.collection('subscriptions').add({
      data: {
        openid: OPENID,
        templateId,
        scene: event.scene || 'weekly_report',
        status: 'pending',   // pending / used / expired
        createTime: db.serverDate(),
        usedTime: null
      }
    }));
  }

  try {
    await Promise.all(tasks);
  } catch (e) {
    // 集合不存在时创建后重试一次
    await db.createCollection('subscriptions').catch(() => {});
    await Promise.all(tasks).catch(() => {});
  }

  // 用户可见的订阅状态，供「我的」页展示
  await db.collection('learner_prefs').doc(OPENID).set({
    data: {
      openid: OPENID,
      weeklyReport: true,
      updateTime: db.serverDate()
    }
  }).catch(() => {});

  return { code: 0, count, templateId };
};
