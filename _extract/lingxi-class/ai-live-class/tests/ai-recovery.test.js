/* ============================================================
   「AI 服务不可用」根因回归测试

   背景（真实事故）：SDK 只在会话「即将过期」时才刷新 token。
   如果 localStorage 里残留一个 expiresAt 还没到、但已被服务端判废的会话，
   SDK 会一直带着它请求 → 云端持续 401 invalid_grant →
   页面永久停在「AI 暂不可用」，而云端 AI 其实是好的。
   这个文件把「识别 401 → 清残留会话 → 匿名重试成功」这条链路固化下来。
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

let pass = 0, fail = 0;
const t = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
const sec = (s) => console.log('\n=== ' + s + ' ===');
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

/* 云端返回的两种错误形态 */
const llm401 = () => {
  const e = new Error('HTTP 401');
  e.name = 'CloudOpenAIError';
  e.status = 401;
  e.error = { message: 'HTTP 401', type: 'server_error', param: null, code: null };
  return e;
};
const llmNetErr = () => {
  const e = new Error('Network error: failed to fetch');
  e.name = 'CloudOpenAIError';
  e.error = { message: 'Network error', type: 'server_error', param: null, code: 'gateway_network_error' };
  return e;
};
const llm500 = () => {
  const e = new Error('HTTP 503');
  e.name = 'CloudOpenAIError';
  e.status = 503;
  e.error = { message: 'HTTP 503', type: 'server_error', param: null, code: 'gateway_internal' };
  return e;
};
const authRejected = { kind: 'unauthenticated', message: 'the session is invalid, expired or issued for another client', status: 401, code: 'invalid_grant' };

/* 可控桩：
   - failsWhileSession=true 时，只要本地还残留会话，所有请求都被它「毒化」返回 401
     （这正是线上事故的形态：带旧 token 请求 → 云端 401）
   - refreshSession 判废 / signOut 都会清掉本地会话，等价于 SDK 的 sessions.clear() */
function makeCloud(stub) {
  return {
    llm: {
      models: {
        list: async () => {
          stub.listCalls++;
          if (stub.listDelayMs) await new Promise((r) => setTimeout(r, stub.listDelayMs));
          if (stub.failsWhileSession && stub.session) throw llm401();
          if (stub.listFailures > 0) { stub.listFailures--; throw stub.listErr(); }
          return stub.models;
        },
      },
      chat: {
        completions: {
          create(params) {
            stub.chatCalls++;
            stub.lastModel = params.model;
            // 「只思考不开口」的模型：只吐 reasoning，直到被 abort
            if (stub.slowModels && stub.slowModels.indexOf(params.model) >= 0) {
              let step = 0;
              return {
                [Symbol.asyncIterator]: () => ({
                  next: async () => {
                    if (step === 0) { step = 1; return { done: false, value: { choices: [{ delta: { reasoning_content: '让我想想…' } }] } }; }
                    await new Promise((res) => {
                      if (params.signal) {
                        if (params.signal.aborted) return res();
                        params.signal.addEventListener('abort', res, { once: true });
                      }
                      setTimeout(res, 3000);
                    });
                    // 真实世界里"中止请求"的落地方式有两种：
                    //   ① async generator 直接正常结束（done）
                    //   ② 抛错 —— Node/undici 侧 message 就是 "terminated"
                    // 两条路都必须能触发自动换模型，所以这里做成可切换。
                    if (stub.slowAbortThrows) {
                      const e = new TypeError('terminated');
                      throw e;
                    }
                    return { done: true };
                  },
                }),
              };
            }
            if (stub.failsWhileSession && stub.session) throw llm401();
            if (stub.chatFailures > 0) { stub.chatFailures--; throw stub.chatErr(); }
            const payload = 'ok';
            let done = false;
            return {
              [Symbol.asyncIterator]() {
                return {
                  next: async () => {
                    if (done) return { done: true };
                    done = true;
                    return { done: false, value: { choices: [{ delta: { content: payload } }] } };
                  },
                };
              },
            };
          },
        },
      },
    },
    auth: {
      getSession: async () => ({ data: stub.session, error: null }),
      getUser: async () => {
        if (stub.session && stub.failsWhileSession) return { data: null, error: authRejected };
        return stub.session
          ? { data: { id: 'u1', email: null, phone: null, raw: {} }, error: null }
          : { data: null, error: { kind: 'unauthenticated', message: 'no active session', status: 0 } };
      },
      refreshSession: async () => {
        stub.refreshCalls++;
        if (stub.refreshResult === 'ok') return { data: { accessToken: 'new', refreshToken: 'r2', expiresAt: Date.now() + 3600e3, user: { id: 'u1' } }, error: null };
        if (stub.refreshResult === 'rejected') { stub.session = null; return { data: null, error: authRejected }; }  // SDK 内部 abandon()
        if (stub.refreshResult === 'network') return { data: null, error: { kind: 'network', message: 'offline', status: 0 } };
        return { data: null, error: null };   // 无会话
      },
      signOut: async () => { stub.signOutCalls++; stub.session = null; return { data: null, error: null }; },
      onAuthStateChange: () => () => {},
    },
    database: {
      from: () => ({
        select() { return this; }, limit() { return this; }, order() { return this; },
        eq() { return this; }, maybeSingle() { return this; },
        then: (r) => Promise.resolve({ data: [], error: null }).then(r),
        catch: (r) => Promise.resolve({ data: [], error: null }).catch(r),
      }),
    },
  };
}

const session = (extra) => Object.assign({
  accessToken: 'stale-at', refreshToken: 'stale-rt',
  expiresAt: Date.now() + 3600e3, user: { id: 'u1', isAnonymous: false, raw: {} },
}, extra || {});

(async () => {
  const dom = new JSDOM(html, { url: 'https://ai-tutor-live.app.workbuddy.host/', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  W.confirm = () => true; W.alert = () => {};

  const stub = {
    // 形态贴近真实目录：第一个是 auto（思考型），后面才是实测最快的模型
    models: [
      { id: 'auto', name: 'Auto', enabled: true, onlyReasoning: true, maxOutputTokens: 32000 },
      { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash', enabled: true, maxOutputTokens: 128000 },
    ],
    listCalls: 0, listFailures: 0, listErr: llm401, listDelayMs: 0,
    chatCalls: 0, chatFailures: 0, chatErr: llm401,
    slowModels: [], slowAbortThrows: false,   // 「只思考不开口」的模型；中止时是抛错还是正常结束
    session: null,
    failsWhileSession: true,   // 本地残留会话 → 请求被毒化 401（事故形态）
    refreshCalls: 0, refreshResult: 'rejected',
    signOutCalls: 0,
  };
  W.WorkBuddyCloud = { createWorkBuddyCloud: () => makeCloud(stub) };

  W.eval(appJs);
  await tick(400);

  const statusText = () => W.document.getElementById('ai-status').textContent;
  const statusEl = () => W.document.getElementById('ai-status');

  /* ===== A. isAuthError 的边界 ===== */
  sec('A. 401 / 凭据失效的识别');
  t(W.isAuthError(llm401()) === true, 'A1 LLM 的 HTTP 401 被识别为登录态失效');
  t(W.isAuthError(authRejected) === true, 'A2 auth 的 kind=unauthenticated 被识别');
  t(W.isAuthError({ error: { code: 'invalid_grant' } }) === true, 'A3 invalid_grant 被识别');
  t(W.isAuthError({ error: 'invalid_grant' }) === true, 'A4 error 为字符串时也能识别');
  t(W.isAuthError(llmNetErr()) === false, 'A5 网络错误不被误判为登录失效');
  t(W.isAuthError(llm500()) === false, 'A6 5xx 不被误判为登录失效');
  t(W.isAuthError({ error: { code: 'quota_exceeded' } }) === false, 'A7 额度不足不被误判为登录失效');
  t(W.isAuthError(null) === false, 'A8 null 安全');

  /* ===== B. 残留失效会话 → 自愈 → AI 恢复 ===== */
  sec('B. 残留失效会话（核心事故场景）');
  stub.session = session();               // 本地「看起来还有效」的会话
  stub.listFailures = 0; stub.chatFailures = 0;
  stub.refreshCalls = 0; stub.signOutCalls = 0; stub.listCalls = 0;
  stub.refreshResult = 'rejected';        // 服务端判废
  W.state.user = { id: 'u1', email: 'stale@example.com' };

  const ok = await W.loadModels();
  t(ok === true, 'B1 模型目录最终拉取成功（不再永久不可用）');
  t(!!W.state.model && W.state.model.id === 'deepseek-v4.1-flash', 'B2 选出了实测最快的模型（而不是目录第一个 auto）');
  t(statusText().indexOf('AI 已就绪') >= 0, 'B3 状态条显示「AI 已就绪」');
  t(statusEl().classList.contains('is-retryable') === false, 'B4 成功状态不再显示为可重试');
  t(stub.refreshCalls >= 1, 'B5 触发了会话刷新尝试');
  t(stub.signOutCalls >= 1, 'B6 凭据被判废后清掉了本地会话');
  t(W.state.user === null, 'B7 失效登录态被清除（不会保留假的登录）');

  /* ===== C. 启动即自愈：不再先失败一次 ===== */
  sec('C. 启动时的会话校验');
  stub.session = session();
  stub.listFailures = 0; stub.listCalls = 0; stub.refreshCalls = 0; stub.refreshResult = 'rejected';
  const cleaned = await W.ensureSessionHealthy();
  t(cleaned === true, 'C1 启动校验发现并清掉了失效会话');
  await W.loadModels();
  t(stub.listCalls === 1, 'C2 清理后模型目录一次拿到（没有先白跑一次 401）');
  t(statusText().indexOf('AI 已就绪') >= 0, 'C3 状态条正常');

  /* ===== D. 会话有效：不许误登出 ===== */
  sec('D. 会话有效时不误伤');
  stub.session = session();
  stub.failsWhileSession = false;          // 服务端认可这个会话
  stub.refreshResult = 'ok';
  stub.signOutCalls = 0;
  W.state.user = { id: 'u1', email: 'ok@example.com' };
  const cleaned2 = await W.ensureSessionHealthy();
  t(cleaned2 === false, 'D1 有效会话不会被清理');
  t(stub.signOutCalls === 0, 'D2 没有触发登出');
  t(!!W.state.user && W.state.user.id === 'u1', 'D3 登录态保留');
  stub.failsWhileSession = true;

  /* ===== E. 网络故障时不登出 ===== */
  sec('E. 网络故障不误登出');
  stub.refreshResult = 'network';
  stub.signOutCalls = 0;
  const healed = await W.healSession();
  t(healed === false, 'E1 网络类刷新失败不会被当成凭据失效');
  t(stub.signOutCalls === 0, 'E2 网络故障不登出用户');

  /* ===== F. 网络抖动靠重试自愈 ===== */
  sec('F. 网络抖动重试');
  stub.session = null;
  stub.listFailures = 1; stub.listErr = llmNetErr;
  stub.listCalls = 0; stub.refreshCalls = 0;
  const ok2 = await W.loadModels();
  t(ok2 === true, 'F1 一次网络失败后重试成功');
  t(stub.listCalls >= 2, 'F2 确实发起了重试');
  t(stub.refreshCalls === 0, 'F3 网络问题不该走会话刷新');

  /* ===== G. 彻底失败 → 可点重试 ===== */
  sec('G. 彻底失败后的可操作性');
  stub.listFailures = 5;
  const ok3 = await W.loadModels();
  t(ok3 === false, 'G1 反复失败后明确返回失败');
  t(W.state.model === null, 'G2 失败时不会残留一个假模型');
  t(statusText().indexOf('点此重试') >= 0, 'G3 状态条提示可重试');
  t(statusEl().classList.contains('is-retryable') === true, 'G4 状态条标记为可点击');
  stub.listFailures = 0;
  statusEl().click();
  await tick(120);
  t(statusText().indexOf('AI 已就绪') >= 0, 'G5 点击状态条可以恢复');

  /* ===== H. requireModel 闸门：必须「等」，不能「拒」=====
     真实事故：SDK 建会话 + 拉目录实测要 4~5 秒，用户手快在这期间点「生成课程」，
     老的同步判定会当场弹「AI 服务不可用」。 */
  sec('H. requireModel 闸门（等待就绪，而不是当场拒绝）');
  W.state.model = null;
  stub.listCalls = 0;
  stub.listFailures = 0;
  stub.listDelayMs = 300;
  const gate = W.requireModel();
  t(typeof gate.then === 'function', 'H1 返回 Promise（调用方必须 await）');
  let earlySettle = null;
  gate.then((v) => { earlySettle = v; });
  await tick(60);
  t(earlySettle === null, 'H2 加载还没落地时不自作主张先返回 false');
  t((await gate) === true, 'H3 等到首次加载完成后放行（手快点按钮不再被劝退）');
  t(stub.listCalls >= 1, 'H4 确实触发了模型加载');
  stub.listDelayMs = 0;
  t((await W.requireModel()) === true, 'H5 已就绪时立即放行');
  const callsAfterReady = stub.listCalls;
  await W.requireModel();
  t(stub.listCalls === callsAfterReady, 'H6 已就绪时不再重复打接口');

  // H7/H8 真的加载不出来时，要有明确的等待预算上限，不能把用户卡住
  W.state.model = null;
  stub.listFailures = 99;
  const t0 = Date.now();
  const r = await W.requireModel({ budget: 200 });
  t(r === false, 'H7 一直加载不出来时返回 false（调用方中止）');
  t(Date.now() - t0 < 3000, 'H8 有等待预算上限（实测 ' + (Date.now() - t0) + 'ms），不会无限等');
  stub.listFailures = 0;
  await tick(2600);                      // 让后台那轮重试跑完，避免污染后面的用例
  stub.listCalls = 0;

  /* ===== I. streamChat 的 401 自愈 ===== */
  sec('I. 对话流式调用的 401 自愈');
  stub.chatFailures = 0;                 // 401 由「残留会话毒化请求」产生，而不是固定失败次数
  stub.chatErr = llm401;
  stub.refreshResult = 'rejected'; stub.signOutCalls = 0; stub.chatCalls = 0;
  stub.session = session();
  W.state.model = { id: 'auto', name: 'Auto', enabled: true };
  const text = await W.streamChat({ messages: [{ role: 'user', content: 'hi' }] });
  t(text === 'ok', 'I1 401 之后自愈并重试，拿到内容');
  t(stub.chatCalls === 2, 'I2 确实重试了一次');
  t(stub.signOutCalls >= 1, 'I3 清掉了失效会话');

  /* ===== J. 推理模型的静默期回调 ===== */
  sec('J. 纯推理模型的 reasoning_content');
  const w = W;
  w.WorkBuddyCloud.createWorkBuddyCloud = () => {
    const c = makeCloud(stub);
    c.llm.chat.completions.create = () => {
      const chunks = [
        { choices: [{ delta: { reasoning_content: '让我想想' } }] },
        { choices: [{ delta: { content: '答案是 2' } }] },
      ];
      let i = 0;
      return { [Symbol.asyncIterator]: () => ({ next: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) };
    };
    return c;
  };
  W.state.cloud = w.WorkBuddyCloud.createWorkBuddyCloud();
  let sawReasoning = false;
  const out = await W.streamChat({
    messages: [{ role: 'user', content: 'x' }],
    onReasoning: () => { sawReasoning = true; },
  });
  t(sawReasoning === true, 'J1 reasoning_content 通过 onReasoning 透出（静默期有反馈）');
  t(out === '答案是 2', 'J2 正文照常返回');
  // 还原桩：否则场景 J 的定制 create 会污染后续用例
  w.WorkBuddyCloud.createWorkBuddyCloud = () => makeCloud(stub);
  W.state.cloud = w.WorkBuddyCloud.createWorkBuddyCloud();

  /* ===== K. 错误文案 ===== */
  sec('K. 错误文案');
  t(W.mapLLMError(llm401()).indexOf('登录状态已过期') >= 0, 'K1 401 → 登录态过期提示');
  t(W.mapLLMError({ status: 429, error: { code: 'quota_exceeded' } }).indexOf('限流') >= 0, 'K2 429 → 限流提示');
  t(W.mapLLMError(llm500()).indexOf('开小差') >= 0, 'K3 503 → 服务开小差');
  t(W.mapLLMError(llmNetErr()).indexOf('网络') >= 0, 'K4 网络错误 → 网络提示');
  t(W.mapLLMError({ error: { code: 'model_not_found' } }).indexOf('模型') >= 0, 'K5 model_ → 模型不可用');

  /* ===== L. 标记与样式约束 ===== */
  sec('L. 状态条与样式');
  t(/<button[^>]*id="ai-status"/.test(html), 'L1 状态条是可聚焦的 button（键盘可重试）');
  // 属性顺序不保证（部署经编辑器往返会被重排），两条独立断言，不依赖先后
  t(/<button[^>]*id="ai-status"/.test(html) && /<button[^>]*aria-live=/.test(html), 'L2 状态条带 aria-live，状态变化会被读屏播报');
  t(css.indexOf('.ai-status.is-retryable') >= 0, 'L3 可重试状态有对应样式');
  t(css.indexOf('.teach-thinking') >= 0, 'L4 推理等待提示有样式');
  t(appJs.indexOf("setAIStatus('bad', 'AI 暂不可用 · 点此重试'") >= 0, 'L5 失败态文案带可操作指引');
  t(!/statusEl\.innerHTML/.test(appJs), 'L6 旧的直接写状态条写法已收敛到 setAIStatus');

  /* ===== M. 默认模型不能再"取列表第一个" ===== */
  sec('M. 默认模型选择（实测数据固化）');
  const dir = [
    { id: 'auto', name: 'Auto', enabled: true, onlyReasoning: true, maxOutputTokens: 32000, isDefault: true, reasoning: { effort: 'high' } },
    { id: 'hunyuan-image-alpha', name: 'Hunyuan Image Alpha', enabled: true },
    { id: 'hunyuan-chat', name: 'Hunyuan-Turbos', enabled: true, maxOutputTokens: 8192 },
    { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', enabled: true, onlyReasoning: true, maxOutputTokens: 32000, reasoning: { effort: 'high' } },
    { id: 'minimax-m2.5', name: 'MiniMax-M2.5', enabled: true, onlyReasoning: true, maxOutputTokens: 48000 },
    { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash', enabled: true, maxOutputTokens: 128000 },
    { id: 'deepseek-v4-flash', name: 'Deepseek-V4-Flash', enabled: true, maxOutputTokens: 50000 },
  ];
  t(W.isChatModel(dir[1]) === false, 'M1 图像模型不算对话模型');
  t(W.isChatModel({ id: 'x', disabled: true }) === false, 'M2 disabled 模型被排除');
  const best = W.pickPreferredModel(dir);
  t(!!best && best.id === 'deepseek-v4.1-flash', 'M3 选中的是实测最快的模型，而不是列表第一个 auto');
  t(W.rankModels(dir)[0].id === 'deepseek-v4.1-flash', 'M4 排序第一名是首选模型');
  t(W.modelScore(dir[0]) < W.modelScore(dir[5]), 'M5 高档位纯推理的 auto 评分远低于首选');
  t(W.modelScore(dir[2]) < W.modelScore(dir[5]), 'M6 输出上限过小（8k 会截断课件 JSON）的模型评分更低');
  t(W.MODEL_PREFERENCE.indexOf('minimax-m2.5') === -1,
    'M7 minimax-m2.5 不进白名单（实测 400 request_invalid_parameter，不吃 response_format）');
  t(W.MODEL_PREFERENCE.indexOf('glm-5.3-flash') === -1,
    'M8 glm-5.3-flash 不进白名单（实测首字 121s，体验等同不可用）');
  t(W.MODEL_PREFERENCE.indexOf('auto') === -1,
    'M9 auto 不进白名单（实测 4 分钟无输出，本事故主因）');
  t(W.pickPreferredModel([]) === null, 'M10 空目录返回 null 而不是乱猜');
  t(W.pickPreferredModel([dir[1]]) === null, 'M11 只剩图像模型时返回 null');
  const noWhitelist = dir.filter((m) => W.MODEL_PREFERENCE.indexOf(m.id) < 0);
  t(W.pickPreferredModel(noWhitelist).id !== 'auto', 'M12 白名单不可用时也不会滑回 auto');

  /* ===== N. 手选模型持久化 ===== */
  sec('N. 模型选择持久化');
  const FAST = dir.find((m) => m.id === 'deepseek-v4.1-flash');
  const FAST2 = dir.find((m) => m.id === 'deepseek-v4-flash');
  W.state.models = dir.slice();
  W.state.model = null;
  W.localStorage.removeItem(W.MODEL_KEY);
  W.applyModel(dir);
  t(W.state.model && W.state.model.id === 'deepseek-v4.1-flash', 'N1 无历史选择时用偏好模型');
  W.setModel('deepseek-v4-flash');
  t(W.localStorage.getItem(W.MODEL_KEY) === 'deepseek-v4-flash', 'N2 手选写入本地存储');
  W.state.model = null;
  W.applyModel(dir);
  t(W.state.model && W.state.model.id === 'deepseek-v4-flash', 'N3 下次进入沿用手选，不再回到默认');

  /* ===== O. 首字超时 → 自动换更快的模型 ===== */
  sec('O. 首字超时自动换模型');
  stub.slowModels = ['auto'];
  stub.models = dir;
  W.state.models = dir.slice();
  W.state.model = dir.find((m) => m.id === 'auto');   // 故意用"会一直思考"的 auto
  stub.chatCalls = 0;
  let notice = null;
  const slowStart = Date.now();
  const res = await W.streamChat({
    messages: [{ role: 'user', content: 'x' }],
    firstContentBudget: 120,
    onNotice: (m) => { notice = m; },
  });
  t(res === 'ok', 'O1 换模型后成功拿到内容（用户感知为"稍慢但成功"）');
  t(W.state.model.id === 'deepseek-v4.1-flash', 'O2 自动切到了更快的模型');
  t(!!notice && notice.indexOf('太慢') >= 0, 'O3 有明确提示，不是静默换模型');
  t(stub.chatCalls === 2, 'O4 只重试一次，不来回横跳');
  t(Date.now() - slowStart < 5000, 'O5 没有把用户干等满 4 分钟');
  t(W.localStorage.getItem(W.MODEL_KEY) === 'deepseek-v4-flash', 'O6 自动切换不污染用户的手选偏好');

  /* O7~O11：中止请求"抛错"也必须照样换模型。
     这是真实云端踩到的路径：同一个首字超时，有时流正常结束，
     有时抛出 message="terminated" 的错（undici 中止响应体）。
     两类落地方式必须等价，否则自动切换时灵时不灵，
     用户直接吃到 "出错了：terminated" 这种英文黑话。 */
  stub.slowModels = ['auto'];
  stub.slowAbortThrows = true;
  W.state.models = dir.slice();
  W.state.model = dir.find((m) => m.id === 'auto');
  stub.chatCalls = 0;
  notice = null;
  let threw = null;
  let res2 = '';
  try {
    res2 = await W.streamChat({
      messages: [{ role: 'user', content: 'x' }],
      firstContentBudget: 120,
      onNotice: (m) => { notice = m; },
    });
  } catch (e) { threw = e; }
  t(!threw, 'O7 中止时抛错也不把错误抛给用户（实际 threw=' + (threw && threw.message) + '）');
  t(res2 === 'ok', 'O8 照样换模型重试并拿到内容');
  t(!!notice && notice.indexOf('太慢') >= 0, 'O9 照样给出"已自动切换模型"的提示');
  t(W.state.model.id === 'deepseek-v4.1-flash', 'O10 确实换到了更快的模型');
  t(stub.chatCalls === 2, 'O11 仍然只重试一次');
  stub.slowAbortThrows = false;
  stub.slowModels = [];

  /* O12/O13：万一还有漏网的中断错误，文案也不能是英文黑话 */
  t(W.mapLLMError(new TypeError('terminated')).indexOf('网络连接中断') >= 0, 'O12 "terminated" 有中文兜底文案');
  t(W.mapLLMError(new Error('fetch failed')).indexOf('网络连接中断') >= 0, 'O13 "fetch failed" 有中文兜底文案');

  /* ===== P. 用户主动打断 ≠ 失败 ===== */
  sec('P. 用户打断与空回答');
  stub.slowModels = [FAST.id];
  W.state.model = FAST;
  const ac2 = new AbortController();
  const p = W.streamChat({ messages: [{ role: 'user', content: 'x' }], signal: ac2.signal, firstContentBudget: 5000 });
  setTimeout(() => ac2.abort(), 60);
  const r2 = await p;
  t(r2 === '', 'P1 打断返回空串，不抛错、不触发换模型');
  stub.slowModels = [];
  t(W.mapLLMError(W.slowModelError('auto')).indexOf('太慢') >= 0, 'P2 超时错误有可读文案');
  t(W.mapLLMError(W.emptyAnswerError()).indexOf('没返回内容') >= 0, 'P3 空回答有可读文案');
  t(W.errCode(W.slowModelError('x')) === 'client_model_slow', 'P4 错误码可被识别');

  /* ===== Q. 模型选择器的 DOM 契约 ===== */
  sec('Q. 模型选择器');
  t(/id="model-select"/.test(html), 'Q1 生成页有模型选择器（慢的时候有得选）');
  t(/id="model-field"/.test(html), 'Q2 选择器有可隐藏的容器');
  t(html.indexOf('for="model-select"') >= 0, 'Q3 select 有关联 label（可访问性）');
  W.state.models = dir.slice();
  W.state.model = FAST;
  W.renderModelSelect();
  const selEl = W.document.getElementById('model-select');
  t(selEl.options.length >= 3, 'Q4 选项里列出可用对话模型');
  t([...selEl.options].every((o) => o.value !== 'hunyuan-image-alpha'), 'Q5 图像模型不会出现在选项里');
  t(selEl.value === 'deepseek-v4.1-flash', 'Q6 当前模型处于选中态');
  selEl.value = FAST2.id;
  selEl.dispatchEvent(new W.Event('change'));
  await tick(30);
  t(W.state.model.id === 'deepseek-v4-flash', 'Q7 通过下拉框手动切换生效');
  t(W.localStorage.getItem(W.MODEL_KEY) === 'deepseek-v4-flash', 'Q8 下拉框的手选同样被记住');

  console.log('\n_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('SMOKE_ERROR ' + (e && e.stack || e));
  console.log('_RESULT pass=' + pass + ' fail=' + (fail + 1));
  process.exit(1);
});
