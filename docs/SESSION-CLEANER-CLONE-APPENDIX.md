# 附录 C：可落地的复刻骨架（可直接复制）

> **关于本文引用的 `_research/`**：那三份证据文档（`EVIDENCE-A/B.md`、`NOTES.md`）
> 与 `asar-filelist.txt` 在 `.gitignore` 里被显式忽略（见 `.gitignore` 第 21 行 `_research/`），
> **不进仓库**。本文保留完整引用是为了让当时的推理链可追溯；正文里对上游行为的结论
> 已经写在各自段落中，不依赖那些文件也能读懂。若需要原始证据，得重新从 `app.asar` 提取
> （提取脚本同样是本地文件，未入库）。

> 本附录是主手册 `docs/SESSION-CLEANER-CLONE-GUIDE.md` 的配套交付物。
> 每个代码块都可独立复制使用。骨架**已按官方规范写**（对照表见 §C.9），
> **未经过运行验证的接口名**均标为【待核实】，并在 §C.10 集中登记。
>
> 作者：Lead | 状态：草案（规范已对齐，运行时待 `cordis_inspect_query` 复核）

---

## C.1 目录树

```text
dsh-session-cleaner-clone/
├── package.json
├── cordis.patch.yml
├── icon.svg
├── locale/
│   ├── en.json
│   └── zh.json
├── lib/
│   ├── index.js        入口：apply(ctx, config)
│   ├── config.js       Config schema
│   ├── service.js      deleteSession —— 唯一能力实现
│   ├── http.js         路由 + 同源 + 读写体
│   ├── store.js        内存 live store 适配（含降级）
│   ├── workspaces.js   工作区适配（含计数修正）
│   ├── artifacts.js    磁盘删除（含路径包含校验）
│   └── audit.js        JSONL 审计
├── client.js           行 ⋮ 菜单项（slot 注册）
└── test/
    ├── session-id.test.mjs
    ├── artifacts.test.mjs
    ├── contract.test.mjs
    └── service.test.mjs
```

---

## C.2 package.json

`````json
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
`````

对应规范：R-1.1（`dsh.bundle.patch`）、R-1.8（`dsh.client` + `./client`）、R-1.6（`exports` 放开 `locale/*.json` 与 `package.json`）、R-1.7（无构建链）。

> 【待核实】`dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` —— 该包名在官方 asar 12967 条清单中 **0 命中**（见 §C.10）。请用 `cordis_inspect_query` 复核，或直接删掉该条目只留 locale。

---

## C.3 cordis.patch.yml

`````yaml
# dsh-session-cleaner-clone bundle patch.
#
# inject 让 Cordis 等 webServer 就绪后再激活本插件；少了它，apply() 可能在
# webServer 存在之前跑，POST 路由注册不上，客户端会拿到 404。
- insert:
    - id: session-cleaner-clone
      name: 'dsh-session-cleaner-clone'
      inject:
        - webServer
`````

对应规范：R-1.1 / R-1.2（行 id 与行名唯一）。**覆盖语义**：匹配到的 override 会替换**整个** config（R-7.x）。

---

## C.4 lib/config.js

``````js
/**
 * 插件配置（用户可在自己的 patch 层覆盖；覆盖会替换整个 config，务必写全）。
 * 所有阈值集中在这里 —— 上游把这些全写死在代码里（见主手册 §1.9 缺口 1）。
 */
export const name = "session-cleaner-clone";

export const Config = {
  type: "object",
  additionalProperties: false,
  properties: {
    /** 请求体上限（字节）。上游是 1 MiB，这里收紧到 64 KiB。 */
    maxBodyBytes: { type: "integer", minimum: 1024, maximum: 4 * 1024 * 1024, default: 65536 },
    /** 读取请求体的超时（毫秒）。上游没有超时，慢连接会把 handler 挂死。 */
    readTimeoutMs: { type: "integer", minimum: 1000, maximum: 120000, default: 10000 },
    /** 是否要求客户端二次确认（UI 层使用；Host 不信任它）。 */
    confirmInUi: { type: "boolean", default: true },
    /** 是否记录审计。 */
    audit: { type: "boolean", default: true },
    /** 审计文件路径；null 表示 <DSH_HOME>/logs/session-cleaner.jsonl */
    auditPath: { type: ["string", "null"], default: null },
    /** 每分钟最多接受多少次删除请求（令牌桶容量）。0 = 不限。 */
    rateLimitPerMinute: { type: "integer", minimum: 0, maximum: 600, default: 10 },
  },
};
``````

对应规范：R-13（可调值进 Config）、R-2.x（`Config` 在激活时校验行 config）。

---

## C.5 lib/artifacts.js —— 磁盘删除 + 路径包含校验

```````js
import { access, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/** 上游的 id 正则：同时承担路径穿越的第一道防线。 */
export const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

export function isValidSessionId(id) {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

/** 删除类插件必须有的第二道防线：resolve 之后确实落在 root 子树内。 */
export function isInside(root, target) {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** 会话根目录。<DSH_HOME>/sessions，与上游一致。 */
export function sessionsRoot(env = process.env) {
  return join(env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
}

/**
 * 删除该会话在所有项目目录下的工件目录。
 * @returns {Promise<{ count: number, paths: string[] }>}
 */
export async function removeArtifacts(sessionId, root = sessionsRoot()) {
  if (!isValidSessionId(sessionId)) throw new Error("invalid sessionId");

  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return { count: 0, paths: [] }; // 根不存在 —— 没什么可删
  }

  const removed = [];
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const dir = join(root, proj.name, sessionId);
    if (!isInside(root, dir)) continue; // 双保险：即使正则被放宽也进不来
    try {
      await access(dir);
    } catch {
      continue; // 不存在，不是这个会话的目录
    }
    await rm(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return { count: removed.length, paths: removed };
}
```````

对应规范：主手册 §7.3（路径安全）。**相对上游的改进**：`isInside` 二次校验 + 返回被删路径清单（上游只返回计数）。

---

## C.6 lib/service.js —— 唯一能力实现（R-8.x：一个操作只实现一次）

````````js
import { removeArtifacts, isValidSessionId } from "./artifacts.js";

/** 同一 sessionId 的单飞锁（上游没有，导致并发时计数虚高、rm 互相报错）。 */
const inFlight = new Map();

export function createService(ctx, config, audit) {
  const log = ctx.logger;

  /**
   * 唯一的删除实现。HTTP 路由、slot UI、（若做）agent tool 都调它。
   * @returns {Promise<{ok:true,value:object}|{ok:false,error:{code:string,message:string,hint?:string}}>}
   */
  async function deleteSession(sessionId, actor = { kind: "unknown" }) {
    if (!isValidSessionId(sessionId)) {
      return { ok: false, error: { code: "bad-request", message: "会话 id 不合法" } };
    }

    const existing = inFlight.get(sessionId);
    if (existing !== undefined) return existing; // 幂等：复用进行中的请求

    const p = (async () => {
      try {
        // ---- 1. agent 守卫：running 一律拒绝（红线 S1 / S2）----
        const agent = ctx.agents?.get?.(sessionId);
        if (agent !== undefined) {
          if (agent.status === "running") {
            return {
              ok: false,
              error: { code: "refused", message: "会话正在运行，请先停止再删除" },
            };
          }
          const stopped = await stopIdleAgent(agent, ctx);
          if (!stopped) {
            return {
              ok: false,
              error: {
                code: "refused",
                message: "该会话有附加的 agent，且无法安全停止",
                hint: "请先在界面上关闭该会话，再重试删除",
              },
            };
          }
        }

        // ---- 2. 内存 live store 摘除（失败不抛错，优雅降级）----
        const detached = detachLiveStore(ctx.sessions, sessionId);

        // ---- 3. 工作区记录摘除（修正上游的计数虚高）----
        const workspaces = await detachWorkspaces(ctx.workspaceRegistry, sessionId, log);

        // ---- 4. 磁盘工件删除 ----
        const { count: files, paths: removedPaths } = await removeArtifacts(sessionId);

        // ---- 5. 审计 ----
        const value = { sessionId, detached, workspaces, files, removedPaths };
        await audit.record({ actor, sessionId, result: { ok: true, ...value } });
        return { ok: true, value };
      } catch (error) {
        const message = String(error?.message ?? error);
        log?.warn?.(`session-cleaner-clone: delete failed: ${message}`);
        await audit.record({
          actor,
          sessionId,
          result: { ok: false, code: "internal", message },
        }).catch(() => {});
        return { ok: false, error: { code: "internal", message } };
      } finally {
        inFlight.delete(sessionId);
      }
    })();

    inFlight.set(sessionId, p);
    return p;
  }

  return { deleteSession };
}

/**
 * 摘除内存 live 条目。
 *
 * 【已核实 · 属内部实现】sessions.store 是 SessionStore 的**实例字段**（dsh-session/lib/index.js:1597
 *   `store = new Map()`），dsh-session/README.md 只文档化 create/get/list/fork/flush/registerMessageProjection。
 *   entry.detach 挂在该 Map 的匿名 entry 上（:1748-1750），是「立即版」；
 *   而 SessionStore.enter() 的**返回值**才是带 announced/appending 延迟语义的公开 detach 闭包（:1755-1764）。
 *   上游拿的是前者，**绕过了延迟语义**。
 *
 * 因此本实现：① 优先用 store 的服务方法（若该版本提供）；② 退而用 entry.detach；③ 都拿不到就返回 false 降级，
 * 并在响应里如实报告 detached:false，不假装成功。
 */
export function detachLiveStore(sessions, sessionId) {
  // 1) 优先：公开的服务方法（不同版本可能叫不同名字）
  for (const m of ["detach", "release", "close"]) {
    if (typeof sessions?.[m] === "function") {
      try { sessions[m](sessionId); return true; } catch { /* 继续尝试 */ }
    }
  }
  // 2) 退而：entry 上的 detach（内部实现，但当前版本事实可达）
  const entry = sessions?.store?.get?.(sessionId);
  if (entry?.detach === undefined) return false;
  entry.detach();
  return true;
}

/**
 * 从工作区记录摘除。
 * 与上游的差别：只在 detachSession 真的存在且调用成功时才计数（修 D7）。
 */
export async function detachWorkspaces(registry, sessionId, log) {
  if (registry?.list === undefined) return 0;
  let removed = 0;
  for (const ws of registry.list()) {
    const ids = ws?.sessionIds;
    if (!Array.isArray(ids) || !ids.includes(sessionId)) continue;
    if (typeof ws.detachSession !== "function") {
      log?.debug?.(`session-cleaner-clone: workspace cannot detach (no detachSession)`);
      continue;                                  // <-- 上游这里会错误地 +1
    }
    try {
      await ws.detachSession(sessionId);
      removed += 1;
    } catch (error) {
      log?.warn?.(`session-cleaner-clone: workspace detach failed: ${String(error?.message ?? error)}`);
    }
  }
  return removed;
}

/**
 * 停一个空闲 agent（仅空闲；running 已在上面被拒）。
 *
 * 【已核实】上游用的 agent.ctx.fiber._unload() 是 **Cordis 的 private 方法**
 *   （@deepseek-ai/cordis src/fiber.ts:675 `private async _unload()`）。
 *   公开替代是 **fiber.dispose()**（fiber.ts:195-196 `public readonly dispose`）。
 *   更关键：agent.ctx 是 agent 的 **scope** 上下文，直接 _unload 它只清自己的 disposables，
 *   且 epoch !== INACTIVE 时会触发 _reload()（且不 await），并不走 agent-loop 的完整拆卸链
 *   （cancel -> whenIdle -> scope.dispose -> detachAgent/detachSession）。
 *   因此本实现**不碰 _unload()**：找不到公开入口就如实返回 false 让上层拒绝。
 */
export async function stopIdleAgent(agent, ctx) {
  // 1) 首选：Cordis 的公开 dispose（agent 的 scope fiber 会沿原型链解析到它）
  const fiberDispose = agent?.ctx?.fiber?.dispose;
  if (typeof fiberDispose === "function") {
    try { await fiberDispose.call(agent.ctx.fiber); return true; } catch { /* 继续尝试 */ }
  }
  // 2) 次选：scope 自己暴露的 dispose（dsh-scope 的 createScope 返回 { dispose }）
  const scopeDispose = agent?.ctx?.dispose;
  if (typeof scopeDispose === "function") {
    try { await scopeDispose.call(agent.ctx); return true; } catch { /* 继续尝试 */ }
  }
  // 3) 兜底：agent 自己的公开停止方法（若该版本提供）
  for (const m of ["stop", "dispose", "close"]) {
    if (typeof agent?.[m] === "function") {
      try { await agent[m](); return true; } catch { /* 继续尝试下一个 */ }
    }
  }
  return false; // 诚实降级：不碰私有 _unload()，让上层返回 refused
}
````````

对应规范：R-50（一个操作两个调用方共用）、R-8.x。**相对上游的改进**：幂等单飞、计数修正、不碰内部 API、失败也审计。

---

## C.7 lib/http.js —— 契约层（同源 + 读写体 + 状态码）

`````````js
import { resolve } from "node:path";

export function sendJson(res, status, body) {
  // 注意：状态码**显式传入**。上游的 sendJson 写死 200（lib/index.js:43-50），
  // 导致网关/监控/日志看不到失败。
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** 语义化状态码映射。信封形状保持上游一致，兼容只看 body.ok 的调用方。 */
export const STATUS = {
  "bad-request": 400,
  "cross-origin": 403,
  "method-not-allowed": 405,
  "not-found": 404,
  refused: 409,
  "rate-limited": 429,
  "cleaner-unavailable": 500,
  "delete-failed": 500,
  internal: 500,
};

export function fail(res, code, message, hint) {
  const error = { code, message };
  if (hint !== undefined) error.hint = hint;
  sendJson(res, STATUS[code] ?? 500, { ok: false, error });
}

/**
 * 同源判定（沿用本仓库 docs/API-CONTRACT.md 的冻结顺序）。
 * 第 4 条是真实环境纠正过的：官方桌面壳转发前会删掉 Host/Origin/Cookie/Sec-Fetch-Site，
 * 所以桌面端写请求天然不带这两个头 —— 早期当跨站会导致 Electron 里全部 403。
 */
export function checkOrigin(req) {
  const origin = req.headers?.origin;
  const site = req.headers?.["sec-fetch-site"];
  const host = req.headers?.host;

  if (origin === "dsh-app://app" || origin === "dsh-app://shell") return { ok: true };
  if (site === "cross-site") return { ok: false, origin, site };
  if (origin !== undefined) {
    try {
      if (new URL(origin).host === host) return { ok: true };
    } catch { /* 非法 origin 视为不可信 */ }
    return { ok: false, origin, site };
  }
  const remote = req.socket?.remoteAddress ?? "";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (site === undefined) return loopback ? { ok: true } : { ok: false, origin, site };
  return site === "same-origin" ? { ok: true } : { ok: false, origin, site };
}

/** 流式读 JSON 体：有上限、有超时（上游两者都不完整）。 */
export async function readJsonBody(req, { limit, timeoutMs }) {
  let size = 0;
  const chunks = [];
  const timer = setTimeout(() => {
    req.destroy?.(new Error("read timeout"));
  }, timeoutMs);
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new Error("request body too large");
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(timer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
`````````

对应规范：R-11（路由用 `ctx.effect` 注册）、契约 §5.1/§5.2。

---

## C.8 lib/index.js —— 入口

``````````js
import { Config } from "./config.js";
import { createService, detachLiveStore, detachWorkspaces, stopIdleAgent } from "./service.js";
import { createAudit } from "./audit.js";
import { checkOrigin, fail, readJsonBody, sendJson } from "./http.js";
import { removeArtifacts, isValidSessionId, isInside, sessionsRoot } from "./artifacts.js";

export const name = "session-cleaner-clone";
export { Config };

/** 可选服务放 inject，让插件在缺少它们的组合里保持不激活而不是抛错（R-12）。 */
export const inject = ["webServer"];

export function apply(ctx, config) {
  const cfg = { ...defaults, ...(config ?? {}) };
  const audit = createAudit(ctx, cfg);
  const service = createService(ctx, cfg, audit);
  const base = "/api-ext/session-cleaner";

  // 所有注册都用 ctx.effect 包住并返回清理（R-11）
  const dispose = ctx.effect(() => {
    const routes = [
      {
        path: base + "/delete",
        handler: async (req, res) => {
          const origin = checkOrigin(req);
          if (!origin.ok) {
            return fail(res, "cross-origin", "请求来源不可信", `origin=${origin.origin} site=${origin.site}`);
          }
          if (req.method !== "POST") return fail(res, "method-not-allowed", "该端点只接受 POST");

          let payload;
          try {
            payload = await readJsonBody(req, { limit: cfg.maxBodyBytes, timeoutMs: cfg.readTimeoutMs });
          } catch (error) {
            return fail(res, "bad-request", String(error?.message ?? error));
          }

          const result = await service.deleteSession(payload?.sessionId, { kind: "http", origin: origin.origin });
          if (!result.ok) return fail(res, result.error.code, result.error.message, result.error.hint);
          return sendJson(res, 200, result);
        },
      },
      {
        path: base + "/status",
        handler: (req, res) => {
          if (req.method !== "GET") return fail(res, "method-not-allowed", "该端点只接受 GET");
          return sendJson(res, 200, {
            ok: true,
            value: {
              plugin: { name, version: "1.0.0" },
              capabilities: {
                detachLive: typeof ctx.sessions?.store?.get === "function",
                detachWorkspaces: typeof ctx.workspaceRegistry?.list === "function",
                removeArtifacts: true,
              },
              config: cfg,
            },
          });
        },
      },
    ];

    const disposers = [];
    for (const route of routes) {
      // 【待核实】webServer.register 的确切选项形状（见 §C.10）；此处按上游用法书写。
      const d = ctx.webServer.register({ kind: "exact", path: route.path, handler: route.handler });
      if (typeof d === "function") disposers.push(d);
    }
    return () => { for (const d of disposers) d(); };
  }, "session-cleaner-clone: routes");

  ctx.logger?.debug?.("session-cleaner-clone: applied");
  return dispose;
}

const defaults = {
  maxBodyBytes: 65536,
  readTimeoutMs: 10000,
  confirmInUi: true,
  audit: true,
  auditPath: null,
  rateLimitPerMinute: 10,
};

// 内部实现导出给单测（与上游同样的做法）
export { removeArtifacts, isValidSessionId, isInside, sessionsRoot, detachLiveStore, detachWorkspaces, stopIdleAgent };
``````````

---

## C.9 client.js —— 行 ⋮ 菜单项（slot 注册，**不碰 DOM**）

```````````js
// dsh-session-cleaner-clone 客户端半。
// 注册到官方声明的 slot：sidebar.workspaces.session.menu.item
//   （声明见官方 dsh-client-ui-workspace；本手册 §1.10 有完整证据）
// 禁止：MutationObserver 监听 document.body、appendChild 到宿主菜单、读宿主 DOM 推 id。
window.__ModuleLoader__.load({
  id: "dsh-session-cleaner-clone",       // 必须等于包名（R-1.10 / R-3.15）
  factory(require) {
    const React = require("react");
    // Module Loader lane 下 ui-primitives 是隐式基线 external：
    // 经 loader 的 require 解析，**不要**列为运行时依赖、也不要另打一份。
    const { MenuItemButton } = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "sessionCleanerClone";
    const SLOT = "sidebar.workspaces.session.menu.item";

    // 行身份由 slot props 直接给出（sessionId / displayTitle）——
    // 不需要按标题反查，也就没有「同名歧义」问题。
    function DeleteRow({ sessionId, displayTitle, useMenuOpenState, t, requestDelete }) {
      const [, setMenuOpen] = useMenuOpenState();
      return React.createElement(
        MenuItemButton,
        {
          separatorBefore: true,
          onSelect: () => {
            setMenuOpen(false);
            requestDelete(sessionId, displayTitle);
          },
        },
        t("action.delete"),
      );
    }

    const inject = ["slots", "locale"];

    function apply(ctx) {
      // 语言包：内置两个 locale 都要给（R-5.2），用 effect 注册（R-5.6）
      ctx.effect(
        () => ctx.locale.register(NS, {
          zh: { "action.delete": "删除此会话" },
          en: { "action.delete": "Delete session" },
        }),
        "session-cleaner-clone: locale",
      );

      // 行 ⋮ 菜单项。order 决定位置（官方 archive = 400，取 500 排其后）。
      // ctx.slots.inject 在 owner 通常在场时也是必须的（R-3.4 / R-3.5）。
      ctx.effect(
        () => ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          id: "session-cleaner-clone.delete",
          order: 500,
          locale: NS,
          inject: () => ({ requestDelete }),
        }, DeleteRow)),
        "session-cleaner-clone: menu item",
      );
    }

    /**
     * 打开确认对话框（自己写控件，不用 window.confirm —— 它阻塞、不可主题化、不可国际化）。
     * 【待核实】官方 overlay 的注册方式（shell.overlay）；此处只保留意图，实现待补。
     */
    function requestDelete(sessionId, displayTitle) {
      // TODO(实现): 渲染一个主题化确认 Modal，文案含会话标题与「不可恢复」，
      //             确认后 POST /api-ext/session-cleaner/delete，成功则刷新列表，
      //             失败则用 role="alert" 原样展示 error.message / hint。
      void sessionId; void displayTitle;
    }

    return { apply, inject };
  },
});
```````````

对应规范：R-3.1 / R-3.2 / R-3.4 / R-3.5 / R-3.7 / R-3.8 / R-3.10 / R-3.11 / R-5.1 / R-5.2 / R-5.6。

> **与上游 client.js 的对照**：上游 247 行里约 160 行在解决「菜单归属 + 标题反查 id」，
> 插槽方案下这些全部消失。文件从 9017 B 降到约 3 KB。

---

## C.10 test/ —— 必写单测（上游一个都没有）

````````````js
// test/session-id.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidSessionId, isInside } from "../lib/artifacts.js";

test("合法 sessionId", () => {
  for (const id of ["session-1bb8d361-ea6b-4b92-bab2-c858c92e8822", "abc", "0", "a".repeat(128)]) {
    assert.equal(isValidSessionId(id), true, id);
  }
});

test("非法 sessionId（路径穿越 / 越界 / 空 / 超长）", () => {
  for (const id of ["", "-a", "../etc/passwd", "a/b", "a.b", "a\\b", "a".repeat(129), null, 1, {}]) {
    assert.equal(isValidSessionId(id), false, String(id));
  }
});

test("isInside 挡住越界", () => {
  const root = "C:\\tmp\\sessions";
  assert.equal(isInside(root, "C:\\tmp\\sessions\\p\\s1"), true);
  assert.equal(isInside(root, "C:\\tmp\\sessionsX\\p"), false);
  assert.equal(isInside(root, "C:\\tmp\\other"), false);
  assert.equal(isInside(root, "C:\\tmp\\sessions\\..\\evil"), false);
});
````````````

`````````````js
// test/artifacts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeArtifacts } from "../lib/artifacts.js";

test("只删目标会话目录，别的不动；根缺失返回 0", async () => {
  const root = await mkdtemp(join(tmpdir(), "scc-"));
  try {
    await mkdir(join(root, "projA", "s1"), { recursive: true });
    await mkdir(join(root, "projA", "s2"), { recursive: true });
    await mkdir(join(root, "projB", "s1"), { recursive: true });
    await writeFile(join(root, "projA", "s1", "log.jsonl"), "x");

    const r = await removeArtifacts("s1", root);
    assert.equal(r.count, 2);
    assert.equal(r.paths.length, 2);
    assert.deepEqual((await readdir(join(root, "projA"))).sort(), ["s2"]);
    assert.deepEqual(await readdir(join(root, "projB")), []);

    const missing = await removeArtifacts("s1", join(root, "nope"));
    assert.equal(missing.count, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
`````````````

``````````````js
// test/service.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { detachLiveStore, detachWorkspaces, stopIdleAgent } from "../lib/service.js";

test("detachLiveStore：优先用服务方法；都没有时返回 false（不抛错，优雅降级）", () => {
  let viaService = 0;
  assert.equal(detachLiveStore({ detach: () => { viaService++; } }, "s1"), true);
  assert.equal(viaService, 1);
  assert.equal(detachLiveStore({ store: new Map() }, "s1"), false);
  assert.equal(detachLiveStore({}, "s1"), false);
  assert.equal(detachLiveStore(undefined, "s1"), false);
});

test("detachLiveStore：有 detach 时调用并返回 true", () => {
  let called = 0;
  const store = new Map([["s1", { detach: () => { called++; } }]]);
  assert.equal(detachLiveStore({ store }, "s1"), true);
  assert.equal(called, 1);
});

test("detachWorkspaces：**不得**在 detachSession 缺失时虚增计数（修正上游 D7）", async () => {
  const registry = { list: () => [{ sessionIds: ["s1"] }] }; // 没有 detachSession
  assert.equal(await detachWorkspaces(registry, "s1"), 0);
});

test("detachWorkspaces：真正调用成功才计数", async () => {
  let called = 0;
  const registry = { list: () => [{ sessionIds: ["s1"], detachSession: async () => { called++; } }] };
  assert.equal(await detachWorkspaces(registry, "s1"), 1);
  assert.equal(called, 1);
});

test("stopIdleAgent：没有公开停止法时如实返回 false，不碰内部 _unload", async () => {
  assert.equal(await stopIdleAgent({}, {}), false);
  assert.equal(await stopIdleAgent({ ctx: { fiber: { _unload() {} } } }, {}), false);
});
``````````````

---

## C.11 合规对照表

| 规范 | 骨架中的落地位置 |
|---|---|
| R-1.1 `dsh.bundle.patch` | §C.2 + §C.3 |
| R-1.3 `locale/*.json` + `icon` | §C.2 `exports`/`files`（locale 目录） |
| R-1.6 `exports` 放开 `package.json`/`locale` | §C.2 |
| R-1.7 无构建链 | §C.2（无 build 脚本） |
| R-1.8 `dsh.client` + `./client` | §C.2 + §C.9 |
| R-2.x 只导出一种形态 | §C.8（`apply` + `inject` + `Config`，无 service class） |
| R-2.x 资源用 `ctx.effect` | §C.8（`ctx.effect(... "routes")`） |
| R-3.1 slot 内 React 组件 | §C.9 |
| R-3.2 不写宿主 DOM / 不 append body | §C.9（无 `document.*`） |
| R-3.4 / R-3.5 `ctx.slots.inject` | §C.9 |
| R-3.6 不 require Harness Client 包 | §C.9（仅经 loader require 基线 external `ui-primitives`） |
| R-3.8 factory 无副作用 | §C.9（factory 只定义函数与 apply） |
| R-5.1 / R-5.2 文案走 locale | §C.9（`ctx.locale.register(NS, { zh, en })`） |
| R-5.6 语言包作为 owned effects | §C.9（`ctx.effect` 包裹） |
| R-13 可调值进 Config | §C.4 |
| R-50 一个操作只实现一次 | §C.6（`service.deleteSession` 唯一实现） |
| 契约 §5.1 同源五步 | §C.7 `checkOrigin` |
| 契约 §5.2 语义化状态码 | §C.7 `STATUS` |
| 契约 §5.3 响应信封 | §C.6 + §C.7 |
| §7.3 路径安全 | §C.5 `isInside` |
| §7.4 幂等 | §C.6 `inFlight` |
| §8.3 单测清单 | §C.10 |

---

## C.12 待核实登记（**不要当成已验证**）

| # | 事项 | 现状 | 怎么核实 |
|---|---|---|---|
| A | `@deepseek-ai/dsh-client-runtime` 是否官方包 | 在 asar 12967 条清单中 **0 命中**（上游 package.json 却声明了它） | `cordis_inspect_query` 查包；不存在就删该条目 |
| B | `dsh.client.inject` 写不存在的包是硬失败还是仅排序提示 | 官方原文只到「only order activation and stay allowed」 | 实测安装一次看 `application`/`warnings` |
| C | `--dsw-alias-danger` / `--dsw-alias-interactive-bg-hover` / `--dsw-alias-hairline` 是否真实令牌 | 本次抽取物中**无确证**（能确证的是 `--dsw-alias-label-*`、`--dsw-alias-brand-primary` 等） | `cordis_inspect_query` `Theme` 取全表 |
| D | ~~`sessions.store.get(id).detach()` 是否公开面~~ **已判定：内部实现** | `store` 是 `SessionStore` 实例字段（未文档化）；`entry.detach` 绕过 `enter()` 返回闭包的延迟语义 | 仍需 `cordis_inspect_query` `Service` 查 `sessions` 是否有公开 detach 方法 |
| E | ~~`Workspace.detachSession()` 是否公开面~~ **已判定：半公开** | 类型层导出（`dsh-workspace/lib/types/entity.js:109`）+ 官方 `dsh-webhook` 在用（`lib/index.js:201`），但 README 无记载 | 可直接用；若宿主升级后消失，按 `refused`/降级处理 |
| F | ~~官方提供的停止空闲 agent 的公开入口~~ **已判定：`fiber.dispose()`** | 上游用的 `_unload()` 在 Cordis 里是 `private`（`src/fiber.ts:675`）；公开替代 `public readonly dispose`（`:195-196`） | 附录已改用 `fiber.dispose()`；仍需运行时确认它**确实**拆掉 agent |
| G | `sidebar.workspaces.session.menu.item` 的**完整 props 表** | 官方 README 明写 `sessionId`/`displayTitle`/`useMenuOpenState`；渲染点 `lib/client.js:1661` 传 `{ sessionId: node.id, displayTitle: row.title }` + `hookContext: menuOpenState`；**是否含 `running` 未明说** | `cordis_inspect_query` `Slots` 查该 slot 的 registration options 与 props |
| H | 主题化确认 Modal 的官方注册方式（`shell.overlay`） | 只知存在，形状未取证 | `Slots.listSubTree` 找 `shell.overlay` 并读其 props |
| I | `webServer.register` 的完整选项与返回 disposer | 上游用法：`{ kind:"exact", path, handler }`，未用返回值 | `cordis_inspect_query` `Service` 查 `webServer` |

> **纪律**：以上九项**任一未核实前，不得把对应代码当作「已验证可用」交付**。
> 验证完成后，请把结论回填到本表并升级主手册的【待核实】标记。
