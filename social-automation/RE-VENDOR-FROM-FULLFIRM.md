# RE-VENDOR FROM FULLFIRM — social-automation engine update (2026-08-02)

A pointer so nothing is lost across the repo split. Skyline's social automation vendors
the reusable engine from the FullFirm firm repo. That engine advanced substantially on
2026-08-02 and should be **RE-VENDORED here (add-only)** — keeping Skyline's OWN
facts / brand / IG+FB creds — when Skyline's automation is next worked on.

## Repo-split rule (do not break)
Never merge the repos. Copy the updated `engine/` + `automation/` in; keep Skyline's own
data. FullFirm holds only the reusable engine + a fictional restaurant demo — never copy
FullFirm's client data or the demo here.

## What advanced in FullFirm (bring these over)
- The full go-live pipeline is LIVE for the firm demo: Airtable queue, WhatsApp approvals
  + a Vercel webhook project `fullfirm-social`, idempotent, audited (Bug Hunter + App
  Security).
- **Draft-on-intake:** a WhatsApp note/photo → Claude (Sonnet 5) writes a fact-checked
  post → sent straight back to approve, in real time.
- **Agents are "trained"** on a shared social-media playbook (`engine/social-playbook.js`)
  injected into the caption writer + Social Media Manager + creative review.
- **New agents:** `reviewCreative` (SMM *vision* — captions a client's FINISHED design +
  suggests improvements) and `reviewAsQualityAnalyst` (a QA safety-net that HOLDS a post
  that doesn't fulfil the request or fit the client). Flow: Fact-Check -> SMM -> QA -> approve.
- **B-18** message-id idempotency (dedup), secrets-at-rest (AES-256-GCM), and go-live
  helpers: `push-env-to-vercel.js`, `wa-subscribe.js`, `queue-peek.js`, `verify-live.js`.
- **PRODUCT v2 spec** (client sends a finished design -> captioned + QA'd -> posted to
  their IG+FB): image hosting (Vercel Blob), a DAILY Gmail trigger (post from email
  contents), and a Chromium **card renderer** for CORRECT Gujarati/Hindi (resvg garbles
  Indic scripts) — the India/GTA differentiator. Never AI-fake real places/prices.

## Source of truth
FullFirm repo -> `SociaMedia_Auto/`: `AUTOMATION-PLAN.md` (§"v2 — Client-driven posting"),
`AGENTS.md`, and `HANDOVER.md` (newest entry, 2026-08-02).
