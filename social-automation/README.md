# Skyline Travel Planner — Social Media Automation

Self-contained social content generation + publishing for Skyline (Instagram +
Facebook), grounded in Skyline's own packages and destinations, and fact-checked
before anything is suggested for posting.

This lives **inside the Skyline project** on purpose. It is **not** merged with the
firm's repo — the firm keeps the reusable engine as its product; this is Skyline's
own instance of it.

## What's here
| Path | What |
|---|---|
| `engine/` | **Vendored copy** of the firm's reusable social engine (validator, adapter, generator, publisher, agent team, playbook). See provenance below. |
| `engine/social-playbook.js` | The shared social-media playbook injected into the caption writer + reviewers ("trains" the agents). Re-vendored 2026-08-03. |
| `engine/review-agents.js` | The agent team: Fact-Check → Social Media Manager → **QA safety-net**, plus `reviewCreative` (SMM *vision* — captions a finished design). Re-vendored 2026-08-03. |
| `facts.js` | Skyline's fact base — 22 packages across 89 destinations, WhatsApp, the price disclaimer, the flight/train/bus/cab **referral-only** list. |
| `calendar.js` | Skyline's travel-specific content calendar (package feature, off-beat Northeast, place spotlight, customization…). |
| `profile.js` | Skyline's brand voice + the `vertical: "travel"` switches that turn on visa/guarantee/price-hedge guards. |
| `tests/` | `check_skyline_social.js` — proves referral-booking claims, unhedged tour prices, visa advice, guarantees and price-locks are all blocked. |

## Run
```bash
node tests/check_skyline_social.js
```
(No API key needed — the guard and calendar are tested offline.)

## Provenance — the engine is vendored, not forked
`engine/` was first copied from the firm's reusable engine
(**FullFirm / SociaMedia_Auto / engine**) on **2026-08-01**, and **re-vendored on
2026-08-03** to pick up the firm engine's advances. The firm repo is the upstream:
when the engine improves there (new guard rules, bug fixes), re-copy it here.
Skyline's own logic lives only in `facts.js`, `calendar.js`, `profile.js` — keep
improvements to those here, not in the engine.

**Re-vendor 2026-08-03 (add-only) brought over:**
- `social-playbook.js` (new) — the shared playbook that "trains" the caption writer
  and reviewers on social-media craft.
- `review-agents.js` (new) — the agent team: Fact-Check → Social Media Manager → a
  **QA safety-net** that holds a post which doesn't fulfil the request or fit the
  brand, plus `reviewCreative` (SMM vision — captions a client's finished design).
- `generate.js` (updated) — gained image **vision** (`describeImage`, base64/URL
  image blocks) and the multi-language helpers (`resolveLanguage`, `LANGUAGES`).
- `publish.js` (updated) — gained `waitForContainer` (polls the IG container's
  `status_code` until FINISHED before publish — the fix for Meta error `9007`).
- The four unchanged files (`brand-profile`, `content-calendar`, `kb-adapter`,
  `validate-post`) are byte-identical to 2026-08-01 — no behaviour change.

All exports are **backward-compatible** (additive only); `check_skyline_social.js`
passes unchanged against the refreshed engine.

## Live publishing — currently on the firm's infra (to migrate)
As of 2026-08-01, publishing is **live** — the first real posts (Royal Rajasthan)
are up on Instagram (@skylinetravelplanner) and the Facebook Page. But the plumbing
still runs on the **firm's** Vercel site:
- Meta app `1711772623363887` (under the Skyline business portfolio)
- OAuth callback + publish endpoint + Skyline's tokens on `site-phi-virid-94.vercel.app`

**Planned migration:** move that deployment + tokens onto Skyline's own infra so
this project is fully independent. Until then, the firm site hosts it. Do not
delete those firm-side endpoints without cutting over first.

## Not included here (still firm-side)
- The automation **framework** (queue, scheduler, approval loop) — being built as
  the firm's platform; a copy will be vendored here when Skyline's automation goes
  live, along with Skyline's own Gmail/Airtable/WhatsApp/GitHub-Actions setup.
