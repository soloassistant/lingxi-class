// 未成年人保护合规守卫（对齐 Web 版 R23；小程序端静态分析 + 纯函数单测，纯 Node 可跑）
// 运行：node _test/test-legal-minor.js
// 覆盖：监护人同意闸门 / 儿童个人信息保护规则 / 适龄提示 / 防沉迷提醒 / 联系邮箱 / 诚实表述
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const MP = path.join(BASE, 'miniprogram');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }
function exists(p) { return fs.existsSync(p); }

console.log('\n=== 1. 合规模块 utils/legal.js ===');
const legalSrc = read(path.join(MP, 'utils', 'legal.js'));
assert(legalSrc.length > 0, 'utils/legal.js 存在');
assert(/LEGAL_VERSION\s*=\s*'/.test(legalSrc), '定义 LEGAL_VERSION（文案变更需 bump，否则老用户不重新确认）');
assert(/function evaluateAgeGate/.test(legalSrc), '闸门判定是纯函数 evaluateAgeGate（可单测）');
assert(/45 \* 60/.test(legalSrc) && /90 \* 60/.test(legalSrc), '防沉迷含 45 / 90 分钟两档');
assert(/USAGE_TICK_MS/.test(legalSrc), '防沉迷计时粒度 USAGE_TICK_MS');
assert(/SUPPORT_EMAIL/.test(legalSrc) && /AGE_HINT/.test(legalSrc), '导出 SUPPORT_EMAIL 与 AGE_HINT');
// "声明 vs 验证"要看**用户可见文案**（闸门弹窗 + 隐私条款的 WXML），不是看模块注释
const gateWxml1 = read(path.join(MP, 'components', 'age-gate', 'age-gate.wxml'));
const legalDoc1 = read(path.join(MP, 'pages', 'legal', 'legal.wxml'));
assert(/监护人声明/.test(gateWxml1) && /监护人声明/.test(legalDoc1), '用户可见文案把监护人步骤称作"声明"');
assert(!/验证监护人|已核验监护人/.test(legalSrc + gateWxml1 + legalDoc1), '★ 不得把监护人步骤写成"验证 / 已核验监护人"');

console.log('\n=== 2. 联系邮箱 config.js ===');
const configSrc = read(path.join(MP, 'config.js'));
assert(/supportEmail:\s*'[^']*@[^']*\.[a-z]+'/.test(configSrc), 'config.supportEmail 配置为真实邮箱');

console.log('\n=== 3. 监护人同意闸门组件 age-gate ===');
['age-gate.js', 'age-gate.wxml', 'age-gate.json', 'age-gate.wxss'].forEach(f =>
  assert(exists(path.join(MP, 'components', 'age-gate', f)), 'age-gate/' + f + ' 存在'));
const agJs = read(path.join(MP, 'components', 'age-gate', 'age-gate.js'));
const agWxml = read(path.join(MP, 'components', 'age-gate', 'age-gate.wxml'));
assert(/evaluateAgeGate/.test(agJs), 'age-gate 判定走 legal.evaluateAgeGate');
assert(/监护人手机号或邮箱/.test(agWxml), 'age-gate 含监护人联系方式输入');
assert(/onConsentChange|guardianConsent/.test(agWxml), 'age-gate 含监护人同意勾选');

console.log('\n=== 4. 首屏接入（index）===');
const idxJs = read(path.join(MP, 'pages', 'index', 'index.js'));
const idxWxml = read(path.join(MP, 'pages', 'index', 'index.wxml'));
const idxJson = read(path.join(MP, 'pages', 'index', 'index.json'));
assert(/maybeShowAgeGate/.test(idxJs) && /onAgeGatePass/.test(idxJs), 'index.js 接入闸门显隐');
assert(/<age-gate/.test(idxWxml) && /showAgeGate/.test(idxWxml), 'index.wxml 挂 <age-gate>');
assert(/"age-gate"/.test(idxJson), 'index.json 注册 age-gate 组件');
assert(/privacy_agreed/.test(idxJs), '闸门在隐私同意之后才问（不绕过隐私弹窗）');

console.log('\n=== 5. 防沉迷接入（app.js）===');
const appSrc = read(path.join(MP, 'app.js'));
assert(/startUsageReminder/.test(appSrc) && /tickUsage/.test(appSrc), 'app.js 启动防沉迷计时');
assert(/onShow\(\)/.test(appSrc) && /onHide\(\)/.test(appSrc), 'app.js 有前后台生命周期（后台不计时）');
assert(/_fg/.test(appSrc), 'app.js 用 _fg 标记前台');

console.log('\n=== 6. 儿童规则 + 适龄提示 + 邮箱（legal 页）===');
const legalWxml = read(path.join(MP, 'pages', 'legal', 'legal.wxml'));
assert(/儿童个人信息保护规则/.test(legalWxml), 'legal 页含「儿童个人信息保护规则」专章');
assert(/与前述条款不一致的，以本规则为准/.test(legalWxml), '儿童规则写明"不一致以本规则为准"');
assert(/适龄提示/.test(legalWxml), 'legal 页含适龄提示');
assert(/监护人声明/.test(legalWxml), 'legal 页写明监护人步骤是"声明"');
assert(/supportEmail/.test(legalWxml), 'legal 页联系邮箱从单一数据源渲染');
assert(!/不会主动收集未成年人的个人信息/.test(legalWxml), '★ 移除"不会主动收集未成年人个人信息"的不实表述');

console.log('\n=== 7. 我的页展示（profile）===');
const profJs = read(path.join(MP, 'pages', 'profile', 'profile.js'));
const profWxml = read(path.join(MP, 'pages', 'profile', 'profile.wxml'));
assert(/syncAgeAndContact/.test(profJs) && /editAgeDeclaration/.test(profJs), 'profile.js 展示并可修改声明');
assert(/ageDecl/.test(profWxml) && /supportEmail/.test(profWxml), 'profile.wxml 展示声明与联系邮箱');

console.log('\n=== 8. 闸门判定单测（evaluateAgeGate 纯函数）===');
global.wx = {
  _s: {},
  getStorageSync(k) { return this._s[k]; },
  setStorageSync(k, v) { this._s[k] = v; },
  removeStorageSync(k) { delete this._s[k]; }
};
const legal = require(path.join(MP, 'utils', 'legal.js'));
assert(legal.evaluateAgeGate({ role: 'guardian' }).ok === true, '家长 / 老师身份直接放行');
assert(legal.evaluateAgeGate({ role: 'student', minor: false }).ok === true, '学生已满 14 周岁放行');
const g1 = legal.evaluateAgeGate({ role: 'student', minor: true, contact: '', consentChecked: false });
assert(g1.ok === false && /监护人/.test(g1.msg), '★ 未填监护人联系方式 ⇒ 拦住并提示');
const g2 = legal.evaluateAgeGate({ role: 'student', minor: true, contact: '13800138000', consentChecked: false });
assert(g2.ok === false, '★ 填了联系方式但监护人未勾选同意 ⇒ 仍拦住');
const g3 = legal.evaluateAgeGate({ role: 'student', minor: true, contact: '13800138000', consentChecked: true });
assert(g3.ok === true && g3.declaration && g3.declaration.isMinor === true, '★ 监护人勾选后放行并落盘声明');
assert(legal.evaluateAgeGate({ role: 'student', minor: true, contact: 'abc', consentChecked: true }).ok === false, '监护人联系方式过短 ⇒ 拦住');
const g5 = legal.evaluateAgeGate({ role: 'student', minor: false, saved: { role: 'student', isMinor: false } });
assert(g5.ok === true && g5.declaration === null, '已存声明一致 ⇒ 放行且不重复落盘');
const g6 = legal.evaluateAgeGate({ role: 'student', minor: true, contact: '', consentChecked: false, saved: { role: 'student', isMinor: false } });
assert(g6.ok === false, '★ 把选项从"已满 14"改成"未满 14" ⇒ 不静默跳过，重新要求监护人确认');

console.log('\n=== 9. 防沉迷计时单测（tickUsage，wx mock）===');
const key = legal.USAGE_KEY, today = legal.todayStr();
wx._s[key] = { date: today, seconds: 45 * 60 - 30, marks: [] };
const h1 = legal.tickUsage({ loggedIn: true });
assert(h1.length === 1 && h1[0].sec === 45 * 60, '跨过 45 分钟触发一次休息提醒');
assert(legal.tickUsage({ loggedIn: true }).length === 0, '同一档位不重复提醒');
wx._s[key] = { date: today, seconds: 45 * 60 - 30, marks: [] };
assert(legal.tickUsage({ loggedIn: false }).length === 0, '未登录不计时');

console.log('\n========================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
