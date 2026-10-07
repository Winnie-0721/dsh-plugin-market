# 插件市场接口契约（冻结版 v1.0.0）

本文件是 host 半与 client 半之间唯一的接口来源。两侧都按本文件实现，**不要单方面修改**；需要变更时先通知 Lead。

## 0. 标识

| 项 | 值 |
|---|---|
| npm 包名 | `deepseek-harness-market` |
| 客户端 bundle id | `deepseek-harness-market`（必须与包名一致） |
| Loader 行 id（cordis.patch.yml） | `plugin-market` |
| main 面板 key | `plugin-market` |
| 侧边栏底部入口 id | `plugin-market`（`sidebar.footer.action`） |
| 版本 | `1.0.0` |
| 路由前缀 | `/plugin-market` |

## 1. 通用约定

- 所有响应 `Content-Type: application/json; charset=utf-8`，`Cache-Control: no-store`。
- 成功：`{ "ok": true, ... }`。失败：`{ "ok": false, "error": { "code": string, "message": string, "hint"?: string } }`。
- 失败同时使用语义化 HTTP 状态码：`400` 参数错误 / `403` 跨站请求 / `404` 未知路径 / `405` 方法不允许 / `502` 目录源不可用 / `504` 目录源超时 / `500` 内部错误。
- POST 的写操作只接受「有可信来源证据」的请求，判定顺序（实现见 `lib/http.js` 的 `isSameOrigin`）：
  1. `Origin: dsh-app://app` 或 `dsh-app://shell` → 放行（官方 Electron 桌面壳的页面 origin，页面脚本无法伪造 Origin）；
  2. `Sec-Fetch-Site: cross-site` → 拒绝；
  3. 有 `Origin` → 其 host 必须与 `Host` 一致，否则拒绝；
  4. **两个头都不存在 → 仅当客户端是回环地址时放行**；
  5. 只有 `Sec-Fetch-Site` → 仅 `same-origin` 放行。
  拒绝时返回 `403 cross-origin`，且 `hint` 里如实带上收到的 `Origin` / `Sec-Fetch-Site` / 来源地址，便于定位。
  **第 4 条是真实环境纠正过的**：官方桌面壳 `dsh-desktop-host` 的 `forwardWebRequest` 在转发前会删除
  `Host`、`Origin`、`Cookie`、`Sec-Fetch-Site`（再补上宿主 cookie），所以桌面端写请求天然不带这两个头；
  早期把它当跨站，导致 Electron 里的安装/卸载/开关/刷新全部 403。
  同时 `Content-Type` 必须是 `application/json`，请求体上限 64 KiB。
- 错误码清单：`bad-request`、`cross-origin`、`method-not-allowed`、`not-found`、`catalog-unavailable`、`catalog-timeout`、`manager-unavailable`、`not-in-catalog`、`install-failed`、`remove-failed`、`toggle-failed`、`restart-failed`、`not-allowed`、`internal`。
- 面向用户的 `message`/`hint` 用中文短句，遵守「发生了什么 / 为什么 / 现在怎么办」。

## 2. host 路由

### 2.1 `GET /plugin-market/status`

```json
{
  "ok": true,
  "plugin": { "name": "deepseek-harness-market", "version": "1.0.0" },
  "host": { "dsh": "0.2.0-rc.2", "node": "v22.19.0", "platform": "win32", "profile": "desktop" },
  "manager": { "available": true, "registries": { "registry": null, "fallbackRegistries": [], "resolved": null } },
  "catalog": { "source": "https://awesome-dsh-plugin.com/plugins.json", "count": 4412, "updated": "2026-10-01", "fetchedAt": "2026-10-03T12:00:00.000Z", "stale": false, "error": null }
}
```

- `manager.available=false` 表示宿主没有 `pluginManager` 服务，市场只读（浏览/搜索可用，安装类按钮禁用）。
- **本端点绝不发起网络请求**：`catalog` 只反映当前内存缓存，无缓存时为 `null`（UI 用它判断「还没抓过」而不是「抓失败」）。目录的首次抓取只由 `/catalog`、`/installed`、`/refresh` 触发。
- `host.dsh` 取值顺序：`ctx.get('profileContext')`（若存在）→ `process.env.DSH_VERSION` → `null`。

### 2.2 `GET /plugin-market/catalog`

Query 参数（全部可选，未知参数忽略）：

| 参数 | 取值 | 默认 |
|---|---|---|
| `query` | 字符串，≤128 字符 | 空 |
| `category` | 分类 id 或 `all` | `all` |
| `sort` | `top`（star 降序）/ `new`（added 降序）/ `downloads`（下载降序）/ `name`（名称升序） | `top` |
| `page` | ≥1 整数 | `1` |
| `pageSize` | 1..100 整数 | `24` |
| `installed` | `0`/`1`，仅返回已安装项 | `0` |
| `updates` | `0`/`1`，仅返回有更新的项 | `0` |

响应：

```json
{
  "ok": true,
  "catalog": { "count": 4412, "filtered": 312, "updated": "2026-10-01",
               "fetchedAt": "2026-10-03T12:00:00.000Z",
               "source": "https://awesome-dsh-plugin.com/plugins.json", "stale": false },
  "page": { "page": 1, "pageSize": 24, "total": 312, "pages": 13 },
  "categories": [ { "id": "ui", "zh": "UI 增强", "en": "UI Enhancements", "count": 420 } ],
  "items": [
    {
      "id": "AnonyJcy/dsh-j-space",
      "name": "dsh-j-space",
      "owner": "AnonyJcy",
      "npm": "@anonyjcy/dsh-j-space",
      "spec": "@anonyjcy/dsh-j-space",
      "installable": true,
      "version": "1.2.2",
      "category": "agi",
      "description": { "zh": "…", "en": "…" },
      "url": "https://github.com/AnonyJcy/dsh-j-space",
      "page": "https://awesome-dsh-plugin.com/p/AnonyJcy/dsh-j-space/",
      "stars": 4,
      "downloads": 1156,
      "added": "2026-09-20",
      "capabilities": ["fs-read"],
      "install": "dsh plugin --profile web add @anonyjcy/dsh-j-space",
      "installed": false,
      "installedVersion": null,
      "enabled": null,
      "updateAvailable": false
    }
  ]
}
```

- `id` = `owner/name`（目录内唯一）。`spec` 优先级：`npm` → `url`（git 仓库地址）→ `null`；`spec` 为 `null` 时 `installable=false`。
- `installed` 依据宿主 `pluginManager.listBundles()` 的 `name` 匹配，**按身份可信度分层**（v1.1.6）：
  1. **npm 名**（含 scope，大小写不敏感）——权威身份；
  2. **仓库身份** `owner/repo` 与 `@owner/repo`（`repo` 取**仓库名**：`/<owner>/<repo>/…` 的前两段，
     不是 URL 最后一段——后者会让 monorepo 子目录地址退化成 `dsh`/`bundle` 这类通用词，
     实测 4412 条里 471 条带 `/tree/…`、435 条最后一段不等于仓库名）。这两个键是**共享**的：
     同一仓库的多个子插件（`name` 形如 `repo#sub`，真实目录 50 个仓库有 2 条以上）装了该仓库就一起认回；
     `@owner/repo` 同时覆盖「从 git 地址安装、package.json 带 scope」的合法场景（1431 条）。
  3. **裸仓库名**——只在**同一个仓库**的多条之间共享；不同 owner 争用同名时判歧义、不匹配。
  **不再把 `@scope/name` 剥掉 scope 去查**：那会让目录里不存在的 `@随便/<name>` 命中同名的另一个包
  （假「已安装/可更新」，点更新还会装成别的包）。差别在 **owner 要不要对上**。
- `updateAvailable`：**仅当目录版本严格高于已安装版本**时为 `true`（`compareVersions(catalogVersion, installedVersion) > 0`）；版本相同、目录版本更低、任一侧缺失或不可比较 → `false`。`latest` 始终是目录里的当前版本（可低于已装版本），UI 不得据此渲染「更新」按钮。
- `page`：请求值超出末页时**收敛到末页**（v1.1.6），响应额外带 `page.requestedPage` 反映原始请求值；`total` 始终是筛选后的真实条数，`pages = max(1, ceil(total/pageSize))`。
- `categories` 只包含目录里存在且计数 >0 的分类，按 `count` 降序。
- `query` 匹配 `id`/`name`/`owner`/`npm`/描述/能力，以及**地址形状**的词才参与匹配的 `url`
  （粘贴 `https://github.com/owner/repo` 能精确命中；搜 `github` 这类通用词不会因为每条都有
  github 地址就返回全量）。空白分隔的多个词是「与」语义，按字段归一化（小写 + NFKD 去变音符号，
  `jose` 能搜到 `José`）。
- `sort` 是**全序**：四种排序都在末尾用 `id` 兜底，保证同样的数据得到同样的分页（否则完全并列的条目由输入顺序决定先后，一次刷新就可能换页位）。
- 目录缓存 10 分钟；过期后刷新失败时返回上次缓存并置 `stale: true`；完全无缓存时 `502 catalog-unavailable`。
  `stale:true` 时 `catalog.error` 是**字符串错误码**（如 `catalog-timeout`），**`/catalog` 与 `/status`
  都带这个字段**——客户端就靠它显示过期原因，缺了横幅只会写「原因未知」。

### 2.3 `GET /plugin-market/installed`

```json
{
  "ok": true,
  "bundles": [
    { "name": "@feiyang666/dsh-usage-plugin", "version": "1.18.0", "description": "…",
      "enabled": true, "installed": true, "removable": true, "official": false, "market": false,
      "error": null,
      "rows": [ { "rowId": "usage-plugin", "moduleName": "@feiyang666/dsh-usage-plugin", "entryId": "usage-plugin" } ],
      "latest": "1.18.0", "updateAvailable": false }
  ],
  "plugins": [
    { "entryId": "usage-plugin", "moduleName": "@feiyang666/dsh-usage-plugin",
      "enabled": true, "fiberPhase": "active", "title": null, "bundle": "@feiyang666/dsh-usage-plugin" }
  ]
}
```

- `bundles` 直接投影 `pluginManager.listBundles()`：`name`、`version`、`description`、`enabled`、`installed`、`removable`、`rows`；`official` = 名称以 `@deepseek-ai/` 开头；`market` = 名称为 `deepseek-harness-market`。
- `error` 为 `null` 或 `{ "code": string, "diagnostic"?: string }`。
- `latest` / `updateAvailable` 通过与目录缓存 join 得到；目录不可用时为 `null` / `false`。`latest` = 目录当前版本（可能低于已装版本）；`updateAvailable` 仅当目录版本 **严格更高** 时为 `true`。
- `plugins` 投影 `pluginManager.listPlugins()`，额外字段：`title`（本地化标题，取不到为 `null`）、`bundle`（该 entry 所属 bundle 名，取不到为 `null`）。
- `manager.available=false` 时：`bundles: []`、`plugins: []`，并额外返回 `"manager": { "available": false }`。

### 2.4 `POST /plugin-market/install`

请求：

```json
{ "name": "AnonyJcy/dsh-j-space", "spec": "@anonyjcy/dsh-j-space",
  "requestId": "uuid-可选", "approvedBuilds": ["sharp"] }
```

- `spec` 可省略：服务端按 `name`（目录 id 或 npm 名，大小写不敏感）在目录里查 `spec`。
- `spec` 显式给出时必须在目录里存在（等于某个条目的 `spec`、`npm` 或 `url`），否则 `400 not-in-catalog`（安全约束：只允许装目录内的插件）。
- **服务端把裸 npm 名钉上目录版本**（v1.1.4）：命中条目的 `spec` 等于其 `npm` 且 `version` 像 semver 时，
  实际传给 `installBundle` 的是 `name@version`（如 `dsh-context@0.63.0`）。原因：pnpm 11 对
  「已存在的依赖 + 裸名」的 `pnpm add` 是幂等的（打印 `Already up to date`、不动 `package.json`），
  不带版本的更新永远不会换版本，而宿主还会按「本来就装着」回 `restart-required`——界面就成了
  「已安装，重启后生效 → 可更新角标一直是 2」的死循环。spec 是 URL（GitHub 条目）、已带版本、
  或版本字段不像 semver 时原样放行；钉版本**只在命中的目录条目内加版本**，不会引入目录外的安装源。
  回归：`verify/install-spec.test.mjs`（源码不变量 + 本地目录 fixture + 假 `pluginManager` 的行为断言）。
- 调用 `pluginManager.installBundle(spec, { requestId, approvedBuilds })`；`requestId` 为空时不传。`approvedBuilds` 为空数组时不传。

响应：

```json
{ "ok": true, "changed": true, "application": "applied", "stage": "install",
  "target": "@anonyjcy/dsh-j-space", "enabled": true,
  "error": null, "warnings": [],
  "pendingBuilds": ["sharp"], "output": "…最近 2000 字符 pnpm 输出…" }
```

- `application` ∈ `applied | restart-required | overridden | failed | cancelled`（原样透传）。
- `error` 非空时为 `{ "code": string, "message": string, "diagnostic"?: string, "incompatible"?: unknown }`；`ok` 与 `error` 一致：`error != null` ⇒ `ok=false`。**另（v1.1.6）**：
  - `application === 'failed'` ⇒ `ok=false`，即使宿主没带 `error`（`ChangeResult.error` 是可选的）；
  - `application === 'cancelled'` ⇒ **恒为** `ok=true`（即使宿主同时带了一个说明原因的 `error`）：
    客户端要按 `application` 渲染「已取消」，`ok=false` 会让它直接抛错、那条文案永远不可达。
- 按 `name` 安装时（`{name}` 或 `{spec}` 均未给出唯一身份），若该 `name` 在目录里对应**多个条目**，返回 `400 bad-request` 并说明「市场不猜」——真实目录 195 个重名（`dsh-memory` 对应 10 条 5 个不同 spec），原先「第一个匹配就装」会装上别人的包。调用方应改用 `id`（`owner/name`）或 `spec`。
- `pendingBuilds`：来自 `ChangeResult.pendingBuilds`；非空表示需要用户批准构建脚本后带着 `approvedBuilds` 重新提交。
- **`activation`（v1.1.7，仅 `install` 路由）**：装完之后**回读**宿主状态的结果，回答 `application` 回答不了的问题——「东西真的落地了吗、落地的是哪个版本、它在跑吗」。
  ```json
  { "state": "live|restart|inert|broken|disabled|unknown", "expected": "0.63.0",
    "installed": "0.63.0", "enabled": true, "versionMatches": true, "reasons": [] }
  ```
  为什么要有它：`application` 说的是宿主**执行**了什么，不是**结果**。`applied` 完全可能对应
  「写进了 `node_modules`，但 profile 的 bundle 列表里从来没有它」——旧版界面照样渲染绿色
  「已安装」，插件却永远不出现。参考实现把这个拆成 `live | restart | inert | broken`，本字段对齐并
  额外做**版本回读**。
  - **判定手段是前后差集，不是猜名字**：`installBundle` 之前记一份 bundle 名字表（小写为键），之后
    再记一份，新出现的那个就是这次装上的。所以不假设「包名 == bundle 名」（两者并不总相等），也不会
    因为一个仓库里包名不同就误报 `inert`。候选名（`npm` / `name` / `id` / 请求里的 spec 与 name）
    只在「没有新名字出现」时用于判断这次是更新已有条目还是什么都没落地。
  - `expected` 取自**目录**（用户点的就是那个版本），不是宿主回显；`installed` 是回读到的真实版本；
    `versionMatches` 为 `false` 即「目录说 0.63.0、磁盘上还是 0.62.3」，**客户端必须改口**，不能再写
    「已更新」。
  - `restart-required` 优先于 `live`：宿主的原话就是还没生效，不因为条目在列表里就改口。
  - **`inert` / `broken` 不算成功**（客户端 `applied:false`）：它们会进「一键更新」的成功计数，
    谎报成功比不说更糟。
  - `unknown` + `reasons` 是**一等结果**，不是兜底：读不回列表（`read-back-unavailable`）、
    没有基线且列表里也找不到它（`no-baseline`）、一次多出多个 bundle 分不清（`ambiguous-bundle`）时
    都不猜。特别注意 `no-baseline` 与 `live` 可以并存——**认不出「谁装上的」，但认得出「它在列表里」**，
    后者才是 `live/inert` 的判据；把已知的「它在跑」降级成 `unknown` 是另一种不诚实。
  - **不该谈激活的时刻返回字段缺省**（不是 `null` 也不是 `live`）：`application` 是 `failed`/`cancelled`/
    `overridden`，或 `pendingBuilds` 非空（还在等用户批准构建脚本，回读必然「没落地」，不看得
    `pending` 就会把「等批准」说成 `inert`）。
  - 向后兼容：不传时字段**不出现**，老客户端/老响应形状不受影响；客户端在无该字段时行为与从前完全一致。
  - 回归：`verify/host-contract.test.mjs` 的真调行为断言（8 条）；对应文案与「不算成功」的语义在
    `verify/client-copy.test.mjs`。这 8 处语义**逐个做过变异测试**（每处破坏都必须被测试抓到，实际 8/8 全被抓到）。
- `output`：`packageResult.output` 截断到末尾 2000 字符（可选）。
- 宿主缺 `pluginManager` ⇒ `502 manager-unavailable`。
- 安装进行中重复提交同名 spec：透传宿主的 `changed:false` 与 `error.code='operation-error'`。
- 错误响应的 `diagnostic`：`sendError` 会**透传** `overrides.diagnostic`（v1.1.6 修——此前只写 message/hint，§2.8 的 diagnostic 永远不会出现在响应里）。

### 2.5 `POST /plugin-market/remove`

请求 `{ "name": "@feiyang666/dsh-usage-plugin" }` → `pluginManager.removeBundle(name)`。

- `name === "deepseek-harness-market"` ⇒ `400 not-allowed`，`message`：市场不能卸载自己，请在终端执行 `dsh plugin --profile <profile> remove deepseek-harness-market`。
- 其余响应同 §2.4 的字段（`stage: "remove"`）。

### 2.6 `POST /plugin-market/toggle`

请求 `{ "name": "<bundle 名>", "enabled": true }` 或 `{ "id": "<entryId>", "enabled": true }`。

- 有 `name` 调 `pluginManager.setBundleEnabled(name, enabled)`；否则有 `id` 调 `setPluginEnabled(id, enabled)`；都没有 ⇒ `400 bad-request`。
- 响应 `{ "ok": true, "changed": true, "application": "applied", "enabled": true, "error": null, "warnings": [] }`。
- 宿主返回 `readOnlyReason` 时 ⇒ `400 not-allowed`，`message` 说明这条由宿主基础设施管理，不能在市场里开关。

### 2.7 `POST /plugin-market/refresh`

强制丢弃目录缓存并重新抓取。

响应 `{ "ok": true, "count": 4412, "fetchedAt": "…", "source": "…" }`，失败时 `502 catalog-unavailable` / `504 catalog-timeout`（保留旧缓存并置 `stale: true`）。

### 2.8 `GET /plugin-market/self-update`

市场**自身**的更新检查（只读，但会打一次网络；结果缓存 10 分钟）。

查询参数：`force=1` 绕过缓存（其它取值按 §1 视为参数错误）。

响应：

```json
{
  "ok": true,
  "selfUpdate": {
    "current": "1.0.2", "latest": "1.1.0", "latestTag": "v1.1.0",
    "versionCode": 10100, "build": "+15.abc1234", "releasedAt": "2026-10-04T…",
    "updateAvailable": true, "installable": true,
    "channel": "jsdelivr-tags",
    "url": "https://cdn.jsdelivr.net/gh/Winnie-0721/dsh-plugin-market@v1.1.0/releases/deepseek-harness-market-1.1.0.tgz",
    "sha256": "…64 位十六进制…", "bytes": 309082,
    "checkedAt": "2026-10-04T…"
  }
}
```

- `updateAvailable` 只在 `latest` **严格高于** `current`（同一套 `MAJOR.MINOR.PATCH` 比大小，不认预发布号）时为 `true`；相等或更低一律 `false`。
- `installable` = 有更新 **且** 拿到了可校验的产物（`url` + `sha256` 都在）；假时客户端不出「更新到 x.y.z」，只提示。
- `channel` 是最终采纳的那个源 id：`github-release` → `jsdelivr-tags` → `jsdelivr-index` → `tag-probe`（顺序即优先级：最权威/最新鲜的排前面）。
  第一源是 GitHub Releases API（权威且最新，代价是匿名 60 次/小时/IP）；被限流返回 403 时**只是这个源失败**，不影响结论。
- **每个源的「成功」定义**：`github-release` 自带附件元数据（`digest`/`size`）时**当场组装条目**、不查清单；
  其余源必须「给出候选版本」且「拿得到那一版的 `releases/index.json`」都成功才算成功，
  任何一个源半残都要继续问下一个（实测：刚推完标签时 Data API 的版本列表还是旧的，
  而旧标签没有 `releases/` 目录 → 清单 404）。有一个明确高于 `current` 的答案就早退出；
  没有更新时问完全部源、取**最高**那一个（不同源的 CDN 缓存新鲜度不一致，取最高才不会漏更新）。
- **`releases/` 目录自 v1.1.6 起已从仓库移除**（打包产物只挂 GitHub Release 附件）：新版本的第 1 源
  由附件 `digest` 直接给出 `sha256`；第 2/3 源与 `tag-probe` 对新版本会 404 并如实记进 `diagnostic`，
  仍能照常服务 ≤v1.1.5 的老标签。
- **`tag-probe`：列表源全都滞后时的有界兜底**。实测 Data API 的版本列表数小时不更新、
  `@main` 的清单被缓存 12 小时，而**任意标签是按需取的**——刚推完 `@v<tag>/…` 立刻 200。
  所以列表都说「没有更高版本」时，按 `MAJOR.MINOR.PATCH` 的常规递进探三个候选标签
  （下一个补丁 / 下一个次版本 / 下一个主版本），命中即说明确实有新版本，且那一版的清单就在同一标签里。
  最多 3 次请求，失败当没有。
- 三个源都失败 ⇒ `502 self-update-unavailable`，`diagnostic` 里按顺序列出每个源（含探测）各自的失败原因。
- **本机版本必须可解析**（v1.1.6）：`current` 不是严格三段数字（如合法 npm 预发布号 `1.1.5-rc.1`）时
  如实返回 `self-update-unavailable`，**不得**把「无法比较」当成「已是最新」。`isNewer` 因此返回
  `true | false | null`（null = 无法比较），调用方必须显式区分。
- **「知道有新版但验不了」也必须报不可用**（v1.1.6）：某个源给出了更高的版本号却拿不到那一版的清单
  （附件缺 `digest` → 回落到 v1.1.6 起已下线的 `releases/index.json`）时，手里那份更旧的候选
  **不得**把结果盖成「已是最新」；此时返回 `self-update-unavailable` 并说明是哪个版本验不了。
  这条与上一条共同保证首页/面板**绝不谎称「已是最新」**。
- 标签名过 `isUsableTag` 校验（含孤立代理项的标签会被换成规范的 `v<version>`）：`\S+` 能放行
  孤立代理项，但它在 `encodeURIComponent` 里会抛 `URIError`，从单源坏数据变成 500 internal。
- `tarball` 也一并返回：下载时会用它构造另外两条路的地址（见 §2.9）。

### 2.9 `POST /plugin-market/self-update`

应用自更新：下载产物 → 三道校验 → 交给宿主 `pluginManager.installBundle(<本地绝对路径>)`。

请求体：`{}`（无字段）。要求来源判定通过（§1）。

响应：`{ "ok": true, "application": "restart-required", "from": "1.0.2", "to": "1.1.0", "requiresRestart": true, "tarball": "<绝对路径>", "bytes": 309082, "warnings": [] }`。

- `application` 由宿主给出；`requiresRestart` 恒为 `true`——**宿主半在进程里被 Loader 缓存，装完必须重启 DSH 才生效**（§见 docs/RELEASING.md §5）。客户端不得把它渲染成「已生效」。
- 已是最新时返回 `{ "ok": true, "application": "up-to-date", … }`，**不下载、不调用安装**。
- 失败码（都是 `502`，语义不同，客户端分开说明）：
  - `self-update-integrity`：长度、`sha256` 或产物自证不符 ⇒ **拒绝安装**，重试也不该放过；
  - `self-update-download`：CDN 传输中断/超时，**以及写盘失败**（v1.1.6 起 `mkdir`/`writeFile`/`rename`
    的文件系统错误都归到这里；此前是裸 `await`，会从路由冒出去变成 `500 internal`，客户端这条
    专用文案永远用不上）；失败时删掉写了一半的 `.part`，不留半截文件；
  - `self-update-unavailable`：拿不到可用产物或版本号，**或本机版本不可解析**；
  - `manager-unavailable`：宿主没有 `pluginManager`。

**信任链（三道，缺一不可）**：① 条目里的 tarball 必须是 `releases/*.tgz` 形状的相对路径（写别的 URL 一律不采信；v1.1.6 起条目由 GitHub 附件元数据组装，路径形状仍是同一约定）；② 字节的 `sha256` 必须与清单一致（清单 = 老路的 `index.json`，或 GitHub 附件的 `digest`）；③ 解开 tarball 读 `package/package.json`，包名与版本必须与预期一致。
第 ② 道不防「CDN 与清单一起被换」——那需要独立签名密钥，**目前没有**，这是已知限制而不是已解决的问题。

**取字节的三条路，按顺序试**：`@<tag>/releases/<file>.tgz` → `@main/releases/<file>.tgz` → GitHub Release 附件（`/releases/download/<tag>/<name>-<version>.tgz`）。
前两条覆盖 CDN 的标签索引延迟（v1.1.6 起仓库不再存文件，新版本上这两条必然 404、快速失败，实际由第三条供给；顺序保留是为了 ≤v1.1.5 的老版本仍走 CDN 缓存）。因为第 ② 道校验的是**内容**，从哪条路取都不影响安全性。
只有**传输层失败**（404/超时/断流）才换下一条；一旦**拿到了完整字节**而哈希不符，那是篡改信号：直接以 `self-update-integrity` 失败，**不换来源重试**。

### 2.10 `POST /plugin-market/restart`

一键重启：把「重启 DSH」从一句提示变成真动作（detached wait-and-relaunch，v1.1.6 起）。

请求体：`{}`（无字段）。要求来源判定通过（§1）。

响应（**先 spawn 助手、拿到 pid 才回 200**）：`{ "ok": true, "pid": 12345, "already": false, "delayMs": 900 }`。

- `already: true` = 同一次重启流程里的第二次请求：幂等返回，不再 spawn 第二个助手（双助手 = 双宿主）。
- `delayMs`：响应落地到进程退出的延迟（`RESTART_EXIT_DELAY_MS`）；客户端在这之后才开始探活。
- 生命周期（实现见 `lib/restart.js` + `lib/restart-helper.cjs`）：
  1. 端点 spawn 一个 **detached** 的等待助手（`ELECTRON_RUN_AS_NODE=1`，让它在桌面端也以 node 身份跑脚本）；
  2. 宿主延迟 `delayMs` 后 `process.exit(0)`；
  3. 助手每 300ms 轮询宿主 pid，**进程真的死掉才**用原 `execPath` + `argv` 拉起；有界等待 60s，到点没死就放弃——绝不无父拉起（双实例会撞单实例锁与端口）；
  4. 拉起前删除 `ELECTRON_RUN_AS_NODE`（否则桌面端会以 node 模式黑窗启动），且子进程必须 `detached`——Windows 上非 detached 的子进程会随创建者退出一起被带走（本仓库 `verify/restart-helper.test.mjs` 的探针实测：detached 活、非 detached 灭）。
- 客户端契约：探活必须先观察到 `/status` **失败一次**（证明旧进程死了），之后恢复成功才 `location.reload()`——没有这道闸，旧进程还没退出时的 200 会被误判成新进程。60s 等不到就如实提示手动刷新，不假装成功。
- 失败：`500 restart-failed`（助手没起来，宿主**没有**退出，可以原地重试）。
- **顺序要求（v1.1.6）**：`setTimeout(process.exit)` 必须排在 `sendJson` **之前**。响应写失败
  （客户端切走、代理断开、socket 关闭）时 `sendJson` 抛错并被外层 handler 吞掉，若退出还没安排，
  而 `restart.js` 已置 `requested`，之后每次点击都回 `already:true` 并跳过安排——
  **「重启 DSH」在该进程的余生里永久失效**。
- 助手 spawn 后必须**立刻**挂 `child.on('error')`，且在任何提早 `return` 之前：spawn 失败
  （ENOENT，如可执行文件被自更新换掉）是**异步**事件、`child.pid` 只是 `undefined`、spawn 本身
  不抛错；未处理的 `'error'` 会直接终止宿主进程（用户看到 500 之后进程就没了）。
- 如实的代价：正在流式输出的回复会被截断；重启后的进程由 detached 方式拉起，**终端 Ctrl+C 打不到它**（结束它用 DSH 自己的退出方式或 `taskkill`）。两条都写在按钮 tooltip 与 `docs/RELEASING.md` §5 里。

## 3. 目录抓取策略（host）

源的选择顺序（每个源只尝试一次，源列表本身就是重试）：

1. `DSHM_REGISTRY_URL` 非空 → **只**用该 URL 一个源（用户指定自己的目录时不允许悄悄回退到我们的源）。
2. 否则按顺序：`https://registry.npmmirror.com` 上的 npm 包 `dsh-plugin-catalog` → `https://registry.npmjs.org` 上的同一包 → `https://awesome-dsh-plugin.com/plugins.json`。
   - npm 候选注册表在 `DSHM_NPM_MIRROR` 非空时只取该值。
   - 理由（实测）：本机直连时官方源 25s 超时或 35s 才通；npmmirror 的包元数据 97ms、tarball（1.21MB gzip）下载 + 解压 291ms。这与 dsh-market 自己的区域路由一致。

单个源的做法：

- **URL 源**：`GET <url>`，超时 30s，校验响应必须是 JSON 对象、`plugins` 为数组、`count` 为数字；拒绝 HTML（含 `<html`）或非 JSON 正文。
- **npm 源**：`GET <registry>/dsh-plugin-catalog/latest`（15s）→ 读 `version` / `dist.tarball` / `dist.integrity`；`GET dist.tarball`（30s）→ gzip 字节；`dist.integrity` **必填**（v1.1.6 起）——元数据本身也来自网络，只信「元数据说没问题」等于没校验，缺字段即整源失败并退到下一个源；不匹配即该源失败。`node:zlib` 解压后用最小 USTAR 解析取出包内 `package/plugins.json`，**`trimStart()` 后再 `JSON.parse`**（包内文件可能带 UTF-8 BOM；URL 那条路走 `response.text()` 已被 fetch 规范自动剥掉，只有这里需要显式处理），再做同样的 JSON 结构校验。
- **内容校验交叉核对条数**（v1.1.6）：除「对象 + `plugins` 数组 + `count` 数字」外，还要求
  `plugins.length` 与 `count` 相差不超过 1%（`count>0` 而 `plugins` 为空一律拒绝）。
  否则结构合法但被截断/清空的正文会以 `stale:false` 覆盖好缓存——市场整个变空、分类消失，
  且不显示过期横幅，看起来像「真的一共 0 个插件」。
- 全部源都失败：无缓存 → `502 catalog-unavailable`（超时导致时 `504 catalog-timeout`），文案说明尝试过哪些源，以及可以设 `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR`；有缓存 → 200 + `stale: true`。

其它：

- 内存缓存：`{ source, updated, count, categories, plugins, fetchedAt, stale }`，TTL 10 分钟；并发抓取共用同一个 in-flight Promise。
- 失败后的短冷却只影响自动抓取节奏，不改变错误结果；`/refresh` 绕过冷却。
- `source` 是实际命中的源字符串：npm 源形如 `npm:dsh-plugin-catalog@<version> (registry.npmmirror.com)`，URL 源就是该 URL。
- 只向源发送 GET，不带任何凭据；不写磁盘。

## 4. client 半契约

文件 `plugin-market/lib/client.js`，单文件、自包含：

```js
window.__ModuleLoader__.load({
  id: "deepseek-harness-market",
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    var React = require("react"); var el = React.createElement;
    // …组件…
    exports.inject = ["slots", "layout", "locale"];
    exports.apply = function (ctx) { /* … */ };
    return module.exports;
  }
});
```

- 只用 `require("react")`（平台种子模块）与 `window.fetch`；不引第三方包，不引相对文件。
- 通过 `ctx.get(name)` 取服务，取不到要有降级：
  - `slots`（必需）：`slots.inject(key, () => slots.register(options, Component))`。
  - `layout`：`layout.selectPanel("plugin-market")`。
  - `locale`：`locale.getLocale().active`（`zh`/`en`）+ `locale.subscribe`。
- 注册两处：
  1. `ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'plugin-market' }, MarketPage))`
  2. `ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'plugin-market', order: 15, label: () => t('market.title') }, MarketEntry))`
- `MarketEntry` 收到框架 props（`wide`、`usePanelInfo` 等）：
  - 整行按钮：图标 + 文案「插件市场」；`wide === false` 时只留图标（56px 轨道）。
  - 点击调用 `layout.selectPanel('plugin-market')`；`layout` 不可用时按钮禁用并给出 tooltip。
  - 用 `props.usePanelInfo(info => info.activePanelId === 'plugin-market')` 做选中态；该 hook 不存在时按未选中渲染。
- `MarketPage` 只读 `plugin-market` 路由，不直接访问宿主服务：
  - 顶部：标题「插件市场」+ 版本号 + **一个按钮**：「刷新目录」（标题右侧的 `.dshpm-headerActions`）。
    原先的「更新插件」与「检查市场更新」按用户要求删掉了：前者由第三个页签取代，后者搬进「可更新」页页头，
    连同两者的反馈（忙碌态 spinner + `aria-busy` + 回执气泡）一起搬过去。
  - 「可更新」页页头右侧的**两个按钮（样式统一为 primary）**，v1.1.4 起左边是一颗**合并状态机**：
    没检查过 →「检查更新」，按下重读列表（带回执）；检查过且有更新 →「一键更新（N）」（按顺序逐个执行
    同一条安装接口、每条结果留在该行、跑完给一条汇总回执，卡在「要先批准构建脚本」上就暂停）；
    检查过且没有更新 →「重新检查」。原页脚那颗独立的「重新检查」已合并进这颗按钮（`drawerFoot` 删除）。
    右边是「插件市场更新」（原「检查市场更新」改名，状态机：插件市场更新 / 检查中… / 更新到 x.y.z /
    重新检查——检查完没有新版本时不再显示「已是最新」，避免与插件的更新状态混淆）。逐条的「更新到 x.y.z」仍然保留。
  - 「可更新」页的数据来自 `/installed` 的 `updateAvailable`/`latest`（宿主已把目录 join 进去），
    因此不依赖发现页的目录请求是否完成；点页签会重读一次并给一条结果回执。
  - **自动检查规则**（v1.1.4，用户定的）：
    1. 每次启动 DSH（client 模块 `apply` 执行时）→ 立刻检查一次**市场本体**更新（`GET /self-update`，
       宿主侧 10 分钟缓存），结果写进模块级状态机——发现新版本时可更新页的按钮一打开就是
       「更新到 x.y.z」；**没更新则不改按钮**，首次进入仍是初始的「插件市场更新」
       （`runSelfCheck(onResult, manual)`：「再次检查」只属于用户手动点过的那次，自动检查
       不替用户把状态机按到「已检查过」——用户报过「第一次进入就是再次检查」）；
    2. 启动后**每 1 小时** → 检查一次**插件**更新（`GET /installed`，绕过 5 分钟计数 TTL），刷新侧边栏与
       页签角标；「多出新更新」且市场页开着时补一条回执（否则不打扰）。
    调度带 `schedulerStarted` 守卫（`apply` 可能被 HMR 调多次），定时器 `unref()`——否则 Node 下回归测试
    进程会被这个每小时的定时器拖住、永远不退出。
  - 侧边栏入口在 `updateAvailable` 计数 > 0 时渲染角标；计数由 `/installed` 结果驱动（模块级 5 分钟 TTL + 在途请求复用），入口与面板共享同一份。
  - 有更新时的提示：**悬浮回执气泡（Android toast 那种）**——`.dshpm-notice` 用 `position:fixed`
    贴视口底部居中（`left:0; right:0; margin:0 auto` 水平居中，`max-width:min(560px, 100vw-32px)`），
    **不占文档流**，出现或消失都不推动布局、也不必滚动才看得见。成功/信息类 4.6s 自动收起并带倒计时线；
    **收起有退场动画**：先翻 `data-open="false"` 沉下去（200ms，`NOTICE_CLOSE_MS`）再卸载，不是凭空消失；
    毛玻璃（`backdrop-filter`）+ 分层投影。警告/错误保留到手动关闭。
    标题上方**不再放**顶部进度条（截图反馈那条黑杠已删）：写操作的进行中状态由
    触发它的按钮（spinner + `aria-busy` + 禁用）与回执气泡表达。
  - 页签：`发现`（目录）/ `已安装` / `可更新`（带可更新计数角标，排在已安装右边；点它会切过去并带回执地重读）。
    页签栏与页面由两张注册表驱动（v1.1.6）：`MARKET_TABS`（`{ id, label, badge, onClick }`，数组顺序即页签顺序）
    与 `MARKET_PANES`（`id → 渲染函数`）；新增一个页面 = 各加一项，渲染循环不动。页签按钮带 `data-tab`，
    高度由 CSS 固定（`min-height:32px` + `inline-flex`），有没有角标都一样高。
  - **页面统一布局（v1.1.6，用户报「三个切换页面高度不对齐」）**：三页共用一层外壳 `.dshpm-page`
    （`display:flex; flex-direction:column; gap:12px; flex:1 0 auto`，带 `data-page` 与 `role="tabpanel"`）——
    页面级节距统一成一个单位 12px（外壳、`.dshpm-root`、各页内容容器一致；卡片/列表行**内部**仍是 8px），
    内容不足一屏时页面撑满剩余高度（几页等高），内容超长时仍由 `.dshpm-root` 自己滚动。
    `.dshpm-page` 的 `flex:1 0 auto` 覆盖 `.dshpm-root > *` 的 `0 0 auto`，收缩权仍为 0，
    所以不引入第二个滚动容器、任何区块都不会被压扁（§4 的自动最小尺寸约束不变）。
    可更新页作为整页时用 `.dshpm-updatesPage` 去掉卡片的内边距与边框（那 12px 内边距正是三页错位的根因），
    `.dshpm-updatesPanel` 基类保留以便别处复用这张卡片。
  - 发现页：搜索框（回车或 300ms 防抖）、分类 chips、排序下拉、卡片网格、分页（上一页/下一页 + 第 x/y 页）。
  - 卡片：名称 + 作者 + 描述（按界面语言）+ star/下载 + 版本 + 分类 + 「安装」/「已安装」/「更新」按钮 + 「详情」。
  - 详情：可展开区域，显示完整描述、能力标签、仓库/目录页外链（`target="_blank" rel="noreferrer"`）。
  - 已安装页：bundle 行（名称、版本、启用开关、卸载按钮、有更新时「更新到 x.y.z」）。
  - 可更新页：与已安装页同一份 `/installed` 数据，只显示 `updateAvailable === true` 的条目；空态区分「全部都是最新」与「目录还没就绪」；页脚不再有独立按钮（「重新检查」已并入页头的状态机按钮）。三个页签互相切换时另一侧的内容卸载（同一时间只有一份在 DOM 里）。
  - 状态：加载中（骨架/转圈）、空结果（说明 + 建议）、失败（原因 + 重试 + 现在怎么办）、目录过期提示。
  - **错误归类（v1.1.6）**：正文不是市场约定的 JSON 时（反向代理 / 运营商劫持 / 登录页，
    常见于 HTTP 200 却返回 HTML），错误码取 `badResponse` 而**不是** `internal`——后者的三段文案
    是「宿主内部出错 / 看宿主日志」，与真实原因（被代理拦了）对不上，而 `err.badResponse.*`
    此前没有任何地方产生、成了死文案。4xx/5xx 仍按状态码归类。
  - **目录过期横幅的原因（v1.1.6）**：`catalog.error` 在 `/status` 里是**字符串错误码**、
    在 `/catalog` 里**不存在**，客户端两个形态都要认；认不出的码原样显示（`原因未知` 会让人
    没法判断是网络、限流还是源站挂了）。
  - **忙碌态按作业 key 归位（v1.1.6）**：每个写操作登记自己的 key（`install:<包名>` / `remove:` /
    `toggle:` / `refresh` / `self-update`），结束时**只清自己那把**。同一时刻同 key 的重复提交
    被直接吞掉（守卫读 ref 而非 state，否则同一批事件里连点两次会失效）。这样并发操作不会
    互相清空忙碌态（原先 `setJob(null)` 会让仍在进行的操作显示空闲 → 用户再点一次就是重复安装）。
  - 安装/卸载/开关：按钮进入进行中态（禁用 + 文案变化），完成后刷新列表并给出结果提示；失败显示 `error.message` 与 `hint`。
  - `pendingBuilds` 非空时展示「这个插件要执行构建脚本」确认条，用户确认后带 `approvedBuilds` 重新提交。
  - **重启询问弹窗（v1.2.0）**：任何写操作回来 `restart-required` / `requiresRestart:true` 时点亮重启横幅
    （原有行为），并**主动弹一次**询问窗「立即重启 / 稍后重启」——用户不必自己去横幅找那颗按钮。
    - 语义：**「稍后重启」不是「取消安装」**，改动已经装好，绝不回滚；横幅继续留在页面上等用户随时点。
      `Esc` 与点遮罩都等同「稍后重启」。默认焦点落在「稍后重启」（重启会截断流式回复，破坏性动作不做默认项）。
    - **批量只问一次**：`noteRestartFrom(payload, { label, defer, marketVersion })` 的 `defer:true`
      只记账不弹窗，由一键更新的收尾统一 `maybeAskRestart()`。没有这条，「一键更新（N）」会弹 N 次。
    - **只对「没问过的名字」弹**（`askedRestartRef`）：选过「稍后重启」的包不再重复打扰，
      但后来又装了别的东西时会再问一次。
    - 重启失败（助手没起来）必须**关掉弹窗**，否则它会永远停在「正在重启」而重启根本没发生。
    - 结构：弹窗渲染成 `.dshpm-root` 的**兄弟节点**（`React.Fragment` 包一层），带
      `role="dialog"` + `aria-modal="true"`；`prefers-reduced-motion` 规则必须**单独**列出
      `.dshpm-modalLayer`（它不在 `.dshpm-root` 内，靠 `.dshpm-root *` 覆盖不到）。
    - e2e 断言一律用 `elementFromPoint` 做**真实命中测试**：JS `.click()` 会绕过命中测试，
      覆盖层把按钮盖住也照样「成功」，那种断言等于没测。
- 文案 zh/en 双语，跟随宿主语言，不写死中文。
- 颜色一律用 CSS 变量并带兜底，例如 `var(--dsw-alias-label-primary, #1a1a1a)`；可用 token：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-state-idle-primary`、`--dsw-specific-sidebar-fill`。
- 请求封装：`fetch(url, {signal})`；组件卸载/离开面板时 abort；所有响应按 §1 解析，`ok !== true` 时抛带 `code/message/hint` 的错误对象。
- 动效（v1.1.0）：全部由 CSS 驱动，三条不可违反的约束——① 基础样式里不写 `opacity: 0`（动效被关掉时元素必须直接可见）；② 只动 `transform`/`opacity`/`max-height`，不动宽高与位置；③ 升入类动画一律 `animation-fill-mode: backwards`（用 `forwards`/`both` 会把 `transform` 钉在末帧，卡片 hover 抬升与按钮按下缩放会全部失效）。
  `@media (prefers-reduced-motion: reduce)` 下关掉 `.dshpm-root` 内所有动画与过渡，内容按最终位置完全可见。
  错峰入场用内联 `animationDelay`（卡片 22ms×序号、列表行 26ms×序号，序号封顶 12）。
- **面板根的布局约定（v1.1.3）**：`.dshpm-root` 是「定高 + 可滚动」的 flex 列，所以**直接子项一律 `flex: 0 0 auto`**。
  依据是 CSS 的自动最小尺寸规则：flex 项只要带**非 `visible` 的 `overflow`**（例如通知条为了底部倒计时线加的 `overflow: hidden`），它的自动最小尺寸就是 **0**，于是整段溢出量都压到它身上、把自己的文字裁掉——v1.1.3 修的正是这个（通知条自然高度 36px、实际只渲染 16px，提示只剩半行；最小复现与实测数据见 `verify/REPORT.md` §12.12）。
  约束：**溢出由容器自己滚动消化，任何区块都不靠收缩来适配**。

## 5. 验收断言（verifier 用）

1. 临时 profile 启动 `dsh web` 成功，日志无 FAILED fiber。
2. 首页 HTML 的 `window.__DSH_BOOT__` 里存在 `id === 'deepseek-harness-market'` 的 entry，URL 形如 `/plugins/??deepseek-harness-market/client.js&rev=…`。
3. 该 URL 返回 JS 且包含 `__ModuleLoader__.load` 与 `id:"deepseek-harness-market"`。
4. `GET /plugin-market/status`、`/catalog?query=dsh&pageSize=5`、`/installed` 返回 `ok:true`，字段齐全。
5. 写操作的来源判定（**必须在带 cookie 的已鉴权会话上测**，否则会先被宿主信任层以空 body 403 拦掉，测不到插件自己的守卫）：
   - **桌面壳形状**：带 cookie、无 `Origin`、无 `Sec-Fetch-Site` → `200`（这是修复后的关键回归项）；
   - 带 cookie + `Origin=https://evil.example` → `403` 且 body 是我们的 `cross-origin` JSON；
   - 带 cookie + `Sec-Fetch-Site: cross-site` → `403`；
   - 带 cookie + 同源 `Origin` → `200`；
   - `GET` 到 POST 路由 → `405` + `Allow`。
6. `POST /plugin-market/install` 用目录外 spec 返回 400 `not-in-catalog`。
7. 卸载自身返回 400 `not-allowed`。
8. 目录缓存：连续两次 `GET /catalog` 第二次 `fetchedAt` 不变；`POST /refresh` 后变化。
9. **自更新通道**（`verify/self-update.test.mjs` 43 条离线 + `verify/self-update-live.ps1` 真实端到端）：
   - `GET /plugin-market/self-update` 返回 `ok:true`，`latest` 等于仓库最新标签，`current === latest` 时 `updateAvailable:false`；
   - **一个源半残不能拖垮整次检查**：标签列表只给到旧版本、那个旧标签的清单 404 时，必须改用下一个源并成功；
   - 三个源全不通时 `502 self-update-unavailable` 且 `diagnostic` 列出三条失败原因；
   - **本机版本不可解析（如 `1.1.5-rc.1`）⇒ `self-update-unavailable`，不是「已是最新」**；`isNewer` 对不可比较的版本返回 `null`；
   - **源报了一个更高版本却拿不到它的清单 ⇒ 不得用更旧的候选盖成「已是最新」**（v1.1.6）；
   - 校验不过（sha256 / 长度 / 产物自证）时 `apply` **不调用** `pluginManager.installBundle`；
   - `index.json` 里写非 `releases/*.tgz` 的地址时拒绝且不下载；
   - **标签地址 404 时改用 main 分支的同一路径**；但拿到字节后哈希不符是硬失败，不换来源重试；
   - 端到端（`verify/self-update-live.ps1`）：临时把当前版本降到低于最新标签 → 真的下载 → 校验 →
     `pnpm add` 装进 scratch profile（依赖变为 `file:` 指向下载物）→ 结束时按字节还原本地 `package.json`。
10. **同一路径的 GET 与 POST 必须只有一个路由登记项**：路由表以 path 为键，登记两次会互相覆盖，`GET /self-update` 会变成 405。改这里要重跑 §5 第 9 条的 GET 断言。
11. **真实浏览器渲染**（`verify/ui-check.ps1` → `verify/market-ui.e2e.mjs`，78 条）：侧边栏入口可点开面板；头部只剩「刷新目录」一个按钮；页签栏是 `发现 / 已安装 / 可更新`，有 2 个可更新插件时页签角标显示 `2`；切到「可更新」页能看到两条记录，页头右侧初始是「检查更新」与「插件市场更新」（带 `data-state`；启动时的自动检查没更新时停在 `checking`→`idle`，**首次进入必须是「插件市场更新」而不是「再次检查」**——用户报过的 bug，手动点过之后才到 `ready`）且**两颗都带 `--primary`**、页脚没有独立按钮（`drawerFoot` 为 0）；点「检查更新」后同一颗按钮变成「一键更新（2）」；每行仍有自己的「更新到 x.y.z」；点批量按钮时第一条返回 `restart-required`（**必须计为成功**并显示「重启 DSH 后生效」）、第二条由 CDP 注入 `EPERM` diagnostic 失败——汇总回执必须写「成功 1、失败 1」，失败行必须显示「文件被 DSH 占用」的专用短句，且批量进行中（按钮 `aria-busy`）页面里 `.dshpm-progress` 必须为 0（顶部黑条已删）；restart-required 之后必须出现「重启 DSH」横幅按钮（`.dshpm-restartBtn`：空闲态、可点、tooltip 写明流式截断；**e2e 绝不点击它**——会真的退出验收宿主，真实生命周期由第 14 条覆盖）；卡片/列表行的 `animation-name` 含 `dshpm-rise` 且 `animation-fill-mode` 是 `backwards`；切到 `prefers-reduced-motion: reduce` 后 `animation-name` 变 `none` 而列表行仍然可见（行数不变）；发现页搜索框**聚焦并输入关键字**后必须只有一颗清除键（`.dshpm-search` 内 `button` 精确 1——Chromium 对 `input[type=search]` 在这个状态下会自己再画一颗原生 ✕、按 `accent-color` 上色，靠 `.dshpm-input::-webkit-search-cancel-button` 的 `appearance:none` + `display:none` 关掉；e2e 在**生效的样式表里挑出我们这条**规则（宿主自己的 `._3Y3Nma_search` 同名规则不算数）、截图 `market-search-clear.png`，并断言点它会把输入框与按钮一起复位。原生 ✕ 只在聚焦时才画，失焦的截图验不出问题，所以截图前重新聚焦并打出 `activeElement`）；**三个页签页面共用一套布局**（v1.1.6，用户报「高度不对齐」）：三个 `.dshpm-tab` 按钮等高、页签由注册表生成并带 `data-tab`（顺序 `discover/installed/updates`）、每页 `.dshpm-page` 的「页签底边 → 页面顶边」节距都是 12px、**三个页面的第一行内容顶边完全一致**（容差 1px）、内容不足一屏时已安装与可更新两页等高，截图 `market-tab-alignment.png`。注意页面入场动画（`dshpm-rise` 自 `translateY(7px)` 起）与页签底线 0.26s 过渡会污染几何测量，断言前必须等动画落位）。
12. **文案与动效不变量**（`verify/client-copy.test.mjs`）：zh/en 键集完全一致；代码里用到的每个 `t("字面量键")` 都在两种语言里存在；没有僵尸文案键；被引用的 `@keyframes` 都有定义；没有任何升入动画用 `forwards`/`both`；顶部黑条进度条（`.dshpm-progress`）不存在；更新失败的 `EPERM`/拒绝访问必须被 `fileLockedDetail` 识别并切到 `err.file-locked.*`（三处接入：错误气泡、可更新行内、已安装行错误）；回执文案保持精简形态（`已刷新 {count} 个插件` 等）；「检查更新」合并状态机存在（`checkPhase`/`onCheckUpdates`/页脚 `drawerFoot` 已删、插件市场更新按钮同为 primary）；`restart-required` 带 `applied: true` 且行内/批量按 `applied` 计成功（`已是最新` 与裸 `一键更新` 两个键已删除）；搜索框只有一颗清除键（样式表必须带 `.dshpm-input::-webkit-search-cancel-button` 的 `-webkit-appearance:none` + `display:none`，输入框保持 `type: "search"` 不靠改类型去重，我们那颗按 `props.queryInput` 条件渲染并接 `onQueryClear`）。
13. **安装 spec 钉版本**（`verify/install-spec.test.mjs`）：`pinnedNpmSpec` 在装之前被调用、只认「spec === 目录里的裸 npm 名 + 版本像 semver」、钉出 `name@version`；行为上，`POST /install {name}` 与 `{spec:裸名}` 都让假 `installBundle` 收到 `dsh-context@0.63.0`，GitHub 条目的 spec 保持 URL 原样。
14. **重启助手**（`verify/restart-helper.test.mjs`，离线、不碰真实 DSH）：启动规格必须 `detached` + `windowsHide` + `ELECTRON_RUN_AS_NODE=1`，helper 脚本缺失或参数不合法在 spawn 之前就拒绝；幂等（第二次请求回 `already` 且不再 spawn）；真助手两向——父 pid 已死则拉起且拉起前 env 里 `ELECTRON_RUN_AS_NODE` 已删（子进程必须 `detached` 才能在创建者退出后活着，Windows 实测），父 pid 活着则等满期限放弃、绝不拉起。客户端接线在第 12 条里盯：`POST /restart` 被真的调用、`restart-failed` 进错误码表、各写操作点亮横幅、探活「先见过死」才 `location.reload()`、60s 超时如实提示。
15. **目录身份层与内容校验**（`verify/catalog-identity.test.mjs` 36 条，v1.1.6 新增）：
    `repoTail` 取 `/<owner>/<repo>/…` 的**前两段**（不是 URL 最后一段——monorepo 子目录地址会
    退化成 `dsh` 这类通用词；真实 4412 条逐条一致）；
    目录里不存在的 `@scope/<name>` **不得**命中同名的另一个包（这条会装错包），
    而 `@owner/<name>` 在 owner 对得上时**必须**命中（1431 条「从 git 安装」的现实形态）；
    同一仓库的多个子插件（`name` 含 `#`）要全部认回，不同 owner 争用裸仓库名时判歧义不匹配；
    npm 名精确匹配、仓库名兜底、大小写不敏感都要**照常命中**（修复不能误伤）；
    `validateCatalogPayload` 拒绝「`count>0` 而 `plugins` 为空」与条数相差过大的截断数据，
    同时放行真实快照与手工小目录；
    搜 `github` 不再命中 4412/4412，而粘贴**完整仓库地址**仍要搜到（url 只对地址形状的词生效）、
    多词是「与」、`jose` 能搜到 `José`；四种排序对正序/倒序输入结果一致且不改动入参数组；
    `paginate` 超出末页收敛到末页。
    真实快照（`_ref/data/plugins.json`）存在时额外跑规模复核；不存在也能单独通过。
16. **host 契约回归**（`verify/host-contract.test.mjs` 27 条，v1.1.6 新增 18 条 + v1.1.7 新增 9 条）：
    `sendError` 必须把
    `overrides.diagnostic` 写进响应体（无则不凭空造字段）；`sendChangeResult` 的 `ok` 用**真调
    handler 读响应体**的方式验六种 `application`/`error` 组合（`failed` ⇒ `false`；
    **`cancelled` 恒为 `true`**，否则客户端抛错、文案不可达）；`findCatalogItem` 同样**真调**——
    身份层（`id`/`npm`/`url`）命中即确定，显示名层唯一才确定、**重名报歧义且不返回任何条目**
    （真实 195 个重名，`dsh-memory` 对应 10 条 5 个不同 spec）；`restart` 的 `process.exit`
    安排**先于** `sendJson`（源码顺序）；`restart.js` 的 `child.on('error')` 先于 `pid<=0` 的
    提早返回、且该路径不置 `requested`；宿主的 `MANAGEMENT_MESSAGE/HINT` 是 `Map`（原型键不能
    穿过去）；`/catalog` 带 `error` 字段、`page` 带 `requestedPage`；`/self-update` 仍是单条
    `['GET','POST']` 登记。
    **v1.1.7 新增第 9 组（装后激活校验，8+1 条）**：真调 `verifyActivation` 验
    `live`（含版本一致）/ `restart`（不许因为条目在列表里就报 `live`）/ 版本不一致时
    `versionMatches:false` / `inert` / `broken` / `disabled` / `unknown`（含三种 `reasons` 与
    「无基线但列表里有它 ⇒ 仍报 live 且带 `no-baseline`」这条）；`failed`/`cancelled`/`overridden`/
    `pendingBuilds` 非空时返回 `null`；`activation` 真进入 `sendChangeResult` 的响应体、
    不传时字段不出现；外加一条源码形状断言确认 `install` 路由真的做了前后快照。
    这 8 处语义**逐个做过变异测试**（把每处语义破坏一次，对应断言必须失败）：8/8 全被抓到。
17. **目录搜索记忆化回归**（`verify/catalog-search-cache.test.mjs` 11 条，v1.2.0 新增）：
    搜索加了两处**跨请求复用**的缓存，而缓存是「写错了也照样能跑」的东西——结果依旧正确、
    测试依旧全绿，只在特定条件下静静给错答案，所以这一套是专门钉它的：
    ① `foldText` 按**字符串内容**记忆化 → `José`↔`jose` 必须仍双向命中、查询侧也要折叠
    （`JOSÉ` 与 `josé` 同结果）、同查询重复执行结果稳定；
    ② `buildMatchIndex` 按**数组身份**记忆化 → **换了目录数组就必须换索引**（先让旧数组
    进缓存，再拿新数组 join，新数组里没有的包**不得**被标成已安装；旧数组仍要答对自己），
    `joinInstalled` 与 `joinBundles` 共用索引交替调用不得互相污染，`null`/空数组不炸；
    ③ 真实快照（4412 条）上复核：记忆化前后同一批查询逐条一致、搜 `github` 仍不返回全量、
    `@owner/name` 别名仍认回 ≥400/500 条（索引没被缓存改成另一种语义）。
    **变异测试 4/4 全捕获**：索引换数组时不重建 / 索引改用数组长度当键 / `foldText` 改用
    字符串长度当键 / 查询侧不再归一化；变异后按字节还原。
    另记一条教训：第一版变异「删掉整个索引快速路径」**没有被捕获**——那是把缓存去掉、
    每次都重建，语义仍正确、只是变慢；**「变异没被捕获」未必是断言弱，可能是变异本身不构成错误**。
    本条另含 v1.2.0 独立审计发现的三处修复的回归：**`nameKeys` 必须用 `normalizedKey` 当键**
    （原本用原始 repo 名、而查表会小写化：真实目录 88 个含大写仓库名里 0 个命中自己、
    5 个标到另一个 owner 的同名小写仓库——`DSH-model-router` → `superboy911/dsh-model-router`；
    修复后 0→82 命中自己，剩余 6 条经查为「同名 npm 包优先」与「不同 owner 真撞车判歧义」，
    都是设计而非缺陷）；**大写仓库名要能被全小写探针命中**；**并发 `ensure()` 只归一化一次**
    （8 个等待者必须共用同一个 `plugins` 数组，否则按数组身份的索引缓存全失效）。
18. **`ok` 推导规则的一致性**（`verify/self-update.test.mjs` 45 条，v1.2.0 新增 3 条）：
    `application:'failed'` ⇒ `ok:false`（**即使宿主没带 `error`**），
    `application:'cancelled'` ⇒ `ok:true`（用户自己取消的，客户端要靠 `application` 渲染
    「已取消」；`ok:false` 会让 `requestJSON` 直接抛错，那条文案永远不可达），
    带 `error` 而没给 `application` ⇒ 回落 `failed` 且 `ok:false`。
    这三条规则在 `self-update.js`、`sendChangeResult`、`/toggle` 三处必须**完全一致**——
    审计发现前两处漂移会让**一次失败的自更新 HTTP 200 + 绿色「更新成功」**。
