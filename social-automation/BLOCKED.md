# BLOCKED — owner-only actions (social-automation)

Owner-only steps (accounts, keys, provider config) that the agent cannot do.
Secret-free by policy — this repo is public. Never paste tokens/passphrases here;
the real values live in the local `.env` (gitignored) and the Vercel project env.

---

## B-IMG — confirm image hosting is configured on `skyline-social` (Vercel Blob)

**Why it matters:** a card RENDERS fine but can't publish unless it can be HOSTED — Instagram
publishes from a public https URL, and hosting needs `BLOB_READ_WRITE_TOKEN` (a Vercel Blob store).
Without it, every daily calendar-card was created and then held with a buried "card A render/host
failed," so nothing reached approval — the observed "automation didn't work." (Code now preflights
this and skips with a clear reason instead of polluting the queue — but the token must still be set
for real cards to be produced.)

**Verify (one guarded call — safe, deletes what it hosts):**
```
curl -H "Authorization: Bearer $CRON_SECRET" https://skyline-social-nine.vercel.app/api/render-selftest
```
- **200** → render + host both OK. Nothing to do here.
- **503** → renders but hosting is UNCONFIGURED → do the fix below.
- **500** → a real fault; read the JSON `host.error` / `makeCard.error`.

**Fix (if 503):**
1. Vercel dashboard → project **skyline-social** → **Storage** → create/connect a **Blob** store.
2. That adds `BLOB_READ_WRITE_TOKEN` to the project env (confirm it's present, Production scope).
3. Redeploy (or wait for the next push) and re-run the verify curl → expect **200**.
4. On the next `cron-prep` run, the daily calendar-card should reach `pending_approval` (not held).

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
