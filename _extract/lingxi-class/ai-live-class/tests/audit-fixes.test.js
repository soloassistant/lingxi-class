/* tests/audit-fixes.test.js —— 2026-10-14 审计修复守卫（R24）

   守住这一轮对「已下载源码审计」提出的 P0 / P1 / P2 修复：
   · P0-2  直播间「先看一段课堂演示（无需登录）」按钮 + 演示弹窗
   · P0-3  probeVideo 改 GET + Range:bytes=0-0，失败回落 <video> 兜底
   · P1-5  未勾选《用户协议》/《隐私政策》时，所有「创建/登录账号」主按钮置灰
   · P1-6  模型下拉过滤内部 / 内测模型（hy3-x、hy4-preview-x、*-v-turbo 等）
   · P1-7  文案口径：CTA「注册后免费体验第一节课」、科目数占位 29、短信口径统一
   · P2-8  超窄屏（≤380px）首屏数据条 2×2 排布
   · P2-9  og / twitter 卡片 + canonical + <noscript> 兜底

   判定标准：最后一行 _RESULT。静态守卫走源码 / HTML / CSS 文本比对（与
   content-copy.test.js 同一思路）；动态守卫真实加载 app.js 验证演示弹窗与同意置灰。
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dir = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');

let pass = 0, fail = 0;
const t = (m, c, extra) => {
  if (c) { pass++; console.log('PASS ' + m); }
  else { fail++; console.log('FAIL ' + m + (extra ? '  → ' + extra : '')); }
};

/* ---------- 静态守卫：源码 / HTML / CSS ---------- */
console.log('\n=== P0-2 演示按钮与弹窗结构 ===');
t('存在「先看演示」按钮 #btn-watch-demo', /id="btn-watch-demo"/.test(html));
t('存在演示弹窗 #demo-modal', /id="demo-modal"/.test(html));
t('演示视频指向本地 assets/teacher-demo.mp4', /id="demo-video"[^>]*src="assets\/teacher-demo\.mp4"/.test(html));
t('演示视频 preload=none（不抢首屏流量）', /id="demo-video"[^>]*preload="none"/.test(html));
t('bindDemoModal 在 init 中注册', /safeInit\('bindDemoModal', bindDemoModal\)/.test(appSrc));

console.log('\n=== P0-3 probeVideo 改 GET + Range 回落 ===');
t('probeVideo 不再用 HEAD', !/method:\s*'HEAD'/.test(appSrc));
t('probeVideo 改用 GET + Range:bytes=0-0', /function probeVideo\(src\)\s*\{[\s\S]*?method:\s*'GET'/.test(appSrc) && /Range:\s*'bytes=0-0'/.test(appSrc));
t('失败时回落 probeVideoByElement', /return probeVideoByElement\(src\)/.test(appSrc));

console.log('\n=== P1-5 同意未勾选时主按钮置灰 ===');
t('定义 AUTH_PRIMARY_BTNS', /AUTH_PRIMARY_BTNS\s*=/.test(appSrc));
t('syncAuthConsentButtons 在 openAuthModal 调用', /function openAuthModal\(\)\s*\{[\s\S]*?syncAuthConsentButtons\(\);/.test(appSrc));
t('syncAuthConsentButtons 在 bindAuthEvents 调用', /function bindAuthEvents\(\)\s*\{[\s\S]*?syncAuthConsentButtons\(\);/.test(appSrc));
t('勾选框 change 事件接 syncAuthConsentButtons', /addEventListener\('change',\s*syncAuthConsentButtons\)/.test(appSrc));

console.log('\n=== P1-6 模型下拉过滤内部 / 内测模型 ===');
t('定义 INTERNAL_MODEL 过滤正则', /INTERNAL_MODEL\s*=/.test(appSrc));
t('isChatModel 排除内部模型', /!INTERNAL_MODEL\.test\(m\.id\)/.test(appSrc));

console.log('\n=== P1-7 文案口径 ===');
t('CTA 改为「注册后免费体验第一节课」', /注册后免费体验第一节课/.test(html));
t('不再写「第一次上课免费体验」', !/第一次上课免费体验/.test(html));
t('科目数占位改为 29（与动态值一致，去除闪烁）', /id="subject-count">29</.test(html));
t('短信口径：登记手机号不发验证码', /这里登记手机号不会发送验证码/.test(html));
t('短信口径：与登录时的验证码区分', /与登录时的验证码是两回事/.test(html));

console.log('\n=== P2-8 超窄屏首屏 2×2 ===');
t('有 ≤380px 媒体查询', /@media\s*\(max-width:\s*380px\)/.test(css));
t('该断点下 .hero-stats 变 2 列网格', /max-width:\s*380px\)\s*\{[\s\S]*?\.hero-stats\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*1fr\)/.test(css));

console.log('\n=== P2-9 og / twitter / canonical / noscript ===');
for (const k of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:image', 'og:url']) {
  t('meta ' + k, new RegExp('property="' + k.replace(':', '\\:') + '"').test(html));
}
t('twitter:card 存在', /name="twitter:card"/.test(html));
t('canonical 指向本站 origin', /<link rel="canonical" href="https:\/\/bb6ae4d03fbd4b109cbbe6dbbc84502d\.app\.workbuddy\.host\/">/.test(html));
t('noscript 兜底提示存在', /<noscript>/.test(html));

/* ---------- 动态守卫：真实加载 app.js 验证行为 ---------- */
console.log('\n=== 动态：演示弹窗 / 同意置灰（真实执行） ===');
(async () => {
  const dom = new JSDOM(html, {
    url: 'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const W = dom.window;
  W.confirm = () => true; W.alert = () => {};
  W.WorkBuddyCloud = {
    createWorkBuddyCloud: () => ({
      llm: { models: { list: async () => [] }, chat: { completions: { create: () => ({}) } } },
      auth: {
        getSession: async () => ({ data: null, error: null }),
        getUser: async () => ({ data: null, error: null }),
        onAuthStateChange: () => () => {},
        signOut: async () => ({}),
      },
      database: { from: () => ({ select: () => ({ then: (r) => Promise.resolve({ data: [], error: null }).then(r) }) }) },
    }),
  };
  try { W.eval(appSrc); } catch (e) { /* init 的云相关分支可能抛错，safeInit 已隔离 */ }
  // 若 app 在 loading 阶段注册了 DOMContentLoaded，则补触发一次 init
  if (W.document.readyState !== 'complete') {
    try { W.document.dispatchEvent(new W.Event('DOMContentLoaded')); } catch (_) {}
  }
  await new Promise((r) => setTimeout(r, 250));

  // P0-2 演示弹窗
  const demoBtn = W.document.getElementById('btn-watch-demo');
  const demoModal = W.document.getElementById('demo-modal');
  t('演示按钮存在', !!demoBtn);
  if (demoBtn && demoModal) {
    demoBtn.dispatchEvent(new W.Event('click'));
    t('点击演示按钮后弹窗打开', demoModal.hidden === false);
    const close = W.document.getElementById('btn-demo-close');
    if (close) {
      close.dispatchEvent(new W.Event('click'));
      t('点击关闭后弹窗收起', demoModal.hidden === true);
    }
  } else {
    t('演示弹窗结构完整', false);
  }

  // P1-5 同意置灰（真实执行）
  const ph = W.document.getElementById('au-ph-send');
  t('存在获取验证码主按钮', !!ph);
    if (W.openAuthModal && ph) {
      W.openAuthModal();
      t('未勾选同意时主按钮被置灰', ph.disabled === true);
      const cbox = W.document.getElementById('au-consent');
      if (cbox) { cbox.checked = true; cbox.dispatchEvent(new W.Event('change')); }
      t('勾选同意后主按钮恢复可点', ph.disabled === false);
    } else {
    t('openAuthModal 可用', false);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  console.log(`_RESULT pass=${pass} fail=${fail}`);
  // jsdom 的定时器会让事件循环常驻，必须显式退出，否则挂起被外层超时杀掉
  process.exit(fail ? 1 : 0);
})();
