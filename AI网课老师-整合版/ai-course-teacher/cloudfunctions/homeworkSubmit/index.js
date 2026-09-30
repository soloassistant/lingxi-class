const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* ===== ★ R17（2026-09-29）：作业提交必须留下"讲评能用的证据" =====
   改之前这一条链路有三个问题，而且是连着的：

   ① 落库结构缺料。原来只存 { itemId, courseId, userAnswer, answerIndex } ——
      没有题干、没有选项、没有解析。于是 homeworkReview 拿不到任何题目内容，
      却被要求"指出错误的主要原因"，模型只能编。
   ② 答案键来自客户端。answerIndex 是学生手机上传上来的字段，服务端从未核对。
   ③ 对错结论也来自客户端。correct = userAnswer === answerIndex，两个值都取自提交记录，
      所以不只是"答案不可信"，而是**讲评的事实前提与结论都不可信**。

   现在：
   ① 把学生**实际看到的那份题面**（题干/选项/答案/解析）连同版本号一起快照落库；
   ② 按 question_bank 核对：银行里的题面版本与快照一致 → 答案键以银行为准
      （questionSource='bank'）；不一致或银行没有 → 只能用快照，并明确标记 'client'，
      让讲评环节知道自己脚下是什么地基；
   ③ 答案键不可用（越界 / -1）或学生**未作答**时，correct 返回 **null**。
      原来的 `userAnswer === answerIndex` 会把"未作答"判成"错"，
      把"不知道"说成"做错了"。

   ⚠ 部署前置：question_bank 集合需先用 tools/sync-question-bank.js 生成并导入。
     未导入时一切仍能跑，只是答案键标记为 client（讲评会据此降低结论强度），
     不会假装自己核对过。 */

/* 题目版本号：与 tools/sync-question-bank.js **必须逐字节一致**。
   各云函数独立打包，不能跨目录 require，所以只能各留一份；
   _test/test-homework-review.js 会逐题比对两边结果，防止手抄走样。 */
function questionVersion(quiz) {
  const q = (quiz && quiz.question) || '';
  const opts = (quiz && Array.isArray(quiz.options)) ? quiz.options : [];
  const ai = (quiz && quiz.answerIndex !== undefined) ? quiz.answerIndex : -1;
  const canonical = String(q) + '|' + opts.map(o => String(o)).join('\u0001') + '|' + String(ai);
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

function isIndex(v, len) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < len;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const itemId = event.itemId || '';
  if (!itemId) return { code: 1, msg: '参数缺失' };

  /* ---------- 1) 学生实际看到的题面快照 ---------- */
  const snapshot = {
    question: event.question || '',
    options: Array.isArray(event.options) ? event.options : [],
    answerIndex: typeof event.answerIndex === 'number' ? event.answerIndex : -1,
    explanation: event.explanation || ''
  };
  const snapshotVersion = questionVersion(snapshot);
  const userAnswer = (event.userAnswer === undefined || event.userAnswer === null) ? -1 : event.userAnswer;
  const answered = isIndex(userAnswer, snapshot.options.length);

  /* ---------- 2) 与可信题库核对（按版本，而不是盲信任何一方） ---------- */
  let bank = null;
  const bankRes = await db.collection('question_bank').doc(itemId).get().catch(() => null);
  if (bankRes && bankRes.data) bank = bankRes.data;

  const bankVersion = bank ? (bank.version || questionVersion(bank)) : '';
  const bankUsable = !!(bank && isIndex(bank.answerIndex, (bank.options || []).length));

  /* 用哪一份题面和答案键：
     · 银行有这一题、且版本与快照一致 → 学生看到的就是银行那版，用银行的（可信）
     · 版本不一致 → 学生看到的是另一版（客户端缓存旧题，或题库改过）。
       此时只有快照与学生的实际作答对应得上，用快照，但**必须标记为未核实** ——
       不能拿另一版的答案去判这一版的作答。 */
  const useBank = bankUsable && bankVersion === snapshotVersion;
  const question = useBank ? {
    question: bank.question || '',
    options: bank.options || [],
    answerIndex: bank.answerIndex,
    explanation: bank.explanation || ''
  } : snapshot;
  const questionSource = useBank ? 'bank' : 'client';
  const versionMismatch = !!(bankUsable && bankVersion !== snapshotVersion);

  /* ---------- 3) 对错结论：能判才判，判不了就是 null ---------- */
  const hasKey = isIndex(question.answerIndex, question.options.length);
  let correct = null;
  if (answered && hasKey) correct = userAnswer === question.answerIndex;

  /* 讲评能做到哪一步 —— 直接决定 homeworkReview 的提示词强度：
     unjudgeable：没作答或判不了对错 → 只能说明情况，不许编错因
     option_only：有对错结论，但答案键未经核实、没有学生解题过程、
                  **或者学生其实答对了** → 只能说"选项不符/作答正确，正确选项是 X"，
                  不许声称识别了概念混淆/计算失误
     cause      ：答案键经题库核实 + 有学生解题过程 + **确实答错** → 才允许讨论错因

     ★ 为什么答对也要压在 option_only：答对的学生身上**不存在错因**。若此时放开 cause，
       模型面对"答对了"这件事仍被要求分析原因，最省力的输出就是"你虽然选对了，
       但概念其实不清" —— 这是凭空给学生扣一个帽子，比不写更糟。
       没有错可诊，就不要给人诊断。 */
  let diagnosisLevel = 'unjudgeable';
  if (correct !== null) {
    const trustedKey = questionSource === 'bank';
    const hasWork = !!(event.studentWork && String(event.studentWork).trim());
    diagnosisLevel = (correct === false && trustedKey && hasWork) ? 'cause' : 'option_only';
  }

  const res = await db.collection('homework').add({
    data: {
      openid: OPENID,
      itemId,
      courseId: event.courseId || '',
      courseName: event.courseName || '',
      // 题面快照（学生实际看到的那份）
      question: question.question,
      options: question.options,
      answerIndex: question.answerIndex,
      explanation: question.explanation,
      questionVersion: questionVersion(question),
      // 依据链：对错 / 题面各自是核实过的还是客户端自述的
      correct,
      answered,
      questionSource,
      versionMismatch,
      bankVersion,
      userAnswer,
      studentWork: event.studentWork || '',
      diagnosisLevel,
      status: event.status || 'submitted',
      createTime: db.serverDate(),
      submittedAt: db.serverDate()
    }
  }).catch(() => null);

  return {
    code: 0,
    submissionId: res ? res._id : null,
    answered,
    correct,
    questionSource,
    versionMismatch,
    diagnosisLevel,
    canDiagnoseCause: diagnosisLevel === 'cause'
  };
};
