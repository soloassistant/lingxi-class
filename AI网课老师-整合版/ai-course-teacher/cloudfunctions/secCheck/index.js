const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { type, content } = event;

  if (!content) return { code: 1, msg: '内容为空' };

  // 文本检测
  if (type === 'text' || !type) {
    try {
      const result = await cloud.openapi.security.msgSecCheck({
        content: String(content).slice(0, 500),
        scene: 2,
        version: 2
      });
      // result 无异常即通过
      return { code: 0, pass: true };
    } catch (e) {
      // 命中违规
      return { code: 403, pass: false, msg: '内容含违规信息，请修改后重试' };
    }
  }

  // 图片检测
  if (type === 'image') {
    try {
      await cloud.openapi.security.imgSecCheck({
        media: { contentType: 'image/png', value: Buffer.from(content, 'base64') }
      });
      return { code: 0, pass: true };
    } catch (e) {
      return { code: 403, pass: false, msg: '图片含违规内容' };
    }
  }

  return { code: 1, msg: '不支持的检测类型' };
};
