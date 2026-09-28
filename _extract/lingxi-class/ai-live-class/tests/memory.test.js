/* 单测：一对一长期记忆（账号 + 云端记忆 + 注入 prompt）
 *
 * 覆盖：
 *   - 记忆注入 system prompt（画像/薄弱点/优势/偏好/进度/上节课）
 *   - 未登录时完全不注入（访客模式不建假身份）
 *   - memoryPromptBlock 的取值与裁剪规则
 *   - 「怎么使用这些记忆」教学指令
 *   - 学习档案页三态渲染（未登录 gate / 加载中 / 有数据）
 *   - 事实按 kind 排序与标签映射、删除按钮渲染
 *   - 上课记录渲染与空态降级
 *   - saveFact/saveProfile/saveSession/deleteFact 的云端调用形状
 *   - authErr 语义化错误（不暴露账号是否存在）
 *   - 注册路径 isExistingUser 时引导登录
 *
 * 运行（Windows）：
 *   $env:NODE_PATH="C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules"
 *   & "C:\...\node.exe" tests\memory.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* ---- 可控的云端桩：记录每次查询，便于断言调用形状 ---- */
const calls = [];
/* 关键：每个链式方法都返回「同一个 thenable builder」，这样
   await db.from(t).select('*').order(...).limit(...) 与 .maybeSingle() 都能直接 await。
   注意 thenable 的 then 必须能被子类链式调用继续拿到（返回 q 本身即可）。 */
function makeQuery(table, result) {
  const q = {
    _table: table,
    _result: result,
    select(cols, opts) { calls.push({ op: 'select', table, cols, opts }); return q; },
    insert(rows) { calls.push({ op: 'insert', table, rows }); return q; },
    update(patch) { calls.push({ op: 'update', table, patch }); return q; },
    delete() { calls.push({ op: 'delete', table }); return q; },
    order(c, o) { calls.push({ op: 'order', table, col: c, asc: o && o.ascending }); return q; },
    limit(n) { calls.push({ op: 'limit', table, n }); return q; },
    eq(c, v) { calls.push({ op: 'eq', table, col: c, val: v }); return q; },
    single() { return makeQuery(table, result); },
    maybeSingle() { return makeQuery(table, result); },
    then(res, rej) { return Promise.resolve(result).then(res, rej); },
    catch(rej) { return Promise.resolve(result).catch(rej); },
  };
  return q;
}

let scripted = {};   // table -> 返回结果
let insertResults = {};  // table -> 结果
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.local/' });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
window.confirm = () => true;
window.alert = () => {};
window.speechSynthesis = {
  getVoices: () => [{ name: 'Xiaoxiao', lang: 'zh-CN' }],
  speak() {}, cancel() {}, onvoiceschanged: null,
};
window.SpeechSynthesisUtterance = function (txt) { this.text = txt; };

window.WorkBuddyCloud = {
  createWorkBuddyCloud: () => ({
    llm: { models: { list: async () => [{ id: 'm', name: 'M', disabled: false }] } },
    auth: {
      getSession: async () => ({ data: null, error: null }),
      onAuthStateChange: () => () => {},
      signOut: async () => ({}),
      signInWithPassword: async () => ({ data: null, error: null }),
      signInWithOtp: async () => ({ data: null, error: null }),
      sendOtp: async () => ({ data: { verificationId: 'v', isExistingUser: false }, error: null }),
      verifyOtp: async () => ({ data: null, error: null }),
      resetPasswordForEmail: async () => ({ data: null, error: null }),
    },
    database: {
      from(table) {
        // 懒读取：scripted 可能在这些断言之间被改写
        const res = scripted[table] !== undefined ? scripted[table] : { data: [], error: null };
        const q = makeQuery(table, res);
        q.insert = (rows) => {
          calls.push({ op: 'insert', table, rows });
          const out = insertResults[table] !== undefined ? insertResults[table] : { data: [{ id: 1 }], error: null };
          return makeQuery(table, out);
        };
        return q;
      },
    },
  }),
};

const sc = document.createElement('script');
sc.textContent = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
document.head.appendChild(sc);

const W = window;

(async () => {
  // ★ 关键：app.js 在 document.readyState === 'loading' 时把 init 挂到 DOMContentLoaded，
  //   而脚本刚 append 完那一刻 readyState 仍是 loading。必须等一轮事件循环，
  //   否则 state.cloud 还是 null，所有依赖它的断言都会假失败。
  await new Promise((r) => setTimeout(r, 300));

  console.log('=== A. 未登录：绝不注入记忆（访客不建假身份） ===');
  W.state.user = null;
  W.state.mem = null;
  t('初始化后 state.cloud 就绪', !!W.state.cloud && !!W.state.cloud.database);
  const course = {
    id: 'c1', title: '一元二次方程', subject: '数学', grade: '高一', level: '基础巩固',
    duration: '45 分钟', system: 'cn', systemName: '国内课程', boards: [], boardNames: [],
    outline: { stages: [{ name: '导入', duration: '5 分钟', content: '热身' }] },
  };
  t('memReady 未登录为 false', W.memReady() === false);
  t('memoryPromptBlock 未登录为空', W.memoryPromptBlock() === '');
  let sys = W.teacherSystemPrompt(course);
  t('prompt 不含长期记忆块', !sys.includes('长期记忆'));
  t('prompt 不含记忆使用规则', !sys.includes('怎么使用这些记忆'));

  console.log('\n=== B. 登录后：记忆注入 prompt ===');
  W.state.user = { id: 'u1', email: 'a@b.com' };
  W.state.mem = {
    profile: {
      grade: '高一', system: '国内课程', goal: '期末冲刺', level: '中等',
      teaching_style: '喜欢先看例题', pace: '反应快可加速',
      sessions_count: 3, total_seconds: 3600,
    },
    facts: [
      { id: 1, kind: 'weak', content: '判别式 Δ<0 时容易判断错根的个数', subject: '数学', topic: '判别式', hits: 2, last_seen: '2026-09-20T10:00:00Z' },
      { id: 2, kind: 'misconception', content: '会把两根之积和两根之和记反', subject: '数学' },
      { id: 3, kind: 'strength', content: '因式分解很熟练，可以直接用', subject: '数学' },
      { id: 4, kind: 'preference', content: '更喜欢从生活例子引入', subject: '' },
      { id: 5, kind: 'progress', content: '已学完求根公式，还没学韦达定理的应用', subject: '数学' },
    ],
    sessions: [{ id: 9, course_title: '二次函数入门', subject: '数学', comment: '基础扎实，可以加速。' }],
  };
  t('memReady 登录后为 true', W.memReady() === true);
  const blk = W.memoryPromptBlock();
  t('包含画像学段', blk.includes('高一'));
  t('包含学习目标', blk.includes('期末冲刺'));
  t('包含偏好风格', blk.includes('先看例题'));
  t('包含薄弱点', blk.includes('判别式'));
  t('包含易错点', blk.includes('两根之和'));
  t('包含优势', blk.includes('因式分解'));
  t('包含偏好', blk.includes('生活例子'));
  t('包含进度', blk.includes('韦达定理'));
  t('包含上课次数与时长', blk.includes('3 节课') && blk.includes('60 分钟'));
  t('包含上节课标题', blk.includes('二次函数入门'));
  sys = W.teacherSystemPrompt(course);
  t('prompt 注入长期记忆块', sys.includes('关于这个学生的长期记忆'));
  t('prompt 注入记忆使用规则', sys.includes('怎么使用这些记忆'));
  t('规则要求自然衔接不念档案', sys.includes('不要机械念档案'));
  t('规则要求针对薄弱点追问', sys.includes('主动设计追问'));
  t('规则要求以学生当前说法为准', sys.includes('以学生现在说的为准'));

  console.log('\n=== C. 记忆为空时不自称有记忆 ===');
  W.state.mem = { profile: null, facts: [], sessions: [] };
  t('空记忆 → block 为空', W.memoryPromptBlock() === '');
  t('空记忆 → prompt 不含记忆块', !W.teacherSystemPrompt(course).includes('关于这个学生的长期记忆'));
  W.state.mem = null;

  console.log('\n=== D. 事实按 kind 排序 + 标签映射 ===');
  t('FACT_KINDS 有 weak/strength/preference/progress', !!(W.FACT_KINDS.weak && W.FACT_KINDS.strength && W.FACT_KINDS.preference && W.FACT_KINDS.progress));
  t('weak 标签为薄弱点', W.FACT_KINDS.weak.label === '薄弱点');
  t('misconception 复用红色样式', W.FACT_KINDS.misconception.cls === 'k-weak');

  console.log('\n=== E. 学习档案页：未登录 gate ===');
  W.state.user = null;
  W.state.memLoaded = false;
  W.switchView('memory');
  t('gate 可见', document.getElementById('mem-gate').hidden === false);
  t('body 隐藏', document.getElementById('mem-body').hidden === true);

  console.log('\n=== F. 学习档案页：加载中 → 有数据 ===');
  W.state.user = { id: 'u1', email: 'a@b.com' };
  W.state.memLoaded = false;
  W.state.mem = null;
  scripted = {
    student_profiles: { data: { id: 1, grade: '高一', system: '国内课程', goal: '期末冲刺', level: '中等', teaching_style: '先看例题', pace: '加速', sessions_count: 3, total_seconds: 3600 }, error: null },
    student_facts: { data: [
      { id: 11, kind: 'weak', content: '判别式符号易错', subject: '数学', topic: '判别式', hits: 2, last_seen: '2026-09-20T10:00:00Z' },
      { id: 12, kind: 'strength', content: '因式分解熟练', subject: '数学' },
    ], error: null },
    student_sessions: { data: [
      { id: 21, course_title: '二次函数入门', subject: '数学', grade: '高一', duration_secs: 1500,
        mastered: ['配方法'], weak_points: ['判别式'], homework: ['10 题判别式'], comment: '基础扎实', created_at: '2026-09-20T10:00:00Z' },
    ], error: null },
  };
  await W.loadMemory(true);
  t('loadMemory 写入 state.mem', !!W.state.mem && !!W.state.mem.profile);
  t('memLoaded 置真', W.state.memLoaded === true);
  W.renderMemoryView();
  const gate = document.getElementById('mem-gate');
  const body = document.getElementById('mem-body');
  t('登录后 gate 隐藏', gate.hidden === true);
  t('登录后 body 可见', body.hidden === false);
  const pb = document.getElementById('mem-profile-body').innerHTML;
  t('画像渲染学段', pb.includes('高一'));
  t('画像渲染目标', pb.includes('期末冲刺'));
  t('画像渲染风格', pb.includes('先看例题'));
  const sb = document.getElementById('mem-stats-body').innerHTML;
  t('统计渲染课程数', sb.includes('>3<'));
  t('统计渲染分钟数', sb.includes('>60<'));
  const fh = document.getElementById('mem-facts').innerHTML;
  t('事实渲染薄弱点', fh.includes('判别式符号易错'));
  t('事实渲染优先级标签', fh.includes('薄弱点') && fh.includes('优势'));
  t('事实带学科元信息', fh.includes('数学'));
  t('事实带删除按钮', fh.includes('data-fact-del="11"'));
  t('weak 排在 strength 之前', fh.indexOf('判别式符号易错') < fh.indexOf('因式分解熟练'));
  const sh = document.getElementById('mem-sessions').innerHTML;
  t('上课记录渲染标题', sh.includes('二次函数入门'));
  t('上课记录渲染已掌握', sh.includes('配方法'));
  t('上课记录渲染作业', sh.includes('10 题判别式'));
  t('上课记录渲染时长', sh.includes('25 分钟'));

  console.log('\n=== F2. 知识点掌握度图谱（buildMastery + renderMastery） ===');
  const fx = [
    { kind: 'strength', topic: '因式分解', confidence: 0.9 },
    { kind: 'weak', topic: '判别式', confidence: 0.7 },
    { kind: 'misconception', topic: '韦达定理', confidence: 0.8 },
    { kind: 'progress', topic: '函数图像', confidence: 0.5 },
    { kind: 'preference', topic: '喜欢先看例题' },   // 与掌握度无关，忽略
    { kind: 'weak' },                                 // 无 topic，忽略
  ];
  const m = W.buildMastery(fx);
  const byTopic = Object.fromEntries(m.map((x) => [x.topic, x.level]));
  t('misconception 定为待巩固', byTopic['韦达定理'] === 'need');
  t('weak 定为待巩固', byTopic['判别式'] === 'need');
  t('progress 定为学习中', byTopic['函数图像'] === 'learning');
  t('strength 定为已掌握', byTopic['因式分解'] === 'mastered');
  t('preference 不计入掌握度', !('喜欢先看例题' in byTopic));
  t('无 topic 的事实不计入', m.length === 4);
  t('待巩固排在已掌握之前', m.findIndex((x) => x.level === 'need') < m.findIndex((x) => x.level === 'mastered'));
  // 同一知识点既有优势又有薄弱 → 最差信号胜出（不能算已掌握）
  const m2 = W.buildMastery([{ kind: 'strength', topic: '二次函数', confidence: 0.9 }, { kind: 'weak', topic: '二次函数', confidence: 0.4 }]);
  t('同知识点 strength+weak → 待巩固', m2.length === 1 && m2[0].level === 'need');

  W.renderMastery(W.state.mem.facts);
  const mh = document.getElementById('mem-mastery').innerHTML;
  t('掌握度卡渲染知识点', mh.includes('判别式'));
  t('掌握度卡标记待巩固', mh.includes('待巩固'));
  W.renderMastery([]);
  t('掌握度空态有引导文案', document.getElementById('mem-mastery').innerHTML.includes('还没有知识点记录'));

  console.log('\n=== G. 学习档案页：空态降级 ===');
  scripted = {
    student_profiles: { data: null, error: null },
    student_facts: { data: [], error: null },
    student_sessions: { data: [], error: null },
  };
  await W.loadMemory(true);
  W.renderMemoryView();
  t('无画像 → 引导文案', document.getElementById('mem-profile-body').innerHTML.includes('还没有画像'));
  t('无事实 → 空态', document.getElementById('mem-facts').innerHTML.includes('还没有记住的事'));
  t('无记录 → 空态', document.getElementById('mem-sessions').innerHTML.includes('还没有上课记录'));
  t('统计仍显示 0', document.getElementById('mem-stats-body').innerHTML.includes('>0<'));

  console.log('\n=== H. 云端写入：saveFacts 去重与调用形状 ===');
  calls.length = 0;
  scripted.student_facts = { data: [{ id: 77, content: '判别式符号易错', hits: 1, confidence: 0.6 }], error: null };
  insertResults.student_facts = { data: [{ id: 88 }, { id: 89 }], error: null };
  const n = await W.saveFacts([
    { kind: 'weak', content: '判别式符号易错', topic: '判别式' },      // 命中已有 → update
    { kind: 'strength', content: '因式分解熟练' },                      // 新增 → insert
    { kind: 'weak', content: '因式分解熟练' },                          // 同批重复 → 去重
  ]);
  const upd = calls.find((c) => c.op === 'update' && c.table === 'student_facts');
  const ins = calls.find((c) => c.op === 'insert' && c.table === 'student_facts');
  t('命中已有走 update', !!upd);
  t('update 提升 confidence', !!upd && upd.patch.confidence > 0.6);
  t('update 累加 hits', !!upd && upd.patch.hits === 2);
  t('新事实走 insert', !!ins);
  t('insert 已去重（2 条→1 条）', !!ins && ins.rows.length === 1, ins ? String(ins.rows.length) : 'no insert');
  t('insert 带 subject 归属', !!ins && ins.rows[0].content === '因式分解熟练');
  t('saveFacts 返回写入条数', n >= 2, String(n));

  console.log('\n=== I. 云端写入：saveProfile upsert ===');
  calls.length = 0;
  scripted.student_profiles = { data: [{ id: 5, sessions_count: 2, total_seconds: 900 }], error: null };
  insertResults.student_profiles = { data: [{ id: 5 }], error: null };
  await W.saveProfile({ _addSessions: 1, _addSeconds: 600, grade: '高一' });
  const pu = calls.find((c) => c.op === 'update' && c.table === 'student_profiles');
  t('已有画像走 update', !!pu);
  t('sessions_count 累加', !!pu && pu.patch.sessions_count === 3);
  t('total_seconds 累加', !!pu && pu.patch.total_seconds === 1500);
  t('内部字段不落库', !!pu && pu.patch._addSessions === undefined && pu.patch._addSeconds === undefined);
  t('带 updated_at', !!pu && !!pu.patch.updated_at);

  calls.length = 0;
  scripted.student_profiles = { data: [], error: null };   // 无画像 → 走 insert
  await W.saveProfile({ _addSessions: 1, _addSeconds: 300 });
  const pi = calls.find((c) => c.op === 'insert' && c.table === 'student_profiles');
  t('无画像走 insert', !!pi);
  t('首次 sessions_count 直接为增量', !!pi && pi.rows.sessions_count === 1);

  console.log('\n=== J. 云端写入：saveSession / deleteFact ===');
  calls.length = 0;
  scripted.student_sessions = { data: [], error: null };
  insertResults.student_sessions = { data: [{ id: 300 }], error: null };
  await W.saveSession({
    courseTitle: '一元二次方程', subject: '数学', grade: '高一', durationSecs: 1800,
    mastered: ['配方法'], weakPoints: ['判别式'], homework: ['10 题'],
    cards: [{ q: 'q', a: 'a' }], reviewPlan: ['今晚复习'], comment: '很好',
  });
  const si = calls.find((c) => c.op === 'insert' && c.table === 'student_sessions');
  t('上课记录 insert', !!si);
  t('时长落库', !!si && si.rows.duration_secs === 1800);
  t('掌握度落库', !!si && si.rows.mastered[0] === '配方法');
  t('复习计划落库', !!si && si.rows.review_plan[0] === '今晚复习');

  calls.length = 0;
  scripted.student_facts = { data: [{ id: 11 }], error: null };
  const delOk = await W.deleteFact(11);
  t('删除事实成功', delOk === true);
  t('删除带 eq(id)', calls.some((c) => c.op === 'eq' && c.col === 'id' && c.val === 11));

  scripted.student_facts = { data: [], error: null };   // RLS 拦下 → 空数组
  const delFail = await W.deleteFact(999);
  t('RLS 拦截时返回 false（不当成功）', delFail === false);

  console.log('\n=== K. authErr 语义化，不暴露账号存在性 ===');
  t('密码错误 → 账号或密码不正确', W.authErr({ kind: 'invalid_grant', message: 'bad' }) === '账号或密码不正确');
  t('未认证 → 账号或密码不正确', W.authErr({ kind: 'unauthenticated' }) === '账号或密码不正确');
  t('网络错误 → 稍后重试', W.authErr({ kind: 'network' }).includes('稍后重试'));
  t('验证码过期', W.authErr({ message: 'code expired' }).includes('验证码'));
  const pwErr = W.authErr({ message: 'password too short' });
  t('密码太短提示 8 位', pwErr.includes('至少 8 位'));
  t('密码太短提示需含字母数字', pwErr.includes('字母') && pwErr.includes('数字'));
  t('不会回显原始 message 里的邮箱', !W.authErr({ kind: 'network', message: 'user a@b.com failed' }).includes('a@b.com'));

  console.log('\n=== L. 登录态 UI ===');
  W.state.user = { id: 'u1', email: 'student@example.com' };
  W.authUI();
  const ab = document.getElementById('btn-auth');
  t('登录后显示 user-chip', ab.classList.contains('user-chip'));
  t('chip 显示邮箱前缀', ab.innerHTML.includes('student'));
  t('chip 有首字母头像', ab.innerHTML.includes('uc-av'));
  t('登录后不显示登录文案', !ab.textContent.includes('登录 / 注册'));
  // 回归：手机号用户曾经显示成 "—"（SDK 给的是 "+86 13800138000"，掩码函数认不出）
  W.state.user = { id: 'u2', phone: '13800138000' };
  W.authUI();
  t('手机号用户 chip 显示脱敏手机号', ab.innerHTML.includes('138****8000'));
  t('手机号用户 chip 不显示占位符 "—"', !ab.innerHTML.includes('—'));
  W.state.user = { id: 'u3', phone: '+86 13900139000' };
  W.authUI();
  t('手机号用户带区号也只显示脱敏号', ab.innerHTML.includes('139****9000'));
  W.state.user = null;
  W.authUI();
  t('登出后回到登录按钮', ab.textContent.trim() === '登录 / 注册');

  console.log('\n=== M. 会话恢复 / 登出清理 ===');
  const realDb = W.state.cloud.database;
  W.state.cloud = { auth: { signOut: async () => ({}), getSession: async () => ({ data: null }), onAuthStateChange: () => () => {} }, database: realDb };
  W.state.user = { id: 'u1', email: 'a@b.com' };
  W.state.mem = { profile: { grade: '高一' }, facts: [], sessions: [] };
  W.state.memLoaded = true;
  calls.length = 0;
  await W.doSignOut();
  t('登出清空 user', W.state.user === null);
  t('登出清空 mem', W.state.mem === null);
  t('登出重置 memLoaded', W.state.memLoaded === false);

  console.log('\n=== N. 注册路径：老用户引导到登录（不暴露存在性） ===');
  W.state.cloud = {
    auth: {
      sendOtp: async () => ({ data: { verificationId: 'v', isExistingUser: true }, error: null }),
      getSession: async () => ({ data: null }), onAuthStateChange: () => () => {}, signOut: async () => ({}),
    },
    database: realDb,
  };
  document.getElementById('au-su-email').value = 'old@example.com';

  // 合规要求：未勾选同意前，注册流程应被拦下（不得收集个人信息）
  W.setConsent(false);
  const cbox = document.getElementById('au-consent');
  if (cbox) cbox.checked = false;
  document.getElementById('au-su-send').click();
  await new Promise((r) => setTimeout(r, 30));
  t('未同意协议时不发起注册请求', document.getElementById('auth-msg').textContent.includes('同意'));

  // 勾选同意后正常走注册路径
  if (cbox) cbox.checked = true;
  document.getElementById('au-su-send').click();
  await new Promise((r) => setTimeout(r, 30));
  const msg = document.getElementById('auth-msg');
  t('提示已有账号请登录', msg.textContent.includes('已有账号'));
  t('不出现"未注册"字样', !msg.textContent.includes('未注册'));
  t('切到密码登录页签', document.getElementById('auth-pane-password').classList.contains('active'));
  t('邮箱已带入登录框', document.getElementById('au-pw-email').value === 'old@example.com');

  console.log('\n=== O. 访客模式：不建任何假身份 ===');
  W.state.user = null;
  W.continueAsGuest();
  t('访客不写 state.user', W.state.user === null);
  t('访客 memReady 为 false', W.memReady() === false);

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
