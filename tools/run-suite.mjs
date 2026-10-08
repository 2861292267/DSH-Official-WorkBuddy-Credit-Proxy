#!/usr/bin/env node
/**
 * Run every suite in tools/SUITES.json and report one line each.
 *
 * Why this exists: the suites were written one incident at a time and lived in
 * the workspace root next to ~600 other one-off scripts. Running them meant
 * remembering which 17 of the 155 candidates were real. That is a losing
 * arrangement - the triage found 138 shells for 17 suites, and a list kept in
 * someone's head decays silently.
 *
 * Usage:
 *   node tools/run-suite.mjs              run all
 *   node tools/run-suite.mjs origin       run suites whose name matches a substring
 *   node tools/run-suite.mjs --list       print the manifest
 *
 * Exit status is the number of failing suites, so CI or a shell `&&` can gate on
 * it. Each suite is run in its own process: they share no state, and one crash
 * must not hide the rest.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "SUITES.json"), "utf8"));

/**
 * Where the suite files live.
 *
 * They are developed in the workspace root and are not committed - each one
 * reaches into the installed plugin, which is machine-specific. This runner
 * therefore looks in the usual places rather than assuming one layout, so it
 * works both here and from a fresh clone that has the suites beside it.
 */
const candidates = [
	process.env.ROTAKIT_SUITES,
	resolve(here, "..", ".."),
	here,
	process.cwd()
].filter(Boolean);

const locate = (file) => {
	for (const dir of candidates) {
		const p = join(dir, file);
		if (existsSync(p)) return p;
	}
	return void 0;
};

const filter = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--list")) {
	for (const s of manifest.suites) console.log(`${s.file.padEnd(32)} ${s.covers}`);
	process.exit(0);
}

const chosen = manifest.suites.filter((s) => filter.length === 0 || filter.some((f) => s.file.includes(f)));
if (chosen.length === 0) {
	console.error("no suite matched; --list shows what exists");
	process.exit(1);
}

let passed = 0, failed = 0, missing = 0;
const failures = [];
const started = Date.now();

for (const suite of chosen) {
	const path = locate(suite.file);
	if (path === void 0) {
		console.log(`  MISS ${suite.file.padEnd(28)} not found in ${candidates.join(", ")}`);
		missing += 1;
		continue;
	}
	let out = "";
	let ok = true;
	try {
		out = execFileSync(process.execPath, [path], { encoding: "utf8", timeout: 600000, stdio: ["ignore", "pipe", "ignore"] });
	} catch (error) {
		out = String(error.stdout ?? "");
		ok = false;
	}
	const m = /(\d+)\s+passed,\s*(\d+)\s+failed/.exec(out);
	if (m === null) {
		console.log(`  ???? ${suite.file.padEnd(28)} printed no verdict`);
		failed += 1;
		failures.push(`${suite.file}: no verdict`);
		continue;
	}
	passed += Number(m[1]);
	failed += 0;
	const f = Number(m[2]);
	if (f > 0) failures.push(`${suite.file}: ${f} failed`);
	console.log(`  ${f === 0 ? "ok  " : "FAIL"} ${suite.file.padEnd(28)} ${m[1].padStart(4)} passed ${String(f).padStart(3)} failed`);
	if (f > 0 || !ok) failed += 1;
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${passed} assertions passed, ${failed} suite(s) failed, ${missing} missing  (${seconds}s)`);
if (failures.length > 0) {
	console.log("\nfailures:");
	for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed);
