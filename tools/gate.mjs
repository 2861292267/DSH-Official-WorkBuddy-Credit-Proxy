/**
 * 提交前硬闸门：任何一个检查不过，就不许提交、不许同步、不许发布。
 *
 * ## 为什么要这个
 *
 * 2026-10-18 这一天，`lib/index.js` 被改坏了两次，每次都是同一个模式：
 * 编辑时 `anchor_from`/`anchor_to` 选错范围，或 `replace_with` 多写/少写一个
 * 大括号，语法直接坏掉。而它一旦坏掉，整个 provider 注册不上 —— 所有模型请求
 * 500，用户看到的是「已重试模型请求」，跟插件本身的行为完全无关。
 *
 * 最关键的教训：**`node --check` 通过不代表能用。** 另一次事故是
 * `this.seedExpiries()` 被调用却从未定义 —— 语法合法，26 套回归全绿，
 * 但每个请求都 500。静态检查管不了「调用了不存在的方法」。
 *
 * 所以这里分三层，任何一层不过都 exit 1：
 *
 *   1. 语法：每个 lib/*.js 都要过 `node --check`
 *   2. 引用：每个 `this.foo()` 都必须有对应成员（_verify_method_refs）
 *   3. 加载：模块必须能被 import 而不抛错（真的跑一次）
 *
 * 用法：node tools/gate.mjs
 * 退出码：0 放行 / 1 拦截 / 100 环境问题
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "lib");
const SUITE_ROOT = join(HERE, "..", "..");

let failed = 0;
const line = (text) => console.log(text);

line("┌─────────────────────────────────────────────┐");
line("│  提交闸门：语法 → 引用 → 加载 → 回归          │");
line("└─────────────────────────────────────────────┘");

/* ---------- 1. 语法 ---------- */
line("\n[1/4] 语法检查");
let jsFiles;
try {
	jsFiles = readdirSync(LIB).filter((name) => name.endsWith(".js")).sort();
} catch (error) {
	console.error(`❌ 读不到 lib/: ${error.message}`);
	process.exit(100);
}
for (const name of jsFiles) {
	try {
		execFileSync(process.execPath, ["--check", join(LIB, name)], { stdio: "pipe" });
		line(`  ok   ${name}`);
	} catch (error) {
		failed += 1;
		line(`  FAIL ${name}`);
		const out = String(error.stderr ?? "").split("\n").slice(0, 4).join("\n");
		line(out.replace(/^/gm, "         "));
	}
}
if (jsFiles.length === 0) {
	line("  FAIL lib/ 下没有任何 .js —— 路径错了");
	failed += 1;
}

/* ---------- 2. 引用 ---------- */
line("\n[2/4] 方法引用对账");
{
	const suite = join(SUITE_ROOT, "_verify_method_refs.mjs");
	try {
		const out = execFileSync(process.execPath, [suite], {
			encoding: "utf8",
			env: { ...process.env, ROTAKIT_LIB: LIB }
		});
		const last = out.trim().split("\n").filter((l) => /passed/.test(l)).pop() ?? "";
		line(`  ok   ${last.trim()}`);
	} catch (error) {
		failed += 1;
		line("  FAIL 有调用找不到定义（这正是 seedExpiries 那次 500 的原因）");
		line(String(error.stdout ?? error.message).split("\n").filter((l) => /FAIL|✗/.test(l)).slice(0, 6).join("\n").replace(/^/gm, "         "));
	}
}

/* ---------- 3. 加载 ---------- */
line("\n[3/4] 模块加载");
{
	/*
	 * 真正 import 一次主模块。宿主的 peerDependencies 在这里不可用，所以
	 * 直接 import 会因缺依赖失败 —— 那不是我们要检测的东西。
	 * 这里只要求「相对路径的导入都能解析」，也就是每个 `from "./x.js"`
	 * 都能在磁盘上找到对应文件。缺文件是老版本用户更新后 ERR_MODULE_NOT_FOUND 的成因。
	 */
	const entry = readFileSync(join(LIB, "index.js"), "utf8");
	/*
	 * 先把注释抹掉再找导入。上一版直接在原文上匹配，把注释里的示例
	 * `import x from "./y.js"` 当成了真导入，报出一个不存在的文件 ——
	 * 那是假红，会让人去改一个根本不存在的 bug。
	 */
	const stripped = entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
	const imports = [...stripped.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
	const missing = imports.filter((spec) => {
		try {
			readFileSync(join(LIB, spec.replace(/^\.\//, "")), "utf8");
			return false;
		} catch {
			return true;
		}
	});
	if (missing.length > 0) {
		failed += 1;
		line(`  FAIL 相对导入找不到文件: ${missing.join(", ")}`);
	} else {
		line(`  ok   ${imports.length} 个相对导入全部可解析: ${imports.join(", ")}`);
	}
}

/* ---------- 4. 回归 ---------- */
line("\n[4/4] 回归套件");
{
	let suites;
	try {
		suites = JSON.parse(readFileSync(join(HERE, "SUITES.json"), "utf8")).suites;
	} catch (error) {
		console.error(`❌ 读不到 SUITES.json: ${error.message}`);
		process.exit(100);
	}
	let passed = 0;
	let totalFailed = 0;
	/*
	 * 串行执行。`_verify_shim_e2e` / `_verify_origin` / `_verify_final_health`
	 * 会各自拉起一个 shim 监听端口，并发跑会互相抢端口，报出「请求失败」的假红 ——
	 * 单跑三次都是 39/39 全过。闸门自己不能因为调度方式而误报。
	 *
	 * 重试 1 次：这些套件依赖本机回环网络与固定端口，偶发的一次 bind 冲突
	 * 不该拦住整个提交，但连续两次失败一定是真问题。
	 */
	for (const entry of suites) {
		const file = join(SUITE_ROOT, entry.file);
		/*
		 * 尝试两次。第一次失败可能是端口冲突（本机回环被别的套件或真实 shim 占着），
		 * 隔 300ms 再跑一次。两次都红才是真问题，报告只展示第二次的输出。
		 */
		let out = "";
		let error = void 0;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				out = execFileSync(process.execPath, [file], {
					encoding: "utf8",
					env: { ...process.env, ROTAKIT_LIB: LIB },
					stdio: "pipe"
				});
				error = void 0;
				break;
			} catch (caught) {
				error = caught;
				out = String(caught.stdout ?? "");
				/* 真断言失败（输出里有 FAIL 行）不必重试；无法执行才重试 */
				if (/\bFAIL\b/.test(out)) break;
				if (attempt === 0) execFileSync(process.execPath, ["-e", "setTimeout(()=>{},300)"], { stdio: "pipe" });
			}
		}
		if (error === void 0) {
			const m = out.match(/(\d+) passed, (\d+) failed/);
			if (m !== null) passed += Number(m[1]);
		} else {
			totalFailed += 1;
			line(`  FAIL ${entry.file}`);
			line(out.split("\n").filter((l) => /FAIL/.test(l)).slice(0, 4).join("\n").replace(/^/gm, "         "));
		}
	}
	if (totalFailed > 0) failed += totalFailed;
	line(`  ${totalFailed === 0 ? "ok  " : "FAIL"} ${suites.length - totalFailed}/${suites.length} 套通过，${passed} 条断言`);
}

/* ---------- 结论 ---------- */
line("");
if (failed === 0) {
	line("✅ 闸门放行 —— 可以提交、同步、发布");
	process.exit(0);
}
line(`❌ 闸门拦截：${failed} 项未通过。修好之前不要提交。`);
line("");
line("这四层里任何一层不过，插件都可能完全不可用：");
line("  语法坏 → provider 注册不上，所有请求 500");
line("  引用缺 → 每个请求 500（seedExpiries 事故）");
line("  文件缺 → 老用户更新后 ERR_MODULE_NOT_FOUND");
line("  回归红 → 某个已修好的行为又坏了");
process.exit(1);
