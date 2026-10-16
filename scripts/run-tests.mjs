#!/usr/bin/env node
/**
 * 门禁的测试执行器：发现 verify/**\/*.test.mjs，按**有界并发**跑完，任一失败即非零退出。
 *
 * 为什么把这段从 release.ps1 里搬出来（原来是一个 PowerShell foreach 循环）：
 *   1. **原来的循环没有超时**。某个测试一旦挂住（socket 没关、await 永不到头），门禁就永远
 *      不返回——发布流程卡死，而且没有任何输出说明卡在哪。这里给每个测试一个硬超时。
 *   2. 22 个测试是**互不依赖的独立进程**（都写系统 tmpdir、都用 listen(0) 拿临时端口、
 *      没有任何跨测试共享状态），串行跑纯属浪费。实测并发 4 能到 ~2.7x。
 *   3. PowerShell 里做进程池 + 超时 + 输出收集很容易写出难维护的代码；交给 node 更直白，
 *      也能被 verify/ 下的测试直接覆盖（伪造测试目录来验证「失败会被抓住」）。
 *
 * 有意保留的保守点：
 *   - 并发上限默认 min(4, CPU 数)：并发越高收益越小，而发布门禁最怕的是假绿/假红，
 *     不是多等一秒。可用 --jobs 覆盖（CI 或本地调参）。
 *   - 发现数低于下限（默认 20）视为**门禁失效**并直接失败：目录改名/被清空时，
 *     「0 个测试全绿」比「测试挂了」更危险，因为它看起来和成功一模一样。
 *   - 每个测试的 stdout 都会保留并在失败时打印；顺序输出，便于定位。
 *
 * 用法：
 *   node scripts/run-tests.mjs                     # 跑 verify/**\/*.test.mjs
 *   node scripts/run-tests.mjs --jobs 8
 *   node scripts/run-tests.mjs --dir <目录> --min 0   # 供测试用的夹具模式
 *   node scripts/run-tests.mjs --timeout-ms 60000
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const opts = { dir: path.join(repoRoot, "verify"), jobs: Math.max(1, Math.min(4, cpus().length)), min: 20, timeoutMs: 120000 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--dir") { opts.dir = path.resolve(value); i += 1; }
    else if (key === "--jobs") { opts.jobs = Math.max(1, Number(value) || 1); i += 1; }
    else if (key === "--min") { opts.min = Number(value) || 0; i += 1; }
    else if (key === "--timeout-ms") { opts.timeoutMs = Math.max(1000, Number(value) || 120000); i += 1; }
    else if (key === "--help" || key === "-h") { opts.help = true; }
  }
  return opts;
}

/** 递归发现 *.test.mjs —— **必须递归**：不递归时子目录里的测试一次都不会跑，而门禁照样打勾。 */
function discover(dir) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(current, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(full);
      else if (name.endsWith(".test.mjs")) found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

function runOne(file, timeoutMs) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    const finish = (code, signal) => {
      clearTimeout(timer);
      resolve({
        file,
        ms: Number(process.hrtime.bigint() - started) / 1e6,
        code: timedOut ? 124 : (code ?? (signal ? 1 : 0)),
        timedOut,
        out
      });
    };
    child.on("error", (error) => { clearTimeout(timer); resolve({ file, ms: 0, code: 1, timedOut: false, out: `spawn 失败：${error.message}` }); });
    child.on("close", finish);
  });
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log("用法：node scripts/run-tests.mjs [--dir <目录>] [--jobs N] [--min N] [--timeout-ms N]");
  process.exit(0);
}

const tests = discover(opts.dir);
const rel = (file) => path.relative(repoRoot, file).replace(/\\/g, "/");

// 目录不存在必须单独报错，而不是让它退化成「发现了 0 个测试」：
// 后者在 --min 0 时（以及下限被误调小之后）就是一次假绿，而且报错信息会指向
// 「数量不足」这个错误的方向，掩盖真正的原因（路径算错/目录没同步过来）。
try {
  if (!statSync(opts.dir).isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`测试目录不存在或不是目录：${opts.dir}`);
  console.error("门禁在这种状态下必须失败——「0 个测试」不是「全部通过」。");
  process.exit(2);
}

if (tests.length < opts.min) {
  console.error(`只发现 ${tests.length} 个 *.test.mjs（下限 ${opts.min}）于 ${opts.dir}`);
  console.error("这通常意味着测试目录被改名/被清空/路径算错——门禁在这种状态下必须失败，不能报绿。");
  process.exit(2);
}

console.log(`发现 ${tests.length} 个测试，并发 ${opts.jobs}，单个超时 ${opts.timeoutMs} ms`);

const startedAll = process.hrtime.bigint();
const results = new Array(tests.length);
let cursor = 0;
const workers = Array.from({ length: Math.min(opts.jobs, tests.length) }, async () => {
  while (true) {
    const mine = cursor;
    cursor += 1;
    if (mine >= tests.length) return;
    const result = await runOne(tests[mine], opts.timeoutMs);
    results[mine] = result;
    const label = result.code === 0 ? "ok  " : (result.timedOut ? "TIME" : "FAIL");
    console.log(`  ${label}  ${result.ms.toFixed(0).padStart(5)} ms  ${rel(result.file)}`);
  }
});
await Promise.all(workers);

const wall = Number(process.hrtime.bigint() - startedAll) / 1e6;
const failed = results.filter((r) => r.code !== 0);
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);

if (failed.length > 0) {
  for (const f of failed) {
    console.log(`\n---- ${rel(f.file)} ${f.timedOut ? `超时（>${opts.timeoutMs} ms，已强杀）` : `退出码 ${f.code}`} ----`);
    console.log(f.out.trimEnd() || "(无输出)");
  }
  console.error(`\n回归测试未通过：${failed.length}/${results.length} 失败 —— ${failed.map((f) => rel(f.file)).join("、")}`);
  process.exit(1);
}

console.log(`\n回归测试通过 ${results.length}/${results.length}（墙钟 ${wall.toFixed(0)} ms；最慢：${slowest.map((s) => `${path.basename(s.file)} ${s.ms.toFixed(0)}ms`).join("、")}）`);
