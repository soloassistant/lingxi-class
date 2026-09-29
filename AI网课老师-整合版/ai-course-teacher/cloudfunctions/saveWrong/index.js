const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const coll = db.collection('wrong_books');

/* ===== ★ R11（2026-09-29）：本次答错也要留一条作答事实事件 =====
   wrong_books 只保留"这道题错了几次"的**当前状态**：再次答错会重置 rightCount、
   答对毕业会把 status 改成 resolved 从而被正确率分母排除。
   所以它不是历史，不能用来反推正确率。每次作答一条的 answer_events 才是。
   dayKey 在服务端按北京时间算好（云函数跑在 UTC），保证与仪表盘/周报口径一致。 */
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
    source: ev.source || '',
    attemptId: ev.attemptId || '',
    dayKey: bjDayKey(now),
    ts: now,
    createTime: db.serverDate()
  };
  try {
    // 带 attemptId 时幂等：同一次提交重放不能把"答错"重复计入（正确率会被拉低）
    if (data.attemptId) {
      const dup = await db.collection('answer_events')
        .where({ openid: data.openid, itemId: data.itemId, attemptId: data.attemptId })
        .limit(1).get().catch(() => ({ data: [] }));
      if (dup.data && dup.data.length > 0) return true;
    }
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const itemId = event.knowledgeId || event.itemId;
  if (!itemId) return { code: 1, msg: '参数错误' };

  const courseId = event.courseId || guessCourseId(itemId);
  const base = {
    courseId,
    courseName: event.courseName || guessCourseName(courseId),
    question: event.question || '',
    options: event.options || [],
    answerIndex: event.answerIndex !== undefined ? event.answerIndex : -1,
    userAnswer: event.userAnswer !== undefined ? event.userAnswer : -1,
    explanation: event.explanation || '请查看原题解析',
    wrongType: event.wrongType || '',
    resolved: false,
    status: 'reviewing'
  };

  try {
    const existRes = await coll.where({ openid: OPENID, itemId }).limit(1).get();
    if (existRes.data.length > 0) {
      const old = existRes.data[0];
      await coll.doc(old._id).update({
        data: {
          ...base,
          wrongCount: (old.wrongCount || 0) + 1,
          rightCount: 0,
          wrongType: event.wrongType || old.wrongType || '',
          interval: 0,
          nextReviewTime: db.serverDate(),
          updateTime: db.serverDate(),
          lastReviewTime: db.serverDate()
        }
      });
    } else {
      await coll.add({
        data: {
          openid: OPENID,
          itemId,
          wrongCount: 1,
          rightCount: 0,
          reviewCount: 0,
          interval: 0,
          ...base,
          createTime: db.serverDate(),
          updateTime: db.serverDate(),
          lastReviewTime: db.serverDate(),
          nextReviewTime: db.serverDate()
        }
      });
    }

    // 事实事件：这次判定为"错"。attemptId 缺省为空串（quiz 页一次提交不重放，
    // 幂等由调用方决定；带了就如实存下来，便于日后核对重复计数）。
    const recorded = await recordAnswerEvent({
      openid: OPENID, itemId, courseId, correct: false,
      source: event.source || 'quiz', attemptId: event.attemptId || ''
    });
    return { code: 0, recorded };
  } catch (e) {
    return { code: 500, msg: e.message };
  }
};

// 长前缀优先，避免 ib_math 抢先命中 ib_math_aa/ib_ai
function guessCourseId(itemId) {
  const known = [
    'ielts_listening','ielts_speaking','ielts_reading','ielts_writing',
    'toefl_b1','toefl_b2','toefl_adv',
    'sat_math','sat_write',
    'igcse_math','igcse_addmath','igcse_phy',
    'alevel_math','alevel_pure3','alevel_p3','alevel_mech','alevel_phy',
    'ap_calc','ap_stats',
    'ib_math_aa','ib_math_ai','ib_math','ib_phy','ib_aa','ib_ai'
  ];
  const hit = known.find(c => itemId.startsWith(c + '_') || itemId === c);
  if (hit) return hit;
  return itemId.split('_').slice(0, 2).join('_') || itemId;
}

function guessCourseName(courseId) {
  const map = {
    ielts_listening:'雅思听力', ielts_speaking:'雅思口语',
    ielts_reading:'雅思阅读', ielts_writing:'雅思写作',
    toefl_b1:'托福基础', toefl_b2:'托福B2', toefl_adv:'托福高阶',
    sat_math:'SAT数学', sat_write:'SAT文法',
    igcse_math:'IGCSE数学', igcse_addmath:'IGCSE进阶数学', igcse_phy:'IGCSE物理',
    alevel_math:'A-Level数学', alevel_pure3:'A-Level纯数3', alevel_p3:'A-Level纯数3', alevel_mech:'A-Level力学', alevel_phy:'A-Level物理',
    ap_calc:'AP微积分', ap_stats:'AP统计',
    ib_math:'IB数学', ib_math_aa:'IB数学AA', ib_math_ai:'IB数学AI', ib_phy:'IB物理',
    ib_aa:'IB数学AA', ib_ai:'IB数学AI'
  };
  return map[courseId] || courseId;
}
