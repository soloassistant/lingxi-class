/**
 * 未成年人保护合规（对齐 Web 版 535f060 的 R23 标准，适配微信小程序）
 *
 * ===== 三处诚实取舍（都是有意为之，别当漏做）=====
 * ① 监护人步骤是"声明"不是"验证"：我们无法核实操作者就是监护人本人，
 *    所以不把它写成"已核验"——把做不到的事说成做到，正是这次合规要避免的。
 * ② 防沉迷是"提醒"不是"强制断线"：纯前端必然可绕过（清缓存即归零），
 *    界面写"已限制你 2 小时"是虚假宣称，故只做 toast 提醒。
 * ③ 儿童规则是《隐私条款》里的独立章节，不是单独文档（与 Web 版一致）。
 *
 * 本模块可在 Node 里被单测 require：顶层只 require config（无 wx），
 * 所有碰 wx 的函数都在调用时才执行、且包了 try/catch；闸门判定是纯函数。
 */
const config = require('../config.js');

// 改任何法律文案都必须同步 bump，否则老用户不会被要求重新确认（比对用的就是它）
const LEGAL_VERSION = '2026-10-20.1';
const AGE_KEY = 'lingxi_age_declaration_v1';
const USAGE_KEY = 'lingxi_usage_v1';
const USAGE_TICK_MS = 30000; // 30 秒一记，够了；1 秒一记纯浪费

// sec=触发秒数；toast=弹窗短文案（wx.showToast 标题不宜过长）；text=完整表述（供《隐私条款》引用）
const USAGE_MARKS = [
  { sec: 45 * 60, toast: '已学习 45 分钟，起来活动一下～', text: '已经学习 45 分钟了。起来活动一下、看看远处，回来接着上会更有效率。' },
  { sec: 90 * 60, toast: '今日已超 90 分钟，建议休息一下', text: '今天累计使用已超过 90 分钟。建议先停一停 —— 未成年人每次连续使用不宜超过 40 分钟，可由监护人帮忙安排时间。' }
];

const SUPPORT_EMAIL = config.supportEmail || '';
const AGE_HINT = '适龄提示：本产品面向 K12 及国际课程学习者。未满 14 周岁的儿童请在监护人同意并陪同下使用；监护人可随时查阅、更正或删除其被监护儿童的个人信息，见《隐私条款》「儿童个人信息保护规则」。';

/* ---------------- 年龄 / 身份声明（持久化，版本变化需重新声明）---------------- */
function readAgeDeclaration() {
  try {
    const o = wx.getStorageSync(AGE_KEY);
    if (!o || o.version !== LEGAL_VERSION) return null;
    return o;
  } catch (_) { return null; }
}
function saveAgeDeclaration(d) {
  try {
    wx.setStorageSync(AGE_KEY, Object.assign({ version: LEGAL_VERSION, at: Date.now() }, d));
  } catch (_) {}
}
function clearAgeDeclaration() {
  try { wx.removeStorageSync(AGE_KEY); } catch (_) {}
}

/* ---------------- 闸门判定（纯函数，可单测）----------------
   input : { role:'student'|'guardian', minor:bool, contact:string,
             consentChecked:bool, saved:object|null }
   return: { ok:bool, msg:string, declaration:object|null }
   declaration 非空 = 调用方应落盘的声明；null = 无需新写（已存且一致）。 */
function evaluateAgeGate(input) {
  const i = input || {};
  const role = i.role === 'guardian' ? 'guardian' : 'student';
  const minor = !!i.minor && role === 'student';
  const contact = (i.contact || '').trim();
  const consentChecked = !!i.consentChecked;
  const saved = i.saved || null;

  // 与已存声明逐项比对，而不是"存过就放行"：
  // 否则用户把选项从"已满 14 周岁"改成"未满 14 周岁"时闸门毫无反应，监护人确认被静默跳过。
  if (saved && saved.role === role && !!saved.isMinor === minor &&
      (!minor || contact === (saved.guardianContact || ''))) {
    return { ok: true, msg: '', declaration: null };
  }
  if (role === 'guardian') return { ok: true, msg: '', declaration: { role: 'guardian', isMinor: false } };
  if (!minor) return { ok: true, msg: '', declaration: { role: 'student', isMinor: false } };

  // 学生且未满 14 周岁：必须走监护人确认
  if (!contact) return { ok: false, msg: '未满 14 周岁需要监护人确认：请填写监护人手机号或邮箱', declaration: null };
  if (contact.length < 5) return { ok: false, msg: '监护人联系方式看起来不完整，请填写完整的手机号或邮箱', declaration: null };
  if (!consentChecked) return { ok: false, msg: '请由监护人勾选同意《隐私条款》中的「儿童个人信息保护规则」', declaration: null };
  return { ok: true, msg: '', declaration: { role: 'student', isMinor: true, guardianContact: contact.slice(0, 60) } };
}

/* ---------------- 使用时长提醒（只提醒，不强制断线）---------------- */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function readUsage() {
  try {
    const o = wx.getStorageSync(USAGE_KEY);
    if (!o || o.date !== todayStr()) return { date: todayStr(), seconds: 0, marks: [] };
    return { marks: [], seconds: 0, ...o };
  } catch (_) { return { date: todayStr(), seconds: 0, marks: [] }; }
}
function writeUsage(u) {
  try { wx.setStorageSync(USAGE_KEY, u); } catch (_) {}
}
/* 记一格（USAGE_TICK_MS）。返回本次新触发的提醒对象数组（可能为空），由调用方弹 toast。
   只记"登录态"的时间；后台不计（由调用方在 setInterval 里判前台）。 */
function tickUsage(opts) {
  if (!opts || !opts.loggedIn) return [];
  const u = readUsage();
  u.seconds += USAGE_TICK_MS / 1000;
  const hits = [];
  for (const m of USAGE_MARKS) {
    if (u.seconds >= m.sec && u.marks.indexOf(m.sec) < 0) {
      u.marks.push(m.sec);
      hits.push(m);
    }
  }
  writeUsage(u);
  return hits;
}

module.exports = {
  LEGAL_VERSION, AGE_KEY, USAGE_KEY, USAGE_TICK_MS, USAGE_MARKS,
  SUPPORT_EMAIL, AGE_HINT,
  readAgeDeclaration, saveAgeDeclaration, clearAgeDeclaration,
  evaluateAgeGate,
  readUsage, writeUsage, tickUsage, todayStr
};
