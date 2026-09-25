"""修正确切的图标导出名，并把诊断探针降级为"仅在出错时显示"。

事实（从 asar 导出的 primitives 里核对）：
  0.1.7 每个图标只有两个导出变体：IconXxx Medium / IconXxx Regular（Artwork 不导出）
  IconChevronDownOutline 裸名只出现在注释里 → undefined → React #130 → 整块空白

改动：
  1. primitives.IconChevronDownOutline（裸名）-> primitives.IconChevronDownOutlineRegular
  2. 注册处去掉红色调试框与 DEBUG 文案，只保留错误边界包裹
     （错误边界只在真出错时才渲染红字堆栈，正常情况下完全不出现）
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

text = CLI.read_text(encoding="utf-8") if CLI.is_file() else None
if text is None:
    print("目标不存在:", CLI)
    sys.exit(1)

orig = CLI.with_name(CLI.name + ".orig-0.1.5")
if not orig.exists():
    shutil.copy2(CLI, orig)
    print("[backup] ->", orig.name)

changed = []

# --- 1) 图标名修正（裸名 -> Regular；不动已是 Regular/Medium 的） ---
pat = re.compile(r'(_deepseek_ai_dsh_client_ui_primitives\.IconChevronDownOutline)(?!Regular|Medium|Artwork)')
text, n = pat.subn(r'\1Regular', text)
if n:
    changed.append("图标名 -> IconChevronDownOutlineRegular（%d 处）" % n)
else:
    print("[--] 图标名无需修正")

# --- 2) 注册处：去掉调试框，只保留错误边界 ---
ANCHOR = '}, (props) => (0, react.createElement)("div", {'
NEW_REG = ('}, (props) => (0, react.createElement)(PoolCardErrorBoundary, null, '
           '(0, react.createElement)(PoolCard, props))));')
if ANCHOR in text:
    start = text.index(ANCHOR)
    end = text.index("])));", start) + len("])));")
    text = text[:start] + NEW_REG + text[end:]
    changed.append("注册处去调试框、保留错误边界")
else:
    print("[--] 注册处无需改动")

if changed:
    CLI.write_text(text, encoding="utf-8")
print("改动:", "；".join(changed) if changed else "无")

after = CLI.read_text(encoding="utf-8")
checks = [
    ('图标名已是 Regular', 'primitives.IconChevronDownOutlineRegular' in after),
    ('无裸图标名残留', not re.search(r'primitives\.IconChevronDownOutline(?!Regular|Medium|Artwork)', after)),
    ('错误边界仍在（可诊断）', 'class PoolCardErrorBoundary' in after),
    ('注册处已还原为边界包裹', '(PoolCardErrorBoundary, null,' in after),
    ('调试红框已移除', 'XD-POOL-DEBUG' not in after),
    ('settings.section 仍在', '"settings.section"' in after),
    ('configForms 仍在', 'ctx.configForms.get' in after),
]
print("=== 校验 ===")
for n_, ok in checks:
    print("  %-26s %s" % (n_, "OK" if ok else "FAILED"))
sys.exit(0 if all(ok for _, ok in checks) else 1)
