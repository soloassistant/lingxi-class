# AI 网课老师 · 整合版

> 一条 AI 教育产品线，两个客户端：**小程序端（AI 网课老师）** 覆盖「国际课程学习 + 诊断 + 错题 + 规划」的移动学习闭环；**Web 端（灵犀课堂）** 提供「AI 一对一直播课」的沉浸式课堂体验。

| 端 | 目录 | 载体 | 技术栈 | 后端 | 定位 |
|---|---|---|---|---|---|
| 小程序端 | `ai-course-teacher/` | 微信小程序 | 原生小程序 + wx-server-sdk | 微信云开发（32 云函数） | 国际课程（雅思/托福/SAT/IGCSE/A-Level/AP/IB）学习管家 |
| Web 端 | `lingxi-class/` | Web 静态页 | 原生 HTML/JS | WorkBuddy 云服务（RLS 3 表） | AI 一对一直播课（可打断 + 跨课记忆 + 苏格拉底引擎） |

---

## 一、两端关系与定位

两者是**同一产品愿景下的两个互补客户端**，不是重复建设：

| 维度 | 小程序端（AI 网课老师） | Web 端（灵犀课堂） |
|---|---|---|
| 目标人群 | 国际课程备考学生 | 国内 + 国际课程学生 |
| 核心交互 | 分层授课 + 板书指令流 + 遗忘曲线错题本 | 可打断实时课堂 + 跨课长期记忆 + 苏格拉底追问 |
| 记忆能力 | 学习者画像 + 错题（无跨课长期记忆） | 6 类事实 + 置信度累积的长期记忆 |
| 使用场景 | 碎片化刷题、查漏补缺、跟目标规划 | 深度一对一上课、随时打断提问 |
| 自动化测试 | 合规审计 59 项断言 | 9 文件 / 513 断言 |

**收敛建议**：两端长期应收敛技术栈与 AI 能力层 —— 灵犀课堂的四层重试链、首字超时换模型、长期记忆系统质量更高，值得抽成共用包反向输入小程序端（详见各端文档）。

---

## 二、小程序端（ai-course-teacher）快速开始

### 1. 注册小程序并拿到 AppID
登录 https://mp.weixin.qq.com 注册小程序，在「开发管理 → 开发设置」拿到 **AppID**，替换 `project.config.json` 里的 `touristappid`。

### 2. 开通云开发，拿到环境 ID
微信开发者工具导入 `ai-course-teacher/` → 工具栏「云开发」开通 → 记下环境 ID，填入 `miniprogram/config.js` 的 `envId`。

### 3. 配置 AI 密钥
在云开发控制台 → 云函数 `aiProxy` → 环境变量，填入 `AI_KEY_PRIMARY` / `AI_BASE_URL` / `AI_MODEL_PRIMARY` 等（详见 `ai-course-teacher/API密钥安全指南.md`）。

### 4. 部署云函数
`cloudfunctions/` 下每个函数右键「上传并部署：云端安装依赖」。注意 `aiProxy` 等 AI 函数已配 `config.json`（timeout 30s），部署时保留。

### 5. 建集合 + 权限规则
在云开发控制台建集合并加索引（清单见 `开发规范.md` §4），并配置**权限规则为「仅创建者可读写」**（上线前必做）。

### 6. 审核后台
小程序内「我的 → 审核后台」可审核 AI 生成课程；`reviewDraft` 支持 `ADMIN_OPENIDS` 环境变量做审核人白名单（生产环境务必配置）。

### 合规回归
```bash
node ai-course-teacher/_test/test-compliance.js   # 59 项断言，应 0 失败
```

---

## 三、Web 端（lingxi-class）快速开始

1. 进入 `lingxi-class/ai-live-class/`，直接用静态服务器托管 `index.html`（或发布到 WorkBuddy 轻量发布）。
2. 后端走 WorkBuddy 云服务（免密钥 LLM + 云数据库 RLS），前端 `PUBLIC_CONFIG` 里填 `publishableKey`。
3. 运行测试：
   ```bash
   cd lingxi-class/ai-live-class && node tests/run-all.js
   # 期望：TOTAL pass=513 fail=1（该失败为测试自身假阳性，见 tests/README.md）
   ```

---

## 四、本次整合改动了什么（2026-09-23）

小程序端（`ai-course-teacher/`）在「完整版」基础上补齐了上线前 6 处缺口 + 本次 2 项：

1. `deleteAccount` 注销漏删集合 → 补全 15 个用户集合
2. `courses_draft` 审核断头路 → 打通「生成→审核→发布→展示」闭环（新增 `getAICourses`）
3. `getRoadmap` 硬编码 → AI 生成个性化路线图
4. 全站埋点 → 新增 `trackEvent` + `utils/track.js` + `analytics` 集合
5. `saveWrong` 缺 package.json → 补上
6. 合规测试 → 新增 `_test/test-compliance.js`（59 项断言）
7. **审核后台** → 新增 `getDrafts` + `pages/admin` 审核页 + 入口（本次）
8. **云函数超时配置** → 10 个 AI 云函数补 `config.json`（timeout 30s，防默认 3s 超时）（本次）

详见各端文档与 `上线前代码接线审计报告.md`。

---

*整合时间：2026-09-23 · 本目录为工作区产物，未改动微信云环境与线上部署。*
