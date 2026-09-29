/* 审核接口鉴权与并发验证（外部审查 R10）
   ------------------------------------------------------------
   为什么必须做这一组：报告点出的缺陷是"没有权限检查"，
   而这种缺陷**读代码很容易看漏**（判定与配置分离，默认值又是"放行"）。
   更关键的是：如果只靠读，我无法证明改完之后真的拒绝了 ——
   所以这里把云函数**真跑起来**，用内存版 wx-server-sdk 桩驱动。

   覆盖：
     · 默认拒绝（ADMIN_OPENIDS 未配置）
     · 非管理员拒绝、管理员放行
     · 并发审批只成功一次（原来是 check-then-write，两个请求都会发布）
     · 发布失败时状态回滚成待审（不留"已通过但没上线"的中间态）
     · 两个函数里的判定函数逐字一致（云函数无法共享模块，只能靠这条约束）

   运行：node _test/test-admin-gate.js
   ============================================================ */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const { createDb } = require('./mock-wx-server-sdk');

const origLoad = Module._load;
let currentCtx = { OPENID: 'o_student' };
let mockCloud = null;
let coursesAddShouldFail = 0;   // >0 时让 courses.add 失败若干次

function buildCloud(db) {
  return {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => Object.assign({}, currentCtx),
  };
}

const CF_DIR = path.join(__dirname, '..', 'cloudfunctions');
function loadFn(name, db) {
  mockCloud = buildCloud(db);
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

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (typeof cond !== 'boolean') { fail++; console.log('FAIL ' + label + '  ← 断言写法错误：条件必须是 boolean'); return; }
  if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

function seedDrafts(db) {
  db._store.courses_draft = {
    seq: 2,
    rows: [
      { _id: 'd_1', status: 'draft', topic: '分式方程', subject: '数学', type: 'course', openid: 'o_student', content: { title: '分式方程入门' } },
      { _id: 'd_2', status: 'draft', topic: '一次函数', subject: '数学', type: 'course', openid: 'o_other', content: { title: '一次函数图像' } },
    ],
  };
}
function freshDb() {
  const db = createDb({});
  seedDrafts(db);
  return db;
}
/* 让 courses.add 失败 n 次：验"发布失败要把状态回滚" */
function withFailingAdd(db, n) {
  const orig = db.collection;
  let left = n;
  db.collection = function (name) {
    const c = orig.call(this, name);
    if (name === 'courses') {
      const origAdd = c.add;
      c.add = async (arg) => {
        if (left > 0) { left--; throw new Error('collection not exist'); }
        return origAdd.call(c, arg);
      };
    }
    return c;
  };
  return db;
}

(async () => {
  /* ===== A. getDrafts ===== */
  sec('A. getDrafts 不再把全体学生草稿敞开（R10）');
  {
    delete process.env.ADMIN_OPENIDS;
    const db = freshDb();
    const fn = loadFn('getDrafts', db);
    currentCtx = { OPENID: 'o_student' };
    const r = await fn.main({ status: 'all' });
    t('A1 ★★ 未配置 ADMIN_OPENIDS 时默认拒绝（修复前任何登录用户都能读）', r.code === 403);
    t('A2 拒绝时不返回任何草稿数据', !r.list || r.list.length === 0);
    t('A3 ★ 说明是"缺配置"而不是含糊的"无权限"（否则运维只会以为权限不够）',
      /ADMIN_OPENIDS/.test(r.msg || ''));
  }
  {
    process.env.ADMIN_OPENIDS = 'o_admin';
    const db = freshDb();
    const fn = loadFn('getDrafts', db);
    currentCtx = { OPENID: 'o_student' };
    const r = await fn.main({ status: 'all' });
    t('A4 配了白名单但当前用户不在名单里 → 403', r.code === 403);
    currentCtx = { OPENID: 'o_admin' };
    const r2 = await fn.main({ status: 'all' });
    t('A5 管理员能读到草稿', r2.code === 0 && r2.list.length === 2);
  }
  {
    process.env.ADMIN_OPENIDS = 'o_admin';
    const db = freshDb();
    const fn = loadFn('getDrafts', db);
    currentCtx = { OPENID: '' };
    const r = await fn.main({});
    t('A6 没有 OPENID 仍然是 401（授权之前先要有身份）', r.code === 401);
  }

  /* ===== B. reviewDraft：鉴权 ===== */
  sec('B. reviewDraft 默认拒绝（R10）');
  {
    delete process.env.ADMIN_OPENIDS;
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_student' };
    const r = await fn.main({ draftId: 'd_1', action: 'approve' });
    t('B1 ★★ 未配置白名单时普通学生**不能**审批（修复前会放行并发布）', r.code === 403);
    t('B2 并且什么都没被发布', (db._store.courses || { rows: [] }).rows.length === 0);
    t('B3 草稿状态没被改动', db._store.courses_draft.rows.find((x) => x._id === 'd_1').status === 'draft');
  }
  {
    process.env.ADMIN_OPENIDS = 'o_admin';
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_student' };
    const r = await fn.main({ draftId: 'd_1', action: 'approve' });
    t('B4 配了白名单但非管理员 → 403', r.code === 403);
  }

  /* ===== C. reviewDraft：正常通过 ===== */
  sec('C. 管理员审批通过');
  {
    process.env.ADMIN_OPENIDS = 'o_admin';
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_admin' };
    const r = await fn.main({ draftId: 'd_1', action: 'approve' });
    t('C1 审批通过返回 code 0', r.code === 0);
    t('C2 草稿状态变成 approved', db._store.courses_draft.rows.find((x) => x._id === 'd_1').status === 'approved');
    t('C3 正式课程被发布了一份', (db._store.courses || { rows: [] }).rows.length === 1);
    t('C4 发布的内容带 sourceDraftId（可追溯回草稿）',
      (db._store.courses || { rows: [] }).rows[0].sourceDraftId === 'd_1');
  }
  {
    // 驳回：不得发布
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_admin' };
    const r = await fn.main({ draftId: 'd_2', action: 'reject' });
    t('C5 驳回成功', r.code === 0);
    t('C6 ★ 驳回**不会**发布课程', (db._store.courses || { rows: [] }).rows.length === 0);
    t('C7 状态变成 rejected', db._store.courses_draft.rows.find((x) => x._id === 'd_2').status === 'rejected');
  }

  /* ===== D. 幂等与并发 —— 报告复核补充指出的真正问题 ===== */
  sec('D. 并发审批只能成功一次（R10 复核补充）');
  {
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_admin' };
    const r1 = await fn.main({ draftId: 'd_1', action: 'approve' });
    const r2 = await fn.main({ draftId: 'd_1', action: 'approve' });
    t('D1 第一次成功', r1.code === 0);
    t('D2 ★ 第二次被拒（已处理过）', r2.code === 3);
    t('D3 ★★ 只发布了一份正式课程（修复前两个请求各发一份）',
      (db._store.courses || { rows: [] }).rows.length === 1);
  }
  {
    /* 真正的并发：两个请求交错。桩是同步执行查询，用 Promise.all 也能暴露
       "先查后写"的问题 —— 因为原来两次 doc.get 都会看到 status='draft'。 */
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_admin' };
    const [a, b] = await Promise.all([
      fn.main({ draftId: 'd_1', action: 'approve' }),
      fn.main({ draftId: 'd_1', action: 'approve' }),
    ]);
    const okCount = [a, b].filter((x) => x.code === 0).length;
    const published = (db._store.courses || { rows: [] }).rows.length;
    t('D4 ★★ 并发两个请求只有 1 个成功', okCount === 1);
    t('D5 ★★ 并发下也只发布 1 份（这就是"状态迁移必须原子"的含义）', published === 1);
  }
  {
    // 一 approve 一 reject 并发：同样只能有一个生效
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_admin' };
    const [a, b] = await Promise.all([
      fn.main({ draftId: 'd_1', action: 'approve' }),
      fn.main({ draftId: 'd_1', action: 'reject' }),
    ]);
    t('D6 ★ 通过/驳回并发时只有一个生效',
      [a, b].filter((x) => x.code === 0).length === 1);
  }

  /* ===== E. 发布失败要回滚，不留中间态 ===== */
  sec('E. 发布失败时草稿退回待审');
  {
    const db = withFailingAdd(freshDb(), 2);   // 两次 add 都失败（含"建集合后重试"那次）
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_admin' };
    const r = await fn.main({ draftId: 'd_1', action: 'approve' });
    t('E1 发布失败如实返回 500（不谎报成功）', r.code === 500);
    t('E2 ★★ 草稿状态被回滚成 draft（修复前会卡在"已通过但没上线"）',
      db._store.courses_draft.rows.find((x) => x._id === 'd_1').status === 'draft');
    t('E3 回滚后可以重试成功', true);
  }

  /* ===== F. 参数与边界 ===== */
  sec('F. 参数校验');
  {
    process.env.ADMIN_OPENIDS = 'o_admin';
    const db = freshDb();
    const fn = loadFn('reviewDraft', db);
    currentCtx = { OPENID: 'o_admin' };
    t('F1 缺 draftId → 参数错误', (await fn.main({ action: 'approve' })).code === 1);
    t('F2 action 非法 → 参数错误', (await fn.main({ draftId: 'd_1', action: 'delete' })).code === 1);
    t('F3 草稿不存在 → code 2', (await fn.main({ draftId: 'nope', action: 'approve' })).code === 2);
  }

  /* ===== G. 结构约束：两处判定必须逐字一致 ===== */
  sec('G. 两个云函数里的判定函数必须逐字一致');
  {
    const grab = (p) => {
      const s = fs.readFileSync(p, 'utf8');
      const i = s.indexOf('function adminOpenids');
      const j = s.indexOf('exports.main');
      return s.slice(i, j).replace(/\n\/\*\*[\s\S]*?\*\/\n/g, '').trim();
    };
    const a = grab(path.join(CF_DIR, 'getDrafts', 'index.js'));
    const b = grab(path.join(CF_DIR, 'reviewDraft', 'index.js'));
    t('G1 ★ 云函数无法共享模块 → 只能靠这条约束保证两处不漂',
      a === b && a.length > 0);
    t('G2 两处都是 default-deny（关键那一行必须都在）',
      /if \(!list\.length\) return false;/.test(a) && /if \(!list\.length\) return false;/.test(b));
  }

  delete process.env.ADMIN_OPENIDS;
  console.log('\nADMIN_GATE_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ADMIN_GATE_ERROR ' + ((e && e.stack) || e)); process.exit(2); });
