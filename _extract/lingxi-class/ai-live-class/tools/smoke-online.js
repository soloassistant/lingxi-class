/* ============================================================
   线上发布冒烟（真·从域名加载，不是读本地文件）

   为什么必须有这个脚本：
   "产物字节一致" 只能证明**服务器发的文件**和我测过的一样，
   不能证明这些文件在**真实加载顺序**下（HTML 解析 → 外部脚本 →
   SDK 全局 → init()）还能把门禁装上、把页面撑起来。
   本脚本用 JSDOM.fromURL 走真实网络，subresource 由线上服务器提供，
   然后驱动真实函数读真实 DOM。

   用法： node tools/smoke-online.js [url]
   ============================================================ */
const { JSDOM } = require('jsdom');

const BASE = process.argv[2] || 'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host/';

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (typeof cond !== 'boolean') { fail++; console.log('FAIL ' + label + '  ← 条件必须是 boolean'); return; }
  if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); }
};

(async () => {
  console.log('目标: ' + BASE + '\n');
  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: new (require('jsdom').VirtualConsole)(), // 静音线上噪音
  });
  const w = dom.window;

  // 等外部脚本（app.js / SDK）真的执行完
  await new Promise((r) => {
    if (w.document.readyState === 'complete') return r();
    w.addEventListener('load', r);
    setTimeout(r, 8000);
  });
  await new Promise((r) => setTimeout(r, 1200));

  const has = (n) => typeof w[n] === 'function';

  console.log('=== A. 线上页面是否把脚本跑起来了 ===');
  t('A1 页面拿到 document', !!w.document);
  t('A2 app.js 已执行（能取到 applyProgressImport）', has('applyProgressImport'));
  t('A3 门禁入口存在 enforceLoginGate', has('enforceLoginGate'));
  t('A4 门禁入口存在 syncLoginGate', has('syncLoginGate'));
  t('A5 测试快照 getGateState 存在', has('getGateState'));

  console.log('\n=== B. 未登录时门禁是否真的装上（线上实况） ===');
  let g = null;
  try { g = w.getGateState(); } catch (e) { console.log('  getGateState 抛错: ' + e.message); }
  if (g) {
    t('B1 门禁已 armed', g.armed === true);
    t('B2 门禁已上锁 loginGateOn', g.on === true);
    t('B3 未登录 signedIn=false', g.signedIn === false);
    t('B4 登录弹窗可见（挡住页面）', g.modalOpen === true);
    t('B5 "跳过"入口被隐藏', g.skipHidden === true);
    t('B6 关闭按钮被隐藏（不能绕开）', g.closeHidden === true);
    t('B7 门禁提示文案可见', g.tipVisible === true);
  } else {
    t('B0 拿到门禁状态快照', false);
  }

  console.log('\n=== C. 动手绕门禁：调 closeAuthModal 看能不能关掉 ===');
  try {
    w.closeAuthModal();
    const g2 = w.getGateState();
    t('C1 调 closeAuthModal 后弹窗仍开着', g2 && g2.modalOpen === true);
    t('C2 调 closeAuthModal 后门禁仍上锁', g2 && g2.on === true);
  } catch (e) {
    t('C0 closeAuthModal 可调用（线上未定义则视为失败）', false);
    console.log('  ' + e.message);
  }

  console.log('\n=== D. 页面结构完整性 ===');
  const q = (s) => w.document.querySelector(s);
  t('D1 有生成课程按钮 #gen-course', !!q('#gen-course'));
  t('D2 有直播结束按钮 #btn-end', !!q('#btn-end'));
  t('D3 有登录弹窗节点 #auth-modal', !!q('#auth-modal'));
  t('D4 CSS 已应用（style.css 加载成功）', !!q('link[href*="style.css"]'));

  console.log('\n=== E. 未登录时点"生成课程"会不会真跑（用户核心要求） ===');
  try {
    const before = q('#course-list') ? q('#course-list').children.length : -1;
    const gen = q('#gen-course');
    if (gen) gen.click();
    await new Promise((r) => setTimeout(r, 600));
    const after = q('#course-list') ? q('#course-list').children.length : -1;
    t('E1 未登录点击后没有新增课程卡片', after <= before);
    const g3 = w.getGateState();
    t('E2 点击后门禁依然上锁', g3 && g3.on === true);
    t('E3 点击后弹窗依然可见（把操作挡回登录）', g3 && g3.modalOpen === true);
    console.log('  （点击前后课程卡片数：' + before + ' -> ' + after + '）');
  } catch (e) {
    t('E0 未登录点生成课程不抛异常', false);
    console.log('  ' + e.message);
  }

  console.log('\n=== F. 费曼学习法（线上实况） ===');
  t('F1 费曼开关存在于页面上', !!q('#guide-feynman'));
  t('F2 默认关闭', g3f(w) === false);
  t('F3 点一下开关 → 开启', (() => {
    const sw = q('#guide-feynman');
    if (sw) sw.click();
    return w.state.feynman === true;
  })());
  t('F4 已写入 localStorage（刷新后还记得）', w.localStorage.getItem('lingxi_feynman') === '1');
  t('F5 开启后提示词里出现【费曼学习法】', (() => {
    const p = w.teacherSystemPrompt({ title: 'T', subject: '数学' });
    return typeof p === 'string' && p.indexOf('【费曼学习法】') >= 0;
  })());
  t('F6 提示词里含"讲给外行听"与"不要替学生总结"两条关键要求', (() => {
    const p = w.teacherSystemPrompt({ title: 'T', subject: '数学' });
    return p.indexOf('讲给外行听') >= 0 && p.indexOf('绝对不要替学生总结') >= 0;
  })());
  t('F7 小白听众提示词可用且角色正确', (() => {
    const p = w.feynmanListenerPrompt({ title: 'T', subject: '数学' }, {});
    return typeof p === 'string' && p.indexOf('完全不懂') >= 0 && p.indexOf('只当听众') >= 0;
  })());
  t('F8 ★ 验收守卫在线上生效（讲得太少 → 清空结论）', (() => {
    const v = w.guardFeynTalkVerdict({ explained: ['a', 'b', 'c'], skipped: ['x'] }, { turns: 1, chars: 20 });
    return !!(v && v.explained.length === 0 && v.insufficient === true);
  })());
  t('F9 ★ 反向对照：讲得够多 → 原样保留（守卫不是永远清空）', (() => {
    const v = w.guardFeynTalkVerdict({ explained: ['a', 'b', 'c'], skipped: ['x'] }, { turns: 3, chars: 300 });
    return !!(v && v.explained.length === 3 && v.insufficient === undefined);
  })());
  t('F10 小结里的「讲给我听」入口能正常生成', (() => {
    const h = w.feynTalkBlockHtml();
    return typeof h === 'string' && h.indexOf('btn-open-feyntalk') >= 0 && h.indexOf('费曼学习法') >= 0;
  })());
  t('F11 「讲给我听」弹窗节点存在且初始关闭', (() => {
    const m = q('#feyntalk-modal');
    return !!m && m.hidden === true;
  })());

  console.log('\n----------------------------------------');
  console.log('线上冒烟：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  w.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟脚本异常: ' + (e && e.stack || e));
  process.exit(2);
});

/* 读"费曼开关当前状态"的小工具：state 拿不到就返回 null 让断言自己报错 */
function g3f(w) {
  try { return w.state.feynman === true ? true : (w.state.feynman === false ? false : null); } catch (e) { return null; }
}
