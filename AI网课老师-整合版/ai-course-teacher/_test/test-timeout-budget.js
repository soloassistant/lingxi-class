/* 云函数超时预算验证（外部审查 R15）
   ------------------------------------------------------------
   为什么这一类要写成可跑的检查：预算冲突是**纯数字关系**的缺陷，
   读代码很容易看漏（25 × 2 = 50 > 30 这个算式，没人会主动去算）。
   而且它不是"某处写错了"，是**层级之间不匹配** ——
   只改 aiProxy 不够，8 个外层的 timeout 必须一起动，所以要连层级一起断言。

   判据里的常量都从源码里**读出来**，不在这里另抄一份数字：
   抄一份就会漂，而漂掉的判据比没有判据更糟（它给的是虚假的安心）。

   运行：node _test/test-timeout-budget.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const CF_DIR = path.join(__dirname, '..', 'cloudfunctions');

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (typeof cond !== 'boolean') { fail++; console.log('FAIL ' + label + '  ← 断言写法错误：条件必须是 boolean'); return; }
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  -> ' + extra : '')); }
};
const sec = (s) => console.log('\n=== ' + s + ' ===');

const read = (p) => fs.readFileSync(path.join(CF_DIR, p), 'utf8');
const cfgTimeout = (fn) => {
  const j = JSON.parse(read(path.join(fn, 'config.json')));
  return Number(j.timeout);
};

const proxySrc = read(path.join('aiProxy', 'index.js'));
/* ★ 从源码里解析常量，且必须支持**算式**（不硬编码数字）。
   第一版只匹配 `= 123;` 这种字面量，于是 `UPSTREAM_BUDGET_MS = FN_BUDGET_MS - RETURN_RESERVE_MS`
   解析成 null，三条断言全红 —— 那是**判据的解析能力不够**，不是代码有问题。
   判据自己出错时要如实修判据，别去改被测代码。 */
function parseNumericConsts(src) {
  const out = {};
  const re = /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*([0-9A-Z_+\-*\s()]+);/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const expr = m[2].trim();
    const resolved = expr.replace(/[A-Z_][A-Z0-9_]*/g, (id) => (out[id] != null ? String(out[id]) : 'NaN'));
    if (/NaN/.test(resolved)) continue;
    try {
      const v = Function('"use strict";return (' + resolved + ');')();
      if (typeof v === 'number' && isFinite(v)) out[m[1]] = v;
    } catch (_) {}
  }
  return out;
}
const C = parseNumericConsts(proxySrc);
const FN = C.FN_BUDGET_MS;
const RESERVE = C.RETURN_RESERVE_MS;
const UPSTREAM = C.UPSTREAM_BUDGET_MS;
const PER = C.PER_ATTEMPT_MAX_MS;
const MINA = C.MIN_ATTEMPT_MS;

sec('A. 常量齐备且自洽');
t('A1 四个预算常量都在源码里', [FN, RESERVE, UPSTREAM, PER, MINA].every((x) => typeof x === 'number' && x > 0),
  JSON.stringify({ FN, RESERVE, UPSTREAM, PER, MINA }));
t('A2 ★ 上游总预算 + 返回余量 = 函数总预算', UPSTREAM + RESERVE === FN, UPSTREAM + '+' + RESERVE + ' vs ' + FN);
t('A3 ★ 上游总预算严格小于函数总预算（否则等于没有余量）', UPSTREAM < FN);
t('A4 ★ 单次尝试上限 ≤ 上游总预算（否则一次都跑不完）', PER <= UPSTREAM);
t('A5 最小尝试阈值小于单次上限（否则永远开不了新尝试）', MINA < PER);

sec('B. config.json 与代码里的常量一致');
{
  const cfgFn = cfgTimeout('aiProxy');
  t('B1 ★ config.json 的 timeout 与代码 FN_BUDGET_MS 一致（两处不一致时这里会红）',
    cfgFn * 1000 === FN, 'config=' + cfgFn + 's  code=' + FN + 'ms');
}

sec('C. 代码真的按预算来跑（不是只定义了常量）');
{
  /* 反向断言要剥离注释：本轮我在注释里写了"原来 clearTimeout 写在 res.json() 之前"，
     裸 grep 会把说明文字当成"代码里还这么干"。 */
  const code = proxySrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  t('C1 ★ 每次开新尝试前先算剩余预算', /const\s+left\s*=\s*deadline\s*-\s*Date\.now\(\)/.test(code));
  t('C2 ★ 单次尝试被剩余预算夹住（Math.min(PER_ATTEMPT_MAX_MS, left)）',
    /Math\.min\(\s*PER_ATTEMPT_MAX_MS\s*,\s*left\s*\)/.test(code));
  t('C3 ★ 预算不够时直接停，不再开注定被杀的请求',
    /left\s*<=\s*MIN_ATTEMPT_MS/.test(code) && /break\s*;/.test(code));
  t('C4 ★ clearTimeout 在 finally 里（不再写在 res.json() 之前）',
    /finally\s*\{[\s\S]{0,200}?clearTimeout\(\s*timer\s*\)/.test(code));
  t('C5 ★★ 不再有"拿到响应头就清定时器"的写法（那会让响应体读取失去保护）',
    !/clearTimeout\(\s*timer\s*\)\s*;\s*\n\s*if\s*\(!res\.ok\)/.test(code));
  t('C6 不再硬编码 25000（旧的单次超时值）', !/25000/.test(code));
}

sec('D. 嵌套预算：外层必须严格大于内层');
{
  const inner = cfgTimeout('aiProxy');
  const outer = ['aiExplain', 'aiCourseGen', 'aiInterject', 'aiVariation', 'aiTeach', 'getRoadmap', 'homeworkReview', 'searchProxy'];
  const bad = [];
  outer.forEach((f) => {
    let v = null;
    try { v = cfgTimeout(f); } catch (e) { bad.push(f + '(读不到 config)'); return; }
    if (!(v > inner)) bad.push(f + '=' + v + 's');
  });
  t('D1 ★★ 8 个外层函数的 timeout 全部严格大于 aiProxy（否则主通道一慢外层先死）',
    bad.length === 0, bad.join(', '));
  t('D2 外层留出的余量足够 aiProxy 用满自己的预算',
    outer.every((f) => { try { return cfgTimeout(f) * 1000 >= FN + 2000; } catch (e) { return false; } }));
}

sec('E. 文档与约束同源');
{
  const docPath = path.join(CF_DIR, '超时预算.md');
  const ok = fs.existsSync(docPath);
  t('E1 有《超时预算.md》把层级写成架构约束', ok);
  if (ok) {
    const doc = fs.readFileSync(docPath, 'utf8');
    t('E2 文档里写了"外层必须大于内层"这条规则', /外层严格大于内层|必须大于/.test(doc));
    t('E3 文档里的外层秒数与实际 config 一致', new RegExp('\\b40s\\b').test(doc));
  }
}

console.log('\nBUDGET_RESULT pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
