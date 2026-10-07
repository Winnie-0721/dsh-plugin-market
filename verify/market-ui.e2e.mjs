/**
 * 真实浏览器验收（headless Edge + CDP）。
 *
 * 假 DOM 桩能证明代码不抛异常，证明不了这几件事——所以这里全部在真引擎里测：
 *  1. 侧边栏入口能点开市场面板，页面真的渲染出样式（不是"有功能无样式"）；
 *  2. 头部只剩「刷新目录」；第三个页签「可更新」带计数角标，页头右侧是合并状态机
 *     「检查更新 → 一键更新（N）/ 重新检查」与改名后的「插件市场更新」（两颗样式统一）；
 *  3. 切到「可更新」页能看到两条待更新记录、逐条「更新到 x.y.z」，先点「检查更新」再点
 *     「一键更新」给出汇总回执；第一条返回 restart-required 必须计为**成功**（用户报的「成功 0、失败 2」）；
 *  4. 动效真的生效（计算样式里有 animation-name / transition）；
 *  5. prefers-reduced-motion: reduce 下动效被关掉，而内容仍然可见（不能变成空白）。
 *
 * 已安装列表由 CDP 拦截 /plugin-market/installed 注入，构造确定性的"有两个插件可更新"，
 * 因此角标与列表不依赖当时目录里恰好有什么。
 *
 * 用法：node verify/market-ui.e2e.mjs <带 token 的首页 URL> [截图目录]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { evaluate, launchBrowser, screenshot, waitFor } from './lib/cdp.mjs'

const authUrl = process.argv[2]
const shotDir = process.argv[3] ?? join('verify', 'logs', 'ui')
if (!authUrl) {
  console.error('用法：node verify/market-ui.e2e.mjs <带 token 的首页 URL> [截图目录]')
  process.exit(2)
}
mkdirSync(shotDir, { recursive: true })

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || detail === '' ? '' : `\n      ${detail}`}`)
}
function expect(name, condition, detail = '') {
  record(name, condition === true, detail)
  return condition === true
}

// 注入的已安装列表：两个 bundle 有更新，一个没有；其中一条是市场自身（验证它不会被当成普通插件）。
const INJECTED_INSTALLED = {
  ok: true,
  bundles: [
    {
      name: '@fixture/needs-update',
      version: '1.0.0',
      latest: '1.2.0',
      updateAvailable: true,
      description: '外部插件，用于验证「有个新版本」的提示与逐个确认。',
      rows: [{ rowId: 'row-a' }],
      enabled: true,
    },
    {
      name: '@fixture/second-update',
      version: '0.3.1',
      latest: '0.4.0',
      updateAvailable: true,
      description: '第二个可更新插件，用来验证角标数字。',
      rows: [{ rowId: 'row-b' }],
      enabled: true,
    },
    {
      name: 'deepseek-harness-market',
      version: '1.0.2',
      updateAvailable: false,
      description: '市场自身。',
      rows: [{ rowId: 'row-c' }],
      enabled: true,
      market: true,
    },
  ],
  plugins: [],
}

const browser = await launchBrowser({ width: 1560, height: 980 })
const { client } = browser
let consoleErrors = []
try {
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Log.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 980, deviceScaleFactor: 1, mobile: false })
  // headless Chromium 默认就带 prefers-reduced-motion: reduce（实测），所以要显式钉成 no-preference：
  // 否则"动效生效"这一组断言测的是一条永远关着动画的路径，而 [6] 又会因为同样原因平凡通过。
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

  // 拦截 /installed 与 /install：前者给确定性数据；后者第一条（needs-update）返回
  // restart-required（装好了待重启——界面必须计为成功）并拖 700ms，第二条（second-update）
  // 注入 EPERM 占用失败——批量的「顺序执行 + 汇总 + 占用回执」与 restart-required 计数都由它验。
  // fixture 插件在真实宿主里必然 400 not-in-catalog——那会造出两条控制台错误，
  // 而这条路径要测的是**批量流程本身**，不是宿主的目录校验。
  await client.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*plugin-market/installed*', requestStage: 'Request' },
      { urlPattern: '*plugin-market/install', requestStage: 'Request' },
      { urlPattern: '*plugin-market/self-update*', requestStage: 'Request' },
    ],
  })
  client.on('Fetch.requestPaused', (params) => {
    const isInstall = /\/plugin-market\/install$/.test(params.request.url)
    const isSelfCheck = /\/plugin-market\/self-update/.test(params.request.url)
    const posted = String(params.request.postData || '')
    let payload = INJECTED_INSTALLED
    let delay = 0
    if (isSelfCheck) {
      // 右键点击要走确定性路径：CDN 慢、宿主 10 分钟缓存都会让断言变成赌运气。
      // 这里恒定回「没有更新」→ 按钮必须走「正在更新… → 再次检查」。
      payload = {
        ok: true,
        selfUpdate: { current: '1.1.4', latest: '1.1.4', updateAvailable: false, attempts: [] },
      }
      delay = 400 // 拖出「正在更新…」窗口，让按钮文字变化被量到
    } else if (isInstall) {
      if (posted.includes('second-update')) {
        payload = {
          ok: false,
          error: {
            code: 'operation-error',
            message: '宿主执行这个操作时报错。',
            hint: '看宿主日志里的 pnpm 输出，修好原因后重试。',
            diagnostic: "EPERM: operation not permitted, scandir 'C:\\Users\\test\\.dsh\\profiles\\desktop\\node_modules\\locked-plugin\\node_modules'",
          },
        }
      } else {
        payload = { ok: true, application: 'restart-required', changed: true }
        delay = 700 // 拖出一个「写操作进行中」窗口：断言顶部没有黑条进度条
      }
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    const respond = () =>
      client
        .send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body,
        })
        .catch(() => {})
    if (delay > 0) setTimeout(respond, delay)
    else respond()
  })
  client.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push((params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '))
    }
  })
  client.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') consoleErrors.push(params.entry.text ?? '')
  })

  console.log('\n[1] 打开页面与侧边栏入口')
  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '侧边栏里的插件市场入口')
  // 全新的 scratch profile 首次进入时 DSH 会弹自己的「预览版说明」：点掉它，截图里只看市场本身。
  await evaluate(
    client,
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(继续|Continue)$/.test(x.textContent.trim())); if (b) { b.click(); return true; } return false; })()`,
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  // scratch profile 没配 API Key，DSH 随后会弹「添加一个 API Key 开始使用」；截图前点「稍后配置」关掉它。
  const dismissApiDialog = `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /稍后配置|Configure later/i.test(x.textContent.trim())); if (b) { b.click(); return true; } return false; })()`
  await evaluate(client, dismissApiDialog)
  const entryText = await evaluate(client, `document.querySelector('.dshpm-entry').textContent.trim()`)
  expect('侧边栏入口渲染出「插件市场」文案', /插件市场|Plugin Market/.test(String(entryText)), `实际：${entryText}`)
  const entryStyled = await evaluate(
    client,
    `(() => { const el = document.querySelector('.dshpm-entry'); const s = getComputedStyle(el); return { display: s.display, minHeight: s.minHeight, anim: s.transitionProperty.includes('transform') }; })()`,
  )
  expect(
    '入口用的是插件自己的样式（display:flex + 36px 行高），不是浏览器默认按钮',
    entryStyled?.display === 'flex' && entryStyled?.minHeight === '36px',
    JSON.stringify(entryStyled),
  )

  console.log('\n[2] 点开市场面板')
  await evaluate(client, `document.querySelector('.dshpm-entry').click(); true`)
  await waitFor(client, `!!document.querySelector('.dshpm-root')`, 20000, '市场面板 .dshpm-root')
  expect('面板根节点渲染出来了', true)

  const headerButtons = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-headerActions button')).map(b => b.textContent.trim())`,
  )
  expect(
    '头部只剩一个按钮「刷新目录」（另两个按用户要求删掉：更新插件→页签、检查市场更新→可更新页）',
    Array.isArray(headerButtons) && headerButtons.length === 1 && /刷新|Refresh/.test(headerButtons[0] || ''),
    `实际：${JSON.stringify(headerButtons)}`,
  )
  // 角标来自模块级计数（ensureUpdateCount 异步注入 /installed），不是同步渲染的——
  // 前面多了几次 evaluate，这里必须等它到位，不能裸读一次就断言。
  await waitFor(client, `(() => { const b = document.querySelector('.dshpm-count'); return !!b && b.textContent.trim() === '2'; })()`, 10000, '可更新页签角标显示注入的 2')
  const badge = await evaluate(client, `(() => { const b = document.querySelector('.dshpm-count'); return b ? b.textContent.trim() : null; })()`)
  expect('「可更新」页签上有可更新数量角标，且数字来自注入的列表', badge === '2', `实际：${badge}`)

  // 用户要求：把「可更新的插件」做成页签——已安装右边再开一个（他圈的就是那个位置）。
  const tabs = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-tab')).map(b => ({ text: b.textContent.trim(), active: b.getAttribute('data-active') === 'true' }))`,
  )
  expect(
    '页签栏三个页签：发现 / 已安装 / 可更新（用户圈的位置就在已安装右边）',
    Array.isArray(tabs) && tabs.length === 3 && /发现|Discover/.test(tabs[0]?.text || '') && /已安装|Installed/.test(tabs[1]?.text || ''),
    JSON.stringify(tabs),
  )
  expect(
    '第三个页签就是「可更新」（带计数角标），默认停在发现页',
    /可更新|Updates/.test(tabs[2]?.text || '') && tabs[0]?.active === true && tabs[2]?.active === false,
    JSON.stringify(tabs),
  )

  // 用户报的「显示不全」：通知条被压成一条、文字只剩半行。
  // 根因是 flex 项的自动最小尺寸规则（非 visible 的 overflow ⇒ 自动最小尺寸 0），
  // 所以这条断言直接量 clientHeight 与 scrollHeight，而不是只看它「在不在」。
  console.log('\n[2b] 提示条不能被压扁（用户报的「显示不全」）')
  await waitFor(client, `document.querySelector('.dshpm-notice') !== null`, 8000, '提示条出现')
  const noticeMetrics = await evaluate(
    client,
    `(() => {
       const n = document.querySelector('.dshpm-notice');
       const cs = getComputedStyle(n);
       return { offset: n.offsetHeight, client: n.clientHeight, scroll: n.scrollHeight, flexShrink: cs.flexShrink, overflow: cs.overflow, text: n.innerText.replace(/\\s+/g, ' ').trim() };
     })()`,
  )
  expect('提示条没有被压扁（clientHeight ≥ scrollHeight）', Number(noticeMetrics?.client) >= Number(noticeMetrics?.scroll), JSON.stringify(noticeMetrics))
  expect('提示条高度足够容纳整行文字（≥ 30px）', Number(noticeMetrics?.offset) >= 30, JSON.stringify(noticeMetrics))
  expect('提示条文案完整可读（不是被裁掉半行）', /2 个插件有新版本/.test(String(noticeMetrics?.text)), String(noticeMetrics?.text))

  // 回执改成了 Android toast 那种悬浮气泡。computed position 一定是 'fixed'，那不算证据；
  // 真正的判据是几何位置——若某个祖先带 transform/filter 把 fixed 的包含块抢走，
  // 气泡会贴到那个祖先的底边而不是视口底边，下面两条就会红。
  const toastBox = await evaluate(
    client,
    `(() => {
       const n = document.querySelector('.dshpm-notice');
       const cs = getComputedStyle(n);
       const r = n.getBoundingClientRect();
       return { position: cs.position, left: Math.round(r.left), width: Math.round(r.width), bottom: Math.round(r.bottom), vh: window.innerHeight, vw: window.innerWidth };
     })()`,
  )
  expect(
    '回执是悬浮气泡：position 固定为 fixed（不占文档流，出现时不推动布局）',
    toastBox?.position === 'fixed',
    JSON.stringify(toastBox),
  )
  expect(
    '气泡贴在视口底部（不再是页内那一行）',
    Number(toastBox?.bottom) <= Number(toastBox?.vh) && Number(toastBox?.vh) - Number(toastBox?.bottom) < 120,
    JSON.stringify(toastBox),
  )
  expect(
    '气泡水平居中',
    Math.abs((Number(toastBox?.left) + Number(toastBox?.width) / 2) - Number(toastBox?.vw) / 2) <= 2,
    JSON.stringify(toastBox),
  )

  // 用户报「这三个切换页面高度不对齐」：三个页签各自的内容起点/高度不一样，切一下就跳。
  // 修法是统一外壳（.dshpm-page）+ 固定页签按钮高度；这里量真实的几何，而不是看代码里有没有写类名。
  console.log('\n[2c] 三个页签共用一套布局（用户报的「高度不对齐」）')
  // 先让发现页进入正常数据态：骨架屏/加载态不是要比的东西，三页都要拿「有内容」的那一版量。
  // （[3] 本来也要等卡片，这里不额外拖时间。）
  await waitFor(client, `document.querySelector('.dshpm-card') !== null`, 30000, '发现页卡片（对齐测量前）')
  await new Promise((resolve) => setTimeout(resolve, 450))
  const tabHeights = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-tab')).map(b => Math.round(b.getBoundingClientRect().height * 100) / 100)`,
  )
  expect(
    '三个页签按钮等高（角标不影响页签栏高度，后续加页面同理）',
    Array.isArray(tabHeights) && tabHeights.length === 3 && Math.max(...tabHeights) - Math.min(...tabHeights) <= 0.5,
    JSON.stringify(tabHeights),
  )
  const tabIds = await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).map(b => b.getAttribute('data-tab'))`)
  expect(
    '页签由注册表生成并带 data-tab（新增页面只改 MARKET_TABS）',
    JSON.stringify(tabIds) === JSON.stringify(['discover', 'installed', 'updates']),
    JSON.stringify(tabIds),
  )
  // 每一页量同一组量：页签底边 → 页面顶边（节距）、页面顶边 → 该页**第一行内容**的顶边。
  // 三个页面的这两个值必须完全一致，否则切页签就会看到内容上下跳（用户截图里的问题）。
  const measurePane = `(() => {
    const page = document.querySelector('.dshpm-page');
    const tabs = document.querySelector('.dshpm-tabs');
    if (!page || !tabs) return null;
    const pr = page.getBoundingClientRect();
    const tr = tabs.getBoundingClientRect();
    const content = page.querySelector('.dshpm-toolbar, .dshpm-summary, .dshpm-drawerHead');
    const cr = content ? content.getBoundingClientRect() : null;
    return {
      id: page.getAttribute('data-page'),
      gap: Math.round(pr.top - tr.bottom),
      pageTop: Math.round(pr.top),
      firstTop: cr ? Math.round(cr.top) : null,
      firstClass: content ? content.className : null,
      height: Math.round(pr.height),
      pageGap: getComputedStyle(page).gap,
    };
  })()`
  const panes = [await evaluate(client, measurePane)]
  for (const [label, id] of [['已安装', 'installed'], ['可更新', 'updates']]) {
    await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /${label}/.test(b.textContent)).click(); true`)
    await waitFor(client, `document.querySelector('.dshpm-page[data-page="${id}"]') !== null`, 8000, `切到「${label}」页`)
    // 页面切换带入场动画（dshpm-rise 从 translateY(7px) 起）。量几何前等它落位，
    // 否则量到的是动画中间帧的 7px 偏移，会把「对齐」误判成不齐。
    await new Promise((resolve) => setTimeout(resolve, 450))
    panes.push(await evaluate(client, measurePane))
  }
  // 页签底边到页面顶边：三页都是同一个节距（外壳与面板根共用 12px）。
  expect(
    '页签底边到页面顶边的节距三页相同（都是 12px）',
    panes.every((p) => p && p.gap === 12 && p.pageGap === '12px'),
    JSON.stringify(panes),
  )
  // 三页的**第一行内容**顶边完全一致——这是「对齐」的直接证据。
  const firstTops = panes.map((p) => p?.firstTop)
  expect(
    '三个页面的第一行内容顶边完全一致（切页签内容不上下跳）',
    firstTops.every((top) => typeof top === 'number') && Math.max(...firstTops) - Math.min(...firstTops) <= 1,
    JSON.stringify({ firstTops, classes: panes.map((p) => p?.firstClass) }),
  )
  // 内容比视口短时页面要撑满剩余高度：已安装（3 行）与可更新（2 行）两页等高。
  expect(
    '内容不足一屏时页面撑满剩余高度（已安装与可更新两页等高）',
    typeof panes[1]?.height === 'number' && Math.abs(panes[1].height - panes[2].height) <= 1,
    JSON.stringify(panes.map((p) => p?.height)),
  )
  // 拍一张「切页签后仍在同一位置」的对照图（矮视口下最明显），并切回发现页交给 [3] 继续用。
  const layoutShot = await evaluate(client, `document.querySelector('.dshpm-page').getBoundingClientRect().top`)
  expect('切到第三个页签后页面顶边仍在视区内（无需滚动）', Number(layoutShot) > 0 && Number(layoutShot) < 980, `top=${layoutShot}`)
  await screenshot(client, join(shotDir, 'market-tab-alignment.png'))
  console.log(`  · 截图：${join(shotDir, 'market-tab-alignment.png')}`)
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /发现|Discover/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-page[data-page="discover"]') !== null`, 8000, '切回发现页')
  // 页签底线也是 0.26s 过渡：[3] 紧接着就要量它的 scaleX，这里先让它走完，别量到中间帧。
  await new Promise((resolve) => setTimeout(resolve, 450))

  console.log('\n[3] 动效（真实计算样式）')
  // 必须先等卡片真的出现：目录是一次网络往返，刚打开面板时还是骨架屏。
  await waitFor(client, `document.querySelector('.dshpm-card') !== null`, 30000, '发现页的第一张卡片')
  const motionPref = await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`)
  expect('前置条件：本条断言跑在「不减少动效」的偏好下', motionPref === false, `实际 reduce=${motionPref}`)
  const animations = await evaluate(
    client,
    `(() => {
       const card = document.querySelector('.dshpm-card');
       const pick = (el) => { if (!el) return null; const s = getComputedStyle(el); return { anim: s.animationName, dur: s.animationDuration, fill: s.animationFillMode, transition: s.transitionProperty.includes('transform'), delay: s.animationDelay }; };
       return { card: pick(card), cards: document.querySelectorAll('.dshpm-card').length };
     })()`,
  )
  expect(
    '卡片带入场动画（dshpm-rise）且填充模式是 backwards（不会钉死 hover 位移）',
    animations?.card?.anim?.includes('dshpm-rise') && animations?.card?.fill === 'backwards',
    JSON.stringify(animations?.card),
  )
  expect('卡片有 transform 过渡（hover 抬升能生效）', animations?.card?.transition === true, JSON.stringify(animations?.card))
  const staggered = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-card')).map(c => getComputedStyle(c).animationDelay).filter(d => d !== '0s').length`,
  )
  expect('卡片是错峰入场的（存在非零 animation-delay）', Number(staggered) > 0, `非零延迟的卡片数：${staggered}`)
  const tabUnderline = await evaluate(
    client,
    `(() => { const t = document.querySelector('.dshpm-tab[data-active="true"]'); const after = t ? getComputedStyle(t, '::after') : null; return after ? { transform: after.transform, bg: after.backgroundColor } : null; })()`,
  )
  expect('激活页签的滑动底线是 scaleX(1)（未激活的为 scaleX(0)，视觉上从一个滑到另一个）', String(tabUnderline?.transform).startsWith('matrix(1'), JSON.stringify(tabUnderline))

  // README 用图：发现页的完整状态（真实目录 + 三个页签 + 当前版本号）。等入场动画收尾再拍，
  // 免得截到半透明的中间帧；截图目录被 gitignore，入 docs/assets 才是发布物。
  await new Promise((resolve) => setTimeout(resolve, 900))
  const tabBeforeShot = await evaluate(client, `document.querySelector('.dshpm-tab[data-active="true"]')?.textContent.trim()`)
  await screenshot(client, join(shotDir, 'market-discover.png'))
  const tabAfterShot = await evaluate(client, `document.querySelector('.dshpm-tab[data-active="true"]')?.textContent.trim()`)
  expect(
    'README 用图是在「发现」页签拍的（拍前拍后都没被切走）',
    /发现|Discover/.test(String(tabBeforeShot)) && /发现|Discover/.test(String(tabAfterShot)),
    JSON.stringify({ tabBeforeShot, tabAfterShot }),
  )
  console.log(`  · 截图：${join(shotDir, 'market-discover.png')}`)

  console.log('\n[3a] 搜索框只保留一个清除键（用户报的「两个清除键」）')
  // 复现状态必须是「聚焦 + 有值」：Chromium 只在这个状态下给 input[type=search] 画原生 ✕
  // （按 accent-color 上色，所以是蓝的），与我们 .dshpm-search 里那颗并排。原生那颗不在 DOM 里、
  // 数不出来，所以三头并进：生效的样式表要有关掉它的规则 + 我们那颗只有一颗 + 截图留证。
  const cancelRules = await evaluate(
    client,
    `(() => {
       const out = [];
       for (const sheet of Array.from(document.styleSheets)) {
         let rules; try { rules = sheet.cssRules } catch (e) { continue }
         for (const rule of Array.from(rules || [])) {
           if (rule.selectorText && rule.selectorText.includes('::-webkit-search-cancel-button')) {
             out.push({ selector: rule.selectorText, css: rule.style.cssText });
           }
         }
       }
       return out;
     })()`,
  )
  // 宿主自己的搜索框（._3Y3Nma_search 之类）也有关掉原生 ✕ 的规则，所以必须挑出**我们这条**，
  // 否则宿主的规则会替我们「蒙混过关」——第一版断言就是这么误判通过/失败的。
  const ours = Array.isArray(cancelRules) ? cancelRules.find((rule) => String(rule.selector).includes('.dshpm-input')) : null
  expect(
    '生效的样式表里有一条针对搜索框、关掉原生 search 取消按钮的规则（否则聚焦时会画出第二个 ✕）',
    !!ours && /appearance\s*:\s*none/i.test(String(ours.css)) && /display\s*:\s*none/i.test(String(ours.css)),
    JSON.stringify(cancelRules),
  )
  const typed = await evaluate(
    client,
    `(() => {
       const input = document.querySelector('.dshpm-input');
       if (!input) return { ok: false, why: '.dshpm-input 不存在' };
       input.focus();
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(input, '1');
       input.dispatchEvent(new Event('input', { bubbles: true }));
       const r = input.getBoundingClientRect();
       return { ok: true, focused: document.activeElement === input, value: input.value,
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
     })()`,
  )
  expect(
    '搜索框聚焦并输入关键字（正是用户截图里冒出第二个 ✕ 的那个状态）',
    !!typed?.ok && typed?.focused === true && typed?.value === '1',
    JSON.stringify(typed),
  )
  console.log(`  · 搜索框位置（供截图裁剪核对）：${JSON.stringify(typed?.rect)}`)
  await waitFor(client, `document.querySelectorAll('.dshpm-search .dshpm-iconBtn').length === 1`, 5000, '输入后清除键出现')
  const clearCount = await evaluate(client, `document.querySelectorAll('.dshpm-search .dshpm-iconBtn').length`)
  expect('聚焦且有值时，搜索框里的清除按钮只有一颗', Number(clearCount) === 1, `实际：${clearCount}`)
  // 关键：原生 ✕ **只在聚焦时**才画（失焦的截图会「假装修好了」，第一版就是这么被坑的），
  // 所以截图前重新聚焦，并把 activeElement / appearance / 边框色打出来留痕。
  const refocus = `(() => {
      const input = document.querySelector('.dshpm-input');
      if (!input) return { active: false, why: 'no input' };
      input.focus();
      const box = input.closest('.dshpm-search');
      const cs = getComputedStyle(input);
      return { active: document.activeElement === input, value: input.value,
               appearance: cs.appearance || cs.webkitAppearance, border: box ? getComputedStyle(box).borderColor : null };
    })()`
  const focusBefore = await evaluate(client, refocus)
  expect('截图前焦点确实在搜索框上（否则原生 ✕ 根本不会画，断言就成了摆设）', focusBefore?.active === true, JSON.stringify(focusBefore))
  console.log(`  · 截图前的焦点状态：${JSON.stringify(focusBefore)}`)
  await screenshot(client, join(shotDir, 'market-search-clear.png'))
  console.log(`  · 截图：${join(shotDir, 'market-search-clear.png')}`)
  // 为什么没有「临时撤销修复 → 拍修复前的样子」的对照图：在 ref DSH + headless Edge 这个组合里，
  // 原生 ✕ 就是画不出来——聚焦、有值、连 input 的 appearance 都还原过，拍出来和修复后完全一样
  // （逐像素比过）。修复前的样子是用裸页复现的：同一段 input[type=search]、聚焦 + accent-color，
  // 无规则时是「蓝/深色 ✕ + 灰 ×」两颗，加上 appearance 或 display 其一就只剩一颗——正是用户截图
  // 里那个状态。用户的真实 DSH 确实画了两颗（其桌面 profile 直接 link 本仓库），所以规则必须在；
  // 这里钉住的是：规则生效在样式表里 + 我们那颗只有一颗 + 截图留证。
  // 清除键要真能清：点击走 onQueryClear（resetFilters），输入框与按钮一起复位。
  await evaluate(client, `(() => { const b = document.querySelector('.dshpm-search .dshpm-iconBtn'); if (b) b.click(); return true; })()`)
  await waitFor(
    client,
    `(() => { const i = document.querySelector('.dshpm-input'); return !!i && i.value === '' && document.querySelectorAll('.dshpm-search .dshpm-iconBtn').length === 0; })()`,
    5000,
    '点我们的清除键后输入框清空、按钮消失',
  )
  expect('点我们那颗清除键：输入框与按钮一起复位（原生行为没有接管）', true)

  console.log('\n[3b] 已安装页的列表动效')
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-row') !== null`, 15000, '已安装页的第一行')
  const rowAnim = await evaluate(
    client,
    `(() => { const r = document.querySelector('.dshpm-row'); const s = getComputedStyle(r); return { anim: s.animationName, fill: s.animationFillMode, delay: s.animationDelay }; })()`,
  )
  expect('已安装列表行也有入场动画且填充模式为 backwards', rowAnim?.anim?.includes('dshpm-rise') && rowAnim?.fill === 'backwards', JSON.stringify(rowAnim))
  const marketBadge = await evaluate(client, `!!document.querySelector('.dshpm-badge') && document.body.innerText.includes('市场自身') || document.body.innerText.includes('@fixture/needs-update')`)
  expect('已安装页显示注入的三个 bundle', marketBadge === true)
  // 用户要求：「刷新目录」只在「发现」页签出现——已安装页没有目录列表，刷它没意义。
  const installedHeader = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-headerActions button')).map(b => b.textContent.trim())`,
  )
  expect(
    '切到「已安装」后头部的「刷新目录」已隐藏（只在发现页出现）',
    Array.isArray(installedHeader) && installedHeader.length === 0,
    `实际：${JSON.stringify(installedHeader)}`,
  )

  console.log('\n[4] 打开「可更新」页签（检查更新状态机 + 逐个确认 + 一键更新）')
  // 用户报的「点更新插件没有任何反馈」：先把上一条提示条等没（自动收起 4.6s + 200ms 退场），
  // 这样点击后新出现的那条就必然是**本次**的回执，而不是上一次的残留。
  await waitFor(client, `document.querySelector('.dshpm-notice') === null`, 12000, '上一条提示条已自动收起')
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /可更新|Updates/.test(b.textContent)).click(); true`)
  await waitFor(client, `(() => { const t = document.querySelector('.dshpm-tab[data-active="true"]'); return !!t && /可更新|Updates/.test(t.textContent); })()`, 8000, '切到可更新页签')
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel') !== null`, 8000, '可更新页渲染出来')
  expect('点「可更新」页签切过去（已安装右边第三个）', true)
  // 页签取代了抽屉：内容**整页**出现，不是叠在发现页卡片下面。
  const cardsAfter = await evaluate(client, `document.querySelectorAll('.dshpm-card').length`)
  expect('整页切换生效（发现页卡片已卸载，不是叠在下面）', Number(cardsAfter) === 0, `剩余卡片 ${cardsAfter}`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel').getBoundingClientRect().height > 120`, 8000, '可更新页展开到最终高度')
  // 打开页签要给回执（原「更新插件」按钮的反馈迁到了这里）。
  await waitFor(client, `(() => { const n = document.querySelector('.dshpm-notice'); if (!n) return false; return /个插件有新版本|全部都是最新/.test(n.innerText.replace(/\\s+/g, ' ')); })()`, 8000, '打开页签后提示条给出回执')
  expect('打开「可更新」页签后提示条给出结果回执（发现 2 个插件有新版本）', true)
  const panelText = await evaluate(client, `document.querySelector('.dshpm-updatesPanel').innerText`)
  expect('列表里列出两个可更新插件与版本走向', /@fixture\/needs-update/.test(String(panelText)) && /1\.2\.0/.test(String(panelText)) && /@fixture\/second-update/.test(String(panelText)), String(panelText).slice(0, 200))
  const rows = await evaluate(client, `document.querySelectorAll('.dshpm-updatesPanel .dshpm-updateRow:not(.dshpm-updateRow--ghost)').length`)
  expect('列表只有两条（第三个没有更新，不进列表）', rows === 2, `实际：${rows}`)
  const perItemButtons = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-updatesPanel .dshpm-updateRow .dshpm-btn--primary')).map(b => b.textContent.trim())`,
  )
  expect(
    '每一条都有自己的「更新到 x.y.z」按钮（逐条确认仍然保留）',
    Array.isArray(perItemButtons) && perItemButtons.length === 2 && perItemButtons.every((label) => label.includes('更新到')),
    JSON.stringify(perItemButtons),
  )

  // 页头右侧的两个按钮（用户第三轮指定）：左边是合并状态机「检查更新 → 一键更新（N）/ 重新检查」，
  // 右边是改名后的「插件市场更新」；两颗风格统一（都是 primary），页脚的旧「重新检查」已合并删除。
  const paneButtons = await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-updatesActions button')).map(b => b.textContent.trim())`)
  expect(
    '页头右侧初始是「检查更新」与「插件市场更新（四态之一）」两个按钮',
    Array.isArray(paneButtons) && paneButtons.length === 2 && /^检查更新/.test(paneButtons[0] || '') && /插件市场更新|正在更新|更新到|再次检查|Plugin market|Updating|Update to|Check again/.test(paneButtons[1] || ''),
    JSON.stringify(paneButtons),
  )
  // 用户报「第一次进入这个界面怎么会是再次检查的状态机」：启动时的自动检查（桩恒回无更新、
  // 拖 400ms）**不许**把按钮推进「已检查过」——先等它走完（aria-busy 落回 false），首次进入
  // 必须是初始的「插件市场更新」且 data-state 为 idle；「再次检查」只属于下面手动点过的那次。
  await waitFor(client, `(() => { const b = document.querySelectorAll('.dshpm-updatesActions button')[1]; return !!b && b.getAttribute('aria-busy') !== 'true'; })()`, 10000, '启动的自动检查走完（右键不在忙碌态）')
  const selfBtnFirst = await evaluate(client, `(() => { const b = document.querySelectorAll('.dshpm-updatesActions button')[1]; return b ? { text: (b.textContent || '').trim(), state: b.getAttribute('data-state') } : null; })()`)
  expect(
    '首次进入可更新页：右键是初始「插件市场更新」（自动检查没更新不写「再次检查」）',
    !!selfBtnFirst && (selfBtnFirst.text === '插件市场更新' || selfBtnFirst.text === 'Plugin market update') && selfBtnFirst.state === 'idle',
    JSON.stringify(selfBtnFirst),
  )
  const panePrimary = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-updatesActions button')).map(b => b.className.includes('dshpm-btn--primary'))`,
  )
  expect('两颗按钮风格统一（都带 primary）', Array.isArray(panePrimary) && panePrimary.length === 2 && panePrimary.every(Boolean), JSON.stringify(panePrimary))
  // 用户要求：两颗黑按钮文字必须区分——右键就绪态曾复用左键的「重新检查」，撞车。
  const distinctLabels = await evaluate(
    client,
    `(() => { const b = Array.from(document.querySelectorAll('.dshpm-updatesActions button')); return { left: (b[0]?.textContent || '').trim(), right: (b[1]?.textContent || '').trim() }; })()`,
  )
  expect(
    '两颗黑按钮文字不同（右键就绪态是「再次检查」，不是左键的「重新检查」）',
    !!distinctLabels?.left && !!distinctLabels?.right && distinctLabels.left !== distinctLabels.right,
    JSON.stringify(distinctLabels),
  )
  const footCount = await evaluate(client, `document.querySelectorAll('.dshpm-updatesPanel .dshpm-drawerFoot').length`)
  expect('页脚那颗独立的「重新检查」已合并进按钮（drawerFoot 不复存在）', Number(footCount) === 0, `drawerFoot ${footCount}`)

  // 右键四态状态机（用户报「点不点都是一个」）：点下去必须真的换文案——
  // 桩恒定回「没有更新」，所以最终停在「再次检查」，中间那 400ms 是「正在更新…」。
  // 首次进入是「插件市场更新」（上面已断言），这次是**手动**点的，才允许落「再次检查」。
  await evaluate(client, `(() => { const b = Array.from(document.querySelectorAll('.dshpm-updatesActions button'))[1]; if (b) b.click(); return true; })()`)
  const duringSelfCheck = await evaluate(client, `(() => { const b = document.querySelectorAll('.dshpm-updatesActions button')[1]; return b ? { text: (b.textContent || '').trim(), busy: b.getAttribute('aria-busy') } : null; })()`)
  expect(
    '点右键后立即进入「正在更新…」忙碌态（文字真的变了）',
    !!duringSelfCheck && duringSelfCheck.busy === 'true' && /正在更新|Updating/.test(duringSelfCheck.text),
    JSON.stringify(duringSelfCheck),
  )
  await waitFor(client, `(() => { const b = document.querySelectorAll('.dshpm-updatesActions button')[1]; return !!b && /再次检查|Check again/.test(b.textContent); })()`, 10000, '检查完没有更新 → 按钮变成「再次检查」')
  const afterSelfCheck = await evaluate(client, `(() => { const b = document.querySelectorAll('.dshpm-updatesActions button')[1]; return b ? (b.textContent || '').trim() : null; })()`)
  expect('右键检查完（无更新）显示「再次检查」', /再次检查|Check again/.test(String(afterSelfCheck)), `实际：${afterSelfCheck}`)

  // 状态机走一遍：点「检查更新」→ 重读列表 → 检查过且有更新 → 同一颗按钮变成「一键更新（2）」。
  await evaluate(client, `(() => { const b = Array.from(document.querySelectorAll('.dshpm-updatesActions button')).find(x => /检查更新/.test(x.textContent)); if (b) b.click(); return true; })()`)
  await waitFor(client, `(() => { const b = document.querySelectorAll('.dshpm-updatesActions button')[0]; return !!b && /一键更新（2）/.test(b.textContent); })()`, 10000, '检查后按钮变成「一键更新（2）」')
  const checkedButtons = await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-updatesActions button')).map(b => b.textContent.trim())`)
  expect('「检查更新」按下后发现 2 个更新 → 同一颗按钮显示「一键更新（2）」', /一键更新（2）/.test(String(checkedButtons?.[0])), JSON.stringify(checkedButtons))
  expect(
    '批量入口「一键更新」就位，同时逐条确认没有被取消',
    Array.isArray(perItemButtons) && perItemButtons.length === 2 && perItemButtons.every((label) => label.includes('更新到')),
    `逐条=${JSON.stringify(perItemButtons)}`,
  )
  const selfState = await evaluate(client, `(() => { const b = document.querySelectorAll('.dshpm-updatesActions button')[1]; return b ? { state: b.getAttribute('data-state'), busy: b.getAttribute('aria-busy') } : null; })()`)
  expect('手动点过一次后右键停在 ready（「再次检查」态；首次进入是 idle，这里已不是）', !!selfState && selfState.state === 'ready', JSON.stringify(selfState))

  // 点「一键更新」：顺序逐个跑，第一条 restart-required（必须计成功）、第二条注入 EPERM 占用失败
  // → 汇总必须如实写「成功 1、失败 1」。
  await evaluate(client, `(() => { const b = Array.from(document.querySelectorAll('.dshpm-updatesActions button')).find(x => /一键更新/.test(x.textContent)); if (b) b.click(); return true; })()`)
  // 第一条响应被拖了 700ms：这个窗口里批量按钮是 aria-busy，而顶部**没有**黑条进度条（已删）。
  await waitFor(client, `document.querySelector('.dshpm-updatesActions button[aria-busy="true"]') !== null`, 8000, '批量进行中（按钮 aria-busy）')
  const progressDuring = await evaluate(client, `document.querySelectorAll('.dshpm-progress').length`)
  expect('写操作进行中顶部没有黑条进度条（用户点名删掉的那条）', Number(progressDuring) === 0, `进度条元素 ${progressDuring}`)

  // 批量进行中，切到「已安装」页确认那颗更新按钮也是禁用的。
  // 这是「一键更新永久卡死」的**入口**：从前这一页的按钮不像「可更新」页那样受 batchRunning 约束，
  // 用户能从这一页插进一个正被批量处理的包，让批量那一步撞上守卫。现在两页口径一致。
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-row .dshpm-rowActions button') !== null`, 8000, '批量进行中切到已安装页')
  const installedBtnsDuringBatch = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-row .dshpm-rowActions button')).filter(b => /更新到|Updating to/.test(b.textContent)).map(b => ({ text: b.textContent.trim(), disabled: b.disabled }))`,
  )
  expect(
    '批量进行中「已安装」页的更新按钮被禁用（否则用户能从这一页插进正在批量处理的包）',
    Array.isArray(installedBtnsDuringBatch) && installedBtnsDuringBatch.length > 0 && installedBtnsDuringBatch.every((b) => b.disabled === true),
    JSON.stringify(installedBtnsDuringBatch),
  )
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /可更新|Updates/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel') !== null`, 8000, '切回可更新页')
  await waitFor(client, `(() => { const n = document.querySelector('.dshpm-notice'); if (!n) return false; const txt = n.innerText.replace(/\\s+/g, ' '); return /更新完成：成功 1、失败 1/.test(txt); })()`, 20000, '一键更新给出汇总回执')
  expect('汇总回执如实反映批量结果（成功 1、失败 1）', true)
  const rowResults = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-updateRow .dshpm-updateResult')).map(el => ({ ok: el.getAttribute('data-ok'), text: el.innerText.trim() }))`,
  )
  expect(
    '第一条 restart-required 计为成功（显示重启提示，不是失败）；第二条失败行显示「文件被占用」短句',
    Array.isArray(rowResults) && rowResults.length === 2 && rowResults[0]?.ok === 'true' && /重启 DSH 后生效/.test(String(rowResults[0]?.text)) && rowResults[1]?.ok === 'false' && /占用/.test(String(rowResults[1]?.text)),
    JSON.stringify(rowResults),
  )

  // 重启助手横幅：restart-required 之后必须出现一键「重启 DSH」。**只断言、绝不点击**——
  // 点了会真的退出这条 e2e 宿主；拉起/拉回的真实生命周期由 verify/restart-helper.test.mjs 覆盖。
  const restartBtn = await evaluate(client, `(() => { const b = document.querySelector('.dshpm-restartBtn'); return b ? { text: b.textContent.trim(), phase: b.getAttribute('data-phase'), disabled: b.disabled, title: b.getAttribute('title') } : null; })()`)
  expect(
    'restart-required 后出现重启横幅与「重启 DSH」按钮（空闲态、可点、tooltip 写明流式会被截断）',
    !!restartBtn && /重启 DSH/.test(String(restartBtn.text)) && restartBtn.phase === 'idle' && restartBtn.disabled === false && /流式/.test(String(restartBtn.title)),
    JSON.stringify(restartBtn),
  )
  const updatesActionsAfter = await evaluate(client, `document.querySelectorAll('.dshpm-updatesActions button').length`)
  expect('重启按钮在横幅里、不混进可更新页头部按钮组（那里精确 2 颗）', Number(updatesActionsAfter) === 2, `按钮 ${updatesActionsAfter}`)

  const panelOpenHeight = await evaluate(client, `document.querySelector('.dshpm-updatesPanel').getBoundingClientRect().height`)
  expect('可更新页有实际高度（不是空壳）', Number(panelOpenHeight) > 120, `高度 ${panelOpenHeight}`)

  // 截图前再关一次 API Key 引导弹窗（它在会话列表加载后才出现，会盖住可更新页）。
  await evaluate(client, dismissApiDialog)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await screenshot(client, join(shotDir, 'market-updates-open.png'))
  console.log(`  · 截图：${join(shotDir, 'market-updates-open.png')}`)
  // 头部工具条 2 倍放大：文档里要看清三个按钮的样式与角标。
  const zoom = await client.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1560, height: 130, scale: 2 } })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(shotDir, 'market-header-zoom.png'), Buffer.from(zoom.data, 'base64'))
  console.log(`  · 截图：${join(shotDir, 'market-header-zoom.png')}`)

  console.log('\n[4b] 用户原场景：发现页（长网格）+ 矮视口下切到「可更新」页签')
  // 上面那组是在「已安装」页点的，那里内容短——测不出「点了没反应」。这里复现真实场景：
  // 卡片网格把页面撑得很长、视口只有 520px。页签切过去之后内容从页签正下方开始，
  // 不用任何滚动就看得见（旧版抽屉开在几百像素之下，看上去就是「什么都没发生」）。
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /发现|Discover/.test(b.textContent)).click(); true`)
  await waitFor(client, `!!document.querySelector('.dshpm-card')`, 30000, '发现页卡片渲染出来（页面变长）')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 520, deviceScaleFactor: 1, mobile: false })
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /可更新|Updates/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel') !== null`, 8000, '矮视口下可更新页渲染')
  await waitFor(client, `(() => { const p = document.querySelector('.dshpm-updatesPanel'); if (!p) return false; const r = p.getBoundingClientRect(); return r.top >= -1 && r.top < window.innerHeight && r.bottom > 0; })()`, 8000, '可更新页在视区内')
  expect('发现页 + 520px 视口：切过去后内容整页出现且在视区内（无需滚动）', true)
  await screenshot(client, join(shotDir, 'market-updates-short-viewport.png'))
  console.log(`  · 截图：${join(shotDir, 'market-updates-short-viewport.png')}`)
  // 还原视口；页签交给 [5] 去切回已安装。
  await client.send('Emulation.clearDeviceMetricsOverride')

  console.log('\n[5] 页签来回切（可更新 → 已安装）')
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-row') !== null`, 8000, '已安装页切回来')
  const backRows = await evaluate(client, `document.querySelectorAll('.dshpm-row').length`)
  expect('切回「已安装」后列表回来（页签可来回切）', Number(backRows) >= 3, `行数 ${backRows}`)
  const stalePanel = await evaluate(client, `document.querySelectorAll('.dshpm-updatesPanel').length`)
  expect('切走后可更新页已卸载（同一时间只有一个页签的内容在 DOM 里）', Number(stalePanel) === 0, `残留 ${stalePanel}`)
  await screenshot(client, join(shotDir, 'market-tab-installed.png'))
  console.log(`  · 截图：${join(shotDir, 'market-tab-installed.png')}`)

  console.log('\n[6] prefers-reduced-motion：关掉动效但内容仍在')
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const reduceActive = await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`)
  expect('前置条件：偏好确实被切成 reduce', reduceActive === true, `实际 reduce=${reduceActive}`)
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /可更新|Updates/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel') !== null`, 8000, '可更新页渲染出来')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const reduced = await evaluate(
    client,
    `(() => {
       const row = document.querySelector('.dshpm-updateRow');
       const s = row ? getComputedStyle(row) : null;
       const panel = document.querySelector('.dshpm-updatesPanel');
       const ps = panel ? getComputedStyle(panel) : null;
       return { rowAnim: s ? s.animationName : null, panelAnim: ps ? ps.animationName : null, panelVisible: panel ? getComputedStyle(panel).visibility : null, rows: document.querySelectorAll('.dshpm-updatesPanel .dshpm-updateRow:not(.dshpm-updateRow--ghost)').length };
     })()`,
  )
  expect('reduced-motion 下动画被关掉（animation-name: none）', reduced?.rowAnim === 'none' && reduced?.panelAnim === 'none', JSON.stringify(reduced))
  expect('reduced-motion 下内容仍然可见（两条更新记录都在、页面不是隐藏的）', reduced?.rows === 2 && reduced?.panelVisible === 'visible', JSON.stringify(reduced))
  await screenshot(client, join(shotDir, 'market-reduced-motion.png'))

  console.log('\n[7] 控制台错误')
  const pluginErrors = consoleErrors.filter((line) => !/favicon|net::ERR_|DevTools/i.test(line))
  expect('插件在页面里没有产生控制台错误', pluginErrors.length === 0, pluginErrors.slice(0, 5).join(' | '))

  // 同一类缺陷的通用回归：视口矮到内容必然溢出时，容器必须自己滚动，
  // 而不是把某个带 overflow 的子项（自动最小尺寸 0）压扁。
  console.log('\n[8] 窄高视口下不得压扁任何区块')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 520, deviceScaleFactor: 1, mobile: false })
  // 用「发现」页测：它内容最长，才是「视口矮到必然溢出」的那个场景。
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /发现|Discover/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelectorAll('.dshpm-card').length > 0`, 30000, '发现页卡片渲染出来')
  await waitFor(client, `document.querySelector('.dshpm-grid').getBoundingClientRect().height > 200`, 8000, '目录网格高度稳定')
  const squeezed = await evaluate(
    client,
    `(() => {
       const root = document.querySelector('.dshpm-root');
       const bad = [];
       for (const child of root.children) {
         if (child.clientHeight < child.scrollHeight - 1) bad.push((child.className || '?') + ':' + child.clientHeight + '<' + child.scrollHeight);
       }
       return { bad, rootScrolls: root.scrollHeight > root.clientHeight, rootClient: root.clientHeight, rootScroll: root.scrollHeight, children: root.children.length };
     })()`,
  )
  expect('窄高视口下没有任何直接子项被压扁', Array.isArray(squeezed?.bad) && squeezed.bad.length === 0, JSON.stringify(squeezed))
  expect('面板根自己滚动（不是靠压扁子项来容纳内容）', squeezed?.rootScrolls === true, JSON.stringify(squeezed))
  await screenshot(client, join(shotDir, 'market-short-viewport.png'))
  console.log(`  · 截图：${join(shotDir, 'market-short-viewport.png')}`)
} catch (error) {
  expect('测试执行未抛异常', false, error.message)
} finally {
  await browser.close()
}

const failed = results.filter((result) => !result.ok)
console.log('')
console.log(`真实浏览器验收：${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  for (const result of failed) console.log(`  失败：${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
  // 用 exitCode 而不是 process.exit(1)：stdout 接的是管道（PowerShell 捕获），
  // process.exit 会把还没刷出去的 console.log 全吞掉——失败时看起来「一行输出都没有」。
  process.exitCode = 1
}
