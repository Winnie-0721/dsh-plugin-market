# TASK-PERF-01：dsh-plugin-market 性能与包体基线审计

> **状态**：§1–§10 = TASK-PERF-01 的第一轮审计（只读，未改任何运行逻辑）。**§11 = TASK-PERF-02**：修基准可信度缺陷（交错测量 + 一致性判据）并**实施**了唯一的低风险包体优化（npm 包移除 `CHANGELOG.md`）。
> 数据分两类，全文严格区分：**【实测】**= 真跑出来的数字（附命令）；**【推测】**= 由实测外推或尚未测量的估计。
> **未改运行逻辑、未删仓库文件、未加依赖、未动 API 契约、未升版本、未打 tag、未发布、未推送。**

---

## 0. 结论速览

| 项 | 实测值 | 判读 |
|---|---|---|
| npm 发布包（压缩后 tgz） | **227,751 字节**（0.217 MiB）★已优化 | 真正交付给用户的体积（原 303,588） |
| npm 发布包（解压后） | **691,578 字节**（0.66 MiB），**17** 个文件 ★已优化 | 宿主安装目录占用（原 861,935 / 18） |
| **CHANGELOG.md 移除后实测省** | **−75,837 字节（−25.0%）** | §11.3 真实打包验证，非估算 |
| 基准可信度缺陷 | **已修复**：交错测量 + `unreliable` 状态 | §11.1，15/15 组一致、0 倒挂 |
| 仓库（tracked） | 102 文件，2,899,523 字节（2.765 MiB）〔`a314349` 前口径；现 106 / 3,022,004，见 §2.2〕 | 与发布包差 3.4×（含 docs 截图与 verify） |
| 真实目录规模 | 4,412 条插件 / 23 分类 / 5,298,280 字节 JSON | 上游快照 `_ref/data/plugins.json` |
| 宿主每请求 `/catalog`（热缓存） | median **7.90ms** / P95 8.33ms | 同步跑在宿主事件循环上 |
| 用户默认搜索路径（`category=all` + query） | median **15.89ms** / P95 17.51ms | **最该关心的那条** |
| 缓存整轮重建（含 `JSON.parse` 5.05MB） | median **72.56ms** / P95 81.68ms | 每 10 分钟一次 |
| 每请求规范化分配 | **2,503 KB/次**（normalizeCatalog）+ **1,066 KB/次**（joinInstalled） | 与耗时无关，**每请求都在分配** |
| 死文案 / 死 CSS 类 | **0**（逐条核实，34 个疑似全部为扫描器假阳性） | 无需清理 |

**最重要的一条**：本轮最大的可优化项**不在 CPU，而在交付体积**——一个 `CHANGELOG.md` 占了发布包的 25.4%（移除后实测省 25.0%），而它对运行时零贡献。CPU 侧（7.9ms/请求）在实测数据里**不构成瓶颈**，不建议动。

**防误读**：`3.3` 节三个数字（6.99 / 15.89 / 21.21ms）**都对，是三件不同的事**——热+分类剪枝、热+默认全量、冷刷新。引用时必须带口径。

---

## 1. 运行环境与数据规模【实测】

### 1.1 环境

| 项 | 值 | 取法 |
|---|---|---|
| OS | Microsoft Windows NT 10.0.29683.0 | `[System.Environment]::OSVersion` |
| CPU | 12th Gen Intel(R) Core(TM) i5-12500H | `Get-CimInstance Win32_Processor` |
| RAM | 16,962,281,472 字节（15.8 GiB） | `Get-CimInstance Win32_ComputerSystem` |
| Node | v24.21.0 | `node -v` |
| npm | 12.2.0 | `npm -v` |
| pnpm | 12.14.0 | `pnpm -v` |
| 仓库 | `E:\Code\dsh-plugin-market`（工作区 `E:\AI\DeepSeek Harness\Dsh` 为其 junction） | — |
| 分支 / HEAD | `main` / `0363650`（`chore(release): v1.3.1`） | `git rev-parse --short HEAD` |
| 版本 | `deepseek-harness-market@1.3.1` | `plugin-market/package.json` |

### 1.2 数据规模【实测】

真实上游快照 `_ref/data/plugins.json`（仓库内已有，**只读**）：

```
字节数            5,298,280（5.05 MiB）
plugins 条数      4,412
categories        23 个
顶层键            name, url, source, updated, count, categories, plugins（**无 catalog 键**）
```

字段覆盖（逐条统计 4,412 条）：

| 字段 | 命中条数 |
|---|---|
| name / owner / url / page / category / description / npm / version / stars / downloads / downloadsStart / downloadsEnd / downloadsCheckedAt / install / added | 4,412（全量） |
| capabilities / capabilityRedLines / capabilityCheckedAt | 4,018 |
| screenshots | 874（共 2,448 张） |
| tarball | 333 |

形状要点：`description` 是 `{en, zh}` 对象；`category` 是**字符串**（不是数组）；`install` 是整条命令字符串；`stars == 0` 的有 **956/4,412** 条；`id` **4,412/4,412 全唯一**。

---

## 2. 包体审计【全部实测】

### 2.1 npm 发布包

命令（cwd = `plugin-market/`）：

```
npm pack --dry-run --json                       → exit 0
npm pack --json --pack-destination %TEMP%\...   → exit 0（测完立即删除）
```

| 口径 | 值 | 说明 |
|---|---|---|
| 文件条目数 | **18** | `files` 白名单命中的全部文件 |
| unpackedSize | **861,935 字节**（0.822 MiB） | 解压后总大小 = 宿主安装目录占用 |
| tgz 实际字节 | **303,588 字节**（0.29 MiB） | 真正下载/分发的体积 |
| shasum | `4f93975d9c4d0c72460394da11fd48d478da98a7` | dry-run 与实包一致 |
| 压缩比 | 861,935 / 303,588 = **2.839×** | — |

**口径澄清（易误读）**：`npm pack --dry-run --json` 顶层那个 `size` 字段**已经是压缩后的 tarball 大小**（实测与磁盘上 tgz 字节数**差 0**），不是「另一个估计值」。而 `files[].size` 是**未压缩**大小。两者不可直接相加或对比。

发布文件清单（18 个，按未压缩大小降序）：

| # | 路径 | raw 字节 | gzip6 字节 | 占 tgz |
|---|---|---|---|---|
| 1 | `lib/client.js` | 346,805 | 105,591 | 34.8% |
| 2 | `CHANGELOG.md` | 170,337 | **77,179** | **25.4%** |
| 3 | `lib/index.js` | 72,567 | 25,113 | 8.3% |
| 4 | `lib/catalog.js` | 50,505 | 19,672 | 6.5% |
| 5 | `lib/self-update.js` | 41,618 | 15,052 | 5.0% |
| 6 | `lib/github-routes.js` | 28,562 | 11,628 | 3.8% |
| 7 | `lib/catalog-npm.js` | 24,734 | 9,713 | 3.2% |
| 8 | `lib/http.js` | 22,954 | 9,373 | 3.1% |
| 9 | `lib/hot-mount.js` | 22,862 | 9,051 | 3.0% |
| 10 | `lib/restart-policy.js` | 17,741 | 7,604 | 2.5% |
| 11 | `README.zh.md` | 16,956 | 7,602 | 2.5% |
| 12 | `README.md` | 18,864 | 7,049 | 2.3% |
| 13 | `lib/restart.js` | 11,312 | 5,212 | 1.7% |
| 14 | `lib/http-body.js` | 7,247 | 3,419 | 1.1% |
| 15 | `lib/restart-helper.cjs` | 5,608 | 2,935 | 1.0% |
| 16 | `LICENSE` | 1,108 | 680 | 0.2% |
| 17 | `cordis.patch.yml` | 845 | 639 | 0.2% |
| 18 | `package.json` | 1,310 | 597 | 0.2% |
| | **合计** | **861,935** | **318,109** | 104.8%\* |

\* 独立 gzip 之和（318,109）比整包 tgz（303,588）**大 14,521 字节**，因为 tar 把所有文件**合并成一个 gzip 流**，跨文件冗余可被共享压缩；分文件 gzip 各自承担字典开销。所以「独立 gzip 之和」只能用于**比较相对占比**，不能当作整包体积。

### 2.2 仓库

```
git -C <root> ls-files -z  +  statSync 每个路径
```

- tracked 文件：**102**，全部在磁盘上存在（tracked-but-absent = 0）
  > **口径更新（TASK-PERF-02）**：102 / 2,899,523 是 `a314349` **入库前**（工作区当时还差 4 个审计文件）的口径；`a314349` 把 4 个审计文件入库后，现 `node verify/pack-inventory.mjs` 报 **106 tracked / 3,022,004 B（worktree 口径）**。另注意该值随口径浮动（`.gitattributes` 对 `*.ps1` 做 LF→CRLF 归一，blob 口径与工作区口径对同一文件字节数不同，±20B 级）——引用时必须写明口径。
- 总字节：**2,899,523**（2.765 MiB）
- 最大 10 个：

| 路径 | 字节 |
|---|---|
| `plugin-market/lib/client.js` | 346,805 |
| `docs/assets/market-discover.png` | 217,757 |
| `docs/assets/market-page-live.png` | 210,075 |
| `plugin-market/CHANGELOG.md` | 170,337 |
| `verify/REPORT.md` | 153,650 |
| `verify/market-ui.e2e.mjs` | 125,024 |
| `docs/API-CONTRACT.md` | 114,066 |
| `docs/assets/market-updates.png` | 78,814 |
| `plugin-market/lib/index.js` | 72,567 |
| `docs/assets/market-tab-alignment.png` | 63,366 |

仓库比发布包大 3.4×，差额几乎全在 `docs/`（截图）与 `verify/`（测试与报告）——**这两块不进发布包**，是正常的开发资产，不是浪费。

### 2.3 宿主安装目录

只读枚举（**未写入任何 Profile**）。候选路径：

| 候选 | 结果 |
|---|---|
| `C:\Users\28062\.dsh`（`DSH_HOME` 与 `%USERPROFILE%\.dsh` 解析到同一路径，只计一次） | 存在 |
| `E:\Code\dsh-plugin-market\_verify\dshhome` | 存在 |
| `%LOCALAPPDATA%\dsh` | 不存在 |
| `%APPDATA%\dsh` | 不存在 |

找到 **3 个已安装副本**，均为 `deepseek-harness-market@1.3.1`，每个 **18 文件 / 861,935 字节**（与发布包 payload **逐字节一致**）：

| 安装路径 | 文件数 | 字节 |
|---|---|---|
| `C:\Users\28062\.dsh\profiles\desktop\node_modules\deepseek-harness-market` | 18 | 861,935 |
| `C:\Users\28062\.dsh\profiles\desktopprobe\node_modules\deepseek-harness-market` | 18 | 861,935 |
| `E:\Code\dsh-plugin-market\_verify\dshhome\profiles\marketcheck\node_modules\deepseek-harness-market` | 18 | 861,935 |

合计磁盘占用 **2,585,805 字节（约 2.47 MiB）**——即每装一份就多 0.822 MiB。**解压后体积（861,935）才是宿主目录的真实占用**，tgz 的 303,588 只在下载/缓存时存在。

---

## 3. 性能基线【实测】

### 3.1 脚本与复现

| 脚本 | 命令 | 退出码 |
|---|---|---|
| `verify/pack-inventory.mjs` | `node verify/pack-inventory.mjs` | **0** |
| `verify/perf-baseline.mjs` | `node --expose-gc verify/perf-baseline.mjs` | **0** |
| `verify/perf-baseline.mjs`（无 gc） | `node verify/perf-baseline.mjs` | **0**（内存如实标「未测（需 --expose-gc）」） |

两个脚本都**真 import** `plugin-market/lib/catalog.js`（无实现副本）、离线、无新依赖、不写盘、不碰 Profile。

### 3.2 真实规模（4,412 条）各操作耗时

**Lead 独立交叉测量**（`node --expose-gc`，直接 import 真实实现，30 次，ms）：

| 操作 | median | P95 | min | max |
|---|---|---|---|---|
| `normalizeCatalog` | 3.24 | 5.54 | 2.50 | 6.12 |
| `categoryCounts` | 0.11 | 0.12 | 0.11 | 1.87 |
| `filterPlugins`（无筛选） | 0.04 | 0.06 | 0.04 | 0.06 |
| `filterPlugins(query="dsh")` | 3.01 | 5.41 | 2.62 | 8.30 |
| `filterPlugins(两个词)` | 5.14 | 8.61 | 4.30 | 9.48 |
| `filterPlugins(category+query)` | 0.48 | 2.42 | 0.45 | 2.72 |
| `filterPlugins(installedOnly)` | 0.03 | 0.05 | 0.02 | 0.05 |
| `sortPlugins('top')` | 1.99 | 3.51 | 1.62 | 4.08 |
| `sortPlugins('new')` | 2.13 | 3.76 | 1.98 | 4.56 |
| `paginate` | 0.00 | 0.00 | 0.00 | 0.01 |
| `joinInstalled` | 0.18 | 0.77 | 0.17 | 1.88 |
| **完整刷新链路（query 版）** | **24.72** | 39.30 | 16.02 | 44.49 |
| 完整刷新链路（无 query） | 14.21 | 25.72 | 9.66 | 35.37 |

**跨进程重复测量**（7 个独立进程，取跨进程中位数——单进程内重复会被 JIT/GC 状态污染）：

| 指标 | median | P95 | min | max | spread |
|---|---|---|---|---|---|
| `normalizeCatalog` | 5.06 | 5.96 | 4.55 | 5.96 | 1.3× |
| 链路 `query+category` | 6.81 | 7.47 | 6.27 | 7.47 | 1.2× |
| 链路 `query` only | 15.89 | 17.51 | 14.52 | 17.51 | 1.2× |
| **宿主 `/catalog`（热缓存）** | **7.90** | 8.33 | 5.46 | 8.33 | 1.5× |
| `filterPlugins(query)` | 5.04 | 6.04 | 3.48 | 6.04 | 1.7× |
| `filterPlugins(query+category)` | 0.89 | 1.06 | 0.51 | 1.06 | 2.1× |
| `sortPlugins('top')` | 2.74 | 3.16 | 1.68 | 3.16 | 1.9× |
| `JSON.parse(5.05MB)` | 30.76 | 34.77 | 20.18 | 34.77 | 1.7× |

> **跨进程 spread 1.2–2.1× 是这台机器上可复现的真实抖动**。任何小于 ~2× 的差异都在噪声里，**不可据此下结论**。perf-bench 独立记录到 synthetic-1000 `normalizeCatalog` 中位数在四次运行里落在 0.52–1.17ms，与这里一致。

### 3.3 宿主真实链路（`plugin-market/lib/index.js` `catalog()` 路由）

读代码确定 `/catalog` 每请求真实做的转换序列（`index.js:931-943`）：

```
cache = await requireCatalog(res)          // 缓存命中 → 不重新抓取/解析
{ bundles } = await listBundlesSafe()
joined   = joinInstalled(cache.plugins, bundles)     // 每请求
filtered = filterPlugins(joined, {query, category, installedOnly, updatesOnly})
sorted   = sortPlugins(filtered, sort)
pageInfo = paginate(sorted, page, pageSize)
```

而**缓存刷新时**（每 10 分钟或点刷新）额外做：`JSON.parse(5.05MB)` → `normalizeCatalog` → `categoryCounts`。

| 路径 | 组成 | median | P95 |
|---|---|---|---|
| **每请求（缓存命中）** | join + filter + sort + paginate | **7.90ms** | 8.33ms |
| **缓存刷新（每 10 分钟）** | JSON.parse + normalize + counts | **30.8ms** | 34.8ms |

**口径分叉已查清（重要）**：perf-bench 报「真实 4412 链路 median 6.994ms」，Lead 早先测出 24.72ms。二者**都对，但口径不同**：

- perf-bench 的 `refresh-chain` 用 `filterPlugins(catalog.plugins, { query: 'dsh', category: cats[0] })` —— **category 先收窄**（`ui` 类 **764 条**，P95 独立复测确认），query 只在那 734 条上跑 → 便宜。
- Lead 的分别是 `query` **不带 category**（在全部 4,412 条上跑 `matchesQuery`）→ 贵。
- 实测证实这条解释：`filterPlugins(query+category)` = **0.89ms**，`filterPlugins(query)` = **5.04ms**，差 5.7×；两者链路分别是 6.81ms / 15.89ms。

**独立验收补充的第三种口径（`verify/PERF-VERIFY.md`）**：perf-bench 的数字还叠了「**热复用**」——它的 warmup=5 + 40 次取材让模块级 `foldCache` / `indexMemo` 全热。冷刷新（每进程首调、折叠缓存冷）实测 **21.21ms / P95 25.78ms**；再叠加 `JSON.parse(5.05MB)`（单测 31.47ms）为 **72.56ms / P95 81.68ms**。三个数字对应三件不同的事：

| 口径 | median | 谁在什么时候经历 |
|---|---|---|
| 热复用 + category 剪枝（作者 op） | 6.99ms | 已选分类后再搜、且缓存已热 |
| 热复用，`category=all` + query（Lead） | 15.89ms | **用户默认路径**：搜索框输入、未选分类 |
| 冷刷新（fold 缓存冷） | **21.21ms** | 目录刷新后的第一次搜索 |
| 冷刷新 + `JSON.parse` | **72.56ms** | 缓存整轮重建（每 10 分钟一次） |
| 宿主 `/catalog` 无 query（Lead，跨进程度） | 7.90ms | 浏览 / 翻页 / 排序 |

> ⚠️ **TASK-PERF-02 口径更正**：上表各值是**独立 pass** 测出来的（每个操作各自 warmup + 连续取样）。这种口径适合比较**量级**，但**不适合**把「链路」与「它的组件」直接比大小——两者不共享 JIT/GC/缓存状态。TASK-PERF-02 已改为**交错取样**并重测（见 §11），新口径下 real-4412 的三个链路变体为 **9.61 / 19.96 / 11.13ms**（组件 7.51ms）。**上表的 6.99/15.89/24.72 等具体数字仍可作为量级参考，但不要与分项之和做大小比对。**

> **「分项之和不等于整链」已查清为口径混用，不是算术错误**：按链**自身**的输入形状分项（normalize 2.73 + counts 0.09 + filter(q+cat) 1.27 + sort(734) 0.32 ≈ 4.5ms）**≤ 整链 4.92ms**，自洽。Lead 早先的 14ms 是把组件测在**全量 4,412 / 冷 raw** 上，与链的输入不同。

**用户实际体验的是哪个？** 打开发现页时 `category = "all"`（不传 category），此时走的是**贵的 `query`-only 路径**。所以：

> **面向用户的真实每请求成本 ≈ 7.9ms（浏览/翻页/排序）～15.9ms（输入搜索词且未选分类）；刷新后首搜 ≈ 21.2ms，整轮重建 ≈ 72.6ms。**
> perf-bench 的 6.99ms 对应「已选分类后再搜 + 缓存全热」这一较窄场景，**不能**当作通用基线。建议把该 op 的 label 补注为 `query+category, warm`，并另加 `query`-only 与冷刷新两条。

### 3.4 分辨力证明

| 口径 | 空转基线 | 已知工作量 | 比值 | 判定 |
|---|---|---|---|---|
| Lead | 0.01ms | `normalizeCatalog ×3` = 13.18ms | **1318×** | 口径量得出耗时 |
| perf-bench | 0.0001–0.0002ms | 2×10⁶ 次算术 = 0.86–1.30ms | 6,500–11,700× | 口径量得出耗时 |

经验阈值 5×，两边都远超。**分辨力不成立的格子**（median < 0.01ms，数字不可用于比较，须以脚本 JSON `resolution.insufficientCells` 为准，**共 16 格**）：

| 档位 | 分辨力不足的操作 |
|---|---|
| 全 5 档（100/1000/5000/20000/real） | `paginate`（纯数组切片，语义上确实便宜，不是测量缺陷） |
| synthetic-100 | `sortPlugins:top`(0.0070ms)、`joinInstalled`(0.0069ms)、其余 filter 变体 |
| synthetic-1000 | 4 个 filter 变体 |

> **D1 更正（由独立验收发现）**：本表早先误把 `synthetic-100/categoryCounts` 列入不足——实测 **0.0143ms 且 `resolvable=true`**，**不该列入**；同时漏列了 `synthetic-100` 的 `sortPlugins:top`(0.0070) 与 `joinInstalled`(0.0069)。此处已按脚本 JSON 对齐。

> **D3 已在 TASK-PERF-02 修复（详见 §11）**：`synthetic-100` 的 `refresh-chain` 曾量出 **0.0755ms < 必经组件 normalizeCatalog 0.0995ms**——超集快于子集。**根因不是算术错误，是测量设计**：两者原本各跑一次独立的 `bench()`，不共享 JIT/GC/折叠缓存状态，在 0.1ms 量级下中位数可差 ±40%，大小关系近乎掷硬币。**旧报告的 chain 数字（含 §3.3 的 6.99 / 15.89ms）属「独立 pass、热复用」口径，仍可用于量级比较，但不应再与组件分项做大小比对。**
> 修法：链路与其必经组件改为**同一次交错 pass**轮流取样（`benchInterleaved`），并新增 `isChainConsistent` 一致性判据 + `unreliable` 状态。修复后 **15/15 组一致、0 倒挂**，`chain/component` 比值稳定在 **1.18–3.77×**。**未调 `RESOLUTION_MIN_MS` 阈值来掩盖任何数据。**

---

## 4. 内存【实测 + 明确标注局限】

### 4.1 每请求分配（这是关键，不是峰值）

方法：`--expose-gc`，预热 2 次排除内部缓存首次填充，`global.gc()` 两次取基线，跑 10 次保留结果，再 `gc()` 两次取终值，差值 / 10。

| 操作 | 每次分配 |
|---|---|
| `normalizeCatalog`（冷） | **2,503 KB/次** |
| `joinInstalled`（**每请求都跑**） | **1,066 KB/次** |
| 链路 join+filter(q)+sort+page（热） | 8 KB/次 |

### 4.2 常驻与峰值

| 项 | 实测 |
|---|---|
| 保留一份 normalized 快照（4,412 条） | 基线 28.0MB → 30.5MB，**增量 ≈ 2.4MB** |
| 该快照 `JSON.stringify` 后 | 5.39MB（原始 JSON 5.05MB）→ 规范化后内存表示比源 JSON 大 6.7% |
| 整链 ×10 的 heapUsed 峰值 | 起始 40.4MB，峰值 ≈ 40.4MB，gc 后 43.0MB |
| perf-bench 各档峰值增量 | 100 → 0.11 MiB；1000 → 1.07；5000 → 5.39；20000 → 35.88；real-4412 → 4.75 MiB |

### 4.3 测量方法与局限（必读）

1. **单进程、同步计时**，非真实宿主进程。宿主同时在跑流式输出，**事件循环竞争未测**。
2. **`--expose-gc` 是侵入式的**：手动 `gc()` 改变堆状态。本节数字是「分配总量」的量级估计，**不是**宿主真实 GC 曲线。
3. **首次测量曾给出错误结果**：早期版本「先取基线再 gc」得到 `retained ≈ -135.4MB`（负值 = 方法错误，不是内存回收）。已修正为「先 gc 再取基线」。**负 retained 一律是测量伪影**，perf-bench 也报出若干 KiB 级负值，同因。
4. **峰值采样依赖定时器**（`setInterval(..., 1)`），可能漏掉亚毫秒尖峰 → 峰值是**下界**。
5. **未测**：真实 HTTP 抓取耗时、客户端浏览器渲染内存、长跑泄漏（未做 30 分钟 soak）、多标签页并发。
6. `heapUsed` 不代表 RSS；本机观测 `heapTotal=208.4MB / rss=321.2MB`，大量为 Node 自身与 V8 保留。

**判读**：单次请求 2.5MB + 1.1MB 的分配量在 4,412 条规模下是**可接受的**（V8 年轻代能轻松吸收），但它是**每请求固定支出**——`joinInstalled` 的 1,066 KB/次在纯浏览（翻页）时也照样发生，可以考虑省掉（见 §6）。

---

## 5. 重复与浪费审计【实测】

### 5.1 重复 CSS

`client.js` 的 `STYLES` 模板：**L1607–L2026**，39,605 字符 / **47,701 字节**（占 client.js 13.8%）。

| 项 | 实测 |
|---|---|
| CSS 规则数 | 303 |
| 去重选择器 | 275 |
| 被声明 >1 次的选择器 | **29** |
| 重复部分合计 | **约 2,226 字节**（未压缩）；gzip 后 **< 300 字节**【推测】 |
| CSS 内注释 | 143 行 / 6,873 字节（14.4% of CSS） |
| 单行 >400 字节的 CSS 行 | 3 行 / 1,586 字节 |

重复的选择器示例：`.dshpm-card×2`、`.dshpm-btn×2`、`.dshpm-chip×2`、`.dshpm-row×2`、`.dshpm-sort×2`、`.dshpm-entryBadge×2`……

**但这 29 处不是缺陷。** 读代码可见它们**全部是有意的分层覆盖**：`L1607+` 是基础定义，`L1916+` 是「动效与交互增强」层（`animation` / `transition` / `:hover` 变换），作者在注释里明确记录了特异性顺序（例如 `.dshpm-updateRow.dshpm-updateRow--ghost` 用双类压过单类动画、`.dshpm-modalLayer.dshpm-lightboxLayer` 双类是因为「lightbox 栽过这次」）。

> **结论：CSS 重复 = 0 可安全删除项。** 合并它们会破坏层叠顺序，收益（gzip 后 <300 字节）远小于回归风险（样式错乱，历史上已经栽过两次）。**不建议动。**

### 5.2 重复文案

| 项 | 实测 |
|---|---|
| `STRINGS.zh` key 数 | 352（块 21,810 字节） |
| `STRINGS.en` key 数 | 353（块 32,553 字节） |
| key 只在 zh | **0**（完全对称） |
| key 只在 en | 1（`Re-check plugins`，见下） |
| 占位符 `{name}` 不一致的 key | **0** |
| 重复出现的文案值 | 20 类，冗余 ≈ **360 字节** |

- **`Re-check plugins`（只在 en）**：`client.js` **L169** 那一行同时写了两个 key（`"notice.toggleCancelled": "…", "notice.toggleDisabled": "已停用 {name}"`），zh 表把 `notice.toggleDisabled` 挤在同一行。**这是真实的格式不一致**（zh 表唯一一行含 2 个 key），但**不是缺翻译**——`notice.toggleDisabled` 在 zh 表中确实存在（L169 同一行）。属**可读性瑕疵**，非功能缺陷。
- **曾误报「130 个未引用文案」**：第一版扫描器用静态 `t("...")` 匹配，漏掉了**动态拼 key** 的调用（`"fiber." + phase`、`"err." + code + ".title"`、`"readonlyReason." + reason`、`t("restart.manualBody." + reason)`）。补上动态前缀分析后，34 个「不可达」key **全部**被字面量前缀覆盖（`sort.*` 由 L3869-3872 的表驱动、`capability.*` 由 L933 拼接、`err.file-locked.*`/`err.supply-chain.*` 由 L1313-1315 的三元前缀选择）。**真实死文案 = 0**。

> **结论：文案冗余 ≈ 360 字节，且需要合并的只有 20 个同值短串。收益可忽略，不建议动**（除 L169 的换行整理，属纯可读性）。

### 5.3 重复转换 / 中间对象

| 项 | 实测 | 判读 |
|---|---|---|
| `foldText` 调用点 | 3 处（`catalog.js`） | 已有**按内容记忆化**（`FOLD_CACHE_CAP=65536`），命中后 `map.get` 直接返回 |
| `normalize('NFKD')` | 1 处 | 只在 foldCache miss 时执行 |
| `{...item}` 克隆 | 2 处（均在 `joinInstalled`） | **每请求 4,412 次对象展开** |
| `.map(` / `.filter(` / `new Map(` | 8 / 7 / 6 | 正常量级 |
| `Array.isArray` | **19 处** | 防御式检查，单类模块内偏多但成本近 0 |
| `client.js` 内 `toLowerCase` | 7 | 无热点 |
| `client.js` 内 `JSON.parse/stringify` | 各 1 | 非热路径 |

**唯一的真实每请求中间对象热点**：`joinInstalled` 对全部 4,412 条做 `{...item}` 展开（实测 **1,066 KB/次、0.18ms**）。它**即使在「纯浏览、不改任何筛选」时也每请求执行**——因为它是 `/catalog` 路由的第一步。`matchIndexFor` 已按**数组身份**记忆化（避免每次重建 12ms 的索引），这一步做得好；但结果对象的重建没有对应优化。

### 5.4 无用发布文件

| 文件 | raw | gzip6 | 占 tgz | 运行时是否需要 | 能否从 `files` 移除 |
|---|---|---|---|---|---|
| `CHANGELOG.md` | 170,337 | **77,179** | **25.4%** | **否** | **能** |
| `README.md` | 18,864 | 7,049 | 2.3% | 否 | **不能**（npm 强制包含） |
| `README.zh.md` | 16,956 | 7,602 | 2.5% | 否 | **不能**（npm 强制包含） |
| `LICENSE` | 1,108 | 680 | 0.2% | 否（MIT 合规要求） | **不能**（npm 强制包含） |
| `package.json` | 1,310 | 597 | 0.2% | 是 | **不能**（npm 强制包含） |

`lib/` 之外**没有任何一个文件被运行时 import**——`main` 是 `lib/index.js`，`exports` 只暴露 `./lib/index.js`、`./lib/client.js`、`./package.json`，`dsh.bundle.patch` 指向 `cordis.patch.yml`。CHANGELOG / README 纯属 npm 页面展示用途。

**npm 强制包含规则（实测，容易踩坑）**：`files` 白名单**管不住** `package.json`、`README*`、`LICENSE`。四种白名单下的真实打包结果（`npm pack --dry-run --json`）：

| `files` 配置 | 实际打包文件数 | 强制塞进来的 |
|---|---|---|
| 当前（`lib`,`cordis.patch.yml`,`README.md`,`README.zh.md`,`CHANGELOG.md`,`LICENSE`） | 18 | — |
| `["lib"]` | **16** | `LICENSE`, `README.md`, `README.zh.md`, `package.json` |
| `["lib","cordis.patch.yml"]` | **17** | `LICENSE`, `README.md`, `README.zh.md`, `package.json` |
| `[]`（空） | **5** | `LICENSE`, `README.md`, `README.zh.md`, `lib/index.js`, `package.json` |

> 含义：**README 的 ~14.7KB gzip 是省不掉的**（除非删掉仓库里的 README 文件本身，那会破坏 npm 页面与 GitHub 首页——不值得）。`files` 里列出它们是**冗余但无害的声明**。唯一真正能移除的大件是 `CHANGELOG.md`。

---

## 6. 下一步优化建议（≤3 条，按「收益 ÷ 维护成本」排序）

> 判据：必须有本轮实测数字支撑；维护成本低的优先。

### ① 从 npm 发布包中移除 `CHANGELOG.md` —— 省 **75,837 字节（25.0%）** ✅ **TASK-PERF-02 已实施**

> **状态**：**已实施并实测**（TASK-PERF-02 §11）。`plugin-market/package.json` 的 `files` 已去掉 `"CHANGELOG.md"`；真实 `npm pack` 得 **tgz 227,751 / unpacked 691,578 / 17 条**，与本节预测**完全一致**。仓库内 `CHANGELOG.md` **原样保留、未修改**（发布说明与版本号声明由 `scripts/release.ps1` 从**仓库**读取，不走 npm 包，故不受影响）。

- **证据**【实测】：`CHANGELOG.md` = 170,337 raw / **77,179 gzip**，占 tgz 的 **25.4%**；`package.json` 的 `files` 白名单显式包含它；运行时零引用。
- **已实测的差额**（在 `%TEMP%` 的副本上真实复打，仓库零改动）：
  ```
  baseline (当前 files 白名单)   files=18  tgz=303588  unpacked=861935
  移除 CHANGELOG.md              files=17  tgz=227751  unpacked=691578
  → tgz 省 75,837 字节 (25.0%)，解压后省 170,357 字节
  ```
- **改法**：`plugin-market/package.json` 的 `files` 去掉 `"CHANGELOG.md"`。仓库里照旧保留（git 历史与 GitHub 页面仍可见）。
- **收益**：tgz **303,588 → 227,751 字节（−25.0%）**；宿主安装体积 **861,935 → 691,578（−19.8%）**。
- **风险**：**低**。npm 页面少一个 CHANGELOG 链接；可指向 GitHub。
- **验证**：改后跑 `npm pack --dry-run --json`，断言 `size` = 227751±1k、文件数 17；`node scripts/run-tests.mjs` 全绿；`node verify/pack-inventory.mjs` 复跑。
- **不要再考虑两个 README**：实测证明省不掉（见 §5.4 强制包含规则）——把它们从 `files` 移除后 tgz 只降 **1 字节**，因为它们被 npm 强制包含。

### ② `joinInstalled` 在纯浏览路径上跳过对象重建 —— 省 **1,066 KB/请求**

- **证据**【实测】：`joinInstalled` 每次分配 **1,066 KB**、耗时 0.18ms，且在**每个** `/catalog` 请求上无条件执行（`index.js:935`），包括翻页、改排序这些与「已安装状态」无关的操作。`matchIndexFor` 已记忆化，说明作者认可「同一快照可复用」的前提。
- **改法**：把「已安装 join」结果按 `(cache.plugins 身份, bundles 摘要)` 记忆化——与 `matchIndexFor` 完全同构的模式（只留最新一份，新数组即新键）。**不新增依赖、不改 API 契约**、响应体逐字节不变。
- **收益**：纯浏览路径**省 1.07MB 分配/请求**，耗时降 ~0.2ms；GC 压力下降（在宿主事件循环里，这部分是真实收益）。
- **风险**：**中**——必须保证 `bundles` 变化即失效（否则会显示过期的 installed 状态）。缓解：键必须同时包含 bundles 的稳定标识；且这只优化「结果缓存」，不改变任何对外语义。**这是本轮唯一建议改代码的点，务必配独立测试。**
- **验证**：新增断言「同快照同 bundles 两次调用返回等值结果」「bundles 变更后结果随之更新」「`/catalog` 响应 JSON 与优化前逐字节相同」；跑全量门禁。
- **注**：本轮**不动**它——任务第一轮只交报告与基准。

### ③ 修正 perf-bench 的链路口径并补 `query`-only 基线（**零风险，先做**）

- **证据**【实测】：perf-bench 报 6.994ms 的 `refresh-chain` 实际用了 `query+category`（category 先收窄到 **764 条**的 `ui` 类），且 warmup 让折叠缓存全热；用户默认打开发现页是 `category=all`，走 `query`-only，实测 **15.89ms**，差 **5.7×**；冷刷新更达 **21.21ms**。同一个 op label 会同时兼容「7ms 够快」和「21ms 值得优化」两种相反结论。
- **改法**：把现有 op label 补注为 `query+category, warm`，**新增**两条：`chain: query only (category=all)` 与 `chain: cold (fold cache cold)`；三档都报。同时把 §3.3 的口径表写进脚本头部注释。
- **收益**：防止后续基于错误口径做优化（本仓 `market-perf.probe.mjs` 文件头已经记录过一次「没数据支撑的优化」的教训，这里是同类风险）。
- **风险**：**无**（纯基准脚本改动，不碰运行逻辑）。
- **验证**：`node --expose-gc verify/perf-baseline.mjs` exit 0，JSON 里三条链路都在，且 `query`-only 明显慢于 `query+category`、冷 > 热。
- **附带（独立验收 D3）**：给 `refresh-chain` 增一条**一致性断言**——chain 必须 ≥ 其最贵组件（否则就是分辨力失效，如 `synthetic-100` 的 0.0755 < 0.0995）；并把 `RESOLUTION_MIN_MS` 从 0.01 提到 ~0.02ms。这属于同一处改动，顺手做掉。

### 明确**不建议**做的（有数据挡着）

| 候选 | 为什么不做 |
|---|---|
| 合并 29 处分层覆盖的 CSS | 收益 gzip 后 <300 字节；会破坏层叠顺序（历史已栽两次） |
| 清理「重复文案」 | 真实冗余仅 ~360 字节；确认零死文案 |
| 给列表卡片加 `memo` / 减少重渲 | `verify/market-perf.probe.mjs` 已实测击键 p50=0.6ms、排序重渲 p50=1.0ms，都在噪声区。**没有数据支持** |
| 优化 `sortPlugins` / `paginate` | 1.99–2.74ms / 0.00ms，非瓶颈 |
| 优化 `foldText` 正则 | 已有记忆化；冷首次 ~2.9ms，且缓存上界行为已经被上一轮独立审计量过（达到上界时堆增长约 18MB） |

---

## 7. 门禁与独立验收（真实退出码）

### 7.1 发布门禁与工作区检查（Lead 亲跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pwsh -NoProfile -File scripts/release.ps1 -LocalOnly` | **0** | 回归测试通过 **38/38**（墙钟 3059ms；最慢 `body-lifecycle` 2579ms） |
| `git diff --check` | **0** | 无空白错误 |

### 7.2 独立验收（`verify/PERF-VERIFY.md`，由 perf-verify 独立复跑，不复用作者口径）

全部真实退出码：`pack-inventory` **0** · `npm pack --dry-run --json` **0** · `perf-baseline`（`--expose-gc`）**0** · `perf-baseline`（无 gc）**0** · `perf-baseline` 二次**0** · `release.ps1 -LocalOnly` **0**（38/38，3586ms）· `git diff --check` **0**。

| 验收项 | 结果 |
|---|---|
| pack-inventory 数字 | **零差异**——18 files / 861935 / 303588 / shasum `4f93975d…` / 102 tracked / 2899523 bytes / 3×（18 files, 861935），全部被原生 npm+git+FS 独立复现 |
| 补测 | tgz `sha256 = 1add6b4f2e09823ba918802f0b9d0b365474ecad0e339836ea1239de72dd99c9` |
| 确定性 | 3 次运行 5 档 sha256 **逐字节一致**；真实档 refresh median 4.915 / 4.139 / 3.915，重跑偏差 ≤18.8% |
| 真 import 排查 | `perf-baseline.mjs:44-52` 真 import `../plugin-market/lib/catalog.js`；全文**零个** catalog 函数本地定义；无网络 API |
| `catalog.js` sha256 | `AB78AF0A61E76AC4CF30633DAF57AFBED43A69439A0E8B3DB21B2FA70DACC4FD`（与 HEAD 逐字节一致） |
| 分辨力 | noop 0.0001ms vs 已知工作量 0.85–0.93ms → **8504–9349×**；normalize 随规模严格递增 0.100→13.005ms |
| 红线 | `plugin-market/` **CLEAN**、版本 1.3.1（worktree=HEAD）、package.json 未变、无新依赖、无删除、HEAD 仍 `0363650`（reflog 无新条目）、无 Profile 写入、`%TEMP%` 无 `pack-inv-*`/tgz 遗留 |

**独立验收提出 3 条缺陷，处置如下**：

| 编号 | 严重度 | 内容 | 本轮处置 |
|---|---|---|---|
| **D1** | 中 | 本报告 §3.4 分辨力清单与脚本 JSON 不一致（误列 `synthetic-100/categoryCounts`，漏列 `sortPlugins:top`/`joinInstalled`） | **已修正**（§3.4） |
| **D2** | 高 | `refresh-chain` 命名歧义（热复用 6.99 vs 冷刷新 21.2 vs 含 parse 72.6）；`ui` 类条数应为 **764** 而非「约 200」 | **已修正**（§3.3） |
| **D3** | 中 | `synthetic-100` 的 chain(0.0755ms) < 其必经组件 normalize(0.0995ms)，超集快于子集，`RESOLUTION_MIN_MS=0.01` 未拦住 | **如实记录、本轮不改脚本**（改了会与已验收产物脱钩），见 §3.4 与 §6③-附 |

---

## 8. 交付物

| 文件 | 说明 | 状态 |
|---|---|---|
| `verify/pack-inventory.mjs` | 离线包体清点，`node verify/pack-inventory.mjs` → exit 0 | 新增（未提交） |
| `verify/perf-baseline.mjs` | 离线微基准，`node --expose-gc verify/perf-baseline.mjs` → exit 0 | 新增（未提交） |
| `docs/PERF-AUDIT.md` | 本报告 | 新增（未提交） |
| `verify/PERF-VERIFY.md` | 独立复跑与红线验收（24,592 字节） | 新增（未提交） |

---

## 9. 红线合规声明

| 红线 | 状态 | 证据 |
|---|---|---|
| 不改运行逻辑 | ✅ | `plugin-market/` 下**零改动**（Lead 与独立验收双方确认） |
| 不删文件 | ✅ | 无 `git rm`、无删除操作 |
| 不加运行时依赖 | ✅ | `plugin-market/package.json` 未改；两个脚本只用 `node:` 内置 |
| 不改 API 契约 | ✅ | `docs/API-CONTRACT.md` 未改 |
| 不更新版本 | ✅ | 仍为 `1.3.1`（worktree = HEAD） |
| 不发布 / 不推送 | ✅ | 无 `git push`、无 tag、无 `npm publish`；HEAD 仍 `0363650` |
| 基准离线 | ✅ | 无网络调用；`npm pack` 用本地缓存 |
| 不访问真实网络 | ✅ | 只用仓库内 `_ref/data/plugins.json` 快照 |
| 不修改用户 Profile | ✅ | 只读枚举 `C:\Users\28062\.dsh`；未写入；`desktop` profile 未被触碰 |
| 不生成不可控大文件 | ✅ | tgz 测完即删；`%TEMP%` 无本任务遗留 |

---

## 10. 已知未测量项（明确列出，不推测）

1. **真实 HTTP 抓取**耗时（上游镜像延迟、TLS、重定向）——离线基准不测。上游快照**今日**规模亦未联网复核（用的是仓库内快照）。
2. **宿主事件循环竞争**下的实际延迟（本基准是单进程同步计时；宿主同时在跑流式输出）。
3. **客户端浏览器渲染**成本与内存（`market-perf.probe.mjs` 覆盖交互延迟，但本轮未重跑）。
4. **长时间运行的内存泄漏**（未做 soak 测试）。
5. **冷启动首搜**：搜索路径有模块级记忆化，重复迭代命中缓存 → 本基准测的是**热缓存重复请求**，冷启动首次会更慢。
6. **`npm pack` 的 gzip 压缩级别**：npm 用自身默认（非 `-9`）；本报告的分文件 gzip 用 level 6 作**占比**参考。
7. 多标签页 / 多 profile 并发下的表现。

---

## 11. TASK-PERF-02：基准缺陷修复 + 包体优化实施

> 本节的数字**全部为实测**。**本任务实际改动 5 个文件**：`verify/perf-baseline.mjs`、`verify/pack-inventory.mjs`、`plugin-market/package.json`、`docs/PERF-AUDIT.md`、`verify/PERF-VERIFY.md`（+ 新增 `verify/PERF02-VERIFY.md`）。
> ⚠️ **范围澄清**：`git status` 里另有 `.gitignore | 10 +++` 与三个未跟踪的 `docs/SESSION-CLEANER-CLONE-*.md`——那是**前序任务遗留**（复刻手册证据源，mtime 2026-10-13），**不属于本次改动**，本轮未触碰。
> **未改任何运行逻辑**（`plugin-market/lib/**` 与 `cordis.patch.yml` 零改动，`git diff --name-only` 为空）、**未升版本**（仍 1.3.1）、**未打 tag、未发布、未推送**。

### 11.1 阶段 A：基准可信度缺陷的根因与修复

#### 根因（实测判定，不是猜测）

D3 现象：`synthetic-100` 的 `refresh-chain` median **0.0755ms** < 其必经组件 `normalizeCatalog` **0.0995ms**。

**根因是测量设计，不是算术错误**：两个操作各自跑一次独立的 `bench()`，各自 warmup、各自连续取样 ⇒ **不共享 JIT 优化状态、不共享 GC 节奏、不共享折叠缓存**。在 0.1ms 量级上两次独立 pass 的中位数可差 ±40%，谁大谁小近乎掷硬币。

复现实验（`synthetic-100`，直接用真实实现）：

| 测法 | refresh-chain median | normalizeCatalog median | 倒挂？ | chain/组件 |
|---|---|---|---|---|
| 独立 pass（旧口径，normalize 先） | 0.0681 | 0.0255 | 否 | 2.67 |
| 独立 pass（旧口径，chain 先） | 0.0648 | 0.0224 | 否 | 2.89 |
| **交错 pass（新口径）** | 0.0576 | 0.0226 | 否 | **2.55** |
| 交错 pass ×8 轮 | — | — | **0/8** | 2.300–2.399 |

交错后比值**稳定在 2.30–2.40、8 轮 0 次倒挂**；独立 pass 下同一份代码出现过 0.099 vs 0.100 的持平与倒挂。**结论：只有交错口径下「链路 ≥ 其必经组件」才是一条成立的断言**；在独立 pass 下套这条断言就是任务书禁止的「机械套用不成立的约束」。

#### 修复内容

| # | 改动 | 说明 |
|---|---|---|
| 1 | 新增 `benchInterleaved(pairs, n)` | 链路变体与其必经组件在**同一次 pass 内轮流取样**，共享 JIT/GC/缓存状态 |
| 2 | 新增 `isChainConsistent(chainMedian, componentMedian)` | 一致性判据的**唯一实现**，真判定与自检共用（避免自检只测副本） |
| 3 | 新增 `unreliableCells` + `unreliable` 标记 | 倒挂的格子标 `unreliable`，写入 JSON 的 `chainConsistency.unreliableCells` 与 `untested`，**不进可信结论** |
| 4 | 倒挂**不算失败退出** | `process.exitCode` 仍为 0；否则正常测量噪声会频繁产生假红（A3 明确要求） |
| 5 | **口径重命名**（原 D2） | 一个 `refresh-chain` 拆成三个自解释 label：`refresh-chain:query+category (warm)` / `refresh-chain:query only / category=all (warm)` / `refresh-chain:no query / browse (warm)` |
| 6 | 新增 `coldStart` | 进程内**首次**调用（折叠缓存冷）单独 n=1 记录，并注明「不可当分布、不与热态中位数直接比较」 |
| 7 | 新增 `detectorSelfTest` | 用**故意倒挂的伪造对**走真判定函数，证明守护逻辑会触发（见 11.2） |
| 8 | schema `@1` → `@2` | 报告结构有破坏性变化（opp label 改名、新增字段），版本号必须跟进 |
| 9 | `pack-inventory.mjs` 硬编码 | `Same 18 entries` → `Same ${d.fileCount} entries`（否则移除 CHANGELOG 后该句变成假话） |

**未做的事**（任务书禁止）：**没有**调整 `RESOLUTION_MIN_MS` 阈值来让矛盾数据「变绿」；**没有**删除失败样本或忽略离群值；**没有**降低验收标准。`RESOLUTION_MIN_MS` 保持 **0.01ms** 原值不变。

#### 修复后结果（实测）

> ⚠️ **单次运行样本**：下表 median 来自一次 `--expose-gc` 运行。同机复跑漂移大（独立复核者 4 次复跑：real-4412 组件 median 2.91–4.79ms，本表 7.51ms 偏高 1.6–2.6×；synthetic-100 组件 0.049–0.080ms，本表 0.135ms）。**绝对值只可作量级参考；稳健的是方向性结论**：4 次复跑 ×15 组比值全部 >1（1.14–8.00×）、倒挂 0——这才是本修复的验收点。

```
node --expose-gc verify/perf-baseline.mjs   → exit 0
node verify/perf-baseline.mjs               → exit 0（内存如实标「未测（需 --expose-gc）」）
```

| 档位 | 链路变体 | 组件 normalizeCatalog | 链路 median | 比值 | 一致？ |
|---|---|---|---|---|---|
| synthetic-100 | query+category | 0.1347 | 0.1738 | 1.29× | ✓ |
| synthetic-100 | query only (all) | 0.1347 | 0.3065 | 2.28× | ✓ |
| synthetic-100 | no query / browse | 0.1347 | 0.1822 | 1.35× | ✓ |
| synthetic-1000 | query+category | 0.8567 | 0.9820 | 1.15× | ✓ |
| synthetic-1000 | query only (all) | 0.8567 | 2.4053 | 2.81× | ✓ |
| synthetic-1000 | no query / browse | 0.8567 | 1.1257 | 1.31× | ✓ |
| synthetic-5000 | query+category | 3.0518 | 3.9399 | 1.29× | ✓ |
| synthetic-5000 | query only (all) | 3.0518 | 12.168 | 3.99× | ✓ |
| synthetic-5000 | no query / browse | 3.0518 | 4.5637 | 1.50× | ✓ |
| synthetic-20000 | query+category | 12.0275 | 16.944 | 1.41× | ✓ |
| synthetic-20000 | query only (all) | 12.0275 | 88.076 | 7.32× | ✓ |
| synthetic-20000 | no query / browse | 12.0275 | 24.914 | 2.07× | ✓ |
| **real-4412** | query+category | **7.5064** | **9.6073** | 1.28× | ✓ |
| **real-4412** | query only (all) | **7.5064** | **19.957** | 2.66× | ✓ |
| **real-4412** | no query / browse | **7.5064** | **11.130** | 1.48× | ✓ |

**合计 15 组，倒挂 0 组。** `invertedCount = 0`，`unreliableCells = []`，`normalizeStrictlyIncreasing = true`。

> **口径澄清（重要，防止误引）**：新口径下 real-4412 的 `query only / category=all` 是 **19.96ms**，旧报告 §3.3 记的是 15.89ms。两者**不矛盾**——旧值来自独立 pass，新值来自交错 pass（与组件共享 GC 节奏，本就更保守）。**新值更可信**，因为它的比较对象（组件 7.51ms）是同一口径取的。

### 11.2 可信度守护不是死代码（反例检验，实测）

要求 A3：「原有的小规模异常场景能够被识别，不再作为可信数据输出」。**光有 0 倒挂不能证明守护会触发**——那可能只是数据恰好没触发。做了两件事：

1. **`detectorSelfTest`**（每次运行都跑）：直接调用真判定函数 `isChainConsistent`，喂入 `(0.1, 0.5)` 必须判不通过、`(0.5, 0.1)` 必须通过、`(0.25, 0.25)` 必须通过（`≥` 语义）。实测 `{"checked":true,"invertsDetected":true,"consistentAccepted":true,"equalityAccepted":true,"pass":true}`。**自检调用的是真函数、不是谓词副本**（否则只能证明副本正确）。
2. **端到端反例**：把脚本副本放进 `%TEMP%`，把某条链路改成 `return 1`（故意比组件快），确认该组 `consistent:false`、`unreliableCells` 非空、**且退出码仍为 0**。详见 `verify/PERF02-VERIFY.md`。

### 11.3 阶段 B：包体优化（实测前后对照）

#### 前置核查（B1）——确认移除不破坏既有使用方式

| 检查项 | 结果 |
|---|---|
| 运行时是否 import `CHANGELOG.md` | **否**（`main` = `lib/index.js`；`exports` 只暴露 `./lib/index.js`、`./lib/client.js`、`./package.json`） |
| `scripts/release.ps1` 从哪读 CHANGELOG | **仓库**：`Join-Path $pkgDir 'CHANGELOG.md'`（L198 版本声明、L574 Release notes）。**不读 npm 包** ⇒ 不受影响 |
| 测试是否断言「npm 包必须含 CHANGELOG」 | **否**（全仓仅 `verify/ps-encoding.test.mjs` 出现该字符串，且是 PowerShell 编码夹具的字面量，与打包无关） |
| 浏览器 E2E / `ui-check.ps1` 是否依赖 | **否** |
| `verify/pack-inventory.mjs` 是否硬编码 18 | 原为 `Same 18 entries` 文案，**已改为动态** `${d.fileCount}` |
| 「改动是否有既有测试兜底」 | 有：`release-workflow.test.mjs`（发布流程）、门禁 38/38 |

#### 实施与实测结果（B3）

**改动**：`plugin-market/package.json` 的 `files` 白名单去掉一行 `"CHANGELOG.md"`。**仅此一处**。

| 指标 | 优化前 | 优化后 | 差额 |
|---|---|---|---|
| 压缩包 tgz | **303,588** 字节 | **227,751** 字节 | **−75,837（−25.0%）** |
| 解压后 unpackedSize | **861,935** 字节 | **691,578** 字节 | **−170,357（−19.8%）** |
| 文件条目数 | 18 | **17** | −1 |
| 压缩比 | 2.839× | 3.037× | — |
| npm 自报 size vs 磁盘 tgz | delta 0 | delta 0 | — |

**与 TASK-PERF-01 预测一致**：预测 227,751，实测 **227,751**（精确命中，非巧合——同一份 `files` 与同一台 npm）。

清单差异（17 条，CHANGELOG.md 已移除，其余全部保留）：

```
LICENSE  cordis.patch.yml  package.json  README.md  README.zh.md
lib/catalog-npm.js  lib/catalog.js  lib/client.js  lib/github-routes.js
lib/hot-mount.js  lib/http-body.js  lib/http.js  lib/index.js
lib/restart-helper.cjs  lib/restart-policy.js  lib/restart.js  lib/self-update.js
```

**关键文件仍在**：`README.md`、`README.zh.md`、`LICENSE`、`package.json`、`cordis.patch.yml`、`lib/index.js`（`main`）、`lib/client.js`（`exports["./client"]`）——**逐条确认在 17 条清单内**。

**仓库内 `CHANGELOG.md` 完整保留**：未被删除、未被修改（`git status` 无该文件改动；内容 sha256 与 `a314349` 时相同）。历史记录无损。

> **不受影响的证据**：`release.ps1 -Bump auto` 的版本声明与 Release notes 都从 `plugin-market/CHANGELOG.md`（仓库路径）读取，与 npm 包内容无关。本次未升版本，故该路径未被触发，但代码路径已核实。

### 11.4 阶段 C：回归与安全检查（真实退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node verify/pack-inventory.mjs` | **0** | 17 条 / 691,578 / 227,751 |
| `node --expose-gc verify/perf-baseline.mjs` | **0** | 15/15 组一致，0 倒挂 |
| `node verify/perf-baseline.mjs`（无 gc） | **0** | 内存如实标「未测（需 --expose-gc）」 |
| `node --check verify/perf-baseline.mjs` | **0** | — |
| `node --check verify/pack-inventory.mjs` | **0** | — |
| `git diff --check` | **0** | 无空白错误 |
| `pwsh -NoProfile -File scripts/release.ps1 -LocalOnly` | **0** | 回归测试通过 **38/38**（墙钟 3200ms；Lead 与独立复核者各跑一遍，均 38/38） |
| `pwsh -NoProfile -File verify/ui-check.ps1` | **0** | **真实浏览器验收 129/129 通过**、18 个检查组全绿（独立复核者执行；用的 scratch 宿主在仓库内 `_verify/dshhome`，未触碰用户 Profile，跑完 `git status` 无新增）。注：复核会话本身在发送总结阶段中断，但报告 `verify/PERF02-VERIFY.md` 已完整落盘（27,380 字节），上表数字取自该报告 |

**API 契约测试**：含在门禁 38 套内，全绿。**安装 / 更新 / 卸载 / 重启流程**：`plugin-market/lib/**` 零改动，故行为逐字节不变。

### 11.5 风险与后续建议

| 项 | 评估 |
|---|---|
| npm 页面少了 CHANGELOG 链接 | **已知取舍**。用户仍可通过 GitHub 仓库 / Release notes 查看完整变更记录；`homepage` 与 `repository` 字段都指向 GitHub |
| 阈值 `RESOLUTION_MIN_MS = 0.01` 未动 | **刻意保留**。D3 的矛盾量与阈值无关（0.0755 > 0.01），改阈值只会掩盖问题；真修法是交错口径 + 一致性判据 |
| 一致性判据只在交错口径下有效 | **已在脚本注释与 §11.1 写明**，防止后人把它套到独立 pass 的组件上 |
| 冷启动仍只测 n=1 | 进程内真正「冷」只有第一次，无法重复采样；**如实标注为单次观测**，不当分布 |
| 未实施「`joinInstalled` 记忆化」 | 任务书明确禁止（§7「不缓存 `joinInstalled`」）。该建议仍在 §6②，待人工决定 |

**下一步建议**（不超出本任务范围，供人工决定）：
1. 本轮改动提交后，下一次发版时留意 `release.ps1 -Bump auto` 与 Release notes 仍正常（预期正常：读的是仓库文件）。
2. `§6② joinInstalled 记忆化` 若要做，需独立任务 + 独立测试（键须含 bundles 变更）。
3. `§6③` 的链路口径已在本轮完成；冷刷新如需**分布**而非单次观测，须另起进程逐次采样。
