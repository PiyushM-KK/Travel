# Handover — Skyline Travel Planner: Social Media Automation

Scope: **only the `social-automation/` folder.** The rest of the Skyline project
(the travel website) is unchanged and separate. Read `README.md` here first for the
structure + provenance. **NOTE: this session also changed the WEBSITE (language fix) and started the
client CHATBOT (`../pricing-portal/`) — see the checkpoint below; those live OUTSIDE this folder.**

## ⭐ 2026-08-07 (late) — CHECKPOINT: B-PKGCARD fixed · AI Scene Generator · reseller AI scenes · rejection-training · recreate override · website 3-language fix · chatbot kickoff

**Committed to `main` (skyline-social auto-deploys; the website deploys via GitHub Pages).** Commits: `604fefb` `9e04931` `8c588f2` `b56533b` `2e7df5a` `9e31799` `538e3d6` `6a5d7b3` `ad247c7` `ecefa2d` (language follow-ups).

1. **B-PKGCARD RESOLVED** (`604fefb`). Root cause was the CAPTION, not hosting: own-catalogue cards omitted the price ("it's on the image") → the SMM accessibility rule flagged EVERY card "price/CTA missing" → held/rejected. Fix: for our OWN packages the price + WhatsApp # ARE grounded facts, so the caption now states "from ₹X per person" + one WhatsApp CTA (the vendor "don't repeat prices" guard in `briefFromRow` scoped to vendor sources only). Verified live: SMM 8/10 PASS. Also: auto-post posts the FRESH AI scene not the repeating stock photo; owner messages carry **source provenance** (website catalogue · category · IST timestamp). Tests `check_pkgcard_fix.js`.
2. **AI SCENE GENERATOR** (`9e04931`) `automation/scene-generator.js`: the owner's 38 KB master prompt (`assets/scene-master-prompt.txt`, committed) is Claude's SYSTEM prompt → returns ONE unique render-ready image prompt + structured metadata (location/scene/moment/season/camera…); `recentScenesFromStore` = the scene-history "avoid repeats" loop (persisted in `imageSource.sceneMeta`; the Airtable store IS the history). Grounded to the package route + keeps the "AI-generated scene · illustrative" disclosure. Env: `SOCIAL_SCENE_GEN=off`, `SOCIAL_SCENE_MODEL`, `SOCIAL_SCENE_TIMEOUT_MS`. Tests `check_scene_generator.js`, `check_scene_intakes.js`. **Verified live end-to-end** (real gpt-image-1 cards rendered).
3. **Reseller flow → AI scenes** (`8c588f2`,`b56533b`): the shared `resolveScenePrompt` wires the dynamic scene into ALL card intakes. Gmail reseller (`email-intake.js`) = **on by default** (async cron). WhatsApp reseller (`reseller.js`/`whatsapp-webhook.js`) = **opt-in** `SOCIAL_WHATSAPP_RESELLER_IMAGE=on` (the webhook is synchronous — a paid image inline risks a provider-retry double-image). WhatsApp reseller owner message now also carries intake **Source + Received time**.
4. **Rejection reasons + TRAINING loop** (`2e7df5a`) `automation/feedback.js`: `reject <code>` → asks why (1 Over-price · 2 Under-price · 3 Incorrect source · 4 Image not good · 5 Other); `reject <code> <r>` / `reason <code> <r>` capture it (tagged in `reviewNotes` as `REJECT:<key>`, no schema change). **Training:** bad-image → the rejected scene enters the generator's avoid-list; over/under-price + wrong-source → a caution on the next post of that package. Client-scoped + recency-bounded. Tests `check_feedback.js`.
5. **Recreate override** (`9e31799`): `api/cron-package-post?pkg=<slug|name>&hold=1` re-features a specific package **held for approval** (not auto-posted). Used it to **recreate the two wrongly-rejected posts** — **Goa Getaway** + **Kashmir Valley** are now `pending_approval` (with the price-in-caption fix + fresh AI scenes) in the owner's WhatsApp queue (the Goa card was re-sent manually — codes are on WhatsApp).
6. **Website 3-language fix** (`ad247c7`) — the client site now switches **EN / HI / GU** on every sub-page incl. the package GRIDS (was a 2-way EN↔HI toggle + English-only grids). See `../LANG-FIX-SPEC.md` (mechanism + glossary + all package translations = source of truth). 11 `.dc.html` pages fixed (Domestic/International/Hotels/Package/Destination/Flights/Trains/Buses/Cabs/Chatbot/WhatsApp); index.html/Customize/Privacy were already 3-way. Each verified: balanced `data-en/hi/gu`, valid widget JS, no stale 2-way code. **Follow-ups now DONE** (`ecefa2d`, see BLOCKED B-LANG-FOLLOWUP): `AssistantWidget.dc.html` got its own EN/हिं/ગु toggle (+ AI replies in the chosen language); long-form prose on Package (23 pkgs) + Destination (19 dests) is fully translated via `tr()`. **The site is now 100% 3-language.**
7. **Client CHATBOT — Phase 1 BUILT** (`538e3d6`,`6a5d7b3`,`5c0c6b3`,`a674863`) in `../pricing-portal/`: the
   OWNER-ONLY "edit the website by chat" console engine. Decisions locked: **auth = GitHub login** (allow-list
   owner+Piyush); **hotels = both** a city hotel-rate catalog (Hotels.dc.html, ships EMPTY, friendly WhatsApp
   empty-state) AND per-package 4★/5★ tier prices (Domestic/International; International got id/slug so it's now
   editable). Engine (all pure+tested, 40 checks, adversarially reviewed): `apply-prices.js` (3★) +
   `apply-package.js` (tiers + add/remove pkg) + `apply-hotel.js` (add/remove/rate) + `read-catalog.js` (grounding)
   + `parse-ratesheet.js` (Markdown/CSV → rows). **Ingestion:** the vendor reckoner is a scanned image PDF (no
   text layer) → the agent reads it by **Claude vision**; a clean table is the exact fallback; vendor NET rates
   get Skyline's **margin** before going public (mirrors reseller +10%). Vendor sheets are **gitignored** (public
   repo). **Phase 2 = owner-gated** (BLOCKED **B-CHATBOT**): GitHub OAuth App + scoped commit bot + Vercel +
   ANTHROPIC key → then I build `lib/commit.js` + `api/auth` + `agent/chatbot.js` (tool-use loop + PDF vision) +
   the secured `Chatbot.dc.html` UI. **Keep it Skyline-only** — BuildWise's rate card (`FullFirm/private/`) stays separate.

**PENDING / NEXT AGENT:** approve or refine the recreated Goa+Kashmir posts; test the WhatsApp reseller with a PRICED poster; finish the chatbot once the owner does B-CHATBOT setup (then: `lib/commit.js` bot + `api/auth` OAuth + `agent/chatbot.js` Claude tool-use loop + hotel catalog); the standing owner security audit. (Language follow-ups DONE `ecefa2d` — the site is now fully 3-language.)

## ⭐ 2026-08-07 — CHECKPOINT: WhatsApp reseller intake + package-post cron fix + chatbot pivot

**Shipped (committed to `main`, skyline-social auto-deploys):**
- **NEW 5th intake — WhatsApp RESELLER** (`e07654f`, `5713046`): the client forwards a supplier offer
  poster on WhatsApp → the webhook reads the price + destination (`describeOffer`/`extractPrices`, now on
  **Sonnet** — haiku read nothing off posters), matches a Skyline package, **reprices vendor +10%**, and
  builds a **clean Skyline card** (no vendor name/phone — the reliable way to "modify" a poster; AI can't
  safely edit poster text) → approve on WhatsApp → posts to IG+FB. Shared core: `automation/reseller.js`
  (reused by the Gmail reseller flow). **+10% is MANDATORY** — the price must come from the POSTER; no
  price → returns `no_price` + the matched package and the webhook tells the owner *"matches X, send a
  poster that shows the price."* (No caption-typed price — that let free text underprice; removed.) A
  clean photo with no offer falls through to the normal draft; only the authorized sender reaches it.
  Test `tests/check_reseller.js` (14); Bug Hunter + App Security reviewed; full suite 217, 0 fails.
  Opt out: `SOCIAL_WHATSAPP_RESELLER=off`. **Live-tested:** a Rajasthan @ ₹24,900 poster → a Rs 27,400
  Skyline card (verified); the client's real **Bali (DMC Hub)** poster → correctly `no_price` (that B2B
  poster shows no per-person price).
- **package-post cron FIXED:** the 9 AM IST trigger wasn't firing because (a) Vercel Hobby throttles >2
  crons and (b) the GitHub Action fallback (`.github/workflows/package-post.yml`, already committed) had
  no `CRON_SECRET`. **Set the `CRON_SECRET` repo secret** (PiyushM-KK/Travel) from `.env`; manually ran
  the Action → **HTTP 200** (works). It'll now fire reliably 9 AM / 2 PM IST + manual dispatch.

**⚠️ Open bug found (see BLOCKED B-PKGCARD):** today's package-post row (`package-goa-2026-08-07-s0`) is
`rejected` with **no card image** (`imageUrl:false`) → SMM flagged "price missing." So even with the cron
fixed, the package card isn't building/hosting its image → fails review → nothing posts. Needs a fix in
the package-post/calendar-card build+host path.

**PIVOT — the pricing portal (Option 2) becomes a CLIENT CHATBOT (owner request 2026-08-07):** instead of
a Word-doc upload portal, build a **client-only conversational AI agent** for all website price/hotel/
package edits: GitHub-OAuth login → Claude (Anthropic API) with **tool-use** (read repo → propose edit →
**preview/diff** → commit via a scoped BuildWise bot), **grounded** on the site + repo (system prompt +
live repo reads — NOT fine-tuning), accepts documents too. Reuses the Option-2 scaffold
(`pricing-portal/`). Preview-and-confirm before every commit; tools scoped to price/package/hotel fields.
Owner critical-path unchanged: create the GitHub **OAuth App** + **bot** (see `pricing-portal/PRICING-PORTAL.md`).
Related: [[fullfirm-social-automation]], [[fullfirm-industry-bots]].

## ⭐ 2026-08-06 (late) — cron-prep 504 fixed in code (B-504)

`generate` now runs under an absolute **wall-clock deadline** (`cf05f6a`, pushed to `main`): it checks
the clock BETWEEN rows (reserving one row's headroom), so it always heartbeats + returns before Vercel's
60 s cap and **defers** leftover rows to the next pass (the queue drains across runs). Also: heartbeats
BEFORE the loop (a mid-row kill never reads dead), always drafts **≥1 row/pass** (forward progress), and
drafts **OLDEST-first** (FIFO — no tail starvation). Unbounded by default (GHA/CLI/tests unchanged);
only the Vercel cron opts in (`cron-prep` → `deadline = now + 50 s`; `CRON_PREP_BUDGET_MS` overrides,
`"0"` opts out). Locked by `tests/check_generate_deadline.js` (12 assertions); Bug Hunter + App Security
reviewed (0 HIGH/CRITICAL — the forced-first-row poison-pill residual is documented + bounded in code).
**⏳ Owner: deploy to prod** (git push auto-deploys if the project is git-connected, else `vercel --prod`
from `social-automation/` — the agent's CLI deploy was blocked by the harness guardrail). Then the next
`cron-prep` returns 200 and the /ops "Prep" workflow goes green. Optional `SOCIAL_CALENDAR_COUNT=0` trims
the image-less briefs so the queue drains faster. See `BLOCKED.md` → B-504.

## 2026-08-06 (evening) — ops dashboard + the whole-session summary

**Read `SKYLINE-SOCIAL-AUTOMATION.md` first** (the single end-to-end reference; mirrored in the FullFirm
repo — keep both in sync).

**Shipped this session (all deployed + tested, full suite 0 failures):**
- **Root-caused + fixed "the automation didn't work":** stranded-draft **reaper** (`generate-runner`),
  image-host preflight + a hosting-probe in `render-selftest`; recovered the stuck card **live**.
- **B-AIRTABLE** (deployed Airtable token invalid = why crons stopped) — **fixed** (owner-authorized).
- **B-OPENAI** (card B was always the decorative fallback — prod var misnamed `OPEN_API_KEY` vs
  `OPENAI_API_KEY`) — **fixed**; card B is now a gpt-image-1 scene.
- **B-CODE** (a `B- 9880` approval became a junk post) — parser now accepts any separator + guards
  mistyped approvals + lists waiting codes.
- **NEW 4th intake:** twice-daily **package-post** (auto-publish-unless-flagged) + a GitHub Actions
  fallback (`Travel/.github/workflows/package-post.yml`; needs the `CRON_SECRET` repo secret).
- **Bug Hunter trained** (liveness/orphan-recovery lens + `0||default` trap) + a full EOD adversarial
  review (2 HIGH + lower fixed; App Security clean). See `AGENTS.md` (FullFirm).
- **`/ops` monitoring dashboard** — https://buildwise-digital.com/ops.html (see BLOCKED.md → B-DASH and
  the reference doc §11b). Dedicated read-only `OPS_KEY` set.
- Published today's Himachal card B to IG+FB manually (the approval had failed on the parser bug).

**🔴 CURRENT PRIORITY — cron-prep 504 (BLOCKED.md → B-504):** the prep composite exceeds the 60 s cap,
so `generate` never completes → the reaper never runs → a card stays stuck and the dashboard reads RED.
Fixing this (trim/split the composite) is the single thing that turns the board green. **Do this first.**

---

## ⭐ 2026-08-06 — READ FIRST (latest changes + open issues)

### NEW: twice-daily PACKAGE-POST intake (4th channel) — auto-publish unless flagged
A new intake features one Skyline **catalogue** package per slot as the branded A/B card and **auto-
publishes the clean ones to IG+FB**, holding anything an agent flags for the owner. (Owner chose: local
catalogue as the source, "auto but hold anything risky", morning + afternoon — evening stays the 7 PM
calendar card.)
- Code: `automation/package-posts.js` (`runPackagePosts`, `riskFlags`), the shared card builder
  `calendar-cards.buildAndDraftCard`, `packageForSlot` (distinct package per slot), job `package-post`
  in `run.js`, endpoint `api/cron-package-post.js` (CRON_SECRET-guarded), tests `check_package_posts.js`.
- Schedule: `vercel.json` crons `30 3 * * *` (`?slot=0`, 9 AM IST) + `30 8 * * *` (`?slot=1`, 2 PM IST).
- Risk gate: a card that passes fact-check + SMM + QA with no flags AND the live gate ON → auto-posts
  variant A (real photo). Flagged (SMM revise / QA note / caption warning / non-English) OR live gate
  OFF → held for the owner on WhatsApp (never left silently `approved`).
- ⚠️ **OWNER — two things to confirm:** (1) This adds 2 crons → **4 total** in `vercel.json`. If the
  Vercel **Hobby plan caps cron jobs** and the deploy is rejected, either upgrade or drive the two times
  with an external scheduler / GitHub Action hitting `…/api/cron-package-post?slot=0|1` with the
  `Authorization: Bearer $CRON_SECRET` header. (2) Auto-posting only happens when `SOCIAL_LIVE=true`
  (+ creds); otherwise every package-post is held for approval.

### WhatsApp image intake — no keyword needed (owner asked)
Just send the photo; its caption becomes the note that steers the post. The ONLY caveat: don't caption a
NEW image with a bare reserved command word (`approve`/`reject`/`hold`/`yes`/`no`/`ok`/`A`/`B`/`both`/
`photo`/`scene`/`decor`, alone or with a 4-digit code) — those apply to a post already waiting. A normal
descriptive sentence is always safe. (An optional `POST:` prefix could be added if the owner wants one.)

### Bug Hunter trained + a full EOD adversarial review ran
The reaper bug escaped review because it was a *missing recovery path* across a crash boundary. The Bug
Hunter (`automation/review.js`) + `AGENTS.md` now carry a **liveness/orphan-recovery lens** ("if the
worker dies here, who cleans up?") and the `0 || default` trap. The EOD review of this session's changes
found + fixed **2 HIGH + several lower** (reaper live-worker race → claimedAt-primary + floor +
createdAt grace + a **claim-atomicity invariant test**; package-post never left silently `approved`;
deterministic cron slot; Host-header parse; loud host-unconfigured log). App Security ends **clean**. The
one residual (an old-created row hit by a *split* claim write) is unfixable by any timestamp and is
guarded by the claim-atomicity invariant (`tests/check_claim_atomicity.js`) + publish idempotency — a
documented, accepted design point, not an open bug. Suite: 141 checks, 0 failures.

### Publish-on-approval is LIVE
Approving a post on WhatsApp now **posts to Instagram + Facebook immediately** (no waiting for a
publish cron — the owner found a fixed late-night time too late). How it works: `api/whatsapp-webhook.js`
— after a successful `approve`, it runs `runJob({ job:"publish" })` (idempotent + claim-guarded) and
replies with the outcome; `automation/whatsapp.js` appends that outcome (`result.published`) to the
WhatsApp reply. Deployed to the Vercel project **skyline-social** (skyline-social-nine.vercel.app),
verified healthy. The scheduled runners stay as a BACKSTOP: Vercel crons (prep 13:30 UTC, publish
15:30 UTC) + the FullFirm GitHub Action `social-publish.yml` (15:00 UTC). Committed to Travel repo (3cc21d6).

### Diagnosis of "the automation didn't work" (2026-08-06) — the REAL blocker
- Tokens are FINE — WHATSAPP_TOKEN + META_PAGE_TOKEN both validated live (Graph `/me`): valid.
- NOT caused by the firm's site/domain changes (firm publish endpoints verified up).
- **ROOT CAUSE: posts are being HELD by QA for "no image attached."** Captions generate, but the
  IMAGE step fails, so cards never reach `pending_approval` → nothing to approve → nothing publishes.
  Live Airtable `Queue`: held(5), rejected(4), one card stuck in `drafting` since Aug 4
  (`recHbJtwnPvelurID`, "Travel Test" gmail), planned(6), published(3). Last activity Aug 5 16:23 UTC.

### 2026-08-06 (later) — IMAGE BUG root-caused + fixed in code (commit a0a945b)
Two compounding causes, both addressed:
- **Stranded drafts** (this is `recHbJtwnPvelurID`, stuck `drafting` since Aug 4): `runGenerate`
  only lists `planned` rows, so a row left in `drafting` by a crashed/timed-out pass was never
  re-listed → lost forever. FIXED: `reapStaleDrafting()` runs at the top of every generate pass and
  resets any `drafting` row whose claim is older than the stale window (15 min, `GENERATE_STALE_MS`)
  back to `planned` to be re-drafted. `recHbJtwnPvelurID` self-heals on the **next generate/prep
  run** (no manual Airtable edit needed). Locked by `tests/check_stale_draft_reaper.js`.
- **Image HOSTING gap** (why cards are "held for no image"): a card RENDERS fine but can't publish
  if it can't be HOSTED — Instagram needs a public URL, hosting needs `BLOB_READ_WRITE_TOKEN`.
  Without it, every daily calendar-card was created then held with a buried "card A render/host
  failed." FIXED (defensive): calendar-cards now preflights the host config and skips with ONE clear
  heartbeated reason instead of polluting the queue; `render-selftest` now probes hosting for real.

### 2026-08-06 (later still) — TESTED LIVE ✅ + diagnosis corrected
Ran the fix against the **live production Airtable + deployed endpoint**:
- **Reaper works live:** `recHbJtwnPvelurID` (stranded `drafting` ~50h) → **recovered to `planned`**,
  claim cleared, `lastError` records the recovery. `drafting` queue is now 0. (This also resolved the
  "unstick the card" item — done.) It will be re-drafted on the next cron-prep.
- **Hosting is HEALTHY in prod (diagnosis corrected):** the deployed `render-selftest` returns **200**
  with `host: {configured:true, ok:true}` — render (satori png, ~1s) AND host→public-URL→delete all
  work. So the earlier "image hosting is the blocker" theory was WRONG; `BLOB_READ_WRITE_TOKEN` IS set.
- **What the 5 `held` rows really are:** image-less `calendar` **BRIEFS** (`intakeFromCalendar`), which
  QA CORRECTLY holds ("no image attached" — IG needs an image). Plus one `gmail` row (Himachal) that
  SMM legitimately rejected. None were a hosting failure. Skyline's real proactive content comes from
  the image-bearing `calendar-cards` job, so the briefs are redundant clutter.
- **Fix (commit b3ab8d9):** `SOCIAL_CALENDAR_COUNT=0` now disables the image-less briefs (the old
  `Number(x)||8` treated 0 as unset — no off-switch existed). Default (unset) stays 8. **OWNER: set
  `SOCIAL_CALENDAR_COUNT=0` on `skyline-social`** to stop the daily held-pile (optional hygiene; not a
  blocker — the good cards already flow). The 9 old held/rejected rows can be left as a record or
  cleared manually.

### PENDING (next agent — priority)
1. ~~Image bug / hosting / stuck card~~ — **DONE + verified live** (see the block just above).
   Optional hygiene: owner sets `SOCIAL_CALENDAR_COUNT=0` to stop image-less brief holds.
3. Publishing still runs partly on the FIRM's infra (site project + FullFirm GHA) — migration to
   Skyline's own infra still pending (see "Live plumbing runs on the FIRM's infra" below).
4. A **monitoring dashboard** for this automation is planned on the firm site (buildwise-digital.com).

### Diagnostics (inspect state locally)
The local `.env` (plaintext, this folder — gitignored) holds all creds. `automation/queue-peek.js`
reads `AIRTABLE_*` from the process env (or set `SECRETS_PASSPHRASE` to decrypt `.env.enc` — value NOT
recorded here; see the private security notes). Queue: load `.env` → GET the Airtable `Queue` table.
Tokens: GET `https://graph.facebook.com/v21.0/me?access_token=…`. Keep it read-only; never print tokens.

## What this is
Skyline's own social content automation for **Instagram + Facebook** — grounded in
Skyline's real packages/destinations and **fact-checked** before anything is suggested
for posting. The `engine/` is a **vendored copy** of the firm's reusable social engine
(upstream: FullFirm `SociaMedia_Auto/engine`, copied 2026-08-01). Skyline's own logic
is only in `facts.js`, `calendar.js`, `profile.js`.

## Current state — LIVE
- **First real posts are published** (Royal Rajasthan) on **@skylinetravelplanner** and
  the Skyline **Facebook Page** (2026-08-01).
- **Meta app `1711772623363887`** sits under the **Skyline Travel Planner business
  portfolio**. Owner of the app / operator: Piyush (alternate id bhavik@…); business in
  Bhavik's name.
- Key IDs (public, not secret): **Page ID `437743929683019`**, **IG user ID
  `17841404608201511`** (@skylinetravelplanner). NOTE: the Page ID is different from the
  Skyline **business portfolio** ID `710114242690946` — don't confuse them.

## ⚠️ Live plumbing runs on the FIRM's infra (migration pending)
Publishing currently runs on the **firm's** Vercel site (`site-phi-virid-94.vercel.app`),
NOT here:
- `oauth-callback.js` (mint tokens) and `publish-test.js` (guarded test publish) live in
  the firm repo's `site/api/`.
- Skyline's tokens live in the firm `site` project's env vars:
  `META_PAGE_ID`, `META_IG_USER_ID`, `META_PAGE_TOKEN`, `META_APP_SECRET`, `META_APP_ID`,
  `META_PUBLISH_TEST_KEY` (all Sensitive except the IDs).
- **Planned:** migrate this deployment + tokens onto Skyline's own infra so this project
  is fully independent. Until then, do NOT delete the firm-side endpoints — publishing
  depends on them.

## Meta gotchas (hard-won — don't relearn these)
- The Skyline Page is a **New Pages Experience** Page → invisible to `/me/accounts`. Get
  a real **Page token** via the Graph API Explorer's **"User or Page" → Page dropdown**;
  verify by running `me` (must return the Page, id 437743929683019, not the person). A
  **user token cannot post to a Page** (fails #200 "must be posted to a page as the page
  itself").
- **Instagram** publish is 2-step: create the media container, then **poll
  `GET /{container-id}?fields=status_code` until FINISHED** before `media_publish`, or you
  get `9007 "Media ID is not available"`.
- **Facebook** photo on a New Pages Page: single-call `POST /{page}/photos?url=` gives
  #200. Instead upload the photo **UNPUBLISHED** then attach it to a `POST /{page}/feed`
  with `attached_media`; fall back to a plain text `/feed` post. (The working logic is in
  the firm's `site/api/publish-test.js`.)
- Resetting the App Secret invalidates every token; update the env var + re-mint, in that
  order. Vercel "Sensitive" edits can silently fail — DELETE + re-add and verify.

## Meta App Review
Both required calls are on record (`instagram_content_publish` + `pages_manage_posts`).
The **submission** (per-permission screencasts + use-case text) is still to do — see the
firm SOP `docs/sops/meta-app-review-sop.md` §6. Approval unlocks Advanced Access.

## Run the tests (offline, no key)
```bash
node tests/check_skyline_social.js
```
Proves the guard blocks referral-booking claims, unhedged tour prices, visa advice,
guarantees and price-locks, and that the calendar only ever suggests real packages.

## What's NOT here yet (still firm-side, being built)
The automation framework (queue → generate → approve → publish → report) is being built
as the firm's platform (GitHub Actions primary + Vercel fallback, Airtable queue,
WhatsApp approvals, Gmail + client-direct intake, a Claude vision step). It will be
**vendored into this folder** when Skyline's automation goes live, with Skyline's own
Gmail app password / Airtable base / WhatsApp / GitHub-Actions secrets set up then.

## Boundaries
- This folder is Skyline's; the firm keeps the reusable engine. **Do not merge the two.**
- Keep improvements to `facts.js`/`calendar.js`/`profile.js` here; when the firm engine
  improves, re-copy `engine/` from upstream.

---

## Update 2026-08-02 — upstream firm engine advanced a LOT (re-vendor when going live)

ADD-ONLY note. Skyline's own files here were NOT changed this window; Skyline
publishing still runs LIVE on the FIRM's `site` Vercel project (unchanged).

The FullFirm reusable engine + framework (upstream: `SociaMedia_Auto/`) gained a great
deal since this folder's `engine/` was vendored (2026-08-01). None of it is in this
vendored copy yet:
- the full **intake → generate → approve → publish → report** pipeline (one entry
  `automation/run.js <job>`), dual-runner-safe publishing (claim + post-id +
  unknown-outcome→held);
- a senior **agent team**: a Social Media Manager that verifies every draft
  (pass/revise/reject, no free-text auto-adopt) + a PR Manager for reviews
  (crisis→owner, never auto-posts);
- **real transports**: WhatsApp as BOTH the approval channel AND an intake source
  (send a photo/note → drafts a post; reply "approve <id>" → applies), SMTP email
  fallback, Gmail IMAP intake with a **sender allow-list**;
- multi-language drafting (EN/HI/GU/mixed), **encrypted local secrets** (AES-256-GCM
  `.env.enc`), a **go-live verifier** (`verify-live.js`), and fixes from **two
  adversarial audits** (Bug Hunter + App Security — double-post, claim race,
  fail-open endpoint, secret redaction, etc.).

**WHEN Skyline's automation goes live:** re-copy the upstream `engine/` + `automation/`
from FullFirm `SociaMedia_Auto/` into this folder (overwrite the vendored engine only;
KEEP Skyline's own `facts.js` / `calendar.js` / `profile.js`). Do NOT merge the repos.
Follow the FullFirm go-live ladder (`HANDOVER-PROMPT.md` §2b): Airtable → WhatsApp
approvals → schedulers/Vercel → App Review → first post. FullFirm Rung 1 (Airtable) is
already proven; Skyline would set its OWN Airtable base + WhatsApp + secrets.

=====================================================================
2026-08-03 — RE-VENDORED THE ENGINE (add-only, engine/ refresh)
=====================================================================
Re-copied the FullFirm reusable engine (`SociaMedia_Auto/engine/`) into this folder's
`engine/`, keeping Skyline's own `facts.js` / `calendar.js` / `profile.js` untouched.
Repos NOT merged. Committed on branch `add-social-automation` (not pushed).

What changed in `engine/`:
- NEW `social-playbook.js` — the shared playbook that "trains" the caption writer +
  reviewers on social-media craft.
- NEW `review-agents.js` — the agent team (Fact-Check → Social Media Manager → **QA
  safety-net**) + `reviewCreative` (SMM vision: caption a finished design).
- UPDATED `generate.js` — image **vision** + multi-language helpers (additive exports).
- UPDATED `publish.js` — `waitForContainer` (IG container poll → fixes Meta `9007`).
- `brand-profile` / `content-calendar` / `kb-adapter` / `validate-post` — byte-identical
  to 2026-08-01 (no change).

Verified: `node tests/check_skyline_social.js` **PASSES** unchanged (all guards intact:
referral-only booking, unhedged prices, visa advice, guarantees, price-locks blocked;
no secrets in the data files). Engine exports are backward-compatible (additive only).

STILL NOT vendored here (deliberately — the "when going live" step): the `automation/`
framework (queue, runners, transports, secrets, Gmail/Airtable/WhatsApp/Blob, the v2
image-hosting + daily-Gmail + card-renderer work). That needs Skyline's OWN Airtable /
WhatsApp / Gmail / Blob setup and is the next Phase-2 increment once those secrets exist.
Publishing still runs LIVE on the FIRM `site` Vercel project (unchanged).

=====================================================================
2026-08-03 — PHASE 2b: VENDORED THE AUTOMATION FRAMEWORK (add-only, dormant)
=====================================================================
Brought the firm's `automation/` + `api/` framework into this folder (add-only, repos
NOT merged), wired to a `skyline` client. Committed on `add-social-automation` (not pushed).

WHAT LANDED:
- `automation/` (24 files): `run.js <job>` (intake·generate·approve·publish·report·prep),
  in-memory + Airtable stores, WhatsApp/Gmail/SMTP transports, image-host/image-source,
  encrypted secrets (`secrets.js`), go-live helpers (verify-live/queue-peek/wa-subscribe/
  push-env-to-vercel), the review harness — and a Skyline-only `clients.js`.
- `api/` (3): whatsapp-webhook, cron-prep (daily draft), cron-publish (gated).
- `clients.js` REWRITTEN for this repo: registers ONLY `skyline` (loads `../facts.js`
  BUSINESS + `../profile.js` PROFILE/travel vertical). The firm's restaurant demo is
  NOT here (and `automation/data/demo.kb.js` was NOT copied). Default `SOCIAL_CLIENT`
  is `skyline` (run.js + all 3 api endpoints).
- `package.json` gained the optional deps (imapflow/mailparser/@vercel/blob/
  google-auth-library/nodemailer) + `prep`/`publish-pass`/`verify-live` scripts;
  `vercel.json` (crons + maxDuration) + a Skyline-tailored `env.example` added.
- `.gitignore` (repo root) now ignores `node_modules/` + `social-automation/.env`.

SAFETY PROVEN OFFLINE — `tests/check_skyline_automation.js` (NEW, 15 checks, PASS):
the registry is skyline-only (no demo leaked), the client loads Skyline's own facts +
travel voice, the runner defaults to skyline, and — critically — **publish is a DRY RUN**
that mutates nothing until ALL of SOCIAL_LIVE + client.live + a real page token hold
(even `live:true` + forced live stays dry without a token). generate skips cleanly with
no API key; the daily `prep` composite drafts but NEVER publishes. `check_skyline_social.js`
still passes. The SDK is lazy-loaded, so the offline tests need no `npm install`.

STILL OWNER-GATED to ACTIVATE (this instance is independent of the firm's — repo-split):
Skyline's OWN Airtable base (Queue w/ ImageSource + SourceMessageId), WhatsApp, Gmail
(GMAIL_ALLOWED_SENDERS = real suppliers + GMAIL_SINCE_DAYS=2), Vercel Blob, Meta creds
(SKYLINE_* or fallback META_*), then encrypt via `secrets.js` and set SOCIAL_LIVE=true.
See README "The automation framework is now vendored — but DORMANT" + env.example.
Skyline publishing still runs LIVE on the firm `site` project until this instance is
activated + a Skyline Vercel project is stood up.

=====================================================================
2026-08-03 — DEPLOYED LIVE (its own instance) — resume at Step 4
=====================================================================
Skyline's social automation now runs on ITS OWN Vercel project (Path A, repo-split honoured).
It is DEPLOYED and DRY-RUN (nothing publishes until SOCIAL_LIVE is set).

WHAT'S LIVE:
- Code re-vendored to the current firm pipeline (enhance-image/enhance-backends/ai-enhancer/
  net-guard + all fixes). Code is on **`main`** (merged from `add-social-automation`), pushed
  to GitHub PiyushM-KK/Travel. PUBLIC repo — NO secrets committed (`.env.enc` is gitignored +
  untracked; verified). package-lock.json present.
- Vercel project **`skyline-social`** (team full-firm) → deploys from GitHub **main**, **Root
  Directory = `social-automation`**, Application Preset = Other. Production:
  **https://skyline-social-nine.vercel.app**. Functions live: /api/whatsapp-webhook,
  /api/cron-prep, /api/cron-publish (all 403 without auth = up + fail-closed). Daily crons
  from vercel.json (0 13 / 30 15 UTC).
- **Own Airtable base `appSzwvIFBzjROooT`** ("Skyline Social", Queue+Runs schema verified
  field-by-field, tables emptied). Scoped Airtable PAT (data r/w + schema, Skyline base only).
- **Own public Blob store `skyline-social-images`** (store_zmVl8VStnUNTZ9rL, iad1) connected →
  BLOB_READ_WRITE_TOKEN auto-injected.
- **All 17 env vars set** on the project: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, ANTHROPIC_API_KEY,
  SOCIAL_CLIENT=skyline, META_PAGE_ID/IG_USER_ID/PAGE_TOKEN (reused from the firm `site`
  project — same Skyline IG @skylinetravelplanner + FB Page), WHATSAPP_* (5), GMAIL_USER/
  APP_PASSWORD/ALLOWED_SENDERS, GMAIL_SINCE_DAYS=2, CRON_SECRET (random, generated),
  BLOB_READ_WRITE_TOKEN. **SOCIAL_LIVE is ABSENT on purpose** (the live gate — set to "true"
  ONLY at the supervised first publish, then decide whether to keep it).
- verify-live PASSED Airtable (round-trip) + WhatsApp (a test message was sent to the owner).

LOCAL DEV NOTES for the next agent:
- `.env(.enc)` lives in `social-automation/` (the deployment dir) — load-env/secrets were
  fixed to look there (not the website repo root). Local runs need SECRETS_PASSPHRASE.
- The env-push tool: from `social-automation`, `vercel link` (pick skyline-social) then
  `node automation/push-env-to-vercel.js skyline-social`. (Fixed: it no longer uses a
  `--cwd` flag, which broke on the spaced path.)
- To redeploy WITHOUT a local .vercel: `vercel redeploy <prod-deployment-url>` (rebuilds from
  GitHub + current env). Do NOT `vercel --prod` from a stray linked dir.

PENDING — RESUME HERE (Step 4 → Step 5):
- **Step 4 (intake):** repoint the Meta WhatsApp webhook (app 1058870697004437) →
  Callback URL `https://skyline-social-nine.vercel.app/api/whatsapp-webhook`, Verify Token =
  Skyline's WHATSAPP_VERIFY_TOKEN, subscribe messages. Then a photo → a Skyline draft →
  reply "approve <id>". (Alt: Gmail — the daily cron-prep reads GMAIL_ALLOWED_SENDERS.) A
  PUBLISHABLE post needs a REAL image (WhatsApp photo / Gmail attachment); calendar ideas are
  photo-BRIEFS and QA holds them by design.
- **Step 5 (supervised first publish):** one image post → approved → set SOCIAL_LIVE=true →
  publish (run.js publish, or cron-publish with CRON_SECRET, or the daily cron) → verify it
  posts to @skylinetravelplanner IG + FB → decide on leaving SOCIAL_LIVE on.
- NOT YET TESTED LIVE: the deployed intake→generate→approve→publish pipeline. Offline tests
  green. First live exercise is Step 4/5.

OWNER OWES: encrypt+delete the plaintext `.env` (`secrets.js encrypt ; Remove-Item .env`);
ROTATE the passphrase (leaked in chat); optional B-22 (AI image provider) to enable
AI-regenerate. AI image-enhance is NOT active — posts publish the image as-is (safe-enhance
resizes/cleans via jimp at publish; AI restyle is dormant until a provider is wired).

=====================================================================
2026-08-04 — 🎉 FIRST AUTOMATED POST PUBLISHED LIVE (full product working)
=====================================================================
The whole product now runs end-to-end and the FIRST real post is LIVE on the client's
own accounts:
  • Instagram: https://www.instagram.com/p/DbnCj46FqDk/   (id 18117051925937614)
  • Facebook : https://www.facebook.com/1552507453243272/posts/1552507103243307
It was a Diwali/Himachal PRICE POSTER (client's own art), published WHOLE (padded to 4:5,
logo + Helpline + all prices intact — not cropped). Airtable row reckgzRHa6ClnJyE7 = published.

PIPELINE PROVEN: WhatsApp photo → instant "processing…" ack → classify photo/graphic →
enhance (photos, Claid) / skip+report (posters) → grounded caption (fact-check + SMM) →
send the finished IMAGE back on WhatsApp → approve BY NUMBER → publish whole to IG + FB.

--- BUGS FIXED THIS SESSION (all committed on main; each de-risked the go-live) ---
1. Deployed AIRTABLE creds were a stale/wrong token → webhook couldn't write the Queue.
   Re-pushed the correct AIRTABLE_API_KEY + AIRTABLE_BASE_ID (appSzwvIFBzjROooT) to Vercel.
   LESSON: `vercel redeploy` REUSES the old deployment's env snapshot — to pick up new env
   you must trigger a FRESH deploy (git push / `vercel deploy`), not `redeploy`.
2. Webhook Callback URL was still the FIRM's (fullfirm-social). Repointed the Meta WhatsApp
   app (1058870697004437) → https://skyline-social-nine.vercel.app/api/whatsapp-webhook via
   the Graph API (POST /{app}/subscriptions). WABA 1331934679097564 already subscribed.
3. **AirtableStore.create() dropped imageSource + sourceMessageId** (explicit field whitelist
   omitted them) → every WhatsApp photo lost its image + dedup id. Added both + regression
   test tests/check_airtable_imagesource.js. THE key bug — the in-memory store hid it.
4. **Image-post caption reliability** (was intermittently held "no valid draft"): the vision
   step transcribed a poster's PRICES, which the grounding guard then refused to caption.
   Fix: describeImage now describes the VISUAL SCENE only + IGNORES text/prices/logos (+ retry
   on empty, escalate to caption model); briefFromRow reframes image posts (image carries the
   offer → mood+CTA, never restate prices). 0/5 → 5/5 drafts on the real poster.

--- FEATURES ADDED THIS SESSION ---
5. Claid image ENHANCEMENT (B-22) wired + LIVE: automation/ai-enhancer.js makeClaidEnhancer
   (hosts input to Blob → POST /v1/image/edit smart_enhance+polish → fetch result URL via the
   SSRF guard → delete temp input). resolveAiEnhancer routes claid.ai URLs to it. Env on Vercel:
   AI_ENHANCER_URL + AI_ENHANCER_KEY (Claid). FINDING (proven on the real poster): AI enhancement
   GARBLES text on posters → a TEXT-SAFETY GATE (engine classifyImageForEnhance PHOTO vs GRAPHIC,
   defaults to graphic on doubt) only enhances text-free PHOTOS; posters skip. Enhancement value
   is modest on a good photo, real on a low-res one, ZERO/harmful on a poster.
6. Enhance ERROR/credit-limit REPORTING: enhance failures (incl. a Claid credit limit) surface
   in the WhatsApp approval note ("⚠️ Image enhancement failed — … Posting your original").
7. Enhanced image is SENT BACK on WhatsApp (automation/whatsapp.js sendImage) so the client
   approves the VISUAL, not just text. Immediate "processing… ~30s" ack on intake.
8. APPROVE BY NUMBER: each pending post gets a stable 4-digit code (whatsapp.shortCode). Reply
   "approve 2429", or just "approve"/"yes" when one is waiting; several waiting → the bot lists
   the numbers. parseDecision accepts a bare verb + short code; the webhook resolves code/blank
   → the real row. Digest shows "POST #<code>".
9. NEVER-CROP GRAPHICS at publish: a poster is 2:3 (taller than IG's 4:5) — cover-fit was
   slicing off the headline/logo. New "pad" fit in enhance-backends (whole image on a blurred
   bg); publish-runner classifies the image and PADs graphics / cover-fits photos (safe default
   = pad). This is why the poster published whole.

--- HOW THE PUBLISH WAS DONE (supervised, one-off) ---
Ran locally: node script → runJob({job:"publish", live:true}) with SOCIAL_LIVE=true FOR THAT RUN
only (Vercel SOCIAL_LIVE stays OFF → no standing auto-publish). BLOB_READ_WRITE_TOKEN pulled
from Vercel (it's NOT sensitive, so `vercel env pull` gets it); the real META page token derived
at run time (see below). After publishing, the gate stayed off.

--- ⚠️ META TOKEN (the one gotcha — PENDING for the deployed pipeline) ---
Both the LOCAL .env and the Vercel META_PAGE_TOKEN were an invalid "[SENSITIVE]" placeholder
("Cannot parse access token"). The owner then added a token, but it was a short-lived USER token
(type USER, "Bhavik Banker", expires ~2026-08-04T09:00Z) — a user token CANNOT post as a Page.
FIX USED: exchange it for a PAGE token at run time — GET /437743929683019?fields=access_token&
access_token=<user token> → returns the Page token (type PAGE, me→Skyline Page). That worked for
this publish. BUT it's still SHORT-LIVED (expires ~09:00). 
PENDING — LONG-LIVED TOKEN: for the DEPLOYED pipeline (cron-publish) to keep publishing, install
a LONG-LIVED page token on Vercel (META_PAGE_TOKEN) + local .env. Needs the app secret for app
1711772623363887: exchange short user token → long-lived user token (GET /oauth/access_token?
grant_type=fb_exchange_token&client_id=1711772623363887&client_secret=<APP_SECRET>&fb_exchange_
token=<user token>) → then GET /{PAGE}?fields=access_token → a page token that never expires.
The owner needs to paste META_APP_SECRET into .env; then mint + push it to Vercel (sensitive).
Key IDs: app 1711772623363887, Page 437743929683019, IG user 17841404608201511.

--- NEXT FEATURE: EMAIL (GMAIL) INTAKE ---
The 2nd of the owner's three intake ways: search Gmail for a new VENDOR email → take its image →
same pipeline (enhance photos / pad posters) → approve → publish. The plumbing largely exists
(gmail-reader.js IMAP + attachment fetch, the `prep`/cron-prep daily job, GMAIL_ALLOWED_SENDERS,
GMAIL_SINCE_DAYS=2). Owner-gate: a WORKING Gmail auth for info@skylinetravelplanner.com — it's a
Google WORKSPACE mailbox (app passwords often blocked → the OAuth service-account path B-20 may
be needed). Wire the same enhance/gate/approve-by-number/send-image-back flow into the Gmail path.

--- PENDING / OWED ---
• LONG-LIVED Meta page token on Vercel + .env (needs app secret) — see above. Until then the
  DEPLOYED cron can't publish; a supervised local run works while a token is fresh.
• EMAIL (Gmail) intake — the next feature.
• Propagate this session's fixes UPSTREAM to FullFirm SociaMedia_Auto (the reusable engine):
  airtable-store create fix, generate.js describeImage scene-only + classifyImageForEnhance,
  generate-runner briefFromRow reframe + enhance gate + error note, enhance-image/enhance-backends
  pad fit, publish-runner classify+pad, ai-enhancer Claid adapter, whatsapp sendImage +
  parseDecision bare/short-code + shortCode, approval-channel POST #code, webhook wiring.
• Encrypt + delete the plaintext .env; ROTATE the leaked passphrase (still owed from before).

=====================================================================
2026-08-04 (cont.) — AUTOMATED, AUTO-PUBLISHING, + the CARD GENERATOR
=====================================================================
Big session. The product is now a fully automated, approval-gated, self-publishing pipeline
across TWO intake channels, plus a professional branded-card generator. Latest git HEAD on
`main`: card generator (satori+resvg). Everything below is on Skyline `main` + deployed to the
Vercel project `skyline-social` (prod https://skyline-social-nine.vercel.app).

--- ✅ DONE + VERIFIED (worked) ---
• FIRST POST LIVE (earlier): Diwali poster → @skylinetravelplanner IG + FB (padded whole).
• WhatsApp photo intake: instant "processing" ack → classify photo/graphic → ENHANCE photos
  (Claid, AI_ENHANCER_* on Vercel) / SKIP+report posters (text-safety gate) → grounded caption
  → SEND THE IMAGE BACK on WhatsApp → APPROVE BY NUMBER (whatsapp.shortCode; "approve 2429" or
  bare "approve"; multiple → lists numbers).
• #2 FOREIGN-BRAND GUARDRAIL: engine detectForeignBrand + generate-runner (checkForeignBrand)
  HOLDS any image carrying ANOTHER company's brand/phone/website. Wired into the webhook.
• EMAIL (GMAIL) INTAKE #3 (reseller model): daily, a vendor email → read destinations
  (describeOffer) + prices (extractPrices) → match a SKYLINE package (packages.matchPackage; no
  match ⇒ held) → REPRICE vendor +10% (repricedLine; else Skyline's own price) → build a SKYLINE
  CARD → host → WhatsApp the card + details (From/Subject/Received IST, package, price) with an
  approve number → post IG+FB. Never posts the vendor's poster. run.js job "email";
  api/cron-email.js (manual) + FOLDED into api/cron-prep.js (runs email FIRST, then calendar).
• LONG-LIVED META TOKEN: minted a NEVER-EXPIRING page token (app 1711772623363887, Page
  437743929683019). Flow: short user token + META_APP_SECRET → fb_exchange_token (long-lived
  user token) → GET /{page}?fields=access_token → page token (expires:never). Installed in .env
  + Vercel META_PAGE_TOKEN. IG/FB publish verified.
• AUTO-PUBLISH ON: SOCIAL_LIVE=true on Vercel; cron-publish confirmed live (dryRun:false, 0
  published because nothing approved). Daily publish cron 15:30 UTC. cron-prep DAILY at 13:30
  UTC = 7 PM IST (owner's choice).
• CARD GENERATOR (engine/card.js) — REBUILT with **satori + @resvg/resvg-js** (NO Chromium;
  runs in the serverless fn) + Poppins fonts (assets/fonts/*.ttf). Designed template: hero
  destination photo + gradient, Skyline logo chip, RED "From Rs X" price badge, bold headline +
  route, saffron price, SERVICE BADGES with matching icons (Hotels/Transport/Sightseeing/Meals),
  a real green WhatsApp BUTTON + logo CTA, tagline footer, photo credit. jimp fallback
  (renderFallback) on any render error so a post is never blocked. Verified rendering LOCALLY
  (card_v5.png) — looks professional.
• ASSETS on GitHub (PiyushM-KK/Travel → social-automation/assets/): Skyline_Logo.jpg (JPG, white
  bg — a transparent PNG would be cleaner), destinations/<slug>-NN.jpg (16 CC seeds from
  Wikimedia; README = naming <slug>-NN.jpg + slug table; CREDITS.md = attribution), fonts/Poppins.
• Deps added to package.json: satori ^0.29, @resvg/resvg-js ^2.6 (native prebuilt binary).

--- 🔧 WORK IN PROGRESS ---
• CARD DESIGN: v5 sent to the owner's WhatsApp for approval — AWAITING design feedback (they
  iterated a lot: clean photo, footer badges, semantic icons, WhatsApp logo). Tweak card.js.
• DEPLOYED CARD RENDER NOT YET VERIFIED: satori+resvg render works LOCALLY; the DEPLOY BUILT OK
  with the deps, but a card has NOT been rendered ON VERCEL yet. RISK: @resvg/resvg-js native
  binary on Vercel (should be fine — the linux-x64-gnu binary is in package-lock optionalDeps;
  if not, the jimp fallback renders a simpler card). TO VERIFY: mark a vendor email unseen + clear
  its gmail-<uid> Airtable row + trigger the deployed /api/cron-email → confirm a satori card is
  generated + sent (or that the jimp fallback fired). Fonts + logo + photos are committed so the
  fn can read them.

--- ⏳ PENDING / OWNER ---
• OWNER: re-encrypt .env → `node automation/secrets.js encrypt` (plaintext .env currently holds
  META_PAGE_TOKEN, META_APP_SECRET, AI_ENHANCER_KEY, etc. — re-lock it). ROTATE the leaked
  passphrase (owed from earlier).
• VERIFY the deployed card render end-to-end (above) → then a real vendor email at 7 PM IST
  should auto-produce a card → approve → auto-publish IG+FB.
• Better DESTINATION PHOTOS: owner to upload clean/owned photos per slug (some seeds are basic;
  himachal-hills replaced with clean Kullu Valley + Spiti already).
• Skyline WhatsApp NUMBER on the card (owner to confirm the number to print, if wanted).

--- 🔮 FUTURE ---
• Broaden email to TEXT-ONLY vendor emails (currently image-emails only; #3 doesn't need an
  image — the offer text suffices, but off-catalogue offers create noise/held rows).
• Show MULTI-TIER pricing on the card (vendor often lists 3 tiers; currently we take min+10%).
• Transparent PNG logo (current JPG shows a white chip).
• More card templates / seasonal variants; per-package hero-photo curation.
• Propagate this whole session's fixes UPSTREAM to FullFirm SociaMedia_Auto (store fix,
  vision/caption reliability, Claid enhancer, sendImage, approve-by-number, pad-fit, foreign-
  brand, card generator, packages, email-intake). FullFirm is the reusable engine; Skyline
  vendored + extended it. Repos NOT merged.

--- KEY FILES (for the next agent) ---
engine/card.js (satori card + jimp fallback) · automation/packages.js (match+reprice) ·
engine/generate.js (extractPrices/describeOffer/detectForeignBrand/classifyImageForEnhance) ·
automation/email-intake.js (card flow) · api/cron-email.js + cron-prep.js · run.js "email" ·
assets/{Skyline_Logo.jpg, destinations/, fonts/}. Meta: app 1711772623363887, Page
437743929683019, IG 17841404608201511, never-expiring token in .env+Vercel.

=====================================================================
2026-08-04 (cont.) — VERCEL RENDER VERIFIED ✅ + DECORATIVE CARD VARIANT
=====================================================================
Git HEAD on `main`: 5c628c8 (decor variant + render self-test).

✅ DONE + VERIFIED:
• DEPLOYED CARD RENDER **VERIFIED ON VERCEL** (the long-open WIP). New guarded endpoint
  `api/render-selftest.js` (CRON_SECRET Bearer, same auth as the crons) renders a sample card
  ON the server and reports which renderer fired. Live result on prod:
  {platform:linux, arch:x64, node v24, satori:{ok:true,~2.16MB,~1s}, makeCard.renderer:"satori(png)"}
  → the native @resvg/resvg-js linux-x64-gnu binary LOADS + renders on Vercel; the jimp fallback
  did NOT need to fire; committed destination seeds are readable by the fn. Card generation on the
  deployed pipeline is proven. Endpoint stays as a permanent health check (fail-closed).
  Verify anytime: curl -H "Authorization: Bearer $CRON_SECRET" \
    https://skyline-social-nine.vercel.app/api/render-selftest   (add ?img=1 to get the PNG).
• DECORATIVE CARD VARIANT (card.js opts.decor): a BRANDED designed backdrop — warm gradient
  (brown #3D1810 → chili red #E0451F → saffron #F4A21E) + a low-opacity sun/compass motif +
  legibility gradient — NO real photo, NO AI-faked place. Same overlay (logo, price badge,
  headline, service icons, WhatsApp button, tagline). decorBackgroundUri() exported; jimp
  fallback fills warm-brand. This is the honest answer to the owner's "use AI image gen" ask:
  we do NOT AI-fake real destinations (misleading for a real travel brand); the decor variant
  gives a photo-free branded look, and an AI *abstract* texture could later drop into it.

🔧 AWAITING OWNER — CARD-STYLE PICK (this is the open item):
• Owner asked to compare BOTH real-photo and decorative and approve which per destination.
  Published a comparison Artifact (photo card vs decor card for Royal Rajasthan, Kerala
  Backwaters, Kashmir Valley, Himachal Hills) with tap-to-pick + copy-picks:
  https://claude.ai/code/artifact/35dcd0d2-c150-4d9c-aff3-d72ab0f783d5
  NEXT: when the owner sends picks, wire per-slug style into the card flow (email-intake makeCard
  passes {decor:true} for decor-picked packages; photo-picked keep photoPath). Consider a small
  per-slug style map (e.g. in packages.js or a styles.js) that email-intake reads.
• If owner keeps any REAL-photo slugs: upgrade those seeds to nicer licensed photos (Kerala/
  Kashmir seeds are a bit dull/overcast; himachal already upgraded). Wikimedia CC / Unsplash /
  Pexels; keep CREDITS.md updated. Local render helper: scratchpad/render_compare.js.

STILL OWED (unchanged): owner re-encrypt .env (`node automation/secrets.js encrypt`) + ROTATE
the leaked passphrase; transparent-PNG logo; propagate fixes upstream to FullFirm.

=====================================================================
2026-08-04 (cont.) — GROUNDED BRAND FIX + SCENE-PROMPT ENGINE
=====================================================================
Git HEAD on `main`: 32520b5. Owner sent Skyline's OWN 4 posters (mascot illustrations + a real
Kerala photo poster) + a master image-gen prompt, and said: decor cards are too basic (make richer
like the posters), enhance the real photos, and MODIFY the master prompt so its Scene is a variable.

✅ DONE:
• GROUNDED BRAND on every card (from Skyline's real posters): facts.js gained slogan
  "Your Journey, Our Passion", positioning "Domestic Tour Operator", email Info@skylinetravelplanner.com,
  instagram @skylinetravelplanner. card.js footer now shows the real slogan + the contact number
  (WhatsApp glyph + "+91 88660 50291", already grounded in facts.locations[0].phone). email-intake
  passes BUSINESS.slogan/phone/instagram. (Old card said "Your journey, our promise" — WRONG, fixed.)
• SCENE-PROMPT ENGINE — automation/scene-prompts.js: the owner's ultra-realistic master prompt,
  MODIFIED so the SCENE is a rotating VARIABLE. MASTER_TEMPLATE (photographic-quality spec, tuned to
  4:5 with negative space for the overlay, no text/logos in-image) + SCENES (13 generic, aspirational,
  themed scenes) + SLUG_THEME + composePrompt/pickScene/promptForSlug → a fresh on-brand prompt EVERY
  time. Human-readable copy: assets/Master-Prompt-Skyline-Decor.md. Original owner prompt kept at
  assets/Master Prompt — Ultra-Realistic T.txt (still UNTRACKED — owner may commit it).
  HONESTY GUARDRAIL baked in: scenes are generic travel MOOD, NOT a specific identifiable real
  landmark passed off as a real photo (project rule "never AI-fake a real place"). Specific
  destinations → REAL licensed photo; generated scenes → decorative backdrops only.
• assets/decor/ drop-folder + README (naming <theme>-NN.jpg) for generated scenes.

🔧 OPEN (owner):
• STYLE PICKS still pending — the photo-vs-decor comparison Artifact:
  https://claude.ai/code/artifact/35dcd0d2-c150-4d9c-aff3-d72ab0f783d5  (decor there = the plain
  gradient; the richer generated-scene decor comes from the scene-prompt engine once images exist).
• GENERATE DECOR IMAGES — two paths (owner's call): (A) MANUAL prompt-pack (ready now): run the
  composed prompts in ChatGPT/image tool, save to assets/decor/<theme>-NN.jpg. (B) AUTO image-API:
  wire a provider (e.g. OpenAI gpt-image-1) into the card flow to auto-generate per post — needs an
  image API key + per-image cost. NOTE: I cannot generate images inside this tool.
• ENHANCE REAL PHOTOS: upgrade the seed destination photos (Kerala/Kashmir seeds are dull) to
  higher-quality licensed shots like the owner's Kerala aerial poster.

NOT YET WIRED (blocked on picks + images existing): using an assets/decor/<theme>-NN.jpg generated
scene as a real-photo-quality decorative card background (falls back to the gradient decor). Add a
pickDecorPhoto(theme) → photoPath path in email-intake once decor images + per-slug style choices land.

BETTER LOGO AVAILABLE: Skyline's real logo (buildings+wave+plane, "Your Journey, Our Passion") is on
the owner's posters — cleaner than the current white-chip assets/Skyline_Logo.jpg. Extract a
transparent PNG when possible.

=====================================================================
2026-08-04 (cont.) — A/B FLOW LIVE-TESTED END TO END + OpenAI ON
=====================================================================
Git HEAD on `main`: 3e19222. OPENAI_API_KEY is set on Vercel + .env (owner). Org verified + project
model-access enabled for gpt-image-1.

✅ AI SCENES WORKING + LIVE-TESTED. Ran the REAL email→A/B pipeline (real Airtable + WhatsApp + Blob +
OpenAI) with a Himachal vendor offer → generated the AI scene, built A (real photo) + B (AI scene)
cards, passed SMM, and SENT BOTH to the owner's WhatsApp (row recv8kepT51rB9dPh, code 1319). The row
is a real pending_approval, so the owner's A/B/both reply flows through the DEPLOYED webhook → publishes.
• COST (metered, exact): low quality portrait 1024x1536 = ~$0.0199 (~₹1.8)/image; medium ~$0.067 (~₹5.9);
  high ~$0.25. **Owner picked LOW** → set as the code default (image-gen.js). One image per vendor email,
  capped IMAGE_GEN_MAX_PER_RUN=8/run.

✅ TWO REAL FIXES this session (both deployed):
1. run.js email job did NOT wire sendImage → the A/B card IMAGES never reached WhatsApp (text-only).
   Fixed (run.js passes sendImage). This was a latent gap in the whole email-card flow, not just A/B.
2. email-intake caption brief let the writer invent specifics (e.g. "colonial streets, monastery walks")
   not in facts → the SMM safety-net (correctly) rejected/held it. Tightened the brief to name ONLY the
   route destinations + mood + invitation, no invented sights/activities/hotels/meals. Now passes SMM.

⚠️ DEPLOYED cron-email LIMITATION (follow-up): the reader only picks up emails with image ATTACHMENTS.
The current B2B vendor senders (ops11.h2h@gmail.com, holidays.atozholidays.in@proddy.in,
reservation@resortdecoracao.com, noreply@thesamsaraholidays.in) embed the poster as an INLINE HTML
image, so /api/cron-email returns considered:0 (nothing to process). THAT is why the live demo was run
locally (real services) instead of via the deployed trigger. FOLLOW-UP: extend gmail-reader to also
accept the first substantial INLINE image (skip logos/tracking pixels) so the deployed cron works with
these vendors. Until then, the deployed path needs a vendor email that ATTACHES its poster.
LOCAL-DEMO NOTE: BLOB_READ_WRITE_TOKEN isn't in local .env; pull it with `vercel env pull .env.vercel`
(Sensitive vars come back masked as "[SENSITIVE]" — keep local .env authoritative, take only the
unmasked Blob token). Delete .env.vercel after. To reprocess a read vendor email for a deployed test:
mark it UNSEEN via imapflow messageFlagsRemove(uid,["\\Seen"]) — but it still needs an attachment.

=====================================================================
2026-08-04 (cont.) — FIRST AI-SCENE POST PUBLISHED + JPEG/vendor/vision fixes
=====================================================================
Git HEAD on `main`: 2bf6d94.

✅ FIRST AI-SCENE CARD PUBLISHED LIVE (Himachal Hills, B/AI-scene variant) to:
  • Facebook: https://www.facebook.com/437743929683019/posts/1553092379851446
  • Instagram: media id 18120841069876903 (@skylinetravelplanner)
  Flow: approved variant B (applyDecision) → deployed /api/cron-publish → posted IG+FB. Also
  retired a stale failing row (recdLQjwqQi9hFpAg).

✅ FIXES (all deployed, all reviewed by Bug Hunter + App Security):
1. IG PUBLISH FAILED "Instagram accepts JPEG only" — satori renders the card as PNG. email-intake
   now re-encodes every card (A + B) to JPEG (jimp) before hosting; jimp moved to dependencies.
2. INLINE VENDOR POSTERS: the B2B senders embed the poster INLINE (cid) with a header logo + tracking
   pixels. gmail-reader now picks the LARGEST hostable image (the poster), not the first (logo), and
   keeps attachment size; consistent in fetchNewImagePosts + fetchAttachmentBytes. So NEW vendor
   emails (which arrive unread) auto-process on the deployed cron. (Reprocessing a READ email via IMAP
   is unreliable — Gmail keeps re-applying \Seen — but that only affects manual re-tests, not live ops.)
3. VISION EMPTY ON BIG POSTERS: a 2–3MB poster made describeImage/describeOffer/extractPrices return
   EMPTY. engine/generate.js imageBlockSource is now async + downscales bytes to <=1568px JPEG before
   vision (proven: raw Himachal poster → nothing; downscaled → "Himachal & Ladakh — Manali, Shimla,
   Kasol, Leh…"). SECURITY: a pixel-bomb guard reads dims from the HEADER (imageDims) and refuses to
   jimp-decode a huge/unknown canvas (>25MP or non-PNG/JPEG/GIF) — sends raw so a decompression bomb
   can't OOM the fn. Also handles a raw Buffer input + sniffs MIME from magic bytes. All 5 callers +
   review-agents.js reviewCreative now `await imageBlockSource`.

STATUS: the full email→A/B→publish loop is proven live. A NEW vendor email with an inline poster will,
on the 7 PM IST cron, auto-produce A/B cards → WhatsApp → your pick → IG+FB. IMAGE_QUALITY=low default
(~₹1.8/img). All secrets set on Vercel (OPENAI included).

FOLLOW-UP (minor, noted by reviewers, not blocking): a big poster is jimp-decoded once PER vision
function on the same run (describeOffer + extractPrices in Promise.all, etc.) — bounded + guarded, but
could be downscaled ONCE upstream and shared. And pickBestImage picks by bytes, so a large decorative
banner could beat a smaller offer poster (heuristic).

=====================================================================
2026-08-04 (cont.) — 3rd INTAKE: CALENDAR AUTO-IDEAS → PUBLISHABLE CARDS
=====================================================================
Git HEAD on `main`: 9606254. The THREE intake channels are now all live:
  1. WhatsApp (owner sends a photo/note → draft).
  2. Vendor email (Gmail → Skyline reseller A/B card).
  3. Calendar auto-ideas → **publishable** A/B card (NEW — this entry).

✅ automation/calendar-cards.js (runCalendarCards) + run.js job "calendar-cards" + wired into
api/cron-prep.js (runs once/day after email). One Skyline package/day (stateless rotation
packageForDay = featurablePackages[floor(now/86400000) % N]) → A (real photo) + B (AI scene/gradient)
card, hosted JPEG → pending row (source "calendar-card", options{A,B}) → grounded caption (useSmm)
→ WhatsApp A/B → owner picks → cron-publish posts IG+FB. Skyline's OWN package + OWN price (no markup).
LIVE-PROVEN: ran the job → featured Royal Rajasthan → A/B sent to owner WhatsApp (row rec4RHOZfMSE0DoIq,
code 6877). tests/check_calendar_cards.js (5 checks).

Reviewed by Bug Hunter + QA; fixes applied:
- QA[HIGH]: only feature packages with a REAL matching photo (photoSlug != "generic"). The other ~12
  packages (Maldives/Bali/Thailand/Gujarat/…) fell back to the "generic" seed = a HIMALAYAS-FROM-SPACE
  photo under the wrong headline, credited "Photo: Wikimedia CC" — a real photo of the WRONG place that
  NO agent catches (card A isn't vision-reviewed). Now rotates the 10 photo-backed packages only.
  (To add more: drop real CC photos into assets/destinations/<slug>-NN.jpg and add the slug to
  packages.js SLUG_MAP; they auto-join the rotation.)
- BugHunter[MED]: create the row FIRST (before the paid image-gen) so a cron retry/re-trigger dedups on
  it (smid calendar-<slug>-<YYYY-MM-DD>); guard generateOne against throwing (sweep blobs + hold, not strand).

KNOWN/NOTED (not blocking, shared with email-intake): no orphan-sweep job exists, so a card the owner
never decides leaks its 2 Blob JPEGs (rejecting/approving sweeps them); undecided cards accumulate in
pending_approval (bare "approve" then needs a code); QA agent (useQa) not wired (SMM is the gate, and it
runs blind to the image — image honesty rests on the owner's A/B approval + the photo-backed-only gate).
facts.js DESTINATIONS_WITH_IMAGES list is stale (lists photos not on disk) — reconcile someday.

=====================================================================
2026-08-04 (cont.) — TWO-CANDIDATE A/B CARDS (photo + AI scene, owner picks)
=====================================================================
Git HEAD on `main`: b3ff33a. Reviewed by Bug Hunter + App Security + QA (all fixes applied).

WHAT SHIPPED (owner path B): each vendor-email offer now produces TWO IG/FB cards from the same
branded template and WhatsApps BOTH to the owner:
  • A = real destination photo (assets/destinations seed).
  • B = a DECORATIVE scene GENERATED per post by OpenAI gpt-image-1 (automation/image-gen.js) from
    the Skyline scene prompt (scene-prompts.promptForSlug), composited under the Skyline overlay.
    No key / failure / over the per-run cap ⇒ B falls back to the code-drawn gradient decor.
Owner replies "A" / "B" / "both" (bare, or with the 4-digit code): A/B sets which card publishes;
"both" approves A + CLONES an approved B row (dedup-guarded). Plain "approve" = A. All offline-tested
(tests/check_ab_selection.js, 19 checks). Deployed; render self-test still satori(png) on Vercel.

KEY FILES: automation/image-gen.js (gpt-image-1; timeout; size/magic validation; key redaction),
engine/card.js (opts.photoBytes background + MIME sniff; opts.badges; DEFAULT_BADGES), email-intake.js
(A+B build, imageSource.options carrier, per-run cost cap, held-path blob sweep), whatsapp.js
(parseDecision A/B/both), approve-runner.js (variant apply + clone + blob sweeps), whatsapp-webhook.js
(tightened code resolver). Data model: both card URLs ride in imageSource.options {A,B} — NO Airtable
schema change. publish reads imageUrl directly, so options are ignored at publish.

⏳ OWNER SETUP TO ACTIVATE AI SCENES (until then B = gradient, everything else works):
  • Add OPENAI_API_KEY (SENSITIVE) to .env + Vercel (env.example documents IMAGE_MODEL/SIZE/QUALITY/
    TIMEOUT + IMAGE_GEN_MAX_PER_RUN cap default 8). Cost: gpt-image-1 ~a few cents/image, one per
    vendor email (capped/run). Then re-encrypt .env.
  • MAYBE bump cron-prep/cron-email maxDuration if image-gen (default 45s timeout) + a busy run
    exceeds 60s. Left at 60 (unsure of Vercel plan cap — raising to 300 risks a deploy error). Vendor
    emails are rare (0-1/day) so one gen fits 60s; extras fall back to gradient on the time budget.

⚠️ QA DECISION TO CONFIRM WITH OWNER: the card badges USED to say Hotels/Transport/Sightseeing/Meals
(owner's earlier design). QA flagged Meals/Transport as UNVERIFIABLE on a resold package (and Transport
brushes the referralOnly rule). Changed the default to GROUNDED Skyline services:
Hotels · Sightseeing · Custom Trips · 24/7 Support (all on Skyline's own posters). Badges are now
configurable (card.js opts.badges) — if the owner confirms meals/transport are always included, pass
them back. Also fixed: Meghalaya scene was a Kerala houseboat (now hills); "photo: AI scene" credit
(now "AI-generated scene · illustrative" for B, "Photo: <src>" for A).

=====================================================================
2026-08-05 — DOMAIN LIVE: skylinetravelplanner.com (Cloudflare + GitHub Pages)
=====================================================================
The Skyline WEBSITE is now on its OWN domain: https://skylinetravelplanner.com (valid HTTPS).
- DNS moved to CLOUDFLARE (registrar stays Squarespace; NS jakub/vivienne.ns.cloudflare.com).
- Website served by GITHUB PAGES from PiyushM-KK/Travel (apex A → 185.199.108–111.153 + www CNAME →
  piyushm-kk.github.io, DNS-only; CNAME file in repo; Enforce HTTPS ON; Let's Encrypt cert).
- EMAIL PRESERVED: Google Workspace MX + SPF + DKIM + the q4fu6efzycup verification CNAME were carried
  over untouched — Info@skylinetravelplanner.com + the vendor-email intake (GMAIL_*) are unaffected.
- facts.js `website` + the site's canonical/og meta tags now point to https://skylinetravelplanner.com.
- Gotcha: Windows curl reports a false SEC_E_WRONG_PRINCIPAL on the cert (schannel quirk); openssl
  confirms a valid CN=skylinetravelplanner.com Let's Encrypt cert. Browsers are fine.
- A scoped Cloudflare DNS-edit token was used once (via .env) then revoked by the owner.
