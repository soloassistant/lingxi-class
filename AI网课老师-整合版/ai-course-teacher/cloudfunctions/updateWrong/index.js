const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const coll = db.collection('wrong_books');

// 间隔重复阶梯：答对一次晋级，到 30 天视为已掌握（对标 Anki/扇贝 遗忘曲线）
const INTERVALS = [1, 3, 7, 15, 30];

function nextInterval(cur) {
  for (const iv of INTERVALS) {
    if ((cur || 0) < iv) return iv;
  }
  return 30;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { itemId, correct } = event;
  if (!itemId) return { code: 1, msg: '参数缺失' };

  // 统一用 where 查询（与 saveWrong 一致），不再依赖拼接 doc id
  const existRes = await coll.where({ openid: OPENID, itemId }).limit(1).get().catch(() => ({ data: [] }));
  const doc = existRes.data[0] || null;

  if (correct) {
    if (doc) {
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
            lastReviewTime: db.serverDate()
          }
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
          lastReviewTime: db.serverDate(),
          nextReviewTime: new Date(nextMs)
        }
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
        createTime: db.serverDate(),
        lastReviewTime: db.serverDate(),
        nextReviewTime: db.serverDate()
      }
    });
  }
  return { code: 0, resolved: false };
};
