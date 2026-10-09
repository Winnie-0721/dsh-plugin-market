/**
 * deepseek-harness-market — 客户端半（浏览器 bundle）
 *
 * 为什么是这个形状：宿主把本文件当脚本直接从 /plugins/??deepseek-harness-market/client.js&rev=… 加载，
 * 只给一个 window.__ModuleLoader__ 装载器和平台种子模块 react。没有相对的模块解析、没有第三方组件库，
 * 所以组件、请求封装、i18n 与样式全部放在这个 factory 闭包里，不引任何其它模块。
 */
window.__ModuleLoader__.load({
  id: "deepseek-harness-market",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var el = React.createElement;

    var PANEL_KEY = "plugin-market";
    var ENTRY_ID = "plugin-market";
    var API_PREFIX = "/plugin-market";
    var SELF_NAME = "deepseek-harness-market";
    var STYLE_ID = "deepseek-harness-market-style";
    var SEARCH_DEBOUNCE_MS = 300;
    /** 成功/信息类提示的存活时间：与 .dshpm-noticeTimer 的动画时长必须一致。 */
    var NOTICE_DISMISS_MS = 4600;
    /** 退场动画时长：与 .dshpm-notice[data-open="false"] 的 transition 时长一致。 */
    var NOTICE_CLOSE_MS = 200;
    var PAGE_SIZE = 24;
    var MAX_QUERY_LENGTH = 128;

    // ───────────────────────────── 文案（zh / en 同一套 key） ─────────────────────────────
    var STRINGS = {
      zh: {
        "market.title": "插件市场",
        "market.subtitle": "浏览、安装并管理 DSH 插件",
        "market.version": "版本 {version}",
        "market.catalogMeta": "{count} 个插件 · 目录更新于 {updated}",
        "market.catalogMetaUnknown": "目录共 {count} 个插件",
        "market.entry.aria": "打开插件市场",
        "market.entry.disabled": "布局服务不可用，暂时无法打开市场",
        "tab.discover": "发现",
        "tab.installed": "已安装",
        "tab.updates": "可更新",
        "action.refresh": "刷新目录",
        "action.refreshing": "刷新中…",
        "action.retry": "重试",
        "action.install": "安装",
        "action.installing": "安装中…",
        "action.installed": "已安装",
        "action.update": "更新到 {version}",
        "action.updating": "更新中…",
        "action.uninstall": "卸载",
        "action.uninstalling": "卸载中…",
        "action.confirmUninstall": "确认卸载",
        "action.cancel": "取消",
        "action.details": "详情",
        "action.hideDetails": "收起",
        "action.enable": "启用",
        "action.disable": "停用",
        "action.working": "处理中…",
        "action.copy": "复制",
        "action.copied": "已复制",
        "action.copyFailed": "复制失败，请手动选中命令",
        "action.firstPage": "第一页",
        "action.clear": "清空",
        "action.goDiscover": "去发现页",
        "search.placeholder": "搜索插件名、作者或描述…",
        "search.label": "搜索插件",
        "filter.category": "分类",
        "filter.all": "全部",
        "filter.sort": "排序",
        "sort.top": "热门",
        "sort.new": "最新",
        "sort.downloads": "下载最多",
        "sort.name": "名称",
        "list.summary": "共 {total} 个结果 · 第 {page}/{pages} 页",
        "list.summaryEmpty": "没有结果",
        "list.updating": "正在更新…",
        "list.empty.title": "没有匹配的插件",
        "list.empty.body": "换个关键词、清空分类筛选，或刷新目录后重试。",
        "list.empty.action": "清空搜索与筛选",
        "list.notInstallable": "目录没有给出安装来源，无法安装",
        "pager.label": "分页",
        "pager.prev": "上一页",
        "pager.next": "下一页",
        "pager.indicator": "第 {page}/{pages} 页",
        "state.loadingCatalog": "正在加载插件目录…",
        "state.loadingInstalled": "正在读取已安装插件…",
        "state.loadingHint": "首次加载要从目录源抓取数据，通常需要一两秒。",
        "catalog.stale.title": "目录数据可能已过期",
        "catalog.stale.body": "目录源上次抓取失败（{reason}），下面显示的是 {updated} 的缓存。安装前建议先刷新目录。",
        "catalog.stale.noReason": "原因未知",
        "catalog.stale.refresh": "刷新目录",
        "readonly.title": "只读模式",
        "readonly.body": "宿主没有提供插件管理服务（pluginManager），因此只能浏览。请在桌面版 DSH 中使用本页，或在终端执行 dsh plugin 命令。",
        "status.error.title": "无法读取宿主状态",
        "status.error.body": "市场仍可浏览目录，但无法确认宿主是否支持安装。",
        "installed.empty.title": "没有可管理的插件",
        "installed.empty.body": "这个 profile 还没有装过市场目录里的插件。去发现页看看，或先在终端安装一个。",
        "installed.count": "{count} 个已安装包",
        "installed.rows": "{count} 个装载行",
        "installed.plugins": "运行中的插件条目",
        "installed.noPlugins": "没有运行中的插件条目",
        "installed.fiber": "状态：{phase}",
        "installed.rowError": "宿主报告：{message}",
        "installed.notRemovable": "这个包不允许卸载",
        "installed.self": "市场不能卸载自己；请在终端执行 dsh plugin remove deepseek-harness-market",
        "installed.detail": "展开详情",
        "installed.more": "收起详情",
        "badge.official": "官方",
        "badge.market": "本插件",
        "badge.disabled": "已停用",
        "badge.update": "有更新",
        "badge.error": "装载失败",
        "fiber.pending": "等待装载",
        "fiber.loading": "装载中",
        "fiber.active": "运行中",
        "fiber.failed": "装载失败",
        "fiber.unloading": "卸载中",
        "fiber.unknown": "未知",
        "readonlyReason.management-required": "由宿主基础设施管理，市场不能开关或卸载",
        "readonlyReason.unaddressable": "宿主无法定位这个包，市场不能操作它",
        // 宿主的 READ_ONLY_CODES 有三个码（management-required / unaddressable / not-removable），
        // 少这一个会让 t() 返回原始 key；而且下面 `hostReason === hostReasonKey` 会把「查不到文案」
        // 当成「没有原因」→ 开关被解锁，但宿主其实会 400 拒绝（v1.2.0 补）。
        "readonlyReason.not-removable": "这个包不允许卸载，市场不能操作它",
        "installed.noEntryId": "宿主没给出这个条目的 id，无法在这里开关",
        "updates.staleFailure": "下面这份列表是上次读到的，这次读取失败：{reason}",
        "pending.title": "该插件需要执行构建脚本",
        "pending.body": "安装 {name} 前，包管理器要执行这些构建脚本：{builds}。它们会在你的机器上运行。确认后市场会带着你的批准重新提交安装。",
        "pending.approve": "允许并安装",
        "pending.cancel": "取消安装",
        "notice.installApplied": "已安装 {name}",
        "notice.installRestart": "已安装 {name}，重启 DSH 后生效",
        "notice.installOverridden": "已安装 {name}，但 profile 配置的覆盖层优先",
        "notice.installCancelled": "{name} 的安装已取消",
        "notice.installWarnings": "安装完成，但有提示：{warnings}",
        "notice.removeApplied": "已卸载 {name}",
        "notice.removeRestart": "已卸载 {name}，重启 DSH 后生效",
        "notice.removeCancelled": "{name} 的卸载已取消",
        "notice.toggleEnabled": "已启用 {name}",
        "notice.toggleCancelled": "{name} 的开关已取消",        "notice.toggleDisabled": "已停用 {name}",
        "notice.toggleRestartOn": "已启用 {name}，重启 DSH 后生效",
        "notice.toggleRestartOff": "已停用 {name}，重启 DSH 后生效",
        "notice.toggleOverriddenOn": "已写入 {name} 的启用设置，但 profile 配置的覆盖层优先，实际没有启用",
        "notice.toggleOverriddenOff": "已写入 {name} 的停用设置，但 profile 配置的覆盖层优先，实际没有停用",
        "notice.refreshOk": "已刷新 {count} 个插件",
        "notice.noChange": "本次操作没有产生变更（宿主可能正在执行同一操作）",
        "notice.buildsPending": "{name} 需要先执行构建脚本，请在下方确认条里批准",
        "notice.buildsStillPending": "构建脚本仍未获批准：{builds}。确认条已重新出现，请再点一次「允许并安装」；仍不行就编辑 profile 的 pnpm-workspace.yaml，在 allowBuilds 里把这些包设为 true。",
        "notice.buildsApproved": "已批准构建脚本，正在继续安装 {name}",
        "notice.selfUpdateFailed": "插件市场更新失败（目标 v{version}）。没有改动已生效；稍后重试，或在终端按 Release 页面的命令升级。",
        "notice.selfUpdateCancelled": "插件市场更新已取消（目标 v{version}）。",
        "error.label.what": "发生了什么",
        "error.label.why": "为什么",
        "error.label.next": "现在怎么办",
        "error.label.detail": "服务端说明",
        "error.label.hint": "建议",
        "err.unknown.title": "请求没有完成",
        "err.unknown.why": "市场接口返回了没有预期的结果。",
        "err.unknown.next": "点「重试」；若持续失败，请查看宿主日志。",
        "err.file-locked.title": "插件文件被占用",
        "err.file-locked.why": "运行中的 DSH 占着这个插件的文件，pnpm 换不了目录（EPERM / 拒绝访问）。",
        "err.file-locked.next": "完全退出 DSH（含托盘），重新打开后再点更新；若仍失败，说明该插件目录已损坏，先卸载再安装。",
        "err.file-locked.row": "文件被 DSH 占用，退出后重试",
        "err.registry-unreachable.title": "连不上 npm 源，下载被中断",
        "err.registry-unreachable.why": "pnpm 在拉包时连不上它配置的 npm 源（registry.npmjs.org 在国内经常超时或被重置）。浏览目录走的是镜像，所以「能看能点、一下载就失败」正是这个现象——两件事走的不是同一条通道。",
        "err.registry-unreachable.next": "给这个 profile 配一个可用的镜像：在 profile 目录（DSH_HOME/profiles/<profile>，Windows 上通常是 %USERPROFILE%\\.dsh\\profiles\\<profile>）新建 .npmrc，写一行 registry=https://registry.npmmirror.com；然后完全退出 DSH（含托盘）再重试。",
        "err.registry-unreachable.row": "npm 源连不上，配镜像后重试",
        "err.supply-chain.title": "被供应链策略拦下了（不是网络问题）",
        "err.supply-chain.why": "pnpm 11 默认开了 24 小时冷静期：lockfile 里有包是 24 小时内刚发布的，它按安全策略拒绝整个 lockfile。日志末尾那几行 UND_ERR_DESTROYED / 「Will retry」是**结果不是原因**——校验一失败 pnpm 就放弃下载了。所以配镜像、换源都不会好。",
        "err.supply-chain.next": "要么等那个包满 24 小时后再更新；要么在 profile 目录的 pnpm-workspace.yaml 里把它加进 minimumReleaseAgeExclude（例如写 - dsh-context@0.65.0）。注意 pnpm 只认**第一个**同名规则（匹配到就 return），而且它自己会把触发的版本**追加到列表末尾**——所以「同一个包写多条精确版本」或「写一条版本并集」都只能在当次生效，下次它一追加又会被第一条挡住。要给一个会随 caret 范围升版的包长期豁免，就写**裸包名**（`- dsh-context`，放行它的所有版本），那才是不会被追加破坏的写法。改完完全退出 DSH 再重试。",
        "err.supply-chain.row": "被 24 小时发布冷静期拦下，见说明",
        "err.network.title": "无法连接宿主的市场接口",
        "err.network.why": "浏览器到本地宿主的请求失败，宿主可能已退出或连接被拦截。",
        "err.network.next": "确认 DSH 窗口仍在运行，然后点「重试」。",
        "err.no-fetch.title": "当前环境不支持 fetch",
        "err.no-fetch.why": "浏览器没有提供请求接口，市场无法读取目录。",
        "err.no-fetch.next": "请在 DSH 桌面版或新版浏览器中打开本页。",
        "err.badResponse.title": "宿主返回了无法识别的响应",
        "err.badResponse.why": "接口返回的不是市场约定的 JSON（HTTP {status}），可能被代理或旧版本宿主拦截。",
        "err.badResponse.next": "点「重试」；若持续失败，重启 DSH 或检查是否有反向代理。",
        "err.catalog-unavailable.title": "插件目录暂时不可用",
        "err.catalog-unavailable.why": "目录源没有可用缓存，本次抓取也失败了。",
        "err.catalog-unavailable.next": "稍后点「刷新目录」重试，并确认这台机器能访问 awesome-dsh-plugin.com。",
        "err.catalog-timeout.title": "目录源响应超时",
        "err.catalog-timeout.why": "目录源没有按时响应（镜像约 15 秒、官方源约 30 秒）。",
        "err.catalog-timeout.next": "稍后点「刷新目录」重试；其它功能不受影响。",
        "err.manager-unavailable.title": "宿主没有插件管理服务",
        "err.manager-unavailable.why": "当前 DSH 运行环境没有提供 pluginManager，市场不能安装或卸载插件。",
        "err.manager-unavailable.next": "在桌面版 DSH 里使用本页，或在终端执行 dsh plugin --profile <profile> add <包名>。",
        "err.not-in-catalog.title": "这个插件不在目录内",
        "err.not-in-catalog.why": "出于安全考虑，市场只允许安装目录里列出的插件。",
        "err.not-in-catalog.next": "选择目录内的插件，或在终端手动安装该包。",
        "err.install-failed.title": "安装没有完成",
        "err.install-failed.why": "宿主在执行安装时失败，通常是包名不存在、网络不可达或版本不兼容。",
        "err.install-failed.next": "看下面的服务端说明，修正后点「重试」，也可以在终端手动安装。",
        "err.remove-failed.title": "卸载没有完成",
        "err.remove-failed.why": "宿主在移除这个包时失败，可能有进程正在使用它。",
        "err.remove-failed.next": "关闭正在使用它的会话或窗口后重试，或在终端执行 dsh plugin remove。",
        "err.toggle-failed.title": "启用状态没有改变",
        "err.toggle-failed.why": "宿主没有完成这次开关操作。",
        "err.toggle-failed.next": "点「重试」；如果这一条由宿主管理，请在设置页操作。",
        "err.not-allowed.title": "这个操作被宿主拒绝",
        "err.not-allowed.why": "该插件由宿主基础设施管理，不能在市场里开关或卸载。",
        "err.not-allowed.next": "按下面的服务端说明，在终端或设置页处理。",
        "err.cross-origin.title": "请求被跨站保护拒绝",
        "err.cross-origin.why": "市场接口只接受来自本页面的请求。",
        "err.cross-origin.next": "在本页内重试；不要用其它站点或脚本调用这个接口。",
        "err.bad-request.title": "请求参数不被接受",
        "err.bad-request.why": "市场发出的参数和宿主预期不一致。",
        "err.bad-request.next": "重试一次；如果仍然失败，可能是插件与宿主版本不匹配，请更新 deepseek-harness-market。",
        "err.method-not-allowed.title": "请求方法不被允许",
        "err.method-not-allowed.why": "这个地址不接受当前的请求方式，通常说明宿主的市场路由版本较旧。",
        "err.method-not-allowed.next": "重启 DSH，让插件与宿主一起加载，然后重试。",
        "err.not-found.title": "市场接口不存在",
        "err.not-found.why": "宿主没有注册 /plugin-market 路由，插件可能没有装载成功。",
        "err.not-found.next": "检查插件是否已启用，然后重启 DSH。",
        "err.internal.title": "宿主内部出错",
        "err.internal.why": "市场路由在服务端抛出了异常。",
        "err.internal.next": "点「重试」；持续失败请查看宿主日志。",
        "err.restart-failed.title": "重启没能开始",
        "err.restart-failed.why": "宿主没能启动重启助手，DSH 还在原来的进程里（没有半途退出）。",
        "err.restart-failed.next": "看宿主日志里 deepseek-harness-market 的记录；仍不行就手动重启 DSH。",
        // v1.2.0：桌面端一键重启**必然失败**（壳持有单实例锁，替代进程会被挡下并静默退出，
        // 结果是应用整个关掉且不会自己回来）。这不是「重启失败」，是「这个环境不支持」，
        // 所以给一套单独的、说清正确入口的文案。
        "err.restart-unsupported.title": "桌面版不能用一键重启",
        "err.restart-unsupported.why": "当前宿主是桌面壳启动的子进程，壳自己持有应用的单实例锁——从这里拉起的替代进程会被锁直接挡下、然后静默退出，结果是整个应用关掉且不会自己回来。",
        "err.restart-unsupported.next": "用桌面壳自己的入口重启：关掉应用窗口再打开即可；或按页面提示手动重启 DSH。",
        "err.aborted.title": "请求已取消",
        "err.aborted.why": "你切换了页签或开始了新的搜索，之前的请求不再需要。",
        "err.aborted.next": "无需处理，重新操作即可。",
        "capability.fs-read": "读取文件",
        "capability.fs-write": "写入文件",
        "capability.network": "网络访问",
        "capability.env": "环境变量",
        "capability.shell": "执行命令",
        "capability.credentials": "访问凭据",
        "capability.llm": "调用模型",
        "capability.host-runtime": "宿主运行时",
        "capability.dynamic-code": "动态代码",
        "capability.subagent": "子代理",
        "capability.other": "其它能力",
        "detail.description": "说明",
        "detail.capabilities": "能力",
        "detail.links": "链接",
        "detail.repo": "代码仓库",
        "detail.page": "目录页",
        "detail.command": "安装命令",
        "detail.version": "版本",
        "detail.added": "收录时间",
        "meta.stars": "★ {count}",
        "meta.downloads": "↓ {count}",
        "action.checkUpdates": "检查更新",
        "action.checkSelf": "插件市场更新",
        "action.checkingSelf": "正在更新…",
        "action.recheckSelf": "重新检查",
        // 右边那颗的就绪态：不能和左边的「重新检查」同文案——两颗黑按钮写一样的字会分不清。
        "action.recheckSelfOnly": "再次检查",
        // 装完的短暂成功态：装完按钮会跳回「插件市场更新」，用户看不到「装好了」这一步。
        "action.selfDone": "更新成功",
        "action.updateSelf": "更新到 {version}",
        "action.updatingSelf": "正在更新…",
        "action.updateAllCount": "一键更新（{count}）",
        "action.updatingAll": "更新中…",
        "self.available": "发现新版本 v{version}",
        "self.linkNote": "安装会把本机的 link: 依赖替换为下载并校验过的本地包；要回到开发目录，再把这个路径 add 回来。",
        "updates.title": "可更新的插件",
        "updates.entryBadge": "{count} 个插件可更新",
        "updates.subtitle": "已安装 {installed} 个 · {count} 个有新版本",
        "updates.subtitleEmpty": "已安装 {installed} 个 · 全部最新",
        "updates.batchProgress": "一键更新中 {done}/{total}…",
        "updates.hint": "逐个确认更稳（一次只改动一个依赖）；「一键更新」按顺序逐个跑，失败不影响其余。",
        "updates.loading": "正在读取已安装列表…",
        "updates.empty.title": "全部都是最新",
        "updates.empty.body": "已安装的插件都没有可用更新。目录数据更新于 {updated}。",
        "updates.failed.title": "拿不到可更新列表",
        "updates.failed.body": "读取已安装列表失败：{reason}。稍后重试。",
        "updates.noCatalog.title": "目录还没就绪",
        "updates.noCatalog.body": "要判断有没有新版本，得先把目录读进来：点「刷新目录」后重试。",
        "updates.failed": "{name} 更新失败",
        "notice.updatesFound": "{count} 个插件有新版本。",
        "notice.updateAllStart": "开始更新 {count} 个插件…",
        "notice.updateAllDone": "更新完成：成功 {ok}、失败 {fail}。",
        "notice.updateAllNone": "没有需要更新的插件。",
        "notice.installBusy": "{name} 正在装/更新，已跳过。",
        // 激活校验（v1.1.7）：宿主装完会回读一次列表，这里如实转述「东西到底落地了没」。
        // 以前一律写「已安装 {name}」——而宿主说 applied 也可能是「装进了 node_modules，
        // 但 profile 的 bundle 列表里从来没有它」，用户看到绿色回执、插件却永远不出现。
        "notice.installLive": "已安装 {name}，并已在运行。",
        "notice.installLiveMismatch": "已安装 {name}，但它实际是 v{installed}（目录里写的是 v{expected}）——可能源同步滞后，重启后再确认。",
        "notice.installInert": "装完了，但 {name} 没有出现在插件的装载列表里：它可能不是一个 bundle 包（只是普通 npm 包装上了）。",
        "notice.installBroken": "{name} 装上了，但宿主报告它装载失败。展开它看服务端说明，或先停用再排查。",
        "notice.installDisabled": "{name} 装上了，但处于停用状态；在「已安装」页把它启用。",
        "notice.installUnknown": "已安装 {name}，但这次没能回读装载状态，无法确认它是否已经在跑。",
        "notice.updatesNone": "全部都是最新版本。",
        "notice.selfFound": "插件市场有新版本 v{version}：点「更新到 {version}」安装。",
        "notice.selfCurrent": "插件市场已是最新（v{version}）。",
        "notice.selfUpdated": "插件市场已更新到 v{version}；重启 DSH 后新代码才生效。",
        "notice.selfNeedsRestart": "这个按钮要新的宿主半：请重启一次 DSH 再试（客户端半已经生效，宿主半还在进程里缓存着）。",
        "notice.restartQueued": "DSH 正在重启；宿主回来后页面会自动恢复。",
        "notice.restartTimeout": "等了一会儿宿主还没回来：手动刷新页面确认，仍不行就自己重启一次 DSH。",
        "restart.bannerTitle": "有改动待重启生效",
        "restart.bannerBody": "更新（插件或市场自更新）已经把新代码写到磁盘，但宿主进程还在跑旧代码。点「重启 DSH」让新代码生效。",
        "restart.manualBody": "更新已经把新代码写到磁盘，但宿主进程还在跑旧代码。桌面版不能用一键重启（壳持有应用的单实例锁，从这里拉起的进程会被挡下）：请关掉应用窗口再打开，新代码就会生效。",
        "restart.title": "立刻重启 DSH：正在流式输出的回复会被截断；桌面上应用窗口会重新打开。",
        "restart.busy": "有写操作正在进行（安装 / 更新 / 开关），等它结束再重启——否则那一次改动可能只落了一半。",
        "action.restart": "重启 DSH",
        "action.restarting": "正在重启…",
        // 重启询问弹窗（v1.2.0）：装完之后主动问一次「现在重启还是等会儿」，
        // 而不是让用户自己去横幅上找那颗按钮。默认「稍后」——重启会截断正在流的回复，
        // 不能把破坏性动作做成默认项。
        "restartAsk.title": "重启 DSH 才能让新代码生效",
        "restartAsk.body": "已装好：{names}。宿主进程还在跑旧代码，重启后这些改动才会生效。",
        "restartAsk.bodyMarket": "插件市场本身已更新到 v{version}。重启后新代码才会生效。",
        "restartAsk.now": "立即重启",
        "restartAsk.later": "稍后重启",
        "restartAsk.hint": "重启会截断正在流式输出的回复；「稍后重启」后可从顶部横幅随时重启。",
        "restartAsk.restarting": "正在重启 DSH，稍候页面会自己恢复…",
        "restartAsk.listMore": "等 {count} 个",
        "err.self-update-unavailable.title": "更新通道没有回应",
        "err.self-update-unavailable.why": "jsDelivr 与 GitHub 三个源都没给出可用版本，这台机器可能访问不了它们。",
        "err.self-update-unavailable.next": "稍后重试；也可在终端用 dsh plugin add <Release 附件地址> 手动升级。",
        "err.self-update-integrity.title": "产物校验没通过",
        "err.self-update-integrity.why": "下载到的 tarball 与发布清单对不上（长度、sha256，或它自报的包名/版本不符），已拒绝安装。",
        "err.self-update-integrity.next": "重试一次；仍失败说明发布产物与清单不一致，请到仓库提 issue。",
        "err.self-update-download.title": "下载发布产物失败",
        "err.self-update-download.why": "CDN 在传输中断开或超时，没有拿到完整字节。",
        "err.self-update-download.next": "稍后重试；也可在终端用 dsh plugin add <Release 附件地址> 手动升级。"
      },
      en: {
        "market.title": "Plugin Market",
        "market.subtitle": "Browse, install, and manage DSH plugins",
        "market.version": "Version {version}",
        "market.catalogMeta": "{count} plugins · catalog updated {updated}",
        "market.catalogMetaUnknown": "{count} plugins in the catalog",
        "market.entry.aria": "Open the plugin market",
        "market.entry.disabled": "The layout service is unavailable, so the market cannot open",
        "tab.discover": "Discover",
        "tab.installed": "Installed",
        "tab.updates": "Updates",
        "action.refresh": "Refresh catalog",
        "action.refreshing": "Refreshing…",
        "action.retry": "Retry",
        "action.install": "Install",
        "action.installing": "Installing…",
        "action.installed": "Installed",
        "action.update": "Update to {version}",
        "action.updating": "Updating…",
        "action.uninstall": "Uninstall",
        "action.uninstalling": "Uninstalling…",
        "action.confirmUninstall": "Confirm uninstall",
        "action.cancel": "Cancel",
        "action.details": "Details",
        "action.hideDetails": "Hide details",
        "action.enable": "Enable",
        "action.disable": "Disable",
        "action.working": "Working…",
        "action.copy": "Copy",
        "action.copied": "Copied",
        "action.copyFailed": "Copy failed; select the command manually",
        "action.firstPage": "First page",
        "action.clear": "Clear",
        "action.goDiscover": "Go to Discover",
        "search.placeholder": "Search name, author, or description…",
        "search.label": "Search plugins",
        "filter.category": "Category",
        "filter.all": "All",
        "filter.sort": "Sort",
        "sort.top": "Popular",
        "sort.new": "Newest",
        "sort.downloads": "Most downloaded",
        "sort.name": "Name",
        "list.summary": "{total} results · page {page}/{pages}",
        "list.summaryEmpty": "No results",
        "list.updating": "Updating…",
        "list.empty.title": "No matching plugins",
        "list.empty.body": "Try another keyword, clear the category filter, or refresh the catalog.",
        "list.empty.action": "Clear search and filters",
        "list.notInstallable": "The catalog lists no install source for it",
        "pager.label": "Pagination",
        "pager.prev": "Previous",
        "pager.next": "Next",
        "pager.indicator": "Page {page}/{pages}",
        "state.loadingCatalog": "Loading the plugin catalog…",
        "state.loadingInstalled": "Reading installed plugins…",
        "state.loadingHint": "The first load fetches the catalog; it usually takes a second or two.",
        "catalog.stale.title": "Catalog data may be out of date",
        "catalog.stale.body": "The last catalog fetch failed ({reason}), so this is the cache from {updated}. Refresh the catalog before installing.",
        "catalog.stale.noReason": "reason unknown",
        "catalog.stale.refresh": "Refresh catalog",
        "readonly.title": "Read-only mode",
        "readonly.body": "The host provides no pluginManager service, so browsing is all the market can do. Use this page in the DSH desktop app, or run dsh plugin in a terminal.",
        "status.error.title": "Cannot read host status",
        "status.error.body": "The market can still browse the catalog, but cannot tell whether installing is supported.",
        "installed.empty.title": "No manageable plugins",
        "installed.empty.body": "This profile has no plugins from the market catalog yet. Check Discover, or install one in a terminal first.",
        "installed.count": "{count} installed packages",
        "installed.rows": "{count} load rows",
        "installed.plugins": "Running plugin entries",
        "installed.noPlugins": "No running plugin entries",
        "installed.fiber": "Status: {phase}",
        "installed.rowError": "Host reports: {message}",
        "installed.notRemovable": "This package cannot be removed",
        "installed.self": "The market cannot remove itself; run dsh plugin remove deepseek-harness-market in a terminal",
        "installed.detail": "Show details",
        "installed.more": "Hide details",
        "badge.official": "Official",
        "badge.market": "This plugin",
        "badge.disabled": "Disabled",
        "badge.update": "Update available",
        "badge.error": "Load failed",
        "fiber.pending": "Pending",
        "fiber.loading": "Loading",
        "fiber.active": "Active",
        "fiber.failed": "Failed",
        "fiber.unloading": "Unloading",
        "fiber.unknown": "Unknown",
        "readonlyReason.management-required": "Managed by host infrastructure; the market cannot toggle or remove it",
        "readonlyReason.unaddressable": "The host cannot address this package, so the market cannot change it",
        "readonlyReason.not-removable": "This package cannot be removed, so the market cannot change it",
        "installed.noEntryId": "The host did not provide an id for this entry, so it cannot be toggled here",
        "updates.staleFailure": "This list was read earlier; the latest read failed: {reason}",
        "pending.title": "This plugin needs install scripts",
        "pending.body": "Before installing {name}, the package manager wants to run these install scripts: {builds}. They run on your machine. Approve to resubmit the install with your approval.",
        "pending.approve": "Allow and install",
        "pending.cancel": "Cancel install",
        "notice.installApplied": "Installed {name}",
        "notice.installRestart": "Installed {name}; restart DSH to apply",
        "notice.installOverridden": "Installed {name}, but a profile override takes precedence",
        "notice.installCancelled": "The install of {name} was cancelled",
        "notice.installWarnings": "Installed, with warnings: {warnings}",
        "notice.removeApplied": "Removed {name}",
        "notice.removeRestart": "Removed {name}; restart DSH to apply",
        "notice.removeCancelled": "The removal of {name} was cancelled",
        "notice.toggleEnabled": "Enabled {name}",
        "notice.toggleCancelled": "The toggle of {name} was cancelled",
        "notice.toggleDisabled": "Disabled {name}",
        "notice.toggleRestartOn": "Enabled {name}; restart DSH to apply",
        "notice.toggleRestartOff": "Disabled {name}; restart DSH to apply",
        "notice.toggleOverriddenOn": "Wrote the enable setting for {name}, but a profile override takes precedence, so it is not actually enabled",
        "notice.toggleOverriddenOff": "Wrote the disable setting for {name}, but a profile override takes precedence, so it is not actually disabled",
        "notice.refreshOk": "Refreshed: {count} plugins",
        "notice.noChange": "This operation made no change (the host may already be running it)",
        "notice.buildsPending": "{name} needs install scripts first; approve them in the banner below",
        "notice.buildsStillPending": "Install scripts remain unapproved: {builds}. The approval banner is back — click \"Allow and install\" once more; if it still fails, set these packages to true under allowBuilds in the profile's pnpm-workspace.yaml.",
        "notice.buildsApproved": "Build scripts approved; continuing the install of {name}",
        "notice.selfUpdateFailed": "The plugin market update failed (target v{version}). Nothing took effect; retry later, or upgrade in a terminal with the command from the release page.",
        "notice.selfUpdateCancelled": "The plugin market update was cancelled (target v{version}).",
        "error.label.what": "What happened",
        "error.label.why": "Why",
        "error.label.next": "What to do now",
        "error.label.detail": "Server message",
        "error.label.hint": "Suggestion",
        "err.unknown.title": "The request did not complete",
        "err.unknown.why": "The market endpoint returned an unexpected result.",
        "err.unknown.next": "Retry; if it keeps failing, check the host log.",
        "err.file-locked.title": "Plugin files are in use",
        "err.file-locked.why": "The running DSH holds this plugin's files open, so pnpm cannot replace the directory (EPERM / access denied).",
        "err.file-locked.next": "Quit DSH completely (including the tray), reopen it and update again; if it still fails, the plugin directory is damaged — uninstall and reinstall it.",
        "err.file-locked.row": "In use by DSH — quit and retry",
        "err.registry-unreachable.title": "Cannot reach the npm registry",
        "err.registry-unreachable.why": "pnpm could not reach the npm registry it is configured with while downloading (registry.npmjs.org frequently times out or is reset from some networks). The catalog is fetched through a mirror, which is why browsing and clicking work but the download fails — they do not use the same channel.",
        "err.registry-unreachable.next": "Configure a working mirror for this profile: create .npmrc in the profile directory (DSH_HOME/profiles/<profile>, typically %USERPROFILE%\\.dsh\\profiles\\<profile> on Windows) containing registry=https://registry.npmmirror.com, then quit DSH completely (including the tray) and retry.",
        "err.registry-unreachable.row": "npm registry unreachable — configure a mirror",
        "err.supply-chain.title": "Blocked by a supply-chain policy (not a network problem)",
        "err.supply-chain.why": "pnpm 11 enforces a 24-hour release cool-off by default: the lockfile contains a package published less than 24 hours ago, so pnpm rejects the whole lockfile as a safety policy. The trailing UND_ERR_DESTROYED / \"Will retry\" lines are a consequence, not the cause — pnpm abandons the download once verification fails. So configuring a mirror or switching registries will not help.",
        "err.supply-chain.next": "Either wait for that package to age past 24 hours, or add it to minimumReleaseAgeExclude in the profile's pnpm-workspace.yaml (e.g. `- dsh-context@0.65.0`). Note that pnpm honours only the FIRST rule for a given name (it returns on the first match) and it also appends the triggering version to the END of the list — so several exact-version rules, or a single version-union rule, only work once: the next append is shadowed by the first match again. To exempt a package permanently when it is specified with a caret range, use the bare name (`- dsh-context`, allowing all its versions); that form cannot be broken by a later append. Quit DSH completely after changing it, then retry.",
        "err.supply-chain.row": "Blocked by the 24-hour release cool-off — see details",
        "err.network.title": "Cannot reach the host market endpoint",
        "err.network.why": "The request from the browser to the local host failed; the host may have exited or the connection is blocked.",
        "err.network.next": "Make sure the DSH window is still running, then retry.",
        "err.no-fetch.title": "This environment has no fetch",
        "err.no-fetch.why": "The browser exposes no request API, so the market cannot read the catalog.",
        "err.no-fetch.next": "Open this page in the DSH desktop app or a current browser.",
        "err.badResponse.title": "The host returned an unrecognized response",
        "err.badResponse.why": "The endpoint did not return the market's JSON (HTTP {status}); a proxy or an older host may be intercepting it.",
        "err.badResponse.next": "Retry; if it keeps failing, restart DSH or check for a reverse proxy.",
        "err.catalog-unavailable.title": "The plugin catalog is temporarily unavailable",
        "err.catalog-unavailable.why": "No cached catalog exists and this fetch failed too.",
        "err.catalog-unavailable.next": "Retry with Refresh catalog in a moment, and check that this machine can reach awesome-dsh-plugin.com.",
        "err.catalog-timeout.title": "The catalog source timed out",
        "err.catalog-timeout.why": "The catalog source did not respond in time (about 15 seconds for a mirror, 30 for the official source).",
        "err.catalog-timeout.next": "Retry with Refresh catalog later; nothing else is affected.",
        "err.manager-unavailable.title": "The host has no plugin management service",
        "err.manager-unavailable.why": "This DSH runtime provides no pluginManager, so the market cannot install or remove plugins.",
        "err.manager-unavailable.next": "Use this page in the DSH desktop app, or run dsh plugin --profile <profile> add <package> in a terminal.",
        "err.not-in-catalog.title": "This plugin is not in the catalog",
        "err.not-in-catalog.why": "For safety the market only installs plugins listed in the catalog.",
        "err.not-in-catalog.next": "Pick a catalog plugin, or install this package manually in a terminal.",
        "err.install-failed.title": "The install did not finish",
        "err.install-failed.why": "The host failed while installing, usually because the package is missing, the network is unreachable, or the version is incompatible.",
        "err.install-failed.next": "Read the server message below, fix it, then retry, or install manually in a terminal.",
        "err.remove-failed.title": "The removal did not finish",
        "err.remove-failed.why": "The host failed to remove the package; something may still be using it.",
        "err.remove-failed.next": "Close the session or window using it and retry, or run dsh plugin remove in a terminal.",
        "err.toggle-failed.title": "The enabled state did not change",
        "err.toggle-failed.why": "The host did not complete this switch operation.",
        "err.toggle-failed.next": "Retry; if the host manages this row, change it on the settings page.",
        "err.not-allowed.title": "The host rejected this operation",
        "err.not-allowed.why": "Host infrastructure manages this plugin, so the market cannot toggle or remove it.",
        "err.not-allowed.next": "Follow the server message below and use a terminal or the settings page.",
        "err.cross-origin.title": "The cross-site guard rejected the request",
        "err.cross-origin.why": "The market endpoint only accepts requests from this page.",
        "err.cross-origin.next": "Retry from this page; do not call the endpoint from another site or script.",
        "err.bad-request.title": "The request parameters were rejected",
        "err.bad-request.why": "The parameters the market sent do not match what the host expects.",
        "err.bad-request.next": "Retry once; if it still fails, the plugin and host versions may not match, so update deepseek-harness-market.",
        "err.method-not-allowed.title": "The request method is not allowed",
        "err.method-not-allowed.why": "This address does not accept the current method, which usually means the host routes are older.",
        "err.method-not-allowed.next": "Restart DSH so plugin and host load together, then retry.",
        "err.not-found.title": "The market endpoint does not exist",
        "err.not-found.why": "The host registered no /plugin-market route, so the plugin may not have loaded.",
        "err.not-found.next": "Check that the plugin is enabled, then restart DSH.",
        "err.internal.title": "The host failed internally",
        "err.internal.why": "The market route threw on the server side.",
        "err.internal.next": "Retry; if it keeps failing, check the host log.",
        "err.restart-failed.title": "The restart did not start",
        "err.restart-failed.why": "The host could not launch the restart helper; DSH is still running its original process (it did not exit halfway).",
        "err.restart-failed.next": "Check the deepseek-harness-market entries in the host log; if it keeps failing, restart DSH yourself.",
        "err.restart-unsupported.title": "One-click restart is unavailable in the desktop app",
        "err.restart-unsupported.why": "This host is a child of the desktop shell, and the shell holds the app's single-instance lock. A replacement launched from here is refused by that lock and exits silently — leaving the whole app closed with nothing to bring it back.",
        "err.restart-unsupported.next": "Restart through the shell itself: close the app window and open it again, or restart DSH manually as the page suggests.",
        "err.aborted.title": "The request was cancelled",
        "err.aborted.why": "You switched tabs or started a new search, so the earlier request is no longer needed.",
        "err.aborted.next": "Nothing to do; just continue.",
        "capability.fs-read": "File read",
        "capability.fs-write": "File write",
        "capability.network": "Network access",
        "capability.env": "Environment variables",
        "capability.shell": "Shell execution",
        "capability.credentials": "Credential access",
        "capability.llm": "Model calls",
        "capability.host-runtime": "Host runtime",
        "capability.dynamic-code": "Dynamic code",
        "capability.subagent": "Subagents",
        "capability.other": "Other capability",
        "detail.description": "Description",
        "detail.capabilities": "Capabilities",
        "detail.links": "Links",
        "detail.repo": "Repository",
        "detail.page": "Catalog page",
        "detail.command": "Install command",
        "detail.version": "Version",
        "detail.added": "Added",
        "meta.stars": "★ {count}",
        "meta.downloads": "↓ {count}",
        "action.checkUpdates": "Check for updates",
        "action.checkSelf": "Plugin market update",
        "action.checkingSelf": "Updating…",
        "action.recheckSelf": "Re-check plugins",
        // Must differ from the left button's "Re-check plugins": two black buttons with the
        // same label are indistinguishable.
        "action.recheckSelfOnly": "Check again",
        // Transient success state: without it the button jumps back to its idle label and the
        // user never sees that the install actually finished.
        "action.selfDone": "Updated",
        "action.updateSelf": "Update to {version}",
        "action.updatingSelf": "Updating…",
        "action.updateAllCount": "Update all ({count})",
        "action.updatingAll": "Updating…",
        "self.available": "New version v{version} available",
        "self.linkNote": "Installing replaces this machine's link: dependency with the verified local package; add the source path back to return to it.",
        "updates.title": "Plugin updates",
        "updates.entryBadge": "{count} plugins can update",
        "updates.subtitle": "{installed} installed · {count} have a newer version",
        "updates.subtitleEmpty": "{installed} installed · all up to date",
        "updates.batchProgress": "Updating {done}/{total}…",
        "updates.hint": "Confirm one at a time (each change touches a single dependency), or use Update all to run them in order — a failure leaves the rest alone.",
        "updates.loading": "Reading installed plugins…",
        "updates.empty.title": "Everything is up to date",
        "updates.empty.body": "No installed plugin has a newer version. Catalog data is from {updated}.",
        "updates.failed.title": "The update list is unavailable",
        "updates.failed.body": "Reading the installed list failed: {reason}. Try again later.",
        "updates.noCatalog.title": "The catalog is not ready",
        "updates.noCatalog.body": "Deciding whether a newer version exists needs the catalog: refresh it and try again.",
        "updates.failed": "{name} failed to update",
        "notice.updatesFound": "{count} plugins have a newer version.",
        "notice.updateAllStart": "Updating {count} plugins…",
        "notice.updateAllDone": "Done: {ok} succeeded, {fail} failed.",
        "notice.updateAllNone": "Nothing to update.",
        "notice.installBusy": "{name} is already installing/updating; skipped.",
        "notice.installLive": "Installed {name}, and it is running.",
        "notice.installLiveMismatch": "Installed {name}, but what landed is v{installed} (the catalog said v{expected}) — the source may be lagging; recheck after a restart.",
        "notice.installInert": "The install finished, but {name} never appeared in the plugin load list: it may not be a bundle package (a plain npm package got installed).",
        "notice.installBroken": "{name} was installed, but the host reports it failed to load. Expand it for the server detail, or disable it and investigate first.",
        "notice.installDisabled": "{name} was installed but is disabled; enable it on the “Installed” tab.",
        "notice.installUnknown": "Installed {name}, but the load state could not be read back, so it is unconfirmed whether it is running.",
        "notice.updatesNone": "All plugins are up to date.",
        "notice.selfFound": "Plugin market v{version} is available: click “Update to {version}”.",
        "notice.selfCurrent": "The plugin market is up to date (v{version}).",
        "notice.selfUpdated": "The plugin market was updated to v{version}; the new code applies after DSH restarts.",
        "notice.selfNeedsRestart": "This button needs the new Host half: restart DSH once and try again (the client half is already live; the Host half is still cached in the running process).",
        "notice.restartQueued": "DSH is restarting; the page recovers on its own once the host is back.",
        "notice.restartTimeout": "The host has not come back yet: refresh the page to check, or restart DSH yourself.",
        "restart.bannerTitle": "Changes pending a restart",
        "restart.bannerBody": "An update (a plugin or the market itself) has written the new code to disk, but the host process is still running the old code. Restart DSH to apply it.",
        "restart.manualBody": "The update has written the new code to disk, but the host process is still running the old code. One-click restart is unavailable in the desktop app (the shell holds the app's single-instance lock, so a process launched from here would be refused): close the app window and open it again to apply the new code.",
        "restart.title": "Restart DSH right now: replies still streaming will be cut off, and the desktop app reopens its window.",
        "restart.busy": "A write is in progress (install / update / toggle). Wait for it to finish before restarting — otherwise that change may only land half-way.",
        "action.restart": "Restart DSH",
        "action.restarting": "Restarting…",
        "restartAsk.title": "Restart DSH so the new code takes effect",
        "restartAsk.body": "Installed: {names}. The host process is still running the old code; the change applies after a restart.",
        "restartAsk.bodyMarket": "The plugin market itself was updated to v{version}. The new code applies after a restart.",
        "restartAsk.now": "Restart now",
        "restartAsk.later": "Restart later",
        "restartAsk.hint": "Restarting cuts off replies that are still streaming; with “Restart later” you can restart any time from the banner at the top.",
        "restartAsk.restarting": "Restarting DSH — this page recovers on its own…",
        "restartAsk.listMore": "and {count} more",
        "err.self-update-unavailable.title": "No update channel answered",
        "err.self-update-unavailable.why": "None of the jsDelivr and GitHub sources returned a usable version; this machine may not reach them.",
        "err.self-update-unavailable.next": "Try again later, or upgrade in a terminal with dsh plugin add <release asset URL>.",
        "err.self-update-integrity.title": "Artifact verification failed",
        "err.self-update-integrity.why": "The downloaded tarball does not match the published manifest (length, sha256, or the name/version it declares), so the install was refused.",
        "err.self-update-integrity.next": "Retry once; if it keeps failing the published artifact and manifest disagree — please open an issue.",
        "err.self-update-download.title": "Downloading the artifact failed",
        "err.self-update-download.why": "The CDN dropped the connection or timed out before the full bytes arrived.",
        "err.self-update-download.next": "Try again later, or upgrade in a terminal with dsh plugin add <release asset URL>."
      }
    };

    // ───────────────────────────── 语言与全局订阅 ─────────────────────────────
    // 组件要跟随宿主语言即时切换，但组件拿不到 ctx，所以语言放在模块级，
    // apply 里把 locale 服务的变化广播给已挂载的组件。
    var ACTIVE_LOCALE = "zh";
    var changeListeners = [];

    function normalizeLocale(value) {
      return String(value || "").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
    }

    function publishChange() {
      var listeners = changeListeners.slice();
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i]();
        } catch (listenerError) {
          // 命名单个订阅者失败：一个组件的问题不能让其余订阅者停在旧语言或旧选中态。
        }
      }
    }

    function subscribeChange(listener) {
      changeListeners.push(listener);
      return function () {
        var at = changeListeners.indexOf(listener);
        if (at >= 0) changeListeners.splice(at, 1);
      };
    }

    function setActiveLocale(value) {
      var next = normalizeLocale(value);
      if (next === ACTIVE_LOCALE) return;
      ACTIVE_LOCALE = next;
      publishChange();
    }

    function detectLocale() {
      try {
        var language = typeof navigator !== "undefined" && navigator.language ? navigator.language : "";
        return String(language).toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
      } catch (detectError) {
        return "zh";
      }
    }

    function t(key, vars) {
      var table = STRINGS[ACTIVE_LOCALE] || STRINGS.zh;
      var value = table[key];
      if (value === undefined) value = STRINGS.zh[key];
      if (value === undefined) return key;
      if (!vars) return value;
      return String(value).replace(/\{(\w+)\}/g, function (match, name) {
        var replacement = vars[name];
        return replacement === undefined || replacement === null ? match : String(replacement);
      });
    }

    // 组件用这个 hook 在语言或入口可用性变化时重渲染。
    function useChangeTick() {
      var state = React.useState(0);
      var bump = state[1];
      React.useEffect(function () {
        return subscribeChange(function () {
          bump(function (n) { return n + 1; });
        });
      }, []);
      return ACTIVE_LOCALE;
    }

    // ───────────────────────────── 格式化 ─────────────────────────────
    function formatCount(value) {
      var number = Number(value);
      if (!isFinite(number)) return value === undefined || value === null ? "" : String(value);
      if (number >= 10000) return (Math.round(number / 100) / 10) + "k";
      return String(number);
    }

    function formatDate(value) {
      return typeof value === "string" && value ? value : "";
    }

    function categoryLabel(categoriesById, id) {
      var entry = categoriesById && categoriesById[id];
      if (!entry) return id || "";
      return (ACTIVE_LOCALE === "en" ? entry.en : entry.zh) || entry.zh || entry.en || id;
    }

    function capabilityLabel(token) {
      var key = "capability." + String(token);
      var label = t(key);
      return label === key ? String(token) : label;
    }

    function descriptionText(description) {
      if (!description) return "";
      if (typeof description === "string") return description;
      if (ACTIVE_LOCALE === "en") return description.en || description.zh || "";
      return description.zh || description.en || "";
    }

    function formatPhaseLabel(phase) {
      if (!phase) return t("fiber.unknown");
      var key = "fiber." + String(phase);
      var label = t(key);
      return label === key ? String(phase) : label;
    }

    // ───────────────────────────── 请求与错误 ─────────────────────────────
    // 错误对象带 code / message / hint：组件按 §1 的三段文案渲染，而不是只显示一句“失败了”。
    function marketError(code, message, hint, extra) {
      var error = new Error(message || t("err.unknown.title"));
      error.name = "MarketError";
      error.code = code || "unknown";
      error.hint = hint || "";
      if (extra) {
        if (extra.diagnostic) error.diagnostic = extra.diagnostic;
        if (extra.status !== undefined) error.status = extra.status;
        if (extra.incompatible !== undefined) error.incompatible = extra.incompatible;
      }
      return error;
    }

    function codeForStatus(status) {
      if (status === 403) return "cross-origin";
      if (status === 404) return "not-found";
      if (status === 405) return "method-not-allowed";
      if (status === 502) return "catalog-unavailable";
      if (status === 504) return "catalog-timeout";
      if (status >= 400 && status < 500) return "bad-request";
      return "internal";
    }

    /**
     * 「正文不是市场约定的 JSON」用哪个错误码。
     *
     * 不能直接复用 codeForStatus：HTTP 200 加上一段 HTML 正文（反向代理、运营商劫持、
     * 登录页）在 codeForStatus 里落到 `internal`，于是错误块说「宿主内部出错 / 看宿主日志」——
     * 明明是被代理拦了。`err.badResponse.*` 三段文案就是为这种情况写的（「可能被代理或
     * 旧版本宿主拦截」），早先却没有任何地方产生 `badResponse` 这个码，成了死文案。
     */
    function codeForBadBody(status) {
      if (status >= 400) return codeForStatus(status);
      return "badResponse";
    }

    /**
     * 把**孤立代理项**（unpaired surrogate）换成 U+FFFD。
     *
     * 为什么必须有：`encodeURIComponent` 遇到孤立代理项会**抛 URIError: URI malformed**。
     * 而 search 框的值来自系统剪贴板——上游程序把 emoji 从中间截断就会留下半个代理对
     * （实测 Edge 里粘贴 `"abc\uD83D"` 会原样进入输入框，`encodeURIComponent` 立刻抛错）。
     * 抛错点在 `commitQueryInput → loadCatalog → catalog useEffect` 里，**没有 try/catch**，
     * 而整个 bundle 也没有 error boundary，于是 React 会把市场面板整棵子树卸载——
     * 用户只是在搜索框里粘贴了一下，市场页就空白了。
     * 孤立代理项在 URL 里本来也无法表示，替换掉比抛错/useless 空白更合理。
     * （普通输入与浏览器 maxlength 不会产生孤立代理项，只有剪贴板/上游数据会。）
     */
    function sanitizeUrlText(value) {
      var text = String(value);
      var needsWork = false;
      for (var i = 0; i < text.length; i += 1) {
        var code = text.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDFFF) {
          // 高代理项必须紧跟着低代理项才成对；否则就是孤立代理项。
          if (code <= 0xDBFF && i + 1 < text.length) {
            var next = text.charCodeAt(i + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) { i += 1; continue; }
          }
          needsWork = true;
          break;
        }
      }
      if (!needsWork) return text;
      var out = "";
      for (var j = 0; j < text.length; j += 1) {
        var unit = text.charCodeAt(j);
        if (unit >= 0xD800 && unit <= 0xDBFF) {
          var low = j + 1 < text.length ? text.charCodeAt(j + 1) : -1;
          if (low >= 0xDC00 && low <= 0xDFFF) { out += text[j] + text[j + 1]; j += 1; continue; }
          out += "\uFFFD";
          continue;
        }
        if (unit >= 0xDC00 && unit <= 0xDFFF) { out += "\uFFFD"; continue; }
        out += text[j];
      }
      return out;
    }

    function appendParam(parts, key, value) {
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(sanitizeUrlText(key)) + "=" + encodeURIComponent(sanitizeUrlText(value)));
    }

    function requestJSON(path, options) {
      var opts = options || {};
      if (typeof fetch !== "function") {
        return Promise.reject(marketError("no-fetch", t("err.no-fetch.title"), t("err.no-fetch.next")));
      }
      var init = {
        method: opts.method || "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store"
      };
      if (opts.signal) init.signal = opts.signal;
      if (opts.body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(opts.body);
      }
      return fetch(API_PREFIX + path, init).then(function (response) {
        return response.text().then(function (raw) {
          var payload = null;
          if (raw) {
            try {
              payload = JSON.parse(raw);
            } catch (parseError) {
              payload = null;
            }
          }
          if (!payload || typeof payload !== "object") {
            var shapeCode = codeForBadBody(response.status);
            throw marketError(
              shapeCode,
              t("err.badResponse.title"),
              t("err." + shapeCode + ".next"),
              { status: response.status }
            );
          }
          if (payload.ok !== true) {
            var info = payload.error && typeof payload.error === "object" ? payload.error : {};
            var code = info.code || codeForStatus(response.status);
            throw marketError(
              code,
              info.message || t("err.unknown.title"),
              info.hint || "",
              { diagnostic: info.diagnostic, status: response.status, incompatible: info.incompatible }
            );
          }
          return payload;
        });
      }, function (cause) {
        if (cause && (cause.name === "AbortError" || cause.code === 20)) {
          var aborted = marketError("aborted", t("err.aborted.title"), t("err.aborted.next"));
          aborted.aborted = true;
          throw aborted;
        }
        throw marketError("network", t("err.network.title"), t("err.network.next"));
      });
    }

    var api = {
      status: function (signal) {
        return requestJSON("/status", { signal: signal });
      },
      catalog: function (params, signal) {
        var parts = [];
        appendParam(parts, "query", params.query);
        appendParam(parts, "category", params.category);
        appendParam(parts, "sort", params.sort);
        appendParam(parts, "page", params.page);
        appendParam(parts, "pageSize", params.pageSize);
        if (params.installed) appendParam(parts, "installed", 1);
        if (params.updates) appendParam(parts, "updates", 1);
        return requestJSON("/catalog" + (parts.length ? "?" + parts.join("&") : ""), { signal: signal });
      },
      installed: function (signal) {
        return requestJSON("/installed", { signal: signal });
      },
      // 写操作不接 signal：中断一个已经发出去的安装只会让宿主状态不明，
      // 组件改为在卸载后忽略结果（mountedRef）。
      install: function (body) {
        return requestJSON("/install", { method: "POST", body: body });
      },
      remove: function (name) {
        return requestJSON("/remove", { method: "POST", body: { name: name } });
      },
      toggle: function (body) {
        return requestJSON("/toggle", { method: "POST", body: body });
      },
      refresh: function (signal) {
        return requestJSON("/refresh", { method: "POST", body: {}, signal: signal });
      },
      selfUpdate: function (force, signal) {
        return requestJSON("/self-update" + (force ? "?force=1" : ""), { signal: signal });
      },
      applySelfUpdate: function () {
        return requestJSON("/self-update", { method: "POST", body: {} });
      },
      restart: function () {
        return requestJSON("/restart", { method: "POST", body: {} });
      }
    };

    function newRequestId() {
      return "pm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    var ERROR_PREFIXES = {
      "network": true,
      "no-fetch": true,
      "badResponse": true,
      "catalog-unavailable": true,
      "catalog-timeout": true,
      "manager-unavailable": true,
      "not-in-catalog": true,
      "install-failed": true,
      "remove-failed": true,
      "toggle-failed": true,
      "not-allowed": true,
      "cross-origin": true,
      "self-update-unavailable": true,
      "self-update-integrity": true,
      "self-update-download": true,
      "restart-failed": true,
      "restart-unsupported": true,
      "bad-request": true,
      "method-not-allowed": true,
      "not-found": true,
      "internal": true,
      "aborted": true
    };

    /**
     * 识别「文件被占用」类失败（EPERM / EACCES / EBUSY / 拒绝访问）。
     * dsh-market 把 pnpm 的 ERR_PNPM_EPERM 归类为 windows-file-locked 并给可操作回执
     * （运行中的宿主占着文件，完全退出后重试）；这里做同样的识别——否则用户只会看到
     * 「宿主执行这个操作时报错」+ 一句「看宿主日志」，而 diagnostic 里的 EPERM 根本没被渲染。
     * @returns 命中时返回诊断原文（用于详情行），未命中返回空串。
     */
    function fileLockedDetail(error) {
      if (!error) return "";
      var pattern = /EPERM|EACCES|EBUSY|operation not permitted|Access is denied|拒绝访问/i;
      var diagnostic = error.diagnostic ? String(error.diagnostic) : "";
      var message = error.message ? String(error.message) : "";
      if (diagnostic && pattern.test(diagnostic)) return diagnostic;
      if (message && pattern.test(message)) return message;
      return "";
    }

    /**
     * 识别「被 pnpm 供应链策略拦下」类失败（v1.2.0 新增）。
     *
     * 为什么必须有：pnpm 11.7 把 `minimum-release-age` 的默认值设成了 1440 分钟
     * （src: dist/pnpm.mjs `"minimum-release-age": 24 * 60`）。lockfile 里只要有**一个**
     * 包是 24 小时内发布的，整个 lockfile 校验就失败并抛
     * ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION——**与 registry 通不通毫无关系**。
     *
     * 真实案例（用户报「dsh-mobile 更新失败」）：profile 的 pnpm-workspace.yaml 里
     * 写了 `dsh-context@0.64.0` 和 `dsh-context@0.65.0` **两条同名规则**，而 pnpm 的
     * evaluateVersionPolicy 匹配到第一个同名规则就 `return`，规则里的精确版本列表
     * 不包含 0.65.0 ⇒ 0.65.0 未被豁免 ⇒ 每次都失败。三条日志全停在
     * 「Will retry … 2 retries left」且以 UND_ERR_DESTROYED 结尾。
     *
     * **这个判定必须优先于 registryUnreachableDetail**：那段日志里同时有
     * `UND_ERR_DESTROYED` 和 `https://registry.npmmirror.com/...`，网络正则照样命中，
     * 于是会被判成「连不上 npm 源」并建议「配镜像」——方向完全错，会让人白折腾。
     * 实测：修复前 errorCopy 对这条真实日志给出 title=连不上源 / next=配镜像。
     *
     * 只认 pnpm 的策略错误码/字样，不认裸词 `lockfile`（太泛）。
     * @returns 命中时返回诊断原文，未命中返回空串。
     */
    function supplyChainDetail(error) {
      if (!error) return "";
      // 命中优先用 ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION；其次认它的人话标题。
      var pattern = /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|failed supply-chain polic|minimumReleaseAge cutoff|MINIMUM_RELEASE_AGE_DENIED|ERR_PNPM_MINIMUM_RELEASE_AGE/i;
      var diagnostic = error.diagnostic ? String(error.diagnostic) : "";
      var message = error.message ? String(error.message) : "";
      if (diagnostic && pattern.test(diagnostic)) return diagnostic;
      if (message && pattern.test(message)) return message;
      return "";
    }

    /**
     * 识别「连不上 npm 源」类失败（pnpm 的网络错误）。
     *
     * 为什么必须有：市场的**目录抓取走镜像**（catalog-npm.js 镜像优先，实测 366ms），
     * 而真正安装是交给宿主 pnpm 的，用的是 pnpm 自己的 registry（默认 registry.npmjs.org）。
     * 两条通道不同，所以会出现最难解释的一种现象：**能浏览、能点安装，一下载就失败**。
     * 真实案例（用户报「装了俩个插件都没成功」）：pnpm 日志里 34 次请求全是
     * registry.npmjs.org、0 次镜像，ECONNRESET / Request took 72331ms 刷满整页，
     * 最后卡在 color-name 的「retry in 1 minute」——而界面上只有一句
     * 「宿主执行这个操作时报错。看宿主日志里的 pnpm 输出」。用户不可能从这句话里
     * 推断出「去配个镜像」。
     *
     * 只认网络类签名，**不**认 EPERM（那是另一个原因，有自己的文案）。
     * @returns 命中时返回诊断原文，未命中返回空串。
     */
    function registryUnreachableDetail(error) {
      if (!error) return "";
      // 只认**具体**的网络签名，不认裸词 `network`/`registry`：
      // 裸词会让「版本不兼容」「包不存在」这类完全不同的失败也被改写文案，那就成了另一种撒谎。
      var pattern = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR|socket hang up|Request took \d+ms|fetch failed|ERR_PNPM_FETCH|ERR_PNPM_META_FETCH/i;
      var diagnostic = error.diagnostic ? String(error.diagnostic) : "";
      var message = error.message ? String(error.message) : "";
      // 文件占用优先：那种诊断里也可能混着 registry 字样，不能被这条抢走。
      if (fileLockedDetail(error) !== "") return "";
      // 供应链策略优先（v1.2.0 修）：策略失败的日志里必然带着 pnpm 放弃下载留下的
      // UND_ERR_DESTROYED / 镜像 URL，网络正则会**误命中**。判成「连不上源」会让用户
      // 去配镜像，而真正的原因在 lockfile 的发布冷静期上，怎么配都不会好。
      if (supplyChainDetail(error) !== "") return "";
      if (diagnostic && pattern.test(diagnostic)) return diagnostic;
      if (message && pattern.test(message)) return message;
      return "";
    }

    /**
     * 行内/短回执用的一句话失败说明：三段式放不下，只给一句能照做的短话。
     * 抽成一个函数是因为**两个调用点原本各写了一遍同样的三元表达式**——那种重复一旦
     * 只改一处，就又是一次「两处规则漂移」（本文件里已经栽过同样的跟头）。
     * 三个判定从具体到笼统：供应链策略 > 占用 > 网络。
     */
    function shortFailureText(error) {
      if (supplyChainDetail(error) !== "") return t("err.supply-chain.row");
      if (fileLockedDetail(error) !== "") return t("err.file-locked.row");
      if (registryUnreachableDetail(error) !== "") return t("err.registry-unreachable.row");
      if (error && error.message) return String(error.message);
      return "";
    }

    /** 目录过期横幅里的「原因」：服务端给的可能是错误码字符串、错误对象或什么都没有。 */
function staleReason(staleSource) {
  var raw = staleSource && staleSource.error;
  if (typeof raw === "string" && raw !== "") return codeLabel(raw);
  if (raw && typeof raw === "object") {
    var text = raw.message || raw.code;
    if (text) return codeLabel(String(text));
  }
  return t("catalog.stale.noReason");
}

/**
 * 把服务端错误码翻成人类能读的一句（拿不到专属文案就原样显示错误码——
 * 「原因未知」会让人没法判断是网络、限流还是源站挂了，宁可显示 `catalog-timeout`）。
 */
function codeLabel(code) {
  var key = "err." + code + ".title";
  var label = t(key);
  return label === key ? code : label + "（" + code + "）";
}

function errorCopy(error) {
      var code = error && error.code ? String(error.code) : "unknown";
      var known = !!ERROR_PREFIXES[code];
      var locked = fileLockedDetail(error);
      // 被 pnpm 供应链策略拦下（24h 发布冷静期）：**优先于一切**（v1.2.0 新增）。
      // 这类失败的日志里必然带着 UND_ERR_DESTROYED / 镜像 URL，网络正则会误命中，
      // 于是给出「配镜像」的错误方向。必须排在 locked 与 unreachable 之前。
      var supply = supplyChainDetail(error);
      // 连不上 npm 源：**优先于** `known`。宿主把它归成 operation-error（因为 pnpm 非 0 退出），
      // 而 operation-error 的通用文案是「看宿主日志里的 pnpm 输出」——对用户没有可操作性。
      // 这个判定也刻意排在 locked 之后（locked 更具体，且诊断里可能混着 registry 字样）。
      var unreachable = locked || supply ? "" : registryUnreachableDetail(error);
      var prefix = supply ? "err.supply-chain"
        : locked ? "err.file-locked"
        : unreachable !== "" ? "err.registry-unreachable"
        : known ? "err." + code : "err.unknown";
      var status = error && error.status !== undefined ? error.status : "";
      var message = error && error.message ? String(error.message) : "";
      var copy = {
        code: code,
        title: t(prefix + ".title", { status: status }),
        // why 也要传 vars：`err.badResponse.why` 里有 {status} 占位符，不传就会把
        // 「HTTP {status}」这段字面量原样渲染给用户。
        why: t(prefix + ".why", { status: status }),
        next: t(prefix + ".next"),
        // 详情行露出**诊断原文**：占用路径一直这么做，网络路径同样需要——
        // 否则用户看到的是宿主的通用句「宿主执行这个操作时报错。」，而不是
        // 「GET https://registry.npmjs.org/... ECONNRESET」这种能直接拿去搜的线索。
        message: supply || locked || unreachable || message,
        hint: error && error.hint ? String(error.hint) : ""
      };
      // 兜底：`known` 之外的未知码把宿主原话塞进 why，避免「原因未知」。
      // **但命中 registry-unreachable 或 supply-chain 时绝不能覆盖**（v1.2.0 修）：
      // 宿主把这两类都归成 `operation-error`，而 `operation-error` **不在** ERROR_PREFIXES 里 →
      // known=false → 这行会把刚选好的专属解释覆盖成宿主的通用句
      // 「宿主执行这个操作时报错。」——那正是 76110d9 要消灭的那句话，等于把那次修复抵消掉。
      // 用真实 errorCopy 实测过：operation-error + ECONNRESET 诊断为
      // why="宿主执行这个操作时报错。"（错），而同样诊断走 install-failed 时 why 正确
      // ——差别只在 known，与是否识别出网络问题无关。
      // **已知码（known）时绝不覆盖**——`err.restart-unsupported.*` 这类专属文案就是被
      // `copy.why = message` 悄悄换掉的（v1.2.0 第七轮，NEW-3）：`known` 为真却仍走这行
      // 的前提是 `message` 非空，而宿主每个错误都带 message，于是桌面版点「重启 DSH」
      // 得到的 why 是宿主原话「桌面版不能在市场里一键重启。」，title 是 `err.unknown.title`
      // —— 三段式里两段都错，专属文案一次都没被渲染。上面 76110d9 那条修复只挡了
      // 「识别出网络/占用」的路径，挡不住「码在表里」这条。
      // 反向对照：未知码**仍要**塞宿主原话（`reason unknown` 会让人没法判断是网络、限流
      // 还是源站挂了），所以条件里保留 `!known`。
      if (!supply && !locked && unreachable === "" && !known && message) copy.why = message;
      return copy;
    }

    // ───────────────────────────── 图标（内联 SVG，宿主没有共享组件库） ─────────────────────────────
    function svgRoot(size, children) {
      return el("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.4,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        focusable: "false",
        "aria-hidden": "true"
      }, children);
    }

    function IconMarket(props) {
      var size = (props && props.size) || 16;
      return svgRoot(size, [
        el("path", { key: "a", d: "M2 6.6 3.3 3h9.4L14 6.6" }),
        el("path", { key: "b", d: "M2.9 6.6v6.1c0 .5.4.8.8.8h8.6c.4 0 .8-.3.8-.8V6.6" }),
        el("path", { key: "c", d: "M6.3 13.5V9.6h3.4v3.9" })
      ]);
    }

    function IconSearch(props) {
      var size = (props && props.size) || 15;
      return svgRoot(size, [
        el("circle", { key: "a", cx: 7, cy: 7, r: 4.1 }),
        el("path", { key: "b", d: "M10.2 10.2 13.6 13.6" })
      ]);
    }

    function IconRefresh(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("path", { key: "a", d: "M2.8 8a5.2 5.2 0 0 1 8.9-3.7" }),
        el("path", { key: "b", d: "M13.2 8a5.2 5.2 0 0 1-8.9 3.7" }),
        el("path", { key: "c", d: "M11.7 1.6v2.7H9" }),
        el("path", { key: "d", d: "M4.3 14.4v-2.7H7" })
      ]);
    }

    // 市场自身的更新：向上箭头 + 底座，与「安装/更新插件」的向下箭头区分开。
    function IconUpgrade(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("path", { key: "a", d: "M8 11.4V2.6" }),
        el("path", { key: "b", d: "M4.6 6 8 2.6 11.4 6" }),
        el("path", { key: "c", d: "M2.8 13.4h10.4" })
      ]);
    }

    function IconDownload(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("path", { key: "a", d: "M8 2.6v8.8" }),
        el("path", { key: "b", d: "M4.6 8 8 11.4 11.4 8" }),
        el("path", { key: "c", d: "M2.8 13.4h10.4" })
      ]);
    }

    /** 抽屉标题用：两层叠片。 */
    function IconLayers(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("path", { key: "a", d: "M8 2.2 14 5.4 8 8.6 2 5.4 8 2.2Z" }),
        el("path", { key: "b", d: "M2.6 8.6 8 11.5l5.4-2.9" })
      ]);
    }

    function IconSpinner(props) {
      var size = (props && props.size) || 15;
      return el("svg", {
        className: "dshpm-spinner",
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        focusable: "false",
        "aria-hidden": "true"
      }, el("path", { d: "M8 1.6a6.4 6.4 0 1 0 6.4 6.4" }));
    }

    function IconClose(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, [
        el("path", { key: "a", d: "M4 4l8 8" }),
        el("path", { key: "b", d: "M12 4l-8 8" })
      ]);
    }

    function IconChevron(props) {
      var size = (props && props.size) || 13;
      var d = props && props.direction === "up" ? "M4.5 10 8 6.5l3.5 3.5" : "M4.5 6.5 8 10l3.5-3.5";
      return svgRoot(size, el("path", { d: d }));
    }

    function IconExternal(props) {
      var size = (props && props.size) || 12;
      return svgRoot(size, [
        el("path", { key: "a", d: "M6.6 3.6H3.9c-.5 0-.9.4-.9.9v7c0 .5.4.9.9.9h7c.5 0 .9-.4.9-.9V8.8" }),
        el("path", { key: "b", d: "M9.6 2.7h3.7v3.7" }),
        el("path", { key: "c", d: "M13.3 2.7 7.9 8.1" })
      ]);
    }

    function IconCheck(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, el("path", { d: "M3 8.6 6.2 11.8 13 4.8" }));
    }

    function IconCopy(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, [
        el("path", { key: "a", d: "M6 5.4h5.7c.5 0 .9.4.9.9v5.8c0 .5-.4.9-.9.9H6c-.5 0-.9-.4-.9-.9V6.3c0-.5.4-.9.9-.9z" }),
        el("path", { key: "b", d: "M3.9 10.4h-.6c-.5 0-.9-.4-.9-.9V3.8c0-.5.4-.9.9-.9h5.4c.5 0 .9.4.9.9v.6" })
      ]);
    }

    function IconTrash(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, [
        el("path", { key: "a", d: "M2.9 4.4h10.2" }),
        el("path", { key: "b", d: "M6.4 2.6h3.2" }),
        el("path", { key: "c", d: "M4.4 4.4l.6 8.1c0 .5.4.9.9.9h4.2c.5 0 .9-.4.9-.9l.6-8.1" })
      ]);
    }

    function IconInfo(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("circle", { key: "a", cx: 8, cy: 8, r: 6 }),
        el("path", { key: "b", d: "M8 7.4v3.4" }),
        el("path", { key: "c", d: "M8 5.1h.01" })
      ]);
    }

    function IconAlert(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("path", { key: "a", d: "M8 2.4 14.2 13.4H1.8z" }),
        el("path", { key: "b", d: "M8 6.4v3" }),
        el("path", { key: "c", d: "M8 11.5h.01" })
      ]);
    }

    // ───────────────────────────── 样式 ─────────────────────────────
    var STYLES = `
.dshpm-entry { display:flex; align-items:center; gap:8px; margin:0 2px; min-height:36px; padding:7px 8px; box-sizing:border-box; border:none; border-radius:var(--dsw-radius-md,8px); background:transparent; color:var(--dsw-alias-label-primary,#1a1a1a); font:inherit; line-height:22px; text-align:left; cursor:pointer; flex:1 1 100%; min-width:0; }
.dshpm-entry:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-entry[data-active="true"] { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-entry:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:-2px; }
.dshpm-entry:disabled { opacity:.55; cursor:not-allowed; }
.dshpm-entry[data-wide="false"] { flex:none; width:36px; height:36px; min-height:36px; padding:0; justify-content:center; }
.dshpm-entryIcon { flex:none; display:inline-flex; align-items:center; justify-content:center; }
.dshpm-entryLabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dshpm-root { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; width:100%; height:100%; min-height:0; overflow:auto; padding:16px clamp(16px,3vw,32px) 32px; color:var(--dsw-alias-label-primary,#1a1a1a); background:var(--dsw-alias-bg-base,transparent); }
/* 面板根是「定高 + 可滚动」的 flex 列，直接子项默认 flex-shrink:1；而 flex 项一旦带非 visible 的
   overflow，它的**自动最小尺寸就变成 0**——于是全部溢出量都压到它身上，文字被裁成一条。真实截图
   就是这样：当年的页内通知条自然高度 36px，实际只渲染 16px，提示只剩半行。正确行为是「根本身滚动」，
   所以直接子项一律不参与收缩。最小复现与实测数据见 verify/REPORT.md §12.12。
   （通知条已改成 position:fixed 的悬浮气泡，不再参与文档流，也就压不到它了；这条规则仍然管着
   横幅、页签、网格这些可能带 overflow 的区块。） */
.dshpm-root > * { flex:0 0 auto; }
.dshpm-header { display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap; }
.dshpm-headerMain { flex:1 1 240px; min-width:0; }
.dshpm-title { margin:0; font-size:1.1em; font-weight:600; }
.dshpm-subtitle { margin-top:2px; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.85em; }
.dshpm-headerActions { display:flex; align-items:center; gap:8px; flex:none; }
/* 页签栏高度是**固定**的：按钮统一 min-height/行高与内边距，带角标（可更新页）和不带角标的
   页签一样高——后续新增页面加角标、加图标都不会把这一行撑高，三个页面永远从同一处开始。 */
.dshpm-tabs { display:flex; align-items:stretch; gap:4px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08)); }
.dshpm-tab { display:inline-flex; align-items:center; gap:4px; box-sizing:border-box; min-height:32px; border:none; background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); font:inherit; font-size:.92em; line-height:20px; padding:6px 10px; cursor:pointer; border-bottom:2px solid transparent; }
.dshpm-tab[data-active="true"] { color:var(--dsw-alias-label-primary,#1a1a1a); border-bottom-color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-tab:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:2px; }
.dshpm-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-search { display:flex; align-items:center; gap:6px; flex:1 1 220px; min-width:180px; padding:5px 8px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-search:focus-within { border-color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-searchIcon { flex:none; display:inline-flex; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-input { flex:1 1 auto; min-width:0; border:none; outline:none; background:transparent; color:inherit; font:inherit; font-size:.9em; }
/* 搜索框只留我们自己那颗清除键：input[type=search] 聚焦且有值时 Chromium 会再画一颗原生 ✕
   （按 accent-color 上色），与 .dshpm-search 里那颗并排——用户截图里的「两个清除键」。
   实测（headless Edge 聚焦态截图对比）：appearance 与 display 任一都能让它消失，两个都写最稳。 */
.dshpm-input::-webkit-search-cancel-button { -webkit-appearance:none; appearance:none; display:none; }
.dshpm-select { border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); color:inherit; font:inherit; font-size:.85em; padding:5px 6px; }
.dshpm-iconBtn { flex:none; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; padding:0; border:none; border-radius:var(--dsw-radius-md,8px); background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); cursor:pointer; }
.dshpm-iconBtn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-iconBtn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:1px; }
.dshpm-chips { display:flex; gap:6px; flex-wrap:wrap; }
.dshpm-chip { border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:999px; background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); font:inherit; font-size:.8em; padding:3px 10px; cursor:pointer; }
.dshpm-chip:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-chip[data-active="true"] { border-color:var(--dsw-alias-brand-primary,#4d6bfe); color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-chip:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:1px; }
.dshpm-summary { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; }
.dshpm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:10px; }
.dshpm-card { display:flex; flex-direction:column; gap:8px; box-sizing:border-box; padding:12px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,10px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-cardHead { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
.dshpm-cardName { margin:0; font-size:.95em; font-weight:600; overflow-wrap:anywhere; }
.dshpm-cardOwner { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.78em; }
.dshpm-cardDesc { margin:0; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.dshpm-cardMeta { display:flex; align-items:center; gap:10px; flex-wrap:wrap; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.78em; }
.dshpm-cardActions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:auto; }
.dshpm-detail { display:flex; flex-direction:column; gap:8px; padding-top:8px; border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08)); font-size:.82em; }
.dshpm-detailRow { display:flex; gap:8px; align-items:flex-start; }
.dshpm-detailKey { flex:none; width:5.5em; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-detailValue { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }
.dshpm-tags { display:flex; gap:4px; flex-wrap:wrap; }
.dshpm-tag { border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:999px; padding:1px 8px; font-size:.95em; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-code { display:block; box-sizing:border-box; width:100%; padding:6px 8px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,6px); background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08)); color:var(--dsw-alias-label-primary,#1a1a1a); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.95em; overflow-wrap:anywhere; }
.dshpm-link { color:var(--dsw-alias-brand-primary,#4d6bfe); text-decoration:none; display:inline-flex; align-items:center; gap:3px; }
.dshpm-link:hover { text-decoration:underline; }
.dshpm-btn { display:inline-flex; align-items:center; gap:5px; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16)); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); color:var(--dsw-alias-label-primary,#1a1a1a); font:inherit; font-size:.82em; padding:4px 10px; cursor:pointer; }
.dshpm-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-btn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:1px; }
.dshpm-btn:disabled { opacity:.5; cursor:not-allowed; }
.dshpm-btn--primary { border-color:transparent; background:var(--dsw-alias-brand-primary,#4d6bfe); color:#fff; }
.dshpm-btn--primary:hover:not(:disabled) { background:var(--dsw-alias-brand-primary,#4d6bfe); filter:brightness(1.08); }
.dshpm-btn--danger { border-color:var(--dsw-alias-state-error-primary,#d93025); color:var(--dsw-alias-state-error-primary,#d93025); background:transparent; }
.dshpm-btn--quiet { border-color:transparent; background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-badge { border-radius:999px; padding:1px 7px; font-size:.72em; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-badge--success { color:var(--dsw-alias-state-success-primary,#1f9d55); border-color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-badge--warn { color:var(--dsw-alias-state-warn-primary,#b7791f); border-color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-badge--error { color:var(--dsw-alias-state-error-primary,#d93025); border-color:var(--dsw-alias-state-error-primary,#d93025); }
/* ── 回执气泡（Android toast 那种）：position:fixed 悬在视口**底部居中**，不占文档流——
   出现或消失都不推动布局，也不用滚动才看得见。旧版是页内提示条：挤在头部下面一格，
   还得靠根节点滚到那一页才看得见。kind 仍用 data-kind 表达，图标配色不变。 */
.dshpm-notice { position:fixed; left:0; right:0; bottom:24px; z-index:60; display:flex; align-items:flex-start; gap:8px; box-sizing:border-box; width:fit-content; max-width:min(560px, calc(100vw - 32px)); margin:0 auto; padding:10px 14px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-left-width:3px; border-radius:16px; background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.94)); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); box-shadow:0 10px 34px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08); font-size:.84em; line-height:1.5; transition:opacity .2s ease, transform .2s ease; }
/* 退场：先沉下去再卸载（由 data-open 翻转触发，200ms 后组件才真正消失）。 */
.dshpm-notice[data-open="false"] { opacity:0; transform:translateY(10px) scale(.97); }
.dshpm-notice[data-kind="success"] { border-left-color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-notice[data-kind="warn"] { border-left-color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-notice[data-kind="error"] { border-left-color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-notice[data-kind="info"] { border-left-color:var(--dsw-alias-state-idle-primary,#8a8a8a); }
.dshpm-noticeIcon { flex:none; display:inline-flex; margin-top:1px; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-notice[data-kind="success"] .dshpm-noticeIcon { color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-notice[data-kind="warn"] .dshpm-noticeIcon { color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-notice[data-kind="error"] .dshpm-noticeIcon { color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-noticeBody { flex:1 1 auto; min-width:0; }
.dshpm-noticeTitle { font-weight:600; }
.dshpm-banner { display:flex; flex-direction:column; gap:6px; box-sizing:border-box; padding:10px 12px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-left-width:3px; border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); font-size:.85em; }
.dshpm-banner[data-kind="warn"] { border-left-color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-banner[data-kind="error"] { border-left-color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-banner[data-kind="info"] { border-left-color:var(--dsw-alias-state-idle-primary,#8a8a8a); }
.dshpm-bannerActions { display:flex; gap:6px; flex-wrap:wrap; }
/* ── 重启询问弹窗（v1.2.0）：装完之后主动问一次「立即重启 / 稍后重启」。
   fixed 覆盖层，不进文档流——**刻意不放在 .dshpm-root 里面**（用 Fragment 挂成兄弟节点），
   否则它会成为 .dshpm-root 的直接子项，撞上 e2e [8]「任何直接子项都不得被压扁」那条几何断言。 */
.dshpm-modalLayer { position:fixed; inset:0; z-index:70; display:flex; align-items:center; justify-content:center; box-sizing:border-box; padding:20px; background:var(--dsw-alias-bg-overlay,rgba(15,17,21,.42)); }
.dshpm-modalCard { display:flex; flex-direction:column; gap:10px; box-sizing:border-box; width:min(440px, 100%); max-height:calc(100vh - 40px); overflow:auto; padding:16px 18px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:16px; background:var(--dsw-alias-bg-layer-2,#fff); box-shadow:0 18px 48px rgba(0,0,0,.22), 0 4px 12px rgba(0,0,0,.1); font-size:.9em; }
.dshpm-modalTitle { font-weight:600; font-size:1.02em; }
.dshpm-modalBody { color:var(--dsw-alias-label-secondary,#5b5b5b); line-height:1.55; overflow-wrap:anywhere; }
.dshpm-modalNames { color:var(--dsw-alias-label-primary,#1a1a1a); font-weight:600; }
.dshpm-modalActions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
.dshpm-modalHint { font-size:.86em; color:var(--dsw-alias-label-secondary,#6b6b6b); line-height:1.5; }
.dshpm-modalState { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#5b5b5b); }
.dshpm-error { display:flex; flex-direction:column; gap:6px; box-sizing:border-box; padding:12px; border:1px solid var(--dsw-alias-state-error-primary,#d93025); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-errorTitle { font-weight:600; color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-errorBody { display:flex; flex-direction:column; gap:4px; font-size:.85em; }
.dshpm-errorLine { display:flex; gap:8px; align-items:flex-start; }
.dshpm-errorKey { flex:none; width:5.5em; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-errorCode { flex:1 1 auto; min-width:0; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; overflow-wrap:anywhere; }
.dshpm-empty { display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:20px 16px; border:1px dashed var(--dsw-alias-border-l1,rgba(0,0,0,.16)); border-radius:var(--dsw-radius-md,10px); }
.dshpm-emptyTitle { font-weight:600; }
.dshpm-emptyBody { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.85em; max-width:52em; }
.dshpm-loading { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.85em; }
.dshpm-skeletonGrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:10px; }
.dshpm-skeleton { height:104px; border-radius:var(--dsw-radius-md,10px); background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06)),var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16)),var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))); background-size:200% 100%; animation:dshpm-shimmer 1.3s linear infinite; }
.dshpm-pager { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:4px; }
.dshpm-pagerInfo { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; }
.dshpm-installed { display:flex; flex-direction:column; gap:12px; }
/* 页签内容的统一外壳（用户报「三个切换页面高度不对齐」）：三个页面共用同一套间距与起点，
   切页签时页面高度一致、内容从同一处开始，不再一跳一跳。
   页面级间距统一成一个单位 12px：外壳 gap、.dshpm-root 的 gap、各页内容容器的 gap 都是 12
   （卡片/列表行**内部**仍是 8，那是块内间距，不是页面节距）。新增页面见 MARKET_TABS 与
   MARKET_PANES：渲染处查表后自动套上这个外壳，不需要再写一遍布局。
   flex:1 0 auto —— 覆盖上面「.dshpm-root > *」那条的 0 0 auto：内容短时页面撑满可视区（几页等高），
   内容长时按内容高度、由面板根自己滚动。收缩权仍是 0，所以任何区块都不会被压扁（§12.12）。 */
.dshpm-root > .dshpm-page { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; flex:1 0 auto; width:100%; }
.dshpm-row { display:flex; flex-direction:column; gap:8px; box-sizing:border-box; padding:10px 12px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,10px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-rowHead { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-rowMain { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1 1 220px; }
.dshpm-rowName { font-weight:600; overflow-wrap:anywhere; }
.dshpm-rowVersion { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; }
.dshpm-rowDesc { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; overflow-wrap:anywhere; }
.dshpm-rowMeta { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.78em; }
.dshpm-rowError { color:var(--dsw-alias-state-error-primary,#d93025); font-size:.8em; }
.dshpm-rowActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-rowLayout { display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; }
.dshpm-switch { position:relative; flex:none; width:34px; height:18px; padding:0; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16)); border-radius:999px; background:var(--dsw-alias-state-idle-primary,#c4c4c4); cursor:pointer; }
.dshpm-switch::after { content:""; position:absolute; top:1px; left:1px; width:14px; height:14px; border-radius:50%; background:#fff; transition:transform .15s ease; }
.dshpm-switch[aria-checked="true"] { background:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-switch[aria-checked="true"]::after { transform:translateX(16px); }
.dshpm-switch:disabled { opacity:.5; cursor:not-allowed; }
.dshpm-switch:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:2px; }
.dshpm-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
/* ── 头部两个按钮：更新插件（带计数角标）与市场自更新 ── */
.dshpm-headerActions { flex-wrap:wrap; justify-content:flex-end; }
.dshpm-btn--attention { border-color:var(--dsw-alias-state-warn-primary,#b7791f); color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-count { display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; margin-left:2px; padding:0 4px; border-radius:999px; background:var(--dsw-alias-state-warn-primary,#b7791f); color:#fff; font-size:.85em; font-weight:600; line-height:1; }
.dshpm-selfNote { display:flex; align-items:flex-start; gap:6px; margin-top:8px; padding:6px 9px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-left:3px solid var(--dsw-alias-brand-primary,#4d6bfe); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.79em; line-height:1.55; }
.dshpm-selfNote svg { flex:none; margin-top:2px; }

/* ── 可更新插件面板：就地展开，不遮挡列表、不制造第二个滚动容器 ── */
/* 可更新页是**整页页签**，不再是会折叠的抽屉：所以这里不写 max-height / overflow:hidden——
   那两样是为了「收起时高度归 0」，留着反而会把很长的更新列表裁掉（列表高 > 1600px 时）。 */
.dshpm-updatesPanel { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; padding:12px 14px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,10px); background:var(--dsw-alias-bg-layer-1,transparent); }
/* 但作为**整页内容**（第三个页签）时它不应该是「页里的另一张卡片」：卡片自带的内边距会把这一页的
   第一行文字往下推 12px，于是三个页签切来切去看上去就不齐（用户报的「高度不对齐」）。页面节距一律
   交给统一外壳 .dshpm-page 负责，这里只保留结构。基类规则留着，便于将来别处复用这张卡片。 */
.dshpm-updatesPage { padding:0; border:none; background:transparent; }
.dshpm-drawerHead { display:flex; align-items:flex-start; gap:8px; }
/* 可更新页页头右侧的两个按钮（检查更新状态机 / 插件市场更新），窄屏下换行到标题下面。 */
.dshpm-updatesActions { flex:none; display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-left:auto; }
.dshpm-drawerIcon { flex:none; display:inline-flex; margin-top:2px; color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-drawerHeading { flex:1 1 auto; min-width:0; }
.dshpm-drawerTitle { font-weight:600; }
.dshpm-drawerSubtitle { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; }
.dshpm-drawerHint { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.79em; }
.dshpm-drawerBody { display:flex; flex-direction:column; gap:8px; }
.dshpm-drawerList { display:flex; flex-direction:column; gap:8px; }
.dshpm-drawerLoading { display:flex; align-items:center; gap:6px; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.8em; }
.dshpm-drawerFoot { display:flex; gap:6px; justify-content:flex-end; }
.dshpm-updateRow { display:flex; align-items:flex-start; gap:10px; flex-wrap:wrap; box-sizing:border-box; padding:10px 12px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,10px); background:var(--dsw-alias-bg-base,transparent); }
.dshpm-updateMain { flex:1 1 240px; min-width:0; display:flex; flex-direction:column; gap:3px; }
.dshpm-updateName { font-weight:600; overflow-wrap:anywhere; }
.dshpm-updateVersions { display:flex; align-items:center; gap:6px; font-size:.82em; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-versionFrom { text-decoration:line-through; opacity:.75; }
.dshpm-versionTo { color:var(--dsw-alias-state-success-primary,#1f9d55); font-weight:600; }
/* 箭头此前只有类名没有样式（引入了类名却漏了规则），会继承整行的字号与颜色，
   与两侧的版本号不一致。显式给它次要色 + 稍小字号。 */
.dshpm-versionArrow { color:var(--dsw-alias-label-tertiary,#8a8a8a); font-size:.9em; }
/* 有旧数据但这次读取失败时的提示条：黄色、一行、带重试。 */
.dshpm-staleNote { display:flex; align-items:center; gap:6px; box-sizing:border-box; padding:8px 10px; border:1px solid var(--dsw-alias-state-warn-primary,#b7791f); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); color:var(--dsw-alias-state-warn-primary,#b7791f); font-size:.82em; }
.dshpm-staleNote .dshpm-btn { margin-left:auto; flex:none; }
.dshpm-updateDesc { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; overflow-wrap:anywhere; }
.dshpm-updateActions { flex:none; display:flex; align-items:center; gap:8px; }
.dshpm-updateResult { display:flex; align-items:center; gap:5px; font-size:.8em; color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-updateResult[data-ok="false"] { color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-updateRow[data-busy="true"] { border-color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-updateRow[data-done="true"] { border-color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-updateRow--ghost { height:62px; border-style:dashed; background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06)),var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16)),var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))); background-size:200% 100%; animation:dshpm-shimmer 1.3s linear infinite; }
.dshpm-entryBadge { flex:none; margin-left:auto; display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 5px; border-radius:999px; background:var(--dsw-alias-state-warn-primary,#b7791f); color:#fff; font-size:.78em; font-weight:600; line-height:1; }
.dshpm-entry[data-wide="false"] .dshpm-entryBadge { position:absolute; top:3px; right:3px; margin:0; min-width:14px; height:14px; padding:0 3px; font-size:.68em; }

/* ───────────────────────────── 动效 ─────────────────────────────
   三条原则，改这里之前先读：
   1. 基础样式里绝不写 opacity:0——动画被关掉（prefers-reduced-motion）时元素必须直接可见；
   2. 只动 transform / opacity / max-height，不动宽高与位置，避免列表重排抖动；
   3. 升入类动画一律用 backwards 填充：用 forwards/both 会把 transform 钉在末帧，
      卡片 hover 的 translateY 与按钮 active 的缩放就再也生效不了。 */
.dshpm-entry { position:relative; transition:background-color .18s ease, transform .16s ease; }
.dshpm-entry:active:not(:disabled) { transform:scale(.98); }
.dshpm-entry[data-active="true"] .dshpm-entryIcon { animation:dshpm-pop .26s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-entryBadge { animation:dshpm-pop .32s cubic-bezier(.22,1,.36,1) backwards, dshpm-breathe 2.6s ease-in-out 3; }
.dshpm-btn { transition:background-color .16s ease, border-color .16s ease, color .16s ease, box-shadow .18s ease, transform .12s ease; }
.dshpm-btn:hover:not(:disabled) { box-shadow:0 1px 6px rgba(0,0,0,.08); }
.dshpm-btn:active:not(:disabled) { transform:scale(.975); }
.dshpm-btn--primary:hover:not(:disabled) { box-shadow:0 3px 12px rgba(77,107,254,.36); }
.dshpm-btn--pulse { animation:dshpm-glow 1.9s ease-in-out 2; }
.dshpm-card { transition:transform .18s cubic-bezier(.22,1,.36,1), box-shadow .2s ease, border-color .18s ease; animation:dshpm-rise .3s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-card:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,.09); border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.16)); }
.dshpm-row { transition:border-color .18s ease, box-shadow .2s ease; animation:dshpm-rise .28s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-row:hover { box-shadow:0 4px 14px rgba(0,0,0,.07); }
.dshpm-updateRow { animation:dshpm-rise .26s cubic-bezier(.22,1,.36,1) backwards; transition:border-color .18s ease, transform .16s ease, box-shadow .2s ease; }
/* ghost（加载占位）必须用**更高特异性**压过上面那条 .dshpm-updateRow 的入场动画：
   两条规则都是单类选择器（特异性 0,1,0）时，靠后的赢——下面那条 .dshpm-updateRow
   会把 ghost 的 dshpm-shimmer 无限扫光覆盖成 dshpm-rise 一次性 0.26s 淡入，
   于是两行骨架屏同时淡入一次就不动了，不再表示「正在加载」。
   用双类选择器（0,2,0）把这条钉死，不依赖规则先后顺序。 */
.dshpm-updateRow.dshpm-updateRow--ghost { animation:dshpm-shimmer 1.3s linear infinite; }
.dshpm-updateRow:hover { transform:translateX(2px); }
.dshpm-chip { transition:background-color .16s ease, color .16s ease, border-color .16s ease, transform .14s ease; }
.dshpm-chip:hover { transform:translateY(-1px); }
.dshpm-chip[data-active="true"] { animation:dshpm-pop .22s ease-out backwards; }
.dshpm-tabs { position:relative; }
.dshpm-tab { position:relative; border-bottom-color:transparent; transition:color .22s ease; }
/* 两个页签的底线用同一个 transform 时长反向缩放：视觉上就是从一边滑到另一边。 */
.dshpm-tab[data-active="true"] { border-bottom-color:transparent; }
.dshpm-tab::after { content:""; position:absolute; left:10px; right:10px; bottom:0; height:2px; border-radius:2px; background:var(--dsw-alias-brand-primary,#4d6bfe); transform:scaleX(0); transform-origin:right center; transition:transform .26s cubic-bezier(.22,1,.36,1); }
.dshpm-tab[data-active="true"]::after { transform:scaleX(1); transform-origin:left center; }
.dshpm-notice { animation:dshpm-toastin .3s cubic-bezier(.2,1.25,.35,1) backwards; }
/* 弹窗：遮罩淡入 + 卡片升起。两者都用 backwards（用 forwards 会把 transform 钉死在末帧，
   之后 hover/位移类样式就再也动不了——门禁有断言盯着这条）。 */
.dshpm-modalLayer { animation:dshpm-fade .18s ease backwards; }
.dshpm-modalCard { animation:dshpm-rise .26s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-banner { animation:dshpm-rise .28s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-detail { animation:dshpm-expand .26s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-empty { animation:dshpm-rise .3s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-grid, .dshpm-installed, .dshpm-drawerList { animation:dshpm-fade .22s ease backwards; }
.dshpm-badge { transition:color .18s ease, border-color .18s ease; }
.dshpm-badge--warn { animation:dshpm-breathe 2.8s ease-in-out 2; }
.dshpm-search { transition:border-color .18s ease, box-shadow .2s ease; }
.dshpm-search:focus-within { box-shadow:0 0 0 3px rgba(77,107,254,.14); }
.dshpm-select { transition:border-color .18s ease; }
.dshpm-tag { transition:background-color .16s ease; }
.dshpm-switch { transition:background-color .2s ease; }
.dshpm-count[data-pop="true"] { animation:dshpm-pop .34s cubic-bezier(.22,1,.36,1) backwards, dshpm-breathe 2.6s ease-in-out 3; }
.dshpm-updatesPage { animation:dshpm-rise .3s cubic-bezier(.22,1,.36,1) backwards; }
.dshpm-skeleton { animation:dshpm-shimmer 1.3s linear infinite; }
/* overflow 只为那条倒计时线服务（线贴底、要被圆角裁掉）。定位写在上面的基础规则里：fixed。
   注意别再给它写 position:relative——后面的规则会盖掉 fixed，气泡就掉回文档流里了。 */
.dshpm-notice { overflow:hidden; }
.dshpm-noticeTimer { position:absolute; left:0; right:0; bottom:0; height:2px; background:currentColor; opacity:.3; transform-origin:left center; animation:dshpm-countdown 4.6s linear forwards; }
@keyframes dshpm-countdown { from { transform:scaleX(1); } to { transform:scaleX(0); } }
@keyframes dshpm-shimmer { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }
@keyframes dshpm-spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }
@keyframes dshpm-slide { 0% { transform:translateX(-100%); } 100% { transform:translateX(300%); } }
@keyframes dshpm-rise { from { opacity:0; transform:translateY(7px); } to { opacity:1; transform:none; } }
@keyframes dshpm-fade { from { opacity:0; } to { opacity:1; } }
@keyframes dshpm-expand { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
@keyframes dshpm-slidein { from { opacity:0; transform:translateX(14px); } to { opacity:1; transform:none; } }
@keyframes dshpm-toastin { from { opacity:0; transform:translateY(16px) scale(.96); } to { opacity:1; transform:none; } }
@keyframes dshpm-pop { 0% { transform:scale(.82); } 60% { transform:scale(1.06); } 100% { transform:scale(1); } }
@keyframes dshpm-breathe { 0%, 100% { opacity:1; } 50% { opacity:.62; } }
@keyframes dshpm-glow { 0%, 100% { box-shadow:0 1px 2px rgba(77,107,254,.28); } 50% { box-shadow:0 2px 14px rgba(77,107,254,.55); } }
.dshpm-spinner { animation:dshpm-spin .9s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  /* 动效是装饰：关掉之后每个元素都必须按最终位置、完全可见地渲染。 */
  .dshpm-root *, .dshpm-root *::before, .dshpm-root *::after,
  /* 弹窗**不在** .dshpm-root 里（见 .dshpm-modalLayer 的注释），所以必须单独列出来——
     漏掉它就会变成「关掉动效后弹窗还带着入场动画」，而 e2e 正好在 reduce 下量动画名。 */
  .dshpm-modalLayer, .dshpm-modalLayer *, .dshpm-modalLayer *::before, .dshpm-modalLayer *::after,
  .dshpm-entry, .dshpm-entry * { animation:none !important; transition:none !important; }
}
`;

    // ───────────────────────────── 样式节点的所有权 ─────────────────────────────
    // DSH 的客户端模块系统只回收「物化窗口内出现」的 <style>：物化时快照未带 data-plugin 的新节点
    // 会被打上 data-plugin 记账（claimStyles），这一代死掉时由 removeOwnedStyles(id) 摘掉。
    // 据此，样式注入必须放在 factory 体内（物化窗口内），而且每代要挂**自己的新节点**：
    //   · 放在 apply() 里注入 → 不被记账 → 节点没人回收，但会被下一次「同 id 已存在就跳过」挡住；
    //   · 沿用同一节点 → 新旧两代共用一个，旧代被回收时新代一起失去样式，页面就成了「有功能无样式」。
    // 另外补两道兜底：渲染时 ensureStyles()，以及 head 被摘掉时的观察器。
    var styleObserver = null;

    function makeStyleNode() {
      var node = document.createElement("style");
      node.id = STYLE_ID;
      node.textContent = STYLES;
      return node;
    }

    /** 这一代自己的样式：先摘掉上一代的同 id 节点，再挂一个全新的（DSH 会记账并负责回收）。 */
    function mountStyles() {
      if (typeof document === "undefined" || !document.head) return;
      var stale = document.getElementById(STYLE_ID);
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      document.head.appendChild(makeStyleNode());
    }

    /** 渲染路径上的兜底：只在缺失时补一个，避免每次渲染都换节点导致样式重算。 */
    function ensureStyles() {
      if (typeof document === "undefined" || !document.head) return;
      if (document.getElementById(STYLE_ID)) return;
      document.head.appendChild(makeStyleNode());
    }

    /** 样式被别的东西摘掉就补回来；由插件 fiber 的生命周期负责断开，避免卸载后复活。 */
    function watchStyles(ctx) {
      if (typeof MutationObserver !== "function" || typeof document === "undefined" || !document.head) return;
      var stop = function () {
        if (styleObserver) { styleObserver.disconnect(); styleObserver = null; }
      };
      if (styleObserver) styleObserver.disconnect();
      styleObserver = new MutationObserver(function () { ensureStyles(); });
      styleObserver.observe(document.head, { childList: true });
      try {
        if (ctx && typeof ctx.effect === "function") ctx.effect(function () { return stop; }, "deepseek-harness-market: style watchdog");
        else if (ctx && typeof ctx.on === "function") ctx.on("dispose", stop);
      } catch (watchError) {
        // 拿不到 fiber 生命周期时让观察器留在本页：它只在样式缺失时补一次，不会碰到别人的节点。
      }
    }

    // ───────────────────────────── 可更新插件数（入口与页面共享） ─────────────────────────────
    // 侧边栏入口拿不到页面 state，所以计数放在模块级：谁读到新结果就 publishChange()，
    // 入口角标与页面头部按钮跟着一起重渲染。5 分钟内不重复打网络；请求在途时复用同一个 promise
    // （入口与面板可能同时挂载，那样只会发一次）。
    var UPDATE_COUNT_TTL_MS = 5 * 60 * 1000;
    var updateCountState = { count: 0, at: 0, known: false, inflight: null };

    function updateCountSnapshot() {
      return { count: updateCountState.count, known: updateCountState.known === true };
    }

    /** 页面自己拉过 /installed 之后把结果交进来：省掉入口那次重复请求。 */
    function publishUpdateCount(bundles) {
      var count = 0;
      if (Array.isArray(bundles)) {
        for (var i = 0; i < bundles.length; i++) {
          if (bundles[i] && bundles[i].updateAvailable === true) count++;
        }
      }
      var changed = count !== updateCountState.count || updateCountState.known !== true;
      updateCountState.count = count;
      updateCountState.at = Date.now();
      updateCountState.known = true;
      if (changed) publishChange();
      return count;
    }

    /**
     * 读一次可更新数：TTL 内用上次结果，否则打一次 /installed。
     * 失败不抛——入口只是少一个角标，不该把异常冒进 React 的 effect。
     */
    function ensureUpdateCount(force) {
      var now = Date.now();
      if (!force && updateCountState.known && now - updateCountState.at < UPDATE_COUNT_TTL_MS) {
        return Promise.resolve(updateCountSnapshot());
      }
      if (updateCountState.inflight) return updateCountState.inflight;
      var request = api.installed(undefined).then(function (payload) {
        updateCountState.inflight = null;
        return { count: publishUpdateCount(payload && payload.bundles), known: true };
      }, function () {
        updateCountState.inflight = null;
        return updateCountSnapshot();
      });
      updateCountState.inflight = request;
      return request;
    }

    // ───────────────────────── 自动检查规则（用户定的） ─────────────────────────
    // 1) 每次启动 DSH：client 模块随宿主 apply 一次 → 立刻检查一次**市场本体**更新；
    // 2) 启动后每 1 小时 → 检查一次**插件**更新（读 /installed，宿主已把目录 join 进来），
    //    结果同时喂给侧边栏角标与「可更新」页签。
    // 状态放模块级，但自动检查**不替用户按下**：没更新时停在初始态——第一次进页面按钮是
    // 「插件市场更新」而不是「再次检查」（用户报的问题）；发现新版本才亮「更新到 x.y.z」。
    var PLUGIN_CHECK_INTERVAL_MS = 60 * 60 * 1000;
    // 装完的「更新成功」停留时长：装完立刻跳回「插件市场更新」，用户看不到装好了这一步。
    var SELF_DONE_MS = 3000;
    var selfCheckState = { phase: "idle", data: null, error: null, at: 0 };
    var selfCheckListeners = [];
    var installedListeners = [];
    var schedulerStarted = false;
    var selfDoneTimer = null;

    /** 装完进「更新成功」态，SELF_DONE_MS 后自动回到 idle（按钮回到「插件市场更新」）。
     *  定时器放模块级：新装的代码要重启才生效，这里回 idle 不是谎称已生效，只是把按钮复位。 */
    function markSelfDone() {
      if (selfDoneTimer !== null) clearTimeout(selfDoneTimer);
      setSelfCheck({ phase: "done", data: null, error: null, at: Date.now() });
      selfDoneTimer = setTimeout(function () {
        selfDoneTimer = null;
        if (selfCheckState.phase === "done") {
          setSelfCheck({ phase: "idle", data: null, error: null, at: Date.now() });
        }
      }, SELF_DONE_MS);
    }

    function notifyListeners(list, payload) {
      var copy = list.slice();
      for (var i = 0; i < copy.length; i++) {
        try { copy[i](payload); } catch (listenerError) {
          // 命名单个订阅者失败：一个组件的问题不能让其余订阅者收不到这次检查结果。
        }
      }
    }

    function subscribeSelfCheck(listener) {
      selfCheckListeners.push(listener);
      return function () {
        var at = selfCheckListeners.indexOf(listener);
        if (at >= 0) selfCheckListeners.splice(at, 1);
      };
    }

    function subscribeInstalledRefresh(listener) {
      installedListeners.push(listener);
      return function () {
        var at = installedListeners.indexOf(listener);
        if (at >= 0) installedListeners.splice(at, 1);
      };
    }

    function getSelfCheck() { return selfCheckState; }

    function setSelfCheck(next) {
      selfCheckState = next;
      notifyListeners(selfCheckListeners, next);
    }

    /** 检查市场本体更新：启动规则与页面按钮共用同一个状态机。
     *  onResult 可选——页面用它把结果翻译成回执气泡；启动时的那次检查没有回执。
     *  manual 标记这次是不是**用户按按钮**发起的（用户报「第一次进入这个界面怎么会是再次检查」：
     *  「再次检查」是给点过的人看的态，第一次进页面还没点过就该是初始的「插件市场更新」）。
     *  启动那次自动检查没更新时留在 idle；发现新版本照常亮「更新到 x.y.z」——那是给用户的信息，
     *  不是替他把状态机按到「已检查过」。
     *  fetch/URL 不可用的环境（回归测试会调用 apply）不能让 apply 崩掉，所以这里兜住同步异常。 */
    function runSelfCheck(onResult, manual) {
      if (selfCheckState.phase === "checking") return;
      setSelfCheck({ phase: "checking", data: selfCheckState.data, error: null, at: selfCheckState.at });
      var request = null;
      try {
        request = api.selfUpdate(false);
      } catch (error) {
        setSelfCheck({ phase: "error", data: null, error: error, at: Date.now() });
        if (typeof onResult === "function") onResult(error, null);
        return;
      }
      request.then(function (payload) {
        var info = payload && payload.selfUpdate ? payload.selfUpdate : {};
        // 手动查完没更新也真查过 → ready（「再次检查」）；自动查、没更新 → 回 idle（仍是
        // 「插件市场更新」）；自动查、有更新 → ready，交给 available 分支配「更新到 x.y.z」。
        var phase = manual === true || (info && info.updateAvailable === true) ? "ready" : "idle";
        setSelfCheck({ phase: phase, data: info, error: null, at: Date.now() });
        if (typeof onResult === "function") onResult(null, info);
      }, function (error) {
        setSelfCheck({ phase: "error", data: null, error: error, at: Date.now() });
        if (typeof onResult === "function") onResult(error, null);
      });
    }

    /** 每小时的插件更新检查：绕过 5 分钟计数 TTL，再通知页面重读并给出回执。 */
    function checkPluginUpdates() {
      var before = updateCountState.count;
      return ensureUpdateCount(true).then(function (snapshot) {
        var increased = snapshot.known === true && snapshot.count > before;
        notifyListeners(installedListeners, { count: snapshot.count, increased: increased });
        return { count: snapshot.count, increased: increased };
      });
    }

    /** 守卫：apply 可能被调用多次（HMR / 重新注册），定时器只准有一个。 */
    function startUpdateScheduler() {
      if (schedulerStarted) return;
      schedulerStarted = true;
      runSelfCheck();
      if (typeof setInterval === "function") {
        var handle = setInterval(function () {
          // 回调里不许把异常抛到定时器外（测试环境没有可用的网络栈时会炸掉整个进程）。
          try { checkPluginUpdates(); } catch (checkError) { /* 下一小时再试 */ }
        }, PLUGIN_CHECK_INTERVAL_MS);
        // Node（回归测试里会调用 apply）返回带 unref 的 Timeout：不 unref 的话测试进程会被这个
        // 每小时一次的定时器拖住、永远不退出。浏览器返回的是数字，没有 unref，跳过即可。
        if (handle && typeof handle.unref === "function") handle.unref();
      }
    }

    // ───────────────────────────── 运行期接线（apply 填，组件读） ─────────────────────────────
    var RUNTIME = {
      panelAvailable: false,
      selectPanel: null,
      timer: null,
      search: null,
      panelRetryUsed: false
    };

    function openMarketPanel() {
      if (!RUNTIME.selectPanel) return;
      try {
        RUNTIME.selectPanel(PANEL_KEY);
        RUNTIME.panelRetryUsed = false;
      } catch (panelError) {
        // main 槽位的注册可能比入口晚一帧；先重试一次，仍失败才把入口降级为禁用，
        // 而不是让这个异常冒到 React 的事件处理里。
        if (!RUNTIME.panelRetryUsed) {
          RUNTIME.panelRetryUsed = true;
          setTimeout(openMarketPanel, 150);
          return;
        }
        RUNTIME.selectPanel = null;
        RUNTIME.panelAvailable = false;
        publishChange();
      }
    }

    // 搜索防抖优先用宿主的 timer 服务（不过它在插件 fiber 上注册，必须在 apply 里建一次），
    // 拿不到服务时退化为自写实现。cancel 只丢弃待提交的回调，不做无意义的空请求。
    function createSearchScheduler(timerService) {
      if (timerService && typeof timerService.debounce === "function") {
        try {
          var pending = null;
          var fire = timerService.debounce(function () {
            var next = pending;
            pending = null;
            if (next) next();
          }, SEARCH_DEBOUNCE_MS);
          return {
            schedule: function (fn) { pending = fn; fire(); },
            cancel: function () { pending = null; }
          };
        } catch (debounceError) {
          // 命名此处空 catch 的原因：宿主 timer 不可用时必须退化为自写防抖，不能让搜索失效。
        }
      }
      var handle = null;
      return {
        schedule: function (fn) {
          if (handle !== null) clearTimeout(handle);
          handle = setTimeout(function () {
            handle = null;
            fn();
          }, SEARCH_DEBOUNCE_MS);
        },
        cancel: function () {
          if (handle !== null) {
            clearTimeout(handle);
            handle = null;
          }
        }
      };
    }

    function ensureSearchScheduler() {
      if (!RUNTIME.search) RUNTIME.search = createSearchScheduler(RUNTIME.timer);
      return RUNTIME.search;
    }

    // ───────────────────────────── 侧边栏底部入口 ─────────────────────────────
    function useActivePanel(props) {
      var readPanelInfo = props && props.usePanelInfo;
      if (typeof readPanelInfo !== "function") return false;
      return !!readPanelInfo(function (info) {
        return !!info && info.activePanelId === PANEL_KEY;
      });
    }

    function MarketEntry(props) {
      useChangeTick();
      ensureStyles();
      var wide = !props || props.wide !== false;
      var active = useActivePanel(props);
      var available = RUNTIME.panelAvailable;
      var updates = updateCountSnapshot();
      // 入口是「有更新」最该被看见的地方：挂载时读一次可更新数（模块级 TTL 去重，
      // 面板打开过就复用那份结果，不会重复打网络）。
      React.useEffect(function () {
        if (!available) return undefined;
        ensureUpdateCount(false);
        return undefined;
      }, [available]);
      return el("button", {
        type: "button",
        className: "dshpm-entry",
        "data-wide": wide ? "true" : "false",
        "data-active": active ? "true" : "false",
        "data-hasUpdates": updates.known && updates.count > 0 ? "true" : "false",
        "aria-label": t("market.title"),
        "aria-current": active ? "page" : undefined,
        disabled: !available,
        title: available ? t("market.entry.aria") : t("market.entry.disabled"),
        onClick: openMarketPanel
      },
        el("span", { className: "dshpm-entryIcon" }, el(IconMarket, { size: wide ? 16 : 18 })),
        wide ? el("span", { className: "dshpm-entryLabel" }, t("market.title")) : null,
        updates.known && updates.count > 0
          ? el("span", {
            className: "dshpm-entryBadge",
            title: t("updates.entryBadge", { count: updates.count }),
            "aria-label": t("updates.entryBadge", { count: updates.count })
          }, String(updates.count))
          : null
      );
    }

    // ───────────────────────────── 通用小组件 ─────────────────────────────
    function Badge(props) {
      var tone = props.tone ? " dshpm-badge--" + props.tone : "";
      return el("span", { className: "dshpm-badge" + tone }, props.children);
    }

    function ErrorLines(props) {
      var copy = errorCopy(props.error);
      var lines = [
        el("div", { className: "dshpm-errorLine", key: "what" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.what")),
          el("span", null, copy.title)),
        el("div", { className: "dshpm-errorLine", key: "why" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.why")),
          el("span", null, copy.why)),
        el("div", { className: "dshpm-errorLine", key: "next" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.next")),
          el("span", null, copy.next))
      ];
      if (copy.message && copy.message !== copy.title) {
        lines.push(el("div", { className: "dshpm-errorLine", key: "detail" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.detail")),
          el("code", { className: "dshpm-errorCode" }, copy.message)));
      }
      if (copy.hint) {
        lines.push(el("div", { className: "dshpm-errorLine", key: "hint" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.hint")),
          el("span", null, copy.hint)));
      }
      return el("div", { className: "dshpm-errorBody" }, lines);
    }

    function ErrorState(props) {
      return el("div", { className: "dshpm-error", role: "alert" },
        el("div", { className: "dshpm-errorTitle" }, t("error.label.what") + "：" + errorCopy(props.error).title),
        el(ErrorLines, { error: props.error }),
        props.onRetry ? el("div", { className: "dshpm-bannerActions" },
          el("button", { type: "button", className: "dshpm-btn dshpm-btn--primary", onClick: props.onRetry },
            props.retrying ? el(IconSpinner, { size: 12 }) : null,
            props.retrying ? t("action.working") : t("action.retry"))
        ) : null
      );
    }

    function LoadingState(props) {
      return el("div", { className: "dshpm-loading", role: "status", "aria-busy": "true" },
        el(IconSpinner, { size: 15 }),
        el("span", null, props.text || t("state.loadingCatalog")),
        props.hint ? el("span", null, props.hint) : null
      );
    }

    function SkeletonGrid() {
      var cells = [];
      for (var i = 0; i < 6; i++) cells.push(el("div", { className: "dshpm-skeleton", key: "s" + i }));
      return el("div", { className: "dshpm-skeletonGrid", "aria-hidden": "true" }, cells);
    }

    function EmptyState(props) {
      return el("div", { className: "dshpm-empty" },
        el("div", { className: "dshpm-emptyTitle" }, props.title),
        props.body ? el("div", { className: "dshpm-emptyBody" }, props.body) : null,
        props.actionLabel && props.onAction
          ? el("button", { type: "button", className: "dshpm-btn", onClick: props.onAction }, props.actionLabel)
          : null
      );
    }

    /** 成功/信息类提示会自己收起：渲染时打标记，NoticeBar 才画那条倒计时线。 */
    function withAutoDismiss(notice) {
      if (!notice) return notice;
      if (notice.kind !== "success" && notice.kind !== "info") return notice;
      return { kind: notice.kind, text: notice.text, error: notice.error, autoDismiss: true };
    }

    function NoticeBar(props) {
      var notice = props.notice;
      var kind = notice.kind || "info";
      var icon = kind === "error" ? el(IconAlert, { size: 14 })
        : kind === "warn" ? el(IconAlert, { size: 14 })
          : kind === "success" ? el(IconCheck, { size: 14 })
            : el(IconInfo, { size: 14 });
      return el("div", {
        className: "dshpm-notice",
        "data-kind": kind,
        // data-open 只在**退场**那 200ms 里是 false：气泡先沉下去再卸载，不是凭空消失。
        "data-open": props.open === false ? "false" : "true",
        role: kind === "error" ? "alert" : "status",
        "aria-live": kind === "error" ? "assertive" : "polite"
      },
        el("span", { className: "dshpm-noticeIcon" }, icon),
        el("div", { className: "dshpm-noticeBody" },
          notice.text ? el("div", { className: "dshpm-noticeTitle" }, notice.text) : null,
          notice.error ? el(ErrorLines, { error: notice.error }) : null
        ),
        props.onDismiss
          ? el("button", { type: "button", className: "dshpm-iconBtn", onClick: props.onDismiss, "aria-label": t("action.clear"), title: t("action.clear") },
            el(IconClose, { size: 12 }))
          : null,
        // 会自动收起的那两类（成功/信息）带一条走完即收的进度线，让「它自己会消失」可见。
        notice.autoDismiss
          ? el("span", { className: "dshpm-noticeTimer", "aria-hidden": "true" })
          : null
      );
    }

    function Banner(props) {
      return el("div", { className: "dshpm-banner", "data-kind": props.kind || "info", role: props.kind === "error" ? "alert" : "status" },
        el("div", { className: "dshpm-noticeTitle" }, props.title),
        props.body ? el("div", null, props.body) : null,
        props.children || null
      );
    }

    /**
     * 重启询问弹窗（v1.2.0）：装完之后**主动问一次**「立即重启 / 稍后重启」。
     *
     * 为什么要它：以前装完只把「有待重启的改动」横幅亮在页面顶部，用户得自己注意到、再找到那颗
     * 按钮——「装完还要手动找重启」正是被抱怨的那件事。
     *
     * 几个刻意的决定：
     *   - **默认是「稍后重启」**：重启会截断正在流式输出的回复，破坏性动作不能做默认项；
     *   - **Esc 与点遮罩 = 稍后重启**（同义于「先不重启」，而不是「取消安装」——东西已经装好了）；
     *   - 弹窗挂成 `.dshpm-root` 的**兄弟节点**（Fragment），不做它的子项：子项会被 e2e [8]
     *     的几何断言盯上（「任何直接子项都不得被压扁」），而这个覆盖层天然比 root 高。
     *   - 组件本身无状态：开/关由父级的 restartAsk 决定，重启中切换成「正在重启」态并隐藏按钮。
     */
    function RestartAskModal(props) {
      var names = Array.isArray(props.names) ? props.names : [];
      var restarting = props.phase === "restarting";
      var layer = React.useRef(null);
      // Esc = 稍后重启。用 document 级监听而不是给遮罩加 onKeyDown：弹窗里没有可聚焦的输入控件，
      // 依赖元素自身获焦会在某些路径下收不到按键。
      React.useEffect(function () {
        function onKey(event) {
          if (event && (event.key === "Escape" || event.key === "Esc")) props.onLater();
        }
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [props.onLater]);
      // 打开时把焦点移到「稍后重启」上：键盘用户 Tab 的第一站是安全选项，不是破坏性那个。
      React.useEffect(function () {
        var node = layer.current;
        if (node && typeof node.querySelector === "function") {
          var later = node.querySelector('[data-action="later"]');
          if (later && typeof later.focus === "function") later.focus();
        }
      }, []);
      // 名字太多就折叠：只列前 3 个，其余用「等 N 个」表示（弹窗不是清单页）。
      var shown = names.slice(0, 3);
      var more = names.length - shown.length;
      var namesText = shown.join("、") + (more > 0 ? " " + t("restartAsk.listMore", { count: more }) : "");
      var body = props.marketVersion
        ? t("restartAsk.bodyMarket", { version: props.marketVersion })
        : t("restartAsk.body", { names: namesText });
      return el("div", {
        className: "dshpm-modalLayer",
        ref: layer,
        role: "presentation",
        onClick: function (event) { if (event.target === event.currentTarget) props.onLater(); }
      },
        el("div", {
          className: "dshpm-modalCard",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("restartAsk.title"),
          "data-open": "true"
        },
          el("div", { className: "dshpm-modalTitle" }, t("restartAsk.title")),
          el("div", { className: "dshpm-modalBody" }, body),
          restarting
            ? el("div", { className: "dshpm-modalState" }, el(IconSpinner, { size: 13 }), t("restartAsk.restarting"))
            : el("div", { className: "dshpm-modalHint" }, t("restartAsk.hint")),
          el("div", { className: "dshpm-modalActions" },
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--quiet",
              "data-action": "later",
              disabled: restarting,
              onClick: props.onLater
            }, t("restartAsk.later")),
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--primary dshpm-restartNowBtn",
              "data-action": "now",
              disabled: restarting,
              "aria-busy": restarting ? "true" : "false",
              title: t("restart.title"),
              onClick: props.onNow
            }, restarting ? el(IconSpinner, { size: 13 }) : el(IconUpgrade, { size: 13 }),
              t("restartAsk.now"))))
      );
    }

    function Pager(props) {
      var page = props.page || 1;
      var pages = props.pages || 1;
      return el("nav", { className: "dshpm-pager", "aria-label": t("pager.label") },
        el("button", {
          type: "button",
          className: "dshpm-btn",
          disabled: props.busy || page <= 1,
          onClick: props.onPrev
        }, t("pager.prev")),
        el("span", { className: "dshpm-pagerInfo" }, t("pager.indicator", { page: page, pages: pages })),
        el("button", {
          type: "button",
          className: "dshpm-btn",
          disabled: props.busy || page >= pages,
          onClick: props.onNext
        }, t("pager.next")),
        page > 1
          ? el("button", { type: "button", className: "dshpm-btn dshpm-btn--quiet", disabled: props.busy, onClick: props.onFirst }, t("action.firstPage"))
          : null
      );
    }

    function Switch(props) {
      return el("button", {
        type: "button",
        className: "dshpm-switch",
        role: "switch",
        "aria-checked": props.checked ? "true" : "false",
        "aria-label": props.label,
        title: props.title || props.label,
        disabled: !!props.disabled,
        onClick: props.onToggle
      });
    }

    // ───────────────────────────── 发现页 ─────────────────────────────
    function PluginCard(props) {
      var item = props.item;
      var busy = props.busy;
      var readOnly = props.readOnly;
      var canInstall = item.installable !== false && !!item.spec;
      var installed = !!item.installed;
      var updateAvailable = !!item.updateAvailable;
      var installDisabled = readOnly || busy || !canInstall;
      var installLabel = busy && props.busyKind === "update"
        ? t("action.updating")
        : busy ? t("action.installing")
          : updateAvailable ? t("action.update", { version: item.version || "" })
            : installed ? t("action.installed") : t("action.install");
      var installTitle = !canInstall ? t("list.notInstallable") : readOnly ? t("readonly.body") : "";
      return el("article", {
        className: "dshpm-card",
        // 错峰入场：整页卡片依次浮起，但延迟封顶，翻到第 24 张也不会等。
        style: { animationDelay: Math.min(props.index || 0, 12) * 22 + "ms" }
      },
        el("div", { className: "dshpm-cardHead" },
          el("h3", { className: "dshpm-cardName" }, item.name || item.id),
          el("span", { className: "dshpm-cardOwner" }, "@" + (item.owner || "")),
          installed ? el(Badge, null, t("action.installed")) : null,
          updateAvailable ? el(Badge, { tone: "warn" }, t("badge.update")) : null
        ),
        el("p", { className: "dshpm-cardDesc" }, descriptionText(item.description)),
        el("div", { className: "dshpm-cardMeta" },
          el("span", null, t("meta.stars", { count: formatCount(item.stars || 0) })),
          el("span", null, t("meta.downloads", { count: formatCount(item.downloads || 0) })),
          item.version ? el("span", null, "v" + item.version) : null,
          item.category ? el("span", null, categoryLabel(props.categories, item.category)) : null
        ),
        el("div", { className: "dshpm-cardActions" },
          el("button", {
            type: "button",
            className: "dshpm-btn" + (installed ? "" : " dshpm-btn--primary"),
            disabled: installDisabled,
            title: installTitle,
            "aria-busy": busy ? "true" : "false",
            onClick: function () { props.onInstall(item); }
          }, busy ? el(IconSpinner, { size: 12 }) : null, installLabel),
          el("button", {
            type: "button",
            className: "dshpm-btn dshpm-btn--quiet",
            "aria-expanded": props.expanded ? "true" : "false",
            onClick: function () { props.onToggleDetails(item.id); }
          }, props.expanded ? t("action.hideDetails") : t("action.details"))
        ),
        props.expanded ? el(PluginDetails, { item: item, onCopy: props.onCopy, copied: props.copied }) : null
      );
    }

    function PluginDetails(props) {
      var item = props.item;
      var capabilities = item.capabilities || [];
      var command = item.install || (item.spec ? "dsh plugin add " + item.spec : "");
      return el("div", { className: "dshpm-detail" },
        el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.description")),
          el("span", { className: "dshpm-detailValue" }, descriptionText(item.description) || "—")),
        capabilities.length
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.capabilities")),
            el("span", { className: "dshpm-tags" }, capabilities.map(function (token) {
              return el("span", { className: "dshpm-tag", key: token }, capabilityLabel(token));
            })))
          : null,
        el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.links")),
          el("span", { className: "dshpm-detailValue" },
            el("span", { className: "dshpm-tags" },
              item.url ? el("a", { className: "dshpm-link", href: item.url, target: "_blank", rel: "noreferrer", key: "repo" }, t("detail.repo"), el(IconExternal, { size: 11 })) : null,
              item.page ? el("a", { className: "dshpm-link", href: item.page, target: "_blank", rel: "noreferrer", key: "page" }, t("detail.page"), el(IconExternal, { size: 11 })) : null,
              !item.url && !item.page ? el("span", null, "—") : null))),
        item.added
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.added")),
            el("span", { className: "dshpm-detailValue" }, formatDate(item.added)))
          : null,
        command
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.command")),
            el("span", { className: "dshpm-detailValue" },
              el("code", { className: "dshpm-code" }, command),
              el("button", {
                type: "button",
                className: "dshpm-btn dshpm-btn--quiet",
                onClick: function () { props.onCopy(command); }
              }, el(IconCopy, { size: 11 }), props.copied ? t("action.copied") : t("action.copy"))))
          : null
      );
    }

    function DiscoverPane(props) {
      var state = props.state;
      if (state.phase === "loading" && !state.data) {
        return el("div", { className: "dshpm-installed" },
          el(LoadingState, { text: t("state.loadingCatalog"), hint: t("state.loadingHint") }),
          el(SkeletonGrid, null));
      }
      if (state.phase === "error" && !state.data) {
        return el(ErrorState, { error: state.error, onRetry: props.onRetry });
      }
      var payload = state.data || {};
      var items = payload.items || [];
      var page = payload.page || { page: 1, pages: 1, total: items.length };
      var categories = payload.categories || [];
      var summary = page.total === 0
        ? t("list.summaryEmpty")
        : t("list.summary", { total: page.total, page: page.page || 1, pages: page.pages || 1 });
      return el("div", { className: "dshpm-installed" },
        el("div", { className: "dshpm-toolbar" },
          el("div", { className: "dshpm-search" },
            el("span", { className: "dshpm-searchIcon" }, el(IconSearch, { size: 15 })),
            el("input", {
              className: "dshpm-input",
              type: "search",
              value: props.queryInput,
              maxLength: MAX_QUERY_LENGTH,
              placeholder: t("search.placeholder"),
              "aria-label": t("search.label"),
              onChange: function (event) { props.onQueryInput(event.target.value); },
              onKeyDown: function (event) {
                if (event.key === "Enter") {
                  event.preventDefault();
                  props.onQuerySubmit();
                }
              }
            }),
            props.queryInput
              ? el("button", { type: "button", className: "dshpm-iconBtn", title: t("action.clear"), "aria-label": t("action.clear"), onClick: props.onQueryClear },
                el(IconClose, { size: 12 }))
              : null),
          el("label", { className: "dshpm-sr", htmlFor: "dshpm-sort" }, t("filter.sort")),
          el("select", {
            className: "dshpm-select",
            id: "dshpm-sort",
            value: props.sort,
            "aria-label": t("filter.sort"),
            onChange: function (event) { props.onSort(event.target.value); }
          }, SORTS.map(function (option) {
            return el("option", { key: option.id, value: option.id }, t(option.key));
          }))
        ),
        categories.length
          ? el("div", { className: "dshpm-chips", role: "group", "aria-label": t("filter.category") },
            el("button", {
              type: "button",
              className: "dshpm-chip",
              "data-active": props.category === "all" ? "true" : "false",
              onClick: function () { props.onCategory("all"); }
            }, t("filter.all")),
            categories.map(function (category) {
              return el("button", {
                type: "button",
                key: category.id,
                className: "dshpm-chip",
                "data-active": props.category === category.id ? "true" : "false",
                onClick: function () { props.onCategory(category.id); }
              }, categoryLabel(props.categories, category.id) + " " + formatCount(category.count || 0));
            }))
          : null,
        el("div", { className: "dshpm-summary" },
          el("span", null, summary),
          state.phase === "loading" ? el("span", null, t("list.updating")) : null),
        state.phase === "error" && state.data
          ? el(ErrorState, { error: state.error, onRetry: props.onRetry })
          : null,
        items.length
          ? el("div", { className: "dshpm-grid" }, items.map(function (item, index) {
            var key = item.id || item.name;
            return el(PluginCard, {
              key: key,
              index: index,
              item: item,
              categories: props.categories,
              expanded: !!props.expanded[key],
              busy: props.busyKey === "install:" + key,
              busyKind: props.busyKind,
              copied: props.copied === key,
              readOnly: props.readOnly,
              onInstall: props.onInstall,
              onToggleDetails: props.onToggleDetails,
              onCopy: function (command) { props.onCopy(command, key); }
            });
          }))
          : el(EmptyState, {
            title: t("list.empty.title"),
            body: t("list.empty.body"),
            actionLabel: t("list.empty.action"),
            onAction: props.onResetFilters
          }),
        (page.pages || 1) > 1
          ? el(Pager, {
            page: page.page || 1,
            pages: page.pages || 1,
            busy: state.phase === "loading",
            onPrev: function () { props.onPage((page.page || 1) - 1); },
            onNext: function () { props.onPage((page.page || 1) + 1); },
            onFirst: function () { props.onPage(1); }
          })
          : null
      );
    }

    // ───────────────────────────── 已安装页 ─────────────────────────────
    function entriesForBundle(plugins, bundle) {
      var matched = [];
      for (var i = 0; i < plugins.length; i++) {
        var entry = plugins[i];
        if (!entry) continue;
        if (entry.bundle === bundle.name || (!entry.bundle && entry.moduleName === bundle.name)) matched.push(entry);
      }
      return matched;
    }

    function BundleRow(props) {
      var bundle = props.bundle;
      var entries = props.entries || [];
      var rows = bundle.rows || [];
      // BundleInfo 可能带 readOnlyReason（宿主基础设施托管或无法定位）：这类包只能看，不能开关或卸载。
      var hostReasonKey = bundle.readOnlyReason ? "readonlyReason." + String(bundle.readOnlyReason) : "";
      var hostReason = hostReasonKey ? t(hostReasonKey) : "";
      if (hostReason === hostReasonKey) hostReason = "";
      var locked = props.readOnly || !!hostReason;
      var removeDisabled = locked || bundle.removable === false || bundle.market;
      var removeTitle = bundle.market
        ? t("installed.self")
        : bundle.removable === false
          ? t("installed.notRemovable")
          : hostReason || (props.readOnly ? t("readonly.body") : "");
      var confirm = props.confirming;
      return el("div", {
        className: "dshpm-row",
        style: { animationDelay: Math.min(props.index || 0, 12) * 26 + "ms" }
      },
        el("div", { className: "dshpm-rowLayout" },
          el("div", { className: "dshpm-rowMain" },
            el("div", { className: "dshpm-rowHead" },
              el("span", { className: "dshpm-rowName" }, bundle.name),
              bundle.version ? el("span", { className: "dshpm-rowVersion" }, "v" + bundle.version) : null,
              bundle.official ? el(Badge, null, t("badge.official")) : null,
              bundle.market ? el(Badge, null, t("badge.market")) : null,
              bundle.updateAvailable ? el(Badge, { tone: "warn" }, t("badge.update")) : null,
              bundle.enabled === false ? el(Badge, { tone: "warn" }, t("badge.disabled")) : null,
              bundle.error ? el(Badge, { tone: "error" }, t("badge.error")) : null),
            bundle.description ? el("div", { className: "dshpm-rowDesc" }, bundle.description) : null,
            el("div", { className: "dshpm-rowMeta" },
              t("installed.rows", { count: rows.length }),
              entries.length ? " · " + t("installed.plugins") + " " + entries.length : "",
              hostReason ? " · " + hostReason : ""),
            bundle.error
              ? el("div", { className: "dshpm-rowError" }, t("installed.rowError", { message: shortFailureText(bundle.error) || (bundle.error.code || "") }))
              : null),
          el("div", { className: "dshpm-rowActions" },
            el(Switch, {
              checked: bundle.enabled !== false,
              disabled: locked || props.busy,
              title: hostReason || (props.readOnly ? t("readonly.body") : ""),
              label: bundle.enabled === false ? t("action.enable") + " " + bundle.name : t("action.disable") + " " + bundle.name,
              onToggle: props.onToggle
            }),
            bundle.updateAvailable && bundle.latest
              ? el("button", {
                type: "button",
                className: "dshpm-btn",
                // batchRunning：一键更新正在顺序跑时，已安装页这一颗也要禁用。
                // 与「可更新」页的行内按钮一致——否则用户能从这一页插进同一个包的更新，
                // 让批量那一步撞上「同一个包正在装」的守卫（现在守卫会跳过并继续，但不该让用户走到那儿）。
                disabled: locked || props.busy || props.batchRunning,
                title: hostReason || (props.readOnly ? t("readonly.body") : ""),
                onClick: props.onUpdate
              }, props.busyKind === "update" ? el(IconSpinner, { size: 12 }) : null,
                props.busyKind === "update" ? t("action.updating") : t("action.update", { version: bundle.latest }))
              : null,
            confirm
              ? el("span", { className: "dshpm-rowActions" },
                el("button", { type: "button", className: "dshpm-btn dshpm-btn--danger", disabled: props.busy, onClick: props.onRemove },
                  props.busyKind === "remove" ? el(IconSpinner, { size: 12 }) : el(IconTrash, { size: 12 }),
                  props.busyKind === "remove" ? t("action.uninstalling") : t("action.confirmUninstall")),
                el("button", { type: "button", className: "dshpm-btn dshpm-btn--quiet", disabled: props.busy, onClick: props.onCancelRemove }, t("action.cancel")))
              : el("button", {
                type: "button",
                className: "dshpm-btn",
                disabled: removeDisabled || props.busy,
                title: removeTitle,
                onClick: props.onAskRemove
              }, el(IconTrash, { size: 12 }), t("action.uninstall")),
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--quiet",
              "aria-expanded": props.expanded ? "true" : "false",
              onClick: props.onToggleDetails
            }, props.expanded ? t("installed.more") : t("installed.detail"))
          )),
        props.expanded
          ? el("div", { className: "dshpm-detail" },
            el("div", { className: "dshpm-detailRow" },
              el("span", { className: "dshpm-detailKey" }, t("detail.version")),
              el("span", { className: "dshpm-detailValue" },
                (bundle.version || "—") + (bundle.latest && bundle.updateAvailable ? " → " + bundle.latest : ""))),
            el("div", { className: "dshpm-detailRow" },
              el("span", { className: "dshpm-detailKey" }, t("installed.rows", { count: rows.length })),
              el("span", { className: "dshpm-detailValue" }, rows.length
                ? el("span", { className: "dshpm-tags" }, rows.map(function (row) {
                  return el("span", { className: "dshpm-tag", key: row.rowId || row.moduleName },
                    (row.rowId || row.moduleName || "") + (row.entryId ? " · " + row.entryId : ""));
                }))
                : "—")),
            el("div", { className: "dshpm-detailRow" },
              el("span", { className: "dshpm-detailKey" }, t("installed.plugins")),
              el("span", { className: "dshpm-detailValue" }, entries.length
                ? el("div", { className: "dshpm-installed" }, entries.map(function (entry) {
                  return el("div", { className: "dshpm-rowHead", key: entry.entryId || entry.moduleName },
                    el("span", null, entry.entryId || entry.moduleName || ""),
                    el("span", { className: "dshpm-rowMeta" }, t("installed.fiber", { phase: formatPhaseLabel(entry.fiberPhase) })),
                    // 开关的可用性必须与「点了会不会真做事」一致：toggleEntry 用 `entryId`
                    // 发请求（`if (!id) return`），所以 entryId 缺失时这颗开关是**假的**——
                    // 看起来能点，点下去静默返回：没有请求、没有回执、状态也不变。
                    // 宿主允许 entryId 为空（index.js 用 optionalText）。缺 id 就不渲染开关，
                    // 改为如实说明「这个条目不能在这里开关」。
                    entry.enabled === undefined ? null
                      : entry.entryId
                        ? el(Switch, {
                            checked: entry.enabled !== false,
                            disabled: locked || props.entryBusyKey === "toggle:" + entry.entryId,
                            label: entry.enabled === false
                              ? t("action.enable") + " " + (entry.entryId || entry.moduleName || "")
                              : t("action.disable") + " " + (entry.entryId || entry.moduleName || ""),
                            onToggle: function () { props.onToggleEntry(entry); }
                          })
                        : el("span", { className: "dshpm-rowMeta" }, t("installed.noEntryId")))
                }))
                : el("span", null, t("installed.noPlugins"))))
          )
          : null
      );
    }

    function InstalledPane(props) {
      var state = props.state;
      if (state.phase === "loading" && !state.data) {
        return el(LoadingState, { text: t("state.loadingInstalled") });
      }
      if (state.phase === "error" && !state.data) {
        return el(ErrorState, { error: state.error, onRetry: props.onRetry });
      }
      var payload = state.data || {};
      var bundles = payload.bundles || [];
      var plugins = payload.plugins || [];
      // **顺序要紧：先报错，再判空**。原来只有 `if (!bundles.length) return EmptyState`，
      // 而失败路径会保留上一次的数据（`{phase:"error", data:{bundles:[]}}`）——
      // 于是「本来就没装插件 + 这次刷新失败」会走到空列表分支，界面写
      // 「这个 profile 还没有装过市场目录里的插件」+「去发现页」，**把断网说成没装插件**，
      // 而且没有重试入口。真正的错误分支（下面的 ErrorState）在有数据时才可达。
      if (state.phase === "error" && bundles.length === 0) {
        return el(ErrorState, { error: state.error, onRetry: props.onRetry });
      }
      if (!bundles.length) {
        return el(EmptyState, {
          title: t("installed.empty.title"),
          body: t("installed.empty.body"),
          actionLabel: t("action.goDiscover"),
          onAction: props.onDiscover
        });
      }
      return el("div", { className: "dshpm-installed" },
        el("div", { className: "dshpm-summary" },
          el("span", null, t("installed.count", { count: bundles.length })),
          state.phase === "loading" ? el("span", null, t("list.updating")) : null),
        state.phase === "error" && state.data
          ? el(ErrorState, { error: state.error, onRetry: props.onRetry })
          : null,
        bundles.map(function (bundle, index) {
          var key = bundle.name;
          return el(BundleRow, {
            key: key,
            index: index,
            bundle: bundle,
            entries: entriesForBundle(plugins, bundle),
            expanded: !!props.expanded[key],
            confirming: props.confirming === key,
            readOnly: props.readOnly,
            busy: props.busyKey === "remove:" + key || props.busyKey === "toggle:" + key || props.busyKey === "install:" + key,
            busyKind: props.busyKey === "remove:" + key ? "remove" : props.busyKey === "install:" + key ? "update" : null,
            batchRunning: props.batchRunning === true,
            entryBusyKey: props.busyKey,
            onToggle: function () { props.onToggleBundle(bundle); },
            onUpdate: function () { props.onUpdateBundle(bundle); },
            onAskRemove: function () { props.onAskRemove(key); },
            onCancelRemove: function () { props.onAskRemove(null); },
            onRemove: function () { props.onRemoveBundle(bundle); },
            onToggleDetails: function () { props.onToggleDetails(key); },
            onToggleEntry: props.onToggleEntry
          });
        })
      );
    }

    // ───────────────────────────── 结果提示 ─────────────────────────────
    /** applied：这次调用到底**装上没有**——回执行不行、批量计成功还是失败，都看它，
     * 与气泡的严重级别（success/warn/info）解耦。restart-required 是「装好了，重启 DSH
     * 才换到新代码」：文件已就位，算成功；以前按 kind!=='success' 计失败，于是带重启的
     * 更新永远汇成「成功 0、失败 2」，看起来像更新坏了。 */
    /**
     * 激活状态 → 文案（v1.1.7）。**这是「不说谎」的落点**：以前只要宿主回 applied 就写
     * 「已安装 {name}」，而 applied 也可能意味着「装进了 node_modules，但 profile 的 bundle
     * 列表里从来没有它」——用户看到绿色回执，插件却永远不出现。
     *
     * 返回 null 表示这次不谈激活（卸载、没有 activation 字段、或状态是 unknown 但用户
     * 已经在别的文案里得到答复），调用方保持原样。
     */
    function activationNotice(activation, name) {
      if (!activation || typeof activation.state !== "string") return null;
      var state = activation.state;
      var installed = activation.installed ? String(activation.installed) : "";
      var expected = activation.expected ? String(activation.expected) : "";
      if (state === "live") {
        // 版本回读对不上：目录说 0.63.0、磁盘上还是 0.62.3，不能照样写「已更新到 0.63.0」。
        if (activation.versionMatches === false && installed) {
          return { kind: "warn", applied: true, text: t("notice.installLiveMismatch", { name: name, installed: installed, expected: expected }) };
        }
        return { kind: "success", applied: true, text: t("notice.installLive", { name: name }) };
      }
      if (state === "inert") return { kind: "warn", applied: false, text: t("notice.installInert", { name: name }) };
      if (state === "broken") return { kind: "error", applied: false, text: t("notice.installBroken", { name: name }) };
      if (state === "disabled") return { kind: "warn", applied: true, text: t("notice.installDisabled", { name: name }) };
      if (state === "unknown") return { kind: "info", applied: true, text: t("notice.installUnknown", { name: name }) };
      // restart 交给原来那条「重启 DSH 后生效」的文案，那里已经有重启横幅配合。
      return null;
    }

    function noticeFromResult(payload, kind, name) {
      var application = payload && payload.application ? String(payload.application) : "applied";
      var changed = !payload || payload.changed !== false;
      var warnings = payload && payload.warnings && payload.warnings.length ? payload.warnings.join("；") : "";
      var base;
      if (!changed && application !== "restart-required" && application !== "overridden" && application !== "cancelled") {
        base = { kind: "info", applied: false, text: t("notice.noChange") };
      } else if (application === "restart-required") {
        base = { kind: "warn", applied: true, text: kind === "remove" ? t("notice.removeRestart", { name: name }) : t("notice.installRestart", { name: name }) };
      } else if (application === "cancelled") {
        base = { kind: "info", applied: false, text: kind === "remove" ? t("notice.removeCancelled", { name: name }) : t("notice.installCancelled", { name: name }) };
      } else if (application === "overridden") {
        base = { kind: "warn", applied: true, text: t("notice.installOverridden", { name: name }) };
      } else {
        base = { kind: "success", applied: true, text: kind === "remove" ? t("notice.removeApplied", { name: name }) : t("notice.installApplied", { name: name }) };
      }      // 激活回读**覆盖**默认那句「已安装」：默认那句是在没证据的情况下说的，
      // 现在有证据了（或有「读不到」的证据），就该按证据说。
      // 唯一例外：`changed === false`（宿主说这次什么都没改）时保留「没有产生变更」——
      // 那句本身是重要信息，用「并已在运行」盖掉就等于把「你的更新其实没落地」瞒下来了。
      // 但**版本对不上**时必须盖：那正是「说更新了、磁盘还是旧版」的那一类。
      var detailed = activationNotice(payload && payload.activation, name);
      var mismatch = !!(payload && payload.activation && payload.activation.versionMatches === false);
      if (detailed !== null && (changed !== false || mismatch)) base = detailed;
      if (warnings) base.text = base.text + " · " + t("notice.installWarnings", { warnings: warnings });
      return base;
    }

    /**
     * 开关结果 → 回执。**必须看 `changed` / `application`，不能只看有没有 `error`**：
     * 宿主的 `/toggle` 用 `ok = application === 'cancelled' ? true : (error === null && application !== 'failed')`，
     * 所以 `{application:'cancelled'}`（不带 error）会**正常 resolve**，`changed:false` 也一样。
     * 以前两条开关路径各自手写 `kind: payload.error ? "error" : "success"` 且文案恒为
     * 「已启用/已停用 {name}」——于是宿主明明说「什么都没改 / 已取消」，界面照样报绿色成功；
     * 而带 error 的 cancelled 还会渲染成「红壳 + 成功文案」（级别与正文自相矛盾）。
     * 安装/卸载早就走 noticeFromResult 处理这两种情况，开关是唯一漏掉的两处。
     */
    function toggleNotice(payload, name, next) {
      var application = payload && payload.application ? String(payload.application) : "applied";
      var changed = !payload || payload.changed !== false;
      var successText = next ? t("notice.toggleEnabled", { name: name }) : t("notice.toggleDisabled", { name: name });
      if (application === "cancelled") {
        return { kind: "info", applied: false, text: t("notice.toggleCancelled", { name: name }) };
      }
      // restart-required / overridden 与「什么都没改」是**两回事**：前者已经写进去了，
      // 只是还没生效。和 noticeFromResult 保持同一条规则（那个 !changed 分支同样把这两个排除）。
      if (!changed && application !== "restart-required" && application !== "overridden") {
        return { kind: "info", applied: false, text: t("notice.noChange") };
      }
      // 宿主在 hmr 缺席时给 restart-required：设置写进了 patch 文件，但要重启才生效。
      // 修复前这里直接落到「已启用 {name}」绿色成功——把「还没生效」说成了「已生效」。
      if (application === "restart-required") {
        return {
          kind: "warn",
          applied: true,
          text: next ? t("notice.toggleRestartOn", { name: name }) : t("notice.toggleRestartOff", { name: name })
        };
      }
      // 宿主的 setPluginEnabled 会在「写进去了、但更高优先级的覆盖层赢了」时 return "overridden"
      // （宿主 index.js:1658）。修复前同样报「已启用 {name}」——那是最糟的一种：用户以为切了，
      // 实际状态没变，而且还会有绿色回执替这个假象背书。
      // applied=false 与安装路径的 true 不一样，是**有意的**：安装问「包装上了吗」（装上了），
      // 开关问「状态真的切过去了吗」（没有）。两个问题不同，答案就该不同。
      if (application === "overridden") {
        return {
          kind: "warn",
          applied: false,
          text: next ? t("notice.toggleOverriddenOn", { name: name }) : t("notice.toggleOverriddenOff", { name: name })
        };
      }
      return { kind: "success", applied: true, text: successText };
    }

    var SORTS = [
      { id: "top", key: "sort.top" },
      { id: "new", key: "sort.new" },
      { id: "downloads", key: "sort.downloads" },
      { id: "name", key: "sort.name" }
    ];

    // ───────────────────── 可更新插件页（第三个页签：发现 / 已安装 / 可更新） ─────────────────────
    // 由「头部按钮就地展开的抽屉」搬成页签——用户圈的那个位置（已安装右边再开一个）。
    // 页头右侧两个按钮（用户指定）：左边是**合并后的单按钮状态机**——没检查过显示
    //「检查更新」，按下重读列表；检查过且有更新变成「一键更新（N）」，没有则变成
    //「重新检查」（原页脚那颗独立按钮合并进来了）。右边管市场本体（插件市场更新）。
    // 两颗按钮样式统一（primary）；忙碌态与回执气泡沿用原来那套。
    // 逐个点仍然保留：一次只改一个依赖、失败不连坐，想稳就一条条来。
    function UpdatesPane(props) {
      var state = props.state || {};
      var bundles = props.bundles || [];
      var results = props.results || {};
      var updateBundle = props.onUpdate;
      var batch = props.batch || null;
      var batchRunning = !!(batch && batch.running);
      // 状态机（用户第四轮改正）：**「有更新」这个事实已经在手时，按钮就该是「一键更新（N）」**，
      // 不该先逼用户点一下「检查更新」。那一页打开时列表与页签角标早就把 N 个可更新插件摆出来了，
      // 按钮却还写「检查更新」——让用户去「检查」一件刚刚已经确认的事（用户原话：
      // 「有更新时检查更新状态机应该为一键更新」）。
      // 所以主动作由**数据**决定，`checked` 只用来区分「没有更新时」显示「检查更新」还是
      // 「重新检查」——那个区分是有意义的（没检查过就不许谎称「已检查」），继续保留。
      var checked = props.checkPhase === "checked";
      var checking = state.phase === "loading";
      var canUpdateAll = bundles.length > 0;
      var self = props.self || {};
      var hasCatalog = props.catalogUpdated !== null && props.catalogUpdated !== undefined;
      var subtitle = batchRunning
        ? t("updates.batchProgress", { done: batch.done, total: batch.total })
        : (props.count || 0) > 0
          ? t("updates.subtitle", { installed: props.installedCount || 0, count: props.count || 0 })
          : t("updates.subtitleEmpty", { installed: props.installedCount || 0 });

      // 「有旧数据 + 这次读取失败」的提示。**必须声明在组件作用域**：它被 body() 与
      // 下面的 return 共用；写在 body() 里会让外层读到 undefined（`undefined !== null`
      // 成立）→ `staleFailure.message` 抛 TypeError，整个「可更新」页渲染不出来
      // ——我第一版就犯了这个错，靠真实浏览器 e2e 的 [2c]/[4b] 才抓到。
      var staleFailure = state.phase === "error" && state.data ? errorCopy(state.error) : null;

      function body() {
        if (state.phase === "loading" && !state.data) {
          return el("div", { className: "dshpm-drawerList" },
            el("div", { className: "dshpm-drawerLoading" }, el(IconSpinner, { size: 12 }), el("span", null, t("updates.loading"))),
            el("div", { className: "dshpm-updateRow dshpm-updateRow--ghost" }),
            el("div", { className: "dshpm-updateRow dshpm-updateRow--ghost" }));
        }
        if (state.phase === "error" && !state.data) {
          var failure = errorCopy(state.error);
          return el(EmptyState, {
            title: t("updates.failed.title"),
            body: t("updates.failed.body", { reason: failure.message || failure.title }),
            actionLabel: t("action.retry"),
            onAction: props.onReload
          });
        }
        // **保留旧数据时的失败也要说出来**（v1.2.0 修）：这个页签此前**没有任何**
        // 「有数据 + 出错」分支（发现页与已安装页都有）。`loadInstalled` 失败时会保留
        // 上一次的 data，于是界面上看不出这次读取失败：要么继续显示过期的可更新列表，
        // 要么——数据本来是空的时候——显示绿色语气的「全部都是最新」，
        // **把一次网络失败说成「检查过了，没有更新」**，而且这个页签也没有重试入口。
        // 有旧数据但这次读取失败、且列表为空：不显示「全部都是最新」（那是失败被说成成功）。
        if (staleFailure !== null && bundles.length === 0) {
          return el(EmptyState, {
            title: t("updates.failed.title"),
            body: t("updates.failed.body", { reason: staleFailure.message || staleFailure.title }),
            actionLabel: t("action.retry"),
            onAction: props.onReload
          });
        }
        // 顺序很关键：有可更新条目就直接列出来——「有没有新版本」是 /installed 自己带回来的
        // （宿主把目录 join 进去了），不需要目录页的数据也加载完。只有在**列表为空**时才需要
        // 区分「真的都最新」和「目录根本没读到，所以判断不了」。
        if (bundles.length === 0 && !hasCatalog) {
          return el(EmptyState, {
            title: t("updates.noCatalog.title"),
            body: t("updates.noCatalog.body"),
            actionLabel: t("action.refresh"),
            onAction: props.onRefreshCatalog
          });
        }
        if (bundles.length === 0) {
          return el(EmptyState, {
            title: t("updates.empty.title"),
            body: t("updates.empty.body", { updated: props.catalogUpdated || "?" })
          });
        }
        return el("div", { className: "dshpm-drawerList" }, bundles.map(function (bundle, index) {
          var key = bundle.name;
          var busy = props.busyKey === "install:" + key;
          var result = results[key] || null;
          return el("div", {
            key: key,
            className: "dshpm-updateRow",
            "data-busy": busy ? "true" : "false",
            "data-done": result && result.ok ? "true" : "false",
            style: { animationDelay: Math.min(index, 12) * 24 + "ms" }
          },
            el("div", { className: "dshpm-updateMain" },
              el("div", { className: "dshpm-updateName" }, bundle.name),
              el("div", { className: "dshpm-updateVersions" },
                el("span", { className: "dshpm-versionFrom" }, "v" + (bundle.version || "?")),
                el("span", { className: "dshpm-versionArrow", "aria-hidden": "true" }, "→"),
                el("span", { className: "dshpm-versionTo" }, "v" + (bundle.latest || "?"))),
              bundle.description ? el("div", { className: "dshpm-updateDesc" }, descriptionText(bundle.description)) : null,
              result
                ? el("div", { className: "dshpm-updateResult", "data-ok": result.ok ? "true" : "false" },
                  result.ok ? el(IconCheck, { size: 12 }) : el(IconAlert, { size: 12 }),
                  el("span", null, result.text))
                : null),
            el("div", { className: "dshpm-updateActions" },
              el("button", {
                type: "button",
                className: "dshpm-btn dshpm-btn--primary",
                disabled: busy || props.readOnly === true || batchRunning,
                "aria-busy": busy ? "true" : "false",
                title: props.readOnly ? t("readonly.body") : t("action.update", { version: bundle.latest }),
                onClick: function () { updateBundle(bundle); }
              }, busy ? el(IconSpinner, { size: 12 }) : el(IconDownload, { size: 12 }),
                busy ? t("action.updating") : t("action.update", { version: bundle.latest })))
          );
        }));
      }

      return el("section", {
        className: "dshpm-updatesPanel dshpm-updatesPage",
        "aria-label": t("updates.title")
      },
        el("div", { className: "dshpm-drawerHead" },
          el("span", { className: "dshpm-drawerIcon" }, el(IconLayers, { size: 15 })),
          el("div", { className: "dshpm-drawerHeading" },
            el("div", { className: "dshpm-drawerTitle" }, t("updates.title")),
            el("div", { className: "dshpm-drawerSubtitle" }, subtitle)),
          // 两个按钮（样式统一）：左边是合并后的状态机（检查更新 / 一键更新 / 重新检查），
          // 右边管市场本体（插件市场更新，同一套「按下检查 → 有更新给更新、没更新给重新检查」）。
          // 忙碌态与回执气泡就是从被删掉的那两个头部按钮上搬过来的。
          el("div", { className: "dshpm-updatesActions" },
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--primary",
              disabled: batchRunning || checking || (props.readOnly === true && canUpdateAll),
              "aria-busy": (batchRunning || checking) ? "true" : "false",
              title: props.readOnly && canUpdateAll ? t("readonly.body")
                : batchRunning ? t("action.updatingAll")
                  : canUpdateAll ? t("action.updateAllCount", { count: bundles.length })
                    : checked ? t("action.recheckSelf") : t("action.checkUpdates"),
              onClick: canUpdateAll ? props.onUpdateAll : props.onCheckUpdates
            }, batchRunning || checking ? el(IconSpinner, { size: 13 })
              : canUpdateAll ? el(IconUpgrade, { size: 13 }) : el(IconRefresh, { size: 13 }),
              batchRunning ? t("action.updatingAll")
                : canUpdateAll ? t("action.updateAllCount", { count: bundles.length })
                  : checked ? t("action.recheckSelf") : t("action.checkUpdates")),
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--primary" + (self.available ? " dshpm-btn--pulse" : ""),
              disabled: self.busy === true,
              "aria-busy": self.busy ? "true" : "false",
              "data-state": self.available ? "available" : self.phase,
              title: self.title || t("action.checkSelf"),
              onClick: self.available ? self.onApply : self.onCheck
            }, self.busy ? el(IconSpinner, { size: 12 })
              : self.available ? el(IconUpgrade, { size: 13 })
                // ready/done 都是对勾态：检查完没有更新、装完成功——两处都得像「已确认」。
                : (self.phase === "ready" || self.phase === "done") ? el(IconCheck, { size: 13 })
                  : el(IconUpgrade, { size: 13 }),
              self.label || t("action.checkSelf")))),
        el("div", { className: "dshpm-drawerHint" }, t("updates.hint")),
        // 有旧数据且这次读取失败：列表还用旧的，但必须明说「这是旧的、这次没读到」，
        // 否则用户会以为看到的是刚才那次「检查更新」的结果。
        staleFailure !== null
          ? el("div", {
              className: "dshpm-staleNote",
              role: "status"
            },
            el(IconAlert, { size: 12 }),
            el("span", null, t("updates.staleFailure", { reason: staleFailure.message || staleFailure.title })),
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--quiet",
              onClick: props.onReload
            }, t("action.retry")))
          : null,
        el("div", { className: "dshpm-drawerBody" }, body()));
    };

    // ───────────────────────────── 市场主面板 ─────────────────────────────
    function MarketPage() {
      useChangeTick();
      ensureStyles();

      var tabState = React.useState("discover");
      var tab = tabState[0];
      var setTab = tabState[1];

      var statusState = React.useState({ phase: "loading", data: null, error: null });
      var status = statusState[0];
      var setStatus = statusState[1];

      var discoverState = React.useState({ phase: "loading", data: null, error: null });
      var discover = discoverState[0];
      var setDiscover = discoverState[1];

      var installedState = React.useState({ phase: "loading", data: null, error: null });
      var installed = installedState[0];
      var setInstalled = installedState[1];

      var queryInputState = React.useState("");
      var queryInput = queryInputState[0];
      var setQueryInput = queryInputState[1];
      var queryInputRef = React.useRef("");

      var queryState = React.useState("");
      var query = queryState[0];
      var setQuery = queryState[1];

      var categoryState = React.useState("all");
      var category = categoryState[0];
      var setCategory = categoryState[1];

      var sortState = React.useState("top");
      var sort = sortState[0];
      var setSort = sortState[1];

      var pageState = React.useState(1);
      var page = pageState[0];
      var setPage = pageState[1];

      // 两个独立的重读计数器（性能）：写操作只该重读**已安装列表**，刷新目录才该重读**目录**。
      // 早先这里是一个共享 tick，三个 effect 全挂在它上面——点一次「停用/卸载」会连带触发
      // /status + /catalog + /installed 三个请求，其中前两个是浪费（status 只在启动时定下来，
      // catalog 与写操作无关，却要整份重抓 4412 条）。拆开后每个动作只打它真正需要的那一路。
      var installedTickState = React.useState(0);
      var installedTick = installedTickState[0];
      var bumpInstalledTick = installedTickState[1];

      var catalogTickState = React.useState(0);
      var catalogTick = catalogTickState[0];
      var bumpCatalogTick = catalogTickState[1];

      var jobState = React.useState(null);
      var job = jobState[0];
      var setJob = jobState[1];

      var pendingState = React.useState(null);
      var pending = pendingState[0];
      var setPending = pendingState[1];

      var noticeState = React.useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];
      // 退场动画：收到关闭信号先让气泡「沉下去」（data-open="false"），200ms 后才真正卸载。
      // 直接 setNotice(null) 的话，气泡是凭空消失的——这是这轮「弹出显示效果」的一部分。
      var noticeClosingState = React.useState(false);
      var noticeClosing = noticeClosingState[0];
      var setNoticeClosing = noticeClosingState[1];
      var noticeTimerRef = React.useRef(null);
      // 退场计时器是为**哪一条**回执起的：到期时只准清掉同一条。
      // 不记这个的话，退场途中（200ms 窗口内）来了新回执，旧计时器会把**新回执**一起
      // setNotice(null)——用户刚看到 200ms 就没了，而新回执本该活 NOTICE_DISMISS_MS。
      var noticeClosingRef = React.useRef(null);

      function dismissNotice() {
        if (noticeClosing) return;
        setNoticeClosing(true);
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeClosingRef.current = notice;
        noticeTimerRef.current = setTimeout(function () {
          noticeTimerRef.current = null;
          if (!mountedRef.current) return;
          // 「要关的那条」必须先**取值存进局部变量**再交给 updater：函数式 updater 是
          // **排队等渲染时才执行**的，若在它之前就把 ref 清成 null，比较时两边都是 null，
          // 判定失败 → 回执永远关不掉（页面会一直挂着那张气泡）。
          // 这个 bug 真发生过：正则形状断言没抓住，**真实浏览器 e2e 抓到了**。
          var closing = noticeClosingRef.current;
          noticeClosingRef.current = null;
          setNotice(function (current) {
            return current === closing ? null : current;
          });
          setNoticeClosing(false);
        }, NOTICE_CLOSE_MS);
      }

      // 退场途中来了新回执：立刻回到「开着」的状态显示它，不能顶着 opacity:0 装消失。
      React.useEffect(function () {
        if (notice) setNoticeClosing(false);
      }, [notice]);

      // 新回执顶掉上一条的退场计时，避免旧计时器把新回执提前卸载。
      React.useEffect(function () {
        return function () {
          if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        };
      }, []);

      // ── 重启助手 ── pending：本轮会话里有改动装好待重启；phase：idle / restarting / failed。
      // **不能只放页面内存**（v1.2.0 第六轮修）：以前这里写着「刷新后没了就没了」，
      // 但「待重启」是**磁盘上的事实**，不会因为刷新而消失——主机进程仍在跑旧代码。
      // 后果：用户更新完插件随手刷新一下，横幅消失 → 他以为已经生效（真实案例：用户更新
      // dsh-mobile 后问「是默认生效的吗」）。
      // 现在由**宿主半**记账（node 模块级变量，`/status` 的 `pendingRestart`），页面挂载时水合；
      // 宿主真重启时那个变量自然清空，语义自动正确，不需要任何落盘或过期逻辑。
      var restartState = React.useState(null);
      var restart = restartState[0];
      var setRestart = restartState[1];
      var restartProbeRef = React.useRef(null);
      var restartSawDownRef = React.useRef(false);

      // ── 重启询问弹窗（v1.2.0）──
      // ask = null | { names: string[], marketVersion: string|null, phase: "idle"|"restarting" }
      var restartAskState = React.useState(null);
      var restartAsk = restartAskState[0];
      var setRestartAsk = restartAskState[1];
      /** 本轮待重启的包名（累积去重；批量更新会连续写很多条）。 */
      var restartNamesRef = React.useRef([]);
      /** 已经就「哪些名字」问过用户了：**新名字才会再问一次**。
       *  没有它的话，用户点过「稍后重启」之后再装同一个包会被反复打扰；
       *  而完全不再问又会漏掉「后来又装了别的东西」这种真的需要再提醒的情况。 */
      var askedRestartRef = React.useRef({ names: {}, market: false });
      /** 弹窗开着时的同步可见判定（读 ref，而不是 state——同一批事件里 state 还是旧值）。 */
      var restartAskRef = React.useRef(null);
      restartAskRef.current = restartAsk;

      /**
       * 宿主能不能一键重启（`/status` 的 `restart.available`）。
       *
       * 桌面壳管理的宿主里一键重启**必然失败**且代价是「应用整个关掉、不会自己回来」
       * （壳持有单实例锁，替代进程被挡下后静默退出 —— 见 restart.js 的完整推理）。
       * 所以判定为不可用时：**不弹询问窗、不显示重启横幅按钮**，改为直接告诉用户
       * 「这个改动要重启才生效，桌面版请关掉窗口再打开」。把不可能的动作摆给用户点，
       * 比不给按钮更糟。
       * 默认 true（读不到 /status 时保持旧行为）；只有宿主明确说 false 才降级。
       */
      var restartAvailable = !(status.data && status.data.restart && status.data.restart.available === false);

      /**
       * 记一笔「这个改动要重启才生效」，并在**合适的时机**弹一次询问。
       *
       * 为什么要 `defer`：`noteRestartFrom` 有 5 个调用点，其中安装那个是安装/更新/
       * 批量共用的一条路径。如果每次写操作都直接弹窗，「一键更新（N）」就会**弹 N 次**——
       * 这是这个功能最容易做坏的地方。所以批量里的每一步都带 `defer:true` 只记账，
       * 由批量收尾（finish）统一弹一次；单个操作则当场弹。
       */
      function noteRestartFrom(payload, options) {
        if (!payload) return;
        var needs = payload.application === "restart-required" || payload.requiresRestart === true;
        if (!needs) return;
        var opts = options || {};
        var label = opts.label ? String(opts.label) : null;
        if (label !== null && restartNamesRef.current.indexOf(label) === -1) {
          restartNamesRef.current.push(label);
        }
        setRestart(function (previous) {
          return { pending: true, phase: previous && previous.phase === "restarting" ? "restarting" : "idle" };
        });
        if (opts.defer !== true) maybeAskRestart(opts.marketVersion ? String(opts.marketVersion) : null);
      }

      /**
       * 用 `/status` 的 `pendingRestart` 水合横幅（v1.2.0 第六轮）。
       *
       * 为什么需要：`noteRestartFrom` 只在**收到写操作响应那一刻**记一笔，记在页面内存里，
       * 刷新即失。而「待重启」是磁盘事实，刷新不会让它消失——宿主仍在跑旧代码。
       * 用户随手刷新后横幅消失，就会以为已经生效（真实案例：更新 dsh-mobile 后问「是默认生效的吗」）。
       *
       * 三条边界：
       *   - **不覆盖正在进行中的重启**（phase 已是 restarting 就别退回 idle，否则按钮会
       *     从「正在重启」突然变回可点）；
       *   - **不弹窗**。刷新页面不该突然跳出「立即重启 / 稍后重启」——那是一次打扰；
       *     横幅常驻已经足够说明「为什么还没生效」，用户想重启会自己去点。
       *     （弹窗只在**当场做完写操作**时弹，见 maybeAskRestart。）
       *   - 宿主说没有待重启项时**什么都不做**，而不是把已有的清掉：宿主刚重启过的话
       *     页面本来也会重载，这里保守一点不会造成假阳性。
       */
      function hydrateRestartFromStatus(payload) {
        var pendingRestart = payload && payload.pendingRestart;
        if (!pendingRestart || typeof pendingRestart !== "object") return;
        var names = Array.isArray(pendingRestart.names) ? pendingRestart.names : [];
        var marketVersion = pendingRestart.marketVersion ? String(pendingRestart.marketVersion) : null;
        if (names.length === 0 && marketVersion === null) return;
        for (var i = 0; i < names.length; i++) {
          var name = String(names[i]);
          if (restartNamesRef.current.indexOf(name) === -1) restartNamesRef.current.push(name);
        }
        setRestart(function (previous) {
          return { pending: true, phase: previous && previous.phase === "restarting" ? "restarting" : "idle" };
        });
      }

      /**
       * 该不该弹询问：**只有出现「没问过的名字」时才弹**。
       * 已经问过、用户选了「稍后重启」的那些不再打扰（横幅还在，随时能重启）。
       */
      function maybeAskRestart(marketVersion) {
        if (restartAskRef.current !== null) return; // 已经开着，不重复弹
        // 宿主自己说了不能一键重启（桌面壳持有单实例锁）：这里**不弹**「立即重启」。
        // 弹了就等于把一个必然失败、且失败代价是「应用整个关掉不回来」的动作摆给用户点。
        // 改为走下面的横幅/提示文案说明「手动重启」。
        if (!restartAvailable) return;
        var fresh = [];
        var names = restartNamesRef.current;
        for (var i = 0; i < names.length; i++) {
          if (askedRestartRef.current.names[names[i]] !== true) fresh.push(names[i]);
        }
        var freshMarket = marketVersion && !askedRestartRef.current.market ? marketVersion : null;
        if (fresh.length === 0 && freshMarket === null) return;
        for (var j = 0; j < fresh.length; j++) askedRestartRef.current.names[fresh[j]] = true;
        if (freshMarket !== null) askedRestartRef.current.market = true;
        setRestartAsk({ names: fresh, marketVersion: freshMarket, phase: "idle" });
      }

      /** 「稍后重启」= 关掉弹窗；**不改动已装好的东西**，横幅仍在顶部等待。 */
      function dismissRestartAsk() {
        setRestartAsk(null);
      }

      /** 「立即重启」：弹窗切到重启中（比 toast 更醒目地说明「正在重启」），并真的发起重启。 */
      function restartNow() {
        setRestartAsk(function (previous) {
          return previous === null ? previous : { names: previous.names, marketVersion: previous.marketVersion, phase: "restarting" };
        });
        startRestart();
      }

      function stopRestartProbe() {
        if (restartProbeRef.current !== null) {
          clearInterval(restartProbeRef.current);
          restartProbeRef.current = null;
        }
      }

      /**
       * 探活回路：宿主退出期间 /status 必然打不通（先见过「死」），宿主回来后
       * /status 才重新通——那一下才刷新页面。没有「先见过死」这道闸，旧进程
       * 还没退出时的 200 会被误判成新进程，页面白刷新而重启还没发生。
       */
      function beginRestartProbe() {
        stopRestartProbe();
        restartSawDownRef.current = false;
        var deadline = Date.now() + 60000;
        restartProbeRef.current = setInterval(function () {
          if (!mountedRef.current) {
            stopRestartProbe();
            return;
          }
          if (Date.now() >= deadline) {
            stopRestartProbe();
            setRestart({ pending: true, phase: "failed" });
            setNotice({ kind: "warn", text: t("notice.restartTimeout") });
            return;
          }
          api.status().then(function () {
            if (restartSawDownRef.current) {
              stopRestartProbe();
              window.location.reload();
            }
          }).catch(function () {
            // 宿主死掉期间的一切失败都是预期的：这就是「正在重启」的那一下。
            restartSawDownRef.current = true;
          });
        }, 1500);
      }

      function startRestart() {
        if (restart && restart.phase === "restarting") return Promise.resolve();
        // 与横幅按钮同一口径的兜底：写操作还在跑就**不发**重启请求（v1.2.0 第六轮）。
        // 按钮已经禁用，但弹窗里的「立即重启」是另一个入口，这里不挡就留了个后门。
        // 重启会让宿主在 900ms 后退出，写了一半的 package.json / patch 文件就那样留在磁盘上。
        if (job || (batch && batch.running)) {
          setNotice({ kind: "warn", text: t("restart.busy") });
          return Promise.resolve();
        }
        setRestart({ pending: true, phase: "restarting" });
        setNotice({ kind: "info", text: t("notice.restartQueued") });
        return api.restart().then(function () {
          beginRestartProbe();
        }).catch(function (error) {
          // 助手没起来：宿主**没有**退出，如实报错并把按钮交还给用户（可以再点一次）。
          setRestart({ pending: true, phase: "failed" });
          // 弹窗必须关掉：否则它会永远停在「正在重启」，而重启根本没发生。
          setRestartAsk(null);
          setNotice({ kind: "error", error: error });
        });
      }

      React.useEffect(function () {
        return function () { stopRestartProbe(); };
      }, []);

      var expandedState = React.useState({});
      var expanded = expandedState[0];
      var setExpanded = expandedState[1];

      var confirmState = React.useState(null);
      var confirming = confirmState[0];
      var setConfirming = confirmState[1];

      var copiedState = React.useState(null);
      var copied = copiedState[0];
      var setCopied = copiedState[1];

      // 市场自身更新的状态机：idle → checking → ready（可能 updateAvailable）→ installing → ready
      // 状态在**模块级**（启动时的自动检查写过一次），这里只是订阅它——有新版本时页面一打开
      // 就是「更新到 x.y.z」；没更新时仍是初始的「插件市场更新」（「再次检查」只属于手动点过的那次）。
      var selfState = React.useState(getSelfCheck);
      var selfUpdate = selfState[0];
      var setSelfUpdate = selfState[1];
      React.useEffect(function () {
        return subscribeSelfCheck(function (next) { setSelfUpdate(next); });
      }, []);

      // 可更新页里每一条的更新结果，按包名记：进度与成功/失败都留在原地，不用去翻提示条。
      var updateResultsState = React.useState({});
      var updateResults = updateResultsState[0];
      var setUpdateResults = updateResultsState[1];

      // 一键更新的进度：null = 没在跑；{ running, total, done, ok, fail } = 进行中。
      var batchState = React.useState(null);
      var batch = batchState[0];
      var setBatch = batchState[1];

      // 「检查更新」按钮的三态（用户指定）：idle（没点过）→ 按下重读列表 → checked，
      // checked 后按钮按结果变成「一键更新（N）」或「重新检查」。
      // 列表在页签打开时就自动加载，但那不算「检查过」——按钮不抢跑。
      var checkState = React.useState("idle");
      var checkPhase = checkState[0];
      var setCheckPhase = checkState[1];

      /** 「发现 N 个可更新」每次挂载只提示一次，别在每次重读列表时重复弹。 */
      var announcedRef = React.useRef(false);
      // 待触发的「检查更新」回调；见 loadInstalled。跨请求保留，成功时消费一次。
      var pendingInstalledDoneRef = React.useRef(null);

      var mountedRef = React.useRef(true);
      var registryRef = React.useRef({});
      var tokenRef = React.useRef(0);
      // 在跑作业的 key 集合（同步可见）：守卫重复点击时不能读 state，见 jobRunning。
      var jobKeysRef = React.useRef({});

      function startRequest(key) {
        var previous = registryRef.current[key];
        if (previous && previous.controller) {
          try {
            previous.controller.abort();
          } catch (abortError) {
            // 命名单个 abort 失败：旧请求已结束或控制器已失效，继续发新请求即可。
          }
        }
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var token = ++tokenRef.current;
        registryRef.current[key] = { controller: controller, token: token };
        return { token: token, signal: controller ? controller.signal : undefined };
      }

      function isCurrent(key, token) {
        if (!mountedRef.current) return false;
        var bag = registryRef.current[key];
        return !!bag && bag.token === token;
      }

      function abortKey(key) {
        var bag = registryRef.current[key];
        if (!bag || !bag.controller) return;
        try {
          bag.controller.abort();
        } catch (abortError) {
          // 单个请求的控制器已失效时无需上报，下一批请求会自己拿到新 token。
        }
        // 抬高 token：即使宿主忽略 abort，旧响应也会被 isCurrent 丢掉。
        bag.token = ++tokenRef.current;
      }

      function abortAll() {
        var keys = Object.keys(registryRef.current);
        for (var i = 0; i < keys.length; i++) {
          var bag = registryRef.current[keys[i]];
          if (bag && bag.controller) {
            try {
              bag.controller.abort();
            } catch (abortError) {
              // 卸载路径：尽力取消在途请求，失败不需要上报。
            }
          }
        }
        registryRef.current = {};
      }

      React.useEffect(function () {
        mountedRef.current = true;
        return function () {
          mountedRef.current = false;
          abortAll();
          if (RUNTIME.search) RUNTIME.search.cancel();
        };
      }, []);

      function loadStatus() {
        var bag = startRequest("status");
        setStatus(function (previous) {
          return { phase: "loading", data: previous.data, error: null };
        });
        api.status(bag.signal).then(function (payload) {
          if (!isCurrent("status", bag.token)) return;
          setStatus({ phase: "ready", data: payload, error: null });
          hydrateRestartFromStatus(payload);
        }).catch(function (error) {
          if (error && error.aborted) return;
          if (!isCurrent("status", bag.token)) return;
          setStatus(function (previous) {
            return { phase: "error", data: previous.data, error: error };
          });
        });
      }

      function loadCatalog() {
        var bag = startRequest("catalog");
        setDiscover(function (previous) {
          return { phase: "loading", data: previous.data, error: null };
        });
        api.catalog({ query: query, category: category, sort: sort, page: page, pageSize: PAGE_SIZE }, bag.signal)
          .then(function (payload) {
            if (!isCurrent("catalog", bag.token)) return;
            setDiscover({ phase: "ready", data: payload, error: null });
          })
          .catch(function (error) {
            if (error && error.aborted) return;
            if (!isCurrent("catalog", bag.token)) return;
            setDiscover(function (previous) {
              // 保留上一份数据：分页或搜索失败时页面不该变成空白。
              return { phase: "error", data: previous.data, error: error };
            });
          });
      }

      /**
       * options.announce：由头部「更新插件」主动触发时置位——**每次都给一句回执**
       * （有更新 / 全部最新 / 失败），和「检查市场更新」一个待遇；页面挂载与后台重读
       * 不置位，免得每次 tick 重读都弹一条提示。
       */
      function loadInstalled(options) {
        var announce = !!(options && options.announce);
        // 「检查更新」的回调要能挺过一次被顶替的重读（v1.2.0 修）：
        // startRequest 会 abort 掉同 key 的上一个请求，而 abort 路径在 isCurrent 处
        // 直接 return，**永远走不到下面的 onDone**。于是「点了检查更新，紧接着又点
        // 可更新页签」会让按钮永远停在「检查更新」，而 toast 已经说了有几个新版本
        // ——回执与按钮状态自相矛盾。
        // 把待执行的回调挂在这里，由**最终完成的那次**请求统一触发。
        if (options && typeof options.onDone === "function") pendingInstalledDoneRef.current = options.onDone;
        var bag = startRequest("installed");
        setInstalled(function (previous) {
          return { phase: "loading", data: previous.data, error: null };
        });
        api.installed(bag.signal).then(function (payload) {
          if (!isCurrent("installed", bag.token)) return;
          setInstalled({ phase: "ready", data: payload, error: null });
          var count = publishUpdateCount(payload && payload.bundles);
          // 「检查更新」按钮等这个回调才能切换三态（检查过 → 一键更新 / 重新检查）。
          // 失败路径不回调：按钮留在「检查更新」，错误回执已经另发了。
          // options 在挂载时的无参调用里是 undefined——必须先判再取。
          var onDone = pendingInstalledDoneRef.current;
          pendingInstalledDoneRef.current = null;
          if (typeof onDone === "function") onDone(count);
          if (announce) {
            announcedRef.current = true;
            var installedTotal = payload && payload.bundles ? payload.bundles.length : 0;
            setNotice(count > 0
              ? { kind: "info", text: t("notice.updatesFound", { count: count }) }
              : { kind: "success", text: t("notice.updatesNone", { installed: installedTotal }) });
            return;
          }
          if (count > 0 && !announcedRef.current) {
            announcedRef.current = true;
            setNotice({ kind: "info", text: t("notice.updatesFound", { count: count }) });
          }
        }).catch(function (error) {
          if (error && error.aborted) return;
          if (!isCurrent("installed", bag.token)) return;
          // 读失败就把待触发的回调丢掉：否则它会被**下一次**无关的成功重读消费掉，
          // 于是「检查更新」按钮会在一次跟它无关的刷新后突然变成「一键更新」。
          pendingInstalledDoneRef.current = null;
          setInstalled(function (previous) {
            return { phase: "error", data: previous.data, error: error };
          });
          // 用户主动点的按钮必须有失败回执：静默失败看起来就是「点了没反应」。
          if (announce) setNotice({ kind: "error", error: error });
        });
      }

      // /status 只回 plugin.version 与 manager.available——两者只在启动时定下来，写操作绝不改变。
      // 因此只在挂载时读一次，不挂任何 tick：早先挂在 tick 上会让每次「停用/卸载」都白打一个请求，
      // 并把面板推回 loading 相态闪一下。
      React.useEffect(function () {
        loadStatus();
      }, []);

      React.useEffect(function () {
        if (tab !== "discover") return undefined;
        loadCatalog();
        return function () {
          // 换页签或改搜索条件时立刻放弃上一批结果，避免旧响应盖住新查询。
          abortKey("catalog");
        };
      }, [tab, query, category, sort, page, catalogTick]);

      // 成功/信息类提示自己收起（下面的进度线走完就是它消失的时刻）；
      // 警告与错误留着——它们要求用户先做决定。
      React.useEffect(function () {
        if (!notice || (notice.kind !== "success" && notice.kind !== "info")) return undefined;
        var timer = setTimeout(function () {
          if (!mountedRef.current) return;
          dismissNotice();
        }, NOTICE_DISMISS_MS);
        return function () { clearTimeout(timer); };
      }, [notice]);

      // 已安装列表两个页签都要拉：头部「更新插件」的角标、抽屉列表，以及侧边栏入口的
      // 角标都靠它；装完/更新/开关/卸载后 bumpInstalledTick 也要重读一次。
      React.useEffect(function () {
        loadInstalled();
        return function () {
          abortKey("installed");
        };
      }, [installedTick]);

      // 每小时的自动检查（见 startUpdateScheduler）会通知这里重读已安装列表；
      // 只有「多出新更新」时才给回执，否则每小时弹一条提示会很吵。角标不依赖这里，
      // 它读的是模块级计数，后台那次检查会直接更新它。
      React.useEffect(function () {
        return subscribeInstalledRefresh(function (info) {
          if (!mountedRef.current) return;
          loadInstalled({ announce: !!(info && info.increased && info.count > 0) });
        });
      }, []);

      /** 写操作（装/卸/开关/更新）之后重读已安装列表——不碰目录，也不重取 /status。 */
      function bumpTick() {
        bumpInstalledTick(function (n) { return n + 1; });
      }

      /** 只有「刷新目录」才需要重抓目录：目录内容与安装/开关无关，不该被写操作连带触发。 */
      function bumpCatalog() {
        bumpCatalogTick(function (n) { return n + 1; });
      }

      function startJob(next) {
        if (next && typeof next.key === "string") jobKeysRef.current[next.key] = true;
        setJob(next);
      }

      /**
       * 结束一个作业：**只清掉自己的那把 key**。
       *
       * 早先无条件 `setJob(null)`：装 A 的同时点装 B 会先把 job 覆盖成 B，A 完成时把
       * job 清空 → B 还在跑，界面却显示空闲（卡片按钮解除禁用、spinner 消失），
       * 用户以为没事了又点一次，就发起了重复安装。现在按 key 归位：谁结束谁清自己，
       * 别的作业的忙碌态不受影响。
       */
      function clearJob(key) {
        if (key !== undefined) jobKeysRef.current[key] = false;
        else jobKeysRef.current = {};
        setJob(function (previous) {
          if (!previous) return previous;
          if (key !== undefined && previous.key !== key) return previous;
          return null;
        });
      }

      /**
       * 该 key 是否正在跑。读的是 **ref** 而不是 `job` state：同一批事件里连点两次时
       * `job` 还是渲染时的旧值，守卫会失效——ref 是同步的，第二次点击当场就能看见第一次的登记。
       */
      function jobRunning(key) {
        return jobKeysRef.current[key] === true;
      }

      // 搜索：输入即时入 state，300ms 防抖后提交；回车立即可提交。
      function commitQueryInput(immediate) {
        var scheduler = ensureSearchScheduler();
        var submit = function () {
          var next = queryInputRef.current;
          setQuery(function (previous) { return previous === next ? previous : next; });
          setPage(function (previous) { return previous === 1 ? previous : 1; });
        };
        if (immediate) {
          scheduler.cancel();
          submit();
          return;
        }
        scheduler.schedule(submit);
      }

      function handleQueryInput(value) {
        queryInputRef.current = value;
        setQueryInput(value);
        commitQueryInput(false);
      }

      function resetFilters() {
        queryInputRef.current = "";
        setQueryInput("");
        setQuery("");
        setCategory("all");
        setPage(1);
      }

      // silent：一键更新时用——逐条的结果记进该条（updateResults），不再每条都顶一条回执，
      // 否则批量跑到第三条时，前两条的回执已经把「开始更新」那条盖掉了。
      function submitInstall(target, approvedBuilds, onDone, silent) {
        var requestName = target.name;
        var label = target.label || target.name;
        var key = target.key || requestName;
        // 安装与更新走同一个接口，作业键统一用 install: 前缀，卡片与已安装行才能共享“进行中”状态。
        var jobKey = "install:" + key;
        // 抽屉里的每一条都要把自己的结果留在原地：onDone 是可选的，卡片/已安装行不需要它。
        var report = function (outcome) {
          if (typeof onDone === "function") onDone(outcome);
        };
        // 同一个包已经在装/更新时吞掉重复点击：卡片与已安装行各有一套「更新到 x.y.z」入口，
        // 两处同时点（或批量跑到一半又手动点同一条）会各自发一次安装请求。
        // 宿主对同一个包并发安装没有幂等保证，这里先挡一层。
        //
        // **必须回调 report 再返回**：一键更新的顺序执行靠 onDone 推进下一步，
        // 静默 return 会让那个包既不装、也不回调 → step() 再也无人调用、batch 永远停在
        // running，批量按钮被自己的守卫挡住，整个会话内「一键更新」彻底失效。
        if (jobRunning(jobKey)) {
          report({ ok: false, text: t("notice.installBusy", { name: label }), skipped: true });
          return;
        }
        startJob({ key: jobKey, kind: target.kind || "install" });
        var body = { name: requestName, requestId: newRequestId() };
        if (target.spec) body.spec = target.spec;
        if (approvedBuilds && approvedBuilds.length) body.approvedBuilds = approvedBuilds;
        api.install(body).then(function (payload) {
          if (!mountedRef.current) return;
          clearJob(jobKey);
          if (payload.pendingBuilds && payload.pendingBuilds.length) {
            if (approvedBuilds && approvedBuilds.length) {
              // 已经带着批准重提了一次、宿主仍说待批准（常见于 `stale-approval`：
              // pnpm 这一轮没写出占位，宿主的 approveBuilds 因此拒绝了这次批准）。
              // **绝不能在这里关掉确认条**：那会移除唯一的批准入口，而宿主的
              // hint 写的是「重新点一次安装」——入口没了，hint 就指向一个不存在的 UI，
              // 用户点一次即断头、这个插件永远装不上。
              // 正确做法是**保留确认条**（换上这一轮真实的包名），让用户再点一次：
              // 第二次往往会命中 pnpm 写出的占位、真的批准成功。
              var stillText = t("notice.buildsStillPending", { builds: payload.pendingBuilds.join(", ") });
              setPending({ name: requestName, label: label, spec: target.spec, kind: target.kind || "install", key: key, builds: payload.pendingBuilds });
              setNotice({ kind: "warn", text: stillText });
              report({ ok: false, text: stillText, pending: true });
            } else {
              var pendingText = t("notice.buildsPending", { name: label });
              setPending({ name: requestName, label: label, spec: target.spec, kind: target.kind || "install", key: key, builds: payload.pendingBuilds });
              setNotice({ kind: "warn", text: pendingText });
              report({ ok: false, text: pendingText, pending: true });
            }
            return;
          }
          setPending(null);
          var outcome = noticeFromResult(payload, "install", label);
          // 批量（silent）里的每一步只记账、不弹窗——否则「一键更新（N）」会弹 N 次，
          // 由批量的 finish 统一问一次。
          noteRestartFrom(payload, { label: label, defer: silent === true });
          if (!silent) setNotice(outcome);
          // 计成功看 applied（restart-required 也算装上了），不看气泡级别——
          // 否则「装好待重启」的更新会被批量汇成失败（用户截图里的「成功 0、失败 2」）。
          report({ ok: outcome.applied === true, text: outcome.text });
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob(jobKey);
          if (!silent) setNotice({ kind: "error", error: error });
          // 被占用的失败给一句能照做的短话（行内放不下三段式），而不是宿主的通用句。
          report({ ok: false, text: shortFailureText(error) || t("updates.failed", { name: label }) });
        });
      }

      function installItem(item) {
        submitInstall({
          name: item.id,
          label: item.name || item.id,
          spec: item.spec,
          kind: item.installed ? "update" : "install",
          key: item.id
        }, null);
      }

      /** 「可更新」页里点「更新到 x.y.z」：走同一条安装接口，把结果记回该条。
       *  silent 用于一键更新（回执只发汇总那一条）；onDone 用于顺序执行的下一步。 */
      function updateBundle(bundle, silent, onDone) {
        submitInstall({ name: bundle.name, label: bundle.name, spec: bundle.name, kind: "update", key: bundle.name }, null, function (outcome) {
          setUpdateResults(function (previous) {
            var next = {};
            var keys = Object.keys(previous);
            for (var i = 0; i < keys.length; i++) next[keys[i]] = previous[keys[i]];
            next[bundle.name] = outcome;
            return next;
          });
          if (typeof onDone === "function") onDone(outcome);
        }, silent === true);
      }

      /**
       * 一键更新：**按顺序逐个执行**（仍然一次只改一个依赖），跑完给一条汇总回执。
       * 与「逐个点」共用同一条安装接口与同一份结果记录，所以中途失败也只影响那一条。
       * 卡在「要先批准构建脚本」上就暂停：决定权交回给用户，批准后再点一次即可。
       */
      function updateAll() {
        var targets = updateBundles.slice();
        if (batch && batch.running) return;
        if (!targets.length) {
          setNotice({ kind: "info", text: t("notice.updateAllNone") });
          return;
        }
        var done = 0, ok = 0, fail = 0;
        setBatch({ running: true, total: targets.length, done: 0, ok: 0, fail: 0 });
        setNotice({ kind: "info", text: t("notice.updateAllStart", { count: targets.length }) });

        function finish(stoppedText) {
          if (!mountedRef.current) return;
          setBatch(null);
          // 跑完批量 = 已经「检查过一轮」：按钮按重读后的结果给「一键更新」或「重新检查」。
          setCheckPhase("checked");
          if (stoppedText) setNotice({ kind: "warn", text: stoppedText });
          else setNotice({ kind: fail > 0 ? "warn" : "success", text: t("notice.updateAllDone", { ok: ok, fail: fail }) });
          // **批量只在这里问一次**：每一步都 defer 过（见 noteRestartFrom），
          // 那些包的 restart-required 已经攒进 restartNamesRef，这里统一问。
          maybeAskRestart(null);
          bumpTick();
        }
        function step() {
          if (!mountedRef.current) return;
          if (done >= targets.length) { finish(null); return; }
          var bundle = targets[done];
          updateBundle(bundle, true, function (outcome) {
            if (!mountedRef.current) return;
            done++;
            // skipped = 那个包本来就在装/更新（守卫挡住），既不是成功也不是失败：
            // 不计数，但要继续推进——否则 step() 断在那一刻，batch 永远 running。
            if (!(outcome && outcome.skipped)) {
              if (outcome && outcome.ok) ok++; else fail++;
            }
            setBatch({ running: true, total: targets.length, done: done, ok: ok, fail: fail });
            if (outcome && outcome.pending) { finish(outcome.text); return; }
            step();
          });
        }
        step();
      }

      function approvePending() {
        if (!pending) return;
        var target = pending;
        setPending(null);
        setNotice({ kind: "info", text: t("notice.buildsApproved", { name: target.label }) });
        submitInstall({ name: target.name, label: target.label, spec: target.spec, kind: target.kind, key: target.key }, target.builds);
      }

      function removeBundle(bundle) {
        var key = "remove:" + bundle.name;
        startJob({ key: key, kind: "remove" });
        api.remove(bundle.name).then(function (payload) {
          if (!mountedRef.current) return;
          clearJob(key);
          setConfirming(null);
          setNotice(noticeFromResult(payload, "remove", bundle.name));
          noteRestartFrom(payload, { label: bundle.name });
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob(key);
          setNotice({ kind: "error", error: error });
        });
      }

      function toggleBundle(bundle) {
        var key = "toggle:" + bundle.name;
        var next = bundle.enabled === false;
        startJob({ key: key, kind: "toggle" });
        api.toggle({ name: bundle.name, enabled: next }).then(function (payload) {
          if (!mountedRef.current) return;
          clearJob(key);
          noteRestartFrom(payload, { label: bundle.name });
          setNotice(toggleNotice(payload, bundle.name, next));
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob(key);
          setNotice({ kind: "error", error: error });
        });
      }

      function toggleEntry(entry) {
        var id = entry.entryId;
        if (!id) return;
        var key = "toggle:" + id;
        var next = entry.enabled === false;
        startJob({ key: key, kind: "toggle" });
        api.toggle({ id: id, enabled: next }).then(function (payload) {
          if (!mountedRef.current) return;
          clearJob(key);
          noteRestartFrom(payload, { label: id });
          setNotice(toggleNotice(payload, id, next));
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob(key);
          setNotice({ kind: "error", error: error });
        });
      }

      function refreshCatalog() {
        var bag = startRequest("refresh");
        startJob({ key: "refresh", kind: "refresh" });
        api.refresh(bag.signal).then(function (payload) {
          if (!isCurrent("refresh", bag.token)) return;
          clearJob("refresh");
          setNotice({ kind: "success", text: t("notice.refreshOk", { count: formatCount(payload.count || 0) }) });
          // 刷新目录改变了目录内容：重抓目录，同时重读已安装（updateAvailable 依赖目录 join）。
          bumpCatalog();
          bumpTick();
        }).catch(function (error) {
          if (error && error.aborted) return;
          if (!isCurrent("refresh", bag.token)) return;
          clearJob("refresh");
          setNotice({ kind: "error", error: error });
          // 刷新失败也要重读，这样目录的 stale 提示会立刻反映当前缓存状态。
          bumpCatalog();
          bumpTick();
        });
      }

      /**
       * 「插件市场更新」（已搬进「可更新」页）：走模块级状态机，这次是**手动**（manual=true）——
       * 没更新才落「再次检查」，那是给点过的人看的；启动时的自动检查只负责把**有的**新版本亮成
       * 「更新到 x.y.z」，没更新时留在初始态（用户报「第一次进入就是再次检查」）。宿主侧有
       * 10 分钟缓存，连点不会打爆 CDN；结果进回执气泡。
       */
      function checkSelfUpdate() {
        if (selfUpdate.phase === "checking" || selfUpdate.phase === "installing") return;
        runSelfCheck(function (error, info) {
          if (!mountedRef.current) return;
          if (error) {
            // 宿主半还是旧版本时这个端点根本不存在（404/405）。这句话比「请求没有完成」有用得多：
            // 客户端半是热更新的，所以「按钮出现了但宿主没这接口」是升级过程中的正常中间态。
            var staleHost = error.code === "not-found" || error.code === "method-not-allowed";
            setNotice(staleHost ? { kind: "warn", text: t("notice.selfNeedsRestart") } : { kind: "error", error: error });
            return;
          }
          setNotice(info.updateAvailable
            ? { kind: "info", text: t("notice.selfFound", { version: info.latest }) }
            // 没有新版本时说**本机**版本：远端 latest 可能低于本机（本机是 link 开发装），
            // 报远端版本会出现「标题写着 1.1.4、提示却说已是最新 v1.1.3」这种自相矛盾。
            : { kind: "success", text: t("notice.selfCurrent", { version: version || info.latest }) });
        }, true);
      }

      /** 「更新到 x.y.z」：下载 → 三道校验 → 交给宿主安装。宿主半要重启 DSH 才会换代码。 */
      function applySelfUpdate() {
        if (selfUpdate.phase === "installing") return;
        var target = selfUpdate.data && selfUpdate.data.latest ? selfUpdate.data.latest : "";
        startJob({ key: "self-update", kind: "self-update" });
        setSelfCheck({ phase: "installing", data: selfUpdate.data, error: null });
        api.applySelfUpdate().then(function (payload) {
          if (!mountedRef.current) return;
          clearJob("self-update");
          var to = payload && payload.to ? payload.to : null;
          // **必须读 application，不能无条件亮绿灯**（与 sendChangeResult 同一条规则）：
          // 宿主的 ChangeResult 里 error 是可选的，`application:'failed'` 完全可能不带 error，
          // 而 /self-update 的 ok 规则在无 pendingBuilds 时会判 false——但只要有 pendingBuilds
          // 或 cancelled，HTTP 就是 200，`.then` 照样进。以前这里 `markSelfDone()` +
          // 绿色 `notice.selfUpdated` 是无条件的，于是**一次失败的自更新被渲染成成功**。
          // 没有 application 说明宿主从没确认过这次安装，同样按失败处理。
          var application = payload && typeof payload.application === "string" ? payload.application : "failed";
          var failed = application === "failed";
          var cancelled = application === "cancelled";
          if (failed) {
            // 不 markSelfDone：状态机留在 installing/error，按钮不显示「更新成功」。
            var failError = (payload && payload.error) || null;
            setSelfCheck({ phase: "error", data: selfUpdate.data, error: failError, at: Date.now() });
            setNotice({
              kind: "error",
              error: failError || marketError("self-update-unavailable", t("notice.selfUpdateFailed", { version: target }), "")
            });
            return;
          }
          if (cancelled) {
            setSelfCheck({ phase: "ready", data: selfUpdate.data, error: null, at: Date.now() });
            setNotice({ kind: "info", text: t("notice.selfUpdateCancelled", { version: target }) });
            return;
          }
          markSelfDone();
          // 市场自更新是**独立**的一件事（不是插件列表里的一条），正文改说市场版本。
          noteRestartFrom(payload, { marketVersion: to || target });
          setNotice({ kind: "success", text: to ? t("notice.selfUpdated", { version: to }) : t("notice.selfCurrent", { version: target }) });
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob("self-update");
          setSelfCheck({ phase: "error", data: null, error: error });
          setNotice({ kind: "error", error: error });
        });
      }

      /**
       * 「检查更新」按钮（合并了原来的「一键更新」入口与页脚「重新检查」）：
       * 按下重读已安装列表并**必定给一句话**回执；读完按钮切到 checked 态——
       * 有更新显示「一键更新（N）」，没有更新显示「重新检查」。
       */
      function checkUpdates() {
        loadInstalled({ announce: true, onDone: function () { setCheckPhase("checked"); } });
      }

      /**
       * 打开「可更新」页签：页签本身就是反馈（内容整页出现），同时重读一次已安装列表，
       * **无论有没有更新都回一句话**——「插件市场更新」一直是这么做的，不能一个有反馈一个静默。
       * 头部的「更新插件」按钮已删除（页签与侧边栏角标取代了它），这是它原来的入口。
       */
      function goUpdates() {
        setTab("updates");
        loadInstalled({ announce: true });
      }

      function toggleDetails(key) {
        setExpanded(function (previous) {
          var next = {};
          var keys = Object.keys(previous);
          for (var i = 0; i < keys.length; i++) next[keys[i]] = previous[keys[i]];
          next[key] = !next[key];
          return next;
        });
      }

      function copyCommand(command, key) {
        function done() {
          setCopied(key);
          setNotice({ kind: "success", text: t("action.copied") });
          setTimeout(function () {
            if (!mountedRef.current) return;
            setCopied(function (previous) { return previous === key ? null : previous; });
          }, 2000);
        }
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(command).then(done, function () {
              setNotice({ kind: "warn", text: t("action.copyFailed") });
            });
            return;
          }
        } catch (copyError) {
          // 剪贴板被策略禁用时降级为提示用户手动选中命令。
        }
        setNotice({ kind: "warn", text: t("action.copyFailed") });
      }

      var statusData = status.data || null;
      var readOnly = !!(statusData && statusData.manager && statusData.manager.available === false);
      var catalogData = discover.data || null;
      var categoriesList = catalogData && catalogData.categories ? catalogData.categories : [];
      var categoriesById = {};
      for (var i = 0; i < categoriesList.length; i++) {
        if (categoriesList[i] && categoriesList[i].id) categoriesById[categoriesList[i].id] = categoriesList[i];
      }
      var catalogMeta = catalogData && catalogData.catalog ? catalogData.catalog : statusData && statusData.catalog ? statusData.catalog : null;
      var metaText = "";
      if (catalogMeta && typeof catalogMeta.count === "number") {
        metaText = catalogMeta.updated
          ? t("market.catalogMeta", { count: formatCount(catalogMeta.count), updated: catalogMeta.updated })
          : t("market.catalogMetaUnknown", { count: formatCount(catalogMeta.count) });
      }
      var version = statusData && statusData.plugin && statusData.plugin.version ? statusData.plugin.version : "";
      var staleSource = catalogData && catalogData.catalog ? catalogData.catalog : catalogMeta;
      var staleInfo = staleSource && staleSource.stale === true
        ? {
          updated: staleSource.updated || "?",
          // 服务端两种形态：/status 的 catalog.error 是**字符串错误码**（catalog.js 里置的
          // `current.error = result.code`），/catalog 的 catalog 对象根本不带 error。
          // 早先只按对象读 error.message/.code，于是「目录过期」横幅的原因**永远**是
          // 「原因未知」——真实原因拿不到，用户没法判断是网络、限流还是源站挂了。
          reason: staleReason(staleSource)
        }
        : null;
      var refreshing = !!job && job.kind === "refresh";
      var busyKey = job ? job.key : null;

      // ── 头部两个按钮与抽屉要用的派生值 ──
      var installedPayload = installed.data || {};
      var allBundles = installedPayload.bundles || [];
      var updateBundles = [];
      for (var bundleIndex = 0; bundleIndex < allBundles.length; bundleIndex++) {
        var candidate = allBundles[bundleIndex];
        if (candidate && candidate.updateAvailable === true && candidate.latest) updateBundles.push(candidate);
      }
      var updateCount = updateBundles.length;
      var selfPhase = selfUpdate.phase;
      var selfInfo = selfUpdate.data || null;
      var selfAvailable = !!(selfInfo && selfInfo.updateAvailable === true);
      // 按钮文字的状态机（用户定的四态）：初始「插件市场更新」→ 点击「正在更新…」→
      // 装完「更新成功」（停留 SELF_DONE_MS）→ 检查完没有更新「再次检查」。
      // 启动时的自动检查没更新不算「检查过」——首次进入停在初始态，见 runSelfCheck(manual)。
      var selfLabel = selfPhase === "checking" ? t("action.checkingSelf")
        : selfPhase === "installing" ? t("action.updatingSelf")
          : selfPhase === "done" ? t("action.selfDone")
            : selfAvailable ? t("action.updateSelf", { version: selfInfo.latest })
              // 就绪且没有新版本 →「再次检查」（左边的「重新检查」是插件的，这颗是市场的，
              // 两颗黑按钮写一样的字会分不清）。
              : selfPhase === "ready" ? t("action.recheckSelfOnly")
                : t("action.checkSelf");
      var selfTitle = selfAvailable
        ? t("self.available", { version: selfInfo.latest })
        : selfPhase === "done"
          ? t("action.selfDone")
          : selfPhase === "ready"
            ? t("notice.selfCurrent", { version: selfInfo && selfInfo.latest ? selfInfo.latest : version })
            : t("action.checkSelf");
      var selfBusy = selfPhase === "checking" || selfPhase === "installing";

      // ── 页签注册表：页签栏与页面渲染**都**从这里读，顺序与 id 只有这一处真相 ──
      // 新增一个页面 = 在 MARKET_TABS 加一行（顺序即成页签顺序）+ 在 MARKET_PANES 加一份渲染函数。
      // 页签按钮、计数角标、页面外壳（.dshpm-page：统一的间距与高度）都自动套上，渲染循环不用改。
      // badge: 取计数的函数，返回 0/undefined 时不画角标——页签高度由 CSS 的 min-height 固定，
      // 所以「有没有角标」不会影响任何一页的起始位置。
      var MARKET_TABS = [
        { id: "discover", label: t("tab.discover"), badge: null, onClick: function () { setTab("discover"); } },
        { id: "installed", label: t("tab.installed"), badge: null, onClick: function () { setTab("installed"); } },
        { id: "updates", label: t("tab.updates"), badge: function () { return updateCount; }, onClick: goUpdates }
      ];
      var MARKET_PANES = {
        discover: function () {
          return el(DiscoverPane, {
            state: discover,
            categories: categoriesById,
            queryInput: queryInput,
            sort: sort,
            category: category,
            expanded: expanded,
            copied: copied,
            readOnly: readOnly,
            busyKey: busyKey,
            busyKind: job ? job.kind : null,
            onQueryInput: handleQueryInput,
            onQuerySubmit: function () { commitQueryInput(true); },
            onQueryClear: function () { resetFilters(); },
            onSort: function (value) { setSort(value); setPage(1); },
            onCategory: function (value) { setCategory(value); setPage(1); },
            onPage: function (value) { setPage(value < 1 ? 1 : value); },
            onResetFilters: resetFilters,
            onInstall: installItem,
            onToggleDetails: toggleDetails,
            onCopy: copyCommand,
            // 「重试」必须重抓**目录**：这一页的数据来自 /catalog，而 bumpTick 只动
            // installedTick，目录 effect 依赖的是 catalogTick——接错的话按钮点了没反应，
            // 报错框永远留在屏幕上（用户唯一的自救路径变成死键）。只有下面「已安装」页
            // 的 onRetry 才该接 bumpTick。
            onRetry: function () { bumpCatalog(); }
          });
        },
        installed: function () {
          return el(InstalledPane, {
            state: installed,
            expanded: expanded,
            confirming: confirming,
            readOnly: readOnly,
            busyKey: busyKey,
            // 一键更新在跑时禁止从这一页插更新（与「可更新」页行内按钮口径一致）。
            batchRunning: !!(batch && batch.running),
            onDiscover: function () { setTab("discover"); },
            onToggleBundle: toggleBundle,
            onUpdateBundle: updateBundle,
            onAskRemove: setConfirming,
            onRemoveBundle: removeBundle,
            onToggleDetails: toggleDetails,
            onToggleEntry: toggleEntry,
            onRetry: function () { bumpTick(); }
          });
        },
        updates: function () {
          return el(UpdatesPane, {
            state: installed,
            bundles: updateBundles,
            count: updateCount,
            installedCount: allBundles.length,
            catalogUpdated: catalogMeta && catalogMeta.updated ? catalogMeta.updated : null,
            results: updateResults,
            busyKey: busyKey,
            readOnly: readOnly,
            batch: batch,
            // 头部搬来的自更新按钮：状态机在模块级，这里只给它读写入口。
            self: {
              phase: selfPhase,
              label: selfLabel,
              title: selfTitle,
              busy: selfBusy,
              available: selfAvailable,
              onCheck: checkSelfUpdate,
              onApply: applySelfUpdate
            },
            onUpdate: updateBundle,
            onUpdateAll: updateAll,
            // 合并后的单按钮状态机：idle → 检查更新 → checked（一键更新 / 重新检查）。
            checkPhase: checkPhase,
            onCheckUpdates: checkUpdates,
            onReload: function () { loadInstalled({ announce: true }); },
            onRefreshCatalog: refreshCatalog
          });
        }
      };
      // 当前页：未知 id 退回第一页（受控 prop 不可能凭空变成别的值，这里只是防御）。
      var activePane = MARKET_PANES[tab] || MARKET_PANES[MARKET_TABS[0].id];

      // 是否有写操作正在进行（安装 / 更新 / 开关 / 一键更新整轮）。
      // **必须声明在 return 之前**：`el(...)` 的参数列表里不能放 `var` 语句（写了就是
      // SyntaxError: Unexpected token 'var'——我第一版就放在里面，被 `node --check` 当场拦下）。
      // `job` 只覆盖单个写操作，「一键更新」每一步之间 job 会短暂为空，所以要并上 batch。
      var writeInFlight = !!job || !!(batch && batch.running);

      // 弹窗挂成 .dshpm-root 的**兄弟节点**（Fragment 包一层），不做它的子项：
      // .dshpm-root 的直接子项被 e2e [8] 的几何断言盯着（「任何直接子项都不得被压扁」），
      // 而这个覆盖层是 fixed、天然比 root 高，塞进去只会让那条断言变得含糊。
      return el(React.Fragment, null,
        el("div", {
          className: "dshpm-root",
          "data-busy": job ? "true" : "false"
        },
        // 进度已改为头部「刷新目录」按钮里的 spinner + aria-busy（截图里标题上方那条黑杠），
        // 页面顶部不再放横条——任何写操作仍然显示在按钮与 toast 上。
        el("div", { className: "dshpm-header" },
          el("div", { className: "dshpm-headerMain" },
            el("h2", { className: "dshpm-title" }, t("market.title")),
            el("div", { className: "dshpm-subtitle" },
              t("market.subtitle"),
              version ? " · " + t("market.version", { version: version }) : "",
              metaText ? " · " + metaText : ""),
            // 自更新会把本机 link: 依赖换成下载下来的包，动手前先把这件事说出来。
            selfAvailable
              ? el("div", { className: "dshpm-selfNote" }, el(IconInfo, { size: 12 }), el("span", null, t("self.linkNote")))
              : null),
          el("div", { className: "dshpm-headerActions" },
            // 「刷新目录」只在「发现」页签出现：已安装/可更新页没有目录列表，刷它没意义。
            // 头部其余按钮早已搬走（更新插件→页签、插件市场更新→可更新页）。
            tab === "discover" ? el("button", {
              type: "button",
              className: "dshpm-btn",
              disabled: refreshing,
              "aria-busy": refreshing ? "true" : "false",
              onClick: refreshCatalog
            }, refreshing ? el(IconSpinner, { size: 12 }) : el(IconRefresh, { size: 12 }),
              refreshing ? t("action.refreshing") : t("action.refresh")) : null
          )
        ),
        notice
          ? el(NoticeBar, {
            notice: withAutoDismiss(notice),
            open: noticeClosing ? false : true,
            onDismiss: dismissNotice
          })
          : null,
        pending
          ? el(Banner, {
            kind: "warn",
            title: t("pending.title"),
            body: t("pending.body", { name: pending.label, builds: pending.builds.join(", ") })
          }, el("div", { className: "dshpm-bannerActions" },
            el("button", { type: "button", className: "dshpm-btn dshpm-btn--primary", disabled: !!job, onClick: approvePending },
              t("pending.approve")),
            el("button", { type: "button", className: "dshpm-btn dshpm-btn--quiet", onClick: function () { setPending(null); } },
              t("pending.cancel"))))
          : null,
        // 重启横幅：有待重启的改动就常驻（回答「为什么还没生效」+ 给一键动作）。
        // 重启中按钮进入忙碌态；探活回路见 beginRestartProbe——宿主死过一次才刷新页面。
        // **宿主说不能一键重启时不给按钮**（桌面壳持有单实例锁，点了必然失败且代价是应用
        // 整个关掉不回来）：横幅照留（用户仍需要知道「要重启才生效」），但正文改成
        // 「请关掉窗口再打开」，不再摆一个点了会出事的按钮。
        //
        // **写操作进行中也不给点**（v1.2.0 第六轮，用户问「开关和重启是不是有冲突」）：
        // 重启是**进程级**动作（宿主 900ms 后 process.exit），而安装/更新/开关是
        // **文件级**写入（宿主写 package.json、cordis.patch.yml，pnpm 子树可能还在跑）。
        // 在写没落地时点重启，宿主会带着「写了一半的 profile」退出——重启后状态未知。
        // `job` 覆盖单个写操作，`batch` 覆盖「一键更新」整轮（每一步之间 job 会短暂为空，
        // 只看 job 会留出可乘之机）。两者任一在跑就禁用。
        restart && restart.pending
          ? el(Banner, {
            kind: "warn",
            title: t("restart.bannerTitle"),
            body: restart.phase === "restarting"
              ? t("notice.restartQueued")
              : writeInFlight ? t("restart.busy")
                : restartAvailable ? t("restart.bannerBody") : t("restart.manualBody")
          }, restartAvailable
            ? el("div", { className: "dshpm-bannerActions" },
              el("button", {
                type: "button",
                className: "dshpm-btn dshpm-btn--primary dshpm-restartBtn",
                disabled: restart.phase === "restarting" || writeInFlight,
                "aria-busy": restart.phase === "restarting" ? "true" : "false",
                "data-phase": restart.phase || "idle",
                "data-write-busy": writeInFlight ? "true" : "false",
                title: writeInFlight ? t("restart.busy") : t("restart.title"),
                onClick: startRestart
              }, restart.phase === "restarting" ? el(IconSpinner, { size: 13 }) : el(IconUpgrade, { size: 13 }),
                restart.phase === "restarting" ? t("action.restarting") : t("action.restart")))
            : null)
          : null,
        readOnly ? el(Banner, { kind: "warn", title: t("readonly.title"), body: t("readonly.body") }) : null,
        status.phase === "error"
          ? el(Banner, { kind: "info", title: t("status.error.title"), body: t("status.error.body") })
          : null,
        staleInfo
          ? el(Banner, { kind: "warn", title: t("catalog.stale.title"), body: t("catalog.stale.body", { reason: staleInfo.reason, updated: staleInfo.updated }) },
            el("div", { className: "dshpm-bannerActions" },
              el("button", { type: "button", className: "dshpm-btn", disabled: refreshing, onClick: refreshCatalog }, t("catalog.stale.refresh"))))
          : null,
        // 三个页签：发现 / 已安装 / **可更新**（用户圈的位置——已安装右边再开一个）。
        // 整个页签栏由 MARKET_TABS 循环生成：顺序 = 注册表顺序，角标按需画——加页面只改注册表。
        // 「可更新」上的角标与头部按钮、侧边栏入口共用同一份计数。
        el("div", { className: "dshpm-tabs", role: "tablist" },
          MARKET_TABS.map(function (entry) {
            var entryCount = entry.badge ? entry.badge() : 0;
            return el("button", {
              key: entry.id,
              type: "button",
              role: "tab",
              className: "dshpm-tab",
              "data-tab": entry.id,
              "data-active": tab === entry.id ? "true" : "false",
              "aria-selected": tab === entry.id ? "true" : "false",
              // 「可更新」的入口还要重读一次列表并给回执（goUpdates）；其余页签纯切换。
              // 入口行为也写在注册表里，正文不再出现 tab 分支。
              onClick: entry.onClick
            }, entry.label,
              entryCount > 0 ? el("span", { className: "dshpm-count" }, String(entryCount)) : null);
          })),
        // 页面内容：同一时刻只渲染当前页（切走即卸载），并且统一套一层 .dshpm-page 外壳——
        // 三页共享同一套间距与高度，新增页面也自动对齐。
        el("div", { className: "dshpm-page", "data-page": tab, role: "tabpanel" }, activePane())
        ),
        // 重启询问弹窗：装完主动问一次「立即重启 / 稍后重启」（v1.2.0）。
        restartAsk
          ? el(RestartAskModal, {
            names: restartAsk.names,
            marketVersion: restartAsk.marketVersion,
            phase: restartAsk.phase,
            onNow: restartNow,
            onLater: dismissRestartAsk
          })
          : null
      );
    }

    // ───────────────────────────── 装载 ─────────────────────────────
    function readService(ctx, name) {
      try {
        if (typeof ctx.get === "function") {
          var service = ctx.get(name);
          return service === undefined ? null : service;
        }
        return ctx[name] || null;
      } catch (serviceError) {
        // 命名单个服务读取失败：宿主没有该服务时市场要能降级，而不是让 apply 抛错。
        return null;
      }
    }

    function wireLocale(locale) {
      var initial = null;
      if (locale && typeof locale.getLocale === "function") {
        try {
          var snapshot = locale.getLocale();
          if (snapshot && snapshot.active) initial = snapshot.active;
        } catch (readError) {
          initial = null;
        }
      }
      if (!initial) initial = detectLocale();
      setActiveLocale(initial);
      if (locale && typeof locale.subscribe === "function") {
        try {
          locale.subscribe(function () {
            try {
              var next = locale.getLocale();
              if (next && next.active) setActiveLocale(next.active);
            } catch (readError) {
              // 读不到新语言就保持当前语言，等下一次通知。
            }
          });
        } catch (subscribeError) {
          // 语言订阅失败不应阻塞注册：文案退化为初次读取的语言。
        }
      }
    }

    // 物化窗口内注入：这一代样式由此归这一代所有（见上方「样式节点的所有权」）。
    mountStyles();

    exports.inject = ["slots", "layout", "locale"];
    exports.apply = function (ctx) {
      ensureStyles();
      watchStyles(ctx);
      // 自动检查规则在这里启动（模块级守卫保证只跑一次）：
      // 启动时查一次市场本体更新，之后每小时查一次插件更新。
      startUpdateScheduler();

      var layout = readService(ctx, "layout");
      RUNTIME.selectPanel = layout && typeof layout.selectPanel === "function"
        ? function (id) { layout.selectPanel(id); }
        : null;
      RUNTIME.panelAvailable = !!RUNTIME.selectPanel;

      var locale = readService(ctx, "locale");
      wireLocale(locale);

      RUNTIME.timer = readService(ctx, "timer");
      RUNTIME.search = createSearchScheduler(RUNTIME.timer);

      var slots = readService(ctx, "slots");
      if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return;

      ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "plugin-market" }, MarketPage));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "plugin-market", order: 15, label: () => t("market.title") }, MarketEntry));
    };

    return module.exports;
  }
});
