const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { system, subject, topic, remedial, wrongQuiz } = event;

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
  return d;
}
