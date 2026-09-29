/* ============================================================
   登录门禁 · 增量分句 · 报错文案 —— **行为**回归测试

   为什么要单独建这个文件（两份独立审查都点了同一个问题）：
   原有的 GK1–GK9 / CN1–CN3 / AC1–AC5 断言全部形如
     t('GK1 …', /let loginGateOn = false;/.test(srcTR))
   也就是**在源码里 grep 字符串**。这种断言测的是"我写下了这句话"，
   不是"这个行为发生了"。实测后果：把 closeAuthModal 的守卫删掉、
   把 enforceLoginGate 的调用点删掉、登出后不重新上锁 ——
   GK1–GK7 依然**全部通过**，1838 全绿什么都拦不住。

   本文件全部走真实函数调用 + 真实 DOM 断言：
   · 驱动 enforceLoginGate / authUI / closeAuthModal，直接读 #auth-modal.hidden
   · 调用 applyProgressImport，直接读 localStorage 里到底写没写进去
   · 调用 completeSentences，直接比对返回的句子数组

   起因清单（对应外部审查报告编号）：
   · R05 退出/会话失效后门禁不恢复 —— 本文件 G 组
   · R03 saveCourses 不存在、导入谎报成功 —— 本文件 P 组
   · R08 备份摘要完成率用错单位 —— 本文件 S 组
   · R06 英文句号不朗读 + 收尾丢尾段 —— 本文件 E 组
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

let pass = 0, fail = 0;
/* ★ 注意参数顺序是 **(标签, 条件)** —— 与其它测试文件的 t(条件, 标签) 相反。
   为什么故意反过来：本文件断言多、又长，写成"结论在前"好读。
   为什么必须加那道类型检查：我自己第一次写反了顺序（t('标签', 条件) 传进了 t(条件, 标签)），
   结果"条件"位置上永远是**非空字符串**（恒真），51 条断言**全部空过、显示全绿** ——
   正是本文件开头在批评的那种"假绿"。现在只要条件不是真正的 boolean 就直接判失败并说明原因。 */
const t = (label, cond) => {
  if (typeof cond !== 'boolean') {
    fail++;
    console.log('FAIL ' + label + '   ←  断言写法错误：条件必须是 boolean，实际收到 ' + typeof cond);
    return;
  }
  if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

const SITE = 'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host/';

/* 云服务桩：只提供"够跑通、不炸"的最小面。真实行为不在本文件验证。
   抽成函数是为了能开**第二个页面实例**（有些行为只在"首次加载"时发生一次，
   在同一个实例里复用会因为已经发生过而测不出来 —— 见 M1 组）。 */
function makeCloudStub() {
  const noopChain = () => ({
    select() { return this; }, limit() { return this; }, order() { return this; },
    eq() { return this; }, maybeSingle() { return this; }, update() { return this; },
    insert() { return this; }, upsert() { return this; }, delete() { return this; },
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
    catch: (r) => Promise.resolve({ data: [], error: null }).catch(r),
  });
  return {
    llm: {
      models: { list: async () => [{ id: 'm1', name: 'M1', disabled: false }] },
      chat: { completions: { create: () => ({ [Symbol.asyncIterator]() { let d = false; return { next: async () => d ? { done: true } : (d = true, { done: false, value: { choices: [{ delta: { content: '你好。' } }] } }) }; } }) } },
    },
    auth: {
      getSession: async () => ({ data: null, error: null }),
      getUser: async () => ({ data: null, error: { kind: 'unauthenticated' } }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => () => {},
    },
    database: { from: noopChain, rpc: async () => ({ data: null, error: null }) },
  };
}
/* 开一个全新的页面实例（干净的脚本作用域 + 干净的 localStorage） */
function freshApp() {
  const d = new JSDOM(html, { url: SITE, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = d.window;
  w.confirm = () => true; w.alert = () => {}; w.prompt = () => '确认注销';
  w.WorkBuddyCloud = { createWorkBuddyCloud: () => makeCloudStub() };
  return w;
}

/* 可记录的同步用云桩：要能**按操作类型**单独制造失败，
   否则没法验"删云端失败时墓碑要留着、但拉取仍然成功"这条守卫。 */
function makeSyncDb(initialRows) {
  const rec = {
    rows: (initialRows || []).slice(),
    inserts: [], updates: [], deletes: [],
    fail: { select: false, insert: false, update: false, delete: false },
  };
  const db = {
    from: () => {
      const p = { _op: 'select', _eq: null, _row: null, _patch: null };
      p.select = () => { p._op = 'select'; return p; };
      p.limit = () => p;
      p.order = () => p;
      p.eq = (k, v) => { p._eq = { k, v }; return p; };
      p.insert = (row) => { p._op = 'insert'; p._row = row; return p; };
      p.update = (patch) => { p._op = 'update'; p._patch = patch; return p; };
      p.delete = () => { p._op = 'delete'; return p; };
      const run = () => {
        if (rec.fail[p._op]) throw new Error('offline:' + p._op);
        if (p._op === 'insert') {
          rec.inserts.push(p._row);
          rec.rows.push({ id: 'row-' + p._row.course_id, course_id: p._row.course_id, data: p._row.data });
          return { data: [], error: null };
        }
        if (p._op === 'update') {
          rec.updates.push({ id: p._eq && p._eq.v, data: p._patch && p._patch.data });
          const r = rec.rows.find((x) => x.id === (p._eq && p._eq.v));
          if (r) r.data = p._patch.data;
          return { data: [], error: null };
        }
        if (p._op === 'delete') {
          rec.deletes.push(p._eq && p._eq.v);
          rec.rows = rec.rows.filter((x) => x.id !== (p._eq && p._eq.v));
          return { data: [], error: null };
        }
        return { data: rec.rows.map((x) => ({ id: x.id, course_id: x.course_id, data: x.data })), error: null };
      };
      p.then = (res, rej) => Promise.resolve().then(run).then(res, rej);
      p.catch = (rej) => Promise.resolve().then(run).catch(rej);
      return p;
    },
  };
  return { rec, db };
}

(async () => {
  const dom = new JSDOM(html, { url: SITE, runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  W.confirm = () => true;
  W.alert = () => {};

  W.WorkBuddyCloud = { createWorkBuddyCloud: () => makeCloudStub() };

  W.eval(appJs);
  W.prompt = () => '确认注销';        // jsdom 不实现 prompt，必须自己给
  await new Promise((r) => setTimeout(r, 30));   // 让 init() 里的微任务跑完

  const vis = (sel) => {
    const el = W.document.querySelector(sel);
    return !!(el && !el.hidden);
  };
  const realUser = { id: 'u-1', email: 'a@b.com', anonymous: false };

  /* ────────────────────────────────────────────────
     G 组：登录门禁必须"跟着身份走"，而不是只在启动时判一次
     ──────────────────────────────────────────────── */
  sec('G 组：门禁随身份变化（R05）');

  // G1 未登录 → 亮门禁：登录界面弹出、绕过入口全部藏掉
  W.state.user = null;
  W.enforceLoginGate();
  let g = W.getGateState();
  t('G1 未登录时门禁为开', g.on === true);
  t('G2 未登录时登录界面真的弹出来了（读 DOM，不是读源码）', vis('#auth-modal') === true);
  t('G3 门禁态下「先以访客身份继续」被隐藏', g.skipHidden === true);
  t('G4 门禁态下 ✕ 关闭按钮被隐藏', g.closeHidden === true);
  t('G5 门禁态下门禁说明可见', g.tipVisible === true);

  // G6 门禁期间关不掉（这就是"未登录不允许跑"的实质）
  W.closeAuthModal();
  t('G6 门禁期间调用关闭 → 登录界面仍然开着', vis('#auth-modal') === true);

  // G7 登录成功 → 解锁，且绕过入口恢复可用（普通弹窗又该能关了）
  W.state.user = { ...realUser };
  W.authUI();
  g = W.getGateState();
  t('G7 登录后门禁解除', g.on === false);
  t('G8 登录后 ✕ 恢复可用', g.closeHidden === false);
  W.closeAuthModal();
  t('G9 登录后登录界面可以正常关闭', vis('#auth-modal') === false);

  /* ★ G10–G12 是本组的核心：登出必须重新上锁。
     修复前 enforceLoginGate() 只在 init 的 finally 里被调一次，
     登出后 state.user=null 但门禁永远不再亮 —— 用户点一次"退出登录"，
     就能在未登录状态下把整节课跑完，与「未登录不允许跑」完全相反。 */
  W.state.user = null;
  W.authUI();                                   // doSignOut / SIGNED_OUT / healSession 都会走到这里
  g = W.getGateState();
  t('G10 ★ 登出后门禁重新上锁（R05 回归）', g.on === true);
  t('G11 ★ 登出后登录界面重新弹出', vis('#auth-modal') === true);
  t('G12 ★ 登出后「访客继续」又被隐藏', g.skipHidden === true);

  // G13 走真实的 doSignOut 路径（不只是手工改 state）
  W.state.user = { ...realUser };
  W.authUI();
  t('G13 前置：已登录时门禁是关的', W.getGateState().on === false);
  W.state.cloud = W.WorkBuddyCloud.createWorkBuddyCloud();
  await W.doSignOut();
  await new Promise((r) => setTimeout(r, 10));
  g = W.getGateState();
  t('G14 ★ 真实登出流程后门禁重新上锁', g.on === true && W.state.user === null);

  // G15 会话失效（凭据被判废）也要重新上锁
  W.state.user = { ...realUser };
  W.authUI();
  /* 注意桩的形状：isAuthError 认的是 `status:401/403`、`kind:'unauthenticated'`、
     或 `error.code === 'invalid_grant'` —— **顶层 `code` 字段它不认**。
     我第一次就传了 `{code:'invalid_grant'}`，结果 healSession 根本没进自愈分支，
     测试失败暴露了我对错误对象形状的假设是错的（这也是行为测试相对于 grep 的价值）。 */
  W.state.cloud.auth = {
    refreshSession: async () => ({ data: null, error: { kind: 'unauthenticated' } }),
    signOut: async () => ({ error: null }),
    getSession: async () => ({ data: null }),
    getUser: async () => ({ data: null, error: { kind: 'unauthenticated' } }),
    onAuthStateChange: () => () => {},
  };
  const healed = await W.healSession();
  await new Promise((r) => setTimeout(r, 10));
  t('G15 凭据失效被识别', healed === true);
  t('G16 ★ 会话失效后门禁重新上锁', W.getGateState().on === true);

  /* G17–G19 动作侧硬校验：门禁不能只靠"遮罩盖住按钮"。
     检查 agent 指出处理函数里原本没有任何判据 —— 只要有别的路径能触发 click 就形同虚设。 */
  W.state.user = null;
  t('G17 ★ 未登录时 requireSignedIn() 返回 false', W.requireSignedIn() === false);
  t('G18   并且它顺手把门禁又亮起来了（不给静默失败）', W.getGateState().on === true);
  W.state.user = { ...realUser };
  t('G19 已登录时 requireSignedIn() 返回 true', W.requireSignedIn() === true);

  /* ────────────────────────────────────────────────
     E 组：增量分句 —— 英文句号必须能切断（R06，直接决定"老师开不开口"）
     ──────────────────────────────────────────────── */
  sec('E 组：增量分句（R06）');

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  t('E1 中文句末照旧能切',
    eq(W.completeSentences('今天讲分数。先看这一页！'), ['今天讲分数。', '先看这一页！']));

  // ★ 这就是"英文课没声音"的根因：原来只认 。！？!?；;，句号结尾的英文一句都切不出来
  t('E2 ★ 英文句号能切句（修复前恒为空数组）',
    eq(W.completeSentences('This is a fraction. Now look at the circle.'), ['This is a fraction.', 'Now look at the circle.']));
  t('E3 ★ 纯英文讲解不再整段丢失',
    W.completeSentences('First we split the cake. Then we count the pieces. Finally we write it down.').length === 3);

  t('E4 小数点不会被当句末（3.14 是一句话里的数）',
    eq(W.completeSentences('圆周率约等于 3.14，记住这个数。'), ['圆周率约等于 3.14，记住这个数。']));
  t('E5 小数 + 英文句号混排时只切真正的句末',
    eq(W.completeSentences('Pi is 3.14 in value. Remember it.'), ['Pi is 3.14 in value.', 'Remember it.']));
  t('E6 常见缩写不当句末（Mr.）',
    eq(W.completeSentences('Hello Mr. Smith, welcome.'), ['Hello Mr. Smith, welcome.']));
  t('E7 常见缩写不当句末（e.g. / i.e.）',
    W.completeSentences('Use a tool, e.g. a ruler, here.').length === 1);
  t('E8 句号后紧跟字母不算句末（缩写中间的那个点）',
    W.completeSentences('See e.g. the note').length === 0);

  // 增量契约：不完整的尾巴必须留着，不能提前交付（否则会串音、重复朗读）
  t('E9 未闭合的尾巴不交付',
    eq(W.completeSentences('第一句好了。第二句还没写完'), ['第一句好了。']));
  t('E10 累积文本上反复调用是幂等的（增量朗读靠 length 计数）',
    W.completeSentences('A完成。B还没').length === 1 &&
    W.completeSentences('A完成。B还没').length === 1);

  // ★ 收尾补读：模型最后一句常常不打标点，原来被静默丢掉 → 最后几个字永远读不出来
  t('E11 ★ 补尾段：没打标点的收尾也要念出来（修复前被丢掉）',
    eq(W.sentencesWithTail('第一句。最后一句没有标点'), ['第一句。', '最后一句没有标点']));
  t('E12 已经全部闭合时补尾不重复',
    eq(W.sentencesWithTail('只有一句。'), ['只有一句。']));
  t('E13 scanSentences 同时给出 done 与 tail',
    (() => { const r = W.scanSentences('甲。乙未闭合'); return eq(r.done, ['甲。']) && r.tail === '乙未闭合'; })());
  t('E14 空输入不抛错',
    eq(W.completeSentences(''), []) && eq(W.completeSentences(null), []));

  /* ────────────────────────────────────────────────
     P 组：进度导入/撤销必须真的落盘（R03）
     ──────────────────────────────────────────────── */
  sec('P 组：导入/撤销真的写盘（R03）');

  W.localStorage.clear();
  W.state.courses = [];
  /* ★ 2026-09-29：课程现在落在**按账号命名**的键里（R01），
     断言跟着改成"读当前账号那个键"。判据本身（"真的写进了 localStorage，
     不是只在内存里"）没有放松一个字。 */
  const curCoursesKey = () => W.scopedContentKey(W.CONTENT_KEYS.courses);
  const inc = [{ id: 'c-inc-1', title: '导入的课', progress: 0.5, slides: [] }];
  const r1 = W.applyProgressImport({ data: { courses: inc, bank: [], prefs: {} } }, 'replace');
  t('P1 导入返回成功', r1 && r1.ok === true);
  // ★ 修复前：调的是不存在的 saveCourses()，异常被空 catch 吞掉，照样返回 ok:true，
  //   课程只在内存里 —— 刷新就没了。这里直接读 localStorage 定生死。
  t('P2 ★ 导入的课程真的写进了 localStorage（修复前只在内存）',
    /c-inc-1/.test(W.localStorage.getItem(curCoursesKey()) || ''));

  // 模拟"刷新页面"：清掉内存状态后再从 localStorage 读回来
  W.state.courses = [];
  W.loadCourses();
  t('P3 ★ 模拟刷新后课程仍在（修复前会消失）',
    W.state.courses.some((c) => c.id === 'c-inc-1'));

  // 撤销同样要落盘
  W.state.courses = [{ id: 'c-old-1', title: '旧课', progress: 0.1 }];
  W.applyProgressImport({ data: { courses: inc, bank: [], prefs: {} } }, 'replace');
  const r2 = W.undoProgressImport();
  t('P4 撤销返回成功', r2 && r2.ok === true);
  t('P5 ★ 撤销后的课程也真的落盘了', /c-old-1/.test(W.localStorage.getItem(curCoursesKey()) || ''));
  W.state.courses = [];
  W.loadCourses();
  t('P6 ★ 模拟刷新后撤销结果仍在', W.state.courses.some((c) => c.id === 'c-old-1'));

  /* ────────────────────────────────────────────────
     S 组：备份摘要的口径（R08）
     ──────────────────────────────────────────────── */
  sec('S 组：备份摘要口径（R08）');

  W.state.courses = [{ id: 'a', progress: 1, replay: { events: [{ t: 0 }] } }];
  let snap = W.buildProgressSnapshot();
  t('S1 ★ progress=1 记为"已完成"（修复前用 >=100 判断，恒为 0）', snap.summary.finished === 1);

  W.state.courses = [{ id: 'a', progress: 0.99 }, { id: 'b', progress: 0 }];
  snap = W.buildProgressSnapshot();
  t('S2 未满进度不算完成', snap.summary.finished === 0);

  W.state.courses = [{ id: 'a', progress: 1, replay: { events: [{ t: 0 }, { t: 1 }] } }, { id: 'b', progress: 0 }];
  snap = W.buildProgressSnapshot();
  t('S3 ★ 有回放的课计入课次（课程上没有 sessions 字段，修复前恒为 0）', snap.summary.sessions === 1);
  W.state.courses = [{ id: 'a', sessions: [{}, {}, {}] }];
  snap = W.buildProgressSnapshot();
  t('S4 有 sessions 字段时优先用它', snap.summary.sessions === 3);
  t('S5 摘要数字与实际课程数一致',
    (() => { W.state.courses = [{ id: 'x' }, { id: 'y' }]; return W.buildProgressSnapshot().summary.courses === 2; })());

  /* ────────────────────────────────────────────────
     C 组：endpoint 判定（含 file:// 兜底）
     ──────────────────────────────────────────────── */
  sec('C 组：endpoint 判定');

  // ★ 这是"没声音"的根因所在：endpoint 必须等于页面自己的 origin，否则跨源被 CORS 拦
  t('C1 ★ endpoint 等于页面 origin（同源，浏览器不做预检）',
    W.PUBLIC_CONFIG.endpoint === W.location.origin);
  t('C2 resolveCloudEndpoint 对 http(s) 原样返回',
    W.resolveCloudEndpoint('https://a.b') === 'https://a.b' && W.resolveCloudEndpoint('http://x.y') === 'http://x.y');
  // ★ file:// 下 location.origin 是**字符串 "null"**（真值！），旧代码会走 origin 分支
  //   把 endpoint:'null' 递给 SDK → 初始化抛错。必须排除。
  t('C3 ★ file:// 下的 "null" 不被当成有效 origin',
    W.resolveCloudEndpoint('null') === '' && W.resolveCloudEndpoint(null) === '' && W.resolveCloudEndpoint(undefined) === '');
  t('C4 file:// 协议不被接受',
    W.resolveCloudEndpoint('file:///C:/x/index.html') === '');
  t('C5 空值兜底为空串（交给 SDK 自己回落，不再写死旧域名）',
    W.resolveCloudEndpoint('') === '');

  /* ────────────────────────────────────────────────
     T 组：错误文案不能再暗示"游客也能用"
     ──────────────────────────────────────────────── */
  sec('T 组：报错文案与门禁一致');

  /* 去掉注释再做文本断言 —— 这一步本身就是一个教训：
     我在本轮修复里就地写了「原来是『已切回访客模式，可以继续上课』」这类**解释性注释**，
     注释里当然含那句被禁的文案。裸 grep 会把"注释里提到了它"误判成"代码里还在用它"，
     于是测试失败在**我自己的说明文字**上。能取到运行时的就优先走运行时。 */
  const stripComments = (src) => String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const codeOnly = stripComments(appJs);

  // T1/T2 走运行时：直接调真实函数，看它到底返回什么文案
  const authErrMsg = W.mapLLMError({ kind: 'unauthenticated' });
  t('T1 ★ 凭据失效的错误文案要求「重新登录」', /重新登录/.test(authErrMsg));
  t('T2 ★ 且不再出现「访客模式」字样', !/访客模式/.test(authErrMsg));

  // T3/T4 只能走源码（这两句不是函数返回值，是内联在分支里的 toast/字符串）
  t('T3 自检面板不再声称"不需要登录就能生成课程"（已去注释）',
    !/不需要登录也不需要手机号就能生成课程/.test(codeOnly));
  t('T4 代码里（已去注释）不再有"切回访客模式，可以继续上课"',
    !/切回访客模式/.test(codeOnly));
  t('T5 自检面板如实说明会被门禁拦住',
    /未登录会被登录门禁拦住/.test(codeOnly));

  /* ────────────────────────────────────────────────
     M 组：内容存储按账号隔离（R01）
     ──────────────────────────────────────────────── */
  sec('M 组：切账号不串课程（R01）');

  const CK = W.CONTENT_KEYS;
  const keyFor = (base, owner) => W.scopedContentKey(base, owner);
  const raw = (k) => W.localStorage.getItem(k);

  W.localStorage.clear();
  W.state.courses = [];
  W.state.user = null;
  W.authUI();                                  // 归位到未登录

  /* M1–M4 必须用一个**全新的页面实例**来测"旧版全局键的认领"：
     认领按设计**只做一次**，而上面的 G 组已经登录过（那一刻就消耗掉了这次机会）。
     在同一个实例里再塞旧键，已经不会被认领 —— 那不是缺陷，是"一次性"本身。
     用干净实例才测得到真实场景（老用户第一次打开新版页面）。 */
  {
    const W2 = freshApp();
    W2.localStorage.setItem(CK.courses, JSON.stringify([{ id: 'legacy-1', title: '旧版遗留课程' }]));
    W2.eval(appJs);
    await new Promise((r) => setTimeout(r, 30));
    t('M-L1 未登录时不认领（身份未定，这时认领会把数据记到 guest 名下）',
      W2.localStorage.getItem(CK.courses) !== null);
    W2.state.user = { id: 'A', anonymous: false };
    W2.authUI();
    t('M-L2 ★ 登录后旧版全局键被认领进当前账号',
      /legacy-1/.test(W2.localStorage.getItem(keyFor(CK.courses, 'u_A')) || ''));
    t('M-L3 ★ 认领后旧全局键被删除（否则下一个账号会再继承一次）',
      W2.localStorage.getItem(CK.courses) === null);
    t('M-L4 认领后的课程真的进了内存', W2.state.courses.some((c) => c.id === 'legacy-1'));
  }

  // M4 A 建课并落盘 → 进 A 的命名空间
  W.state.user = { id: 'A', anonymous: false };
  W.authUI();                                  // 身份切到 A（命名空间随之切换）
  W.state.courses = [{ id: 'cA', title: 'A 的课', progress: 0.3 }];
  W.persistCourses();
  t('M4 A 的课程写进 u_A 命名空间', /cA/.test(raw(keyFor(CK.courses, 'u_A')) || ''));
  t('M5 不写进 B 的命名空间', raw(keyFor(CK.courses, 'u_B')) === null);

  // M6 ★ 切到 B：绝不能看到 A 的课程 —— 这是 R01 的核心
  W.state.user = { id: 'B', anonymous: false };
  W.authUI();
  t('M6 ★★ B 登录后看不到 A 的课程（修复前 state.courses 里还是 A 那批）',
    !W.state.courses.some((c) => c.id === 'cA'));
  t('M7 B 的课程列表是空的', W.state.courses.length === 0);

  // M8 A 的键没被 B 的操作破坏
  W.state.courses = [{ id: 'cB', title: 'B 的课' }];
  W.persistCourses();
  t('M8 B 落盘写进自己的命名空间', /cB/.test(raw(keyFor(CK.courses, 'u_B')) || ''));
  t('M9 ★ A 的课程原样保留，没被 B 覆盖', /cA/.test(raw(keyFor(CK.courses, 'u_A')) || ''));
  t('M10 B 的命名空间里没有 A 的课', !/cA/.test(raw(keyFor(CK.courses, 'u_B')) || ''));

  // M11 切回 A：课程回来
  W.state.user = { id: 'A', anonymous: false };
  W.authUI();
  t('M11 ★ 切回 A 后自己的课程回来了', W.state.courses.some((c) => c.id === 'cA'));
  t('M12 切回 A 时没有混进 B 的课', !W.state.courses.some((c) => c.id === 'cB'));

  // M13 题库同样隔离
  W.state.user = { id: 'A', anonymous: false };
  W.authUI();
  W.saveBank([{ stem: 'A 导入的题', type: 'choice' }]);
  W.state.user = { id: 'B', anonymous: false };
  W.authUI();
  t('M13 ★ 题库也隔离：B 读不到 A 导入的题',
    !W.loadBank().some((q) => q.stem === 'A 导入的题'));
  t('M14 A 的题库键仍在', /A 导入的题/.test(raw(keyFor(CK.bank, 'u_A')) || ''));

  // M15 ★ 同步上传的必须是**当前账号**的课程（R01 的实质后果）
  {
    const inserted = [];
    W.state.user = { id: 'B', anonymous: false };
    W.authUI();
    W.state.cloud = W.WorkBuddyCloud.createWorkBuddyCloud();
    W.state.cloud.database = {
      from: () => ({
        select: function () { return this; }, limit: function () { return this; },
        order: function () { return this; }, eq: function () { return this; },
        update: function () { return this; }, insert: function (row) { inserted.push(row); return this; },
        then: (r) => Promise.resolve({ data: [], error: null }).then(r),
        catch: (r) => Promise.resolve({ data: [], error: null }).catch(r),
      }),
    };
    await W.syncCourses();
    const ids = inserted.map((r) => r && r.course_id);
    t('M15 ★★ 同步上传的载荷里没有别的账号的课程（R01 的实质）', ids.indexOf('cA') < 0);
    t('M16 ★★ 上传的确实是 B 自己的课程', ids.indexOf('cB') >= 0);
  }

  // M17 偏好类键**不**隔离（换账号不该把主题也换掉）
  t('M17 主题/语速这类偏好不属于内容键', Object.keys(CK).every((n) => CK[n].indexOf('theme') < 0 && CK[n].indexOf('tts') < 0));
  W.localStorage.setItem('lingxi_theme', 'dark');
  W.state.user = { id: 'A', anonymous: false };
  W.authUI();
  W.state.user = { id: 'B', anonymous: false };
  W.authUI();
  t('M18 ★ 切账号后主题仍是同一个（偏好不隔离）', raw('lingxi_theme') === 'dark');

  /* ────────────────────────────────────────────────
     N 组：注销的完整性（R04）
     ──────────────────────────────────────────────── */
  sec('N 组：注销不谎报、不漏项（R04）');

  const covered = W.CLOUD_USER_TABLES.map((x) => x.t);
  const used = ['student_facts', 'student_sessions', 'student_profiles', 'courses', 'analytics_events'];
  t('N1 ★ 注销覆盖代码里实际用到的全部云端表', used.every((x) => covered.indexOf(x) >= 0));
  t('N2 ★ courses（课程与课堂回放）不再被遗漏', covered.indexOf('courses') >= 0);
  t('N3 ★ 埋点表 analytics_events 也在删除范围内', covered.indexOf('analytics_events') >= 0);

  // N4/N5 云端删失败 → 不谎报成功、不登出（否则没有会话可以重试）
  {
    W.prompt = () => '确认注销';
    W.confirm = () => true;
    W.localStorage.setItem('lingxi_consent_v1', JSON.stringify({ version: 'v', at: 1 }));
    const tried = [];
    W.state.user = { id: 'u-del', anonymous: false };
    W.authUI();
    W.state.cloud = W.WorkBuddyCloud.createWorkBuddyCloud();
    W.state.cloud.auth = { signOut: async () => ({ error: null }) };
    W.state.cloud.database = {
      from: (t) => ({ delete: () => ({ eq: () => ({ select: async () => { tried.push(t); return { data: [], error: { message: 'boom' } }; } }) }) }),
    };
    await W.deleteMyAccount();
    t('N4 ★★ 删除失败时不登出（登出就没法重试了）', !!(W.state.user && W.state.user.id === 'u-del'));
    t('N5 ★★ 删除失败时保留同意标记（setConsent(false) 会把它删掉 = 装作已注销）',
      W.localStorage.getItem('lingxi_consent_v1') !== null);
    t('N6 每张表都重试过一次（5 表 × 2 次）', tried.length === used.length * 2);
  }

  // N7/N8 云端删成功 → 本机该账号的课程/题库/备份一起清掉
  {
    W.state.user = { id: 'u-del2', anonymous: false };
    W.authUI();
    W.state.courses = [{ id: 'del-c' }];
    W.persistCourses();
    W.saveBank([{ stem: '待删的题' }]);
    W.localStorage.setItem(W.scopedContentKey(CK.preImport), JSON.stringify({ courses: [{ id: 'old' }] }));
    let signOutCalls2 = 0;
    W.state.cloud.auth = { signOut: async () => { signOutCalls2++; return { error: null }; } };
    W.state.cloud.database = {
      from: () => ({ delete: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }),
    };
    await W.deleteMyAccount();
    t('N7 ★★ 注销成功后本机该账号的课程键被删除', raw(keyFor(CK.courses, 'u_del2')) === null);
    t('N8 ★★ 题库键与导入前备份也一起清掉（修复前只清了课程）',
      raw(keyFor(CK.bank, 'u_del2')) === null && raw(keyFor(CK.preImport, 'u_del2')) === null);
    t('N9 注销成功后确实登出了', signOutCalls2 >= 1 && W.state.user === null);
  }

  /* ────────────────────────────────────────────────
     O 组：课程同步（R02）
     ──────────────────────────────────────────────── */
  sec('O 组：同步不丢、不覆盖新进度、删除不复活（R02）');

  const setLocalCourses = (list) => {
    W.localStorage.setItem(W.scopedContentKey(W.CONTENT_KEYS.courses), JSON.stringify(list));
    W.loadCourses();                       // 基线与 state.courses 一致，且**不打脏**
  };

  W.state.user = { id: 'u-sync', anonymous: false };
  W.authUI();
  W.localStorage.removeItem(W.syncQueueKey());

  // O1 保存课程必须进待同步队列（原来：云端调用数恒为 0）
  {
    const { db } = makeSyncDb([]);
    W.state.cloud = { database: db, auth: { signOut: async () => ({}) } };
    setLocalCourses([]);
    W.saveCourse({ id: 'ns1', title: '新课', subject: '数学' }, false);
    t('O1 ★ 保存课程会记入待同步队列（修复前正常 saveCourse 一次云端都不发）',
      W.pendingSyncCount() >= 1);
    await new Promise((r) => setTimeout(r, 1900));    // 等节流的自动 flush 跑完
  }

  /* O2–O4 是最核心的一条：**旧设备不能覆盖云端更新的进度**。
     修复前 syncCourses() 是"先把本地全部覆盖到云端"，于是云端 90% 会被本机 20% 抹掉。 */
  {
    const cloud90 = { id: 'c-old', title: '同一节课', progress: 0.9, updatedAt: 2000 };
    const { rec, db } = makeSyncDb([{ id: 'r-old', course_id: 'c-old', data: cloud90 }]);
    W.state.cloud = { database: db, auth: { signOut: async () => ({}) } };
    // 本机是另一台旧设备留下的 20%，**没有**未同步标记（它就是上次同步下来的）
    setLocalCourses([{ id: 'c-old', title: '同一节课', progress: 0.2, updatedAt: 1000 }]);
    W.localStorage.removeItem(W.syncQueueKey());
    t('O2 前置：此时没有待同步项（本地那份就是上次同步下来的）', W.pendingSyncCount() === 0);

    await W.syncCourses();
    const c = W.state.courses.find((x) => x.id === 'c-old');
    t('O3 ★★ 云端较新的 90% 没有被本机旧的 20% 覆盖', !!c && c.progress === 0.9);
    t('O4 ★★ 也没有反过来把 20% 推上云端', rec.inserts.length === 0 && rec.updates.length === 0);

    // O5 但本地**真的改过**时，本地要赢（否则新改动永远推不上去）
    const local = W.state.courses.find((x) => x.id === 'c-old');
    local.progress = 1;
    W.markCourseDirty(local);
    await W.syncCourses();
    t('O5 ★ 本地有未同步改动时，本地版本会推上云端', rec.updates.length >= 1 || rec.inserts.length >= 1);
    t('O6 推送成功后队列清空', W.pendingSyncCount() === 0);
  }

  // O7/O8 断网 → 改动留在队列；恢复后自动重试成功
  {
    const { rec, db } = makeSyncDb([]);
    W.state.cloud = { database: db, auth: { signOut: async () => ({}) } };
    setLocalCourses([{ id: 'c-off', title: '离线课', progress: 0.1, updatedAt: 10 }]);
    const c = W.state.courses[0];
    c.progress = 0.5;
    W.markCourseDirty(c);
    rec.fail.insert = true; rec.fail.update = true; rec.fail.select = true;
    await W.syncCourses();
    t('O7 ★ 断网时改动留在队列里（可重试，不丢）', W.pendingSyncCount() >= 1);
    rec.fail.insert = false; rec.fail.update = false; rec.fail.select = false;
    await W.syncCourses();
    t('O8 ★ 恢复网络后重试成功，队列清空', W.pendingSyncCount() === 0);
  }

  // O9/O10 删除：真删云端 + 墓碑守卫（即使云端那行还返回也不复活）
  {
    const { rec, db } = makeSyncDb([{ id: 'r-del', course_id: 'c-del', data: { id: 'c-del', title: '待删', updatedAt: 1000 } }]);
    W.state.cloud = { database: db, auth: { signOut: async () => ({}) } };
    setLocalCourses([{ id: 'c-del', title: '待删', updatedAt: 1000 }]);
    W.state.courses = W.state.courses.filter((x) => x.id !== 'c-del');
    W.markCourseDeleted('c-del');
    await W.syncCourses();
    t('O9 ★★ 删除会真的删云端（原来只删本地）', rec.deletes.length >= 1);
    t('O10 ★★ 删除后重新拉取不会复活', !W.state.courses.some((x) => x.id === 'c-del'));
  }
  {
    /* 墓碑守卫单独验：让"删云端"这一步失败，于是墓碑留在队列里，
       而"拉取"成功 —— 此时云端那一行还在，但**绝不能**被拉回本地。 */
    const { rec, db } = makeSyncDb([{ id: 'r-g', course_id: 'c-ghost', data: { id: 'c-ghost', title: '幽灵课', updatedAt: 1 } }]);
    W.state.cloud = { database: db, auth: { signOut: async () => ({}) } };
    setLocalCourses([]);
    const q = W.loadSyncQueue(); q.d['c-ghost'] = Date.now(); W.saveSyncQueue(q);
    rec.fail.delete = true;
    await W.syncCourses();
    t('O11 ★★ 墓碑存在时，云端那一行不会被拉回本地（复活守卫）',
      !W.state.courses.some((x) => x.id === 'c-ghost'));
    t('O12 删除失败时墓碑保留在队列里（下次还会重试删云端）', W.pendingSyncCount() >= 1);
  }

  // O13 同步状态行：未登录隐藏、有积压时提示
  {
    W.state.user = null;
    W.authUI();
    W.renderSyncStatus();
    t('O13 未登录时不同步状态行（那时谈"同步到云端"会误导）',
      W.document.querySelector('#sync-status').hidden === true);
    W.state.user = { id: 'u-sync2', anonymous: false };
    W.authUI();
    const q2 = W.loadSyncQueue(); q2.u['x1'] = Date.now(); W.saveSyncQueue(q2);
    W.renderSyncStatus();
    const el = W.document.querySelector('#sync-status');
    t('O14 ★ 有积压时状态行如实说明（而不是只闪一个 toast）',
      el.hidden === false && el.classList.contains('is-pending') && /待同步/.test(el.textContent));
  }

  // O15 注销要连待同步队列一起清（否则下次登录会去推一批早该删的课）
  {
    W.state.user = { id: 'u-sync3', anonymous: false };
    W.authUI();
    const q3 = W.loadSyncQueue(); q3.u['zombie'] = Date.now(); W.saveSyncQueue(q3);
    t('O15 前置：队列里有待同步项', W.pendingSyncCount() >= 1);
    W.clearContentForOwner('u_sync3');
    t('O16 ★ 注销清掉该账号的待同步队列', W.localStorage.getItem(W.syncQueueKey('u_sync3')) === null);
  }

  /* ────────────────────────────────────────────────
     Q 组：掌握度 —— 新证据要能退役旧结论（R07）
     ──────────────────────────────────────────────── */
  sec('Q 组：掌握度可被新证据更新（R07）');

  const iso = (ms) => new Date(ms).toISOString();
  const T0 = Date.parse('2026-09-01T00:00:00Z');
  const T1 = Date.parse('2026-09-20T00:00:00Z');

  // Q1 报告里的复现用例：旧 weak（置信度 1） + 10 次命中的新 strength
  {
    const facts = [
      { kind: 'weak', topic: '分数', subject: '数学', content: '早期薄弱结论', confidence: 1, hits: 1, last_seen: iso(T0) },
      { kind: 'strength', topic: '分数', subject: '数学', content: '后来多次答对', confidence: 0.9, hits: 10, last_seen: iso(T1) },
    ];
    const m = W.buildMastery(facts);
    t('Q1 ★★ 旧的 weak 不再永久压着后来的 strength（修复前恒为"待巩固"）',
      m.length === 1 && m[0].level === 'mastered');
    t('Q2 ★ 但过程没被抹掉：仍标出"曾经薄弱"', m[0].wasWeak === true);
  }

  // Q3 门槛：命中次数不够时**不许**退役（一次答对可能只是蒙对）
  {
    const few = W.buildMastery([
      { kind: 'weak', topic: '分数', subject: '数学', content: '旧', confidence: 1, hits: 1, last_seen: iso(T0) },
      { kind: 'strength', topic: '分数', subject: '数学', content: '新', confidence: 0.9, hits: W.MASTERY_SUPERSEDE_HITS - 1, last_seen: iso(T1) },
    ]);
    t('Q3 ★★ 新证据次数不够时不退役（一次答对不足以推翻错因结论）',
      few[0].level === 'need' && few[0].wasWeak === false);
  }

  // Q4 时间必须在后：只有"更晚的"正面证据才能退役旧的负面结论
  {
    const older = W.buildMastery([
      { kind: 'strength', topic: '分数', subject: '数学', content: '早的优势', confidence: 0.9, hits: 10, last_seen: iso(T0) },
      { kind: 'misconception', topic: '分数', subject: '数学', content: '后来出现了误解', confidence: 0.9, hits: 2, last_seen: iso(T1) },
    ]);
    t('Q4 ★★ 更晚出现的误解不会被更早的优势退役（时间判反就白判了）',
      older[0].level === 'need');
  }

  // Q5 学科必须参与分组：同名知识点不该跨学科互相污染
  {
    const bySubject = W.buildMastery([
      { kind: 'weak', topic: '力', subject: '物理', content: '物理的力不会', confidence: 0.9, hits: 1, last_seen: iso(T1) },
      { kind: 'strength', topic: '力', subject: '语文', content: '语文的力字会写', confidence: 0.9, hits: 9, last_seen: iso(T1) },
    ]);
    t('Q5 ★★ 同一 topic、不同学科要分成两条（修复前被并成一条互相污染）',
      bySubject.length === 2);
    t('Q6 两条各自定级正确',
      bySubject.find((x) => x.subject === '物理').level === 'need' &&
      bySubject.find((x) => x.subject === '语文').level === 'mastered');
  }

  // Q7 没有 topic 的事实不参与聚合；偏好/背景类不参与
  {
    const m = W.buildMastery([
      { kind: 'weak', topic: '', subject: '数学', content: '没有知识点', confidence: 0.9, hits: 1, last_seen: iso(T1) },
      { kind: 'preference', topic: '分数', subject: '数学', content: '喜欢画图', confidence: 0.9, hits: 1, last_seen: iso(T1) },
    ]);
    t('Q7 无 topic 与偏好类事实都不进掌握度', m.length === 0);
  }

  // Q8 时间解析：字段来源不统一（ISO 串 / 毫秒数 / 缺失），都要能比较
  t('Q8 factTime 能解析 ISO 串', W.factTime({ last_seen: iso(T1) }) === T1);
  t('Q9 factTime 能吃毫秒数', W.factTime({ updatedAt: T1 }) === T1);
  t('Q10 factTime 缺失时给 0（当最旧处理，不会误判成最新）',
    W.factTime({}) === 0 && W.factTime(null) === 0 && W.factTime({ last_seen: '不是时间' }) === 0);

  /* Q11–Q13 报告特别提示的**第二处同构聚合**（起点画像）。
     它原来只认 weak / strength 两档，只存在 misconception 的知识点被显示成"评估记录"。
     ★ 这里必须复用页面上**已有的** #mem-diag：它本来就在 index.html 里，
       自己再造一个同 id 的元素，querySelector 拿到的仍是原来那个（空壳），
       于是测试会红在"文档里有两个同 id 节点"这件事上，而不是被测逻辑上。 */
  sec('Q 组（续）：起点画像的第二处同构聚合（R07）');
  const diagEl = W.document.querySelector('#mem-diag');
  t('Q11-前置 页面上确实有 #mem-diag（复用真实节点，不自造）', !!diagEl);
  {
    W.renderMemoryDiag([
      { kind: 'misconception', topic: '函数', subject: '数学', content: '起点就把函数搞混了', confidence: 0.9, last_seen: iso(T0), source: 'diagnostic' },
    ]);
    const html = diagEl.innerHTML;
    t('Q11 ★★ 只有"易错点"的知识点必须标成起点薄弱（修复前显示"评估记录"）',
      /起点薄弱/.test(html) && !/评估记录/.test(html));
  }
  {
    W.renderMemoryDiag([
      { kind: 'weak', topic: '力', subject: '物理', content: '物理不会', confidence: 0.9, last_seen: iso(T1), source: 'diagnostic' },
      { kind: 'strength', topic: '力', subject: '语文', content: '语文会', confidence: 0.9, last_seen: iso(T1), source: 'diagnostic' },
    ]);
    const html = diagEl.innerHTML;
    t('Q12 ★★ 起点画像同样按学科分组（两条都渲染出来，没有被并成一条）',
      /物理/.test(html) && /语文/.test(html));
    t('Q13 起点薄弱与起点已会同时出现（各自定级正确）',
      /起点薄弱/.test(html) && /起点已会/.test(html));
  }
  {
    // 负样本：把 kind 换成纯粹的中性记录 → 才允许落到"评估记录"
    W.renderMemoryDiag([
      { kind: 'context', topic: '综合', subject: '数学', content: 'x', confidence: 0.9, last_seen: iso(T1), source: 'diagnostic' },
    ]);
    t('Q14 负样本：中性记录才落到"评估记录"（证明上面那条不是恒真）',
      /评估记录/.test(diagEl.innerHTML));
  }

  /* ────────────────────────────────────────────────
     Z 组：流式取消 —— 两条路径必须等价（R18）
     ──────────────────────────────────────────────── */
  sec('Z 组：取消时不能丢掉已生成的讲解（R18）');

  /* 造一个"取消落地方式可控"的流：
     yield 两段正文之后，要么**正常结束**、要么**抛 AbortError** ——
     这正是真实 SDK 的两种落地方式，也正是 R18 的成因。 */
  const streamStub = (mode) => {
    let n = 0;
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (n < 2) { n++; return { done: false, value: { choices: [{ delta: { content: '第' + n + '段讲解内容。' } }] } }; }
          if (mode === 'throw') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
          return { done: true };
        },
      }),
    };
  };

  const runCancelCase = async (mode) => {
    W.state.user = { id: 'u-cancel', anonymous: false };
    W.state.model = { id: 'm1', name: 'M1' };
    const ac = new W.AbortController();
    let pushed = 0;
    W.state.cloud = {
      llm: {
        models: { list: async () => [{ id: 'm1', name: 'M1', disabled: false }] },
        chat: { completions: { create: () => {
          // 第一段一出来就模拟"用户点了打断"
          return (function () {
            let k = 0;
            return { [Symbol.asyncIterator]: () => ({
              next: async () => {
                if (k < 2) { k++; pushed++; if (k === 1) ac.abort(); return { done: false, value: { choices: [{ delta: { content: '第' + k + '段讲解内容。' } }] } }; }
                if (mode === 'throw') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
                return { done: true };
              },
            }) };
          })();
        } } },
      },
      database: { from: () => ({ select: function () { return this; }, limit: function () { return this; }, order: function () { return this; }, eq: function () { return this; }, then: (r) => Promise.resolve({ data: [], error: null }).then(r), catch: (r) => Promise.resolve({ data: [], error: null }).catch(r) }) },
      auth: { signOut: async () => ({}) },
    };
    const seen = [];
    let ret = '';
    let err = null;
    try {
      ret = await W.streamChat({
        messages: [{ role: 'user', content: 'x' }],
        signal: ac.signal,
        onDelta: (_d, acc) => seen.push(String(acc)),
      });
    } catch (e) { err = e; }
    return { ret, seen, err, pushed, aborted: ac.signal.aborted };
  };

  {
    const normal = await runCancelCase('end');
    t('Z1 前置：确实触发了取消', normal.aborted === true);
    t('Z2 ★★ 取消（流正常结束路径）返回的是**已生成的部分文本**，不是空串',
      typeof normal.ret === 'string' && normal.ret.indexOf('第1段') >= 0);
  }
  {
    const thrown = await runCancelCase('throw');
    t('Z3 ★★ 取消（抛 AbortError 路径）同样返回已生成的部分文本（修复前恒为空串）',
      typeof thrown.ret === 'string' && thrown.ret.indexOf('第1段') >= 0);
  }
  {
    /* ★ 两条路径必须给出**同样**的结果 —— 这就是"统一取消契约"的判据。
       修复前一条给 partial、一条给 ''，行为随 SDK 的取消落地方式而变。 */
    const a = await runCancelCase('end');
    const b = await runCancelCase('throw');
    t('Z4 ★★ 两条取消路径的返回内容完全一致（修复前一个有一段、一个是空串）',
      a.ret === b.ret && a.ret.length > 0);
    t('Z5 两条路径都没有把异常漏给调用方（取消不是错误）', a.err === null && b.err === null);
  }

  /* Z6–Z8 sendLive 侧：取消时必须按"被打断"处理，而不是当成"正常讲完"。
     结构上判两件事：① 它自己看 controller.signal.aborted；
     ② 两条取消路径调的是同一个函数（否则又会走散）。 */
  {
    const src = appJs;                        // 用原文（这三条是"必须存在某写法"，不是反向断言）
    t('Z6 ★ sendLive 自己在 await 之后检查 controller.signal.aborted',
      /if \(controller\.signal\.aborted\) \{[\s\S]{0,120}?finishInterruptedSegment\(/.test(src));
    t('Z7 ★★ 两条取消路径调用同一个 finishInterruptedSegment（不可能再走散）',
      (src.match(/finishInterruptedSegment\(bubbleDiv, bubbleEl,/g) || []).length >= 2);
    t('Z8 ★ 用 onDelta 存下的 partial 兜底（即使 streamChat 那条路径没带出文本）',
      /partial = String\(acc\)/.test(src) && /full = String\(r \|\| partial \|\| ''\)/.test(src));
  }

  console.log('\nGATE_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('GATE_ERROR ' + ((e && e.stack) || e)); process.exit(2); });
