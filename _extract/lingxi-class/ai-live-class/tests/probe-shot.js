/* 截图：小结弹窗里的错因分析区块 + 上课记录里的错因。
   用法：node tests/probe-shot.js */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = path.resolve(__dirname, '..');
const PORT = 9336;
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

const SESSIONS = [
  { id: 1, course_title: '一元二次方程（配方法）', subject: '数学', grade: '初三', duration_secs: 2700,
    mastered: ['求根公式', '因式分解'], weak_points: ['判别式的符号判断'], homework: ['习题 1-5（重点第 3 题）'],
    comment: '今天的思路很清楚，能把配方过程完整说出来。符号那一步的策略还有提升空间。',
    error_causes: [
      { cause: 'careless', topic: '配方法', detail: '移项后常数项算成 -5，正确应为 3', fix: '每一步移项后在草稿纸上单独核对符号，最后代回原式验算' },
      { cause: 'reading', topic: '应用题', detail: '漏看"至少"两个字，把不等式写成了等式', fix: '读题时先把条件逐条划出来、把问句圈出来，再动笔' },
    ], created_at: '2026-09-20T10:00:00Z' },
  { id: 2, course_title: '判别式与韦达定理', subject: '数学', grade: '初三', duration_secs: 2400,
    mastered: ['判别式'], weak_points: ['韦达定理'], homework: ['3 题'],
    error_causes: [
      { cause: 'concept', topic: '判别式', detail: '把判别式 Δ=b²-4ac 与韦达定理 x₁+x₂=-b/a 记混了', fix: '把两组公式放在一起列表对比，逐条写清各自用来解决什么问题' },
    ], comment: '比上次进步明显', created_at: '2026-09-18T10:00:00Z' },
];

(async () => {
  await new Promise((r) => server.listen(8099, '127.0.0.1', r));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--window-size=1180,1500',
    '--user-data-dir=' + path.join(os.tmpdir(), 'lx-shot-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await get('http://127.0.0.1:' + PORT + '/json'); if (targets.length) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const page = targets.find((x) => x.type === 'page' && !/^(chrome|devtools|chrome-extension)/.test(x.url || '')) || targets.find((x) => x.type === 'page');
  const WebSocket = require('ws');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  const send = (m, p) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pend[j.id]) { pend[j.id](j); delete pend[j.id]; } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8099/' });
  for (let i = 0; i < 40; i++) {
    const ck = await send('Runtime.evaluate', { expression: 'typeof window.renderSummary', returnByValue: true });
    if (ck.result && ck.result.result && ck.result.result.value === 'function') break;
    await new Promise((r) => setTimeout(r, 250));
  }

  // 1) 小结弹窗
  await send('Runtime.evaluate', { expression: `(function(){
    window.renderSummary({
      mastered: ['配方法', '求根公式'],
      weakPoints: ['判别式的符号判断'],
      homework: ['习题 1-5（重点第 3 题）', '把今天错的那道应用题重做一遍'],
      cards: [{ q: '配方法的第一步是什么？', a: '把二次项系数化为 1，再把常数项移到等号右边。' },
              { q: '判别式 Δ>0 说明什么？', a: '方程有两个不相等的实数根。' }],
      reviewPlan: ['今晚：重做课堂错题', '明天：复习配方步骤', '三天后：做 3 道判别式题', '一周后：综合小测'],
      errorCauses: [
        { cause: 'careless', topic: '配方法', detail: '移项后常数项算成 -5，正确应为 3', fix: '每一步移项后在草稿纸上单独核对符号，最后代回原式验算' },
        { cause: 'reading', topic: '应用题', detail: '漏看"至少"两个字，把不等式写成了等式', fix: '读题时先把条件逐条划出来、把问句圈出来，再动笔' },
      ],
      comment: '今天的思路很清楚，能把配方过程完整说出来。符号那一步的策略还有提升空间。',
    }, null, null, { id: 'c1', title: '一元二次方程' });
    document.querySelector('#summary-modal').hidden = false;
    document.querySelector('#summary-body').scrollTop = 0;
  })()`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 600));
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(path.join(__dirname, 'shot-summary-causes.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('小结弹窗截图 -> tests/shot-summary-causes.png');
  }

  // 2) 学习档案页的上课记录（含错因）
  await send('Runtime.evaluate', { expression: `(function(){
    document.querySelector('#summary-modal').hidden = true;
    var W = window;
    W.state.user = { id: 'u1', email: 'demo@example.com' };
    W.state.memLoaded = true;
    W.state.mem = { profile: null, facts: [], sessions: ${JSON.stringify(SESSIONS)} };
    document.querySelectorAll('.view').forEach(function(x){ x.classList.remove('active'); });
    document.querySelector('#view-memory').classList.add('active');
    document.querySelector('#mem-body').hidden = false;
    document.querySelector('#mem-gate').hidden = true;
    W.renderMemoryView();
    // 滚动到上课记录
    var s = document.querySelector('#mem-sessions');
    s.scrollIntoView({ block: 'start' });
  })()`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 600));
  shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(path.join(__dirname, 'shot-session-causes.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('上课记录截图 -> tests/shot-session-causes.png');
  }

  ws.close(); chrome.kill(); server.close(); process.exit(0);
})();
