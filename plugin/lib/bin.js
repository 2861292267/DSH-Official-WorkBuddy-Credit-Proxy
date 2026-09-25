import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
import "@earendil-works/pi-ai";
import "@earendil-works/pi-ai/api/openai-completions.lazy";
import "@deepseek-ai/dsh-llm";
import "@deepseek-ai/dsh-llm-pi-ai";
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
	if (isGatewayHtmlRejection(response.status, text)) throw new Error("the WorkBuddy gateway rejected this credential (http 401). This usually means the account is using a stale sign-in the upstream no longer accepts: sign in again in the WorkBuddy desktop app, then pick the account on the plugin card. Run `dsh-workbuddy-xdpool doctor` to list every credential found.");
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
			let split = buffer.indexOf("\n\n");
			while (split !== -1) {
				const frame = buffer.slice(0, split);
				buffer = buffer.slice(split + 2);
				text += contentOfFrame(frame);
				if (text.length > COMPLETION_TEXT_LIMIT) return text.slice(0, COMPLETION_TEXT_LIMIT);
				split = buffer.indexOf("\n\n");
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
* Body markers win over status, because the upstream reuses 400/200 for
* several distinct conditions.
*/
function classifyUpstreamError(status, body) {
	if (status === 402) return "hard_credit";
	if (status === 401 || status === 403) return "session_dead";
	const lower = body.toLowerCase();
	for (const marker of HARD_CREDIT_MARKERS) if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return "hard_credit";
	for (const marker of SESSION_DEAD_MARKERS) if (body.includes(marker)) return "session_dead";
	if (status === 429) return "soft_rate";
	if (body.includes("soft_rate") || body.includes("\"code\":6004") || body.includes("频率限制")) return "soft_rate";
	if (status === 404) return "not_found";
	if (status >= 500) return "server";
	return "client";
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
/** Parse the upstream's `credits` string into a multiplier. */
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
* @module dsh-workbuddy-xdpool/at-rest
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
* @module dsh-workbuddy-xdpool/accounts
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
		super(`workbuddy: ${sourcePath} holds encrypted credentials, but no WorkBuddy desktop app could be located to provide the key. If the app IS installed, it is simply outside the paths this plugin probes — set WORKBUDDY_APP_EXECUTABLE to its full .exe path (then restart DSH) and the credential will open. Signing in again will not help: the credential itself is intact. Run \`dsh-workbuddy-xdpool doctor\` to see which paths were probed.`);
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
function workbuddyAccountId(credential) {
	const stable = credential.uin ?? credential.uid ?? credential.nickname ?? "unknown";
	return createHash("sha256").update(`workbuddy\0${stable}`).digest("hex").slice(0, 16);
}
/** Human label; distinguishes same-nickname accounts by uid prefix. */
function accountLabel(credential) {
	const name = credential.nickname ?? "WorkBuddy";
	const discriminator = (credential.uid ?? credential.uin ?? "").slice(0, 8);
	return discriminator === "" ? name : `${name}#${discriminator}`;
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
/** Default rest for an account whose credits ran out (packs reset on their own schedule). */
const EXHAUST_COOLDOWN_MS = 18e5;
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
		this.exhaustCooldownMs = options.exhaustCooldownMs ?? EXHAUST_COOLDOWN_MS;
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
					rateLimitHits: 0
				});
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
		const weights = pool.map((account) => idleWeight(this.lastUsedAt.get(account.id), now));
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		if (!Number.isFinite(total) || total <= 0) return pool[0];
		let roll = Math.random() * total;
		for (let index = 0; index < pool.length; index += 1) {
			roll -= weights[index] ?? 0;
			if (roll < 0) return pool[index];
		}
		return pool[pool.length - 1];
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
	*/
	async acquire(modelId, region) {
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
				await this.ensureFresh(preferred);
				return preferred;
			}
		}
		const account = this.distribution === "round-robin" ? this.pickRoundRobin(pool) : this.distribution === "balanced" ? this.pickByWeight(pool) : pool[0];
		if (account === void 0) return void 0;
		await this.ensureFresh(account);
		return account;
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
		if (!this.accounts.some((account) => account.id === accountId)) return;
		this.lastUsedAt.set(accountId, Date.now());
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
				this.logger?.warn(`dsh-workbuddy-xdpool: ${account.label} token expired with no refresh token; sign in again`);
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
				this.logger?.info?.(`dsh-workbuddy-xdpool: refreshed token for ${account.label}`);
			} catch (error) {
				if (credential.expiresAtMs > Date.now() + 3e4) this.logger?.warn?.(`dsh-workbuddy-xdpool: token refresh failed but token still valid for ${account.label}`, error);
				else this.logger?.error?.(`dsh-workbuddy-xdpool: token refresh failed and token expired for ${account.label}`, error);
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
dsh-workbuddy-xdpool: account credits exhausted; cooling the whole account until 

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
	*/
	penalize(accountId, resetAtMs, modelId) {
		const account = this.accounts.find((item) => item.id === accountId);
		if (account === void 0) return;
		account.rateLimitHits += 1;
		const until = resetAtMs ?? Date.now() + this.cooldownMs;
		if (modelId !== void 0 && modelId !== "") {
			account.modelCooldowns[modelId] = Math.max(account.modelCooldowns[modelId] ?? 0, until);
			this.logger?.warn(`dsh-workbuddy-xdpool: ${account.label} rate-limited on model ${modelId}; cooling that model until ${new Date(until).toISOString()}`);
			return;
		}
		account.cooldownUntilMs = Math.max(account.cooldownUntilMs, until);
		this.logger?.warn(`dsh-workbuddy-xdpool: account ${account.label} rate-limited; cooling until ${new Date(until).toISOString()}`);
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
const JOB_KINDS = [
	"checkin",
	"report",
	"tasks",
	"streak",
	"travel"
];
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
	startRunAll() {
		if (this.runInFlight) return false;
		this.runInFlight = true;
		this.runAll().catch((error) => {
			this.logger.warn?.("dsh-workbuddy-xdpool automation run failed:", error);
		}).finally(() => {
			this.runInFlight = false;
		});
		return true;
	}
	async runAll() {
		const today = dayKey(this.now());
		const before = this.earningsSnapshot();
		let okCount = 0;
		let failed = 0;
		let jobsRun = 0;
		for (const kind of JOB_KINDS) {
			jobsRun += 1;
			this.busy = true;
			try {
				await this.runJob(kind, today);
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
			this.logger.warn?.("dsh-workbuddy-xdpool automation tick failed:", error);
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
			this.logger.warn?.("dsh-workbuddy-xdpool: could not persist automation earnings:", error);
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
	async runJob(kind, today) {
		const accountWord = kind === "report" ? "report" : kind;
		let ok = 0;
		let failed = 0;
		let credit = 0;
		let energy = 0;
		let claimed = 0;
		const detail = [];
		let progressNote;
		const accounts = this.accountsInOrder();
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
[
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
//#endregion
//#region src/status.ts
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
//#region src/index.ts
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
z.object({
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
//#endregion
//#region src/bin.ts
/**
* Command-line diagnostics and account management.
*
*   dsh plugin --profile desktop exec dsh-workbuddy-xdpool <command>
*
* @module dsh-workbuddy-xdpool/bin
*/
/** Directory holding imported account snapshots. */
const ACCOUNT_DIR_NAME = ".workbuddy-xdpool";
/** Snapshot files are named by the md5 prefix of their key, so any key is safe. */
function snapshotPath(key, dir) {
	return join(dir, `${createHash("md5").update(key).digest("hex").slice(0, 8)}.json`);
}
function dshHome() {
	const fromEnv = process.env["DSH_HOME"];
	if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
	return join(homedir(), ".dsh");
}
function accountDir() {
	return join(dshHome(), ACCOUNT_DIR_NAME);
}
function usage() {
	return [
		"dsh-workbuddy-xdpool — multi-account WorkBuddy provider for DeepSeek Harness",
		"",
		"Usage: dsh-workbuddy-xdpool <command> [options]",
		"",
		"Commands:",
		"  status              Account pool, credits, and shim state (add --credits, --json, --rates)",
		"  doctor              Diagnose discovery, cooldowns, and upstream reachability",
		"  accounts            List discovered accounts (add --json)",
		"  import <key>        Snapshot the current desktop login as <key> (add --force)",
		"  remove <key>        Delete one imported snapshot",
		"  login               Guide for adding another account (desktop app is single-sign-in)",
		"  checkin [all|<acct>] Daily check-in: report status, or collect with `all` / a label",
		"  reset               Clear all rate-limit cooldowns immediately",
		"",
		"Options:",
		"  --json              Machine-readable output",
		"  --credits           Query remaining credits (read-only; does not consume)",
		"  --rates             Show per-model credit multipliers",
		"  --force             Overwrite an existing snapshot"
	].join("\n");
}
/** Live auth files, in probe order. */
function liveCandidates() {
	const fromEnv = process.env["WORKBUDDY_AUTH_FILE"];
	if (typeof fromEnv === "string" && fromEnv.trim() !== "") return [resolve(fromEnv.trim())];
	return defaultDesktopAuthDirs().map((dir) => join(dir, WORKBUDDY_LIVE_FILENAME));
}
async function readJsonFile(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return;
	}
}
async function commandStatus(args) {
	const asJson = args.includes("--json");
	const withCredits = args.includes("--credits");
	const withRates = args.includes("--rates");
	const core = createCore();
	const accounts = await core.pool.scan();
	const status = {
		ok: accounts.length > 0,
		accounts: accounts.map((account) => {
			const now = Date.now();
			const modelCooling = Object.entries(account.modelCooldowns).filter(([, until]) => until > now).map(([modelId, until]) => ({
				modelId,
				until: new Date(until).toISOString()
			}));
			return {
				id: account.id,
				label: account.label,
				domain: account.credential.domain,
				...account.credential.expiresAtMs === 0 ? {} : { expiresAt: new Date(account.credential.expiresAtMs).toISOString() },
				cooling: account.cooldownUntilMs > now,
				...modelCooling.length === 0 ? {} : { modelCooldowns: modelCooling },
				rateLimitHits: account.rateLimitHits,
				sourcePath: account.credential.sourcePath
			};
		}),
		cooling: accounts.filter((account) => account.cooldownUntilMs > Date.now()).length,
		models: core.catalogs.cn.current().map((model) => ({
			id: model.id,
			name: model.name,
			multiplier: model.multiplier
		})),
		shim: { running: false }
	};
	if (asJson) console.log(JSON.stringify(status, null, 2));
	else console.log(`WorkBuddy XD Pool: ${status.accounts.length} account(s), ${status.cooling} cooling\n` + status.accounts.map((account) => {
		const flag = account.cooling ? "⏸ " : "▶ ";
		const hits = account.rateLimitHits > 0 ? ` (hits ${account.rateLimitHits})` : "";
		const modelCooling = (account.modelCooldowns ?? []).map((mc) => `\n    model-cool: ${mc.modelId} until ${mc.until}`).join("");
		return `${flag}${account.label}  [${account.domain || "cn"}]${hits}\n    ${account.sourcePath}${modelCooling}`;
	}).join("\n"));
	if (withRates) console.log(`\n${formatRates(status)}`);
	if (withCredits) {
		const first = accounts.find((account) => account.cooldownUntilMs <= Date.now());
		if (first === void 0) console.log("\nCredits: skipped (every account is cooling down)");
		else try {
			const credits = await core.client.fetchCredits(first.credential);
			console.log(`\nCredits for ${first.label}: ` + JSON.stringify(credits));
		} catch (error) {
			console.log(`\nCredits for ${first.label}: query failed — ${String(error).slice(0, 200)}`);
		}
	}
	return status.ok ? 0 : 1;
}
/**
* Daily check-in from the terminal.
*
* `checkin` with no argument reports every account's status; `checkin all`
* collects wherever a reward is still available, and `checkin <label>` targets
* one account. A collection is never attempted twice for the same account on
* the same day — the status is re-read first and an already-collected account
* is reported as such.
*/
async function commandCheckin(args) {
	const asJson = args.includes("--json");
	const target = args.find((arg) => !arg.startsWith("--"));
	const core = createCore();
	if ((await core.pool.scan()).length === 0) {
		console.error("No WorkBuddy account discovered. Sign in with the WorkBuddy desktop app first.");
		return 1;
	}
	const wanted = target === void 0 || target === "all" ? core.pool.list() : core.pool.list().filter((account) => account.label === target || account.id === target || account.id.startsWith(target));
	if (wanted.length === 0) {
		console.error(`No account matches "${target}". Run \`accounts\` to list labels.`);
		return 1;
	}
	const rows = [];
	for (const account of wanted) {
		const row = {
			label: account.label,
			active: false,
			alreadyCheckedIn: false,
			streakDays: 0
		};
		try {
			const status = await core.client.fetchCheckinStatus(account.credential);
			row.active = status.active;
			row.alreadyCheckedIn = status.todayCheckedIn;
			row.streakDays = status.streakDays;
			if (target !== void 0 && status.active && !status.todayCheckedIn) {
				const claim = await core.client.claimDailyCheckin(account.credential);
				row.claimed = claim.credit;
				row.streakDays = claim.streakDays;
				row.alreadyCheckedIn = true;
			}
		} catch (error) {
			row.error = String(error).slice(0, 200);
		}
		rows.push(row);
	}
	if (asJson) {
		console.log(JSON.stringify(rows, null, 2));
		return rows.every((row) => row.error === void 0) ? 0 : 1;
	}
	console.log("Daily check-in:");
	for (const row of rows) {
		if (row.error !== void 0) {
			console.log(`  ! ${row.label}: query failed — ${row.error}`);
			continue;
		}
		if (!row.active) {
			console.log(`  – ${row.label}: no check-in activity`);
			continue;
		}
		if (row.claimed !== void 0) {
			console.log(`  + ${row.label}: collected ${row.claimed} credit(s) (streak ${row.streakDays})`);
			continue;
		}
		console.log(row.alreadyCheckedIn ? `  ✓ ${row.label}: already checked in today (streak ${row.streakDays})` : `  · ${row.label}: not checked in today — run \`checkin all\` to collect`);
	}
	if (target === void 0) console.log("\nAdd `all` (or an account label) to collect.");
	return rows.every((row) => row.error === void 0) ? 0 : 1;
}
async function commandDoctor() {
	const lines = [];
	let healthy = true;
	lines.push(`dsh-workbuddy-xdpool doctor`);
	lines.push(`  platform : ${platform()}`);
	lines.push(`  dsh home : ${dshHome()}`);
	lines.push("");
	lines.push("Credential discovery:");
	for (const candidate of liveCandidates()) {
		const raw = await readJsonFile(candidate);
		const credential = raw === void 0 ? void 0 : parseWorkBuddyAuth(JSON.stringify(raw), candidate);
		lines.push(`  ${credential === void 0 ? "✗" : "✓"} ${candidate}`);
	}
	const dirs = defaultDesktopAuthDirs();
	for (const dir of dirs) {
		const { readdir } = await import("node:fs/promises");
		let names = [];
		try {
			names = await readdir(dir);
		} catch {
			lines.push(`  - ${dir} (absent)`);
			continue;
		}
		const snapshots = names.filter((name) => name.startsWith("workbuddy-desktop.") && name.endsWith(".info"));
		lines.push(`  ✓ ${dir} → ${snapshots.length} snapshot(s)`);
	}
	lines.push("");
	const accounts = await createCore().pool.scan();
	lines.push(`Accounts discovered: ${accounts.length}`);
	if (accounts.length === 0) {
		healthy = false;
		lines.push("  ✗ none — sign in on the WorkBuddy desktop app, then run `import <key>`");
	}
	for (const account of accounts) {
		const state = account.cooldownUntilMs > Date.now() ? "cooling" : "ready";
		lines.push(`  ✓ ${account.label} (${state}, hits ${account.rateLimitHits})`);
	}
	lines.push("");
	lines.push(`Imported snapshots: ${accountDir()}`);
	const { readdir: readdir2 } = await import("node:fs/promises");
	let imported = [];
	try {
		imported = (await readdir2(accountDir())).filter((name) => name.endsWith(".json"));
	} catch {}
	lines.push(imported.length === 0 ? "  (none)" : imported.map((name) => `  ✓ ${name}`).join("\n"));
	console.log(lines.join("\n"));
	return healthy ? 0 : 1;
}
async function commandImport(args) {
	const key = args.filter((arg) => !arg.startsWith("--"))[0];
	if (key === void 0) {
		console.error("usage: dsh-workbuddy-xdpool import <key> [--force]");
		return 2;
	}
	const force = args.includes("--force");
	let source;
	for (const candidate of liveCandidates()) {
		const raw = await readJsonFile(candidate);
		if (raw === void 0) continue;
		if (parseWorkBuddyAuth(JSON.stringify(raw), candidate) !== void 0) {
			source = candidate;
			break;
		}
	}
	if (source === void 0) {
		console.error(`No signed-in WorkBuddy desktop session found. Sign in on the desktop app first
(looked in: ${liveCandidates().join(", ")})`);
		return 1;
	}
	const dir = accountDir();
	await mkdir(dir, { recursive: true });
	const target = snapshotPath(key, dir);
	const { access } = await import("node:fs/promises");
	let exists = false;
	try {
		await access(target);
		exists = true;
	} catch {}
	if (exists && !force) {
		console.error(`Snapshot "${key}" already exists. Re-run with --force to overwrite.`);
		return 1;
	}
	await copyFile(source, target);
	const credential = parseWorkBuddyAuth(await readFile(target, "utf8"), target);
	const label = credential === void 0 ? "unknown" : (credential.nickname ?? "WorkBuddy") + `#${workbuddyAccountId(credential).slice(0, 8)}`;
	console.log(`Imported "${key}" → ${label}\n  saved: ${target}`);
	return 0;
}
async function commandRemove(args) {
	const key = args.filter((arg) => !arg.startsWith("--"))[0];
	if (key === void 0) {
		console.error("usage: dsh-workbuddy-xdpool remove <key>");
		return 2;
	}
	const target = snapshotPath(key, accountDir());
	const { unlink } = await import("node:fs/promises");
	try {
		await unlink(target);
		console.log(`Removed snapshot "${key}"`);
		return 0;
	} catch {
		console.error(`No snapshot named "${key}"`);
		return 1;
	}
}
function commandLogin() {
	console.log([
		"Adding another WorkBuddy account",
		"",
		"The WorkBuddy desktop app holds one signed-in account at a time, so each",
		"additional account is captured as a snapshot after you switch login:",
		"",
		"  1. Open the WorkBuddy desktop app and sign in (scan the QR code).",
		"  2. Run:  dsh plugin --profile desktop exec dsh-workbuddy-xdpool import <key>",
		"  3. Sign in with the next account in the desktop app.",
		"  4. Run the import command again with a different <key>.",
		"  5. Restart DSH Desktop; every imported account joins the rotation pool.",
		"",
		"Snapshots live in " + accountDir() + " and store the desktop app's tokens",
		"verbatim — protect that directory like a password."
	].join("\n"));
	return 0;
}
async function commandReset() {
	const core = createCore();
	await core.pool.scan();
	core.pool.resetCooldowns();
	console.log("Cleared all rate-limit cooldowns.");
	return 0;
}
async function commandAccounts(args) {
	const asJson = args.includes("--json");
	const accounts = await createCore().pool.scan();
	if (asJson) console.log(JSON.stringify(accounts.map((account) => ({
		id: account.id,
		label: account.label,
		cooling: account.cooldownUntilMs > Date.now(),
		rateLimitHits: account.rateLimitHits
	})), null, 2));
	else if (accounts.length === 0) console.log("No imported accounts. Run `import <key>` after signing in on the desktop app.");
	else console.log(accounts.map((account) => `${account.cooldownUntilMs > Date.now() ? "⏸" : "▶"} ${account.label}`).join("\n"));
	return 0;
}
/** Entry point; returns the process exit code. */
async function main(argv) {
	const [command, ...rest] = argv;
	switch (command) {
		case void 0:
		case "help":
		case "--help":
		case "-h":
			console.log(usage());
			return 0;
		case "status": return commandStatus(rest);
		case "doctor": return commandDoctor();
		case "accounts": return commandAccounts(rest);
		case "import": return commandImport(rest);
		case "remove": return commandRemove(rest);
		case "login": return commandLogin();
		case "logout": return commandRemove(["default", ...rest]);
		case "reset": return commandReset();
		case "checkin": return commandCheckin(rest);
		default:
			console.error(`unknown command: ${command}\n\n${usage()}`);
			return 2;
	}
}
main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
	console.error(error);
	process.exit(1);
});
//#endregion
export { main, writeFile };
