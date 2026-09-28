# 前端回归测试

用 JSDOM 在 Node 里真实加载 `index.html` + `js/app.js`，验证直播间、课件、长期记忆、
登录与合规改造的核心链路。

## 运行

```powershell
# Windows (PowerShell)
$env:NODE_PATH="C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules"
& "C:\Users\geral\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" tests\run-all.js

# 静态审计（重复 id / 失效选择器 / CSS 变量 / 死代码）
& "C:\Users\geral\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" tests\audit.js

# XSS 静态审查（CI 用 --strict，非零退出即失败）
& "C:\Users\geral\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" tests\check-sinks.js --strict
```

前置依赖：`jsdom` 已安装到 `C:\Users\geral\.workbuddy\binaries\node\workspace\node_modules`。
**`NODE_PATH` 不能省** —— 漏掉它 11 个文件会集体报 `Cannot find module 'jsdom'`，
表现为 `TOTAL pass=0 fail=0 files_failed=11`（详见第 25 条坑）。

## 怎么判断"真的全过"

**只看 `run-all.js` 最后那行 `TOTAL`。** 例：

```
TOTAL pass=889 fail=0 files=11 files_failed=0
全部测试文件通过
```

> 四个数要**一起看**：`pass` 为正、`fail=0`、`files` 与预期一致、`files_failed=0`。
> 只盯着 `fail` 会在"文件加载失败"时被骗过去（见第 25 条坑）。

不要用"数 `PASS` 字符串出现次数"来判断 —— 断言文案、表格表头里都可能出现
`PASS` / `FAIL` 字样，会把计数算歪。**曾经就因为把表头行算成一次 PASS，
而漏报了一整个失败文件**（`memory-e2e` 当时已经在报 `SMOKE_ERROR`）。
`run-all.js` 现在按「进程退出码 或 该文件自报的 fail 数」双重判定，任一异常即计入
`files_failed`，并以 `TOTAL` 行为准。

### 不进 `run-all.js` 的两个静态闸门

| 脚本 | 用途 |
| --- | --- |
| `tests/audit.js` | 重复 id、引用了不存在的 id、CSS 变量未定义、导航/视图一致、重复 function、规模与可疑模式（`console.log`/`TODO`/`innerHTML` 计数）。结果落 `tests/audit-out.txt` |
| `tests/check-sinks.js` | `innerHTML` 转义审查：第 1 层按赋值点粗筛（附近有没有 `esc()`/`mdLite()`/`textContent`）；第 2 层对新增渲染函数逐个插值分类（已转义 / 枚举字段 / 静态推导的数字变量 / 源码静态 HTML / 其余）。`--strict` **只对第 1 层判失败**（第 2 层的"可疑惑"是插值切分切断三元的固有误报，已被测试覆盖），可接 CI。**它只缩小范围，判定权在 `errors.test.js` 章节 N 的真实注入断言** |

## 用例

| 文件 | 覆盖 |
| --- | --- |
| `quiz.test.js` | 练习页渲染（题干/4选项/正确项高亮/折叠答案/解析）、开放题分支、AI 未给题时自动补题、纯大纲兜底、空题页丢弃、`teacherSystemPrompt` 题目注入、`quizCountOf` |
| `live-flow.test.js` | 进入直播间、课件上屏、参会者渲染、讲课时 busy 态（输入框可插话/按钮变"打断提问"/提示可见）、学生打断、**消息角色严格交替**、结束清理 |
| `socratic.test.js` | 苏格拉底四阶段（引出/追问/矛盾或延伸/综合）写入 prompt、反答案倾倒（最小帮助原则/两次失败才给示范/示范后复现同类题）、元认知脚手架开关、成长型思维措辞、**三档引导强度动态注入**、练习页不给选项字母、`setGuide`/`restoreGuidePref`/`toggleMeta` 持久化、引导弹窗渲染、**课后闪卡（主动回忆）+ 间隔复习计划**渲染与降级 |
| `memory.test.js` | 账号级长期记忆：未登录不注入记忆/登录后注入/记忆为空时不自称有记忆、`FACT_KINDS` 六类映射、**知识点掌握度图谱**（`buildMastery` 按 topic 聚合、最差信号胜出定级待巩固/学习中/已掌握、`renderMastery` 渲染与空态）、**学习档案页三态**（未登录 gate／加载中／有数据）、事实按 confidence 排序与删除按钮、云端写入调用形状（`saveFacts` 同批去重 + 已有条目 update 提升 confidence、`saveProfile` 累加 `sessions_count`/`total_seconds`、`saveSession`、`deleteFact` 遇 RLS 空数组返回 false）、`authErr` 语义化（`invalid_grant` → 「账号或密码不正确」，不暴露账号是否存在）、登录/登出 UI 切换与 `state.mem` 清理、注册路径识别老用户引导登录、**访客模式不伪造身份** |
| `memory-e2e.test.js` | 记忆闭环端到端（真实 DOM + 云服务桩全链路）：会话恢复 → nav 变用户 chip 并显示昵称 → `loadMemory` 拉齐画像与事实 → `memoryPromptBlock`/`teacherSystemPrompt` 注入薄弱点与使用规则 → 「学习档案」页渲染事实与删除按钮 → `persistMemoryAfterClass` 写回 session/facts 并累加画像计数（3→4 节、5400+2700 秒）→ 登出后 `state.user`/`state.mem` 清空、nav 与档案页回到登录引导 |
| `errors.test.js` | **错因分析（四维归类）**：`ERROR_CAUSES` 四类定义完整（标签/配色/"这意味着什么"/补救动作）、`other` 兜底但不进统计；`normErrorCause` 容错（英文枚举、大写空格、中文同义词"粗心/马虎/弄混/看错题/不会"、无法识别→other）；`cleanErrorCauses` 清洗（同类只留首条、无效丢弃、null 跳过、**上限四类**、`detail`/`fix` 别名与截断）；`buildErrorProfile` 跨课程聚合（按"科目·知识点"分组、同名知识点累积、缺 topic 归"未归类"、主导错因取众数且**并列时优先知识性错因**、会/不会比例、**字符串条目也识别**、脏数据不抛异常）；`renderCauses` 渲染与 **XSS 转义**（topic/detail/fix 三字段）、空清单与缺 fix 回落；`renderSummary` 接入错因区块与无错因时不渲染；`renderErrorProfile` 分布条 + **"会但没做对"vs"真不会"结论**（算错多→给验算建议、知识多→给夯实建议）；`memoryPromptBlock` 把错因交给模型并提醒"别把算错当不会讲"；`teacherSystemPrompt` 含错因诊断规则与**区分处理纪律**；`noteCauseSignals` 直播错因捕捉（四类信号、不重复累积、过短文本不判定）、`flushLiveCauses` 翻页落盘（带时间点/页码/页标题）；持久化调用形状与页面结构/CSS 四色；**N 章节：`setAIStatus`/`renderSummary` 闪卡/错因字段的真实注入断言**（非法 kind 被过滤、恶意载荷不产生 DOM 节点） |
| `diagnostic.test.js` | **入学诊断（起点画像）**：分档定义（四档含独立的「未作答」、严重度 `gap > fuzzy > ok`、题量 5-8）；`normDiagLevel` 容错（中英文、"对/会/掌握/错/不会"、识别不了→`na` 而不是瞎猜）；`judgeDiagItem`（选择题按字母比对、小写/空格容错、**空着没写 = `na` 不算错**、选择题缺答案→`fuzzy`；简答题按自评 sure/unsure/未自评三态，**"写了但不确定" ≠ "没写"**）；`buildDiagnostic` 聚合（按 topic 分组、**同一知识点取最差档**——一对一错必须判 `gap` 而不是"掌握一半"、`na` 不计入 `judged` 与 `score` 分母、未作答既不进 focus 也不进 skip、verdict 四分支、全未作答时说"无法判断"并给退路）；`buildDiagnosticPrompt` 出题要求（每题一个知识点、难度梯度、**明确不要压轴题**、干扰项真实、题量夹到 5-8、国际体系给英文术语）；`cleanDiagnostic` 清洗（补 `A.` 前缀、**"答案是 B"压成字母**、**options 为空降级为 `short`**、同 topic 最多 2 条、总题量夹到 8）；`diagnosticPromptBlock` 注入课程设计（**必须同时说"要讲什么"和"可以不讲什么"**、无诊断时返回空串）；`teacherSystemPrompt` 诊断指令（点名已掌握"不要再从零讲"、**"诊断不等于定论"**、未登录也能吃到诊断）；`persistDiagnostic` 落库（`gap`→weak 0.9 / `fuzzy`→weak 0.65 / `ok`→**strength**、"第一节课从这里开始讲"文案、context 汇总、`judged=0` 一条不写）；`renderDiagProfile`/`renderDiagnostic`/`diagItemHTML`/`renderMemoryDiag` 渲染与 **XSS 转义**（topic/题干/选项/自评全来自模型）；提交后收起答题区并渲染画像、重做按钮重置作答；含"多错几道反而是好事"的开课前降压文案；隔离性（**未做诊断时大纲/直播 prompt 都不含诊断段**、诊断与错因是两套独立数据） |
| `auth-shapes.test.js` | **会话形状契约 + 可访问性 + 移动端导航**（本文件专治"写错的形状不报错、只让登录静默失效"）：`pickUser` 对 session / `{user}` / 裸用户 / null / 无 id / `raw.phone_number` 的归一；`mergeUser` 不被降级对象覆盖；**密码登录（`data` 就是 session）后 `state.user` 不为 null**；刷新后经 `getUser` 补齐 email；无 `getUser` 时退回 `getSession`；`onSignedIn` 兜底失败不清空已有登录态；弹窗 `role=dialog`/`aria-modal`/关闭按钮 `aria-label`、Esc 关闭、讲解中 Esc 不抢打断、滚动锁开关；移动端抽屉导航（展开/收起/点击后自动关闭/视图切换/高亮同步）；**CSS 变量无未定义引用**、`[hidden]` 无重复；**DOM 无重复 id**（初始 / 全弹窗打开 / `renderPeople` 重建后）；文案与规则一致（8 位密码、注销不承诺删登录方式、隐私政策有真实权利入口） |
| `legal-phone.test.js` | **中国法律合规 + 手机号登录**：手机号面板与页签、`normalizeCNPhone` 归一化（空格/`+86`/`0086`/非法号段/位数不足）、`phoneMask` 脱敏；**告知同意闸门**（未勾选时 `requireConsent` 拦下并发提示而非静默失败、勾选后放行、同意状态可持久化与撤销）；隐私政策必备要点（收集范围/使用目的/保存期限/查阅·复制·更正·删除·注销·撤回同意/未成年人 14 周岁/援引《个人信息保护法》与《生成式人工智能服务管理暂行办法》/最小必要/不用于广告不出售）；用户协议要点（实名制·《网络安全法》/违法内容禁止/AI 内容责任/知识产权/免责/适用中国法律/法院管辖/不提供学历）；协议弹窗渲染与「同意并继续」联动勾选；**账号与个人信息面板**（手机号与邮箱均脱敏、记忆与课程数展示）；**注销流程**（删除三张表且 `eq('owner_id', 本人)`、需输入确认词、清空登录态与同意标记）；密码强度（注册与重置均 ≥8 位且含字母数字）；`smsErr` 语义化且不暴露手机号注册状态；页脚 AI 生成标识与未成年人监护人提示；**短信渠道未开通时的优雅降级**（明确告知并指引用邮箱登录，声明记忆功能一致）；合规底线（无匿名登录 / 无本地假账号 / 无 mock session / 仍走官方 SDK） |

| `ai-recovery.test.js` | **「AI 服务不可用」根因**（本文件专治"云端明明是好的、页面却永久不可用"）：`isAuthError` 边界（LLM 的 401 / auth 的 `unauthenticated` / `invalid_grant` 字符串都算，网络错误与 5xx **不算**）；**残留失效会话 → 401 → 清会话 → 匿名重试成功**（核心事故场景）；启动时 `ensureSessionHealthy` 先校验会话，清理后模型目录一次拿到（不再白跑一次 401）；会话有效时**不误登出**、网络类刷新失败**不误登出**；网络抖动靠退避重试自愈；反复失败后状态条变「AI 暂不可用 · 点此重试」且点击可恢复；`requireModel` 闸门**会等首次加载落地再判定**（实测云端冷启动要 4~5 秒，用户手快点按钮不再被当场劝退），且有等待预算上限不会卡住用户；`streamChat` 遇 401 自愈重试；纯推理模型 `reasoning_content` 经 `onReasoning` 透出（静默期有反馈，不被误判成挂了）；**默认模型不再取列表第一个**（`auto` 会路由到高档位思考模型，实测 4 分钟不吐字 → 用户看到的就是"AI 不可用"），偏好列表按实测延迟排序、并排除图像模型与输出上限过小（8k）会被截断 JSON 的模型；手选模型 `localStorage` 持久化；**首字超时 45s 自动换更快的模型重试一次**（不污染用户手选；**中止请求的两种落地方式——流"正常结束"与抛出 `terminated`——都已覆盖**，不会把英文错误甩给用户；用户主动打断 ≠ 失败）；模型下拉选择器 DOM 契约；`mapLLMError` 文案分级；状态条是 `button`+`aria-live`、`.is-retryable`/`.teach-thinking` 有样式 |

| `production.test.js` | **上线审查回归**（专治"按上线标准自查"）：① `saveCourse` 不能引用不存在的变量（历史 bug：写成未定义的 `arr`，会让「进入直播间」直接抛 `ReferenceError`，课进不了直播间）——已断言保存/更新/插入/持久化；② **XSS 防护**——把 `<img onerror>`/`<script>` 注入喂进 `slideHTML`、`renderGenCourse`、`appendMessage`（用户/老师气泡）、`renderSummary`、`renderCourses`、`renderStageList`、`errorRequestId`，断言不产生可执行节点、且 `window.__xss` 未被污染；③ **上线基线**——CSP meta 存在且 `default-src 'self'`、无 `unsafe-eval`、脚本无 `unsafe-inline`、HTML/JS 无内联事件处理器、JS 无 `eval`/`new Function`；④ **页面结构**——`section` 标签开合平衡、5 个视图都是 `<main>` 的直接子节点（学习档案曾因少一个 `</section>` 被嵌进「我的课程」里）；⑤ **导航与伪链接（CSP 兼容）**——无 `javascript:` 伪链接、有统一拦截守卫、点击导航能正常切视图；⑥ **无障碍与动效基线**——`prefers-reduced-motion` 兜底、全局 `:focus-visible`、toast `role=status`+`aria-live`、元认知开关 `role=switch`+`aria-checked`、`.tag.orange` 对比度；⑦ **密钥与凭据安全**——前端无 `sk-` 私密密钥 / `Bearer` 令牌 / `api_key`/`secret` 硬编码，唯一凭据是公开型 `wbpk_` publishableKey |

**当前状态：889 项断言全部通过**
（quiz 25 + live-flow 19 + socratic 62 + memory 104 + errors 145 + diagnostic 206 + memory-e2e 27 + auth-shapes 57 + ai-recovery 95 + legal-phone 107 + production 42），
**11 个测试文件零失败**（`run-all.js` 最后一行 `TOTAL pass=889 fail=0 files=11 files_failed=0`）。

> 跑之前记得带 `NODE_PATH`：`NODE_PATH=<node-workspace>/node_modules node tests/run-all.js`。
> 漏了它 11 个文件会集体报 `Cannot find module 'jsdom'`（看起来像"全坏了"，其实只是依赖没找到），
> 而 `TOTAL` 会显示 `pass=0 fail=0 files_failed=11` —— 注意 `fail=0` 但 `files_failed=11`，
> 这正是"只看最后一行 `TOTAL`"这条纪律要覆盖的坑：加载失败的文件一条断言都没跑，`fail` 自然是 0。

### 桩测试之外：`tools/` 里的真实云端联调

回归测试全用桩，验证不了「云端真的能跑通」。`tools/` 下三个脚本把本地页面跑在 jsdom 里、
外接 Node 的真实 fetch，在命令行里真刀真枪打一次云端：

| 工具 | 用途 |
| --- | --- |
| `tools/live-harness.js` | 脚手架：`open()` 打开页面并**等到模型目录落地**（不是等固定时长）、`preflight()` 网络预检、`captureCourseRequest()` 抓真实请求体 |
| `tools/live-smoke.js` | 真实云端冒烟：带残留失效会话完整跑一次「生成课程」，断言耗时与课件页数 |
| `tools/live-errors.js` | 错因分析真机冒烟：`error_causes` 列的真实读写往返（jsonb 是否被当字符串、中文是否无损、RLS 下的清理）、真实历史记录聚合渲染，`--llm` 再验一次模型能否按约定吐结构化错因 |
| `tools/model-bench.js` | 模型测速：回放真实请求体，量各模型首字延迟/总耗时/JSON 可解析率 —— `MODEL_PREFERENCE` 的排序依据就来自它 |

```bash
node tools/live-smoke.js          # 真实云端冒烟（需联网）
node tools/live-smoke.js --slow   # 故意用最慢模型，验证首字超时自动换模型
node tools/live-errors.js --llm   # 错因分析：DB 往返 + 真实模型判定（需联网）
node tools/model-bench.js         # 给白名单模型测速
```

**为什么值得单独存在**：「AI 服务不可用」的两大成因（残留失效会话 401、默认模型选到
长时间不吐字的思考模型）在桩测试里根本看不出来 —— 必须在真实网络下才会暴露。

### 视觉/排版验证：`tests/probe-*.js`（无头 Chrome + CDP）

模型读不了图片，所以"排版有没有问题"不能靠看截图判断，必须**落成数字**。
四个探针把页面跑在无头 Chrome 里，用 `Runtime.evaluate` 取真实布局数据：

| 探针 | 用途 |
| --- | --- |
| `probe-layout.js` | 注入一整套假记忆数据（含**故意不均匀**的起点画像事实），输出学习档案页各卡片的真实宽高、分布条宽度、溢出标志、配色值；并把入学诊断的**答题区与起点画像**都渲染出来量一遍（面板宽、每题选项宽高、四态统计块宽度、可跳过标签数） |
| `probe-skew.js` | **关键**：喂一份严重偏斜的错因数据，验证分布条真的能区分开（否则这个图就是装饰品），并断言"最宽条 = 出现最多的错因""没出现的错因整条隐藏" |
| `probe-mobile.js` | **窄屏验证**：用 `Emulation.setDeviceMetricsOverride` 跑 320/375px，量分布条的轨道宽度、检查横向溢出、列出溢出元素；**并单独量入学诊断**（选项高度是否 ≥40px 点得中、四态统计块是否 ≥56px 不被中文挤成竖排、按钮是否纵向堆叠、诊断区自身有无溢出）。窄屏下 100px 固定标签会把条形挤到不可读，这一步专门防它回归 |
| `probe-shot.js` | 截两张图（小结弹窗的错因区块、上课记录里的错因），供人眼复核 |

```bash
node tests/probe-layout.js   # 布局数值报告
node tests/probe-skew.js     # 分布条区分度验证
node tests/probe-mobile.js   # 默认 375px；也可传参：node tests/probe-mobile.js 320 640
node tests/probe-shot.js     # 截图（shot-*.png）
```

依赖：`ws`（已装在隔离工作区）+ 本地 `C:/Program Files/Google/Chrome/Application/chrome.exe`。

**两个必须知道的坑**（都真实踩过）：

1. **`/json` 里会混进扩展的 background page**。不加过滤直接连 `targets[0]`，
   可能连到 `chrome-extension://…/background.html`，在上面执行脚本会报一堆
   莫名其妙的 `TypeError: Cannot set properties of undefined`。
   必须挑 `type === 'page' && !/^(chrome|devtools|chrome-extension)/.test(url)`。
2. **量尺寸前必须先把元素显出来**。学习档案页默认是 `#view-memory { display:none }`
   + `#mem-body[hidden]`，隐藏元素的 `getBoundingClientRect()` **全是 0** ——
   会把"百分比宽度算得对不对"直接误判成"这个图是装饰品"。
   正确做法：先 `classList.add('active')` + `hidden = false`，再 `renderXxx()`，最后量。
   判断"宽度为 0"之前，先确认父链上没有人是 `display:none`。

## 测试钩子

`app.js` 末尾用 `Object.assign(window, {...})` 暴露了 `const` 声明的内部状态与函数
（`state` / `GUIDE_PROFILES` / `setGuide` / `teacherSystemPrompt` / `renderSummary` /
`memoryPromptBlock` / `loadMemory` / `pickUser` / `fetchAuthUser` / `mergeUser` /
`authErr` / `renderMemoryView` / `enhanceModalA11y` / `bindMobileNav` …），
否则 jsdom 里 `const` 不挂到 `window`，测试只能拿到 `undefined`。
函数声明（`function foo(){}`）在经典脚本里本来就是全局的，所以 `window.slideHTML` 一直可用。

## 二十五个必须知道的坑

1. **SDK 桩的 `create()` 必须是同步函数、直接返回 async generator 实例。**
   写成 `async function` 返回 `{ [Symbol.asyncIterator](){} }`，在 jsdom realm 下
   `for await` 会直接抛 `not async iterable`，导致"流瞬间结束"的假象，
   测试结果全部失真（busy 态断言会莫名失败）。

2. **测试脚本 append 进 jsdom 后，必须等 `init()` 跑完再断言。**
   `app.js` 在 `document.readyState === 'loading'` 时把初始化挂到 `DOMContentLoaded`，
   测试脚本同步读取时会拿到 `state.cloud === null` / `state.models === []`，
   产生一大批"假失败"。正确做法是在 IIFE 开头：

   ```js
   await new Promise((r) => setTimeout(r, 300));
   ```

   若后续用例临时替换了 `state.cloud.database`，记得先存下 `const realDb = W.state.cloud.database;`
   并在该段结束后还原，否则会污染后面的用例。

3. **数据库查询桩要返回 thenable，而不是裸 Promise。**
   `maybeSingle()` / `single()` 若直接 `return Promise.resolve(result)`，
   链式 `Promise.all` 就无法按 builder 形状 await。要返回同类 query 对象：

   ```js
   function makeQuery(table, result) {
     const q = {
       select() { return q; }, insert() { return q; }, update() { return q; },
       delete() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; },
       single() { return makeQuery(table, result); },
       maybeSingle() { return makeQuery(table, result); },
       then(res, rej) { return Promise.resolve(result).then(res, rej); },
       catch(rej) { return Promise.resolve(result).catch(rej); },
     };
     return q;
   }
   ```

4. **★ 云服务桩的形状必须严格对齐真实 SDK，写错不会报错、只会静默降级。**
   以下是核对 SDK 源码得到的准确契约：

   | 调用 | `.data` 的真实结构 |
   | --- | --- |
   | `cloud.llm.models.list()` | **裸数组** `[{id, name, disabled}]`，**不是** `{data, error}` |
   | `auth.getSession()` | `{ accessToken, refreshToken, expiresAt, user: { id, isAnonymous, raw } }`（**session 本身**） |
   | `auth.getUser()` | `{ id, email, phone, isAnonymous, raw }` ← **唯一**带 email/phone 的来源 |
   | `auth.signInWithPassword()` | 同上，**session 本身**；用户位于 `data.user`，**不存在 `data.session.user`** |
   | `auth.verifyOtp()` / `signUp()` | 同上，**session 本身** |
   | `auth.sendOtp()` | `{ verificationId, isExistingUser }` |
   | `auth.signInWithOtp()` | `{ verificationId, isExistingUser, isUser, verify }` |
   | `auth.resetPasswordForEmail()` | `{ updateUser({nonce, password}) }` |
   | `auth.onAuthStateChange(cb)` | 返回**退订函数**（不是 `{data:{subscription}}`），并以 `INITIAL_SESSION` 同步回调一次 |
   | `auth.signOut()` | `null` |

   两个最容易踩的：
   - 把 `signInWithPassword` 的返回写成 `{ data: { session: { user } } }` → `data.session.user`
     取到 `undefined` → `onSignedIn(null)` → **`state.user` 被清空，登录看起来完全失败**（且不报错）。
   - 只给 `getSession` 桩、不给 `getUser` → 刷新后 `state.user.email` 是 `undefined`，
     用户 chip 显示"同学"、账号面板显示"—"。`app.js` 的 `fetchAuthUser()` 会先试
     `getUser()` 再退回 `getSession()`，桩里没有 `getUser` 时会抛错后静默退回，所以不会崩，
     但会掩盖"资料不全"这个问题。

5. **桩的返回形状过窄会让测试假绿或假红。**
   - `.insert()` 的参数**既可能是单对象也可能是数组**（`saveSession` 传对象、`saveFacts` 传数组）。
     断言写死 `body[0]` 会在对象参数时炸 `Cannot read properties of undefined`。
   - 桩必须**预置"已存在的数据行"**。`student_profiles` 若给空数组，`saveProfile` 永远走
     "首次创建"分支，`sessions_count` 累加根本测不到（画像更新断言全灭）。
   - `maybeSingle()` 应从 store 里取真实行，而不要硬编码一行 —— 硬编码会让桩和真实数据形态分叉。

6. **不要用 PowerShell 的 `Get-Content -Raw` + `WriteAllText` 回写含中文的测试文件。**
   PowerShell 会按错误编码读取，中文变成乱码导致 `SyntaxError`。
   要改文件请用编辑器/Edit 工具（UTF-8）。

7. **`const` 声明在 jsdom 里不挂 `window`。**
   想在测试里读写 `state` 这类 `const`，必须先在 `app.js` 里 `Object.assign(window, {...})` 暴露。

8. **PowerShell 的 `>` 重定向会写 UTF-16**，Read 工具会报 "binary file"。
   要么 `| Out-File -Encoding utf8`，要么用
   `[System.IO.File]::WriteAllText(path, txt, [System.Text.Encoding]::UTF8)`。
   最稳的办法是让 Node 自己 `fs.writeFileSync(path, out, 'utf8')` 落盘子进程输出。

9. **读 PowerShell 回显别依赖 stdout**（本环境 stdout 中文会 GBK 乱码到不可读）。
   把结果重定向到文件再 Read。

10. **本环境的删除操作是 fail-closed 的**（`Remove-Item` 会走 OS 回收站，可能报
    `SAFE_DELETE_FAIL_CLOSED` 而中止）。清临时文件要逐个试并核对最终目录列表，
    不要假设删除成功了。

11. **涉及"必须先同意协议"的流程，测试要显式勾选同意。**
    合规改造后所有注册/登录按钮前都加了 `requireConsent()` 闸门。老用例如果直接 `click()`
    就会停在"请先同意协议"，表现成一串莫名其妙的失败。
    用例里先 `W.setConsent(false)` 断言被拦下，再 `cbox.checked = true` 走正常路径 ——
    这样既测了闸门本身，也让后续断言拿到真实结果。

12. **手机号登录的可用性取决于云端是否开通短信渠道，与代码无关。**
    SDK 侧 `sendOtp({ phone })`、`verifyOtp`、`normalizePhone`（仅 `+86 1xxxxxxxxx`）都已具备，
    但若环境未配置短信服务商，调用会返回错误。代码里用 `state.smsReady` 记录探测结果，
    失败时切到手机号页签会提示改用邮箱登录，而不是让用户反复重试。

13. **静态 HTML 与 JS 模板里可能"重复声明"同一个 id，判断时要看会不会同时存在于 DOM。**
    `renderPeople()` 用 `list.innerHTML = ...` 重建 `#people-list`，会重建
    `#p-teacher-state`/`#p-teacher-mic`/`#p-me-mic`，而 `index.html` 的静态占位行里也有这几个 id ——
    因为 `innerHTML =` 会**替换**掉静态行，所以运行时不会真的重复。
    但只要有人改成 `insertAdjacentHTML`，立刻就是真实的重复 id bug。
    用 `tests/audit.js` 看源头重复，用 `auth-shapes.test.js` 的 J1/J2/J3 断言兜住运行时唯一性。

14. **「AI 服务不可用」有两个独立成因，别只查一个。**
    （2026-09-22 线上事故复盘，两处都已修复并加了断言）

    ① **本地残留一个"还没过期但已被服务端判废"的会话。**
    SDK 只在 `expiresAt - now < 90s` 时才刷新 token；若会话未过期，
    `ensure()` 会**原样返回**，于是每个请求都带着一个废 token，
    云端持续 `401 invalid_grant`，页面永久停在「AI 暂不可用」，而且**永不自愈**
    （`isExpiring` 一直是 false，没人会去刷新）。用 curl 手测云端却是 200 —— 极易误判成"服务端挂了"。
    复现：往 `localStorage['workbuddy-cloud.session.<publishableKey>']` 塞一个
    `{accessToken:'废', refreshToken:'废', expiresAt: 未来一小时, user:{id}}` 再打开页面。
    修复：`ensureSessionHealthy()` 启动即 `getUser()` 校验（凭据被拒时 SDK 自己会清存储）+
    `isAuthError` 识别 + `healSession()` 清残留 + 匿名重试。

    ② **默认模型选了 `auto`。**
    模型目录的第一个是 `auto`，它会路由到高档位思考模型（hy4-preview，`effort: high`）。
    实测同一个"生成整节课 JSON"的请求：`deepseek-v4.1-flash` 首字 1.1s / 共 8.7s；
    `glm-5.3-flash` 首字 121s / 共 158s；`auto` **240 秒一个字都没吐**。
    用户无法区分"在深度思考"和"挂了"，看到的就是「AI 服务不可用」。
    修复：显式偏好列表（按实测延迟排）+ 排除图像模型与输出上限过小（8k 会把课件 JSON 截断）的模型 +
    首字 45s 超时自动换更快的模型重试一次 + 生成页给用户一个模型下拉框。

15. **用例里替换过 `W.WorkBuddyCloud.createWorkBuddyCloud` 或 `W.state.cloud` 之后，必须还原。**
    `ai-recovery.test.js` 的 J 段为了造 reasoning 流替换了工厂函数，
    结果 M~Q 段拿到的还是那个"永远返回固定文本"的桩，5 条断言集体失败，
    看起来像"新功能坏了"，实际是用例污染。替换完记得：
    `W.WorkBuddyCloud.createWorkBuddyCloud = () => makeCloud(stub); W.state.cloud = ...`。

16. **AI 就绪要等，不要用固定 sleep 判断；也不要同步判定"不可用"。**
    （2026-09-22 第二处修复）

    实测云端冷启动时，SDK 建会话 + 拉模型目录要 **4~5 秒**，同一接口的耗时在
    **3.5s ~ 12.7s** 之间跳，波动极大。两处踩坑：

    - **应用侧**：`requireModel()` 原来是同步判定，用户手快在这几秒里点「生成课程」
      会被当场打回「AI 服务不可用」—— 明明再等两秒就好。现在它是 `async`，
      在预算内等首次加载（或进行中的重试）落地再判定，只有真的等不到才拦。
      改完记得所有调用点都要 `await`（`generateCourse` / `enterLive+startLive` /
      `sendLive` / 课程列表里的"生成课件"回调），否则 `!requireModel()` 恒为 `false`
      （Promise 是 truthy），闸门直接失效。
    - **测试侧**：脚手架别写 `await sleep(3000)` 就去断言状态条 —— 会得到
      一个"时快时慢"的脆弱结果。用轮询等条件成立（`waitFor`），
      并且**先做网络预检**：网络不通时冒烟失败是环境的锅，不该记到应用头上。
    - 另外：给模型目录请求的 abort 超时别设太紧（已从 15s 放宽到 20s），
      否则"慢但正常"会被误判成不可用。

17. **「自己掐断一个流式请求」在 JS 里没有唯一结局，两种落地方式都要兜。**
    （2026-09-22 第三处修复）

    `streamChat` 有首字超时：45s 内一个字都没来就 abort 掉、换个更快的模型重来。
    但 abort 之后那个 async generator 的结局是**不确定的** —— 实测同一段代码：

    - 有时 `next()` 返回 `{done:true}`，流"正常结束"，走 `timedOut` 分支换模型；
    - 有时抛错，Node/undici 侧 `e.message` 就是 **`"terminated"`**。

    原来的 catch 里没有 `if (!timedOut)` 的判断，于是抛错那条路径直接 `throw e` 冒到用户面前：
    自动切换时灵时不灵，运气不好就看到「出错了：terminated」。
    `tests/ai-recovery.test.js` 的 O7~O11 就是钉住这件事（桩里 `slowAbortThrows` 可切换两种结局）。
    顺带在 `mapLLMError` 给 `terminated` / `fetch failed` / `ECONNRESET` 之类加了中文兜底文案。

    **一般化的教训**：凡是"自己主动中止异步操作"的地方，都要问一句
    "中止是会让它安静结束，还是会抛错？" —— 两个答案都要处理。

18. **上线审查要专门查"引用了不存在变量的函数"和"注入面"。**
    （2026-09-22 上线审查，`tests/production.test.js` 由此而来）

    - `saveCourse` 里曾把数组写成 `arr`（作用域里根本没有），函数整体 `ReferenceError`，
      而它正是「进入直播间 / 暂存课程」的第一步 —— **生成的课根本进不了直播间**。
      桩测试测不到它（都绕过 saveCourse），只有真去点"进入直播间"才爆。
      教训：**所有"保存/提交"路径都要有回归断言**，别只测展示路径。
    - XSS 排查别只看"有没有 esc"，要**把恶意载荷喂进去断言**：
      `slideHTML`/`renderGenCourse`/`appendMessage`/`renderSummary`/`renderCourses`/`renderStageList`
      六个注入面全部用 `<img onerror>`+`<script>` 喂了一遍，断言不产生可执行节点、
      `window.__xss` 不被污染。注意判据：转义后的文本会**合法地包含** `onerror=` 字面量，
      所以不能拿子串正则去 match，只能查真实 DOM 节点。
    - 顺手加 CSP：`default-src 'self'`、`script-src 'self' cdn.jsdelivr.net`（无 unsafe-eval/inline）、
      `connect-src` 只放云端 endpoint。前提是**零 eval、零内联脚本、零内联事件处理器**
      （唯一的 `onerror="this.style..."` 已改成 addEventListener）。

19. **给记忆加新字段时，桩测试永远绿 —— 必须真机验一次，而且要做"列还不存在"的降级。**
    （2026-09-22 加 `error_causes` 时踩到）

    记忆功能的 schema 在云端，本地看不见。加了 `error_causes`（jsonb）之后：

    - **桩测试全绿是必然的**：桩不校验列是否存在，`insert({error_causes})` 照收。
      真正会炸的是真库 —— 列不存在时 PostgREST 直接报错，而且 `saveSession` 的
      try/catch 会把它吞成一条 `console.warn`，**表现成"上课记录莫名没保存"**。
      所以：**新字段必须写进 `tools/live-errors.js` 这类真机脚本并跑一遍**。
    - **代码侧要做三重降级**（缺列时只丢增强字段，不丢整条记录）：
      ```js
      // 写入：带新列失败 → 去掉它重写
      causes.length ? insert({error_causes: causes, ...body}) : insert(body)
      // 失败时 insert(body) 重试
      // 读取：带新列查失败 → 换不带它的字段集重查
      const r = await q(full); if (r && r.error) return q(base);
      ```
      没有这层降级，一次"忘了建列"就会让**整个学习档案页空白**。
    - **建列要读 `database/management.md` 先看模式**，别凭空拼 SQL；
      `ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT '[]'::jsonb` 这样写才对老行安全。
    - **中文无损的验证不要用 PowerShell 正则**（GBK 解码层会破坏中文）。
      让 Node 读回数据、`JSON.stringify` 出来比对。
    - **真机测试别用 `select()` 取回插入行来做清理判断**：
      `student_sessions.owner_id` 的默认值是 `auth.uid()`，匿名会话下落成字面量 `'anon'`，
      会话一变就可能被 RLS 挡住。清理失败要**显式打印出需要人工执行的 SQL**，
      不要静默留下垃圾测试数据。

20. **"图表能用"必须用偏斜数据验，等分样本会骗过你。**
    （2026-09-22 做错因分布条时踩到）

    错因分布条第一版的百分比算的是**次数占比**。用"四类各一条"的样本测，
    四条都是 25%，看起来"渲染正常"。但换成真实形态的数据（6 个知识点里 5 个都是计算失误）
    就会发现这个指标本身没有教学意义 —— 同一个知识点反复算错 20 次，
    不代表它比 20 个完全不同、都没掌握的知识点更严重。

    改成 **"出现过该错因的知识点数 / 全部出错知识点数"**：衡量的是"这种毛病波及多广"，
    次数只留作括号里的参考数字。改完用 `probe-skew.js` 喂偏斜数据复验，
    得到 13% / 63% / 25%，最宽条确实落在计算失误上。

    **教训**：凡是"按比例画图"的功能，测试样本必须**故意造得不均匀** ——
    等分样本下任何实现都是"对的"，包括错的那种。同一批样本还要断言
    "数据里没出现的类别不渲染"，否则图会变成一堆等长的空条。

21. **写测试夹具时，别在页面里再 append 一个"同 id"的元素。**
    （2026-09-22 给 `setAIStatus` 补 XSS 断言时踩到）

    给 `setAIStatus` 写回归时，我 `createElement('div')` + `id='ai-status'` 再 append 进 body，
    然后断言它的 `innerHTML`。结果**断言全部失败、页面却完全正常**。

    原因：`index.html` 里**本来就有** `<button id="ai-status">`，而 `$ = (s) => document.querySelector(s)`
    取的是**第一个**匹配 —— 永远是那个真按钮。我 append 的 div 排在后面，`setAIStatus` 根本没碰它，
    于是它一直是空字符串。

    正确写法是直接取 `document.getElementById('ai-status')`（页面已有），
    并顺手加一条 `t('页面已有 #ai-status 状态条', !!statusEl)` 把"夹具前提"也钉住。

    **教训**：测试夹具要先确认"页面里已不存在同名元素"。同 id 不会报错、只会让断言**安静地测错对象** ——
    比报错难查得多。

22. **`innerHTML` 的静态审查只能"圈出可疑"，判据必须是真实注入断言。**
    （2026-09-22 加 `tests/check-sinks.js` 时确立）

    `tests/audit.js` 只会说"这里有 59 处 `innerHTML`"，分不出哪一处漏了转义。
    所以另写了 `tests/check-sinks.js`：第 1 层按赋值点附近有没有 `esc()/mdLite()/textContent` 粗筛；
    第 2 层把本轮新增渲染函数的每个插值表达式分类（已转义 / 枚举字段 / **静态推导出的数字变量** /
    源码里的静态 HTML 片段 / 其余）。

    数字推导（`collectNumVars`）是关键 —— 它能认出 `${n}`、`${pct}`、`g.total` 这类纯计数插值，
    否则每个都会误报。但它**永远会有残留**：插值切分遇到三元/多行拼接会被切断，
    于是冒出 "疑似"。这时的正确做法**不是去扩白名单**（白名单会让真正的漏洞也通过），
    而是**在 `errors.test.js` 的 N 章节补一条真实 XSS 断言**把行为钉死。

    最终形态：`check-sinks.js` 报告"静态启发式留下 N 处待人工确认（已被 N 章节测试覆盖）"，
    `--strict` 可接 CI。**扫码器负责缩小范围，测试负责判定对错**。

23. **窄屏下"固定宽度表头 + 弹性条"的图表会被挤到不可读。**
    （2026-09-22 做 `probe-mobile.js` 时发现）

    错因分布条桌面端是 `.ep-bar-label { flex: 0 0 100px }` + `.ep-bar-track { flex: 1 }`，
    1280px 下轨道有 932px，很舒服。但到 375px：卡片宽 289px，减去 100px 标签、10px 间距、
    22px 数字列，轨道只剩 **~110px** —— 条形几乎看不出长短，图就废了。

    修法是在 `@media (max-width: 760px)` 里把行改成两段式：
    标签独占第一行、`order` 把数字放第二行右侧、轨道 `flex: 1 1 60%` 换到第三行。
    修完轨道从 ~110px 变成 **183px**（375px）/ **234px**（320px），横向溢出仍为无。
    同时把 `.sess-list { min-width: 160px }` 在窄屏放开，避免上课记录横向溢出。

    **教训**：任何"固定列宽 + 弹性列"的布局，都要在 320/375px 下量一次**弹性列还剩多少**。
    这个必须用 `probe-mobile.js` 量数值 —— 截图看不出来"110px 其实已经不够用"。

24. **"转义发生在别处的 helper 里"会让静态审查失效，也让将来改 helper 时静默变脏。**
    （2026-09-22 加入学诊断时踩到）

    写 `renderDiagProfile` 时，我先把知识点行抽成 `topicRow = (t) => ...esc(t.topic)...`，
    再在下面 `box.innerHTML = ... focusHtml + skipHtml ...` 处把它们拼进去。
    逻辑完全正确，但 `check-sinks.js` 的 `--strict` **突然从 0 变成 1**。

    原因：第 1 层的判据是"**赋值点后 40 行内**有没有出现 `esc(`/`mdLite(`/`textContent`"。
    `esc()` 在 `topicRow` 里，而 `topicRow` 定义在赋值点的**上方**（窗口只往后扫），
    于是这一处被判成"附近连转义函数都没有"。

    同一个原因还命中第二处：`renderMemoryDiag` 的空态
    `el.innerHTML = '<p>…' + '…</p>'`（**纯静态字面量、零插值**）因为跨了两行、
    没以 `';` 收在同一行，`literalOnly` 也认不出来。

    修法**不是**去扩白名单，而是把转义挪到看得见的地方：
    - 把知识点行的拼接**直接写进赋值语句**（`profile.focus.map((t) => topicRow(t)).join('')` 与
      `profile.skip.map((t) => '<span class="dp-skip">' + esc(t) + '</span>')` 都出现在 sink 内），
      顺带把四个统计数字也 `esc()` 一遍（原本靠"它就是数字"这个心证）；
    - 纯静态的空态文案写成**单行字面量**，让 `literalOnly` 直接判定；
    - `verdict` 里有我故意写的 `<b>` 强调，改成 `esc()` 全转义后**只把 `&lt;b&gt;`/`&lt;/b&gt;` 换回来**，
      这样即便将来文案里混进变量也不会漏。

    改完 `--strict` 回到 0（第 1 层 68 处全安全）。同时把新的四个渲染函数
    （`renderDiagProfile`/`renderDiagnostic`/`diagItemHTML`/`renderMemoryDiag`）**登记进第 2 层 targets**，
    以后改它们也会被逐个插值分类。

    **教训**：静态审查的可见范围是"字面位置"，不是"调用链"。
    转义要么写在赋值点里，要么就等着它某天被误报（更糟的是——被误报久了，人就会去加白名单，
    而白名单会让真正的漏洞一起通过）。**顺手做对的事，比事后解释"其实我转义了"便宜得多。**

---

**25. `files_failed=11` 而 `fail=0`，不是"测试都没问题"**

    打包前复跑回归时踩到：直接 `node tests/run-all.js`（忘了 `NODE_PATH`），11 个文件全部
    `Cannot find module 'jsdom'` 而**集体加载失败**。最后一行是：

    ```
    TOTAL pass=0 fail=0 files=11 files_failed=11
    ```

    **危险点在于 `fail=0`**：加载失败的文件一条断言都没执行，自然没有失败断言。
    只看 `fail` 字段会得出"零失败"的错误结论；真正的判据是 `files_failed`。

    这是第 12 条（"只看 `TOTAL`，别数 `PASS`"）的**反面补丁**：看 `TOTAL` 是对的，
    但 `TOTAL` 是**四个数一起看**才成立 —— `pass` 为正、`fail=0`、`files` 与预期一致、
    **`files_failed=0`**。四个数里任意一个不对就是没全过。

    **教训（可推广）**：凡是"统计型"结论，都要同时看**分母**。
    当 `fail` 与 `pass` 同时为 0 时，第一反应不能是"干净"，而应该是"它到底跑了没有？"
    顺带把 `NODE_PATH` 写进 `README` 的运行说明里 —— 让下一个人不必靠"全都坏了"来发现依赖没配。

## 已知的无害告警
- `Not implemented: HTMLMediaElement's play() method` —— jsdom 不支持视频播放，可忽略。
- `Not implemented: Window's scrollTo() method` —— 同上，`switchView` 里的滚动平滑可忽略。
- `tests/audit.js` 的 `DEAD? #view-*`、`DEAD? #pane-*`、`DEAD? #auth-pane-*` 属于误报：
  这些 id 是用 `'#view-' + name` 这类**前缀拼接**在运行时定位的，静态文本匹配看不到。
