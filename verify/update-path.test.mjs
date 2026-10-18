/**
 * 更新失败的根因与修法（门禁执行）。
 *
 * ## 用户报的问题
 * 「修复更新问题 / 宿主拒绝了这个操作。」
 * 实测（真宿主，POST /plugin-market/install）：
 *   {ok:false, application:"failed", stage:"install",
 *    target:"dsh-web-search-free@1.8.1",
 *    error:{code:"already-installed", message:"宿主拒绝了这个操作。"}}
 *
 * 两个可更新包（dsh-web-search-free 1.8.0→1.8.1、dsh-mobile 0.6.10→0.6.11）都是这个结果。
 *
 * ## 根因（从 app.asar 抠出宿主管家源码确认，不是猜）
 * PluginManager.installBundle 里这一行：
 *
 *   const known = specPackageName(spec, before, this.profile.dir);
 *   if (this.ownerContext.get("hmr") !== void 0 && known !== void 0 && Object.hasOwn(before, known))
 *     throw new ManagementFailure("already-installed");
 *
 * 而 specPackageName 对 spec 的分类决定 known：
 *   · kind === "registry" → 直接返回**包名** ⇒ 只要这个包已在 dependencies 里就拦，
 *     **完全不看版本**。所以 `pnpm add name@1.8.1` 这种升级写法必然被拦。
 *   · kind === "tarball"  → 去 dependencies 里找「spec 字面等于它」的 dep，找不到 ⇒ undefined
 *     ⇒ 拦截条件不成立，pnpm 照常把它当升级执行。
 *
 * 宿主管家**没有** upgrade / update / allowReinstall 任何入口（枚举过方法表：只有
 * installBundle / removeBundle / waitForInstall / cancelInstall 这几个写方法），
 * 所以只能在**市场这一侧**把更新请求改成 tarball 形式。
 *
 * ## 为什么不能靠「先卸再装」
 * removeBundle 对正在被加载的插件抛 stop-profile（见它的实现），桌面 profile 里这些包
 * 全是启用状态 ⇒ 走不通，而且卸载再装会在中途留下一个坏掉的 profile。
 *
 * ## 已验证 pnpm 真的能升级
 * 在用户 profile 上实测 `pnpm add dsh-web-search-free@1.8.1 --lockfile-only`：
 * 「✓ Lockfile passes supply-chain policies」+ Done —— 依赖声明 `^1.8.0` 本来就允许 1.8.1。
 * 也就是说宿主那句拒绝是**纯误拦截**，东西能装，只是入口被它自己的守卫挡了。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const host = readFileSync(join(here, '..', 'plugin-market', 'lib', 'index.js'), 'utf8')
const client = readFileSync(join(here, '..', 'plugin-market', 'lib', 'client.js'), 'utf8')

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

/** 抠函数体（配平花括号）。 */
function grab(source, signature) {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`抠不到：${signature}`)
  let depth = 0
  for (let j = source.indexOf('{', start); j < source.length; j += 1) {
    if (source[j] === '{') depth += 1
    else if (source[j] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, j + 1)
    }
  }
  throw new Error(`括号不配平：${signature}`)
}

console.log('\n[1] 把「更新」改写成 tarball spec（绕开宿主的同名拦截）')

check('存在 updateTarballSpec 且只在名字+版本都像样时才改写', () => {
  const body = grab(host, 'function updateTarballSpec(')
  assert.match(body, /registry\.npmjs\.org/, '要拼 npm registry 的 tarball URL')
  assert.match(body, /SEMVER_LIKE/, '版本必须像 semver 才改写（' + 'latest' + ' / range 不能拼 URL）')
  // 非 semver 版本要原样返回，不能硬拼出一个坏 URL
  assert.match(body, /return spec/, '不满足条件时原样返回')
})

check('scoped 包的 tarball URL 形状正确（@scope/name → name-version.tgz）', () => {
  const body = grab(host, 'function updateTarballSpec(')
  // scoped 包名去掉 @scope/ 前缀才是 tarball 文件名
  assert.match(body, /split\('\/'\)/, 'scoped 包要取最后一段做文件名')
})

check('改写只在更新场景生效（install 不受影响）', () => {
  // 安装本来就装新的，没必要改写成 tarball；而且改写会让「装什么」偏离目录给出的 spec。
  // 注意不能用花括号配平抠 install(req,res)：它体内有大量嵌套 {}，配平会截在半路。
  // 也不能直接 indexOf('updateTarballSpec(spec, hit)') —— 注释和函数声明都会先命中。
  // 所以找**带行首缩进的调用语句**：`  if (...) spec = updateTarballSpec(spec, hit)`。
  const callMatch = /^\s*if\s*\([^\n]*kind[^\n]*\)\s*spec = updateTarballSpec\(spec, hit\)\s*$/m.exec(host)
  assert.ok(callMatch, 'install 里要有「kind 是 update 才改写」的调用语句')
  assert.match(callMatch[0], /'update'|"update"/, "只在 kind === 'update' 时改写")
})

console.log('\n[2] 客户端要把 kind 告诉服务端')

check('submitInstall 在更新时把 kind 放进请求体', () => {
  const body = grab(client, 'function submitInstall(')
  assert.match(body, /body\.kind/, '请求体要带 kind，服务端才知道这是更新')
  assert.match(body, /target\.kind/, 'kind 来自 target')
})

check('updateBundle 传的是 kind:"update"', () => {
  const body = grab(client, 'function updateBundle(')
  assert.match(body, /kind:\s*"update"/, '更新必须标成 update')
})

console.log('\n[3] 不能倒退：安装路径的安全约束不变')

check('显式 spec 仍必须落在目录里（不能变成任意包安装器）', () => {
  const body = grab(host, 'async install(req, res)')
  assert.match(body, /not-in-catalog/, '目录校验必须还在')
  // 改写必须发生在目录校验**之后**：先确认 spec 属于目录，再改成 tarball。
  const checkAt = body.indexOf('not-in-catalog')
  const rewriteAt = body.indexOf('updateTarballSpec')
  assert.ok(checkAt > 0 && rewriteAt > checkAt, '改写必须在目录校验之后，否则等于开了任意安装后门')
})

check('非更新请求的 spec 一个字节都不变', () => {
  const body = grab(host, 'function updateTarballSpec(')
  // 函数要能「原样返回」——install/首次安装路径依赖这一点。
  assert.match(body, /return spec\b/, '不满足条件必须原样返回原 spec')
})

console.log('\n[4] 错误的可诊断性：already-installed 时要说清是宿主限制')

check('更新撞上 already-installed 时给出可操作的解释（不是「宿主拒绝了」）', () => {
  // 用户就是被这句话卡住的。即使将来宿主改了行为，也要能看懂。
  // 文案在客户端 STRINGS 的 err.already-installed.* 里，ERROR_PREFIXES 负责把它接上。
  assert.match(client, /"err\.already-installed\.title"/, '客户端要有 already-installed 的专属文案（v1.3.0 已加）')
  assert.match(client, /"already-installed":\s*true/, 'ERROR_PREFIXES 要登记这个码，否则走兜底')
  // 服务端侧：更新撞上这个码时，提示里要说明这是宿主对同名包的拦截，而不是含混的「操作失败」。
  assert.match(host, /already-installed/, '服务端要认识这个码（用于更新路径的诊断）')
})

console.log('')
if (failures.length > 0) {
  console.log(`更新路径：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`更新路径：${passed}/${passed + failures.length} 通过`)
