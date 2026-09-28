/* 错因分布条在"严重偏斜"数据下是否真的能区分开？
   这是本轮唯一需要专门验的视觉逻辑：如果任何数据都得到等宽条，
   这个图就是装饰品 —— 得让 5 个知识点里的 4 个都是计算失误，条才该明显更长。
   用法：node tests/probe-skew.js */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = path.resolve(__dirname, '..');
const PORT = 9334;

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

/* 偏斜样本：6 个出错知识点
   careless 覆盖 5 个（共 11 次）→ 应是最长条
   reading  覆盖 2 个            → 约 33%
   knowledge 覆盖 1 个           → 约 17%
   concept  不出现               → 整条不渲染 */
const SESSIONS = [
  { subject: '数学', error_causes: [
    { cause: 'careless', topic: '配方法' }, { cause: 'careless', topic: '配方法' }, { cause: 'careless', topic: '配方法' },
    { cause: 'careless', topic: '移项' }, { cause: 'reading', topic: '应用题' } ] },
  { subject: '数学', error_causes: [
    { cause: 'careless', topic: '鉴别式' }, { cause: 'careless', topic: '鉴别式' },
    { cause: 'careless', topic: '因式分解' }, { cause: 'careless', topic: '因式分解' },
    { cause: 'careless', topic: '二次函数图像' }, { cause: 'reading', topic: '单位换算' } ] },
  { subject: '数学', error_causes: [ { cause: 'knowledge', topic: '韦达定理' } ] },
];

(async () => {
  await new Promise((r) => server.listen(8099, '127.0.0.1', r));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--window-size=1280,900',
    '--user-data-dir=' + path.join(os.tmpdir(), 'lx-skew-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

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
  // 等 app.js 真正执行完（它是同步脚本，但网络取回 HTML/JS 有先后）
  for (let i = 0; i < 40; i++) {
    const ck = await send('Runtime.evaluate', { expression: 'typeof window.renderErrorProfile', returnByValue: true });
    if (ck.result && ck.result.result && ck.result.result.value === 'function') break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const expr = `(function(){
    var W = window;
    // ★ 必须先把视图和容器显出来再量尺寸。
    //   学习档案页默认是 display:none + hidden，隐藏元素所有 getBoundingClientRect
    //   都是 0 —— 会把"百分比宽度算得对不对"误判成"图是装饰品"。
    W.state.user = { id: 'u1', email: 'demo@example.com' };
    W.state.memLoaded = true;
    W.state.mem = { profile: null, facts: [], sessions: [] };
    var v = document.querySelector('#view-memory');
    document.querySelectorAll('.view').forEach(function(x){ x.classList.remove('active'); });
    v.classList.add('active');
    document.querySelector('#mem-body').hidden = false;
    document.querySelector('#mem-gate').hidden = true;

    W.renderErrorProfile(${JSON.stringify(SESSIONS)});
    var out = [];
    document.querySelectorAll('#mem-causes .ep-bar-row').forEach(function(r){
      var lab = r.querySelector('.ep-bar-label').textContent.trim();
      var f = r.querySelector('.ep-bar-fill');
      var w = Math.round(f.getBoundingClientRect().width);
      var num = r.querySelector('.ep-bar-num').textContent.trim();
      var aria = r.querySelector('.ep-bar-track').getAttribute('aria-label');
      out.push({ label: lab, w: w, pct: f.style.width, n: num, aria: aria,
                 trackW: Math.round(r.querySelector('.ep-bar-track').getBoundingClientRect().width) });
    });
    return JSON.stringify({
      bars: out,
      topics: Array.prototype.map.call(document.querySelectorAll('#mem-causes .ep-topic-name'), function(e){return e.textContent.trim();}),
      verdict: (document.querySelector('#mem-causes .ep-verdict')||{}).textContent || '',
      hint: (document.querySelector('#mem-causes .ep-bars-hint')||{}).textContent || '',
      elW: Math.round(document.querySelector('#mem-causes').getBoundingClientRect().width),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    });
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) { console.log('异常:', JSON.stringify(res).slice(0, 1500)); process.exit(1); }
  const d = JSON.parse(res.result.value);
  console.log(JSON.stringify(d, null, 2));

  const ws2 = d.bars.map((b) => b.w);
  const max = Math.max.apply(null, ws2);
  console.log('\n--- 判定 ---');
  console.log('容器宽度:', d.elW, '| 各条百分比:', d.bars.map((b) => b.pct).join(' / '));
  console.log('各条实宽:', ws2.join(' / '), '（轨道宽', d.bars[0].trackW + '）');
  console.log('宽度是否各不相同:', new Set(ws2).size > 1 ? '是（图有区分度）' : '否（图是装饰品）');
  console.log('最宽条是否 = 计算失误:', d.bars[ws2.indexOf(max)].label.indexOf('计算失误') >= 0 ? '是' : '否');
  console.log('concept 未出现 → 整条隐藏:', !d.bars.some((b) => b.label.indexOf('概念混淆') >= 0) ? '是' : '否');
  console.log('横向溢出:', d.overflowX ? '有（需修）' : '无');

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(path.join(__dirname, 'mem-causes-skew.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('截图 -> tests/mem-causes-skew.png');
  }
  ws.close(); chrome.kill(); server.close(); process.exit(0);
})();
