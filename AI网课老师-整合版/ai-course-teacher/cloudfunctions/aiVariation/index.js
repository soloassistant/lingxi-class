const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const question = event.question || '';
  if (!question) return { code: 1, msg: '参数缺失' };

  const prompt = '你是一名出题老师。请基于下面这道题，生成一道同知识点、同难度的变式题。' +
    '要求：换数字或情境，但考察同一知识点，不要照抄原题。' +
    '严格返回 JSON，只含字段：{ "question": "...", "options": ["选项1","选项2","选项3","选项4"], "answerIndex": 0, "explanation": "..." }。' +
    '原题：' + question +
    '；原选项：' + JSON.stringify(event.options || []) +
    '；正确答案序号：' + (event.answerIndex !== undefined ? event.answerIndex : '未知');

  const ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt } }).catch(() => null);

  if (ai && ai.result && ai.result.code === 0 && ai.result.data) {
    const d = ai.result.data;
    if (d.question && Array.isArray(d.options) && d.options.length > 0) {
      return {
        code: 0,
        question: d.question,
        options: d.options,
        answerIndex: d.answerIndex !== undefined ? d.answerIndex : 0,
        explanation: d.explanation || ''
      };
    }
  }

  if (ai && ai.result) {
    return { code: ai.result.code, msg: ai.result.msg || 'AI 生成失败' };
  }
  return { code: 500, msg: 'AI 服务不可用' };
};
