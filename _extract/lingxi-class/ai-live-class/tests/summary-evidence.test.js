/* R17（Web 端）· 课堂小结的「已掌握」必须有作答证据
   ============================================================
   报告原文：
     · 小结要求模型输出 mastered/weakPoints/homework，却没有任何依据约束；
       一节"学生全程没说话"的课，模型照样能列出 3 条"已掌握"；
     · 课中采集到的错因（live.causeSummary）已经算好、也上报了 track，
       却**从未进过小结提示词** —— 证据采了不用。

   本文件测的是"这件事有没有真的发生"，不是"我写下了这句话"：
   · H 组：直接驱动 guardSummaryEvidence（确定性守卫的边界）
   · I 组：**端到端**跑一节真实课堂 → 点下课 → 抓真实发出的小结提示词
            → 读真实 DOM。包含"学生没说话"与"学生说过话"两条反向对照，
            否则一个"永远清空 mastered"的 bug 也能全绿。
   ============================================================ */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const SITE = 'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host/';

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (typeof cond !== 'boolean') {
    fail++; console.log('FAIL ' + label + '   ←  断言写法错误：条件必须是 boolean，实际收到 ' + typeof cond);
    return;
  }
  if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); }
};

/* 小结 JSON：刻意让模型"不守纪律"—— 学生没答任何题，它照样写了 3 条已掌握。
   守卫必须把它清掉；有作答的那一节则必须原样保留（反向对照）。 */
const SUMMARY_JSON = JSON.stringify({
  mastered: ['一句话概括段落大意', '定位词的选择', '同义替换的识别'],
  weakPoints: ['长对话里的转折信号'],
  homework: ['做 3 道定位题'],
  cards: [{ q: '定位词怎么选？', a: '选不易被替换的专有名词。' }],
  reviewPlan: ['今晚：复习定位词'],
  memoryFacts: [],
  errorCauses: [],
  comment: '继续加油',
});

/* 云服务桩：捕获每一次请求的 messages；小结请求返回上面那份 JSON。 */
function makeCloud(captured) {
  const noopChain = () => ({
    select() { return this; }, limit() { return this; }, order() { return this; },
    eq() { return this; }, maybeSingle() { return this; }, update() { return this; },
    insert() { return this; }, upsert() { return this; }, delete() { return this; },
    then: (r) => Promise.resolve({ data: [], error: null }).then(r),
    catch: (r) => Promise.resolve({ data: [], error: null }).catch(r),
  });
  return {
    llm: {
      models: { list: async () => [{ id: 'm1', name: 'M1', disabled: false }] },
      chat: { completions: {
        /* ★ 必须是「同步函数、直接返回 async generator 实例」——
           写成 async 函数返回 { [Symbol.asyncIterator](){} } 时，
           jsdom realm 下的 for await 会抛 "not async iterable"，测试结果失真。 */
        create: function (body) {
          const msgs = (body && body.messages) || [];
          const sys = String((msgs[0] && msgs[0].content) || '');
          captured.push({ system: sys, messages: msgs });
          const isSummary = sys.indexOf('"mastered"') >= 0;
          const text = isSummary ? SUMMARY_JSON : '好，我们从第一页开始。';
          return (async function* () {
            for (let i = 0; i < text.length; i += 60) {
              yield { choices: [{ delta: { content: text.slice(i, i + 60) } }] };
            }
          })();
        },
      } },
    },
    auth: {
      getSession: async () => ({ data: null, error: null }),
      getUser: async () => ({ data: null, error: { kind: 'unauthenticated' } }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => () => {},
    },
    database: { from: noopChain, rpc: async () => ({ data: null, error: null }) },
  };
}

function makeCourse() {
  return {
    id: 'se1', title: '证据课', subject: '英语', grade: '高二', level: '提高', duration: '45 分钟',
    system: 'cn', systemName: '国内课程', systemIco: 'CN', createdAt: Date.now(), progress: 0,
    boards: [], boardNames: [],
    outline: {
      title: '证据课', knowledgePoints: ['定位词'],
      stages: [{ name: '导入', duration: '5', content: 'c' }], homework: ['h'],
      slides: [
        { type: 'cover', title: '证据课', subtitle: 's' },
        { type: 'content', title: '定位词', bullets: ['专有名词', '数字'], note: 'n' },
        { type: 'quiz', title: '练习', question: '哪类词适合做定位词？', options: ['介词', '专有名词'], answer: 'B', analysis: 'an', note: 'qn' },
        { type: 'summary', title: '小结', bullets: ['x'], note: '' },
      ],
    },
  };
}

/* 开一个真实页面实例：注入 app.js，配好登录态（未登录不允许上课）
   ⚠ 注入方式必须用 **runScripts:'dangerously' + 插入 <script> 元素**：
   · runScripts:'outside-only' 下 jsdom 不执行动态 append 的 script，app.js 从未运行；
   · 改用 window.eval(appJs) 也不行 —— app.js 顶层的 `function enterLive(){}` 声明
     在 eval 作用域里不会挂到 window，于是"功能存在"却测不到（假失败）。
   只有作为真正的经典脚本执行，函数声明才会成为 window 的属性。 */
function freshApp(captured) {
  const dom = new JSDOM(html, { url: SITE, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true; w.alert = () => {};
  w.scrollTo = () => {};
  w.speechSynthesis = { getVoices: () => [{ name: 'Xiaoxiao', lang: 'zh-CN' }], speak() {}, cancel() {}, onvoiceschanged: null };
  w.SpeechSynthesisUtterance = function (txt) { this.text = txt; };
  w.WorkBuddyCloud = { createWorkBuddyCloud: () => makeCloud(captured) };
  const sc = w.document.createElement('script');
  sc.textContent = appJs;
  w.document.head.appendChild(sc);
  return w;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ⚠ 必须在 eval 之后**等一下**再写登录态：init() 可能排在 DOMContentLoaded 上，
   会话恢复会重写 state.user —— 先写就会被覆盖，"已登录"的前提就没了。 */
async function openApp(captured) {
  const w = freshApp(captured);
  await wait(30);
  w.state.user = { id: 'u-r17', email: 'r17@example.com', anonymous: false };
  w.state.memLoaded = false;
  return w;
}

/* ============================================================ */
(async () => {

  /* ---------------- H 组：确定性守卫的边界（直接驱动） ---------------- */
  console.log('=== H. guardSummaryEvidence 边界 ===');
  {
    const w = await openApp([]);
    const g = w.guardSummaryEvidence;
    t('H0 守卫已被导出（不是只写在源码里的死函数）', typeof g === 'function');

    const noAns = { mastered: ['a', 'b', 'c'], weakPoints: ['w'], cards: [{ q: '1' }], errorCauses: [], comment: 'x' };
    const r1 = g(noAns, { studentMessages: 0 });
    t('H1 零作答 → mastered 被清空', Array.isArray(r1.mastered) && r1.mastered.length === 0, JSON.stringify(r1.mastered));
    t('H2 标记 noAnswerEvidence=true（界面据此显示"待验证"）', r1.noAnswerEvidence === true);
    t('H3 记录被丢弃的条数（不是静默丢弃）', r1.droppedUnverified === 3, String(r1.droppedUnverified));
    t('H4 只清 mastered，不动 weakPoints', JSON.stringify(r1.weakPoints) === JSON.stringify(['w']));
    t('H5 只清 mastered，不动 cards / errorCauses / comment',
      r1.cards.length === 1 && r1.comment === 'x');
    t('H6 原地返回同一对象（调用方后续 track 读到的就是守卫后的值）', r1 === noAns);

    const withAns = { mastered: ['a', 'b'], weakPoints: [] };
    const r2 = g(withAns, { studentMessages: 2 });
    t('H7 有作答 → mastered 原样保留（反向对照：守卫不是"永远清空"）',
      r2.mastered.length === 2, JSON.stringify(r2.mastered));
    t('H8 有作答 → 不设置 noAnswerEvidence', r2.noAnswerEvidence === undefined);

    const empty = { mastered: [] };
    const r3 = g(empty, { studentMessages: 0 });
    t('H9 本来就空 → 标记待验证，但不写"丢弃条数"（没丢东西）',
      r3.noAnswerEvidence === true && r3.droppedUnverified === undefined,
      JSON.stringify(r3));

    const r4 = g({ mastered: ['a'] });          // 没传 ctx
    t('H10 ctx 缺失时按"零作答"保守处理（宁可少说）', r4.mastered.length === 0 && r4.noAnswerEvidence === true);
    const r5 = g({ mastered: ['a'] }, {});      // ctx 里没有 studentMessages
    t('H11 ctx 无 studentMessages 时同样保守处理', r5.mastered.length === 0);
    const r6 = g({ mastered: ['a'] }, { studentMessages: 1 });
    t('H12 有 1 次作答就不再清空（边界是 <=0）', r6.mastered.length === 1);

    t('H13 null 输入原样返回不崩', g(null, { studentMessages: 0 }) === null);
    t('H14 字符串输入原样返回不崩', g('x', { studentMessages: 0 }) === 'x');
    t('H15 数组输入原样返回不崩（不是对象语义）', typeof g([], { studentMessages: 0 }) === 'object');
  }

  /* ---------------- I 组：端到端 —— 学生全程没说话 ---------------- */
  console.log('\n=== I. 端到端：一节"学生没作答"的课 ===');
  {
    const captured = [];
    const w = await openApp(captured);
    await w.enterLive(makeCourse());
    await wait(400);                                   // 等开场白吐完
    t('I1 直播间已进入', w.document.getElementById('live-room').hidden === false);

    const endBtn = w.document.getElementById('btn-end');
    t('I2 找到下课按钮', !!endBtn);
    endBtn.click();                                    // 第一次：进入"再点一次确认"
    endBtn.click();                                    // 第二次：真的下课
    await wait(600);

    const sumReq = captured.filter((c) => c.system.indexOf('"mastered"') >= 0);
    t('I3 下课确实发出了一次小结请求', sumReq.length === 1, 'count=' + sumReq.length);

    const last = sumReq.length ? sumReq[sumReq.length - 1] : null;
    const userMsg = last ? String((last.messages[1] && last.messages[1].content) || '') : '';
    const sysMsg = last ? last.system : '';

    t('I4 ★ 小结提示词带上「作答证据」块（原来压根没有这块）',
      userMsg.indexOf('【本节课的作答证据') >= 0, userMsg.slice(0, 200));
    t('I5 ★ 证据里如实写明"作答/发言次数：0"',
      /学生作答\/发言次数：0/.test(userMsg), userMsg.slice(0, 400));
    t('I6 ★ 提示词明令：次数为 0 时 mastered 必须为空',
      userMsg.indexOf('mastered 必须为空') >= 0);
    t('I7 提示词含"0-3 条、有依据才写"的条数纪律',
      sysMsg.indexOf('各 0-3 条') >= 0 && sysMsg.indexOf('没有依据就给空数组') >= 0);
    t('I8 提示词含"未作答不算已掌握"的显式纪律',
      sysMsg.indexOf('还没有作答证据') >= 0 && sysMsg.indexOf('掌握情况待验证') >= 0);
    t('I9 ★ 课中错因概览也进了提示词（原来采了不用）',
      userMsg.indexOf('课中诊断出的错因') >= 0);

    const body = w.document.getElementById('summary-body').innerHTML;
    t('I10 ★★ 模型给出的 3 条"已掌握"没有出现在小结里（守卫生效）',
      body.indexOf('一句话概括段落大意') < 0 && body.indexOf('定位词的选择') < 0,
      body.slice(0, 200));
    t('I11 ★★ 小结如实显示"没有作答记录，掌握情况待验证"',
      body.indexOf('本节课没有作答记录，掌握情况待验证') >= 0);
    t('I12 待巩固/作业建议仍在（只压了 mastered，不是整篇作废）',
      body.indexOf('待巩固') >= 0 && body.indexOf('长对话里的转折信号') >= 0 &&
      body.indexOf('做 3 道定位题') >= 0);
  }

  /* ---------------- J 组：端到端 —— 学生答过题（反向对照） ---------------- */
  console.log('\n=== J. 端到端：一节"学生有作答"的课 ===');
  {
    const captured = [];
    const w = await openApp(captured);
    await w.enterLive(makeCourse());
    await wait(400);
    w.sendLive('老师，我觉得定位词应该选介词。');      // 学生真的说话了
    await wait(400);

    const endBtn = w.document.getElementById('btn-end');
    endBtn.click();
    endBtn.click();
    await wait(600);

    const sumReq = captured.filter((c) => c.system.indexOf('"mastered"') >= 0);
    const last = sumReq.length ? sumReq[sumReq.length - 1] : null;
    const userMsg = last ? String((last.messages[1] && last.messages[1].content) || '') : '';
    t('J1 证据里的次数 ≥ 1（学生发言被数到）',
      /学生作答\/发言次数：[1-9]/.test(userMsg), userMsg.slice(0, 400));

    const body = w.document.getElementById('summary-body').innerHTML;
    t('J2 ★★ 有作答时 mastered 原样保留（守卫没有误伤）',
      body.indexOf('一句话概括段落大意') >= 0 && body.indexOf('定位词的选择') >= 0,
      body.slice(0, 300));
    t('J3 ★★ 有作答时不显示"待验证"',
      body.indexOf('掌握情况待验证') < 0, body.slice(0, 300));
  }

  console.log('\n_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL 测试自身异常: ' + ((e && e.stack) || e));
  console.log('\n_RESULT pass=' + pass + ' fail=' + (fail + 1));
  process.exit(1);
});
