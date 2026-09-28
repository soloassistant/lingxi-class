Component({
  properties: {
    // 显示几条骨架
    count: { type: Number, value: 3 },
    // 每行高度，rpx
    rowHeight: { type: Number, value: 32 },
    // 行间距，rpx
    rowGap: { type: Number, value: 16 },
    // 是否圆角（用于头像/封面）
    rounded: { type: Boolean, value: false }
  },

  data: {
    rows: []
  },

  lifetimes: {
    attached() {
      const n = Math.max(1, Math.min(this.properties.count, 12));
      const rows = [];
      for (let i = 0; i < n; i++) rows.push(i);
      this.setData({ rows });
    }
  }
});
