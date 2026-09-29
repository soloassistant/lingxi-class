const app = getApp();
const { track } = require('../../utils/track.js');

Page({
  data: {
    wrongs: [],
    expandId: '',
    selectedMap: {},
    resultMap: {},
    /* ★ R09：已作答的 itemId 集合 —— 一题只允许作答一次，连点不再重复提交 */
    locked: {},
    variationMap: {},
    variationLoading: {},
    variationSelected: {},
    variationResult: {}
  },

  onShow() {
    if (app.globalData.hasLogin) {
      this.loadCloudWrongs();
    } else {
      this.loadLocalWrongs();
    }
  },

  loadCloudWrongs() {
    wx.cloud.callFunction({ name: 'getWrongs' })
      .then(res => {
        if (res.result && res.result.code === 0 && res.result.list) {
          this.setData({ wrongs: res.result.list.filter(w => !w.resolved) });
        } else {
          this.loadLocalWrongs();
        }
      })
      .catch(() => this.loadLocalWrongs());
  },

  loadLocalWrongs() {
    const localWrongs = wx.getStorageSync('localWrongs') || [];
    if (localWrongs.length > 0) {
      const active = localWrongs.filter(w => !w.resolved);
      if (active.length > 0) {
        this.setData({ wrongs: active });
        return;
      }
    }
    // 演示数据
    this.setData({
      wrongs: [
        {
          itemId: 'igcse_math_item1_fallback',
          question: '以下哪个是无理数？',
          options: ['√2', '1/2', '0.333…', '2'],
          answerIndex: 0,
          explanation: '√2 无法表示为两个整数之比，是无理数。',
          courseName: 'IGCSE数学',
          wrongCount: 2
        },
        {
          itemId: 'ap_calc_item1_fallback',
          question: '泰勒级数中，f(x)=eˣ 在 x=0 处的展开式是？',
          options: ['1 + x + x²/2! + x³/3! + …', '1 - x + x² - x³ + …', 'x + x² + x³ + …', '1 + 2x + 3x² + …'],
          answerIndex: 0,
          explanation: 'eˣ = Σ xⁿ/n!，从 n=0 到 ∞。',
          courseName: 'AP微积分BC',
          wrongCount: 1
        },
        {
          itemId: 'sat_math_item1_fallback',
          question: '若 3x + 5 = 20，则 x = ?',
          options: ['3', '5', '15', '25'],
          answerIndex: 1,
          explanation: '20 - 5 = 15，15 ÷ 3 = 5。',
          courseName: 'SAT数学',
          wrongCount: 1
        }
      ]
    });
  },

  toggleExpand(e) {
    const id = e.currentTarget.dataset.id;
    // 收起/展开同一题时重置作答状态 —— 锁也要一起放开，否则再展开就点不动了
    const locked = { ...this.data.locked };
    delete locked[id];
    this.setData({
      expandId: this.data.expandId === id ? '' : id,
      selectedMap: {},
      resultMap: {},
      locked
    });
  },

  /* 一次性作答令牌：同一题的一次作答只算一次。
     服务端按 lastAttemptId 做幂等 —— 网络重试、快速连点都不会多升一级。 */
  makeAttemptId(itemId) {
    return itemId + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
  },

  chooseAnswer(e) {
    const id = e.currentTarget.dataset.id;
    const index = Number(e.currentTarget.dataset.index);
    const wrong = this.data.wrongs.find(w => w.itemId === id);
    if (!wrong) return;

    /* ★ 2026-09-29 修（外部审查 R09，P1）：
       原来这里没有任何"已作答"锁 —— 答对之后题目和选项原样留着，
       反复点击会反复提交 `updateWrong`，而服务端当时也不看到期时间，
       于是同一题连点 5 次就能把间隔推到 30 天、标记"已掌握"。
       现在两道都补上：前端一题只允许作答一次（locked），
       服务端也要求到期 + 幂等令牌（见 cloudfunctions/updateWrong）。 */
    if (this.data.locked && this.data.locked[id]) return;

    const correct = index === wrong.answerIndex;
    const selectedMap = { ...this.data.selectedMap };
    const resultMap = { ...this.data.resultMap };
    const locked = { ...(this.data.locked || {}) };
    selectedMap[id] = index;
    resultMap[id] = correct;
    locked[id] = true;                    // 立刻上锁：连点不会再走到下面的提交
    this.setData({ selectedMap, resultMap, locked });

    track('wrong_review', { itemId: id, correct });

    const attemptId = this.makeAttemptId(id);

    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({
        name: 'updateWrong',
        data: { itemId: id, correct, attemptId }
      }).then(res => {
        const r = (res && res.result) || {};
        // 服务端判定"还没到复习时间"或"这次已计入过"时要说清楚，
        // 否则学生只会觉得答对了却没反应
        if (r.tooEarly) {
          wx.showToast({ title: r.msg || '还没到复习时间', icon: 'none' });
          return;
        }
        if (r.duplicated) return;
        if (r.code === 0 && r.resolved) {
          this.loadCloudWrongs();
        }
      }).catch(() => {});
    } else {
      // 游客本地逻辑：答对即消除
      if (correct) {
        setTimeout(() => {
          const localWrongs = wx.getStorageSync('localWrongs') || [];
          const updated = localWrongs.map(w =>
            w.itemId === id ? { ...w, resolved: true } : w
          );
          wx.setStorageSync('localWrongs', updated);
          this.setData({
            wrongs: this.data.wrongs.filter(w => w.itemId !== id)
          });
          wx.showToast({ title: '已掌握，已消除', icon: 'success' });
        }, 800);
      }
    }
  },

  goLearn(e) {
    const courseId = e.currentTarget.dataset.course;
    if (courseId) {
      wx.navigateTo({ url: '/pages/course/course?id=' + courseId });
    } else {
      wx.showToast({ title: '请到完整数据版复习', icon: 'none' });
    }
  },

  // AI 变式题（举一反三，对标作业帮/猿辅导）
  genVariation(e) {
    const id = e.currentTarget.dataset.id;
    const wrong = this.data.wrongs.find(w => w.itemId === id);
    if (!wrong) return;
    if (!app.globalData.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const variationLoading = { ...this.data.variationLoading, [id]: true };
    this.setData({ variationLoading, variationSelected: {}, variationResult: {} });
    track('variation_generate', { itemId: id });

    wx.cloud.callFunction({
      name: 'aiVariation',
      data: {
        question: wrong.question,
        options: wrong.options,
        answerIndex: wrong.answerIndex,
        explanation: wrong.explanation
      }
    }).then(res => {
      const loading = { ...this.data.variationLoading, [id]: false };
      if (res.result && res.result.code === 0 && res.result.question) {
        const variationMap = { ...this.data.variationMap, [id]: res.result };
        this.setData({ variationMap, variationLoading: loading });
      } else {
        this.setData({ variationLoading: loading });
        wx.showToast({ title: (res.result && res.result.msg) || '生成失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ variationLoading: { ...this.data.variationLoading, [id]: false } });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  },

  selectVariation(e) {
    const id = e.currentTarget.dataset.id;
    const index = Number(e.currentTarget.dataset.index);
    const v = this.data.variationMap[id];
    if (!v) return;
    const correct = index === v.answerIndex;
    this.setData({
      variationSelected: { ...this.data.variationSelected, [id]: index },
      variationResult: { ...this.data.variationResult, [id]: correct }
    });
  }
});
