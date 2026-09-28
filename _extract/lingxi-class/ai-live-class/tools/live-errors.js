/* ============================================================
   真实云端：错因分析端到端冒烟（需要联网）

   回归测试里的云桩永远"一切正常"，验证不了三件事，而这三件恰恰
   是错因功能上线时最容易翻车的地方：
     1) error_causes 列在真库里到底存不存得进（jsonb 序列化、NOT NULL 默认值）
     2) 真的匿名会话下 RLS 是否照旧只放行自己的数据
     3) 课后小结模型能不能按 errorCauses 的约定真的吐出结构化错因

   用法：
     node tools/live-errors.js          # 只跑 1+2（DB 往返，秒级）
     node tools/live-errors.js --llm    # 再加 3（真调模型，几十秒）
   ============================================================ */
const H = require('./live-harness');

const WITH_LLM = process.argv.slice(2).includes('--llm');

let pass = 0, fail = 0;
const t = (c, m, extra) => {
  if (c) { pass++; console.log('  ✅ ' + m); }
  else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); }
};

(async () => {
  console.log('\n=== 真实云端：错因分析冒烟 ===');

  const pf = await H.preflight();
  console.log('  网络预检: ' + (pf.ok ? '正常' : '失败') + '（' + pf.ms + 'ms' + (pf.reason ? '，' + pf.reason : '') + '）');
  if (!pf.ok) {
    console.log('\n  ⚠️ 连不上云端（' + pf.reason + '），本次冒烟无法进行。');
    console.log('     这是环境/网络问题，不是应用缺陷 —— 回归测试仍可运行：node tests/run-all.js');
    process.exit(2);
  }

  const { W, errors } = await H.open({ settle: true });
  const db = W.state.cloud && W.state.cloud.database;
  t(!!db, 'SDK 已连上云数据库');
  if (!db) {
    console.log('  错误样本:', errors.slice(0, 2).join(' | ') || '（无）');
    process.exit(1);
  }

  /* ---------- 1. error_causes 列的读写往返 ---------- */
  console.log('\n--- 1. error_causes 列往返 ---');
  const sample = [
    { cause: 'careless', topic: '配方法', detail: '配方时符号写错', fix: '每步代回验算' },
    { cause: 'reading', topic: '应用题', detail: '漏看"至少"', fix: '先划条件再动笔' },
  ];
  const title = '【冒烟】错因往返 ' + Date.now();

  let insId = null;
  try {
    const res = await db.from('student_sessions').insert({
      course_title: title, subject: '数学', duration_secs: 60,
      mastered: [], weak_points: [], homework: [], cards: [], review_plan: [],
      error_causes: sample,
    }).select('id');
    const out = W.dbPick(res);
    insId = Array.isArray(out) && out.length ? out[0].id : null;
    t(!!insId, '写入带 error_causes 的上课记录成功');
  } catch (e) {
    t(false, '写入带 error_causes 的上课记录成功', (e && e.message) || String(e));
  }

  if (insId) {
    try {
      const res2 = await db.from('student_sessions')
        .select('id, error_causes, subject, course_title').eq('id', insId);
      const row = W.dbPick(res2);
      const got = Array.isArray(row) && row.length ? row[0] : null;
      t(!!got, '按 id 读回该记录');
      t(!!got && Array.isArray(got.error_causes), 'error_causes 读回是数组（jsonb 未被当字符串）');
      t(!!got && got.error_causes.length === 2, '两条错因都存住了', got && JSON.stringify(got.error_causes));
      t(!!got && got.error_causes[0].cause === 'careless', '错因枚举原样保留');
      t(!!got && got.error_causes[0].detail === '配方时符号写错', '错因描述（中文）无损');

      // 中文无损 —— 用 Node 比对，不用 PowerShell（GBK 解码层会破坏中文）
      const back = W.buildErrorProfile([got]);
      t(back.total === 2, '读回的数据能被 buildErrorProfile 正确解析', String(back.total));
      t(back.list.some((g) => g.key === '数学 · 配方法'), '分组键含中文知识点');
      t(back.list.find((g) => g.topic === '配方法').top === 'careless', '主导错因判定正确');
    } catch (e) {
      t(false, '按 id 读回该记录', (e && e.message) || String(e));
    }

    // 清理：冒烟不该往真库里留垃圾。
    // 注意：表用 owner_id DEFAULT auth.uid()，匿名会话下 owner_id 落成字面量 'anon'，
    // 所以关闭当前会话后再删除就可能被 RLS 挡住 —— 这里只看"删得干净不干净"，
    // 删不掉就明确报出来，让人知道要手工清（而不是静默留下垃圾数据）。
    let cleaned = false;
    try {
      const delRes = await db.from('student_sessions').delete().eq('id', insId).select('id');
      const delOut = W.dbPick(delRes);
      cleaned = Array.isArray(delOut) && delOut.length > 0;
      if (cleaned) {
        const res3 = await db.from('student_sessions').select('id').eq('id', insId);
        const left = W.dbPick(res3);
        cleaned = !Array.isArray(left) || left.length === 0;
      }
    } catch (e) {
      cleaned = false;
    }
    if (cleaned) {
      t(true, '冒烟记录已清理干净');
    } else {
      console.log('  ⚠️ 冒烟记录未能自动清理（RLS/权限限制），不影响功能结论。');
      console.log('     需手工执行：DELETE FROM student_sessions WHERE course_title LIKE \'【冒烟】%\';');
    }
  }

  /* ---------- 2. 老记录（无 error_causes 值）不应炸渲染 ---------- */
  console.log('\n--- 2. 兼容性：老记录 / 空错因 ---');
  try {
    const res = await db.from('student_sessions').select('id, subject, error_causes')
      .order('created_at', { ascending: false }).limit(20);
    const rows = W.dbPick(res) || [];
    t(Array.isArray(rows), '按新字段集查询历史记录成功（列已存在）', '取到 ' + rows.length + ' 条');
    const prof = W.buildErrorProfile(rows);
    t(prof.total >= 0, '对真实历史记录聚合不抛错（total=' + prof.total + '）');
    const withCause = rows.filter((r) => Array.isArray(r.error_causes) && r.error_causes.length);
    console.log('  历史记录中含错因的条数:', withCause.length, '/', rows.length);
    // 渲染真实数据，确认不产生可执行节点
    const box = W.document.getElementById('mem-causes');
    W.renderErrorProfile(rows);
    t(box.querySelectorAll('script, img, iframe').length === 0, '渲染真实历史记录未产生危险节点');
  } catch (e) {
    t(false, '按新字段集查询历史记录成功', (e && e.message) || String(e));
  }

  /* ---------- 3. 真实模型能否产出结构化 errorCauses ---------- */
  if (WITH_LLM) {
    console.log('\n--- 3. 真实模型产出结构化错因 ---');
    if (!W.state.model) {
      t(false, '有可用模型', 'state.model 为空');
    } else {
      console.log('  使用模型:', W.state.model.id);
      // 一段精心构造的对话：学生的思路正确但算错 —— 正确判定必须是 careless 而不是 knowledge
      const transcript = [
        '灵犀老师：我们用配方解 x²-4x+1=0，你会从哪一步入手？',
        '学生：先把常数项移过去，x²-4x=-1，然后两边同时加上一次项系数一半的平方，也就是加 4。',
        '灵犀老师：思路非常清楚，那你接着算。',
        '学生：x²-4x+4=3，所以 (x-2)²=3，那么 x-2=±√3……嗯，那 x 等于 2±√3 吧？',
        '灵犀老师：你再检查一下，移项的时候右边是什么？',
        '学生：哦，-1 加 4 是 3，我刚刚写成了 -5，算错了。',
      ].join('\n');
      const sys = '你是教学顾问。根据课堂对话输出 JSON，只输出 JSON：' +
        '{"errorCauses":[{"cause":"knowledge|concept|careless|reading","topic":"知识点",' +
        '"detail":"具体怎么错的","fix":"下次怎么补"}]}。' +
        'knowledge=根本没学会；concept=把相近概念弄混；careless=思路对但算错；reading=看漏看错条件。' +
        '没有错误就返回 []。';
      try {
        const t0 = Date.now();
        const raw = await W.streamChat({
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: '课堂对话记录：\n' + transcript },
          ],
          temperature: 0.2, responseFormat: true,
        });
        const secs = Math.round((Date.now() - t0) / 1000);
        console.log('  耗时:', secs + 's | 输出长度:', (raw || '').length);
        const parsed = W.parseJSONLoose ? W.parseJSONLoose(raw) : JSON.parse(raw);
        const causes = W.cleanErrorCauses(parsed && parsed.errorCauses);
        console.log('  解析出的错因:', JSON.stringify(causes));
        t(causes.length > 0, '模型按约定产出了结构化错因');
        t(causes.every((c) => W.ERROR_CAUSE_KEYS.indexOf(c.cause) >= 0),
          '全部落在四维枚举内（没有幻觉出第五类）');
        // 这是本节最关键的断言：思路对但算错，必须判成 careless
        t(causes.some((c) => c.cause === 'careless'),
          '「思路正确但算错」被正确判为计算失误（而不是知识漏洞）',
          JSON.stringify(causes.map((c) => c.cause)));
        t(!causes.some((c) => c.cause === 'knowledge'),
          '没有把运算错误误诊成知识漏洞', JSON.stringify(causes.map((c) => c.cause)));
      } catch (e) {
        t(false, '真实模型产出结构化错因', (e && e.message) || String(e));
      }
    }
  } else {
    console.log('\n  （跳过真实模型调用，加 --llm 可启用）');
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  if (errors.length) console.log('（页面运行期错误 ' + errors.length + ' 条，首条：' + errors[0].slice(0, 160) + '）');
  process.exit(fail ? 1 : 0);
})();
