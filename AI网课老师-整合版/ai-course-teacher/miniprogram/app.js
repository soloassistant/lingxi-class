const config = require('./config.js');
const legal = require('./utils/legal.js');

App({
  globalData: { openid: '', hasLogin: false, isGuest: false, loginError: '', _fg: false },
  onLaunch() {
    this.startUsageReminder();
    if (!wx.cloud) {
      this.globalData.isGuest = true;
      this.globalData.loginError = '当前环境不支持云能力';
      return;
    }
    wx.cloud.init({ env: config.envId, traceUser: true });
    this.cloudLogin();
  },

  // 小程序前后台：仅供防沉迷计时判断"是否正在使用"
  onShow() { this.globalData._fg = true; },
  onHide() { this.globalData._fg = false; },

  // 防沉迷：登录态 + 前台每 30s 记一格，跨过 45/90 分钟弹休息提醒。
  // 只提醒、不强制断线 —— 纯前端必然可绕过（清缓存归零），写"已限制"是虚假宣称，
  // 详见 utils/legal.js 顶部的诚实取舍说明。
  startUsageReminder() {
    if (this._usageTimer) return;
    this._usageTimer = setInterval(() => {
      if (!this.globalData._fg) return;               // 后台不计"在使用"
      const hits = legal.tickUsage({ loggedIn: this.globalData.hasLogin });
      hits.forEach(m => wx.showToast({ title: m.toast, icon: 'none', duration: 3500 }));
    }, legal.USAGE_TICK_MS);
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
