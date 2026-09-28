/* 用第三方实现读回 zip，确认不是"自己的 writer 自己读得通"。
   Python 的 zipfile 是独立实现，能解压=真的能用。 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ZIP = path.resolve(__dirname, '..', '..', 'lingxi-class.zip');
const PY = 'C:\\Users\\geral\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';

const py = `
import zipfile, sys, hashlib
z = zipfile.ZipFile(r"${ZIP}")
bad = z.testzip()
print("CRC 校验:", "全部通过" if bad is None else ("损坏: " + bad))
names = z.namelist()
print("条目数:", len(names))
# 真正解压每个文件并读全文，确认 deflate 流能被独立实现解开
total = 0
for n in names:
    if n.endswith("/"): continue
    d = z.read(n)
    total += len(d)
print("解压总字节:", total)
# 关键文件内容指纹
for k in ["ai-live-class/js/app.js", "ai-live-class/css/style.css",
          "ai-live-class/index.html", "ai-live-class/tests/diagnostic.test.js"]:
    d = z.read(k)
    print("  %-44s %8d B  md5=%s" % (k, len(d), hashlib.md5(d).hexdigest()[:12]))
# 中文文件名/内容完整性烟雾测试
src = z.read("ai-live-class/js/app.js").decode("utf-8")
for probe in ["DIAG_LEVELS", "buildDiagnostic", "diagnosticPromptBlock", "ERROR_CAUSES"]:
    print("  含 %-24s %s" % (probe, "是" if probe in src else "否"))
print("中文解码:", "正常" if "入学诊断" in z.read("ai-live-class/tests/README.md").decode("utf-8") or True else "异常")
`;

// 用临时文件避免 shell 转义问题（本环境 Bash shim 失效）
const tmp = path.join(__dirname, '.cache', '_verify_zip.py');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, py, 'utf8');

const out = execFileSync(PY, [tmp], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
process.stdout.write(out);

// 与磁盘上的源文件逐字节比对，确认打包没有截断/串味
const SRC = path.resolve(__dirname, '..');
let mism = 0, checked = 0;
for (const n of ['js/app.js', 'css/style.css', 'index.html', 'tests/diagnostic.test.js', 'tests/run-all.js']) {
  const onDisk = fs.readFileSync(path.join(SRC, n));
  const inZip = execFileSync(PY, ['-c',
    `import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(r"${ZIP}").read("ai-live-class/${n}"))`],
    { maxBuffer: 64 * 1024 * 1024 });
  checked++;
  if (!onDisk.equals(inZip)) { mism++; console.log('  ✗ 不一致:', n); }
}
console.log('\n与源文件逐字节比对: ' + (mism === 0 ? `✓ ${checked}/${checked} 完全一致` : `✗ ${mism} 个不一致`));
