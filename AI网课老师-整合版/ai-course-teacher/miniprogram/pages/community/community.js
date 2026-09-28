const app = getApp();

Page({
  data: {
    posts: [],
    composeText: '',
    posting: false
  },

  onLoad() {
    this.loadPosts();
  },

  loadPosts() {
    if (app.globalData.hasLogin) {
      wx.cloud.callFunction({ name: 'getPosts' })
        .then(res => {
          if (res.result && res.result.code === 0 && res.result.list) {
            this.setData({ posts: res.result.list });
          } else {
            this.loadDemoPosts();
          }
        })
        .catch(() => this.loadDemoPosts());
    } else {
      this.loadDemoPosts();
    }
  },

  loadDemoPosts() {
    const now = Date.now();
    const min = 60 * 1000;
    const hour = 60 * min;
    const day = 24 * hour;

    this.setData({
      posts: [
        {
          id: 'demo1',
          nickname: 'Sakura🌸',
          avatarColor: '#00e5ff',
          content: '今天完成了 AP Calculus 的“泰勒级数”知识点！学到第 3 段时提出了一个疑问，AI 老师给我补讲了余项的误差来源，终于通了 💪',
          time: now - 12 * min,
          likes: 12
        },
        {
          id: 'demo2',
          nickname: 'Kevin 同学',
          avatarColor: '#ffd740',
          content: '坚持打卡第 21 天 📅 SAT 数学从错一半到现在全对，错题本真的有用！大家加油～',
          time: now - 3 * hour,
          likes: 28
        },
        {
          id: 'demo3',
          nickname: 'Momo',
          avatarColor: '#ff8a80',
          content: '雅思词汇 B2 学完啦！下一个目标：IGCSE 数学。今天的新计划是完成 3 个知识点+1 次作业讲评。',
          time: now - 1 * day,
          likes: 6
        }
      ]
    });
  },

  onInput(e) {
    this.setData({ composeText: e.detail.value });
  },

  submitPost() {
    const content = this.data.composeText.trim();
    if (!content) {
      wx.showToast({ title: '写点什么吧', icon: 'none' });
      return;
    }

    if (!app.globalData.hasLogin) {
      wx.showToast({ title: '游客模式无法发布', icon: 'none' });
      return;
    }

    if (this.data.posting) return;
    this.setData({ posting: true });

    wx.cloud.callFunction({
      name: 'communityPost',
      data: { content }
    }).then(res => {
      if (res.result && res.result.code === 0) {
        this.setData({ composeText: '' });
        wx.showToast({ title: '已发布', icon: 'success' });
        this.loadPosts();
      } else {
        wx.showToast({ title: '发布失败，请重试', icon: 'none' });
      }
    }).catch(() => {
      wx.showToast({ title: '发布失败，请重试', icon: 'none' });
    }).finally(() => {
      this.setData({ posting: false });
    });
  },

  formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + ' 分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + ' 小时前';
    return Math.floor(diff / (24 * 60 * 60 * 1000)) + ' 天前';
  },

  like(e) {
    const id = e.currentTarget.dataset.id;
    const posts = this.data.posts.map(p => {
      if (p.id === id) {
        return { ...p, likes: (p.likes || 0) + 1, liked: true };
      }
      return p;
    });
    this.setData({ posts });
  },

  report(e) {
    const id = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['广告', '色情', '暴力', '诈骗', '侵权', '骚扰', '其他'],
      success: (res) => {
        const reasons = ['广告', '色情', '暴力', '诈骗', '侵权', '骚扰', '其他'];
        const reason = reasons[res.tapIndex];
        wx.cloud.callFunction({
          name: 'reportContent',
          data: { targetType: 'checkin', targetId: id, reason }
        }).then(r => {
          wx.showToast({ title: r.result.msg || '已举报', icon: 'none' });
        }).catch(() => {
          wx.showToast({ title: '举报失败', icon: 'none' });
        });
      }
    });
  }
});
