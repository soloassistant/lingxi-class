const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ===== ★ R17（2026-09-29）：讲评不能再"看不见题"却断言错因 =====
   改之前：提示词只有「知识点ID + 学生所选序号 + 正确序号」，就要求
   "指出错误的主要原因"，还要给具体复习建议。模型看不到题干、选项、解析，
   也看不到学生的解题过程 —— 它只能编一个听起来合理的错因。

   现在按三条纪律重写：
   ① 提示词里放**真实题面**：题干、所有选项、学生所选、标准答案、解析，
      并且给的是选项**文字**而不是序号（序号对模型没有语义）。
   ② 证据不足就降级结论强度，而不是自由发挥。由 homeworkSubmit 算好的
      diagnosisLevel 决定提示词：
        cause      → 允许讨论错因（前提：答案键经题库核实 + 有学生解题过程 + **确实答错**）
        option_only→ 只能说"选项不符 / 作答正确 + 正确选项是什么"，明令禁止断言
                     "概念混淆/计算失误"这类看不见的结论
        unjudgeable→ 未作答或无法判定；要求直说，且**不调用 AI 编讲评**
   ③ 兜底文案同样分级：没有 AI 时也不许说"你概念不清"。

   对错结论 correct 可能为 null（未作答 / 答案键不可用）。**绝不把 null 说成错**。 */

function optionText(options, idx) {
  const opts = Array.isArray(options) ? options : [];
  if (!(idx >= 0 && idx < opts.length)) return '（未知）';
  return '第' + (idx + 1) + '项：' + String(opts[idx]);
}

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
  const options = Array.isArray(sub.options) ? sub.options : [];
  const hasKey = typeof sub.answerIndex === 'number' && sub.answerIndex >= 0 && sub.answerIndex < options.length;
  // 老数据没有 answered/correct 字段：按"当时有没有作答位"推；答案键不可用就不下结论
  const answered = sub.answered !== undefined
    ? !!sub.answered
    : (typeof sub.userAnswer === 'number' && sub.userAnswer >= 0 && sub.userAnswer < options.length);
  const correct = (sub.correct !== undefined) ? sub.correct : (answered && hasKey ? sub.userAnswer === sub.answerIndex : null);

  // 老记录没有 diagnosisLevel：按同样的规则补算，避免历史数据绕过新纪律
  // （答对时同样不给 cause —— 没有错可诊，就不要给人诊断）
  let diagnosisLevel = sub.diagnosisLevel || '';
  if (!diagnosisLevel) {
    if (correct === null) diagnosisLevel = 'unjudgeable';
    else diagnosisLevel = (correct === false && sub.questionSource === 'bank' && sub.studentWork) ? 'cause' : 'option_only';
  }

  const questionText = sub.question || '';
  const hasQuestionText = !!questionText;

  /* ---------- 未作答 / 判不了：不叫 AI 编，直接如实说明 ---------- */
  if (diagnosisLevel === 'unjudgeable') {
    const feedback = (!answered
      ? '这道题你还没有作答，所以无法判断对错，也就谈不上分析错因。'
      : '这道题的答案键不可用（题目数据缺失或版本不一致），无法判断对错。') +
      (hasQuestionText ? ' 题目是：' + questionText : '');
    const suggestion = !answered
      ? '先把这道题做一遍吧，做完再来看讲评。'
      : '请重新打开这道题确认题面，或把这个知识点再过一遍。';
    const review = {
      itemId,
      courseId: sub.courseId || '',
      courseName: sub.courseName || '',
      correct: null,
      answered,
      diagnosisLevel,
      questionSource: sub.questionSource || 'unknown',
      question: questionText,
      options,
      userAnswer: sub.userAnswer,
      answerIndex: hasKey ? sub.answerIndex : null,
      explanation: sub.explanation || '',
      feedback,
      suggestion
    };
    await db.collection('homework_reviews').add({
      data: Object.assign({ openid: OPENID, canDiagnoseCause: false, reviewTime: db.serverDate() }, review)
    }).catch(() => {});
    return { code: 0, review };
  }

  /* ---------- 组织证据：只放我们真的有的东西 ---------- */
  const evidence = [];
  if (hasQuestionText) evidence.push('题目：' + questionText);
  if (options.length) evidence.push('选项：' + options.map((o, i) => (i + 1) + '. ' + o).join('  '));
  evidence.push('学生所选：' + (answered ? optionText(options, sub.userAnswer) : '未作答'));
  if (hasKey) evidence.push('标准答案：' + optionText(options, sub.answerIndex));
  if (sub.explanation) evidence.push('标准解析：' + sub.explanation);
  if (sub.studentWork) evidence.push('学生的解题过程：' + sub.studentWork);

  const constraint = diagnosisLevel === 'cause'
    ? '本次可以讨论错误原因，但必须**基于上面的题目和学生解题过程**，不得引入未出现在证据里的细节。'
    : '本次证据不足，**只能说明"所选与标准答案不符"以及正确选项是什么**；' +
      '严禁断言学生是"概念混淆""计算失误""粗心"等任何看不到的结论，也不得臆测学生的思路。';

  const prompt = '你是作业讲评老师。请基于下面的**真实证据**给出讲评，严格返回 JSON，只含两个字段：' +
    '{ "feedback": "...", "suggestion": "..." }。\n' +
    '—— 证据 ——\n' + evidence.join('\n') + '\n' +
    '—— 纪律 ——\n' + constraint + '\n' +
    '不知道的地方就说不知道，不要补全。feedback 100 字以内；suggestion 给 1 条具体可执行的复习建议。' +
    (diagnosisLevel === 'cause' ? '不要直接给出完整答案。' : '');

  const ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt } }).catch(() => null);

  /* ---------- 兜底文案也分级：没有 AI 也不许编错因 ---------- */
  let feedback;
  let suggestion;
  if (correct === true) {
    feedback = '本题作答正确。' + (hasKey ? '正确选项是' + optionText(options, sub.answerIndex) + '。' : '');
    suggestion = '建议再做 1 道同知识点的变式题巩固。';
  } else if (diagnosisLevel === 'option_only') {
    feedback = '本题所选与标准答案不符。' + (hasKey ? '正确选项是' + optionText(options, sub.answerIndex) + '。' : '') +
      '本次只知道选项结果，不足以判断具体原因。';
    suggestion = sub.explanation ? '对照解析重做一次：' + sub.explanation : '建议重新学习该知识点并重做一次。';
  } else {
    feedback = '本题作答有误，建议回顾该知识点的关键概念后再做一次同类题。';
    suggestion = '建议重新学习该知识点并重做一次。';
  }

  if (ai && ai.result && ai.result.code === 0 && ai.result.data) {
    const d = ai.result.data;
    if (d && d.feedback) feedback = d.feedback;
    if (d && d.suggestion) suggestion = d.suggestion;
  }

  const review = {
    itemId,
    courseId: sub.courseId || '',
    courseName: sub.courseName || '',
    correct,
    answered,
    diagnosisLevel,
    questionSource: sub.questionSource || 'unknown',
    question: questionText,
    options,
    userAnswer: sub.userAnswer,
    answerIndex: hasKey ? sub.answerIndex : null,
    explanation: sub.explanation || '',
    feedback,
    suggestion
  };

  await db.collection('homework_reviews').add({
    data: Object.assign({
      openid: OPENID,
      canDiagnoseCause: diagnosisLevel === 'cause',
      reviewTime: db.serverDate()
    }, review)
  }).catch(() => {});

  return { code: 0, review };
};
