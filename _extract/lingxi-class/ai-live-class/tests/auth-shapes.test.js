/* ============================================================
   会话形状契约 + 可访问性 + 移动端导航 回归测试

   背景：SDK 的三种返回结构并不一致，写错不会报错，只会让
   state.user 悄悄变 null（"登录了但像没登录"）。这个文件把
   契约固化下来，避免再次回归。
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

/* 真实 SDK 的三种形状（据 SDK 源码） */
const sessionShape = (id, extra) => Object.assign({
  accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600e3,
  user: { id, isAnonymous: false, raw: {} },
}, extra || {});
const profileShape = (id, email, phone) => ({ id, email, phone, isAnonymous: false, raw: {} });

(async () => {
  const dom = new JSDOM(html, { url: 'https://ai-tutor-live.app.workbuddy.host/', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  W.confirm = () => true; W.alert = () => {};

  // 可切换的桩：默认 getSession 返回 null（未登录）
  const stub = {
    session: null,          // getSession().data
    user: null,             // getUser().data
    pwResult: null,         // signInWithPassword 的返回
    signOutCount: 0,
    throwsGetUser: false,
  };
  W.WorkBuddyCloud = {
    createWorkBuddyCloud() {
      return {
        llm: { models: { list: async () => [{ id: 'm', name: 'M', disabled: false }] }, chat: { completions: { create: () => ({ [Symbol.asyncIterator]() { let d = false; return { next: async () => d ? { done: true } : (d = true, { done: false, value: { choices: [{ delta: { content: 'x' } }] } }) }; } }) } } },
        auth: {
          getSession: async () => ({ data: stub.session, error: null }),
          getUser: async () => {
            if (stub.throwsGetUser) throw new Error('getUser 不可用');
            return stub.user ? { data: stub.user, error: null } : { data: null, error: { kind: 'unauthenticated' } };
          },
          signInWithPassword: async () => stub.pwResult,
          signOut: async () => { stub.signOutCount++; return { error: null }; },
          onAuthStateChange: () => () => {},
        },
        database: { from: () => ({ select: function () { return this; }, limit: function () { return this; }, order: function () { return this; }, eq: function () { return this; }, maybeSingle: function () { return this; }, then: (r) => Promise.resolve({ data: [], error: null }).then(r), catch: (r) => Promise.resolve({ data: [], error: null }).catch(r) }) },
      };
    },
  };

  W.eval(appJs);
  await new Promise((r) => setTimeout(r, 400));

  /* ===== A. pickUser 形状归一 ===== */
  sec('A. pickUser 形状归一');
  const P = W.pickUser;
  const a1 = P(sessionShape('u1'));                       // getSession 的真实形状
  t(!!a1 && a1.id === 'u1', 'A1 能从 session 对象取出 id');
  t(!!a1 && a1.email === null, 'A2 session.user 无 email 时不会编造');
  const a3 = P({ user: profileShape('u2', 'a@b.com', '13800138000') });  // getUser 的形状
  t(!!a3 && a3.email === 'a@b.com', 'A3 能取出 email');
  t(!!a3 && a3.phone === '13800138000', 'A4 能取出 phone');
  t(!!P({ id: 'u3', email: 'x@y.com' }) && P({ id: 'u3', email: 'x@y.com' }).id === 'u3', 'A5 传裸用户对象也能识别');
  t(P(null) === null, 'A6 null 安全');
  t(P({}) === null, 'A7 空对象返回 null');
  t(P({ user: {} }) === null, 'A8 无 id 不伪造用户');
  const a9 = P({ user: { id: 'u4', raw: { phone_number: '+8613800138000' } } });
  t(!!a9 && a9.phone === '13800138000', 'A9 从 raw.phone_number 归一手机号');
  const a10 = P({ user: { id: 'u5', isAnonymous: true } });
  t(!!a10 && a10.anonymous === true, 'A10 保留匿名标记');

  /* ===== B. mergeUser 不降级覆盖 ===== */
  sec('B. mergeUser');
  const m1 = W.mergeUser({ id: 'u1', email: 'a@b.com', phone: '13800138000' }, { id: 'u1', email: null, phone: null });
  t(m1.email === 'a@b.com' && m1.phone === '13800138000', 'B1 缺字段不会覆盖已有资料');
  const m2 = W.mergeUser({ id: 'u1', email: 'a@b.com' }, { id: 'u1', email: 'new@b.com' });
  t(m2.email === 'new@b.com', 'B2 有值则更新');
  t(W.mergeUser({ id: 'u1' }, { id: 'u2', email: 'c@d.com' }).id === 'u2', 'B3 不同用户直接采用新对象');

  /* ===== C. 密码登录：真实返回形状 ===== */
  sec('C. 密码登录（返回 data 就是 session）');
  stub.pwResult = { data: sessionShape('pw1'), error: null };
  stub.user = profileShape('pw1', 'stu@example.com', null);
  W.state.user = null;
  W.openAuthModal();
  W.document.getElementById('au-consent').checked = true;
  W.document.getElementById('au-pw-email').value = 'stu@example.com';
  W.document.getElementById('au-pw-pass').value = 'abcd1234';
  W.document.getElementById('au-pw-submit').click();
  await new Promise((r) => setTimeout(r, 80));
  t(!!W.state.user && W.state.user.id === 'pw1', 'C1 密码登录后 state.user 已就绪（不会变 null）');
  t(!!W.state.user && W.state.user.email === 'stu@example.com', 'C2 密码登录后补齐 email');
  t(W.document.getElementById('auth-modal').hidden === true, 'C3 登录成功后弹窗关闭');

  /* ===== D. 刷新页面：getSession 不带 email，需 getUser 补齐 ===== */
  sec('D. 会话恢复补齐资料');
  stub.session = sessionShape('u9');            // user 里只有 id
  stub.user = profileShape('u9', 'full@example.com', null);
  await W.initAuth();
  t(!!W.state.user && W.state.user.id === 'u9', 'D1 会话恢复出 id');
  t(!!W.state.user && W.state.user.email === 'full@example.com', 'D2 刷新后 email 不丢（走 getUser 补齐）');

  sec('D2. getUser 不可用时的降级');
  stub.session = sessionShape('u9');
  stub.user = null;
  stub.throwsGetUser = true;
  W.state.user = null;
  await W.initAuth();
  t(!!W.state.user && W.state.user.id === 'u9', 'D3 无 getUser 时退回 getSession 仍能识别登录态');
  t(W.state.user.email === null, 'D4 拿不到 email 时为 null 而不是编造');
  stub.throwsGetUser = false;

  /* ===== E. 取不到用户时不得清空已有登录态 ===== */
  sec('E. onSignedIn 异常兜底');
  W.state.user = { id: 'keep', email: 'keep@b.com', phone: null, nickname: null, anonymous: false };
  stub.session = null; stub.user = null;
  await W.onSignedIn(null);
  t(!!W.state.user && W.state.user.id === 'keep', 'E1 兜底失败时保留原登录态，不清空');
  t(/异常/.test(W.document.getElementById('auth-msg').textContent || ''), 'E2 给出明确失败提示');

  /* ===== F. 弹窗可访问性 ===== */
  sec('F. 弹窗可访问性');
  const masks = W.document.querySelectorAll('.modal-mask');
  t(masks.length >= 9, 'F1 页面含 9 个以上弹窗（实测 ' + masks.length + '）');
  // F4 的不变量是"每个弹窗都有可访问的退出路径"，而不是"必须有个 ✕"：
  // 手机号门禁窗刻意不给 ✕（它是要求项，只留「稍后再说」这一条明确出口），
  // 所以这里接受两种形式 —— 带 aria-label 的 .modal-close，或带 aria-label 的底栏按钮。
  let allRole = true, allModal = true, allLabel = true; const noExit = [];
  Array.prototype.forEach.call(masks, (m) => {
    if (m.getAttribute('role') !== 'dialog') allRole = false;
    if (m.getAttribute('aria-modal') !== 'true') allModal = false;
    const b = m.querySelector('.modal-close');
    if (b && b.getAttribute('aria-label')) return;
    const foot = m.querySelector('.modal-foot button[aria-label]');
    if (foot) return;
    allLabel = false;
    noExit.push(m.id || '(无 id)');
  });
  t(allRole, 'F2 所有弹窗都有 role="dialog"');
  t(allModal, 'F3 所有弹窗都有 aria-modal="true"');
  t(allLabel, 'F4 每个弹窗都有可访问的退出路径' + (noExit.length ? '（缺: ' + noExit.join(', ') + '）' : ''));

  const authModal = W.document.getElementById('auth-modal');
  W.state.live = null;
  authModal.hidden = false;
  await new Promise((r) => setTimeout(r, 40));
  t(W.document.body.style.overflow === 'hidden', 'F5 弹窗打开时锁定页面滚动');
  W.document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  t(authModal.hidden === true, 'F6 Esc 可关闭弹窗');
  t(W.document.body.style.overflow !== 'hidden', 'F7 关闭后解除滚动锁');

  sec('F2. 讲解中 Esc 不抢打断');
  const gm = W.document.getElementById('guide-modal');
  gm.hidden = false;
  W.state.live = { busy: true };
  await new Promise((r) => setTimeout(r, 30));
  W.document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  t(gm.hidden === false, 'F8 老师讲解中按 Esc 不关弹窗（留给"打断老师"）');
  W.state.live = null;
  gm.hidden = true;
  await new Promise((r) => setTimeout(r, 30));

  /* ===== G. 移动端导航 ===== */
  sec('G. 移动端导航');
  const burger = W.document.getElementById('btn-burger');
  const mnav = W.document.getElementById('mobile-nav');
  t(!!burger && !!mnav, 'G1 存在导航按钮与抽屉');
  t(burger.getAttribute('aria-expanded') === 'false', 'G2 初始 aria-expanded=false');
  t(mnav.hidden === true, 'G3 初始收起');
  burger.click();
  await new Promise((r) => setTimeout(r, 20));
  t(mnav.hidden === false && burger.getAttribute('aria-expanded') === 'true', 'G4 点击后展开且 aria 同步');
  t(mnav.querySelectorAll('[data-nav]').length >= 5, 'G5 抽屉含全部主导航项');
  const memLink = mnav.querySelector('[data-nav="memory"]');
  t(!!memLink, 'G6 手机端可进入「学习档案」（原先被 display:none 藏掉）');
  memLink.click();
  await new Promise((r) => setTimeout(r, 30));
  t(mnav.hidden === true, 'G7 点击导航项后自动收起');
  t(W.document.getElementById('view-memory').classList.contains('active'), 'G8 抽屉导航确实切了视图');
  t(memLink.classList.contains('active'), 'G9 抽屉内当前项高亮同步');

  /* ===== H. CSS 变量完整性（本次修掉的整类问题） ===== */
  sec('H. CSS 变量完整性');
  const defined = new Set();
  let mm; const defRe = /(--[a-z0-9-]+)\s*:/g;
  while ((mm = defRe.exec(css))) defined.add(mm[1]);
  const undef = new Set();
  const useRe = /var\((--[a-z0-9-]+)([,)])/g;
  while ((mm = useRe.exec(css))) { if (!defined.has(mm[1]) && mm[2] !== ',') undef.add(mm[1]); }
  t(undef.size === 0, 'H1 没有引用未定义的 CSS 变量' + (undef.size ? '（' + [...undef].join(', ') + '）' : ''));
  ['--brand', '--text', '--text-1', '--text-2', '--surface'].forEach((v, i) => {
    t(defined.has(v), 'H' + (i + 2) + ' 已定义语义别名 ' + v);
  });
  t((css.match(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/g) || []).length === 1, 'H7 [hidden] 规则没有重复定义');
  t(/\.nav-burger\s*\{[^}]*display:\s*none/.test(css) && /@media\s*\(max-width:\s*1000px\)[\s\S]{0,400}\.nav-burger\s*\{\s*display:\s*flex/.test(css), 'H8 导航按钮宽屏隐藏、窄屏显示');

  /* ===== I. 关键文案与实际规则一致 ===== */
  sec('I. 文案一致性');
  t(W.authErr({ message: 'password too short' }).includes('至少 8 位'), 'I1 密码错误提示与 8 位规则一致');
  t(!/至少 6 位/.test(appJs), 'I2 代码中不再残留"至少 6 位"');
  t(!/可通过应用内反馈渠道联系我们/.test(appJs), 'I3 隐私政策不再指向不存在的"反馈渠道"');
  t(/应用内「账号与个人信息」面板/.test(appJs), 'I4 隐私政策给出了真实可用的数据权利入口');
  const dlg = appJs.match(/window\.confirm\(\s*'⚠️ 注销[\s\S]{0,700}?\n  \);/);
  t(!!dlg && !/· 你的账号与登录方式/.test(dlg[0]), 'I5 注销确认不再承诺"删除登录方式"（SDK 无此能力）');
  t(!!dlg && /空白账号/.test(dlg[0]), 'I6 注销确认如实说明登录方式会保留为空白账号');
  t(/supportEmail:\s*''/.test(appJs), 'I7 联系邮箱为可配置项，默认不留死链接');

  /* ===== J. DOM 中不得出现重复 id ===== */
  sec('J. DOM 唯一性');
  const dupInDom = () => {
    const seen = {};
    Array.prototype.forEach.call(W.document.querySelectorAll('[id]'), (el) => {
      seen[el.id] = (seen[el.id] || 0) + 1;
    });
    return Object.keys(seen).filter((k) => seen[k] > 1);
  };
  t(dupInDom().length === 0, 'J1 初始 DOM 无重复 id' + (dupInDom().length ? '（' + dupInDom().join(', ') + '）' : ''));
  // 打开全部弹窗后再查一遍：弹窗里也常有重复 id 的结构
  Array.prototype.forEach.call(W.document.querySelectorAll('.modal-mask'), (m) => { m.hidden = false; });
  await new Promise((r) => setTimeout(r, 40));
  t(dupInDom().length === 0, 'J2 全部弹窗打开后仍无重复 id' + (dupInDom().length ? '（' + dupInDom().join(', ') + '）' : ''));
  Array.prototype.forEach.call(W.document.querySelectorAll('.modal-mask'), (m) => { m.hidden = true; });
  await new Promise((r) => setTimeout(r, 40));
  // renderPeople 会重建 #people-list 的 DOM，重建后同样不能出现重复 id
  W.state.live = { muted: false, sharing: false, camOn: false };
  try { W.renderPeople(); } catch (_) {}
  await new Promise((r) => setTimeout(r, 30));
  t(dupInDom().length === 0, 'J3 renderPeople 重建后无重复 id' + (dupInDom().length ? '（' + dupInDom().join(', ') + '）' : ''));
  W.state.live = null;

  /* ===== K. 登录态不能被匿名会话顶掉（P0：进入直播间丢登录态） ===== */
  sec('K. 匿名会话不得覆盖登录态');
  // 实测复现：SDK 发出匿名会话事件（访客 uid='anon'），旧 mergeUser 在 id 不同时
  // 直接 return next → 真实登录态被整个顶掉。进课堂会立刻发 AI 请求，正是该事件易到的时机。
  const realUser = { id: 'u-real', email: 'student@example.com', nickname: '小明', anonymous: false };
  const anonUser = { id: 'anon', anonymous: true };

  t('K1 匿名会话不覆盖已登录用户', (() => {
    const m = W.mergeUser(realUser, anonUser);
    return m && m.id === 'u-real' && m.anonymous === false && m.email === 'student@example.com';
  })());
  t('K2 同一账号合并时 anonymous 不许翻成 true', W.mergeUser(realUser, { id: 'u-real', anonymous: true }).anonymous === false);
  t('K3 同账号补字段仍然生效', (() => {
    const m = W.mergeUser(realUser, { id: 'u-real', nickname: '明明', anonymous: false });
    return m.email === 'student@example.com' && m.nickname === '明明';
  })());
  t('K4 匿名→真实登录必须切换（否则真登录进不去）', W.mergeUser(anonUser, { id: 'u2', email: 'c@d.com', anonymous: false }).id === 'u2');
  t('K5 真实→换账号登录必须切换', W.mergeUser(realUser, { id: 'u3', email: 'e@f.com', anonymous: false }).id === 'u3');
  t('K6 无历史时接受匿名会话（访客首屏）', W.mergeUser(null, anonUser).id === 'anon');
  t('K7 无 next 时保留 prev', W.mergeUser(realUser, null).id === 'u-real');

  // 走真实的 auth 事件回调：确认 state.user 与顶栏都不变
  const cbsK = [];
  const savedAuthK = W.state.cloud && W.state.cloud.auth;
  W.state.cloud = W.state.cloud || {};
  W.state.cloud.auth = {
    onAuthStateChange: (cb) => cbsK.push(cb),
    refreshSession: async () => ({ error: { code: 'invalid_grant' } }),
    getUser: async () => ({ data: { user: { id: 'u-real', email: 'student@example.com' } } }),
    signOut: async () => {},
    getSession: async () => ({ data: { session: null } }),
  };
  W.state.user = { ...realUser };
  await W.initAuth();
  if (cbsK[0]) cbsK[0]('SIGNED_IN', { user: { id: 'anon', isAnonymous: true } });
  t('K8 匿名事件后 state.user 仍是真实账号', W.state.user && W.state.user.id === 'u-real' && W.state.user.anonymous === false);
  W.authUI();
  t('K9 顶栏仍显示已登录（不是"登录/注册"）', /user-chip/.test(W.document.querySelector('#btn-auth').className));
  // SIGNED_OUT 是合法登出，必须仍然生效
  if (cbsK[0]) cbsK[0]('SIGNED_OUT', null);
  t('K10 真正的 SIGNED_OUT 仍会清登录态', W.state.user === null);
  // 被动登出不能静默：用户会以为"莫名其妙被登出"
  const srcAuth = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  t('K11 凭据失效时会明确告知用户', /登录状态已过期，请重新登录/.test(srcAuth));
  t('K12 被动登出有埋点（便于排查"莫名登出"）', /track\('session_expired'/.test(srcAuth) && W.TRACK_EVENTS.indexOf('session_expired') >= 0);
  W.state.cloud.auth = savedAuthK;

  console.log('\nSHAPES_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('SHAPES_ERROR ' + ((e && e.stack) || e)); process.exit(2); });
