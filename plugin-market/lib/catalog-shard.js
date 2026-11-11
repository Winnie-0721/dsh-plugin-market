/**
 * 目录分片协议（format 2）——**发布端与消费端共用这一份定义**。
 *
 * 为什么要有它（2026-11-11）：`plugins.json` 单体已经 12.90 MiB、约 +0.25 MiB/天
 * （9,714 条）。v1.3.3 把解压改成流式、把上限提到 64 MiB，那只是**买时间**——
 * 单体 JSON 迟早会撞上任何上限，而每次撞上都是「整个市场打不开」。
 * 分片把「一次失败 = 全部失败」变成「一次失败 = 一个分类」，并且让客户端能
 * **只取变化的那几片**（清单里带每片的 sha256 与字节数）。
 *
 * 形状（三个文件，全部 UTF-8 JSON）：
 *
 *   catalog/catalog.json              清单：版本、总数、分片索引（每片 id/part/条数/字节/sha256）
 *   catalog/shards/<id>.<part>.json   分片：{ format, kind, id, part, count, plugins: [...] }
 *
 * 分片 id 是**分类 id**（`ui`、`tools`、…），没有分类的条目归 `_uncategorized`。
 * 为什么按分类而不是按名字首字母：实测 9,714 条里 `dsh-*` 占 9.96 MiB / 11.04 MiB，
 * 按首字母切会得到一个 9.96 MiB 的 `d.json`，等于没切。按分类切，最大片 2.19 MiB、
 * 23 个分类、分布与「用户按分类浏览」的真实行为一致（分类 chips 本来就是这个维度）。
 *
 * **不变量**（消费端必须能验证，发布端必须能自证）：
 *  1. 清单的 `count` === 所有分片 `count` 之和；
 *  2. 每片的 sha256 覆盖**该片 JSON 的原始字节**（消费端解析前校验，防截断/投毒）；
 *  3. `format` 不匹配 ⇒ 两代不兼容，直接按「该源失败」处理，不猜；
 *  4. 分片 id 只允许 `[a-z0-9_-]`（与分类 id 同形），**这是路径安全的唯一保证**——
 *     不允许 `..`、`/`、绝对路径；消费端还要再校验一次（服务端给的协议字段一律不可信）。
 */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

/** 分片协议版本。1 = 旧的单片 `plugins.json`（无此字段）。 */
export const SHARD_FORMAT = 2

/** 清单文件名与分片目录（相对清单所在目录）。 */
export const SHARD_MANIFEST_NAME = 'catalog.json'
export const SHARD_DIR = 'shards'

/**
 * 单片目标字节数：2 MiB。
 *
 * 实测（2026-11-11，9,714 条）：按分类分组后，最大的 `ui` 自然就有 2.19 MiB，
 * 其余分类都远小于它。取 2 MiB 让「一个分类还装得下」成为常见情况（24 片、最大 2.00 MiB），
 * 同时单片下载在 3G/弱网下也是秒级。
 */
export const SHARD_TARGET_BYTES = 2 * 1024 * 1024

/** 单片硬上限：超过它的分片**不许发布**（发布端自检），消费端也据此拒收。 */
export const SHARD_MAX_BYTES = 8 * 1024 * 1024

/** 没有分类的条目归到这一片。 */
export const UNCATEGORIZED_SHARD = '_uncategorized'

/** 单片最多允许多少条目（防「一片塞满 10 万条」把客户端渲染拖死；真实最大 1,928）。 */
export const SHARD_MAX_ITEMS = 50_000

/**
 * 分片 id 的形状：`[a-z0-9_-]`，**允许多下划线开头**（内部保留名 `_uncategorized`），
 * 但**不允许 `..`**——单段内的 `..` 本身无害（它不是路径分隔符），但多一个可绕的点
 * 只会让审计更难，所以干脆禁止整段只有点和下划线的组合。
 *
 * 挡住的形状（每条都是真实攻击面）：`../x`、`a/b`、`/etc`、`C:`、`.`、`..`、
 * `UI`（大小写不同 → 大小写不敏感的文件系统上会撞名）、空串、超长。
 */
const SHARD_ID_PATTERN = /^(?!\.)[a-z0-9_-]{1,64}$/
const SHARD_ID_FORBIDDEN = new Set(['.', '..', '_', '-', '--', '__'])

/**
 * 分片 id 是否合法。**必须**在消费端再校验一次：
 * id 会被拼进 URL 变成 `<base>/shards/<id>.<part>.json`，一个 `../../etc/passwd`
 * 或 `a/b` 就能把请求引到别处（哪怕最终只是拼 URL，也不该让远端数据决定路径形状）。
 */
export function isValidShardId(id) {
  return typeof id === 'string' && SHARD_ID_PATTERN.test(id) && !SHARD_ID_FORBIDDEN.has(id)
}

/** 分片 part（1 起）是否合法。 */
export function isValidShardPart(part) {
  return Number.isSafeInteger(part) && part >= 1 && part <= 999
}

/**
 * 分片的相对路径。**只有校验通过的 id/part 才会被拼进来**——
 * 这个函数是路径的唯一生成处，任何调用方都不该自己拼字符串。
 */
export function shardPath(id, part) {
  if (!isValidShardId(id)) throw new Error(`非法分片 id：${JSON.stringify(id)}`)
  if (!isValidShardPart(part)) throw new Error(`非法分片 part：${JSON.stringify(part)}`)
  return `${SHARD_DIR}/${id}.${part}.json`
}

/** 分片的稳定名字（日志与缓存键用，不含路径）。 */
export function shardName(id, part) {
  return `${id}.${part}`
}

/**
 * 把条目按「分类 → 目标字节」切成发布单元。
 *
 * 切法：先按 `category` 分组（保持源顺序，**不重排**——目录顺序本身有意义：
 * 上游按 star/下载量排过），再在组内**按字节累加**切 part。单条超过目标值时
 * 单独成片（不拒绝——一条条目再大也只是 1 条，拒它等于丢数据）。
 *
 * @param items - 原始条目数组（不做规范化，原样搬运；发布端不该改写上游字段）。
 * @param options.targetBytes - 单片目标字节（缺省 SHARD_TARGET_BYTES）。
 * @param options.serialize - 分片正文的序列化函数（测试注入用，缺省 JSON.stringify）。
 * @returns `{ shards: [{ id, part, count, bytes, body, sha256 }], total }`
 */
export function splitShards(items, options = {}) {
  const list = Array.isArray(items) ? items : []
  const target = Number.isSafeInteger(options.targetBytes) && options.targetBytes > 0
    ? options.targetBytes
    : SHARD_TARGET_BYTES
  const serialize = typeof options.serialize === 'function' ? options.serialize : (value) => JSON.stringify(value)

  // 分组，并保留「组第一次出现的顺序」——分类顺序跟源一致，客户端 chips 的顺序才不会跳。
  const groups = new Map()
  for (const item of list) {
    const rawId = item !== null && typeof item === 'object' ? item.category : null
    const id = isValidShardId(rawId) ? rawId : UNCATEGORIZED_SHARD
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(item)
  }

  const shards = []
  for (const [id, group] of groups) {
    let part = 1
    let bucket = []
    let bytes = 0
    const flush = () => {
      if (bucket.length === 0) return
      const body = serialize(shardDocument(id, part, bucket))
      shards.push({ id, part, count: bucket.length, bytes: Buffer.byteLength(body, 'utf8'), body })
      part += 1
      bucket = []
      bytes = 0
    }
    for (const item of group) {
      // 用该条目在**当前分片里**的真实增量算，而不是估算：序列化后的字节才是要传的字节。
      const cost = Buffer.byteLength(serialize(item), 'utf8') + 1
      if (bytes + cost > target) flush()
      bucket.push(item)
      bytes += cost
    }
    flush()
  }
  return { shards, total: list.length }
}

/** 分片文档形状（`kind` 让「拿错文件」当场暴露，而不是解析成一个空分片）。 */
export function shardDocument(id, part, plugins) {
  return {
    format: SHARD_FORMAT,
    kind: 'catalog-shard',
    id,
    part,
    count: plugins.length,
    plugins
  }
}

/** 清单文档形状。 */
export function manifestDocument({ updated, categories, count, shards, source }) {
  return {
    format: SHARD_FORMAT,
    kind: 'catalog-manifest',
    updated: updated ?? null,
    source: source ?? null,
    count,
    categories: categories ?? {},
    shards
  }
}

/**
 * 分片清单校验（**消费端在解析任何分片之前**跑这一遍）。
 *
 * 这条校验的价值不是「格式对不对」，而是「**能不能按它去发请求**」：
 * 一个坏清单可以指使客户端去拉任意路径、拉 10 万片、或者声明一个和实际不符的 count
 * 让后面的完整性核对永远无法通过。所以三条独立防线：
 *   1. 结构（format/kind/count/shards 数组）；
 *   2. **每个 id/part 都合法**（路径安全）+ 不重复（重复会让 count 核对作弊）；
 *   3. 片数与总条数有上限（`SHARD_MAX_ITEMS`、片数上限），防放大攻击。
 */
export function validateManifest(raw, options = {}) {
  const maxShards = Number.isSafeInteger(options.maxShards) && options.maxShards > 0 ? options.maxShards : 512
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: '清单不是 JSON 对象。' }
  }
  if (raw.format !== SHARD_FORMAT) {
    return { ok: false, message: `清单 format 是 ${JSON.stringify(raw.format)}，本版只认 ${SHARD_FORMAT}。` }
  }
  if (raw.kind !== 'catalog-manifest') {
    return { ok: false, message: '清单 kind 不是 catalog-manifest。' }
  }
  if (!Number.isInteger(raw.count) || raw.count < 0) {
    return { ok: false, message: `清单 count 必须是 ≥0 的整数，收到 ${JSON.stringify(raw.count)}。` }
  }
  if (!Array.isArray(raw.shards) || raw.shards.length === 0) {
    return { ok: false, message: '清单缺少非空的 shards 数组。' }
  }
  if (raw.shards.length > maxShards) {
    return { ok: false, message: `清单声明 ${raw.shards.length} 个分片，超过上限 ${maxShards}。` }
  }
  const seen = new Set()
  let sum = 0
  for (const entry of raw.shards) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, message: 'shards 里有非对象条目。' }
    }
    if (!isValidShardId(entry.id)) {
      return { ok: false, message: `shards 里有非法 id：${JSON.stringify(entry.id)}。` }
    }
    if (!isValidShardPart(entry.part)) {
      return { ok: false, message: `分片 ${entry.id} 的 part 非法：${JSON.stringify(entry.part)}。` }
    }
    if (!Number.isInteger(entry.count) || entry.count < 0) {
      return { ok: false, message: `分片 ${entry.id}.${entry.part} 的 count 非法。` }
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > SHARD_MAX_BYTES) {
      return { ok: false, message: `分片 ${entry.id}.${entry.part} 的 bytes 非法（${JSON.stringify(entry.bytes)}）。` }
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      return { ok: false, message: `分片 ${entry.id}.${entry.part} 缺少合法的 sha256。` }
    }
    const key = shardName(entry.id, entry.part)
    if (seen.has(key)) {
      return { ok: false, message: `分片 ${key} 在清单里重复出现（重复会让 count 核对失去意义）。` }
    }
    seen.add(key)
    sum += entry.count
  }
  // 条目总数核对：清单说 9714 条，分片条数之和就必须是 9714。
  // 这是「缺片」在**发请求之前**就能被发现的唯一判据——否则客户端会拿少了几千条的目录
  // 去覆盖好缓存（`stale:false`），市场看起来只是「插件变少了」。
  if (sum !== raw.count) {
    return { ok: false, message: `清单 count（${raw.count}）与各分片条数之和（${sum}）不一致。` }
  }
  if (raw.count > SHARD_MAX_ITEMS * raw.shards.length) {
    return { ok: false, message: '清单的 count 与分片数量不相称（疑似放大攻击）。' }
  }
  return { ok: true }
}

/**
 * 分片正文校验（**解析前先验 sha256**，解析后再验内容与清单是否自洽）。
 *
 * 为什么两步都要：
 *  - sha256 挡住「传过来的字节不是清单说的那一份」（截断、中间人、CDN 串片）；
 *  - 内容核对挡住「哈希对得上但清单与分片互相打架」——比如分片自称 500 条、
 *    清单说 42 条。只验哈希的话，一份自洽的坏数据（清单与分片一起被换）验不出来，
 *    但**条数/身份不一致**是能验的，而它正好是「装错片」的典型症状。
 *
 * @param bytes - 分片原始字节
 * @param expected - 清单里对应的 `{ id, part, count, bytes, sha256 }`
 * @param parse - JSON 解析器（测试注入用）
 */
export function validateShard(bytes, expected, options = {}) {
  const actualSha = sha256Hex(bytes)
  if (actualSha !== expected.sha256) {
    return { ok: false, code: 'shard-integrity', message: `分片 ${shardName(expected.id, expected.part)} 的 sha256 与清单不符。` }
  }
  if (bytes.length !== expected.bytes) {
    return { ok: false, code: 'shard-integrity', message: `分片 ${shardName(expected.id, expected.part)} 的字节数（${bytes.length}）与清单（${expected.bytes}）不符。` }
  }
  const parse = typeof options.parse === 'function' ? options.parse : (text) => JSON.parse(text)
  let raw
  try {
    raw = parse(bytes.toString('utf8'))
  } catch {
    return { ok: false, code: 'shard-bad-json', message: `分片 ${shardName(expected.id, expected.part)} 不是合法 JSON。` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'shard-bad-json', message: `分片 ${shardName(expected.id, expected.part)} 不是 JSON 对象。` }
  }
  if (raw.format !== SHARD_FORMAT || raw.kind !== 'catalog-shard') {
    return { ok: false, code: 'shard-mismatch', message: `分片 ${shardName(expected.id, expected.part)} 的 format/kind 不对。` }
  }
  if (raw.id !== expected.id || raw.part !== expected.part) {
    return { ok: false, code: 'shard-mismatch', message: `分片内容自称 ${raw.id}.${raw.part}，与清单的 ${shardName(expected.id, expected.part)} 不符。` }
  }
  if (!Array.isArray(raw.plugins)) {
    return { ok: false, code: 'shard-mismatch', message: `分片 ${shardName(expected.id, expected.part)} 缺少 plugins 数组。` }
  }
  if (raw.plugins.length !== expected.count) {
    return { ok: false, code: 'shard-mismatch', message: `分片 ${shardName(expected.id, expected.part)} 有 ${raw.plugins.length} 条，清单说 ${expected.count} 条。` }
  }
  return { ok: true, plugins: raw.plugins }
}

/**
 * sha256 hex —— 发布端算清单、消费端验分片，**必须用同一份实现**。
 *
 * 这个模块同时被 `lib/catalog-shard-fetch.js`（host 半，Node）与
 * `scripts/build-catalog-shards.mjs`（发布端，Node）引用，所以直接用 `node:crypto`。
 * 它**不是**浏览器端模块：client 半拿到的永远是 host 组装好的完整目录，
 * 分片是 host 的事（浏览器直连会撞 CORS，也不该让页面自己去拼分片）。
 */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
