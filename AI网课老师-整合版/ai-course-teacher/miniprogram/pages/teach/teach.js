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
    /* ★ R13：区分"老师的回答"与"刚才那次没成功"。错误不再伪装成老师的回答。 */
    aiError: '',
    lastAsk: '',
    chatHistory: [],
    aiMode: false,
    aiLoading: false,
    aiSections: [],
    aiIdx: 0,
    aiSummary: '',
    speaking: false,
    /* ===== 费曼学习法（2026-10-01 新增）=====
       feynman     —— 课堂内教学法开关（与元认知类似的可选教学方式）
       feynmanCheck—— AI 生成的一句"轮到你讲了"的任务，渲染成卡片
       feynTalk*   —— 课后「讲给我听」环节的独立会话状态 */
    feynman: false,
    feynmanCheck: '',
    feynTalkMode: false,
    feynTalkMsgs: [],
    feynTalkInput: '',
    feynTalkBusy: false,
    feynTalkDone: false,
    feynTalkVerdict: null,
    /* ★ 与 R13 同一条纪律：失败要**看得出来是失败**，不能伪装成听众的提问 */
    feynTalkError: ''
  },

  onLoad(options) {
    const id = options.id || '';
    this.applyTheme();
    this.applyLang();
    this.restoreFeynman();
    this.loadKnowledge(id);
  },

  /* 费曼开关的持久化：读不到/读坏了都保持关闭（它是额外要求，不该默认开） */
  restoreFeynman() {
    let on = false;
    try { on = wx.getStorageSync('feynman') === true; } catch (e) {}
    this.setData({ feynman: on });
  },

  toggleFeynman() {
    const on = !this.data.feynman;
    this.setData({ feynman: on });
    try { wx.setStorageSync('feynman', on); } catch (e) {}
    wx.showToast({
      title: on ? '已开启费曼学习法：讲完会让你自己讲一遍' : '已关闭费曼学习法',
      icon: 'none'
    });
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
        data: { itemId: this.data.item.id, courseId: this.data.item.courseId || '', graded: true, source: 'lesson' }
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
          wrongType: '概念不清',
          source: 'lesson'
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
    /* lastAsk 留一份，供"重试"用；aiError 先清空（新一轮提问不该带着上一次的错误） */
    this.setData({ aiReplyLoading: true, chatHistory, askText: '', lastAsk: question, aiError: '' });
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
      const r = (res && res.result) || {};
      /* ★ 2026-09-29 修（外部审查 R13）：
         原来失败时把「AI 暂不可用」当成**老师的回答**塞进 aiReply 与 chatHistory ——
         学生看到的是"老师说了这句话"，而且它会作为上下文传给下一轮、被当成教学内容。
         现在失败分开处理：显示可重试的错误气泡，message 明确说"这不是老师的回答"，
         并且**不写进 chatHistory**（否则下一轮会把错误提示喂给模型）。 */
      if (r.code !== 0 || !r.reply) {
        this.setData({
          aiReplyLoading: false,
          aiError: r.msg || '老师暂时没能回答，请稍后再问一次'
        });
        track('ai_interject_failed', { itemId: this.data.item.id, code: r.code || 0 });
        return;
      }
      const reply = r.reply;
      this.setData({
        aiReply: reply,
        aiError: '',
        aiReplyLoading: false,
        chatHistory: this.data.chatHistory.concat([{ role: 'assistant', content: reply }])
      });
    }).catch(() => {
      this.setData({ aiReplyLoading: false, aiError: '网络异常，请检查网络后重试' });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  /* 重试上一次提问（失败后给了可重试的入口，而不是让学生重新打一遍字） */
  retryAsk() {
    const q = this.data.lastAsk;
    if (!q) return;
    this.setData({ aiError: '' });
    this.ask(q);
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
    /* ★ R16（2026-09-29）：授课等级必须按**这门课**读，不能再读全局 `userLevel`。
       全局键已经废弃（quiz 页只写 `userLevel:<courseId>`）。
       这里显式不读全局键 —— 万一读到旧版本残留值，就又变成"雅思的等级决定数学难度"。
       这门课没测过就用默认 S（中档），并在埋点里标出 levelSource，便于核对。 */
    const scopeId = item.courseId || '';
    let level = '';
    if (scopeId) {
      try { level = wx.getStorageSync('userLevel:' + scopeId) || ''; } catch (e) {}
    }
    const levelSource = level ? 'course' : 'default';
    if (!level) level = 'S';
    this.setData({ aiLoading: true });
    track('ai_teach_start', { itemId: item.id, level, courseId: scopeId, levelSource });
    wx.cloud.callFunction({
      name: 'aiTeach',
      data: {
        topic: item.title || item.id || '',
        subject: item.courseName || item.courseId || '',
        system: '国际课程',
        level: level,
        /* 费曼模式：让云函数改讲解顺序（先外行话与类比，再术语），
           并要求额外输出一句可以直接布置给学生的复述任务 */
        feynman: this.data.feynman === true
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
          aiSummary: data.summary || '',
          /* 没生成出来就留空、不显示卡片 —— 不要用一句通用口号顶替，
             那样学生以为做了费曼，其实什么也没检验 */
          feynmanCheck: typeof data.feynmanCheck === 'string' ? data.feynmanCheck : ''
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
    this.setData({ aiMode: false, aiSections: [], aiIdx: 0, aiSummary: '', feynmanCheck: '' });
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
      aiSummary: '（游客模式 · 登录后可体验 AI 老师个性化讲解）',
      /* 游客降级也保留费曼环节的入口文案 —— 复述这件事本来不需要 AI 也能做 */
      feynmanCheck: this.data.feynman === true
        ? '请你合上页面，用自己的话把本节内容讲给一个完全没学过的人听 —— 讲不清的地方，就是还需要回头再看的地方。'
        : ''
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

  /* ===== 课后「讲给我听」：费曼学习法的验收环节 =====
     AI 扮演一个**完全不懂的听众**，只提问、不总结、不纠正。
     关键分工：**验收记录由服务端判定**。学生讲了几句、几个字，服务端自己数
     history 算出来；前端只负责渲染结果。理由是 R12 的同一条教训 ——
     凡是"够不够格下结论"的判断，判据必须来自可信来源，不能信客户端传的值。 */
  feynTalkCovered() {
    const it = this.data.item || {};
    const parts = [];
    if (it.title) parts.push(it.title);
    const q = this.data.currentQuiz;
    if (q && q.question) parts.push(q.question);
    return parts.join('；');
  },

  openFeynTalk() {
    if (!app.globalData.hasLogin) {
      /* 需要登录：这个环节要走 AI 多轮对话，游客态没有可用通道。
         如实说明而不是给一个"假的听众"占位。 */
      wx.showToast({ title: '登录后即可让 AI 当你的听众', icon: 'none' });
      return;
    }
    this.setData({
      feynTalkMode: true,
      feynTalkMsgs: [{
        role: 'assistant',
        content: '我完全没学过这门课，你刚才上的那节课能不能讲给我听？'
          + '就用你自己的话，别用课本上的说法 — 我怕是听不懂。'
      }],
      feynTalkInput: '',
      feynTalkBusy: false,
      feynTalkDone: false,
      feynTalkVerdict: null,
      feynTalkError: ''
    });
  },

  closeFeynTalk() {
    this.setData({ feynTalkMode: false, feynTalkError: '' });
  },

  onFeynTalkInput(e) {
    this.setData({ feynTalkInput: e.detail.value });
  },

  feynTalkPayload() {
    const it = this.data.item || {};
    return {
      topic: it.title || it.id || '',
      subject: it.courseName || it.courseId || '',
      covered: this.feynTalkCovered(),
      history: (this.data.feynTalkMsgs || []).map(m => ({ role: m.role, content: m.content }))
    };
  },

  sendFeynTalk() {
    const text = (this.data.feynTalkInput || '').trim();
    if (!text) { wx.showToast({ title: '先写一句要讲的', icon: 'none' }); return; }
    if (this.data.feynTalkBusy || this.data.feynTalkDone) return;

    const msgs = this.data.feynTalkMsgs.concat([{ role: 'user', content: text }]);
    this.setData({ feynTalkMsgs: msgs, feynTalkInput: '', feynTalkBusy: true, feynTalkError: '' });

    const payload = this.feynTalkPayload();
    payload.history = msgs.map(m => ({ role: m.role, content: m.content }));

    wx.cloud.callFunction({ name: 'feynmanTalk', data: payload }).then(res => {
      const r = (res && res.result) || {};
      if (r.code !== 0 || !r.reply) {
        /* ★ 与 R13 同一条纪律：失败**不能**伪装成听众的提问——
           否则学生会去回答一个根本不存在的问题，而且那句错误文案
           还会作为上下文传给下一轮、被当成教学内容。 */
        this.setData({ feynTalkBusy: false, feynTalkError: r.msg || '听众暂时没听清，请再说一遍' });
        return;
      }
      this.setData({
        feynTalkBusy: false,
        feynTalkError: '',
        feynTalkMsgs: msgs.concat([{ role: 'assistant', content: r.reply }])
      });
    }).catch(() => {
      this.setData({ feynTalkBusy: false, feynTalkError: '网络异常，请检查网络后重试' });
    });
  },

  retryFeynTalk() {
    /* 失败后重发**最后一条学生发言**（不让学生重新打一遍字）。
       注意：要把那条发言从历史里**摘掉再重发**，否则发出去的 history 里
       会有连续两条相同的学生消息，听众会当成"你说了两遍"。 */
    const msgs = this.data.feynTalkMsgs || [];
    let idx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { idx = i; break; }
    }
    if (idx < 0) { this.setData({ feynTalkError: '' }); return; }
    const lastUser = msgs[idx].content;
    const cut = msgs.slice(0, idx);
    this.setData({ feynTalkMsgs: cut, feynTalkInput: '', feynTalkError: '' });

    const withUser = cut.concat([{ role: 'user', content: lastUser }]);
    this.setData({ feynTalkMsgs: withUser, feynTalkBusy: true });
    const payload = this.feynTalkPayload();
    payload.history = withUser.map(m => ({ role: m.role, content: m.content }));

    wx.cloud.callFunction({ name: 'feynmanTalk', data: payload }).then(res => {
      const r = (res && res.result) || {};
      if (r.code !== 0 || !r.reply) {
        this.setData({ feynTalkBusy: false, feynTalkError: r.msg || '听众暂时没听清，请再说一遍' });
        return;
      }
      this.setData({
        feynTalkBusy: false,
        feynTalkError: '',
        feynTalkMsgs: withUser.concat([{ role: 'assistant', content: r.reply }])
      });
    }).catch(() => {
      this.setData({ feynTalkBusy: false, feynTalkError: '网络异常，请检查网络后重试' });
    });
  },

  finishFeynTalk() {
    if (this.data.feynTalkBusy || this.data.feynTalkDone) return;
    const payload = this.feynTalkPayload();
    payload.action = 'verdict';
    this.setData({ feynTalkBusy: true, feynTalkError: '' });

    wx.cloud.callFunction({ name: 'feynmanTalk', data: payload }).then(res => {
      const r = (res && res.result) || {};
      if (r.code === 1) {
        /* 服务端拒绝：一句话都没讲。不给验收记录，也不置 done，学生还能继续讲 */
        this.setData({ feynTalkBusy: false });
        wx.showToast({ title: r.msg || '先讲一段再看验收', icon: 'none' });
        return;
      }
      if (r.code !== 0 || !r.verdict) {
        /* 失败**不给结论**，也不要编一份"你讲得不错"糊过去 */
        this.setData({ feynTalkBusy: false, feynTalkError: r.msg || '这次没能整理出验收记录' });
        return;
      }
      this.setData({ feynTalkBusy: false, feynTalkVerdict: r.verdict, feynTalkDone: true });
    }).catch(() => {
      this.setData({ feynTalkBusy: false, feynTalkError: '网络异常，请检查网络后重试' });
    });
  },

  noop() {}
});
