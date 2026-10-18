# TASK-PERF-02 独立复核报告

> 复核者：`perf02-verify`（**独立于作者**；作者改动的 5 个文件**只读**，本报告是唯一写入）
> 复核时间：2026-10-18 20:37–20:57（Asia/Shanghai）
> 仓库：`E:\AI\DeepSeek Harness\Dsh`（junction → `E:\Code\dsh-plugin-market`），分支 `main`
> 起点 HEAD：`a3143498ed5497b794485f97211ef7d6f148366f`（`docs(perf): TASK-PERF-01 …`）——**复核全程 HEAD 未变**
> 环境：Node **v24.21.0**、npm **12.2.0**、PowerShell **7.6.6**、Windows

**结论一句话**：功能与红线**全部实测通过**；发现 **3 项文档/范围层面的差异**（无功能性缺陷、无假绿灯）：① 第 6 个被改文件 `.gitignore` 未列入 `PERF-AUDIT.md` §11 的文件清单；② `PERF-AUDIT.md` 遗留的基线数字（102 tracked / 2,899,523 B）已被本次改动变为陈旧且精确值不可复现（差 20 B）；③ §11.1「实测」中位数绝对值**不可复现**（本人 4 次运行全部落在其区间外，真实档组件差达 2.6×），但**比值结论稳健**。

---

## 1. 被复核对象的指纹（复核前后一致，无中途改动）

| 文件 | sha256（复核对齐时刻） |
|---|---|
| `verify/perf-baseline.mjs` | `0301D73D972E13ACEE5EEECFC53388550B7CD5B14259AE10CD3FFA998B0C177A` |
| `verify/pack-inventory.mjs` | `0EEDBDF9DC1F76C0CF59CD4160B3C42BD93E09CCA2CFB99B145772895AB69E57` |
| `plugin-market/package.json` | `7D1279957CAECD43A61FDA1AFAEAAD70AADE2DD7BCB7CBAF6FCF503FF55D1497` |
| `docs/PERF-AUDIT.md` | `5AB67CD5810E60CA5A87C63B64DBDE09D0D771B74FFF0F792A5B8187FBB05E25` |
| `verify/PERF-VERIFY.md` | `017D0C9325259E43117D9FC90C01A5119214E79FC1758DD179FEB6C966098030` |
| `.gitignore` | `94EE3FA1EAC798D6…`（见 §5 差异 D1） |

复核开始时与结束时两次取样哈希相同（跨全部 8 组命令）。`perf-baseline.mjs` 的 sha256 在复核全过程中为 `0301D73D…`，未漂移。

---

## 2. 命令与真实退出码总表

| # | 命令 | 退出码 | 判定 |
|---|---|---|---|
| 1a | `node --check verify/perf-baseline.mjs` | **0** | 通过 |
| 1b | `node --check verify/pack-inventory.mjs` | **0** | 通过 |
| 2a | `node --expose-gc verify/perf-baseline.mjs`（第 1 遍） | **0** | 通过 |
| 2b | 同上（第 2 遍） | **0** | 通过 |
| 2c | 同上（第 3 遍） | **0** | 通过 |
| 2d | `node verify/perf-baseline.mjs`（无 gc，1 遍） | **0** | 通过，内存如实标「未测」 |
| 3 | 反例检验：`%TEMP%` 副本（链路改 `return 1`） | **0** | **通过**：5 组倒挂、`unreliableCells` 非空、退出码仍 0 |
| 3b | 反例检验 B：仅把判据 `>=` 改成 `>`（单一实现处） | **3** | **自检有牙**：`detectorSelfTest.pass=false` 且非零退出 |
| 4 | `node verify/pack-inventory.mjs` | **0** | 通过，`failures: 0` |
| 5 | `git diff --check` | **0** | 无空白错误 |
| 6 | `pwsh -NoProfile -File scripts/release.ps1 -LocalOnly` | **0** | 门禁通过，回归 **38/38** |
| 7 | `pwsh -NoProfile -File verify/ui-check.ps1` | **0** | **129/129 通过**（非环境失败） |
| 8 | 独立复算：`npm pack`（真打包）+ `tar -tzf` | **0** | tgz 227,751 B、17 条 |

---

## 3. 基准脚本（`perf-baseline.mjs`）逐项断言

### 3.1 schema / 一致性 / 可信度（4 次运行全绿）

| 断言 | gc-1 | gc-2 | gc-3 | 无 gc |
|---|---|---|---|---|
| `schema === "dsh-plugin-market/perf-baseline@2"` | ✅ | ✅ | ✅ | ✅ |
| `chainConsistency.invertedCount === 0` | ✅ | ✅ | ✅ | ✅ |
| `chainConsistency.detectorSelfTest.pass === true` | ✅ | ✅ | ✅ | ✅ |
| `chainConsistency.unreliableCells` 为空 | ✅ | ✅ | ✅ | ✅ |
| `pairs.length === 15`，**每组** `consistent === true` | ✅ 15/15 | ✅ 15/15 | ✅ 15/15 | ✅ 15/15 |

> 注：顶层**没有** `unreliableCells` 键，它在 `chainConsistency.unreliableCells` 下（`perf-baseline.mjs` L562）。任务书写的是顶层名，实际 schema 是嵌套；按嵌套读，4 次均为 `[]`。

### 3.2 五档 fixture sha256 在四次运行间一致

| 档位 | count | sha256 | gc-1/2/3/无 gc |
|---|---|---|---|
| `synthetic-100` | 100 | `e8d9bdb0644ef738ed5a23499c177a4c469016f61f319268857c15a4e2536e29` | 4/4 一致 |
| `synthetic-1000` | 1000 | `17682e69cc5b751b0cc36387b6a3e78ccf218d458e3c778ee60b8b2f6d9f7482` | 4/4 一致 |
| `synthetic-5000` | 5000 | `cd34a87c5cca3f10e9e91987881989fa846555502a2205f37c6a043d7d05e229` | 4/4 一致 |
| `synthetic-20000` | 20000 | `3d920bc5b2e010f5ae738e51e23ccdef9a8a0ae6772828424041e586f0af6b2e` | 4/4 一致 |
| `real-snapshot-4412` | 4412 | `f3d03c931ebdb299e8a0fa5dce5fba69eb7d68244d2a9485b5aa8ddb853a9c5b` | 4/4 一致 |

`_ref/data/plugins.json` 存在且被真实读到（5,298,280 B），真实档非兜底。

### 3.3 每组链路的 组件/链路 median 与比值（实测，4 次运行）

| 档位 | 链路变体 | gc-1 组件/链路 (ms) | gc-1 比值 | gc-2 | gc-3 | 无 gc | 一致 |
|---|---|---|---|---|---|---|---|
| synthetic-100 | query+category | 0.051/0.063 | 1.25 | 1.31 | 1.27 | 1.20 | ✅ |
| synthetic-100 | query only / all | 0.051/0.123 | 2.44 | 2.56 | 2.45 | 2.38 | ✅ |
| synthetic-100 | no query / browse | 0.051/0.061 | 1.21 | 1.26 | 1.24 | 1.14 | ✅ |
| synthetic-1000 | query+category | 0.623/0.739 | 1.19 | 1.16 | 1.16 | 1.17 | ✅ |
| synthetic-1000 | query only / all | 0.623/1.789 | 2.87 | 2.72 | 2.69 | 2.74 | ✅ |
| synthetic-1000 | no query / browse | 0.623/0.855 | 1.37 | 1.36 | 1.33 | 1.34 | ✅ |
| synthetic-5000 | query+category | 4.526/5.391 | 1.19 | 1.18 | 1.20 | 1.22 | ✅ |
| synthetic-5000 | query only / all | 4.526/15.046 | 3.32 | 3.37 | 3.27 | 3.79 | ✅ |
| synthetic-5000 | no query / browse | 4.526/6.603 | 1.46 | 1.45 | 1.52 | 1.42 | ✅ |
| synthetic-20000 | query+category | 16.805/22.793 | 1.36 | 1.31 | 1.37 | 1.45 | ✅ |
| synthetic-20000 | query only / all | 16.805/134.503 | 8.00 | 7.66 | 7.33 | 7.74 | ✅ |
| synthetic-20000 | no query / browse | 16.805/28.886 | 1.72 | 1.85 | 1.71 | 1.85 | ✅ |
| real-4412 | query+category | 4.538/6.358 | 1.40 | 1.49 | 1.57 | 1.46 | ✅ |
| real-4412 | query only / all | 4.538/14.665 | 3.23 | 3.37 | 3.50 | 3.47 | ✅ |
| real-4412 | no query / browse | 4.538/7.565 | 1.67 | 1.76 | 1.89 | 1.70 | ✅ |

**0 组倒挂**，4 次运行一致；TASK-PERF-01 验收 D3（`synthetic-100` 链路快于组件）**已消除**。`normalizeStrictlyIncreasing = true`。

### 3.4 无 gc 时如实降级

`node verify/pack-inventory.mjs`（无 `--expose-gc`）→ `command: "node verify/perf-baseline.mjs"`，`memory` 五档全为 `未测（需 --expose-gc）`，控制台打印「内存：未测（需 --expose-gc）——不在本机做任何推算。」**未编造数值**。

---

## 4. 关键：自检是否真的调用真判定函数（源码证据）

| 位置 | 内容 | 证据 |
|---|---|---|
| `verify/perf-baseline.mjs` **L333–336** | 判据**唯一实现**：`function isChainConsistent(chainMedian, componentMedian) { return chainMedian >= componentMedian }` | 全文件 `grep isChainConsistent` 只有 4 处命中 |
| **L405** | 真判定处：`const consistent = isChainConsistent(m.median, component.median)` | 每条链路都走这个函数 |
| **L503–515** | 自检块：L505/506/507 三行**直接调用同一个 `isChainConsistent`**，喂 `(0.1,0.5)` / `(0.5,0.1)` / `(0.25,0.25)` | 无第二份谓词副本 |

**结论：自检调用的是真函数，不是复制一份谓词。** 并且我做了**变异检验**来证明这一点不是「读代码猜的」：

**反例检验 B（只改判据一处，链路实现不动）**
```powershell
# 在 %TEMP% 副本里，仅把 334 行的 >= 改成 >
$T="$env:TEMP\perf02mut"; New-Item -ItemType Directory -Force -Path "$T\verify" | Out-Null
Copy-Item "E:\Code\dsh-plugin-market\verify\perf-baseline.mjs" "$T\verify\perf-baseline.mjs"
cmd /c mklink /J "$T\plugin-market" "E:\Code\dsh-plugin-market\plugin-market"
cmd /c mklink /J "$T\_ref"          "E:\Code\dsh-plugin-market\_ref"
node -e "…替换 '  return chainMedian >= componentMedian' → '  return chainMedian > componentMedian'…"
node --expose-gc "$T\verify\perf-baseline.mjs"
```
**真实退出码 = 3**，JSON 片段：
```json
"detectorSelfTest": {"checked":true,"invertsDetected":true,"consistentAccepted":true,"equalityAccepted":false,"pass":false}
"invertedCount": 0, "unreliableCells": []   // 实现未动，故无倒挂；但相等语义被自检抓到
```
`(0.25, 0.25)` 在 `>` 下变 false → `equalityAccepted:false` → `pass:false` → `failures` 非空 → `exitCode=3`。
**这证明：自检确实挂在真函数上（改它就翻），且自检失败会走非零退出。**

---

## 5. 反例检验（守护逻辑不是死代码）——最重要的一条

**做法**：不动仓库文件。把 `perf-baseline.mjs` 复制到 `%TEMP%`，用 junction 指回真实 `plugin-market/lib` 与 `_ref`，只把
`refresh-chain:no query / browse (warm)` 的 `run` 改成 `return 1`（**故意比它必经的 `normalizeCatalog` 快**），再跑。

```powershell
$T="$env:TEMP\perf02repo"
New-Item -ItemType Directory -Force -Path "$T\verify" | Out-Null
Copy-Item "E:\Code\dsh-plugin-market\verify\perf-baseline.mjs" "$T\verify\perf-baseline.mjs"
cmd /c mklink /J "$T\plugin-market" "E:\Code\dsh-plugin-market\plugin-market"
cmd /c mklink /J "$T\_ref"          "E:\Code\dsh-plugin-market\_ref"
# 副本内把这个变体的 run 改成：  run: (_tier) => { return 1 }
node --check "$T\verify\perf-baseline.mjs"          # → 0
node --expose-gc "$T\verify\perf-baseline.mjs"      # → 0  ← 关键：不可信 ≠ 失败
```

**退出码 = 0**（stderr 长度 0）。JSON 片段（真实输出，未经改写）：
```json
{
  "invertedCount": 5,
  "detectorSelfTest": {"checked":true,"invertsDetected":true,"consistentAccepted":true,"equalityAccepted":true,"pass":true},
  "unreliableCount": 5,
  "firstUnreliable": {
    "tier": "synthetic-100",
    "op": "refresh-chain:no query / browse (warm)",
    "median": 0.0002, "componentMedian": 0.04905, "ratio": 0.004077,
    "reason": "链路 median 0.0002ms < 必经组件 normalizeCatalog 0.0490ms（超集快于子集）⇒ 该格在本次运行的噪声下不可信"
  },
  "badPair": {
    "tier": "synthetic-100", "op": "refresh-chain:no query / browse (warm)",
    "componentMedian": 0.04905, "chainMedian": 0.0002, "ratio": 0.004077, "consistent": false
  }
}
```
5 个档位**全部**被标：`synthetic-100 / -1000 / -5000 / -20000 / real-snapshot-4412`。控制台同时给出：
```
  合计 15 组，倒挂 5 组 —— 这些格子已标 unreliable，不进可信结论
本轮不可信（已排除在可信结论之外，非失败）：
  ⚠ synthetic-100 / refresh-chain:no query / browse (warm): …
```
`tiers[0].ops['refresh-chain:no query / browse (warm)'].unreliable === true`，该组同时因 median 0.0002 < 0.01 被列入 `resolution.insufficientCells`，并写入报告 `untested[]`。

**判定**：守护逻辑**会触发**、**会写入机器可读 JSON**、**且不产生假红**（退出码 0）。作者在 `docs/PERF-AUDIT.md` §11.2 与 `verify/PERF-VERIFY.md` 附录中的对应声明**成立**。

> 清理：两个 `%TEMP%` 副本（`perf02repo`、`perf02mut`、`perf02base`）已**先删 junction 再删目录**，删除后确认 `plugin-market/lib/index.js` 与 `_ref/data/plugins.json` 均仍在（`Test-Path` 双 True）。仓库未被副本影响。

---

## 6. 包体（`pack-inventory.mjs` + 原生 `npm pack`）逐项断言

### 6.1 命令与真实退出码
```
node verify/pack-inventory.mjs        → exit 0，failures: 0
（cwd=plugin-market）npm pack --dry-run --json     → exit 0
（cwd=plugin-market）npm pack --pack-destination … → exit 0，tar -tzf 列出 17 条
```

### 6.2 前后对照（全部实测，非估算）

| 指标 | 前（a314349 原 `package.json`，本人复现） | 后（当前 worktree） | 差额 |
|---|---|---|---|
| tgz 磁盘字节 | **303,588** | **227,751** | **−75,837（−24.98%）** |
| npm 自报 `size` | 303,588 | 227,751 | −75,837 |
| `unpackedSize` | **861,935** | **691,578** | −170,357（−19.76%） |
| 条目数 `fileCount` | **18** | **17** | −1 |
| 压缩比 | 2.839× | 3.037× | — |
| npm shasum | `4f93975d9c4d0c72460394da11fd48d478da98a7` | `d69877108ebb55921ed955349009d2401c196739` | — |
| 独立复算 tgz sha256 | — | `F8D037A0CD6AB3509677E647A350A38F0529CC7CF433AE49DAE0451D63B86DE0` | — |

「前」不是我抄文档：`cmd /c git show a314349:plugin-market/package.json > %TEMP%\perf02base\package.json` 后在该目录原生 `npm pack --dry-run --json`，得到 **18 条 / 861,935 / 303,588 / shasum `4f93975d…`**——与 TASK-PERF-01 基线**逐位相同**。

> 精确百分比是 **24.983%**，文档写「25.0%」属四舍五入，**不是**错报（差额 75,837 与 303,588−227,751 完全一致）。

### 6.3 关键文件仍在 / 已移除

17 条清单（`npm pack --dry-run --json` + 真 tgz `tar -tzf` 双向确认）：
```
LICENSE  README.md  README.zh.md  cordis.patch.yml  package.json
lib/index.js  lib/client.js  lib/catalog.js  lib/catalog-npm.js  lib/github-routes.js
lib/hot-mount.js  lib/http.js  lib/http-body.js  lib/restart.js  lib/restart-helper.cjs
lib/restart-policy.js  lib/self-update.js
```
| 断言 | 结果 |
|---|---|
| `README.md` / `README.zh.md` / `LICENSE` / `package.json` / `cordis.patch.yml` / `lib/index.js`（`main`）/ `lib/client.js`（`exports["./client"]`）在 17 条内 | ✅ 逐条命中 |
| `CHANGELOG.md` **不在**清单内 | ✅ |
| 无清单外多余条目 | ✅（其余全部 `lib/` 下） |
| 真 tgz 内条目数 = 17 | ✅（`package/…` 前缀 17 行） |

`pack-inventory.mjs` 的硬编码已修：L144 为 `` `Same ${d.fileCount} entries, two rulers: …` ``，实测输出 **「Same 17 entries…」**（旧文案会写死 18，移除后成假话）。

### 6.4 仓库内 `CHANGELOG.md` 原样保留（未被删除/修改）

| 证据 | 值 |
|---|---|
| `Test-Path plugin-market\CHANGELOG.md` | **True** |
| 文件字节数 | **170,337**（= a314349 blob 的 170,337） |
| `git hash-object plugin-market/CHANGELOG.md` | `5f46873bad3f6bf9995be05a2436195d635244dd` |
| `git rev-parse a314349:plugin-market/CHANGELOG.md` | `5f46873bad3f6bf9995be05a2436195d635244dd` ← **同一 blob** |
| sha256（工作区文件） | `10F32C13C0A497DC54327A6A12E3F44002A8F2B3250A21A68CAFB432FAE5760C` |
| `git status --short -- plugin-market/CHANGELOG.md` | 空 |
| `git diff --exit-code -- plugin-market/CHANGELOG.md` | **exit 0**（无差异） |

`git diff --stat -- plugin-market` 只显示 `package.json | 1 -`（即 `package.json` 只掉了一行），**没有** `CHANGELOG.md` 的 D/M。

---

## 7. 工作区原样报告

```
$ git diff --check      → exit 0（无输出）
$ git diff --stat
 .gitignore                 |  10 +++
 docs/PERF-AUDIT.md         | 171 +++++++++++++++++++++++++++++++++++++--
 plugin-market/package.json |   1 -
 verify/PERF-VERIFY.md      |  30 +++++++
 verify/pack-inventory.mjs  |   2 +-
 verify/perf-baseline.mjs   | 193 +++++++++++++++++++++++++++++++++++++++++----
 6 files changed, 381 insertions(+), 26 deletions(-)

$ git status --short
 M .gitignore
 M docs/PERF-AUDIT.md
 M plugin-market/package.json
 M verify/PERF-VERIFY.md
 M verify/pack-inventory.mjs
 M verify/perf-baseline.mjs
?? docs/SESSION-CLEANER-CLONE-APPENDIX.md
?? docs/SESSION-CLEANER-CLONE-GUIDE.md
?? docs/SESSION-CLEANER-CLONE-INDEX.md
```
关键 diff（`plugin-market/package.json` 的全部改动，只有这一处）：
```diff
     "README.zh.md",
-    "CHANGELOG.md",
     "LICENSE"
   ]
```

---

## 8. 回归与浏览器验收（真实退出码）

| 命令 | 退出码 | 实测结果 |
|---|---|---|
| `pwsh -NoProfile -File scripts/release.ps1 -LocalOnly` | **0** | `回归测试通过 38/38`（墙钟 3168 ms；最慢 body-lifecycle 2640ms）；`✓ 版本算术自检`、`✓ 档位判定自检`、`✓ node --check` 全部 12 个 lib 文件；`✓ 来源判定矩阵测试通过`；`LocalOnly：门禁通过，到此为止（不改版本、不打包、不提交、不发布）` |
| `pwsh -NoProfile -File verify/ui-check.ps1` | **0** | **`真实浏览器验收：129/129 通过`**；18 个检查组全绿；截图写入 `verify/logs/ui/` |

ui-check **未失败**，无需「如实报原因」——它是真通过（`✓` 计数 129，无 `✗`）。它用的 scratch 宿主是 `DSH_HOME=E:\Code\dsh-plugin-market\_verify\dshhome`（`_verify/` 在 `.gitignore` 内），**不是**用户真实 Profile；跑完后 `git status` 无新增文件。

---

## 9. 红线核查（逐条，本人独立执行）

| 红线 | 结论 | 独立证据 |
|---|---|---|
| 未升版本（仍 1.3.1） | ✅ | 工作区 `package.json` `version = "1.3.1"`；`git show a314349:plugin-market/package.json` 同为 1.3.1；`release.ps1` 亦打印 `当前 versionName=1.3.1 versionCode=10301`、`不递增` |
| 未创建 tag | ✅ | `git tag --points-at HEAD` → **空**；tag 列表止于既有 `v1.3.1`（该 tag 指向 `0363650`，非本 HEAD） |
| 未 npm publish / 未连网 | ✅（本地侧） | 两个脚本源码零网络 API：`perf-baseline.mjs` 只 import `node:crypto` / `node:fs` / `node:url`；全文件 `grep fetch|http|axios` 的 6 处命中**全是夹具字面量**（URL 字符串、能力名 `net.fetch`），无调用。`npm pack` 为纯本地打包。**未做抓包，见 §11 未验证项** |
| 未 git push | ✅（本地侧） | `origin/main == HEAD == a314349`；`git status -sb` = `## main...origin/main`（无 ahead/behind）；`git reflog -1` = `a314349 HEAD@{0}: commit: docs(perf)…`，**无新条目** |
| 未新增依赖 | ✅ | `package.json` 无 `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies`（均 null）；仓库无 lockfile 被跟踪；未生成 lockfile |
| 未删除仓库文件 | ✅ | `git diff --diff-filter=D --name-only` → 空（含 `--cached`）；`plugin-market/CHANGELOG.md` 同一 blob 未变（§6.4）；`git ls-tree -r a314349` = 106 文件，当前 `git ls-files` = 106 文件 |
| 未改运行逻辑 | ✅ | `git diff --stat -- plugin-market/lib plugin-market/cordis.patch.yml` → **空**；`plugin-market` 全部改动仅 `package.json` 掉 1 行 |
| 未动 API 契约 | ✅ | `main` / `exports` / `dsh.bundle.patch` / `engines` 字段逐字未变；diff 只碰 `files[]` 一项 |
| 无网络请求 | ✅（源码级） | 同「未连网」行 |
| 未写用户真实 Profile | ✅ | `%USERPROFILE%\.dsh` 的 `LastWriteTime` 在我 8 组命令**前后都是 `2026/10/18 20:16:56`**（本次会话全程未变）；`pack-inventory` 对 `.dsh` 只读枚举；`ui-check` 写的是仓库内 `_verify/dshhome` |

**改动文件范围核查（任务书说「只有 5 个」）**：实际 `git status` 有 **6 个 M**。第 6 个是 `.gitignore`（+10 行：忽略 `_research/`、`_tmp-scc/`、`docs/_build/`）——**见 §10 差异 D1**。三个 `?? docs/SESSION-CLEANER-CLONE-*.md` 的 mtime 为 **2026-10-13**（本任务之前），非本任务产物。

---

## 10. 发现的差异与缺陷（全部附最小复现）

### D1【范围·已披露但未列入清单】第 6 个被改文件 `.gitignore` 不在 `PERF-AUDIT.md` §11 的文件清单里

- 现象：`docs/PERF-AUDIT.md` §11.1（L516）声明「修改文件：`verify/perf-baseline.mjs`、`verify/pack-inventory.mjs`、`plugin-market/package.json`、本文件、`verify/PERF-VERIFY.md`」= **5 个**；实际工作区还有 `.gitignore | 10 +++`。任务书同样说「确认改动的只有上述 5 个文件」。
- 已披露：`verify/PERF-VERIFY.md` §8（L288）写了「`git diff --stat` 仅 `.gitignore`（+10 行，**非本任务改动**）」——即旧报告已把它标为**前序会话遗留**，`PERF-AUDIT.md` §11 未重复声明，于是两处口径不一致。
- 三个 `??` 的 SESSION-CLEANER 文档 mtime = 2026-10-13，佐证 `.gitignore` 那 +10 行是为**别的任务**（复刻手册证据源）加的，与 PERF-02 无关。
- 最小复现：`git status --short`（6 个 M）对比 `grep -n '修改文件' docs/PERF-AUDIT.md`（列 5 个）。
- 严重度：**低**（无功能影响，属范围口径）。建议：§11 的文件清单加一句「另 `.gitignore` +10 行为前序任务遗留，非本次改动」。

### D2【文档陈旧数字·精确值不可复现】`PERF-AUDIT.md` 仍写 102 tracked / 2,899,523 B，实际已是 106 / 3,022,004 B

- 现象：`docs/PERF-AUDIT.md` L17「仓库（tracked） 102 文件，2,899,523 字节」、L124「tracked 文件：**102**」、L456「…102 tracked / 2899523 bytes…」；而改动后的 `node verify/pack-inventory.mjs` 报 **106 tracked / 3,022,004 bytes**。
- 这**不是**本次改动引入的错（102 是 `a314349` 之前的口径：`a314349` 本身把 4 个审计文件入库，102 + 4 = 106），但本文件**正在被本次修改**却没同步这条基线，读者会两处打架。
- **精确值也不可复现**（我三种口径都算过）：

| 口径 | 102 个非审计文件字节和 |
|---|---|
| git blob 字节（`a314349`） | 2,895,717 |
| 干净检出（`git checkout-index`，ps1 归一为 CRLF） | 2,899,196 |
| 当前工作区（含 `.gitignore`/`package.json` 已改） | 2,899,503 |
| **文档声称** | **2,899,523** |

最接近的是当前工作区口径，仍差 **−20 B**。差异根因可证：`.gitattributes` 对 `*.ps1 text eol=crlf`，blob（LF）与工作区（CRLF）字节数天然不同（如 `verify/lib/Common.ps1`：blob 30,683 → 检出 31,388，差 705 = CRLF 数），故「按哪个口径数」必须写明，否则数字无法复算。
- 最小复现：
```powershell
git ls-tree -r a314349 | ... # 逐 blob git cat-file -s 求和 → 2,995,717+…（102 文件子集 = 2,895,717）
# 干净检出：GIT_INDEX_FILE=… ; git read-tree a314349 ; git checkout-index -a --prefix=<tmp>\w/
#   逐文件 Get-Item Length 求和（排除 4 个审计文件）→ 2,899,196
node -e "…当前 worktree 同 102 文件求和…" → 2,899,503
```
- 严重度：**低**（历史基线标注区，不影响本任务结论）。建议：§11 里补一行「tracked 现为 106 / 3,022,004 B（worktree 口径）；旧 102/2,899,523 为 `a314349` 前口径、且随叉盘/CRLF 口径浮动 ±20B」。

### D3【文档·绝对值不可复现】§11.1「修复后结果（实测）」的中位数本人复跑落在区间外（真实档组件差 2.6×）

- 文档 §11.1（L560–576）给了 15 行绝对值（组件 0.1347 / 0.8567 / 3.0518 / 12.0275 / 7.5064 等）。本人 4 次同机同版本复跑：

| 档位 | 文档组件 median | 本人 4 次组件 median | 偏离 |
|---|---|---|---|
| synthetic-100 | 0.1347 | 0.0493 / 0.0507 / 0.0756 / 0.0796 | 文档高 **1.7–2.7×** |
| synthetic-1000 | 0.8567 | 0.5235 / 0.6232 / 0.8245 / 0.8787 | 0.52–0.88，文档居中 |
| synthetic-5000 | 3.0518 | 2.8385 / 4.4819 / 4.5259 / 4.9846 | 差 −7%…+63% |
| synthetic-20000 | 12.0275 | 10.9477 / 10.9671 / 16.8046 / 17.8891 | 差 −9%…+49% |
| **real-4412** | **7.5064** | **2.9101 / 2.9101 / 4.5380 / 4.7871** | 文档高 **1.57–2.58×** |
| real-4412 query-only 链路 | 19.957 | 10.101 / 10.171 / 14.665 / 16.121 | 文档高于 4/4 次 |

- **但结论不受影响**：比值方向在 4 次运行、15 组上**全部一致**（1.14–1.89 / 1.19–1.57 / 2.38–8.00），倒挂 0。脚本自己的 `limits` 已写明「同机复跑也漂移，单次 median 只用于比量级」，文档也给了该免责——所以这是**单次样本的代表性问题**，不是错报。
- 严重度：**低**（结论稳健）。建议：§11.1 表格加「单次运行样本」标注，或给出 3 次运行的区间。

### 非差异：两条容易误读但成立的点（供答辩）

1. `unreliableCells` **不是**顶层键（顶层无此键），在 `chainConsistency.unreliableCells`；本报告按实际 schema 断言。
2. 反例检验里被改的链路同时被标 `⚠分辨力不足`（median 0.0002 < `RESOLUTION_MIN_MS` 0.01）——两条独立标记同时命中，属预期，`RESOLUTION_MIN_MS` 未被调用来「变绿」（grep 确认脚本内该常量仍是 `0.01`）。

---

## 11. 未验证项及原因（测不到就写测不到）

1. **内存档位数值未独立复算**：我只确认 `--expose-gc` 时五档 `status:"measured"`、峰值/retained 有值，无 gc 时如实 `未测`；**没有**自建独立探针复算 `peakDeltaBytes` / `retainedBytes`。
2. **零网络是源码级结论，非抓包**：`perf-baseline.mjs` / `pack-inventory.mjs` 无网络 API 调用（逐个 import 与 grep 已核），`npm pack` 本地打包；**未做 packet capture / 防火墙审计**，故不能声称「已证明网络零字节」。
3. **未 publish / 未 push 只有本地侧证据**：`origin/main == HEAD`、无新 reflog 条目、HEAD 无 tag、`%USERPROFILE%\.npm\_logs` 不存在。**未查** npm registry 端（不联网）与远端服务器日志。
4. **跨机/跨 Node 版本可比性未验**：只在本机 Node v24.21.0 复跑。
5. **`docs/PERF-AUDIT.md` §6① 的预测过程未复算**：我只复现了它的**实测前后**（18/861935/303588 → 17/691578/227751，逐位命中），未复算其预测方法。
6. **上游快照代表性未验**：`_ref/data/plugins.json` 是 2026-10-16 那份 4,412 条，离线要求下未重新抓取。
7. **`.gitignore` +10 行的归属**：mtime/内容指向「复刻手册证据源」这一**前序任务**，但我没有那次任务的会话记录，不能百分百断定非本次任务所加（见 D1）。
8. **`%TEMP%` 的 >5MB 遗留物**：未逐项归因（我自己的 `pack-inv-*` 与 tgz 已即时删除并复查不存在）。

---

## 12. 逐条对任务书的回答（可核对清单）

| 任务书要求 | 结果 |
|---|---|
| 1. 两个 `node --check` | 均 **exit 0** |
| 2. `--expose-gc` 跑 3 遍 + 无 gc 1 遍；`invertedCount=0`、`detectorSelfTest.pass=true`、`unreliableCells` 空 | 4/4 满足 |
| 2. 解析末行 `PERF_BASELINE_JSON`，断言每组 `consistent===true` | **60/60 组一致**（15 组 × 4 次），0 组 false |
| 2. 五档 sha256 三次一致 + `schema` 字符串 | 4/4 一致；schema 全为 `dsh-plugin-market/perf-baseline@2` |
| 3. 判据是否真被自检调用（给行号） | 是；定义 **L334**、真判定 **L405**、自检 **L505–507**；并有变异检验（exit **3**）佐证 |
| 4. 反例检验：链路故意快于组件 | 通过：5 组倒挂、`consistent:false`、`unreliableCells` 非空、**退出码仍 0** |
| 5. 17 条 / 691,578 / 227,751；303588→227751（−75,837 / 25.0%）；861935→691578 | 全部命中（精确 −24.983%）；关键 7 文件在清单内、CHANGELOG 不在 |
| 5. `CHANGELOG.md` 仍在仓库且未变（含 sha256） | 是：同一 blob `5f46873…`、sha256 `10F32C13…`、`git diff --exit-code` = 0 |
| 6. `git diff --check` / `--stat` / `status --short` 原样报告 | 已原样贴于 §7 |
| 7. `release.ps1 -LocalOnly` | **exit 0，38/38** |
| 8. `verify/ui-check.ps1` | **exit 0，129/129**（真通过，非环境失败） |
| 红线全项 | 9/9 合规（见 §9），唯一范围差异是 `.gitignore`（D1） |

**复核者签名**：`perf02-verify`，2026-10-18 20:57 +08:00。本文件是本次唯一写入；对上述 5 个作者文件**只读**（哈希见 §1，复核首尾一致）。
