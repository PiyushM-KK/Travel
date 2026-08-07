# BLOCKED — owner-only actions (social-automation)

Owner-only steps (accounts, keys, provider config) that the agent cannot do.
Secret-free by policy — this repo is public. Never paste tokens/passphrases here;
the real values live in the local `.env` (gitignored) and the Vercel project env.

---

## B-LANG-FOLLOWUP — agent-fixable (not owner-gated): 2 remaining language items
The website 3-language (EN/HI/GU) fix shipped 2026-08-07 (`ad247c7`; see `../LANG-FIX-SPEC.md`). Two
minor follow-ups remain, both agent-fixable — no owner action needed:
1. `AssistantWidget.dc.html` — the embedded floating assistant (~4 static strings: title, "Here to help…",
   input placeholder) still shows English. It has no own lang state and can't easily read the parent
   page's selection in Duda's model; skipped by design. Fix later if wanted (e.g. persist lang to
   localStorage + have the widget read it).
2. Long-form itinerary PROSE on `Package.dc.html` / `Destination.dc.html` (highlights, "about", season,
   day-by-day) is still English — the `tr()` plumbing is already in place, so just add `_hi`/`_gu` fields
   to those data objects following `LANG-FIX-SPEC.md`.

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

## B-CHATBOT — owner setup for the client chatbot (the pricing-portal pivot)
The pricing portal is becoming a **client-only chatbot agent** (edit website prices/packages/hotels by
chat, GitHub-OAuth login, Claude tool-use, preview→commit via a bot). Owner-only prerequisites (same as
the old portal — see `pricing-portal/PRICING-PORTAL.md` §Owner setup):
1. Create a **GitHub OAuth App** (client login) → Client ID + Secret.
2. Create a **BuildWise commit bot** (GitHub App on `PiyushM-KK/Travel`, Contents: write — or a
   fine-grained PAT) → the agent commits price/package edits with this, never a personal token.
3. A Vercel project for the chatbot; set the env vars above.
The client already has GitHub (OAuth login works for them + the owner).

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

## B-504 — ✅ FIXED IN CODE 2026-08-06 (cron-prep 504) — ⏳ deploy pending

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
