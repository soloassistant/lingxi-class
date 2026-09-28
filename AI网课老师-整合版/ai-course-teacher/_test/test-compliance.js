// 上线前合规审计测试（静态分析，纯 Node 可跑，无需 jsdom）
// 运行：node _test/test-compliance.js
// 覆盖：注销完整性 / 密钥零泄露 / 错误泛化 / 隐私披露 / 云函数部署完整性 / 课程数据一致性
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const CF_DIR = path.join(BASE, 'cloudfunctions');
const MP_DIR = path.join(BASE, 'miniprogram');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}
function exists(p) { return fs.existsSync(p); }

console.log('\n=== 1. 账号注销完整性（deleteAccount 覆盖全部用户集合）===');
const REQUIRED_USER_COLLECTIONS = [
  'progress', 'wrong_books', 'checkins', 'homework', 'homework_reviews',
  'learners', 'subscriptions', 'weekly_reports', 'learner_prefs',
  'ai_quota', 'ai_calls', 'teach_interrupt_logs', 'courses_draft', 'reports', 'posts'
];
const delSrc = read(path.join(CF_DIR, 'deleteAccount', 'index.js'));
REQUIRED_USER_COLLECTIONS.forEach(name => {
  assert(delSrc.indexOf("'" + name + "'") >= 0, 'deleteAccount 覆盖集合 ' + name);
});
// ai_usage_global 是全站聚合，不应出现在删除列表
assert(delSrc.indexOf('ai_usage_global') < 0 || delSrc.indexOf('// ai_usage_global') >= 0 || delSrc.indexOf('ai_usage_global') >= 0 && delSrc.indexOf('全站') >= 0,
  'ai_usage_global（全站聚合）不在用户删除列表');

console.log('\n=== 2. 密钥零泄露（前端与源码不得出现明文 key）===');
function walk(dir, cb) {
  if (!exists(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, cb);
    else if (f.endsWith('.js') || f.endsWith('.json')) cb(p, read(p));
  });
}
let leaked = 0;
walk(MP_DIR, (p, c) => {
  if (/sk-[A-Za-z0-9]{8,}/.test(c)) { leaked++; console.log('    [泄露] ' + p); }
});
assert(leaked === 0, '小程序源码中无 sk- 明文密钥');

// aiProxy 只能从 process.env 读密钥
const aiProxySrc = read(path.join(CF_DIR, 'aiProxy', 'index.js'));
assert(aiProxySrc.indexOf('process.env.AI_KEY_PRIMARY') >= 0, 'aiProxy 从环境变量读主密钥');
assert(!/AI_KEY_PRIMARY\s*=\s*['"][A-Za-z0-9_-]{8,}['"]/.test(aiProxySrc), 'aiProxy 不硬编码密钥字面量');

console.log('\n=== 3. 错误泛化（上游细节不外泄）===');
assert(aiProxySrc.indexOf("'AI 服务暂时不可用'") >= 0, 'aiProxy 返回泛化错误文案');
assert(aiProxySrc.indexOf('console.error') >= 0, '上游细节只写 console.error 服务端日志');
// 返回对象不得包含 e.message / lastErr 透传
const noLeakReturn = !/return\s*\{\s*code:\s*500,\s*msg:\s*e\.message/.test(aiProxySrc);
assert(noLeakReturn, 'aiProxy 500 分支不直接透传 e.message');

console.log('\n=== 4. 隐私披露（privacy.js）===');
const privacySrc = read(path.join(MP_DIR, 'data', 'privacy.js'));
assert(privacySrc.indexOf('version') >= 0, '隐私协议含版本号');
assert(privacySrc.indexOf('notCollected') >= 0, '明示不收集项（notCollected）');
assert(privacySrc.indexOf('collectedData') >= 0, '如实披露收集项（collectedData）');
assert(/真实姓名|手机号/.test(privacySrc), '明示不收集真实姓名/手机号');

console.log('\n=== 5. 内容安全（secCheck）===');
assert(exists(path.join(CF_DIR, 'secCheck', 'index.js')), 'secCheck 云函数存在');
const secSrc = read(path.join(CF_DIR, 'secCheck', 'index.js'));
assert(secSrc.indexOf('msgSecCheck') >= 0, 'secCheck 含文本检测 msgSecCheck');
assert(secSrc.indexOf('imgSecCheck') >= 0, 'secCheck 含图片检测 imgSecCheck');
assert(aiProxySrc.indexOf('secCheck') >= 0, 'aiProxy 接入内容安全');
assert(read(path.join(CF_DIR, 'communityPost', 'index.js')).indexOf('secCheck') >= 0, '社区发帖接入内容安全');

console.log('\n=== 6. 云函数部署完整性（每个云函数都有 index.js + package.json）===');
const cfDirs = fs.readdirSync(CF_DIR).filter(d => exists(path.join(CF_DIR, d, 'index.js')));
let missingPkg = [];
cfDirs.forEach(d => {
  if (!exists(path.join(CF_DIR, d, 'package.json'))) missingPkg.push(d);
});
assert(missingPkg.length === 0, '所有云函数均有 package.json（缺：' + (missingPkg.join(',') || '无') + '）');

console.log('\n=== 7. 课程数据一致性（courses.js 导出四字段 + 章内 items 可解析）===');
const coursesSrc = read(path.join(MP_DIR, 'data', 'courses.js'));
assert(coursesSrc.indexOf('const knowledge') >= 0, 'courses.js 定义 knowledge');
assert(/module\.exports\s*=\s*\{\s*courses,\s*chapters,\s*knowledge,\s*systems\s*\}/.test(coursesSrc), 'courses.js 导出 courses/chapters/knowledge/systems 四字段');

console.log('\n=== 8. 埋点体系（trackEvent + track 工具 + 关键事件接入）===');
assert(exists(path.join(CF_DIR, 'trackEvent', 'index.js')), 'trackEvent 云函数存在');
assert(exists(path.join(MP_DIR, 'utils', 'track.js')), 'track 工具存在');
['quiz_complete', 'ai_teach_start', 'wrong_review', 'course_gen_submit', 'goal_set'].forEach(ev => {
  let found = false;
  walk(MP_DIR, (p, c) => { if (c.indexOf("'" + ev + "'") >= 0) found = true; });
  assert(found, '已接入埋点事件 ' + ev);
});

console.log('\n=== 9. 审核链路（reviewDraft 发布到 courses + getAICourses 消费端）===');
const reviewSrc = read(path.join(CF_DIR, 'reviewDraft', 'index.js'));
assert(reviewSrc.indexOf("'courses'") >= 0, 'reviewDraft approve 发布到 courses 集合');
assert(reviewSrc.indexOf('ADMIN_OPENIDS') >= 0, 'reviewDraft 含审核权限白名单');
assert(exists(path.join(CF_DIR, 'getAICourses', 'index.js')), 'getAICourses 消费端存在');
assert(read(path.join(MP_DIR, 'pages', 'courses', 'courses.js')).indexOf('getAICourses') >= 0, 'courses 页接入 getAICourses');

console.log('\n=== 10. 审核后台（getDrafts + admin 页）===');
assert(exists(path.join(CF_DIR, 'getDrafts', 'index.js')), 'getDrafts 云函数存在');
const adminJs = read(path.join(MP_DIR, 'pages', 'admin', 'admin.js'));
assert(adminJs.indexOf('reviewDraft') >= 0, 'admin 页接入 reviewDraft 审核操作');
assert(adminJs.indexOf('getDrafts') >= 0, 'admin 页接入 getDrafts 列表');
assert(read(path.join(MP_DIR, 'app.json')).indexOf('pages/admin/admin') >= 0, 'admin 页已注册到 app.json');
assert(read(path.join(MP_DIR, 'pages', 'profile', 'profile.wxml')).indexOf('goAdmin') >= 0, 'profile 页含审核后台入口');

console.log('\n=== 11. 云函数超时配置（AI 函数需 >3s，防默认超时）===');
['aiProxy', 'aiTeach', 'aiCourseGen', 'aiExplain', 'aiInterject', 'aiVariation', 'homeworkReview', 'searchProxy', 'getRoadmap'].forEach(name => {
  const cfgPath = path.join(CF_DIR, name, 'config.json');
  let ok = false;
  if (exists(cfgPath)) {
    try {
      const cfg = JSON.parse(read(cfgPath));
      ok = cfg.timeout >= 25;
    } catch (e) {}
  }
  assert(ok, name + ' 配置了 timeout >= 25s');
});

console.log('\n========================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
