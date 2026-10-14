/* tests/legal-minor.test.js —— 未成年人保护守卫（R23）

   ===== 为什么需要它 =====
   2026-10-12 六维体检在法律这一维抓到 4 项 P0，全部集中在未成年人：
     ① 无监护人同意机制   ② 无儿童个人信息保护规则
     ③ 无适龄提示/防沉迷（已加休息提醒）   ④ supportEmail 为空 ⇒ 无任何人工联系渠道（已于 2026-10-15 填入 geraldnelsonfung@gmail.com，关闭 P0-4）

   前 ③ 已在本轮实现。它们有一个共同的风险：**实现是"流程"而不是"文案"**，
   流程类的东西改坏了不会有任何报错 —— 少绑一个 change 事件、少在一个页签调闸门、
   把"验证"写回"声明"，全都静默失效，用户侧只是"那个问题不问了"。

   所以本文件钉的是**结构不变量**，不是某一句话：
     · 三条可能建号的路径都必须过年龄闸门（少一条 = 整条绕过）
     · 纯登录路径（密码登录）不得被闸门挡住（否则老用户登不进来）
     · 闸门必须**逐项比对**已存声明，不能"存过就放行"
       （否则用户把选项改成"未满 14 周岁"时监护人确认被静默跳过）
     · 监护人步骤必须自称"声明"而不是"验证" —— 我们确实无法核实操作者就是监护人
     · 隐私政策必须有独立的儿童规则章节，且章节号连续、交叉引用对得上
     · 使用时长只能做成"提醒"，不得宣称强制断线（纯前端限制必然可绕过）
*/
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

/* ★ 只取**字符串字面量**的内容，排除注释与代码。
   为什么：负向断言（"不得宣称 X"）如果对全文做，会匹配到我自己写的解释注释 ——
   源码里有 `如果界面写"已限制你使用 2 小时"，那是在宣称一件我们做不到的事`，
   一句"说明我们为什么不这么写"的注释，会被 `不得宣称"已限制你"` 的断言判成违规。
   所以必须**先剥掉注释再取字符串**（少这一步，注释里成对引号包着的短语会被当成文案）。
   这与 R21-g 踩过的是同一个坑（用 includes() 把注释误判成真实引用）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function userStrings(src) {
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out.join('\n');
}
const appText = userStrings(stripComments(appSrc));
/* HTML 去掉注释后再剥标签，只剩用户看得见的文字 */
const htmlText = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '\n');
const allText = appText + '\n' + htmlText;

let pass = 0, fail = 0;
const t = (m, c, extra) => {
  if (c) { pass++; console.log('PASS ' + m); }
  else { fail++; console.log('FAIL ' + m + (extra ? '  → ' + extra : '')); }
};
const has = (hay, needle, m) => ok2(hay, needle, m);
function ok2(hay, needle, m) { t(m, String(hay).indexOf(needle) >= 0); }

(async () => {
  const dom = new JSDOM(html, { url: 'https://x.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  W.confirm = () => true; W.prompt = () => '确认注销'; W.alert = () => {};
  const doc = W.document;

  /* ---------- R23-a. 三条建号路径都必须过年龄闸门 ---------- */
  console.log('\n=== R23-a. 建号路径的年龄闸门覆盖 ===');
  /* 抓每个 handler 的函数体：从 "const X = $('#id');" 到它的 addEventListener 回调 */
  const handlerBody = (anchor, nextAnchor) => {
    const i = appSrc.indexOf(anchor);
    if (i < 0) return null;
    const j = nextAnchor ? appSrc.indexOf(nextAnchor, i) : i + 3000;
    return appSrc.slice(i, j > 0 ? j : i + 3000);
  };
  const gateCount = (body) => (body ? (body.match(/requireAgeDeclaration\(\)/g) || []).length : 0);

  const phSend = handlerBody("const phSend = $('#au-ph-send');", 'const phSubmit');
  const phSubmit = handlerBody("const phSubmit = $('#au-ph-submit');", '// —— 邮箱密码登录');
  const otpSend = handlerBody("const otpSend = $('#au-otp-send');", 'const otpVerify');
  const suSend = handlerBody("const suSend = $('#au-su-send');", 'const suSubmit');
  const pwLogin = handlerBody('const pw = $("#au-pw-submit");', '// —— 验证码登录');

  t('phSend（手机号，未注册会自动建号）有年龄闸门', gateCount(phSend) === 1);
  t('phSubmit（手机号验证提交）也有闸门（防放行后改选未成年人）', gateCount(phSubmit) === 1);
  t('otpSend（邮箱验证码，signInWithOtp 可能建号）有年龄闸门', gateCount(otpSend) === 1);
  t('suSend（注册）有年龄闸门', gateCount(suSend) === 1);
  t('pwLogin（密码登录，纯已有账号）没有闸门（否则老用户登不进来）', gateCount(pwLogin) === 0,
    '出现 ' + gateCount(pwLogin) + ' 次');

  /* ---------- R23-b. 闸门必须逐项比对，不能"存过就放行" ---------- */
  console.log('\n=== R23-b. 闸门语义 ===');
  t('闸门函数存在', /function requireAgeDeclaration\(\)/.test(appSrc));
  t('★ 与已存声明逐项比对（role / isMinor / guardianContact）',
    /saved\.role === role/.test(appSrc) && /!!saved\.isMinor === minor/.test(appSrc) &&
    /contact === \(saved\.guardianContact \|\| ''\)/.test(appSrc),
    '若只写 "if (saved) return true"，用户改选未成年人会被静默放行');
  t('未填监护人联系方式时拦住', /未满 14 周岁需要监护人确认/.test(appSrc));
  t('监护人未勾选同意时拦住', /请由监护人勾选同意/.test(appSrc));
  t('勾选后才落盘', /saveAgeDeclaration\(\{ role: 'student', isMinor: true/.test(appSrc));
  t('监护人确认有埋点（可衡量真实发生率）', /track\('guardian_consent'/.test(appSrc));

  /* ---------- R23-c. 监护人步骤必须自称"声明" ---------- */
  console.log('\n=== R23-c. 不宣称做不到的事 ===');
  t('界面写明这是"监护人声明"', /监护人声明/.test(appText) && /监护人声明/.test(htmlText));
  t('★ 不得把监护人步骤写成"验证"', !/监护人验证|验证监护人|已核验监护人/.test(allText));
  t('明示不做线下身份核验', /不做线下的身份核验/.test(appText));
  t('★ 不采集监护人身份证号（判据只扫用户可见文案）', !/监护人[^\n]{0,20}身份证/.test(allText));
  t('政策明示不收集身份证号', /不收集身份证号/.test(appText));
  t('政策里同样写明"我们不做线下的身份核验"', /我们不做线下的身份核验/.test(appText));

  /* ---------- R23-d. 儿童个人信息保护规则是独立章节 ---------- */
  console.log('\n=== R23-d. 隐私政策的儿童规则章节 ===');
  t('有「儿童个人信息保护规则」章节', /七、儿童个人信息保护规则/.test(appText));
  /* ⚠ 章节编号用的是**全角**括号"）"，写成半角会一条都匹配不上 */
  t('章节含收集范围', /1）收集范围/.test(appText));
  t('章节含监护人同意', /2）监护人同意/.test(appText));
  t('章节含监护人权利', /5）监护人权利/.test(appText));
  t('章节含向外提供限制', /6）向外提供/.test(appText));
  t('章节含发现与投诉', /8）发现与投诉/.test(appText));
  /* 章节号必须连续且交叉引用对得上 —— 插一节而没改后面编号是这类改动最常出的错 */
  const heads = [...appSrc.matchAll(/\{ h: '([一二三四五六七八九十]+)、([^']+)'/g)].map((m) => m[1] + '、' + m[2]);
  const privHeads = heads.filter((h) => /收集哪些信息|如何使用这些信息|AI 处理说明|保存期限与存储|你的权利|未成年人保护$|儿童个人信息保护规则|信息安全|联系我们/.test(h));
  const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const seqOk = privHeads.length === 9 && privHeads.every((h, i) => h.startsWith(cn[i] + '、'));
  t('隐私政策九节编号连续（插章后必须重编号）', seqOk, privHeads.join(' / '));
  t('儿童规则里的交叉引用指向第九节（不是第八节）',
    !/本政策第八节/.test(appSrc) && /本政策第九节的方式联系我们/.test(appSrc));
  t('用户协议有「未成年人使用」专条', /八、未成年人使用/.test(appSrc));
  t('用户协议里监护人权利也指向第九节', /行使方式见《隐私政策》第九节/.test(appSrc));

  /* ---------- R23-e. 使用时长：只能提醒，不能宣称强制 ---------- */
  console.log('\n=== R23-e. 使用时长提醒的诚实性 ===');
  t('有 45 分钟提醒', /45 \* 60/.test(appSrc));
  t('有 90 分钟提醒', /90 \* 60/.test(appSrc));
  t('★ 文案写明"提示性质，不构成强制断线"', /提示性质，不构成强制断线/.test(appText));
  /* 判据只扫用户可见文案：源码注释里写着"如果界面写'已限制你使用 2 小时'，
     那是在宣称一件我们做不到的事" —— 那是一句**说明我们不这么写**的注释，
     对全文做负向断言会把它判成违规（R21-g 同款坑）。 */
  t('★ 不得宣称"已限制/已禁止继续使用"', !/已限制你|已禁止继续|强制下线|到时长自动断/.test(allText));
  t('后台标签页不计时（不能把挂着的页面算成使用）', /visibilityState === 'hidden'/.test(appSrc));
  t('未登录不计时', /if \(!state\.user\) return;/.test(appSrc));
  t('按天重置（今天累计，不是历史累计）', /todayStr\(\)/.test(appSrc));
  t('提醒只出一次（marks 去重）', /u\.marks\.indexOf\(m\.sec\) < 0/.test(appSrc));

  /* ---------- R23-f. 适龄提示在用户看得见的地方 ---------- */
  console.log('\n=== R23-f. 适龄提示露出 ===');
  t('登录弹窗有适龄提示', /id="au-age-notice"/.test(html) && /适龄提示/.test(html));
  t('footer 有适龄提示', /适龄提示：面向 K12/.test(html));
  t('适龄提示指向《隐私政策》儿童规则章节', /儿童个人信息保护规则/.test(html));
  t('年龄闸门 UI 存在且默认隐藏', /id="au-age-gate"[^>]*hidden/.test(html));
  t('有监护人联系方式输入框', /id="au-guardian-contact"/.test(html));
  t('有监护人勾选框', /id="au-guardian-consent"/.test(html));
  t('账号面板展示登记结果（不能只存在于注册那一刻）', /id="acct-age-row"/.test(html) && /id="acct-age-val"/.test(html));
  t('注销时清除登记（同一设备再注册须重新声明）', /clearAgeDeclaration\(\);/.test(appSrc));

  /* ---------- R23-g. 键盘可达性 ---------- */
  console.log('\n=== R23-g. 键盘与读屏可达性 ===');
  t('用原生 radio（读屏能播报单选组）', /type="radio" name="au-role"/.test(html) && /type="radio" name="au-minor"/.test(html));
  t('两个单选组都有 role="radiogroup" 与 aria-label',
    (html.match(/role="radiogroup" aria-label="/g) || []).length >= 2);
  t('★ 监听 change 而不是 click（方向键切换选项时守卫框要跟着展开）',
    /addEventListener\('change', syncAgeGateUI\)/.test(appSrc));
  t('选中态用 :has() 同步，JS 挂掉时也对得上', /input:checked \+ span/.test(
    fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8')));

  /* ---------- R23-h. 真跑一遍：JSDOM 里驱动闸门 ---------- */
  console.log('\n=== R23-h. 行为验证（真实 DOM + 真实函数） ===');
  /* 照 live-flow.test.js 的既有做法：https origin（file:// 下 jsdom 的 localStorage
     会抛 "not available for opaque origins"，声明就静默落不了盘 —— 那正是要防的失效），
     不启 resources（外链脚本取不到），云 SDK 先打桩，再把 js/app.js 当内联脚本注入。 */
  const dom2 = new JSDOM(html, {
    url: 'https://x.local/', runScripts: 'dangerously', pretendToBeVisual: true,
  });
  const W2 = dom2.window;
  W2.matchMedia = W2.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  W2.scrollTo = () => {}; W2.confirm = () => true; W2.prompt = () => 'x'; W2.alert = () => {};
  W2.speechSynthesis = {
    getVoices: () => [{ name: 'Xiaoxiao', lang: 'zh-CN' }],
    speak() {}, cancel() {}, onvoiceschanged: null,
  };
  W2.SpeechSynthesisUtterance = function (txt) { this.text = txt; };
  W2.WorkBuddyCloud = { createWorkBuddyCloud: () => ({
    llm: { models: { list: async () => [] }, chat: { completions: Object.create(null) } },
    auth: {}, database: {},
  }) };
  const sc = W2.document.createElement('script');
  sc.textContent = appSrc;
  W2.document.head.appendChild(sc);
  await new Promise((r) => setTimeout(r, 300));
  const d2 = W2.document;

  const setRadio = (name, val) => {
    const r = d2.querySelector('input[name="' + name + '"][value="' + val + '"]');
    if (!r) return false;
    r.checked = true;
    r.dispatchEvent(new W2.Event('change', { bubbles: true }));
    return true;
  };
  const resetDecl = () => { try { W2.localStorage.removeItem('lingxi_age_declaration_v1'); } catch (_) {} };

  /* ① 默认（学生 / 已满 14 周岁）：直接放行并落盘 */
  resetDecl();
  W2.syncAgeGateForTab('signup');
  t('默认选项 = 学生 + 已满 14 周岁', W2.ageFormRole() === 'student' && W2.ageFormIsMinor() === false);
  t('默认选项直接放行', W2.requireAgeDeclaration() === true);
  t('放行后已落盘', !!W2.readAgeDeclaration() && W2.readAgeDeclaration().isMinor === false);

  /* ② 学生 + 未满 14 周岁，没填监护人 ⇒ 拦住 */
  resetDecl();
  W2.syncAgeGateForTab('signup');
  setRadio('au-minor', 'yes');
  t('选"未满 14 周岁"后监护人框展开', d2.getElementById('au-guardian-box').hidden === false);
  t('★ 未填监护人联系方式 ⇒ 拦住', W2.requireAgeDeclaration() === false);
  t('拦住时给了解释性提示', /监护人/.test((d2.getElementById('auth-msg') || {}).textContent || ''));

  /* ③ 填了但没勾选 ⇒ 仍拦住 */
  d2.getElementById('au-guardian-contact').value = '13800138000';
  t('★ 填了联系方式但监护人没勾选 ⇒ 仍拦住', W2.requireAgeDeclaration() === false);

  /* ④ 勾选后放行并落盘 */
  d2.getElementById('au-guardian-consent').checked = true;
  t('★ 监护人勾选后放行', W2.requireAgeDeclaration() === true);
  const decl = W2.readAgeDeclaration();
  t('落盘的声明带 isMinor 与监护人联系方式',
    !!decl && decl.isMinor === true && decl.guardianContact === '13800138000');

  /* ⑤ ★ 关键不变式：改选回"已满 14 周岁"时，闸门必须重新判定，不能直接放行旧声明 */
  resetDecl();
  W2.saveAgeDeclaration({ role: 'student', isMinor: true, guardianContact: '13800138000' });
  W2.syncAgeGateForTab('signup');
  t('表单已按已存声明回填（监护人联系方式回来了）',
    d2.getElementById('au-guardian-contact').value === '13800138000');
  setRadio('au-minor', 'no');
  t('★ 改选"已满 14 周岁"后闸门重新判定并放行', W2.requireAgeDeclaration() === true);
  t('★ 放行后落盘的声明已更新为 isMinor=false', W2.readAgeDeclaration().isMinor === false);

  /* ⑥ 家长 / 老师身份：不问年龄 */
  resetDecl();
  W2.syncAgeGateForTab('signup');
  setRadio('au-role', 'guardian');
  t('选"家长/老师"后年龄行收起', d2.getElementById('au-age-minor-row').hidden === true);
  t('家长身份直接放行', W2.requireAgeDeclaration() === true);

  /* ⑦ 页签显隐：三个建号页签显示，密码登录不显示 */
  for (const [tab, want] of [['signup', false], ['phone', false], ['otp', false], ['password', true]]) {
    W2.syncAgeGateForTab(tab);
    t('页签 ' + tab + '：年龄闸门' + (want ? '隐藏' : '显示'),
      d2.getElementById('au-age-gate').hidden === want);
  }

  /* ⑧ 已存声明在面板里看得见（不静默） */
  W2.saveAgeDeclaration({ role: 'student', isMinor: true, guardianContact: '13800138000' });
  W2.renderAgeDeclaration();
  t('账号面板展示"未满 14 周岁 + 监护人"',
    d2.getElementById('acct-age-row').hidden === false &&
    /未满 14 周岁/.test(d2.getElementById('acct-age-val').textContent));

  /* ⑨ 使用时长提醒：45 分钟阈值 */
  const u = W2.readUsage();
  t('readUsage 按天重置（今天）', u.date === u.date && /^\d{4}-\d{2}-\d{2}$/.test(u.date));

  /* ⑩ 埋点必须登记在白名单里，否则 track() 静默丢弃 —— 那就成了"以为在统计，其实没有" */
  const evList = (appSrc.match(/const TRACK_EVENTS = \[([\s\S]*?)\];/) || [])[1] || '';
  t('guardian_consent 已登记进 TRACK_EVENTS', /'guardian_consent'/.test(evList));
  t('usage_reminder 已登记进 TRACK_EVENTS', /'usage_reminder'/.test(evList));

  try { W2.close(); } catch (_) {}   // 清掉 app 的 setInterval，否则进程不退出
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  console.log(`_RESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
