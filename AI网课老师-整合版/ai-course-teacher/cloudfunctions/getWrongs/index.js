const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const res = await db.collection('wrong_books')
    .where({ openid: OPENID, status: 'reviewing' })
    .orderBy('lastReviewTime', 'desc')
    .limit(100)
    .get();

  const map = {};
  const groups = [];
  const now = Date.now();
  res.data.forEach(item => {
    // 间隔重复：标记是否到期待复习
    item.due = !item.nextReviewTime || new Date(item.nextReviewTime).getTime() <= now;
    if (!map[item.courseId]) {
      map[item.courseId] = { courseId: item.courseId, courseName: item.courseId, count: 0, items: [] };
      groups.push(map[item.courseId]);
    }
    map[item.courseId].count++;
    map[item.courseId].items.push(item);
  });

  return { code: 0, list: res.data, groups };
};
