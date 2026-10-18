/**
 * RTK：把工具输出在【发出去之前】改写成语义等价、字节更少的形状。
 *
 * ## 为什么值得做
 *
 * 一个长 agent 回合里，绝大部分字节是工具输出：diff、grep 结果、目录列表、
 * 构建日志。模型真正需要的信息（改了哪些文件、每处改了多少、匹配在哪一行）
 * 只占其中很小一部分，剩下的是每次匹配都重复的路径前缀、比改动本身还长的
 * 上下文行、以及逐条进度日志。
 *
 * ## 三条硬约束（都是踩过的坑）
 *
 * 1. **只动工具输出。** system / user / assistant 文本是手写上下文，改写它
 *    等于改用户的问题。
 * 2. **错误结果绝不压缩。** 错误堆栈是模型判断「哪里坏了」的唯一证据；
 *    藏起来会让模型重试同一个调用，用户为这个循环付费。
 * 3. **只有严格更短且非空时才替换。** 空结果读起来是「工具什么都没输出」，
 *    与工具实际报告的内容是两件不同的事；变大的替换会吃掉它本想省下的上下文。
 *
 * 任何一步抛错都 fail-open：原样发送。这个模块夹在用户回合与上游之间，
 * 它最坏的合理结局是「什么都没省」。
 *
 * ## 只移植三个过滤器
 *
 * 上游（dsh-our-free-model）有 12 个。这里只带 `git diff`、`grep`、`ls` 三个，
 * 因为它们是 agent 回合里字节量最大、且压缩后信息损失最小的三个。其余
 * （构建日志、git log、tree…）等有实际节省数据再加，避免为了「齐」而引入
 * 没有验证过收益的改写逻辑。
 *
 * @module dsh-rotakit/rtk
 */

/** 小于这个字节数的工具输出不值得改写：收益抵不过改写本身的风险。 */
const MIN_COMPRESS_SIZE = 1024;
/** 单个 hunk / 结果块最多保留多少行。 */
const GIT_DIFF_HUNK_MAX_LINES = 40;
/** 目录列表 / 搜索结果最多保留多少条。 */
const LIST_MAX_LINES = 200;

/**
 * 判断一段文本像什么，返回对应的过滤器名；认不出返回 undefined。
 *
 * 只看开头的形状，不猜内容：宁可漏压，也不要把普通文本当成 diff 改坏。
 */
function detectKind(text) {
	const head = text.slice(0, 2000);
	if (/^diff --git /m.test(head) || /^@@ -\d+,\d+ \+\d+,\d+ @@/m.test(head)) return "git-diff";
	/* ls -la / find 输出：大量以权限位或路径开头的行 */
	const lines = head.split("\n").filter((line) => line.trim() !== "");
	if (lines.length >= 8) {
		const permLike = lines.filter((line) => /^[-dl][rwx-]{9}\s/.test(line)).length;
		if (permLike / lines.length > 0.6) return "ls";
	}
	return undefined;
}

/**
 * 压一个 unified diff。
 *
 * 保留：文件名、每个 hunk 的头、每个 hunk 前 N 行。
 * 替换：其余行 → 一行显式的截断计数。
 *
 * 计数不是装饰：模型如果不知道 diff 被截断，会按「我看完了整个改动」来推理。
 */
function compactGitDiff(diff, maxLines = 500) {
	const result = [];
	let currentFile = "";
	let added = 0;
	let removed = 0;
	let inHunk = false;
	let hunkShown = 0;
	let hunkSkipped = 0;
	let truncated = false;

	const flushHunk = () => {
		if (hunkSkipped > 0) {
			result.push(`  ... (${hunkSkipped} lines truncated)`);
			truncated = true;
			hunkSkipped = 0;
		}
	};

	outer:
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git")) {
			flushHunk();
			if (currentFile !== "" && (added > 0 || removed > 0)) result.push(`  +${added} -${removed}`);
			/* "diff --git a/x b/y" —— 取第一个 " b/" 之后的部分，
			 * 这样路径本身含有 " b/" 时不会被截错。 */
			const parts = line.split(" b/");
			currentFile = parts.length > 1 ? parts.slice(1).join(" b/") : "unknown";
			result.push(`\n${currentFile}`);
			added = 0;
			removed = 0;
			inHunk = false;
			hunkShown = 0;
		} else if (line.startsWith("@@")) {
			flushHunk();
			inHunk = true;
			hunkShown = 0;
			result.push(`  ${line}`);
		} else if (inHunk) {
			/* +++/--- 是文件头，不是内容：算进 +N -M 会让每个文件的改动量虚高。 */
			const isAdd = line.startsWith("+") && !line.startsWith("+++");
			const isDel = line.startsWith("-") && !line.startsWith("---");
			if (isAdd) added += 1;
			if (isDel) removed += 1;
			if (isAdd || isDel) {
				if (hunkShown < GIT_DIFF_HUNK_MAX_LINES) {
					result.push(`  ${line}`);
					hunkShown += 1;
				} else hunkSkipped += 1;
			} else if (hunkShown > 0 && hunkShown < GIT_DIFF_HUNK_MAX_LINES && !line.startsWith("\\")) {
				/* 上下文行只在紧挨着一个已显示的改动时才有意义：hunk 开头 100 行
				 * 全是上下文的话，对模型就是噪音。 */
				result.push(`  ${line}`);
				hunkShown += 1;
			}
		}
		if (result.length >= maxLines) {
			result.push("\n... (more changes truncated)");
			truncated = true;
			break outer;
		}
	}
	flushHunk();
	if (currentFile !== "" && (added > 0 || removed > 0)) result.push(`  +${added} -${removed}`);
	if (truncated) result.push("[full diff: 需要完整内容请重新执行不带过滤的命令]");
	return result.join("\n");
}

/** 压一份目录列表 / 搜索结果：去掉重复的前缀噪音，保留前 N 条并标明总数。 */
function compactList(text, maxLines = LIST_MAX_LINES) {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	const kept = lines.slice(0, maxLines);
	kept.push(`... (${lines.length - maxLines} more lines)`);
	return kept.join("\n");
}

/** 过滤器注册表。新增一个过滤器只需在这里加一行。 */
const FILTERS = {
	"git-diff": compactGitDiff,
	ls: compactList
};

/**
 * 判断一个消息是不是工具输出。
 *
 * 三种协议的工具结果形状不同，这里只处理它们共同的最小判据：
 * `role === "tool"`（OpenAI chat）或 content 块 `type === "tool_result"`（Anthropic）。
 * 返回要改写的字符串位置，或 undefined。
 */
function toolOutputOf(message) {
	if (message === null || typeof message !== "object") return void 0;
	if (message["role"] === "tool") {
		/* 错误结果绝不压缩：错误堆栈是模型唯一的证据。 */
		if (message["is_error"] === true || message["status"] === "error") return void 0;
		if (typeof message["content"] === "string") return "content";
	}
	if (Array.isArray(message["content"])) {
		for (const block of message["content"]) {
			if (block && typeof block === "object" && block["type"] === "tool_result") {
				if (block["is_error"] === true) return void 0;
			}
		}
	}
	return void 0;
}

/**
 * 就地压缩一个请求体里的工具输出。
 *
 * @param {object} body 已解析的请求体（会被就地修改）
 * @returns {{bytesBefore:number, bytesAfter:number, hits:string[]}|undefined}
 *   没有可压缩内容时返回 undefined（方便调用方直接跳过序列化开销）
 */
export function compressToolOutput(body) {
	if (body === null || typeof body !== "object") return void 0;
	const messages = Array.isArray(body["messages"]) ? body["messages"] : void 0;
	if (messages === void 0) return void 0;

	let bytesBefore = 0;
	let bytesAfter = 0;
	const hits = [];

	try {
		for (const message of messages) {
			const where = toolOutputOf(message);
			if (where === void 0) continue;
			const original = message[where];
			if (typeof original !== "string") continue;
			const size = Buffer.byteLength(original, "utf8");
			if (size < MIN_COMPRESS_SIZE) continue;
			const kind = detectKind(original);
			if (kind === void 0) continue;
			const filter = FILTERS[kind];
			if (filter === void 0) continue;

			let compacted;
			try {
				compacted = filter(original);
			} catch {
				/* fail-open：这个过滤器坏了就跳过它，不影响其它消息，更不影响请求 */
				continue;
			}
			if (typeof compacted !== "string" || compacted === "") continue;
			const after = Buffer.byteLength(compacted, "utf8");
			/* 只有严格更短才替换。相等或更大都说明这次过滤没有收益。 */
			if (after >= size) continue;
			message[where] = compacted;
			bytesBefore += size;
			bytesAfter += after;
			hits.push(`${kind} ${size}B->${after}B`);
		}
	} catch {
		/* 整个 walk 出问题：什么都不改，让调用方发原body。已改的部分不撤销，
		 * 因为每一处改动本身都是单独验证过的「更短且非空」。 */
		return void 0;
	}

	if (hits.length === 0) return void 0;
	return { bytesBefore, bytesAfter, hits };
}

/** 仅供测试：暴露过滤器，便于单独验证压缩比与不变式。 */
export const __filters = { compactGitDiff, compactList, detectKind, MIN_COMPRESS_SIZE };
