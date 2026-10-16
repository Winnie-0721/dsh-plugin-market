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
    // [17] 用：三种「结构上做不到」的包，用来验「不可以的项目就隐藏控件」。
    // 全部**不给 latest/updateAvailable**：这一组测的是开关与卸载，不该混进更新按钮的断言。
    {
      name: '@fixture/managed-by-host',
      version: '2.0.0',
      description: '宿主基础设施托管。',
      rows: [{ rowId: 'row-d' }],
      enabled: true,
      readOnlyReason: 'management-required',
    },
    {
      name: '@fixture/not-removable',
      version: '2.1.0',
      description: '宿主说这个包不可移除。',
      rows: [{ rowId: 'row-e' }],
      enabled: true,
      removable: false,
    },
    {
      name: '@fixture/no-entry-id',
      version: '2.2.0',
      description: '条目缺 entryId，开关点了也不会做事。',
      // 关键：rowId 有、entryId 没有。toggleEntry 用 entryId 发请求，缺它就是假开关。
      rows: [{ rowId: 'row-f' }],
      enabled: true,
    },
  ],
  plugins: [
    // 让 @fixture/no-entry-id 的详情里出现一个**缺 entryId** 的条目。
    // `bundle` 必须显式给：真实宿主由 projectPlugin 反查填上（rowId/moduleName → 包名），
    // 而这里是注入的响应，不填的话 entriesForBundle 匹配不上、条目不会挂到那一行上。
    { entryId: null, moduleName: '@fixture/no-entry-id', bundle: '@fixture/no-entry-id', enabled: true, fiberPhase: 'active' },
  ],
}

const browser = await launchBrowser({ width: 1560, height: 980 })
const { client } = browser
let consoleErrors = []
/** [9] 专用开关：打开后 /install 返回带 activation 的「版本对不上」响应。 */
let manualUpdateProbe = false
/** [10] 专用开关：打开后 /install 返回「构建脚本待批准」（pendingBuilds）。 */
let buildApprovalProbe = false
/** [11] 专用：非 null 时 /status 会带上这个 pendingRestart（模拟「宿主进程仍然记得待重启」）。 */
let statusProbe = null
/**
 * [17] 专用：开启后 /status 报 `manager.available=false`（宿主没有 pluginManager）。
 * 用来验「全局只读时绝不隐藏任何卡片」那条豁免——`readOnly=true` 时每个包都"不可操作"，
 * 按字面规则会把整页藏空，而那时页面唯一的价值就是「装了什么」这份清单。
 */
let noManagerProbe = false
/**
 * [14] 专用：开启后拦截 /catalog 返回**确定性多页目录**。
 * 底栏那条断言要求页数 > 1 才有翻页按钮；真实目录虽然有 189 页，但那是网络给的，
 * 网络一抖这条断言就会假红——所以按本文件既有做法（[9][10][11]）用 fixture 钉死。
 * 数字刻意取用户截图里的 4527 / 189，让断言对着真实观感。
 */
let catalogProbe = false
const INJECTED_CATALOG = {
  ok: true,
  items: Array.from({ length: 24 }, (_, i) => ({
    name: `@fixture/list-${i}`,
    description: `列表底栏夹具 ${i}`,
    version: '1.0.0',
    stars: 100 - i,
    categories: ['dev'],
    installed: false,
  })),
  page: { page: 1, pages: 189, total: 4527 },
  categories: [{ id: 'dev', label: '开发' }],
  catalog: { updatedAt: '2026-10-13T00:00:00Z', count: 4527 },
}
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
      { urlPattern: '*plugin-market/catalog*', requestStage: 'Request' },
    ],
  })
  client.on('Fetch.requestPaused', (params) => {
    const isInstall = /\/plugin-market\/install$/.test(params.request.url)
    const isSelfCheck = /\/plugin-market\/self-update/.test(params.request.url)
    const isStatus = /\/plugin-market\/status/.test(params.request.url)
    const isCatalog = /\/plugin-market\/catalog/.test(params.request.url)
    const posted = String(params.request.postData || '')
    // [14]：只在探针开启时接管 /catalog，其余时候放行给真实宿主。
    if (isCatalog) {
      if (!catalogProbe) {
        client.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {})
        return
      }
      const body = Buffer.from(JSON.stringify(INJECTED_CATALOG), 'utf8').toString('base64')
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
      return
    }
    let payload = INJECTED_INSTALLED
    let delay = 0
    if (isStatus) {
      // 两种改写 /status 的探针，合一处理：
      //   [11] statusProbe 非 null ⇒ 注入「宿主仍然记得待重启」；
      //   [17] noManagerProbe ⇒ 注入 manager.available=false（宿主没有 pluginManager）。
      // 后者是给「全局只读时绝不隐藏任何卡片」那条豁免用的：`readOnly` 来自 /status
      // （挂载时读一次），而 /installed 是**另一个请求**——所以"status 说没有管理器、
      // list 仍回得来内容"是真实可构造的形状（本仓库 index.js 自己就写着
      // 「宿主服务可能比本插件晚注册」）。没有这个形状，那条豁免就永远测不到。
      if (statusProbe !== null || noManagerProbe) {
        const body = Buffer.from(
          JSON.stringify({
            ok: true,
            plugin: { name: 'deepseek-harness-market', version: '1.1.6' },
            host: { dsh: null, node: 'v0.0.0', platform: 'win32', profile: 'marketcheck' },
            manager: { available: noManagerProbe ? false : true, registries: null },
            // 桌面壳：一键重启不可用（横幅只留说明，不给按钮）——与真实桌面一致。
            restart: { available: false },
            pendingRestart: statusProbe,
            catalog: null,
          }),
          'utf8',
        ).toString('base64')
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
        return
      }
      // 探针关闭时**放行给真实宿主**（不 fulfill），否则会把真实 /status 打坏。
      client.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {})
      return
    }
    if (isInstall && buildApprovalProbe) {
      // [10] 专用：构建脚本待批准（真实案例：装 @linxin666/dsh-remote-web-ui 时它的依赖
      // cloudflared 有 postinstall，pnpm 11 忽略它并非零退出）。
      // 宿主把这次 installBundle 折成 { application:'failed', error, pendingBuilds }，
      // 而**修复前** sendChangeResult 回 ok:false → 客户端 requestJSON 直接抛错 →
      // 「弹批准框」那段是死代码。这条断言钉的就是「批准入口真的出现过」。
      payload = {
        ok: true, // 修复后的服务端行为：待批准 = 可继续，不是失败到底
        changed: false,
        application: 'failed',
        error: { code: 'build-blocked', message: '构建脚本待批准。' },
        pendingBuilds: ['cloudflared'],
      }
    } else if (isInstall && manualUpdateProbe) {
      // [9] 专用：装完**回读发现磁盘版本与目录不符**（v1.1.7 的 activation）。
      // 用显式开关切换，而不是靠 postData 猜——批量那一段必须保持原样，
      // 否则它会从 restart-required 变成 applied，连累重启横幅与「成功 1、失败 1」两条断言。
      payload = {
        ok: true,
        changed: true,
        application: 'applied',
        activation: {
          state: 'live',
          expected: '1.2.0',
          installed: '1.0.0',
          enabled: true,
          versionMatches: false,
          reasons: ['version-mismatch'],
        },
      }
    } else if (isSelfCheck) {      // 右键点击要走确定性路径：CDN 慢、宿主 10 分钟缓存都会让断言变成赌运气。
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

  // 页头右侧的两个按钮（用户第三轮指定）：左边是合并状态机「一键更新（N）/ 检查更新 / 重新检查」，
  // 右边是改名后的「插件市场更新」；两颗风格统一（都是 primary），页脚的旧「重新检查」已合并删除。
  //
  // 用户第四轮报的问题（本次修的）：**列表里明明已经列着 2 个可更新插件、页签角标也是 2，
  // 左边那颗按钮却还写「检查更新」**——它要人先点一下「检查」才肯变成「一键更新（2）」，
  // 而那一页的数据早就加载好了。用户的原话：「有更新时检查更新状态机应该为一键更新」。
  // 所以这里断言的是**首屏**（切到页签、列表已渲染、没有再点任何按钮）就已经是「一键更新（2）」。
  const paneButtons = await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-updatesActions button')).map(b => b.textContent.trim())`)
  expect(
    '页头右侧首屏就是「一键更新（2）」与「插件市场更新（四态之一）」两个按钮',
    Array.isArray(paneButtons) && paneButtons.length === 2 && /^一键更新（2）/.test(paneButtons[0] || '') && /插件市场更新|正在更新|更新到|再次检查|Plugin market|Updating|Update to|Check again/.test(paneButtons[1] || ''),
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

  // 用户第四轮的核心诉求：**首屏就应该是「一键更新（2）」，不需要先点一次「检查更新」**。
  // 上面那条断言已经钉住首屏文案；这里再钉住「它真的能一键跑」，以及不再存在「先检查一下」
  // 这个多余的动作——那一页打开时列表已经把 2 个可更新插件摆出来了，没有信息缺口。
  const checkedButtons = await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-updatesActions button')).map(b => b.textContent.trim())`)
  expect('首屏无需任何点击：左边那颗已经是「一键更新（2）」', /一键更新（2）/.test(String(checkedButtons?.[0])), JSON.stringify(checkedButtons))
  const noCheckButton = await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-updatesActions button')).filter(b => /检查更新/.test(b.textContent)).length`)
  expect(
    '有更新时不再出现「检查更新」这颗多余按钮（列表与角标已给出全部信息）',
    Number(noCheckButton) === 0,
    `仍存在 ${noCheckButton} 颗「检查更新」`,
  )
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
  // **批量进行中绝不能弹重启询问窗**（v1.2.0）：这是这个功能最容易做坏的地方——
  // 若每一步都弹，「一键更新（N）」就会弹 N 次，用户被糊一脸弹窗。
  const modalDuringBatch = await evaluate(client, `document.querySelectorAll('.dshpm-modalLayer').length`)
  expect('一键更新进行中不弹重启询问窗（批量只在收尾问一次）', Number(modalDuringBatch) === 0, `弹窗元素 ${modalDuringBatch}`)

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

  // ── 重启询问弹窗（v1.2.0）─────────────────────────────────────────────
  // 批量收尾后**应该弹一次**「立即重启 / 稍后重启」。
  // 注意：下面一律用 `elementFromPoint` 做**真实命中测试**，不用 JS `.click()`——
  // `.click()` 绕过命中测试，覆盖层就算把按钮盖住了它照样「成功」，那种断言等于没测。
  await waitFor(client, `document.querySelector('.dshpm-modalLayer') !== null`, 10000, '批量收尾后弹出重启询问窗')
  const modalInfo = await evaluate(
    client,
    `(() => {
       const layer = document.querySelector('.dshpm-modalLayer');
       const card = document.querySelector('.dshpm-modalCard');
       const now = document.querySelector('[data-action="now"]');
       const later = document.querySelector('[data-action="later"]');
       if (!layer || !card || !now || !later) return null;
       const hit = (node) => {
         if (!node) return null;
         const r = node.getBoundingClientRect();
         const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
         return el ? (el === node || node.contains(el) ? 'self' : el.className || el.tagName) : null;
       };
       const lr = layer.getBoundingClientRect();
       const centre = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
       return {
         role: card.getAttribute('role'),
         ariaModal: card.getAttribute('aria-modal'),
         title: card.querySelector('.dshpm-modalTitle') ? card.querySelector('.dshpm-modalTitle').textContent.trim() : '',
         nowLabel: now.textContent.trim(),
         laterLabel: later.textContent.trim(),
         nowHit: hit(now),
         laterHit: hit(later),
         laterFocused: document.activeElement === later,
         coversViewport: lr.width >= window.innerWidth - 1 && lr.height >= window.innerHeight - 1,
         centreInsideModal: !!(centre && layer.contains(centre)),
       };
     })()`,
  )
  expect(
    '批量收尾后弹一次重启询问窗（role=dialog + aria-modal，标题说明「重启 DSH 才能让新代码生效」）',
    !!modalInfo && modalInfo.role === 'dialog' && modalInfo.ariaModal === 'true' && /重启 DSH/.test(modalInfo.title),
    JSON.stringify(modalInfo),
  )
  expect('两颗按钮是「立即重启 / 稍后重启」', !!modalInfo && /立即重启|Restart now/.test(modalInfo.nowLabel) && /稍后重启|Restart later/.test(modalInfo.laterLabel), JSON.stringify(modalInfo))
  expect(
    '**真实命中测试**：两颗按钮都在最上层、点得到（覆盖层没有把自己的按钮盖住）',
    modalInfo?.nowHit === 'self' && modalInfo?.laterHit === 'self',
    JSON.stringify({ now: modalInfo?.nowHit, later: modalInfo?.laterHit }),
  )
  expect('遮罩盖满整个视口（不是只在角落）', modalInfo?.coversViewport === true && modalInfo?.centreInsideModal === true, JSON.stringify(modalInfo))
  expect('打开时焦点默认落在「稍后重启」（破坏性那颗不是默认项）', modalInfo?.laterFocused === true, `focused=${modalInfo?.laterFocused}`)
  expect('**只弹一次**：批量跑了 2 条，弹窗数量仍是 1', Number(await evaluate(client, `document.querySelectorAll('.dshpm-modalLayer').length`)) === 1, '弹窗数量不为 1')
  // 几何：标题/正文/提示/按钮**互不重叠**，且卡片完整落在视口内。
  // 这条是必要的——截图缩放后靠肉眼判断「有没有压字」不可靠（本仓库的 [2c] 就是为同一类问题立的）。
  const modalGeom = await evaluate(
    client,
    `(() => {
       const card = document.querySelector('.dshpm-modalCard');
       const title = card.querySelector('.dshpm-modalTitle');
       const body = card.querySelector('.dshpm-modalBody');
       const hint = card.querySelector('.dshpm-modalHint') || card.querySelector('.dshpm-modalState');
       const actions = card.querySelector('.dshpm-modalActions');
       const box = (n) => { const r = n.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
       const cr = card.getBoundingClientRect();
       return {
         card: box(card), title: box(title), body: box(body), hint: hint ? box(hint) : null, actions: box(actions),
         viewport: { w: window.innerWidth, h: window.innerHeight },
         inViewport: cr.top >= -1 && cr.left >= -1 && cr.bottom <= window.innerHeight + 1 && cr.right <= window.innerWidth + 1,
         titleDecoration: getComputedStyle(title).textDecorationLine,
       };
     })()`,
  )
  expect(
    '弹窗内部不重叠：标题 → 正文 →（提示）→ 按钮依次向下排列',
    modalGeom.title.bottom <= modalGeom.body.top + 1 &&
      (!modalGeom.hint || modalGeom.body.bottom <= modalGeom.hint.top + 1) &&
      (!modalGeom.hint || modalGeom.hint.bottom <= modalGeom.actions.top + 1),
    JSON.stringify(modalGeom),
  )
  expect('弹窗完整落在视口内（不会有一半在屏幕外）', modalGeom.inViewport === true, JSON.stringify(modalGeom))
  expect('标题没有被加删除线之类的装饰', modalGeom.titleDecoration === 'none', `decoration=${modalGeom.titleDecoration}`)
  await screenshot(client, join(shotDir, 'market-restart-ask.png'))
  console.log(`  · 截图：${join(shotDir, 'market-restart-ask.png')}`)

  // Esc = 稍后重启：关掉弹窗，但**横幅必须还在**（改动真的待重启，不能装作没事）。
  await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
  await waitFor(client, `document.querySelector('.dshpm-modalLayer') === null`, 6000, 'Esc 关掉重启询问窗')
  const bannerAfterLater = await evaluate(client, `(() => { const b = document.querySelector('.dshpm-restartBtn'); return b ? b.textContent.trim() : null; })()`)
  expect('Esc 等同「稍后重启」：弹窗关掉，但重启横幅仍在（不假装已生效）', /重启 DSH/.test(String(bannerAfterLater)), `横幅=${bannerAfterLater}`)

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

  // 用户第五轮问：「检查开关和重启是不是有冲突」。
  // 确认**有一处真冲突**：重启是「进程级」动作（宿主 900ms 后 process.exit），
  // 而安装/更新/开关是「文件级」写入（宿主写 package.json / cordis.patch.yml）。
  // 在写没落地时点重启，宿主会带着「写了一半的 profile」退出——重启后状态未知。
  // 所以写操作进行中，重启入口必须与更新按钮**同一个口径**：禁用。
  //
  // 断言放在这里而不是批量进行中：批量那段**还没有重启横幅**（横幅由 restart-required 点亮），
  // 那时 `.dshpm-restartBtn` 根本不存在，取到 null 是在测空气（我第一版就放错了位置，
  // 跑红报 null——那不是修复没生效，是断言站错了地方）。
  // 这里横幅已在（上面刚断言过空闲可点），再触发一次**单条**更新：fixture 会拖 700ms，
  // 这个窗口里 job 非空 → 重启按钮必须变禁用；窗口结束后恢复可点（不能一禁到底）。
  const restartIdleBefore = await evaluate(client, `(() => { const b = document.querySelector('.dshpm-restartBtn'); return b ? b.disabled === true : null; })()`)
  expect('前置条件：没有写操作时重启按钮是可点的（下面要验「变成禁用」）', restartIdleBefore === false, `disabled=${restartIdleBefore}`)

  await evaluate(client, `(() => { const b = document.querySelector('.dshpm-updateRow .dshpm-btn--primary'); if (b) b.click(); return !!b; })()`)
  await waitFor(client, `document.querySelector('.dshpm-restartBtn[data-write-busy="true"]') !== null`, 8000, '写操作进行中重启按钮进入 write-busy')
  const restartDuringWrite = await evaluate(
    client,
    `(() => { const b = document.querySelector('.dshpm-restartBtn'); return b ? { disabled: b.disabled === true, writeBusy: b.getAttribute('data-write-busy'), title: b.getAttribute('title') } : null; })()`,
  )
  expect(
    '写操作进行中「重启 DSH」按钮被禁用（重启会让没落地的写入断在半路）',
    !!restartDuringWrite && restartDuringWrite.disabled === true && restartDuringWrite.writeBusy === 'true' && /等它结束|写操作/.test(String(restartDuringWrite.title)),
    JSON.stringify(restartDuringWrite),
  )
  // 反向断言：写操作结束后必须**恢复可点**，否则就是把重启永久锁死了。
  await waitFor(client, `(() => { const b = document.querySelector('.dshpm-restartBtn'); return !!b && b.getAttribute('data-write-busy') !== 'true'; })()`, 20000, '写操作结束')
  const restartIdleAfter = await evaluate(client, `(() => { const b = document.querySelector('.dshpm-restartBtn'); return b ? b.disabled === true : null; })()`)
  expect('写操作结束后重启按钮恢复可点（不能一禁到底）', restartIdleAfter === false, `disabled=${restartIdleAfter}`)

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

  // ── [9] 装后激活校验的真实界面表现（v1.1.7）────────────────────────────────
  // 上面的断言都在验「有没有」；这一组验的是**说的是不是真话**：
  // 宿主报 applied，但回读发现磁盘版本（1.0.0）与目录版本（1.2.0）不符时，
  // 界面**必须改口**——不能再写「已安装并已在运行」，那正是「说更新了、其实没更新」。
  console.log('\n[9] 装后激活校验：版本对不上时必须改口（v1.1.7）')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 980, deviceScaleFactor: 1, mobile: false })
  manualUpdateProbe = true
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-row .dshpm-rowActions button') !== null`, 8000, '已安装页的第一行（激活探针）')
  // 关掉可能还挂着的旧回执，否则新回执会被 dismiss 逻辑吞掉。
  await waitFor(client, `document.querySelector('.dshpm-notice') === null`, 12000, '旧回执已收起')
  await evaluate(
    client,
    `(() => { const b = Array.from(document.querySelectorAll('.dshpm-row .dshpm-rowActions button')).find(x => /更新到|Updating to/.test(x.textContent)); if (b) b.click(); return true; })()`,
  )
  await waitFor(client, `(() => { const n = document.querySelector('.dshpm-notice'); if (!n) return false; return /实际是|actually/.test(n.innerText); })()`, 15000, '激活回读给出的「版本不符」回执')
  const mismatchNotice = await evaluate(client, `(() => { const n = document.querySelector('.dshpm-notice'); return n ? { text: n.innerText.replace(/\\s+/g, ' ').trim(), kind: n.getAttribute('data-kind') } : null; })()`)
  expect(
    '宿主报 applied 但回读版本不符时改口：显示「实际是 v1.0.0（目录里写的是 v1.2.0）」而不是「已在运行」',
    !!mismatchNotice && /1\.0\.0/.test(String(mismatchNotice.text)) && /1\.2\.0/.test(String(mismatchNotice.text)) && !/并已在运行/.test(String(mismatchNotice.text)),
    JSON.stringify(mismatchNotice),
  )
  expect('版本不符按 warn 呈现（不是绿色成功）', mismatchNotice?.kind === 'warn', JSON.stringify(mismatchNotice))
  await screenshot(client, join(shotDir, 'market-activation-mismatch.png'))
  console.log(`  · 截图：${join(shotDir, 'market-activation-mismatch.png')}`)
  manualUpdateProbe = false

  // ── [10] 构建脚本待批准：批准入口必须真的出现（本轮修的 bug）──────────────────
  // 真实案例（用户报「还是安装不了」）：装 @linxin666/dsh-remote-web-ui 时，它的依赖
  // cloudflared 有 postinstall（下载二进制），pnpm 11 忽略它并以**非零**退出。
  // 宿主把这次 installBundle 折成 { application:'failed', error, pendingBuilds:['cloudflared'] }
  // ——「没装成，但只差用户批准一下」。
  // **修复前**：sendChangeResult 把 application:'failed' 一律报 ok:false，而客户端
  // requestJSON 在 ok!==true 时**直接抛错**，于是客户端「读 payload.pendingBuilds 弹批准框」
  // 成了**永远不可达的死代码**——用户只看到一条普通错误，**没有任何批准入口**，
  // 装多少次都装不上。这条断言钉的就是「那个入口真的出现过」。
  console.log('\n[10] 构建脚本待批准：必须给出批准入口（ok:false 会让它变成死代码）')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 980, deviceScaleFactor: 1, mobile: false })
  buildApprovalProbe = true
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-row .dshpm-rowActions button') !== null`, 8000, '已安装页的第一行（批准探针）')
  // warn 级回执**不会自动收起**（上面 [9] 留下的那条还在），所以这里显式点掉它，
  // 否则「等旧回执消失」永远等不到。点的是气泡右上那颗关闭键。
  await evaluate(
    client,
    `(() => { const n = document.querySelector('.dshpm-notice'); const b = n && n.querySelector('.dshpm-iconBtn'); if (b) b.click(); return true; })()`,
  )
  await waitFor(client, `document.querySelector('.dshpm-notice') === null`, 12000, '旧回执已点掉（批准探针）')
  await evaluate(
    client,
    `(() => { const b = Array.from(document.querySelectorAll('.dshpm-row .dshpm-rowActions button')).find(x => /更新到|Updating to/.test(x.textContent)); if (b) b.click(); return true; })()`,
  )
  // 核心断言：批准横幅出现了（修复前这里会永远是 null）。
  // 注意分工：**toast**（.dshpm-notice）只给一句短话「…需要在下方确认条里批准」，
  // 而**包名与「允许并安装」按钮**都在 **Banner**（.dshpm-banner）里。
  // 我第一版去 toast 里找按钮，于是两条断言假失败（第一条已证明横幅出现了）。
  await waitFor(
    client,
    `(() => { const b = document.querySelector('.dshpm-banner'); if (!b) return false; return /构建脚本|install scripts/.test(b.innerText); })()`,
    15000,
    '待批准横幅（修复前不可达：ok:false 会让 requestJSON 抛错）',
  )
  const approval = await evaluate(
    client,
    `(() => {
       const b = document.querySelector('.dshpm-banner');
       const n = document.querySelector('.dshpm-notice');
       if (!b) return null;
       const btn = Array.from(b.querySelectorAll('button')).find(x => /允许并安装|Allow and install/.test(x.textContent));
       return {
         bannerText: b.innerText.replace(/\\s+/g, ' ').trim(),
         noticeText: n ? n.innerText.replace(/\\s+/g, ' ').trim() : '',
         hasApprove: !!btn,
         namesBuild: /cloudflared/.test(b.innerText),
         kind: b.getAttribute('data-kind'),
       };
     })()`,
  )
  expect(
    '宿主报 pendingBuilds 时弹出批准确认条（不是一条普通错误）',
    !!approval && /构建脚本/.test(String(approval.bannerText)),
    JSON.stringify(approval),
  )
  expect('确认条里点名了要跑的包（cloudflared）', approval?.namesBuild === true, JSON.stringify(approval))
  expect('有「允许并安装」按钮（没有它用户无法继续）', approval?.hasApprove === true, JSON.stringify(approval))
  expect('同时给一句 toast 指路（说清在下方确认条里批准）', /下方确认条|confirm/i.test(String(approval?.noticeText)), JSON.stringify(approval))
  await screenshot(client, join(shotDir, 'market-build-approval.png'))
  console.log(`  · 截图：${join(shotDir, 'market-build-approval.png')}`)
  buildApprovalProbe = false

  console.log('\n[11] 刷新页面后「待重启」不许丢（v1.2.0 第六轮）')
  // 用户报的场景：更新完插件随手刷新，横幅消失 → 以为已经生效（其实宿主还在跑旧代码）。
  // 修法是宿主半记账、/status 带 `pendingRestart`、页面挂载时水合。
  // 这里**真实模拟「宿主进程仍然记得」**：拦截 /status 注入 pendingRestart，
  // 然后整页重载——页面不会有任何写操作，横幅只能来自水合。
  statusProbe = { names: ['@fixture/needs-update'], marketVersion: null }
  await client.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*plugin-market/installed*', requestStage: 'Request' },
      { urlPattern: '*plugin-market/install', requestStage: 'Request' },
      { urlPattern: '*plugin-market/self-update*', requestStage: 'Request' },
      { urlPattern: '*plugin-market/status*', requestStage: 'Request' },
    ],
  })
  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '重载后侧边栏入口')
  await evaluate(client, dismissApiDialog)
  // **必须点开面板**：刷新后市场面板默认是关的，横幅不在 DOM 里。
  // 我第一版只等了 `.dshpm-entry` 就去查 `.dshpm-banner`，于是永远等不到——
  // 又是「断言站错地方」，跟功能是否生效无关。
  await evaluate(client, `document.querySelector('.dshpm-entry').click(); true`)
  await waitFor(client, `!!document.querySelector('.dshpm-root')`, 20000, '重载后面板打开')
  await new Promise((resolve) => setTimeout(resolve, 800))
  await waitFor(
    client,
    // 注意：这个模板字符串里**不能出现反引号**（连注释里也不行）——反引号会提前结束模板，
    // 于是表达式被切成字符串拼接、`restartBtn` 变成未定义变量，跑起来报
    // "restartBtn is not a function" 这种与现场毫不相干的错（我这一轮就是这么中的，
    // 而且 node --check 语法是过的，只有真跑才暴露）。
    `(() => {
       // 不能等 .dshpm-restartBtn：桌面端 restart.available=false 时横幅照留、
       // 但按钮故意不给（点了必然失败且代价是应用整个关掉）。我第一版就是等按钮，
       // 于是永远等不到——那是断言站错地方，不是功能没生效。
       const b = document.querySelector('.dshpm-banner');
       return !!b && /待重启/.test(b.innerText);
     })()`,
    15000,
    '刷新后重启横幅仍在（来自 /status 水合）',
  )
  const hydrated = await evaluate(
    client,
    `(() => {
       const banner = document.querySelector('.dshpm-banner');
       const btn = document.querySelector('.dshpm-restartBtn');
       const modal = document.querySelector('.dshpm-modalLayer');
       return {
         bannerText: banner ? banner.innerText.replace(/\\s+/g, ' ').trim() : '',
         hasButton: !!btn,
         modalCount: document.querySelectorAll('.dshpm-modalLayer').length,
       };
     })()`,
  )
  expect(
    '刷新页面后「待重启」横幅仍然出现（修复前刷新即丢）',
    !!hydrated && /待重启/.test(String(hydrated.bannerText)),
    JSON.stringify(hydrated),
  )
  expect(
    '水合**不弹窗**（刷新不该突然跳出「立即重启/稍后重启」）',
    Number(hydrated?.modalCount) === 0,
    `弹窗数 ${hydrated?.modalCount}`,
  )
  expect(
    '桌面端横幅里仍不给一键重启按钮（避免点了必然失败）',
    hydrated?.hasButton === false,
    JSON.stringify(hydrated),
  )
  // 反向：宿主说没有待重启项时不该凭空出现横幅（否则就是把「已生效」也说成待重启）。
  statusProbe = null
  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '再重载一次（宿主已无待重启项）')
  await evaluate(client, dismissApiDialog)
  await evaluate(client, `document.querySelector('.dshpm-entry').click(); true`)
  await waitFor(client, `!!document.querySelector('.dshpm-root')`, 20000, '再重载后面板打开')
  await new Promise((resolve) => setTimeout(resolve, 800))
  const noBanner = await evaluate(
    client,
    `(() => {
       const b = document.querySelector('.dshpm-banner');
       return b && /待重启/.test(b.innerText) ? 1 : 0;
     })()`,
  )
  expect('宿主没有待重启项时不得凭空出现重启横幅', Number(noBanner) === 0, `横幅数 ${noBanner}`)

  console.log('\n[12] 大圆角与官方气泡（本轮改动）')
  // 这一段先**重新加载一次**：官方 Tooltip 靠真实 mouseenter 触发，而这套流程跑到这里时
  // 页面上压着一层 DSH 自己的遮罩（实测 elementFromPoint 命中的是 _mask_*，不是入口），
  // 指针根本到不了按钮——第一版就是这么假红的。重载 + 点掉弹窗后条件与「刚进页面」一致。
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 980, deviceScaleFactor: 1, mobile: false })
  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '重载后的侧边栏入口')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await evaluate(
    client,
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(继续|Continue)$/.test(x.textContent.trim())); if (b) { b.click(); return true; } return false; })()`,
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  await evaluate(client, dismissApiDialog)
  await new Promise((resolve) => setTimeout(resolve, 400))

  // 官方主题 token 的真实取值：--dsw-radius-md 是 **12px**（旧代码把它的回退值写成 8px，
  // 主题缺席时就会比官方小一圈），--dsw-radius-lg 是 16px。断言按 token 实算值来，
  // 而不是写死数字——主题换了这一条仍然成立。
  const radiusTokens = await evaluate(
    client,
    `(() => {
       const s = getComputedStyle(document.documentElement);
       return { md: s.getPropertyValue('--dsw-radius-md').trim(), lg: s.getPropertyValue('--dsw-radius-lg').trim() };
     })()`,
  )
  expect(
    '官方圆角 token 可读（--dsw-radius-md=12px / --dsw-radius-lg=16px）',
    radiusTokens?.md === '12px' && radiusTokens?.lg === '16px',
    JSON.stringify(radiusTokens),
  )

  // 入口按钮不该再挂浏览器原生 title：原生提示框是直角 + 系统描边，和官方主题不一致
  // （用户报的「你的选中框和别人的不一样」就出在这里）。
  const entryNative = await evaluate(
    client,
    `(() => {
       const b = document.querySelector('.dshpm-entry');
       return b ? { title: b.getAttribute('title'), aria: b.getAttribute('aria-label') } : null;
     })()`,
  )
  expect(
    '侧边栏入口不再挂原生 title，但保留 aria-label（可访问名没丢）',
    !!entryNative && entryNative.title === null && /插件市场|Plugin Market/.test(String(entryNative.aria)),
    JSON.stringify(entryNative),
  )

  // 悬停入口：官方 Tooltip 会渲染一个 role="tooltip" 的气泡节点——原生 title 不会，
  // 所以这一个节点就是「换了官方组件」的直接证据（delayMs=500，要等）。
  // 「先移开再移进来」是必须的：CDP 的虚拟指针默认停在别处，只有一次 mouseMoved
  // 不保证触发 mouseenter，气泡就一直不出来（第一版就是这么假红的）。
  const entryBox = await evaluate(
    client,
    `(() => {
       const b = document.querySelector('.dshpm-entry');
       if (!b) return null;
       const r = b.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), vw: window.innerWidth, vh: window.innerHeight };
     })()`,
  )
  let bubble = null
  let hoverDebug = null
  if (entryBox) {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, buttons: 0 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: entryBox.x, y: entryBox.y, buttons: 0 })
    for (let i = 0; i < 25; i += 1) {
      bubble = await evaluate(
        client,
        `(() => {
           const t = document.querySelector('[role="tooltip"]');
           if (!t) return null;
           return { text: t.textContent.trim(), radius: getComputedStyle(t).borderTopLeftRadius, side: t.dataset.side ?? null };
         })()`,
      )
      if (bubble) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!bubble) {
      // 假红排障用：拿到那一刻指针底下究竟是谁
      hoverDebug = await evaluate(
        client,
        `(() => {
           const el = document.elementFromPoint(${entryBox.x}, ${entryBox.y});
           return {
             at: [${entryBox.x}, ${entryBox.y}],
             vp: [${entryBox.x} < window.innerWidth, ${entryBox.y} < window.innerHeight],
             hit: el ? el.className || el.tagName : null,
             isEntry: !!(el && el.closest && el.closest('.dshpm-entry')),
           };
         })()`,
      )
    }
  }
  expect(
    '悬停侧边栏入口出现**官方** Tooltip 气泡（role=tooltip，文案「打开插件市场」）',
    !!bubble && /打开插件市场|Open the plugin market/.test(String(bubble.text)),
    `bubble=${JSON.stringify(bubble)} hover=${JSON.stringify(hoverDebug)} entry=${JSON.stringify(entryBox)}`,
  )
  expect(
    '官方气泡是**圆角**的、且带官方定位逻辑（data-side=right；原生 title 两者都没有）',
    !!bubble && parseFloat(String(bubble.radius)) >= 4 && bubble.side === 'right',
    JSON.stringify(bubble),
  )

  // 卡片圆角放在最后量（面板要打开才有卡片；而上面刚重载过，面板是关着的）。
  await evaluate(client, `document.querySelector('.dshpm-entry').click(); true`)
  await waitFor(client, `!!document.querySelector('.dshpm-root')`, 20000, '面板重新打开（量卡片圆角）')
  await waitFor(client, `document.querySelector('.dshpm-card') !== null`, 30000, '发现页卡片（量圆角前）')
  const cardRadius = await evaluate(
    client,
    `(() => {
       const c = document.querySelector('.dshpm-card');
       if (!c) return null;
       const s = getComputedStyle(c);
       return { tl: s.borderTopLeftRadius, tr: s.borderTopRightRadius, bl: s.borderBottomLeftRadius, br: s.borderBottomRightRadius };
     })()`,
  )
  expect(
    '发现页卡片四角都是「大圆角」16px（用 --dsw-radius-lg，不再是小圆角）',
    !!cardRadius && ['tl', 'tr', 'bl', 'br'].every((k) => cardRadius[k] === '16px'),
    JSON.stringify(cardRadius),
  )

  console.log('\n[13] 语言跟随官方 harness')
  // 官方 GUI 没有语言切换入口，而官方 locale 的初值取自浏览器语言列表
  // （dsh-client-locale: detectBrowserLocale(locales, languages)）。所以覆盖浏览器语言
  // 就是驱动同一段代码的合法方式。
  // 注意两个坑（都实测过）：
  //   · Emulation.setLocaleOverride **改不动** navigator.language（仍是 zh-CN），必须用
  //     setUserAgentOverride 的 acceptLanguage；
  //   · 只覆盖语言**不会**立刻改变已渲染的界面，要重新加载才走初始解析。
  const readEntry = async (label) =>
    evaluate(
      client,
      `(() => {
         const e = document.querySelector('.dshpm-entry');
         return { label: ${JSON.stringify(label)}, entry: e ? e.textContent.trim() : null, htmlLang: document.documentElement.lang || null, navLang: navigator.language };
       })()`,
    )

  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '中文态入口')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const zhState = await readEntry('zh')

  await client.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptLanguage: 'en-US,en;q=0.9',
  })
  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '英文态入口')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const enState = await readEntry('en')

  // 对照组：官方 harness 自己的界面语言必须先跟着变。它不变就说明「没驱动起来」，
  // 那时市场是中文并不算缺陷——这条断言把这两种情况分开，避免假红。
  expect(
    '前置条件：覆盖浏览器语言后官方 harness 自己切到了英文（htmlLang 变了，证明驱动生效）',
    zhState?.htmlLang !== enState?.htmlLang && /^en/i.test(String(enState?.htmlLang)) && /^zh/i.test(String(zhState?.htmlLang)),
    `zh=${JSON.stringify(zhState)} en=${JSON.stringify(enState)}`,
  )
  expect(
    '语言跟随官方 harness：中文态显示「插件市场」',
    /插件市场/.test(String(zhState?.entry)),
    JSON.stringify(zhState),
  )
  expect(
    '语言跟随官方 harness：harness 变英文后市场也变「Plugin Market」（不是自己的一套语言）',
    /Plugin Market/i.test(String(enState?.entry)),
    JSON.stringify(enState),
  )

  // ── [14] 列表底栏：摘要与翻页器凑成一组、整体靠右 ────────────────────────
  // 用户报的是**布局**问题，前后两次、方向一致：
  //   ·「共 N 个结果 · 第 1/M 页」原来在网格上方、分页器在下方 → 合成一行；
  //   · 合成后又用 space-between 把摘要甩到最左边，页码与翻页按钮隔着一整行 →
  //     要求「和分页器放一起，不然不直观地看到当前在第几页」。
  // 所以量的是真实几何：摘要右边缘要**紧邻**分页器左边缘，且整组贴右。
  // 不量「源码里有没有这个 class」——class 在而位置不对，正是这几次要修的东西。
  console.log('\n[14] 列表底栏：摘要紧邻翻页器、整组靠右')
  // 用 fixture 钉死「多页」这个前提（真实目录有 189 页，但不能指望网络）。
  catalogProbe = true
  // [13] 把浏览器语言覆盖成了 en-US；这里设回去，让断言面对中文观感。
  // 文案断言本身仍兼容英文（见下），避免依赖这个覆盖一定生效。
  await client.send('Emulation.setUserAgentOverride', { userAgent: '', acceptLanguage: 'zh-CN,zh;q=0.9' })
  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '底栏检查：入口')
  await evaluate(client, `document.querySelector('.dshpm-entry').click()`)
  await waitFor(client, `!!document.querySelector('.dshpm-root')`, 30000, '底栏检查：面板挂载')
  await waitFor(
    client,
    `!!document.querySelector('.dshpm-listFooter') && !!document.querySelector('.dshpm-pager')`,
    45000,
    '底栏与分页器出现',
  )
  // 关掉可能压在上面的 DSH 弹窗（否则截图里底栏被挡/看不到），与 [12] 同样的处理。
  await evaluate(
    client,
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(继续|Continue)$/.test(x.textContent.trim())); if (b) { b.click(); return true; } return false; })()`,
  )
  await evaluate(client, dismissApiDialog)
  await new Promise((resolve) => setTimeout(resolve, 300))
  // 底栏在 24 张卡下面，默认在视口外——**先滚进视口再截图**，
  // 否则截图里根本看不到这次要验的东西（第一版就是这么拍出一张没有底栏的图的）。
  await evaluate(
    client,
    `(() => { const f = document.querySelector('.dshpm-listFooter'); if (f && f.scrollIntoView) f.scrollIntoView({ block: 'end' }); return true; })()`,
  )
  await new Promise((resolve) => setTimeout(resolve, 400))

  const footer = await evaluate(
    client,
    `(() => {
       const footer = document.querySelector('.dshpm-listFooter');
       const summary = document.querySelector('.dshpm-listSummary');
       const pager = document.querySelector('.dshpm-pager');
       const prev = [...document.querySelectorAll('.dshpm-pager button')].find(b => /上一页|Previous/.test(b.textContent || ''));
       const next = [...document.querySelectorAll('.dshpm-pager button')].find(b => /下一页|Next/.test(b.textContent || ''));
       if (!footer || !summary || !pager) return { missing: { footer: !!footer, summary: !!summary, pager: !!pager } };
       const f = footer.getBoundingClientRect(), s = summary.getBoundingClientRect(), p = pager.getBoundingClientRect();
       // 网格顶边：用来证明摘要**不再**在列表上方（它原来就挂在网格上方）
       const grid = document.querySelector('.dshpm-grid');
       const g = grid ? grid.getBoundingClientRect() : null;
       return {
         footer: { top: Math.round(f.top), bottom: Math.round(f.bottom), left: Math.round(f.left), right: Math.round(f.right), width: Math.round(f.width) },
         padRight: Math.round(parseFloat(getComputedStyle(footer).paddingRight) || 0),
         summary: { top: Math.round(s.top), bottom: Math.round(s.bottom), left: Math.round(s.left), right: Math.round(s.right), text: summary.textContent.trim() },
         pager: { top: Math.round(p.top), bottom: Math.round(p.bottom), left: Math.round(p.left), right: Math.round(p.right) },
         grid: g ? { top: Math.round(g.top), bottom: Math.round(g.bottom) } : null,
         prev: prev ? prev.textContent.trim() : null,
         next: next ? next.textContent.trim() : null,
         // 摘要是否在网格**上方**（修复前为 true，修复后必须 false）
         summaryAboveGrid: g ? (s.bottom <= g.top) : null,
         viewportWidth: window.innerWidth,
       };
     })()`,
  )
  const f = footer?.footer
  const s = footer?.summary
  const p = footer?.pager
  expect(
    '底栏里同时有结果摘要和分页器（两者在同一个 .dshpm-listFooter 里）',
    !!f && !!s && !!p,
    JSON.stringify(footer),
  )
  expect(
    '摘要挪到了列表下方（不再挂在网格上方，页码不再重复出现两处）',
    footer?.summaryAboveGrid === false,
    JSON.stringify({ summaryAboveGrid: footer?.summaryAboveGrid, summary: s, grid: footer?.grid }),
  )
  expect(
    '摘要与上下页按钮在同一行（垂直方向重叠，不是上下两行）',
    !!s && !!p && Math.min(s.bottom, p.bottom) - Math.max(s.top, p.top) > 0,
    JSON.stringify({ summary: s, pager: p }),
  )
  expect(
    '摘要与翻页器**凑在一起**（摘要右边缘紧邻分页器左边缘，间距就是底栏 gap）',
    // 用户两次要求的方向：页码要挨着翻页按钮，眼睛不用在整行两端来回找。
    // 所以量的是「摘要右边缘 → 分页器左边缘」的距离，必须是一个小间距（gap 的量级），
    // 而不是被 space-between 甩到两端那种一整行的距离。
    !!s && !!p && (p.left - s.right) >= 0 && (p.left - s.right) <= 24,
    JSON.stringify({ summaryRight: s?.right, pagerLeft: p?.left, gap: s && p ? p.left - s.right : null, summary: s, pager: p }),
  )
  expect(
    '摘要不再被甩到行首（不再是 space-between 那种两端分布）',
    !!f && !!s && (s.left - f.left) > 100,
    JSON.stringify({ footerLeft: f?.left, summaryLeft: s?.left, distanceFromLeft: f && s ? s.left - f.left : null }),
  )
  expect(
    '上下页按钮靠右：按钮组右边缘贴底栏**内容**右边缘（修复前是左对齐跟着摘要走）',
    // 注意比的是**内容盒**右边缘，不是 border-box：底栏有 padding-right（让开右下角的
    // 「回到顶部」圆钮，见 .dshpm-listFooter 注释），拿 border-box 比会差那 40px。
    !!f && !!p && Math.abs(p.right - (f.right - footer.padRight)) <= 2,
    JSON.stringify({ footerRight: f?.right, padRight: footer?.padRight, contentRight: f && footer ? f.right - footer.padRight : null, pagerRight: p?.right }),
  )
  expect(
    '摘要里带总数与页码（用户看到的「共 N 个结果 · 第 x/y 页」）',
    !!s && (/共\s*[\d,]+\s*个结果/.test(String(s.text)) || /[\d,]+\s*results/i.test(String(s.text)))
      && (/第\s*\d+\/\d+\s*页/.test(String(s.text)) || /page\s*\d+\/\d+/i.test(String(s.text))),
    JSON.stringify(s?.text),
  )
  expect(
    '翻页按钮就在摘要同一行里（上一页/下一页都在）',
    !!footer?.prev && !!footer?.next,
    JSON.stringify({ prev: footer?.prev, next: footer?.next }),
  )
  // 页码只在**摘要**里出现一次。第一版把摘要挪进底栏后，翻页按钮中间还留着旧的
  // 「第 x/y 页」，于是同一行里页码写了两遍——截图才暴露出来。这条断言钉的就是它。
  const footerText = await evaluate(
    client,
    `(() => { const f = document.querySelector('.dshpm-listFooter'); return f ? f.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  )
  const pageMentions = (String(footerText).match(/第\s*\d+\/\d+\s*页|page\s*\d+\/\d+/gi) || []).length
  expect(
    '页码在底栏里只出现一次（摘要里），翻页按钮不再重复一遍',
    pageMentions === 1,
    JSON.stringify({ footerText, pageMentions }),
  )
  await screenshot(client, join(shotDir, 'market-list-footer.png'))
  console.log(`  · 截图：${join(shotDir, 'market-list-footer.png')}`)

  // ── 单页结果：底栏必须**照旧存在**（只有翻页按钮消失）────────────────────
  // 这条是突变测试逼出来的：把 e2e 只跑多页（189 页）时，「底栏总是渲染」这句在代码
  // 注释里写得斩钉截铁，却**从来没有被验证过**——把 `if (pages <= 1) return null;` 塞进去
  // 照样全绿。结果总数原来挂在网格上方，对任意页数都可见；挪进底栏后不能因此消失。
  await evaluate(
    client,
    `(() => { const i = document.querySelector('.dshpm-root input[type=search], .dshpm-root input'); if (!i) return false;
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '@fixture/no-such-plugin-zzz');
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true; })()`,
  )
  await waitFor(
    client,
    `(() => { const f = document.querySelector('.dshpm-listFooter'); return !!f && !document.querySelector('.dshpm-pager'); })()`,
    20000,
    '单页结果（分页器消失）',
  )
  const single = await evaluate(
    client,
    `(() => {
       const f = document.querySelector('.dshpm-listFooter');
       const s = document.querySelector('.dshpm-listSummary');
       return {
         footer: !!f, pager: !!document.querySelector('.dshpm-pager'),
         summary: s ? s.textContent.replace(/\\s+/g, ' ').trim() : null,
         cards: document.querySelectorAll('.dshpm-card').length,
       };
     })()`,
  )
  expect(
    '单页结果时底栏仍在（结果总数不因「不需要翻页」而消失），只有翻页按钮隐藏',
    single?.footer === true && single?.pager === false && Number(single?.cards) === 0,
    JSON.stringify(single),
  )
  expect(
    '单页时摘要给出「没有结果」而不是页码（此时没有页可翻）',
    /没有结果|No results/i.test(String(single?.summary)),
    JSON.stringify(single),
  )

  // ── [15] 右下角「回到顶部」：能用，且不压住别人 ──────────────────────────
  // 用户要求：「在页面右下角做一个类似网站那种返回顶层的按钮，不要影响可用的交互系统」。
  // 后半句是重点，所以这一组除了「点了能回顶」，还必须证明**没盖住分页器**——
  // 「下一页」就长在右下角，两者算起来会横向重叠（实测过），那是真的会点不到。
  //
  // 只量几何、**不碰 DOM**：这一轮我先试过「删掉宿主引导弹窗的遮罩再量命中」，
  // 结果删掉的是 DSH 应用根（z-index:1000 的 fixed 全屏元素），elementFromPoint
  // 从此只返回 BODY——那种数据是废的，还会把后面的断言一起带偏。重叠与否几何就能定论。
  console.log('\n[15] 右下角「回到顶部」：能用且不遮挡分页器')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 980, deviceScaleFactor: 1, mobile: false })
  // 关键前置：上一段（[14] 单页）把搜索框留在了「查一个不存在的插件」，列表是空的，
  // root 根本没有可滚内容 —— 那样 scrollTop 永远是 0，回顶按钮也不会出现（第一版就是这么红的）。
  // 先清空搜索、回到有 189 页的真实目录，并等卡片真的渲染出来。
  await evaluate(
    client,
    `(() => {
       const i = document.querySelector('.dshpm-root input[type=search], .dshpm-root input');
       if (!i) return false;
       const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       s.call(i, '');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
       return true;
     })()`,
  )
  await waitFor(client, `document.querySelectorAll('.dshpm-card').length > 0`, 30000, '[15] 目录卡片回来')
  await waitFor(
    client,
    `(() => { const r = document.querySelector('.dshpm-root'); return !!r && r.scrollHeight > r.clientHeight + 200; })()`,
    20000,
    '[15] 面板可滚动',
  )
  await evaluate(client, `(() => { const r = document.querySelector('.dshpm-root'); if (r) r.scrollTop = 0; return true; })()`)
  await new Promise((resolve) => setTimeout(resolve, 500))

  const topAbsent = await evaluate(client, `!document.querySelector('[data-top-btn]')`)
  expect('未滚动时不显示「回到顶部」（不常驻占着右下角）', topAbsent === true, JSON.stringify({ topAbsent }))

  // 先滚到「按钮可见」的位置拍一张：上面那条断言之后按钮就没了，
  // 只在结尾截图的话，图里看不到这次要验的东西（第一版就是这样拍了个空）。
  await evaluate(client, `(() => { const r = document.querySelector('.dshpm-root'); if (r) r.scrollTop = 700; return true; })()`)
  await waitFor(client, `!!document.querySelector('[data-top-btn]')`, 8000, '[15] 回顶按钮出现')
  await screenshot(client, join(shotDir, 'market-back-to-top-visible.png'))
  console.log(`  · 截图：${join(shotDir, 'market-back-to-top-visible.png')}（按钮可见时）`)
  await evaluate(client, `(() => { const r = document.querySelector('.dshpm-root'); if (r) r.scrollTop = 0; return true; })()`)
  await new Promise((resolve) => setTimeout(resolve, 400))

  const top = await evaluate(
    client,
    `(async () => {
       const root = document.querySelector('.dshpm-root');
       const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
       const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
         return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };

       // 滚过阈值（400px）让它出现
       root.scrollTop = 600; await sleep(300);
       const btn = document.querySelector('[data-top-btn]');
       const wrap = document.querySelector('.dshpm-top');
       const shown = !!btn;

       // 滚到底：分页器进入视口，量两者会不会横向相压
       root.scrollTop = root.scrollHeight; await sleep(400);
       const pager = document.querySelector('.dshpm-pager');
       const nextBtn = [...document.querySelectorAll('.dshpm-pager button')].find(b => /下一页|Next/.test(b.textContent || ''));
       const btnR = rect(btn), pagerR = rect(pager), nextR = rect(nextBtn);
       const overlapsX = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right;

       const result = {
         shown, btn: btnR, pager: pagerR,
         wrapPosition: wrap ? getComputedStyle(wrap).position : null,
         wrapZ: wrap ? getComputedStyle(wrap).zIndex : null,
         btnVsPager: overlapsX(btnR, pagerR),
         btnVsNext: overlapsX(btnR, nextR),
         noticeZ: getComputedStyle(document.documentElement).getPropertyValue('--dsw-focus-ring-width').trim() || null,
         beforeClick: root.scrollTop,
       };

       // 点它：滚动位置应回到 0，且按钮随之消失（< 阈值）
       if (btn) { btn.click(); await sleep(1200); }
       result.afterClick = root.scrollTop;
       result.btnGoneAfterScroll = !document.querySelector('[data-top-btn]');
       return result;
     })()`,
  )
  expect(
    '滚动超过阈值后出现「回到顶部」（右下角固定悬浮）',
    top?.shown === true && top?.wrapPosition === 'fixed',
    JSON.stringify({ shown: top?.shown, position: top?.wrapPosition, btn: top?.btn }),
  )
  expect(
    '「回到顶部」浮在通知条/弹窗层之下（z-index 低于 60，不去压必须点的东西）',
    Number(top?.wrapZ) > 0 && Number(top?.wrapZ) < 60,
    JSON.stringify({ wrapZ: top?.wrapZ }),
  )
  expect(
    '「回到顶部」与分页器**不横向重叠**（不压住「下一页」——用户要的「不影响交互」）',
    top?.btnVsPager === false && top?.btnVsNext === false,
    JSON.stringify({ btnVsPager: top?.btnVsPager, btnVsNext: top?.btnVsNext, btn: top?.btn, pager: top?.pager }),
  )
  expect(
    '点「回到顶部」后滚动位置真的回到 0',
    Number(top?.beforeClick) > 400 && Number(top?.afterClick) === 0,
    JSON.stringify({ before: top?.beforeClick, after: top?.afterClick }),
  )
  expect(
    '回到顶部后按钮自己消失（回到阈值以下不再占位）',
    top?.btnGoneAfterScroll === true,
    JSON.stringify({ gone: top?.btnGoneAfterScroll }),
  )
  await screenshot(client, join(shotDir, 'market-back-to-top.png'))
  console.log(`  · 截图：${join(shotDir, 'market-back-to-top.png')}`)

  // ── [16] 点「下一页」自动回到列表顶部（用户要求）─────────────────────────
  // 为什么只给翻页做、而不给搜索/排序/分类做：分页器长在列表**最底部**，点完「下一页」
  // 时用户正看着新页的**末尾**，最想看的第一条在屏幕外上方；而搜索/排序/分类的控件在
  // **顶部**——能点到它们就说明人已经在顶部了，再滚一次是白做。
  // 所以这条测的是「在底部点下一页 ⇒ 回到顶部」，并且**页码真的变了**（否则滚到 0
  // 也可能只是因为它压根没翻页）。
  console.log('\n[16] 点「下一页」自动回顶')
  try {
    const paging = await evaluate(
      client,
      `(async () => {
         const root = document.querySelector('.dshpm-root');
         const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
         const summaryText = () => {
           const s = document.querySelector('.dshpm-listSummary');
           return s ? (s.textContent || '').trim() : '';
         };
         // 先把上一段留在「回到顶部」的位置复位，并确保处于第 1 页。
         root.scrollTop = 0; await sleep(300);
         // 滚到底：分页器进视口（用户真实的操作姿势）
         root.scrollTop = root.scrollHeight; await sleep(400);
         const before = { scrollTop: root.scrollTop, summary: summaryText() };
         const nextBtn = [...document.querySelectorAll('.dshpm-pager button')]
           .find(b => /下一页|Next/.test(b.textContent || ''));
         if (!nextBtn) return { ok: false, why: 'no next button', before };
         const disabled = nextBtn.disabled === true;
         if (disabled) return { ok: false, why: 'next disabled', before };
         nextBtn.click();
         await sleep(1500);
         const after = { scrollTop: root.scrollTop, summary: summaryText() };
         // 顶部必须是**真的列表顶部**：头部（标题/搜索）应该回到视口内。
         const head = document.querySelector('.dshpm-header');
         const headTop = head ? Math.round(head.getBoundingClientRect().top) : null;
         const rootTop = Math.round(root.getBoundingClientRect().top);
         return {
           ok: true, before, after,
           scrolledToTop: after.scrollTop === 0,
           pageChanged: before.summary !== after.summary,
           headerVisibleNearTop: headTop !== null && (headTop - rootTop) < 200,
         };
       })()`,
    )
    expect(
      '分页器就在底部（前置条件：点它时确实离家很远）',
      paging?.ok === true && Number(paging?.before?.scrollTop) > 400,
      JSON.stringify(paging),
    )
    expect(
      '点「下一页」后滚动位置真的回到 0（不用自己往回滚一整页）',
      paging?.scrolledToTop === true,
      JSON.stringify({ before: paging?.before, after: paging?.after }),
    )
    expect(
      '点「下一页」真的换了页（不是「滚到 0 但没翻页」）',
      paging?.pageChanged === true,
      JSON.stringify({ before: paging?.before?.summary, after: paging?.after?.summary }),
    )
    expect(
      '回到顶部后列表头部（标题/搜索）在视口内，而不只是 scrollTop 数值归零',
      paging?.headerVisibleNearTop === true,
      JSON.stringify({ headerVisibleNearTop: paging?.headerVisibleNearTop }),
    )
    await screenshot(client, join(shotDir, 'market-pager-back-to-top.png'))
    console.log(`  · 截图：${join(shotDir, 'market-pager-back-to-top.png')}`)
    // 把量到的原始数值也打出来：失败时它就是证据，成功时它能证明这些数字**不是**恒真
    // （例如 scrollTop 真的从 1500+ 变成 0、摘要真的从「第 1/189 页」变成「第 2/189 页」）。
    console.log(`  · 实测：scrollTop ${paging?.before?.scrollTop} → ${paging?.after?.scrollTop}`
      + `；摘要「${paging?.before?.summary}」→「${paging?.after?.summary}」`
      + `；头部离容器顶 ${paging?.headerVisibleNearTop} = true`)
  } catch (error) {
    expect('[16] 点「下一页」回顶 未抛异常', false, error.message)
  }

  // ── [17] 「已安装」页：结构上做不到的开关/卸载应当**不渲染** ───────────────
  // 用户要求：「隐藏已安装下的 开关或卸载 不可以的项目」。
  // 这一组用注入的 /installed 造出四种包，逐个断言"该隐藏的没渲染、该在的还在"——
  // 光断言"某个按钮 disabled"是不够的：用户要的是**它不出现**。
  //
  // 反向对照同样重要：普通包必须**仍然**有开关和卸载。只测"隐藏"的话，
  // 把整行按钮全删掉也能全绿——那是把功能做没了还能过的测试。
  console.log('\n[17] 已安装页：不可以的开关/卸载不渲染')
  try {
    await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
    // 注入 6 个包，其中 @fixture/managed-by-host 会被**整卡藏掉**（见 v1.3.0 的
    // shouldHideInstalledCard），所以实际渲染 5 行。这里等的是"注入已生效"，
    // 不是"6 行都在"——写 >=6 会永远等不到（第一版就是这么假红的）。
    await waitFor(client, `document.querySelectorAll('.dshpm-row').length >= 5`, 8000, '[17] 已安装页渲染出注入的包')

    const caps = await evaluate(
      client,
      `(() => {
         const rows = Array.from(document.querySelectorAll('.dshpm-row'));
         const find = (name) => rows.find(r => {
           const n = r.querySelector('.dshpm-rowName');
           return n && n.textContent.trim() === name;
         });
         const describe = (name) => {
           const row = find(name);
           if (!row) return null;
           const actions = row.querySelector('.dshpm-rowActions');
           return {
             switches: actions ? actions.querySelectorAll('.dshpm-switch').length : -1,
             buttons: actions ? Array.from(actions.querySelectorAll('button')).map(b => b.textContent.trim()) : [],
             // **所有** .dshpm-rowMeta，不是第一个：说明文字是**另一个** rowMeta 节点
             // （第一行放装载行数，第二行放"为什么这个动作被隐藏"）。
             // 只取 querySelector 会读到第一行，于是这条断言永远看不到原因——第一版就是这样假红的。
             meta: Array.from(row.querySelectorAll('.dshpm-rowMeta')).map(n => n.textContent.trim()).join(' | '),
           };
         };
         return {
           normal: describe('@fixture/needs-update'),
           managed: describe('@fixture/managed-by-host'),
           notRemovable: describe('@fixture/not-removable'),
           noEntryId: describe('@fixture/no-entry-id'),
           market: describe('deepseek-harness-market'),
         };
       })()`,
    )

    // ① 普通包：开关 + 卸载都必须**在**（否则"隐藏"就是把功能删了）
    expect(
      '普通包仍然有开关和卸载（反向对照：不能把按钮全删了还叫通过）',
      caps?.normal?.switches === 1
        && caps.normal.buttons.some((b) => /卸载|Uninstall/.test(b)),
      JSON.stringify(caps?.normal),
    )
    // ② 宿主托管：开关与卸载都做不到 ⇒ **整张卡片都不渲染**（v1.3.0 用户要求）
    expect(
      '宿主基础设施托管的包：整张卡片都不渲染（开关与卸载都做不到）',
      caps?.managed === null,
      JSON.stringify(caps?.managed),
    )
    // ③ 不可移除：卡片**必须还在**（它还能开关）。这条是"别隐藏过头"的守门人：
    //    只测"该藏的藏了"的话，把所有卡片都藏掉也能全绿。
    expect(
      '宿主说不可移除的包：卡片仍在、开关仍在、只有卸载不渲染（三者是不同能力）',
      caps?.notRemovable !== null
        && caps.notRemovable.switches === 1
        && !caps.notRemovable.buttons.some((b) => /卸载|Uninstall/.test(b)),
      JSON.stringify(caps?.notRemovable),
    )
    // ④ 市场自身：卡片**仍在**（能开关），只有卸载不在
    expect(
      '市场自己那一行：卡片仍在、卸载不渲染（市场不能卸载自己，但它能被停用）',
      caps?.market !== null
        && caps.market.switches === 1
        && !caps.market.buttons.some((b) => /卸载|Uninstall/.test(b)),
      JSON.stringify(caps?.market),
    )
    // ⑤ 隐藏了动作就必须**在同一行说明原因**——否则用户只看到"东西不见了"
    expect(
      '被隐藏的动作在同一行给出原因（不能只是「按钮没了」）',
      /不能卸载自己|市场不能卸载自己/.test(String(caps?.market?.meta))
        && String(caps?.notRemovable?.meta).length > 0,
      JSON.stringify({ marketMeta: caps?.market?.meta, notRemovableMeta: caps?.notRemovable?.meta }),
    )
    // ⑥ 藏了卡片，摘要的数字就**必须等于实际渲染的行数**。这才是不变量：
    //    只断言"摘要里出现了'已隐藏'字样"是不够的——那句话与计数是两个独立的表达式，
    //    把计数改回 bundles.length 时那句话照样在，断言会漏（变异体 V4 就是这么活的）。
    //    所以直接拿"摘要里的数字"和"DOM 里的行数"比。
    const counts = await evaluate(
      client,
      `(() => {
         const s = document.querySelector('.dshpm-summary');
         const text = s ? s.textContent.trim() : '';
         // 「共 N 个插件」/「N plugins」：抓第一段数字
         const m = text.match(/(\\d+)/);
         return { text, summaryCount: m ? Number(m[1]) : null, rows: document.querySelectorAll('.dshpm-row').length };
       })()`,
    )
    expect(
      '摘要里的数字等于实际渲染的行数（藏了卡片就不能再说总数）',
      counts?.summaryCount !== null && counts.summaryCount === counts.rows,
      JSON.stringify(counts),
    )
    expect(
      '摘要如实说明有卡片被隐藏（差额写在明面上）',
      /已隐藏|hidden/.test(String(counts?.text)),
      JSON.stringify({ summary: counts?.text }),
    )
    console.log(`  · 实测：普通 switches=${caps?.normal?.switches} 按钮=${JSON.stringify(caps?.normal?.buttons)}`)
    console.log(`          托管 整卡是否渲染=${caps?.managed !== null}（期望 false）`)
    console.log(`          不可移除 switches=${caps?.notRemovable?.switches} 按钮=${JSON.stringify(caps?.notRemovable?.buttons)}`)
    console.log(`          市场自身 switches=${caps?.market?.switches} 按钮=${JSON.stringify(caps?.market?.buttons)}`)
    console.log(`          摘要=「${counts?.text}」，数字 ${counts?.summaryCount} vs 行数 ${counts?.rows}`)
    await screenshot(client, join(shotDir, 'market-installed-hidden-actions.png'))
    console.log(`  · 截图：${join(shotDir, 'market-installed-hidden-actions.png')}`)
  } catch (error) {
    expect('[17] 已安装页隐藏不可以的动作 未抛异常', false, error.message)
  }

  // ── [18] 全局只读（宿主没有 pluginManager）时**绝不隐藏任何卡片** ──────────
  // 守的是 shouldHideInstalledCard 的第一行豁免。没有它的话，`readOnly=true` 让每个包
  // 都"不可操作"，按字面规则会把整页藏空——而那种情况下页面**唯一还有价值的东西**
  // 就是「这个 profile 装了什么」这份清单。
  //
  // 为什么必须单独构造：正常路径下拿不到这个形状（`/installed` 在宿主真没有管理器时
  // 自己返回空列表，界面到不了过滤器）。这里用探针让 /status 说"没有管理器"、
  // 而 /installed 仍回内容——对应真实世界里"状态是早先读到的、列表是之后拉到的"
  // （本仓库 index.js 自己就写着「宿主服务可能比本插件晚注册」）。
  console.log('\n[18] 全局只读时不隐藏卡片（豁免真的生效）')
  try {
    noManagerProbe = true
    await client.send('Page.navigate', { url: authUrl })
    // 重载后**必须先点侧边栏入口**面板才会挂载：`.dshpm-root` 不是默认就存在的
    // （第一版直接等它，于是永远等不到、超时假红）。顺序与本文件其它重载段落一致：
    // 等入口 → 关掉壳的配置对话框 → 点入口 → 再等面板。
    await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '[18] 重载后的侧边栏入口')
    await evaluate(client, dismissApiDialog)
    await evaluate(client, `document.querySelector('.dshpm-entry').click(); true`)
    await waitFor(client, `!!document.querySelector('.dshpm-root')`, 20000, '[18] 面板挂载')
    // 全局只读时市场顶部会亮「只能浏览」的横幅——先确认探针真的生效了，
    // 否则下面的断言可能在测一个根本没进入只读态的场景（假绿）。
    await waitFor(client, `!!document.querySelector('.dshpm-banner')`, 15000, '[18] 只读横幅出现')
    await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
    await waitFor(client, `document.querySelectorAll('.dshpm-row').length >= 5`, 15000, '[18] 已安装页渲染出注入的包')

    const readOnlyView = await evaluate(
      client,
      `(() => {
         const rows = document.querySelectorAll('.dshpm-row');
         const names = Array.from(rows).map(r => {
           const n = r.querySelector('.dshpm-rowName');
           return n ? n.textContent.trim() : '';
         });
         const switches = document.querySelectorAll('.dshpm-row .dshpm-switch').length;
         const s = document.querySelector('.dshpm-summary');
         return { rows: rows.length, names, switches, summary: s ? s.textContent.trim() : '' };
       })()`,
    )
    // 注入 6 个包；正常态下托管那个被藏（→5 行）。只读态**一个都不该藏**（→6 行）。
    expect(
      '宿主没有 pluginManager 时，被宿主托管的卡片也照常渲染（豁免生效，没有整页藏空）',
      readOnlyView?.rows === 6,
      JSON.stringify(readOnlyView),
    )
    expect(
      '只读态下并没有凭空多出可点的开关（豁免只是"显示"，不是"解锁"）',
      readOnlyView?.switches === 0,
      JSON.stringify({ switches: readOnlyView?.switches }),
    )
    console.log(`  · 实测：只读态渲染 ${readOnlyView?.rows} 行（正常态 5 行）、开关 ${readOnlyView?.switches} 个`)
    console.log(`          摘要=「${readOnlyView?.summary}」`)
    await screenshot(client, join(shotDir, 'market-installed-readonly-no-hide.png'))
    noManagerProbe = false
    // 还原成正常态，别把只读探针留给后面的断言（同样要走"等入口 → 点入口"这套）。
    await client.send('Page.navigate', { url: authUrl })
    await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '[18] 还原：侧边栏入口')
    await evaluate(client, dismissApiDialog)
    await evaluate(client, `document.querySelector('.dshpm-entry').click(); true`)
    await waitFor(client, `!!document.querySelector('.dshpm-root')`, 20000, '[18] 还原：面板挂载')
  } catch (error) {
    noManagerProbe = false
    expect('[18] 全局只读豁免 未抛异常', false, error.message)
  }
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
