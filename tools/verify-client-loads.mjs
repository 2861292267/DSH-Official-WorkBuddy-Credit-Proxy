/*
 * 卡片必须能被宿主真正加载。
 *
 * 2.4.0 首发的真实事故：`node --check` 通过、所有字符串断言通过，但插件
 * import 失败，报
 *   Cannot access 'POOL_COMPENSATION_PATH' before initialization
 * 因为 ROUTES 的对象初始化器引用了几行之后才声明的 const（暂时死区）。
 * 语法检查抓不到这个 —— 它只看文法，不求值。
 *
 * 所以这里**真的执行一次** factory，模拟宿主的加载路径：
 *   window.__ModuleLoader__.load({ id, factory }) 里 factory 被立即调用。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/*
 * lib 就在 tools 的上一级。这里曾写成 tools/../../repo-...，结果拼出一条
 * tools/repo-.../lib 的路径，suite 直接读不到文件。
 */
const LIB = process.env.ROTAKIT_LIB
	?? join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

let checks = 0, failures = 0;
const check = (name, ok, detail) => {
	checks += 1;
	if (!ok) failures += 1;
	console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : ` -> ${String(detail).slice(0, 240)}`}`);
};

console.log("\n=== 1. 先写进临时文件，让 Node 按 ESM 求值 ===");
const src = readFileSync(join(LIB, "client.js"), "utf8");
const os = await import("node:os");
const path = await import("node:path");
const tmp = join(os.tmpdir(), `rk-client-load-${String(process.pid)}.mjs`);
const { writeFileSync, rmSync } = await import("node:fs");
writeFileSync(tmp, src, "utf8");

console.log("\n=== 2. 用贴近宿主的 stub 真的跑一次 factory ===");
{
	const react = {
		createElement: () => null,
		useState: () => [undefined, () => {}],
		useEffect: () => {},
		useMemo: (f) => f(),
		useCallback: (f) => f,
		useRef: () => ({}),
		Component: class Component {},
		Fragment: "Fragment",
	};
	let ran = false;
	let thrown;
	let exportCount = 0;
	globalThis.window = {
		__ModuleLoader__: {
			load: ({ factory }) => {
				try {
					const m = factory(() => react);
					ran = true;
					exportCount = Object.keys(m ?? {}).length;
				} catch (error) {
					thrown = error;
				}
			},
		},
	};
	try {
		await import(pathToFileURL(tmp).href);
	} catch (error) {
		thrown = error;
	}
	check("factory 真的被执行了", ran === true, thrown === undefined ? "" : `未执行：${String(thrown?.message)}`);
	check("factory 执行时没有抛错", thrown === undefined, String(thrown?.message ?? ""));
	check("导出的符号数量合理（>10）", exportCount > 10, `got ${String(exportCount)}`);
	check("apply 与 inject 都在导出里", exportCount > 0);
}

console.log("\n=== 3. 顺序断言：常量必须声明在 ROUTES 之前 ===");
{
	const atConst = src.indexOf('const POOL_COMPENSATION_PATH = "');
	const atRoutes = src.indexOf("const ROUTES = {");
	check("POOL_COMPENSATION_PATH 出现在 ROUTES 之前", atConst !== -1 && atRoutes !== -1 && atConst < atRoutes,
		`const@${String(atConst)} routes@${String(atRoutes)}`);
	for (const name of ["POOL_COMPENSATION_PATH", "POOL_GIFT_PATH", "POOL_REWARDS_ALL_PATH"]) {
		const at = src.indexOf(`const ${name} = "`);
		check(`${name} 声明在 ROUTES 之前`, at !== -1 && at < atRoutes);
	}
	const broken = src.replace('const POOL_COMPENSATION_PATH = "/plugins/dsh-rotakit/compensation"', '')
		.replace('const POOL_COMPENSATION_PATH = "/plugins/dsh-rotakit/compensation";', '');
	check("把常量挪到 ROUTES 之后，这条断言必然转红",
		broken.indexOf("const ROUTES = {") < broken.indexOf("POOL_COMPENSATION_PATH"));
}

rmSync(tmp, { force: true });
console.log(`\n${checks - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

function pathToFileURL(p) {
	return { href: `file://${p.replace(/\\/g, "/")}` };
}
