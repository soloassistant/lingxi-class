/* 零依赖静态文件服务器 —— 只为两件事存在：
   ① 部署平台需要一个 `start` 脚本来托管这个站点
      （★ 踩过的坑：本项目本来是纯静态站、没有 package.json，平台默认按静态站托管；
       一旦为了跑测试加了 package.json，平台就改判成"Node 应用"去找 `npm start`，
       找不到就报 "Missing script: start" 而起不来 —— 所以这个脚本是必需的，不是多余的文件。）
   ② 给本地开发一个统一的启动方式，不用再记 `python -m http.server`。

   用法：npm start        （默认 3000 端口，遵循平台的 PORT 环境变量）
   这个服务器只读、不写，不做任何业务逻辑。 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-cache' }, headers || {}));
  res.end(body);
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

  /* 目录穿越：先显式拒掉任何 `..` 段（纵深防御）。
     为什么不能只靠下面的 path.resolve + startsWith：
     那层判断只在"解析后落在 ROOT 之外"时才拦，而中间件/代理可能先做过规范化；
     显式拒 `..` 更直白，也更容易被审计看懂。 */
  if (pathname.split(/[\\/]/).indexOf('..') >= 0) {
    return send(res, 403, 'Forbidden');
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
          send(res, 200, buf, { 'Content-Type': MIME['.html'] });
        });
      }
      return send(res, 404, 'Not Found');
    }
    fs.readFile(filePath, (e3, buf) => {
      if (e3) return send(res, 500, 'Internal Server Error');
      send(res, 200, buf, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': buf.length,
      });
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log('[lingxi] 静态站点已启动：http://localhost:' + PORT + '/  （根目录 ' + ROOT + '）');
});
