#!/usr/bin/env node
/**
 * Would the packed tarball actually load?
 *
 * `lib/index.js` imports some files at load time. If any of them is missing from
 * the published tarball, the user gets `ERR_MODULE_NOT_FOUND` on the next
 * restart - and the card does not render either, so the plugin's own UI is gone
 * by the time anyone notices. `TRACKED_FILES` covers the *update* path; this
 * covers the *publish* path, which is one step earlier and the only place a
 * release can still be stopped.
 *
 * Why this exists instead of reusing `tools/check-publish.mjs`:
 *   that script resolves the plugin from a hard-coded local profile path
 *   (`~/.dsh/profiles/desktop/node_modules/dsh-rotakit`) and builds an isolated
 *   loader probe. Both are meaningful on a developer machine and meaningless on a
 *   CI runner, which has no profile and no installed copy. This check reads only
 *   the repository, so it runs in both places.
 *
 * Exit codes follow AGENTS.md §六:
 *   0    pass
 *   1    a real finding (a shipped file is missing)
 *   100  infrastructure fault (cannot read the sources at all)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const fail = (message) => {
	console.error(`FAIL  ${message}`);
	process.exitCode = 1;
};
const info = (message) => console.log(`ok    ${message}`);

/* ---- 0. the sources we need are readable at all ---- */
const pkgPath = join(REPO, "package.json");
const entryPath = join(REPO, "lib/index.js");
if (!existsSync(pkgPath) || !existsSync(entryPath)) {
	console.error(`cannot read ${pkgPath} or ${entryPath} - is this the plugin repository?`);
	process.exit(100);
}

let pkg;
try {
	pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch (error) {
	console.error(`package.json is not valid JSON: ${error.message}`);
	process.exit(100);
}

const files = Array.isArray(pkg.files) ? pkg.files : [];
if (files.length === 0) {
	console.error("package.json has no `files` whitelist - what would npm pack?");
	process.exit(100);
}

/* ---- 1. every static import in lib/index.js must be inside the pack ---- */
const entry = readFileSync(entryPath, "utf8");

/**
 * The load-time imports, and only those.
 *
 * A dynamic `import()` inside a function body is deliberately excluded: it is
 * reached only when that feature is used, and the optional `qrcode` import is
 * exactly that shape. Flagging it here would make the check disagree with the
 * design it is supposed to protect.
 */
const staticImports = [];
for (const match of entry.matchAll(/^import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gmu)) {
	staticImports.push(match[1]);
}
/* `export ... from "./x.js"` is also load-time. */
for (const match of entry.matchAll(/^export\s+[^'"]*?\sfrom\s+["']([^"']+)["']/gmu)) {
	staticImports.push(match[1]);
}

const relative = [...new Set(staticImports)].filter((spec) => spec.startsWith("."));
info(`lib/index.js has ${relative.length} relative load-time import(s)`);

if (relative.length === 0) {
	/* A pattern that matches nothing would pass silently forever. */
	console.error("found zero relative imports - the extractor is broken, not the package");
	process.exit(100);
}

/**
 * Is this repo-relative path inside the published whitelist?
 *
 * `package.json` is always included by npm regardless of `files[]` - verified
 * with `npm pack --dry-run`, where it appears in the tarball without being
 * listed. Node's loader and npm's packer both special-case it, so treating it as
 * uncovered would report a problem that does not exist. `README`, `LICENSE` and
 * the main entry are similarly always packed; of those, only `package.json` is in
 * TRACKED_FILES today, but the allowance is written for the rule rather than for
 * today's list.
 */
const ALWAYS_PACKED = new Set(["package.json", "README.md", "LICENSE", "LICENCE"]);

const covered = (relPath) => {
	const normalised = relPath.replace(/\\/gu, "/").replace(/^\.\//u, "");
	if (ALWAYS_PACKED.has(normalised)) return true;
	return files.some((entryName) => {
		const prefix = entryName.replace(/\/$/u, "");
		return normalised === prefix || normalised.startsWith(`${prefix}/`);
	});
};

const leaked = [];
for (const spec of relative) {
	const target = spec.replace(/^\.\//u, "");
	if (!existsSync(join(REPO, "lib", target))) {
		fail(`lib/index.js imports "${spec}" but lib/${target} does not exist`);
		continue;
	}
	if (!covered(`lib/${target}`)) leaked.push(spec);
}
for (const spec of leaked) {
	fail(`lib/index.js imports "${spec}" but it is NOT in package.json files[] - it would not ship`);
}
if (leaked.length === 0) info("every relative load-time import is inside the published whitelist");

/* ---- 2. the update path's TRACKED_FILES must also ship ---- */
const trackedMatch = /const TRACKED_FILES\s*=\s*\[([^\]]*)\]/u.exec(entry);
if (trackedMatch === null) {
	fail("could not find TRACKED_FILES in lib/index.js");
} else {
	const tracked = [...trackedMatch[1].matchAll(/["']([^"']+)["']/gu)].map((m) => m[1]);
	const missing = tracked.filter((name) => !existsSync(join(REPO, name)));
	for (const name of missing) fail(`TRACKED_FILES lists ${name}, which is not in the repository`);
	const untracked = tracked.filter((name) => !covered(name));
	for (const name of untracked) fail(`TRACKED_FILES lists ${name}, but it is not in files[] - updates would fetch a path that never shipped`);
	if (missing.length === 0 && untracked.length === 0) {
		info(`TRACKED_FILES (${tracked.length} entries) all exist and all ship`);
	}
}

/* ---- 3. the declared bin entry must ship ---- */
if (pkg.bin !== undefined) {
	for (const [, target] of Object.entries(pkg.bin)) {
		if (!existsSync(join(REPO, target))) fail(`bin points at ${target}, which does not exist`);
		else if (!covered(target)) fail(`bin points at ${target}, which is not in files[]`);
		else info(`bin ${target} exists and ships`);
	}
}

/* ---- 4. the patch file the host loads must ship ---- */
const patch = pkg.dsh?.bundle?.patch;
if (typeof patch === "string") {
	if (!existsSync(join(REPO, patch))) fail(`dsh.bundle.patch names ${patch}, which does not exist`);
	else if (!covered(patch)) fail(`dsh.bundle.patch names ${patch}, which is not in files[]`);
	else info(`patch ${patch} exists and ships`);
}

if (process.exitCode === 1) {
	console.error("\nthe packed tarball would not be loadable - fix the above before tagging");
} else {
	console.log("\nall shipped entry points are present and whitelisted");
}
