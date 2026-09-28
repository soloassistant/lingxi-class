const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 审核人白名单：只有名单内的 openid 才能审核（防止任意用户调用通过/驳回）
// 部署时通过环境变量 ADMIN_OPENIDS 配置（逗号分隔），例如：
//   ADMIN_OPENIDS=oXxx1,oXxx2
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  // 审核权限：配置了白名单则校验，未配置则允许（自托管场景）——但仍建议生产环境配置
  if (ADMIN_OPENIDS.length > 0 && !ADMIN_OPENIDS.includes(OPENID)) {
    return { code: 403, msg: '无审核权限' };
  }

  const { draftId, action } = event; // action: 'approve' | 'reject'
  if (!draftId || !action) return { code: 1, msg: '参数缺失' };
  if (action !== 'approve' && action !== 'reject') return { code: 1, msg: 'action 不合法' };

  const doc = await db.collection('courses_draft').doc(draftId).get().catch(() => null);
  if (!doc || !doc.data) return { code: 2, msg: '草稿不存在' };
  const draft = doc.data;

  // 防止重复处理
  if (draft.status === 'approved' || draft.status === 'rejected') {
    return { code: 3, msg: '该草稿已处理过', status: draft.status };
  }

  if (action === 'approve') {
    // 审核通过 → 发布到正式 courses 集合（打通「生成→审核→上线」链路）
    const published = {
      source: 'ai_generated',
      sourceDraftId: draftId,
      type: draft.type || 'course',     // 'course' | 'teach'
      system: draft.system || '',
      subject: draft.subject || '',
      topic: draft.topic || '',
      level: draft.level || '',
      title: (draft.content && draft.content.title) || draft.topic || '',
      content: draft.content || {},
      creator: draft.openid || '',
      status: 'published',
      publishedBy: OPENID,
      createTime: db.serverDate(),
      publishTime: db.serverDate()
    };

    try {
      await db.collection('courses').add({ data: published });
    } catch (e) {
      // 集合不存在时创建后重试一次
      await db.createCollection('courses').catch(() => {});
      try {
        await db.collection('courses').add({ data: published });
      } catch (e2) {
        return { code: 500, msg: '发布失败，请稍后重试' };
      }
    }
  }

  await db.collection('courses_draft').doc(draftId).update({
    data: {
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewBy: OPENID,
      reviewTime: db.serverDate()
    }
  });

  return { code: 0, msg: action === 'approve' ? '已通过并发布' : '已驳回' };
};
