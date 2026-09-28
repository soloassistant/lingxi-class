const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  // 优先按传入 itemId 取提交记录；未传则取最新一条
  const where = { openid: OPENID };
  if (event.itemId) where.itemId = event.itemId;
  const submission = await db.collection('homework')
    .where(where)
    .orderBy('createTime', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));

  if (submission.data.length === 0) return { code: 1, msg: '暂无作业记录' };

  const sub = submission.data[0];
  const itemId = sub.itemId;
  const userAnswer = sub.userAnswer !== undefined ? sub.userAnswer : -1;
  const answerIndex = sub.answerIndex !== undefined ? sub.answerIndex : -1;
  const correct = userAnswer === answerIndex;

  // 触发 AI 讲评（区分对错）
  const prompt = '你是作业讲评老师。请基于以下信息给出讲评，严格返回 JSON，只含两个字段：' +
    '{ "feedback": "...", "suggestion": "..." }。' +
    '知识点ID：' + itemId + '；学生所选选项序号：' + userAnswer +
    '；正确选项序号：' + answerIndex +
    '；作答结果：' + (correct ? '正确' : '错误') + '。' +
    'feedback 要求：100 字以内，' +
    (correct ? '肯定学生做得好的地方，并点出可进一步提升的点；' : '指出错误的主要原因，不直接给答案；') +
    'suggestion 要求：给出 1 条具体的复习建议。';

  const ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt } }).catch(() => null);

  let feedback = correct
    ? '作答正确，说明你已掌握本知识点的核心要点，可以继续挑战同类变式题。'
    : '本题作答有误，建议回顾知识点的关键概念后再做一次同类题。';
  let suggestion = correct
    ? '建议再做 1 道同知识点的变式题巩固。'
    : '建议重新学习该知识点并重做一次。';

  if (ai && ai.result && ai.result.code === 0 && ai.result.data) {
    const d = ai.result.data;
    if (d && d.feedback) feedback = d.feedback;
    if (d && d.suggestion) suggestion = d.suggestion;
  }

  // 写入讲评记录（可选，用于后续复盘）
  await db.collection('homework_reviews').add({
    data: {
      openid: OPENID,
      itemId,
      correct,
      feedback,
      suggestion,
      reviewTime: db.serverDate()
    }
  }).catch(() => {});

  return {
    code: 0,
    review: { itemId, correct, feedback, suggestion }
  };
};
