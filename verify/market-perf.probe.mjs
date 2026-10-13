/**
 * 渲染成本探针（真实浏览器 / CDP）——**手动跑，不在门禁里**。
 *
 * ⚠️ 这个文件存在的理由是「防止一次没数据支撑的优化」。它记录的是：
 * 对着上游 dshmarket 做代码统计时，我们曾据「0 个 useMemo / 0 个 useCallback」推断
 * 「每次击键整页重渲」是个性能问题。实测量完之后，这个推断**不成立**：
 *
 *   击键 dispatchEvent 同步耗時   p50 = 0.6ms   （基线 0ms；分辨力证明 1.5ms）
 *   20 次击键挤在一起              = 7.1ms
 *   点开市场 → 24 张卡首挂          = 22.7ms（一次性）
 *   排序 change（重渲整页列表）     p50 = 1.0ms
 *   分类 chip / 页签点击            p50 = 0ms
 *
 * 一帧预算 16.6ms，最重的交互 1.0ms、最频繁的击键 0.6ms——都在噪声附近。
 * 另外两边**都没有 memo**（上游 useMemo=34/useCallback=97，但 memo=0；我们全 0），
 * 而没有 memo 包住子组件时 useMemo/useCallback 换不来重渲减少。
 * 所以结论是：**不做这些优化**。要做也得先有实测数据说它慢。
 *
 * ── 测量方法（两点必须照做，否则测出来的数不能用）────────────────────
 *
 * 1) 用**同步计时**，不要用 requestAnimationFrame 计时。
 *    rAF 被帧对齐量化：空转一帧的 p50 就是 16.6ms（min 0.2ms，双峰），
 *    往里烧 20ms 也只涨 3.6ms。用 rAF 只会得到「恰好一帧」这个没有信息量的数，
 *    它会同时兼容「重渲很便宜」和「根本没测出来」两种相反的结论。
 *    React 18 对 `input`（discrete event）**同步冲刷**更新，所以把计时套在
 *    `dispatchEvent` 前后，拿到的就是这次交互真正的 render+reconcile+commit 耗时。
 *
 * 2) 每次都必须带**分辨力证明**（下面 proof 段）：同一计时口径下做一段已知工作，
 *    确认这个口径量得出耗时（经验阈值：proof > baseline × 5）。分辨力不成立的数，
 *    无论多好看，都不能用来下结论。
 *
 * 用法：node verify/market-perf.probe.mjs <带 token 的首页 URL>
 *   （authUrl 由 verify/ui-check.ps1 起 scratch 宿主后从 host-*.out.log 里取）
 */
import { evaluate, launchBrowser, waitFor } from './lib/cdp.mjs'

const authUrl = process.argv[2]
if (!authUrl) {
  console.error('用法：node verify/market-perf.probe.mjs <带 token 的首页 URL>')
  process.exit(2)
}

const CATALOG = {
  ok: true,
  items: Array.from({ length: 24 }, (_, i) => ({
    name: `@fixture/perf-${i}`,
    description: `性能夹具 ${i}：一段不短不长的描述文案，让卡片渲染有真实分量。`,
    version: '1.0.0', stars: 100 - i, categories: ['dev'], installed: false,
  })),
  page: { page: 1, pages: 1, total: 24 },
  categories: [{ id: 'dev', label: '开发' }],
  catalog: { updatedAt: '2026-10-13T00:00:00Z', count: 24 },
}

const browser = await launchBrowser({ width: 1560, height: 980 })
const { client } = browser
let catalogHits = 0
try {
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Network.enable')
  client.on('Network.requestWillBeSent', (p) => {
    if ((p?.request?.url ?? '').includes('/catalog')) catalogHits += 1
  })
  await client.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*/plugin-market/catalog*', requestStage: 'Request' },
      { urlPattern: '*/plugin-market/installed*', requestStage: 'Request' },
      { urlPattern: '*/plugin-market/status*', requestStage: 'Request' },
    ],
  })
  client.on('Fetch.requestPaused', async (p) => {
    const u = p.request.url
    try {
      let body = { ok: true }
      if (u.includes('/catalog')) body = CATALOG
      else if (u.includes('/installed')) body = { ok: true, bundles: [], plugins: [] }
      else if (u.includes('/status')) body = { ok: true, plugin: { version: '1.2.0' }, manager: { available: true } }
      await client.send('Fetch.fulfillRequest', {
        requestId: p.requestId, responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
      })
    } catch { /* 已放行 */ }
  })

  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, 'document.readyState === "complete"', 60000, '首页加载')
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 30000, '侧栏入口出现')

  // 点开市场 → 24 张卡首挂（含挂载整棵树）
  const mount = await evaluate(client, `(async () => {
    const t0 = performance.now();
    document.querySelector('.dshpm-entry').click();
    const until = performance.now() + 8000;
    while (performance.now() < until) {
      if (document.querySelectorAll('.dshpm-card').length >= 24) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    return { ms: +(performance.now() - t0).toFixed(2), cards: document.querySelectorAll('.dshpm-card').length };
  })()`)

  const r = await evaluate(client, `(async () => {
    const stat = (arr) => { const s = [...arr].sort((a,b)=>a-b);
      return { p50:+s[Math.floor(s.length*0.5)].toFixed(3), p90:+s[Math.floor(s.length*0.9)].toFixed(3), max:+s[s.length-1].toFixed(3) }; };

    // ── 基线：同一计时口径，但不触发 React（派发一个没人听的事件）
    const inert = document.createElement('div'); document.body.appendChild(inert);
    const baseline = [];
    for (let i = 0; i < 20; i += 1) { const t0 = performance.now(); inert.dispatchEvent(new Event('input', { bubbles: true })); baseline.push(performance.now() - t0); }
    inert.remove();

    // ── 分辨力证明：同一口径下造 3000 个节点
    const proof = [];
    for (let i = 0; i < 8; i += 1) {
      const t0 = performance.now();
      const frag = document.createElement('div');
      for (let k = 0; k < 3000; k += 1) { const d = document.createElement('span'); d.textContent = 'x'; frag.appendChild(d); }
      document.body.appendChild(frag); frag.remove();
      proof.push(performance.now() - t0);
    }

    // ── ① 击键（最高频交互）：只改输入框文字，列表不变
    const input = document.querySelector('input[type=search]') || document.querySelector('.dshpm-root input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    const keystroke = [];
    for (let i = 0; i < 20; i += 1) {
      setter.call(input, 'x'.repeat(i + 1));
      const t0 = performance.now();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      keystroke.push(performance.now() - t0);
    }
    // 20 次挤在一起
    const tBurst = performance.now();
    for (let i = 0; i < 20; i += 1) { setter.call(input, 'y'.repeat(i + 1)); input.dispatchEvent(new Event('input', { bubbles: true })); }
    const burst20 = performance.now() - tBurst;

    // ── ② 排序 change（同步重渲整页列表）
    const sel = document.querySelector('.dshpm-root select');
    let sortChange = null, sortOptions = 0;
    if (sel) {
      const opts = [...sel.options].map((o) => o.value);
      const sSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      const arr = [];
      for (let i = 0; i < 8; i += 1) {
        sSetter.call(sel, opts[i % opts.length]);
        const t0 = performance.now();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        arr.push(performance.now() - t0);
      }
      sortChange = stat(arr); sortOptions = opts.length;
    }

    // ── ③ 分类 chip / 页签
    const chips = [...document.querySelectorAll('.dshpm-chips button, .dshpm-chip')];
    let chipClick = null;
    if (chips.length > 1) {
      const arr = [];
      for (let i = 0; i < 8; i += 1) { const t0 = performance.now(); chips[i % chips.length].click(); arr.push(performance.now() - t0); }
      chipClick = stat(arr);
    }
    const tabs = [...document.querySelectorAll('.dshpm-tabs button, [role=tab]')];
    const dTab = tabs.find((b) => /发现|Discover/.test(b.textContent || ''));
    const iTab = tabs.find((b) => /已安装|Installed/.test(b.textContent || ''));
    let tabClick = null;
    if (dTab && iTab) {
      const arr = [];
      for (let i = 0; i < 8; i += 1) { const t0 = performance.now(); (i % 2 === 0 ? iTab : dTab).click(); arr.push(performance.now() - t0); }
      tabClick = stat(arr);
    }

    return { baseline: stat(baseline), proof: stat(proof), keystroke: stat(keystroke), burst20: +burst20.toFixed(2), sortChange, sortOptions, chipClick, chipCount: chips.length, tabClick, cards: document.querySelectorAll('.dshpm-card').length };
  })()`)

  const resolvable = r.proof.p50 > r.baseline.p50 * 5
  console.log('=== 渲染成本探针（真实浏览器，24 张卡）===')
  console.log('  点开市场 → 24 张卡首挂 :', mount.ms, 'ms')
  console.log('')
  console.log('  分辨力证明（3000 节点） :', JSON.stringify(r.proof))
  console.log('  基线（无监听者）        :', JSON.stringify(r.baseline))
  console.log('  分辨力成立              :', resolvable, '（不成立则下面所有数字作废）')
  console.log('')
  console.log('  ① 击键（最高频）        :', JSON.stringify(r.keystroke), ' 净开销 =', (r.keystroke.p50 - r.baseline.p50).toFixed(3), 'ms')
  console.log('     20 次挤在一起        :', r.burst20, 'ms')
  console.log('  ② 排序 change           :', JSON.stringify(r.sortChange), '(' + r.sortOptions + ' 选项)')
  console.log('  ③ 分类 chip             :', JSON.stringify(r.chipClick), '(' + r.chipCount + ' chip)')
  console.log('     页签点击            :', JSON.stringify(r.tabClick))
  console.log('')
  console.log('  参照：一帧预算 16.6ms。最重交互', Math.max(r.sortChange?.p50 ?? 0, r.keystroke.p50), 'ms')
  console.log('  catalog 请求总数 =', catalogHits, '（排序是服务端参数，改排序重抓属预期）')
  if (!resolvable) {
    console.log('')
    console.log('  ⚠️ 分辨力不成立：这次的数字不能用来下结论，别据此改代码。')
    process.exitCode = 3
  }
} finally {
  await browser.close?.()
}
