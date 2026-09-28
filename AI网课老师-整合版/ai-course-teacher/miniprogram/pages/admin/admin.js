const app = getApp();

Page({
  data: {
    status: 'draft',      // draft | approved | rejected
    drafts: [],
    loading: false,
    notice: ''
  },

  onShow() {
    this.loadDrafts();
  },

  loadDrafts() {
    if (!app.globalData.hasLogin) {
      this.setData({ notice: '请先登录后再访问审核后台' });
      return;
    }
    this.setData({ loading: true, notice: '' });
    wx.cloud.callFunction({
      name: 'getDrafts',
      data: { status: this.data.status, limit: 50 }
    }).then(res => {
      this.setData({ loading: false });
      if (res.result && res.result.code === 0) {
        this.setData({ drafts: res.result.list || [] });
      } else {
        this.setData({ notice: (res.result && res.result.msg) || '加载失败' });
      }
    }).catch(() => {
      this.setData({ loading: false, notice: '网络异常' });
    });
  },

  switchStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ status }, () => this.loadDrafts());
  },

  // 通过 / 驳回
  review(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action; // 'approve' | 'reject'
    wx.cloud.callFunction({
      name: 'reviewDraft',
      data: { draftId: id, action }
    }).then(res => {
      const r = res.result || {};
      if (r.code === 0) {
        wx.showToast({ title: action === 'approve' ? '已通过并发布' : '已驳回', icon: 'success' });
        this.loadDrafts();
      } else {
        wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
      }
    }).catch(() => {
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  noop() {}
});
