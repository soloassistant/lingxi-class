const app = getApp();
const { track } = require('../../utils/track.js');

Page({
  data: {
    showPrivacy: false,
    darkMode: false,
    fontScale: '16px',
    T: {},
    langText: 'EN',
    nickname: '',
    dashboardLoading: true,
    streakDays: 0,
    learnedCount: 0,
    totalCount: 1,
    accuracy: 0,
    todayTasks: [],
    achievements: [],
    weakPoints: [],
    courses: []
  },

  onLoad() {
    // 隐私弹窗（补丁1 已内置）
    const agreed = wx.getStorageSync('privacy_agreed');
    if (!agreed) {
      this.setData({ showPrivacy: true });
    }
  },

  onShow() {
    this.applyTheme();
    this.applyLang();
    this.loadDashboard();
    this.loadCourses();
  },
  applyTheme() {
    // 与 settings 页约定对齐：theme 'dark'|'light'，fontSize 'small'|'medium'|'large'
    const theme = wx.getStorageSync('theme');
    const fontSize = wx.getStorageSync('fontSize') || 'medium';
    const darkMode = theme === 'dark';
    const fontScale = fontSize === 'small' ? '14px' : (fontSize === 'large' ? '18px' : '16px');
    this.setData({ darkMode, fontScale });
  },

  applyLang() {
    const lang = wx.getStorageSync('lang') || 'zh';
    this.setData({
      T: require('../../i18n/' + lang + '.js'),
      langText: lang === 'zh' ? 'EN' : '中'
    });
  },

  loadDashboard() {
    this.setData({ dashboardLoading: true });
    if (!app.globalData.hasLogin) {
      this.setData({ dashboardLoading: false });
      this.buildTodayTasks();
      return;
    }
    wx.cloud.callFunction({
      name: 'getDashboard'
    }).then(res => {
      const d = (res.result && res.result.code === 0 && res.result.data) || {};
      const data = require('../../data/courses.js');
      const totalCount = (data.knowledge || []).length || 1;
      track('dashboard_load', { streak: d.streak || 0, learned: d.learned || 0 });
      this.setData({
        dashboardLoading: false,
        streakDays: d.streak || 0,
        learnedCount: d.learned || 0,
        totalCount,
        accuracy: d.accuracy || 0,
        achievements: d.achievements || [],
        weakPoints: d.weakPoints || []
      });
      // 薄弱点拿到后再生成个性化今日任务
      this.buildTodayTasks();
    }).catch(() => {
      this.setData({ dashboardLoading: false });
      this.buildTodayTasks();
    });
  },

  loadCourses() {
    const data = require('../../data/courses.js');
    const courses = (data.courses || []).slice(0, 8).map(c => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji || '📚',
      progress: c.progress || 0
    }));
    this.setData({ courses });
  },

  buildTodayTasks() {
    const data = require('../../data/courses.js');
    const knowledge = data.knowledge || [];
    const courseMap = {};
    (data.courses || []).forEach(c => { courseMap[c.id] = c.name; });

    // 个性化：优先推荐薄弱课程下未学的知识点
    const weakCourseIds = (this.data.weakPoints || []).map(w => w.courseId);
    const weak = knowledge.filter(k => k.quiz && weakCourseIds.includes(k.courseId));
    const rest = knowledge.filter(k => k.quiz && !weakCourseIds.includes(k.courseId));

    // 薄弱优先，其次补足；去重后取前 3
    const picked = [];
    const seen = {};
    weak.concat(rest).forEach(k => {
      if (picked.length >= 3 || seen[k.id]) return;
      seen[k.id] = true;
      picked.push(k);
    });

    const todayTasks = picked.map(k => ({
      knowledgeId: k.id,
      title: k.title,
      courseName: courseMap[k.courseId] || k.courseId || '',
      isWeak: weakCourseIds.includes(k.courseId)
    }));
    this.setData({ todayTasks });
  },

  onPrivacyAgree() {
    this.setData({ showPrivacy: false });
  },

  noop() {},

  toggleLang() {
    const lang = wx.getStorageSync('lang') || 'zh';
    const next = lang === 'zh' ? 'en' : 'zh';
    wx.setStorageSync('lang', next);
    this.applyLang();
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goQuiz() {
    wx.navigateTo({ url: '/pages/quiz/quiz' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },

  goHomework() {
    wx.navigateTo({ url: '/pages/homework/homework' });
  },

  goCourses() {
    wx.switchTab({ url: '/pages/courses/courses' });
  },

  goCourse(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/course/course?id=' + id });
  },

  goLesson(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/teach/teach?id=' + id });
  },

  // 首页分享（获客主入口）
  onShareAppMessage() {
    return {
      title: 'AI 网课老师：雅思/托福/A-Level/IB 免费学，AI 一对一授课',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'AI 网课老师：7 大国际课程体系，免费 AI 一对一授课'
    };
  }
});
