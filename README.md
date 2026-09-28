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
# 纯静态站点，任意静态服务器即可
python3 -m http.server 8080
```

- 入口：`index.html`
- 源码：`js/app.js`（单文件，约 1.2 万行）、`css/style.css`
- 测试：`tests/run-all.js`（**1796 项断言**，覆盖课堂流程 / 语音 / 记忆 / 合规 / 题库 / 进度备份等）
- 后端：WorkBuddy 云服务（数据库 / 认证 / 文件存储 / LLM）
- 依赖：`vendor/` 内自带，无 npm 依赖

跑测试：

```bash
cd _extract/lingxi-class/ai-live-class
NODE_PATH=<node_modules 路径> node tests/run-all.js
```

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

## 免责与边界

- AI 生成内容仅供学习参考。
- 语音朗读依赖**运行环境**的语音能力：网页版用浏览器 `speechSynthesis`（依赖系统语音包），小程序用微信同声传译插件。
- 学习数据（课程 / 题库 / 偏好）默认存在**本机浏览器**；网页版提供「学习进度」打包导出 / 导入。
