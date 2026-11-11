# DeepSeek Harness 可视化插件复刻手册

> **关于本文引用的 `_research/`**：那三份证据文档（`EVIDENCE-A/B.md`、`NOTES.md`）
> 与 `asar-filelist.txt` 在 `.gitignore` 里被显式忽略（见 `.gitignore` 第 21 行 `_research/`），
> **不进仓库**。本文保留完整引用是为了让当时的推理链可追溯；正文里对上游行为的结论
> 已经写在各自段落中，不依赖那些文件也能读懂。若需要原始证据，得重新从 `app.asar` 提取
> （提取脚本同样是本地文件，未入库）。

## —— 基于 `dsh-session-cleaner` 的「会话清理」插件从零复刻

| 项 | 值 |
|---|---|
| 手册版本 | 1.0.0 |
| 复刻对象 | npm 包 `dsh-session-cleaner` **v1.0.2** |
| 目标载体 | DeepSeek Harness Web 插件（host 半 + client 半，单包双半） |
| 代码规范来源 | DeepSeek Harness 官方自带文档（桌面版 `app.asar` 内 `@deepseek-ai/dsh-agent-preset` 技能与各官方包 README） |
| 编写环境 | Windows / DSH 桌面版 `app.asar` 121 MB / 外网仅通 npm 镜像 |
| 本仓库角色 | `dsh-plugin-market`（本手册的工程范例与验收体系范本） |

---

## 0. 怎么读这本手册

### 0.1 证据等级标记（全篇通用）

本手册的每一条技术断言都带一个等级标记。**请按标记决定你能信到哪一步**。

| 标记 | 含义 | 你需要做什么 |
|---|---|---|
| 【实证】 | 我在本环境**亲自读取过原文/跑过命令**，并给出「文件 + 行号」或原始输出 | 可直接照抄 |
| 【官方】 | 出自 DeepSeek Harness 官方自带文档（`@deepseek-ai/*` 包内 README / SKILL.md），给出原文引文 | 可信；换版本时复核 |
| 【推断】 | 由【实证】【官方】合理外推，但**没有直接证据** | 用前自测 |
| 【待核实】 | 本环境无法验证（例如 GitHub 不可达、无浏览器控制） | **不要写进交付代码**，先去验证 |

### 0.2 本手册的取证环境（以及它为什么重要）

本环境**无法访问 GitHub**。这不是猜测，是实测：

```text
$ git ls-remote --heads https://github.com/byJming/dsh-session-cleaner
fatal: unable to access '...': schannel: AcquireCredentialsHandle failed:
       SEC_E_NO_CREDENTIALS (0x8009030e)

$ node -e "fetch('https://api.github.com/repos/...')"
ERR fetch failed UND_ERR_CONNECT_TIMEOUT
```

`github.com` 的 DNS 能解析（`20.205.243.166`），但 TLS 握手失败；jsdelivr、ghproxy 同样 `ECONNRESET`。
**可达的是 npm 镜像**：

```text
https://registry.npmmirror.com/dsh-session-cleaner           -> HTTP 200
```

因此本手册的全部上游事实，来自**官方发布物（npm tarball）**，而不是 GitHub 源码树：

```text
https://registry.npmmirror.com/dsh-session-cleaner/-/dsh-session-cleaner-1.0.2.tgz
  -> 解包到 _tmp-scc/package/
```

DSH 官方源码同样不在本机（这是桌面版，源码在 asar 归档里）。本手册通过**解析 asar 头部索引 + 按 offset 精确抽取**，
拿到了官方文档与部分包源码，放在 `_research/dsh/`。【实证】

> 结论：**本手册的规范部分基于 DSH 桌面版随包发布的官方文档**，不是基于 GitHub 上的仓库快照。
> 两者在细节上可能已经不同步，升级 DSH 后请重新抽取复核（步骤见 §9.5）。

### 0.3 上游身份的一个必须说清的问题

用户给出的地址是 `https://github.com/byJming/dsh-session-cleaner`，但 npm 发布物自己声明的仓库是另一个：

```json
"repository": { "type": "git", "url": "git+https://github.com/fountunt/dsh-session-cleaner.git" },
"bugs":       { "url": "https://github.com/fountunt/dsh-session-cleaner/issues" },
"homepage":   "https://github.com/fountunt/dsh-session-cleaner"
```

【实证】——摘自 `_tmp-scc/package/package.json`。

本环境**无法访问 GitHub 核实这两者是否同一项目**（fork / 改名 / 同人不同名）。
因此本手册统一表述为：

> **复刻对象 = npm 包 `dsh-session-cleaner` v1.0.2（发布者 fountunt）；用户提供的 GitHub 路径为 byJming 下同名包，未联网核对。**

如果你要复刻的是 `byJming` 那个仓库而不是这个 npm 包，**请先自己核对两者是否同源**——这是本手册唯一无法为你消除的不确定性。

### 0.4 手册结构

```text
第 1 章  上游解剖       —— 复刻对象到底做了什么（逐行钉死）
第 2 章  代码规范       —— DSH 官方要求的硬规则
第 3 章  复刻设计       —— 等价能力 + 合规形态的映射
第 4 章  工程骨架       —— 目录、清单、装配
第 5 章  接口契约       —— 冻结版，前后半唯一真相
第 6 章  视觉规范       —— 主题令牌、状态、文案、无障碍
第 7 章  安全与风险     —— 删除类插件的红线
第 8 章  验收与测试     —— 怎么证明它真的能用
第 9 章  打包发布       —— 清单、发布、上线检查
第 10 章 差异对照表     —— 原版 vs 复刻版
附录 A/B/C             —— 证据包 / 规范清单 / 完整代码骨架
```

---

# 第 1 章 上游解剖：dsh-session-cleaner@1.0.2

本章把复刻对象**逐行钉死**。所有行号指向 `_tmp-scc/package/` 下的解包文件。

## 1.1 它解决什么问题

DeepSeek Harness 的 Web API 只提供 `workspace.archiveSession`（**隐藏**会话），没有 `session.delete`（**删除**会话）。
在一个已经跑起来的 `dsh web` 运行时里，用户想彻底抹掉一个会话，只能停服务、手删目录、再重启。

上游 `README.md` 给出了一套「幽灵行」解释（**注意：这套机制在 0.2.0-rc.2 的基线上找不到代码依据，见下方警告**）：

> `session.list` is served from the live `SessionStore` plus a disk scan. Cold sessions get
> *prepared into the live store* while being listed, so after their files are deleted they linger
> as "ghosts" until the server restarts.

翻译成工程语言：**光删磁盘文件不够**。会话在列出的过程中被「预热」进内存 live store，
于是文件删了、列表里还在——这就是「幽灵行」。这个插件补的正是这一刀：
**内存条目 + 工作区记录 + 磁盘目录，三处一起删**。

> **【重要警告 · 待核实 D6】** 官方 `dsh-api-session-controller` 的 `list` 路径（`list(signal)`）实际只做
> 「持久化列出 + live 覆盖合并」，**冷会话只取 header，从不 `prepare()`/`enter()`**：
>
> ```js
> const records = await this.ctx.sessionQuery.listSessions(signal);
> for (const record of records) {
>   const live = this.ctx.sessions.get(record.header.id);
>   if (live !== undefined) { items.push(this.summaryFor(live)); continue; }
>   if (record.header.cwd === undefined) continue;
>   cold.push(record.header);              // <-- 只收 header
> }
> for (const header of cold) items.push(this.summarizeCold(header));   // <-- 不 prepare
> ```
>
> `prepare()` 只出现在**单会话读**路径，且其 JSDoc 明写「Build a session WITHOUT entering it into the store」。
> **结论**：README 描述的「列出即 prepare 进 live store」在 0.2.0-rc.2 上找不到代码依据。
> 高置信部分：「list 路径不会把冷会话放进 live store」；仍待核实部分：「幽灵行现象是否以别的机制存在」。
> **但这不影响删除实现的正确性**：`detachLiveStore` 对不存在于 store 的 id 返回 `false` 且不抛错。
> 【出处：`_research/EVIDENCE-A.md` §D6】

## 1.2 交付物清单【实证】

```text
package/
  package.json        1280 B   清单
  cordis.patch.yml     259 B   bundle patch（装配层）
  lib/index.js        6682 B   Host 半（194 行）
  client.js           9017 B   Client 半（247 行）
  README.md           3072 B   英文文档
  README.zh.md        2861 B   中文文档
  LICENSE             1089 B   MIT
```

版本序列：`0.1.0 -> 0.2.0 -> 0.2.1 -> 0.2.2 -> 0.2.3 -> 0.2.4 -> 1.0.0 -> 1.0.1 -> 1.0.2`。
`1.0.0` 是一次**交互形态的破坏性变更**：把 v0.2.0 的「头部按钮」换成了「侧边栏会话行 ⋮ 菜单项」。【实证，摘自 client.js:2】

## 1.3 清单契约【实证：package.json】

```json
{
  "name": "dsh-session-cleaner",
  "version": "1.0.2",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "client.js", "cordis.patch.yml", "README.md", "README.zh.md", "LICENSE"],
  "scripts": { "test": "node --test test/" },
  "license": "MIT",
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation"
      ]
    }
  }
}
```

逐字段解读：

| 字段 | 作用 | 复刻要点 |
|---|---|---|
| `type: module` | 整包 ESM | DSH 插件都是 ESM，别写 CJS |
| `main` + `exports["."]` | Host 半入口 | 两者都要给；`exports` 收紧解析面 |
| `exports["./client"]` | **Client 半入口** | 这个 key 不是装饰：Loader 靠 `dsh.client` 配置去找它 |
| `exports["./package.json"]` | 允许外部读清单 | Plugin Manager 要读 `icon`/`meta`，必须放开 |
| `files` | 发布白名单 | **注意：`test/` 不在里面** -> tarball 里没有测试，但 `scripts.test` 指向它 |
| `scripts.test` | `node --test test/` | 复刻时必须**真的把 test/ 写出来并纳入发布** |
| `peerDependencies` | `@deepseek-ai/cordis ^4.0.1` | 用 peer 而不是 dep，避免装第二份框架 |
| `dsh.bundle.patch` | 装配层入口 | 指向 `cordis.patch.yml`，Loader 据此 insert 插件行 |
| `dsh.client.platform` | 值为 `web` | Client 半只给 Web 平台 |
| `dsh.client.inject` | **激活顺序**（不是依赖声明） | 上游列了 3 个包 |

关于 `dsh.client.inject` 那三个包名【推断】：

- `@deepseek-ai/dsh-client-locale` —— 客户端语言服务。上游 client.js **并没有走 locale 服务**（它内联了 zh/en 字典），
  但仍然声明了它，**说明 inject 更像是「等这些包就绪」的顺序闸门，而不是「我要用它们的 API」**。
- `@deepseek-ai/dsh-client-runtime` —— 客户端运行时（模块表、`ctx`）。
- `@deepseek-ai/dsh-client-ui-conversation` —— 会话 UI。上游用的是 DOM 增强，**根本不需要**这个包。

（这三条的**确切语义**以官方文档为准，见附录 B 的 R-编号规范；本手册不替官方下定义。）

## 1.4 bundle patch【实证：cordis.patch.yml】

```yaml
# dsh-session-cleaner bundle patch: inserts the cleaner plugin row over the
# dsh-base layer. The plugin registers one HTTP route on the webServer service:
#   POST /api-ext/session.delete
- insert:
    - id: session-cleaner
      name: 'dsh-session-cleaner'
```

三个关键点：

1. **整份文件只有一个 `insert`**，插一行：`id: session-cleaner`（Loader 行 id）、`name: 'dsh-session-cleaner'`（包名，必须与 `package.json.name` 一致）。
2. **这一行没有 `inject:`**。对比本仓库 `plugin-market/cordis.patch.yml`，那里写了 `inject: [webServer]`。
   上游把 `inject` 放在 **JS 模块导出**里（`lib/index.js:23`），而不是 patch 里——两种写法 DSH 都支持。
3. **没有 `disabled`**，即装入即启用。

> 【官方】`cordis.patch.yml` 是 Loader 的 YAML 方言，`insert` 把行插进该 profile 的根条目列表。
> 覆盖语义是「**匹配到的 override 会替换整个 config**」——改配置时不要只写想改的那一个键。

## 1.5 Host 半：HTTP 路由契约

### 1.5.1 导出面【实证：lib/index.js】

```js
export const name = "dsh-session-cleaner";
export const inject = ["webServer", "workspaceRegistry", "sessions", "agents"];
export function apply(ctx) { /* ... */ }

// 末尾：内部实现导出给单测（作者自述不是公开面）
export { detachLiveStore, detachWorkspaces, disposeAgentFiber, removeArtifacts };
```

`inject` 四个服务的作用（上游用法实证）：

| 服务 | 上游怎么用 | 代码位置 |
|---|---|---|
| `webServer` | `webServer.register({ kind: "exact", path, handler })` 注册路由 | 106-108 行 |
| `sessions` | `sessions.store.get(id)` -> `entry.detach()` 摘掉内存 live 条目 | 58-61 行 |
| `workspaceRegistry` | `workspaceRegistry.list()` -> `ws.sessionIds` -> `ws.detachSession(id)` | 65-77 行 |
| `agents` | `agents.get(id)` 判定 `status === "running"` / 空闲则卸载 fiber | 132-153 行 |

### 1.5.2 请求与响应

```http
POST /api-ext/session.delete
Content-Type: application/json

{ "sessionId": "session-1bb8d361-ea6b-4b92-bab2-c858c92e8822" }
```

成功：

```json
{ "ok": true, "value": { "detached": true, "workspaces": 1, "files": 1 } }
```

失败：

```json
{ "ok": false, "error": { "code": "refused", "message": "session is running; stop it before deleting" } }
```

字段语义【实证，与 `README.md` 一致】：

| 字段 | 含义 |
|---|---|
| `detached` | 是否成功从**内存 live store** 移除（这正是「不重启就从侧边栏消失」的原因） |
| `workspaces` | 从多少条工作区记录里摘除了该会话 |
| `files` | 删掉了多少个磁盘会话目录 |

### 1.5.3 错误码与 HTTP 状态【实证】

| code | 触发条件 | HTTP |
|---|---|---|
| `bad-request` | 请求体读失败/解析失败/超 1 MiB；`sessionId` 缺失或不合 `SESSION_ID_RE` | **200** |
| `refused` | ① 会话有 `status === "running"` 的 agent；② 有 agent 但 `disposeAgentFiber` 卸载失败 | **200** |
| `internal` | `try` 块内任何未预期异常（先 `ctx.logger.warn`） | **200** |

**重点观察：这个插件所有响应都是 HTTP 200**（`sendJson` 写死 200，见 lib/index.js:43-50）。
调用方必须读 `body.ok` 而不能只看 `res.ok`。

> 这与本仓库 `docs/API-CONTRACT.md` 的冻结契约**正好相反**：那边要求「失败同时使用语义化 HTTP 状态码
> （400/403/404/405/502/504/500）」。
> **复刻时选哪套？** 建议：**保留 200 + `{ok:false}` 信封**（与宿主 RPC 风格一致，上游客户端也这么解），
> **但额外把状态码写对**——这样两边的客户端都能工作。取舍见 §5.4。

### 1.5.4 校验规则【实证：lib/index.js:25, 119-125】

```js
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
```

- 必须以字母数字开头，之后只允许字母数字与连字符，总长 1-128。
- 这条正则同时承担了**路径穿越防御**（`/`、`.`、反斜杠全被拒），因为 `sessionId` 后面会被拼进文件系统路径。
- 但它**允许连续连字符**、也允许纯数字 id。复刻时如果你的 id 空间不同，务必同步收紧。

### 1.5.5 删除事务的四步

```text
POST /api-ext/session.delete { sessionId }
  |
  +- 1. 读体（限 1 MiB，流式，超限抛错）            -> 失败：bad-request
  +- 2. 校验 sessionId 正则                          -> 失败：bad-request
  +- 3. agent 守卫
  |      +- agent 存在且 status === "running"        -> refused
  |      +- agent 存在（空闲）-> disposeAgentFiber    -> 失败：refused
  |      +- 无 agent                                 -> 放行
  +- 4. detachLiveStore(sessions, id)     -> sessions.store.get(id)?.detach()
  +- 5. detachWorkspaces(registry, id)    -> 遍历 list()，命中 sessionIds 则 detachSession
  +- 6. removeArtifacts(id)               -> 遍历 $DSH_HOME/sessions/<project>/<id> 逐个 rm -rf
       |
       +-> { ok: true, value: { detached, workspaces, files } }
```

**顺序不可颠倒**，理由【推断】：

- 先摘内存再删盘：即使删盘中途失败，也不会留下「内存有、磁盘无」的半死状态。
- agent 守卫必须在最前：running 的 agent 正在写 session log，先删盘会导致写失败/数据竞争。

**每一步的失败语义**：

- `detachLiveStore` 失败**不报错**，只是返回 `false`（lib/index.js:58-61：拿不到 entry 或 entry 没有 `detach` 就返回 false）。
  这是**优雅降级**——老版本 store 没有 `detach` 时仍能删文件。
- `detachWorkspaces` 在 `workspaceRegistry.list` 不存在时返回 `0`（66 行）；`ws.detachSession?.()` 用可选调用，
  **注意它仍然把 `removed += 1`**——即使 `detachSession` 不存在，计数也会 +1。这是一个**计数口径瑕疵**（见 §1.8）。
- `removeArtifacts` 对每个项目目录 `access` -> `rm(force: true, recursive: true)`；`access` 抛错就当不是这个会话的目录，静默跳过（92-98 行）。
  根目录不存在直接返回 `0`（84-88 行）。

### 1.5.6 空闲 agent 怎么被停掉【实证：lib/index.js:182-191】

```js
async function disposeAgentFiber(agent) {
  const fiber = agent?.ctx?.fiber;
  if (fiber?._unload === undefined) return false;
  try { await fiber._unload(); return true; } catch { return false; }
}
```

- 走的是 `agent.ctx.fiber._unload()` —— 作者注释说这会让「agent-loop 的 effect 按逆序清理，包括 agent 与其会话挂载的有序拆除」。
- **注意下划线前缀**：`_unload` 是内部方法。这属于**触碰内部实现**，是升级脆弱点。
- 它只在 agent 空闲时走；running 直接被拒。

**这三处的公开性已逐一判定**【实证：解 asar 内的官方包源码，详见 `_research/EVIDENCE-A.md` §3.10 与本节末尾】：

| 调用 | 判定 | 依据 |
|---|---|---|
| `agent.ctx.fiber._unload()` | **Cordis 明确的 private 方法** | `@deepseek-ai/cordis` `src/fiber.ts:675` 写着 `private async _unload()` |
| `sessions.store.get(id).detach()` | **内部实现**（无文档） | `store` 是 `SessionStore` 的实例字段（`dsh-session/lib/index.js:1597`）；`README` 只文档化 `create/get/list/fork/flush/registerMessageProjection` |
| `ws.detachSession(id)` | **半公开**（类型层导出 + 官方自用，README 无记载） | `dsh-workspace/lib/types/entity.js:109` 有类型；`dsh-webhook/lib/index.js:201` 在用；`dsh-workspace/README.md` grep 0 命中 |

**Cordis 的公开替代是 `fiber.dispose()`**（`fiber.ts:195-196`：`public readonly dispose: () => Promise<void>`）。

> **更严重的一点**：`agent.ctx` 是 agent 的 **scope 上下文**，不是 agent 的拥有者上下文。
> 直接调它的 `fiber._unload()` **只清空该 fiber 自己的 disposables**，而且当 `epoch !== INACTIVE` 时
> 会立刻触发 `this._reload()`（重新加载），并且 `_unload()` 返回的 Promise **不 await 这个 reload**。
> agent-loop 真正的拆卸链（`cancel` → `whenIdle` → `scope.dispose()` → `detachAgent`/`detachSession`）
> **不在这条路径上**。因此「`disposeAgentFiber` 真能停掉一个空闲 agent」**只有静态推断，未经运行时验证**。
> 【出处：`_research/EVIDENCE-A.md` §3.10(d)】

> 复刻时的处置：**不要**直接调 `_unload()`。优先用公开的 `fiber.dispose()` / `scope.dispose()`；
> 找不到就在响应里如实降级（返回 `refused` + `hint`），**不要假装停掉了**。

## 1.6 Client 半：DOM 增强算法

### 1.6.1 模块形态【实证：client.js:12-20, 243-246】

```js
window.__ModuleLoader__.load({
  id: "dsh-session-cleaner",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    // ...
    exports.apply = apply;
    exports.inject = ["sessions", "locale"];
    return module.exports;
  }
});
```

- `id` **必须等于包名**（否则 Loader 找不到）。
- `react` 从**浏览器模块表**取，不需要自己打包 React、不需要 CDN、不需要 UMD。
- 工厂是**惰性**的：真正执行的时机由 Loader 决定。
- 注意：这个 client.js 里 `react` 被 require 了但**从未使用**——纯粹的冗余（见 §1.8）。

### 1.6.2 为什么走 DOM 增强（而不是 slot）

`client.js:4-11` 的注释把原因说得很直白：

> The row ⋮ menu is rendered by the upstream `ui-workspace` component with a
> **hardcoded item list and no public slot**, so the client half augments the
> opened menu in the DOM

即：行 ⋮ 菜单是上游组件**硬编码渲染**的，**没有公开插槽**。

> **【重要更正 · 见 §1.10】** 上游这句「没有公开插槽」的判断**在 1.0.2 时代已经不成立**。
> 官方 `dsh-client-ui-workspace` 包**确实声明了两个公开 slot**：
> `sidebar.workspaces.session.menu.item`（行 ⋮ 菜单 list）与
> `sidebar.workspaces.session.row.action`（行悬停按钮 list）。
> 【实证：`_research/dsh/ref/dsh-client-ui-workspace/README.md:98` 与 `lib/client.js:1661,1665`】
> 完整判据与复刻做法见 **§1.10** 与 **§3.3**。

> 【官方】无论插槽是否存在，DOM 增强这种做法都与 DSH 官方规范**正面冲突**。官方 `references/practices.md` 写得很清楚：
> 「Do not write DOM outside your component or append to `document.body`.」
> 官方给的出路是「**选一个已经分配空间的 slot**」。
>
> 所以：**上游的做法是「在现有宿主下唯一可行」，不是「推荐范式」**。复刻时的正解见 §3.3。

### 1.6.3 菜单归属判定（本插件最精巧的一段）【实证：client.js:175-215】

难点：菜单渲染在 **Portal** 里（`Menu portal: true`），DOM 上**不在**会话行内部，所以「这个菜单属于哪一行」没有现成答案。

上游的解法是**时间窗 + 几何距离**双重约束：

```js
// 1) capture 阶段全局记录「最后一次会话行点击」
document.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof Element) {
    const row = target.closest('[role="treeitem"], [class*="sessionRow"]');
    if (row !== null) lastRowClick = { row, at: Date.now() };
  }
}, true);

// 2) 菜单出现时判定归属
const rowForMenu = (menuEl) => {
  const inline = menuEl.closest('[role="treeitem"], [class*="sessionRow"]');
  if (inline !== null) return { row: inline, source: "inline" };   // 万一就在行内
  const hit = lastRowClick;
  if (hit === null) return null;
  if (Date.now() - hit.at > 1500) return null;                      // 时间窗 1.5 s
  const dist = rectDistance(menuEl.getBoundingClientRect(), hit.row.getBoundingClientRect());
  if (dist > 80) return null;                                       // 几何窗 80 px
  return { row: hit.row, source: "portal" };
};

// 3) 矩形距离：重叠或相接时为 0
function rectDistance(a, b) {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
}
```

为什么两个窗都要？注释里给了答案【实证：client.js:178-181】：
**其它弹出层（模型选择器、权限选择器）会同时不满足这两个条件**——它们要么离得远，要么不是紧接着那次行点击开的。

### 1.6.4 会话 id 解析【实证：client.js:71-107】

因为没有组件上下文，拿不到 `sessionId`，只能**用标题反查**：

```js
// 1) 向宿主 RPC 要会话目录
const res = await fetch("/api/session.list", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "client-request",
    rpcId: "session-cleaner-" + Math.random().toString(36).slice(2),
    method: "session.list",
    payload: {}
  })
});
const body = await res.json();
const items = body?.result?.value?.items ?? [];

// 2) 跳过空白会话与子代理会话，按标题建索引
for (const item of items) {
  if (item.blank || item.origin === "subagent") continue;
  const title = item.projections?.values?.title;
  if (typeof title !== "string" || title === "") continue;
  if (!catalog.has(title)) catalog.set(title, []);
  catalog.get(title).push({ id: item.sessionId, running: item.running === true });
}

// 3) 用行内 span 文本去撞标题
function resolveSession(rowEl, catalog) {
  const spans = rowEl.querySelectorAll("span");
  for (const span of spans) {
    const text = span.textContent?.trim() ?? "";
    if (text === "") continue;
    const entries = catalog.get(text);
    if (entries !== undefined && entries.length === 1) return entries[0];
  }
  return undefined;
}
```

**同名标题直接跳过**：`entries.length === 1` 才返回，否则 `undefined` -> 不注入菜单项。
理由是**安全优先**：删错会话不可逆，宁可少一个按钮。

### 1.6.5 注入的菜单项【实证：client.js:110-165】

```html
<button type="button" role="menuitem" data-session-cleaner-menu="1">🗑 删除此会话</button>
```

样式令牌（**只有这三个是主题令牌，其余全是硬编码**）：

| 用途 | 声明 |
|---|---|
| 危险色 | `color: var(--dsw-alias-danger, #e5484d)` |
| hover 背景 | `background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))` |
| 分隔线 | `border-top: 1px solid var(--dsw-alias-hairline, rgba(128,128,128,.25))` |

其余是内联字面量：`padding:6px 12px`、`font-size:13px`、`gap:8px`、`margin-top:4px`、
运行中 `opacity:0.45`、`cursor:default`。

交互流程：

```text
点击 -> preventDefault + stopPropagation
     -> running ? return（按钮本身 disabled）
     -> window.confirm(dict.confirm)
     -> POST /api-ext/session.delete
     -> ctx.sessions.refresh()          // 刷新侧边栏
     -> 失败：window.alert(dict.failed + message)
```

### 1.6.6 生命周期【实证：client.js:216-241】

```js
const observer = new MutationObserver(...);
observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('[role="menu"]').forEach(maybeAugment);
ctx.effect(() => () => observer.disconnect(), "session-cleaner: menu observer");
```

- 观察 `document.body` 整棵子树 -> **每一次 DOM 变更都会触发回调**（性能代价，见 §1.8）。
- `ctx.effect(() => cleanup, label)` 正确注册了清理 —— 这一点是**符合官方规范**的。

## 1.7 语言处理【实证：client.js:20-32, 60-64】

```js
const NS = "sessionCleaner";
const zh = { delete: "删除此会话", confirm: "确定删除此会话？删除后不可恢复。", failed: "删除失败：", running: "会话正在运行，无法删除" };
const en = { delete: "Delete session", confirm: "Delete this session? This cannot be undone.", failed: "Delete failed: ", running: "Session is running and cannot be deleted" };

const inject = ["sessions", "locale"];

// apply 里：
ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-cleaner: locale");
```

**但它实际渲染时用的是另一套判断**：

```js
function uiLang() {
  const lang = document.documentElement.lang || navigator.language || "en";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}
```

即：**注册了 locale 服务，却在渲染路径上绕开它，自己读 `document.documentElement.lang`**。
这是一个**自相矛盾之处**（见 §1.8），也是复刻时必须修掉的点。

## 1.8 上游自述与代码实际的偏差清单【实证】

这是本手册最有用的部分之一：**上游文档/注释承诺的行为，代码未必兑现**。

> **编号说明**：D1–D15 是本手册自身核对的结果；**D16–D20 是第二轮独立取证**（解 asar 读官方包源码）后新增/修正的条目。
> 完整证据（含 `文件:行号`）见 `_research/EVIDENCE-A.md` §5。**其中 D8 与 D16/D17 是复刻时最不能忽略的三条。**

| # | 自述（README / 注释） | 代码实际 | 判定 |
|---|---|---|---|
| D1 | 注册了 `ctx.locale.register` 并在 `inject` 里声明 `locale` | 渲染路径用 `uiLang()` 直接读 `document.documentElement.lang`，**完全绕开 locale 服务** | **自相矛盾**：宿主切换语言时注册进 locale 的文案不会被用到 |
| D2 | `let react = require("react")` | 全文**没有任何地方使用 `react`** | 冗余；也说明它**没有**走 React/slot 路线 |
| D3 | 「运行中会话的菜单项 disabled」 | 一致（`item.disabled = running`） | 一致 |
| D4 | 「标题有歧义（重名）时跳过注入」 | 一致（`entries.length === 1`） | 一致 |
| D5 | 「当前正在运行的对话永远无法被删除」 | 一致（running agent -> `refused`） | 一致 |
| D6 | 「响应格式与宿主 RPC 风格一致」 | 一致（`{ok,value}` / `{ok,error}`） | 一致，但**全部 HTTP 200** |
| D7 | `detachWorkspaces` 注释说 `sessionIds` 是已按 cwd 过滤的 getter | `removed += 1` **在 `ws.detachSession?.()` 之后无条件执行** | **计数口径瑕疵**：`workspaces` 可能虚高 |
| D8 | `scripts.test = "node --test test/"` | `files` 白名单**不含 `test/`**，tarball 里没有测试目录 | **发布缺口**：装出来的包跑不了测试 |
| D9 | README 说安装后「重启 dsh web」 | patch 里没有 `disabled`，装入即启用；但**新 bundle 首次装载**确实需要重启 | 一致（措辞略含糊） |
| D10 | 未提 | **没有同源校验 / CSRF 防护**：任何能发同源 POST 的页面都能删会话 | **安全缺口**，见 §7.2 |
| D16 | 文档写 `POST /api-ext/session.delete` | **handler 内没有任何 `req.method` 判断**；宿主路由只按 pathname 匹配 -> `GET / HEAD / PUT / DELETE` 任意方法都会进入删除逻辑 | **文档与实现不一致**（D5） |
| D17 | README 暗示「同源调用可用」 | 官方 `dsh-host-webserver` 文档明写 `No server-wide TLS, authentication, or origin policy`；官方的 `/api` 通道自带围栏，但 `/api-ext/*` **不以 `/api/` 开头**，**绕开了整条围栏** | **安全缺口**（D10 的机制解释） |
| D18 | 「有 agent 附着（运行中或空闲）的会话会被拒绝」（头注释 + README 各一处） | 同一份 README 另一处又写「UI 打开的会话（空闲 agent）会先停后删」——**README 内部自相矛盾**；代码实际只拒 `status === "running"` | **文档内部冲突**（D1），代码与后一处一致 |
| D19 | 「当前正在运行的对话永远无法被删除」 | 只覆盖 `running` 的一半：当前对话若处于 `idle`（打开着但没在跑），守卫不触发 -> 走 `disposeAgentFiber` -> 若返回 `true` 则**三处删除全部执行** | **要么文档夸大，要么是能删掉当前对话的缺陷**（D2） |
| D20 | 头注释称 `store` 是「the **public** Map」 | `dsh-session/README.md` 全文 grep `store` **0 命中**，只文档化了 `create/get/list/fork/flush/registerMessageProjection` | 自称，非文档事实（D13） |
| D11 | 未提 | 没有速率限制、没有并发保护（同一 id 并发两次删除会互相踩） | **健壮性缺口** |
| D12 | 未提 | `MutationObserver` 挂在 `document.body` 整棵子树、每次 DOM 变更都遍历 `addedNodes` | **性能代价**，长会话列表里明显 |

## 1.9 上游「可复刻性缺口」汇总

复刻时**这一节就是你的 TODO 清单**：

1. **无 Config schema** —— 阈值（1 MiB / 1500 ms / 80 px）、路径、是否要确认框，全硬编码，用户改不了。
2. **无测试**（见 D8）—— 但作者为单测留了 4 个内部导出，说明他打算写。
3. **无同源/CSRF 校验**（D10）—— 删除类端点，这是硬伤。
4. **注册清理不对称**：`webServer.register` 没有配套的 `ctx.effect` 包裹（106-173 行），
   靠的是「插件卸载即整行消失」这个粗粒度语义。对比 `observer` 是包了的。
5. **DOM 强耦合**（`[role="treeitem"]`、`[class*="sessionRow"]`、`span` 文本撞标题）——
   上游一改样式，本插件静默失效（不报错、不注入、用户以为没装）。
6. **`_unload()` / `store` / `fiber` 等内部 API** —— 升级脆弱点。
7. **无鉴权/权限模型** —— 任何已登录 Web UI 的人都能删任何会话。
8. **无审计** —— 删了不留痕。删除类插件应当留一条可查记录。

## 1.10 【关键更正】会话行菜单**有**公开插槽——上游的 DOM 增强前提已过期

上游 client.js 的注释断言「行 ⋮ 菜单是硬编码渲染、没有公开插槽」。**这个判断是错的**（至少对当前版本的 DSH 而言）。

### 1.10.1 证据

```text
_research/dsh/ref/dsh-client-ui-workspace/README.md:98
```

> The Session row's "..." menu and its hover buttons are two `list` slots declared by the
> WorkspaceBrowser entry: `sidebar.workspaces.session.menu.item` and
> `sidebar.workspaces.session.row.action`. **Every menu row and every hover button is an entry,
> this package's own actions included**: `apply` registers `pin` (menu 100, button 200),
> `rename` (200), `fork` (300), and `archive` (menu 400, button 100) **the way a
> client plugin registers its actions**, so a plugin action lands wherever its `order` says,
> and reusing a shipped id at another `priority` shadows that action.

渲染点也已实证：

````js
// _research/dsh/ref/dsh-client-ui-workspace/lib/client.js:1661
children: renderSlot("sidebar.workspaces.session.menu.item", { /* ... */ }),
// :1665
renderSlot("sidebar.workspaces.session.row.action", { /* ... */ }),
````

同为 list slot 的官方声明（本仓库市场用的那个）：

`````js
// _research/dsh/ref/dsh-client-ui-sidebar/lib/client.js:515
"sidebar.footer.action": { kind: "list", scope: "root" },
// :403 渲染点
children: renderSlot("sidebar.footer.action", { wide }),
`````

### 1.10.2 这个发现改变了什么

上游 client.js 的**全部复杂度**（MutationObserver 全树监听、1500 ms 时间窗、80 px 几何窗、`rectDistance`、
按 `span` 文本撞标题、同名歧义跳过）**都是为了绕开一个不存在的约束**。

用官方插槽，这些**一条都不需要**：

| 上游的复杂度 | 用插槽后 |
|---|---|
| MutationObserver 监听 `document.body` | 不需要（注册即渲染） |
| 时间窗 + 几何窗判 Portal 归属 | 不需要（行身份直接作为 props 传入） |
| 读 `[role="treeitem"]` / `[class*="sessionRow"]` | 不需要（不读宿主 DOM） |
| `POST /api/session.list` 拉目录 + 按标题建 Map | 不需要（props 已给 `sessionId`、`displayTitle`） |
| 同名标题跳过注入 | **不需要**——插槽直接给 id，不存在歧义（功能反而更完整） |

### 1.10.3 官方给的插槽行范式（逐字摘自 README）

`````tsx
type ExportRowProps =
  PropsRuntime<'sidebar.workspaces.session.menu.item'>
  & PropsLocale<typeof NS>
  & InjectFace<ExportRowInjected>

function ExportRow({ sessionId, displayTitle, useMenuOpenState, exportSession, t }: ExportRowProps) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton separatorBefore onSelect={() => { setMenuOpen(false); exportSession(sessionId) }}>
      {t('export', { title: displayTitle })}
    </MenuItemButton>
  )
}

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'acme-session-actions: dictionaries')

  // Order 500 places the row after the shipped Archive (400); separatorBefore opens the plugin group.
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item',
    id: 'acme.export-session',
    order: 500,
    locale: NS,
    inject: (): ExportRowInjected => ({ exportSession }),
  }, ExportRow))
}
`````

三个必须照抄的细节（README:100, 163）：

1. **`An entry receives only the row identity (`sessionId`, `displayTitle`) and owns everything else.`**
   —— 门项拿到的就是行身份，宿主**不再**给你别的；其余数据得自己通过注入的 hook 读。
2. **菜单项渲染一个 `role="menuitem"` 按钮，并通过 slot 级的 `useMenuOpenState` 关闭菜单。**
3. **`ctx.slots.inject()` 在 owner 通常在场时也是必须的**：
   `it waits for the declaration, removes the contribution when that declaration collapses, and registers it again after restoration.`

> **结论**：复刻**必须**走 `sidebar.workspaces.session.menu.item`（或 `sidebar.workspaces.session.row.action`），
> **不要**复制上游的 DOM 增强。这既是规范要求（§2.1 R-22/R-25），也是更简单、更稳定的实现。
> 具体落到本手册的 §3.3「方案 A」。

> **【待核实】** 插槽是否存在以**运行中的** `cordis_inspect_query` `Slots.listSubTree` 为准。
> 本手册的引文来自当前桌面版随包文档（`app.asar`），**版本变更后必须复核**。
> 另外 `MenuItemButton` 来自 `dsh-client-ui-primitives` —— 注意 R-3.6/R-3.17 的边界：
> **Module Loader lane 可经 loader 的 `require` 解析它（隐式基线 external），但不得把它列为运行时依赖、也不得另打一份**。


---

# 第 2 章 代码规范：DeepSeek Harness 插件硬规则

本章是本手册的**规范性核心**。规则来自 DSH 官方自带文档（桌面版 `app.asar` 内官方包），
每条给出**原文引文**与**违规后果**。完整清单见附录 B。

> 取证说明：下列引文全部来自本环境从 `app.asar` 抽取的官方文件，路径见每条的「出处」。
> 抽取方法见 §9.5。**【官方】标记的条目在换 DSH 版本后必须重新抽取复核。**

## 2.1 规则总表

### A 组：包与清单

| ID | 规则 | 违规后果 |
|---|---|---|
| **R-01** | 插件 = 一个 npm 包，其 `package.json` 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`；patch 用 `insert` 插入插件行 | 不声明则 Loader 不装载；市场也识别不到 |
| **R-02** | 行 `id` 与包 `name` 必须唯一，且行 `name` 必须等于 `package.json.name` | 行解析失败，插件停在 pending |
| **R-03** | 声明 `dsh.client` 时必须同时提供 `./client` 导出 | 客户端半装载失败，UI 不出现 |
| **R-04** | `dsh.client.inject` **只用于排序激活，不是依赖声明**；"entries only order activation and stay allowed" | 误当依赖用会导致激活顺序错乱 |
| **R-05** | 需要给管理界面看的展示元数据放 `meta.title`/`meta.description`，图标放顶层 `icon`（相对路径，SVG/PNG/JPEG/WebP，≤ 256 KiB） | 绝对路径、URL、越出目录、外部符号链接一律被拒；卡片退回默认图 |
| **R-06** | `exports` 必须放开 `"./package.json"`（管理界面要读清单） | 管理卡片读不到元数据 |
| **R-07** | 用 `peerDependencies` 声明 Cordis，不要用 `dependencies` | profile 里会出现第二份框架实例 |

**R-01/R-02 原文**：`app.asar!dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md`
> A bundle is a package whose `package.json` declares `dsh.bundle.patch`; the YAML patch inserts plugin entries. Give the package and rows unique names; use the Loader's existing YAML syntax, including `!!js` where expressions are needed.

**R-05 原文**（同文件）：
> `icon` is a path relative to the manifest directory; SVG, PNG, JPEG, and WebP up to 256 KiB are accepted, while absolute paths, URLs, paths outside the directory, and symlinks leaving it are rejected. Missing fields fall back to `package.json` `name` and `description` and to the panel's default artwork; malformed metadata produces a diagnostic and keeps the valid text.

### B 组：Host 半

| ID | 规则 | 违规后果 |
|---|---|---|
| **R-10** | `index.js` 只能导出**一种**形态：`export function apply(ctx, config) {}`（可带 `inject`/`Config`），或一个 service class 作 default export；**"do not mix them"** | 导出面歧义，插件激活行为未定义 |
| **R-11** | 一切资源（命令、监听、定时器、路由、观察器）都必须在 `apply` 内注册，并用 `ctx.effect`/`ctx.on` 返回清理函数 | 热卸载后资源泄漏，重复注册 |
| **R-12** | 可选服务放进 `inject` 或 `ctx.inject([...], ...)`，让插件在缺少该服务的组合里**保持不激活**而不是抛错 | 缺服务时整行崩掉 |
| **R-13** | 需要用户可调的值必须做成插件 `Config`；用户的 patch 层要在升级后存活 | 用户只能改代码，升级即丢配置 |
| **R-14** | 不得追加新的 session event `type`；读取方只有在信封带 `ignorable: true` 时才接受未知类型，而 `Session.append()` 设不了该标记 | 会话**拒绝重新打开**，数据损坏 |
| **R-15** | waterfall 监听器（`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre-execute`、`tools/execute`、`tools/post-execute`）不拥有该决策时必须 `return next()`；改写 `agent/pre-step` 决策要展开（`{ ...decision, messages }`） | 吞掉其他插件的决策，链式调用断裂 |
| **R-16** | 需要「无论如何都成立」的拒绝用 `ctx.tools.guard()`；只去掉工具用 `ctx.tools.restrict()`；不要监听 `system-prompt/assemble` 来增删工具 | 顺序敏感、误伤其他插件 |
| **R-17** | 每会话状态优先做成 `ctx.sessionProjections` 单元（`apply(state, event)` 纯函数同步、忽略的事件返回同一引用），不要订阅 `session/event` 全量重扫 | 每次事件全量重算，长会话卡顿 |
| **R-18** | 等待**持久事件**（`turn/end`、`assistant/message`、`tool/result`），实时 token 用 `agent/assistant-stream`；**不要轮询 `agent/status`** | 轮询造成无谓唤醒与竞争 |
| **R-19** | 定时器唤醒 agent 用 `agent.followup()`；`agent.inject()` **不唤醒** agent（上下文会躺在 inbox 里等下一次输入） | 定时任务看起来「没反应」 |

**R-10 原文**：`references/host-plugin.md`
> `index.js` exports one of these forms; do not mix them: `export function apply(ctx, config) {}` with optional `export const inject = ['tools']` and `export const Config`. A service class as the default export.

**R-11 原文**（同文件）：
> Register every resource inside `apply` with `ctx.effect` or `ctx.on` and return its cleanup.

**R-12/R-14/R-17 原文**：`references/practices.md`
> Put optional services in `inject` or `ctx.inject([...], ...)` so the plugin stays inactive in profiles without them instead of throwing.

> Do not append session events with a new `type`. Readers accept an unknown stored event only when its envelope carries `ignorable: true`, and live `Session.append()` cannot set that marker, so the Session would refuse to reopen.

> Keep per-session state derived from the log in a `ctx.sessionProjections` unit instead of subscribing to `session/event` and rescanning `session.events`.

### C 组：Client / UI（本手册最重要的一组）

| ID | 规则 | 违规后果 |
|---|---|---|
| **R-20** | **UI 必须渲染成 slot 里的 React 组件** | 见 R-21/R-22 的具体禁令 |
| **R-21** | **禁止**由 Host 出 HTML 页面再塞进 iframe：iframe 文档拿不到宿主主题令牌、明暗切换与 `ctx.locale` | 视觉与宿主割裂，主题切换失效 |
| **R-22** | **禁止**在自己组件之外写 DOM，**禁止**往 `document.body` 追加；不要替换应用根节点，也不要追加第二份应用 | 与宿主渲染树冲突，卸载后残留 |
| **R-23** | **禁止** `require('@deepseek-ai/dsh-client-ui-primitives')`，也禁止把任何 Harness Client 包当模块加载；`dsh.client.inject` 条目只用于排序、仍然允许写 | 无类型检查的纯 JS 插件碰上会变的内部 API；组件一抛错整条 slot entry 崩（控制台 `slot entry crashed in '<slot>'`） |
| **R-24** | 样式**只用** `--dsw-alias-*` 主题令牌；字面色仅限纯美术 | 硬编码色在明暗切换/换主题时失效 |
| **R-25** | 不读别的插件的 DOM、样式表或组件源码来「估位置」；**选一个已经分配空间的 slot** | 宿主一改结构就静默失效 |
| **R-26** | 工厂（factory）保持**纯粹、无副作用**；样式、定时器、监听器等资源在 `apply` 里用 `ctx.effect`/`ctx.on` 注册并返回清理函数 | 惰性工厂在非预期时机产生副作用 |
| **R-27** | 通过 slot 贡献：`ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`；会话数据经 slot props 的 selector hook 读取，只订阅最小切片 | 订阅过宽导致无谓重渲染 |
| **R-28** | 面向用户的文案走 Client locale 服务 | 语言切换无效；多语言缺失 |
| **R-29** | 组件内联样式可作为 React 元素渲染，以便卸载时随组件移除 | 卸载后样式残留 |

**R-20/R-21/R-24/R-25 原文**：`references/practices.md`
> Render plugin pages as React components in a slot. Do not serve an HTML page from the Host and embed it in an iframe: an iframe document does not receive the host's theme tokens, light/dark switching, or `ctx.locale`.

> Style with the theme tokens that `cordis_inspect_query` `Theme` lists (`--dsw-alias-*`); literal colors are for artwork only.

> Do not write DOM outside your component or append to `document.body`.

**R-23 原文**（同文件）：
> Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other Harness Client package as a module; `dsh.client.inject` entries only order activation and stay allowed. They change without notice, a plain-JS plugin has no type check, and a throwing component blanks your slot entry (console: `slot entry crashed in '<slot>'`).

**R-26/R-29 原文**：`references/ui-plugin.md`
> Keep factories free of side effects. Register styles, timers, listeners and other resources inside `apply` with `ctx.effect`/`ctx.on` and return their cleanup functions. Component-local styles can render as React elements so unmounting removes them.

> Do not replace the app root or append a second application to `document.body`. Do not read another plugin's DOM, stylesheet, or component source to estimate placement; choose a slot that already allocates space.

### D 组：扩展点选择（由弱到强）

**R-30 原文**：`references/practices.md`
> Extension points are shared; use the weakest mechanism that suffices. From weakest to strongest: `ctx.tools.restrict()` can only remove tools; `ctx.tools.guard()` can only deny; waterfall listeners can rewrite and depend on registration order; `system-prompt/assemble` replaces the whole assembly. The stronger the mechanism, the more of other plugins' contributions you must preserve.

### E 组：验证与验收

| ID | 规则 | 违规后果 |
|---|---|---|
| **R-40** | 判定「是否生效」只看安装结果的 `application` 与 `warnings` 字段——**不是**服务器日志、终端输出、进程列表或页面 boot payload | 把「重启后才生效」误报成「已生效」 |
| **R-41** | 新增行用 `cordis_inspect_query` 确认（该调用无需批准），不要去翻 `list_plugins` | 效率低且触发不必要的批准 |
| **R-42** | 无浏览器控制时，验证**只能**覆盖 JavaScript 语法、清单校验、live Client slot 注册，并**明确声明**视觉验证不可用 | 谎报「已验证可用」 |
| **R-43** | 不要用 shell 启动浏览器、改 `HOME`、翻浏览器 profile、找 token、改钥匙串来获取截图；不要为缺浏览器去找光栅化工具、Quick Look、抽 SVG 做预览、模拟 React/DOM 或自写渲染器 | 违规且「模拟页面截图」不构成验证 |
| **R-44** | 会话日志是唯一真相：模型能看到的一切都必须能从已提交的会话事件重建 | 插件内存状态当真相 -> fork/resume/replay 不一致 |
| **R-45** | 用 `plugin_manager` 的 `install_bundle` 安装，不要用 shell 复现安装步骤；`approvedBuilds` 只在用户明确批准后传 | 绕过审批、状态不可追踪 |

**R-40/R-41 原文**：`cordis-plugin-development/SKILL.md`
> Read the installation result: its `application` and `warnings` fields decide whether the change is live, not server logs, terminal output, process lists, or the page's boot payload. Confirm new rows with `cordis_inspect_query`, which needs no approval, rather than paging `list_plugins`.

**R-42/R-43 原文**：`references/verification.md`
> For a visual-only request without browser control, limit verification to JavaScript syntax, manifest validation, and the live Client slot, then report that visual verification remains unavailable. Before or after installation, do not search for rasterizers, invoke Quick Look, extract SVG into preview files, emulate React/DOM, or implement a custom renderer to compensate for missing browser control.

**R-44 原文**：`references/practices.md`
> The session log is the only source of truth. Anything the model sees must be reconstructable from committed session events; fork, resume, and replay derive from the log. Plugin memory is a derived cache.

### F 组：操作与用户动作

| ID | 规则 | 违规后果 |
|---|---|---|
| **R-50** | 一个操作只实现一次，放在 Host service method 里，UI 与 agent tool **共用**它 | UI 与工具行为分叉 |
| **R-51** | 授予/确认权限的动作（批准工具调用、回答 agent 的提问、放宽策略）**只能用户做**，不得暴露给 agent tool | 权限模型被绕过 |
| **R-52** | 有 agent 工具的操作，验证时要**只用工具执行一遍**，与 UI 动作比对状态变化、返回值与失败 | 两套路径没有一致性证据 |

**R-50/R-51 原文**：`references/user-actions.md`
> Implement the operation once as a Host service method. It returns the result or an explicit status, and a failure carries its reason.

> An action that grants or confirms authority, such as approving a tool call, answering a question the agent asked, or loosening a policy, stays user-only. Do not maintain separate operation logic in the UI and tool paths.

## 2.2 上游 dsh-session-cleaner 对规范的偏离清单

把 §1 的上游实现逐条对照上表：

| 上游做法 | 违反 | 严重度 | 复刻时怎么改 |
|---|---|---|---|
| 用 `MutationObserver` 监听 `document.body`，向 Portal 菜单 `appendChild` 一个 `<button>` | **R-22**（禁止在组件外写 DOM / 往 body 追加）、**R-20**（必须 slot 内 React 组件） | 高 | 改成 slot 注册（§3.3） |
| `require("react")` 却完全不用；渲染走 `document.createElement` | **R-20** | 高 | 直接用 React 组件 |
| 用 `[class*="sessionRow"]`、`[role="treeitem"]`、行内 `span` 文本去撞标题 | **R-25**（不得读宿主 DOM 估位置） | 高 | 从 slot props 的 selector hook 取 `sessionId` |
| 内联硬编码 `padding`/`font-size`/`gap`/`opacity`，只有 3 个颜色用了令牌 | **R-24**（只用令牌）、**R-29** | 中 | 全部走令牌 + 组件内样式元素 |
| 注册了 `ctx.locale.register` 却用 `document.documentElement.lang` 取语言 | **R-28** | 中 | 一律走 locale 服务（§6.4） |
| `webServer.register(...)` 没有 `ctx.effect` 包裹 | **R-11** | 中 | 用 `ctx.effect` 包住注册与注销 |
| 触碰 `agent.ctx.fiber._unload()`、`sessions.store` 等内部成员 | 不算明文违规，但**高风险**（R-44 精神：以会话日志为真相；内部 API 会变） | 中高 | 先 `cordis_inspect_query` 确认；能走公开方法就走公开方法 |
| 无 `Config`，阈值写死 | **R-13** | 中 | 全部阈值进 `Config` |
| 无 `meta` / `icon` | **R-05**（非强制，但影响市场卡片） | 低 | 补 `meta` + `locale/*.json` + `icon.svg` |

> **一句话结论**：上游是一个**能用但高度耦合宿主 DOM** 的实现。
> 复刻的价值不在于抄它的写法，而在于**抄它的能力边界（三处同删、running 守卫、同名跳过），换一套合规的实现骨架**。

## 2.3 本仓库既有实例：`dsh-plugin-market` 的示范价值

本仓库的 `plugin-market/` 是一个**符合规范**的 host+client 双半实例，可作为复刻的样式参照：

| 它做了什么 | 对应规则 |
|---|---|
| `package.json` 有 `dsh.bundle.patch` + `dsh.client@{platform, inject}`，`files` 白名单完整 | R-01 / R-03 |
| `cordis.patch.yml` 写明 `inject: [webServer]` 并解释了「少了它 apply 可能早于 webServer 就绪」 | R-12 |
| `pluginManager` 被当作**可选能力**，用 `ctx.get('pluginManager')` 运行时判断，缺少时市场降级为只读浏览 | R-12 |
| `docs/API-CONTRACT.md` 冻结了 `{ok:true,value}` / `{ok:false,error:{code,message,hint}}` 信封、语义化 HTTP 码、同源判定、64 KiB 上限、10 s 读超时、完整错误码表 | §5 契约范本 |
| `verify/` 下有 `*.test.mjs` 单测 + `verify-market.ps1` 端到端脚本 + `market-ui.e2e.mjs`（CDP） | §8 验收范本 |

**复刻时应直接沿用它的契约骨架**：错误码分段、`hint` 字段、同源判定顺序、读超时的处理方式。


---

# 第 3 章 复刻设计：能力等价 + 形态合规

## 3.1 复刻目标的三条红线

复刻**不是**把上游代码抄一遍。三条必须守住的红线：

1. **能力等价**：三处同删（内存 live 条目 / 工作区记录 / 磁盘目录）、running 守卫、同名歧义跳过——一个都不能少。
2. **形态合规**：UI 走 slot 里的 React 组件；样式只用令牌；文案走 locale；资源用 `ctx.effect` 释放；可调项进 `Config`。
3. **不可逆操作的诚实**：删除类功能必须在 UI 上明确「不可恢复」，失败原因原样透出，不做「静默成功」。

## 3.2 功能映射表

| 上游能力 | 上游实现 | 复刻实现 | 变化理由 |
|---|---|---|---|
| 删除会话（HTTP） | `POST /api-ext/session.delete` | **保留同一路径与信封** | 兼容既有调用方与浏览器控制台用法 |
| 内存 live 条目摘除 | `sessions.store.get(id).detach()` | 先 `cordis_inspect_query` 确认再沿用；否则降级为「只删盘 + 报告 `detached:false`」 | 内部 API 有升级风险【待核实】 |
| 工作区记录摘除 | `ws.detachSession(id)` | 同左，但**修正计数**（只在真正调用成功时 +1） | 修掉 §1.8 D7 |
| 磁盘目录删除 | 遍历 `$DSH_HOME/sessions/*/<id>` 逐个 `rm -rf` | 同左，但**先做路径包含校验**，并记录被删路径清单 | 防路径穿越 + 可审计 |
| running 守卫 | `agent.status === "running"` -> `refused` | 同左 | 安全必需 |
| 空闲 agent 先停 | `agent.ctx.fiber._unload()` | 优先用公开的 stop/dispose 方法；找不到才降级，且**在响应里说明降级** | 内部 API 风险 |
| UI 入口 | `MutationObserver` 增强 Portal 菜单 | **slot 注册的 React 组件**（§3.3） | R-20/R-22/R-25 |
| 语言 | 内联字典 + 读 `document.lang` | locale 服务 + `locale/*.json` | R-28 |
| 阈值 | 硬编码 | `Config` schema | R-13 |
| 同源防护 | 无 | 同源判定 + 写操作 POST-only + 64 KiB 上限 + 读超时 | §7.2 |
| 审计 | 无 | 每次删除写一条结构化日志 + 可选持久留痕 | §7.5 |

## 3.3 UI 形态：从「DOM 增强」到「slot 注册」

### 3.3.1 先纠正一个前提

上游认为「行 ⋮ 菜单是 `ui-workspace` 硬编码渲染的，没有公开插槽」，因此只能改 DOM（§1.6.2）。

> **这个前提是错的。** 官方 `dsh-client-ui-workspace` 包**声明了两个公开 list slot**：
> `sidebar.workspaces.session.menu.item`（行 ⋮ 菜单）与 `sidebar.workspaces.session.row.action`（行悬停按钮）。
> 完整证据见 **§1.10**。上有的全家复杂度（DOM 观察、时间窗、几何窗、标题撞 id）在插槽方案下**一条都不需要**。

### 3.3.2 复刻的三个候选形态（按推荐度排序）

**方案 A —— 会话行 ⋮ 菜单项（首选，已实证存在且完全合规）**

**这是本手册最终推荐的方案**。官方真声明了这两个 slot：

```text
sidebar.workspaces.session.menu.item    <- 行 "..." 菜单 list   （用它）
sidebar.workspaces.session.row.action   <- 行悬停按钮 list      （或用它）
```

它同时满足：R-20（slot 内 React 组件）、R-22（不碰宿主 DOM）、R-25（不读宿主 DOM 估位置）、
R-3.4 / R-3.5（走 `ctx.slots.inject`）、R-3.13（slot 声明纪律）。

````js
// client.js —— factory 只定义组件与 apply，无副作用（R-3.8）
window.__ModuleLoader__.load({
  id: "dsh-session-cleaner-clone",          // 必须等于包名
  factory(require) {
    const React = require("react");         // React 来自浏览器模块表，不要另打一份
    const { MenuItemButton } = require("@deepseek-ai/dsh-client-ui-primitives"); // 隐式基线 external，经 loader 解析

    const NS = "sessionCleanerClone";

    function DeleteRow({ sessionId, displayTitle, useMenuOpenState, t, requestDelete }) {
      const [, setMenuOpen] = useMenuOpenState();
      return React.createElement(
        MenuItemButton,
        { separatorBefore: true, onSelect: () => { setMenuOpen(false); requestDelete(sessionId, displayTitle); } },
        t("action.delete"),
      );
    }

    const inject = ["slots", "locale"];

    function apply(ctx) {
      // 语言包：内置两个 locale 都要给（R-5.2）
      ctx.effect(() => ctx.locale.register(NS, {
        zh: { "action.delete": "删除此会话" },
        en: { "action.delete": "Delete session" },
      }), "session-cleaner-clone: locale");

      // 行 ⋮ 菜单项：order 决定位置（官方 archive=400，取 500 排其后）
      ctx.effect(() => ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
        name: "sidebar.workspaces.session.menu.item",
        id: "session-cleaner-clone.delete",
        order: 500,
        locale: NS,
        inject: () => ({ requestDelete }),
      }, DeleteRow)), "session-cleaner-clone: menu item");
    }

    return { apply, inject };
  }
});
````

> 官方 README:100/163 的三条硬约束（照做）：
> 1. **门项只拿到行身份**（`sessionId`、`displayTitle`），其余自己通过注入的 hook 读；
> 2. 菜单项渲染**一个** `role="menuitem"` 按钮（`MenuItemButton` 已含宿主样式与 `separatorBefore`），
>    并用 slot 级的 `useMenuOpenState` 关菜单；
> 3. `ctx.slots.inject()` **即使 owner 通常在场也必须用**。

**关于「运行中禁用」**：上游靠 `POST /api/session.list` 读 `running`（§1.6.4）。
插槽 props **是否含 running** 官方 README 未明说（只承诺行身份）。两条正路：
- 用注入的 hook 从 Workspace 快照读状态（官方原文：`It reads the Host state it cares about through its own injected hooks`）；
- 或者**不要在客户端猜**：按钮始终可点，由 Host 端点返回 `409 refused`，UI 原样展示原因。

> 【待核实】插槽 props 的**完整**字段表必须用 `cordis_inspect_query` `Slots` 查该 slot 的 registration options 与 props 现场确认。
> 本手册只断言官方 README 明写的部分（`sessionId`、`displayTitle`、`useMenuOpenState`）。

**方案 B —— 侧边栏底部入口 + 管理面板（批量清理场景）**

如果需求是「一次清理几十个会话」，逐行菜单太慢。本仓库的 `dsh-plugin-market` 已经跑通了这条路：

```text
sidebar.footer.action   // kind: list, scope: root
  // 声明：_research/dsh/ref/dsh-client-ui-sidebar/lib/client.js:515 ；渲染点 :403
```

做法：底部入口 -> 打开一个 slot 页面 -> 列出所有会话（标题 / 项目 / 最后活动 / 是否运行中）-> 逐行或批量删除。

优点：
- 不依赖会话行身份，天生能做筛选与批量；**没有**「同名标题跳过」这种功能妥协。
- slot 已实证存在，且本仓库 `plugin-market` 是活范例（`docs/API-CONTRACT.md` 第 0 节把它记为入口 id）。

**推荐组合**：**方案 A 做主入口**（单条删除，体验与上游一致），**方案 B 做可选管理面板**（批量清理）。
两者都走 slot，都不碰 DOM。

**方案 C —— 覆盖层（overlay）**

官方文档提到 `shell.overlay` 的存在【官方】，但明确要求「只在请求确实需要覆盖层、且位置已知时使用」。
删除会话不需要覆盖层。**不推荐**。

**绝对不要做的方案 D —— 复制上游的 DOM 增强**

1. **违规**：R-3.2/R-3.11（组件外写 DOM、读宿主 DOM 估位置）、R-3.1（必须 slot 内 React 组件）。
2. **不必要**：`sidebar.workspaces.session.menu.item` 已经存在（§1.10），**没有**要绕开的约束。
3. **更脆弱**：上游靠 `[class*="sessionRow"]` 这种**哈希类名**定位；宿主一改构建产物就静默失效（§1.8 D12）。
4. **更复杂**：1500 ms 时间窗 + 80 px 几何窗 + 标题撞 id + 同名歧义跳过，全是自找的复杂度。
5. **功能更弱**：同名标题时上游**直接不显示按钮**；插槽方案不会丢失任何一条会话。

> 一句话：**「上游当时只能这么做」——现在能了，就别再这么做了。**

## 3.4 服务端设计

### 3.4.1 分层

```text
lib/
  index.js        插件入口：apply(ctx, config)，只做装配与路由注册
  config.js        Config schema（阈值、路径、开关）
  service.js       SessionCleaner 服务：唯一的能力实现（R-50）
  http.js          路由注册 + 同源判定 + 读体/写体（契约层）
  store.js         内存 live store 的适配与降级
  workspaces.js    工作区记录适配
  artifacts.js     磁盘目录定位与删除（含路径包含校验）
  audit.js         审计留痕
```

**R-50 要求一个操作只实现一次**：`service.js` 里的 `deleteSession(id)` 是唯一实现，
HTTP 路由、slot UI、以及（如果做）agent tool 都调它。

### 3.4.2 删除事务（复刻版，含修正）

```text
deleteSession(sessionId, { actor })
  1. 校验 sessionId（正则 + 长度）
  2. 幂等锁：同一 id 并发请求，第二个直接返回第一个的结果（修 D11）
  3. agent 守卫
       running            -> { ok:false, code:"refused" }   （原样拒绝）
       空闲且有安全停止法  -> 停止 -> 继续
       空闲但无安全停止法  -> { ok:false, code:"refused", hint:"请先关闭该会话" }
  4. detached  = store.detach(id)           // 失败不抛错，记 false
  5. workspaces = registry.detach(id)       // 只在真正调用成功时计数（修 D7）
  6. files     = artifacts.remove(id)       // 返回被删路径清单
  7. audit.record({ sessionId, actor, detached, workspaces, files, at })
  8. return { ok:true, value:{ detached, workspaces, files } }
```

**顺序理由**（与上游一致，见 §1.5.5）：先摘内存再删盘；agent 守卫最前。

### 3.4.3 为什么幂等锁必须加

上游没有并发保护：两个请求同时对同一 id 跑 `removeArtifacts`，第二个会在 `access` 抛错时静默跳过，
但 `detachWorkspaces` 会**重复计数**，UI 上看到 `workspaces: 2`。复刻版用 `Map<sessionId, Promise>` 做单飞。

---

# 第 4 章 工程骨架

## 4.1 目录结构

```text
dsh-session-cleaner-clone/
├── package.json
├── cordis.patch.yml
├── icon.svg
├── LICENSE
├── README.md
├── README.zh.md
├── CHANGELOG.md
├── locale/
│   ├── en.json
│   └── zh.json
├── lib/
│   ├── index.js          Host 半入口
│   ├── config.js         Config schema
│   ├── service.js        能力实现（唯一）
│   ├── http.js           路由 + 同源 + 读写体
│   ├── store.js          内存 store 适配
│   ├── workspaces.js     工作区适配
│   ├── artifacts.js      磁盘删除
│   └── audit.js          审计
├── client.js             Client 半入口（slot 注册）
└── test/
    ├── session-id.test.mjs
    ├── artifacts.test.mjs
    ├── http-contract.test.mjs
    ├── config.test.mjs
    └── service.test.mjs
```

## 4.2 package.json（可直接用）

```json
{
  "name": "dsh-session-cleaner-clone",
  "version": "1.0.0",
  "description": "Delete DeepSeek Harness sessions from the running web runtime: live store detach, workspace records, and on-disk artifacts.",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "files": [
    "lib",
    "client.js",
    "cordis.patch.yml",
    "locale",
    "icon.svg",
    "README.md",
    "README.zh.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "node --test test/",
    "check": "node --check lib/index.js && node --check client.js"
  },
  "keywords": ["deepseek-harness", "dsh", "plugin", "session", "delete", "cleanup"],
  "license": "MIT",
  "meta": {
    "title": "Session Cleaner",
    "description": "Delete sessions from the running Harness runtime."
  },
  "icon": "./icon.svg",
  "engines": { "node": ">=20.0.0" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale"]
    }
  }
}
```

与上游清单的差异（**每一处都是修复**）：

| 差异 | 理由 |
|---|---|
| 加了 `meta` 与 `icon` | R-05：市场/管理卡片要显示 |
| 加了 `locale/*.json` 导出与 `locale` 进 files | R-28 |
| `files` 保留 `test/`？**不加**（发布物不需要测试），但仓库里必须有 | 修 D8：`npm test` 在仓库跑得通 |
| `dsh.client.inject` 去掉 `dsh-client-ui-conversation` | 复刻版走 slot，不再需要会话 UI 包 |
| 加了 `@deepseek-ai/dsh-plugin-manager`？**不加** | 走 `plugin_manager` 安装即可，无需运行时依赖 |

## 4.3 cordis.patch.yml

```yaml
# dsh-session-cleaner-clone bundle patch.
#
# 把下面这一行 insert 进 profile 的根条目列表。inject 让 Cordis 等 webServer
# 就绪后再激活本插件；少了它，apply() 可能在 webServer 存在之前跑，
# POST /api-ext/session.delete 注册不上，客户端会拿到 404。
- insert:
    - id: session-cleaner-clone
      name: 'dsh-session-cleaner-clone'
      inject:
        - webServer
```

> 【官方】覆盖语义：匹配到的 override 会**替换整个 config**。
> 所以如果用户要在自己的 patch 里改一个阈值，必须把整个 `config` 写全。

## 4.4 装配与安装

```sh
# 1) 用 plugin_manager 安装（R-45），不要用 shell 复现安装步骤
plugin_manager { action: "install_bundle", target: "<绝对路径>/dsh-session-cleaner-clone" }

# 2) 读返回值的 application / warnings 判断是否生效（R-40）
#    application: applied  -> 已生效
#    restart-required       -> 未生效，需重启 dsh web
#    failed                 -> 诊断

# 3) 确认新行（R-41）
cordis_inspect_query  ... 找到 id: session-cleaner-clone 的行
```

> 【官方】`list_plugins` 与 `list_bundles` 返回既有安装的精确标识；`set_plugin` / `set_bundle` 切换；
> `remove_bundle` 移除。要**分别**看已保存状态与激活结果：`failed` 需要诊断，`overridden` 表示更高优先级层赢了，
> `restart-required` 表示还没生效。**替换已安装的包需要重启**才能加载新的 JS 模块代际——不要因为 slot id 没变就以为浏览器代码更新了。


---

# 第 5 章 接口契约（冻结版 v1.0.0）

> 本章是本复刻的**前后半唯一接口来源**。两侧都按本章实现，**不要单方面修改**。
> 体例沿用本仓库 `docs/API-CONTRACT.md`（已实证的契约范本），字段命名与上游 `dsh-session-cleaner` 保持兼容。

## 5.0 标识

| 项 | 值 |
|---|---|
| npm 包名 | `dsh-session-cleaner-clone` |
| 客户端 bundle id | 必须**等于包名** |
| Loader 行 id（cordis.patch.yml） | `session-cleaner-clone` |
| 面板 / slot 入口 id | `session-cleaner-clone` |
| 版本 | `1.0.0` |
| 路由前缀 | `/api-ext/session-cleaner` |

> 关于路径：上游用的是 `/api-ext/session.delete`（**带点号**）。复刻版若要与上游共存，请**沿用上游路径**；
> 若是干净复刻，建议用带前缀的 REST 风格（下表）。**同一 profile 内不要让两个插件注册同一路径**——`webServer.register` 的 `kind: "exact"` 会冲突。

## 5.1 通用约定

- 所有响应 `Content-Type: application/json; charset=utf-8`，`Cache-Control: no-store`。
- 成功：`{ "ok": true, "value": {...} }`。
- 失败：`{ "ok": false, "error": { "code": string, "message": string, "hint"?: string } }`。
- **同时**使用语义化 HTTP 状态码：`400` 参数错误 / `403` 跨站或不允许 / `404` 未知路径 /
  `405` 方法不允许 / `409` 冲突（会话运行中）/ `429` 过于频繁 / `500` 内部错误 / `504` 超时。
- **兼容性说明**：上游全部返回 `200`。为了兼容「只读 `body.ok`」的既有调用方，**响应体信封保持上游形状**，
  仅**额外**把状态码写对。这样两代调用方都能工作。（取舍说明见 §5.4。）
- POST 写操作只接受「有可信来源证据」的请求，判定顺序（实现见 `lib/http.js`）：
  1. `Origin: dsh-app://app` 或 `dsh-app://shell` -> 放行（官方 Electron 桌面壳的页面 origin，页面脚本无法伪造）；
  2. `Sec-Fetch-Site: cross-site` -> 拒绝；
  3. 有 `Origin` -> 其 host 必须与 `Host` 一致，否则拒绝；
  4. **两个头都不存在 -> 仅当客户端是回环地址时放行**；
  5. 只有 `Sec-Fetch-Site` -> 仅 `same-origin` 放行。
  拒绝时返回 `403 cross-origin`，且 `hint` 里如实带上收到的 `Origin` / `Sec-Fetch-Site` / 来源地址，便于定位。
  > 第 4 条是官方桌面壳 `dsh-desktop-host.forwardWebRequest` 的真实行为纠正过来的：它在转发前会删除
  > `Host`、`Origin`、`Cookie`、`Sec-Fetch-Site`（再补上宿主 cookie），所以桌面端写请求**天然不带这两个头**。
  > 早期把它当跨站，导致 Electron 里的写操作全部 403。【实证，摘自本仓库 `docs/API-CONTRACT.md`】
- `Content-Type` 必须是 `application/json`，请求体上限 **64 KiB**（上游是 1 MiB；删除类端点不需要那么大）。
- **读取有 10 秒上限**：只挂 `end`/`error` 时，客户端声明 `Content-Length: 100`、只发 10 字节后保持连接不动，
  会让 Promise **永不 settle**——handler 与 socket 一起无限期挂着（宿主默认 `requestTimeout` 300 s 也只是把「永远」变成「五分钟」）。
  到点按 `bad-request` 明确回错。【实证，摘自本仓库 `docs/API-CONTRACT.md`】

## 5.2 错误码清单

| code | HTTP | 含义 | `message` 口径 |
|---|---|---|---|
| `bad-request` | 400 | 请求体读取/解析失败、超限、`sessionId` 缺失或非法 | 「会话 id 不合法」/「请求体过大」/「请求体不是合法 JSON」 |
| `cross-origin` | 403 | 同源判定失败 | 「请求来源不可信」+ hint 带收到的头 |
| `method-not-allowed` | 405 | 非 POST | 「该端点只接受 POST」 |
| `not-found` | 404 | 未知路径 | 「未知接口」 |
| `refused` | 409 | 会话有 running agent，或空闲 agent 无法安全停止 | 「会话正在运行，请先停止再删除」 |
| `cleaner-unavailable` | 500 | 宿主缺少必需服务（`sessions` 等） | 「宿主缺少删除会话所需的服务」+ hint 列出缺哪个 |
| `internal` | 500 | 未预期异常（先 `ctx.logger.warn`） | 原样带异常 message |
| `delete-failed` | 500 | 删除动作部分失败（已删一半） | 明确「已删除什么、剩下什么」 |

> **面向用户的 `message` 用中文短句，遵守「发生了什么 / 为什么 / 现在怎么办」**（沿用本仓库契约口径）。
> 英文字符串由客户端 locale 层按 `code` 映射，**不要**让 Host 返回本地化文案。

## 5.3 路由

### 5.3.1 `POST /api-ext/session-cleaner/delete`

请求：

```json
{ "sessionId": "session-1bb8d361-ea6b-4b92-bab2-c858c92e8822" }
```

成功 200：

```json
{
  "ok": true,
  "value": {
    "sessionId": "session-1bb8d361-ea6b-4b92-bab2-c858c92e8822",
    "detached": true,
    "workspaces": 1,
    "files": 1,
    "removedPaths": ["<DSH_HOME>/sessions/<project>/session-1bb8d361-..."]
  }
}
```

失败（例）409：

```json
{ "ok": false, "error": { "code": "refused", "message": "会话正在运行，请先停止再删除" } }
```

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | string | 回显，便于调用方对账 |
| `detached` | boolean | 是否从**内存 live store** 摘除成功（false 表示降级为只删盘） |
| `workspaces` | number | 成功摘除的工作区记录条数（**修正了上游的虚高计数**） |
| `files` | number | 删除的磁盘会话目录数 |
| `removedPaths` | string[] | 实际删除的路径清单（审计用；**上游没有这个字段**） |

### 5.3.2 `POST /api-ext/session-cleaner/list`

给 slot UI 用的会话清单（避免客户端直接打宿主 RPC，也便于统一过滤）。

请求：

````json
{ "filter": { "project": null, "running": null, "query": "" }, "page": 1, "pageSize": 50 }
```

响应：

````json
{
  "ok": true,
  "value": {
    "total": 128,
    "page": { "page": 1, "pageSize": 50, "pages": 3 },
    "items": [
      {
        "sessionId": "session-...",
        "title": "插件市场接口契约",
        "project": "E:\\Code\\dsh-plugin-market",
        "running": false,
        "updatedAt": "2026-10-03T12:00:00.000Z",
        "blank": false,
        "origin": "user",
        "deletable": true,
        "blockedReason": null
      }
    ]
  }
}
````

- `deletable` 由 Host 判定（running、缺服务等），**UI 不得自己猜**。
- `blockedReason` 是给 UI 显示的人话解释（中文），`null` 表示可删。

### 5.3.3 `GET /api-ext/session-cleaner/status`

````json
{
  "ok": true,
  "value": {
    "plugin": { "name": "dsh-session-cleaner-clone", "version": "1.0.0" },
    "capabilities": { "detachLive": true, "detachWorkspaces": true, "removeArtifacts": true },
    "config": { "maxBodyBytes": 65536, "readTimeoutMs": 10000, "confirmInUi": true, "audit": true }
  }
}
````

`capabilities` 的意义：宿主版本不同，某个能力可能不可用（例如 store 没有 `detach`）。
**UI 据此显示降级提示，而不是假装全能。**

## 5.4 取舍说明：200 还是语义化状态码？

| 方案 | 优点 | 缺点 |
|---|---|---|
| 全 200（上游） | 与宿主 RPC 风格一致；上游客户端不需改 | 网关/日志/监控看不到失败；浏览器 `fetch` 的 `res.ok` 永远 true |
| 语义化（本仓库契约） | 可观测性好；符合 HTTP 语义 | 既有调用方若只看 `res.ok` 会误判 |
| **本手册方案：信封不变 + 状态码写对** | 两代调用方都能工作 | 需要明确文档说明 |

**实现要求**：`lib/http.js` 里 `sendJson(res, status, body)` 必须**显式传状态码**，
禁止出现「写死 200」的辅助函数（上游 `sendJson` 就是写死 200 的，见 `lib/index.js:43-50`）。

## 5.5 幂等与并发

- 同一 `sessionId` 的并发删除请求：**第二个复用第一个的 Promise**（单飞），返回同一结果。
- 已不存在的会话：返回 `ok: true`，`detached:false, workspaces:0, files:0` —— **删除是幂等的**，
  重复删除不报错（否则网络重试会误报失败）。

---

# 第 6 章 视觉与交互规范

## 6.1 只用令牌，不写字面色

【官方】`references/practices.md`：
> Style with the theme tokens that `cordis_inspect_query` `Theme` lists (`--dsw-alias-*`); literal colors are for artwork only.

上游只用了 3 个令牌（§1.6.5），其余全是内联字面量。复刻版**全部走令牌**。
本环境已实证存在的令牌（来自上游 client.js 的使用）：

| 令牌 | 用途 | 上游是否用了 fallback |
|---|---|---|
| `--dsw-alias-danger` | 危险操作前景色 | 是（`#e5484d`） |
| `--dsw-alias-interactive-bg-hover` | 交互项 hover 背景 | 是（`rgba(128,128,128,.12)`） |
| `--dsw-alias-hairline` | 分隔线 | 是（`rgba(128,128,128,.25)`） |

> 【官方】令牌列表的权威来源是 `cordis_inspect_query` 的 `Theme`。
> **动手前先查一次**并把结果贴进你的插件 README——本表只是本环境观察到的 3 个，不是全集。
>
> 【待核实】其它语义令牌（危险背景、正文色、次要文本色、面板背景、圆角、间距）的确切名字本手册**不猜测**。
> 用 `cordis_inspect_query` 取。

**关于 fallback**：上游给每个令牌都写了 fallback 值。这是**双刃剑**——令牌改名时不会崩（好事），
但也可能掩盖「令牌不存在」，让你以为渲染正常。建议：**保留 fallback，但在开发期把 fallback 设成刺眼的颜色**（如 `magenta`），
一眼就能看出哪个令牌没生效。

## 6.2 视觉状态（必须全覆盖）

| 状态 | 表现 | 无障碍要求 |
|---|---|---|
| 正常 | 危险色文字 + 垃圾桶图标 | `role="menuitem"` 或 `role="button"` |
| hover | 令牌背景 | 不得只靠颜色传达（配合指针） |
| focus | 可见焦点环（用宿主 focus 令牌） | **键盘可达**，`Tab` 能到 |
| disabled（会话运行中） | 降透明度 + `cursor: default` + `aria-disabled="true"` | 不可点击；**必须有 tooltip 说明原因** |
| 忙碌（删除中） | 按钮进入 pending，禁止重复点击 | `aria-busy="true"` |
| 失败 | 原样展示 `error.message` + `hint` | 用 `role="alert"` |
| 成功 | 该行移除 + 顶部一次性提示 | 不得只靠动画 |

## 6.3 确认与不可逆提示

- **必须有二次确认**，文案必须含「不可恢复」。
- 确认框要显示**会话标题**，避免删错行。
- **不要**用 `window.confirm`（上游用的就是这个）：它会阻塞浏览器、无法主题化、无法国际化。
  官方 [R-23] 要求自己写控件并匹配宿主形态——本仓库 `docs/API-CONTRACT.md` 也提到过 Modal 的焦点与 Escape 处理。
- 批量删除时，确认框要写明**条数**与「其中 N 条运行中将被跳过」。

## 6.4 文案走 locale

【官方】`references/ui-plugin.md`：
> Route visible UI text through the Client locale service.

复刻版做法：

```json
// locale/zh.json
{
  "title": "会话清理",
  "action.delete": "删除会话",
  "action.deleteBulk": "删除选中的 {count} 个会话",
  "confirm.title": "删除会话？",
  "confirm.body": "「{title}」将被永久删除，此操作不可恢复。",
  "state.running": "会话正在运行，无法删除",
  "state.deleting": "正在删除…",
  "error.refused": "会话正在运行，请先停止再删除",
  "error.cross-origin": "请求来源不可信，已拒绝",
  "error.internal": "删除失败：{message}",
  "summary.done": "已删除 {count} 个会话",
  "summary.partial": "成功 {ok} 个，失败 {failed} 个"
}
```

**上游的反面教材**（§1.7 D1）：注册了 `ctx.locale.register` 却用 `document.documentElement.lang` 取语言。
复刻版**禁止**读 DOM 属性判语言。

## 6.5 明暗与窄屏

- 只用令牌 -> 明暗自动跟随，**不需要**写 `prefers-color-scheme` 分支。
- 窄视口（侧栏面板）：列表用两行式（标题一行、元信息一行），删除按钮放行尾图标位。
- 动效尊重 `prefers-reduced-motion`。


---

# 第 7 章 安全与风险：删除类插件的红线

删除会话是**不可逆破坏性操作**。上游把它做成了一个无防护的 HTTP 端点。复刻必须补上。

## 7.1 红线清单

| # | 红线 | 为什么 |
|---|---|---|
| S1 | **正在运行的会话绝不能删** | agent 正在追加 session log；删盘会导致写入失败、日志断裂 |
| S2 | **当前对话绝不能删** | 用户正在跟它说话；删了 UI 会崩 |
| S3 | 删除必须**二次确认**且文案含「不可恢复」 | 误点不可逆 |
| S4 | 目标 id 必须**服务端再校验一次** | 客户端可以是恶意的；正则 + 路径包含双重校验 |
| S5 | 写操作必须**同源校验** | 否则任意页面可发起 CSRF |
| S6 | 必须**审计留痕** | 出了事要能查「谁在什么时候删了什么」 |
| S7 | 不得**跨 profile / 跨 HOME** 删除 | 路径推导必须相对 `DSH_HOME`，且做包含校验 |

## 7.2 上游的安全缺口（逐条）

| 缺口 | 后果 | 复刻对策 |
|---|---|---|
| **无同源校验**：`webServer.register` 的 handler 直接处理任何请求，**且不校验 `req.method`** | 【实证】官方 `dsh-host-webserver/README.md:113` 明写「**No server-wide TLS, authentication, or origin policy** — route owners such as `dsh-client-connection` enforce their own request policy.」。官方的 `/api` 通道自带围栏（`dsh-client-connection` 的 `isTrustedApiRequest` + `browserAuth`），但上游的 `/api-ext/*` **不以 `/api/` 开头**，**整条围栏都没命中**——这是「有路由、没门禁」 | 按 §5.1 的五步同源判定；`Content-Type` 必须是 `application/json`；**显式校验 `req.method === "POST"`**（上游漏了） |
| **不校验 HTTP 方法**（D16） | 宿主路由只按 pathname 匹配，因此 `GET / HEAD / PUT / DELETE` 任意方法都会执行删除 | 显式拒绝非 POST，返回 `405 method-not-allowed` |
| **1 MiB 请求体** | 比需要的大 16 倍，浪费内存 | 降到 64 KiB |
| **无速率限制** | 可被脚本批量删除 | 加令牌桶（如 10 次/分钟）+ 单飞锁 |
| **无审计** | 删了查不到 | 结构化日志 + 可选 JSONL 留痕 |
| **无鉴权** | 任何能访问 Web UI 的人都能删任何会话 | 至少复用宿主的会话权限；若无权限模型，至少在 UI 上要求确认 |
| **错误信息回显内部异常** | `internal` 把 `String(error.message)` 原样返回，可能泄露路径 | 内部错误只回通用文案，详细写进 `logger.warn`；路径信息只进审计 |
| **`removedPaths` 未做包含校验**（上游根本没这个字段，但它的 `join` 依赖正则兜底） | 若 `SESSION_ID_RE` 被放宽，就会路径穿越 | 删除前用 `path.resolve` + `startsWith(rootDir + sep)` 二次确认 |

## 7.3 路径安全（必须实现的代码）

```js
import { resolve, sep } from "node:path";

/**
 * 确认 target 落在 root 之内（防路径穿越）。
 * 只有 resolve 后确实位于 root 子树内才返回 true。
 */
export function isInside(root, target) {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}
```

配合 `SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/`（上游版本，§1.5.4）形成**双重防线**：
正则挡掉明显的恶意字符，`isInside` 兜住「正则被改宽」的情况。

> 上游**没有** `isInside` 这一层。它靠一条正则包打天下——这在当前 id 空间下够用，但**不是可依赖的安全边界**。

## 7.4 并发与幂等

````js
const inFlight = new Map(); // sessionId -> Promise<Result>

export async function deleteOnce(sessionId, run) {
  const existing = inFlight.get(sessionId);
  if (existing !== undefined) return existing;      // 单飞
  const p = (async () => {
    try { return await run(); }
    finally { inFlight.delete(sessionId); }
  })();
  inFlight.set(sessionId, p);
  return p;
}
````

理由见 §3.4.3：上游没有这层，`workspaces` 计数会虚高，且两次 `rm` 会互相报错（被静默吞掉）。

## 7.5 审计

每次删除写一条（JSON 一行）：

````json
{
  "at": "2026-10-03T12:00:00.000Z",
  "actor": { "kind": "ui", "origin": "http://127.0.0.1:19387" },
  "action": "session.delete",
  "sessionId": "session-1bb8d361-...",
  "title": "插件市场接口契约",
  "result": { "ok": true, "detached": true, "workspaces": 1, "files": 1 },
  "removedPaths": ["<DSH_HOME>/sessions/E-Code-dsh-plugin-market/session-1bb8d361-..."]
}
````

- 默认写到 `<DSH_HOME>/logs/session-cleaner.jsonl`，由 `Config.audit` 开关。
- **失败也要记**（`result.ok: false` + `error.code`）。
- actor 里**不记录**敏感信息（不写 cookie、不写 token）。

## 7.6 失败模式与用户可见行为

| 场景 | 期望行为 |
|---|---|
| 磁盘删除一半失败 | 返回 `ok:false, code:"delete-failed"`，`message` 写清「已删 X，剩下 Y」，`removedPaths` 列出已删的 |
| 内存摘除失败（老版本 store） | 仍继续删盘，返回 `detached:false`，UI 提示「可能需要重启才能从列表消失」 |
| 工作区摘除失败 | 不阻断，`workspaces` 记实际成功数，UI 不特别提示（无害） |
| 请求超时 | 10 s 后 `bad-request` |
| 会话根本不存在 | `ok:true` 全 0（幂等，见 §5.5） |

---

# 第 8 章 验收与测试

## 8.1 验收的官方口径（必须遵守）

【官方】`cordis-plugin-development/SKILL.md`：
> Read the installation result: its `application` and `warnings` fields decide whether the change is live, not server logs, terminal output, process lists, or the page's boot payload.

【官方】`references/verification.md`：
> For a visual-only request without browser control, limit verification to JavaScript syntax, manifest validation, and the live Client slot, then report that visual verification remains unavailable.

**这两条合起来就是验收纪律**：装完先看 `application`，能跑浏览器就跑，不能跑就**如实说没跑**。

## 8.2 四层验收矩阵

| 层 | 测什么 | 手段 | 是否可自动化 |
|---|---|---|---|
| L1 静态 | JS 语法、清单字段、patch YAML 合法性 | `npm run check` + `node --check` + 清单校验脚本 | 是 |
| L2 单元 | sessionId 正则、路径包含校验、Config 校验、幂等锁、错误映射 | `node --test test/` | 是 |
| L3 契约 | 路由的同源判定、状态码、信封形状、超时、超限 | 起桩 `webServer` + 桩 `req/res`，直调 handler | 是 |
| L4 集成 | 真装进 profile、真删一个会话、UI 真的出现 | `plugin_manager install_bundle` + `cordis_inspect_query` + 浏览器 | **部分**（UI 需要浏览器控制） |

> 本仓库的 `verify/` 目录就是 L3/L4 的范本：
> `*.test.mjs`（node --test）、`stub-server.mjs`、`cdp.mjs`（Chrome DevTools Protocol 驱动浏览器）、
> `market-ui.e2e.mjs`（真实 UI e2e）。复刻时**直接借这套脚手架**。

## 8.3 必写单测清单

| 用例 | 断言 |
|---|---|
| `SESSION_ID_RE` 正例 | `session-1bb8d361-...`、纯数字、含连字符通过 |
| `SESSION_ID_RE` 反例 | `../etc/passwd`、`a/b`、`a.b`、空串、129 字符、`-leading` 全拒 |
| `isInside` | `root/x` 通过；`root/../y`、`rootX/y`、绝对路径越界拒 |
| `removeArtifacts` | 桩一个临时 sessions 目录树：只删目标 id 的目录，别的不动；根不存在返回 0 |
| `detachWorkspaces` | 修正后的计数：`detachSession` 不存在时 **不** +1 |
| `deleteOnce` | 并发两次只跑一次 `run`，返回值相同 |
| `readJsonBody` | 空体 -> `{}`；超 64 KiB 抛错；非法 JSON 抛错；10 s 不结束 -> 抛超时 |
| `sendJson` | 状态码**显式**传入；`content-type` 与 `cache-control` 正确 |
| Config schema | 默认值、类型校验、越界拒绝 |
| 错误映射 | 每个 code -> 期望 HTTP 状态码 |

## 8.4 契约测试（起桩）

````js
// test/http-contract.test.mjs 骨架
import { test } from "node:test";
import assert from "node:assert/strict";

function fakeReq({ body = "", headers = {}, remote = "127.0.0.1" }) {
  // 返回一个: AsyncIterable + headers + socket.remoteAddress
}
function fakeRes() {
  // 收集 statusCode / headers / body，提供 writeHead / end
}

test("cross-site is rejected with 403", async () => {
  // Sec-Fetch-Site: cross-site -> 403 cross-origin
});

test("desktop shell origin is allowed", async () => {
  // Origin: dsh-app://app -> 放行
});

test("no origin, non-loopback -> 403", async () => {});
test("body over 64 KiB -> 400 bad-request", async () => {});
test("missing sessionId -> 400 bad-request", async () => {});
test("running agent -> 409 refused", async () => {});
````

> 上游**没有**任何测试（tarball 里就没有 `test/`，见 §1.8 D8）。复刻必须补上——这也是复刻相对上游的**净增值**。

## 8.5 手工验收记录表（照抄执行）

| # | 步骤 | 期望 | 实际 | 判定 |
|---|---|---|---|---|
| 1 | `node --check lib/index.js` / `client.js` | 无输出 | | |
| 2 | `npm test` | 全绿 | | |
| 3 | `plugin_manager install_bundle` | `application: applied`（或 restart-required） | | |
| 4 | `cordis_inspect_query` 查行 | 找到 `id: session-cleaner-clone` | | |
| 5 | 打开 Web UI | 侧栏/面板出现入口 | | |
| 6 | 面板列出会话 | 条数与侧栏一致 | | |
| 7 | 删除一个**冷**会话 | 该行消失；刷新后仍消失 | | |
| 8 | 删除一个**运行中**会话 | 按钮置灰 + 说明；强制调 API 得 409 `refused` | | |
| 9 | 尝试删**当前**会话 | 被拒 | | |
| 10 | 跨站 POST（伪造 `Origin`） | 403 `cross-origin` | | |
| 11 | 重启 `dsh web` | 被删会话**不再出现**（验证没有幽灵行） | | |
| 12 | 明/暗主题切换 | 外观正确，无硬编码色残留 | | |
| 13 | 语言切换 zh/en | 文案跟随（验证没有绕开 locale） | | |
| 14 | 检查审计文件 | 有对应记录 | | |

> 第 11 步是**区分真假实现的关键**：只删盘的实现，重启前列表里消失、重启后又回来了。

## 8.6 无浏览器控制时的诚实报告模板

````text
验证状态（本环境无浏览器控制）：
- [x] JavaScript 语法检查通过（node --check lib/index.js client.js）
- [x] 清单校验通过（package.json / cordis.patch.yml 字段齐全）
- [x] 单元与契约测试 N 项全绿（node --test test/）
- [x] 插件安装返回 application: applied
- [x] cordis_inspect_query 确认行 session-cleaner-clone 已激活
- [ ] **视觉验证未执行** —— 无法确认入口在页面上的实际位置、主题跟随与键盘可达性
- [ ] **端到端删除未执行** —— 未真实删除过任何会话
结论：能力实现与注册已证实；用户可见行为待有浏览器控制时复核。
````

**不要**为了让报告好看而含糊这一点（R-42/R-43）。

---

# 第 9 章 打包、发布与上线检查

## 9.1 发布前检查单

- [ ] `package.json` 的 `files` 覆盖所有运行期文件（`lib`、`client.js`、`cordis.patch.yml`、`locale`、`icon.svg`）
- [ ] `exports` 含 `"./package.json"`（R-06）
- [ ] `exports` 含 `"./client"` 且与 `dsh.client` 匹配（R-03）
- [ ] 客户端 bundle `id` **等于**包名
- [ ] patch 行 `name` **等于**包名（R-02）
- [ ] 没有 `dependencies`（只用 `peerDependencies`，R-07）
- [ ] `npm pack --dry-run` 的文件清单与预期一致
- [ ] 装出来的 tarball 里**没有**绝对路径、没有 `node_modules`、没有测试产物
- [ ] CHANGELOG 有本次版本条目
- [ ] README 中/英同步

## 9.2 版本策略

- 破坏性变更（路由改名、响应字段改语义、patch 行 id 变）-> major
- 新增能力 / 新错误码 -> minor
- 修复 -> patch

> 上游的 `0.2.4 -> 1.0.0` 就是「交互形态大改」触发 major 的例子（§1.2）。

## 9.3 安装与升级路径

````sh
# 从 npm
dsh plugin --profile web add dsh-session-cleaner-clone

# 从本地 checkout
dsh plugin --profile web add file:/path/to/dsh-session-cleaner-clone

# 或走本手册第 4.4 节的 plugin_manager install_bundle
````

> 【官方】`install_bundle` 会替你完成包安装与 bundle 选择；**不要**用 shell 复现这些步骤（R-45）。
> **替换**已安装的包需要**重启**才能加载新的 JS 模块代际；**新增** bundle 可能通过 HMR 直接激活。
> **不要因为 slot id 没变就以为浏览器代码更新了。**

## 9.4 与上游共存

如果同时装了上游 `dsh-session-cleaner` 与本复刻：

- 两者都注册 `/api-ext/session.delete` 会**冲突**（`kind: "exact"` 同路径）。
  **必须**用不同路径（本手册用 `/api-ext/session-cleaner/...`）。
- 两者的 UI 入口 id 不同（`session-cleaner` vs `session-cleaner-clone`），可共存。
- 上游的 DOM 增强会往菜单里插一个按钮；复刻版的 slot UI 在别处。用户会看到**两个入口**——发布说明里要讲清楚。

## 9.5 复核本手册的规范部分（升级 DSH 后必做）

本手册的【官方】条目来自当前桌面版的 `app.asar`。DSH 升级后请重新抽取：

`````js
// 1) 读 asar 头，拿到文件索引
import { openSync, readSync, alloc, mkdirSync, writeFileSync } from "node:fs";
const ASAR = "<DSH 安装目录>/resources/app.asar";
const fd = openSync(ASAR, "r");
const head = Buffer.alloc(16); readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize); readSync(fd, hbuf, 0, headerSize, 16);
const index = JSON.parse(hbuf.toString("utf8"));
const base = 16 + headerSize;

// 2) 展平成路径 -> {offset,size}
const files = [];
(function walk(node, prefix) {
  for (const [k, v] of Object.entries(node.files || {})) {
    const p = prefix + "/" + k;
    if (v.files) walk(v, p);
    else files.push({ p, offset: Number(v.offset), size: Number(v.size) });
  }
})(index, "");

// 3) 抽你要的文件（注意：目录节点的 offset 是字符串，必须 Number() 并判 NaN）
function extract(entry) {
  const b = Buffer.alloc(entry.size);
  readSync(fd, b, 0, entry.size, base + entry.offset);
  return b;
}
`````

> **坑（本手册亲历）**：asar 索引里**目录节点**的 `offset` 是字符串，直接 `base + offset` 会得到 `NaN`，
> `readSync` 抛 `ERR_OUT_OF_RANGE`。必须先 `Number()` + `Number.isFinite` 判定。
> 另外 shell 的 `cat` / `ls` / 原生 ripgrep / `node` 都**打不开** `app.asar` 里的路径——
> 只有「读 `app.asar` 文件本身 + 自己解析」这条路。

要复核的关键文件：

`````text
dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md
dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/*.md
dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-composition-reference/references/packages.md
dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/README.md
dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.md
dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml
`````


---

# 第 10 章 差异对照表：原版 vs 复刻版

## 10.1 能力对照

| 能力 | 上游 `dsh-session-cleaner@1.0.2` | 复刻版 | 判定 |
|---|---|---|---|
| 删内存 live 条目 | `sessions.store.get(id).detach()` | 同（先 inspect 确认） | 等价 |
| 删工作区记录 | `ws.detachSession(id)`，计数虚高 | 同 + 修正计数 | **改进** |
| 删磁盘目录 | 遍历 `$DSH_HOME/sessions/*/<id>` | 同 + `isInside` 双保险 + 返回 `removedPaths` | **改进** |
| running 守卫 | 有 | 有 | 等价 |
| 空闲 agent 先停 | `fiber._unload()`（内部） | 优先公开方法，无可降级且如实报告 | **改进（更诚实）** |
| 同名歧义处理 | 跳过注入 | 面板直接持有 id，无歧义 | **改进** |
| UI 形态 | DOM 增强 Portal 菜单 | slot 内 React 组件 | **合规** |
| 多语言 | 内联字典 + 读 DOM lang（自相矛盾） | locale 服务 | **合规** |
| 主题令牌 | 3 个令牌 + 大量字面量 | 全令牌 | **合规** |
| 可配置 | 无 | `Config` schema | **改进** |
| 同源防护 | 无 | 五步判定 | **安全** |
| 请求体上限 | 1 MiB | 64 KiB | **安全** |
| 读超时 | 无（会被慢连接挂死） | 10 s | **安全** |
| 速率限制 | 无 | 令牌桶 | **安全** |
| 并发保护 | 无 | 单飞锁 | **健壮** |
| 审计 | 无 | JSONL 留痕 | **合规** |
| 幂等 | 部分（不存在时返回全 0，但并发会踩） | 显式幂等 + 单飞 | **健壮** |
| 测试 | 无（files 里没有 test/） | L1–L4 四层 | **改进** |
| HTTP 状态码 | 全 200 | 语义化（信封不变） | **改进** |
| 市场元数据 | 无 `meta`/`icon` | 有 | **改进** |
| 可观测性 | `ctx.logger.warn` | 结构化日志 + `/status` 能力上报 | **改进** |

## 10.2 契约兼容性

| 面 | 是否兼容上游 | 说明 |
|---|---|---|
| 路由 `POST /api-ext/session.delete` | **可选兼容** | 想共存就保留该路径；想干净就用 `/api-ext/session-cleaner/delete` |
| 请求体 `{ sessionId }` | **完全兼容** | 字段名、类型一致 |
| 响应信封 `{ok,value}` / `{ok,error:{code,message}}` | **完全兼容** | 复刻版只**新增**字段（`sessionId`、`removedPaths`） |
| `value.detached` / `workspaces` / `files` | **完全兼容** | 语义一致 |
| HTTP 状态码 | **向后兼容** | 上游调用方读 `body.ok` 即可；只看 `res.ok` 的老代码会受影响（需在发布说明中写明） |
| 错误码 | **部分新增** | `bad-request` / `refused` / `internal` 沿用上游；新增 `cross-origin` 等 |
| patch 行 id | **不同** | `session-cleaner-clone` vs `session-cleaner` -> 可共存 |
| 客户端 bundle id | **必须不同** | 否则 Loader 模块表冲突 |

## 10.3 复刻时必须「照抄」的东西

1. **三处同删的完整语义**（§1.5.5）——这是插件的全部价值。
2. **running 守卫在最前**（§1.5.5 顺序）——安全必需。
3. **响应信封形状**（§5.3）——兼容既有调用方。
4. **`sessionId` 正则的写法**（§1.5.4）——路径穿越的第一道防线。
5. **优雅降级**：`detachLiveStore` 失败不抛错，继续删盘（§1.5.5）——老版本宿主也能用。
6. **`ctx.effect` 注册清理**（§1.6.6）——上游唯一做对的生命周期点。

## 10.4 复刻时必须「反着做」的东西

1. **不要**碰 `document.body` / 不要 MutationObserver 全局监听（R-22）。
2. **不要**用 DOM 文本撞标题来推 id（R-25）。
3. **不要**注册 locale 却绕开它（R-28）。
4. **不要**写死 HTTP 200（§5.4）。
5. **不要**把阈值写死（R-13）。
6. **不要**依赖 `_unload` / `.store` 这类内部成员而不做能力探测。
7. **不要**在没有测试的情况下发布（§8）。

---

# 附录索引

| 附录 | 内容 | 位置 |
|---|---|---|
| 附录 A | 上游 `dsh-session-cleaner@1.0.2` 行为证据包（逐条出处） | `_research/EVIDENCE-A.md` |
| 附录 B | DSH 官方插件代码规范清单（R-编号 + 英文原文引证） | `_research/EVIDENCE-B.md` |
| 附录 C | 可落地的复刻骨架（host 半 + client 半 + 测试，可复制粘贴） | `docs/SESSION-CLEANER-CLONE-APPENDIX.md` |

---

# 收尾：复刻工作的最短路径

如果你只有一天时间，按这个顺序做：

````text
0.5 h  读 §0.3 确认复刻对象身份（byJming 还是 fountunt —— 先搞清楚再动手）
1 h    读 §1.5 + §1.6，把上游的三处同删与守卫语义吃透
1 h    读 §2.1 的 C 组（R-20 ~ R-29），这是复刻与上游最大的分岔
0.5 h  用 cordis_inspect_query 复核 slot 名：sidebar.workspaces.session.menu.item
2 h    写 lib/service.js + lib/artifacts.js + lib/http.js（§3.4 的骨架）
2 h    写 client.js 的 slot 组件（方案 A：行 ⋮ 菜单项）
1 h    写测试（§8.3 的必写清单）
0.5 h  install_bundle + cordis_inspect_query 确认 + 记录验收表（§8.5）
````

**三条最容易翻车的地方**：

1. **以为删了文件就删了会话** —— 不摘内存 live store，重启后「幽灵行」会回来（§8.5 第 11 步专门测它）。
2. **为了「像上游一样挂在 ⋮ 菜单里」而回去写 DOM** —— 那是明确违规（R-22），且上游自己都留了一堆坑（§1.8 D12）。
3. **没验证就报成功** —— 官方口径是看 `application`/`warnings`（R-40），没有浏览器就如实说没做视觉验证（R-42）。

---

*本手册的【实证】结论均可在本工作区复现：上游源码在 `_tmp-scc/package/`，官方文档在 `_research/dsh/`，
asar 路径清单在 `_research/asar-filelist.txt`。*
