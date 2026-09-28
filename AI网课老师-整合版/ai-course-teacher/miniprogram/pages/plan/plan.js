const data = require('../../data/courses.js');
const app = getApp();
const { track } = require('../../utils/track.js');

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function getDaysLeft(targetDateStr) {
  const now = new Date();
  const target = new Date(targetDateStr);
  const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

Page({
  data: {
    todayTasks: [],
    weekPlan: [],
    roadmap: [],
    weakPoints: [],
    aiAdvice: '',
    showGoalModal: false,
    systems: [],
    systemIndex: 0,
    targetDate: '2026-12-01',
    goal: null
  },

  onLoad() {
    const systems = data.systems.map(s => s);
    const target = new Date();
    target.setDate(target.getDate() + 90);
    this.setData({
      systems,
      targetDate: formatDate(target)
    });
    this.buildCourseMap();
  },

  onShow() {
    if (!this.data.courseMap) this.buildCourseMap();

    if (app.globalData.hasLogin) {
      this.loadCloudPlan();
    } else {
      this.loadLocalPlan();
    }
  },

  buildCourseMap() {
    const map = {};
    data.chapters.forEach(ch => {
      (ch.items || []).forEach(entry => {
        const itemId = typeof entry === 'string' ? entry : entry.id;
        map[itemId] = ch.courseId;
      });
    });
    this.courseMap = map;
    this.setData({ courseMap: map });
  },

  loadLocalPlan() {
    const knowledge = data.knowledge || [];
    const tasks = [];
    data.courses.forEach(course => {
      const chapter = data.chapters.find(ch => ch.courseId === course.id);
      if (!chapter) return;
      (chapter.items || []).forEach(entry => {
        const itemId = typeof entry === 'string' ? entry : entry.id;
        const item = knowledge.find(it => it.id === itemId);
        if (item) {
          tasks.push({
            id: item.id,
            title: item.title,
            courseId: course.id,
            courseName: course.name
          });
        }
      });
    });

    // 今日任务：取前 3 个
    const todayTasks = tasks.slice(0, 3);

    // 本周计划：周一到周日，每个任务分配到 7 天
    const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const weekPlan = weekDays.map((day, index) => ({
      day,
      tasks: tasks.slice(index * 3, index * 3 + 3)
    }));

    // 默认 90 天路线图
    const daysLeft = getDaysLeft(this.data.targetDate);
    const roadmap = [
      { stage: '基础巩固', days: '第 1-' + Math.floor(daysLeft * 0.25) + ' 天', status: 'current' },
      { stage: '核心突破', days: '第 ' + (Math.floor(daysLeft * 0.25) + 1) + '-' + Math.floor(daysLeft * 0.5) + ' 天', status: '' },
      { stage: '强化练习', days: '第 ' + (Math.floor(daysLeft * 0.5) + 1) + '-' + Math.floor(daysLeft * 0.75) + ' 天', status: '' },
      { stage: '模考冲刺', days: '第 ' + (Math.floor(daysLeft * 0.75) + 1) + '-' + daysLeft + ' 天', status: '' }
    ];

    // 薄弱点：取 2 个有 quiz 的 item
    const weakPoints = (data.knowledge || [])
      .filter(it => it.quiz)
      .slice(0, 2)
      .map(it => ({
        title: it.title,
        courseId: this.courseMap[it.id] || ''
      }));

    this.setData({ todayTasks, weekPlan, roadmap, weakPoints });

    // 生成 AI 建议
    this.refreshAdvice();
  },

  loadCloudPlan() {
    wx.cloud.callFunction({ name: 'getRoadmap' })
      .then(res => {
        const d = res.result && res.result.code === 0 && res.result.data;
        // 云端返回 AI 规划（路线图 + 今日任务 + 薄弱点 + 建议）时直接用，否则回退本地
        if (d && d.roadmap && d.roadmap.length > 0) {
          this.setData({
            targetDate: d.examDate || this.data.targetDate,
            roadmap: d.roadmap,
            todayTasks: (d.todayTasks && d.todayTasks.length > 0) ? d.todayTasks : this.data.todayTasks,
            weakPoints: d.weakPoints || [],
            aiAdvice: d.suggestion || ''
          });
          if (!d.suggestion) this.refreshAdvice();
        } else {
          if (d && d.examDate) this.setData({ targetDate: d.examDate });
          this.loadLocalPlan();
        }
      })
      .catch(() => this.loadLocalPlan());
  },

  openGoalModal() {
    this.setData({ showGoalModal: true });
  },

  closeGoalModal() {
    this.setData({ showGoalModal: false });
  },

  noop() {},

  onSystemChange(e) {
    this.setData({ systemIndex: Number(e.detail.value) });
  },

  onDateChange(e) {
    this.setData({ targetDate: e.detail.value });
  },

  saveGoal() {
    const systemIndex = this.data.systemIndex;
    const targetDate = this.data.targetDate;

    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({
        name: 'submitGoal',
        data: { systemId: this.data.systems[systemIndex].id, examDate: targetDate }
      }).catch(() => {});
    }

    this.setData({
      goal: {
        systemName: this.data.systems[systemIndex].name,
        date: targetDate,
        daysLeft: getDaysLeft(targetDate)
      },
      showGoalModal: false
    });
    track('goal_set', { system: this.data.systems[systemIndex].id, examDate: targetDate });
    wx.showToast({ title: '目标已设定', icon: 'success' });
    this.loadLocalPlan();
  },

  startTask(e) {
    const itemId = e.currentTarget.dataset.id;
    const courseId = this.data.courseMap[itemId];
    if (courseId) {
      wx.navigateTo({ url: '/pages/course/course?id=' + courseId });
    } else {
      wx.showToast({ title: '未知任务', icon: 'none' });
    }
  },

  goCourse(e) {
    const courseId = e.currentTarget.dataset.id;
    if (courseId) {
      wx.navigateTo({ url: '/pages/course/course?id=' + courseId });
    }
  },

  refreshAdvice() {
    const adviceList = [
      '根据你的学习节奏，建议每天固定 30 分钟完成 1 个知识点，周末用 45 分钟做一次综合练习。',
      '薄弱点预警显示你在「' + (this.data.weakPoints[0] ? this.data.weakPoints[0].title : '当前知识') + '」上有提升空间。先回归基础，再挑战变式题。',
      '学习路线图提醒你：前期打好基础，中期多做真题，最后冲刺模考，循序渐进最重要。',
      '保持每日打卡，连续学习可以提升记忆保留率。今天先完成 3 个小任务，让大脑轻松启动。'
    ];
    const index = Math.floor(Math.random() * adviceList.length);
    this.setData({ aiAdvice: adviceList[index] });
  }
});
