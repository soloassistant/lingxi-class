const legal = require('../../utils/legal.js');

// 隐私条款页：联系邮箱从 config（单一数据源）取，随页面渲染
Page({
  data: { supportEmail: legal.SUPPORT_EMAIL }
});
