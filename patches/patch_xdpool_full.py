"""为 dsh-workbuddy-xdpool 打 0.1.7-rc.2 完整兼容补丁（幂等、可回滚）。

0.1.5 -> 0.1.7 的三处破坏性变更（均已从 asar 中核实）：
  1. 客户端设置服务 settingsScope -> configForms（取对象方式不同，接口同名）
  2. 宿主侧 settings.installSection() 被移除（asar 全文 0 次），
     改为「只能编辑 profile 里已声明的 entry」，且 entry id != 插件自报 ns
  3. settings 写入要求目标字段带 schema.meta.volatile

补丁内容：
  index.js
    A. WORKBUDDY_POOL_SETTINGS_NS: "workbuddy-xdpool" -> "llm-workbuddy-xdpool"
    B. Config 打上 meta.volatile（整棵树可写）
    C. current() 改为从 settings.describe() 实时读取（原依赖 installSection 的 hook）
    D. setSetting 包 try/catch，写失败只告警，不再打崩 host 进程
  client.js
    E. configForms.get("workbuddy-xdpool") -> get("llm-workbuddy-xdpool")（entry id 对齐）
"""
import shutil
import sys
from pathlib import Path

DESK = Path(r"C:\Users\ASUS\.dsh\profiles\desktop\node_modules\dsh-workbuddy-xdpool\lib")
IDX = DESK / "index.js"
CLI = DESK / "client.js"

# ---------- A ----------
A_OLD = 'WORKBUDDY_POOL_SETTINGS_NS = "workbuddy-xdpool"'
A_NEW = 'WORKBUDDY_POOL_SETTINGS_NS = "llm-workbuddy-xdpool"'

# ---------- B ----------
B_ANCHOR = '\tautomationEarnings: z.any().description("Automation earnings ledger (written by the scheduler)")\n});\n'
B_INSERT = (
    B_ANCHOR
    + '// [0.1.7-compat] mark the whole config editable through the settings service.\n'
    + 'try {\n'
    + '\tif (Config.meta === void 0) Config.meta = {};\n'
    + '\tConfig.meta.volatile = true;\n'
    + '} catch (_compatErr) {\n'
    + '\t/* older hosts do not need the volatile marker */\n'
    + '}\n'
)

# ---------- C ----------
C_OLD = '\tlet current = () => config;\n'
C_NEW = (
    '\t// [0.1.7-compat] settings.installSection() is gone; read the live entry\n'
    '\t// config through the settings service instead of the missing hook.\n'
    '\tlet current = () => {\n'
    '\t\ttry {\n'
    '\t\t\tconst rows = ctx.settings?.describe?.();\n'
    '\t\t\tconst row = Array.isArray(rows) ? rows.find((r) => r.ns === WORKBUDDY_POOL_SETTINGS_NS) : void 0;\n'
    '\t\t\tif (row?.value !== void 0) return { ...config, ...row.value };\n'
    '\t\t} catch (_compatErr) { /* fall back to the boot-time config */ }\n'
    '\t\treturn config;\n'
    '\t};\n'
)

# ---------- D ----------
D_OLD = (
    '\tconst setSetting = async (key, value, expected) => {\n'
    '\t\tif (value === void 0) return;\n'
    '\t\tconst update = settingsService?.update;\n'
    '\t\tif (update === void 0) throw new Error(`settings service has no update(); ${key} was not saved`);\n'
    '\t\tawait update.call(settingsService, WORKBUDDY_POOL_SETTINGS_NS, { [key]: value });\n'
    '\t\tif (expected !== void 0) {\n'
    '\t\t\tconst stored = current()[key];\n'
    '\t\t\tif (!stableJsonEqual(stored, expected)) throw new Error(`settings field "${key}" was not persisted`);\n'
    '\t\t}\n'
    '\t};\n'
)
D_NEW = (
    '\tconst setSetting = async (key, value, expected) => {\n'
    '\t\t// [0.1.7-compat] a failed settings write must never kill the host process.\n'
    '\t\ttry {\n'
    '\t\t\tif (value === void 0) return;\n'
    '\t\t\tconst update = settingsService?.update;\n'
    '\t\t\tif (update === void 0) {\n'
    '\t\t\t\tctx.logger?.warn?.(`dsh-workbuddy-xdpool: settings service has no update(); ${key} was not saved`);\n'
    '\t\t\t\treturn;\n'
    '\t\t\t}\n'
    '\t\t\tawait update.call(settingsService, WORKBUDDY_POOL_SETTINGS_NS, { [key]: value });\n'
    '\t\t\tif (expected !== void 0) {\n'
    '\t\t\t\tconst stored = current()[key];\n'
    '\t\t\t\tif (!stableJsonEqual(stored, expected)) ctx.logger?.warn?.(`dsh-workbuddy-xdpool: settings field "${key}" did not verify after write`);\n'
    '\t\t\t}\n'
    '\t\t} catch (error) {\n'
    '\t\t\tctx.logger?.warn?.(`dsh-workbuddy-xdpool: settings write "${key}" failed: ${error?.message ?? error}`);\n'
    '\t\t}\n'
    '\t};\n'
)

# ---------- E ----------
E_OLD = 'ctx.configForms.get("workbuddy-xdpool")'
E_NEW = 'ctx.configForms.get("llm-workbuddy-xdpool")'


def apply(f: Path, pairs, label):
    if not f.is_file():
        print("[skip] 不存在:", f)
        return 0
    text = f.read_text(encoding="utf-8")
    orig = f.with_name(f.name + ".orig-0.1.5")
    if not orig.exists():
        shutil.copy2(f, orig)
        print("[backup] ->", orig.name)

    n = 0
    for old, new, tag in pairs:
        if old in text and new not in text:
            text = text.replace(old, new, 1)
            n += 1
            print("  [ok] %s 应用 %s" % (label, tag))
        elif new in text or (new[:60] in text):
            print("  [--] %s %s 已是补丁后状态" % (label, tag))
        else:
            print("  [!!] %s %s 锚点未找到" % (label, tag))
    f.write_text(text, encoding="utf-8")
    return n


print("=== index.js ===")
n1 = apply(IDX, [
    (A_OLD, A_NEW, "A: settings ns"),
    (B_ANCHOR, B_INSERT, "B: Config volatile"),
    (C_OLD, C_NEW, "C: live read source"),
    (D_OLD, D_NEW, "D: setSetting guard"),
], "index.js")

print("=== client.js ===")
n2 = apply(CLI, [(E_OLD, E_NEW, "E: entry id for configForms.get")], "client.js")

print()
print("=== 校验 ===")
t = IDX.read_text(encoding="utf-8")
c = CLI.read_text(encoding="utf-8")
checks = [
    ('ns 已对齐', 'WORKBUDDY_POOL_SETTINGS_NS = "llm-workbuddy-xdpool"' in t),
    ('volatile 已标记', 'Config.meta.volatile = true' in t),
    ('读取源已替换', 'ctx.settings?.describe?.()' in t),
    ('写入已容错', 'must never kill the host process' in t),
    ('客户端 entry id 已对齐', 'ctx.configForms.get("llm-workbuddy-xdpool")' in c),
    ('客户端 inject 仍为 configForms', '"configForms"' in c),
]
for name, ok in checks:
    print("  %-28s %s" % (name, "OK" if ok else "FAILED"))
sys.exit(0 if all(ok for _, ok in checks) else 1)
