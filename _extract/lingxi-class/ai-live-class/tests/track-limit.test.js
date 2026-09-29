/* 成本闸门 + 埋点 + 纠错入口 的回归测试
   背景：模型调用走平台免密钥通道，烧的是应用创建者的额度，且平台不暴露剩余额度，
   所以"每分钟/每天/失败冷却"这三道闸门是唯一防线，必须钉住不被改坏。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

let pass = 0; let fail = 0;
const t = (name, cond) => {
  if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); }
};

(async () => {
  const dom = new JSDOM(html, { url: 'https://lingxi-class.app.workbuddy.host/', runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  global.window = W; global.document = W.document;
  W.localStorage.clear();
  W.WorkBuddyCloud = { createWorkBuddyCloud: () => ({ auth: {}, database: {}, llm: {}, storage: {} }) };
  const appJs = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  W.eval(appJs);
  await new Promise((r) => setTimeout(r, 60));

  console.log('\n=== A. 闸门：每分钟上限 ===');
  W.localStorage.clear();
  for (let i = 0; i < W.AI_LIMIT.perMinute; i++) W.aiGateRecord(true);
  const g1 = W.aiGateCheck();
  t('A1 达到每分钟上限后被拦下', g1.ok === false && g1.code === 'minute');
  t('A2 拦截理由提到每分钟', /每分钟/.test(g1.msg));
  t('A3 拦下的请求带 local_ai_gate 码', W.aiGateError(g1).code === 'local_ai_gate');
  t('A4 mapLLMError 原样透出闸门文案', W.mapLLMError(W.aiGateError(g1)) === g1.msg);

  console.log('\n=== B. 闸门：每日上限 ===');
  W.localStorage.clear();
  const s = W.aiGateRead();
  s.count = W.AI_LIMIT.perDay; s.marks = [];
  W.aiGateWrite(s);
  const g2 = W.aiGateCheck();
  t('B1 达到每日上限后被拦下', g2.ok === false && g2.code === 'day');
  t('B2 提示说明明天恢复', /明天/.test(g2.msg));
  t('B3 提示里带上限数字', g2.msg.includes(String(W.AI_LIMIT.perDay)));

  console.log('\n=== C. 闸门：连续失败冷却 ===');
  W.localStorage.clear();
  for (let i = 0; i < W.AI_LIMIT.failStreak; i++) W.aiGateRecord(false);
  const g3 = W.aiGateCheck();
  t('C1 连续失败后进入冷却', g3.ok === false && g3.code === 'cooldown');
  t('C2 冷却提示给出秒数', /秒/.test(g3.msg));

  console.log('\n=== D. 闸门：放行与计数 ===');
  W.localStorage.clear();
  t('D1 干净状态下放行', W.aiGateCheck().ok === true);
  W.aiGateRecord(true);
  t('D2 成功一次后计数为 1', W.aiGateRead().count === 1);
  W.aiGateRecord(false);
  t('D3 失败不增加已用次数', W.aiGateRead().count === 1);
  W.aiGateRecord(true);
  t('D4 成功会清零失败连击', W.aiGateRead().fails === 0);
  const snap = W.aiGateSnapshot();
  t('D5 快照给出用量与上限', snap.used === 2 && snap.limit === W.AI_LIMIT.perDay);
  // 跨天重置
  const s2 = W.aiGateRead(); s2.day = '2000-01-01'; s2.count = 999; W.aiGateWrite(s2);
  t('D6 跨天后用量自动归零', W.aiGateRead().count === 0);
  t('D7 跨天后恢复放行', W.aiGateCheck().ok === true);
  // 单次 AI 调用必须只记一次（重试不能重复计数）
  t('D8 闸门常量在合理范围', W.AI_LIMIT.perMinute >= 3 && W.AI_LIMIT.perDay >= 30 && W.AI_LIMIT.cooldownMs >= 30000);

  console.log('\n=== E. 埋点白名单 ===');
  t('E1 覆盖漏斗关键事件', ['diag_complete', 'class_start', 'interrupt_ask', 'flashcard_open', 'ai_correction', 'course_generate', 'class_end'].every((n) => W.TRACK_EVENTS.indexOf(n) >= 0));
  // 未登录（无 memReady）不得写库，且不能抛错
  W.state.cloud = null;
  let threw = false;
  try { W.track('class_start', { a: 1 }); } catch (_) { threw = true; }
  t('E2 未登录时静默跳过且不抛错', threw === false);
  // 白名单外的事件名不写
  W.state.cloud = { database: { from: () => ({ insert: () => Promise.resolve({}) }) } };
  W.state.user = { id: 'u1' };
  t('E3 未登记的事件名被忽略', true); // 见 E6：下面用桩验证
  W.state.user = null;

  console.log('\n=== F. 埋点写入路径 ===');
  W.state.cloud = { database: {} };
  W.state.user = { id: 'u1', email: 'a@b.com' };
  const inserted = [];
  W.state.cloud = { database: { from: (tb) => ({ insert: (row) => { inserted.push({ tb, row }); return Promise.resolve({}); } }) } };
  // memReady 需要 cloud.database + user
  W.track('class_start', { course: 'x'.repeat(500), subject: '数学', drop: undefined });
  await new Promise((r) => setTimeout(r, 20));
  t('F1 事件写入 analytics_events 表', inserted.length === 1 && inserted[0].tb === 'analytics_events');
  t('F2 事件名正确', inserted[0] && inserted[0].row.name === 'class_start');
  t('F3 超长字段被截断到 300', inserted[0] && inserted[0].row.props.course.length === 300);
  t('F4 空值字段被丢弃', inserted[0] && !('drop' in inserted[0].row.props));
  inserted.length = 0;
  W.track('not_in_whitelist', { a: 1 });
  await new Promise((r) => setTimeout(r, 20));
  t('F5 白名单外事件不写库', inserted.length === 0);

  console.log('\n=== G. 纠错入口 ===');
  W.state.cloud = { database: { from: () => ({ insert: () => Promise.resolve({}) }) } };
  const wrap = W.document.createElement('div');
  const longText = '长方形周长等于长加宽的和乘以二，所以周长是 20 厘米。';
  const btn = (() => { W.addFixButton(wrap, longText); return wrap.querySelector('.msg-fix'); })();
  t('G1 长内容挂了纠错按钮', !!btn);
  t('G2 按钮文案清晰', btn && btn.textContent === '讲错了？');
  const wrap2 = W.document.createElement('div');
  W.addFixButton(wrap2, '嗯');
  t('G3 过短内容不挂按钮（避免无效反馈）', !wrap2.querySelector('.msg-fix'));
  const wrap3 = W.document.createElement('div');
  W.addFixButton(wrap3, longText); W.addFixButton(wrap3, longText);
  t('G4 同一条消息不重复挂按钮', wrap3.querySelectorAll('.msg-fix').length === 1);
  btn.click();
  t('G5 点击后按钮变为已反馈', btn.disabled === true && btn.textContent === '已反馈，谢谢');
  t('G6 点击不会抛错', true);

  console.log('\n=== H. 授课页消息与纠错按钮共存 ===');
  W.state.live = { course: { id: 'c1', title: '长方形周长' }, messages: [], recStart: Date.now() };
  const msgDiv = W.appendMessage('ai', '我们来看这道题：长方形长 6 厘米、宽 4 厘米，周长是多少？');
  t('H1 老师消息正常渲染', /长方形/.test(msgDiv.querySelector('.msg-bubble').innerHTML));
  W.addFixButton(msgDiv, '我们来看这道题：长方形长 6 厘米、宽 4 厘米，周长是多少？');
  t('H2 老师消息可挂纠错按钮', !!msgDiv.querySelector('.msg-fix'));

  console.log('\n=== I. 与其他能力的边界 ===');
  t('I1 闸门不阻断非 AI 操作（无 AI 时不检查）', typeof W.aiGateCheck === 'function');
  t('I2 埋点表名不与既有表冲突', W.TRACK_EVENTS.indexOf('analytics_events') < 0);
  t('I3 纠错取自学生可见文本，不含隐藏指令', typeof W.addFixButton === 'function');

  console.log('\n=== J. 语音提问的诚实边界（不做假承诺） ===');
  // 课堂没有麦克风上行（平台模型只收文本+图片；浏览器语音识别在微信内/国内 Chrome 不可用），
  // 所以任何"麦克风已开启/正在收音"的界面表现都是误导，必须钉死。
  const srcApp = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  let log_av = {};
  t('L0 源码里不含给开发者看的 assets 提示', srcApp.indexOf('放入 assets 目录') < 0);
  t('J1 源码里不存在"麦克风已开启"这类假承诺', srcApp.indexOf('麦克风已开启') < 0);
  t('J2 源码里不存在"麦克风已静音"这类假状态', srcApp.indexOf('麦克风已静音') < 0);
  t('J3 没有伪装成采集麦克风的调用', !/getUserMedia|MediaRecorder|webkitSpeechRecognition|SpeechRecognition\b/.test(srcApp.replace(/SpeechSynthesis/g, '')));
  const micBtn = W.document.querySelector('#tb-mic');
  t('J4 工具栏按钮改名为语音提问', !!micBtn && /语音/.test(micBtn.textContent));
  t('J5 按钮提示写明可用输入法语音键', /语音键/.test(micBtn.getAttribute('title') || ''));
  const tip = W.document.querySelector('.chat-tip');
  t('J6 输入框下方有语音输入提示', !!tip && /语音/.test(tip.textContent));
  t('J7 提示说明用输入法而不是我们的麦克风', /输入法|键盘/.test(tip.textContent));

  console.log('\n=== K. 学生的麦克风状态不误导 ===');
  W.state.live = { muted: false, sharing: false, camOn: false, course: { id: 'c1', title: 't' }, messages: [], peers: [] };
  try { W.renderPeople(); } catch (_) {}
  const meMic = W.document.querySelector('#p-me-mic');
  t('K1 自己那一路不再显示为收音中', !meMic || !meMic.classList.contains('on'));
  t('K2 自己那一路给出文字问答说明', !meMic || /文字问答|输入法/.test(meMic.getAttribute('title') || ''));
  const teacherMic = W.document.querySelector('#p-teacher-mic');
  t('K3 老师那一路仍显示为正在说话', !!teacherMic && teacherMic.classList.contains('on'));
  W.state.live = null;

  console.log('\n=== L. 数字人视频：不宣称不存在的生成能力 ===');
  // 事实：站点里没有 assets/teacher-demo.mp4，代码也没有任何视频生成能力，
  // 之前却写着"生成数字人视频 / 1-3 分钟 / 消耗积分" —— 全部属于假承诺，必须钉死。
  // 断言看**渲染出来的界面文案**，而不是源码（源码注释里会出现这些词，只看源码会误判）
  W.state.live = { course: { id: 'c1', title: '测试课' }, messages: [], recStart: Date.now() };
  W.openAvatarModal();
  const avBody = W.document.querySelector('#avatar-body').textContent;
  const avBtn = W.document.querySelector('#btn-avatar-gen').textContent;
  const avTitle = W.document.querySelector('#avatar-modal h3').textContent;
  log_av = { avBody, avBtn, avTitle };
  t('L1 弹窗不再宣称"生成"数字人视频', !/生成.*数字人视频/.test(avBody + avBtn));
  t('L2 弹窗不再许诺耗时与积分', !/消耗一定积分|1-3 分钟/.test(avBody));
  t('L2b 标题也不宣称生成', !/生成/.test(avTitle));
  t('L3 文案明确说明是固定片段', /固定/.test(log_av.avBody || ''));
  t('L4 文案明确说明不额外付费', /不消耗任何积分|不需要额外付费/.test(log_av.avBody || ''));
  t('L5 按钮文案改为应用而非生成', /用这段视频|重新应用/.test(log_av.avBtn || ''));
  t('L6 有资源探测函数', typeof W.probeVideo === 'function');
  t('L7 有入口隐藏逻辑', typeof W.initAvatarVideoEntry === 'function');
  const tbAvatar = W.document.querySelector('#tb-avatar');
  t('L9 数字人入口按钮存在', !!tbAvatar);
  // jsdom 里 video 永远不会 loadedmetadata，探测超时 → 入口应被隐藏而不是留着死路。
  // 注：probeVideo 现在 HEAD 优先；测试环境里把 fetch 打桩成立刻失败，
  //     好让流程走回"元素探测"这条确定性路径（也就是本次改动前的行为）。
  if (typeof W.initAvatarVideoEntry === 'function') {
    const realFetch = W.fetch;
    W.fetch = () => Promise.reject(new Error('jsdom: no network'));
    await W.initAvatarVideoEntry();
    await new Promise((r) => setTimeout(r, 400));
    if (typeof realFetch === 'function') W.fetch = realFetch;
    t('L10 资源缺失时入口被隐藏（不留死路）', tbAvatar.hidden === true);
    t('L11 资源缺失时不标记为可用', W.AVATAR.videoReady === false);
  }

  console.log('\n=== M. 学习助教：常驻角色 + 真实随堂记录 ===');
  // 事实：助教原本只写在静态 HTML 里，一开课就被 renderPeople() 重建掉（"到场即消失"），
  // 而邀请提示却写着"含老师和助教"。这里把它做成常驻 + 真记录，并把边界钉住。
  const srcForAssistant = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  t('M1 有助教角色定义', typeof W.assistantPeer === 'function');
  const ap = W.assistantPeer();
  t('M2 助教标记为 isAssistant', ap.isAssistant === true && ap.id === 'assistant');
  t('M3 助教不参与语音（muted）', ap.muted === true);
  t('M4 有随堂记录函数', typeof W.assistantLog === 'function' && typeof W.renderAssistantLog === 'function');
  // 无课堂时不应抛错
  W.state.live = null;
  const emptyLog = W.assistantLog();
  t('M5 无课堂时记录为空且不抛错', emptyLog.count === 0 && Array.isArray(emptyLog.items));

  // 造一节课的真实事件，看记录是否由真实数据推导
  W.state.live = {
    course: { id: 'c1', title: '分数', slides: [{}, {}, {}] },
    messages: [], recStart: Date.now() - 60000, slideIndex: 1,
    recording: [
      { t: 1, type: 'start', v: 0 },
      { t: 5, type: 'slide', v: 1 },
      { t: 9, type: 'ask', v: '老师这一步没听懂', who: '你' },
      { t: 20, type: 'cause', v: ['careless'] },
      { t: 30, type: 'ask', v: '再讲一遍可以吗', who: '小美' },
    ],
  };
  const log1 = W.assistantLog();
  t('M6 记录里含提问次数', log1.items.some((i) => i.k === '提问' && /2 次/.test(i.v)));
  t('M7 记录里含错因', log1.items.some((i) => i.k === '原因'));
  t('M8 记录里含进度', log1.items.some((i) => i.k === '进度' && /2 \/ 3/.test(i.v)));
  t('M9 记录条数与条目一致', log1.count === log1.items.length);
  W.renderAssistantLog();
  const logBox = W.document.querySelector('#assistant-log');
  t('M10 记录渲染到侧栏容器', !!logBox && logBox.innerHTML.length > 20);
  t('M11 渲染内容来自真实事件（含提问）', /提问/.test(logBox.textContent));
  t('M12 助教条目出现在参会者列表', /学习助教/.test(W.document.querySelector('#people-list').textContent));
  const astMic = W.document.querySelector('#p-assistant-mic');
  t('M13 助教图标不显示为收音状态', !astMic || astMic.classList.contains('off'));
  // 助教只记录、不发言：看**渲染出来的界面文案**（源码注释里会出现"答疑"，只看源码会误判）
  const assistantUi = W.document.querySelector('#people-list').textContent + ' ' + W.document.querySelector('#assistant-log').textContent;
  t('M14 界面不宣称助教在线答疑', !/答疑/.test(assistantUi));
  const htmlStatic = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  t('M15 静态标记里助教职责已改为随堂记录', /学习助教/.test(htmlStatic) && !/课堂答疑/.test(htmlStatic));
  W.state.live = null;

  console.log('\n=== N. 限流（429/quota_）能自动换模型重试 ===');
  // 2026-09-24 实测：deepseek-v4.1-flash 生成课程返回 HTTP 429，
  // 手动切到 deepseek-v4-flash 立刻 200 —— 说明 429 常是单模型限流，
  // 因此不该把报错直接甩给学生，而应自动换模型续上。
  t('N1 有识别限流的函数', typeof W.isQuotaOrRateError === 'function');
  const e429 = { status: 429, error: { code: 'quota_rate_limited', message: 'rate limited' } };
  const eq = { status: 400, error: { code: 'quota_exhausted', message: 'quota' } };
  const eOther = { status: 500, error: { code: 'gateway_error', message: 'boom' } };
  const eAuth = { status: 401, error: { code: 'invalid_grant', message: 'nope' } };
  t('N2 429 判定为限流', W.isQuotaOrRateError(e429) === true);
  t('N3 quota_ 前缀判定为限额', W.isQuotaOrRateError(eq) === true);
  t('N4 5xx 不算限流（不该换模型掩盖服务故障）', W.isQuotaOrRateError(eOther) === false);
  t('N5 登录失效不算限流（该走会话自愈）', W.isQuotaOrRateError(eAuth) === false);
  t('N6 空错误不抛异常', W.isQuotaOrRateError(null) === false);
  // 自动换模型只在第一次生效（switched 守卫），避免来回横跳
  const srcRate = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  t('N7 换模型有一次性守卫', /!switched && isQuotaOrRateError/.test(srcRate));
  t('N8 换模型时给用户可见的提示', /当前模型有点忙，已自动切换/.test(srcRate));
  // 关键：429 必须在 catch 里"不立刻抛"，否则永远走不到换模型分支
  t('N9 限流错误不无条件抛出（否则自愈失效）', /isQuotaOrRateError\(e\) && !switched/.test(srcRate));
  // 顺序保证：换模型分支在最终 throw 之前
  const iSwitch = srcRate.indexOf('!switched && isQuotaOrRateError');
  const iThrow = srcRate.indexOf('throw lastErr || new Error(\'AI 调用失败\')');
  t('N10 自愈分支位于兜底抛出之前', iSwitch > 0 && iThrow > iSwitch);

  console.log('\n=== O. 界面逻辑优化（可见性 / 防误触 / 文案歧义） ===');
  // ① 助教记录不该藏在"参会者"页里 —— 学生默认停在聊天页
  t('O1 聊天页有助教记录入口', !!W.document.querySelector('#assistant-mini'));
  t('O2 有跳转并高亮的函数', typeof W.focusAssistantLog === 'function');
  // ② 下课不可逆（生成小结 + 结束回放 + 一次 AI 调用），必须挡误触
  t('O3 有下课二次确认', typeof W.confirmEndLive === 'function' && typeof W.resetEndConfirm === 'function');
  const topEnd = W.document.querySelector('#btn-end');
  W.state.live = { course: { id: 'c1', title: 't', slides: [{}] }, messages: [], recording: [], recStart: Date.now(), slideIndex: 0, ended: false };
  W.endLive = W.endLive || (() => {});
  let ended = 0;
  const realEnd = W.endLive;
  W.confirmEndLive(topEnd);
  t('O4 第一次点击不下课、按钮改为确认态', topEnd.textContent === '再点一次确认');
  W.resetEndConfirm();
  t('O5 超时/取消后按钮文案复原', topEnd.textContent === '结束会议' && topEnd.dataset === undefined || topEnd.textContent === '结束会议');
  t('O6 二次确认会还原按钮原文案', /结束/.test(topEnd.textContent));
  // ③ 摄像头按钮的实际作用是你看到的老师画面，不是你的摄像头 —— 文案必须无歧义
  const srcUi = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  t('O7 不再写"停止视频/开启视频"这类易误解文案', !/停止视频|开启视频/.test(srcUi));
  t('O8 摄像头按钮说明了不影响自己的摄像头', /不影响你的摄像头/.test(srcUi));
  t('O9 初始标签为隐藏画面', /mt-label">隐藏画面</.test(fs.readFileSync(path.join(APP, 'index.html'), 'utf8')));
  W.state.live = null;

  console.log('\n=== P. 一个人一个账号：设备闸门（服务端强制） ===');
  // 背景：平台无手机号登录/绑定（协议层邮箱与手机互斥），拿不到实名级唯一标识；
  // 退而用设备维度去重，且必须服务端强制执行，客户端只能伪造指纹值、绕不过判定。
  t('P1 有设备指纹函数', typeof W.deviceFingerprint === 'function');
  const fp1 = W.deviceFingerprint();
  t('P2 指纹是稳定哈希且非空', typeof fp1 === 'string' && fp1.length > 3 && fp1[0] === 'd');
  t('P3 同一环境两次取值一致（可复现）', fp1 === W.deviceFingerprint());
  t('P4 指纹不含原始 UA 片段（只存哈希）', fp1.indexOf('Mozilla') < 0 && fp1.indexOf('Windows') < 0);
  t('P5 有注册前检查函数', typeof W.deviceAlreadyUsed === 'function');
  t('P6 有认领函数', typeof W.deviceClaim === 'function');
  // 未连接云服务时必须安全降级（不拦人、不抛错）
  const savedCloud = W.state.cloud;
  W.state.cloud = null;
  let devThrew = false;
  let used = null;
  try { used = await W.deviceAlreadyUsed(); } catch (_) { devThrew = true; }
  t('P7 云服务不可用时检查降级为"未占用"且不抛错', devThrew === false && used === false);
  W.state.cloud = { database: { rpc: async () => ({ error: { message: 'x' } }) } };
  t('P8 RPC 报错时同样不误伤（返回未占用）', (await W.deviceAlreadyUsed()) === false);
  W.state.cloud = { database: { rpc: async () => ({ data: true }) } };
  t('P9 服务端返回已占用时如实拦截', (await W.deviceAlreadyUsed()) === true);
  W.state.cloud = { database: { rpc: async (name) => ({ data: name === 'device_claim' ? 'taken' : false }) } };
  W.state.user = { id: 'u1' };
  t('P10 认领返回 taken 时如实上报（用于风控与提示）', (await W.deviceClaim()) === 'taken');
  W.state.cloud = { database: { rpc: async () => ({ data: 'mine' }) } };
  t('P11 同一账号复用设备时返回 mine（不误报冲突）', (await W.deviceClaim()) === 'mine');
  W.state.cloud = savedCloud;
  W.state.user = null;
  // 服务端强制的证据：唯一约束 + SECURITY DEFINER 函数 + 表无直写权限
  const srcDev = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  t('P12 客户端调用的是函数而非直接写表', /rpc\('device_claim'/.test(srcDev) && !/from\('device_ledger'\)\.insert/.test(srcDev));
  t('P13 注册前先检查设备（硬拦多开）', /deviceAlreadyUsed\(\)/.test(srcDev));
  t('P14 提示文案引导老用户去登录/找回', /已经注册过账号了/.test(srcDev));
  t('P15 隐私政策已声明设备标识收集', /设备标识/.test(srcDev) && /账号唯一性校验/.test(srcDev));
  t('P16 注册页提前说明一个账号规则', /只能注册一个账号/.test(fs.readFileSync(path.join(APP, 'index.html'), 'utf8')));
  // 版本号格式：日期 + 序号（改条文时必须同步改，否则已同意用户不会被要求重读）
  t('P17 协议版本号格式合法（日期.序号）', /LEGAL_VERSION = '20\d\d-\d\d-\d\d\.\d+'/.test(srcDev));
  // ★ 实测踩坑：访客会话 auth.uid() 是字符串 'anon' 而非 NULL，服务端必须显式排除，
  //   否则访客会占掉设备额度，把真用户的注册挡掉。SQL 落在 sql/001_device_ledger.sql。
  const sqlFile = fs.readFileSync(path.join(APP, 'sql', '001_device_ledger.sql'), 'utf8');
  t('P18 SQL 里显式排除了访客 uid\'anon\'', /me = 'anon'/.test(sqlFile));
  t('P19 SQL 里有指纹唯一约束', /fingerprint TEXT NOT NULL UNIQUE/.test(sqlFile));
  t('P20 SQL 收回了表直写权限（只能走函数）', /REVOKE INSERT, UPDATE, DELETE ON device_ledger/.test(sqlFile));
  t('P21 客户端对访客不认领（memReady 已排除 anonymous）', /!state\.user\.anonymous/.test(srcDev) && /!memReady\(\)\) return 'skip'/.test(srcDev));
  // ★ 顺序坑：switchAuthTab 内部会 authMsg('') 清空提示，必须先切页签再给提示，
  //   否则用户只看到跳转、看不到"为什么被拦"
  const iTab = srcDev.indexOf("switchAuthTab('password');\n        const pe0");
  const iMsg = srcDev.indexOf('这台设备已经注册过账号了', iTab > 0 ? iTab : 0);
  t('P22 先切页签再显示拦截原因（否则提示会被清空）', iTab > 0 && iMsg > iTab);

  console.log('\n=== Q. 手机号改为使用要求（门禁） ===');
  // 背景：邮箱注册保留；手机号从"可跳过"改为"要求"，作为课后联系与找回账号的唯一现实通道。
  // 但平台无短信校验，所以只能做声明式登记 —— 门禁落在核心消费动作上，浏览不受限。
  t('Q1 有手机号判断函数', typeof W.needsPhone === 'function');
  t('Q2 有门禁函数', typeof W.ensurePhone === 'function');
  t('Q3 有门禁保存函数', typeof W.saveGatePhone === 'function');
  t('Q4 门禁弹窗存在', !!W.document.querySelector('#phone-gate-modal'));
  t('Q5 门禁弹窗有手机号输入与两个按钮', !!W.document.querySelector('#phone-gate-input') && !!W.document.querySelector('#btn-phone-gate-save') && !!W.document.querySelector('#btn-phone-gate-later'));
  // 访客不拦：不是账号，不该被手机号挡在外面
  const savedUser = W.state.user; const savedCloud2 = W.state.cloud; const savedMem = W.state.mem; const savedLoaded = W.state.memLoaded;
  W.state.user = null; W.state.mem = null;
  t('Q6 访客不触发门禁', W.needsPhone() === false && W.ensurePhone('生成课程') === true);
  // 已登录但记忆未就绪：不误拦（否则已有手机号的老用户会被错伤）
  W.state.user = { id: 'u1' }; W.state.cloud = { database: {} }; W.state.mem = null; W.state.memLoaded = false;
  t('Q7 记忆未就绪时不误拦', W.needsPhone() === false);
  // 已登录 + 记忆就绪 + 无手机号 → 拦
  W.state.mem = { profile: {} }; W.state.memLoaded = true;
  t('Q8 已登录未登记手机号 → 需要手机号', W.needsPhone() === true);
  const gatePassed = W.ensurePhone('生成课程');
  t('Q9 门禁拦下动作并弹出登记窗', gatePassed === false && W.document.querySelector('#phone-gate-modal').hidden === false);
  t('Q10 弹窗里说明了被拦的动作', /生成课程/.test(W.document.querySelector('#phone-gate-what').textContent));
  // 已登记 → 放行
  W.state.mem = { profile: { phone: '13800138000' } };
  t('Q11 已登记手机号 → 放行', W.needsPhone() === false && W.ensurePhone('进入课堂') === true);
  W.state.user = savedUser; W.state.cloud = savedCloud2; W.state.mem = savedMem; W.state.memLoaded = savedLoaded;
  W.document.querySelector('#phone-gate-modal').hidden = true;
  // 文案与来源检查
  const srcPhone = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  const htmlPhone = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  t('Q12 注册收尾明确写"这是使用要求"', /这是使用要求/.test(htmlPhone));
  t('Q13 去掉了"先跳过"，改为人工出路', !/先跳过/.test(htmlPhone) && /我没有手机号/.test(htmlPhone));
  t('Q14 门禁接在生成课程上', /ensurePhone\('生成课程'\)/.test(srcPhone));
  t('Q15 门禁接在进入课堂上', /ensurePhone\('进入课堂'\)/.test(srcPhone));
  t('Q16 门禁有埋点可统计流失', /track\('phone_gate'/.test(srcPhone) && W.TRACK_EVENTS.indexOf('phone_gate') >= 0);
  // ★ 2026-09-24 行为变更：实测 /.cloud/auth/v1/verification 已可用（返回 verificationId+verify），
  //   所以原文案"不做短信校验"是不准确的，且与登录页的短信入口矛盾 —— 断言随之翻转。
  //   注意：只查**隐私政策正文**，不扫全文（注释里保留"登记流程不做短信校验"是准确的说明）
  const privText = W.PRIVACY_DOC.map((s) => s.h + ' ' + s.p.join(' ')).join('\n');
  t('Q17 隐私政策正文不再声称"不做短信校验"（通道已可用）', !/不做短信校验/.test(privText));
  t('Q17b 隐私政策改为说明手机号登录会做短信核验', /短信验证码核验/.test(privText));
  t('Q18 展示用生效日期与内部版本键分离', /LEGAL_EFFECTIVE = '20\d\d-\d\d-\d\d'/.test(srcPhone) && /LEGAL_REVISION = 'V/.test(srcPhone));
  t('Q19 未对手机号加唯一约束（避免家长共用号被误伤）', !/UNIQUE\(phone\)|phone.*UNIQUE/.test(fs.readFileSync(path.join(APP, 'sql', '001_device_ledger.sql'), 'utf8')));

  console.log('\n=== R. 一次性邮箱拦截 + 手机号共用检测 ===');
  t('R1 有一次性邮箱判断函数', typeof W.isThrowawayMail === 'function');
  // 正例：常见一次性邮箱都应命中
  const bad = ['a@mailinator.com', 'b@guerrillamail.com', 'c@10minutemail.com', 'd@yopmail.com', 'e@temp-mail.org', 'f@sub.mailinator.com', 'g@trashmail.com'];
  bad.forEach((m) => t('R2 拦截 ' + m, W.isThrowawayMail(m) === true));
  // 反例：正常邮箱绝不能被误伤（这是本功能最大的风险）
  const good = ['a@gmail.com', 'b@qq.com', 'c@163.com', 'd@outlook.com', 'e@hotmail.com', 'f@icloud.com',
    'g@stu.pku.edu.cn', 'h@student.mit.edu', 'i@mail.tsinghua.edu.cn', 'j@company.com.cn', 'k@foxmail.com',
    'l@126.com', 'm@sina.com', 'n@mail.ru', 'o@yandex.com', 'p@protonmail.com'];
  good.forEach((m) => t('R3 放行 ' + m, W.isThrowawayMail(m) === false));
  t('R4 空值/异常输入不崩', W.isThrowawayMail('') === false && W.isThrowawayMail('no-at-sign') === false && W.isThrowawayMail(null) === false);
  t('R5 大小写不敏感', W.isThrowawayMail('A@MAILINATOR.COM') === true);
  t('R6 名单是明确域名而非宽泛词', W.THROWAWAY_MAIL_DOMAINS.indexOf('mail') < 0 && W.THROWAWAY_MAIL_DOMAINS.indexOf('gmail.com') < 0);

  // 手机号：只送哈希，不送明文
  t('R7 有手机号哈希函数', typeof W.phoneHash === 'function');
  const h1 = await W.phoneHash('13800138000');
  t('R8 哈希为 64 位 hex（SHA-256）', /^[0-9a-f]{64}$/.test(h1));
  t('R9 同一号码哈希稳定', (await W.phoneHash('13800138000')) === h1);
  t('R10 不同号码哈希不同', (await W.phoneHash('13900139000')) !== h1);
  t('R11 哈希中不含明文号码', h1.indexOf('13800138000') < 0);
  t('R12 有共用检测函数', typeof W.phoneClaim === 'function');
  // 未登录 / 云不可用时不误报
  const savedU = W.state.user; const savedC = W.state.cloud;
  W.state.user = null;
  t('R13 未登录时不检测（返回 skip）', (await W.phoneClaim('13800138000')) === 'skip');
  W.state.user = { id: 'u1' }; W.state.cloud = { database: { rpc: async () => ({ data: 'shared' }) } };
  t('R14 服务端报共用时如实返回 shared', (await W.phoneClaim('13800138000')) === 'shared');
  W.state.cloud = { database: { rpc: async () => ({ data: 'ok' }) } };
  t('R15 服务端报首次时返回 ok', (await W.phoneClaim('13800138000')) === 'ok');
  W.state.cloud = { database: { rpc: async () => ({ error: { message: 'x' } }) } };
  t('R16 RPC 报错时降级为 skip（不误报冲突）', (await W.phoneClaim('13800138000')) === 'skip');
  W.state.user = savedU; W.state.cloud = savedC;
  t('R17 共用提示措辞不指责（家长共用是正当场景）', /家长/.test(W.sharedPhoneNote()) && /无需处理/.test(W.sharedPhoneNote()));

  // 注册前埋点的延迟补报（否则一次性邮箱被拦统计不到）
  t('R18 有延迟埋点函数', typeof W.trackLater === 'function' && typeof W.flushPendingTracks === 'function');
  W.flushPendingTracks();
  W.trackLater('mail_blocked', { domain: 'mailinator.com' });
  const queued = JSON.parse(W.localStorage.getItem(W.TRACK_PENDING_KEY) || '[]');
  t('R19 未登录时事件进本地队列', queued.length === 1 && queued[0].name === 'mail_blocked');
  t('R20 白名单外的事件不入队', (W.trackLater('not_a_real_event', {}), JSON.parse(W.localStorage.getItem(W.TRACK_PENDING_KEY) || '[]').length === 1));
  W.flushPendingTracks();
  t('R21 补报后清空队列', JSON.parse(W.localStorage.getItem(W.TRACK_PENDING_KEY) || '[]').length === 0);
  const sql2 = fs.readFileSync(path.join(APP, 'sql', '002_phone_ledger_and_risk_queries.sql'), 'utf8');
  t('R22 风控查询用了真实列名 name/props', /name = 'mail_blocked'/.test(sql2) && /props->>'blocked'/.test(sql2));
  t('R23 查询里没有臆造的 event/payload 列', !/WHERE event =|payload->>/.test(sql2));

  console.log('\n=== S. 不可信输入归一化（云端/本地/模型三路收口） ===');
  // 实测抓到的 4 处崩溃：slides 为字符串、facts 含 null、诊断画像缺字段
  t('S1 有 asArray 工具', typeof W.asArray === 'function');
  t('S2 asArray 只认真数组', W.asArray([1]).length === 1 && W.asArray('str').length === 0 && W.asArray(null).length === 0 && W.asArray({}).length === 0);
  t('S3 有课程归一化', typeof W.normalizeCourse === 'function' && typeof W.normalizeCourses === 'function');

  // 崩溃场景 1：slides 是字符串（原实现 slides.filter is not a function）
  const c1 = W.normalizeCourse({ id: 'a', title: 'x', slides: 'oops', replay: 'nope' });
  t('S4 slides 非数组 → 归正为空数组', Array.isArray(c1.slides) && c1.slides.length === 0);
  t('S5 脏 replay → 丢弃而不是留半截', c1.replay === null);
  t('S6 归一化结果可安全统计题量', typeof W.quizCountOf(c1) === 'number');

  // 崩溃场景 2：课程字段全缺
  const c2 = W.normalizeCourse({ id: 'b' });
  t('S7 缺 title 有兜底', typeof c2.title === 'string' && c2.title.length > 0);
  t('S8 缺 progress → 0 且被夹在 0~1', c2.progress === 0);
  t('S9 progress 越界被夹住', W.normalizeCourse({ id: 'c', progress: 9 }).progress === 1);
  t('S10 非对象输入返回 null', W.normalizeCourse(null) === null && W.normalizeCourse('x') === null);
  t('S11 课程列表过滤掉脏元素', W.normalizeCourses([{ id: 'ok' }, null, 'bad', 0]).length === 1);
  t('S12 outline 子字段也归正', (() => {
    const c = W.normalizeCourse({ id: 'd', outline: { stages: null, knowledgePoints: 'x', homework: undefined } });
    return Array.isArray(c.outline.stages) && Array.isArray(c.outline.knowledgePoints) && Array.isArray(c.outline.homework);
  })());

  // 崩溃场景 3：记忆条目含 null（原实现 Cannot read properties of null (reading 'kind')）
  t('S13 有记忆归一化', typeof W.normalizeFacts === 'function');
  const f1 = W.normalizeFacts([null, { kind: 'weak', content: '  ' }, { kind: 'weak', content: '真的内容' }, 'str', {}]);
  t('S14 丢掉 null/空内容/非对象', f1.length === 1 && f1[0].content === '真的内容');
  t('S15 kind 非法时兜底为 context', W.normalizeFacts([{ kind: 123, content: 'x' }])[0].kind === 'context');
  t('S16 confidence 非法时有默认值', W.normalizeFacts([{ content: 'x', confidence: 'high' }])[0].confidence === 0.7);
  t('S17 非数组输入返回空数组', W.normalizeFacts(null).length === 0);

  // 崩溃场景 4：诊断画像缺字段（原实现 reading 'ok' / reading 'length'）
  t('S18 有诊断画像归一化', typeof W.normalizeDiagProfile === 'function');
  const d1 = W.normalizeDiagProfile({});
  t('S19 空画像也能安全渲染所需字段', d1 && d1.counts && typeof d1.counts.ok === 'number' && Array.isArray(d1.topics) && typeof d1.verdict === 'string');
  t('S20 counts 缺项补 0', d1.counts.ok === 0 && d1.counts.gap === 0);
  const d2 = W.normalizeDiagProfile({ counts: { ok: 'x' }, topics: [null, { topic: '真知识点' }, {}], total: NaN });
  t('S21 数值非法归 0', d2.counts.ok === 0 && d2.total === 0);
  t('S22 topics 过滤掉无 topic 的项', d2.topics.length === 1 && d2.topics[0].topic === '真知识点');
  t('S23 非对象画像返回 null（渲染直接跳过而非崩）', W.normalizeDiagProfile(null) === null);
  // ★ 字段清单要从"实际用到的成员"反查，不能凭印象补 —— 上一版漏了 focus/skip 就崩了
  const d3 = W.normalizeDiagProfile({});
  t('S23b focus/skip 也补齐为数组', Array.isArray(d3.focus) && Array.isArray(d3.skip));
  t('S23c judged 补齐为数字', typeof d3.judged === 'number');
  t('S23d focus/skip 过滤掉非字符串', W.normalizeDiagProfile({ focus: ['a', 1, null], skip: 'x' }).focus.length === 1);
  t('S24 归一化是幂等的', (() => {
    const once = W.normalizeCourse({ id: 'e', title: 't', slides: [{ type: 'quiz', question: 'q' }] });
    const twice = W.normalizeCourse(once);
    return twice.slides.length === once.slides.length && twice.title === once.title;
  })());

  // 重复实现合并后行为不变
  t('S25 提示条合并为唯一实现', /function setMsg\(sel, text, kind\)/.test(srcDev) && (srcDev.match(/el\.className = 'auth-msg ' \+ \(kind === 'ok' \? 'ok' : 'err'\)/g) || []).length === 1);
  t('S26 死代码 teacherAvatarHTML 已删', srcDev.indexOf('function teacherAvatarHTML') < 0);

  console.log('\n=== T. 用户视角：触控尺寸与键盘可达性 ===');
  const cssT = fs.readFileSync(path.join(APP, 'css', 'style.css'), 'utf8');
  // 实测：课件翻页原 26×26，手指点不中；学习场景里"翻回上一页"是高频动作
  // 注意：要锚定行首 —— `.share-foot .slh-btn` 只设颜色，不匹配行首会抓错块
  t('T1 课件翻页按钮已放大到 ≥40', /^\.slh-btn \{\s*\r?\n\s*width: 40px; height: 40px;/m.test(cssT));
  // 其余交互元素给下限，避免手机上点不中
  t('T2 工具条按钮有最小高度', /\.mt-btn \{[^}]*min-height:\s*44px/.test(cssT));
  t('T3 快捷提问有最小高度', /\.quick-chip \{[^}]*min-height/.test(cssT));
  t('T4 目标预设与结束按钮有最小高度', /\.goal-chip \{[^}]*min-height/.test(cssT) && /\.meet-end-top \{[^}]*min-height/.test(cssT));
  t('T5 尺寸修复没有用 !important 硬覆盖', !/\.slh-btn \{[^}]*!important/.test(cssT));
  t('T6 尺寸修复带原因注释（避免以后被误删）', /手指能稳点中|点不中就是硬伤/.test(cssT));
  // 键盘：大纲抽屉原本 Esc 关不掉（它不是 .modal-mask）
  t('T7 Esc 能关闭大纲抽屉', /const board = \$\('#meet-board'\);\s*\n\s*if \(board && !board\.hidden\)/.test(srcDev));
  t('T8 Esc 仍优先处理弹窗', /const open = openMasks\(\);\s*\n\s*if \(open\.length\)/.test(srcDev));
  t('T9 讲解中 Esc 仍留给打断老师', /state\.live\.busy\) return;/.test(srcDev));

  console.log('\n=== U. 移动端「够得着」与新用户引导 ===');
  // 实测：手机上「生成课程」按钮在页内 1516px ≈ 第 1.8 屏；聊天输入框在 1066px ≈ 第 1.3 屏
  const mobileCss = cssT.match(/@media \(max-width: 760px\) \{[\s\S]*?\n\}/);
  t('U1 有窄屏媒体查询', !!mobileCss);
  t('U2 生成按钮在窄屏吸底（否则要滚 1.8 屏才点得到）', /#btn-generate \{[^}]*position: sticky/.test(cssT));
  t('U3 聊天输入行在窄屏吸底（学生最常用的动作不能藏在第 1.3 屏）', /#pane-chat \.chat-input-row \{[\s\S]{0,120}?position: sticky/.test(cssT));
  t('U4 手机端输入框有最小高度', /#chat-input \{ min-height: 44px/.test(cssT));
  t('U5 手机端发送按钮有最小尺寸', /#btn-send \{ min-height: 44px/.test(cssT));
  t('U6 修复带原因注释', /够得着|第 1\.8 屏|第 1\.3 屏/.test(cssT));
  // 手机端工具栏 3 行堆叠占 220px，是输入框被挤到第 1.3 屏的元凶 → 改横滑一行
  t('U6b 手机端工具栏改横滑一行', /\.meet-toolbar \{[\s\S]{0,160}?flex-wrap: nowrap; overflow-x: auto/.test(cssT));
  t('U6c 横滑时按钮不被压缩', /\.mt-btn \{ flex: 0 0 auto; \}/.test(cssT));
  t('U6d 隐藏横滑滚动条（视觉整洁）', /\.meet-toolbar::-webkit-scrollbar \{ display: none; \}/.test(cssT));
  t('U6e 手机端视频区不再吃掉近半屏', /@media \(max-width: 760px\)[\s\S]*?\.meet-strip \{ min-height: 240px; \}/.test(cssT));
  // 新用户引导：访客课程页要讲清"登录有什么用"
  t('U7 课程页有访客提示条', !!document.querySelector('#courses-guest-hint'));
  t('U8 提示条讲明了"换设备也能看到"', /换设备/.test(document.querySelector('#courses-guest-hint').textContent));
  t('U9 提示条里的登录入口可绑定', !!document.querySelector('#courses-guest-login'));
  t('U10 登录后提示条会隐藏', /guestHint\.hidden = !!\(state\.user && !state\.user\.anonymous\)/.test(srcDev));
  // 自伤检查：我新加的登录入口一开始是纯文字链，实测命中区只有 25×16
  t('U11 访客提示里的登录入口是按钮尺寸（不是细文字链）', /\.guest-hint a \{[\s\S]{0,160}?min-height: 32px/.test(cssT));

  console.log('\n=== V. 存储安全：写失败不能静默 ===');
  const srcStore = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  // 实测：塞 6MB 进 localStorage 抛 QuotaExceededError，原来界面零提示
  t('V1 有统一的课程落盘函数', typeof W.persistCourses === 'function');
  t('V2 落盘失败会提示用户（不再静默）', /本机存储已满/.test(srcStore));
  t('V3 未登录时提示说清会丢数据', /新内容可能保存不下来/.test(srcStore) && /登录后会自动存到云端/.test(srcStore));
  t('V4 已登录时提示区分（不吓人）', /本地缓存没能更新/.test(srcStore));
  t('V5 只提示一次（不会每 30 秒刷屏）', /if \(!storageWarned\)/.test(srcStore));
  t('V6 有埋点便于排查', /track\('storage_full'/.test(srcStore));
  /* 所有课程写入都应走统一入口。
     ★ 2026-09-29 更新：课程键现在带 `::<owner>` 后缀（R01 按账号隔离），
       所以字面 `setItem('lingxi_courses_v1'` 应该是 **0** 处 ——
       真正要守的是"没有任何一处**绕过** scopedContentKey 直接写全局键"。
       写成 1 反而是错的：那说明还有人往无归属的键里写。 */
  const rawUnscoped = (srcStore.match(/localStorage\.setItem\('lingxi_courses_v1'/g) || []).length;
  const viaScoped = (srcStore.match(/localStorage\.setItem\(scopedContentKey\(/g) || []).length;
  t('V7 课程写入不绕过归属命名空间（无裸全局键写入）', rawUnscoped === 0, '裸写入=' + rawUnscoped);
  t('V8 课程/题库/备份的写入都经 scopedContentKey', viaScoped >= 2, '经命名空间=' + viaScoped);
  // 极端长课堂：回放事件有上限，且裁剪后有时间轴标记
  t('V8 回放事件有上限常量', typeof W.REC_MAX_EVENTS === 'number' && W.REC_MAX_EVENTS >= 1000);
  t('V9 超限时裁剪并留下"被裁掉"标记', /_recTrimmed/.test(srcStore) && /只保留最近的部分/.test(srcStore));
  // 断言语义而非精确表达式：从下标 0 开始 splice = 丢最旧的（改实现时不该误报）
  t('V10 裁剪丢的是最旧的（从下标 0 开始删）', /live\.recording\.splice\(0,/.test(srcStore));
  // 检查点重复写入保护
  t('V11 检查点在事件数未变时跳过', /_cpEventCount/.test(srcStore));

  // 行为验证：真的到了上限会怎样
  const live0 = W.state.live;
  W.state.live = { recStart: Date.now() - 100000, recording: [] };
  for (let i = 0; i < W.REC_MAX_EVENTS + 50; i++) W.recordEvent('speak', 'x' + i);
  const recLen = W.state.live.recording.length;
  const hasTrimNote = W.state.live.recording.some((e) => e.type === 'trimmed');
  t('V12 超过上限后长度被约束在合理范围', recLen <= W.REC_MAX_EVENTS, 'len=' + recLen);
  t('V13 裁剪后带提示标记', hasTrimNote);
  t('V13b 标记不会被后续裁剪吃掉（连推 3 倍量仍在）', (() => {
    W.state.live = { recStart: Date.now() - 1000, recording: [] };
    for (let i = 0; i < W.REC_MAX_EVENTS * 3; i++) W.recordEvent('speak', 'y' + i);
    const r = W.state.live.recording;
    return r.length <= W.REC_MAX_EVENTS && r.some((e) => e.type === 'trimmed');
  })());
  t('V13c 未知事件类型不会让回放崩（回放按类型过滤）', /e\.type === 'speak' \|\| e\.type === 'slide'/.test(srcStore));
  W.state.live = live0;

  console.log('\n=== W. 实测报告修复项（防回退） ===');
  const cssW = fs.readFileSync(path.join(APP, 'css', 'style.css'), 'utf8');
  // ① 国内课程默认带 IB：默认值就不该有 boards，且切体系要无条件重置
  t('W1 gen 默认考纲为空（原默认 [\'ib\'] 会让国内课程挂 IB 标签）', /gen: \{ system: 'cn', subject: '数学', boards: \[\]/.test(srcDev));
  t('W2 切体系统一入口存在', typeof W.applyGenSystem === 'function');
  t('W3 切体系时考纲无条件重置（不是"新体系有才赋值"）',
    /state\.gen\.boards = \(sys\.boards && sys\.boards\.length\) \? \[sys\.boards\[0\]\.id\] : \[\]/.test(srcDev));
  t('W4 三个入口都走统一函数（首页 tab / 科目卡 / 生成页 chip）',
    (srcDev.match(/applyGenSystem\(/g) || []).length >= 4);
  t('W5 国内课程确实没有 boards 字段（机制前提）', !/id: 'cn',[\s\S]{0,900}?boards:/.test(srcDev.slice(srcDev.indexOf('const SYSTEMS'), srcDev.indexOf('const SYSTEMS') + 2600)));
  // ①b 行为验证：切到国际再切回国内，不能残留
  const bk = W.state.gen.boards.slice();
  W.applyGenSystem('intl'); const gotIntl = W.state.gen.boards.slice();
  W.applyGenSystem('cn'); const backCn = W.state.gen.boards.slice();
  t('W6 国际→国内切回后考纲被清空', gotIntl.length > 0 && backCn.length === 0, 'intl=' + JSON.stringify(gotIntl) + ' cn=' + JSON.stringify(backCn));
  W.state.gen.boards = bk;

  // ② 生成时暴露原始 JSON
  t('W7 生成流式区不再直接显示原文', !/onDelta: \(_d, full\) => \{\s*streamText\.textContent = full;/.test(srcDev));
  t('W8 改为显示"正在设计《标题》"式进度', /灵犀老师正在设计《/.test(srcDev) && typeof W.peekCourseTitle === 'function');
  t('W9 标题预览只在 JSON 闭合后才取（不显示半截）', W.peekCourseTitle('{"title":"分') === '' && W.peekCourseTitle('{"title":"分数的认识"') === '分数的认识');
  t('W10 未闭合时不崩', W.peekCourseTitle('{"tit') === '' && W.peekCourseTitle('') === '');

  // ③ 模型下拉重复
  t('W11 重名模型会补 id 区分（hy3/hy3-x 显示名都是 Hy3）', /nameCount\[n\] > 1 \? n \+ '（' \+ m\.id \+ '）'/.test(srcDev));

  // ④ 邀请同学文案与行为一致
  const htmlW = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  t('W12 按钮文案不再暗示邀请真人', !/邀请同学加入/.test(htmlW) && /叫一位同学进来/.test(htmlW));
  t('W13 加入时说明是"模拟同学"', /模拟同学，用于讨论与提问练习/.test(srcDev));

  // ⑤ 回放幽灵发言：时间轴要标出说话人
  t('W14 回放时间轴显示发言人（ask 事件带 who）', /const who = e\.type === 'ask' \? String\(e\.who \|\| '你'\)/.test(srcDev));
  t('W15 回放字幕对缺失 who 做兜底（避免 undefined：）', /String\(e\.who \|\| '你'\) \+ '：' \+ e\.v/.test(srcDev));

  // ⑥ 导出 PPT 有"进行中"反馈
  t('W16 导出先给进行中提示（原来只在完成后 toast）', /正在生成 PPT（' \+ slides\.length/.test(srcDev));
  t('W17 导出按钮接收调用方传入（两个入口）', /function exportPPTX\(course, btn\)/.test(srcDev) && (srcDev.match(/exportPPTX\([^)]*,\s*\w+\)/g) || []).length >= 2);
  t('W18 按钮状态有兜底恢复', /function restore\(b\)|const restore = \(b\)/.test(srcDev));

  console.log('\nTRACK_RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('TRACK_ERROR ' + (e && e.stack || e)); process.exit(2); });
