window.__ModuleLoader__.load({
	id: "dsh-rotakit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");

		//#region src/ui-tokens
		/**
		 * RotaKit 新 UI · 设计令牌与样式表
		 *
		 * 规范来源：docs/05-新UI设计语言.md
		 * 验算工具：tools/check-contrast.mjs（34/34 通过）
		 *
		 * 设计取向（跨品类取材，不是"又一个账号池面板"）：
		 *   运维控制台的信息密度 + 监控大盘的趋势表达 + 本地工具的即时性
		 *
		 * 三条不可协商：
		 *   P1 密度优先，但每屏只留一个主角
		 *   P2 状态必须"颜色+图标+文字"三件套，颜色永不是唯一信号
		 *   P3 不闪烁
		 *
		 * 2.4.0 相对 2.3.x 的三个变化：
		 *   · 修掉 `.rk-search input` 未闭合导致其后全部样式失效的括号 bug
		 *   · 密度改为自适应：宽屏紧凑、窄屏舒适（用户选择，见 §12）
		 *   · 补全五页所需的 shell / 密钥 / 审计 / 抽屉样式
		 *
		 * @module dsh-rotakit/client/tokens
		 */
		
		/** 命名空间前缀。与宿主 --dsw-alias-* 不冲突。 */
		const NS = 'rk';
		
		/**
		 * 令牌 + 基础样式。
		 *
		 * 为什么把令牌和组件样式放同一个字符串：
		 * 它们在同一个作用域内互相引用（组件样式直接读令牌），
		 * 拆成两份反而要在构建期做拼接，而这个项目没有构建链（见 docs/01 §0）。
		 * 注入时整体一个 <style> 标签，由外壳负责。
		 */
		const RK_CSS = `
		/* ===========================================================
		   第 1 层 · 令牌（暗色）
		   只允许下层引用上层；组件样式直接写 hex 视为 bug
		   =========================================================== */
		
		.rk-root {
		  /* -- 表面：数字越大越"浮起" -- */
		  --rk-surface-0: #0d0f12;
		  --rk-surface-1: #14171c;
		  --rk-surface-2: #1a1e24;
		  --rk-surface-3: #22272f;
		  --rk-surface-4: #2b3139;
		  --rk-surface-5: #343b45;
		
		  /* -- 文字：对比度递减（验算见 check-contrast.mjs）-- */
		  --rk-fg-1: #e8eaed;
		  --rk-fg-2: #a8b0ba;
		  --rk-fg-3: #838d99;
		  --rk-fg-4: #4a525b;
		
		  /* -- 线 -- */
		  --rk-line: #2b3139;
		  --rk-line-strong: #3a424d;
		
		  /* -- 语义色：五档 + 未知 -- */
		  --rk-ok-bg: rgba(52, 199, 123, .14);
		  --rk-ok-fg: #4ade80;
		  --rk-ok-line: rgba(52, 199, 123, .30);
		  --rk-warn-bg: rgba(245, 166, 35, .14);
		  --rk-warn-fg: #fbbf24;
		  --rk-warn-line: rgba(245, 166, 35, .30);
		  --rk-bad-bg: rgba(239, 68, 68, .14);
		  --rk-bad-fg: #f87171;
		  --rk-bad-line: rgba(239, 68, 68, .30);
		  --rk-info-bg: rgba(59, 130, 246, .14);
		  --rk-info-fg: #7cb0ff;
		  --rk-info-line: rgba(59, 130, 246, .30);
		  --rk-idle-bg: rgba(148, 163, 184, .12);
		  --rk-idle-fg: #94a3b8;
		  --rk-idle-line: rgba(148, 163, 184, .24);
		  --rk-unknown-fg: #848484;
		
		  --rk-accent: #5686fe;
		  --rk-accent-bg: rgba(86, 134, 254, .14);
		  --rk-focus-color: #7cb0ff;
		
		  /* -- 间距：4px 基数，小值给到 2px -- */
		  --rk-sp-1: 2px;
		  --rk-sp-2: 4px;
		  --rk-sp-3: 6px;
		  --rk-sp-4: 8px;
		  --rk-sp-5: 12px;
		  --rk-sp-6: 16px;
		  --rk-sp-7: 20px;
		  --rk-sp-8: 24px;
		  --rk-sp-9: 32px;
		  --rk-sp-10: 40px;
		
		  /* -- 字号 -- */
		  --rk-fs-2xs: 10px;
		  --rk-fs-xs: 11px;
		  --rk-fs-md: 12px;
		  --rk-fs-sm: 12px;
		  --rk-fs-base: 13px;
		  --rk-fs-lg: 15px;
		  --rk-fs-xl: 20px;
		  --rk-fs-2xl: 28px;
		
		  /* -- 行高：无单位，对齐 4px 网格 -- */
		  --rk-lh-tight: 1.25;
		  --rk-lh-compact: 1.3;
		  --rk-lh-snug: 1.43;
		  --rk-lh-normal: 1.5;
		  --rk-lh-heading: 1.2;
		
		  /* -- 行高（表格）：宽屏紧凑 -- */
		  --rk-row-h: 30px;
		  --rk-cell-pad: 10px;
		  --rk-pad: 14px;
		
		  /* -- 圆角（Atlassian 官方映射）-- */
		  --rk-r-xs: 2px;
		  --rk-r-sm: 4px;
		  --rk-r-md: 6px;
		  --rk-r-lg: 8px;
		  --rk-r-xl: 12px;
		  --rk-r-full: 999px;
		
		  --rk-bw: 1px;
		  --rk-bw-strong: 2px;
		  --rk-focus-width: 2px;
		  --rk-focus-offset: 2px;
		
		  --rk-shadow-1: 0 1px 2px rgba(0, 0, 0, .24);
		  --rk-shadow-2: 0 4px 12px rgba(0, 0, 0, .32);
		
		  --rk-dur-fast: 70ms;
		  --rk-dur-base: 150ms;
		  --rk-dur-slow: 240ms;
		  --rk-ease: cubic-bezier(.2, 0, .38, .9);
		  --rk-ease-in: cubic-bezier(0, 0, .38, .9);
		  --rk-ease-out: cubic-bezier(.2, 0, 1, .9);
		
		  --rk-font-num: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
		  --rk-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
		    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif;
		
		  --rk-z-sticky: 10;
		  --rk-z-drawer: 40;
		  --rk-z-modal: 50;
		}
		
		/* 亮色：两套独立取色，共用同一组语义名（不是把暗色取反） */
		.rk-root[data-rk-theme="light"] {
		  --rk-surface-0: #ffffff;
		  --rk-surface-1: #f7f8fa;
		  --rk-surface-2: #eef0f4;
		  --rk-surface-3: #e5e8ed;
		  --rk-surface-4: #dbe0e7;
		  --rk-surface-5: #cfd5dd;
		
		  --rk-fg-1: #1a1d21;
		  --rk-fg-2: #4a525d;
		  --rk-fg-3: #61697a;
		  --rk-fg-4: #9aa1ab;
		
		  --rk-line: #e2e6eb;
		  --rk-line-strong: #ccd3dc;
		
		  --rk-ok-bg: rgba(21, 127, 61, .10);
		  --rk-ok-fg: #157f3d;
		  --rk-ok-line: rgba(21, 127, 61, .26);
		  --rk-warn-bg: rgba(161, 92, 7, .10);
		  --rk-warn-fg: #a15c07;
		  --rk-warn-line: rgba(161, 92, 7, .26);
		  --rk-bad-bg: rgba(198, 40, 40, .10);
		  --rk-bad-fg: #c62828;
		  --rk-bad-line: rgba(198, 40, 40, .26);
		  --rk-info-bg: rgba(29, 99, 210, .10);
		  --rk-info-fg: #1d63d2;
		  --rk-info-line: rgba(29, 99, 210, .26);
		  --rk-idle-bg: rgba(100, 116, 139, .10);
		  --rk-idle-fg: #5b6879;
		  --rk-idle-line: rgba(100, 116, 139, .22);
		  --rk-unknown-fg: #6b7280;
		
		  --rk-accent: #2f6bec;
		  --rk-accent-bg: rgba(47, 107, 236, .10);
		  --rk-focus-color: #2f6bec;
		
		  --rk-shadow-1: 0 1px 2px rgba(16, 24, 40, .06);
		  --rk-shadow-2: 0 4px 12px rgba(16, 24, 40, .10);
		}
		
		/* ===========================================================
		   第 2 层 · 基础
		   =========================================================== */
		
		.rk-root {
		  container-type: inline-size;
		  container-name: rk;
		
		  font-family: var(--rk-font-ui);
		  font-size: var(--rk-fs-base);
		  line-height: var(--rk-lh-snug);
		  color: var(--rk-fg-1);
		  background: var(--rk-surface-0);
		  border-radius: var(--rk-r-xl);
		  border: var(--rk-bw) solid var(--rk-line);
		  overflow: hidden;
		  box-sizing: border-box;
		  min-height: 420px;
		  display: flex;
		  flex-direction: column;
		}
		.rk-root *, .rk-root *::before, .rk-root *::after { box-sizing: border-box; }
		
		/* 焦点环：圆角 = 组件圆角 + 2px，否则圆角处会被切（Atlassian 做法） */
		.rk-root :where(a, button, input, select, textarea, [tabindex]):focus-visible {
		  outline: var(--rk-focus-width) solid var(--rk-focus-color);
		  outline-offset: var(--rk-focus-offset);
		  border-radius: calc(var(--rk-r-md) + 2px);
		}
		
		.rk-num {
		  font-variant-numeric: tabular-nums;
		  font-family: var(--rk-font-num);
		}
		.rk-sr {
		  position: absolute; width: 1px; height: 1px;
		  clip-path: inset(50%); overflow: hidden; white-space: nowrap;
		}
		
		/* ===========================================================
		   第 3 层 · 外壳与导航
		   =========================================================== */
		
		.rk-top {
		  display: flex; align-items: center; gap: var(--rk-sp-5);
		  padding: var(--rk-sp-4) var(--rk-sp-6);
		  border-bottom: var(--rk-bw) solid var(--rk-line);
		  background: var(--rk-surface-1);
		  flex-wrap: wrap;
		}
		.rk-brand { display: flex; align-items: center; gap: var(--rk-sp-4); min-width: 0; }
		.rk-brand-mark {
		  width: 22px; height: 22px; border-radius: var(--rk-r-md);
		  background: var(--rk-accent); color: #fff;
		  display: inline-flex; align-items: center; justify-content: center;
		  font-size: var(--rk-fs-md); font-weight: 700; flex: none;
		}
		.rk-brand-name { font-size: var(--rk-fs-lg); font-weight: 600; color: var(--rk-fg-1); }
		.rk-brand-sub { font-size: var(--rk-fs-xs); color: var(--rk-fg-3); }
		
		/* 运行状态点：靠颜色传信息，所以必须 >=3:1（WCAG 1.4.11） */
		.rk-dot {
		  width: 7px; height: 7px; border-radius: var(--rk-r-full);
		  flex: none; background: var(--rk-idle-fg);
		}
		.rk-dot--ok { background: var(--rk-ok-fg); }
		.rk-dot--bad { background: var(--rk-bad-fg); }
		.rk-dot--warn { background: var(--rk-warn-fg); }
		
		/* 页面导航：宽屏横排铺满、窄屏横滚 */
		.rk-nav {
		  display: flex; gap: var(--rk-sp-1);
		  padding: var(--rk-sp-2) var(--rk-sp-3);
		  background: var(--rk-surface-2);
		  border-radius: var(--rk-r-md);
		  border: var(--rk-bw) solid var(--rk-line);
		  overflow-x: auto;
		  flex: 1 1 auto;
		  min-width: 0;
		}
		.rk-nav-btn {
		  appearance: none; border: 0; background: transparent;
		  color: var(--rk-fg-2); font: inherit; font-size: var(--rk-fs-md);
		  padding: var(--rk-sp-2) var(--rk-sp-4);
		  border-radius: var(--rk-r-sm); cursor: pointer; white-space: nowrap;
		  transition: background-color var(--rk-dur-fast) var(--rk-ease),
		              color var(--rk-dur-fast) var(--rk-ease);
		  display: inline-flex; align-items: center; gap: var(--rk-sp-2);
		  flex: 1 1 auto;
		  justify-content: center;
		}
		.rk-nav-btn:hover { color: var(--rk-fg-1); background: var(--rk-surface-3); }
		.rk-nav-btn[aria-selected="true"] {
		  background: var(--rk-surface-4); color: var(--rk-fg-1); font-weight: 600;
		}
		.rk-nav-count {
		  font-size: var(--rk-fs-2xs); color: var(--rk-fg-3);
		  font-variant-numeric: tabular-nums;
		}
		.rk-nav-btn[aria-selected="true"] .rk-nav-count { color: var(--rk-fg-2); }
		
		.rk-top-actions { display: flex; align-items: center; gap: var(--rk-sp-2); flex: none; }
		
		/* ===========================================================
		   第 4 层 · 布局
		   =========================================================== */
		
		.rk-body {
		  padding: var(--rk-pad);
		  flex: 1 1 auto;
		  overflow: auto;
		}
		.rk-page { display: none; }
		.rk-page[data-active="true"] { display: block; }
		.rk-page > * + * { margin-top: var(--rk-sp-6); }
		.rk-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--rk-sp-6); }
		.rk-grid-side { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--rk-sp-6); align-items: start; }
		.rk-stack { display: flex; flex-direction: column; gap: var(--rk-sp-5); }
		.rk-inline { display: flex; align-items: center; gap: var(--rk-sp-3); flex-wrap: wrap; }
		.rk-spacer { flex: 1 1 auto; }
		
		/* ===========================================================
		   第 5 层 · 卡片与区块
		   =========================================================== */
		
		.rk-card {
		  background: var(--rk-surface-1);
		  border: var(--rk-bw) solid var(--rk-line);
		  border-radius: var(--rk-r-lg);
		  overflow: hidden;
		}
		.rk-card-head {
		  display: flex; align-items: center; gap: var(--rk-sp-4);
		  padding: var(--rk-sp-3) var(--rk-sp-4);
		  border-bottom: var(--rk-bw) solid var(--rk-line);
		  background: var(--rk-surface-2);
		  flex-wrap: wrap;
		}
		.rk-card-title {
		  font-size: var(--rk-fs-md); font-weight: 600; color: var(--rk-fg-1);
		  margin: 0; letter-spacing: .01em;
		}
		.rk-card-sub { font-size: var(--rk-fs-xs); color: var(--rk-fg-3); }
		.rk-card-body { padding: var(--rk-sp-5); }
		.rk-card-foot {
		  padding: var(--rk-sp-3) var(--rk-sp-4);
		  border-top: var(--rk-bw) solid var(--rk-line);
		  background: var(--rk-surface-2);
		  font-size: var(--rk-fs-xs); color: var(--rk-fg-3);
		}
		
		/* ===========================================================
		   第 6 层 · 指标
		   =========================================================== */
		
		.rk-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--rk-sp-5); }
		
		.rk-metric {
		  background: var(--rk-surface-1);
		  border: var(--rk-bw) solid var(--rk-line);
		  border-radius: var(--rk-r-lg);
		  padding: var(--rk-sp-4) var(--rk-sp-5);
		  display: flex; flex-direction: column; gap: var(--rk-sp-2);
		  min-width: 0;
		}
		.rk-metric-label { font-size: var(--rk-fs-xs); color: var(--rk-fg-3); }
		.rk-metric-row { display: flex; align-items: baseline; gap: var(--rk-sp-3); }
		.rk-metric-value {
		  font-size: var(--rk-fs-2xl); line-height: var(--rk-lh-heading);
		  font-weight: 600; color: var(--rk-fg-1);
		  font-variant-numeric: tabular-nums;
		  font-family: var(--rk-font-num);
		}
		.rk-metric-unit { font-size: var(--rk-fs-xs); color: var(--rk-fg-3); }
		
		/* 趋势箭头：颜色方向按指标语义配（取自 Datadog directionality） */
		.rk-trend { font-size: var(--rk-fs-xs); font-weight: 600; display: inline-flex; align-items: center; gap: var(--rk-sp-1); }
		.rk-trend--good { color: var(--rk-ok-fg); }
		.rk-trend--bad { color: var(--rk-bad-fg); }
		.rk-trend--flat { color: var(--rk-fg-3); }
		
		/* 迷你趋势条：14 天消耗，纯 CSS 高度，无图表依赖 */
		.rk-spark { display: flex; align-items: flex-end; gap: 2px; height: 26px; margin-top: var(--rk-sp-2); }
		.rk-spark-bar {
		  flex: 1 1 0; min-width: 3px;
		  background: var(--rk-accent-bg);
		  border-radius: 1px 1px 0 0;
		  position: relative;
		}
		.rk-spark-bar--today { background: var(--rk-accent); }
		.rk-spark-bar--zero { background: var(--rk-surface-3); }
		
		/* ===========================================================
		   第 7 层 · 表格
		   =========================================================== */
		
		/* 滚动必须限定在容器内，不能整页双向滚动（WCAG 1.4.10） */
		.rk-table-wrap { overflow: auto; max-height: 520px; }
		
		.rk-table { width: 100%; border-collapse: collapse; font-size: var(--rk-fs-md); }
		
		.rk-table thead th {
		  position: sticky; top: 0; z-index: var(--rk-z-sticky);
		  background: var(--rk-surface-2);
		  text-align: left; font-weight: 600; font-size: var(--rk-fs-xs);
		  color: var(--rk-fg-3);
		  padding: 0 var(--rk-cell-pad); height: 30px;
		  border-bottom: var(--rk-bw) solid var(--rk-line);
		  white-space: nowrap;
		}
		.rk-table thead th[aria-sort] { cursor: pointer; user-select: none; }
		.rk-table thead th[aria-sort="ascending"],
		.rk-table thead th[aria-sort="descending"] { background: var(--rk-surface-3); color: var(--rk-fg-1); }
		.rk-table thead th[aria-sort]:hover { color: var(--rk-fg-1); }
		
		/* 行高 30px：金融表格 28-32、自托管 40-48，30 是宽屏密度的下限 */
		.rk-table tbody tr {
		  height: var(--rk-row-h);
		  transition: background-color var(--rk-dur-fast) var(--rk-ease);
		}
		.rk-table tbody td {
		  padding: 0 var(--rk-cell-pad);
		  border-bottom: var(--rk-bw) solid var(--rk-line);
		  color: var(--rk-fg-2);
		  white-space: nowrap;
		  overflow: hidden; text-overflow: ellipsis;
		  max-width: 0;
		}
		.rk-table tbody tr:hover { background: var(--rk-surface-3); }
		/* 选中：背景 + 左侧强调条双线索（不靠单一颜色） */
		.rk-table tbody tr[aria-selected="true"] { background: var(--rk-surface-4); }
		.rk-table tbody tr[aria-selected="true"] td:first-child {
		  box-shadow: inset var(--rk-bw-strong) 0 0 var(--rk-accent);
		}
		.rk-table .rk-col-num { text-align: right; }
		.rk-table .rk-cell-empty::after { content: "-"; color: var(--rk-fg-4); }
		.rk-table td.rk-col-id { color: var(--rk-fg-3); font-family: var(--rk-font-num); font-size: var(--rk-fs-xs); }
		
		/* 操作列：默认隐藏，hover 或键盘 focus-within 时显现 */
		.rk-col-actions { width: 92px; text-align: right; }
		.rk-row-action { opacity: 0; transition: opacity var(--rk-dur-fast) var(--rk-ease); }
		.rk-table tbody tr:hover .rk-row-action,
		.rk-table tbody tr:focus-within .rk-row-action { opacity: 1; }
		@media (hover: none) {
		  /* 触屏设备没有 hover：常显，否则操作永远点不到 */
		  .rk-row-action { opacity: 1; }
		}
		
		.rk-table .col-select { width: 30px; min-width: 30px; padding: 0 var(--rk-sp-3); }
		
		/* ===========================================================
		   第 8 层 · 徽章（颜色 + 图标 + 文字，三件套）
		   =========================================================== */
		
		.rk-badge {
		  display: inline-flex; align-items: center; gap: var(--rk-sp-2);
		  height: 20px; padding: 0 var(--rk-sp-3);
		  border-radius: var(--rk-r-xs);
		  font-size: var(--rk-fs-xs); line-height: var(--rk-lh-tight);
		  border: var(--rk-bw) solid transparent;
		  white-space: nowrap;
		}
		.rk-badge--ok   { background: var(--rk-ok-bg);   color: var(--rk-ok-fg);   border-color: var(--rk-ok-line); }
		.rk-badge--warn { background: var(--rk-warn-bg); color: var(--rk-warn-fg); border-color: var(--rk-warn-line); }
		.rk-badge--bad  { background: var(--rk-bad-bg);  color: var(--rk-bad-fg);  border-color: var(--rk-bad-line); }
		.rk-badge--info { background: var(--rk-info-bg); color: var(--rk-info-fg); border-color: var(--rk-info-line); }
		.rk-badge--idle { background: var(--rk-idle-bg); color: var(--rk-idle-fg); border-color: var(--rk-idle-line); }
		.rk-badge--unknown { background: transparent; color: var(--rk-unknown-fg); border-color: var(--rk-line-strong); }
		
		/* 密钥位：代码块，可点复制 */
		.rk-mono {
		  font-family: var(--rk-font-num); font-size: var(--rk-fs-xs);
		  background: var(--rk-surface-0);
		  border: var(--rk-bw) solid var(--rk-line);
		  border-radius: var(--rk-r-sm);
		  padding: 3px var(--rk-sp-3);
		  color: var(--rk-fg-1);
		  word-break: break-all;
		  user-select: all;
		}
		
		/* ===========================================================
		   第 9 层 · 按钮与工具条
		   =========================================================== */
		
		.rk-toolbar {
		  display: flex; align-items: center; gap: var(--rk-sp-4);
		  flex-wrap: wrap;
		}
		
		.rk-btn {
		  appearance: none; font: inherit; font-size: var(--rk-fs-md);
		  height: 28px; padding: 0 var(--rk-sp-5);
		  border-radius: var(--rk-r-md);
		  border: var(--rk-bw) solid var(--rk-line-strong);
		  background: var(--rk-surface-3); color: var(--rk-fg-1);
		  cursor: pointer; display: inline-flex; align-items: center; gap: var(--rk-sp-2);
		  transition: background-color var(--rk-dur-fast) var(--rk-ease),
		              border-color var(--rk-dur-fast) var(--rk-ease);
		  white-space: nowrap;
		}
		.rk-btn:hover:not(:disabled) { background: var(--rk-surface-4); }
		.rk-btn:disabled { opacity: .45; cursor: not-allowed; }
		.rk-btn--primary { background: var(--rk-accent); border-color: var(--rk-accent); color: #fff; }
		.rk-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }
		.rk-btn--danger { background: var(--rk-bad-bg); border-color: var(--rk-bad-line); color: var(--rk-bad-fg); }
		.rk-btn--sm { height: 22px; padding: 0 var(--rk-sp-4); font-size: var(--rk-fs-xs); }
		
		/* 图标按钮：目标尺寸 >=24x24（WCAG 2.5.8） */
		.rk-icon-btn {
		  appearance: none; border: 0; background: transparent;
		  color: var(--rk-fg-3); cursor: pointer;
		  min-width: 24px; min-height: 24px;
		  display: inline-flex; align-items: center; justify-content: center;
		  border-radius: var(--rk-r-sm);
		  transition: background-color var(--rk-dur-fast) var(--rk-ease), color var(--rk-dur-fast) var(--rk-ease);
		}
		.rk-icon-btn:hover { background: var(--rk-surface-4); color: var(--rk-fg-1); }
		.rk-icon-btn--active { color: var(--rk-accent); background: var(--rk-accent-bg); }
		
		/* 搜索框 */
		.rk-search {
		  display: flex; align-items: center; gap: var(--rk-sp-3);
		  height: 28px; padding: 0 var(--rk-sp-4);
		  background: var(--rk-surface-0);
		  border: var(--rk-bw) solid var(--rk-line-strong);
		  border-radius: var(--rk-r-md);
		  min-width: 170px; flex: 0 1 240px;
		}
		.rk-search input {
		  appearance: none; border: 0; background: transparent;
		  color: var(--rk-fg-1); font: inherit; font-size: var(--rk-fs-md);
		  width: 100%; min-width: 0;
		  /*
		   * 输入框自身去掉 outline，由外层 .rk-search 在 :focus-within 时
		   * 画整圈边框——这比给细输入框加一圈 offset 更好看，也更明显。
		   *
		   * 但“去掉 outline”必须配一个真的焦点指示，否则就是 APG F78 失败模式。
		   * 2.3.x 那条 :focus-within 写在未闭合的括号里，整条规则都没生效。
		   */
		  outline: none;
		}
		.rk-search input::placeholder { color: var(--rk-fg-4); }
		
		/* 焦点指示：整圈边框 + 光晕（输入框自身 outline:none 的补偿） */
		.rk-search:focus-within {
		  border-color: var(--rk-accent);
		  box-shadow: 0 0 0 var(--rk-focus-width) var(--rk-accent-bg);
		}
		
		.rk-select {
		  appearance: none; font: inherit; font-size: var(--rk-fs-md);
		  height: 28px; padding: 0 var(--rk-sp-5);
		  border-radius: var(--rk-r-md);
		  border: var(--rk-bw) solid var(--rk-line-strong);
		  background: var(--rk-surface-3); color: var(--rk-fg-1);
		  cursor: pointer;
		}
		.rk-field { display: flex; flex-direction: column; gap: var(--rk-sp-2); min-width: 0; }
		.rk-field-label { font-size: var(--rk-fs-xs); color: var(--rk-fg-3); }
		.rk-input {
		  appearance: none; font: inherit; font-size: var(--rk-fs-md);
		  height: 28px; padding: 0 var(--rk-sp-4);
		  border-radius: var(--rk-r-md);
		  border: var(--rk-bw) solid var(--rk-line-strong);
		  background: var(--rk-surface-0); color: var(--rk-fg-1);
		  width: 100%; min-width: 0;
		  outline: none;
		}
		.rk-input:focus { border-color: var(--rk-accent); box-shadow: 0 0 0 var(--rk-focus-width) var(--rk-accent-bg); }
		.rk-hint { font-size: var(--rk-fs-2xs); color: var(--rk-fg-3); line-height: var(--rk-lh-normal); }
		
		/* 开关：标签在状态变化时绝不改变（APG 要求） */
		.rk-switch {
		  appearance: none; border: 0; padding: 0; cursor: pointer;
		  width: 32px; height: 18px; border-radius: var(--rk-r-full);
		  background: var(--rk-surface-5); position: relative; flex: none;
		  transition: background-color var(--rk-dur-fast) var(--rk-ease);
		}
		.rk-switch[aria-checked="true"] { background: var(--rk-accent); }
		.rk-switch::after {
		  content: ""; position: absolute; top: 2px; left: 2px;
		  width: 14px; height: 14px; border-radius: var(--rk-r-full);
		  background: #fff; transition: transform var(--rk-dur-fast) var(--rk-ease);
		}
		.rk-switch[aria-checked="true"]::after { transform: translateX(14px); }
		.rk-switch:disabled { opacity: .45; cursor: not-allowed; }
		
		/* ===========================================================
		   第 10 层 · 心跳条 / 空 / 加载 / 错误
		   =========================================================== */
		
		.rk-heartbeat { display: flex; gap: 2px; align-items: center; }
		.rk-hb-cell {
		  width: 4px; height: 18px; border-radius: 1px;
		  background: var(--rk-idle-bg); flex: none;
		}
		.rk-hb-cell--ok   { background: var(--rk-ok-fg); }
		.rk-hb-cell--warn { background: var(--rk-warn-fg); }
		.rk-hb-cell--bad  { background: var(--rk-bad-fg); }
		.rk-hb-cell--unknown { background: var(--rk-unknown-fg); }
		
		.rk-empty {
		  display: flex; flex-direction: column; align-items: center;
		  gap: var(--rk-sp-4); padding: var(--rk-sp-10) var(--rk-sp-6);
		  text-align: center;
		}
		.rk-empty-title { font-size: var(--rk-fs-base); color: var(--rk-fg-2); font-weight: 600; }
		.rk-empty-note { font-size: var(--rk-fs-md); color: var(--rk-fg-3); max-width: 48ch; line-height: var(--rk-lh-normal); }
		
		/* 骨架屏：盒子尺寸与真实内容一致，避免加载完成时跳动 */
		.rk-skel {
		  border-radius: var(--rk-r-sm);
		  background: var(--rk-surface-3);
		  animation: rk-pulse 2s cubic-bezier(.4, 0, .6, 1) infinite;
		}
		@keyframes rk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
		
		.rk-error {
		  display: flex; align-items: flex-start; gap: var(--rk-sp-4);
		  padding: var(--rk-sp-5);
		  background: var(--rk-bad-bg);
		  border: var(--rk-bw) solid var(--rk-bad-line);
		  border-radius: var(--rk-r-md);
		  color: var(--rk-bad-fg); font-size: var(--rk-fs-md);
		}
		
		/* 闪念条：轮询失败 / 操作结果，非阻塞 */
		.rk-flash {
		  display: flex; align-items: center; gap: var(--rk-sp-3);
		  padding: var(--rk-sp-3) var(--rk-sp-4);
		  border-radius: var(--rk-r-md);
		  border: var(--rk-bw) solid transparent;
		  font-size: var(--rk-fs-md);
		}
		.rk-flash--ok { background: var(--rk-ok-bg); border-color: var(--rk-ok-line); color: var(--rk-ok-fg); }
		.rk-flash--bad { background: var(--rk-bad-bg); border-color: var(--rk-bad-line); color: var(--rk-bad-fg); }
		.rk-flash--info { background: var(--rk-info-bg); border-color: var(--rk-info-line); color: var(--rk-info-fg); }
		
		/* ===========================================================
		   第 11 层 · 弹层 / 抽屉 / 实时流水 / 密钥与审计
		   =========================================================== */
		
		.rk-modal {
		  position: fixed; inset: 0; z-index: var(--rk-z-modal);
		  display: flex; align-items: center; justify-content: center;
		  background: rgba(0, 0, 0, .5);
		  padding: var(--rk-sp-6);
		}
		.rk-modal-panel {
		  background: var(--rk-surface-1);
		  border: var(--rk-bw) solid var(--rk-line-strong);
		  border-radius: var(--rk-r-xl);
		  box-shadow: var(--rk-shadow-2);
		  padding: var(--rk-sp-6);
		  width: min(520px, 100%);
		  max-height: 86vh; overflow: auto;
		}
		.rk-modal-panel .rk-card-title { font-size: var(--rk-fs-lg); margin: 0 0 var(--rk-sp-4); }
		
		/* 抽屉：从右侧滑入，用于账号详情 */
		.rk-drawer {
		  position: fixed; top: 0; right: 0; bottom: 0; z-index: var(--rk-z-drawer);
		  width: min(420px, 100%);
		  background: var(--rk-surface-1);
		  border-left: var(--rk-bw) solid var(--rk-line-strong);
		  box-shadow: var(--rk-shadow-2);
		  padding: var(--rk-sp-5);
		  overflow: auto;
		}
		
		/* 实时流水：贴底跟随 / 上滚冻结（行为在 LiveStream 组件里） */
		.rk-stream { border-top: var(--rk-bw) solid var(--rk-line); }
		.rk-stream-row {
		  height: 36px; display: flex; align-items: center; gap: var(--rk-sp-4);
		  padding: 0 var(--rk-sp-5);
		  border-bottom: var(--rk-bw) solid var(--rk-line);
		  font-size: var(--rk-fs-md); color: var(--rk-fg-2);
		  white-space: nowrap; overflow: hidden;
		}
		.rk-stream-row:hover { background: var(--rk-surface-3); }
		
		.rk-kv { display: grid; grid-template-columns: auto 1fr; gap: var(--rk-sp-3) var(--rk-sp-5); }
		.rk-kv-label { font-size: var(--rk-fs-xs); color: var(--rk-fg-3); }
		.rk-kv-value { font-size: var(--rk-fs-md); color: var(--rk-fg-1); min-width: 0; overflow-wrap: anywhere; }
		.rk-kv-value--num { font-family: var(--rk-font-num); font-variant-numeric: tabular-nums; }
		
		.rk-bar {
		  height: 6px; border-radius: var(--rk-r-full);
		  background: var(--rk-surface-3); overflow: hidden;
		}
		.rk-bar-fill { height: 100%; background: var(--rk-accent); border-radius: var(--rk-r-full); }
		.rk-bar-fill--warn { background: var(--rk-warn-fg); }
		.rk-bar-fill--bad { background: var(--rk-bad-fg); }
		
		.rk-sep { height: var(--rk-bw); background: var(--rk-line); border: 0; margin: 0; }
		
		/* ===========================================================
		   第 12 层 · 自适应密度（用户选定：宽屏紧凑 / 窄屏舒适）
		   =========================================================== */
		
		/*
		 * 密度是**容器查询**，不是媒体查询。
		 *
		 * 卡片宽度 != 视口宽度：宿主中央列会被右侧面板挤压，视口 1376 时它可能
		 * 只有 796px。用媒体查询会在那种情况下按「宽屏」渲染，于是行高 30、
		 * 字号 12 挤在一个窄列里。
		 *
		 * 断点只改**量**（行高、字号、内距、隐藏的次要列），不改信息结构
		 * —— 唯一允许换结构的是 520px 以下的表格转卡片列表，见第 13 层。
		 */
		@container rk (max-width: 900px) {
		  .rk-root {
		    --rk-row-h: 38px;
		    --rk-cell-pad: 12px;
		    --rk-pad: 18px;
		    --rk-fs-md: 13px;
		    --rk-fs-base: 14px;
		    --rk-fs-lg: 16px;
		  }
		  .rk-table thead th { height: 34px; }
		  .rk-btn { height: 32px; }
		  .rk-search { height: 32px; }
		  .rk-select { height: 32px; }
		  .rk-input { height: 32px; }
		  .rk-metric-value { font-size: var(--rk-fs-xl); }
		  .rk-grid-2 { grid-template-columns: minmax(0, 1fr); }
		  .rk-grid-side { grid-template-columns: minmax(0, 1fr); }
		  .rk-nav-btn { flex: 0 0 auto; }
		  .rk-table-wrap { max-height: 420px; }
		}
		
		@container rk (max-width: 620px) {
		  .rk-root { --rk-row-h: 44px; --rk-pad: 16px; }
		  .rk-top { padding: var(--rk-sp-4); gap: var(--rk-sp-4); }
		  .rk-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		  .rk-metric { padding: var(--rk-sp-4); }
		}
		
		/* ===========================================================
		   第 13 层 · 窄屏信息结构切换（唯一允许换结构的地方）
		   =========================================================== */
		
		@container rk (max-width: 520px) {
		  .rk-body { padding: var(--rk-sp-4); }
		  .rk-page > * + * { margin-top: var(--rk-sp-5); }
		
		  /*
		   * 表头 sticky 在小视口会遮挡焦点，改静态（WCAG 2.4.12 建议）。
		   * 表格改为卡片列表：每行一张卡，字段竖排并带标签，
		   * 由 DataTable 在窄容器下输出 .rk-expand 结构配合。
		   */
		  .rk-table thead th { position: static; }
		  .rk-table .rk-col-hide-sm { display: none; }
		  .rk-modal { padding: var(--rk-sp-4); }
		  .rk-modal-panel { padding: var(--rk-sp-5); }
		  .rk-stream-row { height: 32px; gap: var(--rk-sp-3); padding: 0 var(--rk-sp-4); }
		  .rk-nav { flex: 1 1 100%; }
		}
		
		/* ===========================================================
		   第 14 层 · 无障碍与动效降级
		   =========================================================== */
		
		@media (prefers-reduced-motion: reduce) {
		  .rk-root *, .rk-root *::before, .rk-root *::after {
		    animation-duration: .01ms !important;
		    transition-duration: .01ms !important;
		  }
		  /* 加载指示器保留：它传达"系统没卡死"，不应被禁用 */
		  .rk-skel { animation-duration: 2s !important; }
		}
		
		/* 高对比度：边框必须有，不能只靠底色区分区块 */
		@media (forced-colors: active) {
		  .rk-card, .rk-metric, .rk-badge, .rk-btn, .rk-search, .rk-input, .rk-select {
		    border: var(--rk-bw) solid CanvasText;
		  }
		}
		`.trim();
		
		/** 主题持久化的 localStorage 键（命名空间化，避免与宿主/其他插件冲突）。 */
		const RK_THEME_KEY = 'dsh-rotakit:ui-theme';
		
		/** 密度持久化键。留着手动覆盖的口子，默认走容器查询。 */
		const RK_DENSITY_KEY = 'dsh-rotakit:ui-density';
		
		const __default_ui_tokens_js = RK_CSS;

		//#endregion

		//#region src/ui-components
		/**
		 * RotaKit 新 UI · 组件库
		 *
		 * 样式令牌：src/ui-tokens.js
		 * 规范来源：docs/05-新UI设计语言.md
		 *
		 * ── 为什么是工厂函数而不是普通 ES 模块 ──
		 *
		 * 这个项目没有构建链，而 react 由 DSH 宿主在运行时通过 `require("react")`
		 * 提供。所以组件不能 `import React from "react"` —— 那会在解析期失败。
		 * 做法：导出一个 `createUI(react)`，宿主加载时把 react 传进来。
		 *
		 * ── 2.4.0 的变化 ──
		 *
		 * · 修掉 2.3.x 里 `requestOutcome` 自嵌套 + 返回对象键重复的问题
		 * · DataTable 补排序与批量选择；窄容器下输出卡片结构
		 * · 新增 Sparkline / Toggle / KeyRow
		 *
		 * @module dsh-rotakit/client/ui
		 */
		
		/**
		 * 时长格式化：把毫秒压成人类可读的短串。
		 *
		 * 设计约束（docs/05 §3.1）：冷却中必须显示【剩余时间】，
		 * 不能只说"冷却中"——用户下一秒就会问"还有多久"。
		 */
		function formatDuration(ms) {
		  if (!Number.isFinite(ms) || ms <= 0) return '0s';
		  const s = Math.floor(ms / 1000);
		  if (s < 60) return `${s}s`;
		  const m = Math.floor(s / 60);
		  if (m < 60) return s % 60 === 0 ? `${m}m` : `${m}m${s % 60}s`;
		  const h = Math.floor(m / 60);
		  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h${m % 60}m`;
		  const d = Math.floor(h / 24);
		  return h % 24 === 0 ? `${d}d` : `${d}d${h % 24}h`;
		}
		
		const COMPACT_CACHE = new Map();
		function compactFormatter(locale) {
		  const key = locale ?? '';
		  if (COMPACT_CACHE.has(key)) return COMPACT_CACHE.get(key);
		  let fmt = null;
		  try {
		    fmt = new Intl.NumberFormat(locale === '' || locale === undefined ? undefined : locale, {
		      notation: 'compact',
		      compactDisplay: 'short',
		    });
		  } catch {
		    fmt = null;
		  }
		  COMPACT_CACHE.set(key, fmt);
		  return fmt;
		}
		
		function formatCount(n, locale) {
		  if (!Number.isFinite(n)) return '—';
		  if (Math.abs(n) < 1000) return String(n);
		  const fmt = compactFormatter(locale);
		  if (fmt !== null) {
		    try { return fmt.format(n); } catch { /* 落到手写实现 */ }
		  }
		  const abs = Math.abs(n);
		  if (abs < 1e6) return (n / 1e3).toFixed(abs < 1e4 ? 1 : 0) + 'K';
		  if (abs < 1e9) return (n / 1e6).toFixed(1) + 'M';
		  return (n / 1e9).toFixed(1) + 'B';
		}
		
		/** 千分位。表格里的精确值用它，不用紧凑写法。 */
		function formatThousands(n) {
		  if (!Number.isFinite(n)) return '—';
		  return n.toLocaleString('en-US');
		}
		
		/** 绝对时间 → 本地短串。用于"最近使用"这类列。 */
		function formatWhen(iso) {
		  if (typeof iso !== 'string' || iso === '') return '';
		  const t = Date.parse(iso);
		  if (!Number.isFinite(t)) return '';
		  const d = new Date(t);
		  const pad = (n) => String(n).padStart(2, '0');
		  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
		}
		
		/**
		 * 余额取值。
		 *
		 * 宿主 2.4.0 起把 `credits` 发成对象 `{total, packages}`，
		 * 更早的文档里是纯数字 —— 两种都要认，
		 * 否则整列渲染成 '—'（就是「余额全空」那个 bug）。
		 */
		function creditsTotal(acc) {
		  if (typeof acc?.credits === 'number') return acc.credits;
		  const total = acc?.credits?.total;
		  return Number.isFinite(total) ? total : undefined;
		}
		
		/**
		 * 从 PoolWebAccount 推导出【四态】。
		 *
		 *   · `cooling`          -> 冷却中（有倒计时）
		 *   · 冷却已过但未成功过 -> **待探测**（半开，下一步就是探测）
		 *   · 无冷却且已服务过   -> 可用
		 *   · `disabled`         -> 手动停用（与自动不可用分开）
		 *   · `authDead`         -> 需重新登录（token 被吊销）
		 *   · `restricted`       -> 平台受限（token 有效但被限）
		 *
		 * 「待探测」是相对其他账号池产品的差异点：成熟产品只画 OPEN/CLOSED 两态，
		 * 没有一个把「冷却刚结束、下一次请求即探测」这个中间态显示出来。
		 *
		 * @param {object} acc  PoolWebAccount
		 * @param {number} now  当前时间戳（注入以便测试）
		 * @returns {{kind:string, icon:string, label:string, title:string}}
		 */
		function accountState(acc, now) {
		  if (acc === null || typeof acc !== 'object') {
		    return { kind: 'unknown', icon: '?', label: '未知', title: '尚未探测过这个账号' };
		  }
		  if (acc.disabled === true) {
		    return { kind: 'idle', icon: '⏸', label: '已停用', title: '你手动停用了这个账号，它仍保留在列表里' };
		  }
		  if (acc.authDead === true) {
		    return { kind: 'bad', icon: '✕', label: '需重新登录', title: '凭据被上游拒绝，重新登录才能恢复' };
		  }
		  if (acc.restricted === true) {
		    return { kind: 'bad', icon: '⊘', label: '平台受限', title: '账号被平台限制，token 仍然有效' };
		  }
		  if (acc.cooling === true) {
		    const until = acc.cooldownUntil ? Date.parse(acc.cooldownUntil) : NaN;
		    const left = Number.isFinite(until) ? until - now : NaN;
		    const text = Number.isFinite(left) && left > 0 ? formatDuration(left) : '';
		    return {
		      kind: 'warn',
		      icon: '◐',
		      label: text === '' ? '冷却中' : `冷却 ${text}`,
		      title: '限流冷却中，到期后会自动回到池子',
		    };
		  }
		  if (acc.cooldownUntil !== undefined && acc.cooldownUntil !== null) {
		    const until = Date.parse(acc.cooldownUntil);
		    const used = acc.lastUsedAt ? Date.parse(acc.lastUsedAt) : NaN;
		    const neverServedSince = !Number.isFinite(used) || (Number.isFinite(until) && used < until);
		    if (neverServedSince) {
		      return { kind: 'info', icon: '◑', label: '待探测', title: '冷却已结束，下一次请求会验证它是否真的恢复' };
		    }
		  }
		  if ((acc.rateLimitHits ?? 0) > 0 || (acc.serverErrorHits ?? 0) > 0) {
		    return { kind: 'ok', icon: '●', label: '可用', title: '曾失败过，但当前可用' };
		  }
		  return { kind: 'ok', icon: '●', label: '可用', title: '正常参与轮换' };
		}
		
		/** 指标的"涨"是好是坏。取自 Datadog 的 directionality（docs/05 §3.4）。 */
		const TREND_DIRECTION = {
		  requests: 'good',
		  success: 'good',
		  latency: 'bad',
		  spend: 'flat',
		  keys: 'flat',
		};
		
		/* ───────────────────────────────────────────────────────────
		   请求结果的六档归类。
		   四种非 ok 的语义完全不同，二元 ✓/✕ 会让用户去做错的事：
		     reasoning-loop 是我们主动中止的（省了额度），画成红叉
		     会让人去重试，正好多烧一次额度。
		   ─────────────────────────────────────────────────────────── */
		function requestOutcome(row, tr) {
		  const raw = typeof row?.outcome === 'string' && row.outcome !== '' ? row.outcome : undefined;
		  if (raw === 'ok' || raw === 'ok-after-compact') {
		    return { tone: 'ok', glyph: '✓', detail: tr('rk.req.ok', '成功') };
		  }
		  if (raw === 'pending') {
		    return { tone: 'warn', glyph: '·', detail: tr('rk.req.pending', '进行中') };
		  }
		  if (raw === 'reasoning-loop') {
		    return {
		      tone: 'ok',
		      glyph: '✓',
		      detail: row.detail ?? tr('rk.req.loop', '模型陷入重复，已中止本轮（省下了额度）'),
		    };
		  }
		  if (raw === 'empty-turn') {
		    return {
		      tone: 'bad',
		      glyph: '✕',
		      detail: row.detail ?? tr('rk.req.empty', '上游没有返回任何内容'),
		    };
		  }
		  if (raw === 'compact') {
		    return { tone: 'info', glyph: '⇲', detail: tr('rk.req.compact', '上下文超限，压缩后重试成功') };
		  }
		  if (raw === undefined) {
		    return { tone: 'warn', glyph: '?', detail: tr('rk.req.unknown', '结果不明') };
		  }
		  /* 其余原样上报 —— 宿主的话汇是唯一说清真因的地方 */
		  return { tone: 'bad', glyph: '✕', detail: `${raw}${row.detail ? ` · ${row.detail}` : ''}` };
		}
		
		/**
		 * 构造组件库。
		 *
		 * @param {object} react 宿主注入的 react
		 * @returns 组件集合
		 */
		function createUI(react) {
		  if (react === null || typeof react !== 'object' || typeof react.createElement !== 'function') {
		    throw new Error('createUI(react): react 不可用，或缺少 createElement');
		  }
		  const h = react.createElement;
		  const { useState, useMemo, useCallback, useRef, useEffect } = react;
		
		  // ── 图标（内联 SVG，不依赖外部资源） ──
		
		  const PATHS = {
		    search: 'M7 1a6 6 0 1 0 3.7 10.7l3.3 3.3 1-1-3.3-3.3A6 6 0 0 0 7 1Zm0 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z',
		    close: 'M3 3l10 10M13 3L3 13',
		    up: 'M8 3l5 6H3l5-6Z',
		    down: 'M8 13l-5-6h10l-5 6Z',
		    flat: 'M3 8h10',
		    plus: 'M8 3v10M3 8h10',
		    refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3',
		    play: 'M5 3l8 5-8 5V3Z',
		    pause: 'M5 3h2v10H5zM9 3h2v10H9z',
		    check: 'M3 8l3.5 3.5L13 5',
		    external: 'M6 3H3v10h10v-3M9 3h4v4M13 3L7 9',
		    key: 'M10 1a4 4 0 0 0-3.9 4.9L1 11v3h3v-2h2v-2h2l1.1-1.1A4 4 0 1 0 10 1Zm1.5 3.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
		    copy: 'M5 1h6v2H6v8H4V1h1Zm2 3h6v11H7V4Z',
		    trash: 'M3 4h10l-1 10H4L3 4Zm2 2v7h6V6H5Zm1-4h4l1 1H5l1-1Z',
		    sun: 'M8 1v2M8 13v2M1 8h2M13 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4M8 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
		    moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z',
		    gear: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm6 2.5c0-.3 0-.6-.1-.9l1.3-1-1.5-2.6-1.6.6c-.4-.3-.9-.6-1.4-.8L10.4 2H7.6l-.3 1.8c-.5.2-.9.5-1.4.8L4.3 4 2.8 6.6l1.3 1a5 5 0 0 0 0 1.8l-1.3 1L5.9 13l1.6-.6c.4.3.9.6 1.4.8l.3 1.8h2.8l.3-1.8c.5-.2.9-.5 1.4-.8l1.6.6 1.5-2.6-1.3-1c.1-.3.1-.6.1-.9Z',
		    edit: 'M2 11.5 11 2.5l2.5 2.5-9 9H2v-2.5ZM11.5 5l2 2',
		    download: 'M8 1v8M5 6l3 3 3-3M2 12h12',
		    filter: 'M2 2h12l-4.5 5.5V14L6 12V7.5L2 2Z',
		  };
		  const Icon = ({ name, size = 14, className }) => {
		    const d = PATHS[name];
		    if (d === undefined) return null;
		    return h('svg', {
		      width: size, height: size, viewBox: '0 0 16 16',
		      fill: 'none', stroke: 'currentColor',
		      strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
		      className,
		      'aria-hidden': 'true', focusable: 'false',
		    }, h('path', { d }));
		  };
		
		  // ── 状态徽章：颜色 + 图标 + 文字，三件套 ──
		
		  /**
		   * 状态徽章。
		   * 颜色【永远不是唯一信号】—— 色盲用户约占男性 8%。
		   */
		  const StateBadge = ({ state, title }) => {
		    const s = state ?? { kind: 'unknown', icon: '?', label: '未知' };
		    return h('span', {
		      className: `rk-badge rk-badge--${s.kind}`,
		      title: title ?? s.title ?? s.label,
		    },
		      h('span', { 'aria-hidden': 'true' }, s.icon),
		      h('span', null, s.label));
		  };
		
		  /** 徽章原语：供页面直接拼装非账号状态的标记。 */
		  const Badge = ({ kind = 'idle', icon, children, title }) => h('span', {
		    className: `rk-badge rk-badge--${kind}`,
		    title,
		  },
		    icon === undefined ? null : h('span', { 'aria-hidden': 'true' }, icon),
		    h('span', null, children));
		
		  // ── 指标卡 ──
		
		  const MetricCard = ({ label, value, unit, delta, direction = 'flat', hint, spark }) => {
		    const trendClass = direction === 'good' ? 'rk-trend--good'
		      : direction === 'bad' ? 'rk-trend--bad'
		        : 'rk-trend--flat';
		    const arrow = delta === undefined || delta === null ? null
		      : delta > 0 ? h(Icon, { name: 'up', size: 10 })
		        : delta < 0 ? h(Icon, { name: 'down', size: 10 })
		          : h(Icon, { name: 'flat', size: 10 });
		    return h('div', { className: 'rk-metric' },
		      h('div', { className: 'rk-metric-label' }, label),
		      h('div', { className: 'rk-metric-row' },
		        h('span', { className: 'rk-metric-value' }, value),
		        unit === undefined ? null : h('span', { className: 'rk-metric-unit' }, unit),
		        delta === undefined || delta === null ? null
		          : h('span', { className: `rk-trend ${trendClass}` }, arrow, `${delta > 0 ? '+' : ''}${delta}%`)),
		      spark === undefined ? null : h(Sparkline, spark),
		      hint === undefined ? null : h('div', { className: 'rk-card-sub' }, hint));
		  };
		
		  /**
		   * 迷你趋势条。
		   *
		   * 用纯 CSS 高度而不是图表库：面板里唯一需要的趋势是「14 天消耗」，
		   * 引入图表库的成本（几十 KB + 一套主题适配）远大于收益。
		   */
		  const Sparkline = ({ values = [], max, labels = [] }) => {
		    const list = Array.isArray(values) ? values : [];
		    if (list.length === 0) return null;
		    const peak = Number.isFinite(max) && max > 0 ? max : Math.max(1, ...list);
		    return h('div', { className: 'rk-spark', role: 'img', 'aria-label': `最近 ${list.length} 天的消耗趋势` },
		      list.map((v, i) => {
		        const pct = Math.max(2, Math.round((Number(v) || 0) / peak * 100));
		        const cls = Number(v) === 0 ? 'rk-spark-bar rk-spark-bar--zero'
		          : i === list.length - 1 ? 'rk-spark-bar rk-spark-bar--today'
		            : 'rk-spark-bar';
		        return h('span', {
		          key: i, className: cls,
		          style: { height: `${pct}%` },
		          title: labels[i] === undefined ? undefined : `${labels[i]}：${String(v)}`,
		        });
		      }));
		  };
		
		  // ── 心跳条 ──
		
		  const Heartbeat = ({ cells = [], cellWidth = 4, gap = 2, width }) => {
		    const list = Array.isArray(cells) ? cells : [];
		    const maxCells = Number.isFinite(width) ? Math.max(1, Math.floor(width / (cellWidth + gap))) : list.length;
		    const shown = list.length > maxCells ? list.slice(list.length - maxCells) : list;
		    return h('div', {
		      className: 'rk-heartbeat',
		      role: 'img',
		      'aria-label': `最近 ${shown.length} 个时间窗的健康状况`,
		    }, shown.map((c, i) => h('span', {
		      key: i,
		      className: `rk-hb-cell rk-hb-cell--${c.state ?? 'unknown'}`,
		      title: c.title ?? '',
		    })));
		  };
		
		  // ── 空状态：三分类 ──
		
		  const EmptyState = ({ kind = 'empty', title, note, actionLabel, onAction }) => {
		    const defaults = {
		      empty: { title: '还没有数据', note: '' },
		      filtered: { title: '没有匹配的结果', note: '试试放宽筛选条件或清除搜索词。' },
		      disabled: { title: '这个功能还没启用', note: '启用后才会开始记录。' },
		    };
		    const d = defaults[kind] ?? defaults.empty;
		    return h('div', { className: 'rk-empty' },
		      h('div', { className: 'rk-empty-title' }, title ?? d.title),
		      (note ?? d.note) === '' ? null : h('div', { className: 'rk-empty-note' }, note ?? d.note),
		      actionLabel === undefined ? null
		        : h('button', { type: 'button', className: 'rk-btn rk-btn--primary', onClick: onAction }, actionLabel));
		  };
		
		  const Skeleton = ({ rows = 4, height = 30 }) =>
		    h('div', { 'aria-hidden': 'true' },
		      Array.from({ length: rows }, (_, i) =>
		        h('div', { key: i, className: 'rk-skel', style: { height: `${height}px`, marginBottom: '4px' } })));
		
		  // ── 开关行 ──
		
		  const Toggle = ({ checked, onChange, disabled, label }) => h('button', {
		    type: 'button',
		    className: 'rk-switch',
		    role: 'switch',
		    'aria-checked': checked === true ? 'true' : 'false',
		    'aria-label': label,
		    disabled: disabled === true,
		    onClick: () => onChange?.(checked !== true),
		  });
		
		  // ── 键值对 ──
		
		  const KV = ({ items = [] }) => h('div', { className: 'rk-kv' },
		    items.map((it, i) => h(react.Fragment, { key: i },
		      h('div', { className: 'rk-kv-label' }, it.label),
		      h('div', { className: `rk-kv-value${it.num === true ? ' rk-kv-value--num' : ''}` }, it.value))));
		
		  // ── 进度条 ──
		
		  const Bar = ({ value, max, tone }) => {
		    const pct = Number.isFinite(max) && max > 0 ? Math.min(100, Math.max(0, Math.round(Number(value) / Number(max) * 100))) : 0;
		    return h('div', { className: 'rk-bar' },
		      h('div', { className: `rk-bar-fill${tone === undefined ? '' : ` rk-bar-fill--${tone}`}`, style: { width: `${pct}%` } }));
		  };
		
		  // ── 数据表：排序、批量、窄容器卡片化 ──
		
		  /**
		   * 数据表。
		   *
		   * columns: [{ key, label, width, align, sortable, hideOnNarrow, numeric,
		   *             render, titleOf, valueOf }]
		   *
		   * `valueOf(row)` 是排序取值的钩子：不提供时按 render 出的文本排，
		   * 对数字列就会排成字典序（"1" < "10" < "2"）。数字列必须给
		   * `numeric: true`，此时内部用 `valueOf ?? Number` 比。
		   */
		  const DataTable = ({
		    columns = [], rows = [], rowKey = (r, i) => i,
		    selectable = false, selectedIds, onToggleRow, onToggleAll,
		    sortKey, sortDir = 'asc', onSort,
		    emptyKind = 'empty', emptyTitle, emptyAction, caption,
		  }) => {
		    const selected = selectedIds ?? new Set();
		    const allSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
		
		    if (rows.length === 0) {
		      return h('div', { className: 'rk-card' },
		        caption === undefined ? null : h('div', { className: 'rk-card-head' }, h('h3', { className: 'rk-card-title' }, caption)),
		        h('div', { className: 'rk-card-body' }, h(EmptyState, {
		          kind: emptyKind, title: emptyTitle,
		          actionLabel: emptyAction?.label, onAction: emptyAction?.onClick,
		        })));
		    }
		
		    const headCells = [];
		    if (selectable) {
		      headCells.push(h('th', { key: '__sel', className: 'col-select' },
		        h('input', {
		          type: 'checkbox', checked: allSelected,
		          'aria-label': '选择全部',
		          onChange: () => onToggleAll?.(!allSelected),
		        })));
		    }
		    for (const c of columns) {
		      const isSorted = sortKey === c.key;
		      const ariaSort = c.sortable === true ? (isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
		      headCells.push(h('th', {
		        key: c.key,
		        className: c.hideOnNarrow === true ? 'rk-col-hide-sm' : undefined,
		        style: c.width === undefined ? undefined : { width: c.width },
		        'aria-sort': ariaSort,
		        onClick: c.sortable === true && typeof onSort === 'function'
		          ? () => onSort(c.key, isSorted && sortDir === 'asc' ? 'desc' : 'asc')
		          : undefined,
		      },
		        c.label,
		        c.sortable === true
		          ? h('span', { 'aria-hidden': 'true', style: { opacity: isSorted ? 1 : 0.3, marginLeft: '4px' } },
		            isSorted && sortDir === 'desc' ? '↓' : '↑')
		          : null));
		    }
		
		    const bodyRows = rows.map((r, i) => {
		      const k = rowKey(r, i);
		      const isSel = selected.has(k);
		      const cells = [];
		      if (selectable) {
		        cells.push(h('td', { key: '__sel', className: 'col-select' },
		          h('input', {
		            type: 'checkbox', checked: isSel,
		            'aria-label': '选择此行',
		            onChange: () => onToggleRow?.(k),
		          })));
		      }
		      for (const c of columns) {
		        const content = c.render(r, i);
		        cells.push(h('td', {
		          key: c.key,
		          className: [
		            c.align === 'end' ? 'rk-col-num' : '',
		            c.hideOnNarrow === true ? 'rk-col-hide-sm' : '',
		            c.id === true ? 'rk-col-id' : '',
		          ].filter(Boolean).join(' ') || undefined,
		          'data-label': c.hideOnNarrow === true ? c.label : undefined,
		          title: typeof c.titleOf === 'function' ? c.titleOf(r) : (typeof content === 'string' ? content : undefined),
		        }, content));
		      }
		      return h('tr', { key: k, 'aria-selected': isSel ? 'true' : undefined }, cells);
		    });
		
		    return h('div', { className: 'rk-card' },
		      caption === undefined ? null : h('div', { className: 'rk-card-head' }, h('h3', { className: 'rk-card-title' }, caption)),
		      h('div', { className: 'rk-table-wrap' },
		        h('table', { className: 'rk-table' },
		          h('thead', null, h('tr', null, headCells)),
		          h('tbody', null, bodyRows))));
		  };
		
		  /** 排序辅助：按列定义取可比的值。数字列用 valueOf，文本列用 render 的字符串。 */
		  function sortValue(row, col) {
		    if (typeof col.valueOf === 'function') return col.valueOf(row);
		    if (col.numeric === true) return Number(row?.[col.key]) || 0;
		    const rendered = col.render(row, 0);
		    return typeof rendered === 'string' ? rendered : String(rendered ?? '');
		  }
		
		  // ── 搜索 + 筛选工具条 ──
		
		  const Toolbar = ({ value = '', onChange, placeholder = '搜索…', filters = [], children }) => {
		    const inputRef = useRef(null);
		    useEffect(() => {
		      if (typeof document === 'undefined') return undefined;
		      const onKey = (e) => {
		        if (e.key !== '/') return;
		        const tag = document.activeElement?.tagName;
		        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		        e.preventDefault();
		        inputRef.current?.focus();
		      };
		      document.addEventListener('keydown', onKey);
		      return () => document.removeEventListener('keydown', onKey);
		    }, []);
		    return h('div', { className: 'rk-toolbar' },
		      h('div', { className: 'rk-search' },
		        h(Icon, { name: 'search', size: 13 }),
		        h('input', {
		          ref: inputRef, type: 'search', value, placeholder,
		          'aria-label': placeholder,
		          onChange: (e) => onChange?.(e.target.value),
		        })),
		      filters.map((f) => h('select', {
		        key: f.key, className: 'rk-select', value: f.value,
		        'aria-label': f.label,
		        onChange: (e) => f.onChange?.(e.target.value),
		      }, f.options.map((o) => h('option', { key: o.value, value: o.value }, o.label)))),
		      h('span', { className: 'rk-spacer' }),
		      children);
		  };
		
		  // ── 确认框：自绘，不用 window.confirm ──
		
		  const ConfirmDialog = ({
		    open = false, title, body, consequences = [],
		    confirmLabel = '确定', cancelLabel = '取消',
		    danger = false, requireWord, onConfirm, onCancel,
		  }) => {
		    const [typed, setTyped] = useState('');
		    const cancelRef = useRef(null);
		    useEffect(() => { if (open === true) cancelRef.current?.focus(); }, [open]);
		    useEffect(() => {
		      if (open !== true || typeof document === 'undefined') return undefined;
		      const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
		      document.addEventListener('keydown', onKey);
		      return () => document.removeEventListener('keydown', onKey);
		    }, [open, onCancel]);
		    if (open !== true) return null;
		    const wordOk = requireWord === undefined || typed.trim() === requireWord;
		    return h('div', { className: 'rk-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
		      h('div', { className: 'rk-modal-panel' },
		        h('h3', { className: 'rk-card-title' }, title),
		        body === undefined ? null : h('p', { className: 'rk-empty-note', style: { margin: '8px 0' } }, body),
		        consequences.length === 0 ? null
		          : h('ul', { className: 'rk-empty-note', style: { margin: '8px 0', paddingLeft: '18px' } },
		            consequences.map((c, i) => h('li', { key: i }, c))),
		        requireWord === undefined ? null
		          : h('div', { style: { margin: '12px 0' } },
		            h('div', { className: 'rk-card-sub' }, `请输入 ${requireWord} 以确认`),
		            h('input', {
		              type: 'text', value: typed, 'aria-label': `输入 ${requireWord} 确认`,
		              onChange: (e) => setTyped(e.target.value),
		              style: { width: '100%', marginTop: '4px' },
		            })),
		        h('div', { className: 'rk-toolbar', style: { justifyContent: 'flex-end' } },
		          h('button', { ref: cancelRef, type: 'button', className: 'rk-btn', onClick: onCancel }, cancelLabel),
		          h('button', {
		            type: 'button',
		            className: `rk-btn ${danger ? 'rk-btn--danger' : 'rk-btn--primary'}`,
		            disabled: !wordOk,
		            onClick: () => { if (wordOk) onConfirm?.(); },
		          }, confirmLabel))));
		  };
		
		  // ── 实时流水：贴底跟随 / 上滚冻结 ──
		
		  const LiveStream = ({ items = [], renderItem, maxRows = 400, emptyLabel = '还没有记录', rowHeight = 36 }) => {
		    const boxRef = useRef(null);
		    const followRef = useRef(true);
		    const [paused, setPaused] = useState(false);
		    const shown = items.length > maxRows ? items.slice(items.length - maxRows) : items;
		
		    const onScroll = useCallback(() => {
		      const el = boxRef.current;
		      if (el === null) return;
		      const tolerance = 4 * rowHeight;
		      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= tolerance;
		      followRef.current = atBottom;
		      setPaused(!atBottom);
		    }, [rowHeight]);
		
		    useEffect(() => {
		      const el = boxRef.current;
		      if (el === null || followRef.current !== true) return;
		      if (typeof requestAnimationFrame === 'function') {
		        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
		      } else {
		        el.scrollTop = el.scrollHeight;
		      }
		    }, [shown.length]);
		
		    const jumpToLatest = useCallback(() => {
		      const el = boxRef.current;
		      if (el === null) return;
		      el.scrollTop = el.scrollHeight;
		      followRef.current = true;
		      setPaused(false);
		    }, []);
		
		    if (shown.length === 0) {
		      return h('div', { className: 'rk-empty' }, h('div', { className: 'rk-empty-note' }, emptyLabel));
		    }
		    return h('div', { style: { position: 'relative' } },
		      h('div', {
		        ref: boxRef, className: 'rk-stream', onScroll,
		        role: 'log', 'aria-live': 'polite',
		        style: { maxHeight: `${rowHeight * 10}px`, overflowY: 'auto' },
		      }, shown.map((it, i) => h('div', { key: it.id ?? i, className: 'rk-stream-row' }, renderItem(it, i)))),
		      paused === true
		        ? h('button', {
		            type: 'button', className: 'rk-btn rk-btn--primary',
		            style: { position: 'absolute', right: '12px', bottom: '12px' },
		            onClick: jumpToLatest,
		          }, '↓ 回到最新')
		        : null);
		  };
		
		  return {
		    Icon, StateBadge, Badge, MetricCard, Sparkline, Heartbeat,
		    EmptyState, Skeleton, DataTable, Toolbar, ConfirmDialog, LiveStream,
		    Toggle, KV, Bar, sortValue,
		    // 工具函数一并导出，便于测试与复用
		    formatDuration, formatCount, formatThousands, formatWhen,
		    accountState, requestOutcome, TREND_DIRECTION,
		  };
		}
		
		const __default_ui_components_js = createUI;

		//#endregion

		//#region src/ui-panel
		/**
		 * RotaKit 新 UI · 面板主逻辑（2.4.0）
		 *
		 * 消费后端 `PoolWebStatus`（契约见 lib/index.d.ts，docs/02 §六），
		 * 用 src/ui-components.js 的组件组装出五个页面。
		 *
		 * ── 信息架构 ──
		 *
		 * 概览   主角：健康度 + 用量趋势 + 一键操作
		 * 账号   主角：账号表（搜索/筛选/排序/批量/改名）
		 * 任务   主角：排期 + 今日收益 + 执行记录
		 * 流水   主角：请求瀑布（贴底跟随）
		 * 设置   主角：密钥治理 + 审计 + 行为参数
		 *
		 * 为什么"任务"和"流水"分开（取自 Sonarr 的 Activity 三分离）：
		 * 它们的**刷新节奏**不同 —— 任务按分钟变、流水按秒变。
		 * 挤在一张表里，实时重绘会打断阅读。
		 *
		 * 为什么设置是独立一页而不是塞进顶栏：2.4.0 的设置页要承载
		 * 密钥 CRUD、审计查询、行为参数、主题切换四类内容，
		 * 顶栏放不下。
		 *
		 * @module dsh-rotakit/client/panel
		 */

		/** 页面清单。顺序即导航顺序。 */
		const PAGES = [
		  { key: 'overview', label: '概览' },
		  { key: 'accounts', label: '账号' },
		  { key: 'tasks', label: '任务' },
		  { key: 'stream', label: '流水' },
		  { key: 'settings', label: '设置' },
		];

		/** 区域页签。两套账号 / 模型启用范围 / 自动任务互不影响。 */
		const REGIONS = [
		  { key: 'cn', label: '国内版' },
		  { key: 'global', label: '国际版' },
		];

		/** 后端路由（与 lib/index.js 的 POOL_*_PATH 及 PRO_PATHS 一致）。 */
		/*
		 * 补偿 / 礼包的路径字面量。
		 *
		 * 刻意从 ROUTES 里再抄一份而不是引用：_verify_campaign_locale.mjs 比对的
		 * 就是「Host 与卡片两侧各有一行 const NAME = "..."」。抽成单一来源会让
		 * 这条比对失效，而它挡的是真实事故 —— 一侧改了路径另一侧没改，
		 * 表现是按钮点了没反应，而接口返回 404。
		 */
		const POOL_COMPENSATION_PATH = "/plugins/dsh-rotakit/compensation";
		const POOL_COMPENSATION_CLAIM_PATH = "/plugins/dsh-rotakit/compensation/claim";
		const POOL_GIFT_PATH = "/plugins/dsh-rotakit/gift";
		const POOL_GIFT_CLAIM_PATH = "/plugins/dsh-rotakit/gift/claim";
		const POOL_REWARDS_ALL_PATH = "/plugins/dsh-rotakit/rewards/claim-all";

		const ROUTES = {
		  status: '/plugins/dsh-rotakit/status',
		  rescan: '/plugins/dsh-rotakit/accounts/rescan',
		  resetCooldown: '/plugins/dsh-rotakit/cooldowns/reset',
		  checkin: '/plugins/dsh-rotakit/checkin',
		  automationRun: '/plugins/dsh-rotakit/automation/run',
		  accountDisabled: '/plugins/dsh-rotakit/accounts/disabled',
		  creditReserve: '/plugins/dsh-rotakit/accounts/credit-reserve',
		  rewardsStatus: POOL_COMPENSATION_PATH,
		  rewardsClaim: POOL_COMPENSATION_CLAIM_PATH,
		  rewardsGift: POOL_GIFT_PATH,
		  rewardsGiftClaim: POOL_GIFT_CLAIM_PATH,
		  /** 一键领取：遍历全池，补偿与礼包都领掉（2.4.0 新增）。 */
		  rewardsClaimAll: POOL_REWARDS_ALL_PATH,
		  accountImport: '/plugins/dsh-rotakit/accounts/import',
		  accountRename: '/plugins/dsh-rotakit/accounts/rename',
		  oauthStart: '/plugins/dsh-rotakit/oauth/start',
		  oauthPoll: '/plugins/dsh-rotakit/oauth/poll',
		  version: '/plugins/dsh-rotakit/version',
		  update: '/plugins/dsh-rotakit/update',
		  rollback: '/plugins/dsh-rotakit/rollback',
		  modelsSave: '/plugins/dsh-rotakit/models/save',
		  /* ── 2.4.0 Pro 路由 ── */
		  keys: '/plugins/dsh-rotakit/api-keys',
		  keysCreate: '/plugins/dsh-rotakit/api-keys/create',
		  keysUpdate: '/plugins/dsh-rotakit/api-keys/update',
		  keysDelete: '/plugins/dsh-rotakit/api-keys/delete',
		  keysRotate: '/plugins/dsh-rotakit/api-keys/rotate',
		  audit: '/plugins/dsh-rotakit/audit',
		  auditSummary: '/plugins/dsh-rotakit/audit/summary',
		  stream: '/plugins/dsh-rotakit/status-stream',
		  settings: '/plugins/dsh-rotakit/settings',
		};

		/**
		 * 写操作必须声明 JSON，且带 loopback Origin —— 后端的防跨站校验要求
		 * （docs/02 §六）。
		 */
		async function post(path, body) {
		  const res = await fetch(path, {
		    method: 'POST',
		    headers: { 'Content-Type': 'application/json' },
		    body: JSON.stringify(body ?? {}),
		  });
		  const text = await res.text();
		  let parsed;
		  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
		  if (!res.ok) {
		    throw new Error((parsed !== undefined && parsed.error) || `HTTP ${res.status}`);
		  }
		  return parsed;
		}

		/** GET + JSON，失败时抛错（调用方决定怎么降级）。 */
		async function get(path) {
		  const res = await fetch(path);
		  const text = await res.text();
		  let parsed;
		  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
		  if (!res.ok) {
		    throw new Error((parsed !== undefined && parsed.error) || `HTTP ${res.status}`);
		  }
		  return parsed;
		}

		/**
		 * 从 status 文档算出概览指标。
		 *
		 * 注意：这里【不做分位数平均】。样本不足的分位线应该隐藏而不是编一个出来
		 * （docs/05 §3.5，Prometheus 官方明确 avg(quantile) 是错的）。
		 */
		function summarize(status) {
		  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
		  const models = Array.isArray(status?.models) ? status.models : [];
		  const usage = status?.usage ?? {};
		  const summary = status?.summary ?? {};
		  const total = accounts.length;
		  const usable = accounts.filter((a) => a.disabled !== true && a.cooling !== true
		    && a.authDead !== true && a.restricted !== true).length;
		  /*
		   * 两种「不可用」的原因必须分开统计。
		   *   authDead   = token 被吊销（invalid_grant），只能重登
		   *   restricted = token 有效但被限流，等一等会自己恢复
		   * 合成一个 broken 会让用户不知道该等还是该重登。
		   */
		  const cooling = accounts.filter((a) => a.cooling === true).length;
		  const authDead = accounts.filter((a) => a.authDead === true).length;
		  const restricted = accounts.filter((a) => a.restricted === true).length;
		  const broken = authDead + restricted;
		  return {
		    accounts: total,
		    usable,
		    cooling,
		    broken,
		    authDead,
		    restricted,
		    models: models.length,
		    enabledModels: models.filter((m) => m.enabled === true).length,
		    healthPct: total === 0 ? 0 : Math.round((usable / total) * 100),
		    spendToday: usage.today ?? 0,
		    spend7d: usage.last7 ?? 0,
		    remain: usage.remaining,
		    requests: status?.requests?.length ?? 0,
		    shimRunning: status?.shim?.running === true,
		    baseUrl: status?.shim?.baseUrl,
		    rateLimitHits: summary.rateLimitHits ?? 0,
		    serverErrorHits: summary.serverErrorHits ?? 0,
		    /*
		     * 14 天消耗：`status.trend` 是 { days, points:[{date,used}], max, total }，
		     * 不是数组。旧面板把它当数组读，结果趋势条永远是空的 —— 后端从 2.3.26
		     * 起就是对象形状，前端从未跟上。
		     */
		    trendPoints: Array.isArray(status?.trend?.points) ? status.trend.points : [],
		    trendMax: Number(status?.trend?.max) || 0,
		    distribution: status?.distribution ?? 'priority',
		    usageStats: Array.isArray(status?.usageStats) ? status.usageStats : [],
		    queueStats: Array.isArray(status?.queueStats) ? status.queueStats : [],
		    outputProbes: Array.isArray(status?.outputProbes) ? status.outputProbes : [],
		    automation: status?.automation,
		    serverErrors: status?.serverErrors,
		  };
		}

		/**
		 * 构造面板组件。
		 *
		 * @param {object} react  宿主注入的 react
		 * @param {object} UI     createUI(react) 的产物
		 * @param {object} opts   { t, formatDuration, formatCount, accountState, theme, onTheme }
		 */
		function createPanel(react, UI, opts = {}) {
		  const h = react.createElement;
		  const { useState, useEffect, useMemo, useCallback, useRef } = react;
		  const { t } = opts;
		  const tr = (key, fallback) => {
		    /*
		     * 语言包的坑：`t?.(k) ?? "兜底"` 的兜底【不会生效】—— 键缺失时 t 返回
		     * 的是键名本身，不是 undefined，于是屏幕上直接显示 "row.xxx"。
		     * 所以这里显式判断返回值是否等于 key。
		     */
		    const v = typeof t === 'function' ? t(key) : undefined;
		    return (typeof v === 'string' && v !== '' && v !== key) ? v : fallback;
		  };
		  const accState = opts.accountState ?? UI.accountState;
		  const fmtDur = opts.formatDuration ?? UI.formatDuration;
		  const fmtCnt = opts.formatCount ?? UI.formatCount;

		  /** 积分一律两位小数：上游给的就是小数，四舍五入成整数会让"还剩 0.4 分"看起来像 0。 */
		  const fmtCredits = (value) => {
		    const n = Number(value);
		    if (!Number.isFinite(n)) return '—';
		    return (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
		  };
		  /** 毫秒 → 短串。样本不足时后端给 undefined，这里原样返回 '—'。 */
		  const fmtMs = (ms) => (Number.isFinite(Number(ms)) ? fmtDur(Number(ms)) : '—');
		  /** 「输出速度」列头：中文下用「 tok/s」，英文用 "tok/s"。 */
		  const tokPersSecondLabel = () => tr('rk.o.tps', '速度');

		/* ═══════════════════════════════════════════════════════════
		   页面公共工具
		   ═══════════════════════════════════════════════════════════ */

		/** 卡片：标题 + 副标题 + 右侧操作。 */
		function Card({ title, sub, actions, children, foot }) {
		  return h('div', { className: 'rk-card' },
		    title === undefined && sub === undefined ? null
		      : h('div', { className: 'rk-card-head' },
		        h('h3', { className: 'rk-card-title' }, title),
		        sub === undefined ? null : h('span', { className: 'rk-card-sub' }, sub),
		        h('span', { className: 'rk-spacer' }),
		        actions),
		    h('div', { className: 'rk-card-body' }, children),
		    foot === undefined ? null : h('div', { className: 'rk-card-foot' }, foot));
		}

		/** 操作按钮。`busy` 由 Panel 统一传入，禁用整组操作。 */
		function ActionBtn({ label, onClick, disabled, kind, icon }) {
		  return h('button', {
		    type: 'button',
		    className: `rk-btn${kind === undefined ? '' : ` rk-btn--${kind}`}`,
		    disabled: disabled === true,
		    onClick,
		  }, icon === undefined ? null : h(UI.Icon, { name: icon, size: 13 }), label);
		}

		/* ═══════════════════════════════════════════════════════════
		   概览
		   ═══════════════════════════════════════════════════════════ */

		function Overview({ status, s, onAction, busy }) {
		  const spark = s.trendPoints.map((point) => Number(point.used) || 0);
		  const sparkLabels = s.trendPoints.map((point) => `${point.date}：${String(point.used)}`);
		  const regions = Array.isArray(status?.regions) ? status.regions : [];

		  return h('div', null,
		    /* 六个 headline 指标：一屏看完池子现在的状况 */
		    h('div', { className: 'rk-metrics' },
		      h(UI.MetricCard, {
		        label: tr('rk.m.accounts', '账号总数'),
		        value: s.accounts,
		        hint: tr('rk.m.accountsHint', '自动发现的登录态快照'),
		      }),
		      h(UI.MetricCard, {
		        label: tr('rk.m.usable', '可用账号'),
		        value: s.usable,
		        delta: s.accounts === 0 ? undefined : undefined,
		        hint: `${tr('rk.m.health', '健康度')} ${s.healthPct}%`,
		      }),
		      h(UI.MetricCard, {
		        label: tr('rk.m.enabledModels', '启用模型'),
		        value: s.enabledModels,
		        hint: `${tr('rk.m.modelsTotal', '共')} ${s.models} ${tr('rk.m.models', '个')}`,
		      }),
		      h(UI.MetricCard, {
		        label: tr('rk.m.spendToday', '今日消耗'),
		        value: fmtCredits(s.spendToday),
		        unit: '分',
		        direction: TREND_DIRECTION.spend,
		        spark: spark.length > 1 ? { values: spark, max: s.trendMax || undefined, labels: sparkLabels } : undefined,
		      }),
		      h(UI.MetricCard, {
		        label: tr('rk.m.remain', '池内剩余积分'),
		        value: s.remain === undefined ? '—' : fmtCredits(s.remain),
		        unit: '分',
		        hint: s.remain === undefined ? tr('rk.m.remainUnknown', '尚未取得上游读数') : undefined,
		      }),
		      h(UI.MetricCard, {
		        label: tr('rk.m.requests', '本地请求记录'),
		        value: s.requests,
		        hint: s.shimRunning === true ? s.baseUrl : tr('rk.m.shimStopped', '本地网关未运行'),
		      })),

		    /* 一键操作：所有会改状态的动作集中在这里，避免散落各页 */
		    h(Card, {
		      title: tr('rk.o.actions', '一键操作'),
		      sub: tr('rk.o.actionsSub', '改状态的操作都会经过确认'),
		    },
		      h('div', { className: 'rk-toolbar' },
		        h(ActionBtn, { label: tr('rk.o.rescan', '重新扫描账号'), icon: 'refresh', disabled: busy, onClick: () => onAction('rescan') }),
		        h(ActionBtn, { label: tr('rk.o.runAll', '立即执行全部任务'), icon: 'play', disabled: busy, onClick: () => onAction('runAutomation') }),
		        h(ActionBtn, { label: tr('rk.o.claimAll', '一键领取补偿与礼包'), icon: 'download', disabled: busy, onClick: () => onAction('claimAllRewards') }),
		        h(ActionBtn, { label: tr('rk.o.clearCooldown', '清除全部冷却'), icon: 'close', disabled: busy, onClick: () => onAction('resetCooldown') }))),

		    /* 健康度按模型分布：回答「现在能跑什么」 */
		    h(Card, { title: tr('rk.o.byModel', '按模型可服务账号数'), sub: tr('rk.o.byModelSub', '为 0 的模型暂时没人能服务') },
		      status?.models === undefined || status.models.length === 0
		        ? h(UI.EmptyState, { kind: 'empty', title: tr('rk.o.noModels', '还没有模型目录') })
		        : h('div', { className: 'rk-table-wrap' },
		            h('table', { className: 'rk-table' },
		              h('thead', null, h('tr', null,
		                h('th', null, tr('rk.o.modelId', '模型')),
		                h('th', { className: 'rk-col-hide-sm' }, tr('rk.o.modelName', '名称')),
		                h('th', null, tr('rk.o.multiplier', '倍率')),
		                h('th', { className: 'rk-col-num' }, tr('rk.o.servable', '可服务')),
		                h('th', { className: 'rk-col-num' }, tr('rk.o.modelState', '状态')))),
		              h('tbody', null, status.models.map((m) => {
		                const servable = Number(m.servableAccounts ?? 0);
		                return h('tr', { key: m.id },
		                  h('td', { className: 'rk-col-id' }, m.id),
		                  h('td', { className: 'rk-col-hide-sm' }, m.name ?? '—'),
		                  h('td', { className: 'rk-kv-value--num' }, m.multiplier === undefined ? '—' : String(m.multiplier)),
		                  h('td', { className: 'rk-col-num' }, String(servable)),
		                  h('td', { className: 'rk-col-num' },
		                    m.enabled !== true
		                      ? h(UI.Badge, { kind: 'idle', icon: '⏸' }, tr('rk.o.disabled', '未启用'))
		                      : servable === 0
		                        ? h(UI.Badge, { kind: 'bad', icon: '✕' }, tr('rk.o.noAccount', '无可用账号'))
		                        : h(UI.Badge, { kind: 'ok', icon: '✓' }, tr('rk.o.serving', '可服务'))));
		              }))))),

		    /* 排队与输出速度：用数据选模型 */
		    s.queueStats.length === 0 ? null
		      : h(Card, { title: tr('rk.o.queue', '排队时长与输出速度'), sub: tr('rk.o.queueSub', '按 p50 排队时长排序，只统计成功请求') },
		          h('div', { className: 'rk-table-wrap' },
		            h('table', { className: 'rk-table' },
		              h('thead', null, h('tr', null,
		                h('th', null, tr('rk.o.modelId', '模型')),
		                h('th', { className: 'rk-col-num' }, tr('rk.o.samples', '样本')),
		                h('th', { className: 'rk-col-num' }, tr('rk.o.p50', '排队 p50')),
		                h('th', { className: 'rk-col-num' }, tr('rk.o.p95', '排队 p95')),
		                h('th', { className: 'rk-col-num' }, tr('rk.o.tps', tokPersSecondLabel())))),
		              h('tbody', null, s.queueStats.map((q) =>
		                h('tr', { key: q.region + q.model },
		                  h('td', { className: 'rk-col-id' }, q.model),
		                  h('td', { className: 'rk-col-num' }, String(q.samples ?? 0)),
		                  h('td', { className: 'rk-col-num' }, fmtMs(q.p50Ms)),
		                  h('td', { className: 'rk-col-num' }, fmtMs(q.p95Ms)),
		                  h('td', { className: 'rk-col-num' }, q.tokensPerSecondP50 === undefined ? '—' : String(Math.round(q.tokensPerSecondP50))))))))),

		    /* 双区域：后端给的是 ['cn','global'] 这样的字符串数组，不是对象 */
		    Array.isArray(status?.regions) && status.regions.length > 0
		      ? regionCard(status.regions, tr)
		      : null);
		}

		/** 双区域卡。抽成函数是因为它嵌套深，内联写容易多写或少写一个括号。 */
		function regionCard(regions, label) {
		  const items = regions.map((r) => {
		    const id = typeof r === 'string' ? r : String(r?.region ?? '?');
		    return h('span', {
		      key: id,
		      className: 'rk-flash rk-flash--info',
		    },
		      h('span', { className: 'rk-dot rk-dot--warn' }),
		      id === 'global' ? '国际版' : id === 'cn' ? '国内版' : id);
		  });
		  return h(Card, { title: label('rk.o.regions', '双区域'), sub: label('rk.o.regionsSub', '国内版与国际版各自独立') },
		    h('div', { className: 'rk-inline' }, items));
		}

		/* ═══════════════════════════════════════════════════════════
		   账号
		   ═══════════════════════════════════════════════════════════ */

		/** 筛选选项：四种状态 + 全部。 */
		const ACCOUNT_FILTERS = [
		  { value: 'all', label: '全部账号' },
		  { value: 'usable', label: '仅可用' },
		  { value: 'cooling', label: '冷却中' },
		  { value: 'broken', label: '失效 / 受限' },
		  { value: 'disabled', label: '已停用' },
		];

		function matchesFilter(acc, filter) {
		  if (filter === 'all') return true;
		  if (filter === 'usable') {
		    return acc.disabled !== true && acc.cooling !== true && acc.authDead !== true && acc.restricted !== true;
		  }
		  if (filter === 'cooling') return acc.cooling === true;
		  if (filter === 'broken') return acc.authDead === true || acc.restricted === true;
		  if (filter === 'disabled') return acc.disabled === true;
		  return true;
		}

		function Accounts({ status, now, onAction, busy }) {
		  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
		  const [query, setQuery] = useState('');
		  const [filter, setFilter] = useState('all');
		  const [sortKey, setSortKey] = useState('state');
		  const [sortDir, setSortDir] = useState('asc');
		  const [selected, setSelected] = useState(() => new Set());
		  const [renaming, setRenaming] = useState(undefined);
		  const [renameText, setRenameText] = useState('');
		  /* 粘贴导入对话框是否展开。默认关着：没点按钮时不应该占屏幕。 */
		  const [importOpen, setImportOpen] = useState(false);
		  /* 粘贴框里的原始文本。关掉对话框时清空，避免下次打开还留着上一次的内容。 */
		  const [pasteText, setPasteText] = useState('');

		  const filtered = useMemo(() => {
		    const q = query.trim().toLowerCase();
		    const list = accounts.filter((acc) => {
		      if (!matchesFilter(acc, filter)) return false;
		      if (q === '') return true;
		      return String(acc.label ?? '').toLowerCase().includes(q)
		        || String(acc.id ?? '').toLowerCase().includes(q)
		        || String(acc.nickname ?? '').toLowerCase().includes(q)
		        || String(acc.phoneNumber ?? '').toLowerCase().includes(q);
		    });
		    return list;
		  }, [accounts, query, filter]);

		  const sorted = useMemo(() => {
		    const list = [...filtered];
		    const dir = sortDir === 'asc' ? 1 : -1;
		    list.sort((a, b) => {
		      const va = ACCOUNT_SORTS[sortKey]?.valueOf(a) ?? '';
		      const vb = ACCOUNT_SORTS[sortKey]?.valueOf(b) ?? '';
		      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
		      return String(va).localeCompare(String(vb)) * dir;
		    });
		    return list;
		  }, [filtered, sortKey, sortDir]);

		  const toggleRow = useCallback((id) => {
		    setSelected((prev) => {
		      const next = new Set(prev);
		      if (next.has(id)) next.delete(id);
		      else next.add(id);
		      return next;
		    });
		  }, []);
		  const toggleAll = useCallback((wantAll) => {
		    setSelected(wantAll ? new Set(sorted.map((a) => a.id)) : new Set());
		  }, [sorted]);

		  const columns = [
		    { key: 'state', label: tr('rk.a.state', '状态'), sortable: true, valueOf: (a) => accountState(a, now).label, render: (a) => h(UI.StateBadge, { state: accountState(a, now) }) },
		    { key: 'label', label: tr('rk.a.label', '账号'), sortable: true, valueOf: (a) => a.label ?? '', render: (a) => h('span', { style: { fontWeight: 600, color: 'var(--rk-fg-1)' } }, a.label ?? a.id) },
		    { key: 'region', label: tr('rk.a.region', '区域'), hideOnNarrow: true, sortable: true, valueOf: (a) => a.region ?? '', render: (a) => h(UI.Badge, { kind: 'idle' }, (a.region ?? status?.region) === 'global' ? '国际' : '国内') },
		    { key: 'credits', label: tr('rk.a.credits', '余额'), align: 'end', sortable: true, numeric: true, valueOf: (a) => creditsTotal(a) ?? 0, render: (a) => creditsTotal(a) === undefined ? '—' : fmtCredits(creditsTotal(a)) },
		    { key: 'reserve', label: tr('rk.a.reserve', '保留线'), align: 'end', hideOnNarrow: true, sortable: true, valueOf: (a) => Number(a.creditReserve) || 0, render: (a) => a.creditReserve === undefined || a.creditReserve === 0 ? h('span', { className: 'rk-cell-empty' }) : fmtCredits(a.creditReserve) },
		    { key: 'lastUsedAt', label: tr('rk.a.lastUsed', '最近使用'), hideOnNarrow: true, sortable: true, valueOf: (a) => (a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0), render: (a) => a.lastUsedAt === undefined ? h('span', { className: 'rk-cell-empty' }) : formatWhen(a.lastUsedAt) },
		    { key: 'hits', label: tr('rk.a.hits', '限流次数'), align: 'end', hideOnNarrow: true, sortable: true, valueOf: (a) => Number(a.rateLimitHits) || 0, render: (a) => String(a.rateLimitHits ?? 0) },
		    {
		      key: 'actions', label: tr('rk.a.actions', '操作'),
		      render: (a) => h('span', { className: 'rk-toolbar', style: { justifyContent: 'flex-end', gap: '4px' } },
		        h('button', {
		          type: 'button', className: 'rk-btn rk-btn--sm rk-row-action',
		          onClick: () => { setRenaming(a.id); setRenameText(a.label ?? a.id); },
		          title: tr('rk.a.rename', '改名'),
		        }, tr('rk.a.renameShort', '改名')),
		        a.disabled === true
		          ? h('button', {
		              type: 'button', className: 'rk-btn rk-btn--sm rk-row-action',
		              disabled: busy, onClick: () => onAction('enable', a.id),
		              title: tr('rk.a.enable', '重新启用'),
		            }, tr('rk.a.enableShort', '启用'))
		          : h('button', {
		              type: 'button', className: 'rk-btn rk-btn--sm rk-row-action',
		              disabled: busy, onClick: () => onAction('disable', a.id),
		              title: tr('rk.a.disable', '停用该账号'),
		            }, tr('rk.a.disableShort', '停用')),
		        a.authDead === true
		          ? h('button', {
		              type: 'button', className: 'rk-btn rk-btn--sm rk-btn--primary rk-row-action',
		              disabled: busy, onClick: () => onAction('relogin'),
		              title: tr('rk.a.reloginHint', '扫码重新登录（同一账号会换新凭据，不会多出一个号）'),
		            }, tr('rk.a.relogin', '重新扫码'))
		          : null,
		        a.cooling === true
		          ? h('button', {
		              type: 'button', className: 'rk-btn rk-btn--sm rk-row-action',
		              disabled: busy, onClick: () => onAction('resetCooldown'),
		              title: tr('rk.a.clearCool', '清除冷却'),
		            }, tr('rk.a.clear', '清冷却'))
		          : null),
		    },
		  ];

		  const onSort = useCallback((key, dir) => { setSortKey(key); setSortDir(dir); }, []);

		  return h('div', null,
		    h(UI.Toolbar, {
		      value: query,
		      onChange: setQuery,
		      placeholder: tr('rk.a.search', '搜索账号名 / ID / 手机号'),
		      filters: [{ key: 'state', label: tr('rk.a.filterLabel', '按状态筛选'), value: filter, options: ACCOUNT_FILTERS.map((f) => ({ value: f.value, label: tr(`rk.a.filter.${f.value}`, f.label) })), onChange: setFilter }],
		    },
		      h(ActionBtn, { label: tr('rk.o.rescan', '重新扫描账号'), icon: 'refresh', disabled: busy, onClick: () => onAction('rescan') }),
		      /*
		       * 添加账号的两个入口。
		       *
		       * 历史上只有「这一行需要重新登录」时才看得到扫码按钮（挂在失效
		       * 账号的行上），池子健康的用户永远找不到入口。这两个按钮把它
		       * 提到工具栏，扫码走已有的 ReloginDialog，粘贴走新加的导入路由。
		       */
		      h(ActionBtn, { label: tr('rk.a.addByScan', '扫码添加'), icon: 'plus', kind: 'primary', disabled: busy, onClick: () => onAction('addByScan') }),
		      h(ActionBtn, { label: tr('rk.a.addByPaste', '粘贴添加'), icon: 'plus', disabled: busy, onClick: () => setImportOpen(true) }),
		      selected.size > 0
		        ? h(ActionBtn, { label: `${tr('rk.a.disableSelected', '停用所选')} (${String(selected.size)})`, kind: 'danger', disabled: busy, onClick: () => { for (const id of selected) onAction('disable', id); setSelected(new Set()); } })
		        : null,
		      selected.size > 0
		        ? h(ActionBtn, { label: tr('rk.a.enableSelected', '启用所选'), disabled: busy, onClick: () => { for (const id of selected) onAction('enable', id); setSelected(new Set()); } })
		        : null),

		    accounts.length === 0
		      ? h('div', { className: 'rk-card' }, h('div', { className: 'rk-card-body' },
		          h(UI.EmptyState, {
		            kind: 'empty',
		            title: tr('rk.a.none', '还没有发现任何账号'),
		            note: tr('rk.a.noneNote', '插件读的是 WorkBuddy 桌面客户端留在本机的登录态快照。先在桌面端登录，然后点「重新扫描账号」。'),
		            actionLabel: tr('rk.o.rescan', '重新扫描账号'),
		            onAction: () => onAction('rescan'),
		          })))
		      : h(UI.DataTable, {
		          columns,
		          rows: sorted,
		          rowKey: (a) => a.id,
		          selectable: true,
		          selectedIds: selected,
		          onToggleRow: toggleRow,
		          onToggleAll: toggleAll,
		          sortKey, sortDir, onSort,
		          emptyKind: 'filtered',
		          emptyTitle: tr('rk.a.noMatch', '没有匹配的账号'),
		        }),

		    renaming === undefined ? null
		      : h('div', { className: 'rk-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('rk.a.rename', '改名') },
		          h('div', { className: 'rk-modal-panel' },
		            h('h3', { className: 'rk-card-title' }, tr('rk.a.renameTitle', '给账号起个名字')),
		            h('p', { className: 'rk-empty-note', style: { margin: '8px 0' } }, tr('rk.a.renameNote', '名字只影响卡片显示，不改动任何登录态文件。留空则恢复原名。')),
		            h('input', {
		              className: 'rk-input', value: renameText,
		              'aria-label': tr('rk.a.rename', '改名'),
		              onChange: (e) => setRenameText(e.target.value),
		            }),
		            h('div', { className: 'rk-toolbar', style: { justifyContent: 'flex-end', marginTop: '16px' } },
		              h('button', { type: 'button', className: 'rk-btn', onClick: () => setRenaming(undefined) }, tr('rk.cancel', '取消')),
		              h('button', {
		                type: 'button', className: 'rk-btn rk-btn--primary',
		                onClick: () => { onAction('rename', { accountId: renaming, label: renameText }); setRenaming(undefined); },
		              }, tr('rk.save', '保存')))),
		  /*
		   * 粘贴导入对话框。
		   *
		   * 不做实时校验：用户粘的就是一大块 JSON，边输边报错只会闪烁。
		   * 点击提交后由后端给出具体原因（不是 JSON / 顶层不是对象 /
		   * 里面没有可用的 token），那比前端猜得准。
		   */
		  importOpen === false ? null : h(UI.Modal, {
		    title: tr('rk.a.pasteTitle', '粘贴凭据添加账号'),
		    onClose: () => setImportOpen(false),
		  },
		    h('div', { className: 'rk-field' },
		      h('div', { className: 'rk-field-label' }, tr('rk.a.pasteLabel', '凭据内容')),
		      h('textarea', {
		        className: 'rk-input rk-textarea',
		        rows: 10,
		        spellCheck: false,
		        placeholder: tr('rk.a.pastePlaceholder', '粘贴一份 .info 文件的完整内容，或 { "auth": { ... } } 这一层'),
		        value: pasteText,
		        onChange: (e) => setPasteText(e.target.value),
		      }),
		      h('div', { className: 'rk-field-note' }, tr('rk.a.pasteNote', '内容只存在本机，写进 WorkBuddy 的凭据目录，不会上传到任何地方。')),
		    ),
		    h('div', { className: 'rk-modal-actions' },
		      h('button', { type: 'button', className: 'rk-btn', onClick: () => setImportOpen(false) }, tr('rk.cancel', '取消')),
		      h('button', {
		        type: 'button', className: 'rk-btn rk-btn--primary',
		        disabled: busy || pasteText.trim() === '',
		        onClick: () => { onAction('importAccount', { document: pasteText }); setImportOpen(false); },
		      }, tr('rk.a.pasteSubmit', '添加')),
		    ))));
		}

		/** 账号表的排序列定义。`state` 按状态排序时用「可用优先」的次序。 */
		const STATE_ORDER = { ok: 0, info: 1, warn: 2, idle: 3, bad: 4, unknown: 5 };
		const ACCOUNT_SORTS = {
		  state: { valueOf: (a) => STATE_ORDER[accountState(a, Date.now()).kind] ?? 9 },
		  label: { valueOf: (a) => String(a.label ?? a.id ?? '') },
		  region: { valueOf: (a) => String(a.region ?? '') },
		  credits: { valueOf: (a) => creditsTotal(a) ?? 0 },
		  reserve: { valueOf: (a) => Number(a.creditReserve) || 0 },
		  lastUsedAt: { valueOf: (a) => (a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0) },
		  hits: { valueOf: (a) => Number(a.rateLimitHits) || 0 },
		};

		/* ═══════════════════════════════════════════════════════════
		   任务
		   ═══════════════════════════════════════════════════════════ */

		const JOB_KINDS = [
		  { key: 'checkin', hoursKey: 'checkinHours', label: '每日签到' },
		  { key: 'report', hoursKey: 'reportHours', label: '活跃上报' },
		  { key: 'tasks', hoursKey: 'taskHours', label: '任务奖励' },
		  { key: 'streak', hoursKey: 'streakHours', label: '连登奖励' },
		  { key: 'travel', hoursKey: 'travelHours', label: '猫猫旅行' },
		];

		function Tasks({ status, onAction, busy }) {
		  const automation = status?.automation;
		  if (automation === undefined || automation === null) {
		    return h('div', { className: 'rk-card' }, h('div', { className: 'rk-card-body' }, h(UI.Skeleton, { rows: 4 })));
		  }
		  const jobs = automation.jobs ?? {};
		  /* 宿主发的是 `{accountId: {...}}` 映射，旧文档才是 `{accounts:[], totals:{}}` —— 两种都归一成数组。 */
		  const earnings = automation.earningsToday ?? {};
		  const ledger = Array.isArray(earnings.accounts)
		    ? earnings.accounts
		    : Object.entries(earnings)
		      .filter(([, value]) => value !== null && typeof value === 'object')
		      .map(([accountId, value]) => ({
		        accountId,
		        label: (status.accounts ?? []).find((a) => a.id === accountId)?.label ?? accountId,
		        ...value,
		      }));
		  const totals = earnings.totals ?? { credit: ledger.reduce((sum, row) => sum + (Number(row.credit) || 0), 0) };

		  const metrics = h('div', { className: 'rk-metrics' },
		    h(UI.MetricCard, {
		      label: tr('rk.t.enabled', '自动任务'),
		      value: automation.enabled === true ? tr('rk.t.on', '已开启') : tr('rk.t.off', '已关闭'),
		      hint: automation.running === true ? tr('rk.t.running', '正在执行…') : undefined,
		    }),
		    h(UI.MetricCard, { label: tr('rk.t.creditToday', '今日领取积分'), value: fmtCredits(totals.credit ?? 0), unit: '分' }),
		    h(UI.MetricCard, { label: tr('rk.t.seenToday', '今日已签账号'), value: ledger.length, hint: tr('rk.t.seenHint', '按账号统计') }));

		  const jobRows = JOB_KINDS.map((kind) => {
		    const job = jobs[kind.key];
		    if (job === undefined) return null;
		    /* 时刻存在 automation.<kind>Hours 上（checkinHours / taskHours / …），行里没有 hours —— 两边都认。 */
		    const scheduledHours = Array.isArray(job.hours) ? job.hours : automation[kind.hoursKey];
		    const hours = Array.isArray(scheduledHours) ? scheduledHours : [];
		    const lastAt = job.lastAt ?? (job.lastRunAtMs === undefined ? undefined : new Date(job.lastRunAtMs).toISOString());
		    const failedRuns = Number(job.failed) || 0;
		    return h('tr', { key: kind.key },
		      h('td', null, tr(`rk.t.job.${kind.key}`, kind.label)),
		      h('td', { className: 'rk-col-hide-sm rk-kv-value--num' },
		        hours.length === 0 ? '—' : hours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join(' / ')),
		      h('td', { className: 'rk-col-hide-sm' },
		        lastAt === undefined ? h('span', { className: 'rk-cell-empty' }) : formatWhen(lastAt)),
		      h('td', null, h(UI.Badge, {
		        kind: job.ok === false || failedRuns > 0 ? 'bad' : 'ok',
		        icon: job.ok === false || failedRuns > 0 ? '✕' : '✓',
		      }, job.ok === false ? (job.error ?? tr('rk.t.failed', '失败'))
		        : failedRuns > 0 ? `${tr('rk.t.failed', '失败')} ${String(failedRuns)}`
		        : tr('rk.t.ok', '正常'))));
		  }).filter(Boolean);

		  const jobsCard = h(Card, {
		    title: tr('rk.t.jobs', '任务排期'),
		    sub: tr('rk.t.jobsSub', '每项可独立设定执行时刻'),
		    actions: h(ActionBtn, {
		      label: tr('rk.t.runNow', '立即执行全部'),
		      icon: 'play',
		      disabled: busy || automation.runInProgress === true,
		      onClick: () => onAction('runAutomation'),
		    }),
		  }, jobRows.length === 0
		      ? h(UI.EmptyState, { kind: 'empty', title: tr('rk.t.noJobs', '还没有排期') })
		      : h('div', { className: 'rk-table-wrap' },
		          h('table', { className: 'rk-table' },
		            h('thead', null, h('tr', null,
		              h('th', null, tr('rk.t.jobName', '任务')),
		              h('th', { className: 'rk-col-hide-sm' }, tr('rk.t.when', '执行时刻')),
		              h('th', { className: 'rk-col-hide-sm' }, tr('rk.t.last', '上次执行')),
		              h('th', null, tr('rk.t.state', '状态')))),
		            h('tbody', null, jobRows))));

		  let ledgerCard = null;
		  if (ledger.length > 0) {
		    const ledgerRows = ledger.map((row) => h('tr', { key: String(row.accountId ?? row.id ?? '') },
		      h('td', null, row.label ?? row.accountId ?? '—'),
		      h('td', { className: 'rk-col-num' }, fmtCredits(Number(row.credit) || 0)),
		      h('td', { className: 'rk-col-num rk-col-hide-sm' }, fmtCredits(Number(row.checkinCredit) || 0)),
		      h('td', { className: 'rk-col-num rk-col-hide-sm' }, fmtCredits(Number(row.bonusCredit) || 0)),
		      h('td', { className: 'rk-col-num rk-col-hide-sm' }, fmtCredits(Number(row.travelCredit) || 0)),
		      h('td', { className: 'rk-col-hide-sm' },
		        row.checkinSeenAtMs === undefined
		          ? h('span', { className: 'rk-cell-empty' })
		          : formatWhen(new Date(Number(row.checkinSeenAtMs)).toISOString()))));
		    ledgerCard = h(Card, {
		      title: tr('rk.t.perAccount', '按账号收益'),
		      sub: tr('rk.t.perAccountSub', '本次领到与发现已领分开统计'),
		    }, h('div', { className: 'rk-table-wrap' },
		        h('table', { className: 'rk-table' },
		          h('thead', null, h('tr', null,
		            h('th', null, tr('rk.a.label', '账号')),
		            h('th', { className: 'rk-col-num' }, tr('rk.t.credit', '积分')),
		            h('th', { className: 'rk-col-num rk-col-hide-sm' }, tr('rk.t.checkin', '签到')),
		            h('th', { className: 'rk-col-num rk-col-hide-sm' }, tr('rk.t.bonus', '连登')),
		            h('th', { className: 'rk-col-num rk-col-hide-sm' }, tr('rk.t.travel', '旅行')),
		            h('th', { className: 'rk-col-hide-sm' }, tr('rk.t.seenAt', '发现时刻')))),
		          h('tbody', null, ledgerRows))));
		  }

		  return h('div', null, metrics, jobsCard, ledgerCard);
		}

		/* ═══════════════════════════════════════════════════════════
		   流水
		   ═══════════════════════════════════════════════════════════ */

		function Stream({ status }) {
		  const requests = Array.isArray(status?.requests) ? status.requests : [];
		  const log = status?.requestLog;

		  return h('div', null,
		    h(Card, {
		      title: tr('rk.s.title', '请求流水'),
		      sub: tr('rk.s.sub', '最新在前；贴底时自动跟随，上滚后冻结'),
		      actions: h('span', { className: 'rk-card-sub' }, log?.file === undefined ? null : log.file),
		    },
		      requests.length === 0
		        ? h(UI.EmptyState, { kind: 'empty', title: tr('rk.s.none', '还没有请求记录'), note: tr('rk.s.noneNote', '有请求经过本地网关后，这里会出现每一条的时间、模型、账号与结果。') })
		        : h('div', { className: 'rk-table-wrap', style: { maxHeight: '420px' } },
		            h('table', { className: 'rk-table' },
		              h('thead', null, h('tr', null,
		                h('th', null, tr('rk.s.result', '结果')),
		                h('th', null, tr('rk.s.model', '模型')),
		                h('th', { className: 'rk-col-hide-sm' }, tr('rk.s.account', '账号')),
		                h('th', { className: 'rk-col-num rk-col-hide-sm' }, tr('rk.s.total', '总耗时')),
		                h('th', { className: 'rk-col-num rk-col-hide-sm' }, tr('rk.s.queue', '排队')),
		                h('th', { className: 'rk-col-num rk-col-hide-sm' }, tr('rk.s.first', '首字')),
		                h('th', { className: 'rk-col-num' }, tr('rk.s.tokens', 'token')),
		                h('th', { className: 'rk-col-num rk-col-hide-sm' }, tr('rk.s.tries', '轮换')),
		                h('th', { className: 'rk-col-hide-sm' }, tr('rk.s.at', '时间')))),
		              h('tbody', null, requests.map((row, i) => {
		                const outcome = requestOutcome(row, tr);
		                return h('tr', { key: i },
		                  h('td', null, h('span', { className: `rk-badge rk-badge--${outcome.tone}`, title: outcome.detail },
		                    h('span', { 'aria-hidden': 'true' }, outcome.glyph),
		                    h('span', null, outcome.detail.length > 18 ? `${outcome.detail.slice(0, 18)}…` : outcome.detail))),
		                  h('td', { className: 'rk-col-id' }, row.model ?? '—'),
		                  h('td', { className: 'rk-col-hide-sm' }, row.accountLabel ?? row.account ?? '—'),
		                  h('td', { className: 'rk-col-num rk-col-hide-sm' }, fmtMs(row.totalMs)),
		                  h('td', { className: 'rk-col-num rk-col-hide-sm' }, fmtMs(row.queueMs)),
		                  h('td', { className: 'rk-col-num rk-col-hide-sm' }, fmtMs(row.firstTokenMs)),
		                  h('td', { className: 'rk-col-num' }, row.completionTokens === undefined ? '—' : String(row.completionTokens)),
		                  h('td', { className: 'rk-col-num rk-col-hide-sm' }, String(row.tries ?? 1)),
		                  h('td', { className: 'rk-col-hide-sm' }, formatWhen(row.startedAt)));
		              }))))));
		}

		/* ── 密钥治理的子卡，抽成顶层组件 ───────────────────────────
		   原因：它们嵌在 KeyPanel 里时括号深度到 9 层，已经漏过两次。
		   抽出来之后每层 3-4 个参数，漏括号会立刻被 node --check 抓到。 */

		/** 新密钥明文提示条。只出现一次，用户收起后不再回来。 */
		function freshCard(fresh, onHide, label) {
		  if (fresh === undefined) return null;
		  return h('div', { className: 'rk-flash rk-flash--ok' },
		    h('span', null, label('rk.k.newKey', '新密钥（仅此一次可见）')),
		    h('span', { className: 'rk-mono', style: { userSelect: 'all' } }, fresh.plain),
		    h('span', { className: 'rk-spacer' }),
		    h('button', { type: 'button', className: 'rk-btn rk-btn--sm', onClick: onHide }, label('rk.k.hide', '收起')));
		}

		/** 密钥列表。 */
		function keysCard({ keys, pro, busy, onToggle, onRotate, onDelete, onLan, label }) {
		  const rows = keys.map((k) => {
		    const enabled = k.enabled === true;
		    return h('tr', { key: k.id },
		      h('td', null,
		        h('span', { style: { fontWeight: 600, color: 'var(--rk-fg-1)' } }, k.name),
		        enabled ? null : h(UI.Badge, { kind: 'idle', icon: '⏸' }, label('rk.k.disabled', '已停用'))),
		      h('td', { className: 'rk-col-hide-sm rk-col-id' }, k.prefix),
		      h('td', { className: 'rk-col-num rk-col-hide-sm' },
		        k.quota.requestsPerDay === 0 ? label('rk.k.unlimited', '不限') : String(k.quota.requestsPerDay)),
		      h('td', { className: 'rk-col-num rk-col-hide-sm' }, String(k.usage.requests)),
		      h('td', { className: 'rk-col-hide-sm' },
		        k.models.length === 0 ? label('rk.k.allModels', '全部') : `${String(k.models.length)} ${label('rk.k.items', '项')}`),
		      h('td', { className: 'rk-col-hide-sm' },
		        k.ips.length === 0 ? label('rk.k.anyIp', '不限') : `${String(k.ips.length)} ${label('rk.k.items', '项')}`),
		      h('td', { className: 'rk-col-hide-sm' },
		        k.lastUsedAt === undefined ? h('span', { className: 'rk-cell-empty' }) : formatWhen(k.lastUsedAt)),
		      h('td', { className: 'rk-col-num' },
		        h('span', { className: 'rk-toolbar', style: { justifyContent: 'flex-end', gap: '4px' } },
		          h('button', {
		            type: 'button', className: 'rk-btn rk-btn--sm rk-row-action',
		            disabled: busy, onClick: () => onToggle(k.id, enabled !== true),
		            title: enabled ? label('rk.k.disable', '停用') : label('rk.k.enable', '启用'),
		          }, enabled ? label('rk.a.disableShort', '停用') : label('rk.a.enableShort', '启用')),
		          h('button', {
		            type: 'button', className: 'rk-btn rk-btn--sm rk-row-action',
		            disabled: busy, onClick: () => onRotate(k.id), title: label('rk.k.rotate', '轮换密钥'),
		          }, label('rk.k.rotateShort', '轮换')),
		          h('button', {
		            type: 'button', className: 'rk-btn rk-btn--sm rk-btn--danger rk-row-action',
		            disabled: busy, onClick: () => onDelete(k), title: label('rk.k.delete', '删除'),
		          }, label('rk.k.deleteShort', '删除')))));
		  });

		  return h(Card, {
		    title: label('rk.k.title', 'API 密钥'),
		    sub: `${label('rk.k.count', '共')} ${String(keys.length)} ${label('rk.k.units', '把')} · ${label('rk.k.master', '宿主密钥始终可用，不在此列')}`,
		    actions: h('span', { className: 'rk-inline' },
		      h('span', { className: 'rk-card-sub' }, label('rk.k.allowLan', '允许局域网访问')),
		      h(UI.Toggle, {
		        checked: pro.allowLan === true,
		        disabled: busy,
		        label: label('rk.k.allowLanLabel', '开关局域网访问'),
		        onChange: onLan,
		      })),
		  }, keys.length === 0
		      ? h(UI.EmptyState, {
		          kind: 'empty',
		          title: label('rk.k.none', '还没有创建任何密钥'),
		          note: label('rk.k.noneNote', '密钥用于把池子分给不同客户端或同一台机器上的不同程序：每把可以限定每日请求数、可用模型与来源 IP。'),
		        })
		      : h('div', { className: 'rk-table-wrap' },
		          h('table', { className: 'rk-table' },
		            h('thead', null, h('tr', null,
		              h('th', null, label('rk.k.name', '名称')),
		              h('th', { className: 'rk-col-hide-sm' }, label('rk.k.prefix', '前缀')),
		              h('th', { className: 'rk-col-num rk-col-hide-sm' }, label('rk.k.quota', '每日上限')),
		              h('th', { className: 'rk-col-num rk-col-hide-sm' }, label('rk.k.used', '今日已用')),
		              h('th', { className: 'rk-col-hide-sm' }, label('rk.k.models', '模型白名单')),
		              h('th', { className: 'rk-col-hide-sm' }, label('rk.k.ips', 'IP 白名单')),
		              h('th', { className: 'rk-col-hide-sm' }, label('rk.k.last', '最近使用')),
		              h('th', { className: 'rk-col-num' }, label('rk.a.actions', '操作')))),
		            h('tbody', null, rows))));
		}

		/** 新建密钥表单。 */
		function newKeyCard({ form, setForm, busy, onCreate, label }) {
		  const field = (key, textKey, fallback, extra = {}) => h('label', { className: 'rk-field', key },
		    h('span', { className: 'rk-field-label' }, label(textKey, fallback)),
		    h('input', Object.assign({
		      className: 'rk-input',
		      value: form[key],
		      onChange: (e) => setForm({ ...form, [key]: e.target.value }),
		    }, extra)));
		  return h(Card, { title: label('rk.k.newTitle', '新建密钥') },
		    h('div', { className: 'rk-grid-2' },
		      field('name', 'rk.k.f.name', '名称', { placeholder: label('rk.k.f.namePh', '例如：笔记本 Codex') }),
		      field('requestsPerDay', 'rk.k.f.quota', '每日请求上限（0 = 不限）', { inputMode: 'numeric' }),
		      field('models', 'rk.k.f.models', '可用模型（逗号分隔，留空 = 全部）', { placeholder: 'deepseek-v4.1-flash, glm-5.3-flash' }),
		      field('ips', 'rk.k.f.ips', '来源 IP 白名单（逗号分隔，留空 = 不限）', { placeholder: '127.0.0.1, 192.168.1.*' })),
		    h('div', { className: 'rk-toolbar', style: { marginTop: '14px' } },
		      h(ActionBtn, { label: label('rk.k.create', '创建密钥'), kind: 'primary', icon: 'plus', disabled: busy, onClick: onCreate })));
		}

		/** 删除确认。 */
		function confirmCard({ target, busy, onConfirm, onCancel, label }) {
		  return h(UI.ConfirmDialog, {
		    open: target !== undefined,
		    title: label('rk.k.delTitle', '删除这把密钥？'),
		    body: `${label('rk.k.delBody', '正在使用它的客户端会立刻收到 401。删除后无法恢复，只能重新创建。')}${target === undefined ? '' : `\n${target.name} · ${target.prefix}`}`,
		    confirmLabel: label('rk.k.delConfirm', '删除'),
		    danger: true,
		    onConfirm,
		    onCancel,
		  });
		}

		/* ═══════════════════════════════════════════════════════════
		   设置 · 密钥治理（2.4.0 新增）
		   ═══════════════════════════════════════════════════════════ */

		/**
		 * 密钥管理卡。
		 *
		 * 三条呈现上的硬规则：
		 *   1. 明文只在刚创建/轮换的那一刻出现一次，之后只显示前缀
		 *   2. 「打开局域网」必须配一句后果说明 —— 它把回环服务暴露给同网设备
		 *   3. 删除要确认，且默认焦点在取消
		 */

		/* ═══════════════════════════════════════════════════════════
		   设置 · 审计查询 / 行为参数 / 外观
		   ═══════════════════════════════════════════════════════════ */

		function AuditPanel({ flash }) {
		  const [rows, setRows] = useState(undefined);
		  const [total, setTotal] = useState(0);
		  const [days, setDays] = useState('7');
		  const [statusFilter, setStatusFilter] = useState('');
		  const [busy, setBusy] = useState(false);

		  const load = useCallback(async () => {
		    setBusy(true);
		    try {
		      const body = await get(`${ROUTES.audit}?days=${encodeURIComponent(days)}&limit=200&status=${encodeURIComponent(statusFilter)}`);
		      setRows(Array.isArray(body.rows) ? body.rows : []);
		      setTotal(Number(body.total) || 0);
		    } catch (e) {
		      flash('bad', `${tr('rk.au.loadFailed', '审计加载失败')}：${e.message}`);
		      setRows([]);
		    } finally {
		      setBusy(false);
		    }
		  }, [days, statusFilter, flash]);
		  useEffect(() => { void load(); }, [load]);

		  const rangeOptions = [['1', tr('rk.au.d1', '最近 1 天')], ['7', tr('rk.au.d7', '最近 7 天')], ['30', tr('rk.au.d30', '最近 30 天')]];
		  const statusOptions = [['', tr('rk.au.all', '全部结果')], ['200', '200'], ['401', '401'], ['403', '403'], ['429', '429']];

		  let body;
		  if (rows === undefined) body = h(UI.Skeleton, { rows: 4 });
		  else if (rows.length === 0) {
		    body = h(UI.EmptyState, {
		      kind: 'empty',
		      title: tr('rk.au.none', '这段时间没有请求记录'),
		      note: tr('rk.au.noneNote', '有请求经过本地网关后，这里会出现每一次调用的来源 IP、使用的密钥、路径与结果。'),
		    });
		  } else {
		    const auditRows = rows.map((row, i) => h('tr', { key: `${String(row.ts)}-${String(i)}` },
		      h('td', null, formatWhen(row.ts)),
		      h('td', { className: 'rk-col-hide-sm' }, row.keyName ?? '—'),
		      h('td', { className: 'rk-col-hide-sm rk-col-id' }, row.ip ?? '—'),
		      h('td', { className: 'rk-col-hide-sm rk-col-id' }, row.path ?? '—'),
		      h('td', { className: 'rk-col-num' }, h(UI.Badge, { kind: Number(row.status) < 400 ? 'ok' : 'bad' }, String(row.status))),
		      h('td', { className: 'rk-col-num' }, `${String(Math.round(Number(row.ms) || 0))} ms`)));
		    body = h('div', { className: 'rk-table-wrap', style: { maxHeight: '360px' } },
		      h('table', { className: 'rk-table' },
		        h('thead', null, h('tr', null,
		          h('th', null, tr('rk.au.time', '时间')),
		          h('th', { className: 'rk-col-hide-sm' }, tr('rk.au.key', '密钥')),
		          h('th', { className: 'rk-col-hide-sm' }, tr('rk.au.ip', '来源')),
		          h('th', { className: 'rk-col-hide-sm' }, tr('rk.au.path', '路径')),
		          h('th', { className: 'rk-col-num' }, tr('rk.au.status', '结果')),
		          h('th', { className: 'rk-col-num' }, tr('rk.au.ms', '耗时')))),
		        h('tbody', null, auditRows)));
		  }

		  return h(Card, {
		    title: tr('rk.au.title', '访问审计'),
		    sub: `${tr('rk.au.total', '命中')} ${String(total)} ${tr('rk.au.records', '条')}`,
		    actions: h('span', { className: 'rk-toolbar' },
		      h('select', {
		        className: 'rk-select', value: days, 'aria-label': tr('rk.au.range', '时间范围'),
		        onChange: (e) => setDays(e.target.value),
		      }, rangeOptions.map(([v, l]) => h('option', { key: v, value: v }, l))),
		      h('select', {
		        className: 'rk-select', value: statusFilter, 'aria-label': tr('rk.au.statusFilter', '按结果筛选'),
		        onChange: (e) => setStatusFilter(e.target.value),
		      }, statusOptions.map(([v, l]) => h('option', { key: v, value: v }, l))),
		      h('a', {
		        className: 'rk-btn', href: `${ROUTES.audit}?days=${encodeURIComponent(days)}&format=csv`,
		        download: '', title: tr('rk.au.csvHint', '导出为 CSV（可用表格软件直接打开）'),
		      }, h(UI.Icon, { name: 'download', size: 13 }), tr('rk.au.csv', '导出 CSV')),
		      h('a', {
		        className: 'rk-btn', href: `${ROUTES.auditSummary}?days=${encodeURIComponent(days)}&format=csv`,
		        download: '', title: tr('rk.au.billHint', '按天 × Key × 接口汇总（CSV），直接透视即可算账单'),
		      }, h(UI.Icon, { name: 'download', size: 13 }), tr('rk.au.bill', '账单汇总'))),
		  }, body);
		}

		/** 行为参数：调度策略与门槛。写入后端 settings 白名单内的字段。 */
		function BehaviorPanel({ flash }) {
		  const [cfg, setCfg] = useState(undefined);
		  const [busy, setBusy] = useState(false);

		  const load = useCallback(async () => {
		    try {
		      setCfg((await get(ROUTES.settings)).config ?? {});
		    } catch (e) {
		      flash('bad', `${tr('rk.b.loadFailed', '设置读取失败')}：${e.message}`);
		    }
		  }, [flash]);
		  useEffect(() => { void load(); }, [load]);

		  const save = (patch) => {
		    setBusy(true);
		    post(ROUTES.settings, { config: patch })
		      .then(async () => { flash('ok', tr('rk.b.saved', '已保存，立即生效')); await load(); })
		      .catch((e) => flash('bad', e.message))
		      .finally(() => setBusy(false));
		  };

		  if (cfg === undefined) {
		    return h('div', { className: 'rk-card' }, h('div', { className: 'rk-card-body' }, h(UI.Skeleton, { rows: 3 })));
		  }
		  const distOptions = [
		    ['priority', tr('rk.b.d.priority', '优先级（先用最好的）')],
		    ['round-robin', tr('rk.b.d.rr', '轮流（按顺序）')],
		    ['balanced', tr('rk.b.d.balanced', '均衡（空闲加权随机）')],
		  ];
		  return h(Card, { title: tr('rk.b.title', '行为参数'), sub: tr('rk.b.sub', '写入后立即生效，无需重启') },
		    h('div', { className: 'rk-grid-2' },
		      h('label', { className: 'rk-field' },
		        h('span', { className: 'rk-field-label' }, tr('rk.b.distribution', '调度策略')),
		        h('select', {
		          className: 'rk-select', value: cfg.distribution ?? 'priority',
		          onChange: (e) => save({ distribution: e.target.value }),
		        }, distOptions.map(([v, l]) => h('option', { key: v, value: v }, l))),
		        h('span', { className: 'rk-hint' }, tr('rk.b.dHint', '会话粘性不受影响：同一对话仍固定同一个账号。'))),
		      h('label', { className: 'rk-field' },
		        h('span', { className: 'rk-field-label' }, tr('rk.b.cooldown', '限流冷却（分钟）')),
		        h('input', {
		          className: 'rk-input', inputMode: 'numeric',
		          value: String(Math.round((Number(cfg.cooldownMs) || 6e4) / 6e4)),
		          onChange: (e) => save({ cooldownMs: Math.max(1, Number(e.target.value) || 1) * 6e4 }),
		        }),
		        h('span', { className: 'rk-hint' }, tr('rk.b.cHint', '单个账号被限流后退出轮换多久。'))),
		      h('label', { className: 'rk-field' },
		        h('span', { className: 'rk-field-label' }, tr('rk.b.minCredits', '账号可用门槛（积分）')),
		        h('input', {
		          className: 'rk-input', inputMode: 'numeric',
		          value: String(Number(cfg.minUsableCredits) || 0),
		          onChange: (e) => save({ minUsableCredits: Math.max(0, Number(e.target.value) || 0) }),
		        }),
		        h('span', { className: 'rk-hint' }, tr('rk.b.mHint', '余额低于此值的账号会被跳过，恢复后自动回到池中。0 = 关闭门槛。'))),
		      h('div', { className: 'rk-field' },
		        h('span', { className: 'rk-field-label' }, tr('rk.b.busy', '操作中')),
		        h('span', { className: 'rk-hint' }, busy ? tr('rk.b.saving', '保存中…') : tr('rk.b.idle', '空闲')))));
		}

		/** 外观：主题三态。 */
		function AppearancePanel({ theme, onTheme }) {
		  const options = [
		    ['auto', tr('rk.ap.auto', '跟随系统')],
		    ['light', tr('rk.ap.light', '浅色')],
		    ['dark', tr('rk.ap.dark', '深色')],
		  ];
		  const buttons = options.map(([value, label]) => h('button', {
		    key: value, type: 'button',
		    className: `rk-btn${theme === value ? ' rk-btn--primary' : ''}`,
		    'aria-pressed': theme === value ? 'true' : 'false',
		    onClick: () => onTheme(value),
		  }, h(UI.Icon, { name: value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'gear', size: 13 }), label));
		  return h(Card, { title: tr('rk.ap.title', '外观'), sub: tr('rk.ap.sub', '深浅两套独立取色，默认跟随系统') },
		    h('div', { className: 'rk-toolbar' }, buttons));
		}

		/**
		 * 模型启用范围：**按区域各自保存**（宿主 modelSelectionCn / modelSelectionGlobal）。
		 *
		 * 勾选即写，不放"保存"按钮：这一列最容易出的问题就是"点了没反应"，
		 * 而一次 POST 的代价远低于让用户怀疑界面坏了。
		 *
		 * 空集合必须拦住 —— 宿主语义里 `enabledModelIds: []` 是"一个都不启用"，
		 * 存下去这个区域就彻底不服务了。
		 */
		function ModelPanel({ status, region, flash }) {
		  const [busy, setBusy] = useState(false);
		  const [pending, setPending] = useState(undefined);

		  const models = Array.isArray(status?.models) ? status.models : [];
		  const selection = status?.selection ?? {};
		  const serverEnabled = Array.isArray(selection.enabledModelIds) ? selection.enabledModelIds : undefined;
		  const serverImage = Array.isArray(selection.imageModelIds) ? selection.imageModelIds : [];
		  const enabledIds = pending?.enabled ?? serverEnabled ?? models.map((m) => m.id);
		  const imageIds = pending?.image ?? serverImage;

		  /* 换区域必须丢掉本地乐观值，否则会把国内版的勾选画到国际版上 */
		  useEffect(() => { setPending(undefined); }, [region]);

		  const save = (next) => {
		    if (next.enabled.length === 0) {
		      flash('bad', tr('rk.mp.needOne', '至少要启用一个模型，否则这个区域无法服务'));
		      return;
		    }
		    setBusy(true);
		    setPending(next);
		    post(ROUTES.modelsSave, {
		      region,
		      enabledModelIds: next.enabled,
		      imageModelIds: next.image,
		      contextBudgets: selection.contextBudgets ?? {},
		    })
		      .then(() => flash('ok', tr('rk.mp.saved', '已保存，新范围下一次请求即生效')))
		      .catch((e) => { setPending(undefined); flash('bad', e.message); })
		      .finally(() => setBusy(false));
		  };

		  const toggle = (id, list, field) => {
		    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
		    save(field === 'enabled' ? { enabled: next, image: imageIds } : { enabled: enabledIds, image: next });
		  };

		  const checkbox = (checked, onClick, enabled) => h('input', {
		    type: 'checkbox', checked, disabled: busy || !enabled,
		    style: { width: '14px', height: '14px', cursor: enabled ? 'pointer' : 'not-allowed' },
		    onChange: onClick,
		  });

		  return h(Card, {
		    title: tr('rk.mp.title', '模型启用'),
		    sub: `${region === 'global' ? tr('rk.mp.global', '国际版') : tr('rk.mp.cn', '国内版')} · ${tr('rk.mp.sub', '两个区域各自独立，勾选即保存')}`,
		    /* 空集合时逐个勾 27 个模型不现实，给一个全选入口（宿主语义：空 = 一个都不启用） */
		    actions: h('span', { className: 'rk-toolbar' },
		      h('button', {
		        type: 'button', className: 'rk-btn rk-btn--sm', disabled: busy || models.length === 0,
		        onClick: () => save({ enabled: models.map((m) => m.id), image: imageIds }),
		      }, tr('rk.mp.all', '全部启用')),
		      busy ? h('span', { className: 'rk-card-sub' }, tr('rk.mp.saving', '保存中…')) : null),
		  }, models.length === 0
		    ? h(UI.EmptyState, { kind: 'empty', title: tr('rk.mp.empty', '这个区域还没有模型目录') })
		    : h('div', { className: 'rk-table-wrap' },
		        h('table', { className: 'rk-table' },
		          h('thead', null, h('tr', null,
		            h('th', null, tr('rk.mp.model', '模型')),
		            h('th', { className: 'rk-col-hide-sm' }, tr('rk.o.modelName', '名称')),
		            h('th', { className: 'rk-col-num' }, tr('rk.o.multiplier', '倍率')),
		            h('th', { className: 'rk-col-num' }, tr('rk.o.servable', '可服务')),
		            h('th', { className: 'rk-col-num' }, tr('rk.mp.enabled', '启用')),
		            h('th', { className: 'rk-col-num' }, tr('rk.mp.image', '图片')))),
		          h('tbody', null, models.map((m) => h('tr', { key: m.id },
		            h('td', { className: 'rk-col-id' }, m.id),
		            h('td', { className: 'rk-col-hide-sm' }, m.name ?? '—'),
		            h('td', { className: 'rk-kv-value--num' }, m.multiplier === undefined ? '—' : String(m.multiplier)),
		            h('td', { className: 'rk-col-num' }, String(Number(m.servableAccounts ?? 0))),
		            h('td', { className: 'rk-col-num' },
		              checkbox(enabledIds.includes(m.id), () => toggle(m.id, enabledIds, 'enabled'), true)),
		            h('td', { className: 'rk-col-num' }, m.supportsImages === true
		              ? checkbox(imageIds.includes(m.id), () => toggle(m.id, imageIds, 'image'), enabledIds.includes(m.id))
		              : h('span', { className: 'rk-cell-empty' }))))))));
		}

		function Settings({ theme, onTheme, flash, status, region }) {
		  return h('div', null,
		    h(ModelPanel, { status, region, flash }),
		    h(KeyPanel, { flash }),
		    h(AuditPanel, { flash }),
		    h(BehaviorPanel, { flash }),
		    h(AppearancePanel, { theme, onTheme }));
		}

		function KeyPanel({ flash }) {
		  const [data, setData] = useState(undefined);
		  const [busy, setBusy] = useState(false);
		  const [fresh, setFresh] = useState(undefined);
		  const [form, setForm] = useState({ name: '', requestsPerDay: '0', models: '', ips: '' });
		  const [confirmDelete, setConfirmDelete] = useState(undefined);

		  const load = useCallback(async () => {
		    try {
		      setData(await get(ROUTES.keys));
		    } catch (e) {
		      flash('bad', `${tr('rk.k.loadFailed', '密钥列表加载失败')}：${e.message}`);
		    }
		  }, [flash]);
		  useEffect(() => { void load(); }, [load]);

		  const run = useCallback(async (fn) => {
		    setBusy(true);
		    try { await fn(); } catch (e) { flash('bad', e.message); } finally { setBusy(false); }
		  }, [flash]);

		  const create = () => run(async () => {
		    const created = await post(ROUTES.keysCreate, {
		      name: form.name,
		      requestsPerDay: Number(form.requestsPerDay) || 0,
		      models: form.models.split(',').map((x) => x.trim()).filter(Boolean),
		      ips: form.ips.split(',').map((x) => x.trim()).filter(Boolean),
		    });
		    setFresh(created);
		    setForm({ name: '', requestsPerDay: '0', models: '', ips: '' });
		    flash('ok', tr('rk.k.created', '密钥已创建。明文只显示这一次，请立刻复制保存。'));
		    await load();
		  });

		  const patch = (id, body) => run(async () => {
		    await post(ROUTES.keysUpdate, { id, ...body });
		    await load();
		  });

		  const rotate = (id) => run(async () => {
		    const rotated = await post(ROUTES.keysRotate, { id });
		    setFresh(rotated);
		    flash('ok', tr('rk.k.rotated', '已轮换。新明文只显示这一次。'));
		    await load();
		  });

		  const remove = (id) => run(async () => {
		    await post(ROUTES.keysDelete, { id });
		    setConfirmDelete(undefined);
		    flash('ok', tr('rk.k.deleted', '密钥已删除'));
		    await load();
		  });

		  const toggleLan = (allowLan) => run(async () => {
		    await post(ROUTES.settings, { pro: { allowLan } });
		    await load();
		  });

		  if (data === undefined) {
		    return h('div', { className: 'rk-card' }, h('div', { className: 'rk-card-body' }, h(UI.Skeleton, { rows: 3 })));
		  }
		  const keys = Array.isArray(data.keys) ? data.keys : [];
		  const pro = data.config ?? {};

		  const list = keysCard({
		    keys, pro, busy, label: tr,
		    onToggle: (id, enabled) => patch(id, { enabled }),
		    onRotate: (id) => rotate(id),
		    onDelete: (k) => setConfirmDelete(k),
		    onLan: (next) => {
		      if (next === true) {
		        flash('info', tr('rk.k.lanWarn', '开启后本地网关会监听 0.0.0.0，同一网络内的设备可持密钥访问；没有启用中的密钥时此项不生效。'));
		      }
		      toggleLan(next === true);
		    },
		  });
		  const createCard = newKeyCard({ form, setForm, busy, onCreate: create, label: tr });
		  const confirm = confirmCard({
		    target: confirmDelete, busy, label: tr,
		    onConfirm: () => remove(confirmDelete.id),
		    onCancel: () => setConfirmDelete(undefined),
		  });
		  const banner = fresh === undefined ? null : freshCard(fresh, () => setFresh(undefined), tr);

		  return h('div', null, banner, list, createCard, confirm);
		}

		/**
		 * 状态轮询。
		 *
		 * 优先用 SSE（`/status-stream`，2.4.0 新增）：服务端每 5 秒比较一次，
		 * 只在内容变化时推送，客户端不做无效重绘。SSE 不可用（宿主拦截、
		 * 老后端）时回落到轮询，带**指数退避**：连续失败时拉长间隔，
		 * 避免上游抖动被我们打爆。
		 */
		function useStatus(region) {
		  const [status, setStatus] = useState(undefined);
		  const [error, setError] = useState(undefined);
		  const failRef = useRef(0);

		  useEffect(() => {
		    /* 换区域先清空：否则切到国际版时，第一帧画的还是国内版的 25 个账号 */
		    setStatus(undefined);
		    setError(undefined);
		    let alive = true;
		    let source;
		    let timer;

		    const onStatus = (doc) => {
		      if (!alive) return;
		      setStatus(doc);
		      setError(undefined);
		      failRef.current = 0;
		    };

		    /* SSE 可用时：挂上就跑，断线由浏览器按 retry 自动重连 */
		    try {
		      if (typeof EventSource === 'function') {
		        source = new EventSource(`${ROUTES.stream}?region=${encodeURIComponent(region)}`);
		        source.addEventListener('status', (event) => {
		          try { onStatus(JSON.parse(event.data)); } catch { /* 单帧坏数据不致命 */ }
		        });
		        source.addEventListener('error', () => {
		          if (alive) setError('status stream disconnected');
		        });
		      }
		    } catch {
		      source = undefined;
		    }

		    /* 无论有没有 SSE，都保留一份轮询兜底：SSE 静默断开时它能把状态救回来 */
		    const tick = async () => {
		      try {
		        const res = await fetch(`${ROUTES.status}?region=${encodeURIComponent(region)}`);
		        if (!res.ok) throw new Error(`HTTP ${res.status}`);
		        const doc = await res.json();
		        onStatus(doc);
		      } catch (e) {
		        if (!alive) return;
		        failRef.current += 1;
		        setError(e instanceof Error ? e.message : String(e));
		      }
		      if (!alive) return;
		      const backoff = Math.min(2 ** Math.min(failRef.current, 3), 8);
		      timer = setTimeout(tick, 30000 * backoff);
		    };
		    timer = setTimeout(tick, 1500);

		    return () => {
		      alive = false;
		      if (timer !== undefined) clearTimeout(timer);
		      if (source !== undefined) { try { source.close(); } catch { /* 已关闭 */ } }
		    };
		  }, [region]);

		  return { status, error };
		}

		/**
		 * 版本徽标 + 更新入口。
		 *
		 * `compared === 0` 时不显示"已是最新" —— 那只是**没法比对**，
		 * 不是"一致"。这种诚实很重要：假报"最新"会让用户以为更新系统坏了。
		 */
		function VersionBadge({ flash }) {
		  const [info, setInfo] = useState(undefined);
		  const [busy, setBusy] = useState(false);
		  const [checking, setChecking] = useState(false);
		  const [msg, setMsg] = useState(undefined);

		  useEffect(() => {
		    let alive = true;
		    const load = async () => {
		      try {
		        const res = await fetch(ROUTES.version);
		        const body = await res.json();
		        if (alive) setInfo(body);
		      } catch {
		        /* 版本号取不到不该影响卡片其它部分 */
		      }
		    };
		    void load();
		    const timer = setInterval(load, 300000);
		    return () => { alive = false; clearInterval(timer); };
		  }, []);

		  const doUpdate = async () => {
		    setBusy(true);
		    setMsg(undefined);
		    try {
		      const body = await post(ROUTES.update, {});
		      setMsg(body.ok === true
		        ? tr('rk.version.updated', '已更新，请重启 DSH 生效')
		        : (body.error ?? tr('rk.version.updateFailed', '更新失败')));
		    } catch (e) {
		      setMsg(e.message);
		    } finally {
		      setBusy(false);
		    }
		  };

		  const recheck = async () => {
		    setChecking(true);
		    setMsg(tr('rk.version.checking', '检查中…'));
		    try {
		      const deadline = Date.now() + 40000;
		      let body;
		      for (;;) {
		        const res = await fetch(ROUTES.version);
		        body = await res.json();
		        if (body.remotePending !== true) break;
		        if (Date.now() > deadline) {
		          setInfo(body);
		          setMsg(tr('rk.version.stillChecking', '仍在检查远端（首次较慢），请稍后再点一次'));
		          return;
		        }
		        await new Promise((r) => setTimeout(r, 2000));
		      }
		      setInfo(body);
		      if (body.updateAvailable === true) setMsg(`${tr('rk.version.found', '发现新版本')} v${body.remoteVersion}`);
		      else if (body.remoteVersion === undefined) setMsg(tr('rk.version.unreachable', '取不到远端版本'));
		      else if (body.version === body.remoteVersion) setMsg(tr('rk.version.upToDate', '已是最新'));
		      else setMsg(`${tr('rk.version.localNewer', '本地')} v${body.version} ${tr('rk.version.newerThan', '比远端')} v${body.remoteVersion} ${tr('rk.version.notPushed', '新（尚未推送）')}`);
		    } catch (e) {
		      setMsg(e.message);
		    } finally {
		      setChecking(false);
		      setTimeout(() => setMsg(undefined), 12000);
		    }
		  };

		  if (info === undefined) return null;
		  return h('span', { className: 'rk-inline' },
		    h('button', {
		      type: 'button', className: 'rk-btn rk-btn--sm',
		      disabled: checking, onClick: recheck,
		      title: tr('rk.version.checkHint', '检查远端是否有新版本'),
		    }, checking ? tr('rk.version.checking', '检查中…') : `v${info.version ?? '?'}`),
		    info.updateAvailable === true
		      ? h('button', {
		          type: 'button', className: 'rk-btn rk-btn--sm rk-btn--primary',
		          disabled: busy, onClick: doUpdate,
		          title: `${tr('rk.version.remote', '远端')} v${info.remoteVersion ?? '?'}`,
		        }, busy ? tr('rk.version.updating', '更新中…') : tr('rk.version.newVersion', '有新版本'))
		      : null,
		    msg === undefined ? null : h('span', { className: 'rk-card-sub' }, msg));
		}

		/*
		 * 顶层组件：自己拉数据，不依赖宿主传入。
		 */
		/**
		 * 扫码重登。
		 *
		 * 复用"新增账号"那条 OAuth 链路（`/oauth/start` → 授权 URL + SVG 二维码，
		 * `/oauth/poll` → pending / ok / expired），区别只在**入口**：
		 * 它挂在状态为「需重新登录」的那一行上，因为那正是用户需要它的时候。
		 *
		 * 落盘仍走 `oauthPersistCredential`（同一个 uin 会落到同一个账号 id），
		 * 所以扫完不是"多一个号"，而是这个号换了新凭据。
		 */
		function ReloginDialog({ region, onClose, flash }) {
		  const [phase, setPhase] = useState('starting');
		  const [qr, setQr] = useState(undefined);
		  const [state, setState] = useState(undefined);
		  const [message, setMessage] = useState(undefined);

		  useEffect(() => {
		    let alive = true;
		    post(ROUTES.oauthStart, { region })
		      .then((started) => {
		        if (!alive) return;
		        setQr(started?.qr);
		        setState(started?.state);
		        setPhase('waiting');
		      })
		      .catch((error) => {
		        if (!alive) return;
		        setPhase('failed');
		        setMessage(error.message);
		      });
		    return () => { alive = false; };
		  }, [region]);

		  useEffect(() => {
		    if (phase !== 'waiting' || state === undefined) return;
		    let alive = true;
		    let timer;
		    const deadline = Date.now() + 180000;
		    const tick = async () => {
		      try {
		        const result = await get(`${ROUTES.oauthPoll}?state=${encodeURIComponent(state)}&region=${encodeURIComponent(region)}`);
		        if (!alive) return;
		        if (result?.status === 'pending') {
		          if (Date.now() > deadline) {
		            setPhase('failed');
		            setMessage(tr('rk.oauth.timeout', '二维码已过期，重新打开这个窗口再扫一次'));
		            return;
		          }
		          timer = setTimeout(tick, 2000);
		          return;
		        }
		        if (result?.status === 'ok') {
		          setPhase('done');
		          setMessage(`${tr('rk.oauth.saved', '已保存账号')}：${result.label ?? ''}`);
		          flash('ok', tr('rk.oauth.savedShort', '扫码登录成功，账号已更新'));
		          setTimeout(onClose, 1500);
		          return;
		        }
		        setPhase('failed');
		        setMessage(result?.message ?? tr('rk.oauth.expired', '这次登录没有完成'));
		      } catch (error) {
		        if (!alive) return;
		        setPhase('failed');
		        setMessage(error.message);
		      }
		    };
		    timer = setTimeout(tick, 1500);
		    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
		  }, [phase, state, region, flash, onClose]);

		  const body = phase === 'starting'
		    ? h('div', { className: 'rk-card-sub' }, tr('rk.oauth.opening', '正在获取二维码…'))
		    : phase === 'waiting'
		      ? h('div', { style: { textAlign: 'center' } },
		          h('div', {
		            style: { background: '#fff', padding: '8px', borderRadius: '8px', display: 'inline-block', lineHeight: 0 },
		            dangerouslySetInnerHTML: { __html: qr ?? '' },
		          }),
		          h('div', { className: 'rk-hint', style: { marginTop: '8px' } },
		            tr('rk.oauth.hint', '用这个区域的 WorkBuddy 账号扫码；完成后自动保存并重新扫描')))
		      : h('div', { className: `rk-flash rk-flash--${phase === 'done' ? 'ok' : 'bad'}` }, message ?? '');

		  return h('div', {
		    style: {
		      position: 'fixed', inset: '0', background: 'rgba(0, 0, 0, .45)',
		      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
		    },
		    onClick: onClose,
		  }, h('div', {
		    onClick: (event) => event.stopPropagation(),
		    style: { width: '320px', maxWidth: '90vw' },
		  }, h(Card, {
		    title: tr('rk.oauth.title', '扫码重新登录'),
		    sub: region === 'global' ? tr('rk.mp.global', '国际版') : tr('rk.mp.cn', '国内版'),
		    actions: h('button', { type: 'button', className: 'rk-btn rk-btn--sm', onClick: onClose }, tr('rk.close', '关闭')),
		  }, body)));
		}

		function Panel(props) {
		  /* 区域是**页面级**选择：两个区域各有自己的账号、模型启用范围与自动任务，
		     混在一个列表里就回答不了「这个号为什么不参与轮换」。 */
		  const [region, setRegion] = useState(props.region ?? 'cn');
		  const { status, error } = useStatus(region);
		  const [page, setPage] = useState('overview');
		  const [busy, setBusy] = useState(false);
		  const [sweepResult, setSweepResult] = useState(undefined);
		  const [relogin, setRelogin] = useState(undefined);
		  const [flash, setFlash] = useState(undefined);
		  const [theme, setTheme] = useState(() => props.theme ?? 'auto');
		  const now = Date.now();

		  const pushFlash = useCallback((kind, text) => {
		    setFlash({ kind, text });
		    setTimeout(() => setFlash(undefined), 4000);
		  }, []);

		  const changeTheme = useCallback((next) => {
		    setTheme(next);
		    props.onTheme?.(next);
		  }, [props]);

		  useEffect(() => {
		    if (error !== undefined && status === undefined) pushFlash('bad', error);
		  }, [error, status, pushFlash]);

		  const onAction = useCallback(async (kind, arg) => {
		    setBusy(true);
		    try {
		      if (kind === 'rescan') await post(ROUTES.rescan);
		      else if (kind === 'resetCooldown') {
		        /* 清冷却会返回实测结果 —— 有登录已失效时要说出来，否则用户看到「成功」然后那几个号又变回冷却。 */
		        const r = await post(ROUTES.resetCooldown);
		        const dead = r?.stillDeadCount ?? 0;
		        if (dead > 0) {
		          const names = (r.stillDead ?? []).slice(0, 3).map((x) => x.label).join('、');
		          pushFlash('bad', `${tr('rk.flash.cooldownPartial', '冷却已清，但有')} ${String(dead)} ${tr('rk.flash.cooldownDead', '个登录已失效，清冷却无效，需重新登录')}：${names}${dead > 3 ? ' …' : ''}`);
		        }
		      }
		      else if (kind === 'runAutomation') await post(ROUTES.automationRun, { job: 'all' });
		      else if (kind === 'checkin') await post(ROUTES.checkin, { accountId: arg });
		      else if (kind === 'disable') await post(ROUTES.accountDisabled, { accountId: arg, disabled: true });
		      else if (kind === 'enable') await post(ROUTES.accountDisabled, { accountId: arg, disabled: false });
		      else if (kind === 'claimAllRewards') {
		        const sweep = await post(ROUTES.rewardsClaimAll, {});
		        if (sweep !== undefined) {
		          const parts = [];
		          if (sweep.claimed > 0) parts.push(`${tr('rk.rewards.sweepClaimed', '已领')} ${String(sweep.claimed)} ${tr('rk.rewards.items', '项')}`);
		          if (typeof sweep.credit === 'number' && sweep.credit > 0) parts.push(`${String(sweep.credit)} ${tr('rk.rewards.points', '分')}`);
		          if (sweep.skipped > 0) parts.push(`${tr('rk.rewards.sweepSkipped', '跳过')} ${String(sweep.skipped)}`);
		          if (sweep.failedCount > 0) parts.push(`${tr('rk.rewards.sweepFailed', '失败')} ${String(sweep.failedCount)}`);
		          const text = parts.length === 0 ? tr('rk.rewards.sweepNone', '没有可领的奖励') : parts.join(' · ');
		          pushFlash(sweep.failedCount > 0 ? 'bad' : 'ok', `${tr('rk.rewards.sweepTitle', '一键领取')}：${text}`);
		          setSweepResult(sweep);
		        }
		      }
		      else if (kind === 'claimReward') {
		        const result = await post(ROUTES.rewardsClaim, arg);
		        if (result !== undefined && result.alreadyClaimed === true) {
		          pushFlash('ok', tr('rk.flash.alreadyClaimed', '这份奖励已经领过了'));
		        }
		      }
		      else if (kind === 'rename') {
		        await post(ROUTES.accountRename, { accountId: arg.accountId, label: arg.label });
		        pushFlash('ok', tr('rk.flash.renamed', '已改名'));
		      }
		      else if (kind === 'relogin') {
		        /* 打开扫码窗口即可：真正的 POST 由对话框发出（它要先拿到 state），
		           所以这里直接 return，别走到下面那句「已完成」。 */
		        setRelogin({ openedAtMs: Date.now() });
		        return;
		      }
		      else if (kind === 'addByScan') {
		        /*
		         * 与 relogin 共用同一个对话框。
		         *
		         * 上游不区分「新增」与「重登」：两者都是走 /auth/state 拿一次
		         * 授权，差别只在返回的 uin 是不是池里已有的。所以不需要第二套
		         * 扫码 UI，否则两份轮询逻辑早晚会不同步。
		         */
		        setRelogin({ openedAtMs: Date.now() });
		        return;
		      }
		      else if (kind === 'importAccount') {
		        const result = await post(ROUTES.accountImport, arg);
		        /*
		         * 失败要把后端的原话报出来。
		         *
		         * 导入失败的原因只有后端知道（不是 JSON / 顶层不是对象 /
		         * 里面没有可用的 token / 写盘失败），笼统说一句「添加失败」
		         * 会让人反复换内容重试。
		         */
		        if (result !== undefined && result.ok === true) {
		          pushFlash('ok', `${tr('rk.flash.imported', '已添加账号')}：${result.label ?? '(未命名)'}${result.added === 0 ? tr('rk.flash.importedExisting', '（该账号已在池中，凭据已更新）') : ''}`);
		        } else {
		          pushFlash('err', `${tr('rk.flash.importFailed', '添加失败')}：${result?.error ?? tr('rk.unknown', '未知错误')}`);
		        }
		      }
		      else if (kind === 'removeAccount') await post(ROUTES.accountRename, { accountId: arg });
		      setFlash((prev) => prev ?? { kind: 'ok', text: tr('rk.flash.done', '已完成') });
		    } catch (e) {
		      pushFlash('bad', e instanceof Error ? e.message : String(e));
		    } finally {
		      setBusy(false);
		      setTimeout(() => setFlash(undefined), 4000);
		    }
		  }, [pushFlash]);

		  const s = useMemo(() => summarize(status), [status]);

		  const navCounts = {
		    overview: `${String(s.usable)}/${String(s.accounts)}`,
		    accounts: String(s.accounts),
		    tasks: s.automation?.running === true ? '…' : '',
		    stream: s.requests === 0 ? '' : String(s.requests),
		    settings: '',
		  };

		  return h('div', { className: 'rk-root', 'data-rk-theme': theme === 'auto' ? undefined : theme },
		    h('div', { className: 'rk-top' },
		      h('div', { className: 'rk-brand' },
		        h('span', { className: 'rk-brand-mark', 'aria-hidden': 'true' }, 'RK'),
		        h('span', null,
		          h('span', { className: 'rk-brand-name' }, tr('rk.title', 'WorkBuddy 池')),
		          h('span', { className: 'rk-brand-sub', style: { marginLeft: '8px' } },
		            h('span', { className: `rk-dot ${s.healthPct >= 80 ? 'rk-dot--ok' : s.healthPct >= 50 ? 'rk-dot--warn' : 'rk-dot--bad'}` }),
		            ` ${String(s.usable)}/${String(s.accounts)} ${tr('rk.m.usable', '可用')}`)),
		        h(VersionBadge, { flash: pushFlash })),
		      h('span', { className: 'rk-spacer' }),
		      /* 区域切换：国内 / 国际各一套数据，切了才看得到另一版 */
		      h('div', { className: 'rk-top-actions', role: 'group', 'aria-label': tr('rk.region.label', '区域') },
		        REGIONS.map((r) => h('button', {
		          key: r.key, type: 'button',
		          className: `rk-btn rk-btn--sm${region === r.key ? ' rk-btn--primary' : ''}`,
		          'aria-pressed': region === r.key ? 'true' : 'false',
		          onClick: () => setRegion(r.key),
		        }, r.label))),
		      h('nav', { className: 'rk-nav', role: 'tablist', 'aria-label': tr('rk.navLabel', '面板分区') },
		        PAGES.map((p) => h('button', {
		          key: p.key, type: 'button', role: 'tab',
		          'aria-selected': page === p.key ? 'true' : 'false',
		          className: 'rk-nav-btn',
		          onClick: () => setPage(p.key),
		        }, tr(`rk.page.${p.key}`, p.label), navCounts[p.key] === '' ? null : h('span', { className: 'rk-nav-count' }, navCounts[p.key]))))),

		    flash === undefined ? null
		      : h('div', { style: { padding: '10px 16px 0' } },
		          h('div', { className: `rk-flash rk-flash--${flash.kind}` }, h('span', null, flash.text))),
		    /* 该区域一个模型都没启用：比「每行可服务 0」更该出现在顶栏 */
		    status?.summary?.noEnabledModels === true
		      ? h('div', { style: { padding: '10px 16px 0' } },
		          h('div', { className: 'rk-flash rk-flash--bad' },
		            h('span', null, `${tr('rk.mp.noneEnabled', '这个区域一个模型都没启用，请求会全部失败')} —— ${tr('rk.mp.noneEnabledFix', '去「设置 → 模型启用」勾选')}`)))
		      : null,

		    h('div', { className: 'rk-body' },
		      page === 'overview' ? h(Overview, { status, s, onAction, busy })
		        : page === 'accounts' ? h(Accounts, { status, now, onAction, busy })
		          : page === 'tasks' ? h(Tasks, { status, onAction, busy })
		            : page === 'stream' ? h(Stream, { status })
		              : h(Settings, { theme, onTheme: changeTheme, flash: pushFlash, status, region })),
		    relogin === undefined ? null : h(ReloginDialog, {
		      region,
		      onClose: () => setRelogin(undefined),
		      flash: pushFlash,
		    })
		  );
		}

		return { Panel, Overview, Accounts, Tasks, Stream, Settings, PAGES, ROUTES };
		}

		const __default_ui_panel_js = createPanel;

		//#endregion

		//#region src/client/index
		/* 样式注入：幂等。已有同 id 的 <style> 就更新内容，不重复插。 */
		const CSS_ID = "dsh-rotakit/client.css";
		function injectCss() {
			if (typeof document === "undefined") return;
			const existing = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]');
			if (existing !== null) { existing.textContent = RK_CSS; return; }
			const el = document.createElement("style");
			el.dataset.plugin = "dsh-rotakit";
			el.dataset.pluginCss = CSS_ID;
			el.textContent = RK_CSS;
			document.head.appendChild(el);
		}
		injectCss();

		/* 主题：跟随宿主，可被 localStorage 覆盖。写在 body（宿主令牌声明在 body）。 */
		function currentTheme() {
			try {
				const saved = window.localStorage.getItem(RK_THEME_KEY);
				if (saved === "light" || saved === "dark") return saved;
			} catch { /* 隐私模式下 localStorage 会抛，忽略 */ }
			const prefersLight = typeof window.matchMedia === "function"
				&& window.matchMedia("(prefers-color-scheme: light)").matches;
			return prefersLight ? "light" : "dark";
		}
		function applyTheme(theme) {
			if (typeof document === "undefined" || document.body === null) return;
			document.body.setAttribute("data-rk-theme", theme);
		}
		applyTheme(currentTheme());

		/* 错误边界：卡片坏了要能重试，而不是让用户看到白屏。 */
		class PanelErrorBoundary extends react.Component {
			constructor(props) { super(props); this.state = { error: undefined }; }
			static getDerivedStateFromError(error) { return { error }; }
			componentDidCatch(error) {
				console.error("[dsh-rotakit] panel render failed:", error);
			}
			render() {
				if (this.state.error === undefined) return this.props.children;
				return react.createElement(
					"div",
					{ className: "rk-root", style: { padding: "16px" } },
					react.createElement("div", { className: "rk-error" },
						react.createElement("div", null,
							react.createElement("div", { style: { fontWeight: 600, marginBottom: "4px" } }, "面板渲染出错"),
							react.createElement("div", { style: { fontSize: "var(--rk-fs-md)" } }, String(this.state.error && this.state.error.message || this.state.error)),
							react.createElement("button", {
								type: "button",
								className: "rk-btn",
								style: { marginTop: "8px" },
								onClick: () => this.setState({ error: undefined }),
							}, "重试")
						)
					)
				);
			}
		}

		function apply(ctx) {
			try {
				const namespace = "settings.workbuddy-xdpool";
				ctx.effect(() => ctx.locale.register(namespace, { zh: {}, en: {} }), "dsh-rotakit: locale");
				const t = ctx.locale.bind(namespace);
				const UI = createUI(react);
				const panel = createPanel(react, UI, {
					t,
					formatDuration,
					formatCount,
					accountState,
				});

				/*
				 * 图标与面板是【一对】：图标放不上就撤掉面板。
				 * 否则面板还注册着，但用户找不到入口。
				 */
				ctx.slots.inject("main", () => ctx.slots.inject("sidebar.panellist", () => {
					const stopPanel = ctx.slots.register(
						{ name: "main", key: "workbuddy-xdpool", inject: () => ({ t }) },
						() => react.createElement(PanelErrorBoundary, null, react.createElement(panel.Panel, null))
					);
					let stopIcon;
					try {
						stopIcon = ctx.slots.register(
							{ name: "sidebar.panellist", id: "workbuddy-xdpool", order: 120, label: () => t("rk.title"), locale: namespace },
							({ size }) => react.createElement("span", {
								title: "WorkBuddy 池",
								style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: (size || 18) + "px", height: (size || 18) + "px", fontSize: "13px" },
								"aria-hidden": "true",
							}, "◍")
						);
					} catch (error) {
						stopPanel();
						throw error;
					}
					return () => { if (stopIcon) stopIcon(); stopPanel(); };
				}));
			} catch (error) {
				console.error("[dsh-rotakit] client card failed to load (host provider unaffected):", error);
			}
		}
		//#endregion

		exports.NS = NS;
		exports.PAGES = PAGES;
		exports.RK_CSS = RK_CSS;
		exports.RK_DENSITY_KEY = RK_DENSITY_KEY;
		exports.RK_THEME_KEY = RK_THEME_KEY;
		exports.ROUTES = ROUTES;
		exports.TREND_DIRECTION = TREND_DIRECTION;
		exports.accountState = accountState;
		exports.createPanel = createPanel;
		exports.createUI = createUI;
		exports.formatCount = formatCount;
		exports.formatDuration = formatDuration;
		exports.formatThousands = formatThousands;
		exports.formatWhen = formatWhen;
		exports.requestOutcome = requestOutcome;
		exports.summarize = summarize;
		exports.apply = apply;
		exports.inject = ["slots", "locale"];
		exports.name = "dsh-rotakit-client";
		return module.exports;
	}
});
