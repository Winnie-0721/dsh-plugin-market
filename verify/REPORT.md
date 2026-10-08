# 插件市场验收报告（task-3）

- **结论：通过。修复后复验一轮 53 条断言全绿（PASS=53 FAIL=0），运行 id `verify-20261003-221755`。**
- **本轮是 v1.0.0「桌面壳兼容性」修复的独立复验**，不是重复上一次：上一轮 47/47（`verify-20261003-214407`）**不覆盖桌面壳形状**，正是它漏掉了线上那个「Electron 里所有写操作 403」的真缺陷。两轮的关系见 §11.1。
- 被测对象：`E:\AI\DeepSeek Harness\Dsh\plugin-market`（`dsh-plugin-market` v1.0.0，host `lib/index.js` + `lib/catalog.js` + `lib/catalog-npm.js` + `lib/http.js`，client `lib/client.js`）
- **路径说明（后记）**：本报告是历史验收记录，所有绝对路径以当时的仓库位置 `E:\AI\DeepSeek Harness\Dsh` 为准；仓库已迁至 `E:\Code\dsh-plugin-market`，照抄下面的命令时请换成新路径。
- 验收者：`market-verifier`（独立验收，未修改 `plugin-market/**`；`verify/origin-guard.test.mjs` 由 Lead 提供，属我的写入范围）
- 契约依据：`docs/API-CONTRACT.md`（§5 断言清单 + §1/§2/§3 契约条款）、`docs/TEAM-BRIEF.md`
- 本次验收的实现缺陷结论、8 条工具缺陷、全部原始证据见下文各节。

---

## 1. 结论摘要

| 项 | 值 |
|---|---|
| 本轮运行 id（修复后复验） | `verify-20261003-221755` |
| 本轮断言结果 | **PASS 53 / FAIL 0**（退出码 0） |
| 上一轮运行 id（修复前基线） | `verify-20261003-214407`，PASS 47 / FAIL 0（**不覆盖桌面壳形状**，故未发现线上缺陷） |
| 被测代码 | v1.0.0；`lib/http.js` 的 `isSameOrigin` 为桌面壳修复后的版本；`lib/catalog-npm.js` 为 task-6 镜像优先版本 |
| 独立 DSH_HOME | `E:\AI\DeepSeek Harness\Dsh\_verify\dshhome`（真实 `C:\Users\28062\.dsh` 全程只读） |
| 临时 profile | `_verify\dshhome\profiles\marketcheck`（另有 `chaincheck` / `drill` / `mk1` / `probe1` 为探路遗留） |
| 本轮端口 | `25112, 55343, 55362, 55374`（boot1-4 宿主）＋ fixture 动态端口；**结束全部释放，残留占用 0** |
| 真实抓取耗时 | 冷启动 **527 ms**，count=4412，source=`npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com)` |
| 断言自检 | `selfcheck.ps1` 通过：错误 stub 上 18/18 条契约断言全红、1 条分层诊断断言按预期绿；boot 图好/坏两向 A2/A3/A3b 符合预期 |
| 判定矩阵单测 | `origin-guard.test.mjs` 17/17 通过（已并入验收脚本，断言 id `A5-guard`） |

**新增断言（相对上一轮）**：`A5-session`（已鉴权会话）、`A5a`（桌面壳形状关键回归项，期望已按新契约反转）、`A5c`/`A5d`/`A5e`/`A5f`（外站 Origin / cross-site / 同源 / 同站不同端口）、`A5g`（两层防护分层诊断）、`A5-guard`（判定矩阵单测）——共 7 条。

**遗留风险 3 项**（不阻塞安装，详见 §8）：真实浏览器渲染未断言；官方 URL 兜底最坏 30s；`updateAvailable` 的版本比较只用 fixture 注入值验证过（真实目录里没有对照用的已装包）。

---

## 2. 环境与真实命令（全部实测，非推断）

| 项 | 实测值 |
|---|---|
| dsh CLI | `D:\Software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` |
| 版本 | `dsh --version` → `0.2.0-rc.2` |
| 宿主 Node | `...\runtime\primary-runtime\dependencies\node\bin\node.exe` → `v24.21.0`（undici 7.29.1） |
| 宿主 shell | **Windows PowerShell 5.1.29671.1000**（`pwsh` 不存在，`pwsh` 工具实际跑的是 5.1） |
| profile 与 DSH_HOME | `--profile <name>` 解析为 `$DSH_HOME\profiles\<name>`；**`DSH_HOME` 环境变量被完整尊重** → 用它把整套验收关进 `_verify\` |

真实命令用法（写进交付物，用户可照抄复现）：

```powershell
# 1) 从 shipped web 模板建独立 profile，--dump-config 让它建完即退、不真起宿主
$env:DSH_HOME = 'E:\AI\DeepSeek Harness\Dsh\_verify\dshhome'
dsh --from-default-profile web --profile marketcheck --dump-config
#    产物：package.json（bundles = @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app）
#          cordis.patch.yml / cordis.yml / pnpm-workspace.yaml；无 node_modules

# 2) 装插件（pnpm 11.7.0 透传，本地目录落成 link: 依赖）
dsh plugin --profile marketcheck add "E:\AI\DeepSeek Harness\Dsh\plugin-market"

# 3) 起宿主（--port 0 也可让 OS 挑；--no-open 避免弹浏览器）
cmd /c call "…\bin\dsh.cmd" --profile "marketcheck" --port 1539 --no-open 1>out.log 2>err.log

# 4) 首页鉴权 URL 只从启动日志取（不要猜 token）：
#    http://127.0.0.1:<端口>/?token=<43 字符>
```

三条关键机制（踩过才知道，务必记住）：

1. **`DSH_HOME` 必须每次调用都设**。每次 `pwsh` 都是新进程；漏设会让 CLI 落到真实 `.dsh`。本报告的所有 `dsh` 调用都在 `psi.EnvironmentVariables['DSH_HOME']` 里显式注入。
2. **鉴权是「带 token 的 URL → 303 → Set-Cookie → 带 cookie 取文档」**。HTTP 客户端必须自带 cookie 容器，否则重定向后丢 cookie，首页返回 401。无 token 直连 `/` 返回 **401**（负向对照，证明鉴权确实生效）。
3. **客户端 bundle 路由 `/plugins/??<id>/client.js&rev=<rev>` 按 `pathname+search` 精确查表**：rev 必须取自**同一次 boot** 的 `__DSH_BOOT__`；跨次复用旧 rev 会 404；给它追加 `&token=` 也会 404（键不匹配）。

---

## 3. 断言表

编号约定：`A*` = 契约 §5 与我的补充，`E*` = Lead 指定的额外断言。

| # | 断言 id | 命令（复现用） | 预期 | 实际 | 结论 |
|---|---|---|---|---|---|
| 1 | `A0` | `Get-Content "E:\AI\DeepSeek Harness\Dsh\plugin-market\package.json" -Raw \| ConvertFrom-Json` | JSON 可解析；name=dsh-plugin-market | name=dsh-plugin-market version=1.0.0 | **PASS** |
| 2 | `A10` | `node --check "E:\AI\DeepSeek Harness\Dsh\plugin-market\lib\index.js"` | 两者 exit=0 | host exit=0；client exit=0 | **PASS** |
| 3 | `A9` | `Select-String -Path "E:\AI\DeepSeek Harness\Dsh\plugin-market\lib\client.js" -Pattern 'eval\(','new Function\(' -AllMatches` | eval( 0；new Function( 0；__ModuleLoader__.load >=1；id\s*:\s*["']dsh-plugin-market["'] >=1 | eval(=0 newFunction(=0 ModuleLoaderLoad=1 idMatch=1 clientBytes=103816 | **PASS** |
| 4 | `A0b` | `dsh plugin --profile marketcheck add "E:\AI\DeepSeek Harness\Dsh\plugin-market"` | dsh.profile.bundles 含 dsh-plugin-market；node_modules\dsh-plugin-market 存在 | 安装 exit=True；bundles=[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-plugin-market, @feiyang666/dsh-usage-plugin]；node_modules\dsh-plugin-mar… | **PASS** |
| 5 | `E1` | `Get-Content "E:\AI\DeepSeek Harness\Dsh\_verify\dshhome\profiles\marketcheck\package.json" -Raw` | bundles 含 dsh-plugin-market；node_modules\dsh-plugin-market\cordis.patch.yml 存在且非空 | bundles=[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-plugin-market, @feiyang666/dsh-usage-plugin]；cordis.patch.yml 存在=True；长度=537 | **PASS** |
| 6 | `A1` | `/c call "D:\Software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --profile "marketcheck" --port 25112 --no-open 1>"E:\AI\DeepSeek…` | 端口就绪；日志 FAILED 行 0；无被测包相关报错；无模块解析失败 | ready=True FAILED行=0 被测包报错行=0 模块解析失败行=0 | **PASS** |
| 7 | `E4` | `GET http://127.0.0.1:25110/__reset` | status=200；ok:true；manager.available=true；catalog 为 null；期间 fixture 请求计数 +0 | status=200 ok=True manager.available=True catalog=null fixture请求数=0（期望 0） | **PASS** |
| 8 | `A5-session` | `GET <启动日志里的鉴权 URL>  →  复用返回的 CookieContainer 发后续写请求` | HTTP 200 且拿到 >=1 个会话 cookie | status=200 cookie数=1 | **PASS** |
| 9 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&rev=595c00… | **PASS** |
| 10 | `A3` | `GET http://127.0.0.1:25112/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 11 | `A3b` | `GET http://127.0.0.1:25112/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 12 | `A4a` | `GET http://127.0.0.1:25112/plugin-market/status` | HTTP 200；ok:true；含 plugin/host/manager/catalog 四个字段；Content-Type: application/json；plugin.name=dsh-plugin-market；plug… | status=200 ok=True 缺字段=[] catalog=null(冷启动，符合契约 §2.1)  plugin.name=dsh-plugin-market plugin.version=1.0.0 manager.available=True host.dsh= contentT… | **PASS** |
| 13 | `A4b` | `GET http://127.0.0.1:25112/plugin-market/catalog?query=dsh&pageSize=5` | HTTP 200；ok:true；含 catalog/page/categories/items；page.pageSize=5；items 数 ≤ 5；Content-Type: application/json | status=200 ok=True 缺字段=[] page.page=1 page.pageSize=5 page.total=4200 items=5 categories=23 catalog.count=4412 | **PASS** |
| 14 | `A4c` | `GET http://127.0.0.1:25112/plugin-market/installed` | HTTP 200；ok:true；含 bundles/plugins；bundles 里能找到 name=dsh-plugin-market | status=200 ok=True 缺字段=[] bundles=12 含市场自身=1 plugins=188 | **PASS** |
| 15 | `A5a` | `POST http://127.0.0.1:25112/plugin-market/install  # 不带 Origin / Sec-Fetch-Site，但复用已鉴权会话 cookie；body={"name":"evil/not-in-catalog-pkg","s…` | 不得判为 cross-origin；必须进到业务逻辑 → HTTP 400 error.code=not-in-catalog | status=400 error.code=not-in-catalog（若为 403 cross-origin 即线上缺陷复现） | **PASS** |
| 16 | `A5c` | `POST http://127.0.0.1:25112/plugin-market/install  Origin: https://evil.example  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-…` | HTTP 403；error.code=cross-origin；hint 里如实出现 Origin=https://evil.example | status=403 error.code=cross-origin hint含Origin信号=True hint=市场只接受来自本页面的写请求。本次收到：Origin=https://evil.example、Sec-Fetch-Site=（无）、来源地址=127.0.0.1。在本页内重试… | **PASS** |
| 17 | `A5d` | `POST http://127.0.0.1:25112/plugin-market/install  Sec-Fetch-Site: cross-site  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-in…` | HTTP 403；error.code=cross-origin | status=403 error.code=cross-origin | **PASS** |
| 18 | `A5e` | `POST http://127.0.0.1:25112/plugin-market/install  Origin=http://127.0.0.1:25112  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not…` | 不得判为 cross-origin；必须走到 HTTP 400 error.code=not-in-catalog | status=400 error.code=not-in-catalog | **PASS** |
| 19 | `A5f` | `POST http://127.0.0.1:25112/plugin-market/install  Origin: http://127.0.0.1:3000  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not…` | HTTP 403；error.code=cross-origin | status=403 error.code=cross-origin | **PASS** |
| 20 | `A5g` | `POST http://127.0.0.1:25112/plugin-market/install  # 不带会话 cookie、不带 Origin；body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-in-cat…` | 要么非 403（宿主信任层未拦），要么是 403 且 body 为空；若出现插件形状的 JSON 403，说明插件在收无 cookie 请求，需重新定性 | status=400 body长度=107 属宿主信任层=False body前80字={"ok":false,"error":{"code":"not-in-catalog","message":"这个插件不在目录里，已拒绝安装。","hint" | **PASS** |
| 21 | `A5b` | `GET http://127.0.0.1:25112/plugin-market/install` | HTTP 405；error.code=method-not-allowed；响应头 Allow 含 POST | status=405 error.code=method-not-allowed Allow=POST | **PASS** |
| 22 | `A6` | `POST http://127.0.0.1:25112/plugin-market/install  Origin=http://127.0.0.1:25112  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not…` | HTTP 400；error.code=not-in-catalog（安全约束：只允许装目录内插件） | status=400 error.code=not-in-catalog message=这个插件不在目录里，已拒绝安装。 hint=市场只允许安装目录内的插件；先刷新目录再试。 | **PASS** |
| 23 | `A7` | `POST http://127.0.0.1:25112/plugin-market/remove  Origin=http://127.0.0.1:25112  body={"name":"dsh-plugin-market"}` | HTTP 400；error.code=not-allowed；message 给出终端替代命令 | status=400 error.code=not-allowed message=市场不能卸载自己，请在终端执行 dsh plugin --profile marketcheck remove dsh-plugin-market | **PASS** |
| 24 | `A8a` | `GET http://127.0.0.1:25112/plugin-market/catalog ; Start-Sleep 2 ; GET http://127.0.0.1:25112/plugin-market/catalog` | 两次 catalog.fetchedAt 相同且非空（TTL 10 分钟内不应重新抓取） | status#1=200 fetchedAt#1=2026-10-03T14:18:05.007Z ; status#2=200 fetchedAt#2=2026-10-03T14:18:05.007Z | **PASS** |
| 25 | `A8b` | `POST http://127.0.0.1:25112/plugin-market/refresh  Origin=http://127.0.0.1:25112` | HTTP 200；ok:true；fetchedAt 与刷新前紧邻一次（fa2）不同且非空 | status=200 ok=True fetchedAt#3=2026-10-03T14:18:07.674Z（刷新前紧邻 fa2=2026-10-03T14:18:05.007Z，更早 fa1=2026-10-03T14:18:05.007Z） | **PASS** |
| 26 | `A14a` | `POST http://127.0.0.1:25112/plugin-market/install  headers=Origin  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-in-catalog-pkg…` | 不返回 403 cross-origin；应继续走到 400 not-in-catalog | status=400 error.code=not-in-catalog | **PASS** |
| 27 | `A14b` | `POST http://127.0.0.1:25112/plugin-market/install  headers=Sec-Fetch-Site  body={"name":"evil/not-in-catalog-pkg","spec":"evil-not-in-cat…` | 不返回 403 cross-origin；应继续走到 400 not-in-catalog | status=400 error.code=not-in-catalog | **PASS** |
| 28 | `A12` | `GET http://127.0.0.1:25112/plugin-market/definitely-not-a-route` | HTTP 404；error.code=not-found | status=404 error.code=not-found | **PASS** |
| 29 | `A13` | `POST http://127.0.0.1:25112/plugin-market/install  70000 字节 name 字段` | HTTP 400；error.code=bad-request | status=400 error.code=bad-request | **PASS** |
| 30 | `A15` | `POST http://127.0.0.1:25112/plugin-market/toggle  Content-Type: application/x-www-form-urlencoded  Origin=http://127.0.0.1:25112  body=na…` | HTTP 400；error.code=bad-request（同源已放行，所以失败原因必须是 Content-Type） | status=400 error.code=bad-request | **PASS** |
| 31 | `A5-guard` | `node "E:\AI\DeepSeek Harness\Dsh\verify\origin-guard.test.mjs"` | exit=0；输出含「isSameOrigin 判定矩阵：17/17 通过」与「全部通过」 | exit=0 含17/17=True | **PASS** |
| 32 | `E6` | `GET http://127.0.0.1:25110/__count   # 此前走过 A4b 首次 /catalog、A8a 两次 /catalog、A8b 一次 /refresh` | count == 2（首次抓取 1 + refresh 1；期间所有 /catalog 均命中缓存） | fixture 请求计数=2（期望 2） | **PASS** |
| 33 | `E5-local` | `GET http://127.0.0.1:25112/plugin-market/catalog` | HTTP 200；ok:true；catalog.count 在 4412±0；catalog 含 count/updated/fetchedAt/source/stale；categories 非空；items[0] 含 id/na… | status=200 ok=True catalog.count=4412（期望 4412±0）catalog 缺字段=[] source=http://127.0.0.1:25110/plugins.json updated=2026-10-01 stale=False fetchedAt=… | **PASS** |
| 34 | `A11` | `node "E:\AI\DeepSeek Harness\Dsh\verify\adversarial-host.mjs" "E:\AI\DeepSeek Harness\Dsh\plugin-market\lib\index.js"` | exit=0；apply 不抛；/status 报 manager.available=false；/installed 返回空集合；安装类 POST 报 manager-unavailable | exit=0 | **PASS** |
| 35 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&rev=595c00… | **PASS** |
| 36 | `A3` | `GET http://127.0.0.1:55343/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 37 | `A3b` | `GET http://127.0.0.1:55343/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 38 | `E8-low` | `GET http://127.0.0.1:55343/plugin-market/installed  →  bundles[] 中 name=@feiyang666/dsh-usage-plugin` | 该 bundle 的 latest=1.0.0，updateAvailable=false | 找到=True 已装版本=1.18.0 latest=1.0.0 updateAvailable=False（期望 false） | **PASS** |
| 39 | `E8-market` | `GET http://127.0.0.1:55343/plugin-market/installed  →  bundles[] 中筛选 market === true` | 恰好 1 条 market:true，且其 name === dsh-plugin-market | market:true 条数=1 name=dsh-plugin-market | **PASS** |
| 40 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&rev=595c00… | **PASS** |
| 41 | `A3` | `GET http://127.0.0.1:55362/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 42 | `A3b` | `GET http://127.0.0.1:55362/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 43 | `E8-high` | `GET http://127.0.0.1:55362/plugin-market/installed  →  bundles[] 中 name=@feiyang666/dsh-usage-plugin` | 该 bundle 的 latest=9.9.9，updateAvailable=true | 找到=True 已装版本=1.18.0 latest=9.9.9 updateAvailable=True（期望 true） | **PASS** |
| 44 | `E8-market` | `GET http://127.0.0.1:55362/plugin-market/installed  →  bundles[] 中筛选 market === true` | 恰好 1 条 market:true，且其 name === dsh-plugin-market | market:true 条数=1 name=dsh-plugin-market | **PASS** |
| 45 | `A2` | `GET <启动日志里的鉴权 URL>  →  解析 globalThis["__DSH_BOOT__"]  →  entries[] 中找 id === 'dsh-plugin-market'` | 存在该 entry；url 形如 plugins/??dsh-plugin-market/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受） | httpStatus=200 htmlLen=35348 shape=globalThis["__DSH_BOOT__"] entries=67 batches=3 entry=found url=plugins/??dsh-plugin-market/client.js&rev=595c00… | **PASS** |
| 46 | `A3` | `GET http://127.0.0.1:55374/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f` | HTTP 200；正文含 __ModuleLoader__.load 且含 id:"dsh-plugin-market" | status=200 bytes=110971 hasModuleLoaderLoad=True hasId=True | **PASS** |
| 47 | `A3b` | `GET http://127.0.0.1:55374/plugins/??dsh-plugin-market/client.js&rev=595c001c1b5f  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索…` | 解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码） | utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0 | **PASS** |
| 48 | `E7-fetch` | `Measure-Command { GET http://127.0.0.1:55374/plugin-market/catalog }   # 该宿主 boot 后第一次 /catalog` | HTTP 200；ok:true；端到端耗时 < 3000ms | status=200 耗时=527ms source=npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com) count=4412 | **PASS** |
| 49 | `E5` | `GET http://127.0.0.1:55374/plugin-market/catalog` | HTTP 200；ok:true；catalog.count 在 4412±50；catalog 含 count/updated/fetchedAt/source/stale；categories 非空；items[0] 含 id/n… | status=200 ok=True catalog.count=4412（期望 4412±50）catalog 缺字段=[] source=npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com) updated=2026-… | **PASS** |
| 50 | `E5-env` | `node "E:\AI\DeepSeek Harness\Dsh\verify\lib\netdiag.mjs" "https://awesome-dsh-plugin.com/plugins.json" 120000` | 耗时 > 15000ms 或直接失败 ⇒ 502 catalog-unavailable 是源可达性/超时预算问题，不是路由逻辑问题 | ok=True ms=65114 bytes=5298280（契约单次预算 15000ms） | **PASS** |
| 51 | `E9` | `记录本次跑过的每条 --profile 目标（profile 初始化 / 两次 dsh plugin add / 4 次 dsh web 启动）` | 所有 --profile 目标均为 marketcheck；不出现 desktop 或 web；DSH_HOME 指向 _verify 内的独立目录 | 调用次数=6 目标集合=[marketcheck] 命中 desktop/web=0 DSH_HOME=E:\AI\DeepSeek Harness\Dsh\_verify\dshhome | **PASS** |
| 52 | `E9-info-pkg` | `Get-FileHash "C:\Users\28062\.dsh\profiles\desktop\package.json" -Algorithm SHA256   # 前后各一次` | 记录前后哈希与内容，供 Lead 复核；本条不作通过判据（该 profile 同时被 GUI 会话持有） | before=174CBD943FB6091E037E2D69ED557ACB85E2C29C1C7C781A01C0363C10935A7D after=174CBD943FB6091E037E2D69ED557ACB85E2C29C1C7C781A01C0363C10935A7D chan… | **PASS** |
| 53 | `E9-info` | `Get-FileHash "C:\Users\28062\.dsh\profiles\desktop\cordis.patch.yml" -Algorithm SHA256   # 前后各一次` | 记录前后哈希与内容差异，供 Lead 按内容定性；本条不作通过判据 | before=5B9826E192DDD9052754DC36AFA972A8E90F40A0A77C2400E662FD87899CE642 after=5B9826E192DDD9052754DC36AFA972A8E90F40A0A77C2400E662FD87899CE642 chan… | **PASS** |

### 3.1 Lead 指定 10 条的对应关系

| Lead 要求 | 对应断言 id | 结果 |
|---|---|---|
| 1 安装断言（bundles 含包 + `cordis.patch.yml` 存在） | `A0b` + `E1` | PASS |
| 2 boot graph 含 entry 且真 GET 到脚本 | `A2` + `A3` | PASS（4 次 boot 各测一遍） |
| 3 bundle UTF-8 解码含「插件市场」 | `A3b` | PASS，U+FFFD 个数 0 |
| 4 `/status` 冷启动 `manager.available=true`、`catalog=null`、零网络抓取 | `E4` | PASS（用 fixture 计数器实测抓取次数 = 0） |
| 5 `/catalog` 真实抓取内容 | `E5` + `E5-local` + `E7-fetch` | PASS，count=4412，23 个分类，items[0] 字段齐全 |
| 6 缓存行为 | `A8a` + `A8b` + `E6` | PASS（`E6` 用请求计数证明整轮只抓 2 次） |
| 7 越权与错误路径 | `A5-session` `A5a` `A5b` `A5c` `A5d` `A5e` `A5f` `A5g` `A5-guard` `A6` `A7` `A12` `A13` `A15` `A14a/b` | PASS（§5.5 已按新契约重写并加桌面壳回归项，见 §11） |
| 8 `updateAvailable` 双向 + `market:true` | `E8-low` `E8-high` `E8-market` | PASS |
| 9 不碰真实 profile | `E9` | PASS（改为断言「我的调用目标」而非哈希相等，理由见 §7） |
| 10 收尾释放 | 每次 run 的 cleanup 段 | PASS，4/4 端口释放，残留占用 0 |

### 3.2 `E4` / `E6` 的证据强度（比 Lead 预设的退路更强）

Lead 允许「无法观测抓取次数就退而求其次」。实际可观测：把 `DSHM_REGISTRY_URL` 指向本地计数 fixture，用 `/__count` 直接读真实请求数。

- `E4`：`/__reset` → `GET /status` → `/__count`。结果 `{"count":0}`，即**冷启动零网络抓取**，同时 `catalog=null`。
- `E6`：整轮 §5.4–§5.8 结束后 `/__count` = `{"count":2}`。期望值推导：`A4b` 首次 `/catalog` 触发 1 次抓取；`A8a` 两次 `/catalog` 命中缓存；`A8b` 一次 `/refresh` 触发第 2 次。**缓存没有被任何一次多余请求击穿。**

### 3.3 每个 4xx/5xx 断言都有双客户端交叉复核

所有带错误码的断言，正文同时由 `System.Net.HttpWebRequest`（主）与 `curl.exe`（独立第二实现）各读一遍并写入证据。例：

```
A6 主探针：status=400 error.code=not-in-catalog message=这个插件不在目录里，已拒绝安装。 hint=市场只允许安装目录内的插件；先刷新目录再试。
A6 curl  ：status=400 body={"ok":false,"error":{"code":"not-in-catalog","message":"这个插件不在目录里，已拒绝安装。","hint":"市场只允许安装目录内的插件；先刷新目录再试。"}}
```

这样「错误码是空的」只可能是实现没给，不可能是工具没读到。

---

## 4. 首轮 10 条失败的逐条定性

首轮（run `verify-20261003-211745`）29 PASS / 10 FAIL。逐条定性与复核结果如下 —— **8 条是我的工具 bug，1 条是我的断言过期，1 条是真实缺陷**。

| 断言 id | 首轮现象 | 判定 | 原始证据 | 修正后结果 |
|---|---|---|---|---|
| `A4a` | `ok=True 缺字段=[catalog]`，status=200 | **我的断言过期** | 契约 §2.1 规定冷启动 `catalog` 必须是 `null`（首屏不发网络请求）。我把「值为 null」当成「字段缺失」 | PASS：`catalog=null(冷启动，符合契约 §2.1)` |
| `A5a` | `status=403 error.code=` | **我的工具 bug** | PS 5.1 `Invoke-WebRequest` 在 4xx 时抛异常且响应流已被读走/释放，`$_.Exception.Response.GetResponseStream()` 只能得到空正文；`ErrorDetails.Message` 在 5.1 不可靠 | PASS：`error.code=cross-origin`（主探针与 curl 一致） |
| `A5b` | `status=405 error.code= Allow=POST` | 同上 | 头读到了、正文没读到 → 定位到「只有正文路径坏了」 | PASS：`error.code=method-not-allowed` |
| `A6` | `status=400 error.code= message=` | 同上 | — | PASS：`error.code=not-in-catalog` + 中文 message/hint |
| `A7` | `status=400 error.code= message=` | 同上 | — | PASS：`error.code=not-allowed` + 给出终端替代命令 |
| `A12` | `status=404 error.code=` | 同上 | — | PASS：`error.code=not-found` + 可用接口清单 |
| `A13` | `status=400 error.code=` | 同上 | — | PASS：`error.code=bad-request` |
| `A14c` | `status=403 error.code=` | 同上 | 对照：`A14a/A14b` 首轮 **PASS**（它们只需判「不是 cross-origin」，不读正文）—— 正好反证故障点在「读 4xx 正文」 | PASS：`error.code=cross-origin` |
| `A15` | `status=400 error.code=` | 同上 | — | PASS：`error.code=bad-request` |
| `E5` | `status=502`，`source` 空，count 空 | **真实缺陷（源可达性）** | 官方源 `awesome-dsh-plugin.com` 直连：`E5-env` 实测 **32368–93075 ms**（契约 §3 单次预算 15s、重试 1 次共 30s）→ 必然 502。@lead 实测 npmmirror 289 ms | 已由 task-6 修复（源顺序 npmmirror → npmjs → 官方）；修复后 PASS，`E7-fetch`=550 ms |

> 说明：`A5a` 这 8 条的**状态码首轮就是对的**（403/405/400/404），只有正文读不到。这正是「工具没读到」与「实现没给」的唯一区分点，也是我后来给每条错误断言都加 curl 交叉复核的原因。

---

## 5. 工具缺陷与修正

验收报告承认测量工具的缺陷，比只报 29/39 更有价值。共发现并修掉 7 条，每条都写「怎么发现 / 怎么修 / 修后结论」。

### 5.1 `AppendAllText 非法字符` —— 根因是 PowerShell 动态作用域，不是路径内容

- **怎么发现**：chain drill 跑到 A2 时整轮中断：`使用"3"个参数调用"AppendAllText"时发生异常:"路径中具有非法字符。"`。Lead 初判为「把含 `?`/`&`/`:` 的内容当路径追加了」。
- **真实根因**（我复核后推翻初判）：**PowerShell 是动态作用域，脚本块里的变量按「调用时的调用栈」解析，而不是定义处**。断言函数 `EmitBoot` 有一个参数 `$Evidence`，而我的收集器脚本块里引用了证据路径变量 `$evidence`——变量名大小写不敏感，于是 `$evidence` 被解析成参数 `$Evidence`，即**断言文本**，再去当文件路径 → 非法字符。
  - 直接证据：首轮崩溃前 A0/A9/A10/A1 的 `Add-Evidence` 都成功（它们不经过 `EmitBoot`），只有经 `EmitBoot` 的 A2 崩。
- **怎么修**：(1) 断言函数参数改名为 `$EvidenceText`，不再与 `$evidence` 同名；(2) 证据路径统一用 `$script:evidencePath` 显式限定作用域；(3) `Add-Evidence` 加路径校验，失败只记警告、**绝不允许证据记录本身弄死整轮验收**。
- **修后结论**：证据文件完整写入，47 条断言的原始输出全部落盘。

### 5.2 PS 5.1 的 `Invoke-WebRequest` 读不到 4xx 正文

- **怎么发现**：9 条断言 `error.code` 全空，但状态码全对。
- **怎么修**：`Invoke-HttpProbe` 整体改用 `System.Net.HttpWebRequest`（异常路径下 `WebException.Response` 的流是完整可读的），二进制读取后自行 UTF-8 解码（不依赖响应头 charset，顺带把中文乱码风险测实）；并新增 `Invoke-CurlProbe`，所有错误码断言附 `curl.exe` 独立复核。
- **修后结论**：8 条全部转绿且两个客户端正文一致。

### 5.3 `A4a` 断言漂移（契约 §2.1 已改）

- **怎么发现**：`/status` 报 `缺字段=[catalog]`，但同一轮 `E4` 明确要求冷启动 `catalog=null`——两条断言自相矛盾。
- **怎么修**：新增 `Test-PropExists` 区分「字段不存在」与「字段值为 null」；`A4a` 改为「`catalog` 字段必须存在，值为 `null` 或含 `source/count/updated/fetchedAt/stale` 的对象」。
- **修后结论**：PASS，且契约两种状态都被覆盖。

### 5.4 我在修 5.2 时自己引入的回归：丢 cookie 导致首页 401

- **怎么发现**：改用 `HttpWebRequest` 后，`A2/A3/A3b` 由 PASS 变 FAIL，`httpStatus=401`。
- **怎么修**：`HttpWebRequest` 不像 `Invoke-WebRequest` 会自动建 cookie 容器；显式 `$req.CookieContainer = New-Object System.Net.CookieContainer`，重定向后 cookie 才能带到文档请求。
- **修后结论**：首页 200、boot 图可解析、无 token 仍 401。

### 5.5 `curl.exe` 交叉复核自己把 JSON 正文改坏了

- **怎么发现**：`A6`/`A7` 的 curl 复核返回 `bad-request`（"请求体不是合法的 JSON"），与主探针的 `not-in-catalog`/`not-allowed` 不一致。原因：PS 5.1 往 `curl.exe` 传含引号/大括号的 JSON 字符串时命令行引号被剥掉。
- **怎么修**：正文写入临时文件，用 `--data-binary @<file>` 传递；两个临时文件都在 `finally` 里清理。
- **修后结论**：curl 与主探针正文逐字一致（`A6`/`A7`/`A13`/`A15` 已复核）。**如果没修，这条「独立复核」反而会制造假证据。**

### 5.6 一批 PowerShell 5.1 特有的坑（都已修）

| 坑 | 症状 | 修法 |
|---|---|---|
| `write` 出来的是 LF-only，5.1 按 ANSI 解码无 BOM 的 UTF-8 | 中文注释末尾字节吞掉 `\n`，注释吃掉下一行 → 解析失败 | 所有 `.ps1` 统一加 UTF-8 BOM 并归一化 CRLF（`lib/add-bom.ps1`，附 `ParseFile` 零错误校验） |
| `ProcessStartInfo.ArgumentList` / `.Environment` 在 .NET Framework 不存在 | 起宿主直接失败 | 改用 `Arguments` 字符串 + `EnvironmentVariables` |
| `.cmd` 不能被 `CreateProcess` 直接执行 | — | 统一 `cmd.exe /c call "<x.cmd>" … 1>out 2>err` |
| `[string]$Body = $null` 不给值时是 `''` | GET 会被附上空正文 → `无法发送具有此谓词类型的内容正文` | 判 `IsNullOrEmpty` |
| `Set-StrictMode -Version Latest` 下裸取 `.Response` | 非 WebException 上抛 `PropertyNotFoundException`，把 4xx 探测变成工具崩溃 | 类型判断 + 沿 `InnerException` 链查找 |
| `return @()` 被展开成「无输出」 | 调用方拿到 `$null`，`.Count` 崩 | `Get-ArrayProp` 用 `return ,@()` |
| `$args` 是自动变量 | wrapper 里 `$args = @()` 赋值无效，`-SkipLive` 被当成 `-PluginDir` 的值 | 改用 `$forward` |
| `$Profile` / `$Evidence` 等与自动变量、被调用方参数同名 | 见 5.1 | 命名规避 + `$script:` 限定 |

### 5.7 断言自检（selfcheck）证明断言本身可信

`verify/selfcheck.ps1` 把同一套断言函数指向**故意违反契约的 stub**，并断言：

1. 18 条契约类断言**全部 FAIL**（不能有「意外 PASS」——那说明断言无效）；
2. 1 条分层诊断断言（`A5g`）按预期 PASS——它判的是「这是哪一层的 403」，不是契约判据，硬要求它红反而是把诊断当判据；
3. boot 图「好/坏」两向：A2/A3/A3b 必须一绿一红；
4. **FAIL 要有道理**：`A6` 必须读到 `error.code=cross-origin`、`A5c` 必须读到 `internal`，且 curl 复核正文里也有同样的码。

第 4 条是补强——**没有它，首轮那 9 条「因为读不到正文而 FAIL」会被自检误判为「断言有效」**。selfcheck 现为 PASS。

自检抓出过的真问题：`A8b` 原先与「最早一次」而非「紧邻上一次」的 `fetchedAt` 比较（假阳性，已改为与 `fa2` 比较）；boot 断言里 `'…' + $AssertId + '"'` 在**参数模式**下 `+` 不是运算符，参数错位导致 `[bool]$Pass` 收到字符串（已加括号）；wrong-stub 用 `origin === 'http://evil.example'` 全等匹配，而断言侧发的是 `https://evil.example`，导致 `A5c` 落到别的分支、正文变空（已改为按主机名 `includes` 匹配）——**这条是自检自己抓出来的：一致性检查发现「A5c 读不到 error.code」，才暴露出 stub 匹配写窄了。**

### 5.8 不带 cookie 测写接口会测错层（本轮新增的工具缺陷）

- **怎么发现**：Lead 在定性线上 403 时指出——宿主的写接口有**两层**防护，不区分就会测错层：
  - **第 1 层 宿主信任层**：未带会话凭据的请求会被它以**空 body 403** 拦掉，根本到不了插件；
  - **第 2 层 插件守卫 `isSameOrigin`**：只有进到插件里的请求才由它判定来源。
  我此前所有 POST 断言都是**每次新建 CookieContainer**、不复用会话，等于在没有会话的前提下测守卫。那时拿到的 403 究竟是哪一层，无法自证。
- **怎么修**：
  1. `Invoke-HttpProbe` 增加 `-CookieContainer`，可让多个请求落在同一条会话上；
  2. 新增 `New-AuthSession`（GET 带 token 的 URL → 303 → Set-Cookie → 复用容器），并在 boot 后立刻建立会话，断言 `A5-session` 要求「200 且拿到 ≥1 个会话 cookie」；
  3. `Invoke-MarketRouteChecks` 增加 `-Session`，§5.5 的写接口断言全部走已鉴权会话，curl 交叉复核也带上同一 cookie；
  4. 新增 `A5g` 把「未鉴权那一发」单独记成诊断：只允许出现「非 403」或「403 且 body 为空」两种形态，**若出现插件形状的 JSON 403 就要重新定性**。
- **本轮实测（诚实记录，与预期不同）**：在我这套 `dsh web` scratch profile 里，未鉴权写请求 **status=400 且 body 长度 107**，即**到达了插件的业务逻辑**——说明这个配置下宿主信任层**并没有**拦 `/plugin-market/*`。所以「两层」在本环境里只有第 2 层实际生效；A5g 因此判 PASS（形态合规）。
  结论不变：会话化测量是必须的（契约 §5.5 已把它写成前提），因为在桌面壳/其它配置下第 1 层确实存在，而**不分层就无法判断 403 来自谁**。这条也已写进 `lib/MarketChecks.ps1` 的头部说明。

---

## 6. E5 从 FAIL 到 PASS

保留原始失败记录，不粉饰。

**失败记录（run `verify-20261003-211745` / `213010`）**

```
E5 预期: HTTP 200；ok:true；catalog.count 在 4412±50；categories 非空；items[0] 字段齐全
E5 实际: status=502 ok= catalog.count= categories=1 items=1 source=
```

**根因（两条独立证据）**

1. `E5-env`：`node netdiag.mjs https://awesome-dsh-plugin.com/plugins.json 120000` → `ok=True ms=32368 bytes=5298280`；另一轮 `ms=93075`。契约 §3 单次预算 `AbortSignal.timeout(15000)` + 重试 1 次 = 30s 总预算，**必然超时** → `502 catalog-unavailable` 是**契约内正确的降级行为**，不是路由逻辑错误。
2. 对照：同一台机器用 PowerShell（走系统代理 `127.0.0.1:7890`）9.8s 可下载；Node 直连 57–93s。@lead 另测 npmmirror 289 ms。

**修复（task-6，已落地）**：源顺序改为 npmmirror → npmjs → 官方 URL；`DSHM_REGISTRY_URL` 非空则只用它。

**修复后（run `verify-20261003-214407`）**

```
E7-fetch: status=200 耗时=550ms source=npm:dsh-plugin-catalog@2026.1003.4803 (registry.npmmirror.com) count=4412
E5      : status=200 ok=True catalog.count=4412 catalog 缺字段=[] source=npm:dsh-plugin-catalog@2026.1003.4803
          updated=2026-10-01 stale=False categories=23 items=24
E5-env  : ok=True ms=32368（官方源直连仍然超预算 → 保留该条断言，作为「为什么需要镜像优先」的常驻证据）
```

`E5-env` 保留并**期望 PASS**，语义是「Node 直连官方源超过契约预算」——它证明镜像优先不是可选优化而是必需。`E5`（真实源 200 + 内容齐全）与 `E5-local`（未改动的 4412 条快照，不注入、count 严格 =4412）同时绿，说明内容正确性不依赖网络路径运气。

---

## 7. 真实 profile（desktop）—— 我改了什么，别人改了什么

**E9 的断言被重新设计过**，这一点必须先说清：

- 最初写成「验收前后 desktop `package.json` / `cordis.patch.yml` SHA256 一致」。**这是竞态断言，无效**：真实 `desktop` profile 同时被运行中的 GUI 与 Lead 会话持有，验收窗口内确实被外部改动过。
- 改为断言**可归因于我自己的事实**：本次每一条 `dsh` 调用都指向自建 profile。实测 `调用次数=6 目标集合=[marketcheck] 命中 desktop/web=0 DSH_HOME=E:\...\_verify\dshhome`。代码层还有硬约束：`Invoke-DshPlugin` 遇到 `Profile=desktop|web` 直接 throw。
- 前后指纹降级为信息性记录（`E9-info-pkg` / `E9-info`），如实呈现，不作通过判据。

**真实 desktop profile 在验收窗口内的变化（外部会话所为，非本工具）**

| 时间 | 文件 | 变化 | 归因证据 |
|---|---|---|---|
| 21:31:48 | `cordis.patch.yml` 933B → 1429B | 新增 `llm-pi-ai`（provider `xiaomi`，`apiKeyEnv: XIAOMI_API_KEY`）与 `permission`（presets + `defaultPreset: workspace-write`）两条 setting | 内容是设置形状（provider/preset），不是插件安装形状；`.plugin-manager\logs` 在 20:39:34 之后**没有**新增 `operation-*` |
| 21:32:25 | `cordis.yml` 45453→45433B、`pnpm-lock.yaml`、`node_modules`、`.plugin-manager` | 出现 `operation-HWxeu3` → 有一次真实 plugin-manager 操作 | 该 operation 目录非我创建；我本轮所有 plugin 操作都在 `_verify\dshhome` |
| 21:38:35 | `package.json` 441B → 419B | **移除** `@feiyang666/dsh-usage-plugin` 依赖与 bundle 行；**加入** `@deepseek-ai/dsh-experimental-voice-input-bundle`、`@deepseek-ai/dsh-experimental-schedule-bundle` | 时间点落在我的 Boot#3 与 Boot#4 之间；该操作需要 GUI/Lead 会话发起；`dsh-plugin-market` **未**出现（task-4 尚未执行） |

**SHA256 记录（供 Lead 安装前复核）**

| 文件 | 我第一次取到 | 最终取到 | 说明 |
|---|---|---|---|
| `desktop\package.json` | `A93EF6A5CAFDE6EEFCEE453BA60B4A254EC73800E49D7C6B4305484EA6FEA541`（441B，含 usage 依赖） | `6413CC433FE384E38979E4AFBA5A8208B753DADC526DDFC47A370120CCAB8AA3`（419B，已换 bundle） | 变化由外部会话造成，见上表 |
| `desktop\cordis.patch.yml` | `6732274A026DAE9720C12B98905BE09DF1A1BC04B05BA15CB144D8568FECF04C` → 21:31:48 后 `29C08D0FDAD957860DC55F2B7159884D8C823819EF0911C8D22843A7424DA125` | `29C08D0FDAD957860DC55F2B7159884D8C823819EF0911C8D22843A7424DA125`（1429B，最后两轮未再变） | 同上 |

**真实 DSH_HOME 的 profile 目录**：只有 `desktop` 与 `web`（探路时误建的 `__nonexistent__` 与 desktop 下 0 字节的 `operation-b6F62n` 已在 21:02 清理，并向 Lead 报告）。

---

## 8. 未覆盖项 / 已知偏差

| 项 | 说明 |
|---|---|
| **未在真实浏览器里断言渲染结果** | 我验证到「bundle 被 boot 图引用、可 200 取到、按 UTF-8 解码中文完整、无 `eval(`/`new Function(`、含正确 `id`」为止。侧边栏底部入口的实际渲染/选中态/窄屏行为未断言 —— 那需要 Lead 的整窗截图核对（task-4）。 |
| 官方 URL 兜底最坏 ~30s | 契约 §3 的 15s×2 预算下，若镜像与 npmjs 同时不可用，用户会等满 30s 才看到 `catalog-unavailable`。这是契约规定值，不是实现偏差；作为风险记录。 |
| `updateAvailable` 只用注入值验证 | 真实目录里没有 `@feiyang666/dsh-usage-plugin`（唯一 feiyang 命中是别人的 `dsh-settings-drawer`），所以两个方向都用 fixture 注入版本（1.0.0 / 9.9.9 vs 已装 1.18.0）验证。逻辑正确性已验证，但**未用真实目录里的真实版本差**验证过。 |
| `install` / `remove` / `toggle` 的成功路径未端到端跑 | 契约 §5 只要求错误路径（403/405/400）。成功安装会真的改 profile 并跑 pnpm，影响面大，未在本轮触发；`A6` 已证明「目录外 spec 被拒」这一安全约束有效。 |
| `POST /install` 的 `pendingBuilds` 确认流未验证 | 需要真实触发构建脚本批准，未构造。 |
| `host.dsh` 取值为空 | `A4a` 实测 `host.dsh=`（空串）。契约 §2.1 允许 `ctx.get('profileContext')` → `DSH_VERSION` → `null` 的取值顺序；本轮宿主两者都没有，故为空。不影响 §5 断言，但记录为观察值。 |

---

## 9. 交付物与复现方式

### 9.1 交付物清单

| 路径 | 作用 |
|---|---|
| `scripts/verify-market.ps1` | **入口**：`-SelfCheck` / `-SkipLive` / `-SkipAdversarial` / `-KeepHosts` / `-PluginDir` |
| `verify/verify-market.ps1` | 验收编排：4 次 boot（fixture 未注入 / 注入低版本 / 注入高版本 / 真实源） |
| `verify/selfcheck.ps1` | 断言自检：错误 stub 上全红 + boot 图好/坏两向 + 交叉复核一致性 |
| `verify/lib/Common.ps1` | 工具库：找空闲端口、起/杀宿主、鉴权 URL、`__DSH_BOOT__` 解析、HTTP 探针（HttpWebRequest + curl 双实现）、断言框架、证据记录 |
| `verify/lib/BootChecks.ps1` | §5.2/§5.3 + UTF-8 编码断言（A2/A3/A3b） |
| `verify/lib/MarketChecks.ps1` | §5.4–§5.8 + 越权/错误路径（A4a…A15） |
| `verify/lib/ExtraChecks.ps1` | Lead 指定的 E1/E4/E5/E8 |
| `verify/lib/stub-server.mjs` | 故意违反契约的 stub（wrong-market / boot 好图坏图） |
| `verify/lib/catalog-fixture.mjs` | 受控目录源：只读 4412 条快照 + 请求计数 + 可注入版本 |
| `verify/lib/netdiag.mjs` | Node 直连目录源的耗时测量 |
| `verify/adversarial-host.mjs` | 假 cordis ctx（无 `pluginManager`）驱动 host 半，断言不抛未捕获异常 |
| `verify/lib/add-bom.ps1` | 给 .ps1 加 UTF-8 BOM + CRLF 并做零错误解析校验 |
| `verify/drill-boot.ps1` | 起宿主/取鉴权/抓首页的链路演练（与实现无关） |
| `verify/REPORT.md` | 本报告 |
| `_verify/logs/verify-20261003-214407.evidence.log` | **最终轮全部原始输出**（每条断言的命令/预期/实际/正文） |
| `_verify/logs/verify-20261003-214407.summary.json` | 机器可读断言结果 |
| `_verify/dshhome/profiles/marketcheck` | 临时 profile（独立 DSH_HOME 内） |

> **后记（2026-10-06 仓库清理）**：上表写作 `_verify/logs/…` 的两份证据文件实际一直位于
> `verify/logs/`（`LogDir` 自初提交起就是 `verify/logs`，表中路径是当时的笔误）；`_verify/logs`
> 下只剩探针残留（`a.ps1` / `t.*` / `reloadcheck-*` 等），连同 `chaincheck` / `drill` / `mk1` /
> `probe1` 探路 profile 一并在仓库清理时删除（`drill` 会在下次跑 `drill-boot.ps1` 时自动重建）。
> `verify/logs` 的证据文件、`marketcheck` profile 全部保留。

### 9.2 复现命令

```powershell
cd 'E:\AI\DeepSeek Harness\Dsh'

# 断言自检（快，不联网）——应先跑这个，确认测量工具可信
pwsh -File scripts/verify-market.ps1 -SelfCheck

# 完整验收（4 次 boot；含真实源，约 3–5 分钟）
pwsh -File scripts/verify-market.ps1

# 离线版（跳过真实源那一段）
pwsh -File scripts/verify-market.ps1 -SkipLive

# —— v1.1.x 新增的验证（都不在验收主脚本里，理由见 §12.9）——
node verify/self-update.test.mjs         # 自更新通道离线回归（32 条）
node verify/client-copy.test.mjs         # 文案键集 + 动效写法不变量（13 条）
pwsh -File verify/ui-check.ps1           # 真实浏览器（headless Edge + CDP），出截图
pwsh -File verify/self-update-live.ps1   # 自更新端到端：真实下载 + 校验 + pnpm 安装
```

### 9.3 运行历史（含被修正的失败轮，供审计）

| 运行 id | 结果 | 说明 |
|---|---|---|
| `verify-20261003-211325` | 6/6（phase=chain） | 用已装 usage 插件演练测量链路 |
| `verify-20261003-211639` | 中断 | 我的工具 bug：fixture 端口参数顺序不匹配 |
| `verify-20261003-211745` | 29 PASS / 10 FAIL | 首轮；10 条失败定性见 §4 |
| `verify-20261003-213010` | 31 PASS / 13 FAIL | 修完 4xx 正文后；新暴露丢 cookie 回归 + A2/A3/A3b 401 |
| `verify-20261003-213248` | 45 PASS / 0 FAIL | 修完 cookie 后 |
| `verify-20261003-213545` | 46 PASS / 0 FAIL | 加 `E7-fetch` |
| `verify-20261003-213818` | 45 PASS / 1 FAIL | `E9` 因外部会话改写 desktop `package.json` 而红 → 促使 `E9` 重新设计（§7） |
| `verify-20261003-214407` | 47 PASS / 0 FAIL | 修复前基线轮。**不覆盖桌面壳形状**，故未发现线上「Electron 写操作全 403」缺陷 |
| `selfcheck-20261003-212959` / `213804` | PASS | 断言自检（含「FAIL 要有道理」补强） |
| `selfcheck-20261003-221659` | FAIL（自检自身抓出） | wrong-stub 用 `http://evil.example` 全等匹配、断言发的是 `https://…`，`A5c` 落到别的分支 → 已改 `includes` |
| `selfcheck-20261003-221734` | PASS | 新期望矩阵：18 条契约断言全红 + `A5g` 诊断绿 |
| **`verify-20261003-221755`** | **53 PASS / 0 FAIL** | **修复后复验最终轮（v1.0.0 结论所依据的一轮）** |
| `verify-20261004-180827` | 51 PASS / 2 FAIL | v1.1.0 后的回归轮。两条失败**都是我自己的断言过期**，不是产品缺陷：`A4a` 写死了 `plugin.version=1.0.0`；`E5-env` 把一次环境测量当成产品性质（要求直连官方源必须 >15s，而这轮 8.0s 就通了）。两条的修正与定性依据见 §12.4 |
| `verify-20261004-181336` | **53 PASS / 0 FAIL** | **v1.1.1 后的回归轮**（修完上述两条断言 + 自更新通道回退逻辑）。§12 的全部结论文本所依据的一轮 |

---

## 10. 收尾状态

| 项 | 状态 |
|---|---|
| 后台宿主进程 | 4/4 已 `taskkill /T /F`；`Get-NetTCPConnection -State Listen` 对本轮 `25112/55343/55362/55374` 及历轮全部端口复核 **listen=0** |
| fixture / stub Node 进程 | 全部随 `Stop-NodeServer` 结束，无遗留 |
| 临时 profile 路径 | `_verify\dshhome\profiles\{marketcheck, chaincheck, drill, mk1, probe1}` |
| 对照插件副本 | `_verify\vendor\dsh-usage-plugin`（从 desktop `node_modules` 复制，只读用途） |
| 真实 `C:\Users\28062\.dsh` | 只读访问（取 SHA256 与 operation 目录清单）；`desktop` 的变化均为外部会话所为，见 §7 与 §11.5 |
| `plugin-market/**` | **未修改**（本轮所有写操作在 `verify/**`、`scripts/verify-market.ps1`、`_verify/**`） |

---

## 11. 桌面壳兼容性（v1.0.0 修复后复验）

### 11.1 与上一轮 47/47 的关系

上一轮（`verify-20261003-214407`，47/47）**没有覆盖桌面壳形状**：我的 §5.5 断言当时写的是旧契约「无 `Origin` 且无 `Sec-Fetch-Site` → 403」，且**每一发写请求都新建 CookieContainer、不带会话 cookie**。这两点叠加，使得：

- 我测的形状恰好是「被守卫拒绝」的那一种，于是断言通过；
- 而真实桌面壳转发过来的请求也是「无 Origin、无 Sec-Fetch-Site」，却被同一段守卫拒掉 → 用户在 Electron 里所有写操作 403。

**即：一轮全绿的验收漏掉了真实用户路径。** 所以本轮不是重复验收，而是**把真实路径补进断言**后重跑。53/53 覆盖 47/47 的全部内容，并新增 7 条（`A5-session`、`A5a` 重写、`A5c`、`A5d`、`A5e`、`A5f`、`A5g`、`A5-guard`）。

### 11.2 根因（源码级证据）

桌面端页面 origin 是自定义协议 `dsh-app://app`，请求由 Electron 主进程转发给本地宿主。`dsh-desktop-host` 的 `forwardWebRequest` 在转发前会**主动删除**这些头：

```js
if (origin !== null && origin !== "dsh-app://app") return new Response(null, { status: 403 });
for (const name of ["host", "origin", "cookie", "sec-fetch-site"]) headers.delete(name);
headers.set("cookie", cookie);
```

而修复前的守卫把「既无 `Origin` 又无 `Sec-Fetch-Site`」直接当跨站拒绝 —— 于是**桌面壳的写请求 100% 被拦**。组件层「发生在哪：打开市场页，任何写操作（安装/卸载/开关/刷新目录）」与这段代码完全对应。结论：**是守卫与官方桌面壳不兼容，不是用户操作问题。**

### 11.3 修复（`plugin-market/lib/http.js` 的 `isSameOrigin`）

判定顺序改为（契约 §1 已同步）：

1. `Origin` 为 `dsh-app://app` 或 `dsh-app://shell` → 放行（真实桌面壳 origin，页面脚本伪造不了）；
2. `Sec-Fetch-Site: cross-site` → 拒绝；
3. 有 `Origin` → 其 host 必须与 `Host` 一致，否则拒绝；
4. **两个头都不存在 → 仅当来源是回环地址时放行**（← 桌面壳形状走这条）；
5. 只有 `Sec-Fetch-Site` → 仅 `same-origin` 放行。

拒绝时 `hint` 如实带上收到的 `Origin` / `Sec-Fetch-Site` / 来源地址，便于下次一眼定性。

### 11.4 两层防护的区别（这是本轮最重要的测量前提）

| | 第 1 层：宿主信任层 | 第 2 层：插件守卫 `isSameOrigin` |
|---|---|---|
| 拦谁 | 未带**会话凭据**的请求 | 进了插件、但**有明确外站证据**的请求 |
| 拒绝形态 | **空 body 403**（不是我们的 JSON） | 403 + 我们的 `{ok:false,error:{code:'cross-origin'}}` |
| 能否被我的断言看到 | 只能看到「403 且 body 空」 | 能读到 `error.code` / `message` / `hint` |
| 正确测法 | 不要用它做结论 | **必须先在 token→303→cookie 会话上测** |

**不分层就会测错层**：拿一个不带 cookie 的 403 去证明「插件的跨站保护有效」，实际上证明的是宿主信任层在工作，插件守卫有没有 bug 完全没测到。这就是 §5.8 记录的工具缺陷。

### 11.5 修复后的独立证据（本轮原始输出）

```
A5-session  status=200 cookie数=1                                    ← 已鉴权会话建立（测量前提）
A5a  status=400 error.code=not-in-catalog                            ← 桌面壳形状被放行，走进业务逻辑（关键回归项）
A5c  status=403 error.code=cross-origin
     hint=…本次收到：Origin=https://evil.example、Sec-Fetch-Site=（无）、来源地址=127.0.0.1。…   ← 外站 Origin 被拒 + 信号如实回传
A5d  status=403 error.code=cross-origin                              ← Sec-Fetch-Site: cross-site 被拒
A5e  status=400 error.code=not-in-catalog                            ← 同源 Origin 放行
A5f  status=403 error.code=cross-origin                              ← 同站不同端口被拒
A5g  status=400 body长度=107 属宿主信任层=False                       ← 分层诊断：本环境未鉴权也到了插件（诚实记录，见 §5.8）
A5-guard  exit=0 含17/17=True                                        ← 判定矩阵单测全过
A3b  utf8DecodedBytes=110971 contains插件市场=True U+FFFD个数=0        ← 修复未影响客户端 bundle
E5   catalog.count=4412 source=npm:dsh-plugin-catalog@2026.1003.4803
E7-fetch status=200 耗时=527ms                                       ← 真实抓取仍远低于 3s
```

完整原始输出见 `_verify/logs/verify-20261003-221755.evidence.log`。

我另核对了两点，均无问题：

1. **判定矩阵没有漏形状**：17 条含桌面壳（`dsh-app://app`/`shell`）、`dsh-app://evil`、无 `host` 且回环、`::1`、`::ffff:127.0.0.1`、无 `socket` 信息、同站不同端口、`same-site`/`none`/`cross-site`、非法 Origin 字符串。我额外用真实宿主端到端补了 4 条真实 HTTP 形状（A5c/A5d/A5e/A5f），与单测结论一致。
2. **桌面壳转发还带别的头会不会再次误判**：`forwardWebRequest` 只删除那 4 个头并补 `Cookie`；我实测的「无 Origin + 无 Sec-Fetch-Site + 回环」就是它的最终形态，判定第 4 条覆盖。若未来它改为从非回环地址转发（例如走 127.0.0.1 之外的接口），第 4 条会拒 — 这是一个**接口约定依赖**，建议在 `forwardWebRequest` 改动时回归 `origin-guard.test.mjs`。

### 11.6 修复后 desktop 现状（只读核对）

本轮 `E9` 仍 PASS（我的 6 次 `dsh` 调用全部指向 `marketcheck`，命中 `desktop/web` = 0）。`E9-info-pkg` 记录到真实 desktop profile 在此期间被 Lead 按 task-4 装入了市场：

- `desktop/package.json`：`174CBD943FB6091E037E2D69ED557ACB85E2C29C1C7C781A01C0363C10935A7D`，bundles 末尾出现 `dsh-plugin-market`
- `desktop/cordis.patch.yml`：`5B9826E192DDD9052754DC36AFA972A8E90F40A0A77C2400E662FD87899CE642`（前后一致）

均为外部会话所为，非本工具。


---

## 12. v1.1.0 / v1.1.1 这一轮：两个新按钮、自更新通道、整套动效

### 12.1 本轮改了什么（验收对象）

| 面 | 内容 |
|---|---|
| client 半 | 头部两个按钮（「更新插件」带计数角标 /「检查市场更新」四态）；可就地展开的可更新列表（逐条确认，无批量）；侧边栏入口角标；顶部不确定性进度条；提示条自动收起 + 倒计时线；整套动效（错峰入场、hover 抬升、按下回弹、页签底线滑动、面板展开、reduced-motion 关闭） |
| host 半 | `GET`/`POST /plugin-market/self-update`（同一 handler）；`lib/self-update.js`（三源回退、三道校验、下载落盘、交给 `pluginManager` 安装） |
| 发布流程 | `release.ps1` 多一步：tarball 与 `releases/index.json` 进版本提交 → 进标签 → jsDelivr 可取 |
| 仓库可见性 | **private → public**。这是自更新通道的前提，也决定别人能否安装这个插件 |

### 12.2 结论汇总

| 验证 | 结果 | 证据 |
|---|---|---|
| 契约验收（冻结的 53 条） | **53 PASS / 0 FAIL** | `verify-20261004-181336`（v1.1.1 后） |
| 真实浏览器渲染与动效（78 条，v1.2.0） | **78/78** | `verify/ui-check.ps1`，截图 `verify/logs/ui/` |
| 自更新通道离线回归（43 条，v1.1.6） | **43/43** | `verify/self-update.test.mjs` |
| 文案与动效不变量（32 条，v1.2.0） | **32/32** | `verify/client-copy.test.mjs` |
| 目录身份层与内容校验（36 条，v1.1.6 新增） | **36/36** | `verify/catalog-identity.test.mjs` |
| host 契约回归（27 条，v1.2.0） | **27/27** | `verify/host-contract.test.mjs` |
| 自更新端到端（真实 CDN + 真实安装，6 条） | **6/6** | `verify/self-update-live.ps1` |
| 样式生命周期回归（5 条，v1.0.1 起） | **5/5** | `verify/style-heal.test.mjs` |

### 12.3 真实浏览器验收（补上了上一轮列为"未覆盖"的那一项）

§8.3（旧版）写着「真实浏览器里的 DOM 级渲染断言没有自动化」。本轮补上了，做法是：
**新起一个 scratch 宿主进程**（因此它加载的是仓库里当前的宿主半代码，不需要重启用户正在用的 DSH），
再用系统自带的 headless Edge 通过 CDP 驱动真引擎（Node 22+ 自带 `WebSocket`，零依赖）。

要点与三个踩坑：

- **假 DOM 桩证明不了的事**：真渲染、真计算样式、`prefers-reduced-motion` 下内容还在不在。
  这三件正是本轮要验的，所以必须真浏览器。
- **`/installed` 用 CDP 拦截注入**：构造确定性的「两个插件可更新、一个没有」，
  于是角标数字与列表内容不依赖当时目录里恰好有什么。
- **headless Chromium 默认就是 `prefers-reduced-motion: reduce`**：不显式钉 `no-preference`，
  「动效生效」那组断言测的是一条永远关着动画的路径（第一轮 24 条里 4 条就是这么红的）。
  现在同一个页面里先钉 `no-preference` 证明动效在跑、再切 `reduce` 证明它被关掉——一个真正的 A/B。
- **过渡期间不能采样**：`visibility` 是离散属性、中途才翻转，刚点完就读高度/`innerText`
  会读到过渡中途的值。改成等「高度 > 120」再断言（另两条红就是这么来的）。

### 12.4 本轮被"自己的验收"抓出来的产品缺陷

按发现顺序，**每一条都是先红后绿**：

| # | 缺陷 | 怎么被抓到 | 修法 |
|---|---|---|---|
| 1 | **同一路径的 GET 与 POST 互相覆盖**：路由表以 path 为键，`/self-update` 登记两次后只剩 POST → `GET` 恒 405 | scratch 宿主实测 `GET → 405 这个地址只接受 POST` | GET/POST 合并成单个 handler（`docs/API-CONTRACT.md` §5 第 10 条） |
| 2 | **可更新列表要求目录先加载好**：列表数据本来就在 `/installed` 里，却先判断发现页的目录数据，导致打开列表显示「目录还没就绪」 | 真实浏览器：注入的 `/installed` 已有两条更新，面板却是空状态 | 顺序改为「有可更新条目就直接列」，只有列表为空时才区分「都最新」与「目录没读到」 |
| 3 | **升入动画用 `both` 会钉死 `transform`**：卡片 hover 抬升、按钮按下缩放会静默失效 | 写动效时自查发现（不是测出来的）→ 立刻写进 `client-copy.test.mjs` 当不变量 | 全部升入动画改 `backwards`；并加断言禁止 `forwards`/`both` |
| 4 | **第一个源半残就整次检查失败**：刚发完版 jsDelivr 版本列表还是旧的、旧标签没有 `releases/` → 清单 404 → 回「找到了 vX 但拿不到清单」 | **发布 v1.1.0 之后立刻实测**（离线用例当时没覆盖这个组合） | 每个源要「版本 + 清单」都成功才成功，失败继续问下一个；无更新时取最高版本。修在 v1.1.1，并补了离线用例 |
| 5 | **下载只认标签地址**：标签未被 CDN 索引时 `@v1.1.0/…` 404 → 即使清单在手也装不上 | 同上，同一次实测 | 传输层失败时改试 `@main` 同一路径（内容由 `sha256` 负责）；但**拿到字节后哈希不符是硬失败，不换来源重试** |

第 4、5 条值得单独记一笔：**它们是"只有真的发一次版"才会暴露的问题**——
离线测试当时全绿，契约验收也全绿，因为两者都没有「刚推完标签、CDN 尚未索引」这个状态。
`verify/self-update-live.ps1` 就是为此写的，它现在能重现这个状态。

### 12.5 顺带修正的两条过期断言（我自己的工具缺陷）

- **`A4a` 把期望版本写死成 `1.0.0`**：发版后「产品正确上报当前版本」被判失败。
  改为与 `plugin-market/package.json` 的 `version` 比较——契约要求的是"等于包清单里的版本"，
  不是一个具体数字。
- **`E5-env` 把一次环境测量当成产品性质**：它要求「Node 直连官方源必须 >15s 或失败」，
  用来论证 npm 镜像优先。这轮直连 8.0s 就通了（5.3MB），于是一个**仍然正确**的实现被判失败。
  改为断言**可持久的关系**：直连仍明显慢于镜像（>2s 门槛，镜像实测 289–550ms）。
  哪天直连也进了 2s，该重新评估的是源顺序，而不是这个阈值。

同一个动作也修掉一个测试卫生问题：`self-update.test.mjs` 里「没有 fetch 的运行环境」那条
在 Node 下其实退回了 `globalThis.fetch`，**于是它会真的去打网络**，网络一通就误判为通过。
现在真的把全局 `fetch` 摘掉再测。

### 12.6 自更新端到端真的走了一遍

`verify/self-update-live.ps1` 把 `plugin-market/package.json` 临时降到 `1.0.9`（低于最新标签），
让 scratch 宿主真的认为自己旧了，然后：

```
L1  GET /self-update → updateAvailable=true、installable=true、带 url/sha256   PASS
L2  已鉴权会话（token → 303 → Set-Cookie）                                      PASS
L3  POST /self-update → application=restart-required、from=1.0.9、to=1.1.x      PASS
L4  落盘 tarball 的 sha256 == releases/index.json 里记的值                      PASS
L4b 产物自证：tarball 内的 package.json 声明 dsh-plugin-market@<version>        PASS
L5  scratch profile 的依赖变成指向下载物的 file:（pnpm 真的装了）                PASS
    finally: package.json 按字节还原（sha256 核对一致）、profile 还原、下载物清理
```

**6/6 通过**。这条路径同时证明了「三道校验」是真在跑（L4/L4b）与「装完不算生效」（L3 的
`requiresRestart: true`，客户端据此回到「检查市场更新」而不是显示"已更新"）。

### 12.7 界面证据

`verify/logs/ui/` 下的图来自真实浏览器（当前一轮：`market-discover.png`、`market-tab-installed.png`、
`market-updates-open.png`、`market-tab-alignment.png`、`market-header-zoom.png`、
`market-search-clear.png`、`market-reduced-motion.png`、`market-short-viewport.png`、
`market-updates-short-viewport.png`）。发布用的三张进 `docs/assets/`：
`market-discover.png`（发现页：三个页签 + 搜索 + 分类 + 真实卡片）、
`market-updates.png`（可更新页）、`market-tab-alignment.png`（v1.1.6 新增：切到第三个页签后
内容仍从页签正下方同一处开始，一眼能看出三页对齐）。
> 此前这里写的 `market-header-closed.png` **从未生成过**（档过的头部截图只有
> `market-header-zoom.png` 一张），v1.1.6 顺手改掉这个不存在的文件名。

> **后记（2026-10-06 仓库清理）**：`plugin-market/assets/` 下的两张图（连同早已无引用的
> `market-entry.png` / `market-page.png`）已从仓库与 npm 包移除——包内 README 自 1.1.6 起
> 用 `raw.githubusercontent.com` 绝对地址引用 `docs/assets/`，这四张随包图片已无任何引用；
> `package.json` 的 `files` 同步去掉 `assets`（npm tarball 不再携带图片）。
> 本节描述的是验收当时的发布状态，截图证据本身仍在 `verify/logs/ui/`。

### 12.8 未覆盖 / 残留风险（不掩饰）

- **动效只验到计算样式层**：动画名、填充模式、延迟、reduced-motion 开关都已自动化；
  具体某一帧的观感与滚动合成性能没有测量，仍靠人看截图。
- **自更新的信任锚不是独立签名**：三道校验挡得住损坏、截断、单点替换，**挡不住
  「CDN 与 `releases/index.json` 一起被换」**。要到那个强度需要独立签名密钥，本轮不做——
  写进契约 §2.9 的「已知限制」而不是含糊带过。
- **列表源的滞后能兜底、不能根除**：`@main` 的分支清单被 CDN 缓存 12 小时、Data API 的版本列表
  数小时不更新（都实测过）。v1.1.2 起加了标签探测兜底并把 GitHub API 提到第一源；
  若三个列表源与三个探测标签同时不可用，检查仍会如实报错，不会编一个版本号出来。
- **仓库 public 是通道前提**：转 private 之后按钮会变成「更新通道没有回应」。
  这是本轮把仓库从 private 转 public 的直接原因（转之前 Release 附件只有我本人能下）。
- **`ui-check.ps1` 与 `self-update-live.ps1` 不在发布门禁里**：一个要起浏览器，
  一个要真实网络并临时改 `package.json`。两者都写进了 `docs/RELEASING.md` §4.5 的
  「每次发版前跑一遍」，但**门禁不会替你跑**——这一点如实记下。

### 12.9 与冻结契约的关系

`docs/API-CONTRACT.md` 的 53 条断言**一条都没有被放宽**（53 PASS / 0 FAIL）。
本轮在契约里新增的是**新端点**（§2.8/§2.9）与**新断言**（§5 第 9–12 条），
以及 §4 里关于动效的三条不可违反的约束。旧端点、旧字段、旧错误码一个没动。
唯一的"旧断言被改写"是 §5 第 5 条相关的 `A4a` 期望值（写死版本号 → 与包清单比较），
属于把断言修得更正确，不是放宽。

### 12.10 一条被我写错的根因，以及更正过程和证据

**错误结论**（写进了 1.1.0 的 CHANGELOG 与 `docs/RELEASING.md` §4.4）：
「本机直连 `api.github.com` 的真实路径一律 403（GFW 拦截）、`github.com` 直接重置连接，
自更新只能走 jsDelivr。」

**它是怎么来的**：三件事被我在同一个时间窗口里观察到，然后我给出了一个错误的统一解释——
(a) `api.github.com/repos/Winnie-0721/dsh-plugin-market/releases/latest` 返回 **404**；
(b) `api.github.com/repos/microsoft/vscode/releases/latest` 返回 **403**；
(c) `github.com/Winnie-0721/dsh-plugin-market` 连接被重置。

**实际原因**（今天逐条复测）：
- (a) 当时仓库还是 **private**，未鉴权请求私有仓库的 releases 就是 404 —— 不是封锁；
- (b) 那是**匿名限流**的 403。今天同一请求 200，响应头 `X-RateLimit-Remaining: 47/60`；
- (c) 一次**瞬时**重置。今天 `github.com` 200、`git ls-remote` 842ms、`gh release list` 1.0s、
  Release 附件下载 200（2.7s 直连 / 737ms 走代理），下载字节 sha256 与本地构建一致。

**更正动作**（不只是改一句话）：
1. 源顺序按**新鲜度**重排：GitHub Releases API 提到第一源，jsDelivr 两条居后
   —— 被限流只当该源失败，继续往下；
2. 加了 `tag-probe` 兜底（列表滞后时按常规递进探 3 个候选标签），并补了 5 条离线用例；
3. 下载从两条路扩到三条（`@<tag>` → `@main` → Release 附件），也补了用例；
4. 文档全部更正：`docs/RELEASING.md` §3（代理不是必须）与 §4.4（附实测数字与这条更正）、
   两份 README、CHANGELOG（1.1.0 那段加删除线并指向 1.1.2）；
5. 这条记录留在本报告里，而不是悄悄改掉——**错误结论本身也是证据**：
   它说明「一次观测 + 一个合理解释」不足以证明根因，尤其是当多个不一致的观测
   被同一个故事强行统一的时候。

值得记下的教训：我当时**没有**去看响应体与响应头（403 的正文里就写着 `API rate limit exceeded`），
也没注意到「仓库是 private」这一个已知事实就能解释 404。三条证据里只要有任意一条被真正读全，
这个错误结论就不会成立。


### 12.11 这一轮的最终状态（v1.1.2）

| 项 | 状态 |
|---|---|
| 已发布 | **v1.0.0 / v1.0.1 / v1.0.2 / v1.1.0 / v1.1.1 / v1.1.2**；`releases/index.json` 里 3 个版本，`latest=1.1.2` |
| 仓库 | `main == origin/main`，工作树干净；**public**（自更新通道与"别人能装"都依赖它） |
| 用户正在运行的桌面端 | 客户端半随文件热更新；但 `/plugin-market/status` 仍报 **1.0.2**、`/plugin-market/self-update` 仍 **404** —— 宿主半在进程里被 Loader 缓存，**必须重启一次 DSH** 才会加载 1.1.2 的宿主代码 |
| 冻结契约 | 53/53（`verify-20261004-181336`） |
| v1.1.1 / v1.1.2 之后 | 自更新离线 37/37、真实浏览器 24/24、自更新端到端 6/6、文案与动效 13/13、样式生命周期 5/5、BOM 13/13 |

本轮还修掉两处**测试自身**的卫生问题（都属于「断言把版本号写死」这一类）：

1. `verify/self-update-live.ps1` 的 L5 断言写死 `1.1.0`，而实际装的是 1.1.2，于是把「pnpm 真的装了新版」
   判成失败。改成与 `$latest` 比较。这与 `A4a` 是同一个错误——「在断言里写字面版本号」在这个仓库里
   会反复发生，值得当成一条纪律：**断言里出现具体版本号就是缺陷**。
2. 同一脚本的清理不完整，**导致下一次运行的前提根本不成立**：只还原 `package.json` 不够
   （`node_modules/dsh-plugin-market` 已从符号链接变成实体目录，宿主继续加载旧版本，现象是
   「以为有更新、其实宿主自认最新」，看着像产品缺陷）；只删 `pnpm-lock.yaml` 也不够
   （pnpm 内部还有 `node_modules/.pnpm/lock.yaml`，会拿已删除的下载物去装，报 ENOENT）。
   现在按顺序做：还原 manifest → 清两份 lockfile → `dsh plugin add <工作树>` 并核对 LinkType
   → 最后才删下载物。

一句话总结这一轮：**四个套件全绿，但真正有价值的产出是那五条只有"真的发一次版、真的用浏览器、
真的把包装上"才能暴露的缺陷**——纯离线测试当时是全绿的。


### 12.12 用户报的「显示不全」：提示条被压成一条（v1.1.3）

**现象**（用户截图）：市场页顶部的提示条只剩一条绿边，文字被裁掉一半，高度看起来只有二十几像素。

**先做最小复现，再改**。`verify/repro-notice-clip.html` 只复刻结构：定高 + `overflow:auto` 的 flex 列
（对应 `.dshpm-root`）、一个带 `overflow:hidden` 的提示条（对应 `.dshpm-notice`，那个 `overflow` 是
v1.1.0 为底部倒计时线加的）、以及一屏放不下的内容。headless Edge 实测（视口 900×620）：

| 状态 | 提示条 clientHeight | 内容 scrollHeight | 是否被裁 | 根是否滚动 |
|---|---|---|---|---|
| 修复前 | **16** | 36 | **是** | 是（1588 > 620） |
| 只给提示条 `flex-shrink: 0` | 36 | 36 | 否 | 是（1608 > 620） |
| 所有直接子项 `flex: 0 0 auto` | 36 | 36 | 否 | 是（1608 > 620） |

**根因是 CSS 的自动最小尺寸规则**，与提示条自身无关：flex 项的自动最小尺寸取内容高度，
**但一旦该项带非 `visible` 的 `overflow`，自动最小尺寸就变成 0**。于是当内容高于容器时，
其余子项都压不动（它们的最小尺寸等于内容高度），**唯独带 `overflow:hidden` 的提示条可以被压到 0**，
整段溢出量全落在它身上——自然高度 36px 被压成 16px，文字随之被自己的 `overflow:hidden` 裁掉。
换句话说：**这是我 v1.1.0 给倒计时线加 `overflow:hidden` 时埋下的**，只是当时内容高度刚好没触发。

**修法**：`.dshpm-root > * { flex: 0 0 auto; }` —— 溢出由容器自己滚动消化，任何区块都不参与收缩。
两个变体都能修好当前症状，选全量那条是因为只改提示条的话，**下一个带 `overflow` 的区块会再犯一次**。

**为什么之前的验收没抓到**：断言只问「元素在不在、文案对不对」，没有问「它有没有被裁」。
现在补进了真实浏览器验收（24 → 29 条）：

- 提示条：`clientHeight ≥ scrollHeight`、高度 ≥ 30px、文案完整（`noticeClipped` 这一类量法直接对准根因）；
- 窄高视口（1200×520）：遍历 `.dshpm-root` 的**每一个直接子项**，断言没有一个 `clientHeight < scrollHeight`，
  同时断言根自己仍在滚动——防止有人用「去掉滚动」的方式假装修好。

这条与 §12.4 的第 3 条（动画 `fill-mode` 钉死 `transform`）是同一类问题的两个面：
**CSS 的隐式规则会静默吞掉看起来无关的改动**，所以每一条都写成了可执行的不变量，而不是留在注释里。

### 12.13 用户报的「三个切换页面高度不对齐」（v1.1.6）

**现象**（用户截图 + 文字）：发现 / 已安装 / 可更新 三个页签，"切换页面高度不对齐"，要求
"设计成统一的，方便后续添加页面"。

**先量，再改**。用户截图（390×177 缩略）逐行取暗像素游程：三个页签的文字都在 y112–132，
发现页的底线在 y142–144（页签栏本身是齐的）；再量 e2e 的三张真机截图（1560×980 / 1530×885），
页签栏以下第一条内容行：发现页是搜索工具条，已安装页是汇总行，可更新页是页头标题——
但可更新页的文字被**推下去 12px**，正是 `.dshpm-updatesPanel` 的 `padding:12px 14px`。

| 页面 | 外层容器 | 页面级节距 | 作为整页时的问题 |
|---|---|---|---|
| 发现 | `.dshpm-installed` | `gap:8px` | 与另外两页不一致 |
| 已安装 | `.dshpm-installed` | `gap:8px` | 同上 |
| 可更新 | `.dshpm-updatesPanel .dshpm-updatesPage` | `gap:10px` + `padding:12px 14px` + 边框 | 内边距把整页内容压下去 12px；还是"页里的另一张卡片" |

**根因**：三页各写各的外壳，节距有 8 有 10，而可更新页当年是**抽屉里的一张卡片**，
带自己的内边距与边框——改成整页页签后那圈内边距没去掉，于是三页的起点与节距各不相同。

**修法**（三层，见 `docs/API-CONTRACT.md` §4）：
1. 统一外壳 `.dshpm-page`（`gap:12px; flex:1 0 auto`），渲染处把当前页套进去；
   `.dshpm-updatesPage` 作为整页时去掉内边距与边框；页面级节距统一成**一个单位 12px**
   （卡片/列表行**内部**仍是 8px 的块内间距）。
2. 页签按钮高度固定（`inline-flex` + `min-height:32px`）：有没有角标都一样高，
   后续新增页面加角标/图标也不会把页签栏撑高。
3. 页签栏与页面改由 `MARKET_TABS` / `MARKET_PANES` 两张注册表驱动，正文里那串嵌套三元
   （`tab === "discover" ? … : tab === "installed" ? … : …`）消失——**新增一个页面 = 各加一项**。

**`.dshpm-page` 的 `flex:1 0 auto` 覆盖了 `.dshpm-root > *` 的 `0 0 auto`，为什么不违反 §12.12**：
收缩权仍是 `0`（`flex-shrink: 0`），只是允许**增长**填满剩余高度——内容不足一屏时三页等高
（这正是"高度对齐"要的效果），内容超长时高度由内容决定、仍由面板根自己滚动。
e2e `[8]` 的"任何直接子项不得被压扁 + 根自己滚动"两条断言依旧全绿，且没有引入第二个滚动容器。

**回归**：`client-copy.test.mjs` 改钉注册表并新增 1 条布局不变量（24→**25/25**）；
`market-ui.e2e.mjs` 新增 `[2c]` 用**真实几何**取证（58→**64/64**）：

| 量法 | 实测 |
|---|---|
| 三个 `.dshpm-tab` 的 `getBoundingClientRect().height` | 32 / 32 / 32 |
| 页签底边 → `.dshpm-page` 顶边 | 12 / 12 / 12 |
| `.dshpm-page` 顶边 → 该页**第一行内容**顶边 | 120 / 120 / 120 |
| 内容不足一屏时的页面高度（已安装 / 可更新） | 相等（差 ≤ 1px） |

**又踩了一次"过渡期间不能采样"**（与 §12.3 最后一条同源）：首轮 64 条里红了 2 条——
`firstTops` 量到 `120/120/127`、页签底线量到 `matrix(0.3607,…)`。原因不是布局没对齐，而是
页面入场动画 `dshpm-rise` 自 `translateY(7px)` 起、页签底线有 0.26s 的 `scaleX` 过渡，
断言正好落在中间帧上。给测量前加 450ms 落位等待后全绿。
**教训沿用**：凡是量几何，先确认动画已经结束；否则验的是动画，不是布局。

### 12.14 核心逻辑审计：三份独立审计、26 条结论、3 条被复核否掉（v1.1.6）

用户要求「检查核心代码是否有逻辑错误」，并按「现代应用市场的逻辑」修复。做法是把 8 个核心文件
（`catalog.js` / `catalog-npm.js` / `self-update.js` / `http.js` / `index.js` / `restart.js` /
`restart-helper.cjs` / `client.js`，约 6400 行）分给三路独立审计（各自读代码 + **跑真实模块**对照
真实 4412 条快照），再由我在真实数据上**逐条复核**。

**26 条结论里 3 条不成立**——这条比任何单条修复都重要：

| 审计结论 | 复核结果 |
|---|---|
| 排序并列组「21 组、最大 4 条」 | ✗ 实测 171 组、最大 570 条（统计口径错）；「正/倒序输入结果不同」成立 |
| 搜索「换行能跨字段命中」 | ✗ `beta\nalpha` 实测命中 0 条，未复现；「`github` 命中全量」成立 |
| `page > pages` 返回自相矛盾页面 | ➖ 代码注释与契约都明确允许、客户端还有「第一页」出口；**不是 bug**（我判为不改） |

**改动分四组，每条都是先在真实数据上量出规模再动手**（详见 `CHANGELOG.md` §1.1.6 与
`docs/API-CONTRACT.md`）：

1. **身份匹配（会装错包）**：`matchBundle` 的「剥 scope 再查」在 1431/4412 条「无 scope 且
   `npm === name`」的条目上会认错人 → 取消兜底、改分层匹配；`repoTail` 取 URL 最后一段导致
   435 条 monorepo 地址退化成 `dsh`/`bundle` 这类通用词 → 改取前两段；`buildMatchIndex`
   「先到先得」导致 144 个键被 278 条争用 → 改歧义哨兵（不匹配，而不是猜）。
2. **内容与传输闸门**：`validateCatalogPayload` 放行 `{count:4412, plugins:[]}` → 加交叉核对；
   npm 路径不剥 BOM（URL 路径被 fetch 剥掉）→ `trimStart`；`dist.integrity` 可选 → 必填。
3. **host 契约与生命周期**：`sendError` 丢 `diagnostic`；`ok` 只看 `error`；重名安装「第一个匹配
   就装」；`MANAGEMENT_*` 原型键；重启端点「先写响应后排退出」；`child.on('error')` 挂在提早
   return 之后（未处理的 `'error'` 直接崩宿主）。
4. **agent 自更新与客户端**：`isNewer` 把 `null` 折叠成 `false`（合法预发布号 → 谎称已是最新）；
   「知道有新版却验不了」被更旧候选盖成「已是最新」；标签孤立代理项 → `URIError`；写盘错误
   归类成 500 internal；目录过期原因永远是「原因未知」；非 JSON 正文误诊成宿主内部错误。

**我自己也在这轮里被探针抓出两个错**（记录在案，不掩饰）：

- 第一版 `repoTail` 用「先找 `/tree/` 再回溯」的启发式，在「仓库恰好叫 `tree`」「owner 恰好叫
  `tree`」「GitLab 的 `/-/tree/`」三种输入上算错——是**对抗性复核**把它抓出来的。改成「取前两段」
  后，真实 4412 条**逐条一致**且没有边界坑。
- 一次自检探针把 `fetchImpl` 误写成 `fetch`，于是走了**真实网络**、看到 `latest=1.1.5`，
  一度以为引入了「有更新却报无更新」的回归。核对后发现是探针写错，代码正常
  （正确注入后 `1.1.5→1.1.6` 得 `updateAvailable:true`）。教训：注入式测试**先确认桩真的被调用**
  （那次 URL 列表是空的，就是线索）。

**回归**：新增两个套件——`verify/catalog-identity.test.mjs`（**36 条**：身份层/内容校验/搜索/
排序/分页，有真实快照时一并做规模复核，含「repoTail 与 4412 条真实 URL 逐一一致」、
「`@owner/name` 别名认回 ≥1400 条（共 1431）」、「同一仓库的多子插件全部认回」与
「npm 为空的条目认回自己 ≥1755 条，不得比旧逻辑倒退」）与 `verify/host-contract.test.mjs`
（**16 条**：diagnostic 透传、`ok` 推导、重名歧义、重启顺序、error 监听顺序、Map 映射表）；
`client-copy.test.mjs` 26→**30/30**、`self-update.test.mjs` 39→**43/43**
（含「知道有新版却验不了 ⇒ 不得谎称已是最新」与「正常有更新路径不受影响」这一对）；
门禁与 e2e（**64/64**）全绿。

### 12.15 对抗性复核：把 diff 交给独立一方找错，抓出 5 条（v1.1.6）

§12.14 那批修复**自己全绿**——门禁 11 个套件、e2e 64 条、以及我新写的两个套件全过。
所以这一节的方法论是：**「测试全绿」不能证明修复正确，只能证明「我想到要测的东西是对的」**。
于是把完整 diff 交给一个独立审计方，明确要求「找错，不要复述」并自行设计复现。

它抓出 5 条，其中 1 条是**我上一版引入的、比我修掉的原 bug 更严重的死锁**：

| # | 缺陷 | 性质 | 证据 |
|---|---|---|---|
| 1 | 「一键更新」永久卡死 | **我引入的 HIGH**：新守卫只 `return` 不回调，循环断掉 → 按钮永久禁用 | 忠实复刻控制流的脚本；并指出「已安装」页按钮漏了 `batchRunning`，正好是漏过去的入口 |
| 2 | 「取消安装」文案不可达 | 上一版 `ok` 推导的副作用：`cancelled + error` → `ok:false` → 客户端抛错 | 列举六种 `application`/`error` 组合跑 `ok` |
| 3 | 过期原因仍是一半路径「原因未知」 | 上一版只修客户端、没补 `/catalog` 的 `error` 字段 | 复刻 `staleSource` 的取值顺序 |
| 4 | 粘贴仓库地址搜不到 + 1431 条合法匹配被杀 | **我上一版的两处过度修复** | 真实快照计数：`https://…` 由 1→0；`@owner/name` 由 1431→0 |
| 5 | 同一仓库多子插件被误判「重名歧义」 | 哨兵过激（278 条） | 真实 id 里的 `#子目录` 说明它们本是同一仓库 |

它还顺手纠正了**两条我自己的探针结论**（我一度以为 `repoTail` 有「有更新却报无更新」的回归、
以及「1755 条回退」——前者是我的探针把 `fetchImpl` 写成了 `fetch` 走了真实网络，后者是它的判据
用错了 `latest` 而不是 `installed`）。**互相纠错**才是这轮的价值：单一视角的自检两次都错。

修法见 `CHANGELOG.md` §1.1.6 最后一条。两处**只 grep 源码形状**的断言换成真调 handler
读响应体的行为测试（`sendChangeResult` 六种组合），因为形状断言换个等价写法就会假红/假绿。

**从这一轮提炼的两条硬规矩**（已写进本节，供以后复用）：

1. **任何「早退」都必须问一句：调用方还在等回调吗？** 守卫/去重/短路这三类改动最容易在这里出错，
   而症状是「界面卡住」而不是「报错」，测试通常抓不到。
2. **删掉一段兜底逻辑前，先用真实数据量「删掉会损失什么」**。这轮两处过度修复（url、scope）
   都是「症状确实修好了」，但代价是 1431 条合法匹配和一类常见搜索操作——**症状消失 ≠ 修复正确**。

### 12.16 补测：把「全绿」里仍然存在的空洞补上（v1.1.6）

§12.15 之后门禁与 e2e 全绿，但复核断言质量时发现**「绿」并不均匀**：`verify/` 里的断言分两种
价值——

| 类型 | 能抓住回归吗 | 反例 |
|---|---|---|
| **真调行为**（起假 res / 假 manager 真调 handler 读响应体） | 能 | `sendError` 的 diagnostic 透传 |
| **源码形状**（`assert.match(source, /…/)`） | **不能**，只要那个字符串还在就绿 | 把 `ok: error === null && application !== 'failed'` 改成等价的 `application !== 'failed' && error === null` 就会**假红**；而真正的行为（`cancelled` + `error` → `ok`）它根本测不到 |

按这个标准回头审计，补了三处：

1. **「一键更新永久卡死」的入口补了真实浏览器回归**（e2e 64→**65**）：
   批量进行中切到「已安装」页，断言那颗更新按钮**确实禁用**。复核脚本当初认定「真实用户可达」
   的依据正是这一页缺 `batchRunning`——现在由真实浏览器兜住，不只靠源码里 grep 到字符串。
   （顺带确认：「可更新」页的行内按钮原本就有 `batchRunning`，所以那一个入口当时就是关着的。）
2. **`findCatalogItem` 从源码形状改为真调**（host-contract 16→**18**）：身份层
   （`id`/`npm`/`url`）命中即确定；显示名层唯一才确定、**重名报歧义且 `item === null`**
   （绝不返回其中任意一个）。这是「会装错包」那一类里唯一还只剩形状断言的地方。
3. **线上通道体检**（临时探针，跑完即删、不入库）：GitHub Releases API 确认**每个版本的附件都带
   `digest`（sha256）**、`@v1.1.5/releases/index.json` 仍 200 而 `@main/…` 是 404、
   真实 `check()` 以 `current=1.1.5` 跑通（`ok:true`、`channel:github-release`、attempts 如实记录
   三条源的失败）。它回答的是**加固类改动特有的风险**：「更严格」很容易变成「永久不可用」——
   `dist.integrity` 改必填、`unverified` 改硬失败都属于这一类，必须对着**真实环境**验一次，
   不能只靠 mock 全绿。

**第 3 条补上一条硬规矩**：加固（mandatory / 硬失败 / 收紧容差）落地前，必须对真实源跑一次
「正常路径仍然通」；否则就是把「防坏数据」变成了「防正常数据」。

**本轮最终状态**：门禁全绿；`catalog-identity` **36/36**、`host-contract` **18/18**、
`client-copy` **30/30**、`self-update` **43/43**、真实浏览器 **65/65**。

### 12.17 装后激活校验 + 版本回读（v1.2.0，用户指定「先做 2」）

来源是 `docs/ROADMAP.md` 的功能方向研究：第 2 项「让『装』和『更新』不说谎」。
问题定性：`application` 说的是宿主**执行**了什么，不是**结果**——`applied` 完全可能对应
「写进了 `node_modules`，但 profile 的 bundle 列表里从来没有它」；更新时目录说 `0.63.0`、
磁盘上还是 `0.62.3`，旧版界面照样写「已更新」。

**做法**：install 前后各读一次 bundle 列表，用**差集**（而不是猜包名）认出这次装上的那个，
回一个 `activation: { state, expected, installed, enabled, versionMatches, reasons }`。

**三个关键取舍**（都是「宁可说不知道，也不猜」的具体化）：

1. **`restart-required` 优先于 `live`**：宿主的原话就是还没生效，不因为条目在列表里就改口。
2. **`inert` / `broken` 不算成功**（客户端 `applied:false`）：它们会进「一键更新」的成功计数，
   谎报成功比不说更糟。
3. **`unknown` 是一等结果**，但 **`no-baseline` 与 `live` 可以并存**：认不出「谁装上的」，
   却认得出「它在列表里」，后者才是 `live`/`inert` 的判据；把已知的「它在跑」降级成 `unknown`
   是另一种不诚实。这条是写测试时被自己**逼问**出来的——最初的实现里「没有基线」直接返回
   `unknown`，而测试用例恰好覆盖了「没有基线但列表里有它」，于是「预设的答案」和「诚实的答案」
   当场分了岔。

**验证**（三层，逐层加力）：

| 层 | 内容 | 结果 |
|---|---|---|
| 行为回归 | `host-contract` 第 9 组：真调 `verifyActivation` 验六态 + 三种 `unknown` 理由 + 四个「不该谈激活」的入口 | 18→**27/27** |
| 文案回归 | `client-copy`：六路文案、版本不符必须改口、`inert`/`broken` 不算成功、无 `activation` 时行为不变 | 30→**31/31** |
| 真实浏览器 | e2e `[9]`：注入「`applied` 但回读版本不符」，断言回执**真的改口**成「实际是 v1.0.0（目录里写的是 v1.2.0）」且按 `warn` 呈现 | 65→**67/67** |

**变异测试**（这一轮的额外一步）：§12.16 已经证明「源码形状断言可以骗过自己」，
所以这次不只跑测试，还**把每处语义破坏一次**（8 处：去掉版本比对、把 `inert` 改回算成功、
无 `activation` 时不再保持原文案、`restart-required` 报成 `live`、找不到时报 `live`、
`failed`/`pending` 也给状态、装完不回读、版本比较恒真），**要求对应断言必须失败**：
**8/8 全被抓到**。探针跑完即删、不入库（与 §12.16 第 3 条同一做法）。

**新截图**：`verify/logs/ui/market-activation-mismatch.png`（人工看过：橙色左侧边条 +
「已安装 @fixture/needs-update，但它实际是 v1.0.0（目录里写的是 v1.2.0）——可能源同步滞后，
重启后再确认。」）。断言绿而截图丑的情况这里不存在——两者都看了。

### 12.18 装完主动问「立即重启 / 稍后重启」（v1.2.0）

用户原话：「安装完插件要手动重启这很麻烦，你设置一个弹窗可以选择立即重启 or 稍后重启怎么样？」
以前装完只在页面顶部亮一条横幅，用户得自己注意到、再找到那颗按钮。

**最容易做坏的地方**（设计时就盯住的）：`noteRestartFrom` 有 5 个调用点（安装 / 更新 / 卸载 /
开关 / 自更新），而安装那一条是安装、更新、**一键更新**共用的。若每次都弹，「一键更新（N）」
就会**弹 N 次**。所以批量里每一步只记账（`defer:true`），由批量收尾统一问一次。

**两个「不撒谎」的细节**：①「稍后重启」**不是「取消安装」**——改动已经装好，绝不回滚，
横幅继续留着（`Esc` 与点遮罩同义）；②重启失败（助手没起来）必须**关掉弹窗**，否则它会永远
停在「正在重启」，而重启根本没发生。

**本轮验证暴露的一个方法论问题（写下来）**：这一轮 e2e 从 67→78，
但最初那 67 条**在弹窗写错的情况下也是全绿的**——因为 e2e 一直用 JS `.click()` 点按钮，
而 `.click()` **绕过命中测试**：覆盖层就算把整个页面盖住、按钮压在最底下，`.click()` 照样「成功」。
所以这一轮新增的断言改成用 `elementFromPoint` 做**真实命中测试**，直接断言
「两颗按钮的中心点命中到的就是按钮自己」。这正是 §12.16 那条判据的第二个实例：
**「能过」不等于「测到了」**。

另外记一条测量纪律：弹窗几何我是**量出来的**，不是看截图看出来的——
`market-restart-ask.png` 缩放后标题看着像压字，实测 `title.bottom <= body.top`，
是缩略图误导。肉眼判断要配一次真实矩形测量。

**本轮最终状态**：门禁全绿；`catalog-identity` **36/36**、`host-contract` **27/27**、
`client-copy` **32/32**、`self-update` **43/43**、真实浏览器 **78/78**。

### 12.19 代码质量与性能审查（v1.2.0 同期）

用户要求「审查并优化 代码质量和性能」。**先量再改**，量完否掉了自己两个假设：

**被否掉的假设（重要——写下来防止以后有人照着假问题去改）**：

1. 「`entriesForBundle` 对每个 bundle 扫一遍 plugins，是 O(B×P) 热点」——量了：真实
   场景（40 bundle / 60 plugin）**0.039ms**；夸张到 300×600 也只要 2.1ms。**不是问题，不改**。
2. 「不稳定 props 打穿了 `React.memo` 的记忆化」——`client.js` 里 `React.memo` 出现 **0 次**
   （`useMemo`/`useCallback` 也是 0）。没有记忆化可打穿。**不是问题，不改**。

**真实热点（唯一一处，已修）**：`/catalog` 每次请求都把整份目录重新做一遍搜索归一化。
用真实快照（4412 条）量：一次请求折叠 **30884 个字符串 = 33ms 同步 CPU**；拆开看
`NFKD` 8.5ms、`\p{M}+` 去组合符 **24ms**（扫 1.5M 字符）、`toLowerCase` 4.4ms。同一次
请求里 `buildMatchIndex` 还要再花 **12ms**。这些都在**宿主的事件循环**上——它同时
（通过同一份目录快照）服务于市场面板与流式输出，所以同步顿挫会直接顶到用户。

两处修复（`plugin-market/lib/catalog.js`，共 +58/−6）：

- `foldText` 按**字符串内容**记忆化（`Map`，上界 65536，满了整体清空）。
  为什么不是键在条目对象上的 `WeakMap`：`joinInstalled` 每次请求都用 `{...item}` 造新对象，
  那种缓存**永远命中不了**——这一点是先量出来才没有写错。
- `buildMatchIndex` 按**数组身份**记忆化（只留最新一份）。快照数组是不可变引用
  （lib 内无原地改写，`createCatalogCache` 换目录时整个替换数组），所以身份相同 → 索引必然相同；
  「刷新目录必须换索引」由身份天然保证。

**效果（真实快照，完整 `/catalog` 路径 join+filter+sort+paginate）**：单次请求
**53ms → 8ms**；逐字输入 6 个查询 **119ms → 68ms**；冷启动首帧不变（~75ms，必然要建一次）。

**证据强度**：新增门禁套件 `verify/catalog-search-cache.test.mjs`（**11 条**，已被
`release.ps1` 自动纳入，现共 **13 个**套件）。缓存类代码是「写错了也照样跑」的那种——
结果依旧正确、测试依旧全绿，只在特定条件下静静给错答案，所以做了**变异测试 4/4 全被捕**：

| 变异 | 被捕获 |
|---|---|
| 索引换数组时不重建（有旧的就复用） | ✓ 8 条断言 |
| 索引改用**数组长度**当键（像身份但不是） | ✓ 6 条断言 |
| `foldText` 改用**字符串长度**当键（不同字符串相撞） | ✓ 4 条断言 |
| 查询侧不再归一化（`JOSÉ` 搜不到 `josé`） | ✓ 4 条断言 |

变异后按字节还原并校验一致。**变异测试自己也纠了一次**：第一版 M1 我写成「删掉整个
快速路径」，结果套件**全绿**——因为那是把缓存去掉、每次都重建，语义仍然正确，只是变慢。
那不是 bug 而是性能退化，所以换成真正的语义破坏。这条也说明「变异没被捕获」未必是断言弱，
可能是变异本身不构成错误。

**顺带修正一处失实注释**：我最初写「搜索框每敲一个字就发一次 /catalog」，读了客户端
`commitQueryInput` + `SEARCH_DEBOUNCE_MS=300` 后发现**是防抖的**，注释已改为如实描述
（防抖落定后一次 + 翻页/改排序/切分类/刷新各一次）。

**本轮验证**：门禁全绿（13 套件）；真实浏览器 **78/78**（搜索路径被真实覆盖）。

### 12.20 独立审计发现的真实缺陷与修正（v1.2.0 同期）

§12.19 是我自己量自己改。为了不再犯「自己验自己」的错，这一节的两个半都交给
**独立审计**（host 半 / client 半分开、只读、被明确要求「一开始怀疑但量完不成立的也要报」）。
它们报回来的东西里**有 6 条是真缺陷**，其中 2 条会造成用户可见的错误状态。

**最严重的一条：把别人的插件标成「已安装 / 可更新」**（host 半发现，我独立复现）。

`buildMatchIndex` 的 `putBareName` 用**原始** repo 名当 `nameKeys` 的键，而所有查表都走
`lookupKey`（会 `normalizedKey` 小写化）。真实目录（4412 条）里有 **88 个**仓库名含大写字母，
实测结果：**0 个命中自己、5 个标到了另一个 owner 的同名小写仓库**：

```
bill277048-hash/DSH-model-router  ->  被标成已安装: superboy911/dsh-model-router
hajimimaodie8/DSH-Session-Sync    ->  被标成已安装: PerryLink/dsh-session-sync
didclawapp-ai/DSH-Office          ->  被标成已安装: Fayelin12/dsh-office
shengsheng90/DSH-taskboard        ->  被标成已安装: cloader/dsh-taskboard
nanshan1995/DSH-Plugin-Market     ->  被标成已安装: kimiya1010/dsh-plugin-market
```

这正是该文件注释里**明令禁止**的事（「歧义不猜…宁可不显示，也不能指错人」）——注释写对了，
代码没做到。一行修复（`normalizedKey(repo)` 当键）后：命中自己 **0 → 82**，标错 **5 → 3**。

修完仍有 6 条不命中，我**逐条查清**才收尾，不是「好看了就当修好了」：
- 3 条是目录里**真有同名 npm 包**（`dsh-office` / `dsh-session-sync` / `dsh-taskboard`），
  npm 名优先是**设计**，不是 bug；
- 3 条是不同 owner 的小写裸名真撞车（`dsh-model-router` 有 2 个仓库、`dsh-guardian` 有 3 个），
  修好后正确判为**歧义不猜**——比修复前「猜错到别人头上」正确。

**第二条：失败的自更新被渲染成绿色「更新成功」**（host 半发现，端到端链路可证）。

`self-update.js` 的 `ok` 只看 `value.error`，而宿主的 ChangeResult 里 `error` 是**可选**的：
`{application:'failed'}` 不带 error 时算出 `ok:true` → HTTP 200 → 客户端 `markSelfDone()`
+ 绿色「更新到 vX」。同一个文件里 `sendChangeResult` 早就把这条规则写清楚了
（`application === 'cancelled' ? true : error === null && application !== 'failed'`），
**两处规则漂移**。`/toggle` 也有一份同样的漂移。三处都改成同一条规则。

**第三条：并发 `ensure()` 每个等待者各自归一化一遍**（host 半发现）。`inflight` 只共享了
**网络**，`normalizeCatalog` 仍被每个等待者各跑一次（约 2.5ms），且各造一份新的 `plugins`
数组——这会让 §12.19 那个**按数组身份的索引缓存逐个被击破**，等于白做。改成只让第一个
等待者归一化、其余复用同一份快照（用对象身份断言验证 8 个等待者共用 1 个数组）。

**client 半发现三条**：①**发现页的「重试」是个死键**——`onRetry` 误接 `bumpTick()`
（只动 `installedTick`），而目录 effect 依赖 `catalogTick`，于是目录加载失败后点「重试」
**一个 `/catalog` 请求都不发**，报错框永远留在屏幕上（用户唯一的自救路径失效）；
②**退场计时器吞掉新回执**——200ms 退场窗口内来的新回执会被旧计时器一起 `setNotice(null)`，
本该活 4600ms 的气泡 200ms 就没了（注释宣称覆盖了这种情况，实际 cleanup 只在卸载时跑）；
③**英文表两颗黑按钮文案相同**——`action.recheckSelf` 与 `action.recheckSelfOnly` 都是
`"Check again"`，而它们自己上方的注释写着「必须不同」，中文表是区分的；门禁只断言了中文，
**漏掉一种语言就漏掉一种语言**。

**我自己在这一轮里犯的两个错（都记下来）**：
1. 修 ② 时我先写成「`setNotice(updater)` 里读 ref，之后同步清 ref」——函数式 updater 是
   **排队等渲染时**才执行的，等它跑到时 ref 已经是 null，判定永远失败，**气泡再也关不掉**。
   我那条正则形状断言**通过了**，是**真实浏览器 e2e** 报「提示条没自动收起」才抓到的。
   教训与 §12.16/§12.18 一致：形状断言证明不了行为。已改成先取值到局部变量再比对，
   并把「updater 内不许读 ref」反写成一条断言。
2. 我的 `check()` 是同步的，写了个 `async` 回调进去会**「通过」但断言没跑完**——又一个
   「测试通过本身是假的」，已加 `awaitCheck` 就地 await。

**证据强度**：新增/扩充后 `catalog-search-cache` **15 条**、`client-copy` **34 条**、
`self-update` **45 条**（+3 条专测 `ok` 推导规则：`failed`⇒false / `cancelled`⇒true /
带 error 无 application⇒failed）；**变异测试 7/7 全捕获**（host 3 + client 4，含我上面
犯的那个 ref bug 的形状），变异后按字节还原。

**审计的净产出还包括「否掉的假设」**：host 半明确写下并**撤回了自己第一个性能数字**
（`joinInstalled` 12ms 未能复现，4 个进程重测为 **0.31ms**，他主动丢弃了那个数）；
`bundleNameFor` 的 O(n³) 在真实规模只有 0.7ms、**不列为缺陷**；`AbortSignal.timeout`
不持有事件循环（**否认**定时器泄漏）；`readJsonBody` 的 stalled-client 风险**未能归因**
于本插件，如实标为「未证实」。这些和我 §12.19 否掉自己两条假设是同一个动作。

**有意不改的项（记下来，避免以后被当成漏改）**：
- `restart-helper.cjs:76` 的 `child.on('error')`：**量过确认当前不可达**（ENOENT 的 `error`
  事件约 1ms 后才到，而函数紧接着就同步 `process.exit(0)`；我用探针复现：不存在的 execPath
  → 助手 exit 0、stdout/stderr 全空）。**但保留**：它同时是「将来若去掉那次同步 exit」的保险
  （EventEmitter 无 `'error'` 监听时会直接抛）。实测去掉监听在当前也是 exit 0，所以留着零成本。
  注释已如实改写为「当前不可达 + 为什么仍保留」，不再谎称它在兜底。
- **零调用的导出**（`catalog.js` 的 `invalidate`/`sources`/`config`、`self-update.js` 的 `reset`）：
  删导出是**兼容决策**而不是质量修复，收益接近于零，留给后续按需处理。
- 纯样式/文案类 cosmetic（`repoTail` 的一处旧注释与实现描述不同但真实数据下等价、
  `formatDate` 其实不格式化、几处死 CSS 与死 `t()` 多余入参、三个函数缩进列不同）：
  都不改变行为，本轮不动；其中死 CSS 里有两条被 `client-copy.test.mjs` **要求保留**，
  说明「看着没用」不等于能删。

### 12.21 用户实测失败排查：两个插件、两个不同原因（v1.2.0 同期）

用户报「我在插件市场装了俩个插件都没能成功 你排除一下问题」。查的是**他真实 profile 的
宿主日志**（`~/.dsh/profiles/desktop/.plugin-manager/logs/operation-*/pnpm.log`）。**两个失败
原因完全不同**——这正是「看起来同一件事、其实两回事」的典型：

**插件一 `@linxin666/dsh-remote-web-ui`：文件被占用。** `operation-U78OT0`：
`[ERR_PNPM_EPERM] [importPackage ...\node_modules\dsh-our-free-model] EPERM: operation not
permitted, scandir`。注意报错目录**不是要装的那个包**，而是另一个插件——DSH 正在运行
（实测 6 个 `DeepSeek Harness.exe` 进程），它持有那个目录的句柄，pnpm 去 `scandir` 被拒，
**整个事务回滚**。市场对这类错误的识别本来就是对的（`fileLockedDetail` 命中 `ERR_PNPM_EPERM`）。

**插件二 `dsh-mobile`：连不上 npm 源。** `operation-GopJYb` 里刷了几十条 `ECONNRESET`、
`Request took 72331ms`，最后卡在 `color-name` 的「Will retry in 1 minute」——日志到此为止，
**没有 `Done in`**。我实测这台机器：`registry.npmjs.org` **15s 超时不通**、
`registry.npmmirror.com` **HTTP 200 / 366ms**。而日志里 **34 次请求全是 registry.npmjs.org、
0 次镜像**。

**这里有一条我自己的设计盲区（本轮修掉）**：抓目录走镜像（`catalog-npm.js` 镜像优先），
但**真正安装是交给宿主 pnpm 的**，用 pnpm 自己的 registry。两条通道不同 →
用户会看到最难解释的一种现象：**能浏览、能点安装、一下载就失败**。

**修了什么**（`plugin-market/lib/client.js`，只动错误呈现，不动任何安装行为）：
新增 `registryUnreachableDetail`（只认**具体**网络签名：`ECONNRESET`/`ETIMEDOUT`/
`UND_ERR`/`Request took Nms`/`ERR_PNPM_FETCH*` 等），命中时 errorCopy 切到
`err.registry-unreachable.*`，**给出「在该 profile 目录建 .npmrc 写 registry=镜像」**；
**占用优先于网络**（诊断里可能混着 registry 字样）；两处行内短句原本各写一遍同样的三元
表达式，抽成共用的 `shortFailureText`（否则又是一次「两处规则漂移」）；详情行现在也露出
网络诊断原文（此前只显示宿主通用句「宿主执行这个操作时报错。看宿主日志里的 pnpm 输出」）。

**这条建议是核实过的，不是猜的**：从 asar 里抽出 `@deepseek-ai/dsh-plugin-manager` 确认
pnpm 的 `cwd` **就是 profile 目录**、且 `extendEnv: false`（env 被清洗），所以 profile 下的
`.npmrc` 确实会被读到。

**我在这轮自己差点犯的错**：第一版文案我写了 `{profileDir}` 占位符——但宿主只暴露 profile
**名字**、不暴露目录，那个占位符会**原样渲染给用户**。这正是我在修的那类「给用户看没用的
东西」，在写的时候就撞上一次，已改成 `DSH_HOME/profiles/<profile>` 这种可自行代入的形式。

**证据强度**：新增门禁套件 `verify/error-classify.test.mjs`（**18 条**）——它把真 bundle 里的
识别函数**取出来执行**，喂**从那份真实 pnpm 日志里逐字抄下来的原文**。刻意不写纯形状断言：
这一轮（和上一轮）反复证明「正则匹配到了」≠「行为对」。变异测试 **6/6 全捕获**（删签名 /
放裸词 network|registry 进匹配集 / 去掉占用优先闸门 / errorCopy 不切文案 / 行内不报镜像 /
详情行不露诊断），变异后按字节还原。**变异也纠正了我一次**：第一版 5 个变异里「行内短句
不报镜像」没被捕获——那暴露的是**我的测试漏了 `shortFailureText`**，补上行为断言后 6/6。

**顺带清掉了残留**：`dsh-mobile`（66.2MB）与 `@linxin666/`（2.1MB）都是**无主残留**
（`package.json`/`lockfile`/`cordis.patch.yml` 三处均无记录、`.pnpm` 虚拟仓里也无记录），
删除前已备份三个清单文件。`dsh-mobile` 的状态尤其坑：文件都在 `node_modules`、
**但不在任何清单里**，所以「看着装上了、永远不会被加载」——这正是用户说的「没能成功」。

### 12.22 找到「还是安装不了」的真根因：**批准构建脚本的入口是死代码**（插件自身 bug）

§12.21 修的是「错误提示不够可操作」，但那**没解决问题**——用户反馈「还是安装不了」。
这一节是继续排查，最后定位到**插件自身的 bug**。

**先否掉三个嫌疑（每一步都是实验，不是推理）**：

1. **pnpm / 镜像 / 包坏了？→ 否。** 在 profile 目录手动跑宿主的原命令
   `pnpm add @linxin666/dsh-remote-web-ui@0.4.5`（`cwd` = profile 目录，`.npmrc` 已配镜像）
   → **装成功了**（`+ 0.4.5, Packages: +5, done`）。
2. **只有市场这条路坏？→ 否，是宿主共同路径。** 用宿主自己的 CLI
   `dsh plugin --profile desktop add …` 跑**同一条 `pluginManager` 代码** → **也失败**。
   这条差分的价值：**把「插件的请求路径」和「宿主自身的路径」分开**，从而知道
   不是我的 HTTP 层写错了。
3. **失败点在哪？→ `[ERR_PNPM_IGNORED_BUILDS]`。** CLI 的输出直接点名：
   `Ignored build scripts: cloudflared@0.7.3` + `Run "pnpm approve-builds"`。
   `cloudflared` 的 `postinstall` 要下载二进制，pnpm 11 **默认忽略**它并非零退出。

**真根因（读代码 + 读宿主实现确认）**：宿主把这次 `installBundle` 折成
`{ application:'failed', error, pendingBuilds:['cloudflared'] }`，语义是
**「没装成，但只差用户批准一下」**（宿主源码里 `readPendingBuilds` 专门识别
`allowBuilds: <name>: set this to true or false` 这个 pnpm 写的占位并列出待批准包，
还配了 `approveBuilds` 写入批准——**批准本来就是预期路径**）。

而我的 `sendChangeResult` 把 `application:'failed'` 一律报 **`ok:false`**，客户端
`requestJSON` 在 `ok !== true` 时**直接抛错**。于是客户端那段
「读 `payload.pendingBuilds` → `setPending(...)` 弹批准框」**永远不可达**：
用户只看到一条普通错误、**没有任何批准入口**，装多少次都装不上。

**修法一行**：`pendingBuilds` 非空时放行 `ok:true`（`cancelled` 的既有放行语义不变），
并把 `pendingBuilds` 的过滤提成变量复用。**只改错误/结果呈现，不动任何安装行为。**

**验证（三层，缺一不可）**：
- 新增门禁套件 `verify/build-approval.test.mjs`（**9 条**）：把真 `sendChangeResult`
  抠出来**真调并读它发出的响应体**——不是源码形状断言。先写测试**看着它失败**
  （`false !== true`），再改实现让它通过。
- **真实浏览器 e2e 78 → 82 条**，新增 [10] 直接断言：批准确认条出现过、点了名
  `cloudflared`、有「允许并安装」按钮、toast 指路。截图 `market-build-approval.png`
  人工复核过：确认条写明「会在你的机器上运行」+ 两颗按钮，是可读可用的。
- **变异测试 4/4 全捕获**（回到旧规则 / 无条件放行 / 不透传 pendingBuilds /
  不过滤脏数据），变异后按字节还原。

**这一轮我自己的两个错，都记下来**：
1. **我最初的诊断方向偏了**：一轮里花了很多步去读宿主 asar 内部实现（`change()`、
   `registryPlan`、`runProfilePnpm`…）。真正定位根因的是**差分实验**
   （手动跑命令 / 用宿主 CLI 跑）**加**读一处关键代码（`requestJSON` 的 `ok!==true` 抛错），
   而不是把宿主源码读遍。**先做能证伪的实验，再读代码。**
2. **我的新断言第一版找错了元素**：批准按钮与包名在 `.dshpm-banner`（确认条），
   我却去 `.dshpm-notice`（toast）里找，导致两条断言**假失败**——而同一轮的第一条
   断言已经证明横幅出现了。是**输出文件里的原始文本**（toast 自己写着「请在下方确认条里批准」）
   纠正了我。**断言失败先怀疑断言，别怀疑产品。**

另外记一条环境教训：这一轮 e2e 出现过两次「跑 20 分钟不结束」。查下来**不是代码问题**，
而是被 kill 的作业留下了 `%TEMP%\dshpm-cdp-*` 临时 profile 与孤儿宿主进程；
清掉临时目录后立刻恢复（78/78 → 82/82）。**e2e 卡住先清临时态与孤儿进程，再怀疑代码。**

### 12.23 第二轮审查：候选名没去重，更新已装插件的激活状态被误判成 unknown

用户要求「再次审查代码 找出bug并修复」。这一轮的方法与前几轮不同：**先并行派 4 个独立审计**
（catalog / self-update+restart / client 数据层 / client 渲染层），我自己读 host 的
路由-安装-激活链路、`http.js`、版本比较。结果是**审计没先报回来，我自己在读 `index.js` 时先撞上了**。

**发现过程**：读 `verifyActivation` 时注意到 `candidates` 只是 `.map().filter().map()`，
**没有去重**，而下游两处都拿 `.length` 当「几个不同的东西」用：

```js
const present = candidates.filter((key) => after.has(key))
if (present.length === 1) hit = after.get(present[0])
else if (present.length > 1) ambiguous = true      // ← 数的是「出现次数」
```

**然后去核对真实调用点，而不是自己猜**：`install()` 传
`candidates: [hit?.npm, hit?.name, hit?.id, requestedSpec, requestedName]`；客户端
`updateBundle()` 发的是 `submitInstall({ name: bundle.name, spec: bundle.name })`。
于是 `requestedSpec === requestedName === bundle.name`，而目录里 `npm` 常常就等于
`bundle.name`——**同一个字符串在数组里出现 3~5 次**。更新**已装**插件时 `before` 里已有它
（`appeared` 为空），必然走到 present 分支。

**先证实再动手**（在 `%TEMP%` 里跑真 `verifyActivation`，注入真实调用点的候选形状）：

```
【更新已装插件】candidates 有重复 → {"state":"unknown",...,"reasons":["ambiguous-bundle"]}
【对照】candidates 去重           → {"state":"live","installed":"0.1.5","versionMatches":true}
```

**影响面用真实目录（4412 条）量**：2288 个有 npm 的条目 **100% 命中；修后 0%**。
两个用户可见后果，第二个才要命：

1. 一次成功的更新渲染成 `installUnknown`（蓝 info「没能回读装载状态」）而不是绿色「已在运行」；
2. **`versionMatches:false` 那条「磁盘上还是旧版、更新没落地」的告警被整个盖掉**——
   走不到 `hit` 分支就根本不算版本，用户于是**以为更新成功了**。
   修完后单独验证过：`{"state":"live","installed":"0.1.4","versionMatches":false}` → 告警回来了。

**修法**：候选名先 `new Set()` 去重。**TDD**：先写断言 → 跑 → **看着它失败**
（`'unknown' !== 'live'`）→ 再改实现 → 28/28 通过。回归里带**反向断言**：
两个**不同**名字各自命中一个 bundle 时**仍须**报 `ambiguous-bundle`，防止「去重」把真歧义
一起抹掉。**双向变异 2/2 全捕获**（① 改回不去重 ② 只留第一个候选），变异后按字节还原、
sha256 一致，`git status` 只有预期的两个文件。

**为什么既有测试全绿也挡不住**：那 7 条相关断言**全都只传单个候选名**，从不传重复项。
**断言的输入形状与真实调用点不一致时，全绿不代表没问题**——这比 bug 本身更值得记。

**同轮被否掉的两个假设（都做了实验、都不改代码）**：
- `updateBundle` 发 `spec = bundle.name`，我怀疑宿主的 `/install` 会因「spec 必须命中目录的
  `spec|npm|url`」而 400 `not-in-catalog`。**用真实目录跑：0/2285 失败**——每个可更新 bundle
  的名字都命中 npm 索引。**假设否掉，不动代码。**
- `readJsonBody` 超限分支的注释说「继续把剩下的字节读掉，否则客户端可能收到 ECONNRESET」，
  但 `finish()` 先置 `settled`、之后每个 `data` 都 `if (settled) return`——注释与代码不符。
  **起真 http server 发 100 KiB 体实测：6/6 都拿到干净的 400 JSON、0 次 reset。**
  所以**行为是对的、注释是错的**；不是缺陷，本轮不改（避免无收益改动）。

**另外故意不修的一处**（写下来防止下次「顺手修好」）：`self-update.js` 的 `apply()` 不认
`pendingBuilds`，与 `sendChangeResult` 的规则漂移。但它**不可达**（市场包
`dependencies`/`optionalDependencies` 皆空、无 `postinstall`），**而且单方面放宽 `ok` 更糟**：
客户端 `applySelfUpdate()` 的 `.then()` 里**无条件** `markSelfDone()` + 绿色
`notice.selfUpdated`，根本不读 `application`/`error`/`pendingBuilds`。只改宿主那一行，
等于把今天一条**诚实的失败**换成**假绿灯**。要做得连激活校验与批准入口一起加，记为 ROADMAP P1.5。

**验证汇总（本轮）**：门禁 PASS（15 套件，host-contract 27→**28**）；
真实浏览器 e2e **82/82**；变异 **2/2**。
（e2e 第一次跑 exit=1 且输出被 wrapper 吞掉；清掉 `%TEMP%\dshpm-cdp-*` 后重跑 **exit=0、82/82**
——仍是上一条记的那个已知环境抖动，不是代码问题。）

### 12.24 第二轮审查（并行审计）：9 处修复，其中一条把上一轮的修复整个抵消了

用户第二次要求「再次审查代码 找出bug并修复」。这轮换了方法：**并行派 3 个只读独立审计**
（catalog / self-update+restart / client 数据层与渲染层），我自己读 host 路由、`http.js`
与进程管理。**审计这次真的返回了完整报告**（上一轮那 4 个没返回，我在结论里明确说过它们不算数），
但我**没有直接采信**——9 条修复里每一条都先用**真函数**复现、再改、再做变异测试。

**最该记住的一条：我上一轮的修复被自己抵消了（F-HIGH）**

`errorCopy` 最后有一句兜底：未知错误码时把宿主原话塞进「为什么」，免得写「原因未知」。
条件原本是 `if (!locked && !known && message)`。而我上一轮给「连不上 npm 源」加的识别依赖
`unreachable`——**它没有被这个条件排除**：

- 宿主把 pnpm 非 0 退出归成 `operation-error`；
- `operation-error` **不在** `ERROR_PREFIXES` 里 → `known === false`；
- → 这句兜底生效，把刚选好的专属解释覆盖成宿主的通用句「宿主执行这个操作时报错。」

于是用户看到标题和「下一步」都在说「去配镜像」，**唯独「为什么」那一句退回了无效信息**
——`76110d9` 那次修复的**全部价值就在那一句上**。修法：条件补 `unreachable === ""`。

**为什么上一轮 18 条断言全绿也没拦住**：`error-classify.test.mjs` 只**直接调用**
`fileLockedDetail` / `registryUnreachableDetail` / `shortFailureText`，并用正则断言 `message:`
那一行。而 `errorCopy`——**真正决定用户看到哪段文案的那个函数**——在 `verify/` 里
**从未被执行过**。两轮下来同一个教训重复出现两次：**测了零件，没测把零件组装起来的那个函数。**

这条现在有牙了：新增 `verify/client-errorcopy.test.mjs`，把真 `errorCopy` 抠出来**真调**，
断言 `operation-error + ECONNRESET 诊断` 时 `why` 必须仍是网络专属解释；
并带三条对照（未知码仍要兜底、占用类优先、known 码不被覆盖），**变异 1/1 抓到**。

**关于「谁对谁错」的两处判断（我把审计的结论改掉了一处）**

- 审计把「一个条目带 npm 就 `continue`、另一个 owner 的 git-only 同名条目不判歧义」报成
  **BUG B（HIGH）**。**我实测后判定它不是 bug，行为是对的**：`aaa` 的 npm 是
  `@aaa/dup-repo` → 装 `aaa` 得到的是带 scope 的 bundle 名，走 npm 精确命中，**根本不经过裸名**；
  裸名 `dup-repo` 只可能来自 `bbb`（它没有 npm）。按审计的建议改成歧义，会让 `bbb` 用户
  **丢掉一次正确的匹配**（假阴性）。我用测试把结论钉住：混合场景下裸名必须命中 `bbb`
  （`latest=0.2.0`），而**两边都无 npm** 时才是真歧义（`latest=null`）。
- 审计还报 `count:1.5` 与 `count:-1` 都能通过校验——**方向对，但描述不准**：我实测
  `{count:1.5, plugins:[]}` **是**被拒的（`declared > 0 && actual === 0` 命中），
  漏的是 `{count:1.5, plugins:[{}]}`（差值 0.5 落在 5 条容差内）与所有负数。修法按实际漏洞写。

**9 处修复（按发现顺序，全部有复现证据）**

| # | 缺陷 | 复现方式 |
|---|---|---|
| 1 | `errorCopy` 覆盖专属解释（**抵消上一轮修复**） | 真调 `errorCopy`：修前 why=通用句，修后=网络解释 |
| 2 | `validateCatalogPayload` 只挡正数 → 坏数据清空好缓存 | 真调：`count:-1` 放行；好目录 2 条 → 变 0 条 |
| 3 | `readJsonBody` 无读取超时 → handler 无限期挂着 | 真起 http server + 发一半卡住：修前 2.5s 不 settle |
| 4 | `gunzipSync` 无上限 → 解压炸弹 | 255 KiB 压缩 → 256 MB 解压；`maxOutputLength` 生效 |
| 5 | 孤立代理项 → `URIError` → 面板整棵卸载 | 真调 `appendParam('abc\uD83D')`：修前抛 URIError |
| 6 | 两条开关路径只看 `error` → cancelled 报成功 | 真调 `toggleNotice`：cancelled ⇒ info，不再绿色 |
| 7 | `readOnlyReason.not-removable` 无文案 → 开关被误解锁 | 宿主的 `READ_ONLY_CODES` 三个码 vs 表里两个 |
| 8 | `onDone` 被顶替的请求吞掉 → 按钮停在「检查更新」 | abort 路径在 `isCurrent` 处 return，走不到回调 |
| 9 | CSS 层叠覆盖骨架屏 shimmer；一处死条件 | 同特异性、后者赢；`retrying` 写在 error 分支里恒 false |

**新增两个门禁套件**（这些模块此前 `verify/` 里**一条断言都没有**）：
`verify/robustness.test.mjs`（**9 条**）与 `verify/client-errorcopy.test.mjs`（**14 条**）。
门禁 15 → **17 套件**；真实浏览器 e2e **82/82**；**变异 4/4 + 1/1 全捕获**。

**我自己这轮犯的两个错（都留痕，因为都是方法论级别的）**

1. **把反引号写进 CSS 注释**——而那整段 CSS 是 JS 的**模板字面量**，反引号直接把字符串截断，
   `client.js` 立即语法错误。所幸门禁第一步就是 `node --check`，秒级抓到。
   教训：**往模板字面量里写注释时，别用反引号。**
2. **变异测试脚本被 kill 时把变异留在了磁盘上**（`http.js` 里留了个 `if (false)`），
   而我的「还原校验」拿的**正是已被污染的内容**当基准——于是**自己认证自己通过**，
   还把随后的失败误读成「没抓到」。修完才发现。改造后的做法：
   **先跑基线、基线不通过就拒绝继续**；`try/finally` 保证还原；结束后**复跑基线**确认干净。
   教训：**任何「改文件再还原」的自动化，都必须有一个独立于被改文件的基准。**

### 12.25 第三轮审查：桌面版一键重启会把应用整个杀掉（HIGH）

第四个独立审计（读 `self-update.js` / `restart.js` / `restart-helper.cjs` / `http.js`）报了一条 HIGH：
**桌面端点「重启 DSH」会杀掉宿主且不会有替代品起来**。这条涉及我自己写的功能，所以我先核对再动手。

**先自己确认拓扑**（活动进程表）：

```
7872  "…\DeepSeek Harness.exe"                                    ← GUI 主进程
19496 "…\DeepSeek Harness.exe" --expose-internals <entry> <asarDsh> <profile> …  ← 宿主，7872 的子进程
```

**再从壳内源码拿流程证据**（`app.asar/lib/main.js`）：
- 第 3674–3691 行：壳用 `spawn(this.node, ['--expose-internals', entry, …],
  { stdio: ['ignore','pipe','pipe','ipc'], env: desktopNodeEnvironment(...) })` 拉起宿主
  ——**最后一个 stdio 项是 `'ipc'`**，所以宿主是**受 IPC 管理的子进程**；
- 第 3529–3538 行：`desktopNodeEnvironment` 设 `ELECTRON_RUN_AS_NODE: '1'`；
- 第 6870–6877 行：`if (!application.requestSingleInstanceLock()) { application.quit(); }`。

**机制**：助手拿到的是**宿主**的 `execPath`/`argv`，删掉 `ELECTRON_RUN_AS_NODE` 再拉起同一个 exe
= **启动 GUI**（不是以 node 跑那个入口）→ `requestSingleInstanceLock()` 失败（7872 还持锁）
→ 立刻 `application.quit()`（实测 exit=0、无输出、231–391ms）→ 宿主已退出、替代品也死了
→ **整个应用什么都不剩**，壳随后弹「DeepSeek Harness 无法使用」。

**为什么不是「某个变量写错」**：参考实现里 `restartAllowed()`/`detectedSupervisor()` 对同类问题的
结论是同一句话——**有监管者的部署里，「重启」不属于这个插件**（systemd 下 `KillMode` 会把 detached
助手一起杀掉，桌面壳下会被单实例锁挡在门外）。所以**如实拒绝、不半修**：
`isDesktopManagedHost()` 用「node 模式 **且** 有 IPC 通道」两个信号（终端 `dsh web` 的宿主没有 IPC
通道，不能被误伤）→ `/status` 报 `restart.available:false`、`POST /restart` 回 `409 restart-unsupported`
且不 spawn、不置 `requested`；客户端据此**不弹重启询问窗、不给重启按钮**，改说「关掉窗口再打开」。

**这一轮最值得记的一条：审计的第一版假设是错的，而它自己证伪了。**

它最初以为 bug 是「删掉 `ELECTRON_RUN_AS_NODE` 导致 node 启动失败」，隔离实验
（`exp-reboot2.mjs`）显示那个 exe 其实**成功启动了一个 GUI**，它才改成「单实例锁」。
**这个改口是整件事的关键**：如果按第一版假设去修（保留那个变量），桌面端会变成
「以 node 模式再起一个宿主」，同样起不来——**结论对而机制错，修法就会错**。
我复核后独立确认了机制（先看进程表，再读壳源码三处），才动手。

**同时修的另外 4 处**（都在 `self-update.js`，用真实 `apply()` + 假 manager 实测）：

| 缺陷 | 症状 | 修法 |
|---|---|---|
| 失败丢 `diagnostic` 与顶层 `code` | EPERM 被报成「插件市场内部出错了，稍后重试」 | 两个字段都透传 |
| `ok` 规则与 `sendChangeResult` 漂移 | `pendingBuilds` 非空时报失败（批准入口成死代码） | 补上放行并透传 `pendingBuilds` |
| 空结果算成功 | 宿主回 `{}` → `applied`/`ok:true` → 客户端亮绿灯 | 与 `index.js` 同判 `failed` |
| `managerOf` 抛错冒出 `apply()` | 500 internal + 通用句（安装抛错却是折叠的） | 折成 `manager-unavailable` |

**验证**：门禁 PASS（17 套件；self-update 46→**50**、restart-helper 8→**10**）；
真实浏览器 e2e **82/82**。









