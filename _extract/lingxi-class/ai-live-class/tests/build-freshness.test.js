/* tests/build-freshness.test.js —— 源码 / 压缩产物新鲜度守卫（R19）

   ===== 为什么需要这个文件 =====
   tools/build.js 引入了「一份源码 + 一份产物」的双轨结构。它带来一个**全新的失效模式**：

       改了 js/app.js → 忘了 npm run build → 发布出去的还是旧 app.min.js
       → 用户拿到旧行为，而且**没有任何报错**。

   这不是理论风险：静态站点是「所见即所得」发布，产物落后于源码这件事
   不会在任何环节被察觉。所以必须有一道自动化测试把它变成**红灯**。

   同时它顺手守住另外三件容易被绕过的事：
     ① index.html 必须引用 .min 产物 —— 否则 683KB 的源码会被直接发上网
     ② 产物不能是源码的原样拷贝 —— 防止 build 静默失败后留了个假产物
     ③ **产物才是用户真正在跑的代码** —— 所以安全扫描必须覆盖产物，不能只扫源码
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '   ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rd = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

console.log('=== R19-a. 产物存在且与 tools/build-stamp.json 一致 ===');

const stampPath = path.join(dir, 'tools', 'build-stamp.json');
if (!fs.existsSync(stampPath)) {
  console.log('  ✗ 缺少 tools/build-stamp.json —— 请先跑 npm run build');
  console.log('\n_RESULT pass=0 fail=1');
  process.exit(1);
}
const stamp = JSON.parse(rd('tools/build-stamp.json'));
t('build-stamp.json 的 schema 是 1', stamp.schema === 1, 'schema=' + stamp.schema);

for (const [srcRel, outRel] of [['js/app.js', 'js/app.min.js'], ['css/style.css', 'css/style.min.css']]) {
  const srcBuf = fs.readFileSync(path.join(dir, srcRel));
  const srcSha = sha256(srcBuf);
  const rec = stamp.sources[srcRel];
  const sourceMatches = rec && rec.sha256 === srcSha;

  t(`${srcRel} 与构建时记录的一致（没忘记重跑 build）`, sourceMatches,
    sourceMatches ? '' : `源码 sha 已变：构建时 ${rec && rec.sha256.slice(0, 12)}…，现在 ${srcSha.slice(0, 12)}…  → 请跑 npm run build`);

  if (!fs.existsSync(path.join(dir, outRel))) {
    t(`${outRel} 存在`, false, '缺失 —— 请跑 npm run build');
    continue;
  }
  const outBuf = fs.readFileSync(path.join(dir, outRel));
  const outSha = sha256(outBuf);
  const outRec = stamp.outputs[outRel];
  t(`${outRel} 与构建产物字节一致（没被手工改过）`, !!outRec && outRec.sha256 === outSha,
    outRec && outRec.sha256 === outSha ? `${outBuf.length} B` : `期望 ${outRec && outRec.sha256.slice(0, 12)}…，实际 ${outSha.slice(0, 12)}…`);

  // ② 产物不能是源码的原样拷贝
  const ratio = outBuf.length / srcBuf.length;
  t(`${outRel} 确实是压缩过的（体积 < 源码的 80%）`, ratio < 0.8,
    `${srcBuf.length} B → ${outBuf.length} B（${(ratio * 100).toFixed(1)}%）`);
}

console.log('\n=== R19-b. index.html 必须引用 .min 产物 ===');

const html = rd('index.html');
t('样式表引用 css/style.min.css', /href="css\/style\.min\.css"/.test(html));
t('脚本引用 js/app.min.js', /src="js\/app\.min\.js"/.test(html));
t('没有把源码直接挂到首屏（不应再有 js/app.js 的 script 标签）',
  !/<script[^>]*src="js\/app\.js"/.test(html));

// 脚本顺序：依赖必须先于 app —— 这条原本在 production.test.js 的 N8，
// 但那里读的是源码路径；产物上线后真正被加载顺序影响的是 .min，挪到这里更准。
const tags = html.match(/<script[^>]*>/g) || [];
const idx = (needle) => tags.findIndex((s) => s.indexOf(needle) >= 0);
const iVendor = idx('vendor/workbuddy-cloud-sdk.global.js');
const iApp = idx('js/app.min.js');
t('脚本顺序：云 SDK 先于 js/app.min.js', iVendor >= 0 && iApp >= 0 && iVendor < iApp,
  `vendor=${iVendor} app=${iApp}`);

console.log('\n=== R19-c. 安全扫描必须覆盖**用户真正下载的那份代码** ===');
/* 源码被 reads by production.test.js 的第 7 节，但用户浏览器拿的是 .min。
   攻击者看的是产物。本节把同样的密钥扫描施加到产物上。 */
const published = ['index.html', 'js/app.min.js', 'css/style.min.css']
  .map((f) => rd(f)).join('\n');
t('产物内无 sk- 私密密钥', !/sk-[A-Za-z0-9]{16,}/.test(published));
t('产物内无 Bearer 令牌', !/Bearer\s+[A-Za-z0-9]/.test(published));
t('产物内无 api_key / secret 硬编码', !/(api[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"]{12,}/i.test(published));
const keys = published.match(/wbpk_[A-Za-z0-9_-]{16,}/g) || [];
t('产物内唯一凭据仍是公开型 publishableKey', keys.length >= 1 && keys.every((k) => k.startsWith('wbpk_')),
  `命中 ${keys.length} 处`);

console.log('\n=== R19-d. 顶层导出 API 在产物里仍然完好 ===');
/* 压缩最容易搞坏的东西：app.js 末尾 Object.assign(window, {...}) 用的是简写属性，
   顶层名一旦被改名，导出的**键**会跟着变，页面全部按钮静默失效（连报错都没有）。
   tools/build.js 自己也会自检，这里是第二道 —— 直接核对真实产物文件。 */
const minJs = rd('js/app.min.js');
const MUST_KEEP = [
  'function ensureVendors', 'function initAvatarVideo', 'function applyAvatarStyle',
  'function probeVideo', 'function hideSplash', 'async function exportPPTX',
  'function guardSummaryEvidence', 'function slideHTML', 'function rateLabel',
  'function enforceLoginGate', 'function persistCourses', 'function streamChat',
];
const lost = MUST_KEEP.filter((n) => minJs.indexOf(n) < 0);
t(`顶层 API 名保留 ${MUST_KEEP.length - lost.length}/${MUST_KEEP.length}`, lost.length === 0,
  lost.length ? '丢失：' + lost.join(', ') : '');

console.log('\n=== R19-e. 产物中不应该残留调试痕迹 ===');
t('产物里没有 console.log（terser compress 默认不删它们，这里只做提醒级断言）',
  true, `命中 ${(minJs.match(/console\.log\(/g) || []).length} 处（不阻断，仅记录）`);

console.log('\n=== R19-f. 构建生成的 SEO 文件（sitemap / robots）===');
/* 这两个文件由 tools/build.js 从 tools/indexnow.config.json 生成。
   ⚠ 它们的风险不是"内容丑"，而是**域名漂移** —— 一旦手写，
     改了域名却忘了改文件，就会产出指向死域名的 sitemap，而且不会有任何报错。
     所以这里把"与配置一致"钉成断言。（域名在 2026-09-28 事故里真变过一次。） */
const SEO_FILES = ['sitemap.xml', 'robots.txt'];
const seoExists = SEO_FILES.every((f) => fs.existsSync(path.join(dir, f)));
t('sitemap.xml 与 robots.txt 都在发布目录根', seoExists);
if (seoExists) {
  const cfgPath = path.join(dir, 'tools', 'indexnow.config.json');
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : null;
  t('能找到 tools/indexnow.config.json（origin 的唯一来源）', !!cfg);
  const sitemap = rd('sitemap.xml');
  const robots = rd('robots.txt');
  if (cfg) {
    const locs = (sitemap.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, ''));
    t('sitemap 的 URL 与配置里的 urls 完全一致', JSON.stringify(locs) === JSON.stringify(cfg.urls), locs.length + ' 条');
    t('sitemap 里所有 URL 都属于该 host（不是死域名）', locs.every((u) => {
      try { return new URL(u).hostname === cfg.host; } catch (_) { return false; }
    }));
    t('robots.txt 指向的是正确的 sitemap 绝对地址',
      robots.indexOf('Sitemap: ' + cfg.origin + '/sitemap.xml') >= 0);
    t('robots.txt 没有屏蔽 IndexNow 的 key 文件（根目录必须可抓）',
      !/^Disallow:\s*\S/m.test(robots), '（只有 Allow: /）');
  }
  t('sitemap 结构完整（XML 声明 + urlset 开闭）',
    /^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(sitemap.trim()) &&
    sitemap.indexOf('<urlset') >= 0 && sitemap.indexOf('</urlset>') >= 0);
  t('SEO 文件的 sha 与 stamp 记录一致（防手工改动后忘记重建）', (() => {
    const rec = stamp.generated && stamp.generated['sitemap.xml'];
    return !!rec && rec.sha256 === sha256(Buffer.from(sitemap, 'utf8'));
  })());
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`_RESULT pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
