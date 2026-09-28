const app = getApp();

Page({
  data: {
    theme: 'light',
    fontSize: 'medium',
    fontOptions: [
      { key: 'small', label: '小' },
      { key: 'medium', label: '中' },
      { key: 'large', label: '大' }
    ]
  },

  onLoad() {
    this.setData({
      theme: wx.getStorageSync('theme') || 'light',
      fontSize: wx.getStorageSync('fontSize') || 'medium'
    });
  },

  // 切换暗黑模式
  onThemeChange(e) {
    const theme = e.detail.value ? 'dark' : 'light';
    wx.setStorageSync('theme', theme);
    this.setData({ theme });
    // 设置页面根节点 class，用于实时预览
    this.setPageClass(theme);
  },

  // 切换字号
  onFontChange(e) {
    const fontSize = e.detail.value;
    wx.setStorageSync('fontSize', fontSize);
    this.setData({ fontSize });
    // 通知所有页面刷新字号
    const pages = getCurrentPages();
    pages.forEach(p => {
      if (p && p.setData) {
        try { p.setData({ fontSize }); } catch (err) {}
      }
    });
  },

  setPageClass(theme) {
    const query = wx.createSelectorQuery();
    query.select('.page-root').fields({ node: true }, (res) => {}).exec();
  },

  // 清空缓存（保留登录态）
  clearCache() {
    wx.showModal({
      title: '清空缓存',
      content: '将清除本地课程缓存与离线数据，登录态和云端数据不受影响。确定继续？',
      confirmText: '清空',
      confirmColor: '#ff1744',
      success: (res) => {
        if (res.confirm) {
          const openid = wx.getStorageSync('openid');
          const privacy = wx.getStorageSync('privacy_agreed');
          const lang = wx.getStorageSync('lang');
          wx.clearStorageSync();
          // 恢复关键数据
          if (openid) wx.setStorageSync('openid', openid);
          if (privacy) wx.setStorageSync('privacy_agreed', privacy);
          if (lang) wx.setStorageSync('lang', lang);
          wx.showToast({ title: '缓存已清空', icon: 'success' });
        }
      }
    });
  }
});
