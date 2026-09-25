"""诊断补丁：给 xdpool 的卡片套一个错误边界，让渲染异常显示到界面上。

背景：设置里能看到「WorkBuddy 池...」导航项（说明 section 注册成功），
点开后内容整块空白，且没有任何日志 —— React 错误边界把异常吞掉了。
本补丁不改业务逻辑，只做两件事：
  1. 在界面上打一个可见标记（XD-POOL-DEBUG v1），用于判断"组件到底有没有被渲染"
  2. 用 class 错误边界包住 PoolCard，渲染期抛错时把 stack 直接画在界面上

定位到真正的异常后，这个补丁会被撤掉（或保留标记去掉）。
"""
import os
import shutil
import sys
from pathlib import Path

# 路径不写死用户名：默认 $HOME/.dsh/...，可用 DSH_PLUGIN_LIB 覆盖。
LIB = Path(os.environ.get("DSH_PLUGIN_LIB")
           or Path.home() / ".dsh" / "profiles" / "desktop" / "node_modules" / "dsh-workbuddy-xdpool" / "lib")
CLI = LIB / "client.js"

BOUNDARY_ANCHOR = "\t\tfunction PoolCard({ t, settingsScope }) {"

BOUNDARY_CODE = """\t\t/** [诊断] 把卡片渲染期的异常显示出来，而不是被边界静默吞掉。 */
\t\tclass PoolCardErrorBoundary extends react.Component {
\t\t\tconstructor(props) {
\t\t\t\tsuper(props);
\t\t\t\tthis.state = { err: void 0 };
\t\t\t}
\t\t\tstatic getDerivedStateFromError(err) {
\t\t\t\treturn { err };
\t\t\t}
\t\t\tcomponentDidCatch(err) {
\t\t\t\tconsole.error("[dsh-workbuddy-xdpool] card render error:", err);
\t\t\t}
\t\t\trender() {
\t\t\t\tconst err = this.state.err;
\t\t\t\tif (err !== void 0) return (0, react.createElement)("pre", {
\t\t\t\t\tstyle: {
\t\t\t\t\t\twhiteSpace: "pre-wrap",
\t\t\t\t\t\tfontSize: "11px",
\t\t\t\t\t\tcolor: "#c00",
\t\t\t\t\t\tbackground: "#fff5f5",
\t\t\t\t\t\tpadding: "8px",
\t\t\t\t\t\tborderRadius: "6px",
\t\t\t\t\t\tmaxHeight: "320px",
\t\t\t\t\t\toverflow: "auto"
\t\t\t\t\t}
\t\t\t\t}, String(err && (err.stack || err.message) || err));
\t\t\t\treturn this.props.children;
\t\t\t}
\t\t}
"""

REG_OLD = "\t\t\t\t}, PoolCard));"
REG_NEW = """\t\t\t\t}, (props) => (0, react.createElement)("div", {
\t\t\t\t\tstyle: {
\t\t\t\t\t\tpadding: "10px",
\t\t\t\t\t\tborder: "2px dashed #d33",
\t\t\t\t\t\tborderRadius: "8px"
\t\t\t\t\t}
\t\t\t\t}, [
\t\t\t\t\t(0, react.createElement)("div", {
\t\t\t\t\t\tkey: "dbg",
\t\t\t\t\t\tstyle: {
\t\t\t\t\t\t\tfontSize: "12px",
\t\t\t\t\t\t\tcolor: "#d33",
\t\t\t\t\t\t\tmarginBottom: "6px"
\t\t\t\t\t\t}
\t\t\t\t\t}, "XD-POOL-DEBUG v1 \\u2014 \\u5361\\u7247\\u7ec4\\u4ef6\\u5df2\\u88ab\\u8c03\\u7528"),
\t\t\t\t\t(0, react.createElement)(PoolCardErrorBoundary, { key: "card" }, (0, react.createElement)(PoolCard, props))
\t\t\t\t])));"""

if not CLI.is_file():
    print("目标不存在:", CLI)
    sys.exit(1)

text = CLI.read_text(encoding="utf-8")
orig = CLI.with_name(CLI.name + ".orig-0.1.5")
if not orig.exists():
    shutil.copy2(CLI, orig)
    print("[backup] ->", orig.name)

if "PoolCardErrorBoundary" in text:
    print("[--] 诊断补丁已在位")
else:
    if BOUNDARY_ANCHOR not in text:
        print("[!!] 未找到 PoolCard 定义锚点")
        sys.exit(1)
    text = text.replace(BOUNDARY_ANCHOR, BOUNDARY_CODE + BOUNDARY_ANCHOR, 1)
    print("[ok] 已插入错误边界类")

    if REG_OLD not in text:
        print("[!!] 未找到注册处锚点（可能已被其他补丁改动）")
        sys.exit(1)
    text = text.replace(REG_OLD, REG_NEW, 1)
    print("[ok] 已用错误边界包裹 PoolCard")
    CLI.write_text(text, encoding="utf-8")

after = CLI.read_text(encoding="utf-8")
checks = [
    ('错误边界已插入', 'class PoolCardErrorBoundary' in after),
    ('注册处已包裹', 'PoolCardErrorBoundary, { key: "card" }' in after),
    ('debug 标记已加入', 'XD-POOL-DEBUG' in after),
    ('settings.section 仍在', '"settings.section"' in after),
    ('图标已修', 'IconChevronDownOutline,' in after or 'IconChevronDownOutline }' in after),
]
print("=== 校验 ===")
for n, ok in checks:
    print("  %-22s %s" % (n, "OK" if ok else "FAILED"))
sys.exit(0 if all(ok for _, ok in checks) else 1)
