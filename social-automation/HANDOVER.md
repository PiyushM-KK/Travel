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
