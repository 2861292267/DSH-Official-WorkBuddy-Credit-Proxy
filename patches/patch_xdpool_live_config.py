"""让 xdpool 在设置变更后重新读取并应用配置（0.1.7 兼容）。

问题：0.1.5 靠 `settings.installSection()` 注册的 `onChange` 回调触发
`applyConfigFromSource()`；该 API 在 0.1.7 被删除后，
**卡片上改设置能写进 profile 配置，但运行时永远不重新应用**
（点「账号使用方式」「积分自动化」表现为"没反应"）。

修法：订阅内核广播的 `settings/document-updated` 事件（asar 里出现 21 次，
是 0.1.7 的替代机制），在本插件 namespace 变更时重跑 applyConfigFromSource()。
"""
import shutil
import sys
from pathlib import Path

IDX = Path(r"C:\Users\ASUS\.dsh\profiles\desktop\node_modules\dsh-workbuddy-xdpool\lib\index.js")

ANCHOR = "\tconst settingsService = ctx.settings;"

INSERT = """\t// [0.1.7-compat] 0.1.5 applied config through installSection()'s onChange hook;
\t// that API is gone in 0.1.7, so the host now broadcasts settings/document-updated.
\t// Without this subscription a settings change lands in the profile document but is
\t// never applied at runtime (the card's switch looks dead).
\ttry {
\t\tctx.on?.("settings/document-updated", (ns) => {
\t\t\tif (ns !== WORKBUDDY_POOL_SETTINGS_NS) return;
\t\t\ttry {
\t\t\t\tapplyConfigFromSource();
\t\t\t\tinvalidateCatalog();
\t\t\t} catch (error) {
\t\t\t\tctx.logger?.warn?.(`dsh-workbuddy-xdpool: re-apply after settings change failed: ${error?.message ?? error}`);
\t\t\t}
\t\t});
\t} catch (error) {
\t\tctx.logger?.warn?.(`dsh-workbuddy-xdpool: cannot subscribe settings/document-updated: ${error?.message ?? error}`);
\t}
"""

if not IDX.is_file():
    print("目标不存在:", IDX)
    sys.exit(1)

text = IDX.read_text(encoding="utf-8")
orig = IDX.with_name(IDX.name + ".orig-0.1.5")
if not orig.exists():
    shutil.copy2(IDX, orig)
    print("[backup] ->", orig.name)

if "settings/document-updated" in text:
    print("[--] 监听已存在")
else:
    if ANCHOR not in text:
        print("[!!] 未找到锚点:", ANCHOR.strip())
        sys.exit(1)
    text = text.replace(ANCHOR, INSERT + ANCHOR, 1)
    IDX.write_text(text, encoding="utf-8")
    print("[ok] 已插入 settings/document-updated 监听")

after = IDX.read_text(encoding="utf-8")
checks = [
    ('监听已注册', 'ctx.on?.("settings/document-updated"' in after),
    ('变更时重新应用', 'applyConfigFromSource();' in after and after.count('applyConfigFromSource()') >= 2),
    ('ns 常量仍在', 'WORKBUDDY_POOL_SETTINGS_NS = "llm-workbuddy-xdpool"' in after),
    ('volatile 标记仍在', 'Config.meta.volatile = true' in after),
    ('实时读取仍在', 'ctx.settings?.describe?.()' in after),
    ('写入兜底仍在', 'must never kill the host process' in after),
]
print("=== 校验 ===")
for n, ok in checks:
    print("  %-24s %s" % (n, "OK" if ok else "FAILED"))
sys.exit(0 if all(ok for _, ok in checks) else 1)
