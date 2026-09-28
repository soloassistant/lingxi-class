/* ============================================================
   静态审计（开发工具，不参与 run-all）

   用法：node tests/audit.js  [输出文件]

   检查项：
   1. index.html 中的重复 id
   2. JS 里 $('#x') 引用、但 HTML 与 JS 模板里都不存在的 id（真空指针）
   3. HTML 里定义了、JS 里从未出现的 id（疑似死代码）
   4. CSS 引用了未定义的变量 / 定义了却没用到的变量
   5. data-nav 与 view-* 的一致性
   6. 重复的 function 声明
   7. 可疑模式（console.log 残留、空 catch、innerHTML 等）

   注意：第 3 项必须结合"模板字符串里动态生成 id"来判断，否则会把
   renderGenCourse 这类动态注入的节点误报成死代码——历史上正是这个
   误报让人怀疑 #btn-go-live 是坏引用。
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const out = [];
const P = (s) => out.push(s);

/* ---------- 收集 id：静态 HTML + JS 模板字符串 ---------- */
const htmlIds = {};
const jsIds = {};
const addTo = (bag, k) => { bag[k] = (bag[k] || 0) + 1; };
let m;
const idRe = /\sid\s*=\s*["']([^"']+)["']/g;
while ((m = idRe.exec(html))) addTo(htmlIds, m[1]);
const staticIds = new Set(Object.keys(htmlIds));
idRe.lastIndex = 0;
while ((m = idRe.exec(js))) addTo(jsIds, m[1]);           // 模板里动态生成的 id

/* 分两类报，避免把「静态占位 + 动态重渲染同 id」误报成真重复：
   ① 真重复：同一个 id 在 index.html 里出现 >1 次 —— 一定会让选择器取错节点
   ② 占位重复：HTML 里有 1 个静态占位，JS 模板里也生成同一个 id。
      当模板写回的是同一容器（innerHTML 整体替换）时是安全的，
      但如果哪天改成 append 就会立刻变成真重复，所以单独列出来盯着。 */
const trueDup = Object.keys(htmlIds).filter((k) => htmlIds[k] > 1).sort();
const placeholderDup = Object.keys(htmlIds)
  .filter((k) => htmlIds[k] === 1 && jsIds[k]).sort();
P('== 1. 重复 ID ==');
P(trueDup.length
  ? trueDup.map((k) => `  DUP! #${k} 在 index.html 里出现 ${htmlIds[k]} 次`).join('\n')
  : '  真重复: (无)');
P(placeholderDup.length
  ? placeholderDup.map((k) => `  NOTE #${k} 静态占位 + JS 动态同名（渲染需整体替换容器，勿改成 append）`).join('\n')
  : '  占位重复: (无)');
P(`  index.html 静态 id=${staticIds.size}，JS 模板 id=${Object.keys(jsIds).length}`);

/* ---------- JS 引用的 id ---------- */
const refs = new Set();
const selRe = /\$\$?\('#([A-Za-z0-9_-]+)'\)/g;
while ((m = selRe.exec(js))) refs.add(m[1]);
const gidRe = /getElementById\('([A-Za-z0-9_-]+)'\)/g;
while ((m = gidRe.exec(js))) refs.add(m[1]);

const missing = [...refs].filter((r) => !(htmlIds[r] || jsIds[r])).sort();
P('== 2. JS 引用但 HTML 与模板里都不存在的 id（真 bug）==');
P(missing.length ? missing.map((k) => `  BROKEN #${k}`).join('\n') : '  (无)');
P(`  JS 引用 id 数=${refs.size}`);

/* ---------- 疑似死代码 ---------- */
/* 注意：JS 里 search 不到不等于没被用。除 getElementById / $('#x') 之外，
   还有一类"引用在 HTML 属性里、由浏览器/无障碍树消费"：
     aria-labelledby / aria-describedby / aria-controls / aria-owns
     form= / list= / for=（label 关联）/ popovertarget= / headers=（表格）
   早先没扫这些属性，把 aria-describedby 指向的 #model-hint 误报成 DEAD?，
   噪音一多就没人看这个报告了。 */
const ariaRefs = new Set();
{
  const attrRe = /\b(?:aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-activedescendant|form|list|for|popovertarget|headers)\s*=\s*["']([^"']+)["']/gi;
  let a;
  while ((a = attrRe.exec(html))) {
    for (const tok of a[1].trim().split(/\s+/)) if (tok) ariaRefs.add(tok);
  }
}
const rawUsed = (id) => ariaRefs.has(id) ||
  new RegExp('[#\'"\\s(=]' + id.replace(/-/g, '\\-') + '[\'")?#.\\s]').test(js);
const unused = [...staticIds].filter((k) => !refs.has(k) && !rawUsed(k)).sort();
const ariaOnly = [...staticIds].filter((k) => !refs.has(k) && ariaRefs.has(k)).length;
P('== 3. HTML 里定义、JS 里完全未出现（疑似死代码；CSS/无障碍专用 id 属正常）==');
P(unused.length ? unused.map((k) => `  DEAD? #${k}`).join('\n') : '  (无)');
P(`  仅经 HTML 属性引用（ARIA 关联等，${ariaOnly} 个）、仅 CSS 使用等共 ${[...staticIds].filter((k) => !refs.has(k)).length} 个，均属正常`);

/* ---------- CSS 变量 ---------- */
const defined = new Set();
const defRe = /(--[a-z0-9-]+)\s*:/g;
while ((m = defRe.exec(css))) defined.add(m[1]);
const used = new Set();
const undef = new Set();
const useRe = /var\((--[a-z0-9-]+)([,)])/g;
while ((m = useRe.exec(css))) {
  used.add(m[1]);
  if (!defined.has(m[1]) && m[2] !== ',') undef.add(m[1]);   // 带兜底值的引用不算错
}
P('== 4. CSS 变量 ==');
P(undef.size ? [...undef].map((k) => `  UNDEF ${k}`).join('\n') : '  未定义引用: (无)');
const unusedVar = [...defined].filter((v) => !used.has(v)).sort();
P(`  已定义未使用=${unusedVar.length}${unusedVar.length ? ': ' + unusedVar.join(', ') : ''}`);

/* ---------- 导航 / 视图 ---------- */
const navs = [];
const navRe = /data-nav\s*=\s*["']([^"']+)["']/g;
while ((m = navRe.exec(html))) navs.push(m[1]);
const views = new Set();
const vRe = /id\s*=\s*["']view-([A-Za-z0-9_-]+)["']/g;
while ((m = vRe.exec(html))) views.add(m[1]);
P('== 5. 导航项 / 视图一致性 ==');
[...new Set(navs)].forEach((n) => P(`  nav=${n} -> ${views.has(n) ? 'OK' : 'NO VIEW!'}`));
[...views].forEach((v) => { if (!navs.includes(v)) P(`  view=${v} 没有静态导航项（弹窗入口可接受，需确认）`); });

/* ---------- 函数 ---------- */
const fnNames = [];
const fnRe = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm;
while ((m = fnRe.exec(js))) fnNames.push(m[1]);
const fnCount = {};
fnNames.forEach((n) => (fnCount[n] = (fnCount[n] || 0) + 1));
const dupFn = Object.keys(fnCount).filter((k) => fnCount[k] > 1).sort();
P('== 6. 重复的 function 声明 ==');
P(dupFn.length ? dupFn.map((k) => `  DUPFN ${k} x${fnCount[k]}`).join('\n') : '  (无)');
P(`  function 声明总数=${fnNames.length}`);

/* ---------- 规模 ---------- */
P('== 7. 规模 ==');
P(`  app.js ${js.length} 字符 / ${js.split('\n').length} 行`);
P(`  index.html ${html.length} 字符 / ${html.split('\n').length} 行`);
P(`  style.css ${css.length} 字符 / ${css.split('\n').length} 行`);

/* ---------- 可疑模式 ---------- */
P('== 8. 可疑模式（需人工判断，非自动判定失败）==');
[
  ['console.log 残留', /console\.log\(/g],
  ['TODO/FIXME', /TODO|FIXME|XXX/g],
  ['innerHTML 赋值（逐个核对 esc()）', /\.innerHTML\s*=/g],
  ['空 catch', /catch\s*\([^)]*\)\s*\{\s*\}/g],
].forEach(([label, re]) => P(`  ${label}: ${(js.match(re) || []).length}`));

fs.writeFileSync(process.argv[2] || path.join(__dirname, 'audit-out.txt'), out.join('\n'), 'utf8');
console.log('audit done -> ' + (process.argv[2] || 'tests/audit-out.txt'));
