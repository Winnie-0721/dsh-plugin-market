# Changelog

## 1.2.0

> **本节开头三条是 `v1.2.0` 标签之后追加的记录**（按最新在前排列；提交类型为 `docs:` / `ci:`，
> 按 `docs/RELEASING.md` §1 的判档口径**不升档**）：① 本轮文档整理、② 修掉连续两次让
> `Pack and Release` 变红的 npm 发布真因、③ 补齐两个套件的门禁记录。
> （对照办法：`git show v1.2.0:plugin-market/CHANGELOG.md` 里这三条都没有。）
> **它们不改变已发布的产物**：npm 上的 1.2.0 与 `v1.2.0` 标签内容仍是同一份，
> 附件与版本号都没动。唯一的实际影响是——**npmjs.com 上那个 1.2.0 页面显示的是标签当时那份
> 中文 README**（这些文字要等下一次发布才会出现在 npm 页面上）；仓库里的 README 是最新的。
> 这一条**逐字节核对过**：`npm pack deepseek-harness-market@1.2.0` 解包出的 **14 个文件
> 与 `v1.2.0` 标签逐个 sha256 相同**；`npm view … readme` 的正文（去掉 CRLF 差异后）
> **等于 `v1.2.0:plugin-market/README.zh.md`**，长度 7617 字符——所以 npm 页面喂的是中文那份，
> `README.md`（12516 字符）只是随包发布但没被选为展示正文。

- **文档整理：把「当时的说法」与「现在的事实」分开，并修掉 7 条失效链接**（用户第九轮
  「整理并更新 文档和README.md」）。

  **先清洗事实**。三处说法已经过期，都是「当时判断对、条件后来变了」而不是当时写错——
  现在都在原地留**更正块**，不悄悄改掉：`docs/RELEASING.md` 里 v1.1.6 与 v1.2.0 的
  「已暂存，等待批准」（**已公开**：`npm view` → 1.2.0）、`docs/ROADMAP.md` P1.5 的
  「待做」（**已关闭，不立项**）、`docs/API-CONTRACT.md` §5 第 18 条的「故意保留、未修」
  （`4e1e873` 已修，理由只剩不可达）。同一批还改掉了三处会误导人的旧表述：
  「两个 workflow 都加 Trusted publisher」（**现在只需登记 `publish-npm.yml`**）、
  「job 里会先 `npm install -g npm@latest`」（**是 `^11.5.1`，npm@latest 会 EBADENGINE**）、
  「常规发布之后还要另外手动跑一次 `Publish to npm`」（**根治后不必了**）。

  **顺带发现并修掉 7 条失效链接（真缺陷，不是措辞）**：`docs/PLUGIN-MARKET.md` 里
  `[REPORT §12.x](REPORT.md)` 指向 `docs/REPORT.md` —— **那个文件不存在**，
  报告在 `verify/REPORT.md`。用一次性脚本 `_verify/link-check.mjs`（git-ignored，不进门禁）
  扫了 11 个文档的 70 条相对链接：**修复前 7 条目标不存在，修复后 0 条**（含锚点校验）。
  这类链接在 GitHub 上就是死链，读者点一次就撞墙。

  **这个体检工具自己也做了变异测试，4/4 符合预期**（`_verify/link-check.mutation.mjs`：
  基线应干净 / 目标改回坏文件 / 锚点指向不存在的章节 / 代码段里的坏链不误报）。
  **两次都是工具先假绿，抓的是我自己的夹具错**，记下来因为它和本轮反复出现的是同一类错：
  1. 第一版**没设 `cwd`** —— `link-check.mjs` 用 `resolve(相对路径)` 解析链接，
     而相对路径相对的是**进程工作目录**；于是它在扫仓库里那份**已经修好**的文档，
     两个变异都「判为干净」。
  2. 第二版设了 `cwd`，却**只拷了 md 文件**做夹具 —— 而 README 会指向
     `verify/release-workflow.test.mjs`、`.github/workflows/publish-npm.yml`、`scripts/*.ps1`，
     基线里这些合法链接全报 MISSING → **基线假红**，后面的变异结论随之作废。
  两次都不是「被测逻辑错了」，而是**工具/夹具站错了地方**。改成整仓拷贝（跳过 `.git`/`node_modules`/
  `_ref`/`_verify`）后 4/4。

  **README 补齐了三件它一直没说的事**（这是本轮最实质的内容补全）：
  ① **桌面端没有一键重启按钮，而且是故意的** —— README 原来只写「亮出一键『重启 DSH』」，
  桌面端用户照着找会发现根本没有那颗按钮。现在四个 README 都写清两条路径的差别
  （`dsh web`/CLI 有按钮；桌面端**关掉窗口再打开**，刷新页面不算），并指向
  [API-CONTRACT §2.6](../docs/API-CONTRACT.md) 的三条独立理由；
  ② **「待重启」刷新页面丢不掉** —— 记账在宿主半，不是页面内存；
  ③ **门禁与 CI 的真实形状**：门禁**自动发现** `verify/*.test.mjs`（当前 **20 套**）、
  e2e **90 条**不进门禁、npm 发布**只有 `publish-npm.yml` 一份实现**，
  以及那条反向断言。仓库结构表补上了 `.github/workflows/`、`RELEASING.md`、`ROADMAP.md`。

  **文案层面的一个诚实标注**：npm 页面上现在显示的仍是 `v1.2.0` 标签当时那份 README
  （`files` 里含 `README.md`/`README.zh.md`），**仓库里的改动要等下一次发布才会反映到 npm 页面**——
  写在 CHANGELOG 顶部，免得下次有人以为「改完 README 就上线了」。
  这条**核对过**：npm 上 1.2.0 的 tarball 与 `v1.2.0` 标签逐字节相同，registry 上的 README
  也确实等于 `v1.2.0:plugin-market/README.zh.md`。

  **请独立一方复核文档，抓出 7 条我说错的——这一步价值最高。**
  **7 处不实，没有一处是我自己发现的**：①「追加**两条**」其实**三条**；② §14 写「工作树干净」
  而当时有 **10 个**未提交文件（就是 §15 自己改的）；③ §14 写「**在真实 CI 里验证过**」
  读起来像已发布成功，实际那一步是 **`skipped`**（幂等闸门命中）——**我在 §14 刚批评过这个错觉，
  转头又犯了一遍**；④ e2e 增量链 `64→+4→82`、`82→+3→86` 算错（真实是
  64→65→67→78→82→83→86→90，端点数对、链条错）；⑤ ROADMAP §5 还写 78 条（现 90）；
  ⑥ RELEASING 两处「404 名字仍可用」（现 200，且与同文档「1.2.0 已公开」自相矛盾）；
  ⑦ API-CONTRACT §5 六处套件条数（43/36/27/11/45/22 → 50/38/38/15/50/31）。

  **分类看得很清楚**：③ 是**判断错**（把跳过说成验证），①④⑤⑥⑦ 是**数错/没跟着更新**——
  两类都不是写作能力问题，而是**没把「数一遍」和「分清证明了什么」当成必需步骤**。
  第 ⑦ 条原来就在 HEAD 上（不是本轮引入），但既然要「整理」，就一起对齐。
  全部已改，核对结论也写进了 `verify/REPORT.md` §15 第五小节。

  **验证**：门禁 `release.ps1 -LocalOnly` **exit=0、20 套件全绿**；四份 README 的
  标题结构与新增表格逐份对齐；行尾统一 LF、无尾随空白（`.gitattributes` 要求）；
  链接体检 exit=0 且**它自己的变异测试 4/4**。**本次不递增版本、不打包、不发布。**

- **修掉连续两次让 `Pack and Release` 变红的真因：npm 的 Trusted Publisher 认的是
  `job_workflow_ref` 里的那个**文件名**，而 `pack-release.yml` 里**自己写了一遍**发布步骤**
  （用户第八轮「修复工作流的问题」）。

  **症状**：`Pack and Release` 连续两次 red（v1.1.6 的 run #3、v1.2.0 的 run #4），
  但**打包那半一直成功**、Release 附件齐全，只有 `publish-npm` job 报：
  ```
  npm error code ENEEDAUTH
  npm error need auth This command requires you to be logged in to https://registry.npmjs.org/
  ```

  **真因不是推断出来的，是测出来的**。我先写了三个临时探针 workflow（普通 job / caller /
  callee）跑在真实 Actions 上，量出 OIDC 令牌里那个字段的取值：
  ```
  普通 job      : job_workflow_ref = 所在文件
  workflow_call : job_workflow_ref = **被调用**的文件（workflow_ref 才是调用方）
  ```
  所以 `pack-release.yml` 自己跑发布时，令牌里的文件名是 `pack-release.yml`，
  与 npm 上登记的 `publish-npm.yml` 不符 → `ENEEDAUTH`。
  **旁证**：run #2 那次 `publish-npm` 显示「成功」其实只是命中了幂等闸门（1.1.5 已在 npm，直接 skip）
  ——这个 job **从未真正发布成功过**，v1.1.6 是靠手动跑一次 `Publish to npm` 才补上的。

  **改法**：`publish-npm.yml` 加 `workflow_call` 成为**唯一**的发布实现，
  `pack-release.yml` 的 job 缩成 `needs: pack` + 双侧 `id-token: write` +
  `uses: ./.github/workflows/publish-npm.yml`；原来重复 job 里的**幂等闸门**搬了过去（不能丢，
  否则补跑会因版本已存在而失败）。

  **在真实 CI 里跑了复用路径，但要分清它证明了什么、没证明什么**：`Pack and Release` run
  [#37941309305](https://github.com/Winnie-0721/dsh-plugin-market/actions/runs/37941309305)
  `conclusion=success`（`pack=success`、`publish-npm / publish=success`），日志里打出
  `job_workflow_ref = …/publish-npm.yml@refs/heads/main` 与
  `workflow_ref = …/pack-release.yml@refs/heads/main`——**第一个字段正是 npm 校验的那个，
  复用路径下它没变，与登记一致**。这是本次修复真正要的结论。
  **但那一步这次是 skipped**：`Stage publish to npm` = **skipped**（幂等闸门命中——npm 上
  1.2.0 发布于 13:48:06Z，run 于 14:03:09Z 才起），所以「job 绿」**不等于**「经复用真的发布过」。
  我第一版把这两件事写混了（说「在真实 CI 里验证过」，像是发布了），是复核算出来的，
  已在 `docs/RELEASING.md` §4.2.1 写清逐步骤结论，并把「下次发新版本时那一步才是首次实跑」
  写成提醒。**v1.1.6 那次「publish-npm 显示成功、其实只是闸门命中」是同一种错觉，我又差点重犯。**

  **另加一步发布前自检**（`自检 OIDC 身份`）：只请求令牌、解出声明、比对文件名，不发布任何东西。
  它把「文件名不对」从一句要翻日志才看得懂的 `need auth`，变成发布**之前**就说明
  「登记的是 publish-npm.yml，这次是 xxx」的错——这个坑连续吃掉两次发布，不该再靠事后读日志定位。

  **防复发**：新增 `verify/release-workflow.test.mjs`（14 项，已入门禁）含一条**反向断言**
  ——`pack-release.yml` 里不得出现 `npm stage publish`（「把发布步骤再写一遍」正是复发两次的写法）。
  **变异测试 7/7 CAUGHT**，含 M1「把发布命令写回 pack-release.yml」；期间我自己的两条断言先漏检
  （全文正则命中了别处的同名条件），改成锚定到具体 job / step 后全部抓住。
  临时探针已删除，并有断言防止残留。**本次不递增版本、不打包、不发布。**

- **补齐两个「不说谎」套件的门禁记录**（此前代码进了门禁、但 CHANGELOG / REPORT 都没提）：
  `verify/truth-report.test.mjs`（**7 条**，NEW-1 批准死路 + NEW-2 自更新假绿灯，
  直接调 `apply()` 读响应体）与 `verify/restart-unsupported.test.mjs`（**8 条**，
  真实 409 载荷的 `errorCopy` 文案 + `startRestart()` 失败分支回 `failed` +
  已知码 `why` 不被宿主原话覆盖、并含 `install-failed` 泛化对照）。
  门禁现共 **20 套件**；`release.ps1 -LocalOnly` exit=0。
  同时更正 `docs/ROADMAP.md` P1.5（原判据「客户端无条件亮绿灯」已在 4e1e873 修掉，
  条目关闭、不立项）与 `docs/API-CONTRACT.md` §5 第 18 条的「故意保留、未修」表述。
  **另记一条 2026-10-09 实测的分发事实**：jsDelivr gh 的两条下载路
  （`@v<tag>/releases/…` 与 `@main/releases/…`）对 v1.1.6、v1.2.0 **稳定 404**
  （`releases/` 已不在 git 树，jsDelivr gh 源只读 git 树）——自更新靠第 3 路
  GitHub Release 附件兜底（实测 3/3 成功），手动安装也请只用附件地址
  （`docs/RELEASING.md` §4.4 已加复测记录）。**本次不递增版本、不打包、不发布。**

- **桌面端为什么没有一键重启按钮：我原来的理由不完整，查清后把真理由写进契约；顺带修掉
  「刷新页面就丢掉待重启提示」**（用户第六、七轮：先问「你桌面端为什么不做重启按钮」，
  再问「是默认生效的吗」）。

  **先纠正我自己**。我原先写的理由是「替代进程会被单实例锁挡下」——那只是第一层。
  读完壳的 `lib/main.js`（490KB）后，事实更硬，且**三条各自独立成立**：

  1. **没有「请壳重启自己」的通道**。宿主→壳的 IPC 消息是**封闭白名单**，
     壳只认 `ready` / `platform-session` / `shutdown-complete` / `fatal` 四种；
     其余一律 `fail("invalid IPC event")` **并 SIGTERM 掉子进程**（`main.js:3698-3717`）。
     「礼貌地请求重启」连消息类型都不存在。
  2. **宿主一退出，壳当致命故障处理，且不会自动拉回来**：`child.once("close")` 里
     `code !== 0` 与 `code === 0` **都**走 `fail(...)`（`main.js:3721-3728`）→ 弹原生
     「启动失败」对话框。自动重启只发生在壳**自己的更新流程**里（`restoreHost` 分支）。
  3. **那个对话框里有一颗破坏性按钮**：`[退出应用, 重启应用, 停用第三方插件]`，
     第三颗走 `disableAllPlugins()`——一键停用**所有**第三方插件（含市场自己）。

  让用户撞出「启动失败」框、还可能手滑停掉全部插件，比「请关掉窗口再打开」糟得多。
  **真正合规的重启通道是壳自己的 `InstallAndRestart`**（带任务收割与交接），那是壳的职责。

  **修掉的真问题：待重启提示只活在页面内存里**。客户端原来把「待重启」存在 React state，
  注释还写着「刷新后没了就没了」——但那是**磁盘上的事实**，刷新不会让它消失，宿主仍在跑旧代码。
  后果正是用户遇到的那一幕：更新完 dsh-mobile 随手刷新 → 横幅消失 → 他以为已经生效，
  于是来问「是默认生效的吗」。
  修法：宿主半 `restartPending` 模块级记账 → `/status` 带 `pendingRestart` → 客户端挂载时水合。
  **它成立的关键是语义恰好自洽**：模块级变量在宿主**真重启**时自然清空，不需要任何落盘或过期逻辑。
  边界：只记 `restart-required`/`requiresRestart`（`applied` 已热生效**不记**）、上限 32 条、
  水合**不弹窗**、不许把 `restarting` 退回 `idle`、宿主说没有时**什么都不做**（不清掉已有的）。

  **验证**：真实浏览器 e2e **87→90**（新增 [11]：拦截 `/status` 注入「宿主仍记得」→ 整页重载 →
  断言横幅出现、且**不弹窗**、且桌面端仍不给按钮；再反向断言「宿主没有时不得凭空出现」）；
  门禁 18 套件 PASS（host-contract 38 项）。
  **变异测试 6/6 全部被抓住，且各自被正确的车道抓住**：M5 去掉客户端水合 → e2e 红；
  M6 去掉 `/status` 的 `pendingRestart`、M7 把 `applied` 也算待重启 → host-contract/门禁红
  （e2e 抓不到这两条是**正确的**——它拦截了 `/status`，只测客户端半）。还原后 sha256 逐字节一致。

  **本轮记三条我自己的错**（都写进注释，避免下次再犯）：
  1. **模板字符串里写了反引号**（连注释里也不行）。它提前结束模板，表达式被切成字符串拼接，
     跑起来报 `restartBtn is not a function`——与现场毫不相干，而 `node --check` **是过的**，
     只有真跑才暴露。
  2. **断言站错地方**：刷新后我只等 `.dshpm-entry` 就去查 `.dshpm-banner`，但**面板默认是关的**、
     横幅不在 DOM 里。而且我第一版等的是 `.dshpm-restartBtn`——桌面端 `restart.available=false`
     时那个按钮**故意不存在**。两处都是「测空气」，跟功能是否生效无关。
  3. **改一个被「抠出来执行」的函数，要连带看谁在抠它**：`sendChangeResult` 新增一句记账调用后，
     `build-approval.test.mjs`（它在裸作用域里 `new Function(抠出的源码)`）当场 ReferenceError
     假红——缺 `noteRestartFromResult` 与它读写的 `restartPending`。**门禁在改完当场抓住了它**。

- **开关 ↔ 重启：确认有一处真冲突，并修掉**（用户第五轮问「检查开关和重启是不是有冲突」）。

  **先回答「冲突在哪」**——不是「写了同一个文件」，而是**粒度不一致**：

  | | 动作粒度 | 落盘 |
  |---|---|---|
  | 开关 | **文件级** | `setBundleEnabled` → `selectBundle` 写 `package.json` 的 `dsh.profile.bundles`；`setPluginEnabled` → `writePluginEnabled` 写 `cordis.patch.yml`（都用 `writeFileAtomic`，写在半路不留半个文件） |
  | 重启 | **进程级** | 宿主在 `RESTART_EXIT_DELAY_MS`(900ms) 后 `process.exit(0)` |

  所以**真正危险的是「在写操作进行中点重启」**：进程会在写入落地前退出；安装还牵着
  **pnpm 子进程**（pnpm 子树可能比宿主活得久）。修复前重启按钮只看 `restart.phase === "restarting"`，
  **完全不看有没有写操作在跑**——用户可以在一键更新跑到一半时点「重启 DSH」。

  **同时验明「开关状态能活过重启」**（新增 `verify/repro-toggle-vs-restart.ps1`）：
  热开关 `application:"applied"` → 杀掉宿主 → 重启同一 profile → `enabled` 仍是关着的。
  持久化不靠内存，所以**重启本身不会丢开关状态**——冲突只发生在「同时」。

  **修法**：写操作进行中（`job` 非空，或「一键更新」整轮 `batch.running`）禁用重启，
  与更新按钮同一个口径；tooltip 说明原因（新增 `restart.busy`）。两处都挡：
  横幅按钮的 `disabled`，以及 `startRestart()` 自身（弹窗里的「立即重启」是另一个入口，
  只挡按钮会留后门）。写操作结束后**恢复可点**（另加一条反向断言，防止一禁到底）。

  **验证**：真实浏览器 e2e **83→86**，3 条新断言（前置可点 / 进行中禁用 / 结束后恢复），
  先跑到红再改；**变异测试 2/2 CAUGHT**（去掉 writeInFlight 判定 / 把 `data-write-busy` 写死），
  还原后 sha256 逐字节一致。

  **本轮记一条我自己的错**：第一版把 `var writeInFlight = …` 写进了 `el(...)` 的参数列表——
  JSX 参数位是表达式，不是语句，`node --check` 当场报 `Unexpected token 'var'`。
  第二版把断言放在**批量进行中**去查 `.dshpm-restartBtn`，那时**重启横幅还没出现**（它由
  `restart-required` 点亮），取到 `null` 而失败——**那不是修复没生效，是断言站错了地方**。
  教训：断言「某个东西被禁用」之前，要先确认**那个东西此刻真的存在于 DOM 里**，
  否则测的是空气。

- **上一轮的「版本并集」豁免方案本周就被现实打破（同一天复现，已换成裸包名）**。

  第五轮我把 profile 的 `minimumReleaseAgeExclude` 写成 `dsh-context@0.64.0 || 0.65.0`，
  当次 PASS。**但它是会腐坏的**：`dsh-context` 的 specifier 是 `^0.66.0`（caret 范围，会自动升版），
  升级当天 pnpm 就把触发的 `- dsh-context@0.66.0` **追加到列表末尾**，而
  `evaluateVersionPolicy` 只认**第一个**同名规则（命中就 `return`）——于是：

  ```yaml
  minimumReleaseAgeExclude:
    - dsh-context@0.64.0 || 0.65.0   # ← 先命中就返回，0.66.0 不在里面
    - dsh-context@0.66.0             # ← pnpm 自己追加的，永远不生效
  ```

  lockfile 校验再次失败（实测 `dsh-context@0.66.0 was published at … within the cutoff`）。
  **我的修复「通过了一次」，但没通过时间。**

  **改成裸包名** `- dsh-context`（放行该包所有版本）。理由不是它更"安全"，
  而是它**对「先命中者胜」是稳定且自愈的**：pnpm 之后再怎么往末尾追加，都不会再破。
  代价写在注释里：这个包不再享受 24h 发布冷静期（本 profile 的有意取舍）。

  **验过两件事**（不只是「改完绿了」）：
  ① 真 profile 上 `pnpm install --lockfile-only` PASS；
  ② **模拟 pnpm 再次追加**同类条目后再跑，仍然 PASS（这正是上一版缺的性质）。

  同时把客户端 `err.supply-chain.next` 的建议改对了：原来教「写一条版本并集」，
  现改为**明确说明并集只能生效一次、并教裸包名**，并加断言**禁止再出现并集写法**
  （`assert.equal(/dsh-context@0\.64\.0 \|\| 0\.65\.0/.test(...), false)`）。

  **教训**：修一个「方向性」bug 时，要问的不只是「现在好了吗」，还有
  **「谁会在什么时候把它再弄坏」**。这次的破坏者是 pnpm 自己的追加行为——
  它就在同一个文件里、每次升级都会发生。

- **热开关：证伪 + 一个真缺陷**（第六轮；用户要求「完成文档里面的热开关」）。

  **结论：热开关不用做——宿主本来就会热应用。** ROADMAP §3.3 把它列成待做的大件，
  理由是「现在完全依赖宿主 `setBundleEnabled`；热开关能免重启」，**这个前提是错的**。

  实测（新增 `verify/repro-hot-toggle.ps1` → `verify/probe-toggle-hot.mjs`，跑在 scratch
  profile 上，不碰用户的 desktop profile）：

  ```
  POST /plugin-market/toggle  {"name":"@feiyang666/dsh-usage-plugin","enabled":false}
  → 200 {"ok":true,"changed":true,"application":"applied","enabled":false,"error":null,"warnings":[]}
  ```

  `application:"applied"` = **已经热生效，没有重启**。机制取自宿主源码：`setPluginEnabled`
  自己就 `writePluginEnabled(this.profile.patchPath, …)` 写 patch 文件，紧接着 `reload()` →
  `reconcileProfilePatches(...)`；而 `dsh-base` 的 bundle 常驻加载
  `- id: hmr / name: '@deepseek-ai/dsh-hmr'`，本 profile 的 HMR 在场。佐证：用户的
  `cordis.patch.yml` 里本来就有宿主写过的开关行（`- id: whale-mode / disabled: false`）。

  所以自己写 `cordis.patch.yml` **既多余又有害**：违反写下来的安全不变量
  （`PLUGIN-MARKET.md §5`「host 半只做 GET 目录与调用宿主服务，**不写任何文件**」），
  还得抄参考实现约 45 条受保护模块正则（写错一条就可能把 boot 链自己关掉）。
  **调用者不该绕过被调用者去改它的文件。**

  **顺带查出一个真缺陷（已修，TDD）**：`toggleNotice` 只认 `cancelled` / `changed`，
  对宿主另外两种**可达**结果都回绿色「已启用 {name}」：

  | 宿主回 | 修复前 | 真相 |
  |---|---|---|
  | `applied` | 「已启用 X」✅ | 对 |
  | `restart-required` | 「已启用 X」绿色 ❌ | 还没生效（无 HMR 的 profile） |
  | `overridden` | 「已启用 X」绿色 ❌ | 被覆盖层压住，**状态没变** |

  `overridden` 由宿主 `setPluginEnabled` 显式 return（`index.js:1658`），不是假想分支。
  修法：补两条分支（warn +「重启 DSH 后生效」/「被覆盖层压住，实际没有启用」），并把
  `!changed` 与 `noticeFromResult` 统一到同一条排除规则。`applied` 语义**有意**与安装路径不同：
  安装问「包装上了吗」（`true`），开关问「状态真的切过去了吗」（`false`）。

  **验证**：门禁 PASS（**18 套件**；client-errorcopy **22→25**，3 条新断言先跑到红再修）；
  真实浏览器 e2e **83/83**。

  **这一轮的教训**：**「文档说缺什么」不等于「真的缺」**。这条 if 从写下到被当任务执行，
  中间隔了好几轮；真正推翻它的是一次**在 scratch profile 上真发出去的请求**，
  而不是再读一遍参考实现。同时它也暴露了同一个病的第二次发作——
  **用一条 happy path 的规则去覆盖一个有多分支的真实接口。**

- **修「有更新时按钮却还写『检查更新』」**（用户第四轮报：
  「有更新时检查更新状态机应该为一键更新」）。

  可更新页左边那颗按钮的主动作由 `checked && bundles.length > 0` 决定，也就是**先逼用户点一次
  「检查更新」**，它才肯变成「一键更新（N）」。但那一页打开时，列表已经把 N 个可更新插件
  逐条摆出来了、页签角标也写着 N——**信息早就到手了，按钮却让用户去「检查」一件刚刚
  已经确认的事**。真实复现（把 e2e 断言改成首屏即「一键更新（2）」后跑红）：

  ```
  ✗ 页头右侧首屏就是「一键更新（2）」与「插件市场更新（四态之一）」两个按钮
      实际：["检查更新","插件市场更新"]
  ```

  **改法**：主动作改由**数据**决定 —— `var canUpdateAll = bundles.length > 0;`。
  `checked` 保留，但只用于**没有更新时**区分「检查更新」还是「重新检查」（那个区分是有意义的：
  没检查过就不该谎称「已检查」，这条不放松）。

  先写会失败的断言 → 跑到红 → 再改代码 → 跑到绿（TDD），并把那条「先点检查更新再点一键更新」
  的旧断言改成「首屏无需任何点击就已是『一键更新（2）』」+「不再存在多余的『检查更新』按钮」。

  **验证**：门禁 PASS（**18 套件**）；真实浏览器 e2e **83/83**（净 +1）。
  变异测试 **2/2 CAUGHT**（改回 `checked && …` / 改成恒 `false`），还原后 sha256 逐字节一致；
  另把 e2e 的这条断言也做了变异（把代码改回旧写法 → e2e 转红），确认它真的承重。

- **修 2 处缺陷（1 条 HIGH）+ 一个真实环境故障的根因：用户报「dsh-mobile 更新失败」**
  （第五轮：从 `.plugin-manager/logs` 的真实失败日志倒推，逐条用 pnpm 复现，
  修前修后都跑了**变异测试**）。

  0. **「dsh-mobile 更新失败」的真根因不在插件里，在 profile 的 `pnpm-workspace.yaml`**——
     同时暴露了插件自身 1 处 HIGH 文案缺陷（见第 1 条）。

     **根因**：pnpm 11.7.0 把 `minimum-release-age` 的默认值设成 **1440 分钟（24 小时）**
     （`dist/pnpm.mjs:145910` `"minimum-release-age": 24 * 60`，注释写着 `// 1 day`）。
     lockfile 里只要有**一个**包是 24 小时内发布的，**整个 lockfile** 就校验失败并抛
     `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`——与 registry 通不通无关。
     用户的 profile 里 `dsh-context@0.65.0`（发布于故障前 19 小时）正卡在这个窗口内。

     **为什么「已经加过豁免」却还是失败**：profile 里写了
     `- dsh-context@0.64.0` 和 `- dsh-context@0.65.0` **两条同名规则**，而 pnpm 的
     `evaluateVersionPolicy`（`pnpm.mjs:64074`）是「**匹配到第一个同名规则就 `return`**」：
     ```js
     for (const { nameMatcher, exactVersions } of rules) {
       if (!nameMatcher(pkgName)) continue;
       if (exactVersions.length === 0) return true;   // 裸包名 = 全放行
       return exactVersions;                          // ← 只返回第一条，后面的被忽略
     }
     ```
     第一条只含 0.64.0 ⇒ **0.65.0 拿不到豁免** ⇒ 每次都失败。
     实测规律（各跑 2–3 次确认）：`0.64.0 + 0.65.0`（失败）/ `0.65.0 + 0.64.0`（**通过**）
     ——同样的两条内容，**只改顺序结果就不同**，正是「只认第一条」的直接证据。

     **修法**：把两条并成一条版本并集 `dsh-context@0.64.0 || 0.65.0`
     （`parseExactVersionsUnion` 支持 `||`）。**刻意不用裸包名 `dsh-context`**——
     那等于永久关掉这个包的发布冷静期保护，为修一次更新而拆掉一道供应链闸门不划算。
     已备份原文件为 `pnpm-workspace.yaml.bak-minage-*`，改后实测真实 `pnpm add dsh-mobile@0.6.1`
     **exit=0，dsh-mobile 0.5.5 → 0.6.1 落盘**。

     **顺带确认的一件事**：我第一次复现时看到「移除豁免反而通过」，差点据此写结论——
     核实后那是 **pnpm 把上一次的校验结果缓存了**（输出里的 `verified 8m ago`）。
     清掉 cache/store 重跑后 A/B 稳定复现。**缓存会让错误结论看起来可复现。**

  1. **「供应链策略拦下」被误报成「连不上 npm 源」，劝用户去配镜像**——HIGH。
     真实的失败日志同时含 `[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION]` **和**
     `GET https://registry.npmmirror.com/… error (UND_ERR_DESTROYED)`。后一行是**结果不是原因**
     （校验一失败 pnpm 就放弃下载），但网络正则会命中它 ⇒ 修复前 `errorCopy` 给出
     `title=连不上源 / next=配镜像`。**配镜像、换源都不可能修好**——这是「自信地指错方向」，
     比不说话更糟：用户会照做、浪费时间，然后更困惑。
     做法：新增 `supplyChainDetail()`（认 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` /
     `failed supply-chain polic` / `minimumReleaseAge cutoff`），优先级排为
     **供应链 > 占用 > 网络**（三处：`errorCopy` 的 prefix、`registryUnreachableDetail`
     的自让开、`shortFailureText`），并新增 zh/en 的 `err.supply-chain.{title,why,next,row}`，
     文案里**明确说了「这不是网络问题」+ 同一个包只能写一条规则**这个坑。
     用**真实日志原文**跑修复后的 `errorCopy` 验证：`err.supply-chain.*`。

  **验证**：门禁 PASS（**17 套件**；client-errorcopy **14→22**、client-copy **35→36**、
  error-classify 18→18）；真实浏览器 e2e **82/82**。
  新增断言全部过了**变异测试**（4/4 CAUGHT，还原后 sha256 逐字节一致）。
  其中一条 M2 一开始是 **MISSED**——删掉 `registryUnreachableDetail` 里的供应链自让开，
  整套测试依然全绿（两条调用路径都先判了供应链），说明那条断言当时**不承重**。
  要么删掉那段代码，要么补一条直接调用它的断言；我选了后者（纵深防御 + 让意图可验证）。

  **本轮记两条方法论**：
  1. **「预期 vs 实际」的差要一直追到机制层**：一开始怀疑是网络（日志末尾全是 UND_ERR），
     实测才定位到「同包名的第二条规则被 pnpm 忽略」。**看错误信息要分清哪些是被打印出来的原因、
     哪些只是被打印出来的后果。**
  2. **同一个包的过滤规则有顺序语义**——`minimumReleaseAgeExclude` 不是集合，是**有序规则表**。
     这类「看起来像集合、实际是短路的规则链」的配置，顺序就是一种隐性契约。

- **修 5 处缺陷，其中一条是「桌面版一键重启会把应用杀掉且不会有替代品起来」**（第四轮独立审计
  读 self-update / restart / http，我自己核对了壳内源码与活动进程表）。

  1. **桌面端一键重启是「删掉 `ELECTRON_RUN_AS_NODE` 后启动 GUI」**——HIGH。
     真实拓扑（活动进程表 + `app.asar/lib/main.js` 核实）：
     `7872 DeepSeek Harness.exe`（GUI 主进程，持 Electron 单实例锁）
     ← `19496 …exe --expose-internals <entry>`（宿主，7872 用 `stdio: […,'ipc']` 拉起的子进程，
     环境里带 `ELECTRON_RUN_AS_NODE=1`）。宿主半跑在 19496 里，助手拿到它的 `execPath`/`argv`、
     **删掉那个变量**再拉起同一个 exe —— 那是**启动 GUI**：新进程执行
     `claimDesktopSingleInstance()` → `requestSingleInstanceLock()` 失败（7872 还持锁）→ 立刻
     `application.quit()`（实测 exit=0、无输出、231–391ms）。于是宿主已退出、替代品也死了，
     **整个应用什么都不剩**，壳随后弹「DeepSeek Harness 无法使用」。
     这不是某个变量写错——参考实现（`_ref/dsh-market/src/restart.ts` 的
     `restartAllowed`/`detectedSupervisor`）对同类问题的结论一样：**有监管者的部署里，
     「重启」不属于这个插件**（systemd 下会连助手一起被杀，桌面壳下会被锁挡在门外）。
     所以**如实拒绝而不是半修**：`isDesktopManagedHost()`（node 模式 **且** 有 IPC 通道两个信号，
     避免误伤终端 `dsh web` 的宿主）→ `spawnRestartHelper` 拒绝、`POST /restart` 回
     `409 restart-unsupported`、`/status` 带 `restart.available:false`，客户端据此
     **不弹重启询问窗、显示「请关掉窗口再打开」而不是一个点了会出事的按钮**。
  2. **自更新失败丢字段，一律报成「插件市场内部出错了」**——MEDIUM。宿主把可读细节放在
     `diagnostic`、常常没有 `message`；`apply()` 只抄 code+message，于是 message 变空串、
     diagnostic 丢掉、顶层也没有 code，`index.js` 的 `result.code ?? 'internal'` 就把
     「文件被占用 / 连不上源」说成「内部出错，稍后重试」。同一类失败走安装端点时字段是齐的
     （`projectChangeError` 会透传 code+diagnostic），自更新是唯一丢字段的路。两个字段都透传，
     并补顶层 `code`。
  3. **`apply()` 的 ok 规则与 `sendChangeResult` 漂移**——MEDIUM。契约 §18/§20 要求三处完全一致：
     补上 `pendingBuilds` 非空放行（并把 `pendingBuilds` 透传出去，客户端才可能显示批准入口），
     以及**空结果不算 applied**（`{}` 以前会得到 `applied`/`ok:true` → 客户端亮绿灯，
     而宿主从没确认过这次安装；`index.js` 对同样输入判失败）。
  4. **`managerOf` 抛错会冒出 `apply()`**——LOW。安装抛错是被正确折叠的（`install-failed`），
     读 manager 抛错却直接冒成 500 `internal`——同一类失败两种形状。折成 `manager-unavailable`。
  5. 客户端补 `err.restart-unsupported.*`、`restart.manualBody`、`restart-available` 判定；
     `/status` 新增 `restart.available`。

  **验证**：门禁 PASS（17 套件；self-update 46→**50**、restart-helper 8→**10**）；
  真实浏览器 e2e **82/82**。

  **本轮记一条方法论**：审计 F1 的第一版**假设是错的**（它以为 bug 是「删掉变量导致 node 启动失败」），
  是它自己用隔离实验证伪后才改成「单实例锁」——而**这个改口正是关键**：如果按第一版假设去修
  （保留 `ELECTRON_RUN_AS_NODE`），桌面端会变成「以 node 模式再起一个宿主」，
  同样起不来。**结论对而机制错，修法就会错。**

  **本次不递增版本、不打包、不发布。**

- **修 4 个稳健性缺陷 + 3 个客户端缺陷，其中一条把上一轮的修复整个抵消了**（第二轮独立审计：
  3 个并行只读审计分别读 catalog / self-update+restart / client 数据层与渲染层，
  我自己读 host 路由与 `http.js`）。**每条都先用真函数复现、再改、再做变异测试**
  （变异 4/4 + 2/2 全捕获，每次按字节还原；两个新套件共 23 条断言）。

  1. **`errorCopy` 把「连不上 npm 源」的专属解释覆盖回宿主的通用句**——**这一条把上一轮
     `76110d9` 的修复整个抵消掉了**，是这轮最该记住的一条。命中 `registry-unreachable` 之后，
     末尾那句 `if (!locked && !known && message) copy.why = message` 仍然生效：宿主把 pnpm
     非 0 退出归成 `operation-error`，而它**不在** `ERROR_PREFIXES` 里 → `known=false` →
     why 被写成「宿主执行这个操作时报错。」。于是用户看到标题和「下一步」都在说「去配镜像」，
     **唯独「为什么」那一句退回了无效信息**。条件补上 `unreachable === ""`。
     用真 `errorCopy` 实测：修前 `why=宿主执行这个操作时报错。`，修后是网络专属解释。
     **为什么上一轮没测出来**：`error-classify.test.mjs` 只**直接调用**两个 detail 函数、
     用正则断言 `message:` 那一行；而 `errorCopy`（真正决定用户看到哪段文案的函数）
     在 `verify/` 里**从未被执行过**。
  2. **`validateCatalogPayload` 的核对只挡正数**：`if (declared > 0 && actual === 0)` 对
     `{count:-1, plugins:[]}`、`{count:1.5, plugins:[{}]}` 全部放行（前者 `declared > 0`
     不成立，后者的差值落在 5 条容差内）。后果正是这条校验存在的理由：以
     `stale:false, error:null` **覆盖掉好缓存** → 市场变空、分类消失、连过期横幅都不显示。
     改为先要求 `Number.isInteger(count) && count >= 0`（合法的 `count:0` 空目录仍放行）。
     实测：好目录 count=2 → 喂坏数据后 count=0；修后坏数据被拒。
  3. **`readJsonBody` 没有读取超时**：只有 `end`/`error` 两个出口，客户端声明
     `Content-Length: 100`、只发 10 字节后**保持连接不动**时 Promise 永不 settle，
     handler 与 socket 一起无限期挂着（宿主默认 `requestTimeout` 300s 也只是把「永远」
     变成「五分钟」）。加 10 秒上限（可注入便于测试），到点按 `bad-request` 明确回错。
  4. **`gunzipSync` 无输出上限（解压炸弹）**：tarball 的 `dist.integrity` 来自**同一份元数据**，
     挡不住「自洽地声明 255 KiB 压缩 / 256 MB 解压」的炸弹，而解压**同步**跑在宿主事件循环上，
     再大就 OOM 掉整个 DSH。加 `maxOutputLength: 8 MB`（正常目录 tarball 只有几十 KB）。
  5. **孤立代理项让整个市场面板崩掉**：剪贴板里被上游截断的半个 emoji（`"abc\uD83D"`）会让
     `encodeURIComponent` 抛 `URIError: URI malformed`，抛点在 catalog `useEffect` 里、
     **没有 try/catch**，bundle 也没有 error boundary → React 卸载整棵子树：用户只是粘贴了
     一下，市场页就空白了。URL 构建前把孤立代理项换成 U+FFFD（成对 emoji 不动）。
  6. **两条开关路径只看有没有 `error`**：宿主的 `/toggle` 让 `{application:'cancelled'}`
     （不带 error）与 `changed:false` **正常 resolve**，于是「宿主说什么都没改」照样报绿色
     「已启用」；带 error 的 cancelled 还会渲染成「红壳 + 成功文案」。改为统一的
     `toggleNotice()`，与安装/卸载的 `noticeFromResult` 同一套语义。
  7. **`readOnlyReason.not-removable` 在两张表里都没文案**：宿主的 `READ_ONLY_CODES` 有三个码，
     客户端只有两个。查不到文案时 `hostReason === hostReasonKey` 会把「没有文案」当成
     「没有原因」→ **开关被误解锁**（宿主其实会 400 拒绝）。补齐 zh/en。
  8. **`onDone` 被顶替的请求吞掉**：`startRequest` 会 abort 同 key 的上一个请求，而 abort 路径
     在 `isCurrent` 处就 return、**永远走不到 `onDone`**。于是「点检查更新 → 紧接着点可更新
     页签」会让按钮永远停在「检查更新」，而 toast 已经说了有几个新版本。改为把回调挂在 ref 上、
     由最终完成的那次请求消费一次（失败时丢弃，免得被下一次无关的成功消费）。
  9. **CSS 层叠把骨架屏的 shimmer 覆盖掉**：`.dshpm-updateRow--ghost` 与 `.dshpm-updateRow`
     都是单类选择器（特异性相同），靠后的赢 → 加载占位播的是 `.26s` 一次性淡入而不是无限扫光。
     用双类选择器（0,2,0）钉死。另删一处**可证明不可达**的死条件
     （`retrying: state.phase === "loading"` 写在 `phase === "error"` 分支里，恒为 false）。

  **新增两个门禁套件**（这些模块此前在 `verify/` 里一条断言都没有）：
  `verify/robustness.test.mjs`（**9 条**）与 `verify/client-errorcopy.test.mjs`（**14 条**）。
  门禁 15 → **17 套件**；真实浏览器 e2e **82/82**。

  **顺带记两条我自己的错**（都留了痕）：① 我把反引号写进 CSS 注释，而那整段 CSS 是 JS 的
  模板字面量——直接把 `client.js` 的语法打断（靠 `node --check` 立刻抓到）；② 变异测试脚本
  被 kill 时**把变异留在磁盘上**（`http.js` 里留了个 `if (false)`），而我的「还原校验」拿的
  正是已被污染的内容当基准，**自己认证自己通过**。后续版本改为：先跑**基线**、基线不通过就
  拒绝继续；用 `try/finally` 保证还原；结束后**复跑基线**确认回到干净状态。

  **本次不递增版本、不打包、不发布。**

- **修「更新已装插件后激活状态被误判成 unknown」**：`verifyActivation` 的候选名没去重，
  同一个字符串出现多次被当成「多个候选都命中」→ 一律报 `ambiguous-bundle`。
  真实链路：客户端「更新」发的是 `submitInstall({ name: bundle.name, spec: bundle.name })`，
  而宿主 `install()` 传的候选是 `[hit?.npm, hit?.name, hit?.id, requestedSpec, requestedName]`
  ——npm / name / requestedSpec / requestedName 本来就是同一个值（`dsh-kaomoji`、
  `@anonyjcy/dsh-j-space` 这类全都如此）。更新一个**已装**插件时 `before` 里已经有它、
  `appeared` 为空，于是走到 `present` 分支，而那里数的是**出现次数**而不是**不同名字的个数**。
  **影响面用真实目录（4412 条）量过：2288 个有 npm 的条目 100% 命中**，修完 0%。
  两个用户可见后果：① 一次成功的更新被渲染成「已安装 {name}，但这次没能回读装载状态，
  无法确认它是否已经在跑」（`notice.installUnknown`，蓝色 info）而不是绿色的
  「已安装 {name}，并已在运行」；② 更严重的是 `versionMatches=false` 那条**「磁盘上还是旧版、
  更新其实没落地」的告警被这次误报盖掉**——因为走不到 `hit` 分支就根本不会算版本，
  用户会以为更新成功了。修法是候选名先 `new Set()` 去重，`present.length` 才代表不同名字的个数。
  回归：`verify/host-contract.test.mjs` 新增一条断言（真调 `verifyActivation`，把真实调用点的
  候选形状写进去），并带**反向断言**——两个**不同**名字各自命中一个 bundle 时仍然必须报歧义
  （去重不能把真歧义一起抹掉）。**变异测试 2/2 全捕获**（改回不去重 / 只留第一个候选，
  两个方向都被抓到），变异后按字节还原、sha256 一致。
  这一条此前测不出来，是因为既有的 7 条相关断言**全都只传单个候选名**，从不传重复项。
  **本次不递增版本、不打包、不发布。**

- **修「构建脚本待批准」这条路径：批准入口此前是不可达的死代码**（用户报「还是安装不了」）。
  这是**插件自身的 bug**，也是这轮排查真正的根因。
  真实链路：装 `@linxin666/dsh-remote-web-ui` 时，它的依赖 `cloudflared` 有 `postinstall`
  （下载二进制），而 pnpm 11 **默认忽略**未批准的构建脚本、并以**非零**退出。宿主把这次
  `installBundle` 折成 `{ application:'failed', error, pendingBuilds:['cloudflared'] }`
  ——含义是「没装成，但只差你批准一下」，**不是**失败到底。
  **Bug**：`sendChangeResult` 把 `application:'failed'` 一律报 `ok:false`，而客户端
  `requestJSON` 在 `ok !== true` 时**直接抛错**——于是客户端那段「读 `payload.pendingBuilds`
  弹批准框」成了**永远不可达的死代码**：用户只看到一条普通错误，**没有任何批准入口**，
  装多少次都装不上。修法是一行：`pendingBuilds` 非空时放行 `ok:true`（`cancelled` 的既有
  放行语义不变），并顺带把 `pendingBuilds` 的过滤提到变量里复用。
  **怎么定位的（值得记）**：先否掉了「pnpm / 镜像 / 包坏了」三个嫌疑——在 profile 目录手动跑
  宿主的原命令 `pnpm add`,**装成功了**；再用宿主自己的 CLI 跑同一条 `pluginManager` 代码，
  **也失败**，且失败点明确指向 `[ERR_PNPM_IGNORED_BUILDS]`。于是问题定位到插件处理这条
  结果的路径，而不是环境。
  回归：新增门禁套件 `verify/build-approval.test.mjs`（**9 条**）——把真
  `sendChangeResult` 抠出来**真调并读它发出的响应体**（不是源码形状断言）；
  真实浏览器 e2e 78 → **82 条**，其中 [10] 直接断言「批准确认条出现过、点了名 cloudflared、
  有『允许并安装』按钮、toast 指路」。**变异测试 4/4 全捕获**（回到旧规则 /
  无条件放行 / 不透传 pendingBuilds / 不过滤脏数据），变异后按字节还原。
  **本次不递增版本、不打包、不发布。**

- **安装失败不再只说「看宿主日志」：连不上 npm 源时直接告诉你配镜像**（用户报「我在插件市场
  装了俩个插件都没能成功 你排除一下问题」）。排查用户真实 profile 的 pnpm 日志发现，**两个
  失败是两种完全不同的原因**：① `@linxin666/dsh-remote-web-ui` 是 `ERR_PNPM_EPERM`——报错
  目录甚至是**另一个插件**（`dsh-our-free-model`），运行中的 DSH 持有它的句柄，pnpm `scandir`
  被拒、整个事务回滚（这类错误市场本来就认得对）；② `dsh-mobile` 是**连不上 npm 源**——日志里
  几十条 `ECONNRESET`、`Request took 72331ms`，34 次请求**全是 registry.npmjs.org、0 次镜像**，
  而本机实测 npmjs.org 15s 超时、npmmirror 366ms。
  **这里暴露了插件自身的一个盲区**：抓目录走镜像，但真正安装交给宿主 pnpm、用 pnpm 自己的
  registry——两条通道不同，于是「能浏览、能点安装、一下载就失败」成了最难解释的现象，而界面
  只写「宿主执行这个操作时报错。看宿主日志里的 pnpm 输出」，用户不可能从中推断出「去配镜像」。
  本次只改**错误呈现**，不动任何安装行为：
  1. 新增 `registryUnreachableDetail`：只认**具体**网络签名（`ECONNRESET`/`ETIMEDOUT`/`UND_ERR`/
     `Request took Nms`/`ERR_PNPM_FETCH*` 等）——刻意**不**把裸词 `network`/`registry` 放进匹配集，
     否则「版本不兼容」「包不存在」也会被改写文案，那是换一种撒谎。
  2. 命中时切到 `err.registry-unreachable.*`，给出可照做的下一步：在该 profile 目录建 `.npmrc`
     写 `registry=https://registry.npmmirror.com`，完全退出 DSH 后重试。**这条建议是核实过的**：
     从 asar 抽出 `dsh-plugin-manager` 确认 pnpm 的 `cwd` 就是 profile 目录、且 `extendEnv: false`
     （env 被清洗），所以 profile 下的 `.npmrc` 确实会被读到。
  3. **占用优先于网络**（诊断里可能混着 registry 字样）；两处行内短句原本各写一遍同样的三元
     表达式，抽成共用 `shortFailureText`——否则又是一次「两处规则漂移」（本仓库栽过）。
  4. 详情行现在也露出网络诊断原文，此前只显示宿主的通用句。
  回归：新增门禁套件 `verify/error-classify.test.mjs`（**18 条**）——把真 bundle 里的识别函数
  **取出来执行**，喂**从用户那份真实 pnpm 日志逐字抄下的原文**，并显式覆盖「不许误伤」；
  **变异测试 6/6 全捕获**，变异后按字节还原。**变异纠正了我一次**：第一版「行内短句不报镜像」
  没被捕获——暴露的是我的测试漏了 `shortFailureText`，补上后 6/6。
  **本次不递增版本、不打包、不发布。**

- **修 6 个真实缺陷：最严重的一条会把别人的插件标成「已安装 / 可更新」**（独立审计发现，
  我逐条独立复现）。这一轮先说结论：`buildMatchIndex` 的 `putBareName` 用**原始** repo 名当
  `nameKeys` 的键，而查表一律走 `lookupKey`（会小写化）。真实目录 4412 条里有 **88 个**仓库名
  含大写字母：实测 **0 个命中自己、5 个标到了另一个 owner 的同名小写仓库**——
  `bill277048-hash/DSH-model-router` 被标成 `superboy911/dsh-model-router` 已安装。
  这正是该文件注释里明令禁止的「宁可不显示，也不能指错人」：注释写对了，代码没做到。
  一行修复后命中自己 **0 → 82**、标错 **5 → 3**；剩下 6 条我逐条查清才收尾——
  3 条是目录里真有同名 npm 包（npm 名优先是设计），3 条是不同 owner 的小写裸名真撞车、
  修好后正确判为**歧义不猜**（仍比修复前「猜错到别人头上」正确）。
  其余 5 条：
  1. **失败的自更新被渲染成绿色「更新成功」**：`self-update.js` 的 `ok` 只看 `value.error`，
     而宿主 ChangeResult 的 `error` 是**可选**的，`{application:'failed'}` 不带 error 时算出
     `ok:true` → HTTP 200 → 客户端亮绿色「更新到 vX」。`sendChangeResult` 早把规则写清楚了，
     **两处规则漂移**；`/toggle` 也有一份同样漂移。三处统一成同一条规则。
  2. **并发 `ensure()` 每个等待者各自归一化一遍**：`inflight` 只共享了网络，`normalizeCatalog`
     仍被每个等待者各跑一次（约 2.5ms）并各造一份新 `plugins` 数组——这会让按数组身份的索引
     缓存**逐个被击破**，等于白做。改成只让第一个等待者归一化。
  3. **发现页的「重试」是个死键**：`onRetry` 误接 `bumpTick()`（只动 `installedTick`），
     而目录 effect 依赖 `catalogTick` → 目录加载失败后点「重试」**一个 `/catalog` 请求都不发**，
     报错框永远留在屏幕上（用户唯一的自救路径失效）。
  4. **退场计时器吞掉新回执**：200ms 退场窗口内来的新回执被旧计时器一起 `setNotice(null)`，
     本该活 4600ms 的气泡 200ms 就没了（注释宣称覆盖了，实际 cleanup 只在卸载时跑）。
  5. **英文表两颗黑按钮文案相同**：`action.recheckSelf` 与 `action.recheckSelfOnly` 都是
     `"Check again"`，而它们自己上方的注释写着「必须不同」，中文表是区分的——门禁只断言了
     中文，**漏掉一种语言就漏掉一种语言**。
  回归：`catalog-search-cache` **15 条**、`client-copy` **34 条**、`self-update` **45 条**；
  **变异测试 7/7 全捕获**（host 3 + client 4），变异后按字节还原。
  **本次不递增版本、不打包、不发布。**

- **搜索提速：单次目录请求 53ms → 8ms**（用户要求「审查并优化 代码质量和性能」）。
  审查先量后改，量完**否掉了两个自己的假设**，避免照着假问题改代码：
  1. 否掉「`entriesForBundle` 是 O(B×P) 热点」——实测真实场景 0.039ms、夸张到 300×600 也
     只有 2.1ms，**不改**；
  2. 否掉「不稳定 props 打穿 `React.memo` 记忆化」——`client.js` 里 `React.memo`/`useMemo`/
     `useCallback` 出现 **0 次**，没有记忆化可打穿，**不改**。
  **真正的热点只有一处**：`/catalog` 每次请求都把整份目录重做一遍搜索归一化。真实快照
  （4412 条）实测一次请求折叠 30884 个字符串 = **33ms 同步 CPU**（`NFKD` 8.5ms +
  `\p{M}+` 去组合符 **24ms** + `toLowerCase` 4.4ms），同一次请求 `buildMatchIndex` 再花
  **12ms**。这些全在**宿主的事件循环**上，而它同时还在跑流式输出。
  1. `foldText` 按**字符串内容**记忆化（上界 65536，满了整体清空）。**不是**键在条目对象上的
     `WeakMap`：`joinInstalled` 每次请求都用 `{...item}` 造新对象，那种缓存永远命中不了——
     这一点是量出来才没有写错。
  2. `buildMatchIndex` 按**数组身份**记忆化（只留最新一份）。快照数组是不可变引用，
     身份相同 → 索引必然相同；「刷新目录必须换索引」由身份天然保证。
  3. 首帧冷启动不变（~75ms，必然要建一次），这是诚实的代价：快的是一词搜第二次、翻页、
     改排序、切分类。
  回归：新增门禁套件 `verify/catalog-search-cache.test.mjs`（**11 条**，门禁现共 **13 套**），
  并做**变异测试 4/4 全捕获**（索引不随数组失效 / 用数组长度当键 / 用字符串长度当键 /
  查询侧不归一化），变异后按字节还原。缓存是「写错了也照样跑」的东西：结果依旧正确、
  测试依旧全绿，只在特定条件下静静给错答案，所以必须用变异证明断言有牙。
  顺带修正自己一处**失实注释**（原写「每敲一个字就发一次 /catalog」，实为 300ms 防抖）。
  **本次不递增版本、不打包、不发布。**

- **装完主动问「立即重启 / 稍后重启」：不用再自己去横幅找那颗按钮**（用户要求：「安装完插件要
  手动重启这很麻烦，设置一个弹窗可以选择立即重启 or 稍后重启」）。
  以前装完只在页面顶部亮一条「有改动待重启」横幅，用户得自己注意到、再找到那颗按钮，而且没人
  告诉他**为什么**要重启。现在装完（或更新完）弹一次询问窗，正文说清是哪些插件、为什么要重启。
  1. **默认是「稍后重启」，焦点也落在它上面**：重启会截断正在流式输出的回复，破坏性动作不能
     做默认项。`Esc` 与点遮罩都等同「稍后重启」——注意这**不是「取消安装」**，东西已经装好了，
     绝不回滚。
  2. **批量只问一次**（这是这个功能最容易做坏的地方）：`noteRestartFrom` 有 5 个调用点
     （安装 / 更新 / 卸载 / 开关 / 自更新），其中安装那一条是安装、更新、一键更新共用的。
     如果每次都弹，「一键更新（N）」就会**弹 N 次**。所以批量里的每一步只记账（`defer:true`），
     由批量收尾统一问一次；由 e2e 用真实浏览器盯着「批量进行中弹窗数必须为 0」。
  3. **问过的名字不再重复问**：用户选了「稍后重启」之后再装同一个包不会被反复打扰（横幅还在，
     随时能重启）；但**后来又装了别的东西**时会再问一次——「新名字才问」而不是「问过就永远不问」。
  4. **重启失败会关掉弹窗**：否则它会永远停在「正在重启」，而重启根本没发生。失败仍走原有的
     错误回执 + 横幅可重试。
  5. **弹窗挂成 `.dshpm-root` 的兄弟节点**（Fragment），不做它的子项：`root` 的直接子项被 e2e 的
     几何断言盯着（「任何直接子项都不得被压扁」），而这个 fixed 覆盖层天然在 root 之上。
     连带地，`prefers-reduced-motion` 那条规则**必须单独把 `.dshpm-modalLayer` 列进去**——
     它不在 `.dshpm-root` 里，靠 `.dshpm-root *` 覆盖不到（漏了就是「关掉动效后弹窗还带入场动画」）。
  6. 弹窗有 `role="dialog"` + `aria-modal` + 可读标题。
  回归：`client-copy.test.mjs` 31→**32 条**；真实浏览器 e2e 67→**78 条**——新增的 11 条里有 6 条是
  这一轮特意补的：**用 `elementFromPoint` 做真实命中测试**（JS `.click()` 会绕过命中测试，
  覆盖层就算把按钮盖住也照样「成功」，那种断言等于没测）、批量进行中弹窗数为 0、只弹一次、
  弹窗内部几何不重叠、完整落在视口内、Esc 关掉后横幅仍在。
  **本次不递增版本、不打包、不发布。**

- **装后激活校验 + 版本回读：让「装」和「更新」不再说谎**（用户要求「先做 2」——来自
  `docs/ROADMAP.md` 的功能方向研究第二项）。
  以前 `POST /install` 把宿主的 `application` **原样透传**就完事了，而 `application` 说的是
  宿主**执行**了什么，不是**结果**。于是 `applied` 完全可能对应「写进了 `node_modules`，但
  profile 的 bundle 列表里从来没有它」——界面渲染绿色「已安装」，插件却永远不出现；更新时
  目录说 `0.63.0`、磁盘上还是 `0.62.3`，界面照样写「已更新」。
  1. **新增 `activation` 字段**（仅 install 路由，可选、缺省时不出现，老客户端不受影响）：
     `{ state, expected, installed, enabled, versionMatches, reasons }`，`state` ∈
     `live | restart | inert | broken | disabled | unknown`。判定手段是**前后差集**而不是猜名字：
     `installBundle` 之前记一份 bundle 名字表、之后再记一份，新出现的那个就是这次装上的——
     所以不假设「包名 == bundle 名」（两者并不总相等）。候选名只在「没有新名字出现」时用于
     区分「更新了已有条目」与「什么都没落地」。
  2. **`restart-required` 优先于 `live`**：宿主的原话就是还没生效，不因为条目在列表里就改口。
     **`inert` / `broken` 不算成功**（客户端 `applied:false`）——它们会进「一键更新」的成功计数，
     谎报成功比不说更糟。
  3. **版本回读**：`expected` 取自**目录**（用户点的就是那个版本）、`installed` 是回读到的真实版本；
     对不上时 `versionMatches:false`，客户端换一句「实际是 v{installed}（目录里写的是 v{expected}）」。
  4. **`unknown` 是一等结果，不是兜底**：读不回列表、没有基线且列表里也找不到它、一次多出多个
     bundle 分不清——都不猜，并带上 `reasons` 说明为什么不知道。特别地，**`no-baseline` 与 `live`
     可以并存**：认不出「谁装上的」，但认得出「它在列表里」，后者才是 `live/inert` 的判据；
     把已知的「它在跑」降级成 `unknown` 是另一种不诚实。
  5. **不该谈激活的时刻不给状态**：`application` 是 `failed`/`cancelled`/`overridden`，或
     `pendingBuilds` 非空（还在等用户批准构建脚本——回读必然「没落地」，不看得 `pending` 就会把
     「等批准」说成插件有问题）。
  6. **客户端文案分六路**：`已安装并已在运行` / `实际是 v…（目录写的是 v…）` / `没出现在装载列表里
     （可能不是 bundle）` / `宿主报告装载失败` / `装上了但处于停用` / `没能回读装载状态`。
     `changed === false`（宿主说这次什么都没改）时**保留**「没有产生变更」——那句本身是重要信息，
     用「并已在运行」盖掉就等于把「你的更新其实没落地」瞒下来；唯一例外是版本对不上时必须盖。
  回归：`host-contract.test.mjs` 18→**27 条**（第 9 组真调 `verifyActivation` 的 8 条 + 1 条源码形状），
  `client-copy.test.mjs` 30→**31 条**。**这 8 处语义逐个做过变异测试**（把每处语义破坏一次，
  对应断言必须失败）：**8/8 全被抓到**——「测试通过」本身被验证过，不是写了就算。
  契约见 [API-CONTRACT §2.4](../docs/API-CONTRACT.md)；方向研究见 [ROADMAP](../docs/ROADMAP.md)。

## 1.1.6

- **核心逻辑审计修复：身份匹配、内容校验、错误归类三类真实缺陷**（用户要求「检查核心代码
  是否有逻辑错误」并按「现代应用市场的逻辑」修复）：三份独立审计（catalog / self-update+http /
  host 路由）共报 26 条，我逐条在真实 4412 条目录快照上复核——**复核否掉了 3 条**（排序并列组
  数量统计错误、搜索「跨字段命中换行」未复现、`page>pages` 属契约允许），**其余按严重度修掉**：
  1. **目录身份层（会装错包，最高优先）**：`matchBundle` 曾在 npm 名未命中时**把 scope 剥掉再查**，
     而目录里 1431/4412 条是「无 scope 且 `npm === name`」——装任意一个**目录里没有**的
     `@随便/<name>` 就会被认成那个条目（假「已安装/可更新」），点更新时 `pinnedNpmSpec` 还会把
     spec 钉成别人的包名，**真的装成另一个包**。现在按可信度分层匹配（npm 名 → 仓库名 →
     `@owner/仓库名`），**取消去 scope 兜底**。
     `repoTail` 也修了：它声称「剥掉 /tree/… 的尾巴」实际只取 URL 最后一段，于是
     `…/owner/repo/tree/main/adapters/dsh` 的身份键变成通用词 `dsh`（实测 471 条含 `/tree/`、
     435 条尾段不等于仓库名、181 条 bogus 键真被用上，`dsh` 这一个键被两个仓库争抢）。
     `buildMatchIndex` 同时收 `repo` / `owner/repo` / `@owner/repo`，**一个键落到两个不同条目时
     标记歧义、不再匹配**（原来是「先到先得」，哪条被标成已安装纯看文件顺序）。
  2. **内容闸门（市场可能被静默清空）**：`validateCatalogPayload` 只查类型，于是
     `{count:4412, plugins:[]}`（源站故障/截断）会被判为合法并以 `stale:false` 覆盖好缓存——
     市场整个变空、分类 chips 消失，而且因为不是 stale 连「缓存可能过期」横幅都不显示，
     看起来像「真的一共 0 个插件」。现在交叉核对 `plugins.length` 与 `count`（1% 容差）。
  3. **主用 npm 源静默失效**：npm 路径 `JSON.parse(file.toString('utf8'))` 不剥 BOM，而 URL 路径走
     `response.text()` 会被 fetch 规范自动剥掉——包内 `plugins.json` 带 BOM（本仓库自己就有
     `ps-bom.test.mjs`）时**每个请求都失败**，静默退化到下一个 registry 再到 30s 的官方 URL。
     现在 `trimStart()`。同时 `dist.integrity` 由「有则校验」改为**必填**：元数据本身也来自网络，
     只信「元数据说没问题」等于没校验，缺字段即整源失败（与文件头声明的信任模型一致）。
  4. **搜索**：`url` 曾在搜索 haystack 里，于是搜 `github` **命中全部 4412 条**（几乎每条都有
     github 地址），用户以为搜到了什么其实全量；字段间用 `\n` 连接还导致跨字段子串命中。
     现在只搜 UI 承诺的字段（名字/作者/描述/能力），多词是「与」语义并按字段匹配；另加
     NFKD 去变音符号（`jose` 能搜到 `José`，实测目录里 25 条描述带重音）。
  5. **分页与排序**：`paginate` 在 `page` 超出末页时**收敛到末页**（原返回 `page=5/pages=2/items=[]`，
     界面显示「第 5/2 页」+ 空网格且不会自愈——客户端只在改搜索条件时重置页码）；`sortPlugins`
     追加 `id` 兜底键保证**全序**（真实数据有 171 组完全并列，原来是「谁先来谁在前」，
     刷新源顺序就会换页位）。
  6. **host 契约**：`sendError` 曾静默丢掉 `overrides.diagnostic`——契约 §2.8 的字段**永远不会出现**，
     而客户端靠它对 EPERM/EACCES/EBUSY 给出「文件被占用」的可操作提示；`sendChangeResult` 的
     `ok` 只看 `error`，于是宿主 `application:'failed'`（`error` 是可选的）被报成 `ok:true`，
     客户端渲染绿色「已安装」并计为成功（`cancelled` 保持 `ok:true`，否则客户端会抛错丢掉「已取消」文案）；
      重名插件安装由「第一个匹配就装」改为**报歧义**（真实目录 195 个重名，`dsh-memory` 对应
      10 条 5 个不同 spec——用户在装别人的包）；`MANAGEMENT_MESSAGE/HINT` 改 `Map`
     （对象字面量 + `__proto__` 这类键会拿到 `Object.prototype` 的值，而契约要求 message 是字符串）。
  7. **重启链路**：`restart` 端点改为**先安排退出、再写响应**（原顺序在响应写失败时——客户端切走/
     代理断开——异常被外层吞掉，退出永不安排，而 `restart.js` 已置 `requested`，之后每次点击都回
     `already:true` 并跳过安排 → **「重启 DSH」永久失效**）；`restart.js` 把 `child.on('error')`
     提到 `pid<=0` 那条提早 return **之前**（spawn 的 ENOENT 是异步事件，未处理的 `'error'`
     会直接终止宿主进程，用户看到 500 之后进程就没了），并在该路径顺手 `unref`。
  8. **自更新通道（两条「谎称已是最新」）**：`isNewer` 曾把 `compareVersions` 的 `null` 折叠成
     `false`，于是本机是**合法 npm 预发布号**（`1.1.5-rc.1`）时 `apply()` 回
     `{ok:true, application:'up-to-date'}`、界面显示「已是最新」——正是文件注释里禁止的「猜」，
     现在 `isNewer` 返回 `true|false|null`、`check()` 对不可解析的本机版本如实报通道不可用；
     另一个源**知道**有更高版本却拿不到清单（附件缺 digest → 回落到 v1.1.6 起已下线的
     `releases/index.json`）时，原先那份更旧的候选会把结果盖成「已是最新」，现在这类
     「知道有新版但验不了」让整次检查失败并说清是哪个版本。另：标签名过 `isUsableTag`
     校验（孤立代理项能通过 `\S+` 却让 `encodeURIComponent` 抛 `URIError`，从单源坏数据
     变成 500 internal）；`mkdir`/`writeFile`/`rename` 的文件系统错误归类为契约里的
     `self-update-download`（原先是裸 await → 500 internal，客户端那条专用文案永远用不上）
     并在失败时删掉 `.part`。
  9. **客户端**：目录过期横幅的原因**永远**是「原因未知」（服务端 `/status` 给的是字符串错误码、
     `/catalog` 压根不带 error，客户端却按对象读 `error.message/.code`）——现在字符串/对象两种
     形态都认，认不出的码原样显示（「原因未知」让人没法判断是网络、限流还是源站挂了）；
     「正文不是 JSON」原先归到 `internal`（反代返回 HTML 时界面说「宿主内部出错 / 看宿主日志」），
     `err.badResponse.*` 三段文案**成了死文案**，现在 2xx 却给出非 JSON 归 `badResponse`；
     `err.badResponse.why` 里的 `{status}` 占位符从未被插值（`t` 没收到第二参），也一起修；
     写操作的忙碌态改为**按作业 key 归位**（原 `clearJob()` 无条件清空：装 A 时点装 B，A 完成
     会把 B 的忙碌态也清掉，界面显示空闲 → 用户再点一次就是重复安装），并加了同 key 去重
     （读 ref 而非 state，否则同一批事件里连点两次守卫失效）。
  回归：新增两个套件——`verify/catalog-identity.test.mjs`（36 条：身份层/内容校验/搜索/排序/分页，
  有真实快照时一并跑规模复核）与 `verify/host-contract.test.mjs`（16 条：diagnostic 透传、
  `ok` 推导、重名歧义、重启顺序、error 监听顺序、Map 映射表），两者都由门禁自动执行；
  `client-copy.test.mjs` 26→**30/30**、`self-update.test.mjs` 39→**43/43**。
  这一批审计同时留下一条方法论记录：三份审计共 26 条结论里 3 条经复核不成立，**不能照抄**。

- **上一版修复的对抗性复核：抓出并修掉 4 条我自己引入/残留的缺陷**（把 diff 交给独立一方
  专门找错，而不是自己再读一遍）。这一轮全部由**可复现的证据**驱动：
  1. **「一键更新」会永久卡死（最严重，是我上一版引入的）**：新加的「同一个包正在装就吞掉重复
     点击」守卫**只 `return` 不回调**，而一键更新的顺序执行靠回调推进——用户在「已安装」页插进
     一个正在被批量处理的包时，那一步既不发请求也不回调 → 循环断掉、`batch` 永远 `{running:true}`、
     按钮被自己的守卫挡住，**整个会话内一键更新彻底失效、只能刷新页面**。
     根因还有一处不一致：「已安装」页的更新按钮原先不像「可更新」页那样受 `batchRunning` 约束，
     正好从那一页漏过去。修法三条一起上：守卫命中时也回调（并在批量里把这类记为 `skipped`，
     既不算成功也不算失败）、已安装页按钮补上 `batchRunning`、新增「{name} 正在装/更新，已跳过。」文案。
  2. **「取消安装」的文案是死路径**：`ok` 判成 `error === null && application !== 'failed'`，
     于是宿主「取消 + 带一个说明原因的 error」时 `ok=false`，客户端 `requestJSON` 直接抛错，
     `notice.*Cancelled` 永远渲染不出来。现在 `cancelled` 恒为 `ok=true`（无论有没有 error）。
  3. **过期原因仍有一半路径是「原因未知」**：上一版只让客户端认字符串错误码，但 `/catalog`
     响应里根本没有 `error` 字段，而客户端优先读的正是它——只有 `/status` 那条半路径能拿到。
     现在 `/catalog` 也带 `error: cache.error ?? null`。
  4. **搜索与身份的过度修复**（两条都是我上一版用力过猛）：
     - 为了让「搜 `github` 不再返回全量」而**整段删掉 `url`**，导致用户从 GitHub 复制地址粘进
       搜索框变成 **0 结果**（`https://github.com/bycall/dsh-answer-reviewer` 由 1→0）。而且
       复核发现「搜 github 出全量」的真凶是**描述里写了 github**、不是 url。现在 url 回来了，
       但**只对「地址形状」的词生效**（含 `/` 或 `.`）：粘贴完整地址精确命中，搜通用词仍不会全量。
     - 为了杀掉「`@随便/同名` 误命中」而删掉 scope 兜底，**把 1431 条合法匹配一起杀了**：
       `dsh plugin add <git url>` 装出来的包名常是 `@owner/name`，而目录里那条的 `npm` 是无 scope 的
       `name`——真实目录里 1431 条正是这种形态（复核用 `joinInstalled().installed` 量化：0/1431 全落空）。
       正确修法是**按 owner 对别名**（`@owner/name` 只在目录里确有 owner 对该仓库时成立，
       `@unknownorg/name` 仍不匹配）。同一轮里还修了两处哨兵误伤：
       ① 同一仓库的**多个子插件**（`name` 形如 `repo#sub`，真实 50 个仓库、463 条带 `#`）被误判成
       「重名歧义」而全部不显示已安装——现在 `owner/repo`、`@owner/repo` 是**共享键**（命中多条都算），
       只有**不同 owner** 争用裸仓库名时才判歧义；
       ② 条目 `name` 里的 `#子目录` 后缀没剥掉，导致 `@owner/repo` 对不上。
  5. **内容校验收紧了但要给手工源留活路**：1% 容差对 `count=10/实际 13` 这类手工
     `DSHM_REGISTRY_URL` 目录过严（整源被拒），改成小目录（≤100）给 5 条余量、大目录按 2%。
  6. **`unverified` 去重**：多个源报同一个版本时诊断文案里出现「1.1.6、1.1.6」。
  7. **注释的论证站不住**：重启端点「先排退出再写响应」这个**顺序是对的**（防御性），但我原先写的
     因果链（「响应写失败 → 异常被吞 → 退出永不安排」）经实测**缺少证据**——对已 destroy 的 socket
     写并不抛错，只有对已 end 过的 res 才会同步抛 `ERR_STREAM_WRITE_AFTER_END`。注释已改成诚实版本。
  本轮同时把两条**只 grep 源码形状**的断言换成了真调 handler 读响应体的**行为测试**
  （`sendChangeResult` 六种 application/error 组合），因为形状断言换个等价写法就会假红/假绿。
  `host-contract.test.mjs` 16/16、`catalog-identity.test.mjs` **36/36**、`client-copy.test.mjs`
  **30/30**、`self-update.test.mjs` 43/43、门禁与 e2e **64/64** 全绿。

- **补测：把「全绿」里仍存在的空洞补上**。复核发现上面那批修复的回归覆盖并不完整，补了三处：
  1. **「一键更新永久卡死」的入口在真实浏览器里补了一条回归**（e2e 64→**65/65**）：批量进行中切到
     「已安装」页，断言那颗更新按钮**确实被禁用**。这是当时唯一漏掉的入口——「可更新」页的行内按钮
     有 `batchRunning`、这一页没有，复核脚本正是据此认定「真实用户可达」。现在由真实浏览器兜住，
     而不只是源码里 grep 到那个字符串。
  2. **`findCatalogItem` 改成真调**（host-contract 16→**18/18**）：身份层（`id`/`npm`/`url`）命中
     即确定；显示名层唯一才确定、**重名报歧义且 `item === null`**（绝不返回其中任意一个）。
     这是「会装错包」那一类里唯一还只剩源码形状断言的地方。
  3. **线上通道体检**（临时探针，跑完即删、不入库）：GitHub Releases API 确认**每个版本的附件都带
     `digest`（sha256）**、`@v1.1.5/releases/index.json` 仍 200 而 `@main/…` 是 404、真实
     `check()` 以 `current=1.1.5` 跑通（`ok:true`、`channel:github-release`）。
     它证明「`dist.integrity` 与 digest 的加固**没有把真实通道打死**」——加固类改动必须对着真实环境
     验一次，否则「更严格」很容易变成「永久不可用」。

  **这一节的方法论**：`verify/` 里的断言分两种价值——**真调行为**（能抓住回归）与**源码形状**
  （只证明那个字符串还在文件里，换个等价写法就会假红/假绿）。这批修复里凡是「会装错包 / 会卡死 /
  会谎报」的高危路径，都已经至少有一条真调或真实浏览器的断言。


- **三个页签页面统一间距与高度，新增页面只改一处注册表**（用户报：发现 / 已安装 / 可更新
  三个页面「高度不对齐」，并要求「设计成统一的，方便后续添加页面」）：根因是三页各写各的
  外壳——发现页是「工具条 + 分类 + 汇总 + 网格」，已安装页是「汇总 + 行列表」，
  可更新页却是**一张带边框和内边距的卡片**（`.dshpm-updatesPanel` 的 `padding:12px 14px`），
  那 12px 内边距把这一页的第一行文字整体推下去，加上容器节距有 8 也有 10，切页签就能看到
  内容上下跳。修法三层：
  1. **统一外壳**：新增 `.dshpm-page`，渲染处把当前页套进去，三页共用一套节距（12px）
     与起点；`.dshpm-updatesPage` 作为整页时去掉卡片内边距与边框（基类留着，便于别处复用）。
     页面级间距统一成一个单位 12px（`gap`），卡片/列表行**内部**仍是 8px（块内间距）。
     `.dshpm-page` 用 `flex:1 0 auto` 覆盖 `.dshpm-root > *` 的 `0 0 auto`：内容不足一屏时
     页面撑满剩余高度（几页等高），内容超长时仍由面板根自己滚动、任何区块都不收缩
     （§12.12 的不变量不变，没有引入第二个滚动容器）。
  2. **固定页签高度**：`.dshpm-tab` 改 `inline-flex` + `min-height:32px`，带角标（可更新）
     与不带角标的页签一样高——后续新增页面加角标、加图标都不会把页签栏撑高。
  3. **页签/页面注册表**：新增 `MARKET_TABS`（id / 文案 / 角标 / 入口）与 `MARKET_PANES`
     （各页渲染函数），页签栏循环生成、页面查表渲染。新增一个页面 = 加一行页签 + 加一个
     渲染函数，正文不再有嵌套三元分支；第三个页签的角标计数与 `goUpdates` 入口也声明在
     注册表里（`data-tab` 便于断言与定位）。
  回归：`client-copy.test.mjs` 改钉注册表（顺序、UpdatesPane 由 `MARKET_PANES` 渲染、
  `tab === "installed"` 分支写法已消失）并新增 1 条布局不变量（外壳节距 / 不收缩 / 页签
  固定高度 / 三处 gap 都是 12px），24→**25/25**；`market-ui.e2e.mjs` 新增 `[2c]` 用真实几何
  取证——三个页签按钮等高、页签底边到页面顶边节距都是 12px、**三个页面的第一行内容顶边
  完全一致**（实测 120/120/120）、内容不足一屏时已安装与可更新两页等高，并留一张
  `market-tab-alignment.png` 对照图，58→**64/64**。注意：页面入场动画（`dshpm-rise`，从
  `translateY(7px)` 起）与页签底线 0.26s 过渡都会污染几何测量，断言前必须等动画落位
  （首轮实测正是量到中间帧，把对齐误判成差 7px）。

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
- **修复 GitHub 发布页正文乱码**（用户报：github发布页怎么这么乱）：v1.0.0–v1.1.5 的 Release 正文里
  CHANGELOG 段整页乱码（只有 v1.0.2 干净——那版没有 CHANGELOG 节，走的是脚本字面量回退文案）。
  根因是发版脚本 `Get-Content CHANGELOG.md -Raw` 没带 `-Encoding`：Windows PowerShell 5.1 默认按
  系统 ANSI（本机 GBK）解码，UTF-8 中文被读成乱码后原样写进 `--notes-file` 传上 GitHub。正文底部
  versionName/安装 那几行是 .ps1 里的字符串字面量（脚本带 BOM，解码正确），「只有 CHANGELOG 段乱、
  字面量行好好的」正好把锅钉在读文件这一步。修复：`scripts/` 下所有 `Get-Content` 显式
  `-Encoding UTF8`，新增 `verify/ps-encoding.test.mjs` 钉死这条不变量（漏写即报错、负向对照先验尺子）；
  已发布的 8 个乱码页用 `gh release edit` 按**对应标签上的 CHANGELOG 节**重建正文（trailer 逐字保留），
  9 个 Release 已全部可读。

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
