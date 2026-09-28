/* 回归测试：进入直播间 → 开场 → 打断 → 接续（角色严格交替）
 *
 * 运行（Windows）：
 *   $env:NODE_PATH="C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules"
 *   & "C:\...\node.exe" tests\live-flow.test.js
 *
 * 关键坑：SDK 桩的 create() 必须是「同步函数、直接返回 async generator 实例」。
 * 若写成 async 函数返回 { [Symbol.asyncIterator](){} }，jsdom realm 下的 for await
 * 会直接抛 "not async iterable"，导致测试结果失真。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dir = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// 记录每次请求的 messages 快照，用于校验角色交替
const requests = [];
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.local/' });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
window.speechSynthesis = {
  getVoices: () => [{ name: 'Xiaoxiao', lang: 'zh-CN' }],
  speak() {}, cancel() {}, onvoiceschanged: null,
};
window.SpeechSynthesisUtterance = function (txt) { this.text = txt; };

let abortFlag = null;
window.WorkBuddyCloud = { createWorkBuddyCloud: () => ({
  llm: {
    models: { list: async () => [{ id: 'm', name: 'M', disabled: false }] },
    chat: { completions: {
      // 同步函数 + 直接返回 async generator 实例
      create: function (body) {
        requests.push(JSON.parse(JSON.stringify(body.messages || [])));
        const ctrl = { aborted: false };
        abortFlag = ctrl;
        const words = ['这是', '老师的', '一段', '讲解内容。'];
        return (async function* () {
          for (let i = 0; i < words.length; i++) {
            // 每 20ms 检查一次 abort，模拟真实流的即时中断
            for (let k = 0; k < 6; k++) {
              await new Promise((r) => setTimeout(r, 20));
              if (ctrl.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
            }
            yield { choices: [{ delta: { content: words[i] } }] };
          }
        })();
      },
    } },
  },
}) };

// 让 AbortController.abort() 联动 ctrl，从而真的中断流
const OrigAC = window.AbortController;
window.AbortController = function () {
  const ac = new OrigAC();
  const origAbort = ac.abort.bind(ac);
  ac.abort = () => { if (abortFlag) abortFlag.aborted = true; return origAbort(); };
  return ac;
};

const sc = document.createElement('script');
sc.textContent = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
document.head.appendChild(sc);

const course = {
  id: 'rc1', title: '回归课', subject: '数学', grade: '高一', level: '提高', duration: '45 分钟',
  system: 'cn', systemName: '国内课程', systemIco: 'CN', createdAt: Date.now(), progress: 0,
  boards: [], boardNames: [],
  outline: {
    title: '回归课', knowledgePoints: ['A', 'B'],
    stages: [{ name: '导入', duration: '5', content: 'c' }], homework: ['h'],
    slides: [
      { type: 'cover', title: '回归课', subtitle: 's' },
      { type: 'content', title: '知识', bullets: ['a', 'b'], note: 'n' },
      { type: 'quiz', title: '练习', question: 'Q?', options: ['A. 1', 'B. 2'], answer: 'B', analysis: 'an', note: 'qn' },
      { type: 'summary', title: '小结', bullets: ['x'], note: '' },
    ],
  },
};
course.slides = window.normalizeSlides(course.outline, course);

// 找出相邻同角色的位置（-1 表示严格交替）
function adjacentSameRole(msgs) {
  const h = msgs.filter((m) => m.role !== 'system');
  for (let i = 1; i < h.length; i++) if (h[i].role === h[i - 1].role) return i;
  return -1;
}

setTimeout(async () => {
  console.log('=== 1. 进入直播间 ===');
  // enterLive 现在是 async：内部会用 await requireModel() 等 AI 就绪（手快点按钮不再被劝退）
  await window.enterLive(course);
  t('live-room 打开', document.getElementById('live-room').hidden === false);
  t('live-empty 隐藏', document.getElementById('live-empty').hidden === true);
  t('tile-share 可见', document.getElementById('tile-share').hidden === false);
  t('共享屏渲染课件', document.getElementById('live-slide-stage').innerHTML.length > 100);
  t('参会者已渲染', document.getElementById('people-list').children.length >= 2);

  await new Promise((r) => setTimeout(r, 200));
  console.log('   开场后请求数:', requests.length);
  t('发出了开场请求', requests.length >= 1);
  if (requests.length) {
    const m = requests[0];
    t('首条是 system', m[0].role === 'system');
    t('含课件内容注入', /课件|练习页/.test(m[0].content), m[0].content.slice(0, 80));
  }

  console.log('\n=== 2. 老师讲课中（busy）===');
  await new Promise((r) => setTimeout(r, 700));      // 等开场白讲完
  window.sendLive('请继续讲第二页的内容');
  await new Promise((r) => setTimeout(r, 200));      // 流仍在进行中
  const input = document.getElementById('chat-input');
  const send = document.getElementById('btn-send');
  t('讲课时输入框可用（可插话）', input.disabled === false);
  t('发送按钮变为打断', send.textContent.includes('打断'), '实际="' + send.textContent + '"');
  t('打断提示可见', document.getElementById('interrupt-hint').hidden === false);

  console.log('\n=== 3. 学生打断 ===');
  window.sendLive('老师等一下，为什么这里是这样？');
  await new Promise((r) => setTimeout(r, 900));
  const asks = document.getElementById('chat-messages').querySelectorAll('.msg.me');
  t('学生消息已上屏', asks.length >= 2, 'count=' + asks.length);
  t('被打断气泡有标记', document.querySelectorAll('.msg.interrupted').length >= 1,
    'interrupted=' + document.querySelectorAll('.msg.interrupted').length);

  console.log('\n=== 4. 角色严格交替校验 ===');
  requests.forEach((m, i) => {
    const bad = adjacentSameRole(m);
    t('请求#' + (i + 1) + ' 角色无相邻重复', bad === -1,
      bad >= 0 ? '位置 ' + bad + ': ' + m.map((x) => x.role).join(',') : '');
  });
  if (requests.length >= 2) {
    const last = requests[requests.length - 1];
    console.log('   最后一次 messages 角色:', last.map((x) => x.role).join(' -> '));
    t('末条请求含打断提示', /被打断|接着/.test(JSON.stringify(last)));
  }

  console.log('\n=== 5. 答完接续（历史含被打断的 assistant） ===');
  window.sendLive('好的我明白了，继续');
  await new Promise((r) => setTimeout(r, 900));
  const finalReq = requests[requests.length - 1];
  console.log('   最终 messages 角色:', finalReq.map((x) => x.role).join(' -> '));
  t('最终请求仍严格交替', adjacentSameRole(finalReq) === -1);

  console.log('\n=== 6. 语音朗读：默认开启 + 无声不静默（听不到老师讲课的回归） ===');
  // 背景：TTS 默认关闭 + 无声时静默失败 → 用户进课堂听到的是"哑巴老师"。
  // 这两条都属 P0，钉死。
  window.localStorage.removeItem('lingxi_tts');
  window.TTS.enabled = false;
  window.restoreTTSPref();
  t('默认开启朗读（无历史偏好）', window.TTS.enabled === true);
  window.localStorage.setItem('lingxi_tts', '0');
  window.TTS.enabled = true;
  window.restoreTTSPref();
  t('用户主动关过 → 保持关闭', window.TTS.enabled === false);
  // 关键：进课堂的自动开启**不能覆盖用户的关闭选择**（否则用户每次都被强行开声）
  window.ensureVoiceReady();
  t('用户关过时，进课堂不会自动开声', window.TTS.enabled === false);
  window.localStorage.setItem('lingxi_tts', '1');
  window.TTS.enabled = false;
  window.restoreTTSPref();
  t('用户开过 → 下次仍开启', window.TTS.enabled === true);
  window.localStorage.removeItem('lingxi_tts');

  const health = window.ttsHealth();
  t('有语音可用性自检', typeof health.usable === 'boolean' && typeof health.reason === 'string',
    'reason=' + health.reason);
  // 本测试桩提供的是中文语音，应判定为可用
  t('桩环境识别为有中文语音', health.reason === 'ok' && health.hasZh === true);

  // 无声场景：必须给用户可操作的提示，而不是什么都不说
  window.ttsNotified = '';
  window.notifyTTSProblem('no_voice');
  const tips = Array.from(document.querySelectorAll('#toast-wrap .toast')).map((x) => x.textContent).join('|');
  t('无语音包时提示用户', tips.length > 0);
  t('提示含具体解决路径（设置/Edge）', /Edge|设置|语音包/.test(tips));
  t('提示含降级说明（改字幕）', /字幕/.test(tips));
  const n1 = document.querySelectorAll('#toast-wrap .toast').length;
  window.notifyTTSProblem('no_voice');
  t('同一问题不重复提示', document.querySelectorAll('#toast-wrap .toast').length === n1);

  const srcTts = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  t('进入课堂触发语音自检', /ensureVoiceReady\(\);/.test(srcTts));
  t('发音失败有兜底检测（不干等，且会 cancel 重置卡死的引擎）',
    /* 2026-09-27 两次调整，都是**收紧行为、放宽字面量匹配**：
       ① 条件从 `if (started) return` 变成 `if (started || settled) return`（已结束就不重复处理）
       ② silent 分支从单行 `if (TTS.enabled) notifyTTSProblem('silent');`
          变成带 `armGestureRetry(text)` 的块（挂"点一下重试"）
       断言因此不再锚定某一个写法，而是断"这几件事都做了"。 */
    /if \(started \|\| settled\) return;/.test(srcTts) && /notifyTTSProblem\('silent'\)/.test(srcTts) &&
    /window\.speechSynthesis\.cancel\(\)/.test(srcTts));
  t('朗读前会再取一次语音（异步就绪）', /if \(!TTS\.voice\) TTS\.voice = pickVoice\(\)/.test(srcTts));

  console.log('\n=== 7. 语音听感优化：清洗 / 切句 / 语速 ===');
  // T. 朗读文本清洗：屏幕上好看 ≠ 念出来好听
  t('去掉 emoji（实测老师说过"蛋糕🍰"）', window.speakableText('假如有两块蛋糕🍰，怎么分？').indexOf('🍰') < 0);
  t('emoji 去掉后句子仍完整', /蛋糕.*怎么分/.test(window.speakableText('假如有两块蛋糕🍰，怎么分？')));
  t('百分号连数字读', window.speakableText('50%的同学做对了').indexOf('百分之50') >= 0);
  t('不是"50百分之"', window.speakableText('50%的同学做对了').indexOf('50百分之') < 0);
  t('乘号口语化', /长乘宽/.test(window.speakableText('面积 = 长 × 宽')));
  t('除号口语化', /8除以2/.test(window.speakableText('8 ÷ 2')));
  t('等号口语化', /等于/.test(window.speakableText('3 = 3')));
  t('约等号口语化', /约等于/.test(window.speakableText('π ≈ 3.14')));
  t('度符号口语化', /90度/.test(window.speakableText('直角是 90°')));
  t('面积单位口语化', /平方厘米/.test(window.speakableText('面积 12 cm²')));
  t('破折号变停顿而非读出"破折号"', !/破折号/.test(window.speakableText('分数——就是平均分')) && /，/.test(window.speakableText('分数——就是平均分')));
  t('markdown 记号被清掉', window.speakableText('**重点**：先看 #1 题').indexOf('**') < 0);
  t('代码块不朗读', window.speakableText('看这段 ```const a=1``` 就好').indexOf('const') < 0);
  t('空输入返回空串', window.speakableText('') === '' && window.speakableText(null) === '');
  // 实测发现：emoji 换成空格后，中文之间留空格会让 TTS 微停顿
  t('中文之间不留多余空格', window.speakableText('假如有两块蛋糕🍰，怎么分？').indexOf('蛋糕 ，') < 0);
  t('符号替换产生的连续标点被合并', window.speakableText('这是 —— 很重要的结论').indexOf('， ，') < 0);
  t('连续逗号被合并', window.speakableText('第一， 、 第二').indexOf('， 、') < 0);

  // U. 切句：碎片合并 + 长句二次切分
  const frag = window.splitSentences('好。现在看这里。');
  t('碎片句被合并（不再一顿一顿）', frag.length === 1, 'got=' + JSON.stringify(frag));
  const two = window.splitSentences('这是一句完整的话，讲了一个意思。这是第二句同样完整的话呀。');
  t('正常两句不被误合', two.length === 2, 'got=' + JSON.stringify(two));
  const longOne = '同学们注意，' + '这是一段很长的讲解内容需要慢慢展开说明'.repeat(5) + '。';
  const longOut = window.splitSentences(longOne);
  t('超长句被二次切分（打断更灵敏）', longOut.length >= 3, 'pieces=' + longOut.length);
  t('切分后每片都不超上限', longOut.every((s) => s.length <= 80), 'max=' + Math.max.apply(null, longOut.map((s) => s.length)));
  // 实测发现：开头出现了 6 字碎片「同学们注意，」——过短碎片要并回相邻片
  t('切分后没有过短碎片（<12 字）', longOut.every((s) => s.length >= 12), 'lens=' + JSON.stringify(longOut.map((s) => s.length)));
  t('切分不丢内容', longOut.join('').replace(/\s/g, '').length >= longOne.replace(/[，。]/g, '').length - 4);
  t('纯符号输入不会产出空句', window.splitSentences('。。。').length === 0);

  // V. 语速可调 + 记住偏好
  t('有三档语速', JSON.stringify(window.SPEECH_RATES) === JSON.stringify([0.9, 1, 1.15]));
  window.localStorage.removeItem('lingxi_tts_rate');
  t('默认语速 1.0', window.loadSpeechRate() === 1);
  window.TTS.rate = 1.0;
  const r2 = window.cycleSpeechRate();
  t('长按切到下一档', r2 === 0.9 || r2 === 1.15, 'got=' + r2);
  t('语速写入偏好', window.localStorage.getItem('lingxi_tts_rate') === String(r2));
  window.TTS.rate = 1.15;
  window.cycleSpeechRate();
  t('循环回到第一档', window.TTS.rate === 0.9, 'got=' + window.TTS.rate);
  window.localStorage.removeItem('lingxi_tts_rate');
  window.TTS.rate = 1.0;

  // W. 长按不误触发开关（同一元素监听器按注册顺序触发，不能靠 stopImmediatePropagation）
  t('长按标记在点击处理器里被消费', /if \(speakRatePressed\) \{ speakRatePressed = false; return; \}/.test(
    fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8')));
  t('语音按钮标题说明了长按用法', /长按设置语速与语言/.test(fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8')));

  console.log('\n=== 8. 授课语言可切换（中文 / English） ===');
  // 关键认识：语言不能只换音色 —— 中文内容配英文音色会读成怪音。
  // 所以一处设置要同时联动：提示词（讲课语言）+ 音色 + 朗读清洗规则。
  window.localStorage.removeItem('lingxi_teach_lang');
  t('默认授课语言为中文', window.loadTeachLang() === 'zh');
  t('有中英两种语言配置', !!window.TEACH_LANGS.zh && !!window.TEACH_LANGS.en);

  // 切到英文 → 音色选择器必须按英文找，且提示词换成英语指令
  window.setTeachLang('en', { quiet: true });
  t('切换后语言状态为 en', window.teachLang() === 'en');
  t('英文配置的 utteranceLang 是 en-US', window.teachLangProfile().utteranceLang === 'en-US');
  const enPrompt = window.teacherSystemPrompt({ id: 'e', title: 'T', subject: 'Math', grade: 'G7', level: 'L', duration: '45', system: 'cn', slides: [] });
  t('提示词要求全程英语', /全程使用英语/.test(enPrompt));
  t('提示词不再写"全程使用简体中文"', enPrompt.indexOf('全程使用简体中文') < 0);

  // 英文朗读规则：符号读英语，且**不能**去掉词间空格
  const enText = window.speakableText('Area = length × width, 50% correct', 'en');
  t('英文：× 读 times', /times/.test(enText));
  t('英文：= 读 equals', /equals/.test(enText));
  t('英文：% 读 percent', /percent/.test(enText));
  t('英文：保留词间空格（否则英文会黏成一团）', /length \S* ?times/.test(enText) || enText.split(' ').length >= 4);
  t('英文不会出现中文读法', enText.indexOf('乘') < 0 && enText.indexOf('百分之') < 0);
  // 中文规则不受影响
  const zhText = window.speakableText('面积 = 长 × 宽，50% 正确', 'zh');
  t('中文：× 仍读乘', /长乘宽/.test(zhText) && zhText.indexOf('times') < 0);
  t('中文：% 仍读百分之', zhText.indexOf('百分之50') >= 0);

  // 切回中文
  window.setTeachLang('zh', { quiet: true });
  t('可切回中文', window.teachLang() === 'zh');
  const zhPrompt = window.teacherSystemPrompt({ id: 'c', title: 'T', subject: '数学', grade: '三年级', level: '基础', duration: '45', system: 'cn', slides: [] });
  t('中文提示词恢复简体中文指令', /全程使用简体中文/.test(zhPrompt));
  t('国际课程在中文模式下仍保留术语英文原名规则', /术语给出英文原名/.test(
    window.teacherSystemPrompt({ id: 'i', title: 'T', subject: 'Math', grade: 'IB DP1', level: '基础', duration: '45', system: 'intl', slides: [] })));
  t('语言偏好会持久化', (window.setTeachLang('en', { quiet: true }), window.localStorage.getItem('lingxi_teach_lang') === 'en'));
  window.setTeachLang('zh', { quiet: true });
  window.localStorage.removeItem('lingxi_teach_lang');

  // 设置面板
  t('有声音设置面板', !!document.querySelector('#voice-modal'));
  t('面板有语言与语速两组选项容器', !!document.querySelector('#voice-langs') && !!document.querySelector('#voice-rates'));
  window.renderVoiceSettings();
  t('渲染出两种语言按钮', document.querySelectorAll('#voice-langs [data-lang]').length === 2);
  t('渲染出三档语速按钮', document.querySelectorAll('#voice-rates [data-rate]').length === 3);
  t('当前语言高亮正确', (document.querySelector('#voice-langs .chip.active') || {}).dataset.lang === 'zh');
  // 实测情况：设备只有中文音色时，英文模式要如实说明"用系统默认英文引擎"
  window.setTeachLang('en', { quiet: true });
  window.TTS.voice = null;
  window.renderVoiceSettings();
  const enNote = document.querySelector('#voice-note').textContent;
  t('英文缺音色时如实说明（不谎称音质好）', /系统默认英文引擎|英语语音/.test(enNote));
  t('英文缺音色时仍承诺可朗读（有 locale 兜底）', /仍可朗读/.test(enNote));
  window.setTeachLang('zh', { quiet: true });

  console.log('\n=== 9. 语言贯穿全链路（不只讲课，还有诊断卷/课件/小结） ===');
  // 用户视角的坑：选了英文授课，结果诊断卷、课件、小结还是中文 —— 精神分裂
  const srcLang = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  t('有统一的语言指令函数', typeof window.langNote === 'function');
  window.setTeachLang('zh', { quiet: true });
  t('中文模式下语言指令为空（不干扰原文案）', window.langNote('题干') === '');
  window.setTeachLang('en', { quiet: true });
  t('英文模式下给出英语书写要求', /English/.test(window.langNote('题干')));
  t('诊断卷提示词跟随语言', /English/.test(window.diagnosticSystemPrompt()));
  window.setTeachLang('zh', { quiet: true });
  t('诊断卷中文模式不含英语要求', window.diagnosticSystemPrompt().indexOf('must be') < 0);
  t('课件提示词已接语言指令', /langNote\('每页标题/.test(srcLang));
  t('小结提示词已接语言指令', /langNote\('课堂小结/.test(srcLang));
  t('生成课程时记录 genLang（供课程卡片标注）', /genLang: teachLang\(\)/.test(srcLang));
  t('课程卡片标注英文授课', /English 授课/.test(srcLang));

  console.log('\n=== 10. 语言入口在生成页（不用猜长按手势） ===');
  t('生成页有语言选择容器', !!document.querySelector('#gen-lang'));
  window.setTeachLang('en', { quiet: true });
  window.renderVoiceSettings();
  const genChips = Array.from(document.querySelectorAll('#gen-lang [data-lang]'));
  t('生成页渲染出两种语言', genChips.length === 2);
  t('生成页当前语言高亮正确', document.querySelector('#gen-lang .chip.active').dataset.lang === 'en');
  t('生成页与语音面板同源（改一处两处同步）', document.querySelector('#voice-langs .chip.active').dataset.lang === 'en');
  window.setTeachLang('zh', { quiet: true });
  window.localStorage.removeItem('lingxi_teach_lang');

  console.log('\n=== 11. 像真人说话（说话方式规则） ===');
  // 实测基线：修改前平均句长 29 字、最长 77 字、口语词 0 次
  //          修改后 19 字 / 37 字 / 有口语词。这里把规则钉住防回退。
  const srcTalk = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const prompt = window.teacherSystemPrompt({ id: 't', title: '分数的认识', subject: '数学', grade: '三年级', level: '基础巩固', duration: '45 分钟', system: 'cn', slides: [] });
  t('规则已注入系统提示词', /【说话方式/.test(prompt));
  t('要求短句（20 字以内 / 一回合 2~4 句）', /一句基本 20 字以内/.test(prompt));
  t('要求使用口语词', /咱们""你看""来/.test(prompt));
  t('禁止格式标记（列表/加粗/标题）', /绝对不要用任何格式标记/.test(prompt));
  t('禁止逐条念课件', /不要念课件/.test(prompt));
  t('数字符号要求口语读法', /三分之一"不说 1\/3/.test(prompt));
  t('禁止 AI 自我指涉开场', /禁止"我是 AI"/.test(prompt));
  t('要求一次只问一个问题', /一次只问一个问题/.test(prompt));
  t('要求先接住情绪再讲内容', /先接住情绪再讲内容/.test(prompt));
  t('规则写在常量里便于维护', /const REAL_TALK_RULE =/.test(srcTalk));
  // 朗读音高：基准 1.0（原 1.06 偏"播报腔"），再按语气做小幅微调
  // ★ 2026-09-24 变更：从"全体固定 1.0"改为"基准 1.0 + 按句微调"，
  //   因为固定音高正是"像机器人"的主因（问句不扬、结论不沉，全程一个调）。
  t('朗读音高以 1.0 为基准（不再固定偏高）', /u\.pitch = Math\.max\(0\.5, Math\.min\(2, plan\.pitch \|\| 1\.0\)\)/.test(srcTalk));
  t('音高按语气微调（幅度小，不会像变声）', (() => {
    if (typeof window.speechProsody !== 'function') return false;
    const q = window.speechProsody('你想想看，这一步为什么要这样？');
    const c = window.speechProsody('所以，最后要记住这个结论。');
    const n = window.speechProsody('我们看一下这道题。');
    const okRange = [q, c, n].every((p) => p.pitch >= 0.9 && p.pitch <= 1.15);
    return q.pitch > n.pitch && c.pitch < n.pitch && okRange;
  })());

  console.log('\n=== 12. 竞态与中断（实测抓到的两个真问题） ===');
  const srcRace = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  // 问题1：Esc/暂停只 abort 了网络流，TTS 队列里的句子还在继续念（实测队列堆到 5 条）
  const escBlock = srcRace.match(/Esc 键：快速打断[\s\S]{0,700}?\n  \}\);/);
  t('R1 Esc 打断时会同时停朗读', !!escBlock && /stopSpeech\(\)/.test(escBlock[0]));
  const stopBtnBlock = srcRace.match(/\$\('#btn-stop'\)\.addEventListener[\s\S]{0,500}?\n  \}\);/);
  t('R2 暂停按钮也会停朗读', !!stopBtnBlock && /stopSpeech\(\)/.test(stopBtnBlock[0]));
  t('R3 打断仍保留网络流中断（没把原逻辑改坏）', /pendingInterrupt/.test(srcRace) && /controller\.abort\(\)/.test(srcRace));
  // 实测补充：老师"话已说完但声音还在念"时 busy 已是 false，只处理 busy 会导致 Esc 无反应
  t('R3b Esc 在"仅在朗读"时也能停声音', /TTS\.speaking \|\| TTS\.queue\.length/.test(srcRace));
  // 实测补充：preventDefault 不阻止冒泡 → 关弹窗会顺带打断老师
  const a11yBlock = srcRace.match(/function bindModalA11yKeys[\s\S]{0,1400}?\n\}/);
  t('R3c 关弹窗时阻止事件继续冒泡（避免连带打断老师）', !!a11yBlock && (a11yBlock[0].match(/stopPropagation\(\)/g) || []).length >= 2);
  // 问题2：课堂中途刷新 → 进度与回放全丢（原来只在下课时保存）
  t('R4 有课堂检查点函数', typeof window.checkpointLive === 'function');
  t('R5 进课堂会启动定期落盘', /startLiveCheckpoint\(\);/.test(srcRace) && /setInterval\(\(\) => \{ try \{ checkpointLive\(\)/.test(srcRace));
  t('R6 页面离开前会补存一次', /beforeunload[\s\S]{0,120}?checkpointLive\(\)/.test(srcRace));
  t('R7 切到后台时也会存', /visibilitychange[\s\S]{0,160}?checkpointLive\(\)/.test(srcRace));
  t('R8 结束课堂会停掉定时器', /stopLiveCheckpoint\(\);/.test(srcRace));
  t('R9 检查点不会覆盖更高的进度', /Math\.max\(course\.progress \|\| 0,/.test(srcRace));
  // 检查点在没有 live / 没有录音时要安全返回
  window.state.live = null;
  t('R10 无课堂时检查点安全返回', window.checkpointLive() === false);
  window.state.live = { ended: true, course: { id: 'x' }, recording: [{ type: 'speak', v: 'a' }], recStart: Date.now() };
  t('R11 已结束的课堂不再写检查点', window.checkpointLive() === false);
  window.state.live = { course: { id: 'y' }, recording: [], recStart: Date.now() };
  t('R12 没有录音内容时不写（避免无意义落盘）', window.checkpointLive() === false);
  window.state.live = null;

  console.log('\n=== 13. 长会话"失忆"补偿 ===');
  // 原来窗口只有 14 条（≈7 轮），45 分钟的课有 30~60 轮 → 老师会忘掉 7 轮前学生说的一切
  t('L1 窗口已放宽到 30 条', window.LIVE_HISTORY_KEEP === 30);
  t('L2 有"更早聊过"的补偿函数', typeof window.droppedStudentNotes === 'function');
  t('L3 没被截断时不产生补偿段', window.droppedStudentNotes([]) === '');

  // 构造 49 条可见消息，早期埋入关键信息
  const FACT = '我这次考试不考小数，老师你别讲小数了';
  const msgs = [
    { role: 'assistant', content: '同学你好' },
    { role: 'user', content: FACT },
    { role: 'assistant', content: '好的，跳过小数' },
  ];
  for (let i = 0; i < 23; i++) {
    msgs.push({ role: 'user', content: '第' + i + '轮我说了什么' });
    msgs.push({ role: 'assistant', content: '第' + i + '轮回复' });
  }
  const savedCourse = window.state.live && window.state.live.course;
  window.state.live = {
    course: { id: 'ctx', title: '分数的认识', subject: '数学', grade: '三年级', level: '基础巩固', duration: '45 分钟', system: 'cn', slides: [], outline: null },
    messages: msgs, recording: [], peers: [], recStart: Date.now(), slideIndex: 0, ended: false,
  };
  const built = window.buildLiveMessages(null);
  const turns = built.filter((m) => m.role !== 'system');
  const sys = built.find((m) => m.role === 'system').content;
  const json = JSON.stringify(built);
  t('L4 对话轮次被限制在窗口内', turns.length <= window.LIVE_HISTORY_KEEP, 'turns=' + turns.length);
  t('L5 早期关键信息已不在对话历史里（确认真的被挤出）', !turns.some((m) => String(m.content).indexOf(FACT) >= 0));
  t('L6 ★ 但整体上下文里仍然保留（老师不会失忆）', json.indexOf(FACT) >= 0);
  t('L7 补偿段注入在 system 里', /本节更早聊过的内容/.test(sys));
  t('L8 补偿段提醒"不要重复问他答过的"', /不要重复问他已经回答过的事/.test(sys));
  t('L9 角色交替仍然合法（补偿没破坏结构）', (() => {
    let bad = 0;
    for (let i = 1; i < turns.length; i++) if (turns[i].role === turns[i - 1].role) bad++;
    return bad === 0 && (!turns.length || turns[0].role === 'user');
  })());
  t('L10 补偿只取学生发言（老师的旧话不需重复）', (() => {
    const n = window.droppedStudentNotes([
      { role: 'assistant', content: '老师A' }, { role: 'user', content: '学生B' },
    ]);
    return n.indexOf('学生B') >= 0 && n.indexOf('老师A') < 0;
  })());
  t('L11 补偿条数有上限（不会无限长）', (() => {
    const many = [];
    for (let i = 0; i < 80; i++) many.push({ role: 'user', content: '学生话' + i });
    const n = window.droppedStudentNotes(many);
    const cnt = (n.match(/· /g) || []).length;
    return cnt <= window.LIVE_DROPPED_KEEP;
  })());
  t('L12 单条补偿被截断（避免某句超长撑爆）', (() => {
    const n = window.droppedStudentNotes([{ role: 'user', content: 'x'.repeat(500) }]);
    return n.length < 200;
  })());
  window.state.live = savedCourse ? { course: savedCourse, messages: [], recording: [], recStart: Date.now(), ended: false } : null;

  console.log('\n=== 15. 课型（让不同课型真的换教法） ===');
  const srcType = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  t('T1 定义了多个课型', Array.isArray(window.COURSE_TYPES) && window.COURSE_TYPES.length >= 5,
    'n=' + (window.COURSE_TYPES || []).length);
  t('T2 每个课型都有 id/名称/图标/描述', window.COURSE_TYPES.every(
    (t) => t.id && t.name && t.ico && t.desc));
  t('T3 每个课型都有独立的推进方式与授课要求', window.COURSE_TYPES.every(
    (t) => t.outline && t.teach && t.stages));
  t('T4 课型之间真的不同（不是换个名字）', (() => {
    const outs = window.COURSE_TYPES.map((t) => t.outline);
    const teaches = window.COURSE_TYPES.map((t) => t.teach);
    return new Set(outs).size === outs.length && new Set(teaches).size === teaches.length;
  })());
  t('T5 未知/缺失课型有兜底', window.getCourseType('不存在') === window.COURSE_TYPES[0]);
  t('T6 生成大纲时会带上课型要求', (() => {
    const old = window.state.gen.type;
    window.state.gen.type = 'error';
    const txt = window.courseTypeBlock();
    window.state.gen.type = old;
    return /错题讲评/.test(txt) && /错因/.test(txt) && /环节骨架/.test(txt);
  })());
  t('T7 老师授课提示词里会带课型教法', (() => {
    const c = { id: 'c1', title: 'T', subject: '数学', grade: '初三', level: '基础巩固',
      duration: '45 分钟', system: 'cn', slides: [], type: 'review' };
    const p = window.teacherSystemPrompt(c);
    return /本节课型/.test(p) && /复习巩固/.test(p);
  })());
  t('T8 老课程（没有 type 字段）不会报错、不塞课型块', (() => {
    const c = { id: 'c2', title: 'T', subject: '数学', grade: '初三', level: '基础巩固',
      duration: '45 分钟', system: 'cn', slides: [] };
    const p = window.teacherSystemPrompt(c);
    return typeof p === 'string' && p.length > 100 && !/本节课型/.test(p);
  })());
  t('T9 卡片上会显示课型标签', /tag type/.test(srcType) && /COURSE_TYPES\.find\(\(x\) => x\.id === course\.type\)/.test(srcType));
  t('T10 课型写进课程对象（可回溯）', /type: state\.gen\.type/.test(srcType));
  t('T11 生成页有课型选择且能绑定', /#gen-types/.test(srcType) && /bindChips\('#gen-types'/.test(srcType));
  t('T12 课型默认值合法', window.COURSE_TYPES.some((t) => t.id === window.state.gen.type));

  console.log('\n=== 16. 老师形象（插画为默认，不吓到小孩） ===');
  t('A1 老师脸只有一份来源（三处复用）',
    typeof window.teacherFaceSVG === 'function' &&
    (srcType.match(/teacherFaceSVG\(\{/g) || []).length >= 3);
  t('A2 老师脸的 SVG 只定义一处（调用点不再内联重复）', (() => {
    // 只允许在 teacherFaceSVG 里出现一次；聊天头像/正在输入/直播间都必须走函数
    const defs = (srcType.match(/<svg viewBox="0 0 96 96"/g) || []).length;
    const calls = (srcType.match(/teacherFaceSVG\(\{/g) || []).length;
    return defs === 1 && calls >= 3;
  })(), 'defs=' + (srcType.match(/<svg viewBox="0 0 96 96"/g) || []).length + ' calls=' + (srcType.match(/teacherFaceSVG\(\{/g) || []).length);
  t('A3 默认用插画形象（不是真人照片）', window.avatarStyle() === 'illust');
  t('A4 可以切到真人形象并记住', (() => {
    window.setAvatarStyle('photo');
    const ok = window.avatarStyle() === 'photo';
    window.setAvatarStyle('illust');
    return ok && window.avatarStyle() === 'illust';
  })());
  t('A5 非法取值回落到插画（不会白屏）', (() => {
    window.setAvatarStyle('乱填');
    const ok = window.avatarStyle() === 'illust';
    return ok;
  })());
  t('A6 照片加载失败时回退插画', /img\.onerror = \(\) => \{[\s\S]{0,200}?AVATAR\.ready = false/.test(srcType));
  t('A7 照片不再自动顶掉插画（原来加载成功就替换）',
    !/\$\('#teacher-photo'\)\.hidden = false;\s*\n\s*const av = \$\('#teacher-avatar'\);\s*\n\s*if \(av\) av\.style\.display = 'none';/.test(srcType));
  t('A8 设置面板里能选形象', /id="voice-avatars"/.test(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')) &&
    /data-avatar="illust"/.test(srcType) && /data-avatar\b/.test(srcType));
  t('A9 插画形象带耳机（直播课老师）', /headset/.test(srcType) && /F97316/.test(window.teacherFaceSVG({})));
  t('A10 插画可指定尺寸且渐变 id 唯一（多张头像不串色）', (() => {
    // 注意：不能拿 'x2' 当判据 —— linearGradient 自带 x2 属性，会误判
    const a = window.teacherFaceSVG({ size: 32, uid: 'x1' });
    const b = window.teacherFaceSVG({ size: 96, uid: 'x2' });
    return /width="32"/.test(a) && /width="96"/.test(b) &&
      /id="tfx1"/.test(a) && /id="tfx2"/.test(b) &&
      a.indexOf('tfx2') < 0 && b.indexOf('tfx1') < 0;
  })());

  console.log('\n=== 17. 语音自然度（去掉机器人感） ===');
  t('S1 有韵律函数', typeof window.speechProsody === 'function');
  t('S2 问句音高上扬、停顿更长（留时间思考）', (() => {
    const q = window.speechProsody('你觉得这一步为什么要先通分呢？');
    const n = window.speechProsody('我们看下一道题。');
    return q.pitch > n.pitch && q.pause > n.pause;
  })());
  t('S3 结论句压低放慢（有分量）', (() => {
    const c = window.speechProsody('所以，最后要记住这个结论。');
    const n = window.speechProsody('我们看下一道题。');
    return c.pitch < n.pitch && c.rate < n.rate;
  })());
  t('S4 鼓励句更暖', (() => {
    const e = window.speechProsody('很好，你这个思路很稳！');
    const n = window.speechProsody('我们看下一道题。');
    return e.pitch > n.pitch;
  })());
  t('S5 含数字/算式会放慢（听不清数字=白讲）',
    window.speechProsody('把 3/4 和 5/6 相加').rate < window.speechProsody('我们看这个式子').rate);
  t('S6 韵律幅度小（大了像变声）', (() => {
    const all = ['这是？', '很好！', '所以结论是', '第一步先通分', '3+4=7', '看这里'];
    return all.every((s) => { const p = window.speechProsody(s); return p.pitch >= 0.9 && p.pitch <= 1.15 && p.rate >= 0.9 && p.rate <= 1.05; });
  })());
  t('S7 短句不拖长停顿（否则一顿一顿）', (() => {
    const short = window.speechProsody('好。');
    const long = window.speechProsody('这是一个比较长的句子，用来说明一个完整的教学结论。');
    return short.pause <= long.pause;
  })());
  t('S8 空输入安全', (() => { const p = window.speechProsody(''); return p.rate === 1 && p.pitch === 1; })());
  t('S9 朗读计划带韵律（不是纯字符串）', (() => {
    const plan = window.speechPlan('好。你觉得为什么？');
    return Array.isArray(plan) && plan.length >= 1 &&
      plan.every((x) => x.text && typeof x.rate === 'number' && typeof x.pitch === 'number' && typeof x.pause === 'number');
  })());
  /* 窗口从 220 放宽到 700：这条断言的是"done 里有句间留白"这个行为，
     不是"留白代码离函数开头多少字符"。2026-09-27 给 done 加了幂等与计时器清理，
     把 setTimeout 挤出了原来的窄窗口 → 假失败（行为一直是对的）。 */
    t('S10 句间有停顿（原来零间隔=像机枪）', /const done = \(\) => \{[\s\S]{0,700}?setTimeout\(resolve, wait\)/.test(srcType));
  t('S11 音色按自然度分级', (() => {
    return window.voiceTier('Microsoft Xiaoxiao Online (Natural)').tier === 4 &&
      window.voiceTier('Microsoft Huihui - Chinese').tier === 2 &&
      window.voiceTier('某种奇怪音色').tier === 1;
  })());
  t('S12 选音色时优先自然音色（不只是看名字）',
    /voiceTier\(v\.name \|\| ''\)\.tier \* 10/.test(srcType));
  t('S13 只有基础音色时如实告知并给安装办法',
    /q\.tier <= 2/.test(srcType) && /时间和语言/.test(srcType));
  t('S14 音色质量为真人才算自然档', window.voiceTier('Microsoft Yunxi Online (Natural)').label === '自然音色');

  console.log('\n=== 18. 课件图示（以前课件完全没有图） ===');
  const srcFig = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  t('F1 支持多种图示类型', Array.isArray(window.FIGURE_KINDS) && window.FIGURE_KINDS.length >= 6,
    JSON.stringify(window.FIGURE_KINDS));
  t('F2 数轴能画出来', /<svg/.test(window.figureSVG({ kind: 'numberline', min: -5, max: 5, marks: [{ at: -2, label: '-2' }] })));
  t('F3 对比条形能画出来', /<rect/.test(window.figureSVG({ kind: 'bars', items: [{ label: '甲', value: 3 }, { label: '乙', value: 5 }] })));
  t('F4 占比图能画出来', /path|circle/.test(window.figureSVG({ kind: 'pie', slices: [{ label: '已分', value: 3 }, { label: '剩', value: 1 }] })));
  t('F5 面积模型能画出来', /<rect/.test(window.figureSVG({ kind: 'rect', w: 4, h: 3 })));
  t('F6 三角形能画出来', /<path/.test(window.figureSVG({ kind: 'triangle', labels: ['A', 'B', 'C'] })));
  t('F7 函数图象能画出来', /<polyline/.test(window.figureSVG({ kind: 'function', points: [[0, 0], [1, 2], [2, 4]] })));
  t('F8 未知类型不渲染（宁可不画也不画错）', window.figureSVG({ kind: '乱写' }) === '');
  t('F9 数据不足不渲染', window.figureSVG({ kind: 'bars', items: [{ label: 'a', value: 1 }] }) === '' &&
    window.figureSVG({ kind: 'pie', slices: [{ label: 'a', value: 1 }] }) === '');
  t('F10 数轴范围非法不渲染', window.figureSVG({ kind: 'numberline', min: 5, max: 5 }) === '');
  t('F11 标签做了转义（防注入）', (() => {
    const svg = window.figureSVG({ kind: 'bars', items: [{ label: '<img src=x onerror=alert(1)>', value: 3 }, { label: 'b', value: 1 }] });
    return svg.indexOf('<img') < 0 && svg.indexOf('&lt;img') >= 0;
  })());
  t('F12 离谱坐标被夹住（不会画出天外飞线）', (() => {
    const svg = window.figureSVG({ kind: 'function', points: [[0, 0], [1e9, -1e9], [2, 2]] });
    return /<svg/.test(svg) && !/e\+|Infinity|NaN/.test(svg);
  })());
  t('F13 normalizeFigure 丢弃非法输入', window.normalizeFigure(null) === null &&
    window.normalizeFigure({ kind: 'x' }) === null &&
    !!window.normalizeFigure({ kind: 'numberline', min: -3, max: 3 }));
  t('F14 normalizeFigure 只保留该类型字段（模型多余输出不进渲染）', (() => {
    const f = window.normalizeFigure({ kind: 'triangle', labels: ['A', 'B', 'C'], hack: '<script>', points: [[1, 1], [2, 2]] });
    return f && f.hack === undefined && f.points === undefined;
  })());
  t('F15 生成提示词要求用结构化数据画图且不许写 SVG',
    /不要写 SVG 代码/.test(srcFig) && /【示意图 figure】按这一页的知识点属于哪一类/.test(srcFig));
  t('F16 老师知道课件有图并会引导看图', /本页有一张「/.test(srcFig) && /讲解时要明确让学生看图/.test(srcFig));
  t('F17 课件页会渲染图（图文分栏）', /sl-fig-wrap/.test(srcFig) && /sl-figure/.test(srcFig));
  t('F18 图有类型名可用于描述', window.figureCaption({ kind: 'numberline' }) === '数轴' &&
    window.figureCaption({ kind: 'pie', title: '蛋糕分配' }) === '蛋糕分配');
  /* ★ 这两条原来在断言"裸 SVG 插入 + 一句 try/catch"——而实测证明那个写法
     **只要课件带图就让整个导出失败**（缺 data: 前缀，且在 write() 阶段才报错）。
     现在改为断言正确做法：转 PNG 再插。 */
  t('F19 PPT 导出会带上图（转 PNG 后插入）',
    /const png = await svgToPngDataURL\(svg, 900, 450\)/.test(srcFig) &&
    /slide\.addImage\(\{ data: data,/.test(srcFig));
  t('F20 图示转换失败时退回 SVG 兜底，不让导出失败也不丢图',
    /const data = png \|\| svgDataURI\(svg\)/.test(srcFig));
  t('F21 课件 CSS 有图文分栏与手机竖排', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    return /\.sl-fig-wrap/.test(css) && /\.sl-figure/.test(css);
  })());
  t('F22 提示词约束了每种图的使用场景（避免用三角形表示"传播"这类误用）',
    /就是几何图形本身（内角和、全等、相似） → triangle/.test(srcFig) &&
    /用三角形表示"声音传播"/.test(srcFig));

  console.log('\n=== 20. 生成降级不能静默（用户会以为成功了） ===');
  t('D1 解析失败会标记在课程对象上', /course\.outlineFailed = true/.test(srcFig));
  t('D2 会明确提示用户（不只是悄悄换标题）', /这节课的结构没生成完整，已先用简化版顶上/.test(srcFig));
  t('D3 降级有埋点可统计发生率', /track\('outline_parse_failed'/.test(srcFig) &&
    /'outline_parse_failed'/.test(srcFig.slice(srcFig.indexOf('const TRACK_EVENTS'), srcFig.indexOf('const TRACK_EVENTS') + 2600)));
  t('D4 卡片上有显眼的降级提示（不是藏在原文里的小字）',
    /cc-degraded/.test(srcFig) && /这节课的结构没生成完整 —— 下面是模型返回的原文方案/.test(srcFig));
  t('D5 降级提示有样式', /\.cc-degraded/.test(fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8')));

  console.log('\n=== 21. 生成卡死必须能自愈（实测卡了 60 秒无人管） ===');
  const srcStall = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  t('S1 有"无进展"预算常量', /const STALL_BUDGET_MS = \d+/.test(srcStall));
  t('S2 流式过程中会持续记录进展时间', /if \(delta\.reasoning_content \|\| delta\.content\) lastProgressAt = Date\.now\(\)/.test(srcStall));
  t('S3 超时未进展会主动中断请求', /stalled = true; relay\(\)/.test(srcStall));
  t('S4 看门狗会被清理（不泄漏定时器）', /clearInterval\(stall\)/.test(srcStall));
  t('S5 卡死有独立错误码', /code: 'client_stream_stalled'/.test(srcStall));
  t('S6 卡死会走换模型重试（不只报错）', /errCode\(lastErr\) === 'client_stream_stalled'/.test(srcStall));
  t('S7 中断抛出的 AbortError 也归入卡死（否则不走重试）', /if \(!timedOut && !stalled\)/.test(srcStall) && /else if \(stalled\) \{/.test(srcStall));
  t('S8 要求 JSON 时半截结果不能当成功返回（否则静默降级）',
    /const wantsJson = !!responseFormat/.test(srcStall) && /if \(stalled\) \{\s*\n\s*if \(wantsJson\)/.test(srcStall));
  t('S9 用户能看到说人话的提示', /生成过程卡住了（模型中途没有继续返回）/.test(srcStall));
  t('S10 卡死与"太慢"的切换提示分开说（用户有权知道是哪种）',
    /讲到一半没有继续返回，已自动切换到/.test(srcStall) && /当前模型响应太慢，已自动切换到/.test(srcStall));

  console.log('\n=== 19. 移动端（390px 横滑不可用）修复 ===');
  t('M1 grid 列用 minmax(0,1fr)（1fr 会被内容撑宽）', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    return /\.meet-body \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 316px/.test(css);
  })());
  t('M2 单列断点也用 minmax', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    return /\.meet-body \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css);
  })());
  t('M3 grid/flex 子项补了 min-width:0', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    return /\.meet-main \{[^}]*min-width: 0/.test(css) && /\.meet-strip \{[^}]*min-width: 0/.test(css);
  })());
  t('M4 触屏把主要控件抬到 44px', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (pointer: coarse)'));
    return /min-height: 44px/.test(block) && /#btn-burger/.test(block) && /\.quick-chip/.test(block);
  })());
  t('M5 触控样式只作用于触屏（不影响桌面）', /@media \(pointer: coarse\)/.test(
    fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8')));
  t('M6 触控块含发送键与输入框（iPad 768px 落在 760 断点之外，实测只有 34px 高）',
    (() => {
      const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
      const start = css.indexOf('@media (pointer: coarse)');
      // 必须从 start **之后**再找结束标记 —— 文件里在它之前也有 prefers-reduced-motion
      // （开屏动画那段），直接用 indexOf 会取到前面那个，切片变空（已踩过）
      const after = css.indexOf('@media (prefers-reduced-motion', start + 10);
      const block = css.slice(start, after > start ? after : css.length);
      return /#btn-send/.test(block) && /#chat-input/.test(block);
    })());

  console.log('\n=== 22. 无障碍：焦点与标签（实测发现的问题） ===');
  const srcA11y = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlA11y = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssA11y = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  t('A11y1 弹窗有焦点陷阱（实测 Tab 12 次有 7 次跑到背景页面）',
    /function trapModalFocus\(ev\)/.test(srcA11y) && /trapModalFocus\(ev\);/.test(srcA11y));
  t('A11y2 焦点陷阱在捕获阶段绑定（先于其它按键处理）',
    /document\.addEventListener\('keydown', \(ev\) => \{\s*\n\s*trapModalFocus\(ev\);/.test(srcA11y));
  t('A11y3 陷阱会在首尾之间循环', /ev\.shiftKey && active === first/.test(srcA11y) &&
    /!ev\.shiftKey && active === last/.test(srcA11y));
  t('A11y4 弹窗内没有可聚焦元素时也不让焦点跑出去', /if \(!items\.length\) \{ ev\.preventDefault\(\); return; \}/.test(srcA11y));
  t('A11y5 焦点已在弹窗外时拉回第一个', /if \(!top\.contains\(active\)\)/.test(srcA11y));
  t('A11y6 学段下拉有 label 关联（原来只有视觉文字，读屏读不到）', /<label for="gen-grade">/.test(htmlA11y));
  t('A11y7 学习目标输入框有 label 关联', /<label for="gen-goal">/.test(htmlA11y));
  t('A11y8 有"跳到主内容"链接（原来要按 43 次 Tab 才到主操作）',
    /class="skip-link"/.test(htmlA11y) && /href="#main-content"/.test(htmlA11y) && /id="main-content"/.test(htmlA11y));
  t('A11y9 跳转目标可接收焦点', /<main id="main-content" tabindex="-1">/.test(htmlA11y));
  t('A11y10 有 skip-link 样式且聚焦可见', /\.skip-link/.test(cssA11y) && /\.skip-link:focus/.test(cssA11y));
  t('A11y11 键盘焦点有可见轮廓（:focus-visible）', /:focus-visible/.test(cssA11y));
  t('A11y12 弹窗声明了 dialog 语义（原来已声明，但没配焦点陷阱 → 现在配上了）',
    /mask\.setAttribute\('aria-modal', 'true'\)/.test(srcA11y) && /function trapModalFocus/.test(srcA11y));
  t('A11y13 回放播放键有可访问名且随状态更新（原来只有 ▶/⏸ 符号）',
    /aria-label="播放回放"/.test(htmlA11y) &&
    /setAttribute\('aria-label', '暂停回放'\)/.test(srcA11y) &&
    /setAttribute\('aria-label', '播放回放'\)/.test(srcA11y));
  t('A11y14 模态关闭键统一补了可访问名（既有实现，防止回退）',
    /if \(!b\.getAttribute\('aria-label'\)\) b\.setAttribute\('aria-label', '关闭'\)/.test(srcA11y));
  t('A11y15 汉堡菜单名字随开关切换（既有实现，防止回退）',
    /btn\.setAttribute\('aria-label', open \? '关闭导航菜单' : '打开导航菜单'\)/.test(srcA11y));

  console.log('\n=== 23. 开屏动画（CSP 安全 + 有兜底） ===');
  const srcSplash = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlSplash = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssSplash = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  t('SP1 开屏是纯 HTML+CSS（不含内联脚本 —— CSP 会静默拦掉）', (() => {
    const i = htmlSplash.indexOf('class="splash"');
    const block = htmlSplash.slice(i - 400, i + 900);
    return block.indexOf('<script') < 0;
  })());
  t('SP2 CSS 有自动淡出兜底（app.js 挂了也不能永久遮屏）',
    /animation: splash-auto-out 0\.55s ease 7s forwards/.test(cssSplash));
  t('SP3 JS 就绪后会提前收（init 末尾调 hideSplash）',
    /try \{ hideSplash\(\); \} catch/.test(srcSplash) && /function hideSplash\(\)/.test(srcSplash));
  t('SP4 收尾会把开屏彻底移除（不再占点击层）',
    /setTimeout\(\(\) => \{ try \{ el\.remove\(\); \} catch \(_\) \{\} \}, 700\)/.test(srcSplash));
  t('SP5 重复调用安全（dataset.done 幂等）', /if \(!el \|\| el\.dataset\.done\) return;/.test(srcSplash));
  t('SP6 装饰性内容对读屏隐藏', /class="splash" id="splash" aria-hidden="true"/.test(htmlSplash));
  t('SP7 尊重"减少动效"偏好', /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,600}?splash/.test(cssSplash));
  t('SP8 开屏在 body 最前（先于页面内容出现）',
    htmlSplash.indexOf('id="splash"') < htmlSplash.indexOf('<header class="nav">'));

  console.log('\n=== 24. 生成可取消（原来按钮 disabled，只能干等或刷新） ===');
  t('G1 生成中按钮可点（否则取消不了）', /btn\.disabled = false;                 \/\/ 必须可点/.test(srcSplash));
  t('G2 生成中按钮文案变为取消', /btn\.textContent = '✕ 取消生成'/.test(srcSplash));
  t('G3 再点一次是取消而不是重复生成', /function onGenerateClick\(\)/.test(srcSplash) &&
    /if \(genBusy\) \{/.test(srcSplash) && /genController\.abort\(\)/.test(srcSplash));
  t('G4 取消挂到真实请求的 controller 上', /const controller = genController;/.test(srcSplash));
  t('G5 结束/取消后按钮恢复且仍可点（finally）',
    /genBusy = false;\s*\n\s*genController = null;\s*\n\s*syncGenButton\(\);/.test(srcSplash));
  t('G6 取消态有可辨识样式', /#btn-generate\.btn-cancel/.test(cssSplash));
  t('G7 取消态有无障碍名', /setAttribute\('aria-label', '取消生成'\)/.test(srcSplash));
  t('G8 旧的"生成中，请稍候…"禁用逻辑已移除',
    !/btn\.textContent = '生成中，请稍候…'/.test(srcSplash));
  t('G9 启动耗时诊断有埋点且已进白名单', /track\('boot_slow'/.test(srcSplash) &&
    /'boot_slow'/.test(srcSplash.slice(srcSplash.indexOf('const TRACK_EVENTS'), srcSplash.indexOf('const TRACK_EVENTS') + 2800)));
  t('G10 取消后不产出任何课程（streamChat 在 abort 时是"返回半截"而不是抛错）',
    /if \(controller && controller\.signal\.aborted\) \{[\s\S]{0,260}?toast\('已取消生成'\);[\s\S]{0,40}?return;/.test(srcSplash));
  t('G11 取消后界面回到"未生成"状态，不留下半截流式区',
    /if \(controller && controller\.signal\.aborted\) \{[\s\S]{0,120}?streamBox\.hidden = true;[\s\S]{0,80}?\$\('#gen-empty'\)\.hidden = false;/.test(srcSplash));

  console.log('\n=== 25. 新增科目：计算机科学 / 会计 ===');
  const SUBJ_CN = (window.SYSTEMS.find((s) => s.id === 'cn') || {}).subjects || [];
  const SUBJ_INTL = (window.SYSTEMS.find((s) => s.id === 'intl') || {}).subjects || [];
  const namesCN = SUBJ_CN.map((s) => s.name);
  const namesIntl = SUBJ_INTL.map((s) => s.name);
  t('X1 国内有"计算机科学"', namesCN.indexOf('计算机科学') >= 0, namesCN.join('/'));
  t('X2 国内有"会计"', namesCN.indexOf('会计') >= 0);
  t('X3 国内保留"编程"（与计算机科学分工不同：前者青少年启蒙，后者系统知识）',
    namesCN.indexOf('编程') >= 0);
  t('X4 国际有计算机科学（统一成"英文 + 中文"命名）',
    namesIntl.some((n) => /Computer Science 计算机科学/.test(n)), namesIntl.join('/'));
  t('X5 国际有会计', namesIntl.some((n) => /Accounting 会计/.test(n)));
  t('X6 国际会计挂在有该科目的考纲下（AP 无独立会计科，不应挂 ap）', (() => {
    const a = SUBJ_INTL.find((s) => /Accounting 会计/.test(s.name));
    return !!a && a.boards.indexOf('ap') < 0 && a.boards.indexOf('alevel') >= 0 && a.boards.indexOf('hkdse') >= 0;
  })());
  t('X7 每个科目都有 ico 与 desc（卡片渲染依赖）',
    namesCN.length > 0 && SUBJ_CN.every((s) => s.ico && s.desc) && SUBJ_INTL.every((s) => s.ico && s.desc));
  t('X8 科目名不重复（防止加错出现重复项）',
    new Set(namesCN).size === namesCN.length && new Set(namesIntl).size === namesIntl.length);

  console.log('\n=== 26. 让老师举例：从软要求改成硬要求 ===');
  t('Y1 有学科例子锚点表', typeof window.SUBJECT_EXAMPLES === 'object' || Array.isArray(window.SUBJECT_EXAMPLES));
  t('Y2 计算机科学的例子锚点具体（不是"举例说明"这种空话）', (() => {
    const h = window.subjectExampleHint({ subject: '计算机科学' });
    return h.length > 20 && /循环|数组|函数|调试/.test(h);
  })(), String(window.subjectExampleHint({ subject: '计算机科学' })).slice(0, 60));
  t('Y3 会计的例子锚点贴近生活', (() => {
    const h = window.subjectExampleHint({ subject: '会计' });
    return /奶茶|零花钱|折旧|记账|利润/.test(h);
  })(), String(window.subjectExampleHint({ subject: '会计' })).slice(0, 60));
  t('Y4 国际课程的中英混排科目名也能命中锚点（includes 容错）',
    window.subjectExampleHint({ subject: 'Computer Science 计算机科学' }).indexOf('循环') >= 0 &&
    window.subjectExampleHint({ subject: 'Accounting 会计' }).indexOf('折旧') >= 0);
  t('Y5 没有锚点的科目返回空串（不硬塞无关例子）', window.subjectExampleHint({ subject: '不存在的科目' }) === '');
  t('Y6 学段决定例子尺度（小学 vs 大学不同）', (() => {
    const a = window.exampleScaleHint({ grade: '小学' });
    const b = window.exampleScaleHint({ grade: '大学 / 成人' });
    return a !== b && /零食|玩具|游戏/.test(a) && /工作|数据|职业/.test(b);
  })());

  // 真正调一次提示词，确认不抛错且内容到位（拿真实运行验证，不靠读代码）
  const promptErr = [];
  let outlinePrompt = '';
  let systemPrompt = '';
  let teacherPrompt = '';
  try {
    window.state.gen.subject = '计算机科学';
    window.state.gen.level = '大学 / 成人';
    outlinePrompt = window.buildCourseOutlinePrompt();
  } catch (e) { promptErr.push('大纲提示词(user): ' + e.message); }
  try {
    systemPrompt = window.courseSystemPrompt();
  } catch (e) { promptErr.push('课程 system 提示词: ' + e.message); }
  try {
    const c = {
      subject: '会计', grade: '高中', system: 'cn', title: '会计入门',
      outline: { stages: [{ name: '导入', duration: '5 分钟', content: 'x' }], knowledgePoints: ['资产'] },
      slides: [{ type: 'content', title: '资产', bullets: ['要点'], note: 'x' }],
    };
    teacherPrompt = window.teacherSystemPrompt(c);
  } catch (e) { promptErr.push('老师提示词: ' + e.message); }
  t('Y7 三个提示词都能真实构造出来（不抛错）', promptErr.length === 0, promptErr.join(' | '));
  /* 注意：大纲/课件的要求写在 **system 提示词**里（courseSystemPrompt），
     而 buildCourseOutlinePrompt 只是拼"学生信息"的 user 消息 ——
     我第一版断言查错了对象，误判成"改动没生效"。 */
  t('Y8 课程 system 提示词要求把例子写进 note 且禁止空例子',
    /举例子（这条决定课上得生不生动/.test(systemPrompt) &&
    /禁止"小明买了 3 个苹果"这种空例子/.test(systemPrompt));
  t('Y9 课程 system 提示词带上了该学科的例子锚点（计算机科学）',
    /循环|数组|调试/.test(systemPrompt));
  t('Y9b user 提示词仍负责给出学生信息与课型骨架',
    /计算机科学/.test(outlinePrompt) && outlinePrompt.length > 100);
  t('Y10 老师提示词把举例列成硬要求并给了学科来源',
    /举例子：这是让课堂"活起来"的关键，不是可选项/.test(teacherPrompt) &&
    /奶茶|折旧/.test(teacherPrompt));
  t('Y11 老师提示词要求"折回定义"（别只讲故事）',
    /折回定义/.test(teacherPrompt) && /否则学生只记住了热闹/.test(teacherPrompt));
  t('Y12 老师提示词禁止重复用同一个例子', /不要重复用同一个例子/.test(teacherPrompt));
  t('Y13 老师提示词提醒类比不能失真（宁可平实也不能讲歪）',
    /类比不能失真/.test(teacherPrompt) && /把原理讲歪/.test(teacherPrompt));
  t('Y14 老师提示词带上学段尺度（会计/高中）', /考试分数|时间管理|兼职/.test(teacherPrompt));
  t('Y15 两处（大纲 system 与老师提示词）都要例子，口径一致',
    /折回定义/.test(systemPrompt) && /折回定义/.test(teacherPrompt));
  /* 读实际生成的课件发现：模型会把数轴/面积模型硬套给"循环次数""操作步骤" ——
     图没有真实坐标含义，等于装饰。提示词必须明确禁止"凑数的图"。 */
  /* 注意：图示相关断言必须在**数学类学科**下做 ——
     概念类学科现在连 figure 段落都不提供（这是最终修的方案）。 */
  let mathSystemPrompt = '';
  try {
    window.state.gen.subject = '数学';
    mathSystemPrompt = window.courseSystemPrompt();
  } catch (e) { promptErr.push('数学 system 提示词: ' + e.message); }
  t('Y16 提示词明确列出"必须配图"的六种情形（不能只说别凑数）',
    /【必须配图】/.test(mathSystemPrompt) && /几个量在比较/.test(mathSystemPrompt) &&
    /数轴上的位置、正负数、不等式解集/.test(mathSystemPrompt));
  t('Y17 提示词给了可操作的自检方法（遮住图看语义是否变化）',
    /把这张图遮住，这一页的意思会不会变/.test(mathSystemPrompt));
  t('Y18 提示词明确列出"禁止配图"的内容类型',
    /【禁止配图】/.test(mathSystemPrompt) && /概念定义、操作流程与步骤、变量与循环/.test(mathSystemPrompt));
  t('Y19 已删除"至少 N 页要带 figure"的配额（配额是凑数的动因）',
    !/至少 2 页\*\*要带 figure/.test(mathSystemPrompt));
  t('Y20 也不再是"默认不加图"（那会让数学课也不配图 —— 我实测踩过）',
    !/\*\*默认不加图\*\*/.test(mathSystemPrompt) && /通常是 2-4 页配图/.test(mathSystemPrompt));
  t('Y21 要求图上的数字必须来自本页真实知识点（不能现编一组数）',
    /图上的数字必须是\*\*这一页知识点里真实出现的数字\*\*/.test(mathSystemPrompt));
  /* ★ 试了三版提示词都不行（配额→凑数；默认不加图→漏；分类映射→仍然凑数），
     最终改成工程手段：不在白名单的学科，提示词里**连 JSON schema 都不含 figure**。
     schema 才是决定性的 —— 模型看到结构示例里有这个字段就会填。 */
  t('Y22 概念类学科的提示词里连 JSON schema 都不出现 figure', (() => {
    window.state.gen.subject = '计算机科学';
    const p = window.courseSystemPrompt();
    return p.indexOf('"figure"') < 0 && p.indexOf('【示意图 figure】') < 0;
  })());
  t('Y23 数学类学科的 JSON schema 与规则里都保留 figure', (() => {
    window.state.gen.subject = '数学';
    const p = window.courseSystemPrompt();
    return p.indexOf('"figure":{"kind":"numberline"') >= 0 && p.indexOf('【示意图 figure】') >= 0;
  })());
  t('Y24 白名单只放"图形本身就是知识载体"的学科', (() => {
    const ok = ['数学', '物理', '化学', '竞赛数学', 'Mathematics', 'Physics'];
    const no = ['计算机科学', '语文', '历史', '英语', '会计', 'Business', 'Economics'];
    return ok.every((s) => window.figureAllowed(s)) && no.every((s) => !window.figureAllowed(s));
  })());
  t('Y25 国际课程的中英混排名也能命中白名单',
    window.figureAllowed('Mathematics 数学') && window.figureAllowed('Further Math 进阶数学') &&
    window.figureAllowed('Physics 物理') === true);
  t('Y26 空/未选学科时不提供 figure（避免误配）', !window.figureAllowed('') && !window.figureAllowed(undefined));

  console.log('\n=== 27. 语音：一次异常不能导致永久静音（用户报"听不到老师说话"） ===');
  const srcTTS = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  /* 实测抓到的真实故障链：
     speakOne 里 u.voice = TTS.voice 抛异常（缓存的 voice 对象失效）
       → 异常冒泡出 drainSpeechQueue，跳过 TTS.speaking = false 那两行
       → TTS.speaking 永久为 true → 之后每次 speak() 都直接 return
       → 老师永久静音、队列一直积压（实测 speaking=true、队列 3 条、0 次出声） */
  t('T1 voice 赋值有保护（失效对象会抛异常，不能裸赋值）',
    /try \{\s*\n\s*u\.voice = TTS\.voice;\s*\n\s*\} catch \(e\) \{/.test(srcTTS));
  t('T2 语音对象失效时清缓存（下一句自动重挑，能自愈）',
    /TTS\.voice = null;/.test(srcTTS) && /tts_voice_stale/.test(srcTTS));
  t('T3 队列用 try/finally 复位（否则 speaking 永久卡在 true）', (() => {
    const i = srcTTS.indexOf('async function drainSpeechQueue');
    const block = srcTTS.slice(i, i + 1200);
    // finally 里必须复位 speaking —— 这是"永久静音"的关键
    return /\} finally \{\s*\n\s*TTS\.speaking = false;/.test(block) && /setSpeakingUI\(false\);/.test(block);
  })());
  t('T4 单条朗读失败不让整队列中断', /单条朗读失败，已跳过/.test(srcTTS));
  t('T5 speak() 抛错时会 done() 放行（否则 promise 永不 resolve）', (() => {
    const i = srcTTS.indexOf('function speakOne');
    const block = srcTTS.slice(i, i + 5200);   // 2026-09-27：加了兜底 2 后这段变长，窗口跟着放宽（断的是行为不是位置）
    return /try \{\s*\n\s*window\.speechSynthesis\.speak\(u\);/.test(block) && /done\(\);\s*\n\s*return;/.test(block);
  })());
  t('T6 引擎卡死（onstart/onend/onerror 都不触发）时会 cancel 重置并跳过',
    /卡死的引擎只能靠 cancel 重置/.test(srcTTS));
  t('T7 页面切后台被置 paused 时会 resume', /window\.speechSynthesis\.paused\) window\.speechSynthesis\.resume/.test(srcTTS));
  t('T8 队列卡死时不再有"走了却不复位"的出口（旧写法已移除）', (() => {
    const i = srcTTS.indexOf('async function drainSpeechQueue');
    const block = srcTTS.slice(i, i + 1200);
    // 旧写法：while 后紧跟 TTS.speaking = false（无 finally 保护）
    return !/while \(TTS\.queue\.length && TTS\.enabled\) \{[\s\S]{0,120}?\}\s*\n\s*TTS\.speaking = false;/.test(block);
  })());

  console.log('\n=== 28. 导出 PPT 优化（原来没有环节页/知识点页/作业页） ===');
  const srcPpt = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const pptBlock = (() => {
    const i = srcPpt.indexOf('async function exportPPTX');
    // 切片要够长：这个函数已经 13.6k 字符，尾部（导出完成的提示）在 12k 之后 ——
    // 我一开始切 12000，导致"尾部断言"全查不到（假失败）。
    return srcPpt.slice(i, i + 16000);
  })();
  t('P1 封面带课程信息（科目/学段/时长/课型）', /if \(metaLine\)/.test(pptBlock) &&
    /course\.subject, course\.grade/.test(pptBlock));
  t('P1b 时长不重复加单位（实测出现过"45 分钟 分钟"）',
    /分钟\|分\|hour\|min/i.test(pptBlock) && !/course\.duration \+ ' 分钟'/.test(pptBlock));
  t('P2 封面带学习目标', /学习目标：' \+ String\(o\.goal\)/.test(pptBlock));
  t('P3 新增「本课安排」页（导出来自 outline.stages）',
    /本课安排/.test(pptBlock) && /stageList/.test(pptBlock) && /stages\) \? o\.stages\.filter/.test(pptBlock));
  t('P4 新增「本课知识点」页', /本课知识点/.test(pptBlock) && /kpList/.test(pptBlock));
  t('P5 新增「课后作业」页（原来完全没导出）',
    /课后作业/.test(pptBlock) && /o\.homework/.test(pptBlock));
  t('P6 小结页有独立视觉（不再和内容页长一样）',
    /const isSummary = !isCover && s\.type === 'summary'/.test(pptBlock) &&
    /slide\.background = \{ color: 'F7F8FF' \}/.test(pptBlock));
  t('P7 页脚含课程名与"n / m"页码（原来只有页码数字，打印后分不清哪节课）',
    /const addFooter = \(slide, idx, total\)/.test(pptBlock) && /' \/ ' \+ total/.test(pptBlock));
  t('P8 长文本启用自适应，不会溢出页面（测试/要点一多就出界）',
    (pptBlock.match(/fit: 'shrink'/g) || []).length >= 6);
  t('P9 页数统计把附加页算进去（否则页码与实际不符）',
    /const totalPages = slides\.length \+ extraCount/.test(pptBlock));
  t('P10 课型名用 getCourseType 取（不能凭空写 typeName）',
    /COURSE_TYPES\.find\(\(x\) => x\.id === course\.type\)/.test(pptBlock) && !/typeName\(/.test(pptBlock));
  t('P11 老课程（无 outline/type）不报错',
    /const o = course\.outline \|\| \{\}/.test(pptBlock) && /Array\.isArray\(o\.stages\)/.test(pptBlock));
  t('P12 图片改为转 PNG 插入（裸 SVG 缺 data: 前缀，会在 write() 阶段让整个导出失败）',
    /function svgToPngDataURL\(svg, pxW, pxH\)/.test(srcPpt) &&
    /const png = await svgToPngDataURL\(svg, 900, 450\)/.test(pptBlock) &&
    /slide\.addImage\(\{ data: data,/.test(pptBlock));
  t('P13 不再把裸 SVG base64 直接交给 addImage（那正是导出失败的原因）', (() => {
    // 只在代码里查，注释里提到这个写法是允许的（用于记录 bug）
    const codeOnly = pptBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return !/addImage\(\{ data: 'image\/svg\+xml/.test(codeOnly);
  })());
  t('P14 导出循环改成可 await（转 PNG 是异步的）',
    /for \(let i = 0; i < slides\.length; i\+\+\) \{/.test(pptBlock));
  t('P15 PNG 转换失败时退回 SVG data URI（补上 data: 前缀），而不是丢图',
    /function svgDataURI\(svg\)/.test(srcPpt) && /const data = png \|\| svgDataURI\(svg\)/.test(pptBlock));
  t('P16 PNG 铺白底（透明底在 PPT 深色主题下看不见）',
    /ctx\.fillStyle = '#FFFFFF'/.test(srcPpt) && /fillRect\(0, 0, pxW, pxH\)/.test(srcPpt));
  /* ★ 实测抓到的关键 bug：figureSVG 生成的 <svg> 没有 xmlns。
     内联进 HTML 没问题，但作为独立图片加载时 SVG 按 XML 解析，缺 xmlns 直接失败 ——
     后果是 5 张图全部静默跳过，导出的 PPT 一张图都没有。 */
  t('P17 转 PNG 前会补 xmlns（缺它会让独立加载 SVG 直接失败）', (() => {
    const i = srcPpt.indexOf('function svgToPngDataURL');
    const block = srcPpt.slice(i, i + 1400);
    return /xmlns/.test(block) && /replace\(\/<svg\\b\//.test(block.replace(/\\\\/g, '\\')) ||
      /if \(!\/xmlns\\s\*=\/.test\(src\)\)/.test(block);
  })());
  t('P17b 两个转换函数都会补 xmlns（转 PNG 与 SVG 兜底各一处）', (() => {
    const png = srcPpt.slice(srcPpt.indexOf('function svgToPngDataURL'), srcPpt.indexOf('function svgDataURI'));
    const uri = srcPpt.slice(srcPpt.indexOf('function svgDataURI'), srcPpt.indexOf('function svgDataURI') + 800);
    return /xmlns/.test(png) && /xmlns/.test(uri);
  })());
  t('P18 图完全插不进去时会明确告诉用户（不静默丢图）',
    /figureFailed/.test(pptBlock) && /没能插进去/.test(pptBlock));
  t('P19 退回 SVG 时也如实说明（老版 Office 可能不显示）',
    /figureFallback/.test(pptBlock) && /矢量方式插入/.test(pptBlock));

  console.log('\n=== 29. 内置自检程序（把静默失败变成一次点得出来的体检） ===');
  const srcCk = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlCk = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssCk = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  t('CK1 有自检函数且已开放给外部脚本调用',
    /function runSelfCheck\(\)/.test(srcCk) && /runSelfCheck, renderCheckup, openCheckup,/.test(srcCk));
  // 真正调一次，确认不抛错且结构正确（拿运行验证，不靠读代码）
  let ckRep = null, ckErr = '';
  try { ckRep = window.runSelfCheck(); } catch (e) { ckErr = e.message; }
  t('CK2 自检能真实跑完且不抛错', !!ckRep && !ckErr, ckErr);
  t('CK3 自检结果结构完整（每项都有 id/名称/结论/说明）',
    !!ckRep && Array.isArray(ckRep.items) && ckRep.items.length >= 7 &&
    ckRep.items.every((x) => x.id && x.name && typeof x.ok === 'boolean' && typeof x.detail === 'string'));
  t('CK4 覆盖关键能力：结构/语音/云/存储/图示/导出/提示词/数据',
    (() => {
      if (!ckRep) return false;
      const ids = ckRep.items.map((x) => x.id);
      return ['dom', 'tts', 'cloud', 'storage', 'figure', 'ppt', 'prompt', 'data'].every((k) => ids.indexOf(k) >= 0);
    })(), ckRep ? ckRep.items.map((x) => x.id).join(',') : '');
  /* ★ 最重要的一条：把"踩过的坑"做成检查项 ——
     figureSVG 缺 xmlns 曾导致 5 张图全部静默跳过（导出成功但没图）。
     自检必须能发现"缺 xmlns"这种状态，否则同类问题还会复发。 */
  t('CK5 图示检查包含 xmlns 校验（防"缺 xmlns 导致插图全丢"复发）',
    /hasXmlns: \/xmlns\\s\*=\/\.test\(svg \|\| ''\)/.test(srcCk) &&
    /且带 xmlns（可独立导出\/转图片）/.test(srcCk));
  /* ★ 自检必须"跑得出结论且不误报"。第一版我把 btn-go-live 列进静态节点清单，
     而它是课程卡片动态注入的 → 每次都误报"缺少 1 个关键节点"。
     自检误报比漏报更伤：用户会不再信任它。所以这里守住"只列静态节点"。 */
  t('CK5b 结构检查只列 index.html 里的静态节点（动态注入的不能列入，否则必误报）', (() => {
    const m = srcCk.match(/const needIds = \[([\s\S]*?)\];/);
    if (!m) return false;
    const ids = m[1].match(/'([^']+)'/g) || [];
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const app = srcCk;
    // 清单里每个 id 都必须在 index.html 静态存在
    const bad = ids.map((x) => x.replace(/'/g, ''))
      .filter((id) => html.indexOf('id="' + id + '"') < 0);
    if (bad.length) return { ok: false, bad: bad };
    return ids.length >= 8;
  })() === true);
  t('CK5c 自检对真实页面能全部通过（拿运行结果验证，不靠读代码）',
    !!ckRep && ckRep.ok === true,
    ckRep ? ckRep.items.filter((x) => !x.ok).map((x) => x.name + '→' + x.detail).join(' ; ') : '');
  t('CK6 失败项必须带具体处理办法（不能只说失败）',
    /fix: fix \|\| ''/.test(srcCk) && /Windows：设置 → 时间和语言 → 语音 → 添加中文语音/.test(srcCk));
  t('CK7 检查了"朗读队列卡死"这个曾经导致永久静音的状态',
    /TTS\.speaking && !TTS\.queue\.length && !TTS\._speakingNow/.test(srcCk));
  t('CK8 单项失败不影响其它项（每项独立 try，检查自身不抛错）',
    /const probe = \(fn\) => \{ try \{ return fn\(\); \} catch \(e\) \{ return \{ __err/.test(srcCk));
  t('CK9 PPT 组件未加载不算失败（按需加载是预期行为）',
    /pptLoaded \|\| !pptTried/.test(srcCk) && /尚未加载（按需加载/.test(srcCk));
  t('CK10 有 UI 入口且放在声音设置里（听不到时最常去的地方）',
    /id="btn-checkup-open"/.test(htmlCk) && /id="checkup-modal"/.test(htmlCk) &&
    htmlCk.indexOf('id="btn-checkup-open"') > htmlCk.indexOf('id="modal-voice"'));
  t('CK11 自检弹窗可关闭（关闭键/好的/点遮罩）',
    /id="btn-checkup-close"/.test(htmlCk) && /id="btn-checkup-ok"/.test(htmlCk) &&
    /if \(ev\.target === modal\) close\(\);/.test(srcCk));
  t('CK12 支持复制结果（便于用户把报告发给我们）',
    /id="btn-checkup-copy"/.test(htmlCk) && /navigator\.clipboard\.writeText/.test(srcCk));
  /* 这条改用纯字符串判断：模式里有 `$(`，正则里要转义，而我在转义上已经栽过两次
     （写对也未必生效，排查成本远高于收益）。这段逻辑本来也不需要正则。 */
  t('CK13 从声音设置进自检时会先收起声音设置（避免弹窗叠着）', (() => {
    const seg = srcCk.slice(srcCk.indexOf('function bindCheckupEvents'),
      srcCk.indexOf('function bindCheckupEvents') + 900);
    return seg.indexOf("const vm = $('#voice-modal')") >= 0 &&
      seg.indexOf('vm.hidden = true') >= 0 &&
      seg.indexOf('openCheckup()') >= 0;
  })());
  t('CK14 有自检结果样式', /\.checkup-list/.test(cssCk) && /\.checkup-item\.bad/.test(cssCk));
  t('CK15 自检事件已接入初始化', /safeInit\('bindCheckupEvents', bindCheckupEvents\)/.test(srcCk));
  t('CK16 导出被调用过会留痕（供自检判断"试过却没加载上组件"）',
    /state\._pptTried = true;/.test(srcCk));
  // 常驻脚本
  const scPath = path.join(dir, 'tests', 'selfcheck.js');
  t('CK17 有可独立运行的检查脚本（对已部署站点跑）', fs.existsSync(scPath));
  if (fs.existsSync(scPath)) {
    const sc = fs.readFileSync(scPath, 'utf8');
    t('CK18 脚本有明确退出码（0 通过 / 1 有问题）', /process\.exit\(rep\.ok && !extra\.length \? 0 : 1\)/.test(sc));
    t('CK19 脚本额外检查页面级 JS 报错（产品自检看不到这些）',
      /pageErrors/.test(sc) && /consoleErrors/.test(sc));
    t('CK20 脚本默认打线上地址且可用环境变量覆盖', /lingxi-class\.app\.workbuddy\.host/.test(sc) && /LINGXI_URL/.test(sc));
  }
  const runAll = fs.readFileSync(path.join(dir, 'tests', 'run-all.js'), 'utf8');
  t('CK21 已挂到总入口但需显式 --online（不拖慢本地快速回归）',
    /--online/.test(runAll) && /线上自检（selfcheck.js）/.test(runAll));

  console.log('\n=== 30. 课后复习闭环（存了必须读得出来） ===');
  const srcRv = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const cssRv = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  /* 实测发现：saveSession 一直把 cards / review_plan 写进数据库，
     但 loadMemory 的 select 从没查过这两列 —— 每节课的闪卡与复习计划白存了，
     学生下课后想看复习计划，档案页里根本没有。这是"写读字段不对齐"造成的功能缺口。 */
  t('RV1 写入端确实存了闪卡与复习计划（前提确认）',
    /cards: Array\.isArray\(rec\.cards\)/.test(srcRv) && /review_plan: Array\.isArray\(rec\.reviewPlan\)/.test(srcRv));
  t('RV2 读取端也查了这两列（修掉"存了读不出来"）', (() => {
    const i = srcRv.indexOf('const L1 =');
    const seg = srcRv.slice(i, i + 400);
    return /cards, review_plan, created_at/.test(seg);
  })());
  t('RV3 老库没这几列时逐级降级（不会让整个档案读不出来）', (() => {
    const i = srcRv.indexOf('const L1 =');
    const seg = srcRv.slice(i, i + 700);
    return /const L2 =/.test(seg) && /const base =/.test(seg) &&
      /for \(const cols of \[L1, L2, base\]\)/.test(seg) && /if \(r && !r\.error\) return r;/.test(seg);
  })());
  t('RV4 档案页渲染闪卡（沿用 details 结构，默认只显问题）',
    /sess-extra[\s\S]{0,400}flash-card/.test(srcRv) && /\bs\.cards\b/.test(srcRv));
  t('RV5 档案页渲染间隔复习计划', /\bs\.review_plan\b/.test(srcRv) && /sess-plan/.test(srcRv));
  t('RV6 闪卡展开会写埋点（复用全局委托，无需额外挂载）',
    /closest\('\.flash-card > summary'\)/.test(srcRv) && /track\('flashcard_open'/.test(srcRv));
  t('RV7 闪卡提示"先自己作答再对答案"（主动回忆的关键）',
    /先在心里作答，再点开对答案/.test(srcRv));
  t('RV8 复习区样式齐备', /\.sess-extra/.test(cssRv) && /\.sess-plan/.test(cssRv) && /\.sess-hint/.test(cssRv));
  t('RV9 没有闪卡/复习计划时不渲染空块（老课程也正常）', (() => {
    const i = srcRv.indexOf('const cardsHtml');
    const seg = srcRv.slice(i, i + 1600);
    return /cards\.length\s*\n?\s*\?/.test(seg) && /plan\.length\s*\n?\s*\?/.test(seg) && /: '';/.test(seg);
  })());

  console.log('\n=== 31. 护眼模式（暖色纸感，不是深色模式） ===');
  const srcTh = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const cssTh = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  const htmlTh = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  t('TH1 有主题开关（桌面 + 移动两个入口，移动端用户占多数）',
    /id="btn-theme"/.test(htmlTh) && /id="btn-theme-m"/.test(htmlTh));
  t('TH2 开关带无障碍语义（aria-pressed 表达开/关状态）',
    /aria-pressed/.test(htmlTh) && /btn\.setAttribute\('aria-pressed'/.test(srcTh));
  t('TH3 主题函数齐备且已开放给外部验证脚本',
    /function applyTheme/.test(srcTh) && /function setTheme/.test(srcTh) &&
    /function toggleTheme/.test(srcTh) && /function loadTheme/.test(srcTh) &&
    /currentTheme, applyTheme, setTheme, toggleTheme, loadTheme,/.test(srcTh));
  t('TH4 主题在初始化时就位（不能等用户看到闪白再套用）',
    /safeInit\('loadTheme', loadTheme\)/.test(srcTh) && /safeInit\('bindThemeEvents', bindThemeEvents\)/.test(srcTh));
  t('TH5 用 data-theme 属性而不是 class（便于 CSS 变量整体覆盖）',
    /setAttribute\('data-theme', 'eye'\)/.test(srcTh) && /html\[data-theme="eye"\]/.test(cssTh));
  t('TH6 偏好写入 localStorage 且读取容错（隐私模式下不能崩）',
    /localStorage\.setItem\(THEME_KEY/.test(srcTh) && /try \{ saved = localStorage\.getItem\(THEME_KEY\)/.test(srcTh));
  /* 关键设计：护眼 ≠ 深色。做成深色需要改 171 个硬编码色值，漏改就是白底白字；
     暖色纸感只需暖化背景，风险低得多，也更符合中文语境下"护眼"的含义。 */
  t('TH7 护眼是暖色纸感（保留浅色底，不是把界面变黑）', (() => {
    const i = cssTh.indexOf('html[data-theme="eye"] {');
    const seg = cssTh.slice(i, i + 700);
    const bg = (seg.match(/--bg:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
    if (!bg) return false;
    const r = parseInt(bg.slice(1, 3), 16), b = parseInt(bg.slice(5, 7), 16);
    // 暖色判据：红分量 > 蓝分量，且整体是浅色（亮度高）
    return r > b && (r + b) / 2 > 150;
  })());
  t('TH8 深色墨水改用暖调而不是冷灰黑（--ink 的蓝分量应最低）', (() => {
    const i = cssTh.indexOf('html[data-theme="eye"] {');
    const seg = cssTh.slice(i, i + 700);
    const ink = (seg.match(/--ink:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
    if (!ink) return false;
    const r = parseInt(ink.slice(1, 3), 16), g = parseInt(ink.slice(3, 5), 16), b = parseInt(ink.slice(5, 7), 16);
    return r >= g && g >= b;      // 暖调：红≥绿≥蓝
  })());
  t('TH9 品牌色被柔化而不是丢弃（保留色相，降低刺眼）', (() => {
    const i = cssTh.indexOf('html[data-theme="eye"] {');
    const seg = cssTh.slice(i, i + 700);
    return /--primary:\s*#[0-9A-Fa-f]{6}/.test(seg) && /--primary-soft:/.test(seg);
  })());
  t('TH10 覆盖高频硬编码冷白/冷浅底（只改背景，不碰文字色）', (() => {
    const i = cssTh.indexOf('html[data-theme="eye"] body');
    const seg = cssTh.slice(i, i + 1800);
    return /background: var\(--card\)/.test(seg) && /background-color: #F1EAD9/.test(seg);
  })());
  t('TH11 不在 html/body 根上使用 filter（会为 fixed 元素创建包含块 → 工具栏/弹窗错位）',
    /不用全局 filter/.test(srcTh) &&
    // 精确约束"根级"：选择器就是 html[data-theme="eye"] 的那条规则里不能有 filter。
    // （叶子元素上为柔化单点使用 filter 是安全的，例如 .s-ico 降饱和）
    !/html\[data-theme="eye"\]\s*\{[^}]*\bfilter\s*:/.test(cssTh) &&
    !/html\[data-theme="eye"\]\s+body\s*\{[^}]*\bfilter\s*:/.test(cssTh));
  t('TH12 手机地址栏配色跟随主题（暖色页面配冷白状态栏会很割裂）',
    /meta\[name="theme-color"\]/.test(srcTh) && /name="theme-color"/.test(htmlTh));
  t('TH13 开关样式与窄屏适配齐备',
    /\.btn-theme\b/.test(cssTh) && /\.mobile-nav-theme/.test(cssTh));
  t('TH14 老用户默认保持日间（护眼属用户偏好，不替用户决定）',
    /saved === 'eye' \? 'eye' : 'day'/.test(srcTh));

  console.log('\n=== 32. 课件质量闸门（确保有例子、有图形等） ===');
  const srcQ = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  let vq = null, vqErr = '';
  try { vq = window.validateCourseware; } catch (_) {}
  t('Q1 有课件质量校验函数且开放给外部巡检程序',
    /function validateCourseware\(course\)/.test(srcQ) &&
    /validateCourseware, reportCoursewareQuality,/.test(srcQ));
  t('Q2 校验器可真实调用（不靠读代码）', typeof vq === 'function');
  if (typeof vq === 'function') {
    // 用**构造的坏课件**验证它真的能抓问题 —— 只测好数据等于没测
    const bad = vq({
      title: '坏课件', subject: '数学', grade: '小学',
      slides: [
        { type: 'cover', title: '坏课件' },
        { title: '纯概念页', bullets: ['概念一', '概念二'] },   // 无例子、无备注
      ],
    });
    const badIds = (bad.issues || []).map((x) => x.id);
    t('Q3 抓得到「没有练习」', badIds.indexOf('no-quiz') >= 0, badIds.join(','));
    t('Q4 抓得到「内容页太少」', badIds.indexOf('few-contents') >= 0);
    t('Q5 抓得到「没有例子」（全是空概念）', badIds.indexOf('no-example') >= 0);
    t('Q6 抓得到「数学课没有图示」', badIds.indexOf('no-figure') >= 0);
    t('Q7 抓得到「没有讲稿备注」', badIds.indexOf('few-notes') >= 0);
    t('Q8 坏课件判定为不通过', bad.ok === false && bad.score < 100);

    // 反例：好课件不该被误报（误报会让人不再信任闸门）
    const good = vq({
      title: '好课件', subject: '数学', grade: '小学',
      slides: [
        { type: 'cover', title: '好课件', note: '开场' },
        { title: '一块蛋糕分四份', bullets: ['把蛋糕平均分成 4 份', '每份是 1/4'], figure: { kind: 'bars' }, note: '讲' },
        { title: '看谁分得多', bullets: ['1/2 比 1/4 大', '分成 2 份每份更大'], figure: { kind: 'numberline' }, note: '讲' },
        { title: '比大小', bullets: ['1/3 和 1/5 谁大'], figure: { kind: 'bars' }, note: '讲' },
        { type: 'quiz', title: '随堂练习', question: '把一个蛋糕平均分成 4 份，取 1 份是几分之几？',
          options: ['A. 1/2', 'B. 1/4'], answer: 'B', analysis: '平均分成 4 份取 1 份就是 1/4。', note: '讲' },
        { type: 'summary', title: '课堂小结', bullets: ['平均分成几份就是几分之一'], note: '讲' },
      ],
    });
    const goodErrs = (good.issues || []).filter((x) => x.level === 'error');
    t('Q9 好课件不被误报为「缺项」', goodErrs.length === 0,
      goodErrs.map((x) => x.label + ':' + x.detail).join(' ; '));
    t('Q10 好课件统计正确（页数/练习/图形/例子都数对）',
      good.stats.contents === 3 && good.stats.quizzes === 1 && good.stats.figures === 3 &&
      good.stats.notes === 6 && good.stats.examplePages === 3,
      JSON.stringify(good.stats));
    t('Q11 概念类学科配图会被提示（不是报错）', (() => {
      const r = vq({
        title: '概念课', subject: '语文',
        slides: [
          { type: 'cover', title: '概念课' },
          { title: '比喻', bullets: ['比喻就是打比方'], figure: { kind: 'bars' }, note: 'n' },
          { type: 'quiz', title: '练', question: 'q', options: ['A', 'B'], answer: 'A', analysis: 'a', note: 'n' },
          { type: 'summary', title: '小结', bullets: ['x'], note: 'n' },
        ],
      });
      const ids = (r.issues || []).map((x) => x.id);
      return ids.indexOf('extra-figure') >= 0 &&
        (r.issues || []).every((x) => x.id !== 'extra-figure' || x.level === 'warn');
    })());
    t('Q12 练习缺解析会被提示（解析是错题讲评的关键）', (() => {
      const r = vq({
        title: 'x', subject: '数学',
        slides: [
          { type: 'cover', title: 'x' },
          { title: 'a', bullets: ['数字 3 个'], figure: { kind: 'bars' }, note: 'n' },
          { title: 'b', bullets: ['数字 4 个'], note: 'n' },
          { title: 'c', bullets: ['数字 5 个'], note: 'n' },
          { type: 'quiz', title: '练', question: 'q', options: ['A', 'B'], answer: 'A', note: 'n' },
        ],
      });
      const ids = (r.issues || []).map((x) => x.id);
      return ids.indexOf('quiz-no-analysis') >= 0;
    })());
    t('Q13 空课件不会让校验器抛错（老数据容错）', (() => {
      try { const r = vq({ slides: [] }); return r.ok === false && r.issues.length > 0; } catch (_) { return false; }
    })());
    t('Q14 校验器结果会写回课程的 _quality（供自检/导出复用）',
      /course\._quality = r/.test(srcQ) && /function reportCoursewareQuality/.test(srcQ));
  }
  t('Q15 导出前会跑质量校验（不能等用户拿到手才发现缺图/缺例子）',
    /reportCoursewareQuality\(course\)/.test(srcQ));
  t('Q16 内置自检里有「课件质量」这一项',
    /add\('courseware', '课件质量'/.test(srcQ) && /validateCourseware\(latest\)/.test(srcQ));
  t('Q17 概念类学科不因缺图被报错（只有图形类学科才硬性要求）',
    /figAllowed && !stats\.figures/.test(srcQ));
  /* ★ 判据必须覆盖各学科的"例子形态" —— 只认数字/情境词时，
     一门语文课被判"4 个内容页全无例子"，而它每页都有具体例句
     （"句子：晚霞像打翻的颜料盘"）。判据太窄会误报，误报比漏报更伤。 */
  t('Q17b 例子判据覆盖引文/书名号/括号例子（不只认数字）', (() => {
    const i = srcQ.indexOf('const CW_EXAMPLE_HINTS');
    const seg = srcQ.slice(i, i + 900);
    return /u300a/.test(seg) && /u201c|\\u201c/.test(seg) && /uff08/.test(seg);
  })());
  t('Q17c 语文课的引文式例子能被判为"有例子"', (() => {
    if (typeof vq !== 'function') return false;
    const r = vq({
      title: '语文', subject: '语文',
      slides: [
        { type: 'cover', title: '语文' },
        { title: '从一张照片说起', bullets: ['句子：晚霞像打翻的颜料盘', '哪一句更有画面？'], note: 'n' },
        { title: '本体与喻体', bullets: ['本体：被比的景物（晚霞）', '喻体：颜料盘'], note: 'n' },
        { title: '两个坑', bullets: ['坑一：同类比较（像爸爸）', '答题别只写生动形象'], note: 'n' },
        { type: 'quiz', title: '练', question: '下面哪句是比喻句？', options: ['A. 他像他爸爸', 'B. 枫叶像小邮票'], answer: 'B', analysis: 'B 是不同类。', note: 'n' },
        { type: 'summary', title: '小结', bullets: ['三要素'], note: 'n' },
      ],
    });
    return (r.issues || []).every((x) => x.id !== 'no-example') && r.stats.examplePages >= 2;
  })());
  /* 提示词与校验器口径要一致：原来只要求例子放 note（演讲者备注，学生看不到），
     而校验器查的是 bullets（投影页）。现在提示词也要求 bullets 里有具体内容。 */
  t('Q17d 生成提示词要求 bullets 本身含具体内容（例子不能只藏在备注里）',
    /至少有一条必须落在具体的东西上/.test(srcQ) && /例子藏在备注里等于没有/.test(srcQ));
  /* ★ 巡检实测：同一门物理课，上次生成 4 张图、这次 0 张 —— 配图不稳定。
     所以补一次"定向配图"，让"应有图的学科"稳一点。 */
  t('Q24 有定向补图能力（配图不稳定，缺图时补一次）',
    /async function ensureCourseFigures/.test(srcQ) && /function buildFigureFixPrompt/.test(srcQ));
  t('Q25 补图只对"图形即知识载体"的学科触发（概念类不硬配）',
    /if \(!figureAllowed\(course\.subject\)\) return 0;/.test(srcQ));
  t('Q26 补图结果必须能被 figureSVG 真画出来才采用（画不出等于没配）',
    /svg = figureSVG\(fig, course\.system === 'intl' \? 'ocean' : 'indigo'\)/.test(srcQ) &&
    /if \(!svg\) return;/.test(srcQ));
  t('Q27 补图失败不阻断、不降级（保留原课件）',
    /补图失败，保留原课件/.test(srcQ) && /catch \(_\) \{\}/.test(srcQ));
  t('Q28 已有图时不重复补（不打扰）', /if \(course\.slides\.some\(\(s\) => s\.figure\)\) return 0;/.test(srcQ));
  t('Q29 补图已接入生成流程', /const nFig = await ensureCourseFigures\(course\)/.test(srcQ));
  t('Q30 补图埋点已登记在白名单（否则会被静默丢弃）',
    /'figure_backfill'/.test(srcQ) && /figure_backfill/.test(srcQ.slice(srcQ.indexOf('const TRACK_EVENTS'), srcQ.indexOf('const TRACK_EVENTS') + 4000)));
  t('Q31 备注判据排除封面（否则每门课都会挂一条假建议，淹没真问题）',
    /const needNote = slides\.filter\(\(s, i\) => !isCover\(s, i\)\)/.test(srcQ));
  // 巡检程序
  const pqPath = path.join(dir, 'tools', 'ppt-quality.js');
  t('Q18 有可反复运行的课件质量巡检程序', fs.existsSync(pqPath));
  if (fs.existsSync(pqPath)) {
    const pq = fs.readFileSync(pqPath, 'utf8');
    t('Q19 巡检覆盖多个学科（含必须出图的数学/物理 与 不该配图的语文）',
      /数学/.test(pq) && /物理/.test(pq) && /语文/.test(pq) && /计算机科学/.test(pq));
    t('Q20 巡检会验证图形「不是空白」（有图 ≠ 图有用）',
      /nonWhiteRatio/.test(pq) && /contrastRange/.test(pq) && /img.onload/.test(pq));
    t('Q21 巡检会核对图片数量与页面引用一致',
      /mediaNames\.length !== picRefs/.test(pq));
    t('Q22 巡检校验 PPT 结构（安排页/知识点/页码/备注/自适应）',
      /hasAgenda/.test(pq) && /hasPageNum/.test(pq) && /备注覆盖不全/.test(pq) && /未启用文本自适应/.test(pq));
    t('Q23 巡检有明确退出码（0 通过 / 1 有问题 / 2 环境不足）',
      /process\.exit\(results\.every\(\(r\) => r\.ok\) \? 0 : 1\)/.test(pq) && /process\.exit\(2\)/.test(pq));
  }

  console.log('\n=== 33. 家长学情报告（补"家长看不见"这个致命缺口） ===');
  const srcPR = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlPR = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssPR = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  /* 对比学而思后发现：他们每个学员有辅导老师"每周给家长出学情报告"，
     家长始终看得见；我们下课那一刻和家长的关系就断了。
     这里不做家长端 App，先做"一页能发给家长的东西"（复制文字 / 下载长图）。 */
  t('PR1 有报告数据归一化函数（小结与上课记录两种来源字段名不同）',
    /function buildParentReport\(src, opt\)/.test(srcPR) &&
    /s\.weak_points \|\| s\.weakPoints/.test(srcPR) && /s\.review_plan \|\| s\.reviewPlan/.test(srcPR));
  t('PR2 报告三种出口齐备：站内预览 / 复制文字 / 下载长图',
    /function openParentReport\(/.test(srcPR) && /function parentReportText\(/.test(srcPR) &&
    /function parentReportImage\(/.test(srcPR));
  /* 断言"没有引入 html2canvas"时要看**调用**，不能看词是否出现 ——
     我的注释里就写着"不引 html2canvas"，按词判断会把自己的注释当违规。 */
  t('PR3 长图用 canvas 手绘（没有引入 html2canvas 这类外部库）',
    /document\.createElement\('canvas'\)/.test(srcPR) && !/html2canvas\s*\(/.test(srcPR));
  t('PR4 长图有中文自动换行（canvas 不会自动折行）',
    /const wrap = \(text, font, size, maxW\) =>/.test(srcPR) && /measureText\(cur \+ ch\)/.test(srcPR));
  t('PR5 长图按内容算高度（两遍：先量高再绘制）',
    /let h = PAD;/.test(srcPR) && /cvs\.height = Math\.round\(h\)/.test(srcPR));
  t('PR6 下载用 toBlob + a[download]（不用 data URI 直跳，避免新窗口打开）',
    /cvs\.toBlob\(\(blob\) =>/.test(srcPR) && /a\.download = name/.test(srcPR));
  t('PR7 报告带「补法建议」而不只列错因（家长要知道"我能做什么"）',
    /const fix = c\.fix \|\| k\.action/.test(srcPR) && /class="pr-fix"/.test(srcPR));
  t('PR8 报告明确标注"由 AI 生成，请结合实际情况参考"', /请结合孩子实际情况参考/.test(srcPR));
  t('PR9 有报告弹窗 UI（预览 + 三个按钮）',
    /id="parent-report-modal"/.test(htmlPR) && /id="btn-parent-report-copy"/.test(htmlPR) &&
    /id="btn-parent-report-img"/.test(htmlPR) && /id="btn-parent-report-ok"/.test(htmlPR));
  t('PR10 小结弹窗里有「发给家长」入口（下课那一刻就能顺手发出去）',
    /id="btn-sum-parent-report"/.test(srcPR) && /openParentReport\(sum,/.test(srcPR));
  t('PR11 每条上课记录也能出报告（历史记录同样要能补发）',
    /data-parent-report="/.test(srcPR) &&
    /closest\('\[data-parent-report\]'\)/.test(srcPR) &&
    /data-parent-report/.test(srcPR));
  t('PR12 从记录取数据是"按 id 找原对象"，不用 DOM 文本（报告需要未渲染的结构化字段）',
    /all\.find\(\(x\) => String\(x && x\.id\) === String\(id\)\)/.test(srcPR));
  t('PR13 报告埋点已登记白名单（open/copy/image 三条）',
    (() => {
      const i = srcPR.indexOf('const TRACK_EVENTS');
      const seg = srcPR.slice(i, i + 4200);
      return /parent_report_open/.test(seg) && /parent_report_copy/.test(seg) && /parent_report_image/.test(seg);
    })());
  t('PR14 报告事件已接入初始化', /safeInit\('bindParentReportEvents', bindParentReportEvents\)/.test(srcPR));
  t('PR15 报告已开放给外部验证脚本',
    /buildParentReport, parentReportText, parentReportImage, openParentReport,/.test(srcPR));
  t('PR16 有报告样式（含护眼模式适配）',
    /\.pr-head/.test(cssPR) && /\.pr-list/.test(cssPR) && /html\[data-theme="eye"\] \.pr-fix/.test(cssPR));

  // 真实调用：数据归一化 + 文本 + 长图（不靠读代码）
  if (typeof window.buildParentReport === 'function') {
    const FAKE = {
      course_title: '分数的初步认识——把一个整体平均分', subject: '数学', grade: '小学',
      duration_secs: 2700, created_at: new Date().toISOString(),
      mastered: ['能看图写出几分之一'], weak_points: ['不平均分能不能用分数表示'],
      homework: ['用一张纸折出 1/2、1/4、1/8'],
      comment: '这节课整体理解不错，注意强调"平均分"这个前提。',
      error_causes: [{ cause: 'concept', topic: '平均分的含义', ifWrong: '把"随便分"当成了平均分' }],
      cards: [{ q: '把蛋糕平均分成 4 份取 1 份是几分之几？', a: '1/4' }],
      review_plan: ['今晚：把三张闪卡各说一遍', '明天：重做课堂上错的那道判断题'],
    };
    let r = null, rerr = '';
    try { r = window.buildParentReport(FAKE); } catch (e) { rerr = e.message; }
    t('PR17 报告数据能真实构建（归一化字段名不报错）', !!r && !rerr, rerr);
    t('PR18 归一化正确（时长换算成分钟、错因被清洗保留）',
      !!r && r.minutes === 45 && r.causes.length === 1 && r.mastered.length === 1 && r.weak.length === 1,
      r ? JSON.stringify({ m: r.minutes, c: r.causes.length, ms: r.mastered.length, w: r.weak.length }) : '');
    let txt = '';
    try { txt = window.parentReportText(r); } catch (_) {}
    t('PR19 文本版含全部关键区块（家长粘到微信就能读）',
      txt.indexOf('这节课已经掌握') >= 0 && txt.indexOf('还需要巩固') >= 0 &&
      txt.indexOf('出错在哪') >= 0 && txt.indexOf('课后作业') >= 0 &&
      txt.indexOf('建议复习节奏') >= 0 && txt.indexOf('老师的话') >= 0 && txt.indexOf('灵犀课堂') >= 0);
    let img = null, ierr = '';
    try { img = window.parentReportImage(r); } catch (e) { ierr = e.message; }
    /* jsdom **没有 canvas 实现**（getContext('2d') 返回 null），所以长图在这里画不出来。
       我没有为测试环境伪造一个 canvas —— 那会变成"测试通过但线上其实不可用"的假保险。
       这里只验证"拿不到画布时给出的是**看得懂的**报错"，
       长图本身改在**真实浏览器**里验证（_authtest/verify-parent-report.js）。
       顺带说明：这条断言在浏览器里跑时会走上面那个分支，因此两种环境都覆盖到了。 */
    const canvasOk = (() => {
      try { return !!document.createElement('canvas').getContext('2d'); } catch (_) { return false; }
    })();
    t('PR20 拿不到画布时给出明确报错（而不是 "Cannot set properties of null" 这种看不懂的错）',
      canvasOk ? !!img : /当前环境不支持画布绘制/.test(String(ierr)),
      canvasOk ? '' : ierr);
    if (canvasOk) {
      t('PR21 长图能真实画出来且有合理尺寸（宽 750、高度按内容算）',
        !!img && img.width === 750 && img.height > 400, img ? img.width + 'x' + img.height : ierr);
      /* ★ 关键：长图**不能是空白的** —— "生成出来"不等于家长能看到内容。 */
      t('PR22 长图确实画上了内容（非白像素占比 5%~95%，不是空白也不是全黑）', (() => {
        if (!img) return false;
        try {
          const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
          let nonWhite = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) nonWhite++;
            n++;
          }
          const ratio = nonWhite / n;
          return ratio > 0.05 && ratio < 0.95;
        } catch (_) { return false; }
      })());
    } else {
      console.log('     ⏭ PR21/PR22 跳过：jsdom 无 canvas，长图改在真实浏览器验证（verify-parent-report.js）');
    }
  }

  console.log('\n=== 34. 真题库（合规优先：索引 + 官方入口，不托管真题） ===');
  const srcEX = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlEX = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssEX = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  /* 版权查证结论（决定了这个功能只能怎么做）：
     Cambridge 官方："we do not grant permission for the use of complete examination papers,
     nor do we grant permission for electronic publication, in any format,
     of questions from past examination papers" —— 不授权整卷、也不授权任何形式的电子发布真题。
     AQA / Pearson / OCR / College Board(AP) 则官方免费公开。
     所以：**只做索引 + 官方入口**，绝不把题目搬进本站。 */
  t('EX1 有真题索引数据（考试局/科目/试卷代码/官方入口）',
    /const EXAM_LIBRARY = \[/.test(srcEX) && /const EXAM_ACCESS = \{/.test(srcEX));
  t('EX2 覆盖多个考试局（含需学校获取的 Cambridge 与公开的 AQA/Pearson/OCR/AP）', (() => {
    const boards = ['Cambridge International', 'Pearson Edexcel', 'AQA', 'OCR', 'College Board', 'IBO'];
    return boards.every((b) => srcEX.indexOf("board: '" + b + "'") >= 0);
  })());
  t('EX3 区分"官方公开"与"需学校获取"两种取得方式（不能笼统说"免费下载"）',
    /public:\s*\{[^}]*官方免费公开/.test(srcEX) && /school:\s*\{[^}]*需通过学校获取/.test(srcEX));
  t('EX4 每条都有官方 URL 且是 https',
    (() => {
      const m = srcEX.match(/url: '(https:\/\/[^']+)'/g) || [];
      return m.length >= 18 && m.every((x) => x.indexOf("url: 'https://") === 0);
    })());
  /* ★ 最重要的合规断言：我们**没有内嵌任何考题内容** —— 只有元数据与链接。
     判据：整个索引常量里不应出现题干式内容（长句、选项、分值标注等）。 */
  t('EX5 索引里没有内嵌考题内容（只有元数据与链接，不托管真题）', (() => {
    const i = srcEX.indexOf('const EXAM_LIBRARY = [');
    const j = srcEX.indexOf('function papersBySystem');
    if (i < 0 || j < 0) return false;
    const seg = srcEX.slice(i, j);
    // 每条只允许出现这些字段
    const allowed = ['board', 'system', 'subject', 'code', 'access', 'papers', 'topics', 'url'];
    const keys = [...seg.matchAll(/(\w+):\s*'/g)].map((m) => m[1]);
    const bad = keys.filter((k) => allowed.indexOf(k) < 0);
    return bad.length === 0;
  })());
  t('EX6 页面上有醒目的版权声明（不能藏起来）',
    /关于真题版权，说清楚/.test(htmlEX) && /不托管、不复制、不改编/.test(htmlEX));
  t('EX7 声明里点明 Cambridge 不允许电子发布（这才是我们只给链接的原因）',
    /Cambridge International<\/b>：官方明确/.test(htmlEX) && /绝不把题目搬到这里/.test(htmlEX));
  t('EX8 生成练习时明确标注"AI 原创题 · 非真题"',
    /AI 原创题 · 非真题/.test(srcEX) && /不是真题/.test(srcEX));
  t('EX9 出题提示词里明确禁止照抄真题',
    /你\*\*不能复制任何真题\*\*/.test(srcEX) && /不得照抄任何真实考题/.test(srcEX));
  t('EX10 练习按考试规格生成（题型/分值/评分要点对标该考试）',
    /题型、分值、答题形式要与该考试一致/.test(srcEX) && /Mark Scheme/.test(srcEX));
  /* 这条原本数的是"全文 data-nav=papers 出现 2 次"，但 data-nav 是个**通用导航属性**，
     页内按钮也在用它（题库空状态里的「去真题库」就是），一加按钮就假失败。
     真正的意图是"桌面导航和移动导航里各有一个入口"，所以直接断言那两处容器。 */
  t('EX11 有视图，且桌面导航与移动导航里都有入口',
    /id="view-papers"/.test(htmlEX) &&
    /<nav class="nav-links">[\s\S]*?data-nav="papers"[\s\S]*?<\/nav>/.test(htmlEX) &&
    /<nav class="mobile-nav"[\s\S]*?data-nav="papers"[\s\S]*?<\/nav>/.test(htmlEX));
  t('EX12 视图切换与初始化已接',
    /if \(name === 'papers'\) renderPapers\(\)/.test(srcEX) && /safeInit\('bindPapersEvents'/.test(srcEX));
  t('EX13 埋点已登记（官方入口打开 / 生成练习）',
    (() => {
      const i = srcEX.indexOf('const TRACK_EVENTS');
      const seg = srcEX.slice(i, i + 4400);
      return /paper_official_open/.test(seg) && /paper_practice_gen/.test(seg);
    })());
  t('EX14 外链带 rel="noopener noreferrer"（外站跳转的安全习惯）',
    /rel="noopener noreferrer"/.test(srcEX));
  t('EX15 已开放给外部验证脚本',
    /EXAM_LIBRARY, EXAM_ACCESS, papersBySystem, renderPapers, makePaperStylePractice,/.test(srcEX));
  t('EX16 真题库样式齐备（含护眼模式适配）',
    /\.paper-card/.test(cssEX) && /\.papers-legal/.test(cssEX) && /html\[data-theme="eye"\] \.papers-legal/.test(cssEX));

  // 运行验证：筛选 + 渲染（不靠读代码）
  if (typeof window.papersBySystem === 'function') {
    const all = window.papersBySystem();
    t('EX17 索引可读取且条目充足', Array.isArray(all) && all.length >= 18, '条目 ' + (all ? all.length : 0));
    t('EX18 按体系筛选正确（A-Level 只出 A-Level）',
      (() => {
        const al = window.papersBySystem('A-Level');
        return al.length > 0 && al.every((x) => x.system === 'A-Level');
      })());
    t('EX19 按体系+学科筛选正确', (() => {
      const r = window.papersBySystem('AP', '统计');
      return r.length >= 1 && r.every((x) => x.system === 'AP' && x.subject === '统计');
    })());
    t('EX20 每个条目字段完整（含官方 URL 与非空说明）',
      all.every((x) => x.board && x.system && x.subject && /^https:\/\//.test(x.url) &&
        x.access && window.EXAM_ACCESS[x.access]));
    // 渲染到 DOM
    const wrap = document.createElement('div');
    wrap.innerHTML = '<select id="papers-system"><option value=""></option></select>' +
      '<select id="papers-subject"><option value=""></option></select><div id="papers-list"></div>';
    document.body.appendChild(wrap);
    let rerr = '';
    try { window.renderPapers(); } catch (e) { rerr = e.message; }
    const cards = document.querySelectorAll('#papers-list .paper-card');
    t('EX21 真题库能真实渲染出卡片', cards.length > 0 && !rerr, rerr);
    const firstLink = document.querySelector('#papers-list .paper-card a');
    t('EX22 卡片上的"去官方下载"是真实外链（不是按钮伪装）',
      !!firstLink && /^https:\/\//.test(firstLink.getAttribute('href')) &&
      firstLink.getAttribute('target') === '_blank');
    t('EX23 卡片上标出了取得方式（官方公开 / 需学校）',
      /paper-access/.test(document.querySelector('#papers-list').innerHTML));
    wrap.remove();
  }

  console.log('\n=== 35. 真题库扩库（IGCSE + 国内高考）+ 自带真题通道 ===');
  const srcOW = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlOW = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  t('OW1 索引已扩到 IGCSE（6 科 CAIE）',
    /system: 'IGCSE'/.test(srcOW) && ['0580', '0625', '0620', '0610', '0455', '0478'].every((c) => srcOW.indexOf("code: '" + c + "'") >= 0));
  t('OW2 索引已含国内高考（教育部考试院 + 多省考试院）', (() => {
    /* 省份清单只列**实测可达**的。
       湖北（hbea.edu.cn）测出来 http 301→https 但 https 稳定 503 / 连接重置
       （间隔 12 秒连测三次一样，不是限流），所以没有收录 ——
       一个打不开的官方入口比"少一个省"更伤信任。 */
    const provs = ['北京', '上海', '广东', '江苏', '浙江', '山东', '四川'];
    return /system: '高考'/.test(srcOW) && provs.every((p) => srcOW.indexOf("code: '" + p + "'") >= 0);
  })());
  t('OW2b 未收录无法验证的入口（如湖北 503），且代码里说明了原因',
    srcOW.indexOf("code: '湖北'") < 0 && /hbea\.edu\.cn.*未收录|未收录.*hbea/.test(srcOW.replace(/\n/g, ' ')));
  t('OW3 高考条目说明"考后由考试院公布"，不暗示我们转载',
    /考后公布本省/.test(srcOW) && /我们不汇总、不转载、不重新排版/.test(srcOW));
  /* ★ CAIE 的公开资源说明必须**有据可依**：我实测从本机打不开那些页面
     （HEAD 偶发 200、完整加载超时/重置），所以只能依据 Cambridge 官方帮助文档，
     文案里不能写"点这里就能下到真题"这种我们核实不了的话。 */
  t('OW4 CAIE 说明注明依据官方帮助文档、且不承诺"点开就能下真题"',
    /help\.cambridgeinternational\.org/.test(srcOW) && /无法代为核实/.test(srcOW));
  t('OW5 筛选器已加 IGCSE 与 国内高考 两个选项',
    /value="IGCSE"/.test(htmlOW) && /value="高考"/.test(htmlOW));
  // ── 自带真题通道 ──
  t('OW6 有「自带真题」通道（Cambridge 线的合法落地：处理学生自己那份材料）',
    /async function extractPdfText/.test(srcOW) && /async function runOwnPaper/.test(srcOW));
  t('OW7 PDF 解析零外部依赖（pdf.js 的四条 CDN 通道本机实测全部不可达，不能当承诺）', (() => {
    const i = srcOW.indexOf('const VENDOR_FALLBACK');
    const seg = srcOW.slice(i, i + 1400);
    return !/pdfjsLib/.test(srcOW) && !/'pdfjsLib'/.test(seg) &&
      /async function extractPdfTextLocal/.test(srcOW) && /DecompressionStream/.test(srcOW);
  })());
  t('OW7b 自研解析覆盖 FlateDecode 解压与文本操作符提取',
    /async function inflateBytes/.test(srcOW) && /function pdfStringsToText/.test(srcOW) &&
    /Tj\|TJ/.test(srcOW) && /deflate-raw/.test(srcOW));
  t('OW7c 如实说明能力边界（英文卷效果好 / 扫描件抽不出 / 不假装能 OCR）',
    /扫描件（无文字层）抽不出任何东西/.test(srcOW) && /我们不假装能做/.test(srcOW));
  t('OW8 支持拖拽与点击选择文件', /addEventListener\('drop'/.test(srcOW) && /own-paper-file/.test(htmlOW));
  t('OW9 扫描件抽不出文字时如实说明，不假装能 OCR',
    /扫描件\/图片版/.test(srcOW) && /那需要 OCR/.test(srcOW) && !/tesseract/i.test(srcOW));
  t('OW10 明确"不存储、不公开"学生提供的材料',
    /我们不存储、不公开/.test(srcOW) && /只在你这里用它做讲解，不存储、不公开/.test(srcOW));
  t('OW11 讲解模式输出知识点/思路/步骤/扣分点/优先补强',
    /"topics"/.test(srcOW) && /"trap"/.test(srcOW) && /最值得优先补的/.test(srcOW));
  t('OW12 变式模式明确"不得照抄原题"',
    /不得照抄原文题目/.test(srcOW) && /AI 原创题 · 非原文/.test(srcOW));
  t('OW13 有数量上限与截断提示（防止超长材料打爆请求）',
    /OWN_PAPER_MAX_CHARS/.test(srcOW) && /超出部分已截断/.test(srcOW));
  t('OW14 自带真题埋点已登记', (() => {
    const i = srcOW.indexOf('const TRACK_EVENTS');
    const seg = srcOW.slice(i, i + 4800);
    return /own_paper_extract/.test(seg) && /own_paper_run/.test(seg);
  })());
  t('OW15 自带真题事件已接入初始化', /safeInit\('bindOwnPaperEvents', bindOwnPaperEvents\)/.test(srcOW));

  // 运行验证
  if (typeof window.papersBySystem === 'function') {
    const all = window.papersBySystem();
    t('OW16 索引条目数已增至 30+', all.length >= 30, '条目 ' + all.length);
    t('OW17 IGCSE 筛选正确', (() => {
      const r = window.papersBySystem('IGCSE');
      return r.length >= 6 && r.every((x) => x.system === 'IGCSE');
    })());
    t('OW18 高考筛选正确（都是国内考试院、且标为官方公开）', (() => {
      const r = window.papersBySystem('高考');
      return r.length >= 8 && r.every((x) => x.system === '高考' && x.access === 'public');
    })());
    t('OW19 新增条目 URL 都是 https 且非空',
      all.filter((x) => x.system === 'IGCSE' || x.system === '高考')
        .every((x) => /^https?:\/\//.test(x.url) && x.topics));
  }

  console.log('\n=== 36. 我的题库（把卷子拆题分类做题库） ===');
  const srcBK = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlBK = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssBK = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  /* 这一步的价值不只是"存题"：它把之前卡住的「错题本/重练」解锁了 ——
     当时因为没有存原题，只能做"按薄弱知识点出新题"；现在有了题目，才能真正重做原来那道题。 */
  t('BK1 有题库存储层（读写/增删/统计/清空）',
    /function loadBank\(/.test(srcBK) && /function saveBank\(/.test(srcBK) &&
    /function bankAdd\(/.test(srcBK) && /function bankDelete\(/.test(srcBK) &&
    /function bankClearSource\(/.test(srcBK) && /function bankStats\(/.test(srcBK));
  t('BK2 有 AI 拆题（把整卷拆成题 + 分类）',
    /async function splitPaperToBank\(/.test(srcBK) && /function doSplitToBank\(/.test(srcBK));
  t('BK3 分类维度齐备：题型/知识点/难度/分值/标签',
    /BANK_TYPES = \{ choice: '选择题'/.test(srcBK) && /BANK_DIFF = \{ easy: '基础'/.test(srcBK) &&
    /"topic"/.test(srcBK) && /"tags"/.test(srcBK) && /"marks"/.test(srcBK));
  t('BK4 拆题提示词要求题干完整可作答（不能只写题号）',
    /题干要\*\*完整可作答\*\*/.test(srcBK) && /不要只写题号/.test(srcBK));
  t('BK5 拆题提示词要求知识点命名一致（否则同类题会被拆成不同分组）',
    /同一知识点的叫法要一致/.test(srcBK));
  /* 脏数据控制：模型输出不可信，进库前必须清洗 */
  t('BK6 入库前清洗脏数据（太短的不算题、非法枚举兜底、超长截断）', (() => {
    if (typeof window.cleanBankItems !== 'function') return false;
    const r = window.cleanBankItems([
      { stem: '短', type: 'calc', topic: 'X' },                                    // 太短 → 丢
      null, 42,                                                                     // 非对象 → 丢
      { stem: '这是一道足够长的题目用来测试清洗逻辑是否正确工作', type: '乱写', difficulty: '乱写',
        topic: '', marks: -5, options: 'not-array', tags: 'not-array' },
      { stem: 'x'.repeat(2000), type: 'choice', topic: 'Y' },                      // 超长 → 截断
    ], { subject: '数学', source: 'test' });
    if (r.length !== 2) return false;
    const a = r[0];
    const okEnum = a.type === 'other' && a.difficulty === 'mid' && a.topic === '未归类' &&
      a.marks === null && Array.isArray(a.options) && Array.isArray(a.tags);
    const okTrunc = r[1].stem.length === 600;                                      // BANK_STEM_MAX
    return okEnum && okTrunc;
  })());
  t('BK7 入库去重（同一份卷子拆两次不会灌两遍）', (() => {
    if (typeof window.bankAdd !== 'function') return false;
    try { window.localStorage.removeItem(window.BANK_KEY); } catch (_) {}
    const one = window.cleanBankItems([{ stem: '一道用于测试去重的题目内容足够长', topic: 'A', type: 'calc' }], { source: 's1' });
    const first = window.bankAdd(one);
    const second = window.bankAdd(one);
    const n = window.bankAll().length;
    try { window.localStorage.removeItem(window.BANK_KEY); } catch (_) {}
    return first.added === 1 && second.added === 0 && second.dup === 1 && n === 1;
  })());
  t('BK8 有条目上限且超出时如实报告（不静默丢数据）',
    /BANK_MAX_ITEMS/.test(srcBK) && /overflow/.test(srcBK) && /超出上限丢弃最早/.test(srcBK));
  /* 存储写失败必须说出来 —— 这个项目里"存储满静默失败导致课程丢失"已经踩过一次 */
  t('BK9 存储写失败时返回明确原因（不静默）',
    /localStorage 存储空间满了|浏览器存储空间满了/.test(srcBK) && /function saveBank[\s\S]{0,400}return \{ ok: false/.test(srcBK));
  t('BK10 合规：题库只存本机、不上传不分发',
    /只存在你这台设备的浏览器里/.test(htmlBK) && /不上传、不公开、不分发/.test(htmlBK) &&
    /只存在他自己的浏览器里/.test(srcBK));
  t('BK11 题库视图，且桌面导航与移动导航里都有入口',
    /id="view-bank"/.test(htmlBK) &&
    /<nav class="nav-links">[\s\S]*?data-nav="bank"[\s\S]*?<\/nav>/.test(htmlBK) &&
    /<nav class="mobile-nav"[\s\S]*?data-nav="bank"[\s\S]*?<\/nav>/.test(htmlBK));
  t('BK12 视图切换与初始化已接',
    /if \(name === 'bank'\) renderBank\(\)/.test(srcBK) && /safeInit\('bindBankEvents'/.test(srcBK));
  t('BK13 自带真题区有「拆题存进题库」入口',
    /id="btn-own-split"/.test(htmlBK) && /doSplitToBank/.test(srcBK));
  t('BK14 能导出（按知识点分组，学生可留存）',
    /function bankExport\(/.test(srcBK) && /按知识点分组/.test(srcBK) && /我的题库-/.test(srcBK));
  t('BK15 清空需二次确认（不可逆操作）',
    /window\.confirm\(\s*\n?\s*src/.test(srcBK) && /此操作不可恢复/.test(srcBK));
  t('BK16 埋点已登记（拆题入库 / 导出）', (() => {
    const i = srcBK.indexOf('const TRACK_EVENTS');
    const seg = srcBK.slice(i, i + 5000);
    return /bank_split/.test(seg) && /bank_export/.test(seg);
  })());
  t('BK17 题库样式齐备（含护眼模式适配）',
    /\.bank-item/.test(cssBK) && /\.bank-filter/.test(cssBK) && /html\[data-theme="eye"\] \.bank-legal/.test(cssBK));
  t('BK18 已开放给外部验证脚本',
    /doSplitToBank,/.test(srcBK) && /renderBank, bankFiltered, bankExport, BANK_KEY, BANK_TYPES, BANK_DIFF,/.test(srcBK));

  /* ★★ 这一段来自一次真实的失败：
     实测拆一份卷子时模型返回 125KB，**输出被截断** → parseJSONLoose 解不了不完整的数组
     → 我报"没有拆出题目"，可模型其实拆得好好的，只是最后一条没写完。
     真实场景里"整份卷子 → 长输出 → 截断"几乎必然发生，所以必须有抢救机制。 */
  t('BK26 有截断抢救（从写不完的 JSON 里尽量收完整对象）',
    /function salvageObjects\(/.test(srcBK) && /function parseSplitResult\(/.test(srcBK));
  t('BK27 抢救：截断的数组能收回完整条目', (() => {
    if (typeof window.salvageObjects !== 'function') return false;
    const truncated = '[{"no":"1","stem":"题一"},{"no":"2","stem":"题二"},{"no":"3","stem":"题三被截';
    const r = window.salvageObjects(truncated);
    return r.length === 2 && r[0].stem === '题一' && r[1].no === '2';
  })());
  t('BK28 抢救：完整数组不误伤', (() => {
    if (typeof window.salvageObjects !== 'function') return false;
    return window.salvageObjects('[{"a":1},{"b":2}]').length === 2;
  })());
  t('BK29 抢救：题干里含 { } " 与转义也不会数错括号', (() => {
    if (typeof window.salvageObjects !== 'function') return false;
    const s = '[{"stem":"含 } 和 { 的题干"},{"stem":"带\\"引号\\"的第二条"},{"stem":"未完成';
    const r = window.salvageObjects(s);
    return r.length === 2;
  })());
  t('BK30 抢救：坏条目跳过、不影响其它条目', (() => {
    if (typeof window.salvageObjects !== 'function') return false;
    const r = window.salvageObjects('[{"ok":1},{"坏的不成对":},{"ok":2}]');
    return r.length === 2 && r[0].ok === 1 && r[1].ok === 2;
  })());
  /* ⚠ 这条断言要**看结果、不要看路径**：我第一版断言"截断时必须走抢救分支"，
     但实测 parseJSONLoose 自己就能把这种截断补成合法 JSON、返回 1 条 —— 于是假失败。
     真正要保证的是"**条目被救回来了**"，至于是正常解析救的还是 salvageObjects 救的，
     对用户没有区别。（抢救分支本身由 BK27~BK30 直接覆盖。） */
  t('BK31 parseSplitResult：完整与截断的输入都能收到条目', (() => {
    if (typeof window.parseSplitResult !== 'function') return false;
    const a = window.parseSplitResult('[{"stem":"完整的题目内容足够长"}]');
    const b = window.parseSplitResult('[{"stem":"完整题"},{"stem":"被截断的');
    const c = window.parseSplitResult('模型跑偏了，这里根本不是 JSON');
    return a.items.length === 1 && b.items.length === 1 && c.items.length === 0;
  })());
  t('BK32 抢救成功时如实告知用户"只拆到一部分"',
    /已拆到前/.test(srcBK) && /输出被截断/.test(srcBK));
  t('BK33 提示词要求"宁可少拆也不要写不完"（从源头减少截断）',
    /宁可少拆也不要写不完/.test(srcBK) && /最多拆 20 道/.test(srcBK));

  // 运行验证：统计 / 筛选 / 渲染（不靠读代码）
  if (typeof window.bankAdd === 'function') {
    try { window.localStorage.removeItem(window.BANK_KEY); } catch (_) {}
    const demo = window.cleanBankItems([
      { stem: '求 3x + 7 = 22 中 x 的值', topic: '一元一次方程', type: 'calc', difficulty: 'easy', marks: 3, source: 's' },
      { stem: '解方程 x^2 - 5x + 6 = 0', topic: '一元二次方程', type: 'calc', difficulty: 'mid', marks: 5, source: 's' },
      { stem: '下列哪一个是质数？', topic: '数与代数', type: 'choice', difficulty: 'easy', marks: 2, options: ['A. 4', 'B. 7'], source: 's' },
      { stem: '证明三角形内角和为 180 度', topic: '几何', type: 'proof', difficulty: 'hard', marks: 8, source: 's' },
    ], { subject: '数学', board: 'CAIE', source: '2026 模拟卷' });
    window.bankAdd(demo);
    const st = window.bankStats();
    t('BK19 统计正确（总数/知识点数/来源数）',
      st.total === 4 && st.topicCount === 4 && Object.keys(st.sources).length === 1,
      JSON.stringify({ t: st.total, tc: st.topicCount, s: Object.keys(st.sources).length }));
    const wrap = document.createElement('div');
    wrap.innerHTML = '<select id="bank-topic"><option></option></select><select id="bank-type"><option></option></select>' +
      '<select id="bank-diff"><option></option></select><select id="bank-source"><option></option></select>' +
      '<div id="bank-summary"></div><div id="bank-list"></div>';
    document.body.appendChild(wrap);
    let rerr = '';
    try { window.renderBank(); } catch (e) { rerr = e.message; }
    const items = document.querySelectorAll('#bank-list .bank-item');
    t('BK20 题库能真实渲染', items.length === 4 && !rerr, rerr);
    t('BK21 筛选生效（按题型筛出证明题，只 1 道）', (() => {
      document.querySelector('#bank-type').value = 'proof';
      window.renderBank();
      const n = document.querySelectorAll('#bank-list .bank-item').length;
      document.querySelector('#bank-type').value = '';
      return n === 1;
    })());
    t('BK22 筛选生效（按知识点）', (() => {
      document.querySelector('#bank-topic').value = '一元二次方程';
      window.renderBank();
      const html = document.querySelector('#bank-list').innerHTML;
      document.querySelector('#bank-topic').value = '';
      return /x\^2 - 5x \+ 6 = 0/.test(html) && !/3x \+ 7 = 22/.test(html);
    })());
    t('BK23 删除单题生效', (() => {
      const before = window.bankAll().length;
      const first = window.bankAll()[0];
      window.bankDelete(first.id);
      return window.bankAll().length === before - 1;
    })());
    t('BK24 按来源清空生效', (() => {
      window.bankClearSource('2026 模拟卷');
      return window.bankAll().length === 0;
    })());
    t('BK25 题目结构带重练所需的字段（tries/right，为"重做原题"打基础）',
      demo.every((q) => q.id && q.topic && q.type && q.difficulty && typeof q.tries === 'number' && typeof q.right === 'number'));
    wrap.remove();
    try { window.localStorage.removeItem(window.BANK_KEY); } catch (_) {}
  }

  console.log('\n=== 37. 学习进度：保存 + 导入导出 ===');
  const srcPG = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  const htmlPG = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssPG = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  /* 为什么这个功能重要：课程与题库只在**本机 localStorage**，
     清一次浏览器数据这段学习历程就没了 —— 而"长期记忆、越上越懂你"是核心承诺。
     所以"能带走、能接回来"是这个承诺的兜底。 */
  t('PG1 有快照组装（带格式标识/版本/摘要/校验和）',
    /function buildProgressSnapshot\(/.test(srcPG) && /PROGRESS_FORMAT/.test(srcPG) &&
    /checksum/.test(srcPG) && /exportedAt/.test(srcPG));
  /* ★ 关键取舍：运行时状态不能进备份 ——
     带过去会污染新设备的额度与合规记录（同意必须在新设备重新取得） */
  t('PG2 备份不含运行时状态（闸门计数/埋点队列/同意记录）', (() => {
    const i = srcPG.indexOf('const PROGRESS_KEYS = {');
    const j = srcPG.indexOf('function progressChecksum');
    const seg = srcPG.slice(i, j);
    const banned = ['ai_gate', 'track_pending', 'consent', 'lingxi_meta', 'guide'];
    return banned.every((b) => seg.indexOf(b) < 0) &&
      /lingxi_courses_v1/.test(seg) && /lingxi_question_bank_v1/.test(seg);
  })());
  t('PG3 备份含学习偏好（主题/授课语言/语速）',
    /PROGRESS_PREF_KEYS = \{/.test(srcPG) && /theme: 'lingxi_theme'/.test(srcPG) &&
    /teachLang: 'lingxi_teach_lang'/.test(srcPG) && /ttsRate: 'lingxi_tts_rate'/.test(srcPG));
  t('PG4 导入前先校验（格式/版本/结构），不半途改数据',
    /function validateProgressFile\(/.test(srcPG) && /format !== PROGRESS_FORMAT/.test(srcPG) &&
    /v > PROGRESS_VERSION/.test(srcPG));
  /* harden：错误文案必须**说清是哪一种**，不能"文件无效"这种等于没说的提示 */
  t('PG5 校验失败的错误文案是具体的（不是"文件无效"）', (() => {
    const cases = ['这个文件是空的', '不是有效的备份文件', '不是灵犀课堂的学习进度备份',
      '备份文件缺少版本号', '来自更新的版本', '文件超过 40MB'];
    return cases.every((c) => srcPG.indexOf(c) >= 0) &&
      !/error: '文件无效'/.test(srcPG) && !/error: 'Error occurred'/.test(srcPG);
  })());
  t('PG6 版本过高时明确拒绝并给出路（提示先更新页面）',
    /当前程序只到 v/.test(srcPG) && /请先更新页面再导入/.test(srcPG));
  t('PG7 校验和只警告不阻断（用户手工编辑过的备份也是他的权利）',
    /校验和与内容不一致/.test(srcPG) && /内容仍会导入/.test(srcPG));
  t('PG8 有导入预览（先让用户看清会发生什么）',
    /function previewProgressImport\(/.test(srcPG) && /新增 /.test(srcPG) && /你本机现有/.test(srcPG));
  t('PG9 合并导入不覆盖更新的本地数据',
    /Number\(c\.progress \|\| 0\) > Number\(old\.progress \|\| 0\)/.test(srcPG) || /localIsNewer/.test(srcPG) ||
    /跳过 /.test(srcPG));
  t('PG10 导入前自动备份当前数据 + 可撤销',
    /PROGRESS_PRE_IMPORT_KEY/.test(srcPG) && /function undoProgressImport\(/.test(srcPG) &&
    /撤销上次导入/.test(srcPG));
  t('PG11 覆盖是不可逆操作 → 二次确认 + 次要样式（不能长得像主按钮）',
    /完全覆盖.*会用备份里的内容替换/.test(srcPG.replace(/\n/g, '')) &&
    /btn-progress-replace">完全覆盖<\/button>'/.test(srcPG.replace(/\s+/g, ' ')) &&
    /class="btn btn-ghost" id="btn-progress-replace"/.test(srcPG));
  t('PG12 偏好导入只补空缺（换设备后本地习惯更该被尊重）',
    /localStorage\.getItem\(key\) == null/.test(srcPG) && /已设置过的不会被改动/.test(srcPG));
  t('PG13 备份失败要说出来（不静默）',
    /当前数据没能自动备份/.test(srcPG) && /这次导入不可撤销/.test(srcPG));
  t('PG14 UI：进度卡 + 打包/接回/撤销三件套',
    /id="progress-card-body"/.test(htmlPG) && /id="btn-progress-export"/.test(srcPG) &&
    /id="progress-import-file"/.test(srcPG) && /id="btn-progress-undo"/.test(srcPG));
  /* ★ 位置很关键：课程/题库只在本机，**未登录的学生同样需要能带走** */
  t('PG15 进度卡放在登录门槛之外（未登录也能用）', (() => {
    const i = htmlPG.indexOf('id="progress-card-body"');
    const gate = htmlPG.indexOf('id="mem-gate"');
    const bodyStart = htmlPG.indexOf('id="mem-body"');
    return i > 0 && gate > 0 && i < gate && i < bodyStart;
  })());
  t('PG16 空状态有明确引导（没什么可带走时说清楚）',
    /还没有可保存的内容/.test(srcPG));
  t('PG17 结果区用 role="status"（读屏能听到导入结果）',
    /setAttribute\('role', 'status'\)/.test(srcPG));
  t('PG18 允许重复选择同一个文件（不改 value 会选不动）',
    /f\.value = '';/.test(srcPG) && /允许重复选同一个文件/.test(srcPG));
  t('PG19 埋点已登记（导出/导入）', (() => {
    const i = srcPG.indexOf('const TRACK_EVENTS');
    const seg = srcPG.slice(i, i + 5400);
    return /progress_export/.test(seg) && /progress_import/.test(seg);
  })());
  t('PG20 样式齐备（含护眼模式与窄屏两列）',
    /\.pg-stat/.test(cssPG) && /html\[data-theme="eye"\] \.pg-result\.ok/.test(cssPG) &&
    /\.pg-stat \{ flex: 1 1 calc\(50% - 5px\)/.test(cssPG));
  /* ★ 实测抓到的真 bug：点完「合并导入」后统计刷新了，但"新增 2 门课程"的提示**被抹掉了** ——
     因为 renderProgressCard() 会整体重绘 #progress-card-body，把刚写进去的结果一起清空。
     修法按"一处收口"：让重绘**自己**保住结果，而不是要求每个调用方记得顺序。 */
  t('PG20b 重绘进度卡时会保住已有的结果提示（否则导入结果会被自己抹掉）',
    /const keepHtml = \(keep && !keep\.hidden\) \? keep\.outerHTML : ''/.test(srcPG) &&
    /if \(keepHtml\) \{/.test(srcPG) && /fresh\.outerHTML = keepHtml/.test(srcPG));
  t('PG20c 导入与撤销都遵循"先重绘、再写结果"的顺序',
    /renderProgressCard\(\);\s*\n\s*showProgressResult\('ok', mode === 'replace'/.test(srcPG) &&
    /renderProgressCard\(\);\s*\/\/ 先重绘（会刷新统计与撤销按钮），再写结果\s*\n\s*showProgressResult\('ok', '已还原到导入前的状态'/.test(srcPG));

  // 运行验证：快照 / 校验 / 预览 / 合并 / 撤销（不靠读代码）
  if (typeof window.buildProgressSnapshot === 'function') {
    const BK = window.BANK_KEY;
    const CK = 'lingxi_courses_v1';
    const PRE = 'lingxi_progress_pre_import';
    // 造一份"本机数据"
    try { window.localStorage.removeItem(BK); window.localStorage.removeItem(PRE); } catch (_) {}
    const oldCourses = [{ id: 'c1', title: '旧课', progress: 100, createdAt: 1000 }];
    try { window.localStorage.setItem(CK, JSON.stringify(oldCourses)); } catch (_) {}
    window.state.courses = oldCourses;
    window.bankAdd(window.cleanBankItems([{ stem: '本机已有的一道题目内容足够长', topic: 'A', type: 'calc' }], { source: 's' }));

    const snap = window.buildProgressSnapshot();
    t('PG21 快照结构完整（format/version/summary/data/checksum）',
      snap.format === window.PROGRESS_FORMAT && snap.version === window.PROGRESS_VERSION &&
      !!snap.summary && !!snap.data && /^[0-9a-f]{8}$/.test(snap.checksum),
      JSON.stringify({ f: snap.format, v: snap.version, s: snap.summary }));
    t('PG22 快照里没有运行时状态键',
      Object.keys(snap.data).sort().join(',') === 'bank,courses,prefs');

    // 校验：各种坏输入
    const bad = [
      ['', '空文件'],
      ['   ', '空白'],
      ['不是 json', '非 JSON'],
      ['[]', '数组'],
      ['{"format":"other","version":1,"data":{}}', '非本产品'],
      ['{"format":"lingxi-progress","data":{}}', '缺版本号'],
      ['{"format":"lingxi-progress","version":999,"data":{}}', '版本过高'],
      ['{"format":"lingxi-progress","version":1}', '缺数据段'],
      ['{"format":"lingxi-progress","version":1,"data":{"courses":{}}}', '课程不是列表'],
    ];
    const results = bad.map(([txt]) => window.validateProgressFile(txt));
    t('PG23 九种坏输入全部被拒（且都给得出原因）',
      results.every((r) => r.ok === false && r.error && r.error.length > 6),
      results.map((r) => r.error).slice(0, 3).join(' | '));
    t('PG24 错误信息彼此不同（不是同一句通用文案）',
      new Set(results.map((r) => r.error)).size >= 7,
      String(new Set(results.map((r) => r.error)).size));
    t('PG25 合法文件通过校验，且校验和一致时不报警告', (() => {
      const r = window.validateProgressFile(JSON.stringify(snap));
      return r.ok === true && !r.warn && r.snapshot.format === window.PROGRESS_FORMAT;
    })());
    t('PG26 内容被改坏时给出警告但仍允许导入', (() => {
      const tampered = JSON.parse(JSON.stringify(snap));
      tampered.data.bank.push({ id: 'x', stem: '偷偷加进去的一道题足够长', topic: 'X' });
      const r = window.validateProgressFile(JSON.stringify(tampered));
      return r.ok === true && /校验和与内容不一致/.test(r.warn);
    })());
    t('PG27 无校验和的旧备份给警告但能导入', (() => {
      const old = JSON.parse(JSON.stringify(snap));
      delete old.checksum;
      const r = window.validateProgressFile(JSON.stringify(old));
      return r.ok === true && /没有校验和/.test(r.warn);
    })());

    // 预览：区分新增 / 更新 / 重复
    const incoming = {
      format: window.PROGRESS_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      data: {
        courses: [
          { id: 'c1', title: '旧课', progress: 50, createdAt: 1000 },      // 本机更新 → 跳过
          { id: 'c2', title: '新课', progress: 0, createdAt: 2000 },       // 新增
        ],
        bank: [
          { id: 'q1', stem: '本机已有的一道题目内容足够长', topic: 'A' },   // 重复
          { id: 'q2', stem: '备份里带来的另一道新题目内容也够长', topic: 'B' }, // 新增
        ],
        prefs: { theme: 'eye' },
      },
    };
    const pv = window.previewProgressImport(incoming);
    t('PG28 预览计数正确（新增/更新/重复/本机现有）',
      pv.newCourses === 1 && pv.newerCourses === 0 && pv.incCourses === 2 &&
      pv.newQs === 1 && pv.dupQs === 1 && pv.curCourses === 1 && pv.curQs === 1,
      JSON.stringify({ nc: pv.newCourses, nu: pv.newerCourses, nq: pv.newQs, dq: pv.dupQs }));

    // 合并导入
    const r1 = window.applyProgressImport(incoming, 'merge');
    t('PG29 合并导入成功且统计正确',
      r1.ok && r1.result.courses.added === 1 && r1.result.courses.skipped === 1 &&
      r1.result.bank.added === 1 && r1.result.bank.dup === 1,
      JSON.stringify(r1.result));
    t('PG30 本机更新的课程没被旧备份覆盖（进度仍是 100）',
      window.state.courses.find((c) => c.id === 'c1').progress === 100);
    t('PG31 撤销能回到导入前（课程与题库都回滚）', (() => {
      const r = window.undoProgressImport();
      const ok = r.ok && window.state.courses.length === 1 &&
        window.state.courses[0].id === 'c1' && window.bankAll().length === 1;
      return ok && !window.hasProgressBackup();
    })());

    // 覆盖导入
    const r2 = window.applyProgressImport(incoming, 'replace');
    t('PG32 覆盖导入按备份替换',
      r2.ok && window.state.courses.length === 2 && window.bankAll().length >= 2,
      JSON.stringify({ c: window.state.courses.length, q: window.bankAll().length }));

    // 清场
    try {
      window.localStorage.removeItem(BK); window.localStorage.removeItem(PRE); window.localStorage.removeItem(CK);
    } catch (_) {}
    window.state.courses = [];
  }

  console.log('\n=== 38. UI 细节：字号 / 对比度 / 触摸目标 ===');
  const cssUI = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  /* 这一批来自实测（浏览器里量出来的），不是凭观感。锁住它们，
     免得以后有人把字号改小、或把算好的对比度改回去。 */
  t('UI1 文字最小字号 12px（10px 只允许出现在 ✓ 符号这类图标上）', (() => {
    const sizes = {};
    (cssUI.match(/font-size: (\d+(?:\.\d+)?)px/g) || []).forEach((m) => {
      const v = parseFloat(m.split(' ')[1]);
      sizes[v] = (sizes[v] || 0) + 1;
    });
    const small = Object.keys(sizes).map(Number).filter((v) => v < 12);
    /* 允许的例外必须**有注释解释**（图标/符号），不是随便放过 */
    const hasReason = /这个 10px 是\*\*刻意保留\*\*的/.test(cssUI);
    return small.every((v) => v === 10) && sizes[10] === 1 && hasReason;
  })());
  t('UI2 没有残留的半像素字号（13.5/14.5/15.5/16.5 会造成层次浑浊）',
    !/font-size: (13\.5|14\.5|15\.5|16\.5)px/.test(cssUI));
  t('UI3 13~17px 区间的字号种类 ≤5（原来有 8 种）', (() => {
    const sizes = {};
    (cssUI.match(/font-size: (\d+(?:\.\d+)?)px/g) || []).forEach((m) => {
      const v = parseFloat(m.split(' ')[1]);
      sizes[v] = (sizes[v] || 0) + 1;
    });
    return Object.keys(sizes).map(Number).filter((v) => v >= 13 && v <= 17).length <= 5;
  })());
  t('UI4 <small> 有显式字号（浏览器默认 smaller 会算出 11.7px 这种怪值）',
    /^small \{ font-size: 12px; \}/m.test(cssUI));
  /* 对比度：这几个值是**算出来的**（见 _authtest/contrast-calc.txt），不是挑的 */
  t('UI5 --primary-2 已调深（白字在它上面达 5.18:1；原来 #8B5CF6 只有 4.23）',
    /--primary-2: #7C4CE8/.test(cssUI) && !/--primary-2: #8B5CF6/.test(cssUI));
  t('UI6 --primary-soft 已调浅（主色在其上达 4.60:1；原来 #EEEDFD 只有 4.41）',
    /--primary-soft: #F3F2FE/.test(cssUI) && !/--primary-soft: #EEEDFD/.test(cssUI));
  t('UI7 页脚小字与卡片提示改用 --muted（原来 3.06 / 2.92，均低于 4.5）', (() => {
    const foot = /\.footer-sub \{ font-size: 12px; color: var\(--muted\)/.test(cssUI);
    const tip = /\.subject-head-tip \{ font-size: 12px; color: var\(--muted\)/.test(cssUI);
    const sg = /\.sg-dur \{ margin-left: auto; font-size: 12px; color: var\(--muted\)/.test(cssUI);
    return foot && tip && sg && !/#8B91A8/.test(cssUI) && !/#8A90A8/.test(cssUI);
  })());
  t('UI8 选中态系统卡浅底已提亮（其上的 12px 灰字由 4.44 → 4.66）',
    /linear-gradient\(135deg, #FAFAFF, #FBF9FF\)/.test(cssUI));
  /* 刻意的装饰要有"它为什么是对的"的说明，否则以后会被当 bug 改掉 */
  t('UI9 装饰水印数字有说明（避免以后被误当对比度问题改深）',
    /刻意的装饰水印/.test(cssUI) && /aria-hidden/.test(cssUI));
  t('UI10 触摸目标用 padding+负 margin 扩大（视觉位置不变）',
    /padding: 10px 9px; margin: -10px -9px/.test(cssUI) &&     // #ai-status
    /padding: 7px 5px; margin: -7px -5px/.test(cssUI) &&       // 页脚法务链接
    /padding: 3px 0; margin: -3px 0 5px/.test(cssUI));         // 表单 label
  t('UI11 数字用等宽字型（数值变化时不左右跳动）',
    /font-variant-numeric: tabular-nums/.test(cssUI) && /\.bank-meta, \.pp-marks/.test(cssUI));
  t('UI12 不禁用页面缩放（user-scalable=no 是无障碍硬伤）', (() => {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const m = html.match(/<meta name="viewport" content="([^"]+)"/);
    return !!m && !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\d)/i.test(m[1]);
  })());

  console.log('\n=== 39. 静默失败：登出失败不许"看着登出了其实没有" ===');
  const srcSO = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  /* 来源：两遍独立审计里的**代码遍**查出来的（纯视觉那遍看不到 —— 界面上一切正常）。
     doSignOut 原来是 `try{await signOut()}catch(_){}` 之后**无条件**清本地状态并提示"已退出登录"，
     于是用户被告知一件可能没发生的事。 */
  /* ⚠ 断言要问对问题：我第一版写的是"整个函数里不许有 catch (_) {}" ——
     那会把 console.warn / track 外面两层**合理的防御性包装**也否掉（假失败）。
     真正要问的是：**紧跟在 signOut 后面的那个 catch 里，有没有处理失败**。 */
  t('SO1 signOut 的 catch 里确实处理了失败（不是空 catch）',
    /signOut\(\);[\s\S]{0,120}?catch\s*\(e\)\s*\{[\s\S]{0,300}?serverOk = false/.test(srcSO));
  t('SO2 登出失败时如实告知（不再无条件说"已退出登录"）',
    /本机已清除登录信息，但登出没能通知服务器/.test(srcSO) &&
    /if \(serverOk\) toast\('已退出登录/.test(srcSO));
  t('SO3 本地状态仍然照清（不该因网络问题把用户卡在登录态）',
    (() => {
      const i = srcSO.indexOf('async function doSignOut');
      const body = srcSO.slice(i, i + 1400);
      return /state\.user = null;/.test(body) && /state\.mem = null;/.test(body);
    })());
  t('SO4 登出失败有埋点（可衡量"看着登出了其实没有"的发生率）', (() => {
    const i = srcSO.indexOf('const TRACK_EVENTS');
    return /signout_server_failed/.test(srcSO.slice(i, i + 5600)) && /track\('signout_server_failed'/.test(srcSO);
  })());
  t('SO5 失败有 console.warn（排查时能看到）', /\[auth\] 登出请求失败/.test(srcSO));

  console.log('\n=== 40. 直播课无声：堵住"开口了但不结束"这扇门 ===');
  const srcTTSStuck = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  /* 背景：这个症状被修过两次，修的都是"**没开口**"（voice 对象失效抛异常、引擎完全不触发）。
     但 Chrome 还有另一种：**开口了，onend / onerror 永不触发**（长句、切后台、cancel 之后、部分安卓 WebView）。
     此时 promise 永不 resolve → await 挂死 → drainSpeechQueue 的 finally 不执行
     → TTS.speaking 永久为 true → speak() 的 `if (!TTS.speaking)` 从此永远跳过 → **永久静音**。
     已用确定性的方式复现（模拟"开口后不结束"）：speaking 卡 true、队列 0→1→3、只有第 1 句进引擎、且无任何报错。 */
  t('TTS1 有"与是否开口无关"的总时长上限（原来那条兜底 `if (started) return` 只管没开口）', (() => {
    const i = srcTTSStuck.indexOf('function speakOne');
    /* 窗口放到 5600：说话函数里注释较多（每条修复都写了为什么），代码位置被推远。
       断的是"这两件事都在 speakOne 里"，不是它们离函数头多少字符。 */
    const body = srcTTSStuck.slice(i, i + 5600);
    return /if \(settled\) return;/.test(body) && /text\.length \/ \(3\.2 \* \(u\.rate/.test(body);
  })());
  t('TTS2 done 幂等且会清掉所有兜底计时器（多个来源都会调它）',
    /if \(settled\) return;\s*\n\s*settled = true;\s*\n\s*timers\.forEach/.test(srcTTSStuck));
  t('TTS3 超时后强制 cancel + resolve，保证队列一定继续走', (() => {
    const i = srcTTSStuck.indexOf('兜底 2（2026-09-27 新增');
    /* 窗口放到 2600：注释里写了估算依据，代码被推远了。
       断的是"这段兜底里确实 cancel 了并且放行"，不是它离注释多少字符。 */
    const body = srcTTSStuck.slice(i, i + 2600);
    return /speechSynthesis\.cancel\(\)/.test(body) && /done\(\);/.test(body);
  })());
  t('TTS4 卡住会被上报（可衡量真实发生率），偶发不刷屏、连续 3 次才提示用户',
    /TTS\._stuckCount = \(TTS\._stuckCount \|\| 0\) \+ 1/.test(srcTTSStuck) &&
    /if \(TTS\._stuckCount >= 3 && TTS\.enabled\) notifyTTSProblem\('silent'\)/.test(srcTTSStuck) &&
    /console\.warn\('\[tts\] 这一句超过预估时长仍未结束/.test(srcTTSStuck));
  t('TTS5 正常结束时重置计数（否则偶发会被累加成"连续"）',
    /u\.onstart = \(\) => \{[\s\S]{0,240}?TTS\._stuckCount = 0;/.test(srcTTSStuck));
  t('TTS6 埋点已登记', (() => {
    const i = srcTTSStuck.indexOf('const TRACK_EVENTS');
    return /tts_utterance_stuck/.test(srcTTSStuck.slice(i, i + 6200));
  })());
  t('TTS7 TTS 对象有 _stuckCount 字段', /_stuckCount: 0,/.test(srcTTSStuck) && /_speakingNow: false,/.test(srcTTSStuck));

  // 运行验证：模拟"开口了但永不结束"的引擎，看队列是否还能继续
  if (typeof window.speak === 'function' && window.TTS) {
    const T = window.TTS;
    const savedSpeak = window.speechSynthesis.speak;
    const savedCancel = window.speechSynthesis.cancel;
    let calls = 0;
    window.speechSynthesis.speak = function (u) { calls++; try { if (u.onstart) u.onstart(); } catch (_) {} };  // 开口，但不结束
    window.speechSynthesis.cancel = function () {};
    T.enabled = true;
    if (!T.voice) T.voice = (window.pickVoice && window.pickVoice()) || null;
    T.queue.length = 0;
    T.speaking = false;
    T._stuckCount = 0;
    window.speak('第一句，用来触发卡住。');
    await new Promise((r) => setTimeout(r, 2600));
    const during = { speaking: T.speaking, queue: T.queue.length, calls: calls };
    // 关键：只有在**修复后**，TTS.speaking 才会在超时上限后回落；否则永久 true
    const estMs = Math.max(5000, Math.round(('第一句，用来触发卡住。'.length / (4 * 1)) * 1000 * 2) + 2500);
    await new Promise((r) => setTimeout(r, estMs + 600));
    const after = { speaking: T.speaking, queue: T.queue.length };
    window.speechSynthesis.speak = savedSpeak;
    window.speechSynthesis.cancel = savedCancel;
    T.speaking = false; T.queue.length = 0; T._stuckCount = 0;
    t('TTS8 引擎"开口后不结束"时，队列不再永久卡死（会自动跳过并继续）',
      after.speaking === false,
      '超时后 speaking=' + after.speaking + '（true 表示仍永久静音）');
  }

  console.log('\n=== 41. 引擎拒绝发声：点一下要能恢复（依据线上真实上报） ===');
  const srcTR = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  /* 线上上报 `tts_unavailable{reason:'silent'}` 的含义：speak 调了、但 1.5s 内 onstart 不触发
     = **引擎拒绝发声**（浏览器要求用户手势等）。当时的处理是"提示一次 → 丢掉这句 → 永不重试"。
     而同一份上报里，用户在 2 分钟后**确实点过界面**（live_ask），产品却不理会
     → 用户感觉"我点了也没用"。修法：挂一次性手势监听，点一下就自动重试。 */
  t('GR1 有一次性手势重试（引擎拒绝后，点一下自动重试）',
    /function armGestureRetry\(/.test(srcTR) && /addEventListener\('pointerdown', fire, true\)/.test(srcTR) &&
    /addEventListener\('keydown', fire, true\)/.test(srcTR));
  t('GR2 只挂一次（避免叠加监听器）',
    /if \(TTS\._gestureArmed\) return;/.test(srcTR) && /TTS\._gestureArmed = true;/.test(srcTR));
  t('GR3 触发后解除监听，并把被拒的那句重新排进队列',
    /removeEventListener\('pointerdown', fire, true\)/.test(srcTR) &&
    /TTS\.queue\.unshift\(\{ text: t,/.test(srcTR));
  t('GR4 触发时 resume 引擎（被拦的引擎要先唤醒）',
    /speechSynthesis\.paused\) window\.speechSynthesis\.resume\(\)/.test(srcTR));
  t('GR5 允许"还是不行"时再提示一次（否则第二次就哑了）',
    /TTS\._gestureArmed = false;[\s\S]{0,40}?ttsNotified = '';/.test(srcTR));
  t('GR6 silent 分支真的调了它（不只是提示）', (() => {
    const i = srcTR.indexOf("notifyTTSProblem('silent')");
    const seg = srcTR.slice(i, i + 420);
    return /armGestureRetry\(text\)/.test(seg);
  })());
  t('GR7 silent 的提示文案直接给出"点一下"，且它真会生效（不是敷衍）',
    /点一下屏幕任意处/.test(srcTR) && /就会重新试一次/.test(srcTR));
  t('GR8 埋点已登记 tts_gesture_retry（可衡量真实发生率）', (() => {
    const i = srcTR.indexOf('const TRACK_EVENTS');
    return /tts_gesture_retry/.test(srcTR.slice(i, i + 6600));
  })());
  /* ★ 暖机我**没能验证出它有效** —— 原本假设"用户激活窗口只有几秒、开场白等 AI 返回就过期"，
     但 speechSynthesis 用的是 sticky activation（获得后长期有效），假设站不住；
     构造的假引擎也没证明它有解锁作用。所以它是"成本极低的尝试"，**不是已证实的修复**。
     断言只锁"它存在且有注释说明未证实"，不假装它是治本。 */
  t('GR9 进课堂时有一次低成本暖机（注释里如实标注"未验证有效"）', (() => {
    const i = srcTR.indexOf('ensureVoiceReady();\n');
    const seg = srcTR.slice(i, i + 1600);
    return /volume = 0/.test(seg) && /speechSynthesis\.speak\(warm\)/.test(seg) &&
      /我没有验证出它有效/.test(seg);
  })());
  /* 重置动作被抽到 retryPendingSpeech()（被手势重试和提示里的「再试一次」共用），
     所以断言指向那里 —— 断的是"这三件事都做了"，不是它们写在哪。 */
  t('GR10 重试前把可疑状态都重置（cancel + 重取音色 + resume），不靠猜单一原因', (() => {
    const i = srcTR.indexOf('function retryPendingSpeech');
    const seg = srcTR.slice(i, i + 1200);
    return /window\.speechSynthesis\.cancel\(\)/.test(seg) &&
      /TTS\.voice = null; TTS\.voice = pickVoice\(\);/.test(seg) &&
      /speechSynthesis\.paused\) window\.speechSynthesis\.resume\(\)/.test(seg);
  })());
  t('GR11 重试的理由有注释说明（"没法确证是哪一种，所以三件事都做"）',
    /没法确证是哪种原因/.test(srcTR) && /三件事都做/.test(srcTR));
  /* ★ 切到后台 → Chrome 会暂停 speechSynthesis → onstart 不触发 → 正是 reason:"silent"。
     学生的真实动作很可能是：点进直播间 → 趁 AI 生成切去别处 → 切回来老师已哑。
     所以"回到前台"本身就该触发重试，不该非要用户再点一下。 */
  t('GR12 回到前台（visibilitychange → visible）也会触发重试', (() => {
    const i = srcTR.indexOf('function armGestureRetry');
    const seg = srcTR.slice(i, i + 2600);
    return /const onVis = \(\) => \{/.test(seg) &&
      /document\.visibilityState === 'visible'/.test(seg) &&
      /addEventListener\('visibilitychange', onVis, true\)/.test(seg) &&
      /removeEventListener\('visibilitychange', onVis, true\)/.test(seg);
  })());
  t('GR13 上报里区分"是被点什么触发的还是切回前台触发的"',
    /how: hitWhy/.test(srcTR) && /let hitWhy = 'gesture'/.test(srcTR) && /hitWhy = 'visible'/.test(srcTR));
  /* 诊断字段：线上只报 reason 太粗，没法区分是后台暂停/无激活/音色失效/设备无声 */
  t('GR14 tts_unavailable 上报带现场信息（visibility/activation/paused/voices）',
    /info\.vis = /.test(srcTR) && /navigator\.userActivation/.test(srcTR) &&
    /info\.paused = /.test(srcTR) && /info\.voices = /.test(srcTR));
  t('GR15 诊断字段有注释说明"为什么加"（免得以后被当噪音删掉）',
    /把\*\*判断所需的现场信息\*\*一起上报/.test(srcTR));

  console.log('\n=== 42. 语音问题要"看得见"（不再只靠 2 秒的 toast） ===');
  /* ★ 这一节的由来：线上只上报了 reason:"silent"，我据此排查很久；
     但**用户那边从头到尾只看到"没声音"三个字** —— 因为提示是 2 秒就消失的 toast。
     而且 track() 要求**已登录**，访客一条事件都没有，我却拿"没有事件"当"没进过课堂"的证据（推错了）。
     所以把诊断放到用户眼前：常驻、可自助、声音恢复后自愈。 */
  const htmlNotice = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const cssNotice = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  t('TN1 课堂里有常驻提示元素（不是 toast）',
    /id="tts-notice"/.test(htmlNotice) && /id="tts-notice-why"/.test(htmlNotice) &&
    /id="tts-notice-retry"/.test(htmlNotice) && /id="tts-notice-close"/.test(htmlNotice));
  t('TN2 提示是常驻的（带 hidden 开关，不靠定时器自己消失）',
    /class="tts-notice" id="tts-notice" hidden/.test(htmlNotice) && /function hideTTSNotice\(/.test(srcTR));
  t('TN3 每种原因都给了"照着做就行"的说明', (() => {
    const i = srcTR.indexOf('function ttsNoticeTip');
    const seg = srcTR.slice(i, i + 900);
    return /unsupported:/.test(seg) && /no_voice:/.test(seg) && /no_zh:/.test(seg) &&
      /silent:/.test(seg) && /stuck:/.test(seg);
  })());
  t('TN4 「再试一次」按钮走统一的重置+重排路径',
    /function retryPendingSpeech\(/.test(srcTR) &&
    /\$\('#tts-notice-retry'\)/.test(srcTR) &&
    /const did = retryPendingSpeech\(\)/.test(srcTR));
  t('TN5 真的出声后提示自动收起（自愈，不用用户手动关）',
    /u\.onstart = \(\) => \{[\s\S]{0,240}?hideTTSNotice\(\); ttsNotified = '';/.test(srcTR));
  t('TN6 常驻提示不受"只提示一次"去重限制（要用户看清）', (() => {
    const i = srcTR.indexOf('function notifyTTSProblem');
    const seg = srcTR.slice(i, i + 320);
    return seg.indexOf('showTTSNotice(reason);') < seg.indexOf('if (ttsNotified === reason) return;');
  })());
  t('TN7 提示样式齐备（含护眼模式与窄屏换行）',
    /\.tts-notice \{/.test(cssNotice) && /html\[data-theme="eye"\] \.tts-notice/.test(cssNotice) &&
    /\.tts-notice \{ flex-wrap: wrap/.test(cssNotice));

  console.log('\n=== 14. 结束课堂清理 ===');
  try { window.endLiveSilent(); t('endLiveSilent 无异常', true); }
  catch (e) { t('endLiveSilent 无异常', false, e.message); }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}, 500);
