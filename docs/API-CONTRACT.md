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
- `installed` 依据宿主 `pluginManager.listBundles()` 的 `name` 与 `npm` 字段匹配（大小写不敏感；npm 为空时用仓库地址尾段匹配）。
- `updateAvailable`：**仅当目录版本严格高于已安装版本**时为 `true`（`compareVersions(catalogVersion, installedVersion) > 0`）；版本相同、目录版本更低、任一侧缺失或不可比较 → `false`。`latest` 始终是目录里的当前版本（可低于已装版本），UI 不得据此渲染「更新」按钮。
- `categories` 只包含目录里存在且计数 >0 的分类，按 `count` 降序。
- 目录缓存 10 分钟；过期后刷新失败时返回上次缓存并置 `stale: true`；完全无缓存时 `502 catalog-unavailable`。

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
- `error` 非空时为 `{ "code": string, "message": string, "diagnostic"?: string, "incompatible"?: unknown }`；`ok` 与 `error` 一致：`error != null` ⇒ `ok=false`。
- `pendingBuilds`：来自 `ChangeResult.pendingBuilds`；非空表示需要用户批准构建脚本后带着 `approvedBuilds` 重新提交。
- `output`：`packageResult.output` 截断到末尾 2000 字符（可选）。
- 宿主缺 `pluginManager` ⇒ `502 manager-unavailable`。
- 安装进行中重复提交同名 spec：透传宿主的 `changed:false` 与 `error.code='operation-error'`。

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
- `tarball` 也一并返回：下载时会用它构造另外两条路的地址（见 §2.9）。

### 2.9 `POST /plugin-market/self-update`

应用自更新：下载产物 → 三道校验 → 交给宿主 `pluginManager.installBundle(<本地绝对路径>)`。

请求体：`{}`（无字段）。要求来源判定通过（§1）。

响应：`{ "ok": true, "application": "restart-required", "from": "1.0.2", "to": "1.1.0", "requiresRestart": true, "tarball": "<绝对路径>", "bytes": 309082, "warnings": [] }`。

- `application` 由宿主给出；`requiresRestart` 恒为 `true`——**宿主半在进程里被 Loader 缓存，装完必须重启 DSH 才生效**（§见 docs/RELEASING.md §5）。客户端不得把它渲染成「已生效」。
- 已是最新时返回 `{ "ok": true, "application": "up-to-date", … }`，**不下载、不调用安装**。
- 失败码（都是 `502`，语义不同，客户端分开说明）：
  - `self-update-integrity`：长度、`sha256` 或产物自证不符 ⇒ **拒绝安装**，重试也不该放过；
  - `self-update-download`：CDN 传输中断/超时；
  - `self-update-unavailable`：拿不到可用产物或版本号；
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
- 如实的代价：正在流式输出的回复会被截断；重启后的进程由 detached 方式拉起，**终端 Ctrl+C 打不到它**（结束它用 DSH 自己的退出方式或 `taskkill`）。两条都写在按钮 tooltip 与 `docs/RELEASING.md` §5 里。

## 3. 目录抓取策略（host）

源的选择顺序（每个源只尝试一次，源列表本身就是重试）：

1. `DSHM_REGISTRY_URL` 非空 → **只**用该 URL 一个源（用户指定自己的目录时不允许悄悄回退到我们的源）。
2. 否则按顺序：`https://registry.npmmirror.com` 上的 npm 包 `dsh-plugin-catalog` → `https://registry.npmjs.org` 上的同一包 → `https://awesome-dsh-plugin.com/plugins.json`。
   - npm 候选注册表在 `DSHM_NPM_MIRROR` 非空时只取该值。
   - 理由（实测）：本机直连时官方源 25s 超时或 35s 才通；npmmirror 的包元数据 97ms、tarball（1.21MB gzip）下载 + 解压 291ms。这与 dsh-market 自己的区域路由一致。

单个源的做法：

- **URL 源**：`GET <url>`，超时 30s，校验响应必须是 JSON 对象、`plugins` 为数组、`count` 为数字；拒绝 HTML（含 `<html`）或非 JSON 正文。
- **npm 源**：`GET <registry>/dsh-plugin-catalog/latest`（15s）→ 读 `version` / `dist.tarball` / `dist.integrity`；`GET dist.tarball`（30s）→ gzip 字节；`dist.integrity` 存在时用 `node:crypto` 校验（`sha512-`/`sha256-` + base64），不匹配即该源失败；`node:zlib` 解压后用最小 USTAR 解析取出包内 `package/plugins.json`，再做同样的 JSON 结构校验。
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
  - 发现页：搜索框（回车或 300ms 防抖）、分类 chips、排序下拉、卡片网格、分页（上一页/下一页 + 第 x/y 页）。
  - 卡片：名称 + 作者 + 描述（按界面语言）+ star/下载 + 版本 + 分类 + 「安装」/「已安装」/「更新」按钮 + 「详情」。
  - 详情：可展开区域，显示完整描述、能力标签、仓库/目录页外链（`target="_blank" rel="noreferrer"`）。
  - 已安装页：bundle 行（名称、版本、启用开关、卸载按钮、有更新时「更新到 x.y.z」）。
  - 可更新页：与已安装页同一份 `/installed` 数据，只显示 `updateAvailable === true` 的条目；空态区分「全部都是最新」与「目录还没就绪」；页脚不再有独立按钮（「重新检查」已并入页头的状态机按钮）。三个页签互相切换时另一侧的内容卸载（同一时间只有一份在 DOM 里）。
  - 状态：加载中（骨架/转圈）、空结果（说明 + 建议）、失败（原因 + 重试 + 现在怎么办）、目录过期提示。
  - 安装/卸载/开关：按钮进入进行中态（禁用 + 文案变化），完成后刷新列表并给出结果提示；失败显示 `error.message` 与 `hint`。
  - `pendingBuilds` 非空时展示「这个插件要执行构建脚本」确认条，用户确认后带 `approvedBuilds` 重新提交。
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
9. **自更新通道**（`verify/self-update.test.mjs` 32 条离线 + `verify/self-update-live.ps1` 真实端到端）：
   - `GET /plugin-market/self-update` 返回 `ok:true`，`latest` 等于仓库最新标签，`current === latest` 时 `updateAvailable:false`；
   - **一个源半残不能拖垮整次检查**：标签列表只给到旧版本、那个旧标签的清单 404 时，必须改用下一个源并成功；
   - 三个源全不通时 `502 self-update-unavailable` 且 `diagnostic` 列出三条失败原因；
   - 校验不过（sha256 / 长度 / 产物自证）时 `apply` **不调用** `pluginManager.installBundle`；
   - `index.json` 里写非 `releases/*.tgz` 的地址时拒绝且不下载；
   - **标签地址 404 时改用 main 分支的同一路径**；但拿到字节后哈希不符是硬失败，不换来源重试；
   - 端到端（`verify/self-update-live.ps1`）：临时把当前版本降到低于最新标签 → 真的下载 → 校验 →
     `pnpm add` 装进 scratch profile（依赖变为 `file:` 指向下载物）→ 结束时按字节还原本地 `package.json`。
10. **同一路径的 GET 与 POST 必须只有一个路由登记项**：路由表以 path 为键，登记两次会互相覆盖，`GET /self-update` 会变成 405。改这里要重跑 §5 第 9 条的 GET 断言。
11. **真实浏览器渲染**（`verify/ui-check.ps1` → `verify/market-ui.e2e.mjs`）：侧边栏入口可点开面板；头部只剩「刷新目录」一个按钮；页签栏是 `发现 / 已安装 / 可更新`，有 2 个可更新插件时页签角标显示 `2`；切到「可更新」页能看到两条记录，页头右侧初始是「检查更新」与「插件市场更新」（带 `data-state`；启动时的自动检查没更新时停在 `checking`→`idle`，**首次进入必须是「插件市场更新」而不是「再次检查」**——用户报过的 bug，手动点过之后才到 `ready`）且**两颗都带 `--primary`**、页脚没有独立按钮（`drawerFoot` 为 0）；点「检查更新」后同一颗按钮变成「一键更新（2）」；每行仍有自己的「更新到 x.y.z」；点批量按钮时第一条返回 `restart-required`（**必须计为成功**并显示「重启 DSH 后生效」）、第二条由 CDP 注入 `EPERM` diagnostic 失败——汇总回执必须写「成功 1、失败 1」，失败行必须显示「文件被 DSH 占用」的专用短句，且批量进行中（按钮 `aria-busy`）页面里 `.dshpm-progress` 必须为 0（顶部黑条已删）；restart-required 之后必须出现「重启 DSH」横幅按钮（`.dshpm-restartBtn`：空闲态、可点、tooltip 写明流式截断；**e2e 绝不点击它**——会真的退出验收宿主，真实生命周期由第 14 条覆盖）；卡片/列表行的 `animation-name` 含 `dshpm-rise` 且 `animation-fill-mode` 是 `backwards`；切到 `prefers-reduced-motion: reduce` 后 `animation-name` 变 `none` 而列表行仍然可见（行数不变）；发现页搜索框**聚焦并输入关键字**后必须只有一颗清除键（`.dshpm-search` 内 `button` 精确 1——Chromium 对 `input[type=search]` 在这个状态下会自己再画一颗原生 ✕、按 `accent-color` 上色，靠 `.dshpm-input::-webkit-search-cancel-button` 的 `appearance:none` + `display:none` 关掉；e2e 在**生效的样式表里挑出我们这条**规则（宿主自己的 `._3Y3Nma_search` 同名规则不算数）、截图 `market-search-clear.png`，并断言点它会把输入框与按钮一起复位。原生 ✕ 只在聚焦时才画，失焦的截图验不出问题，所以截图前重新聚焦并打出 `activeElement`）。
12. **文案与动效不变量**（`verify/client-copy.test.mjs`）：zh/en 键集完全一致；代码里用到的每个 `t("字面量键")` 都在两种语言里存在；没有僵尸文案键；被引用的 `@keyframes` 都有定义；没有任何升入动画用 `forwards`/`both`；顶部黑条进度条（`.dshpm-progress`）不存在；更新失败的 `EPERM`/拒绝访问必须被 `fileLockedDetail` 识别并切到 `err.file-locked.*`（三处接入：错误气泡、可更新行内、已安装行错误）；回执文案保持精简形态（`已刷新 {count} 个插件` 等）；「检查更新」合并状态机存在（`checkPhase`/`onCheckUpdates`/页脚 `drawerFoot` 已删、插件市场更新按钮同为 primary）；`restart-required` 带 `applied: true` 且行内/批量按 `applied` 计成功（`已是最新` 与裸 `一键更新` 两个键已删除）；搜索框只有一颗清除键（样式表必须带 `.dshpm-input::-webkit-search-cancel-button` 的 `-webkit-appearance:none` + `display:none`，输入框保持 `type: "search"` 不靠改类型去重，我们那颗按 `props.queryInput` 条件渲染并接 `onQueryClear`）。
13. **安装 spec 钉版本**（`verify/install-spec.test.mjs`）：`pinnedNpmSpec` 在装之前被调用、只认「spec === 目录里的裸 npm 名 + 版本像 semver」、钉出 `name@version`；行为上，`POST /install {name}` 与 `{spec:裸名}` 都让假 `installBundle` 收到 `dsh-context@0.63.0`，GitHub 条目的 spec 保持 URL 原样。
14. **重启助手**（`verify/restart-helper.test.mjs`，离线、不碰真实 DSH）：启动规格必须 `detached` + `windowsHide` + `ELECTRON_RUN_AS_NODE=1`，helper 脚本缺失或参数不合法在 spawn 之前就拒绝；幂等（第二次请求回 `already` 且不再 spawn）；真助手两向——父 pid 已死则拉起且拉起前 env 里 `ELECTRON_RUN_AS_NODE` 已删（子进程必须 `detached` 才能在创建者退出后活着，Windows 实测），父 pid 活着则等满期限放弃、绝不拉起。客户端接线在第 12 条里盯：`POST /restart` 被真的调用、`restart-failed` 进错误码表、各写操作点亮横幅、探活「先见过死」才 `location.reload()`、60s 超时如实提示。
