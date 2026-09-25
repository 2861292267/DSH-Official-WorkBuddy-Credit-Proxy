//===HOST_CONSTS===
/** [xdpool-oauth] Plugin-owned endpoint that opens one QR sign-in. */
const POOL_OAUTH_START_PATH = "/plugins/dsh-workbuddy-xdpool/oauth/start";
/** [xdpool-oauth] Plugin-owned endpoint that polls one QR sign-in. */
const POOL_OAUTH_POLL_PATH = "/plugins/dsh-workbuddy-xdpool/oauth/poll";

//===HOST_HELPERS===
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
/** Field-shaped summary of an upstream document, so diagnostics never carry tokens. */
const oauthShape = (value, depth = 0) => {
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
const oauthCredentialDocument = (token, account, region) => {
	const sources = [token, token?.["data"], account, account?.["data"], account?.["account"]];
	const accessToken = pickText(sources, ["access_token", "accessToken"]);
	if (accessToken === void 0) return void 0;
	const identity = {};
	const nickname = pickText(sources, ["nickname", "nickName", "name"]);
	if (nickname !== void 0) identity["nickname"] = nickname;
	const phone = pickText(sources, ["phoneNumber", "phone", "mobile"]);
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

//===HOST_ROUTES===
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
					if (code === 11217) return json(res, 200, { status: "pending" });
					if (code !== 0 || typeof token?.["data"] !== "object") {
						writeOauthRecord({
							at: (new Date()).toISOString(),
							stage: "poll",
							region,
							code,
							shape: oauthShape(token)
						});
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
						writeOauthRecord({
							at: (new Date()).toISOString(),
							stage: "credential",
							region,
							code,
							token: oauthShape(token),
							account: oauthShape(account)
						});
						return json(res, 500, { error: "the gateway answer carried no access token" });
					}
					const saved = oauthPersistCredential(document);
					writeOauthRecord({
						at: (new Date()).toISOString(),
						stage: "saved",
						region,
						code,
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

//===HOST_DISPOSE===
			disposeOauthStart();
			disposeOauthPoll();
