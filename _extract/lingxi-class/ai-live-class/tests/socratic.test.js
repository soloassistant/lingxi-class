/* 单测：苏格拉底式教学引擎 + 引导强度 + 课后闪卡
 *
 * 覆盖 2025 年 AI 辅导教学法研究提炼出的可落地改进点：
 *   - 苏格拉底四阶段（引出/追问/矛盾或延伸/综合）写入 system prompt
 *   - 反答案倾倒：最小帮助原则、两次失败才给示范解答
 *   - 元认知提问脚手架（可开关）
 *   - 可调支持等级（更多引导 / 均衡 / 更多自主）动态注入
 *   - 成长型思维措辞红线
 *   - 课后闪卡（主动回忆）+ 间隔复习计划渲染
 *
 * 运行（Windows）：
 *   $env:NODE_PATH="C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules"
 *   & "C:\...\node.exe" tests\socratic.test.js
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

const course = {
  id: 'c1', title: '一元二次方程', subject: '数学', grade: '高一', level: '基础巩固',
  duration: '45 分钟', system: 'cn', createdAt: Date.now(), boards: [], boardNames: [],
  outline: { title: '一元二次方程', knowledgePoints: ['求根公式', '判别式'],
    stages: [{ name: '导入', duration: '5 分钟', content: '热身' }] },
};

console.log('=== A. 苏格拉底四阶段写入 prompt ===');
window.state.guide = 'balanced';
window.state.meta = true;
let sys = window.teacherSystemPrompt(course);
t('含「苏格拉底式提问」小节', sys.includes('苏格拉底式提问'));
t('阶段 a 引出', sys.includes('引出'));
t('阶段 b 追问', sys.includes('追问'));
t('阶段 c 矛盾或延伸', sys.includes('矛盾或延伸'));
t('阶段 d 综合', sys.includes('综合'));
t('明确禁止答案倾倒', sys.includes('答案倾倒'));
t('最小帮助原则', sys.includes('最小帮助原则'));
t('两次失败才给示范', sys.includes('连续两次尝试都失败'));
t('示范后要求复现同类题', sys.includes('同类题'));
t('学生先复述思路再讲解', sys.includes('用自己的话说一遍'));

console.log('\n=== B. 元认知脚手架（可开关） ===');
t('开启时含元认知小节', sys.includes('元认知'));
t('含"卡在哪一步"', sys.includes('卡在哪一步'));
t('含"讲给别人听"', sys.includes('讲给'));
window.state.meta = false;
const sysNoMeta = window.teacherSystemPrompt(course);
t('关闭后不含元认知小节', !sysNoMeta.includes('元认知脚手架'));
window.state.meta = true;

console.log('\n=== C. 成长型思维措辞 ===');
t('表扬指向方法而非聪明', sys.includes('不要只说') && sys.includes('聪明'));
t('错误归因为策略', sys.includes('策略还没找到'));

console.log('\n=== D. 引导强度三档动态注入 ===');
['more', 'balanced', 'less'].forEach((lv) => {
  window.state.guide = lv;
  const s = window.teacherSystemPrompt(course);
  const name = window.GUIDE_PROFILES[lv].name;
  t('档位 ' + lv + ' 注入「' + name + '」', s.includes('引导强度') && s.includes(name));
});
window.state.guide = 'less';
let sLess = window.teacherSystemPrompt(course);
t('更多自主：要求不要抢先提示', sLess.includes('不要抢先提示'));
window.state.guide = 'more';
let sMore = window.teacherSystemPrompt(course);
t('更多引导：要求拆小步子', sMore.includes('小步子'));
window.state.guide = 'balanced';

console.log('\n=== E. 未知档位回退到均衡 ===');
window.state.guide = 'nonsense';
t('guideProfile 回退 balanced', window.guideProfile().name === '均衡');
window.state.guide = 'balanced';

console.log('\n=== F. 练习页规则：不给选项字母 ===');
const withQuiz = Object.assign({}, course, {
  slides: [
    { type: 'cover', title: '封面', subtitle: '' },
    { type: 'quiz', title: '随堂练习', question: 'Q?', options: ['A. 1', 'B. 2'], answer: 'A', analysis: '因为...' },
  ],
});
const sq = window.teacherSystemPrompt(withQuiz);
t('含练习页处理小节', sq.includes('练习页处理'));
t('要求先让学生自己作答', sq.includes('自己思考并作答'));
t('禁止说出选项字母', sq.includes('不说出字母'));

console.log('\n=== G. 国际课程仍保留考纲规则 ===');
const intl = Object.assign({}, course, { system: 'intl', systemName: '国际课程', boards: ['ib'], boardNames: ['IB'] });
const si = window.teacherSystemPrompt(intl);
t('含英文术语要求', si.includes('英文原名'));
t('含 mark scheme', si.includes('mark scheme'));

console.log('\n=== H. setGuide 切换 + 持久化 + 按钮刷新 ===');
window.localStorage.clear();
window.state.guide = 'balanced';
window.renderGuideBtn();
const gbtn = document.getElementById('tb-guide');
t('按钮初始标签为均衡', gbtn.querySelector('.mt-label').textContent === '均衡');
window.setGuide('more');
t('state.guide 更新', window.state.guide === 'more');
t('按钮标签更新', gbtn.querySelector('.mt-label').textContent === '更多引导' || gbtn.querySelector('.mt-label').textContent === '更多引导');
t('写入 localStorage', window.localStorage.getItem('lingxi_guide') === 'more');
t('按钮进入 active 态', gbtn.classList.contains('active'));
window.setGuide('balanced');
t('回均衡后 active 移除', !gbtn.classList.contains('active'));

console.log('\n=== I. restoreGuidePref 恢复偏好 ===');
window.localStorage.setItem('lingxi_guide', 'less');
window.localStorage.setItem('lingxi_meta', '0');
window.state.guide = 'balanced';
window.state.meta = true;
window.restoreGuidePref();
t('恢复 guide=less', window.state.guide === 'less');
t('恢复 meta=false', window.state.meta === false);
t('按钮同步为更多自主', gbtn.querySelector('.mt-label').textContent === '更多自主');
window.state.guide = 'balanced';
window.state.meta = true;
window.renderGuideBtn();

console.log('\n=== J. toggleMeta 开关 ===');
window.state.meta = false;
window.toggleMeta();
t('toggleMeta 打开', window.state.meta === true);
t('meta 写入 localStorage', window.localStorage.getItem('lingxi_meta') === '1');
const sw = document.getElementById('guide-meta');
if (sw) { window.toggleMeta(false); t('关闭时 switch 类移除', !sw.classList.contains('on')); window.state.meta = true; }

console.log('\n=== K. 引导弹窗渲染 ===');
window.openGuideModal();
const gm = document.getElementById('guide-modal');
t('弹窗打开', gm && !gm.hidden);
const opts = document.querySelectorAll('#guide-options .guide-opt');
t('渲染 3 个档位', opts.length === 3, String(opts.length));
t('含 more/balanced/less', /data-guide="more"/.test(gm.innerHTML) && /data-guide="balanced"/.test(gm.innerHTML) && /data-guide="less"/.test(gm.innerHTML));
t('当前档位有 cur 标记', document.querySelectorAll('#guide-options .guide-opt.cur').length === 1);
t('当前档位显示勾', document.querySelector('#guide-options .guide-opt.cur .go-check').textContent === '✓');
window.closeGuideModal();
t('弹窗关闭', gm.hidden);

console.log('\n=== L. 课后闪卡渲染（主动回忆） ===');
window.state.guide = 'balanced';
const sum = {
  mastered: ['能识别一元二次方程的标准形式'],
  weakPoints: ['判别式符号对应的根的情况还不熟'],
  homework: ['完成 10 道判别式判断练习'],
  cards: [
    { q: '判别式 Δ>0 时方程有几个实根？', a: '两个不相等的实根。' },
    { q: '求根公式是什么？', a: 'x = (-b ± √(b²-4ac)) / 2a' },
    { q: 'Δ=0 代表什么？', a: '两个相等的实根。' },
  ],
  reviewPlan: ['今晚：把 3 张闪卡自测一遍', '明天：重做错题', '三天后：做一组同类题', '一周后：限时小测'],
  comment: '你这节课能把判别式和图像联系起来，思路很稳。',
};
window.renderSummary(sum, null, null, { id: 'c1' });
const body = document.getElementById('summary-body');
t('渲染闪卡区块', /sum-cards/.test(body.innerHTML));
t('闪卡数量为 3', (body.innerHTML.match(/class="flash-card"/g) || []).length === 3);
t('闪卡用 details 折叠（先回忆再看）', /<details class="flash-card">/.test(body.innerHTML));
t('闪卡问题渲染', body.innerHTML.includes('判别式 Δ&gt;0') || body.innerHTML.includes('判别式 Δ>0'));
t('闪卡答案渲染', body.innerHTML.includes('求根公式') || body.innerHTML.includes('-b ±'));
t('含"先在心里作答"提示', body.innerHTML.includes('先在心里作答'));
t('渲染间隔复习计划', /review-plan/.test(body.innerHTML));
t('复习计划 4 条', (body.innerHTML.match(/<li>今晚|review-plan[\s\S]*?<\/ol>/)[0].match(/<li>/g) || []).length === 4,
  body.innerHTML.slice(0, 0) + 'see html');
t('保留已掌握/待巩固/作业', body.innerHTML.includes('已掌握') && body.innerHTML.includes('待巩固') && body.innerHTML.includes('作业建议'));
t('成长型思维总评渲染', body.innerHTML.includes('思路很稳'));

console.log('\n=== M. 闪卡缺失时不炸 ===');
window.renderSummary({ mastered: ['a'], weakPoints: [], homework: [], comment: 'ok' }, null, null, null);
t('无 cards 时不渲染闪卡区', !/sum-cards/.test(document.getElementById('summary-body').innerHTML));
t('无 reviewPlan 时不渲染计划区', !/review-plan/.test(document.getElementById('summary-body').innerHTML));

console.log('\n=== N. 小结请求 prompt 要求闪卡与间隔重复 ===');
// 通过抓取 fetch/streamChat 的 system 内容间接验证：这里检查 LLM 桩是否收到 cards 要求
let capturedSys = '';
const origStream = window.streamChat;
window.streamChat = async (params) => {
  if (params && params.messages && params.messages[0] && params.messages[0].role === 'system') {
    const c = params.messages[0].content;
    if (c.includes('教学顾问')) capturedSys = c;
  }
  return JSON.stringify({ mastered: [], weakPoints: [], homework: [], cards: [], reviewPlan: [], comment: '' });
};
(async () => {
  window.state.live = {
    course, conversationId: 'x', messages: [{ role: 'user', content: 'hi', hidden: false }],
    busy: false, seconds: 90, stageIndex: 0, recording: [], recStart: Date.now(), ended: false,
  };
  try { await window.endLive(); } catch (e) { /* 环境差异忽略 */ }
  t('小结 prompt 要求 cards', capturedSys.includes('cards'));
  t('小结 prompt 要求 reviewPlan', capturedSys.includes('reviewPlan'));
  t('小结 prompt 提及遗忘曲线', capturedSys.includes('遗忘曲线'));
  t('小结 prompt 要求闪卡可脱离上下文', capturedSys.includes('脱离上下文'));
  t('小结 prompt 提及成长型思维', capturedSys.includes('成长型思维'));
  window.streamChat = origStream;

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
