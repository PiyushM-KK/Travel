# Handover — Skyline Travel Planner: Social Media Automation

Scope: **only the `social-automation/` folder.** The rest of the Skyline project
(the travel website) is unchanged and separate. Read `README.md` here first for the
structure + provenance.

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
