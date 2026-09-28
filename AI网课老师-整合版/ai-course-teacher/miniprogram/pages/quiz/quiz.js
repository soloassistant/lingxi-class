const data = require('../../data/courses.js');
const app = getApp();
const { track } = require('../../utils/track.js');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

Page({
  data: {
    questions: [],
    answers: {},
    current: 0,
    submitted: false,
    score: 0,
    correctCount: 0,
    wrongList: [],
    level: '',
    levelName: '',
    // 诊断报告
    report: null,
    aiComment: '',
    aiCommentLoading: false,
    recommendPlan: []
  },

  onLoad(options) {
    const courseId = options.courseId || '';
    const courseMap = {};
    (data.courses || []).forEach(c => { courseMap[c.id] = c.name; });

    let pool = (data.knowledge || []).filter(k =>
      k.quiz && k.quiz.question && Array.isArray(k.quiz.options) && k.quiz.options.length > 0
    );
    if (courseId) pool = pool.filter(k => k.courseId === courseId);

    const picked = shuffle(pool).slice(0, 10);
    const questions = picked.map(k => ({
      id: k.id,
      courseId: k.courseId || '',
      courseName: courseMap[k.courseId] || k.courseId || '',
      question: k.quiz.question,
      options: k.quiz.options,
      answerIndex: k.quiz.answerIndex,
      explanation: k.quiz.explanation || ''
    }));

    this.setData({ questions, answers: {}, current: 0, submitted: false, score: 0, correctCount: 0, wrongList: [] });
    track('quiz_start', { courseId, total: questions.length });
  },

  select(e) {
    if (this.data.submitted) return;
    const idx = Number(e.currentTarget.dataset.idx);
    const opt = Number(e.currentTarget.dataset.opt);
    this.setData({ ['answers[' + idx + ']']: opt });
  },

  prev() {
    if (this.data.current > 0) this.setData({ current: this.data.current - 1 });
  },

  next() {
    if (this.data.current < this.data.questions.length - 1) this.setData({ current: this.data.current + 1 });
  },

  submit() {
    const { questions, answers } = this.data;
    if (questions.length === 0) return;
    const unanswered = questions.filter((q, i) => answers[i] === undefined).length;
    if (unanswered > 0) {
      wx.showModal({
        title: '还有 ' + unanswered + ' 题未作答',
        content: '未作答的题将计为答错，确定提交吗？',
        confirmText: '提交',
        success: r => { if (r.confirm) this.doSubmit(); }
      });
      return;
    }
    this.doSubmit();
  },

  doSubmit() {
    const { questions, answers } = this.data;
    let correctCount = 0;
    const wrongList = [];

    questions.forEach((q, i) => {
      const a = answers[i];
      if (a === q.answerIndex) {
        correctCount++;
        if (app.globalData.hasLogin) {
          wx.cloud.callFunction({
            name: 'saveProgress',
            data: { itemId: q.id, courseId: q.courseId }
          }).catch(() => {});
        }
      } else {
        wrongList.push(Object.assign({}, q, { userAnswer: a }));
        if (app.globalData.hasLogin) {
          wx.cloud.callFunction({
            name: 'saveWrong',
            data: {
              itemId: q.id,
              courseId: q.courseId,
              courseName: q.courseName,
              question: q.question,
              options: q.options,
              answerIndex: q.answerIndex,
              userAnswer: a,
              explanation: q.explanation,
              wrongType: '测评错题'
            }
          }).catch(() => {});
        }
      }
    });

    const total = questions.length;
    const score = total > 0 ? Math.round(correctCount / total * 100) : 0;

    // 学而思式定级：按得分分 A+/S/S+ 三档
    const level = score >= 85 ? 'S+' : (score >= 60 ? 'S' : 'A+');
    const levelName = score >= 85 ? '培优' : (score >= 60 ? '提升' : '基础');
    wx.setStorageSync('userLevel', level);
    wx.setStorageSync('userLevelName', levelName);
    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({
        name: 'saveLevel',
        data: { level, levelName, accuracy: score }
      }).catch(() => {});
    }

    this.setData({ submitted: true, score, correctCount, wrongList, level, levelName });

    // 埋点：测评完成（北极星指标：测评转化 + 定级分布）
    track('quiz_complete', { score, level, correctCount, total });

    // 生成诊断报告（能力雷达 + 专属学习方案）
    this.buildReport(questions, answers, score, level, levelName);
  },

  // 诊断报告：按课程维度分析正确率 + 生成专属学习路径
  buildReport(questions, answers, score, level, levelName) {
    const courseMap = {};
    (data.courses || []).forEach(c => { courseMap[c.id] = c.name; });

    // 1. 按课程维度统计正确率（能力雷达）
    const dims = {};
    questions.forEach((q, i) => {
      const key = q.courseId || '综合';
      if (!dims[key]) dims[key] = { courseId: q.courseId, courseName: q.courseName || courseMap[q.courseId] || '综合', total: 0, correct: 0 };
      dims[key].total++;
      if (answers[i] === q.answerIndex) dims[key].correct++;
    });
    const radar = Object.values(dims).map(d => ({
      courseId: d.courseId,
      courseName: d.courseName,
      accuracy: d.total > 0 ? Math.round(d.correct / d.total * 100) : 0
    })).sort((a, b) => a.accuracy - b.accuracy);

    // 2. 找出最薄弱的课程
    const weakest = radar.length ? radar[0] : null;

    // 3. 专属学习方案：优先推荐最薄弱课程下未学的知识点
    const weakCourseIds = radar.filter(r => r.accuracy < 70).map(r => r.courseId);
    const weakItems = (data.knowledge || []).filter(k => k.quiz && weakCourseIds.includes(k.courseId));
    const restItems = (data.knowledge || []).filter(k => k.quiz && !weakCourseIds.includes(k.courseId));
    const picked = [];
    const seen = {};
    weakItems.concat(restItems).forEach(k => {
      if (picked.length >= 5 || seen[k.id]) return;
      seen[k.id] = true;
      picked.push(k);
    });
    const recommendPlan = picked.map(k => ({
      id: k.id,
      title: k.title,
      courseId: k.courseId,
      courseName: courseMap[k.courseId] || k.courseId,
      isWeak: weakCourseIds.includes(k.courseId)
    }));

    const report = {
      score,
      level,
      levelName,
      radar,
      weakest,
      weakCount: radar.filter(r => r.accuracy < 70).length,
      suggestHours: score >= 85 ? '每周 4-5 小时，主攻综合题' : (score >= 60 ? '每周 6-8 小时，重点补薄弱项' : '每周 8-10 小时，从基础开始')
    };
    this.setData({ report, recommendPlan });

    // 4. AI 点评（可选，登录且有 AI 能力时）
    this.generateComment(radar, weakest, score, levelName);
  },

  // AI 生成个性化诊断点评
  generateComment(radar, weakest, score, levelName) {
    if (!app.globalData.hasLogin) return;
    const weakStr = radar.slice(0, 3).map(r => r.courseName + ' ' + r.accuracy + '%').join('、');
    this.setData({ aiCommentLoading: true });
    wx.cloud.callFunction({
      name: 'aiProxy',
      data: {
        prompt: '你是学习诊断老师。学生测评得分 ' + score + ' 分（等级 ' + levelName + '）。各科正确率：' + (weakStr || '无') + '。请用 80 字以内，给出 2-3 条具体、可执行的改进建议，语气鼓励但不空洞。直接输出文字，不要 JSON。',
        fallback: null
      }
    }).then(res => {
      const r = res.result || {};
      let comment = '';
      if (r.code === 0 && r.data) {
        comment = r.data.content || r.data.text || r.data.reply || '';
      }
      this.setData({ aiComment: comment, aiCommentLoading: false });
    }).catch(() => {
      this.setData({ aiCommentLoading: false });
    });
  },

  restart() {
    this.onLoad({});
  },

  goWrongbook() {
    wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
  },

  goTeach(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/teach/teach?id=' + id });
  },

  // 分享成绩（裂变：好友点开即进测评）
  onShareAppMessage() {
    const score = this.data.score;
    const level = this.data.levelName || '';
    return {
      title: '我在 AI 网课老师测评得了 ' + score + ' 分（' + level + '），来测测你的水平！',
      path: '/pages/quiz/quiz'
    };
  },

  onShareTimeline() {
    const score = this.data.score;
    return {
      title: '免费 AI 入学诊断，测出你的真实水平',
      query: ''
    };
  }
});
