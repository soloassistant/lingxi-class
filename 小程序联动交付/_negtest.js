/* 负向测试：故意破坏交付文档，确认核验脚本真的会失败（不是恒真）。
 *
 * 为什么要有这个文件：核验脚本的价值全在「能失败」上。
 * 我自己的核验脚本已经退化过两次（见 核验文档.js [5] 的注释），
 * 每次都是靠这里抓回来的 —— 所以它比核验脚本本身更不该被删。
 *
 * 用法：node _negtest.js
 * 退出码：0 = 每组破坏都被抓到；1 = 有漏检或无效用例
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const Module = require('module')

const SRC = __dirname
const SPEC = '灵犀课堂小程序-联动开发规格书.md'
const APPA = '附录A-接口契约与参考实现.md'

/* ★ 替换源必须逐字来自文档，否则用例无效（本文件就栽过一次：
   'FEYNTALK_MIN_CHARS = 60' 在规格书里不存在，实际写法在附录A 第 795 行）。
   加用例时请先 grep 确认 from 字符串确实存在。 */
const CASES = [
  // —— 费曼门槛：同一常量在文档里出现 4 处，任一处的值被改都应被抓到 ——
  { name: 'MIN_CHARS 门槛表格 60→70（速查区/常量处仍是 60）', file: SPEC, from: '| `MIN_CHARS` | 60 |', to: '| `MIN_CHARS` | 70 |' },
  { name: 'MIN_CHARS 速查区 60→70（表格/常量处仍是 60）', file: SPEC, from: 'MIN_CHARS=60', to: 'MIN_CHARS=70' },
  { name: 'MIN_CHARS 源码常量行 60→70（其余三处仍是 60）', file: APPA, from: 'const MIN_CHARS = 60', to: 'const MIN_CHARS = 70' },
  { name: 'MIN_CHARS 常量名说明 60→70（其余三处仍是 60）', file: APPA, from: '`FEYNTALK_MIN_CHARS = 60`', to: '`FEYNTALK_MIN_CHARS = 70`' },
  { name: 'MIN_TURNS 表格 2→3', file: SPEC, from: '| `MIN_TURNS` | 2 |', to: '| `MIN_TURNS` | 3 |' },
  { name: "role 口径 user→student", file: SPEC, from: "role === 'user'", to: "role === 'student'", all: true },
  // —— 数据模型 ——
  { name: 'confidence 客户端兜底 0.7 抹掉', file: SPEC, from: '兜底 `0.7`', to: '同列默认' },
  { name: '埋点列 props 改名成 payload', file: SPEC, from: '| `props` | jsonb | 事件参数 |', to: '| `payload` | jsonb | 事件参数 |' },
  { name: '埋点列 name 改名成 event', file: SPEC, from: '| `name` | text | 事件名 |', to: '| `event` | text | 事件名 |' },
  // —— 身份与通路（改一位就应报错）——
  { name: 'publishableKey 改一位', file: SPEC, from: 'wbpk_Pq3DhJIr74vvC8YpuqkMPA', to: 'wbpk_Pq3DhJIr74vvC8YpuqkMPX', all: true },
  { name: '联动网关域名换成别的域名', file: SPEC, from: 'mp-api.app.workbuddy.host', to: 'wrong-host.example.com', all: true },
  { name: '网关域名换成同后缀的越界子域', file: SPEC, from: 'mp-api.app.workbuddy.host', to: 'evil-api.app.workbuddy.host', all: true },
  // —— 埋点 ——
  { name: '白名单删一个事件名', file: SPEC, from: '`bank_split`', to: '' },
  { name: '守卫行为从「告警」改成「丢弃」', file: SPEC, from: '告警', to: '丢弃', all: true },
  { name: '守卫的 console.warn 抹掉', file: SPEC, from: 'console.warn', to: 'console.info', all: true },
  { name: 'props 限制（slice(0, 8)）抹掉', file: SPEC, from: 'slice(0, 8)', to: '取前若干', all: true },
  // —— 同步协议（附录A 仍有同样措辞，专门测「只改一个文件」的跨文件漏检）——
  { name: '先推后拉顺序说明抹掉', file: SPEC, from: '先推后拉', to: '按序处理', all: true },
  { name: '墓碑说明抹掉', file: SPEC, from: '墓碑', to: '删除标记', all: true },
  { name: '账号命名空间隔离说明抹掉', file: SPEC, from: '命名空间', to: '账号归属', all: true },
  // —— 服务端承载的如实说明（最容易被「优化」掉的一段）——
  { name: '能力边界表把「无云函数」改成「有」', file: SPEC, from: '服务端代码 | ❌ **没有**', to: '服务端代码 | ✅ 有' },
  { name: 'pg_net 能力边界说明抹掉', file: SPEC, from: 'pg_net', to: '网络扩展', all: true },
  { name: '「出路 A/B」的出路抹掉', file: SPEC, from: '出路', to: '建议', all: true },
]

const mdFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.md'))

/* ★ 为什么不用 spawnSync 跑子进程：
   本机沙箱下 node 拉起任何子进程都返回 EBUSY（连系统 node、shell:true 也一样），
   于是「基线退出码 = null」被误读成「基线没过」，整个负向测试变成假绿。
   改成**进程内执行**：把 核验文档.js 当函数体编译，注入它用到的 __dirname / process.exit / console。
   这样零子进程，沙箱内外行为一致，也不再需要 cwd 这种隐式依赖。 */
function runVerify(dir) {
  const file = path.join(dir, '核验文档.js')
  const code = fs.readFileSync(file, 'utf8')
  const m = new Module(file, null)
  m.filename = file
  m.paths = Module._nodeModulePaths(dir)

  let out = ''
  const fakeConsole = { log: (...a) => { out += a.join(' ') + '\n' }, warn: () => {}, error: () => {} }
  const fakeProcess = {
    argv: [process.execPath, file],
    env: process.env,
    exit(c) { const e = new Error('__EXIT__'); e.__exitCode = c; throw e },
  }

  let fn
  try {
    fn = new Function('exports', 'require', 'module', '__filename', '__dirname', 'process', 'console', code)
  } catch (e) {
    return { code: null, out, err: new Error('核验文档.js 语法错误：' + e.message) }
  }

  try {
    fn(m.exports, Module.createRequire(file), m, file, dir, fakeProcess, fakeConsole)
    return { code: 0, out }                       // 脚本没调用 exit → 默认 0
  } catch (e) {
    if (e && e.__exitCode !== undefined) return { code: e.__exitCode, out }
    return { code: null, out, err: e }            // 真崩了，与「退出码 1」区分开
  }
}

function stage(dir) {
  fs.mkdirSync(dir)
  mdFiles.forEach((f) => fs.copyFileSync(path.join(SRC, f), path.join(dir, f)))
  fs.copyFileSync(path.join(SRC, '核验文档.js'), path.join(dir, '核验文档.js'))
}

/* ★ 基线的退出码必须是 0。若拿到 null，说明核验脚本自身抛异常崩了 ——
   这时**不能**当成「基线没过」，更不能当成「破坏被抓到」，否则整个负向测试变假绿。 */
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'neg-'))

console.log('基线检查...')
const baseDir = path.join(TMP_ROOT, 'baseline')
stage(baseDir)
const base = runVerify(baseDir)
if (base.code === 0) {
  console.log('  基线退出码 = 0  ✅ 全绿（可开始破坏）')
} else {
  console.log('  基线退出码 = ' + base.code)
  if (base.err) console.log('  异常: ' + base.err.message)
  if (base.code === null) {
    console.log('  ⚠️ 核验脚本自己崩了 —— 这是脚手架/脚本问题，不是文档问题。')
    console.log('     下面的「抓到」结果不可信，先修这个。')
  } else {
    console.log('  ⚠️ 基线就没过，先修文档：')
    console.log(base.out.split('\n').filter((l) => l.includes('FAIL')).map((l) => '     ' + l.trim()).join('\n'))
  }
  console.log('\n临时目录：' + TMP_ROOT)
  process.exit(2)
}

console.log('\n逐个破坏：')
let caught = 0
const missed = []
const noop = []

CASES.forEach((c, i) => {
  const dir = path.join(TMP_ROOT, 'case' + i)
  stage(dir)

  const p = path.join(dir, c.file)
  let text = fs.readFileSync(p, 'utf8')
  if (!text.includes(c.from)) {
    noop.push(c.name + '（替换源在 ' + c.file + ' 里不存在，用例无效）')
    console.log('  ⚪ 无效  ' + c.name)
    return
  }
  text = c.all ? text.split(c.from).join(c.to) : text.replace(c.from, c.to)
  fs.writeFileSync(p, text)

  const r = runVerify(dir)
  const fails = r.out.match(/FAIL .*/g) || []

  if (r.code === null) {
    missed.push(c.name + '（核验脚本崩溃，无法判定）')
    console.log('  ❓ 无法判定  ' + c.name + '（' + (r.err && r.err.message) + '）')
    return
  }
  if (r.code !== 0) {
    caught++
    console.log('  ✅ 抓到  ' + c.name)
    fails.slice(0, 2).forEach((f) => console.log('         ' + f.trim().slice(0, 100)))
  } else {
    missed.push(c.name)
    console.log('  ❌ 漏掉  ' + c.name)
  }
})

console.log('\n==========================================')
console.log('破坏 ' + CASES.length + ' 组：抓到 ' + caught + '，漏掉 ' + missed.length + '，无效 ' + noop.length)
if (noop.length) {
  console.log('\n无效用例（请修正替换源或删除）：')
  noop.forEach((n) => console.log('  ' + n))
}
if (missed.length) {
  console.log('\n漏检（核验脚本没覆盖到，需补断言）：')
  missed.forEach((n) => console.log('  ' + n))
}
console.log('\n临时目录：' + TMP_ROOT)
process.exit(missed.length === 0 && noop.length === 0 ? 0 : 1)
