const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 学情周报订阅消息模板 ID（与 subscribeWeekly 保持一致）
const TEMPLATE_ID = process.env.WEEKLY_TEMPLATE_ID || 'REPLACE_WITH_SUBSCRIBE_TEMPLATE_ID';
// 单次最多推送人数，避免云函数超时（定时触发分批执行）
const BATCH = 100;
// 推送落地页
const PAGE = 'pages/report/report';

/**
 * 定时推送学情周报。
 * 触发方式：
 *   1) 定时触发器（config.json），每周一 09:00 执行
 *   2) 手动调用（活动预热、测试）— event.openid 可指定单个用户
 * 幂等：同一用户同一自然周只推一次（weekly_reports 唯一键 openid+weekKey）
 */
exports.main = async (event) => {
  const now = new Date();
  const weekKey = isoWeekKey(now);          // 例如 2026-W39
  const weekStart = startOfWeek(now);       // 本周一 00:00（北京时间）

  // 1) 取出待消费的订阅授权，按 openid 归并
  const where = { templateId: TEMPLATE_ID, status: 'pending' };
  if (event && event.openid) where.openid = event.openid;

  let subs = [];
  try {
    const res = await db.collection('subscriptions')
      .where(where)
      .orderBy('createTime', 'asc')
      .limit(BATCH)
      .get();
    subs = res.data;
  } catch (e) {
    // 集合不存在 → 本次无可推送
    return { code: 0, weekKey, sent: 0, skipped: 0, msg: '暂无订阅记录' };
  }

  const byUser = {};
  subs.forEach(s => {
    if (!byUser[s.openid]) byUser[s.openid] = [];
    byUser[s.openid].push(s);
  });

  const openids = Object.keys(byUser);
  if (openids.length === 0) {
    return { code: 0, weekKey, sent: 0, skipped: 0 };
  }

  let sent = 0, skipped = 0, failed = 0;
  const errors = [];

  // 2) 逐个用户生成并推送（串行 + 单条失败不中断）
  for (const openid of openids) {
    try {
      const done = await hasPushed(openid, weekKey);
      if (done) {
        skipped++;
        continue;
      }

      const report = await buildWeeklyReport(openid, weekStart, now, weekKey);

      // 落库（upsert）：即使推送失败，周报内容也保留，供报告页回看
      const reportId = await saveReport(openid, weekKey, report);

      // 发送订阅消息（一次性订阅：一次授权一条，发送成功才消耗额度）
      const sub = byUser[openid][0];
      const sendRes = await sendMessage(openid, report);

      if (sendRes.ok) {
        // 成功：消费额度 + 标记 pushed
        await db.collection('subscriptions').doc(sub._id).update({
          data: { status: 'used', usedTime: db.serverDate(), reportId }
        }).catch(() => {});
        if (reportId) {
          await db.collection('weekly_reports').doc(reportId)
            .update({ data: { pushed: true } }).catch(() => {});
        }
        sent++;
      } else {
        // 失败：额度未消耗，保留 pending 待重试；连续失败 3 次或不可重试才放弃
        const attempt = (sub.attempt || 0) + 1;
        const giveUp = !sendRes.retryable || attempt >= 3;
        await db.collection('subscriptions').doc(sub._id).update({
          data: { attempt, status: giveUp ? 'failed' : 'pending', lastError: sendRes.err }
        }).catch(() => {});
        failed++;
      }
    } catch (e) {
      failed++;
      errors.push({ openid, err: String(e) });
    }
  }

  return { code: 0, weekKey, users: openids.length, sent, failed, skipped, errors: errors.slice(0, 5) };
};

/* ------------------------- 周报内容生成 ------------------------- */

async function buildWeeklyReport(openid, weekStart, now, weekKey) {
  const [progress, wrongs, checkins, learner] = await Promise.all([
    db.collection('progress')
      .where({ openid, updateTime: _.gte(weekStart) })
      .limit(1000).get().catch(() => ({ data: [] })),
    db.collection('wrong_books')
      .where({ openid }).limit(500).get().catch(() => ({ data: [] })),
    db.collection('checkins')
      .where({ openid, createTime: _.gte(weekStart) })
      .limit(200).get().catch(() => ({ data: [] })),
    db.collection('learners').doc(openid).get().catch(() => null)
  ]);

  // 本周新学知识点
  const learnedThisWeek = progress.data.length;
  // 本周打卡天数（去重）
  const daySet = {};
  checkins.data.forEach(c => {
    const d = new Date(c.createTime);
    daySet[`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`] = true;
  });
  const studyDays = Object.keys(daySet).length;

  // 本周正确率：取 wrong_books 中本周有更新的记录
  const weekWrongs = wrongs.data.filter(w => isInWeek(w.updateTime || w.createTime, weekStart));
  const attempts = weekWrongs.reduce((s, w) => s + (w.wrongCount || 0) + (w.rightCount || 0), 0);
  const correct = weekWrongs.reduce((s, w) => s + (w.rightCount || 0), 0);
  const accuracy = attempts > 0 ? Math.round(correct / attempts * 100) : 0;

  // 待复习错题 + 薄弱点
  const pending = wrongs.data.filter(w => w.status === 'reviewing');
  const weak = buildWeak(pending);

  const level = learner && learner.data ? (learner.data.level || '') : '';
  const levelName = learner && learner.data ? (learner.data.levelName || '') : '';

  // 下周建议：优先补最薄弱的课程
  const suggestion = weak.length > 0
    ? `优先补强「${weak[0].courseName}」（${weak[0].count} 道待复习错题）`
    : (learnedThisWeek > 0 ? '本周节奏不错，继续保持每日打卡' : '本周还没开始学习，下周先定一个小目标吧');

  return {
    weekKey,
    weekStart: fmt(weekStart),
    weekEnd: fmt(now),
    learnedThisWeek,
    studyDays,
    accuracy,
    pendingWrongs: pending.length,
    level,
    levelName,
    weakTop: weak.slice(0, 3),
    suggestion,
    totalLearned: (await countLearned(openid))
  };
}

async function countLearned(openid) {
  const res = await db.collection('progress').where({ openid }).count().catch(() => ({ total: 0 }));
  return res.total || 0;
}

function buildWeak(pending) {
  const map = {};
  pending.forEach(w => {
    const cid = w.courseId || 'other';
    if (!map[cid]) map[cid] = { courseId: cid, courseName: w.courseName || cid, count: 0 };
    map[cid].count++;
  });
  return Object.values(map).sort((a, b) => b.count - a.count);
}

/* ------------------------- 订阅消息发送 ------------------------- */

async function sendMessage(openid, r) {
  // 模板未配置（占位符）→ 不可重试，直接放弃（配置模板前不浪费重试次数）
  if (!TEMPLATE_ID || TEMPLATE_ID.indexOf('REPLACE_') === 0) {
    return { ok: false, retryable: false, err: '模板未配置' };
  }
  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: TEMPLATE_ID,
      page: PAGE,
      miniprogramState: process.env.MP_STATE || 'formal',
      lang: 'zh_CN',
      // 字段名需与模板一一对应，申请模板后在「订阅消息」后台核对
      data: {
        thing1: { value: clip(r.weekKey + ' 学情周报', 20) },
        number2: { value: r.learnedThisWeek },
        number3: { value: r.studyDays },
        number4: { value: r.pendingWrongs },
        thing5: { value: clip(r.suggestion, 20) }
      }
    });
    // errCode 非 0（如 43101 用户拒收、47003 参数错误）→ 判定为不可重试的确定性失败
    if (res && res.errCode && res.errCode !== 0) {
      return { ok: false, retryable: false, err: res.errMsg || ('errCode ' + res.errCode) };
    }
    return { ok: true };
  } catch (e) {
    // 网络抖动等可重试错误
    return { ok: false, retryable: true, err: String(e) };
  }
}

/* ------------------------- 工具 ------------------------- */

// 幂等：本周已成功推送过才跳过（pushed=true 是唯一判据，失败记录不阻塞重试）
async function hasPushed(openid, weekKey) {
  const res = await db.collection('weekly_reports')
    .where({ openid, weekKey, pushed: true }).limit(1).get().catch(() => ({ data: [] }));
  return res.data.length > 0;
}

async function saveReport(openid, weekKey, report) {
  try {
    // upsert：同 openid + 同周只有一条周报，重试时不重复落库
    const exist = await db.collection('weekly_reports')
      .where({ openid, weekKey }).limit(1).get().catch(() => ({ data: [] }));
    if (exist.data && exist.data.length > 0) {
      const id = exist.data[0]._id;
      await db.collection('weekly_reports').doc(id).update({
        data: Object.assign({}, report, { openid })
      }).catch(() => {});
      return id;
    }
    const res = await db.collection('weekly_reports').add({
      data: Object.assign({}, report, { openid, pushed: false, createTime: db.serverDate() })
    });
    return res._id;
  } catch (e) {
    await db.createCollection('weekly_reports').catch(() => {});
    return '';
  }
}

function isInWeek(t, weekStart) {
  if (!t) return false;
  const d = new Date(t);
  return d.getTime() >= weekStart.getTime();
}

// 本周一 00:00（北京时间）
function startOfWeek(d) {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const day = bj.getUTCDay(); // 0=周日
  const diff = (day === 0 ? 6 : day - 1);
  const monday = new Date(bj.getTime() - diff * 86400000);
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()) - 8 * 3600 * 1000);
}

// ISO 周编号：2026-W39
function isoWeekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function fmt(d) {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}

function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
