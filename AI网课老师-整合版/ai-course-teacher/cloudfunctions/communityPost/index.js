const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: '未登录' };

  const content = (event.content || '').trim();
  if (!content) return { code: 1, msg: '内容为空' };
  if (content.length > 500) return { code: 1, msg: '内容过长' };

  try {
    const sec = await cloud.callFunction({ name: 'secCheck', data: { content } });
    if (sec.result && sec.result.code !== 0) {
      return { code: 1, msg: '内容不合规' };
    }
  } catch (e) {}

  await db.collection('posts').add({
    data: {
      openid: OPENID,
      nickname: '同学',
      avatarColor: '#4f6ef2',
      content,
      time: db.serverDate(),
      likes: 0
    }
  });

  return { code: 0 };
};
