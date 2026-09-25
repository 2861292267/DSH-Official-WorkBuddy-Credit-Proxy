window.__ModuleLoader__.load({
	id: "dsh-workbuddy-xdpool",
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
		* WorkBuddy XD Pool settings card.
		*
		* Pool's runtime state already lives in `src/status.ts` (`buildStatus` /
		* `WorkBuddyStatus`); this module only carves the cross-domain (Host→browser)
		* JSON document into a shape that stays token-free and matches what the
		* browser card renders. Route paths are plugin-owned and mounted on the Host's
		* same-origin web server (see `src/web-status.ts`).
		*
		* @module dsh-workbuddy-xdpool/status-paths
		*/
		/** Plugin-owned read-only pool status endpoint (account rows + models + shim). */
		const POOL_STATUS_PATH = "/plugins/dsh-workbuddy-xdpool/status";
		/** Plugin-owned local account rescan endpoint (re-read desktop snapshots). */
		const POOL_RESCAN_PATH = "/plugins/dsh-workbuddy-xdpool/accounts/rescan";
		/** Plugin-owned cooldown reset endpoint (clear all 429 cooldowns). */
		const POOL_RESET_COOLDOWN_PATH = "/plugins/dsh-workbuddy-xdpool/cooldowns/reset";
		/** Plugin-owned daily check-in action endpoint (claim today's reward). */
		const POOL_CHECKIN_PATH = "/plugins/dsh-workbuddy-xdpool/checkin";
		/** Run one automation job immediately, so the card can verify it on demand. */
		const POOL_AUTOMATION_RUN_PATH = "/plugins/dsh-workbuddy-xdpool/automation/run";
		/** Set or clear one account's reserved-credit floor. */
		const POOL_CREDIT_RESERVE_PATH = "/plugins/dsh-workbuddy-xdpool/accounts/credit-reserve";

		/** [xdpool-oauth] Plugin-owned endpoint that opens one QR sign-in. */
		const OAUTH_START_PATH = "/plugins/dsh-workbuddy-xdpool/oauth/start";
		/** [xdpool-oauth] Plugin-owned endpoint that polls one QR sign-in. */
		const OAUTH_POLL_PATH = "/plugins/dsh-workbuddy-xdpool/oauth/poll";

		//#endregion
		//#region src/client/icon.ts
		/**
		* Plugin card icon (data URI) for the WorkBuddy XD Pool card.
		*
		* A neutral, dependency-free 24px “pool / droplet stack” glyph kept as an SVG
		* data URI so the browser half never needs an external asset. Three stacked
		* droplet outlines + an encompassing orbit mark read as “rotating accounts";
		* the line and fill colors stay inside the host’s accent family so the icon
		* sits naturally on the dark Plugin configuration surface.
		*
		* @module dsh-workbuddy-xdpool/client/icon
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
		* Client styles for the WorkBuddy XD Pool card.
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
		* @module dsh-workbuddy-xdpool/client/styles
		*/
		const POOL_CARD_CSS = `
/* Shell: same collapse affordance as every other plugin config row. */
.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-module-platform,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}
.dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}
.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}
.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;display:inline-flex;transition:transform .16s}
.dsm-plugin-card-chevron-open{transform:rotate(180deg)}
.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}
.dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}

/* Reusable button primitives shared with the rest of the card body. */
.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-btn:disabled{opacity:.4;cursor:default}
.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}
.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}
.dsm-btn-primary{background:var(--dsw-alias-label-primary,#e6e6e6);color:var(--dsw-alias-bg-layer-3,#202126)}
.dsm-btn-primary:hover:not(:disabled){opacity:.9}

/* Body layout: status row + accounts list + models list. */
.dsm-workbuddy-xdpool-usage{display:flex;flex-direction:column;gap:14px;margin:0;padding:14px 0 4px}
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
.dsm-workbuddy-xdpool-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
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
.dsm-workbuddy-xdpool-dist-option{appearance:none;font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:44px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;padding:6px 10px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}
.dsm-workbuddy-xdpool-dist-option:hover:not(:disabled):not(.dsm-workbuddy-xdpool-dist-option-active){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-workbuddy-xdpool-dist-option:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-xdpool-dist-option-active{background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.14));border-color:var(--dsw-alias-state-success-primary,#22a06b);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-dist-option:disabled{cursor:default;opacity:.6}
.dsm-workbuddy-xdpool-dist-option-name{font-size:11px;line-height:16px;font-weight:600}
.dsm-workbuddy-xdpool-dist-option-hint{font-size:10px;line-height:14px;opacity:.8}
.dsm-workbuddy-xdpool-dist-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dsm-workbuddy-xdpool-usage-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* Account list (each account = a labeled subpanel, same as dingminhua). */
.dsm-workbuddy-xdpool-accounts{display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:14px}
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
.dsm-workbuddy-xdpool-account{display:flex;flex-direction:column;gap:0;padding:0;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 55%, transparent);border-radius:16px;background:var(--dsw-alias-bg-layer-2,#24262c);box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden}
/* Body row inside a card: identity on the left, credit panels on the right. */
/* flex-wrap lets the panels drop below on a narrow card instead of squeezing both. */
.dsm-workbuddy-xdpool-account-body{display:flex;align-items:stretch;gap:0;flex-wrap:wrap}
.dsm-workbuddy-xdpool-account-copy{display:flex;flex-direction:column;align-items:flex-start;gap:6px;flex:1 1 200px;min-width:0;padding:14px 16px;justify-content:center}
.dsm-workbuddy-xdpool-account-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-account-head .dsm-workbuddy-xdpool-account-toggle{margin-left:auto}
.dsm-workbuddy-xdpool-account-head{display:flex;align-items:center;gap:10px;min-width:0;padding:12px 16px;border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}
/* Account switched off on the card: still listed (so it can be turned back on) but visually muted. */
.dsm-workbuddy-xdpool-account-off{opacity:.55}
/* Small pill switch: "in rotation" vs "off". Native checkbox styled by the label. */
.dsm-workbuddy-xdpool-account-toggle{appearance:none;font:inherit;display:inline-flex;align-items:center;gap:5px;cursor:pointer;flex:none;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 70%, transparent);border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}
.dsm-workbuddy-xdpool-account-toggle:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-workbuddy-xdpool-account-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
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

/* Two-column stats: packages on the left, total + check-in on the right. */
.dsm-workbuddy-xdpool-stats{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(168px,.85fr);gap:0;flex:1 1 420px;min-width:0;max-width:660px;border-left:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}
.dsm-workbuddy-xdpool-panel{display:flex;flex-direction:column;min-width:0;gap:7px;padding:14px 16px}
.dsm-workbuddy-xdpool-panel-title{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600}
.dsm-workbuddy-xdpool-panel-empty{color:var(--dsw-alias-label-tertiary,#999);font-size:14px;line-height:20px}
.dsm-workbuddy-xdpool-panel-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:18px;word-break:break-word}
.dsm-workbuddy-xdpool-panel-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-panel-foot strong{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-packages{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none}
/* One credit package: name + amount on the first line, its deadline beneath.
   A two-row grid keeps the columns aligned across rows; a wrapping flex row
   dropped the deadline onto a second line that started at the container edge,
   so the list read as ragged text rather than a table. */
.dsm-workbuddy-xdpool-packages li{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;row-gap:1px;align-items:baseline;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-packages-name{grid-column:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-packages-value{grid-column:2;justify-self:end;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-variant-numeric:tabular-nums}
/* Per-package deadline: the upstream grants one-off packs at arbitrary clock
   times, so each row carries its own timestamp; the soon ones are tinted and
   fold onto their own line so a long package name cannot squeeze them out. */
.dsm-workbuddy-xdpool-packages-when{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:15px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-packages-when-soon{color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-workbuddy-xdpool-panel-total{position:relative;align-items:center;text-align:center;justify-content:center;overflow:hidden;background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 5%, transparent)}
.dsm-workbuddy-xdpool-panel-total::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;opacity:.9;background:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-total-value{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:28px;line-height:32px;font-weight:800;letter-spacing:-.02em;white-space:nowrap;font-variant-numeric:tabular-nums}

/* Model directory list. */
.dsm-workbuddy-xdpool-models{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:14px}
.dsm-workbuddy-xdpool-models-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsm-workbuddy-xdpool-models-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-workbuddy-xdpool-models-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-workbuddy-xdpool-model-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}
.dsm-workbuddy-xdpool-model{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#232529);transition:opacity .16s}
.dsm-workbuddy-xdpool-model+.dsm-workbuddy-xdpool-model{border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-xdpool-model-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsm-workbuddy-xdpool-model-copy{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}
.dsm-workbuddy-xdpool-model-name{display:inline-flex;align-items:baseline;gap:7px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-model-name-rate{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:400;line-height:16px;flex:none}
.dsm-workbuddy-xdpool-model-id{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-workbuddy-xdpool-model-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-model-meta-tag{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:rgba(174,179,187,.11);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-xdpool-model-cap{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
/* Model row: checkbox + image toggle + context-budget radios. */
.dsm-workbuddy-xdpool-model-off{opacity:.55}
.dsm-workbuddy-xdpool-model-check{display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer}
.dsm-workbuddy-xdpool-model-check input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe);flex:none}
.dsm-workbuddy-xdpool-model-controls{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.dsm-workbuddy-xdpool-model-image{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-model-image input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-xdpool-model-budget{display:flex;align-items:center;gap:9px;flex:none;margin:0;padding:0;border:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-model-budget label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.dsm-workbuddy-xdpool-model-budget input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-workbuddy-xdpool-models-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsm-workbuddy-xdpool-models-actions{display:flex;align-items:center;gap:8px;flex:none}


/* Check-in docked under the total, inside the right-hand panel. */
.dsm-workbuddy-xdpool-checkin{display:flex;flex-direction:column;align-items:center;gap:7px;width:100%;margin-top:10px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-workbuddy-xdpool-checkin-meta{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%}
.dsm-workbuddy-xdpool-checkin-streak{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:17px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-checkin-daily{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-checkin-bonus{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:var(--dsw-alias-state-success-subtle,rgba(51,160,107,.14));color:var(--dsw-alias-state-success-primary,#22a06b);text-align:center}
.dsm-workbuddy-xdpool-checkin-btn{width:100%;padding:5px 10px;border-radius:8px;border:1px solid transparent;font-size:12px;font-weight:600;line-height:18px;cursor:pointer;background:var(--dsw-alias-state-success-primary,#22a06b);color:#fff;transition:opacity .16s,border-color .16s,background .16s}
.dsm-workbuddy-xdpool-checkin-btn:hover:not(:disabled){opacity:.88}
.dsm-workbuddy-xdpool-checkin-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
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
.dsm-workbuddy-xdpool-auto{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-module-platform,#202126)}
.dsm-workbuddy-xdpool-auto-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsm-workbuddy-xdpool-auto-title{color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-weight:600}
.dsm-workbuddy-xdpool-auto-switch{padding:3px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;cursor:pointer;transition:color .16s,border-color .16s,background .16s}
.dsm-workbuddy-xdpool-auto-switch:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#777);color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-workbuddy-xdpool-auto-switch:disabled{opacity:.5;cursor:not-allowed}
.dsm-workbuddy-xdpool-auto-switch-on{border-color:#28c8b4;color:#28c8b4;background:rgba(40,200,180,.12)}
.dsm-workbuddy-xdpool-auto-hint{margin:6px 0 0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:1.6}
.dsm-workbuddy-xdpool-auto-total{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:8px;padding:6px 8px;border-radius:8px;background:rgba(40,200,180,.08);font-size:11px}
.dsm-workbuddy-xdpool-auto-total-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}
.dsm-workbuddy-xdpool-auto-total{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:6px 8px;border-radius:8px;background:rgba(40,200,180,.08);font-size:11px}
.dsm-workbuddy-xdpool-auto-total-list{display:flex;flex-direction:column;gap:2px}
.dsm-workbuddy-xdpool-auto-total-row{color:#28c8b4;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-earned{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px}
.dsm-workbuddy-xdpool-earned-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}
.dsm-workbuddy-xdpool-earned-list{display:flex;flex-direction:column;gap:2px}
.dsm-workbuddy-xdpool-earned-row{color:#28c8b4;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-earned-value{color:#28c8b4;font-weight:600;font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-auto-jobs{margin-top:8px;display:flex;flex-direction:column;gap:4px}
.dsm-workbuddy-xdpool-auto-job{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-workbuddy-xdpool-auto-job-name{flex:0 0 auto;min-width:72px;color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}
.dsm-workbuddy-xdpool-auto-job-when{flex:1 1 auto;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums}
.dsm-workbuddy-xdpool-auto-job-last{flex:0 0 auto;text-align:right;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsm-workbuddy-xdpool-auto-job-note{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* Reserved credits: one inline number field per account. */
.dsm-workbuddy-xdpool-reserve{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px;color:var(--dsw-alias-label-dimmed,#8a97b5)}
.dsm-workbuddy-xdpool-reserve-label{flex:0 0 auto}
.dsm-workbuddy-xdpool-reserve-input{width:84px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-variant-numeric:tabular-nums;transition:border-color .16s,background .16s}
.dsm-workbuddy-xdpool-reserve-input:focus{outline:none;border-color:var(--dsw-alias-state-success-primary,#22a06b);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 7%, transparent)}
.dsm-workbuddy-xdpool-reserve-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-workbuddy-xdpool-reserve-input:disabled{opacity:.6}
.dsm-workbuddy-xdpool-reserve-unit{flex:0 0 auto}
.dsm-workbuddy-xdpool-reserve-badge{flex:0 0 auto;padding:1px 7px;border-radius:999px;background:rgba(232,90,90,.14);color:#e85a5a;font-size:10px}
/* Explicit Save: the field is a draft, so the button (not a blur) is what
   commits it — and the outcome is reported right here, next to the control. */
.dsm-workbuddy-xdpool-reserve-save{flex:0 0 auto;appearance:none;font:inherit;font-size:11px;font-weight:600;line-height:16px;padding:3px 12px;border-radius:6px;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);cursor:pointer;transition:opacity .16s,background .16s,border-color .16s,color .16s}
.dsm-workbuddy-xdpool-reserve-save:hover:not(:disabled){background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 24%, transparent);border-color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-reserve-save:disabled{cursor:default;border-color:var(--dsw-alias-border-l2,#3a3d45);background:transparent;color:var(--dsw-alias-label-tertiary,#8a90a0);opacity:.75}
.dsm-workbuddy-xdpool-reserve-note{flex:0 0 auto;font-size:11px;line-height:16px}
.dsm-workbuddy-xdpool-reserve-note-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-workbuddy-xdpool-reserve-note-bad{color:var(--dsw-alias-state-error-primary,#ef4444);font-weight:600}

/* Headline usage bar: four equal columns over one rounded surface, sitting at
   the very top of the card body. Every colour comes from the host tokens, so the
   same rules read correctly on the dark module surface and on a light theme. */
.dsm-workbuddy-xdpool-usagebar{display:flex;align-items:stretch;gap:0;margin:12px 0 0;padding:0;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#25262b);overflow:hidden}
.dsm-workbuddy-xdpool-usagebar-cell{display:flex;flex-direction:column;gap:5px;flex:1 1 0;min-width:0;padding:11px 14px}
.dsm-workbuddy-xdpool-usagebar-head{display:flex;align-items:center;gap:5px;min-width:0}
.dsm-workbuddy-xdpool-usagebar-glyph{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-workbuddy-xdpool-usagebar-label{color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-xdpool-usagebar-value{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:22px;line-height:26px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
.dsm-workbuddy-xdpool-usagebar-cell + .dsm-workbuddy-xdpool-usagebar-cell{border-left:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 60%, transparent)}
.dsm-workbuddy-xdpool-usagebar-note{margin:6px 2px 0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px}
@media (max-width:760px){
  .dsm-workbuddy-xdpool-usagebar{flex-wrap:wrap}
  .dsm-workbuddy-xdpool-usagebar-cell{flex:1 1 44%}
  .dsm-workbuddy-xdpool-usagebar-cell:nth-child(odd){border-left:0}
  .dsm-workbuddy-xdpool-usagebar-cell:nth-child(n+3){border-top:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 60%, transparent)}
}
`.trim();
		//#endregion
		//#region src/client/PoolCard.tsx
		/**
		* WorkBuddy XD Pool card contributed to DSH Plugin configuration.
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
		* @module dsh-workbuddy-xdpool/client/PoolCard
		*/
		/**
		* Default context window the card offers as the "capped" choice, in tokens.
		* Mirrors the host-side DEFAULT_CONTEXT_BUDGET; declared here rather than
		* imported, because the browser bundle must not pull in the host entry.
		*/
		const DEFAULT_CONTEXT_BUDGET = 2e5;
		const POLL_INTERVAL_MS = 3e4;
		/** Inject or refresh the shared card CSS for the current client bundle. */
		if (typeof document !== "undefined") {
			const cssId = "dsh-workbuddy-xdpool/client.css";
			const existing = document.querySelector(`style[data-plugin-css="${cssId}"]`);
			if (existing !== null) existing.textContent = POOL_CARD_CSS;
			else {
				const styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-workbuddy-xdpool";
				styleTag.dataset.pluginCss = cssId;
				styleTag.textContent = POOL_CARD_CSS;
				document.head.appendChild(styleTag);
			}
		}
		function formatNumber(value) {
			if (value === void 0) return "–";
			return new Intl.NumberFormat(void 0, { maximumFractionDigits: 0 }).format(value);
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
		function dotColor(status) {
			return status === "ok" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #ef4444)" : "var(--dsw-alias-label-dimmed, #9aa0a6)";
		}
		function formatCapacity(value) {
			if (value === void 0) return "";
			if (value >= 1e6 && value % 1e6 === 0) return `${value / 1e6}M`;
			if (value >= 1e3 && value % 1e3 === 0) return `${value / 1e3}K`;
			return String(value);
		}
		/** Build the draft from the server's selection + catalog flags. */
		function draftFromStatus(status) {
			const selection = status.selection;
			const enabled = selection.enabledModelIds;
			const images = selection.imageModelIds;
			const budgets = selection.contextBudgets;
			const out = {};
			for (const model of status.models) {
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
		/** True when the draft differs from what the server last reported. */
		function draftIsDirty(status, draft) {
			const selection = status.selection;
			const enabled = new Set(selection.enabledModelIds ?? status.models.filter((m) => m.enabled).map((m) => m.id));
			const images = new Set(selection.imageModelIds ?? status.models.filter((m) => m.supportsImages).map((m) => m.id));
			const budgets = selection.contextBudgets ?? {};
			for (const model of status.models) {
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
		function formatExpiry(ms) {
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
		/** True when a one-off package lapses inside the "expiring soon" window. */
		function isExpiringSoon(pack) {
			if (pack.monthly === true) return false;
			const days = daysUntil(pack.expiresAtMs);
			return days !== void 0 && days <= 3;
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
				console.error("[dsh-workbuddy-xdpool] card render error:", err);
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
			const [open, setOpen] = (0, react.useState)(false);
			/**
			* Last-known status per region. Kept per region (not a single slot) so
			* switching tabs shows the other side's last answer immediately instead of
			* a blank frame, and the tab dots stay meaningful while a tab is hidden.
			*/
			const [statusByRegion, setStatusByRegion] = (0, react.useState)({});
			/** The document for the tab on screen; undefined until its first answer. */
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
			const title = t?.("row.title") ?? "WorkBuddy XD Pool";
			const description = t?.("row.desc") ?? "";
			const accountCount = status?.accounts.length ?? 0;
			const cooling = status?.cooling ?? 0;
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
								children: status?.regions.map((region) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
										color: "var(--dsw-alias-brand-primary, #5686fe)"
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
							activeRegion !== "cn" || status?.automation === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
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
								className: "dsm-workbuddy-xdpool-accounts",
								"aria-label": t?.("row.accountsTitle") ?? "Accounts",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-accounts-head",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: "dsm-workbuddy-xdpool-accounts-title",
											children: t?.("row.accountsTitle") ?? "Accounts in the pool"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-xdpool-accounts-summary",
											children: t?.("row.accountsSummary", {
												count: accountCount,
												cooling
											}) ?? `${accountCount} account(s) · ${cooling} cooling`
										})]
									}),
									(() => {
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
									})(),
									status?.accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountBlock, {
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
									}, account.id))
								]
							}) : null,
							(status?.models.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: "dsm-workbuddy-xdpool-models",
								"aria-label": t?.("row.modelsTitle") ?? "Models",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-workbuddy-xdpool-models-head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-workbuddy-xdpool-models-heading",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: "dsm-workbuddy-xdpool-models-title",
											children: t?.("row.modelsTitle") ?? "Models"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-workbuddy-xdpool-models-summary",
											children: t?.("row.modelsEnabledCount", {
												enabled: enabledCount,
												total: status?.models.length ?? 0
											}) ?? `${enabledCount} / ${status?.models.length ?? 0} enabled`
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
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-workbuddy-xdpool-model-list",
									children: status?.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
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
								})]
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
			const tag = isCooling ? {
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
								isCooling && cooldownUntil !== void 0 && !Number.isNaN(cooldownUntil) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-workbuddy-xdpool-account-meta",
									children: [
										t?.("row.cooldownUntil", { time: formatTime(cooldownUntil) }) ?? `until ${formatTime(cooldownUntil)}`,
										" · ",
										t?.("row.cooldownHits", { hits: account.rateLimitHits ?? 0 }) ?? `${account.rateLimitHits ?? 0} hit(s)`
									]
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
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
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-workbuddy-xdpool-reserve-unit",
						children: t?.("row.reserveUnit") ?? "credits"
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
					className: "dsm-workbuddy-xdpool-usagebar-cell",
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
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-packages-name",
										children: pack.packageName
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-workbuddy-xdpool-packages-value",
										children: t?.("row.creditsPackage", {
											remain: formatNumber(pack.remain),
											size: formatNumber(pack.size)
										}) ?? `${formatNumber(pack.remain)} / ${formatNumber(pack.size)}`
									}),
									when === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `dsm-workbuddy-xdpool-packages-when${soon ? " dsm-workbuddy-xdpool-packages-when-soon" : ""}`,
										title: t?.("row.creditsExpiresSoonTitle") ?? "Expiring within 3 days",
										children: when
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
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), model.multiplier === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-workbuddy-xdpool-model-name-rate",
									children: t?.("row.rate", { rate: model.multiplier.toFixed(2) }) ?? `${model.multiplier.toFixed(2)}x`
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-workbuddy-xdpool-model-id",
								children: model.id
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
						tagText === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-workbuddy-xdpool-model-meta-tag",
							children: tagText
						}),
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
		//#endregion
		//#region src/client/locales.ts
		/**
		* Plugin-card copy registered under the `settings.workbuddy-xdpool` locale
		* namespace. Key lists in `en` and `zh` are kept 1:1 by typing `zh` against
		* the key set of `en`.
		*
		* @module dsh-workbuddy-xdpool/client/locales
		*/
		const en = {
			"row.title": "WorkBuddy XD Pool (dsh-workbuddy-xdpool)",
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
			"row.tabCn": "国内版",
			"row.tabGlobal": "国际版",
			"row.tabHint": "每个 tab 是一个独立供应商，各有自己的账号、积分与模型；两边同时生效，一侧的改动不影响另一侧。",
			"row.accountsSummary": "{count} account(s) · {cooling} cooling",
			"row.ok": "Healthy — requests auto-rotate across accounts",
			"row.allCooling": "Every account is rate-limited right now; requests pause until a cooldown lifts.",
			"row.accountInRotation": "Enabled",
			"row.accountOff": "Disabled",
			"row.accountToggleHint": "Enable this account (uncheck to keep it out of the pool)",
			"row.accountToggleError": "Could not switch the account: {message}",
			"row.currentAccount": "In use now",
			"row.currentAccountDisabled": "switched off — the next request moves on",
			"row.cooling": "Cooling (rate-limited)",
			"row.cooldownHits": "{hits} hit(s)",
			"row.cooldownUntil": "until {time}",
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
			"row.imageCapable": "image input",
			"row.rate": "{rate}x credits",
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
			"row.usageRecentNote": "Consumption figures were only started recently, so they still miss earlier spending and will grow from here."
		};
		const zh = {
			"row.title": "WorkBuddy 池（dsh-workbuddy-xdpool）",
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
			"row.ok": "运行健康 —— 请求会在各账号间自动轮换",
			"row.allCooling": "当前所有账号都处于限流冷却，请求会暂停直到某个冷却结束。",
			"row.accountInRotation": "已启用",
			"row.accountOff": "已停用",
			"row.accountToggleHint": "启用该账号（取消勾选则不参与池子）",
			"row.accountToggleError": "切换账号失败：{message}",
			"row.currentAccount": "当前使用",
			"row.currentAccountDisabled": "已停用 —— 下次请求会换号",
			"row.cooling": "冷却中（被限流）",
			"row.cooldownHits": "触发 {hits} 次",
			"row.cooldownUntil": "至 {time}",
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
			"row.imageCapable": "图片输入",
			"row.rate": "{rate}x 积分",
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
			"row.usageRecentNote": "消耗统计刚刚开始，尚未覆盖此前的支出，数字会从今天起逐步增长。"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-workbuddy-xdpool-client";
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
				}), "dsh-workbuddy-xdpool: settings copy");
				const t = ctx.locale.bind(namespace);
				const settingsScope = ctx.configForms.get("llm-workbuddy-xdpool");
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
				console.error("[dsh-workbuddy-xdpool] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
