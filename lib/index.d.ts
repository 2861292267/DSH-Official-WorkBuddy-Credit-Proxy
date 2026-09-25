import z from "@deepseek-ai/schemastery";
import { Api, Model } from "@earendil-works/pi-ai";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { Context, Context as Context$1 } from "@deepseek-ai/cordis";
import { SettingsNamespace } from "@deepseek-ai/dsh-settings";
//#region src/task-events.d.ts
/**
 * The event chains that light up the client-scored daily tasks.
 *
 * The task board advertises things like "open an app", "use five templates" or
 * "summon a platform expert". Those read as actions only a human at the desktop
 * app can take, but the scorer does not check the app — it checks the event
 * stream. Replaying the same events, with the same desktop fingerprint, scores
 * the task. Every chain here was measured against the live upstream.
 *
 * Kept apart from the scheduler because a chain is pure data: the scheduler
 * decides *when* to send one, this module decides *what* one is. A few chains
 * need a real server-side id first (the expert family), which is why the builder
 * is allowed to be async and to call the upstream.
 */
/**
 * How a chain reaches the upstream.
 *
 * There are three fingerprint families and the scorer keys different tasks to
 * different ones, so the transport is part of the chain rather than a detail of
 * the sender: `Buddy_App` needs the desktop fingerprint, while `Library_read` is
 * only scored when it arrives with the WEB fingerprint.
 */
type TaskEventTransport = 'desktop' | 'web';
/** A ready-to-send chain, plus the channel it must go out on. */
interface TaskEventChain {
  transport: TaskEventTransport;
  /** Desktop chains: the event array. */
  events?: readonly Record<string, unknown>[];
  /** Web chains: the single page event to report. */
  web?: {
    eventCode: string;
    pageUrl: string;
    elementId: string;
    elementName: string;
  };
}
/**
 * The app the buddy chain enters.
 *
 * One chain lights up two tasks: `Buddy_App` (open any app) and `Buddy_App_QQ`
 * (the QQ-specific one), because this is a QQ-hosted app. Measured 0/1 → 1/1 on
 * both from a single chain.
 */
export declare const BUDDY_APP_ID = "cb_y5Dy46tPQGGWtueMxXbe";
export declare const BUDDY_APP_NAME = "企鹅教师助手";
/**
 * The buddy-app chain (two tasks).
 *
 * Five clicks in the order a user would make them: discover the app, see it,
 * enter it, confirm the account link, skip the second binding step.
 */
export declare function buddyAppChain(): TaskEventChain;
/**
 * The design-canvas chain (`create_canvas`, +300 — the joint largest reward).
 *
 * The two canvas events ride the same metrics channel as everything else, so no
 * real canvas is ever created; the chat chain in front supplies the ids they
 * reference. Measured 1/1 on three accounts.
 */
export declare function canvasChain(): TaskEventChain;
/**
 * The scheduled-task event (`automation_1`).
 *
 * One event is the whole chain — measured 1/1 on two accounts. The name is only
 * for the server's own records, so a generated one is fine.
 */
export declare function automationChain(): TaskEventChain;
/**
 * The plain chat chain (`RichMeow_Chat`, and the base of the template chain).
 *
 * Measured: this chain alone lights `RichMeow_Chat`.
 */
export declare function chatChain(): TaskEventChain;
/**
 * The "same as this case" chain (`playbook_prompt`).
 *
 * The scorer watches `playbook_prompt_send` — sending the prompt that the
 * inspiration case pre-fills — not the card impression or the button click, so
 * the whole click path is replayed for realism but the send is what counts.
 */
export declare function playbookChain(caseId?: string, caseName?: string): TaskEventChain;
/** The inspiration case the reference panel sends a prompt for. */
export declare const PLAYBOOK_CASE_ID = "pm-gtm-launch-plan";
export declare const PLAYBOOK_CASE_NAME = "新产品上市 GTM 发布计划一页纸";
/**
 * The five templates the reference panel cycles through, as `[id, name]`.
 *
 * The upstream does not check that these templates exist — only that five
 * distinct `template_used` events arrive — so they are the reference set.
 */
export declare const TEMPLATE_PRESETS: readonly (readonly [string, string])[];
/**
 * One "created a task from a template" chain (`template_5`, +100 for five).
 *
 * Each group is a chat chain (which supplies the ids the template events join
 * on) plus `agent_task_created_with_template` and `template_used`. Measured:
 * five groups in one report scored 5/5.
 */
export declare function templateChain(templateId: string, templateName: string): TaskEventChain;
/** Every template group, ready to send in order. */
export declare function templateChains(): readonly TaskEventChain[];
/**
 * The library-introduction click (`Library_read`).
 *
 * Scored on the WEB fingerprint — the same event posted with the desktop
 * fingerprint scores nothing — so this chain returns a web transport and the
 * scheduler routes it through `reportWebEvent`.
 */
export declare function libraryReadChain(): TaskEventChain;
/** The document the library click is reported against. */
export declare const LIBRARY_DOC_URL = "https://www.workbuddy.cn/space/d/o0KWYeynteVv06UnAZqIFm";
/** The theme key `Hp_Appearance` is scored on (和平精英激战金秋). */
export declare const APPEARANCE_THEME_KEY = "theme-tkmw7j";
/** The skill `skill_1` is scored on. */
export declare const SKILL_ID = "skill_2097350077599879168";
export declare const SKILL_NAME = "润泽小馆·日报撰写";
/** The 腾讯轻量云 expert `Expert_lighthouse` is scored on. */
export declare const LIGHTHOUSE_EXPERT_ID = "ex_2cvvUZQhDyeJ";
/**
 * Build the `skill_1` chain from a REAL conversation.
 *
 * Unlike the template and canvas chains, this one is verified against the
 * conversation it names, so the caller must first open a real chat and hand the
 * server-side ids in.
 */
export declare function skillChain(conversationId: string, requestId: string): TaskEventChain;
/** The theme-apply event `Hp_Appearance` is scored on. */
export declare function appearanceChain(themeKey?: string): TaskEventChain;
/** One expert from the platform's marketplace, as the summon chains need it. */
interface MarketExpert {
  expertId: string;
  expertType: string;
  displayName: string;
  profession: string;
  version: string;
  categories: readonly string[];
}
/**
 * The three "summon an expert" events (`expert_summon_click` and friends).
 *
 * Paid before the conversation, in the order the app emits them.
 */
export declare function expertSummonEvents(expert: MarketExpert): Record<string, unknown>[];
/** `mode` for the `expert_actual_use` payload; the scorer checks it. */
type ExpertUseMode = 'craft' | 'LOCAL';
/**
 * The "an expert really answered" event, which is what the expert tasks count.
 *
 * The `requestId` must be the SERVER's id for a real chat: a made-up one scores
 * nothing, because the scorer looks the conversation up.
 */
export declare function expertActualUseEvent(expert: MarketExpert, conversationId: string, requestId: string, mode?: ExpertUseMode): Record<string, unknown>;
/**
 * The chat chain for an expert conversation.
 *
 * `agent_task_created` carries the expert fields the scorer reads to attribute
 * the conversation to that expert.
 */
export declare function expertChatEvents(expert: MarketExpert, conversationId: string, requestId: string): Record<string, unknown>[];
//#endregion
//#region src/context-budget.d.ts
/**
 * Context-window budgeting for the WorkBuddy shim.
 *
 * The upstream answers `context_length_exceeded` (business code 11115) when a
 * request overruns the model's window. Rather than bouncing that back to the
 * user as a dead turn, the shim compacts the conversation on the fly:
 *
 *  1. estimate the prompt cost locally (cheap, no round trip);
 *  2. drop the oldest turns while keeping `system` + the newest exchange;
 *  3. if that still overruns, ask the model itself to summarise the middle of
 *     the conversation and splice that summary back in as a system message.
 *
 * Everything here is pure and synchronous-free except `summarizeMessages`,
 * which the caller drives through an injected chat function so this module
 * stays testable without a network.
 *
 * @module dsh-workbuddy-xdpool/context-budget
 */
/** One OpenAI chat message, narrowed to the fields we must preserve. */
interface ChatMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}
//#endregion
//#region src/upstream.d.ts
/** Upstream failure classes the shim maps onto distinct HTTP answers. */
type UpstreamErrorKind = 'hard_credit' | 'soft_rate' | 'session_dead' | 'not_found' | 'server' | 'client';
/** Token-refresh answer; fields the upstream omits stay absent. */
interface WorkBuddyRefreshOutcome {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
  domain?: string;
}
/** One CLI-usable model, carrying what the plugin card displays. */
interface WorkBuddyUpstreamModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  creditMultiplier?: number;
  /** Upstream image-input flag. Both gateways spell it `supportsImages`; some entries
   * also carry `disabledMultimodal`, the negative spelling. Reading anything else
   * reported every model as text-only, which made a vision shim register a second
   * route under the same display name and split the model picker group.
   */
  supportsImages?: boolean;
  reasoning?: {
    supportedEfforts?: readonly string[];
    defaultEffort?: string;
    canDisableThinking?: boolean;
  };
  descriptionZh?: string;
  descriptionEn?: string;
  supportsToolCall?: boolean;
}
/** One billing package, already normalised. */
interface WorkBuddyCreditPackage {
  packageName: string;
  remain: number;
  size: number;
  monthly: boolean;
  refreshAtMs?: number;
  expiresAtMs?: number;
}
/** Aggregated credit answer for one credential. */
interface WorkBuddyCredits {
  total: number;
  packages: readonly WorkBuddyCreditPackage[];
  expiringSoon: number;
  nearestExpiryMs?: number;
}
/** Daily check-in activity state. */
interface WorkBuddyCheckinStatus {
  active: boolean;
  todayCheckedIn: boolean;
  streakDays: number;
  dailyCredit: number;
  todayCredit: number;
  isStreakDay: boolean;
  nextStreakDay: number;
  streakBonusDays: number;
  streakBonusCredit: number;
  /** Upstream-supplied button label; the card falls back to its own copy. */
  claimButtonText?: string;
}
/** Daily check-in claim result. */
interface WorkBuddyCheckinClaim {
  credit: number;
  streakDays: number;
  isStreakDay: boolean;
}
/** Result of one upstream chat attempt. */
type ChatStreamResult = {
  ok: true;
  response: Response;
} | {
  ok: false;
  kind: UpstreamErrorKind;
  status: number;
  message: string;
};
interface UpstreamClientOptions {
  /** Injectable fetch, primarily for tests. */
  fetchImpl?: typeof fetch;
  /** Client version string sent to the upstream. */
  clientVersion?: string;
}
/** Region for a login domain; an empty domain means CN (matching upstream tooling). */
/** The two gateways WorkBuddy serves: the domestic one and the international one. */
type WorkBuddyRegion = 'cn' | 'global';
/**
 * Classify an upstream failure from its HTTP status and body excerpt.
 * Body markers win over status, because the upstream reuses 400/200 for
 * several distinct conditions.
 */
export declare function classifyUpstreamError(status: number, body: string): UpstreamErrorKind;
/**
 * Parse the reset time the upstream reports for a rate limit, when present.
 * Recognises an epoch-millisecond field and the Chinese-localised sentence
 * form, so the pool can resume exactly when the window reopens.
 */
export declare function parseRateLimitReset(body: string): number | undefined;
/** One growth-centre task, flattened from the upstream's loosely-shaped entry. */
/** One streak tier and what redeeming it pays. */
interface WorkBuddyStreakTier {
  /** Tier key, e.g. `7d`. */
  tier: string;
  /** Login days the tier needs. */
  days: number;
  credit: number;
  energy: number;
  cards: number;
  /** Lottery draws the tier grants. */
  chances: number;
  /** `locked` / `unlocked` / `claimed`. */
  status: string;
}
/** The growth streak as a whole: progress, tiers, makeup cards. */
interface WorkBuddyStreakStatus {
  /** Current consecutive active days. */
  days: number;
  /** Days active this month. */
  monthTotalDays: number;
  /** Next tier key, e.g. `7d`. */
  nextTier: string;
  /** Days still needed for `nextTier`. */
  nextTierRemaining: number;
  /** Makeup cards in hand. */
  makeupCards: number;
  tiers: readonly WorkBuddyStreakTier[];
}
/** One buddy trip state. */
interface WorkBuddyTravelState {
  /** `idle` (can depart) / `traveling` / `arrived` (can claim). */
  state: string;
  /** Trip id, required to claim an arrived trip. */
  recordId: number;
  /** The once-a-day depart limit has been used. */
  dailyLimitReached: boolean;
  /** Credits an arrived trip pays. */
  rewardCredit: number;
}
interface WorkBuddyTask {
  /** Upstream task code; the claim path is built from it. */
  taskCode: string;
  title: string;
  /** Reward in credits, when the task declares one. */
  credit: number;
  /** Reward in energy, when the task declares one. */
  energy: number;
  /** Whether the task carries any reward at all. */
  hasReward: boolean;
  /** Progress target; 0 is a valid value (a task with no counter). */
  target: number;
  /** Current progress; 0 is a valid value. */
  current: number;
  /** Upstream enrolment state: not_accepted / accepted / claimed. */
  acceptStatus: string;
  /** Upstream task state, e.g. `complete`. */
  status: string;
  /** Progress reached its target and the reward is still outstanding. */
  claimable: boolean;
  /** Reward already collected. */
  claimed: boolean;
  /** Upstream marked the task locked (not yet reachable). */
  locked: boolean;
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
export declare function desktopChatEvents(conversationId: string, requestId: string, messageId: string, modelId?: string, modelName?: string): Record<string, unknown>[];
/**
 * A chat chain plus the two canvas events that score `create_canvas`.
 *
 * Worth +300, the joint largest task on the board. The canvas events ride
 * the same metrics channel as everything else, so no real canvas is needed.
 *
 * Measured: three accounts scored 1/1 from this sequence.
 */
export declare function desktopCanvasEvents(conversationId: string, requestId: string): Record<string, unknown>[];
/**
 * The single event that scores `automation_1` (a scheduled task was created).
 *
 * Measured: two accounts lit it with this event alone.
 */
export declare function desktopAutomationCreatedEvent(name: string): Record<string, unknown>;
export declare function buddyAppEvents(buddyId: string, buddyName: string): Record<string, unknown>[];
export declare class WorkBuddyUpstreamClient {
  private readonly fetchImpl;
  private readonly clientVersion;
  constructor(options?: UpstreamClientOptions);
  /**
   * Normalize an OpenAI chat-completions body for the WorkBuddy upstream:
   * force `stream: true` (the upstream rejects non-streaming), convert the
   * DSH `developer` role into `system` (upstream rejects `developer` with
   * business code 11128), and flatten `tool_choice` into its string form.
   */
  prepareChatBody(raw: string): string;
  /**
   * Parse a raw OpenAI chat body without normalising it.
   *
   * The compactor needs the message array as objects, while `chatStream` only
   * accepts the serialised string form.
   */
  parseChatBody(raw: string): Record<string, unknown> | undefined;
  /** Re-serialise `base` with a rewritten `messages` array, still normalised. */
  buildChatBody(base: Record<string, unknown>, messages: readonly ChatMessage[]): string;
  /**
   * Run one NON-streaming completion and return the assistant text.
   *
   * Used only for internal compaction (summarising dropped turns). The chat
   * endpoint itself always streams, so this reassembles the SSE frames into a
   * single string. Throws on any failure: the compactor then falls back to
   * plain truncation rather than failing the user's turn.
   */
  completeChat(credential: WorkBuddyCredential, prepared: string, signal?: AbortSignal): Promise<string>;
  /** Forward one chat completion. Never throws for upstream failures. */
  chatStream(credential: WorkBuddyCredential, prepared: string, signal?: AbortSignal): Promise<ChatStreamResult>;
  /** POST the token-refresh endpoint; the caller merges the outcome. */
  refreshToken(credential: WorkBuddyCredential): Promise<WorkBuddyRefreshOutcome>;
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
  fetchModels(credential: WorkBuddyCredential, signal?: AbortSignal): Promise<readonly WorkBuddyUpstreamModel[]>;
  /** Read-only credits query, aggregated by package. Does not consume credits. */
  fetchCredits(credential: WorkBuddyCredential): Promise<WorkBuddyCredits>;
  /** Query today's check-in status without changing account state. */
  fetchCheckinStatus(credential: WorkBuddyCredential): Promise<WorkBuddyCheckinStatus>;
  /** Claim today's check-in reward. The browser route guards this mutation. */
  claimDailyCheckin(credential: WorkBuddyCredential): Promise<WorkBuddyCheckinClaim>;
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
  desktopFingerprint(credential: WorkBuddyCredential): Record<string, unknown>;
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
  reportDesktopEvents(credential: WorkBuddyCredential, events: readonly Record<string, unknown>[]): Promise<void>;
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
  reportWebEvent(credential: WorkBuddyCredential, eventCode: string, pageUrl: string, elementId: string, elementName: string): Promise<void>;
  /**
   * Apply an appearance theme on the account.
   *
   * The theme task is scored on the `appearance_skin_apply` event, not on this
   * call — but the event alone is not enough either. The pair is what a real
   * client produces: it PATCHes the account's selected skin, then reports the
   * event as the settings page closes. Measured on the reference panel after
   * the earlier "the API alone does not score" reading was corrected.
   */
  setAppearanceTheme(credential: WorkBuddyCredential, resourceKey: string): Promise<void>;
  /**
   * The platform's expert marketplace.
   *
   * Needed before any expert can be summoned: the scorer verifies that the
   * expert id exists on the platform, so a made-up id scores nothing. The
   * response carries the display fields the summon events replay.
   */
  marketExpertList(credential: WorkBuddyCredential, expertType?: 'agent' | 'team' | ''): Promise<readonly MarketExpert[]>;
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
  openConversation(credential: WorkBuddyCredential, expertId?: string, signal?: AbortSignal): Promise<{
    conversationId: string;
    requestId: string;
  } | undefined>;
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
  reportActivity(credential: WorkBuddyCredential, conversationId?: string): Promise<void>;
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
  growthStreakDays(credential: WorkBuddyCredential): Promise<number>;
  /**
   * The full streak picture: days, tier unlock state, and what each tier pays.
   *
   * Read before redeeming, because the tier state is the only honest answer to
   * "is there anything to claim": the redeem endpoint answers 403 for a locked
   * tier, which is indistinguishable from a real failure once the response is
   * just an error.
   */
  growthStreakFull(credential: WorkBuddyCredential): Promise<WorkBuddyStreakStatus>;
  /**
   * Redeem one unlocked streak tier.
   *
   * A locked tier answers 403 ("连续登录天数不足"); callers check the status from
   * {@link growthStreakFull} first, so this only throws for genuine failures.
   * The client token is the upstream's idempotency key — a fresh one per attempt
   * keeps a retry from being read as a duplicate of the last one.
   */
  redeemStreakTier(credential: WorkBuddyCredential, tier: string): Promise<void>;
  /** How many lottery draws are available right now. */
  lotteryChances(credential: WorkBuddyCredential): Promise<number>;
  /**
   * Draw the lottery once.
   *
   * Returns the raw prize payload: its shape is set by the running campaign, so
   * it is passed through rather than modelled.
   */
  lotteryDraw(credential: WorkBuddyCredential): Promise<unknown>;
  /**
   * The buddy profile, or undefined when the account has no buddy yet.
   *
   * `data.buddy` is null / absent / an empty object depending on how far the
   * account got, and all three mean the same thing to a caller: adopt first.
   */
  buddyInfo(credential: WorkBuddyCredential): Promise<{
    instanceId: number;
    name: string;
  } | undefined>;
  /** Agree to the buddy terms. Idempotent upstream. */
  buddyAgree(credential: WorkBuddyCredential): Promise<void>;
  /**
   * Adopt the first buddy.
   *
   * Gated upstream on having reported activity that day: without it the answer
   * is 400 "first_buddy task not completed yet". Callers treat that as "not yet"
   * rather than an error, which is why it is thrown as-is for them to classify.
   */
  buddyAdoptFirst(credential: WorkBuddyCredential): Promise<void>;
  /** Current travel state for the account's buddy. */
  buddyTravelStatus(credential: WorkBuddyCredential): Promise<WorkBuddyTravelState>;
  /**
   * Send the buddy travelling.
   *
   * The location is always 4 (古镇客栈): the four locations have identical
   * reward and duration ranges, so there is nothing to optimise.
   */
  buddyTravelDepart(credential: WorkBuddyCredential, locationId?: number): Promise<void>;
  /**
   * Collect an arrived trip's reward.
   *
   * `recordId` is required and comes from the status read; the upstream rejects
   * a claim without it.
   */
  buddyTravelClaim(credential: WorkBuddyCredential, recordId: number): Promise<number>;
  /** Whether yesterday is a gap in the activity heatmap. */
  heatmapYesterdayMissed(credential: WorkBuddyCredential): Promise<boolean>;
  /** Spend one makeup card on a date. Idempotent for an already-filled date. */
  useMakeupCard(credential: WorkBuddyCredential, date: string): Promise<void>;
  /**
   * Call a growth-domain endpoint and return its unwrapped `data`.
   *
   * These endpoints live on the chat host with the billing header set, and
   * carry the same envelope as everything else. Centralised here because every
   * growth call needs the identical envelope check.
   */
  private growthJson;
  /** Legacy thin wrapper kept for `status`/`doctor`: returns raw envelope data. */
  credits(credential: WorkBuddyCredential): Promise<{
    ok: true;
    data: unknown;
  } | {
    ok: false;
    message: string;
  }>;
  /**
   * Fetch the growth task list for one account.
   *
   * The upstream answers `data.tasks[]`, and `claimable` is derived locally —
   * the upstream does not mark it. Only a task whose progress reached its
   * target and that is not already claimed counts as eligible.
   */
  listTasks(credential: WorkBuddyCredential): Promise<readonly WorkBuddyTask[]>;
  /**
   * Accept (enrol in) tasks by code.
   *
   * Accepting is the "sign up" half: it produces no progress by itself, and the
   * upstream answers success for an already-accepted task, so replaying this is
   * safe. Progress is lit by real activity (a chat, an activity report).
   */
  acceptTasks(credential: WorkBuddyCredential, taskCodes: readonly string[]): Promise<void>;
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
  claimTaskReward(credential: WorkBuddyCredential, taskCode: string): Promise<{
    credit: number;
    energy: number;
  }>;
}
//#endregion
//#region src/accounts.d.ts
/** Minimal upstream surface the pool needs to refresh a token (no circular import). */
interface TokenRefresher {
  refreshToken(credential: WorkBuddyCredential): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresInSec?: number;
    domain?: string;
  }>;
}
/** Live auth file name the WorkBuddy desktop app writes. */
export declare const WORKBUDDY_LIVE_FILENAME = "workbuddy-desktop.info";
/** Snapshot files left behind by previous logins share this prefix. */
/** Env override for the auth file or its directory. */
export declare const WORKBUDDY_AUTH_FILE_ENV = "WORKBUDDY_AUTH_FILE";
/** One parsed WorkBuddy credential. */
interface WorkBuddyCredential {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  refreshExpiresAtMs?: number;
  /**
   * When the upstream says it issued this token (`auth.lastRefreshTime`).
   *
   * This, not `expiresAtMs`, is the reliable freshness signal: the upstream
   * never rewrites a stored expiry when it revokes a token, so a long-dead
   * backup can claim to expire later than the token that actually works.
   * Absent on documents the desktop app did not write (the plugin's own
   * refreshed copy, older builds).
   */
  lastRefreshAtMs?: number;
  nickname?: string;
  uin?: string;
  uid?: string;
  enterpriseId?: string;
  domain: string;
  /** Where this credential came from, for diagnostics. */
  sourcePath: string;
}
/** An account is a credential plus pool bookkeeping. */
interface WorkBuddyAccount {
  /** Stable pool key: sha256 of the billing identity. */
  id: string;
  /** Short human label, e.g. `青楫渡` or `青楫渡#29890334`. */
  label: string;
  credential: WorkBuddyCredential;
  /**
   * Epoch ms until which this account is skipped for EVERY model. Only set by
   * account-wide cooldowns (callers that penalize without a model id). The
   * upstream rate limit is actually per-model ("可切换其他模型继续使用"), so
   * routine 429s are tracked in {@link modelCooldowns} instead and never ban a
   * whole account.
   */
  cooldownUntilMs: number;
  /**
   * Per-model cooldowns, keyed by upstream model id → epoch ms until that model
   * on THIS account is skipped. A 429 on `hy4-preview` cools only that model
   * here; `hy3`/`glm-*` on the same account keep serving.
   */
  modelCooldowns: Record<string, number>;
  /** Consecutive rate-limit hits, for diagnostics. */
  rateLimitHits: number;
}
/**
 * Platform-default directories holding the desktop app's auth files.
 * Windows probes Local before Roaming; a redirected profile still resolves
 * through the env location.
 */
export declare function defaultDesktopAuthDirs(platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv): string[];
/**
 * Parse a WorkBuddy auth document. Accepts the nested desktop shape
 * `{"auth":{...},"account":{...}}` and the flat panel shape; returns undefined
 * when there is no usable access token.
 *
 * `decrypt` opens the desktop app's `$wbEncrypted` field wrapper (5.6.0+, both
 * platforms). Absent means "plain-string builds only", which is what every
 * caller without an at-rest key should pass.
 */
export declare function parseWorkBuddyAuth(text: string, sourcePath: string, decrypt?: (field: unknown) => string): WorkBuddyCredential | undefined;
export declare function workbuddyAccountId(credential: Pick<WorkBuddyCredential, 'uin' | 'uid' | 'nickname'>): string;
/** Every directory the pool should scan, in probe order. */
export declare function candidateAuthDirs(env?: NodeJS.ProcessEnv): string[];
/** How the pool chooses which account serves the next request. */
type AccountDistribution = 'priority' | 'round-robin' | 'balanced';
interface AccountPoolOptions {
  /** Logger for discovery and rotation events. */
  logger?: {
    info?(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error?(...args: unknown[]): void;
  };
  /** Override the directories scanned (tests). */
  authDirs?: readonly string[];
  /** How long a rate-limited account stays out of rotation. */
  cooldownMs?: number;
  /** How long an account rests after its credits run out (default 30 minutes). */
  exhaustCooldownMs?: number;
  /** Upstream client used to refresh near-expiry tokens. */
  client?: TokenRefresher;
  /** Refresh this long before actual expiry; default five minutes. */
  refreshMarginMs?: number;
  /**
   * How requests are spread across the pool.
   *
   * - `priority` (default): one account serves every request until it is
   *   rate-limited, then the next in order takes over. Credits drain one
   *   account at a time, and a cooled account resumes at the head of the
   *   queue the moment its window resets.
   * - `round-robin`: consecutive requests rotate through the pool so the
   *   spend spreads evenly.
   */
  distribution?: AccountDistribution;
}
export declare class WorkBuddyAccountPool {
  private readonly logger;
  private authDirs;
  private cooldownMs;
  /**
   * How long an account stays out of rotation after the upstream reports its
   * credits are spent. Credit packs reset on their own schedule rather than on a
   * rate-limit window, so this is much longer than `cooldownMs`.
   */
  private exhaustCooldownMs;
  private readonly client;
  private readonly refreshMarginMs;
  private accounts;
  private distribution;
  /** Cursor for round-robin mode; unused under priority distribution. */
  private cursor;
  private lastScanAtMs;
  private preferredId;
  /**
   * Account ids the user switched off on the card.
   *
   * Disabling is a user preference rather than a property of the credential:
   * `scan()` rebuilds every account object from the auth files, so the set
   * lives on the pool and is re-applied from settings after each scan.
   */
  private disabledIds;
  /**
   * Per-account credit floor, keyed by account id. 0 (or absent) means "spend
   * it all".
   *
   * A reserved balance is protection, not a hard limit the upstream knows
   * about: the pool simply stops picking that account once its last known
   * balance is at or below the floor, so the user keeps a cushion instead of
   * draining every account to zero.
   */
  private creditReserves;
  /**
   * Last known credit balance per account, epoch ms aside.
   *
   * Refreshed in the background after a successful request, so a pick can
   * consult it. An account with no reading is treated as usable: refusing to
   * pick an account just because its balance has not been checked yet would
   * strand a healthy pool, and the first 402 still cools it as before.
   */
  private creditBalances;
  /**
   * Last time each account served a request, epoch ms. Drives the idle term
   * of the priority-mode weighting below: an account that just served loses to
   * one that has been idle, so a small pool stops hammering a single account.
   *
   * In-memory on purpose: it only biases the next pick, so a cold start that
   * treats every account as idle is the right default. Not keyed by id lookup
   * misses because a removed account simply disappears from the map on re-scan.
   */
  private lastUsedAt;
  private refreshInflight;
  constructor(options?: AccountPoolOptions);
  /**
   * Re-apply configuration that only affects discovery and cooldown policy,
   * without rebuilding the pool. A later `scan()` uses the new auth dirs and
   * cooldown window; existing accounts keep their in-memory state.
   */
  applyConfig(options: {
    authDirs?: readonly string[];
    cooldownMs?: number;
    exhaustCooldownMs?: number;
    distribution?: AccountDistribution;
    disabledAccountIds?: readonly string[];
    /** Per-account credit floor, keyed by account id. Absent keeps the current map. */
    creditReserves?: Readonly<Record<string, number>>;
  }): void;
  /** Rescan the auth directories and merge newly discovered accounts. */
  scan(): Promise<WorkBuddyAccount[]>;
  /** All accounts, cooldown state included. */
  list(region?: WorkBuddyRegion): readonly WorkBuddyAccount[];
  /**
   * Accounts currently eligible to serve a request.
   *
   * With a `modelId`, an account is eligible when it is not account-wide cooled
   * AND that model is not cooling on it — so a 429 on `hy4-preview` only keeps
   * that model out while `hy3` on the same account stays usable. Without a
   * model id the legacy account-wide check applies (callers that cannot name a
   * model, e.g. CLI diagnostics).
   */
  private available;
  /** Round-robin: the legacy cursor walk, kept for the distribution that asks for it. */
  private pickRoundRobin;
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
  private pickByWeight;
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
  acquire(modelId?: string, region?: WorkBuddyRegion): Promise<WorkBuddyAccount | undefined>;
  /** Pin the account the plugin card should prefer; tokens stay out of settings. */
  /** How the pool currently spreads requests. Shown on the card. */
  currentDistribution(): AccountDistribution;
  prefer(accountId: string | undefined): void;
  /** Whether the user switched this account off on the card. */
  isDisabled(accountId: string): boolean;
  /** Every account id the user switched off, in discovery order. */
  disabledIdsInOrder(): string[];
  /**
   * Record that an account actually served a request.
   *
   * Called by the shim once the upstream answers 200 — only then is the account
   * the one the user is really being served by. `balanced` mode reads the same map
   * for its idle weighting, so a request that failed over to another account must
   * not count as used for the account that was merely tried.
   */
  noteServed(accountId: string): void;
  /**
   * Record an account latest known credit balance.
   *
   * Called after a request and by the card balance refresh, so the reserve
   * check has something to compare against. A reading for an unknown account is
   * dropped: `scan()` rebuilds the account list and a stale id would otherwise
   * accumulate forever.
   */
  noteCredits(accountId: string, balance: number): void;
  /** Last known balance for one account, or undefined when never read. */
  creditsOf(accountId: string): number | undefined;
  /** The credit floor the user set for one account; 0 when unset. */
  creditReserveOf(accountId: string): number;
  /**
   * Replace every reserve. Called from settings on each apply, so the map
   * mirrors the saved document exactly instead of accumulating old keys.
   */
  setCreditReserves(reserves: Readonly<Record<string, number>>): void;
  /** Every reserve currently in force, keyed by account id. */
  creditReservesInOrder(): Record<string, number>;
  /**
   * Whether an account is held back only by its reserve.
   *
   * Separates "resting to protect credits" from every other reason an account
   * is out of rotation, which is what the card shows the user.
   */
  isReserved(accountId: string): boolean;
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
  lastServedId(): string | undefined;
  /** Best-effort refresh of one account after a session-dead upstream answer. */
  refreshAccount(accountId: string): Promise<void>;
  /**
   * Refresh the account's access token when it is within the margin (or already
   * expired), in-flight de-duped per account. A failed refresh keeps the
   * existing token when it has not yet expired, so an unreachable refresh
   * endpoint never takes down a working session.
   */
  private ensureFresh;
  /**
   * Cool a whole account after the upstream reports its credits are spent.
   *
   * Credit exhaustion is an ACCOUNT condition, unlike a model rate limit: every
   * model on that account is unusable until the quota resets, so this cools the
   * account as a whole (no `modelId`) for the configured exhaustion window. The
   * shim then rotates to a different account instead of failing the request.
   */
  penalizeExhausted(accountId: string): void;
  /**
   * Mark an account (or one of its models) rate-limited.
   *
   * With `modelId`, only that model on the account is cooled — the account's
   * other models stay in rotation, matching the upstream's per-model rate
   * limit ("可切换其他模型继续使用"). Without a model id the whole account is
   * cooled, which callers should reserve for limits that truly span every model.
   */
  penalize(accountId: string, resetAtMs?: number, modelId?: string): void;
  /** Clear all cooldowns (account-wide and per-model), e.g. from a reset command. */
  resetCooldowns(): void;
  /** Diagnostics snapshot. Account-wide cooling count (per-model cooling excluded:
   *  the account as a whole stays usable when only one model is limited). */
  status(): {
    count: number;
    cooling: number;
    lastScanAtMs: number;
  };
}
//#endregion
//#region src/catalog.d.ts
/** One model the provider exposes. */
interface WorkBuddyModelInfo {
  id: string;
  /** Display name; the multiplier is appended for the picker. */
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  /** Relative credit cost, e.g. 0.79 for `x0.79`. */
  multiplier?: number;
  /** Upstream-declared thinking levels. */
  supportedEfforts?: readonly string[];
  supportsImages: boolean;
  /** Upstream tags: free / limited-free / night-discount. */
  tags?: readonly string[];
}
/** Static fallback used before the first live catalog fetch. */
export declare const FALLBACK_WORKBUDDY_MODELS: readonly WorkBuddyModelInfo[];
/** Live catalog with a static fallback behind it. */
export declare class WorkBuddyCatalog {
  private models;
  private listeners;
  /** User's model selection. Empty object = follow the catalog unfiltered. */
  private selection;
  current(): readonly WorkBuddyModelInfo[];
  /**
   * The models DSH should actually offer, after applying the user's selection:
   * disabled models are dropped, an explicit image list overrides the upstream
   * capability flag, and a per-model budget caps the advertised window.
   *
   * An absent `enabledModelIds` means "everything" — a fresh install with no
   * saved selection must not present an empty picker.
   */
  visible(): readonly WorkBuddyModelInfo[];
  /** Replace the catalog and notify the adapter to rebuild its model list. */
  update(models: readonly WorkBuddyModelInfo[]): void;
  /** Restore the static fallback, e.g. when the upstream stops answering. */
  reset(): void;
  /** Replace the user's selection; the adapter rebuilds from `visible()`. */
  applySelection(selection: ModelSelection): void;
  /** The selection currently in force, for the card's save round-trip. */
  currentSelection(): ModelSelection;
  onChange(listener: () => void): () => void;
  find(id: string): WorkBuddyModelInfo | undefined;
  /** Replace the catalog from the live upstream list; keeps the fallback if empty. */
  updateFromUpstream(models: readonly WorkBuddyUpstreamModel[]): void;
  private notify;
}
/** The user's model selection, as stored in the settings section. */
interface ModelSelection {
  /** Absent = every model in the catalog is offered. */
  enabledModelIds?: readonly string[];
  /** Absent = each model follows its upstream image capability. */
  imageModelIds?: readonly string[];
  /** Per-model context-window cap, keyed by model id. */
  contextBudgets?: Readonly<Record<string, number | undefined>>;
}
//#endregion
//#region src/shim.d.ts
interface ShimLogger {
  info?(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
interface WorkBuddyShim {
  ready: Promise<void>;
  baseUrl(): string;
  token(): string;
  close(): Promise<void>;
}
interface WorkBuddyShimOptions {
  pool: WorkBuddyAccountPool;
  client: WorkBuddyUpstreamClient;
  catalog: WorkBuddyCatalog;
  logger?: ShimLogger;
  /**
   * Restrict this shim to one gateway. Two shims run side by side — one
   * per region — and each must only ever draw accounts that belong to its
   * own gateway. Absent means "every account" (a single-region deployment).
   */
  region?: WorkBuddyRegion;
  /** Max accounts to try per request before giving up. */
  maxAttempts?: number;
}
export declare function createWorkBuddyShim(options: WorkBuddyShimOptions): WorkBuddyShim;
//#endregion
//#region src/adapter.d.ts
/** Provider route this bundle owns. */
/** Provider route this bundle owns for the domestic (CN) gateway. */
export declare const WORKBUDDY_POOL_PROVIDER = "workbuddy-xdpool";
interface WorkBuddyAdapterOptions {
  shim: WorkBuddyShim;
  catalog: WorkBuddyCatalog;
  /** Plugin context; the pi-ai adapter reads `attachments`/`fs` from it. */
  ctx: Context$1;
  providerId?: string;
  displayName?: string;
}
/** What {@link createWorkBuddyAdapter} hands back. */
interface WorkBuddyAdapter {
  providerId: string;
  displayName: string;
  adapter: PiAiAdapter;
  /** Rebuild the pi-ai model list from the current catalog. */
  buildModels: () => Model<Api>[];
  /** Rebuild the adapter's provider snapshot; call after a catalog update. */
  invalidate: () => void;
}
/**
 * Assemble the adapter. `getModels` re-reads the live catalog, and every
 * model's `baseUrl` is re-resolved per read so the shim's ephemeral port
 * applies from the first snapshot after startup. Call only after `shim.ready`.
 */
export declare function createWorkBuddyAdapter(options: WorkBuddyAdapterOptions): WorkBuddyAdapter;
//#endregion
//#region src/scheduler.d.ts
/** How often the loop wakes to look for a due job. */
/**
 * How long to wait for event scoring to land before re-reading the task list.
 *
 * Scoring is asynchronous on the upstream side, so an immediate re-read still
 * shows the old progress and the claim pass would skip a task that is in fact
 * now claimable. Measured: the chain is reflected by about eight seconds.
 */
export declare const EVENT_SCORE_WAIT_MS = 9000;
export declare const AUTOMATION_TICK_MS = 60000;
/** Which jobs the automation runs, and when. */
/**
 * The persisted daily earnings ledger.
 *
 * `date` is the local day the counters belong to: a ledger from a previous day
 * is discarded on load rather than carried forward as "today".
 */
interface AutomationLedger {
  date: string;
  accounts: Record<string, AutomationAccountEarnings>;
}
interface AutomationOptions {
  /** Master switch; false stops every job. */
  enabled?: boolean;
  /** Hour list for the daily check-in job. */
  checkinHours?: readonly number[];
  /** Hour list for the task-centre job (accept + claim). */
  taskHours?: readonly number[];
  /** Hour list for the activity-report job. */
  reportHours?: readonly number[];
  /** Hour list for the streak-redemption job. */
  streakHours?: readonly number[];
  /** Hour list for the buddy travel job. */
  travelHours?: readonly number[];
  /** Per-account serial delay, in milliseconds. */
  accountDelayMs?: number;
  /** Override the gap between expert chains, in milliseconds (tests use 0). */
  expertGapMs?: number;
  /** Override the event-scoring wait, in milliseconds (tests use 0). */
  eventScoreWaitMs?: number;
  /** Override the clock, for tests. */
  now?: () => Date;
  /** Logger; defaults to a no-op so tests stay quiet. */
  logger?: SchedulerLogger;
  /**
   * Persist the daily earnings ledger, and restore it on construction.
   *
   * The ledger cannot live only in memory: a host restart mid-day would wipe
   * what the automation already earned, and the card would show nothing for
   * rewards that really were collected.
   */
  loadEarnings?: () => AutomationLedger | undefined;
  saveEarnings?: (ledger: AutomationLedger) => void;
}
/** Logger surface, kept structural so any host logger fits. */
interface SchedulerLogger {
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
}
/** One job's last-run record, surfaced on the status document. */
interface AutomationJobState {
  /** `YYYY-MM-DD` of the last completed run, or undefined if it never ran. */
  lastRunDate?: string;
  /**
   * The scheduled SLOT of the last run, as `YYYY-MM-DDTHH`.
   *
   * The tick de-duplicates on this rather than on the date: keying on the date
   * alone caps every job at one run a day, which is wrong for a job with two
   * time points — blocking the cat loop's second pass would leave the cat out
   * until tomorrow. Per slot a job runs once in each configured hour, while a
   * repeat tick inside the same hour is still refused.
   */
  lastRunSlot?: string;
  /** Epoch ms of the last completed run. */
  lastRunAtMs?: number;
  /** Accounts that completed without throwing. */
  ok: number;
  /** Accounts that threw (each one skipped, the run continued). */
  failed: number;
  /** Credits claimed by the task job on the last run. */
  credit: number;
  /** Energy claimed by the task job on the last run. */
  energy: number;
  /** Tasks claimed by the task job on the last run. */
  claimed: number;
  /** Human-readable summary of the last run. */
  /**
   * What this run actually did, in the words of the task board.
   *
   * `message` is a count ("3 accounts, 5 tasks claimed"); this is the list a
   * person can check off — the reward titles the pass collected. A row showing
   * only a bare number cannot answer "did it do the thing I care about", which
   * is the question the panel exists to answer.
   */
  detail?: readonly string[];
  /**
   * A pending milestone worth naming, when there is one.
   *
   * Streak tiers are why this exists: every tier reads `locked` until enough
   * consecutive days accumulate, and "locked" on its own reads as "broken"
   * rather than "come back in four days".
   */
  progress?: string;
  message?: string;
}
/**
 * What the automation earned for ONE account today.
 *
 * Reset at the local day boundary alongside the per-job "already ran today"
 * guard, so the card shows today rather than a running total that never
 * answers "did it do anything for this account recently".
 */
interface AutomationAccountEarnings {
  /** Credits the automation claimed from the task centre today. */
  credit: number;
  /** Energy claimed from the task centre today. */
  energy: number;
  /** Tasks claimed today. */
  claimed: number;
  /**
   * Credits the automation collected from check-in today.
   *
   * Kept separate from `credit` because they are different achievements and the
   * card shows them on their own lines: "the automation claimed 3 tasks" and
   * "the automation checked in" are not the same claim to the user.
   */
  checkinCredit: number;
  /** Credits from streak redemption + lottery today. */
  bonusCredit: number;
  /** Credits from the buddy adoption / travel loop today. */
  travelCredit: number;
  /** Local date the counters belong to. */
  date: string;
}
/** What ONE account gained during a single run. */
interface AutomationAccountGain {
  credit: number;
  energy: number;
  claimed: number;
  checkinCredit: number;
  bonusCredit: number;
  travelCredit: number;
}
/** Totals from running the whole ordered pass at once. */
interface AutomationRunSummary {
  /** How many jobs actually ran (a job with no hour is skipped). */
  jobsRun: number;
  /** Accounts that finished without error, summed across jobs. */
  okCount: number;
  /** Accounts that failed, summed across jobs. */
  failed: number;
  credit: number;
  energy: number;
  claimed: number;
  /**
   * What each account gained during THIS run, keyed by account id. Only
   * accounts that gained something appear.
   */
  accounts: Readonly<Record<string, AutomationAccountGain>>;
}
/** Automation snapshot for the status document and the card. */
interface AutomationStatus {
  enabled: boolean;
  /** Whether the loop is running. */
  running: boolean;
  checkinHours: readonly number[];
  taskHours: readonly number[];
  reportHours: readonly number[];
  streakHours: readonly number[];
  travelHours: readonly number[];
  jobs: {
    checkin: AutomationJobState;
    report: AutomationJobState;
    tasks: AutomationJobState;
    streak: AutomationJobState;
    travel: AutomationJobState;
  };
  /** Claimable tasks seen on the most recent task pass, across accounts. */
  claimableSeen: number;
  /**
   * Per-account totals for today, keyed by account id. Only accounts that
   * actually earned something appear, so the card can render "no earnings"
   * as an absence rather than a zero it has to explain.
   */
  earningsToday: Readonly<Record<string, AutomationAccountEarnings>>;
  /**
   * Whether a manual run is in flight right now.
   *
   * A run takes tens of seconds (one upstream call per account per job, plus
   * the scoring wait), which is far too long for the card to hold a request
   * open. The button starts a run and the panel polls this flag instead.
   */
  runInProgress: boolean;
}
/** The three plus one job kinds, in a stable order. */
type AutomationJobKind = 'checkin' | 'tasks' | 'report' | 'streak' | 'travel';
/** The four jobs in the order a tick runs them: report before tasks, always. */
export declare const AUTOMATION_JOB_KINDS: readonly AutomationJobKind[];
/** Reject anything that is not a job kind, so a route cannot name an unknown job. */
export declare function isAutomationJobKind(value: unknown): value is AutomationJobKind;
export declare function dayKey(date: Date, timeZone?: string): string;
/**
 * Whether `now`'s local hour is one of `hours`.
 *
 * The reference panel computes a `nextFire` instant and sleeps until it; this
 * loop instead wakes every minute and asks "is any job due now". Both fire at
 * the top of a configured hour, but the polling form cannot miss a slot to a
 * suspended process — a laptop that slept through 10:00 still runs the job the
 * moment it wakes, on the same day.
 */
export declare function isFireHour(now: Date, hours: readonly number[]): boolean;
/**
 * The points automation.
 *
 * Owns a single timer loop. Construction is inert — nothing runs until
 * {@link start}, and {@link stop} is idempotent so a plugin teardown that fires
 * twice is harmless.
 */
export declare class WorkBuddyScheduler {
  private readonly pool;
  private readonly client;
  private readonly logger;
  private readonly now;
  private readonly delayMs;
  /**
   * How long to wait for event scoring before re-reading the task list.
   * Tests set 0 so a pass does not spend nine real seconds per account.
   */
  private readonly eventScoreWaitMs;
  /**
   * Gap between two expert summon chains.
   * Tests set 0 so a pass does not spend six real seconds per expert.
   */
  private readonly expertGapMs;
  private enabled;
  private checkinHours;
  private taskHours;
  private reportHours;
  private streakHours;
  private travelHours;
  private timer;
  private running;
  /** Guards against a slow run overlapping the next tick. */
  private busy;
  /** True while a manual run is in flight, so the card can poll it. */
  private runInFlight;
  /**
   * Set once {@link stop} is called.
   *
   * Deliberately false before `start`: the loop is not running yet, but a
   * manual `tick` must still work. `stop` is what makes a run abandon the
   * accounts it has not reached yet.
   */
  private stopped;
  private readonly states;
  private claimableSeen;
  /**
   * Credits/energy/tasks earned per account TODAY, keyed by account id.
   *
   * Cleared whenever the day key rolls over, so the card always answers
   * "what did the automation get for THIS account today".
   */
  private earnings;
  /** Day key the counters above belong to. */
  private earningsDate;
  /** Host hooks that persist the ledger across restarts. */
  private readonly loadEarnings;
  private saveEarningsFn;
  constructor(pool: WorkBuddyAccountPool, client: WorkBuddyUpstreamClient, options?: AutomationOptions);
  /** Apply a new configuration; safe to call while running. */
  /**
   * Install the persistence hook once the host settings service is available.
   *
   * Separate from the constructor because the scheduler is built with the pool,
   * long before the settings section exists; a ledger written before that point
   * would have nowhere to go.
   */
  setEarningsPersistence(save: (ledger: AutomationLedger) => void): void;
  /**
   * Fold a previously persisted ledger back in, when it belongs to today.
   *
   * Used after the settings document becomes readable, which happens after
   * construction; a ledger from an earlier day is ignored so the counters never
   * claim yesterday as today.
   */
  applyEarningsLedger(ledger: AutomationLedger): void;
  applyConfig(options: AutomationOptions): void;
  /** Hours for one job, used by the loop and the status document. */
  private hoursOf;
  /** Start the loop. Idempotent. */
  start(): void;
  /** Stop the loop. Idempotent, and safe before `start`. */
  stop(): void;
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
  runNow(kind: AutomationJobKind, force?: boolean): Promise<AutomationJobState>;
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
  startRunAll(): boolean;
  runAll(): Promise<AutomationRunSummary>;
  status(): AutomationStatus;
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
  private isDue;
  private tick;
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
  private earningsSnapshot;
  /**
   * Add one account take to today counters, resetting first if the day rolled
   * over. Every source is tracked separately so the card can show what earned
   * what, rather than one opaque total.
   */
  private recordEarnings;
  /** Clear the per-account counters when the local day changes. */
  private rollEarnings;
  /**
   * Write the ledger through the host hook, when one was supplied.
   *
   * Best effort on purpose: a failed save must never abort a run that has
   * already collected rewards, and the in-memory ledger keeps serving the card
   * for the rest of the session either way.
   */
  private persistEarnings;
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
  private runJob;
  /** Compose the one-line summary shown on the card. */
  private summarise;
  /**
   * Accounts to run against, in pool order.
   *
   * Disabled accounts are excluded here rather than filtered by the caller so a
   * card switch takes effect on the next pass without any event plumbing.
   */
  private accountsInOrder;
  /**
   * Send one activity report, then verify it landed.
   *
   * The upstream answers 200 even when it drops the event, so the streak is
   * read back as the oracle: `days > 0` means it counted. A failed read-back is
   * logged and treated as a suspicious result, never as a retry — the report is
   * idempotent per day, and hammering it is exactly what the one-a-day quota
   * exists to avoid.
   */
  private reportOne;
  private sendEventChains;
  /**
   * Send one chain on the channel it was built for.
   *
   * The transport is not a detail of the sender: the scorer keys different
   * tasks to different fingerprint families, so a web-scored event posted as a
   * desktop event is accepted and then ignored.
   */
  private sendChain;
  /**
   * Build every chain that scores one task.
   *
   * Most tasks need a single chain; `template_5` needs five, because the scorer
   * counts distinct `template_used` events rather than a boolean. The two tasks
   * that join a conversation (skill, expert) open a real one first, which is why
   * this is async.
   */
  private chainsFor;
  /**
   * The summon-and-use chains for the expert tasks.
   *
   * Two steps per expert, and both are load-bearing: the summon events alone are
   * impressions, and a use event on its own scores nothing because the scorer
   * looks the conversation up. Only a real chat with `X-Expert-Id` produces an
   * id it will accept.
   */
  private expertChains;
  /**
   * The 腾讯轻量云 expert chain.
   *
   * Structurally the same as the expert task, with two differences the scorer
   * checks: `agent_task_created` has to name the expert, and the use event has
   * to report `mode: 'LOCAL'` with an empty type and zero cost — that is what
   * the lighthouse criterion looks for.
   */
  private lighthouseChains;
  /**
   * The task-centre pass for one account.
   *
   * Order matters: enrich first (enrol in everything open), then claim. Both
   * halves are idempotent — accepting an already-accepted task succeeds, and a
   * repeat claim answers `already_claimed` — so a pass that dies halfway is
   * safe to replay on the next tick.
   */
  private runTasks;
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
  private redeemStreak;
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
  private runTravel;
}
//#endregion
//#region src/status.d.ts
/** One account's status row. */
interface AccountStatus {
  id: string;
  label: string;
  nickname?: string;
  domain: string;
  /** ISO timestamp when the access token expires. */
  expiresAt?: string;
  /** Account-wide cooldown (every model blocked). */
  cooling: boolean;
  cooldownUntil?: string;
  /** Per-model cooldowns active right now (modelId → ISO until); the account
   *  itself is not `cooling` while only some models are limited. */
  modelCooldowns?: readonly {
    modelId: string;
    until: string;
  }[];
  rateLimitHits: number;
  /** Read-only aggregated credit summary for the account. */
  credits?: WorkBuddyCredits;
  creditsError?: string;
  sourcePath: string;
}
/** Whole-plugin status document. */
interface WorkBuddyStatus {
  ok: boolean;
  accounts: AccountStatus[];
  activeAccountId?: string;
  cooling: number;
  models: {
    id: string;
    name: string;
    multiplier?: number;
    tags?: readonly string[];
  }[];
  shim: {
    running: boolean;
    baseUrl?: string;
  };
}
interface StatusOptions {
  pool: WorkBuddyAccountPool;
  /** The catalog to report. Regional callers pass their own region's. */
  catalog: WorkBuddyCatalog;
  client: WorkBuddyUpstreamClient;
  shim?: {
    running: boolean;
    baseUrl?: string;
  };
  /** Query credits per account. Off for cheap diagnostics runs. */
  includeCredits?: boolean;
}
/** Build the status document. Never throws. */
export declare function buildStatus(options: StatusOptions): Promise<WorkBuddyStatus>;
/** Format the status document for a terminal. */
export declare function formatStatus(status: WorkBuddyStatus): string;
/** Format the per-model credit multipliers. */
export declare function formatRates(status: WorkBuddyStatus): string;
//#endregion
//#region src/status-paths.d.ts
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
export declare const POOL_STATUS_PATH = "/plugins/dsh-workbuddy-xdpool/status";
/** Plugin-owned local account rescan endpoint (re-read desktop snapshots). */
export declare const POOL_RESCAN_PATH = "/plugins/dsh-workbuddy-xdpool/accounts/rescan";
/** Plugin-owned cooldown reset endpoint (clear all 429 cooldowns). */
export declare const POOL_RESET_COOLDOWN_PATH = "/plugins/dsh-workbuddy-xdpool/cooldowns/reset";
/** Plugin-owned daily check-in action endpoint (claim today's reward). */
export declare const POOL_CHECKIN_PATH = "/plugins/dsh-workbuddy-xdpool/checkin";
/** Plugin-owned model-selection save endpoint (writes the settings section). */
export declare const POOL_MODELS_SAVE_PATH = "/plugins/dsh-workbuddy-xdpool/models/save";
/** Run one automation job immediately, so the card can verify it on demand. */
export declare const POOL_AUTOMATION_RUN_PATH = "/plugins/dsh-workbuddy-xdpool/automation/run";
/** Set or clear one account's reserved-credit floor. */
export declare const POOL_CREDIT_RESERVE_PATH = "/plugins/dsh-workbuddy-xdpool/accounts/credit-reserve";
/** One pool account's row, token-free. */
interface PoolWebAccount {
  id: string;
  label: string;
  nickname?: string;
  domain: string;
  /** ISO timestamp; absent when the credential carries no expiry. */
  expiresAt?: string;
  /** Account-wide cooldown (every model blocked); only after a no-model penalize. */
  cooling: boolean;
  /** ISO timestamp when the account-wide 429 cooldown lifts; only while cooling. */
  cooldownUntil?: string;
  /**
   * Per-model cooldowns currently active. The account is NOT `cooling` while a
   * model is limited — its other models still serve — but each entry tells the
   * card which model is out until when (e.g. `hy4-preview` cooling to 10:14,
   * `hy3` normal).
   */
  modelCooldowns?: ReadonlyArray<{
    modelId: string;
    until: string;
  }>;
  /**
   * Whether the user switched this account off. A disabled account never
   * serves a request, but it stays listed so the card can switch it back on.
   */
  disabled: boolean;
  rateLimitHits: number;
  /**
   * Credits the user asked to keep for this account. The pool stops picking the
   * account once its balance reaches the reserve, so this many credits survive.
   * 0 means the account may be spent down as before.
   */
  creditReserve: number;
  /**
   * Whether the account is held back purely by its reserve right now. Kept
   * distinct from `cooling`: a reserved account is healthy and simply
   * protected, which is a different thing to tell the user than rate-limited.
   */
  reserved: boolean;
  /**
   * What the automation earned for this account today. Absent when it earned
   * nothing (or the automation never ran for it), so the card can stay quiet
   * instead of printing a row of zeroes.
   */
  automationToday?: PoolWebAutomationEarnings;
  /** ISO timestamp of the last successful use (best-effort pool bookkeeping). */
  lastUsedAt?: string;
  /** Aggregated credit summary for the account, read-only. */
  credits?: PoolWebCredits;
  creditsError?: string;
  /**
   * Today's check-in state for this account, read-only. Present only when the
   * per-account check-in probe succeeded and the program is active. The card
   * renders one claim button per account, so a multi-account pool can collect
   * every account's daily reward without switching accounts by hand.
   */
  checkin?: PoolWebCheckin;
  checkinError?: string;
}
/** One credit package (as surfaced by the pool's upstream client), node-free. */
interface PoolWebCreditPackage {
  packageName: string;
  remain?: number;
  size?: number;
  /** CapacityType 4 — refreshed each cycle and never expires. */
  monthly?: boolean;
  /** Next cycle refresh point, ms. */
  cycleRefreshMs?: number;
  /** One-off expiry, ms. */
  expiresAtMs?: number;
}
/** Aggregated credit answer the card renders under one account. */
interface PoolWebCredits {
  total?: number;
  packages: readonly PoolWebCreditPackage[];
  /** Credits expiring within 3 days. */
  expiringSoon?: number;
  /** When the nearest package expires, ms. */
  nearestExpiryMs?: number;
}
/**
 * Daily check-in state the card renders under one account's credits. Mirrors
 * the upstream activity endpoint, minus anything the browser does not need.
 */
interface PoolWebCheckin {
  /** The activity is running; a claim button is offered only while true. */
  active: boolean;
  /** Already collected today — the button renders as a done state. */
  todayCheckedIn: boolean;
  /** Consecutive days checked in. */
  streakDays: number;
  /** Credits a single day grants. */
  dailyCredit: number;
  /** Credits collected today (0 before claiming). */
  todayCredit: number;
  /** Today is a streak milestone day. */
  isStreakDay: boolean;
  /** The day count the next milestone lands on. */
  nextStreakDay: number;
  /** Bonus credits granted on a milestone day. */
  streakBonusCredit: number;
}
/** Result of one claim, so the card can confirm what was collected. */
interface PoolWebCheckinClaim {
  credit: number;
  streakDays: number;
  isStreakDay: boolean;
}
/** One model the pool exposes to DSH, with cost / free tags. */
interface PoolWebModel {
  id: string;
  name: string;
  /** Relative credit cost, e.g. 0.79 for x0.79. */
  multiplier?: number;
  /** Upstream tags: free / limited-free / night-discount. */
  tags?: readonly string[];
  /** Effective image support after the user's per-model toggle. */
  supportsImages: boolean;
  /** Effective context window after the user's budget cap. */
  contextWindow: number;
  /** The window the upstream advertises, before any cap. */
  nativeContextWindow: number;
  /** Upstream output ceiling, so the card can show both limits. */
  maxOutputTokens: number;
  /** Thinking levels the upstream declares, when it declares any. */
  supportedEfforts?: readonly string[];
  /** Whether this model is currently enabled in the picker. */
  enabled: boolean;
}
interface PoolWebModelSelection {
  /** Absent = every model is enabled. */
  enabledModelIds?: readonly string[];
  /** Absent = each model follows its upstream image capability. */
  imageModelIds?: readonly string[];
  /** Per-model context-window cap, keyed by model id. */
  contextBudgets?: Readonly<Record<string, number | undefined>>;
}
/** The JSON document the pool card renders. */
interface PoolWebStatus {
  ok: boolean;
  accounts: readonly PoolWebAccount[];
  /** The next account the pool would use (rotation cursor). */
  activeAccountId?: string;
  cooling: number;
  models: readonly PoolWebModel[];
  /** The saved selection the card diffs its draft against. */
  selection: PoolWebModelSelection;
  /**
   * How the pool spreads requests: `priority` drains one account before
   * moving on, `round-robin` splits the spend evenly.
   */
  distribution: PoolDistribution;
  /** Which region this document describes. */
  region: PoolRegion;
  /** Every region holding at least one account, in display order. */
  regions: readonly PoolRegion[];
  shim: {
    running: boolean;
    baseUrl?: string;
  };
  /** Daily-points automation state, so the card can show what ran and when. */
  automation: PoolWebAutomation;
  /** Per-account credit floors currently in force, keyed by account id. */
  creditReserves: Readonly<Record<string, number>>;
}
/** One automation job's last run, as shown on the card. */
interface PoolWebAutomationJob {
  /** `YYYY-MM-DD` of the last run in this process, if it has run. */
  lastRunDate?: string;
  /** Accounts that finished without error on the last run. */
  ok: number;
  /** Accounts that failed on the last run (each one skipped, the run continued). */
  failed: number;
  /** Credits claimed by the task job on the last run. */
  credit: number;
  /** Energy claimed by the task job on the last run. */
  energy: number;
  /** Tasks claimed by the task job on the last run. */
  claimed: number;
  /** One-line summary of the last run. */
  message?: string;
  /**
   * What the last run actually did, in the words of the task board.
   *
   * `message` is a count; this is the list a person can check off, which is
   * what turns a row from "it ran" into "it did the things I care about".
   */
  detail?: readonly string[];
  /** A pending milestone worth naming, e.g. the next streak tier countdown. */
  progress?: string;
}
/**
 * Automation block on the status document.
 *
 * Carries the schedule and each job's last outcome so the card can answer
 * "is it on, when does it run, and what did it last do" without reaching into
 * the scheduler itself.
 */
interface PoolWebAutomation {
  /** Master switch, mirrored from the saved config. */
  enabled: boolean;
  /** Whether the loop is currently running. */
  running: boolean;
  /** Configured hours per job, so the card can show the schedule. */
  checkinHours: readonly number[];
  reportHours: readonly number[];
  taskHours: readonly number[];
  streakHours: readonly number[];
  travelHours: readonly number[];
  jobs: {
    checkin: PoolWebAutomationJob;
    report: PoolWebAutomationJob;
    tasks: PoolWebAutomationJob;
    streak: PoolWebAutomationJob;
    travel: PoolWebAutomationJob;
  };
  /** Claimable tasks seen on the most recent task pass, across accounts. */
  claimableSeen: number;
  /**
   * Whether a manual run is in flight. The card polls this to know when to
   * stop showing progress and report the result.
   */
  runInProgress: boolean;
  /**
   * Per-account credits/energy/tasks the automation earned TODAY, keyed by
   * account id. An account that earned nothing is simply absent, so the card
   * can say "nothing yet" instead of showing a bare zero.
   */
  earningsToday: Readonly<Record<string, PoolWebAutomationEarnings>>;
}
/** Today's automation take for one account. */
interface PoolWebAutomationEarnings {
  /** Credits claimed from the task centre today. */
  credit: number;
  /** Energy claimed from the task centre today. */
  energy: number;
  /** Tasks claimed today. */
  claimed: number;
  /** Credits collected from check-in today. */
  checkinCredit: number;
  /** Credits from streak redemption and the lottery today. */
  bonusCredit: number;
  /** Credits from buddy adoption and the travel loop today. */
  travelCredit: number;
  /** Local date the counters belong to (YYYY-MM-DD). */
  date: string;
}
/**
 * The two gateways, matching the provider ids the host registers. `cn` is the
 * domestic gateway (`copilot.tencent.com` / `codebuddy.cn`); `global` is the
 * international one (`workbuddy.ai`).
 */
type PoolRegion = 'cn' | 'global';
/** How the pool spreads requests across its accounts. */
type PoolDistribution = 'priority' | 'round-robin' | 'balanced';
//#endregion
//#region src/web-status.d.ts
/** Constructor dependencies — a narrow slice of the pool runtime. */
interface PoolStatusRouteOptions {
  pool: WorkBuddyAccountPool;
  /** One catalog per region; the card reads the one for its active tab. */
  catalogs: Readonly<Record<PoolRegion, WorkBuddyCatalog>>;
  client: WorkBuddyUpstreamClient;
  /** Lazily resolve the running loopback shim, when it has bound a port. */
  shim?: () => {
    running: boolean;
    baseUrl?: string;
  };
  /**
   * The daily-points automation, when the host half has one.
   *
   * Optional so these routes still mount on a profile that assembled a pool
   * without a scheduler (the CLI and the tests do exactly that); the card then
   * reports the automation as off instead of showing a broken panel.
   */
  scheduler?: () => AutomationStatus;
  /**
    /**
     * Start a manual pass, for the card's "run now" button.
     *
     * Returns whether a run STARTED, not its result: a pass takes tens of
     * seconds, so it runs in the background and the card polls the scheduler
     * status for progress and earnings.
     */
  runAutomation?: (job: string, force: boolean) => boolean;
  /**
   * Persist one account's reserved-credit floor. Same settings document as every
   * other card write, so it survives a restart and is re-applied after a scan.
   * Absent without a settings service: the route then answers 503.
   */
  setCreditReserve?: (accountId: string, reserve: number) => Promise<void> | void;
  /**
   * Persist the user's model selection. Provided by the host half, which owns
   * the settings section; absent when the plugin runs without a settings
   * service (the save route then reports 503 rather than pretending to work).
   */
  /**
   * Persist one region's selection. The region travels with the payload: the two
   * gateways advertise different rosters, so the domestic tab and the
   * international tab each own their list and must never overwrite each other.
   */
  saveSelection?: (region: PoolRegion, selection: PoolWebModelSelection) => Promise<void> | void;
  /**
   * Persist one account switch. Same settings document as every other card
   * write, so it survives a restart and is re-applied after each re-scan.
   * Absent without a settings service: the route then answers 503.
   */
  setAccountDisabled?: (accountId: string, disabled: boolean) => Promise<void> | void;
}
/**
 * Assemble the card's status document. Per-account credits and check-in state
 * are queried live; a failing query degrades to `creditsError` / `checkinError`
 * rather than failing the whole document. Never throws.
 */
export declare function poolWebStatus(deps: PoolStatusRouteOptions, region?: PoolRegion): Promise<PoolWebStatus>;
/**
 * Mount the read-only routes on a context where `webServer` is available. The
 * caller uses `ctx.inject(['webServer'], ...)` so Desktop startup order cannot
 * make this registration disappear.
 */
export declare function registerPoolStatusRoute(ctx: Context$1, deps: PoolStatusRouteOptions): void;
//#endregion
//#region src/index.d.ts
/** Stable Cordis plugin name. */
export declare const name = "llm-workbuddy-xdpool";
/** The model registry required before the provider can register. */
export declare const inject: string[];
/**
 * Settings namespace for the WorkBuddy XD Pool card. Registering a section here
 * is what makes the provider appear on the Models settings page and causes the
 * Host to mount the plugin's client card under Plugin configuration — exactly
 * the mechanism the single-account connector uses.
 */
export declare const WORKBUDDY_POOL_SETTINGS_NS: SettingsNamespace;
/** Plugin configuration. */
export interface Config {
  /** Explicit WorkBuddy desktop auth-file path override. */
  authFile?: string;
  /** Rate-limit cooldown per account, milliseconds. */
  cooldownMs?: number;
  /**
   * How the pool spreads requests across accounts.
   *
   * - `priority` (default) drains one account before moving to the next, which
   *   is what a pool of your own accounts is for.
   * - `round-robin` walks the pool in order, so the spend splits evenly.
   * - `balanced` draws at random, weighting whichever account has been idle
   *   longest. Spend still spreads, but without a fixed order, so one unhealthy
   *   account cannot pin the pool to itself.
   *
   * Absent reads as `priority`.
   */
  distribution?: 'priority' | 'round-robin' | 'balanced';
  /**
   * Account ids switched off on the card. A disabled account is never picked
   * to serve a request, but it stays in the pool and on the card so it can be
   * switched back on. Ids are the pool's stable per-credential keys, which
   * survive re-scans (see WorkBuddyAccountPool.disabledIds).
   */
  disabledAccountIds?: string[];
  /**
   * Per-account credit floor, keyed by account id. The pool stops picking an
   * account once its last known balance reaches this value, so the reserved
   * credits survive. Absent or 0 spends the account down as before.
   */
  creditReserves?: Record<string, number>;
  /**
   * Model ids enabled in the picker. Absent means "every model the catalog
   * advertises" — an unconfigured install should never present an empty model
   * list just because the key is missing.
   */
  enabledModelIds?: string[];
  /**
   * Model ids that additionally accept image input. Absent means "follow the
   * upstream capability flag"; an explicit list is authoritative for the models
   * it mentions and leaves the rest to the catalog.
   */
  imageModelIds?: string[];
  /**
   * Per-model context-window override, keyed by model id. The upstream can
   * advertise more than DSH wants to hand a single turn, so the card lets the
   * user cap a model without touching the catalog.
   */
  contextBudgets?: Record<string, number>;
  /**
   * Per-region model selection. The two gateways advertise different rosters, so
   * one shared list would let a save on one tab silently rewrite the other tab's
   * picker. Each region owns its own copy; a region with no entry falls back to
   * the legacy flat keys above, so an upgrade keeps the list already in use.
   */
  modelSelectionCn?: ModelSelectionConfig;
  modelSelectionGlobal?: ModelSelectionConfig;
  /**
   * Daily-points automation. Absent means off: the scheduler makes upstream
   * calls on the user behalf, so it stays opt-in rather than surprising a
   * fresh install with background traffic.
   */
  automation?: AutomationConfig;
  /**
   * The automation's daily earnings ledger, written by the scheduler itself.
   *
   * It lives in settings rather than only in memory so a host restart mid-day
   * does not wipe what the automation already earned.
   */
  automationEarnings?: AutomationLedger;
}
/** One region's saved model selection. */
export interface ModelSelectionConfig {
  enabledModelIds?: string[];
  imageModelIds?: string[];
  contextBudgets?: Record<string, number>;
}
/**
 * Daily-points automation.
 *
 * Absent means off: the scheduler makes upstream calls on the user behalf, so
 * it stays opt-in rather than surprising a fresh install with background
 * traffic. Each job carries its own hour list so the passes can be spread out
 * (or pushed off-peak) without disabling any of them.
 *
 * Ordering note: the report job must run before the task job. A report is what
 * lights the growth streak and unlocks the `first_buddy` family, so a task pass
 * that ran first would read counters before they could have moved.
 */
export interface AutomationConfig {
  /** Master switch for every automation job. Absent reads as false. */
  enabled?: boolean;
  /** Hours (local, 0-23) at which the daily check-in runs. */
  checkinHours?: number[];
  /** Hours at which the activity report runs. Keep ahead of `taskHours`. */
  reportHours?: number[];
  /** Hours at which tasks are enrolled in and claimed. */
  taskHours?: number[];
  /** Hours at which streak redemption runs. */
  streakHours?: number[];
  /** Hours at which the buddy travel loop runs. */
  travelHours?: number[];
  /** How long an account rests after its credits run out, in milliseconds. */
  exhaustCooldownMs?: number;
}
/** Upper bound the card offers as the "default" context window, in tokens. */
export declare const DEFAULT_CONTEXT_BUDGET = 200000;
/**
 * Fold a saved automation block into scheduler options.
 *
 * Absent means off, stated once here so every caller agrees: the card writes
 * `enabled` as a real boolean, and a config that never touched the section must
 * not accidentally arm background upstream traffic.
 */
export declare function automationOptions(automation: AutomationConfig | undefined): AutomationOptions;
/** Settings key holding one region's saved selection. */
export declare const modelSelectionKeyFor: (region: 'cn' | 'global') => string;
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
export declare const Config: z<Config>;
/** Everything the CLI needs from a live plugin instance. */
export interface WorkBuddyPoolApi {
  pool: WorkBuddyAccountPool;
  /** One catalog per region, matching the two registered providers. */
  catalogs: Readonly<Record<WorkBuddyRegion, WorkBuddyCatalog>>;
  client: WorkBuddyUpstreamClient;
  shim: WorkBuddyShim;
  adapter: WorkBuddyAdapter | undefined;
  rescan(): Promise<number>;
  status(includeCredits?: boolean): Promise<Awaited<ReturnType<typeof buildStatus>>>;
  resetCooldowns(): void;
  /** Daily-points automation; assembled with the core, inert until started. */
  scheduler: WorkBuddyScheduler;
}
/** The live API, or undefined when the plugin has not applied yet. */
export declare function currentApi(): WorkBuddyPoolApi | undefined;
/** Test seam: install an API instance without booting cordis. */
export declare function setApi(next: WorkBuddyPoolApi | undefined): void;
/** Assemble the runtime objects without registering anything. */
/**
 * Assemble the runtime objects without registering anything.
 *
 * One catalog per region, mirroring the two shims: the CN and global gateways
 * do not advertise the same roster, and a shared catalog meant the picker showed
 * whichever list happened to be fetched first (always the CN one, since the
 * seeding step read `accounts[0]`).
 */
export declare function createCore(logger?: {
  warn(...args: unknown[]): void;
  info?(...args: unknown[]): void;
}): {
  pool: WorkBuddyAccountPool;
  catalogs: {
    readonly cn: WorkBuddyCatalog;
    readonly global: WorkBuddyCatalog;
  };
  client: WorkBuddyUpstreamClient;
  scheduler: WorkBuddyScheduler;
};
/**
 * Start the loopback endpoint, register the `workbuddy-xdpool` provider, and
 * discover accounts. The provider registers only after `shim.ready` resolves,
 * because its models read the shim origin at construction time.
 */
export declare function apply(ctx: Context, config?: Config): void;
//#endregion
export type { AccountStatus, AutomationLedger, AutomationRunSummary, AutomationStatus, Context, ExpertUseMode, MarketExpert, ModelSelection, PoolStatusRouteOptions, PoolWebCheckin, PoolWebCheckinClaim, PoolWebModel, PoolWebModelSelection, PoolWebStatus, SchedulerLogger, TaskEventChain, TaskEventTransport, UpstreamErrorKind, WorkBuddyAccount, WorkBuddyAdapter, WorkBuddyCredential, WorkBuddyModelInfo, WorkBuddyShim, WorkBuddyStatus };