//===CLIENT_CONSTS===
		/** [xdpool-oauth] Plugin-owned endpoint that opens one QR sign-in. */
		const OAUTH_START_PATH = "/plugins/dsh-workbuddy-xdpool/oauth/start";
		/** [xdpool-oauth] Plugin-owned endpoint that polls one QR sign-in. */
		const OAUTH_POLL_PATH = "/plugins/dsh-workbuddy-xdpool/oauth/poll";

//===CLIENT_STATE===
			/**
			* [xdpool-oauth] QR sign-in state.
			*
			* `scan` is undefined while the panel is closed; otherwise it carries the
			* state the Host opened, the QR image, and the latest poll verdict. The
			* timer is a ref so closing the panel (or unmounting the card) always
			* stops the polling — a leaked interval would keep hitting the gateway
			* after the user walked away.
			*/
			const [scan, setScan] = (0, react.useState)(void 0);
			const [scanBusy, setScanBusy] = (0, react.useState)(false);
			const scanTimer = (0, react.useRef)(void 0);
			const stopScanPoll = () => {
				if (scanTimer.current !== void 0) {
					window.clearInterval(scanTimer.current);
					scanTimer.current = void 0;
				}
			};
			(0, react.useEffect)(() => stopScanPoll, []);
			const closeScan = () => {
				stopScanPoll();
				setScan(void 0);
			};
			const startScan = async () => {
				setScanBusy(true);
				setError(void 0);
				setFlash(void 0);
				try {
					const response = await fetch(OAUTH_START_PATH, {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ region: activeRegion })
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					if (!mounted.current) return;
					setScan({
						state: body.state,
						qr: body.qr,
						status: "pending"
					});
					stopScanPoll();
					const pending = body.state;
					scanTimer.current = window.setInterval(async () => {
						try {
							const poll = await fetch(`${OAUTH_POLL_PATH}?state=${encodeURIComponent(pending)}&region=${activeRegion}`, {
								headers: { accept: "application/json" },
								credentials: "same-origin"
							});
							const out = await poll.json();
							if (!poll.ok) throw new Error(out.error ?? `HTTP ${poll.status}`);
							if (out.status === "ok") {
								stopScanPoll();
								if (!mounted.current) return;
								setScan((prev) => prev === void 0 ? prev : {
									...prev,
									status: "done",
									label: out.label
								});
								setFlash(t?.("row.oauthAdded", { label: out.label ?? "" }) ?? "");
								await refresh(activeRegion);
								return;
							}
							if (out.status === "expired") {
								stopScanPoll();
								if (!mounted.current) return;
								setScan((prev) => prev === void 0 ? prev : {
									...prev,
									status: "expired"
								});
							}
						} catch (cause) {
							stopScanPoll();
							if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
						}
					}, 2500);
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setScanBusy(false);
				}
			};

//===CLIENT_BUTTON===
/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
	type: "button",
	className: "dsm-btn dsm-btn-outline",
	disabled: scanBusy,
	onClick: () => {
		if (scan === void 0) startScan();
		else closeScan();
	},
	children: scanBusy ? t?.("row.oauthStarting") ?? "Opening…" : scan === void 0 ? t?.("row.oauthAdd") ?? "Add by QR" : t?.("row.oauthHide") ?? "Hide QR"
}), 

//===CLIENT_PANEL===
							scan === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: "10px",
									padding: "12px",
									border: "1px solid rgba(127,127,127,0.35)",
									borderRadius: "10px",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									gap: "10px"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										width: "200px",
										height: "200px",
										padding: "8px",
										boxSizing: "content-box",
										background: "#ffffff",
										borderRadius: "8px"
									},
									dangerouslySetInnerHTML: { __html: scan.qr }
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: "12px",
										opacity: 0.75,
										textAlign: "center"
									},
									children: scan.status === "done" ? t?.("row.oauthDone", { label: scan.label ?? "" }) ?? "Added" : scan.status === "expired" ? t?.("row.oauthExpired") ?? "Expired — request a new code" : t?.("row.oauthHint") ?? "Scan with the WorkBuddy app to sign in"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: "8px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										onClick: () => {
											closeScan();
										},
										children: t?.("row.oauthClose") ?? "Close"
									}), scan.status === "expired" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										onClick: () => {
											startScan();
										},
										children: t?.("row.oauthRetry") ?? "New code"
									}) : null]
								})]
							}),

//===CLIENT_TEXT_EN===
			"row.oauthAdd": "Add by QR",
			"row.oauthHide": "Hide QR",
			"row.oauthStarting": "Opening…",
			"row.oauthHint": "Scan with the WorkBuddy app to sign in",
			"row.oauthDone": "Added {label}",
			"row.oauthAdded": "Added {label}",
			"row.oauthExpired": "Expired — request a new code",
			"row.oauthRetry": "New code",
			"row.oauthClose": "Close",

//===CLIENT_TEXT_ZH===
			"row.oauthAdd": "扫码添加账号",
			"row.oauthHide": "收起二维码",
			"row.oauthStarting": "正在获取…",
			"row.oauthHint": "用 WorkBuddy App 扫码登录",
			"row.oauthDone": "已添加 {label}",
			"row.oauthAdded": "已添加 {label}",
			"row.oauthExpired": "二维码已失效，请重新获取",
			"row.oauthRetry": "重新获取",
			"row.oauthClose": "关闭",
