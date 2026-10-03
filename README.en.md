# RotaKit · WorkBuddy credit pool for DeepSeek Harness

Merges every **WorkBuddy / CodeBuddy account** you have signed in locally into one failing-over model pool for DeepSeek Harness, with a full set of credit automations.

As many accounts as you have signed in on the desktop app, that many are in the pool - no manual entry, no switching between them. When one is rate-limited, out of credits, or its token is rejected, the request moves to the next usable account on its own.

> **Provenance.** RotaKit is an independently maintained adaptation of [`XDTrees/dsh-workbuddy-xdpool`](https://github.com/XDTrees/dsh-workbuddy-xdpool) (MIT, by **XDTrees**). Credential decryption is ported from [`dingminhua/dsh-connect-workbuddy`](https://github.com/dingminhua/dsh-connect-workbuddy); the shim's hardening and error mapping follow [`corrinehu/dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect). Both are MIT. The upstream documentation is kept in [`UPSTREAM-README.md`](UPSTREAM-README.md).

---

## What it does

### 1. Multi-account pool

| Capability | What it means |
|---|---|
| **Automatic discovery** | Reads the desktop app's own sign-in snapshots (both the domestic and international sets); one file per account, nothing to import by hand |
| **Weighted selection** | The longer an account has been idle, the higher its weight; the top 5 by weight are shuffled, so a low-weight account cannot be drawn repeatedly |
| **Conversation stickiness** | A conversation keeps one account so its prompt cache stays warm; if that account becomes unusable the conversation is rebound and pinned to the new one |
| **In-flight leases** | Past 2 concurrent requests an account steps aside, rather than stacking rate-limit risk on one account |
| **Split cooldowns** | 429 (rate limit) and 5xx (gateway fault) are counted separately, so a gateway wobble cannot pollute rate-limit history |
| **Per-model cooldowns** | A limit on one model keeps only that model out; the same account still serves the others |
| **Credential breaker** | An account rejected 3 times in a row leaves the pool for 30 minutes and is labelled "sign in again" instead of vanishing silently |
| **Usable-credit floor** | An account under the floor (50 by default) is skipped - and **rejoins automatically once its balance recovers**, with no action from you |
| **Credit reserve** | A per-account floor of your own, below which no work is sent |
| **Manual disable** | Switch an account off deliberately, managed separately from the automatic skip |
| **Attempt budget** | Up to 8 **distinct** accounts per request; the same account is never offered twice within one request |

### 2. Model catalog

- Fetched live from the upstream, with **credit multiplier, free / off-peak tags, image support, thinking levels and context window**
- Models that **no account can serve** are marked, so the gap is visible rather than silent
- Models whose **cost is unknown** say so, instead of leaving the field blank
- The catalog refresh **retries**, so one network blip no longer replaces a good list with a fallback
- **Observed output limit**, which exposes a gateway silently clamping `max_tokens`

### 3. Credit automation

Each job has its own schedule. Defaults:

| Job | Default | What it collects |
|---|---|---|
| Daily check-in | 09:00 | The day's check-in credit |
| Activity report | 10:00 | Keeps the account marked active |
| Task rewards | 11:00 | Enrols in and claims task rewards |
| Streak bonus | 12:00 | Streak redemption and the draw |
| Buddy trip | 09:00 / 21:00 | Departure and collection |

**Details that matter:**

- **Missed slots run late**: a slot whose hour passed while the app was closed runs on the next start rather than waiting for tomorrow
- **Check-in results are separated**: `21/21 checked in - 16 newly collected`. "Checked in" and "collected a reward this run" are different facts, and merging them makes a healthy run look like it had failures
- **Per-account check-in time**, distinguishing **when this run was paid** from **when it was told the day was already served** - the upstream reports no check-in time, so only the moments the plugin can attest to are shown
- **The earnings ledger is persisted** and resets across a day boundary, surviving restarts

### 4. Request observability

| Capability | What it shows |
|---|---|
| **Request log** | Time, model, account, outcome, total time, queue, first token, token counts, rotations |
| **Queue statistics** | p50 / p95 / mean wait per model - choose a model from data rather than from feel |
| **Output speed** | Per-request tok/s with p50 / min / max, aggregated per model |
| **Consumption ledger** | Today / last 7 days / this month, accumulated by the plugin (the upstream has no time-windowed endpoint) |
| **Request-shape diagnostics** | On an upstream 400, records the request's shape: top-level keys, message counts by role, tool count, content characters |

### 5. Interface

- **Two region tabs**: domestic and international are fully independent - accounts, credits, catalogs and unsaved edits are all separate, and both are active at once
- **Collapsible lists**: accounts, models and request records all start collapsed, so the card stays small
- **Responsive**: stacks below 640px
- **Three-state theme**: follow system / light / dark, written where the host declares its tokens, so it takes effect immediately
- **Status labels**: cooling, sign in again, out of credits, reserved - each with its own cause and its own remedy
- **One reset control**: appears whenever there is anything to clear (cooldowns, the breaker, per-model caches) and actually clears it

### 6. Request path

- **Fixed ports**: 8120 domestic / 8121 international, so a reload cannot move the port and strand the host on "Connection error"
- **Loopback only**, with a forced loopback `Host` / `Origin`, constant-time token comparison and a 64MB body cap
- **Context-overflow recovery** that compacts and retries, aiming at the smaller of "by window" and "half the original"
- **Honest error attribution**: an empty pool reports the real cause (429 limited / 402 out of credits / 403 all switched off / 401 needs a sign-in) instead of answering 401 for all of them

---

## Choosing a model from data

Measured from real request records, not estimated:

| Model | Samples | Queue p50 | Queue p95 | Output p50 | Multiplier |
|---|---|---|---|---|---|
| `deepseek-v4.1-flash` | 57 | **4.2s** | 6.0s | **263 tok/s** | 0.11 |
| `glm-5.3-flash` | 2 | 6.7s | 23.2s | 40 tok/s | 0.06 |

**Small-sample caveat**: `glm-5.3-flash` has only 2 samples, and its queue figures disagree wildly (1.6-23s) while its speed figures agree. Cheaper per credit, about 6x slower.

The card's per-model queue table keeps accumulating samples; the conclusion firms up as they arrive.

---

## Layout

```
.
├── lib/
│   ├── index.js        Host side: account pool, shim, catalog, scheduler (build output)
│   ├── client.js       Settings card (build output)
│   ├── bin.js          CLI (build output)
│   └── index.d.ts      Types (build output)
├── cordis.patch.yml    Bundle registration patch
├── package.json        Manifest (dsh.bundle and dsh.client live here)
├── screenshots.json    Card screenshot list
├── assets/             Screenshots
├── README.md           Chinese
├── README.en.md        This file
├── UPSTREAM-README.md  Upstream documentation
└── CHANGELOG.md        Upstream changelog
```

**All four `lib/` outputs ship in the repository**, so installing needs no build step.

---

## Install

```bash
# 1. Into a DSH profile (the repository root IS the plugin)
git clone https://github.com/2861292267/DSH-Official-WorkBuddy-Credit-Proxy.git \
  ~/.dsh/profiles/desktop/node_modules/dsh-rotakit

# 2. Optional: the QR fallback, pure JS with no native build.
#    The sign-in link already opens on its own; the QR path only runs when the
#    upstream returns no authUrl, and only then is this needed.
cd ~/.dsh/profiles/desktop/node_modules/dsh-rotakit && npm i qrcode

# 3. Confirm the profile lists it:
#    ~/.dsh/profiles/<your profile>/package.json -> dsh.profile.bundles contains "dsh-rotakit"
```

**Then restart DeepSeek Harness.** A **WorkBuddy XD Pool** group appears in the model picker.

> **The host plugin does not hot-reload.** Changing anything under `lib/` requires fully quitting and starting the app; a running instance keeps serving the code it loaded.

---

## How it is verified

Every claim above has a reproducible check behind it. The main groups:

| Area | What is checked |
|---|---|
| **Selection** | Credit floor, cooldown tiers, per-model cooldowns, the breaker, leases, stickiness, no repeat within a request |
| **Error attribution** | Each failure class maps to the right status and reason |
| **Check-in semantics** | "Checked in" and "collected this run" stay separate; an already-served marker adds no credit |
| **Counts** | `available` agrees with what selection will actually pick |
| **Interface** | Locale parity, complete CSS, runtime probe, rendered output |

**31 suites, all passing.**

---

## Security

- The plugin only **reads** sign-in state the desktop app already has, and **starts no sign-in flow**. The in-card QR option is **opt-in**, runs only on an explicit click, uses the desktop client's own endpoints, **bypasses no authentication**, and spends your own account and credits.
- Tokens pass only between **this machine's memory and the loopback shim**, and every account shown on the card is masked.
- The shim binds `127.0.0.1` only and enforces loopback `Host` / `Origin`.

---

## Disclaimer

For personal study and research use, driving only the user's own accounts on their own machine. Respect WorkBuddy's terms of service; any consequence of using this project is the user's own.

---

## License

MIT. Upstream copyright belongs to **XDTrees**; some code comes from **dingminhua** and **corrinehu** (both MIT). See [`LICENSE`](LICENSE) and the attribution comments in the source.
