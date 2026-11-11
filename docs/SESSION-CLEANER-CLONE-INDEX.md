# 会话清理插件复刻 —— 总目录与导航

> **关于本文引用的 `_research/`**：那三份证据文档（`EVIDENCE-A/B.md`、`NOTES.md`）
> 与 `asar-filelist.txt` 在 `.gitignore` 里被显式忽略（见 `.gitignore` 第 21 行 `_research/`），
> **不进仓库**。本文保留完整引用是为了让当时的推理链可追溯；正文里对上游行为的结论
> 已经写在各自段落中，不依赖那些文件也能读懂。若需要原始证据，得重新从 `app.asar` 提取
> （提取脚本同样是本地文件，未入库）。

> 这份文件是**导航**，不是内容。目的：让你在**新会话**里用最少的上下文找到该读的那一节，然后直接开工。
> 全篇路径相对仓库根 `E:\Code\dsh-plugin-market`。

---

## 0. 一分钟速览：我现在该看哪个文件

| 我想…… | 打开 | 规模 |
|---|---|---|
| 知道**上游到底做了什么**（含逐行行为、文档与代码的不一致） | [EVIDENCE-A](_research/EVIDENCE-A.md) | 983 行 |
| 知道**DSH 官方要求怎么写**（R 编号 + 英文原句引证） | [EVIDENCE-B](_research/EVIDENCE-B.md) | 390 行 |
| **照着做**：设计、骨架、契约、视觉、安全、验收、发布 | [复刻手册](docs/SESSION-CLEANER-CLONE-GUIDE.md) | 1856 行 / 10 章 |
| **复制代码**：host 半 + slot 客户端半 + 单测 | [附录 C](docs/SESSION-CLEANER-CLONE-APPENDIX.md) | 778 行 |
| 看**上游原始发布物**（未改动） | [`_tmp-scc/package/`](_tmp-scc/package) | 7 文件 |
| 看**DSH 官方原始文档**（从 app.asar 抽取） | [`_research/dsh/`](_research/dsh) | 121 文件 |
| 看**整个 asar 的路径清单**（查某包是否存在） | [`_research/asar-filelist.txt`](_research/asar-filelist.txt) | 12967 条 |

---

## 1. 主手册完整目录

文件：[docs/SESSION-CLEANER-CLONE-GUIDE.md](docs/SESSION-CLEANER-CLONE-GUIDE.md)

### 前置：怎么读、信到什么程度

| 节 | 内容 | 行 |
|---|---|---|
| §0.1 | **证据等级标记**（【实证】/【官方】/【推断】/【待核实】）——先读这个 | [:18](docs/SESSION-CLEANER-CLONE-GUIDE.md#L18) |
| §0.2 | 取证环境：为什么本手册的证据来自 npm tarball + app.asar 而**不是** GitHub | [:29](docs/SESSION-CLEANER-CLONE-GUIDE.md#L29) |
| §0.3 | **上游身份不一致**（byJming vs fountunt）——动手前必须确认 | [:62](docs/SESSION-CLEANER-CLONE-GUIDE.md#L62) |
| §0.4 | 手册结构 | [:81](docs/SESSION-CLEANER-CLONE-GUIDE.md#L81) |

### 第 1 章 上游解剖

| 节 | 内容 | 行 |
|---|---|---|
| §1.1 | 它解决什么问题（幽灵行 / 三处同删） | [:103](docs/SESSION-CLEANER-CLONE-GUIDE.md#L103) |
| §1.2 | 交付物清单（7 文件，含字节数） | [:138](docs/SESSION-CLEANER-CLONE-GUIDE.md#L138) |
| §1.3 | `package.json` 逐字段解读 | [:154](docs/SESSION-CLEANER-CLONE-GUIDE.md#L154) |
| §1.4 | `cordis.patch.yml` 语义 | [:209](docs/SESSION-CLEANER-CLONE-GUIDE.md#L209) |
| §1.5 | **Host 半 HTTP 契约**（导出面 / 请求响应 / 错误码 / 校验 / 四步删除 / 空闲 agent） | [:230](docs/SESSION-CLEANER-CLONE-GUIDE.md#L230) |
| §1.5.5 | **删除事务四步 + 每步失败语义**（核心） | [:307](docs/SESSION-CLEANER-CLONE-GUIDE.md#L307) |
| §1.5.6 | 三处 API 公开性判定（`_unload()` / `store` / `detachSession`） | [:339](docs/SESSION-CLEANER-CLONE-GUIDE.md#L339) |
| §1.6 | **Client 半 DOM 增强算法**（MutationObserver / 时间窗 / 几何窗 / 标题反查） | [:373](docs/SESSION-CLEANER-CLONE-GUIDE.md#L373) |
| §1.7 | 语言处理（注册了 locale 却绕开它） | [:544](docs/SESSION-CLEANER-CLONE-GUIDE.md#L544) |
| §1.8 | **上游自述 vs 代码实际 偏差清单 D1–D20** | [:569](docs/SESSION-CLEANER-CLONE-GUIDE.md#L569) |
| §1.9 | 可复刻性缺口汇总（TODO 清单） | [:596](docs/SESSION-CLEANER-CLONE-GUIDE.md#L596) |
| **§1.10** | ⭐ **关键更正：会话行菜单「有」公开 slot——上游前提已过期** | [:611](docs/SESSION-CLEANER-CLONE-GUIDE.md#L611) |

### 第 2 章 代码规范（DSH 官方）

| 组 | 主题 | 行 |
|---|---|---|
| §2.1 A 组 | 包与清单（R-01 ~ R-07） | [:725](docs/SESSION-CLEANER-CLONE-GUIDE.md#L725) |
| §2.1 B 组 | Host 半（R-10 ~ R-19） | [:743](docs/SESSION-CLEANER-CLONE-GUIDE.md#L743) |
| **§2.1 C 组** | ⭐ **Client / UI 硬规范（R-20 ~ R-29）——本手册最重要的一组** | [:771](docs/SESSION-CLEANER-CLONE-GUIDE.md#L771) |
| §2.1 D 组 | 扩展点由弱到强（R-30） | [:801](docs/SESSION-CLEANER-CLONE-GUIDE.md#L801) |
| §2.1 E 组 | 验证与验收（R-40 ~ R-45） | [:806](docs/SESSION-CLEANER-CLONE-GUIDE.md#L806) |
| §2.1 F 组 | 操作与用户动作（R-50 ~ R-52） | [:826](docs/SESSION-CLEANER-CLONE-GUIDE.md#L826) |
| §2.2 | 上游对规范的偏离清单（逐条对照） | [:839](docs/SESSION-CLEANER-CLONE-GUIDE.md#L839) |
| §2.3 | 本仓库 `plugin-market` 的示范价值 | [:858](docs/SESSION-CLEANER-CLONE-GUIDE.md#L858) |

### 第 3 章 复刻设计

| 节 | 内容 | 行 |
|---|---|---|
| §3.1 | 三条红线（能力等价 / 形态合规 / 诚实） | [:877](docs/SESSION-CLEANER-CLONE-GUIDE.md#L877) |
| §3.2 | **功能映射表**：上游做法 → 复刻做法 → 为什么变 | [:885](docs/SESSION-CLEANER-CLONE-GUIDE.md#L885) |
| **§3.3** | ⭐ **UI 形态：方案 A（行 ⋮ 菜单 slot）/ B（底部入口面板）/ C / 反面 D** | [:901](docs/SESSION-CLEANER-CLONE-GUIDE.md#L901) |
| §3.4 | 服务端分层 + 删除事务 + 幂等锁 | [:1015](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1015) |

### 第 4 章 工程骨架

| 节 | 内容 | 行 |
|---|---|---|
| §4.1 | 目录结构 | [:1062](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1062) |
| §4.2 | `package.json`（可直接用） | [:1094](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1094) |
| §4.3 | `cordis.patch.yml` | [:1153](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1153) |
| §4.4 | 装配与安装（`plugin_manager install_bundle` + 读 `application`） | [:1171](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1171) |

### 第 5 章 接口契约（冻结版）

| 节 | 内容 | 行 |
|---|---|---|
| §5.0 | 标识（包名 / bundle id / 行 id / 路由前缀） | [:1198](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1198) |
| §5.1 | 通用约定（信封 / 状态码 / 同源五步 / 64 KiB / 10 s） | [:1212](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1212) |
| §5.2 | 错误码清单（8 个 code + HTTP 映射） | [:1236](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1236) |
| §5.3 | 路由：`/delete` / `/list` / `/status` | [:1252](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1252) |
| §5.4 | 取舍说明：全 200 还是语义化状态码 | [:1347](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1347) |
| §5.5 | 幂等与并发 | [:1358](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1358) |

### 第 6–10 章

| 章 | 内容 | 行 |
|---|---|---|
| 第 6 章 | 视觉与交互（令牌 / 状态全覆盖 / 确认框 / locale / 明暗） | [:1366](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1366) |
| 第 7 章 | 安全与风险（红线 S1–S7 / 上游缺口 / 路径安全 / 幂等 / 审计 / 失败模式） | [:1449](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1449) |
| 第 8 章 | 验收与测试（官方口径 / 四层矩阵 / 必写单测 / 手工验收表 w/ 14 步 / 诚实报告模板） | [:1550](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1550) |
| 第 9 章 | 打包发布（检查单 / 版本策略 / 共存 / **asar 复核脚本**） | [:1659](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1659) |
| 第 10 章 | 差异对照表（能力 / 契约兼容 / 照抄什么 / 反着做什么） | [:1759](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1759) |
| 收尾 | **最短路径**（一天的排期） | [:1831](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1831) |

---

## 2. 附录 C 完整目录（可复制代码）

文件：[docs/SESSION-CLEANER-CLONE-APPENDIX.md](docs/SESSION-CLEANER-CLONE-APPENDIX.md)

| 节 | 内容 | 行 |
|---|---|---|
| C.1 | 目录树 | [:11](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L11) |
| C.2 | `package.json` | [:40](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L40) |
| C.3 | `cordis.patch.yml` | [:90](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L90) |
| C.4 | `lib/config.js` —— Config schema | [:108](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L108) |
| C.5 | `lib/artifacts.js` —— 磁盘删除 + 路径包含校验 | [:141](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L141) |
| C.6 | `lib/service.js` —— 唯一能力实现（幂等 / 计数修正 / agent 守卫） | [:202](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L202) |
| C.7 | `lib/http.js` —— 同源 + 读写体 + 状态码 | [:369](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L369) |
| C.8 | `lib/index.js` —— 入口 `apply(ctx, config)` | [:454](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L454) |
| C.9 | `client.js` —— 行 ⋮ 菜单 slot 注册（**不碰 DOM**） | [:547](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L547) |
| C.10 | `test/` —— 必写单测 | [:631](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L631) |
| C.11 | **合规对照表**（规范 ↔ 代码位置） | [:733](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L733) |
| **C.12** | ⭐ **待核实登记 A–I**（动手前先清这个） | [:762](docs/SESSION-CLEANER-CLONE-APPENDIX.md#L762) |

> 附录 C 的 9 个 JS 代码块**已全部通过 `node --check`**（本会话验证）。

---

## 3. 按任务找入口

### 3.1 「我要动手写代码」

```text
附录 C.2  package.json
附录 C.3  cordis.patch.yml
附录 C.4  lib/config.js
附录 C.5  lib/artifacts.js      <- 路径安全，先写这个
附录 C.6  lib/service.js        <- 核心能力，唯一实现
附录 C.7  lib/http.js           <- 契约层
附录 C.8  lib/index.js          <- 入口
附录 C.9  client.js             <- slot 客户端半
附录 C.10 test/                 <- 单测
```

### 3.2 「我不确定 UI 挂哪」

1. 读主手册 [§1.10](docs/SESSION-CLEANER-CLONE-GUIDE.md#L611)（公开 slot 的完整证据）
2. 读主手册 [§3.3](docs/SESSION-CLEANER-CLONE-GUIDE.md#L901)（方案 A/B/C/D 的选择）
3. 抄附录 C.9 的注册范式

### 3.3 「我要证明它能用」

参考文献：[§8.2 四层矩阵](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1562) → [§8.3 单测清单](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1575) → [§8.5 手工验收表](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1620)（第 11 步是识别真假实现的关键）→ [§8.6 诚实报告模板](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1641)

### 3.4 「我怀疑某个 API 不存在」

先查 [`_research/asar-filelist.txt`](_research/asar-filelist.txt)（12967 条路径，确认包是否存在），再查 [EVIDENCE-A §3.10](_research/EVIDENCE-A.md#L357)（三处 API 公开性判定），最后用 `cordis_inspect_query` 现场验证。

### 3.5 「用户问我和上游有什么不同」

主手册 [第 10 章差异对照表](docs/SESSION-CLEANER-CLONE-GUIDE.md#L1759)

---

## 4. 事实权威表（哪条事实去哪查）

| 事实 | 权威来源 | 行 |
|---|---|---|
| 上游 `package.json` 每个字段 | [EVIDENCE-A §1](_research/EVIDENCE-A.md#L47) | :47 |
| 上游 `cordis.patch.yml` 语义 | [EVIDENCE-A §2](_research/EVIDENCE-A.md#L151) | :151 |
| 上游 Host 半逐行行为 | [EVIDENCE-A §3](_research/EVIDENCE-A.md#L210) | :210 |
| 上游 Client 半 DOM 算法 | [EVIDENCE-A §4](_research/EVIDENCE-A.md#L449) | :449 |
| **上游文档 vs 代码的 15 条不自洽** | [EVIDENCE-A §5](_research/EVIDENCE-A.md#L743) | :743 |
| 上游身份（fountunt）原文 | [EVIDENCE-A §6](_research/EVIDENCE-A.md#L896) | :896 |
| **上游 20 条可复刻性缺口** | [EVIDENCE-A §7](_research/EVIDENCE-A.md#L928) | :928 |
| 官方规范的 **134 条 R 编号** | [EVIDENCE-B §1–§8](_research/EVIDENCE-B.md#L42) | :42 |
| 官方规范速查 15 条 | [EVIDENCE-B §11](_research/EVIDENCE-B.md#L363) | :363 |
| **手动核对授权（真实 slot 名）** | [dsh-client-ui-workspace/README.md:98](_research/dsh/ref/dsh-client-ui-workspace/README.md#L98) | :98 |
| slot 声明与渲染点 | [lib/client.js:4306](_research/dsh/ref/dsh-client-ui-workspace/lib/client.js#L4306) / [:1661](_research/dsh/ref/dsh-client-ui-workspace/lib/client.js#L1661) | — |
| `sidebar.footer.action` 声明 | [dsh-client-ui-sidebar/lib/client.js:515](_research/dsh/ref/dsh-client-ui-sidebar/lib/client.js#L515) | :515 |
| 「无同源策略」官方原文 | [dsh-host-webserver/README.md:113](_research/dsh/ref/dsh-host-webserver/README.md#L113) | :113 |
| slot 声明纪律 | [dsh-client-ui-slots/README.md:46](_research/dsh/ref/dsh-client-ui-slots/README.md#L46) | :46 |
| 官方插件开发全流程 | [cordis-plugin-development/SKILL.md](_research/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md) | — |
| UI 插件规范 | [references/ui-plugin.md](_research/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/ui-plugin.md) | — |
| 实践/性能/UI 硬规范 | [references/practices.md](_research/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/practices.md) | — |
| 清单与显示元数据 | [references/host-plugin.md](_research/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md) | — |
| 无浏览器时的验证边界 | [references/verification.md](_research/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/verification.md) | — |

---

## 5. 新会话开工：把下面这段直接粘进去

````text
读 docs/SESSION-CLEANER-CLONE-INDEX.md 定位，然后按 docs/SESSION-CLEANER-CLONE-APPENDIX.md
实现 dsh-session-cleaner-clone 插件（DeepSeek Harness Web 插件，host 半 + 客户端半同包）。

工作目录：E:\Code\dsh-plugin-market
新建包目录：E:\Code\dsh-plugin-market\dsh-session-cleaner-clone\（不要改 plugin-market/ 与 verify/）

必须遵守：
1. 先读主手册 §0.1 证据等级标记与附录 C.12 待核实登记。
2. UI 必须注册到 slot sidebar.workspaces.session.menu.item（证据见主手册 §1.10）；
   禁止 MutationObserver、禁止 appendChild 到宿主 DOM、禁止 require 任何 @deepseek-ai/dsh-client-* 包
   （MenuButton 之类经 loader 的 require 解析 ui-primitives 属于隐式基线 external，可以）。
3. Host 半只导出 apply(ctx, config) + inject + Config，不得混用 service class。
4. 所有注册用 ctx.effect 包裹并返回清理函数。
5. 响应信封 {ok:true,value} / {ok:false,error:{code,message,hint?}}，但 HTTP 状态码要写对。
6. 删除不可逆：必须有同源校验、req.method 校验、64 KiB 上限、10 s 读超时、
   并发单飞、审计留痕、路径包含校验（isInside）。
7. 正在运行的会话必须拒（code: refused / 409）。

交付前必须做：
- node --check 每个 JS 文件
- node --test test/ 全绿
- 如果你能用 cordis_inspect_query：把附录 C.12 的 A–I 九项逐条核实并回填
- 最后按主手册 §8.5 手工验收表走一遍 §8.6 格式如实报告

证据环境提示：本机 GitHub 不可达（TLS），不要尝试联网抓取；上游源码在 _tmp-scc/package/，
官方文档在 _research/dsh/。要复核 asar 用主手册 §9.5 的脚本。
````

---

## 6. 新会话第一件事：清掉这 9 个未知（附录 C.12）

| # | 待核实 | 怎么查 |
|---|---|---|
| A | `@deepseek-ai/dsh-client-runtime` 是否真包（asar 0 命中） | `cordis_inspect_query` / 查 asar-filelist |
| B | `dsh.client.inject` 写不存在的包会硬失败吗 | 装一次看 `application`/`warnings` |
| C | `--dsw-alias-danger` 等 3 个令牌名是否真实 | `cordis_inspect_query` `Theme` 取全表 |
| D | `sessions` 是否有公开的 detach 方法 | `cordis_inspect_query` `Service` |
| E | `Workspace.detachSession()` 的稳定性 | 半公开（类型层 + webhook 在用） |
| F | 官方停空闲 agent 的公开入口 | `fiber.dispose()`（已判定），仍需运行时确认 |
| G | `sidebar.workspaces.session.menu.item` 的完整 props | `cordis_inspect_query` `Slots` |
| H | 主题化确认 Modal 的注册方式（`shell.overlay`） | `Slots.listSubTree` |
| I | `webServer.register` 的完整选项与返回 disposer | `cordis_inspect_query` `Service` |

**纪律**：A–I 任一未核实前，不要把对应代码当作「已验证可用」交付。

---

## 7. 五条最容易翻车的地方

1. **以为删了文件就删了会话** —— 不摘内存 live store，「幽灵行」会回来（§8.5 第 11 步专门测它）。
2. **为了「像上游一样挂在 ⋮ 菜单里」而回去写 DOM** —— 明确违规（R-22/R-25），而且**根本不必**：slot 已存在（§1.10）。
3. **复制上游的 `fiber._unload()`** —— 那是 Cordis 的 private 方法（§1.5.6），公开替代是 `fiber.dispose()`。
4. **响应写死 HTTP 200** —— 网关/日志看不到失败；上游就是这么干的（§1.5.3 / §5.4）。
5. **没验证就报成功** —— 官方口径是看 `application`/`warnings`（R-40），没有浏览器就如实说没做视觉验证（R-42）。

---

## 8. 目录内其他产物

| 路径 | 说明 |
|---|---|
| [`_tmp-scc/package/`](_tmp-scc/package) | 上游 `dsh-session-cleaner@1.0.2` 解包（未改动，唯一上游事实源） |
| [`_research/NOTES.md`](_research/NOTES.md) | 本会话的侦察笔记（网络环境 / 身份核对 / 规范摘要 / 禁止事项） |
| [`_research/dsh/`](_research/dsh) | 从桌面版 `app.asar` 抽取的官方文档与部分包源码 |
| [`_research/asar-filelist.txt`](_research/asar-filelist.txt) | asar 全部 12967 条路径（查包存在性的最快手段） |
| [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) | 本仓库既有的冻结契约范本（第五章的体例来源） |
| [`verify/`](verify) | 本仓库既有验收体系（`*.test.mjs` + CDP e2e），L3/L4 的脚手架可直接借 |
| [`plugin-market/`](plugin-market) | 本仓库的 host+client 双半活范例（`sidebar.footer.action` 的真实用法） |
| `docs\_build\` | ⚠️ 本会话遗留的中间产物（因沙箱权限未能删除），**与交付无关，可手工删除** |

---

## 9. 文档版本

| 项 | 值 |
|---|---|
| 手册版本 | 1.0.0 |
| 复刻对象 | `dsh-session-cleaner@1.0.2`（npm 镜像取回；发布物声明 owner 为 fountunt） |
| 规范依据 | DSH 桌面版 `app.asar` 内 `@deepseek-ai/*` 官方文档 |
| 验证状态 | 代码块语法已验证（`node --check` 全部通过）；**运行时与视觉未验证**（无浏览器控制） |
| 已知待核实 | 9 项（附录 C.12） |
