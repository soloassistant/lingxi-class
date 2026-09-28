const data = require('../../data/courses.js');
const app = getApp();

Page({
  data: {
    assignments: [],
    selectedMap: {},
    submittedMap: {}
  },

  onLoad() {
    // 对象版数据：knowledge 为条目数组，chapter.items 为对象数组（兼容旧字符串数组）
    const knowledge = data.knowledge || [];
    const assignments = [];
    (data.courses || []).forEach(course => {
      const chapter = (data.chapters || []).find(ch => ch.courseId === course.id);
      if (!chapter) return;
      (chapter.items || []).forEach(entry => {
        const entryId = typeof entry === 'string' ? entry : entry.id;
        const item = knowledge.find(it => it.id === entryId);
        if (item && item.quiz) {
          assignments.push({
            id: item.id,
            courseId: course.id,
            courseName: course.name,
            itemTitle: item.title,
            type: '课后练习',
            desc: '完成「' + item.title + '」的随堂测验，并确保答对全部题目。',
            quiz: item.quiz
          });
        }
      });
    });
    this.setData({ assignments });
  },

  selectOption(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.submittedMap[id]) return;
    const index = Number(e.currentTarget.dataset.index);
    const selectedMap = { ...this.data.selectedMap, [id]: index };
    this.setData({ selectedMap });
  },

  submit(e) {
    const id = e.currentTarget.dataset.id;
    const assignment = this.data.assignments.find(a => a.id === id);
    if (!assignment) return;

    const userAnswer = this.data.selectedMap[id];
    if (userAnswer === undefined) {
      wx.showToast({ title: '请先选择答案', icon: 'none' });
      return;
    }

    const submittedMap = { ...this.data.submittedMap, [id]: true };
    this.setData({ submittedMap });

    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({
        name: 'homeworkSubmit',
        data: {
          itemId: id,
          courseId: assignment.courseId,
          userAnswer,
          answerIndex: assignment.quiz.answerIndex,
          status: 'submitted'
        }
      }).catch(() => {});
    }

    wx.showToast({ title: '已提交', icon: 'success' });
    setTimeout(() => {
      wx.navigateTo({ url: '/pages/homework-review/homework-review?itemId=' + id });
    }, 600);
  }
});
