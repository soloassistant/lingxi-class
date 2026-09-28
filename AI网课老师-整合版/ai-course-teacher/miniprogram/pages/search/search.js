const data = require('../../data/courses.js');
const app = getApp();

Page({
  data: {
    kw: '',
    localResults: [],
    aiAnswer: '',
    aiLoading: false,
    hasSearched: false
  },

  onInput(e) {
    this.setData({ kw: e.detail.value });
  },

  doSearch() {
    const kw = (this.data.kw || '').trim();
    if (!kw) {
      wx.showToast({ title: '请输入关键词', icon: 'none' });
      return;
    }
    this.setData({ hasSearched: true, aiAnswer: '', aiLoading: false });

    // 1. 本地知识库搜索
    const local = this.searchLocal(kw);
    this.setData({ localResults: local });

    // 2. AI 答疑：登录态下始终调用（命中补充讲解 / 未命中兜底回答）
    this.callAI(kw);
  },

  searchLocal(kw) {
    const knowledge = data.knowledge || [];
    const lower = kw.toLowerCase();
    const results = [];
    knowledge.forEach(k => {
      const title = (k.title || '').toLowerCase();
      const body = (k.body || '').toLowerCase();
      const quizQ = k.quiz && k.quiz.question ? k.quiz.question.toLowerCase() : '';
      if (title.includes(lower) || body.includes(lower) || quizQ.includes(lower)) {
        results.push({
          id: k.id,
          title: k.title,
          courseId: k.courseId || ''
        });
      }
    });
    return results.slice(0, 20);
  },

  callAI(kw) {
    if (!app.globalData.hasLogin) {
      // 游客降级：本地搜索已给出结果，提示登录可得 AI 答疑
      this.setData({ aiLoading: false, aiAnswer: '（游客模式）本地搜索已在上方列出相关知识点。登录后可获得 AI 老师的智能答疑。' });
      return;
    }
    this.setData({ aiLoading: true });
    wx.cloud.callFunction({ name: 'searchProxy', data: { kw } })
      .then(res => {
        if (res.result && res.result.code === 0 && res.result.answer) {
          this.setData({ aiAnswer: res.result.answer, aiLoading: false });
        } else {
          this.setData({ aiLoading: false });
          const msg = (res.result && res.result.msg) ? res.result.msg : 'AI 暂不可用';
          wx.showToast({ title: msg, icon: 'none' });
        }
      })
      .catch(() => {
        this.setData({ aiLoading: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
  },

  goItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/teach/teach?id=' + id });
  }
});
