#!/usr/bin/env node
/**
 * 把仓库里的 lib/ 部署到 DSH 的 node_modules，并在失败时自动回滚。
 *
 * 之所以要有这个脚本，而不是继续手工 copy：这个插件的部署副本被手改过三次，
 * 每次都崩，每次都没有备份。部署是个"要么全对、要么回到原样"的操作，
 * 手工做不成这样——所以交给脚本。
 *
 * 流程：
 *   1. 预检仓库副本（语法/结构/导入）
 *   2. 备份部署目录到 .dsh-rotakit-backups/<时间戳>/
 *   3. 复制 lib/*.js + package.json
 *   4. 复检部署副本，失败则用备份覆盖回去并以非零码退出
 *
 * 用法：
 *   node tools/deploy.mjs              # 部署
 *   node tools/deploy.mjs --dry-run    # 只看会动哪些文件
 *
 * 部署完必须重启 DeepSeek Harness —— 它的热重载在插件加载失败之后会卡死，
 * 别指望改完文件就生效。
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEPLOYED_ROOT = process.env.DSH_ROTAKIT_HOME
	?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".dsh", "profiles", "desktop", "node_modules", "dsh-rotakit");
const BACKUP_ROOT = join(dirname(dirname(DEPLOYED_ROOT)), ".dsh-rotakit-backups");
const dryRun = process.argv.includes("--dry-run");

function stamp() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function runCheck(root, label) {
	const result = spawnSync(process.execPath, [join(HERE, "check-deployed.mjs"), ...(label === "repo" ? ["--repo"] : [])], {
		encoding: "utf8",
		env: { ...process.env, DSH_ROTAKIT_HOME: root }
	});
	process.stdout.write(result.stdout ?? "");
	process.stderr.write(result.stderr ?? "");
	return result.status === 0;
}

if (!existsSync(join(REPO_ROOT, "lib", "index.js"))) {
	console.error(`找不到仓库副本：${join(REPO_ROOT, "lib")}`);
	process.exit(1);
}
if (!existsSync(join(DEPLOYED_ROOT, "lib"))) {
	console.error(`找不到部署目录：${DEPLOYED_ROOT}\n用 DSH_ROTAKIT_HOME 指定正确路径。`);
	process.exit(1);
}

console.log("① 预检仓库副本");
if (!runCheck(REPO_ROOT, "repo")) {
	console.error("\n仓库副本就没通过体检，不部署。先修仓库，别修部署目录。");
	process.exit(1);
}

const files = [
	...readdirSync(join(REPO_ROOT, "lib")).filter((n) => n.endsWith(".js")).map((n) => ["lib", n]),
	["", "package.json"]
];

if (dryRun) {
	console.log(`\n[dry-run] 会覆盖 ${files.length} 个文件到 ${DEPLOYED_ROOT}`);
	for (const [dir, name] of files) console.log(`  ${dir ? `${dir}/` : ""}${name}`);
	process.exit(0);
}

const backupDir = join(BACKUP_ROOT, `deploy-${stamp()}`);
mkdirSync(backupDir, { recursive: true });
mkdirSync(join(backupDir, "lib"), { recursive: true });
for (const [dir, name] of files) {
	const from = join(DEPLOYED_ROOT, dir, name);
	if (existsSync(from)) copyFileSync(from, join(backupDir, dir, name));
}
console.log(`② 已备份部署副本 → ${backupDir}`);

for (const [dir, name] of files) {
	copyFileSync(join(REPO_ROOT, dir, name), join(DEPLOYED_ROOT, dir, name));
}
console.log(`③ 已复制 ${files.length} 个文件`);

console.log("④ 复检部署副本");
if (!runCheck(DEPLOYED_ROOT, "deployed")) {
	for (const [dir, name] of files) {
		const backup = join(backupDir, dir, name);
		if (existsSync(backup)) copyFileSync(backup, join(DEPLOYED_ROOT, dir, name));
	}
	console.error(`\n部署后体检失败，已回滚到部署前状态（备份在 ${backupDir}）。`);
	process.exit(1);
}

console.log("\n部署完成。现在重启 DeepSeek Harness —— 热重载不可靠，别省这一步。");
