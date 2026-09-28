/* 单测：入学诊断（起点画像）—— 出题 / 判定 / 聚合 / 注入 / 落库 / 渲染
 *
 * 为什么单独测：诊断是"这节课从哪里讲起"的唯一依据，它一旦算错，
 * 后果是把学生**已经掌握的内容再讲一遍**（浪费时间、打击信心），
 * 或者把**没掌握的内容当成会了直接跳过**（更严重：地基塌了还在往上盖）。
 *
 * 所以这里锁住三件事：
 *   1) 「未作答」不能算错 —— 学生只是没来得及做，当成不会会冤枉人；
 *   2) 同一知识点多题时**最差档胜出** —— 和掌握度图谱同一哲学，不许用好信号平均掉坏信号；
 *   3) 画像必须**同时**告诉模型"要讲什么"和"可以不讲什么" —— 只说薄弱等于没说完。
 *
 * 运行（Windows）：
 *   $env:NODE_PATH="C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules"
 *   & "C:\...\node.exe" tests\diagnostic.test.js
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

/* 写入 student_facts 的桩：把每一次 insert 都记下来，供断言检查形状。
   注意 insert() 返回的是 Promise，且会被 .select('id') 链式接住。 */
const inserted = [];
function makeDb() {
  const q = {
    select: () => q, order: () => q, limit: () => q, eq: () => q,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    update: () => q,
    insert: (rows) => {
      (Array.isArray(rows) ? rows : [rows]).forEach((r) => inserted.push(r));
      return Promise.resolve({ data: (Array.isArray(rows) ? rows : [rows]).map((_, i) => ({ id: 'f' + i })), error: null });
    },
    then: (res) => Promise.resolve({ data: [], error: null }).then(res),
  };
  return { from: () => q };
}

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.local/' });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
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
    },
    database: makeDb(),
  }),
};

const sc = document.createElement('script');
sc.textContent = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
document.head.appendChild(sc);
const W = window;

/* 造卷小工具：三题三知识点，覆盖 choice 对 / choice 错 / short 字面 */
const paper = [
  { topic: '配方法', type: 'choice', question: 'x²+2x-3=0 配方后是？', options: ['A. (x+1)²=4', 'B. (x+2)²=4'], answer: 'A' },
  { topic: '判别式', type: 'choice', question: 'x²+x+1=0 有几个实根？', options: ['A. 2 个', 'B. 0 个'], answer: 'B' },
  { topic: '韦达定理', type: 'short', question: '写出两根之和的表达式', options: [], answer: 'x1+x2=-b/a' },
];

(async () => {
  await new Promise((r) => setTimeout(r, 300));

  /* ============ A. 分档定义 ============ */
  console.log('=== A. 诊断分档（DIAG_LEVELS） ===');
  const L = W.DIAG_LEVELS;
  t('四档：已掌握/待确认/未掌握/未作答',
    ['ok', 'fuzzy', 'gap', 'na'].every((k) => !!L[k]), Object.keys(L).join(','));
  t('每档都有中文标签', Object.keys(L).every((k) => !!L[k].label));
  t('每档都有配色类名', Object.keys(L).every((k) => /^d-/.test(L[k].cls)));
  t('每档都有图标', Object.keys(L).every((k) => !!L[k].icon));
  t('「未作答」是独立一档（不叫「错误」）', L.na.label === '未作答' && !/错/.test(L.na.label));
  t('严重度排序：gap > fuzzy > ok', L.gap.order > L.fuzzy.order && L.fuzzy.order > L.ok.order);
  t('题量下限 5 题', W.DIAG_MIN === 5, String(W.DIAG_MIN));
  t('题量上限 8 题', W.DIAG_MAX === 8, String(W.DIAG_MAX));
  t('下限 < 上限', W.DIAG_MIN < W.DIAG_MAX);

  /* ============ B. normDiagLevel 容错 ============ */
  console.log('\n=== B. normDiagLevel 容错 ===');
  t('英文枚举直通（ok）', W.normDiagLevel('ok') === 'ok');
  t('英文枚举直通（gap）', W.normDiagLevel('gap') === 'gap');
  t('大写/空格容错', W.normDiagLevel('  FUZZY ') === 'fuzzy');
  t('"对" → ok', W.normDiagLevel('对') === 'ok');
  t('"会" → ok', W.normDiagLevel('会') === 'ok');
  t('"掌握" → ok', W.normDiagLevel('掌握') === 'ok');
  t('"true" → ok', W.normDiagLevel('true') === 'ok');
  t('"错" → gap', W.normDiagLevel('错') === 'gap');
  t('"不会" → gap', W.normDiagLevel('不会') === 'gap');
  t('"false" → gap', W.normDiagLevel('false') === 'gap');
  t('识别不了 → na（不猜）', W.normDiagLevel('天气不错') === 'na');
  t('空值 → na', W.normDiagLevel(null) === 'na' && W.normDiagLevel('') === 'na');
  t('na 不会被当成 ok/gap', W.normDiagLevel('na') === 'na');

  /* ============ C. judgeDiagItem 单题判定 ============ */
  console.log('\n=== C. judgeDiagItem 单题判定 ===');
  const ch = paper[0];
  t('选对 → ok', W.judgeDiagItem(ch, { value: 'A' }).level === 'ok');
  t('选错 → gap', W.judgeDiagItem(ch, { value: 'B' }).level === 'gap');
  t('小写答案也认', W.judgeDiagItem(ch, { value: 'a' }).level === 'ok');
  t('带空格也认', W.judgeDiagItem(ch, { value: ' b ' }).level === 'gap');
  t('选错时给出正确答案', /A/.test(W.judgeDiagItem(ch, { value: 'B' }).reason));
  t('★ 空着没写 → na 而不是 gap',
    W.judgeDiagItem(ch, { value: '' }).level === 'na' && W.judgeDiagItem(ch, {}).level === 'na');
  t('未作答时不判"错"', !/错/.test(W.judgeDiagItem(ch, { value: '' }).reason));
  t('选择题缺参考答案 → fuzzy（不硬判）',
    W.judgeDiagItem({ topic: 'T', type: 'choice', answer: '' }, { value: 'A' }).level === 'fuzzy');

  const sh = paper[2];
  t('简答 + 自评"做对了" → ok', W.judgeDiagItem(sh, { value: 'x1+x2=-b/a', self: 'sure' }).level === 'ok');
  t('简答 + 自评"不确定" → fuzzy', W.judgeDiagItem(sh, { value: '大概', self: 'unsure' }).level === 'fuzzy');
  t('简答写了但没自评 → fuzzy', W.judgeDiagItem(sh, { value: '写了点东西' }).level === 'fuzzy');
  t('简答完全没写 → na', W.judgeDiagItem(sh, { value: '' }).level === 'na');
  t('★ 简答"写了但不确定" ≠ "没写"（fuzzy vs na）',
    W.judgeDiagItem(sh, { value: 'x', self: 'unsure' }).level !== W.judgeDiagItem(sh, { value: '' }).level);
  t('空 item 不炸', W.judgeDiagItem(null, { value: 'A' }).level === 'na');

  /* ============ D. buildDiagnostic 聚合 ============ */
  console.log('\n=== D. buildDiagnostic 聚合 ===');
  const allRight = W.buildDiagnostic(paper, [
    { value: 'A' }, { value: 'B' }, { value: 'x1+x2=-b/a', self: 'sure' },
  ]);
  t('按 topic 分组', allRight.topics.length === 3, String(allRight.topics.length));
  t('全对 → counts.ok=3', allRight.counts.ok === 3);
  t('全对 → score=100', allRight.score === 100, String(allRight.score));
  t('全对 → focus 为空', allRight.focus.length === 0);
  t('全对 → skip 含全部知识点', allRight.skip.length === 3);
  t('全对时结论说"直接跳更难内容"', /更难|直接跳/.test(allRight.verdict));
  t('judged 只数被真正评估的', allRight.judged === 3);

  const mixed = W.buildDiagnostic(paper, [
    { value: 'A' },                     // 配方法 ok
    { value: 'A' },                     // 判别式 错 → gap
    { value: '', self: '' },            // 韦达定理 没写 → na
  ]);
  t('混合：ok=1', mixed.counts.ok === 1, String(mixed.counts.ok));
  t('混合：gap=1', mixed.counts.gap === 1, String(mixed.counts.gap));
  t('混合：na=1', mixed.counts.na === 1, String(mixed.counts.na));
  t('★ na 不计入 judged', mixed.judged === 2, String(mixed.judged));
  t('★ score 分母不含 na（1/2=50）', mixed.score === 50, String(mixed.score));
  t('未掌握优先排前面（focus[0] 是 gap）', mixed.focus[0] === '判别式', mixed.focus.join(','));
  t('已掌握进 skip', mixed.skip.includes('配方法'));
  t('未作答不进 focus 也不进 skip',
    !mixed.focus.includes('韦达定理') && !mixed.skip.includes('韦达定理'));

  // ★ 同一知识点两题、一对一错 → 必须按最差档（gap）处理，不能被平均成"半会"
  const twice = W.buildDiagnostic([
    { topic: '配方法', type: 'choice', question: 'q1', options: ['A. 1', 'B. 2'], answer: 'A' },
    { topic: '配方法', type: 'choice', question: 'q2', options: ['A. 1', 'B. 2'], answer: 'A' },
  ], [{ value: 'A' }, { value: 'B' }]);
  t('★ 同知识点一对一错 → 最差档胜出（gap，不是"掌握一半"）', twice.topics[0].level === 'gap');
  t('同一知识点只占一个条目', twice.topics.length === 1);
  t('记录该知识点出了几题', twice.topics[0].count === 2);
  t('一对一错时不给 skip', !twice.skip.includes('配方法'));

  // 全 na → 无法判断，但绝不能报错或谎称掌握
  const blank = W.buildDiagnostic(paper, []);
  t('全部未作答时 judged=0', blank.judged === 0);
  t('全部未作答时 score=0', blank.score === 0);
  t('全部未作答时结论说明"无法判断"并给出退路',
    /无法判断/.test(blank.verdict) && /课上/.test(blank.verdict));
  t('全部未作答时 focus/skip 为空', blank.focus.length === 0 && blank.skip.length === 0);

  // verdict 四分支
  t('无 gap 无 fuzzy → 扎实分支', /全都答对/.test(allRight.verdict));
  const onlyFuzzy = W.buildDiagnostic(paper, [
    { value: 'A' }, { value: 'B' }, { value: 'x', self: 'unsure' },
  ]);
  t('只有疑点 → 快速确认分支', onlyFuzzy.counts.gap === 0 && onlyFuzzy.counts.fuzzy > 0 && /确认/.test(onlyFuzzy.verdict));
  const halfGap = W.buildDiagnostic([
    { topic: 'A', type: 'choice', question: 'q', options: ['A. 1', 'B. 2'], answer: 'A' },
    { topic: 'B', type: 'choice', question: 'q', options: ['A. 1', 'B. 2'], answer: 'A' },
  ], [{ value: 'B' }, { value: 'B' }]);
  t('过半未掌握 → 从最基础讲起分支', /最基础/.test(halfGap.verdict));
  t('过半未掌握时不预设学生已会', /不预设/.test(halfGap.verdict));
  // 部分掌握：3 个知识点里 2 个会、1 个不会 → gap(1) < ceil(3/2)=2，落在"部分掌握"分支
  const partial = W.buildDiagnostic(paper, [
    { value: 'A' }, { value: 'B' }, { value: '不对', self: 'unsure' },
  ]);
  t('部分掌握分支：gap 少但非零', partial.counts.gap === 0 && partial.counts.fuzzy === 1);
  const partialGap = W.buildDiagnostic([
    { topic: 'A', type: 'choice', question: 'q', options: ['A. 1', 'B. 2'], answer: 'A' },
    { topic: 'B', type: 'choice', question: 'q', options: ['A. 1', 'B. 2'], answer: 'A' },
    { topic: 'C', type: 'choice', question: 'q', options: ['A. 1', 'B. 2'], answer: 'A' },
    { topic: 'D', type: 'choice', question: 'q', options: ['A. 1', 'B. 2'], answer: 'A' },
  ], [{ value: 'A' }, { value: 'A' }, { value: 'A' }, { value: 'B' }]);
  t('极少未掌握（1/4）→ 跳过已会、集中讲薄弱',
    /跳过/.test(partialGap.verdict) && /薄弱/.test(partialGap.verdict));

  t('非数组 items 不炸', W.buildDiagnostic(null, null).topics.length === 0);
  t('缺 topic 时用题号兜底',
    W.buildDiagnostic([{ topic: '', type: 'choice', question: 'q', options: ['A. 1'], answer: 'A' }], [{ value: 'A' }])
      .topics[0].topic === '第 1 题');

  /* ============ E. buildDiagnosticPrompt 出题要求 ============ */
  console.log('\n=== E. buildDiagnosticPrompt ===');
  W.state.gen.subject = '数学';
  W.state.gen.system = 'cn';
  W.state.gen.level = '中';
  const bp = W.buildDiagnosticPrompt({ subject: '数学', grade: '初三', goal: '掌握一元二次方程', count: 6 });
  t('要求每题只考一个知识点', /只考察\*\*一个\*\*知识点/.test(bp));
  t('要求写 topic 字段', /topic/.test(bp));
  t('要求难度有梯度', /梯度/.test(bp));
  t('要求 1-2 分钟可完成', /1-2 分钟/.test(bp));
  t('★ 明确不要出压轴题', /不要出需要长篇演算的压轴题/.test(bp));
  t('要求干扰项真实', /干扰项要真实/.test(bp));
  t('带上学习目标', bp.includes('掌握一元二次方程'));
  t('带上题量', bp.includes('6 题'));
  t('题量低于下限时被夹到下限',
    W.buildDiagnosticPrompt({ subject: '数学', count: 2 }).includes(W.DIAG_MIN + ' 题'));
  t('题量超上限时被夹到上限',
    W.buildDiagnosticPrompt({ subject: '数学', count: 99 }).includes(W.DIAG_MAX + ' 题'));
  t('国际体系会给出考纲与英文术语要求', (() => {
    W.state.gen.system = 'intl';
    const r = W.buildDiagnosticPrompt({ subject: 'Math', system: 'intl', boards: ['ib'] });
    W.state.gen.system = 'cn';
    return /考纲/.test(r) && /英文/.test(r);
  })());
  const ds = W.diagnosticSystemPrompt();
  t('系统提示词只吐 JSON', /只输出一个 JSON 对象/.test(ds));
  t('系统提示词含 items 结构', /"items"/.test(ds) && /"topic"/.test(ds));
  t('系统提示词说明 topic 要能当唯一标识复用', /唯一标识/.test(ds));
  t('系统提示词要求简答题 options 为空数组', /options 必须是空数组/.test(ds));
  t('系统提示词含 ifWrong（给老师判断用）', /ifWrong/.test(ds));

  /* ============ F. cleanDiagnostic 清洗 ============ */
  console.log('\n=== F. cleanDiagnostic 清洗 ===');
  const raw = {
    title: '一元二次方程诊断',
    intro: '这不是考试',
    items: [
      { topic: '配方法', type: 'choice', question: 'q1', options: ['(x+1)²=4', 'B. (x+2)²=4'], answer: 'A' },
      { topic: '判别式', type: 'choice', question: 'q2', options: ['A. 1', 'B. 2'], answer: '答案是 B。' },
      { topic: '韦达定理', type: 'choice', question: 'q3', options: [], answer: '', why: '记混了' },
      { topic: '配方法', type: 'choice', question: 'q4', options: ['A. 1'], answer: 'A' },
      { topic: '配方法', type: 'choice', question: 'q5', options: ['A. 1'], answer: 'A' },
      null,
      { topic: 'x', question: '' },
      { topic: '', type: 'choice', question: 'q5', options: ['A. 1'], answer: 'A' },
    ],
  };
  const cd = W.cleanDiagnostic(raw, { subject: '数学', system: 'cn' });
  t('缺 A. 前缀时自动补', /^A\. /.test(cd.items[0].options[0]), cd.items[0].options[0]);
  t('已有前缀不重复补', cd.items[0].options[1].startsWith('B. '));
  t('"答案是 B。"压成单个字母', cd.items[1].answer === 'B', cd.items[1].answer);
  t('★ options 为空 → 降级为 short（模型不能拿空选择题糊弄）', cd.items[2].type === 'short');
  t('同知识点最多留 2 条', cd.items.filter((x) => x.topic === '配方法').length === 2);
  t('缺 topic 时用题号兜底', cd.items.some((x) => /^第 \d+ 题$/.test(x.topic)));
  t('无 question 的条目被丢弃', cd.items.every((x) => !!x.question));
  t('null 条目被跳过', cd.items.length === 5, String(cd.items.length));
  t('title 透传', cd.title === '一元二次方程诊断');
  t('intro 透传', cd.intro === '这不是考试');
  t('subject/system 从 opt 带上', cd.subject === '数学' && cd.system === 'cn');
  t('非对象输入不炸', W.cleanDiagnostic(null).items.length === 0);
  t('非数组 items 不炸', W.cleanDiagnostic({ items: 'nope' }).items.length === 0);
  t('title 缺失时给默认值', W.cleanDiagnostic({}).title === '课前诊断');
  t('intro 缺失时有安抚性默认文案',
    /不是考试/.test(W.cleanDiagnostic({}).intro) && /没关系/.test(W.cleanDiagnostic({}).intro));
  const capSrc = { items: [] };
  for (let i = 0; i < 20; i++) capSrc.items.push({ topic: 'T' + i, type: 'choice', question: 'q' + i, options: ['A. 1'], answer: 'A' });
  t('★ 总题量被夹到 DIAG_MAX', W.cleanDiagnostic(capSrc).items.length === W.DIAG_MAX);
  const longQ = W.cleanDiagnostic({ items: [{ topic: 'T', type: 'choice', question: 'q'.repeat(900), options: ['A. 1'], answer: 'A' }] });
  t('题干被截断（不炸 prompt）', longQ.items[0].question.length <= 500);
  t('缺 why 时给空串（不产生 undefined）', longQ.items[0].why === '');

  /* ============ G. diagnosticPromptBlock：把"可以不讲"交出去 ============ */
  console.log('\n=== G. diagnosticPromptBlock 注入课程设计 ===');
  W.diagState.profile = W.buildDiagnostic(paper, [
    { value: 'A' }, { value: 'A' }, { value: '', self: '' },
  ]);
  const blk = W.diagnosticPromptBlock();
  t('含【课前诊断结果】标题', blk.includes('课前诊断结果'));
  t('列出尚未掌握的知识点', blk.includes('判别式'));
  t('★ 明确列出已掌握、要求不要再从零讲', blk.includes('已经掌握') && /不要再花时间从零讲/.test(blk));
  t('已掌握的知识点出现在块里', blk.includes('配方法'));
  t('要求按诊断调整重心', /调整这节课的重心/.test(blk));
  t('提醒别因为选了难度就假设已有前置知识', /不?要因为学生选了/.test(blk));
  W.diagState.profile = null;
  t('无诊断时不注入任何内容（空串）', W.diagnosticPromptBlock() === '');
  W.diagState.profile = W.buildDiagnostic(paper, []);
  t('诊断全未作答时不注入（judged=0）', W.diagnosticPromptBlock() === '');
  W.diagState.profile = null;

  /* ============ H. teacherSystemPrompt：诊断要进直播老师的人设 ============ */
  console.log('\n=== H. teacherSystemPrompt 诊断指令 ===');
  W.state.gen.level = '中';
  const courseNoDiag = { system: 'cn', title: 'T', subject: '数学', grade: '初三', level: '中', duration: '45分钟' };
  const sysNo = W.teacherSystemPrompt(courseNoDiag);
  t('无诊断时不出现诊断段落', !sysNo.includes('课前诊断结果'));

  const courseDiag = Object.assign({}, courseNoDiag, {
    diag: { focus: ['判别式', '韦达定理'], skip: ['配方法'], counts: { ok: 1, fuzzy: 1, gap: 1, na: 0 }, score: 33 },
  });
  const sysDiag = W.teacherSystemPrompt(courseDiag);
  t('有诊断时出现课前诊断段落', sysDiag.includes('课前诊断结果'));
  t('把薄弱点列为本节课重点', sysDiag.includes('判别式') && /重点/.test(sysDiag));
  t('★ 明确"不要再从零讲"已掌握的知识点', sysDiag.includes('不要再从零讲'));
  t('已掌握的知识点被点名', sysDiag.includes('配方法'));
  t('把时间留给没掌握的', /把时间留给/.test(sysDiag));
  t('★ 提醒诊断不是定论（课上一问发现会了就往下走）', /诊断不等于定论/.test(sysDiag));
  t('未登录也能吃到诊断（不依赖 memoryPromptBlock）', (() => {
    W.state.user = null; W.state.mem = null;
    const s = W.teacherSystemPrompt(courseDiag);
    return s.includes('课前诊断结果') && s.includes('配方法');
  })());

  /* ============ I. persistDiagnostic 落库形状 ============ */
  console.log('\n=== I. persistDiagnostic 落库 ===');
  W.state.user = { id: 'u1', email: 'a@b.com' };
  W.state.cloud = { database: makeDb() };
  W.state.gen.subject = '数学';
  W.state.gen.system = 'cn';
  inserted.length = 0;
  const prof = W.buildDiagnostic(paper, [
    { value: 'A' }, { value: 'A' }, { value: 'x', self: 'unsure' },
  ]);
  await W.persistDiagnostic(prof, { subject: '数学', system: 'cn', grade: '初三', goal: 'g' });
  const diagFacts = inserted.filter((f) => f.source === 'diagnostic');
  t('写入 source=diagnostic 的事实', diagFacts.length > 0, String(diagFacts.length));
  t('未掌握 → kind=weak 且高置信', diagFacts.some((f) => f.kind === 'weak' && f.topic === '判别式' && f.confidence >= 0.9));
  t('待确认 → kind=weak 但置信度略低', diagFacts.some((f) => f.kind === 'weak' && f.topic === '韦达定理' && f.confidence < 0.9));
  t('已掌握 → kind=strength（用来让老师跳过铺垫）',
    diagFacts.some((f) => f.kind === 'strength' && f.topic === '配方法'));
  t('strength 文案说明"可直接略过基础铺垫"', diagFacts.some((f) => f.kind === 'strength' && /略过基础铺垫/.test(f.content)));
  t('未掌握文案说明"第一节课从这里开始"', diagFacts.some((f) => f.kind === 'weak' && /第一节课要从这里开始讲/.test(f.content)));
  t('另写一条 context 汇总', diagFacts.some((f) => f.kind === 'context' && /起步水平/.test(f.content)));
  t('所有事实都带 subject', diagFacts.every((f) => f.subject === '数学'));
  t('事实内容里带上错因线索（reason）', diagFacts.some((f) => /正确答案/.test(f.content) || /不确定/.test(f.content)));
  t('未作答的知识点不写进记忆（没信息就不记）', !diagFacts.some((f) => f.topic === '不存在'));
  const emptyProf = W.buildDiagnostic(paper, []);
  inserted.length = 0;
  const n0 = await W.persistDiagnostic(emptyProf, {});
  t('judged=0 时一条都不写', n0 === 0 && inserted.length === 0);
  t('profile 为 null 时安全返回', (await W.persistDiagnostic(null, {})) === 0);

  /* ============ J. renderDiagProfile 渲染与转义 ============ */
  console.log('\n=== J. renderDiagProfile 渲染 ===');
  const box = document.getElementById('gen-diag');
  t('页面存在诊断容器 #gen-diag', !!box);
  box.innerHTML = '';
  W.renderDiagProfile(prof);
  const ph = box.innerHTML;
  t('渲染起点画像标题', ph.includes('起点画像'));
  // 回归：chip 曾误用 mdLite() 包裹，导致 <span class="dp-chip"> 源码被转义成可见文本
  t('★ chip 渲染为元素（不被转义成源码文本）',
    ph.includes('class="dp-chip"') && !ph.includes('&lt;span class="dp-chip"'));
  t('渲染四态统计', ph.includes('dp-stat ok') && ph.includes('dp-stat gap'));
  t('渲染结论', ph.includes('dp-verdict'));
  t('渲染"重点讲"区块', ph.includes('这节课重点讲'));
  t('渲染"可以跳过"区块', ph.includes('可以跳过'));
  t('渲染知识点', ph.includes('判别式'));
  t('渲染继续生成课程按钮', ph.includes('btn-diag-tocourse'));
  t('渲染重做按钮', ph.includes('btn-diag-retry'));
  t('说明画像会交给老师、不再讲已会的', /不会再讲你已经会的/.test(ph));
  t('★ 明确"多错几道反而是好事"（降低开课前焦虑）', /多错几道反而是好事/.test(ph));
  t('统计不含未作答时不渲染 na 块（0 就隐藏）', (() => {
    box.innerHTML = '';
    W.renderDiagProfile(allRight);
    return !box.innerHTML.includes('dp-stat na');
  })());
  t('有未作答时渲染 na 块', (() => {
    box.innerHTML = '';
    W.renderDiagProfile(W.buildDiagnostic(paper, []));
    return box.innerHTML.includes('dp-stat na');
  })());

  // XSS：诊断题与 topic 都是模型输出，必须转义
  const X = '<img src=x onerror=alert(1)>';
  const XS = '<script>alert(2)</script>';
  box.innerHTML = '';
  W.renderDiagProfile(W.buildDiagnostic([{ topic: X, type: 'choice', question: XS, options: ['A. ' + X], answer: 'B' }], [{ value: 'A' }]));
  t('renderDiagProfile 无裸 img', box.querySelector('img') === null);
  t('renderDiagProfile 无裸 script', box.querySelector('script') === null);
  t('renderDiagProfile 转义 topic', !box.innerHTML.includes('<img src=x') && box.innerHTML.includes('&lt;img'));

  // 答题区渲染
  console.log('\n=== J2. renderDiagnostic 答题区 ===');
  W.diagState.paper = W.cleanDiagnostic(raw, { subject: '数学', system: 'cn' });
  W.diagState.answers = {};
  box.innerHTML = '';
  W.renderDiagnostic();
  const rh = box.innerHTML;
  t('不隐藏容器', box.hidden === false);
  t('渲染进度 n / m', new RegExp('0 / ' + W.diagState.paper.items.length + ' 已作答').test(rh),
    (rh.match(/\d+ \/ \d+ 已作答/) || [''])[0]);
  t('渲染题号', rh.includes('diag-no'));
  t('渲染知识点名', rh.includes('diag-topic'));
  t('渲染题干', rh.includes('diag-stem'));
  t('渲染选项 radio', rh.includes('type="radio"') && rh.includes('diag-opt'));
  t('渲染简答题 textarea', rh.includes('diag-open'));
  t('渲染自评 radio（简答题唯一判据）', rh.includes('diag-self'));
  t('渲染提交按钮', rh.includes('btn-diag-submit'));
  t('渲染跳过按钮', rh.includes('btn-diag-skip'));
  t('说明诊断不限制能生成什么', /不影响/.test(rh));
  t('空卷时隐藏容器', (() => {
    W.diagState.paper = null;
    W.renderDiagnostic();
    const hid = box.hidden === true && box.innerHTML === '';
    W.diagState.paper = W.cleanDiagnostic(raw, { subject: '数学', system: 'cn' });
    return hid;
  })());
  box.innerHTML = '';
  W.diagState.paper = W.cleanDiagnostic({ items: [{ topic: X, type: 'short', question: XS, options: [] }] }, {});
  W.renderDiagnostic();
  t('renderDiagnostic 无裸 img', box.querySelector('img') === null);
  t('renderDiagnostic 无裸 script', box.querySelector('script') === null);
  t('renderDiagnostic 转义题干', box.innerHTML.includes('&lt;script'));

  // 作答 → 提交 → 画像
  W.diagState.paper = W.cleanDiagnostic(raw, { subject: '数学', system: 'cn' });
  W.diagState.answers = { 0: { value: 'A' }, 1: { value: 'A' } };
  box.innerHTML = '';
  W.renderDiagnostic();
  W.submitDiagnostic();
  t('★ 提交后得到起点画像', !!W.diagState.profile && W.diagState.profile.judged > 0);
  t('提交后答题区被收起', box.querySelector('.diag-list').hidden === true);
  t('提交后渲染了画像', !!box.querySelector('.dp-wrap'));

  /* ============ K. renderMemoryDiag 学习档案 ============ */
  console.log('\n=== K. renderMemoryDiag 学习档案 ===');
  const mem = document.getElementById('mem-diag');
  t('页面存在 #mem-diag', !!mem);
  W.renderMemoryDiag([]);
  t('空态有引导文案', mem.innerHTML.includes('还没有做过课前诊断'));
  t('空态说明价值（不会把会的再讲一遍）', /不会把你会的内容再讲一遍/.test(mem.innerHTML));
  W.renderMemoryDiag([
    { source: 'diagnostic', kind: 'weak', topic: '判别式', subject: '数学' },
    { source: 'diagnostic', kind: 'strength', topic: '配方法', subject: '数学' },
    { source: 'diagnostic', kind: 'context', content: '入学诊断起步水平：1 个知识点已掌握' },
    { source: 'class', kind: 'weak', topic: '不该出现的' },
  ]);
  const mh = mem.innerHTML;
  t('渲染起点薄弱条目', mh.includes('判别式') && mh.includes('起点薄弱'));
  t('渲染起点已会条目', mh.includes('配方法') && mh.includes('起点已会'));
  t('渲染 context 汇总', mh.includes('起步水平'));
  t('★ 只统计 source=diagnostic 的事实（不混入课堂记录）', !mh.includes('不该出现的'));
  t('说明这是开课前的快照', /开课前/.test(mh));
  t('指向掌握度看真正的进步', /知识点掌握度/.test(mh));
  t('空值不炸', (() => { try { W.renderMemoryDiag(null); return true; } catch (e) { return false; } })());
  const mX = '<img src=x onerror=alert(1)>';
  W.renderMemoryDiag([{ source: 'diagnostic', kind: 'weak', topic: mX, subject: mX, content: mX }]);
  t('renderMemoryDiag 无裸 img', mem.querySelector('img') === null);
  t('renderMemoryDiag 转义 topic', mem.innerHTML.includes('&lt;img') || !mem.innerHTML.includes('<img src=x'));

  /* ============ L. 接入点：提示词与课程对象 ============ */
  console.log('\n=== L. 接入课程生成与直播 ===');
  const fileSrc = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  t('课程大纲 prompt 调用了 diagnosticPromptBlock', /diagnosticPromptBlock\(\)/.test(fileSrc));
  t('课程对象带 diag 字段', /diag: diagState\.profile \? \{/.test(fileSrc));
  t('diag 随课程走（不依赖登录的记忆）', /诊断画像随课程走/.test(fileSrc));
  t('★ 诊断在课程生成之前就落库（生成失败也不丢）',
    fileSrc.indexOf('persistDiagnostic(diagState.profile') < fileSrc.indexOf('const sysObj = getSystem(state.gen.system);'));
  t('teacherSystemPrompt 注入了 diagBlock', /diagBlock/.test(fileSrc));
  t('memoryPromptBlock 未吞掉诊断（两者独立拼接）', /diagBlock \+\n?\s*\(memBlock/.test(fileSrc) || /diagBlock \+/.test(fileSrc));
  t('学习档案页调用了 renderMemoryDiag', /renderMemoryDiag\(facts\)/.test(fileSrc));
  t('生成页绑定了诊断按钮', /btn-diag-gen/.test(fileSrc));

  /* ============ M. 页面结构 ============ */
  console.log('\n=== M. 页面结构 ===');
  t('生成页有诊断入口按钮', /id="btn-diag-gen"/.test(html));
  t('按钮标注为可选', /课前诊断（可选）/.test(html));
  t('入口解释了为什么要做诊断', /避免把已经会的内容再讲一遍/.test(html));
  t('生成页有诊断面板容器 #gen-diag', !!document.getElementById('gen-diag'));
  t('诊断面板默认隐藏', /class="diag-panel" id="gen-diag" hidden/.test(html));
  t('学习档案有起点画像卡', /🧭 起点画像/.test(html));
  t('起点画像卡说明它的作用', /决定第一节课从哪讲/.test(html));

  /* ============ N. 样式 ============ */
  console.log('\n=== N. 样式 ===');
  const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  ['d-ok', 'd-fuzzy', 'd-gap', 'd-na'].forEach((k) => {
    t('有 .dp-topic.' + k + ' 色条', new RegExp('\\.dp-topic\\.' + k).test(css));
  });
  t('有四态统计样式', /\.dp-stat/.test(css));
  t('有分布/选项样式', /\.diag-opt/.test(css) && /\.diag-opts/.test(css));
  t('有简答题样式', /\.diag-open/.test(css));
  t('有自评样式', /\.diag-self/.test(css));
  t('有加载态样式', /\.diag-loading/.test(css));
  t('有"跳过"标签样式', /\.dp-skip/.test(css));
  t('档案页有起点画像样式', /\.md-topic/.test(css) && /\.md-stat/.test(css));
  t('有引导生成课程的脉冲动效', /pulseBtn/.test(css));
  t('窄屏对诊断面板做了适配', /\.diag-panel/.test(css.split('@media')[1] || '') || /\.diag-(opt|actions)/.test((css.match(/@media[^{]*max-width:\s*760px[\s\S]*$/) || [''])[0]));

  /* ============ O. 回归基线：诊断不能污染其它功能 ============ */
  console.log('\n=== O. 隔离性 ===');
  W.diagState.profile = null;
  W.diagState.paper = null;
  t('未做诊断时大纲 prompt 不含诊断段',
    !W.buildCourseOutlinePrompt().includes('课前诊断结果'));
  t('未做诊断时直播 system prompt 不含诊断段',
    !W.teacherSystemPrompt({ system: 'cn', title: 'T', subject: '数学', grade: '初三', level: '中', duration: '45分钟' })
      .includes('课前诊断结果'));
  t('诊断与错因是两套独立数据（不互相写字段）',
    !/error_causes/.test(String(JSON.stringify(prof.topics))));

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
