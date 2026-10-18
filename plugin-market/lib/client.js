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

    // 官方 UI 组件（提示气泡等）。它由平台模块系统作为种子模块直接提供——dsh-context 等
    // 第三方插件同样是**不声明 inject** 直接 require 的。拿不到时（老宿主 / 离线加载回归的严格桩）
    // 退回浏览器原生 title，界面照常可用，只是气泡样式不跟随官方主题。
    var UI_PRIMITIVES = null;
    try {
      UI_PRIMITIVES = require("@deepseek-ai/dsh-client-ui-primitives");
    } catch (error) {
      UI_PRIMITIVES = null;
    }
    /** 官方圆角气泡提示；没有它就没有 Tooltip 组件。 */
    var OfficialTooltip = UI_PRIMITIVES && typeof UI_PRIMITIVES.Tooltip === "function" ? UI_PRIMITIVES.Tooltip : null;

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
        // 崩溃恢复卡（见 CrashBoundary 的注释：宿主兜底面是无文案无样式的空 div）。
        "crash.title": "插件市场渲染时出错了",
        "crash.hint": "这块界面在渲染时抛了异常，已被隔离，DSH 的其它部分不受影响。可以先重试；若重试无效，刷新页面即可恢复。",
        "crash.retry": "重试",
        "crash.reload": "刷新页面",
        "crash.copy": "复制错误信息",
        "crash.copied": "已复制",
        "crash.details": "技术详情",
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
        "action.backTop": "回到顶部",
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
        // v1.3.0：包级开关被隐藏时（宿主托管/不可操作），行内只报状态、不给控件。
        // 有「已停用」就得有「已启用」，否则启用态那半没有词可用。
        "badge.enabled": "已启用",
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
        // v1.3.0：整卡不渲染（开关和卸载都做不到）时的两句话。
        // 「一个都没剩」与「部分被藏」必须分开说——前者不是"没装插件"，是"这页没有可操作的项"。
        "installed.hiddenCount": "（另有 {count} 个已隐藏：它们既不能开关也不能卸载）",
        "installed.allHidden.title": "这一页没有可操作的插件",
        "installed.allHidden.body": "这个 profile 装了 {count} 个插件，但它们既不能在这里开关、也不能在这里卸载（由宿主基础设施管理或无法定位），所以市场不显示它们。要看清单请在终端执行 dsh plugin list。",
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
        "notice.unknownApplication": "操作结果无法确认（宿主回了「{application}」），先别当成成功；看宿主日志后重试。",
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
        // ── 能力披露（上游 2026-10 起）────────────────────────────────────
        // 「未扫描」必须说出来：上游的原话是「an entry absent here was NOT scanned —
        // the surfaces print that as 未检出, never as clean」。留空白等于给没检查过的
        // 插件背书，所以这一态要有明确文案。
        "detail.capabilitiesNotScanned": "未扫描（目录没有这个插件的能力检测记录，不代表安全）",
        "detail.redLines": "风险提示",
        "detail.redLinesNone": "已扫描，未发现风险模式",
        "detail.redLinesCheckedAt": "检测于 {date}",
        "detail.screenshots": "截图",
        "detail.screenshotsAlt": "{name} 截图 {index}",
        // 图床（GitHub raw）在国内网络下常常连不上：加载失败要变成可点链接，
        // 而不是留一张破图。文案说清「点开看原图」，别让用户以为插件坏了。
        "detail.screenshotFailed": "图片加载失败，点开原图",
        "detail.tarball": "预构建产物",
        "detail.downloadsRange": "近 30 天（{start} ~ {end}）",
        "detail.links": "链接",
        "detail.repo": "代码仓库",
        "detail.page": "目录页",
        "detail.command": "安装命令",
        "detail.version": "版本",
        "detail.added": "收录时间",
        "meta.stars": "★ {count}",
        "meta.downloads": "↓ {count}",
        "meta.downloadsNoData": "↓ 未发布到 npm",
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
        "notice.installHotMounted": "已安装 {name}，并已挂进正在运行的 DSH——不用重启。",
        "notice.installHotMountFailed": "已安装 {name}，但没能热挂载（{reason}）——重启 DSH 后生效。",
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
        // v1.3.0：一键重启「为什么不可用」有四种原因，**下一步动作各不相同**。
        // 合成一句话会让用户去试一个不可能成功的办法——systemd 下让人「关窗重开」
        // 是毫无意义的（没有窗口），调试器下让人「重装」更是在绕远路。
        // 宿主半的 restart.reason 给出是哪一种；认不出来时回落到 restart.manualBody。
        "restart.manualBody.desktop": "更新已经把新代码写到磁盘，但宿主进程还在跑旧代码。桌面版不能用一键重启——壳持有应用的单实例锁，从这里拉起的替代进程会被锁挡下并静默退出，结果是应用整个关掉且不会自己回来。请关掉应用窗口再打开，新代码就会生效。",
        "restart.manualBody.systemd": "更新已经把新代码写到磁盘，但宿主进程还在跑旧代码。当前宿主是 systemd 服务，不能用一键重启——systemd 默认 KillMode=control-group，会连重启助手一起清掉，服务被杀后不会自己起来。请用 systemctl restart <服务名> 重启。",
        "restart.manualBody.inspector": "更新已经把新代码写到磁盘，但宿主进程还在跑旧代码。当前宿主正被调试器附着（--inspect），一键重启会打断调试会话，所以这里不提供。断开调试器后按钮会自动回来，或手动重启 DSH。",
        "restart.manualBody.disabled": "更新已经把新代码写到磁盘，但宿主进程还在跑旧代码。当前 profile 显式关掉了允许重启（config 下的 allowRestart: false）。改回 true 或删掉它并重启 DSH 后，按钮会回来；现在请手动重启 DSH。",
        "restart.manualBody.unreachable": "更新已经把新代码写到磁盘，但宿主进程还在跑旧代码。一键重启只接受本机页面直接发起的请求，而当前请求经过了反向代理（宿主的 restart 判定说这个来源过不了围墙）。请用部署工具自己的方式重启，或直接在本机打开 DSH 页面再点「重启 DSH」。",
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
        // Crash recovery card (see the CrashBoundary comment: the host's own crash
        // face is an unstyled div with no copy at all).
        "crash.title": "The plugin market failed to render",
        "crash.hint": "This panel threw while rendering and was isolated — the rest of DSH is unaffected. Try again first; if that does not help, reloading the page recovers it.",
        "crash.retry": "Try again",
        "crash.reload": "Reload page",
        "crash.copy": "Copy error details",
        "crash.copied": "Copied",
        "crash.details": "Technical details",
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
        "action.backTop": "Back to top",
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
        "badge.enabled": "Enabled",
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
        "installed.hiddenCount": "({count} more hidden: they can be neither toggled nor removed)",
        "installed.allHidden.title": "No actionable plugins on this tab",
        "installed.allHidden.body": "This profile has {count} plugins, but none of them can be toggled or removed here (they are managed by host infrastructure or cannot be located), so the market does not list them. Run dsh plugin list in a terminal to see them.",
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
        "notice.unknownApplication": "Could not confirm the result (the host replied \"{application}\"); do not treat it as success. Check the host log and retry.",
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
        "detail.capabilitiesNotScanned": "Not scanned (the catalog has no capability record for this plugin; that does not mean it is safe)",
        "detail.redLines": "Risk flags",
        "detail.redLinesNone": "Scanned, no risk patterns found",
        "detail.redLinesCheckedAt": "Checked {date}",
        "detail.screenshots": "Screenshots",
        "detail.screenshotsAlt": "Screenshot {index} of {name}",
        "detail.screenshotFailed": "Image failed to load — open original",
        "detail.tarball": "Prebuilt tarball",
        "detail.downloadsRange": "Last 30 days ({start} ~ {end})",
        "detail.links": "Links",
        "detail.repo": "Repository",
        "detail.page": "Catalog page",
        "detail.command": "Install command",
        "detail.version": "Version",
        "detail.added": "Added",
        "meta.stars": "★ {count}",
        "meta.downloads": "↓ {count}",
        "meta.downloadsNoData": "↓ not on npm",
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
        "notice.installHotMounted": "Installed {name} and mounted it into the running DSH — no restart needed.",
        "notice.installHotMountFailed": "Installed {name}, but it could not be hot-mounted ({reason}) — restart DSH to apply.",
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
        "restart.manualBody": "The update has written the new code to disk, but the host process is still running the old code. One-click restart is unavailable in this environment. Close and reopen the app, or restart DSH yourself, to apply the new code.",
        // v1.3.0: "one-click restart is unavailable" has four distinct causes, and the
        // next step differs for each — collapsing them into one sentence sends the user
        // to try something that cannot work (there is no window to close under systemd).
        // The host half reports which one via `restart.reason`.
        "restart.manualBody.desktop": "The update has written the new code to disk, but the host process is still running the old code. One-click restart is unavailable in the desktop app: the shell holds the app's single-instance lock, so a replacement launched from here is refused and exits silently — leaving the whole app closed with nothing to bring it back. Close the app window and open it again to apply the new code.",
        "restart.manualBody.systemd": "The update has written the new code to disk, but the host process is still running the old code. This host is a systemd service, so one-click restart is unavailable: systemd's default KillMode=control-group takes the restart helper down with the unit, and the service does not come back. Restart it with systemctl restart <unit>.",
        "restart.manualBody.inspector": "The update has written the new code to disk, but the host process is still running the old code. A debugger is attached (--inspect), and a one-click restart would cut the debug session, so the button is not offered. Detach the debugger and the button returns, or restart DSH manually.",
        "restart.manualBody.disabled": "The update has written the new code to disk, but the host process is still running the old code. This profile explicitly disabled restart (allowRestart: false under config). Set it back to true or remove it and restart DSH to get the button back; for now, restart DSH manually.",
        "restart.manualBody.unreachable": "The update has written the new code to disk, but the host process is still running the old code. One-click restart only accepts requests made directly from a local page, and this request came through a reverse proxy. Restart with your deployment tooling, or open the DSH page on this machine and press Restart DSH there.",
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
    /**
     * 官方 locale 快照里的语言定义（`LocaleDefinition[]`）。语言要**跟随官方 harness**，
     * 而官方的渲染语义是「沿 active 语言**声明的 fallback 链**下探，且链必须终止于 en」
     * （见 dsh-client-locale 的 addLanguage 契约）。这里存一份只为了照同一条链下探，
     * 不自己发明第二套规则。
     */
    var LOCALE_DEFINITIONS = null;

    /** 语言标签的主子标签：`zh-Hans-CN` → `zh`。 */
    function localeBase(value) {
      return String(value || "").toLowerCase().split(/[-_]/)[0];
    }

    /** 市场**有字典**的语言只有这两个；别的语言不能假装有。 */
    function shippedLocale(value) {
      var base = localeBase(value);
      if (base === "en") return "en";
      if (base === "zh") return "zh";
      return null;
    }

    /**
     * 把官方语言 id 收敛成市场实际有字典的那一个。
     *
     * 旧实现是「非英语一律当中文」，**无视官方 fallback 链**：官方今天只发 zh/en 所以看不出，
     * 但 addLanguage 允许第三方语言包（例如 ja 的 fallback 是 en），那种情况下市场会硬显示
     * 中文，而官方自己会回退到英文——同一屏上两种语言。现在改成照官方的链下探：
     * active 自身命中（含 zh-Hans 这类变体）就用它，否则沿 fallback 走，首个我们有字典的赢；
     * 整条链都没有就落到 en——那是官方契约里明的链尾，不是我们猜的。
     */
    function normalizeLocale(value, definitions) {
      var direct = shippedLocale(value);
      if (direct) return direct;
      var byId = {};
      var list = Array.isArray(definitions) ? definitions : (Array.isArray(LOCALE_DEFINITIONS) ? LOCALE_DEFINITIONS : []);
      for (var i = 0; i < list.length; i++) {
        if (list[i] && typeof list[i].id === "string") byId[list[i].id.toLowerCase()] = list[i];
      }
      var cursor = String(value || "").toLowerCase();
      // 链是外部数据（第三方语言包声明的），加保护上限避免环状定义把这里挂住。
      for (var hop = 0; cursor && hop < 16; hop++) {
        var entry = byId[cursor];
        if (!entry) break;
        var fallback = entry.fallback === undefined || entry.fallback === null ? "" : String(entry.fallback).toLowerCase();
        var hit = shippedLocale(fallback);
        if (hit) return hit;
        cursor = fallback;
      }
      return "en";
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

    function setActiveLocale(value, definitions) {
      if (Array.isArray(definitions)) LOCALE_DEFINITIONS = definitions;
      var next = normalizeLocale(value, definitions);
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

    /** 「回到顶部」的箭头：一条竖线加箭头，比 IconChevron 更像常见的回顶图标。 */
    function IconArrowUp(props) {
      var size = (props && props.size) || 15;
      return svgRoot(size, [
        el("path", { key: "a", d: "M8 13V3.4" }),
        el("path", { key: "b", d: "M4.2 7.2 8 3.4l3.8 3.8" })
      ]);
    }

    // 显示阈值：与上游 dshmarket 取同一个数（它也是 scrollTop > 400）。
    // 太早出现会一直挡在右下角，太晚则滚了半屏还没得用。
    //
    // 刻意**不**做「接近底部就隐藏」：滚到最底部恰恰是最想回顶的时候，
    // 那时把按钮藏掉是把功能从最需要的地方撤走（上游也没这么做）。
    // 与列表底栏「下一页」可能的重叠改用**给底栏留出右侧空位**解决——
    // 见 .dshpm-listFooter 的 padding-right，那是不牺牲可用性的那一侧。
    var BACK_TOP_AT = 400;

    /**
     * 把滚动容器滚回顶部。
     *
     * 三个边界都实测过：
     *  · **reduced-motion 下不用平滑滚动**——用户明确要求减弱动效，滚 1600px 的
     *    动画正属于该被关掉的那类；
     *  · 容器的 `scrollTo` 可能不存在（jsdom 桩、老引擎），退回直接赋 scrollTop，
     *    否则回顶按钮在那种环境里点了没反应；
     *  · `instant` 为真时**无论如何都瞬时**（翻页用，见 goToPage）。
     */
    function scrollContainerToTop(node, instant) {
      if (!node) return;
      var reduce = false;
      try {
        reduce = !!(typeof window !== "undefined" && window.matchMedia
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      } catch (mediaError) { reduce = false; }
      var behavior = (instant === true || reduce) ? "auto" : "smooth";
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ top: 0, behavior: behavior });
      } else {
        node.scrollTop = 0;
      }
    }

    /**
     * 右下角悬浮的「回到顶部」。
     *
     * 「不影响可用交互」落在四点（用户要求）：
     *  1. **滚动超过阈值才出现**：常驻浮层会平白盖住右下角内容。
     *  2. **z-index 低于通知条(60)与弹层(70)**（见 .dshpm-top 注释）：它只是便利，
     *     绝不能压住「必须点」的东西。
     *  3. 与列表底栏「下一页」的横向重叠由 .dshpm-listFooter 的 padding-right 让开，
     *     按钮本身**不做**时隐时现——滚到底部正是最需要它的时候。
     *  4. 滚动监听是 passive 且随卸载移除，不参与 React 渲染循环，也不拖滚动性能。
     * 挂在 .dshpm-root **外面**（与弹窗同级）还有两个好处：不进入 root.children
     * （e2e [8] 逐个子项查「有没有被压扁」），也不受 root 的 overflow 影响。
     */
    function BackToTop(props) {
      var visibleState = React.useState(false);
      var visible = visibleState[0];
      var setVisible = visibleState[1];

      React.useEffect(function () {
        var node = props.scrollRef && props.scrollRef.current;
        if (!node) return undefined;
        function onScroll() {
          var next = node.scrollTop > BACK_TOP_AT;
          // 只在状态真的变了时才 setState：滚动事件每秒能来几十次，
          // 每次都 setState 就算值相同也会白白重渲整页。
          setVisible(function (previous) { return previous === next ? previous : next; });
        }
        onScroll();   // 挂载时先同步一次（切页签回来时可能已经滚过了）
        node.addEventListener("scroll", onScroll, { passive: true });
        return function () { node.removeEventListener("scroll", onScroll); };
      }, []);

      if (!visible) return null;

      var button = el("button", {
        type: "button",
        className: "dshpm-topBtn",
        "data-top-btn": "true",
        "aria-label": t("action.backTop"),
        title: t("action.backTop"),
        onClick: function () { scrollContainerToTop(props.scrollRef && props.scrollRef.current); }
      }, el(IconArrowUp, { size: 15 }));

      return el("div", { className: "dshpm-top" },
        OfficialTooltip
          ? el(OfficialTooltip, { label: t("action.backTop"), side: "left", delayMs: 500 }, button)
          : button);
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
.dshpm-entry { display:flex; align-items:center; gap:8px; margin:0 2px; min-height:36px; padding:7px 8px; box-sizing:border-box; border:none; border-radius:var(--dsw-radius-md,12px); background:transparent; color:var(--dsw-alias-label-primary,#0f1115); font:inherit; line-height:22px; text-align:left; cursor:pointer; flex:1 1 100%; min-width:0; }
.dshpm-entry:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#2631480f); }
.dshpm-entry[data-active="true"] { background:var(--dsw-alias-interactive-bg-hover,#2631480f); }
.dshpm-entry:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6)); outline-offset:2px; }
.dshpm-entry:disabled { opacity:.55; cursor:not-allowed; }
.dshpm-entry[data-wide="false"] { flex:none; width:36px; height:36px; min-height:36px; padding:0; justify-content:center; }
.dshpm-entryIcon { flex:none; display:inline-flex; align-items:center; justify-content:center; }
.dshpm-entryLabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dshpm-root { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; width:100%; height:100%; min-height:0; overflow:auto; padding:16px clamp(16px,3vw,32px) 32px; color:var(--dsw-alias-label-primary,#0f1115); background:var(--dsw-alias-bg-base,#fff); }
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
.dshpm-subtitle { margin-top:2px; color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; }
.dshpm-headerActions { display:flex; align-items:center; gap:8px; flex:none; }
/* 页签栏高度是**固定**的：按钮统一 min-height/行高与内边距，带角标（可更新页）和不带角标的
   页签一样高——后续新增页面加角标、加图标都不会把这一行撑高，三个页面永远从同一处开始。 */
.dshpm-tabs { display:flex; align-items:stretch; gap:4px; border-bottom:1px solid var(--dsw-alias-border-l1,#0000000a); }
.dshpm-tab { display:inline-flex; align-items:center; gap:4px; box-sizing:border-box; min-height:32px; border:none; background:transparent; color:var(--dsw-alias-label-secondary,#61666b); font:inherit; font-size:.93em; line-height:20px; padding:6px 10px; cursor:pointer; border-bottom:2px solid transparent; }
.dshpm-tab[data-active="true"] { color:var(--dsw-alias-label-primary,#0f1115); border-bottom-color:var(--dsw-alias-brand-primary,#4176e6); }
.dshpm-tab:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6)); outline-offset:2px; }
.dshpm-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-search { display:flex; align-items:center; gap:6px; flex:1 1 220px; min-width:180px; padding:5px 8px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-md,12px); background:var(--dsw-alias-bg-layer-1,#fff); }
.dshpm-search:focus-within { border-color:var(--dsw-alias-brand-primary,#4176e6); }
.dshpm-searchIcon { flex:none; display:inline-flex; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-input { flex:1 1 auto; min-width:0; border:none; outline:none; background:transparent; color:inherit; font:inherit; font-size:.93em; }
/* 搜索框只留我们自己那颗清除键：input[type=search] 聚焦且有值时 Chromium 会再画一颗原生 ✕
   （按 accent-color 上色），与 .dshpm-search 里那颗并排——用户截图里的「两个清除键」。
   实测（headless Edge 聚焦态截图对比）：appearance 与 display 任一都能让它消失，两个都写最稳。 */
.dshpm-input::-webkit-search-cancel-button { -webkit-appearance:none; appearance:none; display:none; }
.dshpm-select { border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-md,12px); background:var(--dsw-alias-bg-layer-1,#fff); color:inherit; font:inherit; font-size:.86em; padding:5px 6px; }
.dshpm-iconBtn { flex:none; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; padding:0; border:none; border-radius:var(--dsw-radius-md,12px); background:transparent; color:var(--dsw-alias-label-secondary,#61666b); cursor:pointer; }
.dshpm-iconBtn:hover { background:var(--dsw-alias-interactive-bg-hover,#2631480f); }
.dshpm-iconBtn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6)); outline-offset:2px; }
.dshpm-chips { display:flex; gap:6px; flex-wrap:wrap; }
.dshpm-chip { border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:999px; background:transparent; color:var(--dsw-alias-label-secondary,#61666b); font:inherit; font-size:.86em; padding:3px 10px; cursor:pointer; }
.dshpm-chip:hover { background:var(--dsw-alias-interactive-bg-hover,#2631480f); }
.dshpm-chip[data-active="true"] { border-color:var(--dsw-alias-brand-primary,#4176e6); color:var(--dsw-alias-brand-primary,#4176e6); }
.dshpm-chip:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6)); outline-offset:2px; }
.dshpm-summary { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; }
.dshpm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:12px; }
.dshpm-card { display:flex; flex-direction:column; gap:8px; box-sizing:border-box; padding:14px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-layer-1,#fff); }
.dshpm-cardHead { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
.dshpm-cardName { margin:0; font-size:.93em; font-weight:600; overflow-wrap:anywhere; }
.dshpm-cardOwner { color:var(--dsw-alias-label-secondary,#61666b); font-size:.79em; }
.dshpm-cardDesc { margin:0; color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.dshpm-cardMeta { display:flex; align-items:center; gap:12px; flex-wrap:wrap; color:var(--dsw-alias-label-secondary,#61666b); font-size:.79em; }
.dshpm-cardActions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:auto; }
.dshpm-detail { display:flex; flex-direction:column; gap:8px; padding-top:8px; border-top:1px solid var(--dsw-alias-border-l1,#0000000a); font-size:.86em; }
/* ── 独立详情卡片（用户反馈「展开太丑」后重做）────────────────────────────
   以前详情是卡片自己的子节点，被塞进 232px 的网格窄列：截图一排挤到换行、
   风险提示的英文长句变成一大坨、整行卡片被撑到几百像素高，同排其它卡片跟着变高留白。
   现在详情是**跨整个网格宽度的一张独立卡片**，紧跟被点那张之后。
   grid-column:1/-1 是它跨行的唯一机制；放在 grid 里而不是 grid 外面，
   是为了让它自然落在「被点卡片的下方一行」，不用手算插入位置。 */
.dshpm-detailCard { grid-column:1/-1; }
.dshpm-detailCardHead { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.dshpm-detailCardName { margin:0; font-size:1.02em; font-weight:600; overflow-wrap:anywhere; }
.dshpm-detailCardClose { margin-left:auto; }
/* 详情卡里内容更宽：两列（键/值）在窄屏下会自动堆叠，宽屏下把键列固定住更好读。 */
.dshpm-detailCard .dshpm-detail { padding-top:0; border-top:none; font-size:.93em; }
.dshpm-detailCard .dshpm-detailKey { width:6.5em; }
.dshpm-detailRow { display:flex; gap:8px; align-items:flex-start; }
.dshpm-detailKey { flex:none; width:5.5em; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-detailValue { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }
.dshpm-tags { display:flex; gap:4px; flex-wrap:wrap; }
/* 风险红线：用 warn 色描边而不是填充——它是提示，不是错误，也不该抢走「安装」按钮的注意力。
   红线原文来自目录检测器（英文），不翻译、不改写：改写会让用户以为是我们自己验证过的。 */
.dshpm-tag--warn { border-color:var(--dsw-alias-state-warn-primary,#f59e0b); color:var(--dsw-alias-state-warn-primary,#f59e0b); }
.dshpm-detailValue--muted { color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-detailHint { margin-top:4px; color:var(--dsw-alias-label-tertiary,#81858c); font-size:.86em; }
.dshpm-cardMetaMuted { color:var(--dsw-alias-label-tertiary,#81858c); }
/* 截图：小尺寸横向排布，点击在详情里看不全也没关系（链接可开原图）；
   object-fit:cover 避免不同长宽比的图把行高撑乱。 */
.dshpm-shots { display:flex; gap:6px; flex-wrap:wrap; }
.dshpm-shot { width:120px; height:76px; object-fit:cover; border-radius:var(--dsw-radius-sm,8px); border:1px solid var(--dsw-alias-border-l1,#0000000a); background:var(--dsw-alias-bg-layer-2,#fff); }
/* 图加载失败时的降级格子：同一个尺寸，变成一个可点的说明——不留破图占位，
   也不让详情区因为一张图挂掉就错位。 */
.dshpm-shot--failed { display:flex; align-items:center; justify-content:center; box-sizing:border-box; padding:4px; text-align:center; font-size:.86em; line-height:1.3; color:var(--dsw-alias-label-secondary,#61666b); text-decoration:none; border-style:dashed; }
.dshpm-shot--failed:hover { text-decoration:underline; }
.dshpm-tag { border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:999px; padding:1px 8px; font-size:.93em; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-code { display:block; box-sizing:border-box; width:100%; padding:6px 8px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-md,12px); background:var(--dsw-alias-bg-layer-2,#fff); color:var(--dsw-alias-label-primary,#0f1115); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.93em; overflow-wrap:anywhere; }
.dshpm-link { color:var(--dsw-alias-brand-primary,#4176e6); text-decoration:none; display:inline-flex; align-items:center; gap:4px; }
.dshpm-link:hover { text-decoration:underline; }
.dshpm-btn { display:inline-flex; align-items:center; gap:6px; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,#0000001a); border-radius:var(--dsw-radius-md,12px); background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,#0f1115); font:inherit; font-size:.86em; padding:4px 10px; cursor:pointer; }
.dshpm-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,#2631480f); }
.dshpm-btn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6)); outline-offset:2px; }
.dshpm-btn:disabled { opacity:.5; cursor:not-allowed; }
.dshpm-btn--primary { border-color:transparent; background:var(--dsw-alias-button-primary-fill,#0f1115); color:var(--dsw-alias-label-primary-foreground,#fff); }
.dshpm-btn--primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-dimmed,#43454a)); }
.dshpm-btn--danger { border-color:var(--dsw-alias-state-error-primary,#ec1313); color:var(--dsw-alias-state-error-primary,#ec1313); background:transparent; }
.dshpm-btn--quiet { border-color:transparent; background:transparent; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-badge { border-radius:999px; padding:1px 7px; font-size:.71em; border:1px solid var(--dsw-alias-border-l1,#0000000a); color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-badge--success { color:var(--dsw-alias-state-success-primary,#22c55e); border-color:var(--dsw-alias-state-success-primary,#22c55e); }
.dshpm-badge--warn { color:var(--dsw-alias-state-warn-primary,#f59e0b); border-color:var(--dsw-alias-state-warn-primary,#f59e0b); }
.dshpm-badge--error { color:var(--dsw-alias-state-error-primary,#ec1313); border-color:var(--dsw-alias-state-error-primary,#ec1313); }
/* ── 回执气泡（Android toast 那种）：position:fixed 悬在视口**底部居中**，不占文档流——
   出现或消失都不推动布局，也不用滚动才看得见。旧版是页内提示条：挤在头部下面一格，
   还得靠根节点滚到那一页才看得见。kind 仍用 data-kind 表达，图标配色不变。 */
.dshpm-notice { position:fixed; left:0; right:0; bottom:24px; z-index:60; display:flex; align-items:flex-start; gap:8px; box-sizing:border-box; width:fit-content; max-width:min(560px, calc(100vw - 32px)); margin:0 auto; padding:10px 14px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-left-width:3px; border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-layer-2,#fff); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); box-shadow:var(--dsw-elevation-panel,0 0 0 .5px #00000029, 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005); font-size:.86em; line-height:1.5; transition:opacity .2s ease, transform .2s ease; }
/* 退场：先沉下去再卸载（由 data-open 翻转触发，200ms 后组件才真正消失）。 */
.dshpm-notice[data-open="false"] { opacity:0; transform:translateY(10px) scale(.97); }
.dshpm-notice[data-kind="success"] { border-left-color:var(--dsw-alias-state-success-primary,#22c55e); }
.dshpm-notice[data-kind="warn"] { border-left-color:var(--dsw-alias-state-warn-primary,#f59e0b); }
.dshpm-notice[data-kind="error"] { border-left-color:var(--dsw-alias-state-error-primary,#ec1313); }
.dshpm-notice[data-kind="info"] { border-left-color:var(--dsw-alias-state-idle-primary,#d4d4d4); }
.dshpm-noticeIcon { flex:none; display:inline-flex; margin-top:1px; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-notice[data-kind="success"] .dshpm-noticeIcon { color:var(--dsw-alias-state-success-primary,#22c55e); }
.dshpm-notice[data-kind="warn"] .dshpm-noticeIcon { color:var(--dsw-alias-state-warn-primary,#f59e0b); }
.dshpm-notice[data-kind="error"] .dshpm-noticeIcon { color:var(--dsw-alias-state-error-primary,#ec1313); }
.dshpm-noticeBody { flex:1 1 auto; min-width:0; }
.dshpm-noticeTitle { font-weight:600; }
.dshpm-banner { display:flex; flex-direction:column; gap:6px; box-sizing:border-box; padding:12px 14px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-left-width:3px; border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-layer-1,#fff); font-size:.86em; }
.dshpm-banner[data-kind="warn"] { border-left-color:var(--dsw-alias-state-warn-primary,#f59e0b); }
.dshpm-banner[data-kind="error"] { border-left-color:var(--dsw-alias-state-error-primary,#ec1313); }
.dshpm-banner[data-kind="info"] { border-left-color:var(--dsw-alias-state-idle-primary,#d4d4d4); }
.dshpm-bannerActions { display:flex; gap:6px; flex-wrap:wrap; }
/* ── 重启询问弹窗（v1.2.0）：装完之后主动问一次「立即重启 / 稍后重启」。
   fixed 覆盖层，不进文档流——**刻意不放在 .dshpm-root 里面**（用 Fragment 挂成兄弟节点），
   否则它会成为 .dshpm-root 的直接子项，撞上 e2e [8]「任何直接子项都不得被压扁」那条几何断言。 */
.dshpm-modalLayer { position:fixed; inset:0; z-index:70; display:flex; align-items:center; justify-content:center; box-sizing:border-box; padding:20px; background:var(--dsw-alias-bg-overlay,rgba(15,17,21,.42)); }
.dshpm-modalCard { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; width:min(440px, 100%); max-height:calc(100vh - 40px); overflow:auto; padding:16px 18px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-panel,28px); background:var(--dsw-alias-bg-layer-2,#fff); box-shadow:var(--dsw-elevation-prominent,0 0 0 .5px #00000029, 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d); font-size:.93em; }
.dshpm-modalTitle { font-weight:600; font-size:1.02em; }
.dshpm-modalBody { color:var(--dsw-alias-label-secondary,#61666b); line-height:1.55; overflow-wrap:anywhere; }
.dshpm-modalNames { color:var(--dsw-alias-label-primary,#0f1115); font-weight:600; }
.dshpm-modalActions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
.dshpm-modalHint { font-size:.86em; color:var(--dsw-alias-label-secondary,#61666b); line-height:1.5; }
.dshpm-modalState { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-error { display:flex; flex-direction:column; gap:6px; box-sizing:border-box; padding:12px; border:1px solid var(--dsw-alias-state-error-primary,#ec1313); border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-layer-1,#fff); }
.dshpm-errorTitle { font-weight:600; color:var(--dsw-alias-state-error-primary,#ec1313); }
.dshpm-errorBody { display:flex; flex-direction:column; gap:4px; font-size:.86em; }
.dshpm-errorLine { display:flex; gap:8px; align-items:flex-start; }
.dshpm-errorKey { flex:none; width:5.5em; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-errorCode { flex:1 1 auto; min-width:0; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; overflow-wrap:anywhere; }
.dshpm-empty { display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:20px 16px; border:1px dashed var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-lg,16px); }
.dshpm-emptyTitle { font-weight:600; }
.dshpm-emptyBody { color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; max-width:52em; }
.dshpm-loading { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; }
.dshpm-skeletonGrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:12px; }
.dshpm-skeleton { height:104px; border-radius:var(--dsw-radius-lg,16px); background:linear-gradient(90deg,var(--dsw-alias-bg-skeleton,#0000000a),var(--dsw-alias-interactive-bg-hover,#2631480f),var(--dsw-alias-bg-skeleton,#0000000a)); background-size:200% 100%; animation:dshpm-shimmer .18s linear infinite; }
/* 列表底栏：**摘要与翻页器凑成一组、整体靠右**。
   用户要求（两次，方向一致）：
     · 第一次：「摘要要放在上下页那个位置，上下页放右边」；
     · 第二次：「和分页器放一起吧，不然不直观地看到当前在第几页」——
       即页码要**紧挨着**翻页按钮，眼睛不用在整行两端来回找。
   所以是 justify-content:flex-end（整组靠右）+ 摘要紧跟分页器，
   而不是 space-between（那会把摘要甩到最左边，正是用户说「不直观」的原因）。

   注意 .dshpm-pager **不能**再带 margin-left:auto：那会把剩余空间全吸到分页器左边、
   把摘要顶回行首，等于又变回 space-between 的效果（改这条时踩过）。

   padding-right 是为了让开右下角那个固定的「回到顶部」圆钮（实测数据）：
   圆钮 right:18px + 宽 38px → 左边缘在视口右侧 56px 处；而底栏内容右边缘原来只在
   32px 处（.dshpm-root 的 padding-right）——两者横向重叠 24px，圆钮会压住
   「下一页」的右侧。这里补 40px，让内容右边缘落到 72px ≥ 56px 且留 8px 间隙。
   之所以放在底栏而不是让圆钮躲开：圆钮的位置是产品要的（右下角），
   而底栏右侧本来就没有内容，让出空位不牺牲任何东西。 */
.dshpm-listFooter { display:flex; align-items:center; justify-content:flex-end; gap:8px 12px; flex-wrap:wrap; padding-top:4px; padding-right:40px; }
.dshpm-listSummary { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; min-width:0; }
.dshpm-pager { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:4px; }
.dshpm-listFooter .dshpm-pager { padding-top:0; }
.dshpm-installed { display:flex; flex-direction:column; gap:12px; }
/* 页签内容的统一外壳（用户报「三个切换页面高度不对齐」）：三个页面共用同一套间距与起点，
   切页签时页面高度一致、内容从同一处开始，不再一跳一跳。
   页面级间距统一成一个单位 12px：外壳 gap、.dshpm-root 的 gap、各页内容容器的 gap 都是 12
   （卡片/列表行**内部**仍是 8，那是块内间距，不是页面节距）。新增页面见 MARKET_TABS 与
   MARKET_PANES：渲染处查表后自动套上这个外壳，不需要再写一遍布局。
   flex:1 0 auto —— 覆盖上面「.dshpm-root > *」那条的 0 0 auto：内容短时页面撑满可视区（几页等高），
   内容长时按内容高度、由面板根自己滚动。收缩权仍是 0，所以任何区块都不会被压扁（§12.12）。 */
.dshpm-root > .dshpm-page { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; flex:1 0 auto; width:100%; }
.dshpm-row { display:flex; flex-direction:column; gap:8px; box-sizing:border-box; padding:12px 14px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-layer-1,#fff); }
.dshpm-rowHead { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-rowMain { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1 1 220px; }
.dshpm-rowName { font-weight:600; overflow-wrap:anywhere; }
.dshpm-rowVersion { color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; }
.dshpm-rowDesc { color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; overflow-wrap:anywhere; }
.dshpm-rowMeta { color:var(--dsw-alias-label-secondary,#61666b); font-size:.79em; }
.dshpm-rowError { color:var(--dsw-alias-state-error-primary,#ec1313); font-size:.86em; }
.dshpm-rowActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-rowLayout { display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; }
.dshpm-switch { position:relative; flex:none; width:34px; height:18px; padding:0; border:1px solid var(--dsw-alias-border-l2,#0000001a); border-radius:999px; background:var(--dsw-alias-state-idle-primary,#d4d4d4); cursor:pointer; }
.dshpm-switch::after { content:""; position:absolute; top:1px; left:1px; width:14px; height:14px; border-radius:50%; background:#fff; transition:transform .16s ease; }
.dshpm-switch[aria-checked="true"] { background:var(--dsw-alias-state-success-primary,#22c55e); }
.dshpm-switch[aria-checked="true"]::after { transform:translateX(16px); }
.dshpm-switch:disabled { opacity:.5; cursor:not-allowed; }
.dshpm-switch:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6)); outline-offset:2px; }
.dshpm-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
/* ── 头部两个按钮：更新插件（带计数角标）与市场自更新 ── */
.dshpm-headerActions { flex-wrap:wrap; justify-content:flex-end; }
.dshpm-btn--attention { border-color:var(--dsw-alias-state-warn-primary,#f59e0b); color:var(--dsw-alias-state-warn-primary,#f59e0b); }
.dshpm-count { display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; margin-left:2px; padding:0 4px; border-radius:999px; background:var(--dsw-alias-state-warn-primary,#f59e0b); color:var(--dsw-alias-label-primary-foreground,#fff); font-size:.71em; font-weight:600; line-height:1; }
.dshpm-selfNote { display:flex; align-items:flex-start; gap:6px; margin-top:8px; padding:8px 10px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-left:3px solid var(--dsw-alias-brand-primary,#4176e6); border-radius:var(--dsw-radius-md,12px); background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-secondary,#61666b); font-size:.79em; line-height:1.55; }
.dshpm-selfNote svg { flex:none; margin-top:2px; }

/* ── 可更新插件面板：就地展开，不遮挡列表、不制造第二个滚动容器 ── */
/* 可更新页是**整页页签**，不再是会折叠的抽屉：所以这里不写 max-height / overflow:hidden——
   那两样是为了「收起时高度归 0」，留着反而会把很长的更新列表裁掉（列表高 > 1600px 时）。 */
.dshpm-updatesPanel { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; padding:14px 16px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-layer-1,#fff); }
/* 但作为**整页内容**（第三个页签）时它不应该是「页里的另一张卡片」：卡片自带的内边距会把这一页的
   第一行文字往下推 12px，于是三个页签切来切去看上去就不齐（用户报的「高度不对齐」）。页面节距一律
   交给统一外壳 .dshpm-page 负责，这里只保留结构。基类规则留着，便于将来别处复用这张卡片。 */
.dshpm-updatesPage { padding:0; border:none; background:transparent; }
.dshpm-drawerHead { display:flex; align-items:flex-start; gap:8px; }
/* 可更新页页头右侧的两个按钮（检查更新状态机 / 插件市场更新），窄屏下换行到标题下面。 */
.dshpm-updatesActions { flex:none; display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-left:auto; }
.dshpm-drawerIcon { flex:none; display:inline-flex; margin-top:2px; color:var(--dsw-alias-brand-primary,#4176e6); }
.dshpm-drawerHeading { flex:1 1 auto; min-width:0; }
.dshpm-drawerTitle { font-weight:600; }
.dshpm-drawerSubtitle { color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; }
.dshpm-drawerHint { color:var(--dsw-alias-label-secondary,#61666b); font-size:.79em; }
.dshpm-drawerBody { display:flex; flex-direction:column; gap:8px; }
.dshpm-drawerList { display:flex; flex-direction:column; gap:8px; }
.dshpm-drawerLoading { display:flex; align-items:center; gap:6px; color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; }
.dshpm-drawerFoot { display:flex; gap:6px; justify-content:flex-end; }
.dshpm-updateRow { display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap; box-sizing:border-box; padding:12px 14px; border:1px solid var(--dsw-alias-border-l1,#0000000a); border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-base,#fff); }
.dshpm-updateMain { flex:1 1 240px; min-width:0; display:flex; flex-direction:column; gap:4px; }
.dshpm-updateName { font-weight:600; overflow-wrap:anywhere; }
.dshpm-updateVersions { display:flex; align-items:center; gap:6px; font-size:.86em; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-versionFrom { text-decoration:line-through; opacity:.75; }
.dshpm-versionTo { color:var(--dsw-alias-state-success-primary,#22c55e); font-weight:600; }
/* 箭头此前只有类名没有样式（引入了类名却漏了规则），会继承整行的字号与颜色，
   与两侧的版本号不一致。显式给它次要色 + 稍小字号。 */
.dshpm-versionArrow { color:var(--dsw-alias-label-tertiary,#81858c); font-size:.93em; }
/* 有旧数据但这次读取失败时的提示条：黄色、一行、带重试。 */
.dshpm-staleNote { display:flex; align-items:center; gap:6px; box-sizing:border-box; padding:8px 10px; border:1px solid var(--dsw-alias-state-warn-primary,#f59e0b); border-radius:var(--dsw-radius-md,12px); background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-state-warn-primary,#f59e0b); font-size:.86em; }
.dshpm-staleNote .dshpm-btn { margin-left:auto; flex:none; }
.dshpm-updateDesc { color:var(--dsw-alias-label-secondary,#61666b); font-size:.86em; overflow-wrap:anywhere; }
.dshpm-updateActions { flex:none; display:flex; align-items:center; gap:8px; }
.dshpm-updateResult { display:flex; align-items:center; gap:6px; font-size:.86em; color:var(--dsw-alias-state-success-primary,#22c55e); }
.dshpm-updateResult[data-ok="false"] { color:var(--dsw-alias-state-error-primary,#ec1313); }
.dshpm-updateRow[data-busy="true"] { border-color:var(--dsw-alias-brand-primary,#4176e6); }
.dshpm-updateRow[data-done="true"] { border-color:var(--dsw-alias-state-success-primary,#22c55e); }
.dshpm-updateRow--ghost { height:62px; border-style:dashed; background:linear-gradient(90deg,var(--dsw-alias-bg-skeleton,#0000000a),var(--dsw-alias-interactive-bg-hover,#2631480f),var(--dsw-alias-bg-skeleton,#0000000a)); background-size:200% 100%; animation:dshpm-shimmer .18s linear infinite; }
.dshpm-entryBadge { flex:none; margin-left:auto; display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 5px; border-radius:999px; background:var(--dsw-alias-state-warn-primary,#f59e0b); color:var(--dsw-alias-label-primary-foreground,#fff); font-size:.71em; font-weight:600; line-height:1; }
.dshpm-entry[data-wide="false"] .dshpm-entryBadge { position:absolute; top:3px; right:3px; margin:0; min-width:14px; height:14px; padding:0 3px; font-size:.71em; }

/* ───────────────────────────── 动效 ─────────────────────────────
   三条原则，改这里之前先读：
   1. 基础样式里绝不写 opacity:0——动画被关掉（prefers-reduced-motion）时元素必须直接可见；
   2. 只动 transform / opacity / max-height，不动宽高与位置，避免列表重排抖动；
   3. 升入类动画一律用 backwards 填充：用 forwards/both 会把 transform 钉在末帧，
      卡片 hover 的 translateY 与按钮 active 的缩放就再也生效不了。 */
.dshpm-entry { position:relative; transition:background-color .18s ease, transform .16s ease; }
.dshpm-entry:active:not(:disabled) { transform:scale(.98); }
.dshpm-entry[data-active="true"] .dshpm-entryIcon { animation:dshpm-pop .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-entryBadge { animation:dshpm-pop .18s cubic-bezier(.4,0,.2,1) backwards, dshpm-breathe 2.6s ease-in-out 3; }
.dshpm-btn { transition:background-color .16s ease, border-color .16s ease, color .16s ease, box-shadow .18s ease, transform .12s ease; }
.dshpm-btn:hover:not(:disabled) { box-shadow:var(--dsw-shadow-lv1,0 2px 4px 0 #0000000d); }
.dshpm-btn:active:not(:disabled) { transform:scale(.975); }
.dshpm-btn--primary:hover:not(:disabled) { box-shadow:none; }
.dshpm-btn--pulse { animation:dshpm-glow 1.9s ease-in-out 2; }
.dshpm-card { transition:transform .18s cubic-bezier(.4,0,.2,1), box-shadow .2s ease, border-color .18s ease; animation:dshpm-rise .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-card:hover { transform:translateY(-2px); box-shadow:var(--dsw-shadow-lv2,0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a); border-color:var(--dsw-alias-border-l2,#0000001a); }
.dshpm-row { transition:border-color .18s ease, box-shadow .2s ease; animation:dshpm-rise .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-row:hover { box-shadow:var(--dsw-shadow-lv1,0 2px 4px 0 #0000000d); }
.dshpm-updateRow { animation:dshpm-rise .18s cubic-bezier(.4,0,.2,1) backwards; transition:border-color .18s ease, transform .16s ease, box-shadow .2s ease; }
/* ghost（加载占位）必须用**更高特异性**压过上面那条 .dshpm-updateRow 的入场动画：
   两条规则都是单类选择器（特异性 0,1,0）时，靠后的赢——下面那条 .dshpm-updateRow
   会把 ghost 的 dshpm-shimmer 无限扫光覆盖成 dshpm-rise 一次性 0.26s 淡入，
   于是两行骨架屏同时淡入一次就不动了，不再表示「正在加载」。
   用双类选择器（0,2,0）把这条钉死，不依赖规则先后顺序。 */
.dshpm-updateRow.dshpm-updateRow--ghost { animation:dshpm-shimmer .18s linear infinite; }
.dshpm-updateRow:hover { transform:translateX(2px); }
.dshpm-chip { transition:background-color .16s ease, color .16s ease, border-color .16s ease, transform .16s ease; }
.dshpm-chip:hover { transform:translateY(-1px); }
.dshpm-chip[data-active="true"] { animation:dshpm-pop .18s ease-out backwards; }
.dshpm-tabs { position:relative; }
.dshpm-tab { position:relative; border-bottom-color:transparent; transition:color .18s ease; }
/* 两个页签的底线用同一个 transform 时长反向缩放：视觉上就是从一边滑到另一边。 */
.dshpm-tab[data-active="true"] { border-bottom-color:transparent; }
.dshpm-tab::after { content:""; position:absolute; left:10px; right:10px; bottom:0; height:2px; border-radius:2px; background:var(--dsw-alias-brand-primary,#4176e6); transform:scaleX(0); transform-origin:right center; transition:transform .18s cubic-bezier(.4,0,.2,1); }
.dshpm-tab[data-active="true"]::after { transform:scaleX(1); transform-origin:left center; }
.dshpm-notice { animation:dshpm-toastin .18s cubic-bezier(.4,0,.2,1) backwards; }
/* 弹窗：遮罩淡入 + 卡片升起。两者都用 backwards（用 forwards 会把 transform 钉死在末帧，
   之后 hover/位移类样式就再也动不了——门禁有断言盯着这条）。 */
.dshpm-modalLayer { animation:dshpm-fade .18s ease backwards; }
.dshpm-modalCard { animation:dshpm-rise .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-banner { animation:dshpm-rise .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-detail { animation:dshpm-expand .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-empty { animation:dshpm-rise .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-grid, .dshpm-installed, .dshpm-drawerList { animation:dshpm-fade .18s ease backwards; }
.dshpm-badge { transition:color .18s ease, border-color .18s ease; }
.dshpm-badge--warn { animation:dshpm-breathe 2.8s ease-in-out 2; }
.dshpm-search { transition:border-color .18s ease, box-shadow .2s ease; }
.dshpm-search:focus-within { box-shadow:var(--dsw-elevation-stroke,0 0 0 .5px #00000029); }
.dshpm-select { transition:border-color .18s ease; }
.dshpm-tag { transition:background-color .16s ease; }
.dshpm-switch { transition:background-color .2s ease; }
.dshpm-count[data-pop="true"] { animation:dshpm-pop .18s cubic-bezier(.4,0,.2,1) backwards, dshpm-breathe 2.6s ease-in-out 3; }
.dshpm-updatesPage { animation:dshpm-rise .18s cubic-bezier(.4,0,.2,1) backwards; }
.dshpm-skeleton { animation:dshpm-shimmer .18s linear infinite; }
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
@keyframes dshpm-glow { 0%, 100% { box-shadow:var(--dsw-shadow-lv1,0 2px 4px 0 #0000000d); } 50% { box-shadow:var(--dsw-elevation-soft,0 0 0 .5px #00000029, 0 4px 16px 0 #00000008, 0 0 24px 0 #00000008); } }

/* ── 回到顶部（右下角悬浮）────────────────────────────────────────────────
   用户要求：右下角悬浮、**不要影响可用的交互系统**。三条约束都落在这里：
   1) position:fixed 相对视口。面板一直延伸到视口右边（实测侧栏占 0–280px、
      面板从 280 起），所以 fixed 到右下角落在面板内，不会压到左侧栏的入口；
   2) z-index **低于**通知条(60)与弹层(70)：气泡或弹窗出现时，它不会盖住它们，
      这是「不影响交互」最要紧的一条——回顶按钮只是便利，绝不能挡住必须点的东西；
   3) 基础样式不写 opacity/visibility 的隐藏，reduced-motion 下也必须可见可点。
   另外列表底栏留了 padding-right（见 .dshpm-listFooter），避免它压住右下角的
   「下一页」——那条由 e2e 的真实命中测试钉着，不是靠这句注释保证。 */
.dshpm-top { position:fixed; right:18px; bottom:18px; z-index:55; display:flex; }
.dshpm-topBtn { width:38px; height:38px; padding:0; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,#0000001a); border-radius:999px; background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-secondary,#61666b); box-shadow:var(--dsw-elevation-soft,0 0 0 .5px #00000029, 0 4px 16px 0 #00000008, 0 0 24px 0 #00000008); cursor:pointer; transition:background .16s ease, color .16s ease; }
.dshpm-topBtn:hover { background:var(--dsw-alias-interactive-bg-hover,#2631480f); color:var(--dsw-alias-label-primary,#0f1115); }
.dshpm-topBtn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6)); outline-offset:2px; }

/* ── 崩溃恢复卡 ──────────────────────────────────────────────────────────
   宿主自己的崩溃面（div[data-slot-error]）无文案无样式；这是我们的替代品，
   必须自己带样式，且要在侧栏窄条（--compact）和主面板两种宽度下都能用。
   translate:no 落在元素属性上，这里只负责长得像个能自救的东西。 */
.dshpm-crashSlot { display:contents; }
.dshpm-crash { display:flex; flex-direction:column; gap:12px; box-sizing:border-box;
  padding:14px; border:1px solid var(--dsw-alias-border-l1,#0000000a);
  border-left-width:3px; border-left-color:var(--dsw-alias-state-error-primary,#ec1313);
  border-radius:var(--dsw-radius-lg,16px); background:var(--dsw-alias-bg-layer-1,#fff);
  font-size:.93em; line-height:1.55; min-width:0; }
.dshpm-crash--compact { padding:8px 10px; gap:6px; font-size:.86em; border-radius:var(--dsw-radius-md,12px); }
.dshpm-crashTitle { font-weight:600; color:var(--dsw-alias-label-primary,#0f1115); }
.dshpm-crashHint { color:var(--dsw-alias-label-secondary,#61666b); overflow-wrap:anywhere; }
.dshpm-crashActions { display:flex; gap:8px; flex-wrap:wrap; }
.dshpm-crash--compact .dshpm-crashActions { gap:6px; }
.dshpm-crashDetails { font-size:.86em; color:var(--dsw-alias-label-secondary,#61666b); }
.dshpm-crashSummary { cursor:pointer; }
.dshpm-crashPre { margin:6px 0 0; white-space:pre-wrap; word-break:break-word;
  max-height:220px; overflow:auto; font-size:.93em;
  padding:8px 10px; border-radius:var(--dsw-radius-sm,8px);
  background:var(--dsw-alias-bg-layer-2,#fff); }

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

    /**
     * 渲染崩溃兜底：**最后一道防线**。
     *
     * 为什么必须有（实测出来的，不是推测）：
     * DSH 宿主**确实**在 `@deepseek-ai/dsh-client-ui-renderer` 里给每个 slot entry 套了
     * `SlotErrorBoundary`，但它的兜底面是 `div[data-slot-error]`——**无文案、无样式、
     * 无子节点**（`[data-slot-error]` 在 app.css / vendor.css 里零命中）。更糟的是崩溃时
     * 渲染层用 `abdicate: spec.kind !== "chain"` 上报，而 `main` 是 keyed、
     * `sidebar.footer.action` 是 list——**都不是 chain**，于是 entry 被塞进 `SlotCore.abdicated`
     * 的 WeakSet，「excluded from `entriesOfSlot` projections for the rest of their
     * registration's life」，cell 干涸后落到 `deadCell()`：同一块空 div。
     *
     * 净效果：一旦这里抛异常，用户看到的是一块**永久空白**，且**毫无提示**——没有文案、
     * 没有按钮、连导出日志都点不到（上游 dshmarket 的 #293 就是白屏几个月、报告全空，
     * 因为它连「导出日志」按钮都一起没了）。只能靠刷新页面恢复，而用户根本不知道要刷新。
     *
     * 还有一条：我们的插件在 profile 里是 **bundle**，不走动态沙箱面，所以
     * `dsh-cordis-client-runner` 的 `owners` 索引（`owners.set` 全档只有 1 处，在
     * `guardedSurface` 的 `claim()` 里）**够不着我们**——`this.owners.get(component)`
     * 返回 undefined 后直接 `return`，Cordis 面板那行 `role="alert"`
     * 「Rendering failed in {slot}」是**动态插件的待遇，不是我们的**。
     * 也就是说：我们没有第二条可见通道，必须自己给自己兜底。
     *
     * 边界放在 entry **内部**（包住我们自己的树），这样崩溃被限制在我们这一格，
     * 不会触发宿主的 abdicate，也就不会永久留白——重试即可就地恢复。
     *
     * 刻意不做自动重试循环：同样的渲染再抛一次还是会回到这里，这比在「坏界面」和
     * 「恢复卡」之间闪烁、两边都读不了要诚实。
     */
    var LAST_CRASH = null;

    /**
     * React.Component 的**构造器**（不是它的 prototype）。必须防御式取：
     * 直接写 `React.Component.prototype` 会在模块级求值，任何 React 桩缺 `Component`
     * 的宿主（含 verify/ 下两个只桩了 hooks 的测试）都会在 `factory()` 阶段就抛错——
     * 那是「加载期崩溃」，比没有边界更糟。
     * 注意取的是构造器本身：`ReactComponent.prototype` 与 `ReactComponent.call(...)` 都要用，
     * 取成 prototype 对象的话这两处都会失败（第一版就是这么错的，被 crash-boundary 测试抓到）。
     * 真宿主一定给得了 Component；拿不到时退化成空函数，边界语义仍然成立
     * （render 由 React 调用，我们不依赖基类的任何行为）。
     */
    var ReactComponentBase = (React && typeof React.Component === "function") ? React.Component : function () {};

    var CrashBoundary = (function () {
      function CrashBoundary(props) {
        ReactComponentBase.call(this, props);
        this.state = { error: null, generation: 0, copied: false };
        this.retry = this.retry.bind(this);
        this.reload = this.reload.bind(this);
        this.copy = this.copy.bind(this);
      }
      CrashBoundary.prototype = Object.create(ReactComponentBase.prototype);
      CrashBoundary.prototype.constructor = CrashBoundary;

      CrashBoundary.getDerivedStateFromError = function (error) {
        return { error: error };
      };

      CrashBoundary.prototype.componentDidCatch = function (error, info) {
        // componentStack 说的是「哪里」——打包压缩后 JS 栈已经指不出来，而用户
        // 手工拿不到任何一条。
        LAST_CRASH = {
          message: error && error.message ? String(error.message) : String(error),
          stack: (info && info.componentStack) || (error && error.stack) || null,
          at: new Date().toISOString(),
          slot: this.props && this.props.slot
        };
        // 同时留在控制台：开发者在现场不该为了看一眼被吞掉的错误去导文件。
        if (typeof console !== "undefined" && console.error) {
          console.error("[plugin-market] 市场界面渲染崩溃，已换成恢复卡", error, info && info.componentStack);
        }
      };

      CrashBoundary.prototype.retry = function () {
        // 换 generation 是为了连子树的 identity 一起换掉：只把 error 清空也能重挂，
        // 但 key 变了才能保证「上一棵已经崩掉的树」不会以任何形式被复用。
        this.setState(function (prev) {
          return { error: null, generation: prev.generation + 1, copied: false };
        });
      };

      CrashBoundary.prototype.reload = function () {
        if (typeof window !== "undefined" && window.location && window.location.reload) {
          window.location.reload();
        }
      };

      CrashBoundary.prototype.copy = function () {
        var self = this;
        var text = LAST_CRASH
          ? LAST_CRASH.message + "\n\n" + (LAST_CRASH.stack || "")
          : "";
        var done = function () { self.setState({ copied: true }); };
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, done);
            return;
          }
        } catch (error) { /* 剪贴板不可用就退回不提示，别为此再抛一次 */ }
        done();
      };

      CrashBoundary.prototype.render = function () {
        var error = this.state.error;
        if (error === null) {
          // 用 generation 当 key：重试后子树必然是全新挂载。
          return el("div", {
            className: "dshpm-crashSlot",
            key: "gen" + this.state.generation
          }, this.props.children);
        }
        var compact = this.props.variant === "entry";
        var message = error && error.message ? String(error.message) : String(error);
        var stack = (LAST_CRASH && LAST_CRASH.stack) || "";

        // translate="no" + notranslate：浏览器整页翻译会**替换 React 掌握的文本节点**，
        // 下一次提交就抛 NotFoundError 把整棵树带崩（上游 #293 的原凶，白屏了几个月）。
        // 恢复卡本身绝不能再被翻译改写。
        var body = [
          el("div", { className: "dshpm-crashTitle", key: "title" }, t("crash.title")),
          el("div", { className: "dshpm-crashHint", key: "hint" }, t("crash.hint")),
          el("div", { className: "dshpm-crashActions", key: "actions" },
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--primary",
              onClick: this.retry,
              "data-crash-action": "retry"
            }, t("crash.retry")),
            compact ? null : el("button", {
              type: "button",
              className: "dshpm-btn",
              onClick: this.reload,
              "data-crash-action": "reload"
            }, t("crash.reload")),
            compact ? null : el("button", {
              type: "button",
              className: "dshpm-btn",
              onClick: this.copy,
              "data-crash-action": "copy"
            }, this.state.copied ? t("crash.copied") : t("crash.copy"))
          ),
          compact ? null : el("details", { className: "dshpm-crashDetails", key: "details" },
            el("summary", { className: "dshpm-crashSummary" }, t("crash.details")),
            el("pre", { className: "dshpm-crashPre" }, message + (stack ? "\n\n" + stack : ""))
          )
        ];

        return el("div", {
          className: "dshpm-crash" + (compact ? " dshpm-crash--compact" : ""),
          role: "alert",
          "data-plugin-market-crashed": this.props.slot || "market",
          translate: "no",
          lang: "en",
          // 同时留 console 之外的结构标记：e2e 与日志工具靠它区分
          // 「崩了」和「没挂载」——这两件是不同的事，不能被读成同一件。
          "data-dshpm-crash-message": message.slice(0, 200)
        }, body);
      };

      return CrashBoundary;
    })();

    /** 崩溃信息，给测试与日志用（可能为 null）。 */
    function lastCrash() { return LAST_CRASH; }

    /** 把组件包进崩溃边界。边界在 entry 内部，所以不会触发宿主的 abdicate。 */
    function withCrashBoundary(Component, variant, slot) {
      return function GuardedComponent(props) {
        // 在最外层就补样式，而不是只靠 MarketPage/MarketEntry 内部那一次：
        // 面板可能在走到自己的 ensureStyles() **之前**就抛（useChangeTick 是第一个 hook），
        // 那样恢复卡会连 .dshpm-crash 的样式都没有——一张裸奔的恢复卡等于没有恢复卡。
        // ensureStyles 本身幂等（先查 getElementById），这里重复调用没有代价。
        ensureStyles();
        return el(CrashBoundary, { variant: variant, slot: slot }, el(Component, props));
      };
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
      // 提示气泡用**官方** primitives 的 Tooltip（和官方侧边栏自己的面板行同款圆角气泡），
      // 不再用浏览器原生 title——原生框是直角+系统描边，与官方主题格格不入（用户报的
      // 「你的选中框和别人的不一样」）。拿不到官方组件时退回原生 title，功能不丢。
      // 可访问名仍取 market.title（按钮叫什么），气泡文案才是「打开插件市场」（点了会怎样）。
      var hint = available ? t("market.entry.aria") : t("market.entry.disabled");
      var entryButton = el("button", {
        type: "button",
        className: "dshpm-entry",
        "data-wide": wide ? "true" : "false",
        "data-active": active ? "true" : "false",
        "data-hasUpdates": updates.known && updates.count > 0 ? "true" : "false",
        "aria-label": t("market.title"),
        "aria-current": active ? "page" : undefined,
        disabled: !available,
        title: OfficialTooltip ? undefined : hint,
        onClick: openMarketPanel
      },
        el("span", { className: "dshpm-entryIcon" }, el(IconMarket, { size: wide ? 16 : 18 })),
        wide ? el("span", { className: "dshpm-entryLabel" }, t("market.title")) : null,
        updates.known && updates.count > 0
          ? el("span", {
            className: "dshpm-entryBadge",
            // 角标读数是可见的，且按钮已有气泡说明；这里不再挂原生 title，
            // 否则 hover 角标时又会冒出那个直角方框。
            "aria-label": t("updates.entryBadge", { count: updates.count })
          }, String(updates.count))
          : null
      );
      if (!OfficialTooltip) return entryButton;
      // side 与官方 sidebar 自己的面板行一致（默认右侧），delayMs 同样取 500ms。
      return el(OfficialTooltip, { label: hint, side: "right", delayMs: 500 }, entryButton);
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

    /**
     * 列表底栏：结果摘要（总数 + 页码）与翻页按钮**凑成一组、整体靠右**。
     *
     * 为什么是这个形状（用户前后两次要求，方向是一致的）：
     *  1.「结果摘要应该放在上下页那个位置，上下页放在右边」——原来摘要在网格**上方**、
     *     分页器在**下方**，页码被拆到两处，眼睛要上下跑才能对上；
     *  2.「和分页器放一起吧，不然不直观地看到当前在第几页」——合成一行之后我又用
     *     space-between 把摘要甩到了最左边，页码与翻页按钮隔着一整行，仍然要对角找。
     *     所以改成 flex-end：摘要紧挨着「上一页」，整组贴右边。
     *     实测的间距就是 footer 的 gap（12px），e2e [14] 有断言钉着这个距离。
     *
     * 页码**只在摘要里出现一次**——翻页按钮中间原来还有个「第 x/y 页」，
     * 凑成一组后那就是相邻两处写同一件事，所以删掉了（e2e [14] 钉着「只出现一次」）。
     *
     * 这一行**总是渲染**，哪怕只有 1 页：结果总数不能因为「不需要翻页」就消失——
     * 摘要原来挂在网格上方时对任意页数都可见，挪进来不能把这个性质弄丢。
     * 按钮组只在 pages > 1 时出现。
     */
    function Pager(props) {
      var page = props.page || 1;
      var pages = props.pages || 1;
      return el("div", { className: "dshpm-listFooter" },
        el("div", { className: "dshpm-listSummary" },
          el("span", null, props.summary),
          props.loading ? el("span", null, t("list.updating")) : null),
        pages > 1
          ? el("nav", { className: "dshpm-pager", "aria-label": t("pager.label") },
            page > 1
              ? el("button", { type: "button", className: "dshpm-btn dshpm-btn--quiet", disabled: props.busy, onClick: props.onFirst }, t("action.firstPage"))
              : null,
            el("button", {
              type: "button",
              className: "dshpm-btn",
              disabled: props.busy || page <= 1,
              onClick: props.onPrev
            }, t("pager.prev")),
            el("button", {
              type: "button",
              className: "dshpm-btn",
              disabled: props.busy || page >= pages,
              onClick: props.onNext
            }, t("pager.next"))
          )
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
          // 下载量：上游的 downloads 是**近 30 天**的 npm 下载数，而 null 表示
          // 「这个条目根本没有 npm 包」（实测 2839 条，其中无 npm 2819 条）——
          // 是**覆盖缺口，不是 0**。上游注释原话：「Consumers must tell
          // "not published" apart from "published, unused"」。
          // 原来写 `item.downloads || 0` 把 2839 条「没数据」显示成「↓ 0」，
          // 等于告诉用户「这个插件发布了但没人用」——两件完全不同的事。
          item.downloads !== null && item.downloads !== undefined
            ? el("span", null, t("meta.downloads", { count: formatCount(item.downloads) }))
            : el("span", { className: "dshpm-cardMetaMuted" }, t("meta.downloadsNoData")),
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
        )
        // 详情**不再在卡片里展开**（用户反馈「展开太丑」）：它以前是这个 <article> 的子节点，
        // 于是详情被塞进 232px 的网格窄列里，行高被撑到几百像素，同排其它卡片跟着变高、
        // 留下一大片空白。现在改成由外面渲染一张**跨整行的独立卡片**（见 PluginDetailCard）。
      );
    }

    /**
     * 独立详情卡片：跨整个网格宽度，紧跟在被点那张卡片之后。
     *
     * 为什么单独一张卡而不是在卡片里展开：网格列宽只有 232px，详情里有截图（120px 缩略图
     * 一排）、能力标签、风险提示原文（英文长句）——挤在窄列里必然换行成一大坨，还把整行
     * 拉高。跨整行后宽度够用，也不影响同排其它卡片的高度。
     *
     * 关闭入口有两处：卡片自己右上角的 ×（用户点开就得能就地关掉），
     * 以及原卡片上那颗已变成「收起详情」的按钮（保持原交互不变）。
     */
    function PluginDetailCard(props) {
      var item = props.item;
      return el("article", {
        className: "dshpm-card dshpm-detailCard",
        "data-detail-for": item.id || item.name
      },
        el("div", { className: "dshpm-detailCardHead" },
          el("h3", { className: "dshpm-detailCardName" }, item.name || item.id),
          el("span", { className: "dshpm-cardOwner" }, "@" + (item.owner || "")),
          el("button", {
            type: "button",
            className: "dshpm-iconBtn dshpm-detailCardClose",
            title: t("action.hideDetails"),
            "aria-label": t("action.hideDetails"),
            onClick: function () { props.onClose(); }
          }, el(IconClose, { size: 14 }))
        ),
        el(PluginDetails, { item: item, onCopy: props.onCopy, copied: props.copied })
      );
    }

    /**
     * 能力披露：三种状态必须分开显示（上游 build-site.mjs 的硬要求）。
     *
     *   capabilities === null        ⇒ **未扫描**：说「未扫描（不代表安全）」，绝不写「无风险」
     *   capabilities === []          ⇒ 扫过、没发现能力
     *   capabilityRedLines 非空      ⇒ **风险提示**（597 条真实数据里有告警，例如
     *                                  「reads credentials/secrets AND has network access」481 条、
     *                                  「runs code at install time (postinstall)」22 条）
     *   capabilityRedLines === []    ⇒ 扫过、未发现风险模式
     *
     * 为什么红线要单独一块而不是并进「能力」：能力标签是中性描述（能读文件），
     * 红线是**风险组合**（读凭据 + 能联网 = 可能外传）。混在一起用户会滑过去。
     */
    function CapabilityDisclosure(props) {
      var item = props.item;
      var scanned = Array.isArray(item.capabilities) || Array.isArray(item.capabilityRedLines);
      if (!scanned) {
        return el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.capabilities")),
          el("span", { className: "dshpm-detailValue dshpm-detailValue--muted" }, t("detail.capabilitiesNotScanned")));
      }
      var capabilities = Array.isArray(item.capabilities) ? item.capabilities : [];
      var redLines = Array.isArray(item.capabilityRedLines) ? item.capabilityRedLines : [];
      return el(React.Fragment, null,
        capabilities.length
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.capabilities")),
            el("span", { className: "dshpm-tags" }, capabilities.map(function (token) {
              return el("span", { className: "dshpm-tag", key: token }, capabilityLabel(token));
            })))
          : null,
        el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.redLines")),
          el("span", { className: "dshpm-detailValue" },
            redLines.length
              ? el("span", { className: "dshpm-tags" }, redLines.map(function (line) {
                // 红线原文来自目录（英文），**不翻译**：它是检测器的原话，
                // 改写会让用户以为我们自己也验证过。
                return el("span", { className: "dshpm-tag dshpm-tag--warn", key: line }, line);
              }))
              : el("span", { className: "dshpm-detailValue--muted" }, t("detail.redLinesNone")),
            item.capabilityCheckedAt
              ? el("div", { className: "dshpm-detailHint" }, t("detail.redLinesCheckedAt", { date: formatDate(item.capabilityCheckedAt) }))
              : null)));
    }

    /**
     * 截图缩略图：**加载失败要降级成链接，不能留一张破图**。
     *
     * 现实约束（实测，不是推测）：截图只允许 GitHub 自家 host（上游白名单），
     * 而 `raw.githubusercontent.com` 在国内网络下**经常直接连不上**
     * （本机 2026-10-18 实测 HEAD 请求全部 fetch failed，与 GitHub 直连被 reset 同因）。
     * 也就是说「数据合规」和「用户能看到」是两件事。
     *
     * 处理：onError 时把这一个格子换成「打开原图」链接。这样：
     *   · 能连的环境照常看到图；
     *   · 连不上的环境得到一个可点的链接（用户可自己挂代理/换网络），而不是一张破图占位；
     *   · 绝不因为图挂了就把整个详情区搞乱（只影响那一个格子）。
     */
    function ScreenshotThumb(props) {
      var failedState = React.useState(false);
      var failed = failedState[0];
      var setFailed = failedState[1];
      if (failed) {
        return el("a", {
          className: "dshpm-shot dshpm-shot--failed",
          href: props.src,
          target: "_blank",
          rel: "noreferrer",
          title: props.src
        }, t("detail.screenshotFailed"));
      }
      return el("img", {
        className: "dshpm-shot",
        src: props.src,
        loading: "lazy",
        referrerPolicy: "no-referrer",
        alt: props.alt,
        onError: function () { setFailed(true); }
      });
    }

    function PluginDetails(props) {
      var item = props.item;
      // 安装命令：上游 tarball 是「只能这样装」的兜底（有些插件只发布构建产物，
      // 用 github: 装会给用户一条坏命令）。命令串优先用目录给的 install；
      // 若目录没给而我们拿到了 tarball，就用它拼一条，别退回那条坏的 github: 命令。
      var command = item.install || (item.tarball ? 'dsh plugin --profile web add "' + item.tarball + '"' : (item.spec ? "dsh plugin add " + item.spec : ""));
      var screenshots = Array.isArray(item.screenshots) ? item.screenshots : [];
      return el("div", { className: "dshpm-detail" },
        el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.description")),
          el("span", { className: "dshpm-detailValue" }, descriptionText(item.description) || "—")),
        el(CapabilityDisclosure, { item: item }),
        screenshots.length
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.screenshots")),
            el("span", { className: "dshpm-shots" }, screenshots.map(function (src, index) {
              // loading=lazy：详情展开时才下载，1289 条目录项里 3650 张图，
              // 一次性全拉会拖慢列表。referrerPolicy=no-referrer 不把当前地址带给图床。
              // 加载失败降级成链接（见 ScreenshotThumb）：GitHub 图床在国内常常连不上。
              return el(ScreenshotThumb, {
                key: src,
                src: src,
                alt: t("detail.screenshotsAlt", { name: item.name, index: index + 1 })
              });
            })))
          : null,
        el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.links")),
          el("span", { className: "dshpm-detailValue" },
            el("span", { className: "dshpm-tags" },
              item.url ? el("a", { className: "dshpm-link", href: item.url, target: "_blank", rel: "noreferrer", key: "repo" }, t("detail.repo"), el(IconExternal, { size: 11 })) : null,
              item.page ? el("a", { className: "dshpm-link", href: item.page, target: "_blank", rel: "noreferrer", key: "page" }, t("detail.page"), el(IconExternal, { size: 11 })) : null,
              !item.url && !item.page ? el("span", null, "—") : null))),
        item.downloads !== null && item.downloads !== undefined
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("meta.downloads", { count: formatCount(item.downloads) })),
            el("span", { className: "dshpm-detailValue dshpm-detailValue--muted" },
              item.downloadsStart && item.downloadsEnd
                ? t("detail.downloadsRange", { start: item.downloadsStart, end: item.downloadsEnd })
                : "—"))
          : null,
        // 预构建产物：有些插件只发布构建产物、从源码装不了（上游说明），
        // 所以这个字段本身就是「该怎么装」的信息，值得单独一行并可点开。
        item.tarball
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.tarball")),
            el("span", { className: "dshpm-detailValue" },
              el("a", { className: "dshpm-link", href: item.tarball, target: "_blank", rel: "noreferrer" },
                t("detail.tarball"), el(IconExternal, { size: 11 }))))
          : null,
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
        state.phase === "error" && state.data
          ? el(ErrorState, { error: state.error, onRetry: props.onRetry })
          : null,
        items.length
          ? el("div", { className: "dshpm-grid" }, items.map(function (item, index) {
            var key = item.id || item.name;
            var expanded = !!props.expanded[key];
            // 卡片 + 它的详情卡组成一对：详情**跨整行**（grid-column:1/-1）紧跟在这张卡后面。
            // 以前详情是卡片自己的子节点，被挤进 232px 窄列、把整行撑高（用户：「展开太丑」）。
            return el(React.Fragment, { key: key },
              el(PluginCard, {
                index: index,
                item: item,
                categories: props.categories,
                expanded: expanded,
                busy: props.busyKey === "install:" + key,
                busyKind: props.busyKind,
                copied: props.copied === key,
                readOnly: props.readOnly,
                onInstall: props.onInstall,
                onToggleDetails: props.onToggleDetails,
                onCopy: function (command) { props.onCopy(command, key); }
              }),
              expanded
                ? el(PluginDetailCard, {
                  item: item,
                  copied: props.copied === key,
                  onClose: function () { props.onToggleDetails(key); },
                  onCopy: function (command) { props.onCopy(command, key); }
                })
                : null
            );
          }))
          : el(EmptyState, {
            title: t("list.empty.title"),
            body: t("list.empty.body"),
            actionLabel: t("list.empty.action"),
            onAction: props.onResetFilters
          }),
        // 底栏总是渲染：结果总数原先挂在网格上方、对任意页数都可见，挪进底栏后
        // 不能因为「只有 1 页」就把它藏起来（`pages > 1` 只决定里面有没有翻页按钮）。
        el(Pager, {
          page: page.page || 1,
          pages: page.pages || 1,
          summary: summary,
          loading: state.phase === "loading",
          busy: state.phase === "loading",
          onPrev: function () { props.onPage((page.page || 1) - 1); },
          onNext: function () { props.onPage((page.page || 1) + 1); },
          onFirst: function () { props.onPage(1); }
        })
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

    /**
     * 「已安装」页：某个包在这台宿主上**哪些控件根本不该渲染**。
     *
     * 用户要求「隐藏已安装下的开关或卸载不可以的项目」。这里的关键是把两种"不能点"
     * 严格分开——它们的正确处置是**相反**的：
     *
     *   - **结构上做不到**（宿主说这个包不能开关/不能卸载、根本没有 pluginManager、
     *     市场自己不能卸载自己、宿主要求不可移除）⇒ **不渲染**。渲染成永远点不动的
     *     灰按钮不是"保守"，而是在承诺一个永远不会发生的动作：用户会反复点、去猜
     *     为什么点不动，而按钮占着位置却没有出路。
     *   - **临时不可用**（写操作进行中、批量更新正在跑、这一条正在处理）⇒ **保留控件、只禁用**。
     *     否则操作期间按钮时隐时现，用户会以为功能丢了——那是另一种坏，而且更吓人。
     *     这一类**不在本函数里判**，由调用方用 `busy` / `batchRunning` 单独禁用。
     *
     * `notes` 是**必须补上**的说明：控件被隐藏后就没了 tooltip，若不把原因写进行内，
     * 用户只会看到"东西不见了"——那比"东西在但点不动"更难排查。所以隐藏一个动作，
     * 就得在同一行说清为什么。
     *
     * 导出**不是**刻意不做：本文件是宿主直接加载的 factory 闭包
     * （`window.__ModuleLoader__.load({ factory })`），整个文件没有 ESM 导出，
     * 所以这段逻辑**只能靠源码形状 + 真浏览器 e2e 来钉**（`verify/client-copy.test.mjs`
     * 与 `market-ui.e2e.mjs` 各有一条）。写测试时别指望 import 它。
     */
    function installedCapabilities(bundle, readOnly) {
      var source = bundle !== null && typeof bundle === "object" ? bundle : {};
      // readOnlyReason 查不到文案时**当作没有原因**：这是 v1.2.0 就定下的约定——
      // 把「查不到文案」当封锁会凭空锁住控件，而宿主那边本来会自己拒绝。
      var reasonKey = source.readOnlyReason ? "readonlyReason." + String(source.readOnlyReason) : "";
      var hostReason = reasonKey ? t(reasonKey) : "";
      if (hostReason === reasonKey) hostReason = "";
      var locked = readOnly === true || !!hostReason;
      var marketSelf = source.market === true;
      var notRemovable = source.removable === false;
      // **不可移除 ⇒ 开关也不能点**（v1.3.0 修）。
      //
      // 错过的样子：toggle 只看 locked，remove 才看 notRemovable，两条判据不同源。
      // 于是 `removable:false` 且 `readOnlyReason` 为空的包——实测真宿主 desktop profile
      // 30 个 bundle 里 removable=false 有 22 条、其中 readOnlyReason 非空只有 3 条，
      // 剩下 **19 条**（@deepseek-ai/dsh-headless、dsh-sdk-app、dsh-subagent-codex…）
      // ——卸载按钮不渲染（对），开关却照常渲染且可点（错）：点下去宿主回
      // `400 not-allowed`，界面上就是那句「这个操作被宿主拒绝」。
      //
      // 为什么 notRemovable 能作为独立判据：它是宿主直接给的布尔值，不依赖任何文案，
      // 所以不违反上面那条「查不到文案不要凭空锁」的约定（locked 的判据一行没动）。
      // 宿主侧 `selectBundle(name, enabled)` 对这类包两个方向都没有可写目标：
      // 禁用方向 `previous.includes(name)` 为 false 会静默跳过，启用方向
      // `bundleManifest` 取不到就抛 `ManagementFailure("not-bundle")`。
      // 宿主已经用 removable:false 表达了「这个包不归 profile 管」，
      // 市场不该把它渲染成一个可点的控件再让它失败。
      var toggle = !locked && !notRemovable;
      var notes = [];
      // 只在「没被宿主整体锁住」时补额外说明：那时 hostReason 已经写在行内了。
      if (!locked) {
        if (marketSelf) notes.push(t("installed.self"));
        else if (notRemovable) notes.push(t("installed.notRemovable"));
      }
      return {
        toggle: toggle,
        remove: !locked && !marketSelf && !notRemovable,
        hostReason: hostReason,
        locked: locked,
        notes: notes
      };
    }

    function BundleRow(props) {
      var bundle = props.bundle;
      var entries = props.entries || [];
      var rows = bundle.rows || [];
      // BundleInfo 可能带 readOnlyReason（宿主基础设施托管或无法定位）：这类包只能看，不能开关或卸载。
      var caps = installedCapabilities(bundle, props.readOnly);
      var hostReason = caps.hostReason;
      var locked = caps.locked;
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
            // 被隐藏的动作必须在**同一行**说出来。控件没了 tooltip 也没了，
            // 只留一个"东西不见了"是最难排查的状态（用户会以为是 bug）。
            caps.notes.length
              ? el("div", { className: "dshpm-rowMeta" }, caps.notes.join(" · "))
              : null,
            bundle.error
              ? el("div", { className: "dshpm-rowError" }, t("installed.rowError", { message: shortFailureText(bundle.error) || (bundle.error.code || "") }))
              : null),
          el("div", { className: "dshpm-rowActions" },
            // 开关：结构上不可用时**不渲染**（见 installedCapabilities）；
            // 只是忙就保留、禁用——否则操作期间按钮时隐时现，比灰着更让人以为功能丢了。
            caps.toggle
              ? el(Switch, {
                checked: bundle.enabled !== false,
                disabled: props.busy,
                title: t("action.disable") + " " + bundle.name,
                label: bundle.enabled === false ? t("action.enable") + " " + bundle.name : t("action.disable") + " " + bundle.name,
                onToggle: props.onToggle
              })
              : null,
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
              // 卸载：同样只在**结构上可以**时渲染。注意确认态（confirm）在上面那一支，
              // 它是用户已经点过按钮的后续步骤，必须照常渲染，不能被这里挡掉。
              : caps.remove
                ? el("button", {
                  type: "button",
                  className: "dshpm-btn",
                  disabled: props.busy,
                  onClick: props.onAskRemove
                }, el(IconTrash, { size: 12 }), t("action.uninstall"))
                : null,
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
                    //
                    // 外层包被宿主锁住时（locked）同理：开关一样是假的，所以**只报状态、不给控件**——
                    // 与行首那颗包级开关的处理保持一致（用户要求：不可以的项目就隐藏）。
                    // 状态文字仍要留着，否则用户连"它是开还是关"都看不到。
                    entry.enabled === undefined ? null
                      : (locked || !entry.entryId)
                        // 只报状态、不给控件。用**已有的**两个文案键，不新造：
                        //   - 缺 entryId（宿主没给 id）⇒ installed.noEntryId 说明为什么不能开关；
                        //   - 被宿主锁住 ⇒ badge.disabled / badge.enabled 报它是开还是关。
                        ? el("span", { className: "dshpm-rowMeta" }, entry.entryId
                          ? (entry.enabled === false ? t("badge.disabled") : t("badge.enabled"))
                          : t("installed.noEntryId"))
                        : el(Switch, {
                          checked: entry.enabled !== false,
                          disabled: props.entryBusyKey === "toggle:" + entry.entryId,
                          label: entry.enabled === false
                            ? t("action.enable") + " " + (entry.entryId || entry.moduleName || "")
                            : t("action.disable") + " " + (entry.entryId || entry.moduleName || ""),
                          onToggle: function () { props.onToggleEntry(entry); }
                        }))
                }))
                : el("span", null, t("installed.noPlugins"))))
          )
          : null
      );
    }

    /**
     * 这一行要不要**整张卡片都不渲染**（v1.3.0）。
     *
     * 判据：**开关和卸载都做不到**时才整张藏掉——那时这一行对用户没有任何可执行的动作，
     * 留着只是占位置；而只要还有一个动作能用（例如 `removable:false` 但可以开关），
     * 卡片就必须留着，否则会把一个**本来可用**的功能一起藏掉。
     *
     * **两个不能省的例外**：
     *
     * 1. **全局只读（宿主没有 pluginManager）→ 绝不隐藏任何卡片。**
     *    那种情况下每个包的 `toggle`/`remove` 都不可用，按上面那条字面规则会**把整页藏空**，
     *    而顶部已经有一条横幅解释"只能浏览"了。更要紧的是：那时页面唯一的价值就是
     *    「这个 profile 装了什么」这份清单，藏掉它等于把仅剩的信息也扔掉，
     *    而且摘要里的计数还会继续说谎（见下面 InstalledPane 的 hidden 处理）。
     * 2. `installedCapabilities` 把「readOnlyReason 查不到文案」当**没有原因**（v1.2.0 的约定），
     *    所以这里也只在**确实拿到了原因**时才认为它是结构性的。
     */
    function shouldHideInstalledCard(bundle, readOnly) {
      if (readOnly === true) return false;
      var caps = installedCapabilities(bundle, readOnly);
      return !caps.toggle && !caps.remove;
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
      // 整卡不渲染的用户要求（见 shouldHideInstalledCard）：先算出**这一页真正要画的**那些，
      // 因为摘要计数与"空页"判断都得分依据**可见的**行，否则界面会自相矛盾——
      // 「共 3 个插件」下面一行都没有，正是那种"数字在说谎"。
      var visible = bundles.filter(function (bundle) {
        return !shouldHideInstalledCard(bundle, props.readOnly);
      });
      if (!visible.length) {
        // 全都被藏掉了：**不能回落到"空列表"**。那不是"没装东西"，是"这一页没有可操作的项"，
        // 两者对用户的意义完全不同（一个该去发现页装，一个该去终端/别处管）。
        return el(EmptyState, {
          title: t("installed.allHidden.title"),
          body: t("installed.allHidden.body", { count: bundles.length }),
          actionLabel: t("action.goDiscover"),
          onAction: props.onDiscover
        });
      }
      return el("div", { className: "dshpm-installed" },
        el("div", { className: "dshpm-summary" },
          el("span", null, t("installed.count", { count: visible.length })),
          // 藏了东西就把差额如实说出来：不说的话，"共 N 个"与列表长度对不上，
          // 用户会以为界面漏了东西（或以为有 bug）。
          visible.length < bundles.length
            ? el("span", null, t("installed.hiddenCount", { count: bundles.length - visible.length }))
            : null,
          state.phase === "loading" ? el("span", null, t("list.updating")) : null),
        state.phase === "error" && state.data
          ? el(ErrorState, { error: state.error, onRetry: props.onRetry })
          : null,
        visible.map(function (bundle, index) {
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

    /**
     * 宿主 `ChangeResult.application` 的封闭集合（契约 §2.4）。
     *
     * 为什么客户端也要有一份：宿主半在进程里被 Loader 缓存，**装完新版本后要重启才换**
     * （docs/RELEASING.md §5），而客户端半随包更新即生效。于是存在一个真实的混版本窗口：
     * **新客户端 + 旧宿主半**。若那时的内核回了一个旧宿主半没见过的状态，旧半按
     * `application !== 'failed'` 会回 ok:true，客户端照原样落到「else 成功」分支——
     * 一次没人确认过的操作被渲染成绿色成功（实测 `_verify/unknown-application-client.mjs`：
     * 'unknown' / 'appliedd' / 数字 1 全部 ⇒ kind=success, applied=true，批量还按 applied
     * 计成功）。服务端半收紧后这条只在混版本窗口里可达，但那正是最容易出事的窗口。
     * 缺 application 字段仍按原样默认 applied（那是既有契约形状，不在这里改）。
     */
    var CHANGE_APPLICATIONS = {
      "applied": true,
      "restart-required": true,
      "overridden": true,
      "failed": true,
      "cancelled": true
    };

    function applicationKnown(raw) {
      return typeof raw === "string" && CHANGE_APPLICATIONS[raw] === true;
    }

    function noticeFromResult(payload, kind, name) {
      var applicationRaw = payload && payload.application ? String(payload.application) : null;
      // 只有**给了值但读不懂**才拦（没给值沿用既有的 applied 默认，不改既有形状）。
      if (applicationRaw !== null && !applicationKnown(applicationRaw)) {
        return { kind: "error", applied: false, text: t("notice.unknownApplication", { name: name, application: applicationRaw }) };
      }
      var application = applicationRaw === null ? "applied" : applicationRaw;
      var changed = !payload || payload.changed !== false;
      var warnings = payload && payload.warnings && payload.warnings.length ? payload.warnings.join("；") : "";
      // 热挂载的结果**优先于** application 那条默认文案。原因：宿主回 restart-required 是
      // 它对「自己能不能热应用」的判断，而市场随后替它挂上了（见 host 半的 hot-mount.js）。
      // 此时若照着 application 写「重启 DSH 后生效」，用户会看到一条**假的**待重启提示——
      // 东西已经在跑了，而重启横幅也会跟着亮起来。反过来，挂载失败时必须把失败原因说出来，
      // 否则用户只知道「要重启」，不知道市场替他试过、以及为什么没成。
      var hotMounted = payload && payload.hotMounted === true;
      var hotFailed = payload && payload.hotMounted === false;
      var base;
      if (hotMounted && changed !== false) {
        base = { kind: "success", applied: true, text: t("notice.installHotMounted", { name: name }) };
      } else if (hotFailed && changed !== false) {
        var reason = payload.hotMountReason ? String(payload.hotMountReason) : "";
        base = {
          kind: "warn",
          applied: true,
          text: reason === ""
            ? t("notice.installRestart", { name: name })
            : t("notice.installHotMountFailed", { name: name, reason: reason })
        };
      } else if (!changed && application !== "restart-required" && application !== "overridden" && application !== "cancelled") {
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
      // 热挂载成功时也**不**覆盖：市场已经给了比 activation 更准的一句（上面那条），
      // 再用「并已在运行」盖一遍反而丢掉了「不用重启」这个对用户最关键的信息。
      var detailed = activationNotice(payload && payload.activation, name);
      var mismatch = !!(payload && payload.activation && payload.activation.versionMatches === false);
      if (detailed !== null && !hotMounted && (changed !== false || mismatch)) base = detailed;
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
      var applicationRaw = payload && payload.application ? String(payload.application) : null;
      // 与 noticeFromResult 同一条规矩：给了值但读不懂 ⇒ 不能说「已启用/已停用」。
      // 开关的 applied 直接决定回执行不行、批量计成功还是失败，谎报比报错更糟。
      if (applicationRaw !== null && !applicationKnown(applicationRaw)) {
        return { kind: "error", applied: false, text: t("notice.unknownApplication", { name: name, application: applicationRaw }) };
      }
      var application = applicationRaw === null ? "applied" : applicationRaw;
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

      // 滚动容器（.dshpm-root）的 ref。真正滚动的是**面板自己**（实测
      // scrollHeight 1616 > clientHeight 885），不是 window——所以「回到顶部」与翻页
      // 都要滚它。声明放在这里（而不是 return 之前）：`goToPage` 要用它，
      // 而函数在模块级顺序上先于 return 出现更容易读。
      var scrollRef = React.useRef(null);

      /**
       * 翻页：改页码，并**把列表滚回顶部**（用户要求）。
       *
       * 为什么翻页必须回顶：分页器长在列表**最底部**，所以点完「下一页」时用户正看着
       * 新页的**末尾**——最想看的第一条在屏幕外上方，还得自己往回滚一整页。
       * 这与搜索/排序/分类不同：那些控件在**顶部**，能点到它们就说明人已经在顶部了，
       * 所以那些 `setPage(1)` 不需要回顶（多做反而会在用户已经置顶时白滚一次）。
       *
       * `instant`：翻页时用**瞬时**而不是平滑滚动。列表内容马上会被整体换掉，
       * 在正在重排的列表上放长距离动画容易显得"打架"；而且用户要的就是「自动调转到
       * 最顶部」，瞬时本来就是他说的那个效果。
       *
       * **一条实测更正**：我起初把 instant 的理由写成「异步滚动会与内容替换打架」。
       * 用变异体把这两句**调换顺序**（先回顶再 setPage）真跑了一遍 e2e，量到的数值与基线
       * **逐位相同**（scrollTop 526 → 0、第 1/195 页 → 第 2/195 页、头部都在视口内）
       * ⇒ 在这条路径上**顺序无所谓**，`behavior:"auto"` 是同步的、容器节点又被 React 复用，
       * scrollTop 不会被带回去。所以那是 **UX 取舍**，不是「避免某个已复现的 bug」；
       * 「smooth 会打架」我没量过，不当结论用。
       *
       * reduced-motion 的判定在 scrollContainerToTop 里，两条路都受它管。
       */
      function goToPage(value) {
        var next = value < 1 ? 1 : value;
        setPage(next);
        scrollContainerToTop(scrollRef.current, true);
      }

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
       * 宿主能不能一键重启（`/status` 的 `restart.available`），以及**为什么不能**。
       *
       * 宿主半按部署环境判（systemd / 桌面壳 / 调试器 / 显式关闭，见 restart-policy.js），
       * 并在 `restart.reason` 里给出是哪一种。原因不同则下一步动作不同，所以文案也分四条
       * （`restart.manualBody.<reason>`）——把它们压成一句会让用户去试一个不可能成功的办法。
       *
       * 还有一条**独立**的原因：`restart.available` 为 true 但当前请求过不了围墙
       * （`reachable === false`，例如经过反向代理）。那种情况下按钮点下去必然 403，
       * 所以也当作"不可用"处理，文案走 `unreachable`。
       *
       * 默认 true（读不到 /status 时保持旧行为）；只有宿主明确说 false 才降级。
       */
      var restartInfo = (status.data && status.data.restart) || null;
      var restartAvailable = !(restartInfo && restartInfo.available === false);
      var restartReason = restartInfo && restartInfo.reason ? String(restartInfo.reason) : null;
      // 可点 = 宿主允许 **且** 这个来源过得了围墙。缺一条都不给按钮。
      if (restartAvailable && restartInfo && restartInfo.reachable === false) {
        restartAvailable = false;
        restartReason = "unreachable";
      }

      /**
       * 「不能一键重启」时该说的那句话。
       *
       * v1.3.0：原因不同则**下一步动作不同**，所以文案分四份，回落到通用的那条。
       * 用 `t("restart.manualBody." + reason)` 这种**字面量前缀**写法，而不是自己拼
       * `"restart.manualBody." + reason` 再交给 t()——后者静态扫描看不到这些键，
       * 会被 verify/client-copy 的「没有僵尸文案」那条判成五个没人用的键（它真的报了）。
       * t() 对缺失键会回键名本身，所以这里要先确认拿到的是文案而不是键名，
       * 否则用户会看到 `restart.manualBody.systemd` 这种东西。
       */
      var RESTART_MANUAL_REASONS = ["desktop", "systemd", "inspector", "disabled", "unreachable"];
      function restartManualBody() {
        if (restartReason !== null && RESTART_MANUAL_REASONS.indexOf(restartReason) !== -1) {
          var text = t("restart.manualBody." + restartReason);
          if (text !== "restart.manualBody." + restartReason) return text;
        }
        return t("restart.manualBody");
      }

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
        // 热挂载成功 = 这次改动**已经生效**（市场替宿主把新插件挂进了运行中的组合，
        // 见 host 半的 hot-mount.js）。此时宿主虽然回的是 restart-required，但那条横幅
        // 会说一句假话：「还有 1 项变更需重启」——东西明明在跑。
        // 宿主半的 sendChangeResult 同样不为它记账（两边一致），这里再挡一道：
        // 客户端的这条路径是横幅**当场**亮起的来源。
        if (payload.hotMounted === true) return;
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
        // 宿主同一份快照里的热挂载清单。宿主半已经保证这两者不会互相矛盾
        // （热挂载成功的不进 pendingRestart，见 sendChangeResult），这里再按它滤一道：
        // 万一两半的版本对不上（旧宿主半 + 新客户端），也不会因为一个已经在跑的插件
        // 亮起「还有 1 项变更需重启」——横幅说假话比少说一次更坏。
        var hot = Array.isArray(payload.hotMounts) ? payload.hotMounts.map(function (entry) { return String(entry).toLowerCase(); }) : [];
        for (var i = 0; i < names.length; i++) {
          var name = String(names[i]);
          if (hot.indexOf(name.toLowerCase()) !== -1) continue;
          if (restartNamesRef.current.indexOf(name) === -1) restartNamesRef.current.push(name);
        }
        if (restartNamesRef.current.length === 0 && marketVersion === null) return;
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

      /**
       * 「更新这一条」到底该发什么 spec。
       *
       * 为什么不能直接用 bundle.name：宿主 install() 对**显式 spec** 只做
       * `sameKey(item.spec|item.npm|item.url, spec)` 精确匹配，**不认 item.name**；
       * 而决定「哪条算可更新」的 matchBundle 是认 name 的。两处口径不一致，于是
       * 「npm 为空、只有仓库地址」的条目（实测真实目录 5786 条里 2819 条）会显示
       * 「更新到 x.y.z」，点下去发的是包名 → 400 not-in-catalog，更新永远失败。
       *
       * 修法：宿主在 /installed 里为每条 join 出 `updateSpec`（目录那条真正的 spec），
       * 这里优先用它。拿不到（老宿主 / 没匹配上 / 空串）就退回 bundle.name ——
       * 行为与修复前完全一致，不给老宿主制造新的失败面。
       *
       * 为什么不在宿主放宽匹配（把 name 加进 spec 分支）：那会破坏「装什么只能落在
       * 目录里唯一确定的条目上」这条安全约束——name 有重名（真实目录里 dsh-pua 属于
       * 两个 owner），按 name 猜就会装错包。
       */
      function updateSpecFor(bundle) {
        var given = bundle && typeof bundle.updateSpec === "string" ? bundle.updateSpec.trim() : "";
        if (given !== "") return given;
        return bundle && typeof bundle.name === "string" ? bundle.name : "";
      }

      /** 「可更新」页里点「更新到 x.y.z」：走同一条安装接口，把结果记回该条。
       *  silent 用于一键更新（回执只发汇总那一条）；onDone 用于顺序执行的下一步。 */
      function updateBundle(bundle, silent, onDone) {
        submitInstall({ name: bundle.name, label: bundle.name, spec: updateSpecFor(bundle), kind: "update", key: bundle.name }, null, function (outcome) {
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
            onPage: goToPage,
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

      // （滚动容器的 ref 与 goToPage 在组件顶部声明——见「翻页：改页码并回顶」那一段。）

      // 弹窗挂成 .dshpm-root 的**兄弟节点**（Fragment 包一层），不做它的子项：
      // .dshpm-root 的直接子项被 e2e [8] 的几何断言盯着（「任何直接子项都不得被压扁」），
      // 而这个覆盖层是 fixed、天然比 root 高，塞进去只会让那条断言变得含糊。
      return el(React.Fragment, null,
        el("div", {
          className: "dshpm-root",
          ref: scrollRef,
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
                : restartAvailable ? t("restart.bannerBody") : restartManualBody()
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
          : null,
        // 「回到顶部」：与弹窗同级挂在 root 外面 —— 既躲开 e2e [8] 对 root 直接子项的
        // 逐项检查，也不受 root 的 overflow 影响。它自带滚动阈值，未超过时渲染 null。
        el(BackToTop, { scrollRef: scrollRef })
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
      // 官方快照里的语言定义也要一起读：active 是第三方语言包时，只有它才能给出 fallback 链。
      function readSnapshot() {
        if (!locale || typeof locale.getLocale !== "function") return null;
        try {
          var snapshot = locale.getLocale();
          if (snapshot && Array.isArray(snapshot.locales)) LOCALE_DEFINITIONS = snapshot.locales;
          return snapshot && snapshot.active ? snapshot.active : null;
        } catch (readError) {
          return null;
        }
      }
      initial = readSnapshot();
      if (!initial) initial = detectLocale();
      setActiveLocale(initial);
      if (locale && typeof locale.subscribe === "function") {
        try {
          locale.subscribe(function () {
            try {
              setActiveLocale(readSnapshot());
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

      ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "plugin-market" }, withCrashBoundary(MarketPage, "panel", "main")));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "plugin-market", order: 15, label: () => t("market.title") }, withCrashBoundary(MarketEntry, "entry", "sidebar.footer.action")));
    };

    return module.exports;
  }
});
