const data = require('../../data/courses.js');
const app = getApp();
const { track } = require('../../utils/track.js');

Page({
  data: {
    systems: [],
    courses: [],
    progressMap: {},
    aiCourses: [],        // 已发布的 AI 生成课程（来自 getAICourses）
    expandedAi: '',       // 当前展开的 AI 课程 id
    showGen: false,
    genTopic: '',
    genLoading: false
  },
  onLoad() {
    this.setData({
      systems: data.systems || [],
      courses: data.courses || []
    });
  },
  onShow() {
    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({ name: 'getUserProgress' })
        .then(res => {
          if (res.result && res.result.list) {
            const map = {};
            res.result.list.forEach(item => {
              map[item.itemId] = true;
            });
            this.setData({ progressMap: map });
          }
        })
        .catch(() => {});
      this.loadAICourses();
    }
  },
  // 加载已审核通过的 AI 生成课程（消费端，打通生成→审核→上线链路）
  loadAICourses() {
    wx.cloud.callFunction({ name: 'getAICourses', data: { limit: 20 } })
      .then(res => {
        if (res.result && res.result.code === 0 && res.result.list) {
          const aiCourses = res.result.list.map(c => {
            // 归一化 chapters，便于展开预览
            const chapters = (c.content && c.content.chapters) || [];
            return Object.assign({}, c, {
              chapterList: chapters.map(ch => ({
                title: ch.title || '',
                items: (ch.items || []).map(it => (typeof it === 'string' ? it : it.title || it.id || ''))
              }))
            });
          });
          this.setData({ aiCourses });
        }
      })
      .catch(() => {});
  },
  toggleAi(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedAi: this.data.expandedAi === id ? '' : id });
  },
  goCourse(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/course/course?id=' + id });
  },

  // ===== AI 生成课程 =====
  openGen() {
    this.setData({ showGen: true, genTopic: '' });
  },
  closeGen() {
    this.setData({ showGen: false });
  },
  onGenInput(e) {
    this.setData({ genTopic: e.detail.value });
  },
  submitGen() {
    const topic = (this.data.genTopic || '').trim();
    if (!topic) {
      wx.showToast({ title: '请输入课程主题', icon: 'none' });
      return;
    }
    if (!app.globalData.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ genLoading: true });
    track('course_gen_submit', { topic });
    wx.cloud.callFunction({
      name: 'aiCourseGen',
      data: { topic, system: '国际课程', subject: '', level: '' }
    }).then(res => {
      this.setData({ genLoading: false, showGen: false });
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '已提交，待人工审核', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '提交失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ genLoading: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },
  noop() {}
});
