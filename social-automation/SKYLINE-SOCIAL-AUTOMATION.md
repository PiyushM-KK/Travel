# Skyline Social Media Automation — End-to-End Reference

> **This is the single "how it all works" reference.** Read this first to pick up the whole system.
> It is **SECRET-FREE** on purpose (the Skyline repo is public) — it names credentials and where they
> live, never their values.
>
> **⚠️ SYNCED FILE — keep both copies identical.** The same file lives in two places:
> - Skyline repo: `social-automation/SKYLINE-SOCIAL-AUTOMATION.md` (canonical — code lives here)
> - FullFirm repo: `SKYLINE-SOCIAL-AUTOMATION.md` (mirror, for the firm/next-agent)
>
> When you change one, change the other in the same session. (The repos are intentionally NOT merged —
> see the repo-split rule in §7.)
>
> **For deeper detail, see the pointers in §13** (README = file map, OPERATIONS = runbook, HANDOVER =
> latest state/log, BLOCKED = owner tasks, AGENTS = the review agents).

---

## 1. What it is (one paragraph)

Skyline's own automation for posting to **Instagram + Facebook**, grounded in Skyline's real travel
packages and **fact-checked** before anything is suggested. A post enters through one of four intake
channels, Claude drafts a caption and a **branded card** is rendered, three review agents check it
(Fact-Check → Social Media Manager → QA), it's sent to the owner on **WhatsApp** to approve, and on
approval it publishes to IG + FB. Nothing reaches a real account unless a three-part **live gate** is
satisfied. The engine is a **vendored copy** of the firm's reusable social engine; Skyline's own data
lives only in `facts.js` / `calendar.js` / `profile.js`.

---

## 2. The end-to-end flow

```
                 ┌─────────────── INTAKE (4 channels, §3) ───────────────┐
 WhatsApp photo/note   Gmail vendor email   Calendar card   Package-post (2×/day)
                 └───────────────────────┬───────────────────────────────┘
                                         ▼   creates a `planned` row in the Airtable Queue
                          [reap stranded drafts]  (generate-runner.reapStaleDrafting)
                                         ▼
   GENERATE (generate-runner.js → engine/generate.js)
     • optional Claude VISION describes the image (bytes, not a public URL)
     • Claude writes the caption in the row's language, GROUNDED in facts.js
     • FACT-CHECK (engine/validate-post.js): invented item/price/promo, and travel
       visa/guarantee/price-lock/referral-booking claims → REJECTED
     • agents review (§8): Social Media Manager, then QA safety-net
     • result: pending_approval  |  approved (auto)  |  held (with a reason)
                                         ▼
   APPROVE — the owner gets the card(s) + caption on WhatsApp and replies:
     "approve" / "B 9880" / "A 9880" / "both 9880" / "reject 9880" / "hold 9880"
     (parser accepts any separator: B 9880 / B9880 / B-9880 / B: 9880 — see §9)
                                         ▼
   PUBLISH (behind the LIVE GATE, §10) — engine/publish.js
     • host the chosen image on Vercel Blob → public https URL
     • Instagram: create media container → poll status → publish
     • Facebook: post photo to the Page
     • record the post ids on the row → status `published`
     • delete the public blob (publish-time-only hosting — nothing lingers)
```

Two publish triggers: **publish-on-approval** (the webhook posts immediately after you approve) and
the **scheduled publish cron** (a backstop). Both are idempotent + claim-guarded, so a post can't
double-publish.

---

## 3. The four intake channels

| # | Channel | Trigger | What it makes | Endpoint / job |
|---|---------|---------|---------------|----------------|
| 1 | **WhatsApp** | Owner sends a photo/note | Drafts a post from it, sends it back to approve | `api/whatsapp-webhook.js` (draft-on-intake) |
| 2 | **Gmail vendor email** | New allow-listed vendor offer | Matches a Skyline package → **reseller** branded card (never the vendor's poster) | job `email` / `cron-prep` |
| 3 | **Calendar card** | Daily (evening) | One catalogue package/day → A/B card → approve | job `calendar-cards` in `cron-prep` |
| 4 | **Package-post** | **Twice daily** (morning + afternoon) | One package/slot → card → **auto-publish unless an agent flags it** (then held for approval) | job `package-post` / `cron-package-post` |

Every card is a **two-candidate A/B card**: **A = a real destination photo** (from `assets/destinations`),
**B = a fresh gpt-image-1 AI scene** (or a code-drawn decorative gradient if no image key). The owner
picks A / B / both on WhatsApp; the package-post auto path defaults to A when it posts unattended.

---

## 4. Data sources

| Source | What it provides | How it's accessed |
|--------|------------------|-------------------|
| **Airtable base** | The **Queue** table = every post + its status (the pipeline's state); the **Runs** table = job heartbeats | REST, `AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID` (`automation/airtable-store.js`) |
| **`facts.js`** (in-repo) | Skyline's **catalogue** — 22 packages / 89 destinations, prices, WhatsApp, the referral-only list, the price disclaimer. **This is the grounding source** — captions can only use what's here | required at runtime; no creds |
| **WhatsApp Cloud API** (Meta Graph) | Intake (owner photos/notes) **and** the approval channel | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TO` |
| **Gmail** (Workspace inbox) | Vendor offer emails (channel 2) | `GMAIL_USER` + `GMAIL_APP_PASSWORD`, or OAuth service-account; `GMAIL_ALLOWED_SENDERS` gates senders |
| **OpenAI `gpt-image-1`** | The AI **scene** for card B | `OPENAI_API_KEY` (`automation/image-gen.js`) |
| **Meta Graph API** (IG + FB) | **Publishing** to Instagram + the Facebook Page, token health, metrics | `META_PAGE_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_APP_SECRET`, `META_APP_ID` |
| **Vercel Blob** | Public **image hosting** (Instagram needs a public https URL); publish-time-only, deleted after Meta ingests | `BLOB_READ_WRITE_TOKEN` (`automation/image-host.js`) |
| **Wikimedia Commons** | The seed real photos in `assets/destinations` (card A), CC-attributed | one-time asset seeding; no runtime creds |
| **Claid** (optional) | AI image *enhancement* of a real photo (text-safety-gated) | `AI_ENHANCER_KEY`, `AI_ENHANCER_URL` |

---

## 5. Access & credentials needed (names only — never values)

All secrets live in two places: the local `social-automation/.env` (gitignored; encrypted mirror
`.env.enc`) and the **Vercel `skyline-social` project env** (Production). Set them with `vercel env`
(stdin) or the dashboard; mirror the encrypted file with `automation/push-env-to-vercel.js`.

| Env var | Purpose | Owner-gated? |
|---------|---------|--------------|
| `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` | The Queue/Runs store | ✅ |
| `ANTHROPIC_API_KEY` | Claude — captions, vision, SMM + QA agents | ✅ |
| `OPENAI_API_KEY` | gpt-image-1 (card B AI scene). **NB: the code reads `OPENAI_API_KEY` — not `OPEN_API_KEY`** | ✅ |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob image hosting | ✅ (create a Blob store) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TO` | WhatsApp intake + approval (WhatsApp is a **separate Meta app**) | ✅ |
| `META_PAGE_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_APP_SECRET`, `META_APP_ID` | Publish to IG + FB | ✅ (never-expiring Page token — see OPERATIONS "Token health") |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` (or OAuth), `GMAIL_ALLOWED_SENDERS` | Gmail vendor intake | ✅ |
| `AI_ENHANCER_KEY`, `AI_ENHANCER_URL` | Claid enhance (optional) | ✅ |
| `CRON_SECRET` | Auth for every cron/health endpoint (Bearer) | ✅ |
| `SOCIAL_LIVE` | The publish **live gate** (must be `true` to post for real) | ✅ |
| `SOCIAL_CLIENT` | Which client (`skyline`) | — |
| `SOCIAL_CALENDAR_COUNT` | Image-less calendar-brief count; **`0` disables** them | — |
| `GENERATE_STALE_MS` | Stale-draft reaper window (default 15 min, floor 90 s) | — |
| `SOCIAL_PACKAGE_SLOT` | Force a package-post slot (else inferred from run time / `?slot=`) | — |

**Accounts / access you need:** Airtable (base + PAT) · Anthropic · OpenAI (image) · a Meta app with
the **Facebook Page** + **Instagram business** account · a **WhatsApp Business** (Cloud API, separate
Meta app) · a Gmail/Workspace inbox · **Vercel** (the `skyline-social` project + a Blob store) ·
**GitHub** (the `PiyushM-KK/Travel` repo + an Actions `CRON_SECRET` secret) · Claid (optional).

---

## 6. Infrastructure

- **Vercel project `skyline-social`** — https://skyline-social-nine.vercel.app
  - Deploys from GitHub **`PiyushM-KK/Travel`** `main`, **Root Directory = `social-automation`**.
  - **Crons** (`vercel.json`): `cron-package-post?slot=0` 03:30 UTC (09:00 IST) · `cron-package-post?slot=1`
    08:30 UTC (14:00 IST) · `cron-prep` 13:30 UTC (19:00 IST) · `cron-publish` 15:30 UTC.
  - **Endpoints** (`api/`): `whatsapp-webhook` · `cron-prep` (intake+generate+approve, also email +
    calendar-cards) · `cron-publish` (gated publish) · `cron-package-post` · `cron-email` ·
    `render-selftest` (render + Blob-host health probe). All except the webhook are `CRON_SECRET`-guarded.
- **GitHub Actions** (Travel repo) — `.github/workflows/package-post.yml`: a **free fallback** that hits
  `cron-package-post?slot=0|1` at the two times (redundant with the Vercel crons; safe because the
  endpoint is idempotent per package/day/slot). Needs a repo secret **`CRON_SECRET`**.
- **⚠️ Coupling to the firm's infra (migration pending):** publishing currently also leans on the firm
  `site` Vercel project (`site/api/oauth-callback.js`, `publish-test.js`, the `site` project's `META_*`)
  and the FullFirm GitHub Action `social-publish.yml` (a backstop publisher). Don't delete those until
  Skyline is fully migrated onto its own infra.

---

## 7. Where the code lives + the repo-split rule

- **Skyline (this project):** `…/Skyline Travel Planner Launch/social-automation/` — the running system.
- **FullFirm (the firm):** `…/FullFirm/SociaMedia_Auto/` — the **reusable engine** (the upstream). Also
  the FullFirm GHA `social-publish.yml`.
- **RULE:** the client's automation lives in the CLIENT's repo; the firm keeps only the reusable engine +
  the restaurant demo. `engine/` here is a **vendored copy** — when the engine improves upstream, re-copy
  it (see `RE-VENDOR-FROM-FULLFIRM.md`). Skyline-only logic stays in `facts.js` / `calendar.js` / `profile.js`.
  This reference file is the ONE deliberate exception that is mirrored into FullFirm (as a pointer for the firm).

---

## 8. Key files map

| File | Role |
|------|------|
| `automation/run.js` | **The single job dispatcher** (`intake·generate·approve·publish·report·pr·prep·email·calendar-cards·package-post`) + the publish live gate |
| `automation/airtable-store.js` / `store.js` | The Queue store (Airtable / in-memory). `claim()` co-writes status+claimedAt atomically |
| `automation/generate-runner.js` | Draft + fact-check a `planned` row; the **stale-draft reaper** (`reapStaleDrafting`) |
| `automation/calendar-cards.js` | `buildAndDraftCard()` (shared A/B card build), `packageForDay` / `packageForSlot` |
| `automation/package-posts.js` | Twice-daily **auto-publish-unless-flagged** flow + `riskFlags` |
| `automation/approve-runner.js` | Apply an A/B/approve/reject/hold decision to a row |
| `automation/whatsapp.js` | `parseDecision` (approval parsing), send text/image, inbound routing + intake guard |
| `automation/image-gen.js` / `image-host.js` / `image-source.js` | AI scene (OpenAI) / Blob hosting / re-fetch source bytes |
| `automation/packages.js` | Catalogue → card price (reseller +10% on vendor offers; own price otherwise) |
| `automation/clients.js` | Client registry — **skyline only** here |
| `automation/review.js` | The Bug Hunter + App Security **code review** agents (run over a git diff) |
| `engine/generate.js` | Caption writing + image vision + fact-check gate |
| `engine/publish.js` | IG (container poll) + FB (Page photo) publishing; `redact()` |
| `engine/review-agents.js` | The content agents: **Social Media Manager**, **QA**, creative-vision |
| `engine/validate-post.js` | The grounding guard (no invented items/prices; travel guards) |
| `engine/card.js` | The branded card renderer (satori → resvg; jimp fallback) |
| `facts.js` / `calendar.js` / `profile.js` | Skyline's catalogue / content calendar / brand voice + `vertical:"travel"` guards |
| `api/*.js` | The serverless endpoints (§6) |
| `tests/*.js` | Offline tests (run `npm test`) — parser, reaper, A/B, package-posts, claim-atomicity, guards |

---

## 9. Approval mechanics (WhatsApp)

- Each waiting post has a **4-digit code** (`shortCode`, derived from the row id). The card message shows it.
- Reply formats (all accepted, any separator): **`approve`**, **`B 9880`** / `B9880` / `B-9880` / `B: 9880`,
  **`A 9880`**, **`both 9880`**, **`reject 9880 <reason>`**, **`hold 9880`**, **`edit 9880 <new caption>`**.
  A bare `approve` / `B` applies to the single waiting post.
- **Only the authorized number (`WHATSAPP_TO`) can approve.** An unauthorized sender is ignored.
- A reply that looks like a mistyped approval (a command word + a number) is **not** turned into a new
  post — it asks for the right format and lists the codes waiting. A stale/unknown code lists the
  current codes too. (See `BLOCKED.md` → B-CODE.)
- **Publish-on-approval:** approving posts to IG+FB immediately (the scheduled publish cron is a backstop).
- **Resend tip:** to resend a card, edit the row **in place** (keeps its code) rather than delete+recreate
  (which changes the code and strands the old one).

---

## 10. The safety model (nothing posts by accident)

1. **The live gate** — publishing needs ALL of: `SOCIAL_LIVE=true` **and** the client marked `live` **and**
   real creds. Anything less is a **read-only dry run** that mutates nothing.
2. **Fact-check before draft** — a caption that names an item/price/promo not in `facts.js`, or a travel
   visa/guarantee/price-lock/referral-booking claim, is rejected; the row is held with a reason.
3. **The agent team** — Social Media Manager + QA review every draft before you see it.
4. **Idempotency** — dedup key per intake (`sourceMessageId`), claim-guarded runners, recorded platform
   post-ids → a post can't double-publish.
5. **Self-healing** — the reaper recovers a draft stranded by a crashed/timed-out pass; publish recovers a
   stale `publishing` row. See `OPERATIONS.md`.

---

## 11. How to operate & verify (secret-free health checks)

Use the local `.env` for creds (`node -e` scripts load it), or hit the deployed endpoints with the
`CRON_SECRET` bearer. **Keep everything read-only unless you intend to post.**

- **Pipeline health (render + Blob host):** `GET /api/render-selftest` → **200** = healthy, **503** =
  hosting unconfigured, **500** = a fault.
- **Trigger a run:** `GET /api/cron-prep` (drafts + approvals) · `GET /api/cron-package-post?slot=0|1` ·
  `GET /api/cron-publish` (posts approved rows) — all with `Authorization: Bearer $CRON_SECRET`.
- **Inspect the queue:** `automation/queue-peek.js`, or read the Airtable Queue by status.
- **Token health:** `GET https://graph.facebook.com/v21.0/me?access_token=…` (Page token must return the
  Page, not a person) — the silent killer; see OPERATIONS "Token health".
- **Tests:** `npm test` (all offline, no creds).

---

## 11b. Monitoring — the `/ops` dashboard (2026-08-06)

A **read-only operations dashboard** at **https://buildwise-digital.com/ops.html** (executive-facing):
overall verdict (green/amber/red), business KPIs, a **live pipeline** (Intake → Draft & review → Sent
for approval → Approved → Published-live), **recent-activity** journeys, **per-workflow next-run
countdowns**, a **published-over-time chart** (daily/weekly/monthly), and plain-English issues
(problem → impact → recommended action). Auto-refreshes 60 s; countdowns tick every second.

- **Data source:** each client automation exposes a read-only `GET /api/ops-status` (fail-closed,
  Bearer `OPS_KEY` **or** `CRON_SECRET`, CORS limited to the firm site). For Skyline:
  `https://skyline-social-nine.vercel.app/api/ops-status` (`?tokens=1` also live-checks the Meta token).
- **Auth key:** a dedicated read-only **`OPS_KEY`** is set on `skyline-social` (also stored in the local
  `.env`); the dashboard prompts for it (kept in the browser's sessionStorage only).
- **Files:** `automation/ops-status.js` (the health builder — queue/heartbeats/config/workflows/
  pipeline/recent/trend/next-run), `api/ops-status.js` (the endpoint), firm-repo `site/ops.html` (the
  page), `tests/check_ops_status.js`. **Scales:** add a `{name, statusUrl}` row to the `CLIENTS` list at
  the top of `site/ops.html`; each new client just exposes its own `/api/ops-status`.

---

## 12. Known open items (see `BLOCKED.md` for the live list)

- **cron-prep 504** — ✅ **FIXED IN CODE** (`cf05f6a`), ⏳ **deploy pending**. `generate` now runs under
  an absolute wall-clock deadline: it stops between rows (reserving one row's headroom), always
  heartbeats + returns before the 60 s cap, and defers leftover rows to the next pass (queue drains
  across runs). Also heartbeats before the loop (a mid-row kill never reads dead), always drafts ≥1
  row/pass (forward progress), and drafts OLDEST-first (FIFO, no tail starvation). Unbounded by default
  (GHA/CLI unchanged); the Vercel cron sets `deadline = now + 50 s` (`CRON_PREP_BUDGET_MS` overrides,
  `"0"` opts out). Tests: `check_generate_deadline.js`. **Owner:** deploy to prod (git push auto-deploys
  if the project is git-connected, else `vercel --prod`); optional `SOCIAL_CALENDAR_COUNT=0` to trim the
  briefs and drain faster. See `BLOCKED.md` → B-504.
- **Infra migration** — move publishing off the firm `site` project onto Skyline's own infra.
- **Monitoring dashboard** — ✅ BUILT (see §11b). Scale it by adding clients to the registry.
- **Private client image repo** — `PiyushM-KK/skyline-client-images` (private) for client photo uploads;
  invite the client as a collaborator (needs their GitHub username). Not yet wired as an auto-intake.

---

## 13. Related docs & memory

| Doc | What it adds beyond this file |
|-----|-------------------------------|
| `README.md` (this folder) | The file map + engine **provenance** (vendoring) |
| `HANDOVER.md` (this folder) | The **latest state** + a dated change log |
| `BLOCKED.md` (this folder) | **Owner-only tasks** + the resolved-issues log (B-AIRTABLE, B-OPENAI, B-CODE, B-IMG…) |
| `RE-VENDOR-FROM-FULLFIRM.md` | How to re-copy the engine from the firm upstream |
| FullFirm `SociaMedia_Auto/OPERATIONS.md` | The engine **runbook** (jobs, failure modes, token health, going-live) |
| FullFirm `SociaMedia_Auto/AUTOMATION-PLAN.md` | The original build **plan** |
| FullFirm `SociaMedia_Auto/AGENTS.md` | The **agent team** + the code-review agents (Bug Hunter lens) |
| Memory `fullfirm-social-automation.md` | The full **history** of decisions/fixes across sessions |

**New-agent quick start:** read this file → skim `HANDOVER.md` (latest) → check `BLOCKED.md` (open owner
tasks) → run `npm test`. That's enough to be productive.

---

## 14. Sync note

This file is **mirrored** in the FullFirm repo (`SKYLINE-SOCIAL-AUTOMATION.md`). Any edit here must be
copied there in the same change (and vice-versa). If they ever drift, the **Skyline copy is canonical**
(the code lives here).

_Last updated: 2026-08-06._
