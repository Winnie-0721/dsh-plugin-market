/**
 * 目录身份层与内容校验的行为回归（`verify/` 下所有 *.test.mjs 都由 release.ps1 门禁执行）。
 *
 * 为什么需要它：`verify/` 里此前**没有任何测试**钉 `repoTail` / `buildMatchIndex` /
 * `matchBundle` / `validateCatalogPayload` / `filterPlugins` / `sortPlugins` / `paginate`。
 * 这一批函数决定「哪个插件被标成已安装」「点更新会装哪个包」「搜出来的是什么」，
 * 一旦偏移就是用户可见的错误匹配与错误安装——却没有任何断言拦着。
 *
 * 每条都是先有真实的错，再钉住正确的行为；注释里写清「错在哪儿」，避免以后有人
 * 把兜底逻辑加回来。真实数据（4412 条快照）在 _ref/data/plugins.json，存在时一并跑，
 * 不存在时只跑构造用例（不依赖私有快照也能在别的机器上过）。
 *
 * 用法：node verify/catalog-identity.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  filterPlugins,
  joinBundles,
  joinInstalled,
  normalizeCatalog,
  normalizeItem,
  paginate,
  repoTail,
  sortPlugins,
  validateCatalogPayload
} from '../plugin-market/lib/catalog.js'

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

console.log('\n[1] repoTail：仓库名，而不是 URL 的最后一段')
check('monorepo 子目录 URL 取仓库名，不退化成子目录名', () => {
  // 错过的样子：`/tree/main/adapters/dsh` 的最后一段是 `dsh`——通用词，和别的仓库撞车。
  assert.equal(repoTail('https://github.com/5101good/amoji/tree/main/adapters/dsh'), 'amoji')
  assert.equal(repoTail('https://github.com/x/dsh-proactive/tree/main/packages/dsh-proactive'), 'dsh-proactive')
})
check('普通仓库地址、.git 后缀、大小写与查询串', () => {
  assert.equal(repoTail('https://github.com/a/b'), 'b')
  assert.equal(repoTail('https://github.com/a/b.git'), 'b')
  assert.equal(repoTail('https://github.com/a/b/'), 'b')
  assert.equal(repoTail('https://github.com/a/b?tab=readme'), 'b')
})
check('非 URL（scp 形式）也能取到仓库名；空值返回 null', () => {
  assert.equal(repoTail('git@github.com:owner/repo.git'), 'repo')
  assert.equal(repoTail('git@github.com:owner/repo'), 'repo')
  assert.equal(repoTail(''), null)
  assert.equal(repoTail(null), null)
})
check('blob/releases 等子路径同样只取仓库名', () => {
  assert.equal(repoTail('https://github.com/a/b/blob/main/src/index.ts'), 'b')
  assert.equal(repoTail('https://github.com/a/b/releases/tag/v1.0.0'), 'b')
})
check('不靠启发式找 /tree/：仓库或 owner 恰好叫 tree 也算得对', () => {
  // 早先的写法是「先找 /tree/ 再回溯」，这三种输入都会算错（仓库自身就叫 tree、
  // owner 叫 tree、GitLab 的 `/-/tree/` 形态）。取前两段则全部正确。
  assert.equal(repoTail('https://github.com/owner/tree'), 'tree')
  assert.equal(repoTail('https://github.com/owner/tree/tree/main/x'), 'tree')
  assert.equal(repoTail('https://github.com/tree/realrepo'), 'realrepo')
  assert.equal(repoTail('https://gitlab.com/owner/repo/-/tree/main/sub'), 'repo')
})

console.log('\n[2] 身份匹配：只认可信身份，歧义不猜')
const catalog = [
  // npm 键与显示名相同、无 scope（真实目录里 1431 条是这种形态：去 scope 兜底会撞上它们）
  normalizeItem({ name: 'dsh-answer-reviewer', owner: 'bycall', npm: 'dsh-answer-reviewer', version: '0.7.6', category: 'other' }),
  // 同名的另一个条目，用来制造 name 歧义
  normalizeItem({ name: 'dsh-answer-reviewer', owner: 'someone-else', npm: '@someone/dsh-answer-reviewer', version: '0.1.0', category: 'other' }),
  // npm 为空、靠仓库地址兜底的条目
  normalizeItem({ name: 'repo-only', owner: 'acme', url: 'https://github.com/acme/repo-only', version: '1.0.0', category: 'other' })
]

check('目录里不存在的 @scope/<name> 不得命中同名条目（会装成另一个包）', () => {
  // 错过的样子：matchBundle 把 `@unknownorg/dsh-answer-reviewer` 的 scope 剥掉再查，
  // 命中 npm 叫 `dsh-answer-reviewer` 的**另一个包** → 假「已安装/可更新」，点更新装错包。
  const joined = joinBundles([{ name: '@unknownorg/dsh-answer-reviewer', version: '0.0.1' }], catalog)
  assert.equal(joined[0].latest, null)
  assert.equal(joined[0].updateAvailable, false)
  const installed = joinInstalled(catalog, [{ name: '@unknownorg/dsh-answer-reviewer', version: '0.0.1' }])
  assert.equal(installed.find((i) => i.id === 'bycall/dsh-answer-reviewer').installed, false)
})
check('npm 名精确命中仍然有效（修复不能误伤正确匹配）', () => {
  const joined = joinBundles([{ name: 'dsh-answer-reviewer', version: '0.1.0' }], catalog)
  assert.equal(joined[0].latest, '0.7.6')
  assert.equal(joined[0].updateAvailable, true)
})
check('npm 为空的条目用仓库名兜底命中', () => {
  const joined = joinBundles([{ name: 'repo-only', version: '0.9.0' }], catalog)
  assert.equal(joined[0].latest, '1.0.0')
  assert.equal(joined[0].updateAvailable, true)
})
check('带 scope 的名字命中同 scope 的同名仓库条目（@owner/repo）', () => {
  const joined = joinBundles([{ name: '@acme/repo-only', version: '0.9.0' }], catalog)
  assert.equal(joined[0].latest, '1.0.0')
})
check('@owner/name 别名：从 git 安装、包名带 scope 的合法场景要能认回', () => {
  // 真实目录 1431 条是「无 scope 且 npm===name」；`dsh plugin add <git url>` 装出来的包
  // 常叫 `@owner/name`。第一版修复把「剥 scope 兜底」整体删掉，反而让这 1431 条认不回来——
  // 正确做法是**按 owner 对别名**：owner 对得上才认。
  const joined = joinInstalled(catalog, [{ name: '@bycall/dsh-answer-reviewer', version: '0.0.1' }])
  assert.equal(joined.find((i) => i.id === 'bycall/dsh-answer-reviewer').installed, true)
  const wrongOwner = joinInstalled(catalog, [{ name: '@someone-else/dsh-answer-reviewer', version: '0.0.1' }])
  assert.equal(wrongOwner.find((i) => i.id === 'bycall/dsh-answer-reviewer').installed, false, 'owner 对不上不得认')
})
check('大小写不敏感', () => {
  const joined = joinBundles([{ name: 'DSH-Answer-Reviewer', version: '0.1.0' }], catalog)
  assert.equal(joined[0].latest, '0.7.6')
})
check('重名仓库（同一 repo 名有两个 owner）不再乱认其中一个', () => {
  // 真实数据里不同 owner 的同名仓库（`dsh-drag-and-drop` 同时属于 `AKIRACOD/…` 与 `bill9109/…`）：
  // 旧逻辑「先到先得」会把其中一个说成已安装（还可能是错的），新逻辑标记歧义、不匹配
  // ——宁可不显示角标，也不能指错。用 owner/repo 仍能精确认回。
  const dup = [
    normalizeItem({ name: 'dup-repo', owner: 'aaa', url: 'https://github.com/aaa/dup-repo', category: 'other' }),
    normalizeItem({ name: 'dup-repo', owner: 'bbb', url: 'https://github.com/bbb/dup-repo', category: 'other' })
  ]
  const byRepoName = joinInstalled(dup, [{ name: 'dup-repo', version: '1.0.0' }])
  assert.deepEqual(byRepoName.map((i) => i.installed), [false, false], '歧义键不得匹配任何一条')
  const byOwnerRepo = joinInstalled(dup, [{ name: '@aaa/dup-repo', version: '1.0.0' }])
  assert.deepEqual(byOwnerRepo.map((i) => i.installed), [true, false], '@owner/repo 必须能精确认回')
})
check('同一仓库的多个子插件：装了该仓库就该全部认回（不是歧义）', () => {
  // monorepo 里 `name` 形如 `repo#sub`（`#` 后是子目录），多条共用一个仓库身份——
  // 这是**正确**身份而非重名。真实目录里 50 个仓库有 2 条以上（共 463 条带 `#`）。
  const multi = [
    normalizeItem({ name: 'studio#panel-a', owner: 'acme', url: 'https://github.com/acme/studio/tree/main/packages/panel-a', category: 'other' }),
    normalizeItem({ name: 'studio#panel-b', owner: 'acme', url: 'https://github.com/acme/studio/tree/main/packages/panel-b', category: 'other' })
  ]
  const joined = joinInstalled(multi, [{ name: '@acme/studio', version: '1.0.0' }])
  assert.deepEqual(joined.map((i) => i.installed), [true, true], '同一仓库的多条都要认回')
  const bare = joinInstalled(multi, [{ name: 'studio', version: '1.0.0' }])
  assert.deepEqual(bare.map((i) => i.installed), [true, true], '裸仓库名也指向同一仓库')
})

console.log('\n[3] validateCatalogPayload：坏数据不能覆盖好缓存')
check('count>0 但 plugins 为空 → 拒绝（市场不该被清空且不报错）', () => {
  // 错过的样子：只查类型，`{count:4412, plugins:[]}` 合法 → 以 stale:false 覆盖好缓存，
  // 市场整个变空、分类消失，且不显示过期横幅，看起来像「真的一共 0 个插件」。
  const verdict = validateCatalogPayload({ count: 4412, plugins: [] })
  assert.equal(verdict.ok, false)
})
check('plugins 条数与 count 相差过大（截断）→ 拒绝', () => {
  const verdict = validateCatalogPayload({ count: 4412, plugins: new Array(100).fill({}) })
  assert.equal(verdict.ok, false)
})
check('结构合法且条数吻合 → 通过（含 count 为 0 的空目录）', () => {
  assert.equal(validateCatalogPayload({ count: 0, plugins: [] }).ok, true)
  assert.equal(validateCatalogPayload({ count: 3, plugins: [{}, {}, {}] }).ok, true)
  // 小目录给 5 条余量：手工维护的 `DSHM_REGISTRY_URL` 源里 count 写错几条很常见，
  // 按 1% 算容差 1 会把只有几十条的目录整源拒掉。
  assert.equal(validateCatalogPayload({ count: 10, plugins: new Array(13).fill({}) }).ok, true, '小目录差 3 条仍放行')
  assert.equal(validateCatalogPayload({ count: 10, plugins: new Array(20).fill({}) }).ok, false, '差一倍要拒')
  // 大目录按 2%：真实快照 4412 条。
  assert.equal(validateCatalogPayload({ count: 4412, plugins: new Array(4400).fill({}) }).ok, true)
  assert.equal(validateCatalogPayload({ count: 4412, plugins: new Array(100).fill({}) }).ok, false, '截断要拒')
})
check('缺字段仍然被拒', () => {
  assert.equal(validateCatalogPayload(null).ok, false)
  assert.equal(validateCatalogPayload({ plugins: [] }).ok, false)
  assert.equal(validateCatalogPayload({ count: 1 }).ok, false)
})

console.log('\n[4] 搜索：只搜用户看得到的字段')
const searchable = [
  normalizeItem({ name: 'alpha-tool', owner: 'someone', url: 'https://github.com/someone/github-ish', description: { zh: '搜索', en: 'A tool' }, category: 'other' }),
  normalizeItem({ name: 'beta-tool', owner: 'github-owner', description: { zh: '另一个', en: 'Another' }, category: 'other' }),
  normalizeItem({ name: 'José-widget', owner: 'accents', description: { zh: '带重音', en: 'Accented' }, category: 'other' })
]
check('搜 `github` 不再命中所有条目（url 只对地址形状的查询生效）', () => {
  // 错过的样子：url 拼进 haystack，几乎所有条目都有 github 地址 → 搜 `github` 命中全量。
  const hit = filterPlugins(searchable, { query: 'github' })
  assert.deepEqual(hit.map((i) => i.name), ['beta-tool'])
})
check('粘贴仓库地址仍能搜到（url 参与匹配，但只认地址形状的词）', () => {
  // 这一条防的是「为了修全量噪音而把 url 从搜索里删掉」的过度修复：
  // 用户从 GitHub 复制地址粘进搜索框是常见操作，删掉 url 会让它 0 结果。
  const items = [
    normalizeItem({ name: 'alpha-tool', owner: 'someone', url: 'https://github.com/someone/alpha-tool', category: 'other' })
  ]
  assert.equal(filterPlugins(items, { query: 'https://github.com/someone/alpha-tool' }).length, 1, '完整地址')
  assert.equal(filterPlugins(items, { query: 'github.com/someone/alpha-tool' }).length, 1, '无协议地址')
  assert.equal(filterPlugins(items, { query: 'someone/alpha-tool' }).length, 1, 'owner/repo')
  assert.equal(filterPlugins(items, { query: 'github' }).length, 0, '通用词不应因每条都有 github 地址而全命中')
})
check('按名字、作者、描述都能搜到', () => {
  assert.equal(filterPlugins(searchable, { query: 'alpha' }).length, 1)
  assert.equal(filterPlugins(searchable, { query: 'github-owner' }).length, 1)
  assert.equal(filterPlugins(searchable, { query: 'another' }).length, 1)
})
check('多个词是「与」语义', () => {
  assert.equal(filterPlugins(searchable, { query: 'beta tool' }).length, 1)
  assert.equal(filterPlugins(searchable, { query: 'beta nonexistent' }).length, 0)
})
check('变音符号可被 ASCII 搜到（José ← jose）', () => {
  assert.equal(filterPlugins(searchable, { query: 'jose' }).length, 1)
})

console.log('\n[5] 排序是全序：同样的数据 → 同样的分页')
const tied = [
  normalizeItem({ name: 'dup', owner: 'zzz', stars: 1, downloads: 1, category: 'other' }),
  normalizeItem({ name: 'dup', owner: 'aaa', stars: 1, downloads: 1, category: 'other' }),
  normalizeItem({ name: 'dup', owner: 'mmm', stars: 1, downloads: 1, category: 'other' })
]
check('完全并列的条目在正序/倒序输入下排序结果一致', () => {
  // 错过的样子：并列比较返回 0，顺序由输入决定 → 刷新源顺序后同一插件换页位，
  // 页边界上可能重复或漏掉条目。
  const forward = sortPlugins(tied, 'top').map((i) => i.id)
  const reverse = sortPlugins(tied.slice().reverse(), 'top').map((i) => i.id)
  assert.deepEqual(forward, reverse)
})
check('四种排序都不抛错且不改动入参数组', () => {
  const input = tied.slice()
  const snapshot = JSON.stringify(input)
  for (const sort of ['top', 'new', 'downloads', 'name']) sortPlugins(input, sort)
  assert.equal(JSON.stringify(input), snapshot, '排序不得原地改动调用方的数组')
})
check('未知排序仍然抛错（不悄悄回默认）', () => {
  assert.throws(() => sortPlugins(tied, 'nope'))
})

console.log('\n[6] 分页：超出末页时收敛，不返回自相矛盾的空页')
check('page 超出末页 → 收敛到末页且有内容', () => {
  // 错过的样子：返回 page=5/pages=2/items=[]，界面显示「共 40 个结果 · 第 5/2 页」+ 空网格。
  const page = paginate(new Array(40).fill(0).map((_, i) => i), 5, 24)
  assert.equal(page.page, 2)
  assert.equal(page.pages, 2)
  assert.equal(page.items.length, 16)
  assert.equal(page.requestedPage, 5)
})
check('空结果仍是 pages=1 / page=1', () => {
  const page = paginate([], 1, 24)
  assert.equal(page.pages, 1)
  assert.equal(page.page, 1)
  assert.equal(page.total, 0)
})
check('非法 page/pageSize 回落到默认值', () => {
  const page = paginate([1, 2, 3], 0, 0)
  assert.equal(page.page, 1)
  assert.equal(page.pageSize, 24)
})

// ── 真实快照（可选）：存在时用真实数据复核上面每一条的规模 ──
const snapshotPath = fileURLToPath(new URL('../_ref/data/plugins.json', import.meta.url))
if (existsSync(snapshotPath)) {
  console.log('\n[7] 真实目录快照（4412 条）')
  const raw = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  const real = normalizeCatalog(raw, { source: 'snapshot' })
  const items = real.plugins

  check('真实快照通过内容校验', () => {
    assert.equal(validateCatalogPayload(raw).ok, true)
  })
  check('搜 `github` 不再命中全量', () => {
    const hit = filterPlugins(items, { query: 'github' }).length
    assert.ok(hit < items.length / 10, `命中 ${hit}/${items.length}（修复前是 4412/4412）`)
  })
  check('monorepo 子目录不再产出通用短键', () => {
    const generic = items.filter((item) => {
      const segments = String(item.url ?? '').split('/').filter((part) => part !== '')
      return segments.includes('tree') && ['dsh', 'bundle', 'client', 'plugin'].includes(repoTail(item.url))
    })
    assert.equal(generic.length, 0, `仍有 ${generic.length} 条退化成通用词`)
  })
  check('repoTail 与真实 URL 的第 2 段（仓库名）完全一致', () => {
    // 早期失败的写法在 435 条 monorepo 地址上算错；这条把「4412/4412 一致」钉死。
    const mismatched = items.filter((item) => {
      if (!item.url) return false
      let repo
      try { repo = new URL(item.url).pathname.split('/').filter(Boolean)[1] } catch { return false }
      return repo !== undefined && repoTail(item.url) !== repo
    })
    assert.equal(mismatched.length, 0, `${mismatched.length} 条算出来的仓库名不对，例如 ${mismatched[0]?.id}`)
  })
  check('npm 为空的条目仍能用仓库名认回自己（歧义键除外）', () => {
    // 旧逻辑（剥 scope + 取尾段）能认回 1755 条；新逻辑必须**不比它差**。
    const npmLess = items.filter((item) => item.npm === null && item.url)
    let recognized = 0
    for (const item of npmLess) {
      const name = repoTail(item.url)
      if (!name) continue
      const hit = joinInstalled(items, [{ name, version: '0.0.1' }]).find((i) => i.id === item.id)
      if (hit && hit.installed === true) recognized += 1
    }
    assert.ok(recognized >= 1755, `只认回 ${recognized} 条（旧逻辑是 1755，不能倒退）`)
  })
  check('真实规模：@owner/name 别名认回 ≥1400 条（「从 git 安装」的合法场景）', () => {
    // 这条拦的是「为了修张冠李戴而把 scope 兜底整体删掉」的过度修复：那会让 1431 条
    // 「无 scope 且 npm===name」的条目在 _install 路径上认不回来。
    const targets = items.filter((i) => i.npm && !i.npm.includes('/') && i.npm === i.name && i.owner)
    let reclaimed = 0
    for (const item of targets) {
      const hit = joinInstalled(items, [{ name: `@${item.owner}/${item.name}`, version: '0.0.1' }]).find((i) => i.id === item.id)
      if (hit && hit.installed === true) reclaimed += 1
    }
    assert.ok(reclaimed >= 1400, `只认回 ${reclaimed}/${targets.length}，疑似把 @owner/name 别名一起去掉了`)
  })
  check('所有 npm 条目的精确匹配都还能命中（修复未误伤）', () => {
    const withNpm = items.filter((item) => item.npm !== null)
    const misses = withNpm.filter((item) => {
      const joined = joinBundles([{ name: item.npm, version: '0.0.1' }], items)
      return joined[0].latest !== item.version
    })
    assert.equal(misses.length, 0, `${misses.length} 条 npm 条目匹配不上，例如 ${misses[0]?.id}`)
  })
  check('排序对输入顺序不敏感（真实规模）', () => {
    const forward = sortPlugins(items, 'top').map((i) => i.id)
    const reverse = sortPlugins(items.slice().reverse(), 'top').map((i) => i.id)
    assert.deepEqual(forward, reverse)
  })
}

console.log('')
if (failures.length > 0) {
  console.log(`目录身份与内容校验：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`目录身份与内容校验：${passed}/${passed} 全通过`)
}
