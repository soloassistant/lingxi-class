/* 交付文档事实核验
 *
 * ★ 本脚本必须能独立运行 —— 它就是上一版翻车的地方：
 *   上一版第 6-8 行硬编码了 ../_extract/.../js/app.js（网页版源码），
 *   该文件不在交付包里，脚本第 8 行就 ENOENT 崩掉，等于从未真正执行过。
 *   所以现在把真值内置成快照，仅在有源码时才做源码比对。
 *
 * 用法：
 *   node 核验文档.js                        # 用内置真值快照校验（零外部依赖）
 *   node 核验文档.js --source <app.js路径>   # 用真实源码校验，并报告快照是否过期
 *   LINGXI_APP_JS=<路径> node 核验文档.js    # 同上，用环境变量
 *
 * 退出码：0 = 全部通过；1 = 有失败项
 */
const fs = require('fs')
const path = require('path')

const DIR = __dirname

/* ─────────────────────────────────────────────────────────────
   内置真值快照
   来源：网页版 js/app.js（2026-10-05 线上版本，679650 字节）
   ───────────────────────────────────────────────────────────── */
const SNAPSHOT = {
  publishableKey: 'wbpk_Pq3DhJIr74vvC8YpuqkMPA_lgoEQ7iPSjSnnQx9ZsLOpjoB6dFoKCSh',
  feynman: { MIN_TURNS: 2, MIN_CHARS: 60, roleKey: 'user' },
  factKinds: ['weak', 'strength', 'preference', 'progress', 'misconception', 'context'],
  rpcs: ['phone_claim', 'device_taken', 'device_claim'],
  confidence: { dbDefault: 0.6, clientFallback: 0.7 },
  // 41 个（已排除只出现在注释里的 quiz_answer）
  trackEvents: [
    'course_generate', 'diag_generate', 'diag_complete', 'class_start', 'interrupt_ask', 'live_ask',
    'class_end', 'summary_view', 'flashcard_open', 'replay_play', 'ai_correction',
    'phone_register', 'device_conflict', 'phone_gate', 'mail_blocked', 'phone_shared',
    'teach_lang', 'session_expired', 'storage_full', 'tts_unavailable', 'memory_write_failed',
    'outline_parse_failed', 'boot_slow', 'tts_voice_stale', 'tts_utterance_stuck',
    'tts_gesture_retry', 'tts_selfcheck_start', 'tts_selfcheck_result', 'figure_backfill',
    'parent_report_open', 'parent_report_copy', 'parent_report_image', 'paper_official_open',
    'paper_practice_gen', 'own_paper_extract', 'own_paper_run', 'bank_split', 'bank_export',
    'progress_export', 'progress_import', 'signout_server_failed',
  ],
  tables: ['courses', 'student_profiles', 'student_facts', 'student_sessions',
    'analytics_events', 'device_ledger', 'phone_ledger'],
  paths: [
    '/.cloud/auth/v1/verification', '/.cloud/auth/v1/signin', '/.cloud/auth/v1/signup',
    '/.cloud/auth/v1/verification/verify', '/.cloud/auth/v1/user/me', '/.cloud/auth/v1/user/signout',
    '/.cloud/auth/v1/login-wechat', '/.cloud/database/rest', '/.cloud/llm/models',
    '/.cloud/llm/chat/completions',
  ],
  endpoints: [
    'https://mp-api.app.workbuddy.host',
    'https://mp-api.app-staging.workbuddy.host',
    'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host',
  ],
}

/* ── 可选：从真实源码重新提取真值，确认快照未过期 ── */
function readSource() {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--source')
  const p = i >= 0 ? argv[i + 1] : process.env.LINGXI_APP_JS
  if (!p) return null
  if (!fs.existsSync(p)) {
    console.log('！--source 指定的文件不存在：' + p + '（改用内置快照）\n')
    return null
  }
  return fs.readFileSync(p, 'utf8')
}

function extractFrom(src) {
  const out = {}
  out.publishableKey = (src.match(/publishableKey:\s*'([^']+)'/) || [])[1]
  out.feynman = {
    MIN_TURNS: Number((src.match(/FEYNTALK_MIN_TURNS\s*=\s*(\d+)/) || [])[1]),
    MIN_CHARS: Number((src.match(/FEYNTALK_MIN_CHARS\s*=\s*(\d+)/) || [])[1]),
    roleKey: (src.match(/m\.role\s*===\s*'(\w+)'/) || [])[1],
  }
  const tk = src.match(/const TRACK_EVENTS = \[([\s\S]*?)\];/)
  if (tk) {
    // 先去掉注释行，避免把注释里提到的 quiz_answer 算进白名单
    const body = tk[1].split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
    out.trackEvents = [...body.matchAll(/'([a-z_0-9]+)'/g)].map(x => x[1])
  }
  const cf = src.match(/confidence:\s*typeof f\.confidence === 'number' \?\s*f\.confidence\s*:\s*([\d.]+)/)
  out.confidence = { clientFallback: cf ? Number(cf[1]) : undefined }
  return out
}

let fail = 0, pass = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')) }
}

/* ── 载入文档 ── */
const docs = fs.readdirSync(DIR).filter(f => f.endsWith('.md'))
  .map(f => [f, fs.readFileSync(path.join(DIR, f), 'utf8')])
if (!docs.length) { console.log('目录下没有 .md 文档'); process.exit(1) }
const all = docs.map(d => d[1]).join('\n')

/* ★ 为什么还要按文件索引：
   只在「所有文档拼接后」的文本上断言，会漏掉「破坏只改了其中一个文件」的情况 ——
   另一个文件里同样的词仍然满足断言，于是破坏逃过检测。
   这是负向测试实测抓到的（改主规格书的「先推后拉」，附录A 里还剩一处，断言照样通过）。
   所以有唯一权威出处的事实，一律锚定到那份文件。 */
const fileOf = Object.fromEntries(docs)
const SPEC = '灵犀课堂小程序-联动开发规格书.md'
const APPA = '附录A-接口契约与参考实现.md'
const spec = fileOf[SPEC] || ''
const appa = fileOf[APPA] || ''

console.log('核验目标：' + docs.map(d => d[0]).join('、') + '\n')

/* ── [0] 快照新鲜度（可选） ── */
const srcText = readSource()
if (srcText) {
  console.log('[0] 与真实源码比对（确认内置快照未过期）')
  const real = extractFrom(srcText)
  check('publishableKey 一致', real.publishableKey === SNAPSHOT.publishableKey,
    real.publishableKey ? '源码=' + real.publishableKey : '未能从源码提取')
  check('费曼门槛一致',
    real.feynman.MIN_TURNS === SNAPSHOT.feynman.MIN_TURNS &&
    real.feynman.MIN_CHARS === SNAPSHOT.feynman.MIN_CHARS,
    JSON.stringify(real.feynman))
  check('role 口径一致', real.feynman.roleKey === SNAPSHOT.feynman.roleKey, '源码=' + real.feynman.roleKey)
  check('confidence 客户端兜底一致',
    real.confidence.clientFallback === SNAPSHOT.confidence.clientFallback,
    '源码=' + real.confidence.clientFallback)
  if (real.trackEvents) {
    check('TRACK_EVENTS 条数一致（快照 ' + SNAPSHOT.trackEvents.length + '）',
      real.trackEvents.length === SNAPSHOT.trackEvents.length, '源码=' + real.trackEvents.length + ' 条')
    const diff = real.trackEvents.filter(x => !SNAPSHOT.trackEvents.includes(x))
    check('快照无遗漏事件名', diff.length === 0, diff.join(', '))
  }
  console.log('')
} else {
  console.log('[0] 使用内置真值快照（未提供 --source，跳过源码比对）\n')
}

/* ── [1] key ── */
console.log('[1] publishableKey')
const keyBad = []
docs.forEach(([f, s]) => (s.match(/wbpk_[A-Za-z0-9_]+/g) || [])
  .forEach(k => { if (k !== SNAPSHOT.publishableKey) keyBad.push(f + ': ' + k) }))
check('文档中的 key 全部与真值一致', keyBad.length === 0, keyBad.join(' | '))
check('小程序联动必须用的网关域名已写明', all.includes('mp-api.app.workbuddy.host'))

/* ── [2] 域名 ──
   ★ 原版只扫 workbuddy.host 结尾的 URL，于是「把网关域名改成别的域名」时
     那个域名压根不进集合 ⇒ 没有任何断言被触发 ⇒ 破坏逃过检测（负向测试实测）。
     现在扫出**所有**主机并要求全部在允许集内。 */
console.log('\n[2] endpoint 域名')
const HOST_ALLOW = new Set([
  ...SNAPSHOT.endpoints.map(u => u.replace(/^https?:\/\//, '')),
  'evil.example.com', // §1.2 演示「带错误 Origin → 403」用的反例域名
])
const hosts = new Set()
docs.forEach(([, s]) => (s.match(/https?:\/\/[a-zA-Z0-9._-]+/g) || [])
  .forEach(u => hosts.add(u.replace(/^https?:\/\//, ''))))
const badHosts = [...hosts].filter(h => !HOST_ALLOW.has(h)).sort()
check('文档中出现的所有主机都在允许集内（实测 ' + hosts.size + ' 个）',
  hosts.size > 0 && badHosts.length === 0, '越界: ' + badHosts.join(', '))
SNAPSHOT.endpoints.forEach(e => {
  const h = e.replace(/^https?:\/\//, '')
  check('真值域名已覆盖: ' + h, hosts.has(h))
})

/* ── [3] 表与列 ── */
console.log('\n[3] 表名与列名')
SNAPSHOT.tables.forEach(t => check('表被提到: ' + t, all.includes(t)))
/* ★ 原版把「列名对不对」写成 /analytics_events[^\n]*\b(payload|event)\b/ —— 
   要求两个词出现在同一行，实际上几乎不可能触发，等于恒真。
   改成贴着表定义行本身校验：name 是 text、props 是 jsonb，且没有 payload/event 列。 */
check('埋点列名是 `name` / `props`（行级校验，未被改名成 `event` / `payload`）',
  /\|\s*`name`\s*\|\s*text\s*\|/.test(all) &&
  /\|\s*`props`\s*\|\s*jsonb\s*\|/.test(all) &&
  !/\|\s*`(payload|event)`\s*\|/.test(all))
check('写明「不是 event / payload」的告诫', /不是.*`event`.*`payload`|不是.*`payload`/.test(all))

/* ── [4] RPC ── */
console.log('\n[4] RPC 函数名')
SNAPSHOT.rpcs.forEach(fn => check('rpc ' + fn + ' 已在文档中说明', all.includes(fn)))

/* ── [5] 费曼 ──
   ★ 断言设计要点（负向测试实测踩到过两次，别再退化）：
     ① 不能用 all.includes('60') —— 60 这种数字文档里到处都是，断言恒真；
     ② 也不能只查「存在一处正确」—— 同一个常量在文档里出现多次（表格 / 常量名 / 速查区），
        只改其中一处时，剩下那处仍会让断言通过。所以这里**扫出所有出现处的取值，要求全部一致**。
        这样既能抓「值写错」，也能抓「文档自相矛盾」。 */
function collectValues(text, re) {
  const vals = []
  let m
  const r = new RegExp(re.source, 'g')
  while ((m = r.exec(text))) vals.push(Number(m[1]))
  return vals
}

console.log('\n[5] 费曼门槛与口径')
const turnsVals = collectValues(all, /MIN_TURNS[`\s]*[=:|]\s*(\d+)/)
const charsVals = collectValues(all, /MIN_CHARS[`\s]*[=:|]\s*(\d+)/)
check('MIN_TURNS 出现 ' + turnsVals.length + ' 处，取值全为 2',
  turnsVals.length > 0 && turnsVals.every(v => v === 2), '实际取值: [' + turnsVals.join(', ') + ']')
check('MIN_CHARS 出现 ' + charsVals.length + ' 处，取值全为 60',
  charsVals.length > 0 && charsVals.every(v => v === 60), '实际取值: [' + charsVals.join(', ') + ']')
check("role 口径写对（'user' 而非 'student'）", /role\s*===\s*'user'/.test(all))
check("role 口径没写错成 'student'", !/role\s*===\s*'student'/.test(all))
check('字数口径写明「去掉空白」', /去掉.*空白|去空白/.test(all))
check('门槛用 && 而非 ||', /(&&|\*\*且\*\*|两项都要满足)/.test(all))

/* ── [6] kind ── */
console.log('\n[6] student_facts.kind 取值')
SNAPSHOT.factKinds.forEach(k => check('kind ' + k + ' 已列出', all.includes('`' + k + '`')))

/* ── [7] 埋点白名单（本轮新增核验项） ──
   锚定到主规格书 §7.1：白名单表只应写在这里，在拼接文本上查会漏检。 */
console.log('\n[7] 埋点白名单完整性（TRACK_EVENTS）')
const missing = SNAPSHOT.trackEvents.filter(n => !spec.includes(n))
check('41 个白名单事件名全部出现在主规格书 §7.1', missing.length === 0,
  '缺失 ' + missing.length + ' 个: ' + missing.join(', '))
check('写明白名单守卫的存在', /TRACK_EVENTS/.test(spec) && /白名单/.test(spec))
check('写明守卫会告警（不是无声丢弃）', /告警/.test(spec) && /console\.warn/.test(spec))
check('写明登录前事件走本地队列补报', /trackLater|flushPendingTracks/.test(spec))
check('写明 props 的 8 key / 300 字符限制', /slice\(0, 8\)/.test(spec) && /300/.test(spec))

/* ── [8] 数据模型细节（本轮新增核验项） ── */
console.log('\n[8] 数据模型细节')
// 同样要贴着字段名取值，避免 0.6 / 0.7 在文档他处出现导致断言恒真
check('confidence 双默认值（DB ' + SNAPSHOT.confidence.dbDefault +
  ' / 客户端 ' + SNAPSHOT.confidence.clientFallback + '）在同一行写明',
  /`confidence`[^\n]*0\.6[^\n]*0\.7/.test(all))
check('normalizeCourse 的元素类型 filter 已写明',
  /filter/.test(all) && /只保留|只留/.test(all))

/* ── [9] 关键路径 ── */
console.log('\n[9] 关键接口路径')
SNAPSHOT.paths.forEach(p => check('路径已覆盖: ' + p, all.includes(p)))

/* ── [10] 同步协议（锚定主规格书 §6）──
   ★ 断言别写太松：`/命名空间|账号前缀/` 这种 OR，破坏掉「命名空间」后
     同段另一处的「账号前缀」照样命中，破坏逃过检测（负向测试实测）。 */
console.log('\n[10] 同步协议')
check('写明先推后拉', /先推后拉|先推.*再拉/.test(spec))
check('写明墓碑', spec.includes('墓碑'))
check('写明账号命名空间隔离', /命名空间/.test(spec) && /账号前缀/.test(spec))

/* ── [11] 服务端承载如实说明（本轮新增核验项，锚定主规格书 §10.5）── */
console.log('\n[11] 费曼服务端承载的如实说明')
check('写明平台无自定义云函数 / 服务端代码（能力边界表标 ❌）',
  /自定义函数[^\n]*服务端代码[^\n]*❌/.test(spec) || /无自定义云函数/.test(spec))
check('写明数据库无 pg_net / http，RPC 发不出 HTTP', /pg_net/.test(spec))
/* 同上：「出路」与「未完成」必须同时存在，不能只留一个就算过。 */
check('给出两条出路，且要求未落地时如实标记未完成',
  /出路\s*[AB]/.test(spec) && /未完成/.test(spec))

/* ── [12] 登录方式 ── */
console.log('\n[12] 登录方式')
check('明确手机号 + 验证码为主登录方式', spec.includes('手机号') && spec.includes('验证码'))
check('写明微信登录不可用及其原因', /微信.*(不可用|用不了|做不到|未授权|走不通)/.test(spec))

console.log('\n==========================================')
console.log(fail === 0 ? ('全部通过：' + pass + ' 项，0 失败') : (pass + ' 项通过，' + fail + ' 项失败'))
process.exit(fail === 0 ? 0 : 1)
