# 灵犀课堂（LingXi Classroom）

面向 K12 / 国际课程的 **AI 一对一直播课**产品。核心是**苏格拉底式提问式教学 + 语音朗读 + 长期记忆**。

本仓库包含两个客户端与相关文档。

## 目录

| 路径 | 说明 |
|---|---|
| `_extract/lingxi-class/ai-live-class/` | **网页版**（纯静态，无构建步骤）。已发布在 lingxi-class.app.workbuddy.host |
| `AI网课老师-整合版/ai-course-teacher/` | **微信小程序**（含 `miniprogram/` 与云函数） |
| `AI网课老师-PRD.md` | 产品需求 |
| `灵犀课堂-试用验证清单.md` | 试用与验收清单 |
| `灵犀课堂-vs-学而思-质量对比与用户视角差距.md` | 竞品对比与差距分析 |
| `上线前代码接线审计报告.md` | 上线前审计 |

## 网页版

```bash
cd _extract/lingxi-class/ai-live-class
npm start                      # 用仓库自带的零依赖静态服务器（tools/serve.js，默认 3000 端口）
# 或任意静态服务器：
python3 -m http.server 8080
```

- 入口：`index.html`
- 源码：`js/app.js`（单文件，约 1.2 万行）、`css/style.css`
- 测试：`tests/run-all.js`（**1809 项断言**，覆盖课堂流程 / 语音 / 记忆 / 合规 / 题库 / 进度备份等）
- 后端：WorkBuddy 云服务（数据库 / 认证 / 文件存储 / LLM）
- 运行时依赖：`vendor/` 内自带，**无 npm 运行时依赖**（`package.json` 只为跑测试与 `npm start`）

跑测试：

```bash
cd _extract/lingxi-class/ai-live-class
npm ci && npm test            # 需要 Node 20+；唯一开发依赖是 jsdom
```

### ⚠️ 部署时必须显式指定 `language: "static"`

本站是**纯静态单页应用**（没有 `/api/*`），但仓库根目录有 `package.json`（为了 CI 与 `npm start`）。
发布工具会**自动探测项目形态**，看到清单文件就把本站当成 Node 服务 —— 后果是连域名一起变：

| 探测结果 | 部署类型 | 域名 |
|---|---|---|
| 静态站 | `web-page` | `https://<domainPrefix>.app.workbuddy.host/` |
| Node 服务 | `http-service` | `https://<sandboxId>.app.workbuddy.host/` |

**所以每次发布都要显式传 `language: "static"`（并带 `entryHtml: "index.html"`），不要依赖自动探测** ——
否则域名会被换掉，而旧链接会直接变成「链接已失效」（已经发生过一次，见 git 历史里的说明）。

## 微信小程序

```
AI网课老师-整合版/ai-course-teacher/
├── miniprogram/        小程序前端
└── cloudfunctions/     云函数
```

**语音播报有前置条件**（缺了会完全没有声音，且旧版不会给出任何提示）：

1. `project.config.json` 里的 `appid` 必须是**真实的小程序 appid**（不能是 `touristappid`）
2. 小程序后台「设置 → 第三方服务 → 插件管理」添加插件 **`wx069ba97219f66d99`**（微信同声传译，官方免费）
3. `miniprogram/app.json` 里声明（已声明）：

```json
"plugins": { "WechatSI": { "version": "0.3.6", "provider": "wx069ba97219f66d99" } }
```

## 关于配置

前端代码里有一个 `wbpk_...` 开头的 **publishable key**：它是设计为可公开的前端密钥（权限受服务端 RLS 约束），不是服务端密钥。服务端密钥不在此仓库中。

### ⚠️ 部署前置条件：业务表结构与 RLS **不在本仓库**

这是一个**已知的交付缺口**，两份独立审查都把它列为最该先补的一件事。

`sql/` 里只有设备与手机号两张风控台账（`device_ledger`、`phone_ledger`），
而网页端代码实际依赖下面这几张业务表 —— 它们的建表语句、索引、RLS 策略、
兼容升级记录**全都不在版本控制里**：

| 表 | 代码里的用途 | 缺失时的表现 |
|---|---|---|
| `courses` | 课程 + 课件 + 课堂回放 + 学生提问（跨设备同步） | 换设备看不到课 |
| `student_profiles` | 学生画像（年级 / 体系 / 风格 / 节奏） | 老师不记得你 |
| `student_facts` | 「老师记住的事」（知识点掌握度、错因） | 掌握度页空白 |
| `student_sessions` | 上课记录（小结 / 作业 / 错题 / 回忆计划） | 学习档案页空白 |
| `analytics_events` | 埋点（`track()` 写入） | 埋点丢失（且注销也删不到） |

每张业务表都需要 **`owner_id` 列 + 只允许读写自己行的 RLS 策略**；
客户端注销会按 `owner_id` 逐表删除（见 `deleteMyAccount` 里的 `CLOUD_USER_TABLES`）。

**后果要说清楚**：平台停服 / 欠费 / 改条款 / SDK 弃用 = 这些表既**建不起来**、
也**拿不回来**。所以建议的下一步不是换云，而是
**把这些表的迁移与 RLS 写进仓库** —— 做完这一步，"绑定"才从风险降级为选择。

`js/app.js` 里有三处注释标了同一个约束：`saveFacts`（想补 `system` / 知识点 ID 列）、
`deleteMyAccount`（删除范围）、`syncCourses`（同步契约）。
**在迁移脚本落地之前，不要盲加列** —— 列不存在会让写入直接失败、把整条记忆链打断。

## 免责与边界

- AI 生成内容仅供学习参考。
- 语音朗读依赖**运行环境**的语音能力：网页版用浏览器 `speechSynthesis`（依赖系统语音包），小程序用微信同声传译插件。
- 学习数据（课程 / 题库 / 偏好）默认存在**本机浏览器**；网页版提供「学习进度」打包导出 / 导入。
