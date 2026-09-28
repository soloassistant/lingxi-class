const app = getApp();

Component({
  properties: {
    visible: { type: Boolean, value: false },
    show: { type: Boolean, value: false }
  },
  data: {
    agreementUrl: '',
    privacyUrl: '',
    permissions: ['头像昵称', '学习记录', '错题记录'],
    collectedData: ['学习进度', '课程偏好', '答题记录'],
    notCollected: ['通讯录', '位置信息', '摄像头']
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      if (currentPage && currentPage.route.includes('agreement')) return;
      this.setData({
        agreementUrl: '/pages/agreement/agreement?type=agreement',
        privacyUrl: '/pages/agreement/agreement?type=privacy'
      });
    }
  },
  methods: {
    onAgree() {
      wx.setStorageSync('privacy_agreed', true);
      this.triggerEvent('agree');
      this.setData({ visible: false, show: false });
    },
    onDisagree() {
      this.triggerEvent('disagree');
      this.setData({ visible: false, show: false });
    },
    goPrivacy() {
      const url = this.data.privacyUrl;
      if (url) wx.navigateTo({ url });
    },
    goAgreement() {
      const url = this.data.agreementUrl;
      if (url) wx.navigateTo({ url });
    },
    noop() {}
  }
});
