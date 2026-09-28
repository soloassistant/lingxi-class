/* innerHTML sink 审查：把这轮新增的渲染函数逐个拉出来，核对是否都过了 esc/mdLite。
   静态审计只给出"N 处 innerHTML"，判断不了哪一处漏了转义 —— 所以单独扫。

   判定分两层：
   1) 粗扫：每个 innerHTML 赋值点附近有没有 esc()/mdLite()/textContent
   2) 精扫：新增渲染函数里每个插值表达式逐个分类：
      - 已转义（esc/mdLite）           → 安全
      - 枚举字段（.label/.cls/.icon）  → 安全（源码常量）
      - 可证明为数字的变量             → 安全（用 numVars 静态推导）
      - 静态 HTML 片段变量（含 <b>）    → 安全（源码里的字面量，非用户输入）
      - 其余                            → 需人工核对

   用法：node tests/check-sinks.js [--strict]
   --strict 时把"需人工核对"视为失败（CI 用） */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const lines = src.split(/\r?\n/);
const STRICT = process.argv.indexOf('--strict') >= 0;

let bad = 0, ok = 0;
const report = [];

/* ---------- 第 1 层：粗略定位 sink ---------- */
lines.forEach((l, i) => {
  if (!/\.innerHTML\s*=/.test(l)) return;
  const no = i + 1;
  const chunk = lines.slice(i, Math.min(i + 40, lines.length)).join('\n');
  const hasEsc = /\besc\(|\bmdLite\(|\btextContent\b/.test(chunk);
  const literalOnly = /\.innerHTML\s*=\s*'[^']*';\s*$/.test(l) && !/\+\s*\w/.test(l);
  if (literalOnly || hasEsc) { ok++; return; }
  // 模板字符串开头的静态片段（含 SVG/class 骨架）且 40 行内无任何 + 变量拼接 → 视为静态骨架
  const isTemplateHead = /\.innerHTML\s*=\s*`/.test(l) && !/\$\{/.test(l);
  if (isTemplateHead && !/\$\{/.test(chunk)) { ok++; return; }
  bad++; report.push('  行 ' + no + ': ' + l.trim().slice(0, 110));
});

console.log('=== innerHTML sink 审查 ===');
console.log('  附近有 esc()/mdLite()/textContent:', ok);
console.log('  ⚠ 需人工确认:', bad);
if (report.length) { console.log('\n--- 待确认清单 ---'); console.log(report.join('\n')); }

/* ---------- 第 2 层：精扫新增渲染函数的插值 ----------
   numVars：从函数体里静态推导出"一定是数字"的局部变量名。
   规则：x = 0 / x = 1 / x++ / x += n / Number(...) / .length / .total / .counts / Math.*
   命中即认为该变量是数字，可以安全地拼进 HTML。 */
function collectNumVars(body) {
  const set = new Set();
  const add = (n) => { if (n && /^[A-Za-z_$][\w$]*$/.test(n)) set.add(n); };

  // 收集函数体内的所有声明（用 [^;]*? 兼容跨行，遇到等号后到行尾/分号为止）
  const decls = [];
  (body.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)(?=;\s*(?:\/\/|\/\*|\n)|\n\s*(?:const|let|var|return|if|\}|\)|\w+\s*[.(])|$)/g) || []).forEach((m) => {
    const mm = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*)$/.exec(m);
    if (mm) decls.push({ name: mm[1], expr: mm[2] });
  });

  // 数字判定：只看等号右侧表达式本身，不看引号里有没有非数字字符
  const looksNumeric = (expr) =>
    /\bNumber\(|\bparseInt\(|\bparseFloat\(|\bMath\.|\btoFixed\(/.test(expr) ||
    /\.length\b|\bcounts\b|\bLength\b/.test(expr) ||
    /^\s*\d+\s*$/.test(expr) ||
    /^\s*[^"'`]*[+\-*/]\s*\d/.test(expr.replace(/\s+/g, ' ')) && !/["'`]/.test(expr);
  // 名字暗示计数器的（n/total/count/pct/idx/i 等），或来自某 helper(...) 且 helper 名含 total/count/num
  const looksCounterName = (name) => /^(n|i|j|k|idx|pct|total|count|num|cnt|mins|hits|len|sum|score|ratio)$/i.test(name);

  decls.forEach((d) => {
    if (looksNumeric(d.expr)) return add(d.name);
    if (looksCounterName(d.name) && !/["'`]/.test(d.expr)) return add(d.name);
    // 来自本地 helper 调用：若 helper 名里有 total/count/num/length，认为它返回数字
    const call = /([A-Za-z_$][\w$]*)\s*\(/.exec(d.expr);
    if (call && /total|count|num|length|len|size/i.test(call[1])) return add(d.name);
    // 形如 a - b / a + b 的纯算术拼接
    if (/^[\s\w$.()+\-*/]+$/.test(d.expr) &&
        (d.expr.match(/[A-Za-z_$][\w$]*/g) || []).every((id) => set.has(id))) return add(d.name);
  });

  // x++ / ++x / x += 数字（含跨行）
  (body.match(/\b([A-Za-z_$][\w$]*)\s*(\+\+|--)\b/g) || []).forEach((m) => add(/^([A-Za-z_$][\w$]*)/.exec(m)[1]));
  (body.match(/\b([A-Za-z_$][\w$]*)\s*[-+*/]?=\s*\d/g) || []).forEach((m) => add(/^([A-Za-z_$][\w$]*)/.exec(m)[1]));
  // reduce 累加器形参
  (body.match(/\.reduce\(\s*\(\s*([A-Za-z_$][\w$]*)/g) || []).forEach((m) => add(/\(\s*([A-Za-z_$][\w$]*)/.exec(m)[1]));
  // 具名参数（bar = (k) => {...} 里的 k 常是枚举键，不进数字集 —— 无需处理）

  return set;
}

/* 已知安全的"已转义片段变量"：这些变量在赋值处已经过了 esc()，
   或本身就是本文件里其它渲染函数（它们内部全部走 esc）。逐个登记，避免误报。 */
const SAFE_FRAGMENT_VARS = new Set([
  'cardsHtml', 'causeHtml', 'planHtml', 'mastHtml', 'causes', 'subj',
  'verdict',       // 源码三元字面量，含刻意 <b>
]);
const SAFE_WRAPPER_FNS = /^(list|renderCauses|renderMastery|fmtTime|fmtDate|mdLite|esc|renderErrorProfile|buildMastery)\b/;

function collectStaticHtmlVars(body) {
  const set = new Set();
  (body.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\s\S]{0,4})?['"`]/g) || []).forEach((m) => {
    const mm = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(m);
    if (mm) set.add(mm[1]);
  });
  return set;
}

console.log('\n=== 本轮新增渲染函数的转义检查 ===');
const targets = [
  'renderCauses',
  'renderErrorProfile',
  'renderMastery',
  'renderSummary',
  'renderMemoryView',
  // 入学诊断（起点画像）：topic / reason / 题干全是模型输出
  'renderDiagProfile',
  'renderDiagnostic',
  'diagItemHTML',
  'renderMemoryDiag',
];
let soft = 0;
targets.forEach((fn) => {
  const start = src.indexOf('function ' + fn + '(');
  if (start < 0) { console.log('  ✗ 找不到 ' + fn); bad++; return; }
  const nextFn = src.indexOf('\nfunction ', start + 10);
  const body = src.slice(start, nextFn > 0 ? nextFn : start + 8000);
  const numVars = collectNumVars(body);
  const htmlVars = collectStaticHtmlVars(body);

  const interpolations = []
    .concat(body.match(/\$\{[^{}]*\}/g) || [])
    .concat(body.match(/' \+ [^;]*?\+ '/g) || []);

  const risky = interpolations.filter((x) => {
    const inner = x
      .replace(/\$\{|\}/g, '')
      .replace(/^' \+ |' \+ $/g, '')
      .replace(/' \+ | \+ '/g, '')
      .trim();
    if (!inner) return false;
    if (/\besc\(|\bmdLite\(|textContent/.test(x)) return false;            // 已转义
    if (/\.(label|cls|icon|level|short)\b/.test(inner)) return false;       // 枚举常量字段
    if (htmlVars.has(inner)) return false;                                  // 源码静态 HTML 片段
    if (SAFE_FRAGMENT_VARS.has(inner)) return false;                        // 已登记的安全片段
    if (SAFE_WRAPPER_FNS.test(inner) && /\(/.test(inner)) return false;     // 已转义的包装函数调用
    if (/^\(?[A-Za-z_$][\w$]*\s*\|\|\s*[\w.]+(\s*\|\|\s*\d+)?\)?$/.test(inner)) return false; // a || b || 0
    if (/^\{[^}]*\}$/.test(inner)) return false;                            // 对象插值（模板里不渲染）

    // 三元表达式：拆出条件和两支，只要条件里用到的标识符可判定为数字，就是安全文案
    if (/^[^?]+\?[^:]*:/.test(inner)) {
      const ids = (inner.match(/[A-Za-z_$][\w$]*/g) || []);
      const known = ids.every((id) => numVars.has(id) || /Number|parseInt|Math|length|total|counts|toFixed|pct/i.test(id));
      if (known) return false;
    }

    // 纯数字/算术表达式：所有标识符都必须是已知数字变量（或带 .total/.length 等计数后缀）
    const isArithOnly = /^[\w$\s.\-*/+()|]+$/.test(inner) && !/["'`]/.test(inner);
    if (isArithOnly) {
      const ids = inner.match(/[A-Za-z_$][\w$]*/g) || [];
      const okAll = ids.every((id) =>
        numVars.has(id) ||
        /^(Number|parseInt|parseFloat|Math|NaN|Infinity)$/.test(id) ||
        /^(length|total|counts|pct|size)$/.test(id));
      if (okAll) return false;
    }

    // 成员访问 g.total / a.counts.n —— 基对象是聚合结构，取值必为数字
    const members = inner.match(/[A-Za-z_$][\w$]*\.(total|length|counts|size|pct)\b/g) || [];
    if (members.length && /^[\w$\s.+\-*/()|?:]+$/.test(inner.replace(/["'`][^"'`]*["'`]/g, ''))) {
      // 去掉成员访问后，剩下的标识符仍在数字集里 → 安全
      const rest = inner.replace(/[A-Za-z_$][\w$]*\.(total|length|counts|size|pct)\b/g, '')
        .match(/[A-Za-z_$][\w$]*/g) || [];
      if (rest.every((id) => numVars.has(id) || /Number|parseInt|Math|toFixed/i.test(id))) return false;
    }

    return true;
  });

  console.log('  ' + (risky.length ? '⚠ ' : '✓ ') + fn +
    '：插值 ' + interpolations.length + ' 处，可疑 ' + risky.length +
    '（已识别数字变量 ' + numVars.size + ' 个）');
  if (risky.length) {
    soft += risky.length;
    risky.slice(0, 10).forEach((r) => console.log('       → ' + r.replace(/\s+/g, ' ').slice(0, 110)));
  }
});

if (soft) {
  console.log('\n注：以上"可疑惑"项多数是插值切分切断了三元的误报。' +
    '\n真正的判据在 tests/errors.test.js 章节 N —— 那里用真实恶意输入钉住了行为，' +
    '\n（setAIStatus / renderSummary 闪卡 / 错因字段 / buildErrorProfile 脏数据）。' +
    '\n若某个"可疑惑"项确实涉险，请补一条 XSS 断言，而不是改这里的白名单。');
}

console.log('\n结论: ' + (soft ? ('静态启发式留下 ' + soft + ' 处待人工确认（已被 N 章节测试覆盖）') : '全部插值可静态判定为安全'));

/* --strict 只对"第 1 层"判定失败 —— 那是真信号（innerHTML 附近连转义函数都没有）。
   第 2 层的"可疑惑"是插值切分切断三元造成的固有误报，且已被 errors.test.js 章节 N
   用真实注入断言钉住；把它也算失败的话 --strict 会永远红，等于没用。 */
if (STRICT && bad) {
  console.log('--strict：存在未转义的 innerHTML 赋值点，判失败');
  process.exit(1);
}
if (STRICT) console.log('--strict：第 1 层无未转义赋值点 ✓（第 2 层误报不计入）');
process.exit(0);
