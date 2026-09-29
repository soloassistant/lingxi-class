/* R16 验证：诊断范围化 —— 出题、定级、推荐、授课都不许跨体系
   ------------------------------------------------------------
   报告原文的两个症状：
     ① 首页默认进未限定 courseId 的测评，从 176 条跨 7 个体系的内容里随机抽 10 题；
     ② 把这次总分变成一个**全局** userLevel，所有课程授课都用它。
   于是"雅思考得好"会改掉数学课的授课难度。推荐逻辑还从没读过已学记录。

   这组测试分四块，都跑**真实代码**（真页面 + 真云函数），不是 grep 源码：
     A. quiz 页：出题范围、定级落点、推荐池与已学排序
     B. saveLevel / submitGoal：等级按课程归档，且不被别的写入抹掉
     C. getRoadmap：等级说法按体系如实描述；兜底任务 courseId 真实存在
     D. sendWeeklyReport：周报带上"这等级是哪门课的"

   其中 A 组会在**全部 22 门课**上逐门验证"绝不混题"，
   并用"把某门课的题删空"来验证它不会拿别的体系的题来凑。

   运行：node _test/test-scope-level.js
   ============================================================ */
'use strict';
const Module = require('module');
const path = require('path');
const { createDb } = require('./mock-wx-server-sdk');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const CF_DIR = path.join(ROOT, 'cloudfunctions');

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (typeof cond !== 'boolean') {
    fail++; console.log('FAIL ' + label + '  ← 断言写法错误：条件必须是 boolean（收到 ' + typeof cond + '）');
    return;
  }
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

/* ---------------------------------------------------------------- 页面测试桩 */

// 支持 'a.b' 与 'a[0]' / 'a[k]' 两种 setData 路径写法（quiz 页两种都用了）
function setByPath(obj, key, val) {
  const parts = String(key).replace(/\[([^\]]*)\]/g, '.$1').split('.').filter(s => s !== '');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
  return obj;
}

function makeStorage(initial) {
  const m = Object.assign({}, initial || {});
  return {
    _map: m,
    getStorageSync(k) { return m[k] === undefined ? '' : m[k]; },
    setStorageSync(k, v) { m[k] = v; },
    removeStorageSync(k) { delete m[k]; }
  };
}

/* 真加载一个页面（json/js/wxml 里 js 才是行为所在），返回可调用的实例 */
function loadPage(rel, opts) {
  opts = opts || {};
  const calls = [];
  const ui = [];
  const storage = opts.storage || makeStorage();
  let captured = null;
  const globalData = Object.assign({ hasLogin: false }, opts.globalData || {});

  const saved = { Page: global.Page };
  global.getApp = () => ({ globalData });
  global.Page = (o) => { captured = o; };
  global.wx = {
    getStorageSync: storage.getStorageSync,
    setStorageSync: storage.setStorageSync,
    removeStorageSync: storage.removeStorageSync,
    cloud: {
      callFunction(o) {
        calls.push(o);
        if (typeof opts.cloud === 'function') return Promise.resolve(opts.cloud(o) || {});
        return Promise.resolve({ result: { code: 0 } });
      }
    },
    showToast(o) { ui.push({ kind: 'toast', o }); },
    showModal(o) { ui.push({ kind: 'modal', o }); if (o && o.success) o.success({ confirm: true }); },
    navigateTo(o) { ui.push({ kind: 'nav', o }); },
    switchTab(o) { ui.push({ kind: 'tab', o }); },
    requestSubscribeMessage() {},
    getStorageInfoSync() { return { keys: Object.keys(storage._map) }; }
  };

  const p = path.join(MP, rel);
  delete require.cache[require.resolve(p)];
  require(p);

  global.Page = saved.Page;
  /* ★ getApp / wx 必须**常驻**，不能在 require 后就还原：
     页面里的 `const app = getApp()` 在 require 时求值，但 `wx.xxx()` 都是**调用时**才找全局。
     还原掉的话，后面的 setStorageSync 会抛 ReferenceError，
     而页面里大量 `try { wx.setStorageSync() } catch (e) {}` 会把它**静默吞掉** ——
     测试于是全绿，而真实代码根本没执行（假绿就是这么来的）。 */
  global.getApp = () => ({ globalData });

  if (!captured) throw new Error('页面没有调用 Page(): ' + rel);

  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch) {
    Object.keys(patch || {}).forEach(k => setByPath(this.data, k, patch[k]));
  };
  return { inst, calls, ui, storage, globalData };
}

const tick = () => new Promise(r => setTimeout(r, 0));
const coursesData = require(path.join(MP, 'data/courses.js'));
const ALL_COURSES = coursesData.courses || [];
const ALL_KP = coursesData.knowledge || [];

/* ---------------------------------------------------------------- 云函数桩 */

const origLoad = Module._load;
let currentCtx = { OPENID: 'o_student' };
let mockCloud = null;
const aiPrompts = [];

function buildCloud(db, callFunctionImpl) {
  return {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
    callFunction: callFunctionImpl || (async () => ({ result: { code: 0 } }))
  };
}

function loadFn(name, db, callFunctionImpl) {
  mockCloud = buildCloud(db, callFunctionImpl);
  const fnPath = path.join(CF_DIR, name, 'index.js');
  delete require.cache[require.resolve(fnPath)];
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return mockCloud;
    return origLoad.call(this, request, parent, isMain);
  };
  const fn = require(fnPath);
  Module._load = origLoad;
  return fn;
}

/* ================================================================ 开始 */

(async () => {

  /* 桩自检（故意放在最前面）：
     页面在**调用时**才去找 wx，桩必须常驻。这里先证明"写入真的能落到 storage" ——
     否则页面里 `try { wx.setStorageSync() } catch (e) {}` 会把 ReferenceError 吞掉，
     后面所有"没有写入某个 key"的断言都会**假绿**。 */
  {
    const probe = loadPage('pages/quiz/quiz.js', {});
    let got = null;
    try { global.wx.setStorageSync('__probe__', 7); got = probe.storage.getStorageSync('__probe__'); }
    catch (e) { got = 'ERR:' + e.message; }
    t('A0 桩自检：wx 常驻且 setStorageSync 真的落到 storage', got === 7, String(got));
  }

  /* ============================ A 组：quiz 页 ============================ */
  sec('A. quiz 页：出题范围 / 定级落点 / 推荐池');

  {
    const { inst, storage } = loadPage('pages/quiz/quiz.js', {});
    inst.onLoad({});

    t('A1 不带 courseId 时进入"选范围"，不再默认开考', inst.data.needScope === true);
    t('A2 不带 courseId 时一题都不出（不静默混题）', inst.data.questions.length === 0,
      '实际出了 ' + inst.data.questions.length + ' 题');
    t('A3 选范围界面列出了全部体系', inst.data.systems.length === coursesData.systems.length);

    // 选体系 → 只列该体系的课程
    inst.pickScopeSystem({ currentTarget: { dataset: { id: 'ielts' } } });
    t('A4 选体系后只列该体系的课程',
      inst.data.scopeCourses.length > 0 && inst.data.scopeCourses.every(c => c.systemId === 'ielts'),
      JSON.stringify(inst.data.scopeCourses.map(c => c.courseId || c.id)));
    t('A5 体系列表里没有别的体系的课',
      inst.data.scopeCourses.every(c => ALL_COURSES.some(x => x.id === c.id && x.systemId === 'ielts')));

    // 选课程 → 开始诊断
    inst.pickScopeCourse({ currentTarget: { dataset: { id: 'ielts_listening' } } });
    t('A6 选定课程后开始出题', inst.data.questions.length > 0 && inst.data.needScope === false);
    t('A7 题目全部属于选定的这门课',
      inst.data.questions.every(q => q.courseId === 'ielts_listening'),
      JSON.stringify([...new Set(inst.data.questions.map(q => q.courseId))]));

    // 逐门课验证：全部 22 门都不混题
    let mixed = [];
    for (const c of ALL_COURSES) {
      const r = loadPage('pages/quiz/quiz.js', {});
      r.inst.onLoad({ courseId: c.id });
      const bad = r.inst.data.questions.filter(q => q.courseId !== c.id);
      if (bad.length) mixed.push(c.id + '(混入 ' + [...new Set(bad.map(q => q.courseId))].join(',') + ')');
      if (r.inst.data.questions.length === 0) mixed.push(c.id + '(没出题)');
    }
    t('A8 全部 ' + ALL_COURSES.length + ' 门课逐门验证：出题池严格等于该课程',
      mixed.length === 0, mixed.join(' ; '));

    // 反向：把某门课的题删空 → 不许拿别的体系的题来凑
    const sysQuizCount = ALL_KP.filter(k => k.quiz && k.quiz.question).length;
    const removed = [];
    for (let i = ALL_KP.length - 1; i >= 0; i--) {
      if (ALL_KP[i].courseId === 'sat_math') { removed.push(ALL_KP.splice(i, 1)[0]); }
    }
    t('A9 前置：确实删掉了 sat_math 的题（否则 A10 空过）', removed.length > 0 && ALL_KP.length < sysQuizCount);

    const empty = loadPage('pages/quiz/quiz.js', {});
    empty.inst.onLoad({ courseId: 'sat_math' });
    t('A10 该课没有题时如实说"还没配好"，不拿别的体系的题凑',
      empty.inst.data.questions.length === 0 && empty.inst.data.scopeEmpty === true,
      '出题数=' + empty.inst.data.questions.length);
    t('A11 该课没题时仍留在选范围页（不进入空卷答题）',
      empty.inst.data.needScope === true);

    // 还原数据
    removed.forEach(k => ALL_KP.push(k));
    t('A12 前置数据已还原', ALL_KP.length === sysQuizCount);
  }

  /* --------------------------- 定级落点 --------------------------- */
  {
    // 让答题全对，走完整 doSubmit
    const { inst, storage, calls } = loadPage('pages/quiz/quiz.js', {
      initialStorage: { x: 1 },
      globalData: { hasLogin: false }
    });
    inst.onLoad({ courseId: 'ielts_speaking' });
    inst.data.questions.forEach((q, i) => { inst.data.answers[i] = q.answerIndex; });
    inst.doSubmit();

    t('A13 等级写在 userLevel:<courseId> 上',
      storage.getStorageSync('userLevel:ielts_speaking') !== '', String(storage.getStorageSync('userLevel:ielts_speaking')));
    t('A14 不再写全局 userLevel 键（留着就会被跨范围读）',
      !('userLevel' in storage._map), Object.keys(storage._map).join(','));
    t('A15 也不再写全局 userLevelName 键', !('userLevelName' in storage._map));
    t('A16 最近一次测评单独存一份，且带上课程 id',
      storage.getStorageSync('userLevelRecent') !== '' &&
      storage.getStorageSync('userLevelRecentCourseId') === 'ielts_speaking');

    // 再测另一门课：两份等级并存，互不覆盖
    const other = loadPage('pages/quiz/quiz.js', { storage });
    other.inst.onLoad({ courseId: 'alevel_mech' });
    other.inst.data.questions.forEach((q, i) => { other.inst.data.answers[i] = q.answerIndex; });
    other.inst.doSubmit();

    t('A17 第二门课的等级独立存放，不覆盖第一门课',
      storage.getStorageSync('userLevel:ielts_speaking') !== '' &&
      storage.getStorageSync('userLevel:alevel_mech') !== '' &&
      storage.getStorageSync('userLevel:ielts_speaking') === storage.getStorageSync('userLevel:alevel_mech'),
      'ielts_speaking=' + storage.getStorageSync('userLevel:ielts_speaking') +
      ' alevel_mech=' + storage.getStorageSync('userLevel:alevel_mech'));
    t('A18 最近一次测评仍指向"最后测的那门课"',
      storage.getStorageSync('userLevelRecentCourseId') === 'alevel_mech');
    t('A19 两次测评后全局 userLevel 键始终不存在', !('userLevel' in storage._map));

    // 无范围时不写"没有范围的等级"
    const noScope = loadPage('pages/quiz/quiz.js', {});
    noScope.inst.doSubmit();  // questions 为空 → 直接 return，不进 doSubmit 逻辑
    const keys = Object.keys(noScope.storage._map);
    t('A20 空卷提交不产生任何等级键', keys.filter(k => k.indexOf('userLevel') === 0).length === 0, keys.join(','));
  }

  /* --------------------------- 推荐池与已学排序 --------------------------- */
  {
    const courseItems = ALL_KP.filter(k => k.courseId === 'igcse_math' && k.quiz && k.quiz.question);
    // 故意把"原本排在最前面的 3 个"标成已学：
    // 老代码（不读已学记录）一定会把这 3 个推出来，新代码必须把它们让到后面。
    const learnedIds = courseItems.slice(0, 3).map(k => k.id);
    t('A21 前置：该课有足够的题，且构造了 3 个"已学"知识点',
      courseItems.length >= 5 && learnedIds.length === 3, learnedIds.join(','));

    const cloudStub = (o) => {
      if (o.name === 'getUserProgress') {
        return { result: { code: 0, list: learnedIds.map(id => ({ itemId: id })) } };
      }
      return { result: { code: 0 } };
    };

    const { inst } = loadPage('pages/quiz/quiz.js', { globalData: { hasLogin: true }, cloud: cloudStub });
    inst.onLoad({ courseId: 'igcse_math' });
    // 故意只答对一半（<70）→ 走"薄弱课程"分支，最能暴露 restItems 跨范围
    inst.data.questions.forEach((q, i) => { inst.data.answers[i] = (i % 2 === 0) ? q.answerIndex : (q.answerIndex + 1) % q.options.length; });
    inst.doSubmit();
    await tick(); await tick();

    const plan = inst.data.recommendPlan || [];
    t('A22 推荐方案非空（否则后面几条空过）', plan.length > 0, '长度=' + plan.length);
    t('A23 推荐项全部来自**本次诊断的那门课**',
      plan.every(p => p.courseId === 'igcse_math'),
      JSON.stringify([...new Set(plan.map(p => p.courseId))]));
    t('A24 推荐池不再跨体系（反向：不含其他体系的课）',
      plan.every(p => String(p.courseId).split('_')[0] === 'igcse'),
      JSON.stringify(plan.map(p => p.courseId)));
    t('A25 每项都带 learned 标记，且是 boolean',
      plan.every(p => typeof p.learned === 'boolean'));
    t('A26 learned 标记与服务端已学记录逐项一致（不是摆设）',
      plan.every(p => p.learned === (learnedIds.indexOf(p.id) >= 0)),
      JSON.stringify(plan.map(p => p.id + ':' + p.learned)));
    // 判别性最强的一条：老代码会把最前面那 3 个"已学"推出来，新代码必须推不出来
    t('A27 已学的 3 个（原本排最前）被让到后面，5 个推荐里一个都没出现',
      plan.length === 5 && plan.every(p => p.learned === false),
      JSON.stringify(plan.map(p => p.id + ':' + p.learned)));
    // 未学优先的排序性质：不存在"已学排在未学之前"
    let orderViolation = '';
    for (let i = 0; i < plan.length; i++) {
      for (let j = i + 1; j < plan.length; j++) {
        if (plan[i].learned === true && plan[j].learned === false) {
          orderViolation = plan[i].id + '(已学) 排在 ' + plan[j].id + '(未学) 之前';
        }
      }
    }
    t('A28 未学知识点排在已学之前（注释终于与代码一致）', orderViolation === '', orderViolation);

    // 对照组：8 个全标已学 → 不能把推荐推空，只是不再有优先级
    const allLearned = loadPage('pages/quiz/quiz.js', {
      globalData: { hasLogin: true },
      cloud: (o) => o.name === 'getUserProgress'
        ? { result: { code: 0, list: courseItems.map(k => ({ itemId: k.id })) } }
        : { result: { code: 0 } }
    });
    allLearned.inst.onLoad({ courseId: 'igcse_math' });
    allLearned.inst.data.questions.forEach((q, i) => { allLearned.inst.data.answers[i] = q.answerIndex; });
    allLearned.inst.doSubmit();
    await tick(); await tick();
    const planAll = allLearned.inst.data.recommendPlan || [];
    t('A29 全部已学时仍给出 5 条推荐（已学只降优先级，不整条丢弃）',
      planAll.length === 5 && planAll.every(p => p.learned === true),
      JSON.stringify(planAll.map(p => p.learned)));

    // 客态对照组：拿不到已学记录时，不许把"未知"当成"已学"，也不许当成"确定未学"
    const guest = loadPage('pages/quiz/quiz.js', { globalData: { hasLogin: false } });
    guest.inst.onLoad({ courseId: 'igcse_math' });
    guest.inst.data.questions.forEach((q, i) => { guest.inst.data.answers[i] = q.answerIndex; });
    guest.inst.doSubmit();
    await tick();
    t('A30 拿不到已学记录时不谎称已学（全部 learned=false）',
      (guest.inst.data.recommendPlan || []).every(p => p.learned === false),
      JSON.stringify((guest.inst.data.recommendPlan || []).map(p => p.learned)));

    // 得分全对（≥70，weakCourseIds 为空）这条路径历史上最容易漏
    const allRight = loadPage('pages/quiz/quiz.js', { globalData: { hasLogin: false } });
    allRight.inst.onLoad({ courseId: 'ib_phy' });
    allRight.inst.data.questions.forEach((q, i) => { allRight.inst.data.answers[i] = q.answerIndex; });
    allRight.inst.doSubmit();
    await tick();
    const plan2 = allRight.inst.data.recommendPlan || [];
    t('A31 全对（无薄弱课程）时推荐仍限定在本课内',
      plan2.length > 0 && plan2.every(p => p.courseId === 'ib_phy'),
      JSON.stringify(plan2.map(p => p.courseId)));
  }

  /* --------------------------- teach 页读等级 --------------------------- */
  {
    // 库里既有本课等级，也有旧版本残留的全局等级 —— 必须只认本课那个
    const st = makeStorage({ 'userLevel:alevel_math': 'A+', userLevel: 'S+' });
    let sent = null;
    const { inst } = loadPage('pages/teach/teach.js', {
      storage: st,
      globalData: { hasLogin: true },
      cloud: (o) => { if (o.name === 'aiTeach') sent = o.data; return { result: { code: 0, data: { sections: [] } } }; }
    });
    inst.data.item = { id: 'k1', courseId: 'alevel_math', courseName: 'A-Level数学', title: 't' };
    inst.startAiTeach();
    await tick();
    t('A32 发给 aiTeach 的 level 取本课的值（A+）', !!(sent && sent.level === 'A+'), sent && sent.level);
    t('A33 不被旧版本残留的全局 S+ 污染', !(sent && sent.level === 'S+'));
  }

  {
    // 本课没测过 → 用默认档，不借别的课的等级
    const st = makeStorage({ 'userLevel:ib_math_aa': 'S+', userLevelRecent: 'S+' });
    let sent = null;
    const { inst } = loadPage('pages/teach/teach.js', {
      storage: st,
      globalData: { hasLogin: true },
      cloud: (o) => { if (o.name === 'aiTeach') sent = o.data; return { result: { code: 0, data: { sections: [] } } }; }
    });
    inst.data.item = { id: 'k9', courseId: 'ap_stats', courseName: 'AP统计', title: 't' };
    inst.startAiTeach();
    await tick();
    t('A34 本课没测过 → 用默认档，不借别的课的等级',
      !!(sent && sent.level === 'S'), sent && sent.level);
    t('A35 也不借"最近一次测评"的等级（那是另一门课的）', !(sent && sent.level === 'S+'));
  }

  {
    // 埋点里带上范围与来源，便于线上核对"这门课的难度到底按什么定的"
    const st = makeStorage({ 'userLevel:alevel_math': 'A+' });
    const props = [];
    const { inst } = loadPage('pages/teach/teach.js', {
      storage: st,
      globalData: { hasLogin: true },
      cloud: (o) => {
        if (o.name === 'trackEvent') props.push(o.data);
        if (o.name === 'aiTeach') return { result: { code: 0, data: { sections: [] } } };
        return { result: { code: 0 } };
      }
    });
    inst.data.item = { id: 'k1', courseId: 'alevel_math', courseName: 'A-Level数学', title: 't' };
    inst.startAiTeach();
    await tick();
    const p = props.find(x => x && x.event === 'ai_teach_start');
    t('A36 埋点带上 courseId 与 levelSource', !!(p && p.props && p.props.courseId === 'alevel_math' && p.props.levelSource === 'course'),
      JSON.stringify(p && p.props));
  }

  /* --------------------------- report 页读等级 --------------------------- */
  {
    const toeflName = (coursesData.courses.find(c => c.id === 'toefl_b2') || {}).name;
    const st = makeStorage({
      userLevelRecent: 'S', userLevelRecentName: '提升', userLevelRecentCourseId: 'toefl_b2',
      userLevel: 'S+', userLevelName: '培优'
    });
    const { inst } = loadPage('pages/report/report.js', { storage: st, globalData: { hasLogin: false } });
    inst.onShow();
    t('A37 档案页读"最近一次测评"而不是全局键', inst.data.level === 'S', inst.data.level);
    t('A38 档案页把科目名一起显示出来', inst.data.levelCourseName === toeflName,
      inst.data.levelCourseName + ' vs ' + toeflName);
    t('A39 科目名不为空（不能只显示等级）', !!inst.data.levelCourseName);
  }

  {
    // 从没测过 → 不显示等级，也不显示空的"最近一次测评：... "
    const { inst } = loadPage('pages/report/report.js', { storage: makeStorage({ userLevel: 'S+' }), globalData: { hasLogin: false } });
    inst.onShow();
    t('A40 从没测过时不显示等级（不拿全局残留值顶）', inst.data.level === '' && inst.data.levelCourseName === '',
      inst.data.level + ' / ' + inst.data.levelCourseName);
  }

  /* ============================ B 组：saveLevel ============================ */
  sec('B. 云函数 saveLevel：等级按课程归档，且不被别的写入抹掉');

  {
    const db = createDb({});
    db._store; // 空库
    const saveLevel = loadFn('saveLevel', db);

    const missing = await saveLevel.main({ level: 'S+', levelName: '培优', accuracy: 90 });
    t('B1 缺 courseId 直接拒绝（服务端不再产生"没有范围的等级"）', missing.code === 1, JSON.stringify(missing));

    const badLevel = await saveLevel.main({ level: 'X', courseId: 'ielts_listening' });
    t('B2 非法等级取值被拒绝', badLevel.code === 1);

    const badId = await saveLevel.main({ level: 'S', courseId: 'ielts.listening' });
    t('B3 含点的 courseId 被拒绝（否则会写到别的字段层级上去）', badId.code === 1);

    const r1 = await saveLevel.main({ level: 'S+', levelName: '培优', accuracy: 90, courseId: 'ielts_listening', courseName: '雅思听力' });
    t('B4 首次定级成功', r1.code === 0 && r1.courseId === 'ielts_listening', JSON.stringify(r1));

    let doc = (await db.collection('learners').doc('o_student').get()).data;
    t('B5 等级落在 learners.levels.<courseId> 里',
      !!(doc.levels && doc.levels.ielts_listening && doc.levels.ielts_listening.level === 'S+'),
      JSON.stringify(doc.levels));
    t('B6 没有写出字面点号假键 levels.ielts_listening',
      !Object.prototype.hasOwnProperty.call(doc, 'levels.ielts_listening'));
    t('B7 不再写含糊的全局 level 字段', !('level' in doc), JSON.stringify(Object.keys(doc)));
    t('B8 最近一次测评字段带上课程', doc.lastLevel === 'S+' && doc.lastLevelCourseId === 'ielts_listening' && doc.lastLevelCourseName === '雅思听力');

    const r2 = await saveLevel.main({ level: 'A+', levelName: '基础', accuracy: 40, courseId: 'alevel_mech', courseName: 'A-Level力学' });
    doc = (await db.collection('learners').doc('o_student').get()).data;
    t('B9 第二门课的等级独立归档（两门课并存）',
      r2.code === 0 && doc.levels.ielts_listening.level === 'S+' && doc.levels.alevel_mech.level === 'A+',
      JSON.stringify(doc.levels));
    t('B10 后一门课不覆盖前一门课', doc.levels.ielts_listening.level === 'S+');
    t('B11 最近一次指向最后测的那门课', doc.lastLevelCourseId === 'alevel_mech' && doc.lastLevel === 'A+');

    // 重测同一门课 → 覆盖该门课，其他课保留
    await saveLevel.main({ level: 'S', levelName: '提升', accuracy: 70, courseId: 'ielts_listening' });
    doc = (await db.collection('learners').doc('o_student').get()).data;
    t('B12 重测同一门课只改该门课', doc.levels.ielts_listening.level === 'S' && doc.levels.alevel_mech.level === 'A+');
  }

  {
    // submitGoal 曾经用 .set() 整篇覆盖 → 设目标会把等级抹掉
    const db = createDb({ learners: [{ _id: 'o_student', openid: 'o_student', levels: { ielts_listening: { level: 'S+' } }, lastLevel: 'S+', lastLevelCourseId: 'ielts_listening', lastLevelName: '培优' }] });
    const submitGoal = loadFn('submitGoal', db);

    const g = await submitGoal.main({ systemId: 'ielts', examDate: '2026-12-01', subject: '听力', targetScore: '7.5', dailyMinutes: 60 });
    const doc = (await db.collection('learners').doc('o_student').get()).data;

    t('B13 设目标成功', g.code === 0, JSON.stringify(g));
    t('B14 设目标不再抹掉已存的等级（原来 .set() 会整篇覆盖）',
      !!(doc.levels && doc.levels.ielts_listening && doc.levels.ielts_listening.level === 'S+'),
      JSON.stringify(doc));
    t('B15 设目标不再抹掉"最近一次测评"', doc.lastLevel === 'S+' && doc.lastLevelCourseId === 'ielts_listening');
    t('B16 目标字段本身写进去了', doc.system === 'ielts' && doc.targetScore === '7.5' && doc.dailyMinutes === 60);

    // 反向：老实现一定会失败的那条 —— 只传目标时 level 必须还在
    t('B17 反向核对：等级字段在设目标后仍可读', doc.lastLevelName === '培优');

    // 首次设目标（文档不存在）仍然要能建出来
    const db2 = createDb({});
    const submitGoal2 = loadFn('submitGoal', db2);
    const g2 = await submitGoal2.main({ systemId: 'sat', targetScore: '1500' });
    const doc2 = (await db2.collection('learners').doc('o_student').get()).data;
    t('B18 库中没有该用户时仍能建出目标文档', g2.code === 0 && doc2.system === 'sat' && doc2.targetScore === '1500');

    // 非法日期不能落成 Invalid Date
    const db3 = createDb({});
    const submitGoal3 = loadFn('submitGoal', db3);
    await submitGoal3.main({ systemId: 'ib', examDate: '不是日期' });
    const doc3 = (await db3.collection('learners').doc('o_student').get()).data;
    t('B19 非法日期回退成默认日期，而不是 Invalid Date',
      doc3.examDate instanceof Date && !isNaN(doc3.examDate.getTime()), String(doc3.examDate));
  }

  {
    // 两种 SDK 行为下都不能靠 set 覆盖整篇文档
    for (const flag of [true, false]) {
      for (const updated of [1, 0]) {
        const db = createDb({ learners: [{ _id: 'o_student', openid: 'o_student', system: 'ielts', levels: { a: { level: 'S' } } }] });
        db._updateMissingThrows = flag;
        db._updateExistingUpdated = updated;
        const saveLevel = loadFn('saveLevel', db);
        const r = await saveLevel.main({ level: 'A+', courseId: 'b', courseName: 'B课' });
        const doc = (await db.collection('learners').doc('o_student').get()).data;
        t('B20 SDK 行为(缺失' + (flag ? '抛错' : '返回0') + ' / 已存在updated=' + updated + ')下其他字段都保留',
          r.code === 0 && doc.system === 'ielts' && doc.levels.a.level === 'S' && doc.levels.b.level === 'A+',
          JSON.stringify(doc));
      }
    }
  }

  /* ============================ C 组：getRoadmap ============================ */
  sec('C. getRoadmap：等级说法按体系如实描述；兜底任务 ID 真实存在');

  const validCourseIds = ALL_COURSES.map(c => c.id);

  {
    const db = createDb({
      learners: [{
        _id: 'o_student', openid: 'o_student', system: 'ielts', subject: '听力', targetScore: '7.5',
        lastLevel: 'S+', lastLevelName: '培优', lastLevelCourseId: 'ielts_listening', lastLevelCourseName: '雅思听力'
      }],
      wrong_books: []
    });
    aiPrompts.length = 0;
    const getRoadmap = loadFn('getRoadmap', db, async (o) => {
      aiPrompts.push((o && o.data && o.data.prompt) || '');
      return { result: { code: 1 } };   // AI 失败 → 走兜底任务
    });
    const r = await getRoadmap.main();

    const prompt = aiPrompts.join('\n');
    t('C1 规划提示词里带了等级', /当前等级/.test(prompt), prompt.slice(0, 200));
    t('C2 同体系时明确写出是哪门课的等级（不是笼统"当前等级=S+"）',
      /当前等级（雅思听力）=培优/.test(prompt), (prompt.match(/当前等级[^；]*/) || [''])[0]);
    t('C3 不再出现"当前等级=某等级"这种无从判断科目的写法',
      !/当前等级=(?!未定级)/.test(prompt));
    t('C4 兜底今日任务的 courseId 都是真实存在的课程 id',
      r.data.todayTasks.length > 0 && r.data.todayTasks.every(x => validCourseIds.indexOf(x.courseId) >= 0),
      JSON.stringify(r.data.todayTasks.map(x => x.courseId)));
    t('C5 兜底任务不再把体系 id（ielts）当课程 id 用',
      r.data.todayTasks.every(x => x.courseId !== 'ielts'));
    t('C6 兜底任务不再出现不存在的 ielts_b1',
      r.data.todayTasks.every(x => x.courseId !== 'ielts_b1'));
  }

  {
    // 最近一次测评发生在**别的体系** → 必须如实说明，不能当成本体系的水平
    const db = createDb({
      learners: [{
        _id: 'o_student', openid: 'o_student', system: 'alevel', subject: '纯数',
        lastLevel: 'A+', lastLevelName: '基础', lastLevelCourseId: 'ielts_reading', lastLevelCourseName: '雅思阅读'
      }],
      wrong_books: []
    });
    aiPrompts.length = 0;
    const getRoadmap = loadFn('getRoadmap', db, async (o) => {
      aiPrompts.push((o && o.data && o.data.prompt) || '');
      return { result: { code: 1 } };
    });
    await getRoadmap.main();

    const prompt = aiPrompts.join('\n');
    t('C7 跨体系时如实说明"本体系尚无测评"',
      /本体系尚无测评/.test(prompt), (prompt.match(/；[^；]*测评[^；]*；/) || [''])[0]);
    t('C8 跨体系时不把别的体系的等级说成本体系等级',
      !/当前等级（雅思阅读）/.test(prompt));
    t('C9 跨体系时仍说明了最近一次测评在哪门课、什么等级',
      /最近一次测评在「雅思阅读」=基础/.test(prompt));
  }

  {
    // 完全没测过
    const db = createDb({
      learners: [{ _id: 'o_student', openid: 'o_student', system: 'ap', targetScore: '5' }],
      wrong_books: []
    });
    aiPrompts.length = 0;
    const getRoadmap = loadFn('getRoadmap', db, async (o) => {
      aiPrompts.push((o && o.data && o.data.prompt) || '');
      return { result: { code: 1 } };
    });
    const r = await getRoadmap.main();
    t('C10 没测过时如实说"当前等级=未定级"', /当前等级=未定级/.test(aiPrompts.join('\n')));
    t('C11 没测过时兜底任务仍指向真实课程 id（ap → ap_calc 之类）',
      r.data.todayTasks.every(x => validCourseIds.indexOf(x.courseId) >= 0),
      JSON.stringify(r.data.todayTasks.map(x => x.courseId)));
  }

  {
    // 薄弱课程来自别的体系时，复习任务不能被带偏
    const db = createDb({
      learners: [{ _id: 'o_student', openid: 'o_student', system: 'ib', targetScore: '6' }],
      wrong_books: [{ _id: 'w1', openid: 'o_student', status: 'reviewing', courseId: 'not_a_course', courseName: '野课程' }]
    });
    const getRoadmap = loadFn('getRoadmap', db, async () => ({ result: { code: 1 } }));
    const r = await getRoadmap.main();
    t('C12 薄弱课程的 courseId 非法时回退到合法课程，不产生死链',
      r.data.todayTasks.every(x => validCourseIds.indexOf(x.courseId) >= 0),
      JSON.stringify(r.data.todayTasks.map(x => x.courseId)));
  }

  {
    // 反向：薄弱课程合法（同体系）时，要真的用它，而不是无脑回退
    const db = createDb({
      learners: [{ _id: 'o_student', openid: 'o_student', system: 'ib', targetScore: '6' }],
      wrong_books: [{ _id: 'w1', openid: 'o_student', status: 'reviewing', courseId: 'ib_phy', courseName: 'IB物理' }]
    });
    const getRoadmap = loadFn('getRoadmap', db, async () => ({ result: { code: 1 } }));
    const r = await getRoadmap.main();
    const t3 = (r.data.todayTasks.find(x => x.id === 't3') || {}).courseId;
    t('C13 薄弱课程合法时复习任务真的指向它（不是无脑回退）', t3 === 'ib_phy', t3);
    t('C14 其余任务仍是本体系的第一门课', r.data.todayTasks.filter(x => x.id !== 't3').every(x => x.courseId === 'ib_math_aa'),
      JSON.stringify(r.data.todayTasks.map(x => x.courseId)));

    // 反例：异体系的薄弱课程必须被拒（否则 ib 的规划里会出现雅思的课）
    const db2 = createDb({
      learners: [{ _id: 'o_student', openid: 'o_student', system: 'ib', targetScore: '6' }],
      wrong_books: [{ _id: 'w1', openid: 'o_student', status: 'reviewing', courseId: 'ielts_reading', courseName: '雅思阅读' }]
    });
    const getRoadmap2 = loadFn('getRoadmap', db2, async () => ({ result: { code: 1 } }));
    const r2 = await getRoadmap2.main();
    t('C15 异体系的薄弱课程被拒（ib 的规划里不出现雅思的课）',
      r2.data.todayTasks.every(x => x.courseId.indexOf('ib_') === 0),
      JSON.stringify(r2.data.todayTasks.map(x => x.courseId)));
  }

  {
    /* 守护 C 组所依赖的不变式：courseId 的第一段必须等于 systemId。
       safeCourseId / levelLine 都建立在它之上；哪天数据破了，这里先报。 */
    const broken = ALL_COURSES.filter(c => String(c.id).split('_')[0] !== c.systemId);
    t('C16 不变式：全部课程 courseId 的前缀 === systemId（levelLine/safeCourseId 依赖它）',
      broken.length === 0, JSON.stringify(broken.map(c => c.id + ' vs ' + c.systemId)));
    // 兜底映射表里的值必须都是真实课程
    const FALLBACKS = ['ielts_listening', 'toefl_b2', 'sat_math', 'igcse_math', 'alevel_pure3', 'ap_calc', 'ib_math_aa'];
    const unknown = FALLBACKS.filter(id => validCourseIds.indexOf(id) < 0);
    t('C17 兜底映射表里的每门课都真实存在', unknown.length === 0, unknown.join(','));
    // 每个体系都必须能在兜底表里找到（否则 firstCourseOf 会落到别的体系的课）
    const sysMissing = (coursesData.systems || []).map(s => s.id).filter(sid => !FALLBACKS.some(f => f.split('_')[0] === sid));
    t('C18 每个体系在兜底表里都有对应课程', sysMissing.length === 0, sysMissing.join(','));
  }

  /* ============================ D 组：sendWeeklyReport ============================ */
  sec('D. sendWeeklyReport：周报带上"这等级是哪门课的"');

  {
    process.env.WEEKLY_TEMPLATE_ID = 'TPL_WEEKLY';
    const db = createDb({
      learners: [{
        _id: 'o_student', openid: 'o_student',
        lastLevel: 'S+', lastLevelName: '培优', lastLevelCourseId: 'sat_write', lastLevelCourseName: 'SAT写作',
        level: 'A+', levelName: '基础'   // 迁移前的老字段：不能被当成现行等级
      }],
      subscriptions: [{ _id: 'sub_1', openid: 'o_student', templateId: 'TPL_WEEKLY', status: 'pending', createTime: new Date(Date.now() - 3600000) }],
      progress: [], checkins: [], wrong_books: []
    });
    const sendWeeklyReport = loadFn('sendWeeklyReport', db);
    const r = await sendWeeklyReport.main({});
    const reports = (await db.collection('weekly_reports').where({ openid: 'o_student' }).get()).data;
    t('D1 周报已生成落库', r.code === 0 && reports.length === 1, JSON.stringify(r));
    const rep = reports[0] || {};
    t('D2 周报等级读的是新的 lastLevel（S+），不是迁移前的老 level（A+）',
      rep.level === 'S+', rep.level);
    t('D3 周报带上等级所属课程名', rep.levelCourseName === 'SAT写作', rep.levelCourseName);
    t('D4 周报等级名与最近一次测评一致', rep.levelName === '培优', rep.levelName);
  }

  console.log('\nSCOPE_LEVEL_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('SCOPE_LEVEL_ERROR ' + ((e && e.stack) || e));
  process.exit(2);
});
