/**
 * RotaKit Pro · 多 Key 治理 / 请求审计 / 状态推送 / 账号标签
 *
 * 本模块是 2.4.0 新增的独立后端单元，**不修改**原有 16 条路由的任何语义：
 * 它只做加法，并且所有新增能力都可以在没有它的情况下被忽略
 * （index.js 里每一处引用都写了 `?.` 保护）。
 *
 * ── 为什么单独一个文件而不是塞进 index.js ──
 *
 * index.js 是 582 KB 的单文件产物，没有构建链。往里插 700 行意味着
 * 任何一次手改都要在 16000 行里定位插入点；出错的代价是插件整个起不来
 * （见 HANDOVER §8.4：一条未绑定标识符打崩整张卡片）。
 * 独立模块让新增部分可以被 `node --check` 单独验证，也让 index.js 的
 * 改动收敛到「三处 import + 三处调用」。
 *
 * ── 数据落在哪 ──
 *
 *   ~/.dsh/.workbuddy-xdpool/api-keys.json          密钥（只存 sha256）
 *   ~/.dsh/.workbuddy-xdpool/account-labels.json    账号显示名覆盖
 *   ~/.dsh/.workbuddy-xdpool/audit-YYYY-MM-DD.jsonl 访问审计（按天）
 *
 * 三个文件都**不含**任何 OAuth 凭据。密钥文件里没有明文 key，
 * 只有 sha256 与可显示的前缀。
 *
 * @module dsh-rotakit/pro
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 新增路由。全部挂在 `/plugins/dsh-rotakit/` 下，与既有路由同前缀。 */
export const PRO_PATHS = {
	keys: "/plugins/dsh-rotakit/api-keys",
	keysCreate: "/plugins/dsh-rotakit/api-keys/create",
	keysUpdate: "/plugins/dsh-rotakit/api-keys/update",
	keysDelete: "/plugins/dsh-rotakit/api-keys/delete",
	keysRotate: "/plugins/dsh-rotakit/api-keys/rotate",
	audit: "/plugins/dsh-rotakit/audit",
	/** 按天 × Key × 接口的汇总（账单口径）。 */
	auditSummary: "/plugins/dsh-rotakit/audit/summary",
	stream: "/plugins/dsh-rotakit/status-stream",
	settings: "/plugins/dsh-rotakit/settings",
	rewardsAll: "/plugins/dsh-rotakit/rewards/claim-all",
	accountRename: "/plugins/dsh-rotakit/accounts/rename",
};

/** 数据目录。与 shimSecret() 用同一处，避免出现两个 .workbuddy-xdpool。 */
function dataDir() {
	return join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool");
}

function ensureDir(dir) {
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		/* 只读安装目录不是致命错误：写失败会被下面的 try 吞掉并降级为内存态 */
	}
}

/** 原子写：先写临时文件再 rename，避免崩溃留下半个 JSON。 */
function writeJsonAtomic(file, value) {
	const temp = `${file}.${String(process.pid)}.tmp`;
	writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 384 });
	renameSync(temp, file);
}

function readJson(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
}

/** 本地自然日的键，用于配额重置与审计分文件。 */
export function dayKeyOf(date) {
	const d = date ?? new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** sha256 十六进制。密钥只以这个形式落盘。 */
function hashKey(plain) {
	return createHash("sha256").update(plain, "utf8").digest("hex");
}

/** 常量时间比较两个 hex 摘要，避免按字节泄露前缀匹配长度。 */
function hashEquals(a, b) {
	if (typeof a !== "string" || typeof b !== "string") return false;
	const x = Buffer.from(a, "utf8");
	const y = Buffer.from(b, "utf8");
	if (x.length !== y.length) return false;
	return timingSafeEqual(x, y);
}

/** 生成一把新密钥：`rk-` + 32 字节 base64url。只在创建/轮换时返回一次。 */
function mintKey() {
	return `rk-${randomBytes(32).toString("base64url")}`;
}

/** 可显示前缀。够用户在列表里区分两把 key，又不足以还原。 */
function keyPrefix(plain) {
	return `${plain.slice(0, 11)}…`;
}

/** 空 IP / 模型白名单表示「不限」，这是与 enabledModelIds 一致的语义。 */
function listAllows(list, value) {
	if (!Array.isArray(list) || list.length === 0) return true;
	if (typeof value !== "string" || value === "") return true;
	return list.some((entry) => {
		if (typeof entry !== "string" || entry === "") return false;
		if (entry === value) return true;
		// 允许 `192.168.1.*` 这种前缀通配，只对 IP 有意义
		if (entry.endsWith("*")) return value.startsWith(entry.slice(0, -1));
		return false;
	});
}

/**
 * 构造 Pro 运行时。
 *
 * 一个实例被两个 shim 与全部路由共享 —— 密钥、配额、审计都是全局的，
 * 按区域分裂会让同一把 key 在 cn/global 上有两份配额。
 *
 * @param {object} options { logger }
 */
export function createProRuntime(options = {}) {
	const logger = options.logger;
	const dir = dataDir();
	ensureDir(dir);

	const KEYS_FILE = join(dir, "api-keys.json");
	const LABELS_FILE = join(dir, "account-labels.json");

	/** 内存态。磁盘是真相，这里只是缓存；写盘失败时仍然可用（重启即丢）。 */
	let store = readJson(KEYS_FILE, { version: 1, config: {}, keys: [] });
	if (typeof store !== "object" || store === null) store = { version: 1, config: {}, keys: [] };
	if (!Array.isArray(store.keys)) store.keys = [];
	if (typeof store.config !== "object" || store.config === null) store.config = {};
	if (store.config.auditRetentionDays === undefined) store.config.auditRetentionDays = 14;
	if (store.config.allowLan === undefined) store.config.allowLan = false;

	let labels = readJson(LABELS_FILE, {});
	if (typeof labels !== "object" || labels === null) labels = {};

	const persist = () => {
		try {
			writeJsonAtomic(KEYS_FILE, store);
		} catch (error) {
			logger?.warn?.(`dsh-rotakit: api-keys.json 写入失败，改动只存在于内存：${String(error?.message ?? error)}`);
		}
	};

	/** 把一天之前的用量归零。调用点：每次鉴权前。 */
	const rollDay = (key) => {
		const today = dayKeyOf();
		if (key.usage?.day !== today) {
			key.usage = { day: today, requests: 0, credits: 0 };
			return true;
		}
		return false;
	};

	// ───────────────────────────────────────────────────────────
	// 密钥：读 / 建 / 改 / 删 / 轮换
	// ───────────────────────────────────────────────────────────

	/** 对外的密钥视图。**绝不**包含 hash。 */
	const publicKey = (key) => ({
		id: key.id,
		name: key.name,
		prefix: key.prefix,
		enabled: key.enabled !== false,
		createdAt: key.createdAt,
		lastUsedAt: key.lastUsedAt,
		quota: {
			requestsPerDay: Number(key.quota?.requestsPerDay ?? 0),
			creditsPerDay: Number(key.quota?.creditsPerDay ?? 0),
		},
		models: Array.isArray(key.models) ? [...key.models] : [],
		ips: Array.isArray(key.ips) ? [...key.ips] : [],
		usage: {
			day: key.usage?.day ?? dayKeyOf(),
			requests: Number(key.usage?.requests ?? 0),
			credits: Number(key.usage?.credits ?? 0),
		},
	});

	const listKeys = () => ({
		config: { ...store.config },
		keys: store.keys.map(publicKey),
	});

	/**
	 * 建一把 key。
	 *
	 * 返回明文**仅此一次**：磁盘上只有 sha256，之后任何接口都取不回来。
	 * 这是「密钥泄露后无法自证」与「用户可以随时查看自己的 key」之间的取舍，
	 * 选前者，因为后者意味着明文长期躺在磁盘上。
	 */
	const createKey = (input = {}) => {
		const name = typeof input.name === "string" && input.name.trim() !== "" ? input.name.trim().slice(0, 60) : `Key ${String(store.keys.length + 1)}`;
		const plain = mintKey();
		const key = {
			id: `k_${randomBytes(6).toString("hex")}`,
			name,
			hash: hashKey(plain),
			prefix: keyPrefix(plain),
			enabled: true,
			createdAt: new Date().toISOString(),
			lastUsedAt: undefined,
			quota: {
				requestsPerDay: Math.max(0, Number(input.requestsPerDay ?? 0) || 0),
				creditsPerDay: Math.max(0, Number(input.creditsPerDay ?? 0) || 0),
			},
			models: Array.isArray(input.models) ? input.models.filter((m) => typeof m === "string" && m !== "").slice(0, 200) : [],
			ips: Array.isArray(input.ips) ? input.ips.filter((m) => typeof m === "string" && m !== "").slice(0, 100) : [],
			usage: { day: dayKeyOf(), requests: 0, credits: 0 },
		};
		store.keys.push(key);
		persist();
		return { key: publicKey(key), plain };
	};

	const updateKey = (id, patch = {}) => {
		const key = store.keys.find((item) => item.id === id);
		if (key === undefined) return undefined;
		if (typeof patch.name === "string" && patch.name.trim() !== "") key.name = patch.name.trim().slice(0, 60);
		if (typeof patch.enabled === "boolean") key.enabled = patch.enabled;
		if (patch.quota !== undefined && patch.quota !== null) {
			key.quota = {
				requestsPerDay: Math.max(0, Number(patch.quota.requestsPerDay ?? key.quota.requestsPerDay) || 0),
				creditsPerDay: Math.max(0, Number(patch.quota.creditsPerDay ?? key.quota.creditsPerDay) || 0),
			};
		}
		if (Array.isArray(patch.models)) key.models = patch.models.filter((m) => typeof m === "string" && m !== "").slice(0, 200);
		if (Array.isArray(patch.ips)) key.ips = patch.ips.filter((m) => typeof m === "string" && m !== "").slice(0, 100);
		persist();
		return publicKey(key);
	};

	const deleteKey = (id) => {
		const before = store.keys.length;
		store.keys = store.keys.filter((item) => item.id !== id);
		if (store.keys.length === before) return false;
		persist();
		return true;
	};

	/** 轮换：新明文、同一个 id 与名称，配额与白名单保留，用量归零。 */
	const rotateKey = (id) => {
		const key = store.keys.find((item) => item.id === id);
		if (key === undefined) return undefined;
		const plain = mintKey();
		key.hash = hashKey(plain);
		key.prefix = keyPrefix(plain);
		key.usage = { day: dayKeyOf(), requests: 0, credits: 0 };
		persist();
		return { key: publicKey(key), plain };
	};

	const setConfig = (patch = {}) => {
		if (typeof patch.allowLan === "boolean") store.config.allowLan = patch.allowLan;
		if (patch.auditRetentionDays !== undefined) {
			store.config.auditRetentionDays = Math.min(180, Math.max(1, Number(patch.auditRetentionDays) || 14));
		}
		persist();
		return { ...store.config };
	};

	// ───────────────────────────────────────────────────────────
	// 鉴权
	// ───────────────────────────────────────────────────────────

	const enabledKeys = () => store.keys.filter((key) => key.enabled !== false);

	/** 是否配置了任何启用中的托管 key。没有时只有 master secret 能用。 */
	const hasManagedKeys = () => enabledKeys().length > 0;

	/**
	 * 把请求方地址归一成可比较的形式。
	 *
	 * `::ffff:127.0.0.1` 与 `127.0.0.1` 是同一个地址的两种拼写，
	 * 不归一的话白名单会莫名其妙地不生效（Windows 上默认就是 v6 映射）。
	 */
	const clientIp = (req) => {
		const raw = req.socket?.remoteAddress ?? "";
		return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
	};

	/**
	 * 鉴权。
	 *
	 * @param {object} req      Node 请求
	 * @param {string} presented 已从 Authorization / x-api-key 取出的令牌
	 * @param {boolean} masterOk 调用方用既有 SHARED_SECRET 比对的结果
	 * @returns {{ok:true, principal:object} | {ok:false, status:number, code:string, message:string}}
	 */
	const authorize = (req, presented, masterOk) => {
		if (masterOk === true) {
			return { ok: true, principal: { kind: "master", id: "master", name: "宿主密钥" } };
		}
		if (typeof presented !== "string" || presented === "") {
			return { ok: false, status: 401, code: "unauthorized", message: "missing or invalid Authorization bearer" };
		}
		const digest = hashKey(presented);
		const key = store.keys.find((item) => hashEquals(item.hash, digest));
		if (key === undefined) {
			return { ok: false, status: 401, code: "unauthorized", message: "missing or invalid Authorization bearer" };
		}
		if (key.enabled === false) {
			return { ok: false, status: 403, code: "key_disabled", message: `api key "${key.name}" is disabled` };
		}
		const ip = clientIp(req);
		if (!listAllows(key.ips, ip)) {
			return { ok: false, status: 403, code: "ip_not_allowed", message: `api key "${key.name}" is not allowed from ${ip}` };
		}
		if (rollDay(key)) persist();
		const limit = Number(key.quota?.requestsPerDay ?? 0);
		if (limit > 0 && Number(key.usage?.requests ?? 0) >= limit) {
			return {
				ok: false,
				status: 429,
				code: "key_quota_exceeded",
				message: `api key "${key.name}" reached its daily limit of ${String(limit)} requests`,
			};
		}
		key.lastUsedAt = new Date().toISOString();
		return {
			ok: true,
			principal: {
				kind: "key",
				id: key.id,
				name: key.name,
				models: Array.isArray(key.models) ? key.models : [],
				requestsPerDay: limit,
			},
		};
	};

	/** 记账：一次成功的请求。`persist` 由调用方节流，见 `flush`。 */
	let dirty = false;
	const noteRequest = (principal, credits) => {
		if (principal?.kind !== "key") return;
		const key = store.keys.find((item) => item.id === principal.id);
		if (key === undefined) return;
		rollDay(key);
		key.usage.requests = Number(key.usage.requests ?? 0) + 1;
		if (Number.isFinite(credits) && credits > 0) key.usage.credits = Number(key.usage.credits ?? 0) + credits;
		dirty = true;
	};
	/** 节流落盘：每 10 秒最多写一次，避免每个请求一次 fsync。 */
	const flush = () => {
		if (!dirty) return;
		dirty = false;
		persist();
	};

	/** 模型白名单。空数组 = 不限。 */
	const modelAllowed = (principal, model) => {
		if (principal?.kind !== "key") return true;
		const allow = Array.isArray(principal.models) ? principal.models : [];
		if (allow.length === 0) return true;
		if (typeof model !== "string" || model === "") return true;
		return allow.includes(model);
	};

	// ───────────────────────────────────────────────────────────
	// 账号显示名
	// ───────────────────────────────────────────────────────────

	const labelFor = (accountId) => {
		const value = labels[accountId];
		return typeof value === "string" && value !== "" ? value : undefined;
	};

	const setLabel = (accountId, label) => {
		if (typeof accountId !== "string" || accountId === "") return false;
		const text = typeof label === "string" ? label.trim().slice(0, 40) : "";
		if (text === "") delete labels[accountId];
		else labels[accountId] = text;
		try {
			writeJsonAtomic(LABELS_FILE, labels);
		} catch (error) {
			logger?.warn?.(`dsh-rotakit: account-labels.json 写入失败：${String(error?.message ?? error)}`);
		}
		return true;
	};

	// ───────────────────────────────────────────────────────────
	// 审计
	// ───────────────────────────────────────────────────────────

	const auditFile = (day) => join(dir, `audit-${day}.jsonl`);

	/**
	 * 写一条审计。
	 *
	 * 同步追加，因为 HTTP 响应结束时没有可靠的异步时机（进程可能在下一个
	 * tick 前被关闭）。单行小于 300 字节，代价可以忽略。
	 * 任何失败都吞掉：审计不该让请求失败。
	 */
	const audit = (entry) => {
		try {
			const day = dayKeyOf();
			writeFileSync(auditFile(day), `${JSON.stringify({ ts: new Date().toISOString(), day, ...entry })}\n`, { encoding: "utf8", flag: "a" });
		} catch {
			/* 磁盘满 / 只读：静默降级 */
		}
	};

	/** 可用审计日期，新到旧。 */
	const auditDays = () => {
		try {
			return readdirSync(dir)
				.map((name) => /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/u.exec(name)?.[1])
				.filter((day) => typeof day === "string")
				.sort()
				.reverse();
		} catch {
			return [];
		}
	};

	/**
	 * 查询审计。
	 *
	 * 只读最近 `days` 天，且总量上限 2000 条 —— 这个接口给面板用，
	 * 面板一次渲染不了更多，而读全量会把一个 UI 轮询变成磁盘风暴。
	 */
	const queryAudit = (filter = {}) => {
		const limit = Math.min(2000, Math.max(1, Number(filter.limit ?? 500) || 500));
		const wantDays = Math.min(60, Math.max(1, Number(filter.days ?? 7) || 7));
		const days = auditDays().slice(0, wantDays);
		const rows = [];
		for (const day of days) {
			let text = "";
			try {
				text = readFileSync(auditFile(day), "utf8");
			} catch {
				continue;
			}
			for (const line of text.split("\n")) {
				if (line.trim() === "") continue;
				let row;
				try {
					row = JSON.parse(line);
				} catch {
					continue;
				}
				if (typeof filter.keyId === "string" && filter.keyId !== "" && row.keyId !== filter.keyId) continue;
				if (typeof filter.status === "string" && filter.status !== "" && String(row.status) !== filter.status) continue;
				if (typeof filter.path === "string" && filter.path !== "" && !String(row.path ?? "").includes(filter.path)) continue;
				rows.push(row);
			}
		}
		rows.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
		return { total: rows.length, days, rows: rows.slice(0, limit) };
	};

	/** CSV 导出。字段固定，便于用表格软件直接打开。 */
	const auditCsv = (filter = {}) => {
		const { rows } = queryAudit({ ...filter, limit: 2000 });
		const head = ["ts", "keyId", "keyName", "ip", "method", "path", "status", "ms"];
		const escape = (value) => {
			const text = value === undefined || value === null ? "" : String(value);
			return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
		};
		const lines = [head.join(",")];
		for (const row of rows) lines.push(head.map((name) => escape(row[name])).join(","));
		return lines.join("\n");
	};

	/**
	 * 按天 × Key × 接口汇总。
	 *
	 * 目标不是替代原始审计，而是回答一个原始行回答不了的问题：**谁把量用掉了**。
	 * 逐行导出再透视在几千条时就已经没人做了，而这里一行就是一天的用量。
	 *
	 * 口径刻意与 `queryAudit` 完全一致（同一批审计文件、同一套过滤、同样的 2000 条上限），
	 * 否则面板上的两张表会互相对不上，而「对不上」本身就是用户最不能接受的那种 bug。
	 */
	const summariseAudit = (filter = {}) => {
		const { rows, days } = queryAudit({ ...filter, limit: 2000 });
		const buckets = new Map();
		for (const row of rows) {
			const day = String(row.ts ?? "").slice(0, 10);
			const keyName = row.keyName ?? row.keyId ?? "-";
			const path = row.path ?? "-";
			const bucketKey = `${day}|${keyName}|${path}`;
			const bucket = buckets.get(bucketKey) ?? { day, keyName, path, requests: 0, errors: 0, ms: 0, msMax: 0 };
			bucket.requests += 1;
			if (Number(row.status ?? 0) >= 400) bucket.errors += 1;
			const ms = Number(row.ms ?? 0);
			if (Number.isFinite(ms)) {
				bucket.ms += ms;
				if (ms > bucket.msMax) bucket.msMax = ms;
			}
			buckets.set(bucketKey, bucket);
		}
		const summary = [...buckets.values()]
			.map((row) => ({ ...row, avgMs: row.requests === 0 ? 0 : Math.round(row.ms / row.requests) }))
			.sort((left, right) => (left.day === right.day ? right.requests - left.requests : left.day < right.day ? 1 : -1));
		return { days, total: rows.length, summary };
	};

	/** 汇总 CSV。列固定，便于直接在表格软件里做透视。 */
	const summaryCsv = (filter = {}) => {
		const { summary } = summariseAudit(filter);
		const head = ["day", "keyName", "path", "requests", "errors", "avgMs", "maxMs"];
		const escape = (value) => {
			const text = value === undefined || value === null ? "" : String(value);
			return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
		};
		const lines = [head.join(",")];
		for (const row of summary) lines.push(head.map((name) => escape(row[name])).join(","));
		return lines.join("\n");
	};

	/** 清理过期审计。启动时跑一次。 */
	const pruneAudit = () => {
		const keep = Number(store.config.auditRetentionDays ?? 14);
		const days = auditDays();
		for (const day of days.slice(keep)) {
			try {
				unlinkSync(auditFile(day));
			} catch {
				/* 忽略 */
			}
		}
	};
	pruneAudit();

	return {
		dir,
		// 密钥
		listKeys,
		createKey,
		updateKey,
		deleteKey,
		rotateKey,
		setConfig,
		hasManagedKeys,
		// 鉴权与配额
		authorize,
		noteRequest,
		flush,
		modelAllowed,
		clientIp,
		// 账号标签
		labelFor,
		setLabel,
		// 审计
		audit,
		queryAudit,
		summariseAudit,
		summaryCsv,
		auditCsv,
		auditDays,
	};
}

/**
 * 注册 Pro 路由。
 *
 * 全部沿用既有安全模型：读接口只校验回环来源，写接口额外要求
 * `writeAllowed`（POST + JSON content-type + 回环 Origin），
 * 见 index.js 的 `writeAllowed` 注释。
 *
 * @param {object} args { ctx, pro, deps, json, loopbackOrigin, writeAllowed, readJsonBody, poolWebStatus }
 * @returns {() => void} dispose
 */
export function registerProRoutes(args) {
	const { ctx, pro, deps, json, loopbackOrigin, writeAllowed, readJsonBody, poolWebStatus } = args;
	/*
	 * 与 lib/index.js 的 POOL_REWARDS_ALL_PATH 对齐。
	 * index.js 传进来是为了让两侧各留一份**字面量**（_verify_campaign_locale.mjs
	 * 比对的就是这个），这里原样采用，不自己再拼一遍路径。
	 */
	const REWARDS_ALL = typeof args.rewardsAllPath === "string" && args.rewardsAllPath !== ""
		? args.rewardsAllPath
		: PRO_PATHS.rewardsAll;
	const disposers = [];

	const route = (path, handler) => {
		disposers.push(ctx.webServer.register({ kind: "exact", path, handler }));
	};

	/** 读接口的统一前置。 */
	const readGate = (req, res) => {
		if (!loopbackOrigin(req)) {
			json(res, 403, { error: "origin-not-trusted" });
			return false;
		}
		return true;
	};

	/** 写接口的统一前置。 */
	const writeGate = (req, res) => {
		if (req.method !== "POST") {
			json(res, 405, { error: "method not allowed" });
			return false;
		}
		if (!writeAllowed(req)) {
			json(res, 403, { error: "origin-not-trusted" });
			return false;
		}
		return true;
	};

	// ── 密钥列表 ──
	route(PRO_PATHS.keys, async (req, res) => {
		if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
		if (!readGate(req, res)) return;
		try {
			json(res, 200, { ok: true, ...pro.listKeys() });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	// ── 建 / 改 / 删 / 轮换 ──
	route(PRO_PATHS.keysCreate, async (req, res) => {
		if (!writeGate(req, res)) return;
		try {
			const body = await readJsonBody(req).catch(() => ({}));
			const created = pro.createKey(body ?? {});
			json(res, 200, { ok: true, ...created });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	route(PRO_PATHS.keysUpdate, async (req, res) => {
		if (!writeGate(req, res)) return;
		try {
			const body = await readJsonBody(req).catch(() => ({}));
			const id = typeof body?.["id"] === "string" ? body["id"] : "";
			if (id === "") return json(res, 400, { error: "id is required" });
			const updated = pro.updateKey(id, body ?? {});
			if (updated === undefined) return json(res, 404, { error: "unknown key" });
			json(res, 200, { ok: true, key: updated });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	route(PRO_PATHS.keysDelete, async (req, res) => {
		if (!writeGate(req, res)) return;
		try {
			const body = await readJsonBody(req).catch(() => ({}));
			const id = typeof body?.["id"] === "string" ? body["id"] : "";
			if (id === "") return json(res, 400, { error: "id is required" });
			if (!pro.deleteKey(id)) return json(res, 404, { error: "unknown key" });
			json(res, 200, { ok: true, id });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	route(PRO_PATHS.keysRotate, async (req, res) => {
		if (!writeGate(req, res)) return;
		try {
			const body = await readJsonBody(req).catch(() => ({}));
			const id = typeof body?.["id"] === "string" ? body["id"] : "";
			if (id === "") return json(res, 400, { error: "id is required" });
			const rotated = pro.rotateKey(id);
			if (rotated === undefined) return json(res, 404, { error: "unknown key" });
			json(res, 200, { ok: true, ...rotated });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	// ── 审计 ──
	route(PRO_PATHS.audit, async (req, res) => {
		if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
		if (!readGate(req, res)) return;
		try {
			const params = new URL(req.url ?? "/", "http://localhost").searchParams;
			const filter = {
				days: params.get("days") ?? "7",
				limit: params.get("limit") ?? "500",
				keyId: params.get("keyId") ?? "",
				status: params.get("status") ?? "",
				path: params.get("path") ?? "",
			};
			if (params.get("format") === "csv") {
				const csv = pro.auditCsv(filter);
				res.writeHead(200, {
					"content-type": "text/csv; charset=utf-8",
					"content-disposition": `attachment; filename="rotakit-audit-${dayKeyOf()}.csv"`,
					"cache-control": "no-store",
				});
				res.end(csv);
				return;
			}
			json(res, 200, { ok: true, ...pro.queryAudit(filter) });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	// ── 账单汇总 ──
	route(PRO_PATHS.auditSummary, async (req, res) => {
		if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
		if (!readGate(req, res)) return;
		try {
			const params = new URL(req.url ?? "/", "http://localhost").searchParams;
			const filter = {
				days: params.get("days") ?? "14",
				keyId: params.get("keyId") ?? "",
				path: params.get("path") ?? "",
			};
			if (params.get("format") === "csv") {
				res.writeHead(200, {
					"content-type": "text/csv; charset=utf-8",
					"content-disposition": `attachment; filename="rotakit-billing-${dayKeyOf()}.csv"`,
					"cache-control": "no-store",
				});
				res.end(pro.summaryCsv(filter));
				return;
			}
			json(res, 200, { ok: true, ...pro.summariseAudit(filter) });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	// ── 设置（只读写插件的 config，不碰凭据） ──
	route(PRO_PATHS.settings, async (req, res) => {
		if (req.method === "GET") {
			if (!readGate(req, res)) return;
			try {
				json(res, 200, { ok: true, config: deps.readSettings?.() ?? {}, pro: pro.listKeys().config });
			} catch (error) {
				json(res, 500, { error: String(error?.message ?? error) });
			}
			return;
		}
		if (!writeGate(req, res)) return;
		try {
			const body = await readJsonBody(req).catch(() => ({}));
			const patch = body?.["config"] ?? {};
			const proPatch = body?.["pro"] ?? {};
			if (Object.keys(proPatch).length > 0) pro.setConfig(proPatch);
			if (Object.keys(patch).length > 0 && deps.writeSettings !== undefined) await deps.writeSettings(patch);
			json(res, 200, { ok: true, config: deps.readSettings?.() ?? {}, pro: pro.listKeys().config });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	// ── 账号显示名 ──
	route(PRO_PATHS.accountRename, async (req, res) => {
		if (!writeGate(req, res)) return;
		try {
			const body = await readJsonBody(req).catch(() => ({}));
			const accountId = typeof body?.["accountId"] === "string" ? body["accountId"] : "";
			if (accountId === "") return json(res, 400, { error: "accountId is required" });
			const known = new Set(deps.pool.list().map((account) => account.id));
			if (!known.has(accountId)) return json(res, 404, { error: "unknown account" });
			pro.setLabel(accountId, typeof body?.["label"] === "string" ? body["label"] : "");
			json(res, 200, { ok: true, accountId, label: pro.labelFor(accountId) ?? null });
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	// ── 一键领取：遍历全池，补偿 + 新手礼包都领 ──
	route(REWARDS_ALL, async (req, res) => {
		if (!writeGate(req, res)) return;
		try {
			const accounts = deps.pool.list();
			let claimed = 0;
			let skipped = 0;
			let credit = 0;
			const failed = [];
			for (const account of accounts) {
				for (const campaign of [
					{ read: deps.client.fetchCompensationStatus, claim: deps.client.claimCompensation },
					{ read: deps.client.fetchGiftStatus, claim: deps.client.claimGift },
				]) {
					try {
						const before = await campaign.read(account.credential);
						if (before === undefined || before === null) {
							skipped += 1;
							continue;
						}
						if (before.claimed === true || before.active === false) {
							skipped += 1;
							continue;
						}
						const result = await campaign.claim(account.credential);
						claimed += 1;
						const gained = Number(result?.credit ?? result?.credits ?? 0);
						if (Number.isFinite(gained) && gained > 0) credit += gained;
					} catch (error) {
						failed.push({ accountId: account.id, label: account.label, error: String(error?.message ?? error) });
					}
				}
			}
			json(res, 200, {
				ok: true,
				claimed,
				skipped,
				credit,
				failedCount: failed.length,
				failed: failed.slice(0, 10),
				accounts: accounts.length,
			});
		} catch (error) {
			json(res, 500, { error: String(error?.message ?? error) });
		}
	});

	// ── 状态 SSE ──
	/*
	 * EventSource 不能带自定义请求头，所以这里不校验令牌 —— 与既有 `/status`
	 * 完全一致：读接口只认回环 Origin。EventSource 会带 Origin，因此这道门有效。
	 */
	const clients = new Set();
	let timer;
	const tick = async () => {
		if (clients.size === 0) return;
		for (const client of [...clients]) {
			try {
				const doc = await poolWebStatus(deps, client.region);
				const text = JSON.stringify(doc);
				/* 内容没变就不发，省掉面板的无效重绘。 */
				if (text === client.last) {
					client.res.write(`: keepalive ${String(Date.now())}\n\n`);
					continue;
				}
				client.last = text;
				client.res.write(`event: status\ndata: ${text}\n\n`);
			} catch (error) {
				client.res.write(`event: error\ndata: ${JSON.stringify({ error: String(error?.message ?? error) })}\n\n`);
			}
		}
	};
	const startTimer = () => {
		if (timer !== undefined) return;
		timer = setInterval(() => {
			void tick();
		}, 5000);
		if (typeof timer?.unref === "function") timer.unref();
	};

	route(PRO_PATHS.stream, async (req, res) => {
		if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
		if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
		if (clients.size >= 8) return json(res, 429, { error: "too many status streams" });
		const region = new URL(req.url ?? "/", "http://localhost").searchParams.get("region") === "global" ? "global" : "cn";
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		});
		res.write(`retry: 5000\n\n`);
		const client = { res, region, last: "" };
		clients.add(client);
		startTimer();
		/* 首帧立刻给，否则面板要等一个 5 秒周期才有内容。 */
		void tick();
		const close = () => {
			clients.delete(client);
			try {
				res.end();
			} catch {
				/* 已关闭 */
			}
		};
		req.on("close", close);
		req.on("error", close);
	});

	return () => {
		for (const client of clients) {
			try {
				client.res.end();
			} catch {
				/* 忽略 */
			}
		}
		clients.clear();
		if (timer !== undefined) clearInterval(timer);
		for (const dispose of disposers) {
			try {
				dispose();
			} catch {
				/* 忽略 */
			}
		}
	};
}
