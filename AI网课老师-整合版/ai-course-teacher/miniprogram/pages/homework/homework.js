const data = require('../../data/courses.js');
const app = getApp();

Page({
  data: {
    assignments: [],
    selectedMap: {},
    submittedMap: {},
    // ★ R17：pickedMap 用来控制"写下思路"输入框的出现（WXML 里比 undefined 可靠）
    pickedMap: {},
    workMap: {}
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
    const pickedMap = { ...this.data.pickedMap, [id]: true };
    this.setData({ selectedMap, pickedMap });
  },

  // 可选：写下解题过程。有过程，讲评才被允许讨论错因（否则只讲"选项不符"）
  inputWork(e) {
    const id = e.currentTarget.dataset.id;
    const workMap = { ...this.data.workMap, [id]: e.detail.value };
    this.setData({ workMap });
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
      /* ★ R17：把**学生实际看到的那份题面**一起提交。
         服务端要拿它做两件事：
           ① 与 question_bank 按版本核对答案键（不再盲信客户端说的答案）；
           ② 讲评时把题干/选项/解析交给模型 —— 原来只给序号，模型只能编错因。
         另外把学生所选的**选项文字**也留在题面里即可，选项本身已经传了。 */
      wx.cloud.callFunction({
        name: 'homeworkSubmit',
        data: {
          itemId: id,
          courseId: assignment.courseId,
          courseName: assignment.courseName,
          question: assignment.quiz.question || '',
          options: assignment.quiz.options || [],
          answerIndex: assignment.quiz.answerIndex,
          explanation: assignment.quiz.explanation || '',
          userAnswer,
          studentWork: this.data.workMap[id] || '',
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
