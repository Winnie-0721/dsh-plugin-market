# deepseek-harness-market 设计与规范对照

本文件说明这次「重新制作一份 DeepSeek Harness 插件市场」做了什么、为什么这样做、以及每一处
如何对应官方插件规范。原始参考实现是 [dsh-market](https://github.com/dsh-market/dsh-market)，
官方规范来源是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

- 包目录：`plugin-market/`（包名 `deepseek-harness-market`）
- 接口契约：`docs/API-CONTRACT.md`
- 团队共享事实：`docs/TEAM-BRIEF.md`
- 安装脚本：`scripts/install-into-profile.ps1`
- 验收报告：`verify/REPORT.md`

## 1. 需求与定位

### 1.1 北极星：**做成「像手机应用市场那样的」DSH 插件市场**

这是用户 2026-10-07 明确要求记下的**项目基准**，也是本文件后面所有设计取舍的判据：

> 本项目要做的是一个**类似手机应用市场（应用商店）的 DeepSeek Harness 插件市场**。

拆成可执行的判据：

| 维度 | 手机应用市场怎么做 | 落到本项目 |
|---|---|---|
| **逛** | 榜单 / 分类 / 搜索 / 卡片式浏览 | 发现页：分类 chips、搜索、排序（热门 / 最新 / 下载最多 / 名称）、卡片网格 |
| **看** | 详情页告诉你这是什么、多大、谁做的 | 卡片可展开详情：说明、能力、版本、仓库 / 目录页、收录时间、安装命令 |
| **装** | 一个按钮，装完立刻可见 | 「安装」走宿主 `pluginManager`，装完卡片状态立即更新 |
| **更新** | 有更新就显示角标，可一键全更 | 「可更新」页签带计数角标；「检查更新 → 一键更新（N）」按顺序逐个跑 |
| **管** | 启用 / 停用 / 卸载都在同一处 | 「已安装」页签：开关、卸载、逐条展开 |
| **自己也能更新** | 应用商店本身会升级 | 市场自我更新通道（三道校验 + 一键重启 DSH） |

**判据是「用户的心智」而不是「功能清单」**：这些动作在手机上都做过，用户不该再学一套新的。
遇到设计分歧时问一句——**手机应用市场在这里会怎么做？**

**不适用条件**（避免把这条基准用过头）：
- **不照搬触摸交互与小屏布局**：本产品是桌面 Web 面板，沿用手机市场的**交互语义与信息结构**，
  不搬手势、不搬移动端排版；
- **不做独立商店站点**：市场活在 DSH 侧边栏内，没有单独域名 / 商城首页；
- **不做社交与运营功能**：评论、评分、排行榜运营、推荐算法都不在范围内
  （理由同 §3「刻意不做的」——与「在侧边栏装/管插件」这个闭环无关，且会显著扩大验证面）。

**边界仍然收得紧**（与上面并列，不可为了「像市场」而放松）：
只装目录内插件、只走宿主 `pluginManager`、写操作只收同源 POST、市场拒绝卸载自己。

### 1.2 最初的需求原话（出处）

需求来自用户原话：

> 基于 https://github.com/dsh-market/dsh-market 上的代码，根据
> https://github.com/deepseek-ai/deepseek-harness 上插件制作规范，重新制作一份关于
> DeepSeek Harness 的插件市场；入口放置在蓝色笔记区域。

「蓝色笔记区域」经截图核对，是侧边栏**底部空白带**：它在会话/工作区列表之下、账号行
（截图里的 `epsilon-delta`）之上。对应官方 slot 就是 `sidebar.footer.action`——
其文档原文是 *Optional actions beside Settings at the sidebar foot*，渲染位置由
`packages/client/ui-sidebar/src/client/SidebarRoot.tsx` 的 `footArea` 决定：

```
<div class="footArea">
  <div class="footerActions">   ← 我们的入口注册在这里（在账号/设置行上方）
  <div class="settingsArea">    ← Settings / 账号启动器
```

所以入口落在用户圈注的位置，且用的是官方为此声明的席位，不是靠 CSS 硬挤进去的。

## 2. 交付形态：一个包，两个半

DeepSeek Harness 的插件就是 Cordis 插件，Web GUI 的插件还必须额外提供一个浏览器半。
本包的 `deepseek-harness-market` 一次提供两半：

| | 文件 | 运行位置 | 职责 |
|---|---|---|---|
| host 半 | `lib/index.js` `lib/catalog.js` `lib/http.js` | 宿主进程（Node） | 抓取并缓存社区目录、暴露 `/plugin-market` 路由、通过 `pluginManager` 服务执行安装/卸载/开关 |
| client 半 | `lib/client.js` | 浏览器（Web GUI） | 侧边栏底部入口 + 市场主面板 UI，只通过 `/plugin-market` 路由取数据 |

两侧的接口在 `docs/API-CONTRACT.md` 冻结，谁都不许单方面改。

## 3. 逐条对照官方插件规范

| 规范要求 | 本包的做法 | 依据 |
|---|---|---|
| 插件包声明 bundle 补丁层 | `package.json` 的 `dsh.bundle.patch = "./cordis.patch.yml"`，补丁用 `- insert:` 插入 `id: plugin-market` 一行 | 官方 `packages/bundle/*` 与已装插件同构 |
| 行要等依赖服务就绪 | 补丁层 `inject: [webServer]`，避免 `apply()` 早于 webServer 执行导致路由注册不上 | `docs/subsystems/web-server.md`、usage-plugin 注释 |
| host 半是 function plugin | 只 named-export `name` / `inject` / `apply`，**没有** default export | `packages/AGENTS.md`：混用会让 Loader 丢掉 function plugin 的命名空间 |
| 可选服务用 `ctx.get()` | `pluginManager` 用 `ctx.get('pluginManager')`，缺失时市场降级为只读浏览 | 同上：`ctx.<name>` 只留给声明的注入 |
| 注册即副作用，返回 disposer | 路由注册走 `ctx.webServer.register(...)`，其返回值就是卸载函数；插件卸载后路由消失 | `ctx.webServer.register` 契约 |
| 浏览器半声明 `dsh.client` | `dsh.client.platform = "web"` + `exports["./client"] = "./lib/client.js"`，宿主据此合成 `window.__DSH_BOOT__` 并在 `/plugins/??deepseek-harness-market/client.js&rev=…` 提供产物 | `docs/subsystems/client-modules.md` |
| 浏览器半的产物格式 | `window.__ModuleLoader__.load({ id: "deepseek-harness-market", factory(require) {…} })`，factory 返回 `{ inject, apply }` | 与已装 usage-plugin 完全同构，客户端模块表按包名注册 factory |
| 只使用平台种子模块 | client 半只 `require("react")`，用 `window.fetch` 取数据；不引第三方库、不写 `eval` | `packages/client/AGENTS.md`：baseline 之外的裸模块必须显式声明，本包不需要 |
| 用 `slots.inject` 注册到别人声明的席位 | `slots.inject('main', …)` 与 `slots.inject('sidebar.footer.action', …)`：等声明出现才注册，声明撤销就回滚 | `packages/client/AGENTS.md` 第 4 条 |
| 面板选择走框架动作，不自己写导航 | 入口点击调用 `ctx.get('layout').selectPanel('plugin-market')`；`main` 的 keyed 席位注册 `plugin-market` | `packages/client/ui-plugin-manager/src/client/index.ts` 是同一模式的官方先例 |
| 只消费公开 token | 颜色全部用 `--dsw-alias-*` / `--dsw-specific-*` 变量并带兜底值，不写死色值 | `docs/web-styling.md`、客户端 Theme 服务的 token 清单 |
| 文案归语言所有 | client 半 zh/en 双语字典，跟随 `ctx.locale` 的当前语言并订阅变化 | `packages/client/AGENTS.md` 的本地化规则（第三方动态包无法使用宿主字典类型，故自带字典） |
| 安装/卸载走官方 pnpm 路径 | host 半调用 `pluginManager.installBundle/removeBundle/setBundleEnabled/setPluginEnabled`，不自己起 pnpm、不改 profile 文件 | `pluginManager` 服务契约 |

**刻意不做的**：不注册 `settings.section`、不改 profile 的 `cordis.patch.yml`、
不实现 WebDAV/Gist 备份、不做主题市场、不做 giscus 评论。理由是与「在侧边栏装/管插件」这一
核心闭环无关，且都会显著扩大需要验证的面（见 §7）。

## 4. 数据来源与抓取策略

目录数据来自社区精选目录 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/plugins.json)
（实测 4412 条，字段含 npm 名、GitHub 地址、双语描述、star、下载量、能力标签、分类）。
选择它而不是自己维护一份列表，是因为 dsh-market 的目录也来自同一处，两边看到的是同一份事实。

抓取在 host 半完成（浏览器直接抓会撞 CORS，且需要把重试/缓存/降级放在一处）。源的选择顺序是
**npm 镜像优先、官方源兜底**：

1. `DSHM_REGISTRY_URL` 非空 → 只用它（用户指定自己的目录时不该悄悄回退到我们的源）；
2. 否则 `https://registry.npmmirror.com` → `https://registry.npmjs.org` 上的 npm 包
   `dsh-plugin-catalog` → `https://awesome-dsh-plugin.com/plugins.json`；
3. `DSHM_NPM_MIRROR` 可以替换 npm 候选。

**为什么不是直接用官方源**：官方源挂在 GitHub Pages 上，本机直连实测 25s 超时（偶尔 35s 才通），
而 DSH 只认 `HTTP(S)_PROXY` 环境变量、不读 Windows 系统代理，宿主进程拿不到浏览器那套代理。
同一份目录发布在 npm 包 `dsh-plugin-catalog` 上，npmmirror 的元数据 97ms、1.21MB gzip 的 tarball
下载 + 解压 291ms——**289ms 对 25s 超时**。这与 dsh-market 自己的区域路由是同一套做法，不是另起炉灶。

单个源的做法：

- npm 源：`<registry>/dsh-plugin-catalog/latest`（15s 超时）→ `dist.tarball`（30s）→
  `dist.integrity` 存在时用 `node:crypto` 校验（目录是安装目标的信任锚，必须防篡改）→
  `node:zlib` 解压 + 最小 USTAR 解析取出包内 `package/plugins.json`；
- URL 源：直接 GET（30s），校验 JSON 对象 + `plugins` 数组 + 数字 `count`，拒绝 HTML；
- 每个源只试一次（源列表本身就是重试），全失败且无缓存时 502/504，文案列出依次试过的源与
  `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR` 两条出路；有缓存则 200 + `stale: true`；
- 内存缓存 10 分钟，并发请求共用同一个 in-flight Promise，`/status` 冷启动只读缓存快照、不发网络请求。

## 5. 安全决定

- **只允许装目录里的插件**：显式 `spec` 必须在目录中存在（等于某条的 npm 名 / 仓库地址），
  否则 400 `not-in-catalog`。挡掉「让网页端随便装任意 npm 包 / git 仓库」这条攻击面。
- **POST 只收同源**：校验 `Sec-Fetch-Site` 或 `Origin` 与 `Host` 一致，否则 403。
- **请求体有上限**（64 KiB）且必须是 `application/json`。
- **不自己起包管理器**：安装/卸载交给 `pluginManager` 服务，构建脚本仍受宿主 pnpm≥10 的
  默认拦截约束，需要用户显式批准时 UI 会把 `pendingBuilds` 摆出来再重提。
- **市场不能卸载自己**：`remove deepseek-harness-market` 返回 400 并给出终端命令，避免用户点一下
  就失去唯一的 UI 入口。
- **不落盘、不带凭据**：host 半只做 GET 目录与调用宿主服务，不写任何文件；目录请求不带认证头。

## 6. 界面设计取舍

依据官方 `docs/web-styling.md` 与 `dsh-client-ui-ux` 的取向，并遵守 dsh-market 自己的
`AGENTS.md`（三条根本原则：自然、好理解、面向普通用户）：

- **一个入口，落在他圈的位置**：底部整行「插件市场」，几何对齐同目录的内建面板行
  （`min-height:36px`、`border-radius: var(--dsw-radius-md)`、hover 用
  `--dsw-alias-interactive-bg-hover`）；侧边栏收成 56px 轨道时退化为 36×36 图标按钮。
- **常态安静**：目录过期是陈述而不是警告；只有安装失败、需要批准构建脚本这两类
  「用户此刻必须做点什么」的状态才变醒目。
- **报错三件事**：每条错误都带「发生了什么 + 为什么 + 现在怎么办」，并给重试入口。
  安装/更新被 `EPERM` / 拒绝访问挡住时（运行中的 DSH 占着插件文件，pnpm 换不了目录——
  参照 dsh-market 的 `windows-file-locked` 分类）自动切到专用文案「插件文件被占用 /
  完全退出 DSH 后重试」，详情行露出 diagnostic 原文；行内短句是「文件被 DSH 占用，退出后重试」。
- **每个动作都有落点**：安装/卸载/开关按钮进入进行中态，结束后刷新列表并给出结果；
  进行中状态由**触发它的按钮**表达（spinner + `aria-busy` + 禁用），结束给一条回执气泡；
  标题上方不再放进度条（那条黑杠是截图反馈里点名要去掉的）。
- **状态齐全**：加载中、空结果、失败、只读（宿主没有插件管理器）、深/浅色、窄屏、长描述。
- **更新入口 = 第三个页签「可更新」，两种跑法**（v1.1.0 起；v1.1.4 改成页签并加批量）：页签栏
  `发现 / 已安装 / 可更新`（就在已安装右边，带计数角标），页里每条单独一个「更新到 x.y.z」；
  页头右侧是**一颗合并状态机按钮**（v1.1.4 第三轮，用户指定）：没检查过显示「检查更新」，按下重读列表，
  检查过且有更新变成「一键更新（N）」（**按顺序逐个执行**同一条安装接口，失败不连坐，跑完给一条汇总回执，
  卡在「要先批准构建脚本」上就暂停），没有更新则变成「重新检查」——原页脚那颗独立的「重新检查」
  已合并进来。旁边是「插件市场更新」（原「检查市场更新」改名，同一套「按下检查 → 有更新给更新、
  没更新给重新检查」逻辑，不再显示容易误导的「已是最新」），两颗按钮风格统一（都是 `primary`）。
  逐条按钮仍然保留：想稳就一条条点。
- **更新真的会换版本**（v1.1.4 第三轮的根因修复）：目录条目的 `spec` 是**裸 npm 名**，而 pnpm 11 对
  「已存在的依赖 + 裸名」的 `pnpm add` 是幂等的（`Already up to date`、不动 `package.json`）——
  旧版点「更新」永远是 no-op，宿主还回 `restart-required`，界面就成了「已安装，重启后生效 → 角标一直是 2」
  的死循环。现在宿主把裸名钉成 `name@version`（`pinnedNpmSpec`，GitHub 类 URL 原样放行）；
  同时 `restart-required` / `overridden` 计为**成功**（`applied`，装好了待重启不是失败），
  批量汇总会如实写「成功 2、失败 0」。回归：`verify/install-spec.test.mjs` + e2e 注入 restart-required。
- **自动检查**（v1.1.4，用户定的规则）：每次启动 DSH 查一次**市场本体**更新（发现新版本直接亮在
  可更新页的「插件市场更新」按钮上；没更新则不改按钮——首次进入仍是「插件市场更新」，「再次检查」
  只属于手动点过的那次），启动后**每 1 小时**查一次**插件**更新（侧边栏与页签角标跟着刷新；
  只有「多出新更新」且市场页开着时才补一条回执，不打扰）。
- **三个页签页面统一间距与高度，加页面只改一处**（v1.1.6，用户报「高度不对齐」并要求
  「设计成统一的，方便后续添加页面」）：三页共用一层外壳 `.dshpm-page`，页面级节距统一成
  **一个单位 12px**；页签按钮高度由 CSS 固定（`min-height:32px`），带角标与不带角标一样高；
  页签栏与页面由 `MARKET_TABS` / `MARKET_PANES` 两张注册表驱动——新增页面 = 各加一项。
  根因是可更新页当年是一张**卡片**（带 12px 内边距 + 边框），作为整页时那圈内边距把内容压下去，
  加上各页容器节距有 8 也有 10，切页签就能看到内容上下跳。修法见
  [API-CONTRACT §4](API-CONTRACT.md)；真实几何由 e2e `[2c]` 取证（三页第一行内容顶边完全一致、
  已安装与可更新两页等高）。约束不变：内容超长时仍由面板根自己滚动，没有第二个滚动容器、
  没有任何区块参与收缩。
- **核心逻辑审计与修复（v1.1.6，用户要求「检查核心代码是否有逻辑错误」）**：三路独立审计读了
  8 个核心文件（约 6400 行）并对照真实 4412 条目录快照跑，共 26 条结论经复核后修掉最要命的几类——
  **会装错包的身份匹配**（目录里不存在的 `@scope/<name>` 曾命中同名的另一个包；`repoTail` 取 URL
  尾段让 435 条 monorepo 地址退化成 `dsh` 这类通用词；仓库键被多条争用时不猜）、
  **内容与传输闸门**（空/截断的目录正文曾以 `stale:false` 覆盖好缓存、市场静默变空；npm 主源
  不剥 BOM；`dist.integrity` 由可选改必填）、**host 契约与生命周期**（`diagnostic` 被丢、
  `application:'failed'` 报成成功、重名安装随便装一个、重启端点写响应失败会让「重启 DSH」永久失效、
  未处理的子进程 `'error'` 直接崩宿主）、**自更新两条「谎称已是最新」**（合法预发布号被当成
  已最新；源知道有新版却验不了时被更旧候选盖住）与**客户端错误归类**（目录过期原因永远是
  「原因未知」、反代返回 HTML 被误诊成宿主内部错误）。**26 条里有 3 条复核不成立、没有改**。
  这批修复**自己全绿之后**又交给独立一方做对抗性复核，抓出 **5 条**（含一条我引入的
  **「一键更新」永久卡死**，见下），并纠正了 2 条我自己的探针误判——**「测试全绿」只说明
  「我想到要测的东西是对的」，不说明修复正确**。两处 `url` / scope 的**过度修复**就是例子：
  症状确实消失了，代价却是 1431 条合法匹配和「粘贴仓库地址搜索」。
  回归见 [REPORT §12.14–§12.15](REPORT.md) 与 [API-CONTRACT](API-CONTRACT.md)。
- **写操作的忙碌态按作业 key 归位，且任何「早退」都必须回调（v1.1.6）**：每个写操作登记自己的
  key（`install:<包名>` / `remove:` / `toggle:` / `refresh` / `self-update`），结束时只清自己那把
  ——原先无条件清空会让并发操作互相解除禁用态，用户以为空闲又点一次就是重复安装。同时补了一条
  更隐蔽的：**「同一个包正在装」的重复点击守卫必须回调调用方**（并把这类记为 `skipped`），
  否则一键更新的顺序循环会在那一步断掉、按钮永久禁用（这个死锁是修 bug 时引入的，
  由对抗性复核用复刻控制流的脚本抓出，真实用户路径是「已安装」页那颗按钮）。
- **动效服务于状态，不服务于炫技**（v1.1.0）：进场错峰、hover 抬升、按钮按下回弹、
  页签底线滑动、回执气泡（toast）贴底弹入 + 倒计时线 + **退场下沉**、可更新页整页切换。三条硬约束写在
  [API-CONTRACT §4](API-CONTRACT.md)（基础态不写 `opacity:0`、只动 transform/opacity/max-height、
  升入动画用 `backwards`），并且 `prefers-reduced-motion: reduce` 下**全部关闭而内容照旧完整可见**——
  真实浏览器里 A/B 验过，不是只看代码。

## 7. 已知限制与后续工作

- **只覆盖 Web/桌面 profile**：client 半是 `dsh.client` web 产物，headless profile 里只有
  host 半可用（可被其它消费者以 HTTP 方式调用）。
- **重启助手（v1.1.6 起实现，形态是 detached wait-and-relaunch）**：需要重启才生效的变更仍
  如实显示 `application: 'restart-required'`，但多了一键「重启 DSH」（`POST /plugin-market/restart`，
  契约见 [API-CONTRACT §2.10](API-CONTRACT.md)）。宿主先 spawn 一个脱离进程的等待助手，**拿到 pid
  才回 200** 再延迟 900ms 退出；助手等进程真的死掉（有界等待 60s，到点没死就放弃，绝不双开）再用
  原 `execPath` + argv 拉起；客户端探活必须先见到宿主「死过一次」，回来后才自动刷新页面——
  没有这道闸，旧进程的 200 会被误判成新进程。如实的代价：截断正在流式输出的回复；重启后的进程
  由 detached 方式拉起，**终端 Ctrl+C 打不到它**（要用 DSH 自己的退出方式或 taskkill 结束）——
  两条都写进了按钮 tooltip 与契约，测试见 `verify/restart-helper.test.mjs`（真助手不碰真实 DSH）。
  自更新装完后同理：按钮回「插件市场更新」，亮的是重启横幅，不假装新代码已生效。
- **自更新的信任锚是清单哈希，不是独立签名**：路径形状 + `sha256` + 产物自证三道校验
  （新版本 `sha256` 取自 GitHub 附件 `digest`，≤v1.1.5 走 `releases/index.json`）
  能挡住损坏、截断与单点替换，但挡不住「清单与产物一起被换」。要有那个能力就得引入
  独立签名密钥（本次不做，已写进 [API-CONTRACT §2.9](API-CONTRACT.md) 而不是含糊过去）。
- **自更新通道依赖仓库保持 public**：转 private 后 GitHub API 对未鉴权请求回 404（jsDelivr 同样读不到），
  按钮会变成「更新通道没有回应」；同时别人也装不上这个插件（Release 附件要鉴权）。
- **`verify/ui-check.ps1`（真实浏览器）不在发布门禁里**：它要起宿主进程 + headless Edge，
  慢且依赖本机有浏览器。它作为「改客户端半之后手动跑一次」的步骤写进了
  [RELEASING §4.5](RELEASING.md)；门禁里跑的是它的离线部分（文案/动效不变量）。
- **不内置目录快照**：目录每天在长，旧快照会把「今天发布的插件」显示成「不存在」，
  因此宁可显示抓取失败也不回退到过期快照。
- **无收藏 / 备注 / 分组 / 备份**：这些是本地状态型功能，需要额外持久化面与一致性验证，
  本次不做；`pluginManager` 已是唯一事实来源，不做第二份缓存。
- **第三方动态包拿不到宿主字典类型**：文案字典随包发布（zh/en 两份），新增语言需要改包，
  这是动态客户端插件当前的边界。

## 8. 验收

### 8.1 独立验收（临时 profile）

> **路径说明**：本节与 `verify/REPORT.md` 是**当时**的运行记录，里面的绝对路径以当时仓库位置
> `E:\AI\DeepSeek Harness\Dsh` 为准；仓库已迁到 `E:\Code\dsh-plugin-market`，历史记录里的旧路径不再有效。

`verify/REPORT.md` 是完整记录：用 `DSH_HOME=E:\AI\DeepSeek Harness\Dsh\_verify\dshhome` 建独立
profile，`dsh plugin --profile marketcheck add <本包>` 安装，起 4 个宿主实例，按契约逐条断言。
最终一轮 `verify-20261003-214407`：**47 条断言 PASS=47 / FAIL=0**，覆盖：

- 安装后 `dsh.profile.bundles` 含 `deepseek-harness-market`、`node_modules` 里有它、宿主启动日志无 FAILED fiber；
- 首页 `window.__DSH_BOOT__` 含 `id === 'deepseek-harness-market'` 的 entry，`/plugins/??deepseek-harness-market/client.js&rev=…` 返回 JS，**按 UTF-8 解码后含「插件市场」且无替换字符**；
- `/status`（冷启动 `catalog:null` 且零网络调用）、`/catalog`（真实抓取 4412 条、550ms、缓存命中与 refresh）、`/installed`（12 个 bundle，含 `market:true` 的市场自身）；
- 越权与错误路径：跨站 POST 403、GET 打 POST 405 + `Allow`、目录外 spec 400 `not-in-catalog`、卸载自身 400 `not-allowed`、未知路径 404、>64KiB 400、非 JSON Content-Type 400；
- 对抗性：客户端 bundle 无 `eval(` / `new Function(`；缺 `pluginManager` 时 `apply` 不抛且降级为只读；`updateAvailable` 在目录版本更低/更高两个方向都对。

首轮曾出现 29 pass / 10 fail，逐条定性后是 **8 条验收工具 bug + 1 条断言过期 + 1 条真实缺陷**：
真实缺陷是「目录源不可达」（官方源直连 25–93s，超出超时预算），已由 §4 的 npm 镜像优先方案修复
（实测 289–550ms）。工具缺陷（PS 5.1 读不到 4xx 正文、变量作用域遮蔽、curl 引号被剥）都写进了
REPORT 的「工具缺陷与修正」一节——验收报告承认自己的测量缺陷，比只报数字更有价值。

### 8.2 真实 profile 与真实 GUI

在用户的 `desktop` profile 上执行 `scripts/install-into-profile.ps1 -Profile desktop`：

- 装前备份 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` 到 `_verify/backup-desktop-<时间戳>/`；
- 安装结果：`deepseek-harness-market link:E:/AI/DeepSeek Harness/Dsh/plugin-market`，pnpm 301ms，`dsh.profile.bundles` 追加 `deepseek-harness-market`，用户补丁层未改动；
- **HMR 自动生效，无需重启、无需刷新**：约 8 秒后侧边栏底部（账号行上方）出现「插件市场」入口，点击即在主栏打开市场页；
- 实测截图（真实 GUI，整窗捕获）：市场页显示 4412 条目录、23 个分类、分页 1/184，卡片带安装/详情按钮。

![侧边栏底部入口](assets/market-entry-sidebar.png)

![真实 GUI 里的市场页](assets/market-page-live.png)

回滚：`pwsh -File scripts\install-into-profile.ps1 -Profile desktop -Rollback -BackupDir <备份目录>`。

### 8.3 真实浏览器渲染与动效（v1.1.0 补上）

上一轮把「真实浏览器里的 DOM 级渲染断言」列为未覆盖项，这次补上了：
`verify/ui-check.ps1` 起一个**新进程**的 scratch 宿主（所以它加载的是仓库里当前的宿主半代码，
不需要重启用户正在用的 DSH），再用系统自带的 headless Edge 通过 CDP 驱动真引擎：

- 侧边栏入口 → 点开面板 → 头部只剩「刷新目录」→ 页签栏 `发现 / 已安装 / 可更新` → 页签角标数字（注入确定性的 `/installed`）；
- 卡片与已安装行的 `animation-name` 含 `dshpm-rise`、`animation-fill-mode` 是 `backwards`、
  存在错峰 `animation-delay`、页签底线是 `scaleX(1)`；
- 切到「可更新」页：两条记录、版本走向 `v1.0.0 → v1.2.0`、每行各自的「更新到 x.y.z」、
  页头右侧初始是「检查更新」与「插件市场更新」（带 `data-state`，两颗都带 `--primary`，页脚无独立按钮）；
  点「检查更新」后同一颗按钮变成「一键更新（2）」；点批量按钮：第一条返回 `restart-required`
  （**必须计为成功**并显示「重启 DSH 后生效」）、第二条由 CDP 注入 `EPERM` 占用失败 → 汇总回执如实写
  「成功 1、失败 1」，失败行显示「文件被 DSH 占用，退出后重试」的专用短句；批量进行中（按钮 `aria-busy`）顶部没有黑条进度条；
- 页签来回切（可更新 → 已安装）：列表回来、切走后内容卸载（同一时间只有一份在 DOM 里）；
- **`prefers-reduced-motion: reduce` 的 A/B**：先钉成 `no-preference` 证明动效在跑，
  再切成 `reduce` 证明 `animation-name` 变成 `none` 而列表行仍然在（内容不会消失）；
- 页面控制台无插件错误（批量那两次 `/install` 由 CDP 拦截成确定性成功，不去打宿主的目录校验）。

结论：**24/24 通过**（v1.1.3 加了 5 条布局断言后为 **29/29**；修「点更新插件没反馈」时加 3 条——
点完必须有结果回执、面板必须在视区里、发现页 + 520px 矮视口下同样成立——**32/32**；回执改成悬浮
气泡后再加 3 条几何断言（`fixed` / 贴视口底 / 水平居中）→ **35/35**；「可更新」改成第三个页签后
再加 3 条（页签数量与顺序、默认停在发现页、切走后内容卸载）→ **38/38**；头部按钮大扫除 + 自动检查
+ 一键更新后再改写/新增 2 条（头部只剩刷新目录、页头两个按钮与状态标记）→ **40/40**；
+ 删顶部黑条 + toast 精简 + EPERM 占用回执后新增 2 条（写操作进行中 `.dshpm-progress` 必须为 0、
+ 注入 EPERM 的失败行必须显示占用短句，汇总改验「成功 1、失败 1」）→ **42/42**；
+ 按钮状态机 + restart-required 计数那轮新增 3 条（初始是「检查更新」、点后变「一键更新（2）」，
两颗按钮都带 `--primary`、页脚 `drawerFoot` 必须为 0），并把第一条的注入结果改成 `restart-required`
（计为成功、行内显示重启提示）→ **45/45**；搜索框单清除键那轮新增 5 条 → **58/58**；
三个页签统一布局这轮新增 6 条（`[2c]`：页签等高、注册表顺序、节距 12px、
**三页第一行内容顶边一致**、两页等高、页面顶边在视区内，截图 `market-tab-alignment.png`）→ **64/64**），
截图落在 `verify/logs/ui/`
（`market-updates-open.png`、`market-header-zoom.png`、`market-tab-installed.png`、
`market-reduced-motion.png`、`market-short-viewport.png`、`market-updates-short-viewport.png`）。
顺带记一个踩点：headless Chromium **默认就是 `prefers-reduced-motion: reduce`**，
不显式钉 `no-preference` 的话，「动效生效」那组断言测的是一条永远关着动画的路径。

用户报的「提示条显示不全」修在 v1.1.3，根因是 CSS 的自动最小尺寸规则（带非 visible `overflow`
的 flex 项自动最小尺寸为 0，于是被溢出量压扁、文字被自己裁掉）。最小复现见
`verify/repro-notice-clip.html`，完整机理与实测数据见 [REPORT §12.12](REPORT.md)：

![修复前 vs 修复后](assets/notice-clip-before-after.png)

### 8.4 自更新端到端（真实 CDN + 真实安装）

`verify/self-update-live.ps1` 不模拟任何一环：它把 `plugin-market/package.json` 的版本临时
降到 `1.0.9`（低于最新标签），于是新起的 scratch 宿主会认为自己旧了，然后：

1. `GET /plugin-market/self-update` → `updateAvailable:true`、`installable:true`、带 `url`/`sha256`；
2. `POST`（走在已鉴权会话上）→ **真的下载 1.1.x 的 tarball**（`@<tag>` / `@main` / Release 附件三条路依次试）、
   按清单校验 sha256、
   解开 tarball 自证 `deepseek-harness-market@<version>`、写盘、再交给宿主 `pluginManager.installBundle`；
3. 核对 scratch profile 的 `dependencies['deepseek-harness-market']` 已经变成指向下载物的 `file:` ——
   证明 pnpm 真的装了，而不是接口回了个 200；
4. `finally` 里按字节还原 `package.json`（并核对 sha256）与 scratch profile，删掉测试下载物。

结论：**6/6 通过**。这条路径也是这轮唯一能暴露「第一个源半残就整次失败」的地方——
离线测试当时还没有那个用例，是发布后真跑一次才撞出来的（修在 v1.1.1，
从此 `verify/self-update.test.mjs` 里有了对应的离线用例）。

### 8.5 尚未覆盖

- 从**终端或另一个窗口**做的插件变更不会推送到已打开的市场页，需要手点「刷新目录」或重开面板。
- 官方 URL 兜底最坏 30s（只在两个 npm 源都失败时才会走到）。
- 动效只做了「计算样式层面」的断言（动画名、填充模式、延迟、reduced-motion 开关）：
  具体某一帧的观感、以及滚动中的合成性能没有自动化测量，仍靠人看截图。
- **列表源的滞后只能「容纳 + 兜底」，不能根除**：`@main` 的分支清单被 CDN 缓存 12 小时、
  Data API 的版本列表数小时不更新（都实测过）。v1.1.2 起加了**标签探测**兜底
  （任意标签是按需取的，所以能追上刚发布的版本），并把最权威的 GitHub API 提到第一源；
  但若三个列表源与三个探测标签同时不可用（例如整机断网），检查仍会失败并如实报错，
  而不是编一个版本号出来。
