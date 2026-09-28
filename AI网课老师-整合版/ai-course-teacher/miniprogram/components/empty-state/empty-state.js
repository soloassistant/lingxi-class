Component({
  properties: {
    icon: { type: String, value: '📭' },
    title: { type: String, value: '暂无数据' },
    desc: { type: String, value: '' },
    btnText: { type: String, value: '开始' },
    showBtn: { type: Boolean, value: true }
  },
  methods: {
    onTap() { this.triggerEvent('action'); }
  }
});
