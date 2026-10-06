# Changelog

## 1.1.6

- **打包与发布迁入 GitHub Actions，本地不再产生任何打包产物**（用户任务：每次本地打包发布
  太消耗 token）：`release.ps1` 本地只做「门禁 → 递增 → 提交 → 打标签 → 推送」——
  `-LocalOnly` 现在只跑门禁、不打包；新增 CI 专用 `-CiPack`（仅 `GITHUB_ACTIONS=true` 放行，
  本地调用直接被拒）。新增 `.github/workflows/pack-release.yml`：标签推送触发（也可
  `workflow_dispatch` 补跑），门禁 → `pnpm pack` → `gh release create`（Release 已存在则
  `upload --clobber` 幂等补附件）→ `publish-npm` job（版本已在 npm 上则跳过；凭据走
  npm Trusted Publishing（OIDC，`id-token: write`），不再依赖长期 token——对齐 npm 官方
  2FA-bypass token 弃用时间表：2027 年初直接发布能力将被移除）。npm 发布必须并进这个
  workflow：由 GITHUB_TOKEN 创建的 Release **不会**触发其它 workflow，`publish-npm.yml`
  只剩人工建 Release 与手动补发作用（同样的 OIDC 权限，原 `NPM_TOKEN` 方案与
  `npm stage publish` 人工审批方案写在各自注释里）。
- **`releases/` 目录从仓库移除，回退一律从 GitHub Release 附件下载**：6 个 tarball 与
  `index.json` 全部 `git rm`，本地 `dist/` 清空——仓库里从此不留任何打包产物，
  旧版安装与回退都指向 Releases 页附件（`releases/download/<tag>/<name>-<version>.tgz>`）。
- **自更新检查改为 GitHub 附件元数据直读**（`releases/` 下线的连带修复，不修则下个版本
  按钮必坏）：`github-release` 源用附件 `digest`（sha256）与 `size` 当场组装条目、不再查
  仓库里的 `index.json`；附件缺 `digest` 时退回老路（≤v1.1.5 的标签仍带清单）。新版本的
  jsDelivr 两个列表源与标签探测会 404 并如实记进 `diagnostic`，限流时退化成
  「更新通道没有回应 + 手动升级提示」，**不会谎称已是最新**。回归：
  `verify/self-update.test.mjs` 新增 2 条（附件成条目 / 缺 digest 退老路），37→39 断言。
- **包内 README 同步根仓库新版式**：1.1.5 重做了根 README（居中标题、徽章行、头图、「为什么做它 /
  界面速览 / 快速开始 / 它怎么工作 / 数据来源 / 安全边界」），但打进 npm 包的
  `plugin-market/README.md` 仍是旧版英文长文，导致 npmjs.com 页面与 GitHub 主页两套长相。本版把包内
  `README.md` / `README.zh.md` 换成同一套版式，图片与文档链接改用 `raw.githubusercontent.com` /
  `github.com/blob/main` 绝对地址（npm 包不携带 `docs/assets/`，相对路径会在 npm 页面 404）。包内容、
  安装路径、接口契约均无变化。
- **npm 包移除无人引用的 `assets/` 图片**（仓库清理的一部分）：`plugin-market/assets/` 下的
  `market-entry.png` / `market-page.png` / `market-updates.png` / `market-header-actions.png`
  自上一条改用 `raw.githubusercontent.com` 绝对地址后已无任何引用（代码、README、`cordis.patch.yml`
  都不指向它们），`package.json` 的 `files` 同步去掉 `assets`——npm tarball 从下个版本起不再携带
  图片，安装与运行行为无任何变化。README 在 npm 页面照常显示（图片走 GitHub 绝对地址）。
- **README 默认英文，中文走切换**（用户报：README.md 只有中文、切换按钮是坏的）：根
  `README.md` 整篇改为英文（GitHub 默认展示），中文全文挪到根 `README.zh.md`；包内
  `README.md` 同步改英文（npm 默认页也是英文），`README.zh.md` 保持中文。四个文件顶部的
  语言行统一为「**English** · 简体中文」——当前语言是纯文本、另一语言是可用链接（此前
  English 链到的 `plugin-market/README.md` 也是中文，点了等于没点）。顺手把包内两份里
  过期的发布段落（还写着本地打包）与信任锚表述（还写「CDN 清单」）对齐根 README 的
  CI 迁移后口径，仓库结构表补上 `restart*.js`。
- **重启助手**（此前只有一句「重启 DSH 后生效」的提示）：新端点 `POST /plugin-market/restart`
  （契约 [API-CONTRACT §2.10](../docs/API-CONTRACT.md)）——宿主先 spawn 一个 **detached** 的
  等待助手，**拿到 pid 才回 200** 再延迟 900ms 退出；助手等进程真的死掉（有界等待 60s，到点
  放弃、绝不双开）用原 `execPath` + `argv` 拉起，拉起前删掉 `ELECTRON_RUN_AS_NODE`（否则桌面端
  变 node 模式黑窗）。实测铁律：**Windows 上非 detached 的子进程会随创建者退出被带走**，所以
  拉起的子进程必须 `detached`（探针实测 detached 活、非 detached 灭）。客户端：任何写操作回来
  `restart-required` / `requiresRestart` 就亮一键「重启 DSH」横幅（按钮在横幅里、不进头部按钮组）；
  探活必须先见到 `/status` **失败过一次**才自动刷新——没有这道闸，旧进程的 200 会被误判成新进程；
  60s 等不到就如实提示手动刷新。如实体现在 tooltip：流式回复会被截断；重启后的进程 Ctrl+C 打不到
  （用 DSH 退出方式或 taskkill）。失败码 `restart-failed`（宿主没退出，可原地重试）。回归：
  新增 `verify/restart-helper.test.mjs`（8 条，含真助手：死父拉起且 env 已清 / 活父绝不拉起）、
  `client-copy.test.mjs` 重启接线检查、e2e 断言横幅出现（**不点击**——会杀掉验收宿主）。
- **搜索框只有一个清除键**（用户报：搜索框有两个清除键）：根因是 `input[type=search]` 在
  **聚焦且有值**时，Chromium 会自己再画一颗原生 ✕（按 `accent-color` 上色，所以是蓝的），
  与 `.dshpm-search` 里我们那颗（带 zh/en `title`/`aria-label`、点击走 `onQueryClear` 连筛选
  一起清）并排出现。裸页 A/B 实测（headless Edge 聚焦态截图）：无规则是「原生 ✕ + 我们的 ×」
  两颗，`-webkit-appearance:none` 或 `display:none` **任一**都能让原生那颗消失，现在两个都写：
  `.dshpm-input::-webkit-search-cancel-button { -webkit-appearance:none; appearance:none; display:none; }`
  ——输入框保持 `type=search`（`role=searchbox` 语义不丢），不靠改类型去重。回归：
  `client-copy.test.mjs` 新增 1 条（样式表必须带这条规则 + 我们那颗仍按值条件渲染并接
  `onQueryClear`），23→24；`market-ui.e2e.mjs` 新增 `[3a]`（在**生效的样式表里挑出我们这条**规则
  ——宿主自己的 `._3Y3Nma_search` 同名规则不算数、聚焦输入后 `.dshpm-search` 内清除按钮精确 1 颗、
  截图 `market-search-clear.png`、点它必须把输入框与按钮一起复位），53→**58/58**。注意：原生 ✕
  **只在聚焦时**才画，失焦的截图验不出问题，所以截图前重新聚焦并打出 `activeElement`；ref DSH +
  headless Edge 这个组合里即便把 `appearance` 全部还原也复现不出原生那颗（逐像素比过），故
  「修复前」的样子用裸页探针取证，e2e 只钉「规则在 + 只有一颗 + 能清」。
- **发版脚本能自动识别「升哪一位」**（用户问：打包能自定义版本号吗、能自动识别打包是否跨版本吗）：
  `release.ps1` 新增 `-Bump auto`——目标号取 CHANGELOG 顶部还没打标签的 `## x.y.z` 节，档位用自上个标签
  以来**触及包体的提交类型**判定（`feat`→MINOR、`fix/修复/perf`→PATCH、`feat!/BREAKING/不兼容`→MAJOR、
  `chore/docs/ci/test`→不升档；认不出的类型走关键词兜底，都认不出按「包体有改动至少 PATCH」定档），
  声明档位与证据**双向都硬拦**（低于或高于都拒绝，报错列出判定档位的提交与两条出路）；显式
  `-Bump patch|minor|major` 仍是人工覆盖路径（证据高于所选档位只警告、不拦）。另加 `-Version x.y.z`
  直接指定目标版本（与 `-Bump` 二选一，CHANGELOG 需有同名节或配 `-NotesFile`）；没有触及包体的提交时
  不发版，并对「HEAD 不在远端」（`-SkipPush` / 推送失败的补推场景）点名提示。门禁新增**档位判定自检**
  判例表 16 条（与版本算术自检同等待遇，负向对照：认不出的类型不许虚报档位）；`docs/RELEASING.md`
  §1/§2/§3 同步。

## 1.1.5

- **首次进入「可更新」页不再显示「再次检查」**（用户报：第一次进入这个界面怎么会是再次检查的
  状态机，应该是检查商店更新）：根因是启动时那次**自动**检查把模块级状态机推到了 `ready`，
  页面一打开按钮就成了「给点过的人看」的再次检查态。现在 `runSelfCheck(onResult, manual)`
  区分来源——自动检查没更新时停在初始态，首次进入仍是「插件市场更新」；「再次检查」只属于
  用户**手动点过**的那次检查。自动检查发现新版本时照常直接亮「更新到 x.y.z」（那是给用户的
  信息，不是替他按下检查）；手动点 → 「正在更新…」→ 没更新 →「再次检查」的四态顺序不变。
  回归：`verify/client-copy.test.mjs`（manual 分支断言）+ `verify/market-ui.e2e.mjs`
  （首次进入断言 `data-state === "idle"` 且文案是「插件市场更新」）。
- **根 README 参照 dsh-mnemon 的版式重做**（用户报：README.md 做的太丑了）：居中标题、
  语言切换行、徽章行、标语 + 头图、速览链接，正文按「为什么做它 / 界面速览 / 快速开始 /
  它怎么工作 / 数据来源 / 安全边界 / 开发与验收」组织；顺手订正旧版的过期说法
  （v1.0.0 安装示例、「47 条断言」、「装完由 HMR 自动生效无需重启」）。配套在 e2e 里加了
  发现页头图截图（拍前拍后都断言停在发现页签），`docs/assets` 新增
  `market-discover.png` 与 `market-updates.png`。

## 1.1.4

**包名变更**：`dsh-market` → `deepseek-harness-market`（前序：`dsh-plugin-market` → `dsh-market`）。

两次都是被 npm 规则挡回来的，如实记录：

1. `dsh-plugin-market` 已被另一个项目占用（fireguo / veloce-ailab，latest 1.3.0）；
2. 改用的 `dsh-market` 被 **同名规则**拦下——与已存在的 `dshmarket`（v1.66.8）只差一个连字符，
   registry 返回 `403 Package name too similar to existing package dshmarket`，`--access public`
   也绕不过。registry 建议加 scope，但用户名 `winnie_0721` 含下划线、scope 不允许下划线；
3. 最终选定 `deepseek-harness-market`，实测可用且近似名（`deepseekharnessmarket`、
   `deepseek-market` 等）均无冲突。

影响范围：
- `package.json` name、`cordis.patch.yml` patch name、`lib/index.js` PLUGIN_NAME、
  `lib/client.js` bundle id / SELF_NAME / STYLE_ID、`lib/self-update.js` MARKET_PACKAGE
- 所有文档、测试、release 脚本中的包名引用
- GitHub 仓库名不变（仍为 `Winnie-0721/dsh-plugin-market`），self-update 的 MARKET_REPO 不变
- tarball 文件名变为 `deepseek-harness-market-<v>.tgz`

**迁移注意**：已安装旧名的 profile 需手动换装：
```sh
dsh plugin --profile <profile> remove dsh-plugin-market   # 或 dsh-market
dsh plugin --profile <profile> add <新包路径或 npm 名>
```

**仓库位置迁移**：仓库整体从 `E:\AI\DeepSeek Harness\Dsh` 迁到 `E:\Code\dsh-plugin-market`
（按 `E:\Code` 下「目录名 = GitHub 仓库名」的放置惯例），GitHub 仓库名与 npm 包名均不变。

- README 的安装说明改为 **npm 优先**（`dsh plugin --profile web add deepseek-harness-market`），
  本地目录示例改成新路径；顺带删掉「本包没有发到 npm」这句已过期的话
- `verify/lib/catalog-fixture.mjs` 的默认快照路径改成按本文件相对位置解析，不再写死绝对路径
- 文档中的绝对路径改到新位置；`verify/REPORT.md` 与 `docs/PLUGIN-MARKET.md` §8.1 的历史验收记录
  **不改写**，只加一条路径后记（证据必须留在它当时的上下文里）

**「更新插件」按钮补上反馈**（用户报：点它没有任何反应，而旁边的「检查市场更新」有）。

两个根因，都修了：

1. **面板开在视区外**——可更新面板在 DOM 里排在目录卡片网格**之后**，点开时它在几百像素之下，
   看上去就是「什么都没发生」。现在展开后 `scrollIntoView({ block: "nearest" })` 滚进可视区，
   用户偏好减少动效时直接跳位、不放平滑滚动。
2. **回执只在「有更新且首次」时才发**——现在与「检查市场更新」一个待遇：按钮进入
   「检查更新中…」忙碌态（spinner + `aria-busy` + 禁用），重读完成**必定给一句话**：
   有更新走 `notice.updatesFound`，全部最新走新增的 `notice.updatesNone`，失败走错误提示条。
   页面挂载与后台重读不回执，避免每次 tick 都弹提示。

回归断言加在 `verify/client-copy.test.mjs`（忙碌态 / announce 回执 / scrollIntoView 三条）。

**回执统一成悬浮气泡**（Android toast 那种；用户要求「这几个更新弹出改成统一的气泡弹窗」）：

- `.dshpm-notice` 从「页内提示条」改成 `position:fixed`：贴视口**底部居中**（`left:0; right:0;
  margin:0 auto`）、圆角 14px + 投影、`max-width:min(560px, calc(100vw - 32px))` 超宽换行。
  **不占文档流**——出现/消失都不推动布局，也不用滚到那一页才看得见（旧版挤在头部下面一格）。
- 入场动画换成 `dshpm-toastin`（自下而上 + 轻微缩放，`backwards` 填充）；`prefers-reduced-motion`
  下照旧全部关闭而内容完整可见。
- 一字未改：kind 配色与图标、4.6s 自动收起与倒计时线、警告/错误保留到手动关闭、`role`/`aria-live`。
- **横幅仍是页内条**（目录过期、只读、构建待批准）：那是要用户处理的持久状态，不是回执。
- 断言：`client-copy.test.mjs` 加样式不变量（fixed / 贴底 / 居中 / 后续规则不得用
  `position:relative` 把它盖回文档流）；`market-ui.e2e.mjs` 加 3 条**几何**断言——真引擎里量
  `getBoundingClientRect`，因为祖先一旦带 `transform`/`filter` 就会抢走 fixed 的包含块，那时
  `position` 的计算值仍然是 `fixed`，只有几何量得出来 → **35/35**

**「可更新的插件」改成第三个页签**（用户圈的位置：已安装右边再开一个分页）：

- 页签栏变成 `发现 / 已安装 / 可更新`，第三个带可更新计数角标（与侧边栏入口、可更新页同一份计数）。
- 原来那个「点按钮就地展开的抽屉」**退场**——内容搬进页签整页显示：`UpdatesDrawer` → `UpdatesPane`，
  头部「更新插件」按钮改为 `setTab("updates")` + 重读回执（该按钮随后在下一条里整个删掉，页签成为唯一入口）。
- 顺带删掉只属于抽屉的东西：`data-open` 折叠过渡、`max-height`/`overflow:hidden`（更新条目多时
  不再有被裁的风险）、`scrollIntoView` 滚动定位、关闭按钮及其样式、`data-drawer` 根属性。
- **气泡回执保持原样**（上一条的悬浮 toast 没动，那是用户先要的）。
- 断言：`client-copy.test.mjs` 加两条（页签顺序 / 页面组件 / 抽屉必须退场），`market-ui.e2e.mjs`
  把原来点抽屉的步骤全部改成页签步骤，并加 3 条（三个页签、默认停在发现页、切走后内容卸载）→ **38/38**

**头部按钮大扫除 + 自动检查 + 一键更新**（用户这一轮提的一整条需求）：

1. **右上角只留「刷新目录」**：删掉「更新插件」（第三个页签与角标取代了它）与「检查市场更新」
   （搬进可更新页页头）。两个按钮的反馈**原样搬过去**——忙碌态 spinner + `aria-busy` + 回执气泡；
   相关文案 `action.updates` / `action.checkingUpdates` 随之删除（不留僵尸键）。
2. **自动检查规则**（`startUpdateScheduler`，在 `apply` 里启动、`schedulerStarted` 守卫）：
   - 每次启动 DSH → 检查一次**市场本体**更新（`GET /self-update`，宿主 10 分钟缓存），结果写模块级
     状态机：可更新页的按钮一打开就是检查结果；
   - 启动后**每 1 小时** → 检查一次**插件**更新（`GET /installed`，绕过 5 分钟计数 TTL），刷新角标；
     只有「多出新更新」且市场页开着时才补一条回执，否则不打扰；
   - 定时器 `unref()`、回调包 `try/catch`：否则 `style-heal.test.mjs` 这类会调 `apply` 的回归测试
     会被每小时的定时器拖住**永远不退出**（实测卡死后定位到）。
3. **可更新页页头的两个按钮**：
   - 「检查市场更新」（四态状态机，从头部搬来，启动那次自动检查已经写过它）；
   - 「一键更新（N）」（新）：按顺序逐个执行同一条安装接口，逐条结果留在该行，跑完给一条汇总回执；
     撞上「要先批准构建脚本」就暂停并把决定权交回用户。逐条的「更新到 x.y.z」保留。
   - 顺手修掉一处自相矛盾：无更新时回执改成说**本机**版本——此前用远端 `latest`，会出现
     「标题写着 1.1.4、提示却说已是最新 v1.1.3」（用户截图里就是这个）。
4. **回执气泡再进一步**：入场换成带回弹的曲线、毛玻璃（`backdrop-filter`）+ 分层投影；新增**退场**——
   先翻 `data-open="false"` 下沉 200ms（`NOTICE_CLOSE_MS`）再卸载，不再凭空消失；`reduced-motion` 下
   照旧立即消失、内容不受影响。
5. **文案**：`notice.updatesFound` 不再让人去点已删除的按钮；`updates.hint` 说明两种跑法。
6. **验收**：`client-copy.test.mjs` **17/17**（新增：头部只剩刷新目录、两个新按钮的反馈、自动检查
   规则、退场动画）；`market-ui.e2e.mjs` **40/40**（批量那两次 `/install` 由 CDP 拦成确定性成功，
   不去打宿主的目录校验）。顺带修掉 e2e 失败时**一行输出都没有**的坑：`process.exit(1)` 会把管道里
   还没刷出去的 `console.log` 全吞掉——改用 `process.exitCode = 1`。

**第二轮截图反馈**（toast 精简 / 删黑条 / 修更新失败的回执）：

1. **标题上方的黑条进度条删掉**（用户点名）：`.dshpm-progress` 节点与样式全部移除，写操作的
   「进行中」改由**触发它的按钮**表达（spinner + `aria-busy` + 禁用），进度感不再横在标题上。
   e2e 新增断言：批量进行中（按钮 `aria-busy=true` 的窗口）页面里 `.dshpm-progress` 必须为 0。
2. **回执文案精简**（用户点名「toast 尽量精简」）：
   - `目录已刷新，共 4412 个插件` → `已刷新 4412 个插件`
   - `发现 2 个插件有新版本，可逐个「更新到 x.y.z」或点「一键更新」。` → `2 个插件有新版本。`
   - `已检查 15 个插件：全部都是最新版本。` → `全部都是最新版本。`
   - `一键更新完成：成功 2 个、失败 0 个。` → `更新完成：成功 2、失败 1。`
   - 英文侧同步精简；e2e 相应正则改写。
3. **更新失败的回执翻译成人话**（用户报「点更新会失败」，先查了 dsh-market 的升级逻辑再修）：
   - 根因：宿主的 `EPERM: operation not permitted, scandir …`（运行中的 DSH 占着 `dsh-our-free-model`
     的文件 / 该目录权限已坏，pnpm 任何一次写树都会在它上面撞车）原本以 `operation-error` 透传，
     而它**不在** `ERROR_PREFIXES` 里 → 套通用模板「请求没有完成 / 看宿主日志」，且客户端
     `errorCopy` **从不渲染 `diagnostic`**——唯一可操作的信息（EPERM + 具体路径）根本没显示。
   - 修复（对齐 dsh-market `pnpm-compat.ts` 的 `windows-file-locked` 分类）：新增
     `fileLockedDetail()` 识别 `EPERM/EACCES/EBUSY/operation not permitted/Access is denied`，
     命中时三段式文案切到专用键 `err.file-locked.*`（「插件文件被占用 / 完全退出 DSH 后重试 /
     目录损坏就先卸载再安装」），详情行露出 diagnostic 原文；可更新行内短句与已安装行错误
     同步换成 `err.file-locked.row`（「文件被 DSH 占用，退出后重试」）。
   - e2e 把第二条 `/install` 拦截成带 EPERM diagnostic 的失败：汇总必须写「成功 1、失败 1」，
     失败行必须显示占用短句。
4. **验收**：`client-copy.test.mjs` **19/19**（新增：占用识别三处接入、精简文案断言、
   黑条删除断言）；`market-ui.e2e.mjs` **42/42**（新增：写操作中无 `.dshpm-progress`、
   EPERM 失败行回执、汇总 1/1；截图前顺手关掉 scratch profile 的 API Key 引导弹窗）。

**第三轮**（修「点更新真的不会更新」+ 按钮状态机）：

1. **根因：更新从来就没换过版本**（宿主行为 + pnpm 语义拼出来的死循环）：
   - 目录条目的 `spec` 是**裸 npm 名**（`dsh-context`）；pnpm 11 对「已存在的依赖 + 裸名」执行
     `pnpm add` 是幂等的——打印 `Already up to date`、`package.json` 一个字节不动。用 DSH 自带的
     pnpm 11.7.0 在 scratch 目录复现：裸名 no-op，`dsh-context@0.63.0` 才真的 `-0.62.3 +0.63.0`。
   - 宿主 `installBundle` 在依赖名没变时仍按「本来就装着」回 `application: restart-required`，
     于是界面显示「已安装，重启后生效」而可更新角标一直是 2——点多少次都没用。
   - 实证：用户 profile 的 `package.json` 仍是 `dsh-context: ^0.62.3`，16:39–16:40 的十几次
     pnpm 操作日志全都是 `Already up to date`。
2. **修复一（宿主半）**：新增 `pinnedNpmSpec`——命中目录条目里的裸 npm 名在传给 `installBundle`
   前钉成 `name@version`（版本字段像 semver 才钉；GitHub 类 URL、已带版本的 spec 原样放行），
   `POST /install` 的两条入口（按 name、按显式 spec）都走它。新增 `verify/install-spec.test.mjs`
   （源码不变量 + 本地目录 fixture + 假 `pluginManager` 的行为断言）。
3. **修复二（客户端半）**：`noticeFromResult` 给每个分支标 `applied`——`restart-required` /
   `overridden` 是「装好了」（warn 气泡照旧提示重启，但计成功），`cancelled` / 无变更不算成功；
   行内结果与批量汇总都按 `applied` 计数。截图里的「成功 0、失败 2」从此变成「成功 2、失败 0」。
4. **按钮状态机**（用户指定）：页头合并成一颗「检查更新」——没检查过显示「检查更新」，按下重读列表，
   检查过且有更新变成「一键更新（N）」，没有更新变成「重新检查」；页脚那颗独立的「重新检查」
   合并删除（`drawerFoot` 不复存在）。旁边那颗改名「插件市场更新」（「已是最新」三个字挨着插件的
   「一键更新」只会误导），逻辑同型（检查 → 有更新给更新、没更新给重新检查），两颗按钮风格统一
   （都带 `primary`）。文案键：+`action.checkUpdates`，−`action.selfCurrent`、−`action.updateAll`。
5. **验收**：`client-copy.test.mjs` **21/21**（新增：状态机与 `applied` 两组断言）；
   `install-spec.test.mjs` **12/12**；`market-ui.e2e.mjs` **45/45**（新增：初始「检查更新」、
   点后变「一键更新（2）」、两颗按钮都带 `--primary`、页脚 `drawerFoot` 为 0；第一条的注入结果
   改成 `restart-required`，必须计为成功并显示重启提示）；`release.ps1 -LocalOnly -Bump none`
   全绿；`adversarial-host.mjs` 全过。e2e 这轮还顺手抓出一个写代码时引入的 bug：`loadInstalled`
   无参调用时 `options` 是 `undefined`，`options.onDone` 抛错会把挂载时的首次回执整个吞掉。

**性能审查**（用户要求「检查插件问题并优化性能」）：

1. **根因：一个共享 `tick` 让三个 effect 全部重跑**。`bumpTick()` 有 7 处调用（安装、卸载、
   两个开关、刷新成功/失败、批量 finish），而 `/status`、`/catalog`、`/installed` 三个
   `useEffect` 都挂在同一个 `tick` 上——**点一次「停用/卸载」= 3 个并发请求**，其中两个是纯浪费：
   - `/status` 只回 `plugin.version` + `manager.available`（宿主 `index.js` 里走 `catalog.peek()`
     零网络），两者只在启动时定下来，写操作绝不改变它 → 每次写操作重取一次，还把面板推回
     `loading` 相态闪一下骨架。
   - `/catalog` 要整份重抓 4412 条再过滤排序分页，而**目录内容与安装/停用插件毫无关系**。
2. **修复**：拆成两个独立计数器。`loadStatus()` 只在挂载时跑（依赖数组 `[]`）；目录 effect 依赖
   新增的 `catalogTick`，只有「刷新目录」的 `bumpCatalog()` 会推进它（且刷新后同时重读已安装，
   因为 `updateAvailable` 依赖目录 join）；已安装 effect 依赖 `installedTick`，所有写操作的
   `bumpTick()` 只推进它。结果：**一次写操作从 3 个请求降到 1 个**（只 `/installed`），刷新目录
   才重抓目录。
3. **审查过、确认无需改动的**：列表 key 用稳定值（`item.id` / `bundle.name`，非 index）；
   目录分页/过滤/排序在服务端（客户端不每次 render 重算 4412 条）；join 用 `Map` 索引
   （O(n+m)，非 O(n·m)）；`catalog` 10min TTL + in-flight 去重 + 失败 30s 冷却；目录计数徽标
   模块级 5min TTL + inflight 复用；搜索 300ms 防抖；请求带 AbortController 且卸载时 abort；
   `noticeTimer` 正确清理；每小时定时器 `unref()`。
4. **验收**：`client-copy.test.mjs` **22/22**（新增一条源码不变量：`loadStatus` 依赖数组为空、
   目录 effect 依赖 `catalogTick`、不存在共享 `[tick]`）；`market-ui.e2e.mjs` **45/45**；
   `release.ps1 -LocalOnly -Bump none` 全绿。

**界面微调**（用户截图反馈「俩个黑色按钮区分一下 还有刷新目录只用在发现界面有就行」）：

1. **两颗黑按钮文字撞车 → 分开**。右键（市场本体）`ready` 态原先复用左键的
   `action.recheckSelf`（「重新检查」），两颗挨着显示一样的字，分不清谁是谁。新增
   `action.recheckSelfOnly`（zh「再查一次」/ en「Check market again」）只给右键用：
   左键管**插件**的「重新检查」，右键管**市场本体**的「再查一次」。
2. **「刷新目录」只在「发现」页签出现**：已安装/可更新页没有目录列表，刷新没有意义。
   header 里改成 `tab === "discover" ? 按钮 : null`。
3. **验收**：`client-copy.test.mjs` **22/22**（断言改为锁 `recheckSelfOnly` 与
   `tab === "discover"` 条件渲染）；`market-ui.e2e.mjs` **47/47**（新增 2 条守卫：
   切到已安装页后头部按钮数为 0、可更新页两颗按钮文案不同）；
   `release.ps1 -LocalOnly -Bump none` 全绿。
4. **右键文案再改一次**：用户随后指定改成「插件市场更新」（原「市场更新检查」）。
   `action.checkSelf`：zh「插件市场更新」/ en「Plugin market update」，并同步 21 处
   代码注释与文档引用（`README.zh.md`、`RELEASING.md`、`PLUGIN-MARKET.md`、
   `API-CONTRACT.md`、`CHANGELOG.md`）。
5. **右键补成四态状态机**（用户报「点不点都是一个」）：这颗按钮此前只有
   idle → checking → ready/installing 三态，且装完直接跳回 idle，点击后文字几乎不变。
   按用户指定的四态补齐：

   | 状态 | 文案 |
   |---|---|
   | 初始（未点） | 插件市场更新 |
   | 点击后检查中 | 正在更新… |
   | 确认更新后 | 更新成功（停 `SELF_DONE_MS = 3000` 再回 idle） |
   | 检查完没有更新 | 再次检查 |

   实现：`action.checkingSelf` →「正在更新…」、`action.recheckSelfOnly` →「再次检查」、
   新增 `action.selfDone`；新增模块级 `done` 相态与 `markSelfDone()`（定时器放模块级，
   装完亮 3 秒再复位——回 idle 不是谎称新代码已生效，只是把按钮复位）；`ready`/`done`
   两个相态都渲染对勾图标。
6. **验收**：`client-copy.test.mjs` **22/22**（断言改为锁四态状态机与 `done` 分支）；
   `market-ui.e2e.mjs` **49/49**——**新增 `/self-update` CDP 桩**（此前右键点下去打的是
   真实宿主，结果取决于 CDN 与 10 分钟缓存，等于没测），恒回「无更新」+ 拖 400ms，
   新增 2 条守卫：点右键立即进「正在更新…」忙碌态、检查完变「再次检查」；
   `release.ps1 -LocalOnly -Bump none` 全绿。

## 1.1.3

修「顶部提示条显示不全」——提示条被压成一条、文字只剩半行（用户截图就是这样）。

根因不在提示条本身，而在 CSS 的**自动最小尺寸规则**：`.dshpm-root` 是「定高 + 可滚动」的 flex 列，
直接子项默认 `flex-shrink: 1`；而 flex 项只要带**非 `visible` 的 `overflow`**（通知条为了底部那条
倒计时线加了 `overflow: hidden`），它的自动最小尺寸就变成 **0**。于是当内容比容器高时，
**整段溢出量都被压到通知条身上**：自然高度 36px 被压到 16px，自己的文字被裁掉一半。
其余区块没有这个问题，恰恰因为它们的自动最小尺寸等于内容高度、压不动。

- 修法：`.dshpm-root > * { flex: 0 0 auto; }`——溢出由容器自己滚动消化，任何区块都不参与收缩。
  （只给通知条写 `flex-shrink: 0` 也能好，但那样下一个带 `overflow` 的区块会再犯一次。）
- 最小复现 `verify/repro-notice-clip.html` 实测：修复前 `noticeClientHeight=16 < scrollHeight=36`；
  修复后 `36 == 36`，且根仍可滚动（`scrollHeight 1608 > clientHeight 620`）。
- 回归断言进了真实浏览器验收（`verify/ui-check.ps1`，24 → **29 条**）：提示条 `clientHeight ≥ scrollHeight`
  且高度 ≥ 30px、文案完整；并在**窄高视口（1200×520）**下断言「`.dshpm-root` 的任一直接子项都没被压扁、
  且根自己可滚动」——把这类缺陷从"看截图才发现"变成"自动化拦住"。

## 1.1.2

把「刚发布的版本看不见」和一条写错的根因一起修掉。

- **列表源会滞后，于是加了标签探测**。实测（2026-10-04）：发布一小时后，jsDelivr 的版本列表
  仍然只有旧版本，`@main` 的 `releases/index.json` 也被 CDN 缓存 12 小时——两个列表都说
  「没有更新」，而真正的最新媒体早就在标签上了。现在列表都给不出更高版本时，按
  `MAJOR.MINOR.PATCH` 的常规递进探三个候选标签（下一个补丁 / 次版本 / 主版本）；
  **任意标签是按需取的**（刚推完 `@v<tag>/…` 立刻 200），所以这一层能追上滞后。有界：最多 3 次请求。
- **源顺序改为按新鲜度**：GitHub Releases API 提到第一源（权威且最新），jsDelivr 两条居后。
  被匿名限流（403，60 次/小时/IP）时**只是这个源失败**，继续问下一个；10 分钟缓存把点击量封在 ~6 次/小时。
- **下载多了第三条路**：`@<tag>` → `@main` → GitHub Release 附件。前两条覆盖 CDN 的标签索引延迟，
  第三条在 CDN 不可达时顶上。仍然只有传输层失败才换路，拿到字节后哈希不符直接硬失败。
- **更正一条写错的根因**（这条要单独说）。1.1.0 的更新日志里写着「本机直连 `api.github.com` 的真实路径
  一律 403（GFW 拦截）、`github.com` 被重置，需要 Clash 代理」。**这是错的**，两个原因叠在一起：
  当时仓库还是 private（未鉴权取 `releases/latest` 就是 404），而匿名限流返回的 403 被误读成封锁。
  2026-10-04 实测：API 200（`X-RateLimit-Remaining: 47/60`）、`github.com` 200、
  Release 附件直连 200（2.7s；走代理 737ms），下载字节的 sha256 与本地构建一致；
  `git ls-remote`（842ms）与 `gh` 也不需要代理。**代理不是必须的，只是更快/更稳**。
  文档里所有相关表述（`docs/RELEASING.md` §3/§4.4、两份 README）已一并更正。

## 1.1.1

修两处只有**真的发一次版**才会暴露的问题（发布 v1.1.0 后立刻实测到的）。

- **一个源半残不再让整次检查失败**。jsDelivr 刚拿到新标签时，它的版本列表可能还是旧的
  （实测：推完 v1.1.0 后列表里只有 1.0.0–1.0.2），而那些版本没有 `releases/` 目录，
  于是第一个源的清单 404 → 旧实现直接回「找到了最新版本 v1.0.2，但拿不到它的发布清单」，
  尽管 `@main` 上的清单已经是 1.1.0。现在每个源必须**版本与该版本的清单都拿到**才算成功，
  失败就继续问下一个；已经有一个明确更高的答案时早退出（一次点击不必问遍所有源），
  没有更新时问完全部源再取**最高**版本——不同源的缓存新鲜度不一致，取最高才不会漏更新。
- **下载不再只认标签地址**。标签可能还没被 CDN 索引（实测 `@v1.1.0/…` 一度 404），
  现在按「标签地址 → main 分支的同一路径」依次尝试。内容由 `sha256` 负责，从哪条路取都不影响安全性；
  但只有传输层失败才换路——**字节都拿到了却哈希不符是篡改信号，直接硬失败**，不再试别的来源。
- 顺带修掉一个测试卫生问题：「没有 fetch 的运行环境」那条断言在 Node 里其实退回了
  `globalThis.fetch`，于是它会真的去打网络，网络一通就误判为通过。现在真的把全局 `fetch` 摘掉再测。

新增 `verify/self-update-live.ps1`：把 `package.json` 临时降到一个低于最新标签的版本，
在 scratch profile 里真的走一遍「有更新 → 下载 → 三道校验 → pnpm 安装」，结束时按字节还原
（实测 6/6 通过）。

## 1.1.0

两个新按钮、一条自更新通道、一套动效。

**头部工具条（`刷新目录` 左边，就是截图里画圈的位置）**

- 「更新插件」：带可更新数量角标；侧边栏入口上也有同一个数字。点开**就地展开**可更新列表，
  每条自己一个「更新到 x.y.z」。故意**不做**一键全更——一次只改一个依赖，失败不连坐。
  列表数据来自 `/installed`（宿主已把目录 join 进去），所以不依赖发现页的目录请求是否完成
  （这一条是真实浏览器验收撞出来的：最初的实现要求目录先加载好，否则显示「目录还没就绪」，
  而那时其实已经有确定的更新数据了）。
- 「检查市场更新」：四态文案（检查中 / 已是最新 / 更新到 x.y.z / 更新中）。有更新时先显示一行
  说明「安装会把本机的 link: 依赖换成下载校验过的本地包」，然后再让你点。

**自更新通道（`GET`/`POST /plugin-market/self-update`）**

- 源顺序：jsDelivr 标签列表 → jsDelivr main 分支 `releases/index.json` → GitHub Releases API。
  ~~为什么不是 GitHub 优先：本机直连 `api.github.com` 的真实路径一律 403、`github.com` 直接重置连接，
  而宿主进程只认 `HTTP(S)_PROXY`（桌面版通常不带）；jsDelivr 直连可用。~~
  **这段根因写错了，已在 1.1.2 更正**：当时是 private 仓库导致的 404，加上匿名限流的 403 被误读；
  GitHub 直连是可用的（API / 网页 / Release 附件都通），1.1.2 起 GitHub API 反而排到第一源。
  详见 `docs/RELEASING.md` §4.4。
- 三道校验：产物路径必须是 `releases/*.tgz` 且拼在固定 CDN 前缀后 → 字节 `sha256` 必须与清单一致
  → 解开 tarball 读 `package/package.json`，包名与版本必须自证一致。**任何一道不过都不安装**，
  并且有测试证明「拒绝时根本没有调用 `pluginManager.installBundle`」。
- 装完后 `requiresRestart: true`，按钮回到「检查市场更新」——宿主半在进程里被 Loader 缓存，
  不谎称已生效。
- 发布流程多一步：`release.ps1` 把 tarball 复制进 `releases/` 并更新 `releases/index.json`，
  两者随版本提交一起进标签（jsDelivr 读不到 Release 附件）。**仓库必须保持 public**。

**动效（覆盖面板内的操作）**

- 卡片/列表行错峰浮入、hover 抬升、按钮按下回弹、chip 与角标弹入、页签底线滑动、
  提示条滑入 + 倒计时线（成功/信息 4.6s 自动收起，警告/错误保留）、可更新面板就地展开、
  写操作期间顶部不确定性进度条、页签切换淡入、详情展开。
- 三条硬约束（写进 `docs/API-CONTRACT.md` §4）：基础样式不写 `opacity:0`；只动
  transform/opacity/max-height；升入动画用 `animation-fill-mode: backwards`。
  第三条是踩出来的——用 `forwards`/`both` 会把 `transform` 钉在末帧，卡片 hover 抬升与按钮
  按下缩放会**全部静默失效**。
- `prefers-reduced-motion: reduce` 下全部关闭，内容按最终位置完整可见。

**新增验收**

- `verify/self-update.test.mjs`（27 条，离线）：版本比较、路径/哈希/产物自证、源回退与缓存，
  以及全部拒绝路径「不安装」。
- `verify/client-copy.test.mjs`（13 条）：zh/en 键集一致、无缺失键、无僵尸文案、关键帧齐全、
  没有升入动画用 `forwards`/`both`、reduced-motion 分支完整。
- `verify/ui-check.ps1` + `verify/market-ui.e2e.mjs`（24 条，真实浏览器）：起 scratch 宿主
  （新进程 → 加载当前代码）+ 系统自带 headless Edge 走 CDP，断言真渲染、真计算样式，
  并在同一个页面里做 `no-preference` / `reduce` 的 A/B。
- 顺带修掉一个宿主路由缺陷：路由表以 path 为键，同一路径登记两次会互相覆盖，
  `GET /self-update` 因此变成 405。现在 GET/POST 合并成单个 handler。

## 1.0.1

修复：插件被热重载后，市场页可能整页失去样式（表现为「功能都在、排版全没了」：标题变成默认字号、
卡片竖排、按钮变成浏览器默认样式）。

根因是样式节点与 DSH 的回收机制不匹配。DSH 的客户端模块系统只回收「**物化窗口内出现**」的
`<style>`：物化时被打上 `data-plugin` 记账，这一代死掉时由 `removeOwnedStyles(id)` 摘除
（`packages/client/modules/src/client/{system,entry-lifecycle}.ts`）。原实现把注入放在 `apply()` 里
（窗口之外、不被记账），又用 `getElementById` 做幂等去重——新旧两代共用同一节点时，旧代被回收
会把新代的样式一起带走，而新的 `apply` 因为「节点还在」跳过注入，页面就停在没有样式的状态。

- 样式改在 **factory 物化窗口内**注入（符合 `dsh.client` 对第三方 bundle 的要求），并且**每次物化
  挂一个全新节点**，不再与上一代共用；
- 渲染路径增加 `ensureStyles()` 兜底，并对 `document.head` 挂移除观察器：样式被摘掉后无需用户重绘
  或刷新即可自愈；观察器随插件 fiber 的 dispose 断开，不在卸载后复活；
- 新增回归测试 `verify/style-heal.test.mjs`（物化即挂 / 重新物化挂新节点 / 观察器补回 /
  渲染补回 / dispose 断开，共 5 条）。

## 1.0.0

首个版本：DeepSeek Harness 插件市场（host + web client 双半）。

- 侧边栏底部（`sidebar.footer.action`）入口 + 中央市场页面（`main` 的 `plugin-market` 席位）
- 发现页：全文搜索、分类筛选、四种排序、分页、卡片与详情
- 已安装页：启用/停用、卸载（二次确认）、更新到最新版
- 安装/卸载/开关全部走宿主 `pluginManager` 服务；仅允许目录内的来源
- 目录抓取：`DSHM_REGISTRY_URL` 覆盖、15s 超时、重试 1 次、10 分钟缓存、失败回退旧缓存并标记过期
- 写操作同源校验、请求体 64 KiB 上限、市场拒绝卸载自己
- zh/en 双语，跟随宿主语言；颜色只使用宿主主题 token
