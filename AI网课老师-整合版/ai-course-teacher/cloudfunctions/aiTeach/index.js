const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { system, subject, topic, remedial, wrongQuiz, feynman } = event;

  let prompt = '你是' + (system || 'A-Level') + ' ' + (subject || '数学') +
    '资深教师，正在给学生一对一授课。请生成结构化授课 JSON，严格包含：sections（每段含 text 和 board.steps）' +
    '、summary、quiz（含 question、options、answerIndex、explanation、remedialSection）。' +
    '板书 steps 用 type 为 text/line/rect 的对象，坐标用 x,y 数值。主题：' + (topic || '微分方程');

  // 学而思式分层：同一知识点按等级讲法不同
  if (event.level === 'A+') {
    prompt += '。学生基础较弱（A+ 基础班），请放慢节奏、精讲核心概念，多用基础例题，避免偏难怪题，确保每一步都听懂。';
  } else if (event.level === 'S+') {
    prompt += '。学生基础扎实（S+ 培优班），请一题多解、变式拓展，挑战综合难题与压轴题思路，深挖本质。';
  } else {
    prompt += '。学生基础中等（S 提升班），请归纳题型模型与解题模板，配合中档题训练，点出易错点。';
  }

  if (remedial && wrongQuiz) {
    prompt += '。学生已学过但错了这道题：' + JSON.stringify(wrongQuiz) + '，请针对性重讲。';
  }

  /* ===== 费曼学习法模式（2026-10-01 新增）=====
     小程序这边的授课是**一次性生成结构化讲义**（不是实时对话），
     所以费曼在这里不能照搬"让学生当场讲一遍"—— 那需要多轮。
     落地方式是把它拆成两半，各自放到能生效的地方：
       · 讲法（生成时）：每个概念先用外行听得懂的话与类比说清，**再**给术语和定义；
         并且明确标出"这里最容易讲不清"的那一步。
       · 检验（生成后）：输出一个 feynmanCheck 字段 —— 一句要求学生**合上页面、
         用自己的话把这个概念讲给完全没学过的人听**的任务。学生在多轮的
         「讲给我听」页面里完成它。
     为什么必须生成一个**独立字段**而不是塞进 summary：
     塞进 summary 就会被渲染成一段普通小结文字，学生读过去就完了；
     独立字段可以让前端把它渲染成一张"现在轮到你讲"的卡片。 */
  if (feynman) {
    prompt += '。【费曼学习法模式】请按下面的方式讲解：'
      + '① 每个概念先用**外行能听懂的大白话和一个生活化的类比**说清楚，然后再给出术语与严格定义 —— '
      + '顺序不能反，术语不能一上来就出现；'
      + '② 在讲解中**明确指出哪一步最容易讲不清**（例如"这里最容易搞混的是……"），但不要直接给结论；'
      + '③ 除了原有字段，**必须**额外输出 feynmanCheck 字段：一个字符串，'
      + '内容是给学生的任务，格式为"请你合上页面，用自己的话把《××》讲给一个完全没学过的人听，'
      + '特别是××那一步"。它必须是**一句可以直接布置给学生的话**，不要写成对老师的说明。';
  }

  const fallback = {
    sections: [{
      text: 'AI 讲解内容暂时无法生成，这是本地兜底讲解：请先复习本知识点的基础概念。',
      board: { steps: [{ type: 'text', text: '基础回顾', x: 20, y: 60, color: '#00e5ff' }] }
    }],
    summary: '以教材为主，AI 内容仅作辅助。',
    quiz: {
      question: '你是否理解了本节核心概念？',
      options: ['理解了', '还需复习'],
      answerIndex: 0,
      explanation: '建议结合教材再巩固一遍。',
      remedialSection: '重新阅读教材对应章节。'
    }
  };

  /* 兜底也要给 feynmanCheck：降级时学生同样该看到"轮到你讲了"这个任务，
     否则"AI 挂了"会顺带把费曼环节一起吞掉（而它本来不依赖 AI 也能做）。 */
  if (feynman) {
    fallback.feynmanCheck = '请你合上页面，用自己的话把本节内容讲给一个完全没学过的人听 ——' +
      '讲不清的地方，就是还需要回头再看的地方。';
  }

  const ai = await cloud.callFunction({
    name: 'aiProxy',
    data: { prompt, fallback }
  }).catch(() => ({ result: { code: 500, fallback } }));

  const result = ai.result;
  if (result.code !== 0 || !result.data) {
    return { code: result.code || 500, msg: result.msg || 'AI 繁忙', fallback: fallback };
  }

  const data = validateTeach(result.data);
  if (!data) {
    return { code: 500, msg: '生成内容格式异常，已回退内置课程', fallback };
  }

  // 写入草稿，待人工审核
  await db.collection('courses_draft').add({
    data: {
      type: 'teach',
      system: system || '',
      subject: subject || '',
      topic: topic || '',
      content: data,
      status: 'draft',
      openid: OPENID,
      createTime: db.serverDate()
    }
  }).catch(() => {});

  return { code: 0, data };
};

function validateTeach(d) {
  if (!d || !Array.isArray(d.sections) || d.sections.length === 0) return null;
  // quiz 兼容对象或数组（prompt 要求对象，此处不再强制数组）
  const hasQuiz = d.quiz && (Array.isArray(d.quiz) ? d.quiz.length > 0 : !!d.quiz.question);
  if (!hasQuiz) return null;
  d.sections.forEach(s => {
    if (!s.text) s.text = '讲解内容';
    if (!s.board || !s.board.steps) s.board = { steps: [] };
  });
  /* feynmanCheck 是可选的：模型偶尔会漏这个字段，漏了就不显示那张卡片，
     但**不要**用兜底文案替它编一句 —— 那句话本来是针对本节内容写的，
     编一句通用的就等于把费曼环节变成一句空口号。真正需要兜底的是"AI 完全不可用"
     那条路径（见上面的 fallback）。 */
  if (typeof d.feynmanCheck !== 'string' || !d.feynmanCheck.trim()) delete d.feynmanCheck;
  else d.feynmanCheck = d.feynmanCheck.trim();
  return d;
}
