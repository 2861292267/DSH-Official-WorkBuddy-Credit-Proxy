window.__ModuleLoader__.load({
	id: "dsh-rotakit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		/** Run one automation job immediately, so the card can verify it on demand. */
		const POOL_AUTOMATION_RUN_PATH = "/plugins/dsh-rotakit/automation/run";
		/** Set or clear one account's reserved-credit floor. */
		const POOL_CREDIT_RESERVE_PATH = "/plugins/dsh-rotakit/accounts/credit-reserve";

		/** [xdpool-oauth] Plugin-owned endpoint that opens one QR sign-in. */
		const OAUTH_START_PATH = "/plugins/dsh-rotakit/oauth/start";
		/** [xdpool-oauth] Plugin-owned endpoint that polls one QR sign-in. */
		const OAUTH_POLL_PATH = "/plugins/dsh-rotakit/oauth/poll";

		/**
		* Where the card remembers "follow the system / light / dark".
		*
		* Namespaced, because `localStorage` is shared with the whole DSH window and
		* a bare `theme` key would collide with the first other plugin that has the
		* same idea — and the two would then overwrite each other's choice.
		*/
		const POOL_THEME_STORAGE_KEY = "dsh-rotakit:theme";

		//#endregion
		//#region src/client/icon.ts
		/**
		* Plugin card icon (data URI) for the RotaKit card.
		*
		* A neutral, dependency-free 24px “pool / droplet stack” glyph kept as an SVG
		* data URI so the browser half never needs an external asset. Three stacked
		* droplet outlines + an encompassing orbit mark read as “rotating accounts";
		* the line and fill colors stay inside the host’s accent family so the icon
		* sits naturally on the dark Plugin configuration surface.
		*
		* @module dsh-rotakit/client/icon
		*/
		const POOL_PLUGIN_ICON = "data:image/svg+xml;utf8," + encodeURIComponent([
			"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\">",
			"<g fill=\"none\" stroke=\"#5686fe\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">",
			"<path d=\"M7 5.5C7 3.6 8.4 2.5 8.4 2.5S9.8 3.6 9.8 5.5A1.4 1.4 0 0 1 7 5.5Z\" fill=\"#5686fe\" fill-opacity=\".28\"/>",
			"<path d=\"M15 10.5C15 8.6 16.4 7.5 16.4 7.5S17.8 8.6 17.8 10.5a1.4 1.4 0 0 1-2.8 0Z\" fill=\"#5686fe\" fill-opacity=\".28\"/>",
			"<ellipse cx=\"12\" cy=\"14.5\" rx=\"5.6\" ry=\"4.4\" stroke-dasharray=\"2 2\" stroke-opacity=\".55\"/>",
			"</g>",
			"</svg>"
		].join(""));
		//#endregion
		//#region src/client/styles.ts
		/**
		* Client styles for the RotaKit card.
		*
		* The card uses the same dark-theme token vocabulary as the built-in plugin
		* cards (`--dsw-alias-*`), so the pooled account and model directory sit
		* naturally next to the other configuration rows instead of looking like a
		* bright Google-Material block on top of DSH's dark surface.
		*
		* The collapsible shell mirrors dingminhua/dsh-connect-trae (which itself
		* borrows from the LaoDing plugin family) so the row header behaves exactly
		* like the built-in cards next to it; the inner workbuddy-specific classes
		* are renamed to `dsm-workbuddy-xdpool-*` to stay namespaced.
		*
		* @module dsh-rotakit/client/styles
		*/
		const POOL_CARD_CSS = `
/* Shell: same collapse affordance as every other plugin config row. */
.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-module-platform,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:-2px}
.dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}
.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}
.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;display:inline-flex;transition:transform .16s}
.dsm-plugin-card-chevron-open{transform:rotate(180deg)}
.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}
.dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}

/* Reusable button primitives shared with the rest of the card body. */
.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:1px}
.dsm-btn:disabled{opacity:.4;cursor:default}
.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}
.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}
.dsm-btn-primary{background:var(--dsw-alias-label-primary,#e6e6e6);color:var(--dsw-alias-bg-layer-3,#202126)}
.dsm-btn-primary:hover:not(:disabled){opacity:.9}

/* Body layout: status row + accounts list + models list. */
.dsm-workbuddy-xdpool-usage{display:flex;flex-direction:column;gap:10px;margin:0;padding:12px 0 4px}
/* Region tabs: two independent suppliers, one shown at a time. */
.dsm-workbuddy-xdpool-tabs{display:flex;gap:6px;padding:4px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
/* Empty-region guide: steps for signing in on the other gateway. */
.dsm-workbuddy-xdpool-empty{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-workbuddy-xdpool-empty-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-workbuddy-xdpool-empty-steps{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-workbuddy-xdpool-empty-steps-title{margin:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;font-weight:600;line-height:18px}
.dsm-workbuddy-xdpool-empty-list{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-empty-list li{min-width:0}
.dsm-workbuddy-xdpool-empty-note{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:17px}
.dsm-workbuddy-xdpool-tab{appearance:none;font:inherit;cursor:pointer;flex:1;border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:500;line-height:18px;background:transparent;transition:color .16s,background .16s,box-shadow .16s}
.dsm-workbuddy-xdpool-tab:hover:not(.dsm-workbuddy-xdpool-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-xdpool-tab:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:1px}
.dsm-workbuddy-xdpool-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-2,#232529);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,#3a3d45)}
.dsm-workbuddy-xdpool-tab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:baseline;background:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-tab-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-xdpool-tab-dot[data-state="idle"]{background:var(--dsw-alias-label-dimmed,#9aa0a6)}
.dsm-workbuddy-xdpool-usage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-workbuddy-xdpool-usage-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-workbuddy-xdpool-usage-status{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-workbuddy-xdpool-usage-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.dsm-workbuddy-xdpool-usage-hint{padding-left:19px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
/* Distribution switch: priority (drain one) vs round-robin (spread). */
.dsm-workbuddy-xdpool-dist{display:flex;flex-direction:column;gap:6px;padding-left:19px;margin-top:8px}
.dsm-workbuddy-xdpool-dist-title{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-dist-option{appearance:none;font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;justify-content:center;gap:1px;min-height:40px;border:0;border-radius:9px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2,#25262b);color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,background .16s}
.dsm-workbuddy-xdpool-dist-option:hover:not(:disabled):not(.dsm-workbuddy-xdpool-dist-option-active){color:var(--dsw-alias-label-primary,#e6e6e6);background:color-mix(in oklab, var(--dsw-alias-label-primary,#e6e6e6) 7%, var(--dsw-alias-bg-layer-2,#25262b))}
.dsm-workbuddy-xdpool-dist-option:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:-2px}
.dsm-workbuddy-xdpool-dist-option-active{background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 17%, var(--dsw-alias-bg-layer-2,#25262b));color:var(--dsw-alias-state-success-primary,#22a06b);box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent)}
.dsm-workbuddy-xdpool-dist-option:disabled{cursor:default;opacity:.6}
.dsm-workbuddy-xdpool-dist-option-name{font-size:11px;line-height:16px;font-weight:600}
.dsm-workbuddy-xdpool-dist-option-hint{font-size:10px;line-height:14px;opacity:.8}
/* A segmented control, not three cards: the options are mutually exclusive, and
   three separately bordered boxes with gaps read as three unrelated choices.
   The 1px gap over a border-coloured background is the only divider. */
.dsm-workbuddy-xdpool-dist-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;padding:1px;border-radius:10px;background:color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 55%, transparent)}
.dsm-workbuddy-xdpool-usage-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* Account list (each account = a labeled subpanel, same as dingminhua). */
.dsm-workbuddy-xdpool-accounts{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-workbuddy-xdpool-accounts-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
/* "In use now": answers which account is serving without scanning every row. */
/* A hairline + tint reads as status; a filled bar would read as a call to action. */
.dsm-workbuddy-xdpool-current{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0 0;padding:9px 13px;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 32%, transparent);border-radius:12px;background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 9%, transparent)}
.dsm-workbuddy-xdpool-current-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary,#22a06b);box-shadow:0 0 0 3px color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 18%, transparent)}
.dsm-workbuddy-xdpool-current-label{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:11.5px;line-height:18px;font-weight:600;letter-spacing:.02em;flex:none}
.dsm-workbuddy-xdpool-current-name{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;line-height:18px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-current-note{color:var(--dsw-alias-state-warning-primary,#d97706);font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-accounts-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-workbuddy-xdpool-accounts-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* The whole heading row is the collapse control, so the button needs the reset a
   bare <button> never gets. Without it the title renders with the host's button
   chrome and the chevron sits in the browser's default padding. */
.dsm-workbuddy-xdpool-accounts-toggle{appearance:none;font:inherit;cursor:pointer;display:flex;align-items:center;gap:7px;min-width:0;padding:0;border:0;background:transparent;color:inherit;text-align:left}
/* Hover must not use the brand token: it resolves to a near-black here, so the
   title vanished on hover instead of highlighting. */
.dsm-workbuddy-xdpool-accounts-toggle:hover .dsm-workbuddy-xdpool-accounts-title{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-accounts-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:2px;border-radius:6px}
/* Both panels participate in the grid, so neither may force a column wider. */
.dsm-workbuddy-xdpool-panel-packages,
.dsm-workbuddy-xdpool-health-text{min-width:0}
/* Gateway-fault count: same meta line as the rest, but it is a warning. */
.dsm-workbuddy-xdpool-account-meta-warn{color:var(--dsw-alias-state-warning-primary,#d97706)}
/* Keeps the run button on one line while the automation switch takes the slack. */
.dsm-workbuddy-xdpool-auto-run{flex:none}
.dsm-workbuddy-xdpool-account{display:flex;flex-direction:column;gap:0;padding:0;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 50%, transparent);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#24262c);overflow:hidden}
/* Body row inside a card: identity on the left, credit panels on the right. */
/* flex-wrap lets the panels drop below on a narrow card instead of squeezing both. */
.dsm-workbuddy-xdpool-account-body{display:flex;align-items:stretch;gap:0;flex-wrap:wrap}
.dsm-workbuddy-xdpool-account-copy{display:flex;flex-direction:column;align-items:flex-start;gap:5px;flex:1 1 200px;min-width:0;padding:10px 12px;justify-content:center}
.dsm-workbuddy-xdpool-account-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-account-head .dsm-workbuddy-xdpool-account-toggle{margin-left:auto}
.dsm-workbuddy-xdpool-account-head{display:flex;align-items:center;gap:9px;min-width:0;padding:7px 11px;border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}
/* Account switched off on the card: still listed (so it can be turned back on) but visually muted. */
.dsm-workbuddy-xdpool-account-off{opacity:.55}
/* Small pill switch: "in rotation" vs "off". Native checkbox styled by the label. */
.dsm-workbuddy-xdpool-account-toggle{appearance:none;font:inherit;display:inline-flex;align-items:center;gap:5px;cursor:pointer;flex:none;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 70%, transparent);border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}
.dsm-workbuddy-xdpool-account-toggle:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-workbuddy-xdpool-account-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:1px}
.dsm-workbuddy-xdpool-account-toggle:disabled{cursor:default;opacity:.6}
.dsm-workbuddy-xdpool-account-toggle-on{background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600}
.dsm-workbuddy-xdpool-account-toggle-dot{width:6px;height:6px;border-radius:50%;flex:none;background:currentColor;opacity:.9}
.dsm-workbuddy-xdpool-account-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-workbuddy-xdpool-account-tag{padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.12));color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-account-tag-cooling{background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.15));color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-workbuddy-xdpool-account-tag-error{background:var(--dsw-alias-state-error-subtle,rgba(239,68,68,.12));color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-xdpool-account-meta{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px;display:flex;flex-wrap:wrap;gap:10px}
.dsm-workbuddy-xdpool-account-modelcool{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.dsm-workbuddy-xdpool-account-modelcool-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.12));color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-workbuddy-xdpool-account-error{margin:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:13px;line-height:20px}

/* Region tag, shown only on the merged tab so two pools stay distinguishable. */

/* Cooldown visualisation: reason + countdown + progress + per-model chips. */
.dsm-workbuddy-xdpool-cool{display:flex;flex-direction:column;gap:5px;margin-top:4px;min-width:0}
.dsm-workbuddy-xdpool-cool-line{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.dsm-workbuddy-xdpool-cool-reason{color:var(--dsw-alias-state-warning-primary,#d97706);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-cool-reason-partial{color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-xdpool-cool-time{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-cool-bar{height:4px;border-radius:999px;background:color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 60%, transparent);overflow:hidden}
.dsm-workbuddy-xdpool-cool-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-warning-primary,#d97706);transition:width .3s}
.dsm-workbuddy-xdpool-cool-fill-partial{background:linear-gradient(90deg,var(--dsw-alias-state-warning-primary,#d97706) 55%,color-mix(in oklab, var(--dsw-alias-state-warning-primary,#d97706) 35%, transparent) 100%)}
.dsm-workbuddy-xdpool-cool-models{display:flex;flex-wrap:wrap;gap:6px}
.dsm-workbuddy-xdpool-cool-chip{padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;background:rgba(174,179,187,.11);color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-cool-hits{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}

/* Credit-expiry banner: loud when credits are about to lapse, muted otherwise. */
.dsm-workbuddy-xdpool-expiry{display:flex;align-items:flex-start;gap:7px;margin:8px 0 0;font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-expiry-glyph{display:inline-flex;flex:none;margin-top:2px;opacity:.85}
.dsm-workbuddy-xdpool-expiry-warn{color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-workbuddy-xdpool-expiry-muted{color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-workbuddy-xdpool-expiry-note{color:var(--dsw-alias-label-dimmed,#8b9099)}

/* Pool health verdict: one line, coloured by the worst finding. */
.dsm-workbuddy-xdpool-health{display:flex;align-items:center;gap:7px;margin:8px 0 0;font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-health-dot{width:7px;height:7px;border-radius:999px;flex:none;background:currentColor}
.dsm-workbuddy-xdpool-health-dead{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-xdpool-health-attention{color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-workbuddy-xdpool-health-note{color:var(--dsw-alias-label-tertiary,#9aa0a8)}

/* Two-week consumption trend: one bar per local day, oldest on the left. */
.dsm-workbuddy-xdpool-trend{display:flex;flex-direction:column;gap:6px;margin:10px 0 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#25262b)}
.dsm-workbuddy-xdpool-trend-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.dsm-workbuddy-xdpool-trend-title{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600}
.dsm-workbuddy-xdpool-trend-total{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-trend-bars{display:flex;align-items:flex-end;gap:3px;height:44px}
.dsm-workbuddy-xdpool-trend-bar{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;height:100%}
/* The brand token resolves to a near-black in this host theme, so a bar drawn with
   it reads as ink rather than as data. The success token is the one this card has
   already been shown to render as a colour, so the bars use it and the newest day
   is the fully opaque one. */
.dsm-workbuddy-xdpool-trend-fill{width:100%;border-radius:3px 3px 0 0;background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 50%, transparent);min-height:2px;transition:height .3s}
.dsm-workbuddy-xdpool-trend-fill-zero{background:color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 80%, transparent)}
.dsm-workbuddy-xdpool-trend-fill-today{background:var(--dsw-alias-state-success-primary,#22a06b);box-shadow:0 0 0 1px color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent)}
.dsm-workbuddy-xdpool-trend-axis{display:flex;justify-content:space-between;color:var(--dsw-alias-label-dimmed,#8b9099);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums}

/* Two-column stats: packages on the left, total + check-in on the right. */
.dsm-workbuddy-xdpool-stats{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(168px,.85fr);gap:0;flex:1 1 420px;min-width:0;max-width:660px;border-left:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}
.dsm-workbuddy-xdpool-panel{display:flex;flex-direction:column;min-width:0;gap:6px;padding:10px 12px}
.dsm-workbuddy-xdpool-panel-title{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600}
.dsm-workbuddy-xdpool-panel-empty{color:var(--dsw-alias-label-tertiary,#999);font-size:14px;line-height:20px}
.dsm-workbuddy-xdpool-panel-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:18px;word-break:break-word}
.dsm-workbuddy-xdpool-panel-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-panel-foot strong{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-packages{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
/* One credit package per line, as a three-column table: name, deadline, amount.
   Each row used to spend two lines on this, with the deadline on a line of its
   own under the name. With seven packages that is fourteen lines per account
   card, and an account card is most of a screen tall - so the deadline moves
   into its own column and the list halves in height. Rows are separated by a
   hairline instead of a gap, which keeps the columns readable as a table. */
.dsm-workbuddy-xdpool-packages li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;column-gap:10px;align-items:baseline;padding:3px 0;border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 35%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-packages li:last-child{border-bottom:0}
.dsm-workbuddy-xdpool-packages-name{grid-column:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-packages-value{grid-column:3;justify-self:end;min-width:58px;text-align:right;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;font-variant-numeric:tabular-nums}
/* Per-package deadline: the upstream grants one-off packs at arbitrary clock
   times, so each row carries its own; the soon ones are tinted. */
.dsm-workbuddy-xdpool-packages-when{grid-column:2;justify-self:end;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-packages-when-soon{color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-workbuddy-xdpool-panel-total{position:relative;align-items:center;text-align:center;justify-content:center;overflow:hidden;background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 5%, transparent)}
.dsm-workbuddy-xdpool-panel-total::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;opacity:.9;background:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-total-value{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:28px;line-height:32px;font-weight:800;letter-spacing:-.02em;white-space:nowrap;font-variant-numeric:tabular-nums}

/* Model directory list. */
.dsm-workbuddy-xdpool-models{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-workbuddy-xdpool-models-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsm-workbuddy-xdpool-models-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-workbuddy-xdpool-models-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-model-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}
.dsm-workbuddy-xdpool-model{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;padding:7px 11px;background:var(--dsw-alias-bg-layer-2,#232529);transition:opacity .16s}
.dsm-workbuddy-xdpool-model+.dsm-workbuddy-xdpool-model{border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-xdpool-model-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsm-workbuddy-xdpool-model-copy{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}
.dsm-workbuddy-xdpool-model-name{display:inline-flex;align-items:baseline;gap:7px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-model-name-rate{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:400;line-height:16px;flex:none}
/* The upstream declared no rate for this model. Muted, but present: its absence
   is the information. */
.dsm-workbuddy-xdpool-model-name-rate-unknown{color:var(--dsw-alias-state-warning-primary,#d97706);font-style:italic}
/* The id is long and was given a line of its own, which made every model three
   lines tall for one identifier. It shares the meta line now and ellipsises if
   the column is narrow, so the model name still wins the space it needs. */
.dsm-workbuddy-xdpool-model-id{color:var(--dsw-alias-label-dimmed,#8b9099);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 120px}
.dsm-workbuddy-xdpool-model-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-model-meta-tag{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:rgba(174,179,187,.11);color:var(--dsw-alias-label-secondary,#c6c9d0);flex:none}
/* An enabled model with nobody behind it is a warning, not a label. */
.dsm-workbuddy-xdpool-model-meta-tag-warn{background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.15));color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-workbuddy-xdpool-model-cap{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
/* Model row: checkbox + image toggle + context-budget radios. */
.dsm-workbuddy-xdpool-model-off{opacity:.55}
.dsm-workbuddy-xdpool-model-check{display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer}
.dsm-workbuddy-xdpool-model-check input{margin:0;accent-color:var(--dsw-alias-state-success-primary,#22a06b);flex:none}
.dsm-workbuddy-xdpool-model-controls{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.dsm-workbuddy-xdpool-model-image{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-model-image input{margin:0;accent-color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-model-budget{display:flex;align-items:center;gap:9px;flex:none;margin:0;padding:0;border:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-model-budget label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.dsm-workbuddy-xdpool-model-budget input{margin:0;accent-color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-models-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsm-workbuddy-xdpool-models-actions{display:flex;align-items:center;gap:8px;flex:none}


/* Check-in docked under the total, inside the right-hand panel. */
.dsm-workbuddy-xdpool-checkin{display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;margin-top:8px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-xdpool-checkin-meta{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%}
.dsm-workbuddy-xdpool-checkin-streak{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:17px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-checkin-daily{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-checkin-bonus{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:var(--dsw-alias-state-success-subtle,rgba(51,160,107,.14));color:var(--dsw-alias-state-success-primary,#22a06b);text-align:center}
.dsm-workbuddy-xdpool-checkin-btn{width:100%;padding:5px 10px;border-radius:8px;border:1px solid transparent;font-size:12px;font-weight:600;line-height:18px;cursor:pointer;background:var(--dsw-alias-state-success-primary,#22a06b);color:#fff;transition:opacity .16s,border-color .16s,background .16s}
.dsm-workbuddy-xdpool-checkin-btn:hover:not(:disabled){opacity:.88}
.dsm-workbuddy-xdpool-checkin-btn:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:1px}
.dsm-workbuddy-xdpool-checkin-btn:disabled{cursor:default;background:transparent;border-color:var(--dsw-alias-border-l2,#3a3d45);color:var(--dsw-alias-label-tertiary,#9aa0a8);opacity:1}
.dsm-workbuddy-xdpool-checkin-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:11px;line-height:16px;text-align:center;word-break:break-word}

/* Inline notes + error messages. */
.dsm-workbuddy-xdpool-note{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:13px;line-height:20px}
.dsm-workbuddy-xdpool-error{margin:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:13px;line-height:20px}

/* Responsive: stack the stats columns on narrow screens. */
@media (max-width:760px){
  .dsm-workbuddy-xdpool-stats{grid-template-columns:1fr}
  .dsm-workbuddy-xdpool-panel-total{align-items:stretch;text-align:left}
  .dsm-workbuddy-xdpool-total-value{text-align:left}
  .dsm-workbuddy-xdpool-checkin{align-items:stretch}
  .dsm-workbuddy-xdpool-checkin-meta{align-items:flex-start}
  .dsm-workbuddy-xdpool-checkin-bonus{text-align:left}
}

/* Automation panel: schedule and last-run summary, collapsed behind a switch. */
.dsm-workbuddy-xdpool-auto{margin-top:10px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:9px;background:var(--dsw-alias-bg-module-platform,#202126)}
.dsm-workbuddy-xdpool-auto-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsm-workbuddy-xdpool-auto-title{color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-weight:600}
.dsm-workbuddy-xdpool-auto-switch{padding:3px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;cursor:pointer;transition:color .16s,border-color .16s,background .16s}
.dsm-workbuddy-xdpool-auto-switch:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#777);color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-workbuddy-xdpool-auto-switch:disabled{opacity:.5;cursor:not-allowed}
/* One accent, not three. These were hardcoded teal, which matched neither the
   theme nor the green used everywhere else on the card. */
.dsm-workbuddy-xdpool-auto-switch-on{border-color:var(--dsw-alias-state-success-primary,#22a06b);color:var(--dsw-alias-state-success-primary,#22a06b);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 12%, transparent)}
.dsm-workbuddy-xdpool-auto-hint{margin:6px 0 0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:1.6}
.dsm-workbuddy-xdpool-auto-total-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}
/* One definition only: this was declared twice, and the two declarations set
   competing layout directions that the cascade then merged into neither. */
.dsm-workbuddy-xdpool-auto-total{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:6px 8px;border-radius:8px;background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 8%, transparent);font-size:11px}
.dsm-workbuddy-xdpool-auto-total-list{display:flex;flex-direction:column;gap:2px}
.dsm-workbuddy-xdpool-auto-total-row{color:var(--dsw-alias-state-success-primary,#22a06b);font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-earned{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px}
.dsm-workbuddy-xdpool-earned-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}
.dsm-workbuddy-xdpool-earned-list{display:flex;flex-direction:column;gap:2px}
.dsm-workbuddy-xdpool-earned-row{color:var(--dsw-alias-state-success-primary,#22a06b);font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-earned-value{color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-auto-jobs{margin-top:8px;display:flex;flex-direction:column;gap:0}
/* One scheduled job per line, as fixed columns: name, hours, last result, note.
   This used to be a wrapping flex row, so the four fields reflowed at different
   widths on each job and the block read as ragged text. A long detail string
   still takes its own full line, but the numeric columns stay aligned. */
.dsm-workbuddy-xdpool-auto-job{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline;column-gap:10px;row-gap:2px;padding:5px 0;border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 30%, transparent);font-size:12px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-xdpool-auto-job:last-child{border-bottom:0}
.dsm-workbuddy-xdpool-auto-job-name{grid-column:1;flex:0 0 auto;min-width:72px;color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}
.dsm-workbuddy-xdpool-auto-job-when{grid-column:2;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-auto-job-last{grid-column:3;text-align:right;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsm-workbuddy-xdpool-auto-job-note{grid-column:3;text-align:right;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;white-space:nowrap}
.dsm-workbuddy-xdpool-auto-job-detail{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:15px;min-width:0;word-break:break-word}
/* Reserved credits: one inline number field per account. */
/* Reserved credits: label, amount, save, note - as fixed columns.
   This was a wrapping flex row of six items, so the input, its unit, the save
   button and the note each landed wherever the text happened to fit, and the
   unit could be split from the field it belongs to. A grid keeps the field and
   its unit together and parks the button in a column of its own. */
.dsm-workbuddy-xdpool-reserve{display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:6px 8px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px;color:var(--dsw-alias-label-dimmed,#8a97b5)}
.dsm-workbuddy-xdpool-reserve-label{grid-column:1;flex:0 0 auto;white-space:nowrap}
/* Field and its unit are one grid cell, so nothing can separate them. */
.dsm-workbuddy-xdpool-reserve-field{grid-column:2;display:inline-flex;align-items:center;gap:5px;justify-self:start}
.dsm-workbuddy-xdpool-reserve-input{width:76px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-variant-numeric:tabular-nums;transition:border-color .16s,background .16s}
.dsm-workbuddy-xdpool-reserve-input:focus{outline:none;border-color:var(--dsw-alias-state-success-primary,#22a06b);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 7%, transparent)}
.dsm-workbuddy-xdpool-reserve-input:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:1px}
.dsm-workbuddy-xdpool-reserve-input:disabled{opacity:.6}
.dsm-workbuddy-xdpool-reserve-unit{white-space:nowrap}
.dsm-workbuddy-xdpool-reserve-badge{grid-column:3;justify-self:start;padding:1px 7px;border-radius:999px;background:color-mix(in oklab, var(--dsw-alias-state-error-primary,#ef4444) 14%, transparent);color:var(--dsw-alias-state-error-primary,#ef4444);font-size:10px;white-space:nowrap}
/* Explicit Save: the field is a draft, so the button (not a blur) is what
   commits it — and the outcome is reported right here, next to the control. */
.dsm-workbuddy-xdpool-reserve-save{grid-column:3;justify-self:start;appearance:none;font:inherit;font-size:11px;font-weight:600;line-height:16px;padding:3px 12px;border-radius:6px;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);cursor:pointer;transition:opacity .16s,background .16s,border-color .16s,color .16s}
.dsm-workbuddy-xdpool-reserve-save:hover:not(:disabled){background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 24%, transparent);border-color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-reserve-save:disabled{cursor:default;border-color:var(--dsw-alias-border-l2,#3a3d45);background:transparent;color:var(--dsw-alias-label-tertiary,#8a90a0);opacity:.75}
/* Notes and the current reservation span the row: they are prose, not controls. */
.dsm-workbuddy-xdpool-reserve-note{grid-column:1/-1;font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-reserve-note-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-reserve-note-bad{color:var(--dsw-alias-state-error-primary,#ef4444);font-weight:600}

/* Request log: every request the pool served, newest first.
   This replaced a one-line summary of the last request. A summary can say a
   request failed but not that the SAME request failed three times and rotated
   through two accounts before it did - which is the thing worth knowing about a
   rotating pool, and the only reason its failure mode is visible at all. */
.dsm-workbuddy-xdpool-req{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-workbuddy-xdpool-req-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-workbuddy-xdpool-req-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-workbuddy-xdpool-req-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* The wait, split into its three stages. The total stays on the first line so the
   column still scans as a single number; the split sits under it in smaller,
   dimmer type, because it is the detail you read only when the total looks wrong. */
.dsm-workbuddy-xdpool-req-phase{display:flex;flex-direction:column;align-items:flex-end;gap:1px}
.dsm-workbuddy-xdpool-req-phase-total{font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-req-phase-split{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:10px;line-height:13px;white-space:nowrap}
/* Per-model queue comparison: a second table under the request rows, deliberately
   smaller and quieter than the log itself. It answers one question - which model
   queues less - and should not compete with the evidence it is derived from. */
.dsm-workbuddy-xdpool-queue{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-xdpool-queue-title{margin:0 0 6px;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;font-weight:600;line-height:18px}
.dsm-workbuddy-xdpool-queue-scroll{overflow-x:auto}
.dsm-workbuddy-xdpool-queue-table{width:100%;border-collapse:collapse;font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-queue-table th{color:var(--dsw-alias-label-tertiary,#999);font-weight:500;text-align:left;padding:2px 8px 2px 0;white-space:nowrap}
.dsm-workbuddy-xdpool-queue-table td{padding:2px 8px 2px 0;border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-xdpool-queue-model{color:var(--dsw-alias-label-primary,#e6e6e6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
/* The figure the comparison exists for, given the weight it deserves. */
.dsm-workbuddy-xdpool-queue-p50{color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
/* Collapse toggles for the models and request sections.
   Same shape as the accounts toggle above, so the three headings read as one
   family: a chevron, a title that lights up on hover, and a focus ring. The
   chevron rotates rather than being swapped for a different glyph, which keeps
   the heading from shifting sideways as it opens. */
.dsm-workbuddy-xdpool-models-toggle,.dsm-workbuddy-xdpool-req-toggle{appearance:none;font:inherit;cursor:pointer;display:flex;align-items:center;gap:7px;min-width:0;padding:0;border:0;background:transparent;color:inherit;text-align:left}
.dsm-workbuddy-xdpool-models-toggle:hover .dsm-workbuddy-xdpool-models-title,.dsm-workbuddy-xdpool-req-toggle:hover .dsm-workbuddy-xdpool-req-title{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-models-toggle:focus-visible,.dsm-workbuddy-xdpool-req-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary,#22a06b);outline-offset:2px;border-radius:6px}
.dsm-workbuddy-xdpool-models-chevron,.dsm-workbuddy-xdpool-req-chevron{display:flex;flex:none;color:var(--dsw-alias-label-tertiary,#999);transition:transform .15s ease}
.dsm-workbuddy-xdpool-models-chevron-open,.dsm-workbuddy-xdpool-req-chevron-open{transform:rotate(180deg)}
.dsm-workbuddy-xdpool-req-empty{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:13px;line-height:20px}
.dsm-workbuddy-xdpool-req-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}
/* Eight fields on one line. The table scrolls sideways rather than wrapping: a
   wrapped row cannot be scanned down a column, and the columns are what make
   twenty of these readable at once. The min-width keeps the header and the rows
   on the SAME track, so a scrolled table never loses its column names. */
.dsm-workbuddy-xdpool-req-scroll{overflow-x:auto}
.dsm-workbuddy-xdpool-req-table{width:100%;min-width:640px;border-collapse:collapse;font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-req-table thead th{padding:6px 10px;text-align:left;font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600;color:var(--dsw-alias-label-tertiary,#999);background:var(--dsw-alias-bg-layer-3,#2a2c33);border-bottom:1px solid var(--dsw-alias-border-l2,#36373b);white-space:nowrap}
.dsm-workbuddy-xdpool-req-table tbody td{padding:6px 10px;color:var(--dsw-alias-label-secondary,#c6c9d0);border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 35%, transparent);white-space:nowrap}
.dsm-workbuddy-xdpool-req-table tbody tr:last-child td{border-bottom:0}
/* The numeric columns are right-aligned so the digits line up between rows and a
   slow request can be spotted by width alone. */
.dsm-workbuddy-xdpool-req-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-xdpool-req-model{max-width:190px;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-xdpool-req-model-none{color:var(--dsw-alias-label-dimmed,#8b9099)}
.dsm-workbuddy-xdpool-req-account{max-width:150px;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-xdpool-req-num{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-xdpool-req-token{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
/* Outcome: the one column that must survive a glance. The dot carries the colour
   and the word carries the meaning, so neither colour-blindness nor a monochrome
   screenshot loses it. */
.dsm-workbuddy-xdpool-req-outcome{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsm-workbuddy-xdpool-req-outcome-dot{width:6px;height:6px;border-radius:50%;flex:none;background:currentColor}
.dsm-workbuddy-xdpool-req-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-req-bad{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-workbuddy-xdpool-req-warn{color:var(--dsw-alias-state-warning-primary,#d97706)}
/* Rotations: the attempt count, and who each attempt went to. Never truncated —
   the whole point of the column is to name the accounts that were tried. */
.dsm-workbuddy-xdpool-req-tries{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-xdpool-req-rotation{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;white-space:normal;word-break:break-word;min-width:110px}

/* Theme cycle: one button, following-system -> light -> dark.
   The card normally inherits the host's theme tokens, which the host declares on
   the body element:
     body { --dsw-alias-label-primary:#0f1115; ... }
     @media (prefers-color-scheme: dark) { body { ...dark values... } }
   Because custom properties inherit, a declaration on body wins over anything
   html passes down, so these overrides are written on body too. An earlier
   version selected html[data-theme=...] and did nothing at all: it changed the
   value html handed to body, and body immediately redeclared its own.
   Specificity is not the issue and raising it would not have helped - the
   declaration has to sit on the element that declares the tokens.
   Only a handful need restating: these are the ones this card actually paints
   with, and anything left alone keeps the host's value. */
.dsm-workbuddy-xdpool-theme{flex:none}
/* Explicit light. Specificity (0,1,1) beats the host's plain body rule, so this
   also wins inside its prefers-color-scheme: dark block. */
body[data-theme="light"]{
  --dsw-alias-border-l2:#d8dbe2;
  --dsw-alias-label-primary:#1c1f24;
  --dsw-alias-label-secondary:#3f454e;
  --dsw-alias-label-tertiary:#5c636d;
  --dsw-alias-label-dimmed:#767d88;
  --dsw-alias-bg-layer-2:#ffffff;
  --dsw-alias-bg-layer-3:#f1f2f5;
  --dsw-alias-bg-module-platform:#ffffff;
}
/* Explicit dark. These match the fallbacks the card already carries, so pinning
   dark changes nothing visually when the host is dark too — which is the point:
   the button must be able to return the card to exactly where it started. */
body[data-theme="dark"]{
  --dsw-alias-border-l2:#36373b;
  --dsw-alias-label-primary:#e6e6e6;
  --dsw-alias-label-secondary:#c6c9d0;
  --dsw-alias-label-tertiary:#9aa0a8;
  --dsw-alias-label-dimmed:#8b9099;
  --dsw-alias-bg-layer-2:#25262b;
  --dsw-alias-bg-layer-3:#2a2c33;
  --dsw-alias-bg-module-platform:#202126;
}

/* Headline usage bar: four equal columns over one rounded surface, sitting at
   the very top of the card body. Every colour comes from the host tokens, so the
   same rules read correctly on the dark module surface and on a light theme. */
/* A 1px gap over a border-coloured background draws the separators, which keeps
   the four tiles flush instead of nesting a border inside a bordered strip. */
.dsm-workbuddy-xdpool-usagebar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:10px 0 0;padding:0;border:0;border-radius:12px;background:color-mix(in oklab, var(--dsw-alias-border-l2,#36373b) 60%, transparent);overflow:hidden}
.dsm-workbuddy-xdpool-usagebar-cell{display:flex;flex-direction:column;gap:4px;min-width:0;padding:9px 11px;background:var(--dsw-alias-bg-layer-2,#25262b)}
/* Green rather than the brand token: in this host theme the brand token resolves
   to a neutral, so an accent built on it renders as plain grey. The success token
   is already this card's colour for credit figures, so the headline agrees with
   the rest of the card instead of fighting it.
   The four columns stay equal on purpose. Widening this one squeezed the other
   three until a nine-character figure like "13,040.00" no longer fitted, which is
   what produced "13,040....". The accent identifies the headline; it does not need
   extra width to do it. */
.dsm-workbuddy-xdpool-usagebar-cell-lead{background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 15%, var(--dsw-alias-bg-layer-2,#25262b));box-shadow:inset 0 3px 0 0 var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-usagebar-head{display:flex;align-items:center;gap:5px;min-width:0}
.dsm-workbuddy-xdpool-usagebar-glyph{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-xdpool-usagebar-cell-lead .dsm-workbuddy-xdpool-usagebar-glyph{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-usagebar-label{color:var(--dsw-alias-label-tertiary,#999);font-size:11.5px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-xdpool-usagebar-value{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:20px;line-height:24px;font-weight:700;letter-spacing:-.015em;white-space:nowrap;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-xdpool-usagebar-cell-lead .dsm-workbuddy-xdpool-usagebar-value{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:21px;font-weight:800}
.dsm-workbuddy-xdpool-usagebar-note{margin:6px 2px 0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px}
@media (max-width:760px){
  .dsm-workbuddy-xdpool-usagebar{grid-template-columns:repeat(2,minmax(0,1fr))}
}

/* Narrow card: every multi-column block above becomes one column.
   These are max-width queries on the VIEWPORT, not container queries, so they
   also fire on a wide window whose settings pane is narrow — the layout is
   measured against the space the card is actually given, which is the case that
   was breaking. */
@media (max-width:640px){
  /* Two columns of controls cannot fit; the row wraps as a group instead. */
  .dsm-workbuddy-xdpool-usage-head{flex-direction:column;align-items:stretch}
  .dsm-workbuddy-xdpool-usage-actions{justify-content:flex-start}
  /* The three-way switch is a segmented control: side by side it would collapse
     to three unreadable slivers, so it stacks and each option gets its label. */
  .dsm-workbuddy-xdpool-dist-options{grid-template-columns:1fr}
  /* Account rows already wrap their body; the heading row is a flex row of a
     label, two tags and a switch, and the switch is what has to move down. */
  .dsm-workbuddy-xdpool-account-head{flex-wrap:wrap;row-gap:6px}
  .dsm-workbuddy-xdpool-account-head .dsm-workbuddy-xdpool-account-toggle{margin-left:0}
  /* Identity row stacks above the credit panels rather than beside them. */
  .dsm-workbuddy-xdpool-account-copy{flex:1 1 100%}
  .dsm-workbuddy-xdpool-stats{flex:1 1 100%;max-width:none;grid-template-columns:1fr;border-left:0}
  /* Package rows: the deadline drops under the name, the amount stays right. */
  .dsm-workbuddy-xdpool-packages li{grid-template-columns:minmax(0,1fr) auto}
  .dsm-workbuddy-xdpool-packages-when{grid-column:1;justify-self:start;grid-row:2}
  .dsm-workbuddy-xdpool-packages-value{grid-column:2;grid-row:1 / span 2;align-self:center}
  /* Model rows: controls drop below the name instead of squeezing it. */
  .dsm-workbuddy-xdpool-model-head{flex-wrap:wrap;row-gap:6px}
  .dsm-workbuddy-xdpool-model-controls{justify-content:flex-start;flex:1 1 100%}
  /* The request table keeps its columns and scrolls; only the padding shrinks,
     which buys back enough width that most rows still fit without scrolling. */
  .dsm-workbuddy-xdpool-req-table thead th,
  .dsm-workbuddy-xdpool-req-table tbody td{padding:5px 7px}
  .dsm-workbuddy-xdpool-req-table{min-width:560px}
}
@media (max-width:420px){
  .dsm-workbuddy-xdpool-usagebar{grid-template-columns:1fr}
  .dsm-workbuddy-xdpool-accounts-head{flex-direction:column;align-items:flex-start;gap:6px}
  .dsm-workbuddy-xdpool-models-head{flex-direction:column;align-items:flex-start;gap:6px}
  .dsm-workbuddy-xdpool-auto-head{flex-wrap:wrap;row-gap:6px}
}
`.trim();
		//#endregion
		//#region src/client/PoolCard.tsx
		/**
		* RotaKit card contributed to DSH Plugin configuration.
		*
		* The card body mirrors the LaoDing plugin family used by dingminhua's
		* `dsh-connect-workbuddy`: a small status row (dot + count + Rescan / Clear
		* cooldowns buttons), then a per-account panel showing label / status tag /
		* token expiry / cooldown info / credit packages, then the model directory
		* with per-model free/limited/night/image badges and context size.
		*
		* The outer shell reuses the host's `dsm-plugin-card*` classes so the
		* collapse affordance is identical to every other plugin configuration row.
		*
		* @module dsh-rotakit/client/PoolCard
		*/
		/**
		* Default context window the card offers as the "capped" choice, in tokens.
		* Mirrors the host-side DEFAULT_CONTEXT_BUDGET; declared here rather than
		* imported, because the browser bundle must not pull in the host entry.
		*/
		const DEFAULT_CONTEXT_BUDGET = 2e5;
		const POLL_INTERVAL_MS = 3e4;
		/**
		* How many rows of the request log the card draws.
		*
		* The log grows without bound on the host, and it is the one array on the
		* status document that does. Twenty covers "what just happened, and did it
		* rotate" without turning the card into a scrolling wall whose height depends
		* on how long the app has been open.
		*/
		const REQUEST_LOG_LIMIT = 20;
		/**
		* Read the stored theme choice.
		*
		* Every failure mode here is expected rather than exceptional: the app may be
		* served with storage disabled, and DSH preloads its plugins as `file://`, an
		* origin for which Chromium throws on `localStorage` unless it was started
		* with `--allow-file-access-from-files`. A throw here must therefore not be
		* allowed to abort the rest of module evaluation, which is why the access
		* itself is inside the `try` and not just the parse.
		*
		* An unrecognised stored value is discarded rather than trusted: a hand-edited
		* or half-written entry must fall back to following the system, not wedge the
		* cycle on a mode it cannot render.
		*/
		function readThemeChoice() {
			try {
				const stored = window.localStorage.getItem(POOL_THEME_STORAGE_KEY);
				if (stored === "light" || stored === "dark" || stored === "system") return stored;
			} catch (error) {
				console.warn("[dsh-rotakit] theme preference unreadable; following the system:", error);
			}
			return "system";
		}
		/** Persist the theme choice; storage being unavailable is not an error worth showing. */
		function writeThemeChoice(choice) {
			try {
				window.localStorage.setItem(POOL_THEME_STORAGE_KEY, choice);
			} catch (error) {
				console.warn("[dsh-rotakit] theme preference not saved:", error);
			}
		}
		/**
		* Paint the chosen theme, or hand the attribute back on "system".
		*
		* The attribute goes on `body`, NOT on `documentElement`, and that placement
		* is the whole trick. The host declares its `--dsw-alias-*` tokens on `body`:
		*
		*     body { --dsw-alias-label-primary:#0f1115; ... }
		*     @media (prefers-color-scheme: dark) { body { ...dark values... } }
		*
		* CSS custom properties inherit, and a declaration on `body` applies to
		* everything inside it no matter what `html` says. An override written on
		* `html` therefore changes only the value `html` hands down, which `body`
		* immediately redeclares - so the cascade never reaches the card and the
		* choice appears to do nothing at all. The override has to sit on the element
		* that actually declares the tokens, or below it.
		*
		* `removeAttribute` rather than setting `"system"`: the attribute is a
		* two-valued override, and with it gone the host's own media query decides,
		* which is exactly what "follow the system" should mean.
		*/
		function applyTheme(choice) {
			/**
			* `body` is absent during the very first evaluation, before the host has
			* built its DOM. Falling back to `documentElement` keeps the call safe; the
			* caller re-applies once the document is ready.
			*/
			const root = document.body ?? document.documentElement;
			if (choice === "system") root.removeAttribute("data-theme");
			else root.dataset.theme = choice;
		}
		/**
		* The OS colour scheme, or null where the API is missing.
		*
		* A null answer is not the same as "light": an environment without
		* `matchMedia` should leave the card exactly as the host painted it instead of
		* having this card guess and override it.
		*/
		function themeMedia() {
			if (typeof window.matchMedia !== "function") return null;
			return window.matchMedia("(prefers-color-scheme: dark)");
		}
		/** Which theme the card is showing right now, with "system" resolved. */
		function resolveTheme(choice) {
			if (choice === "light" || choice === "dark") return choice;
			return themeMedia()?.matches === true ? "dark" : "light";
		}
		/** The next state of the cycle: system -> light -> dark -> system. */
		function nextThemeChoice(choice) {
			if (choice === "system") return "light";
			return choice === "light" ? "dark" : "system";
		}
		/**
		* The request log the host sent, bounded, or an empty list.
		*
		* Every field on a row is optional and a row can be missing entirely on an
		* older host, so a missing `requests` degrades to "nothing logged yet"
		* instead of throwing inside render — which, on a card wrapped in an error
		* boundary, would replace the whole panel with a stack trace.
		*/
		function requestRows(status) {
			const rows = status?.requests;
			return Array.isArray(rows) ? rows.slice(0, REQUEST_LOG_LIMIT) : [];
		}
		/**
		* A millisecond duration as something readable: `850ms`, `4.2s`, `1m 3s`.
		*
		* The threshold sits at a second because that is where the useful precision
		* changes: sub-second figures are only interesting to the millisecond (a
		* first token at 850ms is fast, at 950ms is not), while anything longer is
		* read as "about four seconds" and a decimal would be noise. Returns an empty
		* string for a missing value so the caller draws its own placeholder — the
		* string "undefined" must never reach the table.
		*/
		function formatDuration(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
			if (ms < 1e3) return `${Math.round(ms)}ms`;
			if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
			const minutes = Math.floor(ms / 6e4);
			const seconds = Math.round(ms % 6e4 / 1e3);
			return `${minutes}m ${seconds}s`;
		}
		/**
		* Wall-clock time of day, `HH:MM:SS`.
		*
		* Not `formatTime`: that one is a locale-formatted month/day/minute stamp for
		* a deadline, and a request log is read down a column where a fixed width and
		* a stable order matter more than the locale's preferred field order.
		*/
		function formatClock(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
			const at = new Date(ms);
			return [
				at.getHours(),
				at.getMinutes(),
				at.getSeconds()
			].map((part) => String(part).padStart(2, "0")).join(":");
		}
		/**
		* One request outcome reduced to what the table needs: a colour, a phrase,
		* and the copy needed to explain a failure on hover.
		*
		* `ok` and `pending` are the only two outcomes that are not failures — the
		* distinction matters because a pending request is neither good nor bad news
		* and must not be painted red, while every other kind names a way the request
		* did not come back. Those kinds are reported raw: the host's vocabulary is
		* the only place the real cause is stated, and inventing a friendlier word
		* here would lose it.
		*/
		function requestOutcome(row, t) {
			const raw = typeof row.outcome === "string" && row.outcome !== "" ? row.outcome : void 0;
			if (raw === "ok") return {
				tone: "ok",
				label: t?.("row.reqOk") ?? "ok"
			};
			if (raw === "pending") return {
				tone: "warn",
				label: t?.("row.reqPending") ?? "pending"
			};
			if (raw === void 0) return {
				tone: "warn",
				label: t?.("row.reqUnknown") ?? "unknown"
			};
			return {
				tone: "bad",
				label: raw,
				detail: t?.("row.reqFailedHint") ?? ""
			};
		}
		/**
		* Inject or refresh the shared card CSS for the current client bundle.
		*
		* The stored theme is applied here, once per module load, because an effect
		* runs only after the first render: doing it there would flash the host's
		* theme for a frame and then correct itself. The flag keeps that to one
		* application per document.
		*/
		if (typeof document !== "undefined") {
			const cssId = "dsh-rotakit/client.css";
			const existing = document.querySelector(`style[data-plugin-css="${cssId}"]`);
			if (existing !== null) existing.textContent = POOL_CARD_CSS;
			else {
				const styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-rotakit";
				styleTag.dataset.pluginCss = cssId;
				styleTag.textContent = POOL_CARD_CSS;
				document.head.appendChild(styleTag);
			}
			/* Re-apply the stored theme after a re-registration as well: the host may
			   have mounted a fresh document root, or another plugin may have taken
			   the attribute over. `applyTheme` is idempotent, so this costs nothing
			   when the value is already right.
			   The attribute has to land on `body`, which does not exist during the
			   earliest evaluation. Rather than fall back to an element nothing reads,
			   the apply is deferred until `body` is there - otherwise the stored
			   choice appears to be forgotten on the one load that matters. */
			const paint = () => {
				if (document.body === null) return false;
				applyTheme(readThemeChoice());
				return true;
			};
			if (!paint()) document.addEventListener("DOMContentLoaded", paint, { once: true });
		}
		function formatNumber(value) {
			if (value === void 0) return "–";
			return new Intl.NumberFormat(void 0, { maximumFractionDigits: 0 }).format(value);
		}
		/**
		* Coerce a possibly-missing count to a number, so a sum never becomes NaN.
		*
		* Distinct from `formatNumber`: that one is for DISPLAY and returns the "–"
		* placeholder, which must never reach arithmetic. Counting and summing always
		* go through here, so an older host that omits a field contributes 0 instead of
		* poisoning a whole total.
		*/
		function asNumber(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}
		/**
		* Format one headline usage figure: thousands separators and exactly two
		* decimals, so the four columns keep a common width and read as money-like
		* magnitudes (`31,927.24`). A missing figure renders `--` rather than `0.00`:
		* an unknown balance and a spent-down balance are different facts, and showing
		* zero for the former would be a lie the user cannot detect.
		*/
		function formatUsage(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "--";
			return new Intl.NumberFormat(void 0, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			}).format(value);
		}
		/**
		* True when `since` is a local `YYYY-MM-DD` date inside the last `days` days.
		*
		* The host sends a date-only string, so `Date.parse` is deliberately avoided:
		* it reads a bare `YYYY-MM-DD` as UTC midnight, which lands on the previous
		* day for anyone west of Greenwich. Parsing the parts by hand keeps the answer
		* in the user's own calendar. Unparsable input is simply "not recent".
		*/
		function usageSinceIsRecent(since, days) {
			if (typeof since !== "string") return false;
			const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since.trim());
			if (parts === null) return false;
			const start = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
			const midnight = new Date();
			midnight.setHours(0, 0, 0, 0);
			const elapsed = midnight.getTime() - start.getTime();
			return elapsed >= 0 && elapsed <= days * 864e5;
		}
		function formatTime(value) {
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit"
			}).format(new Date(value));
		}
		function formatDateTime(value) {
			if (value === void 0) return "";
			const ms = Date.parse(value);
			if (Number.isNaN(ms)) return value;
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit"
			}).format(new Date(ms));
		}
		/**
		* The automation jobs, in the order they run.
		*
		* The order is the contract: the report has to land before the task pass, or
		* the task pass reads progress the report would have lit. `hoursOf` reads the
		* matching hour list off the status document so the panel stays in step with
		* whatever schedule the scheduler is actually running on.
		*/
		const AUTOMATION_JOBS = [
			"checkin",
			"report",
			"tasks",
			"streak",
			"travel"
		];
		/** Read one job's configured hours off the status document. */
		function automationHours(status, kind) {
			const automation = status.automation;
			if (automation === void 0) return [];
			switch (kind) {
				case "report": return automation.reportHours;
				case "tasks": return automation.taskHours;
				case "checkin": return automation.checkinHours;
				case "streak": return automation.streakHours;
				case "travel": return automation.travelHours;
			}
		}
		/** Read one job's last-run record off the status document. */
		function automationJob(status, kind) {
			return status.automation?.jobs[kind];
		}
		/**
		* The automation panel's whole source of truth, or undefined when the tab has
		* no automation to speak for.
		*
		* Automation is a `cn`-only, host-wide scheduler, so the merged tab must not
		* claim it. `status.automation` is read unguarded in a dozen places inside that
		* section, so the section is gated ONCE on this helper rather than sprinkling
		* optional chaining through all of them — a single gate is far harder to get
		* wrong than a dozen, and this is exactly the kind of field that goes missing.
		*/
		function automationOf(status) {
			return status?.automation;
		}
		function dotColor(status) {
			return status === "ok" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #ef4444)" : "var(--dsw-alias-label-dimmed, #9aa0a6)";
		}
		function formatCapacity(value) {
			if (value === void 0) return "";
			if (value >= 1e6 && value % 1e6 === 0) return `${value / 1e6}M`;
			if (value >= 1e3 && value % 1e3 === 0) return `${value / 1e3}K`;
			return String(value);
		}
		/**
		* Build the draft from the server's selection + catalog flags.
		*
		* Tolerates a document with no `models` / `selection` and returns an empty
		* draft. The merged tab has neither — no model roster belongs to two upstreams
		* at once — and this runs unconditionally on every render, before the models
		* section has had a chance to decide whether to draw itself. Reading
		* `status.selection` directly here crashed the whole card on that tab; the
		* models block being hidden is not enough, because the draft is built earlier.
		*/
		function draftFromStatus(status) {
			const selection = status?.selection;
			const models = status?.models;
			if (selection === void 0 || models === void 0) return {};
			const enabled = selection.enabledModelIds;
			const images = selection.imageModelIds;
			const budgets = selection.contextBudgets;
			const out = {};
			for (const model of models) {
				const entry = {
					enabled: enabled === void 0 || enabled.includes(model.id),
					images: images === void 0 ? model.supportsImages : images.includes(model.id)
				};
				const budget = budgets?.[model.id];
				if (budget !== void 0) entry.budget = budget;
				out[model.id] = entry;
			}
			return out;
		}
		/**
		* True when the draft differs from what the server last reported.
		*
		* Returns false when there is nothing to compare — a document without models
		* cannot be dirty, and answering `true` would light up the Save button on a tab
		* where saving means nothing.
		*/
		function draftIsDirty(status, draft) {
			const selection = status?.selection;
			const models = status?.models;
			if (selection === void 0 || models === void 0) return false;
			const enabled = new Set(selection.enabledModelIds ?? models.filter((m) => m.enabled).map((m) => m.id));
			const images = new Set(selection.imageModelIds ?? models.filter((m) => m.supportsImages).map((m) => m.id));
			const budgets = selection.contextBudgets ?? {};
			for (const model of models) {
				const entry = draft[model.id];
				if (entry === void 0) continue;
				if (entry.enabled !== enabled.has(model.id)) return true;
				if (entry.images !== images.has(model.id)) return true;
				if ((budgets[model.id] ?? model.nativeContextWindow) !== (entry.budget ?? model.nativeContextWindow)) return true;
			}
			return false;
		}
		/** Absolute expiry with the time of day: the upstream grants one-off packages at
		*  arbitrary clock times, so "expires 09/19 15:36" is what the user needs — a
		*  date alone would read as if it lapsed at midnight. */
		/**
		* A deadline as "10/25".
		*
		* The time of day used to be included, which made every row wider than the
		* column it sits in while carrying almost no information: the packages in one
		* account routinely share a date and differ only by a few minutes. The date is
		* what decides whether credits lapse, so that is what shows; the full stamp is
		* attached as the row's tooltip for the rare case where the hour matters.
		*/
		function formatExpiry(ms) {
			if (ms === void 0 || !Number.isFinite(ms)) return "";
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit"
			}).format(new Date(ms));
		}
		/** The same deadline with its time of day, for tooltips. */
		function formatExpiryFull(ms) {
			if (ms === void 0 || !Number.isFinite(ms)) return "";
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false
			}).format(new Date(ms));
		}
		/** Whole days until `ms`, floored at 0; undefined when there is no deadline. */
		function daysUntil(ms) {
			if (ms === void 0 || !Number.isFinite(ms)) return void 0;
			return Math.max(0, Math.floor((ms - Date.now()) / 864e5));
		}
		/**
		* A cooldown's remaining time as a compact human figure.
		*
		* Cooldowns in this pool are short by design — the rate-limit window defaults
		* to 60 seconds and the exhaustion window to 30 minutes — so the useful unit is
		* seconds under a minute and minutes beyond it. Showing "0 minutes" for a
		* 40-second wait would read as "already done", which is the one thing it is not.
		*
		* Returns "" for a missing or already-elapsed deadline so callers can fall back
		* to an absolute timestamp instead of rendering "in 0s".
		*/
		function formatRemaining(untilMs, now) {
			if (untilMs === void 0 || !Number.isFinite(untilMs)) return "";
			const remaining = untilMs - (now ?? Date.now());
			if (!Number.isFinite(remaining) || remaining <= 0) return "";
			const seconds = Math.ceil(remaining / 1e3);
			if (seconds < 60) return `${seconds}s`;
			const minutes = Math.floor(seconds / 60);
			const rest = seconds % 60;
			if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
			const hours = Math.floor(minutes / 60);
			return `${hours}h ${minutes % 60}m`;
		}
		/**
		* Everything the card knows about one account's cooldowns, in one shape.
		*
		* The pool cools an account in three different scopes, and they are NOT
		* interchangeable — which is exactly what makes them worth drawing separately:
		*
		*   - account-wide, from a hard stop (no credits) or a span-every-model limit
		*   - per-model, from a 429 that named one model; every other model still serves
		*   - none
		*
		* `until` is the maximum across active scopes, i.e. when the account is fully
		* usable again; `soonest` is the minimum, i.e. when ANY capacity returns. A
		* single per-model cooldown has `soonest === until`, but an account with one
		* expired model and one model held for 20 minutes is genuinely usable in
		* between, and that window is what the bar visualises.
		*
		* `reason` distinguishes a rate limit (this account's own fault) from a gateway
		* fault (upstream's), because the two call for opposite reactions: wait it out
		* versus expect the same failure elsewhere. `serverErrorHits` cannot tell them
		* apart on its own once both counters are non-zero, so the caller passes the
		* classification in.
		*/
		function cooldownInfo(account, now) {
			const nowMs = now ?? Date.now();
			const accountUntil = account.cooldownUntil !== void 0 ? Date.parse(account.cooldownUntil) : void 0;
			const accountActive = accountUntil !== void 0 && Number.isFinite(accountUntil) && accountUntil > nowMs;
			const models = (account.modelCooldowns ?? []).map((mc) => ({
				modelId: mc.modelId,
				until: Date.parse(mc.until)
			})).filter((mc) => Number.isFinite(mc.until) && mc.until > nowMs).sort((a, b) => a.until - b.until);
			if (!accountActive && models.length === 0) return { active: false, accountActive: false, models: [], until: void 0, soonest: void 0 };
			const candidates = [];
			if (accountActive) candidates.push(accountUntil);
			for (const mc of models) candidates.push(mc.until);
			return {
				active: true,
				accountActive,
				models,
				until: Math.max(...candidates),
				soonest: Math.min(...candidates),
				accountUntil: accountActive ? accountUntil : void 0
			};
		}
		/**
		* How far through a cooldown we are, as 0-100, for the progress bar.
		*
		* The window is not reported by the host — it only says when the cooldown
		* lifts — so the origin has to be inferred. `COOLDOWN_ASSUMED_WINDOW_MS` is
		* that inference, and it is deliberately the SHORTER of the two configured
		* windows (the 60-second rate-limit cooldown), because the bar is only read as
		* "roughly how much longer" and overstating progress is the safer error: a bar
		* that looks nearly done while time remains is less misleading than one that
		* looks stuck forever.
		*
		* When the remaining time already exceeds the assumed window the result is
		* clamped, and the caller falls back to the countdown text, which is exact.
		*/
		const COOLDOWN_ASSUMED_WINDOW_MS = 6e4;
		function cooldownPercent(cool, now) {
			if (cool.until === void 0 || !Number.isFinite(cool.until)) return 0;
			const remaining = cool.until - (now ?? Date.now());
			if (!Number.isFinite(remaining) || remaining <= 0) return 100;
			const elapsed = COOLDOWN_ASSUMED_WINDOW_MS - remaining;
			const ratio = elapsed / COOLDOWN_ASSUMED_WINDOW_MS;
			return Math.max(2, Math.min(100, Math.round(ratio * 100)));
		}
		/** True when a one-off package lapses inside the "expiring soon" window. */
		function isExpiringSoon(pack) {
			if (pack.monthly === true) return false;
			const days = daysUntil(pack.expiresAtMs);
			return days !== void 0 && days <= 3;
		}
		/**
		* Total credits about to lapse, across every account in the pool.
		*
		* Reports two figures that must not be conflated:
		*
		*   - `soon` — credits in one-off packages whose `expiresAtMs` falls inside the
		*     window. These are actually lost when the clock runs out.
		*   - `cycling` — credits in monthly packages, which carry no `expiresAtMs` at
		*     all. Upstream refills them on `cycleRefreshMs`; the balance is not
		*     forfeited, it is reset. `isExpiringSoon` is hard-false for these.
		*
		* The distinction decides whether the banner may say "all clear". A pool whose
		* remaining credits sit almost entirely in monthly packages would show
		* `soon === 0` while very little of it is genuinely at risk of lapsing — and
		* conversely, a pool of one-off packages with `soon === 0` really is fine. Only
		* the second case justifies silence, so both totals are computed and the copy
		* states which situation it is in.
		*
		* `nearest` is the soonest lapse across the pool, in ms, or undefined when no
		* one-off package has a deadline. Accounts with a `creditsError` are skipped:
		* their packages were never observed, and counting them as zero would read as
		* "nothing expiring" when the truth is "unknown".
		*/
		function creditExpiryRollup(accounts, windowDays) {
			let soon = 0;
			let soonAccounts = 0;
			let cycling = 0;
			let nearest;
			let unreadable = 0;
			for (const account of accounts ?? []) {
				if (account.creditsError !== void 0) {
					unreadable += 1;
					continue;
				}
				let hitThisAccount = false;
				for (const pack of account.credits?.packages ?? []) {
					const remain = typeof pack.remain === "number" && Number.isFinite(pack.remain) ? pack.remain : 0;
					if (remain <= 0) continue;
					if (pack.monthly === true) {
						cycling += remain;
						continue;
					}
					const days = daysUntil(pack.expiresAtMs);
					if (days === void 0 || days > windowDays) continue;
					soon += remain;
					hitThisAccount = true;
					if (pack.expiresAtMs !== void 0 && (nearest === void 0 || pack.expiresAtMs < nearest)) nearest = pack.expiresAtMs;
				}
				if (hitThisAccount) soonAccounts += 1;
			}
			return { soon, soonAccounts, cycling, nearest, unreadable };
		}
		/**
		* Per-account health verdict, derived only from facts the pool already reports.
		*
		* Deliberately NOT a score. A single number would invite the reading "7/10, so
		* it is mostly fine" when the underlying problems are not commensurable: an
		* expired token makes an account permanently dead until re-authorised, while a
		* 60-second cooldown costs nothing at all. Health is therefore reported as a
		* list of findings, each naming its own severity, and the account is judged by
		* its worst finding rather than by an average.
		*
		* Findings are returned in descending severity; callers render the first, and
		* the full list is available for the tooltip.
		*/
		const HEALTH_SEVERITY = {
			dead: 3,
			attention: 2,
			note: 1
		};
		function accountHealth(account, now) {
			const findings = [];
			const push = (level, key, extra) => findings.push({ level, key, ...(extra === void 0 ? {} : { extra }) });
			/**
			* A dead credential outranks everything: the account cannot serve a single
			* request, and only the user re-authorising it can change that. Checked
			* before credits so an expired account with a healthy balance is still
			* reported as expired rather than as fine.
			*/
			if (account.disabled === true) push("attention", "row.healthDisabled");
			else if (account.oauthExpired === true) push("dead", "row.healthTokenExpired");
			else if (account.creditsError !== void 0) push("dead", "row.healthCreditsUnreadable");
			else if (account.checkinError !== void 0) push("note", "row.healthCheckinUnreadable");
			/**
			* Cooldowns are split by cause because the causes mean opposite things:
			* a rate limit is this account's own problem (upstream told us to back off),
			* while a gateway fault is upstream's problem and would hit any account.
			* Lumping them together would blame the account for the gateway's fault.
			*/
			const cooling = account.cooldownUntilMs !== void 0 && account.cooldownUntilMs > now;
			if (cooling) {
				if ((account.serverErrorHits ?? 0) > 0 && (account.rateLimitHits ?? 0) === 0) push("note", "row.healthGatewayCooling");
				else push("note", "row.healthRateLimited");
			}
			const total = account.credits?.total;
			/**
			* An exhausted balance is only a finding when the account is also in
			* rotation. A deliberately disabled account with 0 credits is in the state
			* the user put it in, and flagging that would be nagging.
			*/
			if (account.disabled !== true && typeof total === "number" && Number.isFinite(total) && total <= 0) push("attention", "row.healthNoCredits");
			findings.sort((a, b) => (HEALTH_SEVERITY[b.level] ?? 0) - (HEALTH_SEVERITY[a.level] ?? 0));
			return findings;
		}
		/**
		* Pool-wide health rollup: how many accounts fall into each level, plus the
		* single worst finding so the summary line can name the actual problem.
		*
		* Counts are computed here rather than taken from the host's `summary` because
		* health is a client-side judgement over fields the host already sends; the
		* host has no opinion about it and adding one would mean two places to change
		* whenever the rules move.
		*/
		function poolHealthRollup(accounts, now) {
			let dead = 0;
			let attention = 0;
			let note = 0;
			let worst;
			for (const account of accounts ?? []) {
				const findings = accountHealth(account, now);
				if (findings.length === 0) continue;
				const level = findings[0].level;
				if (level === "dead") dead += 1;
				else if (level === "attention") attention += 1;
				else note += 1;
				if (worst === void 0 || (HEALTH_SEVERITY[level] ?? 0) > (HEALTH_SEVERITY[worst.level] ?? 0)) worst = { level, key: findings[0].key, account };
			}
			return { dead, attention, note, worst, total: (accounts ?? []).length };
		}
		function healthLevelClass(level) {
			return level === "dead" ? "dsm-workbuddy-xdpool-health-dead" : level === "attention" ? "dsm-workbuddy-xdpool-health-attention" : "dsm-workbuddy-xdpool-health-note";
		}
		function tagFor(model) {
			const tags = model.tags ?? [];
			if (tags.includes("free")) return "free";
			if (tags.includes("limited-free")) return "limited";
			if (tags.includes("night-discount")) return "night";
		}
		/** Render pool health, per-account credits/cooldown, and the model directory. */
		/** [诊断] 把卡片渲染期的异常显示出来，而不是被边界静默吞掉。 */
		class PoolCardErrorBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { err: void 0 };
			}
			static getDerivedStateFromError(err) {
				return { err };
			}
			componentDidCatch(err) {
				console.error("[dsh-rotakit] card render error:", err);
			}
			render() {
				const err = this.state.err;
				if (err !== void 0) return (0, react.createElement)("pre", {
					style: {
						whiteSpace: "pre-wrap",
						fontSize: "11px",
						color: "#c00",
						background: "#fff5f5",
						padding: "8px",
						borderRadius: "6px",
						maxHeight: "320px",
						overflow: "auto"
					}
				}, String(err && (err.stack || err.message) || err));
				return this.props.children;
			}
		}
		function PoolCard({ t, settingsScope }) {
			const settingsWritable = settingsScope?.getSnapshot().writable === true;
			/** Which region tab is showing. A CN-only install never leaves this. */
			const [activeRegion, setActiveRegion] = (0, react.useState)("cn");
			const [open, setOpen] = (0, react.useState)(true);
			/**
			* Whether each of the card's three lists is expanded.
			*
			* Separate from `open` above, which folds the whole card away: these only
			* tuck the long lists under their headings, so the headline figures and the
			* automation panel stay visible without scrolling past two hundred rows.
			*
			* All three default to COLLAPSED. The accounts are why this card exists, but
			* the reader's first question is almost always the headline figures, and a
			* collapsed heading still states the essential fact - "21 accounts, 0
			* cooling" - in its summary line. Opening a list is one click; scrolling
			* past a wall of rows to reach the rest of the panel is not.
			*
			* Not persisted: a collapsed list restored from storage would look like the
			* pool had lost its accounts.
			*/
			const [accountsOpen, setAccountsOpen] = (0, react.useState)(false);
			const [modelsOpen, setModelsOpen] = (0, react.useState)(false);
			const [requestsOpen, setRequestsOpen] = (0, react.useState)(false);
			/**
			* Last-known status per region. Kept per region (not a single slot) so
			* switching tabs shows the other side's last answer immediately instead of
			* a blank frame, and the tab dots stay meaningful while a tab is hidden.
			*/
			const [statusByRegion, setStatusByRegion] = (0, react.useState)({});
			/**
			* The merged view over both regions, recomputed on every render.
			*
			* Derived rather than stored: the two region documents are the only state,
			* so the merge cannot go stale against them. `statusByRegion` is keyed by
			* the real regions only — the "all" tab never writes to it, which keeps the
			* per-region polling slots intact and stops a merged document being fed
			* back in as if it were one region's answer.
			*/
			const status = statusByRegion[activeRegion];
			/**
			* Today's automation take, summed across accounts.
			*
			* Summed from the per-account counters rather than kept separately, so the
			* panel total and the per-account lines can never disagree.
			*/
			const automationTotals = Object.values(status?.automation?.earningsToday ?? {}).reduce((sum, entry) => ({
				credit: sum.credit + entry.credit,
				energy: sum.energy + entry.energy,
				claimed: sum.claimed + entry.claimed,
				checkinCredit: sum.checkinCredit + entry.checkinCredit,
				bonusCredit: sum.bonusCredit + entry.bonusCredit,
				travelCredit: sum.travelCredit + entry.travelCredit
			}), {
				credit: 0,
				energy: 0,
				claimed: 0,
				checkinCredit: 0,
				bonusCredit: 0,
				travelCredit: 0
			});
			const [error, setError] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const [cooldownBusy, setCooldownBusy] = (0, react.useState)(false);
			const [automationBusy, setAutomationBusy] = (0, react.useState)(false);
			/** The automation job currently running from the card, if any. */
			const [automationRun, setAutomationRun] = (0, react.useState)(void 0);
			/** Account id whose reserved-credit floor is being saved, if any. */
			const [reserveBusy, setReserveBusy] = (0, react.useState)(void 0);
			const [flash, setFlash] = (0, react.useState)(void 0);
			/** Account id whose daily claim is currently in flight. */
			const [checkinBusyId, setCheckinBusyId] = (0, react.useState)(void 0);
			/** Account id whose enable/disable switch is in flight, if any. */
			const [accountBusyId, setAccountBusyId] = (0, react.useState)(void 0);
			/**
			* Draft model selection. `undefined` means "no local edits"; once a checkbox
			* is touched the draft takes over and is what the Save button posts. Discard
			* drops it back to the copy the server last reported.
			*/
			const [draftByRegion, setDraftByRegion] = (0, react.useState)({});
			/**
			* The draft for the tab on screen. Keyed by region: the two gateways have
			* different rosters, so edits made on one tab must not leak into the other
			* when the user switches tabs (or saves).
			*/
			const draft = draftByRegion[activeRegion];
			const setDraft = (next) => {
				setDraftByRegion((prev) => ({
					...prev,
					[activeRegion]: next
				}));
			};
			const [savingModels, setSavingModels] = (0, react.useState)(false);
			/**
			* Theme choice: "system" | "light" | "dark".
			*
			* Applied in the module body as well as read into this state, because an
			* effect runs AFTER the first render: doing it only here would flash the
			* host's theme for a frame and then correct itself, which is the one
			* artefact a theme switch must not have. The state exists so the BUTTON can
			* say which of the three it is on — the `data-theme` attribute alone cannot
			* express that, since following the system removes it.
			*/
			const [themeChoice, setThemeChoice] = (0, react.useState)(readThemeChoice);
			const cycleTheme = () => {
				const next = nextThemeChoice(themeChoice);
				setThemeChoice(next);
				writeThemeChoice(next);
				applyTheme(next);
			};
			/**
			* Re-paint when the OS switches colour scheme, but ONLY while following it:
			* a user who has explicitly chosen light or dark has overruled the OS, and
			* re-applying on every system change would quietly undo that.
			*
			* The listener is attached to the MediaQueryList rather than to a polled
			* value because the card has no other reason to re-render on a system theme
			* change, and a listener left attached is what leaks when the card is
			* unmounted and mounted again by the settings pane.
			*/
			(0, react.useEffect)(() => {
				const media = themeMedia();
				if (media === null) return;
				const onChange = () => {
					if (themeChoice === "system") applyTheme("system");
				};
				media.addEventListener?.("change", onChange);
				return () => media.removeEventListener?.("change", onChange);
			}, [themeChoice]);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			/**
			* Fetch one region's status. `region` is a parameter rather than a closure
			* read so the callback identity does not change with the tab: the polling
			* effect can key off it without restarting on every switch, and each region's
			* last answer stays in its own slot (see `statusByRegion`).
			*/
			const refresh = (0, react.useCallback)(async (region, signal) => {
				try {
					const response = await fetch(`${POOL_STATUS_PATH}?region=${region}`, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (mounted.current && signal?.aborted !== true) {
						setStatusByRegion((prev) => ({
							...prev,
							[region]: value
						}));
						setError(void 0);
					}
					return value;
				} catch (cause) {
					if (mounted.current && signal?.aborted !== true) setError(cause instanceof Error ? cause.message : String(cause));
					return;
				}
			}, []);
			/**
			* Load the status for the region on screen.
			*
			* The card starts collapsed, so the FIRST answer cannot be gated on `open`:
			* waiting for expansion left the user staring at an empty panel for a few
			* seconds on every visit. This runs on mount instead, so expanding shows the
			* data that is already there.
			*
			* `bootstrappedRef` keeps that to one initial fetch per region: the periodic
			* effect below also runs its callback the first time `open` flips true, and
			* without the guard mounting AND expanding would fire two fetches for the
			* same region. The ref is per-region so switching tabs still loads that
			* region's document.
			*/
			const bootstrappedRef = (0, react.useRef)({});
			(0, react.useEffect)(() => {
				if (bootstrappedRef.current[activeRegion] === true) return;
				bootstrappedRef.current[activeRegion] = true;
				refresh(activeRegion);
			}, [
				refresh,
				activeRegion
			]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const controller = new AbortController();
				if (bootstrappedRef.current[activeRegion] !== true) {
					bootstrappedRef.current[activeRegion] = true;
					refresh(activeRegion, controller.signal);
				}
				const timer = window.setInterval(() => {
					refresh(activeRegion, controller.signal);
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [
				open,
				refresh,
				activeRegion
			]);

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
			/**
			* [xdpool-oauth] 用户要求「自动打开、不要手动点击」。
			*
			* 用 state 值做去重键：同一个 state 只自动打开一次，重渲染 / 轮询
			* 心跳 / 切语言都不会再开一遍；点「重新获取」会拿到新的 state，于是
			* 又会自动打开一次 —— 这正是期望的行为。
			*
			* 关于返回值：`window.open` 在 DSH 桌面端**正常成功时也返回 null**。
			* 宿主主窗口注册了 setWindowOpenHandler，对 http/https 先
			* `shell.openExternal(url)` 真正拉起系统浏览器，然后返回
			* `{ action: "deny" }` 取消渲染进程建窗 —— Electron 的语义就是
			* 「副作用已发生，但 window.open 拿到 null」。因此 **null 不能当作
			* 「被拦截」**，据此报警会在成功路径上误报（这里已经犯过一次）。
			*
			* 所以这里只做「尽力打开」，不根据返回值下任何结论；真正的兜底是下方
			* 那个始终可见的链接。也**不做 location 跳转**：本卡片跑在宿主窗口
			* 里，把整页导航走会把设置页一起带走，比让用户点一下更糟。
			* 只有裸浏览器（非 DSH 桌面端）才会真的因弹窗拦截而不打开。
			*/
			const autoOpenedState = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				const url = scan?.authUrl;
				const key = scan?.state;
				if (typeof url !== "string" || url === "" || typeof key !== "string" || key === "") return;
				if (autoOpenedState.current === key) return;
				autoOpenedState.current = key;
				try {
					window.open(url, "_blank", "noopener,noreferrer");
				} catch (error) {
					console.warn("[xdpool-oauth] 自动打开登录链接抛错：", error);
				}
			}, [scan?.authUrl, scan?.state]);
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
						authUrl: body.authUrl,
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

			const rescan = async () => {
				setBusy(true);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_RESCAN_PATH, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					await refresh(activeRegion);
					if (mounted.current) setFlash(t?.("row.accountsRescanned", { count: body.accounts ?? 0 }) ?? "");
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setBusy(false);
				}
			};
			const resetCooldowns = async () => {
				setCooldownBusy(true);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_RESET_COOLDOWN_PATH, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					await refresh(activeRegion);
					if (mounted.current) setFlash(t?.("row.resetCooldownsDone") ?? "");
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setCooldownBusy(false);
				}
			};
			/**
			* Claim one account's daily check-in. The account id travels in the body so
			* the Host can never guess: a click on account B's button can only ever
			* collect account B's reward. The status is re-read afterwards so the card
			* reflects the new streak / total without waiting for the next poll.
			*/
			const claimCheckin = async (accountId) => {
				setCheckinBusyId(accountId);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_CHECKIN_PATH, {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ accountId })
					});
					const body = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
					await refresh(activeRegion);
					const credit = body?.claim?.credit ?? 0;
					if (mounted.current) setFlash(t?.("row.checkinClaimedReward", { credit: formatNumber(credit) }) ?? `Claimed +${formatNumber(credit)} credits`);
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setCheckinBusyId(void 0);
				}
			};
			/**
			* Switch one account in or out of the pool.
			*
			* The id travels in the body and the host validates it against the accounts it
			* really knows, so a stale tab cannot write an orphan id. Disabling only stops
			* the account from being picked — it stays listed so it can be turned back on —
			* and the change is saved through the settings section, so it survives a
			* restart and is re-applied after every re-scan.
			*/
			const toggleAccountDisabled = async (accountId, disabled) => {
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				setAccountBusyId(accountId);
				setFlash(void 0);
				try {
					const current = (status?.accounts ?? []).filter((account) => account.disabled === true).map((account) => account.id);
					const next = disabled ? current.includes(accountId) ? current : [...current, accountId] : current.filter((id) => id !== accountId);
					await write.call(settingsScope, "disabledAccountIds", next);
					await refresh(activeRegion);
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					if (mounted.current) setError(t?.("row.accountToggleError", { message }) ?? "Could not switch the account: " + message);
				} finally {
					if (mounted.current) setAccountBusyId(void 0);
				}
			};
			/** Keep the draft in step with the server copy while nothing is dirty. */
			const modelDraft = draft ?? (status === void 0 ? {} : draftFromStatus(status));
			/** Model edits need a writable settings scope; otherwise the rows are read-only. */
			const modelsEditable = settingsWritable;
			const modelsDirty = draft !== void 0 && status !== void 0 && draftIsDirty(status, draft);
			const enabledCount = Object.values(modelDraft).filter((entry) => entry.enabled).length;
			const toggleModel = (id) => {
				if (status === void 0) return;
				const base = draft ?? draftFromStatus(status);
				const entry = base[id];
				if (entry === void 0) return;
				setDraft({
					...base,
					[id]: {
						...entry,
						enabled: !entry.enabled
					}
				});
			};
			const toggleModelImage = (id) => {
				if (status === void 0) return;
				const base = draft ?? draftFromStatus(status);
				const entry = base[id];
				if (entry === void 0) return;
				setDraft({
					...base,
					[id]: {
						...entry,
						images: !entry.images
					}
				});
			};
			const setModelBudget = (id, budget) => {
				if (status === void 0) return;
				const base = draft ?? draftFromStatus(status);
				const entry = base[id];
				if (entry === void 0) return;
				setDraft({
					...base,
					[id]: {
						...entry,
						budget
					}
				});
			};
			const discardModels = () => {
				setDraft(void 0);
				setFlash(void 0);
			};
			/**
			* Persist the draft. The route validates the payload again on the host side,
			* so a malformed draft is rejected there rather than silently stored. The
			* card refuses to save an empty enable-list: that would leave the picker
			* with nothing to offer and no obvious way back.
			*/
			/**
			* Persist the draft into the plugin settings section.
			*
			* The write goes through `settingsScope` rather than a bespoke route: that is
			* the same document the model picker reads, so one save covers every account
			* and survives account rotation — the selection is a property of the pool,
			* not of whichever account happens to be serving right now.
			*
			* The card refuses an empty enable-list: saving one would leave the picker
			* with nothing to offer and no obvious way back.
			*/
			/**
			* Switch how the pool spreads requests. Written straight through the
			* settings scope (that is where the host keeps the pool options), so the
			* change lands without a restart and survives the next card refresh.
			*/
			const setDistribution = async (next) => {
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				setFlash(void 0);
				try {
					await write.call(settingsScope, "distribution", next);
					await refresh(activeRegion);
				} catch (cause) {
					if (mounted.current) setError(String(cause));
				}
			};
			/**
			* Switch the daily-points automation on or off.
			*
			* The whole `automation` object is written as one key, because that is how the
			* settings document stores it: the schedule fields must be carried along, or a
			* save would drop the hour lists the scheduler is running on.
			*/
			const setAutomationEnabled = async (enabled) => {
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				const existing = status?.automation;
				setAutomationBusy(true);
				setFlash(void 0);
				try {
					await write.call(settingsScope, "automation", {
						...existing === void 0 ? {} : {
							checkinHours: [...existing.checkinHours],
							reportHours: [...existing.reportHours],
							taskHours: [...existing.taskHours],
							streakHours: [...existing.streakHours]
						},
						enabled
					});
					await refresh(activeRegion);
				} catch (cause) {
					if (mounted.current) setError(String(cause));
				} finally {
					if (mounted.current) setAutomationBusy(false);
				}
			};
			/**
			* Run the whole automation pass now.
			*
			* The route only STARTS the pass: a full run takes tens of seconds, which is
			* far too long to hold a request open. The card therefore reports that the
			* run has STARTED and returns immediately — the pass keeps going in the Host
			* whether or not this panel stays open, and the panel's 30s refresh picks up
			* the earnings as they land.
			*/
			const runAutomationJob = async () => {
				setAutomationRun("all");
				setFlash(void 0);
				try {
					const response = await fetch(POOL_AUTOMATION_RUN_PATH, {
						method: "POST",
						headers: {
							"accept": "application/json",
							"content-type": "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ job: "all" })
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					if (body.started === false) {
						if (mounted.current) setFlash(t?.("row.autoAlreadyRunning") ?? "A run is already in progress");
						return;
					}
					/**
					* Deliberately fire-and-forget.
					*
					* The Host route only STARTS the pass and returns at once, so the run
					* keeps going whether or not this card is on screen. Holding the button
					* in "Running…" for up to 90 × 2s told the user to wait for something
					* that was already independent of them. We now say plainly that it
					* STARTED and is still going, and let the panel's own 30s refresh
					* surface the earnings as they land.
					*
					* Note this is deliberately NOT a "finished" message: the pass has only
					* just been handed to the scheduler, so claiming completion here would
					* be a lie the user could catch by watching the earnings arrive later.
					*/
					if (mounted.current) setFlash(t?.("row.autoRunStarted") ?? "Automation pass started — it keeps running if you close this panel");
					await refresh(activeRegion);
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setAutomationRun(void 0);
				}
			};
			/**
			* Save one account reserved-credit floor.
			*
			* A reserve only protects credits if the pool knows the balance, so this
			* also refreshes the account list afterwards: the reserve badge appears
			* as soon as the reading crosses the floor.
			*/
			/**
			* Save one account reserved-credit floor.
			*
			* A reserve only protects credits if the pool knows the balance, so this also
			* refreshes the account list afterwards: the reserve badge appears as soon as
			* the reading crosses the floor.
			*
			* Returns whether the host CONFIRMED the write. The card keys its inline
			* "saved / not saved" note off this, so a failure is shown where the user is
			* looking instead of only in the card-level notice line.
			*/
			const saveCreditReserve = async (accountId, reserve) => {
				setReserveBusy(accountId);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_CREDIT_RESERVE_PATH, {
						method: "POST",
						headers: {
							"accept": "application/json",
							"content-type": "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({
							accountId,
							reserve
						})
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					await refresh(activeRegion);
					if (mounted.current) setFlash(reserve > 0 ? t?.("row.reserveSaved", { credits: reserve }) ?? `Keeping ${reserve} credits` : t?.("row.reserveCleared") ?? "Reserve cleared");
					return true;
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
					return false;
				} finally {
					if (mounted.current) setReserveBusy(void 0);
				}
			};
			const saveModels = async () => {
				if (draft === void 0 || status === void 0) return;
				if (enabledCount === 0) {
					setError(t?.("row.modelsEmpty") ?? "No model enabled");
					return;
				}
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				setSavingModels(true);
				setFlash(void 0);
				try {
					const enabledModelIds = Object.entries(draft).filter(([, e]) => e.enabled).map(([id]) => id);
					const imageModelIds = Object.entries(draft).filter(([, e]) => e.images).map(([id]) => id);
					const contextBudgets = {};
					for (const [id, entry] of Object.entries(draft)) if (entry.budget !== void 0) contextBudgets[id] = entry.budget;
					const key = activeRegion === "cn" ? "modelSelectionCn" : "modelSelectionGlobal";
					await write.call(settingsScope, key, {
						enabledModelIds,
						imageModelIds,
						contextBudgets
					});
					setDraft(void 0);
					if (mounted.current) setFlash(t?.("row.modelsSaved") ?? "Saved");
				} catch (cause) {
					if (mounted.current) setError(t?.("row.modelsSaveError", { message: cause instanceof Error ? cause.message : String(cause) }) ?? String(cause));
				} finally {
					if (mounted.current) setSavingModels(false);
				}
			};
			const title = t?.("row.title") ?? "RotaKit";
			const description = t?.("row.desc") ?? "";
			const accountCount = status?.accounts?.length ?? 0;
			const cooling = status?.cooling ?? 0;
			/**
			* Pool-wide totals, taken from the host's `summary` / `serverErrors`.
			*
			* These used to be reduced here from the per-account rows. They are not
			* any more: the card renders a filtered and grouped view of those rows, so
			* a locally derived total could silently disagree with the very rows
			* printed underneath it — and a headline figure that contradicts its own
			* table is worse than no headline. The host sums the same array it
			* serialises, which makes that class of disagreement impossible instead of
			* merely unlikely.
			*
			* Both reads fall back to 0 when the host is older than this build, so a
			* stale host degrades to "no faults recorded" rather than to NaN.
			*/
			const serverErrorTotal = status?.serverErrors?.total ?? 0;
			const serverErrorToday = status?.serverErrors?.today ?? 0;
			/**
			* Health verdict for the pool, computed locally from the account rows.
			*
			* `healthSummaryText` is null when every account is clean, which keeps the
			* banner out of the way entirely rather than announcing "all healthy" — a
			* line that is always present stops being read. The summary line names the
			* worst finding, not a score: see `accountHealth` for why the findings are
			* not averaged into a number.
			*/
			const health = poolHealthRollup(status?.accounts, Date.now());
			const healthSummaryText = health.worst === void 0 ? null : t?.(health.worst.key, {
				label: health.worst.account?.label ?? "",
				dead: health.dead,
				attention: health.attention,
				note: health.note
			}) ?? null;
			const state = error !== void 0 ? "error" : status === void 0 && error === void 0 ? "idle" : accountCount > 0 && cooling < accountCount ? "ok" : "idle";
			/** Human label for the active tab, used inside the empty-state copy. */
			const regionLabel = activeRegion === "cn" ? t?.("row.tabCn") ?? "CN" : t?.("row.tabGlobal") ?? "Global";
			const stateLabel = error !== void 0 ? t?.("row.requestFailed") ?? "Request failed" : accountCount === 0 ? t?.("row.regionEmpty") ?? t?.("row.poolEmpty") ?? "No account yet" : state === "ok" ? t?.("row.ok") ?? "Healthy" : t?.("row.allCooling") ?? "All cooling";
			const shimRunning = status?.shim.running === true;
			const shimHint = status === void 0 ? null : shimRunning ? `${t?.("row.shimRunning") ?? "Provider listening"}${status.shim.baseUrl === void 0 ? "" : ` · ${status.shim.baseUrl}`}` : t?.("row.shimStopped") ?? "Provider loopback not running";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: `dsm-plugin-card${open ? " dsm-plugin-card-open" : ""}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsm-plugin-card-header",
					"aria-expanded": open,
					"aria-label": `${t?.(open ? "row.collapse" : "row.expand") ?? ""}: ${title}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: "dsm-plugin-card-icon",
							src: POOL_PLUGIN_ICON,
							alt: ""
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-plugin-card-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-plugin-card-title",
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-plugin-card-description",
								children: description
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							className: `dsm-plugin-card-chevron${open ? " dsm-plugin-card-chevron-open" : ""}`,
							children: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 })
						})
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-plugin-card-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-xdpool-usage",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-workbuddy-xdpool-tabs",
								role: "tablist",
								children: (status?.regions ?? ["cn", "global"]).map((region) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "tab",
									"aria-selected": region === activeRegion,
									className: `dsm-workbuddy-xdpool-tab${region === activeRegion ? " dsm-workbuddy-xdpool-tab-active" : ""}`,
									onClick: () => {
										setActiveRegion(region);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-tab-dot",
										"data-state": state
									}), region === "cn" ? t?.("row.tabCn") ?? "CN" : t?.("row.tabGlobal") ?? "Global"]
								}, region))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageBar, {
								usage: status?.usage,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageTrend, {
								trend: status?.trend,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditExpiryNotice, {
								accounts: status?.accounts,
								summary: status?.summary,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-workbuddy-xdpool-usage-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-xdpool-usage-copy",
									role: "status",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-workbuddy-xdpool-usage-status",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												className: "dsm-workbuddy-xdpool-usage-dot",
												style: { background: dotColor(state) }
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: stateLabel })]
										}),
										accountCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-xdpool-usage-hint",
											children: t?.("row.accountsSummary", {
												count: accountCount,
												cooling
											}) ?? `${accountCount} account(s) · ${cooling} cooling`
										}) : null,
										shimHint === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-xdpool-usage-hint",
											children: shimHint
										}),
										status === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-workbuddy-xdpool-dist",
											role: "radiogroup",
											"aria-label": t?.("row.distTitle") ?? "Account usage",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-workbuddy-xdpool-dist-title",
												children: t?.("row.distTitle") ?? "Account usage"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsm-workbuddy-xdpool-dist-options",
												children: [
													"priority",
													"balanced",
													"round-robin"
												].map((option) => {
													const active = (status.distribution ?? "priority") === option;
													const label = option === "priority" ? t?.("row.distPriority") ?? "Priority" : option === "balanced" ? t?.("row.distBalanced") ?? "Balanced" : t?.("row.distRoundRobin") ?? "Round-robin";
													const hint = option === "priority" ? t?.("row.distPriorityHint") ?? "" : option === "balanced" ? t?.("row.distBalancedHint") ?? "" : t?.("row.distRoundRobinHint") ?? "";
													return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														role: "radio",
														"aria-checked": active,
														title: hint,
														disabled: !modelsEditable,
														className: "dsm-workbuddy-xdpool-dist-option" + (active ? " dsm-workbuddy-xdpool-dist-option-active" : ""),
														onClick: () => {
															setDistribution(option);
														},
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-workbuddy-xdpool-dist-option-name",
															children: label
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-workbuddy-xdpool-dist-option-hint",
															children: hint
														})]
													}, option);
												})
											})]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-xdpool-usage-actions",
									children: [
/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
	type: "button",
	className: "dsm-btn dsm-btn-outline dsm-workbuddy-xdpool-theme",
	title: t?.("row.themeCycleHint") ?? "",
	onClick: () => {
		cycleTheme();
	},
	children: [
		/* A word, not a glyph: the three states have to be told apart at a glance,
		   and the host's icon set has no reliable light/dark pair. The current
		   state is named first and the next one follows, so one press never has to
		   be a guess. */
		t?.("row.themeTitle") ?? "Theme",
		" · ",
		themeChoice === "system" ? t?.("row.themeSystem") ?? "System" : themeChoice === "light" ? t?.("row.themeLight") ?? "Light" : t?.("row.themeDark") ?? "Dark"
	]
}),
/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
	type: "button",
	className: "dsm-btn dsm-btn-outline",
	disabled: scanBusy,
	onClick: () => {
		if (scan === void 0) startScan();
		else closeScan();
	},
	children: scanBusy ? t?.("row.oauthStarting") ?? "Opening…" : scan === void 0 ? t?.("row.oauthAdd") ?? "Add account" : t?.("row.oauthHide") ?? "Hide"
}), 

/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										disabled: busy,
										onClick: () => {
											rescan();
										},
										children: busy ? t?.("row.accountsScanning") ?? "Detecting…" : t?.("row.accountsRescan") ?? "Detect accounts again"
									}), cooling > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										disabled: cooldownBusy,
										onClick: () => {
											resetCooldowns();
										},
										children: cooldownBusy ? t?.("row.resetCooldownsBusy") ?? "Clearing…" : t?.("row.resetCooldowns") ?? "Clear all cooldowns"
									}) : null]
								})]
							}),

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
								children: [scan.authUrl === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										width: "200px",
										height: "200px",
										padding: "8px",
										boxSizing: "content-box",
										background: "#ffffff",
										borderRadius: "8px"
									},
									dangerouslySetInnerHTML: { __html: scan.qr }
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
									/**
									* 登录链接改为可点跳转（用户要求）：比对着屏幕扫码省事，
									* 尤其在电脑上登录时。用 <a> 而不是 window.open，是为了让
									* 浏览器/宿主按自己的策略处理外链，也不会被弹窗拦截。
									* 链接必须新窗口打开：在本卡片里跳走会把整个设置页带走。
									*/
									href: scan.authUrl,
									target: "_blank",
									rel: "noreferrer noopener",
									style: {
										display: "flex",
										alignItems: "center",
										gap: "8px",
										width: "100%",
										boxSizing: "border-box",
										padding: "12px 14px",
										border: "1px solid rgba(127,127,127,0.35)",
										borderRadius: "8px",
										textDecoration: "none",
										wordBreak: "break-all",
										fontSize: "13px",
										lineHeight: "20px",
										color: "var(--dsw-alias-state-success-primary, #22a06b)"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											flex: "none",
											opacity: 0.8
										},
										children: "↗"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										children: scan.authUrl
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: "12px",
										opacity: 0.75,
										textAlign: "center"
									},
									children: scan.status === "done" ? t?.("row.oauthDone", { label: scan.label ?? "" }) ?? "Added" : scan.status === "expired" ? t?.("row.oauthExpired") ?? "Expired — request a new link" : t?.("row.oauthHint") ?? "Open the link and sign in"
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
							activeRegion !== "cn" || automationOf(status) === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: "dsm-workbuddy-xdpool-auto",
								"aria-label": t?.("row.autoTitle") ?? "Automation",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-auto-head",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-workbuddy-xdpool-auto-title",
												children: t?.("row.autoTitle") ?? "Automation"
											}),
											!status.automation.enabled ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-btn dsm-btn-outline dsm-workbuddy-xdpool-auto-run",
												disabled: automationRun !== void 0,
												onClick: () => {
													runAutomationJob();
												},
												children: automationRun !== void 0 ? t?.("row.autoRunning") ?? "Running…" : t?.("row.autoRunAll") ?? "Run all now"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												role: "switch",
												"aria-checked": status.automation.enabled,
												disabled: !settingsWritable || automationBusy,
												className: `dsm-workbuddy-xdpool-auto-switch${status.automation.enabled ? " dsm-workbuddy-xdpool-auto-switch-on" : ""}`,
												onClick: () => {
													setAutomationEnabled(!status.automation.enabled);
												},
												children: automationBusy ? t?.("row.autoBusy") ?? "Saving…" : status.automation.enabled ? t?.("row.autoOn") ?? "On" : t?.("row.autoOff") ?? "Off"
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-workbuddy-xdpool-auto-hint",
										children: status.automation.enabled ? t?.("row.autoHintOn") ?? "Reports activity, claims task rewards and checks in once a day." : t?.("row.autoHintOff") ?? "Off: no background requests are made for you."
									}),
									automationTotals.credit === 0 && automationTotals.checkinCredit === 0 && automationTotals.bonusCredit === 0 && automationTotals.travelCredit === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-auto-total",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-xdpool-auto-total-label",
											children: t?.("row.autoToday") ?? "Today"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsm-workbuddy-xdpool-auto-total-list",
											children: [
												automationTotals.credit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-workbuddy-xdpool-auto-total-row",
													children: t?.("row.autoFromTasks", {
														credit: automationTotals.credit,
														energy: automationTotals.energy,
														count: automationTotals.claimed
													}) ?? `Tasks +${automationTotals.credit}`
												}) : null,
												automationTotals.checkinCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-workbuddy-xdpool-auto-total-row",
													children: t?.("row.autoFromCheckin", { credit: automationTotals.checkinCredit }) ?? `Check-in +${automationTotals.checkinCredit}`
												}) : null,
												automationTotals.bonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-workbuddy-xdpool-auto-total-row",
													children: t?.("row.autoFromBonus", { credit: automationTotals.bonusCredit }) ?? `Streak +${automationTotals.bonusCredit}`
												}) : null,
												automationTotals.travelCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-workbuddy-xdpool-auto-total-row",
													children: t?.("row.autoFromTravel", { credit: automationTotals.travelCredit }) ?? `Buddy +${automationTotals.travelCredit}`
												}) : null
											]
										})]
									}),
									status.automation.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsm-workbuddy-xdpool-auto-jobs",
										children: AUTOMATION_JOBS.map((kind) => {
											const job = automationJob(status, kind);
											const hours = automationHours(status, kind);
											const label = t?.(`row.autoJob_${kind}`) ?? kind;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-workbuddy-xdpool-auto-job",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-auto-job-name",
														children: label
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-auto-job-when",
														children: hours.length === 0 ? t?.("row.autoHourNone") ?? "not scheduled" : hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(" · ")
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-auto-job-last",
														children: job?.lastRunDate === void 0 ? t?.("row.autoNever") ?? "not run yet" : `${job.lastRunDate} · ${job.ok}${job.failed > 0 ? `/${job.failed}` : ""}`
													}),
													job?.progress === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-auto-job-note",
														children: job.progress
													}),
													job?.detail === void 0 || job.detail.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-auto-job-detail",
														children: job.detail.join(" · ")
													})
												]
											}, kind);
										})
									}) : null
								]
							}),
							flash === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-xdpool-note",
								children: flash
							}),
							error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-xdpool-error",
								children: t?.("row.error", { message: error }) ?? `Pool status unavailable: ${error}`
							}),
							accountCount === 0 && error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: "dsm-workbuddy-xdpool-empty",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-workbuddy-xdpool-empty-title",
										children: t?.("row.regionEmptyTitle", { region: regionLabel }) ?? t?.("row.regionEmpty") ?? "No account yet"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-empty-steps",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-xdpool-empty-steps-title",
											children: t?.("row.regionHowToTitle", { region: regionLabel }) ?? `How to sign in to the ${regionLabel} version`
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ol", {
											className: "dsm-workbuddy-xdpool-empty-list",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo1") ?? "" }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo2") ?? "" }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo3") ?? "" }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo4") ?? "" })
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-workbuddy-xdpool-empty-note",
										children: t?.("row.regionHowToNote") ?? ""
									})
								]
							}) : null,
							accountCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: `dsm-workbuddy-xdpool-accounts${accountsOpen ? " dsm-workbuddy-xdpool-accounts-open" : ""}`,
								"aria-label": t?.("row.accountsTitle") ?? "Accounts",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-accounts-head",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsm-workbuddy-xdpool-accounts-toggle",
											"aria-expanded": accountsOpen,
											"aria-label": `${t?.(accountsOpen ? "row.accountsCollapse" : "row.accountsExpand") ?? ""}: ${t?.("row.accountsTitle") ?? "Accounts"}`,
											onClick: () => {
												setAccountsOpen(!accountsOpen);
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													"aria-hidden": "true",
													className: `dsm-workbuddy-xdpool-accounts-chevron${accountsOpen ? " dsm-workbuddy-xdpool-accounts-chevron-open" : ""}`,
													children: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
													className: "dsm-workbuddy-xdpool-accounts-title",
													children: t?.("row.accountsTitle") ?? "Accounts in the pool"
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: "dsm-workbuddy-xdpool-accounts-summary",
											children: [t?.("row.accountsSummary", {
												count: accountCount,
												cooling
											}) ?? `${accountCount} account(s) · ${cooling} cooling`, serverErrorTotal > 0 ? ` · ${t?.("row.serverErrorsTotal", { hits: serverErrorTotal }) ?? `${serverErrorTotal} upstream error(s)`}` : "", healthSummaryText === null ? "" : ` · ${healthSummaryText}`]
										})]
									}),
									healthSummaryText === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: `dsm-workbuddy-xdpool-health ${healthLevelClass(health.worst.level)}`,
										title: t?.("row.healthHint") ?? "",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											className: "dsm-workbuddy-xdpool-health-dot"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-xdpool-health-text",
											children: healthSummaryText
										})]
									}),
									accountsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
										children: [(() => {
											const active = status?.activeAccountId === void 0 ? void 0 : status.accounts.find((account) => account.id === status.activeAccountId);
											if (active === void 0) return null;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-workbuddy-xdpool-current",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-workbuddy-xdpool-current-dot" }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-current-label",
														children: t?.("row.currentAccount") ?? "In use now"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-current-name",
														children: active.label
													}),
													active.disabled === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-current-note",
														children: t?.("row.currentAccountDisabled") ?? "disabled — will switch on the next request"
													}) : null
												]
											});
										})(), status?.accounts?.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountBlock, {
											account,
											...checkinBusyId === void 0 ? {} : { checkinBusyId },
											onClaimCheckin: (accountId) => {
												claimCheckin(accountId);
											},
											onSaveCreditReserve: (accountId, reserve) => saveCreditReserve(accountId, reserve),
											onToggleDisabled: (accountId, disabled) => {
												toggleAccountDisabled(accountId, disabled);
											},
											...accountBusyId === void 0 ? {} : { accountBusyId },
											t
										}, account.id))]
									}) : null
								]
							}) : null,
							/**
							* The request log sits between the accounts and the models. It is the
							* evidence for everything above it — which account served, whether
							* the pool had to rotate, and how long the answer took — so it reads
							* directly under the rows it is about, and it is drawn even when the
							* pool is empty (a fresh install's first failed request is exactly
							* what the log needs to show).
							*/
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestLog, {
								status,
								t,
								open: requestsOpen,
								onToggle: () => {
									setRequestsOpen(!requestsOpen);
								}
							}),
							/**
							* Optional chaining on the array, not just on `status`: an
							* intermediate object being defined does not make the property after
							* it safe, and this is the exact shape of expression that turns a
							* missing field into a blank card.
							*/
							(status?.models?.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: `dsm-workbuddy-xdpool-models${modelsOpen ? " dsm-workbuddy-xdpool-models-open" : ""}`,
								"aria-label": t?.("row.modelsTitle") ?? "Models",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-xdpool-models-head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-models-heading",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dsm-workbuddy-xdpool-models-toggle",
											"aria-expanded": modelsOpen,
											"aria-label": `${t?.(modelsOpen ? "row.modelsCollapse" : "row.modelsExpand") ?? ""}: ${t?.("row.modelsTitle") ?? "Models"}`,
											onClick: () => {
												setModelsOpen(!modelsOpen);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												className: `dsm-workbuddy-xdpool-models-chevron${modelsOpen ? " dsm-workbuddy-xdpool-models-chevron-open" : ""}`,
												children: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												className: "dsm-workbuddy-xdpool-models-title",
												children: t?.("row.modelsTitle") ?? "Models"
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-xdpool-models-summary",
											children: t?.("row.modelsEnabledCount", {
												enabled: enabledCount,
												total: status?.models?.length ?? 0
											}) ?? `${enabledCount} / ${status?.models?.length ?? 0} enabled`
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-models-actions",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-btn dsm-btn-outline",
											disabled: !modelsDirty || savingModels,
											onClick: discardModels,
											children: t?.("row.modelsDiscard") ?? "Discard"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-btn dsm-btn-primary",
											disabled: !modelsDirty || savingModels || enabledCount === 0,
											onClick: () => {
												saveModels();
											},
											children: savingModels ? t?.("row.modelsSaving") ?? "Saving…" : t?.("row.modelsSave") ?? "Save"
										})]
									})]
								}), modelsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-workbuddy-xdpool-model-list",
									children: status?.models?.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
										model,
										t,
										draft: modelDraft[model.id] ?? {
											enabled: model.enabled,
											images: model.supportsImages
										},
										editable: modelsEditable,
										onToggle: toggleModel,
										onToggleImage: toggleModelImage,
										onBudget: setModelBudget
									}, model.id))
								}) : null]
							}) : null
						]
					})
				}) : null]
			});
		}
		/** One account block: label + status tag + meta + optional credit panels. */
		function AccountBlock({ account, t, checkinBusyId, onClaimCheckin, accountBusyId, onToggleDisabled, onSaveCreditReserve, reserveBusyId }) {
			const isDisabled = account.disabled === true;
			const isCooling = account.cooling === true;
			const cooldownUntil = account.cooldownUntil !== void 0 ? Date.parse(account.cooldownUntil) : void 0;
			const modelCooldowns = account.modelCooldowns ?? [];
			/**
			* One `now` for the whole account block.
			*
			* Read once and shared by the cooldown bar, its countdown and the chip
			* countdowns. Calling Date.now() per element would let two elements in the
			* same render disagree by a millisecond, which is invisible here but turns
			* any future comparison between them into a race.
			*
			* This is a render-time value, not a ticking clock: the card re-renders on
			* every poll (and on any interaction), so the countdown advances then. A
			* per-second timer was rejected deliberately — it would re-render the whole
			* card, including every account's credit panels, once a second forever, to
			* animate a bar nobody is watching that closely.
			*/
			const nowMs = Date.now();
			const cool = cooldownInfo(account, nowMs);
			/**
			* A rejected credential outranks a cooldown in this one-pill slot.
			*
			* The pool takes a retired account out of rotation on its own, with no
			* user action, so without a label it simply vanishes from the pool and the
			* user has no way to learn that signing in again is what brings it back.
			* The cooldown tag would say "wait", which is the wrong instruction.
			*/
			const authDeadUntil = account.authDead === true && account.authDeadUntil !== void 0 ? Date.parse(account.authDeadUntil) : void 0;
			const authDead = authDeadUntil !== void 0 && Number.isFinite(authDeadUntil);
			const tag = authDead ? {
				text: t?.("row.accountAuthDead") ?? "Sign in again",
				cls: "dsm-workbuddy-xdpool-account-tag dsm-workbuddy-xdpool-account-tag-error"
			} : isCooling ? {
				text: t?.("row.cooling") ?? "Cooling",
				cls: "dsm-workbuddy-xdpool-account-tag dsm-workbuddy-xdpool-account-tag-cooling"
			} : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: isDisabled ? "dsm-workbuddy-xdpool-account dsm-workbuddy-xdpool-account-off" : "dsm-workbuddy-xdpool-account",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-xdpool-account-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-account-label",
							children: account.label
						}),
						tag === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: tag.cls,
							title: authDead ? t?.("row.accountAuthDeadHint") ?? "" : void 0,
							children: tag.text
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "switch",
							"aria-checked": !isDisabled,
							className: isDisabled ? "dsm-workbuddy-xdpool-account-toggle" : "dsm-workbuddy-xdpool-account-toggle dsm-workbuddy-xdpool-account-toggle-on",
							title: t?.("row.accountToggleHint") ?? "Enable this account (uncheck to keep it out of the pool)",
							disabled: accountBusyId === account.id,
							onClick: () => {
								onToggleDisabled(account.id, !isDisabled);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-workbuddy-xdpool-account-toggle-dot" }), isDisabled ? t?.("row.accountOff") ?? "Disabled" : t?.("row.accountInRotation") ?? "Enabled"]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-xdpool-account-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-xdpool-account-copy",
							children: [
								account.expiresAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-xdpool-account-meta",
									children: t?.("row.tokenExpiry", { time: formatDateTime(account.expiresAt) }) ?? `token ${formatDateTime(account.expiresAt)}`
								}) : null,
								/**
								* Cooldown line: how long this account is out, and why.
								*
								* The absolute "until HH:MM" was the only signal before, which is
								* unhelpful for the windows this pool actually uses — a 60-second
								* rate-limit cooldown reads as a whole minute away even when it has
								* 5 seconds left, so the card looked frozen while the account was
								* about to come back. The relative figure leads and the clock time
								* follows, and the bar underneath shows how far through the wait is.
								*
								* `reason` is split by cause because the two mean opposite things:
								* a 429 is this account's own problem, a 5xx is the gateway's and
								* would hit any account. Telling them apart is the whole point of
								* having kept two counters.
								*/
								cool.active ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-xdpool-cool",
									title: t?.("row.cooldownHint") ?? "",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-workbuddy-xdpool-cool-line",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `dsm-workbuddy-xdpool-cool-reason${cool.accountActive ? "" : " dsm-workbuddy-xdpool-cool-reason-partial"}`,
													children: cool.accountActive ? t?.("row.coolAccountWide") ?? "Whole account paused" : t?.("row.coolModelOnly", { count: cool.models.length }) ?? `${cool.models.length} model(s) paused`
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-workbuddy-xdpool-cool-time",
													children: t?.("row.coolRemaining", {
														remaining: formatRemaining(cool.until, nowMs),
														time: formatDateTime(cool.until)
													}) ?? `back in ${formatRemaining(cool.until, nowMs)} (${formatDateTime(cool.until)})`
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsm-workbuddy-xdpool-cool-bar",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `dsm-workbuddy-xdpool-cool-fill${cool.accountActive ? "" : " dsm-workbuddy-xdpool-cool-fill-partial"}`,
												style: { width: `${String(cooldownPercent(cool, nowMs))}%` }
											})
										}),
										/**
										* Per-model chips, each with its own countdown. An account held for
										* two different models recovers from them independently, so
										* collapsing them into one line would hide which model is usable
										* when.
										*/
										cool.models.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsm-workbuddy-xdpool-cool-models",
											children: cool.models.map((mc) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-workbuddy-xdpool-cool-chip",
												children: t?.("row.coolModelChip", {
													model: mc.modelId,
													remaining: formatRemaining(mc.until, nowMs)
												}) ?? `${mc.modelId} ${formatRemaining(mc.until, nowMs)}`
											}, mc.modelId))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-workbuddy-xdpool-cool-hits",
											children: t?.("row.coolHitsSplit", {
												limits: account.rateLimitHits ?? 0,
												gateway: account.serverErrorHits ?? 0
											}) ?? `${account.rateLimitHits ?? 0} rate-limit · ${account.serverErrorHits ?? 0} gateway`
										})
									]
								}) : null,
								/**
								* Gateway-fault tally, shown whenever it is non-zero rather than only
								* while the account is cooling.
								*
								* The rate-limit line above is gated on `isCooling` because a 429's
								* only lasting trace is its cooldown. A 5xx is the opposite: its
								* cooldown is the same short 60s window, so by the time anyone opens
								* the panel the cooling flag is long gone and the event would be
								* invisible. This counter persists in memory, so it is what actually
								* answers "is this particular account flaky?".
								*/
								(account.serverErrorHits ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-xdpool-account-meta dsm-workbuddy-xdpool-account-meta-warn",
									title: t?.("row.serverErrorHitsTitle") ?? "Upstream 5xx failures that made the pool rotate away from this account",
									children: t?.("row.serverErrorHits", { hits: account.serverErrorHits }) ?? `${account.serverErrorHits} upstream error(s)`
								}) : null,
								modelCooldowns.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-workbuddy-xdpool-account-modelcool",
									children: modelCooldowns.map((mc) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-account-modelcool-chip",
										children: t?.("row.modelCooling", {
											model: mc.modelId,
											time: formatDateTime(mc.until)
										}) ?? `${mc.modelId} cooling to ${formatDateTime(mc.until)}`
									}, mc.modelId))
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountStats, {
							account,
							t,
							checkinBusy: checkinBusyId === account.id,
							onClaim: onClaimCheckin
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditReserveRow, {
							account,
							t,
							busy: reserveBusyId === account.id,
							onSave: onSaveCreditReserve
						}),
						account.automationToday === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-xdpool-earned",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-xdpool-earned-label",
								children: t?.("row.autoEarned") ?? "Automation today"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-workbuddy-xdpool-earned-list",
								children: [
									account.automationToday.credit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-earned-row",
										children: t?.("row.autoFromTasks", {
											credit: account.automationToday.credit,
											energy: account.automationToday.energy,
											count: account.automationToday.claimed
										}) ?? `Tasks +${account.automationToday.credit}`
									}) : null,
									account.automationToday.checkinCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-earned-row",
										children: t?.("row.autoFromCheckin", { credit: account.automationToday.checkinCredit }) ?? `Check-in +${account.automationToday.checkinCredit}`
									}) : null,
									account.automationToday.bonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-earned-row",
										children: t?.("row.autoFromBonus", { credit: account.automationToday.bonusCredit }) ?? `Streak +${account.automationToday.bonusCredit}`
									}) : null,
									account.automationToday.travelCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-earned-row",
										children: t?.("row.autoFromTravel", { credit: account.automationToday.travelCredit }) ?? `Buddy +${account.automationToday.travelCredit}`
									}) : null
								]
							})]
						})
					]
				})]
			});
		}
		/**
		* Daily check-in block: streak summary plus one claim button for this account.
		* Every account in the pool gets its own button, so a multi-account user can
		* collect each reward without switching the pool's preferred account first.
		*/
		/**
		* Credit panels: package breakdown on the left, the big total on the right with
		* the daily check-in action docked beneath it. Mirrors the two-column credit
		* layout the LaoDing plugin family uses, so the numbers stay scannable and the
		* claim button sits where the eye already is.
		*/
		/**
		* Reserved-credit control for one account.
		*
		* The value is committed on blur or Enter rather than on every keystroke:
		* each save is a settings write plus a status refresh, and a per-character
		* save would hammer both.
		*/
		/**
		* The reserved-credit floor for one account.
		*
		* Saving is an EXPLICIT action, not a blur side effect. The old version
		* committed `onBlur`, which meant a value could be written without the user
		* asking for it — and when the write silently failed, the only trace was a
		* notice line at the top of the card that is easy to miss. That is how
		* "I typed a number, reopened, and it says 0 again" happened with no visible
		* error to explain it.
		*
		* Now: the field is a draft, Save is enabled only when the draft differs from
		* what the host last reported, and the outcome (saving / saved / failed) is
		* shown inline next to the button. Enter also saves, so keyboard flow is not
		* lost.
		*/
		function CreditReserveRow({ account, t, busy, onSave }) {
			const saved = account.creditReserve ?? 0;
			const [draft, setDraft] = (0, react.useState)(String(saved));
			const [settled, setSettled] = (0, react.useState)(saved);
			const [note, setNote] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				setSettled(saved);
				setDraft((current) => current === String(saved) ? current : String(saved));
			}, [saved]);
			const parsed = Number.parseInt(draft, 10);
			const next = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
			const dirty = next !== settled;
			const commit = async () => {
				if (busy || !dirty) return;
				setNote(void 0);
				if (await onSave(account.id, next)) {
					setSettled(next);
					setDraft(String(next));
					setNote("saved");
				} else setNote("failed");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-xdpool-reserve",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-xdpool-reserve-label",
						children: t?.("row.reserveTitle") ?? "Keep at least"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-workbuddy-xdpool-reserve-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "number",
							min: 0,
							step: 1,
							value: draft,
							disabled: busy,
							className: "dsm-workbuddy-xdpool-reserve-input",
							"aria-label": t?.("row.reserveTitle") ?? "Keep at least",
							onChange: (event) => {
								setDraft(event.target.value);
								setNote(void 0);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") commit();
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-reserve-unit",
							children: t?.("row.reserveUnit") ?? "credits"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-workbuddy-xdpool-reserve-save",
						disabled: busy || !dirty,
						onClick: () => {
							commit();
						},
						children: busy ? t?.("row.reserveSaving") ?? "Saving…" : t?.("row.reserveSave") ?? "Save"
					}),
					note === "saved" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-xdpool-reserve-note dsm-workbuddy-xdpool-reserve-note-ok",
						children: next > 0 ? t?.("row.reserveSaved", { credits: next }) ?? `Keeping ${next} credits` : t?.("row.reserveCleared") ?? "Reserve cleared"
					}) : null,
					note === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-xdpool-reserve-note dsm-workbuddy-xdpool-reserve-note-bad",
						children: t?.("row.reserveFailed") ?? "Not saved — try again"
					}) : null,
					account.reserved === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-xdpool-reserve-badge",
						children: t?.("row.reserveHolding") ?? "Reserved: skipped"
					}) : null
				]
			});
		}
		/**
		* Four headline figures for the whole pool: credits left, and what the day,
		* the week and the month have consumed so far.
		*
		* HONESTY: only `remaining` comes from upstream. The three consumption
		* figures are accumulated by this plugin from the moment it first observed a
		* balance (`usage.since`) — upstream exposes no time-windowed consumption
		* endpoint at all. A fresh install therefore shows figures that legitimately
		* start near zero, and a long-running one still misses everything before its
		* first observation. The tooltip states that plainly, and a one-line muted
		* note appears under the bar only while `since` is genuinely fresh (within
		* ~2 days), when the numbers would otherwise be most misleading. There is no
		* permanent warning: once the window is real, the caveat belongs in the
		* tooltip alone.
		*
		* An older host that sends no `usage` key renders nothing at all — not a bar
		* of zeros, which would read as "you have nothing".
		*/
		function UsageBar({ usage, t }) {
			if (usage === void 0 || usage === null) return null;
			const remaining = typeof usage.remaining === "number" ? formatUsage(usage.remaining) : "--";
			const cells = [
				{
					key: "remaining",
					label: t?.("row.usageRemaining") ?? "Credits left",
					value: remaining
				},
				{
					key: "today",
					label: t?.("row.usageToday") ?? "Consumed today",
					value: formatUsage(usage.today)
				},
				{
					key: "last7",
					label: t?.("row.usageLast7") ?? "Consumed last 7 days",
					value: formatUsage(usage.last7)
				},
				{
					key: "month",
					label: t?.("row.usageMonth") ?? "Consumed this month",
					value: formatUsage(usage.month)
				}
			];
			const hint = t?.("row.usageSinceHint") ?? "";
			const showRecent = usageSinceIsRecent(usage.since, 2);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-workbuddy-xdpool-usagebar",
				title: hint === "" ? void 0 : hint,
				children: cells.map((cell) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: cell.key === "remaining" ? "dsm-workbuddy-xdpool-usagebar-cell dsm-workbuddy-xdpool-usagebar-cell-lead" : "dsm-workbuddy-xdpool-usagebar-cell",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-xdpool-usagebar-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							className: "dsm-workbuddy-xdpool-usagebar-glyph",
							children: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, { size: 12 })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-usagebar-label",
							children: cell.label
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-xdpool-usagebar-value",
						children: cell.value
					})]
				}, cell.key))
			}), showRecent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dsm-workbuddy-xdpool-usagebar-note",
				children: t?.("row.usageRecentNote") ?? ""
			}) : null] });
		}
		/**
		* Two-week consumption trend: one bar per local day.
		*
		* A bar chart rather than a line, because the figures are daily totals that were
		* never sampled continuously — a line between two days implies values in
		* between, which nothing measured.
		*
		* Renders nothing at all when the host sends no `trend` (an older build) or when
		* every day is zero. A chart of fourteen empty bars is not information, and the
		* three consumption figures in the bar above already said "nothing yet".
		*
		* Bars are scaled to the window's own maximum, NOT to a fixed ceiling: the
		* interesting shape here is relative ("yesterday was twice today"), and a fixed
		* scale would flatten a light week into invisibility. The peak value is printed
		* in the header so the reader can recover the absolute magnitude.
		*
		* A zero day keeps a 2px stub rather than disappearing, so an idle day reads as
		* "measured, spent nothing" instead of a gap in the chart.
		*/
		function UsageTrend({ trend, t }) {
			if (trend === void 0 || !Array.isArray(trend.points) || trend.points.length === 0) return null;
			const points = trend.points;
			const max = typeof trend.max === "number" && trend.max > 0 ? trend.max : points.reduce((peak, point) => Math.max(peak, typeof point.used === "number" ? point.used : 0), 0);
			if (max <= 0) return null;
			const total = typeof trend.total === "number" ? trend.total : points.reduce((sum, point) => sum + (typeof point.used === "number" ? point.used : 0), 0);
			/**
			* Today is the last point by construction (the host emits oldest first,
			* ending on the current local day), so it needs no date comparison.
			*/
			const lastIndex = points.length - 1;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-xdpool-trend",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-xdpool-trend-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-xdpool-trend-title",
								children: t?.("row.trendTitle", { days: points.length }) ?? `Last ${points.length} days`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-xdpool-trend-total",
								children: t?.("row.trendTotal", { total: formatUsage(total) }) ?? `${formatUsage(total)} total`
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-workbuddy-xdpool-trend-bars",
						children: points.map((point, index) => {
							const used = typeof point.used === "number" && Number.isFinite(point.used) ? point.used : 0;
							const pct = max <= 0 ? 0 : Math.round(used / max * 100);
							const cls = used <= 0 ? "dsm-workbuddy-xdpool-trend-fill dsm-workbuddy-xdpool-trend-fill-zero" : index === lastIndex ? "dsm-workbuddy-xdpool-trend-fill dsm-workbuddy-xdpool-trend-fill-today" : "dsm-workbuddy-xdpool-trend-fill";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-workbuddy-xdpool-trend-bar",
								title: t?.("row.trendBar", {
									date: point.date,
									used: formatUsage(used)
								}) ?? `${point.date}: ${formatUsage(used)}`,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: cls,
									style: { height: used <= 0 ? "2px" : `${String(Math.max(4, pct))}%` }
								})
							}, point.date);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-xdpool-trend-axis",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: points[0].date.slice(5) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.trendPeak", { peak: formatUsage(max) }) ?? `peak ${formatUsage(max)}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: points[lastIndex].date.slice(5) })]
					})
				]
			});
		}
		function AccountStats({ account, t, checkinBusy, onClaim }) {
			const credits = account.credits;
			const checkin = account.checkin;
			const hasCredits = credits !== void 0 || account.creditsError !== void 0;
			const hasCheckin = checkin !== void 0 || account.checkinError !== void 0;
			if (!hasCredits && !hasCheckin) return null;
			const packages = (credits?.packages ?? []).filter((p) => (p.size ?? 0) > 0).slice(0, 6);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-workbuddy-xdpool-stats",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsm-workbuddy-xdpool-panel dsm-workbuddy-xdpool-panel-packages",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-panel-title",
							children: t?.("row.creditsPackages") ?? "Credit packages"
						}),
						account.creditsError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-panel-error",
							children: account.creditsError
						}) : packages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-panel-empty",
							children: "–"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "dsm-workbuddy-xdpool-packages",
							children: packages.map((pack, index) => {
								const expiry = formatExpiry(pack.expiresAtMs);
								const refresh = formatExpiry(pack.cycleRefreshMs);
								const soon = isExpiringSoon(pack);
								const when = pack.monthly === true ? refresh === "" ? null : t?.("row.creditsRefreshAt", { time: refresh }) ?? `Refreshes ${refresh}` : expiry === "" ? null : t?.("row.creditsExpiresAt", { time: expiry }) ?? `Expires ${expiry}`;
								const whenFull = pack.monthly === true ? formatExpiryFull(pack.cycleRefreshMs) : formatExpiryFull(pack.expiresAtMs);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-packages-name",
										children: pack.packageName
									}),
									when === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `dsm-workbuddy-xdpool-packages-when${soon ? " dsm-workbuddy-xdpool-packages-when-soon" : ""}`,
										title: whenFull === "" ? t?.("row.creditsExpiresSoonTitle") ?? "Expiring within 3 days" : whenFull,
										children: when
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-packages-value",
										children: t?.("row.creditsPackage", {
											remain: formatNumber(pack.remain),
											size: formatNumber(pack.size)
										}) ?? `${formatNumber(pack.remain)} / ${formatNumber(pack.size)}`
									})
								] }, `${pack.packageName}-${String(index)}`);
							})
						}),
						credits?.expiringSoon !== void 0 && credits.expiringSoon > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-xdpool-panel-foot",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.creditsSoon") ?? "Expiring in 3 days" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: formatNumber(credits.expiringSoon) })]
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsm-workbuddy-xdpool-panel dsm-workbuddy-xdpool-panel-total",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-panel-title",
							children: t?.("row.creditsTotal") ?? "Total"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-total-value",
							children: formatNumber(credits?.total)
						}),
						hasCheckin ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-xdpool-checkin",
							children: account.checkinError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-xdpool-checkin-error",
								children: account.checkinError
							}) : checkin === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-xdpool-checkin-meta",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-checkin-streak",
										children: t?.("row.checkinStreak", { days: checkin.streakDays }) ?? `${checkin.streakDays}-day streak`
									}), checkin.dailyCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-checkin-daily",
										children: t?.("row.checkinDaily", { credit: formatNumber(checkin.dailyCredit) }) ?? `+${formatNumber(checkin.dailyCredit)}/day`
									}) : null]
								}),
								checkin.isStreakDay && checkin.streakBonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-xdpool-checkin-bonus",
									children: t?.("row.checkinStreakBonus", {
										days: formatNumber(checkin.nextStreakDay),
										credit: formatNumber(checkin.streakBonusCredit)
									}) ?? `bonus +${formatNumber(checkin.streakBonusCredit)}`
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-workbuddy-xdpool-checkin-btn",
									disabled: !checkin.active || checkin.todayCheckedIn || checkinBusy,
									onClick: () => {
										onClaim(account.id);
									},
									children: !checkin.active ? t?.("row.checkinInactive") ?? "Unavailable" : checkin.todayCheckedIn ? t?.("row.checkinClaimed") ?? "Checked in" : checkinBusy ? t?.("row.checkinClaiming") ?? "Checking in…" : t?.("row.checkinClaim") ?? "Check in"
								})
							] })
						}) : null
					]
				})]
			});
		}
		/**
		* Pool-wide "credits are about to lapse" banner.
		*
		* Sits directly under the usage bar and stays silent in the common case where
		* nothing is at risk — a permanent warning would train the user to ignore it.
		*
		* The awkward case is a pool holding mostly monthly credits. Those never
		* expire (they cycle), so `expiringSoon` is legitimately 0 even though the
		* balance is large and about to be reset. Rather than let that read as an
		* unqualified all-clear, the banner has a second, quieter mode that says the
		* credits are scheduled to reset and names the amount — the figure the user
		* would otherwise have to reconstruct from the per-account package lists.
		*
		* A host too old to send `summary.expiringCredits` still gets a correct banner:
		* the per-account rollup is computed locally in that case. Backends and this
		* bundle ship together, so the fallback exists for robustness, not because the
		* two are expected to run apart.
		*/
		function CreditExpiryNotice({ accounts, summary, t }) {
			const rollup = creditExpiryRollup(accounts, 3);
			const soon = summary?.expiringCredits ?? rollup.soon;
			const soonAccounts = summary?.expiringAccounts ?? rollup.soonAccounts;
			const cycling = rollup.cycling;
			const unreadable = rollup.unreadable;
			if (soon > 0) {
				// Full stamp here, not the short form: this line is the one place the
				// exact hour of a lapse is the point of the message.
				const when = formatExpiryFull(rollup.nearest);
				const days = daysUntil(rollup.nearest);
				const tail = when === "" ? "" : days === void 0 ? t?.("row.expiryOn", { time: when }) ?? `no later than ${when}` : t?.("row.expiryIn", {
					days,
					time: when
				}) ?? `within ${days} day(s), by ${when}`;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "dsm-workbuddy-xdpool-expiry dsm-workbuddy-xdpool-expiry-warn",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						className: "dsm-workbuddy-xdpool-expiry-glyph",
						children: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, { size: 12 })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						children: t?.("row.expirySoon", {
							credits: formatNumber(soon),
							accounts: soonAccounts,
							tail
						}) ?? `${formatNumber(soon)} credits across ${soonAccounts} account(s) expire ${tail}`
					})]
				});
			}
			/**
			* Nothing lapses. Say so only when there is something worth saying: either
			* credits are cycling (so the 0 above is not the whole story), or some
			* accounts could not be read at all (so the 0 is not trustworthy). A pool
			* with neither is genuinely fine and gets no banner.
			*/
			const notes = [];
			if (cycling > 0) notes.push(t?.("row.expiryCycling", { credits: formatNumber(cycling) }) ?? `${formatNumber(cycling)} credits reset on a cycle rather than expiring`);
			if (unreadable > 0) notes.push(t?.("row.expiryUnknown", { accounts: unreadable }) ?? `${unreadable} account(s) could not be read`);
			if (notes.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: "dsm-workbuddy-xdpool-expiry dsm-workbuddy-xdpool-expiry-muted",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					className: "dsm-workbuddy-xdpool-expiry-glyph",
					children: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconGaugeOutlineRegular, { size: 12 })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.expiryNoneTitle") ?? "Nothing expires in the next 3 days" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsm-workbuddy-xdpool-expiry-note",
					children: ["· ", notes.join(" · ")]
				})]
			});
		}
		/**
		* One model row.
		*
		* Read-only when the card has no writable settings scope: the checkbox and the
		* context radios stay disabled rather than pretending an edit took hold. The
		* draft lives in the parent, so this component only ever reports intent.
		*/
		function ModelRow({ model, t, draft, editable, onToggle, onToggleImage, onBudget }) {
			const tag = tagFor(model);
			const tagText = tag === "free" ? t?.("row.free") ?? "free" : tag === "limited" ? t?.("row.limitedFree") ?? "limited free" : tag === "night" ? t?.("row.nightDiscount") ?? "night" : null;
			const native = model.nativeContextWindow;
			const capped = native > DEFAULT_CONTEXT_BUDGET;
			const currentBudget = draft.budget ?? native;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `dsm-workbuddy-xdpool-model${draft.enabled ? "" : " dsm-workbuddy-xdpool-model-off"}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-xdpool-model-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsm-workbuddy-xdpool-model-check",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: draft.enabled,
							disabled: !editable,
							onChange: () => {
								onToggle(model.id);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-workbuddy-xdpool-model-copy",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-workbuddy-xdpool-model-name",
								/* The upstream omits `credits` for some models - `auto` among them - so there is
								   no rate to show. Rendering nothing made that indistinguishable from a model
								   where the figure does not apply; this is the case where the user cannot tell
								   what the model costs, so it is worth saying so. */
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), model.multiplier === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-xdpool-model-name-rate dsm-workbuddy-xdpool-model-name-rate-unknown",
									title: t?.("row.rateUnknownHint") ?? "",
									children: t?.("row.rateUnknown") ?? "rate unknown"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-xdpool-model-name-rate",
									children: t?.("row.rate", { rate: model.multiplier.toFixed(2) }) ?? `${model.multiplier.toFixed(2)}x`
								})]
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-xdpool-model-controls",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsm-workbuddy-xdpool-model-image",
							title: t?.("row.modelImage") ?? "Image input",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.images,
								disabled: !editable,
								onChange: () => {
									onToggleImage(model.id);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.modelImage") ?? "Image" })]
						}), capped ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
							className: "dsm-workbuddy-xdpool-model-budget",
							"aria-label": t?.("row.modelContextBudget") ?? "Context",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "radio",
								name: `budget-${model.id}`,
								checked: currentBudget === DEFAULT_CONTEXT_BUDGET,
								disabled: !editable,
								onChange: () => {
									onBudget(model.id, DEFAULT_CONTEXT_BUDGET);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatCapacity(DEFAULT_CONTEXT_BUDGET) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "radio",
								name: `budget-${model.id}`,
								checked: currentBudget === native,
								disabled: !editable,
								onChange: () => {
									onBudget(model.id, native);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatCapacity(native) })] })]
						}) : null]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-workbuddy-xdpool-model-meta",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-model-id",
							children: model.id
						}),
						tagText === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-model-meta-tag",
							children: tagText
						}),
						/**
						* Only the empty case is shown.
						*
						* Printing a count on every row would be fifteen numbers nobody reads;
						* the value of this figure is telling the user which enabled model has
						* nobody left to serve it, since every account can look healthy while
						* each is avoiding a different model. An older card build sends no
						* field and simply gets no chip.
						*/
						model.servableAccounts === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-model-meta-tag dsm-workbuddy-xdpool-model-meta-tag-warn",
							title: t?.("row.modelNoAccountsHint") ?? "",
							children: t?.("row.modelNoAccounts") ?? "no account available"
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-model-cap",
							children: t?.("row.modelOutput", { size: formatCapacity(model.maxOutputTokens) }) ?? `out ${formatCapacity(model.maxOutputTokens)}`
						}),
						model.supportedEfforts === void 0 || model.supportedEfforts.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-model-cap",
							children: t?.("row.modelReasoning", { efforts: model.supportedEfforts.join(" / ") }) ?? model.supportedEfforts.join(" / ")
						})
					]
				})]
			});
		}
		/**
		* The request log: what the pool did, newest first.
		*
		* Reads `status.requests` and nothing else, so it is safe to mount on a host
		* that has never heard of the field — `requestRows` turns that into an empty
		* list and the section says so in one line rather than disappearing. A card
		* whose panel vanishes when data is missing teaches the user nothing; one
		* that says "nothing logged yet" tells them the feature is there and idle.
		*
		* Rows are drawn as a fixed-column table with a sideways scroll. The
		* alternative — wrapping each request as a card — makes the eight fields
		* impossible to compare between requests, and comparing them (this one took
		* 4.2s and that one 850ms) is the only reason to keep a log.
		*/
		function RequestLog({ status, t, open, onToggle }) {
			const rows = requestRows(status);
			const okCount = rows.filter((row) => row?.outcome === "ok").length;
			/**
			* The per-model queue comparison, or an empty list.
			*
			* Defensive about the shape for the same reason the request rows are: an
			* older host does not send the field, and a card that throws while rendering
			* is replaced wholesale by the error boundary.
			*/
			const queueRows = Array.isArray(status?.queueStats) ? status.queueStats.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.modelId === "string") : [];
			const head = (key, fallback, className) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
				scope: "col",
				className,
				children: t?.(key) ?? fallback
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: `dsm-workbuddy-xdpool-req${open ? " dsm-workbuddy-xdpool-req-open" : ""}`,
				"aria-label": t?.("row.reqTitle") ?? "Request log",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-xdpool-req-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-workbuddy-xdpool-models-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsm-workbuddy-xdpool-req-toggle",
								"aria-expanded": open,
								"aria-label": `${t?.(open ? "row.reqCollapse" : "row.reqExpand") ?? ""}: ${t?.("row.reqTitle") ?? "Request log"}`,
								onClick: onToggle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									className: `dsm-workbuddy-xdpool-req-chevron${open ? " dsm-workbuddy-xdpool-req-chevron-open" : ""}`,
									children: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "dsm-workbuddy-xdpool-req-title",
									children: t?.("row.reqTitle") ?? "Request log"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-workbuddy-xdpool-req-summary",
								children: rows.length === 0 ? t?.("row.reqEmpty") ?? "No requests recorded yet." : t?.("row.reqSummary", {
									count: rows.length,
									ok: okCount
								}) ?? `${rows.length} request(s) · ${okCount} ok`
							})]
						})]
					}),
					open && rows.length !== 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-workbuddy-xdpool-req-list",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-xdpool-req-scroll",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-workbuddy-xdpool-req-table",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", {
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										children: [
											head("row.reqColTime", "Time"),
											head("row.reqColModel", "Model"),
											head("row.reqColAccount", "Account"),
											head("row.reqColOutcome", "Result"),
											head("row.reqColTotal", "Total", "dsm-workbuddy-xdpool-req-num"),
											head("row.reqColFirstToken", "First token", "dsm-workbuddy-xdpool-req-num"),
											head("row.reqColTokens", "Tokens", "dsm-workbuddy-xdpool-req-num"),
											head("row.reqColAttempts", "Attempts", "dsm-workbuddy-xdpool-req-num")
										]
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", {
									children: rows.map((row, index) => {
										const outcome = requestOutcome(row ?? {}, t);
										/**
										* Index in the key, not `startedAt`: two requests that begin in
										* the same millisecond are unusual but not impossible (a retry
										* loop), and a duplicate React key silently drops a row.
										*/
										const key = `${typeof row?.startedAt === "number" ? row.startedAt : "row"}-${String(index)}`;
										const model = typeof row?.model === "string" && row.model !== "" ? row.model : void 0;
										const label = typeof row?.accountLabel === "string" && row.accountLabel !== "" ? row.accountLabel : void 0;
										const rotation = Array.isArray(row?.rotation) ? row.rotation.filter((entry) => typeof entry === "string" && entry !== "") : [];
										/**
										* Three sizes of placeholder, all deliberate:
										*   - `-` the value is missing on this row (an older host, or a
										*     request that never got far enough to have one)
										*   - `.` a token count WAS reported but the host did not break it
										*     down, so "0 in / 0 out" would be a claim we cannot make
										*   - `0` a real, reported zero
										*/
										const tokens = typeof row?.promptTokens === "number" || typeof row?.completionTokens === "number" ? `${formatNumber(row.promptTokens)} / ${formatNumber(row.completionTokens)}` : row?.promptTokens === void 0 && row?.completionTokens === void 0 ? "-" : "·";
										const total = formatDuration(row?.totalMs);
										const first = formatDuration(row?.firstTokenMs);
										/**
										* The wait split three ways.
										*
										* `queue` is the gateway queueing before it answers - measured at 4.6-5.5s
										* of an 8s request, and NOT the pool's own selection, which takes
										* microseconds. It was labelled `pick`, which invited exactly the wrong
										* conclusion; the name is now the measurement.
										*
										* `think` is the upstream reasoning to its first token; `generate` is
										* everything after. All three arrive from the host already computed, so
										* nothing is re-derived here - a second derivation is a second chance to
										* disagree with the first.
										*
										* `queueMs` is read with a fallback to the older `pickMs`, because the
										* records already on disk were written under the old name and dropping it
										* would leave a column of dashes for history that is still perfectly
										* readable.
										*/
										const queue = formatDuration(row?.queueMs ?? row?.pickMs);
										const think = formatDuration(row?.thinkMs);
										const generate = formatDuration(row?.generateMs);
										const phases = [queue === "" ? void 0 : `${t?.("row.reqQueue") ?? "queue"} ${queue}`, think === "" ? void 0 : `${t?.("row.reqThink") ?? "think"} ${think}`, generate === "" ? void 0 : `${t?.("row.reqGenerate") ?? "generate"} ${generate}`].filter((part) => part !== void 0);
										const attempts = typeof row?.attempts === "number" && Number.isFinite(row.attempts) ? String(row.attempts) : "-";
										const clock = formatClock(row?.startedAt);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: "dsm-workbuddy-xdpool-req-time",
													children: clock === "" ? "-" : clock
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: model === void 0 ? "dsm-workbuddy-xdpool-req-model dsm-workbuddy-xdpool-req-model-none" : "dsm-workbuddy-xdpool-req-model",
													title: model ?? "",
													children: model ?? "-"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: "dsm-workbuddy-xdpool-req-account",
													title: label ?? row?.accountId ?? "",
													children: label ?? "-"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													className: `dsm-workbuddy-xdpool-req-outcome dsm-workbuddy-xdpool-req-${outcome.tone}`,
													title: outcome.detail ?? outcome.label,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														"aria-hidden": "true",
														className: "dsm-workbuddy-xdpool-req-outcome-dot"
													}), outcome.label]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: "dsm-workbuddy-xdpool-req-num",
													children: total === "" ? "-" : total
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													className: "dsm-workbuddy-xdpool-req-num dsm-workbuddy-xdpool-req-phase",
													title: phases.join(" · "),
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-req-phase-total",
														children: first === "" ? "-" : first
													}), phases.length < 2 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-req-phase-split",
														children: phases.slice(1).join(" · ")
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: "dsm-workbuddy-xdpool-req-token",
													children: tokens
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													className: "dsm-workbuddy-xdpool-req-num",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-workbuddy-xdpool-req-tries",
														children: attempts
													}), rotation.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsm-workbuddy-xdpool-req-rotation",
														children: [" ", t?.("row.reqRotation", { accounts: rotation.join(" → ") }) ?? `via ${rotation.join(" -> ")}`]
													})]
												})
											]
										}, key);
									})
								})]
							})
						})
					}) : null,
					/**
					* Per-model queueing, next to the rows it is derived from.
					*
					* A list of individual requests cannot answer "which model queues less" -
					* that is an aggregate question, and comparing eight timestamps by eye is
					* not an answer. p50 is the typical wait and p95 the bad case; the mean is
					* shown because it is the number people reach for, not because it is the
					* useful one.
					*
					* Only successful requests are counted upstream, so a fast failure does not
					* drag a model's figure toward zero.
					*/
					open && queueRows.length !== 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-workbuddy-xdpool-queue",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: "dsm-workbuddy-xdpool-queue-title",
							children: t?.("row.queueTitle") ?? "Queue time by model"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-workbuddy-xdpool-queue-scroll",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-workbuddy-xdpool-queue-table",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", {
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										children: [
											head("row.queueColModel", "Model"),
											head("row.queueColSamples", "n", "dsm-workbuddy-xdpool-req-num"),
											head("row.queueColP50", "p50", "dsm-workbuddy-xdpool-req-num"),
											head("row.queueColP95", "p95", "dsm-workbuddy-xdpool-req-num"),
											head("row.queueColSpeed", "tok/s", "dsm-workbuddy-xdpool-req-num")
										]
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", {
									children: queueRows.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dsm-workbuddy-xdpool-queue-model",
												title: entry.modelId,
												children: entry.modelId
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dsm-workbuddy-xdpool-req-num",
												children: typeof entry.samples === "number" ? String(entry.samples) : "-"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dsm-workbuddy-xdpool-req-num dsm-workbuddy-xdpool-queue-p50",
												children: formatDuration(entry.p50Ms) === "" ? "-" : formatDuration(entry.p50Ms)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dsm-workbuddy-xdpool-req-num",
												title: `${t?.("row.queueColMax") ?? "max"} ${formatDuration(entry.maxMs) === "" ? "-" : formatDuration(entry.maxMs)} · ${t?.("row.queueColAvg") ?? "avg"} ${formatDuration(entry.avgMs) === "" ? "-" : formatDuration(entry.avgMs)}`,
												children: formatDuration(entry.p95Ms) === "" ? "-" : formatDuration(entry.p95Ms)
											}),
											/**
											* Median output rate, or a dash.
											*
											* A dash is not the same as zero: it means no sample was long
											* enough to measure a rate from, and printing "0 tok/s" would
											* state a speed that was never observed.
											*/
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: "dsm-workbuddy-xdpool-req-num",
												title: typeof entry.minTps === "number" && typeof entry.maxTps === "number" ? `${String(entry.minTps)}–${String(entry.maxTps)} tok/s · n=${String(entry.speedSamples ?? 0)}` : "",
												children: typeof entry.p50Tps === "number" ? String(entry.p50Tps) : "-"
											})
										]
									}, `${entry.region ?? ""}-${entry.modelId}-${String(index)}`))
								})]
							})
						})]
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Plugin-card copy registered under the `settings.workbuddy-xdpool` locale
		* namespace. Key lists in `en` and `zh` are kept 1:1 by typing `zh` against
		* the key set of `en`.
		*
		* @module dsh-rotakit/client/locales
		*/
		const en = {
			"row.title": "RotaKit (dsh-rotakit)",
			"row.desc": "Route every WorkBuddy sign-in on this machine into DSH as one auto-failing-over model pool.",
			"row.expand": "Expand",
			"row.collapse": "Collapse",
			"row.requestFailed": "Request failed",
			"row.poolEmpty": "No WorkBuddy account discovered yet.",
			"row.poolEmptyHint": "Sign in to one or more WorkBuddy accounts in the WorkBuddy desktop app, then click “Detect accounts again”. Each sign-in is picked up automatically as a pool member.",
			"row.regionEmpty": "No account signed in for this region yet.",
			"row.regionEmptyHint": "Sign in to a WorkBuddy account for this region in the desktop app, then choose “Detect accounts again”. Domestic and international accounts can be signed in side by side.",
			"row.regionEmptyTitle": "No {region} account is signed in yet.",
			"row.regionHowToTitle": "How to sign in to the {region} version",
			"row.regionHowTo1": "Download and install the {region} client: the international build is named WorkBuddy AI while the domestic one is WorkBuddy, and they are different apps. The web version at https://www.workbuddy.ai/ also works.",
			"row.regionHowTo2": "Pick a sign-in method: email sign-up / sign-in (most common), OAuth with Google, GitHub or X, or WeChat QR scan on some builds.",
			"row.regionHowTo3": "Make sure this machine can reach overseas sites when signing in: the international version targets users outside mainland China and may fail to load behind a restricted network.",
			"row.regionHowTo4": "Back here, press the re-detect button. Every sign-in the client has left on this machine is absorbed into its own region - the two sides stay separate and can run at the same time.",
			"row.regionHowToNote": "The two versions keep separate accounts, credits and data: a domestic account cannot sign in to the international one, and vice versa, so each needs its own registration. This plugin only reads the sign-ins the client has already performed.",
			"row.shimStopped": "Provider loopback is not running.",
			"row.shimRunning": "Provider listening on loopback",
			"row.accountsTitle": "Accounts in the pool",
			"row.tabCn": "CN",
			"row.tabGlobal": "Global",
			"row.tabHint": "Each tab is a separate provider with its own accounts, credits and models. Both are active at once, and a change on one side does not affect the other.",
			"row.accountsSummary": "{count} account(s) · {cooling} cooling",
			"row.accountsExpand": "Expand the account list",
			"row.accountsCollapse": "Collapse the account list",
			"row.modelsExpand": "Expand the model list",
			"row.modelsCollapse": "Collapse the model list",
			"row.reqExpand": "Expand the request log",
			"row.reqCollapse": "Collapse the request log",
			"row.ok": "Healthy — requests auto-rotate across accounts",
			"row.allCooling": "Every account is rate-limited right now; requests pause until a cooldown lifts.",
			"row.accountInRotation": "Enabled",
			"row.accountOff": "Disabled",
			"row.accountToggleHint": "Enable this account (uncheck to keep it out of the pool)",
			"row.accountToggleError": "Could not switch the account: {message}",
			"row.currentAccount": "In use now",
			"row.currentAccountDisabled": "switched off — the next request moves on",
			"row.cooling": "Cooling (rate-limited)",
			"row.accountAuthDead": "Sign in again",
			"row.accountAuthDeadHint": "The upstream rejected this account's token repeatedly, so it is out of the pool until the timer runs out. Signing in again on the desktop app restores it.",
			"row.cooldownHits": "{hits} hit(s)",
			"row.cooldownUntil": "until {time}",
			"row.cooldownHint": "An account is set aside after a refusal. A rate limit is this account's own limit; a gateway fault is the upstream's and would have hit any account. Per-model limits pause only that model, so the rest of the account keeps serving.",
			"row.coolAccountWide": "Whole account paused",
			"row.coolModelOnly": "{count} model(s) paused",
			"row.coolRemaining": "back in {remaining} ({time})",
			"row.coolModelChip": "{model} · {remaining}",
			"row.coolHitsSplit": "rate-limited {limits} · gateway {gateway}",
			"row.serverErrorHits": "{hits} upstream error(s)",
			"row.serverErrorHitsTitle": "Upstream 5xx failures (including Tencent's 550) that made the pool rotate away from this account. Counted separately from rate limits: a 429 means this account is the problem, a 5xx means the gateway is.",
			"row.serverErrorsTotal": "{hits} upstream error(s)",
			"row.serverErrorsTotalTitle": "Upstream 5xx failures across this region's accounts. Two figures are reported: this run of the host, which starts again from zero when the app restarts, and the lifetime count kept on disk, which survives restarts and is never cleared by resetting cooldowns.",
			"row.modelCooling": "{model} cooling until {time}",
			"row.tokenExpiry": "token {time}",
			"row.creditsTotal": "Total",
			"row.creditsPackages": "Credit packages",
			"row.creditsPackage": "{remain} / {size}",
			"row.creditsError": "credits unavailable",
			"row.creditsSoon": "Expiring in 3 days",
			"row.creditsExpiresAt": "Expires {time}",
			"row.creditsExpiresSoonTitle": "Expiring within 3 days",
			"row.creditsRefreshAt": "Refreshes {time}",
			"row.checkinTitle": "Daily check-in",
			"row.checkinClaim": "Check in",
			"row.checkinClaiming": "Checking in…",
			"row.checkinClaimed": "Checked in today",
			"row.checkinInactive": "Check-in not available for this account",
			"row.checkinStreak": "{days}-day streak",
			"row.checkinDaily": "+{credit} credits/day",
			"row.checkinStreakBonus": "day {days} bonus +{credit}",
			"row.checkinClaimedReward": "Claimed +{credit} credits",
			"row.checkinError": "Check-in failed: {message}",
			"row.checkinAllHint": "Collect every account’s daily reward here — no need to switch accounts first.",
			"row.modelsTitle": "Models",
			"row.modelsSummary": "{count} model(s) in the live catalog",
			"row.modelsHint": "Read from the live WorkBuddy catalog. Free tiers are marked.",
			"row.modelEnabled": "Enabled",
			"row.modelImage": "Image input",
			"row.modelContextBudget": "Context window",
			"row.modelContextNative": "{size} (max)",
			"row.modelContextCapped": "{size}",
			"row.modelOutput": "Output {size}",
			"row.modelReasoning": "Thinking: {efforts}",
			"row.modelsEnabledCount": "{enabled} / {total} enabled",
			"row.modelsSave": "Save",
			"row.modelsSaving": "Saving…",
			"row.modelsDiscard": "Discard",
			"row.modelsSaved": "Model selection saved",
			"row.modelsSaveError": "Could not save: {message}",
			"row.modelsEmpty": "No model enabled — enable at least one before saving.",
			"row.free": "free",
			"row.limitedFree": "limited free",
			"row.nightDiscount": "night",
			"row.modelNoAccounts": "no account available",
			"row.modelNoAccountsHint": "This model is enabled but every account is currently unavailable for it — cooling down, retired, or avoiding this model specifically. A request would fail over through the whole pool before reporting an error.",
			"row.imageCapable": "image input",
			"row.rate": "{rate}x credits",
			"row.rateUnknown": "rate unknown",
			"row.rateUnknownHint": "The upstream publishes no credit rate for this model, so how much a request costs cannot be shown. It may be free, or it may be expensive — the value is simply not declared.",
			"row.accountsRescan": "Detect accounts again",

			"row.oauthAdd": "Add account",
			"row.oauthHide": "Hide",
			"row.oauthStarting": "Opening…",
			"row.oauthHint": "Open the link and sign in; the account is added automatically",
			"row.oauthDone": "Added {label}",
			"row.oauthAdded": "Added {label}",
			"row.oauthExpired": "Expired — request a new link",
			"row.oauthRetry": "New code",
			"row.oauthClose": "Close",

			"row.accountsScanning": "Detecting…",
			"row.distTitle": "Account usage",
			"row.distPriority": "Priority",
			"row.distPriorityHint": "Use one account until it runs out, then move to the next",
			"row.distRoundRobin": "Round-robin",
			"row.distRoundRobinHint": "Take turns in order, spreading the spend evenly",
			"row.distBalanced": "Balanced",
			"row.distBalancedHint": "Draw at random, favouring the account idle longest",
			"row.resetCooldowns": "Clear all cooldowns",
			"row.resetCooldownsBusy": "Clearing…",
			"row.resetCooldownsDone": "Cooldowns cleared",
			"row.accountsRescanned": "Detected {count} account(s)",
			"row.error": "Pool status unavailable: {message}",
			"row.autoTitle": "Automation",
			"row.autoOn": "On",
			"row.autoOff": "Off",
			"row.autoBusy": "Saving…",
			"row.autoHintOn": "Checks in, reports activity, claims task and streak rewards, and runs the buddy trip — every day.",
			"row.autoHintOff": "Off: no background requests are made for you.",
			"row.autoJob_report": "Activity report",
			"row.autoJob_tasks": "Task rewards",
			"row.autoJob_checkin": "Daily check-in",
			"row.autoJob_streak": "Streak bonus",
			"row.autoJob_travel": "Buddy trip",
			"row.autoHourNone": "skipped today",
			"row.autoNever": "not run yet",
			"row.autoRun": "Run now",
			"row.autoRunning": "Running…",
			"row.autoRan": "Done: {count} account(s) ok, {failed} failed",
			"row.autoRanTasks": "Done: {claimed} task(s) claimed, +{credit} credits, +{energy} energy",
			"row.reserveTitle": "Keep at least",
			"row.reserveUnit": "credits",
			"row.reserveSaving": "Saving…",
			"row.reserveSave": "Save",
			"row.reserveHolding": "Reserved: skipped",
			"row.reserveSaved": "Keeping {credits} credits",
			"row.reserveCleared": "Reserve cleared",
			"row.reserveFailed": "Not saved — try again",
			"row.autoToday": "Today",
			"row.autoEarned": "Automation today",
			"row.autoEnergy": "energy",
			"row.autoTasksClaimed": "{count} task(s)",
			"row.autoRunAll": "Run now",
			"row.autoRunStarted": "Automation pass started — it keeps running in the background, so you can close this panel.",
			"row.autoAlreadyRunning": "A run is already in progress",
			"row.autoRanAll": "Ran {jobs} job(s), {ok} ok, {failed} failed",
			"row.autoFromTasks": "Tasks +{credit} credits · +{energy} energy · {count} task(s)",
			"row.autoFromCheckin": "Check-in +{credit} credits",
			"row.autoFromBonus": "Streak bonus +{credit} credits",
			"row.autoFromTravel": "Buddy travel +{credit} credits",

			"row.usageRemaining": "Credits left",
			"row.usageToday": "Consumed today",
			"row.usageLast7": "Consumed last 7 days",
			"row.usageMonth": "Consumed this month",
			"row.usageSinceHint": "Credits left is read from WorkBuddy. The three consumption figures are tallied by this plugin itself, starting from the day it first saw a balance — WorkBuddy exposes no history for them, so anything spent before that day is not counted.",
			"row.usageRecentNote": "Consumption figures were only started recently, so they still miss earlier spending and will grow from here.",
			"row.trendTitle": "Last {days} days",
			"row.trendTotal": "{total} in total",
			"row.trendPeak": "peak {peak}",
			"row.trendBar": "{date}: {used}",
			"row.expirySoon": "{credits} credits across {accounts} account(s) expire {tail}.",
			"row.expiryIn": "within {days} day(s), by {time}",
			"row.expiryOn": "no later than {time}",
			"row.expiryNoneTitle": "Nothing expires in the next 3 days",
			"row.expiryCycling": "{credits} credits reset on a cycle instead of expiring",
			"row.expiryUnknown": "{accounts} account(s) could not be read",
			"row.healthHint": "Health is judged from what the pool already reports. Findings are listed by severity rather than averaged into a score: an expired sign-in makes an account unusable until you sign in again, while a rate-limit cooldown lasts under a minute.",
			"row.healthDisabled": "{label} is switched off",
			"row.healthTokenExpired": "{label} needs signing in again",
			"row.healthCreditsUnreadable": "{label} balance could not be read",
			"row.healthCheckinUnreadable": "{label} check-in state could not be read",
			"row.healthRateLimited": "{label} is rate-limited for a moment",
			"row.healthGatewayCooling": "{label} is stepping aside after an upstream fault",
			"row.healthNoCredits": "{label} has no credits left",

			"row.themeTitle": "Theme",
			"row.themeSystem": "System",
			"row.themeLight": "Light",
			"row.themeDark": "Dark",
			"row.themeCycleHint": "Switch theme: System (follow the OS) → Light → Dark. The choice is remembered on this machine.",

			"row.reqTitle": "Request log",
			"row.reqSummary": "{count} request(s) · {ok} ok",
			"row.reqEmpty": "No requests recorded yet.",
			"row.reqColTime": "Time",
			"row.reqColModel": "Model",
			"row.reqColAccount": "Account",
			"row.reqColOutcome": "Result",
			"row.reqColTotal": "Total",
			"row.reqColFirstToken": "First token",
			"row.reqQueue": "queue",
			"row.reqThink": "think",
			"row.reqGenerate": "generate",
			"row.queueTitle": "Queue time by model",
			"row.queueColModel": "Model",
			"row.queueColSamples": "n",
			"row.queueColP50": "p50",
			"row.queueColP95": "p95",
			"row.queueColSpeed": "tok/s",
			"row.queueColMax": "max",
			"row.queueColAvg": "avg",
			"row.reqColTokens": "Tokens",
			"row.reqColAttempts": "Attempts",
			"row.reqOk": "ok",
			"row.reqPending": "pending",
			"row.reqUnknown": "unknown",
			"row.reqRotation": "via {accounts}",
			"row.reqFailedHint": "The pool reported this request as a failure."
		};
		const zh = {
			"row.title": "WorkBuddy 池（dsh-rotakit）",
			"row.desc": "把本机所有已登录的 WorkBuddy 账号并入 DSH，作为一个自动容错的模型池使用。",
			"row.expand": "展开",
			"row.collapse": "收起",
			"row.requestFailed": "请求失败",
			"row.poolEmpty": "还没有发现任何 WorkBuddy 账号。",
			"row.poolEmptyHint": "先在 WorkBuddy 桌面 App 里登录一个或多个 WorkBuddy 账号，再点“重新检测账号”。每次登录都会被自动纳入池中。",
			"row.regionEmpty": "这边还没有登录账号。",
			"row.regionEmptyHint": "在 WorkBuddy 桌面 App 里登录一个该区域的账号，再点「重新检测账号」。国内版与国际版可以同时登录，两边各自独立。",
			"row.regionEmptyTitle": "这边还没有登录{region}账号。",
			"row.regionHowToTitle": "{region}怎么登录",
			"row.regionHowTo1": "下载并安装{region}客户端：国际版安装包名称是「WorkBuddy AI」，国内版是「WorkBuddy」，两者是不同的应用。也可以直接用网页版 https://www.workbuddy.ai/ 登录。",
			"row.regionHowTo2": "登录方式（任选其一）：① 邮箱注册/登录（最常用）；② 用 Google、GitHub、X 等海外账号授权登录；③ 部分版本支持微信扫码。",
			"row.regionHowTo3": "登录时请确保能正常访问海外站点（国际版面向海外用户，网络受限时可能打不开或登录失败）。",
			"row.regionHowTo4": "回到这里点「重新检测账号」。App 在本机留下的每次登录都会被自动吸收到各自区域 —— 两边互相独立，可以同时使用。",
			"row.regionHowToNote": "国内版与国际版的账号、积分、数据体系完全隔离，互不相通：国内版账号无法登录国际版，反之亦然，需要各自单独注册。本插件只读取客户端已完成的登录，不会代替你登录。",
			"row.shimStopped": "回环提供端未运行。",
			"row.shimRunning": "提供端正在回环地址监听",
			"row.accountsTitle": "池中账号",
			"row.tabCn": "国内版",
			"row.tabGlobal": "国际版",
			"row.tabHint": "每个 tab 是一个独立供应商，各有自己的账号、积分与模型；两边同时生效，一侧的改动不影响另一侧。",
			"row.accountsSummary": "{count} 个账号 · {cooling} 个冷却中",
			"row.accountsExpand": "展开账号列表",
			"row.accountsCollapse": "收起账号列表",
			"row.modelsExpand": "展开模型列表",
			"row.modelsCollapse": "收起模型列表",
			"row.reqExpand": "展开请求记录",
			"row.reqCollapse": "收起请求记录",
			"row.ok": "运行健康 —— 请求会在各账号间自动轮换",
			"row.allCooling": "当前所有账号都处于限流冷却，请求会暂停直到某个冷却结束。",
			"row.accountInRotation": "已启用",
			"row.accountOff": "已停用",
			"row.accountToggleHint": "启用该账号（取消勾选则不参与池子）",
			"row.accountToggleError": "切换账号失败：{message}",
			"row.currentAccount": "当前使用",
			"row.currentAccountDisabled": "已停用 —— 下次请求会换号",
			"row.cooling": "冷却中（被限流）",
			"row.accountAuthDead": "需重新登录",
			"row.accountAuthDeadHint": "上游连续拒绝该账号的令牌，已将它移出池子，等计时结束会自动回归。在桌面端重新登录即可立刻恢复。",
			"row.cooldownHits": "触发 {hits} 次",
			"row.cooldownUntil": "至 {time}",
			"row.cooldownHint": "账号被拒后会暂时让位。限流是该账号自身的额度上限；网关故障来自上游，换任何账号都会撞上。按模型冷却只暂停那一个模型，该账号的其他模型仍然可用。",
			"row.coolAccountWide": "整个账号已暂停",
			"row.coolModelOnly": "{count} 个模型已暂停",
			"row.coolRemaining": "还需 {remaining}（{time} 恢复）",
			"row.coolModelChip": "{model} · 还需 {remaining}",
			"row.coolHitsSplit": "限流 {limits} 次 · 网关故障 {gateway} 次",
			"row.serverErrorHits": "网关故障 {hits} 次",
			"row.serverErrorHitsTitle": "上游 5xx（含腾讯网关偶发的 550）导致池子从这个账号换走的次数。与限流分开计数：429 说明「这个号有问题」，5xx 说明「上游有问题」。",
			"row.serverErrorsTotal": "网关故障 {hits} 次",
			"row.serverErrorsTotalTitle": "本区域全部账号的上游 5xx 合计。同时给出两个数：本次宿主运行以来的次数（重启后从零开始），以及保存在磁盘上的累计次数（跨重启保留，重置冷却也不会清空）。",
			"row.modelCooling": "{model} 冷却至 {time}",
			"row.tokenExpiry": "令牌 {time}",
			"row.creditsTotal": "合计",
			"row.creditsPackages": "积分包",
			"row.creditsPackage": "{remain} / {size}",
			"row.creditsError": "积分不可用",
			"row.creditsSoon": "3 天内到期",
			"row.creditsExpiresAt": "到期 {time}",
			"row.creditsExpiresSoonTitle": "3 天内到期",
			"row.creditsRefreshAt": "刷新 {time}",
			"row.checkinTitle": "每日签到",
			"row.checkinClaim": "签到",
			"row.checkinClaiming": "签到中…",
			"row.checkinClaimed": "今日已签到",
			"row.checkinInactive": "该账号当前无签到活动",
			"row.checkinStreak": "连签 {days} 天",
			"row.checkinDaily": "每日 +{credit} 积分",
			"row.checkinStreakBonus": "第 {days} 天额外 +{credit}",
			"row.checkinClaimedReward": "已领取 +{credit} 积分",
			"row.checkinError": "签到失败：{message}",
			"row.checkinAllHint": "这里可以为每个账号分别领取每日签到奖励，无需先切换账号。",
			"row.modelsTitle": "模型",
			"row.modelsSummary": "实时目录中 {count} 个模型",
			"row.modelsHint": "读取自 WorkBuddy 实时目录；免费档位已标注。",
			"row.modelEnabled": "启用",
			"row.modelImage": "图片输入",
			"row.modelContextBudget": "上下文窗口",
			"row.modelContextNative": "{size}（最大）",
			"row.modelContextCapped": "{size}",
			"row.modelOutput": "输出 {size}",
			"row.modelReasoning": "思考档位：{efforts}",
			"row.modelsEnabledCount": "已启用 {enabled} / {total}",
			"row.modelsSave": "保存",
			"row.modelsSaving": "保存中…",
			"row.modelsDiscard": "放弃修改",
			"row.modelsSaved": "模型选择已保存",
			"row.modelsSaveError": "保存失败：{message}",
			"row.modelsEmpty": "至少要启用一个模型才能保存。",
			"row.free": "免费",
			"row.limitedFree": "限量免费",
			"row.nightDiscount": "夜间",
			"row.modelNoAccounts": "无可用账号",
			"row.modelNoAccountsHint": "该模型已启用，但所有账号当前都不可用——冷却中、已熔断，或恰好都在避开这个模型。此时请求会把整个池子试一遍才会报错。",
			"row.imageCapable": "图片输入",
			"row.rate": "{rate}x 积分",
			"row.rateUnknown": "成本未知",
			"row.rateUnknownHint": "上游没有为这个模型公布积分倍率，因此无法显示一次请求要花多少积分。它可能免费，也可能很贵——上游就是没有声明这个值。",
			"row.accountsRescan": "重新检测账号",

			"row.oauthAdd": "添加账号",
			"row.oauthHide": "收起",
			"row.oauthStarting": "正在获取…",
			"row.oauthHint": "打开下面的链接完成登录，登录成功后账号自动入库",
			"row.oauthDone": "已添加 {label}",
			"row.oauthAdded": "已添加 {label}",
			"row.oauthExpired": "链接已失效，请重新获取",
			"row.oauthRetry": "重新获取",
			"row.oauthClose": "关闭",

			"row.accountsScanning": "正在检测…",
			"row.distTitle": "账号使用方式",
			"row.distPriority": "优先模式",
			"row.distPriorityHint": "先用完一个账号，用完再换下一个",
			"row.distRoundRobin": "轮换模式",
			"row.distRoundRobinHint": "按顺序轮流使用，积分均匀分摊",
			"row.distBalanced": "均衡模式",
			"row.distBalancedHint": "随机抽取，闲置越久的账号被选中概率越高",
			"row.resetCooldowns": "清除所有冷却",
			"row.resetCooldownsBusy": "正在清除…",
			"row.resetCooldownsDone": "冷却已清除",
			"row.accountsRescanned": "检测到 {count} 个账号",
			"row.error": "池状态不可用：{message}",
			"row.autoTitle": "积分自动化",
			"row.autoOn": "已开启",
			"row.autoOff": "已关闭",
			"row.autoBusy": "保存中…",
			"row.autoHintOn": "每天自动签到、上报活跃、领取任务奖励与连登奖励，并照看猫猫旅行。",
			"row.autoHintOff": "已关闭：不会替你发起任何后台请求。",
			"row.autoJob_report": "活跃上报",
			"row.autoJob_tasks": "任务奖励",
			"row.autoJob_checkin": "每日签到",
			"row.autoJob_streak": "连登奖励",
			"row.autoJob_travel": "猫猫旅行",
			"row.autoHourNone": "当天不跑",
			"row.autoNever": "还没跑过",
			"row.autoRun": "立即运行",
			"row.autoRunning": "运行中…",
			"row.autoRan": "完成：{count} 个账号正常，{failed} 个失败",
			"row.autoRanTasks": "完成：领取 {claimed} 个任务，+{credit} 积分，+{energy} 能量",
			"row.reserveTitle": "保留积分",
			"row.reserveUnit": "积分",
			"row.reserveSaving": "保存中…",
			"row.reserveSave": "保存",
			"row.reserveHolding": "已保留·暂停使用",
			"row.reserveSaved": "已保留 {credits} 积分",
			"row.reserveCleared": "已取消保留",
			"row.reserveFailed": "保存失败，请重试",
			"row.autoToday": "今日自动化",
			"row.autoEarned": "今日自动化获得",
			"row.autoEnergy": "能量",
			"row.autoTasksClaimed": "{count} 个任务",
			"row.autoRunAll": "立即运行",
			"row.autoRunStarted": "自动化已开始执行 —— 后台会继续跑完，你可以直接关掉这个面板。",
			"row.autoAlreadyRunning": "已有一次执行正在进行",
			"row.autoRanAll": "已运行 {jobs} 项，{ok} 个正常，{failed} 个失败",
			"row.autoFromTasks": "任务 +{credit} 积分 · +{energy} 能量 · {count} 个",
			"row.autoFromCheckin": "签到 +{credit} 积分",
			"row.autoFromBonus": "连登奖励 +{credit} 积分",
			"row.autoFromTravel": "猫猫旅行 +{credit} 积分",

			"row.usageRemaining": "剩余积分",
			"row.usageToday": "今日消耗",
			"row.usageLast7": "近 7 天消耗",
			"row.usageMonth": "本月消耗",
			"row.usageSinceHint": "「剩余积分」来自 WorkBuddy；三个消耗数字由本插件自行累计，从它第一次读到余额的那天算起 —— WorkBuddy 没有提供消耗历史接口，因此那之前花掉的部分不会被计入。",
			"row.usageRecentNote": "消耗统计刚刚开始，尚未覆盖此前的支出，数字会从今天起逐步增长。",
			"row.trendTitle": "近 {days} 天",
			"row.trendTotal": "合计 {total}",
			"row.trendPeak": "峰值 {peak}",
			"row.trendBar": "{date}：{used}",
			"row.expirySoon": "有 {credits} 积分将在 {tail} 过期（涉及 {accounts} 个账号）。",
			"row.expiryIn": "{days} 天内（{time} 之前）",
			"row.expiryOn": "不晚于 {time}",
			"row.expiryNoneTitle": "最近 3 天内没有积分过期",
			"row.expiryCycling": "另有 {credits} 积分为按周期重置、而非过期",
			"row.expiryUnknown": "{accounts} 个账号余额暂时读不到",
			"row.healthHint": "健康度依据池子已有的信息判断。结论按严重程度分级列出，不折算成一个平均分：登录失效会让该账号在你重新登录前完全不可用，而限流冷却不到一分钟就会过去，两者不该混在一起平均。",
			"row.healthDisabled": "{label} 已停用",
			"row.healthTokenExpired": "{label} 需要重新登录",
			"row.healthCreditsUnreadable": "{label} 余额读取失败",
			"row.healthCheckinUnreadable": "{label} 签到状态读取失败",
			"row.healthRateLimited": "{label} 正处于限流冷却",
			"row.healthGatewayCooling": "{label} 因上游故障暂时让位",
			"row.healthNoCredits": "{label} 积分已用尽",

			"row.themeTitle": "主题",
			"row.themeSystem": "跟随系统",
			"row.themeLight": "浅色",
			"row.themeDark": "深色",
			"row.themeCycleHint": "切换主题：跟随系统 → 浅色 → 深色，循环切换；选择会记在本机。",

			"row.reqTitle": "请求记录",
			"row.reqSummary": "{count} 次请求 · {ok} 次成功",
			"row.reqEmpty": "暂无请求记录。",
			"row.reqColTime": "时间",
			"row.reqColModel": "模型",
			"row.reqColAccount": "账号",
			"row.reqColOutcome": "结果",
			"row.reqColTotal": "总耗时",
			"row.reqColFirstToken": "首字",
			"row.reqQueue": "排队",
			"row.reqThink": "上游思考",
			"row.reqGenerate": "生成",
			"row.queueTitle": "各模型排队时长",
			"row.queueColModel": "模型",
			"row.queueColSamples": "样本",
			"row.queueColP50": "中位",
			"row.queueColP95": "p95",
			"row.queueColSpeed": "tok/s",
			"row.queueColMax": "最大",
			"row.queueColAvg": "平均",
			"row.reqColTokens": "token",
			"row.reqColAttempts": "尝试",
			"row.reqOk": "成功",
			"row.reqPending": "进行中",
			"row.reqUnknown": "未知",
			"row.reqRotation": "依次 {accounts}",
			"row.reqFailedHint": "池子把这次请求判定为失败。"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-rotakit-client";
		/** Client services required by the Plugin configuration contribution. */
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		/** Register card copy and the pool card under Plugin configuration. */
		function apply(ctx) {
			try {
				const namespace = "settings.workbuddy-xdpool";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-rotakit: settings copy");
				const t = ctx.locale.bind(namespace);
				const settingsScope = ctx.configForms.get("llm-rotakit");
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "workbuddy-xdpool",
					order: 120,
					label: () => t("row.title"),
					inject: () => ({
						t,
						settingsScope
					})
				}, (props) => (0, react.createElement)(PoolCardErrorBoundary, null, (0, react.createElement)(PoolCard, props))));
			} catch (error) {
				console.error("[dsh-rotakit] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
