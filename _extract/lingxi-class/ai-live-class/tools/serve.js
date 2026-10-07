/* 零依赖静态文件服务器 —— 三件事：
   ① 部署平台需要一个 `start` 脚本来托管这个站点
      （★ 踩过的坑：本项目本来是纯静态站、没有 package.json，平台默认按静态站托管；
       一旦为了跑测试加了 package.json，平台就改判成"Node 应用"去找 `npm start`，
       找不到就报 "Missing script: start" 而起不来 —— 所以这个脚本是必需的，不是多余的文件。）
   ② 给本地开发一个统一的启动方式，不用再记 `python -m http.server`。
   ③ ★ 2026-10-05 加：压缩 + 缓存 + 安全响应头。

   用法：npm start        （默认 3000 端口，遵循平台的 PORT 环境变量）
   这个服务器只读、不写，不做任何业务逻辑。

   ════════════════════════════════════════════════════════════════════════
   ③ 的由来（外部审查施工单 2026-10-05，项 1 / 2 / 6）
   ────────────────────────────────────────────────────────────────────────
   实测线上（2026-10-05，首页与 4 件首屏资源）：

     响应头                    实测值
     Content-Encoding          （空）—— 没压缩
     Cache-Control / ETag      （空）—— 没缓存，680KB 主包每次都全量重传
     Eo-Cache-Status           MISS（连查 5 次都是 MISS）
     X-Frame-Options 等安全头  （全缺）

   首屏四件资源合计 948,944 字节（0.90 MB）全部裸传，冷启动实测约 50 秒。

   ★ 但请注意一个前提：**这项改动要生效，必须让平台真的跑起这个脚本。**
     线上 `/zzz-no-such-path` 返回的是平台内部静态服务器的 404 页，
     而本脚本对无扩展名的未知路径会回落 index.html（返回 200）——
     两者行为不同，所以**线上当前并不是由本脚本服务的**，而是平台静态托管。
     也就是说：改这个文件不会自动生效；要么由平台侧开 gzip/缓存/安全头，
     要么把发布方式显式改成 Node 应用（deploy 时 language: node）。
   详见交付说明里给平台方的工单条目。
   ════════════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';   // 平台容器里需要监听 0.0.0.0

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

/* ── 压缩 ──────────────────────────────────────────────────────────────
   只压"文本类"。别去压 png/jpg/woff2 —— 它们本身就是压缩过的，
   再压一次只会浪费 CPU 而且几乎不变小（有时还更大）。 */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/;
const MIN_COMPRESS = 1024;    // 小于 1KB 不值得压（省下的字节还不够协议开销）

/* 压缩结果缓存。为什么必须有：
   680KB 的 app.js 每次都重压一遍，等于用 CPU 换带宽 —— 而 CDN 命中后
   本来就不需要重复压。键里带 mtime/size/编码，文件一变键就变，自动失效。 */
const BODY_CACHE = new Map();
const BODY_CACHE_MAX = 240;

/* 选编码。★ 必须解析 q 值，不能用 /br/ 这种"出现就算支持"的匹配 ——
   实测踩到过：`Accept-Encoding: br;q=0, gzip` 用正则会命中 br，
   而 q=0 的意思是**明确拒绝** br（客户端可能就是因为解不开才关掉它）。
   回了 br 会把"请求自己声明不支持的格式"发回去，客户端解不开。 */
function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (!ae) return 'identity';                 // 没声明就只接受 identity
  const q = {};
  let star = null;
  ae.split(',').forEach((part) => {
    const bits = part.trim().split(';');
    const name = bits[0].trim();
    if (!name) return;
    let quality = 1;
    for (let i = 1; i < bits.length; i++) {
      const mQ = bits[i].trim().match(/^q=([0-9.]+)$/);
      if (mQ) quality = Number(mQ[1]);
    }
    if (name === '*') star = quality; else q[name] = quality;
  });
  const get = (name) => (Object.prototype.hasOwnProperty.call(q, name)
    ? q[name]
    : (star === null ? 0 : star));
  const brQ = get('br');
  const gzQ = get('gzip');
  if (brQ > 0 && brQ >= gzQ) return 'br';
  if (gzQ > 0) return 'gzip';
  return 'identity';                          // 都不接受就原样发（比回 406 对静态站更实用）
}

function encodeBody(key, buf, enc) {
  if (enc === 'identity') return buf;
  const hit = BODY_CACHE.get(key);
  if (hit) return hit;
  let out;
  try {
    out = enc === 'br'
      ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
      : zlib.gzipSync(buf, { level: 6 });
  } catch (e) {
    return buf;                       // 压不动就原样发，绝不能因为压缩失败而 500
  }
  if (out.length >= buf.length) return buf;   // 压完更大就不压（小文件/已压缩内容）
  if (BODY_CACHE.size >= BODY_CACHE_MAX) BODY_CACHE.clear();
  BODY_CACHE.set(key, out);
  return out;
}

/* ── 缓存策略 ──────────────────────────────────────────────────────────
   ★ 关键前提：index.html 引用的是**裸路径**（css/style.css、js/app.js），没有内容指纹。
     所以静态资源**绝不能设 immutable** —— 那会让改了文件之后用户永远拿到旧版。
     正确顺序是：先 max-age=3600 观察 → 上构建指纹 → 再改 immutable, max-age=31536000。
     （这一步对应施工单里标红的那条坑。） */
const CACHE_HTML = 'no-cache, must-revalidate';
const CACHE_ASSET = 'public, max-age=3600, must-revalidate';

/* ── 安全响应头 ────────────────────────────────────────────────────────
   为什么 frame-ancestors 必须走响应头：它写在 <meta> 里的 CSP 中会被**规范要求忽略**。
   本页的 CSP 仍由 index.html 的 <meta> 提供（default-src 'self' 等），
   这里只补它补不了的那一条，两边是"同时生效、取交集"，不会互相覆盖。

   ⚠️ frame-ancestors 的取值是一个**产品决定**，不是纯技术问题：
     · 'self' —— 允许同源 iframe，挡掉所有第三方站点嵌套（点劫持没了）。
     · 'none' —— 连同源也不允许。更严，但如果将来要把页面嵌进 www.workbuddy.cn 就会直接白屏。
   这里取 'self'，与平台自己的 API 响应头一致（实测 /.cloud/** 返回的就是
   `Content-Security-Policy: frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`）。
   若确认要允许 workbuddy.cn 内嵌，改这一行即可 —— 但**必须先解决施工单第 4 项**
   （X-Conversation-ID 不在预检白名单里，一旦跨源/被嵌，老师的请求会整节课发不出去）。
   ★ 别为了省事直接放开成 '*' 或去掉本行。 */
const FRAME_ANCESTORS = "'self'";
const SECURITY_HEADERS = {
  'Content-Security-Policy': 'frame-ancestors ' + FRAME_ANCESTORS,
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self)',
};

/* ── 开发产物拒访（★ 施工单没提，2026-10-05 自查发现） ───────────────────
   这个目录同时是「源码仓库」和「发布目录」，于是整份源码跟着站点一起被托管。
   线上实测（2026-10-05）：

     /tests/audit-out.txt      → 200
     /tools/serve.js           → 200   ← 服务端脚本源码
     /package.json             → 200
     /sql/                     → 200   ← 而且**目录列表是开的**，直接列出
                                         001_device_ledger.sql / 002_phone_ledger_and_risk_queries.sql
     /_quality/                → 目录列表开放，里面是 14 个真实课件 .pptx

   这三类都不是"被看到有点尴尬"，是实打实的暴露面：
     · 服务端脚本源码 → 对方能直接读到路由与逻辑，不用猜；
     · sql/ 迁移文件名 → 泄露表命名与「设备台账 / 手机号台账与风控查询」这类业务推断；
     · _quality/ 课件名 → 产品内容资产外泄（"一块蛋糕里的数学：认识几分之一"…）。

   运行时真正需要的只有四类：css/ · js/ · vendor/ · assets/
   （index.html 三处引用 + js/app.js 里的 assets/ 引用；已 grep 确认
    _quality/ tests/ tools/ sql/ 在运行时代码里**零引用**）。其余一律不服务。

   为什么必须等路径归一化之后再判：得先拒 `..`、再做解析，
   否则 `/%2e%2e/tests/` 这类编码变体可能绕过守卫。

   为什么回 404 而不是 403：403 等于确认"文件存在，只是不给你" ——
   等于把目录结构免费画给对方看。404 什么都不承认。
   注意也不能走下面的"回落 index.html"分支，否则 /sql/ 会返回 200 的首页。 */
const DENY_TOP_DIRS = new Set(['tests', 'tools', 'sql', 'node_modules', '.git', '_quality']);
const DENY_ROOT_FILES = new Set(['package.json', 'package-lock.json', '_mut-check.js', 'HANDOFF.md']);

function isDevArtifact(pathname) {
  const segs = pathname.split(/[\\/]/).filter(Boolean);
  if (!segs.length) return false;
  // 任何点开头的段：.git / .env / .DS_Store…（本应用不依赖 .well-known）
  if (segs.some((s) => s.charAt(0) === '.')) return true;
  if (DENY_TOP_DIRS.has(segs[0])) return true;
  if (segs.length === 1 && DENY_ROOT_FILES.has(segs[0])) return true;
  return false;
}

function baseHeaders(extra) {
  return Object.assign({}, SECURITY_HEADERS, extra || {});
}

function send(res, code, body, headers) {
  const h = baseHeaders({ 'Cache-Control': 'no-store' });
  res.writeHead(code, Object.assign(h, headers || {}));
  res.end(body);
}

function etagOf(st, enc) {
  return '"' + st.size + '-' + Math.floor(st.mtimeMs) + '-' + enc + '"';
}

/* 条件请求：命中就回 304，让浏览器直接用本地副本。
   这对"改进去的冷启动"和"日常刷新"都是实打实的省流。 */
function notModified(req, etag) {
  const inm = req.headers['if-none-match'];
  if (!inm) return false;
  return String(inm).split(',').map((s) => s.trim()).indexOf(etag) >= 0;
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  } catch (e) {
    /* 乱码/不可解码的路径（例如直接塞了未编码的非 ASCII 字节）：
       当作"找不到"，不要回 400 —— 这是只读静态站，没必要求助用户修正请求。 */
    return send(res, 404, 'Not Found');
  }

  /* ★ 云服务路径不该走到这里。
     /.cloud/** 应该由平台网关直接转发给云服务（登录 / 数据库 / 存储 / 模型）。
     本脚本收到它就说明**发布方式或网关路由不对**（例如按 Node 应用发布后网关没接管该前缀）。
     这里显式回 502 并写明原因 —— 而不是像普通未知路径那样回落 index.html：
     回落 HTML 会让 SDK 收到一段 HTML 再去 JSON.parse，报出来的错和真实原因毫无关系，
     排查会被带偏很久（这类"错误现场与真因无关"的坑本项目已经踩过不止一次）。 */
  if (pathname.split(/[\\/]/)[1] === '.cloud') {
    try { console.error('[lingxi] 收到 /.cloud 请求，说明网关没有接管该前缀：' + pathname); } catch (_) {}
    return send(res, 502, 'Cloud service path reached the static server. The gateway is not routing /.cloud/** to the cloud backend.',
      { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  /* 目录穿越：先显式拒掉任何 `..` 段（纵深防御）。
     为什么不能只靠下面的 path.resolve + startsWith：
     那层判断只在"解析后落在 ROOT 之外"时才拦，而中间件/代理可能先做过规范化；
     显式拒 `..` 更直白，也更容易被审计看懂。 */
  if (pathname.split(/[\\/]/).indexOf('..') >= 0) {
    return send(res, 403, 'Forbidden');
  }

  /* 开发产物拒访。必须放在"回落 index.html"之前 —— 否则 /sql/ 会返回 200 的首页，
     看起来"这个路径是通的"，等于没拦。回 404 不回 403 的理由见上方常量处注释。 */
  if (isDevArtifact(pathname)) {
    return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  // 目录请求 → index.html
  if (pathname.endsWith('/')) pathname += 'index.html';

  // 第二层防护：解析后必须仍在 ROOT 之内（防编码变体绕过）
  const filePath = path.resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // 找不到的静态资源：SPA 场景回落到入口页；其余返回 404
      const looksLikeAsset = /\.[a-z0-9]+$/i.test(pathname);
      if (!looksLikeAsset) {
        return fs.readFile(path.join(ROOT, 'index.html'), (e2, buf) => {
          if (e2) return send(res, 404, 'Not Found');
          serveFile(req, res, buf, stHtml(), CACHE_HTML, MIME['.html']);
        });
      }
      return send(res, 404, 'Not Found');
    }
    fs.readFile(filePath, (e3, buf) => {
      if (e3) return send(res, 500, 'Internal Server Error');
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      serveFile(req, res, buf, st, pathname === '/index.html' ? CACHE_HTML : CACHE_ASSET, type);
    });
  });
});

/* 回落 index.html 时没有独立的 stat，用一个与内容绑定的伪 st，保证 ETag 稳定 */
function stHtml() {
  try { return fs.statSync(path.join(ROOT, 'index.html')); }
  catch (_) { return { size: 0, mtimeMs: 0 }; }
}

function serveFile(req, res, buf, st, cacheControl, type) {
  const enc = COMPRESSIBLE.test(type) && buf.length >= MIN_COMPRESS ? pickEncoding(req) : 'identity';
  const etag = etagOf(st, enc);
  if (notModified(req, etag)) {
    return res.writeHead(304, baseHeaders({
      'Cache-Control': cacheControl,
      'ETag': etag,
      'Vary': 'Accept-Encoding',
    })).end();
  }
  const body = encodeBody(String(st.size) + '-' + Math.floor(st.mtimeMs) + '-' + enc, buf, enc);
  const headers = baseHeaders({
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': cacheControl,
    'ETag': etag,
    /* Vary 必须带：同一个 URL 会因为 Accept-Encoding 返回不同字节，
       漏了它会让 CDN/代理把 gzip 版本发给不支持 gzip 的客户端。 */
    'Vary': 'Accept-Encoding',
  });
  if (enc !== 'identity') headers['Content-Encoding'] = enc;
  res.writeHead(200, headers);
  res.end(body);
}

server.listen(PORT, HOST, () => {
  console.log('[lingxi] 静态站点已启动：http://localhost:' + PORT + '/  （根目录 ' + ROOT + '）');
  console.log('[lingxi] 已启用：br/gzip 压缩、ETag + 条件请求、安全响应头（frame-ancestors ' + FRAME_ANCESTORS + '）');
});
