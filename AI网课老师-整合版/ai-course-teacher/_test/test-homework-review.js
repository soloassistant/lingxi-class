/* R17 验证：作业讲评必须有"看得见的证据"，不许编错因
   ------------------------------------------------------------
   报告原文（含复核补充）：
     · homeworkReview 被要求"指出错误的主要原因"，但提示词里只有知识点 ID、
       学生所选序号、正确序号 —— 没有题干、没有选项、没有解析，模型只能编；
     · 其一，`correct` 这个**对错结论本身**也来自客户端（userAnswer === answerIndex，
       两个值都取自提交记录）；
     · 其二，唯一写入方 homeworkSubmit 落库时**根本没有存题干、选项与解析**，
       因此 homeworkReview 即使想带上题目也无数据可用。

   这组测试跑**真实云函数**（内存版 wx-server-sdk 桩），不 grep 源码。
   分五块：
     A. 版本号：tools 生成的银行版本 与 云函数算出的快照版本 **逐题一致**（防手抄走样）
     B. 答案键与对错：未作答不是"错"，版本不一致不拿别人的答案判这道题
     C. diagnosisLevel 分级：unjudgeable / option_only / cause 的边界
     D. homeworkReview 纪律：提示词带真实题面；证据不足时降级结论强度且不编
     E. 题库产物：tools/question-bank.json 的形状与 tools 侧 --check

   运行：node _test/test-homework-review.js
   ============================================================ */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { createDb } = require('./mock-wx-server-sdk');

const ROOT = path.join(__dirname, '..');
const CF_DIR = path.join(ROOT, 'cloudfunctions');
const BANK = require(path.join(ROOT, 'tools', 'question-bank.json'));

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (typeof cond !== 'boolean') {
    fail++; console.log('FAIL ' + label + '  ← 断言写法错误：条件必须是 boolean（收到 ' + typeof cond + '）');
    return;
  }
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

/* ---------------------------------------------------------------- 云函数装载 */
const origLoad = Module._load;
let currentCtx = { OPENID: 'o_student' };
const aiCalls = [];

function loadFn(name, db, callFunctionImpl) {
  const mockCloud = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    callFunction: callFunctionImpl || (async () => ({ result: { code: 0 } })),
    openapi: { subscribeMessage: { send: async () => ({ errCode: 0 }) } }
  };
  const fnPath = path.join(CF_DIR, name, 'index.js');
  delete require.cache[require.resolve(fnPath)];
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return mockCloud;
    return origLoad.call(this, request, parent, isMain);
  };
  const fn = require(fnPath);
  Module._load = origLoad;
  return fn;
}

/* 记录 prompt 的 aiProxy 桩：把每次提示词存进 aiCalls，返回可控结果 */
function aiStub(reply) {
  return async (opts) => {
    aiCalls.push((opts && opts.data && opts.data.prompt) || '');
    return { result: reply === undefined ? { code: 1 } : { code: 0, data: reply } };
  };
}

function bankRows() { return BANK.map(r => Object.assign({}, r)); }

const rowsOf = async (db, name) => (await db.collection(name).limit(1000).get()).data;
const lastOf = async (db, name) => {
  const rs = await rowsOf(db, name);
  return rs.length ? rs[rs.length - 1] : null;
};

/* ================================================================ 开始 */

(async () => {

  /* ============ A 组：两边版本号逐题一致（最关键的"防手抄"断言） ============ */
  sec('A. 版本号：tools 的银行版本 === 云函数算出的快照版本（逐题 176 条）');

  {
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);

    const notBank = [];
    const mismatch = [];
    const wrongCorrect = [];
    for (const r of BANK) {
      // 学生看到的就是银行那一版，并且答对了
      const res = await submit.main({
        itemId: r.itemId, courseId: r.courseId, courseName: r.courseName,
        question: r.question, options: r.options.slice(),
        answerIndex: r.answerIndex, explanation: r.explanation,
        userAnswer: r.answerIndex,
      });
      if (res.questionSource !== 'bank') notBank.push(r.itemId);
      if (res.versionMismatch) mismatch.push(r.itemId);
      if (res.correct !== true) wrongCorrect.push(r.itemId);
    }

    t('A1 176 题全部被识别为"银行版本一致"（任一条不一致说明两份 questionVersion 实现已走样）',
      notBank.length === 0, '不一致 ' + notBank.length + ' 条：' + notBank.slice(0, 3).join(','));
    t('A2 176 题全部 versionMismatch=false', mismatch.length === 0,
      mismatch.length + ' 条：' + mismatch.slice(0, 3).join(','));
    t('A3 176 题按银行答案键判定，答对即 correct=true', wrongCorrect.length === 0,
      wrongCorrect.length + ' 条：' + wrongCorrect.slice(0, 3).join(','));

    const rec = await lastOf(db, 'homework');
    t('A4 落库确实存了题面（题干/选项/答案/解析/版本）—— homeworkReview 才有料可用',
      !!(rec && rec.question && Array.isArray(rec.options) && rec.options.length &&
        typeof rec.answerIndex === 'number' && rec.explanation && rec.questionVersion),
      JSON.stringify(rec && Object.keys(rec)));
  }

  {
    // 反向：改动题干一个字 → 版本必须变，且必须降级为 client
    const r = BANK[0];
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const tampered = r.question + '（改）';
    const res = await submit.main({
      itemId: r.itemId, question: tampered, options: r.options.slice(),
      answerIndex: r.answerIndex, userAnswer: r.answerIndex,
    });
    t('A5 题干被改一个字 → versionMismatch=true 且 questionSource=client',
      res.versionMismatch === true && res.questionSource === 'client',
      JSON.stringify(res));
  }

  {
    // 反向：改动选项 → 版本必须变
    const r = BANK[1];
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const opts = r.options.slice();
    opts[0] = String(opts[0]) + '!';
    const res = await submit.main({ itemId: r.itemId, question: r.question, options: opts, answerIndex: r.answerIndex, userAnswer: 0 });
    t('A6 选项被改 → versionMismatch=true', res.versionMismatch === true, JSON.stringify(res));
  }

  {
    // 反向：改动 answerIndex → 版本必须变（答案键也是版本的一部分）
    const r = BANK[2];
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const fakeIdx = (r.answerIndex + 1) % r.options.length;
    const res = await submit.main({ itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: fakeIdx, userAnswer: fakeIdx });
    t('A7 客户端谎报 answerIndex → versionMismatch=true（不会拿银行的键去判这一版）',
      res.versionMismatch === true, JSON.stringify(res));
    const rec = await lastOf(db, 'homework');
    t('A8 版本不一致时用**快照**的答案键判对错（学生答的是快照那一版）→ correct=true',
      res.correct === true && rec.questionSource === 'client',
      JSON.stringify({ correct: res.correct, source: rec.questionSource }));
  }

  /* ============ B 组：未作答 ≠ 答错；没银行也不装核对过 ============ */
  sec('B. 答案键与对错：未作答不是"错"，无银行时如实降级');

  {
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const r = BANK[0];
    const res = await submit.main({ itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: r.answerIndex });
    t('B1 未作答：answered=false, correct=null（不是 false）',
      res.answered === false && res.correct === null, JSON.stringify(res));
    t('B2 未作答 → diagnosisLevel=unjudgeable', res.diagnosisLevel === 'unjudgeable', res.diagnosisLevel);
    const rec = await lastOf(db, 'homework');
    t('B3 落库的 correct 也是 null（不能把"不知道"存成"做错了"）', rec.correct === null && rec.answered === false,
      JSON.stringify({ c: rec.correct, a: rec.answered }));
  }

  {
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const r = BANK[0];
    const res = await submit.main({
      itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: r.answerIndex,
      userAnswer: 99,   // 越界：既不是有效选项，也不该被当成"错"
    });
    t('B4 userAnswer 越界 → answered=false, correct=null',
      res.answered === false && res.correct === null, JSON.stringify(res));
  }

  {
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const r = BANK[0];
    const res = await submit.main({
      itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: r.answerIndex,
      userAnswer: null,
    });
    t('B5 userAnswer=null 也走"未作答"分支（不是把它转成 0 号选项）',
      res.answered === false && res.correct === null, JSON.stringify(res));
  }

  {
    // 完全没有 question_bank 集合：不能假装核对过
    const db = createDb({});
    const submit = loadFn('homeworkSubmit', db);
    const res = await submit.main({
      itemId: 'x1', question: '题目', options: ['A', 'B'], answerIndex: 1, userAnswer: 1,
    });
    t('B6 银行没有这一题 → questionSource=client, versionMismatch=false（没核对过就不说核对过）',
      res.questionSource === 'client' && res.versionMismatch === false, JSON.stringify(res));
    t('B7 银行缺失但仍能用快照判对错（correct=true），只是结论强度降低',
      res.correct === true && res.diagnosisLevel === 'option_only',
      JSON.stringify({ c: res.correct, d: res.diagnosisLevel }));
  }

  {
    // 银行里答案键本身坏掉（越界）：bankUsable=false → 不能用它判，
    // 但也不能报"版本不一致"（那不是版本问题，是键坏了）
    const bad = Object.assign({}, BANK[0], { answerIndex: 9, version: 'deadbeef' });
    const db = createDb({ question_bank: [bad] });
    const submit = loadFn('homeworkSubmit', db);
    const res = await submit.main({
      itemId: bad.itemId, question: bad.question, options: bad.options.slice(),
      answerIndex: bad.answerIndex, userAnswer: bad.answerIndex,
    });
    t('B8 银行答案键越界 → 不采用银行版本（questionSource=client）',
      res.questionSource === 'client', JSON.stringify(res));
    const rec = await lastOf(db, 'homework');
    t('B9 且此时不会因为"版本不同"而误报 versionMismatch', rec.versionMismatch === false, JSON.stringify(rec));
  }

  /* ============ C 组：diagnosisLevel 分级 ============ */
  sec('C. diagnosisLevel：unjudgeable / option_only / cause 的边界');

  {
    const r = BANK[10];
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);

    const noWork = await submit.main({
      itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: r.answerIndex,
      userAnswer: (r.answerIndex + 1) % r.options.length,
    });
    t('C1 银行核实 + 答错 + 无解题过程 → option_only（不许断言错因）',
      noWork.questionSource === 'bank' && noWork.correct === false && noWork.diagnosisLevel === 'option_only',
      JSON.stringify(noWork));

    const withWork = await submit.main({
      itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: r.answerIndex,
      userAnswer: (r.answerIndex + 1) % r.options.length,
      studentWork: '我觉得选项2里有"专有名词"就选了它。',
    });
    t('C2 银行核实 + 有解题过程 → cause（可以讨论错因）',
      withWork.diagnosisLevel === 'cause' && withWork.canDiagnoseCause === true, JSON.stringify(withWork));

    const blankWork = await submit.main({
      itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: r.answerIndex,
      userAnswer: 0, studentWork: '   ',
    });
    t('C3 空白解题过程不算过程（不能被空格骗成 cause）',
      blankWork.diagnosisLevel !== 'cause', blankWork.diagnosisLevel);
  }

  {
    // 版本不一致（client）时，即使有解题过程也只能 option_only
    const r = BANK[11];
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const res = await submit.main({
      itemId: r.itemId, question: r.question + '（改）', options: r.options.slice(), answerIndex: r.answerIndex,
      userAnswer: (r.answerIndex + 1) % r.options.length, studentWork: '我按语义排除了两个选项。',
    });
    t('C4 未核实的答案键 + 有解题过程 → 仍只能 option_only',
      res.questionSource === 'client' && res.correct === false && res.diagnosisLevel === 'option_only',
      JSON.stringify(res));
  }

  {
    // 答对时也不该升级成 cause（没有错因可讲）—— 保持口径一致
    const r = BANK[12];
    const db = createDb({ question_bank: bankRows() });
    const submit = loadFn('homeworkSubmit', db);
    const res = await submit.main({
      itemId: r.itemId, question: r.question, options: r.options.slice(), answerIndex: r.answerIndex,
      userAnswer: r.answerIndex, studentWork: '排除法。',
    });
    t('C5 答对 + 银行核实 + 有过程 → 仍是 option_only（没有错因可讨论）',
      res.correct === true && res.diagnosisLevel === 'option_only', JSON.stringify(res));
  }

  /* ============ D 组：homeworkReview 的提示词与兜底 ============ */
  sec('D. homeworkReview：提示词带真实题面；证据不足就降级、不编');

  /* 造一条 homework 记录（模拟 homeworkSubmit 的落库形状） */
  function subRow(extra) {
    return Object.assign({
      openid: 'o_student', itemId: 'k1', courseId: 'ielts_listening', courseName: '雅思听力',
      question: '以下哪类词最适合做定位词？',
      options: ['介词', '专有名词', '动名词', '形容词'],
      answerIndex: 1, explanation: '专有名词不容易被同义替换，最适合做定位词。',
      questionVersion: 'aaaaaaaa', questionSource: 'bank', versionMismatch: false,
      correct: false, answered: true, diagnosisLevel: 'option_only',
      userAnswer: 0, studentWork: '', status: 'submitted',
      createTime: new Date(2026, 8, 29, 10, 0, 0),
    }, extra || {});
  }

  async function reviewWith(row, reply) {
    aiCalls.length = 0;
    const db = createDb({ homework: [row] });
    const review = loadFn('homeworkReview', db, aiStub(reply));
    const res = await review.main({ itemId: row.itemId });
    return { res, db, prompt: aiCalls.length ? aiCalls[0] : '' };
  }

  {
    const { res, prompt, db } = await reviewWith(subRow());
    t('D1 option_only：提示词包含真实题干', prompt.indexOf('以下哪类词最适合做定位词？') >= 0);
    t('D2 提示词包含选项**文字**（不是只有序号）',
      prompt.indexOf('专有名词') >= 0 && prompt.indexOf('动名词') >= 0);
    t('D3 提示词标明学生所选（用文字描述）', prompt.indexOf('第1项：介词') >= 0, prompt.slice(0, 0) || '');
    t('D4 提示词标明标准答案（用文字描述）', prompt.indexOf('第2项：专有名词') >= 0);
    t('D5 提示词包含标准解析', prompt.indexOf('不容易被同义替换') >= 0);
    t('D6 option_only 时明令禁止断言看不到的结论',
      prompt.indexOf('严禁断言') >= 0 && prompt.indexOf('概念混淆') >= 0);
    t('D7 option_only 时**不**授权讨论错因（不出现"可以讨论错误原因"）',
      prompt.indexOf('可以讨论错误原因') < 0);
    const rec = await lastOf(db, 'homework_reviews');
    t('D8 讲评落库带题面与依据链，界面才有东西显示',
      !!(rec && rec.question && Array.isArray(rec.options) && rec.courseName === '雅思听力' &&
        rec.diagnosisLevel === 'option_only' && rec.canDiagnoseCause === false),
      JSON.stringify(rec && Object.keys(rec)));
    t('D9 返回体里 correct=false（有对错结论）', res.review.correct === false && res.review.answered === true);
  }

  {
    const { res, prompt, db } = await reviewWith(subRow({
      diagnosisLevel: 'cause', questionSource: 'bank', studentWork: '我看选项2是专有名词就选了。',
    }));
    t('D10 cause：提示词包含学生的解题过程', prompt.indexOf('我看选项2是专有名词就选了。') >= 0);
    t('D11 cause：提示词授权讨论错因', prompt.indexOf('可以讨论错误原因') >= 0);
    t('D12 cause：不再出现"严禁断言"那套降级约束', prompt.indexOf('严禁断言') < 0);
    t('D13 cause：要求不要直接给出完整答案', prompt.indexOf('不要直接给出完整答案') >= 0);
    const rec = await lastOf(db, 'homework_reviews');
    t('D14 cause 的讲评记录 canDiagnoseCause=true', rec.canDiagnoseCause === true);
    // aiStub() 默认返回 code:1（AI 不可用）→ 走兜底文案，正好验证兜底也不编
    const fb = String(res.review.feedback);
    t('D15 cause + AI 不可用时兜底仍不编具体错因（只说"建议回顾知识点"）',
      fb.indexOf('概念混淆') < 0 && fb.indexOf('计算失误') < 0 && fb.indexOf('回顾该知识点') >= 0, fb);
  }

  {
    // AI 返回可用结构化结果 → 采纳
    const { res } = await reviewWith(subRow({ diagnosisLevel: 'cause', studentWork: '排除法' }),
      { feedback: 'AI 的讲评', suggestion: 'AI 的建议' });
    t('D16 AI 返回 feedback/suggestion 时被采纳',
      res.review.feedback === 'AI 的讲评' && res.review.suggestion === 'AI 的建议',
      JSON.stringify(res.review));
  }

  {
    // unjudgeable：绝不调用 AI
    aiCalls.length = 0;
    const db = createDb({ homework: [subRow({ correct: null, answered: false, diagnosisLevel: 'unjudgeable', userAnswer: -1 })] });
    const review = loadFn('homeworkReview', db, aiStub({ feedback: 'X', suggestion: 'Y' }));
    const res = await review.main({ itemId: 'k1' });
    t('D17 unjudgeable：**不调用 AI**（不给编造留入口）', aiCalls.length === 0, 'aiCalls=' + aiCalls.length);
    t('D18 unjudgeable：feedback 如实说明"还没有作答"',
      res.review.feedback.indexOf('没有作答') >= 0, res.review.feedback);
    t('D19 unjudgeable：correct 仍为 null（绝不把 null 说成错）', res.review.correct === null);
    t('D20 unjudgeable：仍把题目原文带出来（让界面能显示题）',
      res.review.question.indexOf('定位词') >= 0);
    const rec = await lastOf(db, 'homework_reviews');
    t('D21 unjudgeable 也留痕，且 canDiagnoseCause=false', rec.canDiagnoseCause === false);
  }

  {
    // 老数据：没有 answered/correct/diagnosisLevel 字段
    const legacy = {
      openid: 'o_student', itemId: 'k2', courseId: 'c', courseName: '课',
      question: 'Q', options: ['A', 'B'], answerIndex: 1, userAnswer: -1,
      createTime: new Date(2026, 7, 1, 10, 0, 0),
    };
    const { res } = await reviewWith(legacy);
    t('D22 老记录（无 diagnosed 字段）按新规则补算：未作答 → unjudgeable 且不编',
      res.review.diagnosisLevel === 'unjudgeable' && res.review.correct === null,
      JSON.stringify(res.review));
  }

  {
    // 老数据：作答了但 answerIndex 缺失（越界）→ 判不了对错，也不能说错
    const legacy = {
      openid: 'o_student', itemId: 'k3', question: 'Q', options: ['A', 'B'],
      answerIndex: -1, userAnswer: 1, createTime: new Date(2026, 7, 2, 10, 0, 0),
    };
    const { res } = await reviewWith(legacy);
    t('D23 老记录答案键不可用 → correct=null 且 diagnosisLevel=unjudgeable',
      res.review.correct === null && res.review.diagnosisLevel === 'unjudgeable',
      JSON.stringify(res.review));
    t('D24 且 feedback 说明是"答案键不可用"而不是"你答错了"',
      res.review.feedback.indexOf('答案键不可用') >= 0, res.review.feedback);
  }

  {
    // 无 AI（callFunction 失败）时的兜底文案也不许编错因
    aiCalls.length = 0;
    const db = createDb({ homework: [subRow({ diagnosisLevel: 'option_only' })] });
    const review = loadFn('homeworkReview', db, async () => { throw new Error('aiProxy down'); });
    const res = await review.main({ itemId: 'k1' });
    const txt = String(res.review.feedback) + '|' + String(res.review.suggestion);
    t('D25 AI 不可用时兜底文案不含"概念混淆/计算失误/粗心"等断言语',
      txt.indexOf('概念混淆') < 0 && txt.indexOf('计算失误') < 0 && txt.indexOf('粗心') < 0, txt);
    t('D26 兜底文案说明"不足以判断具体原因"', res.review.feedback.indexOf('不足以判断具体原因') >= 0, res.review.feedback);
    t('D27 兜底时给出正确答案的文字（这才是我们能确定的事）',
      res.review.feedback.indexOf('第2项：专有名词') >= 0, res.review.feedback);
  }

  {
    // 没有作业记录
    const db = createDb({});
    const review = loadFn('homeworkReview', db, aiStub());
    const res = await review.main({ itemId: 'none' });
    t('D28 没有作业记录 → code=1 而不是编一段讲评', res.code === 1, JSON.stringify(res));
  }

  {
    // unjudgeable 分支不写 aiProxy：即使 homework 里 options 空也不能崩
    const db = createDb({ homework: [Object.assign(subRow(), { options: [], answerIndex: -1, correct: null, answered: false, diagnosisLevel: '' })] });
    const review = loadFn('homeworkReview', db, aiStub());
    const res = await review.main({ itemId: 'k1' });
    t('D29 题面残缺（选项为空）+ 老记录 → 不崩，且不下对错结论',
      res.code === 0 && res.review.correct === null, JSON.stringify(res));
  }

  {
    // 答对了就不该进入"分析错因"模式：否则模型会为学生扣一顶"其实概念不清"的帽子
    const { res, prompt } = await reviewWith(subRow({ correct: true, userAnswer: 1, diagnosisLevel: 'option_only' }));
    t('D30 答对：提示词不授权讨论错因（不给"答对了但概念不清"留口子）',
      prompt.indexOf('可以讨论错误原因') < 0, '');
    t('D31 答对：提示词仍要求严禁断言看不到的结论', prompt.indexOf('严禁断言') >= 0);
    t('D32 答对 + AI 不可用：兜底文案是"作答正确"，且给正确选项文字',
      res.review.feedback.indexOf('作答正确') >= 0 && res.review.feedback.indexOf('第2项：专有名词') >= 0,
      res.review.feedback);
  }

  /* ============ E 组：题库产物 ============ */
  sec('E. tools/question-bank.json 的形状，以及 tools 侧 --check');

  {
    t('E1 产物非空且覆盖全部题目（' + BANK.length + ' 条）', BANK.length > 0);
    t('E2 每条都有 _id=itemId（homeworkSubmit 按 doc(itemId) 取）',
      BANK.every(r => r._id && r._id === r.itemId));
    t('E3 每条都有 8 位十六进制版本号',
      BANK.every(r => typeof r.version === 'string' && /^[0-9a-f]{8}$/.test(r.version)),
      BANK.filter(r => !/^[0-9a-f]{8}$/.test(String(r.version))).slice(0, 3).map(r => r.itemId).join(','));
    t('E4 每条 answerIndex 都在选项范围内（银行里不能有坏键）',
      BANK.every(r => Array.isArray(r.options) && r.options.length >= 2 &&
        Number.isInteger(r.answerIndex) && r.answerIndex >= 0 && r.answerIndex < r.options.length));
    t('E5 没有重复 _id', new Set(BANK.map(r => r._id)).size === BANK.length);
    t('E6 版本号能区分不同题目（不是所有题都同一个哈希）',
      new Set(BANK.map(r => r.version)).size > BANK.length * 0.9,
      'unique=' + new Set(BANK.map(r => r.version)).size);
  }

  {
    let out = '', code = 0;
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sync-question-bank.js'), '--check'],
        { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = (e && e.status) || 1;
      out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
    }
    t('E7 tools/sync-question-bank.js --check 通过（产物与 courses.js 同步）',
      code === 0 && out.indexOf('CHECK_OK') >= 0, 'exit=' + code + ' out=' + out.trim().slice(0, 120));
  }

  {
    // 反向：故意让产物与题库不一致时 --check 必须失败（否则这条 CI 形同虚设）
    const outPath = path.join(ROOT, 'tools', 'question-bank.json');
    const backup = fs.readFileSync(outPath, 'utf8');
    let code = 0, out = '';
    try {
      fs.writeFileSync(outPath, JSON.stringify([{ _id: 'stale', version: '00000000' }], null, 2), 'utf8');
      try {
        out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sync-question-bank.js'), '--check'],
          { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        code = (e && e.status) || 1;
        out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
      }
    } finally {
      fs.writeFileSync(outPath, backup, 'utf8');
    }
    t('E8 产物过期时 --check 必须失败（CI 才拦得住）', code !== 0, 'exit=' + code);
    t('E9 且提示要重新生成', out.indexOf('不同步') >= 0, out.trim().slice(0, 120));
    const restored = fs.readFileSync(outPath, 'utf8');
    t('E10 反向测试后产物已还原（不留副作用）', restored === backup);
  }

  console.log('\n_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL 测试自身异常: ' + (e && e.stack || e));
  console.log('\n_RESULT pass=' + pass + ' fail=' + (fail + 1));
  process.exit(1);
});
