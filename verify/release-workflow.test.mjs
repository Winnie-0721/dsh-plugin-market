/**
 * 发布工作流的凭据结构回归（v1.3.0 修订：推翻了 v1.2.0 那个结论）。
 *
 * ## 同一个缺陷已经让发布红了三次（v1.1.6 / v1.2.0 / v1.3.0）
 * 症状永远是：pack 那半成功、GitHub Release 附件也就绪，只有 npm 那步报
 * `npm error code ENEEDAUTH / need auth`，看起来像「npm 抽风」。
 *
 * ## v1.2.0 记下的结论是**错的**（当时的证据只覆盖了 OIDC 令牌这一侧）
 * 当时观察到 `workflow_call` 下 `job_workflow_ref` 指向被调用的文件，于是认定
 * 「用 `uses:` 复用 publish-npm.yml 就能让 npm 认这个文件名」。实测确实如此——
 * **但那只是令牌里的字段**，npm 服务端并不按它校验。
 *
 * ## 真因（npm 官方文档明确写着，v1.3.0 查清）
 * https://docs.npmjs.com/trusted-publishers/
 *   "Some GitHub Actions workflows use workflow_call to invoke other workflows that run
 *    npm publish ... When this happens, validation checks **the calling workflow's name**
 *    instead of the workflow that actually contains the publish command, which can cause
 *    configuration mismatches."
 *
 * 于是 v1.3.0 出现了最能说明问题的一幕：本文件里那段身份自检**通过**了
 * （打印 `job_workflow_ref = .../publish-npm.yml@refs/tags/v1.3.0`、判定「身份正确」），
 * 紧接着 `npm stage publish` 仍然 ENEEDAUTH ——因为 npm 看的是调用方 pack-release.yml。
 *
 * 历史对照（同一份代码，两种触发方式）：
 *   · v1.2.0 成功 = 手动 `workflow_dispatch` **直接跑 publish-npm.yml**（ref=refs/heads/main）
 *   · v1.3.0 失败 = 标签触发 pack-release.yml → `workflow_call` publish-npm.yml
 * 差别只在「谁是调用方」。
 *
 * ## 现在的结构（本套件钉住的就是这个）
 * 1. 发布实现**只有一份**，在 publish-npm.yml 里（这条底线没变，也仍然重要）；
 * 2. publish-npm.yml **自己监听 `push: tags: ['v*']`**，与 pack-release.yml 并列触发；
 * 3. **任何 workflow 都不得 `workflow_call` 它**，pack-release.yml 里也不得有发布命令。
 *
 * 用法：node verify/release-workflow.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const wfDir = join(root, '.github', 'workflows')
const read = (name) => readFileSync(join(wfDir, name), 'utf8')

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
 * 取出某个 step 的文本（从 `- name: <名字>` 起，到下一个同级 step 或文件末）。
 * 为什么需要它而不是全文正则：同一条 `if:` 条件在多个 step 上都会出现，
 * 全文匹配会把「条件在别处也成立」当成「目标步骤有该条件」——变异测试漏检的经典原因。
 */
function stepBlock(text, stepName) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^\\s*- name:\\s*${stepName}\\s*$`).test(l))
  assert.ok(start !== -1, `找不到 step: ${stepName}`)
  const indent = lines[start].match(/^\s*/)[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (new RegExp(`^\\s{${indent}}-\\s`).test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

/** 取出某个 workflow 里某个顶层 job 的文本（到下一个同级 job 或文件末）。 */
function jobBlock(text, jobName) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^  ${jobName}:\\s*$`).test(l))
  assert.ok(start !== -1, `找不到 job: ${jobName}`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

console.log('\n[1] npm 发布必须由 publish-npm.yml **自己被标签触发**')

const publish = read('publish-npm.yml')
const pack = read('pack-release.yml')

check('publish-npm.yml 自己监听 push: tags（这是 v1.3.0 修法的核心）', () => {
  // 为什么不能靠 pack-release 用 workflow_call 调它：npm 校验的是**调用方**
  // （官方文档原文见文件头注释）。只有它自己被标签触发，调用方才是它自己。
  const live = publish.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.match(live, /^on:\s*$/m, '要有 on: 段')
  assert.match(live, /^ {2}push:\s*$/m, 'on: 下要有 push（自己接标签事件）')
  assert.match(live, /tags:\s*\['v\*'\]/, "push 要过滤 v* 标签，与 pack-release.yml 一致")
})

check('没有任何 workflow 用 workflow_call / uses: 调用 publish-npm.yml', () => {
  // 这条是 v1.2.0「必须复用」那个结论的**反向**：现在恰恰禁止复用。
  // 复用会让 npm 把调用方当发布者，与登记不符 → ENEEDAUTH（三次事故同根）。
  //
  // 只看**生效行**，不看注释：pack-release.yml 的注释里刻意写着「本文件也不去调用
  // publish-npm.yml」来解释原因，全文正则会把这句解释判成违规——门禁误报会被当成噪声、
  // 然后被放宽，那比没有更糟（registry-url 那条也有同样的教训）。
  const stripComments = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const offenders = []
  for (const f of readdirSync(wfDir)) {
    if (!/\.ya?ml$/.test(f)) continue
    if (f === 'publish-npm.yml') continue
    const live = stripComments(read(f))
    if (/uses:\s*\.\/\.github\/workflows\/publish-npm\.yml/.test(live)) offenders.push(f + '（uses: 调用）')
    if (/workflow_call/.test(live)) offenders.push(f + '（声明了 workflow_call）')
  }
  assert.deepEqual(offenders, [],
    `不得再有 workflow 调用 publish-npm.yml（npm 只看调用方文件名 → ENEEDAUTH）：${offenders.join('、')}`)
})

check('publish-npm.yml 不再声明 workflow_call（避免又被当成可复用）', () => {
  const live = publish.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.equal(/^ {2}workflow_call:\s*$/m.test(live), false,
    '去掉 workflow_call：留着它会诱导别人再写成 `uses:` 复用，而那正是三次事故的根')
})

check('publish-npm.yml 保留了 workflow_dispatch（人工补发通道）', () => {
  // v1.2.0 就是靠手动跑这条通道发成功的，必须保留。
  assert.match(publish, /^ {2}workflow_dispatch:\s*$/m, '人工补发通道不能被删')
})

check('pack-release.yml 里没有发布命令，也没有 publish-npm job', () => {
  // 打包与发布拆成两个并列 workflow：本文件只管 Release，npm 由 publish-npm.yml 自己做。
  assert.equal(/npm\s+stage\s+publish/.test(pack), false,
    'pack-release.yml 里不得出现 npm stage publish（发布实现只能有一份，在 publish-npm.yml）')
  assert.equal(/^ {2}publish-npm:\s*$/m.test(pack), false,
    'pack-release.yml 里不应再有 publish-npm job（它注定 ENEEDAUTH）')
})

console.log('\n[2] 幂等闸门：版本已在 npm 时必须跳过（别把补跑弄红）')

check('publish-npm.yml 有「已在 npm 则跳过」的闸门', () => {
  // 这个闸门原来在 pack-release.yml 那个重复 job 里；搬过来时不能丢。
  assert.match(publish, /npm view\s+"\$SPEC"\s+version/, '要有 npm view 查询该版本是否已存在')
  assert.match(publish, /skip=true/, '要设置 skip 输出')
  // **必须钉在「Stage publish」那一步上**，不能全文找 `if: steps.guard...`：
  // 后面「提示下一步」那步用的是同一个条件，全文正则会命中它 → 把发布步骤的 if 删掉也算通过。
  // （变异测试 M4 就漏在这里，跟本轮 e2e 的 `/status` 断言是同一类错误：条件在别处也成立。）
  const stage = stepBlock(publish, 'Stage publish to npm')
  assert.match(
    stage,
    /if:\s*steps\.guard\.outputs\.skip\s*==\s*'false'/,
    'Stage publish 步骤自身必须以 skip 为条件（否则补跑时版本已存在会失败）'
  )
})

check('跳过判定用 name@version，而不是 dist-tags.latest', () => {
  // 暂存发布在人工批准前**不会**更新 latest，用 latest 判定会把「已暂存」误判成
  // 「没发过」，于是重复 stage → 失败。
  assert.match(publish, /node -p "const p=require\('\.\/package\.json'\); p\.name \+ '@' \+ p\.version"/,
    '要拼出 name@version 来查')
  const guard = publish.slice(publish.indexOf('该版本已在 npm 则跳过'))
  assert.equal(/dist-tags/.test(guard), false, '闸门不得依赖 dist-tags.latest（暂存批准前不更新 latest）')
})

console.log('\n[3] 两个历史坑的防回归（都在注释里钉着，别删）')

check('没写 npm@latest（npm 12 与 node 22.14 不兼容 → EBADENGINE）', () => {
  const installs = [...publish.matchAll(/npm install -g\s+"?([^"\s]+)"?/g)].map((m) => m[1])
  assert.ok(installs.length > 0, '要能找到一个 npm install -g')
  for (const spec of installs) {
    assert.notEqual(spec, 'npm@latest', `npm@latest 会在 node 22.14 上 EBADENGINE：${spec}`)
  }
  assert.ok(installs.some((s) => /npm@\^11\./.test(s)), `应钉到 11.x，实际 ${JSON.stringify(installs)}`)
})

check('没给 setup-node 写 registry-url（会注入无效 token 盖过 OIDC）', () => {
  // **只看非注释行**：`registry-url` 这个词在注释里出现过（正是解释「为什么故意不写它」），
  // 直接全文正则会把那句注释判成违规——我第一版就是这么假红的。
  // 门禁必须精确：误报的门禁会被当成噪声、然后被放宽，那样还不如没有。
  // 判据：去掉 # 开头的注释行后，不得出现 `registry-url:` 这个**键**。
  const live = publish
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
  assert.equal(
    /registry-url\s*:/.test(live),
    false,
    'registry-url 会让 setup-node 注入 NODE_AUTH_TOKEN=github.token（对 npm 无效），可能盖过 OIDC'
  )
})

check('走的是 npm stage publish（本包 Trusted Publisher 只授予暂存发布）', () => {
  assert.match(publish, /npm stage publish --access public/, '必须用暂存发布')
})

console.log('\n[3b] OIDC 身份自检：把「文件名不对」变成看得懂的错')

check('发布前先自检 OIDC 身份：**两个** ref 都必须是本文件', () => {
  // 为什么要有这一步：文件名不匹配时 npm 只回一句 need auth，得翻日志才能定位。
  // 为什么必须查两个字段：npm 在 workflow_call 下校验的是**调用方**（workflow_ref），
  // 而只查 job_workflow_ref 会给出**假绿灯** —— v1.3.0 就是自检打印「身份正确」、
  // 紧接着发布 ENEEDAUTH。这条断言防的正是那种「自检过了但发布失败」的错位。
  const step = stepBlock(publish, '自检 OIDC 身份（文件必须是 publish-npm.yml）')
  assert.match(step, /ACTIONS_ID_TOKEN_REQUEST_URL/, '要真的去请求 OIDC 令牌')
  assert.match(step, /job_workflow_ref/, '要查 job_workflow_ref（执行发布命令的文件）')
  assert.match(step, /workflow_ref/, '必须**也**查 workflow_ref——npm 在 workflow_call 下校验的是它')
  assert.match(step, /publish-npm\.yml@/, '必须断言里面是 publish-npm.yml')
  assert.match(step, /sys\.exit/, '文件名不对要**失败**，不能只打印')
  // 反向：不能只对 job_workflow_ref 做判断（那正是假绿灯的写法）。
  assert.equal(/if expected not in job_ref:/.test(step), false,
    '不能只判断 job_workflow_ref —— npm 看的是调用方，只查前者会假绿灯（v1.3.0 实测）')
})

check('自检排在发布之前（否则拦不住 ENEEDAUTH）', () => {
  const selfCheck = publish.indexOf('自检 OIDC 身份')
  const guard = publish.indexOf('该版本已在 npm 则跳过')
  const stage = publish.indexOf('Stage publish to npm')
  assert.ok(selfCheck !== -1 && guard !== -1 && stage !== -1, '三个步骤都要存在')
  assert.ok(selfCheck < stage, '自检必须在 Stage publish 之前')
  assert.ok(selfCheck < guard, '自检应在幂等闸门之前——这样即使会跳过，也能早早证明身份正确')
})

console.log('\n[4] 不许再有第二份发布实现')

check('没有任何其它 workflow 出现 npm stage publish', () => {
  // 这是本节的核心：发布实现只能有一份，且必须在 publish-npm.yml 里。
  const offenders = []
  for (const f of readdirSync(wfDir)) {
    if (!/\.ya?ml$/.test(f)) continue
    if (f === 'publish-npm.yml') continue
    if (/npm\s+stage\s+publish/.test(read(f))) offenders.push(f)
  }
  assert.deepEqual(offenders, [], `以下文件里也出现了 npm stage publish（会重演 ENEEDAUTH）：${offenders.join('、')}`)
})

check('临时 OIDC 探针没有留在仓库里', () => {
  // 我为了测定 job_workflow_ref 用过 oidc-probe*.yml；学完就该删，不能留在 CI 里长期跑。
  const probes = readdirSync(wfDir).filter((f) => /probe/i.test(f))
  assert.deepEqual(probes, [], `残留探针 workflow：${probes.join('、')}`)
})

console.log('')
if (failures.length > 0) {
  console.log(`发布工作流回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  for (const f of failures) console.log(`  - ${f.name}`)
  process.exitCode = 1
} else {
  console.log(`发布工作流回归：${passed}/${passed} 全通过`)
}
