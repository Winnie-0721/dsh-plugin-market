# TASK-PERF-01c：独立复跑与红线验收

> **验收者身份**：独立验收者（perf-verify），**未参与** task-7 / task-8 的脚本编写。
> 本文所有数字均为本人在本机**重新跑出来**的，独立于作者口径；作者脚本**只读、未修改一个字节**。
> 诚实优先：凡与作者/Lead 报告不一致处，原样列出，不替任何一方圆场。

- 仓库根：`E:\AI\DeepSeek Harness\Dsh`（junction → `E:\Code\dsh-plugin-market`）
- 分支 / HEAD：`main` / `03636501b4e5ee454a9f46e3e153944bb17582c5`（`0363650`）
- Node / npm：`v24.21.0` / `12.2.0`
- 被验脚本 sha256：
  - `verify/perf-baseline.mjs` = `A2261F457919AD891B9806593BD8571F410669D00302A83D574B9B325447BFA1`（**与任务书给定值逐字符一致**）
  - `verify/pack-inventory.mjs` = 14,335 字节（作者 perf-pack；未给基线 sha256，故只记录）
- 被测实现 `plugin-market/lib/catalog.js` sha256 = **`AB78AF0A61E76AC4CF30633DAF57AFBED43A69439A0E8B3DB21B2FA70DACC4FD`**（50,505 字节）
- 本报告写作用域：仅 `verify/PERF-VERIFY.md`。全部临时探针写在 `%TEMP%`，用完已删（仅留 3 个 JSON 提取物供写报告，见 §7）。

---

## 1. 命令与真实退出码

| # | 命令（cwd） | 真实退出码 | 备注 |
|---|---|---|---|
| 1 | `node verify/pack-inventory.mjs`（仓库根） | **0** | 输出 `failures: 0` |
| 2 | `npm pack --dry-run --json`（cwd=`plugin-market`） | **0** | 原生对照口径 |
| 3 | `npm pack --json --pack-destination %TEMP%\pv-realpack`（cwd=`plugin-market`） | **0** | 真实 tgz，已删除 |
| 4 | `node --expose-gc verify/perf-baseline.mjs`（run A） | **0** | 111 行 |
| 5 | `node verify/perf-baseline.mjs`（run B，无 gc） | **0** | 107 行（内存档标「未测」） |
| 6 | `node --expose-gc verify/perf-baseline.mjs`（run C，第二遍） | **0** | 再次复跑 |
| 7 | `pwsh -NoProfile -File scripts/release.ps1 -LocalOnly` | **0** | **38/38 测试通过**，墙钟 3586 ms |
| 8 | `git diff --check` | **0** | 无空白/冲突问题 |

三个脚本类命令（1、4、5、6）**全部 exit 0，无 stderr**。`release.ps1 -LocalOnly` 停在「3/5 写入版本」之前，未改版本、未打包、未提交、未发布。

---

## 2. pack-inventory：与 npm 原生输出逐条对照

### 2.1 npm 发布包（cwd = `plugin-market`）

| 项 | 作者报告 | **本人实测（原生 npm）** | 一致？ |
|---|---|---|---|
| files 条目数 | 18 | **18** | ✅ |
| `unpackedSize` | 861,935 | **861,935** | ✅ |
| npm 顶层 `size`（=tgz） | 303,588 | **303,588** | ✅ |
| dry-run `shasum` | `4f93975d9c4d0c72460394da11fd48d478da98a7` | **`4f93975d9c4d0c72460394da11fd48d478da98a7`** | ✅ |
| 真实 tgz 磁盘字节 | 303,588 | **303,588** | ✅ |
| dry-run `size` 与真实文件之差 | 0 | **0** | ✅ |
| 分文件 size 之和 | 861,935 | **861,935**（自算） | ✅ |

额外自算（作者未报，供交叉核对）：
- `integrity` = `sha512-Vdn3Bw36W6r38sQnz40p7G2xc6PiPkehEtXcZlqI6Ub2RA4iER7rz5hROlzCl3huQUVnqv4Fke++wQDdfvOAPw==`
- 真实 tgz 的 **sha1 = `4f93975d9c4d0c72460394da11fd48d478da98a7`**（与 npm `shasum` 一致，`Get-FileHash -Algorithm SHA1`）
- 真实 tgz 的 **sha256 = `1add6b4f2e09823ba918802f0b9d0b365474ecad0e339836ea1239de72dd99c9`**
- 压缩比 861,935 / 303,588 = **2.839×**（与作者同）

### 2.2 仓库

| 项 | 作者报告 | 本人实测（`node verify/pack-inventory.mjs`） | 一致？ |
|---|---|---|---|
| tracked 文件 | 102 | **102**（present 102，tracked-but-absent 0） | ✅ |
| 总字节 | 2,899,523 | **2,899,523**（2.765 MiB） | ✅ |

top10 亦逐条一致（`client.js` 346,805 / `market-discover.png` 217,757 / …）。

### 2.3 宿主安装目录

| 项 | 作者报告 | 本人实测 | 一致？ |
|---|---|---|---|
| 安装副本数 | 3 | **3** | ✅ |
| 每份 fileCount | 18 | **18 / 18 / 18** | ✅ |
| 每份字节 | 861,935 | **861,935 / 861,935 / 861,935** | ✅ |
| 版本 | 1.3.1 | **1.3.1**（各有 `package.json`） | ✅ |

路径：`C:\Users\28062\.dsh\profiles\desktop\node_modules\deepseek-harness-market`、`…\desktopprobe\…`、`E:\…\_verify\dshhome\profiles\marketcheck\…`。
候选探测确认 `DSH_HOME` 与 `%USERPROFILE%\.dsh` 解析到同一路径（`C:\Users\28062\.dsh`，脚本已去重），`%LOCALAPPDATA%\dsh`、`%APPDATA%\dsh` 均 absent —— 与作者一致。

**§2 结论：pack-inventory 的每一个数字都能被原生 npm / git / 文件系统独立复现，零差异。**

---

## 3. perf-baseline：确定性与重跑偏差

### 3.1 确定性 fixture 指纹（必须两次一致）

三次运行（A=`--expose-gc`、B=无 gc、C=`--expose-gc` 第二遍）的 sha256 **逐字节相同**：

| 档位 | count | sha256（A = B = C） |
|---|---|---|
| synthetic-100 | 100 | `e8d9bdb0644ef738ed5a23499c177a4c469016f61f319268857c15a4e2536e29` |
| synthetic-1000 | 1000 | `17682e69cc5b751b0cc36387b6a3e78ccf218d458e3c778ee60b8b2f6d9f7482` |
| synthetic-5000 | 5000 | `cd34a87c5cca3f10e9e91987881989fa846555502a2205f37c6a043d7d05e229` |
| synthetic-20000 | 20000 | `3d920bc5b2e010f5ae738e51e23ccdef9a8a0ae6772828424041e586f0af6b2e` |
| real-snapshot-4412 | 4412 | `f3d03c931ebdb299e8a0fa5dce5fba69eb7d68244d2a9485b5aa8ddb853a9c5b` |

> 独立验收断言：**确定性成立**。带 gc 与不带 gc 的 fixture 完全相同（指纹只覆盖 `payload.plugins`，不掺内存测量）。

### 3.2 真实 4412 档：中位数重跑偏差

| 运行 | refresh-chain median | refresh-chain P95 | normalizeCatalog median | filter(query=dsh) median | sortPlugins(top) median | 已知工作量 median | 比值 | 分辨力不足格子 |
|---|---|---|---|---|---|---|---|---|
| A（`--expose-gc`） | 4.915 | 9.185 | 2.730 | 2.983 | 1.830 | 0.935 | **9349×** | 16 |
| B（无 gc） | 4.139 | 8.422 | 2.642 | 2.849 | 1.779 | 0.929 | **9288×** | 16 |
| C（`--expose-gc`） | 3.915 | 6.411 | 2.536 | 2.737 | 1.735 | 0.850 | **8504×** | 16 |

重跑偏差（median-of-3 = 4.139 ms）：最大偏离 **+18.8%（A）/ −5.4%（C）**，极差/中位 = **24.2%**。P95 漂得更大（6.41–9.19 ms，极差/中位 67%）。
→ 与脚本头自己写的「单次运行 median 只用于比较量级，不要用于比较 10% 级别差异」**一致**；该自述属实。

---

## 4. 重点：refresh-chain 口径分叉的判定（本次审计最重要疑点）

### 4.1 读代码确定 refresh-chain 到底包含什么

`verify/perf-baseline.mjs:289-297`（逐字）：

```js
'refresh-chain(validate→normalize→counts→filter→sort→paginate)': () => {
  const v = validateCatalogPayload(tier.payload)
  const catalog = normalizeCatalog(tier.payload, { source: tier.payload.url })
  const cats = categoryCounts(catalog.plugins, catalog.categoryLabels)
  const filtered = filterPlugins(catalog.plugins, { query: 'dsh', category: cats[0]?.id ?? 'other' })
  const sorted = sortPlugins(filtered, 'top')
  return paginate(sorted, 1, 24)
}
```

判定（三点，全部来自代码 + 本人测量）：

1. **每轮都重跑 `validateCatalogPayload` + `normalizeCatalog`**（用 `tier.payload` 原始 raw），所以它不是「复用已 normalize 快照」。
2. **`filterPlugins` 带了 `category: cats[0].id`** —— 在 query 之前先把候选集收窄。我实测 `cats[0]` = **`ui`，764 条**（`filter(category='ui')` 返回 764，`filter(query='dsh',category='ui')` 命中 734）。**这直接解释了作者分项与整链的关系**：query 只在 734 条上跑，不是在 4412 条上。
3. **`warmup = 5` 先跑 5 次不计时**，随后 40 次取材。搜索路径有两处模块级记忆化（`foldText` 的 `foldCache`、匹配索引 `indexMemoFor`），预热后**已全部命中**。

⇒ **作者的 6.994ms 是「单进程内重复调用、模块缓存全热、且 query 先被 category 收窄」的口径；它不是「冷刷新」。**

### 4.2 本人独立量出的「冷刷新」vs「热复用」（同一份真实快照，4412 条）

探针：`%TEMP%\pv-coldhot.mjs`（进程内重复）与 `%TEMP%\pv-cold1.mjs`（**每进程只调一次**，保证 `foldCache`/`indexMemo` 全冷，n=12 独立进程）。二者都**直接 import** `../plugin-market/lib/catalog.js`。

| 口径 | 构造 | median | P95 | 判读 |
|---|---|---|---|---|
| **热复用·作者链形状** | 进程内重复作者链（warmup5 + 40） | **4.33 ms** | 7.17 ms | 与脚本 JSON 的 3.92–4.92 同量级 |
| **热复用·全量 query（不剪枝）** | 进程内重复，query 在 4412 条上跑 | **5.64 ms** | 8.04 ms | — |
| **冷刷新·作者链形状** | 每进程首调一次（fold 缓存冷） | **21.21 ms** | 25.78 ms | 比热复用慢 **~4.9×** |
| **冷刷新·全量 query** | 每进程首调一次，query 不剪枝 | **56.38 ms** | 64.09 ms | — |
| **冷刷新·含 `JSON.parse`（宿主真实 /refresh）** | `parse(5.05MB)+normalize+counts+filter+sort+paginate` | **72.56 ms** | 81.68 ms | 与 Lead 报的「刷新 30.8ms」同量级但更高（本机该次负载偏高，见 §8 噪声说明） |

`JSON.parse(5.05MB)` 单测 median = **31.47 ms**（与 Lead 的 30.76ms、作者的 30.8ms 一致）。

⇒ **作者报的 `6.994ms` 属「热复用」列（本人复现 3.92–4.92ms），不属「冷刷新」列（本人 21.2ms / 含 parse 72.6ms）。**
作者的脚本头注释其实**已经如实写了**「本基准测的是热缓存重复请求，冷启动 / 首次搜索会偏慢，本文件不测那一路」——所以**不是隐瞒**；问题是 **op 的 label `refresh-chain` 与「宿主每 10 分钟刷新一次」同名**，容易被读成冷刷新成本。

### 4.3 「分项之和 > 整链」是不是真的矛盾？

Lead 报告的疑点是：`normalize 4.82 + filter query 5.71 + sort 3.46 ≈ 14ms > 整链 6.99ms`。

**本人的判定：这组「分项」被测在了不同的输入形状上，所以不能相加。**

按**作者链自身的输入形状**重新测量（同一次进程，40 次，A 风格）：

| 链路内步骤（链自身的输入） | median |
|---|---|
| `normalizeCatalog(raw)` | 2.73 ms |
| `categoryCounts(plugins, labels)` | 0.09 ms |
| `filter(category='ui')`（剪枝到 764） | 0.11 ms |
| `filter(query='dsh', category='ui')`（命中 734） | 1.27 ms |
| `sortPlugins(top)` on **734** 条 | 0.32 ms |
| `paginate` | ~0.000 |
| **分项和** | **≈ 4.5 ms** |
| **整链实测（run A）** | **4.92 ms** |

→ **分项和 ≤ 整链，不存在矛盾。** 疑点中的 14ms 只有在把组件各自测在**全量 4412 / 冷 raw** 上时才出现：

| 若按「全量输入」口径测组件 | median |
|---|---|
| `normalizeCatalog` | 2.73 → 冷态 5.92 |
| `filter(query='dsh')` **全量 4412** | 2.98 |
| `sortPlugins(top)` **全量 4412** | 1.83（另一次 3.22） |
| 「全量」分项和 | **≈ 7.5–10.9 ms**（冷态 normalize 时更高） |

⇒ **结论：作者没有算错分项；Lead 的「和 > 整链」是把「链内实际规模的组件」与「全量/冷态组件」混在一张表里相加的产物（口径混用）。** 但 Lead 的核心结论——**6.99ms 不代表用户默认路径，默认 `category=all` 的 query-only 路径更贵**——**本人独立证实成立**：
- 宿主 `/catalog` 真实形状（`index.js:935-943`：`joinInstalled` → `filterPlugins(joined,{…})` → `sortPlugins` → `paginate`），默认无 query：热态 median **3.68 ms**；
- 同一路径 `query='dsh'` 全量：热态 median **9.45 ms**，冷态（含 parse）**72.6 ms**。

### 4.4 两种口径各自的 median / P95（本审计结论，均来自本人实测）

| 口径 | 包含步骤 | median | P95 |
|---|---|---|---|
| **热复用**（作者脚本口径；进程内重复、模块缓存热、category 剪枝） | validate→normalize→counts→filter(q+cat)→sort→paginate | **3.92–4.92 ms**（中位-of-3 = 4.14） | **6.41–9.19 ms** |
| **冷刷新**（进程首调，fold 缓存冷，同链） | 同上，但缓存全冷 | **21.21 ms** | **25.78 ms** |
| **冷刷新 + JSON 解析**（宿主每 10 分钟真实刷新） | `JSON.parse(5.05MB)` + 同链 | **72.56 ms** | **81.68 ms** |

---

## 5. 分辨力检验

同一计时口径（`hrtime` 包住单次调用）：

| 运行 | noop（空函数）median | noop min/max | 已知工作量 2e6 次算术 median | 比值 | 判定 |
|---|---|---|---|---|---|
| A | 0.0001 ms | 0 / 0.0036 | 0.935 ms | **9349×** | 量得出耗时 |
| B | 0.0001 ms | — | 0.929 ms | **9288×** | 量得出耗时 |
| C | 0.0001 ms | — | 0.850 ms | **8504×** | 量得出耗时 |

- 作者报「0.0001ms vs 0.86–1.30ms，6500–11700×」——**本人落在其区间内（8504–9349×）**，但注意该区间自身跨 1.8×，说明「比值」这条指标本身抖得厉害；单看「已知工作量 median 0.85–0.94ms ≫ noop 0.0001ms」已足够证明口径有分辨力。
- 已知工作量**线性**：noop 0.0001 → 2e6 次算术 0.93ms，纯空跑确实显著低于目标操作（真实档最小可分辨操作 `categoryCounts` = 0.085ms，仍是 noop 的 850×）。
- `normalizeCatalog` median 随规模严格递增：**100=0.100 → 1000=0.494 → 5000=2.653 → 20000=13.005 ms**（脚本 `resolution.normalizeStrictlyIncreasing = true`，本人复核为真）。

### 5.1 分辨力不成立的格子（必须点名）

脚本自己判出 **16 格**（median < `RESOLUTION_MIN_MS` = 0.01ms），本人确认为 16 格、逐档如下：

- `synthetic-100`：`filterPlugins:category` 0.0017、`installedOnly` 0.0017、`updatesOnly` 0.0014、`installed+category` 0.0026、`query+category+installed` 0.0027、`sortPlugins:top` 0.0070、`paginate` 0.0002、`joinInstalled(附加)` 0.0069
- `synthetic-1000`：`filterPlugins:category` 0.0063、`installedOnly` 0.0072、`installed+category` 0.0058、`query+category+installed` 0.0063、`paginate` 0.0002
- `synthetic-5000` / `synthetic-20000` / `real-snapshot-4412`：各 `paginate` 0.0001

作者自认「全档 paginate + synthetic-100 若干格」——**方向正确，但具体清单与脚本 JSON 对不上**，见 §7 缺陷 D1。

---

## 6. 假的绿灯排查

> 结论：**未发现假绿灯**。两个脚本确实 import 真实实现，未抄实现，未联网。

| 检查 | 结果 | 证据 |
|---|---|---|
| perf-baseline 真的 import 真实实现 | ✅ | `perf-baseline.mjs:44-52`：`import { categoryCounts, filterPlugins, joinInstalled, normalizeCatalog, paginate, sortPlugins, validateCatalogPayload } from '../plugin-market/lib/catalog.js'` |
| 是否抄了一份实现 | ✅ 无 | 全文件搜 `function (normalizeItem\|normalizeCatalog\|filterPlugins\|matchesQuery\|sortPlugins\|paginate\|joinInstalled\|categoryCounts\|foldText\|buildMatchIndex)` → **零命中**；只有 import + 造数据 + 计时 |
| pack-inventory 的 import | ✅ 只用 `node:child_process`/`fs`/`url`/`os`/`path`，无实现副本 | `pack-inventory.mjs:5-9` |
| `plugin-market/lib/catalog.js` sha256 | `AB78AF0A61E76AC4CF30633DAF57AFBED43A69439A0E8B3DB21B2FA70DACC4FD`；`git diff --stat -- plugin-market/lib/catalog.js` **空** | 与 HEAD 逐字节一致 |
| 脚本内网络调用 | ✅ 无 | 无 `fetch(`、无 `node:http/https/net`；命中的 `https://…` 全是**合成 fixture 的字符串字面量**（`perf-baseline.mjs:99/108/127/138/139`），不发起请求 |
| 脚本内写盘 | ✅ 仅 `%TEMP%` 上一个 tgz | `pack-inventory.mjs:104 mkdirSync` + `:131 rmSync`（自建、自删，`deleted=true`）；perf-baseline **无任何写 API** |
| 脚本内可变操作 | ✅ 无 | 搜 `git (commit\|push\|tag\|add\|rm\|checkout\|reset)`、`npm (publish\|install\|add)` → 零命中（`npm publish` 只出现在输出文案 `:271` 与 JSON 键名 `:318`） |
| 数据来源 | ✅ 本地只读 | `_ref/data/plugins.json`（真实档）+ 固定种子 `SEED=0x5eed1018` 的 mulberry32 合成档（**非裸 `Math.random`**） |

---

## 7. 缺陷与差异清单（附最小复现）

### D1【文档缺陷·中】`docs/PERF-AUDIT.md` §3.4 的分辨力点名与脚本 JSON 不一致

`PERF-AUDIT.md:246` 写「分辨力不成立的格子：全 5 档的 paginate、**synthetic-100 的 `categoryCounts`** 与 5 个 filter 变体、synthetic-1000 的 4 个 filter 变体、`joinInstalled`」。

实测（run A 的 `resolution.insufficientCells`，16 条）：
- **`synthetic-100 / categoryCounts` 并不在列**——它 median = **0.0143 ms ≥ 0.01 ms**，脚本判 `resolvable=true`。文档**多列**这一格。
- 文档**漏列** `synthetic-100 / sortPlugins:top`（0.0070ms）与 `synthetic-100 / joinInstalled(附加)`（0.0069ms）两格。

最小复现（不写盘，只读 JSON）：
```powershell
node --expose-gc verify/perf-baseline.mjs > "$env:TEMP\pv.txt"
# 取 PERF_BASELINE_JSON 行
$r = (… | ConvertFrom-Json)
$r.resolution.insufficientCells
$r.tiers | ? tier -eq 'synthetic-100' | % { $_.ops.categoryCounts.median, $_.ops.categoryCounts.resolvable }
# → 0.0143 ; True  （文档却把它列为不足）
```

### D2【口径缺陷·高】`refresh-chain` 的 label 同时容纳「热复用」与「冷刷新」两种相反结论

作者 6.994ms / P95 10.855ms 对应**热复用 + category 剪枝**（§4）。同一 label 若被读成「宿主每 10 分钟刷新一次的真实成本」，会低估 **3.1×（冷刷新 21.2ms）到 10.4×（含 JSON.parse 72.6ms）**。

- **本人实测**：热复用 3.92–4.92ms / P95 6.41–9.19ms；冷刷新 21.21ms / P95 25.78ms；冷刷新含 parse 72.56ms / P95 81.68ms。
- 作者脚本头**已自述**「测的是热缓存重复请求，不测冷启动」——所以**不是隐瞒，是命名歧义**；`docs/PERF-AUDIT.md` §3.3 也**已**澄清（该澄清本身正确）。
- **但澄清中的一个数字不准**：§3.3:230 写「`ui` 类**约 200 条**」。本人实测 `categoryCounts` top = **`ui`，764 条**（`filter(category='ui')` 返回 764）。结论方向（category 先收窄 → query 变便宜）不受影响，但具体规模差 **3.8×**。

最小复现：
```powershell
node -e "import('file:///E:/Code/dsh-plugin-market/plugin-market/lib/catalog.js').then(m=>{const r=JSON.parse(require('fs').readFileSync('E:/Code/dsh-plugin-market/_ref/data/plugins.json','utf8'));const c=m.normalizeCatalog(r,{source:r.url});const k=m.categoryCounts(c.plugins,c.categoryLabels);console.log(k[0], m.filterPlugins(c.plugins,{category:k[0].id}).length, m.filterPlugins(c.plugins,{query:'dsh',category:k[0].id}).length)})"
# → { id:'ui', count:764 }  764  734
```

### D3【自检缺陷·中】`synthetic-100` 的 refresh-chain 快于其组件 `normalizeCatalog`——超集比子集便宜，算术不可能

- run A：`refresh-chain` median = **0.0755 ms**，但其必经步骤 `normalizeCatalog` median = **0.0995 ms**。
- 链是 `normalizeCatalog` 的**超集**（还多做了 validate/counts/filter/sort/paginate），超集不可能更快。
- 脚本的 `RESOLUTION_MIN_MS = 0.01` **没有**把这一格标成分辨力不足（0.0755 > 0.01，判 `resolvable=true`），于是这条**自相矛盾的数字以「可信」状态进了 JSON**。

最小复现：读 run A 的 `tiers[0].ops`，比较 `refresh-chain…median`(0.0755) 与 `normalizeCatalog.median`(0.0995)。

### D4【疑点澄清·非缺陷】「分项之和 > 整链」不成立于作者链自身的输入形状

见 §4.3：按链自身输入（category 先把 query 剪到 734 条）分项和 ≈ 4.5ms ≤ 整链 4.92ms。14ms 的和只在**把组件测在全量 4412 / 冷 raw 上**时出现，属口径混用，**不是作者的算术错误**。

---

## 8. 红线合规核查（本人独立执行）

| 红线 | 结论 | 独立证据 |
|---|---|---|
| `plugin-market/` 零改动 | ✅ | `git status --short -- plugin-market` → **空**；`git diff --stat` 仅 `.gitignore`（+10 行，非本任务改动） |
| 版本仍 1.3.1 | ✅ | worktree `package.json` version = **1.3.1**；`git show HEAD:plugin-market/package.json` = **1.3.1**；`git diff --name-only -- plugin-market/package.json` → 空 |
| 无新增依赖 | ✅ | `package.json` 无 `dependencies`/`devDependencies` 字段；两个脚本只用 `node:` 内置 |
| 无文件被删 | ✅ | `git diff --name-only --diff-filter=D` → 空；`git diff --cached --diff-filter=D` → 空 |
| 无 commit / tag / push | ✅ | HEAD 仍 `0363650`；`git reflog -3` 顶条为既有 `chore(release): v1.3.1`，**无新条目**；tag 列表止于既有 `v1.3.1`；无 push 痕迹 |
| 未联网 | ✅ | 脚本内零网络 API（§6）；`npm pack` 只走本地文件；`_ref/data/plugins.json` 为仓库内既有只读快照 |
| 未写用户 Profile | ✅（脚本侧） | 两个脚本无写 API 指向 `.dsh`；**pack-inventory 只读枚举** `.dsh`。PS 核查显示 `C:\Users\28062\.dsh` 下有近 90 分钟内被修改的文件，但全部是 **DSH 宿主自身运行产物**（`.dsh-memory/**`、`sessions/**`、`storages/session_projcache/**`、`logs/**`、`our-free-model/**`、`channel-pack/**`）——是本会话/其他会话运行时写的，**不是这两个基准脚本写的**；`profiles/desktop/` 下被写的是 `cordis.patch.yml`/`cordis.yml`/`package.json`/`pnpm-lock.yaml`/`.plugin-manager/logs/**`/`node_modules/dsh-context/**`/`dsh-mobile/**`，属既有的插件管理/其他进程活动，与本任务无关。**本人无法从 mtime 单独证明「不是任何脚本写的」，故记为「脚本侧无写路径 + 归因指向宿主运行时」。** |
| `%TEMP%` 无 pack-inv-* / *.tgz 遗留 | ✅ | `Get-ChildItem %TEMP% -Filter 'pack-inv-*'` 与 `'*.tgz'` → **均无**；本人的 `pv-realpack` 也已删除 |
| `%TEMP%` 无 >5MB 遗留 | ⚠️ **有，但非本任务产物** | 列出 6 个 >5MB 文件，全部为**既有**第三方安装包/系统文件：`LenovoLegionToolkitSetup_*.exe`×2、`vscode-stable-user-x64\CodeSetup-*.exe`、`XiaomiClipboard\clip_*.bmp`、`4975bc1a-*.tmp`、`b779654a-*.tmp`。**两个基准脚本未产生任何 >5MB 文件**（tgz 仅 303,588 字节）。 |
| `git diff --check` | ✅ | exit **0** |
| `release.ps1 -LocalOnly` | ✅ | exit **0**，38/38 回归通过 |

---

## 9. 未验证项及原因

1. **真实上游快照的代表性**：`_ref/data/plugins.json` 是 2026-10-16 那一份（4412 条）。任务与作者均要求离线，**本人未联网重新抓取**，故「上游今日规模」未验证。
2. **宿主事件循环竞争下的真实延迟**：所有基准都是单进程同步计时，未在真实宿主进程内复测。
3. **跨机 / 跨 Node 版本可比性**：只在 `Node v24.21.0` + 本机 `i5-12500H` 上复跑，未做跨机对照。
4. **内存档位的独立复算**：本人以 `--expose-gc` 跑通了内存测量（峰值/retained 均有值），但**没有自建独立的分配量探针**去复算 `peakDeltaBytes`/`retainedBytes`；本报告只确认「内存档位被真的测出来了、未 gc 时如实标未测」。
5. **`docs/PERF-AUDIT.md` §6① 的 CHANGELOG 移除实验**（tgz 303,588→227,751）未由本人复跑，超出本任务必做清单。
6. **`%TEMP%` 中 `.dsh` 写入的逐进程归因**：无法仅凭 mtime 断定写者，见 §8「未写用户 Profile」行。
7. **`synthetic-20000` 与真实档的 P95 稳定性**：单次运行内 P95 抖动明显（如 run A 真实档 refresh P95 9.19 vs run C 6.41），未做足够多次以给出置信区间。

---

## 10. 一句话结论

- **pack-inventory：零差异**，18/861935/303588/`4f93975d…`/102/2899523/3×18 全部被原生 npm、git、文件系统独立复现，exit 0。
- **perf-baseline：确定性成立**（3 次运行 5 档指纹逐字节一致），**中位数重跑偏差 ≤18.8%**，与脚本自述的抖动幅度相符，exit 0。
- **口径分叉已判定**：作者的 `refresh-chain` = **热复用 + category 剪枝**（本人复现 3.92–4.92ms，作者 6.994ms 同量级）；**冷刷新是 21.21ms**，**含 JSON.parse 的宿主刷新是 72.56ms**。作者「分项 14ms > 整链」不是算术错误，是组件测在了不同输入形状上。
- **未发现假绿灯**：脚本真 import `catalog.js`（sha256 `AB78AF0A…CC4FD`），无实现副本、无联网、无写盘。
- **红线全绿**（`plugin-market/` 零改动、1.3.1、无新依赖、无删除、无 commit/tag/push、脚本侧不写 Profile、无 pack-inv/tgz 遗留）；`release.ps1 -LocalOnly` 与 `git diff --check` 均 exit 0。
- **3 个须改**：D1 文档分辨力清单与 JSON 不一致；D2 `refresh-chain` label 命名歧义（+ §3.3「ui 约 200 条」应为 764）；D3 synthetic-100 链快于其组件却未被标分辨力不足。
