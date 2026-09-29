const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ★ R16（2026-09-29）：等级必须**按课程**存。
   原来的实现只写一个 learners.level，而诊断又是跨体系随机混题（见 quiz 页 R16 修复），
   于是"雅思考得好"会改掉数学课的授课难度 —— 这两件事是同一个 bug 的两端。
   现在：
   1) 按课程写进 learners.levels.<courseId>（点路径合并：不动其他字段，也不动其他课程的等级）；
   2) 另存 lastLevel* 表示"最近一次测评"，仅供展示 / 周报使用；
   3) **不再写**含糊的全局 level / levelName —— 只要它还在，读它的地方就会退回跨范围误用；
   4) 缺 courseId 直接拒绝，服务端也不再允许产生一个"没有范围"的等级。 */

const VALID_LEVELS = ['A+', 'S', 'S+'];

/* update 与 set 需要**两种不同形状**的 patch，这点很容易踩：
   - update 是"合并"：必须用点路径 `'levels.ielts'`，
     否则 `{ levels: {...} }` 会把整个 levels 映射**替换**掉，抹掉其他课程的等级。
   - set 是"整篇替换"：**不展开点路径**，`'levels.ielts'` 会变成一个字面键，
     读的时候 doc.levels 是 undefined。这里必须给嵌套对象。
   两种形状都拼好，由下面的 upsert 按情况取用。 */
function buildPatches(courseId, record, flat) {
  const update = Object.assign({}, flat);
  update['levels.' + courseId] = record;

  const create = Object.assign({}, flat);
  create.levels = {};
  create.levels[courseId] = record;

  return { update, create };
}

// 文档已存在 → update 保留其他字段；文档不存在 → set 建新档。
// 注意 update 的 stats.updated 在"值没变化"时也是 0，不能靠它判断文档是否存在，
// 否则会误判成"没有文档"而 set 覆盖掉整个 learners（正是要避免的事）。
async function upsertLearner(openid, patches) {
  const res = await db.collection('learners').doc(openid).update({ data: patches.update })
    .catch(() => null);
  if (res && res.stats && res.stats.updated > 0) return 'updated';
  // updated 为 0 有两种可能：文档不存在，或值完全相同。查一次再决定。
  const exist = await db.collection('learners').doc(openid).get().catch(() => null);
  if (exist && exist.data) return 'unchanged';
  await db.collection('learners').doc(openid).set({ data: patches.create }).catch(() => {});
  return 'created';
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const { level, levelName, accuracy, courseId, courseName } = event || {};

  if (!level || VALID_LEVELS.indexOf(level) < 0) {
    return { code: 1, msg: '等级取值不合法' };
  }
  // courseId 会作为字段路径片段使用，含点会写到别的层级上去
  if (!courseId || typeof courseId !== 'string' || courseId.indexOf('.') >= 0) {
    return { code: 1, msg: '缺少诊断范围，等级无法归档' };
  }
  const acc = (typeof accuracy === 'number' && isFinite(accuracy) && accuracy >= 0 && accuracy <= 100)
    ? Math.round(accuracy)
    : null;

  const flat = {
    openid: OPENID,
    lastLevel: level,
    lastLevelName: levelName || '',
    lastLevelCourseId: courseId,
    lastLevelCourseName: courseName || '',
    lastLevelTime: db.serverDate(),
    updateTime: db.serverDate()
  };
  const record = {
    level,
    levelName: levelName || '',
    accuracy: acc,
    updateTime: db.serverDate()
  };

  const how = await upsertLearner(OPENID, buildPatches(courseId, record, flat));
  return { code: 0, courseId, how };
};
