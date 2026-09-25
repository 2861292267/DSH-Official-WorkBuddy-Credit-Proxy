# DSH 官方版 · WorkBuddy 积分反代

把本机已登录的 **WorkBuddy** 账号合并成一条**自动故障转移的模型池**，接入 **DeepSeek Harness 官方版（DSH Desktop）**，
用 WorkBuddy 的积分驱动 GLM / DeepSeek / Kimi 等模型。

> **本仓是改编版。** 基础插件为 [`XDTrees/dsh-workbuddy-xdpool`](https://github.com/XDTrees/dsh-workbuddy-xdpool)（MIT，作者 **XDTrees**），
> 本项目针对 DSH Desktop **0.1.7-rc.2** 内核做了兼容修复，并新增两项能力。
> 原作者版权归 XDTrees 所有，许可证见 [`plugin/LICENSE`](plugin/LICENSE)。原版文档见 [`plugin/README.md`](plugin/README.md)。

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

| 目录 | 内容 |
|---|---|
| `plugin/` | **改造后的完整插件**（`lib/index.js`、`lib/client.js` 等），可直接放进 DSH profile |
| `patches/` | 全部改动脚本（**幂等**，可对任意 1.6.1 原版重放） |
| `tools/` | 重启验证、账号导入辅助脚本 |

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

### 二、新增能力（3 处）

| 脚本 | 能力 |
|---|---|
| `patch_xdpool_autoscan.py` | **启动即自动检测账号**。原实现的扫描写在 `shim.listen()` 回调里、且在 provider 注册的 `catch { return }` 之后 —— 注册一抛错就整段跳过，池会空着等用户手点。改为独立启动钩子（不受 shim/注册结果影响），并把结果写入 `~/.dsh/.workbuddy-xdpool/boot-scan.json` 便于核对 |
| `patch_xdpool_switch_sync.py` | **启动时从 workbuddy-switch 账号库自动同步**。读 `~/.wb-switch/accounts.json`，镜像成插件认的凭据文件，此后在 switch 里换号 / token 续期都不必手工导出导入。只在源文件 `size:mtime` 变化时重写；**源缺失或损坏时绝不清理已有凭据**；只增删自己前缀的文件，不碰桌面 App 的活动凭据 |
| `patch_xdpool_oauth_scan.py` | **卡片内「扫码添加账号」**。见下节 |

### 三、卡片内扫码添加账号

原插件**自己不会添加账号** —— 它的 `login` 子命令只是一段说明（"去 WorkBuddy App 扫码登录，再抓快照"）。
本版把桌面客户端的登录流程复刻进了插件：

```
POST {网关}/v2/plugin/auth/state?platform=workbuddy     header: X-Client-Platform: workbuddy
     → {code:0, data:{state, authUrl}}
二维码 = authUrl（https://www.codebuddy.cn/login?platform=workbuddy&state=…）
GET  {网关}/v2/plugin/auth/token?state=…     code 11217 = 等待扫码中；0 = 成功
GET  {网关}/v2/plugin/login/account?state=…  → 账号资料
网关：国内 = https://www.codebuddy.cn   国际 = https://www.workbuddy.ai
```

- 宿主侧新增两条路由：`POST /plugins/dsh-workbuddy-xdpool/oauth/start`、`GET .../oauth/poll`
- 客户端在「账号使用方式」按钮区新增「扫码添加账号」+ 二维码面板 + 2.5 秒轮询
- 二维码用 `qrcode` 包渲染，且**用动态 `import()` 加载** —— 缺包只让这一个功能不可用，不会让整个插件加载失败
- 扫到的账号存为 `workbuddy-scan-<id>.info`（独立前缀），**不会被 switch 同步覆盖**
- 诊断写 `~/.dsh/.workbuddy-xdpool/oauth-last.json`，**只记字段形状、不含 token**

---

## 安装步骤

前置：DSH Desktop **官方版**（本版按内核 `0.1.7-rc.2` 适配）、`pnpm`、Node 24。

```bash
# 1. 装进 DSH profile（默认路径 ~/.dsh/profiles/desktop，也可用 --profile web）
cp -r plugin ~/.dsh/profiles/<你的profile>/node_modules/dsh-workbuddy-xdpool

# 2. 扫码功能需要二维码依赖（纯 JS，无原生编译）
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

- `plugin/` 下的内容继承上游 **MIT** 许可，版权归 **XDTrees** 所有，见 [`plugin/LICENSE`](plugin/LICENSE)。
- `patches/`、`tools/`、本 README 为本项目新增部分，同样以 MIT 释出。
