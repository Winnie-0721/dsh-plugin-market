/**
 * 门禁测试执行器（scripts/run-tests.mjs）的行为回归。
 *
 * 为什么值得一条测试：这段代码决定「22 个 .test.mjs 到底跑没跑、结果算不算数」。
 * 它出错的两种方式都是**静默**的——
 *   1. 发现不到测试（目录改名/路径算错）→ 0 个测试、退出码 0，看起来和全绿一样；
 *   2. 某个测试挂住 → 门禁永不返回，发布流程卡死且不说明卡在哪。
 * 所以每条都用**伪造的测试目录**（放进系统 tmpdir）真的驱动这个脚本，断言退出码与输出，
 * 而不是只读源码里有没有某个字符串。
 *
 * 性能注意：这个测试自己在门禁的关键路径上，所以把各次独立的执行器调用**并发**跑
 * （每个都在自己的 tmpdir 里，互不干扰），并且同一个夹具只跑一次、多个断言复用结果。
 * 原来的写法是串行 12 次调用、其中一次白等 1.5s，单独就要 3.7s，反而成了门禁最慢的一环。
 *
 * 用法：node verify/run-tests.test.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNNER = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url))

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

/**
 * 异步跑执行器（并发用），返回 {code, out, timedOut}。
 *
 * 自己也要有超时：这个测试验证的正是「执行器能把挂住的测试杀掉」。如果执行器坏了
 * （不再杀挂住的测试），一个没有超时的等待会把**门禁自己**永远挂住——那么这条测试
 * 坏掉时表现为「卡死」而不是「失败」，而且是在发布门禁上卡死。验证超时保护的东西
 * 不能依赖外部的超时保护。
 */
function runRunner(dir, extraArgs = [], timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, '--dir', dir, '--min', '0', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { out += c })
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: 1, out: `spawn 失败：${error.message}`, timedOut: false }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code, out, timedOut }) })
  })
}

const dirs = []
function makeFixture(name, files) {
  const dir = mkdtempSync(join(tmpdir(), `dshpm-runtests-${name}-`))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

try {
  // ── 夹具 ──
  const green = makeFixture('green', {
    'a.test.mjs': 'console.log("a ok")\n',
    'b.test.mjs': 'console.log("b ok")\n'
  })
  const bad = makeFixture('bad', {
    'ok.test.mjs': 'console.log("ok")\n',
    'broken.test.mjs': 'console.error("boom-detail")\nprocess.exit(1)\n'
  })
  const nested = makeFixture('nested', {
    'top.test.mjs': 'console.log("top")\n',
    'deep/inner.test.mjs': 'console.error("nested-failure-marker")\nprocess.exit(1)\n'
  })
  const nestedClean = makeFixture('nested-clean', {
    'top.test.mjs': 'console.log("top")\n',
    'deep/inner.test.mjs': 'console.log("inner")\n'
  })
  const hang = makeFixture('hang', {
    'hang.test.mjs': 'setInterval(() => {}, 1000)\nconsole.log("hang-started")\n',
    'fast.test.mjs': 'console.log("fast")\n'
  })
  const mixed = makeFixture('mixed', {
    'p1.test.mjs': 'console.log("1")\n',
    'p2.test.mjs': 'console.log("2")\n',
    'p3.test.mjs': 'console.log("3")\n',
    'p4.test.mjs': 'console.log("4")\n',
    'p5.test.mjs': 'console.log("5")\n',
    'fail.test.mjs': 'process.exit(3)\n'
  })
  const cleanParallel = makeFixture('clean-parallel', {
    'a.test.mjs': 'console.log("a")\n',
    'b.test.mjs': 'console.log("b")\n',
    'c.test.mjs': 'console.log("c")\n',
    'd.test.mjs': 'console.log("d")\n'
  })
  const missing = join(tmpdir(), `dshpm-missing-${Date.now()}-${process.pid}`)

  // ── 所有独立的执行器调用一次并发跑掉；每个夹具只跑一次 ──
  const [rGreen, rBad, rNested, rNestedClean, rHang, rSerial, rParallel, rCleanParallel, rMissing, rFloor] =
    await Promise.all([
      runRunner(green),
      runRunner(bad),
      runRunner(nested),
      runRunner(nestedClean),
      // 超时只给 400ms：判据是「挂住的测试被强杀、门禁返回」，与超时长短无关，
      // 原来用 1500ms，白等了 1.1s。
      runRunner(hang, ['--timeout-ms', '400']),
      runRunner(mixed, ['--jobs', '1']),
      runRunner(mixed, ['--jobs', '4']),
      runRunner(cleanParallel, ['--jobs', '4']),
      runRunner(missing),
      runRunner(green, ['--min', '99'])
    ])

  console.log('\n[1] 全绿')
  check('全部通过时退出 0，并报告通过数', () => {
    assert.equal(rGreen.code, 0, `应当退出 0，实际 ${rGreen.code}\n${rGreen.out}`)
    assert.match(rGreen.out, /回归测试通过 2\/2/, `应报告 2/2\n${rGreen.out}`)
  })

  console.log('\n[2] 失败必须被抓住')
  check('任一测试失败 ⇒ 退出非 0', () => {
    assert.notEqual(rBad.code, 0, '有失败却报绿，是最危险的假绿')
  })
  check('失败时打印出问题的文件名与它的原始输出', () => {
    assert.match(rBad.out, /broken\.test\.mjs/, `要指名失败文件\n${rBad.out}`)
    assert.match(rBad.out, /boom-detail/, `要带上该测试的原始输出，否则没法定位\n${rBad.out}`)
    assert.match(rBad.out, /1\/2 失败/, `要说清是几个失败\n${rBad.out}`)
    // 上面那条 /broken\.test\.mjs/ 其实**不够**：执行器对每个测试都会打印一行进度，
    // 里面天然含文件名，所以即使失败摘要完全不列文件，那条断言照样通过
    // （变异测试 R6 就是这样存活的）。这里把「失败摘要那一行必须列出失败文件」单独钉住——
    // 那是人失败后最先看的一行。
    assert.match(
      rBad.out,
      /回归测试未通过：1\/2 失败[^\n]*broken\.test\.mjs/,
      `失败摘要那一行必须列出失败文件\n${rBad.out}`
    )
    assert.match(rBad.out, /退出码 1/, `失败条目要给出退出码\n${rBad.out}`)
  })

  console.log('\n[3] 递归发现')
  check('子目录里的 *.test.mjs 会被发现并执行（失败会被抓住）', () => {
    assert.match(rNested.out, /deep\/inner\.test\.mjs/, `子目录测试必须被发现\n${rNested.out}`)
    assert.notEqual(rNested.code, 0, '子目录里的失败必须让门禁变红（这正是旧代码漏掉的情况）')
    assert.match(rNested.out, /nested-failure-marker/, `要带上子目录测试的输出\n${rNested.out}`)
  })
  check('通过数把子目录测试算进去（2 个，而不是 1 个）', () => {
    assert.equal(rNestedClean.code, 0, rNestedClean.out)
    assert.match(rNestedClean.out, /回归测试通过 2\/2/, `应把子目录测试计入总数\n${rNestedClean.out}`)
  })

  console.log('\n[4] 发现数量下限与路径错误')
  check('发现数低于下限 ⇒ 退出非 0（拒绝「0 个测试全绿」）', () => {
    assert.notEqual(rFloor.code, 0, `发现 2 个但下限 99，应当失败\n${rFloor.out}`)
    assert.match(rFloor.out, /下限/, `要说明原因\n${rFloor.out}`)
  })
  check('目录不存在 ⇒ 退出非 0（不是安静地跑 0 个）', () => {
    assert.notEqual(rMissing.code, 0, '目录不存在时安静通过 = 假绿')
    assert.match(rMissing.out, /不存在/, `要说清是路径问题，而不是误导成「数量不足」\n${rMissing.out}`)
  })

  console.log('\n[5] 单个测试的超时保护')
  check('永不退出的测试会被超时强杀，且门禁整体返回非 0', () => {
    assert.notEqual(rHang.code, 0, '挂住的测试必须让门禁失败')
    assert.match(rHang.out, /超时/, `要说清是超时\n${rHang.out}`)
    assert.match(rHang.out, /fast\.test\.mjs/, `同批的其它测试仍要有结果\n${rHang.out}`)
  })
  check('执行器自己会返回（不是靠外部超时兜底）', () => {
    // timedOut 为真 = 是**我们**在 20s 后强杀了执行器，也就是执行器自己没能返回。
    // 这条如果失败，说明「超时保护」实际上不存在，门禁会被一个挂住的测试拖死。
    assert.equal(rHang.timedOut, false, '执行器必须自己返回；靠测试脚本外部超时兜底 = 门禁会被挂死')
  })

  console.log('\n[6] 并发不改变结论')
  check('并发 4 与串行 1 得到同样的结论（都失败，且都指名 fail.test.mjs）', () => {
    assert.equal(rSerial.code, rParallel.code, `并发改变了结论：串行 ${rSerial.code} vs 并发 ${rParallel.code}`)
    assert.notEqual(rParallel.code, 0, '夹具里有失败测试，必须是红的')
    for (const [label, r] of [['串行', rSerial], ['并发', rParallel]]) {
      assert.match(r.out, /fail\.test\.mjs/, `${label} 要指名失败文件\n${r.out}`)
      assert.match(r.out, /1\/6 失败/, `${label} 应报告 1/6\n${r.out}`)
    }
  })
  check('全绿夹具在并发下仍然退出 0（并发不制造假红）', () => {
    assert.equal(rCleanParallel.code, 0, `干净夹具在并发下必须为绿\n${rCleanParallel.out}`)
    assert.match(rCleanParallel.out, /回归测试通过 4\/4/, rCleanParallel.out)
  })
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
}

console.log('')
if (failures.length > 0) {
  console.log(`门禁执行器回归：${passed}/${passed + failures.length} 通过，失败：${failures.map((f) => f.name).join('；')}`)
  process.exit(1)
}
console.log(`门禁执行器回归：${passed}/${passed} 全通过`)
