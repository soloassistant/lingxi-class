const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const FAIL_WINDOW = 3;      // 连续失败 3 次
const COOL_DOWN_MS = 60000; // 冷却 60 秒
const DAILY_QUOTA = parseInt(process.env.AI_DAILY_QUOTA || '20', 10);   // 单用户每日配额
const DAILY_GLOBAL_QUOTA = parseInt(process.env.AI_GLOBAL_QUOTA || '2000', 10); // 全局每日上限（防 key 被刷爆）
const RATE_WINDOW_MS = 60000;  // 频率统计窗口：60 秒
const RATE_MAX = parseInt(process.env.AI_RATE_MAX || '10', 10);         // 单用户每分钟最多 10 次
const MAX_PROMPT_LEN = 4000;    // 单次输入上限，防止拿超长 prompt 刷 token

/* ============================================================
   超时预算（外部审查 R15）
   ------------------------------------------------------------
   原状：单次上游超时 25 秒，两个 key 顺序重试 → 最坏 50 秒，
   而本函数 `config.json` 里总时长只有 30 秒 —— **主通道一超时，
   备份通道通常已经拿不到预算**，平台会在 await 之中把函数强杀，
   本地没有任何兜底（连 log 都来不及写）。
   嵌套更糟：aiProxy 被 8 个外层云函数调用，而**那些外层也是 30 秒**，
   也就是说外层必然先被强杀。所以单改这里不够，两边必须一起核算。

   现在把预算写成显式常量，层级关系一眼可见：
     外层调用方（8 个函数）      40s   ← 必须 > aiProxy 的总时长
       └─ aiProxy 函数本身        30s   ← config.json
            ├─ 全部上游重试合计    26s   ← UPSTREAM_BUDGET_MS（给返回留 4 秒余量）
            └─ 单次上游尝试        15s   ← PER_ATTEMPT_MAX_MS（保证两个 key 都跑得完）

   另外修了一处容易漏的：原来 `clearTimeout(timer)` 写在 `res.json()` **之前**，
   于是"响应头拿到了、响应体一直不来"这种情况完全没有超时保护。
   现在定时器在 finally 里清理，响应体读取也在保护范围内。
   ============================================================ */
const FN_BUDGET_MS = 30000;                        // 与 config.json 的 timeout 保持一致
const RETURN_RESERVE_MS = 4000;                    // 留给序列化与平台返回
const UPSTREAM_BUDGET_MS = FN_BUDGET_MS - RETURN_RESERVE_MS;   // 26s：所有重试**共享**
const PER_ATTEMPT_MAX_MS = 15000;                  // 单次上游尝试上限
const MIN_ATTEMPT_MS = 1500;                       // 剩余预算低于这个数就别再开新尝试了

let failCount = 0;
let coolDownUntil = 0;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();

  // 只允许内部云函数调用：拒绝非微信调用上下文（无 OPENID 一律不放行）
  if (!OPENID) {
    return { code: 401, msg: '未授权调用', fallback: event.fallback || null };
  }

  if (now < coolDownUntil) {
    return { code: 503, msg: 'AI 服务冷却中，请稍后再试', fallback: event.fallback || null };
  }

  const keys = [process.env.AI_KEY_PRIMARY, process.env.AI_KEY_SECONDARY].filter(Boolean);
  const base = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const models = [
    process.env.AI_MODEL_PRIMARY || 'gpt-4o-mini',
    process.env.AI_MODEL_SECONDARY || 'gpt-4o-mini'
  ];

  /* ============================================================
     输出格式契约（外部审查 R13）
     ------------------------------------------------------------
     原状：这里**无条件**要求 JSON（system 里写"Always output valid JSON only"，
     还带 response_format: json_object，并对返回做 JSON.parse）。
     可是打断问答（aiInterject）与答案解析（aiExplain）的提示词明确写着
     「不要输出 JSON」「讲解要口语化」—— 两边在互相下相反的命令。
     后果：模型要么被 system 压成 JSON（然后调用方去**猜**字段名
     reply/answer/text/content），要么真的输出散文、JSON.parse 直接抛错。

     现在的契约（调用方必须显式选一种，只有两种）：
       format: 'json'（默认）→ 返回 { code:0, data: <解析后的对象> }
       format: 'text'        → 返回 { code:0, text: <纯文本> }
     猜字段名的兜底链一并去掉：一个功能一个字段，不再"四个里蒙一个"。
     ============================================================ */
  const wantText = String(event.format || 'json') === 'text';

  if (keys.length === 0) {
    return { code: 503, msg: 'AI 密钥未配置', fallback: event.fallback || null };
  }

  // 输入长度限制：防止超长 prompt 消耗大量 token
  const prompt = String(event.prompt || '');
  if (prompt.length > MAX_PROMPT_LEN) {
    return { code: 400, msg: '输入内容过长', fallback: event.fallback || null };
  }

  // 内容安全检测（用户输入，可关闭）
  if (process.env.AI_SECURITY_CHECK !== 'off') {
    const sec = await cloud.callFunction({
      name: 'secCheck',
      data: { type: 'text', content: prompt.slice(0, 500) }
    }).catch(() => ({ result: { code: 0, pass: true } }));
    if (sec.result && sec.result.code !== 0) {
      return { code: 403, msg: sec.result.msg || '内容含违规信息', fallback: event.fallback || null };
    }
  }

  /* ============================================================
     配额与频控（外部审查 R12）
     ------------------------------------------------------------
     原状是「先查余额 → 调用付费模型 → 成功了才计数」，三处缺陷连在一起：

       ① 并发调用同时读到旧余额，于是全部放行。复现：全站日限额与单用户
          分钟限额都设为 1，**8 个并发请求全部调用了上游并成功** ——
          不是原注释里写的"极端并发少计 1 次"。
       ② 计数本身是读-改-写；首次并发还会各自 `add` 一条，
          同一天出现多份记录，配额被按份数放大。
       ③ 上游已消耗 token 但 JSON 解析失败的请求完全不计数。
          而且 `logCall`（分钟级频控的计数来源）只在成功路径被调用 ——
          失败请求根本不进这里，于是 `RATE_MAX` 对**连续失败的调用完全不生效**，
          连防刷的频控也被一并绕过。
       ④ 三处计数查询都是 `.catch(() => …)` 的 fail-open，任一查询出错
          都按"未超限"放行：一次数据库抖动就等于闸门消失。

     现在改成**调用前原子预留**：
       · 判定与自增合并到同一个数据库操作里
         （`where({ _id: key, count: _.lt(limit) }).update({ count: _.inc(1) })`），
         并发调用不可能再各自看到同一个旧余额；
       · 计数文档用**确定性 `_id`**（`q_/r_/g_` 前缀），天然唯一，
         首次并发也只会有一条；
       · 预留发生在调用上游**之前**，因此成功、失败、响应格式错误全都计入；
       · 预留失败（计数不可用）一律**拒绝**，不再 fail-open ——
         成本闸门宁可拦住，也不能漏放。

     ⚠ 部署说明：计数 `_id` 从"自动生成"改成确定性键，因此部署当天既有的
       旧计数不会再被读到，等于当天额度重新起算一次。这是一次性的、偏保守
       方向的代价（旧数据仍留在库里可查）。
     ⚠ 新集合 `ai_rate`（分钟级频控桶）需要在云开发控制台创建。
       频控用**固定分钟桶**而非滑动窗口：滑动窗口没法在单次数据库操作里
       原子判定，回到读-改-写就又是 R12 本身。代价是跨分钟边界的突发最坏
       可到 2×RATE_MAX，对"防脚本刷"这个目的可接受。
     ============================================================ */
  const nowTs = Date.now();
  const dateKey = todayStr();

  // ① 分钟级频控。被拒绝的请求同样占用桶 —— 它也是一次尝试，这正是
  //    "连续失败的调用也要受限"的落点。
  const rateRes = await reserve('ai_rate', rateKey(OPENID, nowTs), RATE_MAX,
    { openid: OPENID, bucket: Math.floor(nowTs / RATE_WINDOW_MS) });
  if (rateRes === 'error') return gateUnavailable(event);
  if (rateRes === 'exhausted') {
    return { code: 429, msg: '操作过于频繁，请稍后再试', fallback: event.fallback || null };
  }

  // ② 单用户每日配额
  const userRes = await reserve('ai_quota', userKey(OPENID, dateKey), DAILY_QUOTA,
    { openid: OPENID, date: dateKey });
  if (userRes === 'error') return gateUnavailable(event);
  if (userRes === 'exhausted') {
    return { code: 429, msg: '今日 AI 使用次数已达上限，请明天再来', fallback: event.fallback || null };
  }

  // ③ 全站每日上限：即使有人批量注册账号，也封顶在预算内
  const globalRes = await reserve('ai_usage_global', globalKey(dateKey), DAILY_GLOBAL_QUOTA,
    { date: dateKey });
  if (globalRes === 'error') return gateUnavailable(event);
  if (globalRes === 'exhausted') {
    return { code: 429, msg: '今日 AI 服务已达全站上限，请明天再来', fallback: event.fallback || null };
  }

  /* 调用明细：在调用上游**之前**落一条"尝试"记录，结束后回填结果。
     它不只是账本 —— "失败请求也要有记录"就是在这里落实的。
     写失败不阻塞主流程，但要留日志（不能静默）。 */
  const attemptId = await logAttempt(OPENID);

  /* ★ R15：所有重试共享一个总预算，而不是"每个 key 各自 25 秒"。
     进度条式地消耗：每次开新尝试前先看还剩多少，不够就别开了。 */
  const deadline = Date.now() + UPSTREAM_BUDGET_MS;
  for (let i = 0; i < keys.length; i++) {
    const left = deadline - Date.now();
    if (left <= MIN_ATTEMPT_MS) {
      console.error('[aiProxy] 上游预算用尽，放弃第 ' + (i + 1) + ' 个 key（剩余 ' + left + 'ms）');
      break;
    }
    const perAttempt = Math.min(PER_ATTEMPT_MAX_MS, left);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perAttempt);
    try {
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + keys[i]
        },
        body: JSON.stringify(Object.assign({
          model: models[i],
          messages: [
            {
              role: 'system',
              content: wantText
                ? 'You are a patient teacher. Reply in plain text only — no JSON, no markdown fences, no code blocks.'
                : 'You are a strict tutor. Always output valid JSON only, no markdown.'
            },
            { role: 'user', content: event.prompt || '' }
          ],
          temperature: 0.2
        }, wantText ? {} : { response_format: { type: 'json_object' } })),
        signal: controller.signal
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);
      /* ★ 这里**不再**提前 clearTimeout：响应体可能一直不来，
         而"拿到响应头"不等于"拿到结果"。定时器统一在 finally 里清。 */
      const json = await res.json();
      const content = json.choices && json.choices[0] && json.choices[0].message.content;

      /* ★ R13：两条契约各自返回**唯一确定的形状**，调用方不再猜字段。 */
      if (wantText) {
        const text = String(content == null ? '' : content).replace(/^```[a-z]*\n?|```$/g, '').trim();
        if (!text) throw new Error('empty text content');
        failCount = 0;
        await finishAttempt(attemptId, 'ok');
        return { code: 0, text };
      }

      const parsed = JSON.parse(content);

      failCount = 0; // 成功，重置
      await finishAttempt(attemptId, 'ok'); // 配额在调用前已预留，这里只回填结果
      return { code: 0, data: parsed };
    } catch (e) {
      // 失败详情只写日志，不返回给调用方
      console.error('[aiProxy] upstream error:', e && e.message);
    } finally {
      clearTimeout(timer);   // ★ R15：无论成败都清理，不再泄漏定时器
    }
  }

  /* ★ R12：配额已在调用前预留，所以"上游报错 / 响应格式错"这些
     已经花掉 token 的调用**照样计费**，不再有"解析失败就不计数"的口子。 */
  await finishAttempt(attemptId, 'error');

  failCount++;
  if (failCount >= FAIL_WINDOW) {
    coolDownUntil = now + COOL_DOWN_MS;
    failCount = 0;
  }

  // 只返回泛化错误：不透传上游响应体/密钥状态，也不回显 lastErr 细节
  return { code: 500, msg: 'AI 服务暂时不可用', fallback: event.fallback || null };
};

// 北京时间日期字符串 YYYY-MM-DD
function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ============================================================
   计数键：**确定性** `_id`（R12）
   ------------------------------------------------------------
   原来靠 where({openid,date}).limit(1).get() 再 add —— 首次并发调用会
   同时查不到，于是各自 add 一条，同一天出现多份记录，配额被按份数放大。
   改用确定性主键后，"同一个计数"只可能有一个文档，并发 add 也只会有一个成功。
   ============================================================ */
function userKey(openid, date) { return 'q_' + openid + '_' + date; }
function rateKey(openid, ts) { return 'r_' + openid + '_' + Math.floor(ts / RATE_WINDOW_MS); }
function globalKey(date) { return 'g_' + date; }

/* 原子预留一格额度。
   返回：'ok'（已预留）/ 'exhausted'（已到上限）/ 'error'（计数不可用，调用方必须拒绝）。

   关键在 where 里带上 `count < limit`：判定与自增必须是**同一个**数据库操作，
   否则并发请求会各自读到同一个旧值、各自放行 —— 那就是 R12 的复现条件。
   仅把 `count: count+1` 换成 `_.inc(1)` 是不够的：自增原子了，
   "检查后调用"的窗口还在。 */
async function reserve(collection, key, limit, base) {
  if (!(limit > 0)) return 'exhausted';
  const guard = { _id: key, count: _.lt(limit) };
  const bump = { data: { count: _.inc(1), lastTs: db.serverDate() } };

  try {
    const res = await db.collection(collection).where(guard).update(bump);
    if (res && res.stats && res.stats.updated > 0) return 'ok';
  } catch (e) {
    console.error('[aiProxy] 配额预留失败（update）', collection, e && e.message);
    return 'error';
  }

  /* updated=0：要么文档还不存在（首次调用），要么已到上限。
     用确定性 _id 建它；同一 key 的并发只会有一个 add 成功，
     其余落到重试分支，不会重复建。 */
  try {
    await db.collection(collection).add({
      data: Object.assign({ _id: key, count: 1, firstTs: db.serverDate(), lastTs: db.serverDate() }, base)
    });
    return 'ok';
  } catch (e) {
    // 建立冲突 → 说明别人刚建好。再试一次条件自增；仍不成立时要分清两件事：
    try {
      const res = await db.collection(collection).where(guard).update(bump);
      if (res && res.stats && res.stats.updated > 0) return 'ok';
    } catch (e2) {
      console.error('[aiProxy] 配额预留失败（retry）', collection, e2 && e2.message);
      return 'error';
    }
    /* 区分「真的到上限」与「计数根本没建起来」——这一步只在冷路径跑一次。
       搞混的后果是：闸门坏了却告诉用户"你今日额度用完了"，
       用户会一直等到明天，而问题其实是系统故障。 */
    try {
      await db.collection(collection).doc(key).get();
      return 'exhausted';
    } catch (e3) {
      console.error('[aiProxy] 计数文档不存在且无法创建', collection, e3 && e3.message);
      return 'error';
    }
  }
}

/* 计数不可用时的**唯一**出口：拒绝，而不是放行。
   以前三处查询都是 `.catch(() => 0)`，等于"数据库一抖，闸门就没了"。
   对成本闸门来说，少服务几次远比无界花钱便宜。 */
function gateUnavailable(event) {
  console.error('[aiProxy] 配额计数不可用，按拒绝处理（fail-closed）');
  return { code: 503, msg: 'AI 服务暂时不可用，请稍后再试', fallback: event.fallback || null };
}

/* 调用明细：先落"尝试"，结束回填结果。
   写入失败不阻塞主流程，但要留日志 —— 否则"明细少了一条"永远查不出来。 */
async function logAttempt(openid) {
  try {
    const res = await db.collection('ai_calls').add({
      data: { openid, ts: Date.now(), phase: 'pending', createTime: db.serverDate() }
    });
    return (res && res._id) || null;
  } catch (e) {
    console.warn('[aiProxy] 调用明细写入失败（不影响本次调用）:', e && e.message);
    return null;
  }
}

async function finishAttempt(id, phase) {
  if (!id) return;
  try {
    await db.collection('ai_calls').doc(id).update({
      data: { phase, doneTs: Date.now() }
    });
  } catch (e) {
    console.warn('[aiProxy] 调用明细回填失败:', e && e.message);
  }
}
