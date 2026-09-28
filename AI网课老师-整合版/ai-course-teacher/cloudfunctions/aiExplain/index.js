const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { question, userAnswer, correctAnswer, explanation } = event;

  const prompt = '你是耐心的解题老师。请基于以下信息给学生讲解这个答案为什么对或错，' +
    '讲解要口语化、有条理，不超过200字，不要透露答案本身。' +
    '题目：' + (question || '') +
    '；学生答案：' + (userAnswer || '') +
    '；正确答案：' + (correctAnswer || '') +
    '；标准解析：' + (explanation || '');

  const ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt } }).catch(() => null);

  if (ai && ai.result && ai.result.code === 0 && ai.result.data) {
    return {
      code: 0,
      data: {
        content: ai.result.data.explanation || ai.result.data.content || ai.result.data.text || ''
      }
    };
  }

  return { code: 0, data: { content: explanation || 'AI 暂时无法生成讲解，请参考标准解析。' } };
};
