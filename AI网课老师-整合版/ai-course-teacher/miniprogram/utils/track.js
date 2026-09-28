// 埋点工具：fire-and-forget 上报，不阻塞主流程，失败静默
function track(event, props) {
  try {
    const app = getApp();
    // 游客态不上报（无 openid 云函数会拒绝）
    if (!app || !app.globalData || !app.globalData.hasLogin) return;
    wx.cloud.callFunction({
      name: 'trackEvent',
      data: { event, props: props || {} }
    }).catch(() => {});
  } catch (e) {}
}

module.exports = { track };
