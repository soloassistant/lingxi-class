const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ★ R16 连带修（2026-09-29）：这里原来是 `.set()` —— 整篇覆盖 learners 文档。
   而 saveLevel 把定级也写在同一个文档里，于是**设一次考试目标就会把等级抹掉**，
   路线图里紧接着显示"当前等级=未定级"。等级和考试目标是两件事，不该互相清除。
   现在改成"已存在则 update（保留其他字段），不存在才 set 建新档"。 */
async function upsertLearner(openid, patch) {
  const res = await db.collection('learners').doc(openid).update({ data: patch })
    .catch(() => null);
  if (res && res.stats && res.stats.updated > 0) return 'updated';
  // updated 为 0 可能是"文档不存在"，也可能是"值完全相同"，查一次再决定，
  // 不能直接 set（那会把 levels / lastLevel 覆盖掉）。
  const exist = await db.collection('learners').doc(openid).get().catch(() => null);
  if (exist && exist.data) return 'unchanged';
  await db.collection('learners').doc(openid).set({ data: patch }).catch(() => {});
  return 'created';
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const { systemId: system, examDate, subject, targetScore, dailyMinutes } = event || {};
  if (!system) return { code: 1, msg: '体系不能为空' };

  // examDate 非法会让 new Date() 得到 Invalid Date 并落库，之后所有日期计算都变 NaN
  let exam = null;
  if (examDate) {
    const d = new Date(examDate);
    if (!isNaN(d.getTime())) exam = d;
  }
  if (!exam) exam = new Date(Date.now() + 90 * 86400000);

  const patch = {
    openid: OPENID,
    system,
    subject: subject || '',
    examDate: exam,
    targetScore: targetScore || '',
    dailyMinutes: dailyMinutes || 30,
    updateTime: db.serverDate()
  };

  const how = await upsertLearner(OPENID, patch);
  return { code: 0, msg: '已保存', how };
};
