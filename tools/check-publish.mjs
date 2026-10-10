/*
 * 发布前检查（可重复运行）—— 固化到仓库 tools/。
 *
 * ## 为什么要这个
 *
 * 两个真实的发布缺陷都是「本机看不到」的：
 *   1. protocol-compat.js 不在更新列表 → 老用户更新后插件加载失败
 *   2. qrcode 没声明为依赖 → 别人装了扫码功能报错
 *
 * 本机有大量"恰好存在"的东西掩盖了它们。这个检查专门针对这类问题。
 *
 * ## 三项检查，都**不依赖宿主环境**（因此本机可跑，且结论对别人也成立）
 *
 *   A. 静态依赖分析
 *      所有 import 都在 package.json 里有交代（依赖/可选/peer/内置/相对文件）
 *
 *   B. 可选依赖的隔离性
 *      在**父级链无 node_modules** 的隔离位置加载插件，
 *      证明缺少可选依赖时不会阻止启动
 *
 *   C. 更新完整性
 *      更新列表覆盖了所有"加载时必须存在"的文件
 *      （这是 protocol-compat.js 那个缺陷的直接检查）
 *
 * ## 无法模拟的部分（如实说明）
 *
 * peerDependencies 由 DSH 宿主运行时提供，不在 profile/node_modules 里，
 * 因此**无法**在独立目录复现"宿主视角"。检查 B 用桩替代，只验证
 * 「缺可选依赖不影响加载」这一个性质。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/* The plugin to check: an explicit path, else the usual install, else two levels up. */
const PLUGIN = process.env.ROTAKIT_PLUGIN
	?? (existsSync("C:\\Users\\ASUS\\.dsh\\profiles\\desktop\\node_modules\\dsh-rotakit\\package.json")
		? "C:\\Users\\ASUS\\.dsh\\profiles\\desktop\\node_modules\\dsh-rotakit"
		: resolve(here, ".."));
const NODE = process.execPath;
/* The probe must sit where NO ancestor has node_modules, or Node's upward lookup
 * finds the host's packages and "missing dependency" cannot be simulated. A drive
 * root satisfies that. */
const PROBE = "D:\\_rotakit-publish-probe";

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : ` -> ${String(detail).slice(0, 160)}`}`); };

console.log(`=== 检查插件: ${PLUGIN} ===\n`);
const pkg = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));

/* ── A. 静态依赖分析 ─────────────────────────────────────────────────────── */
console.log("A. 静态依赖分析");
{
	const libFiles = readdirSync(join(PLUGIN, "lib")).filter((f) => f.endsWith(".js") && !/\.(bak|orig-)/.test(f));
	const imports = new Map();
	for (const f of libFiles) {
		const src = readFileSync(join(PLUGIN, "lib", f), "utf8");
		/*
		 * Static imports, with two constraints that pull in opposite directions.
		 *
		 * They may span lines - `import {\n  A,\n  B\n} from "./x.js"` is how this
		 * codebase writes multi-symbol ones - so newlines must be allowed. But a
		 * pattern that allows anything between `import` and `from` also swallows prose:
		 * a comment reading "...who would serve the next one" was matched as a package
		 * name and reported as an undeclared dependency.
		 *
		 * The clause between the keywords is therefore restricted to what an import
		 * clause can actually contain: identifiers, commas, braces, asterisks and
		 * whitespace. That admits the multiline form and refuses sentences.
		 */
		for (const m of src.matchAll(/^import\s+[\w${},*\s]*?\bfrom\s+"([^"]+)"/gm)) imports.set(m[1], true);
		for (const m of src.matchAll(/^import\s+"([^"]+)"/gm)) imports.set(m[1], true);
		for (const m of src.matchAll(/await import\("([^"]+)"\)/g)) imports.set(m[1], true);
	}
	console.log(`   lib/ 下 ${libFiles.length} 个模块，${imports.size} 个导入目标`);

	const undeclared = [];
	const missingRelative = [];
	for (const name of imports.keys()) {
		if (name.startsWith("node:")) continue;
		if (name.startsWith(".")) {
			if (!existsSync(join(PLUGIN, "lib", name.replace("./", "")))) missingRelative.push(name);
			continue;
		}
		const parts = name.split("/");
		const base = name.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
		const declared = pkg.dependencies?.[base] ?? pkg.optionalDependencies?.[base] ?? pkg.peerDependencies?.[base];
		if (declared === void 0) undeclared.push(base);
	}
	check("每个外部导入都在 package.json 里有交代", undeclared.length === 0, undeclared.join(", "));
	check("每个相对导入的文件都存在", missingRelative.length === 0, missingRelative.join(", "));
}

/* ── B. 可选依赖的隔离性 ─────────────────────────────────────────────────── */
console.log("\nB. 可选依赖缺失时不阻止启动");
{
	rmSync(PROBE, { recursive: true, force: true });
	mkdirSync(join(PROBE, "lib"), { recursive: true });
	for (const f of readdirSync(join(PLUGIN, "lib"))) {
		if (/\.(bak|orig-)/.test(f)) continue;
		cpSync(join(PLUGIN, "lib", f), join(PROBE, "lib", f));
	}
	writeFileSync(join(PROBE, "package.json"), JSON.stringify({ name: "publish-probe", type: "module", private: true }));

	/* Stubs for what the HOST provides. This is the one thing that cannot be
	 * simulated, so it is faked in the smallest way that lets the load reach the
	 * optional import - which is the only behaviour under test here. */
	const stubs = {
		"@deepseek-ai/schemastery": `function z(s){const o={};for(const k of["description","default","comment","required","hidden","extra","role","disabled","label","min","max","step"])o[k]=()=>o;o.toString=()=>"s";o[Symbol.toPrimitive]=()=>"s";return o}for(const k of["object","string","number","boolean","array","dict","union","const","intersect","transform","any","natural","percent"])z[k]=()=>z({});z.default=()=>z({});export default z;export{z};`,
		"@deepseek-ai/dsh-llm": `export function resolveImageAttachmentAccess(){return{allowed:false}}export function resolveRetryPolicy(){return{maxRetries:0}}`,
		"@deepseek-ai/dsh-llm-pi-ai": `export class PiAiAdapter{}`,
		"@earendil-works/pi-ai": `export function createProvider(){throw new Error("stub")}`
	};
	for (const [dir, body] of Object.entries(stubs)) {
		const p = join(PROBE, "node_modules", dir);
		mkdirSync(p, { recursive: true });
		const sp = { name: dir, version: "0.0.0", type: "module", main: "index.js" };
		if (dir === "@earendil-works/pi-ai") sp.exports = { ".": "./index.js", "./api/openai-completions.lazy": "./api/openai-completions.lazy.js" };
		writeFileSync(join(p, "package.json"), JSON.stringify(sp));
		writeFileSync(join(p, "index.js"), body);
	}
	mkdirSync(join(PROBE, "node_modules", "@earendil-works", "pi-ai", "api"), { recursive: true });
	writeFileSync(join(PROBE, "node_modules", "@earendil-works", "pi-ai", "api", "openai-completions.lazy.js"), `export function openAICompletionsApi(){throw new Error("stub")}`);

	/* Confirm the probe really cannot see the optional package first: without this the
	 * load succeeding would prove nothing. */
	const probeFile = join(PROBE, "probe.mjs");
	const optional = Object.keys(pkg.optionalDependencies ?? {});
	if (optional.length === 0) console.log("   (no optionalDependencies declared - nothing to test)");
	for (const name of optional) {
		writeFileSync(probeFile, `import(${JSON.stringify(name)}).then(()=>console.log("HAS")).catch(e=>console.log("MISSING:"+e.code))`);
		let out = "";
		try { out = String(execFileSync(NODE, [probeFile], { stdio: "pipe", timeout: 30000, cwd: PROBE })); }
		catch (e) { out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
		check(`隔离环境确实看不到可选依赖 ${name}`, out.includes("MISSING"), out.trim().slice(0, 70));
	}

	const runLoad = () => {
		try {
			return String(execFileSync(NODE, ["-e", `import("./lib/index.js").then(()=>console.log("LOADED_OK")).catch(e=>{console.log("LOAD_FAIL|"+String(e.code||e.name));process.exit(3)})`],
				{ stdio: "pipe", timeout: 60000, cwd: PROBE }));
		} catch (e) {
			return String(e.stdout ?? "") + String(e.stderr ?? "");
		}
	};
	const out = runLoad();
	check("**缺少可选依赖时插件仍能加载**", out.includes("LOADED_OK"), out.replace(/\n/g, " ").slice(0, 150));
	rmSync(PROBE, { recursive: true, force: true });
}

/* ── C. 更新完整性 ───────────────────────────────────────────────────────── */
console.log("\nC. 更新列表覆盖所有加载时必需的文件");
{
	const index = readFileSync(join(PLUGIN, "lib", "index.js"), "utf8");
	const m = /const TRACKED_FILES = \[([^\]]+)\]/.exec(index);
	if (m === null) check("找到 TRACKED_FILES 定义", false);
	else {
		const tracked = m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
		console.log(`   TRACKED_FILES: ${tracked.join(", ")}`);
		/* Every file index.js imports at load time must be in the update list, or an
		 * install that predates it updates into a module it cannot resolve. */
		/* Same import-clause pattern as check A, for the same two reasons. */
		const staticImports = [...index.matchAll(/^import\s+[\w${},*\s]*?\bfrom\s+"(\.\/[^"]+)"/gm)].map((x) => x[1]);
		const required = [...new Set(staticImports)].map((rel) => `lib/${rel.replace("./", "")}`);
		const missing = required.filter((r) => !tracked.includes(r));
		console.log(`   index.js 静态导入的相对文件: ${required.join(", ") || "(none)"}`);
		check("所有加载时导入的文件都在更新列表里", missing.length === 0, missing.join(", "));
	}
	const anyMissing = ["lib/index.js", "lib/client.js", "lib/protocol-compat.js", "package.json"]
		.filter((f) => !existsSync(join(PLUGIN, f)));
	check("插件包含全部预期文件", anyMissing.length === 0, anyMissing.join(", "));
}

/* ── 汇总 ───────────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
	console.log("\nfailures:");
	for (const f of failed) console.log(`  - ${f.name}`);
}
console.log(`
note: peerDependencies come from the DSH host at runtime and are absent from
profile/node_modules, so the host's resolution cannot be reproduced here. Check B
substitutes stubs and therefore verifies one property only: a missing OPTIONAL
dependency cannot prevent the plugin from loading.`);
process.exit(failed.length);
