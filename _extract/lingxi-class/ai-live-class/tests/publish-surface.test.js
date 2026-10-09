/* tests/publish-surface.test.js —— 发布面分类守卫（R21）

   ===== 为什么需要它 =====
   发布目录 `_extract/lingxi-class/ai-live-class` **同时也是 git 工作区**，
   而平台的部署是「把目录里的东西全传上去」。所以：

       任何新增的顶层文件/目录，默认都会跟着发布被公开托管。

   这是 **fail-open** 的 —— 没有报错，只有"多公开了一个文件"。
   `_quality/`（14 个真实课件）、`.minprobe/`（我的实验脚本）都曾差点这么漏出去。

   护栏 scripts/publish-guard.js 现在用**白名单**堵它：顶层每一项都必须被明确分类，
   否则拒绝发布。但白名单本身也会随时间失守（新增项没人登记 ⇒ 发布被拦，或者
   有人图省事故意放宽 KEEP ⇒ 白名单被架空）。
   本文件就是那根"防白名单自己漂移"的弦：

     · 顶层每一项都必须落在 KEEP / ALLOW_EXTRA / MOVE / SHADOW / 根目录 *.txt 之内
     · KEEP 与 MOVE 不得交叉，SHADOW 必须是 MOVE 的子集（自洽性）
     · 白名单里**绝不能**出现 tests / tools / sql / node_modules 这类开发目录

   ★ 取分类的方式是 require 那个**无副作用**的纯模块 scripts/publish-config.js，
     而不是 require 护栏本身（模块级有 process.exit）、
     也不是正则解析源码（改个变量名就静默解析失败 ⇒ 返回空集合 ⇒ 恒真，等于没测）、
     更不是起子进程（本环境沙箱内 execFileSync 一律 EBUSY）。
*/

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');                                   // 应用目录
const REPO = path.resolve(__dirname, '..', '..', '..', '..');             // 仓库根（tests→应用→lingxi-class→_extract→仓库根）
const GUARD = path.join(REPO, 'scripts', 'publish-guard.js');
const CFGMOD = path.join(REPO, 'scripts', 'publish-config.js');

let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '   ' + extra : ''}`);
  ok ? pass++ : fail++;
};

console.log('=== R21-a. 护栏在仓库里（不再只在 .workbuddy/ 本地） ===');
t('scripts/publish-guard.js 存在', fs.existsSync(GUARD));
t('scripts/publish-config.js（分类清单）存在', fs.existsSync(CFGMOD));
if (!fs.existsSync(GUARD) || !fs.existsSync(CFGMOD)) {
  console.log('\n_RESULT pass=' + pass + ' fail=' + (fail + 1));
  process.exit(1);
}
/* 它必须在**发布目录之外**，否则自己会被上传 */
t('护栏不在发布目录内（不会被上传）', !GUARD.startsWith(dir + path.sep), path.relative(REPO, GUARD));

let cfg;
try {
  cfg = require(CFGMOD);
} catch (e) {
  console.log('  ✗ 无法 require ' + CFGMOD + '：' + (e && e.message));
  console.log('\n_RESULT pass=' + pass + ' fail=' + (fail + 1));
  process.exit(1);
}
cfg = Object.assign({}, cfg, { allowedTop: [...cfg.allowedTopLevel()] });
t('分类清单模块可读（MOVE / KEEP / allowedTop）',
  Array.isArray(cfg.MOVE) && Array.isArray(cfg.KEEP) && cfg.allowedTop.length > 0);
/* 反向确认清单不是空的 —— 空集合会让下面所有断言恒真 */
t('清单非空（不是解析失败后的空壳）', cfg.MOVE.length >= 5 && cfg.KEEP.length >= 3,
  `MOVE ${cfg.MOVE.length} 项 / KEEP ${cfg.KEEP.length} 项`);

console.log('\n=== R21-b. 发布目录顶层每一项都必须被分类（核心断言）===');
const allowed = new Set(cfg.allowedTop || []);
const mSet = new Set(cfg.MOVE || []);
const shSet = new Set(Object.keys(cfg.SHADOW || {}));
const entries = fs.readdirSync(dir);
const unclassified = entries.filter((f) => {
  if (allowed.has(f)) return false;
  if (mSet.has(f)) return false;
  if (shSet.has(f)) return false;
  return true;                       // allowedTop 里已含"根目录非隐藏 *.txt"的例外
});
t(`顶层 ${entries.length} 项全部已分类`, unclassified.length === 0,
  unclassified.length ? '未分类：' + unclassified.join(', ') + '  ← 需在护栏里加入 MOVE 或 KEEP' : '');

console.log('\n=== R21-c. 分类自洽性 ===');
const KEEP = cfg.KEEP || [];
const cross = KEEP.filter((f) => mSet.has(f));
t('KEEP 与 MOVE 不交叉', cross.length === 0, cross.length ? '交叉：' + cross.join(', ') : '');
const shadowNotMoved = [...shSet].filter((f) => !mSet.has(f));
t('SHADOW 目录同时也在 MOVE 里（否则不会被部分移出）', shadowNotMoved.length === 0,
  shadowNotMoved.length ? '缺失：' + shadowNotMoved.join(', ') : '');
const missing = KEEP.filter((f) => !fs.existsSync(path.join(dir, f)));
t('KEEP 里的运行所需文件都真实存在', missing.length === 0, missing.length ? '缺失：' + missing.join(', ') : '');

console.log('\n=== R21-d. 白名单里绝不能出现开发目录 ===');
const DANGEROUS = ['tests', 'tools', 'sql', 'node_modules', '.minprobe', 'package.json', 'package-lock.json'];
const leaked = DANGEROUS.filter((f) => allowed.has(f));
t('白名单不含 tests / tools / sql / node_modules 等', leaked.length === 0,
  leaked.length ? '★ 出现：' + leaked.join(', ') + '（发布即公开托管）' : '');
/* 反向确认：这些目录确实存在（否则上一条会因"不存在"而假绿） */
const present = DANGEROUS.filter((f) => fs.existsSync(path.join(dir, f)));
t('上一条不是假绿（这些目录确实在发布目录里）', present.length >= 3,
  '实测存在：' + present.join(', '));

console.log('\n=== R21-e. IndexNow 的 key 文件必须属于允许面上传 ===');
const iCfgPath = path.join(dir, 'tools', 'indexnow.config.json');
const iCfg = fs.existsSync(iCfgPath) ? JSON.parse(fs.readFileSync(iCfgPath, 'utf8')) : null;
t('能找到 tools/indexnow.config.json', !!iCfg);
if (iCfg) {
  t(`根目录存在 ${iCfg.keyFile}`, fs.existsSync(path.join(dir, iCfg.keyFile)));
  t('它被视为可上传（否则发布后 key 文件缺失 ⇒ IndexNow 必回 403）',
    allowed.has(iCfg.keyFile), 'key 文件=' + iCfg.keyFile);
}
/* 反向确认例外规则没有被放宽成"任何 txt 都放行" */
t('白名单例外按 key 真实格式收紧（robots.txt 靠 ALLOW_EXTRA 而非通配通过）',
  allowed.has('robots.txt') && !allowed.has('随便一个.txt') && !allowed.has('notes.txt'));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`_RESULT pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
