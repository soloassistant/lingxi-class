/**
 * 扩充知识点：给 AP/SAT 等薄弱体系补足知识点（i5~i8），对齐真实课程规模
 * 运行：node _test/expand-knowledge.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', 'miniprogram', 'data', 'courses.js');
const d = require(DATA_FILE);

// 新增知识点（id -> 完整对象）。courseId/chapterId 与现有保持一致
const ADD = [
  // ===== AP Calculus（微积分）=====
  {
    id: 'ap_calc_i5', courseId: 'ap_calc', chapterId: 'ap_calc_ch0', type: 'lecture',
    title: '隐函数求导',
    enTitle: 'Implicit Differentiation',
    body: '隐函数是 y 没有显式解出的方程，如 x²+y²=25。求导时对两边关于 x 求导，遇到 y 的项用链式法则补 dy/dx，再解出 dy/dx。例：对 x²+y²=25 求导得 2x+2y·dy/dx=0，故 dy/dx=-x/y。',
    enBody: 'In an implicit equation like x²+y²=25, differentiate both sides with respect to x, applying the chain rule to y-terms, then solve for dy/dx. For x²+y²=25: 2x+2y·dy/dx=0, so dy/dx=-x/y.',
    quiz: { question: 'For x²+y²=25, dy/dx equals:', options: ['x/y', '-x/y', 'y/x', '-y/x'], answerIndex: 1, explanation: 'Differentiating gives 2x+2y·dy/dx=0, so dy/dx=-x/y.' }
  },
  {
    id: 'ap_calc_i6', courseId: 'ap_calc', chapterId: 'ap_calc_ch0', type: 'lecture',
    title: '相关变化率',
    enTitle: 'Related Rates',
    body: '相关变化率问题：一个量变化时另一个量跟着变。做法：写出几何关系式 → 两边对时间 t 求导 → 代入已知量求未知速率。例：圆的面积 A=πr²，dr/dt=2，则 dA/dt=2πr·dr/dt。',
    enBody: 'In related rates, one quantity changes as another changes. Write the geometric relation, differentiate both sides with respect to time t, then substitute known values. Example: for A=πr² with dr/dt=2, dA/dt=2πr·dr/dt.',
    quiz: { question: 'For A=πr² with r=3 and dr/dt=2, dA/dt is:', options: ['6π', '12π', '18π', '4π'], answerIndex: 1, explanation: 'dA/dt=2πr·dr/dt=2π(3)(2)=12π.' }
  },
  {
    id: 'ap_calc_i7', courseId: 'ap_calc', chapterId: 'ap_calc_ch0', type: 'lecture',
    title: '函数的极值与最值',
    enTitle: 'Extrema and Optimization',
    body: '求极值：先求 f\'(x)=0 的临界点，再用二阶导判定（f\'\'>0 极小，f\'\'<0 极大）。最值问题要把端点和临界点都代入比较。应用题先列目标函数，再求导找最值。',
    enBody: 'To find extrema, solve f\'(x)=0 for critical points, then use the second derivative (f\'\'>0 min, f\'\'<0 max). For absolute extrema, check endpoints too. In optimization, set up the objective function, then differentiate.',
    quiz: { question: 'If f\'(c)=0 and f\'\'(c)>0, the point c is a:', options: ['local maximum', 'local minimum', 'inflection point', 'discontinuity'], answerIndex: 1, explanation: 'f\'\'>0 means the function is concave up, so c is a local minimum.' }
  },
  {
    id: 'ap_calc_i8', courseId: 'ap_calc', chapterId: 'ap_calc_ch0', type: 'lecture',
    title: '洛必达法则',
    enTitle: "L'Hôpital's Rule",
    body: '洛必达法则用于 0/0 或 ∞/∞ 型极限：lim f(x)/g(x) = lim f\'(x)/g\'(x)。注意：必须先确认是 0/0 或 ∞/∞ 型，否则不能用。例：lim(x→0) sin x/x = lim cos x/1 = 1。',
    enBody: "L'Hôpital's rule handles 0/0 or ∞/∞ limits: lim f(x)/g(x) = lim f'(x)/g'(x). You must first confirm the indeterminate form. Example: lim(x→0) sin x/x = lim cos x/1 = 1.",
    quiz: { question: 'lim(x→0) sin x/x equals:', options: ['0', '1', '∞', 'does not exist'], answerIndex: 1, explanation: "By L'Hôpital's rule, the limit is lim cos x/1 = 1." }
  },

  // ===== AP Statistics（统计）=====
  {
    id: 'ap_stats_i5', courseId: 'ap_stats', chapterId: 'ap_stats_ch0', type: 'lecture',
    title: '两类错误',
    enTitle: 'Type I and Type II Errors',
    body: '第一类错误（Type I）：H₀ 为真却拒绝了它，概率为 α。第二类错误（Type II）：H₀ 为假却没拒绝，概率为 β。检验功效 power = 1-β。减小 α 会增大 β，需权衡。',
    enBody: 'Type I error: rejecting a true H₀, with probability α. Type II error: failing to reject a false H₀, with probability β. Power = 1-β. Reducing α increases β, so there is a trade-off.',
    quiz: { question: 'Rejecting a true null hypothesis is a:', options: ['Type I error', 'Type II error', 'correct decision', 'sampling error'], answerIndex: 0, explanation: 'Type I error is rejecting H₀ when it is actually true.' }
  },
  {
    id: 'ap_stats_i6', courseId: 'ap_stats', chapterId: 'ap_stats_ch0', type: 'lecture',
    title: '双样本检验',
    enTitle: 'Two-Sample Tests',
    body: '比较两组均值用双样本 t 检验。比较比例用双比例 z 检验。配对样本（同一批人前后测）用配对 t 检验。先明确研究问题，再选对应检验方法。',
    enBody: 'Use a two-sample t-test to compare two means, and a two-proportion z-test to compare two proportions. Paired samples (same subjects before/after) use a paired t-test. Clarify the research question, then pick the test.',
    quiz: { question: 'Comparing the same subjects before and after a treatment uses a:', options: ['two-sample t-test', 'paired t-test', 'z-test for proportions', 'chi-square test'], answerIndex: 1, explanation: 'Paired data (same subjects, two measurements) requires a paired t-test.' }
  },
  {
    id: 'ap_stats_i7', courseId: 'ap_stats', chapterId: 'ap_stats_ch0', type: 'lecture',
    title: '卡方检验',
    enTitle: 'Chi-Square Tests',
    body: '卡方检验用于分类数据。拟合优度检验：观察频数是否符合某个分布。独立性检验：两个分类变量是否相关。计算 χ²=Σ(O-E)²/E，与临界值或 p 值比较。',
    enBody: 'Chi-square tests work with categorical data. A goodness-of-fit test checks if observed frequencies match a distribution. A test of independence checks association between two categorical variables. Compute χ²=Σ(O-E)²/E.',
    quiz: { question: 'Chi-square tests are used for:', options: ['means', 'proportions', 'categorical data', 'paired data'], answerIndex: 2, explanation: 'Chi-square tests analyze categorical (count) data.' }
  },
  {
    id: 'ap_stats_i8', courseId: 'ap_stats', chapterId: 'ap_stats_ch0', type: 'lecture',
    title: '回归推断',
    enTitle: 'Inference for Regression',
    body: '对回归斜率做假设检验：H₀ 通常为 β=0（无线性关系）。t 检验判断斜率是否显著不为 0。同时给出斜率的置信区间。检查残差图的随机性验证线性条件。',
    enBody: 'Test the regression slope, typically H₀: β=0 (no linear relationship). A t-test determines if the slope differs significantly from 0, with a confidence interval for the slope. Check residual plots for randomness.',
    quiz: { question: 'In regression inference, the usual null hypothesis for the slope is:', options: ['β=1', 'β=0', 'β>0', 'β<0'], answerIndex: 1, explanation: 'The default null hypothesis is β=0, meaning no linear relationship.' }
  },

  // ===== SAT Math（数学）=====
  {
    id: 'sat_math_i5', courseId: 'sat_math', chapterId: 'sat_math_ch0', type: 'lecture',
    title: '指数与根式',
    enTitle: 'Exponents and Radicals',
    body: '指数运算：xᵃ·xᵇ=xᵃ⁺ᵇ，(xᵃ)ᵇ=xᵃᵇ，x⁻ᵃ=1/xᵃ。根式可写成分数指数：√x=x^(1/2)，∛x=x^(1/3)。解指数方程常取对数：xᵃ=b → a·log x=log b。',
    enBody: 'Exponent rules: xᵃ·xᵇ=xᵃ⁺ᵇ, (xᵃ)ᵇ=xᵃᵇ, x⁻ᵃ=1/xᵃ. Radicals are fractional exponents: √x=x^(1/2). Solve exponential equations with logs: xᵃ=b → a·log x=log b.',
    quiz: { question: '√x expressed as an exponent is:', options: ['x²', 'x^(1/2)', 'x^(1/3)', '2x'], answerIndex: 1, explanation: 'The square root is the 1/2 power: √x=x^(1/2).' }
  },
  {
    id: 'sat_math_i6', courseId: 'sat_math', chapterId: 'sat_math_ch0', type: 'lecture',
    title: '圆与抛物线方程',
    enTitle: 'Circles and Parabolas',
    body: '圆标准方程 (x-h)²+(y-k)²=r²，圆心 (h,k)、半径 r。抛物线顶点式 y=a(x-h)²+k，顶点 (h,k)。通过配方法把一般式化为标准式，直接读出几何特征。',
    enBody: 'Circle: (x-h)²+(y-k)²=r² with center (h,k), radius r. Parabola: y=a(x-h)²+k with vertex (h,k). Complete the square to convert general form to standard form and read off geometric features.',
    quiz: { question: 'For (x-2)²+(y+3)²=16, the radius is:', options: ['2', '3', '4', '16'], answerIndex: 2, explanation: 'r²=16, so r=4.' }
  },
  {
    id: 'sat_math_i7', courseId: 'sat_math', chapterId: 'sat_math_ch0', type: 'lecture',
    title: '比例与百分比',
    enTitle: 'Ratios and Percentages',
    body: '百分比增减：增加 p% 即乘以 (1+p/100)，减少 p% 即乘以 (1-p/100)。连续变化用连乘。比例问题设每份为 x，按比例分配。注意区分"占谁的百分比"。',
    enBody: 'Percentage change: an increase of p% multiplies by (1+p/100), a decrease by (1-p/100). Successive changes multiply. For ratio problems, let each part be x. Be careful about the base of the percentage.',
    quiz: { question: 'A 20% discount on a $50 item gives a price of:', options: ['$30', '$40', '$45', '$48'], answerIndex: 1, explanation: '50×(1-0.20)=50×0.8=$40.' }
  },
  {
    id: 'sat_math_i8', courseId: 'sat_math', chapterId: 'sat_math_ch0', type: 'lecture',
    title: '复数运算',
    enTitle: 'Complex Numbers',
    body: '复数 a+bi，i²=-1。加减：实部加实部、虚部加虚部。乘法展开后把 i² 换成 -1。除法：分子分母同乘共轭复数。复数相等则实部虚部分别相等。',
    enBody: 'A complex number is a+bi with i²=-1. Add by combining real and imaginary parts. Multiply by expanding and replacing i² with -1. To divide, multiply numerator and denominator by the conjugate.',
    quiz: { question: '(3+2i)(3-2i) equals:', options: ['9', '5', '13', '9-4i'], answerIndex: 2, explanation: '(3+2i)(3-2i)=9-4i²=9+4=13.' }
  },

  // ===== SAT Writing（写作）=====
  {
    id: 'sat_write_i5', courseId: 'sat_write', chapterId: 'sat_write_ch0', type: 'lecture',
    title: '平行结构',
    enTitle: 'Parallel Structure',
    body: '并列的语法成分必须结构一致：动词和动词并列、名词和名词并列。例：She likes reading, writing, and to swim ✗ → She likes reading, writing, and swimming ✓。',
    enBody: 'Coordinated items must share the same grammatical form. Example: "She likes reading, writing, and to swim" is wrong; it should be "reading, writing, and swimming".',
    quiz: { question: 'Which is correct?', options: ['to run, swimming, and biking', 'running, swimming, and biking', 'run, swimming, and to bike', 'running, to swim, and bike'], answerIndex: 1, explanation: 'All three items must be gerunds: running, swimming, and biking.' }
  },
  {
    id: 'sat_write_i6', courseId: 'sat_write', chapterId: 'sat_write_ch0', type: 'lecture',
    title: '代词指代清晰',
    enTitle: 'Pronoun Clarity',
    body: '代词必须清楚指代一个明确的先行词。当一个句子有多个可能的名词时，代词会产生歧义。例：When John met Bill, he smiled 中的 he 指代不清，应改为 When John met Bill, John smiled。',
    enBody: 'A pronoun must refer clearly to one antecedent. With multiple possible nouns, ambiguity arises. Example: "When John met Bill, he smiled" is unclear — use "John smiled" instead.',
    quiz: { question: 'Which sentence has clear pronoun reference?', options: ['When Tom met Jerry, he laughed.', 'Tom and Jerry met, and Tom laughed.', 'They met, and he laughed.', 'It was funny when he laughed.'], answerIndex: 1, explanation: 'Option 2 names Tom explicitly, removing the ambiguity.' }
  },
  {
    id: 'sat_write_i7', courseId: 'sat_write', chapterId: 'sat_write_ch0', type: 'lecture',
    title: '悬垂修饰语',
    enTitle: 'Dangling Modifiers',
    body: '修饰语必须紧邻它所修饰的成分。悬垂修饰语指修饰语在句首，但主句主语并非被修饰对象。例：Walking down the street, the trees were beautiful ✗（树不会走路）。',
    enBody: 'A modifier must sit next to what it modifies. A dangling modifier starts the sentence but the main subject is not what is being modified. Example: "Walking down the street, the trees were beautiful" is wrong because trees do not walk.',
    quiz: { question: 'Which fixes the dangling modifier?', options: ['Walking down the street, the trees were beautiful.', 'Walking down the street, I saw beautiful trees.', 'Walking down the street, beautiful trees were seen.', 'The trees, walking down the street, were beautiful.'], answerIndex: 1, explanation: 'Option 2 makes "I" the subject who is walking.' }
  },
  {
    id: 'sat_write_i8', courseId: 'sat_write', chapterId: 'sat_write_ch0', type: 'lecture',
    title: '简洁性原则',
    enTitle: 'Conciseness',
    body: 'SAT 写作偏好最简洁的表达。删掉冗余词（如 "in the future" 可省、"due to the fact that" → "because"）。多个选项都对时，选最短且不改变原意的。',
    enBody: 'SAT Writing favors the most concise expression. Cut redundancy ("due to the fact that" → "because"). When several options are grammatically correct, choose the shortest one that preserves meaning.',
    quiz: { question: 'Which is the most concise?', options: ['Due to the fact that it rained, we stayed.', 'Because it rained, we stayed.', 'The reason we stayed is because it rained.', 'It rained, and due to this fact we stayed.'], answerIndex: 1, explanation: '"Because it rained, we stayed" is the shortest and clearest.' }
  }
];

// 校验：新 id 不与现有冲突
const existingIds = new Set(d.knowledge.map(k => k.id));
const dup = ADD.filter(a => existingIds.has(a.id));
if (dup.length) {
  console.error('id 冲突:', dup.map(a => a.id).join(', '));
  process.exit(1);
}

// 校验 courseId/chapterId 存在
const courseIds = new Set(d.courses.map(c => c.id));
const chapterIds = new Set(d.chapters.map(c => c.id));
const bad = ADD.filter(a => !courseIds.has(a.courseId) || !chapterIds.has(a.chapterId));
if (bad.length) {
  console.error('courseId/chapterId 无效:', bad.map(a => a.id).join(', '));
  process.exit(1);
}

const knowledge = d.knowledge.concat(ADD);

// 重建 chapters.items（保持双向一致）
const chapters = d.chapters.map(ch => {
  const items = knowledge.filter(k => k.courseId === ch.courseId).map(k => ({
    id: k.id, title: k.title, learned: false, videoUrl: k.videoUrl || '', enBody: k.enBody || ''
  }));
  return Object.assign({}, ch, { items });
});

// 同步 course.desc
const countByCourse = {};
knowledge.forEach(k => { countByCourse[k.courseId] = (countByCourse[k.courseId] || 0) + 1; });
const courses = d.courses.map(c => Object.assign({}, c, { desc: (countByCourse[c.id] || 0) + ' 个知识点' }));

const header = `/**
 * 课程知识点数据全集（对象版）
 * knowledge: ${knowledge.length}条知识点 | courses: ${courses.length}门 | chapters: ${chapters.length}章
 * course.js 读 courses/chapters，teach.js 读 knowledge
 *
 * 数据一致性（由 _test/check-data.js 校验）
 */
`;
const body = [
  `const knowledge = ${JSON.stringify(knowledge, null, 2)};`, '',
  `const courses = ${JSON.stringify(courses, null, 2)};`, '',
  `const chapters = ${JSON.stringify(chapters, null, 2)};`, '',
  `const systems = ${JSON.stringify(d.systems, null, 2)};`, '',
  'module.exports = { courses, chapters, knowledge, systems };', ''
].join('\n');
fs.writeFileSync(DATA_FILE, header + '\n' + body, 'utf8');

console.log('=== 扩充完成 ===');
console.log('新增知识点:', ADD.length, '条');
console.log('知识点总数:', knowledge.length);
console.log('新增 id:', ADD.map(a => a.id).join(', '));
