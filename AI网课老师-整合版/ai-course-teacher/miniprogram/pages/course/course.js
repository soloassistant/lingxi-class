const data = require('../../data/courses.js');

Page({
  data: {
    courseId: '',
    course: null,
    chapters: [],
    darkMode: false,
    fontScale: '16px',
    loading: true
  },

  onLoad(options) {
    const courseId = options.id || '';
    const course = (data.courses || []).find(c => c.id === courseId);
    const chapters = (data.chapters || []).filter(ch => ch.courseId === courseId);
    this.setData({ courseId, course, chapters, loading: false });
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const theme = wx.getStorageSync('theme') || 'light';
    const fontSize = wx.getStorageSync('fontSize') || 'standard';
    const darkMode = theme === 'dark';
    const fontScale = fontSize === 'large' ? '18px' : fontSize === 'small' ? '14px' : '16px';
    this.setData({ darkMode, fontScale });
  },

  goLesson(e) {
    const knowledgeId = e.currentTarget.dataset.id;
    if (!knowledgeId) return;
    wx.navigateTo({ url: '/pages/teach/teach?id=' + knowledgeId });
  },

  goAskAI() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  markLearned(e) {
    const knowledgeId = e.currentTarget.dataset.id;
    /* ★ R11：这是**学生自评**"我已掌握"，不是客观判定。
       graded:false 把它挡在正确率之外 —— 自评是学习信号，不是答对证据。
       否则学生点几下"我已掌握"就能把答题正确率刷满。 */
    wx.cloud.callFunction({
      name: 'saveProgress',
      data: { itemId: knowledgeId, courseId: this.data.courseId, graded: false, source: 'self_mark' }
    });
  }
});
