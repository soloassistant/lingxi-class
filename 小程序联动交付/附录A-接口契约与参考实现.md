# 附录 A · 云服务接口契约与参考实现

> 本附录的所有接口路径、请求体、响应体、错误码**均来自实测**（直接向云服务发请求并记录真实响应），非文档推导。
> 用途：① 给你们对照 SDK 的行为；② 排查问题时能看清「SDK 底下到底发了什么」。

---

## A1. 数据面路径总览

所有云服务接口都在 `/.cloud/` 前缀下，不会与应用自身路由冲突。

| 模块 | 路径前缀 |
|---|---|
| Auth | `/.cloud/auth/v1/**` |
| Database | `/.cloud/database/rest/**` |
| Storage | `/.cloud/storage/**` |
| LLM | `/.cloud/llm/**` |

**两个可直接访问的域名（实测均指向同一个云环境）：**

| 用途 | 域名 |
|---|---|
| 小程序（**用这个**） | `https://mp-api.app.workbuddy.host` |
| 网页版（仅供对照排查） | `https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host` |

> 排查时可以用网页版域名在电脑上 curl 比对，但**小程序代码里只能写 `mp-api` 那个**。

---

## A2. Auth 接口

底层路径常量（来自 SDK 源码）：

```js
const AUTH_PATHS = {
  signUp:               '/v1/signup',
  signIn:               '/v1/signin',
  signInWithProvider:   '/v1/signin/with/provider',
  token:                '/v1/token',
  loginWechat:          '/v1/login-wechat',
  loginWechatWeb:       '/v1/login-wechat-web',
  signOut:              '/v1/user/signout',
  userMe:               '/v1/user/me',
  verification:         '/v1/verification',
  verificationVerify:   '/v1/verification/verify',
  resetPassword:        '/v1/reset',
  sudo:                 '/v1/user/sudo',
  userPassword:         '/v1/user/password'
}
```

全部拼在 `/.cloud/auth` 之后，即 `POST /.cloud/auth/v1/verification` 这样。

### A2.1 SDK 方法 → 实际请求 对照表

| SDK 方法 | 实际发出的请求 | 请求体 |
|---|---|---|
| `signInWithPassword({email,password})` | `POST /.cloud/auth/v1/signin` | `{"username":"<email>","password":"..."}` |
| `signInWithOtp({phone})` | `POST /.cloud/auth/v1/verification` | `{"phone_number":"+86 138...","target":"ANY"}` |
| `signInWithOtp({email})` | `POST /.cloud/auth/v1/verification` | `{"email":"a@b.com","usage":"email"}` |
| `handle.verify({token})` | `POST /.cloud/auth/v1/verification/verify` → 再 `POST /.cloud/auth/v1/signin` 或 `/v1/signup` | — |
| `getUser()` | `GET /.cloud/auth/v1/user/me` | — |
| `signOut()` | `POST /.cloud/auth/v1/user/signout` | `{}` |
| `signInWithWechat(code, appid)` | `POST /.cloud/auth/v1/login-wechat` | `{"code":"...","appid":"..."}` |

> 注意 `signInWithPassword` 的请求体里邮箱字段叫 **`username`**，不是 `email`。

### A2.2 手机号验证码 —— 实测请求与响应

**发送验证码**

```http
POST /.cloud/auth/v1/verification
x-wb-webapp-access-key: <PUBLISHABLE_KEY>
Content-Type: application/json

{"phone_number":"+86 13800138000","target":"ANY"}
```

成功（HTTP 200）：

```json
{
  "verification_id": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjA3ODQzOGNkLTgwOGEtNDlkZS05NjVjLTNlZjg5OTIzODJjMCJ9...",
  "expires_in": 600
}
```

> **`verification_id` 是一个很长的 JWS 字符串（上千字符）**，不要截断、不要放 URL、不要打日志。

实测错误：

| 场景 | HTTP | 响应 |
|---|---|---|
| 缺手机号也缺邮箱 | 400 | `{"code":"INVALID_ARGUMENT","error_code":3,"error_description":"请输入手机号或邮箱"}` |
| 手机号格式不对（如 `+8613800138000` 缺空格） | 400 | `{"code":"INVALID_ARGUMENT","error_code":3,"error_description":"...value does not match regex pattern \"^$|^\\\\+[1-9][0-9]{0,3}\\\\s[0-9]{4,20}$\""}` |
| 号码在黑名单 | 400 | `{"code":"FAILED_PRECONDITION","error_code":9,"error_description":"send error code FailedOperation.PhoneNumberInBlacklist msg number on the blacklist"}` |
| 同号 1 分钟内重复发 | 429 | `{"code":"RESOURCE_EXHAUSTED","error_code":8,"error_description":"Your phone can receive up to 1 text message per minute."}` |

**这四条错误证明通道是开通的** —— 服务端真的把请求转给了短信服务。如果通道没开，会得到「not supported / not enabled」类错误。

### A2.3 邮箱验证码（备选，与网页版一致）

```http
POST /.cloud/auth/v1/verification
{"email":"a@b.com","usage":"email"}
```

实测成功同样返回 `{"verification_id":"...","expires_in":600}`。
**注意：响应里没有 `is_user` 字段** —— 这正是 §4.5 那个缺口的来源。

### A2.4 会话对象（实测自 SDK 解析逻辑）

```js
parseSession(payload, now) {
  if (typeof payload.access_token !== 'string' || !payload.access_token)
    throw new Error('response has no access_token')

  return {
    accessToken:  payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : '',
    expiresAt:    now + (typeof payload.expires_in === 'number' ? payload.expires_in : 0) * 1000,
    user: {
      id:          typeof payload.sub === 'string' ? payload.sub : '',
      isAnonymous: payload.is_anonymous === true,
      raw:         payload
    }
  }
}
```

| 字段 | 来源 |
|---|---|
| 访问令牌 | `access_token` |
| 刷新令牌 | `refresh_token` |
| 过期时间 | `Date.now() + expires_in * 1000`（**毫秒**） |
| 用户 id | `sub` |
| 是否匿名 | `is_anonymous === true` |

### A2.5 微信登录的真实行为（请勿使用，仅备查）

```http
POST /.cloud/auth/v1/login-wechat
{"code":"<wx.login 的 code>","appid":"<小程序 appid>"}
```

实测响应（HTTP 401）：

```json
{"error":"access_denied","error_description":"小程序未授权给 WorkBuddy"}
```

**这不是配置漏配那么简单** —— 灵犀课堂是 Web 类型应用，平台不提供微信登录 provider（见规格书 §4.1）。
**不要尝试去打通它**，也不要因为这条报错而去改 `endpoint`。

---

## A3. Database 接口

底层是 PostgREST，行为与 Supabase 一致。SDK 的 `cloud.database` 就是它的封装。

| 操作 | 请求 |
|---|---|
| 查询 | `GET /.cloud/database/rest/<表>?select=*` |
| 插入 | `POST /.cloud/database/rest/<表>` |
| 更新 | `PATCH /.cloud/database/rest/<表>?id=eq.<id>` |
| 删除 | `DELETE /.cloud/database/rest/<表>?id=eq.<id>` |
| 调函数 | `POST /.cloud/database/rest/rpc/<函数名>` |

> 实测：SDK 内部 `client.url` = `${endpoint}/.cloud/database/rest`。
> 因此 `from('courses')` 生成的 URL 是 `.cloud/database/rest/courses`。

### A3.1 查询能力（PostgREST 语义，SDK 已封装）

```js
// 过滤器
.eq / .neq / .gt / .gte / .lt / .lte
.like / .ilike / .in / .notIn
.contains / .containedBy / .overlaps
.textSearch / .match / .not / .or / .filter

// 变换
.select('id, course_id')      // 也可只取部分列，省流量
.order('updated_at', { ascending: false })
.limit(500)
.range(0, 99)
.single()                     // 要求恰好 1 行，否则报 406
.maybeSingle()                // 0 或 1 行

// 写入
.insert({...})  .upsert({...}, { onConflict: 'course_id' })  .update({...})  .delete()
```

### A3.2 实测行为

**匿名读 `courses`（无 token）** → `HTTP 200`，返回 `[]`（RLS 过滤掉全部行，不是报错）

**匿名读 `analytics_events`** → `HTTP 200`，返回 14 行 —— 这是 §7.2 那个缺陷，因为匿名 `auth.uid()` 是 `'anon'` 而不是空。

**匿名写 `analytics_events`** → `HTTP 201`，写入成功，服务端自动填 `owner_id: "anon"`。

> 结论：**RLS 不会给你报「无权限」的错，它默认就是给你一个空结果集。**
> 所以「查不到数据」时不要先怀疑权限配置 —— 先用登录态确认 `auth.uid()` 是不是你期望的那个值。

### A3.3 常用查询示例（小程序里直接对应 SDK 调用）

```js
const db = cloud.database

// 我的课程（RLS 已限定 owner，不需要自己加 where）
const { data: courses, error } = await db
  .from('courses')
  .select('id, course_id, data, updated_at')
  .order('updated_at', { ascending: false })
  .limit(100)

// 学生画像
const { data: profile } = await db.from('student_profiles').select('*').maybeSingle()

// 薄弱点
const { data: weak } = await db
  .from('student_facts')
  .select('content, subject, topic, confidence')
  .in('kind', ['weak', 'misconception'])
  .order('last_seen', { ascending: false })

// 最近课堂
const { data: sessions } = await db
  .from('student_sessions')
  .select('course_title, subject, duration_secs, weak_points, created_at')
  .order('created_at', { ascending: false })
  .limit(20)

// 写埋点（务必先确认已登录）
// ★ 事件名必须落在规格书 §7.1 的 41 个白名单内，否则不会上报
// ★ props 最多取前 8 个 key，字符串值截断到 300 字符
// ★ 不 await —— 埋点不参与交互时序，失败静默
if (session) {
  db.from('analytics_events').insert({
    name: 'class_start',       // ✅ 在白名单内
    props: { grade: '小学', subject: '数学', course: '分数的初步认识' }
  }).then(() => {}).catch(() => {})
}

// 登录前发生的事件（如注册风控）先落本地队列，登录后补报，见规格书 §7.3
```

### A3.4 两个受保护的表

`device_ledger` 和 `phone_ledger` **收回了客户端的直读直写权限**，唯一入口是数据库函数：

| 函数 | 参数 | 返回 | 用途 |
|---|---|---|---|
| `phone_claim(h)` | `h` = 加盐 SHA-256 哈希（**不是手机号明文**） | `'ok'` 首次 / `'shared'` 已被别的账号登记 / `'noauth'` 未登录 / `'invalid'` 参数异常 | 登记手机号 |
| `device_taken(fp)` | 设备指纹 | 是否已被占用 | 设备闸门查询 |
| `device_claim({...})` | 设备信息 | 认领结果 | 设备闸门登记 |

```js
const { data } = await db.rpc('phone_claim', { h: sha256Hex('lingxi-phone-v1|13800138000') })
// data === 'ok' | 'shared' | 'noauth' | 'invalid'
```

**注意：**

- 传给 `phone_claim` 的是**哈希**，服务端不接触明文手机号。
- `phone_hash` 长度必须 ≥ 32，否则返回 `'invalid'`。
- 未登录调用返回 `'noauth'`（服务端显式排除 `'anon'`）。
- **不做唯一约束** —— 同一个号码挂在多个账号上是允许的（家长代管多个孩子是正当场景）。返回 `'shared'` 只是提示，不拦。

**本次小程序的建议**：先不实现 `device_ledger` 相关的风控逻辑，把精力放在登录与数据同步上。
如果要做，请严格复用上面这套「哈希 + RPC」的方式，**不要**试图直接读写台账表。

---

## A4. LLM 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/.cloud/llm/models` | 模型清单 |
| `POST` | `/.cloud/llm/chat/completions` | 对话补全（OpenAI 兼容） |

### A4.1 实测

`GET /.cloud/llm/models` → `HTTP 200`，约 **20950 字节**的数组，元素形如：

```json
{
  "id": "auto",
  "name": "Auto",
  "vendor": "f",
  "descriptionZh": "平衡效果与速度。自动为每个任务匹配最优模型，积分倍率随之浮动",
  "descriptionEn": "Balances quality and speed. ...",
  "maxInputTokens": ...,
  "capabilities": { ... },
  "reasoning": { ... },
  "pricing": { ... }
}
```

**不要硬编码模型 id。** `auto` 是「自动匹配」，优先用它，除非有明确理由指定某个模型。

### A4.2 必须流式

实测非流式调用直接抛错：

```
stream must be true; non-streaming chat completions are not supported
```

```js
// ✅ 正确
for await (const chunk of cloud.llm.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: '...' }],
  stream: true
})) {
  // chunk 里取增量文本
}
```

```js
// ❌ 错误：网关会拒绝
const res = await cloud.llm.chat.completions.create({ model: 'auto', messages })
```

### A4.3 不需要 API Key

模型调用走登录用户的配额，**没有任何密钥需要你们申请**。
这意味着：**未登录时 AI 不可用**，前端要有明确的降级提示（不是「服务故障」）。

### A4.4 错误类型

SDK 抛的是 `CloudOpenAIError`，带这些字段：

| 字段 | 含义 |
|---|---|
| `error` | `{message, type, param, code}` |
| `status` | HTTP 状态码 |
| `requestId` | 请求 id（反馈问题时提供这个） |
| `retryAfterMs` | 建议重试等待（来自 `Retry-After` 头） |

**汇报问题时请带上 `requestId`**，服务端靠它定位。

---

## A5. 参考实现

以下代码是**可直接照抄的最小可用实现**。

### A5.1 目录结构（必须符合这个形状，否则不编译）

```
lingxi-miniprogram/
├── project.config.json     { "miniprogramRoot": "./", "compileType": "miniprogram", "appid": "..." }
├── package.json            ← 装 SDK 用，必须与 app.json 同级
├── app.json                ← 必须含 lazyCodeLoading
├── app.js
├── app.wxss
├── sitemap.json            { "rules": [{ "action": "allow", "page": "*" }] }
├── pages/
│   ├── login/              登录（手机号 + 验证码）
│   ├── courses/            我的课程
│   ├── course/             课程详情 / 继续上课
│   ├── feynman/            讲给我听
│   ├── wrongbook/          错题复习
│   └── profile/            我的
└── utils/
    ├── cloud.js                    云服务客户端（唯一初始化点）
    ├── workbuddy-cloud-diagnostics.js   诊断 helper（平台提供，原样复制）
    └── store.js                    本地缓存（带账号命名空间）
```

### A5.2 `app.json`

```json
{
  "pages": [
    "pages/login/login",
    "pages/courses/courses",
    "pages/course/course",
    "pages/feynman/feynman",
    "pages/wrongbook/wrongbook",
    "pages/profile/profile"
  ],
  "lazyCodeLoading": "requiredComponents",
  "window": {
    "navigationBarTitleText": "灵犀课堂",
    "navigationBarBackgroundColor": "#1a1d27",
    "navigationBarTextStyle": "white"
  },
  "tabBar": {
    "color": "#7a7f8a",
    "selectedColor": "#00e5ff",
    "backgroundColor": "#1a1d27",
    "list": [
      { "pagePath": "pages/courses/courses", "text": "课程" },
      { "pagePath": "pages/wrongbook/wrongbook", "text": "错题" },
      { "pagePath": "pages/profile/profile", "text": "我的" }
    ]
  },
  "sitemapLocation": "sitemap.json"
}
```

> `tabBar` 的每一项必须也在 `pages` 里；没有图标文件就不要写 `iconPath` 字段。

### A5.3 `utils/cloud.js`（唯一初始化点）

```js
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

const CLOUD_ENDPOINT  = 'https://mp-api.app.workbuddy.host'
const PUBLISHABLE_KEY = 'wbpk_Pq3DhJIr74vvC8YpuqkMPA_lgoEQ7iPSjSnnQx9ZsLOpjoB6dFoKCSh'

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: CLOUD_ENDPOINT,
  publishableKey: PUBLISHABLE_KEY,
  wx: createDiagnosticWx(wx),
})

// 统一的登录态判断：所有读写用户数据的地方都先过这一关
async function requireSession() {
  try {
    const { data: session, error } = await cloud.auth.getSession()
    if (error || !session) return null
    return session
  } catch (e) {
    return null
  }
}

module.exports = { cloud, requireSession, CLOUD_ENDPOINT, PUBLISHABLE_KEY }
```

### A5.4 登录页（关键部分）

```js
// pages/login/login.js
const { cloud } = require('../../utils/cloud')

Page({
  data: {
    phone: '',
    code: '',
    step: 'phone',      // 'phone' | 'code'
    sending: false,
    submitting: false,
    countdown: 0,
  },

  // ★ handle 存在页面实例上，跨事件保留 —— 不要放进回调局部作用域
  _handle: null,
  _sentPhone: '',

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },
  onCodeInput(e) {
    this.setData({ code: e.detail.value })
  },

  // ★ 只发送，不验证
  async onSendCode() {
    if (this.data.sending) return
    const phone = (this.data.phone || '').trim()
    if (!phone) return wx.showToast({ title: '请输入手机号', icon: 'none' })

    this.setData({ sending: true })
    try {
      // ★ 原样传手机号，不要自己拼 +86（SDK 会归一化）
      const sent = await cloud.auth.signInWithOtp({ phone })
      if (sent.error) {
        wx.showToast({ title: this._errText(sent.error), icon: 'none' })
        return
      }
      // ★ 保存 handle，后面验证要用
      this._handle = sent.data
      this._sentPhone = phone
      this.setData({ step: 'code' })
      this._startCountdown(60)
      wx.showToast({ title: '验证码已发送', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },

  // ★ 只验证，绝不在这里重发
  async onSubmit() {
    if (this.data.submitting) return
    const phone = (this.data.phone || '').trim()
    const token = (this.data.code || '').trim()

    if (!token) return wx.showToast({ title: '请填写验证码', icon: 'none' })
    if (!this._handle) return wx.showToast({ title: '请先获取验证码', icon: 'none' })
    // 改了号 → 必须重新获取，不拿旧 handle 去验
    if (phone !== this._sentPhone) {
      return wx.showToast({ title: '手机号已更改，请重新获取验证码', icon: 'none' })
    }

    this.setData({ submitting: true })
    try {
      const done = await this._handle.verify({ token })
      if (done.error) {
        wx.showToast({ title: this._errText(done.error), icon: 'none' })
        return
      }
      this._handle = null
      wx.reLaunch({ url: '/pages/courses/courses' })
    } catch (e) {
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  // 按 kind 分支，不靠文案匹配；文案不暴露「该号是否已注册」
  _errText(err) {
    const kind = err && err.kind
    const msg = (err && err.message) || ''
    if (/not.*(support|enable)|unsupported|not enabled|disabled/i.test(msg)) {
      return '短信登录暂未开通'
    }
    if (kind === 'network' || kind === 'backend-unavailable') return '网络异常，请稍后重试'
    if (/frequen|too many|rate|频繁|resource_exhausted/i.test(msg)) return '发送过于频繁，请稍后再试'
    if (/expired|invalid.*code|验证码/i.test(msg)) return '验证码不正确或已过期'
    return '操作失败，请重试'
  },

  _startCountdown(sec) {
    this.setData({ countdown: sec })
    this._timer = setInterval(() => {
      const n = this.data.countdown - 1
      if (n <= 0) {
        clearInterval(this._timer)
        this.setData({ countdown: 0 })
      } else {
        this.setData({ countdown: n })
      }
    }, 1000)
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },
})
```

### A5.5 课程列表（读 + 同步）

```js
// pages/courses/courses.js
const { cloud, requireSession } = require('../../utils/cloud')

Page({
  data: { courses: [], loading: true },

  async onShow() {
    const session = await requireSession()
    if (!session) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    await this.loadCourses()
  },

  async loadCourses() {
    this.setData({ loading: true })
    try {
      const { data: rows, error } = await cloud.database
        .from('courses')
        .select('id, course_id, data, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100)

      if (error) throw error

      const list = (rows || [])
        .map(r => r && r.data)
        .filter(c => c && c.id)
        .map(c => ({
          id: c.id,
          title: c.title || '未命名课程',
          subject: c.subject || '',
          grade: c.grade || '',
          progress: Math.round((Number(c.progress) || 0) * 100),
        }))

      this.setData({ courses: list })
    } catch (e) {
      wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onPullDownRefresh() {
    this.loadCourses().then(() => wx.stopPullDownRefresh())
  },

  openCourse(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/course/course?id=${id}` })
  },
})
```

### A5.6 本地缓存（账号命名空间 —— 防串数据）

```js
// utils/store.js
const PREFIX = 'lingxi'

let _scope = 'guest'

function setScope(userId) {
  // ★ 用 userId，不要用手机号/邮箱（隐私 + 改号会失联）
  _scope = userId ? `u_${userId}` : 'guest'
}

function key(k) {
  return `${PREFIX}_${_scope}_${k}`
}

function get(k, fallback) {
  try {
    const raw = wx.getStorageSync(key(k))
    return raw === '' || raw === undefined || raw === null ? fallback : JSON.parse(raw)
  } catch (e) {
    return fallback
  }
}

function set(k, v) {
  try { wx.setStorageSync(key(k), JSON.stringify(v)) } catch (e) {}
}

function remove(k) {
  try { wx.removeStorageSync(key(k)) } catch (e) {}
}

module.exports = { setScope, get, set, remove }
```

**切换账号时必须调用 `setScope(newUserId)`。**
读不到就是空 —— **绝不要回落到上一个账号的数据**（这是网页版踩过的真实事故）。

### A5.7 同步课程（先推后拉 + 墓碑）

```js
// utils/sync.js
const { cloud, requireSession } = require('./cloud')
const store = require('./store')

let running = false   // ★ 并发保护：同一时刻只跑一次

async function syncCourses(localCourses) {
  const session = await requireSession()
  if (!session) return { ok: false, reason: 'no-session' }
  if (running) return { ok: false, reason: 'busy' }
  running = true

  const db = cloud.database
  const queue = store.get('sync_queue', { up: {}, del: {} })   // up: 待上传; del: 墓碑
  let pushFailed = 0

  try {
    // ── ① 先推 ──
    const existing = new Map()
    try {
      const { data: rows } = await db.from('courses').select('id, course_id').limit(1000)
      ;(rows || []).forEach(r => { if (r && r.course_id) existing.set(r.course_id, r.id) })
    } catch (e) { /* 拿不到就当作云端没有，插入失败会留在队列里重试 */ }

    const byId = {}
    ;(localCourses || []).forEach(c => { if (c && c.id) byId[c.id] = c })

    for (const id of Object.keys(queue.up || {})) {
      const c = byId[id]
      if (!c) { delete queue.up[id]; continue }     // 本地没了 → 交给墓碑分支
      try {
        const rid = existing.get(id)
        if (rid) {
          await db.from('courses')
            .update({ data: c, updated_at: new Date().toISOString() })
            .eq('id', rid)
        } else {
          await db.from('courses').insert({ course_id: id, data: c })
          existing.set(id, id)
        }
        delete queue.up[id]
        c.syncState = 'synced'
      } catch (e) { pushFailed++ }                  // ★ 留队列，下次重试
    }

    // 删除：按墓碑推
    for (const id of Object.keys(queue.del || {})) {
      try {
        const rid = existing.get(id)
        if (rid) await db.from('courses').delete().eq('id', rid)
        delete queue.del[id]
      } catch (e) { pushFailed++ }
    }

    store.set('sync_queue', queue)

    // ── ② 再拉 ──
    const { data: rows } = await db.from('courses')
      .select('data')
      .order('updated_at', { ascending: false })
      .limit(500)

    const cloudList = (rows || []).map(r => r && r.data).filter(d => d && d.id)
    const q2 = store.get('sync_queue', { up: {}, del: {} })
    const map = {}
    ;(localCourses || []).forEach(c => { if (c && c.id) map[c.id] = c })

    cloudList.forEach(cc => {
      // ★ 墓碑：本地删过，且删除时间不早于云端这一版 → 不复活
      const deletedAt = q2.del && q2.del[cc.id]
      if (deletedAt && Number(cc.updatedAt || 0) <= Number(deletedAt)) {
        delete map[cc.id]
        return
      }
      const local = map[cc.id]
      if (local && (q2.up && q2.up[cc.id])) return              // 本地未同步的改动优先
      if (!local || Number(cc.updatedAt || 0) > Number(local.updatedAt || 0)) {
        map[cc.id] = cc
      }
    })

    const merged = Object.keys(map).map(k => map[k])
    store.set('courses', merged)
    return { ok: pushFailed === 0, merged }
  } finally {
    running = false
  }
}

// 本地删除一门课：同时写墓碑
function markCourseDeleted(courseId) {
  const queue = store.get('sync_queue', { up: {}, del: {} })
  delete queue.up[courseId]
  queue.del[courseId] = Date.now()
  store.set('sync_queue', queue)

  const list = store.get('courses', [])
  store.set('courses', list.filter(c => c && c.id !== courseId))
}

module.exports = { syncCourses, markCourseDeleted }
```

> 这段逻辑与网页版是同一套协议。**请不要「简化」它** —— 尤其是墓碑分支和「先推后拉」的顺序，去掉任何一个都会出现「删掉的课自己回来」或「本地改动被覆盖」。

### A5.8 费曼守卫（判定必须在服务端，但**平台当前没有服务端承载**）

> ⚠️ **先读规格书 §10.5。** 实测确认：WorkBuddy 云服务**没有自定义云函数/服务端代码**
> （只有 `auth` / `database` / `storage` / `llm` 四个模块）；数据库实测只装了 `plpgsql` 扩展，
> **没有 `pg_net` / `http`**，所以 RPC 也发不出 HTTP 请求。
>
> 结论：**客户端直连 `cloud.llm` 时，没有任何服务端能拿到 history。**
> 下面的函数是**承载就位后**（例如改用微信云函数经手 AI 调用）要放进去的内容。
> 在承载确定前，只能先做客户端守卫，并把 §12 C 组末项**如实标为未完成**。

```js
// 放在服务端（例如微信云函数）—— stats 由服务端自己数 history，不接受客户端传
const MIN_TURNS = 2
const MIN_CHARS = 60

function studentStats(history) {
  const msgs = Array.isArray(history) ? history : []
  // ★ role 是 'user'（不是 'student'），与网页版一致
  const mine = msgs.filter(m => m && m.role === 'user')
  // ★ 字数口径：先去掉所有空白再取长度 —— 与网页版逐字对齐
  const chars = mine.reduce((n, m) => n + String(m.content || '').replace(/\s/g, '').length, 0)
  return { turns: mine.length, chars, enough: mine.length >= MIN_TURNS && chars >= MIN_CHARS }
}

// ★ 客户端传上来的 stats 一律忽略
//   —— 判据不能由被检验的一方提供（这是网页版 R12 的教训）
```

**两个口径细节必须对齐，否则同一个学生在两端会被判出不同结果：**

| 项 | 网页版实现（照此对齐） |
|---|---|
| 谁算「学生发言」 | `messages` 里 `role === 'user'` 的条目 |
| 字数怎么数 | `content` **去掉所有空白字符**后取 `.length` |
| 门槛 | `turns >= 2` **且** `chars >= 60`（两个都要满足，是 `&&` 不是 `||`） |

对应网页版函数：`feynTalkStudentStats(talk)` 与 `guardFeynTalkVerdict(v, stats)`，
常量 `FEYNTALK_MIN_TURNS = 2` / `FEYNTALK_MIN_CHARS = 60`。

**门槛不达标时的处理也要一致**：把 `explained` 和 `skipped` **一起清空**，并标记 `insufficient: true`。
只清 `explained` 是不够的 —— 学生都没怎么讲，说他「绕过了什么」同样是凭空判断。

---

## A6. 排错速查

| 现象 | 先查什么 |
|---|---|
| 请求返回 **401 `invalid_client`** | 请求头名是不是 `x-wb-webapp-access-key`（不是 `x-publishable-key`） |
| 请求返回 **403** | 是不是带了 `Origin` 头；或平台收紧来源校验（见规格书 §2.2） |
| 查询返回空数组而不是报错 | RLS 正常行为。先确认登录态，再确认数据确实是这个账号的 |
| 插入报策略拒绝 | 是不是自己传了 `owner_id`？删掉它（§5.3） |
| 报列不存在 | 埋点表列名是 `name` / `props` |
| 埋了但没有数据 | 事件名是不是不在 §7.1 的 41 个白名单内？（守卫会告警一次并丢弃） |
| `confidence` 两端显示不一致 | 客户端读取时要兜底 `0.7`（规格书 §5.2） |
| 两端课程渲染出不同的空行 | `slides`/`boards`/`outline.stages` 的元素类型 filter 漏了（规格书 §5.3） |
| LLM 报 `stream must be true` | 改成流式（§A4.2） |
| 手机号格式错误 | 自己有没有拼 `+86`？交给 SDK 原样传（§4.3） |
| 验证码验证不上 | `verify` 用的还是不是发送时那个 handle？手机号有没有改过？ |
| 真机请求失败、模拟器正常 | 开 vConsole 看诊断适配器的输出，多半是域名白名单 |
| 小程序白屏 | `app.json` 里有没有 `lazyCodeLoading` |

---

## A7. 实测记录（可复现）

以下命令可以复现本文档中的关键结论（把 `<KEY>` 换成上面的 publishableKey）：

```bash
KEY="wbpk_Pq3DhJIr74vvC8YpuqkMPA_lgoEQ7iPSjSnnQx9ZsLOpjoB6dFoKCSh"

# ① 两个域名是否同一云环境（应返回完全相同的行）
curl -s "https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host/.cloud/database/rest/analytics_events?select=id,owner_id,name" -H "x-wb-webapp-access-key: $KEY" | head -c 300
curl -s "https://mp-api.app.workbuddy.host/.cloud/database/rest/analytics_events?select=id,owner_id,name" -H "x-wb-webapp-access-key: $KEY" | head -c 300

# ② 模型清单
curl -s "https://mp-api.app.workbuddy.host/.cloud/llm/models" -H "x-wb-webapp-access-key: $KEY" | head -c 300

# ③ 手机号格式校验（故意写错，看 regex 报错）
curl -s -X POST "https://mp-api.app.workbuddy.host/.cloud/auth/v1/verification" \
  -H "x-wb-webapp-access-key: $KEY" -H "Content-Type: application/json" \
  -d '{"phone_number":"+8613000000000","target":"ANY"}'

# ④ 微信登录（预期 access_denied，证明该路不可用）
curl -s -X POST "https://mp-api.app.workbuddy.host/.cloud/auth/v1/login-wechat" \
  -H "x-wb-webapp-access-key: $KEY" -H "Content-Type: application/json" \
  -d '{"code":"FAKE","appid":"wxtest"}'
```

