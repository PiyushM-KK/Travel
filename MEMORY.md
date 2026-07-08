# Skyline Travel Planner — Project Memory / Status Log

_Running record of state, decisions, and pending work. See `HANDOVER.md` for full technical detail._

## Snapshot (as of 2026-07-02)
- **Live & launch-ready:** https://piyushm-kk.github.io/Travel/
- **Repo:** `PiyushM-KK/Travel` (public) · **Host:** GitHub Pages (`main`, root, `.nojekyll`) · entry `index.html`
- **Owner:** Piyush Mehta (piyushkmehta@yahoo.com) · **Business WhatsApp:** +91 88660 50291

## Everything done this project
1. **Fixed broken navigation** — Home nav/footer pointed to non-existent `Domestic.dc.html` / `International.dc.html`.
   - Renamed `Domestic Tours.dc.html` → `Domestic.dc.html` (removed the space).
   - **Created `International.dc.html`** (Thailand, Bali, Maldives using real images).
   - Footer "Services" links now point to the real Flights/Trains/Buses/Hotels pages.
2. **Responsive header + mobile hamburger menu** on the homepage (the DC runtime can't parse `@media` inside inline styles, so real CSS classes were used).
3. **Copyright year** made dynamic (was hardcoded 2024).
4. **Header logo** shrunk from 160px → 48px across pages.
5. **Real WhatsApp links** — all "Chat"/WhatsApp buttons now open `wa.me/918866050291` with prefilled text (were pointing at a simulated in-browser page that only worked in the design preview).
6. **Lead form now delivers** — `Customize.dc.html` posts to **Formspree** (email) + keeps a WhatsApp prefilled button; added basic validation (name + phone/email required). Formspree endpoint is in the file.
7. **SEO + social** — favicon on every page; `<title>` + meta description + Open Graph + Twitter tags in the real `<head>` of index, Domestic, International, Customize, Flights, Trains, Buses, Hotels, Package, Privacy (so link previews work + crawlers see them despite client rendering).
8. **Domestic package photos fixed** — broken `t-*.png` references repointed to real `dest-*`/`uttarakhand-*` images (stand-ins used for Gujarat, the 3 Sikkim/Darjeeling packages, South Temple Trail — replace with real photos later).
9. **Performance** — added `preconnect`/`dns-prefetch` to unpkg on all pages.
10. **AI chat is LIVE** — floating "Ask Skyline AI" widget wired to a **Cloudflare Worker** (`server/anthropic-chat-worker.js`) running **Claude `claude-haiku-4-5`**; key held as a Cloudflare secret; WhatsApp fallback if unreachable. Worker URL: `https://hello-world.skyline-dev.workers.dev`.
    - Budget is **optional** (assistant never pushes for money).
    - A **price-disclaimer note** is auto-appended whenever a reply quotes ₹/Rs/INR ("Prices are indicative starting-from estimates and can change with season, hotel availability and current rates").
11. **Deployed** to GitHub Pages (renamed Home→index, added `.nojekyll`, committed, pushed, enabled Pages).
12. **Clickable destination cards + detail pages** — homepage destination cards (domestic, Uttarakhand, international) are now `<a>` links to **`Destination.dc.html?dest=<slug>`** with a hover-zoom + card-lift. New `Destination.dc.html` renders a rich per-destination page (hero, top places, best time, ideal duration, indicative "from ₹X", highlights, hotel tiers, price-disclaimer note, big Customize/WhatsApp CTA, related links) for all 12 destinations. Based on web research (see chat/sources).

## Key decisions
- Host = GitHub Pages (free, public repo). Domain not bought yet.
- AI backend = Cloudflare Worker + Anthropic Claude (chosen over OpenAI). Model = Haiku 4.5 for cost; can switch to Sonnet 5 for quality (one line + redeploy).
- Site stays client-rendered via `support.js`/unpkg (no build step); pre-compilation deferred (needs the `dc-runtime` build tool that isn't in the repo).

## How to ship changes (quick)
- **Site:** edit files → `git add -A && git commit -m "..." && git push` (token in `.env`) → Pages rebuilds ~1 min → hard-refresh (Ctrl+Shift+R). Pages caches 10 min.
- **AI (model/prompt):** edit `server/anthropic-chat-worker.js` → Cloudflare dashboard → Worker → Edit code → paste → Deploy (manual, not git).

13. **Destination explorer upgrade (2026-07-06)** — on `index.html`: filter chips (All / Mountains / Beaches / Heritage / Wildlife / North-East, translated en/hi/gu), "from ₹X" prices on every card, new **Sikkim** card, and the cycling-photo card **generalized** — any destination with `imgs[]` + `spots[]` in the `destinations` data crossfades with a place-label chip (Uttarakhand ×4 photos, Sikkim ×2; timer class `sky-cyc`). Ported to `Home.dc.html` in its static-card style (`data-tags` + `.fchip` chips + a plain filter script; **fixed its dead links** — cards pointed at `Domestic Tours.dc.html`, intl cards at a `Package.dc.html?pkg=` slug the Package page doesn't handle; all now go to `Destination.dc.html?dest=<slug>`). `Destination.dc.html`: hero now shows a "From ₹X per person*" chip, North-East + Sikkim entries got `fromPrice`, related links prefer same region.

## Pending / next
- **"Live" cycling photos for more cards:** mechanism is DONE (per-destination `imgs[]` + `spots[]` in `index.html`) — just add the extra photos the user is bringing (~2-4 per destination) to `images/` and list them in the destination's `imgs[]`/`spots[]`.
- Update remaining images / background of the website (see `HANDOVER.md` §5).
- Buy custom domain `skylinetravelplanner.com` (Hostinger) + DNS to GitHub Pages.
- Housekeeping: revoke old GitHub tokens; delete unused `OPENAI_API_KEY` Cloudflare secret + `server/openai-chat-worker.js`; add real Domestic package photos; optional `sitemap.xml`/`robots.txt`.

## Secrets (locations only — never in the repo)
- GitHub push token → local `.env` (`GITHUB_TOKEN`).
- Anthropic API key → Cloudflare Worker secret `ANTHROPIC_API_KEY`.
