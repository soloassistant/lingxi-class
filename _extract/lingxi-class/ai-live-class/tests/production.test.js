/* ============================================================
   生产上线审查回归（production launch review）
   —— 对应"按上线标准自查"这类要求，把最容易在真环境里爆雷的
   两类问题钉成断言：

   1) 数据保存路径不能引用不存在的变量（历史 bug：saveCourse 用了未定义的
      `arr`，会让「进入直播间」直接抛 ReferenceError，课进不了直播间）。
   2) AI 生成内容 / 用户输入 / 云端记忆，但凡进入 innerHTML 的，都必须转义
      （esc/mdLite/textContent），不能让模型输出变成可执行的 XSS。
   ============================================================ */
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

const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.local/' });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
window.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {} };
window.SpeechSynthesisUtterance = function (txt) { this.text = txt; };

// 最小云桩：让 init 能跑、loadModels 能落到一个模型，但绝不打真网络
window.WorkBuddyCloud = { createWorkBuddyCloud: () => ({
  llm: {
    models: { list: async () => [{ id: 'deepseek-v4.1-flash', name: 'DS', enabled: true, maxOutputTokens: 128000 }] },
    chat: { completions: { create: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }) } },
  },
  auth: {
    getSession: async () => ({ data: null, error: null }),
    getUser: async () => ({ data: null, error: { kind: 'unauthenticated' } }),
    onAuthStateChange: () => () => {},
  },
  database: { from: () => ({ select() { return this; }, limit() { return this; }, order() { return this; }, eq() { return this; }, maybeSingle() { return this; }, then: (r) => Promise.resolve({ data: [], error: null }).then(r), catch: (r) => Promise.resolve({ data: [], error: null }).catch(r) }) },
}) };

const sc = document.createElement('script');
sc.textContent = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
document.head.appendChild(sc);

// 判定容器里是否出现了可执行的危险节点。
// 注意：转义后的文本会合法地包含 "onerror=" 字面量（`&lt;img src=x onerror=...&gt;`），
// 所以不能拿子串正则去 match 转义文本，只能查真实 DOM 节点。
function isClean(el) {
  if (!el) return false;
  return el.querySelector('script, img, iframe, object, embed, [onerror], [onload], [onmouseover]') === null;
}

const X = '<img src=x onerror=window.__xss=1><script>window.__xss=2</script>';
const X_HTMLENT = '&lt;img src=x onerror=window.__xss=1&gt;';

setTimeout(async () => {
  console.log('=== 1. 保存课程到「我的课程」：不能引用不存在的变量 ===');
  window.state.courses = [];
  window.saveCourse({ id: 'x1', title: '课A', subject: '数学', grade: '高一', level: '提高', duration: '45 分钟' }, false);
  t('保存后 state.courses 有 1 条', window.state.courses.length === 1);
  t('课程已持久化到 localStorage',
    (window.localStorage.getItem(window.scopedContentKey(window.CONTENT_KEYS.courses)) || '').indexOf('x1') >= 0);
  window.saveCourse({ id: 'x1', title: '课A-改' }, false);
  t('同 id 再次保存是更新而非新增', window.state.courses.length === 1 && window.state.courses[0].title === '课A-改');
  window.saveCourse({ id: 'x2', title: '课B' }, false);
  t('新课程插入到最前', window.state.courses.length === 2 && window.state.courses[0].id === 'x2');

  console.log('=== 2. AI 生成内容 / 用户输入必须被转义（XSS 防护）===');

  // 2a. 课件（slideHTML）
  {
    const stage = document.getElementById('slide-stage');
    stage.innerHTML = window.slideHTML(
      { type: 'content', title: X, bullets: [X, '<b>粗体正常</b>'] }, 0, 1, 'indigo');
    t('slideHTML 不产生可执行节点', isClean(stage));
    t('slideHTML 标题被转义', stage.innerHTML.indexOf(X_HTMLENT) >= 0);
    stage.innerHTML = window.slideHTML(
      { type: 'quiz', title: X, question: X, options: [X + ' 选项', 'B. 正常'], answer: X, analysis: X }, 0, 1, 'indigo');
    t('slideHTML 练习页不产生可执行节点', isClean(stage));
  }

  // 2b. 生成结果卡（renderGenCourse）
  {
    const course = {
      id: 'g1', title: X, subject: X, grade: X, level: X, duration: X, system: 'cn',
      outline: { title: X, summary: X, knowledgePoints: [X], stages: [{ name: X, duration: X, content: X }], homework: [X], tips: X },
      slides: [{ type: 'content', title: X, bullets: [X] }],
    };
    window.renderGenCourse(course);
    t('renderGenCourse 不产生可执行节点', isClean(document.getElementById('gen-course')));
  }

  // 2c. 聊天气泡（appendMessage）
  {
    const wrap = document.getElementById('chat-messages');
    wrap.innerHTML = '';
    window.appendMessage('user', X);
    window.appendMessage('ai', X);
    t('appendMessage 用户气泡无注入', wrap.querySelector('.msg.me .msg-bubble') && isClean(wrap.querySelector('.msg.me .msg-bubble')));
    t('appendMessage 老师气泡无注入', wrap.querySelector('.msg.ai .msg-bubble') && isClean(wrap.querySelector('.msg.ai .msg-bubble')));
  }

  // 2d. 课堂小结（renderSummary）
  {
    window.renderSummary({
      mastered: [X], weakPoints: [X], homework: [X],
      cards: [{ q: X, a: X }], reviewPlan: [X], comment: X,
      // 错因是模型输出的新字段 —— 同样是 innerHTML sink，谁都不能豁免转义
      errorCauses: [{ cause: 'careless', topic: X, detail: X, fix: X }],
    }, null, null, {});
    t('renderSummary 不产生可执行节点', isClean(document.getElementById('summary-body')));
  }

  // 2d2. 错因列表（renderCauses）：topic / detail / fix 三个字段都是模型输出
  {
    const html = window.renderCauses([{ cause: 'careless', topic: X, detail: X, fix: X }]);
    const box = document.getElementById('mem-causes');
    box.innerHTML = html;
    t('renderCauses 不产生可执行节点', isClean(box));
    t('renderCauses 转义 topic/detail/fix',
      html.indexOf('<img') < 0 && html.indexOf('<script') < 0 && html.indexOf('&lt;img') >= 0);
  }

  // 2d3. 错因分布图谱（renderErrorProfile）：知识点/科目来自历史记录，同样要转义
  {
    window.renderErrorProfile([{ subject: X, error_causes: [{ cause: 'careless', topic: X }] }]);
    t('renderErrorProfile 不产生可执行节点', isClean(document.getElementById('mem-causes')));
  }

  // 2e. 我的课程列表（renderCourses）
  {
    window.state.courses = [{ id: 'c1', title: X, subject: X, grade: X, level: X, duration: X, system: 'cn', systemName: '国内', systemIco: 'CN', boards: [], createdAt: Date.now(), progress: 0, slides: [] }];
    window.state.courseFilter = 'all';
    window.renderCourses();
    t('renderCourses 不产生可执行节点', isClean(document.getElementById('course-list')));
  }

  // 2f. 直播间环节列表（renderStageList）
  {
    window.renderStageList({ outline: { stages: [{ name: X, duration: X }] } });
    t('renderStageList 不产生可执行节点', isClean(document.getElementById('stage-list')));
  }

  // 2g. mdLite 先转义再加粗
  {
    const out = window.mdLite('<b onclick=1>hi</b> **x**');
    t('mdLite 先转义', out.indexOf('&lt;b') >= 0);
    t('mdLite 保留合法加粗', out.indexOf('<strong>x</strong>') >= 0);
  }

  // 2i. errorRequestId 也是 innerHTML 的 sink，服务端 requestId 同样要转义
  {
    const r = window.errorRequestId({ requestId: '<img src=x onerror=window.__xss=1>' });
    t('errorRequestId 转义 requestId', r.indexOf('<img') < 0 && r.indexOf('&lt;img') >= 0);
  }

  // 2h. 兜底：全程没有任何注入脚本真的执行（独立于 DOM 判断）
  t('没有任何注入脚本被执行（window.__xss 未被污染）', window.__xss === undefined);

  console.log('=== 3. 上线基线：CSP / 元信息 / 无内联事件处理器 ===');
  {
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    t('CSP meta 存在', !!csp);
    t('CSP 默认收紧到 self 且无 unsafe-eval', !!csp && csp.content.indexOf("default-src 'self'") >= 0 && csp.content.indexOf('unsafe-eval') < 0);
    t('CSP 未开放 unsafe-inline 给脚本', !!csp && !/script-src[^;]*unsafe-inline/.test(csp.content));
    const noInlineHandler = !/on(click|error|load|mouseover|mouseout)\s*=\s*["']/.test(
      fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
    t('index.html 无内联事件处理器', noInlineHandler);
    const app = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    t('app.js 无 eval / new Function', !/eval\(|new Function|Function\(/.test(app));
    t('app.js 无内联事件处理器注入', !/onerror\s*=\s*["']|onclick\s*=\s*["']/.test(app));
  }

  console.log('=== 4. 页面结构：视图必须是兄弟节点，不能互相嵌套 ===');
  {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    t('section 标签开合平衡', (html.match(/<section\b/g) || []).length === (html.match(/<\/section>/g) || []).length);
    /* 这条原本写的是 `views.length === 5` —— 但它的**意图**不是"恰好 5 个"，
       而是"每个视图都挂在 <main> 下、没有互相嵌套错位"（下面两行注释就是原因：
       学习档案曾被误嵌进「我的课程」，切过去会被父容器隐藏）。
       硬编码数字在**新增视图时会假失败**（加真题库时就是这样），
       而且它其实没在检查嵌套这件事本身。所以改成断言意图：
         · 每个 .view 都在 <main> 里
         · 每个 .view 的父节点就是 <main>（不允许被别的 view 包住）
         · 数量至少覆盖已知视图（防误删） */
    const allViews = Array.prototype.slice.call(document.querySelectorAll('section.view'));
    const mainEl = document.querySelector('main');
    t('每个视图都在 <main> 内（不存在游离的视图）',
      allViews.length > 0 && allViews.every((v) => mainEl && mainEl.contains(v)), '视图数 ' + allViews.length);
    t('每个视图都是 <main> 的直接子节点（不互相嵌套）',
      allViews.every((v) => v.parentElement && v.parentElement.tagName === 'MAIN'),
      allViews.filter((v) => !(v.parentElement && v.parentElement.tagName === 'MAIN')).map((v) => v.id).join(','));
    const knownViews = ['view-home', 'view-generate', 'view-live', 'view-courses', 'view-papers', 'view-bank', 'view-memory'];
    t('已知视图一个都不少（防误删）',
      knownViews.every((id) => !!document.getElementById(id)),
      knownViews.filter((id) => !document.getElementById(id)).join(','));
    // 学习档案曾被误嵌进「我的课程」（少一个 </section>），切到档案页会被父容器隐藏
    const memory = document.getElementById('view-memory');
    const courses = document.getElementById('view-courses');
    t('学习档案不是「我的课程」的子节点', !(courses && courses.contains(memory)));
    t('学习档案是 <main> 的直接子节点', memory && memory.parentElement && memory.parentElement.tagName === 'MAIN');
  }

  console.log('=== 5. 导航与伪链接（CSP 兼容） ===');
  {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    t('无 javascript: 伪链接（CSP script-src 无 unsafe-inline 会把它们当内联脚本拦掉）', !/href="javascript:/i.test(html));
    t('存在统一的伪链接拦截守卫', /a\[href="#"\], a\[href\^="javascript:"\]/.test(app));
    // 点击导航链接：视图切换、且不被拦截守卫破坏
    document.getElementById('view-memory').classList.remove('active');
    document.getElementById('view-home').classList.add('active');
    const navLink = document.querySelector('a[data-nav="memory"]');
    navLink.click();
    t('点击导航链接后切到学习档案视图', document.getElementById('view-memory').classList.contains('active'));
  }

  console.log('=== 6. 无障碍与动效基线（报告 P1 项） ===');
  {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    t('CSS 有 prefers-reduced-motion 兜底（K12 合规）', /prefers-reduced-motion\s*:\s*reduce/.test(css));
    t('CSS 有全局 :focus-visible 焦点可见', /:focus-visible\s*\{[^}]*outline/.test(css));
    t('toast 容器带 role=status + aria-live', /id="toast-wrap"[^>]*role="status"/.test(html) && /id="toast-wrap"[^>]*aria-live/.test(html));
    t('元认知开关有 role=switch + aria-checked + aria-label', /id="guide-meta"[^>]*role="switch"/.test(html) && /aria-checked=/.test(html) && /aria-label=/.test(html));
    t('课时标签 .tag.orange 用深橙提高对比度', /\.tag\.orange\s*\{[^}]*#C2410C/.test(css));
  }

  console.log('=== 7. 密钥与凭据安全：私钥绝不能进前端 ===');
  {
    // 纯静态单页应用里，任何私密密钥都会对访问者完全可见（F12 / 网络请求）。
    // 前端只允许出现"公开型"凭据（wbpk_ publishableKey），绝不允许出现私密密钥。
    const srcs = ['index.html', 'js/app.js', 'css/style.css']
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    t('无 sk- 私密密钥（DeepSeek/OpenAI 等 secret key 格式）', !/sk-[A-Za-z0-9]{16,}/.test(srcs));
    t('无 Bearer 令牌', !/Bearer\s+[A-Za-z0-9]/.test(srcs));
    t('无 api_key / secret 硬编码', !/(api[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"]{12,}/i.test(srcs));
    // 唯一出现的凭据是公开的 publishableKey（wbpk_ 前缀，本身无权限，服务端校验 Origin）
    const keys = (srcs.match(/wbpk_[A-Za-z0-9_-]{16,}/g) || []);
    t('唯一凭据是公开型 publishableKey（wbpk_ 前缀）', keys.length >= 1 && keys.every((k) => k.startsWith('wbpk_')));
  }

  /* ===== 依赖自托管（消除 CDN 单点） =====
     背景：原来云 SDK 从 cdn.jsdelivr.net 的 @dev 浮动标签加载 ——
     ① jsdelivr 国内经常连不上（实测 ConnectTimeout）；SDK 挂了整站 AI 全灭；
     ② @dev 会随上游漂移，上游发破坏性变更时站点不部署也会坏。
     现在本地 vendor/ 优先、CDN 回退且锁死版本。 */
  console.log('\n=== N. 依赖自托管（消除 CDN 单点） ===');
  const htmlSrc = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const jsSrcN = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  // 只取真实的 <script> 标签，别扫全文 —— 注释里提到这些字符串会误伤（已踩过）
  const scriptTags = htmlSrc.match(/<script[^>]*>/g) || [];
  const inlineScripts = scriptTags.filter((s) => !/\bsrc=/.test(s));
  const srcOf = (tags, needle) => tags.findIndex((s) => s.indexOf(needle) >= 0);
  t('N1 不再直接用 @dev 浮动标签（标签与代码里都不得出现）',
    !/@tencent-ai\/workbuddy-cloud-sdk@dev/.test(htmlSrc) &&
    !/workbuddy-cloud-sdk@dev\//.test(jsSrcN));
  t('N2 首屏依赖走本地 vendor 副本（pptxgen 已改为按需，见 N9/N10）',
    /src="vendor\/workbuddy-cloud-sdk\.global\.js"/.test(htmlSrc) &&
    ['workbuddy-cloud-sdk.global.js', 'pptxgen.bundle.js'].every((f) => fs.existsSync(path.join(dir, 'vendor', f))));
  t('N3 依赖兜底由外部文件实现（不能是内联脚本）', (() => {
    // ★ 实测教训：本页 CSP 没有 'unsafe-inline'，内联 <script> 会被静默拦掉，
    //   兜底等于没写。必须放在 app.js 里按需注入。
    return inlineScripts.length === 0 && /function ensureVendors\(/.test(jsSrcN) && /VENDOR_FALLBACK/.test(jsSrcN);
  })(), '内联 script 数=' + inlineScripts.length);
  t('N3b init 不被第三方库阻塞（缺失时异步补，不 then(init)）',
    /ensureVendors\(\)\.then\(\(\) => \{/.test(jsSrcN) && !/ensureVendors\(\)\.then\(init\)/.test(jsSrcN));
  t('N3c CSP 未被放宽（script-src 仍无 unsafe-inline）', (() => {
    const m = htmlSrc.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    if (!m) return false;
    const scriptSrc = (m[1].match(/script-src ([^;]+)/) || [])[1] || '';
    return scriptSrc.indexOf("'self'") >= 0 && scriptSrc.indexOf('unsafe-inline') < 0;
  })());
  t('N3d 兜底有超时，不会卡死启动', /setTimeout\(\(\) => resolve\(true\), 8000\)/.test(jsSrcN));
  t('N4 兜底地址锁定具体版本（不用浮动标签）', /workbuddy-cloud-sdk@0\.1\.2-dev\./.test(jsSrcN));
  t('N5 vendor 文件真实存在且非空',
    ['workbuddy-cloud-sdk.global.js', 'pptxgen.bundle.js'].every((f) => {
      const p = path.join(dir, 'vendor', f);
      return fs.existsSync(p) && fs.statSync(p).size > 10000;
    }));
  t('N6 版本号写进注释便于复现', /本地副本版本：workbuddy-cloud-sdk 0\.1\.2-dev\./.test(htmlSrc));
  t('N7 CSP 仍允许本地脚本（未因自托管改坏）', /script-src 'self'/.test(htmlSrc));
  t('N8 脚本顺序：依赖先于 app.js', (() => {
    const iVendor = srcOf(scriptTags, 'vendor/workbuddy-cloud-sdk.global.js');
    const iApp = srcOf(scriptTags, 'js/app.js');
    return iVendor >= 0 && iApp >= 0 && iVendor < iApp;
  })(), '排序=' + scriptTags.map((s) => (s.match(/src="([^"]+)"/) || [])[1] || '(inline)').join(' , '));
  t('N9 pptxgen 不在首屏同步加载（466KB 只为导出服务，服务器不压缩）',
    !/src="vendor\/pptxgen\.bundle\.js"/.test(htmlSrc));
  t('N10 pptxgen 改成按需加载且本地优先、CDN 兜底', (() => {
    const j = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    return /\['PptxGenJS', 'vendor\/pptxgen\.bundle\.js'\]/.test(j) &&
      /\['PptxGenJS', 'https:\/\/cdn\.jsdelivr\.net\/npm\/pptxgenjs@3\.12\.0/.test(j);
  })());
  t('N11 导出前会先把组件取回来（第一次点也能成功）',
    /async function exportPPTX\(course, btn\)/.test(fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8')) &&
    /await ensureVendors\('PptxGenJS'\);/.test(fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8')));
  t('N12 取组件期间有提示（不让用户以为没反应）',
    /正在准备导出组件（首次约需几秒）/.test(fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8')));
  t('N13 ensureVendors 默认只保启动必备（否则按需的库又被拉回首屏）', (() => {
    const j = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    return /const VENDOR_REQUIRED = \['WorkBuddyCloud'\]/.test(j) &&
      /if \(want\.indexOf\(g\) < 0\) return;/.test(j) &&
      /await ensureVendors\('PptxGenJS'\)/.test(j);
  })());
  t('N14 数字人视频不在启动时创建（4.6MB，服务器又不支持 Range，实测整个被拉下来）', (() => {
    const j = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    const i = j.indexOf('function initAvatarVideo');
    const block = j.slice(i, i + 900);
    return /if \(avatarStyle\(\) !== 'photo'\) return;/.test(block) && /v\.preload = 'none'/.test(block);
  })());
  t('N15 切到真人形象时才加载视频', (() => {
    const j = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    const i = j.indexOf('function applyAvatarStyle');
    return j.slice(i, i + 700).indexOf('initAvatarVideo()') >= 0;
  })());
  t('N16 视频探测用 HEAD 优先（服务器不支持 Range，用 video 探测会拉整个 4.6MB）', (() => {
    const j = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
    const i = j.indexOf('function probeVideo(src)');
    const block = j.slice(i, i + 700);
    return /method: 'HEAD'/.test(block) && /probeVideoByElement/.test(block);
  })());
  t('N17 backdrop-filter 全部带 -webkit- 前缀（iOS 到 Safari 17 都需要）', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    // 统计：每一处无前缀声明都应有一份带前缀的兄弟声明
    const plain = (css.match(/(?<!-webkit-)backdrop-filter\s*:/g) || []).length;
    const pref = (css.match(/-webkit-backdrop-filter\s*:/g) || []).length;
    return plain > 0 && pref >= plain;
  })());
  t('N18 aspect-ratio 有老 Safari 兜底（否则课件高度为 0 = 看不见）', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    const i = css.indexOf('@supports not (aspect-ratio: 16 / 9)');
    return i >= 0 && /\.sl/.test(css.slice(i, i + 400));
  })());
  t('N19 @supports 兜底里的选择器都真实存在（别写死规则）', (() => {
    const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
    const start = css.indexOf('@supports not (aspect-ratio: 16 / 9)');
    if (start < 0) return false;
    // 必须做括号配对 —— 用第一个 '}' 会把块截断（里面还有嵌套规则），我第一版就栽在这
    let depth = 0, end = -1;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return false;
    const block = css.slice(start, end + 1);
    const rest = css.slice(0, start) + css.slice(end + 1);
    // 先剥掉注释再提取类名 —— 注释里会提到反例类名（.rp-stage），会误伤（已踩过）
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
    const names = (stripComments(block).match(/\.([a-z][\w-]*)/g) || []).map((s) => s.slice(1));
    return names.length > 0 && names.every((n) => new RegExp('\\.' + n + '[\\s,{:.]').test(stripComments(rest)));
  })());

  console.log('\nREVIEW_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
}, 400);
