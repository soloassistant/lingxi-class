const data = require('../../data/courses.js');
const config = require('../../config.js');
const app = getApp();

Page({
  data: {
    hasLogin: false,
    stats: { days: 0, done: 0, wrongs: 0 },
    accuracy: 0,
    totalKnowledge: 0,
    mastery: 0,
    level: '',
    levelName: '',
    levelCourseName: '',
    achievements: [],
    weakPoints: [],
    recommend: [],
    weekly: null,
    subscribed: false,
    subLoading: false,
    calendar: [],
    activeDays: 0
  },

  onShow() {
    const total = (data.knowledge || []).length;
    /* ★ R16（2026-09-29）：不再读全局 `userLevel` / `userLevelName`（已废弃）。
       等级是按课程分开定的，档案页只能展示"**最近一次**测评"，
       并且必须把它测的是哪门课一起显示出来 ——
       否则会跟学生说"你的学习等级是 S+"，却不说这是哪一科的，等于制造误解。 */
    const courseMap = {};
    (data.courses || []).forEach(c => { courseMap[c.id] = c.name; });
    const recentCourseId = wx.getStorageSync('userLevelRecentCourseId') || '';
    this.setData({
      totalKnowledge: total,
      level: wx.getStorageSync('userLevelRecent') || '',
      levelName: wx.getStorageSync('userLevelRecentName') || '',
      levelCourseName: recentCourseId ? (courseMap[recentCourseId] || recentCourseId) : ''
    });
    if (app.globalData.hasLogin) {
      this.setData({ hasLogin: true });
      this.loadReport();
      this.loadWeekly();
    }
  },

  // 读取最近一期学情周报 + 订阅状态
  loadWeekly() {
    wx.cloud.callFunction({ name: 'getWeeklyReport', data: { limit: 1 } })
      .then(res => {
        const r = res.result || {};
        this.setData({
          weekly: r.latest || null,
          subscribed: !!r.subscribed
        });
      })
      .catch(() => {});
  },

  // 订阅学情周报（对标学而思学情周报推送）
  onSubscribeWeekly() {
    if (this.data.subLoading) return;
    this.setData({ subLoading: true });

    const TEMPLATE_ID = config.weeklyTemplateId;
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: (res) => {
        if (res[TEMPLATE_ID] !== 'accept') {
          wx.showToast({ title: '已取消订阅', icon: 'none' });
          this.setData({ subLoading: false });
          return;
        }
        wx.cloud.callFunction({ name: 'subscribeWeekly', data: { count: 1, templateId: TEMPLATE_ID } })
          .then(() => {
            wx.showToast({ title: '订阅成功', icon: 'success' });
            this.setData({ subscribed: true, subLoading: false });
          })
          .catch(() => {
            wx.showToast({ title: '订阅失败，请重试', icon: 'none' });
            this.setData({ subLoading: false });
          });
      },
      fail: () => {
        wx.showToast({ title: '订阅失败，请重试', icon: 'none' });
        this.setData({ subLoading: false });
      }
    });
  },

  loadReport() {
    wx.cloud.callFunction({ name: 'getDashboard' }).then(res => {
      const d = (res.result && res.result.code === 0 && res.result.data) || {};
      const learned = d.learned || 0;
      const total = this.data.totalKnowledge || 1;
      const mastery = Math.round(learned / total * 100);
      this.setData({
        stats: { days: d.streak || 0, done: learned, wrongs: d.wrongCount || 0 },
        accuracy: d.accuracy || 0,
        mastery,
        achievements: d.achievements || [],
        weakPoints: d.weakPoints || [],
        calendar: d.calendar || [],
        activeDays: d.activeDays || 0
      });
      this.buildRecommend(d.weakPoints || []);
    }).catch(() => {});
  },

  buildRecommend(weakPoints) {
    wx.cloud.callFunction({ name: 'getUserProgress' }).then(res => {
      const learnedSet = {};
      const list = (res.result && res.result.list) || [];
      list.forEach(p => { learnedSet[p.itemId] = true; });

      const knowledge = data.knowledge || [];
      const courseMap = {};
      (data.courses || []).forEach(c => { courseMap[c.id] = c.name; });

      const recommend = [];
      weakPoints.forEach(w => {
        const items = knowledge.filter(k =>
          k.courseId === w.courseId && !learnedSet[k.id] && k.quiz
        );
        items.slice(0, 3).forEach(k => recommend.push({
          id: k.id,
          title: k.title,
          courseName: courseMap[k.courseId] || w.courseName || k.courseId
        }));
      });
      this.setData({ recommend: recommend.slice(0, 6) });
    }).catch(() => {});
  },

  goTeach(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/teach/teach?id=' + id });
  },

  goQuiz() {
    wx.navigateTo({ url: '/pages/quiz/quiz' });
  },

  goWrongbook() {
    wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
  },

  // 跳转到「我的」页触发登录
  goLogin() {
    wx.switchTab({ url: '/pages/profile/profile' });
  }
});
