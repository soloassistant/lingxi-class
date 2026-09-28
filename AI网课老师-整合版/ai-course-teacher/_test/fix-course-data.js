/**
 * 数据修复脚本（一次性）：
 *  1. 为缺失 courseId 的知识点按 chapterId 前缀回填 courseId
 *  2. 统一 chapterId 编号（knowledge 用 _ch1，chapters 用 _ch0 → 统一为 chapters 的 id）
 *  3. 补齐 enTitle（缺失时由 title 生成占位英文标题不会做——改为保留中文 title，enTitle 仅在能确定时补）
 *  4. 输出修复后的 data/courses.js
 *
 * 运行：node _test/fix-course-data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'miniprogram', 'data', 'courses.js');

// 加载现有数据
const data = require(DATA_FILE);
const courses = data.courses || [];
const chapters = data.chapters || [];
const knowledge = data.knowledge || [];
const systems = data.systems || [];

const courseIds = {};
courses.forEach(c => { courseIds[c.id] = true; });
const chapterMap = {};
chapters.forEach(ch => { chapterMap[ch.id] = ch; });
// 按 courseId 找章节（一个课程一个章节）
const chapterByCourse = {};
chapters.forEach(ch => { chapterByCourse[ch.courseId] = ch; });

const log = { courseIdFilled: 0, chapterIdFixed: 0, skipped: [] };

// 修复每个知识点
const fixedKnowledge = knowledge.map(k => {
  const out = JSON.parse(JSON.stringify(k));
  const origCourseId = out.courseId;
  const origChapterId = out.chapterId;

  // 1) 回填 courseId
  if (!out.courseId || !courseIds[out.courseId]) {
    let derived = null;
    if (out.chapterId) {
      derived = out.chapterId.replace(/_ch\d+$/, '');
    }
    if (derived && courseIds[derived]) {
      out.courseId = derived;
      if (!origCourseId) log.courseIdFilled++;
    } else {
      log.skipped.push({ id: out.id, reason: '无法推导 courseId', chapterId: out.chapterId });
      return out;
    }
  }

  // 2) 校正 chapterId：统一指向 chapters 集合里真实存在的那个章节
  const realChapter = chapterByCourse[out.courseId];
  if (realChapter) {
    if (out.chapterId !== realChapter.id) {
      out.chapterId = realChapter.id;
      if (origChapterId) log.chapterIdFixed++;
    }
  } else if (!out.chapterId) {
    log.skipped.push({ id: out.id, reason: '该课程无章节定义', courseId: out.courseId });
  }

  // 3) 保证 type 字段存在（内容类知识点统一 lecture）
  if (!out.type) out.type = 'lecture';

  return out;
});

// 重建 chapters：items 严格由 knowledge 派生，保证双向一致
const fixedChapters = chapters.map(ch => {
  const items = fixedKnowledge
    .filter(k => k.courseId === ch.courseId)
    .map(k => ({
      id: k.id,
      title: k.title,
      learned: false,
      videoUrl: k.videoUrl || '',
      enBody: k.enBody || ''
    }));
  return Object.assign({}, ch, { items });
});

// 同步课程 desc 的知识点数量（避免 desc 写死 "4 个知识点" 与实际不符）
const countByCourse = {};
fixedKnowledge.forEach(k => { countByCourse[k.courseId] = (countByCourse[k.courseId] || 0) + 1; });
const fixedCourses = courses.map(c => {
  const n = countByCourse[c.id] || 0;
  const desc = `${n} 个知识点`;
  return Object.assign({}, c, { desc });
});

// 生成文件（保持原有代码风格：knowledge/courses/chapters/systems 四个 const + module.exports）
function jsStr(s) {
  return JSON.stringify(s, null, 2);
}

const header = `/**
 * 课程知识点数据全集（对象版）
 * knowledge: ${fixedKnowledge.length}条知识点 | courses: ${fixedCourses.length}门 | chapters: ${fixedChapters.length}章
 * course.js 读 courses/chapters，teach.js 读 knowledge
 *
 * 数据一致性（由 _test/check-data.js 校验）：
 *   - 每个 knowledge.courseId 必须存在于 courses
 *   - 每个 knowledge.chapterId 必须存在于 chapters
 *   - 每个 chapters[].items[].id 必须能在 knowledge 里找到
 *   - 每个 course 至少有一个知识点
 */
`;

const body = [
  `const knowledge = ${jsStr(fixedKnowledge)};`,
  '',
  `const courses = ${jsStr(fixedCourses)};`,
  '',
  `const chapters = ${jsStr(fixedChapters)};`,
  '',
  `const systems = ${jsStr(systems)};`,
  '',
  'module.exports = { courses, chapters, knowledge, systems };',
  ''
].join('\n');

fs.writeFileSync(DATA_FILE, header + '\n' + body, 'utf8');

console.log('=== 修复完成 ===');
console.log('回填 courseId:', log.courseIdFilled, '条');
console.log('校正 chapterId:', log.chapterIdFixed, '条');
console.log('跳过:', log.skipped.length, '条');
if (log.skipped.length) console.log(JSON.stringify(log.skipped, null, 1));
console.log('知识点总数:', fixedKnowledge.length);
console.log('课程总数:', fixedCourses.length);
console.log('章节总数:', fixedChapters.length);
