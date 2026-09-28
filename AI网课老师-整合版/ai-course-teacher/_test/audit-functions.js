const fs = require('fs');
const path = require('path');
/* ★ 2026-09-28 修：原来硬编码了**本机绝对路径**（指向一个早已不存在的工作区目录）——
   脚本一跑就 ENOENT；而且把用户名与本地目录结构写进仓库、公开出去也不合适
   （我自己的审计报告 R8 早就标注"改为相对路径"，一直没改，这里补上）。
   改为**相对本文件**推导，从此换机器、换目录都不用改。 */
const BASE = path.resolve(__dirname, '..');

const cfDir = BASE + '/cloudfunctions';
const cfs = fs.readdirSync(cfDir).filter(d => fs.existsSync(path.join(cfDir, d, 'index.js')));
console.log('云函数总数:', cfs.length);

const mpDir = BASE + '/miniprogram';
const called = new Set();
function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (f.endsWith('.js')) {
      const c = fs.readFileSync(p, 'utf8');
      const re = /callFunction\(\{\s*name:\s*['"]([^'"]+)['"]/g;
      let m;
      while ((m = re.exec(c))) called.add(m[1]);
    }
  });
}
walk(mpDir);
console.log('前端调用的云函数:', called.size, '个');
console.log([...called].sort().join(', '));

const unused = cfs.filter(n => !called.has(n));
console.log('\n未被前端直接调用的云函数(' + unused.length + '):');
unused.forEach(n => console.log('  -', n));

// 反向：前端调了但不存在的云函数
const missing = [...called].filter(n => !cfs.includes(n));
console.log('\n前端调用但目录不存在的云函数(' + missing.length + '):');
missing.forEach(n => console.log('  -', n));
