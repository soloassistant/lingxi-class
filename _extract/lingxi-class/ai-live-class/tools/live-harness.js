/* ============================================================
   真实云端联调脚手架

   回归测试用的是桩，验证不了"云端真的能跑通"。这个脚手架把本地页面
   跑在 jsdom 里、外接 Node 的真实 fetch，于是可以在命令行里
   真刀真枪地跑一次生成流程。

   为什么必须带这个脚手架：
     「AI 服务不可用」的两大成因（残留失效会话 401、默认模型选到
     长时间不吐字的思考模型）在桩测试里都看不出来 —— 必须在真实
     网络下才会暴露。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const LIVE = 'https://ai-tutor-live.app.workbuddy.host';
const CACHE = path.join(__dirname, '.cache');
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';

async function loadSdk() {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, 'sdk.js');
  if (!fs.existsSync(f)) {
    const r = await fetch(SDK_URL);
    fs.writeFileSync(f, await r.text(), 'utf8');
  }
  return fs.readFileSync(f, 'utf8');
}

/* 本地页面（不是线上页面）：验证的是"改完的代码能不能跑通" */
function readLocalPage() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<script[^>]*src=[^>]*>/g, '').replace(/<\/script>/g, '');
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  return { html, app };
}

/* 轮询等待某个条件成立（默认最多 25 秒）
   为什么不干脆 sleep 固定值：真实云端里 SDK 要先建会话再拉模型目录，
   实测 4~5 秒，且波动不小。写死等待时长只会得到一个"时快时慢"的脆弱脚手架。 */
async function waitFor(fn, { timeout = 25000, interval = 250 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    let ok = false;
    try { ok = !!fn(); } catch (_) { ok = false; }
    if (ok) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/* LIVE 只用来当"站点 origin"（jsdom 需要一个合法 origin 才能用 localStorage），
   请求实际都发到 PUBLIC_CONFIG.endpoint。 */
async function open({ staleSession = false, waitMs = 3000, settle = true } = {}) {
  const { html, app } = readLocalPage();
  const sdk = await loadSdk();

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('error', (...a) => errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')));

  const dom = new JSDOM(html, { url: LIVE + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const W = dom.window;

  // jsdom 没有 fetch / Headers，补上 Node 的（跨 realm 可用）
  W.fetch = (...a) => fetch(...a);
  W.Headers = Headers; W.Request = Request; W.Response = Response;
  W.ReadableStream = ReadableStream; W.TextDecoder = TextDecoder; W.TextEncoder = TextEncoder;
  W.AbortController = AbortController;
  if (!W.matchMedia) W.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  W.scrollTo = () => {};

  if (staleSession) {
    // 线上事故的复现条件：一个"还没过期但已被服务端判废"的会话
    const pk = (app.match(/publishableKey:\s*'([^']+)'/) || [])[1];
    W.localStorage.setItem('workbuddy-cloud.session.' + pk, JSON.stringify({
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.stale.stale',
      refreshToken: 'stale-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      user: { id: 'u-stale' },
    }));
  }

  W.eval(sdk);
  W.eval(app);
  await new Promise((r) => setTimeout(r, 600));
  W.document.dispatchEvent(new W.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((r) => setTimeout(r, waitMs));

  // 关键：等到"模型目录这一轮真的出结果"（成功选中模型，或明确失败）为止。
  // 只等固定时长会误判成"AI 不可用"，那是脚手架自己的 bug，不是应用的。
  if (settle) {
    await waitFor(() => {
      if (!W.state || !W.state.cloud) return false;
      if (W.state.model) return true;
      const s = (W.document.getElementById('ai-status') || {}).textContent || '';
      return /暂不可用|暂无可用模型|未就绪|加载失败/.test(s);
    }, { timeout: 45000 });
  }

  return { W, errors, waitFor };
}

/* 预检：网络不通时，冒烟测试的失败是环境的锅，不该被当成应用的 bug。
   实测同一个接口的耗时在 3.5s ~ 12.7s 之间跳，波动极大。 */
async function preflight(timeoutMs = 30000) {
  const pk = (readLocalPage().app.match(/publishableKey:\s*'([^']+)'/) || [])[1];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(LIVE + '/.cloud/llm/models', {
      headers: { Accept: 'application/json', 'x-wb-webapp-access-key': pk },
      signal: ac.signal,
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, ms, reason: 'HTTP ' + r.status };
    const j = await r.json();
    const n = Array.isArray(j) ? j.length : 0;
    return { ok: n > 0, ms, reason: n > 0 ? '' : '模型目录为空', count: n };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, reason: (e && e.name === 'AbortError') ? ('超时 >' + timeoutMs + 'ms') : String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

/* 抓一次 app 真实发出的请求体，供测速 / 回放使用 */
async function captureCourseRequest() {
  const { html } = readLocalPage();
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://x.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  W.confirm = () => true; W.alert = () => {};
  if (!W.matchMedia) W.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  const notImpl = () => { throw new Error('不应被调用'); };
  let captured = null;
  const query = { select() { return this; }, limit() { return this; }, order() { return this; }, eq() { return this; }, maybeSingle() { return this; },
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
    catch: (r) => Promise.resolve({ data: [], error: null }).catch(r) };
  W.WorkBuddyCloud = {
    createWorkBuddyCloud: () => ({
      llm: {
        models: { list: async () => [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek', enabled: true, maxOutputTokens: 128000 }] },
        chat: { completions: { create(p) { captured = p; return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }; } } },
      },
      auth: {
        getSession: async () => ({ data: null, error: null }),
        getUser: async () => ({ data: null, error: { kind: 'unauthenticated' } }),
        onAuthStateChange: () => () => {},
      },
      database: { from: () => query },
    }),
  };
  W.eval(app);
  await new Promise((r) => setTimeout(r, 400));
  W.document.dispatchEvent(new W.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  const goal = W.document.getElementById('gen-goal');
  if (goal) goal.value = '讲清楚一元二次方程的求根公式怎么来的';
  W.document.getElementById('btn-generate').click();
  await new Promise((r) => setTimeout(r, 300));
  if (!captured) throw new Error('未捕获到请求体（generateCourse 流程可能已变）');
  const body = { ...captured };
  delete body.signal;
  return body;
}

module.exports = { ROOT, LIVE, open, readLocalPage, captureCourseRequest, loadSdk, CACHE, waitFor, preflight };
