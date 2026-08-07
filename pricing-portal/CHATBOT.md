# Skyline Client Chatbot — update the website by chat (build spec)

> **The pivot (2026-08-07):** instead of a Word-upload portal, the client edits the live site through a
> **conversational AI agent**. The client says what to change ("Goa is ₹17,500 now", "add a 4★ hotel
> tier for Kashmir"); the agent reads the repo, proposes the exact edit, shows a **diff to approve**,
> and commits it via a **scoped BuildWise bot**. Grounded on the site + repo (system prompt + live
> reads — NOT fine-tuning). Reuses this `pricing-portal/` engine.

Client work — lives in the Skyline repo (`PiyushM-KK/Travel`), not FullFirm (repo-split rule).

---

## What the client can do (scope)
1. **Package prices** — "Set Goa Getaway to ₹17,500" / "Kerala is On request now". (Engine built ✅)
2. **Package details** — name, route, duration, tag on an existing package.
3. **Hotel info** — the 3★/4★/5★ tiers + per-tier notes shown on a package/hotel section.
4. **Bulk from a document** — upload a Word/PDF rate-sheet; the agent parses it into proposed edits,
   each shown as a diff to approve (never auto-applied).

Everything is a **bounded edit to a known file, previewed as a diff, approved by the client, committed
by the bot** — so every change is one auditable git commit the owner can inspect/revert.

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
| Baseline reader (current prices) | `lib/read-site-prices.js` | ✅ built (24 pkgs) |
| **Price writer (bounded edit)** | `lib/apply-prices.js` | ✅ **built + tested** (12 checks) |
| Detail/hotel writer | `lib/apply-details.js` | ▢ next |
| Rate-sheet parser (.docx → rows) | `lib/parse-ratesheet.js` | ▢ next (`mammoth`) |
| Plan: match + validate + diff | `lib/plan-update.js` | ▢ next |
| Claude agent (tool-use loop) | `agent/chatbot.js` | ▢ next (`@anthropic-ai/sdk`, ANTHROPIC key) |
| Chat UI + OAuth + preview | `api/*`, `web/*` (Vercel) | ▢ needs owner setup |
| Bot commit to the repo | `lib/commit.js` (GitHub App/PAT) | ▢ needs owner setup |

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
