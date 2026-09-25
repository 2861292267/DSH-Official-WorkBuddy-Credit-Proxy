"""把 xdpool 的卡片从已废弃的 slot 迁到 0.1.7 的 settings.section（幂等、可回滚）。

依据：
- asar 全文搜 "settings.plugin.item" = 0 命中 → 该 slot 在新内核已不存在，卡片注册到空气
- 能在 0.1.7 正常显示卡片的 dsh-better-sidebar 注册的是 settings.section：
      slots.inject("settings.section", () => slots.register({
          name: "settings.section", id: "better-sidebar", order: 100,
          label: () => t("settingsNav"), inject: () => ({...})
      }, SideCardSection))
- 对比旧写法：name/key/priority（key 是 slot 实例键，section 用的是 id/order/label）

改动（仅 client.js 一处注册块）：
  "settings.plugin.item"  -> "settings.section"        （inject 参数 + name 字段）
  key: "...", priority: 30 -> id: "...", order: 120, label: () => t("row.title")
"""
import os
import re
import shutil
import sys
from pathlib import Path

# 路径不写死用户名：默认 $HOME/.dsh/...，可用 DSH_PLUGIN_LIB 覆盖。
LIB = Path(os.environ.get("DSH_PLUGIN_LIB")
           or Path.home() / ".dsh" / "profiles" / "desktop" / "node_modules" / "dsh-workbuddy-xdpool" / "lib")
CLI = LIB / "client.js"

if not CLI.is_file():
    print("目标不存在:", CLI)
    sys.exit(1)

text = CLI.read_text(encoding="utf-8")
orig = CLI.with_name(CLI.name + ".orig-0.1.5")
if not orig.exists():
    shutil.copy2(CLI, orig)
    print("[backup] ->", orig.name)

changed = []

# 1) slot 名
if '"settings.plugin.item"' in text:
    n = text.count('"settings.plugin.item"')
    text = text.replace('"settings.plugin.item"', '"settings.section"')
    changed.append("slot 名替换 %d 处" % n)
else:
    print("[--] slot 名已是 settings.section")

# 2) key/priority -> id/order/label（沿用原缩进）
pat = re.compile(r'(\s*)key: "workbuddy-xdpool",\s*\n(\s*)priority: 30,')


def repl(m):
    i1, i2 = m.group(1), m.group(2)
    return ('%sid: "workbuddy-xdpool",\n'
            '%sorder: 120,\n'
            '%slabel: () => t("row.title"),') % (i1, i2, i2)


text, cnt = pat.subn(repl, text)
if cnt:
    changed.append("key/priority -> id/order/label（%d 处）" % cnt)
else:
    print("[--] key/priority 段已是新写法或未找到")

CLI.write_text(text, encoding="utf-8")

print("改动:", "；".join(changed) if changed else "无")

print()
print("=== 注册块现状 ===")
lines = text.split("\n")
idx = [i for i, l in enumerate(lines) if '"settings.section"' in l]
for i in idx:
    lo, hi = max(0, i - 4), min(len(lines), i + 12)
    for j in range(lo, hi):
        print("%5d| %s" % (j + 1, lines[j]))
    print("-" * 50)

checks = [
    ('slot 已迁移', '"settings.section"' in text),
    ('无残留旧 slot', '"settings.plugin.item"' not in text),
    ('id 已就位', 'id: "workbuddy-xdpool"' in text),
    ('label 已就位', 'label: () => t("row.title")' in text),
    ('inject 仍带 settingsScope', 'settingsScope' in text),
    ('configForms 取对象仍在', 'ctx.configForms.get("llm-workbuddy-xdpool")' in text),
]
print("=== 校验 ===")
for name, ok in checks:
    print("  %-26s %s" % (name, "OK" if ok else "FAILED"))
sys.exit(0 if all(ok for _, ok in checks) else 1)
