/* scripts/publish-config.js —— 发布面的**分类清单**（谁该上传、谁该被移走）

   ★ 为什么单独抽成一个模块（2026-10-09）：
     这份清单有两个消费者 —— `scripts/publish-guard.js`（执行发布护栏）
     和 `tests/publish-surface.test.js`（守住清单不被悄悄放宽）。
     抽成纯模块后两边 **require 同一份数据**：
       · 不用起子进程（本环境沙箱内 `execFileSync` 一律 EBUSY，跑不通）
       · 不用正则去解析源码（改个变量名就静默解析失败 ⇒ 返回空集合 ⇒ 断言恒真）
     这是"单一事实来源"，也顺带让测试可以安全地读它（本模块**无副作用**）。

   ===== 背景（务必理解，否则会重新泄露内容）=====
   发布目录 `_extract/lingxi-class/ai-live-class` **同时也是 git 工作区**，
   平台的部署又是「把目录里的东西全传上去」。所以：

       任何**新增**的顶层文件/目录，默认都会跟着发布被公开托管。

   这是 **fail-open** 的 —— 没有报错，只有"多公开了一个文件"。
   历史上 `_quality/`（14 个真实课件 .pptx）与 `.minprobe/`（实验脚手架）
   都差点这么漏出去。所以这里的每一条都必须想清楚再改。
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, '_extract', 'lingxi-class', 'ai-live-class');
/* 暂存区放在 .workbuddy/ 下：它是 gitignore 的，属于本机状态，不该进仓库 */
const HOLD = path.join(ROOT, '.workbuddy', 'publish-hold');
const MANIFEST = path.join(HOLD, 'MANIFEST.txt');

/* ── MOVE：发布前必须移出发布目录的"自有开发文件" ─────────────────────
   node_modules 也在内 —— 纯静态站发布时不需要它（而且它高达数百 MB）。 */
const MOVE = [
  'tests',            // 28 个测试文件：断言里写满了内部逻辑与实现细节
  'tools',            // 13 个工具脚本：含 serve.js（服务端源码）
  'sql',              // 2 个迁移：表命名与"设备台账 / 手机号台账与风控"这类业务推断
  '_quality',         // 14 个真实课件 .pptx（带 SHADOW：只移出内容，留 index.html 顶掉目录列表）
  'node_modules',
  'package.json',
  'package-lock.json',
  '_mut-check.js',    // 变异验证 harness
  '.minprobe',        // 压缩/等价性验证脚手架（含日志）
];

/* ── KEEP：必须存在、且必须留在发布目录里的运行所需文件（缺任一 ⇒ 拒绝发布）── */
const KEEP = ['index.html', 'css', 'js', 'assets', 'vendor'];

/* ── ALLOW_EXTRA：允许上传、但**不强制存在**的顶层文件（缺了不阻塞发布）────
   robots.txt / sitemap.xml 由 tools/build.js 从 indexnow 配置生成；
   .gitattributes 是仓库自带的文本规范文件，平台此前一直在服务它。 */
const ALLOW_EXTRA = ['.gitattributes', 'robots.txt', 'sitemap.xml'];

/* ── SHADOW：「影子占位」——必须**留在原地随发布一起上传**的文件 ─────────
   ★ 为什么需要它：平台是对象存储 + 静态分发，会给「没有 index.html 的目录」
     自动生成**目录列表页**。实测 `GET /_quality/` → 200 / 3347 B，
     把 14 个课件文件名全列出来了（内容已占位为 35B，但**清单**仍暴露，
     还暴露了内部命名不统一）。对象存储下无法"禁止列表"，
     唯一办法是在**原路径**放一个 index.html 把目录页顶掉。
   ★ 所以 `_quality` 不能再整个移走 —— 移走就传不上去，等于没放。
     这里的语义是：只移出该目录里**除影子文件以外**的内容。 */
const SHADOW = { '_quality': ['index.html'] };

/* ── 白名单：verify 阶段允许出现在发布目录**顶层**的集合 ────────────────
   ★ 为什么必须是白名单而不是黑名单：黑名单是 **fail-open** ——
     新增一个目录而没人记得登记，它就会跟着发布被公开托管。
     `.minprobe/` 正是这么差点漏出去的（当时 verify 只查 MOVE 残留）。
   ★ 根目录 `.txt` 例外：IndexNow 的所有权校验文件叫 `{key}.txt`，
     名字由 key 决定、写不死。**按协议的真实格式收紧**到
     `[A-Za-z0-9-]{8,128}.txt`（协议规定 key 为 8~128 位 a-zA-Z0-9-）——
     这样别的 `.txt`（如随手放的 notes.txt）仍会被拦下。
     ⚠ robots.txt 不靠这条通过，它在 ALLOW_EXTRA 里显式登记。 */
function allowedTopLevel() {
  const s = new Set([...KEEP, ...ALLOW_EXTRA, ...Object.keys(SHADOW)]);
  for (const f of fs.readdirSync(APP)) if (/^[A-Za-z0-9-]{8,128}\.txt$/.test(f)) s.add(f);
  return s;
}

module.exports = { ROOT, APP, HOLD, MANIFEST, MOVE, KEEP, ALLOW_EXTRA, SHADOW, allowedTopLevel };
