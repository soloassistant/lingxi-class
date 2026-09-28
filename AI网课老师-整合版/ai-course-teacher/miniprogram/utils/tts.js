// 语音合成工具（基于微信同声传译插件 WechatSI）
//
// ★★ 2026-09-28 重写说明（原来会"完全没有声音，且一句提示都没有"）：
//   原来的每个失败路径都是 `if (onEnd) onEnd(); return;` —— 页面那边收到 onEnd 就以为"播完了"，
//   于是继续读下一段、最后把按钮复位。用户看到的是：按钮动了一下、没声音、没有任何解释。
//   线上/真机上最常见的两种失败：
//     ① 插件没在**小程序后台**添加（设置 → 第三方服务 → 插件管理 → 搜「微信同声传译」）
//        注意：只在 app.json 里声明 plugins 是**不够的**，必须账号后台也添加。
//     ② 项目还用着游客 appid（project.config.json 里 `appid: "touristappid"`）——
//        游客模式没有账号，插件**必然不可用**。
//   现在：失败会**明确回报原因**，并让上层能如实告诉用户该怎么办，而不是假装播完了。
//
// 前置（必须由小程序账号管理员操作，代码改不了）：
//   1) project.config.json 里填入真实 appid（不能是 touristappid）
//   2) 小程序后台「设置 → 第三方服务 → 插件管理」添加插件 wx069ba97219f66d99
//   3) app.json 里声明（已声明）：
//      "plugins": { "WechatSI": { "version": "0.3.6", "provider": "wx069ba97219f66d99" } }
let audioCtx = null;

function getPlugin() {
  try {
    return requirePlugin('WechatSI');
  } catch (e) {
    return null;
  }
}

/* 探测语音能力，供页面在点击前就知道能不能播。
   返回 { ok, reason }，reason 取值：
     ok            —— 可用
     no_plugin     —— 插件拿不到（没在后台添加 / 游客 appid）
     no_api        —— 插件里没有 textToSpeech（版本不对）
   页面可据此**提前**告诉用户，而不是等他点了才发现没声。 */
function probe() {
  const p = getPlugin();
  if (!p) return { ok: false, reason: 'no_plugin' };
  if (typeof p.textToSpeech !== 'function') return { ok: false, reason: 'no_api' };
  return { ok: true, reason: 'ok' };
}

/* 把失败原因翻译成用户能照着做的说明 */
function explain(reason) {
  if (reason === 'no_plugin') {
    return '语音播报还没开通：需要在小程序后台「设置 → 第三方服务 → 插件管理」添加「微信同声传译」插件。'
      + '（开发者还要把项目里的 appid 换成正式的小程序 appid，游客模式用不了插件）';
  }
  if (reason === 'no_api') return '语音插件版本不对，请把 WechatSI 更新到 0.3.6 或更高。';
  if (reason === 'synthesize') return '语音合成失败了，可能是网络或插件额度用完了，稍后再试。';
  if (reason === 'play') return '语音生成了但没能播放，请检查手机是否静音、或调大媒体音量。';
  return '语音暂时不可用。';
}

// 朗读文字。options: { lang, onEnd, onFail }
//   onEnd()              —— 播完了（或确实没内容可播）
//   onFail(reason, msg)  —— 播**不**出来，reason 见 explain()，msg 是可以直接给用户看的句子
// 约定：onFail 不会被静默吞掉；调用方必须处理，否则就是"看起来在播、其实没声"。
function speak(text, options) {
  options = options || {};
  const onEnd = options.onEnd || null;
  const onFail = options.onFail || null;
  const lang = options.lang || 'zh_CN';

  const fail = (reason) => {
    const msg = explain(reason);
    try { console.warn('[tts] 朗读失败：' + reason + ' —— ' + msg); } catch (e) {}
    if (onFail) onFail(reason, msg);
    else if (onEnd) onEnd();      // 调用方没接 onFail 时退回旧行为，但至少 console 有记录
  };

  if (!text || !String(text).trim()) {
    if (onEnd) onEnd();
    return;
  }

  const p = probe();
  if (!p.ok) { fail(p.reason); return; }

  const plugin = getPlugin();
  stop();
  plugin.textToSpeech({
    lang: lang,
    tts: true,
    content: String(text),
    success: function (res) {
      if (!res || !res.filename) { fail('synthesize'); return; }
      try {
        audioCtx = wx.createInnerAudioContext();
      } catch (e) { fail('play'); return; }
      audioCtx.src = res.filename;
      audioCtx.onEnded(function () { if (onEnd) onEnd(); });
      /* InnerAudioContext 的 onError 原来也是静默的 —— 同样让用户"看着在播却没声"。
         这里区分出来并交给上层。 */
      audioCtx.onError(function (e) {
        fail('play');
        try { console.warn('[tts] 播放失败', e); } catch (_) {}
      });
      try {
        audioCtx.play();
      } catch (e) { fail('play'); }
    },
    fail: function (e) {
      try { console.warn('[tts] textToSpeech fail', e); } catch (_) {}
      fail('synthesize');
    }
  });
}

// 停止朗读
function stop() {
  if (audioCtx) {
    try { audioCtx.stop(); } catch (e) {}
    try { audioCtx.destroy(); } catch (e) {}
    audioCtx = null;
  }
}

module.exports = { speak, stop, probe, explain };
