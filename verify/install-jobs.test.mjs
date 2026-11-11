/**
 * 异步安装队列回归（`plugin-market/lib/install-jobs.js` + `/install` 的异步分支）。
 *
 * ## 为什么值得这么多条
 *
 * 这次改的是**接口形状**：`POST /install` 从「等装完再回」变成「立刻回 202 + jobId」。
 * 形状一变，出错方式全变了：
 *   - 作业丢了却报成功 → 用户以为装上了，其实什么都没发生；
 *   - 排队说成「安装中」 → 三个都在转圈，实际只有第一个在跑（宿主靠文件锁串行）；
 *   - 「取消了」但其实已经写了文件 → 用户以为没装，实际装了；
 *   - 宿主重启后旧作业还在列表里 → 界面永远有个装不完的进度。
 *
 * 每条都钉一个**可观测的结论**，不联网、不依赖真宿主（`runJob` 注入）。
 *
 * 用法：node verify/install-jobs.test.mjs
 */
import assert from 'node:assert/strict'

import { createInstallJobQueue, FINISHED_JOB_TTL_MS, MAX_ACTIVE_JOBS } from '../plugin-market/lib/install-jobs.js'

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

console.log('\n[1] 提交与去重：同一个包不许排队两次')

await check('提交立刻返回 queued 作业，不等 runJob 完成', async () => {
  let started = false
  let finished = false
  const queue = createInstallJobQueue({
    runJob: async () => {
      started = true
      await tick(50)
      finished = true
      return { ok: true, payload: { application: 'applied' } }
    }
  })
  const submitted = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a' })
  assert.equal(submitted.ok, true)
  assert.equal(submitted.job.state, 'queued', 'submit 返回时必须是 queued（立刻返回）')
  assert.equal(submitted.deduped, false)
  // 还没跑完就先返回了：started 可能已 true（微任务），finished 必须还是 false
  assert.equal(finished, false, 'submit 不得等 runJob 跑完')
  await tick(100)
  assert.equal(queue.get(submitted.job.id).state, 'succeeded')
  assert.ok(started)
})

await check('同一个 key 有未完成作业 ⇒ 返回那一个（deduped），不排队两次', async () => {
  let calls = 0
  const queue = createInstallJobQueue({
    runJob: async () => {
      calls += 1
      await tick(30)
      return { ok: true, payload: {} }
    }
  })
  const first = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a' })
  const second = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a' })
  assert.equal(second.deduped, true)
  assert.equal(second.job.id, first.job.id, '必须返回同一个作业 id')
  await tick(80)
  assert.equal(calls, 1, 'runJob 只该被调用一次')
})

await check('刚成功过、同 spec 再点 ⇒ deduped + alreadyDone（不重跑 pnpm）', async () => {
  let calls = 0
  const queue = createInstallJobQueue({
    runJob: async () => {
      calls += 1
      return { ok: true, payload: {} }
    }
  })
  const first = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a' })
  await tick(20)
  assert.equal(queue.get(first.job.id).state, 'succeeded')
  const again = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a' })
  assert.equal(again.deduped, true, '刚装好的同一个包不该重新排队')
  assert.equal(again.alreadyDone, true, '要能区分「刚装好了」与「已在队列里」')
  await tick(20)
  assert.equal(calls, 1, '不许重跑一遍 pnpm')
})

await check('spec 变了（=真的升级）⇒ **不**沿用旧作业，正常排队', async () => {
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload: {} }) })
  const first = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a@1.0.0' })
  await tick(20)
  assert.equal(queue.get(first.job.id).state, 'succeeded')
  const upgrade = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a@2.0.0' })
  assert.equal(upgrade.alreadyDone, undefined, '换了版本就是一次新的安装，不能被去重吞掉')
  assert.notEqual(upgrade.job.id, first.job.id)
  await tick(20)
  assert.equal(queue.get(upgrade.job.id).state, 'succeeded')
})

console.log('\n[2] 排队语义：并发 1，排队与安装中可区分')

await check('并发 1 ⇒ 同一时刻只有一个 running，其余是 queued', async () => {
  const order = []
  const queue = createInstallJobQueue({
    runJob: async (job) => {
      order.push(`start:${job.key}`)
      await tick(25)
      order.push(`end:${job.key}`)
      return { ok: true, payload: {} }
    }
  })
  queue.submit({ key: 'a', name: 'A' })
  queue.submit({ key: 'b', name: 'B' })
  queue.submit({ key: 'c', name: 'C' })
  await tick(10)
  const mid = queue.list()
  const states = mid.active.map((job) => job.state).sort()
  assert.deepEqual(states, ['queued', 'queued', 'running'], `实际 ${JSON.stringify(states)}`)
  assert.equal(mid.active.filter((job) => job.state === 'running').length, 1, '同时只能有一个在跑')
  await tick(150)
  // 严格串行：a 的 end 必须在 b 的 start 之前
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
})

await check('列表顺序 = 提交顺序（不是完成顺序）', async () => {
  const queue = createInstallJobQueue({
    // b 比 a 快：完成顺序会反过来
    runJob: async (job) => {
      await tick(job.key === 'a' ? 40 : 5)
      return { ok: true, payload: {} }
    }
  })
  queue.submit({ key: 'a', name: 'A' })
  queue.submit({ key: 'b', name: 'B' })
  await tick(5)
  const active = queue.list().active
  assert.deepEqual(active.map((job) => job.key), ['a', 'b'], '排队顺序必须是提交顺序')
})

console.log('\n[3] 失败与取消：不许把没装成说成装成')

await check('runJob 返回 ok:false ⇒ failed 且带原因', async () => {
  const queue = createInstallJobQueue({
    runJob: async () => ({ ok: false, payload: { application: 'failed' }, error: '宿主拒绝了' })
  })
  const submitted = queue.submit({ key: 'a', name: 'A' })
  await tick(20)
  const job = queue.get(submitted.job.id)
  assert.equal(job.state, 'failed')
  assert.match(String(job.error), /宿主拒绝/)
  assert.equal(job.result, null, '失败不许带 result（否则 UI 会当成功渲染）')
})

await check('runJob 抛错 ⇒ failed，且异常不会冒到队列外面（一个作业炸不垮整个市场）', async () => {
  const queue = createInstallJobQueue({
    runJob: async () => {
      throw new Error('pnpm 崩了')
    }
  })
  const submitted = queue.submit({ key: 'a', name: 'A' })
  await tick(20)
  const job = queue.get(submitted.job.id)
  assert.equal(job.state, 'failed')
  assert.match(String(job.error), /pnpm 崩了/)
})

await check('一个作业失败不影响后面排队的作业（继续推进）', async () => {
  const queue = createInstallJobQueue({
    runJob: async (job) => {
      if (job.key === 'a') throw new Error('A 失败')
      return { ok: true, payload: {} }
    }
  })
  const a = queue.submit({ key: 'a', name: 'A' })
  const b = queue.submit({ key: 'b', name: 'B' })
  await tick(40)
  assert.equal(queue.get(a.job.id).state, 'failed')
  assert.equal(queue.get(b.job.id).state, 'succeeded', 'A 失败必须让 B 继续跑，否则队列会永远卡住')
})

await check('取消排队中的作业 ⇒ 立刻 cancelled，且 runJob **从未被调用**', async () => {
  let ranB = false
  const queue = createInstallJobQueue({
    runJob: async (job) => {
      if (job.key === 'b') ranB = true
      await tick(40)
      return { ok: true, payload: {} }
    }
  })
  const a = queue.submit({ key: 'a', name: 'A' })
  const b = queue.submit({ key: 'b', name: 'B' })
  await tick(5) // a 在跑，b 还在排队
  const verdict = await queue.cancel(b.job.id)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.status, 'cancelled', '排队的作业要能立刻取消')
  assert.equal(queue.get(b.job.id).state, 'cancelled')
  await tick(120)
  assert.equal(ranB, false, '被取消的排队作业**绝不能**再跑起来（那是「说取消却装了」）')
  assert.equal(queue.get(a.job.id).state, 'succeeded', '取消 B 不该影响正在跑的 A')
})

await check('取消正在跑的作业 ⇒ 转达宿主，status 如实回传（含 too-late）', async () => {
  for (const hostStatus of ['cancelled', 'too-late']) {
    const queue = createInstallJobQueue({
      runJob: async () => {
        await tick(60)
        return { ok: true, payload: {} }
      }
    })
    const submitted = queue.submit({ key: 'a', name: 'A' })
    await tick(5)
    let asked = null
    const verdict = await queue.cancel(submitted.job.id, async (requestId) => {
      asked = requestId
      return { status: hostStatus }
    })
    assert.equal(verdict.ok, true)
    assert.equal(verdict.status, hostStatus, `宿主的 ${hostStatus} 必须原样转达，不许一律说 cancelled`)
    assert.ok(typeof asked === 'string' && asked !== '', '必须把 requestId 交给宿主 cancelInstall')
    assert.equal(queue.get(submitted.job.id).cancelRequested, true)
    await tick(80)
  }
})

await check('取消不存在的作业 ⇒ job-not-found（不抛）', async () => {
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload: {} }) })
  const verdict = await queue.cancel('no-such-id')
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'job-not-found')
})

await check('取消已结束的作业 ⇒ job-finished（不是错误，是「没什么可取消」）', async () => {
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload: {} }) })
  const submitted = queue.submit({ key: 'a', name: 'A' })
  await tick(20)
  const verdict = await queue.cancel(submitted.job.id)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'job-finished')
})

console.log('\n[4] 边界：上限、清理、宿主重启')

await check('未完成作业到达上限 ⇒ 拒绝（to-many-jobs），不许无限排队', async () => {
  const queue = createInstallJobQueue({
    maxActive: 2,
    runJob: async () => {
      await tick(200)
      return { ok: true, payload: {} }
    }
  })
  assert.equal(queue.submit({ key: 'a', name: 'A' }).ok, true)
  assert.equal(queue.submit({ key: 'b', name: 'B' }).ok, true)
  const third = queue.submit({ key: 'c', name: 'C' })
  assert.equal(third.ok, false)
  assert.equal(third.code, 'too-many-jobs')
  assert.ok(MAX_ACTIVE_JOBS > 0)
})

await check('已完成作业超过 TTL ⇒ 被清掉（长跑的宿主不会无限涨内存）', async () => {
  let clock = 1000
  const queue = createInstallJobQueue({
    now: () => clock,
    runJob: async () => ({ ok: true, payload: {} })
  })
  const submitted = queue.submit({ key: 'a', name: 'A' })
  await tick(20)
  assert.equal(queue.get(submitted.job.id).state, 'succeeded')
  clock += FINISHED_JOB_TTL_MS + 1000
  // list() 内部会 prune
  const listed = queue.list()
  assert.equal(listed.finished.length, 0, '过了保留期的作业不该再出现')
  assert.equal(queue.get(submitted.job.id), null)
})

await check('宿主重启 = 队列天然清空：旧作业查不到（不许假装还在装）', async () => {
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload: {} }) })
  const submitted = queue.submit({ key: 'a', name: 'A' })
  await tick(20)
  // 模拟重启：整个队列换新实例
  const restarted = createInstallJobQueue({ runJob: async () => ({ ok: true, payload: {} }) })
  assert.equal(restarted.get(submitted.job.id), null, '新进程里没有旧作业——客户端据此说「作业不见了」')
  assert.deepEqual(restarted.list(), { active: [], finished: [] })
})

await check('作业视图只暴露可序列化字段（绝不把内部 Promise/函数漏给 HTTP）', async () => {
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload: { application: 'applied' } }) })
  const submitted = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a' })
  await tick(20)
  const job = queue.get(submitted.job.id)
  // `result` 是宿主的响应体，本来就该是对象；要排除的是**函数 / Promise / Map 这类
  // 传到 HTTP 上会变成 null 或 {} 的东西**——那才是「内部句柄漏出去」的信号。
  const isPlainish = (value) => {
    if (value === null) return true
    if (['string', 'number', 'boolean'].includes(typeof value)) return true
    if (typeof value === 'function' || typeof value?.then === 'function') return false
    if (value instanceof Map || value instanceof Set) return false
    return typeof value === 'object'
  }
  for (const key of Object.keys(job)) {
    assert.ok(isPlainish(job[key]), `字段 ${key} 不是可序列化的值（${typeof job[key]}）`)
  }
  // 最关键的一条：整个视图必须能被 JSON.stringify 且还原出一样的结构
  const roundTrip = JSON.parse(JSON.stringify(job))
  assert.deepEqual(roundTrip, job, 'HTTP 视图必须能无损往返 JSON')
  // 时间戳必须是 ISO 字符串，方便客户端直接显示
  assert.match(job.queuedAt, /^\d{4}-\d{2}-\d{2}T/)
})

console.log('\n[5] 完成后的结果：payload 原样保留（前端要照旧渲染）')

await check('成功的 payload 原样存进 result', async () => {
  const payload = { application: 'restart-required', target: 'dsh-a', pendingBuilds: [], changed: true }
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload }) })
  const submitted = queue.submit({ key: 'a', name: 'A' })
  await tick(20)
  const job = queue.get(submitted.job.id)
  assert.deepEqual(job.result, payload, 'result 必须就是 /install 原来那份响应体')
  assert.equal(job.error, null)
})

await check('pendingBuilds 的 payload 也算「作业结束了」而不是失败（要弹批准条）', async () => {
  // pendingBuilds 非空时宿主的 application 可能是 failed，但它**不是**作业失败：
  // 它是在等用户批准，客户端要保留确认条。队列只负责如实把 payload 交回去。
  const payload = { application: 'failed', pendingBuilds: ['cloudflared'] }
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload }) })
  const submitted = queue.submit({ key: 'a', name: 'A' })
  await tick(20)
  const job = queue.get(submitted.job.id)
  assert.equal(job.state, 'succeeded', '作业本身跑完了（runJob ok），pending 是 payload 里的事')
  assert.deepEqual(job.result.pendingBuilds, ['cloudflared'])
})

await check('去重命中时 Submit 要能被上层区分：新起作业 vs 复用旧作业', async () => {
  // 这条钉的是**状态码语义**（index.js 据此回 202 或 200）：
  //   deduped=false → 202 Accepted（真的新起了作业，去追结果）
  //   deduped=true  → 200 OK（没有新作业：已在队列里，或刚装好过）
  // 把 alreadyDone 也说成 202 是撒谎——客户端会以为又要等一轮。
  // 2026-11-11 在真实宿主上实测时就是这么发现的：两个 alreadyDone 响应都是 202。
  const queue = createInstallJobQueue({ runJob: async () => ({ ok: true, payload: {} }) })
  const first = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a@1.0.0' })
  assert.equal(first.deduped, false, '新作业：上层回 202')
  assert.equal(first.alreadyDone, undefined)

  const inFlight = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a@1.0.0' })
  assert.equal(inFlight.deduped, true, '已在队列里：上层回 200')
  assert.equal(inFlight.alreadyDone, undefined, '这一种是「正在装」，不是「装好了」')

  await tick(20)
  const done = queue.submit({ key: 'a', name: 'A', spec: 'dsh-a@1.0.0' })
  assert.equal(done.deduped, true, '刚装好：同样回 200')
  assert.equal(done.alreadyDone, true, '而且要能说出是「刚装好了」')
})

console.log('\n[6] 客户端：作业追丢时必须先回读真实状态（2026-11-11 真机踩到）')

await check('作业消失时**不得**直接下「没装上」的结论（先回读已安装列表）', async () => {
  // 真机现象：热挂载重载插件树 → 新装的包已经落盘（bundle 36→38），
  // 而作业队列因模块重载被清空。此时若直接说「必要时重装」，用户会把装好的东西再装一遍。
  // 客户端不是可 import 的模块（factory 闭包），所以按源码形状 + 键名钉住这个分支。
  const fs = await import('node:fs')
  const client = fs.readFileSync('plugin-market/lib/client.js', 'utf8')
  assert.match(client, /function confirmAfterJobGone\(/, '必须有「作业追丢后回读」的函数')
  // 断言必须落在**作业消失的那条分支里**：函数定义本身也会匹配 `confirmAfterJobGone(`，
  // 所以要先切出 `if (!found) {` 到它闭合的这段，再要求里面**真的调用**了它。
  // （第一版没切分支，变异「直接报失败」照样全绿——那是虚的。）
  const notFoundAt = client.indexOf('if (!found) {')
  assert.ok(notFoundAt > 0, '找不到「作业消失」分支')
  const branch = client.slice(notFoundAt, client.indexOf('\n            }', notFoundAt))
  assert.match(branch, /confirmAfterJobGone\(label, report\)/, '作业消失分支必须**真的调用**回读，而不是直接报失败')
  assert.doesNotMatch(branch, /report\(\{ ok: false/, '这条分支不得在回读之前就断言失败')
  // 回读要真的调 /installed
  const fnStart = client.indexOf('function confirmAfterJobGone(')
  const fnBody = client.slice(fnStart, client.indexOf('\n      }', fnStart))
  assert.match(fnBody, /api\.installed\(\)/, '必须回读已安装列表')
  assert.match(fnBody, /installJobGoneButInstalled/, '读到了要说「其实已经装好了」')
  // 两种结论的文案都必须存在（zh + en）
  for (const key of ['notice.installJobGone', 'notice.installJobGoneButInstalled']) {
    const hits = client.split(`"${key}"`).length - 1
    assert.ok(hits >= 2, `${key} 必须有 zh/en 两份（实际 ${hits}）`)
  }
  // 「不见了」的文案不许再教用户直接重装
  assert.doesNotMatch(client, /作业不见了（宿主可能重启过）/, '旧的误导性文案应已替换')
})

console.log('')
if (failures.length > 0) {
  console.log(`安装作业回归：${passed}/${passed + failures.length} 通过，失败：${failures.map((f) => f.name).join('；')}`)
  process.exit(1)
}
console.log(`安装作业回归：${passed}/${passed} 全通过`)
