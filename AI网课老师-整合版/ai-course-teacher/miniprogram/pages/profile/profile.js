const app = getApp();
const config = require('../../config.js');

Page({
  data: {
    hasLogin: false,
    openid: '',
    loginError: '',
    stats: {
      days: 0,
      done: 0,
      wrongs: 0
    },
    currentTab: 'profile'
  },

  onShow() {
    if (app.globalData.hasLogin) {
      this.setData({ hasLogin: true, openid: app.globalData.openid });
      this.loadCloudStats();
    } else {
      this.setData({ hasLogin: false, loginError: app.globalData.loginError || '' });
      this.loadLocalStats();
    }
  },

  // 手动登录/重试
  onLogin() {
    wx.showLoading({ title: '登录中...' });
    app.retryLogin().then(ok => {
      wx.hideLoading();
      if (ok) {
        wx.showToast({ title: '登录成功', icon: 'success' });
        this.setData({ hasLogin: true, openid: app.globalData.openid, loginError: '' });
        this.loadCloudStats();
      } else {
        this.setData({ loginError: app.globalData.loginError || '登录失败，请稍后再试' });
        wx.showToast({ title: '登录失败', icon: 'none' });
      }
    });
  },

  loadCloudStats() {
    wx.cloud.callFunction({ name: 'getProfile' })
      .then(res => {
        if (res.result && res.result.code === 0) {
          this.setData({ stats: res.result.stats || this.data.stats });
        } else {
          this.loadLocalStats();
        }
      })
      .catch(() => this.loadLocalStats());
  },

  loadLocalStats() {
    const localWrongs = wx.getStorageSync('localWrongs') || [];
    const localProgress = wx.getStorageSync('localProgress') || [];
    const days = wx.getStorageSync('studyDays') || 0;
    this.setData({
      stats: {
        days,
        done: localProgress.length,
        wrongs: localWrongs.filter(w => !w.resolved).length
      }
    });
  },

  onSwitchTab(e) {
    const url = e.currentTarget.dataset.url;
    wx.switchTab({ url });
  },

  goCommunity() {
    wx.navigateTo({ url: '/pages/community/community' });
  },

  // 学习报告（含学情周报）
  goReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },

  // 订阅学情周报：一周一次的学习总结 + 补强建议
  onSubscribeWeekly() {
    if (!app.globalData.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const TEMPLATE_ID = config.weeklyTemplateId;
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: (res) => {
        if (res[TEMPLATE_ID] !== 'accept') {
          wx.showToast({ title: '已取消订阅', icon: 'none' });
          return;
        }
        wx.cloud.callFunction({ name: 'subscribeWeekly', data: { count: 1, templateId: TEMPLATE_ID } })
          .then(() => wx.showToast({ title: '订阅成功', icon: 'success' }))
          .catch(() => wx.showToast({ title: '订阅失败，请重试', icon: 'none' }));
      },
      fail: () => wx.showToast({ title: '订阅失败，请重试', icon: 'none' })
    });
  },

  goLegal() {
    wx.navigateTo({ url: '/pages/legal/legal' });
  },

  clearLocalData() {
    wx.showModal({
      title: '清空本地数据',
      content: '将删除本机上所有学习记录和错题数据，确定继续？',
      confirmText: '清空',
      confirmColor: '#ff1744',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('localWrongs');
          wx.removeStorageSync('localProgress');
          wx.removeStorageSync('studyDays');
          this.setData({
            stats: { days: 0, done: 0, wrongs: 0 }
          });
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  copyOpenid() {
    wx.setClipboardData({
      data: this.data.openid,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  // ===== 补丁12/13：设置入口 =====
  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  // ===== 审核后台入口（管理员审核 AI 生成内容）=====
  goAdmin() {
    if (!app.globalData.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  // ===== 补丁7：隐私合规三方法 =====
  goAgreement() {
    wx.showActionSheet({
      itemList: ['用户协议', '隐私政策'],
      success: (res) => {
        const type = res.tapIndex === 0 ? 'user' : 'privacy';
        wx.navigateTo({ url: '/pages/agreement/agreement?type=' + type });
      }
    });
  },

  exportData() {
    if (!app.globalData.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '正在导出...' });
    wx.cloud.callFunction({ name: 'exportUserData' })
      .then(res => {
        wx.hideLoading();
        if (res.result && res.result.code === 0) {
          const d = res.result;
          // ★ R11：不再报"打卡 N 条"——checkins 没有任何写入路径，那个数恒为 0。
          //   改成真正在写的作答事实事件，并区分"客观判定"与"自评"。
          wx.showModal({
            title: '导出完成',
            content: `学习进度 ${d.summary.progressCount} 条、错题 ${d.summary.wrongCount} 条、作答记录 ${d.summary.answerEventCount} 条（其中判定作答 ${d.summary.gradedAttemptCount} 条、自评 ${d.summary.selfMarkCount} 条）、作业 ${d.summary.homeworkCount} 条。已生成导出数据。`,
            confirmText: '复制',
            success: (r) => {
              if (r.confirm) {
                wx.setClipboardData({
                  data: JSON.stringify(d.data),
                  success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
                });
              }
            }
          });
        } else {
          wx.showToast({ title: '导出失败', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  deleteAccount() {
    if (!app.globalData.hasLogin) {
      wx.showToast({ title: '游客模式无需注销', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认注销账号？',
      content: '注销后你的全部学习数据将被永久删除，不可恢复。确定继续吗？',
      confirmText: '确认注销',
      confirmColor: '#ff1744',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '注销中...' });
          wx.cloud.callFunction({ name: 'deleteAccount' })
            .then(r => {
              wx.hideLoading();
              wx.showToast({ title: r.result.msg || '已注销', icon: 'success' });
              try {
                wx.clearStorageSync();
              } catch (e) {}
              app.globalData.hasLogin = false;
              app.globalData.openid = '';
              this.setData({ hasLogin: false, openid: '' });
            })
            .catch(() => {
              wx.hideLoading();
              wx.showToast({ title: '注销失败', icon: 'none' });
            });
        }
      }
    });
  }
});
