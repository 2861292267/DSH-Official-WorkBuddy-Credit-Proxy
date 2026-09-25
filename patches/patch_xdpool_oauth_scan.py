# -*- coding: utf-8 -*-
"""
dsh-workbuddy-xdpool：给卡片加「OAuth 扫码添加账号」。

背景：
  插件自身没有添加账号的能力（它的 `login` 只是一段说明：去 WorkBuddy App 扫码登录，
  再 import 快照）。扫码添加是 workbuddy-switch（Rust）自己实现的私有流程。本次把这套
  流程复刻进插件，入口放在卡片「账号使用方式」那一行的按钮区，旁边是「重新检测账号」。

上游流程（取自 switch 二进制里的 oauth.rs 常量，已实测可用）：
  POST {gateway}/v2/plugin/auth/state?platform=workbuddy   → {code:0, data:{state, authUrl}}
  QR   = authUrl（如 https://www.codebuddy.cn/login?platform=workbuddy&state=…）
  GET  {gateway}/v2/plugin/auth/token?state=…               → code 11217 = 等待扫码；0 = 成功
  GET  {gateway}/v2/plugin/login/account?state=…            → 账号资料（带 Bearer token）
  请求头：X-Client-Platform: workbuddy
  网关：cn=https://www.codebuddy.cn  global=https://www.workbuddy.ai

落盘：
  凭据写 <APPDATA>\\CodeBuddyExtension\\Data\\Public\\auth\\workbuddy-scan-<id8>.info
  —— 独立前缀，switch 镜像只重写 workbuddy-pool-*，所以扫码来的账号不会被后来的同步抹掉。
  诊断写 <DSH_HOME>/.workbuddy-xdpool/oauth-last.json，只记字段形状，不含 token。

依赖：qrcode（纯 JS）。**用动态 import 加载** —— 缺包只让扫码功能不可用，不会让整个插件
加载失败（ESM 的具名导入是硬失败）。

幂等：已打过补丁则跳过。原文件备份为 *.orig-oauthscan。
"""
from pathlib import Path
import re
import shutil
import sys

BASE = Path(r"D:\WorkBuddy文件\2026-09-25-10-38-26")
FRAG_HOST = BASE / "_frag_oauth_host.js"
FRAG_CLIENT = BASE / "_frag_oauth_client.js"

LIB = Path(r"C:\Users\ASUS\.dsh\profiles\desktop\node_modules\dsh-workbuddy-xdpool\lib")
INDEX = LIB / "index.js"
CLIENT = LIB / "client.js"

MARK = "[xdpool-oauth]"


def load_fragments(path):
    """Split a fragment file on `//===NAME===` markers."""
    text = path.read_text(encoding="utf-8")
    parts = re.split(r"^//===([A-Z_]+)===\s*$", text, flags=re.M)
    out = {}
    for i in range(1, len(parts), 2):
        out[parts[i]] = parts[i + 1]
    return out


def insert_before(text, needle, payload, label, expect=1):
    n = text.count(needle)
    if n != expect:
        print("  !! %s —— 锚点匹配 %d 次（需 %d）" % (label, n, expect))
        return text, 0
    print("  [x] %s" % label)
    return text.replace(needle, payload + needle, 1), 1


def insert_after(text, needle, payload, label, expect=1):
    n = text.count(needle)
    if n != expect:
        print("  !! %s —— 锚点匹配 %d 次（需 %d）" % (label, n, expect))
        return text, 0
    print("  [x] %s" % label)
    return text.replace(needle, needle + payload, 1), 1


def main():
    for f in (INDEX, CLIENT, FRAG_HOST, FRAG_CLIENT):
        if not f.is_file():
            print("FAIL: 缺少文件", f)
            return 1

    host_frag = load_fragments(FRAG_HOST)
    client_frag = load_fragments(FRAG_CLIENT)
    need_host = {"HOST_CONSTS", "HOST_HELPERS", "HOST_ROUTES", "HOST_DISPOSE"}
    need_client = {"CLIENT_CONSTS", "CLIENT_STATE", "CLIENT_BUTTON", "CLIENT_PANEL",
                   "CLIENT_TEXT_EN", "CLIENT_TEXT_ZH"}
    if not need_host <= set(host_frag) or not need_client <= set(client_frag):
        print("FAIL: 片段文件缺少区段 —— host:%s client:%s" % (sorted(host_frag), sorted(client_frag)))
        return 1

    index_text = INDEX.read_text(encoding="utf-8")
    client_text = CLIENT.read_text(encoding="utf-8")
    if MARK in index_text and MARK in client_text:
        print("ALREADY: 已打过扫码添加补丁。")
        return 0

    ok = 0

    # ---------- index.js ----------
    print("index.js:")
    anchor = 'const POOL_CREDIT_RESERVE_PATH = "/plugins/dsh-workbuddy-xdpool/accounts/credit-reserve";\n'
    index_text, r = insert_after(index_text, anchor, host_frag["HOST_CONSTS"], "路由常量"); ok += r
    index_text, r = insert_before(index_text, "function readJsonBody(req) {",
                                  host_frag["HOST_HELPERS"], "网关调用与凭据组装"); ok += r
    index_text, r = insert_before(index_text, "\t\tconst disposeStatus = ctx.webServer.register({",
                                  host_frag["HOST_ROUTES"], "两条路由（start / poll）"); ok += r
    pattern = re.compile(r"(return \(\) => \{\s*\n\s*)(disposeAutomationRun\(\);)")
    if len(pattern.findall(index_text)) == 1:
        index_text = pattern.sub(lambda m: m.group(1) + host_frag["HOST_DISPOSE"] + m.group(2),
                                 index_text, count=1)
        print("  [x] 清理函数登记"); ok += 1
    else:
        print("  !! 清理函数登记 —— 锚点未唯一")

    # ---------- client.js ----------
    print("client.js:")
    anchor = 'const POOL_CREDIT_RESERVE_PATH = "/plugins/dsh-workbuddy-xdpool/accounts/credit-reserve";\n'
    client_text, r = insert_after(client_text, anchor, client_frag["CLIENT_CONSTS"], "路由常量"); ok += r
    client_text, r = insert_before(client_text, "\t\t\tconst rescan = async () => {",
                                   client_frag["CLIENT_STATE"], "扫码状态与轮询"); ok += r

    btn_pat = re.compile(
        r'(children: \[)/\* @__PURE__ \*/ \(0, react_jsx_runtime\.jsx\)\("button", \{\s*\n'
        r'\s*type: "button",\s*\n\s*className: "dsm-btn dsm-btn-outline",\s*\n\s*disabled: busy,',
        re.S)
    if len(btn_pat.findall(client_text)) == 1:
        client_text = btn_pat.sub(lambda m: m.group(1) + client_frag["CLIENT_BUTTON"] + m.group(0)[len(m.group(1)):],
                                  client_text, count=1)
        print("  [x] 按钮插入按钮区"); ok += 1
    else:
        print("  !! 按钮插入按钮区 —— 锚点未唯一（%d）" % len(btn_pat.findall(client_text)))

    panel_pat = re.compile(r'(\n[ \t]*)(activeRegion !== "cn" \|\| status\?\.automation === void 0 \? null :)')
    if len(panel_pat.findall(client_text)) == 1:
        client_text = panel_pat.sub(lambda m: "\n" + client_frag["CLIENT_PANEL"].rstrip("\n") + m.group(1) + m.group(2),
                                    client_text, count=1)
        print("  [x] 二维码面板"); ok += 1
    else:
        print("  !! 二维码面板 —— 锚点未唯一（%d）" % len(panel_pat.findall(client_text)))

    client_text, r = insert_after(client_text, '\t\t\t"row.accountsRescan": "Detect accounts again",\n',
                                  client_frag["CLIENT_TEXT_EN"], "英文文案"); ok += r
    client_text, r = insert_after(client_text, '\t\t\t"row.accountsRescan": "重新检测账号",\n',
                                  client_frag["CLIENT_TEXT_ZH"], "中文文案"); ok += r

    if ok != 10:
        print("FAIL: 只有 %d/10 处成功，未写入任何文件。" % ok)
        return 1

    shutil.copy2(str(INDEX), str(LIB / "index.js.orig-oauthscan"))
    shutil.copy2(str(CLIENT), str(LIB / "client.js.orig-oauthscan"))
    print("  备份: index.js.orig-oauthscan / client.js.orig-oauthscan")
    INDEX.write_text(index_text, encoding="utf-8")
    CLIENT.write_text(client_text, encoding="utf-8")
    print("DONE: 10/10 处改动已写入")
    return 0


if __name__ == "__main__":
    sys.exit(main())
