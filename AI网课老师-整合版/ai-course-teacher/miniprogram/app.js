const config = require('./config.js');

App({
  globalData: { openid: '', hasLogin: false, isGuest: false, loginError: '' },
  onLaunch() {
    if (!wx.cloud) {
      this.globalData.isGuest = true;
      this.globalData.loginError = '当前环境不支持云能力';
      return;
    }
    wx.cloud.init({ env: config.envId, traceUser: true });
    this.cloudLogin();
  },

  // 登录：成功返回 true；失败记录原因并置游客态
  cloudLogin() {
    return new Promise((resolve) => {
      if (!wx.cloud) {
        this.globalData.isGuest = true;
        this.globalData.loginError = '当前环境不支持云能力';
        resolve(false);
        return;
      }
      wx.cloud.callFunction({ name: 'login' })
        .then(res => {
          if (res.result && res.result.openid) {
            this.globalData.openid = res.result.openid;
            this.globalData.hasLogin = true;
            this.globalData.isGuest = false;
            this.globalData.loginError = '';
            // 登录态就绪后刷新当前页
            const pages = getCurrentPages();
            if (pages.length && pages[pages.length - 1].onShow) {
              pages[pages.length - 1].onShow();
            }
            resolve(true);
          } else {
            this.setLoginFail('登录失败：未获取到用户标识');
            resolve(false);
          }
        })
        .catch(() => {
          this.setLoginFail('登录失败：云环境未配置或网络异常，请检查 config.js 的 envId');
          resolve(false);
        });
    });
  },

  setLoginFail(msg) {
    this.globalData.hasLogin = false;
    this.globalData.isGuest = true;
    this.globalData.loginError = msg;
  },

  // 重试登录（供 profile 页手动触发）
  retryLogin() {
    if (!wx.cloud) return Promise.resolve(false);
    wx.cloud.init({ env: config.envId, traceUser: true });
    return this.cloudLogin();
  }
});
