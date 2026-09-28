const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 审核后台：列出待审核的 AI 生成草稿。
 * status: 'draft'(默认，待审) | 'approved' | 'rejected' | 'all'
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  const status = (event && event.status) || 'draft';
  const limit = Math.min(100, Number(event && event.limit) || 50);

  try {
    let q = db.collection('courses_draft');
    if (status !== 'all') q = q.where({ status });
    const res = await q.orderBy('createTime', 'desc').limit(limit).get();

    // 归一化：前端需要 id 与可读时间戳
    const list = (res.data || []).map(d => ({
      id: d._id,
      type: d.type || 'course',
      system: d.system || '',
      subject: d.subject || '',
      topic: d.topic || '',
      title: (d.content && d.content.title) || d.topic || '',
      status: d.status || 'draft',
      content: d.content || {},
      createTime: d.createTime ? new Date(d.createTime).getTime() : Date.now()
    }));

    return { code: 0, list, total: list.length };
  } catch (e) {
    return { code: 0, list: [], total: 0 };
  }
};
