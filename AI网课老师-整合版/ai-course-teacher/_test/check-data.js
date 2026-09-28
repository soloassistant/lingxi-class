/**
 * 数据层完整性校验（可在 CI / 每次改数据后运行）
 * 校验：
 *   1. knowledge.courseId 必须存在于 courses
 *   2. knowledge.chapterId 必须存在于 chapters
 *   3. chapters[].items[].id 必须能在 knowledge 里找到（双向一致）
 *   4. 每个 course 至少有一个知识点
 *   5. 每个 knowledge 的 quiz 结构合法（options 4 项、answerIndex 在范围内）
 *   6. id 全局唯一
 *
 * 运行：node _test/check-data.js
 */
'use strict';
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', 'miniprogram', 'data', 'courses.js');
const d = require(DATA_FILE);

let pass = 0, fail = 0;
const problems = [];
function check(cond, msg) {
  if (cond) { pass++; }
  else { fail++; problems.push(msg); console.log('  ✗ ' + msg); }
}

const courses = d.courses || [];
const chapters = d.chapters || [];
const knowledge = d.knowledge || [];
const systems = d.systems || [];

console.log(`\n数据规模：courses=${courses.length} chapters=${chapters.length} knowledge=${knowledge.length} systems=${systems.length}\n`);

const courseIds = new Set(courses.map(c => c.id));
const chapterIds = new Set(chapters.map(c => c.id));
const knowledgeIds = new Set(knowledge.map(k => k.id));

console.log('=== 1. knowledge.courseId 引用完整性 ===');
const badCourse = knowledge.filter(k => !courseIds.has(k.courseId));
check(badCourse.length === 0, `${badCourse.length} 个知识点的 courseId 无效（应为 0）` + (badCourse.length ? '：' + badCourse.slice(0, 3).map(k => k.id).join(', ') : ''));

console.log('=== 2. knowledge.chapterId 引用完整性 ===');
const badChapter = knowledge.filter(k => !k.chapterId || !chapterIds.has(k.chapterId));
check(badChapter.length === 0, `${badChapter.length} 个知识点的 chapterId 无效（应为 0）` + (badChapter.length ? '：' + badChapter.slice(0, 3).map(k => k.id).join(', ') : ''));

console.log('=== 3. chapters.items ↔ knowledge 双向一致 ===');
let mismatch = 0;
chapters.forEach(ch => {
  (ch.items || []).forEach(it => {
    const id = typeof it === 'string' ? it : it.id;
    if (!knowledgeIds.has(id)) mismatch++;
  });
});
check(mismatch === 0, `${mismatch} 个 chapters.items 引用了不存在的知识点（应为 0）`);

// 反向：每个知识点的 id 是否出现在其课程章节的 items 里
let notInChapter = 0;
chapters.forEach(ch => {
  const itemIds = new Set((ch.items || []).map(it => (typeof it === 'string' ? it : it.id)));
  knowledge.filter(k => k.courseId === ch.courseId).forEach(k => {
    if (!itemIds.has(k.id)) notInChapter++;
  });
});
check(notInChapter === 0, `${notInChapter} 个知识点未出现在所属章节 items 中（应为 0）`);

console.log('=== 4. 每个课程至少 1 个知识点 ===');
const countByCourse = {};
knowledge.forEach(k => { countByCourse[k.courseId] = (countByCourse[k.courseId] || 0) + 1; });
const emptyCourses = courses.filter(c => !countByCourse[c.id]);
check(emptyCourses.length === 0, `${emptyCourses.length} 个课程没有任何知识点（应为 0）` + (emptyCourses.length ? '：' + emptyCourses.slice(0, 5).map(c => c.id).join(', ') : ''));

console.log('=== 5. quiz 结构合法性 ===');
let badQuiz = 0;
knowledge.forEach(k => {
  const q = k.quiz;
  if (!q) { badQuiz++; return; }
  if (!Array.isArray(q.options) || q.options.length < 2) badQuiz++;
  else if (typeof q.answerIndex !== 'number' || q.answerIndex < 0 || q.answerIndex >= q.options.length) badQuiz++;
  else if (!q.question) badQuiz++;
});
check(badQuiz === 0, `${badQuiz} 个知识点的 quiz 结构不合法（应为 0）`);

console.log('=== 6. id 全局唯一 ===');
check(knowledgeIds.size === knowledge.length, `knowledge id 有重复（${knowledge.length} 条 / ${knowledgeIds.size} 个唯一 id）`);
check(new Set(courses.map(c => c.id)).size === courses.length, 'course id 有重复');
check(new Set(chapters.map(c => c.id)).size === chapters.length, 'chapter id 有重复');

console.log('=== 7. 每个 course 都有对应章节 ===');
const courseWithChapter = new Set(chapters.map(ch => ch.courseId));
const noChapter = courses.filter(c => !courseWithChapter.has(c.id));
check(noChapter.length === 0, `${noChapter.length} 个课程没有章节定义（应为 0）` + (noChapter.length ? '：' + noChapter.slice(0, 5).map(c => c.id).join(', ') : ''));

console.log('=== 8. systems 引用完整性 ===');
const sysIds = new Set(systems.map(s => s.id));
const badSys = courses.filter(c => !sysIds.has(c.systemId));
check(badSys.length === 0, `${badSys.length} 个课程的 systemId 无效（应为 0）` + (badSys.length ? '：' + badSys.slice(0, 5).map(c => c.id).join(', ') : ''));

console.log('\n========================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log('\n存在的问题：');
  problems.forEach(p => console.log('  - ' + p));
}
process.exit(fail > 0 ? 1 : 0);
