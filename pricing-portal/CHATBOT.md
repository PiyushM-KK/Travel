# Skyline Client Chatbot — update the website by chat (build spec)

> **The pivot (2026-08-07):** instead of a Word-upload portal, the client edits the live site through a
> **conversational AI agent**. The client says what to change ("Goa is ₹17,500 now", "add a 4★ hotel
> tier for Kashmir"); the agent reads the repo, proposes the exact edit, shows a **diff to approve**,
> and commits it via a **scoped BuildWise bot**. Grounded on the site + repo (system prompt + live
> reads — NOT fine-tuning). Reuses this `pricing-portal/` engine.

Client work — lives in the Skyline repo (`PiyushM-KK/Travel`), not FullFirm (repo-split rule).

---

## Who may use it
The console is **owner-only** (the Skyline owner + Piyush). Auth = **GitHub login** (OAuth), and the
backend only accepts an allow-list of those two GitHub usernames (`PORTAL_ALLOWED_LOGINS`). The page
(`Chatbot.dc.html`) is a static GitHub-Pages page and holds NO secrets — all auth + repo writes happen
server-side in the Vercel backend, which rejects anyone not on the allow-list. (A client-side password
on a public page is not real security; this is why the gate is server-enforced.)

## What the owner can do (scope)
1. **Package prices** — "Set Goa Getaway to ₹17,500" / "Kerala is On request now". (Engine built ✅ `apply-prices.js`)
2. **4★/5★ tier prices** — each package's 3★ price is `price:`; optional `price4:`/`price5:` add the 4★/5★
   "from" prices shown on the card. (Engine built ✅ `apply-package.js`)
3. **Add / remove packages** — a whole package object, placed next to an existing one (right region).
   (Engine built ✅ `apply-package.js`)
4. **Hotel rate catalog** — a per-city list of named hotels with a star rating + "from ₹X / night", on the
   Hotels page. Add/remove a hotel, update a nightly rate. (Engine built ✅ `apply-hotel.js`; the catalog
   ships EMPTY — the owner fills it with REAL hotels/rates.)
5. **Bulk from a vendor rate sheet** — see **Ingestion** below.

Everything is a **bounded edit to a known file, previewed as a diff, approved by the owner, committed
by the bot** — so every change is one auditable git commit the owner can inspect/revert.

## Ingestion — how a vendor rate sheet becomes site edits
Ground truth: a real vendor sheet (e.g. Touracle's *South India Winter Ready Reckoner 2026-27*,
`social-automation/assets/…pdf`) is a **graphic/scanned PDF with NO text layer** (`/Font: false`,
image pages) — `pdftotext` yields nothing, so a regex/table parser cannot read it. Design:
- **Primary — the agent reads the PDF itself (vision).** The Anthropic API accepts a PDF as a document
  block and Claude OCRs the pages. The owner uploads the PDF + "apply this"; the agent extracts the
  tour/hotel/category rates into structured rows, matches them to the live catalog, and shows **each
  proposed change as a diff (with the source cell it read)** so the owner catches any OCR misread.
  Never auto-applied.
- **Fallback — a clean table (exact, zero OCR risk).** For bulk/critical updates the owner can paste or
  export a Markdown/CSV table; `parse-ratesheet.js` turns it into rows deterministically. Accepted shapes:
  a `Package | Price` table (3★ price), a `Package | Tier | Price` table (4★/5★), and a
  `City | Hotel | Stars | Rate` table (hotel catalog).
- **⚠️ Vendor NET rates are a COST, not a sell price.** These B2B reckoners are "net, non-commissionable,
  per person". The agent MUST NOT paste a vendor net rate onto the public site — it surfaces
  "vendor net ₹X → your sell ₹Y" and applies Skyline's margin (the owner sets/confirms it), mirroring the
  mandatory reseller **+10%** rule in the social engine. Public prices are always Skyline's sell price.

## Architecture
```
Client → GitHub OAuth login (allow-listed)
      → Chat UI  ⇄  Claude agent (tool-use loop, grounded on the site facts)
           tools:  read_packages()          → current names/prices/routes (read-site-prices.js)
                   propose_price_update()    → validate + build a diff (apply-prices.js)
                   propose_detail_update()   → route/duration/tag/hotel edits (apply-*.js, to build)
                   parse_document()          → a rate-sheet .docx/.pdf → rows (mammoth, to build)
                   preview_diff()            → show old → new, nothing hidden
                   commit()                  → BuildWise bot writes the file(s) + git commit
      → GitHub Pages deploys the change
```
- **Auth** decides only WHO may use the chatbot (allow-listed GitHub logins). **Commits go through a
  SEPARATE least-privilege bot** with write access to just `PiyushM-KK/Travel` — the client's own token
  never writes. No passwords anywhere.
- **Grounding:** the system prompt carries the current package/hotel facts (read live from the repo each
  session) + hard rules (only edit `price:`/known fields; a ₹ figure or "On request"; never invent a
  package; every change previewed + approved). Same safety posture as the social engine's validate-post.

## Components / status
| Piece | File | Status |
|---|---|---|
| Baseline reader (current prices) | `lib/read-site-prices.js` | ✅ built |
| **Unified catalog reader** (packages+tiers+hotels, grounding) | `lib/read-catalog.js` | ✅ **built** |
| **Price writer** (3★, bounded edit) | `lib/apply-prices.js` | ✅ **built + tested** |
| **Package writer** (4★/5★ tiers + add/remove package) | `lib/apply-package.js` | ✅ **built + tested** |
| **Hotel writer** (add/remove hotel + nightly rate) | `lib/apply-hotel.js` | ✅ **built + tested** |
| **Rate-sheet parser** (Markdown/CSV → rows) | `lib/parse-ratesheet.js` | ✅ **built + tested** |
| Engine tests (writers+reader+parser) | `lib/engine.test.js` | ✅ **40 checks green** |
| Site data model + rendering (hotel catalog, 4★/5★ tiers) | `Hotels/Domestic/International.dc.html` | ✅ **built** (catalog ships empty) |
| PDF vision ingestion (upload → rows) | in `agent/chatbot.js` (Anthropic document block) | ▢ Phase 2 |
| Claude agent (tool-use loop) | `agent/chatbot.js` | ▢ Phase 2 (`@anthropic-ai/sdk`, ANTHROPIC key) |
| Chat UI + OAuth + preview | `api/*`, `Chatbot.dc.html` | ▢ Phase 2 + owner setup |
| Bot commit to the repo | `lib/commit.js` (GitHub App/PAT) | ▢ Phase 2 + owner setup |

**Phase 1 (built, this session):** the whole DATA MODEL + bounded WRITERS + READER + parser + site
rendering — all pure/local, tested (40 checks), reviewed. **Phase 2 (owner-gated):** the agent loop
(incl. PDF vision), GitHub OAuth, the commit bot, and the secured `Chatbot.dc.html` UI — needs the
owner setup below to run live.

## OWNER SETUP — the critical path (B-CHATBOT; I can't create GitHub apps/secrets)
Do these, hand me the IDs, and I wire the rest:
1. **GitHub OAuth App** (client login) — GitHub → Settings → Developer settings → OAuth Apps → New.
   Homepage = the chatbot URL; callback = `<chatbot>/api/auth/callback`. → **Client ID + Secret**
   (env `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`).
2. **Allow-list** the GitHub usernames who may use it (you + the client). → env `PORTAL_ALLOWED_LOGINS`.
3. **BuildWise commit bot** (least-privilege, NOT a personal token) — a **GitHub App** installed on
   `PiyushM-KK/Travel` with **Contents: Read & write** (App ID + Installation ID + private key), or a
   **fine-grained PAT** scoped to that one repo (Contents: write, with an expiry).
   → env `GH_APP_ID`/`GH_APP_INSTALLATION_ID`/`GH_APP_PRIVATE_KEY` (or `GH_BOT_TOKEN`).
4. **Vercel project** (root = `pricing-portal`), env vars above + `ANTHROPIC_API_KEY`.

## Guardrails (carried from the firm's standing rules)
- Nothing changes the live site without the client's approval on a shown diff.
- The bot writes only known fields (`price:`, route/duration/tag, hotel tiers) in the two `.dc.html`
  files — a bounded, auditable change; every publish is a git commit you can inspect/revert.
- The agent never invents a package/price; a ₹ figure or "On request" only (apply-prices `PRICE_OK`).
- Private/owner tooling; secrets only in Vercel env, never in the repo.

## Build order (once owner setup is done)
1. `lib/commit.js` (bot) + `api/auth/*` (OAuth) — unblock the write path.
2. `agent/chatbot.js` — the Claude tool-use loop wiring read → propose → preview → commit.
3. `lib/apply-details.js` + `lib/parse-ratesheet.js` — details/hotels + document upload.
4. `web/*` chat UI + deploy.
