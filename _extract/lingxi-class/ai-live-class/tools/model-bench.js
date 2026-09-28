/* ============================================================
   模型测速（需要联网）

   用法：
     node tools/model-bench.js                       # 测白名单里的模型
     node tools/model-bench.js deepseek-v4-flash ... # 测指定模型
     node tools/model-bench.js --all                 # 测目录里所有对话模型（很慢）

   它抓取 app 真实发出的请求体原样回放，因此测出来的延迟就是
   用户实际会遇到的延迟。默认模型的排序依据就来自这个脚本的输出。
   ============================================================ */
const H = require('./live-harness');

const PK_APP = () => {
  const app = require('fs').readFileSync(require('path').join(H.ROOT, 'js', 'app.js'), 'utf8');
  return (app.match(/publishableKey:\s*'([^']+)'/) || [])[1];
};

async function run(model, body) {
  const url = H.LIVE + '/.cloud/llm/chat/completions';
  const t0 = Date.now();
  let ttfContent = 0, content = '', reasoning = '', err = null, finish = '';
  const ac = new AbortController();
  const cap = setTimeout(() => ac.abort(), 300000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-wb-webapp-access-key': PK_APP() },
      body: JSON.stringify({ ...body, model }),
      signal: ac.signal,
    });
    if (!r.ok) err = 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160);
    else {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let j; try { j = JSON.parse(payload); } catch { continue; }
          if (j.error) { err = JSON.stringify(j.error).slice(0, 200); continue; }
          const d = (j.choices && j.choices[0] && j.choices[0].delta) || {};
          if (j.choices && j.choices[0] && j.choices[0].finish_reason) finish = j.choices[0].finish_reason;
          if (d.reasoning_content) reasoning += d.reasoning_content;
          if (d.content) { content += d.content; if (!ttfContent) ttfContent = Date.now() - t0; }
        }
      }
    }
  } catch (e) { err = e.name === 'AbortError' ? '超时(300s)' : e.message; }
  clearTimeout(cap);

  let jsonOk = false, slides = 0;
  try {
    const t = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    jsonOk = true; slides = (o.slides || []).length;
  } catch (_) {}
  return { model, ttfContentMs: ttfContent, totalMs: Date.now() - t0,
    reasonChars: reasoning.length, outChars: content.length, jsonOk, slides, finish, err };
}

(async () => {
  const args = process.argv.slice(2).filter((a) => a !== '--all');
  const body = await H.captureCourseRequest();
  console.log('请求体：system ' + body.messages[0].content.length + ' 字 + user ' +
    body.messages[1].content.length + ' 字，response_format=' + JSON.stringify(body.response_format) + '\n');

  let models = args;
  if (!models.length || process.argv.includes('--all')) {
    const list = await (await fetch(H.LIVE + '/.cloud/llm/models', {
      headers: { 'x-wb-webapp-access-key': PK_APP(), Accept: 'application/json' },
    })).json();
    models = (Array.isArray(list) ? list : [])
      .filter((m) => m.enabled !== false && m.disabled !== true && !/(image|embed|rerank|tts|asr)/i.test(m.id))
      .map((m) => m.id);
    if (args.length) models = args;
  }

  const rows = [];
  for (const m of models) {
    const r = await run(m, body);
    rows.push(r);
    console.log(String(r.model).padEnd(22) +
      '首字 ' + String(Math.round(r.ttfContentMs / 1000) + 's').padStart(6) +
      ' | 总 ' + String(Math.round(r.totalMs / 1000) + 's').padStart(6) +
      ' | 推理 ' + String(r.reasonChars).padStart(6) +
      ' | 输出 ' + String(r.outChars).padStart(5) +
      ' | JSON ' + (r.jsonOk ? '✅' : '❌') + ' ' + String(r.slides).padStart(2) + '页' +
      (r.err ? ' | ' + r.err.slice(0, 70) : ''));
  }
  console.log('\n排序建议（可解析 JSON 且首字快的排前面）：');
  rows.filter((r) => r.jsonOk).sort((a, b) => a.ttfContentMs - b.ttfContentMs)
    .forEach((r) => console.log('  ' + r.model + '  ' + Math.round(r.ttfContentMs / 1000) + 's / ' + Math.round(r.totalMs / 1000) + 's'));
  rows.filter((r) => !r.jsonOk).forEach((r) => console.log('  ⛔ ' + r.model + ' 不用（' + (r.err || '输出无法解析为 JSON，可能被输出上限截断') + '）'));
})();
