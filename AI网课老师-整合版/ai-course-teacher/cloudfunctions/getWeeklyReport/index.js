const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 读取当前用户最近一期学情周报。
 * 用于报告页展示（推送落地页），也用于回看历史周报。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  const limit = Math.min(12, Number(event.limit) || 1);

  const res = await db.collection('weekly_reports')
    .where({ openid: OPENID })
    .orderBy('weekStart', 'desc')
    .limit(limit)
    .get()
    .catch(() => ({ data: [] }));

  // 订阅状态：是否还有可推送额度
  const pendingRes = await db.collection('subscriptions')
    .where({ openid: OPENID, status: 'pending' })
    .count()
    .catch(() => ({ total: 0 }));

  return {
    code: 0,
    list: res.data || [],
    latest: (res.data && res.data[0]) || null,
    subscribed: (pendingRes.total || 0) > 0
  };
};
