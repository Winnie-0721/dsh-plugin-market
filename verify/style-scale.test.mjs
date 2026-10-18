/**
 * 统一 UI 风格回归（v1.3.0「统一 ui 风格」）。
 *
 * 审计（2026-10，现场实测 + app.asar 反编译取证）发现四类漂移，这里逐类钉住：
 *  A. 主按钮暗色下白字白底（对比度 1.05，不可见）——`.dshpm-btn--primary` 把
 *     `--dsw-alias-brand-primary`（一个**标签色**令牌，暗态 #f9fafb）当底色、文字写死 #fff。
 *     官方组件（dsh-client-ui-settings-models / message-feedback）的约定是
 *     `background:var(--dsw-alias-button-primary-fill)` + `color:var(--dsw-alias-label-primary-foreground)`，
 *     hover 用 `--dsw-alias-button-primary-hover`。修法 = 照抄官方配对。
 *  B. 幻影令牌：`--dsw-alias-danger` 与 `--dsw-font-stack` 官方从未定义（asar 全量扫描 0 声明），
 *     引用它们等于永远走回退值，还会误导后来人以为「有官方值」。
 *  C. 同一令牌的回退值漂移：`--dsw-alias-label-secondary` 29×`#6b6b6b` + 4×`#5b5b5b` 等 6 个令牌
 *     各有多套回退。回退只在主题缺席时生效，多个值意味着「无主题时的样子」不可预测。
 *  D. 刻度散落：font-size 14 种取值 / gap 8 种 / 阴影 10 种全互不相同。
 *     收敛到从官方 token 表抄来的阶梯，不在选择器里各写各的。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(process.argv[2] ?? 'plugin-market/lib/client.js', 'utf8')
const TICK = String.fromCharCode(96)
const stylesAt = source.indexOf(`var STYLES = ${TICK}`)
assert.ok(stylesAt > 0, '应当能找到 STYLES 模板字面量')
const stylesEnd = source.indexOf(TICK + ';', stylesAt)
assert.ok(stylesEnd > stylesAt, 'STYLES 模板字面量应当有结束反引号')
const css = source.slice(stylesAt + (`var STYLES = ${TICK}`).length, stylesEnd)

let passed = 0
const failures = []
function check(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name) } catch (error) {
    failures.push(name); console.log('  ✗ ' + name + '\n    ' + (error && error.message))
  }
}

// ── A. 主按钮 = 官方配对（asar 实锤的组件级约定） ────────────────────────────
console.log('\n[1] 主按钮与焦点环（官方约定）')
check('主按钮底色用 --dsw-alias-button-primary-fill（官方主按钮令牌）', () => {
  const rule = css.match(/\.dshpm-btn--primary\s*\{[^}]*\}/)
  assert.ok(rule, '要有 .dshpm-btn--primary 规则')
  assert.match(rule[0], /background:\s*var\(--dsw-alias-button-primary-fill/)
})
check('主按钮文字用 --dsw-alias-label-primary-foreground（官方配对，不写死 #fff）', () => {
  const rule = css.match(/\.dshpm-btn--primary\s*\{[^}]*\}/)
  assert.ok(rule, '要有 .dshpm-btn--primary 规则')
  assert.match(rule[0], /color:\s*var\(--dsw-alias-label-primary-foreground/)
  assert.doesNotMatch(rule[0], /color:\s*#fff/, '文字色不得写死')
})
check('主按钮 hover 用 --dsw-alias-button-primary-hover（官方 hover 令牌）', () => {
  const rule = css.match(/\.dshpm-btn--primary:hover[^{]*\{[^}]*\}/)
  assert.ok(rule, '要有 hover 规则')
  assert.match(rule[0], /background:\s*var\(--dsw-alias-button-primary-hover/)
  assert.doesNotMatch(rule[0], /filter:\s*brightness/, '官方没有 brightness 滤镜，删掉')
})
check('角标/计数徽章的文字色用 --dsw-alias-label-primary-foreground，不写死 #fff', () => {
  for (const selector of ['.dshpm-count', '.dshpm-entryBadge']) {
    const rule = css.match(new RegExp(selector.replace(/\./g, '\\.') + '\\s*\\{[^}]*\\}'))
    assert.ok(rule, `要有 ${selector} 规则`)
    assert.match(rule[0], /color:\s*var\(--dsw-alias-label-primary-foreground/, `${selector} 的文字色要跟主题`)
    assert.doesNotMatch(rule[0], /color:\s*#fff/, `${selector} 的文字色不得写死`)
  }
})
check('焦点环统一用官方 --dsw-alias-state-business-primary（不再嵌套 brand-primary）', () => {
  // 实测 7 处 :focus-visible（入口/页签/图标键/筛选片/按钮/开关/回顶），全部必须走同一条 outline 写法。
  const sites = [...css.matchAll(/:focus-visible\s*\{[^}]*\}/g)]
  assert.ok(sites.length >= 7, `应有 ≥7 处 :focus-visible，实测 ${sites.length}`)
  for (const m of sites) {
    assert.match(m[0], /outline:[^;]*var\(--dsw-focus-ring-width,\s*2px\)\s+solid\s+var\(--dsw-focus-ring-color,\s*var\(--dsw-alias-state-business-primary/,
      'focus-visible 必须 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))')
  }
  assert.equal(css.includes('var(--dsw-alias-brand-primary,#4176e6)); outline'), false,
    'focus ring 不许再回退到 brand-primary（标签色，两态都看不清）')
})
check('全部 :focus-visible 站点的 outline-offset 归一为 2px', () => {
  for (const m of css.matchAll(/:focus-visible\s*\{[^}]*\}/g)) {
    assert.match(m[0], /outline-offset:\s*2px/, '统一外扩 2px（负值会裁进元素内）')
  }
})

// ── B. 幻影令牌 ──────────────────────────────────────────────────────────────
console.log('\n[2] 幻影令牌（官方从未定义）')
check('不再引用 --dsw-alias-danger（asar 全量扫描 0 声明；崩溃卡改用 state-error-primary）', () => {
  assert.equal(css.includes('--dsw-alias-danger'), false, '幻影令牌必须清零')
  const crash = css.match(/\.dshpm-crash\s*\{[\s\S]*?\}/)
  assert.ok(crash, '要有 .dshpm-crash 规则')
  assert.match(crash[0], /border-left-color:\s*var\(--dsw-alias-state-error-primary/)
})
check('不再引用 --dsw-font-stack（官方未定义；字体统一走 font:inherit 继承宿主）', () => {
  assert.equal(css.includes('--dsw-font-stack'), false, '幻影令牌必须清零')
})

// ── C. 回退值统一：每个令牌在样式表里只允许一套回退字面量 ─────────────────────
console.log('\n[3] 令牌回退值统一（同一令牌 = 同一回退）')
check('六类漂移令牌在样式表内回退值唯一', () => {
  // 实测官方亮态值（theme-resolve）作为唯一回退；暗态由主题接管，回退只服务「主题缺席」。
  const expected = {
    '--dsw-alias-label-secondary': '#61666b',
    '--dsw-alias-bg-layer-1': '#fff',
    '--dsw-alias-bg-layer-2': '#fff',
    '--dsw-alias-border-l1': '#0000000a',
    '--dsw-alias-border-l2': '#0000001a',
    '--dsw-alias-state-idle-primary': '#d4d4d4',
  }
  for (const [token, value] of Object.entries(expected)) {
    const fallbacks = new Set()
    for (const m of css.matchAll(new RegExp(token.replace(/-/g, '\\-') + ',\\s*([^)]+?)\\)', 'g'))) {
      fallbacks.add(m[1].trim())
    }
    assert.deepEqual(
      [...fallbacks], [value],
      `${token} 的回退值必须唯一且等于官方亮态值 ${value}，实测 ${[...fallbacks].join(' | ')}`,
    )
  }
})
check('其余常用令牌的回退值也各自唯一（不许一令牌多回退）', () => {
  const tokens = ['--dsw-alias-label-primary', '--dsw-alias-label-tertiary', '--dsw-alias-bg-base',
    '--dsw-alias-bg-overlay', '--dsw-alias-brand-primary', '--dsw-alias-interactive-bg-hover',
    '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-error-primary']
  for (const token of tokens) {
    const fallbacks = new Set()
    for (const m of css.matchAll(new RegExp(token.replace(/-/g, '\\-') + ',\\s*([^)]+?)\\)', 'g'))) {
      fallbacks.add(m[1].trim())
    }
    assert.ok(fallbacks.size <= 1, `${token} 有 ${fallbacks.size} 套回退：${[...fallbacks].join(' | ')}`)
  }
})
check('不再使用市场自造的品牌蓝 #4d6bfe / rgba(77,107,254,…)（品牌色一律走令牌）', () => {
  assert.equal(/#4d6bfe/i.test(css), false, '主品牌蓝字面量必须清零')
  assert.equal(/rgba\(77,\s*107,\s*254/.test(css), false, '品牌蓝阴影字面量必须清零')
})

// ── D. 刻度阶梯 ─────────────────────────────────────────────────────────────
console.log('\n[4] 刻度阶梯（字号 / 阴影）')
check('字号阶梯收敛到官方正文字号的 em 阶（≤7 种）', () => {
  const sizes = new Set([...css.matchAll(/font-size:\s*([0-9.]+em)/g)].map((m) => m[1]))
  // 7 级：标题 1.1（官方 l-20）/1.02（m-18）+ 正文基准 1 + 四档缩进 .929/.857/.786/.714（对齐官方 13/12/11px 阶）。
  const allowed = new Set(['1.1em', '1.02em', '1em', '.93em', '.86em', '.79em', '.71em'])
  const offenders = [...sizes].filter((s) => !allowed.has(s))
  assert.deepEqual(offenders, [], `阶梯外字号：${offenders.join(', ')}（全部实测取值：${[...sizes].join(', ')}）`)
  assert.ok(sizes.size <= 7, `字号取值应 ≤7 种，实测 ${sizes.size}：${[...sizes].join(', ')}`)
})
check('纯色阴影统一走官方令牌（--dsw-elevation-* / --dsw-shadow-lv*）', () => {
  const shadows = [...css.matchAll(/box-shadow:\s*([^;{}]+)[;}]/g)]
    .map((m) => m[1].trim())
    .filter((v) => v !== 'none')
  assert.ok(shadows.length >= 8, `阴影站点应 ≥8 处，实测 ${shadows.length}`)
  for (const v of shadows) {
    assert.match(v, /^var\(--dsw-(elevation|shadow)-/, `阴影必须从官方海拔/阴影令牌起头，实测：${v}`)
    assert.doesNotMatch(v, /rgba\(77,\s*107,\s*254/, `不许再有市场自造的品牌蓝阴影：${v}`)
  }
})
check('过渡时长只用 {0.12s, 0.16s, 0.18s, 0.2s} 四档 + 官方 bezier', () => {
  // 0.2s 不能并入 0.18：NOTICE_CLOSE_MS=200 是钉死的退场常量（client-copy 钉着），动画跟着它走。
  // 断言只看**过渡**（transition），动画时长（animation）是内容节奏，不在这条刻度的管辖范围内。
  for (const m of css.matchAll(/(?:^|[{;])\s*transition\s*:\s*([^;}]+)[;}]/g)) {
    for (const d of m[1].matchAll(/(?:^|[^\d.])(\.?\d*\.?\d+)s/g)) {
      const value = d[1].startsWith('.') ? `0${d[1]}` : d[1]
      assert.ok(['0.12', '0.16', '0.18', '0.2'].includes(value), `过渡时长 ${value}s 不在阶梯 {0.12,0.16,0.18,0.2}：${m[1]}`)
    }
  }
})
check('气泡退场过渡与 NOTICE_CLOSE_MS 一致（200ms 是常量，不是随手写的刻度）', () => {
  const closeMs = Number((source.match(/var NOTICE_CLOSE_MS = (\d+);/) ?? [])[1])
  assert.ok(Number.isFinite(closeMs), 'client.js 里必须有 NOTICE_CLOSE_MS 常量')
  const notice = css.match(/\.dshpm-notice\s*\{[^}]*\}/)
  assert.ok(notice, '回执气泡要有 transition')
  const transition = notice[0].match(/transition:([^;}]*)/)
  assert.ok(transition, '回执气泡的基础规则里必须有 transition（退场靠它）')
  const seconds = [...transition[1].matchAll(/([\d.]+)s/g)].map((m) => Number(m[1]) * 1000)
  assert.ok(seconds.length > 0, '气泡 transition 要带时长')
  for (const ms of seconds) {
    assert.equal(ms, closeMs, `气泡退场时长必须等于 NOTICE_CLOSE_MS(${closeMs}ms)，实测 ${ms}ms`)
  }
})

// ── 布局不变量（防回归） ─────────────────────────────────────────────────────
console.log('\n[5] 布局不变量（动了刻度也不能破的老规矩）')
check('页面节距仍是 12px：root 与 page 外壳的 gap 不许动（e2e [9] 盯着）', () => {
  const root = css.match(/\.dshpm-root\s*\{[^}]*\}/)
  assert.match(root[0], /gap:\s*12px/, '.dshpm-root 的 gap 必须是 12px')
  const page = css.match(/\.dshpm-page\s*\{[^}]*\}/)
  assert.match(page[0], /gap:\s*12px/, '.dshpm-page 的 gap 必须是 12px')
})
check('卡片/行仍是 16px 大圆角（--dsw-radius-lg）', () => {
  for (const selector of ['.dshpm-card', '.dshpm-row']) {
    const rule = css.match(new RegExp(selector.replace(/\./g, '\\.') + '\\s*\\{[^}]*\\}'))
    assert.match(rule[0], /border-radius:\s*var\(--dsw-radius-lg,\s*16px\)/, `${selector} 必须还是 radius-lg`)
  }
})
check('列表底栏 padding-right:40px 保留（让开右下角回顶按钮，实测数据）', () => {
  const rule = css.match(/\.dshpm-listFooter\s*\{[^}]*\}/)
  assert.match(rule[0], /padding-right:\s*40px/)
})

console.log('')
if (failures.length > 0) {
  console.log(`统一 UI 风格回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`统一 UI 风格回归：${passed}/${passed + failures.length} 通过`)
