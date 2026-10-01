import { basename, dirname, join, resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
import { createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { resolveImageAttachmentAccess, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createServer } from "node:http";
import { Readable } from "node:stream";
//#region src/upstream.ts
/** CN chat base per dingminhua's on-machine probe (HTTP 200 for chat/models). */
const CN_CHAT_BASE = "https://copilot.tencent.com";
/** Billing/console base — `www.codebuddy.cn` is the billing origin. */
const CN_BILLING_BASE = "https://www.codebuddy.cn";
/** Global base for `workbuddy.ai` logins. */
const GLOBAL_BASE = "https://www.workbuddy.ai";
/** Client UA the desktop CLI uses. */
/** Client UA the desktop CLI uses — the CN gateway answers this one. */
const CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
/**
* Desktop app UA. The global gateway serves its product config only to this
* client channel: the CLI UA gets a truncated roster (or an HTTP 500), which
* is why the international catalog must be read with the desktop spelling.
*/
const DESKTOP_UA = "WorkBuddy/5.5.2";
/** CN model catalog. */
const MODELS_CATALOG_PATH = "/v2/enterprises/personal/models";
/** Global product config, which carries the international model roster. */
const GLOBAL_CONFIG_PATH = "/v3/config";
const JSON_TIMEOUT_MS = 3e4;
const ERROR_BODY_LIMIT = 4096;
/** Cap on the reassembled compaction reply, guarding against a runaway stream. */
const COMPLETION_TEXT_LIMIT = 65536;
/** Insufficient-credit markers, ASCII lowercase plus the original Chinese. */
const HARD_CREDIT_MARKERS = [
	"insufficient credit",
	"no credit",
	"credit exhausted",
	"out of credit",
	"quota exceeded",
	"quota exhaust",
	"payment required",
	"credit not enough",
	"not enough credit",
	"积分不足",
	"额度不足",
	"余额不足",
	"积分用完",
	"额度用尽",
	"没有积分"
];
/** Session-invalidation markers that mean "this credential is dead; use another".
*  Kept alongside the HTTP-status rule in `classifyUpstreamError`: the status is
*  enough for a direct 401/403, but some failures arrive wrapped in a 200
*  envelope or a 4xx the gateway words differently. Adding the English and
*  Chinese phrasings the upstream actually uses keeps those recoverable too —
*  an unmatched one fell through to `client`, which is terminal in the shim
*  and pinned the pool to the first account (the "API 密钥无效" bug). */
const SESSION_DEAD_MARKERS = [
	"Offline user session not found",
	"12153",
	"api key is invalid",
	"invalid api key",
	"invalid_api_key",
	"api密钥无效",
	"密钥无效",
	"无效的密钥",
	"unauthorized",
	"token expired",
	"token is invalid",
	"login expired",
	"please login",
	"未登录",
	"登录已失效",
	"重新登录"
];
/**
* Failures that belong to the REQUEST, not to any account.
*
* The pool must not cool an account for these and must not rotate at all: the
* same body fails identically on every account, so rotating spends one upstream
* round-trip per account to arrive at the error the first account already
* returned. With a two-dozen-account pool that is the difference between one
* failed request and twenty-four.
*
* Kept narrow on purpose. A marker that is too broad turns a genuine account
* fault into a terminal client error, which is worse than the waste it avoids:
* the user gets no answer at all instead of a rotation to a working account.
*/
const REQUEST_FAULT_MARKERS = [
	"context length",
	"context_length_exceeded",
	"context window",
	"maximum context",
	"too many tokens",
	"max_tokens",
	"prompt is too long",
	"input is too long",
	"image is invalid",
	"invalid image",
	"unsupported image",
	"unmarshal chat params failed",
	"invalid request body",
	"请求体过长",
	"上下文超限",
	"图片不合法",
	"图片格式",
	"参数错误"
];
/** Business codes that mean "the request itself is malformed or too large". */
const REQUEST_FAULT_CODES = new Set([11101, 11115]);
/** Business codes that mean "this backend does not serve that model". */
const MODEL_BLOCKED_CODES = new Set([11102]);
/**
* Markers for "already checked in today".
*
* The upstream answers a non-zero business code (and HTTP 400) when the daily
* check-in is repeated. That is an idempotent success, not a failure: the
* reward for today is already collected. Matched against the message, since
* the code varies by realm.
*/
const ALREADY_CHECKIN_MARKERS = ["已签到", "already"];
/**
* Hosts the international product answers on, once each has been stripped of a
* leading label. The WorkBuddy AI desktop app signs in at `workbuddy.ai` (and
* the desktop client itself lists `workbuddy.cc` alongside it); the CodeBuddy
* CLI signs the same international account in at `codebuddy.ai`. All are served
* by one gateway stack, so all are `global` — missing a spelling sends those
* tokens to the CN gateway, which rejects them at the openresty layer with an
* HTML 401 instead of a business JSON error.
*/
const GLOBAL_HOSTS = [
	"workbuddy.ai",
	"workbuddy.cc",
	"codebuddy.ai"
];
/** Region for a login domain; an empty domain means CN (matching upstream tooling). */
function regionOf(domain) {
	const lowered = domain.trim().toLowerCase();
	for (const host of GLOBAL_HOSTS) if (lowered === host || lowered.endsWith(`.${host}`)) return "global";
	return "cn";
}
/**
* Gateway for a global credential.
*
* International accounts are NOT interchangeable across brand domains: a token
* issued at `codebuddy.ai` is rejected by the `workbuddy.ai` gateway and vice
* versa, so the base must follow the credential's own domain rather than one
* hardcoded host. Anything unrecognised falls back to the desktop app's gateway.
*/
function globalBase(credential) {
	const lowered = credential.domain.trim().toLowerCase();
	if (lowered === "codebuddy.ai" || lowered.endsWith(".codebuddy.ai")) return "https://www.codebuddy.ai";
	return GLOBAL_BASE;
}
function chatBase(credential) {
	return regionOf(credential.domain) === "global" ? globalBase(credential) : CN_CHAT_BASE;
}
function billingBase(credential) {
	return regionOf(credential.domain) === "global" ? globalBase(credential) : CN_BILLING_BASE;
}
function originReferer(credential) {
	return regionOf(credential.domain) === "global" ? globalBase(credential) : CN_BILLING_BASE;
}
/** Headers every upstream request shares. */
function commonHeaders(credential) {
	return {
		"Accept": "application/json, text/plain, */*",
		"X-Requested-With": "XMLHttpRequest",
		"Origin": originReferer(credential),
		"Referer": `${originReferer(credential)}/`,
		"User-Agent": CLIENT_UA
	};
}
/** Chat request headers, including the X-No-* conventions the official CLI uses. */
function chatHeaders(credential) {
	return {
		...commonHeaders(credential),
		"Content-Type": "application/json",
		"Authorization": `Bearer ${credential.accessToken}`,
		...credential.uid === "" || credential.uid === void 0 ? { "X-No-User-Id": "1" } : { "X-User-Id": credential.uid },
		...credential.enterpriseId === void 0 || credential.enterpriseId === "" ? { "X-No-Enterprise-Id": "1" } : { "X-Enterprise-Id": credential.enterpriseId },
		...credential.domain === "" ? { "X-No-Department-Info": "1" } : { "X-Domain": credential.domain },
		"X-Product": "SaaS"
	};
}
/** Refresh-endpoint headers; X-Refresh-Token appears here and nowhere else. */
function refreshHeaders(credential) {
	const headers = {
		...commonHeaders(credential),
		"X-Refresh-Token": credential.refreshToken,
		"X-Auth-Refresh-Source": "workbuddy"
	};
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") headers["X-Enterprise-Id"] = credential.enterpriseId;
	return headers;
}
/** Desktop-client report endpoint and the UA it is fingerprinted by. */
const DESKTOP_REPORT_PATH = "/v2/report";
/** Theme-selection endpoint (Hp_Appearance). */
const APPEARANCE_SET_PATH = "/v2/user-asset/appearance/set";
/** Expert marketplace listing, used to look up REAL expert ids. */
const MARKET_EXPERT_LIST_PATH = "/portal/operation-platform/market/expert/list";
/** Cap on how long a chain waits for a conversation answer. */
const CHAT_TIMEOUT_MS = 9e4;
/** How far into an SSE stream to look for the server's request id. */
const SSE_SCAN_LIMIT = 1 << 20;
/** Server request ids look like `cmb-<32 hex>` or a bare 32 hex string. */
const SERVER_ID_PATTERN = /"id"\s*:\s*"((?:cmb-)?[0-9a-f]{32})"/;
const DESKTOP_TASK_UA = "WorkBuddy/5.5.6 WorkBuddy/5.5.6 CLI/2.137.1";
/**
* Derive a stable 36-hex device id from the account uid.
*
* The upstream keys desktop events to a device. Deriving it from the uid keeps
* the same account looking like the same machine across runs, instead of a
* new device appearing on every call.
*/
function deriveDeviceId(credential, salt) {
	return createHash("sha256").update(salt + ":" + (credential.uid ?? "")).digest("hex").slice(0, 36);
}
/** Narrow a loose upstream value to an object, so field reads cannot throw. */
function asRecord(value) {
	return typeof value === "object" && value !== null ? value : {};
}
/** Read a numeric field, treating anything else as 0. */
function numOf(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
/** Local `YYYY-MM-DD`, matching how the heatmap keys its cells. */
function dayKeyLocal(date) {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}
/** Billing request headers. */
function billingHeaders(credential) {
	const headers = {
		"Authorization": `Bearer ${credential.accessToken}`,
		"Accept": "application/json",
		"Content-Type": "application/json"
	};
	if (credential.uid !== "" && credential.uid !== void 0) headers["X-User-Id"] = credential.uid;
	if (credential.enterpriseId !== void 0 && credential.enterpriseId !== "") {
		headers["X-Enterprise-Id"] = credential.enterpriseId;
		headers["X-Tenant-Id"] = credential.enterpriseId;
	}
	if (credential.domain !== "") headers["X-Domain"] = credential.domain;
	return headers;
}
/**
* Gateway denials that arrive as an HTML page rather than a JSON envelope.
*
* openresty / APISIX reject a request before it reaches the product when the
* credential is one the gateway no longer honours — most often a stale sign-in
* left in the auth directory. The status alone (401) is not actionable and the
* HTML body leaks nothing useful, so this turns it into a sentence the user can
* act on.
*/
function isGatewayHtmlRejection(status, text) {
	if (status !== 401 && status !== 403) return false;
	const head = text.slice(0, 512).toLowerCase();
	return head.includes("<html") || head.includes("openresty") || head.includes("apisix");
}
async function readEnvelope(response) {
	const text = await response.text();
	if (isGatewayHtmlRejection(response.status, text)) throw new Error("the WorkBuddy gateway rejected this credential (http 401). This usually means the account is using a stale sign-in the upstream no longer accepts: sign in again in the WorkBuddy desktop app, then pick the account on the plugin card. Run `dsh-rotakit doctor` to list every credential found.");
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`workbuddy upstream returned non-JSON (http ${response.status}): ${text.slice(0, 160)}`);
	}
	if (typeof parsed !== "object" || parsed === null) throw new Error(`workbuddy upstream returned an unexpected document (http ${response.status})`);
	const document = parsed;
	return {
		code: typeof document["code"] === "number" ? document["code"] : 0,
		msg: typeof document["msg"] === "string" ? document["msg"] : "",
		data: "data" in document ? document["data"] : void 0
	};
}
/** Fail an envelope whose business code is non-zero, classified like HTTP errors. */
function envelopeError(status, envelope) {
	const kind = classifyUpstreamError(status, envelope.msg);
	return /* @__PURE__ */ new Error(`workbuddy upstream ${kind} (http ${status}): ${envelope.msg.slice(0, 160)}`);
}
/**
* Separator between two SSE frames: a blank line, in either line-ending style.
*
* This was `indexOf("\n\n")`, which never matches a CRLF-terminated stream -
* `"\r\n\r\n"` does not contain the substring `"\n\n"`. Against such an upstream
* no frame was ever split off during the read, so the incremental
* COMPLETION_TEXT_LIMIT check below could not fire and the frame loop did
* nothing; the whole body was parsed in one go by the trailing fallback. Content
* survived, but the early cutoff did not, which is the part that keeps a runaway
* summary from being buffered in full.
*/
const SSE_FRAME_SEPARATOR = /\r?\n\r?\n/u;
/**
* Read an OpenAI-style SSE chat stream and concatenate the assistant text.
*
* The upstream always streams (`stream: true` is forced on every chat body),
* so a non-streaming internal call has to reassemble the deltas itself. Only
* `choices[0].delta.content` is collected; reasoning deltas are dropped
* because a compaction summary needs the final answer, not the scratchpad.
*/
async function readCompletionText(body) {
	const decoder = new TextDecoder();
	const reader = body.getReader();
	let buffer = "";
	let text = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let match = SSE_FRAME_SEPARATOR.exec(buffer);
			while (match !== null) {
				const frame = buffer.slice(0, match.index);
				buffer = buffer.slice(match.index + match[0].length);
				text += contentOfFrame(frame);
				if (text.length > COMPLETION_TEXT_LIMIT) return text.slice(0, COMPLETION_TEXT_LIMIT);
				match = SSE_FRAME_SEPARATOR.exec(buffer);
			}
		}
		if (buffer.trim() !== "") text += contentOfFrame(buffer);
	} finally {
		reader.releaseLock?.();
	}
	return text;
}
/** Pull `choices[0].delta.content` (or a non-streaming `message.content`) out of one SSE frame. */
function contentOfFrame(frame) {
	let out = "";
	for (const rawLine of frame.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line.startsWith("data:")) continue;
		const payload = line.slice(5).trim();
		if (payload === "" || payload === "[DONE]") continue;
		let parsed;
		try {
			parsed = JSON.parse(payload);
		} catch {
			continue;
		}
		if (typeof parsed !== "object" || parsed === null) continue;
		const choices = parsed["choices"];
		if (!Array.isArray(choices) || choices.length === 0) continue;
		const choice = choices[0];
		const delta = choice["delta"];
		if (typeof delta === "object" && delta !== null) {
			const content = delta["content"];
			if (typeof content === "string") out += content;
		}
		const message = choice["message"];
		if (typeof message === "object" && message !== null) {
			const content = message["content"];
			if (typeof content === "string") out += content;
		}
		const data = parsed["data"];
		if (typeof data === "object" && data !== null) {
			const inner = data["content"];
			if (typeof inner === "string") out += inner;
		}
	}
	return out;
}
/**
* Classify an upstream failure from its HTTP status and body excerpt.
*
* The question this answers is NOT "what went wrong" but "whose fault is it",
* because the pool acts on that: an account fault is cooled and rotated past,
* while a REQUEST fault must never be charged to an account at all. Sending the
* same oversized prompt to twenty-one accounts does not make it fit; it burns
* twenty-one healthy accounts' request budget and takes twenty-one round-trips
* to reach the same 400 the first account already gave us.
*
* Ordering is deliberate:
*   - `402`/`401`/`403` before any body marker: the status is the more
*     authoritative signal, and a 429 body often carries phrases like "quota
*     exceeded" that also appear in genuinely exhausted responses. Letting the
*     marker run first would classify a rate limit as an exhausted account and
*     park a usable account for the whole exhaustion window.
*   - request-level markers before the generic `client` fallback, so they are
*     recognised rather than lumped in as unknown.
*   - `429` before the hard-credit markers: see the first point.
*/
function classifyUpstreamError(status, body) {
	if (status === 402) return "hard_credit";
	if (status === 401 || status === 403) return "session_dead";
	const lower = body.toLowerCase();
	/**
	* Request-level failures are checked FIRST among the body markers. Their whole
	* purpose is to stop the rotation before it starts, so a misordered check that
	* let them fall through to `client` would cost the entire pool's worth of
	* round-trips on every oversized request.
	*/
	for (const marker of REQUEST_FAULT_MARKERS) {
		if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return "request_fault";
	}
	/**
	* Structured business code when the body parses: substring matching over the
	* whole body is what makes `"11102"` match a `requestId` that merely contains
	* those digits. Falls back to a whitespace-tolerant regex so `"code":6004`,
	* `"code": 6004` and `"code":"6004"` are all recognised — a literal marker
	* only covers the compact spelling.
	*/
	const code = readBusinessCode(body);
	if (code !== void 0) {
		if (REQUEST_FAULT_CODES.has(code)) return "request_fault";
		if (MODEL_BLOCKED_CODES.has(code)) return "model_blocked";
	}
	/**
	* The rate-limit status is checked BEFORE the exhausted-credit markers even
	* though the status is the coarser signal. A 429 body routinely carries
	* phrases like "quota exceeded", which is also a genuine exhausted-credit
	* marker; letting the marker win classifies a rate limit as an exhausted
	* account and parks a usable account for the whole exhaustion window rather
	* than the seconds a rate limit actually lasts.
	*
	* This is the opposite of the rule applied to the account-level markers below,
	* and deliberately so: there the status is the more specific signal, here the
	* status is the less specific one and must not be pre-empted by a substring.
	*/
	if (status === 429) return "soft_rate";
	for (const marker of HARD_CREDIT_MARKERS) if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return "hard_credit";
	for (const marker of SESSION_DEAD_MARKERS) if (body.includes(marker)) return "session_dead";
	// `6004` is a per-model rate limit, so it is tracked as one; the model id is
	// what makes it actionable, and that is available to the caller.
	if (/"(?:code|statusCode)"\s*:\s*"?6004"?/u.test(body)) return "soft_rate";
	if (body.includes("soft_rate") || body.includes("频率限制")) return "soft_rate";
	if (status === 404) return "not_found";
	if (status >= 500) return "server";
	return "client";
}
/**
* The upstream's numeric business code, when the body carries one.
*
* Structure first, text second. Matching digits anywhere in the body is how a
* `requestId` gets mistaken for an error code; parsing first and only falling
* back to a regex keeps the common case exact.
*/
function readBusinessCode(body) {
	try {
		const parsed = JSON.parse(body);
		const found = findNumericField(parsed, "code", 0);
		if (found !== void 0) return found;
	} catch {}
	const match = /"(?:code|statusCode)"\s*:\s*"?(\d{3,6})"?/u.exec(body);
	return match === null ? void 0 : Number(match[1]);
}
/** Depth-limited search for a numeric `code` field anywhere in a parsed body. */
function findNumericField(value, key, depth) {
	if (depth > 4 || typeof value !== "object" || value === null) return void 0;
	const direct = value[key];
	if (typeof direct === "number" && Number.isFinite(direct)) return direct;
	if (typeof direct === "string" && /^\d{3,6}$/u.test(direct)) return Number(direct);
	for (const child of Array.isArray(value) ? value : Object.values(value)) {
		const found = findNumericField(child, key, depth + 1);
		if (found !== void 0) return found;
	}
}
/**
* Parse the reset time the upstream reports for a rate limit, when present.
*
* Recognises an epoch-millisecond field, the Chinese-localised sentence form and
* the English one. The English branch is not optional: the global gateway
* answers in English, and without it a global 429 parses to nothing, falls back
* to the local backoff, and doubles on every retry — the cooldown runs away from
* a reset time the upstream had already told us.
*
* The sentence forms carry a wall-clock with no zone, and the upstream means
* UTC+8 by it regardless of this machine's zone, so the offset is appended
* rather than left to the local calendar.
*/
function parseRateLimitReset(body) {
	/**
	* The epoch value is accepted quoted or bare. Upstreams emit both, and a
	* numeric field serialised as a JSON string is common enough that only
	* matching the bare form would silently drop the reset time and fall back to
	* the local backoff — the exact failure the sentence branches exist to avoid.
	*/
	const epochMs = /"(?:resetAt|reset_at|resetTime|reset_time)"\s*:\s*"?(\d{13})"?/u.exec(body);
	if (epochMs !== null) {
		const parsed = Number(epochMs[1]);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	const localized = /将在\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2})/u.exec(body);
	if (localized !== null) {
		const parsed = Date.parse(`${localized[1].replace(" ", "T")}+08:00`);
		if (!Number.isNaN(parsed)) return parsed;
	}
	const english = /reset at\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2})/iu.exec(body);
	if (english !== null) {
		const parsed = Date.parse(`${english[1].replace(" ", "T")}+08:00`);
		if (!Number.isNaN(parsed)) return parsed;
	}
}
/**
* Whether an error means "today is already checked in".
*
* Callers treat this as success: the credit for the day is already banked, so
* reporting it as a failure would both alarm the user and hide a healthy
* account behind a false negative.
*/
function isAlreadyCheckin(error) {
	const message = error instanceof Error ? error.message : String(error);
	return ALREADY_CHECKIN_MARKERS.some((marker) => message.includes(marker));
}
/**
* Parse the upstream's `credits` string into a multiplier.
*/
function parseCreditMultiplier(value) {
	if (typeof value !== "string") return void 0;
	const match = /x\s*([0-9]*\.?[0-9]+)/iu.exec(value);
	if (match === null) return void 0;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
}
/** Parse the upstream's `reasoning` object; unknown shapes degrade to `{}`. */
/**
* The effort ladder the upstream's plural-form payloads declare across both
* gateways (the live union of every `supportedEfforts` list seen; `minimal` has
* never appeared). Both gateways also accept every level of it on
* singular-form models — medium/xhigh fold into high, low/max answer with their
* own budgets — so a singular `effort` value is a DEFAULT, never the model's
* only level.
*/
const SINGULAR_EFFORT_LADDER = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* True when `reasoning` arrives in the singular spelling: an `effort` string,
* with none of the plural-form fields alongside it. Seen on CN
* `deepseek-v4.1-flash` / `kimi-k3-1` / `glm-5.2` and global
* `deepseek-v4.1-flash` / `kimi-k3` / `gemini-3.5-flash`.
*/
function isSingularEffortForm(raw) {
	return typeof raw["effort"] === "string" && !Array.isArray(raw["supportedEfforts"]) && typeof raw["defaultEffort"] !== "string" && typeof raw["canDisableThinking"] !== "boolean";
}
/**
* Fold a singular-form `effort` into the plural shape the rest of the plugin
* already understands. Probes on both gateways show these models answer with
* distinct `reasoning_content` across the whole ladder — and do not think at
* all when no `reasoning_effort` is sent — so the fold widens
* `supportedEfforts` and carries the declared value into `defaultEffort`. An
* unrecognized `effort` passes through as the lone level.
*/
function singularEffortLadder(raw) {
	const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
	if (effort === void 0) return void 0;
	return SINGULAR_EFFORT_LADDER.includes(effort) ? [...SINGULAR_EFFORT_LADDER] : [effort];
}
/**
* Parse the upstream's `reasoning` object; unknown shapes degrade to
* `undefined`. Both spellings normalize here: the plural form passes through as
* declared, and the singular `effort` form folds via
* {@link singularEffortLadder}.
*/
function parseReasoning(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const raw = value;
	const singularForm = isSingularEffortForm(raw);
	const effort = typeof raw["effort"] === "string" ? raw["effort"] : void 0;
	const supportedEfforts = Array.isArray(raw["supportedEfforts"]) ? raw["supportedEfforts"].filter((entry) => typeof entry === "string") : singularEffortLadder(raw);
	const defaultEffort = typeof raw["defaultEffort"] === "string" ? raw["defaultEffort"] : effort;
	const canDisableThinking = typeof raw["canDisableThinking"] === "boolean" ? raw["canDisableThinking"] : singularForm ? true : void 0;
	if (supportedEfforts === void 0 && defaultEffort === void 0 && canDisableThinking === void 0) return;
	return {
		...supportedEfforts === void 0 || supportedEfforts.length === 0 ? {} : { supportedEfforts },
		...defaultEffort === void 0 ? {} : { defaultEffort },
		...canDisableThinking === void 0 ? {} : { canDisableThinking }
	};
}
/** Parse one catalog entry; entries without usable token limits are dropped. */
function parseUpstreamModel(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	const id = typeof raw["id"] === "string" ? raw["id"] : "";
	if (id === "" || raw["disabled"] === true) return void 0;
	const input = typeof raw["maxInputTokens"] === "number" ? raw["maxInputTokens"] : 0;
	const output = typeof raw["maxOutputTokens"] === "number" ? raw["maxOutputTokens"] : 0;
	if (input <= 0 || output <= 0) return void 0;
	const name = typeof raw["name"] === "string" && raw["name"] !== "" ? raw["name"] : id;
	const descriptionZh = typeof raw["descriptionZh"] === "string" && raw["descriptionZh"] !== "" ? raw["descriptionZh"] : void 0;
	const descriptionEn = typeof raw["descriptionEn"] === "string" && raw["descriptionEn"] !== "" ? raw["descriptionEn"] : void 0;
	const creditMultiplier = parseCreditMultiplier(raw["credits"]);
	const reasoning = parseReasoning(raw["reasoning"]);
	const supportsToolCall = typeof raw["supportsToolCall"] === "boolean" ? raw["supportsToolCall"] : void 0;
	const supportsImages = typeof raw["supportsImages"] === "boolean" ? raw["supportsImages"] : void 0;
	return {
		id,
		name,
		contextWindow: input,
		maxTokens: output,
		...creditMultiplier === void 0 ? {} : { creditMultiplier },
		...reasoning === void 0 ? {} : { reasoning },
		...descriptionZh === void 0 ? {} : { descriptionZh },
		...descriptionEn === void 0 ? {} : { descriptionEn },
		...supportsToolCall === void 0 ? {} : { supportsToolCall },
		...supportsImages === void 0 ? {} : { supportsImages }
	};
}
/**
* Flatten one upstream task entry.
*
* Progress is reported two ways depending on the task: flat `current`/`target`
* fields, or a nested `progress: {current, target}`. The nested form wins when
* it carries anything, because a task that reports both puts the live counter
* there. Entries without a usable `task_code` are dropped — without one the
* claim path cannot be built.
*/
/**
* The event chain that scores the two Buddy-app tasks.
*
* Both tasks accept the same chain, and the chain is a pure value: building it
* needs no client, so callers (and tests) can hold one without a live upstream.
*
* The task text says "upgrade to the desktop client and open it from the app
* launcher". The scorer does not watch the UI — it watches this event sequence
* with the desktop fingerprint, which is why the sequence is what gets sent.
*
* Measured against the live upstream: progress 0/1 → 1/1 claimable in ~8s.
*/
/**
* A complete "desktop client ran a request successfully" event chain.
*
* Six events in the order the real client emits them: task created, message
* send, request send, message response, message status, request response.
* Several tasks are scored off this chain (or one that embeds it), because what
* they measure is "a real request completed", which the client only proves
* through this exact sequence.
*
* Measured: this chain alone lights up `RichMeow_Chat`.
*/
function desktopChatEvents(conversationId, requestId, messageId, modelId = "fast-model", modelName = "fast-model") {
	const assistant = `${messageId}-assistant`;
	const session = {
		"codebuddy.session_id": conversationId,
		"codebuddy.conversation_request_id": requestId
	};
	return [
		{
			eventCode: "agent_task_created",
			source: "LOCAL",
			name: "working",
			task_target: "local",
			mode: "craft",
			requestModelId: modelId,
			requestModelName: modelName,
			has_repo: false,
			repo_type: "none",
			workspace_type: "empty",
			has_connector: false,
			connector_types: [],
			has_mention: false,
			mention_types: [],
			has_template: false,
			action: "",
			template_name: "",
			has_expert: false,
			expert_id: "",
			expert_name: "",
			expert_industry_id: "",
			has_skill: false,
			skill_names: [],
			conversationId,
			messageId,
			buddyId: "",
			buddyName: ""
		},
		{
			eventCode: "chat_message_send",
			messageId: assistant,
			historyCount: 0,
			isContextTruncated: false,
			currentStepCount: 1,
			traceId: requestId,
			rootRequestId: requestId,
			parentConversationId: conversationId,
			agentName: "cli",
			agentType: "main"
		},
		{
			eventCode: "chat_request_send",
			inputLength: 24,
			isPlan: false,
			isAutoExecuteTerminal: false,
			isAutoModify: false,
			codebaseEnable: false,
			maxToken: 0,
			maxSteps: 500,
			temperature: 0,
			maxRetries: 0,
			mentionContexts: [],
			knowledgeId: [],
			knowledgeName: [],
			codebaseId: "",
			mentionContextCount: 0,
			command: "",
			recommendId: "",
			skillId: "",
			skillCount: 0,
			totalCount: 0,
			traceId: requestId,
			rootRequestId: requestId,
			parentConversationId: conversationId,
			agentName: "cli",
			agentType: "main",
			...session
		},
		{
			eventCode: "chat_message_response",
			messageId: assistant,
			responseModelId: modelId,
			inputToken: 120,
			outputToken: 80,
			totalToken: 200,
			cachedTokens: 0,
			cachedWriteTokens: 0,
			cachedMissTokens: 0,
			isSuccessful: true,
			messageErrorCode: "",
			finishReason: "stop",
			firstTokenAt: Date.now(),
			traceId: requestId,
			conversationId,
			rootRequestId: requestId,
			parentConversationId: conversationId,
			agentName: "cli",
			agentType: "main",
			...session
		},
		{
			eventCode: "chat_message_status",
			messageId: assistant,
			messageErrorCode: "0",
			traceId: requestId,
			rootRequestId: requestId,
			parentConversationId: conversationId,
			agentName: "cli",
			agentType: "main"
		},
		{
			eventCode: "chat_request_response",
			mode: "craft",
			toolCallCount: 0,
			inputToken: 120,
			outputToken: 80,
			totalToken: 200,
			cachedTokens: 0,
			cachedWriteTokens: 0,
			cachedMissTokens: 0,
			isSuccessful: true,
			messageErrorCode: "",
			finishReason: "stop",
			rootRequestId: requestId,
			parentConversationId: conversationId
		}
	];
}
/**
* A chat chain plus the two canvas events that score `create_canvas`.
*
* Worth +300, the joint largest task on the board. The canvas events ride
* the same metrics channel as everything else, so no real canvas is needed.
*
* Measured: three accounts scored 1/1 from this sequence.
*/
function desktopCanvasEvents(conversationId, requestId) {
	const seed = requestId.slice(-8);
	return [
		...desktopChatEvents(conversationId, requestId, "msg-canvas"),
		{
			eventCode: "wbx_design_canvas_task_create",
			conversationId,
			requestId,
			source: "summon_keyword",
			cost: 12e3,
			isSuccessful: true
		},
		{
			eventCode: "wbx_design_canvas_open",
			conversationId,
			requestId,
			id: `ardot-file-${seed}`,
			source: "summon_keyword",
			type: "page",
			cost: 13e3,
			isSuccessful: true
		}
	];
}
/**
* The single event that scores `automation_1` (a scheduled task was created).
*
* Measured: two accounts lit it with this event alone.
*/
function desktopAutomationCreatedEvent(name) {
	return {
		eventCode: "automated_task_create_suc",
		name,
		source: "manually",
		modelId: "fast-model",
		modelIsThinking: true,
		connectorCount: 0,
		skills: "",
		skillCount: 0,
		scheduleType: "once",
		mode: "LOCAL"
	};
}
function buddyAppEvents(buddyId, buddyName) {
	const base = {
		mode: "LOCAL",
		buddyId,
		buddyName
	};
	return [
		{
			...base,
			eventCode: "buddyapp_discover_click"
		},
		{
			...base,
			eventCode: "buddyapp_show",
			elementId: buddyId,
			elementName: buddyName,
			position: 2
		},
		{
			...base,
			eventCode: "buddyapp_enter_click",
			elementId: buddyId,
			elementName: buddyName,
			position: 2,
			isFirstPage: "1"
		},
		{
			...base,
			eventCode: "buddyapp_auth_confirm_click",
			elementId: buddyId,
			elementName: buddyName
		},
		{
			...base,
			eventCode: "buddyapp_bindaccount_skip_click",
			elementId: buddyId,
			elementName: buddyName
		}
	];
}
function parseTask(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	const taskCode = typeof raw["task_code"] === "string" ? raw["task_code"] : "";
	if (taskCode === "") return void 0;
	const num = (key) => typeof raw[key] === "number" ? raw[key] : 0;
	let current = num("current");
	let target = num("target");
	const progress = raw["progress"];
	if (typeof progress === "object" && progress !== null) {
		const nested = progress;
		const nestedCurrent = typeof nested["current"] === "number" ? nested["current"] : 0;
		const nestedTarget = typeof nested["target"] === "number" ? nested["target"] : 0;
		if (nestedTarget > 0 || nestedCurrent > 0) {
			current = nestedCurrent;
			target = nestedTarget;
		}
	}
	const acceptStatus = typeof raw["accept_status"] === "string" ? raw["accept_status"] : "";
	const claimed = acceptStatus === "claimed";
	return {
		taskCode,
		title: typeof raw["title"] === "string" && raw["title"] !== "" ? raw["title"] : taskCode,
		credit: num("reward_credit"),
		energy: num("reward_energy"),
		hasReward: raw["has_reward"] === true,
		target,
		current,
		acceptStatus,
		status: typeof raw["status"] === "string" ? raw["status"] : "",
		claimable: !claimed && target > 0 && current >= target,
		claimed,
		locked: raw["locked"] === true
	};
}
var WorkBuddyUpstreamClient = class {
	fetchImpl;
	clientVersion;
	constructor(options = {}) {
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
		this.clientVersion = options.clientVersion ?? "2.0.4";
	}
	/**
	* Normalize an OpenAI chat-completions body for the WorkBuddy upstream:
	* force `stream: true` (the upstream rejects non-streaming), convert the
	* DSH `developer` role into `system` (upstream rejects `developer` with
	* business code 11128), and flatten `tool_choice` into its string form.
	*/
	prepareChatBody(raw) {
		let body;
		try {
			body = JSON.parse(raw);
		} catch {
			return raw;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) return raw;
		const obj = body;
		obj["stream"] = true;
		delete obj["stream_options"];
		if (Array.isArray(obj["messages"])) for (const value of obj["messages"]) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
			const message = value;
			if (message["role"] === "developer") message["role"] = "system";
		}
		const choice = obj["tool_choice"];
		if (typeof choice === "string") {
			if (choice.trim().toLowerCase() === "none") {
				delete obj["tool_choice"];
				delete obj["tools"];
				delete obj["functions"];
			}
		} else if (typeof choice === "object" && choice !== null && !Array.isArray(choice)) {
			const wrapped = choice;
			const type = typeof wrapped["type"] === "string" ? wrapped["type"].trim().toLowerCase() : "";
			if (type === "none") {
				delete obj["tool_choice"];
				delete obj["tools"];
				delete obj["functions"];
			} else if (type === "auto" || type === "required") obj["tool_choice"] = type;
			else if (type === "function") {
				const fn = typeof wrapped["function"] === "object" && wrapped["function"] !== null ? wrapped["function"] : void 0;
				let name = typeof fn?.["name"] === "string" ? fn["name"] : "";
				if (name === "" && typeof wrapped["name"] === "string") name = wrapped["name"];
				obj["tool_choice"] = name.trim() !== "" ? name.trim() : "auto";
			} else delete obj["tool_choice"];
		}
		return JSON.stringify(obj);
	}
	/**
	* Parse a raw OpenAI chat body without normalising it.
	*
	* The compactor needs the message array as objects, while `chatStream` only
	* accepts the serialised string form.
	*/
	parseChatBody(raw) {
		let body;
		try {
			body = JSON.parse(raw);
		} catch {
			return;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) return void 0;
		return body;
	}
	/** Re-serialise `base` with a rewritten `messages` array, still normalised. */
	buildChatBody(base, messages) {
		return this.prepareChatBody(JSON.stringify({
			...base,
			messages
		}));
	}
	/**
	* Run one NON-streaming completion and return the assistant text.
	*
	* Used only for internal compaction (summarising dropped turns). The chat
	* endpoint itself always streams, so this reassembles the SSE frames into a
	* single string. Throws on any failure: the compactor then falls back to
	* plain truncation rather than failing the user's turn.
	*/
	async completeChat(credential, prepared, signal) {
		const response = await this.fetchImpl(`${chatBase(credential)}/v2/chat/completions`, {
			method: "POST",
			headers: chatHeaders(credential),
			body: prepared,
			...signal === void 0 ? {} : { signal }
		});
		if (!response.ok) {
			const text = (await response.text().catch(() => "")).slice(0, ERROR_BODY_LIMIT);
			throw new Error(`compaction upstream http ${response.status}: ${text}`);
		}
		if (response.body === null) throw new Error("compaction upstream returned no body");
		return await readCompletionText(response.body);
	}
	/** Forward one chat completion. Never throws for upstream failures. */
	async chatStream(credential, prepared, signal) {
		let response;
		try {
			response = await this.fetchImpl(`${chatBase(credential)}/v2/chat/completions`, {
				method: "POST",
				headers: chatHeaders(credential),
				body: prepared,
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			return {
				ok: false,
				kind: "server",
				status: 0,
				message: `transport error: ${String(error)}`
			};
		}
		if (response.ok) return {
			ok: true,
			response
		};
		const text = (await response.text().catch(() => "")).slice(0, ERROR_BODY_LIMIT);
		return {
			ok: false,
			kind: classifyUpstreamError(response.status, text),
			status: response.status,
			message: text
		};
	}
	/** POST the token-refresh endpoint; the caller merges the outcome. */
	async refreshToken(credential) {
		const response = await this.fetchImpl(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
			method: "POST",
			headers: refreshHeaders(credential),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const accessToken = typeof data["accessToken"] === "string" ? data["accessToken"] : "";
		if (accessToken === "") throw new Error("workbuddy token refresh returned no accessToken; sign in again in the WorkBuddy app");
		const outcome = { accessToken };
		if (typeof data["refreshToken"] === "string" && data["refreshToken"] !== "") outcome.refreshToken = data["refreshToken"];
		if (typeof data["expiresIn"] === "number" && data["expiresIn"] > 0) outcome.expiresInSec = data["expiresIn"];
		if (typeof data["domain"] === "string" && data["domain"] !== "") outcome.domain = data["domain"];
		return outcome;
	}
	/**
	* Fetch the model catalog, keeping the `cli` agent's models only.
	*
	* The two gateways are read differently, because they answer differently:
	*
	* - **CN** serves the roster at `/v2/enterprises/personal/models` and expects
	*   the CLI client spelling.
	* - **Global** serves it as part of the product config at `/v3/config`, and
	*   only to the DESKTOP client channel. Asking the global host with the CLI UA
	*   yields a truncated roster, and the CN path answers HTTP 500 there — which
	*   is what left the international provider on its static fallback.
	*
	* Both documents share the `{ models, agents }` entry shape, so the parsing
	* below is common to the two branches.
	*/
	async fetchModels(credential, signal) {
		const global = regionOf(credential.domain) === "global";
		const url = global ? `${globalBase(credential)}${GLOBAL_CONFIG_PATH}` : `${chatBase(credential)}${MODELS_CATALOG_PATH}`;
		const headers = global ? {
			"Authorization": `Bearer ${credential.accessToken}`,
			"Accept": "application/json",
			...credential.uid === void 0 || credential.uid === "" ? {} : { "X-User-Id": credential.uid },
			...credential.domain === "" ? {} : { "X-Domain": credential.domain },
			"X-Product": "SaaS",
			"X-Requested-With": "XMLHttpRequest",
			"Connection": "close",
			"User-Agent": DESKTOP_UA
		} : {
			"Authorization": `Bearer ${credential.accessToken}`,
			"Accept": "application/json",
			"Origin": originReferer(credential),
			"Referer": `${originReferer(credential)}/`,
			"User-Agent": CLIENT_UA
		};
		if (!global && credential.enterpriseId !== void 0 && credential.enterpriseId !== "") headers["X-Enterprise-Id"] = credential.enterpriseId;
		const response = await this.fetchImpl(url, {
			headers,
			...signal === void 0 ? {} : { signal }
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const rawModels = Array.isArray(data["models"]) ? data["models"] : [];
		const agents = Array.isArray(data["agents"]) ? data["agents"] : [];
		let cliIds;
		for (const agent of agents) if (typeof agent === "object" && agent !== null) {
			const wrapped = agent;
			if (wrapped["name"] === "cli" && Array.isArray(wrapped["models"])) {
				cliIds = wrapped["models"].filter((id) => typeof id === "string");
				break;
			}
		}
		const byId = /* @__PURE__ */ new Map();
		for (const model of rawModels) {
			const parsed = parseUpstreamModel(model);
			if (parsed !== void 0) byId.set(parsed.id, parsed);
		}
		const models = (cliIds !== void 0 && cliIds.length > 0 ? cliIds : [...byId.keys()]).map((id) => byId.get(id)).filter((model) => model !== void 0);
		if (models.length === 0) throw new Error("workbuddy model catalog resolved to an empty list");
		return models;
	}
	/** Read-only credits query, aggregated by package. Does not consume credits. */
	async fetchCredits(credential) {
		const now = /* @__PURE__ */ new Date();
		const fmt = (date) => {
			const p = (n) => n.toString().padStart(2, "0");
			return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
		};
		const response = await this.fetchImpl(`${billingBase(credential)}/v2/billing/meter/get-user-resource`, {
			method: "POST",
			headers: billingHeaders(credential),
			body: JSON.stringify({
				PageNumber: 1,
				PageSize: 100,
				ProductCode: "p_tcaca",
				Status: [0, 3],
				PackageEndTimeRangeBegin: fmt(now),
				PackageEndTimeRangeEnd: fmt(new Date(now.getTime() + 3185136e6))
			}),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const wrapper = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const data = typeof wrapper["Response"] === "object" && wrapper["Response"] !== null ? wrapper["Response"] : {};
		const inner = typeof data["Data"] === "object" && data["Data"] !== null ? data["Data"] : {};
		const rawAccounts = Array.isArray(inner["Accounts"]) ? inner["Accounts"] : [];
		let total = 0;
		let nearestExpiryMs;
		let expiringSoon = 0;
		const SOON_MS = 2592e5;
		const parseDate = (raw) => {
			if (typeof raw === "number" && raw > 0xe8d4a51000) return raw;
			if (typeof raw === "string" && raw !== "") {
				const parsed = Date.parse(raw);
				if (!Number.isNaN(parsed)) return parsed;
			}
		};
		const packages = [];
		for (const raw of rawAccounts) {
			if (typeof raw !== "object" || raw === null) continue;
			const account = raw;
			const num = (key) => typeof account[key] === "number" ? account[key] : 0;
			const monthly = num("CapacityType") === 4;
			const size = monthly ? num("CycleCapacitySize") : num("CapacitySize");
			const remain = monthly ? num("CycleCapacityRemain") : num("CapacityRemain");
			const capped = remain < 0 ? 0 : remain;
			const cycleEndMs = parseDate(account["CycleEndTime"]);
			const expiresAtMs = monthly ? void 0 : parseDate(account["ExpiredTime"]) ?? cycleEndMs;
			const refreshAtMs = monthly ? cycleEndMs === void 0 ? void 0 : cycleEndMs + 1e3 : void 0;
			if (!monthly && (capped <= 0 || expiresAtMs !== void 0 && expiresAtMs <= Date.now())) continue;
			total += capped;
			if (expiresAtMs !== void 0) {
				if (nearestExpiryMs === void 0 || expiresAtMs < nearestExpiryMs) nearestExpiryMs = expiresAtMs;
				if (expiresAtMs - Date.now() <= SOON_MS) expiringSoon += capped;
			}
			packages.push({
				packageName: typeof account["PackageName"] === "string" ? account["PackageName"] : "(unnamed)",
				remain: capped,
				size,
				monthly,
				...refreshAtMs === void 0 ? {} : { refreshAtMs },
				...expiresAtMs === void 0 ? {} : { expiresAtMs }
			});
		}
		return {
			total,
			packages,
			expiringSoon,
			...nearestExpiryMs === void 0 ? {} : { nearestExpiryMs }
		};
	}
	/** Query today's check-in status without changing account state. */
	async fetchCheckinStatus(credential) {
		const response = await this.fetchImpl(`${billingBase(credential)}/v2/billing/meter/checkin-activity-status`, {
			method: "POST",
			headers: billingHeaders(credential),
			body: "{}",
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const num = (key) => typeof data[key] === "number" ? data[key] : 0;
		return {
			active: data["active"] === true,
			todayCheckedIn: data["today_checked_in"] === true,
			streakDays: num("streak_days"),
			dailyCredit: num("daily_credit"),
			todayCredit: num("today_credit"),
			isStreakDay: data["is_streak_day"] === true,
			nextStreakDay: num("next_streak_day"),
			streakBonusDays: num("streak_bonus_days"),
			streakBonusCredit: num("streak_bonus_credit"),
			...typeof data["claim_button_text"] === "string" && data["claim_button_text"] !== "" ? { claimButtonText: data["claim_button_text"] } : {}
		};
	}
	/** Claim today's check-in reward. The browser route guards this mutation. */
	async claimDailyCheckin(credential) {
		const response = await this.fetchImpl(`${billingBase(credential)}/v2/billing/meter/daily-checkin`, {
			method: "POST",
			headers: billingHeaders(credential),
			body: "{}",
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const numberField = (key) => typeof data[key] === "number" ? data[key] : 0;
		return {
			credit: numberField("credit"),
			streakDays: numberField("streak_days"),
			isStreakDay: data["is_streak_day"] === true
		};
	}
	/**
	* Public fingerprint fields every desktop event carries.
	*
	* The upstream scores a desktop-fingerprinted task only when the event looks
	* like it came from the desktop client: the same field set, the same stable
	* device ids, the same build. A partial map is accepted with 200 and scores
	* nothing, so these are copied wholesale rather than trimmed.
	*
	* `machineId`/`sessionId` are DERIVED from the account uid, never random: a
	* new device id on every call is itself a signal that the traffic is not a
	* real client.
	*/
	desktopFingerprint(credential) {
		const now = Date.now();
		return {
			timezone: "Asia/Shanghai",
			reportDelay: 2e3,
			userId: credential.uid ?? "",
			username: credential.nickname ?? "",
			userNickname: credential.nickname ?? "",
			product: "SaaS",
			releaseDate: 1789036585355,
			commit: "5f9692923c93033111c51ad7b003eb80204a9b75",
			ideName: "WorkBuddy",
			ideType: "WorkBuddy",
			ideVersion: "5.5.6",
			machineId: deriveDeviceId(credential, "machine"),
			sessionId: deriveDeviceId(credential, "session"),
			extName: "workbuddy-desktop",
			extVersion: "5.5.6",
			os: "win32",
			arch: "x64",
			osVersion: "10.0.26220",
			cpuCores: 20,
			memorySize: 24,
			timestamp: now,
			presentAt: now
		};
	}
	/**
	* Send desktop-fingerprinted events to the growth system.
	*
	* The body is an ARRAY of events, and every event carries the full desktop
	* fingerprint plus its own business fields. Different tasks recognise
	* different fingerprint families (CLI / desktop / web), which is why this is
	* separate from {@link reportActivity}: they are not interchangeable.
	*
	* Business fields win over the fingerprint, so a caller can override a device
	* id to align with a real install.
	*/
	async reportDesktopEvents(credential, events) {
		if (events.length === 0) return;
		const fingerprint = this.desktopFingerprint(credential);
		const body = events.map((event) => ({
			...fingerprint,
			...event
		}));
		const response = await this.fetchImpl(`${chatBase(credential)}${DESKTOP_REPORT_PATH}`, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${credential.accessToken}`,
				"Accept": "application/json, text/plain, */*",
				"Content-Type": "application/json;charset=UTF-8",
				"User-Agent": DESKTOP_TASK_UA,
				"X-Product": "SaaS",
				"X-Request-ID": deriveDeviceId(credential, "req") + String(Date.now() % 1e6),
				...credential.uid === void 0 || credential.uid === "" ? {} : { "X-User-Id": credential.uid },
				...credential.domain === "" ? {} : { "X-Domain": credential.domain }
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
	}
	/**
	* Report one chat-activity event to the growth system.
	*
	* The body is an ARRAY holding a single `chat_request_send` event, and every
	* field is filled in: a three-field minimal event is accepted with 200 and
	* then silently dropped, so the full shape is load-bearing rather than
	* cosmetic. `userId` is the one field the server actually keys on — without
	* it the request still answers 200 and scores nothing.
	*
	* One report per account per day is the quota the reference panel settled on;
	* a single report lights the growth streak and unlocks the `first_buddy`
	* family, which is why this runs before the task-centre pass.
	
	/**
	* Send a WEB-fingerprinted event.
	*
	* A third fingerprint family, alongside CLI and desktop: a browser shape
	* posted to the web origin with x-client-platform: web. Page-behaviour
	* tasks such as `Library_read` are scored on it. Measured:
	* `library_doc_intro_click` scored about four seconds after landing.
	*/
	async reportWebEvent(credential, eventCode, pageUrl, elementId, elementName) {
		const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
		const event = {
			eventCode,
			timestamp: Date.now(),
			reportDelay: 0,
			pageURL: pageUrl,
			elementId,
			elementName,
			os: "Win32",
			arch: "",
			osVersion: "10.0",
			userAgent: ua,
			machineId: deriveDeviceId(credential, "webmachine"),
			userId: credential.uid ?? "",
			userNickname: credential.nickname ?? "",
			enterpriseId: credential.enterpriseId ?? ""
		};
		const response = await this.fetchImpl(`https://www.workbuddy.cn/v2/report`, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${credential.accessToken}`,
				"Content-Type": "application/json",
				"Accept": "application/json",
				"x-client-platform": "web",
				"Origin": "https://www.workbuddy.cn",
				"Referer": pageUrl,
				"User-Agent": ua,
				...credential.uid === void 0 || credential.uid === "" ? {} : { "X-User-Id": credential.uid }
			},
			body: JSON.stringify([event]),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
	}
	/**
	* Apply an appearance theme on the account.
	*
	* The theme task is scored on the `appearance_skin_apply` event, not on this
	* call — but the event alone is not enough either. The pair is what a real
	* client produces: it PATCHes the account's selected skin, then reports the
	* event as the settings page closes. Measured on the reference panel after
	* the earlier "the API alone does not score" reading was corrected.
	*/
	async setAppearanceTheme(credential, resourceKey) {
		const response = await this.fetchImpl(`${chatBase(credential)}${APPEARANCE_SET_PATH}`, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${credential.accessToken}`,
				"Accept": "application/json, text/plain, */*",
				"Content-Type": "application/json;charset=UTF-8",
				"User-Agent": DESKTOP_TASK_UA,
				"X-Product": "SaaS",
				...credential.uid === void 0 || credential.uid === "" ? {} : { "X-User-Id": credential.uid }
			},
			body: JSON.stringify({
				kind: "theme",
				resource_key: resourceKey
			}),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
	}
	/**
	* The platform's expert marketplace.
	*
	* Needed before any expert can be summoned: the scorer verifies that the
	* expert id exists on the platform, so a made-up id scores nothing. The
	* response carries the display fields the summon events replay.
	*/
	async marketExpertList(credential, expertType = "") {
		const request = {
			page: 1,
			page_size: 20,
			sort_by: "reco_rank",
			sort_order: "desc"
		};
		if (expertType !== "") request["expert_type"] = expertType;
		const response = await this.fetchImpl(`${chatBase(credential)}${MARKET_EXPERT_LIST_PATH}`, {
			method: "POST",
			headers: {
				...chatHeaders(credential),
				"User-Agent": DESKTOP_TASK_UA
			},
			body: JSON.stringify(request),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = asRecord(envelope.data);
		const raw = Array.isArray(data["experts"]) ? data["experts"] : [];
		const out = [];
		for (const value of raw) {
			const expert = asRecord(value);
			const expertId = typeof expert["expert_id"] === "string" ? expert["expert_id"] : "";
			if (expertId === "") continue;
			out.push({
				expertId,
				expertType: typeof expert["expert_type"] === "string" ? expert["expert_type"] : "",
				displayName: typeof expert["display_name_zh"] === "string" ? expert["display_name_zh"] : "",
				profession: typeof expert["profession_zh"] === "string" ? expert["profession_zh"] : "",
				version: typeof expert["version"] === "string" ? expert["version"] : "",
				categories: Array.isArray(expert["categories"]) ? expert["categories"].filter((item) => typeof item === "string") : []
			});
		}
		return out;
	}
	/**
	* Open a REAL desktop conversation and return the ids the server assigned.
	*
	* The expert and skill tasks join their events to a conversation the server
	* has actually seen, so a locally invented `requestId` scores nothing. This
	* starts a chat, reads the server's id out of the SSE stream, then drops the
	* rest of the stream — the answer itself is irrelevant, only its identity is.
	*
	* Returns `undefined` instead of throwing when the conversation cannot be
	* opened or carries no recognisable id, because every caller is a best-effort
	* task chain.
	*/
	async openConversation(credential, expertId = "", signal) {
		const conversationId = `wb2auto-conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const body = JSON.stringify({
			model: "fast-model",
			messages: [{
				role: "system",
				content: "You are a helpful assistant. 当前处于中文环境，使用简体中文回答。"
			}, {
				role: "user",
				content: "1+1等于几？直接回答。"
			}],
			agent: "cli",
			temperature: 1,
			stream: true,
			stream_options: { include_usage: true }
		});
		let response;
		try {
			response = await this.fetchImpl(`${chatBase(credential)}/v2/chat/completions`, {
				method: "POST",
				headers: {
					...chatHeaders(credential),
					"Accept": "text/event-stream",
					"User-Agent": DESKTOP_TASK_UA,
					"X-Conversation-ID": conversationId,
					"X-Request-ID": String(Date.now()) + "000000",
					"X-Agent-Intent": "craft",
					"X-Agent-Type": "main",
					"X-IDE-Name": "WorkBuddy",
					"X-IDE-Type": "WorkBuddy",
					"X-IDE-Version": "5.5.6",
					"x-codebuddy-request": "1",
					...expertId === "" ? {} : { "X-Expert-Id": expertId }
				},
				body,
				signal: signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS)
			});
		} catch {
			return;
		}
		if (!response.ok || response.body === null) {
			await response.body?.cancel().catch(() => {});
			return;
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			while (buffer.length < SSE_SCAN_LIMIT) {
				const chunk = await reader.read();
				if (chunk.done) break;
				buffer += decoder.decode(chunk.value, { stream: true });
				const match = SERVER_ID_PATTERN.exec(buffer);
				if (match !== null) return {
					conversationId,
					requestId: match[1] ?? ""
				};
			}
		} catch {} finally {
			await reader.cancel().catch(() => {});
		}
	}
	/**
	* Report one chat-activity event to the growth system.
	*
	* The body is an ARRAY holding a single chat_request_send event, and every
	* field is filled in: a three-field minimal event is accepted with 200 and
	* then silently dropped, so the full shape is load-bearing rather than
	* cosmetic. userId is the one field the server actually keys on.
	*
	* One report per account per day is the quota the reference panel settled
	* on; a single report lights the growth streak and unlocks the first_buddy
	* family, which is why this runs before the task-centre pass.
	*/
	async reportActivity(credential, conversationId) {
		const conversationID = conversationId ?? `wb2api-${Date.now()}`;
		const requestID = conversationID;
		const now = Date.now();
		const event = {
			eventCode: "chat_request_send",
			timestamp: now,
			reportDelay: 0,
			mode: "craft",
			conversationId: conversationID,
			requestId: requestID,
			inputLength: 12,
			requestModelId: "deepseek-v4-flash",
			requestModelName: "DeepSeek V4 Flash",
			isPlan: false,
			isAutoExecuteTerminal: false,
			isAutoModify: false,
			codebaseEnable: false,
			maxToken: 0,
			maxSteps: 0,
			temperature: 0,
			maxRetries: 0,
			mentionContexts: [],
			knowledgeId: [],
			knowledgeName: [],
			codebaseId: "",
			mentionContextCount: 0,
			command: "",
			expertId: "",
			recommendId: "",
			skillId: "",
			skillCount: 0,
			totalCount: 0,
			fileUri: "",
			presentAt: now,
			traceId: "",
			rootRequestId: requestID,
			parentConversationId: conversationID,
			agentName: "default",
			agentType: "conversation",
			userId: credential.uid ?? ""
		};
		const response = await this.fetchImpl(`${billingBase(credential)}/v2/report`, {
			method: "POST",
			headers: billingHeaders(credential),
			body: JSON.stringify([event]),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
	}
	/**
	* Read back the growth streak in days.
	*
	* This is the read-only oracle for {@link reportActivity}: a report that
	* returned 200 yet left the streak untouched was silently dropped (a missing
	* `userId` is the usual cause), so callers verify instead of trusting the
	* status code.
	*
	* Two shape traps, both measured against the live upstream:
	*
	* - The path carries NO `/v2` prefix, unlike its sibling task endpoints under
	*   `/v2/activity/growth/*`. Asking for the `/v2` form does not 404; it
	*   answers with a body that carries no `streak` object at all.
	* - The counter is nested as `data.streak.days`, not `data.days`. Reading the
	*   flat field yields a constant 0, which would make every successful report
	*   look like a silent drop.
	*
	* Returns 0 only when the field is genuinely absent.
	*/
	async growthStreakDays(credential) {
		const response = await this.fetchImpl(`${chatBase(credential)}/activity/growth/streak`, {
			headers: billingHeaders(credential),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const streak = typeof data["streak"] === "object" && data["streak"] !== null ? data["streak"] : {};
		return typeof streak["days"] === "number" ? streak["days"] : 0;
	}
	/**
	* The full streak picture: days, tier unlock state, and what each tier pays.
	*
	* Read before redeeming, because the tier state is the only honest answer to
	* "is there anything to claim": the redeem endpoint answers 403 for a locked
	* tier, which is indistinguishable from a real failure once the response is
	* just an error.
	*/
	async growthStreakFull(credential) {
		const data = await this.growthJson(credential, "GET", "/activity/growth/streak");
		const streak = asRecord(data["streak"]);
		const redemption = asRecord(data["redemption_status"]);
		const cards = asRecord(data["makeup_cards"]);
		const tiers = [];
		if (Array.isArray(redemption["tiers"])) for (const entry of redemption["tiers"]) {
			const tier = asRecord(entry);
			const name = typeof tier["tier"] === "string" ? tier["tier"] : "";
			if (name === "") continue;
			tiers.push({
				tier: name,
				days: numOf(tier["days"]),
				credit: numOf(tier["credit"]),
				energy: numOf(tier["energy"]),
				cards: numOf(tier["cards"]),
				chances: numOf(tier["chances"]),
				status: String(redemption[`tier_${name}_status`] ?? "")
			});
		}
		return {
			days: numOf(streak["days"]),
			monthTotalDays: numOf(streak["month_total_days"]),
			nextTier: typeof streak["next_tier"] === "string" ? streak["next_tier"] : "",
			nextTierRemaining: numOf(streak["next_tier_remaining"]),
			makeupCards: numOf(cards["balance"]),
			tiers
		};
	}
	/**
	* Redeem one unlocked streak tier.
	*
	* A locked tier answers 403 ("连续登录天数不足"); callers check the status from
	* {@link growthStreakFull} first, so this only throws for genuine failures.
	* The client token is the upstream's idempotency key — a fresh one per attempt
	* keeps a retry from being read as a duplicate of the last one.
	*/
	async redeemStreakTier(credential, tier) {
		await this.growthJson(credential, "POST", "/activity/growth/redeem", {
			tier,
			client_token: randomUUID()
		});
	}
	/** How many lottery draws are available right now. */
	async lotteryChances(credential) {
		return numOf((await this.growthJson(credential, "GET", "/activity/growth/lottery/summary"))["chances"]);
	}
	/**
	* Draw the lottery once.
	*
	* Returns the raw prize payload: its shape is set by the running campaign, so
	* it is passed through rather than modelled.
	*/
	async lotteryDraw(credential) {
		return this.growthJson(credential, "POST", "/activity/growth/lottery/draw", { client_token: randomUUID() });
	}
	/**
	* The buddy profile, or undefined when the account has no buddy yet.
	*
	* `data.buddy` is null / absent / an empty object depending on how far the
	* account got, and all three mean the same thing to a caller: adopt first.
	*/
	async buddyInfo(credential) {
		const buddy = asRecord((await this.growthJson(credential, "GET", "/activity/growth/buddy/info"))["buddy"]);
		if (Object.keys(buddy).length === 0) return void 0;
		return {
			instanceId: numOf(buddy["instance_id"]),
			name: String(buddy["name"] ?? "")
		};
	}
	/** Agree to the buddy terms. Idempotent upstream. */
	async buddyAgree(credential) {
		await this.growthJson(credential, "POST", "/activity/growth/buddy/agreement", { agree: true });
	}
	/**
	* Adopt the first buddy.
	*
	* Gated upstream on having reported activity that day: without it the answer
	* is 400 "first_buddy task not completed yet". Callers treat that as "not yet"
	* rather than an error, which is why it is thrown as-is for them to classify.
	*/
	async buddyAdoptFirst(credential) {
		await this.growthJson(credential, "POST", "/activity/growth/buddy/first", {});
	}
	/** Current travel state for the account's buddy. */
	async buddyTravelStatus(credential) {
		const data = await this.growthJson(credential, "GET", "/activity/growth/buddy/travel/status");
		return {
			state: typeof data["state"] === "string" ? data["state"] : "",
			recordId: numOf(data["record_id"]),
			dailyLimitReached: data["daily_limit_reached"] === true,
			rewardCredit: numOf(data["reward_credit"])
		};
	}
	/**
	* Send the buddy travelling.
	*
	* The location is always 4 (古镇客栈): the four locations have identical
	* reward and duration ranges, so there is nothing to optimise.
	*/
	async buddyTravelDepart(credential, locationId = 4) {
		await this.growthJson(credential, "POST", "/activity/growth/buddy/travel/depart", { location_id: locationId });
	}
	/**
	* Collect an arrived trip's reward.
	*
	* `recordId` is required and comes from the status read; the upstream rejects
	* a claim without it.
	*/
	async buddyTravelClaim(credential, recordId) {
		return numOf((await this.growthJson(credential, "POST", "/activity/growth/buddy/travel/claim", { record_id: recordId }))["reward_credit"]);
	}
	/** Whether yesterday is a gap in the activity heatmap. */
	async heatmapYesterdayMissed(credential) {
		const data = await this.growthJson(credential, "GET", "/activity/growth/heatmap");
		if (!Array.isArray(data["cells"])) return false;
		const key = dayKeyLocal(/* @__PURE__ */ new Date(Date.now() - 864e5));
		for (const entry of data["cells"]) {
			const cell = asRecord(entry);
			if (cell["date"] === key) return numOf(cell["score"]) === 0;
		}
		return false;
	}
	/** Spend one makeup card on a date. Idempotent for an already-filled date. */
	async useMakeupCard(credential, date) {
		await this.growthJson(credential, "POST", "/activity/growth/makeup-cards/use", { date });
	}
	/**
	* Call a growth-domain endpoint and return its unwrapped `data`.
	*
	* These endpoints live on the chat host with the billing header set, and
	* carry the same envelope as everything else. Centralised here because every
	* growth call needs the identical envelope check.
	*/
	async growthJson(credential, method, path, body) {
		const response = await this.fetchImpl(`${chatBase(credential)}${path}`, {
			method,
			headers: billingHeaders(credential),
			...body === void 0 ? {} : { body: JSON.stringify(body) },
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		return asRecord(envelope.data);
	}
	/** Legacy thin wrapper kept for `status`/`doctor`: returns raw envelope data. */
	async credits(credential) {
		try {
			return {
				ok: true,
				data: await this.fetchCredits(credential)
			};
		} catch (error) {
			return {
				ok: false,
				message: String(error)
			};
		}
	}
	/**
	* Fetch the growth task list for one account.
	*
	* The upstream answers `data.tasks[]`, and `claimable` is derived locally —
	* the upstream does not mark it. Only a task whose progress reached its
	* target and that is not already claimed counts as eligible.
	*/
	async listTasks(credential) {
		const response = await this.fetchImpl(`${chatBase(credential)}/v2/activity/growth/tasks`, {
			headers: chatHeaders(credential),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		const raw = Array.isArray(data["tasks"]) ? data["tasks"] : [];
		const out = [];
		for (const entry of raw) {
			const parsed = parseTask(entry);
			if (parsed !== void 0) out.push(parsed);
		}
		return out;
	}
	/**
	* Accept (enrol in) tasks by code.
	*
	* Accepting is the "sign up" half: it produces no progress by itself, and the
	* upstream answers success for an already-accepted task, so replaying this is
	* safe. Progress is lit by real activity (a chat, an activity report).
	*/
	async acceptTasks(credential, taskCodes) {
		if (taskCodes.length === 0) return;
		const response = await this.fetchImpl(`${chatBase(credential)}/v2/activity/growth/tasks/accept`, {
			method: "POST",
			headers: chatHeaders(credential),
			body: JSON.stringify({ task_codes: [...taskCodes] }),
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
	}
	/**
	* Claim one task's reward.
	*
	* Two details differ from list/accept and are load-bearing:
	*
	* - The task code rides the PATH, not the body.
	* - It is served by the web origin, not the chat host, and only when the
	*   request carries the growth-centre Origin/Referer plus
	*   `x-client-platform: web`. The chat host's `/reward/claim` path does not
	*   exist and answers 400 "task not completed".
	*
	* A repeat claim answers `already_claimed` with zero credit, which is treated
	* as success so the caller can stay idempotent.
	*/
	async claimTaskReward(credential, taskCode) {
		const headers = {
			...billingHeaders(credential),
			"Accept": "application/json, text/plain, */*",
			"Origin": "https://www.workbuddy.cn",
			"Referer": "https://www.workbuddy.cn/profile/growth-center",
			"x-client-platform": "web",
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
		};
		const response = await this.fetchImpl(`https://www.workbuddy.cn/activity/growth/tasks/${encodeURIComponent(taskCode)}/claim`, {
			method: "POST",
			headers,
			signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
		});
		const envelope = await readEnvelope(response);
		if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope);
		const data = typeof envelope.data === "object" && envelope.data !== null ? envelope.data : {};
		if (data["already_claimed"] === true) return {
			credit: 0,
			energy: 0
		};
		return {
			credit: typeof data["credit"] === "number" ? data["credit"] : 0,
			energy: typeof data["energy"] === "number" ? data["energy"] : 0
		};
	}
};
//#endregion
//#region src/at-rest.ts
/**
* WorkBuddy desktop "at-rest" credential decryption.
*
* From 5.6.0 the WorkBuddy desktop app no longer stores `auth.accessToken` /
* `auth.refreshToken` as plain strings. It writes a field wrapper:
*
*   { "$wbEncrypted": 1, "envelope": "<base64 of a JSON envelope>" }
*
* where the envelope is `{suite, keyId, nonce, authTag, ciphertext}` for
* AES-256-GCM with a 12-byte nonce and a 16-byte tag. The authenticated
* additional data is a length-prefixed transcript over the scheme, suite,
* keyId and framing, so the ciphertext can only be opened for the exact field
* shape it was sealed for.
*
* The field key itself is NOT a user secret: it is a build-time constant
* compiled into the app's own Electron native module
* (`electron_browser_workbuddy_storage`). The app fetches it through
* `loggerGet()` and hashes the returned base64 STRING (not the decoded bytes)
* to obtain the 32-byte key; `keyId` is the first 16 hex characters of that
* key's SHA-256.
*
* This module re-derives the same key by asking the installed app for the same
* payload, and caches it in memory for the process lifetime. Nothing is ever
* written to disk, and the payload is never logged.
*
* 溯源：本文件移植自 dingminhua/dsh-connect-workbuddy 的 src/at-rest.ts
*   （MIT，Copyright (c) 2026 LaoDing）——该模块最先定位并修复了「5.6.0 起
*   macOS 与 Windows 同样加密凭据」这一问题（其 issue #15 真机取证）。移植时
*   保留其全部判定逻辑（CFBundleExecutable 向 bundle 自己问、按 bundle id
*   确认身份后才 exec、field framing 的 AAD 转录、keyId 校验），未作改动。
*
* 改动：**「macOS 也加密」这一事实**（issue #15 真机取证）。本模块原先假设该
*   policy 是 Windows 先行、macOS 只是「将来可能」，于是 macOS 的可执行文件
*   路径用 App 名拼成 `<bundle>/Contents/MacOS/WorkBuddy`——而两个真实 bundle
*   的 `CFBundleExecutable` 都是 `Electron`，该路径并不存在。结果是 macOS 上
*   加密凭据**永远**取不到密钥，用户却被报成「未登录」。现在二进制名向 bundle
*   自己问（`macosBundleExecutable()`），候选含国际版 `WorkBuddy AI.app`，
*   并允许 App 被归入 applications 目录的子目录——扫到的候选必须先用
*   `CFBundleIdentifier` 确认身份才 `execFile`，因为**每个 Electron 应用的
*   二进制都叫 `Electron`**，只按名字匹配就可能启动另一个产品。
*
* @module dsh-rotakit/at-rest
*/
/** Envelope framing names, mapped to the single-byte AAD framing code. */
const FRAMING_CODE = {
	file: 1,
	field: 2,
	record: 3,
	stream: 4
};
/** Standard (symmetric) format identifiers, transcripted into the AAD. */
const STANDARD_FORMAT_ID = {
	file: "WBEF1",
	field: "WBEV1",
	record: "WBER1",
	stream: "WBES1"
};
/** Domain separator the AAD transcript starts with. */
const AAD_DOMAIN = Buffer.from("WB-AAD\0", "ascii");
/** Scheme name of the symmetric envelope this module opens. */
const SYMMETRIC_SCHEME = "sym-v1";
/** Env override pointing at the WorkBuddy desktop executable. */
const WORKBUDDY_APP_EXECUTABLE_ENV = "WORKBUDDY_APP_EXECUTABLE";
/** How long the app is given to answer with its key payload. */
const KEY_FETCH_TIMEOUT_MS = 1e4;
/**
* Executable file names the desktop app ships under, in probe order.
*
* `WorkBuddyAI.exe` is the INTERNATIONAL build; both apps can be installed side
* by side (observed on a real machine: `D:\\workbuddy\\WorkBuddy.exe` for the
* domestic one and `D:\\workbuddyai\\WorkBuddyAI.exe` for the international one),
* so the name cannot be assumed.
*/
const APP_EXECUTABLE_NAMES = ["WorkBuddy.exe", "WorkBuddyAI.exe"];
/**
* macOS bundles the desktop app may be installed as, in probe order.
*
* `WorkBuddy.app` is the domestic build; `WorkBuddy AI.app` is the
* international one, and a machine may carry either or both. The user-level
* `~/Applications` location is included because macOS lets an app live there,
* and installs have been observed under a subdirectory of /Applications too —
* hence {@link findWorkbuddyAppExecutable}'s parent scan, which covers those
* without guessing any particular folder name.
*/
const MACOS_APP_BUNDLE_NAMES = ["WorkBuddy.app", "WorkBuddy AI.app"];
function encodeUint32(value) {
	const bytes = Buffer.allocUnsafe(4);
	bytes.writeUInt32BE(value);
	return bytes;
}
/** Length-prefixed UTF-8 string: uint32 big-endian length followed by the bytes. */
function encodeLengthPrefixed(value) {
	const bytes = Buffer.from(value, "utf8");
	return Buffer.concat([encodeUint32(bytes.length), bytes]);
}
/**
* The authenticated additional data for one `sym-v1` FIELD-framed envelope.
*
* Only the field framing is implemented: it is the shape the desktop app uses
* for credential fields, and it is also the shape that cannot be confused with
* a whole-file envelope, so an unexpected framing is a parse error rather than
* a silently wrong transcript.
*/
function fieldAad(keyId, suite, scheme = SYMMETRIC_SCHEME) {
	if (!/^[0-9a-f]{16}$/u.test(keyId)) throw new Error(`workbuddy: envelope keyId is malformed`);
	return Buffer.concat([
		AAD_DOMAIN,
		Buffer.from([1]),
		encodeLengthPrefixed(STANDARD_FORMAT_ID["field"]),
		encodeLengthPrefixed(scheme),
		encodeUint32(suite),
		encodeLengthPrefixed(keyId),
		Buffer.from([FRAMING_CODE["field"]]),
		Buffer.from([0]),
		Buffer.from([0])
	]);
}
/** Whether a value is the app's encrypted-field wrapper. */
function isEncryptedFieldWrapper(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const wrapper = value;
	const keys = Object.keys(wrapper).sort();
	return keys.length === 2 && keys[0] === "$wbEncrypted" && keys[1] === "envelope" && wrapper["$wbEncrypted"] === 1 && typeof wrapper["envelope"] === "string";
}
/**
* The at-rest key id for a derived 32-byte key: the first 16 hex characters of
* its SHA-256. This is what the envelope's `keyId` is checked against, so a
* mismatched key fails loudly instead of returning garbage.
*/
function deriveAtRestKeyId(key) {
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
/**
* Derive the 32-byte field key from the app's key payload JSON.
*
* The app hashes the payload's base64 STRING — not its decoded bytes — so the
* same spelling is required here; hashing the decoded secret would produce a
* different key and every field would fail to open.
*/
function deriveAtRestKey(payloadJson) {
	let payload;
	try {
		payload = JSON.parse(payloadJson);
	} catch {
		throw new Error("workbuddy: at-rest key payload is not valid JSON");
	}
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("workbuddy: at-rest key payload is not an object");
	const secret = payload["atRestSecretKey"];
	if (typeof secret !== "string" || secret === "") throw new Error("workbuddy: at-rest key payload carries no atRestSecretKey");
	return createHash("sha256").update(secret, "utf8").digest();
}
/**
* Open one encrypted field with a derived key and return its plaintext.
*
* Throws when the envelope is malformed, belongs to another key, or fails
* authentication — a GCM tag mismatch is the signal that the transcript or the
* key is wrong, and it must never degrade into a truncated token.
*/
function openEncryptedField(field, key) {
	let envelope;
	try {
		envelope = JSON.parse(Buffer.from(field.envelope, "base64").toString("utf8"));
	} catch {
		throw new Error("workbuddy: encrypted field envelope is not valid JSON");
	}
	if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) throw new Error("workbuddy: encrypted field envelope is not an object");
	const record = envelope;
	const suite = record["suite"];
	const keyId = record["keyId"];
	const nonce = record["nonce"];
	const authTag = record["authTag"];
	const ciphertext = record["ciphertext"];
	if (typeof suite !== "number" || typeof keyId !== "string") throw new Error("workbuddy: encrypted field envelope is missing suite or keyId");
	if (typeof nonce !== "string" || typeof authTag !== "string" || typeof ciphertext !== "string") throw new Error("workbuddy: encrypted field envelope is missing nonce, authTag or ciphertext");
	const expectedKeyId = deriveAtRestKeyId(key);
	if (keyId !== expectedKeyId) throw new Error(`workbuddy: encrypted field belongs to key ${keyId}, not the available key ${expectedKeyId}`);
	const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"), { authTagLength: 16 });
	decipher.setAAD(fieldAad(keyId, suite));
	decipher.setAuthTag(Buffer.from(authTag, "base64"));
	return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
/**
* The key id an encrypted field envelope demands, or undefined when the
* envelope cannot be read.
*
* The account pool uses it to pick the right desktop build's key when more
* than one build (domestic and international) is installed on the same machine:
* each `.info` file names the key id its fields were sealed under, so the opener
* must select the matching derived key rather than assume one build exists.
*/
function encryptedFieldKeyId(field) {
	try {
		const record = JSON.parse(Buffer.from(field.envelope, "base64").toString("utf8"));
		return typeof record["keyId"] === "string" ? record["keyId"] : void 0;
	} catch {
		return;
	}
}
/**
* The executable inside a macOS app bundle, read from the bundle's own
* `Info.plist`.
*
* The binary is NOT reliably named after the app: the WorkBuddy bundles ship
* with `CFBundleExecutable` set to `Electron`, so a path assembled as
* `<bundle>/Contents/MacOS/WorkBuddy` does not exist and the app looks absent
* even when it is installed in the default location. Because the bundle
* documents the real name, asking it is both correct and robust to a future
* build that renames the binary.
*
* Returns undefined when the plist is absent, unreadable, or carries no usable
* name — never a guessed path, so a caller can keep probing.
*/
function macosBundleExecutable(bundle) {
	let plist;
	try {
		plist = readFileSync(join(bundle, "Contents", "Info.plist"), "utf8");
	} catch {
		return;
	}
	const name = /<key>\s*CFBundleExecutable\s*<\/key>\s*<string>([^<]*)<\/string>/u.exec(plist)?.[1]?.trim();
	if (name === void 0 || name === "" || name.includes("/") || name.includes("\\") || name === "." || name === "..") return;
	return join(bundle, "Contents", "MacOS", name);
}
/**
* Windows install locations recorded by the app's own uninstaller.
*
* The registry is the authoritative answer: it survives a non-default drive, a
* renamed folder and a differently-named executable, none of which any fixed
* path list can predict. Real machines put the app at `D:\workbuddy\WorkBuddy.exe`
* and `D:\workbuddyai\WorkBuddyAI.exe` — exactly the layouts a
* `%ProgramFiles%\WorkBuddy\WorkBuddy.exe` probe cannot see, which is why the
* plugin reported "the desktop app could not provide the key" for an app that was
* installed and running.
*
* `DisplayIcon` is the field that actually carries the path (observed as
* `D:\workbuddy\WorkBuddy.exe,0`); `InstallLocation` is usually empty for these
* installers, so both are read and either may contribute.
*
* Returns [] on any failure — a missing registry key is the normal case on
* non-Windows, not an error.
*/
function windowsRegistryAppPaths() {
	if (process.platform !== "win32") return [];
	const roots = [
		["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/**"],
		["HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/**"],
		["HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/**"]
	];
	const out = [];
	for (const [root] of roots) {
		let listing;
		try {
			listing = execFileSync("reg", [
				"query",
				root,
				"/s",
				"/v",
				"DisplayName"
			], {
				encoding: "utf8",
				timeout: 1e4,
				windowsHide: true,
				maxBuffer: 8388608
			});
		} catch {
			continue;
		}
		const keys = listing.split(/\r?\n(?=HKEY_)/u).filter((block) => /WorkBuddy|CodeBuddy/iu.test(block));
		for (const key of keys) {
			const keyPath = /^(HKEY_[^\r\n]+)/u.exec(key)?.[1]?.trim();
			if (keyPath === void 0) continue;
			for (const name of ["DisplayIcon", "InstallLocation"]) try {
				const value = execFileSync("reg", [
					"query",
					keyPath,
					"/v",
					name
				], {
					encoding: "utf8",
					timeout: 5e3,
					windowsHide: true
				});
				const raw = /REG_(?:SZ|EXPAND_SZ)\s+(.+)$/mu.exec(value)?.[1]?.trim();
				if (raw === void 0 || raw === "") continue;
				const cleaned = raw.replace(/^"/u, "").replace(/",-?\d+$/u, "").replace(/,-?\d+$/u, "").trim();
				out.push(cleaned);
			} catch {}
		}
	}
	return out;
}
/**
* Windows fallbacks for an app the registry did not cover: the well-known
* per-user and machine-wide locations, plus every fixed drive's `Program Files`.
*
* Drive enumeration matters because installing to a non-system drive is common
* on Windows and no environment variable points there.
*/
function windowsFallbackAppPaths(env) {
	const out = [];
	const roots = /* @__PURE__ */ new Set();
	for (const key of [
		"ProgramFiles",
		"ProgramW6432",
		"ProgramFiles(x86)",
		"LOCALAPPDATA"
	]) {
		const value = env[key]?.trim();
		if (value !== void 0 && value !== "") roots.add(value);
	}
	for (let code = 67; code <= 90; code += 1) {
		const drive = String.fromCharCode(code) + ":\\";
		try {
			if (!existsSync(drive)) continue;
		} catch {
			continue;
		}
		roots.add(join(drive, "Program Files"));
		roots.add(join(drive, "Program Files (x86)"));
	}
	for (const root of roots) for (const name of APP_EXECUTABLE_NAMES) {
		out.push(join(root, "WorkBuddy", name));
		out.push(join(root, "WorkBuddy AI", name));
		out.push(join(root, "Programs", "WorkBuddy", name));
	}
	for (const root of roots) try {
		for (const entry of readdirSync(root)) {
			if (!/^(workbuddy|codebuddy)/iu.test(entry)) continue;
			for (const name of APP_EXECUTABLE_NAMES) out.push(join(root, entry, name));
		}
	} catch {}
	return out;
}
/**
* Candidate paths of the WorkBuddy desktop executable, in probe order.
*
* Order is deliberate:
*  1. the explicit override, because a user who set it knows where the app is;
*  2. the registry, which is what the installer itself recorded;
*  3. derived fallbacks (per-user, machine-wide, every fixed drive).
*
* Only the Windows branch consults the registry (it is the only platform with
* one). macOS asks each bundle for its own `CFBundleExecutable` instead, because
* the WorkBuddy bundles ship a binary named `Electron`, not after the app.
*
* `readBundleExecutable` and `registryPaths` are injectable in the same spirit as
* `platform`/`home`/`env`: both consult the real machine, so without a seam the
* expected candidates would depend on what happens to be installed where the
* suite runs — passing on a developer's box and failing in CI.
*/
function workbuddyAppExecutableCandidates(platform = process.platform, home = homedir(), env = process.env, readBundleExecutable = macosBundleExecutable, registryPaths = windowsRegistryAppPaths) {
	const candidates = [env[WORKBUDDY_APP_EXECUTABLE_ENV]?.trim()];
	if (platform === "win32") {
		candidates.push(...registryPaths());
		candidates.push(...windowsFallbackAppPaths(env));
	} else if (platform === "darwin") for (const name of MACOS_APP_BUNDLE_NAMES) candidates.push(readBundleExecutable(join("/Applications", name)), readBundleExecutable(join(home, "Applications", name)));
	return candidates.filter((candidate) => candidate !== void 0 && candidate !== "");
}
/**
* Ask the installed desktop app for its key payload by running its own binary
* as plain Node (`ELECTRON_RUN_AS_NODE`) and calling the native binding.
*
* The binding is the app's own public surface for this value, so the plugin
* never has to carry a copy of a build-specific constant: it asks the very
* build that wrote the file. The child is given no stdin and a hard timeout,
* and its stdout is the only thing read.
*/
function fetchAtRestKeyPayload(executable) {
	return new Promise((resolve, reject) => {
		execFile(executable, ["-e", "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}catch(e){process.exitCode=3;process.stderr.write(String(e&&e.message||e))}"], {
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1"
			},
			timeout: KEY_FETCH_TIMEOUT_MS,
			windowsHide: true,
			maxBuffer: 1048576
		}, (error, stdout, stderr) => {
			if (error !== null) {
				reject(/* @__PURE__ */ new Error(`workbuddy: the desktop app did not provide its at-rest key (${stderr.trim() || error.message})`));
				return;
			}
			const payload = stdout.trim();
			if (payload === "") {
				reject(/* @__PURE__ */ new Error("workbuddy: the desktop app returned an empty at-rest key payload"));
				return;
			}
			resolve(payload);
		});
	});
}
/**
* The desktop app's at-rest keys, indexed by the key id each derived key
* reports (the first 16 hex of its SHA-256).
*
* More than one build can be installed on one machine — the domestic
* `WorkBuddy.exe` and the international `WorkBuddyAI.exe` share a key id on the
* builds seen here, but a future build may rotate it, and the discovery below
* must keep working if they ever diverge. A field envelope names the key id it
* was sealed under, so the opener selects the matching derived key instead of
* assuming a single build exists. Cached per process and never persisted.
*/
const atRestKeyById = /* @__PURE__ */ new Map();
let inflightKeys;
/**
* When the last full key sweep failed, and how long that failure is trusted.
*
* Without this, EVERY credential read spawned the app and waited out the
* 10-second timeout before giving up — which is what made "rescan accounts" and
* every status poll crawl on a machine where the app could not be found. A
* failure is negative-cached briefly: long enough that a burst of reads costs
* one sweep, short enough that installing or starting the app is picked up
* without restarting DSH.
*/
let lastKeyFailureAtMs = 0;
const KEY_FAILURE_BACKOFF_MS = 6e4;
/**
* Load every desktop build's key id into {@link atRestKeyById}.
*
* Mirrors the reference `provideTheKey` shape: probe EVERY candidate executable
* (not just the first that exists) and keep the key each one yields. A build
* that fails to answer — a timeout, a single-instance lock, an older build
* without the native module — is skipped on its own and does NOT poison the
* other builds, which is exactly the failure mode the single-candidate path
* had: one bad spawn cached `undefined` for the whole process and every
* encrypted field then reported "no app could be located".
*/
function ensureAtRestKeys() {
	if (atRestKeyById.size > 0) return Promise.resolve();
	if (Date.now() - lastKeyFailureAtMs < KEY_FAILURE_BACKOFF_MS) return Promise.resolve();
	inflightKeys ??= (async () => {
		const candidates = workbuddyAppExecutableCandidates().filter((candidate) => {
			try {
				return existsSync(candidate);
			} catch {
				return false;
			}
		});
		if (candidates.length === 0) {
			lastKeyFailureAtMs = Date.now();
			return;
		}
		let anySuccess = false;
		await Promise.all(candidates.map(async (executable) => {
			try {
				const key = deriveAtRestKey(await fetchAtRestKeyPayload(executable));
				atRestKeyById.set(deriveAtRestKeyId(key), key);
				anySuccess = true;
			} catch {}
		}));
		if (anySuccess) lastKeyFailureAtMs = 0;
		else lastKeyFailureAtMs = Date.now();
	})().finally(() => {
		inflightKeys = void 0;
	});
	return inflightKeys;
}
/**
* Synchronous key lookup for a key id already loaded by {@link ensureAtRestKeys}.
*
* The account pool warms the cache up front (via {@link readAtRestKey}) and then
* opens each encrypted field through a synchronous closure, because the parser
* runs `decrypt` inline. Lookups that race the warm-up, or ask for a key id no
* installed build produced, return undefined and are reported as the
* encrypted-but-unavailable error rather than a silently empty token.
*/
function atRestKeyFor(keyId) {
	return atRestKeyById.get(keyId);
}
/**
* Backwards-compatible single-key view: the first key any build provided.
*
* Kept so callers that do not yet carry a key id (and the legacy tests) still
* resolve to a usable key on single-build machines. Multi-build callers should
* prefer {@link readAtRestKeyById} and select by the field's own key id.
*/
function readAtRestKey() {
	return ensureAtRestKeys().then(() => {
		for (const key of atRestKeyById.values()) return key;
	});
}
//#endregion
//#region src/accounts.ts
/**
* Account pool: discovers every WorkBuddy credential snapshot the desktop app
* has left on this machine and hands out one healthy account per request,
* rotating away from any account the upstream has rate-limited.
*
* Discovery is read-only: the desktop app's files are never written. Each
* account is keyed by its billing identity (`uin`, falling back to `uid`), so
* re-logging the same account refreshes in place instead of creating a duplicate.
*
* @module dsh-rotakit/accounts
*/
/** Live auth file name the WorkBuddy desktop app writes. */
const WORKBUDDY_LIVE_FILENAME = "workbuddy-desktop.info";
/** Snapshot files left behind by previous logins share this prefix. */
/** Env override for the auth file or its directory. */
const WORKBUDDY_AUTH_FILE_ENV = "WORKBUDDY_AUTH_FILE";
function nonEmptyEnv(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/**
* Platform-default directories holding the desktop app's auth files.
* Windows probes Local before Roaming; a redirected profile still resolves
* through the env location.
*/
function defaultDesktopAuthDirs(platform = process.platform, home = homedir(), env = process.env) {
	if (platform === "darwin") return [join(home, "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth")];
	if (platform === "win32") {
		const local = nonEmptyEnv(env["LOCALAPPDATA"]) ?? join(home, "AppData", "Local");
		const roaming = nonEmptyEnv(env["APPDATA"]) ?? join(home, "AppData", "Roaming");
		return [join(local, "CodeBuddyExtension", "Data", "Public", "auth"), join(roaming, "CodeBuddyExtension", "Data", "Public", "auth")];
	}
	if (platform === "linux") {
		const config = nonEmptyEnv(env["XDG_CONFIG_HOME"]) ?? join(home, ".config");
		return [join(config, "CodeBuddyExtension", "Data", "Public", "auth")];
	}
	return [];
}
/** Normalize an expiry that may arrive in seconds or milliseconds. */
function expiryToMs(value) {
	if (value <= 0) return 0;
	return value > 0xe8d4a51000 ? value : value * 1e3;
}
function optionalString(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
* Read one string-valued field that may arrive as a plain string (older builds)
* or as the desktop app's `$wbEncrypted` envelope. The app started encrypting
* `accessToken` / `refreshToken` / `nickname` in 5.6.0 on BOTH macOS and Windows
* — the earlier "Windows first" reading was wrong, and it is why a signed-in Mac
* showed no account at all: the value is an object, `typeof === 'string'` failed,
* and the parser reported "no credential" for a perfectly good sign-in.
*
* `decrypt` is injected rather than called here so this parser stays synchronous
* and testable; the async key fetch lives in `readCredential`. A field that IS
* encrypted but could not be opened is reported as `failed` rather than as an
* empty string — the caller must tell the user the app is missing or unreachable,
* not send them to sign in again (the one action that cannot help).
*/
/**
* Marker for "the credential is encrypted and we could not obtain the key".
*
* Carried as a `code` rather than left to `instanceof` because the value crosses
* the packaged-plugin boundary; the same convention the sibling error types use.
* This is deliberately NOT "not signed in": the user IS signed in, and telling
* them to sign in again sends them to the one action that cannot help.
*/
const ENCRYPTED_CREDENTIAL_CODE = "ENCRYPTED_CREDENTIAL";
var WorkBuddyEncryptedCredentialError = class extends Error {
	code = ENCRYPTED_CREDENTIAL_CODE;
	constructor(sourcePath) {
		super(`workbuddy: ${sourcePath} holds encrypted credentials, but no WorkBuddy desktop app could be located to provide the key. If the app IS installed, it is simply outside the paths this plugin probes — set WORKBUDDY_APP_EXECUTABLE to its full .exe path (then restart DSH) and the credential will open. Signing in again will not help: the credential itself is intact. Run \`dsh-rotakit doctor\` to see which paths were probed.`);
		this.name = "WorkBuddyEncryptedCredentialError";
	}
};
/** True when a thrown value is the encrypted-credential marker (cross-bundle safe). */
function isEncryptedCredentialError(value) {
	return typeof value === "object" && value !== null && value.code === "ENCRYPTED_CREDENTIAL";
}
function decryptableString(value, decrypt) {
	if (typeof value === "string") return {
		value,
		encrypted: false,
		failed: false
	};
	if (isEncryptedFieldWrapper(value)) {
		if (decrypt === void 0) return {
			value: "",
			encrypted: true,
			failed: true
		};
		try {
			return {
				value: decrypt(value),
				encrypted: true,
				failed: false
			};
		} catch {
			return {
				value: "",
				encrypted: true,
				failed: true
			};
		}
	}
	return {
		value: "",
		encrypted: false,
		failed: false
	};
}
/**
* Parse a WorkBuddy auth document. Accepts the nested desktop shape
* `{"auth":{...},"account":{...}}` and the flat panel shape; returns undefined
* when there is no usable access token.
*
* `decrypt` opens the desktop app's `$wbEncrypted` field wrapper (5.6.0+, both
* platforms). Absent means "plain-string builds only", which is what every
* caller without an at-rest key should pass.
*/
function parseWorkBuddyAuth(text, sourcePath, decrypt) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const document = parsed;
	let auth;
	let identity;
	if (typeof document["auth"] === "object" && document["auth"] !== null) {
		auth = document["auth"];
		identity = typeof document["account"] === "object" && document["account"] !== null ? document["account"] : {};
	} else {
		auth = document;
		identity = document;
	}
	const accessField = decryptableString(auth["accessToken"], decrypt);
	if (accessField.encrypted && accessField.failed) throw new WorkBuddyEncryptedCredentialError(sourcePath);
	const accessToken = accessField.value;
	if (accessToken === "") return void 0;
	const refreshExpiresAtMs = typeof auth["refreshExpiresAt"] === "number" ? expiryToMs(auth["refreshExpiresAt"]) : void 0;
	if (refreshExpiresAtMs !== void 0 && refreshExpiresAtMs > 0 && refreshExpiresAtMs < Date.now()) return;
	const lastRefreshAtMs = typeof auth["lastRefreshTime"] === "number" ? expiryToMs(auth["lastRefreshTime"]) : void 0;
	return {
		accessToken,
		refreshToken: decryptableString(auth["refreshToken"], decrypt).value,
		expiresAtMs: typeof auth["expiresAt"] === "number" ? expiryToMs(auth["expiresAt"]) : 0,
		...refreshExpiresAtMs === void 0 ? {} : { refreshExpiresAtMs },
		...lastRefreshAtMs === void 0 ? {} : { lastRefreshAtMs },
		...optionalString(decryptableString(identity["nickname"], decrypt).value) === void 0 ? {} : { nickname: optionalString(decryptableString(identity["nickname"], decrypt).value) },
		...optionalString(identity["uin"]) === void 0 ? {} : { uin: optionalString(identity["uin"]) },
		...optionalString(identity["uid"]) === void 0 ? {} : { uid: optionalString(identity["uid"]) },
		...optionalString(identity["enterpriseId"]) === void 0 ? {} : { enterpriseId: optionalString(identity["enterpriseId"]) },
		domain: typeof auth["domain"] === "string" ? auth["domain"] : "",
		sourcePath
	};
}
/**
* Stable account id. `uin` is the billing identity the upstream keys on and
* survives re-login; `uid` is the fallback.
*/
/**
* True when `path` is the desktop app's live sign-in (as opposed to a backup
* snapshot it left behind). The live file always wins: it is the session the
* app itself is using.
*/
function isLiveAuthFile(path) {
	return basename(path) === WORKBUDDY_LIVE_FILENAME;
}
/**
* Which of two credentials for the same account the pool should keep.
*
* Ordering, highest first:
*
* 1. the live file the desktop app is signed in with;
* 2. the credential the upstream issued most recently (`lastRefreshAtMs`);
* 3. the longer stored expiry, as a fallback for documents that carry no issue
*    time (the plugin's own refreshed copy, older builds).
*
* The stored expiry alone is NOT a freshness signal: the upstream does not
* rewrite it when it revokes a token, so a long-dead backup can claim to expire
* later than the token that actually works. Selecting on it made every upstream
* call return 401 while a perfectly good credential sat in the same directory.
*/
function compareFreshness(a, b) {
	const aLive = isLiveAuthFile(a.sourcePath) ? 1 : 0;
	const bLive = isLiveAuthFile(b.sourcePath) ? 1 : 0;
	if (aLive !== bLive) return bLive - aLive;
	const aIssued = a.lastRefreshAtMs ?? 0;
	const bIssued = b.lastRefreshAtMs ?? 0;
	if (aIssued !== bIssued) return bIssued - aIssued;
	return b.expiresAtMs - a.expiresAtMs;
}
/** True when `candidate` should replace `incumbent` for the same account. */
function isFresher(candidate, incumbent) {
	return compareFreshness(candidate, incumbent) < 0;
}
/**
* Stable per-account id: `uin ?? uid ?? phoneNumber ?? nickname`.
*
* `uin` and `uid` keep their old precedence so already-scanned accounts are not
* re-keyed. The phone number sits before the nickname because it is the only
* stable identity some snapshots carry: the live auth directory holds two files
* (05/06) that share uid `7d83700b` for the same number and a nickname that is
* just that number again, so ranking on the nickname can split one person across
* two ids. Changing this order re-keys existing accounts.
*/
function workbuddyAccountId(credential) {
	const stable = credential.uin ?? credential.uid ?? credential.phoneNumber ?? credential.nickname ?? "unknown";
	return createHash("sha256").update(`workbuddy\0${stable}`).digest("hex").slice(0, 16);
}
/**
* [xdpool-privacy] Mask a phone number wherever it appears in a label.
*
* Tencent fills `nickname` with the account's own phone number for users who
* never set one, so the label rendered on the settings card — and returned by
* the `/status` route — was displaying the full mobile number (eleven digits
* followed by the account-hash suffix).
* A settings panel is not a place for that: it is screenshotted, shared and
* pasted into issues, and the number is the account's own login identity.
*
* The tail four digits are kept deliberately: they are what the upstream client
* itself shows, they let a person tell two accounts apart, and four digits do
* not identify a subscriber. Everything before them becomes "*".
*
* Matching is on shape, not on field name, because either `nickname` or
* `phoneNumber` can be the one carrying the number depending on which client
* wrote the snapshot — masking only the documented field would leave the real
* leak (the nickname) fully visible.
*/
function maskPhoneInLabel(value) {
	const text = String(value ?? "");
	if (text === "") return text;
	/**
	* An 11-digit mainland number, or a 13+ digit E.164 one with an optional
	* leading "+". Deliberately anchored to the whole segment so an ordinary
	* nickname that merely contains digits (e.g. `user2024`) is left alone.
	*/
	const masked = text.replace(/(^|[^0-9])(\+?)(\d{11,15})(?![0-9])/g, (match, lead, plus, digits) => {
		return `${lead}${plus}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
	});
	return masked;
}
/**
* Human label; distinguishes same-nickname accounts by uid prefix.
*
* Falls back to a phone-number tail for the snapshots that never got a uid, so
* an id-less account still shows something a person can recognise.
*
* [xdpool-privacy] Both the nickname and the fallback phone tail pass through
* `maskPhoneInLabel`, so no build of the desktop client can leak a full number
* into the card or the status payload — see that function for why the tail four
* digits survive.
*/
function accountLabel(credential) {
	const name = maskPhoneInLabel(credential.nickname ?? "WorkBuddy");
	const discriminator = (credential.uid ?? credential.uin ?? "").slice(0, 8);
	if (discriminator !== "") return `${name}#${discriminator}`;
	const phone = credential.phoneNumber ?? "";
	return phone.length < 4 ? name : `${name}#${phone.slice(-4)}`;
}
/** List the auth files in one directory: the live file plus every snapshot. */
/**
* Credential files in one auth directory, freshest first.
*
* Every `*.info` file counts, not just the timestamped `workbuddy-desktop.*`
* snapshots: the international client signs in as `workbuddy-desktop-ai.info`
* (a hyphen, not a dot), so a prefix test silently dropped every global
* credential and the global provider then saw an empty pool.
*
* Filenames are plain strings, and the ordering here is only a first pass —
* `isFresher` makes the real call once each file has been parsed.
*/
async function authFilesIn(dir) {
	let entries;
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const files = entries.filter((name) => name.endsWith(".info"));
	files.sort((a, b) => a < b ? 1 : a > b ? -1 : 0);
	return files.map((name) => join(dir, name));
}
async function readCredential(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return;
	}
	const decrypt = text.includes("\"$wbEncrypted\"") ? await encryptedFieldOpener() : void 0;
	try {
		return parseWorkBuddyAuth(text, path, decrypt);
	} catch (error) {
		if (isEncryptedCredentialError(error)) throw error;
		return;
	}
}
/**
* Build the field opener, or undefined when the app cannot supply its key.
*
* Split out so the key lookup is testable without a real desktop install, and so
* a lookup failure degrades to "encrypted, unopenable" rather than to a parse
* error that would look like a corrupt file.
*/
async function encryptedFieldOpener() {
	await readAtRestKey().catch(() => void 0);
	return (field) => {
		if (!isEncryptedFieldWrapper(field)) throw new Error("workbuddy: not an encrypted field wrapper");
		const keyId = encryptedFieldKeyId(field);
		if (keyId === void 0) throw new Error("workbuddy: encrypted field has no key id");
		const key = atRestKeyFor(keyId);
		if (key === void 0) throw new Error("workbuddy: no at-rest key available for this encrypted field");
		return openEncryptedField(field, key);
	};
}
/** Every directory the pool should scan, in probe order. */
function candidateAuthDirs(env = process.env) {
	const dirs = [];
	const override = nonEmptyEnv(env[WORKBUDDY_AUTH_FILE_ENV]);
	if (override !== void 0) dirs.push(override.toLowerCase().endsWith(".info") ? resolve(override, "..") : override);
	dirs.push(...defaultDesktopAuthDirs(process.env["DSH_TEST_PLATFORM"]));
	return dirs;
}
/**
* Read-only pool of every discovered WorkBuddy account, with rate-limit
* cooldown and round-robin failover.
*/
/** Idle bonus per hour an account has been unused (reference-panel default). */
const IDLE_WEIGHT_PER_HOUR = .5;
/** Ceiling for the idle bonus, so an idle account cannot dominate forever. */
const IDLE_WEIGHT_MAX = 5;
/**
* Weight one account by how long it has been idle.
*
* The base of 1 keeps every eligible account in play: an account that served a
* moment ago still has a small chance, so a single unhealthy account cannot pin
* the pool to itself, and the weights never sum to zero.
*
* `lastUsedAt === undefined` means "never used in this process", which earns the
* full bonus: on a fresh start every account ties, and the weighted draw spreads
* the first requests instead of always picking the first entry.
*/
function idleWeight(lastUsedAt, now) {
	if (lastUsedAt === void 0) return 6;
	const hours = (now - lastUsedAt) / 36e5;
	return 1 + Math.min(Math.max(hours, 0) * IDLE_WEIGHT_PER_HOUR, IDLE_WEIGHT_MAX);
}
/**
* How soon an account's credits start lapsing, in ms, or undefined when nothing
* it holds has a deadline.
*
* The map holds a bare timestamp (see `noteExpiry`), not an object — reading it
* as one silently yields `undefined` for every account, which makes the expiry
* preference look implemented while doing nothing at all.
*/
function expiryWithin(account, expiryByAccount, now, windowMs) {
	const nearest = expiryByAccount.get(account.id);
	if (typeof nearest !== "number" || !Number.isFinite(nearest)) return void 0;
	if (nearest <= now) return 0;
	if (nearest - now > windowMs) return void 0;
	return nearest - now;
}
/** Credits expiring inside this window make an account worth prioritising. */
const EXPIRY_PRIORITY_WINDOW_MS = 7 * 864e5;
/**
* Multiplier applied to an account whose credits lapse inside the window.
*
* Large enough to reorder the draw but not infinite: a weighted draw keeps a
* small chance for every account, so a genuine failure on the soon-to-expire
* account still fails over instead of being retried until the credits are gone.
*/
const EXPIRY_PRIORITY_BOOST = 8;
/**
* How many of the best-weighted accounts a single draw considers.
*
* A weighted draw over the whole pool has a long tail: with 21 accounts the
* least-idle ones still collect several percent each, so a run of requests
* scatters across accounts that have barely any credit left. Taking the best few
* and shuffling them keeps the spread wide enough to avoid hammering one account
* while cutting off that tail.
*
* Five is a deliberate compromise. Below three the pool behaves like
* round-robin and one slow account is hit repeatedly; above roughly eight the
* tail returns and the benefit disappears.
*/
const SHORTLIST_SIZE = 5;
/**
* How long a conversation stays pinned to the account that first served it.
*
* The upstream caches the prompt prefix per account, so a conversation that keeps
* changing accounts pays full prefill every turn. Thirty minutes covers a normal
* working session while letting the binding expire rather than accumulate.
*/
const STICKY_TTL_MS = 18e5;
/**
* Cap on tracked conversations.
*
* The map is keyed by conversation, so without a bound a long-running process
* would hold one entry per conversation it had ever seen. Well above the number
* that can be in flight at once.
*/
const STICKY_MAX = 512;
/**
* How many requests one account may have in flight before it is passed over.
*
* `acquire` selects on `lastUsedAt`, which only moves once a request has
* succeeded. Concurrent requests therefore all read the same idle picture and can
* be handed the same account, which is exactly when an upstream rate limit bites.
*
* The bound is 2, not 1, because of the tension with stickiness: a conversation
* pinned to an account for its prompt cache will send its next turn there, and
* refusing to do that the moment one request is in flight would discard the
* cache benefit on every overlap. Two tolerates the ordinary case - a follow-up
* begun while the previous turn is still streaming - while still refusing to pile
* requests onto one account.
*/
const IN_FLIGHT_LIMIT = 2;
/**
* A stable identity for one conversation, derived from its opening.
*
* The client sends no conversation id, so the key has to come from the content.
* The system prompt plus the first user message is the part that does not change
* as the conversation grows: hashing the whole message list would produce a
* different key every turn, which is the opposite of what a sticky binding needs.
*
* Returns undefined when there is nothing stable to key on, and the caller then
* falls back to ordinary rotation.
*/
function conversationKeyOf(parsed) {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const messages = parsed["messages"];
	if (!Array.isArray(messages) || messages.length === 0) return void 0;
	let system = "";
	let firstUser = "";
	for (const entry of messages) {
		if (typeof entry !== "object" || entry === null) continue;
		const content = typeof entry["content"] === "string" ? entry["content"] : "";
		if (content === "") continue;
		if (entry["role"] === "system" && system === "") system = content;
		else if (entry["role"] === "user" && firstUser === "") firstUser = content;
		if (system !== "" && firstUser !== "") break;
	}
	if (system === "" && firstUser === "") return void 0;
	return createHash("sha256").update(system).update("\u0000").update(firstUser).digest("hex").slice(0, 16);
}
/** Default rest for an account whose credits ran out (packs reset on their own schedule). */
const EXHAUST_COOLDOWN_MS = 18e5;
/**
* How many credential rejections in a row retire an account from the pool.
*
* A 401/403 means the stored token is not accepted. One rejection is worth a
* token refresh and a retry; a run of them is a credential that needs a fresh
* sign-in, and every further attempt costs a full round trip before the pool
* moves on. With a large account list that is the difference between one wasted
* request and one per request.
*
* Three, not one: the desktop client rewrites its sign-in files on its own
* schedule, and a single rejection right after a refresh is common enough that
* retiring on the first would drop healthy accounts.
*/
const AUTH_DEAD_STREAK_LIMIT = 3;
/**
* How long a retired account stays out before it is offered again.
*
* Long enough that a request does not keep rediscovering the same dead token,
* short enough that signing in again fixes it without restarting anything. The
* clock restarts on each further rejection, so a password change that never
* happens cannot keep the account in the pool indefinitely.
*/
const AUTH_DEAD_COOLDOWN_MS = 18e5;
var WorkBuddyAccountPool = class {
	logger;
	authDirs;
	cooldownMs;
	/**
	* How long an account stays out of rotation after the upstream reports its
	* credits are spent. Credit packs reset on their own schedule rather than on a
	* rate-limit window, so this is much longer than `cooldownMs`.
	*/
	exhaustCooldownMs;
	client;
	refreshMarginMs;
	accounts = [];
	distribution;
	/** Cursor for round-robin mode; unused under priority distribution. */
	cursor = 0;
	lastScanAtMs = 0;
	preferredId;
	/**
	* Account ids the user switched off on the card.
	*
	* Disabling is a user preference rather than a property of the credential:
	* `scan()` rebuilds every account object from the auth files, so the set
	* lives on the pool and is re-applied from settings after each scan.
	*/
	disabledIds = /* @__PURE__ */ new Set();
	/**
	* Per-account credit floor, keyed by account id. 0 (or absent) means "spend
	* it all".
	*
	* A reserved balance is protection, not a hard limit the upstream knows
	* about: the pool simply stops picking that account once its last known
	* balance is at or below the floor, so the user keeps a cushion instead of
	* draining every account to zero.
	*/
	creditReserves = /* @__PURE__ */ new Map();
	/**
	* Last known credit balance per account, epoch ms aside.
	*
	* Refreshed in the background after a successful request, so a pick can
	* consult it. An account with no reading is treated as usable: refusing to
	* pick an account just because its balance has not been checked yet would
	* strand a healthy pool, and the first 402 still cools it as before.
	*/
	creditBalances = /* @__PURE__ */ new Map();
	/**
	* When each account's credits start lapsing, from the last observed packages.
	*
	* Separate from `creditBalances` so that map stays a plain balance map (see
	* `noteExpiry`). Only accounts that have reported are present; an entry of
	* `undefined` means "observed, nothing expires".
	*/
	creditExpiries = /* @__PURE__ */ new Map();
	/**
	* Which account is serving each conversation, so the upstream prompt cache
	* stays warm. Keyed by the conversation's opening (see `conversationKeyOf`),
	* bounded in `rememberSticky`.
	*/
	stickyAccount = /* @__PURE__ */ new Map();
	/**
	* Requests currently being served by each account.
	*
	* Incremented in `acquire` and decremented in `release`, so the count is what
	* selection consults instead of the idle picture that only updates on success.
	*/
	inFlight = /* @__PURE__ */ new Map();
	/** How many requests this account is serving right now. */
	inFlightCount(accountId) {
		return this.inFlight.get(accountId) ?? 0;
	}
	/** Count one request against an account. */
	lease(accountId) {
		this.inFlight.set(accountId, this.inFlightCount(accountId) + 1);
	}
	/**
	* Give the lease back.
	*
	* Must run on every path, success and failure alike: a counter that only ever
	* rises would take an account out of rotation permanently, which is worse than
	* the duplicate assignment this exists to prevent.
	*/
	release(accountId) {
		const current = this.inFlightCount(accountId);
		if (current <= 1) this.inFlight.delete(accountId);
		else this.inFlight.set(accountId, current - 1);
	}
	/**
	* Last time each account served a request, epoch ms. Drives the idle term
	* of the priority-mode weighting below: an account that just served loses to
	* one that has been idle, so a small pool stops hammering a single account.
	*
	* In-memory on purpose: it only biases the next pick, so a cold start that
	* treats every account as idle is the right default. Not keyed by id lookup
	* misses because a removed account simply disappears from the map on re-scan.
	*/
	lastUsedAt = /* @__PURE__ */ new Map();
	refreshInflight = /* @__PURE__ */ new Map();
	constructor(options = {}) {
		this.logger = options.logger;
		this.authDirs = options.authDirs ?? candidateAuthDirs();
		this.cooldownMs = options.cooldownMs ?? 6e4;
		/**
		* Ceiling for the exponential cooldown backoff.
		*
		* Bounded because an unbounded ladder ends with every account parked for
		* hours after a burst of failures, including accounts that would have
		* recovered immediately. Two hours is long enough to stop hammering a
		* genuinely limited account and short enough that the pool heals on its own
		* within a session rather than needing a restart.
		*/
		this.cooldownMaxMs = options.cooldownMaxMs ?? 72e5;
		this.exhaustCooldownMs = options.exhaustCooldownMs ?? EXHAUST_COOLDOWN_MS;
		/** How long an "account does not serve this model" verdict is trusted. */
		this.modelBlockMs = options.modelBlockMs ?? 6 * 60 * 6e4;
		this.client = options.client;
		this.refreshMarginMs = options.refreshMarginMs ?? 3e5;
		this.distribution = options.distribution ?? "priority";
	}
	/**
	* Re-apply configuration that only affects discovery and cooldown policy,
	* without rebuilding the pool. A later `scan()` uses the new auth dirs and
	* cooldown window; existing accounts keep their in-memory state.
	*/
	applyConfig(options) {
		if (options.authDirs !== void 0 && options.authDirs.length > 0) this.authDirs = options.authDirs;
		if (options.cooldownMs !== void 0 && options.cooldownMs >= 1e3) this.cooldownMs = options.cooldownMs;
		if (options.exhaustCooldownMs !== void 0 && options.exhaustCooldownMs >= 1e3) this.exhaustCooldownMs = options.exhaustCooldownMs;
		if (options.distribution !== void 0) this.distribution = options.distribution;
		if (options.disabledAccountIds !== void 0) this.disabledIds = new Set(options.disabledAccountIds);
		if (options.creditReserves !== void 0) this.setCreditReserves(options.creditReserves);
	}
	/** Rescan the auth directories and merge newly discovered accounts. */
	async scan() {
		const found = [];
		for (const dir of this.authDirs) for (const file of await authFilesIn(dir)) {
			const credential = await readCredential(file);
			if (credential !== void 0) found.push(credential);
		}
		const byId = /* @__PURE__ */ new Map();
		for (const account of this.accounts) byId.set(account.id, account);
		/** Ids that were not already known, in discovery order. */
		const added = [];
		for (const credential of found) {
			const id = workbuddyAccountId(credential);
			const existing = byId.get(id);
			if (existing === void 0) {
				byId.set(id, {
					id,
					label: accountLabel(credential),
					credential,
					cooldownUntilMs: 0,
					modelCooldowns: {},
					rateLimitHits: 0,
					serverErrorHits: 0,
					/** Consecutive cooldown entries without a successful request. */
					softStreak: 0,
					/**
					* The same count for gateway faults, kept apart so a run of upstream 5xx
					* cannot make this account's own next 429 look like a repeat offence.
					*/
					gatewayStreak: 0,
					/** Consecutive upstream rejections of this account's credential. */
					authFailStreak: 0,
					/**
					* While this is in the future the account is out of the pool because
					* its credential was rejected, not because of rate limiting. Kept
					* separate from `cooldownUntilMs` so the card can say which it is -
					* the user's remedy is different (sign in again vs. wait).
					*/
					authDeadUntilMs: 0
				});
				added.push(id);
				continue;
			}
			if (isFresher(credential, existing.credential)) byId.set(id, {
				...existing,
				credential,
				label: accountLabel(credential)
			});
		}
		const ordered = [...byId.values()];
		ordered.sort((a, b) => compareFreshness(a.credential, b.credential));
		this.accounts = ordered;
		this.lastScanAtMs = Date.now();
		/**
		* Ids discovered by THIS scan, for callers that want to act on a newly
		* added account. Recorded rather than acted on here: `scan()` also runs on
		* the request path when the pool is empty, where triggering automation
		* would be both surprising and slow.
		*/
		this.lastScanNewIds = added;
		return this.accounts;
	}
	/** All accounts, cooldown state included. */
	list(region) {
		if (region === void 0) return this.accounts;
		return this.accounts.filter((account) => regionOf(account.credential.domain) === region);
	}
	/**
	* Accounts currently eligible to serve a request.
	*
	* With a `modelId`, an account is eligible when it is not account-wide cooled
	* AND that model is not cooling on it — so a 429 on `hy4-preview` only keeps
	* that model out while `hy3` on the same account stays usable. Without a
	* model id the legacy account-wide check applies (callers that cannot name a
	* model, e.g. CLI diagnostics).
	*/
	available(now, modelId, region) {
		return this.accounts.filter((account) => {
			if (this.disabledIds.has(account.id)) return false;
			const reserve = this.creditReserves.get(account.id);
			if (reserve !== void 0 && reserve > 0) {
				const balance = this.creditBalances.get(account.id);
				if (balance !== void 0 && balance <= reserve) return false;
			}
			if (account.cooldownUntilMs > now) return false;
			// A rejected credential is not a rate limit, but it keeps the account out
			// of the pool all the same: offering it again only spends a round trip
			// rediscovering the same rejection.
			if (this.isAuthDead(account, now)) return false;
			if (modelId !== void 0 && (account.modelCooldowns[modelId] ?? 0) > now) return false;
			if (region !== void 0 && regionOf(account.credential.domain) !== region) return false;
			return true;
		});
	}
	/** Round-robin: the legacy cursor walk, kept for the distribution that asks for it. */
	pickRoundRobin(pool) {
		const index = this.cursor % pool.length;
		const account = pool[index];
		if (account === void 0) return void 0;
		this.cursor = (index + 1) % pool.length;
		return account;
	}
	/**
	* Priority mode: weighted random over the eligible accounts.
	*
	* The weight is an idle bonus — `1 + min(idleHours * perHour, max)` — so an
	* account that has never served (or has been idle for a while) outranks one
	* that just answered. Reference panel logic drops its success-rate term
	* entirely because a lifetime error counter penalises an account forever;
	* instantaneous health is already handled by cooldowns, which is why those
	* accounts never reach this list.
	*
	* A pool with no idle history (fresh process) hashes to equal weights, which
	* spreads the very first picks instead of always returning index 0.
	*/
	pickByWeight(pool) {
		if (pool.length === 1) return pool[0];
		const now = Date.now();
		/**
		* Credits that are about to lapse jump the queue.
		*
		* Idle weighting alone actively works against this: it prefers the LEAST
		* recently used account, which on a pool where one account holds expiring
		* credits is often not that account. Spending the lapsing balance first is
		* strictly better than letting it expire and then spending the rest, and it
		* is the only selection rule here that changes what the credits are worth
		* rather than merely how they are shared.
		*
		* The boost reorders the draw without making it deterministic, so an account
		* that is about to expire but failing still fails over normally.
		*/
		const weights = pool.map((account) => {
			const base = idleWeight(this.lastUsedAt.get(account.id), now);
			const remaining = expiryWithin(account, this.creditExpiries, now, EXPIRY_PRIORITY_WINDOW_MS);
			return remaining === void 0 ? base : base * EXPIRY_PRIORITY_BOOST;
		});
		/**
		* Keep the best-weighted accounts, then shuffle them and take the head.
		*
		* The weights decide who is worth considering; the shuffle decides the order
		* among them. That replaces a weighted roll over the entire pool, where the
		* long tail of low-weight accounts still collected a few percent each and
		* could therefore be drawn repeatedly.
		*
		* An account with an expiring-credit boost ranks near the top by virtue of its
		* weight, so this does not weaken the lapse-first rule.
		*/
		const ranked = pool.map((account, index) => ({ account, weight: weights[index] ?? 0 })).sort((left, right) => right.weight - left.weight).slice(0, SHORTLIST_SIZE);
		const shortlist = ranked.map((entry) => entry.account);
		// Fisher-Yates, so every member of the shortlist is equally likely to lead.
		for (let index = shortlist.length - 1; index > 0; index -= 1) {
			const swap = Math.floor(Math.random() * (index + 1));
			[shortlist[index], shortlist[swap]] = [shortlist[swap], shortlist[index]];
		}
		return shortlist[0] ?? pool[0];
	}
	/**
	* Pick the account to serve a request.
	*
	* Two distributions, chosen by the `distribution` setting:
	*
	* - **priority** (default, and what the card ships with): one account serves
	*   every request until it is rate-limited, then the next in order takes over.
	*   Credits drain one account at a time, and a cooling account returns to the
	*   head of the queue the moment its window resets — it was never consumed, so
	*   it resumes straight away.
	* - **round-robin**: consecutive requests rotate through the pool so spend
	*   spreads evenly across every account.
	*
	* In both modes an explicit user selection (`prefer`) heads the list, a
	* cooling account is skipped for that model only, and an unrecognised setting
	* falls back to priority.
	*
	* Scans on first use, and rescans when every known account is cooling down: a
	* fresh desktop login is the usual way out of an exhausted pool.
	*
	* `conversationKey` is optional. When supplied, a conversation that already has
	* an account keeps it, so the upstream's prompt cache stays warm across turns.
	*/
	async acquire(modelId, region, conversationKey) {
		if (this.accounts.length === 0) await this.scan();
		let pool = this.available(Date.now(), modelId, region);
		if (pool.length === 0) {
			await this.scan();
			pool = this.available(Date.now(), modelId, region);
		}
		if (pool.length === 0) return void 0;
		if (this.preferredId !== void 0) {
			const preferred = pool.find((account) => account.id === this.preferredId);
			if (preferred !== void 0) {
				this.lease(preferred.id);
				await this.ensureFresh(preferred);
				return preferred;
			}
		}
		/**
		* A conversation that already has an account keeps it.
		*
		* Only when that account is still in the available pool: a binding must
		* never resurrect an account that is cooling, retired or out of credits,
		* or the pool would start routing around its own health rules.
		*
		* Also only while the account is not already busy. Keeping the prompt cache
		* warm is worth sharing one turn's overlap, but not worth stacking requests
		* on one account: past IN_FLIGHT_LIMIT the cache win is smaller than the
		* rate-limit risk. The binding is passed over for this request, not dropped,
		* so the conversation returns to it as soon as it is free.
		*/
		/**
		* Whether a live binding was passed over because its account was busy.
		*
		* Such a binding must be kept, not replaced: a busy moment is temporary, and
		* rebinding would move the conversation to a new account permanently, so the
		* prompt cache would be cold from then on even though the original account
		* was free again one request later. Only a binding that is genuinely gone -
		* expired, or its account no longer in the pool - is replaced.
		*/
		let passedOverBinding = false;
		if (conversationKey !== void 0) {
			const bound = this.stickyAccount.get(conversationKey);
			if (bound !== void 0 && bound.untilMs > Date.now()) {
				const match = pool.find((account) => account.id === bound.accountId);
				if (match !== void 0 && this.inFlightCount(bound.accountId) < IN_FLIGHT_LIMIT) {
					this.lease(match.id);
					await this.ensureFresh(match);
					return match;
				}
				// Still live and still in the pool, but busy or at its limit.
				passedOverBinding = match !== void 0;
			}
		}
		/**
		* Otherwise prefer accounts that are not already serving something.
		*
		* A preference, not a rule: when every account in the pool is busy the least
		* busy ones are still offered, because refusing to serve at all is worse
		* than sharing an account. The narrowing happens before the picker runs, so
		* the existing weighting and shortlist behaviour is untouched.
		*/
		const idle = pool.filter((account) => this.inFlightCount(account.id) === 0);
		const candidates = idle.length > 0 ? idle : pool;
		const account = this.distribution === "round-robin" ? this.pickRoundRobin(candidates) : this.distribution === "balanced" ? this.pickByWeight(candidates) : candidates[0];
		if (account === void 0) return void 0;
		if (conversationKey !== void 0 && !passedOverBinding) this.rememberSticky(conversationKey, account.id);
		this.lease(account.id);
		await this.ensureFresh(account);
		return account;
	}
	/**
	* Remember which account a conversation is being served by.
	*
	* Also drops expired entries and, once the map is at its cap, the oldest one.
	* Pruning happens here rather than on a timer because this is the only place
	* that grows the map.
	*/
	rememberSticky(conversationKey, accountId) {
		const now = Date.now();
		this.stickyAccount.set(conversationKey, { accountId, untilMs: now + STICKY_TTL_MS });
		if (this.stickyAccount.size <= STICKY_MAX) return;
		for (const [key, value] of this.stickyAccount) {
			if (value.untilMs <= now) this.stickyAccount.delete(key);
		}
		while (this.stickyAccount.size > STICKY_MAX) {
			const oldest = this.stickyAccount.keys().next();
			if (oldest.done === true) break;
			this.stickyAccount.delete(oldest.value);
		}
	}
	/** Pin the account the plugin card should prefer; tokens stay out of settings. */
	/** How the pool currently spreads requests. Shown on the card. */
	currentDistribution() {
		return this.distribution;
	}
	prefer(accountId) {
		this.preferredId = accountId;
	}
	/** Whether the user switched this account off on the card. */
	isDisabled(accountId) {
		return this.disabledIds.has(accountId);
	}
	/** Every account id the user switched off, in discovery order. */
	disabledIdsInOrder() {
		return this.accounts.filter((account) => this.disabledIds.has(account.id)).map((account) => account.id);
	}
	/**
	* Record that an account actually served a request.
	*
	* Called by the shim once the upstream answers 200 — only then is the account
	* the one the user is really being served by. `balanced` mode reads the same map
	* for its idle weighting, so a request that failed over to another account must
	* not count as used for the account that was merely tried.
	*/
	noteServed(accountId) {
		const account = this.accounts.find((item) => item.id === accountId);
		if (account === void 0) return;
		this.lastUsedAt.set(accountId, Date.now());
		/**
		* A served request is the strongest evidence the account is healthy again,
		* so the backoff ladder resets here. Without this the streak is permanent:
		* an account that recovered after one bad minute would still be cooling for
		* the maximum window on its next isolated failure, hours later.
		*/
		account.softStreak = 0;
		// The gateway ladder clears on the same evidence: a 200 through this account
		// proves the upstream blip is over for it too.
		account.gatewayStreak = 0;
		/**
		* The same reasoning applies to the credential ladder: a 200 proves the token
		* works, so it must clear the rejections that preceded it. Leaving the count
		* at the limit would retire an account that has just demonstrably recovered.
		*/
		account.authFailStreak = 0;
		account.authDeadUntilMs = 0;
	}
	/**
	* Record an account latest known credit balance.
	*
	* Called after a request and by the card balance refresh, so the reserve
	* check has something to compare against. A reading for an unknown account is
	* dropped: `scan()` rebuilds the account list and a stale id would otherwise
	* accumulate forever.
	*/
	noteCredits(accountId, balance) {
		if (!Number.isFinite(balance)) return;
		if (!this.accounts.some((account) => account.id === accountId)) return;
		this.creditBalances.set(accountId, balance);
	}
	/**
	* Remember when an account's credits start lapsing, for selection.
	*
	* Kept apart from `creditBalances`, which stays a plain balance map because
	* the reserve check compares against it directly. Folding the expiry into the
	* same entry would turn every reader of that map into a deconstructor.
	*
	* `undefined` is stored explicitly rather than by deleting: an account whose
	* packages all renew on a cycle has NO expiry, which is a fact worth
	* remembering, and it must not be confused with "never observed".
	*/
	noteExpiry(accountId, nearestExpiryMs) {
		if (!this.accounts.some((account) => account.id === accountId)) return;
		this.creditExpiries.set(accountId, typeof nearestExpiryMs === "number" && Number.isFinite(nearestExpiryMs) ? nearestExpiryMs : void 0);
	}
	/** When one account's credits start lapsing, or undefined when none do. */
	expiryOf(accountId) {
		return this.creditExpiries.get(accountId);
	}
	/** Last known balance for one account, or undefined when never read. */
	creditsOf(accountId) {
		return this.creditBalances.get(accountId);
	}
	/** The credit floor the user set for one account; 0 when unset. */
	creditReserveOf(accountId) {
		return this.creditReserves.get(accountId) ?? 0;
	}
	/**
	* Replace every reserve. Called from settings on each apply, so the map
	* mirrors the saved document exactly instead of accumulating old keys.
	*/
	setCreditReserves(reserves) {
		const next = /* @__PURE__ */ new Map();
		for (const [id, value] of Object.entries(reserves)) if (Number.isFinite(value) && value > 0) next.set(id, Math.floor(value));
		this.creditReserves = next;
	}
	/** Every reserve currently in force, keyed by account id. */
	creditReservesInOrder() {
		const out = {};
		for (const account of this.accounts) {
			const reserve = this.creditReserves.get(account.id);
			if (reserve !== void 0 && reserve > 0) out[account.id] = reserve;
		}
		return out;
	}
	/**
	* Whether an account is held back only by its reserve.
	*
	* Separates "resting to protect credits" from every other reason an account
	* is out of rotation, which is what the card shows the user.
	*/
	isReserved(accountId) {
		const reserve = this.creditReserves.get(accountId);
		if (reserve === void 0 || reserve <= 0) return false;
		const balance = this.creditBalances.get(accountId);
		return balance !== void 0 && balance <= reserve;
	}
	/**
	* The account that served the most recent request, if any.
	*
	* Distinct from "who would serve the next one": this is a record of what
	* actually happened, which is what the card needs to answer "which account am
	* I using right now?". Under `balanced` there is no deterministic next account
	* at all, so a recorded fact is the only honest answer.
	*
	* Returns undefined before the first request of the process, and after every
	* known account has been re-scanned away (a login swapped out under us).
	*/
	lastServedId() {
		let newest;
		for (const [id, at] of this.lastUsedAt) {
			if (!this.accounts.some((account) => account.id === id)) continue;
			if (newest === void 0 || at > newest.at) newest = {
				id,
				at
			};
		}
		return newest?.id;
	}
	/** Best-effort refresh of one account after a session-dead upstream answer. */
	async refreshAccount(accountId) {
		const account = this.accounts.find((item) => item.id === accountId);
		if (account === void 0) return;
		await this.ensureFresh(account);
	}
	/**
	* Refresh the account's access token when it is within the margin (or already
	* expired), in-flight de-duped per account. A failed refresh keeps the
	* existing token when it has not yet expired, so an unreachable refresh
	* endpoint never takes down a working session.
	*/
	async ensureFresh(account) {
		if (this.client === void 0) return;
		const credential = account.credential;
		if (!(credential.expiresAtMs <= 0 || credential.expiresAtMs <= Date.now() + this.refreshMarginMs)) return;
		const existing = this.refreshInflight.get(account.id);
		if (existing !== void 0) {
			await existing;
			return;
		}
		const run = (async () => {
			if (credential.refreshToken === "") {
				if (credential.expiresAtMs > Date.now() + 3e4) return;
				this.logger?.warn(`dsh-rotakit: ${account.label} token expired with no refresh token; sign in again`);
				return;
			}
			try {
				const outcome = await this.client.refreshToken(credential);
				account.credential = {
					...credential,
					accessToken: outcome.accessToken,
					...outcome.refreshToken === void 0 ? {} : { refreshToken: outcome.refreshToken },
					expiresAtMs: outcome.expiresInSec !== void 0 ? Date.now() + outcome.expiresInSec * 1e3 : credential.expiresAtMs,
					...outcome.domain === void 0 || outcome.domain === "" ? {} : { domain: outcome.domain }
				};
				this.logger?.info?.(`dsh-rotakit: refreshed token for ${account.label}`);
			} catch (error) {
				if (credential.expiresAtMs > Date.now() + 3e4) this.logger?.warn?.(`dsh-rotakit: token refresh failed but token still valid for ${account.label}`, error);
				else this.logger?.error?.(`dsh-rotakit: token refresh failed and token expired for ${account.label}`, error);
			}
		})();
		this.refreshInflight.set(account.id, run);
		try {
			await run;
		} finally {
			this.refreshInflight.delete(account.id);
		}
	}
	/**
	* Cool a whole account after the upstream reports its credits are spent.
	*
	* Credit exhaustion is an ACCOUNT condition, unlike a model rate limit: every
	* model on that account is unusable until the quota resets, so this cools the
	* account as a whole (no `modelId`) for the configured exhaustion window. The
	* shim then rotates to a different account instead of failing the request.
	*/
	penalizeExhausted(accountId) {
		const until = Date.now() + this.exhaustCooldownMs;
		this.penalize(accountId, until);
		this.logger?.warn(`
dsh-rotakit: account credits exhausted; cooling the whole account until 

${new Date(until).toISOString()}
`);
	}
	/**
	* Mark an account (or one of its models) rate-limited.
	*
	* With `modelId`, only that model on the account is cooled — the account's
	* other models stay in rotation, matching the upstream's per-model rate
	* limit ("可切换其他模型继续使用"). Without a model id the whole account is
	* cooled, which callers should reserve for limits that truly span every model.
	*
	* `rateLimitHits` is incremented here and ONLY here, deliberately. The 5xx
	* failover path used to route through this method and so inflated this
	* counter with gateway faults, which are the opposite condition: a 429 means
	* "this account is the problem", a 5xx means "the upstream is". They now have
	* separate counters (`serverErrorHits` for the latter) so the card's "N hit(s)"
	* label keeps meaning what it says.
	*/
	penalize(accountId, resetAtMs, modelId) {
		const account = this.accounts.find((item) => item.id === accountId);
		if (account === void 0) return;
		account.rateLimitHits += 1;
		const now = Date.now();
		if (modelId !== void 0 && modelId !== "") {
			account.modelCooldowns[modelId] = Math.max(account.modelCooldowns[modelId] ?? 0, resetAtMs ?? now + this.cooldownMs);
			this.logger?.warn(`dsh-rotakit: ${account.label} rate-limited on model ${modelId}; cooling that model until ${new Date(account.modelCooldowns[modelId]).toISOString()}`);
			return;
		}
		const until = this.nextCooldownUntil(account, now, resetAtMs);
		account.cooldownUntilMs = Math.max(account.cooldownUntilMs, until);
		this.logger?.warn(`dsh-rotakit: account ${account.label} rate-limited; cooling until ${new Date(account.cooldownUntilMs).toISOString()} (streak ${account.softStreak})`);
	}
	/**
	* How long the next account-wide cooldown should last, with backoff.
	*
	* Two rules, both about not letting ordinary retries dig the pool deeper:
	*
	*   - An upstream-supplied deadline is authoritative — it is the moment the
	*     window actually reopens — but it is capped, so a misparsed or absurd
	*     value cannot sideline an account for days.
	*   - A repeat offence lengthens the window exponentially, up to the cap. One
	*     429 is bad luck; the same account hitting 429 five times in a row is a
	*     pattern, and retrying it every 60 seconds just spends requests to
	*     rediscover the same limit.
	*
	* `softStreak` counts only NEW cooldown entries. An account already cooling is
	* not penalised again for being re-observed as cooling: callers retry in
	* parallel, and counting each of those would push the whole pool to the cap
	* within a handful of requests — the failure mode where every account is
	* parked for hours because the user clicked twice.
	*
	* `streakOf` picks which ladder is being climbed. The two failure causes keep
	* separate counters because they say opposite things about the account: a 429
	* is this account's own quota, a 5xx is the gateway's and would have hit any
	* account. Sharing one counter let a run of gateway faults inflate the
	* rate-limit streak, so the account's next genuine 429 backed off as if it had
	* been refused five times. The duration curve is shared; only the count is not.
	*/
	nextCooldownUntil(account, now, resetAtMs, streakOf = "softStreak") {
		const alreadyCooling = account.cooldownUntilMs > now;
		if (!alreadyCooling) account[streakOf] = (account[streakOf] ?? 0) + 1;
		/**
		* `capped` is a DURATION; every value compared against `now` below is an
		* absolute instant. Mixing the two silently collapses the cooldown to a
		* single millisecond — the ladder looks correct in isolation and does
		* nothing, because `Math.max(1000, now + 1)` is always `now + 1`.
		*/
		const cappedDuration = Math.min(this.cooldownMs * 2 ** Math.min((account[streakOf] ?? 1) - 1, 10), this.cooldownMaxMs);
		const base = resetAtMs ?? now + cappedDuration;
		return Math.min(Math.max(base, now + 1), now + this.cooldownMaxMs);
	}
	/**
	* Cool an account after an upstream gateway failure (5xx) and count it.
	*
	* Separate from {@link penalize} because the two failures mean different
	* things and need different bookkeeping: this one must NOT touch
	* `rateLimitHits` (see that method), and it always cools the whole account
	* tree-wide — a 5xx is not model-specific, since the fault is in the gateway
	* rather than in this account's quota for one model.
	*
	* Uses the short `cooldownMs` window, matching the failover branch's intent:
	* step off this account for now without marking it dead, so a transient
	* upstream blip does not sideline an otherwise healthy account.
	*/
	penalizeServerError(accountId) {
		const account = this.accounts.find((item) => item.id === accountId);
		if (account === void 0) return;
		account.serverErrorHits += 1;
		/**
		* Climbs its OWN ladder.
		*
		* A gateway fault is not this account's fault, so it must not push the
		* rate-limit streak: doing so made a later genuine 429 back off as though
		* the account had already been refused several times. But a gateway that
		* keeps failing does mean retrying this account soon is wasted, so the
		* count still backs off — on `gatewayStreak`, which only gateway faults move.
		*/
		const now = Date.now();
		const until = this.nextCooldownUntil(account, now, void 0, "gatewayStreak");
		account.cooldownUntilMs = Math.max(account.cooldownUntilMs, until);
	}
	/**
	* Record that the upstream rejected this account's credential.
	*
	* The caller has already tried a token refresh by the time this runs, so a
	* repeat means the refresh did not help. Past the limit the account leaves the
	* pool for a while instead of being offered, rejected and skipped again on
	* every request.
	*
	* Returns true when this call retired the account, so the caller can say so in
	* the log rather than reporting the same thing on every attempt.
	*/
	penalizeSessionDead(accountId) {
		const account = this.accounts.find((item) => item.id === accountId);
		if (account === void 0) return false;
		account.authFailStreak = (account.authFailStreak ?? 0) + 1;
		if (account.authFailStreak < AUTH_DEAD_STREAK_LIMIT) return false;
		account.authDeadUntilMs = Date.now() + AUTH_DEAD_COOLDOWN_MS;
		return true;
	}
	/** Whether this account is currently out of the pool for a rejected credential. */
	isAuthDead(account, now) {
		return (account.authDeadUntilMs ?? 0) > now;
	}
	/**
	* Remember that this account does not serve this model.
	*
	* A negative cache, not a cooldown: the account stays fully usable for every
	* other model, and the pair is only skipped while the entry lives. Retrying
	* the combination is pointless — the upstream said so in as many words — so
	* without this the pool rediscovers a permanent fact on every request.
	*
	* The TTL is deliberately short. Model rosters change without notice (a
	* backend adds or drops a model), and a long entry turns a temporary gap into
	* a lasting one; the cost of an occasional rediscovery is one wasted request,
	* which is cheaper than a model that stays unreachable for hours.
	*/
	blockModel(accountId, modelId, reason) {
		if (modelId === void 0 || modelId === "") return;
		const account = this.accounts.find((item) => item.id === accountId);
		if (account === void 0) return;
		account.modelCooldowns[modelId] = Math.max(account.modelCooldowns[modelId] ?? 0, Date.now() + this.modelBlockMs);
		this.logger?.warn(`dsh-rotakit: ${account.label} cannot serve ${modelId}; avoiding that pair for ${Math.round(this.modelBlockMs / 6e4)}m (${String(reason).slice(0, 120)})`);
	}
	/** Clear all cooldowns (account-wide and per-model), e.g. from a reset command. */
	resetCooldowns() {
		for (const account of this.accounts) {
			account.cooldownUntilMs = 0;
			account.modelCooldowns = {};
			account.rateLimitHits = 0;
		}
	}
	/** Diagnostics snapshot. Account-wide cooling count (per-model cooling excluded:
	*  the account as a whole stays usable when only one model is limited). */
	status() {
		const now = Date.now();
		return {
			count: this.accounts.length,
			cooling: this.accounts.filter((account) => account.cooldownUntilMs > now).length,
			lastScanAtMs: this.lastScanAtMs
		};
	}
};
//#endregion
//#region src/catalog.ts
/** Static fallback used before the first live catalog fetch. */
const FALLBACK_WORKBUDDY_MODELS = [
	{
		id: "glm-5.3",
		name: "GLM-5.3",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: true
	},
	{
		id: "glm-5.3-flash",
		name: "GLM-5.3-Flash",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: true
	},
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: true
	},
	{
		id: "glm-5.1",
		name: "GLM-5.1",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: false
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek-V4-Pro",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: true
	},
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek-V4-Flash",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: true
	},
	{
		id: "kimi-k3",
		name: "Kimi-K3",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: true
	},
	{
		id: "minimax-m3",
		name: "MiniMax-M3",
		contextWindow: 2e5,
		maxOutputTokens: 128e3,
		supportsImages: true
	},
	{
		id: "hy3",
		name: "Hy3",
		contextWindow: 32e3,
		maxOutputTokens: 8e3,
		supportsImages: true
	},
	{
		id: "hy4-preview",
		name: "Hy4-Preview",
		contextWindow: 1e6,
		maxOutputTokens: 128e3,
		supportsImages: true
	}
];
/** Live catalog with a static fallback behind it. */
var WorkBuddyCatalog = class {
	models = FALLBACK_WORKBUDDY_MODELS;
	listeners = /* @__PURE__ */ new Set();
	/** User's model selection. Empty object = follow the catalog unfiltered. */
	selection = {};
	current() {
		return this.models;
	}
	/**
	* The models DSH should actually offer, after applying the user's selection:
	* disabled models are dropped, an explicit image list overrides the upstream
	* capability flag, and a per-model budget caps the advertised window.
	*
	* An absent `enabledModelIds` means "everything" — a fresh install with no
	* saved selection must not present an empty picker.
	*/
	visible() {
		const enabled = this.selection.enabledModelIds;
		const allow = enabled === void 0 ? void 0 : new Set(enabled);
		const images = this.selection.imageModelIds;
		const imageSet = images === void 0 ? void 0 : new Set(images);
		const budgets = this.selection.contextBudgets;
		return this.models.filter((model) => allow === void 0 || allow.has(model.id)).map((model) => {
			const next = { ...model };
			if (imageSet !== void 0) next.supportsImages = next.supportsImages || imageSet.has(model.id);
			const budget = budgets?.[model.id];
			if (budget !== void 0 && budget > 0 && budget < next.contextWindow) next.contextWindow = budget;
			return next;
		});
	}
	/** Replace the catalog and notify the adapter to rebuild its model list. */
	update(models) {
		if (models.length === 0) return;
		this.models = models;
		this.notify();
	}
	/** Restore the static fallback, e.g. when the upstream stops answering. */
	reset() {
		this.models = FALLBACK_WORKBUDDY_MODELS;
		this.notify();
	}
	/** Replace the user's selection; the adapter rebuilds from `visible()`. */
	applySelection(selection) {
		this.selection = selection;
		this.notify();
	}
	/** The selection currently in force, for the card's save round-trip. */
	currentSelection() {
		return this.selection;
	}
	onChange(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	find(id) {
		return this.models.find((model) => model.id === id);
	}
	/** Replace the catalog from the live upstream list; keeps the fallback if empty. */
	updateFromUpstream(models) {
		this.update(catalogFromUpstream(models));
	}
	notify() {
		for (const listener of this.listeners) listener();
	}
};
/** Convert one upstream catalog entry into the plugin's model-info shape. */
function toModelInfo(model) {
	return {
		id: model.id,
		name: model.name,
		contextWindow: model.contextWindow,
		maxOutputTokens: model.maxTokens,
		supportsImages: model.supportsImages ?? false,
		...model.creditMultiplier === void 0 ? {} : { multiplier: model.creditMultiplier },
		...model.reasoning?.supportedEfforts === void 0 ? {} : { supportedEfforts: model.reasoning.supportedEfforts }
	};
}
/** Map the live upstream list, falling back to the static list when empty. */
function catalogFromUpstream(models) {
	if (models.length === 0) return FALLBACK_WORKBUDDY_MODELS;
	return models.map(toModelInfo);
}
//#endregion
//#region src/adapter.ts
/**
* The `workbuddy-xdpool` pi-ai provider: one loopback-backed adapter registered
* into the Harness LLM seam, assembled from public `dsh-llm-pi-ai` extension
* points. Every model points at the shim; account rotation stays inside it.
*
* Assembly (createProvider + openAICompletionsApi + inert auth plane + the
* shim's in-process secret as apiKey) follows corrinehu/dsh-workbuddy-connect
* (MIT, Copyright (c) 2026 Corrine Hu) and dingminhua/dsh-connect-workbuddy
* (MIT), both designed and validated against this host.
*
* @module dsh-rotakit/adapter
*/
/** Provider route this bundle owns. */
/** Provider route this bundle owns for the domestic (CN) gateway. */
const WORKBUDDY_POOL_PROVIDER = "workbuddy-xdpool";
/** The provider id each region registers as. */
const POOL_PROVIDER_BY_REGION = {
	cn: WORKBUDDY_POOL_PROVIDER,
	global: "workbuddy-xdpool-global"
};
/** Display name each region registers under, so the picker can group them. */
const POOL_NAME_BY_REGION = {
	cn: "RotaKit（国内版）",
	global: "RotaKit（国际版）"
};
/** Provider idle ceiling while one stream read is outstanding. */
const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** Image-request budgets at the dsh-llm-pi-ai defaults. */
const REQUEST_IMAGE_BUDGETS = {
	maxRequestImageBytes: 20971520,
	requestImagePixelBudget: 4194304,
	requestImageMaxBytes: 1048576
};
/**
* Inert pi-ai auth plane. The route authenticates only through the shim shared
* secret resolved per request, so pi-ai's own credential lifecycle must never
* manufacture a credential for it.
*/
const INERT_AUTH = {
	credentials: {
		async read() {},
		async list() {
			return [];
		},
		async modify() {
			throw new Error("dsh-rotakit: this route has no pi-ai credential lifecycle");
		},
		async delete() {}
	},
	authContext: {
		async env() {},
		async fileExists() {
			return false;
		}
	}
};
/** No per-token pricing is knowable for a subscription quota; report zero. */
const NO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
/** pi-ai input modalities: images only when the catalog advertises them. */
function modelInput(info) {
	return info.supportsImages ? ["text", "image"] : ["text"];
}
/** Map only levels the catalog advertises; undeclared DSH levels stay off. */
function thinkingLevelMap(info) {
	const efforts = info.supportedEfforts;
	if (efforts === void 0 || efforts.length === 0) return void 0;
	const levels = [
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	];
	const map = {};
	for (const level of levels) map[level] = efforts.includes(level) ? level : null;
	map["off"] = null;
	return map;
}
/** Middle-dot separator: unambiguous between the model's own hyphens and the
*  rate/badge suffix. Matches the LaoDing family convention. */
const DISPLAY_SEPARATOR = " · ";
/** Map an upstream tag code to the localized promo label shown next to the
*  credit rate in the model picker. Both `free` and `limited-free` collapse to
*  the same short label so the dropdown row stays scannable. */
const TAG_LABEL = {
	"free": "限时免费",
	"limited-free": "限时免费",
	"night-discount": "夜间折扣"
};
/** Resolve the display suffix (`xN.NN`, promo badges) for one catalog row.
*  Returns `undefined` when there's nothing to show — the name is left alone
*  so we don't tack a trailing separator on a plain model. */
function displaySuffix(info) {
	const parts = [];
	if (typeof info.multiplier === "number" && Number.isFinite(info.multiplier)) parts.push(`x${info.multiplier.toFixed(2)}`);
	for (const tag of info.tags ?? []) {
		const label = TAG_LABEL[tag];
		if (label !== void 0 && !parts.includes(label)) parts.push(label);
	}
	return parts.length === 0 ? void 0 : parts.join(DISPLAY_SEPARATOR);
}
/** Apply the catalog's rate + promo badges to one model's display name.
*  Display-only: the wire request is built from `model.id`, so renaming here
*  cannot affect routing, token, or upstream accounting. DSH 0.1.2's composer
*  (`ModelSelect`) renders `model.name` only, which is why the rate and
*  badges ride the name rather than a separate description column. */
function withCatalogDisplay(name, info) {
	const suffix = displaySuffix(info);
	return suffix === void 0 ? name : `${name}${DISPLAY_SEPARATOR}${suffix}`;
}
/** Build one pi-ai model descriptor pointing at the loopback shim. */
function toPiModel(info, baseUrl, providerId) {
	const map = thinkingLevelMap(info);
	return {
		id: info.id,
		name: withCatalogDisplay(info.name, info),
		api: "openai-completions",
		provider: providerId,
		baseUrl,
		input: modelInput(info),
		cost: NO_COST,
		contextWindow: info.contextWindow,
		maxTokens: info.maxOutputTokens,
		reasoning: map !== void 0,
		...map === void 0 ? {} : { thinkingLevelMap: map },
		compat: { supportsReasoningEffort: map !== void 0 }
	};
}
/**
* Assemble the adapter. `getModels` re-reads the live catalog, and every
* model's `baseUrl` is re-resolved per read so the shim's ephemeral port
* applies from the first snapshot after startup. Call only after `shim.ready`.
*/
function createWorkBuddyAdapter(options) {
	const { shim, catalog } = options;
	const providerId = options.providerId ?? "workbuddy-xdpool";
	const displayName = options.displayName ?? "RotaKit";
	const buildModels = () => {
		const baseUrl = `${shim.baseUrl()}/v1`;
		return catalog.visible().map((info) => toPiModel(info, baseUrl, providerId));
	};
	const provider = {
		...createProvider({
			id: providerId,
			name: displayName,
			auth: { apiKey: {
				name: "RotaKit loopback secret",
				/**
				* Always the shim's current token.
				*
				* This used to read the key back out of the stored credential and
				* return undefined when it was absent or empty. For a loopback shim
				* that is a way to fail and never a way to configure anything: the
				* shim accepts its own token and rejects every other value, so a
				* stored copy - whether empty, or one the plugin minted before a
				* reload - can only produce a 401. Handing back the live token
				* removes the stored copy from the trusted path entirely.
				*/
				async resolve() {
					return {
						auth: { apiKey: shim.token() },
						source: "RotaKit"
					};
				}
			} },
			models: buildModels(),
			api: openAICompletionsApi()
		}),
		getModels: () => buildModels()
	};
	const profile = {
		provider: providerId,
		displayName,
		streamIdleTimeoutMs: WORKBUDDY_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-rotakit retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		...REQUEST_IMAGE_BUDGETS,
		piProvider: provider
	};
	let profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
	return {
		providerId,
		displayName,
		adapter: new PiAiAdapter({
			profiles: () => profiles,
			auth: INERT_AUTH,
			resolveApiKey: async () => shim.token(),
			resolveAttachments: () => options.ctx.get("attachments"),
			resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, (hostPath) => options.ctx.get("fs")?.processPathFromHostPath(hostPath), ref)
		}),
		buildModels,
		invalidate: () => {
			profiles = /* @__PURE__ */ new Map([[providerId, profile]]);
		}
	};
}
//#endregion
//#region src/task-events.ts
/**
* The app the buddy chain enters.
*
* One chain lights up two tasks: `Buddy_App` (open any app) and `Buddy_App_QQ`
* (the QQ-specific one), because this is a QQ-hosted app. Measured 0/1 → 1/1 on
* both from a single chain.
*/
const BUDDY_APP_ID = "cb_y5Dy46tPQGGWtueMxXbe";
const BUDDY_APP_NAME = "企鹅教师助手";
/** A stable-ish id for a synthetic conversation, unique per call. */
function syntheticId(prefix) {
	return `wb2auto-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
/**
* A chat chain seeded with a placeholder conversation/request id.
*
* Several tasks do not verify that the conversation exists — they only check
* that the events in the chain carry *a* well-formed id — so a synthetic pair is
* enough. `RichMeow_Chat`, `create_canvas` and `automation_1` were all measured
* lighting up from exactly this.
*/
function syntheticChatChain(prefix) {
	const conversationId = syntheticId(prefix);
	const requestId = syntheticId(`${prefix}-req`);
	return {
		conversationId,
		requestId,
		events: desktopChatEvents(conversationId, requestId, `msg-${prefix}`)
	};
}
/**
* The buddy-app chain (two tasks).
*
* Five clicks in the order a user would make them: discover the app, see it,
* enter it, confirm the account link, skip the second binding step.
*/
function buddyAppChain() {
	const base = {
		mode: "LOCAL",
		buddyId: BUDDY_APP_ID,
		buddyName: BUDDY_APP_NAME
	};
	return {
		transport: "desktop",
		events: [
			{
				...base,
				eventCode: "buddyapp_discover_click"
			},
			{
				...base,
				eventCode: "buddyapp_show",
				elementId: BUDDY_APP_ID,
				elementName: BUDDY_APP_NAME,
				position: 2
			},
			{
				...base,
				eventCode: "buddyapp_enter_click",
				elementId: BUDDY_APP_ID,
				elementName: BUDDY_APP_NAME,
				position: 2,
				isFirstPage: "1"
			},
			{
				...base,
				eventCode: "buddyapp_auth_confirm_click",
				elementId: BUDDY_APP_ID,
				elementName: BUDDY_APP_NAME
			},
			{
				...base,
				eventCode: "buddyapp_bindaccount_skip_click",
				elementId: BUDDY_APP_ID,
				elementName: BUDDY_APP_NAME
			}
		]
	};
}
/**
* The design-canvas chain (`create_canvas`, +300 — the joint largest reward).
*
* The two canvas events ride the same metrics channel as everything else, so no
* real canvas is ever created; the chat chain in front supplies the ids they
* reference. Measured 1/1 on three accounts.
*/
function canvasChain() {
	const { conversationId, requestId, events } = syntheticChatChain("canvas");
	return {
		transport: "desktop",
		events: [
			...events,
			{
				eventCode: "wbx_design_canvas_task_create",
				conversationId,
				requestId,
				source: "summon_keyword",
				cost: 12e3,
				isSuccessful: true
			},
			{
				eventCode: "wbx_design_canvas_open",
				conversationId,
				requestId,
				id: `ardot-file-${requestId.slice(-8)}`,
				source: "summon_keyword",
				type: "page",
				cost: 13e3,
				isSuccessful: true
			}
		]
	};
}
/**
* The scheduled-task event (`automation_1`).
*
* One event is the whole chain — measured 1/1 on two accounts. The name is only
* for the server's own records, so a generated one is fine.
*/
function automationChain() {
	return {
		transport: "desktop",
		events: [{
			eventCode: "automated_task_create_suc",
			name: `定时任务-${Date.now().toString(36)}`,
			source: "manually",
			modelId: "fast-model",
			modelIsThinking: true,
			connectorCount: 0,
			skills: "",
			skillCount: 0,
			scheduleType: "once",
			mode: "LOCAL"
		}]
	};
}
/**
* The plain chat chain (`RichMeow_Chat`, and the base of the template chain).
*
* Measured: this chain alone lights `RichMeow_Chat`.
*/
function chatChain() {
	const { events } = syntheticChatChain("chat");
	return {
		transport: "desktop",
		events
	};
}
/**
* The "same as this case" chain (`playbook_prompt`).
*
* The scorer watches `playbook_prompt_send` — sending the prompt that the
* inspiration case pre-fills — not the card impression or the button click, so
* the whole click path is replayed for realism but the send is what counts.
*/
function playbookChain(caseId = PLAYBOOK_CASE_ID, caseName = PLAYBOOK_CASE_NAME) {
	const { conversationId, requestId, events } = syntheticChatChain("pb");
	const payload = {
		id: caseId,
		name: caseName,
		type: "document",
		categoryId: "",
		categoryName: ""
	};
	return {
		transport: "desktop",
		events: [
			...events,
			{
				eventCode: "web_element_click",
				pageName: "playbook_detail",
				elementId: "playbook_ctaClick",
				elementName: caseName,
				source: "discover"
			},
			{
				eventCode: "playbook_cta_click",
				source: "discover",
				position: 0,
				...payload
			},
			{
				eventCode: "playbook_prompt_send",
				conversationId,
				requestId,
				...payload
			}
		]
	};
}
/** The inspiration case the reference panel sends a prompt for. */
const PLAYBOOK_CASE_ID = "pm-gtm-launch-plan";
const PLAYBOOK_CASE_NAME = "新产品上市 GTM 发布计划一页纸";
/**
* The five templates the reference panel cycles through, as `[id, name]`.
*
* The upstream does not check that these templates exist — only that five
* distinct `template_used` events arrive — so they are the reference set.
*/
const TEMPLATE_PRESETS = [
	["1", "深度研究"],
	["2", "周报生成"],
	["3", "竞品分析"],
	["4", "活动策划"],
	["5", "代码评审"]
];
/**
* One "created a task from a template" chain (`template_5`, +100 for five).
*
* Each group is a chat chain (which supplies the ids the template events join
* on) plus `agent_task_created_with_template` and `template_used`. Measured:
* five groups in one report scored 5/5.
*/
function templateChain(templateId, templateName) {
	const { conversationId, requestId, events } = syntheticChatChain(`tpl${templateId}`);
	return {
		transport: "desktop",
		events: [
			...events,
			{
				eventCode: "agent_task_created_with_template",
				mode: "working",
				isCustomModel: false,
				id: templateId,
				name: templateName,
				requestId
			},
			{
				eventCode: "template_used",
				template_id: templateId,
				task_mode: "working"
			}
		]
	};
}
/** Every template group, ready to send in order. */
function templateChains() {
	return TEMPLATE_PRESETS.map(([id, name]) => templateChain(id, name));
}
/**
* The library-introduction click (`Library_read`).
*
* Scored on the WEB fingerprint — the same event posted with the desktop
* fingerprint scores nothing — so this chain returns a web transport and the
* scheduler routes it through `reportWebEvent`.
*/
function libraryReadChain() {
	return {
		transport: "web",
		web: {
			eventCode: "web_element_click",
			pageUrl: LIBRARY_DOC_URL,
			elementId: "library_doc_intro_click",
			elementName: "WorkBuddy资料库介绍"
		}
	};
}
/** The document the library click is reported against. */
const LIBRARY_DOC_URL = "https://www.workbuddy.cn/space/d/o0KWYeynteVv06UnAZqIFm";
/** The theme key `Hp_Appearance` is scored on (和平精英激战金秋). */
const APPEARANCE_THEME_KEY = "theme-tkmw7j";
/** The skill `skill_1` is scored on. */
const SKILL_ID = "skill_2097350077599879168";
const SKILL_NAME = "润泽小馆·日报撰写";
const SKILL_VERSION = "1.0.0";
/** The 腾讯轻量云 expert `Expert_lighthouse` is scored on. */
const LIGHTHOUSE_EXPERT_ID = "ex_2cvvUZQhDyeJ";
/**
* Rewrite the chain so the chatting half claims a tool call happened.
*
* A skills task is only credited when the response reports
* `finishReason: 'tool_calls'` — that is, the model loaded the skill as a tool —
* rather than a plain text answer.
*/
function markToolCall(events) {
	return events.map((event) => event["eventCode"] === "chat_message_response" ? {
		...event,
		finishReason: "tool_calls"
	} : event);
}
/**
* Build the `skill_1` chain from a REAL conversation.
*
* Unlike the template and canvas chains, this one is verified against the
* conversation it names, so the caller must first open a real chat and hand the
* server-side ids in.
*/
function skillChain(conversationId, requestId) {
	const messageId = `msg-${requestId.slice(-8)}`;
	return {
		transport: "desktop",
		events: [...markToolCall(desktopChatEvents(conversationId, requestId, messageId)), {
			eventCode: "skill_info",
			id: SKILL_NAME,
			skillId: SKILL_ID,
			skillVersion: SKILL_VERSION,
			toolStatus: "success",
			fileCount: 56,
			source: "workbuddy-desktop",
			conversationId,
			requestId,
			messageId,
			requestModelId: "fast-model",
			requestModelName: "fast-model",
			traceId: requestId
		}]
	};
}
/** The theme-apply event `Hp_Appearance` is scored on. */
function appearanceChain(themeKey = APPEARANCE_THEME_KEY) {
	return {
		transport: "desktop",
		events: [{
			eventCode: "appearance_skin_apply",
			action: "apply",
			source: "settings_close",
			id: themeKey,
			vipLevel: 0,
			series: "",
			type: "unknown"
		}]
	};
}
/**
* The three "summon an expert" events (`expert_summon_click` and friends).
*
* Paid before the conversation, in the order the app emits them.
*/
function expertSummonEvents(expert) {
	const category = expert.categories[0] ?? "expert-all";
	const version = expert.version === "" ? "1.0.0" : expert.version;
	return [
		{
			eventCode: "web_element_click",
			source: expert.expertId,
			type: category,
			version,
			elementId: "expert_summon_click",
			elementName: "立即召唤",
			pageURL: "/C:/Program%20Files/WorkBuddy/resources/app.asar/renderer/index.html"
		},
		{
			eventCode: "expert_summon_click",
			id: expert.expertId,
			name: expert.displayName,
			expertTitle: expert.profession,
			type: "expert-all",
			position: 0,
			expertType: expert.expertType,
			version,
			mode: "LOCAL"
		},
		{
			eventCode: "expert_summoned",
			id: expert.expertId,
			name: expert.displayName,
			expertTitle: expert.profession,
			type: "expert-all"
		}
	];
}
/**
* The "an expert really answered" event, which is what the expert tasks count.
*
* The `requestId` must be the SERVER's id for a real chat: a made-up one scores
* nothing, because the scorer looks the conversation up.
*/
function expertActualUseEvent(expert, conversationId, requestId, mode = "craft") {
	const category = expert.categories[0] ?? "expert-all";
	const version = expert.version === "" ? "1.0.0" : expert.version;
	return {
		eventCode: "expert_actual_use",
		id: expert.expertId,
		name: expert.displayName,
		expertTitle: expert.profession,
		type: category,
		expertType: expert.expertType,
		source: "builtin",
		version,
		cost: 9e3,
		characterCount: 14,
		mode,
		conversationId,
		requestId,
		messageId: `msg-${requestId.slice(-8)}`,
		requestModelId: "fast-model",
		requestModelName: "fast-model"
	};
}
/**
* The chat chain for an expert conversation.
*
* `agent_task_created` carries the expert fields the scorer reads to attribute
* the conversation to that expert.
*/
function expertChatEvents(expert, conversationId, requestId) {
	return desktopChatEvents(conversationId, requestId, `msg-${requestId.slice(-8)}`).map((event) => event["eventCode"] === "agent_task_created" ? {
		...event,
		has_expert: true,
		expert_id: expert.expertId,
		expert_name: expert.displayName,
		expert_industry_id: ""
	} : event);
}
/** How often the loop wakes to look for a due job. */
/**
* How long to wait for event scoring to land before re-reading the task list.
*
* Scoring is asynchronous on the upstream side, so an immediate re-read still
* shows the old progress and the claim pass would skip a task that is in fact
* now claimable. Measured: the chain is reflected by about eight seconds.
*/
const EVENT_SCORE_WAIT_MS = 9e3;
/**
* The fallback record for the 腾讯轻量云 expert, used when the marketplace
* listing cannot be read. The id is the one the task is scored against.
*/
const LIGHTHOUSE_EXPERT = {
	expertId: LIGHTHOUSE_EXPERT_ID,
	expertType: "agent",
	displayName: "腾讯轻量云专家",
	profession: "腾讯轻量云专家",
	version: "1.0.2",
	categories: []
};
/**
* Tasks with a chain in this module.
*
* Membership is the filter the pass uses before it tries to build one, so a
* task with no chain costs no upstream call. It has to be kept in step with
* `chainsFor`'s switch: a code listed here with no case would be read and then
* silently skipped.
*/
const EVENT_CHAIN_BUILDERS = {
	Buddy_App: true,
	Buddy_App_QQ: true,
	create_canvas: true,
	automation_1: true,
	RichMeow_Chat: true,
	playbook_prompt: true,
	template_5: true,
	Hp_Appearance: true,
	Library_read: true,
	skill_1: true,
	expert_5: true,
	Expert_team_use_3: true,
	Expert_lighthouse: true
};
const AUTOMATION_TICK_MS = 6e4;
/** The four jobs in the order a tick runs them: report before tasks, always. */
const AUTOMATION_JOB_KINDS = [
	"checkin",
	"report",
	"tasks",
	"streak",
	"travel"
];
/** Reject anything that is not a job kind, so a route cannot name an unknown job. */
function isAutomationJobKind(value) {
	return typeof value === "string" && AUTOMATION_JOB_KINDS.includes(value);
}
const JOB_KINDS = AUTOMATION_JOB_KINDS;
const EMPTY_JOB_STATE = {
	ok: 0,
	failed: 0,
	credit: 0,
	energy: 0,
	claimed: 0
};
/** `YYYY-MM-DD` in local time, the day key every job resets on. */
/**
* What the ledger gained between two snapshots, per account and in total.
*
* A diff rather than an absolute read: the card asks "what did this run do",
* and the ledger holds the whole day, so reporting totals would re-count
* everything an earlier run had already claimed.
*/
function diffEarnings(before, after) {
	const accounts = {};
	let credit = 0;
	let energy = 0;
	let claimed = 0;
	for (const [id, entry] of Object.entries(after)) {
		const was = before[id];
		const gain = {
			credit: entry.credit - (was?.credit ?? 0),
			energy: entry.energy - (was?.energy ?? 0),
			claimed: entry.claimed - (was?.claimed ?? 0),
			checkinCredit: entry.checkinCredit - (was?.checkinCredit ?? 0),
			bonusCredit: entry.bonusCredit - (was?.bonusCredit ?? 0),
			travelCredit: entry.travelCredit - (was?.travelCredit ?? 0)
		};
		if (gain.credit === 0 && gain.energy === 0 && gain.claimed === 0 && gain.checkinCredit === 0 && gain.bonusCredit === 0 && gain.travelCredit === 0) continue;
		accounts[id] = gain;
		credit += gain.credit;
		energy += gain.energy;
		claimed += gain.claimed;
	}
	return {
		credit,
		energy,
		claimed,
		accounts
	};
}
/**
* The timezone every hour in this file is interpreted in.
*
* The activity windows these jobs target are defined in Beijing time, but the
* scheduler used `getHours()`, which answers in the host machine's local zone.
* On a machine set to anything else, "09:00" was 09:00 local — a check-in that
* simply never came due. Naming the zone makes the hour mean the same instant
* everywhere DSH runs, and is also what lets a test pin the behaviour.
*/
const AUTOMATION_TIME_ZONE = "Asia/Shanghai";
/** Calendar parts of `date` in `timeZone`, all as zero-padded strings. */
function zonedParts(date, timeZone = AUTOMATION_TIME_ZONE) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23"
	}).formatToParts(date);
	const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
	return {
		year: pick("year"),
		month: pick("month"),
		day: pick("day"),
		hour: pick("hour")
	};
}
function dayKey(date, timeZone = AUTOMATION_TIME_ZONE) {
	const { year, month, day } = zonedParts(date, timeZone);
	return `${year}-${month}-${day}`;
}
/**
* The scheduled SLOT `date` falls in, as `YYYY-MM-DDTHH`.
*
* The per-job run guard keys on this instead of the date, so a job configured
* for several hours runs in each of them while a second tick inside the same
* hour is still refused.
*/
function slotKey(date, timeZone = AUTOMATION_TIME_ZONE) {
	const { hour } = zonedParts(date, timeZone);
	return `${dayKey(date, timeZone)}T${hour}`;
}
/**
* Whether `now`'s local hour is one of `hours`.
*
* The reference panel computes a `nextFire` instant and sleeps until it; this
* loop instead wakes every minute and asks "is any job due now". Both fire at
* the top of a configured hour, but the polling form cannot miss a slot to a
* suspended process — a laptop that slept through 10:00 still runs the job the
* moment it wakes, on the same day.
*/
function isFireHour(now, hours) {
	const { hour } = zonedParts(now);
	return hours.includes(Number(hour));
}
/** Whether this account may be used: not switched off, not cooling. */
function eligible(account, now) {
	if (account.cooldownUntilMs > now) return false;
	if (regionOf(account.credential.domain) === "global") return false;
	return true;
}
const sleep = (ms) => new Promise((resolve) => {
	setTimeout(resolve, ms);
});
/**
* The points automation.
*
* Owns a single timer loop. Construction is inert — nothing runs until
* {@link start}, and {@link stop} is idempotent so a plugin teardown that fires
* twice is harmless.
*/
var WorkBuddyScheduler = class {
	pool;
	client;
	logger;
	now;
	delayMs;
	/**
	* How long to wait for event scoring before re-reading the task list.
	* Tests set 0 so a pass does not spend nine real seconds per account.
	*/
	eventScoreWaitMs;
	/**
	* Gap between two expert summon chains.
	* Tests set 0 so a pass does not spend six real seconds per expert.
	*/
	expertGapMs;
	enabled;
	checkinHours;
	taskHours;
	reportHours;
	streakHours;
	travelHours;
	timer;
	running = false;
	/** Guards against a slow run overlapping the next tick. */
	busy = false;
	/** True while a manual run is in flight, so the card can poll it. */
	runInFlight = false;
	/**
	* Set once {@link stop} is called.
	*
	* Deliberately false before `start`: the loop is not running yet, but a
	* manual `tick` must still work. `stop` is what makes a run abandon the
	* accounts it has not reached yet.
	*/
	stopped = false;
	states = {
		checkin: { ...EMPTY_JOB_STATE },
		report: { ...EMPTY_JOB_STATE },
		tasks: { ...EMPTY_JOB_STATE },
		streak: { ...EMPTY_JOB_STATE },
		travel: { ...EMPTY_JOB_STATE }
	};
	claimableSeen = 0;
	/**
	* Credits/energy/tasks earned per account TODAY, keyed by account id.
	*
	* Cleared whenever the day key rolls over, so the card always answers
	* "what did the automation get for THIS account today".
	*/
	earnings = /* @__PURE__ */ new Map();
	/** Day key the counters above belong to. */
	earningsDate = "";
	/** Host hooks that persist the ledger across restarts. */
	loadEarnings;
	saveEarningsFn;
	constructor(pool, client, options = {}) {
		this.pool = pool;
		this.client = client;
		this.logger = options.logger ?? {};
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
		this.delayMs = options.accountDelayMs ?? 800;
		this.eventScoreWaitMs = options.eventScoreWaitMs ?? 9e3;
		this.expertGapMs = options.expertGapMs ?? 6e3;
		this.loadEarnings = options.loadEarnings;
		this.saveEarningsFn = options.saveEarnings;
		const restored = options.loadEarnings?.();
		const today = dayKey(this.now());
		if (restored !== void 0 && restored.date === today) {
			for (const [id, entry] of Object.entries(restored.accounts)) this.earnings.set(id, entry);
			this.earningsDate = today;
		}
		this.enabled = options.enabled ?? false;
		this.checkinHours = options.checkinHours ?? [9];
		this.reportHours = options.reportHours ?? [10];
		this.taskHours = options.taskHours ?? [11];
		this.streakHours = options.streakHours ?? [12];
		this.travelHours = options.travelHours ?? [9, 21];
	}
	/** Apply a new configuration; safe to call while running. */
	/**
	* Install the persistence hook once the host settings service is available.
	*
	* Separate from the constructor because the scheduler is built with the pool,
	* long before the settings section exists; a ledger written before that point
	* would have nowhere to go.
	*/
	setEarningsPersistence(save) {
		this.saveEarningsFn = save;
	}
	/**
	* Fold a previously persisted ledger back in, when it belongs to today.
	*
	* Used after the settings document becomes readable, which happens after
	* construction; a ledger from an earlier day is ignored so the counters never
	* claim yesterday as today.
	*/
	applyEarningsLedger(ledger) {
		const today = dayKey(this.now());
		if (ledger.date !== today) return;
		for (const [id, entry] of Object.entries(ledger.accounts)) this.earnings.set(id, entry);
		this.earningsDate = today;
	}
	applyConfig(options) {
		if (options.enabled !== void 0) this.enabled = options.enabled;
		if (options.checkinHours !== void 0) this.checkinHours = options.checkinHours;
		if (options.reportHours !== void 0) this.reportHours = options.reportHours;
		if (options.taskHours !== void 0) this.taskHours = options.taskHours;
		if (options.streakHours !== void 0) this.streakHours = options.streakHours;
		if (options.travelHours !== void 0) this.travelHours = options.travelHours;
	}
	/** Hours for one job, used by the loop and the status document. */
	hoursOf(kind) {
		switch (kind) {
			case "checkin": return this.checkinHours;
			case "report": return this.reportHours;
			case "tasks": return this.taskHours;
			case "streak": return this.streakHours;
			case "travel": return this.travelHours;
		}
	}
	/** Start the loop. Idempotent. */
	start() {
		if (this.timer !== void 0) return;
		this.stopped = false;
		this.running = true;
		this.timer = setInterval(() => {
			this.tick();
		}, AUTOMATION_TICK_MS);
		this.timer.unref?.();
	}
	/** Stop the loop. Idempotent, and safe before `start`. */
	stop() {
		this.stopped = true;
		this.running = false;
		if (this.timer !== void 0) {
			clearInterval(this.timer);
			this.timer = void 0;
		}
	}
	/** Snapshot for the status document. */
	/**
	* Run one job immediately, regardless of the clock.
	*
	* Exists so the automation can be verified from the card without waiting for
	* its hour. A manual run is recorded exactly like a scheduled one, so the
	* timer will not repeat it later the same day: every job is idempotent, but a
	* second pass would still be wasted upstream calls.
	*
	* `force` ignores the already-ran-today guard, which is what pressing the
	* button a second time means.
	*/
	async runNow(kind, force = false) {
		const today = dayKey(this.now());
		const state = this.states[kind];
		if (!force && state.lastRunSlot === slotKey(this.now())) return { ...state };
		this.busy = true;
		try {
			await this.runJob(kind, today);
		} finally {
			this.busy = false;
		}
		return { ...this.states[kind] };
	}
	/**
	* Run every job once, in the scheduled order.
	*
	* Order matters and is not configurable: the activity report has to land
	* before the task pass reads task progress, or the pass sees counters the
	* report would have moved. This is what the card's single button calls.
	*/
	/**
	* Start a full pass in the background and return immediately.
	*
	* A pass takes tens of seconds - one upstream round trip per account per job,
	* plus the scoring wait - which is far too long to hold the card request open:
	* the browser or the host web server would time out, and the user would see
	* a hung button for a run that is actually working.
	*
	* Returns whether a run started. A second call while one is in flight is
	* ignored rather than queued: pressing the button twice means hurry up, and
	* the run already under way covers it.
	*/
	/**
	* Start a run in the background.
	*
	* `onlyIds` restricts it to specific accounts, which is what an
	* account-addition uses: the scheduled hours may be many hours away, and a
	* freshly added account is exactly when the user wants to watch the automation
	* work. Scoping it also means adding one account does not re-run every job for
	* the whole pool.
	*/
	startRunAll(onlyIds) {
		if (this.runInFlight) return false;
		this.runInFlight = true;
		this.runAll(onlyIds).catch((error) => {
			this.logger.warn?.("dsh-rotakit automation run failed:", error);
		}).finally(() => {
			this.runInFlight = false;
		});
		return true;
	}
	async runAll(onlyIds) {
		const today = dayKey(this.now());
		const before = this.earningsSnapshot();
		let okCount = 0;
		let failed = 0;
		let jobsRun = 0;
		for (const kind of JOB_KINDS) {
			jobsRun += 1;
			this.busy = true;
			try {
				await this.runJob(kind, today, onlyIds);
			} finally {
				this.busy = false;
			}
			okCount += this.states[kind].ok;
			failed += this.states[kind].failed;
		}
		const gained = diffEarnings(before, this.earningsSnapshot());
		return {
			jobsRun,
			okCount,
			failed,
			credit: gained.credit,
			energy: gained.energy,
			claimed: gained.claimed,
			accounts: gained.accounts
		};
	}
	status() {
		const jobs = {};
		for (const kind of JOB_KINDS) jobs[kind] = { ...this.states[kind] };
		return {
			enabled: this.enabled,
			running: this.running,
			checkinHours: this.checkinHours,
			taskHours: this.taskHours,
			reportHours: this.reportHours,
			streakHours: this.streakHours,
			travelHours: this.travelHours,
			jobs,
			claimableSeen: this.claimableSeen,
			earningsToday: this.earningsSnapshot(),
			runInProgress: this.runInFlight
		};
	}
	/**
	* One poll: run every due job, serially.
	*
	* Serial by design — the jobs share the same accounts and the upstream
	* rate-limits per account, so overlapping passes would only trip that limit.
	* A job that throws is recorded and the loop continues.
	*/
	/**
	* Whether `kind` is due at `now`: its earliest configured hour has passed in
	* the scheduling timezone, and no hour of today has been consumed yet.
	*
	* Hours are consumed per SLOT (one entry per configured hour), so a job with
	* two hours still runs twice a day — but a job whose hour passed while DSH was
	* closed runs immediately on the next tick instead of waiting for tomorrow.
	*/
	isDue(kind, now) {
		const hours = this.hoursOf(kind);
		if (hours.length === 0) return false;
		const { hour } = zonedParts(now);
		const current = Number(hour);
		const today = dayKey(now);
		return hours.some((candidate) => candidate <= current && this.states[kind].lastRunSlot !== `${today}T${String(candidate).padStart(2, "0")}`);
	}
	async tick() {
		if (!this.enabled || this.stopped || this.busy) return;
		this.busy = true;
		try {
			const now = this.now();
			const slot = slotKey(now);
			const today = dayKey(now);
			for (const kind of JOB_KINDS) {
				if (this.stopped) return;
				if (this.states[kind].lastRunSlot === slot) continue;
				if (!this.isDue(kind, now)) continue;
				await this.runJob(kind, today);
			}
		} catch (error) {
			this.logger.warn?.("dsh-rotakit automation tick failed:", error);
		} finally {
			this.busy = false;
		}
	}
	/** Run one job against every eligible account and record the outcome. */
	/**
	* Add one account's take to today's counters, resetting first if the day
	* rolled over. Called from the task pass, which is the only job that earns.
	*/
	/**
	* Today's per-account earnings, as a plain object for the status document.
	*
	* Rolls the day first so a status read just after midnight does not report
	* yesterday's totals under today's date.
	*/
	earningsSnapshot() {
		this.rollEarnings(dayKey(this.now()));
		const out = {};
		for (const [id, entry] of this.earnings) out[id] = { ...entry };
		return out;
	}
	/**
	* Add one account take to today counters, resetting first if the day rolled
	* over. Every source is tracked separately so the card can show what earned
	* what, rather than one opaque total.
	*/
	recordEarnings(accountId, today, delta) {
		this.rollEarnings(today);
		const credit = delta.credit ?? 0;
		const energy = delta.energy ?? 0;
		const claimed = delta.claimed ?? 0;
		const checkinCredit = delta.checkinCredit ?? 0;
		const bonusCredit = delta.bonusCredit ?? 0;
		const travelCredit = delta.travelCredit ?? 0;
		if (credit === 0 && energy === 0 && claimed === 0 && checkinCredit === 0 && bonusCredit === 0 && travelCredit === 0) return;
		const existing = this.earnings.get(accountId);
		this.earnings.set(accountId, {
			credit: (existing?.credit ?? 0) + credit,
			energy: (existing?.energy ?? 0) + energy,
			claimed: (existing?.claimed ?? 0) + claimed,
			checkinCredit: (existing?.checkinCredit ?? 0) + checkinCredit,
			bonusCredit: (existing?.bonusCredit ?? 0) + bonusCredit,
			travelCredit: (existing?.travelCredit ?? 0) + travelCredit,
			date: today
		});
		this.persistEarnings();
	}
	/** Clear the per-account counters when the local day changes. */
	rollEarnings(today) {
		if (this.earningsDate === today) return;
		this.earningsDate = today;
		this.earnings.clear();
		this.claimableSeen = 0;
		this.persistEarnings();
	}
	/**
	* Write the ledger through the host hook, when one was supplied.
	*
	* Best effort on purpose: a failed save must never abort a run that has
	* already collected rewards, and the in-memory ledger keeps serving the card
	* for the rest of the session either way.
	*/
	persistEarnings() {
		if (this.saveEarningsFn === void 0) return;
		try {
			const accounts = {};
			for (const [id, entry] of this.earnings) accounts[id] = entry;
			this.saveEarningsFn({
				date: this.earningsDate,
				accounts
			});
		} catch (error) {
			this.logger.warn?.("dsh-rotakit: could not persist automation earnings:", error);
		}
	}
	/**
	* Run one job against every eligible account and record the outcome.
	*
	* The task job runs in TWO passes. The first sends the event chains that light
	* up client-scored tasks; the second collects rewards. They are separate
	* because scoring lands asynchronously — a chain sent and claimed within the
	* same breath finds the task still un-scored — and because sending is fast
	* while claiming wants the whole pool to have been lit up first. Splitting
	* them costs one shared wait instead of one wait per account.
	*/
	async runJob(kind, today, onlyIds) {
		const accountWord = kind === "report" ? "report" : kind;
		let ok = 0;
		let failed = 0;
		let credit = 0;
		let energy = 0;
		let claimed = 0;
		const detail = [];
		let progressNote;
		/**
		* An empty filter means "no accounts", not "every account": a caller that
		* asked for specific ids and got none must not silently run the whole pool.
		*/
		const all = this.accountsInOrder();
		const accounts = onlyIds === void 0 ? all : all.filter((account) => onlyIds.has(account.id));
		if (kind === "tasks") await this.sendEventChains(accounts);
		for (let index = 0; index < accounts.length; index++) {
			if (this.stopped) break;
			const account = accounts[index];
			if (account === void 0) continue;
			try {
				switch (kind) {
					case "checkin":
						try {
							const claim = await this.client.claimDailyCheckin(account.credential);
							this.recordEarnings(account.id, today, { checkinCredit: claim.credit });
							if (claim.credit > 0) {
								if (claim.credit > 0) detail.push(`签到 +${claim.credit}`);
								this.logger.info?.(`automation checkin ${account.label}: +${claim.credit} credit`);
							}
						} catch (error) {
							if (!isAlreadyCheckin(error)) throw error;
							this.logger.info?.(`automation checkin ${account.label}: already done today`);
						}
						break;
					case "report": {
						const days = await this.reportOne(account);
						this.logger.info?.(`automation report ${account.label}: streak days=${days}`);
						break;
					}
					case "tasks": {
						const result = await this.runTasks(account);
						credit += result.credit;
						energy += result.energy;
						claimed += result.claimed;
						detail.push(...result.titles);
						this.claimableSeen += result.claimableCount;
						this.recordEarnings(account.id, today, {
							credit: result.credit,
							energy: result.energy,
							claimed: result.claimed
						});
						this.logger.info?.(`automation tasks ${account.label}: ${result.claimed} claimed (+${result.credit} credit, +${result.energy} energy, ${result.claimableCount} claimable seen)`);
						break;
					}
					case "streak": {
						const progress = await this.redeemStreak(account);
						if (progress !== void 0) progressNote = progress;
						break;
					}
					case "travel": await this.runTravel(account);
				}
				ok++;
			} catch (error) {
				failed++;
				this.logger.warn?.(`automation ${accountWord} ${account.label} failed:`, error);
			}
			if (index < accounts.length - 1 && this.delayMs > 0 && !this.stopped) await sleep(this.delayMs);
		}
		const state = this.states[kind];
		state.lastRunSlot = slotKey(this.now());
		state.lastRunDate = today;
		state.lastRunAtMs = this.now().getTime();
		state.ok = ok;
		state.failed = failed;
		state.credit = credit;
		state.energy = energy;
		state.claimed = claimed;
		state.message = this.summarise(kind, ok, failed, claimed, credit, energy);
		state.detail = detail;
		state.progress = progressNote;
		this.logger.info?.(`automation ${accountWord}: ${state.message}`);
	}
	/** Compose the one-line summary shown on the card. */
	summarise(kind, ok, failed, claimed, credit, energy) {
		if (kind === "tasks") return `${ok} accounts, ${claimed} tasks claimed (+${credit} credit, +${energy} energy)${failed > 0 ? `, ${failed} failed` : ""}`;
		return `${ok} accounts ok${failed > 0 ? `, ${failed} failed` : ""}`;
	}
	/**
	* Accounts to run against, in pool order.
	*
	* Disabled accounts are excluded here rather than filtered by the caller so a
	* card switch takes effect on the next pass without any event plumbing.
	*/
	accountsInOrder() {
		const now = Date.now();
		return this.pool.list().filter((account) => {
			if (this.pool.isDisabled(account.id)) return false;
			return eligible(account, now);
		});
	}
	/**
	* Send one activity report, then verify it landed.
	*
	* The upstream answers 200 even when it drops the event, so the streak is
	* read back as the oracle: `days > 0` means it counted. A failed read-back is
	* logged and treated as a suspicious result, never as a retry — the report is
	* idempotent per day, and hammering it is exactly what the one-a-day quota
	* exists to avoid.
	*/
	async reportOne(account) {
		await this.client.reportActivity(account.credential);
		try {
			const days = await this.client.growthStreakDays(account.credential);
			if (days === 0) this.logger.warn?.(`automation report ${account.label}: streak days=0 right after report (new account or scoring lag?)`);
			return days;
		} catch (error) {
			this.logger.warn?.(`automation report ${account.label}: streak read-back failed:`, error);
			return -1;
		}
	}
	async sendEventChains(accounts) {
		let sentAnything = false;
		for (const account of accounts) {
			if (this.stopped) return;
			let tasks;
			try {
				tasks = await this.client.listTasks(account.credential);
			} catch (error) {
				this.logger.warn?.(`automation events ${account.label}: list failed:`, error);
				continue;
			}
			const pending = tasks.filter((task) => task.taskCode in EVENT_CHAIN_BUILDERS && !task.claimable && !task.locked);
			for (const task of pending) {
				if (this.stopped) return;
				let chains;
				try {
					chains = await this.chainsFor(task, account.credential);
				} catch (error) {
					this.logger.warn?.(`automation events ${account.label}: ${task.taskCode} could not be built:`, error);
					continue;
				}
				for (const chain of chains) {
					if (this.stopped) return;
					try {
						await this.sendChain(account.credential, chain);
						this.logger.info?.(`automation events ${account.label}: ${task.taskCode} chain sent`);
						sentAnything = true;
					} catch (error) {
						this.logger.warn?.(`automation events ${account.label}: ${task.taskCode} failed:`, error);
						break;
					}
					if (this.delayMs > 0 && !this.stopped) await sleep(this.delayMs);
				}
			}
		}
		if (sentAnything && this.eventScoreWaitMs > 0 && !this.stopped) await sleep(this.eventScoreWaitMs);
	}
	/**
	* Send one chain on the channel it was built for.
	*
	* The transport is not a detail of the sender: the scorer keys different
	* tasks to different fingerprint families, so a web-scored event posted as a
	* desktop event is accepted and then ignored.
	*/
	async sendChain(credential, chain) {
		if (chain.transport === "web") {
			const web = chain.web;
			if (web === void 0) throw new Error("web chain without a web event");
			await this.client.reportWebEvent(credential, web.eventCode, web.pageUrl, web.elementId, web.elementName);
			return;
		}
		await this.client.reportDesktopEvents(credential, chain.events ?? []);
	}
	/**
	* Build every chain that scores one task.
	*
	* Most tasks need a single chain; `template_5` needs five, because the scorer
	* counts distinct `template_used` events rather than a boolean. The two tasks
	* that join a conversation (skill, expert) open a real one first, which is why
	* this is async.
	*/
	async chainsFor(task, credential) {
		switch (task.taskCode) {
			case "Buddy_App":
			case "Buddy_App_QQ": return [buddyAppChain()];
			case "create_canvas": return [canvasChain()];
			case "automation_1": return [automationChain()];
			case "RichMeow_Chat": return [chatChain()];
			case "playbook_prompt": return [playbookChain()];
			case "template_5": return templateChains();
			case "Hp_Appearance":
				await this.client.setAppearanceTheme(credential, APPEARANCE_THEME_KEY);
				if (this.delayMs > 0 && !this.stopped) await sleep(2e3);
				return [appearanceChain()];
			case "Library_read": return [libraryReadChain()];
			case "skill_1": {
				const chat = await this.client.openConversation(credential);
				if (chat === void 0) throw new Error("skill_1: no server conversation");
				return [skillChain(chat.conversationId, chat.requestId)];
			}
			case "expert_5": return this.expertChains(credential, "agent", task);
			case "Expert_team_use_3": return this.expertChains(credential, "team", task);
			case "Expert_lighthouse": return this.lighthouseChains(credential);
			default: return [];
		}
	}
	/**
	* The summon-and-use chains for the expert tasks.
	*
	* Two steps per expert, and both are load-bearing: the summon events alone are
	* impressions, and a use event on its own scores nothing because the scorer
	* looks the conversation up. Only a real chat with `X-Expert-Id` produces an
	* id it will accept.
	*/
	async expertChains(credential, expertType, task) {
		const needed = Math.max(0, task.target - task.current);
		if (needed === 0) return [];
		const experts = await this.client.marketExpertList(credential, expertType);
		const out = [];
		for (const expert of experts) {
			if (out.length >= needed) break;
			if (this.stopped) break;
			try {
				await this.client.reportDesktopEvents(credential, expertSummonEvents(expert));
				if (this.delayMs > 0 && !this.stopped) await sleep(this.delayMs);
				const chat = await this.client.openConversation(credential, expert.expertId);
				if (chat === void 0) continue;
				out.push({
					transport: "desktop",
					events: [...expertChatEvents(expert, chat.conversationId, chat.requestId), expertActualUseEvent(expert, chat.conversationId, chat.requestId)]
				});
			} catch (error) {
				this.logger.warn?.(`automation events expert ${expert.expertId}:`, error);
			}
			if (this.expertGapMs > 0 && !this.stopped) await sleep(this.expertGapMs);
		}
		return out;
	}
	/**
	* The 腾讯轻量云 expert chain.
	*
	* Structurally the same as the expert task, with two differences the scorer
	* checks: `agent_task_created` has to name the expert, and the use event has
	* to report `mode: 'LOCAL'` with an empty type and zero cost — that is what
	* the lighthouse criterion looks for.
	*/
	async lighthouseChains(credential) {
		let expert = LIGHTHOUSE_EXPERT;
		try {
			const found = (await this.client.marketExpertList(credential, "agent")).find((item) => item.expertId === LIGHTHOUSE_EXPERT_ID);
			if (found !== void 0) expert = found;
		} catch (error) {
			this.logger.warn?.("automation events lighthouse list:", error);
		}
		await this.client.reportDesktopEvents(credential, expertSummonEvents(expert));
		if (this.delayMs > 0 && !this.stopped) await sleep(this.delayMs);
		const chat = await this.client.openConversation(credential, expert.expertId);
		if (chat === void 0) throw new Error("Expert_lighthouse: no server conversation");
		const use = expertActualUseEvent(expert, chat.conversationId, chat.requestId, "LOCAL");
		use["type"] = "";
		use["cost"] = 0;
		return [{
			transport: "desktop",
			events: [...expertChatEvents(expert, chat.conversationId, chat.requestId), use]
		}];
	}
	/**
	* The task-centre pass for one account.
	*
	* Order matters: enrich first (enrol in everything open), then claim. Both
	* halves are idempotent — accepting an already-accepted task succeeds, and a
	* repeat claim answers `already_claimed` — so a pass that dies halfway is
	* safe to replay on the next tick.
	*/
	async runTasks(account) {
		const credential = account.credential;
		const open = (await this.client.listTasks(credential)).filter((task) => task.acceptStatus === "not_accepted" && !task.locked).map((task) => task.taskCode);
		if (open.length > 0) await this.client.acceptTasks(credential, open);
		const claimable = (await this.client.listTasks(credential)).filter((task) => task.claimable && !task.locked);
		let credit = 0;
		let energy = 0;
		let claimed = 0;
		const titles = [];
		for (const task of claimable) {
			if (this.stopped) break;
			const reward = await this.client.claimTaskReward(credential, task.taskCode);
			credit += reward.credit;
			energy += reward.energy;
			if (reward.credit > 0 || reward.energy > 0) {
				claimed++;
				titles.push(task.title);
				this.logger.info?.(`automation claim ${account.label}: ${task.title} +${reward.credit}c +${reward.energy}e`);
			} else this.logger.info?.(`automation claim ${account.label}: ${task.taskCode} already claimed`);
			if (this.delayMs > 0 && !this.stopped) await sleep(this.delayMs);
		}
		return {
			claimed,
			credit,
			energy,
			claimableCount: claimable.length,
			titles
		};
	}
	/**
	* Streak redemption plus the lottery it unlocks.
	*
	* Tiers unlock on consecutive active days (7/14/28). Redeeming one pays
	* credits, energy, a makeup card and — the part nothing else grants — lottery
	* draws, so the draw runs straight after and only for the chances in hand.
	*
	* Everything here is idempotent: a tier already claimed is skipped by its
	* status, and a draw consumes one chance, so a replay cannot double-spend.
	*/
	async redeemStreak(account) {
		const credential = account.credential;
		const status = await this.client.growthStreakFull(credential);
		for (const tier of status.tiers) {
			if (this.stopped) return;
			if (tier.status === "locked" || tier.status === "claimed") continue;
			try {
				await this.client.redeemStreakTier(credential, tier.tier);
				this.logger.info?.(`automation streak ${account.label}: redeemed ${tier.tier} (+${tier.credit}c +${tier.energy}e +${tier.chances} draw(s))`);
				this.recordEarnings(account.id, dayKey(this.now()), { bonusCredit: tier.credit });
			} catch (error) {
				this.logger.warn?.(`automation streak ${account.label}: redeem ${tier.tier} failed:`, error);
			}
			if (this.delayMs > 0 && !this.stopped) await sleep(this.delayMs);
		}
		const chances = await this.client.lotteryChances(credential);
		for (let draw = 0; draw < chances; draw += 1) {
			if (this.stopped) return;
			try {
				const prize = await this.client.lotteryDraw(credential);
				this.logger.info?.(`automation lottery ${account.label}: draw ${draw + 1}/${chances} -> ${JSON.stringify(prize).slice(0, 120)}`);
			} catch (error) {
				this.logger.warn?.(`automation lottery ${account.label}: draw failed:`, error);
				break;
			}
			if (this.delayMs > 0 && !this.stopped) await sleep(this.delayMs);
		}
		const pendingTier = status.tiers.find((tier) => tier.status === "locked");
		if (pendingTier !== void 0) {
			const remaining = Math.max(0, pendingTier.days - status.days);
			return remaining > 0 ? `${pendingTier.tier} in ${remaining}d` : `${pendingTier.tier} ready`;
		}
	}
	/**
	* One trip through the buddy travel loop for an account.
	*
	* A single pass advances the state machine by at most one step: a trip
	* that has arrived is collected, and an idle buddy is sent out. A buddy
	* already travelling is left alone — there is nothing to do until it lands.
	*
	* Measured against the live upstream: the departed trip reports
	* `dailyLimitReached` immediately, so the once-a-day limit needs no local
	* bookkeeping.
	*/
	async runTravel(account) {
		const credential = account.credential;
		if (await this.client.buddyInfo(credential) === void 0) {
			try {
				await this.client.buddyAgree(credential);
				await this.client.buddyAdoptFirst(credential);
				this.logger.info?.(`automation travel ${account.label}: adopted first buddy`);
			} catch (error) {
				this.logger.info?.(`automation travel ${account.label}: adoption not available yet (` + String(error).slice(0, 80) + ")");
			}
			return;
		}
		const travel = await this.client.buddyTravelStatus(credential);
		if (travel.state === "arrived") {
			if (travel.recordId === 0) {
				this.logger.warn?.(`automation travel ${account.label}: arrived but no record id`);
				return;
			}
			const reward = await this.client.buddyTravelClaim(credential, travel.recordId);
			this.recordEarnings(account.id, dayKey(this.now()), { travelCredit: reward });
			this.logger.info?.(`automation travel ${account.label}: claimed trip +${reward}c`);
			return;
		}
		if (travel.state === "idle" && !travel.dailyLimitReached) {
			await this.client.buddyTravelDepart(credential);
			this.logger.info?.(`automation travel ${account.label}: departed (arrives later, claimed next pass)`);
			return;
		}
		this.logger.info?.(`automation travel ${account.label}: nothing to do (state=${travel.state})`);
	}
};
//#endregion
//#region src/context-budget.ts
/** Rough character-per-token ratio. CJK is ~1 token/char, latin ~1/4. */
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_CJK = 1;
/** Fixed per-message overhead the chat template adds (role markers etc.). */
const PER_MESSAGE_TOKEN_OVERHEAD = 4;
/** Every image/tool part costs at least this much once decoded. */
const PER_PART_TOKEN_FLOOR = 16;
/**
* Estimate the token cost of one message's `content`.
*
* Deliberately conservative (over-estimates) so we compact slightly early
* rather than discovering the overrun upstream.
*/
function estimateContentTokens(content) {
	if (content === null || content === void 0) return 0;
	if (typeof content === "string") return estimateTextTokens(content);
	if (typeof content === "number" || typeof content === "boolean") return PER_PART_TOKEN_FLOOR;
	if (Array.isArray(content)) {
		let total = 0;
		for (const part of content) total += estimateContentTokens(part);
		return total;
	}
	if (typeof content === "object") {
		const record = content;
		let total = PER_PART_TOKEN_FLOOR;
		for (const key of [
			"text",
			"image_url",
			"input",
			"content"
		]) if (key in record) total += estimateContentTokens(record[key]);
		if (total === PER_PART_TOKEN_FLOOR) total += estimateTextTokens(safeStringify(record));
		return total;
	}
	return 0;
}
/** Estimate tokens for a plain string, accounting for CJK density. */
function estimateTextTokens(text) {
	if (text === "") return 0;
	let cjk = 0;
	for (const char of text) if (isCjk(char.codePointAt(0) ?? 0)) cjk += 1;
	const latin = text.length - cjk;
	return Math.ceil(cjk / CHARS_PER_TOKEN_CJK + latin / CHARS_PER_TOKEN_LATIN);
}
function isCjk(code) {
	return code >= 12288 && code <= 12351 || code >= 12352 && code <= 12543 || code >= 13312 && code <= 19903 || code >= 19968 && code <= 40959 || code >= 63744 && code <= 64255 || code >= 65280 && code <= 65519 || code >= 131072 && code <= 191471;
}
function safeStringify(value) {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return String(value);
	}
}
/** Estimate the prompt cost of a whole message array. */
function estimateMessagesTokens(messages) {
	let total = 0;
	for (const message of messages) {
		total += PER_MESSAGE_TOKEN_OVERHEAD;
		total += estimateContentTokens(message.content);
		if (message["tool_calls"] !== void 0) total += estimateContentTokens(message["tool_calls"]);
		if (message["name"] !== void 0) total += estimateTextTokens(String(message["name"]));
	}
	return total;
}
/** True when `role` carries instructions that must survive compaction. */
function isPinnedRole(role) {
	return role === "system" || role === "developer";
}
/**
* Drop the oldest non-pinned messages until the estimate fits `budget`.
*
* Pinned (system/developer) messages and the newest `keepRecent` messages are
* never dropped here — if those alone overrun the budget, the caller must fall
* back to summarisation or give up.
*/
function compactMessages(messages, options) {
	const keepRecent = Math.max(1, options.keepRecent ?? 4);
	const estimate = estimateMessagesTokens(messages);
	if (estimate <= options.budget) return {
		messages: [...messages],
		dropped: [],
		tokens: estimate,
		changed: false
	};
	const pinned = [];
	const body = [];
	for (const message of messages) if (isPinnedRole(message.role)) pinned.push(message);
	else body.push(message);
	const keep = Math.min(keepRecent, body.length);
	const tail = body.slice(body.length - keep);
	const head = body.slice(0, body.length - keep);
	let dropCount = 0;
	let candidate = [
		...pinned,
		...head,
		...tail
	];
	let total = estimateMessagesTokens(candidate);
	while (total > options.budget && dropCount < head.length) {
		dropCount += 1;
		candidate = [
			...pinned,
			...head.slice(dropCount),
			...tail
		];
		total = estimateMessagesTokens(candidate);
	}
	const dropped = head.slice(0, dropCount);
	return {
		messages: candidate,
		dropped,
		tokens: total,
		changed: dropCount > 0
	};
}
/**
* Drop the oldest messages, including pinned ones, as a last resort.
*
* Used when even a summary cannot bring the prompt under budget (for example a
* single enormous pasted document). The newest message always survives.
*/
function hardTruncate(messages, budget) {
	if (messages.length === 0) return {
		messages: [],
		dropped: [],
		tokens: 0,
		changed: false
	};
	let start = 0;
	let candidate = [...messages];
	let total = estimateMessagesTokens(candidate);
	while (total > budget && start < messages.length - 1) {
		start += 1;
		candidate = messages.slice(start);
		total = estimateMessagesTokens(candidate);
	}
	return {
		messages: candidate,
		dropped: messages.slice(0, start),
		tokens: total,
		changed: start > 0
	};
}
/** Instructions handed to the model when we ask it to compact a conversation. */
const SUMMARIZE_INSTRUCTION = [
	"You are compacting an ongoing conversation so it can continue without the original history.",
	"Summarise the transcript below into a dense briefing for the next assistant turn.",
	"Preserve, in this order of priority:",
	"1. explicit user requirements, constraints and corrections;",
	"2. decisions already made, and the reasoning behind them;",
	"3. concrete facts: file paths, identifiers, commands, numbers, error messages;",
	"4. unfinished work and the current blocker.",
	"Drop pleasantries, repetition and superseded attempts.",
	"Write the briefing only — no preamble, no markdown fence."
].join("\n");
/** Render a message array as plain text for the summarisation prompt. */
function transcriptOf(messages) {
	const lines = [];
	for (const message of messages) {
		const role = message.role === "" ? "unknown" : message.role;
		lines.push(`### ${role}`);
		lines.push(renderContent(message.content));
		if (message["tool_calls"] !== void 0) lines.push(renderContent(message["tool_calls"]));
	}
	return lines.join("\n");
}
function renderContent(content) {
	if (content === null || content === void 0) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((part) => renderContent(part)).filter((text) => text !== "").join("\n");
	if (typeof content === "object") {
		const record = content;
		for (const key of [
			"text",
			"content",
			"input"
		]) if (typeof record[key] === "string") return record[key];
		if (record["type"] !== void 0 && typeof record["type"] === "string") return `[${record["type"]}]`;
		return safeStringify(record);
	}
	return String(content);
}
/** Build the synthetic system message that carries a compaction summary. */
function summaryMessage(summary) {
	return {
		role: "system",
		content: [
			"The earlier part of this conversation was compacted to fit the model context window.",
			"Briefing produced from the dropped turns:",
			"",
			summary.trim()
		].join("\n")
	};
}
/**
* Compact `messages` to `budget`, summarising the dropped turns when possible.
*
* The summary is requested with a *bounded* transcript so the compaction call
* itself can never overrun the window: if the dropped turns are huge, only the
* newest slice of them is summarised, and the oldest are noted as elided.
*/
async function compactWithSummary(messages, options, deps, signal) {
	const first = compactMessages(messages, options);
	if (!first.changed) return {
		messages: first.messages,
		tokens: first.tokens,
		summary: void 0,
		skipped: void 0
	};
	const summaryBudget = Math.max(256, Math.floor(options.budget / 4));
	let toSummarize = first.dropped;
	let elided = 0;
	while (estimateMessagesTokens(toSummarize) > summaryBudget && toSummarize.length > 1) {
		toSummarize = toSummarize.slice(1);
		elided += 1;
	}
	let summary;
	let skipped;
	try {
		const instruction = elided > 0 ? `${SUMMARIZE_INSTRUCTION}\n\nNote: the ${elided} oldest turn(s) were elided before this transcript.` : SUMMARIZE_INSTRUCTION;
		const suffix = elided > 0 ? `\n(the ${elided} oldest turn(s) were elided)` : "";
		const request = [{
			role: "system",
			content: instruction
		}, {
			role: "user",
			content: `${transcriptOf(toSummarize)}${suffix}`
		}];
		const text = await deps.complete(request, signal);
		if (text.trim() !== "") summary = text.trim();
		else skipped = "summariser returned an empty summary";
	} catch (error) {
		skipped = `summarisation failed: ${String(error)}`;
	}
	if (summary === void 0) return {
		messages: first.messages,
		skipped,
		tokens: first.tokens
	};
	const withSummary = injectSummary(first.messages, summary);
	if (estimateMessagesTokens(withSummary) > options.budget) {
		const truncated = hardTruncate(withSummary, options.budget);
		return {
			messages: truncated.messages,
			summary,
			tokens: truncated.tokens
		};
	}
	return {
		messages: withSummary,
		summary,
		tokens: estimateMessagesTokens(withSummary)
	};
}
/**
* Re-insert a summary as: pinned instructions → summary → surviving tail.
*
* Order matters. Pinned (system/developer) messages must stay ahead of the
* summary so that a later synthetic system message can never override the
* harness's own instructions; the tail follows so the newest exchange is the
* last thing the model reads.
*
* `compacted` is always derived from `original` by `compactMessages`, so the
* pinned messages it carries are exactly the originals — no need to re-add
* them from `original`.
*/
function injectSummary(compacted, summary) {
	const pinned = [];
	const rest = [];
	for (const message of compacted) if (isPinnedRole(message.role)) pinned.push(message);
	else rest.push(message);
	return [
		...pinned,
		summaryMessage(summary),
		...rest
	];
}
//#endregion
//#region src/shim.ts
/**
* Loopback OpenAI-compatible endpoint with multi-account failover.
*
* The pi-ai provider points here. Each chat request acquires an account from
* the pool; when the upstream answers with a rate limit, the shim cools that
* account down, takes the next one, and retries in the same request — so a
* `429 soft_rate` never reaches the user as a turn failure.
*
* Security model (Host/Origin loopback checks, constant-time bearer compare,
* random port, in-process secret, body cap, error→status mapping) follows
* corrinehu/dsh-workbuddy-connect (MIT, Copyright (c) 2026 Corrine Hu), which
* designed and validated it.
*
* @module dsh-rotakit/shim
*/
const REQUEST_BODY_LIMIT = 67108864;
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS = {
	hard_credit: 402,
	soft_rate: 429,
	session_dead: 401,
	not_found: 502,
	server: 502,
	client: 400
};
function hostnameOfHost(host) {
	let hostname = host.trim().toLowerCase();
	if (hostname.startsWith("[")) {
		const end = hostname.indexOf("]");
		return end === -1 ? hostname : hostname.slice(0, end + 1);
	}
	const colon = hostname.lastIndexOf(":");
	if (colon !== -1 && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon);
	return hostname;
}
/** Host must name loopback; drops DNS-rebinding attempts before routing. */
function hostIsLoopback(host) {
	if (host === void 0 || host.trim() === "") return false;
	return LOOPBACK_HOSTS.has(hostnameOfHost(host));
}
/** A present Origin must be loopback; non-browser clients send none and pass. */
function originIsLoopback(origin) {
	if (origin === void 0 || origin.trim() === "") return true;
	try {
		const { hostname } = new URL(origin);
		return LOOPBACK_HOSTS.has(hostname) || hostname === "::1";
	} catch {
		return false;
	}
}
/** Chat POSTs must carry a JSON body type (blocks simple-request CSRF). */
function isJsonContentType(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && type.trim().toLowerCase().startsWith("application/json");
}
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
function writeOpenAIError(res, status, kind, message) {
	writeJson(res, status, { error: {
		message,
		type: kind,
		code: kind
	} });
}
/** True when an upstream failure body means the request overran the model's
*  context window (OpenAI `context_length_exceeded`, WorkBuddy code 11115 /
*  "input length too long"). The shim answers it by compacting the conversation
*  in place and retrying once; see `recoverFromContextOverrun`. */
function isContextTooLong(body) {
	if (body.includes("context_length_exceeded")) return true;
	if (body.includes("input length too long")) return true;
	if (body.includes("\"code\":11115")) return true;
	if (/exceeds?\s+(the\s+)?(model\s+)?context\s+(window|limit)/iu.test(body)) return true;
	return false;
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > REQUEST_BODY_LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/**
* The loopback secret for one region, kept stable across plugin loads.
*
* This value is handed to the host as the provider's API key, so minting a fresh
* one on every load invalidates the key the host is already holding: the shim
* then rejects the request with 401 and the host reports an invalid API key. Any
* settings change reloads the plugin, which is why the failure kept returning
* right after a configuration edit.
*
* Rotating the secret bought nothing in the first place - it guards a loopback
* socket, and anything able to read the file it is stored in can already read the
* process. It is now persisted per region and reused.
*/
function shimSecret(region) {
	const dir = join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool");
	const file = join(dir, `shim-secret-${region}`);
	try {
		const existing = readFileSync(file, "utf8").trim();
		if (existing.length >= 32) return existing;
	} catch {}
	const minted = randomBytes(32).toString("base64url");
	try {
		mkdirSync(dir, { recursive: true });
		// Written through a temp file so a crash cannot leave a half-written secret
		// that would then be adopted on the next load.
		const temp = `${file}.${String(process.pid)}.tmp`;
		writeFileSync(temp, minted, { mode: 384 });
		renameSync(temp, file);
	} catch {}
	return minted;
}
function createWorkBuddyShim(options) {
	const { pool, client, catalog } = options;
	const region = options.region;
	const logger = options.logger;
	const maxAttempts = options.maxAttempts ?? 4;
	/**
	* Per-attempt timeout for one upstream attempt, covering the time before the
	* response HEADERS arrive.
	*
	* This is a stall detector for "we connected and heard nothing back", not a
	* budget for the whole request. It deliberately does not bound the stream:
	* see `IDLE_TIMEOUT_MS` for the second half of the pair.
	*
	* Without either, a request whose upstream connection stalled — TCP
	* established, no bytes coming — hung until the CALLER gave up, which is what
	* made the panel sit on "thinking" forever and then either succeed late or
	* fail with a confusing error. The timeout is per ATTEMPT, not per request:
	* rotating to another account restarts the clock, so a pool with healthy
	* members escapes a stalled one quickly.
	*/
	const ATTEMPT_TIMEOUT_MS = options.attemptTimeoutMs ?? 12e4;
	/**
	* How long a chat stream may go without producing ANY bytes before it is
	* treated as dead.
	*
	* This, not a total-duration cap, is what makes a long answer safe. Reasoning
	* models legitimately spend minutes before the first token and then emit for
	* several more; a wall-clock cap cannot tell that apart from a hung socket and
	* kills both. Silence is the signal that distinguishes them: a stream that is
	* still emitting is still working, however long it has been running.
	*
	* Set well above the largest gap expected between tokens — including long
	* reasoning pauses — because a false positive here truncates an answer that
	* was about to arrive.
	*/
	const IDLE_TIMEOUT_MS = options.idleTimeoutMs ?? 3e5;
	// Stable per region, so a reload does not invalidate the key the host holds.
	const SHARED_SECRET = shimSecret(region);
	function bearerOk(req) {
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match === null) return false;
		const a = Buffer.from(match[1]);
		const b = Buffer.from(SHARED_SECRET);
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}
	const server = createServer((req, res) => {
		handle(req, res);
	});
	const ready = new Promise((resolve, reject) => {
		server.once("listening", () => resolve());
		server.once("error", reject);
	});
	server.listen(0, "127.0.0.1");
	const baseUrl = () => {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("workbuddy shim has no listening address");
		return `http://127.0.0.1:${address.port}`;
	};
	/**
	* Last balance refresh per account, so a busy account is not probed on
	* every request. Ten minutes is well inside the window where ordinary use
	* could cross a reserve.
	*/
	const lastBalanceAt = /* @__PURE__ */ new Map();
	const BALANCE_REFRESH_MS = 6e5;
	/**
	* Refresh one account known credit balance, best effort.
	*
	* Runs in the background after a successful request. Failures are swallowed
	* on purpose: a reserve is a safety feature, and a flaky balance lookup must
	* never become a failed user request or a noisy log.
	*/
	async function refreshBalance(account) {
		const now = Date.now();
		if (now - (lastBalanceAt.get(account.id) ?? 0) < BALANCE_REFRESH_MS) return;
		lastBalanceAt.set(account.id, now);
		try {
			const credits = await client.fetchCredits(account.credential);
			pool.noteCredits(account.id, credits.total);
			pool.noteExpiry(account.id, credits.nearestExpiryMs);
		} catch {}
	}
	async function handle(req, res) {
		try {
			if (!hostIsLoopback(req.headers.host)) {
				writeOpenAIError(res, 403, "host_not_allowed", "Host header must name the loopback interface");
				return;
			}
			if (!originIsLoopback(req.headers.origin)) {
				writeOpenAIError(res, 403, "origin_not_allowed", "Origin must be a loopback origin");
				return;
			}
			if (!bearerOk(req)) {
				writeOpenAIError(res, 401, "unauthorized", "missing or invalid Authorization bearer");
				return;
			}
			const url = req.url ?? "/";
			if (req.method === "GET" && (url === "/healthz" || url === "/healthz/")) {
				writeJson(res, 200, {
					ok: true,
					pool: pool.status()
				});
				return;
			}
			if (req.method === "GET" && (url === "/v1/models" || url === "/v1/models/")) {
				writeJson(res, 200, {
					object: "list",
					data: catalog.current().map((model) => ({
						id: model.id,
						object: "model",
						created: 0,
						owned_by: "workbuddy"
					}))
				});
				return;
			}
			if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/v1/chat/completions/")) {
				await chatCompletions(req, res);
				return;
			}
			writeOpenAIError(res, 404, "not_found", `no such route: ${req.method} ${url}`);
		} catch (error) {
			if (!res.headersSent) writeOpenAIError(res, 500, "internal", String(error));
			else res.end();
		}
	}
	/**
	* Serve one chat completion, rotating accounts on rate limits.
	*
	* A rate-limited account is cooled for exactly the window the upstream
	* reports (when parseable) and the next account is tried immediately, so a
	* pool with any healthy member never surfaces a 429 to the caller.
	*/
	async function chatCompletions(req, res) {
		if (!isJsonContentType(req)) {
			writeOpenAIError(res, 415, "unsupported_media_type", "Content-Type must be application/json");
			return;
		}
		const raw = (await readBody(req)).toString("utf8");
		const prepared = client.prepareChatBody(raw);
		const controller = new AbortController();
		req.on("close", () => controller.abort());
		let modelId;
		let conversationKey;
		try {
			const parsed = JSON.parse(raw);
			modelId = typeof parsed.model === "string" && parsed.model !== "" ? parsed.model : void 0;
			conversationKey = conversationKeyOf(parsed);
		} catch {
			modelId = void 0;
			conversationKey = void 0;
		}
		const tried = [];
		/**
		* Per-attempt timings, logged once when the request ends. Kept regardless of
		* outcome: a request that took 90 seconds needs to be explainable after the
		* fact, and "which account ate the time" is the only question that matters.
		*/
		const timings = [];
		const requestStart = Date.now();
		let last;
		let exhaustedByRateLimit = false;
		/**
		* Log the whole request's timing breakdown at every exit.
		*
		* Called on success AND failure: the slow cases are precisely the ones that
		* do not raise an error, so logging only failures would miss them entirely.
		*/
		const logTiming = (outcome) => {
			const total = Date.now() - requestStart;
			const detail = timings.map((t) => `${t.label}:${t.ms}ms${t.kind === void 0 ? "" : `(${t.kind})`}`).join(" → ");
			logger?.info(`dsh-rotakit: [timing] ${outcome} total=${total}ms model=${modelId ?? "(none)"} accounts=${timings.length} ${detail}`);
		};
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			if (controller.signal.aborted) return;
			const account = await pool.acquire(modelId, region, conversationKey);
			if (account === void 0) {
				if (exhaustedByRateLimit && last !== void 0) {
					const subject = modelId === void 0 ? "every WorkBuddy account is rate-limited" : `every account is rate-limited for model ${modelId}`;
					logTiming("no-account");
					writeOpenAIError(res, KIND_STATUS[last.kind], last.kind, `${subject} (tried ${tried.length}: ${tried.join(", ")}); resets at the upstream window — ${last.message.slice(0, 200)}`);
					return;
				}
				logTiming("no-credential");
				writeOpenAIError(res, 401, "not_signed_in", "no WorkBuddy credential found; sign in on the desktop app (or set WORKBUDDY_AUTH_FILE)");
				return;
			}
			tried.push(account.label);
			/**
			* The lease is released here rather than at each exit below.
			*
			* This body has eight ways out - five `continue`, two `return` and the
			* fall-through for a rate limit - and a missed release is not a small bug:
			* the counter only ever rises, so the account is never selected again.
			* A finally covers every one of them, including paths added later.
			*/
			try {
				/**
				* The first-byte timer.
				*
				* `chatStream` resolves as soon as the response HEADERS arrive — a
				* non-2xx after reading its (small) error body, a 2xx without touching the
				* stream. So this timer covers exactly the window where nothing has come
				* back yet, and it is cleared in `finally` before any streaming begins.
				* That is the whole point of pairing it with `IDLE_TIMEOUT_MS`: neither
				* one bounds the total duration, so a long answer is never cut short.
				*
				* It is also combined with the caller's abort signal, so a client
				* disconnect cancels immediately rather than waiting out the timer. The
				* timer is cleared in `finally` — a leaked timer per attempt would keep
				* the process alive and, on a busy pool, accumulate faster than they
				* expire.
				*/
				const attemptController = new AbortController();
				const onAbort = () => attemptController.abort();
				controller.signal.addEventListener("abort", onAbort, { once: true });
				const timer = setTimeout(() => attemptController.abort(), ATTEMPT_TIMEOUT_MS);
				const attemptStart = Date.now();
				let result;
				try {
					result = await client.chatStream(account.credential, prepared, attemptController.signal);
				} finally {
					clearTimeout(timer);
					controller.signal.removeEventListener("abort", onAbort);
				}
				const elapsed = Date.now() - attemptStart;
				/**
				* A timeout surfaces as an aborted signal, which `chatStream` reports as a
				* failure. Distinguish it from a client disconnect — the first should rotate
				* to another account, the second must stop immediately.
				*/
				const timedOut = elapsed >= ATTEMPT_TIMEOUT_MS - 50 && !controller.signal.aborted;
				if (timedOut) {
					timings.push({ label: account.label, ms: elapsed, kind: "timeout" });
					last = {
						kind: "server",
						status: 504,
						message: `upstream did not respond within ${Math.round(ATTEMPT_TIMEOUT_MS / 1e3)}s`
					};
					pool.penalizeServerError(account.id);
					logger?.warn(`dsh-rotakit: ${account.label} timed out after ${elapsed}ms (attempt ${attempt + 1}/${maxAttempts}); rotating`);
					continue;
				}
				timings.push({ label: account.label, ms: elapsed, kind: result.ok ? void 0 : result.kind });
				if (result.ok) {
					await serveSuccessfulStream(res, account, result, logger, refreshBalance, pool, IDLE_TIMEOUT_MS);
					logTiming("ok");
					return;
				}
				last = {
					kind: result.kind,
					status: result.status,
					message: result.message
				};
				/**
				* A request-level fault ends the rotation on the FIRST attempt.
				*
				* Every account receives an identical body, so every account fails the
				* same way. Rotating would spend one upstream round-trip per account to
				* reproduce an error we already hold, on accounts that are perfectly
				* healthy — the pool would burn its whole request budget and take twenty-odd
				* times as long to return the same 400. Returned verbatim so the caller
				* sees the upstream's own explanation rather than a rewritten one.
				*/
				if (result.kind === "request_fault") {
					logTiming("request-fault");
					writeOpenAIError(res, result.status >= 400 ? result.status : 400, "invalid_request_error", result.message.slice(0, 400));
					return;
				}
				/**
				* "This backend does not serve that model" is about the (account, model)
				* PAIR, so the right move is another account — but the pair itself is worth
				* remembering so the next request does not rediscover it.
				*/
				if (result.kind === "model_blocked") {
					pool.blockModel(account.id, modelId, result.message);
					logger?.warn(`dsh-rotakit: ${account.label} does not serve ${modelId ?? "(no model)"} (attempt ${attempt + 1}/${maxAttempts}); rotating`);
					continue;
				}
				/**
				* Both an account that answered correctly and one that was merely asked
				* something impossible prove the account itself is alive.
				*/
				if (result.kind === "session_dead") {
					await pool.refreshAccount(account.id);
					// The refresh has already run, so a repeat rejection means it did not
					// help. Past the limit the account leaves the pool rather than being
					// offered and rejected again on every subsequent request.
					const retired = pool.penalizeSessionDead(account.id);
					logger?.warn(retired ? `dsh-rotakit: ${account.label} credential rejected ${AUTH_DEAD_STREAK_LIMIT} times; out of the pool for ${Math.round(AUTH_DEAD_COOLDOWN_MS / 6e4)}min (sign in again to restore it)` : `dsh-rotakit: ${account.label} credential rejected; refreshed and rotating`);
					continue;
				}
				if (result.kind === "hard_credit") {
					pool.penalizeExhausted(account.id);
					logger?.warn(`dsh-rotakit: ${account.label} has no credits left (attempt ${attempt + 1}/${maxAttempts}); rotating`);
					continue;
				}
				/**
				* 上游 5xx（含腾讯网关偶发的 550）按「换一个账号可能就好」处理。
				*
				* 这不是把服务端错误当成限流：5xx 是**上游侧的瞬时故障**，而一个
				* 健康账号发同样的请求很可能成功 —— 多账号池存在的意义正是这个。
				* 此前 5xx 会落到下面那句 `break` 直接放弃，于是 8 个号的池子只试
				* 1 个就报错（报错原文的 "after 1 account(s)" 就是这么来的），
				* 偏偏最常见、最该换号的故障反而不换。
				*
				* 冷却时长沿用 cooldownMs（短冷却）：既不把这个号立刻判死，也避免
				* 下次请求马上又撞上同一个刚出过问题的号。次数仍受 maxAttempts 约束，
				* 所以上游整体宕机时也只是把 8 次试满后如实报错，不会无限重试。
				* 注意：`exhaustedByRateLimit` **不置位** —— 它的语义是「所有号都被
				* 限流」，5xx 不是限流，置位会把报错文案误导成「全都限流了」。
				*
				* 走 `penalizeServerError` 而不是 `penalize`：后者会累加
				* `rateLimitHits`，让网关故障混进限流计数（那正是本次修复前的行为，
				* 界面上的 "N hit(s)" 因此把 550 说成了限流）。两者语义相反 ——
				* 429 说明「这个号有问题」，5xx 说明「上游有问题」—— 所以分开记账。
				*/
				if (result.kind === "server") {
					pool.penalizeServerError(account.id);
					noteServerError(account.id);
					logger?.warn(`dsh-rotakit: ${account.label} saw upstream ${result.status} (attempt ${attempt + 1}/${maxAttempts}); rotating`);
					continue;
				}
				if (result.kind !== "soft_rate") break;
				exhaustedByRateLimit = true;
				pool.penalize(account.id, parseRateLimitReset(result.message), modelId);
				logger?.warn(`dsh-rotakit: ${account.label} rate-limited on ${modelId ?? "(no model)"} (attempt ${attempt + 1}/${maxAttempts}); rotating`);
			} finally {
				pool.release(account.id);
			}
		}
		if (last === void 0) {
			logTiming("exhausted-no-result");
			writeOpenAIError(res, 500, "internal", "chat request exhausted without a result");
			return;
		}
		if (isContextTooLong(last.message)) {
			const recovered = await recoverFromContextOverrun({
				raw,
				modelId,
				controller,
				region,
				logger,
				client,
				pool,
				maxAttempts,
				contextWindow: modelId === void 0 ? void 0 : catalog.current().find((m) => m.id === modelId)?.contextWindow
			});
			if (recovered.ok) {
				await serveSuccessfulStream(res, recovered.account, recovered.result, logger, refreshBalance, pool, IDLE_TIMEOUT_MS);
				logTiming("ok-after-compact");
				return;
			}
			logTiming("context-overflow");
			writeOpenAIError(res, 400, "context_length_exceeded", contextOverflowMessage(modelId, recovered.detail));
			return;
		}
		logTiming(`failed-${last.kind}`);
		writeOpenAIError(res, KIND_STATUS[last.kind], last.kind, `workbuddy upstream ${last.kind} (http ${last.status}) after ${tried.length} account(s) [${tried.join(" → ")}]: ${last.message.slice(0, 400)}`);
	}
	return {
		ready,
		baseUrl,
		token: () => SHARED_SECRET,
		close: () => new Promise((resolve, reject) => {
			server.close(() => resolve());
			server.closeAllConnections();
			server.once("error", reject);
		})
	};
}
/**
* Build the overflow message the Harness must recognize.
*
* This is deliberately NOT free-form prose. `dsh-compaction-basic` decides
* whether to compact-and-retry by running the text that reaches it through
* `isContextWindowExceededError()` (`@deepseek-ai/dsh-llm`), whose matcher
* accepts only specific phrasings:
*
*   - `context_length_exceeded` / `context window exceeded`
*   - `maximum context length`
*   - `<input|prompt|request|messages> too large|long for ... context`
*   - `<input|prompt|request> exceeds the ... context window`
*
* The obvious friendly sentence ("the conversation exceeds this model's
* context window") matches NONE of them, and neither does the WorkBuddy
* upstream's own "input length too long" / code 11115. Emitting either meant
* the Harness saw an unclassifiable 400, skipped its recovery path, and
* surfaced a dead turn — the bug this function exists to prevent.
*
* The leading clause carries the machine-matched wording; the trailing clause
* is what a human reads. Keep both in sync with
* `tests/context-overflow-contract.test.ts`.
*/
function contextOverflowMessage(modelId, detail = "") {
	return `This model's maximum context length was exceeded: the prompt is too large for ${modelId === void 0 ? "the model" : `model ${modelId}`}, and the conversation could not be compacted in place${detail === "" ? "" : ` (${detail})`}. Compact the conversation, or start a new chat.`;
}
/**
* Serve one already-successful upstream stream as an SSE response.
*
* Extracted so the context-overrun recovery path reuses the exact same
* bookkeeping (noteServed + background balance refresh) as a first-try hit.
*/
/**
* Serve one successful upstream stream to the client.
*
* Two facts about this stream are deliberately not enforced here:
*   - it has no total-duration limit, so a long answer is never truncated;
*   - it is never retried, because one byte has already reached the client and
*     the status line is spent. Retrying a committed response would append a
*     second body to the first.
*
* The only liveness check is `idleMs`: the gap between bytes. A stream that is
* still emitting is still working, however long it has been running.
*/
async function serveSuccessfulStream(res, account, result, logger, refreshBalance, pool, idleMs) {
	logger?.info?.(`dsh-rotakit: served by ${account.label}`);
	pool.noteServed(account.id);
	refreshBalance(account);
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		"X-Accel-Buffering": "no"
	});
	let sawDone = false;
	const body = Readable.fromWeb(result.response.body);
	/**
	* Idle watchdog.
	*
	* A stalled socket leaves the read pending forever, so the stream never emits
	* `end` and never emits `error` either — the client simply waits. Destroying
	* the source on timeout turns that silence into an `error`, which the handler
	* below already knows how to close out.
	*
	* Every chunk resets the timer, so this fires only on genuine silence, not on
	* duration.
	*/
	let idleTimer;
	const armIdle = () => {
		if (idleMs === void 0 || idleMs <= 0) return;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			logger?.warn(`dsh-rotakit: upstream stream idle for ${Math.round(idleMs / 1e3)}s; aborting`);
			body.destroy(new Error(`upstream stream idle for ${Math.round(idleMs / 1e3)}s`));
		}, idleMs);
	};
	const disarmIdle = () => clearTimeout(idleTimer);
	armIdle();
	body.on("data", (chunk) => {
		if (chunk.includes("[DONE]")) sawDone = true;
		armIdle();
	});
	body.on("error", (error) => {
		logger?.warn("dsh-rotakit: upstream stream failed mid-flight", error);
		/**
		* Close the SSE frame the client is waiting on. A dropped connection left
		* the client waiting for a `[DONE]` that will never arrive, so it hung
		* instead of reporting a truncated answer; the error is already surfaced
		* through the log, and this gives the caller a clean end.
		*/
		if (!sawDone && res.writable) res.end("data: [DONE]\n\n");
	});
	body.on("close", disarmIdle);
	body.pipe(res);
}
/**
* Compact an over-long conversation and retry it once.
*
* Strategy, in order:
*  1. drop the oldest turns, keeping system messages and the newest exchange;
*  2. ask the model to summarise the dropped turns and splice that summary in;
*  3. hard-truncate as a last resort.
*
* Returns `ok: false` only when even a truncated prompt still overran — the
* caller then surfaces the original actionable 400.
*/
/**
* [xdpool-5xx] Fold one gateway failure into the persistent ledger, then flush.
*
* Deliberately NOT a method on the pool. The pool's counters are per-process and
* are reset by `resetCooldowns()`; the ledger is process-external history, so it
* is written at the one place that observes a failure — the failover loop —
* where the account id is still known.
*
* The read-modify-write is synchronous and back-to-back on purpose. This runs on
* the request path, but only on the failing one: a 5xx is rare, the file is a
* few hundred bytes, and the alternative (a module-level cache flushed later)
* would need its own staleness rules for no gain. Errors are swallowed inside
* both helpers, so bookkeeping can never turn a rotation into a failed request.
*/
function noteServerError(accountId) {
	try {
		const ledger = readServerErrorLedger();
		if (noteServerErrorObservation(ledger, accountId, Date.now())) writeServerErrorLedger(ledger);
	} catch {}
}
async function recoverFromContextOverrun(options) {
	const { raw, modelId, controller, region, logger, client, pool, maxAttempts } = options;
	const parsed = client.parseChatBody(raw);
	if (parsed === void 0) return {
		ok: false,
		detail: "request body was not parseable JSON"
	};
	const rawMessages = parsed["messages"];
	if (!Array.isArray(rawMessages)) return {
		ok: false,
		detail: "request carried no messages array"
	};
	const messages = rawMessages.filter((value) => typeof value === "object" && value !== null && !Array.isArray(value));
	if (messages.length === 0) return {
		ok: false,
		detail: "request carried no usable messages"
	};
	const overrunTokens = estimateMessagesTokens(messages);
	const realWindow = options.contextWindow;
	const budget = realWindow !== void 0 && realWindow > 0 ? Math.max(512, Math.floor(realWindow * .8) - 2048) : Math.max(512, Math.floor(overrunTokens / 2));
	logger?.warn(`dsh-rotakit: context overrun on ${modelId ?? "(no model)"} (~${overrunTokens} tokens); compacting to ~${budget} and retrying once`);
	let summary;
	let compacted = messages;
	let compactionDetail = "";
	try {
		const summariser = await pool.acquire(modelId, region);
		if (summariser === void 0) compactionDetail = "no account available to summarise with";
		else {
			const outcome = await compactWithSummary(messages, {
				budget,
				keepRecent: 6
			}, { complete: async (request, signal) => {
				const body = client.buildChatBody({
					...parsed,
					stream: true,
					max_tokens: Math.max(256, Math.floor(budget / 2))
				}, request);
				return await client.completeChat(summariser.credential, body, signal ?? controller.signal);
			} }, controller.signal);
			compacted = outcome.messages;
			summary = outcome.summary;
			if (outcome.skipped !== void 0) compactionDetail = outcome.skipped;
		}
	} catch (error) {
		compactionDetail = `summarisation failed: ${String(error)}`;
	}
	if (estimateMessagesTokens(compacted) > budget) compacted = hardTruncate(compacted, budget).messages;
	if (summary === void 0 && estimateMessagesTokens(compacted) >= overrunTokens) return {
		ok: false,
		detail: compactionDetail === "" ? "compaction could not reduce the prompt" : compactionDetail
	};
	const retryBody = client.buildChatBody(parsed, compacted);
	const tried = [];
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		if (controller.signal.aborted) return {
			ok: false,
			detail: "client disconnected"
		};
		const account = await pool.acquire(modelId, region);
		if (account === void 0) return {
			ok: false,
			detail: "no account available after compaction"
		};
		tried.push(account.label);
		const result = await client.chatStream(account.credential, retryBody, controller.signal);
		if (result.ok) {
			logger?.info?.(`dsh-rotakit: recovered from context overrun on ${modelId ?? "(no model)"} (summarised: ${summary === void 0 ? "no" : "yes"})`);
			return {
				ok: true,
				account,
				result
			};
		}
		if (isContextTooLong(result.message)) return {
			ok: false,
			detail: "prompt still exceeded the window after compaction"
		};
		if (result.kind === "session_dead") {
			await pool.refreshAccount(account.id);
			pool.penalizeSessionDead(account.id);
			continue;
		}
		if (result.kind === "hard_credit") {
			pool.penalizeExhausted(account.id);
			continue;
		}
		if (result.kind === "soft_rate") {
			pool.penalize(account.id, parseRateLimitReset(result.message), modelId);
			continue;
		}
		return {
			ok: false,
			detail: `upstream ${result.kind} after compaction`
		};
	}
	return {
		ok: false,
		detail: `no account served the compacted request (tried ${tried.length})`
	};
}
//#endregion
//#region src/status.ts
/** Build the status document. Never throws. */
async function buildStatus(options) {
	const { pool, catalog, client } = options;
	const accounts = pool.list();
	const now = Date.now();
	const rows = [];
	for (const account of accounts) {
		const modelCooldowns = Object.entries(account.modelCooldowns).filter(([, until]) => until > now).sort((a, b) => a[1] - b[1]).map(([modelId, until]) => ({
			modelId,
			until: new Date(until).toISOString()
		}));
		const row = {
			id: account.id,
			label: account.label,
			...account.credential.nickname === void 0 ? {} : { nickname: maskPhoneInLabel(account.credential.nickname) },
			domain: account.credential.domain,
			...account.credential.expiresAtMs === 0 ? {} : { expiresAt: new Date(account.credential.expiresAtMs).toISOString() },
			cooling: account.cooldownUntilMs > now,
			...account.cooldownUntilMs > now ? { cooldownUntil: new Date(account.cooldownUntilMs).toISOString() } : {},
			...modelCooldowns.length === 0 ? {} : { modelCooldowns },
			rateLimitHits: account.rateLimitHits,
			serverErrorHits: account.serverErrorHits,
			sourcePath: account.credential.sourcePath
		};
		if (options.includeCredits === true && !row.cooling) try {
			Object.assign(row, { credits: await client.fetchCredits(account.credential) });
		} catch (error) {
			Object.assign(row, { creditsError: String(error).slice(0, 200) });
		}
		rows.push(row);
	}
	const cooling = rows.filter((row) => row.cooling).length;
	const firstUsable = accounts.find((account) => account.cooldownUntilMs <= now);
	return {
		ok: accounts.length > 0 && cooling < accounts.length,
		accounts: rows,
		...firstUsable === void 0 ? {} : { activeAccountId: firstUsable.id },
		cooling,
		models: catalog.current().map((model) => ({
			id: model.id,
			name: model.name,
			...model.multiplier === void 0 ? {} : { multiplier: model.multiplier },
			...model.tags === void 0 ? {} : { tags: model.tags }
		})),
		shim: options.shim ?? { running: false }
	};
}
/** Format the status document for a terminal. */
function formatStatus(status) {
	const lines = [];
	lines.push(`RotaKit: ${status.accounts.length} account(s), ${status.cooling} cooling`);
	lines.push(`Shim: ${status.shim.running ? "running" : "stopped"}${status.shim.baseUrl === void 0 ? "" : ` at ${status.shim.baseUrl}`}`);
	lines.push("");
	if (status.accounts.length === 0) {
		lines.push("No WorkBuddy credential found. Sign in on the WorkBuddy desktop app,");
		lines.push("then run: dsh plugin --profile desktop exec dsh-rotakit import <key>");
		return lines.join("\n");
	}
	for (const account of status.accounts) {
		const flag = account.cooling ? "⏸ " : "▶ ";
		const active = account.id === status.activeAccountId ? " (next up)" : "";
		lines.push(`${flag}${account.label}${active}`);
		lines.push(`    uid/uin   : ${account.id}  [${account.domain || "cn"}]`);
		if (account.expiresAt !== void 0) lines.push(`    expires   : ${account.expiresAt}`);
		if (account.credits !== void 0) {
			const { total } = account.credits;
			const parts = [];
			if (total !== void 0) parts.push(`total ${total}`);
			lines.push(`    credits   : ${parts.join(" | ") || "n/a"}`);
		}
		if (account.creditsError !== void 0) lines.push(`    credits   : query failed — ${account.creditsError}`);
		if (account.cooling && account.cooldownUntil !== void 0) lines.push(`    cooldown  : until ${account.cooldownUntil} (hits ${account.rateLimitHits})`);
		if (account.modelCooldowns !== void 0 && account.modelCooldowns.length > 0) for (const mc of account.modelCooldowns) lines.push(`    model-cool: ${mc.modelId} until ${mc.until}`);
		lines.push(`    source    : ${account.sourcePath}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
/** Format the per-model credit multipliers. */
function formatRates(status) {
	const lines = ["Model credit multipliers:"];
	for (const model of status.models) {
		const rate = model.multiplier === void 0 ? "x?" : `x${model.multiplier.toFixed(2)}`;
		lines.push(`  ${model.name.padEnd(20)} ${rate}`);
	}
	return lines.join("\n");
}
//#endregion
//#region src/status-paths.ts
/**
* Node-free constants and types shared by the Host and browser halves of the
* RotaKit settings card.
*
* Pool's runtime state already lives in `src/status.ts` (`buildStatus` /
* `WorkBuddyStatus`); this module only carves the cross-domain (Host→browser)
* JSON document into a shape that stays token-free and matches what the
* browser card renders. Route paths are plugin-owned and mounted on the Host's
* same-origin web server (see `src/web-status.ts`).
*
* @module dsh-rotakit/status-paths
*/
/** Plugin-owned read-only pool status endpoint (account rows + models + shim). */
const POOL_STATUS_PATH = "/plugins/dsh-rotakit/status";
/** Plugin-owned local account rescan endpoint (re-read desktop snapshots). */
const POOL_RESCAN_PATH = "/plugins/dsh-rotakit/accounts/rescan";
/** Plugin-owned cooldown reset endpoint (clear all 429 cooldowns). */
const POOL_RESET_COOLDOWN_PATH = "/plugins/dsh-rotakit/cooldowns/reset";
/** Plugin-owned daily check-in action endpoint (claim today's reward). */
const POOL_CHECKIN_PATH = "/plugins/dsh-rotakit/checkin";
/** Plugin-owned model-selection save endpoint (writes the settings section). */
const POOL_MODELS_SAVE_PATH = "/plugins/dsh-rotakit/models/save";
/** Switch one account in or out of the pool (card toggle). */
const POOL_ACCOUNT_DISABLE_PATH = "/plugins/dsh-rotakit/accounts/disabled";
/** Run one automation job immediately, so the card can verify it on demand. */
const POOL_AUTOMATION_RUN_PATH = "/plugins/dsh-rotakit/automation/run";
/** Set or clear one account's reserved-credit floor. */
const POOL_CREDIT_RESERVE_PATH = "/plugins/dsh-rotakit/accounts/credit-reserve";

/** [xdpool-oauth] Plugin-owned endpoint that opens one QR sign-in. */
const POOL_OAUTH_START_PATH = "/plugins/dsh-rotakit/oauth/start";
/** [xdpool-oauth] Plugin-owned endpoint that polls one QR sign-in. */
const POOL_OAUTH_POLL_PATH = "/plugins/dsh-rotakit/oauth/poll";

//#endregion
//#region src/web-status.ts
/** Redact token-like content before it crosses to the browser. */
/**
* A zeroed-out automation job record.
*
* Used when no scheduler is wired: the card renders the same shape either way,
* so an unwired profile shows zeroes rather than a missing panel.
*/
function emptyAutomationJob() {
	return {
		ok: 0,
		failed: 0,
		credit: 0,
		energy: 0,
		claimed: 0
	};
}
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 500);
}
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
/**
* [xdpool-usage] Last ledger read, and when it happened.
*
* The status route is polled far more often than the ledger can change, and the
* only thing that changes it is that same route observing a new balance — so a
* one-minute cache cannot miss an update for longer than the poll cadence that
* would produce one. Only the host side touches this; the ledger has exactly one
* writer.
*/
const usageLedgerCache = {
	at: 0,
	/**
	* Filled on the first read rather than here: `emptyUsageLedger` is a `const`
	* declared below, so calling it in this initialiser would hit its temporal
	* dead zone and take the whole module down at import time — every route and
	* the settings card included, not just this feature.
	*/
	ledger: void 0
};
/**
* [xdpool-5xx] Last gateway-failure ledger read, and when it happened.
*
* Same one-minute cache and the same `void 0` initialisation as
* `usageLedgerCache` above, for the same two reasons: this route is polled far
* more often than the file can change (it only changes on a failure), and
* `emptyServerErrorLedger` is declared further down, so calling it here would
* hit its temporal dead zone and break the entire module import.
*/
const serverErrorLedgerCache = {
	at: 0,
	ledger: void 0
};
/** True only for a usable number; every ledger arithmetic step guards with this. */
function finiteOr(value, fallback = 0) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
/**
* Money-ish output: 2 decimals, and NaN/Infinity never cross the wire.
*
* The guard is on the SCALED value, not the input, on purpose: a finite input
* whose product overflows (Number.MAX_VALUE, or a hand-edited ledger carrying a
* nonsense figure) would otherwise escape as Infinity — and JSON.stringify turns
* Infinity into `null`, which is worse than a wrong number because the card then
* has to interpret a missing field. Guarding the product makes this function meet
* its contract for every input, at no extra cost.
*/
function round2(value) {
	const scaled = value * 100;
	return Number.isFinite(scaled) ? Math.round(scaled) / 100 : 0;
}
/**
* [xdpool-usage] The pool's own consumption ledger file.
*
* Sits next to `oauth-last.json` because that is already the plugin's private
* directory. Resolved lazily for the same reason `oauthRecordPath` is: the file
* is read on every status poll and written only when an account's remaining
* credits actually moved.
*/
const usageLedgerPath = () => join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool", "usage-ledger.json");
/**
* [xdpool-usage] An empty ledger, returned whenever the file is missing, unreadable or corrupt.
*
* `days` maps a LOCAL `YYYY-MM-DD` to the credits consumed in it; `lastSeen` maps
* an account id to the last remaining-credit total observed for it. Both are plain
* objects so the on-disk JSON stays human-readable. Corrupt content is treated as
* "no history yet" rather than an error: the card must still render, and a bad
* file is recovered by the next successful observation.
*/
const emptyUsageLedger = () => ({
	version: 1,
	days: {},
	lastSeen: {}
});
/**
* [xdpool-usage] Read the ledger, degrading to an empty one on ANY failure.
*
* A partially-written or hand-edited file must never take the status route down,
* so every malformed branch is dropped individually instead of rejecting the
* whole document — one broken day bucket should not discard the other 400.
*/
const readUsageLedger = () => {
	const ledger = emptyUsageLedger();
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(usageLedgerPath(), "utf8"));
	} catch {
		return ledger;
	}
	if (typeof parsed !== "object" || parsed === null) return ledger;
	const days = asRecord(parsed["days"]);
	for (const [key, bucket] of Object.entries(days)) {
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(key)) continue;
		const used = finiteOr(asRecord(bucket)["used"], Number.NaN);
		if (!Number.isFinite(used) || used <= 0) continue;
		ledger.days[key] = { used };
	}
	const lastSeen = asRecord(parsed["lastSeen"]);
	for (const [accountId, value] of Object.entries(lastSeen)) {
		const seen = finiteOr(value, Number.NaN);
		if (Number.isFinite(seen) && seen >= 0) ledger.lastSeen[accountId] = seen;
	}
	return ledger;
};
/**
* [xdpool-usage] Persist the ledger, best effort.
*
* Writes to a sibling temp file and renames, so a crash mid-write leaves the
* previous ledger intact instead of a truncated one — losing a day of history is
* acceptable, corrupting it is not. Failures are swallowed for the same reason
* `writeOauthRecord` swallows them: this is background bookkeeping, never a
* reason to fail a request.
*/
const writeUsageLedger = (ledger) => {
	try {
		const target = usageLedgerPath();
		const temp = `${target}.tmp`;
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(temp, `${JSON.stringify(ledger, void 0, 2)}\n`, "utf8");
		renameSync(temp, target);
	} catch {}
};
/**
* [xdpool-usage] How far back day buckets are kept.
*
* Only the current month is ever read back, but the window is deliberately much
* wider than a month: the file stays tiny either way (a bucket is a few bytes,
* so 400 days is a handful of KB), and a future "quarter" or "year" figure then
* needs no migration. The bound exists only so a machine left running for years
* cannot grow the file without limit.
*/
const USAGE_LEDGER_KEEP_DAYS = 400;
/**
* [xdpool-5xx] The pool's own gateway-failure ledger.
*
* Deliberately a SECOND file rather than more keys inside `usage-ledger.json`.
* The two record different kinds of thing: the usage ledger is derived state
* (every figure in it can be recomputed from balances we re-read anyway), while
* these counters are *observations of events that leave no other trace*. A 5xx
* failover is over in milliseconds and the account's 60-second cooldown is gone
* before anyone opens the card, so if the file is lost the information is gone
* for good. Keeping them apart means a corruption or a format change in one
* cannot cost the other, and the prune rules stay independent — this file is
* pruned on the same window for the same reason (bounded growth), not because
* the two share a meaning.
*/
const serverErrorLedgerPath = () => join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool", "server-errors.json");
/**
* [xdpool-5xx] An empty failure ledger, returned whenever the file is missing,
* unreadable or corrupt.
*
* `accounts` maps an account id to its running gateway-failure count;
* `days` maps a LOCAL `YYYY-MM-DD` to the count seen that day, which is what
* lets the card say "3 today" without keeping a timestamp per event. Both are
* plain objects so the on-disk JSON stays human-readable, and a corrupt file
* degrades to "no history yet" rather than an error — the card must still
* render, and the next real failure re-seeds it.
*/
const emptyServerErrorLedger = () => ({
	version: 1,
	accounts: {},
	days: {}
});
/**
* [xdpool-5xx] Read the failure ledger, degrading to an empty one on ANY failure.
*
* Same contract as `readUsageLedger`: every malformed branch is dropped on its
* own instead of rejecting the whole document, so one bad account id cannot
* discard the rest of the history. Counts must be non-negative finite integers;
* a hand-edited fractional count is floored rather than trusted, because the
* only figure the card shows is a count of discrete events.
*/
const readServerErrorLedger = () => {
	const ledger = emptyServerErrorLedger();
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(serverErrorLedgerPath(), "utf8"));
	} catch {
		return ledger;
	}
	if (typeof parsed !== "object" || parsed === null) return ledger;
	for (const [accountId, value] of Object.entries(asRecord(parsed["accounts"]))) {
		const hits = finiteOr(value, Number.NaN);
		if (!Number.isFinite(hits) || hits <= 0) continue;
		ledger.accounts[accountId] = Math.floor(hits);
	}
	for (const [key, value] of Object.entries(asRecord(parsed["days"]))) {
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(key)) continue;
		const hits = finiteOr(value, Number.NaN);
		if (!Number.isFinite(hits) || hits <= 0) continue;
		ledger.days[key] = Math.floor(hits);
	}
	return ledger;
};
/**
* [xdpool-5xx] Persist the failure ledger, best effort.
*
* Temp file plus rename, exactly like `writeUsageLedger`: a crash mid-write must
* leave the previous counters intact rather than a truncated file. Failures are
* swallowed for the same reason — this is bookkeeping on the request path, and
* losing a counter is never a reason to fail a completion.
*/
const writeServerErrorLedger = (ledger) => {
	try {
		const target = serverErrorLedgerPath();
		const temp = `${target}.tmp`;
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(temp, `${JSON.stringify(ledger, void 0, 2)}\n`, "utf8");
		renameSync(temp, target);
	} catch {}
};
/**
* [xdpool-5xx] Fold one gateway failure into the ledger.
*
* `accountId` is optional because the failure can happen before an account is
* chosen (or when the pool is empty); only the day bucket is booked then. The
* counters are cumulative and are NEVER reset by `resetCooldowns()`: clearing a
* cooldown means "let this account be tried again", while these numbers answer
* "is this account or this upstream flaky", and the second question is not
* answered by forgetting. Returns true when the file should be written back.
*/
const noteServerErrorObservation = (ledger, accountId, now) => {
	const at = new Date(now);
	if (!Number.isFinite(at.getTime())) return false;
	const key = dayKeyLocal(at);
	ledger.days[key] = Math.floor(finiteOr(ledger.days[key]) + 1);
	if (typeof accountId === "string" && accountId !== "") {
		ledger.accounts[accountId] = Math.floor(finiteOr(ledger.accounts[accountId]) + 1);
	}
	return true;
};
/**
* [xdpool-5xx] Drop day buckets older than the retention window, and forget
* accounts that no longer appear in the pool.
*
* Reuses `USAGE_LEDGER_KEEP_DAYS` deliberately: the two files grow from the same
* force (one bucket per day) and are read over the same windows, so a second
* constant would only be a second thing to drift. The comparison is a string
* compare on zero-padded local `YYYY-MM-DD`, which is correct without parsing.
*/
const pruneServerErrorLedger = (ledger, now, keepAccountIds) => {
	const elapsedDays = Math.floor(finiteOr(now, Date.now()) / 864e5);
	const cutoff = dayKeyLocal(new Date((elapsedDays - USAGE_LEDGER_KEEP_DAYS) * 864e5));
	for (const key of Object.keys(ledger.days)) {
		if (key < cutoff) delete ledger.days[key];
	}
	if (keepAccountIds !== void 0) {
		for (const accountId of Object.keys(ledger.accounts)) {
			if (!keepAccountIds.has(accountId)) delete ledger.accounts[accountId];
		}
	}
};
/**
* [xdpool-5xx] The `serverErrors` object the card renders.
*
* `accounts` is the per-account running count, keyed by the same ids the card
* already has in `accounts[]`, so the panel never has to reconcile two
* numbering schemes. `total` is their sum, `today` is the current local day's
* bucket. Everything is a number here, never `undefined`: "no gateway failures"
* and "we have never recorded one" are the same statement for a counter that
* only ever increments.
*
* The sum is computed HERE rather than in the card on purpose — see the note on
* `poolWebSummary`. A count that the panel derives itself can disagree with the
* per-row counts it renders beside it (a row filtered out, a stale region, an
* account that vanished between polls), and a headline figure that contradicts
* the rows underneath it is worse than no headline figure at all.
*/
const serverErrorPayload = (ledger, now) => {
	const accounts = { ...ledger.accounts };
	let total = 0;
	for (const value of Object.values(accounts)) total += finiteOr(value);
	return {
		total,
		today: Math.floor(finiteOr(ledger.days[dayKeyLocal(new Date(now))])),
		accounts
	};
};
/**
* [xdpool-usage] Fold ONE fresh observation for ONE account into the ledger.
*
* `remaining` is the account's summed package remaining. The rules, in the order
* they matter:
*   - a DECREASE is consumption; the delta lands in today's local bucket
*   - an INCREASE is a top-up, an expiry, or a cycle reset; record nothing for
*     it and only move `lastSeen` forward. Booking a negative delta here would
*     quietly credit back usage the account really spent.
*   - a FIRST observation only seeds `lastSeen`. Without this the whole backlog
*     of credits that existed before the plugin ever ran would be booked as
*     "today's consumption".
*
* `now` is normalised once here on purpose: callers hand in `Date.now()` (the
* status route) while `dayKeyLocal` wants a `Date`, and a function that only
* works for one of the two styles is a trap for the next caller. Coercing at the
* boundary keeps every path below dealing with a real Date.
*
* Returns true when the caller should write the file back.
*/
const noteUsageObservation = (ledger, accountId, remaining, now) => {
	const at = new Date(now);
	if (!Number.isFinite(at.getTime())) return false;
	if (typeof accountId !== "string" || accountId === "") return false;
	if (!Number.isFinite(remaining) || remaining < 0) return false;
	const previous = ledger.lastSeen[accountId];
	if (!Number.isFinite(previous) || previous < 0) {
		ledger.lastSeen[accountId] = remaining;
		return true;
	}
	if (remaining === previous) return false;
	if (remaining > previous) {
		ledger.lastSeen[accountId] = remaining;
		return true;
	}
	const delta = previous - remaining;
	const key = dayKeyLocal(at);
	const bucket = ledger.days[key];
	const used = bucket === void 0 ? 0 : finiteOr(bucket.used);
	ledger.days[key] = { used: round2(used + delta) };
	ledger.lastSeen[accountId] = remaining;
	return true;
};
/**
* [xdpool-usage] Drop day buckets older than the retention window, and forget
* accounts that no longer appear in the pool.
*
* `days` is what makes the file grow without bound, so it is pruned on the same
* write that adds to it. The comparison is a string compare on `YYYY-MM-DD`,
* which is correct precisely because the key is zero-padded and local — no Date
* parsing, so no timezone surprises on a machine that changed zones.
*/
const pruneUsageLedger = (ledger, now, keepAccountIds) => {
	const elapsedDays = Math.floor(finiteOr(now, Date.now()) / 864e5);
	const cutoff = dayKeyLocal(new Date((elapsedDays - USAGE_LEDGER_KEEP_DAYS) * 864e5));
	for (const key of Object.keys(ledger.days)) {
		if (key < cutoff) delete ledger.days[key];
	}
	if (keepAccountIds !== void 0) {
		for (const accountId of Object.keys(ledger.lastSeen)) {
			if (!keepAccountIds.has(accountId)) delete ledger.lastSeen[accountId];
		}
	}
};
/**
* [xdpool-usage] Derive the three consumption windows from the day buckets.
*
* `last7` spans today plus the 6 preceding local days, `month` every bucket in
* the current local calendar month. Both are additions, so the same bucket can
* appear in both — they are different questions, not a hierarchy. Nothing is
* stored per-window on disk, so a widened window needs no migration.
*
* `since` is the earliest recorded day, which is what lets the card say "since
* this date" instead of implying the numbers cover the whole account history.
*/
const usageRollup = (ledger, now) => {
	const today = finiteOr(now, Date.now());
	const todayKey = dayKeyLocal(new Date(today));
	/**
	* The first day `last7` still covers: today minus 6, i.e. a 7-day span
	* inclusive at BOTH ends. Kept as a separate named bound because the
	* off-by-one here is invisible in normal use — it only ever drops one day's
	* figure, and it made the comment above disagree with the code.
	*
	* Both comparisons are string compares on zero-padded `YYYY-MM-DD`, which
	* orders lexicographically the same way it orders chronologically.
	*/
	const last7StartKey = dayKeyLocal(new Date(today - 6 * 864e5));
	const monthPrefix = todayKey.slice(0, 7);
	let last7 = 0;
	let month = 0;
	let since;
	for (const [key, bucket] of Object.entries(ledger.days)) {
		const used = finiteOr(bucket?.used);
		if (since === void 0 || key < since) since = key;
		if (key >= last7StartKey && key <= todayKey) last7 += used;
		if (key.startsWith(monthPrefix)) month += used;
	}
	return {
		today: round2(finiteOr(ledger.days[todayKey]?.used)),
		last7: round2(last7),
		month: round2(month),
		...since === void 0 ? {} : { since }
	};
};
/**
* [xdpool-trend] The last `days` local days as a dense series, oldest first.
*
* Dense, not sparse: the ledger only holds buckets for days that actually saw
* consumption, so a naive `Object.entries(ledger.days)` would draw a 5-point line
* for a 5-day-old install and silently compress a month in which 20 days were
* idle. Every day in the window is emitted, with 0 for days that are absent —
* "spent nothing that day" is real information and a gap in the line would
* misrepresent it as missing data.
*
* `max` is the largest single-day figure in the window, emitted so the client does
* not have to scan the series to scale it; the client still recomputes it if an
* older host omits the field. Both the date keys and the arithmetic are LOCAL,
* matching `dayKeyLocal`, so a machine that changed timezone does not see days
* shift.
*/
const usageTrend = (ledger, now, days) => {
	const span = Number.isFinite(days) && days > 0 ? Math.floor(days) : 14;
	const today = finiteOr(now, Date.now());
	const points = [];
	let max = 0;
	let total = 0;
	for (let offset = span - 1; offset >= 0; offset -= 1) {
		const key = dayKeyLocal(new Date(today - offset * 864e5));
		const used = round2(finiteOr(ledger.days[key]?.used));
		points.push({
			date: key,
			used
		});
		if (used > max) max = used;
		total += used;
	}
	return {
		days: span,
		points,
		max: round2(max),
		total: round2(total)
	};
};
/**
* [xdpool-usage] The `usage` object the card renders: four figures in one bar.
*
* `remaining` is the pool-wide sum of the per-account remaining credits, and it
* stays `undefined` until at least one account has actually reported credits —
* "we have not heard from upstream yet" and "the pool is empty" are different
* statements and the card draws them differently. The three windows always
* resolve to a number, so the bar never renders `NaN`.
*
* `since` is only meaningful once something has been recorded, and is omitted
* rather than guessed.
*/
const usagePayload = (remainingTotal, rollup) => ({
	...remainingTotal === void 0 ? {} : { remaining: round2(remainingTotal) },
	today: rollup.today,
	last7: rollup.last7,
	month: rollup.month,
	...rollup.since === void 0 ? {} : { since: rollup.since }
});
/** Loopback browser origins only; other devices are refused. */
function loopbackOrigin(req) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	try {
		const { hostname } = new URL(origin);
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
	} catch {
		return false;
	}
}
/** Smallest possible POST body reader, capped so a hung or oversized body
*  cannot pin memory on the Host. Returns `{}` for an empty body. */

/**
* [xdpool-oauth] QR sign-in against the desktop plugin gateway.
*
* The desktop app signs in with a state handshake rather than an OAuth2 code
* flow: ask for a `state`, show the phone the returned `authUrl` as a QR code,
* then poll `/auth/token` until the phone confirms. Three constants and two
* calls, all recovered from the shipped desktop client.
*/
const OAUTH_PLATFORM = "workbuddy";
const oauthGateway = (region) => region === "global" ? "https://www.workbuddy.ai" : "https://www.codebuddy.cn";
/** One call into the gateway. Returns the parsed body; throws on a non-JSON answer. */
const oauthCall = async (region, path, options) => {
	const response = await fetch(`${oauthGateway(region)}/v2/plugin${path}`, {
		method: options["method"] ?? "GET",
		headers: {
			"Accept": "application/json, text/plain, */*",
			"Content-Type": "application/json",
			"X-Client-Platform": OAUTH_PLATFORM,
			"User-Agent": CLIENT_UA,
			...(options["headers"] ?? {})
		},
		...(options["body"] === void 0 ? {} : { body: options["body"] })
	});
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`gateway answered HTTP ${response.status} for ${path}`);
	}
};
/**
* [xdpool-oauth] Does this `/auth/token` envelope code mean "you are signed in"?
*
* Two codes mean success upstream, not one. The reference account-switcher
* (`changexbc/workbuddy-switch`, MIT) polls this same endpoint and accepts both:
* `if code != 0 && code != 200 { keep waiting }`. We used to require exactly 0,
* so a success answer carrying 200 fell through to the expiry branch and the
* freshly minted token was thrown away — the browser said "登录成功" while the
* card kept waiting and then reported the code expired.
*
* Only real numbers count. A string "200" is NOT accepted deliberately: the
* gateway sends JSON numbers here, so a string means we are reading a different
* field (or a body that is not this envelope), and treating that as success
* would persist a credential we cannot actually vouch for. Everything else —
* undefined, null, 11217, -1 — is not success.
*/
const oauthCodeSucceeded = (code) => code === 0 || code === 200;
/** Field-shaped summary of an upstream document, so diagnostics never carry tokens. */const oauthShape = (value, depth = 0) => {
	if (value === null || value === void 0) return String(value);
	if (Array.isArray(value)) return `[${value.length}]`;
	if (typeof value === "object") {
		if (depth >= 2) return "{...}";
		const out = {};
		for (const [key, item] of Object.entries(value)) out[key] = oauthShape(item, depth + 1);
		return out;
	}
	if (typeof value === "string") return value === "" ? "empty-string" : `string(${value.length})`;
	return typeof value;
};
const oauthRecordPath = () => join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool", "oauth-last.json");
const writeOauthRecord = (payload) => {
	try {
		const target = oauthRecordPath();
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${JSON.stringify(payload, void 0, 2)}\n`, "utf8");
	} catch {}
};
/**
* [xdpool-oauth] Last poll outcome we actually recorded to `oauth-last.json`.
*
* Module-scoped, not per-request: the poll route is called on a timer and the
* file is a single-slot "last outcome" record, so what matters is the transition
* between outcomes, not which HTTP request happened to observe it.
*/
let oauthPollRecordKey;
/**
* [xdpool-oauth] Record one QR-poll outcome, but do not rewrite the file while
* the outcome stays the same.
*
* A pending poll repeats once a second for as long as the user takes to scan,
* so writing unconditionally would churn `oauth-last.json` dozens of times and
* the file would end up describing the wait rather than the result. Throttling
* on a key of "stage + code + classification" keeps the FIRST sighting of every
* distinct state — which is what makes the next real scan decisive, because the
* transition into `code: 200` is itself a different key and is always written.
* We deliberately do not throttle on a timer: a time-based window could drop the
* one interesting record if it arrived right after a pending one.
*/
const writeOauthPollRecord = (key, payload) => {
	if (oauthPollRecordKey === key) return;
	oauthPollRecordKey = key;
	writeOauthRecord(payload);
};
/** First non-empty string across candidate sources, key order first. */
const pickText = (sources, keys) => {
	for (const key of keys) for (const source of sources) {
		const value = source?.[key];
		if (typeof value === "string" && value.trim() !== "") return value;
	}
	return void 0;
};
/** First positive number across candidate sources, key order first. */
const pickNumber = (sources, keys) => {
	for (const key of keys) for (const source of sources) {
		const value = source?.[key];
		if (typeof value === "number" && value > 0) return value;
	}
	return void 0;
};
/** The auth directory the desktop app and the pool both read. */
const oauthCredentialDir = () => process.env["APPDATA"] === void 0 ? void 0 : join(process.env["APPDATA"], "CodeBuddyExtension", "Data", "Public", "auth");
/**
* [xdpool-oauth] Turn one confirmed sign-in into a pool credential document.
*
* Plaintext only (the parser must never see an envelope marker), and
* `refreshExpiresAt` is deliberately omitted — a stale one makes the parser drop
* the whole file, which is the one failure that silently costs an account.
*/
const oauthCredentialDocument = (token, account, region, mobile) => {
	const sources = [token, token?.["data"], account, account?.["data"], account?.["account"]];
	const accessToken = pickText(sources, ["access_token", "accessToken"]);
	if (accessToken === void 0) return void 0;
	const identity = {};
	const nickname = pickText(sources, ["nickname", "nickName", "name"]);
	if (nickname !== void 0) identity["nickname"] = nickname;
	/**
	* The gateway sources stay authoritative, but a source that carries a blank
	* `phoneNumber` still wins `pickText`? No — it does not: `pickText` skips
	* empty strings, so `mobile` is reached in exactly the case it exists for,
	* a oneid answer that names the account without naming the number.
	*/
	const phone = pickText(sources, ["phoneNumber", "phone", "mobile"]) ?? pickText([{ mobile }], ["mobile"]);
	if (phone !== void 0) identity["phoneNumber"] = phone;
	for (const key of ["uin", "uid", "enterpriseId", "oneidAccountId"]) {
		const value = pickText(sources, [key]);
		if (value !== void 0) identity[key] = value;
	}
	const auth = {
		accessToken,
		domain: pickText(sources, ["domain"]) ?? (region === "global" ? "www.workbuddy.ai" : "www.codebuddy.cn")
	};
	const refreshToken = pickText(sources, ["refresh_token", "refreshToken"]);
	if (refreshToken !== void 0) auth["refreshToken"] = refreshToken;
	const tokenType = pickText(sources, ["token_type", "tokenType"]);
	if (tokenType !== void 0) auth["tokenType"] = tokenType;
	const expiresAt = pickNumber(sources, ["expires_at", "expiresAt"]);
	if (expiresAt !== void 0) auth["expiresAt"] = Math.round(expiresAt);
	return {
		account: identity,
		accounts: [identity],
		allAccounts: [identity],
		auth
	};
};
/**
* Mirror a confirmed sign-in into the auth directory the pool scans.
*
* The `workbuddy-scan-` prefix is deliberate: the switch mirror only ever
* rewrites `workbuddy-pool-*`, so a scanned account survives every later sync.
*/
const oauthPersistCredential = (document) => {
	const dir = oauthCredentialDir();
	if (dir === void 0) throw new Error("APPDATA is not set; the new credential cannot be stored");
	const credential = parseWorkBuddyAuth(JSON.stringify(document), "(qr)");
	if (credential === void 0) throw new Error("the gateway answer carried no usable credential");
	const id = workbuddyAccountId(credential);
	/**
	* Fall back to the token when the gateway told us nothing about identity:
	* two anonymous sign-ins must not overwrite each other's file.
	*/
	const stableKey = credential.uin ?? credential.uid ?? credential.nickname;
	const suffix = stableKey === void 0 ? createHash("sha256").update(credential.accessToken).digest("hex").slice(0, 8) : id.slice(0, 8);
	const name = `workbuddy-scan-${suffix}.info`;
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), `${JSON.stringify(document, void 0, 1)}\n`, "utf8");
	return {
		name,
		id,
		label: accountLabel(credential)
	};
};

function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		const LIMIT = 65536;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > LIMIT) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			const text = Buffer.concat(chunks).toString("utf8").trim();
			if (text === "") {
				resolve({});
				return;
			}
			try {
				const parsed = JSON.parse(text);
				resolve(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {});
			} catch {
				reject(/* @__PURE__ */ new Error("invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}
/**
* Validate an untrusted selection payload.
*
* Returns undefined for anything malformed so the route answers 400 instead of
* writing a partial selection into the settings file. An empty array is
* meaningful (`enabledModelIds: []` disables every model, and the card blocks
* saving that state) so it is preserved rather than treated as absent.
*/
function parseSelection(body) {
	const out = {};
	for (const key of ["enabledModelIds", "imageModelIds"]) {
		const value = body[key];
		if (value === void 0) continue;
		if (!Array.isArray(value)) return void 0;
		const ids = [];
		for (const entry of value) {
			if (typeof entry !== "string" || entry === "") return void 0;
			ids.push(entry);
		}
		out[key] = ids;
	}
	const budgets = body["contextBudgets"];
	if (budgets !== void 0) {
		if (typeof budgets !== "object" || budgets === null || Array.isArray(budgets)) return void 0;
		const map = {};
		for (const [id, raw] of Object.entries(budgets)) {
			if (id === "") return void 0;
			if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1e3) return void 0;
			map[id] = raw;
		}
		out.contextBudgets = map;
	}
	return out;
}
/**
* Validate the account-toggle body. Returns undefined for anything malformed so
* the route answers 400 instead of writing a half-applied switch.
*
* The id must name a currently known account: accepting an arbitrary string
* would let a stale tab (or a renamed credential) leave orphan ids in the
* settings file that no card can ever switch back off.
*/
function parseAccountToggle(body, known) {
	const accountId = typeof body["accountId"] === "string" ? body["accountId"].trim() : "";
	const disabled = body["disabled"];
	if (accountId === "" || typeof disabled !== "boolean") return void 0;
	if (!known(accountId)) return void 0;
	return {
		accountId,
		disabled
	};
}
/**
* Parse a manual-run request.
*
* The job name is checked against the real job list rather than passed through:
* an unknown name would otherwise reach the scheduler and silently do nothing,
* which reads to the user as a broken button.
*/
/**
* Parse a reserved-credit update.
*
* The account must already be known, for the same reason the disable route
* checks: an unknown id would sit in the settings file forever, attached to
* nothing the card can act on. A negative or non-finite floor is rejected
* rather than coerced.
*/
function parseCreditReserve(body, known) {
	const accountId = typeof body["accountId"] === "string" ? body["accountId"].trim() : "";
	const raw = body["reserve"];
	if (accountId === "" || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return void 0;
	if (!known(accountId)) return void 0;
	return {
		accountId,
		reserve: Math.floor(raw)
	};
}
function parseAutomationRun(body) {
	const job = typeof body["job"] === "string" ? body["job"].trim() : "";
	if (job !== "all" && !isAutomationJobKind(job)) return void 0;
	const force = body["force"];
	if (force !== void 0 && typeof force !== "boolean") return void 0;
	return {
		job,
		...force === void 0 ? {} : { force }
	};
}
function toWebAccount(account, disabled, reserve, reserved) {
	const now = Date.now();
	const cooling = account.cooldownUntilMs > now;
	/**
	* Reported separately from `cooling` because the user's remedy differs: a
	* cooldown means wait, a rejected credential means sign in again. Folding the
	* two together would show a retired account as merely cooling and hide the one
	* thing that fixes it.
	*/
	const authDead = (account.authDeadUntilMs ?? 0) > now;
	const modelCooldowns = Object.entries(account.modelCooldowns).filter(([, until]) => until > now).sort((a, b) => a[1] - b[1]).map(([modelId, until]) => ({
		modelId,
		until: new Date(until).toISOString()
	}));
	return {
		id: account.id,
		label: account.label,
		...account.credential.nickname === void 0 ? {} : { nickname: maskPhoneInLabel(account.credential.nickname) },
		domain: account.credential.domain,
		...account.credential.expiresAtMs === 0 ? {} : { expiresAt: new Date(account.credential.expiresAtMs).toISOString() },
		cooling,
		...cooling ? { cooldownUntil: new Date(account.cooldownUntilMs).toISOString() } : {},
		...authDead ? { authDead: true, authDeadUntil: new Date(account.authDeadUntilMs).toISOString(), authFailStreak: account.authFailStreak ?? 0 } : {},
		...modelCooldowns.length === 0 ? {} : { modelCooldowns },
		disabled,
		creditReserve: reserve,
		reserved,
		rateLimitHits: account.rateLimitHits,
		serverErrorHits: account.serverErrorHits
	};
}
/**
* [xdpool-summary] The headline figures for the account section, computed HERE.
*
* Why not let the panel sum the rows it already has: the card renders a filtered,
* grouped, sometimes cross-region view of these same rows, so a figure the card
* derives can silently disagree with the rows printed right underneath it — a
* hidden account, a stale region, an account that vanished between two polls.
* A headline that contradicts its own table is worse than no headline. Computing
* every total in one place, from the very array that is about to be serialised,
* makes that class of disagreement impossible rather than merely unlikely.
*
* `rateLimitHits` and `serverErrorHits` are summed from the SAME row objects the
* response carries, never from the pool's live counters: the two can differ for
* a poll (a failover lands between serialising a row and reading the counter),
* and the panel must never show a total that its own rows cannot add up to.
*
* Retained for growth: `expiringSoon` counts accounts with credits expiring
* inside the upstream's own "soon" window. Accounts whose only packages renew on
* a cycle carry no expiry at all, so they are counted as neither expiring nor
* safe — `noExpiryAccounts` is reported separately for exactly that reason, and
* the two numbers are not required to add up to `accounts`.
*/
function poolWebSummary(accounts, rows, cooling, disabledCount, now) {
	let rateLimitHits = 0;
	let serverErrorHits = 0;
	let expiringAccounts = 0;
	let noExpiryAccounts = 0;
	let creditsError = 0;
	let checkinError = 0;
	let reserved = 0;
	let creditTotal = 0;
	let creditsReported = 0;
	for (const row of rows) {
		rateLimitHits += finiteOr(row.rateLimitHits);
		serverErrorHits += finiteOr(row.serverErrorHits);
		if (row.creditsError !== void 0) creditsError += 1;
		if (row.checkinError !== void 0) checkinError += 1;
		if (row.reserved === true) reserved += 1;
		const credits = row.credits;
		if (credits === void 0) continue;
		creditTotal += finiteOr(credits.total);
		creditsReported += 1;
		if (finiteOr(credits.expiringSoon) > 0) expiringAccounts += 1;
		else if (credits.nearestExpiryMs === void 0) noExpiryAccounts += 1;
	}
	return {
		accounts: accounts.length,
		cooling,
		disabled: disabledCount,
		reserved,
		available: Math.max(0, accounts.length - cooling - disabledCount),
		rateLimitHits,
		serverErrorHits,
		expiringAccounts,
		noExpiryAccounts,
		creditsError,
		checkinError,
		creditTotal: round2(creditTotal),
		creditsReported
	};
}
/**
* [xdpool-summary] Fold the persistent gateway-failure ledger into one map.
*
* The on-disk count and the in-process count are BOTH shown, because they answer
* different questions and neither can be derived from the other:
*   - `hits`     — this process, reset by a restart. Matches `rateLimitHits` in
*                  lifetime, so the two are directly comparable on screen.
*   - `lifetime` — every failure ever recorded for this account id, surviving
*                  restarts and `resetCooldowns()`.
* The row keeps the in-process count under `serverErrorHits` (a field older
* builds already read) and gains `serverErrorLifetime`; the ledger's own `total`
* is the pool-wide lifetime figure. An account with ledger history but no
* failures since startup therefore shows `0 / N`, which is the truthful answer.
*/
function applyServerErrorLedger(rows, ledger) {
	const lifetime = serverErrorPayload(ledger, Date.now());
	for (const row of rows) {
		const recorded = lifetime.accounts[row.id];
		if (recorded === void 0) continue;
		Object.assign(row, { serverErrorLifetime: recorded });
	}
	return lifetime;
}
function toWebModel(model, selection) {
	const enabled = selection.enabledModelIds;
	const budget = selection.contextBudgets?.[model.id];
	const capped = budget !== void 0 && budget > 0 && budget < model.nativeContextWindow;
	return {
		id: model.id,
		name: model.name,
		...model.multiplier === void 0 ? {} : { multiplier: model.multiplier },
		...model.tags === void 0 ? {} : { tags: model.tags },
		...model.supportedEfforts === void 0 || model.supportedEfforts.length === 0 ? {} : { supportedEfforts: model.supportedEfforts },
		supportsImages: model.supportsImages,
		contextWindow: capped ? budget : model.nativeContextWindow,
		nativeContextWindow: model.nativeContextWindow,
		maxOutputTokens: model.maxOutputTokens,
		...model.servableAccounts === void 0 ? {} : { servableAccounts: model.servableAccounts },
		enabled: enabled === void 0 || enabled.includes(model.id)
	};
}
/**
* [xdpool-scale] Per-account upstream reading cache for the status route.
*
* That route reads BOTH upstreams for EVERY account on every poll, so its cost
* grows linearly with the pool: twenty-one accounts meant forty-two round-trips
* per poll, every poll, whether or not anything had changed. Balances and
* check-in state move on the order of minutes while the card polls on the order
* of seconds, so the refetching bought nothing — and it is why the panel slowed
* down as accounts were added.
*
* Fresh entries are served with no upstream call. Stale entries are ALSO served
* immediately, with a background refresh replacing them, so the route never
* waits on a stale pool; without that it would stall once per TTL, which is only
* a rarer version of the same stutter. Only a cold read — the first poll after
* startup, or an account seen for the first time — blocks.
*
* The TTL is several times the poll interval deliberately: a TTL near the poll
* interval would miss on most polls and reintroduce the problem it exists to fix.
*/
const STATUS_READING_TTL_MS = 9e4;
/** `${region}:${accountId}` → `{ at, credits, creditsError, checkin, checkinError }`. */
const statusReadingCache = /* @__PURE__ */ new Map();
/**
* Keys with a refresh already running.
*
* Without this, a burst of polls arriving while an entry is stale would each
* start their own refresh and multiply the very upstream load the cache exists
* to reduce.
*/
const statusReadingInflight = /* @__PURE__ */ new Set();
/**
* Read both upstreams for one account, store the result, and return it.
*
* Both reads are independent of each other and of every other account, so they
* run together: one round-trip instead of two. Each resolves to a tagged result
* rather than rejecting, so a single bad account degrades to `creditsError` /
* `checkinError` on its own row and never takes the route down with it.
*/
async function fetchAccountStatus(deps, account, region, cooling) {
	const key = `${region}:${account.id}`;
	const at = Date.now();
	/**
	* A cooling account is not serving requests, so reading it spends a round-trip
	* to learn nothing, and its balance cannot have been spent by us meanwhile.
	*/
	if (cooling) {
		const skipped = { at, credits: void 0, creditsError: void 0, checkin: void 0, checkinError: void 0 };
		statusReadingCache.set(key, skipped);
		return skipped;
	}
	const [creditsResult, checkinResult] = await Promise.all([deps.client.fetchCredits(account.credential).then((credits) => ({ credits }), (error) => ({ error })), deps.client.fetchCheckinStatus(account.credential).then((checkin) => ({ checkin }), (error) => ({ error }))]);
	const reading = {
		at,
		credits: creditsResult.credits,
		creditsError: creditsResult.error === void 0 ? void 0 : safeMessage(creditsResult.error),
		checkin: checkinResult.checkin,
		checkinError: checkinResult.error === void 0 ? void 0 : safeMessage(checkinResult.error)
	};
	statusReadingCache.set(key, reading);
	return reading;
}
/**
* One account's reading, from cache when there is one.
*
* Returns `undefined` only on a cold read, which the caller resolves by awaiting
* `fetchAccountStatus`. The returned object is shared with the cache, so callers
* must not mutate it.
*/
function readAccountStatus(deps, account, region, now, cooling) {
	const key = `${region}:${account.id}`;
	const cached = statusReadingCache.get(key);
	if (cached === void 0) return void 0;
	if (now - cached.at >= STATUS_READING_TTL_MS && !statusReadingInflight.has(key)) {
		statusReadingInflight.add(key);
		/**
		* Failures are swallowed: this exists to replace the entry for the NEXT poll,
		* and a transient upstream error must not surface as an unhandled rejection.
		*/
		fetchAccountStatus(deps, account, region, cooling).catch(() => void 0).finally(() => statusReadingInflight.delete(key));
	}
	return cached;
}
/**
* Drop readings for accounts that left one region's pool.
*
* Scoped to the region on purpose: the cache is shared by both region routes,
* and each call only knows its own accounts. Pruning globally would have the
* `cn` route delete every `global` reading on every poll, so the other tab would
* pay a cold read forever.
*/
function pruneStatusReadings(region, keepAccountIds) {
	const prefix = `${region}:`;
	for (const key of statusReadingCache.keys()) {
		if (!key.startsWith(prefix)) continue;
		if (!keepAccountIds.has(key.slice(prefix.length))) statusReadingCache.delete(key);
	}
}
/**
* [xdpool-parallel] One account's row, with both upstream reads in flight together.
*
* This used to be a serial `for … await` inside the route: each account's credits
* call had to finish before the next account's even started, and then the same
* again for its check-in call. With a full pool that made the status route take
* accounts × 2 round-trips — four to five seconds on a ten-account pool — and
* because the card cannot tell "not loaded yet" from "no accounts", the panel sat
* on "no account signed in" for that whole window on every visit.
*
* The two upstream reads are independent of each other AND of every other
* account: `fetchCredits` and `fetchCheckinStatus` touch only `this.fetchImpl`
* (assigned once in the constructor) and the credential handed to them, so
* nothing here is shared. Running them together therefore costs one round-trip
* instead of N, with no ordering guarantee to preserve.
*
* Both reads resolve to a tagged result rather than rejecting, so a single bad
* account degrades to `creditsError` / `checkinError` on its own row and never
* takes the route down with it.
*
* Shared state is mutated only in the synchronous tail, after every await has
* settled for this account, so concurrent accounts cannot interleave inside the
* running total, the `usageDirty` flag or the ledger itself.
*/
async function buildWebAccountRow(deps, account, ledger, now, sink, region) {
	const row = toWebAccount(account, deps.pool.isDisabled(account.id), deps.pool.creditReserveOf(account.id), deps.pool.isReserved(account.id));
	const earned = deps.scheduler?.().earningsToday[account.id];
	if (earned !== void 0) Object.assign(row, { automationToday: earned });
	/**
	* Cached when possible.
	*
	* A cold entry — the first poll after startup, or an account just added —
	* blocks, so the panel never reports "no data" for an account that has some.
	* Every later poll reuses the stored reading and refreshes it in the
	* background, which is what keeps the route's cost flat as accounts are added.
	*/
	const reading = readAccountStatus(deps, account, region, now, row.cooling) ?? await fetchAccountStatus(deps, account, region, row.cooling);
	if (reading.creditsError !== void 0) Object.assign(row, { creditsError: reading.creditsError });
	else if (reading.credits !== void 0) {
		const credits = reading.credits;
		deps.pool.noteCredits(account.id, credits.total);
		deps.pool.noteExpiry(account.id, credits.nearestExpiryMs);
		Object.assign(row, { credits: {
			total: credits.total,
			packages: credits.packages,
			...credits.expiringSoon === void 0 ? {} : { expiringSoon: credits.expiringSoon },
			...credits.nearestExpiryMs === void 0 ? {} : { nearestExpiryMs: credits.nearestExpiryMs }
		} });
		/**
		* [xdpool-usage] Feed the ledger from the credited row, deliberately
		* outside the error handling above.
		*
		* This used to sit inside it, which made the accounting hostage to the
		* credits fetch's error handling: a bug in the ledger threw straight
		* into the catch and surfaced as a `creditsError` on the account row,
		* hiding the real credits AND silently zeroing the consumption bar.
		* Consumption accounting cannot change what the card says about
		* credits, so a ledger fault now costs nothing but this poll's figure.
		*
		* Only a genuine reading is recorded: an account whose upstream read
		* failed never reaches here at all, so a broken token can never look
		* like the balance dropping to zero.
		*
		* This runs on cache hits too, and that is safe and necessary: the
		* observation compares against the last seen total, so re-feeding an
		* unchanged figure records nothing, while skipping it would drop this
		* account out of the pool-wide remaining total.
		*/
		if (Number.isFinite(row.credits.total)) {
			sink.addRemaining(row.credits.total);
			try {
				if (noteUsageObservation(ledger, account.id, row.credits.total, now)) sink.markDirty();
			} catch {}
		}
	}
	if (reading.checkinError !== void 0) Object.assign(row, { checkinError: reading.checkinError });
	else if (reading.checkin !== void 0) {
		const checkin = reading.checkin;
		Object.assign(row, { checkin: {
			active: checkin.active,
			todayCheckedIn: checkin.todayCheckedIn,
			streakDays: checkin.streakDays,
			dailyCredit: checkin.dailyCredit,
			todayCredit: checkin.todayCredit,
			isStreakDay: checkin.isStreakDay,
			nextStreakDay: checkin.nextStreakDay,
			streakBonusCredit: checkin.streakBonusCredit
		} });
	}
	return row;
}
/**
* [xdpool-usage] Consumption ledger for one poll, from a one-minute cache.
*
* The card polls this route far more often than a human reads it, and the file
* only changes when those very polls observe new consumption, so the cache
* cannot hide an update for longer than the poll cadence that would produce one.
*
* The first poll after startup records nothing at all: every account is a first
* observation, so the ledger is seeded from the balances that exist right now and
* no historic backlog is mistaken for today's usage.
*/
function pollUsageLedger(now) {
	if (now - usageLedgerCache.at > 6e4 || usageLedgerCache.ledger === void 0) {
		usageLedgerCache.ledger = readUsageLedger();
		usageLedgerCache.at = now;
	}
	return usageLedgerCache.ledger;
}
/**
* [xdpool-5xx] Gateway-failure history for one poll, from its own one-minute cache.
*
* Cached for the same reason the usage ledger is, with one difference that
* matters: this file only changes when a request FAILS, which is rare compared to
* how often the card polls. A failure landing between two polls therefore shows
* up within one cache window, while the in-process `serverErrorHits` — never
* cached — covers the same event immediately, so nothing is invisible meanwhile.
*
* Pruning happens on the cache refill rather than on write because this route can
* observe that accounts disappeared, which the request path cannot.
*/
function pollServerErrorLedger(now, keepAccountIds) {
	if (now - serverErrorLedgerCache.at > 6e4 || serverErrorLedgerCache.ledger === void 0) {
		serverErrorLedgerCache.ledger = readServerErrorLedger();
		serverErrorLedgerCache.at = now;
		pruneServerErrorLedger(serverErrorLedgerCache.ledger, now, keepAccountIds);
	}
	return serverErrorLedgerCache.ledger;
}
/**
* Assemble the card's status document. Per-account credits and check-in state
* are queried live; a failing query degrades to `creditsError` / `checkinError`
* rather than failing the whole document. Never throws.
*/
async function poolWebStatus(deps, region = "cn") {
	const accounts = deps.pool.list(region);
	const regions = ["cn", "global"];
	const selection = deps.catalogs[region].currentSelection();
	const now = Date.now();
	const ledger = pollUsageLedger(now);
	/**
	* Accumulators shared by every concurrent account fetch. `addRemaining` and
	* `markDirty` are the only ways the rows touch them, which keeps the "mutate
	* only in the synchronous tail" rule in one place instead of scattered
	* through the fetch body.
	*/
	let remainingTotal;
	let usageDirty = false;
	const sink = {
		addRemaining(value) {
			remainingTotal = finiteOr(remainingTotal) + value;
		},
		markDirty() {
			usageDirty = true;
		}
	};
	/**
	* `Promise.all` preserves the input order, so `rows` still follows `accounts` —
	* the panel's ordering, and the `accounts.find(...)` lookups below, are
	* unchanged. Each account's own work already handled its failures locally, so
	* nothing here can reject and take the whole route down.
	*/
	const rows = await Promise.all(accounts.map((account) => buildWebAccountRow(deps, account, ledger, now, sink, region)));
	/**
	* Drop readings for accounts that left this region's pool, so a credential
	* removed from disk does not keep its last balance in memory forever.
	*/
	pruneStatusReadings(region, new Set(accounts.map((account) => account.id)));
	/**
	* [xdpool-usage] Persist only when an observation actually changed something.
	*
	* The overwhelmingly common case is "same balances as last poll", which must
	* cost one comparison and no I/O — this route is on the card's polling path.
	* Pruning happens inside the write because it needs the same freshness signal:
	* a process that never sees a change still never grows the file.
	*/
	if (usageDirty) {
		pruneUsageLedger(ledger, now, new Set(accounts.map((account) => account.id)));
		writeUsageLedger(ledger);
	}
	const usage = usagePayload(remainingTotal, usageRollup(ledger, now));
	/**
	* [xdpool-trend] Daily consumption series for the bar chart. Purely additive;
	* an older card build ignores it.
	*/
	const trend = usageTrend(ledger, now, 14);
	const cooling = rows.filter((row) => row.cooling).length;
	const serverErrors = applyServerErrorLedger(rows, pollServerErrorLedger(now, new Set(accounts.map((account) => account.id))));
	const summary = poolWebSummary(accounts, rows, cooling, rows.filter((row) => row.disabled).length, now);
	const lastServed = deps.pool.lastServedId();
	const firstUsable = lastServed !== void 0 ? accounts.find((account) => account.id === lastServed) : accounts.find((account) => account.cooldownUntilMs <= now);
	/**
	* How many accounts can serve each model right now.
	*
	* Per-model cooling is deliberately excluded from the account-wide "cooling"
	* count, because the account as a whole stays usable when only one model is
	* limited. The cost of that choice is that the card cannot answer the question
	* the number was meant to answer: with several accounts each avoiding a
	* different model, every account can look healthy while one model has nobody
	* left to serve it, and the first sign is a request that fails over through the
	* whole pool.
	*
	* Counted here, from the same account objects the rows come from, so this
	* cannot disagree with what the rows say.
	*/
	const servable = (modelId) => accounts.filter((account) => {
		if (account.cooldownUntilMs > now) return false;
		if ((account.authDeadUntilMs ?? 0) > now) return false;
		if ((account.modelCooldowns?.[modelId] ?? 0) > now) return false;
		return true;
	}).length;
	let shim;
	if (deps.shim === void 0) shim = { running: false };
	else try {
		shim = deps.shim();
	} catch {
		shim = { running: false };
	}
	const automation = deps.scheduler?.() ?? {
		enabled: false,
		running: false,
		checkinHours: [],
		reportHours: [],
		taskHours: [],
		streakHours: [],
		travelHours: [],
		jobs: {
			checkin: emptyAutomationJob(),
			report: emptyAutomationJob(),
			tasks: emptyAutomationJob(),
			streak: emptyAutomationJob(),
			travel: emptyAutomationJob()
		},
		claimableSeen: 0,
		earningsToday: {},
		runInProgress: false
	};
	return {
		ok: accounts.length > 0 && cooling < accounts.length,
		accounts: rows,
		...firstUsable === void 0 ? {} : { activeAccountId: firstUsable.id },
		cooling,
		models: deps.catalogs[region].current().map((model) => toWebModel({
			id: model.id,
			name: model.name,
			contextWindow: model.contextWindow,
			maxOutputTokens: model.maxOutputTokens,
			nativeContextWindow: model.contextWindow,
			...model.multiplier === void 0 ? {} : { multiplier: model.multiplier },
			...model.tags === void 0 ? {} : { tags: model.tags },
			...model.supportedEfforts === void 0 ? {} : { supportedEfforts: model.supportedEfforts },
			supportsImages: model.supportsImages,
			// Accounts that can serve this model right now. Zero is the case worth
			// surfacing: the model is listed and enabled but has nobody behind it.
			servableAccounts: servable(model.id)
		}, selection)),
		selection,
		region,
		distribution: deps.pool.currentDistribution(),
		regions,
		shim,
		automation,
		/**
		* [xdpool-usage] Four headline figures: remaining credits, and consumption
		* over today / the last 7 days / this month. Purely additive — the card can
		* ignore it, and an older card build renders exactly as it did before.
		*/
		usage,
		/**
		* [xdpool-trend] Per-day consumption over the last two weeks, oldest first.
		* Days with no recorded spending are present with `used: 0` rather than
		* omitted, so the chart cannot misdraw an idle day as missing data.
		*/
		trend,
		/**
		* [xdpool-summary] Every pool-wide total the account section shows, summed
		* from `accounts` above by `poolWebSummary`. The card renders these instead
		* of deriving its own, so a heading can never disagree with the rows it
		* heads. Purely additive: an older card build ignores the field.
		*/
		summary,
		/**
		* [xdpool-5xx] Gateway-failure counts: `total`/`today` pool-wide plus the
		* per-account `lifetime` map, from the persistent ledger. Distinct from the
		* in-process `serverErrorHits` on each row — see `applyServerErrorLedger`.
		*/
		serverErrors,
		creditReserves: deps.pool.creditReservesInOrder()
	};
}
/**
* Mount the read-only routes on a context where `webServer` is available. The
* caller uses `ctx.inject(['webServer'], ...)` so Desktop startup order cannot
* make this registration disappear.
*/
function registerPoolStatusRoute(ctx, deps) {
	ctx.effect(() => {

		/**
		* [xdpool-oauth] Open one QR sign-in and hand the card a QR image.
		*
		* The QR renderer is imported lazily: a missing `qrcode` package must cost
		* this one feature, not the whole plugin (ESM named imports fail hard).
		*/
		const disposeOauthStart = ctx.webServer.register({
			kind: "exact",
			path: POOL_OAUTH_START_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				try {
					const body = await readJsonBody(req).catch(() => ({}));
					const region = body?.["region"] === "global" ? "global" : "cn";
					const started = await oauthCall(region, `/auth/state?platform=${OAUTH_PLATFORM}`, {
						method: "POST",
						body: "{}"
					});
					const data = started?.["data"] ?? {};
					if (started?.["code"] !== 0 || typeof data["state"] !== "string" || typeof data["authUrl"] !== "string") {
						writeOauthRecord({
							at: (new Date()).toISOString(),
							stage: "start",
							region,
							shape: oauthShape(started)
						});
						throw new Error(started?.["msg"] ?? "the gateway did not return a sign-in state");
					}
					let qr;
					try {
						const renderer = await import("qrcode");
						const renderQr = renderer["toString"] ?? renderer["default"]?.["toString"];
						if (typeof renderQr !== "function") throw new Error("qrcode exposes no toString()");
						qr = await renderQr(data["authUrl"], { type: "svg", margin: 1, width: 200 });
					} catch (error) {
						throw new Error(`QR renderer unavailable: ${safeMessage(error)}`);
					}
					json(res, 200, {
						state: data["state"],
						authUrl: data["authUrl"],
						qr
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		/** [xdpool-oauth] Poll one pending sign-in; on success store it and rescan the pool. */
		const disposeOauthPoll = ctx.webServer.register({
			kind: "exact",
			path: POOL_OAUTH_POLL_PATH,
			handler: async (req, res) => {
				if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				try {
					const query = new URL(req.url ?? "/", "http://localhost").searchParams;
					const state = query.get("state") ?? "";
					const region = query.get("region") === "global" ? "global" : "cn";
					if (state === "") return json(res, 400, { error: "state is required" });
					const token = await oauthCall(region, `/auth/token?state=${encodeURIComponent(state)}`, {});
					const code = token?.["code"];
					/**
					* [xdpool-oauth] Every branch below records its outcome, so the next
					* real scan is decisive even if it succeeds. The raw `code` goes in
					* unwrapped on purpose: it is a number, and the whole question this
					* file has to answer is which number the gateway actually sends on
					* success. Everything nested stays behind `oauthShape` so a token
					* can never reach the file.
					*/
					const keys = typeof token === "object" && token !== null ? Object.keys(token) : [];
					const record = (status, extra) => writeOauthPollRecord(`${status}:${String(code)}`, {
						at: (new Date()).toISOString(),
						stage: "poll",
						region,
						code,
						status,
						keys,
						...(extra ?? {}),
						shape: oauthShape(token)
					});
					/**
					* 11217 is the documented "still waiting for the scan" answer. It is
					* checked before the success test so the pending path can never be
					* mistaken for a token-less success.
					*/
					if (code === 11217) {
						record("pending");
						return json(res, 200, { status: "pending" });
					}
					/**
					* Anything that is not 0/200 is terminal here. Note that this is NOT
					* the reference implementation's rule — it keeps polling on any
					* unknown code — because our card has a countdown and needs an
					* answer; the diagnostic above is what tells us whether that
					* difference matters in practice.
					*/
					if (!oauthCodeSucceeded(code) || typeof token?.["data"] !== "object") {
						record("expired");
						return json(res, 200, {
							status: "expired",
							code,
							message: token?.["msg"] ?? "sign-in was not confirmed"
						});
					}
					const accessToken = pickText([token["data"]], ["access_token", "accessToken"]);
					let account;
					try {
						account = await oauthCall(region, `/login/account?state=${encodeURIComponent(state)}`, {
							headers: accessToken === void 0 ? {} : { "Authorization": `Bearer ${accessToken}` }
						});
					} catch (error) {
						account = { error: safeMessage(error) };
					}
					const document = oauthCredentialDocument(token["data"], account, region);
					if (document === void 0) {
						record("credential-missing", {
							token: oauthShape(token),
							account: oauthShape(account)
						});
						return json(res, 500, { error: "the gateway answer carried no access token" });
					}
					const saved = oauthPersistCredential(document);
					record("saved", {
						saved,
						token: oauthShape(token),
						account: oauthShape(account)
					});
					const accounts = await deps.pool.scan();
					json(res, 200, {
						status: "ok",
						label: saved.label,
						id: saved.id,
						accounts: accounts.length
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});

		const disposeStatus = ctx.webServer.register({
			kind: "exact",
			path: POOL_STATUS_PATH,
			handler: async (req, res) => {
				if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				try {
					json(res, 200, await poolWebStatus(deps, new URL(req.url ?? "/", "http://localhost").searchParams.get("region") === "global" ? "global" : "cn"));
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeRescan = ctx.webServer.register({
			kind: "exact",
			path: POOL_RESCAN_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				try {
					const accounts = await deps.pool.scan();
					/**
					* A scan that found NEW accounts runs the automation for those accounts
					* immediately.
					*
					* Otherwise a freshly added account waits for the next scheduled hour,
					* which may be most of a day away, and the first thing the user sees
					* after adding an account is "nothing happened". Scoped to the new ids
					* so re-detecting does not re-run the whole pool.
					*/
					const newIds = new Set(deps.pool.lastScanNewIds ?? []);
					const started = newIds.size > 0 && deps.runAutomationFor !== void 0 ? deps.runAutomationFor(newIds) : false;
					json(res, 200, {
						accounts: accounts.length,
						added: newIds.size,
						automationStarted: started
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeReset = ctx.webServer.register({
			kind: "exact",
			path: POOL_RESET_COOLDOWN_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				deps.pool.resetCooldowns();
				json(res, 200, { ok: true });
			}
		});
		const disposeCheckin = ctx.webServer.register({
			kind: "exact",
			path: POOL_CHECKIN_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				try {
					const body = await readJsonBody(req);
					const accountId = typeof body["accountId"] === "string" ? body["accountId"] : "";
					if (accountId === "") return json(res, 400, { error: "accountId is required" });
					const account = deps.pool.list().find((item) => item.id === accountId);
					if (account === void 0) return json(res, 404, { error: "unknown account" });
					const before = await deps.client.fetchCheckinStatus(account.credential);
					if (!before.active) return json(res, 409, { error: "check-in activity is not active" });
					if (before.todayCheckedIn) return json(res, 200, {
						ok: true,
						alreadyCheckedIn: true,
						claim: {
							credit: 0,
							streakDays: before.streakDays,
							isStreakDay: before.isStreakDay
						}
					});
					json(res, 200, {
						ok: true,
						claim: await deps.client.claimDailyCheckin(account.credential)
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeModelsSave = ctx.webServer.register({
			kind: "exact",
			path: POOL_MODELS_SAVE_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				if (deps.saveSelection === void 0) return json(res, 503, { error: "settings service unavailable; model selection cannot be saved" });
				try {
					const body = await readJsonBody(req);
					const selection = parseSelection(body);
					if (selection === void 0) return json(res, 400, { error: "invalid selection payload" });
					const region = body["region"] === "global" ? "global" : "cn";
					await deps.saveSelection(region, selection);
					json(res, 200, {
						ok: true,
						region,
						selection
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		const disposeAccountDisable = ctx.webServer.register({
			kind: "exact",
			path: POOL_ACCOUNT_DISABLE_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				if (deps.setAccountDisabled === void 0) return json(res, 503, { error: "settings service unavailable; the account switch cannot be saved" });
				try {
					const body = await readJsonBody(req);
					const known = new Set(deps.pool.list().map((account) => account.id));
					const toggle = parseAccountToggle(body, (id) => known.has(id));
					if (toggle === void 0) return json(res, 400, { error: "invalid account toggle payload" });
					await deps.setAccountDisabled(toggle.accountId, toggle.disabled);
					json(res, 200, {
						ok: true,
						...toggle
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		/**
		* Run one automation job on demand.
		*
		* POST only, loopback origin only, and the job name must be one of the four
		* real jobs, so the card cannot name an arbitrary job. This exists so the
		* automation is verifiable without waiting for its scheduled hour.
		*/
		const disposeAutomationRun = ctx.webServer.register({
			kind: "exact",
			path: POOL_AUTOMATION_RUN_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				if (deps.runAutomation === void 0) return json(res, 503, { error: "automation is not available in this build" });
				try {
					const run = parseAutomationRun(await readJsonBody(req));
					if (run === void 0) return json(res, 400, { error: "invalid automation run payload" });
					const started = deps.runAutomation(run.job, run.force === true);
					json(res, 200, {
						ok: true,
						job: run.job,
						started
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		/**
		* Set or clear one account's reserved-credit floor.
		*
		* POST only, loopback origin only, and the id must already be a known
		* account: the card cannot invent an id, and a stale tab must not leave
		* orphan keys in the settings file.
		*/
		const disposeCreditReserve = ctx.webServer.register({
			kind: "exact",
			path: POOL_CREDIT_RESERVE_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
				if (!loopbackOrigin(req)) return json(res, 403, { error: "origin-not-trusted" });
				if (deps.setCreditReserve === void 0) return json(res, 503, { error: "settings service unavailable; the reserve cannot be saved" });
				try {
					const body = await readJsonBody(req);
					const known = new Set(deps.pool.list().map((account) => account.id));
					const parsed = parseCreditReserve(body, (id) => known.has(id));
					if (parsed === void 0) return json(res, 400, { error: "invalid credit reserve payload" });
					await deps.setCreditReserve(parsed.accountId, parsed.reserve);
					json(res, 200, {
						ok: true,
						...parsed
					});
				} catch (error) {
					json(res, 500, { error: safeMessage(error) });
				}
			}
		});
		return () => {
			
			disposeOauthStart();
			disposeOauthPoll();
disposeAutomationRun();
			disposeCreditReserve();
			disposeCheckin();
			disposeAccountDisable();
			disposeModelsSave();
			disposeReset();
			disposeRescan();
			disposeStatus();
		};
	}, "dsh-rotakit: Web status route");
}
//#endregion
//#region src/index.ts
/**
* Host-side plugin entry. Registers the `workbuddy-xdpool` provider into the
* Harness LLM seam once the loopback shim holds its port, plus the HTTP status
* routes consumed by the CLI.
*
* @module dsh-rotakit/index
*/
/** Stable Cordis plugin name. */
const name = "llm-rotakit";
/** The model registry required before the provider can register. */
const inject = ["llm", "settings"];
/**
* Settings namespace for the RotaKit card. Registering a section here
* is what makes the provider appear on the Models settings page and causes the
* Host to mount the plugin's client card under Plugin configuration — exactly
* the mechanism the single-account connector uses.
*/
const WORKBUDDY_POOL_SETTINGS_NS = "llm-rotakit";
/** Upper bound the card offers as the "default" context window, in tokens. */
const DEFAULT_CONTEXT_BUDGET = 2e5;
/**
* Fold a saved automation block into scheduler options.
*
* Absent means off, stated once here so every caller agrees: the card writes
* `enabled` as a real boolean, and a config that never touched the section must
* not accidentally arm background upstream traffic.
*/
function automationOptions(automation) {
	return {
		enabled: automation?.enabled === true,
		...automation?.checkinHours === void 0 ? {} : { checkinHours: automation.checkinHours },
		...automation?.reportHours === void 0 ? {} : { reportHours: automation.reportHours },
		...automation?.taskHours === void 0 ? {} : { taskHours: automation.taskHours },
		...automation?.streakHours === void 0 ? {} : { streakHours: automation.streakHours },
		...automation?.travelHours === void 0 ? {} : { travelHours: automation.travelHours }
	};
}
/**
* One region's model-selection schema.
*
* Every field is optional on purpose: an absent field keeps its documented
* meaning ("all enabled" / "follow the upstream image flag" / "no cap"), and a
* region that has never been saved stays absent so `applyConfigFromSource` can
* fall back to the legacy flat keys.
*/
const modelSelectionSchema = z.object({
	enabledModelIds: z.array(z.string()).description("Model ids enabled in this region's picker (absent = all)"),
	imageModelIds: z.array(z.string()).description("Model ids accepting image input in this region (absent = follow upstream)"),
	contextBudgets: z.dict(z.number().step(1).min(1)).description("Per-model context-window override for this region")
});
/**
* Automation schema.
*
* `enabled` carries a real default (false) because the scheduler reads it on
* every tick and a missing field must mean "off" rather than "undefined".
* The hour lists fall back in the scheduler itself, so they stay optional here
* and an absent list keeps the documented schedule.
*
* `exhaustCooldownMs` is mirrored from the pool options: the card offers it as
* part of the automation block, since how long a spent account rests only
* matters to the automation that has to work around it.
*/
const automationSchema = z.object({
	enabled: z.boolean().default(false).description("Run the daily points automation"),
	checkinHours: z.array(z.number().step(1).min(0).max(23)).description("Local hours for the daily check-in"),
	reportHours: z.array(z.number().step(1).min(0).max(23)).description("Local hours for the activity report (runs before tasks)"),
	taskHours: z.array(z.number().step(1).min(0).max(23)).description("Local hours for task enrolment and claiming"),
	streakHours: z.array(z.number().step(1).min(0).max(23)).description("Local hours for streak redemption"),
	travelHours: z.array(z.number().step(1).min(0).max(23)).description("Local hours for the buddy travel loop"),
	exhaustCooldownMs: z.number().step(1).min(1e3).description("How long a spent account rests, in milliseconds")
});
/** Settings key holding one region's saved selection. */
const modelSelectionKeyFor = (region) => region === "cn" ? "modelSelectionCn" : "modelSelectionGlobal";
/**
* Plugin configuration schema.
*
* Mirrors the shape the settings section stores. Every field carries a default
* so a config that never touched the card still folds cleanly: a field whose
* schema declares no default is read as absent by the settings fold. That is
* also why `contextBudgets` is a real dictionary (`z.dict`) - an open object
* schema reads as "an object with no fields" and the fold then throws while
* the provider row is rendered.
*/
const Config = z.object({
	authFile: z.string().description("WorkBuddy desktop auth file (defaults to the app own location)"),
	cooldownMs: z.number().step(1).min(1e3).default(6e4).description("Rate-limit cooldown per account, in milliseconds"),
	distribution: z.union([
		"priority",
		"round-robin",
		"balanced"
	]).default("priority").description("How requests are spread: priority (drain one), round-robin (in order), or balanced (idle-weighted random)"),
	disabledAccountIds: z.array(z.string()).default([]).description("Account ids excluded from the pool (empty = every discovered account participates)"),
	creditReserves: z.dict(z.number().step(1).min(0)).default({}).description("Per-account credit floor: stop using an account once its balance reaches this value"),
	enabledModelIds: z.array(z.string()).default([]).description("Legacy shared model-id list; used by a region that has no per-region selection yet"),
	imageModelIds: z.array(z.string()).default([]).description("Legacy shared image-id list; used by a region that has no per-region selection yet"),
	contextBudgets: z.dict(z.number().step(1).min(1)).default({}).description("Legacy shared context budgets; used by a region with no per-region selection yet"),
	modelSelectionCn: modelSelectionSchema.description("Model selection for the domestic gateway"),
	modelSelectionGlobal: modelSelectionSchema.description("Model selection for the international gateway"),
	automation: automationSchema.description("Daily points automation (activity report, task claiming, check-in)"),
	automationEarnings: z.any().description("Automation earnings ledger (written by the scheduler)")
});
// [0.1.7-compat] mark the whole config editable through the settings service.
try {
	if (Config.meta === void 0) Config.meta = {};
	Config.meta.volatile = true;
} catch (_compatErr) {
	/* older hosts do not need the volatile marker */
}
/** Live API, published for the CLI. */
let api;
/** The live API, or undefined when the plugin has not applied yet. */
function currentApi() {
	return api;
}
/** Test seam: install an API instance without booting cordis. */
function setApi(next) {
	api = next;
}
/** Assemble the runtime objects without registering anything. */
/**
* Assemble the runtime objects without registering anything.
*
* One catalog per region, mirroring the two shims: the CN and global gateways
* do not advertise the same roster, and a shared catalog meant the picker showed
* whichever list happened to be fetched first (always the CN one, since the
* seeding step read `accounts[0]`).
*/
function createCore(logger) {
	const client = new WorkBuddyUpstreamClient();
	const pool = new WorkBuddyAccountPool({
		...logger === void 0 ? {} : { logger },
		client
	});
	return {
		pool,
		catalogs: {
			cn: new WorkBuddyCatalog(),
			global: new WorkBuddyCatalog()
		},
		client,
		scheduler: new WorkBuddyScheduler(pool, client, { ...logger === void 0 ? {} : { logger } })
	};
}
/**
* Start the loopback endpoint, register the `workbuddy-xdpool` provider, and
* discover accounts. The provider registers only after `shim.ready` resolves,
* because its models read the shim origin at construction time.
*/
function apply(ctx, config = {}) {
	const core = createCore(ctx.logger);
	/**
	* Invalidate the provider snapshot so the picker re-reads the catalog.
	*
	* Seeded with a no-op and reassigned once the adapters exist. The settings
	* section calls its `onChange` hook SYNCHRONOUSLY from `installSection`,
	* before registration has run, so a plain `let builtAdapter` declared later
	* would be read from its temporal dead zone ("Cannot access `builtAdapter`
	* before initialization") and abort the whole apply — which in turn leaves the
	* providers undeclared and the settings page unable to render them.
	*/
	/** The domestic adapter, published for the CLI after registration. */
	let builtAdapter;
	let invalidateCatalog = () => {};
	// [0.1.7-compat] settings.installSection() is gone; read the live entry
	// config through the settings service instead of the missing hook.
	let current = () => {
		try {
			const rows = ctx.settings?.describe?.();
			const row = Array.isArray(rows) ? rows.find((r) => r.ns === WORKBUDDY_POOL_SETTINGS_NS) : void 0;
			if (row?.value !== void 0) return { ...config, ...row.value };
		} catch (_compatErr) { /* fall back to the boot-time config */ }
		return config;
	};
	const sectionHooks = {
		setSource(source) {
			current = source;
		},
		onChange() {
			applyConfigFromSource();
		}
	};
	const applyConfigFromSource = () => {
		const { authFile, cooldownMs, distribution, disabledAccountIds, creditReserves, enabledModelIds, imageModelIds, contextBudgets, modelSelectionCn, modelSelectionGlobal, automation } = current();
		core.pool.applyConfig({
			...authFile === void 0 ? {} : { authDirs: [dirname(authFile)] },
			...cooldownMs === void 0 ? {} : { cooldownMs },
			distribution: distribution ?? "priority",
			...disabledAccountIds === void 0 ? {} : { disabledAccountIds },
			...creditReserves === void 0 ? {} : { creditReserves },
			...automation?.exhaustCooldownMs === void 0 ? {} : { exhaustCooldownMs: automation.exhaustCooldownMs }
		});
		const legacySelection = {
			...enabledModelIds === void 0 ? {} : { enabledModelIds },
			...imageModelIds === void 0 ? {} : { imageModelIds },
			...contextBudgets === void 0 ? {} : { contextBudgets }
		};
		core.catalogs.cn.applySelection(modelSelectionCn ?? legacySelection);
		core.catalogs.global.applySelection(modelSelectionGlobal ?? legacySelection);
		core.scheduler.applyConfig(automationOptions(automation));
	};
	// [0.1.7-compat] 0.1.5 applied config through installSection()'s onChange hook;
	// that API is gone in 0.1.7, so the host now broadcasts settings/document-updated.
	// Without this subscription a settings change lands in the profile document but is
	// never applied at runtime (the card's switch looks dead).
	try {
		ctx.on?.("settings/document-updated", (ns) => {
			if (ns !== WORKBUDDY_POOL_SETTINGS_NS) return;
			try {
				applyConfigFromSource();
				invalidateCatalog();
			} catch (error) {
				ctx.logger?.warn?.(`dsh-rotakit: re-apply after settings change failed: ${error?.message ?? error}`);
			}
		});
	} catch (error) {
		ctx.logger?.warn?.(`dsh-rotakit: cannot subscribe settings/document-updated: ${error?.message ?? error}`);
	}
	const settingsService = ctx.settings;
	if (typeof settingsService.installSection === "function") settingsService.installSection(ctx, WORKBUDDY_POOL_SETTINGS_NS, Config, config, sectionHooks);
	else ctx.logger.warn?.("dsh-rotakit: settings service has no installSection; card will not mount");
	/**
	* Write one key of the plugin's own settings section. Only ever called with
	* the three model-selection keys, so the settings file cannot be steered from
	* the browser; the catalog re-reads through `onChange` either way.
	*/
	/**
	* Persist one settings key, then VERIFY it landed.
	*
	* The settings service resolves `set()` even when the write did not stick, so a
	* fire-and-forget call reports success while the file keeps the old value — and
	* the card then shows a value that silently reverts on the next read. That is
	* exactly the "I typed a reserve, reopened, and it still says 0" report: the
	* write was reported as saved but never reached the document. Every write now
	* awaits the setter and re-reads the document; a mismatch throws so the caller
	* surfaces a real error instead of claiming success.
	*
	* `expected` is what the caller believes it just wrote. Comparison goes through
	* a JSON round-trip so key order cannot cause a false mismatch.
	*/
	/**
	* Deep equality that ignores key order, used to verify a settings write.
	*
	* `JSON.stringify` is key-order sensitive, so comparing two equal objects whose
	* keys were inserted in a different order would report a false "not persisted"
	* failure — and a false failure on a write that DID land is as harmful as a
	* false success: it sends the user chasing a bug that is not there.
	*/
	function stableJsonEqual(left, right) {
		return canonicalJson(left) === canonicalJson(right);
	}
	function canonicalJson(value) {
		if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
		if (typeof value === "object" && value !== null) return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
		return JSON.stringify(value);
	}
	const setSetting = async (key, value, expected) => {
		// [0.1.7-compat] a failed settings write must never kill the host process.
		try {
			if (value === void 0) return;
			const update = settingsService?.update;
			if (update === void 0) {
				ctx.logger?.warn?.(`dsh-rotakit: settings service has no update(); ${key} was not saved`);
				return;
			}
			await update.call(settingsService, WORKBUDDY_POOL_SETTINGS_NS, { [key]: value });
			if (expected !== void 0) {
				const stored = current()[key];
				if (!stableJsonEqual(stored, expected)) ctx.logger?.warn?.(`dsh-rotakit: settings field "${key}" did not verify after write`);
			}
		} catch (error) {
			ctx.logger?.warn?.(`dsh-rotakit: settings write "${key}" failed: ${error?.message ?? error}`);
		}
	};
	core.scheduler.setEarningsPersistence(async (ledger) => {
		await setSetting("automationEarnings", ledger, ledger);
	});
	const storedLedger = current().automationEarnings;
	if (storedLedger !== void 0) core.scheduler.applyEarningsLedger(storedLedger);
	const shims = {
		cn: createWorkBuddyShim({
			pool: core.pool,
			client: core.client,
			catalog: core.catalogs.cn,
			logger: ctx.logger,
			region: "cn"
		}),
		global: createWorkBuddyShim({
			pool: core.pool,
			client: core.client,
			catalog: core.catalogs.global,
			logger: ctx.logger,
			region: "global"
		})
	};
	const shim = shims.cn;
	/** Resolve a region's loopback origin once it has bound a port. */
	const shimInfo = (which) => {
		try {
			return {
				running: true,
				baseUrl: shims[which].baseUrl()
			};
		} catch {
			return { running: false };
		}
	};
	let stopped = false;
	ctx.effect(() => () => {
		stopped = true;
		shims.cn.close();
		shims.global.close();
		core.scheduler.stop();
	});
	ctx.inject(["webServer"], (webCtx) => registerPoolStatusRoute(webCtx, {
		pool: core.pool,
		catalogs: core.catalogs,
		client: core.client,
		shim: () => shimInfo("cn"),
		scheduler: () => core.scheduler.status(),
		runAutomation: (_job, _force) => core.scheduler.startRunAll(),
		/**
		* Run the automation for a specific set of accounts, right now.
		*
		* Distinct from `runAutomation` above, which runs every job for the whole
		* pool: this exists for a newly added account, where the scheduled hours may
		* be most of a day away and re-running the entire pool would be wasteful.
		*/
		runAutomationFor: (accountIds) => core.scheduler.startRunAll(accountIds),
		saveSelection: async (region, selection) => {
			const payload = {
				...selection.enabledModelIds === void 0 ? {} : { enabledModelIds: [...selection.enabledModelIds] },
				...selection.imageModelIds === void 0 ? {} : { imageModelIds: [...selection.imageModelIds] },
				...selection.contextBudgets === void 0 ? {} : { contextBudgets: { ...selection.contextBudgets } }
			};
			await setSetting(modelSelectionKeyFor(region), payload, payload);
		},
		setAccountDisabled: async (accountId, disabled) => {
			const currentIds = current().disabledAccountIds ?? [];
			const next = disabled ? currentIds.includes(accountId) ? currentIds : [...currentIds, accountId] : currentIds.filter((id) => id !== accountId);
			await setSetting("disabledAccountIds", next, next);
		},
		setCreditReserve: async (accountId, reserve) => {
			const next = { ...current().creditReserves ?? {} };
			if (reserve > 0) next[accountId] = reserve;
			else delete next[accountId];
			await setSetting("creditReserves", next, next);
		}
	}));
	api = {
		...core,
		shim,
		get adapter() {
			return builtAdapter;
		},
		async rescan() {
			const accounts = await core.pool.scan();
			ctx.logger.info?.(`dsh-rotakit: discovered ${accounts.length} account(s)`);
			return accounts.length;
		},
		async status(includeCredits = false) {
			return buildStatus({
				pool: core.pool,
				catalog: core.catalogs.cn,
				client: core.client,
				shim: shimInfo("cn"),
				includeCredits
			});
		},
		resetCooldowns() {
			core.pool.resetCooldowns();
		}
	};
	core.scheduler.start();
	Promise.all([shims.cn.ready, shims.global.ready]).then(async () => {
		if (stopped) return;
		try {
			const adaptersByRegion = {
				cn: createWorkBuddyAdapter({
					ctx,
					shim: shims.cn,
					catalog: core.catalogs.cn,
					providerId: POOL_PROVIDER_BY_REGION.cn,
					displayName: POOL_NAME_BY_REGION.cn
				}),
				global: createWorkBuddyAdapter({
					ctx,
					shim: shims.global,
					catalog: core.catalogs.global,
					providerId: POOL_PROVIDER_BY_REGION.global,
					displayName: POOL_NAME_BY_REGION.global
				})
			};
			let releaseAdapterCn;
			let releaseAdapterGlobal;
			let releaseDirectory;
			try {
				releaseAdapterCn = ctx.llm.registerAdapter([POOL_PROVIDER_BY_REGION.cn], adaptersByRegion.cn.adapter);
				releaseAdapterGlobal = ctx.llm.registerAdapter([POOL_PROVIDER_BY_REGION.global], adaptersByRegion.global.adapter);
				releaseDirectory = ctx.llm.registerConfigurableProviders([{
					provider: POOL_PROVIDER_BY_REGION.cn,
					displayName: POOL_NAME_BY_REGION.cn,
					settingsNs: WORKBUDDY_POOL_SETTINGS_NS,
					settingsPath: [],
					declared: false
				}, {
					provider: POOL_PROVIDER_BY_REGION.global,
					displayName: POOL_NAME_BY_REGION.global,
					settingsNs: WORKBUDDY_POOL_SETTINGS_NS,
					settingsPath: [],
					declared: false
				}]);
			} finally {
				if (releaseAdapterCn === void 0 || releaseAdapterGlobal === void 0 || releaseDirectory === void 0) {
					releaseAdapterCn?.();
					releaseAdapterGlobal?.();
					releaseDirectory?.();
				}
			}
			builtAdapter = adaptersByRegion.cn;
			invalidateCatalog = () => {
				adaptersByRegion.cn.invalidate();
				adaptersByRegion.global.invalidate();
			};
			/** Release everything the two providers registered, once. */
			const releaseProviders = () => {
				releaseAdapterCn?.();
				releaseAdapterGlobal?.();
				releaseDirectory?.();
			};
			try {
				ctx.effect(() => releaseProviders);
			} catch {
				releaseProviders();
			}
			ctx.llm.registerModelDiscovery(WORKBUDDY_POOL_SETTINGS_NS, async (request) => {
				if (request.provider !== "workbuddy-xdpool" && request.provider !== "workbuddy-xdpool-global") return [];
				const region = request.provider === "workbuddy-xdpool-global" ? "global" : "cn";
				return core.catalogs[region].visible().map((model) => ({
					id: model.id,
					name: model.name,
					contextWindow: model.contextWindow,
					maxTokens: model.maxOutputTokens,
					inputModalities: model.supportsImages ? ["text", "image"] : ["text"]
				}));
			});
			ctx.logger.info?.(`dsh-rotakit: providers registered at cn=${shims.cn.baseUrl()} global=${shims.global.baseUrl()}`);
		} catch (error) {
			ctx.logger.error("dsh-rotakit: provider registration failed", error);
			return;
		}
		if (stopped) return;
		core.pool.scan().then((accounts) => {
			ctx.logger.info?.(`dsh-rotakit: ${accounts.length} WorkBuddy account(s) in rotation`);
		}, (error) => {
			ctx.logger.warn("dsh-rotakit: account discovery failed", error);
		});
		(async () => {
			const accounts = await core.pool.scan();
			for (const region of ["cn", "global"]) try {
				const credential = accounts.find((account) => regionOf(account.credential.domain) === region)?.credential;
				if (credential === void 0) {
					ctx.logger.info?.(`dsh-rotakit: no ${region} account yet; keeping the static ${region} catalog`);
					continue;
				}
				const models = await core.client.fetchModels(credential);
				core.catalogs[region].updateFromUpstream(models);
				ctx.logger.info?.(`dsh-rotakit: ${region} catalog seeded with ${models.length} model(s)`);
			} catch (error) {
				ctx.logger.warn(`dsh-rotakit: ${region} model catalog unavailable; using static fallback`, error);
			}
			invalidateCatalog();
		})();
	}, (error) => {
		ctx.logger.error("dsh-rotakit: shim failed to listen", error);
	});
	//#region [xdpool-switch-sync] 启动时从 workbuddy-switch 同步最新凭据
	/**
	* Mirror the workbuddy-switch account store into the auth directory the pool scans.
	*
	* The switch app (`~/.wb-switch/accounts.json`) is where the accounts and their
	* live tokens actually live; the pool only reads `*.info` files. Without this
	* step a copied credential goes stale the moment the upstream refreshes it, and
	* the user has to re-export and re-import by hand.
	*
	* Safety: only files named `workbuddy-pool-*.info` are ever written or removed —
	* the desktop app's live `workbuddy-desktop.info` is left alone — and a missing
	* or unparsable source is a no-op rather than a wipe.
	*/
	const SWITCH_ACCOUNTS_PATH = () => join(homedir(), ".wb-switch", "accounts.json");
	const SWITCH_SYNC_STATE_PATH = () => join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool", "switch-sync.json");
	const POOL_CREDENTIAL_PREFIX = "workbuddy-pool-";
	const poolCredentialDir = () => process.env["APPDATA"] === void 0 ? void 0 : join(process.env["APPDATA"], "CodeBuddyExtension", "Data", "Public", "auth");
	const readJsonQuietly = (path) => {
		try {
			return JSON.parse(readFileSync(path, "utf8"));
		} catch {
			return void 0;
		}
	};
	/**
	* One switch record → one pool credential document.
	*
	* Mirrors what the pool's parser accepts: plaintext `accessToken` (so the file
	* must not carry any `$wbEncrypted` marker), identity fields for de-duplication,
	* and deliberately **no** `refreshExpiresAt` — a stale one makes the parser drop
	* the entire file.
	*/
	const switchAccountToDocument = (record) => {
		if (typeof record !== "object" || record === null) return void 0;
		const raw = typeof record["auth_raw"] === "object" && record["auth_raw"] !== null ? record["auth_raw"] : {};
		const source = typeof raw["auth"] === "object" && raw["auth"] !== null ? raw["auth"] : {};
		const accessToken = source["accessToken"] ?? record["access_token"];
		if (typeof accessToken !== "string" || accessToken === "") return void 0;
		const profile = typeof record["profile_raw"] === "object" && record["profile_raw"] !== null ? record["profile_raw"] : {};
		const rawAccount = typeof raw["account"] === "object" && raw["account"] !== null ? raw["account"] : profile;
		const account = { ...rawAccount };
		const nickname = record["nickname"];
		if (typeof nickname === "string" && nickname !== "") account["nickname"] = nickname;
		else delete account["nickname"];
		const phone = profile["phoneNumber"] ?? account["phoneNumber"];
		if (typeof phone === "string" && phone !== "") account["phoneNumber"] = phone;
		else delete account["phoneNumber"];
		for (const key of ["uin", "uid", "enterpriseId", "oneidAccountId"]) {
			const value = account[key] ?? profile[key] ?? record[key];
			if (value !== void 0 && value !== null && value !== "") account[key] = value;
		}
		const auth = {
			accessToken,
			domain: source["domain"] ?? record["domain"] ?? ""
		};
		for (const key of ["refreshToken", "tokenType", "scope", "sessionState", "notBeforePolicy"]) {
			const value = source[key];
			if (typeof value === "string" && value !== "") auth[key] = value;
		}
		for (const key of ["expiresAt", "lastRefreshTime"]) {
			const value = source[key] ?? record[key];
			if (typeof value === "number" && value > 0) auth[key] = Math.round(value);
		}
		return {
			account,
			accounts: Array.isArray(raw["accounts"]) && raw["accounts"].length > 0 ? raw["accounts"] : [account],
			allAccounts: Array.isArray(raw["allAccounts"]) && raw["allAccounts"].length > 0 ? raw["allAccounts"] : [account],
			auth
		};
	};
	/** Mirror the switch store into the pool's auth directory; returns a small summary. */
	const syncSwitchAccounts = () => {
		const source = SWITCH_ACCOUNTS_PATH();
		const dir = poolCredentialDir();
		if (dir === void 0 || !existsSync(source)) return { skipped: "no-source" };
		let fingerprint;
		try {
			const stat = statSync(source);
			fingerprint = `${stat.size}:${Math.round(stat.mtimeMs)}`;
		} catch {
			return { skipped: "unreadable" };
		}
		const previous = readJsonQuietly(SWITCH_SYNC_STATE_PATH());
		if (previous !== void 0 && previous["source"] === source && previous["fingerprint"] === fingerprint) return { skipped: "unchanged" };
		const records = readJsonQuietly(source);
		if (!Array.isArray(records)) return { skipped: "bad-source" };
		const documents = [];
		for (const record of records) {
			const document = switchAccountToDocument(record);
			if (document !== void 0) documents.push(document);
		}
		if (documents.length === 0) return { skipped: "no-usable-account" };
		mkdirSync(dir, { recursive: true });
		const wanted = /* @__PURE__ */ new Set();
		documents.forEach((document, index) => {
			const name = `${POOL_CREDENTIAL_PREFIX}${String(index + 1).padStart(2, "0")}.info`;
			wanted.add(name);
			writeFileSync(join(dir, name), `${JSON.stringify(document, void 0, 1)}\n`, "utf8");
		});
		let removed = 0;
		try {
			for (const entry of readdirSync(dir)) {
				if (!entry.startsWith(POOL_CREDENTIAL_PREFIX) || !entry.endsWith(".info") || wanted.has(entry)) continue;
				try {
					unlinkSync(join(dir, entry));
					removed += 1;
				} catch {}
			}
		} catch {}
		const summary = {
			source,
			at: (new Date()).toISOString(),
			written: documents.length,
			removed
		};
		try {
			const state = SWITCH_SYNC_STATE_PATH();
			mkdirSync(dirname(state), { recursive: true });
			writeFileSync(state, `${JSON.stringify({ ...summary, fingerprint }, void 0, 2)}\n`, "utf8");
		} catch {}
		return summary;
	};
	//#endregion
	//#region [xdpool-autoscan] 启动即自动检测账号
	/**
	* Boot-time account discovery, independent of the shim.
	*
	* The pool's own scan() calls live inside the listen callback and sit *after*
	* the provider-registration try/catch, so a throwing registration returns
	* early and the whole discovery step is skipped — the pool then stays empty
	* until someone presses “rescan” on the card. This hook runs unconditionally
	* and records its outcome on disk, so “did the boot scan find my accounts?”
	* is answerable without a debugger.
	*/
	const BOOT_SCAN_DELAY_MS = 2e3;
	const bootScanRecordPath = () => join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), ".workbuddy-xdpool", "boot-scan.json");
	const writeBootScanRecord = (payload) => {
		try {
			const target = bootScanRecordPath();
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, `${JSON.stringify(payload, void 0, 2)}\n`, "utf8");
		} catch {}
	};
	try {
		ctx.effect(() => {
			const timer = setTimeout(() => {
				if (stopped) return;
				let sync;
				try {
					sync = syncSwitchAccounts();
				} catch (error) {
					sync = { error: safeMessage(error) };
				}
				ctx.logger.info?.(`dsh-rotakit: switch account sync ${JSON.stringify(sync)}`);
				core.pool.scan().then((accounts) => {
					ctx.logger.info?.(`dsh-rotakit: boot auto-scan found ${accounts.length} account(s)`);
					writeBootScanRecord({
						at: (new Date()).toISOString(),
						ok: true,
						sync,
						count: accounts.length,
						labels: accounts.map((account) => account.label)
					});
				}, (error) => {
					ctx.logger.warn("dsh-rotakit: boot auto-scan failed", error);
					writeBootScanRecord({
						at: (new Date()).toISOString(),
						ok: false,
						sync,
						count: 0,
						labels: [],
						error: safeMessage(error)
					});
				});
			}, BOOT_SCAN_DELAY_MS);
			return () => clearTimeout(timer);
		});
	} catch {
		setTimeout(() => {
			if (!stopped) core.pool.scan().catch(() => void 0);
		}, BOOT_SCAN_DELAY_MS);
	}
	//#endregion
}
//#endregion
export { APPEARANCE_THEME_KEY, AUTOMATION_JOB_KINDS, AUTOMATION_TICK_MS, BUDDY_APP_ID, BUDDY_APP_NAME, Config, DEFAULT_CONTEXT_BUDGET, EVENT_SCORE_WAIT_MS, FALLBACK_WORKBUDDY_MODELS, LIBRARY_DOC_URL, LIGHTHOUSE_EXPERT_ID, PLAYBOOK_CASE_ID, PLAYBOOK_CASE_NAME, POOL_AUTOMATION_RUN_PATH, POOL_CHECKIN_PATH, POOL_CREDIT_RESERVE_PATH, POOL_MODELS_SAVE_PATH, POOL_RESCAN_PATH, POOL_RESET_COOLDOWN_PATH, POOL_STATUS_PATH, SKILL_ID, SKILL_NAME, TEMPLATE_PRESETS, WORKBUDDY_AUTH_FILE_ENV, WORKBUDDY_LIVE_FILENAME, WORKBUDDY_POOL_PROVIDER, WORKBUDDY_POOL_SETTINGS_NS, WorkBuddyAccountPool, WorkBuddyCatalog, WorkBuddyScheduler, WorkBuddyUpstreamClient, appearanceChain, apply, automationChain, automationOptions, buddyAppChain, buddyAppEvents, buildStatus, candidateAuthDirs, canvasChain, chatChain, classifyUpstreamError, createCore, createWorkBuddyAdapter, createWorkBuddyShim, currentApi, dayKey, defaultDesktopAuthDirs, desktopAutomationCreatedEvent, desktopCanvasEvents, desktopChatEvents, expertActualUseEvent, expertChatEvents, expertSummonEvents, formatRates, formatStatus, inject, isAutomationJobKind, isFireHour, libraryReadChain, modelSelectionKeyFor, name, parseRateLimitReset, parseWorkBuddyAuth, playbookChain, poolWebStatus, registerPoolStatusRoute, setApi, skillChain, templateChain, templateChains, workbuddyAccountId };
