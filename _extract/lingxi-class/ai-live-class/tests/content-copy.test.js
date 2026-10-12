/* tests/content-copy.test.js —— 面向用户的文案守卫（R22）

   ===== 为什么需要它 =====
   2026-10-12 的上线前体检（视觉/安全/法律/内容/设计 六维）在**内容**这一维
   抓到一批"顺利路径上不报错、但用户直接看得见"的缺陷。它们有一个共同点：
   都是**文案层**的问题，源码照跑、测试全绿，只有真的把页面拿给人看才会发现。

   已修的两类（本文件把它们钉成断言，防止回归）：

   ① 裸 markdown `**`
      语音自检失败、AI 出题结果这两个时刻最伤信任，而那里的诊断文案写着
      `**这台设备一个语音都没有**`。这些字符串分别走 `textContent`（toast /
      诊断面板）与 `esc()` 后进 `innerHTML`（真题练习页脚），**都不解析 markdown**
      —— `**` 会原样显示给用户。
      注意：**prompt 里的 `**` 是合法的**（发给模型，markdown 强调有效），
      所以判据不是"源码里没有 **"，而是"用户可见的渲染路径上没有 **"。

   ② 首屏「覆盖科目」写死数字
      index.html 原本写死 `22+`，而 SUBJECTS 实际已经 29 个 —— 静态数字会随
      增删科目**静默失真**。现在由 syncHeroSubjectCount() 从 SUBJECTS.length 取，
      HTML 里的 `29+` 只是 JS 尚未执行时的兜底。

   另有三条"法律表述必须与实际实现一致"的断言：
      · 用户协议不得宣称做了"真实身份验证"（实际只做验证码控制权核验 + 设备指纹）
      · 不得宣称"响应最快"这类无法证成的绝对化用语（广告法风险）
      · 全部关闭按钮都要有 aria-label（读屏用户只听到"按钮"）
      · 社交分享卡片（og:*）必须齐全，否则分享出去只有一串裸 URL
*/
const path = require('path');
const fs = require('fs');

const dir = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (m, c, extra) => {
  if (c) { pass++; console.log('PASS ' + m); }
  else { fail++; console.log('FAIL ' + m + (extra ? '  → ' + extra : '')); }
};

/* ---------- R22-a. 用户可见渲染路径上的裸 markdown ** ---------- */
console.log('\n=== R22-a. 用户可见路径不得出现裸 markdown ** ===');

/* ① toast() 一律 textContent —— 调用点文案里不许有 ** */
const toastCalls = [...appSrc.matchAll(/toast\(\s*(['"`])((?:[^'"`\\]|\\.)*?)\1/g)]
  .map((m) => m[2]);
t('toast() 调用点文案无裸 **', toastCalls.every((s) => !s.includes('**')),
  toastCalls.filter((s) => s.includes('**')).join(' | '));

/* ② 语音自检：head / todo / tips 三个字符串池都走 textContent（见 runTtsCheck 渲染处） */
const ttsPools = [];
for (const key of ['head = ', 'silent: ', 'noApi: ', 'noVoices: ', 'noZh: ', 'rejected: ']) {
  const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(['\"`])((?:[^'\"`\\\\]|\\\\.)*?)\\1", 'g');
  for (const m of appSrc.matchAll(re)) ttsPools.push(m[2]);
}
t('语音自检文案池（head/todo/tips）无裸 **', ttsPools.length > 0 && ttsPools.every((s) => !s.includes('**')),
  '取样 ' + ttsPools.length + ' 条；含 ** 的：' + ttsPools.filter((s) => s.includes('**')).join(' | '));

/* ③ esc() 后进 innerHTML 的 pp-foot（真题/自有材料出题页脚）—— 这里要的是 <b> 不是 ** */
const foots = [...appSrc.matchAll(/class="pp-foot"[^>]*>([\s\S]{0,400}?)<\/p>/g)].map((m) => m[1]);
t('pp-foot 页脚存在且不含裸 **', foots.length >= 2 && foots.every((s) => !s.includes('**')),
  '命中 ' + foots.length + ' 处；含 ** 的：' + foots.filter((s) => s.includes('**')).join(' | '));
t('pp-foot 用 <b> 承担强调（不是丢掉强调）', foots.some((s) => /<b>[^<]+<\/b>/.test(s)));

/* ④ 反向证明：prompt 里的 ** 必须保留（改了会让模型收不到强调） */
t('出题提示词仍保留 markdown 强调（**不能复制任何真题**）',
  /你\*\*不能复制任何真题\*\*/.test(appSrc));

/* ---------- R22-b. 首屏「覆盖科目」与 SUBJECTS 同步 ---------- */
console.log('\n=== R22-b. 覆盖科目数不得写死失真 ===');
t('index.html 有 hero-subject-count 挂点', /id="hero-subject-count"/.test(html));
t('syncHeroSubjectCount() 存在且从 SUBJECTS.length 取值',
  /function syncHeroSubjectCount\(\)[\s\S]{0,400}?SUBJECTS\.length/.test(appSrc));
t('syncHeroSubjectCount 已挂进 init() 的 safeInit',
  /safeInit\('syncHeroSubjectCount',\s*syncHeroSubjectCount\)/.test(appSrc));
/* 兜底值也必须是对的：JS 没跑起来时用户看到的就是它 */
const mFallback = html.match(/id="hero-subject-count">(\d+)\+</);
const sysSrc = appSrc.slice(appSrc.indexOf('const SYSTEMS'), appSrc.indexOf('const SUBJECTS'))
  .replace(/^const SYSTEMS\s*=/, 'module.exports =');
fs.writeFileSync(path.join(dir, '.wb-content-sys.cjs'), sysSrc);
let realCount = 0;
try {
  const SYSTEMS = require(path.join(dir, '.wb-content-sys.cjs'));
  realCount = SYSTEMS.flatMap((s) => s.subjects).length;
} finally {
  try { fs.unlinkSync(path.join(dir, '.wb-content-sys.cjs')); } catch (_) {}
}
t('HTML 兜底值与真实科目数一致（' + realCount + '）', !!mFallback && Number(mFallback[1]) === realCount,
  mFallback ? '写的是 ' + mFallback[1] + '+' : '没取到');

/* ---------- R22-c. 法律表述与实际实现一致 ---------- */
console.log('\n=== R22-c. 不得宣称没有做到的事 ===');
t('用户协议不再宣称"真实身份验证"', !/真实身份验证/.test(appSrc));
t('用户协议如实说明只核验控制权', /拥有控制权/.test(appSrc) && /不等同于线下的实名身份核验/.test(appSrc));
t('隐私政策手机号措辞从"确为你本人所有"改为"控制权"', !/核验该号码确为你本人所有/.test(appSrc));
t('不再宣称"响应最快"（广告法绝对化用语）', !/响应最快/.test(appSrc) && !/响应最快/.test(html));
t('课程类型文案不再写"提分"', !/desc: '[^']*提分/.test(appSrc));
t('隐私政策仍明示 AI 生成属性（《生成式人工智能服务管理暂行办法》）',
  /AI 生成的内容会向你明示其 AI 生成属性/.test(appSrc));
t('页脚仍有"内容由 AI 生成"标识', /内容由 AI 生成/.test(html));

/* ---------- R22-d. 可达性：关闭按钮必须报名 ---------- */
console.log('\n=== R22-d. 图标按钮的 aria-label ===');
const closeBtns = [...html.matchAll(/<button[^>]*class="[^"]*(?:modal-close|mb-close)[^"]*"[^>]*>/g)].map((m) => m[0]);
t('找到全部关闭按钮（≥11）', closeBtns.length >= 11, '实际 ' + closeBtns.length);
const noLabel = closeBtns.filter((b) => !/aria-label=/.test(b));
t('每个关闭按钮都有 aria-label', noLabel.length === 0, noLabel.join('\n  '));
t('mb-close（大纲抽屉）也报名', /id="mb-close"[^>]*aria-label=/.test(html));

/* ---------- R22-e. 社交分享卡片 ---------- */
console.log('\n=== R22-e. og / twitter 卡片 ===');
for (const k of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:image', 'og:url']) {
  t('meta ' + k + ' 存在', new RegExp('property="' + k.replace(':', '\\:') + '"').test(html));
}
t('twitter:card 存在', /name="twitter:card"/.test(html));
/* og:image 必须是绝对 URL，且指向线上真实存在的文件（不能是相对路径） */
const ogImg = (html.match(/property="og:image" content="([^"]+)"/) || [])[1] || '';
t('og:image 是绝对 URL', /^https?:\/\//.test(ogImg), ogImg);
t('og:image 指向本站 origin（同源才稳）', ogImg.indexOf('bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host') >= 0, ogImg);
t('og:image 文件名与线上 assets 一致', /\/assets\/teacher-avatar\.jpg$/.test(ogImg), ogImg);

/* ---------- R22-f. 中英文混排间距 ---------- */
console.log('\n=== R22-f. 中英文紧贴 ===');
const cjkLatin = [];
html.split('\n').forEach((l, i) => {
  if (l.trim().startsWith('<!--')) return;
  const txt = l.replace(/<[^>]*>/g, '');
  const re = /[\u4e00-\u9fa5][A-Za-z]|[A-Za-z][\u4e00-\u9fa5]/g;
  let m;
  while ((m = re.exec(txt))) cjkLatin.push('L' + (i + 1) + ': ' + txt.slice(Math.max(0, m.index - 12), m.index + 14).trim());
});
/* 已知无害：hero 统计里 <b>24h</b><span>随时开课</span> 分两行显示，不是紧贴 */
const realCjkLatin = cjkLatin.filter((s) => !/24h/.test(s));
t('正文无中英文紧贴（已知无害的 24h 统计除外）', realCjkLatin.length === 0, realCjkLatin.join(' | '));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`_RESULT pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
