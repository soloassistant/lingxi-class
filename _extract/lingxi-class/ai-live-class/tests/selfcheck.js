/* ============================================================
   常驻检查程序：对**已部署的线上站点**跑一遍产品内置自检
   （tests/selfcheck.js）

   为什么要有这个脚本：这段时间每个问题我都是临时写探针才发现 ——
   "听不到老师"、"带图导不出 PPT"、都有个共同点：**功能看着在、实际不出声/不出图**，
   页面上毫无异常。所以：
     ① 产品里做了「运行自检」（声音设置 → 运行自检），把结论开放成 window.runSelfCheck()
     ② 这个脚本负责在**部署后的产物上**把它跑一遍，把结果打出来并给出退出码
   ★ 一定要跑部署后的站点，不是本地文件 —— 有一次我忘了发布，
     验的是线上旧版，差点误判"改动没生效"。

   用法：
     node tests/selfcheck.js            # 检查线上站点，有问题退出码 1
     node tests/selfcheck.js --json     # 输出 JSON（便于接入其它流程）
   ============================================================ */
const fs = require('fs');
const path = require('path');

const SITE = process.env.LINGXI_URL || 'https://lingxi-class.app.workbuddy.host/';
const JSON_OUT = process.argv.indexOf('--json') >= 0;
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

async function main() {
  const exe = findBrowser();
  if (!exe) {
    console.error('找不到 Chrome / Edge，无法运行自检');
    process.exit(2);
  }
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch (e) {
    console.error('缺少 playwright-core，无法运行自检：' + e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 200)));

  // 等应用初始化（含重试：线上偶发慢）
  let ready = false;
  for (let k = 0; k < 3 && !ready; k++) {
    try {
      await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
      for (let i = 0; i < 120; i++) {
        if (await page.evaluate(() => typeof window.runSelfCheck === 'function').catch(() => false)) { ready = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (_) { /* 重试 */ }
  }
  if (!ready) {
    console.error('❌ 页面未能初始化（连不上或自检函数不存在）');
    await browser.close();
    process.exit(1);
  }

  const rep = await page.evaluate(() => {
    const r = window.runSelfCheck();
    return r;
  });
  await browser.close();

  // 附加：页面级 JS 报错也算问题（产品自检看不到这些）
  const extra = [];
  if (pageErrors.length) extra.push({ name: '页面脚本报错', detail: [...new Set(pageErrors)].join(' | ') });
  if (consoleErrors.length) extra.push({ name: '控制台报错', detail: [...new Set(consoleErrors)].slice(0, 3).join(' | ') });

  if (JSON_OUT) {
    console.log(JSON.stringify({ site: SITE, report: rep, extra: extra }, null, 2));
  } else {
    console.log('=== 灵犀课堂 · 线上自检 ===');
    console.log('站点: ' + SITE);
    console.log('时间: ' + new Date().toLocaleString());
    console.log('');
    rep.items.forEach((it) => {
      console.log('  ' + (it.ok ? '✅' : '❌') + ' ' + it.name + '：' + it.detail);
      if (!it.ok && it.fix) console.log('       → ' + it.fix);
    });
    extra.forEach((x) => console.log('  ⚠ ' + x.name + '：' + x.detail));
    console.log('');
    console.log(rep.ok && !extra.length
      ? ('全部 ' + rep.items.length + ' 项通过')
      : ('❌ 自检未通过：产品自检失败 ' + rep.failed + ' 项，页面级问题 ' + extra.length + ' 项'));
    console.log('浏览器: ' + rep.ua);
  }
  process.exit(rep.ok && !extra.length ? 0 : 1);
}

main().catch((e) => { console.error('自检脚本异常: ' + (e && e.message)); process.exit(2); });
