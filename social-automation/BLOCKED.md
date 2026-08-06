# BLOCKED — owner-only actions (social-automation)

Owner-only steps (accounts, keys, provider config) that the agent cannot do.
Secret-free by policy — this repo is public. Never paste tokens/passphrases here;
the real values live in the local `.env` (gitignored) and the Vercel project env.

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

## B-DASH — monitoring dashboard (planned, firm site)

A scalable multi-client monitoring dashboard for this automation is planned on
buildwise-digital.com/ops (reads the Airtable `Queue` + `Runs` heartbeats, shows per-client held
reasons). Needs an owner auth decision (shared ops key vs login) + read-only `AIRTABLE_*` env on the
firm `site` project. See the FullFirm repo BLOCKED.md → B-DASH.
