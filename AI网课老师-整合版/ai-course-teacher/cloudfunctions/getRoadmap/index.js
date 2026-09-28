const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// 兜底路线图（AI 不可用 / 未设目标时使用）
function fallbackRoadmap(totalDays) {
  totalDays = Math.max(1, totalDays || 90);
  return [
    { stage: '基础巩固', days: '第 1-' + Math.floor(totalDays * 0.25) + ' 天', status: 'current' },
    { stage: '核心突破', days: '第 ' + (Math.floor(totalDays * 0.25) + 1) + '-' + Math.floor(totalDays * 0.5) + ' 天', status: '' },
    { stage: '强化练习', days: '第 ' + (Math.floor(totalDays * 0.5) + 1) + '-' + Math.floor(totalDays * 0.75) + ' 天', status: '' },
    { stage: '模考冲刺', days: '第 ' + (Math.floor(totalDays * 0.75) + 1) + '-' + totalDays + ' 天', status: '' }
  ];
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();

  const learner = await db.collection('learners').doc(OPENID).get().catch(() => null);
  const goal = learner ? learner.data : null;

  // 待复习错题 → 薄弱点（供 AI 规划与兜底共用）
  let weakPoints = [];
  if (goal) {
    const wrongs = await db.collection('wrong_books')
      .where({ openid: OPENID, status: 'reviewing' })
      .limit(100).get().catch(() => ({ data: [] }));
    const map = {};
    wrongs.data.forEach(w => {
      const cid = w.courseId || '其他';
      if (!map[cid]) map[cid] = { courseId: cid, courseName: w.courseName || cid, count: 0 };
      map[cid].count++;
    });
    weakPoints = Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5);
  }

  const examDate = goal && goal.examDate
    ? new Date(goal.examDate)
    : new Date(Date.now() + 90 * 86400000);
  const totalDays = Math.max(1, Math.ceil((examDate - new Date()) / (1000 * 60 * 60 * 24)));
  const examDateStr = formatDate(examDate);

  // 未登录 / 无 OPENID → 直接兜底（前端 getRoadmap 仅在登录态调用，这里兜底防裸调）
  if (!OPENID) {
    return { code: 0, data: { examDate: examDateStr, todayTasks: [], weekPlan: [], roadmap: fallbackRoadmap(totalDays), weakPoints: [], suggestion: '', aiGenerated: false } };
  }

  // ===== AI 生成个性化路线图（失败静默回退到硬编码兜底）=====
  let ai = null;
  try {
    const prompt =
      '你是国际课程学习规划师。请为学生生成一份备考学习规划，严格返回 JSON，只含字段：' +
      '{"roadmap":[{"stage":"阶段名","days":"第X-Y天","focus":"本阶段重点"}],' +
      '"todayTasks":[{"title":"今日任务","reason":"为什么"}],' +
      '"suggestion":"给这位学生的总体建议（不超过80字）"}。' +
      '背景：体系=' + (goal ? (goal.system || '未设定') : '未设定') +
      '；科目=' + (goal ? (goal.subject || '未设定') : '') +
      '；距考试=' + totalDays + '天' +
      '；目标分=' + (goal ? (goal.targetScore || '未设定') : '') +
      '；当前等级=' + (goal ? (goal.levelName || goal.level || '未定级') : '未定级') +
      '；薄弱课程=' + (weakPoints.map(w => w.courseName + '(' + w.count + '道错题)').join('、') || '暂无') +
      '。要求：roadmap 4 个阶段（基础巩固→核心突破→强化练习→模考冲刺），天数要覆盖全部' + totalDays + '天且连续不重叠；' +
      'todayTasks 给 3 条具体可执行的任务；建议要结合薄弱课程。';

    ai = await cloud.callFunction({ name: 'aiProxy', data: { prompt } });
  } catch (e) {
    ai = null;
  }

  let roadmap = fallbackRoadmap(totalDays);
  let todayTasks = [];
  let suggestion = '';
  let aiGenerated = false;

  if (ai && ai.result && ai.result.code === 0 && ai.result.data) {
    const d = ai.result.data;
    // 校验 roadmap 结构合法才采用，否则回退
    if (Array.isArray(d.roadmap) && d.roadmap.length >= 2 && d.roadmap.every(s => s && s.stage)) {
      roadmap = d.roadmap.map((s, i) => ({
        stage: s.stage,
        days: s.days || '',
        focus: s.focus || '',
        status: i === 0 ? 'current' : ''
      }));
      aiGenerated = true;
    }
    if (Array.isArray(d.todayTasks) && d.todayTasks.length > 0) {
      todayTasks = d.todayTasks.slice(0, 3).map((t, i) => ({
        id: 'ai_t' + (i + 1),
        title: (typeof t === 'string' ? t : t.title) || '',
        reason: (typeof t === 'object' && t.reason) || ''
      }));
    }
    if (typeof d.suggestion === 'string' && d.suggestion) {
      suggestion = d.suggestion;
    }
  }

  // 兜底今日任务（AI 未给出时）
  if (todayTasks.length === 0) {
    todayTasks = [
      { id: 't1', title: '完成 1 个知识点', courseId: goal ? goal.system : 'ielts_b1' },
      { id: 't2', title: '做随堂测验', courseId: goal ? goal.system : 'alevel_pure3' },
      { id: 't3', title: '复习 1 道错题', courseId: goal ? goal.system : 'ap_calc' }
    ];
  }

  return {
    code: 0,
    data: {
      examDate: examDateStr,
      todayTasks,
      weekPlan: [],
      roadmap,
      weakPoints,
      suggestion,
      aiGenerated
    }
  };
};
