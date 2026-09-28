const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { system, subject, topic, level } = event;

  if (!topic) return { code: 1, msg: '主题不能为空' };

  const prompt = '你是' + (system || 'A-Level') + ' ' + (subject || '') + '课程设计师。' +
    '请生成一门课程的 JSON 结构，包含：title、level、chapters（数组，每项含 title 和 items 数组，' +
    '每个 item 含 id、title、body、quiz）。主题：' + topic;

  const ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt } }).catch(() => null);

  const content = (ai && ai.result && ai.result.code === 0) ? ai.result.data : { title: topic, chapters: [] };

  const res = await db.collection('courses_draft').add({
    data: {
      type: 'course',
      system: system || '',
      subject: subject || '',
      topic: topic || '',
      level: level || '',
      content,
      status: 'draft',
      openid: OPENID,
      createTime: db.serverDate()
    }
  }).catch(() => null);

  return { code: 0, msg: '已提交，待人工审核', draftId: res ? res._id : null };
};
