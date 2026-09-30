const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 用户级数据集合全集（注销时须全部清除）
// 注意：ai_usage_global 是全站聚合计数（无 openid），不属于用户数据，不清除。
const USER_COLLECTIONS = [
  'progress',            // 学习进度
  'wrong_books',         // 错题本
  'answer_events',       // ★ R11：作答事实事件（每次作答一条）—— 必须随账号删除
  'checkins',            // 打卡记录（仓内无写入路径，保留以清除历史遗留数据）
  'analytics',           // ★ R04/R11：行为埋点（含 event/props/openid）—— 原列表漏了它，
                         //   结果"真正在写的集合"反而不随账号删除
  'homework',            // 作业提交
  'homework_reviews',    // AI 作业讲评
  'learners',            // 学习者画像（体系/目标/定级）
  'subscriptions',       // 周报订阅授权额度
  'weekly_reports',      // 学情周报
  'learner_prefs',       // 用户偏好
  'ai_quota',            // 单用户 AI 日用量
  'ai_rate',             // ★ R12：分钟级频控桶（含 openid）—— 新增时必须同步到这里
  'ai_calls',            // AI 调用明细
  'teach_interrupt_logs',// 打断提问日志
  'courses_draft',       // AI 生成草稿
  'reports',             // 举报记录
  'posts'                // 社区发帖
];

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const removed = {};
  // 逐个集合删除，单集合失败不中断（尽量删干净，失败的集合记录在 removed 里）
  for (const name of USER_COLLECTIONS) {
    try {
      const res = await db.collection(name).where({ openid: OPENID }).remove();
      removed[name] = res && res.stats ? res.stats.removed : 0;
    } catch (e) {
      // 集合不存在 / 权限不足时记为 -1，不阻断其他集合
      removed[name] = -1;
    }
  }

  return { code: 0, msg: '账号已注销', removed };
};
