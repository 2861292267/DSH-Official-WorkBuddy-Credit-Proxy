# 开发约定

本文件是**强制流程**，不是建议。每一条都来自一次真实事故。

---

## 一、每次改动都要升版本号（+0.0.1）

**改完代码，立刻把 `package.json` 的 `version` 加 `0.0.1`。两侧都要改：**

| 位置 | 路径 |
|---|---|
| 仓库 | `repo-DSH-Official-WorkBuddy-Credit-Proxy/package.json` |
| 安装 | `~/.dsh/profiles/desktop/node_modules/dsh-rotakit/package.json` |

```jsonc
// 2.2.0 → 2.2.1
"version": "2.2.1"
```

### 为什么是硬要求

插件带**远程更新检查**：它拉取 GitHub 上 `package.json` 的版本号与本机比对，
**只有远端版本更高才会提示用户更新**。

所以不升版本号的后果是：

```
代码推到 GitHub ✓
用户点「检查更新」→ 远端 2.2.0 vs 本机 2.2.0 → 判定"已是最新"
→ 用户永远收不到这次修复
```

**修复到位、测试通过、CI 全绿，用户却拿不到 —— 而且没有任何报错。**

### 什么时候升

| 情况 | 升不升 |
|---|---|
| 改了 `lib/` 下任何 `.js` | ✅ 必须 |
| 改了 `package.json`（依赖、描述） | ✅ 必须 |
| 改了 `cordis.patch.yml` | ✅ 必须 |
| 只改文档（README / CHANGELOG） | 可以不升（但升了也无害） |
| 只改 `tools/`（不随包发布） | 可以不升 |

---

## 二、改完必须做三件事

```bash
# 1. 同步到安装目录（两侧必须一致）
cp <repo>/lib/*.js  ~/.dsh/profiles/desktop/node_modules/dsh-rotakit/lib/

# 2. 发布前检查（三项：依赖声明、可选依赖隔离、更新列表完整性）
node tools/check-publish.mjs

# 3. 全量回归（17 套、331 条断言）
node tools/run-suite.mjs
```

**三个都绿才算改完。** 任一项红了，先修再继续。

---

## 三、提交信息要写清「为什么」

这个仓库的注释和提交信息记录了**每次修复的根因**，包括我们自己造成的回归。
不要写 `fix: bug`，要写清：

- 症状是什么
- 根因是什么（指向具体行）
- 为什么这么修
- 怎么验证的

**失败也要写。** CHANGELOG 里记录了三次自己造成的回归 —— 那是给未来的自己看的。

---

## 四、发布流程

```
改代码
  → 升版本号（两侧）
  → 同步 lib/ 到安装目录
  → node tools/check-publish.mjs     ← 必须绿
  → node tools/run-suite.mjs         ← 必须绿
  → 写 CHANGELOG（记录根因与验证方式）
  → commit
  → push
  → 重启 DSH 验证（更新在磁盘上，但要重启才加载进内存）
```

### 推送注意

`github.com:443` 在本机**经常不通**（`api.github.com` 通常可用）。
`git push` 失败时，可以走 **GitHub 的 Git Data API** 推送：

```
1. 读凭据：git credential fill（token 在 Windows 凭据管理器，不在 .git-credentials）
2. POST /git/blobs     每个改动文件
3. POST /git/trees     base_tree = 远端当前 commit 的 tree
4. POST /git/commits   parents = [远端当前 sha]
5. PATCH /git/refs/heads/main
```

**推送前先核对远端 `main` == 本地父提交**，避免覆盖别人的提交。

---

## 五、绝对不要做的事

### ❌ 不要只改磁盘不重启就宣称"已生效"

运行中的进程用的是**内存里的旧代码**。文件写完了，但插件还在跑老的。
**必须重启才能验证。**

### ❌ 不要手工编辑 `package.json` 的 `dependencies` 放可选包

`qrcode` 是 `optionalDependencies` —— 因为代码里它是**惰性导入**，
按注释的设计意图「缺失只影响扫码功能，不影响插件」。

放 `dependencies` 会让整个安装失败，与设计矛盾。

### ❌ 不要在 `lib/` 下留 `.bak` 文件

它们会被 npm 打进发布包（`files` 白名单里的 `"lib"` 是**目录**项）。
现在占包体积的 74%（约 4MB）。

### ❌ 不要忘记更新 `TRACKED_FILES`

`index.js` 加载时**静态导入**的文件，必须出现在 `TRACKED_FILES` 里。
否则老版本用户更新后会拿到一个 import 不到依赖的 `index.js`，
**插件彻底起不来**（`ERR_MODULE_NOT_FOUND`），而且要到重启才暴露。

`tools/check-publish.mjs` 的 C 项会检查这个。

### ❌ 不要在语言包外使用新的翻译键

`t?.("row.xxx") ?? "兜底"` 的**兜底不会生效** —— 键缺失时 `t?.()` 返回**键名**，
不是 `undefined`。所以屏幕上会直接显示 `row.xxx`。

新增文案必须同时加进 `client.js` 里的**中英两份**语言包。
`tools/check-publish.mjs` 会检查（136 个键逐个核对）。

---

## 六、已知的坑

| 现象 | 原因 |
|---|---|
| 更新后功能没变 | 要重启 DSH，磁盘与内存是分开的 |
| 用户看不到"有新版本" | 忘了升版本号 |
| 别人装了插件报 `Cannot find package 'xxx'` | 那个包没声明在 `package.json`（本机恰好有，所以你看不到） |
| 更新后插件加载失败 | `TRACKED_FILES` 漏了某个静态导入的文件 |
| 卡片显示 `row.xxx` | 语言包漏键 |
| `git push` 连不上 | `github.com` 不通，改走 `api.github.com` |

---

## 七、发布前自查清单

```
□ package.json 版本号 +0.0.1（仓库与安装两侧）
□ lib/ 已同步到安装目录
□ node tools/check-publish.mjs      绿
□ node tools/run-suite.mjs          绿
□ 新文案已加进中英两份语言包
□ 新的加载时导入已加进 TRACKED_FILES
□ 新依赖已声明（可选依赖用 optionalDependencies）
□ CHANGELOG 写清根因与验证方式
□ 已 commit 并 push
□ 已重启验证
```
