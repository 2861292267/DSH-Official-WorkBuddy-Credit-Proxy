# -*- coding: utf-8 -*-
"""
dsh-workbuddy-xdpool 适配 DSH 0.1.7：启动时自动检测账号。

背景（0.1.7 下的真实缺陷）：
  插件原有的两次 core.pool.scan() 都写在 shim.listen() 的成功回调里，
  且位于 provider 注册的 try/catch 之后：
      } catch (error) { ctx.logger.error("provider registration failed", error); return; }
      ...
      core.pool.scan().then(...)
  → 一旦 provider 注册抛错（或 shim 没 listen 成功），直接 return，账号检测被整段跳过，
    池为空，用户必须在卡片上手点「重新检测账号」才能恢复。

本补丁：
  1) 在 apply() 末尾、shim listen 之外，注册一个启动钩子（ctx.effect + setTimeout），
     无条件执行一次账号检测 —— 不受 shim / provider 注册结果影响。
  2) 把这次检测的结果（时间 / 成功与否 / 账号数 / 账号标签）写入
     <DSH_HOME>/.workbuddy-xdpool/boot-scan.json，使"启动自动检测"可被外部核对。

幂等：已打过补丁则跳过。原文件备份为 index.js.orig-autoscan。
"""
from pathlib import Path
import shutil
import sys

LIB = Path(r"C:\Users\ASUS\.dsh\profiles\desktop\node_modules\dsh-workbuddy-xdpool\lib")
TARGET = LIB / "index.js"
BACKUP = LIB / "index.js.orig-autoscan"

MARK_BEGIN = "//#region [xdpool-autoscan]"

OLD_IMPORT = 'import { existsSync, readFileSync, readdirSync } from "node:fs";'
NEW_IMPORT = 'import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";'

# 锚点：apply() 末尾的 shim listen 错误回调 + 函数结束大括号
ANCHOR = '\t}, (error) => {\n\t\tctx.logger.error("dsh-workbuddy-xdpool: shim failed to listen", error);\n\t});\n}\n'

INJECT = '''\t}, (error) => {
\t\tctx.logger.error("dsh-workbuddy-xdpool: shim failed to listen", error);
\t});
\t//#region [xdpool-autoscan] 启动即自动检测账号
\t/**
\t* Boot-time account discovery, independent of the shim.
\t*
\t* The pool's own scan() calls live inside the listen callback and sit *after*
\t* the provider-registration try/catch, so a throwing registration returns
\t* early and the whole discovery step is skipped — the pool then stays empty
\t* until someone presses “rescan” on the card. This hook runs unconditionally
\t* and records its outcome on disk, so “did the boot scan find my accounts?”
\t* is answerable without a debugger.
\t*/
\tconst BOOT_SCAN_DELAY_MS = 2e3;
\tconst bootScanRecordPath = () => join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool", "boot-scan.json");
\tconst writeBootScanRecord = (payload) => {
\t\ttry {
\t\t\tconst target = bootScanRecordPath();
\t\t\tmkdirSync(dirname(target), { recursive: true });
\t\t\twriteFileSync(target, `${JSON.stringify(payload, void 0, 2)}\\n`, "utf8");
\t\t} catch {}
\t};
\ttry {
\t\tctx.effect(() => {
\t\t\tconst timer = setTimeout(() => {
\t\t\t\tif (stopped) return;
\t\t\t\tcore.pool.scan().then((accounts) => {
\t\t\t\t\tctx.logger.info?.(`dsh-workbuddy-xdpool: boot auto-scan found ${accounts.length} account(s)`);
\t\t\t\t\twriteBootScanRecord({
\t\t\t\t\t\tat: (new Date()).toISOString(),
\t\t\t\t\t\tok: true,
\t\t\t\t\t\tcount: accounts.length,
\t\t\t\t\t\tlabels: accounts.map((account) => account.label)
\t\t\t\t\t});
\t\t\t\t}, (error) => {
\t\t\t\t\tctx.logger.warn("dsh-workbuddy-xdpool: boot auto-scan failed", error);
\t\t\t\t\twriteBootScanRecord({
\t\t\t\t\t\tat: (new Date()).toISOString(),
\t\t\t\t\t\tok: false,
\t\t\t\t\t\tcount: 0,
\t\t\t\t\t\tlabels: [],
\t\t\t\t\t\terror: safeMessage(error)
\t\t\t\t\t});
\t\t\t\t});
\t\t\t}, BOOT_SCAN_DELAY_MS);
\t\t\treturn () => clearTimeout(timer);
\t\t});
\t} catch {
\t\tsetTimeout(() => {
\t\t\tif (!stopped) core.pool.scan().catch(() => void 0);
\t\t}, BOOT_SCAN_DELAY_MS);
\t}
\t//#endregion
}
'''


def main():
    if not TARGET.is_file():
        print("FAIL: 目标文件不存在:", TARGET)
        return 1
    text = TARGET.read_text(encoding="utf-8")

    if MARK_BEGIN in text:
        print("ALREADY: 已打过启动自动检测补丁，无需重复。")
        return 0

    changed = 0
    if OLD_IMPORT in text:
        text = text.replace(OLD_IMPORT, NEW_IMPORT, 1)
        changed += 1
        print("  [1/2] import 已补充 mkdirSync / writeFileSync")
    else:
        if "writeFileSync" in text and "mkdirSync" in text:
            print("  [1/2] import 已含所需符号（跳过）")
        else:
            print("  !! [1/2] 未匹配到 node:fs import 行，请人工核对")
            return 1

    if text.count(ANCHOR) != 1:
        print("  !! [2/2] 锚点匹配 %d 次（需正好 1 次），中止" % text.count(ANCHOR))
        return 1

    shutil.copy2(str(TARGET), str(BACKUP))
    print("  备份:", BACKUP.name)

    text = text.replace(ANCHOR, INJECT, 1)
    changed += 1
    print("  [2/2] 启动钩子已插入（apply 末尾，shim listen 之外）")

    TARGET.write_text(text, encoding="utf-8")
    print("DONE: 改动 %d 处" % changed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
