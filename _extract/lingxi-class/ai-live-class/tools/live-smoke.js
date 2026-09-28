/* ============================================================
   真实云端冒烟测试（需要联网）

   用法：
     node tools/live-smoke.js           # 带残留失效会话，跑一次完整「生成课程」
     node tools/live-smoke.js --slow    # 故意用最慢的模型，验证首字超时自动换模型
     node tools/live-smoke.js --clean   # 不种残留会话（干净访客）

   它验证的是回归测试验证不了的东西：真实云端 + 真实 SDK 下，
   页面能不能在合理时间内真的把课生成出来。
   ============================================================ */
const H = require('./live-harness');

const args = process.argv.slice(2);
const SLOW = args.includes('--slow');
const CLEAN = args.includes('--clean');

let pass = 0, fail = 0;
const t = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

(async () => {
  console.log(SLOW ? '\n=== 模式：首字超时自动换模型 ===' : '\n=== 模式：真实云端冒烟 ===');

  // 先看网络，再看应用：这里挂了就说明是环境问题，跟代码无关
  const pf = await H.preflight();
  console.log('  网络预检: ' + (pf.ok ? '正常' : '失败') + '（' + pf.ms + 'ms' + (pf.reason ? '，' + pf.reason : '') + '）');
  if (!pf.ok) {
    console.log('\n  ⚠️ 连不上云端（' + pf.reason + '），本次冒烟无法进行。');
    console.log('     这是环境/网络问题，不是应用缺陷 —— 回归测试仍可运行：node tests/run-all.js');
    process.exit(2);
  }

  const { W, errors } = await H.open({ staleSession: !CLEAN, waitMs: 3000 });

  const status = () => W.document.getElementById('ai-status').textContent;
  console.log('  状态条:', JSON.stringify(status()));
  console.log('  已选模型:', W.state.model && W.state.model.id, '| 目录', (W.state.models || []).length, '个');
  const pk = (require('fs').readFileSync(require('path').join(H.ROOT, 'js', 'app.js'), 'utf8')
    .match(/publishableKey:\s*'([^']+)'/) || [])[1];
  if (!CLEAN) console.log('  残留会话已被清理:', W.localStorage.getItem('workbuddy-cloud.session.' + pk) === null);

  t(/已就绪/.test(status()), 'AI 状态为「已就绪」');
  t(!!W.state.model, '选中了可用模型');
  t(W.state.model && W.MODEL_PREFERENCE.indexOf(W.state.model.id) >= 0, '默认落在实测白名单模型上（' + (W.state.model && W.state.model.id) + '）');
  if (!CLEAN) t(W.localStorage.getItem('workbuddy-cloud.session.' + pk) === null, '残留失效会话被清掉（不会永久 401）');
  t(/^\d+$/.test(String((W.eval('1+1')))), 'jsdom 沙箱正常');

  if (SLOW) {
    /* 手工把模型换成实测最慢的那个，验证「首字不来就换模型」 */
    W.setModel('glm-5.3-flash');
    const body = await H.captureCourseRequest();
    console.log('  起始模型:', W.state.model.id, '（实测首字 121s）');
    const t0 = Date.now();
    let notice = null;
    let out = '', err = null;
    try {
      out = await W.streamChat({
        messages: body.messages, temperature: 0.7, responseFormat: true,
        firstContentBudget: 15000,
        onNotice: (m) => { notice = m; },
      });
    } catch (e) { err = (e && e.message) + ' | ' + W.errCode(e); }
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log('  耗时:', secs + 's | 结束模型:', W.state.model.id);
    console.log('  提示:', notice);
    t(!err, '没有抛错（err=' + err + '）');
    t(!!notice && notice.indexOf('太慢') >= 0, '给出了"已自动切换模型"的提示');
    t(W.state.model.id !== 'glm-5.3-flash', '确实换掉了慢模型');
    t(secs < 90, '总耗时 ' + secs + 's < 90s（没有让用户干等两分半）');
    t((out || '').length > 500, '拿到了有效输出（' + (out || '').length + ' 字符）');
  } else {
    const goal = W.document.getElementById('gen-goal');
    if (goal) goal.value = '讲清楚一元二次方程的求根公式怎么来的';
    const t0 = Date.now();
    W.document.getElementById('btn-generate').click();
    const deadline = Date.now() + 210000;
    let firstTextAt = 0;
    while (Date.now() < deadline && !W.__lastGenerated) {
      const el = W.document.getElementById('gen-stream-text');
      if (!firstTextAt && el && (el.textContent || '').trim().length > 0) firstTextAt = Date.now() - t0;
      await new Promise((r) => setTimeout(r, 500));
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    const c = W.__lastGenerated;
    console.log('    首字延迟:', firstTextAt ? Math.round(firstTextAt / 1000) + 's' : '未观察到流式输出');
    t(!!c, '在 ' + secs + 's 内生成了课程');
    if (c) {
      console.log('    标题:', c.title);
      console.log('    环节 ' + (c.outline && c.outline.stages || []).length +
        ' | 知识点 ' + (c.outline && c.outline.knowledgePoints || []).length +
        ' | 课件 ' + (c.slides || []).length + ' 页（含 ' +
        (c.slides || []).filter((s) => s.type === 'quiz').length + ' 道练习）');
      t((c.slides || []).length >= 7, '课件至少 7 页');
      t((c.slides || []).filter((s) => s.type === 'quiz').length >= 2, '至少 2 道随堂练习（带解析）');
      t(!!(c.outline && c.outline.knowledgePoints && c.outline.knowledgePoints.length), '解析出知识点');
      /* 耗时判定要看网络脸色：同一个接口实测在 3.5s ~ 13s 之间跳，
         写死 60s/90s 只会得到一个"一会儿红一会儿绿"的假警报。
         预检耗时当作网络基线，按比例放宽；真正的红线是 180s（用户真的会以为挂了）。 */
      const budget = Math.max(90, Math.round(pf.ms / 1000) * 8);
      if (secs > 180) t(false, '耗时 ' + secs + 's，超过 180s 红线');
      else if (secs > budget) t(true, '耗时 ' + secs + 's 未超 180s 红线（当前网络偏慢：预检 ' +
        Math.round(pf.ms / 1000) + 's，基线预算 ' + budget + 's）');
      else t(true, '耗时 ' + secs + 's ≤ 预算 ' + budget + 's（预检基线 ' + Math.round(pf.ms / 1000) + 's）');
    } else {
      const el = W.document.getElementById('gen-stream-text');
      console.log('    页面提示:', (el ? el.textContent : '').slice(0, 300));
    }
  }

  const real = errors.filter((e) => !/Not implemented/.test(e));
  t(real.length === 0, '没有未捕获的控制台错误' + (real.length ? '：' + real[0].slice(0, 200) : ''));

  console.log('\n  pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('SMOKE_ERROR ' + (e && e.stack || e)); process.exit(1); });
