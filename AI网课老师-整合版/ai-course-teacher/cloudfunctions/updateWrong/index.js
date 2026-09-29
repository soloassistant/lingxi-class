const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const coll = db.collection('wrong_books');

/* ===== ★ R11（2026-09-29）：复习作答也留作答事实事件 =====
   只有**真正被计入**的作答才落事件，与服务端状态机保持一致：
     · duplicated（同一次作答重放）→ 不落，否则重试会把正确率刷高；
     · tooEarly（没到复习时间，本次不计入晋级）→ 不落，
       否则连点就能把"答对率"刷成 100%。
   也就是说：正确率统计的是**被接受为评分依据的作答**，
   这与产品的评分口径一致，而不是"点了几次按钮"。 */
const BJ_OFFSET_MS = 8 * 3600 * 1000;

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
    source: ev.source || 'review',
    attemptId: ev.attemptId || '',
    dayKey: bjDayKey(now),
    ts: now,
    createTime: db.serverDate()
  };
  try {
    await db.collection('answer_events').add({ data });
    return true;
  } catch (e) {
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

// 间隔重复阶梯：答对一次晋级，到 30 天视为已掌握（对标 Anki/扇贝 遗忘曲线）
const INTERVALS = [1, 3, 7, 15, 30];

function nextInterval(cur) {
  for (const iv of INTERVALS) {
    if ((cur || 0) < iv) return iv;
  }
  return 30;
}

/* 到期时间归一化。字段可能来自真实云数据库（Date）或早期写入的时间戳/字符串。 */
function dueAt(doc) {
  const v = doc && doc.nextReviewTime;
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { itemId, correct } = event;
  if (!itemId) return { code: 1, msg: '参数缺失' };

  // 统一用 where 查询（与 saveWrong 一致），不再依赖拼接 doc id
  const existRes = await coll.where({ openid: OPENID, itemId }).limit(1).get().catch(() => ({ data: [] }));
  const doc = existRes.data[0] || null;

  /* ★ 2026-09-29 修（外部审查 R09，P1）：
     原来收到 `correct: true` 就**无条件**晋级：不看到期时间、不看作答次数、没有幂等键。
     后端其实已经把到期标记算出来了（`nextReviewTime`），但只用于前端显示"待复习"标签，
     既不过滤列表也不拦提交 —— 于是对同一题连点 5 次，
     几秒内就能把间隔推到 30 天、把题目标成"已掌握"。
     这不是记忆保持的证据，只是点击次数的证据。
     改法：① 没到期不允许晋级；② 用一次性作答令牌做幂等（重试/并发都不会多升一级）。 */
  const attemptId = String((event && event.attemptId) || '');
  const duplicated = !!(attemptId && doc && doc.lastAttemptId === attemptId);
  if (duplicated) {
    return { code: 0, resolved: !!doc.resolved, interval: doc.interval || 0, duplicated: true, msg: '这次作答已计入过，不重复计算' };
  }

  if (correct) {
    if (doc) {
      const due = dueAt(doc);
      if (due != null && due > Date.now()) {
        // 未到期：明确说清"没到复习时间"，而不是静默计入（静默会让前端以为晋级了）
        return {
          code: 0, resolved: false, interval: doc.interval || 0, tooEarly: true,
          nextReviewTime: new Date(due), msg: '还没到复习时间，本次不计入晋级'
        };
      }
      const interval = nextInterval(doc.interval || 0);
      if (interval >= 30) {
        // 间隔达到 30 天，标记已掌握，不再出现在错题本
        await coll.doc(doc._id).update({
          data: {
            rightCount: (doc.rightCount || 0) + 1,
            reviewCount: (doc.reviewCount || 0) + 1,
            interval,
            status: 'resolved',
            resolved: true,
            lastAttemptId: attemptId || doc.lastAttemptId || '',
            lastReviewTime: db.serverDate()
          }
        });
        await recordAnswerEvent({
          openid: OPENID, itemId, courseId: doc.courseId || '', correct: true,
          source: 'review', attemptId
        });
        return { code: 0, resolved: true, interval };
      }
      const nextMs = Date.now() + interval * 86400000;
      await coll.doc(doc._id).update({
        data: {
          rightCount: (doc.rightCount || 0) + 1,
          reviewCount: (doc.reviewCount || 0) + 1,
          interval,
          status: 'reviewing',
          lastAttemptId: attemptId || doc.lastAttemptId || '',
          lastReviewTime: db.serverDate(),
          nextReviewTime: new Date(nextMs)
        }
      });
      await recordAnswerEvent({
        openid: OPENID, itemId, courseId: doc.courseId || '', correct: true,
        source: 'review', attemptId
      });
      return { code: 0, resolved: false, interval };
    }
    return { code: 0, resolved: false };
  }

  // 答错：间隔归零，立即到期
  if (doc) {
    await coll.doc(doc._id).update({
      data: {
        wrongCount: (doc.wrongCount || 0) + 1,
        rightCount: 0,
        interval: 0,
        status: 'reviewing',
        resolved: false,
        lastAttemptId: attemptId || doc.lastAttemptId || '',
        lastReviewTime: db.serverDate(),
        nextReviewTime: db.serverDate()
      }
    });
  } else {
    await coll.add({
      data: {
        openid: OPENID,
        itemId,
        courseId: event.courseId || '',
        courseName: event.courseName || '',
        question: event.question || '',
        options: event.options || [],
        answerIndex: event.answerIndex !== undefined ? event.answerIndex : 0,
        userAnswer: event.userAnswer !== undefined ? event.userAnswer : -1,
        explanation: event.explanation || '',
        wrongType: event.wrongType || '',
        wrongCount: 1,
        rightCount: 0,
        reviewCount: 0,
        interval: 0,
        status: 'reviewing',
        resolved: false,
        lastAttemptId: attemptId,
        createTime: db.serverDate(),
        lastReviewTime: db.serverDate(),
        nextReviewTime: db.serverDate()
      }
    });
  }
  await recordAnswerEvent({
    openid: OPENID, itemId, courseId: (doc && doc.courseId) || event.courseId || '',
    correct: false, source: 'review', attemptId
  });
  return { code: 0, resolved: false };
};
