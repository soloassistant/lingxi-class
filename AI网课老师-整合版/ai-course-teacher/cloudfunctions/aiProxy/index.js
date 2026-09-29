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

  // 单用户频率限制（分钟级），防脚本刷
  const recent = await getRecentCount(OPENID, now - RATE_WINDOW_MS);
  if (recent >= RATE_MAX) {
    return { code: 429, msg: '操作过于频繁，请稍后再试', fallback: event.fallback || null };
  }

  // 单用户每日配额
  const used = await getTodayCount(OPENID);
  if (used >= DAILY_QUOTA) {
    return { code: 429, msg: '今日 AI 使用次数已达上限，请明天再来', fallback: event.fallback || null };
  }

  // 全局每日上限：即使有人批量注册账号，也封顶在预算内
  const globalUsed = await getGlobalTodayCount();
  if (globalUsed >= DAILY_GLOBAL_QUOTA) {
    return { code: 429, msg: '今日 AI 服务已达全站上限，请明天再来', fallback: event.fallback || null };
  }

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
        body: JSON.stringify({
          model: models[i],
          messages: [
            { role: 'system', content: 'You are a strict tutor. Always output valid JSON only, no markdown.' },
            { role: 'user', content: event.prompt || '' }
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);
      /* ★ 这里**不再**提前 clearTimeout：响应体可能一直不来，
         而"拿到响应头"不等于"拿到结果"。定时器统一在 finally 里清。 */
      const json = await res.json();
      const content = json.choices && json.choices[0] && json.choices[0].message.content;
      const parsed = JSON.parse(content);

      failCount = 0; // 成功，重置
      await incrementCount(OPENID); // 记录用量（失败不阻塞返回）
      return { code: 0, data: parsed };
    } catch (e) {
      // 失败详情只写日志，不返回给调用方
      console.error('[aiProxy] upstream error:', e && e.message);
    } finally {
      clearTimeout(timer);   // ★ R15：无论成败都清理，不再泄漏定时器
    }
  }

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

// 单用户近 N 秒调用次数（分钟级频控）
async function getRecentCount(openid, sinceTs) {
  if (!openid) return 0;
  const res = await db.collection('ai_calls')
    .where({ openid, ts: _.gte(sinceTs) })
    .count()
    .catch(() => ({ total: 0 }));
  return res.total || 0;
}

// 全局今日调用量（预算封顶）
async function getGlobalTodayCount() {
  const res = await db.collection('ai_usage_global')
    .where({ date: todayStr() })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  return res.data.length > 0 ? (res.data[0].count || 0) : 0;
}

async function incrementGlobalCount() {
  const today = todayStr();
  const res = await db.collection('ai_usage_global')
    .where({ date: today })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  if (res.data.length > 0) {
    await db.collection('ai_usage_global').doc(res.data[0]._id).update({
      data: { count: (res.data[0].count || 0) + 1, lastTs: db.serverDate() }
    }).catch(() => {});
  } else {
    await db.collection('ai_usage_global').add({
      data: { date: today, count: 1, lastTs: db.serverDate() }
    }).catch(() => {});
  }
}

// 记录一次调用明细（用于分钟级频控统计）
async function logCall(openid) {
  if (!openid) return;
  await db.collection('ai_calls').add({
    data: { openid, ts: Date.now(), createTime: db.serverDate() }
  }).catch(() => {});
}

async function getTodayCount(openid) {
  if (!openid) return 0;
  const res = await db.collection('ai_quota')
    .where({ openid, date: todayStr() })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  return res.data.length > 0 ? (res.data[0].count || 0) : 0;
}

async function incrementCount(openid) {
  if (!openid) return;
  const today = todayStr();
  // 说明：此处为「读-改-写」自增，极端并发下可能少计 1 次。
  // 这是有意的取舍——频控/配额是「防御性上限」，少计意味着放行更多而非误拦，
  // 属于 fail-open，不影响安全；且单用户单设备场景并发极低。
  // 若需严格精确计数，可改用服务端事务或 `_.inc()` 原子自增。
  const res = await db.collection('ai_quota')
    .where({ openid, date: today })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  if (res.data.length > 0) {
    const doc = res.data[0];
    await db.collection('ai_quota').doc(doc._id).update({
      data: { count: (doc.count || 0) + 1, lastTs: db.serverDate() }
    }).catch(() => {});
  } else {
    await db.collection('ai_quota').add({
      data: { openid, date: today, count: 1, lastTs: db.serverDate() }
    }).catch(() => {});
  }
  // 同步全局计数 + 调用明细
  await Promise.all([incrementGlobalCount(), logCall(openid)]);
}
