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
function fallbackRoadmap(totalDays) {  totalDays = Math.max(1, totalDays || 90);
  return [
    { stage: '基础巩固', days: '第 1-' + Math.floor(totalDays * 0.25) + ' 天', status: 'current' },
    { stage: '核心突破', days: '第 ' + (Math.floor(totalDays * 0.25) + 1) + '-' + Math.floor(totalDays * 0.5) + ' 天', status: '' },
    { stage: '强化练习', days: '第 ' + (Math.floor(totalDays * 0.5) + 1) + '-' + Math.floor(totalDays * 0.75) + ' 天', status: '' },
    { stage: '模考冲刺', days: '第 ' + (Math.floor(totalDays * 0.75) + 1) + '-' + totalDays + ' 天', status: '' }
  ];
}

/* ★ R16（2026-09-29）：等级是**按课程**定的，这里不能再笼统地说"当前等级"。
   courseId 的第一段就是 systemId（ielts_listening → ielts），已核对全部 22 门课都成立。
   最近一次测评如果不在本体系内，就如实说明"本体系尚无测评" ——
   否则规划模型会按另一个体系的水平来定这份规划的难度。 */
function levelLine(goal) {
  if (!goal) return '当前等级=未定级';
  const courseId = goal.lastLevelCourseId || '';
  const levelName = goal.lastLevelName || goal.lastLevel || '';
  if (!levelName) return '当前等级=未定级';
  const courseName = goal.lastLevelCourseName || courseId || '';
  const sys = courseId ? String(courseId).split('_')[0] : '';
  if (goal.system && sys && sys === goal.system) {
    return '当前等级（' + courseName + '）=' + levelName;
  }
  return '本体系尚无测评，最近一次测评在「' + (courseName || '其他课程') + '」=' + levelName;
}

/* 体系 → 该体系下的第一门课（兜底任务需要一个**真实存在**的 courseId）。
   原兜底写的是 goal.system —— 那是体系 id（ielts），不是课程 id（ielts_listening），
   点进去打不开任何知识点；'ielts_b1' 更是根本不存在。 */
const SYSTEM_FIRST_COURSE = {
  ielts: 'ielts_listening',
  toefl: 'toefl_b2',
  sat: 'sat_math',
  igcse: 'igcse_math',
  alevel: 'alevel_pure3',
  ap: 'ap_calc',
  ib: 'ib_math_aa'
};
const DEFAULT_COURSE = 'alevel_pure3';

function firstCourseOf(goal) {
  if (!goal || !goal.system) return DEFAULT_COURSE;
  return SYSTEM_FIRST_COURSE[goal.system] || DEFAULT_COURSE;
}

/* 复习任务想指向"最薄弱的那门课"，但 courseId 的权威清单在小程序包里
   （miniprogram/data/courses.js），云函数这边没有，所以只能做两道它能做的检查：
     ① 形状必须是 <system>_<内容>（22 门课全部满足，且与 data.systems 的 id 一致）；
     ② 体系必须和本次规划一致（错体系的课不该出现在这份规划里）。
   不满足就退回本体系的第一门课 —— 宁可用一门确定打得开的课，
   也不要给学生一个点不开的死链（老实现把体系 id 当课程 id 传，就是死链）。
   注：这是**形状校验**，不是成员校验；真要严格化，得把课程注册表下发给云函数。 */
function safeCourseId(candidate, goal) {
  if (!candidate || typeof candidate !== 'string') return '';
  const m = /^([a-z]+)_([a-z0-9]+)$/.exec(candidate);
  if (!m) return '';
  if (goal && goal.system && m[1] !== goal.system) return '';
  return candidate;
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
      '；' + levelLine(goal) +
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
    // ★ R16 连带修：courseId 必须是真实课程 id，否则点进去打不开任何知识点
    const c = firstCourseOf(goal);
    const weakCourse = safeCourseId(weakPoints.length ? weakPoints[0].courseId : '', goal);
    todayTasks = [
      { id: 't1', title: '完成 1 个知识点', courseId: c },
      { id: 't2', title: '做随堂测验', courseId: c },
      { id: 't3', title: '复习 1 道错题', courseId: weakCourse || c }
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
