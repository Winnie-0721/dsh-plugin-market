# 团队共享简报：DSH 插件市场重建（v1.0）

> 本文件是**事实来源**，不是建议。里面的 API 签名、路径、命令都经过实测。有疑问先读本文件与
> `docs/API-CONTRACT.md`，两者冲突时以 `docs/API-CONTRACT.md` 为准并向 Lead 报告。

## 1. 我们要交付什么

一份**可安装、可运行**的 DSH 插件市场（参考 dsh-market，但按官方插件规范重新实现），
包名 `deepseek-harness-market`，host + web client 双半，**入口放在侧边栏底部**（`sidebar.footer.action`，
截图里蓝色圈注的空白带，位于账号行 `epsilon-delta` 上方）。

参考代码（只读，不要改）：
- dsh-market 原版：`E:\Code\dsh-plugin-market\_ref\dsh-market`
- DeepSeek Harness 官方源码：~~`E:\Code\dsh-plugin-market\_ref\deepseek-harness`~~
  —— **已于 2026-10-07 工作区清理时删除（省 152MB）**。需要翻官方实现时按需重新克隆，
  不要再假设该路径存在。
- 一个已安装、可运行的第三方插件范例（host+client 双半、纯 JS）：
  `C:\Users\28062\.dsh\profiles\desktop\node_modules\@feiyang666\dsh-usage-plugin\`
  （`lib/index.js` = host，`lib/client.js` = client bundle，`cordis.patch.yml` = bundle 补丁层）
- 目录数据源快照：`E:\Code\dsh-plugin-market\_ref\data\plugins.json`（4412 条）

## 2. 本机环境（已实测）

| 项 | 值 |
|---|---|
| DSH 版本 | `0.2.0-rc.2` |
| dsh CLI | `D:\Software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd --version` |
| Node（宿主自带） | `C:\Users\28062\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| DSH_HOME | `C:\Users\28062\.dsh` |
| 当前 profile | `desktop` → `C:\Users\28062\.dsh\profiles\desktop` |
| 正在运行的 GUI | `http://127.0.0.1:19387`（**需要 token，不要直接 curl 首页**） |
| 工作目录 | `E:\Code\dsh-plugin-market`（2026-10-05 自 `E:\AI\DeepSeek Harness\Dsh` 迁入，按 E:\Code 下「目录名 = GitHub 仓库名」的惯例放置） |
| 网络 | GitHub / npmjs / npmmirror 可访问；**awesome-dsh-plugin.com 直连 25–93s 或超时**（DSH 只认 `HTTP(S)_PROXY` 环境变量，不读 Windows 系统代理），所以目录源以 npm 镜像优先，见 `docs/API-CONTRACT.md` §3 |

宿主读取插件的方式：profile `package.json` 的 `dsh.profile.bundles` 列出 bundle 名，
每个 bundle 包用自己的 `cordis.patch.yml` 往 Loader 里 insert 一行；行 `name` 从 profile 的
`node_modules` 解析。装插件用 `dsh plugin --profile <name> add <spec>`。

**客户端 bundle 契约**（官方 `dsh.client` 扫描 + `/plugins/??<pkg>/client.js&rev=…` 路由）：

```js
window.__ModuleLoader__.load({
  id: "<package name>",                       // 必须等于包名
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    var React = require("react");             // 平台种子模块，唯一可 require 的裸模块
    exports.inject = ["slots", "layout", "locale"];   // Cordis 服务名
    exports.apply = function (ctx) { /* … */ };
    return module.exports;                    // 顶层不要 default export
  }
});
```

`package.json` 必须有：
```json
"exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-sidebar", "@deepseek-ai/dsh-client-ui-layout"] }
}
```
（`dsh.client.inject` 只是信息性依赖边；真正排序靠 Cordis 服务注入。）

## 3. 已确认的宿主 / 客户端 API（不要凭记忆改签名）

### host 服务（`cordis_inspect_query` 实测，平台 host）

`ctx.webServer.register(route)` → disposer
```ts
interface WebRoute { kind: 'exact' | 'prefix'; path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }
```
原生 Node http 的 `IncomingMessage` / `ServerResponse`：自己 `writeHead` + `end`。
`(kind, path)` 重复注册会 **throw**。

`ctx.get('pluginManager')`（可选服务，用 `ctx.get` 而不是 `ctx.pluginManager`）：
```ts
listBundles(): Promise<BundleInfo[]>            // @Remote
listPlugins(): Promise<PluginInfo[]>            // @Remote
installBundle(spec: string, options?: { enabled?: boolean; requestId?: string;
  approvedBuilds?: string[]; registry?: string | null }): Promise<ChangeResult>   // @Remote
removeBundle(name: string): Promise<ChangeResult>          // @Remote
setBundleEnabled(name: string, enabled: boolean): Promise<ChangeResult>   // @Remote
setPluginEnabled(id: string, enabled: boolean): Promise<ChangeResult>     // @Remote
registries(): Promise<PluginRegistries>
```
`ChangeResult`：`{ changed, application: 'applied'|'restart-required'|'overridden'|'failed'|'cancelled',
  stage: 'install'|'enable'|'remove', target, enabled?, error?: ManagementError, warnings?: string[],
  packageResult?: { exitCode, output, truncated, logPath, kind? }, pendingBuilds?: string[],
  approvedBuilds?: string[], bundle?: string }`
`ManagementError`：`{ code: ReadOnlyReason | 'unknown-plugin' | 'invalid-spec' | 'ambiguous-install'
  | 'not-bundle' | 'not-removable' | 'stop-profile' | 'bundle-in-use' | 'stale-approval'
  | 'incompatible-version' | 'operation-error', diagnostic?, incompatible? }`
`ReadOnlyReason` = `'management-required' | 'unaddressable'`。
`BundleInfo`：`{ name, version?, description?, enabled, installed, optional, removable,
  readOnlyReason?, error?, rows: [{ rowId, moduleName, entryId? }], overrides: string[] , meta? }`。
`PluginInfo`：`{ entryId, moduleName, enabled, fiberPhase: 'pending'|'loading'|'active'|'failed'|'unloading'|null, meta?, patchId? }`。

### client 服务（`cordis_inspect_query` 实测，平台 client，动态半可用）

```ts
ctx.get('slots').inject(key, () => ctx.get('slots').register(options, Component)): () => void
ctx.get('layout').selectPanel(panelId: string | null): void   // 未注册的 key 会 throw
ctx.get('locale').getLocale(): { active: string, ... }        // active 为 'zh' / 'en'
ctx.get('locale').subscribe(fn): () => void
ctx.get('timer').debounce(fn, ms) / .timeout / .interval
```
`main`：keyed slot，registration 只有 `{ key }`，**已占用 `plugins`、`conversation`**；
`sidebar.footer.action`：list slot，registration `{ id, order?, label? }`，owner props `{ wide: boolean }`，
标准 props 含 `usePanelInfo: (selector) => value`、`useResource`、`useSessions`。
`sidebar.footer.action` 由 ui-sidebar 声明，渲染在 Settings/账号行**上方**——正是蓝色圈注区域。

### 主题 token（`cordis_inspect_query` Theme 实测，全部要求明暗双值）

`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay`、
`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、
`--dsw-alias-label-secondary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-success-primary`、
`--dsw-alias-state-warn-primary`、`--dsw-alias-state-idle-primary`、`--dsw-specific-sidebar-fill`。

## 4. 界面设计规范（来自官方 web-styling / dsh-client-ui-ux，简化到第三方插件可执行的程度）

1. **文案**：中文优先，zh/en 双语，跟随宿主语言；不写死语言。按钮 2–4 字，正文一句 ≤20 字。
2. **报错三件事**：发生了什么、为什么、现在怎么办。禁止「操作失败」这类没有出路的提示。
3. **常态安静，罕见才打扰**：加载中、空结果、可忽略警告都用中性陈述，不用红色。
4. **每个动作都要有即时反馈**：按钮进入进行中态、完成后刷新并提示结果。
5. **空/错/加载/窄屏/长文本/深浅色都要设计**，不是边界情况。
6. 颜色只用 §3 的 CSS 变量并带兜底值；不引组件库、不引 Tailwind。

## 5. 团队纪律

- 只写自己任务里声明的文件；改契约先找 Lead。
- 不修改 `_ref/`（只读参考）、不修改正在运行的 desktop profile（除 Lead 的安装步骤）。
- 代码用中文注释说明「为什么」，不要复述代码。
- 交付前自测：host 半用 `node --check` 过语法；client 半同样，且 `node -e` 能加载 `__ModuleLoader__` 桩。
- 完成后把「改了什么、怎么验证的、遗留什么」写回共享任务，再 complete。
