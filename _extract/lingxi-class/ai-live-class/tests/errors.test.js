/* 单测：错因分析（四维归类）+ 错因画像聚合 + 知识漏洞/计算失误的诊断纪律
 *
 * 为什么单独测：错因判断是"把只判对错升级成分析为什么错"的关键一步，
 * 其中最容易出错、后果最严重的是**把"会但算错"误判成"不会"** ——
 * 那会让学生被反复重讲已经掌握的知识，是伤害学习信心最常见的误诊。
 * 所以这里除了功能断言，还专门锁住"计算失误/审题偏差不能被归成知识漏洞"这条纪律。
 *
 * 运行（Windows）：
 *   $env:NODE_PATH="C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules"
 *   & "C:\...\node.exe" tests\errors.test.js
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
    auth: { getSession: async () => ({ data: null, error: null }), onAuthStateChange: () => () => {}, signOut: async () => ({}) },
    database: { from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }) },
  }),
};

const sc = document.createElement('script');
sc.textContent = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
document.head.appendChild(sc);
const W = window;

(async () => {
  await new Promise((r) => setTimeout(r, 300));

  /* ============ A. 四维错因的定义完整性 ============ */
  console.log('=== A. 四维错因（ERROR_CAUSES）定义 ===');
  const K = W.ERROR_CAUSE_KEYS;
  t('恰好四类（知识/混淆/计算/审题）', K.length === 4, JSON.stringify(K));
  t('含 knowledge', K.includes('knowledge'));
  t('含 concept', K.includes('concept'));
  t('含 careless', K.includes('careless'));
  t('含 reading', K.includes('reading'));
  K.forEach((k) => {
    const c = W.ERROR_CAUSES[k];
    t(k + ' 有中文标签', !!c && !!c.label);
    t(k + ' 有配色类名', !!c && /^e-/.test(c.cls));
    t(k + ' 解释"这意味着什么"', !!c && c.meaning.length > 6);
    t(k + ' 给出补救动作', !!c && c.action.length > 6);
  });
  t('other 兜底存在但不进四维统计', !!W.ERROR_CAUSES.other && !K.includes('other'));
  t('计算失误的解释明确区分"会但没做对"',
    W.ERROR_CAUSES.careless.meaning.includes('思路') || W.ERROR_CAUSES.careless.action.includes('会但'));

  /* ============ B. 归一化：模型输出的容错 ============ */
  console.log('\n=== B. normErrorCause 容错 ===');
  t('英文枚举直通', W.normErrorCause('careless') === 'careless');
  t('大写/空格容错', W.normErrorCause('  READING ') === 'reading');
  t('中文同义词 → 计算失误', W.normErrorCause('粗心') === 'careless');
  t('中文同义词 → 计算失误（马虎）', W.normErrorCause('马虎') === 'careless');
  t('中文同义词 → 概念混淆', W.normErrorCause('弄混') === 'concept');
  t('中文同义词 → 审题偏差', W.normErrorCause('看错题') === 'reading');
  t('中文同义词 → 知识漏洞', W.normErrorCause('不会') === 'knowledge');
  t('无法识别 → other', W.normErrorCause('天气不错') === 'other');
  t('空值 → other', W.normErrorCause(null) === 'other');
  t('other 不会被当成四维成员', W.normErrorCause('other') === 'other');

  /* ============ C. cleanErrorCauses：清洗与上限 ============ */
  console.log('\n=== C. cleanErrorCauses 清洗 ===');
  const cleaned = W.cleanErrorCauses([
    { cause: 'careless', topic: '一元二次方程', detail: '移项时漏了负号', fix: '每一步代回验算' },
    { cause: 'careless', topic: '另一题', detail: '重复' },      // 同类只留第一条
    { cause: '天气不错' },                                        // 无效 → 丢弃
    { cause: 'reading', topic: '应用题', detail: '漏看"至少"' },
    null,
    { cause: 'knowledge', topic: '韦达定理' },
    { cause: 'concept', topic: '判别式' },
    { cause: 'reading', topic: '又一条' },                        // 超出四类上限
  ]);
  t('同类只保留第一条', cleaned.filter((x) => x.cause === 'careless').length === 1);
  t('同类保留的是首条内容', cleaned.find((x) => x.cause === 'careless').topic === '一元二次方程');
  t('无效 cause 被丢弃', !cleaned.some((x) => x.cause === 'other'));
  t('null 条目被跳过', cleaned.length === 4);
  t('最多四类', cleaned.length === W.ERROR_CAUSE_MAX);
  t('字符串形式也接受', W.cleanErrorCauses(['careless'])[0].cause === 'careless');
  t('非数组 → 空数组', W.cleanErrorCauses('nope').length === 0);
  t('undefined → 空数组', W.cleanErrorCauses(undefined).length === 0);
  const longDetail = W.cleanErrorCauses([{ cause: 'careless', detail: 'x'.repeat(500) }])[0];
  t('detail 被截断（不炸 schema）', longDetail.detail.length <= 240);
  t('detail 允许从 wrong/mistake 别名取', W.cleanErrorCauses([{ cause: 'reading', wrong: '看错了' }])[0].detail === '看错了');
  t('fix 允许从 suggestion 别名取', W.cleanErrorCauses([{ cause: 'reading', suggestion: '先划条件' }])[0].fix === '先划条件');

  /* ============ D. buildErrorProfile：跨课程聚合 ============ */
  console.log('\n=== D. buildErrorProfile 聚合 ===');
  const sessions = [
    { subject: '数学', error_causes: [{ cause: 'careless', topic: '一元二次方程' }] },
    { subject: '数学', error_causes: [{ cause: 'careless', topic: '一元二次方程' }, { cause: 'reading', topic: '应用题' }] },
    { subject: '数学', error_causes: [{ cause: 'knowledge', topic: '韦达定理' }] },
    { subject: '物理', error_causes: [{ cause: 'concept', topic: '受力分析' }] },
    { subject: '数学', error_causes: [] },
    { subject: '数学' },                                          // 无 error_causes 字段
  ];
  const ep = W.buildErrorProfile(sessions);
  t('总错因次数正确', ep.total === 5, String(ep.total));
  t('按 科目·知识点 分组', ep.list.some((g) => g.key === '数学 · 一元二次方程'));
  t('同名知识点跨课累积', ep.list.find((g) => g.key === '数学 · 一元二次方程').total === 2);
  t('次数计入 counts', ep.list.find((g) => g.key === '数学 · 一元二次方程').counts.careless === 2);
  t('无 subject 也能分组', W.buildErrorProfile([{ error_causes: [{ cause: 'careless', topic: 'X' }] }]).list[0].key === 'X');
  t('缺 topic 归为「未归类知识点」',
    W.buildErrorProfile([{ error_causes: [{ cause: 'careless' }] }]).list[0].topic === '未归类知识点');
  t('主导错因取次数最多者', ep.list.find((g) => g.key === '数学 · 一元二次方程').top === 'careless');
  t('并列时优先知识性错因', W.buildErrorProfile([
    { error_causes: [{ cause: 'careless', topic: 'T' }, { cause: 'concept', topic: 'T' }] },
  ]).list[0].top === 'concept');
  t('知识性错因排在前面（更该补）',
    ep.list[0].counts.knowledge + ep.list[0].counts.concept > 0);
  t('会/不会比例可算', ep.carelessish === 3, String(ep.carelessish));
  t('hasCareless 标记存在', ep.hasCareless === true);
  t('hasReading 标记存在', ep.hasReading === true);
  t('空数据不报错', W.buildErrorProfile([]).total === 0 && W.buildErrorProfile(null).list.length === 0);
  t('全是无效错因时 total=0', W.buildErrorProfile([{ error_causes: [{ cause: '瞎写' }] }]).total === 0);

  /* ============ E. renderCauses 渲染（含 XSS） ============ */
  console.log('\n=== E. renderCauses 渲染与转义 ===');
  const ch = W.renderCauses([
    { cause: 'careless', topic: '方程', detail: '漏负号', fix: '代回验算' },
    { cause: 'reading', topic: '应用题', detail: '漏看条件' },
  ]);
  t('渲染 cause-item', /cause-item/.test(ch));
  t('渲染徽章', /cause-badge/.test(ch));
  t('渲染知识点', ch.includes('方程'));
  t('渲染具体表现', ch.includes('漏负号'));
  t('渲染针对性建议', ch.includes('代回验算'));
  t('无 fix 时不渲染空的建议行',
    !/cause-fix">👉\s*<\/p>/.test(W.renderCauses([{ cause: 'careless', topic: 'T', fix: '' }])));
  t('缺 fix 时回落到该类通用建议（内容）',
    W.renderCauses([{ cause: 'reading', topic: 'T' }]).includes(W.ERROR_CAUSES.reading.action));
  t('空清单渲染空串', W.renderCauses([]) === '');
  t('无效清单渲染空串', W.renderCauses(null) === '');
  const xss = W.renderCauses([{ cause: 'careless', topic: '<img src=x onerror=alert(1)>', detail: '<script>alert(2)</script>' }]);
  t('topic 转义（XSS）', !xss.includes('<img src=x'));
  t('detail 转义（XSS）', !xss.includes('<script>'));
  t('XSS 内容仍可见为文本', xss.includes('&lt;img'));

  /* ============ F. 小结弹窗接入错因 ============ */
  console.log('\n=== F. renderSummary 接入错因 ===');
  const course = { id: 'c1', title: '一元二次方程' };
  W.renderSummary({
    mastered: ['配方法'], weakPoints: ['判别式'], homework: ['10 题'],
    errorCauses: [{ cause: 'careless', topic: '配方法', detail: '配方时符号写错', fix: '逐步检查符号' }],
    comment: '不错',
  }, null, null, course);
  const body = document.getElementById('summary-body').innerHTML;
  t('小结含「错因分析」区块', body.includes('错因分析'));
  t('小结含四维标签', body.includes('计算失误'));
  t('小结含具体表现', body.includes('符号写错'));
  t('小结含针对性建议', body.includes('逐步检查符号'));
  t('小结提示"为什么错"的重要性', body.includes('为什么错'));
  t('小结仍保留已掌握', body.includes('配方法'));
  W.renderSummary({ mastered: ['a'], weakPoints: ['b'], homework: ['c'], errorCauses: [] }, null, null, course);
  t('无错因时不渲染该区块', !document.getElementById('summary-body').innerHTML.includes('错因分析'));

  /* ============ F2. parseJSONLoose 容错（走查实战案例） ============ */
  console.log('\n=== F2. parseJSONLoose 解析容错 ===');
  // 真实案例：模型在字符串内部用了英文双引号，导致整份小结解析失败、弹窗里直接打出原始 JSON
  const dirty = '{"mastered":[],"weakPoints":["对"面积"这一核心概念还不能用自己的话说清楚","课堂注意力容易跳到无关内容"],'
    + '"cards":[{"q":"用自己的话说，什么叫面积？","a":"面积就是一个面有多大。"}],'
    + '"reviewPlan":["今晚：比一比课桌面和课本封面谁大"],"memoryFacts":[],"comment":"继续加油"}';
  const parsed = W.parseJSONLoose(dirty);
  t('★ 字符串内裸双引号仍能解析成功', !!parsed);
  t('★ 解析出的数组长度正确', parsed && parsed.weakPoints.length === 2);
  t('★ 裸引号内容被完整保留', parsed && parsed.weakPoints[0].includes('面积'));
  t('★ 嵌套对象同样可解析', parsed && parsed.cards[0].q.includes('什么叫面积'));

  // 字符串内裸换行
  const dirty2 = '{"comment":"第一行\n第二行"}';
  const p2 = W.parseJSONLoose(dirty2);
  t('★ 字符串内裸换行可修复', !!p2 && p2.comment.includes('第一行'));

  // 本来就合法的 JSON 不能被改坏
  const clean = '{"a":1,"b":["x","y"],"c":{"d":"e"}}';
  t('★ 合法 JSON 解析结果不变', JSON.stringify(W.parseJSONLoose(clean)) === clean);

  // 转义序列与中文引号不受影响
  const esc1 = '{"a":"他说\\"你好\\"","b":"「引号」"}';
  const p3 = W.parseJSONLoose(esc1);
  t('★ 已有转义序列不被二次转义', !!p3 && p3.a === '他说"你好"' && p3.b === '「引号」');

  // 彻底不是 JSON 时仍返回 null（上层走兜底提示）
  t('★ 非 JSON 文本返回 null', W.parseJSONLoose('老师今天讲得不错') === null);

  // 解析失败时不再把原始 JSON 直接铺给学生看
  W.renderSummary(null, dirty, null, course);
  const failHtml = document.getElementById('summary-body').innerHTML;
  t('★ 解析失败不展示原始 JSON', !failHtml.includes('"weakPoints"'));
  t('★ 解析失败给出可读提示', failHtml.includes('没能整理出来'));

  /* ============ G. 错因画像渲染（学习档案） ============ */
  console.log('\n=== G. renderErrorProfile ===');
  W.renderErrorProfile(sessions);
  const ph = document.getElementById('mem-causes').innerHTML;
  t('渲染分布条', ph.includes('ep-bar-fill'));
  t('渲染四维标签', ph.includes('知识漏洞') || ph.includes('计算失误'));
  t('渲染知识点条目', ph.includes('一元二次方程'));
  t('渲染"会/不会"结论', ph.includes('ep-verdict'));
  t('多数是算错时给验证算的建议', ph.includes('审题和验算') || ph.includes('会但没做对'));
  W.renderErrorProfile([]);
  t('空态有引导文案', document.getElementById('mem-causes').innerHTML.includes('还没有错因记录'));
  t('空态解释了四类是什么', document.getElementById('mem-causes').innerHTML.includes('知识漏洞'));

  const knowledgeHeavy = W.buildErrorProfile([
    { error_causes: [{ cause: 'knowledge', topic: 'A' }, { cause: 'concept', topic: 'B' }] },
  ]);
  W.renderErrorProfile([{ error_causes: [{ cause: 'knowledge', topic: 'A' }, { cause: 'concept', topic: 'B' }] }]);
  t('知识性错因占多数时给"夯实概念"建议',
    document.getElementById('mem-causes').innerHTML.includes('夯实'));
  t('知识性占多数的判定成立', knowledgeHeavy.carelessish === 0);

  /* ============ H. memoryPromptBlock：错因真的影响下一节课 ============ */
  console.log('\n=== H. 错因注入 system prompt ===');
  W.state.user = { id: 'u1', email: 'a@b.com' };
  W.state.mem = {
    profile: null,
    facts: [],
    sessions: [{ course_title: '一元二次方程', subject: '数学',
      error_causes: [{ cause: 'careless', topic: '配方法' }, { cause: 'reading', topic: '应用题' }] }],
  };
  const blk = W.memoryPromptBlock();
  t('prompt 含错因分析段落', blk.includes('以前出错的原因分析'));
  t('prompt 点明具体错因标签', blk.includes('计算失误'));
  t('prompt 带上补救动作', blk.includes('验算'));
  t('prompt 提醒别把算错当不会讲', blk.includes('思路对但算错') || blk.includes('不要重讲'));
  t('prompt 提醒审题问题', blk.includes('条件逐条复述') || blk.includes('读题漏条件'));
  W.state.mem = { profile: null, facts: [], sessions: [] };
  t('无错因时 prompt 不提错因', !W.memoryPromptBlock().includes('错因'));

  /* ============ I. teacherSystemPrompt：错因诊断纪律 ============ */
  console.log('\n=== I. teacherSystemPrompt 错因诊断指令 ===');
  const sys = W.teacherSystemPrompt({ system: 'cn', title: 'T', subject: '数学', grade: '高一', level: '中', duration: '45分钟' });
  t('含错因诊断规则', sys.includes('错因诊断'));
  t('四类错因都在指令里', sys.includes('概念') && sys.includes('算错') && sys.includes('看漏') || sys.includes('看错'));
  t('明确"不会"和"会但错"要区别处理', sys.includes('不会') && sys.includes('会但错'));
  t('要求算错时不要重讲知识点', sys.includes('不要重讲'));

  /* ============ J. 直播中的错因信号识别 ============ */
  console.log('\n=== J. noteCauseSignals 直播错因捕捉 ===');
  W.state.live = { recStart: Date.now(), recording: [], pendingCauses: [], slideIndex: 0, course: { slides: [{ title: '配方法' }] } };
  W.noteCauseSignals('你是不是把判别式和韦达定理记混了？');
  t('识别概念混淆', W.state.live.pendingCauses.includes('concept'));
  W.noteCauseSignals('你的方法完全没问题，只是这一步算错了');
  t('识别计算失误', W.state.live.pendingCauses.includes('careless'));
  W.noteCauseSignals('我们一起把题目再读一遍，看看有没有看漏条件');
  t('识别审题偏差', W.state.live.pendingCauses.includes('reading'));
  W.noteCauseSignals('这个定义你还没掌握，我们从最基础的地方重新捋一遍');
  t('识别知识漏洞', W.state.live.pendingCauses.includes('knowledge'));
  t('四类都累积到', W.state.live.pendingCauses.length === 4);
  W.noteCauseSignals('你是不是把它和韦达定理记混了？');
  t('同一条错因不重复累积', W.state.live.pendingCauses.filter((c) => c === 'concept').length === 1);
  W.noteCauseSignals('好的');
  t('过短文本不参与判定', W.state.live.pendingCauses.length === 4);

  // 翻页时落盘
  W.state.live.course = { slides: [{ title: '配方法' }, { title: '判别式' }] };
  W.state.live.slideIndex = 0;
  W.flushLiveCauses();
  const causeEv = W.state.live.recording.filter((e) => e.type === 'cause');
  t('翻页/收尾时落成 cause 事件', causeEv.length === 1);
  t('cause 事件带时间点', typeof causeEv[0].t === 'number');
  t('cause 事件带页码与页标题', causeEv[0].slide === 0 && causeEv[0].title === '配方法');
  t('cause 事件内容为四维数组', Array.isArray(causeEv[0].v) && causeEv[0].v.length === 4);
  t('落盘后清空待写队列', W.state.live.pendingCauses.length === 0);
  W.flushLiveCauses();
  t('空队列不产生空事件', W.state.live.recording.filter((e) => e.type === 'cause').length === 1);
  W.state.live = null;
  t('无直播时不报错', (() => { try { W.noteCauseSignals('算错了'); W.flushLiveCauses(); return true; } catch (e) { return false; } })());

  /* ============ K. 课后的持久化调用形状 ============ */
  console.log('\n=== K. persistMemoryAfterClass 写入错因 ===');
  const fileSrc = fs.readFileSync(path.join(dir, 'js', 'app.js'), 'utf8');
  t('saveSession 支持写 error_causes', /error_causes/.test(fileSrc));
  t('error_causes 列缺失时有降级重写', /error_causes 列缺失/.test(fileSrc));
  t('loadMemory 遇未建列时降级查询', /错误|error_causes/.test(fileSrc) && /const base =/.test(fileSrc));
  t('错因确定性回写为 misconception 事实', /错因类型：/.test(fileSrc));
  t('错因画像事实也写入', /错因画像：/.test(fileSrc));
  t('小结 prompt 要求输出 errorCauses', /"errorCauses"/.test(fileSrc));
  t('小结 prompt 强调不要把算错误判为不会', /把"会但算错"当成"不会"/.test(fileSrc));

  /* ============ L. HTML：档案页有错因卡 ============ */
  console.log('\n=== L. 页面结构 ===');
  t('学习档案有错因容器 #mem-causes', !!document.getElementById('mem-causes'));
  t('错因卡有标题', /🔍 错因分析/.test(html));
  t('错因卡说明了它的价值', html.includes('真不会') && html.includes('会但没做对'));

  /* ============ M. CSS：四色与对比度 ============ */
  console.log('\n=== M. 样式 ===');
  const css = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
  ['e-knowledge', 'e-concept', 'e-careless', 'e-reading'].forEach((k) => {
    t('有 .cause-badge.' + k + ' 配色', new RegExp('\\.cause-badge\\.' + k).test(css));
  });
  t('有左侧色条区分（cause-item）', /\.cause-item\.e-/.test(css));
  t('有分布条样式', /\.ep-bar-fill/.test(css));
  t('分布条四色齐全', /\.ep-bar-fill\.e-reading/.test(css));
  t('结论区用品牌色底', /\.ep-verdict/.test(css) && /primary-soft/.test(css));

  /* ============ N. 本轮新增/加固的 sink 转义回归 ============
     这些点是 tests/check-sinks.js 静态扫出来"疑似"、人工核对后确认安全的。
     与其把它白名单化，不如用真实恶意输入钉死行为——这样以后谁把它改回不安全，测试会立刻红。 */
  console.log('\n=== N. 新增 sink 的转义回归 ===');
  const X = '<img src=x onerror=alert(1)>';
  const XS = '<script>alert(1)</script>';

  // N1. setAIStatus：kind 只能落进固定枚举，text 必须转义
  // 注意：#ai-status 在 index.html 里已存在且是 querySelector 命中的第一个，别再 append 一个同 id 节点
  const statusEl = document.getElementById('ai-status');
  t('页面已有 #ai-status 状态条', !!statusEl);
  W.setAIStatus('bad"><img onerror=x>', X, false);
  t('setAIStatus 转义了 text', !/onerror=/.test(statusEl.innerHTML) || /&lt;img/.test(statusEl.innerHTML));
  t('setAIStatus 不把 text 当 HTML', statusEl.querySelector('img') === null);
  t('setAIStatus 过滤了非法 kind', /dot-off/.test(statusEl.innerHTML) && !/dot-bad/.test(statusEl.innerHTML));
  W.setAIStatus('ok', 'AI 已就绪', false);
  t('setAIStatus 合法 kind 仍生效', /dot-ok/.test(statusEl.innerHTML) && /AI 已就绪/.test(statusEl.textContent));
  t('setAIStatus 清掉上一次的非法 kind 残留', !/dot-bad/.test(statusEl.innerHTML));

  // N2. renderSummary：闪卡 / 名单里的用户与模型输入都要转义
  const sumEl = document.getElementById('summary-body');
  t('小结容器存在', !!sumEl);
  if (sumEl) {
    W.renderSummary({
      comment: X,
      mastered: [X],
      weakPoints: [XS],
      homework: [X],
      cards: [{ q: X, a: XS }],
      errorCauses: [{ cause: 'careless', topic: X, detail: X, fix: X }],
    }, null, null, { title: X, subject: X });
    const h = sumEl.innerHTML;
    t('renderSummary 无裸 img 注入', sumEl.querySelector('img') === null);
    t('renderSummary 无裸 script 注入', sumEl.querySelector('script') === null);
    t('renderSummary 转义了闪卡问题', !h.includes('onerror=alert') || h.includes('&lt;img'));
    t('renderSummary 错因 topic 已转义', !h.includes('<img src=x'));
  }

  // N3. buildErrorProfile：字符串条目（历史/手工数据）不能被静默丢弃
  const epStr = W.buildErrorProfile([
    { subject: '数学', error_causes: ['careless', { cause: 'knowledge', topic: '勾股定理' }] },
  ]);
  t('字符串形式的错因也被识别', epStr.total === 2);
  t('字符串 careless 计入会但没做对', epStr.carelessish >= 1);
  // 脏数据（counts 缺失）不应抛错
  let threw = false;
  try {
    W.buildErrorProfile([{ subject: '数学', error_causes: [{ cause: 'careless', topic: 'x' }] }]);
  } catch (e) { threw = true; }
  t('脏 error_causes 不抛异常', !threw);

  /* ============ O. check-sinks 静态闸门 ============ */
  console.log('\n=== O. sink 审查脚本纳入回归 ===');
  t('存在 check-sinks.js', fs.existsSync(path.join(dir, 'tests', 'check-sinks.js')));
  const ck = fs.readFileSync(path.join(dir, 'tests', 'check-sinks.js'), 'utf8');
  t('check-sinks 支持 --strict（可接 CI）', /--strict/.test(ck));
  t('check-sinks 有数字变量推导', /collectNumVars/.test(ck));

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
