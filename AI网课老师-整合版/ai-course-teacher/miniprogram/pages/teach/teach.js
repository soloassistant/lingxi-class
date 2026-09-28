const app = getApp();
const tts = require('../../utils/tts.js');
const { track } = require('../../utils/track.js');

Page({
  data: {
    darkMode: false,
    fontScale: '16px',
    lang: 'zh',
    T: {},
    item: {},
    currentBody: '',
    currentQuiz: {},
    selected: -1,
    showAnswer: false,
    aiExplainText: '',
    aiExplainLoading: false,
    showAsk: false,
    askText: '',
    aiReply: '',
    aiReplyLoading: false,
    chatHistory: [],
    aiMode: false,
    aiLoading: false,
    aiSections: [],
    aiIdx: 0,
    aiSummary: '',
    speaking: false
  },

  onLoad(options) {
    const id = options.id || '';
    this.applyTheme();
    this.applyLang();
    this.loadKnowledge(id);
  },

  applyTheme() {
    const theme = wx.getStorageSync('theme');
    const fontSize = wx.getStorageSync('fontSize') || 'medium';
    this.setData({
      darkMode: theme === 'dark',
      fontScale: fontSize === 'small' ? '14px' : (fontSize === 'large' ? '18px' : '16px')
    });
  },

  applyLang() {
    const lang = wx.getStorageSync('lang') || 'zh';
    this.setData({ lang, T: require('../../i18n/' + lang + '.js') });
  },

  loadKnowledge(id) {
    const all = require('../../data/courses.js');
    const list = all.knowledge || [];
    const item = list.find(k => k.id === id) || {};
    this.switchLangBody(item, this.data.lang);
    this.setData({ item });
  },

  switchLangBody(item, lang) {
    const body = lang === 'en' && item.enBody ? item.enBody : item.body;
    const quiz = lang === 'en' && item.enQuiz ? item.enQuiz : item.quiz;
    this.setData({ currentBody: body, currentQuiz: quiz, selected: -1, showAnswer: false, aiExplainText: '' });
  },

  setLang(e) {
    const lang = e.currentTarget.dataset.lang;
    this.setData({ lang });
    this.switchLangBody(this.data.item, lang);
  },

  selectOption(e) {
    if (this.data.showAnswer) return;
    const index = e.currentTarget.dataset.index;
    this.setData({ selected: index, showAnswer: true, aiExplainText: '' });
    const correct = index === this.data.currentQuiz.answerIndex;

    // 埋点：随堂作答结果
    track('quiz_answer', { itemId: this.data.item.id, correct });

    if (!app.globalData.hasLogin) return;

    if (correct) {
      // 答对：上报学习进度
      wx.cloud.callFunction({
        name: 'saveProgress',
        data: { itemId: this.data.item.id, courseId: this.data.item.courseId || '' }
      }).catch(() => {});
    } else {
      // 答错才记错题（带完整字段）
      wx.cloud.callFunction({
        name: 'saveWrong',
        data: {
          itemId: this.data.item.id,
          courseId: this.data.item.courseId || '',
          courseName: this.data.item.courseName || '',
          question: this.data.currentQuiz.question,
          options: this.data.currentQuiz.options,
          answerIndex: this.data.currentQuiz.answerIndex,
          userAnswer: index,
          explanation: this.data.currentQuiz.explanation || '',
          wrongType: '概念不清'
        }
      }).catch(() => {});
    }
  },

  // AI 讲解（答错后可点击）
  aiExplain() {
    const q = this.data.currentQuiz;
    if (!q || !q.question) return;
    this.setData({ aiExplainLoading: true });
    track('ai_explain', { itemId: this.data.item.id });
    wx.cloud.callFunction({
      name: 'aiExplain',
      data: {
        question: q.question,
        userAnswer: q.options && q.options[this.data.selected],
        correctAnswer: q.options && q.options[q.answerIndex],
        explanation: q.explanation || ''
      }
    }).then(res => {
      if (res.result && res.result.code === 0 && res.result.data && res.result.data.content) {
        this.setData({ aiExplainText: res.result.data.content, aiExplainLoading: false });
      } else {
        this.setData({ aiExplainLoading: false });
        wx.showToast({ title: 'AI 讲解暂不可用', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ aiExplainLoading: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  // 向 AI 提问
  openAsk() {
    this.setData({ showAsk: true, askText: '', aiReply: '' });
  },
  closeAsk() {
    this.setData({ showAsk: false });
  },
  onAskInput(e) {
    this.setData({ askText: e.detail.value });
  },
  submitAsk() {
    const question = (this.data.askText || '').trim();
    if (!question) {
      wx.showToast({ title: '请输入问题', icon: 'none' });
      return;
    }
    if (!app.globalData.hasLogin) {
      // 游客降级：本地提示，不硬拦
      const chatHistory = this.data.chatHistory.concat([
        { role: 'user', content: question },
        { role: 'assistant', content: '这是游客模式。登录后即可向 AI 老师随时提问，获得针对当前知识点的即时答疑。' }
      ]);
      this.setData({ chatHistory, askText: '' });
      return;
    }
    // 多轮对话：把历史消息作为上下文传给云函数
    const history = (this.data.chatHistory || []).map(h => ({
      role: h.role,
      content: h.content
    }));
    const chatHistory = this.data.chatHistory.concat([{ role: 'user', content: question }]);
    this.setData({ aiReplyLoading: true, chatHistory, askText: '' });
    track('ai_interject', { itemId: this.data.item.id });
    wx.cloud.callFunction({
      name: 'aiInterject',
      data: {
        itemId: this.data.item.id,
        topic: this.data.item.title || '',
        question,
        history
      }
    }).then(res => {
      const reply = (res.result && res.result.code === 0 && res.result.reply) || 'AI 暂不可用';
      this.setData({
        aiReply: reply,
        aiReplyLoading: false,
        chatHistory: this.data.chatHistory.concat([{ role: 'assistant', content: reply }])
      });
    }).catch(() => {
      this.setData({ aiReplyLoading: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  next() {
    this.setData({ selected: -1, showAnswer: false, aiExplainText: '' });
  },

  // ===== AI 授课模式（接线 aiTeach，实现"AI 老师逐段讲课 + 板书"）=====
  startAiTeach() {
    if (!app.globalData.hasLogin) {
      // 游客降级：用本地讲义正文当作"讲解"，不硬拦
      this.startLocalTeach();
      return;
    }
    const item = this.data.item || {};
    const level = wx.getStorageSync('userLevel') || 'S';
    this.setData({ aiLoading: true });
    track('ai_teach_start', { itemId: item.id, level });
    wx.cloud.callFunction({
      name: 'aiTeach',
      data: {
        topic: item.title || item.id || '',
        subject: item.courseName || item.courseId || '',
        system: '国际课程',
        level: level
      }
    }).then(res => {
      const r = res.result;
      this.setData({ aiLoading: false });
      const data = (r && r.code === 0 && r.data) || (r && r.fallback);
      if (data && Array.isArray(data.sections) && data.sections.length > 0) {
        // 板书：text 步骤渲染为要点文字，line/rect 步骤渲染为 SVG 图形（保留坐标）
        const sections = data.sections.map(s => {
          const steps = (s.board && s.board.steps) || [];
          const textSteps = steps.filter(st => st.text).map(st => st.text);
          const shapes = steps.filter(st => (st.type === 'line' || st.type === 'rect') && st.x !== undefined);
          return { text: s.text || '', steps: textSteps, shapes };
        });
        this.setData({
          aiMode: true,
          aiSections: sections,
          aiIdx: 0,
          aiSummary: data.summary || ''
        });
      } else {
        wx.showToast({ title: (r && r.msg) || 'AI 讲解生成失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ aiLoading: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  aiPrev() {
    if (this.data.aiIdx > 0) this.setData({ aiIdx: this.data.aiIdx - 1 });
  },
  aiNext() {
    if (this.data.aiIdx < this.data.aiSections.length - 1) this.setData({ aiIdx: this.data.aiIdx + 1 });
  },
  exitAi() {
    this.setData({ aiMode: false, aiSections: [], aiIdx: 0, aiSummary: '' });
    tts.stop();
    this.setData({ speaking: false });
  },

  // 游客本地降级讲解：把讲义正文拆成段落，模拟"逐段讲解"体验
  startLocalTeach() {
    const body = this.data.currentBody || this.data.item.body || '';
    if (!body) {
      wx.showToast({ title: '暂无讲解内容', icon: 'none' });
      return;
    }
    // 按句号/换行拆成段落
    const parts = body.split(/[。；;\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    const sections = parts.map(p => ({ text: p, steps: [], shapes: [] }));
    if (sections.length === 0) sections.push({ text: body, steps: [], shapes: [] });
    this.setData({
      aiMode: true,
      aiSections: sections,
      aiIdx: 0,
      aiSummary: '（游客模式 · 登录后可体验 AI 老师个性化讲解）'
    });
    wx.showToast({ title: '已进入讲解模式（游客）', icon: 'none' });
  },

  // 朗读讲义正文
  speakBody() {
    /* 同样补上失败提示：原来失败是静默的，用户以为"点了没反应"。 */
    tts.speak(this.data.currentBody, {
      onFail: (reason, msg) => {
        wx.showModal({ title: '语音播不出来', content: msg, showCancel: false, confirmText: '知道了' });
      }
    });
  },

  // 朗读 AI 讲解（从当前段连续讲到底，再点停止）
  toggleSpeak() {
    if (this.data.speaking) {
      tts.stop();
      this.setData({ speaking: false });
    } else {
      this.playFrom(this.data.aiIdx);
    }
  },

  playFrom(idx) {
    const sec = this.data.aiSections[idx];
    if (!sec || !sec.text) {
      this.setData({ speaking: false });
      return;
    }
    this.setData({ speaking: true, aiIdx: idx });
    tts.speak(sec.text, {
      onEnd: () => {
        if (idx < this.data.aiSections.length - 1) {
          this.playFrom(idx + 1);
        } else {
          this.setData({ speaking: false });
        }
      },
      /* ★ 2026-09-28 补：原来没有 onFail —— 插件不可用时 tts 会立刻回调 onEnd，
         于是"同步递归"把每一段都当作播完了、最后按钮复位，**用户全程听不到声音却没有任何提示**。
         现在失败就停下来并把原因说清楚，而不是假装播完。 */
      onFail: (reason, msg) => {
        this.setData({ speaking: false });
        wx.showModal({
          title: '语音播不出来',
          content: msg,
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  noop() {}
});
