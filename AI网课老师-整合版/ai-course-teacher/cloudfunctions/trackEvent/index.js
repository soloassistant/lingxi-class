const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 统一埋点云函数：前端关键行为上报。
 * event: 事件名（如 quiz_complete / ai_teach_start / wrong_review）
 * props: 附加属性（如 score / level / itemId）
 * 数据落 analytics 集合，供北极星指标与漏斗分析。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const ev = (event && event.event) || '';
  if (!ev) return { code: 1, msg: '事件名为空' };
  if (ev.length > 64) return { code: 1, msg: '事件名过长' };

  const props = (event && event.props && typeof event.props === 'object') ? event.props : {};

  try {
    await db.collection('analytics').add({
      data: {
        openid: OPENID,
        event: ev,
        props,
        ts: Date.now(),
        createTime: db.serverDate()
      }
    });
  } catch (e) {
    // 集合不存在时创建后重试一次
    await db.createCollection('analytics').catch(() => {});
    try {
      await db.collection('analytics').add({
        data: { openid: OPENID, event: ev, props, ts: Date.now(), createTime: db.serverDate() }
      });
    } catch (e2) {}
  }

  return { code: 0 };
};
