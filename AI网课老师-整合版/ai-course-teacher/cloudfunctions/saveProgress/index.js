const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const coll = db.collection('progress');

/* ===== ★ R11（2026-09-29）：把"判定过的作答"留成不可变事实事件 =====
   起因：仪表盘的"答题正确率"是拿 wrong_books 里 status='reviewing' 的记录
   用 rightCount/(rightCount+wrongCount) 算出来的。这份样本有三重偏差：
     · 首次答对不进 wrong_books（只走 progress）→ 分子天然缺一块；
     · 间隔重复"毕业"（status='resolved'）的题被排除 → 分子又缺一块；
     · saveWrong/updateWrong 会把 rightCount 归零、覆盖 updateTime → 历史被改写。
   从"当前状态"反推历史正确率，结论必然失真。

   所以事实必须按"每次作答一条"留下来。这张表只追加、不修改：
     openid / itemId / courseId / correct / graded / source / attemptId / dayKey / ts
   graded 的含义：这次对错是**服务端判定**的（true），还是学生自评（false）。
   自评（course 页"我已掌握"）是学习信号，但不是客观证据 —— 不能混进正确率。
   attemptId 让重试/并发不会重复计数（与 updateWrong 的幂等令牌同源）。

   写事件失败**不能**影响主流程（作答本身已经成功了），但要把结果如实回传，
   不能让上游以为"记上了"。 */
const BJ_OFFSET_MS = 8 * 3600 * 1000;

// 云函数跑在 UTC。"今天"必须按**北京时间**算，否则早上 8 点前的学习会记到前一天，
// 仪表盘、日历、周报三处口径也会互相打架。
function bjDayKey(ms) {
  const bj = new Date(ms + BJ_OFFSET_MS);
  return bj.getUTCFullYear() + '-' +
    String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(bj.getUTCDate()).padStart(2, '0');
}

async function recordAnswerEvent(ev) {
  const now = Date.now();
  const data = {
    openid: ev.openid,
    itemId: ev.itemId || '',
    courseId: ev.courseId || '',
    correct: !!ev.correct,
    graded: ev.graded !== false,
    source: ev.source || '',
    attemptId: ev.attemptId || '',
    dayKey: bjDayKey(now),
    ts: now,
    createTime: db.serverDate()
  };
  try {
    // 带 attemptId 时幂等：同一次提交被重放（重试/弱网重发）不能重复计入正确率。
    // 没带就按"每一次调用就是一次作答"追加 —— 由调用方决定是否给令牌。
    if (data.attemptId) {
      const dup = await db.collection('answer_events')
        .where({ openid: data.openid, itemId: data.itemId, attemptId: data.attemptId })
        .limit(1).get().catch(() => ({ data: [] }));
      if (dup.data && dup.data.length > 0) return true;
    }
    await db.collection('answer_events').add({ data });
    return true;
  } catch (e) {
    // 集合不存在时创建后重试一次（与 trackEvent 的处理一致）
    await db.createCollection('answer_events').catch(() => {});
    try {
      await db.collection('answer_events').add({ data });
      return true;
    } catch (e2) {
      console.error('[answer_events] 写入失败，本次作答未计入统计:', e2 && e2.message);
      return false;
    }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const itemId = event.itemId || '';
  if (!itemId) return { code: 1, msg: '参数错误' };

  const courseId = event.courseId || '';
  // 自评（course 页"我已掌握"）与随堂判对分开记：前者 graded=false
  const graded = event.graded !== false;
  const source = event.source || 'learn';

  try {
    // 幂等 upsert：where { openid, itemId, courseId }
    const existRes = await coll
      .where({ openid: OPENID, itemId, courseId })
      .limit(1)
      .get();

    if (existRes.data.length > 0) {
      await coll.doc(existRes.data[0]._id).update({
        data: {
          learned: true,
          updateTime: db.serverDate()
        }
      });
    } else {
      await coll.add({
        data: {
          openid: OPENID,
          itemId,
          courseId,
          learned: true,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
    }

    const recorded = await recordAnswerEvent({
      openid: OPENID, itemId, courseId, correct: true, graded, source,
      attemptId: event.attemptId || ''
    });
    return { code: 0, recorded };
  } catch (e) {
    return { code: 500, msg: e.message };
  }
};
