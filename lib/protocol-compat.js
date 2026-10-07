/*
 * Protocol compatibility layer for dsh-rotakit.
 *
 * The shim speaks OpenAI chat completions. Everything real - account rotation,
 * cooldowns, credit reserves, context compaction - lives behind
 * `/v1/chat/completions`. Two other protocols are widely asked for and neither
 * is served by the WorkBuddy upstream:
 *
 *   - the OpenAI **Responses** API (`/v1/responses`), which is the only shape
 *     Codex speaks;
 *   - the **Anthropic Messages** API (`/v1/messages`), which is the shape every
 *     Anthropic-SDK client speaks.
 *
 * Both are pure translation problems. Rather than reimplementing rotation for
 * each one, this module converts an incoming request into a chat body, lets the
 * shim's existing loop do the work, and converts the chat stream back. That is
 * the whole reason the module is separate from `index.js`: the translation must
 * not be entangled with the scheduling, or a protocol bug would look like a
 * pool bug.
 *
 * Why this shape rather than an in-process call: the shim's own chat handler
 * decides which account serves a request. Anything that bypassed it would also
 * bypass cooldowns and reserves. The translations here are deliberately dumb -
 * they carry no scheduling state at all.
 *
 * Ported from the standalone WorkBuddy Pool's Responses bridge (2.1.0), which
 * had it working against live Codex traffic; kept byte-compatible on the wire
 * so a client that worked against that endpoint works against this one.
 */

/** Response id, matching the upstream's own prefix convention. */
export const newResponseId = () => `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ *
 * Responses -> chat
 * ------------------------------------------------------------------ */

/**
 * Flatten a Responses `input` array (plus `instructions`) into chat messages.
 *
 * Two things here are not obvious and were both learned from refusals:
 *
 *  1. Calls and results are collected first and paired afterwards. A result may
 *     arrive before its call and a call may have no result; the upstream rejects
 *     both, so the ordering has to be rebuilt rather than passed through.
 *  2. The conversation must not open with tool work. A trimmed or resumed
 *     session starts at an assistant tool call, which the upstream refuses with
 *     "tool calls and tool results do not match". A user turn is prepended
 *     instead of dropping the calls, because the results that follow are real
 *     work and discarding them loses it from the model's context.
 */
export function inputToMessages(input, instructions) {
	const messages = [];
	if (typeof instructions === "string" && instructions !== "") messages.push({ role: "system", content: instructions });
	if (typeof input === "string") {
		messages.push({ role: "user", content: input });
		return messages;
	}
	if (!Array.isArray(input)) return messages;

	const conversation = [];
	/** call_id -> the assistant entry holding that call. */
	const calls = new Map();
	/** Results, keyed by the call they answer, held until that call is seen. */
	const results = new Map();

	const callIdOf = (item) => (typeof item.call_id === "string" ? item.call_id : (typeof item.id === "string" ? item.id : undefined));

	for (const item of input) {
		if (item === null || typeof item !== "object") continue;
		const type = item.type ?? "message";

		if (type === "function_call" || type === "custom_tool_call" || type === "local_shell_call") {
			const id = callIdOf(item) ?? `call_${String(calls.size + 1)}`;
			/* A shell call arrives as its own type, with the command in a different field. */
			const name = item.name ?? (type === "local_shell_call" ? "shell" : "unknown");
			const args = typeof item.arguments === "string"
				? item.arguments
				: (item.action === undefined ? "{}" : JSON.stringify(item.action));
			const entry = {
				role: "assistant",
				content: null,
				tool_calls: [{ id, type: "function", function: { name, arguments: args } }]
			};
			conversation.push(entry);
			calls.set(id, entry);
			continue;
		}

		if (type === "function_call_output" || type === "custom_tool_call_output") {
			const id = callIdOf(item);
			const output = typeof item.output === "string"
				? item.output
				: (item.output === undefined ? "" : JSON.stringify(item.output));
			if (id === undefined) continue;
			results.set(id, { role: "tool", tool_call_id: id, content: output === "" ? "(no output)" : output });
			continue;
		}

		if (type !== "message") continue;
		const role = item.role === "developer" ? "system" : (item.role ?? "user");
		let content;
		if (typeof item.content === "string") {
			content = item.content;
		} else if (Array.isArray(item.content)) {
			content = item.content
				.map((part) => {
					if (typeof part === "string") return part;
					if (part === null || typeof part !== "object") return "";
					if (part.type === "input_text" || part.type === "output_text" || part.type === "text") return part.text ?? "";
					if (part.type === "input_image") return typeof part.image_url === "string" ? `[image: ${part.image_url}]` : "[image]";
					return "";
				})
				.filter((s) => s !== "")
				.join("\n");
		} else {
			content = "";
		}
		conversation.push({ role, content });
	}

	/*
	 * Each call is followed immediately by its result, and a call whose result
	 * never arrived gets a synthesised one. A missing result makes the upstream
	 * reject the whole request, and the model would otherwise believe the tool
	 * ran and invent its output.
	 */
	for (const entry of conversation) {
		messages.push(entry);
		const call = entry.tool_calls?.[0];
		if (call === undefined) continue;
		const answer = results.get(call.id);
		if (answer === undefined) {
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: "(this tool call was interrupted and produced no result)"
			});
			continue;
		}
		messages.push(answer);
		results.delete(call.id);
	}

	/* A result whose call is absent entirely is dropped rather than inventing a
	 * call for it: a fabricated assistant turn would misrepresent what the model
	 * asked for. */
	const firstToolish = messages.findIndex((m) => m.role === "assistant" && m.tool_calls !== undefined);
	const firstUser = messages.findIndex((m) => m.role === "user");
	if (firstToolish >= 0 && (firstUser < 0 || firstUser > firstToolish)) {
		messages.splice(firstToolish, 0, {
			role: "user",
			content: "(the conversation was resumed partway through; the tool work below continues it)"
		});
	}

	return messages;
}

/** Responses tools are flat; chat nests them under `function`. */
export function toolsToChat(tools) {
	if (!Array.isArray(tools)) return undefined;
	const out = tools
		.filter((t) => t !== null && typeof t === "object" && t.type === "function")
		.map((t) => (typeof t.function === "object" && t.function !== null
			? t
			: { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
		.filter((t) => typeof t.function?.name === "string" && t.function.name !== "");
	return out.length === 0 ? undefined : out;
}

/** Build the chat body one Responses request becomes. */
export function responsesToChatBody(body) {
	const chat = {
		model: body.model,
		messages: inputToMessages(body.input, body.instructions),
		max_tokens: body.max_output_tokens ?? body.max_tokens,
		temperature: body.temperature,
		top_p: body.top_p,
		stream: true
	};
	const tools = toolsToChat(body.tools);
	if (tools !== undefined) {
		chat.tools = tools;
		chat.tool_choice = body.tool_choice ?? "auto";
	}
	for (const key of Object.keys(chat)) if (chat[key] === undefined) delete chat[key];
	return chat;
}

export const statusFor = (reason) => (reason === "length" ? "incomplete" : "completed");

/**
 * Build the finished-response `output` array for one completed stream.
 *
 * Tool calls MUST be in this list. Codex decides whether a turn continues by
 * reading it: a turn whose tools are missing looks like the model merely spoke,
 * so the client ends the turn and waits for the user - the "it stopped
 * mid-task" failure. The streaming close frame and the non-streaming body share
 * this function so the two cannot disagree.
 */
export function responseOutput(stream) {
	const output = [{
		type: "message",
		id: stream.itemId,
		status: "completed",
		role: "assistant",
		content: [{ type: "output_text", text: stream.text, annotations: [] }]
	}];
	let index = 1;
	for (const call of stream.toolCalls.values()) {
		/* A call with no id or name is a torn fragment; dropping it beats sending a broken one. */
		if (call.name === undefined || call.name === "" || call.id === undefined || call.id === "") continue;
		output.push({
			type: "function_call",
			id: `${stream.id}-call-${String(index)}`,
			status: "completed",
			call_id: call.id,
			name: call.name,
			arguments: call.arguments === "" ? "{}" : call.arguments
		});
		index += 1;
	}
	return output;
}

/**
 * Turn a chat SSE stream into the Responses event sequence a Codex client reads.
 *
 * `feed` is fed raw bytes and returns the frames they complete; `closing`
 * finishes the stream. Frame boundaries are known only here, which is why usage
 * is captured on the stream rather than parsed by the caller from raw chunks:
 * a chunk boundary inside the usage object breaks a regex, and the early frames
 * carry `"usage":null`, so a caller that scans chunks records zero tokens beside
 * several hundred characters of text.
 */
export class ResponseStream {
	constructor(model, id) {
		this.model = model;
		this.id = id;
		this.seq = 0;
		this.itemId = `${id}-msg`;
		this.text = "";
		this.toolCalls = new Map();
		this.finishReason = undefined;
		this.usage = undefined;
		this.buffer = "";
		this.opened = false;
	}

	frame(type, payload) {
		this.seq += 1;
		return `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: this.seq, ...payload })}\n\n`;
	}

	opening() {
		if (this.opened) return "";
		this.opened = true;
		const base = {
			id: this.id,
			object: "response",
			created_at: Math.floor(Date.now() / 1000),
			status: "in_progress",
			model: this.model,
			output: []
		};
		return this.frame("response.created", { response: base })
			+ this.frame("response.in_progress", { response: base })
			+ this.frame("response.output_item.added", { output_index: 0, item: { type: "message", id: this.itemId, status: "in_progress", role: "assistant", content: [] } })
			+ this.frame("response.content_part.added", { item_id: this.itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
	}

	/** Feed raw chat-SSE bytes; returns the Response frames they produce. */
	feed(text) {
		this.buffer += text;
		let out = "";
		let at = this.buffer.indexOf("\n\n");
		while (at >= 0) {
			const frame = this.buffer.slice(0, at);
			this.buffer = this.buffer.slice(at + 2);
			const line = frame.split("\n").find((l) => l.startsWith("data: "));
			if (line !== undefined) {
				const payload = line.slice(6).trim();
				if (payload !== "[DONE]") {
					try {
						const parsed = JSON.parse(payload);
						/* An empty `usage` never overwrites the real numbers that
						 * arrive in a later frame, which is what left every finished
						 * answer reporting zero output tokens. */
						if (parsed.usage !== null && parsed.usage !== undefined && typeof parsed.usage === "object") {
							this.usage = parsed.usage;
						}
						out += this.push(parsed);
					} catch {
						/* a frame shaped differently; the sequence still completes below */
					}
				}
			}
			at = this.buffer.indexOf("\n\n");
		}
		return out;
	}

	push(chunk) {
		const choice = chunk.choices?.[0];
		if (choice === undefined) return this.opening();
		let out = this.opening();
		const delta = choice.delta ?? {};
		if (typeof delta.content === "string" && delta.content !== "") {
			this.text += delta.content;
			out += this.frame("response.output_text.delta", { item_id: this.itemId, output_index: 0, content_index: 0, delta: delta.content });
		}
		for (const call of delta.tool_calls ?? []) {
			const index = call.index ?? 0;
			const held = this.toolCalls.get(index) ?? { id: call.id, name: "", arguments: "" };
			if (typeof call.id === "string") held.id = call.id;
			if (typeof call.function?.name === "string") held.name += call.function.name;
			if (typeof call.function?.arguments === "string") held.arguments += call.function.arguments;
			this.toolCalls.set(index, held);
		}
		if (choice.finish_reason !== undefined && choice.finish_reason !== null) this.finishReason = choice.finish_reason;
		return out;
	}

	/**
	 * Close the Responses stream.
	 *
	 * A tool call is re-emitted here, not only as an `output_item.done`: Codex
	 * reads the finished response's `output` array to decide whether the turn
	 * continues, so every call appears twice - as added/done events, and inside
	 * the final `response.output` list, in the same shape a real OpenAI response
	 * uses.
	 */
	closing(usage) {
		let out = this.opening();
		out += this.frame("response.output_text.done", { item_id: this.itemId, output_index: 0, content_index: 0, text: this.text });
		out += this.frame("response.content_part.done", { item_id: this.itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: this.text, annotations: [] } });
		out += this.frame("response.output_item.done", { output_index: 0, item: { type: "message", id: this.itemId, status: "completed", role: "assistant", content: [{ type: "output_text", text: this.text, annotations: [] }] } });
		/* The message item comes first, matching the index it was announced at. */
		const output = responseOutput(this);
		/* Announce every tool call before closing, so a streaming client sees it added then done. */
		let index = 1;
		for (const item of output) {
			if (item.type !== "function_call") continue;
			out += this.frame("response.output_item.added", { output_index: index, item });
			out += this.frame("response.output_item.done", { output_index: index, item });
			index += 1;
		}
		out += this.frame("response.completed", {
			response: {
				id: this.id,
				object: "response",
				created_at: Math.floor(Date.now() / 1000),
				status: statusFor(this.finishReason),
				model: this.model,
				output,
				output_text: this.text,
				usage: {
					input_tokens: usage?.prompt_tokens ?? 0,
					output_tokens: usage?.completion_tokens ?? 0,
					total_tokens: usage?.total_tokens ?? 0
				}
			}
		});
		return out;
	}

	/** The whole completed response as one JSON body (non-streaming callers). */
	body(usage) {
		return {
			id: this.id,
			object: "response",
			created_at: Math.floor(Date.now() / 1000),
			status: statusFor(this.finishReason),
			model: this.model,
			output: responseOutput(this),
			output_text: this.text,
			usage: {
				input_tokens: usage?.prompt_tokens ?? 0,
				output_tokens: usage?.completion_tokens ?? 0,
				total_tokens: usage?.total_tokens ?? 0
			}
		};
	}
}

/* ------------------------------------------------------------------ *
 * Anthropic Messages -> chat
 * ------------------------------------------------------------------ */

/**
 * Flatten Anthropic `system` + `messages` into chat messages.
 *
 * Anthropic carries tool use inside the content array (`tool_use` blocks) and
 * tool results as user-role messages (`tool_result` blocks), whereas chat wants
 * a separate `tool_calls` field on an assistant turn and `role: "tool"` turns.
 * Images become a short placeholder: the WorkBuddy upstream behind this shim is
 * text-only, and dropping the block entirely would silently lose the fact that
 * the user attached something.
 */
export function anthropicToMessages(system, messages) {
	const out = [];
	const systemText = blocksToText(system);
	if (systemText !== "") out.push({ role: "system", content: systemText });
	if (!Array.isArray(messages)) return out;

	/** tool_use id -> the assistant entry holding it, so results can be paired. */
	const pending = new Map();

	for (const message of messages) {
		if (message === null || typeof message !== "object") continue;
		const role = message.role === "assistant" ? "assistant" : "user";
		const content = message.content;

		if (typeof content === "string") {
			out.push({ role, content });
			continue;
		}
		if (!Array.isArray(content)) continue;

		/* Parts are bucketed by kind, because chat cannot hold them interleaved:
		 * a tool_use must live on an assistant turn and its result on a tool turn. */
		const texts = [];
		const toolUses = [];
		const toolResults = [];

		for (const part of content) {
			if (part === null || typeof part !== "object") continue;
			switch (part.type) {
				case "text":
					if (typeof part.text === "string" && part.text !== "") texts.push(part.text);
					break;
				case "thinking":
				case "redacted_thinking":
					/* Reasoning is not replayable through chat; dropped deliberately. */
					break;
				case "image":
					texts.push("[image]");
					break;
				case "tool_use":
					toolUses.push({
						id: typeof part.id === "string" ? part.id : `call_${String(pending.size + 1)}`,
						type: "function",
						function: {
							name: typeof part.name === "string" ? part.name : "unknown",
							arguments: part.input === undefined ? "{}" : JSON.stringify(part.input)
						}
					});
					break;
				case "tool_result": {
					const id = typeof part.tool_use_id === "string" ? part.tool_use_id : undefined;
					if (id === undefined) break;
					const text = blocksToText(part.content);
					toolResults.push({
						role: "tool",
						tool_call_id: id,
						content: text === "" ? (part.is_error === true ? "(tool reported an error with no output)" : "(no output)") : text
					});
					break;
				}
				default:
					break;
			}
		}

		if (toolUses.length > 0) {
			const entry = { role: "assistant", content: texts.length === 0 ? null : texts.join("\n"), tool_calls: toolUses };
			out.push(entry);
			for (const call of toolUses) pending.set(call.id, entry);
		} else if (texts.length > 0 || role === "user") {
			out.push({ role, content: texts.join("\n") });
		}

		for (const result of toolResults) {
			out.push(result);
			pending.delete(result.tool_call_id);
		}
	}

	/*
	 * A tool call with no result must be answered, or the upstream refuses the
	 * whole request with "tool calls and tool results do not match". This happens
	 * for real: a client that was interrupted mid-turn sends the call back
	 * without its result on the next request.
	 */
	for (const id of pending.keys()) {
		out.push({
			role: "tool",
			tool_call_id: id,
			content: "(this tool call was interrupted and produced no result)"
		});
	}

	/* The conversation must not begin with tool work - see `inputToMessages`. */
	const firstToolish = out.findIndex((m) => m.role === "assistant" && m.tool_calls !== undefined);
	const firstUser = out.findIndex((m) => m.role === "user");
	if (firstToolish >= 0 && (firstUser < 0 || firstUser > firstToolish)) {
		out.splice(firstToolish, 0, {
			role: "user",
			content: "(the conversation was resumed partway through; the tool work below continues it)"
		});
	}

	return out;
}

/** Join a string-or-blocks value into plain text. */
function blocksToText(value) {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (typeof part === "string") return part;
			if (part === null || typeof part !== "object") return "";
			if (part.type === "text") return part.text ?? "";
			if (part.type === "image") return "[image]";
			return "";
		})
		.filter((s) => s !== "")
		.join("\n");
}

/** Anthropic tools already nest under `input_schema`; chat wants `parameters`. */
export function anthropicToolsToChat(tools) {
	if (!Array.isArray(tools)) return undefined;
	const out = tools
		.filter((t) => t !== null && typeof t === "object" && typeof t.name === "string" && t.name !== "")
		.map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema ?? { type: "object", properties: {} }
			}
		}));
	return out.length === 0 ? undefined : out;
}

/**
 * Build the chat body one Anthropic Messages request becomes.
 *
 * `max_tokens` is required by the Anthropic API, so it is always present - but
 * the pool catalog knows each model's real ceiling, and passing a client's
 * optimistic 8192 through unfiltered is how a request dies at the upstream with
 * a limit error. The clamp is applied by the caller, which holds the catalog.
 */
export function anthropicToChatBody(body, maxTokensCeiling) {
	const chat = {
		model: body.model,
		messages: anthropicToMessages(body.system, body.messages),
		max_tokens: clampMaxTokens(body.max_tokens, maxTokensCeiling),
		temperature: body.temperature,
		top_p: body.top_p,
		stream: true
	};
	const tools = anthropicToolsToChat(body.tools);
	if (tools !== undefined) {
		chat.tools = tools;
		/* Anthropic's `tool_choice` uses its own vocabulary; only the forced and
		 * auto cases map cleanly, and anything else is left to the pool default. */
		const choice = body.tool_choice;
		if (choice !== null && typeof choice === "object") {
			if (choice.type === "any") chat.tool_choice = "required";
			else if (choice.type === "auto") chat.tool_choice = "auto";
			else if (choice.type === "none") chat.tool_choice = "none";
			else if (choice.type === "tool" && typeof choice.name === "string") {
				chat.tool_choice = { type: "function", function: { name: choice.name } };
			}
		}
	}
	for (const key of Object.keys(chat)) if (chat[key] === undefined) delete chat[key];
	return chat;
}

/**
 * The smallest output budget worth asking a pooled model for.
 *
 * These are REASONING models, and reasoning is billed against `max_tokens`.
 * Measured on the live pool with one fixed prompt, six runs per budget:
 *
 *     max_tokens=16   1/6 produced content   ~12 reasoning frames   finish: length
 *     max_tokens=64   3/6 produced content   ~35 reasoning frames   finish: length
 *     max_tokens=256  6/6 produced content   ~43 reasoning frames   finish: stop
 *     (unset)         6/6 produced content   ~19 reasoning frames   finish: stop
 *
 * When the budget runs out mid-thought the upstream returns `finish_reason:
 * length` with NO content at all. The client then receives a well-formed,
 * completely empty answer and cannot tell why - which is what made the Anthropic
 * route look intermittent while the chat route always worked: chat carries no
 * budget, and every Anthropic SDK is required to send one.
 *
 * So a budget below the floor is not "a shorter answer", it is "no answer".
 * 512 is above the observed reasoning cost with room for the reply itself.
 */
const MIN_MAX_TOKENS = 512;

/**
 * Keep a client-supplied `max_tokens` inside what the model can actually do.
 *
 * Two bounds, for two different failure modes:
 *   - ABOVE the ceiling the upstream refuses the request outright;
 *   - BELOW the floor the model spends the whole budget thinking and returns no
 *     content at all.
 *
 * When the two conflict - a model whose ceiling is under the floor - the CEILING
 * wins, and the floor is simply not applied. The reasoning is that the two
 * failures are not equal: exceeding the ceiling is a deterministic rejection the
 * caller can do nothing about, while being under the floor is a probabilistic
 * empty turn. Raising past a model's own limit would turn a maybe into a never.
 *
 * A caller asking for fewer tokens than the floor still gets a short reply: the
 * budget is a cap, not a quota.
 */
function clampMaxTokens(requested, ceiling) {
	const hasCeiling = typeof ceiling === "number" && ceiling > 0;
	if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
		return hasCeiling ? ceiling : undefined;
	}
	const capped = hasCeiling ? Math.min(requested, ceiling) : requested;
	/* Only lift to the floor when the model can actually accept that much. */
	if (hasCeiling && ceiling < MIN_MAX_TOKENS) return capped;
	return Math.max(capped, MIN_MAX_TOKENS);
}

/**
 * Stop reason, in Anthropic's vocabulary.
 *
 * `tool_use` matters most: a client that sees `end_turn` while the model asked
 * for a tool stops the loop, so the tool calls it just received are never run.
 */
export function anthropicStopReason(finishReason, hasToolCalls) {
	if (hasToolCalls) return "tool_use";
	switch (finishReason) {
		case "length": return "max_tokens";
		case "tool_calls": return "tool_use";
		case "stop": return "end_turn";
		case undefined:
		case null:
			return "end_turn";
		default:
			return "end_turn";
	}
}

/**
 * Turn a chat SSE stream into Anthropic's Messages event sequence.
 *
 * The wire shape matters: Anthropic clients dispatch on `type`, and the message
 * is only valid once `message_start`, one or more content blocks, and
 * `message_delta` + `message_stop` have all arrived in that order.
 */
export class AnthropicStream {
	constructor(model, id) {
		this.model = model;
		this.id = id;
		this.text = "";
		this.toolCalls = new Map();
		this.finishReason = undefined;
		this.usage = undefined;
		this.buffer = "";
		this.opened = false;
		this.blockOpen = false;
		this.blocks = [];
		this.blockIndex = 0;
	}

	frame(event, payload) {
		return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
	}

	/**
	 * Open the message and its first content block.
	 *
	 * The leading text block is opened eagerly so ordinary replies stream as the
	 * text arrives. A tool-only turn leaves it empty and drops it at close, which
	 * is legal - Anthropic itself emits an empty text block before tool use when
	 * the model reasons first, and clients tolerate it.
	 */
	opening() {
		if (this.opened) return "";
		this.opened = true;
		this.blockOpen = true;
		const out = this.frame("message_start", {
			type: "message_start",
			message: {
				id: this.id,
				type: "message",
				role: "assistant",
				model: this.model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 0, output_tokens: 0 }
			}
		}) + this.frame("content_block_start", {
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" }
		});
		this.blockIndex = 1;
		return out;
	}

	/** Feed raw chat-SSE bytes; returns the Anthropic events they produce. */
	feed(text) {
		this.buffer += text;
		let out = "";
		let at = this.buffer.indexOf("\n\n");
		while (at >= 0) {
			const frame = this.buffer.slice(0, at);
			this.buffer = this.buffer.slice(at + 2);
			const line = frame.split("\n").find((l) => l.startsWith("data: "));
			if (line !== undefined) {
				const payload = line.slice(6).trim();
				if (payload !== "[DONE]") {
					try {
						const parsed = JSON.parse(payload);
						if (parsed.usage !== null && parsed.usage !== undefined && typeof parsed.usage === "object") {
							this.usage = parsed.usage;
						}
						out += this.push(parsed);
					} catch {
						/* a frame shaped differently; the sequence still completes at close */
					}
				}
			}
			at = this.buffer.indexOf("\n\n");
		}
		return out;
	}

	push(chunk) {
		const choice = chunk.choices?.[0];
		if (choice === undefined) return this.opening();
		let out = this.opening();
		const delta = choice.delta ?? {};
		if (typeof delta.content === "string" && delta.content !== "") {
			this.text += delta.content;
			out += this.frame("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: delta.content }
			});
		}
		for (const call of delta.tool_calls ?? []) {
			const index = call.index ?? 0;
			const held = this.toolCalls.get(index) ?? { id: call.id, name: "", arguments: "" };
			if (typeof call.id === "string") held.id = call.id;
			if (typeof call.function?.name === "string") held.name += call.function.name;
			if (typeof call.function?.arguments === "string") held.arguments += call.function.arguments;
			this.toolCalls.set(index, held);
		}
		if (choice.finish_reason !== undefined && choice.finish_reason !== null) this.finishReason = choice.finish_reason;
		return out;
	}

	/** Close the message: text block done, one block per tool call, then the tail. */
	closing(usage) {
		let out = this.opening();
		if (this.blockOpen) {
			out += this.frame("content_block_stop", { type: "content_block_stop", index: 0 });
			this.blockOpen = false;
		}
		const calls = [...this.toolCalls.values()].filter((c) => c.name !== undefined && c.name !== "" && c.id !== undefined && c.id !== "");
		for (const call of calls) {
			const index = this.blockIndex;
			this.blockIndex += 1;
			out += this.frame("content_block_start", {
				type: "content_block_start",
				index,
				content_block: { type: "tool_use", id: call.id, name: call.name, input: {} }
			});
			/* The arguments are emitted as one delta rather than replayed
			 * fragment by fragment: Anthropic requires `input_json_delta`
			 * pieces to concatenate into valid JSON, and the fragments the
			 * chat stream delivers are not guaranteed to be valid on their own. */
			out += this.frame("content_block_delta", {
				type: "content_block_delta",
				index,
				delta: { type: "input_json_delta", partial_json: call.arguments === "" ? "{}" : call.arguments }
			});
			out += this.frame("content_block_stop", { type: "content_block_stop", index });
		}
		const inputTokens = usage?.prompt_tokens ?? 0;
		const outputTokens = usage?.completion_tokens ?? 0;
		out += this.frame("message_delta", {
			type: "message_delta",
			delta: { stop_reason: anthropicStopReason(this.finishReason, calls.length > 0), stop_sequence: null },
			usage: { output_tokens: outputTokens }
		});
		out += this.frame("message_stop", { type: "message_stop" });
		/* Kept for the caller's log line; not part of the wire format. */
		this.closingUsage = { input_tokens: inputTokens, output_tokens: outputTokens };
		return out;
	}

	/** The whole completed message as one JSON body (non-streaming callers). */
	body(usage) {
		const content = [];
		if (this.text !== "") content.push({ type: "text", text: this.text });
		const calls = [...this.toolCalls.values()].filter((c) => c.name !== undefined && c.name !== "" && c.id !== undefined && c.id !== "");
		for (const call of calls) {
			let input = {};
			try {
				input = call.arguments === "" ? {} : JSON.parse(call.arguments);
			} catch {
				/* A torn argument string is reported as an empty object rather than
				 * failing the whole answer: the text the model produced is still
				 * useful, and a parse error would discard it. */
				input = {};
			}
			content.push({ type: "tool_use", id: call.id, name: call.name, input });
		}
		if (content.length === 0) content.push({ type: "text", text: "" });
		return {
			id: this.id,
			type: "message",
			role: "assistant",
			model: this.model,
			content,
			stop_reason: anthropicStopReason(this.finishReason, calls.length > 0),
			stop_sequence: null,
			usage: {
				input_tokens: usage?.prompt_tokens ?? 0,
				output_tokens: usage?.completion_tokens ?? 0
			}
		};
	}
}

/** Anthropic error envelope: `{"type":"error","error":{"type":...,"message":...}}`. */
export function anthropicError(status, type, message) {
	return { status, body: { type: "error", error: { type, message } } };
}

/**
 * Map an OpenAI-shaped shim error onto Anthropic's vocabulary.
 *
 * Anthropic SDKs retry on `overloaded_error`/`api_error` and surface
 * `authentication_error` as a credential problem, so the type is not cosmetic:
 * a rate limit reported as `invalid_request_error` is not retried at all.
 */
export function openAIErrorToAnthropic(status, kind, message) {
	if (status === 401) return anthropicError(401, "authentication_error", message);
	if (status === 403) return anthropicError(403, "permission_error", message);
	if (status === 404) return anthropicError(404, "not_found_error", message);
	if (status === 429) return anthropicError(429, "rate_limit_error", message);
	if (status === 413) return anthropicError(413, "request_too_large", message);
	if (status === 402) return anthropicError(402, kind === "hard_credit" ? "billing_error" : "rate_limit_error", message);
	if (status >= 500) return anthropicError(status, "api_error", message);
	return anthropicError(status, "invalid_request_error", message);
}
