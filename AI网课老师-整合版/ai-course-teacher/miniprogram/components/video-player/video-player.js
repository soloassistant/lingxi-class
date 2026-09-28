const app = getApp();

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];
const QUALITIES = [
  { key: 'auto', label: '自动' },
  { key: 'sd', label: '流畅 480P' },
  { key: 'hd', label: '高清 720P' },
  { key: 'fhd', label: '超清 1080P' }
];

Component({
  properties: {
    // 视频源（单个url或按清晰度对象 {auto, sd, hd, fhd}）
    src: { type: null, value: '' },
    // 字幕/要点同步数据
    cues: { type: Array, value: [] },
    // 海报图
    poster: { type: String, value: '' },
    // 标题
    title: { type: String, value: '' },
    // 是否自动保存断点（默认true）
    resume: { type: Boolean, value: true },
    // 断点存储key
    resumeKey: { type: String, value: 'video_resume' },
    // 是否显示清晰度切换
    showQuality: { type: Boolean, value: true }
  },

  data: {
    innerSrc: '',
    currentSpeed: 1.0,
    currentQuality: 'auto',
    showSpeedPanel: false,
    showQualityPanel: false,
    speedOptions: SPEEDS,
    qualityOptions: QUALITIES,
    duration: 0,
    currentTime: 0,
    buffered: 0,
    playing: false,
    showCues: true,
    activeCue: '',
    isFullScreen: false,
    loading: true,
    error: false
  },

  lifetimes: {
    attached() {
      this._resolveSrc();
      this._restoreResume();
    },
    detached() {
      this._saveResume();
    }
  },

  observers: {
    'src': function () {
      this._resolveSrc();
    },
    'cues': function () {
      this._updateCue();
    }
  },

  methods: {
    _resolveSrc() {
      const src = this.properties.src;
      let url = '';
      if (typeof src === 'string') {
        url = src;
      } else if (src && typeof src === 'object') {
        const q = this.data.currentQuality;
        url = src[q] || src.auto || src.hd || src.sd || '';
      }
      if (url !== this.data.innerSrc) {
        this.setData({ innerSrc: url, error: false, loading: !!url });
      }
    },

    _restoreResume() {
      if (!this.properties.resume) return;
      try {
        const pos = wx.getStorageSync(this.properties.resumeKey);
        if (pos && typeof pos === 'number' && pos > 1) {
          this._pendingSeek = pos;
        }
      } catch (e) {}
    },

    _saveResume() {
      if (!this.properties.resume) return;
      const t = this.data.currentTime;
      if (!t || t < 1) return;
      try {
        wx.setStorageSync(this.properties.resumeKey, t);
      } catch (e) {}
    },

    // ===== 播放器事件 =====
    onPlay() { this.setData({ playing: true, loading: false }); },
    onPause() { this.setData({ playing: false }); this._saveResume(); },
    onEnded() {
      this.setData({ playing: false });
      try { wx.setStorageSync(this.properties.resumeKey, 0); } catch (e) {}
    },
    onWaiting() { this.setData({ loading: true }); },
    onPlaying() { this.setData({ loading: false }); },
    onError(e) {
      this.setData({ error: true, loading: false });
      this.triggerEvent('error', { code: e && e.detail ? e.detail.errCode : -1 });
    },
    onTimeUpdate(e) {
      const t = e.detail.currentTime || 0;
      const d = e.detail.duration || 0;
      const buffered = e.detail.buffered || 0;
      this.setData({
        currentTime: t,
        duration: d,
        buffered: buffered
      });
      this._updateCue();
      this.triggerEvent('timeupdate', { currentTime: t, duration: d });
    },
    onLoadedMeta(e) {
      const d = e.detail.duration || 0;
      this.setData({ duration: d, loading: false });
      if (this._pendingSeek) {
        this.videoContext.seek(this._pendingSeek);
        this._pendingSeek = 0;
      }
      this.triggerEvent('loadedmetadata', { duration: d });
    },
    onFullScreenChange(e) {
      this.setData({ isFullScreen: e.detail.fullScreen });
    },

    // ===== 字幕/要点同步 =====
    _updateCue() {
      const cues = this.properties.cues || [];
      if (!cues.length) {
        if (this.data.activeCue) this.setData({ activeCue: '' });
        return;
      }
      const t = this.data.currentTime;
      let active = '';
      for (let i = cues.length - 1; i >= 0; i--) {
        const c = cues[i];
        if (t >= (c.start || 0)) {
          active = c.text || c.label || '';
          break;
        }
      }
      if (active !== this.data.activeCue) {
        this.setData({ activeCue: active });
      }
    },

    // 点击字幕跳到对应时间
    onTapCue(e) {
      const start = e.currentTarget.dataset.start;
      if (this.videoContext && typeof start === 'number') {
        this.videoContext.seek(start);
      }
    },

    toggleCues() {
      this.setData({ showCues: !this.data.showCues });
    },

    // ===== 倍速 =====
    toggleSpeedPanel() {
      this.setData({
        showSpeedPanel: !this.data.showSpeedPanel,
        showQualityPanel: false
      });
    },
    onPickSpeed(e) {
      const s = e.currentTarget.dataset.speed;
      this.setData({ currentSpeed: s, showSpeedPanel: false });
    },

    // ===== 清晰度 =====
    toggleQualityPanel() {
      if (!this.properties.showQuality) return;
      this.setData({
        showQualityPanel: !this.data.showQualityPanel,
        showSpeedPanel: false
      });
    },
    onPickQuality(e) {
      const q = e.currentTarget.dataset.key;
      if (q === this.data.currentQuality) {
        this.setData({ showQualityPanel: false });
        return;
      }
      // 切换清晰度需要重新加载，先记住当前时间
      const resumeTime = this.data.currentTime;
      this._pendingSeek = resumeTime;
      this.setData({ currentQuality: q, showQualityPanel: false });
      this._resolveSrc();
      // src 变化后小程序会自动重新加载，pendingSeek 在 loadedmetadata 里消费
    },

    // ===== 全屏 =====
    toggleFullScreen() {
      if (!this.videoContext) return;
      if (this.data.isFullScreen) {
        this.videoContext.exitFullScreen();
      } else {
        this.videoContext.requestFullScreen();
      }
    },

    // ===== 控制条 =====
    togglePlay() {
      if (!this.videoContext) return;
      if (this.data.playing) this.videoContext.pause();
      else this.videoContext.play();
    },

    onSliderChanging() {
      this._sliding = true;
    },
    onSliderChange(e) {
      const v = e.detail.value;
      if (this.videoContext) this.videoContext.seek(v);
      this._sliding = false;
    },

    // ===== 对外方法 =====
    play() { this.videoContext && this.videoContext.play(); },
    pause() { this.videoContext && this.videoContext.pause(); },
    seek(t) { this.videoContext && this.videoContext.seek(t); },

    // videoContext 延迟获取
    setVideoContext(ctx) { this.videoContext = ctx; }
  }
});
