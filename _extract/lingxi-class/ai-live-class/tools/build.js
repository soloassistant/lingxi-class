#!/usr/bin/env node
/* tools/build.js —— 生成发布用的压缩产物

   ===== 为什么会有这个文件（先回答"它为什么会存在"）=====
   线上是**静态托管**：服务器不做 gzip/br，响应头里连 Cache-Control 都没有
   （已用 `Accept-Encoding: gzip` 显式请求验证；测试iap<ticket stub>暂无变更。
     判据与完整讨论见 .workbuddy/memory/MEMORY.md「线上托管形态」一节）。
   也就是说：**浏览器收到的字节数 = 文件本身的字节数**，一个字节都省不掉。

   首屏四件合计 958,943 B（≈937 KB），其中 js/app.js 独占 683,238 B ——
   它是**从未压缩过的源码**（12,966 行 / 平均行长 39 / 约 1000 行注释）。
   既然拿不到传输层压缩，就只能在行这一层压：
       app.js   683,238 → 380,004 B（−44.4%）
       style.css 144,537 → 99,644 B（−31.1%）
   首屏 937 KB → 597 KB。这是静态托管下唯一自主可控的优化。

   ===== 为什么是"双文件"而不是就地压 =====
   app.js 末尾有 `Object.assign(window, { ... })`，用**简写属性**导出约 200 个 API
   （persistCourses, loadCourses, guardSummaryEvidence……）。一旦顶层名被改写，
   简写属性的**键**也跟着变，对外 API 会整片断掉 —— 所有行为测试会全红。
   所以：顶层名**必须保留**（terser `mangle.toplevel: false`）。

   同时 tests/production.test.js 里有 20 处对**源码文本**的断言
   （`async function exportPPTX(course, btn)`、`const VENDOR_REQUIRED = ['WorkBuddyCloud']`、
   `indexOf('function initAvatarVideo')`……）。这些断言是有价值的回归守卫，
   不能为了压缩把它们删掉或改写成匹配压缩后的样子（那等于在测一串无意义的字符）。

   ⇒ 结论：**js/app.js / css/style.css 保持源码不动**（测试读它们），
       另生成 js/app.min.js / css/style.min.css，由 index.html 引用。
       为此新增的安全带详见下方 pitfalls。

   ===== 这个方案自带的坑（必须靠 tests/build-freshness.test.js 兜住）=====
   ★ 最大的坑：改了源码却忘了 npm run build —— 发布出去的还是旧逻辑，
     而且**不会有任何报错**，用户静默拿到旧行为。
     所以产物旁边会写 tools/build-stamp.json（记录源码 sha256），
     tests/build-freshness.test.js 每次都比对，不一致就让 npm test 失败。

   ===== 用法 =====
     npm run build          重新生成产物
     node tools/build.js --check   只核对产物是否最新（不写文件）
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minify } = require('terser');
const CleanCSS = require('clean-css');

const ROOT = path.join(__dirname, '..');
const JOBS = [
  {
    kind: 'js', src: 'js/app.js', out: 'js/app.min.js', keepTopLevel: true, /* 顶层导出靠简写属性 */
  },
  {
    kind: 'css', src: 'css/style.css', out: 'css/style.min.css',
  },
];
const STAMP = 'tools/build-stamp.json';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const pct = (a, b) => (100 - (b / a) * 100).toFixed(1);

/* terser 配置详解
   · mangle.toplevel = false —— **最关键的一行**。
     顶层函数/变量名必须原样保留，否则 `Object.assign(window, {...})`
     的简写属性键会被改掉，对外 API 全断。（实测开启 toplevel 只多省 4.6%，
     却会让 200 个导出名全部消失 —— 这点收益完全不值得。）
   · compress defaults —— 压缩常量折叠、死代码、局部合并。
     passes: 2 比 1 多约 0.3%，比 3 慢一倍且几乎没差，取 2。
   · format.quote_style = 3 —— 保留原始引号风格，缩小与源码的观感差异，
     也避免 `'HEAD'` 被改写成 `"HEAD"` 踩到别人写死的字面量断言。
   · format.preamble —— 在产物头部打标记，防止有人手工编辑产物。
     用 minify 而不是uglify-js：minify 自带 parser/compress/mangle，
     且对顶层名保留的控制更直观。 */
const TERSER_OPTS = {
  compress: { defaults: true, passes: 2 },
  mangle: { toplevel: false },
  format: {
    comments: false,
    quote_style: 3,
    preamble: '/* 生成产物，勿手工修改：源文件是 js/app.js，重跑 npm run build */',
  },
};

/* clean-css level 1 而不是 2
   level 2 会多做跨规则重构（合并相邻规则、删重复声明），收益只有 0.3%
   （实测 99,644 → 99,167 B），但会重排 CSSOM 结构、改动 (4) 声明合并后的
   层叠顺序风险。level 1 只做"去空白 / 去尾分号 / 字号规整"这一层，
   对本站的收益已经拿满 31%，没必要为 477 B 引入重构风险。
   ⚠️ level 1 仍会把 #C2410C 规整成小写 #c2410c —— 纯等价改写，
      但 production.test.js 里那条深橙对比度断言是从**源码**读的，不受影响。 */
const CLEANCSS_OPTS = { level: 1 };

async function buildJob(job, quiet) {
  const srcPath = path.join(ROOT, job.src);
  const srcText = fs.readFileSync(srcPath, 'utf8');
  const srcBuf = fs.readFileSync(srcPath);
  const entry = { bytes: srcBuf.length, sha256: sha256(srcBuf) };

  let outText;
  if (job.kind === 'js') {
    const r = await minify(srcText, TERSER_OPTS);
    if (r.error) throw new Error(`${job.src} 压缩失败：${r.error}`);
    outText = r.code;
  } else {
    const out = new CleanCSS(CLEANCSS_OPTS).minify(srcText);
    if (out.errors && out.errors.length) throw new Error(`${job.src} 压缩失败：${out.errors.join('; ')}`);
    if (out.warnings && out.warnings.length && !quiet) {
      out.warnings.forEach((w) => console.log(`      ⚠ ${w}`));
    }
    outText = out.styles + '\n';
  }

  const outBuf = Buffer.from(outText, 'utf8');
  if (!quiet) {
    console.log(`  ${job.src.padEnd(14)} ${String(entry.bytes).padStart(7)} B  →  ` +
      `${job.out.padEnd(18)} ${String(outBuf.length).padStart(7)} B   −${pct(entry.bytes, outBuf.length)}%`);
  }
  return { job, srcText, outText, srcMeta: entry, outMeta: { bytes: outBuf.length, sha256: sha256(outBuf) } };
}

/* 顶层 API 是否还在 —— 每次构建都自检一遍。
   这是"压没压坏"的第一道也是唯一在线的一道闸门：
   只要导出名丢了，线上那些按钮会静默失效（连报错都没有）。 */
const API_MUST_KEEP = [
  'function ensureVendors', 'function initAvatarVideo', 'function applyAvatarStyle',
  'function probeVideo', 'function hideSplash', 'async function exportPPTX',
  'function guardSummaryEvidence', 'function slideHTML', 'function rateLabel',
  'function enforceLoginGate', 'function persistCourses', 'function streamChat',
];

function selfCheck(results) {
  const js = results.find((r) => r.job.kind === 'js');
  if (!js) return [];
  const missing = API_MUST_KEEP.filter((n) => js.outText.indexOf(n) < 0);
  return missing;
}

/* ── SEO 文件：sitemap.xml + robots.txt ────────────────────────────────
   ★ 为什么由**构建生成**而不是手写：origin 一旦有两处真相（配置文件 + 这两个文件），
     改一处忘一处就会产出指向**死域名**的 sitemap，而且**不会有任何报错**。
     域名在 2026-09-28 的事故里确实变过一次，所以这里让
     tools/indexnow.config.json 成为 origin 的**唯一来源**。
   ★ 故意不写 <lastmod>：它会让产物随"今天几号"变化 ⇒ 破坏构建确定性，
     而确定性正是"用 sha 反查线上是不是当前源码"的前提。
     Google 忽略 changefreq/priority；Bing 可能参考，保留无妨。
   ★ 配置缺失时**跳过**而不是报错：SEO 是好东西，但不该拦住发布。 */
const SEO_CONFIG = path.join(__dirname, 'indexnow.config.json');

function seoContents() {
  if (!fs.existsSync(SEO_CONFIG)) return null;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(SEO_CONFIG, 'utf8')); } catch (_) { return null; }
  if (!cfg.origin || !Array.isArray(cfg.urls) || !cfg.urls.length) return null;

  const locs = cfg.urls.map((u) =>
    '  <url>\n' +
    `    <loc>${String(u).replace(/&/g, '&amp;')}</loc>\n` +
    '    <changefreq>weekly</changefreq>\n' +
    '    <priority>1.0</priority>\n' +
    '  </url>').join('\n');
  const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    locs + '\n</urlset>\n';

  const robots = [
    '# 灵犀课堂 · AI 一对一直播课',
    '# 单页应用：所有视图都在 / 之下（hash 路由不产生独立 URL）。',
    '# 本站没有需要屏蔽的路径 —— 发布护栏保证开发文件（tests/ tools/ sql/ _quality/）不会上线。',
    '# ⚠ 切勿 Disallow 根目录的 {key}.txt：那是 IndexNow 的所有权校验文件，',
    '#   一旦被屏蔽，IndexNow 的所有权验证会失败并回 403。',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    'Sitemap: ' + cfg.origin + '/sitemap.xml',
    '',
  ].join('\n');

  return { 'sitemap.xml': sitemap, 'robots.txt': robots };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  console.log(checkOnly ? '=== 核对压缩产物是否最新 ===' : '=== 生成压缩产物 ===');

  const stampPath = path.join(ROOT, STAMP);
  const old = fs.existsSync(stampPath) ? JSON.parse(fs.readFileSync(stampPath, 'utf8')) : null;
  const results = [];
  for (const job of JOBS) results.push(await buildJob(job, false));

  const seo = seoContents();
  if (seo) {
    for (const [name, text] of Object.entries(seo)) {
      console.log('  构建生成     ' + name.padEnd(18) + String(bytes(text)).padStart(7) + ' B');
    }
  } else {
    console.log('  · 未找到 tools/indexnow.config.json ⇒ 跳过 sitemap / robots 生成');
  }

  const missingApi = selfCheck(results);
  if (missingApi.length) {
    console.error('\n✗ 压缩把顶层 API 名改掉了，这会断掉 Object.assign(window, {...}) 的导出：');
    missingApi.forEach((n) => console.error('    ' + n));
    console.error('  请检查 TERSER_OPTS.mangle.toplevel 是否被改成了 true。');
    process.exit(1);
  }
  console.log(`  ✓ 顶层 API 名全部保留（自检 ${API_MUST_KEEP.length} 个）`);

  const totalSrc = results.reduce((s, r) => s + r.srcMeta.bytes, 0);
  const totalOut = results.reduce((s, r) => s + r.outMeta.bytes, 0);

  const stamp = {
    schema: 1,
    builtAt: new Date().toISOString(),
    note: '源码改动后必须重跑 npm run build；本文件被 tests/build-freshness.test.js 校验',
    sources: Object.fromEntries(results.map((r) => [r.job.src, r.srcMeta])),
    outputs: Object.fromEntries(results.map((r) => [r.job.out, r.outMeta])),
    /* 构建生成的 SEO 文件（没有独立"源文件"，其内容由 indexnow.config.json 决定） */
    generated: seo ? Object.fromEntries(Object.entries(seo).map(([n, tx]) =>
      [n, { bytes: bytes(tx), sha256: sha256(Buffer.from(tx, 'utf8')) }])) : null,
    toolVersions: {
      terser: require('terser/package.json').version,
      'clean-css': require('clean-css/package.json').version,
    },
  };

  if (checkOnly) {
    let bad = 0;
    for (const r of results) {
      const so = old && old.sources && old.sources[r.job.src];
      const oo = old && old.outputs && old.outputs[r.job.out];
      const srcOk = so && so.sha256 === r.srcMeta.sha256;
      const outExists = fs.existsSync(path.join(ROOT, r.job.out));
      const outOk = oo && outExists && oo.sha256 === sha256(fs.readFileSync(path.join(ROOT, r.job.out)));
      console.log(`  ${srcOk ? '✓' : '✗'} 源码 ${r.job.src}${srcOk ? ' 未变' : ' 已改动'}` +
        `   ${outOk ? '✓' : '✗'} 产物 ${r.job.out}${outOk ? ' 已是最新' : ' 已过时，请重跑 npm run build'}`);
      if (!srcOk || !outOk) bad++;
    }
    if (seo) {
      for (const [name, text] of Object.entries(seo)) {
        const p = path.join(ROOT, name);
        const rec = old && old.generated && old.generated[name];
        const ok = !!rec && fs.existsSync(p) && rec.sha256 === sha256(fs.readFileSync(p));
        console.log(`  ${ok ? '✓' : '✗'} 生成物 ${name}` +
          `${ok ? ' 已是最新' : ' 已过时/缺失，请重跑 npm run build'}`);
        if (!ok) bad++;
      }
    }
    if (bad) { console.log('\n✗ 产物不是最新的'); process.exit(1); }
    console.log('\n✓ 产物与源码一致');
    return;
  }

  for (const r of results) fs.writeFileSync(path.join(ROOT, r.job.out), r.outText, 'utf8');
  if (seo) for (const [name, text] of Object.entries(seo)) fs.writeFileSync(path.join(ROOT, name), text, 'utf8');
  fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n', 'utf8');

  console.log(`\n  合计 ${totalSrc} B → ${totalOut} B  −${pct(totalSrc, totalOut)}%`);
  console.log(`  已写入 ${STAMP}`);
  console.log('\n✓ 完成。别忘了：git add "js/app.min.js" "css/style.min.css"');
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
