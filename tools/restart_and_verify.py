"""彻底重启官方版（杀净所有进程再启动），让补丁真正加载，并持续观察 150 秒。

之前的教训：应用是单实例的，直接再启动一次不会加载新代码；
必须先把所有 DeepSeek Harness 进程杀干净。
"""
import subprocess
import time
from datetime import datetime
from pathlib import Path

EXE = r"D:\DeepSeek Harness\DeepSeek Harness.exe"
LOGS = Path(r"C:\Users\ASUS\AppData\Roaming\@deepseek-ai\dsh-desktop\logs")
CNW = 0x08000000


def log(m):
    print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), m), flush=True)


def dsh_pids():
    out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True,
                         text=True, errors="replace").stdout or ""
    pids = []
    for line in out.splitlines():
        if '"' not in line:
            continue
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) >= 2 and parts[0].lower().startswith("deepseek") and parts[1].isdigit():
            pids.append(parts[1])
    return pids


def ports_of(pids):
    out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True,
                         text=True, errors="replace").stdout or ""
    return [l.strip() for l in out.splitlines()
            if "LISTENING" in l.upper() and l.split()[-1] in pids]


before = {p.name for p in LOGS.glob("*")}
pids0 = dsh_pids()
log("基线: 进程 %d 个 %s" % (len(pids0), ",".join(pids0) or "无"))
log("基线端口: %s" % (ports_of(pids0) or "无"))

log("步骤 1: 杀净所有官方版进程（含 host 子进程）")
for pid in pids0:
    subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], creationflags=CNW,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(6)
left = dsh_pids()
log("  剩余进程: %s" % (left or "无"))
if left:
    log("  仍有残留，放弃重启以免误伤")
    raise SystemExit(0)

log("步骤 2: 重新启动（explorer，脱离沙箱 job）—— 这次会真正加载补丁")
subprocess.Popen(["explorer.exe", EXE])

last = -1
for i in range(30):                     # 30 × 5s = 150s
    time.sleep(5)
    pids = dsh_pids()
    if len(pids) != last:
        log("  +%3ds 进程数=%d" % ((i + 1) * 5, len(pids)))
        last = len(pids)

pids = dsh_pids()
new = sorted({p.name for p in LOGS.glob("*")} - before)
log("最终进程数=%d" % len(pids))
log("DSH 服务端口: %s" % (ports_of(pids)[:6] or "无"))
log("新增日志: %s" % (new or "无"))

for n in new:
    log("--- %s ---" % n)
    for line in (LOGS / n).read_text(encoding="utf-8", errors="replace").splitlines()[:28]:
        print("    " + line)

ok = len(pids) >= 3 and not new
log("判定: %s" % ("通过 —— 补丁加载后无崩溃、服务已监听" if ok else
                  ("进程在但出现新日志" if pids else "进程未存活")))
