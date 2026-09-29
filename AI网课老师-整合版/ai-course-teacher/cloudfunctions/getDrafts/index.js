const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ============================================================
   审核权限判定（外部审查 R10）
   ------------------------------------------------------------
   原状：getDrafts 只要求"存在 OPENID"就返回全体用户的草稿；
        reviewDraft 在 ADMIN_OPENIDS 未配置时**放行任意登录用户**。
        于是一台没配白名单的机器上，任何学生都能读别人的草稿、并审批发布内容。
   改法：两处用同一套判定，且 **default-deny** ——
        配置缺失是部署问题，不能靠"默认放行"糊过去
        （那等于把安全策略交给"某个环境变量存不存在"）。
        判定与配置分离才是问题根源，所以失败时要把"缺配置"说清楚，
        而不是含糊地回一句"无权限"，否则运维只会以为是自己权限不够。

   ⚠ 下面三个函数必须在 getDrafts 与 reviewDraft 里**逐字一致**：
     微信云函数各自独立打包，无法共享模块。改一处必须改两处。
   ============================================================ */
function adminOpenids() {
  return String(process.env.ADMIN_OPENIDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}
function isAdmin(openid) {
  const list = adminOpenids();
  if (!list.length) return false;              // ★ 未配置 = 拒绝
  return list.indexOf(openid) >= 0;
}
function adminDenied() {
  if (!adminOpenids().length) {
    return { code: 403, msg: '审核功能未启用：云函数环境变量 ADMIN_OPENIDS 未配置（部署问题，请联系管理员）' };
  }
  return { code: 403, msg: '无审核权限' };
}

/**
 * 审核后台：列出待审核的 AI 生成草稿。
 * status: 'draft'(默认，待审) | 'approved' | 'rejected' | 'all'
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  /* ★ 2026-09-29 修（外部审查 R10，P1）：
     原来这里只要求"存在 OPENID"，就读取**全体用户**的草稿 ——
     任何登录的普通学生都能翻到别人的未发布内容。
     前端有没有做管理入口，完全不能替代云函数这一层的授权。
     现在与 reviewDraft 用**同一套**判定，且未配置 ADMIN_OPENIDS 时默认拒绝。 */
  if (!isAdmin(OPENID)) {
    return adminDenied();
  }

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
