# 发布与版本号规则

本仓库用**最基础的 app 版本号规则**：人类可读的 `versionName` + 单调递增的 `versionCode`，
由 [scripts/release.ps1](../scripts/release.ps1) 生成，不手写、不猜。

## 1. 版本号规则

| 名称 | 形式 | 在哪里用 |
|---|---|---|
| `versionName` | `MAJOR.MINOR.PATCH`（严格 SemVer，不带 `v` 前缀） | `package.json` 的 `version`、Git 标签 `v<versionName>`、GitHub Release 标题 |
| `versionCode` | `MAJOR*10000 + MINOR*100 + PATCH`（单调递增整数） | `dist/version.json`、需要纯数字版本的宿主/渠道 |
| 构建标识 | `+<提交数>.<短哈希>` | 只写进发布说明与 `dist/version.json`，**不进入** `versionName` |

**递增规则**（从用户的视角判定，而不是从代码量）：

- `MAJOR`：破坏兼容——改了对外契约（端点、字段、错误码）、去掉了别人依赖的行为；
- `MINOR`：向后兼容的新功能（新页签、新能力、新环境变量）；
- `PATCH`：向后兼容的修复，包括安全修复与兼容性修复；
- **高位递增时低位归零**（这条最容易漏，而且漏了会静默错）：`-Bump minor` 把 `MINOR` 加一**并把 `PATCH` 归零**；
  `-Bump major` 把 `MAJOR` 加一并把 `MINOR`、`PATCH` **都归零**。判例取自真实历史，不是举例：
  `1.0.0 → 1.0.1 → 1.0.2` 是 PATCH；`1.0.2` +minor → **`1.1.0`**（versionCode `10002` → `10100`）；
  `1.1.0 → 1.1.1 → 1.1.2 → 1.1.3` 又是 PATCH。
  这条规则由门禁里的**版本算术自检**每次发布都验一遍：一张判例表（含 `1.0.2 +minor → 1.1.0`、`1.9.9 +minor → 1.10.0`）
  加一条负向对照（把归零去掉必须被判失败）。**写成"只加不清零"会被当场拦下**——版本号一旦发布就再也改不回来。
- `versionCode` 的隐含边界：公式 `MAJOR*10000 + MINOR*100 + PATCH` 要求 `MINOR` 与 `PATCH` **都小于 100**，
  否则会撞号——`1.0.100` 与 `1.1.0` 都算成 `10100`。脚本越界时直接拒绝并提示「改为递增 MINOR」，
  不会给出一个重复编号；若确实需要三位以上的分段，只能换公式，而那属于 `MAJOR` 变更。
- 首个正式版本固定 `1.0.0`；
- 需要试用但仍未定稿时用预发布号 `1.1.0-rc.1` 这类形式，**不占用正式号段**；
- 已经发布过的版本号**永不重用、永不覆盖**（npm 也不允许覆盖），出错就往上加 PATCH。
- **升哪一位可以自动识别**（`release.ps1 -Bump auto`，判据就是上面三条规则本身）：
  **证据** = 自上个 `v<版本>` 标签以来触及 `plugin-market/` 的提交类型前缀（`feat`→MINOR、
  `fix`/`修复`/`perf`→PATCH、`feat!`/`BREAKING`/「不兼容」→MAJOR、`chore`/`docs`/`ci`/`test`→不升档；
  认不出的类型走关键词兜底，还认不出就按「包体有改动至少 PATCH」）；**声明** = CHANGELOG 顶部还没打标签的
  `## x.y.z` 节（或 `-Version x.y.z` 直接指定）。两边**双向都硬拦**：声明低于证据（有 `feat` 却写 1.1.6）
  或高于证据（只有 `fix` 却写 1.2.0）都拒绝，报错会列出判定档位的提交并给出两条出路；
  显式 `-Bump patch|minor|major` 是人工覆盖路径——证据高于所选档位时只警告、不拦。

举两个实际判例：样式生命周期修复（只改行为、不改契约）发 `1.0.1`、`1.0.2`（PATCH）；
新增两个按钮 + `/self-update` 两个端点 + 自更新通道 + 一套动效，对用户是**新功能**，
虽然没删任何旧东西，也发 `1.1.0`（MINOR）。

为什么 `versionName` 保持严格 `MAJOR.MINOR.PATCH`、把构建信息放到别处：SemVer 规定构建元数据不参与优先级比较，
而 Git 标签、npm 版本、`dsh plugin add` 的解析都吃这个字符串——把提交哈希塞进去只会制造歧义。

## 2. 一次发布做什么

发布分两段：**本地只做版本与门禁**，**打包与发布全在 GitHub Actions**。
本地不产生任何打包产物（`dist/` 始终空着、仓库里没有 `releases/`），也不消耗 gh / npm token；
回退与旧版安装一律从 GitHub Release 附件下载（§4.1）。

本地段（`scripts/release.ps1`）按固定顺序执行，任何一步失败就停，不会留下半个版本：

1. **读**：解析 `plugin-market/package.json` 的 `version` 并校验 SemVer 形状；
2. **门禁**（全绿才继续）：
   - **版本算术自检**：判例表验证「高位递增时低位归零」（`1.0.2 +minor → 1.1.0`、`1.9.9 +minor → 1.10.0`、
     `1.4.7 +major → 2.0.0`），并负向对照 `versionCode` 的撞号边界（`MINOR`/`PATCH` ≥ 100 必须被拒绝）；
   - **档位判定自检**：提交主题判档表（`fix：…`→PATCH、`feat：…`/`feat(ui): …`→MINOR、
     `feat!：…`/`BREAKING CHANGE`→MAJOR、`chore(release): …`/`docs…`/`ci: …`→不升档），并要求
     认不出的类型落回不升档——虚报档位会让 `-Bump auto` 拿假证据放行/拦错；
   - `node --check` 过 host/client 每个 `lib/*.js`；
   - `package.json` 可解析，且 `dsh.bundle.patch` / `dsh.client.platform` / `exports["./client"]` 齐全；
   - `cordis.patch.yml` 存在且行 `name` 与包名一致；
   - 客户端 bundle 含 `__ModuleLoader__.load` 且 `id` 等于包名，且不含 `eval` / `new Function`；
   - `lib/` 里不存在**写死的旧版本号**（版本必须从包清单读；这条拦过一次真实的漂移）；
   - `verify/*.test.mjs` 全部通过（含来源判定矩阵、样式生命周期、版本一致性、PS 脚本 BOM 与读取编码、自更新通道、文案与动效不变量）；
   - **发布面干净**：`plugin-market/`、`docs/`、`scripts/` 与根文件不能有未提交改动。
     其它路径（例如并行进行的 `verify/**` 验收脚本）有改动只警告、不阻塞——它们既不进发布物，
     也不进发布提交，把一场正在跑的验收当成发布阻塞没有意义。
3. **递增**：按 `-Bump`（或 `-Bump auto` 识别 / `-Version` 指定的结果）写入新的 `version`；
4. **提交**：`git commit`（内容只有 `plugin-market/package.json`）+ `git tag -a v<version>`；
5. **推送**：`git push --follow-tags`。标签一推上去，Actions「Pack and Release」自动接手。

CI 段（`.github/workflows/pack-release.yml`，`push: tags: ['v*']` 触发；也可 `workflow_dispatch` 补跑）：

1. 检出标签，跑 `release.ps1 -CiPack`：**再过一遍同样的门禁**，打包内容以标签为准（不是分支工作区）；
2. `pnpm pack` → `dist/deepseek-harness-market-<version>.tgz` + `dist/version.json`
   （`version` / `versionCode` / 提交数 / 短哈希 / 构建时间）——产物只落在 CI 工作区，用完即弃；
3. `gh release create v<version> dist/*.tgz dist/version.json`：**Release 附件是回退与旧版安装的唯一下载源**；
   Release 已存在时改走 `gh release upload --clobber`（重跑幂等）；
   Release 正文取标签上 CHANGELOG 的同名节（`-NotesFile` 可覆盖），读文件一律显式 `-Encoding UTF8`——
   PS 5.1 的 `Get-Content` 默认按系统 ANSI（GBK）解码 UTF-8，漏写就会上去一页乱码（v1.0.0–v1.1.5
   实际发生过，8 个页面已按标签版 CHANGELOG 重建；`verify/ps-encoding.test.mjs` 负责拦住再犯）；
4. `publish-npm` job：`npm publish --access public`，版本已在 npm 上则跳过；凭据是
   npm Trusted Publishing（OIDC，job 上 `id-token: write`）——与 `publish-npm.yml` 同一套，
   前提是在 npmjs.com 给本包添加 Trusted publisher（repository=本仓库 + workflow 文件名，
   两个 workflow 都加）。npm ≥ 11.5.1 才支持 OIDC，job 里会先 `npm install -g npm@latest`。
   改回 token 或改用 `npm stage publish`（staged token + 人工 2FA 审批后公开）的位置
   写在两个 workflow 的注释里。
   （`publish-npm.yml` 保留作人工建 Release 与手动补发——由 GITHUB_TOKEN 创建的 Release
   不会触发其它 workflow，这也是 npm 发布必须并进本 workflow 的原因。）

## 3. 用法

```powershell
# 门禁 → 递增 → 提交 → 打标签 → 推送（推送后由 Actions 打包、建 Release、发 npm）
pwsh -File scripts\release.ps1 -Bump patch      # 修复
pwsh -File scripts\release.ps1 -Bump minor      # 新功能
pwsh -File scripts\release.ps1 -Bump major      # 破坏兼容
pwsh -File scripts\release.ps1 -Bump auto       # 自动识别升档：CHANGELOG 新节定号 + 提交证据验档位（双向都拦）
pwsh -File scripts\release.ps1 -Version 1.2.0   # 直接指定目标版本（与 -Bump 二选一；CHANGELOG 需有同名节或配 -NotesFile）

# 只跑门禁：不改版本、不打包、不提交、不发布（本地验证的唯一正确姿势）
pwsh -File scripts\release.ps1 -LocalOnly

# 递增 + 提交 + 打标签，但不推送（想先看一眼再推）
pwsh -File scripts\release.ps1 -Bump patch -SkipPush
```

`-Bump auto` 的判定口径见 §1「升哪一位可以自动识别」；`-Bump auto` 与 `-Version` 都会被提交证据
双向校验（声明档位低于或高于证据都会被拒绝），显式 `-Bump patch|minor|major` 信任人工判断——
证据高于所选档位时只给警告、不拦。

`-CiPack` 是 CI 专用：只在 `GITHUB_ACTIONS=true` 时放行，本地调用直接被拒——
本地打包会留产物、还会消耗 gh token，正是这次迁移要消灭的两件事。

**代理不是必须的**：2026-10-04 实测，不带 `HTTPS_PROXY` 时 `git ls-remote`（842ms）、`gh release list`（1.0s）、
GitHub API（1.6s）、Release 附件下载（2.7s）**全部直连可用**，且 `git` 走代理反而更慢（1239ms）。
但直连会偶发重置（本仓库早前就撞到过一次），所以带上它更稳，脚本两条路都能跑：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:HTTP_PROXY='http://127.0.0.1:7890'   # 可选，兜底用
```

唯一要记住的硬限制是 **GitHub API 匿名限流 60 次/小时/IP**（响应头 `X-RateLimit-Remaining`），
自更新通道因此把它当"第一源但可失败"，并有 10 分钟缓存把点击量封在 ~6 次/小时。

## 4. 分发路径

### 4.1 从 GitHub Release 附件直接安装（今天就能用，已验证）

```powershell
# 版本号换成你要装的那版（历次 Release 见仓库 Releases 页）；**回退就是把版本号换成更旧的那个**
dsh plugin --profile web add https://github.com/Winnie-0721/dsh-plugin-market/releases/download/v1.1.1/deepseek-harness-market-1.1.1.tgz
```

装好第一次之后就不必再记这条命令：「可更新」页页头的「插件市场更新」会走 §4.4 的自更新通道自己完成升级。

`dsh plugin add` 的 spec 解析接受 `.tgz` URL（`parseInstallSpec` 的 tarball 形状），
上面这条命令在全新 profile 上实测：**10.6 秒装完、bundle 已激活、`node_modules` 里有包**。
这条路径不需要任何 npm 账号，也是本仓库当前唯一可用的「按名字以外」的分发方式。

### 4.2 发布到 npm

本包已更名为 `deepseek-harness-market`。改名经过两步：原 `dsh-plugin-market` 在 npm 上属于另一个项目
（fireguo/veloce-ailab）；随后选的 `dsh-market` 又被 npm 的同名规则拦下——它与已存在的
`dshmarket`（v1.66.8）只差一个连字符，registry 对非 scoped 包返回
`403 Package name too similar to existing package dshmarket`，`--access public` 也绕不过。
（registry 建议加 scope，但用户名 `winnie_0721` 含下划线，而 scope 不允许下划线，需另建组织。）
最终选定 `deepseek-harness-market`，实测可用且无近似名冲突。

常规发布**不用手动碰 npm**：`pack-release.yml` 的 `publish-npm` job 会在 Release 之后
`npm publish --access public`（版本已在 npm 上则跳过）。手动补发 / 重试时按下述确认：

1. `npm whoami` 能返回你的用户名（否则先 `npm login` 或设置 `NPM_TOKEN`）；
2. `npm view deepseek-harness-market version` 返回 404（名字仍可用）；
3. `npm publish --access public`（公开包需要显式指定 access）。

### 4.3 真要发 npm 时的检查单

```powershell
pnpm login                                   # 或 pnpm config set //registry.npmjs.org/:_authToken=<token>
cd plugin-market
pnpm publish --access public --no-git-checks
```

- 发布前确认名字可用：`https://registry.npmjs.org/<name>` 返回 404；
- `pnpm pack` 后的 tarball 只含 `package/` 下的文件（lib、cordis.patch.yml、README×2、CHANGELOG、LICENSE、package.json）；
- 版本号不可重用、不可覆盖——发错了只能往上加；
- 发布后立刻真装一次：`dsh plugin --profile <新 profile> add <name>` 或直接 `add <tarball URL>`，启动宿主确认侧边栏底部入口还在。

### 4.4 自更新通道（「可更新」页页头那个「插件市场更新」按钮走的路）

三个源都会试，**按新鲜度排序**。全部数字是 2026-10-04 在本机实测（**不用代理**）：

| 通道 | 实测 | 定位 |
|---|---|---|
| **GitHub Releases API** | `releases/latest` → **200**（1.6s / 450ms），`X-RateLimit-Remaining: 47/60` | **第一源**：权威且最新；v1.1.6 起附件元数据（`digest`+`size`）直接成条目、不查清单；匿名 **60 次/小时/IP**，被限流返回 403 → 当成该源失败继续往下 |
| jsDelivr 标签列表（Data API） | 200，85–2100ms，不限流；**但列表滞后**（发布 1 小时后仍只有旧版本） | 第二源（新版本会卡在"拿不到该版清单"一步，404 记档） |
| jsDelivr `@main` 的 `releases/index.json` | 200；分支内容在 CDN 上可缓存 12 小时，**实测滞后** | 第三源（v1.1.6 起仓库不再有这份文件，新版本上 404 记档） |
| 标签探测（兜底） | 任意标签**按需取**：刚推完 `@v1.1.1/…` 立刻 200 | 前三个都说"没更新"时，按常规递进探 3 个候选标签（有界）；新版本的标签没有清单 → 404 记档，只为 ≤v1.1.5 补位 |

> **更正一条早先写错的结论。** 这里曾写着「本机直连 `api.github.com` 一律 403（GFW 拦截）、`github.com` 被重置，需要 Clash 代理」。
> 那是错的，两处原因：当时本仓库还是 **private**（未鉴权取 `releases/latest` 就是 404），而匿名限流返回的 403 被我误读成封锁。
> 今天实测：API 200、`github.com` 200、**Release 附件直连 200（2.7s；走代理 737ms）**，
> 下载字节的 sha256 与本地构建逐字节一致。**代理不是必须的，只是更快。**

**v1.1.6 起：打包产物不再进仓库**（`releases/` 目录已从仓库移除；回退与旧版安装一律从
GitHub Release 附件下载）。这条决定连带改了检查与下载的分工——如实记在这里：

- **新版本靠第 1 源**：GitHub API 的附件元数据自带 `digest`（sha256）与 `size`，
  条目当场组装，**不再需要仓库里的 `index.json`**；被限流（403）时第 2/3 源对新版本会 404
  并如实记档，检查退化成「更新通道没有回应 + 提示用命令行手动升级」，**不会谎称已是最新**。
- **≤v1.1.5 的老版本**：三个列表源与标签探测照常工作（那些标签里仍有 `releases/` 清单），
  上面两张表的实测数字就是那个时期的。
- **下载**仍是三条路依次试：`@<tag>/releases/<file>.tgz` → `@main/releases/<file>.tgz`
  → **GitHub Release 附件**；新版本前两条必然 404（快速失败），实际由附件供给。
  **内容由 `sha256` 与产物自证负责**，从哪条路取都不影响安全性（三道校验见 [API-CONTRACT §2.9](API-CONTRACT.md)）。
  传输层失败才换路；字节都拿到了却哈希不符是篡改信号，直接硬失败。

**两条硬约束**：

- **仓库必须保持 public**。转成 private 之后 jsDelivr 会 404（它读不到私有仓库），GitHub API 也会对未鉴权请求回 404，按钮会变成「更新通道没有回应」。同时 private 也意味着别人根本装不上这个插件（Release 附件要鉴权）。
- **同一个版本只能发一次**。标签内容不可变，jsDelivr 按标签永久缓存；改了代码就必须递增版本号（`release.ps1` 的可重入检查会拦住复用版本号）。

**列表源会滞后，别把任何一个列表当权威**（实测数据，2026-10-04）：

| 推完 v1.1.0 / v1.1.1 之后 | GitHub Releases API | `@v<tag>/releases/index.json` | `data.jsdelivr.com` 版本列表 | `@main/releases/index.json` |
|---|---|---|---|---|
| 立刻 | **v1.1.1**（最新） | 404 → 几分钟后 200 | 只有 1.0.0–1.0.2 | 1.1.0（缓存） |
| 一小时后 | v1.1.1 | 200 | **仍然只有旧的三个** | 1.1.0（12 小时缓存） |

所以检查逻辑按三层容错写：**三个列表源各自独立成败**（第 1 源附件元数据齐了就直接成条目；
第 2/3 源要"版本 + 该版本的清单"双双拿到），失败就继续问下一个；期间任何一个给出
**明确高于当前**的答案就早退出；全部没有更高版本时，再按常规递进探 3 个候选标签
（任意标签是按需取的，这一层能追上列表的滞后——但 v1.1.6 起新版本的标签里没有清单，
探测会 404 并记档，只为 ≤v1.1.5 的老标签补位）。取最高版本而不是第一个答案——
不同源的缓存新鲜度不一致，取高才不会漏更新。
下载同理：`@<tag>/…` → `@main/…` → Release 附件，**内容由 `sha256` 与产物自证负责**。

这套三层容错是发布后立刻实测撞出来的（v1.1.0 时第一个源半残就让整次检查失败了），修在 v1.1.1；
"列表滞后导致看不到刚发布的版本"这一层修在 v1.1.2（加了标签探测，并把最权威的 GitHub API 提到第一源）。

发完自更新之后用户必须**重启 DSH**（见 §5），因为宿主半在进程里被 Loader 缓存。

### 4.5 每次发版前跑一遍的三件事

```powershell
node verify/self-update.test.mjs         # 自更新通道的离线回归（含"拒绝路径不安装"）
node verify/client-copy.test.mjs         # 文案键集与动效写法的不变量
pwsh -File verify/ui-check.ps1           # 真实浏览器：起 scratch 宿主 + headless Edge，出截图
pwsh -File verify/self-update-live.ps1   # 自更新端到端：真的下载 + 校验 + pnpm 安装（需真实网络）
```

`verify/ui-check.ps1` 与 `verify/self-update-live.ps1` 不进门禁：一个要起宿主进程和浏览器，
一个要真实网络并临时改 `package.json`（它自己会按字节还原）；两者都慢且依赖本机环境。
但它们给出的是**离线测试给不了**的证据（真渲染、真计算样式、真的把包装上）。
改动客户端半或自更新通道之后必须手动各跑一次；截图落在 `verify/logs/ui/`。

## 5. 发布之后：改动什么时候生效

两个半的更新机制不同，发布说明里必须讲清楚，否则用户会以为「装了新版却还是旧行为」：

| 改动位置 | 生效方式 | 实测证据 |
|---|---|---|
| **客户端半**（`lib/client.js`） | 宿主按文件元数据算出新的产物 rev 并推给页面，**无需重启、通常也无需刷新** | 改完后线上 bundle 里能读到新代码（`mountStyles` / `style watchdog`），旧符号 `function installStyles` 已消失 |
| **宿主半**（`lib/index.js` / `catalog*.js` / `http.js` / `self-update.js` / `restart*.js`） | 需要**重启 DSH 进程**（v1.1.6 起可直接用市场页的一键重启，见下） | 加临时标记 → 用 patch 层 `disabled: true` 卸载再还原触发热重载 → 标记不出现、`/plugin-market/status` 的版本仍是旧值 |
| **自更新装下的新版本** | 同样是**重启 DSH**：装完 `requiresRestart: true`，客户端不谎称已生效，但会给出一键重启 | `apply` 返回 `application: restart-required` + `from/to`；按钮回到「插件市场更新」而不是「已更新」 |

三个容易踩的点：

- **patch 层的 disable/enable 热重载只重建 fiber，不重新导入 Node 模块**：它能证明「这一行被卸载/重新加回」（`/status` 会先 404 再 200），但拿到的是 Loader 缓存里的旧代码。不要用它来验证宿主半改动。
- **Loader 的模块缓存按解析后的文件路径记账**，所以「把依赖从本地目录换成 tarball」也不一定换掉 URL；而 DSH 的配置 watcher **明确忽略只改依赖的清单变化**，只认 `dsh.profile.bundles` 列表变化（`packages/boot/hmr/tests/profile.spec.ts`）。
- **改了宿主半之后，验证要在「新起的进程」里做**：`verify/ui-check.ps1` / `verify/verify-market.ps1` 起的 scratch 宿主是新进程，天然加载仓库里当前的代码，所以不需要去动用户正在用的 desktop profile。
- 另外：`dsh --profile <桌面 profile> --dump-config` 这类操作会被拒绝（`profile "desktop" is managed exclusively by the Electron application`），插件增删仍可走 CLI，但**组合的重载只能靠那个正在运行的宿主自己**。

因此给用户的标准动作是：**改动宿主半 → 重启一次 DSH**；只改客户端半 → 等几秒即可。

**重启助手（v1.1.6 起）**：有待重启的改动时，市场页会亮出一键「重启 DSH」横幅（契约见
[API-CONTRACT §2.10](API-CONTRACT.md)）。机制是 detached wait-and-relaunch：宿主拿到助手 pid
才回 200，延迟 900ms 退出；助手等进程**真的死掉**（有界等待 60s，到点放弃、绝不双开）再用原
`execPath` + `argv` 拉起；客户端探活必须先见到宿主「死过一次」，恢复后才自动刷新页面。
两条如实的代价：**正在流式输出的回复会被截断**；重启后的进程以 detached 方式拉起，
**终端 Ctrl+C 打不到它**——要用 DSH 自己的退出方式或 `taskkill` 结束（桌面端直接关窗口）。
