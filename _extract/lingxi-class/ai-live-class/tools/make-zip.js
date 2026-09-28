/* 打 zip：把 ai-live-class 源码 + 测试 + 工具打包，排除运行产物
   （探针截图 / CDP 缓存 / node_modules / 上次的 report）。
   用 Node 直接写 zip（stored，无压缩依赖）——
   本环境 Bash shim 失效、没有 zip 命令。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* __dirname = ai-live-class/tools，所以 ROOT 就是 ai-live-class 本身。
   打包时条目名带上 'ai-live-class/' 前缀，解压后是完整项目目录。 */
const SRC = path.resolve(__dirname, '..');
const OUT = path.resolve(SRC, '..', 'lingxi-class.zip');
const PREFIX = 'ai-live-class/';

/* 排除规则：运行产物不进包 */
const EXCLUDE_FILES = /(^|\/)(layout-report\.txt|audit-out\.txt)$|\.png$/;
const EXCLUDE_DIRS = /(^|\/)(\.cache|node_modules|\.git)(\/|$)/;

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(SRC, full).split(path.sep).join('/');
    if (EXCLUDE_DIRS.test(rel)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    if (EXCLUDE_FILES.test(rel)) continue;
    files.push({ rel: PREFIX + rel, full, size: st.size, mtime: st.mtime });
  }
})(SRC);

/* --- 最小 zip writer（deflate） --- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
/* DOS 时间戳 */
function dosTime(d) {
  const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  const dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  return { t, dt };
}

/* 目录条目（保证解压后目录结构存在）—— 顶层 'ai-live-class/' 也要显式建 */
const dirs = new Set([PREFIX]);
files.forEach((f) => {
  const parts = f.rel.split('/');
  for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/');
});

const chunks = [];
const central = [];
let offset = 0;

function addEntry(name, data, isDir, mtime) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = isDir ? 0 : crc32(data);
  const raw = isDir ? Buffer.alloc(0) : data;
  const comp = isDir ? Buffer.alloc(0) : zlib.deflateRawSync(raw, { level: 9 });
  const method = isDir ? 0 : 8;
  const { t, dt } = dosTime(mtime || new Date());

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);           // version needed
  lh.writeUInt16LE(0x0800, 6);       // UTF-8 flag
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(t, 10);
  lh.writeUInt16LE(dt, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);

  chunks.push(lh, nameBuf, comp);
  const localOffset = offset;
  offset += lh.length + nameBuf.length + comp.length;

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(t, 12);
  ch.writeUInt16LE(dt, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(raw.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34);
  ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE(isDir ? 0x10 : 0x20, 38);  // external attrs
  ch.writeUInt32LE(localOffset, 42);
  central.push(ch, nameBuf);
  return comp.length;
}

// 目录在前（顺序更像正常 zip）
[...dirs].sort().forEach((d) => addEntry(d, null, true));
files.sort((a, b) => a.rel.localeCompare(b.rel)).forEach((f) => {
  addEntry(f.rel, fs.readFileSync(f.full), false, f.mtime);
});

const centralBuf = Buffer.concat(central);
const centralOffset = offset;

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(dirs.size + files.length, 8);
eocd.writeUInt16LE(dirs.size + files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(centralOffset, 16);
eocd.writeUInt16LE(0, 20);

fs.writeFileSync(OUT, Buffer.concat([...chunks, centralBuf, eocd]));

/* 校验：读回 central directory 确认条目与文件名正确 */
const b = fs.readFileSync(OUT);
const names = [];
let i = 0;
while ((i = b.indexOf(Buffer.from('PK\x01\x02'), i)) >= 0) {
  const nlen = b.readUInt16LE(i + 28);
  names.push(b.slice(i + 46, i + 46 + nlen).toString('utf8'));
  i += 46 + nlen;
}
console.log('zip 写出:', path.basename(OUT), (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB');
console.log('条目数:', names.length, '（目录 ' + dirs.size + ' + 文件 ' + files.length + '）');
console.log('\n--- 文件清单 ---');
names.filter((n) => !n.endsWith('/')).forEach((n) => console.log('  ' + n));
const want = ['ai-live-class/js/app.js', 'ai-live-class/css/style.css', 'ai-live-class/index.html',
  'ai-live-class/tests/diagnostic.test.js', 'ai-live-class/tests/README.md', 'ai-live-class/tests/run-all.js',
  'ai-live-class/tools/make-zip.js'];
console.log('\n--- 关键文件自检 ---');
want.forEach((w) => console.log('  ' + (names.includes(w) ? '✓' : '✗') + ' ' + w));
const mustNot = names.filter((n) => /\.png$|audit-out\.txt$|layout-report\.txt$|\/\.cache\/|node_modules/.test(n));
console.log('--- 不应进包的产物 ---');
console.log('  ' + (mustNot.length === 0 ? '✓ 干净（无 png / report / .cache / node_modules）' : '✗ 发现 ' + mustNot.length + ' 个: ' + mustNot.join(', ')));
