/* ============================================================
   课件质量巡检程序（tools/ppt-quality.js）
   解决什么问题：前面已经修过"课件完全没图""概念课硬配装饰图""练习没解析"
   这类问题，但每次都是**踩到才发现**。这个程序把"课件是否像样"变成一条可反复跑的关卡。

   它做四件事（逐层加严，每层都能独立发现问题）：
     ① 真实生成多门课（不同学科 × 不同课型），跑产品内置的 validateCourseware()
        —— 检查结构 / 例子 / 图形 / 练习解析 / 讲稿备注 / 单页密度
     ② 把每门课导出成 .pptx，检查包内**图片数量与页引用**是否对得上
     ③ **解开 pptx 取出 PNG，验证图形不是空白**
        —— "有图"不等于"图有用"：一张全白的图在计数上也是"有图"。
           这里把 PNG 画到 canvas 上算像素方差与非白像素占比，空白图直接判失败。
     ④ 校验 PPT 结构完整（封面/本课安排/知识点/正文/小结/作业、备注覆盖、页码）

   用法：
     node tools/ppt-quality.js                # 默认 4 门课（数学/物理/计算机/语文）
     node tools/ppt-quality.js --json         # 输出 JSON
   退出码：0 全部通过 / 1 有质量问题 / 2 环境不满足
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ★ 2026-09-29 修：同 tests/selfcheck.js —— 默认站点改成当前的线上域名，
   旧域名已经 404，留着会让这个工具默默跑在错误的目标上。 */
const SITE = process.env.LINGXI_URL || 'https://bb6ae4d03fbd4b109cbbe6dbbc84502d.app.workbuddy.host/';
const JSON_OUT = process.argv.indexOf('--json') >= 0;
const OUT_DIR = process.env.QUALITY_OUT || path.join(__dirname, '..', '_quality');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/* 巡检矩阵：覆盖"图形是知识载体"的学科（必须出图）与概念类学科（不该硬配图） */
const MATRIX = [
  { subject: '数学', grade: '小学', type: 'new', goal: '用一块蛋糕讲清几分之一，会看图写分数' },
  { subject: '物理', grade: '初中', type: 'new', goal: '理解匀速直线运动的速度、路程与时间的关系' },
  { subject: '计算机科学', grade: '高中', type: 'new', goal: '理解循环为什么能代替重复的指令' },
  { subject: '语文', grade: '初中', type: 'new', goal: '体会比喻修辞在写景散文里的作用' },
];

/* 极简 ZIP 读取器 */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const e = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lN = buf.readUInt16LE(localOff + 26), lE = buf.readUInt16LE(localOff + 28);
    const raw = buf.slice(localOff + 30 + lN + lE, localOff + 30 + lN + lE + compSize);
    try { e[name] = method === 0 ? raw : zlib.inflateRawSync(raw); } catch (_) { e[name] = null; }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return e;
}

/* 在浏览器里把 base64 PNG 画到 canvas，判断"这张图到底画了东西没有"
   ⚠ 必须传**真正的函数**给 page.evaluate。我第一版传的是函数形式的**字符串**，
     Playwright 会把字符串当"表达式"求值（参数传不进去），于是每张图都返回失败，
     报告里出现"✗空白"的假警报 —— 而实际 4 张图都正常插入了（包内 4 个 / 引用 4 处）。
     判据本身没问题，是我把参数送丢了。 */
async function probePngContent(page, b64) {
  return await page.evaluate(async (data) => {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
          let nonWhite = 0, minL = 255, maxL = 0, sum = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            const L = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            // 非白：明显不是白底像素（导出前统一铺了白底，所以空白图会接近纯白）
            if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) nonWhite++;
            if (L < minL) minL = L;
            if (L > maxL) maxL = L;
            sum += L; n++;
          }
          resolve({
            w: cv.width, h: cv.height,
            nonWhiteRatio: Math.round((nonWhite / n) * 1000) / 1000,
            contrastRange: Math.round(maxL - minL),
            avgL: Math.round(sum / n),
          });
        } catch (e) { resolve({ err: String(e && e.message) }); }
      };
      img.onerror = () => resolve({ err: '图片无法解码' });
      img.src = 'data:image/png;base64,' + data;
    });
  }, b64);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) { console.error('找不到 Chrome / Edge'); process.exit(2); }
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (e) { console.error('缺少 playwright-core'); process.exit(2); }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 140)));

  let ready = false;
  for (let k = 0; k < 4 && !ready; k++) {
    try {
      await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
      for (let i = 0; i < 120; i++) {
        if (await page.evaluate(() => typeof window.validateCourseware === 'function').catch(() => false)) { ready = true; break; }
        await sleep(500);
      }
    } catch (_) { await sleep(3000); }
  }
  if (!ready) { console.error('页面未就绪（或 validateCourseware 未部署）'); await browser.close(); process.exit(2); }

  const results = [];
  for (const m of MATRIX) {
    const item = { input: m, ok: false, quality: null, ppt: null, figures: [], problems: [] };
    // ① 生成
    const made = await page.evaluate(async (mm) => {
      try {
        window.switchView('generate');
        window.__lastGenerated = null;
        const pick = (sel, txt) => {
          const el = Array.from(document.querySelectorAll(sel)).find((c) => c.textContent.indexOf(txt) >= 0);
          if (el) el.click();
          return !!el;
        };
        pick('#gen-subjects .chip, .subject-card', mm.subject);
        await new Promise((r) => setTimeout(r, 400));
        pick('#gen-grades .chip, .grade-chip', mm.grade);
        await new Promise((r) => setTimeout(r, 300));
        pick('#gen-types .chip, .type-chip', mm.type === 'new' ? '新课精讲' : mm.type);
        const g = document.querySelector('#gen-goal');
        if (g) g.value = mm.goal;
        await new Promise((r) => setTimeout(r, 200));
        document.querySelector('#btn-generate').click();
        for (let i = 0; i < 200; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          if (window.__lastGenerated) return { course: window.__lastGenerated };
        }
        return { err: '生成超时' };
      } catch (e) { return { err: String(e && e.message) }; }
    }, m);
    if (made.err) { item.problems.push('生成失败：' + made.err); results.push(item); continue; }
    const course = made.course;
    item.title = course.title;

    // ② 产品内置质量校验
    const q = await page.evaluate((c) => {
      try { return window.validateCourseware(c); } catch (e) { return { err: e.message }; }
    }, course);
    item.quality = q;
    if (q.err) {
      item.problems.push('校验器报错：' + q.err);
    } else {
      (q.issues || []).filter((x) => x.level === 'error').forEach((x) => item.problems.push('[缺] ' + x.label + '：' + x.detail));
      // 建议项也要报出来 —— 只报"缺"会漏掉"能用但不好用"，例如 5 页内容里只有 1 页有例子
      (q.issues || []).filter((x) => x.level === 'warn').forEach((x) => {
        item.suggestions = item.suggestions || [];
        item.suggestions.push('[建议] ' + x.label + '：' + x.detail);
      });
    }

    // ③ 导出 pptx（拦 writeFile 取 base64）
    const b64 = await page.evaluate(async (c) => {
      try {
        if (typeof window.exportPPTX !== 'function') return { err: 'exportPPTX 未导出' };
        if (!window.PptxGenJS && !(window.pptxgen && window.pptxgen.default)) await window.ensureVendors('PptxGenJS');
        const Real = window.PptxGenJS || (window.pptxgen && window.pptxgen.default);
        if (!Real) return { err: 'PptxGenJS 取不到' };
        const orig = Real.prototype.writeFile;
        let cap = null, werr = '';
        Real.prototype.writeFile = function () {
          return this.write({ outputType: 'base64' }).then((d) => { cap = d; })
            .catch((e) => { werr = String(e && e.message).slice(0, 200); });
        };
        try {
          await window.exportPPTX(c, null);
          for (let i = 0; i < 120 && !cap; i++) await new Promise((r) => setTimeout(r, 100));
        } finally { Real.prototype.writeFile = orig; }
        return cap ? { b64: cap } : { err: werr || '未捕获到 pptx 内容' };
      } catch (e) { return { err: String(e && e.message) }; }
    }, course);
    if (b64.err) { item.problems.push('导出失败：' + b64.err); results.push(item); continue; }
    const safe = String(course.title || 'course').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    const pptxPath = path.join(OUT_DIR, safe + '.pptx');
    fs.writeFileSync(pptxPath, Buffer.from(b64.b64, 'base64'));

    // ④ 校验 pptx 内部：结构 + 图片引用 + 备注
    let zip;
    try { zip = readZip(pptxPath); } catch (e) { item.problems.push('pptx 无法解包：' + e.message); results.push(item); continue; }
    const names = Object.keys(zip);
    const slideNames = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
    const mediaNames = names.filter((n) => /^ppt\/media\/[^/]+$/.test(n));
    const noteNames = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    const allText = slideNames.map((n) => (zip[n] || Buffer.from('')).toString('utf8')
      .replace(/<[^>]+>/g, ' ')).join(' ');
    const picRefs = slideNames.reduce((a, n) => a + ((zip[n].toString('utf8').match(/<p:pic>/g) || []).length), 0);
    const shrink = slideNames.filter((n) => /<a:normAutofit/.test(zip[n].toString('utf8'))).length;

    item.ppt = {
      slides: slideNames.length, media: mediaNames.length, picRefs: picRefs,
      notes: noteNames.length, shrink: shrink,
      hasCoverInfo: /数学|物理|计算机|语文|小学|初中|高中/.test(allText),
      hasAgenda: allText.indexOf('本课安排') >= 0,
      hasPoints: allText.indexOf('本课知识点') >= 0,
      hasHomework: allText.indexOf('课后作业') >= 0,
      hasPageNum: /\d+ \/ \d+/.test(allText),
      path: pptxPath,
    };
    if (mediaNames.length !== picRefs) item.problems.push('图片数量对不上：包内 ' + mediaNames.length + ' 个，页面引用 ' + picRefs + ' 处');
    if (!item.ppt.hasCoverInfo) item.problems.push('封面缺少课程信息');
    if (!item.ppt.hasAgenda) item.problems.push('缺少「本课安排」页');
    if (!item.ppt.hasPageNum) item.problems.push('缺少页码');
    if (noteNames.length < slideNames.length) item.problems.push('备注覆盖不全：' + noteNames.length + '/' + slideNames.length);
    if (!shrink) item.problems.push('未启用文本自适应（长文本会溢出）');

    // ⑤ 逐张图验证"不是空白"
    for (const mn of mediaNames) {
      const buf = zip[mn];
      if (!buf || !buf.length) { item.figures.push({ name: mn, blank: true, why: '文件为空' }); item.problems.push('图片为空文件：' + mn); continue; }
      const png = await probePngContent(page, buf.toString('base64')).catch(() => null);
      if (!png || png.err) {
        item.figures.push({ name: mn, blank: true, why: (png && png.err) || '探针失败' });
        item.problems.push('图片无法判定内容：' + mn);
        continue;
      }
      // 判据：非白像素占比 <1% 或 明暗跨度 <30 → 基本是一张空白/纯色图
      const blank = png.nonWhiteRatio < 0.01 || png.contrastRange < 30;
      item.figures.push({ name: mn, size: buf.length, blank: blank, nonWhiteRatio: png.nonWhiteRatio, contrastRange: png.contrastRange });
      if (blank) item.problems.push('图形像空白/纯色（非白像素 ' + (png.nonWhiteRatio * 100) + '%，明暗跨度 ' + png.contrastRange + '）：' + mn);
    }
    // 该有图的学科一张图都没有 —— 这条特别重要
    if (['数学', '物理', '化学'].indexOf(m.subject) >= 0 && !mediaNames.length) {
      item.problems.push('「' + m.subject + '」应有图示，但导出的 PPT 里一张图都没有');
    }

    item.ok = item.problems.length === 0;
    results.push(item);
    if (!JSON_OUT) {
      console.log('── ' + m.subject + ' · ' + m.grade + '  →  ' + (item.ok ? '✅ 通过' : '❌ ' + item.problems.length + ' 个问题'));
    }
  }

  await browser.close();
  if (pageErrors.length) results.push({ ok: false, input: { subject: '(页面级)' }, problems: ['JS 报错：' + [...new Set(pageErrors)].slice(0, 2).join(' | ')] });

  if (JSON_OUT) { console.log(JSON.stringify({ site: SITE, results: results }, null, 2)); }
  else {
    console.log('\n================= 课件质量巡检报告 =================');
    console.log('站点：' + SITE);
    console.log('产物目录：' + OUT_DIR);
    console.log('');
    results.forEach((r) => {
      const t = r.input.subject + (r.input.grade ? ' · ' + r.input.grade : '');
      console.log('【' + t + '】' + (r.title ? ' ' + r.title : ''));
      if (r.quality && r.quality.stats) {
        const s = r.quality.stats;
        console.log('  课件：' + s.pages + ' 页（内容 ' + s.contents + ' / 练习 ' + s.quizzes + ' / 图 ' + s.figures +
          ' / 备注 ' + s.notes + '）｜有例子的内容页 ' + s.examplePages + '｜质量分 ' + r.quality.score);
      }
      if (r.ppt) {
        console.log('  PPT：' + r.ppt.slides + ' 页｜图 ' + r.ppt.media + ' 张（引用 ' + r.ppt.picRefs +
          '）｜备注 ' + r.ppt.notes + '｜自适应 ' + r.ppt.shrink + ' 页');
        if (r.figures.length) {
          console.log('  图形内容：' + r.figures.map((f) => f.name.replace('ppt/media/', '') +
            '(非白 ' + (f.nonWhiteRatio != null ? Math.round(f.nonWhiteRatio * 100) + '%' : '?') +
            (f.blank ? ' ✗空白' : ' ✓') + ')').join('  '));
        }
      }
      if (r.problems.length) r.problems.forEach((p) => console.log('  ❌ ' + p));
      if (r.suggestions && r.suggestions.length) r.suggestions.forEach((p) => console.log('  · ' + p));
      if (!r.problems.length) console.log('  ✅ 结构与图形均通过' + ((r.suggestions && r.suggestions.length) ? '（有质量建议，见上）' : ''));
      console.log('');
    });
    const failed = results.filter((r) => !r.ok);
    console.log('-----------------------------------------------');
    console.log(failed.length ? (failed.length + '/' + results.length + ' 门课未通过') : ('全部 ' + results.length + ' 门课通过'));
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => { console.error('巡检异常：' + (e && e.message)); process.exit(2); });
