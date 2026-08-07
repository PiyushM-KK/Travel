# Skyline Pricing Portal — Option 2 (BuildWise pricing-catalog manager)

A private web portal where an updated **Word rate-sheet** becomes live package/hotel prices on
**skylinetravelplanner.com**, via a **live preview + one-click publish**, with **GitHub OAuth login**
and **BuildWise-bot commits**. First use-case: **Skyline hotel & tour-package prices.**

> Client work — lives in the Skyline site repo (`PiyushM-KK/Travel`), NOT in FullFirm (repo-split rule).
> The reusable pattern can serve other clients later; this instance is Skyline-specific.

---

## How prices are stored (the target)
Each package is an object in a `const collections = [...]` array in **Domestic.dc.html** /
**International.dc.html**:
```
{ id: 't-raj', slug: 'rajasthan', name: 'Royal Rajasthan', route: '…', duration: '7N / 8D', tag: 'Heritage', price: '₹24,900' }
```
The site shows `price` as **“From (3★, per person)”**; it is a string — a ₹ figure or `On request`.
So a price update = replacing the `price:` value for a matched package object, then committing the file.
GitHub Pages serves the result. (`lib/read-site-prices.js` already extracts all 24 live packages.)

## Flow
```
Owner/client signs in (GitHub OAuth, allow-listed)
  → uploads the updated Word rate-sheet (.docx)
  → parse the table  → rows { package, new price, notes/exceptions }
  → MATCH each row to a live package (by name/slug)  → read-site-prices.js = the baseline
  → VALIDATE + flag EXCEPTIONS (below)
  → LIVE PREVIEW: a diff (old ₹ → new ₹) + every flagged item, nothing hidden
  → click PUBLISH
  → apply-prices.js edits the `price:` fields in the .dc.html file(s)
  → BuildWise bot commits to PiyushM-KK/Travel  → GitHub Pages deploys
```

## The Word template (client fills this)
A single table, fixed columns, so parsing is reliable:

| Package (name or slug) | New price (₹, per person, 3★) | Valid from | Valid to | Notes / Exceptions |
|---|---|---|---|---|

- One row per package. Price blank or “On request” → sets `On request`.
- **Notes/Exceptions** is free text (seasonal, blackout dates, child rate, 4★/5★ deltas) — preserved
  and surfaced to the approver; never silently applied to the single site price.
- A generator (`scripts/make-template`) can emit this table pre-filled with current prices, so the
  client edits rather than starts blank.

## Exceptions handled (the “details & exceptions” ask) — each HELD for review, never auto-applied
- Package in the sheet that **matches no live package** (typo / new package) → flagged “unmatched”.
- **Malformed / missing price** (non-numeric, symbol errors) → flagged.
- Price **outside a sane band** (e.g. <₹5,000 or >₹2,00,000, or a >X% jump vs current) → flagged.
- Live package **absent from the sheet** → flagged “no update provided” (left unchanged).
- **“On request”** ↔ number transitions → shown explicitly in the diff.
- Any **Notes/Exceptions** text present → surfaced next to the row for a human decision.
The publisher applies ONLY clean, in-band, matched rows the approver keeps.

## Components / status
| Piece | File | Status |
|---|---|---|
| Baseline reader (current prices) | `lib/read-site-prices.js` | ✅ built + verified (24 pkgs) |
| Rate-sheet parser (.docx → rows) | `lib/parse-ratesheet.js` | ▢ next (Node + `mammoth`) |
| Match + validate + diff | `lib/plan-update.js` | ▢ next |
| Apply prices to .dc.html | `lib/apply-prices.js` | ▢ next |
| Bot commit to the repo | `lib/commit.js` (GitHub App) | ▢ needs owner setup |
| Portal UI + OAuth + preview | `api/*`, `web/*` (Vercel) | ▢ needs owner setup |
| Word template generator | `scripts/make-template` | ▢ next |

## OWNER SETUP (do first — this is the critical path)
The auth pieces are owner-only (I can't create GitHub apps/secrets). Do these, hand me the IDs, and I
wire the rest:
1. **GitHub OAuth App** (portal login) — GitHub → Settings → Developer settings → **OAuth Apps → New**.
   Homepage = the portal URL; Authorization callback URL = `<portal>/api/auth/callback`. → gives
   **Client ID + Client Secret** → portal env `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`.
2. **Allow-list** — which GitHub usernames may use the portal (yours; the client’s only if they have a
   GitHub account). → env `PORTAL_ALLOWED_LOGINS`.
3. **BuildWise commit bot** (least-privilege; NOT your personal token) — create a **GitHub App**,
   install it on **`PiyushM-KK/Travel`** with **Contents: Read & write**, note App ID + Installation ID
   + generate a private key. (Simpler alt: a **fine-grained PAT** scoped to that one repo, Contents:
   write, with an expiry.) → portal env `GH_APP_ID` / `GH_APP_INSTALLATION_ID` / `GH_APP_PRIVATE_KEY`
   (or `GH_BOT_TOKEN`).
4. **Vercel project** for the portal (root dir = `pricing-portal`), env vars above set.

Security model: OAuth only decides **who may use the portal** (allow-listed logins). Commits go through
the **separate bot** identity with write access to just the one repo — the logged-in user’s token is
never used to write. No passwords anywhere.

## Guardrails (carried from the firm’s standing rules)
- Nothing publishes without the human PUBLISH click on a reviewed diff.
- Exceptions are surfaced, never silently applied.
- The bot writes only `price:` fields in the two .dc.html files — a bounded, auditable change (every
  publish is a git commit you can inspect/revert).
- Private/owner tooling; secrets only in Vercel env, never in the repo.
