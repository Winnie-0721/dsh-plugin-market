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
   - `verify/*.test.mjs` **全部**通过——**不是写死清单，是自动发现的**（当前 **20** 套：
     来源判定矩阵、样式生命周期、版本一致性、PS 脚本 BOM 与读取编码、自更新通道、文案与动效不变量、
     不说谎两条路径、桌面端重启拒绝路径，以及**发布工作流回归** `release-workflow.test.mjs`——
     后者钉住「npm 发布只能由 `publish-npm.yml` 亲自执行」，见 §4.2.1）；
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
4. `publish-npm` job：**不自己写发布步骤，而是 `uses: ./.github/workflows/publish-npm.yml`
   复用**（该文件新增了 `workflow_call` 触发器）。发布实现在 `publish-npm.yml` 里**只有一份**：
   先自检 OIDC 身份，再看幂等闸门（该版本已在 npm 上就跳过），然后
   `npm stage publish --access public`（**暂存发布**，之后需人工 2FA 批准才公开）。
   凭据是 npm Trusted Publishing（OIDC）——**调用方与被调用方都要声明 `id-token: write`**，
   缺一个就拿不到令牌。前提是在 npmjs.com 给本包添加 Trusted publisher
   （repository=本仓库 + **workflow 文件名**）。现在只有 `publish-npm.yml` 一个文件需要登记；
   原来给 `pack-release.yml` 加的那条已经用不上了（留着无害，删掉也不会影响任何一条路径）。
   npm ≥ 11.5.1 才支持 OIDC，job 里先 `npm install -g "npm@^11.5.1"`（**不要**用 `npm@latest`，
   见下方 ⚠ 块的第 1 条：npm 12 与 node 22.14.0 不相容）。
   **为什么必须复用而不是自己写一遍**（v1.1.6 / v1.2.0 各踩一次，真因见 §4.2.1）：
   npm 按 `job_workflow_ref` 里的**文件名**匹配 Trusted Publisher，而 `workflow_call` 下
   `job_workflow_ref` 指向**被调用**的那个文件——只有复用才能让令牌里的文件名仍是
   `publish-npm.yml`。这正是 `release-workflow.test.mjs` 反向断言盯住的那条底线。
   （`publish-npm.yml` 同时保留 `release(published)` 与 `workflow_dispatch`，用于人工建 Release
   与手动补发——由 GITHUB_TOKEN 创建的 Release 不会触发其它 workflow，这也是 npm 发布必须
   并进这条链的原因。）

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

常规发布**不用手动碰 npm，也不用另跑一次手动补发**：`pack-release.yml` 的 `publish-npm` job
会**复用** `publish-npm.yml` 完成暂存发布（版本已在 npm 上则跳过）。手动补发 / 重试时按下述确认：

1. `npm whoami` 能返回你的用户名（否则先 `npm login` 或设置 `NPM_TOKEN`）；
2. 确认要发的是**新版本号**（已被占用的号不能重发）：`npm view deepseek-harness-market versions`
   里不该出现它 —— 注意**「名字是否可用」在 1.0.0 之后就再也回不到 404 了**，
   现在 `npm view deepseek-harness-market version` 返回的是 **1.2.0**（本包已公开）；
3. `npm publish --access public`（公开包需要显式指定 access）。

或者干脆走同一条 OIDC 通道（推荐，与 CI 完全一致）：

```powershell
gh workflow run publish-npm.yml --repo Winnie-0721/dsh-plugin-market --ref main
```

> **⚠ npm 发布需要「暂存 + 人工批准」两步——我在 v1.1.6 上连猜错三次才查清，如实记在这里。**
>
> v1.1.6 的 `pack` job（门禁 → 打包 → 建 Release + 传附件）**成功**；`publish-npm` 先后失败了
> **两次**，中间夹着我两个错结论：
>
> | 我当时的说法 | 判定 |
> |---|---|
> | 「npmjs.com 上没配 Trusted publisher」 | **错**——包设置页里有 |
> | 「登记的 workflow 文件名不匹配」 | **错**——不是这个问题 |
>
> 真因是**两个**，都来自 CI 日志（用本机 git 凭据读 Actions job logs 接口拿到，
> 在此之前全是推断，所以连错两次）：
>
> 1. **`npm@latest` 装不上**：npm 12 起要求 `node ^22.22.2 || ^24.15.0 || >=26`，
>    而两个 workflow 都钉 `node 22.14.0` → `npm install -g npm@latest`
>    直接 `EBADENGINE` 退出，`npm publish` 根本没跑到。
>    **改法**：钉 `npm@^11.5.1`（会解析到最新 11.x：既有 `stage` 子命令，又与 node 22.14.0 相容）。
>    将来要上 npm 12，必须**同时**把 `node-version` 提到 22.22.2+ 或 24.15+。
> 2. **本包只被授予「暂存发布」**：包设置页 Trusted Publisher 卡片上写着
>    **Permissions: `npm stage publish`、`npm dist-tag`**，**没有 `npm publish`** → 普通
>    `npm publish` 被拒：`403 OIDC permission denied for this action`。
>    **改法**：改用 **`npm stage publish --access public`**（不是放松 npm 那边的权限——
>    暂存发布是**更严格**的模式：把 2FA 人工确认推迟到最后一步）。
>
> **所以发布现在是两步**（这也是 npm 对高安全包推荐的做法）：
>
> 1. CI 自动完成**暂存**：`npm stage publish` 成功后会打出
>    `deepseek-harness-market@<version> (staged with id <uuid>)`，并附 **Sigstore 签名溯源**
>    （`Provenance statement published to transparency log`）。
> 2. **人工批准**（需 2FA，只能由账号持有者做）：
>    ```powershell
>    npm stage list                    # 看 stage id
>    npm stage approve <stage-id>      # 输入 2FA 一次性验证码
>    ```
>    也可在 npmjs.com 该包页面点 Approve。**没批准之前版本不会公开**，
>    `npm view deepseek-harness-market version` 仍是上一个版本。
>
> 当时的状态记录（**已过期，留作过程证据**）：v1.1.6 一度是「已暂存，等待批准」
> （stage id `0c2767bb-1d36-4f5e-8033-d9bf9ccc9dfa`，日志见 run 37587492890）。
> 现在的实况：`npm view deepseek-harness-market version` → **1.2.0**，
> 1.1.6 于 2026-10-07 公开、1.2.0 于 2026-10-09 公开。
>
> **Release 附件不受影响**（已就绪，sha256 与清单逐字节一致），所以
> 「从 GitHub Release 附件安装 / 自更新」这条主分发路径是好的——**npm 那条路慢一步不影响用户安装**。

#### 4.2.1 第三个真因（v1.2.0 发布时查清，**影响 pack-release.yml 的自动发布，别再推断**）

> v1.2.0 的 `Pack and Release` run（#4，37937588918）结论是 **failure**，
> 但**打包那半是成功的**：Release `v1.2.0` 已创建、附件齐全
> （`deepseek-harness-market-1.2.0.tgz` 190,314B + `version.json` 195B）。
> 失败的只有 `publish-npm` job。
>
> **真因（CI 日志原话，不是推断）**：
> ```
> npm error code ENEEDAUTH
> npm error need auth This command requires you to be logged in to https://registry.npmjs.org/
> ```
> 即 **OIDC 根本没认证成功**，而不是第 2 条那种「认证成功但权限不足」的 403。
>
> **为什么**：npm 的 Trusted Publisher 是把信任**绑定到具体 workflow 文件名**的。
> 本包的 Trusted Publisher 配的是 **`publish-npm.yml`**；而 `pack-release.yml`
> 里那个**自己实现的 `publish-npm` job 不是那个文件**，OIDC 不认 → `ENEEDAUTH`。
> 「v1.1.6 同样失败」也印证：run #3（f11c3c5）的 `publish-npm` 同样是 failure，
> 而 v1.1.6 最终是**靠手动触发 `Publish to npm`（publish-npm.yml，workflow_dispatch）**
> 才暂存成功的（run #6，成功）。
>
> **当时的临时做法（已被下面的根治取代，留作过程证据）**：标签推送让 `pack-release.yml`
> 完成**打包 + 建 Release**；随后**另跑一次** `Publish to npm`：
> ```powershell
> gh workflow run publish-npm.yml --repo Winnie-0721/dsh-plugin-market --ref main
> ```
> 它会读 `plugin-market/package.json` 的当前版本（即刚发的那个）去 `npm stage publish`。
> v1.2.0 就是这么补发出来的——**但常规发布不该依赖这一步**。
>
> **根治（v1.2.0 第七轮已落地）**：`pack-release.yml` 的 `publish-npm` job 改为**复用**
> `publish-npm.yml`：
> ```yaml
>   publish-npm:
>     needs: pack
>     permissions:
>       contents: read
>       id-token: write
>     uses: ./.github/workflows/publish-npm.yml   # ← job_workflow_ref 就是它，与登记一致
> ```
> 关键前提是**实测**出来的：OIDC 里 npm 校验的是 `job_workflow_ref`，而
> - 普通 job：`job_workflow_ref` = 所在文件；
> - `workflow_call`：`job_workflow_ref` = **被调用**的文件（`workflow_ref` 才是调用方）。
>
> 所以复用会让令牌里的文件名仍是 `publish-npm.yml` ✅，而发布逻辑只有一份。
> 「自己写一遍步骤」才是那个复发两次的写法，**别再加回去**——
> `verify/release-workflow.test.mjs` 有反向断言盯着（门禁会拦）。
>
> 顺带把原来重复 job 里的**幂等闸门**（版本已在 npm 则跳过）搬进了 `publish-npm.yml`；
> 少了它，补跑 `Pack and Release` 会因版本已存在而失败。
>
> **在真实 CI 里跑了复用路径（2026-10-09），但要说清它证明了什么、没证明什么**：
> `Pack and Release` run [#37941309305](https://github.com/Winnie-0721/dsh-plugin-market/actions/runs/37941309305)
> 结论 **success**，两个 job 分别 `pack=success`、`publish-npm / publish=success`。
> 日志里自检步骤打出：
> ```
> job_workflow_ref = Winnie-0721/dsh-plugin-market/.github/workflows/publish-npm.yml@refs/heads/main
> workflow_ref     = Winnie-0721/dsh-plugin-market/.github/workflows/pack-release.yml@refs/heads/main
> OIDC 身份正确：npm 会认这个文件名。
> ```
> 第一个字段正是 npm 校验的那个 —— **复用路径下它仍然是 `publish-npm.yml`，与登记一致**。
> 这是本次修复真正要拿到的那条证据。
>
> **⚠ 它没有证明「经复用路径真的发布成功过」，因为那一步这次被跳过了。**
> 该 run 的逐步骤结论（`gh run view 37941309305 --json jobs`）是：
> ```
> 4 success  npm install -g "npm@^11.5.1"
> 5 success  自检 OIDC 身份（文件必须是 publish-npm.yml）
> 6 success  该版本已在 npm 则跳过（补跑幂等）
> 7 skipped  Stage publish to npm          ← 幂等闸门命中，没执行
> 8 skipped  提示下一步（暂存发布需人工批准）
> ```
> 原因是时间先后：npm 上的 1.2.0 发布于 **13:48:06Z**，而这个 run **14:03:09Z** 才起 ——
> 版本已存在，闸门按设计跳过。**所以「job 绿」在这里不等于「发布成功」**：它绿在自检与闸门这两步上，
> 而真正发布的那一步从未执行。下次发新版本时 `Stage publish to npm` 才是这条路径的首次实跑，
> 那时要盯的是这一步（而不是只看 job 绿）——这也正是 v1.1.6 那次「publish-npm 显示成功、
> 其实只是闸门命中」的同一种错觉。
>
> **新增的发布前自检**（`publish-npm.yml` 里那一步 `自检 OIDC 身份`）：只请求令牌、解出声明、
> 比对文件名，不发布任何东西。它把「文件名不对」从一句要翻日志才看得懂的 `need auth`，
> 变成**发布之前**就直接说明「登记的是 publish-npm.yml，这次是 xxx」的错。
> 这个坑连续吃掉两次发布，不该再靠事后读日志定位。
>
> 历史状态（修好之前）：v1.1.6 与 v1.2.0 都因 `ENEEDAUTH` 让整个 `Pack and Release` 变红，
> 当时都是靠上面那条手动命令补发的。
>
> **v1.2.0 现已公开**：`npm view deepseek-harness-market version` → **1.2.0**
> （`dist-tags.latest = 1.2.0`，发布于 2026-10-09）。当初的暂存记录
> （stage id `96502bf5-4862-4f2a-9933-67412099f989`，run 37938458936，含 Sigstore 溯源）
> 已随人工批准生效，不再是「等待批准」状态。

### 4.3 真要发 npm 时的检查单

```powershell
pnpm login                                   # 或 pnpm config set //registry.npmjs.org/:_authToken=<token>
cd plugin-market
pnpm publish --access public --no-git-checks
```

- 发布前确认**版本号没被占用**（不是「名字可用」——本包已公开，`https://registry.npmjs.org/deepseek-harness-market`
  现在返回 **200**，404 只属于 1.0.0 之前）：`npm view deepseek-harness-market versions` 里不该有你要发的号；
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
- **⚠ `v1.1.5` 是一个不一致的过渡标签（实测确认，只影响这一版）**：它是「本地打包的 tgz 已提交进
  `releases/`、CI 又用 Actions 重打一份上传成 Release 附件」的交接点，两份是**两次不同的构建**，
  字节不同（仓库内 465679 B / `b5e5ecaf…`，Release 附件 465733 B / `537c9f02…`）。
  实测对照（2026-10-07）：`v1.1.3`、`v1.1.4` 的 CDN 副本与附件**逐字节一致**，只有 `v1.1.5` 不一致。
  后果：自更新在 v1.1.5 上会**下载失败或哈希不符**（第 1 源用附件 `digest` 当清单、第 3 条路才是附件，
  而 CDN 那条路先返回了另一份字节）。这是**加固前的历史遗留**，不是加固引入的
  （引入「用附件 `digest` 当清单」的是 `39dfc9d`，早于本次会话 11 个提交）。
  **v1.1.6 起在结构上不可能再发生**：仓库里已没有 `releases/`，CDN 两条路必然 404 快速失败，
  字节只能来自附件，清单与字节天然同源。因此 `verify/self-update-live.ps1` 在 v1.1.5 上会失败、
  在 v1.1.6 及以后应全绿——**用它验收时请先把本机版本降到 1.0.9（脚本本来就这么做），
  让它去装最新标签**，而不是拿它去装这个已知不一致的 v1.1.5。
- **下载**仍是三条路依次试：`@<tag>/releases/<file>.tgz` → `@main/releases/<file>.tgz`
  → **GitHub Release 附件**；新版本前两条必然 404（快速失败），实际由附件供给。
  **内容由 `sha256` 与产物自证负责**，从哪条路取都不影响安全性（三道校验见 [API-CONTRACT §2.9](API-CONTRACT.md)）。
  传输层失败才换路；字节都拿到了却哈希不符是篡改信号，直接硬失败。
  **2026-10-09 复测（v1.2.0）**：前两条 jsDelivr gh 路各 3 次全部 404（`releases/` 早已不在
  git 树里，jsDelivr gh 源只读 git 树，**永远拿不到 Release 附件**——`@v1.1.6` 同样 404）；
  第 3 条 Release 附件 3/3 成功。自更新靠第 3 条兜底，但**手动安装别用 jsDelivr gh 地址**——
  §4.1 给的 Release 附件地址才是唯一稳定的手动安装源。

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
| **宿主半**（`lib/index.js` / `catalog*.js` / `http.js` / `self-update.js` / `restart*.js`） | 需要**重启 DSH 进程**（v1.1.6 起市场页有一键「重启 DSH」，**但桌面端除外**，见下） | 加临时标记 → 用 patch 层 `disabled: true` 卸载再还原触发热重载 → 标记不出现、`/plugin-market/status` 的版本仍是旧值 |
| **自更新装下的新版本** | 同样是**重启 DSH**：装完 `requiresRestart: true`，客户端不谎称已生效，有按钮时给出按钮 | `apply` 返回 `application: restart-required` + `from/to`；按钮回到「插件市场更新」而不是「已更新」 |

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

**⚠ 桌面端没有这个按钮，而且不该有（v1.2.0 查清）**：`restart.available = false`，
界面**不显示按钮、也不弹重启询问窗**，只给出「关掉窗口再打开」的指引；
`POST /plugin-market/restart` 返回 **409 `restart-unsupported`**（并有 `restart-unsupported.test.mjs` 钉住）。
三条独立理由（壳的 IPC 封闭白名单 / 壳把宿主退出当致命故障且不自动拉回 / 那个「启动失败」框里
有一颗 `disableAllPlugins()`）记在 [API-CONTRACT §2.6](API-CONTRACT.md)，
不在 `docs/ROADMAP.md` 重新立项。**在桌面端里给按钮 = 让用户撞「启动失败」并可能一键停掉全部插件。**
**但「待重启」这件事仍然如实显示**：宿主半记账 + `/status.pendingRestart` 水合，刷新页面不会丢。
