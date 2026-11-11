/**
 * 安装作业队列（host 半）：**发起即返回，装完再报**。
 *
 * ## 为什么要有这一层（2026-11-11）
 *
 * 宿主的 `PluginManager.installBundle(spec, { requestId })` 本来就是**发起式**的：
 * 它一进函数就把 `control` 登记进 `this.installs`（`dsh-plugin-manager/lib/index.js:2720`）
 * 并返回 `result` promise，另有 `waitForInstall(requestId)` 取回结果、`cancelInstall` 取消。
 * 也就是说**异步能力宿主早就给了，是市场这一层把它 await 在 HTTP 请求里**。
 * 症状：点一个插件要等 pnpm 跑完才回来，期间那次 HTTP 挂着；换个插件装，界面上只有一个
 * 「安装中」，且 `busyKey` 只存一个 key，第二个按钮根本不显示转圈。
 *
 * ## 并发安全吗？安全，但要如实说清「串行的是谁」
 *
 * 宿主的 `change()` 用 `withFileLock(<profile>/package.json, …)` 把**整个安装过程**
 * （pnpm + 应用 + reload）包住，所以多个安装并发提交不会写坏 profile：它们在**宿主侧排队**。
 * 因此本模块的队列不是"为了防写坏"——宿主自己已经防了。队列解决的是另外两件事：
 *   1. **HTTP 请求不再等 pnpm**：立刻拿 jobId 回去，界面可以继续浏览/再装别的；
 *   2. **状态可查**：刷新页面、切页签、关掉面板之后再回来，作业还在，进度和结果都还在。
 *
 * ## 诚实边界（不许把"排队"说成"同时在装"）
 *
 *  - 队列里同时只**推进**一个安装（`concurrency` 默认 1）。看起来像"退回串行"，
 *    但这正是宿主的行为：并发提交只会让它们在 `withFileLock` 外面排队，
 *    而排队的那几个**没有**任何进度可言（pnpm 根本没启动）。由我们在这一侧排队，
 *    才能给每个作业一个诚实的 `queued` 状态，而不是让用户看到三个都"安装中"却只有一个在动。
 *  - 作业只在**当前进程**内存里。宿主重启后全部消失——这是刻意的：重启后 pnpm 的子进程
 *    已经不归我们管，把旧作业说成"还在进行"是撒谎。客户端拿到的应是"作业不存在"。
 *  - 同一个包重复提交返回**同一个作业**（按 bundle 键去重），不排两次队。
 */

import { randomUUID } from 'node:crypto'

/** 作业状态机：queued → running → (succeeded | failed | cancelled)。 */
export const INSTALL_JOB_STATES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled'])

/** 已完成作业的保留时长：够用户回来看结果，又不会让内存无限涨。 */
export const FINISHED_JOB_TTL_MS = 30 * 60 * 1000

/** 最多保留多少个**已完成**作业（先按 TTL 清，再按这个数兜底）。 */
export const MAX_FINISHED_JOBS = 40

/** 最多允许多少个未完成作业（防「连点 200 下」把宿主拖住）。 */
export const MAX_ACTIVE_JOBS = 24

function shortError(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

/**
 * 创建一个安装作业队列。
 *
 * @param options.runJob - **必填**。`async (job) => outcome`，真正干活的地方（在 index.js 里
 *   它就是原来 /install 的内联逻辑，含 captureBundles / installBundle / 热挂载 / 验证）。
 *   返回值应形如 `{ ok, status, payload }`：`payload` 原样回给客户端（就是原来 /install 的响应体）。
 *   抛错 = 该作业失败（错误文本进 job.error）。
 * @param options.now - 时钟（测试注入）
 * @param options.concurrency - 同时推进的作业数（默认 1，见模块注释的诚实边界）
 * @param options.finishedTtlMs / options.maxFinished / options.maxActive - 见上方常量
 */
export function createInstallJobQueue(options = {}) {
  const runJob = options.runJob
  if (typeof runJob !== 'function') throw new Error('createInstallJobQueue 需要 runJob')
  const now = typeof options.now === 'function' ? options.now : Date.now
  const concurrency = Number.isSafeInteger(options.concurrency) && options.concurrency > 0
    ? options.concurrency
    : 1
  const finishedTtlMs = Number.isFinite(options.finishedTtlMs) ? options.finishedTtlMs : FINISHED_JOB_TTL_MS
  const maxFinished = Number.isSafeInteger(options.maxFinished) ? options.maxFinished : MAX_FINISHED_JOBS
  const maxActive = Number.isSafeInteger(options.maxActive) ? options.maxActive : MAX_ACTIVE_JOBS

  /** jobId → job（插入顺序即提交顺序）。 */
  const jobs = new Map()
  /** 去重键（通常是 bundle 名）→ jobId，只记**未完成**的作业。 */
  const activeByKey = new Map()
  let running = 0
  let pumpScheduled = false

  function prune() {
    const cutoff = now() - finishedTtlMs
    let finishedSeen = 0
    // 从旧到新扫（Map 保留插入顺序），先删过期的，再按数量上限删最旧的。
    for (const [id, job] of jobs) {
      if (job.finishedAtMs === null || job.finishedAtMs > cutoff) continue
      jobs.delete(id)
      finishedSeen += 1
    }
    let extra = 0
    for (const [id, job] of jobs) {
      if (job.finishedAtMs === null) continue
      extra += 1
      if (extra <= maxFinished) continue
      jobs.delete(id)
    }
  }

  function publicView(job) {
    // 只暴露客户端需要的字段。**绝不**把内部 Promise / 函数带出去。
    return {
      id: job.id,
      key: job.key,
      name: job.name,
      label: job.label,
      spec: job.spec,
      kind: job.kind,
      state: job.state,
      queuedAt: new Date(job.queuedAtMs).toISOString(),
      startedAt: job.startedAtMs === null ? null : new Date(job.startedAtMs).toISOString(),
      finishedAt: job.finishedAtMs === null ? null : new Date(job.finishedAtMs).toISOString(),
      // 取消请求**已被接受** ≠ 已经停下：宿主要在 pnpm 退出后才真的取消，
      // 中间可能还会跑几秒（甚至进到 applying 阶段就 too-late）。如实区分这两个。
      cancelRequested: job.cancelRequested,
      // 已批准的构建脚本要随作业带上：页面刷新后重新订阅这个作业时，
      // 收尾逻辑要靠它判断「是带批准重提的还是首次提交」（见 handleInstallResult）。
      approvedBuilds: job.approvedBuilds,
      // 结果：完成后才有。`payload` 就是原来 /install 的响应体，客户端照旧渲染。
      result: job.state === 'succeeded' ? job.payload : null,
      error: job.error
    }
  }

  /** 列表：未完成的在前（按提交顺序），然后是最近的已完成（新→旧）。 */
  function list() {
    prune()
    const active = []
    const finished = []
    for (const job of jobs.values()) {
      if (job.state === 'queued' || job.state === 'running') active.push(publicView(job))
      else finished.push(publicView(job))
    }
    finished.reverse()
    return { active, finished }
  }

  function get(id) {
    const job = jobs.get(String(id))
    return job === undefined ? null : publicView(job)
  }

  async function advance(job) {
    job.state = 'running'
    job.startedAtMs = now()
    try {
      const outcome = await runJob({
        id: job.id,
        key: job.key,
        name: job.name,
        label: job.label,
        spec: job.spec,
        kind: job.kind,
        requestId: job.requestId,
        approvedBuilds: job.approvedBuilds
      })
      // runJob 的返回值有两种形状：`{ ok, payload }`（正常，payload 是原 /install 响应）
      // 或直接抛错。取消由 runJob 自己通过 outcome.state 报（它最清楚宿主回了什么）。
      if (outcome !== null && typeof outcome === 'object' && outcome.state === 'cancelled') {
        job.state = 'cancelled'
        job.payload = outcome.payload ?? null
      } else if (outcome !== null && typeof outcome === 'object' && outcome.ok === true) {
        job.state = 'succeeded'
        job.payload = outcome.payload ?? null
      } else {
        job.state = 'failed'
        job.payload = outcome?.payload ?? null
        job.error = outcome?.error ?? '安装没有完成'
      }
    } catch (error) {
      job.state = 'failed'
      job.error = shortError(error)
    } finally {
      job.finishedAtMs = now()
      running -= 1
      if (activeByKey.get(job.key) === job.id) activeByKey.delete(job.key)
      // 让出下一格；用 queueMicrotask 而不是立刻递归，避免深调用栈。
      pump()
    }
  }

  function pump() {
    if (pumpScheduled) return
    pumpScheduled = true
    queueMicrotask(() => {
      pumpScheduled = false
      for (const job of jobs.values()) {
        if (running >= concurrency) break
        if (job.state !== 'queued') continue
        running += 1
        // 不 await：作业要脱离请求生命周期独立推进（这正是本模块存在的理由）。
        void advance(job)
      }
    })
  }

  /**
   * 提交一个安装作业。
   *
   * @returns `{ ok:true, job, deduped:boolean }` 或 `{ ok:false, code, message }`
   *   `deduped:true` 表示同一个包已经有一个未完成作业，返回的是那一个（不重复排队）。
   */
  function submit(input = {}) {
    prune()
    const key = typeof input.key === 'string' && input.key !== '' ? input.key : null
    if (key === null) return { ok: false, code: 'bad-request', message: '作业缺少 key。' }

    const existingId = activeByKey.get(key)
    if (existingId !== undefined) {
      const existing = jobs.get(existingId)
      if (existing !== undefined) return { ok: true, job: publicView(existing), deduped: true }
      activeByKey.delete(key)
    }

    // 刚刚成功过、且用户点的是**同一个包同一个 spec** ⇒ 不要重跑一遍 pnpm。
    // 这是「装完立刻又点一下」的常见情形：pnpm 真的会再跑一次（虽然宿主 lock 会串行化），
    // 而用户看到的是「怎么又在装」。返回那个已完成作业并标 `alreadyDone`，让客户端说
    // 「刚装好了」而不是假装刚发起一次。
    // 只认**成功**且 spec 完全一致：失败的、或 spec 变了的（=真的升级）都不该被吞。
    if (input.allowRecentlyDone !== false) {
      const recentWindowMs = Number.isFinite(options.recentlyDoneMs) ? options.recentlyDoneMs : 5 * 60 * 1000
      // 从**最新**往回找：同一个包可能装成功过多次（装 → 升级 → 又装回旧版），
      // 真正相关的是最近那一次。从旧往新找到的会是历史作业，语义就错了。
      const entries = [...jobs.values()].reverse()
      for (const job of entries) {
        if (job.state !== 'succeeded' || job.key !== key) continue
        if (job.spec !== (input.spec ?? null)) continue
        if (job.finishedAtMs === null || now() - job.finishedAtMs > recentWindowMs) continue
        return { ok: true, job: publicView(job), deduped: true, alreadyDone: true }
      }
    }

    let activeCount = 0
    for (const job of jobs.values()) {
      if (job.state === 'queued' || job.state === 'running') activeCount += 1
    }
    if (activeCount >= maxActive) {
      return { ok: false, code: 'too-many-jobs', message: `同时进行的安装太多了（上限 ${maxActive}），等它们完成再试。` }
    }

    const job = {
      id: randomUUID(),
      key,
      name: input.name ?? key,
      label: input.label ?? input.name ?? key,
      spec: input.spec ?? null,
      kind: input.kind === 'update' ? 'update' : 'install',
      requestId: typeof input.requestId === 'string' && input.requestId !== '' ? input.requestId : randomUUID(),
      approvedBuilds: Array.isArray(input.approvedBuilds) ? input.approvedBuilds.filter((x) => typeof x === 'string' && x !== '') : [],
      state: 'queued',
      queuedAtMs: now(),
      startedAtMs: null,
      finishedAtMs: null,
      cancelRequested: false,
      payload: null,
      error: null
    }
    jobs.set(job.id, job)
    activeByKey.set(key, job.id)
    pump()
    return { ok: true, job: publicView(job), deduped: false }
  }

  /**
   * 请求取消一个作业。
   *
   * **只对排队中的作业能"立刻取消"**：它还没开始，直接标记为 cancelled 即可。
   * 正在跑的作业只能**转达**取消请求（`cancelJob` 回调，由 index.js 调宿主的
   * `cancelInstall(requestId)`），宿主可能回 `too-late`——那时应用阶段已经开始，
   * 取消不会生效。我们如实返回 `requested` 而不是假装已取消。
   */
  async function cancel(id, cancelJob) {
    const job = jobs.get(String(id))
    if (job === undefined) return { ok: false, code: 'job-not-found', message: '没有这个安装作业（宿主可能重启过）。' }
    if (job.state === 'queued') {
      job.state = 'cancelled'
      job.finishedAtMs = now()
      job.cancelRequested = true
      if (activeByKey.get(job.key) === job.id) activeByKey.delete(job.key)
      return { ok: true, status: 'cancelled', job: publicView(job) }
    }
    if (job.state !== 'running') {
      return { ok: false, code: 'job-finished', message: `作业已经结束（${job.state}），无需取消。`, job: publicView(job) }
    }
    job.cancelRequested = true
    let status = 'requested'
    if (typeof cancelJob === 'function') {
      try {
        const verdict = await cancelJob(job.requestId)
        // 宿主回 { status: 'cancelled' | 'too-late' | 'not-running' }（dsh-plugin-manager）。
        if (verdict !== null && typeof verdict === 'object' && typeof verdict.status === 'string') status = verdict.status
      } catch (error) {
        return { ok: false, code: 'cancel-failed', message: shortError(error), job: publicView(job) }
      }
    }
    return { ok: true, status, job: publicView(job) }
  }

  /** 仅供测试/诊断：清空。 */
  function reset() {
    jobs.clear()
    activeByKey.clear()
    running = 0
  }

  return { submit, list, get, cancel, reset, config: { concurrency, finishedTtlMs, maxFinished, maxActive } }
}
