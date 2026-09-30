#!/usr/bin/env node
/**
 * 生成 question_bank 的导入文件（R17）
 * ============================================================
 * 起因：`homeworkReview` 被要求"指出错误的主要原因"，但提示词里只有知识点 ID、
 * 学生所选序号、正确序号 —— **没有题干、没有选项、没有解析**。
 * 模型只能编。更糟的是那个"正确答案"是客户端提交上来的字段，服务端从未核对过。
 *
 * 修法的第一步是给服务端一个**可信题面来源**：把小程序包里的题库
 * （miniprogram/data/courses.js，学生实际看到的那一份）同步成 question_bank 集合。
 * 之后 homeworkSubmit 按 itemId + 版本号核对，而不是照抄客户端说的答案。
 *
 * 用法：
 *   node tools/sync-question-bank.js            # 写出 tools/question-bank.json
 *   node tools/sync-question-bank.js --check     # 只校验，不写文件（CI/测试用）
 *
 * 产物 question-bank.json 用微信开发者工具的「云开发 → 数据库 → 导入」上传，
 * 集合名 `question_bank`，主键 `_id`（= itemId，需勾选"导入时使用 _id"）。
 *
 * 校验不通过直接 exit 1，不产出半成品 —— 题库坏了必须在导入前发现，
 * 而不是等讲评给出基于错位答案的"错因分析"。
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* 题目版本号：对"题干 + 选项 + 正确选项"做 FNV-1a 32 位哈希。
   改动任何一项都会得到新版本 —— 学生看到的题与学生提交时的题不一致时，
   服务端才可能发现（否则答案键会张冠李戴）。
   ★ 云函数里有一份**逻辑必须一致**的拷贝（各云函数独立打包，不能跨目录 require）；
     _test/test-homework-review.js 会逐条比对两边的结果，防止手抄走样。 */
function questionVersion(quiz) {
  const canonical = canonicalOf(quiz);
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

function canonicalOf(quiz) {
  const q = (quiz && quiz.question) || '';
  const opts = (quiz && Array.isArray(quiz.options)) ? quiz.options : [];
  const ai = (quiz && quiz.answerIndex !== undefined) ? quiz.answerIndex : -1;
  return String(q) + '|' + opts.map(o => String(o)).join('\u0001') + '|' + String(ai);
}

function build() {
  const courses = require(path.join(__dirname, '..', 'miniprogram', 'data', 'courses.js'));
  const courseName = {};
  (courses.courses || []).forEach(c => { courseName[c.id] = c.name; });

  const problems = [];
  const seen = {};
  const rows = [];

  (courses.knowledge || []).forEach(k => {
    const quiz = k && k.quiz;
    if (!quiz || !quiz.question) return;
    if (!Array.isArray(quiz.options) || quiz.options.length < 2) {
      problems.push(k.id + '：选项少于 2 个');
      return;
    }
    if (!(quiz.answerIndex >= 0 && quiz.answerIndex < quiz.options.length)) {
      problems.push(k.id + '：answerIndex=' + quiz.answerIndex + ' 越界（选项 ' + quiz.options.length + ' 个）');
      return;
    }
    if (seen[k.id]) { problems.push(k.id + '：知识点 id 重复'); return; }
    seen[k.id] = true;

    rows.push({
      _id: k.id,                        // 主键 = itemId，homeworkSubmit 直接按 id 取
      itemId: k.id,
      courseId: k.courseId || '',
      courseName: courseName[k.courseId] || k.courseId || '',
      question: quiz.question,
      options: quiz.options,
      answerIndex: quiz.answerIndex,
      explanation: quiz.explanation || '',
      version: questionVersion(quiz)
    });
  });

  // 重复的版本号本身不是错误，但把"同一版本对应多道题"暴露出来便于排查
  const byVersion = {};
  rows.forEach(r => { (byVersion[r.version] = byVersion[r.version] || []).push(r.itemId); });

  return { rows, problems, byVersion };
}

const CHECK = process.argv.indexOf('--check') >= 0;
const outPath = path.join(__dirname, 'question-bank.json');

const { rows, problems, byVersion } = build();

if (problems.length) {
  console.error('题库校验未通过，未产出文件：');
  problems.forEach(p => console.error('  ✗ ' + p));
  process.exit(1);
}
if (rows.length === 0) {
  console.error('题库为空 —— 上游数据可能没加载出来。');
  process.exit(1);
}

const payload = JSON.stringify(rows, null, 2);
const versions = Object.keys(byVersion).length;

if (CHECK) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (existing.trim() !== payload.trim()) {
    console.error('question-bank.json 与 courses.js 不同步，请重新运行 node tools/sync-question-bank.js');
    process.exit(1);
  }
  console.log('CHECK_OK 共 ' + rows.length + ' 题，' + versions + ' 个版本，文件与题库一致');
} else {
  fs.writeFileSync(outPath, payload, 'utf8');
  console.log('已写出 ' + outPath);
  console.log('  题目 ' + rows.length + ' 条，版本 ' + versions + ' 个');
  console.log('  导入方式：云开发控制台 → 数据库 → 新建集合 question_bank → 导入该文件（勾选使用 _id）');
}
