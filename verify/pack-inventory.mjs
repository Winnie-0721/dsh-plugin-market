#!/usr/bin/env node
// TASK-PERF-01a — offline pack inventory. Read-only except one tgz in os.tmpdir()
// (deleted immediately, aborts if > 5 MiB). No network, no deps, no repo writes.
// Usage: node verify/pack-inventory.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'plugin-market');
const TMP = os.tmpdir();
const MAX_TGZ = 5 * 1024 * 1024;
const JSON_BEGIN = '--- PACK-INVENTORY-JSON-BEGIN ---';
const JSON_END = '--- PACK-INVENTORY-JSON-END ---';

const notes = [];
const failures = [];
const unmeasured = [];
const human = [];
const say = (s = '') => { human.push(s); console.log(s); };
const mb = (n) => (n / 1024 / 1024).toFixed(3);

const q = (s) => (/[\s"&|<>^]/.test(String(s)) ? `"${String(s)}"` : String(s));
function run(cmd, args, opts = {}) {
  const line = [cmd, ...args].map(q).join(' ');
  // Windows npm is npm.cmd, which Node can only reach through a shell; everything
  // else stays argv-form so no argument is ever re-parsed by cmd.exe.
  const base = { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 300000 };
  const r = process.platform === 'win32' && cmd === 'npm'
    ? spawnSync(line, { ...base, shell: true, ...opts })
    : spawnSync(cmd, args, { ...base, shell: false, ...opts });
  return {
    cmd: line,
    status: r.status,
    signal: r.signal ?? null,
    error: r.error ? String(r.error.message || r.error) : null,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function walk(root, acc = []) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); }
  catch (e) { failures.push(`walk ${root}: ${e.code || e.message}`); return acc; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = statSync(p).isDirectory(); } catch { continue; } }
    if (isDir) walk(p, acc);
    else {
      try { const s = statSync(p); acc.push({ path: p, size: s.size }); }
      catch (err) { failures.push(`stat ${p}: ${err.code || err.message}`); }
    }
  }
  return acc;
}

const topBy = (files, n, rel) => files
  .map((f) => ({ name: rel ? path.relative(rel, f.path).split(path.sep).join('/') : f.path, size: f.size }))
  .sort((a, b) => b.size - a.size || (a.name < b.name ? -1 : 1))
  .slice(0, n);

// ---------------------------------------------------------------- group 1: npm
function group1() {
  const g = { measured: false, sourceCommands: [], npmDryRun: null, realTarball: null, explanation: null };
  const dryCmd = ['npm', 'pack', '--dry-run', '--json'];
  const dry = run('npm', dryCmd.slice(1), { cwd: PKG_DIR });
  g.sourceCommands.push(`(cwd=plugin-market) ${dry.cmd}`);
  if (dry.status !== 0 || !dry.stdout.trim()) {
    g.error = `npm pack --dry-run failed: exit=${dry.status} err=${dry.error || dry.stderr.slice(0, 400)}`;
    failures.push(g.error);
    return g;
  }
  let meta;
  try {
    const parsed = JSON.parse(dry.stdout);
    meta = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  } catch (e) {
    g.error = `npm pack --dry-run --json unparsable: ${e.message}`;
    failures.push(g.error);
    return g;
  }
  const files = (meta.files || []).map((f) => ({ name: f.path, size: f.size }));
  g.npmDryRun = {
    package: `${meta.name}@${meta.version}`,
    filename: meta.filename,
    fileCount: files.length,
    unpackedSize: meta.unpackedSize,
    unpackedSizeMiB: Number(mb(meta.unpackedSize || 0)),
    npmReportedTarballSize: meta.size,
    npmReportedTarballSizeMiB: Number(mb(meta.size || 0)),
    shasum: meta.shasum,
    integrity: meta.integrity,
    top10: topBy((meta.files || []).map((f) => ({ path: f.path, size: f.size })), 10, null),
  };

  // real pack into os.tmpdir(), then delete immediately
  const dest = path.join(TMP, `pack-inv-${process.pid}-${Date.now()}`);
  let real = { attempted: true, dest, exitCode: null, bytes: null, deleted: false, deletedError: null };
  try {
    mkdirSync(dest, { recursive: true }); // npm does not create --pack-destination
    const packCmd = ['pack', '--json', '--pack-destination', dest];
    const r = run('npm', packCmd, { cwd: PKG_DIR });
    g.sourceCommands.push(`(cwd=plugin-market) npm ${packCmd.join(' ')}`);
    real.exitCode = r.status;
    real.stderr = r.stderr.slice(0, 400);
    if (r.status === 0 && r.stdout.trim()) {
      const m = JSON.parse(r.stdout);
      const info = Array.isArray(m) ? m[0] : Object.values(m)[0];
      const tgz = path.join(dest, info.filename);
      const size = statSync(tgz).size;
      real.filename = info.filename;
      real.bytes = size;
      real.bytesMiB = Number(mb(size));
      real.oversizeGuardTripped = size > MAX_TGZ;
      if (real.oversizeGuardTripped) failures.push(`tgz ${size} bytes > ${MAX_TGZ} guard; deleted anyway`);
      real.shasum = info.shasum;
      real.entries = (info.files || []).length;
      real.unpackedSize = info.unpackedSize;
    } else {
      real.error = `exit=${r.status} err=${r.error || r.stderr.slice(0, 300)}`;
      failures.push(`real npm pack: ${real.error}`);
    }
  } catch (e) {
    real.error = String(e.message || e);
    failures.push(`real npm pack: ${real.error}`);
  } finally {
    try { rmSync(dest, { recursive: true, force: true }); real.deleted = !existsSync(dest); }
    catch (e) { real.deletedError = String(e.message || e); failures.push(`cleanup ${dest}: ${real.deletedError}`); }
  }
  g.realTarball = real;
  g.measured = true;

  const d = g.npmDryRun;
  g.explanation = [
    `dry-run files=${d.fileCount} unpackedSize=${d.unpackedSize}; real tgz on disk=${real.bytes}` +
      (real.unpackedSize != null ? ` with ${real.entries} entries / unpackedSize=${real.unpackedSize}` : ' (real pack NOT measured)') + '.',
    'dry-run writes nothing: npm walks the "files" whitelist, reports each entry uncompressed, and sums them into unpackedSize.',
    real.bytes == null
      ? 'Real .tgz bytes are NOT measured, so no dry-run-vs-tarball delta is claimed.'
      : `Same ${d.fileCount} entries, two rulers: dry-run reports UNCOMPRESSED payload ${d.unpackedSize} bytes; the real .tgz on disk is COMPRESSED to ${real.bytes} bytes, i.e. ${(d.unpackedSize / real.bytes).toFixed(3)}x smaller. npm's per-file "size" in dry-run JSON is file length, npm's top-level "size" (${d.npmReportedTarballSize}) is the tarball size and matches the real file (delta ${real.bytes - d.npmReportedTarballSize}); the on-disk byte count is the shipping size.`,
    'Neither number equals the repo total: files-whitelist only, so tests/docs/sources outside lib + the 5 root entries are excluded.',
  ];
  return g;
}

// -------------------------------------------------------------- group 2: repo
function group2() {
  const g = { measured: false, sourceCommand: 'git -C <root> ls-files -z' };
  const r = run('git', ['-C', ROOT, 'ls-files', '-z'], { shell: false });
  if (r.status !== 0) {
    g.error = `git ls-files failed: exit=${r.status} err=${r.error || r.stderr.slice(0, 400)}`;
    failures.push(g.error);
    return g;
  }
  const rels = r.stdout.split('\0').filter(Boolean);
  const present = [];
  const missing = [];
  for (const rel of rels) {
    const p = path.join(ROOT, rel);
    try { present.push({ path: p, size: statSync(p).size }); }
    catch { missing.push(rel); }
  }
  const total = present.reduce((a, f) => a + f.size, 0);
  g.measured = true;
  g.trackedFileCount = rels.length;
  g.presentFileCount = present.length;
  g.missingFromWorktree = { count: missing.length, sample: missing.slice(0, 20) };
  g.totalBytes = total;
  g.totalMiB = Number(mb(total));
  g.top10 = topBy(present, 10, ROOT);
  return g;
}

// ----------------------------------------------------- group 3: host installs
const SKIP_DIRS = new Set(['.git', 'cache', 'sessions', 'storages', 'logs', 'timeline', 'temp', 'tmp', 'node_modules/.cache']);

function findInstalled(root, maxDepth = 5) {
  const out = [];
  const seen = new Set();
  const visit = (dir, depth) => {
    if (depth > maxDepth || seen.has(dir)) return;
    seen.add(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.name === 'deepseek-harness-market') { out.push(p); continue; }
      if (SKIP_DIRS.has(e.name) && depth > 0) continue;
      visit(p, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function group3() {
  const cands = [];
  const seenCand = new Set();
  const push = (label, p) => {
    if (!p) return;
    const abs = path.resolve(p);
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seenCand.has(key)) { const prev = cands.find((c) => c.key === key); if (prev) prev.label += ` + ${label}`; return; }
    seenCand.add(key);
    cands.push({ key, label, path: abs });
  };
  push('DSH_HOME env', process.env.DSH_HOME);
  push('_verify/dshhome', path.join(ROOT, '_verify', 'dshhome'));
  if (process.env.USERPROFILE) push('%USERPROFILE%\\.dsh', path.join(process.env.USERPROFILE, '.dsh'));
  if (process.env.HOME) push('$HOME/.dsh', path.join(process.env.HOME, '.dsh'));
  if (process.env.LOCALAPPDATA) push('%LOCALAPPDATA%\\dsh', path.join(process.env.LOCALAPPDATA, 'dsh'));
  if (process.env.APPDATA) push('%APPDATA%\\dsh', path.join(process.env.APPDATA, 'dsh'));

  const probed = [];
  const installs = [];
  const seenInstall = new Set();
  for (const c of cands) {
    const exists = existsSync(c.path);
    probed.push({ label: c.label, path: c.path, exists });
    if (!exists) continue;
    // profiles/*/ explicitly, then bounded general scan
    const profileRoot = path.join(c.path, 'profiles');
    const found = new Set();
    if (existsSync(profileRoot)) {
      let kids = [];
      try { kids = readdirSync(profileRoot, { withFileTypes: true }); } catch { }
      for (const k of kids) if (k.isDirectory()) for (const f of findInstalled(path.join(profileRoot, k.name), 4)) found.add(f);
    }
    for (const f of findInstalled(c.path, 4)) found.add(f);
    for (const p of [...found].sort()) {
      const key = process.platform === 'win32' ? p.toLowerCase() : p;
      if (seenInstall.has(key)) continue;
      seenInstall.add(key);
      const files = walk(p);
      const total = files.reduce((a, f) => a + f.size, 0);
      let version = null;
      try { version = JSON.parse(readFileSync(path.join(p, 'package.json'), 'utf8')).version; } catch { }
      installs.push({
        foundUnder: c.label, path: p, version,
        fileCount: files.length, totalBytes: total, totalMiB: Number(mb(total)),
        top10: topBy(files, 10, null),
      });
    }
  }
  return {
    measured: installs.length > 0,
    unmeasuredReason: installs.length ? null : '未测量（路径不存在）',
    probedCandidates: probed,
    installs,
  };
}

// ---------------------------------------------------------------------- main
say(`pack-inventory  root=${ROOT}  node=${process.version}  platform=${process.platform}`);
say(`date=${new Date().toISOString()}  head=...`);
const head = run('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { shell: false });
say(`git HEAD=${head.stdout.trim()}  branch=` + run('git', ['-C', ROOT, 'branch', '--show-current'], { shell: false }).stdout.trim());

const g1 = group1();
const g2 = group2();
const g3 = group3();

if (g1.measured) {
  const d = g1.npmDryRun, r = g1.realTarball;
  say('');
  say('[1] npm publish package (files whitelist)');
  say(`    command      : ${g1.sourceCommands.join('  |  ')}`);
  say(`    package      : ${d.package}   filename=${d.filename}`);
  say(`    files entries: ${d.fileCount}`);
  say(`    unpackedSize : ${d.unpackedSize} bytes (${d.unpackedSizeMiB} MiB)`);
  say(`    npm est. tgz : ${d.npmReportedTarballSize} bytes (${d.npmReportedTarballSizeMiB} MiB)`);
  say(`    real tgz     : ${r.bytes == null ? 'NOT MEASURED (' + (r.error || 'unknown') + ')' : `${r.bytes} bytes (${r.bytesMiB} MiB)`}  exit=${r.exitCode}  deleted=${r.deleted}`);
  say('    dry-run top10 by size:');
  for (const f of d.top10) say(`      ${String(f.size).padStart(9)}  ${f.name}`);
  say('    why they differ:');
  for (const l of g1.explanation) say(`      - ${l}`);
}
if (g2.measured) {
  say('');
  say('[2] repository (git ls-files, worktree bytes)');
  say(`    command      : ${g2.sourceCommand}`);
  say(`    files        : ${g2.trackedFileCount} tracked, ${g2.presentFileCount} present on disk`);
  say(`    total bytes  : ${g2.totalBytes} (${g2.totalMiB} MiB)`);
  if (g2.missingFromWorktree.count) say(`    missing      : ${g2.missingFromWorktree.count} tracked-but-absent (${g2.missingFromWorktree.sample.join(', ')})`);
  say('    top10 by size:');
  for (const f of g2.top10) say(`      ${String(f.size).padStart(9)}  ${f.name}`);
}
say('');
say('[3] host install dirs of deepseek-harness-market (read-only)');
say('    probed candidates:');
for (const p of g3.probedCandidates) say(`      ${p.exists ? 'EXISTS ' : 'absent '} ${p.label}  ${p.path}`);
if (!g3.measured) {
  say(`    ${g3.unmeasuredReason}`);
} else {
  for (const i of g3.installs) {
    say(`    ${i.path}`);
    say(`      version=${i.version ?? 'unknown'}  files=${i.fileCount}  bytes=${i.totalBytes} (${i.totalMiB} MiB)   under=${i.foundUnder}`);
    say('      top10 by size:');
    for (const f of i.top10) say(`        ${String(f.size).padStart(9)}  ${path.basename(f.name)}`);
  }
}
say('');
say(`failures: ${failures.length}`);
for (const f of failures) say(`  ! ${f}`);

const payload = {
  task: 'TASK-PERF-01a',
  root: ROOT,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  git: { head: head.stdout.trim(), branch: run('git', ['-C', ROOT, 'branch', '--show-current'], { shell: false }).stdout.trim() },
  npmPublishPackage: g1,
  repository: g2,
  hostInstallDirs: g3,
  failures,
};
console.log(JSON_BEGIN);
console.log(JSON.stringify(payload, null, 2));
console.log(JSON_END);
process.exitCode = failures.length ? 1 : 0;
