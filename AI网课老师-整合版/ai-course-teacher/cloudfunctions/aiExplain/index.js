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

  /* ★ 2026-09-29 修（外部审查 R13）：
     ① 本函数的提示词要的是**口语化讲解**（「讲解要口语化、有条理」），
        而 aiProxy 原来无条件强制 JSON —— 契约相反。
        现在显式声明 format:'text'。
     ② 只认一个字段 `text`（原来是 explanation || content || text 蒙一个）。
     ③ 失败**不冒充成功**：回退到标准解析时带 `fallback: true`，
        让前端能如实说"这是标准解析，不是 AI 讲解"，而不是把两者混为一谈。 */
  const ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt, format: 'text' } }).catch(() => null);

  if (ai && ai.result && ai.result.code === 0 && typeof ai.result.text === 'string' && ai.result.text.trim()) {
    return { code: 0, data: { content: ai.result.text.trim() }, fallback: false };
  }

  return {
    code: 0,
    data: { content: explanation || 'AI 暂时无法生成讲解，请参考标准解析。' },
    fallback: true,
    msg: 'AI 讲解生成失败，已退回标准解析'
  };
};
