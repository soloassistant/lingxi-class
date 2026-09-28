# video-player 组件

视频级学习讲解播放器，替代原生 `<video>` 的简陋控件。

## 特性
- 倍速：0.75x / 1x / 1.25x / 1.5x / 2x，可面板切换
- 清晰度：自动 / 流畅 / 高清 / 超清，切换自动续播
- 字幕/要点同步：传入 cues 数组，按当前时间高亮，点击跳转
- 断点续播：自动保存/恢复播放位置
- 全屏、进度条拖拽、加载/错误状态

## 用法

```json
// 页面 json
{
  "usingComponents": {
    "video-player": "/components/video-player/video-player"
  }
}
```

```xml
<!-- 页面 wxml -->
<video-player
  src="{{videoSrc}}"
  poster="{{poster}}"
  title="{{title}}"
  cues="{{cues}}"
  resume-key="{{itemId}}"
  bind:timeupdate="onTimeUpdate"
/>
```

`src` 可以是字符串，或按清晰度对象：
```js
videoSrc: {
  auto: 'https://.../auto.m3u8',
  sd:   'https://.../sd.mp4',
  hd:   'https://.../hd.mp4',
  fhd:  'https://.../fhd.mp4'
}
```

`cues` 结构：
```js
cues: [
  { start: 0,   text: '本节目标：掌握泰勒展开' },
  { start: 45,  text: '核心公式：f(x)=Σ f⁽ⁿ⁾(a)(x-a)ⁿ/n!' },
  { start: 120, text: '例题演示' }
]
```

`resume-key` 建议用知识点 id，保证不同知识点断点互不干扰。

## 注意事项
- `bindloadedmetadata` 中消费 `_pendingSeek`，切换清晰度后不会跳回开头
- `src` 变化不会触发 `observers` 外的重新解析，组件内部已处理
- 真机调试时视频域名需在小程序后台「服务器域名」配置 downloadFile 合法域名
- 无网络时 `binderror` 触发，显示重试按钮
