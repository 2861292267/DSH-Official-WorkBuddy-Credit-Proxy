# DSH 官方版 · WorkBuddy 积分反代

把本机已登录的 **WorkBuddy** 账号合并成一条**自动故障转移的模型池**，接入 **DeepSeek Harness 官方版（DSH Desktop）**，
用 WorkBuddy 的积分驱动 GLM / DeepSeek / Kimi 等模型。

> **本仓是改编版。** 基础插件为 [`XDTrees/dsh-workbuddy-xdpool`](https://github.com/XDTrees/dsh-workbuddy-xdpool)（MIT，作者 **XDTrees**），
> 本项目针对 DSH Desktop **0.1.7-rc.2** 内核做了兼容修复，并新增若干能力（见 [改动清单](#改动清单)）。
> 原作者版权归 XDTrees 所有，许可证见 [`LICENSE`](LICENSE)。原版文档见 [`UPSTREAM-README.md`](UPSTREAM-README.md)。

---

## 为什么需要这个改编版

原版（1.6.1）是按内核 **0.1.5** 写的。DSH Desktop 在 2026-09-25 自动升级到 **0.1.7-rc.2** 后，
原版会让官方版**启动失败或功能残缺** —— 不是配置问题，是内核 API 变了：

| 症状 | 断裂点 |
|---|---|
| 应用弹「无法启动」、弹窗提示 `pending (waiting for service: settingsScope)` | 客户端服务 `settingsScope` 在 0.1.7 改名换接口 |
| 应用能开，但 ~20 秒后 host 子进程退出 | 设置写入失败被抛成未捕获异常，打死整个 host |
| 卡片出现在设置里，点开**整块空白**（无任何报错） | 卡片注册到了 0.1.7 已删除的 slot；组件用了已不存在的图标导出 |
| 改设置「点了没反应」 | 配置写进了 profile，但 0.1.7 删掉了触发应用的 `onChange` 回调 |

---

## 目录结构

| 位置 | 内容 |
|---|---|
| 仓库根目录 | **插件本体**（`package.json` / `cordis.patch.yml` / `lib/` / `assets/`），`package.json` 已声明 `dsh.bundle`，可直接被 `dsh plugin add` 安装 |
| `patches/` | 全部改动脚本（**幂等**，可对任意 1.6.1 原版重放） |
| `tools/` | 重启验证、账号导入辅助脚本 |
| `UPSTREAM-README.md` | 原作者 README（原样保留，含功能截图） |

---

## 改动清单

### 一、内核 0.1.7 兼容修复（7 处）

| 脚本 | 位置 | 改了什么 |
|---|---|---|
| `patch_xdpool_full.py` | `index.js` | ① 设置 namespace 对齐真实 entry id（`workbuddy-xdpool` → `llm-workbuddy-xdpool`）② `Config` 补 `meta.volatile`（0.1.7 的写入权限门槛）③ 配置改为从 `settings.describe()` 实时读取 ④ 设置写入异常降级为告警，**不再打死 host 进程** |
| `patch_xdpool_full.py` | `client.js` | 客户端服务 `settingsScope` → `configForms` |
| `patch_xdpool_section.py` | `client.js` | 卡片挂载槽位 `settings.plugin.item`（0.1.7 已删）→ `settings.section`，字段一并换（`key`→`id`、`priority`→`order`、补 `label`） |
| `patch_xdpool_icon.py` | `client.js` | 图标导出名 `IconChevronDownOutline14` → `IconChevronDownOutlineRegular`（0.1.7 改了命名规则，裸名只存在于注释里）；并保留一个错误边界，让渲染异常**显示**而不是静默空白 |
| `patch_xdpool_live_config.py` | `index.js` | 订阅 `settings/document-updated`，配置一变就重新读取并应用（替代被删除的 `installSection().onChange`） |
| `patch_xdpool_debug.py` | `client.js` | （可选，诊断用）把组件异常直接画在界面上，用于定位"整块空白" |

### 二、新增能力（3 处，2026-09-25 上午）

| 脚本 | 能力 |
|---|---|
| `patch_xdpool_autoscan.py` | **启动即自动检测账号**。原实现的扫描写在 `shim.listen()` 回调里、且在 provider 注册的 `catch { return }` 之后 —— 注册一抛错就整段跳过，池会空着等用户手点。改为独立启动钩子（不受 shim/注册结果影响），并把结果写入 `~/.dsh/.workbuddy-xdpool/boot-scan.json` 便于核对 |
| `patch_xdpool_switch_sync.py` | **启动时从 workbuddy-switch 账号库自动同步**。读 `~/.wb-switch/accounts.json`，镜像成插件认的凭据文件，此后在 switch 里换号 / token 续期都不必手工导出导入。只在源文件 `size:mtime` 变化时重写；**源缺失或损坏时绝不清理已有凭据**；只增删自己前缀的文件，不碰桌面 App 的活动凭据 |
| `patch_xdpool_oauth_scan.py` | **卡片内「扫码添加账号」**。见下节 |

### 三、卡片内扫码添加账号（2026-09-25 上午）

原插件**自己不会添加账号** —— 它的 `login` 子命令只是一段说明（"去 WorkBuddy App 扫码登录，再抓快照"）。
本版把桌面客户端的登录流程复刻进了插件：

```
POST {网关}/v2/plugin/auth/state?platform=workbuddy     header: X-Client-Platform: workbuddy
     → {code:0, data:{state, authUrl}}
登录链接 = authUrl（https://www.codebuddy.cn/login?platform=workbuddy&state=…）
GET  {网关}/v2/plugin/auth/token?state=…     code 11217 = 等待扫码中；0 或 200 = 成功
GET  {网关}/v2/plugin/login/account?state=…  → 账号资料
网关：国内 = https://www.codebuddy.cn   国际 = https://www.workbuddy.ai
```

> `code` 起点：**0 和 200 都算成功**。只认 0 会让成功时返回 200 的应答被误判为失效并丢弃令牌（详见上文「四、2026-09-25 追加」一节）。

- 宿主侧新增两条路由：`POST /plugins/dsh-workbuddy-xdpool/oauth/start`、`GET .../oauth/poll`
- 客户端在「账号使用方式」按钮区新增「添加账号」+ 登录链接面板（**命中即自动打开系统浏览器**，无需手点）+ 2.5 秒轮询
- 登录链接直接取自上游返回的 `authUrl`；仅当其缺失时才回退用 `qrcode` 渲染二维码兜底。`qrcode` **用动态 `import()` 加载** —— 缺包只让兜底不可用，不会让整个插件加载失败
- 扫到的账号存为 `workbuddy-scan-<id>.info`（独立前缀），**不会被 switch 同步覆盖**
- 诊断写 `~/.dsh/.workbuddy-xdpool/oauth-last.json`，含真实 `code` 与分类，**不含 token**

### 四、2026-09-25 追加：用量统计、扫码改链接、5xx 换号、去手机号登录

> 这一批改动**直接写进 `lib/`**（不走 `patches/` 重放），已随本仓提交。

| 能力 | 说明 |
|---|---|
| **积分用量四格条** | 卡片顶部显示「剩余积分 / 今日消耗 / 近 7 天消耗 / 本月消耗」。剩余积分来自上游已有的按包余量求和；**三个消耗窗口上游没有接口**（`meter/usage`、`get-user-usage`、`consume-record`、`get-consume-record`、`daily-usage` 实测全部 404），因此由插件自己记账：每次拿到账号余额就与上次比较，**下降记入当天**、上升（充值/重置/换包）不计，按本地日期分桶后滚动汇总 |
| **扫码改可点链接 + 自动打开** | 二维码换成可点链接并**自动用系统浏览器打开**，不必掏手机扫。宿主主窗口注册了 `setWindowOpenHandler`：对 http/https 先 `shell.openExternal(url)` 真正拉起浏览器，**然后**返回 `{action:"deny"}` 取消渲染进程建窗 —— 所以 `window.open()` 在**成功时也返回 `null`**，不能据此判定「被拦截」（早先版本正是在这里误报过）。二维码保留为 `authUrl` 缺失时的兜底 |
| **修复扫码成功却被判失效** | 原轮询只认 `code === 0`。上游成功时若返回 `code: 200`，会被判成「二维码已失效」并**丢弃刚拿到的令牌** —— 表现就是「浏览器显示登录成功，插件却一直等待然后报错」。现改为 `0` 与 `200` 均视为成功（`oauthCodeSucceeded`），`11217` 仍为等待中 |
| **上游 5xx 纳入自动换号** | 原实现只有 `401/403`、`402`、`429` 会轮换到下一个账号；其余一律 `break`。上游 5xx（含网关偶发 **550**）属「换个号可能就好」的瞬时故障，却只试 1 个账号就放弃 —— 报错里 `after 1 account(s)` 就是这么来的，8 个号的池子等于白建。现 5xx 改为短冷却后换号重试，且**不置** `exhaustedByRateLimit`（否则报错文案会被篡改成「所有账号都被限流」，是假话） |
| **移除手机号登录** | 曾尝试用上游 `/v1/auth/sms/code/*` 做手机号+验证码登录，实测该族接口属账号主机的**绑定/解绑手机号**流程而非登录（客户端自己的文案是「绑定后，您可使用手机号登录当前账号」），且必须携带由 SSO 握手签发的 `state_token`，裸手机号换不出凭据。功能只能产出 `verified-no-token`，故连同客户端面板一并移除 |
| **轮询诊断增强** | `oauth-last.json` 现记录**真实 `code` 数值**、分类结果、响应顶层键与 `oauthShape` 后的正文（**仍不含 token**）。此前三种不同故障都被报成「listProviders 为空」，把人带偏过 |
| **卡片展开不再等** | 卡片原先在折叠状态下不加载数据（`if (!open) return`），所以要「点开箭头 → 空白等几秒」。现改为**挂载时即预取**状态，展开即可见；30 秒轮询仍只在展开时进行 |
| **「立即运行」不再卡界面** | 积分自动化的「立即运行」原会空等最长 3 分钟（90 × 2s 轮询）让按钮锁在「运行中」。该任务**本来就由宿主后台跑完、与界面无关**（宿主路由不 `await`，调度器 `startRunAll()` 立即返回），故改为点完立刻返回，提示改为「已开始执行，后台会继续跑完，可关闭面板」 |

**同一批修掉的几个真 bug**（均由独立复核发现，记录在此以免重蹈）：

- `dayKeyLocal` 收到数值而非 `Date` → 每次真实消耗观测都抛 `TypeError`，且被 credits 的 `catch` 吞成该账号的 `creditsError`：账本永远是 0，账号行还误报上游错误
- 「近 7 天」窗口差一（`>` 应为 `>=`），静默少算一天
- `usageLedgerCache` 在 `emptyUsageLedger` 声明前调用（TDZ），**整个模块 import 失败、72 个导出全灭**，而 `node --check` 是通过的
- `round2` 的有限值判断在乘法之前，溢出会漏出 `Infinity`（`JSON.stringify` 后变 `null`）
- 中文语言分支里混入了一句英文（`row.oauthExpired`）

> **关于用量数字的诚实说明**：三个消耗窗口是**插件自行累计**的，不是上游历史。装上之前或插件未运行的时段不会被补算，所以安装首日会接近 0 并随后增长。这一点在卡片上有 tooltip 说明，且仅当起始日期很新时才额外显示一行提示，不做常驻打扰。

---

## 安装步骤

前置：DSH Desktop **官方版**（本版按内核 `0.1.7-rc.2` 适配）、`pnpm`、Node 24。

```bash
# 1. 装进 DSH profile（默认路径 ~/.dsh/profiles/desktop，也可用 --profile web）
#    仓库根目录就是插件本体，clone 下来即可用
git clone https://github.com/2861292267/DSH-Official-WorkBuddy-Credit-Proxy \
  ~/.dsh/profiles/<你的profile>/node_modules/dsh-workbuddy-xdpool

# 2.（可选）二维码兜底依赖，纯 JS、无原生编译
#    登录链接已能自动打开；只有上游不返回 authUrl 时才回退二维码，此时才需要它
cd ~/.dsh/profiles/<你的profile>
pnpm add qrcode --config.minimumReleaseAge=0

# 3. 确认 profile 的 bundles 里有它
#    ~/.dsh/profiles/<你的profile>/package.json → dsh.profile.bundles 应含 "dsh-workbuddy-xdpool"
```

### 若要自己重放补丁（对任意 1.6.1 原版）

```bash
# 按顺序执行，全部幂等；每个脚本都会先把原文件备份成 *.orig-<标记>
python patches/patch_xdpool_full.py        # 内核兼容主体
python patches/patch_xdpool_live_config.py # 配置变更订阅
python patches/patch_xdpool_section.py     # 卡片挂载槽位
python patches/patch_xdpool_icon.py        # 图标名 + 错误边界
python patches/patch_xdpool_autoscan.py    # 启动自动检测账号
python patches/patch_xdpool_switch_sync.py # 启动从 switch 同步账号
python patches/patch_xdpool_oauth_scan.py  # 卡片内扫码添加（依赖 patches/_frag_oauth_*.js）
```

> ⚠️ 每个脚本里的路径常量按本机默认路径写死（`~/.dsh/profiles/desktop/...`），改环境时先改脚本头部常量。
> 改完 JS 务必做语法校验，否则插件加载失败会让应用起不来：
> ```bash
> ELECTRON_RUN_AS_NODE=1 "<DSH 安装目录>/DeepSeek Harness.exe" --check <复制出来的 .mjs>
> ```

---

## 验证方式

DSH host 每次启动会开三个本地端口，其中 **`19387` 固定且无需鉴权**（另两个随机端口要 Bearer）。
插件自己的路由都挂在下面这一层，可以直接调，不必开界面：

```bash
curl -s "http://127.0.0.1:19387/plugins/dsh-workbuddy-xdpool/status?region=cn"
curl -s -X POST -H "Content-Type: application/json" -d '{"region":"cn"}' \
     "http://127.0.0.1:19387/plugins/dsh-workbuddy-xdpool/oauth/start"
curl -s "http://127.0.0.1:19387/plugins/dsh-workbuddy-xdpool/oauth/poll?state=<state>&region=cn"
```

`tools/restart_and_verify.py`：杀净所有同名进程 → 重启 → 观察 150 秒 → 判定（进程数稳定 + 日志无新增崩溃 + 内部端口 LISTENING）。
**注意应用是单实例的**：不杀净进程直接再启动不会加载新代码。

---

## 安全须知

- **凭据是明文的**。插件读写的 `*.info` 文件里是可直接使用的 access token（桌面 App 本身就是这个格式）。
  本仓库**不含任何凭据**；请勿把你的 `.info` / `accounts.json` 提交上来。
- 本版的同步功能会把 `~/.wb-switch/accounts.json` 里的 token **复制一份**到
  `%APPDATA%\CodeBuddyExtension\Data\Public\auth\`。要回滚就删掉那批 `workbuddy-scan-*` / `workbuddy-pool-*` 文件。
- 扫码登录走的是桌面客户端自己的接口，**没有绕过任何鉴权**，消耗的是你自己的账号与积分。

## 免责声明

本项目仅用于本机自有账号的客户端适配与自动化，**不修改、不破解、不绕过 WorkBuddy / CodeBuddy 的任何收费或风控机制**。
请遵守相关服务条款；因使用本插件导致的账号风险由使用者自行承担。
本仓为个人适配版本，与 WorkBuddy、腾讯、DeepSeek 官方均无关联。

## 许可

- 仓库根目录下的 `lib/`、`package.json` 等内容继承上游 **MIT** 许可，版权归 **XDTrees** 所有，见 [`LICENSE`](LICENSE)。
- `patches/`、`tools/`、本 README 为本项目新增部分，同样以 MIT 释出。
