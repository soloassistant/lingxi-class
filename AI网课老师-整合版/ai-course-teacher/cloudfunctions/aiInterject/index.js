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

  /* ★ 2026-09-29 修（外部审查 R13，P2）：
     ① 契约矛盾：本函数的提示词明确要求「不要再输出 JSON」，
        而 aiProxy 原来**无条件**强制 JSON（system 写"Always output valid JSON only"
        + response_format: json_object + JSON.parse）—— 两边在下相反的命令。
        现在显式声明 format:'text'，代理走纯文本分支。
     ② 猜字段：原来是 `data.reply || data.answer || data.text || data.content || 兜底`
        —— 四个字段蒙一个，没有稳定契约。现在只认**一个**字段 `text`。
     ③ 失败被包装成成功：原来上游失败时把「AI 暂时无法回答」当 `code:0` 返回，
        并且**写进教学日志的 reply 字段** —— 于是这句错误提示变成了"老师的回答"、
        还会被当成薄弱点识别的证据。现在失败就返回明确的错误码，
        前端据此显示可重试的错误；日志里只记失败，不记假回答。 */
  const ai = await cloud.callFunction({
    name: 'aiProxy',
    data: { prompt, format: 'text' }
  }).catch(() => null);

  const okUpstream = !!(ai && ai.result && ai.result.code === 0 && typeof ai.result.text === 'string' && ai.result.text.trim());

  if (!okUpstream) {
    // 记一条**失败**日志（便于排查上游问题），但绝不把错误文案当成老师的回答
    await db.collection('teach_interrupt_logs').add({
      data: {
        openid: OPENID,
        itemId: itemId || '',
        sectionIndex: sectionIndex || 0,
        question: question.trim(),
        reply: '',
        failed: true,
        failCode: (ai && ai.result && ai.result.code) || 0,
        failMsg: (ai && ai.result && ai.result.msg) || '调用失败',
        historyCount: hist.length,
        createTime: db.serverDate()
      }
    }).catch(() => {});
    return {
      code: 502,
      msg: '老师暂时没能回答（AI 服务繁忙），请稍后再问一次',
      retryable: true
    };
  }

  const reply = ai.result.text.trim();

  // 记录打断日志，用于识别薄弱点（这里记的才是**真实的老师回答**）
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
