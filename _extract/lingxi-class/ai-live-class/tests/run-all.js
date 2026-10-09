/* 一键运行全部前端回归测试

   ⚠️ 判定标准只有最后那行 TOTAL：
   不要用 "PASS 出现次数" 去数（断言文案里也可能出现 PASS/FAIL，
   会把表头或说明文字算进去，导致"看起来全绿其实有文件失败"）。
   是否失败以 run-all 自己统计的 files_failed 为准。
*/
const { execFileSync } = require('child_process');
const path = require('path');

const NODE = process.execPath;
const tests = [
  'quiz.test.js',
  'live-flow.test.js',
  'socratic.test.js',
  'memory.test.js',
  'errors.test.js',
  'diagnostic.test.js',
  'memory-e2e.test.js',
  'auth-shapes.test.js',
  'ai-recovery.test.js',
  'legal-phone.test.js',
  'track-limit.test.js',
  'production.test.js',
  /* 行为测试：走真实函数 + 真实 DOM，专门覆盖"grep 源码测不出来"的门禁/落盘/分句 */
  'gate-behavior.test.js',
  /* R17：课堂小结的"已掌握"必须有作答证据 —— 端到端跑一节真实课堂，抓真实发出的提示词 */
  'summary-evidence.test.js',
  'feynman.test.js',
  /* R18：顶部导航的宽度预算 —— 线上出现过"7 个导航项全被折成每字一行"，
     根因是 .nav-inner 被 max-width 钉死在 1112px 而需求 ≈1160px。
     这个文件守 nowrap / 容量预算 / 断点顺序三件事。 */
  'nav-layout.test.js',
  /* R19：源码与压缩产物的新鲜度 —— 改了 js/app.js 却忘了 npm run build，
     发布出去的会是旧逻辑，而且**不会有任何报错**，用户静默拿到旧行为。
     这个文件比对 tools/build-stamp.json 里的 sha256，把"忘记构建"变成一次测试失败。
     同时断言 index.html 引用的是 .min 产物（防止把 683KB 源码直接发上网）。 */
  'build-freshness.test.js',
  /* R20：IndexNow 的 key 文件完整性 —— 根目录 {key}.txt 被误删/改坏时本地不会报错，
     直到提交收到 403 才发现。本文件把"文件名/内容/作用域/端点"钉成断言（不联网）。 */
  'indexnow.test.js',
];

let failed = 0;
const rows = [];
for (const f of tests) {
  console.log('\n##########  ' + f + '  ##########');
  let out = '';
  let code = 0;
  try {
    out = execFileSync(NODE, [path.join(__dirname, f)], {
      encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    code = (e && e.status) || 1;
    out = (e && e.stdout ? e.stdout : '') + (e && e.stderr ? e.stderr : '');
  }
  process.stdout.write(out);
  if (code) console.log('>>> ' + f + ' 失败（exit ' + code + '）');

  // 从各文件自己打印的结果行里取权威计数（两种历史格式都兼容）
  let p = 0, fl = 0;
  const pats = [
    /_RESULT pass=(\d+) fail=(\d+)/g,
    /结果:\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/g,
  ];
  pats.forEach((re) => {
    const m = out.match(re) || [];
    m.forEach((s) => {
      const g = s.match(/(\d+)\D+(\d+)/);
      if (g) { p += Number(g[1]); fl += Number(g[2]); }
    });
  });
  rows.push({ file: f, pass: p, fail: fl, exit: code });
  // 三重判定：进程退出码、自身上报的 fail 数、或"一条断言都没跑"，
  // 任一异常即算该文件失败。
  // 第三重专治加载失败：模块 require 报错时文件根本没执行，pass 与 fail 同时为 0，
  // 只看 fail 会得出"零失败"的错误结论（典型场景：漏了 NODE_PATH，11 个文件全 X）。
  const zeroRan = !code && p === 0 && fl === 0;
  if (zeroRan) {
    console.log('>>> ' + f + ' 未产生任何断言（模块加载失败？检查 NODE_PATH 是否已设置）');
    rows[rows.length - 1].zeroRan = true;
  }
  if (code || fl > 0 || zeroRan) failed++;
}

console.log('\n========================================');
rows.forEach((r) => {
  console.log(
    (r.exit || r.zeroRan ? '✗' : '✓') + ' ' + r.file.padEnd(24) +
    ' pass=' + String(r.pass).padStart(4) + ' fail=' + String(r.fail).padStart(3) +
    (r.zeroRan ? '  ← 未运行任何断言' : '')
  );
});
const totalPass = rows.reduce((a, r) => a + r.pass, 0);
const totalFail = rows.reduce((a, r) => a + r.fail, 0);
console.log('----------------------------------------');
console.log('TOTAL pass=' + totalPass + ' fail=' + totalFail +
  ' files=' + tests.length + ' files_failed=' + failed);
console.log(failed ? failed + ' 个测试文件失败' : '全部测试文件通过');

/* ── 线上自检（可选）：--online 时对**已部署站点**跑产品内置自检 ──
   为什么单独拎出来而不是塞进上面的列表：
   它需要浏览器 + 网络，跑一次要十几秒；而上面 12 个是纯本地 jsdom 测试、秒级。
   混在一起会让"快速回归"变慢，也会让本地离线开发跑不了。
   ★ 它验的是**部署后的产物**：有一次我改了代码忘了发布，拿本地/线上旧版验证，
     差点误判"改动没生效"——所以这一步必须在发布之后跑。 */
if (process.argv.indexOf('--online') >= 0) {
  console.log('\n##########  线上自检（selfcheck.js）  ##########');
  let code = 0;
  try {
    execFileSync(NODE, [path.join(__dirname, 'selfcheck.js')], { encoding: 'utf8', stdio: 'inherit' });
  } catch (e) {
    code = (e && e.status) || 1;
  }
  if (code) {
    console.log('\n>>> 线上自检未通过（exit ' + code + '）');
    failed += 1;
  }
}
process.exit(failed || totalFail ? 1 : 0);
