/**
 * 环境配置（部署前必填）
 * 把你的微信云开发环境 ID 填到下面 envId，替换 REPLACE_YOUR_ENV_ID
 * 位置：微信开发者工具 → 云开发控制台 → 设置 → 环境 ID
 */
module.exports = {
  envId: 'REPLACE_YOUR_ENV_ID',
  // 订阅消息模板 ID（学情周报用），在公众平台「订阅消息」申请后填入
  weeklyTemplateId: 'REPLACE_WITH_SUBSCRIBE_TEMPLATE_ID',
  // 运营方联系邮箱（与 Web 版同一运营方）：非空时出现在「隐私条款-联系我们」与「我的」页面，
  // 作为用户/监护人可联系的人工渠道。单一数据源，见 utils/legal.js 的 SUPPORT_EMAIL。
  supportEmail: 'geraldnelsonfung@gmail.com'
};
