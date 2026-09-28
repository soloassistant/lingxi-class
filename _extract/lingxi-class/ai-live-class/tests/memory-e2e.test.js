/* 最终冒烟：模拟「登录 → 有记忆 → 开课注入 → 课后写回」完整链路，并核对 DOM 真实隐藏状态 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };

(async () => {
  const dom = new JSDOM(html, {
    url: 'https://ai-tutor-live.app.workbuddy.host/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const W = dom.window;
  W.confirm = () => true;
  W.alert = () => {};

  // —— 云服务桩 ——
  // 注意：student_profiles 必须预置一行，模拟"这个学生已有画像"。
  // 否则 saveProfile 会走"首次创建"分支，永远测不到 sessions_count 累加。
  const store = {
    student_profiles: [
      { id: 'p1', sessions_count: 3, total_seconds: 5400, grade: '初中', system: '国内课程', goal: '中考冲刺', teaching_style: '苏格拉底式追问', pace: '偏慢' },
    ],
    student_facts: [
      { id: 'f1', kind: 'weak', content: '判别式符号判断容易出错', subject: '数学', topic: '一元二次方程', confidence: 0.8, hits: 2, last_seen: '2026-09-20T10:00:00Z' },
      { id: 'f2', kind: 'preference', content: '喜欢先看例题再自己做', subject: '数学', topic: null, confidence: 0.7, hits: 1, last_seen: '2026-09-19T10:00:00Z' },
    ],
    student_sessions: [
      { id: 's1', course_title: '一元二次方程', subject: '数学', grade: '初中', duration_secs: 2700, mastered: ['求根公式'], weak_points: ['判别式'], homework: ['习题 1-5'], comment: '思路清晰', created_at: '2026-09-20T10:00:00Z' },
    ],
  };
  const calls = { insert: [], update: [], delete: [] };
  function makeQuery(table) {
    const q = {
      _eq: null,
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(k, v) { q._eq = { k, v }; return q; },
      insert(body) { calls.insert.push({ table, body }); const rows = Array.isArray(body) ? body : [body];
        const added = rows.map((r, i) => Object.assign({ id: table + '_new' + (store[table] || []).length + i }, r));
        (store[table] = store[table] || []).push(...added); return makeQuery(table, { data: added.map(r => ({ id: r.id })), error: null }); },
      update(body) { calls.update.push({ table, body }); return q; },
      delete() { calls.delete.push({ table }); return q; },
      single() { return makeQuery(table, { data: null, error: null }); },
      // 忠实反映真实 PostgREST 行为：从 store 取第一行，而不是硬编码，
      // 避免桩与真实数据形态不一致时给出假绿
      maybeSingle() { const rows = store[table] || []; return makeQuery(table, { data: rows.length ? rows[0] : null, error: null }); },
      then(res, rej) {
        let data = store[table] || [];
        if (q._eq) data = data.filter((r) => String(r[q._eq.k]) === String(q._eq.v));
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
      catch(rej) { return Promise.resolve({ data: [], error: null }).catch(rej); },
    };
    return q;
  }

  W.WorkBuddyCloud = {
    createWorkBuddyCloud() {
      return {
        llm: {
          models: { list: async () => [{ id: 'test-model', name: 'Test', disabled: false }] },
          chat: { completions: { create: () => ({ [Symbol.asyncIterator]() { let d = false; return { next: async () => d ? { done: true } : (d = true, { done: false, value: { choices: [{ delta: { content: '好的' } }] } }) }; } }) } },
        },
        auth: {
          getSession: async () => ({ data: { user: { id: 'u1', email: 'stu@example.com', user_metadata: { nickname: '小明' } } }, error: null }),
          onAuthStateChange: () => () => {},
          signOut: async () => ({ error: null }),
        },
        database: { from: (t) => makeQuery(t) },
      };
    },
  };

  const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  W.eval(appJs);
  await new Promise((r) => setTimeout(r, 400));

  // 1. 登录态已被 initAuth 恢复
  ok(W.state.user && W.state.user.id === 'u1', '会话恢复后 state.user 已就绪');
  ok(W.memReady() === true, 'memReady() 为真');

  // 2. nav 显示用户信息（真实 DOM 渲染）
  const btnAuth = W.document.querySelector('#btn-auth');
  ok(btnAuth && btnAuth.className.includes('user-chip'), 'nav 按钮已变为 user-chip');
  ok(/小明/.test(btnAuth ? btnAuth.textContent : ''), 'nav 显示昵称「小明」');

  // 3. 记忆已加载
  await W.loadMemory(true);
  ok(W.state.mem && W.state.mem.facts.length === 2, '记忆事实已加载 2 条');
  ok(!!(W.state.mem && W.state.mem.profile), '画像已加载');

  // 4. prompt 注入
  const block = W.memoryPromptBlock();
  ok(/判别式符号判断容易出错/.test(block), '记忆块含薄弱点内容');
  ok(/关于这个学生的长期记忆/.test(block), '记忆块有抬头');
  ok(/喜欢先看例题/.test(block), '记忆块含偏好');

  const course = { id: 'c1', title: '二次函数复习', subject: '数学', grade: '初中', systemName: '国内课程', goal: '中考冲刺', outline: { stages: [{ name: '导入' }] }, slides: [] };
  const sys = W.teacherSystemPrompt(course, 0, '');
  ok(/判别式符号判断容易出错/.test(sys), 'teacherSystemPrompt 注入薄弱点');
  ok(/怎么使用这些记忆/.test(sys), 'teacherSystemPrompt 含记忆使用规则');

  // 5. 学习档案页渲染（真实 DOM）
  W.switchView('memory');
  await new Promise((r) => setTimeout(r, 50));
  const memBody = W.document.querySelector('#mem-body');
  const memGate = W.document.querySelector('#mem-gate');
  ok(memGate && memGate.hidden === true, '已登录：登录引导隐藏');
  ok(memBody && memBody.hidden === false, '已登录：档案主体显示');
  const factsHtml = W.document.querySelector('#mem-facts').innerHTML;
  ok(/判别式符号判断容易出错/.test(factsHtml), '事实列表渲染出薄弱点');
  ok(/data-fact-del="f1"/.test(factsHtml), '事实条目带删除按钮');

  // 6. 课后写回：模拟小结
  const sum = {
    mastered: ['顶点式求法'], weakPoints: ['对称轴判断'], homework: ['做 3 道题'],
    cards: [{ q: '顶点坐标怎么求？', a: '配方后取 (h,k)' }],
    reviewPlan: ['今晚复习', '明天再做一遍'],
    memoryFacts: [{ kind: 'weak', content: '对称轴判断仍不稳', topic: '二次函数', confidence: 0.85 }],
    studentStyle: { teaching_style: '喜欢图像辅助', pace: '可以加快' },
    comment: '今天进步明显',
  };
  await W.persistMemoryAfterClass(course, sum, '学生：我懂了', 2700);
  // insert 的参数既可能是单对象也可能是数组，测试两种形状都要能取到
  const firstRow = (body) => (Array.isArray(body) ? body[0] : body);
  const sessInsert = calls.insert.find((c) => c.table === 'student_sessions');
  ok(!!sessInsert, '课后写入 student_sessions');
  const sessRow = sessInsert ? firstRow(sessInsert.body) : null;
  ok(sessRow && sessRow.course_title === '二次函数复习', '上课记录含课程名');
  ok(sessRow && sessRow.duration_secs === 2700, '上课记录含时长');
  const factInsert = calls.insert.find((c) => c.table === 'student_facts');
  ok(!!factInsert, '课后写入新生 fact');
  const factRow = factInsert ? firstRow(factInsert.body) : null;
  ok(factRow && /对称轴判断仍不稳/.test(factRow.content), '新 fact 内容正确');
  const profUpd = calls.update.find((c) => c.table === 'student_profiles');
  ok(!!profUpd, '课后更新 student_profiles');
  ok(profUpd && profUpd.body.sessions_count === 4, '课程数累加 3→4');
  ok(profUpd && profUpd.body.total_seconds === 8100, '时长累加 5400+2700');

  // 7. 登出清理
  await W.doSignOut();
  ok(W.state.user === null, '登出后 state.user 为 null');
  ok(W.state.mem === null, '登出后记忆缓存已清');
  ok(btnAuth.className.includes('btn-ghost'), '登出后 nav 恢复登录按钮');

  W.switchView('memory');
  await new Promise((r) => setTimeout(r, 30));
  ok(memGate.hidden === false && memBody.hidden === true, '登出后档案页回到登录引导');

  console.log('\nSMOKE_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('SMOKE_ERROR ' + (e && e.stack || e)); process.exit(2); });
