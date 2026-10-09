/* ============================================================
   顶部导航的**宽度预算**回归（2026-10-08）

   为什么专门为导航写一个测试文件
   ------------------------------------------------------------
   线上出现过这样的 bug：首页顶部 7 个导航标签全部被折成"每字一行"
   （首页 → 首/页），导航区还压出一个错位的白底框。
   在所有 ≥1024px 的宽度下都复现，包括 1920。

   根因不是某条样式写错，而是**宽度预算不够**：
     · .nav-inner 的可用内容宽被 `max-width: 1160px` 钉死在
       1160 − 24×2 = **1112px**（全局 * { box-sizing: border-box }），
       ——屏幕再宽也不会变宽；
     · 而桌面导航的自然需求实测 ≈ 1159px（品牌 187 + 导航项 474 + 右侧 407 + 间距），
       差 47px；
     · 更糟的是 .nav-links a / .brand-name / #btn-auth 都没设 white-space: nowrap，
       中文可以在任意字之间断行 ⇒ 差的那点宽度**不会变成"稍微挤一点"，
       而是变成"每个字占一行"**——一个很容易被当成"设计如此"的糊状表现。

   所以这个文件守三件事：
     A. **nowrap 守卫**：那几个绝不该折行的短文本必须带 nowrap。
        （这是"故障形态"的守卫：即使预算再次不够，表现也应是可见的溢出，
        而不是逐字竖排。）
     B. **容量预算**：用线性化模型算"自然需求 ≤ 可用宽"，留出安全余量。
        （这是"根因"的守卫：谁把间距/内边距加回去，这里就红。）
     C. **断点顺序**：桌面导航只允许出现在装得下的宽度上；
        窄屏按"先摘 CTA → 再摘品牌副标 → 再摘状态条 → 最后摘护眼"逐级让位。
   （F 段顺带守了 `.paper-code` 胶囊 —— 它犯的是同一个错：短标签没 nowrap，
   被压窄时在胶囊内部断行。）

   为什么不在这里起真浏览器
   ------------------------------------------------------------
   本目录的测试都是纯 Node（jsdom / 字符串），秒级、离线可跑。
   真·几何实测在 `.workbuddy/probe/nav-verify.mjs`（CDP 直驱 Chrome，
   每个宽度把 AI 状态强制成最长文案再量自然需求）。本文件里的常量
   就来自它的输出，改样式后请重跑它来更新 BASE。

   运行：
     NODE_PATH=... node tests/nav-layout.test.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* ---------- 解析 style.css ---------- */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 取某选择器**第一条**规则体（`sel { ... }`）。基础样式一定写在媒体查询之前，
    所以"第一条"就是基础值 —— 但这是隐含前提，故下面各断言都附带数值打印。 */
function ruleBody(sel) {
  const m = css.match(new RegExp(esc(sel) + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}
/** 取含指定属性、且选择器完全一致的那条规则体（用于同名选择器有多条规则） */
function ruleBodyWith(sel, needle) {
  const re = new RegExp(esc(sel) + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) if (m[1].indexOf(needle) >= 0) return m[1];
  return null;
}
function propNum(body, name) {
  if (!body) return null;
  const m = body.match(new RegExp('(?:^|;)\\s*' + esc(name) + '\\s*:\\s*([^;]+)'));
  if (!m) return null;
  const px = m[1].match(/(-?[\d.]+)px/);
  return px ? parseFloat(px[1]) : null;
}
/** `padding: 7px 8px` ⇒ 左右边距（两值时取第二个；一值时取它） */
function padX(body) {
  if (!body) return null;
  const m = body.match(/(?:^|;)\s*padding\s*:\s*([^;]+)/);
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).map((v) => { const p = v.match(/(-?[\d.]+)px/); return p ? parseFloat(p[1]) : null; });
  if (parts.some((v) => v === null)) return null;
  return parts.length === 1 ? parts[0] : parts[1];
}
/** 拆出所有 @media 块（含嵌套大括号的正确配对） */
function mediaBlocks() {
  const out = [];
  const re = /@media\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push({ cond: m[1].trim(), body: css.slice(re.lastIndex, i - 1) });
  }
  return out;
}
const MEDIA = mediaBlocks();
/** 某条件式媒体块里是否命中某片段 */
function mediaHas(cond, snippet) {
  const b = MEDIA.find((x) => x.cond.replace(/\s+/g, '') === cond.replace(/\s+/g, ''));
  return !!b && b.body.indexOf(snippet) >= 0;
}
function maxWidthOf(cond) {
  const m = cond.match(/max-width\s*:\s*(\d+)px/);
  return m ? Number(m[1]) : null;
}

console.log('=== A. nowrap 守卫：绝不该折行的短文本 ===');
/* 这 6 个都是"被压窄就会逐字竖排"的短标签。导航项、品牌名、品牌副标、
   AI 状态条、登录/注册、护眼、免费体验。 */
const NOWRAP = [
  ['.nav-links a', '导航标签（首页/生成课程/…）'],
  ['.brand-name', '品牌名「灵犀课堂」'],
  ['.brand-sub', '品牌副标「AI 一对一」'],
];
for (const [sel, label] of NOWRAP) {
  const body = ruleBody(sel);
  t(label + ' 有 white-space: nowrap', !!body && /white-space\s*:\s*nowrap/.test(body), body ? body.replace(/\s+/g, ' ').slice(0, 80) : '找不到规则 ' + sel);
}
{
  const body = ruleBodyWith('#ai-status, #btn-auth, #btn-theme, .btn-try', 'nowrap');
  const ok = !!body && /white-space\s*:\s*nowrap/.test(body);
  t('导航右侧按钮组 + #ai-status 有 white-space: nowrap', ok, ok ? '' : '规则里找不到 nowrap');
  /* 为什么必须打在按钮自身上：.btn 是 inline-flex，按钮里的文字会变成
     匿名 flex item，父级的 nowrap 不会替它挡折行。这条断言把"前提"钉住 ——
     哪天 .btn 改成别的 display，上面那条 nowrap 的写法就要重新审。 */
  t('  （前提：.btn 仍是 inline-flex ⇒ nowrap 必须写在按钮自己身上）',
    /display:\s*inline-flex/.test(ruleBody('.btn') || ''), ruleBody('.btn') || '找不到 .btn');
}

console.log('\n=== B. 桌面容量预算（1112px 内容盒）===');
/* 冻结基线：Chrome 实测的导航自然需求（.workbuddy/probe/nav-verify.mjs，AI 状态取最长文案） */
const BASE = {
  natural: 1081,   // px，实测（.nav-verify.mjs 在 1920/1600/1440/…/1201 九个宽度下的输出一致）
  gapInner: 8,     // .nav-inner { gap }
  gapLinks: 2,     // .nav-links { gap }
  padLinks: 8,     // .nav-links a 的左右内边距
  gapRight: 8,     // .nav-right { gap }
  gapBrand: 8,     // .brand { gap }
  padBtnNav: 10,   // 导航里三个按钮的左右内边距
};
/* 每个旋钮 +1px 对总宽的放大倍数（都是"几处用到"的直接计数） */
const COEF = {
  gapInner: 2,       // 品牌↔导航 ↔ 导航↔右侧
  gapLinks: 6,       // 7 个导航项之间 6 个缝
  padLinks: 14,      // 7 项 × 左右各一
  gapRight: 3,       // 右侧 4 个元素之间 3 个缝
  gapBrand: 2,       // 品牌内部 2 个缝
  padBtnNav: 6,      // 3 个按钮 × 左右各一
};
const CONTAINER_MAX = 1160;
const CONTAINER_PAD = 24;
const AVAIL = CONTAINER_MAX - CONTAINER_PAD * 2;   // 1112

const cur = {
  gapInner: propNum(ruleBody('.nav-inner'), 'gap'),
  gapLinks: propNum(ruleBody('.nav-links'), 'gap'),
  padLinks: padX(ruleBody('.nav-links a')),
  gapRight: propNum(ruleBody('.nav-right'), 'gap'),
  gapBrand: propNum(ruleBody('.brand'), 'gap'),
  padBtnNav: propNum(ruleBodyWith('#btn-auth, #btn-theme, .btn-try', 'padding-left'), 'padding-left'),
};
let model = BASE.natural;
const drift = [];
for (const k of Object.keys(COEF)) {
  if (cur[k] == null) { drift.push(k + '=解析失败'); continue; }
  model += COEF[k] * (cur[k] - BASE[k]);
  if (cur[k] !== BASE[k]) drift.push(k + ' ' + BASE[k] + '→' + cur[k]);
}
console.log('  （当前旋钮: ' + JSON.stringify(cur) + '）');
console.log('  （相对基线偏移: ' + (drift.length ? drift.join(', ') : '无') + '）');
console.log('  （模型算出自然需求 = ' + model + 'px，可用 = ' + AVAIL + 'px，余量 = ' + (AVAIL - model) + 'px）');

t('解析到全部 6 个宽度旋钮', Object.values(cur).every((v) => v !== null), JSON.stringify(cur));
t('自然需求 ≤ 可用宽', model <= AVAIL, model + ' > ' + AVAIL);
/* 余量 ≥ 24：留出跨平台字体差异（macOS PingFang 与 Windows 雅黑字宽不同）的缓冲。
   实测 Chrome/Windows 下余量 ~35px，所以 24 是"还能扛住一点字体差异"的下限。 */
t('余量 ≥ 24px（跨平台字体差异缓冲）', AVAIL - model >= 24, '余量只有 ' + (AVAIL - model) + 'px');

console.log('\n=== C. 断点顺序：桌面导航只出现在装得下的宽度 ===');
const burgerCond = MEDIA.find((x) => /\.nav-links\s*\{\s*display:\s*none/.test(x.body));
const burgerBp = burgerCond ? maxWidthOf(burgerCond.cond) : null;
console.log('  （导航切抽屉的断点 = ' + burgerBp + 'px）');
t('找到导航切抽屉的媒体查询', !!burgerCond && /\.nav-burger\s*\{\s*display:\s*flex/.test(burgerCond.body));
/* 因为 .nav-inner 被 max-width 钉在 1160，可用宽在 ≥1160 时恒为 1112；
   断点必须 ≥1160（再留 ~40 给 Windows 经典滚动条吃掉布局宽的那部分）。 */
t('导航断点 ≥ 1200px', burgerBp !== null && burgerBp >= 1200, String(burgerBp));
t('导航断点没有并进 1000px 版式断点（否则会连带改 1000~1160 的整页版式）',
  !mediaHas('max-width: 1000px', '.nav-links { display: none; }'));
/* 换成抽屉后 .nav-links 被 display:none，而它是唯一"撑满中间"的元素
   （flex:1）。没有 margin-left:auto 的话，右侧的护眼/登录/汉堡会紧贴品牌
   留在左边 —— 实测 768px 下右边空掉约 130px，和宽屏形态的右对齐也不一致。 */
t('抽屉形态下右侧控件仍靠右（.nav-right 有 margin-left: auto）',
  /margin-left\s*:\s*auto/.test(ruleBody('.nav-right') || ''), ruleBody('.nav-right') || '找不到规则');

/* 窄屏逐级让位：CTA → 品牌副标 → 状态条 → 护眼。
   顺序依据：越靠前越"可替代"，越靠后越"唯一入口"。
   注意 #btn-theme 的替代入口是抽屉里的 #btn-theme-m（功能完全相同）。 */
const LADDER = [
  ['.btn-try', '.btn-try { display: none; }', 820, '免费体验（首屏有同入口的 CTA）'],
  ['.brand-sub', '.brand-sub { display: none; }', 700, '品牌副标「AI 一对一」'],
  ['.ai-status', '.ai-status { display: none; }', 620, 'AI 状态条'],
  ['#btn-theme', '#btn-theme { display: none; }', 400, '护眼（抽屉 #btn-theme-m 同功能）'],
];
for (const [, snippet, expectBp, label] of LADDER) {
  const blk = MEDIA.find((x) => x.body.indexOf(snippet) >= 0);
  const bp = blk ? maxWidthOf(blk.cond) : null;
  t(label + ' 在 ' + expectBp + 'px 及以下隐藏', bp === expectBp, '实际断点 = ' + bp);
}
{
  const bps = LADDER.map(([, snippet]) => {
    const blk = MEDIA.find((x) => x.body.indexOf(snippet) >= 0);
    return blk ? maxWidthOf(blk.cond) : null;
  });
  const desc = bps.every((v, i) => i === 0 || v <= bps[i - 1]);
  t('让位顺序是单调的（越窄摘得越多）', desc, bps.join(' ≥ '));
}

console.log('\n=== D. 窄屏容量 ===');
/* 两段冻结基线（都来自实测）+ 一条真机差异：
   · 401~620px：ai-status / brand-sub / btn-try 已隐藏，护眼按钮还在 ⇒ 需求 302
   · ≤400px  ：再摘掉护眼 ⇒ 需求 255
   · ★ 触屏设备要多 6px：`@media (pointer: coarse)` 里 `#btn-burger { min-width: 44px }`，
     而探针（headless、非 coarse）量到的是 38px。真机比探针宽 6px，
     所以断言用 TOUCH_SLACK 把它算进去，别拿 headless 的数字当真机。
   padding 在 ≤620 收窄到 16px，所以可用 = vw − 32。 */
const MOBILE_PAD = 16;
const TOUCH_SLACK = 6;
const NEED_MID = 302 + TOUCH_SLACK;    // 401~620px
const NEED_NARROW = 255 + TOUCH_SLACK; // ≤400px
t('401px 视口（含触屏 6px 补偿）：需求 ' + NEED_MID + ' ≤ 可用 ' + (401 - MOBILE_PAD * 2),
  NEED_MID <= 401 - MOBILE_PAD * 2, NEED_MID + ' > ' + (401 - MOBILE_PAD * 2));
for (const vw of [360, 320]) {
  const avail = vw - MOBILE_PAD * 2;
  t(vw + 'px 视口（含触屏 6px 补偿）：需求 ' + NEED_NARROW + ' ≤ 可用 ' + avail, NEED_NARROW <= avail, NEED_NARROW + ' > ' + avail);
}
{
  /* ≤400px 摘掉 #btn-theme：320px 时它是最后一根稻草
     （实测摘掉前 302 > 288，溢出 14px；摘掉护眼 47px 后 255 ≤ 288，余量 33px）。 */
  const blk = MEDIA.find((x) => x.cond.replace(/\s+/g, '') === 'max-width:400px');
  t('≤400px 有额外的让位规则（否则 320px 会溢出）', !!blk && /#btn-theme\s*\{\s*display:\s*none/.test(blk.body));
}

console.log('\n=== E. 夹具新鲜度（文案/结构变了要重新实测）===');
const linksBlock = (html.match(/<nav class="nav-links">([\s\S]*?)<\/nav>/) || [])[1] || '';
const labels = [...linksBlock.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim());
console.log('  （当前导航项: ' + labels.join(' / ') + '）');
t('桌面导航仍是 7 项（模型的 padLinks×14 / gapLinks×6 系数依赖这个数量）',
  labels.length === 7, '实际 ' + labels.length + ' 项');
t('导航文案未变（变了要重跑 nav-verify.mjs 更新 BASE）',
  JSON.stringify(labels) === JSON.stringify(['首页', '生成课程', '直播课堂', '我的课程', '真题库', '我的题库', '学习档案']),
  labels.join('/'));
t('#ai-status 仍在导航里且是 button（容量模型含它）',
  /<div class="nav-right">[\s\S]*?id="ai-status"/.test(html));
t('最长 AI 文案仍是「AI 暂不可用 · 点此重试」（容量模型按它取最坏值）',
  /setAIStatus\('bad',\s*'AI 暂不可用 · 点此重试'/.test(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8')));

console.log('\n=== F. 同类问题：其它"不该折行"的短标签 ===');
/* .paper-code 是真题卡片上的"代号胶囊"（9709 / 教育部教育考试院…）。
   实测发现数据里有一条 subject='全国统考（政策与信息）' + code='教育部教育考试院'，
   两个都很长 ⇒ 文字在**胶囊内部**断行、背景被撑成两行高、圆角变形。
   它和导航折行是同一类缺陷（短标签缺 nowrap），所以放在同一个文件里一起守。
   判据同 A 段：nowrap 就在样式里。 */
{
  const body = ruleBody('.paper-code');
  t('.paper-code 有 white-space: nowrap（胶囊内部不许断行）',
    !!body && /white-space\s*:\s*nowrap/.test(body), body ? body.replace(/\s+/g, ' ').slice(0, 90) : '找不到规则');
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
