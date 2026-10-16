<h1 align="center">deepseek-harness-market</h1>

<p align="center"><a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/plugin-market/README.md">English</a> · <strong>简体中文</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/deepseek-harness-market"><img alt="npm version" src="https://img.shields.io/npm/v/deepseek-harness-market?label=npm" /></a>
  <a href="https://www.npmjs.com/package/deepseek-harness-market"><img alt="npm downloads" src="https://img.shields.io/npm/dt/deepseek-harness-market?label=downloads%20total" /></a>
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/Winnie-0721/dsh-plugin-market" /></a>
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Winnie-0721/dsh-plugin-market" /></a>
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="DeepSeek Harness 0.2.0-rc.2" src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-blue" /></a>
</p>

<p align="center"><strong>装进 DeepSeek Harness 里的插件市场。</strong></p>
<p align="center">侧边栏底部一个入口：浏览、搜索社区目录，安装、更新、启用 / 停用、卸载，全程不离开 GUI。</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Winnie-0721/dsh-plugin-market/main/docs/assets/market-discover.png" alt="插件市场：发现 / 已安装 / 可更新三个页签、搜索、分类与真实插件卡片" width="880" />
</p>

<p align="center">
  <a href="#快速开始"><strong>安装</strong></a> ·
  <a href="#界面速览">界面速览</a> ·
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md">设计文档</a> ·
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md">接口契约</a> ·
  <a href="https://github.com/Winnie-0721/dsh-plugin-market/releases/latest">Release</a>
</p>

## 为什么做它

**定位一句话：这是一个「像手机应用市场那样的」DeepSeek Harness 插件市场**——逛、看、装、更新、
启用/停用、卸载，都在侧边栏里完成，和你在手机上装 App 是同一套心智。下面的每一条都是这个定位的落地：

- **目录大，读得快。** 社区精选目录 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/plugins.json) 4400+ 条（每日更新）；读取 **npm 镜像优先、官方源兜底**，抓取、缓存、重试、降级全在宿主进程，浏览器只读自家接口——列表始终秒开。
- **更新每一步都看得见。** 左键是合并状态机「检查更新 → 一键更新（N）/ 重新检查」，行内逐条「更新到 x.y.z」；每条结果留在自己那行，跑完给一条**如实**的汇总回执（待重启计成功、失败原因原样写在那一行，不糊弄）。
- **市场会更新自己，而且不再被单条线路卡死。** 启动自动查一次本体更新，有新版本按钮直接亮「更新到 x.y.z」，四态齐全：插件市场更新 → 正在更新… → 更新成功 → 再次检查；下载过路径形状 + `sha256` + 产物自证三道校验，装完**不假装已生效**。GitHub 的几条通道**各自独立地会挂**（`api.github.com` 匿名限流、`raw` 时通时断、jsDelivr 主域名 `ECONNRESET`、公共加速前缀整体下线），所以每一次请求都按「每类服务一组候选线路」逐个试，并**记住本轮证明能用的那条**提前；公共加速服务常用 **200 + 自己的 HTML 错误页**敷衍上游失败，这类载荷被当场识破、不会把一条死线路记成可用。另外 `DSHM_GITHUB_PROXY` 可给一个自建前缀（**插到候选最前**，而不是替换整张表——替换会把一次镜像故障变成整条通道不可用）。实测：改装前本机 `check()` 12.4s 全失败（四个源一个都没成）；改装后连跑三轮**每次都成功**（5.8s / 7.1s / 8.4s），最坏耗时不比改装前差（预算默认等于单次超时，所以只是把那段时间摊给几条线路）。见 [API-CONTRACT §2.8.1](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md)。
- **新装的插件当场生效，不用重启。** 宿主**故意不**对已装的包做热应用——`pluginManager.installBundle` 在调用 `reload()` **之前**就返回 `restart-required`——所以这一步由市场自己做：把一个刚装好的插件通过市场自己的 `Include` 子树挂进正在运行的组合（输入文件是 `<profile>/.dsh-market/` 下一次性的 `hot-N.yml`，每次启动擦掉，因为持久化仍归 `dsh.profile.bundles`）。面板随后写「不用重启」，**重启横幅也不会亮**。六条边界都做了断言：只支持纯 `id`/`name` insert 的 patch（`config:` 块、行内 `config: {}`、或任何别的键都会整体作废并如实回「重启后生效」）；**升级永远不热挂**（替换活着的包时 Node 的 ESM 缓存给旧模块，挂上去只是演戏）；挂载 / 卸载都有硬超时（10s，卡在等服务的插件不能把请求挂死）；挂载失败回滚（销毁半挂子树 + 删输入文件）；没能确认停止的卸载报 `false`，不谎报已卸掉。见 [API-CONTRACT §2.4.1](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md)；逻辑移植自官方 [dsh-market](https://github.com/dsh-market/dsh-market) 的 `src/hot.ts`（保留形状，不抄代码）。
- **「要重启」这件事如实说，而且刷新页面丢不掉。** 需要重启宿主的改动，面板不会悄悄变绿；记账在**宿主半**（`/status.pendingRestart`）而不是页面内存里，所以刷新只丢界面、丢不掉事实。`dsh web` / CLI 下还给一键**「重启 DSH」**（detached 等待、死透再拉起，探活先见过宿主死过一次才自动刷新页面）。**能不能一键重启按部署环境判，而不是一律拒绝或一律允许**：systemd 服务下 systemd 默认 `KillMode=control-group` 会把重启助手连坐清掉（服务被杀且不会自己回来）、桌面壳下替代进程会被单实例锁挡在门外（壳的 IPC 白名单里也没有「请壳重启自己」这种消息、宿主一退出壳就当致命故障，三条独立的理由见 [API-CONTRACT §2.6](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md) 与 [ROADMAP 第 6 条](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/ROADMAP.md)）、`--inspect` 调试会话会被打断——三种情况各自给出**不同的下一步**（`systemctl restart` / 关窗重开 / 断开调试器），合成一句会让用户去试不可能成功的办法。识别 systemd 要**两个信号**：`INVOCATION_ID` 是继承的，只看它会把普通终端和 CI runner 也关掉（那是比原 bug 更坏的 bug），所以还要看父进程是不是 unit 的主进程。见 [API-CONTRACT §2.10](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md)。
- **边界收得紧。** 只装目录内插件、只走宿主 `pluginManager`、写操作只收同源 POST（64 KiB）、目录包 `dist.integrity` 必校验、市场拒绝卸载自己。
- **像宿主的一部分。** 颜色只用宿主 `--dsw-*` 主题 token 并带兜底值，文案 zh / en 跟随宿主语言；深色 / 浅色、窄屏、`prefers-reduced-motion` 都如实处理（e2e 逐条盯着）。

## 界面速览

**入口在侧边栏底部、账号行上方，带可更新角标：**

<p align="center">
  <img src="https://raw.githubusercontent.com/Winnie-0721/dsh-plugin-market/main/docs/assets/market-entry-sidebar.png" alt="侧边栏底部的插件市场入口，带更新角标" width="640" />
</p>

**「可更新」页：合并状态机（一键更新（2）/ 再次检查）、逐条「更新到 x.y.z」、行内结果与汇总回执**
（下图为验收环境：列表是注入的夹具更新，一条成功待重启、一条占用失败）：

<p align="center">
  <img src="https://raw.githubusercontent.com/Winnie-0721/dsh-plugin-market/main/docs/assets/market-updates.png" alt="可更新页：一键更新、逐条更新到指定版本、行内成功与失败回执" width="880" />
</p>

## 快速开始

```sh
dsh plugin --profile web add deepseek-harness-market
```

1. 装完重启一次 `dsh web`（或让桌面端重新组合），刷新页面——入口出现在侧边栏**底部**、账号行上方。
2. **发现**页搜索、按分类挑插件 → 点「安装」；**已安装**页管启用 / 停用与卸载。
3. **可更新**页带计数角标：左键「检查更新 → 一键更新（N）」按顺序逐个跑，一条失败不影响其余；右键管市场自己的更新（「插件市场更新 / 再次检查」）。
4. Windows 一键安装（含 profile 备份与回滚）：

   ```powershell
   pwsh -File scripts\install-into-profile.ps1 -Profile desktop
   ```

5. 也可以直接装 [GitHub Release](https://github.com/Winnie-0721/dsh-plugin-market/releases/latest) 附件——每个 Release 页面都给一条可复制的命令。

> 兼容 DSH **0.2.0-rc.2**；npm 包与 GitHub Release 同步发版，版本规则与发布流程见 [docs/RELEASING.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/RELEASING.md)。
> 还没有 DSH？`npx @deepseek-ai/dsh web` 起一个本地实例。

**该不该重启、怎么重启**（面板上说的也是这一套，不糊弄）：

| 你在用什么 | 市场装上「宿主半」的改动之后 | 你该做什么 |
|---|---|---|
| `dsh web` / CLI | 面板亮出「待重启」横幅，横幅里有**「重启 DSH」**按钮 | 点它，或者自己重启命令 |
| **桌面端应用** | 同一条横幅，**但没有按钮** | **关掉窗口再重新打开** —— 刷新页面不会加载新的宿主代码 |

## 它怎么工作

一个 npm 包同时带两半，按官方插件规范装进宿主：

- **host 半（仓库进程）**：只 named-export `name` / `inject` / `apply` 的 Cordis function plugin；`ctx.webServer` 注册一条 prefix 路由，`ctx.get('pluginManager')` 可选桥接安装能力。目录抓取、缓存、重试、校验、自更新下载都在这里——**浏览器不碰网络与文件系统**。
- **client 半（浏览器）**：`lib/client.js` 单文件 bundle，经 `window.__ModuleLoader__.load({ id, factory })` 注册，除 `require("react")` 外零依赖。
- **席位与声明**：入口注册官方 `sidebar.footer.action`，面板注册 `main` 的 `plugin-market` 键，导航走 `ctx.layout.selectPanel`；`package.json` 声明 `dsh.bundle.patch`（bundle 补丁层）与 `dsh.client`（`platform: web` + `./client` 导出）。
- **接口是冻结的**：host ↔ client 的端点、响应与错误码以 [docs/API-CONTRACT.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md) 为准，改契约先改文档与回归测试；与官方规范的逐条对照见 [docs/PLUGIN-MARKET.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md)。

## 数据来源

| 顺序 | 来源 | 地址 | 本机实测 |
|---|---|---|---|
| 1 | **npm 镜像（首选）** | `dsh-plugin-catalog` 包 | **289 ms** |
| 2 | 官方 URL（兜底） | `awesome-dsh-plugin.com/plugins.json` | 25–93 s（超时） |

兜底是必要的：DSH 只认 `HTTP(S)_PROXY` 环境变量、不读 Windows 系统代理，而官方源挂在 GitHub Pages 上。
默认地址可用 `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR` 覆盖。

本项目按官方插件规范**重新实现**，参考了 [dsh-market](https://github.com/dsh-market/dsh-market) 的目录来源与产品取舍，但不是它的拷贝：功能面收敛到「在侧边栏装 / 管插件」这一个闭环。

## 安全边界

- 只允许安装**目录内**的插件；目录条目带 `dist.integrity` 时必须校验通过才使用。
- 安装 / 卸载 / 启用 / 停用只走宿主 `pluginManager`——与 `dsh plugin add` 同一条路径、同一套构建脚本审批规则。
- 写操作只收**同源 POST**（64 KiB 上限），不接受跨源、不拿 GET 改状态。
- 市场**拒绝卸载自己**。
- 自更新的信任锚是清单哈希（路径形状 + `sha256` + 产物自证三道校验）：新版本由 GitHub 附件 `digest` 直接给出 `sha256`，老版本走 `index.json`；挡损坏、截断与单点替换，挡不住「清单与产物一起被换」——如实写在 [API-CONTRACT §2.9](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md)，不冒充独立签名。

[设计与安全决定](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md) · [已知限制](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md#7-已知限制与后续工作) · [接口契约](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md)

## 开发与验收

发布到 npm 的包里**只有运行时**（`lib/`、`cordis.patch.yml`、两份 README、`CHANGELOG`、`LICENSE`）——
下面这些命令在**仓库里**跑，不是在装好的副本里跑：

```sh
# 真实浏览器 e2e：起 scratch 宿主 + headless Edge，驱动真引擎断言并落截图
pwsh -File verify\ui-check.ps1

# 发布门禁：node --check + verify/*.test.mjs 全跑（不改版本、不打包、不发布）
pwsh -File scripts\release.ps1 -LocalOnly

# 正式发版（本地只到这里）：门禁 → 递增 → 提交 → 打标签 → 推送
# 推上去的标签触发 GitHub Actions：打包 → GitHub Release 附件 → npm，
# 其中 npm 发布只有 publish-npm.yml 一份实现（真因见 docs/RELEASING.md §4.2.1）
pwsh -File scripts\release.ps1 -Bump patch
```

门禁**自动发现** `verify/*.test.mjs`（当前 **20 套**：文案键、状态机、安装 spec、自更新通道、
来源判定、发布工作流回归……），逐套跑。其中
[`release-workflow.test.mjs`](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/verify/release-workflow.test.mjs) 有一条**反向断言**：
`pack-release.yml` 里不得出现 `npm stage publish`——把发布步骤再写一遍正是**吃过两次**的那个 bug
（[真因与 CI 实际证明了什么，RELEASING §4.2.1](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/RELEASING.md)）。
真实浏览器 e2e 共 **90 条**，不进门禁（要浏览器与 scratch 宿主），改客户端半或自更新通道后手动跑；
独立验收报告见 [verify/REPORT.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/verify/REPORT.md)。

## 仓库结构

| 路径 | 内容 |
|---|---|
| [plugin-market/](https://github.com/Winnie-0721/dsh-plugin-market/tree/main/plugin-market) | 插件包本体：host 半（`lib/index.js` / `catalog.js` / `catalog-npm.js` / `http.js` / `self-update.js` / `github-routes.js` / `hot-mount.js` / `restart.js` / `restart-policy.js` / `restart-helper.cjs`）+ web client 半（`lib/client.js` 单文件 bundle）+ `cordis.patch.yml` |
| [.github/workflows/](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/.github/workflows/publish-npm.yml) | `pack-release.yml`（标签 → 门禁 → 打包 → 建 Release）与 `publish-npm.yml`（**唯一**的 npm 发布实现，经 `workflow_call` 被复用） |
| [docs/API-CONTRACT.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/API-CONTRACT.md) | host ↔ client 的冻结接口契约（端点、响应约定、目录抓取策略） |
| [docs/PLUGIN-MARKET.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/PLUGIN-MARKET.md) | 设计与官方规范逐条对照、数据源决策、安全决定、限制、验收结论 |
| [docs/RELEASING.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/RELEASING.md) | 版本规则、发布链路、npm 发布三次翻车的真因、分发路径 |
| [docs/ROADMAP.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/ROADMAP.md) | 下一步做什么、不做什么，都带实测证据与代价 |
| [docs/TEAM-BRIEF.md](https://github.com/Winnie-0721/dsh-plugin-market/blob/main/docs/TEAM-BRIEF.md) | 实现期的环境事实与 API 签名（供协作 / 复现） |
| [scripts/](https://github.com/Winnie-0721/dsh-plugin-market/tree/main/scripts) | 安装 / 回滚与发布脚本 |
| [verify/](https://github.com/Winnie-0721/dsh-plugin-market/tree/main/verify) | 回归测试 + 真实浏览器 e2e + 独立验收报告 |

## 许可

MIT。目录数据与其来源仓库的许可归 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 所有；本仓库不包含第三方源码。
