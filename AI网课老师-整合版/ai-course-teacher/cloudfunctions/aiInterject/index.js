const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { itemId, sectionIndex, question, history, context, topic } = event;

  if (!question || !question.trim()) return { code: 1, msg: '问题为空' };

  // 知识点标题（前端直接传，避免依赖云端缓存集合）
  const topicTitle = topic || '';

  // 多轮对话：拼接历史消息，让 AI 有上下文（追问链）
  let historyBlock = '';
  const hist = Array.isArray(history) ? history : [];
  if (hist.length > 0) {
    // 只保留最近 6 轮，避免上下文过长
    const recent = hist.slice(-6);
    historyBlock = recent.map(h => {
      const role = h.role === 'user' ? '学生' : '老师';
      return role + '：' + (h.content || '');
    }).join('\n');
  }

  const contextLine = context ? ('（教学场景补充：' + context + '）') : '';

  const prompt = '你是正在授课的老师，学生在听课过程中举手提问。请简洁回答（不超过120字），紧扣当前教学内容。'
    + (topicTitle ? '当前在讲知识点：「' + topicTitle + '」' : '')
    + contextLine
    + (historyBlock ? '\n\n以下是你们刚才的对话（用于理解追问的上下文）：\n' + historyBlock + '\n' : '')
    + '\n学生现在的提问：' + question
    + '\n请直接回答，不要再问学生，也不要输出 JSON。';

  const ai = await cloud.callFunction({
    name: 'aiProxy',
    data: { prompt }
  }).catch(() => null);

  let reply = 'AI 暂时无法回答，请稍后再试。';
  if (ai && ai.result && ai.result.code === 0 && ai.result.data) {
    reply = ai.result.data.reply || ai.result.data.answer || ai.result.data.text || ai.result.data.content || reply;
  }

  // 记录打断日志，用于识别薄弱点
  await db.collection('teach_interrupt_logs').add({
    data: {
      openid: OPENID,
      itemId: itemId || '',
      sectionIndex: sectionIndex || 0,
      question: question.trim(),
      reply,
      historyCount: hist.length,
      createTime: db.serverDate()
    }
  }).catch(() => {});

  return { code: 0, reply };
};
