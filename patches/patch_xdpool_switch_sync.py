# -*- coding: utf-8 -*-
"""
dsh-workbuddy-xdpool：启动时自动从 workbuddy-switch 同步最新账号凭据。

背景：
  switch（~/.wb-switch/accounts.json）是账号与实时 token 的主库；插件只认
  <APPDATA>\\CodeBuddyExtension\\Data\\Public\\auth 下的 *.info，于是一次性手工导入的
  副本会随 token 续期/换号而过期。本补丁让插件在每次启动时先镜像一次该主库，再检测账号。

行为：
  - 源文件不存在 / 内容不可用 → 静默跳过（绝不删已有凭据）
  - 只在源文件 size+mtime 变化时才重写（避免每次启动无谓写盘）
  - 只增删自己管理的 workbuddy-pool-*.info；桌面 App 的活动文件从不写
  - 任一异常都降级为无操作，不会影响主机启动

幂等：已打过补丁则跳过。原文件备份为 index.js.orig-switchsync。
"""
from pathlib import Path
import os
import shutil
import sys

# 路径不写死用户名：默认 $HOME/.dsh/...，可用 DSH_PLUGIN_LIB 覆盖。
LIB = Path(os.environ.get("DSH_PLUGIN_LIB")
           or Path.home() / ".dsh" / "profiles" / "desktop" / "node_modules" / "dsh-workbuddy-xdpool" / "lib")
TARGET = LIB / "index.js"
BACKUP = LIB / "index.js.orig-switchsync"

MARK = "//#region [xdpool-switch-sync]"

IMPORT_OLD = 'import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";'
IMPORT_NEW = 'import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";'

RENAME_OLD = '\t//#region [xdpool-autoscan] 启动即自动检测账号\n'
RENAME_NEW = '''\t//#region [xdpool-switch-sync] 启动时从 workbuddy-switch 同步最新凭据
\t/**
\t* Mirror the workbuddy-switch account store into the auth directory the pool scans.
\t*
\t* The switch app (`~/.wb-switch/accounts.json`) is where the accounts and their
\t* live tokens actually live; the pool only reads `*.info` files. Without this
\t* step a copied credential goes stale the moment the upstream refreshes it, and
\t* the user has to re-export and re-import by hand.
\t*
\t* Safety: only files named `workbuddy-pool-*.info` are ever written or removed —
\t* the desktop app's live `workbuddy-desktop.info` is left alone — and a missing
\t* or unparsable source is a no-op rather than a wipe.
\t*/
\tconst SWITCH_ACCOUNTS_PATH = () => join(homedir(), ".wb-switch", "accounts.json");
\tconst SWITCH_SYNC_STATE_PATH = () => join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool", "switch-sync.json");
\tconst POOL_CREDENTIAL_PREFIX = "workbuddy-pool-";
\tconst poolCredentialDir = () => process.env["APPDATA"] === void 0 ? void 0 : join(process.env["APPDATA"], "CodeBuddyExtension", "Data", "Public", "auth");
\tconst readJsonQuietly = (path) => {
\t\ttry {
\t\t\treturn JSON.parse(readFileSync(path, "utf8"));
\t\t} catch {
\t\t\treturn void 0;
\t\t}
\t};
\t/**
\t* One switch record → one pool credential document.
\t*
\t* Mirrors what the pool's parser accepts: plaintext `accessToken` (so the file
\t* must not carry any `$wbEncrypted` marker), identity fields for de-duplication,
\t* and deliberately **no** `refreshExpiresAt` — a stale one makes the parser drop
\t* the entire file.
\t*/
\tconst switchAccountToDocument = (record) => {
\t\tif (typeof record !== "object" || record === null) return void 0;
\t\tconst raw = typeof record["auth_raw"] === "object" && record["auth_raw"] !== null ? record["auth_raw"] : {};
\t\tconst source = typeof raw["auth"] === "object" && raw["auth"] !== null ? raw["auth"] : {};
\t\tconst accessToken = source["accessToken"] ?? record["access_token"];
\t\tif (typeof accessToken !== "string" || accessToken === "") return void 0;
\t\tconst profile = typeof record["profile_raw"] === "object" && record["profile_raw"] !== null ? record["profile_raw"] : {};
\t\tconst rawAccount = typeof raw["account"] === "object" && raw["account"] !== null ? raw["account"] : profile;
\t\tconst account = { ...rawAccount };
\t\tconst nickname = record["nickname"];
\t\tif (typeof nickname === "string" && nickname !== "") account["nickname"] = nickname;
\t\telse delete account["nickname"];
\t\tconst phone = profile["phoneNumber"] ?? account["phoneNumber"];
\t\tif (typeof phone === "string" && phone !== "") account["phoneNumber"] = phone;
\t\telse delete account["phoneNumber"];
\t\tfor (const key of ["uin", "uid", "enterpriseId", "oneidAccountId"]) {
\t\t\tconst value = account[key] ?? profile[key] ?? record[key];
\t\t\tif (value !== void 0 && value !== null && value !== "") account[key] = value;
\t\t}
\t\tconst auth = {
\t\t\taccessToken,
\t\t\tdomain: source["domain"] ?? record["domain"] ?? ""
\t\t};
\t\tfor (const key of ["refreshToken", "tokenType", "scope", "sessionState", "notBeforePolicy"]) {
\t\t\tconst value = source[key];
\t\t\tif (typeof value === "string" && value !== "") auth[key] = value;
\t\t}
\t\tfor (const key of ["expiresAt", "lastRefreshTime"]) {
\t\t\tconst value = source[key] ?? record[key];
\t\t\tif (typeof value === "number" && value > 0) auth[key] = Math.round(value);
\t\t}
\t\treturn {
\t\t\taccount,
\t\t\taccounts: Array.isArray(raw["accounts"]) && raw["accounts"].length > 0 ? raw["accounts"] : [account],
\t\t\tallAccounts: Array.isArray(raw["allAccounts"]) && raw["allAccounts"].length > 0 ? raw["allAccounts"] : [account],
\t\t\tauth
\t\t};
\t};
\t/** Mirror the switch store into the pool's auth directory; returns a small summary. */
\tconst syncSwitchAccounts = () => {
\t\tconst source = SWITCH_ACCOUNTS_PATH();
\t\tconst dir = poolCredentialDir();
\t\tif (dir === void 0 || !existsSync(source)) return { skipped: "no-source" };
\t\tlet fingerprint;
\t\ttry {
\t\t\tconst stat = statSync(source);
\t\t\tfingerprint = `${stat.size}:${Math.round(stat.mtimeMs)}`;
\t\t} catch {
\t\t\treturn { skipped: "unreadable" };
\t\t}
\t\tconst previous = readJsonQuietly(SWITCH_SYNC_STATE_PATH());
\t\tif (previous !== void 0 && previous["source"] === source && previous["fingerprint"] === fingerprint) return { skipped: "unchanged" };
\t\tconst records = readJsonQuietly(source);
\t\tif (!Array.isArray(records)) return { skipped: "bad-source" };
\t\tconst documents = [];
\t\tfor (const record of records) {
\t\t\tconst document = switchAccountToDocument(record);
\t\t\tif (document !== void 0) documents.push(document);
\t\t}
\t\tif (documents.length === 0) return { skipped: "no-usable-account" };
\t\tmkdirSync(dir, { recursive: true });
\t\tconst wanted = /* @__PURE__ */ new Set();
\t\tdocuments.forEach((document, index) => {
\t\t\tconst name = `${POOL_CREDENTIAL_PREFIX}${String(index + 1).padStart(2, "0")}.info`;
\t\t\twanted.add(name);
\t\t\twriteFileSync(join(dir, name), `${JSON.stringify(document, void 0, 1)}\\n`, "utf8");
\t\t});
\t\tlet removed = 0;
\t\ttry {
\t\t\tfor (const entry of readdirSync(dir)) {
\t\t\t\tif (!entry.startsWith(POOL_CREDENTIAL_PREFIX) || !entry.endsWith(".info") || wanted.has(entry)) continue;
\t\t\t\ttry {
\t\t\t\t\tunlinkSync(join(dir, entry));
\t\t\t\t\tremoved += 1;
\t\t\t\t} catch {}
\t\t\t}
\t\t} catch {}
\t\tconst summary = {
\t\t\tsource,
\t\t\tat: (new Date()).toISOString(),
\t\t\twritten: documents.length,
\t\t\tremoved
\t\t};
\t\ttry {
\t\t\tconst state = SWITCH_SYNC_STATE_PATH();
\t\t\tmkdirSync(dirname(state), { recursive: true });
\t\t\twriteFileSync(state, `${JSON.stringify({ ...summary, fingerprint }, void 0, 2)}\\n`, "utf8");
\t\t} catch {}
\t\treturn summary;
\t};
\t//#endregion
\t//#region [xdpool-autoscan] 启动即自动检测账号
'''

BOOT_OLD = '''\t\t\t\tif (stopped) return;
\t\t\t\tcore.pool.scan().then((accounts) => {'''
BOOT_NEW = '''\t\t\t\tif (stopped) return;
\t\t\t\tlet sync;
\t\t\t\ttry {
\t\t\t\t\tsync = syncSwitchAccounts();
\t\t\t\t} catch (error) {
\t\t\t\t\tsync = { error: safeMessage(error) };
\t\t\t\t}
\t\t\t\tctx.logger.info?.(`dsh-workbuddy-xdpool: switch account sync ${JSON.stringify(sync)}`);
\t\t\t\tcore.pool.scan().then((accounts) => {'''

RECORD_OLD = '''\t\t\t\t\t\tok: true,
\t\t\t\t\t\tcount: accounts.length,'''
RECORD_NEW = '''\t\t\t\t\t\tok: true,
\t\t\t\t\t\tsync,
\t\t\t\t\t\tcount: accounts.length,'''

RECORD_ERR_OLD = '''\t\t\t\t\t\tok: false,
\t\t\t\t\t\tcount: 0,'''
RECORD_ERR_NEW = '''\t\t\t\t\t\tok: false,
\t\t\t\t\t\tsync,
\t\t\t\t\t\tcount: 0,'''


def apply_once(text, old, new, label, required=True):
    if new in text and old not in text:
        print("  [=] %s（已是目标状态）" % label)
        return text, 1
    count = text.count(old)
    if count != 1:
        print("  [%s] %s —— 锚点匹配 %d 次（需 1 次）" % ("!" if required else "-", label, count))
        return text, 0 if required else 1
    print("  [x] %s" % label)
    return text.replace(old, new, 1), 1


def main():
    if not TARGET.is_file():
        print("FAIL: 目标文件不存在:", TARGET)
        return 1
    text = TARGET.read_text(encoding="utf-8")
    if MARK in text:
        print("ALREADY: 已打过 switch 同步补丁。")
        return 0

    shutil.copy2(str(TARGET), str(BACKUP))
    print("  备份:", BACKUP.name)

    ok = 0
    text, r = apply_once(text, IMPORT_OLD, IMPORT_NEW, "import 补 statSync / unlinkSync"); ok += r
    text, r = apply_once(text, RENAME_OLD, RENAME_NEW, "插入 switch-sync 区段"); ok += r
    text, r = apply_once(text, BOOT_OLD, BOOT_NEW, "启动钩子：先同步再检测"); ok += r
    text, r = apply_once(text, RECORD_OLD, RECORD_NEW, "检测记录带上 sync"); ok += r
    text, r = apply_once(text, RECORD_ERR_OLD, RECORD_ERR_NEW, "失败记录带上 sync"); ok += r

    if ok != 5:
        print("FAIL: 只有 %d/5 处成功，未写入。" % ok)
        return 1
    TARGET.write_text(text, encoding="utf-8")
    print("DONE: 5/5 处改动已写入")
    return 0


if __name__ == "__main__":
    sys.exit(main())
