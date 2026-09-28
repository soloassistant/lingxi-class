/* 单测：quiz 页渲染细节 + 兜底题目 + teacherSystemPrompt 题目注入
 *
 * 运行（Windows）：
 *   $env:NODE_PATH="C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules"
 *   & "C:\...\node.exe" tests\quiz.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.local/' });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
window.speechSynthesis = {
  getVoices: () => [{ name: 'Xiaoxiao', lang: 'zh-CN' }],
  speak() {}, cancel() {}, onvoiceschanged: null,
};
window.SpeechSynthesisUtterance = function (txt) { this.text = txt; };
window.WorkBuddyCloud = { createWorkBuddyCloud: () => ({
  llm: { models: { list: async () => [{ id: 'm', name: 'M', disabled: false }] } },
}) };

const sc = document.createElement('script');
sc.textContent = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
document.head.appendChild(sc);

let pass = 0;
let fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

console.log('=== A. quiz 页渲染 ===');
const quiz = {
  type: 'quiz', title: '随堂练习', subtitle: '限时2分钟', question: '2x+3=7，x=?',
  options: ['A. 1', 'B. 2', 'C. 3', 'D. 4'], answer: 'B',
  analysis: '移项得 2x=4，故 x=2。', note: '讲题',
};
const h = window.slideHTML(quiz, 2, 5, 'indigo');
t('含 sl-quiz 类', /sl-quiz/.test(h));
t('题干渲染', h.includes('2x+3=7'));
t('4 个选项', (h.match(/<li class="qz-opt/g) || []).length === 4);
t('正确项高亮', /qz-opt qz-right/.test(h));
t('正确项是 B', /qz-opt qz-right" data-opt="B"/.test(h));
t('答案区折叠', /<details class="qz-ans">/.test(h));
t('显示正确答案', h.includes('正确答案'));
t('解析渲染', h.includes('移项得'));
t('选项前缀已剥离', !h.includes('A. 1') && h.includes('>1<'));
t('页码正确', h.includes('3 / 5'));

console.log('\n=== B. 开放题（无选项） ===');
const open = { type: 'quiz', title: '计算题', question: '求 1+2+…+100', options: [], answer: '5050', analysis: '高斯求和', note: '' };
const ho = window.slideHTML(open, 0, 2, 'ocean');
t('走开放题分支', /qz-open/.test(ho));
t('无选项列表', !/qz-opts/.test(ho));

console.log('\n=== C. 兜底：AI 没给 quiz 时自动补题 ===');
const course = { id: 'c1', title: '课', subject: '数学', grade: '高一', system: 'cn', createdAt: Date.now(), boards: [], boardNames: [] };
const outline = {
  title: '课', knowledgePoints: ['一元二次方程', '判别式'],
  stages: [{ name: '导入', duration: '5分钟', content: '热身' }],
  slides: [
    { type: 'cover', title: '课', subtitle: 's' },
    { type: 'content', title: '知识', bullets: ['a', 'b'], note: 'n' },
    { type: 'summary', title: '小结', bullets: ['x'], note: '' },
  ],
};
const ns = window.normalizeSlides(outline, course);
const types = ns.map((s) => s.type);
t('自动补上 quiz', types.includes('quiz'), JSON.stringify(types));
t('quiz 在 summary 之前', types.indexOf('quiz') < types.indexOf('summary'));
t('补的题有题干', !!ns.find((s) => s.type === 'quiz').question);
t('补的题有答案', !!ns.find((s) => s.type === 'quiz').answer);
console.log('   pages:', types.join(' -> '));

console.log('\n=== D. 全无 slides 的纯大纲兜底 ===');
const ns2 = window.normalizeSlides({
  title: 'T', knowledgePoints: ['P1', 'P2'],
  stages: [{ name: 'S1', duration: '5', content: 'c1；c2' }], homework: ['h1'],
}, course);
const t2 = ns2.map((s) => s.type);
t('有 quiz', t2.includes('quiz'), JSON.stringify(t2));
t('首尾为 cover/summary', t2[0] === 'cover' && t2[t2.length - 1] === 'summary');
console.log('   pages:', t2.join(' -> '));

console.log('\n=== E. 丢弃无题干空题页 ===');
const ns3 = window.normalizeSlides({ title: 'T', slides: [
  { type: 'cover', title: 'c' },
  { type: 'quiz', title: '空题' },
  { type: 'quiz', title: '真题', question: 'q', answer: 'A' },
  { type: 'summary', title: 's' },
] }, course);
const q3 = ns3.filter((s) => s.type === 'quiz');
t('空题页被丢弃', q3.length === 1 && q3[0].title === '真题',
  JSON.stringify(ns3.map((s) => s.type + ':' + s.title)));

console.log('\n=== F. teacherSystemPrompt 注入题目 ===');
try {
  const c2 = Object.assign({}, course, { slides: window.normalizeSlides(outline, course), outline });
  const sys = window.teacherSystemPrompt(c2);
  t('含练习页标记', sys.includes('【练习页】'));
  t('含题干', sys.includes('说法正确的是'));
  t('含答案', sys.includes('正确答案'));
  t('含出题模式规则', sys.includes('出题模式') || sys.includes('不要立刻公布答案'));
  t('含课件页标记', sys.includes('【封面】'));
} catch (e) {
  t('teacherSystemPrompt 执行', false, e.message);
}

console.log('\n=== G. quizCountOf ===');
t('统计题数', window.quizCountOf({ slides: ns }) === 1, String(window.quizCountOf({ slides: ns })));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
