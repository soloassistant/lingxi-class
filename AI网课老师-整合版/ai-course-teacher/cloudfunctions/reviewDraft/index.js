const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ============================================================
   审核权限判定（外部审查 R10）
   ------------------------------------------------------------
   原状：`if (ADMIN_OPENIDS.length > 0 && !includes(OPENID))` ——
        白名单**没配置**时这条判断整体为假，于是任意登录用户都能审批并发布内容。
        判定与配置分离才是根源：配置不在仓库里，就既审计不了也测不了，
        而且每次部署都可能再发生一次。
   改法：**default-deny**。没配置就等于没启用审核功能，一律拒绝，
        并把"缺配置"这件事明确说出来（否则运维只会以为是自己权限不够）。

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 401, msg: '未登录' };

  if (!isAdmin(OPENID)) return adminDenied();

  const { draftId, action } = event; // action: 'approve' | 'reject'
  if (!draftId || !action) return { code: 1, msg: '参数缺失' };
  if (action !== 'approve' && action !== 'reject') return { code: 1, msg: 'action 不合法' };

  const nextStatus = action === 'approve' ? 'approved' : 'rejected';

  /* ★ 2026-09-29 修（外部审查 R10 的复核补充）：
     原来这里是"先 doc.get 判断 status，再 update" —— 典型的 check-then-write。
     两个并发审批都会通过检查，各自往 courses 里 add 一份正式课程，
     结果是同一个草稿发布两次（不是"没幂等"，而是**状态迁移不是原子的**）。
     改用**条件更新**抢占用：只有仍是 draft 的那一行会被改到终态，
     用 `updated` 计数判断自己是不是抢到的那个请求。 */
  let claim;
  try {
    claim = await db.collection('courses_draft')
      .where({ _id: draftId, status: 'draft' })
      .update({ data: { status: nextStatus, reviewBy: OPENID, reviewTime: db.serverDate() } });
  } catch (e) {
    return { code: 500, msg: '更新草稿状态失败，请稍后重试' };
  }
  const updated = (claim && claim.stats && claim.stats.updated) || 0;
  if (updated !== 1) {
    // 没抢到：要么不存在、要么已被处理、要么另一个请求刚抢走
    const cur = await db.collection('courses_draft').doc(draftId).get().catch(() => null);
    if (!cur || !cur.data) return { code: 2, msg: '草稿不存在' };
    return { code: 3, msg: '该草稿已处理过（并发审批只会成功一次）', status: cur.data.status };
  }

  /* 抢占成功后才有资格发布。发布失败要把状态**回滚成 draft**，
     否则草稿会卡在"已通过但没上线"这个既不是待审也不是可用的状态里。 */
  if (action === 'approve') {
    const doc = await db.collection('courses_draft').doc(draftId).get().catch(() => null);
    const draft = (doc && doc.data) || {};
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

    let pubOk = false;
    try {
      await db.collection('courses').add({ data: published });
      pubOk = true;
    } catch (e) {
      // 集合不存在时创建后重试一次
      await db.createCollection('courses').catch(() => {});
      try { await db.collection('courses').add({ data: published }); pubOk = true; } catch (e2) { pubOk = false; }
    }
    if (!pubOk) {
      await db.collection('courses_draft').doc(draftId)
        .update({ data: { status: 'draft', reviewBy: '', reviewTime: null } })
        .catch(() => {});
      return { code: 500, msg: '发布失败，草稿已退回待审状态，请稍后重试' };
    }
  }

  return { code: 0, msg: action === 'approve' ? '已通过并发布' : '已驳回' };
};
