/* tests/indexnow.test.js —— IndexNow 配置与 key 文件的完整性守卫（R20）

   ===== 为什么需要它 =====
   IndexNow 的所有权验证完全依赖「站点根目录上有一个 {key}.txt，内容就是这个 key」。
   这条链路有个隐蔽的失效模式：**key 文件被误删 / 内容被改动 / 名字改了**，
   本地什么都不会报错，直到某天提交时收到 403 —— 而那时你根本不会想到是文件的事。

   本文件把这几件事钉成断言：
     · 配置存在且 key 符合协议（8~128 位 a-zA-Z0-9-）
     · key 文件在**发布目录根**、文件名就是 {key}.txt、内容**逐字节等于 key**（不许多换行）
     · 提交的 URL 都属于声明的 host（否则引擎回 422）
     · 提交端点与官方文档一致

   ⚠ 本文件**不联网**（只做静态核对）—— 网络可达性由 `node tools/indexnow.js --check` 负责，
     那是发布后该做的事，不该混进回归套件（否则套件会依赖外网）。
*/

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '   ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const CONFIG = path.join(dir, 'tools', 'indexnow.config.json');

console.log('=== R20-a. 配置存在且 key 合规 ===');
if (!fs.existsSync(CONFIG)) {
  console.log('  ✗ 缺少 tools/indexnow.config.json —— 跑 node tools/indexnow.js --init 生成');
  console.log('\n_RESULT pass=0 fail=1');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
t('配置可解析', !!cfg && typeof cfg === 'object');
t('key 符合协议（8~128 位，仅 a-zA-Z0-9-）', /^[a-zA-Z0-9-]{8,128}$/.test(cfg.key || ''), 'key=' + String(cfg.key).slice(0, 10) + '…');
t('host 与 origin 一致', (() => {
  try { return new URL(cfg.origin).hostname === cfg.host; } catch (_) { return false; }
})());
t('提交端点与官方文档一致', cfg.endpoint === 'https://api.indexnow.org/indexnow', cfg.endpoint);

console.log('\n=== R20-b. key 文件必须在**发布目录根**，且内容逐字节等于 key ===');
const keyFileRel = (cfg.keyFile || (cfg.key + '.txt'));
t('key 文件名就是 {key}.txt', keyFileRel === cfg.key + '.txt', keyFileRel);
const keyPath = path.join(dir, keyFileRel);
t('key 文件位于发布目录根（不是子目录 —— 官方强烈推荐 Option 1）', fs.existsSync(keyPath));
if (fs.existsSync(keyPath)) {
  const raw = fs.readFileSync(keyPath, 'utf8');
  const buf = fs.readFileSync(keyPath);
  t('内容逐字节等于 key（无换行/空格/BOM）', raw === cfg.key,
    raw === cfg.key ? `${buf.length} B` : `实际 ${JSON.stringify(raw.slice(0, 20))}`);
  t('UTF-8 无 BOM（BOM 会让引擎比对失败）', !(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF));
}

console.log('\n=== R20-c. 提交的 URL 必须都属于声明的 host（否则引擎回 422）===');
const urls = cfg.urls || [];
t('URL 列表非空', urls.length > 0, urls.length + ' 条');
const badUrls = urls.filter((u) => {
  try { const x = new URL(u); return x.hostname !== cfg.host || !/^https?:$/.test(x.protocol); }
  catch (_) { return true; }
});
t('全部 URL 属于该 host 且协议合法', badUrls.length === 0, badUrls.length ? '异常：' + badUrls.join(', ') : '');
/* Option 1（根目录 key 文件）下，key 文件所在目录决定可用 URL 范围 —— 根目录 = 整站 */
t('key 文件在根 ⇒ 覆盖全站 URL（与 urls 的作用域一致）', keyFileRel.indexOf('/') < 0);

console.log('\n=== R20-d. 脚本与入口存在 ===');
t('tools/indexnow.js 存在', fs.existsSync(path.join(dir, 'tools', 'indexnow.js')));
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
t('npm run indexnow 已注册', !!(pkg.scripts && pkg.scripts.indexnow));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`_RESULT pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
