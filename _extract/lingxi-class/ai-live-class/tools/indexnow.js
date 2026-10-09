#!/usr/bin/env node
/* tools/indexnow.js —— 主动把线上 URL 推送给 IndexNow

   ===== 它是什么、解决什么 =====
   IndexNow 是一个「推送式」收录协议：内容变了就主动通知搜索引擎来抓，
   不用等爬虫按自己的节奏发现。一次提交会**自动同步给所有参与引擎**：
     Bing / Yandex / Naver / Seznam / Yep
   ⚠ **Google 不支持** IndexNow（2021 年测过，至今未采纳）——
     所以这不是"提交一次全站被收录"，Google 那边仍要靠 sitemap + 自然抓取。
     本项目页面还需要登录才能用，搜索引擎能看到的只是落地页，
     因此 IndexNow 的实际收益是「落地页改版后，Bing 系能较快重新抓取」。

   ===== 协议要点（来源：indexnow.org/documentation，2026-10-09 核实）=====
   · key：8～128 个字符，只允许 a-z A-Z 0-9 与连字符
   · 所有权验证：必须在本站**根目录**放一个 UTF-8 文本文件 `{key}.txt`，
     内容就是 key 本身。（也可放别处并用 keyLocation 声明，但官方**强烈推荐**根目录方案）
   · 提交：POST JSON 到 https://api.indexnow.org/indexnow
       { host, key, urlList: [...] }     单次 ≤ 10,000 条
   · 状态码：
       200 已接收          | 202 已收到、key 校验中（首次提交常见）
       400 请求格式错      | 403 key 无效 / key 文件里不是这个 key
       422 URL 不属于该 host 或 key 格式不符 | 429 被限流（疑似 spam）

   ===== 用法 =====
     node tools/indexnow.js --init      生成 key + 写 {key}.txt + 写配置文件
     node tools/indexnow.js --check     只校验线上 key 文件是否可达且内容正确
     node tools/indexnow.js --dry-run   只打印将提交的内容，不发请求
     node tools/indexnow.js             真提交（先自动做 --check）
     node tools/indexnow.js --urls "https://a/,https://b/"   临时覆盖 URL 列表

   ★ 顺序不可颠倒：**先发布（让 {key}.txt 上线）→ 再提交**。
     否则引擎抓不到 key 文件，必然回 403。

   ★ 与"那个坏示例"的区别：本脚本**不吞掉结果** —— 每个状态码都打印可行动的处置建议，
     网络错误 / 429 / 5xx 会退避重试，最终失败会以非 0 退出码结束（能被自动化捕获）。
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const APP = path.join(__dirname, '..');
const CONFIG = path.join(__dirname, 'indexnow.config.json');
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const log = console.log;
const die = (m, code = 1) => { console.error('✗ ' + m); process.exit(code); };

/* 状态码 -> 人话 + 下一步怎么办 */
const STATUS = {
  200: { ok: true, msg: '已接收（注意：只代表"收到了"，不代表已收录）' },
  202: { ok: true, msg: '已收到，key 校验中 —— 首次提交常见，属正常' },
  400: { ok: false, msg: '请求格式错误 —— 检查 JSON 字段与 URL 是否合法（可能是本脚本的 bug）' },
  403: { ok: false, msg: 'key 无效：根目录找不到 {key}.txt，或文件内容与 key 不一致 —— 先跑 --check' },
  422: { ok: false, msg: 'URL 不属于该 host，或 key 格式不符（须 8~128 位 a-zA-Z0-9-）' },
  429: { ok: false, msg: '被限流（疑似 spam）—— 降低提交频率后重试' },
};

function loadConfig() {
  if (!fs.existsSync(CONFIG)) return null;
  const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (c.key && !/^[a-zA-Z0-9-]{8,128}$/.test(c.key)) die('配置里的 key 不合规（须 8~128 位 a-zA-Z0-9-）：' + c.key);
  return c;
}

function httpRequest(method, url, body, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: data
        ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length }
        : {},
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（' + timeout + 'ms）')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── --init：生成 key、落地 key 文件与配置 ───────────────────────────── */
function cmdInit() {
  if (fs.existsSync(CONFIG)) {
    const c = loadConfig();
    log('配置已存在，未改动：' + CONFIG);
    log('  key      : ' + c.key);
    log('  key 文件 : ' + c.keyFile);
    return;
  }
  const key = crypto.randomBytes(16).toString('hex');   // 32 位十六进制，落在 8~128 区间内
  const keyFile = key + '.txt';
  // ★ 内容就是 key 本身；**不写结尾换行**，避免个别引擎把 \n 也算进内容导致 403
  fs.writeFileSync(path.join(APP, keyFile), key, 'utf8');

  const origin = process.env.INDEXNOW_ORIGIN || 'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host';
  const cfg = {
    host: new URL(origin).hostname,
    origin,
    key,
    keyFile,
    endpoint: ENDPOINT,
    /* 本站是单页应用：搜索引擎能看到的入口就一个。
       若将来拆出独立落地页 / 博客，把 URL 加到这里即可（单次上限 10,000 条）。 */
    urls: [origin + '/'],
    note: 'key 是公开的所有权验证值（线上 {key}.txt 就是它的明文），不是密钥。改 key 后引擎最长缓存 24h。',
  };
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  log('✓ 已生成 key 与配置文件');
  log('  key 文件 : ' + path.join(APP, keyFile) + '（内容就是 key，无换行）');
  log('  配置     : ' + CONFIG);
  log('\n下一步：发布站点让 {key}.txt 上线，然后跑 node tools/indexnow.js');
}

/* ── --check：线上 key 文件是否可达且内容正确 ─────────────────────────── */
async function cmdCheck(cfg, quiet) {
  const url = cfg.origin + '/' + cfg.keyFile;
  let r;
  try {
    r = await httpRequest('GET', url, null, 15000);
  } catch (e) {
    if (!quiet) log('  ✗ 无法访问 ' + url + '（' + e.message + '）');
    return false;
  }
  const body = (r.body || '').trim();
  const ok = r.status === 200 && body === cfg.key;
  if (!quiet) {
    log('  校验 ' + url);
    log('    HTTP ' + r.status + '，内容 ' + JSON.stringify(body.slice(0, 80)) + (body.length > 80 ? '…' : ''));
    if (ok) log('    ✓ 与配置里的 key 一致');
    else if (r.status !== 200) log('    ✗ 文件不可达（尚未发布？根目录文件名必须是 ' + cfg.keyFile + '）');
    else log('    ✗ 内容与 key 不一致 —— 引擎会回 403');
  }
  return ok;
}

/* ── 提交（含退避重试；不吞错误）────────────────────────────────────── */
async function cmdPush(cfg, urls) {
  log('▶ 先校验 key 文件在线情况');
  const ok = await cmdCheck(cfg);
  if (!ok) {
    die('key 文件未就绪，已中止提交。\n  顺序必须是：发布（让 ' + cfg.keyFile +
      ' 上线）→ 再提交。否则 IndexNow 必然回 403。');
  }
  const payload = { host: cfg.host, key: cfg.key, urlList: urls };
  log('\n▶ 提交 ' + urls.length + ' 条 URL 到 ' + cfg.endpoint);
  urls.forEach((u) => log('    ' + u));

  const delays = [1000, 4000];
  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    let r;
    try {
      r = await httpRequest('POST', cfg.endpoint, payload, 20000);
    } catch (e) {
      if (attempt <= delays.length) {
        log('  · 第 ' + attempt + ' 次失败（' + e.message + '），' + delays[attempt - 1] + 'ms 后重试');
        await sleep(delays[attempt - 1]);
        continue;
      }
      die('提交失败：' + e.message + '\n  （网络层问题，与 key/URL 无关；稍后重跑本命令即可）');
    }
    const info = STATUS[r.status] || { ok: false, msg: '未知状态码' };
    if (info.ok) {
      log('\n✓ HTTP ' + r.status + ' ' + info.msg);
      return true;
    }
    // 429 / 5xx 属"可重试"
    const retriable = r.status === 429 || (r.status >= 500 && r.status < 600);
    if (retriable && attempt <= delays.length) {
      log('  · HTTP ' + r.status + '（' + info.msg + '），' + delays[attempt - 1] + 'ms 后重试');
      await sleep(delays[attempt - 1]);
      continue;
    }
    log('\n✗ HTTP ' + r.status + ' ' + info.msg);
    if (r.body) log('  响应体：' + r.body.slice(0, 300));
    process.exit(2);
  }
}

(async () => {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

  if (has('--init')) return cmdInit();

  const cfg = loadConfig();
  if (!cfg) die('找不到 ' + CONFIG + '，先跑 node tools/indexnow.js --init');
  if (!fs.existsSync(path.join(APP, cfg.keyFile))) {
    log('⚠ 本地缺少 key 文件 ' + cfg.keyFile + '（可能被误删）—— 正在补回');
    fs.writeFileSync(path.join(APP, cfg.keyFile), cfg.key, 'utf8');
  }

  if (has('--check')) { const ok = await cmdCheck(cfg); process.exit(ok ? 0 : 2); }

  const urls = (argVal('--urls') ? argVal('--urls').split(',') : cfg.urls).map((s) => s.trim()).filter(Boolean);

  if (has('--dry-run')) {
    log('（dry-run，不发请求）');
    log('POST ' + cfg.endpoint);
    log(JSON.stringify({ host: cfg.host, key: cfg.key, urlList: urls }, null, 2));
    log('\nkey 文件应为：' + cfg.origin + '/' + cfg.keyFile);
    return;
  }

  await cmdPush(cfg, urls);
})().catch((e) => die(e.stack || e.message));
