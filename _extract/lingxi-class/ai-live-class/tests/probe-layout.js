/* 布局探针：用无头 Chrome + CDP 抓取学习档案页的真实布局数值。
   为什么要它：模型读不了图片，只能读数据 —— 排版/溢出/配色这类问题
   必须落成数字才能判断。用法：node tests/probe-layout.js */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = path.resolve(__dirname, '..');
const PORT = 9333;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': (mime[path.extname(f)] || 'text/plain') + '; charset=utf-8' });
  res.end(fs.readFileSync(f));
});

const get = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

/* 与测试无关的纯展示样本：两个知识点、四类错因各一条，方便看比例条是否合理 */
const SAMPLE = {
  profile: { grade: '初三', system: '国内课程', goal: '中考冲刺', level: '中等偏上', teaching_style: '苏格拉底式追问', pace: '偏慢', sessions_count: 6, total_seconds: 10800 },
  facts: [
    { id: 1, kind: 'misconception', content: '配方时符号容易写错', subject: '数学', topic: '配方法', hits: 3, confidence: 0.9, last_seen: '2026-09-20T10:00:00Z' },
    { id: 2, kind: 'weak', content: '判别式符号判断不稳', subject: '数学', topic: '判别式', hits: 2, confidence: 0.8, last_seen: '2026-09-20T10:00:00Z' },
    { id: 3, kind: 'strength', content: '因式分解很熟练', subject: '数学', topic: '因式分解', hits: 4, confidence: 0.95, last_seen: '2026-09-20T10:00:00Z' },
    { id: 4, kind: 'preference', content: '喜欢先看例题再自己做', subject: '数学', topic: null, hits: 1, confidence: 0.7, last_seen: '2026-09-19T10:00:00Z' },
    // 起点画像（入学诊断留下的）—— 故意造成"3 薄弱 / 2 已会"的不均匀样本：
    // 等分样本下任何布局实现都"看起来对"，包括把比例算错的那种
    { id: 5, kind: 'weak', source: 'diagnostic', content: '课前诊断显示「判别式」还没掌握，第一节课要从这里开始讲。', subject: '数学', topic: '判别式', confidence: 0.9, last_seen: '2026-09-15T10:00:00Z' },
    { id: 6, kind: 'weak', source: 'diagnostic', content: '课前诊断显示「韦达定理」还没掌握，第一节课要从这里开始讲。', subject: '数学', topic: '韦达定理', confidence: 0.9, last_seen: '2026-09-15T10:00:00Z' },
    { id: 7, kind: 'weak', source: 'diagnostic', content: '课前诊断显示「求根公式」掌握得不牢，需要再确认一遍。', subject: '数学', topic: '求根公式', confidence: 0.65, last_seen: '2026-09-15T10:00:00Z' },
    { id: 8, kind: 'strength', source: 'diagnostic', content: '课前诊断中「因式分解」答对了，已掌握，讲课时可以直接略过基础铺垫。', subject: '数学', topic: '因式分解', confidence: 0.8, last_seen: '2026-09-15T10:00:00Z' },
    { id: 9, kind: 'strength', source: 'diagnostic', content: '课前诊断中「配方法」答对了，已掌握，讲课时可以直接略过基础铺垫。', subject: '数学', topic: '配方法', confidence: 0.8, last_seen: '2026-09-15T10:00:00Z' },
    { id: 10, kind: 'context', source: 'diagnostic', content: '入学诊断起步水平：2 个知识点已掌握、1 个待确认、2 个未掌握（共判断 5 个知识点）。', subject: '数学', confidence: 0.75, last_seen: '2026-09-15T10:00:00Z' },
  ],
  sessions: [
    { id: 1, course_title: '一元二次方程', subject: '数学', grade: '初三', duration_secs: 2700,
      mastered: ['求根公式'], weak_points: ['判别式'], homework: ['习题 1-5'], comment: '思路清晰，注意符号',
      error_causes: [
        { cause: 'careless', topic: '配方法', detail: '移项后常数项算成 -5，应为 3', fix: '每步代回验算' },
        { cause: 'reading', topic: '应用题', detail: '漏看"至少"', fix: '先划条件再动笔' },
      ], created_at: '2026-09-20T10:00:00Z' },
    { id: 2, course_title: '判别式与韦达定理', subject: '数学', grade: '初三', duration_secs: 2400,
      mastered: ['判别式'], weak_points: ['韦达定理'], homework: ['3 题'],
      error_causes: [
        { cause: 'concept', topic: '判别式', detail: '把判别式与韦达定理记混', fix: '放在一起对比辨析' },
        { cause: 'knowledge', topic: '韦达定理', detail: '公式记不住', fix: '重讲推导' },
      ], comment: '比上次进步', created_at: '2026-09-18T10:00:00Z' },
  ],
};

const PROBE = `(function(){
  var W = window;
  W.state.user = { id: 'u1', email: 'demo@example.com' };
  W.state.memLoaded = true;
  W.state.mem = ${JSON.stringify(SAMPLE)};
  if (W.switchView) W.switchView('memory');
  var q = function(s){ return document.querySelector(s); };
  var qa = function(s){ return document.querySelectorAll(s); };
  var box = q('#mem-causes');
  var rb = box ? box.getBoundingClientRect() : null;
  var bars = qa('#mem-causes .ep-bar-fill');
  var barW = [];
  bars.forEach(function(b){ barW.push(Math.round(b.getBoundingClientRect().width)); });
  var labels = [];
  qa('#mem-causes .ep-bar-label').forEach(function(l){ labels.push(l.textContent.trim()); });
  var nums = [];
  qa('#mem-causes .ep-bar-num').forEach(function(l){ nums.push(l.textContent.trim()); });
  var fill = q('#mem-causes .ep-bar-fill.e-careless');
  var verdict = q('#mem-causes .ep-verdict');
  var causeItem = q('#mem-causes .cause-item') || q('.sess-causes .cause-item');
  var cs = causeItem ? getComputedStyle(causeItem) : null;
  return JSON.stringify({
    viewActive: q('#view-memory').classList.contains('active'),
    causesBoxW: rb ? Math.round(rb.width) : 0,
    causesBoxH: rb ? Math.round(rb.height) : 0,
    epoxy: qa('#mem-causes .ep-topic').length,
    barCount: bars.length,
    barWidths: barW,
    barLabels: labels,
    barNums: nums,
    carelessColor: fill ? getComputedStyle(fill).backgroundColor : '',
    hasVerdict: !!verdict,
    verdict: verdict ? verdict.textContent.slice(0, 80) : '',
    sessCauseBlocks: qa('.sess-causes').length,
    causeItemsInSess: qa('.sess-causes .cause-item').length,
    causeLeftBorder: cs ? cs.borderLeftColor : '',
    masteryItems: qa('#mem-mastery .mastery-item').length,
    summaryHasCauses: (function(){
      try {
        W.renderSummary({ mastered:['配方法'], weakPoints:['判别式'], homework:['1-5'],
          errorCauses:[{cause:'careless',topic:'配方法',detail:'符号写错',fix:'代回验算'}], comment:'ok' }, null, null, {});
        return { block: qa('#summary-body .sum-causes').length, items: qa('#summary-body .sum-causes .cause-item').length };
      } catch (e) { return { err: String(e && e.message) }; }
    })(),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyInk: getComputedStyle(document.body).color,
    /* ---- 起点画像卡（学习档案页，同样默认隐藏，必须先显出来再量） ---- */
    memDiag: (function(){
      var d = q('#mem-diag');
      if (!d) return { missing: true };
      var r = d.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        topics: qa('#mem-diag .md-topic').length,
        stats: qa('#mem-diag .md-stat').length,
        hasHint: !!q('#mem-diag .md-hint'),
        overall: (q('#mem-diag .md-overall') || {}).textContent || '',
      };
    })(),
    /* ---- 入学诊断：把答题区真正渲染出来量一遍（默认 hidden，rect 全是 0） ---- */
    diagPanel: (function(){
      try {
        var p = W.cleanDiagnostic({ title: '课前诊断', intro: '这不是考试，只是想知道你从哪里开始。', items: [
          { topic: '配方法', type: 'choice', question: 'x²+2x-3=0 配方后是哪个？', options: ['A. (x+1)²=4','B. (x+2)²=4','C. (x-1)²=4','D. (x-2)²=4'], answer: 'A', why: '符号记混' },
          { topic: '判别式', type: 'choice', question: 'x²+x+1=0 有几个实根？', options: ['A. 2 个','B. 1 个','C. 0 个','D. 无法确定'], answer: 'C' },
          { topic: '韦达定理', type: 'short', question: '写出两根之和关于系数的表达式', options: [], answer: 'x1+x2 = -b/a' },
          { topic: '因式分解', type: 'choice', question: 'x²-4 分解结果是？', options: ['A. (x-2)²','B. (x+2)(x-2)','C. (x+4)(x-1)','D. 不能分解'], answer: 'B' },
          { topic: '求根公式', type: 'choice', question: 'x²-5x+6=0 的两根是？', options: ['A. 2 和 3','B. 1 和 6','C. -2 和 -3','D. 5 和 6'], answer: 'A' },
        ]}, { subject: '数学', system: 'cn' });
        W.diagState.paper = p; W.diagState.answers = { 0: { value: 'A' }, 1: { value: 'A' }, 2: { value: '', self: '' }, 3: { value: 'B' }, 4: { value: 'A' } };
        if (W.switchView) W.switchView('generate');
        W.renderDiagnostic();
        var box = q('#gen-diag');
        var br = box ? box.getBoundingClientRect() : null;
        var item = q('#gen-diag .diag-item');
        var opt = q('#gen-diag .diag-opt');
        var ta = q('#gen-diag .diag-open');
        var progress = q('#diag-prog');
        var out = {
          visible: box ? !box.hidden : false,
          w: br ? Math.round(br.width) : 0,
          items: qa('#gen-diag .diag-item').length,
          opts: qa('#gen-diag .diag-opt').length,
          textareas: qa('#gen-diag .diag-open').length,
          selfRadios: qa('#gen-diag .diag-self input').length,
          progress: progress ? progress.textContent.trim() : '',
          itemW: item ? Math.round(item.getBoundingClientRect().width) : 0,
          optW: opt ? Math.round(opt.getBoundingClientRect().width) : 0,
          optH: opt ? Math.round(opt.getBoundingClientRect().height) : 0,
          taW: ta ? Math.round(ta.getBoundingClientRect().width) : 0,
        };
        // 提交 → 起点画像
        W.submitDiagnostic();
        var dp = q('#gen-diag .dp-wrap');
        var dr = dp ? dp.getBoundingClientRect() : null;
        out.profile = {
          rendered: !!dp,
          w: dr ? Math.round(dr.width) : 0,
          stats: qa('#gen-diag .dp-stat').length,
          statNums: (function(){ var a = []; qa('#gen-diag .dp-stat b').forEach(function(b){ a.push(b.textContent.trim()); }); return a; })(),
          focusRows: qa('#gen-diag .dp-block .dp-topic').length,
          skips: qa('#gen-diag .dp-skip').length,
          hasVerdict: !!q('#gen-diag .dp-verdict'),
          verdictText: (q('#gen-diag .dp-verdict') || {}).textContent ? q('#gen-diag .dp-verdict').textContent.slice(0, 60) : '',
          listHidden: !!(q('#gen-diag .diag-list') && q('#gen-diag .diag-list').hidden),
          // 每个统计块的实际宽度：太窄会把「已掌握/待确认」挤成竖排
          statW: (function(){ var a = []; qa('#gen-diag .dp-stat').forEach(function(s){ a.push(Math.round(s.getBoundingClientRect().width)); }); return a; })(),
          topicRowH: (function(){ var a = []; qa('#gen-diag .dp-topic').forEach(function(s){ a.push(Math.round(s.getBoundingClientRect().height)); }); return a; })(),
        };
        return out;
      } catch (e) { return { err: String(e && e.message) }; }
    })(),
  });
})()`;

(async () => {
  await new Promise((r) => server.listen(8099, '127.0.0.1', r));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--window-size=1280,900',
    '--user-data-dir=' + path.join(os.tmpdir(), 'lx-probe-' + Date.now()),
    'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await get('http://127.0.0.1:' + PORT + '/json'); if (targets.length) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!targets || !targets.length) { console.log('Chrome 未就绪'); process.exit(1); }
  // 必须挑到真正的页面 target：/json 里还会混进扩展的 background page
  // （chrome-extension://… ），连上去执行脚本会报一堆莫名其妙的 TypeError
  const page = targets.find((x) => x.type === 'page' && !/^(chrome|devtools|chrome-extension)/.test(x.url || ''))
    || targets.find((x) => x.type === 'page');
  if (!page) { console.log('找不到页面 target：' + JSON.stringify(targets.map((x) => x.url))); process.exit(1); }

  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  const send = (method, params) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pend[j.id]) { pend[j.id](j); delete pend[j.id]; } });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8099/' });
  await new Promise((r) => setTimeout(r, 2500));

  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: false });
  const res = r.result || {};
  if (res.exceptionDetails || !res.result || res.result.value === undefined) {
    console.log('--- 页面执行异常，下面是诊断信息 ---');
    console.log(JSON.stringify(res, null, 2).slice(0, 3000));
    // 看一下页面本身是不是加载成功、app.js 有没有跑起来
    const diag = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        url: location.href,
        hasJquery: typeof window.state,
        stateCloud: !!(window.state && window.state.cloud),
        memBody: !!document.querySelector('#mem-body'),
        causes: !!document.querySelector('#mem-causes'),
        switchView: typeof window.switchView,
        renderMemoryView: typeof window.renderMemoryView,
        lastErr: window.__probeErr || null
      })`,
      returnByValue: true,
    });
    console.log(diag.result && diag.result.result && diag.result.result.value);
    ws.close(); chrome.kill(); server.close();
    process.exit(1);
  }
  const val = res.result.value;
  const out = JSON.stringify(JSON.parse(val), null, 2);
  console.log(out);
  fs.writeFileSync(path.join(__dirname, 'layout-report.txt'), out, 'utf8');

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(path.join(__dirname, 'mem-causes-preview.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('\n截图 -> tests/mem-causes-preview.png');
  }

  ws.close(); chrome.kill(); server.close();
  process.exit(0);
})();
