const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 读取已发布（审核通过）的 AI 生成课程。
 * 与本地 courses.js 的课程并列展示，作为「AI 生成课程」的消费端，
 * 打通「aiCourseGen → courses_draft → reviewDraft(approve) → courses → getAICourses」完整链路。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const limit = Math.min(50, Number(event && event.limit) || 20);

  try {
    const res = await db.collection('courses')
      .where({ status: 'published' })
      .orderBy('publishTime', 'desc')
      .limit(limit)
      .get();

    // 归一化为前端可直接渲染的课程结构
    const list = (res.data || []).map(c => ({
      id: c._id,
      title: c.title || c.topic || 'AI 生成课程',
      system: c.system || '',
      subject: c.subject || '',
      topic: c.topic || '',
      level: c.level || '',
      type: c.type || 'course',
      source: 'ai_generated',
      content: c.content || {},
      publishTime: c.publishTime ? new Date(c.publishTime).getTime() : Date.now()
    }));

    return { code: 0, list };
  } catch (e) {
    // 集合不存在（尚未有任何发布）→ 空列表
    return { code: 0, list: [] };
  }
};
