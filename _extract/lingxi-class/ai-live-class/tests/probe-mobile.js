/* 手机端布局验证：分布条在 375px 宽下是否还能看清、有没有横向溢出。
   背景：.ep-bar-label 固定 100px + 数字列，窄屏会把条形挤成几乎不可见。
   用法：node tests/probe-mobile.js */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = path.resolve(__dirname, '..');
const PORT = 9335;
const VW = Number(process.argv[2] || 375);
const VH = Number(process.argv[3] || 780);

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

/* 偏斜样本：4 类都出现，便于同时看四色的可读性 */
const SESSIONS = [
  { subject: '数学', course_title: '一元二次方程', mastered: ['求根公式'], weak_points: ['配方法'],
    homework: ['练习 3 题'], duration_secs: 3600,
    error_causes: [
      { cause: 'careless', topic: '配方法', detail: '移项时符号写错', fix: '每一步都代回检验' },
      { cause: 'knowledge', topic: '韦达定理' } ] },
  { subject: '数学', course_title: '几何证明', mastered: [], weak_points: ['辅助线'],
    homework: ['证明 2 题'], duration_secs: 2700,
    error_causes: [
      { cause: 'reading', topic: '应用题', detail: '漏看了"取整数解"' },
      { cause: 'concept', topic: '相似与全等' } ] },
];

(async () => {
  await new Promise((r) => server.listen(8098, '127.0.0.1', r));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--window-size=' + VW + ',' + VH,
    '--user-data-dir=' + path.join(os.tmpdir(), 'lx-mob-' + Date.now()), 'about:blank'], { stdio: 'ignore' });

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
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:8098/' });
  for (let i = 0; i < 40; i++) {
    const ck = await send('Runtime.evaluate', { expression: 'typeof window.renderErrorProfile', returnByValue: true });
    if (ck.result && ck.result.result && ck.result.result.value === 'function') break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const expr = `(function(){
    var W = window;
    W.state.user = { id:'u1', email:'demo@example.com' };
    W.state.memLoaded = true;
    W.state.mem = { profile:null, facts:[], sessions: [] };
    var v = document.querySelector('#view-memory');
    document.querySelectorAll('.view').forEach(function(x){ x.classList.remove('active'); });
    v.classList.add('active');
    document.querySelector('#mem-body').hidden = false;
    document.querySelector('#mem-gate').hidden = true;
    W.state.courses = [];
    W.state.mem.sessions = ${JSON.stringify(SESSIONS)};
    W.renderErrorProfile(${JSON.stringify(SESSIONS)});
    W.renderMemoryView();

    var rows = [];
    document.querySelectorAll('#mem-causes .ep-bar-row').forEach(function(r){
      var lb = r.querySelector('.ep-bar-label');
      var tk = r.querySelector('.ep-bar-track');
      var f  = r.querySelector('.ep-bar-fill');
      rows.push({
        label: lb.textContent.trim(),
        labelW: Math.round(lb.getBoundingClientRect().width),
        trackW: Math.round(tk.getBoundingClientRect().width),
        fillW : Math.round(f.getBoundingClientRect().width),
        rowH  : Math.round(r.getBoundingClientRect().height),
        sameLine: Math.abs(lb.getBoundingClientRect().top - tk.getBoundingClientRect().top) < 4
      });
    });
    // 每类错因卡的宽度是否超出容器
    var cardW = Math.round(document.querySelector('#mem-causes').getBoundingClientRect().width);
    var over = document.documentElement.scrollWidth > window.innerWidth + 1;
    // 找出所有横向溢出的元素
    var offenders = [];
    document.querySelectorAll('#view-memory *').forEach(function(e){
      var r = e.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1) {
        offenders.push(e.className + ' right=' + Math.round(r.right));
      }
    });
    /* --- 入学诊断：窄屏下选项/文本框/画像是否还能点、还看得清 --- */
    var diag = (function(){
      try {
        var p = W.cleanDiagnostic({ title:'课前诊断', intro:'这不是考试，只是想知道你从哪里开始。', items: [
          { topic:'配方法', type:'choice', question:'x²+2x-3=0 配方后是哪个？', options:['A. (x+1)²=4','B. (x+2)²=4','C. (x-1)²=4','D. (x-2)²=4'], answer:'A' },
          { topic:'判别式', type:'choice', question:'x²+x+1=0 有几个实根？', options:['A. 2 个','B. 1 个','C. 0 个','D. 无法确定'], answer:'C' },
          { topic:'韦达定理', type:'short', question:'写出两根之和关于系数的表达式', options:[], answer:'x1+x2 = -b/a' },
          { topic:'因式分解', type:'choice', question:'x²-4 分解结果是？', options:['A. (x-2)²','B. (x+2)(x-2)','C. (x+4)(x-1)','D. 不能分解'], answer:'B' },
          { topic:'求根公式', type:'choice', question:'x²-5x+6=0 的两根是？', options:['A. 2 和 3','B. 1 和 6','C. -2 和 -3','D. 5 和 6'], answer:'A' },
        ]}, { subject:'数学', system:'cn' });
        W.diagState.paper = p;
        W.diagState.answers = { 0:{value:'A'}, 1:{value:'A'}, 2:{value:'', self:''}, 3:{value:'B'}, 4:{value:'A'} };
        document.querySelectorAll('.view').forEach(function(x){ x.classList.remove('active'); });
        document.querySelector('#view-generate').classList.add('active');
        W.renderDiagnostic();
        var box = document.querySelector('#gen-diag');
        // ★ 先量答题区（提交后 .diag-list 会被 hidden，隐藏元素 rect 全 0，
        //   会把"选项点不点得中"误判成 0px）
        var opt = document.querySelector('#gen-diag .diag-opt');
        var ta  = document.querySelector('#gen-diag .diag-open');
        var self1 = document.querySelector('#gen-diag .diag-self label');
        var mOptW = opt ? Math.round(opt.getBoundingClientRect().width) : 0;
        var mOptH = opt ? Math.round(opt.getBoundingClientRect().height) : 0;
        var mTaW  = ta ? Math.round(ta.getBoundingClientRect().width) : 0;
        var mSelfW = self1 ? Math.round(self1.getBoundingClientRect().width) : 0;
        var listW = (function(){ var l = document.querySelector('#gen-diag .diag-list'); return l ? Math.round(l.getBoundingClientRect().width) : 0; })();

        W.submitDiagnostic();
        var histW = [];
        document.querySelectorAll('#gen-diag .dp-stat').forEach(function(s){ histW.push(Math.round(s.getBoundingClientRect().width)); });
        var dOff = [];
        document.querySelectorAll('#gen-diag *').forEach(function(e){
          var r = e.getBoundingClientRect();
          if (r.width > 0 && r.right > window.innerWidth + 1) dOff.push(e.className + ' right=' + Math.round(r.right));
        });
        return {
          panelW: Math.round(box.getBoundingClientRect().width),
          listW: listW,
          optW: mOptW,
          optH: mOptH,
          taW : mTaW,
          selfLabelW: mSelfW,
          statW: histW,
          statMinW: histW.length ? Math.min.apply(null, histW) : 0,
          skipChips: document.querySelectorAll('#gen-diag .dp-skip').length,
          actionsStacked: (function(){
            var a = document.querySelectorAll('#gen-diag .dp-actions .btn');
            if (a.length < 2) return null;
            return Math.abs(a[0].getBoundingClientRect().top - a[1].getBoundingClientRect().top) > 4;
          })(),
          offenders: dOff.slice(0, 6),
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      } catch (e) { return { err: String(e && e.message) }; }
    })();

    return JSON.stringify({
      vw: window.innerWidth, cardW: cardW, rows: rows, overflowX: over,
      offenders: offenders.slice(0, 6),
      causeCards: document.querySelectorAll('#mem-causes .cause-item').length,
      sessCauses : document.querySelectorAll('#view-memory .sess-causes .cause-item').length,
      diag: diag
    });
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) { console.log('异常:', JSON.stringify(res).slice(0, 1500)); process.exit(1); }
  const d = JSON.parse(res.result.value);
  console.log('视口宽:', d.vw, '| 错因卡宽:', d.cardW);
  console.log('\n--- 分布条 ---');
  d.rows.forEach((x) => {
    console.log('  ' + x.label.padEnd(12) +
      ' 标签' + String(x.labelW).padStart(4) + 'px' +
      ' 轨道' + String(x.trackW).padStart(4) + 'px' +
      ' 实心' + String(x.fillW).padStart(4) + 'px' +
      ' 同行=' + (x.sameLine ? '是' : '否(换行)'));
  });
  console.log('\n--- 判定 ---');
  const trackMin = Math.min.apply(null, d.rows.map((x) => x.trackW));
  console.log('轨道最小宽度:', trackMin, trackMin >= 120 ? '✓ 条形可读' : '✗ 太窄，条形不可读');
  console.log('横向溢出:', d.overflowX ? '✗ 有' : '✓ 无');
  if (d.offenders.length) console.log('溢出元素:', d.offenders.join(' | '));
  console.log('小结/档案页错因卡数:', d.causeCards, '| 上课记录错因卡数:', d.sessCauses);

  console.log('\n--- 入学诊断（窄屏） ---');
  const dg = d.diag || {};
  if (dg.err) {
    console.log('  ✗ 诊断渲染异常:', dg.err);
  } else {
    console.log('  面板宽 ' + dg.panelW + 'px | 选项 ' + dg.optW + '×' + dg.optH +
      'px | 文本框宽 ' + dg.taW + 'px | 自评标签宽 ' + dg.selfLabelW + 'px');
    console.log('  四态统计块宽: ' + dg.statW.join(' / ') + ' → 最小 ' + dg.statMinW + 'px');
    console.log('  可跳过标签数: ' + dg.skipChips + ' | 按钮纵向堆叠: ' +
      (dg.actionsStacked === null ? 'n/a' : dg.actionsStacked ? '是' : '否'));
    // 触控目标 >= 40px 才不至于点不中（拇指友好）；统计块 < 56px 会把中文挤成竖排
    console.log('  选项高度:', dg.optH >= 40 ? '✓ ' + dg.optH + 'px 可点' : '✗ 仅 ' + dg.optH + 'px 太矮');
    console.log('  统计块:', dg.statMinW >= 56 ? '✓ 最窄 ' + dg.statMinW + 'px 不挤' : '✗ 仅 ' + dg.statMinW + 'px 会挤成竖排');
    console.log('  诊断区横向溢出:', dg.overflowX ? '✗ 有' : '✓ 无');
    if (dg.offenders && dg.offenders.length) console.log('  溢出元素:', dg.offenders.join(' | '));
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  if (shot.result && shot.result.data) {
    const out = path.join(__dirname, 'mem-mobile-' + VW + '.png');
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('截图 -> ' + path.relative(DIR, out));
  }
  ws.close(); chrome.kill(); server.close(); process.exit(0);
})();
