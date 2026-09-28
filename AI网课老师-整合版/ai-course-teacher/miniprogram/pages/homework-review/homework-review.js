Page({
  data: {
    itemId: '',
    review: null,
    loading: true,
    loadError: false
  },

  onLoad(options) {
    this.setData({ itemId: options.itemId || '' });
    this.loadReview();
  },

  loadReview() {
    wx.cloud.callFunction({
      name: 'homeworkReview',
      data: { itemId: this.data.itemId }
    }).then(res => {
      const r = res.result;
      if (r && r.code === 0 && r.review) {
        this.setData({ review: r.review, loading: false, loadError: false });
      } else {
        this.setData({ loading: false, loadError: true });
      }
    }).catch(() => {
      this.setData({ loading: false, loadError: true });
    });
  },

  goLesson() {
    if (!this.data.itemId) return;
    wx.navigateTo({ url: '/pages/teach/teach?id=' + this.data.itemId });
  },

  goBack() {
    wx.navigateBack();
  }
});
