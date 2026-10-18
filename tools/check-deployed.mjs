#!/usr/bin/env node
/**
 * 体检 dsh-rotakit 的部署副本。
 *
 * 存在的原因很具体：这个插件的部署目录被手改过三次，三次都崩在同一个位置类型上——
 * 往 class 里插方法时多带一个 `}`，class 被提前闭合，后面的方法掉到模块顶层，
 * 于是 `node --check` 报一句看不懂的 "Unexpected token '{'"，而报错行号离真正的
 * 改动点有几百行。这个脚本把这类错误压缩成一句人话，并且能同时检查
 * 那些 `node --check` 看不见的问题（命名导入是否存在、方法是否还在类里）。
 *
 * 用法：
 *   node tools/check-deployed.mjs            # 体检部署副本
 *   node tools/check-deployed.mjs --repo     # 只体检仓库副本（部署前预检）
 *
 * 退出码 0 = 全部通过；1 = 有硬错误。警告不影响退出码。
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEPLOYED_ROOT = process.env.DSH_ROTAKIT_HOME
	?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".dsh", "profiles", "desktop", "node_modules", "dsh-rotakit");

const repoOnly = process.argv.includes("--repo");
const target = repoOnly ? REPO_ROOT : DEPLOYED_ROOT;

const errors = [];
const warnings = [];
const notes = [];

function fail(message) {
	errors.push(message);
}
function warn(message) {
	warnings.push(message);
}

/** 1. 语法：每个 lib/*.js 都必须能被 node 解析。 */
function checkSyntax(root) {
	const libDir = join(root, "lib");
	if (!existsSync(libDir)) {
		fail(`找不到 ${libDir}——部署路径不对？用 DSH_ROTAKIT_HOME 指定。`);
		return [];
	}
	const files = readdirSync(libDir).filter((name) => name.endsWith(".js"));
	for (const name of files) {
		const full = join(libDir, name);
		const result = spawnSync(process.execPath, ["--check", full], { encoding: "utf8" });
		if (result.status === 0) continue;
		// node 的报错格式是 "文件:行号\n  源码\n  指针\n\nSyntaxError: ..."
		const text = `${result.stderr ?? ""}`;
		const at = text.match(/^(.+?):(\d+)\n/m);
		const why = text.match(/^(\w*Error: .+)$/m);
		const line = at ? at[2] : "?";
		fail(`${name} 语法错误（第 ${line} 行）：${why ? why[1] : "见 node --check 输出"}`);
		// 多给一行上下文：报错行本身。
		if (at) {
			const src = readFileSync(full, "utf8").split(/\r?\n/)[Number(line) - 1];
			if (src !== undefined) notes.push(`  ${name}:${line} → ${src.trim().slice(0, 100)}`);
		}
	}
	return files;
}

/**
 * 2. 结构：不允许出现"看起来像方法、实际在模块顶层"的行。
 *
 * 这正是三次崩溃的共同形状：`reset() {` / `fetchCredits(...) {` 顶格出现。
 * 合法的顶格写法只有 `function name(`、控制流（if/for/while/switch/catch）、
 * 以及对象字面量的方法简写（出现在 `= {` 之后，这里不误判，因为要求顶格）。
 */
function checkTopLevelMethods(root) {
	const file = join(root, "lib", "index.js");
	if (!existsSync(file)) return;
	const lines = readFileSync(file, "utf8").split(/\r?\n/);
	const methodAtTop = /^(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{\s*$/;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (!methodAtTop.test(line)) continue;
		const name = line.slice(0, line.indexOf("(")).replace(/^async\s+/, "").trim();
		// `function` 关键字开头的行不匹配上面的正则，所以这里只会剩裸方法名。
		fail(`lib/index.js:${i + 1} 有一个方法掉到了模块顶层：\`${name}()\` —— 通常是它上方的 class 被多余的 \`}\` 提前闭合了`);
		notes.push(`  lib/index.js:${i + 1} → ${line.trim().slice(0, 100)}`);
	}
}

/** 3. 方法归属：这些方法必须还在各自的 class 里（tab 缩进）。 */
function checkMethodHome(root) {
	const file = join(root, "lib", "index.js");
	if (!existsSync(file)) return;
	const source = readFileSync(file, "utf8");
	const expected = [
		"fetchModels", "fetchAlternates", "fetchCredits",
		"setAlternates", "alternateFor", "reset", "applySelection", "visible"
	];
	for (const name of expected) {
		const inside = new RegExp(`^\\t(?:async\\s+)?${name}\\s*\\(`, "m").test(source);
		if (!inside) fail(`lib/index.js 里找不到类内方法 \`${name}\`（要么被删了，要么掉到类外了）`);
	}
}

/**
 * 4. 命名导入：`import { a, b } from "./x.js"` 里的每个名字，
 *    必须真的被 x.js 导出。`node --check` 不检查这个，而它在加载期才炸。
 */
function checkNamedImports(root) {
	const libDir = join(root, "lib");
	if (!existsSync(libDir)) return;
	for (const name of readdirSync(libDir).filter((n) => n.endsWith(".js"))) {
		const source = readFileSync(join(libDir, name), "utf8");
		const importRe = /import\s*\{([^}]+)\}\s*from\s*"\.\/([^"]+)"/g;
		for (const match of source.matchAll(importRe)) {
			const wanted = match[1].split(",").map((s) => s.trim()).filter(Boolean);
			const depPath = join(libDir, match[2]);
			if (!existsSync(depPath)) {
				fail(`${name} 导入了不存在的文件 ${match[2]}`);
				continue;
			}
			const dep = readFileSync(depPath, "utf8");
			for (const spec of wanted) {
				const imported = spec.split(/\s+as\s+/)[0].trim();
				const exported = new RegExp(`export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+${imported}\\b`).test(dep)
					|| new RegExp(`\\b${imported}\\b[^;]*\\}\\s*;?\\s*$`, "m").test(dep);
				if (!exported) fail(`${name} 从 ${match[2]} 导入了 \`${imported}\`，但那个文件没有导出它`);
			}
		}
	}
}

/** 5. 漂移：部署副本与仓库副本是否一致。 */
function checkDrift() {
	const pairs = [["lib/index.js"], ["lib/client.js"], ["lib/rtk.js"], ["lib/protocol-compat.js"], ["package.json"]];
	/*
	 * 按"去掉行尾符之后的内容"比较，不按字节。
	 * 仓库里存的是 CRLF，部署副本是 LF（或者反过来），逐字节比会把每一行都报成
	 * 改动——999 行就是 999 字节的差，看着像真有内容变化，实际一个字都没变。
	 */
	const fingerprint = (p) => createHash("sha256")
		.update(readFileSync(p, "utf8").replace(/\r\n/g, "\n"))
		.digest("hex")
		.slice(0, 12);
	for (const [rel] of pairs) {
		const a = join(REPO_ROOT, rel);
		const b = join(DEPLOYED_ROOT, rel);
		if (!existsSync(a) || !existsSync(b)) continue;
		if (fingerprint(a) === fingerprint(b)) continue;
		const sizeA = readFileSync(a).length;
		const sizeB = readFileSync(b).length;
		warn(`${rel} 与仓库不一致（仓库 ${sizeA} 字节 / 部署 ${sizeB} 字节）——改动没有回到仓库，下次重新部署会丢`);
	}
}

console.log(`dsh-rotakit 体检：${target}`);
if (!repoOnly && !existsSync(DEPLOYED_ROOT)) {
	fail(`部署目录不存在：${DEPLOYED_ROOT}`);
}

const files = checkSyntax(target);
checkTopLevelMethods(target);
checkMethodHome(target);
checkNamedImports(target);
if (!repoOnly) checkDrift();

console.log(`  已解析 ${files.length} 个 lib/*.js`);
for (const note of notes) console.log(note);
for (const message of warnings) console.log(`  [警告] ${message}`);
for (const message of errors) console.log(`  [错误] ${message}`);

if (errors.length > 0) {
	console.log(`\n未通过：${errors.length} 个错误。别急着说"好了"，先修完再跑一次。`);
	process.exit(1);
}
console.log(`\n通过。${warnings.length > 0 ? `${warnings.length} 个警告（不影响加载）。` : ""}`);
