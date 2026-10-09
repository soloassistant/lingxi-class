#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   publish-guard.js —— 灵犀课堂发布前的"清理 / 还原"护栏

   背景（2026-10-07 实测，务必理解，否则会重新泄露内容）：
     · 发布目录 = _extract/lingxi-class/ai-live-class
       它同时也是 git 工作区，所以**测试、工具、课件、node_modules 都真实躺在里面**。
     · 平台的部署是**覆盖式**的：本地删掉文件，线上不会消失。
       所以"发布前把开发目录移走"只能防止**上传**，不能**摘掉**已经在线上的旧副本。
     · 反过来，**直接对着这个目录发布 = 把 tests/ tools/ sql/ _quality/ 和 877MB 的
       开发依赖一起公开托管**（`_quality/` 里是 14 个真实课件 .pptx，平台还开着目录列表）。

   用法：
     node scripts/publish-guard.js prepare   # 发布前：**先自动构建压缩产物**，再补齐影子占位，再把自有开发文件移出并打清单
     node scripts/publish-guard.js verify    # 发布前：确认发布目录里只剩运行所需文件、且产物与影子占位在位
     node scripts/publish-guard.js restore   # 发布后：搬回来，并逐字节校验
     node scripts/publish-guard.js status    # 任何时候：看当前处于哪一态
     node scripts/publish-guard.js build     # 只跑构建（等价 npm run build）

   ★ 为什么 prepare 里要**自动构建**（2026-10-09 加）：
     首屏压缩改成了「源码 js/app.js + 产物 js/app.min.js」双文件结构，
     于是多出一种**静默**故障：改了源码、忘了 `npm run build`，发布出去的是旧逻辑 ——
     没有任何报错，用户拿到的是旧行为。
     tests/build-freshness.test.js 能把它变成红灯，但那要求"跑测试"这件事本身没被跳过。
     把它绑进 prepare 之后就再也绕不过去：**构建失败 ⇒ 直接中止发布**。
     构建必须在「移出 tools/ node_modules」**之前**跑（它俩正是构建的依赖）。

   「运行所需文件」白名单（只有这些该被上传）：
     index.html  css/  js/  assets/  vendor/
     robots.txt  sitemap.xml（由构建生成）  .gitattributes  根目录 *.txt（IndexNow 的 {key}.txt）

   ★ 本文件为什么放在 scripts/ 而不是 .workbuddy/（2026-10-09 改）：
     `.workbuddy/` 是 gitignore 的 ⇒ 脚本**不在仓库里**。别人克隆后没有这个护栏，
     照着文档直接发布就会把 tests/ tools/ sql/ 连同 14 个课件一起公开托管 ——
     而这几类目录**都是已跟踪的**（tests 28 个文件 / tools 13 个 / sql 2 个）。
     移到 scripts/ 之后：它随仓库分发，且**位于发布目录之外**，永远不会被上传。
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

/* 分类清单（MOVE / KEEP / ALLOW_EXTRA / SHADOW / allowedTopLevel）抽在 ./publish-config.js，
   与 tests/publish-surface.test.js 共用同一份数据 —— 避免"护栏放宽了但没人发现"。 */
const {
  ROOT, APP, HOLD, MANIFEST, MOVE, KEEP, ALLOW_EXTRA, SHADOW, SHADOW_PLACEHOLDER, allowedTopLevel,
} = require('./publish-config');

/* 确保每个 SHADOW 目录里都有影子占位页 —— 缺目录就建、缺文件就写。
   ★ 为什么必须**自动生成**而不是依赖仓库里存着（2026-10-09）：
     `_quality/` 是 gitignore 的 ⇒ 新克隆里没有这个目录、也没有占位页 ⇒
     照文档发布时这一条遮蔽是**静默失效**的（线上目录列表照旧）。
     内容收敛在 publish-config.js 的 SHADOW_PLACEHOLDER，这里只负责落盘。
   ★ 必须在 moveOut **之前**跑：moveOut 会遍历目录内容，占位要先就位才能被"留下"。 */
function ensureShadow() {
  const created = [];
  for (const dir of Object.keys(SHADOW)) {
    for (const f of SHADOW[dir]) {
      const p = path.join(APP, dir, f);
      if (fs.existsSync(p)) {
        /* 已存在但内容不符 ⇒ 按权威内容改写。
           ⚠ 不静默接受旧内容：占位页一旦被人改写成含内部信息的版本就会公开泄露。 */
        const cur = fs.readFileSync(p, 'utf8');
        if (cur !== SHADOW_PLACEHOLDER) {
          fs.writeFileSync(p, SHADOW_PLACEHOLDER);
          created.push(dir + '/' + f + '（内容不符，已按权威内容改写）');
        }
        continue;
      }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, SHADOW_PLACEHOLDER);
      created.push(dir + '/' + f + '（缺失，已生成）');
    }
  }
  if (created.length) log('· 影子占位已就位：\n    ' + created.join('\n    '));
  else log('· 影子占位 ' + Object.keys(SHADOW).length + ' 个目录均在位');
}

/* 把某个 MOVE 项移出发布目录。带 SHADOW 的目录只移走非影子内容，目录本身留下。 */
function moveOut(entry) {
  const src = path.join(APP, entry);
  if (!fs.existsSync(src)) return null;
  const keep = SHADOW[entry];
  if (!keep) {
    const dst = path.join(HOLD, entry);
    if (fs.existsSync(dst)) die('暂存区已有同名项，先跑 restore：' + entry);
    fs.renameSync(src, dst);
    return { entry, partial: false, children: [] };
  }
  const dstDir = path.join(HOLD, entry);
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
  const children = [];
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (keep.includes(e.name)) continue;          // 影子文件留在原地
    const to = path.join(dstDir, e.name);
    if (fs.existsSync(to)) die('暂存区已有同名项：' + entry + '/' + e.name);
    fs.renameSync(path.join(src, e.name), to);
    children.push(e.name);
  }
  return { entry, partial: true, children };
}

/* moveOut 的逆操作 */
function moveBack(entry) {
  const src = path.join(HOLD, entry);
  if (!fs.existsSync(src)) return null;
  const keep = SHADOW[entry];
  if (!keep) {
    const dst = path.join(APP, entry);
    if (fs.existsSync(dst)) die('发布目录已有同名项，拒绝覆盖：' + entry);
    fs.renameSync(src, dst);
    return { entry, partial: false, children: [] };
  }
  const children = [];
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const dst = path.join(APP, entry, e.name);
    if (fs.existsSync(dst)) die('发布目录已有同名项，拒绝覆盖：' + entry + '/' + e.name);
    fs.renameSync(path.join(src, e.name), dst);
    children.push(e.name);
  }
  try { fs.rmdirSync(src); } catch (_) { /* 垫片可能拦截删目录；留个空目录无害 */ }
  return { entry, partial: true, children };
}

const log = console.log;
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

/* 在发布目录里跑一次构建（tools/build.js），保证压缩产物 = 当前源码。
   ★ 必须在移出 tools/ 与 node_modules **之前**调用 —— 构建依赖它们。
   ★ 构建失败一律中止发布：宁可发不出去，也不能把旧逻辑静默发上线。 */
function runBuild() {
  const buildScript = path.join(APP, 'tools', 'build.js');
  if (!fs.existsSync(buildScript)) {
    log('· 未找到 tools/build.js，跳过构建');
    return;
  }
  log('▶ 构建压缩产物：node tools/build.js');
  try {
    execFileSync(process.execPath, ['tools/build.js'], { cwd: APP, stdio: 'inherit' });
  } catch (e) {
    die('构建失败（exit ' + ((e && e.status) != null ? e.status : '?') + '），已中止发布。'
      + '\n  修复后重跑 prepare；**不要**在产物可疑的情况下发布。');
  }
}

/* 发布目录里必须存在的产物 + 引用关系（verify 阶段跑，此时 tools/ 已被移出，读不到 stamp）。
   只在 index.html **确实引用了 .min** 时才检查，这样没启用压缩的版本不会被误拦。 */
function assertArtifacts() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const usesMin = /src="js\/app\.min\.js"/.test(html) || /href="css\/style\.min\.css"/.test(html);
  if (!usesMin) { log('· index.html 未引用 .min 产物（该版本未启用压缩），跳过产物检查'); return; }
  const bad = [];
  for (const f of ['js/app.min.js', 'css/style.min.css']) {
    const p = path.join(APP, f);
    if (!fs.existsSync(p)) bad.push(f + ' 缺失');
    else if (fs.statSync(p).size < 10000) bad.push(f + ' 体积异常（' + fs.statSync(p).size + ' B）');
  }
  if (!/src="js\/app\.min\.js"/.test(html)) bad.push('index.html 未引用 js/app.min.js');
  if (!/href="css\/style\.min\.css"/.test(html)) bad.push('index.html 未引用 css/style.min.css');
  if (bad.length) die('压缩产物检查未通过：\n    ' + bad.join('\n    '));
  log('✓ 压缩产物在位，且 index.html 引用的就是它们');
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else out.push(r);
  }
  return out;
}

const mode = process.argv[2];
if (!fs.existsSync(APP)) die('发布目录不存在: ' + APP);

if (mode === 'config') {
  /* 把分类结果以 JSON 吐出来，供 tests/publish-surface.test.js 使用。
     ★ 为什么不让测试去 require 本文件：本文件是"脚本"，模块级就有副作用（process.exit）。
     ★ 为什么不让测试用正则解析源码：改个变量名就会**静默解析失败**（返回空集合 ⇒ 恒真），
       那等于没测。走这个模式，解析交回 JSON.parse，失败必然报错。 */
  console.log(JSON.stringify({
    APP, KEEP, ALLOW_EXTRA, MOVE, SHADOW, allowedTop: [...allowedTopLevel()],
  }, null, 2));
  process.exit(0);
}

if (mode === 'status') {
  const inApp = MOVE.filter((f) => !SHADOW[f] && fs.existsSync(path.join(APP, f)));
  const entries = fs.existsSync(HOLD) ? fs.readdirSync(HOLD).filter((f) => f !== 'MANIFEST.txt') : [];
  /* ★ 只算"真的持有内容"的项：本环境删目录可能失败，restore 后会留下**空目录**，
     若把它算进去，status 会把「已完成 restore」误报成「待 restore」。 */
  const inHold = entries.filter((f) => {
    const p = path.join(HOLD, f);
    try { return !fs.statSync(p).isDirectory() || fs.readdirSync(p).length > 0; }
    catch (_) { return true; }
  });
  const emptyLeft = entries.filter((f) => !inHold.includes(f));
  log('发布目录 : ' + APP);
  log('护栏暂存 : ' + HOLD);
  log('发布目录里仍在的开发文件 : ' + (inApp.length ? inApp.join(', ') : '（无）'));
  log('暂存区里持有 : ' + (inHold.length ? inHold.join(', ') : '（无）'));
  if (emptyLeft.length) log('暂存区里的空目录残留（无害） : ' + emptyLeft.join(', '));
  for (const [dir, files] of Object.entries(SHADOW)) {
    for (const f of files) {
      const p = path.join(APP, dir, f);
      let s;
      if (!fs.existsSync(p)) s = '★ 缺失（prepare 会补齐）';
      else if (fs.readFileSync(p, 'utf8') !== SHADOW_PLACEHOLDER) s = '★ 内容不符（prepare 会校正）';
      else s = '在位且内容正确（随发布上传）';
      log('影子占位 ' + dir + '/' + f + ' : ' + s);
    }
  }
  log(inApp.length && !inHold.length
    ? '\n⇒ 当前是「可发布」态：**不要直接发**，先跑 prepare 把它们移出（否则会公开课件与测试）。'
    : inHold.length
      ? '\n⇒ 当前是「已 prepare、待 restore」态：发完请立刻跑 restore。'
      : '\n⇒ 状态不明确，请人工确认。');
  process.exit(0);
}

if (mode === 'prepare') {
  runBuild();          // ← 先构建再移出：构建依赖 tools/ 与 node_modules，必须在它们被搬走前跑
  ensureShadow();      // ← 再补齐影子占位：必须在 moveOut 之前（moveOut 要"留下"它们）
  if (!fs.existsSync(HOLD)) fs.mkdirSync(HOLD, { recursive: true });
  const moved = [];
  for (const f of MOVE) {
    const r = moveOut(f);
    if (r) moved.push(r);
  }
  /* 打清单：用于 restore 阶段逐字节校验 */
  const lines = [];
  const scan = (base, rel) => {
    const full = path.join(base, rel);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isFile()) { lines.push(sha(full) + '  ' + rel); return; }
    for (const r of walk(full)) lines.push(sha(path.join(full, r)) + '  ' + (rel ? rel + '/' + r : r));
  };
  /* node_modules 太大就不进清单（它本来就是可重装的公开依赖） */
  for (const r of moved) if (r.entry !== 'node_modules') scan(HOLD, r.entry);
  fs.writeFileSync(MANIFEST, lines.join('\n') + '\n');
  log('已移出 ' + moved.length + ' 项：' + moved.map((r) => r.entry).join(', '));
  for (const r of moved) if (r.partial) {
    log('  · ' + r.entry + ' 为「影子占位」目录：只移出 ' + r.children.length + ' 项，'
      + SHADOW[r.entry].join(' / ') + ' 留在原地随发布上传（用于顶掉平台自动生成的目录索引页）');
  }
  log('清单已写入 ' + MANIFEST + '（' + lines.length + ' 个文件，不含 node_modules）');
  log('\n现在可以先验证再发布：node scripts/publish-guard.js verify');
  process.exit(0);
}

if (mode === 'verify') {
  const allowed = allowedTopLevel();
  const inApp = [];
  const unknown = [];
  log('发布目录里的顶层项：');
  for (const f of fs.readdirSync(APP)) {
    let tag;
    if (SHADOW[f]) tag = '◆ 影子占位目录（只上传 ' + SHADOW[f].join(' / ') + '）  ';
    else if (MOVE.includes(f)) { tag = '★ 不该存在  '; inApp.push(f); }
    else if (allowed.has(f)) tag = '· 可上传    ';
    else { tag = '★ 未分类    '; unknown.push(f); }
    log('  ' + tag + f);
  }
  const missing = KEEP.filter((f) => !fs.existsSync(path.join(APP, f)));
  if (inApp.length) die('仍有开发文件在发布目录里，发布会导致它们被公开托管：' + inApp.join(', '));
  if (missing.length) die('缺少运行所需文件，发布出来会白屏：' + missing.join(', '));
  /* ★ 白名单（2026-10-09 由"黑名单"升级而来）—— 这一步才是真正堵住副作用的地方。
     旧版只查"MOVE 里的项有没有残留"，对**新出现的**顶层项一无所知：
     黑名单是 fail-open，没被列出来就等于允许上传，`.minprobe/` 正是这么差点漏出去的。
     现在顶层每一项都必须被**明确分类**（KEEP / ALLOW_EXTRA / MOVE / SHADOW / 根目录 *.txt），
     否则拒绝发布 —— 逼人对"这个新东西该不该上网"做一次清醒决定。 */
  if (unknown.length) {
    die('发布目录里出现了**未分类**的顶层项，拒绝发布：' + unknown.join(', ')
      + '\n  原因：发布目录同时是 git 工作区，任何新增产物默认都会跟着上传（fail-open）。'
      + '\n  处置：二选一 —— 加进 MOVE（开发文件，发布前移出）或 KEEP / ALLOW_EXTRA（运行所需，允许上传）。');
  }
  /* 影子占位必须**在位且内容正确**，否则这次发布不会顶掉目录索引页 —— 静默失效。
     ★ 升级为 die()（2026-10-09）：以前只是打一行 ⚠ 就继续，等于"看着已处理、实际漏了"。
       现在 prepare 会 ensureShadow() 自动补齐，所以走到这里还缺失就是真出了问题。
     ★ 同时校验**内容**：占位页是公开发布的，被人改写成含内部信息的版本就是一次泄露。 */
  const shadowBad = [];
  for (const [dir, files] of Object.entries(SHADOW)) {
    for (const f of files) {
      const p = path.join(APP, dir, f);
      if (!fs.existsSync(p)) { shadowBad.push(dir + '/' + f + ' 缺失（本次发布不会遮蔽 /' + dir + '/）'); continue; }
      if (fs.readFileSync(p, 'utf8') !== SHADOW_PLACEHOLDER) shadowBad.push(dir + '/' + f + ' 内容与权威占位页不一致');
    }
  }
  if (shadowBad.length) {
    die('影子占位检查未通过：\n    ' + shadowBad.join('\n    ')
      + '\n  处置：跑一次 prepare（会自动补齐并校正内容），再重跑 verify。');
  }
  assertArtifacts();
  log('\n✓ 发布目录干净：只剩运行所需文件，且 ' + KEEP.join(' / ') + ' 都在。');
  process.exit(0);
}

if (mode === 'restore') {
  if (!fs.existsSync(MANIFEST)) die('找不到清单 ' + MANIFEST + '，拒绝盲目还原');
  const moved = [];
  for (const f of MOVE) {
    const r = moveBack(f);
    if (r) moved.push(r);
  }
  /* 逐字节校验。
     ★ 校验的是**还原后**的文件，所以路径基准必须是 APP 而不是 HOLD。
       这里踩过一次：写在 HOLD 上，而上面已经 renameSync 把它们搬走了，
       于是 55 个文件全部报 "(缺失)" —— 一个假的"还原失败"。
       （清单本身是在 prepare 阶段按 HOLD 算的，那时它确实在 HOLD，没错。） */
  const bad = [];
  let n = 0;
  for (const line of fs.readFileSync(MANIFEST, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const [h, rel] = line.split('  ');
    const p = path.join(APP, rel);
    n++;
    if (!fs.existsSync(p)) { bad.push(rel + ' (缺失)'); continue; }
    if (sha(p) !== h) bad.push(rel + ' (哈希不符)');
  }
  log('已搬回 ' + moved.length + ' 项：' + moved.map((r) => r.entry).join(', '));
  for (const r of moved) if (r.partial) {
    log('  · ' + r.entry + ' 为「影子占位」目录：搬回 ' + r.children.length + ' 项，'
      + SHADOW[r.entry].join(' / ') + ' 原地未动');
  }
  log('逐字节校验 ' + n + ' 个文件：' + (bad.length ? '✗ ' + bad.length + ' 个不一致' : '✓ 全部一致'));
  if (bad.length) { log(bad.slice(0, 10).join('\n')); die('还原校验未通过，请人工检查'); }
  /* 清空暂存区（只剩清单）。
     ★ 本环境的删除被 safe-delete 垫片接管：删文件可行（每个约 6s，走回收站），
       删目录可能直接 ETIMEDOUT。所以这里**不能让它抛**，失败就只提示、不算错误 —— 
       暂存区残留不影响任何正确性（下一次 prepare 会检查同名项）。 */
  const leftover = [];
  for (const f of fs.readdirSync(HOLD)) {
    if (f === 'MANIFEST.txt') continue;
    try { fs.rmSync(path.join(HOLD, f), { recursive: true, force: true }); }
    catch (_) { leftover.push(f); }
  }
  if (leftover.length) {
    log('  ⚠ 暂存区未能清空（本环境删目录受限）：' + leftover.join(', ') + ' —— 无害，可忽略');
  }
  try { fs.rmSync(MANIFEST, { force: true }); } catch (_) {}
  log('\n✓ 已复原。建议再跑一次全量测试确认：node tests/run-all.js');
  process.exit(0);
}

if (mode === 'build') { runBuild(); process.exit(0); }

die('用法: node scripts/publish-guard.js prepare|verify|restore|status|build|config');
