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
    /* ★ R16：诊断必须先选定范围（体系 → 课程），不再跨体系随机混题 */
    needScope: false,
    systems: [],
    scopeSystemId: '',
    scopeCourses: [],
    scopeCourseId: '',
    scopeEmpty: false,
    // 诊断报告
    report: null,
    aiComment: '',
    aiCommentLoading: false,
    recommendPlan: []
  },

  onLoad(options) {
    const courseId = options.courseId || '';
    /* ★ 2026-09-29 修（外部审查 R16，P2）：
       原来 courseId 为空时，出题池就是**全部 176 个知识点** ——
       横跨雅思 / 托福 / SAT / IGCSE / A-Level / AP / IB 七个体系，
       随机抽 10 题，再把这次总分变成一个**全局** `userLevel`，
       而所有课程的授课都读这个全局值。
       后果：学生在雅思上考得好，数学课的难度也跟着变；这两个体系毫无关系。
       现在必须先选范围；没带 courseId 就进"选范围"步骤，绝不静默混题。 */
    if (!courseId) {
      this.setData({ needScope: true, systems: (data.systems || []), scopeCourses: [], scopeSystemId: '', scopeEmpty: false });
      track('quiz_need_scope', {});
      return;
    }
    this.startQuiz(courseId);
  },

  /* 选体系 → 列出该体系下的课程 */
  pickScopeSystem(e) {
    const systemId = e.currentTarget.dataset.id;
    const courses = (data.courses || []).filter(c => c && c.systemId === systemId);
    this.setData({ scopeSystemId: systemId, scopeCourses: courses, scopeEmpty: false });
    track('quiz_pick_system', { systemId });
  },

  /* 回到体系列表（选错体系、或这门课没有题时可退回来） */
  backToSystems() {
    this.setData({ scopeSystemId: '', scopeCourses: [], scopeEmpty: false, scopeCourseId: '' });
  },

  /* 选定课程 → 开始该范围的诊断 */
  pickScopeCourse(e) {
    const courseId = e.currentTarget.dataset.id;
    if (!courseId) return;
    this.startQuiz(courseId);
  },

  startQuiz(courseId) {
    const courseMap = {};
    (data.courses || []).forEach(c => { courseMap[c.id] = c.name; });

    /* ★ 范围限定：只在**这一门课**的知识点里抽题。
       原来这里在 courseId 为空时不做过滤 —— 那就是"跨体系混题"的入口。 */
    const pool = (data.knowledge || []).filter(k =>
      k.quiz && k.quiz.question && Array.isArray(k.quiz.options) && k.quiz.options.length > 0 &&
      k.courseId === courseId
    );

    if (!pool.length) {
      // 这门课还没有配好的题目：如实说明，不要拿别的体系的题来凑
      this.setData({ needScope: true, scopeEmpty: true, scopeCourseId: courseId });
      track('quiz_scope_empty', { courseId });
      return;
    }

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

    this.setData({
      needScope: false, scopeCourseId: courseId, scopeEmpty: false,
      questions, answers: {}, current: 0, submitted: false,
      score: 0, correctCount: 0, wrongList: [], report: null, recommendPlan: [], aiComment: ''
    });
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
    /* ★ R16：没有题、或没有范围，就不是一次有效测评。
       不加这道守卫的话，空卷会算出 score=0 / level=A+，
       还会把它当成"最近一次测评"写进 storage —— 一个没范围、没意义的等级。 */
    if (!questions.length || !this.data.scopeCourseId) return;
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
    /* ★ R16：等级**按范围存**。
       原来只存一个全局 `userLevel`，而所有课程的授课都读它 ——
       于是在雅思上测出来的等级会改数学课的难度。
       现在键是 `userLevel:<courseId>`；另存一份 `userLevelRecent*` 仅供
       "最近一次测评"展示（档案页），明确它不代表性能力定级。
       全局 `userLevel` 不再写入 —— 留着的话读它的地方又会退回跨范围误用。 */
    const scopeKey = this.data.scopeCourseId || '';
    if (scopeKey) {
      try {
        wx.setStorageSync('userLevel:' + scopeKey, level);
        wx.setStorageSync('userLevelName:' + scopeKey, levelName);
      } catch (e) {}
    }
    try {
      wx.setStorageSync('userLevelRecent', level);
      wx.setStorageSync('userLevelRecentName', levelName);
      wx.setStorageSync('userLevelRecentCourseId', scopeKey);
    } catch (e) {}
    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({
        name: 'saveLevel',
        data: { level, levelName, accuracy: score, courseId: scopeKey }
      }).catch(() => {});
    }

    this.setData({ submitted: true, score, correctCount, wrongList, level, levelName });

    // 埋点：测评完成（北极星指标：测评转化 + 定级分布）
    track('quiz_complete', { score, level, correctCount, total, courseId: scopeKey });

    /* ★ R16：推荐前**读已学记录**。
       原来注释写着"优先推荐未学的知识点"，但代码从没读过已学记录 ——
       推的都是同一批（哪怕已经学过）。登录时拉一次 progress。 */
    const build = (learnedSet) => this.buildReport(questions, answers, score, level, levelName, learnedSet);
    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({ name: 'getUserProgress' }).then(res => {
        const list = (res && res.result && res.result.list) || [];
        const learned = {};
        list.forEach(p => { if (p && p.itemId) learned[p.itemId] = true; });
        build(learned);
      }).catch(() => build(null));
    } else {
      build(null);
    }
  },

  // 诊断报告：按课程维度分析正确率 + 生成专属学习路径
  buildReport(questions, answers, score, level, levelName, learnedSet) {
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
    /* ★ R16 连带修（2026-09-29）：推荐池也必须限定在**本次诊断的那门课**里。
       原来 restItems 取的是"所有不在薄弱课程里的知识点" ——
       那等于把全部 22 门课的题都当候选：在雅思听力的诊断报告里
       会推荐 A-Level 力学、AP 统计。范围化出题只修了题面，推荐却还在跨体系。
       而且雷达现在只有一门课：得分 ≥70 时 weakCourseIds 为空，
       restItems 直接等于全量 —— 这条路径最容易漏。 */
    const scope = this.data.scopeCourseId || '';
    const scopeItems = (data.knowledge || []).filter(k =>
      k.quiz && k.quiz.question && Array.isArray(k.quiz.options) && k.quiz.options.length > 0 &&
      (!scope || k.courseId === scope)
    );
    const weakCourseIds = radar.filter(r => r.accuracy < 70).map(r => r.courseId);
    const weakItems = scopeItems.filter(k => weakCourseIds.includes(k.courseId));
    const restItems = scopeItems.filter(k => !weakCourseIds.includes(k.courseId));
    /* ★ R16：注释一直写着"优先推荐**未学**的知识点"，但代码从没读过已学记录。
       现在真的读（learnedSet 来自 getUserProgress）；拿不到时按"未知"处理，
       不假装读过 —— 把已学的排在后面，而不是当作没学过。 */
    const isLearned = (k) => !!(learnedSet && learnedSet[k.id]);
    const sortUnlearnedFirst = (arr) => arr.slice().sort((a, b) => {
      const la = isLearned(a) ? 1 : 0, lb = isLearned(b) ? 1 : 0;
      return la - lb;
    });
    const picked = [];
    const seen = {};
    sortUnlearnedFirst(weakItems).concat(sortUnlearnedFirst(restItems)).forEach(k => {
      if (picked.length >= 5 || seen[k.id]) return;
      seen[k.id] = true;
      picked.push(k);
    });
    const recommendPlan = picked.map(k => ({
      id: k.id,
      title: k.title,
      courseId: k.courseId,
      courseName: courseMap[k.courseId] || k.courseId,
      isWeak: weakCourseIds.includes(k.courseId),
      learned: isLearned(k)          // 让界面能如实标注"你学过这个了"
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
