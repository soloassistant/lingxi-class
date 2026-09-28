const app = getApp();
const { track } = require('../../utils/track.js');

Page({
  data: {
    wrongs: [],
    expandId: '',
    selectedMap: {},
    resultMap: {},
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
    this.setData({
      expandId: this.data.expandId === id ? '' : id,
      selectedMap: {},
      resultMap: {}
    });
  },

  chooseAnswer(e) {
    const id = e.currentTarget.dataset.id;
    const index = Number(e.currentTarget.dataset.index);
    const wrong = this.data.wrongs.find(w => w.itemId === id);
    if (!wrong) return;

    const correct = index === wrong.answerIndex;
    const selectedMap = { ...this.data.selectedMap };
    const resultMap = { ...this.data.resultMap };
    selectedMap[id] = index;
    resultMap[id] = correct;
    this.setData({ selectedMap, resultMap });

    track('wrong_review', { itemId: id, correct });

    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({
        name: 'updateWrong',
        data: { itemId: id, correct }
      }).then(res => {
        if (res.result && res.result.code === 0 && res.result.resolved) {
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
