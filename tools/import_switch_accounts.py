"""把 workbuddy-switch 导出的账号快照转成 xdpool 能识别的凭据文件。

依据（从插件源码核实）：
- authFilesIn(dir): entries.filter(name => name.endsWith(".info"))   → 目录下所有 .info 都算一个账号
- readCredential(): 文件不含 "$wbEncrypted" 时按明文解析              → 明文 token 可直接用
- parseWorkBuddyAuth(): 需要 auth.accessToken（空则忽略该文件）；
  可选 auth.refreshToken / domain / expiresAt / lastRefreshTime / account.{nickname,uin,uid}
  ⚠️ auth.refreshExpiresAt 若 >0 且已过期 → 整个文件被跳过 → 本脚本不写该字段
- expiryToMs: >1e12 视为毫秒，否则按秒 → 原始毫秒值原样传即可
- 账号 id 优先 uin，回退 uid

输出：%APPDATA%\\CodeBuddyExtension\\Data\\Public\\auth\\workbuddy-pool-XX.info
（插件会同时扫 LOCALAPPDATA 与 ROAMING 两处；写 ROAMING 可避开 WorkBuddy 正在用的活动文件）
"""
import json
import os
import sys
import time
from pathlib import Path

# 源文件路径不写死：用命令行参数传入，或设 WB_SWITCH_EXPORT 环境变量。
#   python tools/import_switch_accounts.py <workbuddy-switch 导出的 JSON>
# 这样脚本不含任何个人目录名，也能用于任意机器。
if len(sys.argv) > 1:
    SRC = Path(sys.argv[1]).expanduser()
elif os.environ.get("WB_SWITCH_EXPORT"):
    SRC = Path(os.environ["WB_SWITCH_EXPORT"]).expanduser()
else:
    sys.exit("用法：python tools/import_switch_accounts.py <accounts.json>\n"
             "（或设置环境变量 WB_SWITCH_EXPORT 指向该文件）")

DEST_DIR = Path(os.environ["APPDATA"]) / "CodeBuddyExtension" / "Data" / "Public" / "auth"

if not SRC.is_file():
    sys.exit(f"源文件不存在：{SRC}")

src = json.loads(SRC.read_text(encoding="utf-8"))
DEST_DIR.mkdir(parents=True, exist_ok=True)

now_ms = int(time.time() * 1000)
written = []

for idx, a in enumerate(src, 1):
    ar = a.get("auth_raw") or {}
    au = dict(ar.get("auth") or {})
    prof = dict(a.get("profile_raw") or {})

    # accessToken：优先 auth_raw.auth，回退顶层
    at = au.get("accessToken") or a.get("access_token")
    rt = au.get("refreshToken")
    if not at:
        print("  [跳过] 第 %d 个（%s）没有 accessToken" % (idx, a.get("nickname")))
        continue

    domain = au.get("domain") or a.get("domain") or ""
    exp = au.get("expiresAt") or a.get("expiresAt")
    last_ref = au.get("lastRefreshTime")

    # 身份：以 account（auth_raw.account，回退 profile_raw）为准，nickname/phone 写成明文
    acct = dict(ar.get("account") or {})
    if not acct:
        acct = dict(prof)
    for key, val in (("nickname", a.get("nickname")), ("phoneNumber", prof.get("phoneNumber") or acct.get("phoneNumber"))):
        if val and not isinstance(val, dict):
            acct[key] = val
        elif not val:
            acct.pop(key, None)
    # 身份字段补齐：uin/uid 让插件能做去重与稳定 id
    for key in ("uin", "uid", "enterpriseId", "oneidAccountId"):
        v = acct.get(key) or prof.get(key) or a.get(key)
        if v:
            acct[key] = v

    auth = {
        "accessToken": at,
        "domain": domain,
    }
    if rt:
        auth["refreshToken"] = rt
    if isinstance(exp, (int, float)) and exp > 0:
        auth["expiresAt"] = int(exp)
    if isinstance(last_ref, (int, float)) and last_ref > 0:
        auth["lastRefreshTime"] = int(last_ref)
    # 刻意不写 refreshExpiresAt（避免"已过期即跳过整份文件"）
    for k in ("tokenType", "scope", "sessionState", "notBeforePolicy"):
        if au.get(k) is not None:
            auth[k] = au[k]

    doc = {
        "account": acct,
        "accounts": ar.get("accounts") or [acct],
        "allAccounts": ar.get("allAccounts") or [acct],
        "auth": auth,
    }

    out = DEST_DIR / ("workbuddy-pool-%02d.info" % idx)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")

    exp_ms = exp if isinstance(exp, (int, float)) and exp > 1e12 else (exp * 1000 if isinstance(exp, (int, float)) else 0)
    left = ""
    if exp_ms:
        left = ("剩余 %.0f 天" % ((exp_ms - now_ms) / 86400000)) if exp_ms > now_ms else "已过期"
    written.append({
        "file": out.name,
        "昵称": str(a.get("nickname"))[:12],
        "域名": domain,
        "refresh": "有" if rt else "无",
        "过期": left,
        "uin": str(acct.get("uin") or "-"),
    })

print("目标目录:", DEST_DIR)
print("已写入 %d 份凭据：" % len(written))
print("  %-22s %-12s %-18s %-6s %-12s %s" % ("文件", "昵称", "域名", "刷新", "过期", "uin"))
for w in written:
    print("  %-22s %-12s %-18s %-6s %-12s %s" % (w["file"], w["昵称"], w["域名"], w["refresh"], w["过期"], w["uin"]))
