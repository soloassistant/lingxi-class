const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const kw = (event.kw || '').trim();
  if (!kw) return { code: 1, msg: '问题为空' };
  if (kw.length > 200) return { code: 1, msg: '问题过长' };

  const prompt = '你是耐心的学习助手。请回答学生的问题，直接给出答案，' +
    '通俗易懂、条理清晰，不超过 300 字。严格返回 JSON，只含一个字段：{ "answer": "..." }。' +
    '学生问题：' + kw;

  const ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt } }).catch(() => null);

  if (ai && ai.result && ai.result.code === 0 && ai.result.data) {
    const d = ai.result.data;
    const answer = d.answer || d.reply || d.content || d.text || JSON.stringify(d);
    return { code: 0, answer, source: 'ai' };
  }

  if (ai && ai.result) {
    return { code: ai.result.code, msg: ai.result.msg || 'AI 暂不可用' };
  }

  return { code: 500, msg: 'AI 服务不可用' };
};
