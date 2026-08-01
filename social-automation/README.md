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
| `engine/` | **Vendored copy** of the firm's reusable social engine (validator, adapter, generator, publisher). See provenance below. |
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
`engine/` was copied from the firm's reusable engine
(**FullFirm / SociaMedia_Auto / engine**) on **2026-08-01**. The firm repo is the
upstream: when the engine improves there (new guard rules, bug fixes), re-copy it
here. Skyline's own logic lives only in `facts.js`, `calendar.js`, `profile.js` —
keep improvements to those here, not in the engine.

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
