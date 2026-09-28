Component({
  properties: {
    msg: { type: String, value: '加载失败，请检查网络' },
    showRetry: { type: Boolean, value: true }
  },
  methods: {
    onRetry() { this.triggerEvent('retry'); }
  }
});
