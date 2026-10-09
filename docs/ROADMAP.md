# 功能开发方向研究（2026-10-07）

> **进度**：P0-a（截图）经用户 2026-10-07 判定**否定**——目录 4412 条里只有 874 条带截图，
> 多数插件根本没有图，为两成条目改造详情页不值。**P0-b（激活校验 + 版本回读）已实现**，
> 见 `plugin-market/CHANGELOG.md` 的 `## 1.2.0`。

本文件回答一个问题：**接下来该往哪做**。它不是愿望清单——每条方向都标了「数据/代码现状证据」
与代价，并且明确写了**什么不该做**。

判断基准是 [PLUGIN-MARKET §1.1 北极星](PLUGIN-MARKET.md)：**像手机应用市场那样的插件市场**。
所以排序不按「参考实现有什么」，而按「用户已有的心智在哪条腿上缺了一条」。

## 0. 结论先行

| 优先级 | 方向 | 依据的现状 | 代价 | 状态 |
|---|---|---|---|---|
| ~~P0~~ | ~~截图 + 能力红线~~ | 874/4412 带截图 | 中 | **否定**（用户判定：多数插件没有图） |
| **P0** | 让「装」和「更新」不说谎：装后激活校验 + 版本回读 | host 半只把宿主的 `application` 原样透传，**无法区分「装好了在跑」和「装了但没生效」** | 小 | **✅ 已完成（1.2.0）** |
| **P1** | 安装来源优先级：预构建 Release 包优先于整仓下载 | 333 条带 `tarball`；我们现在一律 `npm ?? url` | 中 | 待做 |
| **P2** | 诊断 / 加载顺序 / 备份快照 / 热开关 / 主题页 | 参考实现有，我们零代码 | 大（逐个独立立项） | 待做（**热开关已证伪，见 §0.3**） |
| **P1.5** | 自更新通道的激活校验 + 构建脚本批准入口 | `apply()` 不认 `pendingBuilds`，且客户端 `applySelfUpdate()` **无条件**亮绿灯；两者必须一起改（见 §0.2） | 中 | 待做 |
| **不做** | 收藏 / 备注 / 分组 / 评论 / 独立签名 / 内置快照 | 与「在侧边栏装/管插件」闭环无关或违反既有不变量 | — | — |

## 0.1 P0-b 的落地结果（1.2.0）

新增 `activation` 字段（`state` ∈ `live | restart | inert | broken | disabled | unknown`），
装完**回读**宿主列表：判定用**前后差集**而不是猜名字，所以不假设「包名 == bundle 名」。
三个关键取舍都写进了契约与 CHANGELOG：

1. **`restart-required` 优先于 `live`**——宿主的原话是还没生效，不因为条目在列表里就改口；
2. **`inert` / `broken` 不算成功**——它们会进「一键更新」的成功计数，谎报成功比不说更糟；
3. **`unknown` 是一等结果**——读不到就说读不到，并带 `reasons`。但 **`no-baseline` 与 `live` 可以并存**：
   认不出「谁装上的」，却认得出「它在列表里」，后者才是判据；把已知的「它在跑」降级成 `unknown`
   是另一种不诚实。

测试 27+31 条；**这 8 处语义逐个做过变异测试**（每处语义破坏一次，对应断言必须失败）：**8/8 全被抓到**。

## 0.2 P0-c 的落地结果（1.2.0 第二轮审查）

`verifyActivation` 的候选名**没去重**：同一个字符串出现多次被当成「多个候选都命中」→ 一律报
`ambiguous-bundle`。真实调用点的候选是 `[hit?.npm, hit?.name, hit?.id, requestedSpec, requestedName]`，
而客户端「更新」发的是 `{ name: bundle.name, spec: bundle.name }`——npm / name / requestedSpec /
requestedName 本来就是同一个值；更新**已装**插件时 `before` 里已有它（`appeared` 为空），
于是走「候选命中」分支，那里数的却是**出现次数**。

用真实目录（4412 条）量的影响面：**2288 个有 npm 的条目 100% 命中，修后 0%**。
用户可见后果有两层，第二层才是真正要命的：

1. 一次成功的更新被渲染成 `installUnknown`（「没能回读装载状态」）而不是绿色「已在运行」；
2. **`versionMatches:false` 那条「磁盘上还是旧版、更新没落地」的告警被整个盖掉**——
   走不到命中分支就根本不算版本，用户于是以为更新成功了。

修法是候选名先 `new Set()` 去重。回归加一条断言并带**反向断言**（两个**不同**名字各自命中
一个 bundle 时仍须报歧义，防止「去重」把真歧义一起抹掉）；**双向变异 2/2 全捕获**。

**为什么以前测不出来**：既有的 7 条相关断言**全都只传单个候选名**，从不传重复项。
这是本轮最值得记的一课——**断言喂的输入形状与真实调用点不一致时，测试全绿也挡不住这个 bug**。

**故意不修的一处（写下来，避免下次有人「顺手修好」）**：`self-update.js` 的 `apply()` 不认
`pendingBuilds`，规则与 `sendChangeResult` 不一致——但它**不可达**（市场包零依赖、无
`postinstall`），而**单方面放宽 `ok` 会更糟**：客户端 `applySelfUpdate()` 的 `.then()` 里
**无条件** `markSelfDone()` + 绿色「更新成功」，根本不读 `application`/`error`。只改宿主那一行
等于把今天一条诚实的失败换成假绿灯。要做得同时给它加激活校验与批准入口，记为 **P1.5**。

## 0.3 热开关：**证伪**（v1.2.0 第六轮，实测）

§3.3 把「热开关（写 `cordis.patch.yml`）」列成待做的第三梯队大件，理由是
「现在完全依赖宿主 `setBundleEnabled`；热开关能免重启」。**这个前提是错的——它已经生效了。**

**实测**（`verify/repro-hot-toggle.ps1` → `verify/probe-toggle-hot.mjs`，scratch profile
`marketcheck`，不碰用户 desktop profile）：

```
POST /plugin-market/toggle  {"name":"@feiyang666/dsh-usage-plugin","enabled":false}
→ 200 {"ok":true,"changed":true,"application":"applied","enabled":false,"error":null,"warnings":[]}
```

`application: "applied"` = **已经热生效，没有重启**。

**机制**（读宿主源码，不是推测）：
- `@deepseek-ai/dsh-plugin-manager` 的 `setPluginEnabled` 自己就写 patch 文件：
  `await writePluginEnabled(this.profile.patchPath, row.patchId, row.moduleName, enabled)`
  （宿主 `index.js:1656`）；
- 紧接着 `result.warnings = await this.reload(...)`，而 `reload()` 走
  `reconcileProfilePatches(root, readProfilePatches('dsh', profile), 'dsh', requiredIds)`
  （宿主 `index.js:2031-2034`）；
- `reload()` 在 `hmr` 服务缺席时**直接 return []**，而 `dsh-base` 的 bundle patch 里就加载了
  `- id: hmr / name: '@deepseek-ai/dsh-hmr'`——本 profile 的 HMR 在场；
- 佐证：用户的 `cordis.patch.yml` 里本来就有**宿主写过**的开关行
  （`- id: whale-mode / disabled: false`、`- id: llm-mimo / disabled: false`）。

**所以自己写 `cordis.patch.yml` 不但多余，还有害**：
1. **违反写下来的安全不变量**——`PLUGIN-MARKET.md §5`：「不落盘、不带凭据：host 半只做 GET 目录
   与调用宿主服务，**不写任何文件**」；
2. **重复且更危险**：参考实现为此维护约 45 条受保护模块正则（`patch.ts:50-94`），
   写错一条就可能把 boot 链自己关掉（那是「DSH 直接起不来」量级的事故）；
3. 宿主的写入是它的既有职责，我们只是调用者——**调用者不该绕过被调用者自己改它的文件**。

**结论**：热开关**不立项**。这一条从「待做」改成「**已由宿主提供，实测确认**」。

### 0.3.1 补记：第五轮的「版本并集」豁免方案同日即失效（教训）

第五轮修 `minimumReleaseAgeExclude` 时写成 `dsh-context@0.64.0 || 0.65.0`，当次 PASS。
**但它会腐坏**：`dsh-context` 的 specifier 是 `^0.66.0`（caret 范围，会自动升版），升级当天
pnpm 把触发的 `- dsh-context@0.66.0` **追加到列表末尾**，而 `evaluateVersionPolicy` 只认
**第一个**同名规则 → 追加的那条永远被挡住 → 校验再次失败。

**所以那条规则现在写成裸包名 `- dsh-context`**：它对「先命中者胜」是**稳定且自愈**的，
pnpm 之后再怎么追加都不会破。代价是该包不再享受 24h 冷静期，这是本 profile 的有意取舍。

**这一条的普遍教训**：修「方向性」bug 时要多问一句——
**「谁会在什么时候把它再弄坏？」** 这次的破坏者是 pnpm 自己的追加行为，
它就在同一个文件里、每次升级都会发生；只看「改完这次绿了」是不够的。

**但实测顺带查出一个真缺陷（已修）**：`toggleNotice` 只认 `cancelled` / `changed`，
对宿主另外两种**可达**结果都回绿色「已启用 {name}」——

| 宿主回 | 修复前 | 真相 |
|---|---|---|
| `applied` | 「已启用 X」✅ | 对 |
| `restart-required` | 「已启用 X」绿色 ❌ | 还没生效（无 HMR 的 profile） |
| `overridden` | 「已启用 X」绿色 ❌ | 被更高优先级覆盖层压住，**状态没变** |

`overridden` 由宿主 `setPluginEnabled` 显式 return（`index.js:1658`），不是假想分支。
修法：补 `restart-required`（warn +「重启 DSH 后生效」）与 `overridden`
（warn +「被覆盖层压住，实际没有启用/停用」）两条分支，并让 `!changed` 与
`noticeFromResult` 用同一条排除规则。`applied` 语义**有意**与安装路径不同：
安装问「包装上了吗」（装上了 → `true`），开关问「状态真的切过去了吗」（被压住 → `false`）。

回归 3 条（client-errorcopy 22→**25**），先跑到红再修。这是同一个病第二次犯：
**只会用一条 happy path 的规则去覆盖一个有多分支的真实接口。**



## 1. 方法与可信度

这份研究不是我一个人读出来的。做法与**核实过什么**：

1. 两个独立子代理分头读参考实现（`_ref/dsh-market`，host 46 个 TS 模块 / `routes.ts` 约 1.5MB /
   ~55 个端点 / 7 个页签）与**我们自己的** `plugin-market/lib/*.js`（9 个端点 / 3 个页签 / 247 条 zh 文案）。
2. 子代理的每条「我们没有」我都**自己 grep 复核**过一遍。复核结果：
   - 成立：`cordis.patch.yml` 写入、快照/备份、收藏/备注/分组、设置卡片、`shell.overlay` 回执——
     全都不存在；client 半只有 **2 处** slot 注入（`main` + `sidebar.footer.action`，`client.js:3422-3423`）。
   - 成立：参考实现的**恢复页**与我们无关地缺失——我们的 `restart.js` 只做「有界等待」，
     没有「重启没起来怎么办」。
3. 数字全部来自真实快照 `_ref/data/plugins.json`（4412 条），不是估计。
4. 有一条**我自己文档里的说法被证伪**，写进 §5 而不是含糊过去。

## 2. 现状：我们的骨架已经对了

先把「不用改」的部分说清楚，避免把资源花在已经成立的事情上：

- **9 个端点**（`lib/index.js:849-857`）、3 个页签、单一 prefix 路由、同源 POST、64 KiB 上限。
- 目录延迟：npm 镜像优先（`dsh-plugin-catalog`，实测约 289ms）——参考实现是官方源优先，
  同一台机器上实测 **25–93s**。**这条我们明显更快**，不要为了「更完整」把它换掉。
- 自更新信任锚：路径形状 + `sha256` + 产物自证三道校验；残余风险**如实写在契约里**而不是含糊。
- 195 个真实重名条目要求给 id/spec，**不猜**（`index.js:544-551`）。

结论：**结构和安全性不用动，缺的是「把数据用起来」和「不说谎」。**

## 3. 三个梯队

### 3.1 第一梯队：数据已经在手里，界面一个字没显示

这是本报告最重要的一条。目录 JSON 的字段我们**抓回来了、解析了、然后丢掉了**——
`normalizeItem`（`lib/catalog.js:194-216`）只投影 15 个字段，下面这些**一个都没投影**，
client 半也**从未引用**（`grep screenshots|capabilityRedLines|tarball` 在 host 与 client 两侧都是零命中）：

| 字段 | 真实覆盖 | 现在 | 为什么该用 |
|---|---|---|---|
| `screenshots` | **874 / 4412**（19.8%） | 完全不显示 | 手机应用市场的详情页**以截图为主**；我们现在详情页全是文字。这是「看」这条腿最大的缺口 |
| `capabilityRedLines` | 字段在 4018 条上；**469 条非空**，共 499 条串、65 种 | 完全不显示 | 见下 |
| `tarball` | **333 条** | 不参与安装 | 见 P1 |
| `capabilityCheckedAt` / `downloadsStart` / `downloadsEnd` | 4412 条 | 不显示 | 「这个数据是什么时候的」——手机市场会写清更新日期 |

**`capabilityRedLines` 单独说**：出现最多的一条是
`reads credentials/secrets AND has network access`，命中 **369 个插件**——
也就是「能读你的凭据，同时能联网」。在手机应用市场的语言里，这就是安装前的**权限提示**。
而我们现在：

- 详情页会显示 `capabilities`（`client.js:1815-1821`），但那是**中性标签**（「读取文件」「网络访问」），
  两个标签并排看不出「合起来意味着什么」；
- **安装是一键直装**（`client.js:1794` → `onInstall`，无确认步），而**卸载反而是两步确认**
  （`confirmUninstall`）。这个非对称正好反了：手机市场里，装之前告诉你权限，卸之后才问你要不要清数据。

**代价**：host 加字段（约 4 行）+ client 详情页/卡片渲染 + 图片的**域白名单**
（只允许 `raw.githubusercontent.com` 等 GitHub 图床——参考实现 `market-data.ts:1008-1013` 正是这么做的，
理由是截图 URL 是**携带用户 IP 的请求**，目录数据一律视为不可信）+ 离线文案回归。
不需要新的数据源，不需要新端点。

**建议**：这是投入产出比最高的一件事，也是唯一能让「像手机应用市场」从文档变成**看得见**的一步。

### 3.2 第二梯队：让「装」和「更新」不说谎

**A. 装后激活校验。** 现在 `/install` 把宿主的 `application` 原样透传
（`index.js:693-711`，`sendChangeResult`）。宿主说 `applied` 我们就显示「已安装」——
**但「装进去了」和「装上了并且真的在跑」是两件事**。参考实现把这个拆成四种状态：
`live | restart | inert | broken`（`IMPROVEMENT-PLAN.md:90-117`），「inert（装了但从没变成 profile bundle）」
今天我们完全看不见。修法很省：`installBundle` 之后**再读一次 `listBundles()`**，
看包名在不在、`enabled`/`fiberPhase` 是什么——这些字段 `/installed` **已经在投影了**
（`API-CONTRACT.md:130-151`），不需要宿主提供新能力。

**B. 更新后回读版本。** 我们修过「点更新永远 no-op」（把裸名钉成 `name@version`，v1.1.4），
那条是**发出去**的修好了；**收回来**没验：装完没有回读磁盘上实际是哪个版本。
参考实现的 `UPDATE-API-V1.md:108-119` 明确要回读并区分
`RELEASE_TOO_FRESH` / `DOWNGRADE_DETECTED` / `RESOLVED_VERSION_MISMATCH`。
代价小（复用 A 的同一次 `listBundles()` 读取），收益是**不会再出现「显示已更新到 0.63.0，实际还是 0.62.3」**。

A 和 B 共用一次读取，建议**一起做**。

### 3.3 第三梯队：大件（各自独立立项，不要打包做）

按「防止用户把自己搞死」排序，这几件参考实现都有、我们零代码：

| 方向 | 参考位置 | 为什么值得单独做 |
|---|---|---|
| **重启没起来时的恢复页** | `recovery.ts`；`_ref README.md:48` | DSH 启动是全有全无：**一个插件加载失败整个进程就退出**，市场界面随之消失。恢复页由脱离终端的助手在原地址提供，所以宿主已经没了也打得开。我们的 `restart.js` 只做有界等待，**没有任何恢复路径** |
| 组合诊断 + 加载顺序编辑器 + 落盘前试跑 | `check.ts` / `order.ts` / `trial.ts` | 同上，是「别把 boot 搞坏」的另一半 |
| 备份 / 快照 / 恢复 | `backup.ts` / `snapshot.ts` | 我们唯一的安全网是宿主自己 |
| ~~热开关（写 `cordis.patch.yml`）~~ | — | **已证伪：宿主本来就会热应用**（实测 `application:"applied"`，见 §0.3） | — | **不立项** |
| 主题页 | `themes.ts` | 我们**零主题代码** |
| 无 `pluginManager` 时的 CLI 兜底 | `dsh-cli.ts` | 我们现在这种情况下**只读**（`client.js:344`） |

这些都要碰 profile 文件或起子进程，**每一条都会扩大验证面和安全面**，必须一条一条来、
每条自带失败复现与回归。**不建议在同一个版本里做多条。**

### 3.4 P1 细节：安装来源优先级

目录 4412 条里：**2288 条有 npm 名**、2124 条只有仓库地址；其中 **222 条带预构建 `tarball`**
（另有 111 条同时有 npm 名和 tarball）。

- 我们：`spec = npm ?? url`（`catalog.js:179`），只有仓库地址的条目就走整仓下载。
- 参考实现：`npm` → **作者预构建的 Release tarball** → `github:owner/repo`
  （`sources.ts:415-424`），并注明「两者都避免整仓下载与本地构建脚本」。

顺带一条**该抄的安全细节**：参考实现只接受**属于该条目自己的仓库**的 Release 包
（`sources.ts:33-48`），因为否则可以宣称可信仓库、却从别处下载：
`url: github.com/good/plugin` + `tarball: github.com/evil/repo/...`。它还明确**不接受**
`objects.githubusercontent.com` 这类 Release CDN，因为路径里没有 owner/repo，**绑不上**。
（注：那条注释说「今天有 70 条带 tarball」——我们的快照已经是 **333 条**，说明代码注释比数据旧。）

## 4. 明确不做（以及理由）

1. **不做收藏 / 备注 / 分组 / 评论。** `PLUGIN-MARKET.md:237-240`：`pluginManager` 已是唯一事实来源，
   不做第二份本地缓存；讨论区还要引入 giscus（第三方站点 + 账号），与闭环无关。
2. **不做内置目录快照兜底。** 目录每天在长，**过期快照会把「今天发布的插件」显示成「不存在」**——
   那不是降级，是给错答案。
3. **不自己起 pnpm / 不写 `allowBuilds`。** 违反「不自己起包管理器、不落盘」（`PLUGIN-MARKET.md:135,139`）。
4. **不照抄参考实现的来源/重启守卫。** 我们的桌面壳豁免（`API-CONTRACT.md:22-32`）是有代价换来的：
   官方桌面壳转发前会删掉 `Host`/`Origin`/`Cookie`/`Sec-Fetch-Site`，早期把它当跨站，
   **导致 Electron 里安装/卸载/开关/刷新全部 403**（`REPORT.md:327`）。全局改成拒绝转发头会**重新踩一遍**。
   只有 `/restart` 端点**局部**加严才是候选。
5. **不引入独立签名密钥。** 三道校验挡得住损坏/截断/单点替换，挡不住「清单与产物一起被换」。
   要那个强度需要密钥管理，属于另一个量级；**继续如实写在契约里，不假装有**。
6. **不运行时加载语言包、不引第三方依赖、不加构建链。** 动态客户端插件拿不到宿主字典类型；
   client 半只能 `require("react")`。
7. **绝不把 `GET`/`POST /self-update` 拆成两条路由**——路由表以 path 为键，拆了 GET 就永远 405。
8. **不恢复顶部黑条进度条、不加第二个滚动容器**——已有断言盯着它们的缺席。

## 5. 一条自我证伪（写下来，因为它影响我们对「测试全绿」的信心）

参考实现的 `TESTING.md:125` 有一句判据：**「不能用一条走兜底路径也能满足的断言」**。
拿它量我们自己的 `verify/client-copy.test.mjs`：

- 171 行 `assert.*`，其中 **122 行是 `assert.match`（71%）——断言的是源码文本**；
- 整个文件**从不加载、不执行 client bundle**（无 `ModuleLoader` / 无 jsdom / 无 render）。

也就是说：**它能证明「文案和 CSS 不变量还在」，不能证明「界面真的这么表现」**。
真实行为由 `verify/ui-check.ps1`（headless Edge + CDP，78 条）覆盖，但那条**不在发布门禁里**、
要本机有浏览器、要手动跑。

这不是说门禁没用（它挡过版本漂移、zh/en 键漂移、僵尸 key、动效不变量），
而是**不要把「门禁全绿」当成「客户端半行为正确」**。方向上的含义：
客户端改动越大，越该把 `ui-check.ps1` 从「发布前手动跑」往上提。

## 6. 建议的推进顺序

1. **P0-a｜截图 + 能力红线**（第一梯队）：把已有数据变成「看得见」。含图床白名单与安装前权限提示。
   这是唯一直接改善「像不像手机应用市场」的一步。
2. **P0-b｜装后激活校验 + 版本回读**（第二梯队 A/B）：一起做，共用一次 `listBundles()`。
   这是「不再说谎」的一条。
3. **P1｜安装来源优先级 + 同仓库绑定**：抄来源顺序和安全绑定的判断，不抄它的 pnpm 逻辑。
4. **P2｜从「重启恢复页」单独立项**（第三梯队里最该先做的一件）：它是唯一能在
   **市场自己已经消失**时还救得回 profile 的能力。
5. 其余大件（诊断/顺序/备份/主题）**一条一个版本**，各自带失败复现与回归。
   **热开关已从这条里拿掉**：实测证明宿主本来就会热应用（§0.3），不需要我们做。

前两项都是 `MINOR` 量级的增量，且都不需要新的数据源或新的宿主能力——**这是本报告的核心判断**。
