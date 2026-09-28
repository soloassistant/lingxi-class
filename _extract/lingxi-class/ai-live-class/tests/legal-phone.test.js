/* 中国法律合规 + 手机号登录 回归测试
   覆盖：告知同意闸门、隐私政策/用户协议内容要点、PIPL 权利（查阅/导出/删除/注销）、
        手机号归一化、短信错误语义化、密码强度、账号面板脱敏、AI 内容标识、未成年人提示 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
const has = (hay, needle, m) => ok(String(hay).indexOf(needle) >= 0, m);

(async () => {
  const dom = new JSDOM(html, { url: 'https://ai-tutor-live.app.workbuddy.host/', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  W.confirm = () => true;
  W.prompt = () => '确认注销';
  W.alert = () => {};

  const store = { student_profiles: [], student_facts: [], student_sessions: [] };
  const calls = { insert: [], update: [], del: [], eq: [] };
  const realDb = {
    from(table) {
      const q = {
        _eq: null,
        select() { return q; }, order() { return q; }, limit() { return q; },
        eq(k, v) { q._eq = { k, v }; calls.eq.push({ table, k, v }); return q; },
        insert(b) { calls.insert.push({ table, body: b }); const rows = Array.isArray(b) ? b : [b];
          const added = rows.map((r, i) => Object.assign({ id: table + '_n' + ((store[table] || []).length + i) }, r));
          (store[table] = store[table] || []).push(...added);
          return mk(table, { data: added.map(r => ({ id: r.id })), error: null }); },
        update(b) { calls.update.push({ table, body: b }); return q; },
        delete() { calls.del.push({ table }); return q; },
        single() { return mk(table, { data: null, error: null }); },
        maybeSingle() { return mk(table, { data: table === 'student_profiles' ? { id: 'p1', sessions_count: 2, total_seconds: 3600, grade: '高一' } : null, error: null }); },
        then(res, rej) { let d = store[table] || [];
          if (q._eq) d = d.filter((r) => String(r[q._eq.k]) === String(q._eq.v));
          return Promise.resolve({ data: d, error: null }).then(res, rej); },
        catch(rej) { return Promise.resolve({ data: [], error: null }).catch(rej); },
      };
      return q;
    },
  };
  function mk(table, result) {
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; },
      single() { return mk(table, result); }, maybeSingle() { return mk(table, result); },
      then(r, j) { return Promise.resolve(result).then(r, j); },
      catch(j) { return Promise.resolve(result).catch(j); },
    };
    return q;
  }

  W.WorkBuddyCloud = {
    createWorkBuddyCloud() {
      return {
        llm: { models: { list: async () => [{ id: 'm', name: 'M', disabled: false }] },
          chat: { completions: { create: () => ({ [Symbol.asyncIterator]() { let d = false; return { next: async () => d ? { done: true } : (d = true, { done: false, value: { choices: [{ delta: { content: '好' } }] } }) }; } }) } } },
        auth: {
          getSession: async () => ({ data: { user: { id: 'u1', phone: '13800138000', user_metadata: {} } }, error: null }),
          onAuthStateChange: () => () => {}, signOut: async () => ({}),
          signInWithPassword: async () => ({ data: null, error: { kind: 'invalid_grant', message: 'bad' } }),
          sendOtp: async () => ({ data: { verificationId: 'v1', isExistingUser: true, verify: async () => ({ data: { user: { id: 'u1', phone: '13800138000' } }, error: null }) }, error: null }),
          verifyOtp: async () => ({ data: { user: { id: 'u1' } }, error: null }),
          resetPasswordForEmail: async () => ({ data: null, error: null }),
        },
        database: realDb,
      };
    },
  };

  const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  W.eval(appJs);
  await new Promise((r) => setTimeout(r, 400));

  // ===== A. 手机号登录 UI 与归一化 =====
  ok(!!W.document.querySelector('#auth-pane-phone'), 'A1 存在手机号登录面板');
  ok(!!W.document.querySelector('#au-ph-phone'), 'A2 存在手机号输入框');
  ok(!!W.document.querySelector('#au-ph-send'), 'A3 存在获取短信验证码按钮');
  ok(!!W.document.querySelector('#au-ph-submit'), 'A4 存在登录/注册按钮');
  const tabs = Array.from(W.document.querySelectorAll('.auth-tab')).map((t) => t.dataset.authTab);
  ok(tabs.indexOf('phone') >= 0, 'A5 页签含手机号登录');
  ok(tabs.indexOf('password') >= 0 && tabs.indexOf('signup') >= 0, 'A6 邮箱登录与注册页签保留');
  ok(W.normalizeCNPhone('13800138000') === '13800138000', 'A7 标准 11 位手机号通过');
  ok(W.normalizeCNPhone('138 0013 8000') === '13800138000', 'A8 含空格可归一化');
  ok(W.normalizeCNPhone('+8613800138000') === '13800138000', 'A9 带国际区号可归一化');
  ok(W.normalizeCNPhone('008613800138000') === '13800138000', 'A10 带 0086 前缀可归一化');
  ok(W.normalizeCNPhone('12345678901') === null, 'A11 非法号段被拒');
  ok(W.normalizeCNPhone('1380013800') === null, 'A12 位数不足被拒');
  ok(W.normalizeCNPhone('') === null, 'A13 空值被拒');
  ok(W.phoneMask('13800138000') === '138****8000', 'A14 手机号脱敏正确');
  ok(W.phoneMask('') === '—', 'A15 空手机号展示占位符');
  // 回归：SDK 回传的是 "+86 13800138000" 这种归一化号，曾因只认 11 位纯数字而显示成 "—"
  ok(W.phoneMask('+86 13800138000') === '138****8000', 'A16 带 +86 与空格的归一化号可脱敏');
  ok(W.phoneMask('+8613800138000') === '138****8000', 'A17 带 +86 无空格的号可脱敏');
  ok(W.phoneMask('+1 4155552671') === '+1 4155552671', 'A18 非中国大陆号段原样展示（不退化成占位符）');

  // ===== B. 告知同意闸门 =====
  ok(!!W.document.querySelector('#au-consent'), 'B1 存在同意勾选框');
  ok(!!W.document.querySelector('#au-consent-wrap'), 'B2 存在同意说明容器');
  const consentHtml = W.document.querySelector('#au-consent-wrap').innerHTML;
  has(consentHtml, '用户协议', 'B3 同意说明含《用户协议》链接');
  has(consentHtml, '隐私政策', 'B4 同意说明含《隐私政策》链接');
  ok(W.document.querySelectorAll('#au-consent-wrap [data-doc]').length === 2, 'B5 两个协议入口均可点击');

  // 未勾选时必须被拦住
  const box = W.document.querySelector('#au-consent');
  box.checked = false;
  W.openAuthModal();
  ok(W.consentChecked() === false, 'B6 默认未勾选');
  ok(W.requireConsent() === false, 'B7 未勾选时 requireConsent 返回 false');
  const msgEl = W.document.querySelector('#auth-msg');
  ok(msgEl && !msgEl.hidden, 'B8 未勾选时给出提示而非静默失败');
  has(msgEl.textContent, '同意', 'B9 提示文案要求先同意协议');
  box.checked = true;
  ok(W.requireConsent() === true, 'B10 勾选后放行');

  // 同意状态持久化 + 版本升级需重新确认
  W.setConsent(true);
  ok(W.hasConsent() === true, 'B11 同意状态写入本地');
  W.setConsent(false);
  ok(W.hasConsent() === false, 'B12 同意状态可撤销');

  // ===== C. 隐私政策内容（PIPL 必备要点）=====
  const pv = W.PRIVACY_DOC.map((s) => s.h + ' ' + s.p.join(' ')).join('\n');
  has(pv, '收集哪些信息', 'C1 说明收集范围');
  has(pv, '如何使用', 'C2 说明使用目的');
  has(pv, '保存期限', 'C3 说明保存期限');
  has(pv, '你的权利', 'C4 明示个人权利');
  has(pv, '查阅', 'C5 含查阅权');
  has(pv, '复制', 'C6 含复制权');
  has(pv, '更正', 'C7 含更正权');
  has(pv, '删除', 'C8 含删除权');
  has(pv, '注销', 'C9 含注销权');
  has(pv, '撤回同意', 'C10 含撤回同意');
  has(pv, '未成年人', 'C11 含未成年人保护');
  has(pv, '14 周岁', 'C12 明示 14 周岁监护人同意');
  has(pv, 'AI 生成', 'C13 说明 AI 处理与内容标识');
  has(pv, '个人信息保护法', 'C14 援引《个人信息保护法》');
  has(pv, '生成式人工智能服务管理暂行办法', 'C15 援引生成式 AI 管理办法');
  ok(/不会收集你的身份证号/.test(pv), 'C16 明示不收集敏感无关信息（最小必要）');
  ok(/不会将你的个人信息用于广告推送/.test(pv), 'C17 明示不用于广告、不出售');

  // ===== D. 用户协议内容 =====
  const tm = W.TERMS_DOC.map((s) => s.h + ' ' + s.p.join(' ')).join('\n');
  has(tm, '实名', 'D1 含实名制要求');
  has(tm, '网络安全法', 'D2 援引《网络安全法》');
  has(tm, '使用规范', 'D3 含使用规范');
  has(tm, '国家安全', 'D4 含违法内容禁止条款');
  has(tm, 'AI 生成内容的说明', 'D5 含 AI 内容责任说明');
  has(tm, '知识产权', 'D6 含知识产权条款');
  has(tm, '免责', 'D7 含免责声明');
  has(tm, '中华人民共和国法律', 'D8 适用中国法律');
  has(tm, '人民法院', 'D9 争议解决走法院');
  has(tm, '学历', 'D10 声明不提供学历认证');

  // ===== E. 弹窗渲染 =====
  W.openDoc('privacy', false);
  ok(W.document.querySelector('#doc-modal').hidden === false, 'E1 隐私政策弹窗可打开');
  has(W.document.querySelector('#doc-title').textContent, '隐私政策', 'E2 弹窗标题正确');
  const bodyHtml = W.document.querySelector('#doc-body').innerHTML;
  has(bodyHtml, '个人信息保护法', 'E3 弹窗正文含法条援引');
  has(bodyHtml, '生效日期', 'E4 弹窗展示生效日期');
  ok(W.document.querySelector('#doc-foot').hidden === true, 'E5 普通查看不显示同意按钮');
  W.openDoc('terms', true);
  ok(W.document.querySelector('#doc-foot').hidden === false, 'E6 从注册处打开时显示同意按钮');
  has(W.document.querySelector('#doc-title').textContent, '用户协议', 'E7 用户协议弹窗标题正确');
  W.closeDoc();
  ok(W.document.querySelector('#doc-modal').hidden === true, 'E8 弹窗可关闭');

  // 同意按钮联动勾选框
  box.checked = false;
  W.setConsent(false);
  W.openDoc('terms', true);
  W.agreeDoc();
  ok(box.checked === true, 'E9 点同意后自动勾选');
  ok(W.hasConsent() === true, 'E10 点同意后落库同意状态');

  // ===== F. 账号与个人信息（PIPL 权利入口）=====
  ok(!!W.document.querySelector('#account-modal'), 'F1 存在账号与个人信息弹窗');
  ok(!!W.document.querySelector('#btn-acct-export'), 'F2 存在导出数据按钮');
  ok(!!W.document.querySelector('#btn-acct-delete'), 'F3 存在注销账号按钮');
  ok(!!W.document.querySelector('#btn-acct-terms'), 'F4 弹窗内可查看用户协议');
  ok(!!W.document.querySelector('#btn-acct-privacy'), 'F5 弹窗内可查看隐私政策');
  ok(!!W.document.querySelector('#btn-mem-account'), 'F6 学习档案页有数据权利入口');

  // 账号面板脱敏
  W.state.user = { id: 'u1', phone: '13800138000' };
  W.state.mem = { profile: { grade: '高一' }, facts: [{ id: 'f1' }, { id: 'f2' }], sessions: [{ id: 's1' }] };
  W.openAccountModal();
  ok(W.document.querySelector('#account-modal').hidden === false, 'F7 账号面板可打开');
  const ident = W.document.querySelector('#acct-ident').textContent;
  has(ident, '138****8000', 'F8 面板中手机号已脱敏');
  ok(ident.indexOf('13800138000') < 0, 'F9 面板不显示完整手机号');
  has(W.document.querySelector('#acct-mem').textContent, '2 条记忆', 'F10 面板展示记忆条数');
  has(W.document.querySelector('#acct-mem').textContent, '1 节课', 'F11 面板展示上课记录数');

  // 邮箱也脱敏
  W.state.user = { id: 'u1', email: 'zhangsan@example.com' };
  W.openAccountModal();
  const ident2 = W.document.querySelector('#acct-ident').textContent;
  ok(ident2.indexOf('zhangsan@') < 0, 'F12 面板不显示完整邮箱');
  has(ident2, '***@', 'F13 邮箱已脱敏');

  // ===== G. 注销流程 =====
  W.state.user = { id: 'u1', phone: '13800138000' };
  W.state.mem = { profile: {}, facts: [], sessions: [] };
  store.student_facts = [{ id: 'f1', owner_id: 'u1' }];
  store.student_sessions = [{ id: 's1', owner_id: 'u1' }];
  calls.del.length = 0; calls.eq.length = 0;
  await W.deleteMyAccount();
  ok(calls.del.length === 3, 'G1 注销时删除三张表的个人数据');
  const delTables = calls.del.map((d) => d.table).sort().join(',');
  ok(delTables === 'student_facts,student_profiles,student_sessions', 'G2 覆盖画像/记忆/课堂记录');
  const ownerEq = calls.eq.filter((e) => e.k === 'owner_id' && e.v === 'u1');
  ok(ownerEq.length === 3, 'G3 删除条件限定本人 owner_id');
  ok(W.state.user === null, 'G4 注销后登录态清空');
  ok(W.state.mem === null, 'G5 注销后记忆缓存清空');
  ok(W.hasConsent() === false, 'G6 注销后同意状态清除');

  // 注销需要二次确认（输入确认词）
  W.state.user = { id: 'u1' };
  W.prompt = () => '随便打的';
  const before = calls.del.length;
  await W.deleteMyAccount();
  ok(calls.del.length === before, 'G7 确认词不匹配时不执行删除');
  W.prompt = () => '确认注销';

  // ===== H. 密码强度（注册/重置）=====
  const suPass = W.document.querySelector('#au-su-pass');
  ok(!!suPass, 'H1 注册密码框存在');
  has(suPass.getAttribute('placeholder'), '8 位', 'H2 注册密码提示至少 8 位');
  const rsPass = W.document.querySelector('#rs-pass');
  has(rsPass.getAttribute('placeholder'), '8 位', 'H3 重置密码提示至少 8 位');

  // ===== I. 短信错误语义化 =====
  has(W.smsErr({ message: 'phone auth not supported' }), '暂未开通', 'I1 渠道未开通给出明确指引');
  has(W.smsErr({ kind: 'invalid_grant', message: 'x' }), '账号或密码不正确', 'I2 验证失败沿用统一文案');
  has(W.smsErr({ message: 'too many requests' }), '频繁', 'I3 频率限制有专门提示');
  has(W.smsErr({ kind: 'network', message: '' }), '网络', 'I4 网络异常有专门提示');
  has(W.smsErr({ message: 'code expired' }), '过期', 'I5 验证码过期有专门提示');
  const smsNotExist = W.smsErr({ message: 'phone auth not supported' });
  ok(smsNotExist.indexOf('已注册') < 0 && smsNotExist.indexOf('未注册') < 0, 'I6 不暴露手机号注册状态');

  // ===== J. AI 内容标识与未成年人提示 =====
  const footHtml = W.document.querySelector('.footer-legal').innerHTML;
  has(footHtml, 'AI 生成', 'J1 页脚明示 AI 生成');
  has(footHtml, '未成年人', 'J2 页脚含未成年人提示');
  has(footHtml, '监护人', 'J3 页脚提示监护人指导');
  ok(W.document.querySelectorAll('.footer-legal [data-doc]').length === 2, 'J4 页脚有协议与政策入口');
  has(W.LEGAL_VERSION, '2026', 'J5 有明确的法律版本日期');

  // ===== K. 不改动既有合规底线 =====
  const src = appJs;
  ok(src.indexOf('signInAnonymously') < 0, 'K1 不含匿名登录');
  ok(src.indexOf('localStorage-only') < 0, 'K2 不含本地假账号');
  ok(!/mock\s*session/i.test(src), 'K3 不含 mock session');
  ok(src.indexOf('createWorkBuddyCloud') >= 0, 'K4 仍走官方云服务 SDK');

  // ===== L. 短信渠道未开通时的优雅降级 =====
  W.state.smsReady = false;
  W.switchAuthTab('phone');
  const tipMsg = W.document.querySelector('#auth-msg');
  has(tipMsg.textContent, '暂未开通', 'L1 未开通短信时明确告知');
  has(tipMsg.textContent, '邮箱登录', 'L2 指引用邮箱登录替代');
  has(tipMsg.textContent, '记忆功能完全一致', 'L3 说明功能不受影响');
  ok(tipMsg.hidden === false, 'L4 提示可见而非静默');
  W.state.smsReady = true;
  W.switchAuthTab('phone');
  ok(W.document.querySelector('#auth-msg').hidden === true, 'L5 通道可用时不再提示');

  /* ===== M. 手机号登记（应用层；平台不支持真绑定） ===== */
  // 平台边界：SDK 无绑定方法，且服务端拒绝 email+phone 并存（已实测）。
  // 因此这里只能"登记到本人档案"，做成断言把边界钉住，避免以后有人误以为是验证过的绑定。
  console.log('\n=== M. 手机号登记 ===');
  ok(typeof W.registerPhone === 'function', 'M1 有 registerPhone');
  ok(typeof W.currentPhone === 'function', 'M2 有 currentPhone');

  // 未登录时拒绝写入（memReady 依赖 state.user，直接清登录态）
  const userBak = W.state.user;
  W.state.user = null;
  const r0 = await W.registerPhone('13800138000');
  ok(!!r0.error, 'M3 未登录时拒绝写入');
  has(r0.error, '登录', 'M4 提示需要先登录');
  W.state.user = userBak;

  // 非法号码不得写入
  const r1 = await W.registerPhone('12345');
  ok(!!r1.error, 'M5 非法号码被拒');
  has(r1.error, '11 位', 'M6 提示 11 位手机号');

  // 合法号码：走 saveProfile 落库；jsdom 无真实库时允许"保存失败"，但绝不能是号码误判
  const memBak = W.state.mem;
  W.state.mem = { profile: null, facts: [], sessions: [] };
  const r2 = await W.registerPhone('138 0013 8000');
  if (r2.ok) {
    ok(r2.ok === '13800138000', 'M7 存入的是归一化后的 11 位');
    ok(W.currentPhone() === '13800138000', 'M8 currentPhone 读回同一值');
    ok(!!(W.state.mem.profile && W.state.mem.profile.phone === '13800138000'), 'M8b 已写回本地 state.mem');
  } else {
    has(r2.error, '保存失败', 'M7b 无库时给出保存失败而非号码错误');
    ok(W.state.mem.profile === null || W.state.mem.profile.phone === undefined, 'M8b 保存失败时不留下脏值');
  }

  // 账号弹窗展示必须脱敏
  W.state.mem = { profile: { phone: '13900139000' }, facts: [], sessions: [] };
  W.renderAcctPhone();
  const shown = W.document.querySelector('#acct-phone-val').textContent;
  ok(!shown.includes('13900139000'), 'M9 账号页不显示完整手机号');
  has(shown, '139****9000', 'M10 账号页显示脱敏手机号');

  // 未登记时展示"未登记"而不是空
  W.state.mem = { profile: null, facts: [], sessions: [] };
  W.renderAcctPhone();
  has(W.document.querySelector('#acct-phone-val').textContent, '未登记', 'M11 未登记时明确显示未登记');
  W.renderAcctPhone();
  has(W.document.querySelector('#btn-acct-phone-edit').textContent, '登记手机号', 'M11b 未登记时按钮文案为"登记手机号"');
  W.state.mem = { profile: { phone: '13900139000' }, facts: [], sessions: [] };
  W.renderAcctPhone();
  has(W.document.querySelector('#btn-acct-phone-edit').textContent, '修改手机号', 'M11c 已登记时按钮文案为"修改手机号"');
  W.state.mem = memBak;

  // 界面必须诚实：不能声称"已通过短信验证"
  const acctHtml = W.document.querySelector('#acct-phone-form').innerHTML;
  has(acctHtml, '暂不支持短信验证', 'M12 界面明示平台不支持短信验证');
  has(acctHtml, '老师联系', 'M13 界面说明手机号用途');
  ok(!/已验证|绑定成功/.test(acctHtml), 'M14 不声称已完成验证或绑定');
  const su3 = W.document.querySelector('#au-su-step3');
  ok(!!su3, 'M15 注册流程有手机号收尾步骤');
  ok(su3.hidden === true, 'M16 收尾步骤默认隐藏');
  // 2026-09-24 起：手机号由"可跳过"改为使用要求。但两点必须守住 ——
  //  ① 注册本身不被阻断（账号已建好，这一步只是补登记；中途关闭也仍可登录）
  //  ② 给"没有手机号"的人一条人工出路，不允许静默跳过
  has(su3.innerHTML, '这是使用要求', 'M17a 收尾步骤明确标注为使用要求');
  ok(!/先跳过/.test(su3.innerHTML), 'M17b 不再提供静默跳过');
  has(su3.innerHTML, '我没有手机号', 'M17c 给无手机号的人一条明确出路');
  has(su3.innerHTML, '人工核对', 'M17d 出路需要人工核对，而非一键绕过');
  has(su3.innerHTML, '不做验证码校验', 'M17e 仍诚实说明不做短信校验');

  console.log('\n=== P. 短信通道表述与实际能力一致（消除自相矛盾） ===');
  // 实测证据：POST /.cloud/auth/v1/verification → 200，返回 verificationId + verify 闭包
  // ⇒ 平台侧确有 OTP 通道；隐私政策里"暂不支持短信验证码通道"是过时表述，会与登录页入口矛盾。
  //   注意本文件顶部 mock 的 sendOtp 也返回 verificationId + verify，同样假设通道存在。
  const srcAll = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  ok(!/暂不支持短信验证码通道/.test(srcAll), 'P1 隐私政策不再声称"暂不支持短信验证码通道"');
  ok(!/不做短信校验<\/b>/.test(pv), 'P2 隐私政策不再声称"不做短信校验"');
  has(pv, '短信验证码核验', 'P3a 隐私政策说明手机号用于登录核验');
  has(pv, '课后联系', 'P3b 隐私政策说明手机号用于课后联系');
  ok(!/短信通道开通后同样可用/.test(tm), 'P4 用户协议不再写"短信通道开通后可用"');
  ok(/手机号登录/.test(W.document.querySelector('#auth-modal').innerHTML), 'P5 登录页短信入口仍保留（确有通道，不该删）');
  has(srcAll, '短信登录暂未开通', 'P6 仍保留通道异常时的兜底提示（防御性，不算矛盾）');
  has(srcAll, '短信登录时这个号', 'P7 登录成功后把已验证手机号写入档案，避免门禁重复索要同一号码');

  console.log('\n=== Q. 协议日期与版本号分离 ===');
  ok(/^20\d\d-\d\d-\d\d$/.test(W.LEGAL_EFFECTIVE || ''), 'Q1 生效日期是纯日期');
  ok(!!W.LEGAL_REVISION && W.LEGAL_REVISION !== W.LEGAL_EFFECTIVE, 'Q2 版本号独立于日期');
  const oldMeta = '生效日期：2026-09-24.2';
  // 只查"展示逻辑"是否还用内部版本键当日期 —— 不能扫全文，
  // 因为解释这段历史的注释里会（应该）保留旧写法作为举例
  ok(/生效日期：' \+ LEGAL_EFFECTIVE/.test(srcAll) && /' · 版本 ' \+ LEGAL_REVISION/.test(srcAll),
    'Q3 展示逻辑改用"生效日期 + 版本"（原来是 ' + oldMeta + '）');

  console.log('\nLEGAL_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('LEGAL_ERROR ' + (e && e.stack || e)); process.exit(2); });
