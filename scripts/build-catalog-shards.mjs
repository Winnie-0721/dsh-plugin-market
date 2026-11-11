#!/usr/bin/env node
/**
 * 把一份 `plugins.json` 切成可分发的分片，并写出一份清单。
 *
 * 这是**发布端**：产出 `catalog/catalog.json` + `catalog/shards/<id>.<part>.json`。
 * 发布端读完上游 plugins.json 之后运行本脚本，把 `--out` 目录整个发布（npm 包、
 * GitHub Pages、任何静态站都行）。协议定义在 `plugin-market/lib/catalog-shard.js`，
 * **发布端与消费端共用那一份**——两边各写一套就是下一次「清单说 9714 条、客户端拼出 9000 条」
 * 的来源。
 *
 * 用法：
 *   node scripts/build-catalog-shards.mjs --in plugins.json --out catalog
 *   node scripts/build-catalog-shards.mjs --in plugins.json --out catalog --target-bytes 2097152
 *   node scripts/build-catalog-shards.mjs --in plugins.json --out catalog --check
 *
 * `--check` 只校验**已有**的 out 目录（清单与分片是否自洽、每个 sha256 是否对得上），
 * 用于 CI：发布前先跑一次，避免把坏的分片发出去。
 *
 * 退出码：0 = 成功；1 = 校验失败/输入不合法；2 = 用法错误。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  SHARD_DIR,
  SHARD_FORMAT,
  SHARD_MAX_BYTES,
  SHARD_MANIFEST_NAME,
  SHARD_TARGET_BYTES,
  manifestDocument,
  sha256Hex,
  shardName,
  shardPath,
  splitShards,
  validateManifest,
  validateShard
} from '../plugin-market/lib/catalog-shard.js'

function parseArgs(argv) {
  const opts = { in: null, out: null, targetBytes: SHARD_TARGET_BYTES, check: false }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--in') { opts.in = value; i += 1 }
    else if (key === '--out') { opts.out = value; i += 1 }
    else if (key === '--target-bytes') { opts.targetBytes = Number(value); i += 1 }
    else if (key === '--check') { opts.check = true }
    else if (key === '--help' || key === '-h') { opts.help = true }
    else throw new Error(`不认识的参数：${key}`)
  }
  return opts
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** 读上游 plugins.json（容忍 UTF-8 BOM —— 记事本/PowerShell 编辑过的文件很常见）。 */
function readCatalog(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    fail(`读不到 ${path}：${error.message}`)
  }
  let raw
  try {
    raw = JSON.parse(text.trimStart())
  } catch (error) {
    fail(`${path} 不是合法 JSON：${error.message}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(`${path} 不是 JSON 对象。`)
  if (!Array.isArray(raw.plugins)) fail(`${path} 缺少 plugins 数组。`)
  return raw
}

/**
 * 自检：写完之后**从磁盘读回来**再验一遍。
 *
 * 为什么不在内存里验：真正会坏的是「磁盘上的字节」，而 sha256 是**按字节**算的。
 * 序列化两次（一次算清单、一次写盘）如果中间有任何差异（换行、编码），
 * 内存自检是发现不了的——只有读回来重算哈希才发现。这也正是消费端会做的事。
 */
function verifyOnDisk(outDir, manifest) {
  const failures = []
  for (const entry of manifest.shards) {
    const file = join(outDir, shardPath(entry.id, entry.part))
    let bytes
    try {
      bytes = readFileSync(file)
    } catch {
      failures.push(`${shardName(entry.id, entry.part)}：文件不存在`)
      continue
    }
    const verdict = validateShard(bytes, entry)
    if (verdict.ok !== true) failures.push(`${shardName(entry.id, entry.part)}：${verdict.message}`)
  }
  return failures
}

function build(opts) {
  const raw = readCatalog(opts.in)
  const started = Date.now()
  const { shards, total } = splitShards(raw.plugins, { targetBytes: opts.targetBytes })

  // 发布前把「单片过大」当场拦住：超过 SHARD_MAX_BYTES 的分片消费端会拒收，
  // 发出去等于让市场在某一天突然少一个分类。
  const oversized = shards.filter((shard) => shard.bytes > SHARD_MAX_BYTES)
  if (oversized.length > 0) {
    fail(`有 ${oversized.length} 个分片超过硬上限 ${SHARD_MAX_BYTES} 字节：` +
      oversized.slice(0, 3).map((s) => `${shardName(s.id, s.part)}=${s.bytes}B`).join('、') +
      '。调小 --target-bytes 或检查单条目体积。')
  }
  if (total !== raw.plugins.length) fail(`条目守恒失败：${total} != ${raw.plugins.length}`)

  const manifest = manifestDocument({
    updated: typeof raw.updated === 'string' ? raw.updated : null,
    source: typeof raw.url === 'string' ? raw.url : null,
    categories: raw.categories,
    count: total,
    shards: shards.map((shard) => ({
      id: shard.id,
      part: shard.part,
      count: shard.count,
      bytes: shard.bytes,
      // 关键：**对将要写盘的同一份字符串**算哈希
      sha256: sha256Hex(Buffer.from(shard.body, 'utf8'))
    }))
  })

  // 清单先自己过一遍校验器（与消费端同一个函数）——发布端发出自己都验不过的清单，
  // 是「两端漂移」最容易发生的形态。
  const manifestVerdict = validateManifest(manifest)
  if (manifestVerdict.ok !== true) fail(`生成的清单没有通过自检：${manifestVerdict.message}`)

  // 清掉旧分片：上一版多出来的片（分类消失、part 变多）如果留着，
  // 静态站上会存在「清单里没有、但 URL 可访问」的陈旧文件。
  const shardDirAbs = join(opts.out, SHARD_DIR)
  rmSync(shardDirAbs, { recursive: true, force: true })
  mkdirSync(shardDirAbs, { recursive: true })

  for (const shard of shards) {
    writeFileSync(join(opts.out, shardPath(shard.id, shard.part)), shard.body, 'utf8')
  }
  writeFileSync(join(opts.out, SHARD_MANIFEST_NAME), JSON.stringify(manifest, null, 1), 'utf8')

  const failures = verifyOnDisk(opts.out, manifest)
  if (failures.length > 0) {
    fail(`写盘自检失败（${failures.length} 处）：\n  ${failures.slice(0, 5).join('\n  ')}`)
  }

  const manifestBytes = Buffer.byteLength(JSON.stringify(manifest, null, 1), 'utf8')
  const totalShardBytes = shards.reduce((sum, shard) => sum + shard.bytes, 0)
  const largest = shards.reduce((max, shard) => (shard.bytes > max.bytes ? shard : max), shards[0])
  console.log(`✓ ${total} 条 → ${shards.length} 个分片（${Date.now() - started}ms）`)
  console.log(`  清单   ${manifestBytes} B`)
  console.log(`  分片   ${(totalShardBytes / 1048576).toFixed(2)} MiB（最大 ${shardName(largest.id, largest.part)} ${(largest.bytes / 1048576).toFixed(2)} MiB）`)
  console.log(`  输出   ${opts.out}`)
  return manifest
}

/** `--check`：只验已有产物（CI 用）。 */
function check(opts) {
  const manifestPath = join(opts.out, SHARD_MANIFEST_NAME)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`读不到/解析不了 ${manifestPath}：${error.message}`)
  }
  const verdict = validateManifest(manifest)
  if (verdict.ok !== true) fail(`清单不合法：${verdict.message}`)
  const failures = verifyOnDisk(opts.out, manifest)
  if (failures.length > 0) {
    fail(`分片校验失败（${failures.length} 处）：\n  ${failures.slice(0, 5).join('\n  ')}`)
  }
  // 目录里有没有「清单没提到」的陈旧分片？有就报出来（不致命，但发布端应该清掉）。
  const expected = new Set(manifest.shards.map((entry) => `${shardName(entry.id, entry.part)}.json`))
  const stray = readdirSync(join(opts.out, SHARD_DIR)).filter((name) => !expected.has(name))
  if (stray.length > 0) {
    console.log(`⚠ 有 ${stray.length} 个分片不在清单里（陈旧文件）：${stray.slice(0, 5).join('、')}`)
  }
  console.log(`✓ 清单与 ${manifest.shards.length} 个分片自洽（count=${manifest.count}）`)
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log('用法：node scripts/build-catalog-shards.mjs --in plugins.json --out catalog [--target-bytes N] [--check]')
  process.exit(0)
}
if (opts.check) {
  if (opts.out === null) { console.error('--check 需要 --out'); process.exit(2) }
  check(opts)
} else {
  if (opts.in === null || opts.out === null) {
    console.error('用法：node scripts/build-catalog-shards.mjs --in plugins.json --out catalog')
    process.exit(2)
  }
  mkdirSync(opts.out, { recursive: true })
  build(opts)
}
