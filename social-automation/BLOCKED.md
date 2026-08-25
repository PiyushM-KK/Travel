# BLOCKED — owner-only actions (social-automation)

Owner-only steps (accounts, keys, provider config) that the agent cannot do.
Secret-free by policy — this repo is public. Never paste tokens/passphrases here;
the real values live in the local `.env` (gitignored) and the Vercel project env.

---

## B-VIDEO — 🎬 AI travel-VIDEO posts (every ~2 days) — QA + generation BUILT (`e384ecf`); owner keys + posting flow PENDING
**Goal (owner):** a short cinematic AI travel clip, ~every 2 days → AI VIDEO QA → WhatsApp approval → post to IG Reels / FB.

**Done & tested (this session):**
- `engine/generate.assessVideoQuality()` — a 15-yr travel-cinematographer vision reviewer over ordered sample
  frames (per-frame craft + AI-video temporal flaws: morphing/flicker/identity drift). Fail-open, 7/10 bar.
- `automation/video-qa.js` — ffmpeg frame sampler + CLI (`node automation/video-qa.js <clip.mp4> [--frames 6] [--min 7]`).
- `automation/higgsfield.js` — AI video gen via the official `@higgsfield/client` SDK (image-to-video), returns the clip URL.
- Reviewed clean (Bug Hunter + App Security); 17 offline checks + a real-ffmpeg smoke test.

**Owner-gated to make it LIVE (do these, then a next agent wires the cron):**
1. **Higgsfield API keys** — create an API key at platform.higgsfield.ai. Set on the `skyline-social` Vercel project
   (and local `.env`): either `HF_CREDENTIALS="<KEY_ID>:<KEY_SECRET>"` **or** `HF_API_KEY_ID` + `HF_API_KEY_SECRET`.
   Never paste them in chat or here.
2. **Install the optional deps** on the deploy: they're now in `package.json` optionalDependencies
   (`@ffmpeg-installer/ffmpeg`, `@higgsfield/client`) — a normal Vercel build installs them. Locally: `npm install`.
3. **Verify the SDK contract** — `@higgsfield/client` is early (v0.2.1); the code targets the documented
   `/v2` `subscribe('/v1/image2video/dop', {input:{model,prompt,input_images}})` shape. Once keys exist, run a single
   live gen and confirm the endpoint/model + the finished-URL path (`jobs[0].results.raw.url`). Endpoint/model are
   env-overridable: `HIGGSFIELD_VIDEO_ENDPOINT`, `HIGGSFIELD_MODEL` (default `dop-turbo`).

**Still to BUILD (next agent, after keys):** the video POST pipeline is NOT wired yet —
- a `video-post` job/cron on a ~2-day cadence: pick a package → seed image (real photo or a QA'd AI scene) + cinematic
  prompt → `higgsfield.generateVideo` → download clip → `video-qa.assessVideoFile` gate (re-gen once on fail, else hold)
  → WhatsApp approval (send the clip) → on approve, **post to IG Reels + FB video**.
- **Meta Reels/video posting is a NEW publish surface** (resumable video upload / Reels container), distinct from the
  current image post — needs its own build + a real end-to-end test. Video hosting: Meta needs a public video URL.
- ffmpeg on Vercel comes from `@ffmpeg-installer/ffmpeg` (declared) — verify it resolves in the serverless runtime.

## B-WA-APPROVAL-IMG — ✅ RESOLVED 2026-08-08 (`06685e6`) — WhatsApp approvals now include the IMAGE
**Was:** the owner got approval digests as TEXT ONLY — no picture — even though 16-17/19 drafts already had
a public hosted image URL and `whatsapp.js` had a built `sendImage()`. Cause: `whatsappChannel.sendDigest`
only called `sendText`. **Fix:** it now sends a short header + ONE message per post WITH ITS IMAGE (falls
back to text for image-less drafts). Verified live (WhatsApp accepted image sends; the owner's 19-post
queue was re-sent with images). Also this session: cron-prep 504 fixed (see B-504), the 26 "held for
review" clutter rows were cleared (→ rejected) on owner request, and `SOCIAL_CALENDAR_COUNT=0` was set on
`skyline-social` to stop generating new image-less calendar briefs.

## B-LANG-FOLLOWUP — ✅ RESOLVED 2026-08-07 (`ecefa2d`) — the site is now fully 3-language
Both deferred items from the main pass (`ad247c7`) are done, so the whole site now switches EN/हिं/ગુ:
1. `AssistantWidget.dc.html` — instead of the fragile "read the parent page via localStorage" idea, the
   embedded floating assistant got its OWN EN/हिं/ગુ toggle in its header (Duda widgets are isolated —
   a widget can't read another widget's state, so a self-contained toggle is both simpler and better UX).
   A `T` dictionary + `phrase()` translate title/subtitle/greeting/quick-chips/placeholder/WhatsApp
   button/disclaimer + launcher/minimize/fallback strings; a `langNote()` directive asks the AI to reply
   in the chosen language (the Cloudflare Worker already drops the leading assistant greeting so
   user-first ordering holds). English stays default.
2. Long-form prose on `Package.dc.html` (23 pkgs: duration/season/audience/highlights) and
   `Destination.dc.html` (19 dests: tagline/about/best-time/visa notes/place descriptions/highlights)
   now has `_hi`/`_gu` fields wired through the existing `tr()`. Data + wiring only — English canonical,
   no prices/ids/links/logic touched. Verified: all three script blocks re-parse, per-field balance +
   3-language render + base-text integrity checked, adversarial review found no defects introduced.

### ✅ 2026-08-08 follow-on — JS card arrays + cross-page persistence (`0c952a9 653f3db 0da4fb4`)
Two more gaps found + fixed so the site is TRULY fully 3-language:
- **JS-rendered CARD arrays** (not `data-*`) stayed English: fixed `Cabs` (cabTypes/partners/routes), `Flights`
  (airlines), `Trains` (services), `Buses` (busTypes), `index.html` home (destinations/international/tags/steps/
  why-us) — added `_hi`/`_gu` + mapped through `tr()`; brands/URLs/prices kept.
- **Language now persists across pages:** every page reads/writes `localStorage('skyline_lang')` (was: each page
  reset to English on navigation). Pick once → all pages follow.

## B-CRONSECRET — ✅ DONE 2026-08-07 — package-post GitHub Action can now run
The `CRON_SECRET` repo secret was set on **PiyushM-KK/Travel** (from `.env`), so
`.github/workflows/package-post.yml` authenticates and fires (verified: manual dispatch → HTTP 200).
Package-post now triggers reliably 9 AM / 2 PM IST + a manual "Run workflow" button. (Vercel Hobby
throttles >2 crons, which is why the Vercel package-post crons were unreliable — the GHA is the fix.)

## B-PKGCARD — ✅ RESOLVED 2026-08-07 (was: package-post card "has no image" / SMM "price missing")
**Real cause was the CAPTION, not hosting.** Ground-truth from the live queue: own-catalogue cards
deliberately omitted the price ("it's on the image"), so the SMM accessibility rule flagged EVERY card
"price/CTA missing" → `revise` → held/rejected (the `imageUrl:false` on the rejected rows was a symptom
— the cards were swept after the SMM reject, not a hosting failure). **Fix (deployed `604fefb`):** for
Skyline's OWN packages the price + WhatsApp number are grounded facts, so the caption now states
"from ₹X per person" + one WhatsApp CTA (the vendor "don't repeat prices" guard in `briefFromRow` was
scoped to vendor sources only). Verified live: SMM now **8/10 PASS**. Also (a) the twice-daily auto-post
now posts the FRESH AI scene, not the repeating stock photo, and (b) owner messages carry source
provenance. Tests `check_pkgcard_fix.js` (17). Superseded by the AI Scene Generator (`9e04931`) + the
reseller-flow extension.

## B-CHATBOT — ✅ BUILT + LIVE + VERIFIED 2026-08-07 (owner console shipped end-to-end)
The owner-only website-edit chatbot is **done and working live**. Console: **https://skyline-chatbot-wheat.vercel.app**
(the site's `Chatbot.dc.html` redirects there). Owner setup complete (OAuth App, scoped commit PAT, Vercel
project, all env incl. SESSION_SECRET). **Verified end-to-end:** the owner logged in (GitHub → allow-list →
session), chatted "set Goa to ₹9,999", approved the diff, and the scoped bot committed it live
(`2ad150e`). Stack (all in `pricing-portal/`, tests 87 checks): `lib/commit.js` (Git Data API atomic
commit), `api/auth/*` + `lib/session.js`/`allowlist.js` (GitHub OAuth + allow-list + HMAC session),
`agent/chatbot.js` (Claude tool-use, PDF/image vision, propose→diff), `lib/actions.js` (typed action →
bounded writer), `api/chat.js`/`api/apply.js`, `public/index.html` (console UI). After-publish shows the
live **website page** link, not a commit. **Remaining (owner):** rotate the PAT + OAuth client secret
(they passed through the build chat); add the Skyline owner's GitHub username to `PORTAL_ALLOWED_LOGINS`
(currently just `PiyushM-KK`). Upload accepts PDF+images (≤~4 MB) + pasted tables; .docx needs conversion
or a future server-side parser. Original owner-setup steps kept below for reference.

### (original owner-setup — done; kept for reference/re-do)
The `Chatbot.dc.html` page becomes an **owner-only console** to edit website prices/packages/hotels by
chat: GitHub-login (allow-list of the owner + Piyush), Claude tool-use, preview→commit via a scoped bot.

**Phase 1 is BUILT + shipped** (`5c0c6b3`, see `pricing-portal/CHATBOT.md`): the data model + bounded
writers + reader + rate-sheet parser, all tested (40 checks) + reviewed. Decisions locked: **auth =
GitHub login**; **hotels = both** a city hotel-rate catalog (on Hotels.dc.html, ships EMPTY) AND
per-package 4★/5★ tier prices (Domestic/International). Vendor reckoners are **scanned image PDFs**
(no text layer) → the agent reads them by **Claude vision**; a clean Markdown/CSV table is the exact
fallback. Vendor NET rates get Skyline's **margin** before going public (mirrors the reseller +10% rule).

**Owner-only prerequisites to run Phase 2 live (I can't create GitHub apps / set prod secrets):**
1. **GitHub OAuth App** (owner login) — GitHub → Settings → Developer settings → OAuth Apps → New.
   Homepage = the chatbot URL; callback = `<chatbot>/api/auth/callback`. → `GITHUB_OAUTH_CLIENT_ID` +
   `GITHUB_OAUTH_CLIENT_SECRET`.
2. **Allow-list** the two GitHub usernames (owner + Piyush) → `PORTAL_ALLOWED_LOGINS`.
3. **BuildWise commit bot** (least-privilege, NOT a personal token) — a GitHub App on `PiyushM-KK/Travel`
   with **Contents: read & write** (App ID + Installation ID + private key) OR a fine-grained PAT scoped
   to that one repo with an expiry → `GH_APP_ID`/`GH_APP_INSTALLATION_ID`/`GH_APP_PRIVATE_KEY` (or `GH_BOT_TOKEN`).
4. **Vercel project** (root = `pricing-portal`) + the env vars above + `ANTHROPIC_API_KEY`.
The client/owner already has GitHub. Hand me the IDs and I wire Phase 2 (`lib/commit.js` + `api/auth/*`
OAuth + `agent/chatbot.js` tool-use loop incl. PDF vision + the secured `Chatbot.dc.html` UI).

**NOTE (data leak guard):** vendor rate sheets (e.g. the Touracle reckoner in `social-automation/assets/`)
carry confidential B2B net pricing and are **gitignored** — never commit them to this PUBLIC repo. Only
Skyline SELL prices reach the site.

## B-CODE — ✅ RESOLVED 2026-08-06 (was: "B- 9880" approval became a junk post / stale-code dead-ends)

**Cause:** the client replied **"B- 9880"** to approve card B, but `parseDecision` only accepted
`B 9880` — the dash made it fall through to INTAKE, so it created a junk post (`subject:"B- 9880"`, no
image) that then failed to publish (*"image_url must be a public https URL"*). Also, deleting +
rebuilding a card changes its short-code, so an old code silently matched nothing.
**Fix (deployed):** `parseDecision` now accepts the letter/verb + code with ANY separator
(`B 9880` / `B9880` / `B-9880` / `B- 9880` / `B: 9880`); a reply that looks like a mistyped approval
is asked-to-reformat instead of becoming a post; and the resolver matches the code against every
pending post (collision-safe) and, on a stale/unknown code, lists the codes actually waiting so the
client just retypes. Locked by `tests/check_parse_decision.js`. (Best practice for resends: prefer
editing the row in place to keep its code, rather than delete+recreate.)

---

## B-OPENAI — ✅ RESOLVED 2026-08-06 (was: card B always decorative, never the AI scene)

**Cause:** the prod env var was misnamed **`OPEN_API_KEY`** but `image-gen.js` reads **`OPENAI_API_KEY`**
(or `IMAGE_API_KEY`). So `resolveImageGen()` returned null and card B silently fell back to the
code-drawn **decorative** gradient instead of a gpt-image-1 AI scene — for days, unnoticed.
**Fix (done, owner-authorized):** added `OPENAI_API_KEY` to `skyline-social` (Production) from the
working value in `social-automation/.env`, removed the dead `OPEN_API_KEY`, redeployed. Verified the key
generates locally (gpt-image-1 → 1.9 MB PNG). Also added a `console.warn({evt:"image_gen_unconfigured"})`
in the decorative-fallback path so a future missing/misnamed key is VISIBLE in the logs, not silent.

---

## B-AIRTABLE — ✅ RESOLVED 2026-08-06 (was: deployed AIRTABLE token invalid = why the crons stopped)

**RESOLVED:** with the owner's go-ahead, the prod `AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID` on
`skyline-social` were reset to the working values from `social-automation/.env` (via `vercel env`,
stdin) and a fresh `vercel --prod` deploy shipped them. Verified: `cron-prep` now gets PAST Airtable
(no more 500) and **built today's calendar card** (`calendar-himachal-hills-2026-08-06`, pending
approval). If it ever recurs, the steps below still apply.

### ⚠️ FOLLOW-UP (new, 2026-08-06) — `cron-prep` returns 504 (too heavy for the 60s Hobby limit)
After the token fix, `cron-prep` returns **HTTP 504**: it does email(Gmail IMAP) + calendar-cards
(image-gen) + the full prep(intake+generate over all planned rows) sequentially, which exceeds Vercel
Hobby's 60s function cap. The USEFUL work still completes first (email + the daily calendar card run
before the slow generate tail), so the card is produced — but the generate tail is cut off and can
strand a `drafting` row (the reaper self-heals it on the next pass). FIX OPTIONS: trim `cron-prep`
(drop/limit the image-less calendar-brief drafting; it only produces QA-held clutter — or set
`SOCIAL_CALENDAR_COUNT=0`), split it into two crons, or move to a plan with a higher `maxDuration`.
Not urgent (the card still gets built), but worth trimming.

### (original diagnosis, kept for reference)
**Symptom:** every scheduled run on `skyline-social` 500s at the first Airtable call:
`airtable GET Queue: Invalid permissions, or the requested model was not found`. So `cron-prep`
(7 PM IST) and the others do nothing — no cards, no drafts, no publishing. **The LOCAL
`social-automation/.env` Airtable token reads the same base fine**, so this is a DEPLOYED-ENV problem:
the prod `AIRTABLE_API_KEY` (3 days old) and/or `AIRTABLE_BASE_ID` (changed 1 day ago) no longer match
a valid token↔base pair.

**Fix (owner — Vercel dashboard, ~2 min):**
1. `skyline-social` → Settings → Environment Variables (Production).
2. Set **`AIRTABLE_API_KEY`** to the valid token — the exact value in `social-automation/.env`
   (that one is confirmed working). Also confirm **`AIRTABLE_BASE_ID`** equals the `.env` value
   (`appSzw…`); set it if it differs.
3. **Redeploy so the new env takes effect** — do a FRESH deploy, not a plain "Redeploy" (that can
   reuse the old env snapshot): push any commit, or `vercel --prod` from `social-automation/`.
4. Verify: `curl -H "Authorization: Bearer $CRON_SECRET" https://skyline-social-nine.vercel.app/api/cron-prep`
   → expect **200** (no `Invalid permissions`). That single call also COMPLETES a missed 7 PM run.

**CLI alternative** (from `social-automation/`, logged in as the project owner):
`vercel link --yes --project skyline-social` → `vercel env rm AIRTABLE_API_KEY production -y` →
`printf %s '<valid-token>' | vercel env add AIRTABLE_API_KEY production` → `vercel --prod`.

(An agent attempt to set this via CLI was correctly blocked as a production-secret write — it needs the
owner's explicit go-ahead.)

---

## B-IMG — image hosting: VERIFIED WORKING (2026-08-06). Optional hygiene below.

**Status: RESOLVED — no owner action required for hosting.** Tested live: the deployed
`render-selftest` returns **200** with `host: {configured:true, ok:true}` — render (satori png) AND
host→public-URL→delete all work, so `BLOB_READ_WRITE_TOKEN` is set on `skyline-social`. The earlier
"hosting is the blocker" theory was wrong. The real blocker was a STRANDED draft (fixed by the reaper,
and the stuck card was recovered live).

**Health check (re-run anytime — guarded, safe, deletes what it hosts):**
```
curl -H "Authorization: Bearer $CRON_SECRET" https://skyline-social-nine.vercel.app/api/render-selftest
```
- **200** → render + host both OK (current state).
- **503** → hosting became unconfigured → Vercel → project **skyline-social** → **Storage** →
  create/connect a **Blob** store (adds `BLOB_READ_WRITE_TOKEN`, Production scope) → redeploy → re-check.
- **500** → a real fault; read the JSON `host.error` / `makeCard.error`.

**Optional hygiene — stop the daily image-less "held" pile:** the `calendar` BRIEF intake creates
image-less rows that QA correctly holds (Skyline uses the image-bearing `calendar-cards` job instead).
Set **`SOCIAL_CALENDAR_COUNT=0`** on `skyline-social` to disable briefs (default unset = 8). Not a
blocker — the real cards already flow to approval.

---

## B-INFRA — publishing still runs on the FIRM's infra (migration pending)

Publishing (`oauth-callback.js`, `publish-test.js`) and Skyline's `META_*` tokens currently live in
the **firm `site` project** + the FullFirm GitHub Action `social-publish.yml`. Do NOT delete those
firm-side endpoints — publishing depends on them until this deployment is migrated onto Skyline's own
infra. See HANDOVER.md → "Live plumbing runs on the FIRM's infra."

---

## B-DASH — ✅ BUILT 2026-08-06 — the `/ops` monitoring dashboard

Live at **https://buildwise-digital.com/ops.html** (read-only). Executive view: verdict, KPIs, live
pipeline (Intake→Approval→Live), recent-activity journeys, per-workflow next-run countdowns,
published-over-time chart, and plain-English issues (problem→impact→action). Auth: a dedicated
read-only **`OPS_KEY`** (set on `skyline-social` + in the local `.env`; CRON_SECRET also works). Data
from `GET /api/ops-status`. Full detail: `SKYLINE-SOCIAL-AUTOMATION.md` §11b. Scale by adding clients
to the `CLIENTS` list in `site/ops.html`.

## B-504 — ✅ RESOLVED + DEPLOYED + VERIFIED 2026-08-08 (cron-prep 504 → 200)

**2026-08-08 update:** the deadline fix (below) was deployed but cron-prep STILL 504'd — because the deadline
only bounds `generate`, which ran LAST, after the slow AI-image `calendar-cards` (~40-50s) had already eaten
the 60s budget, so `generate` never started (heartbeat stuck ~43h; board RED; 1 stuck draft). **Real fix
(`d43d4a6`): reorder cron-prep** so the critical `intake→generate→approve` runs BEFORE `calendar-cards`;
generate persists its drafts + heartbeat to Airtable as it goes, so it's durable even if calendar-cards is
then cut off at 60s. **Verified live:** cron-prep now returns **HTTP 200 in ~42s**, `generate` ran (age 0,
was 43h), all 5 workflows "Running on schedule", health RED→AMBER. `calendar-cards` is best-effort/last (the
twice-daily `package-post` GHA makes publishable package cards regardless). **Optional cleanup:** the 26
AMBER "held" rows are image-less calendar BRIEFS that QA always holds — set `SOCIAL_CALENDAR_COUNT=0` on
`skyline-social` to stop generating them (removes clutter + shortens the generate queue).

### (original, kept for reference) — ✅ FIXED IN CODE 2026-08-06 — ⏳ deploy pending

**Was:** `cron-prep` (the daily prep composite: email + calendar-cards + intake + generate + approve)
exceeded Vercel Hobby's 60 s cap → `generate` was killed mid-pass, never heartbeated, and a card
could stay stuck in `drafting` → the "Prep" workflow read idle (board RED).

**Fix (committed `cf05f6a`, pushed to `main`):** `runGenerate` now takes an absolute **wall-clock
deadline**. It checks the clock BETWEEN rows (never mid-draft), reserving one row's worth of headroom,
so it ALWAYS heartbeats + returns before the cap and DEFERS leftover rows to the next pass (the queue
drains across runs). It also (a) heartbeats BEFORE the loop so a mid-row kill still leaves a fresh
heartbeat, (b) always drafts ≥1 row/pass (forward-progress — a heavy preamble/tiny budget can't stall
the queue), and (c) drafts OLDEST-first (FIFO) so the tail is never starved. Unbounded by default
(GitHub Actions / CLI unchanged); only the Vercel cron opts in. `cron-prep` sets `deadline = now + 50s`
(env `CRON_PREP_BUDGET_MS` overrides; `"0"` opts out). Locked by `tests/check_generate_deadline.js`
(12 assertions); reviewed by Bug Hunter + App Security (0 HIGH/CRITICAL; residuals documented in code).

**⏳ REMAINING (owner, ~1 min): deploy to prod.** The push to `main` deploys automatically IF the
Vercel project is git-connected; otherwise run a fresh `vercel --prod` from `social-automation/` (the
agent's CLI deploy was blocked by the harness guardrail — owner action). After deploy, the next
`cron-prep` (13:30 UTC) returns 200 and the /ops "Prep" workflow goes green.

**Optional complementary trim (owner):** set `SOCIAL_CALENDAR_COUNT=0` on `skyline-social` to stop the
daily image-less briefs — pure QA-held clutter AND the main source of generate's queue length. With
the deadline fix the 504 is already gone; this just makes the queue drain faster and cleaner.
