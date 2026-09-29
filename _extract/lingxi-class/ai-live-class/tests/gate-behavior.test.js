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

(async () => {
  const dom = new JSDOM(html, { url: SITE, runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  W.confirm = () => true;
  W.alert = () => {};

  /* 云服务桩：只提供"够跑通、不炸"的最小面。真实行为不在本文件验证。 */
  const noopChain = () => ({
    select() { return this; }, limit() { return this; }, order() { return this; },
    eq() { return this; }, maybeSingle() { return this; }, update() { return this; },
    insert() { return this; }, upsert() { return this; }, delete() { return this; },
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
    catch: (r) => Promise.resolve({ data: [], error: null }).catch(r),
  });
  W.WorkBuddyCloud = {
    createWorkBuddyCloud() {
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
    },
  };

  W.eval(appJs);
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
  const inc = [{ id: 'c-inc-1', title: '导入的课', progress: 0.5, slides: [] }];
  const r1 = W.applyProgressImport({ data: { courses: inc, bank: [], prefs: {} } }, 'replace');
  t('P1 导入返回成功', r1 && r1.ok === true);
  // ★ 修复前：调的是不存在的 saveCourses()，异常被空 catch 吞掉，照样返回 ok:true，
  //   课程只在内存里 —— 刷新就没了。这里直接读 localStorage 定生死。
  t('P2 ★ 导入的课程真的写进了 localStorage（修复前只在内存）',
    /c-inc-1/.test(W.localStorage.getItem('lingxi_courses_v1') || ''));

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
  t('P5 ★ 撤销后的课程也真的落盘了', /c-old-1/.test(W.localStorage.getItem('lingxi_courses_v1') || ''));
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

  console.log('\nGATE_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('GATE_ERROR ' + ((e && e.stack) || e)); process.exit(2); });
