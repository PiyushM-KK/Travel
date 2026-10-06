# Handover Prompt

Paste the block below into a new Claude Code / AI session to bring it fully up to speed on this project.

---

```
I'm continuing work on "Skyline Travel Planner" — an India-focused travel discovery,
affiliate-referral and customized-tour enquiry website. NO payments, checkout, or ticket
issuance happen on the site; it refers users to official providers (Air India, IndiGo,
IRCTC, redBus, Booking.com) and captures enquiries via a form + WhatsApp.

CURRENT STATE - 2026-10-06 (newest; where it differs from anything below, this wins)
- Live site: https://skylinetravelplanner.com (custom domain on GitHub Pages). Pushing `main` deploys the site AND, since
  2026-10-06, the AI chat worker (see AI CHAT BACKEND).
- NEVER push the owner's local `main` plainly: it holds the 3 social-queue Redis commits, held until the owner's
  Upstash/Vercel switch-over (social-automation/BLOCKED.md B-AIRTABLE-QUOTA). Ship from a branch cut from origin/main:
  `git worktree add <dir> -b <branch> origin/main`, commit there, `git push origin <branch>:main` (fast-forward only),
  then `git -C <checkout> rebase origin/main` (copies of commits already on main drop out).
- PUBLISHED on the owner's "publish" 2026-10-06 (see PENDING - AGENT for the checks): branch `chat-worker-anthropic-10-fix` =
  origin/main + the Lakshadweep website (ea9845d, bbb173e) + the chat-worker history + anthropic-10 (6c128d8, 7f9ed54
  and any later review commits). ONE push of it ships both together (the site must not go live without the worker, or
  the chat contradicts the new page):
  - The "Lakshadweep Escape", Diwali Special 2026 (the owner's flyer, 2026-10-05): diwali-lakshadweep.html in EN/HI/GU -
    3N/4D, 2 nights Agatti + 1 night Bangaram, travel 5-20 Nov 2026, Rs 54,000 per person (minimum 2 travellers) or
    Rs 47,000 (minimum 4), flight tickets extra; stays Sand Bank Beach Resort and "Coral Pearl, Lakshadweep – IHCL
    SeleQtions" (the flyer said "IHCL Taj Resort"; IHCL's own press room and SeleQtions site name it SeleQtions, 50
    glamping tents - owner to confirm); the entry-permit note (our team assists - owner 2026-10-06; never a promise of time, cost or approval); Formspree + WhatsApp enquiry;
    price and form hidden from 21 Nov 00:00 IST. Also: a second Diwali card on /offers; diwali-promo.js names both offers
    until 3 Nov, then Lakshadweep only, gone from 21 Nov (now on Domestic.dc.html too); a Lakshadweep destination page
    (Destination.dc.html?dest=lakshadweep: no price, Oct-mid May, 3-4 days, the permit), a home card, a "Customize my
    trip" option; 7 Wikimedia Commons photos credited on photo-credits.html, captioned by island, never as the resort.
  - Chat worker anthropic-10: Bali's regular rates ("Bali 7 Nights with Flights", Rs 70,200 / 72,200 / 74,000 - on the
    site since 53cf0e3 but NOT yet in the live chat), the Lakshadweep Escape (offered until 21 Nov IST, then "it has
    ended" for a week), and code backstops that tell the two Diwali offers apart (a lower figure tied to Bali is a
    discount; Rs 47,000 never for 1-3 travellers; flights, meals and the permit never claimed). 407 offline checks;
    reviewed: AI Security (2 rounds + a second opinion from another session each round), Bug Hunter (2 rounds, its
    probes re-run on the final code), App Security on the workflow. Verdicts: fit to deploy / safe to ship.
- CHAT ASSISTANT LIVE = anthropic-8 (Cloudflare reports its last change 2026-09-30 19:08 UTC). anthropic-9 was never
  pasted; anthropic-10 replaces it.
- Diwali in Bali (departs Tue 3 Nov 2026): diwali-bali.html EN/HI/GU, /offers, the promo card - LIVE since 89c2980.
  These standalone pages are NOT .dc.html: normal CSS and @media work there. Languages: LANG-FIX-SPEC.md section 7.
  TRAP: they re-apply data-en on every load - change data-en / data-hi / data-gu together with the words.
- Every AI picture/video carries an "Illustrative" label (HI "AI से बना चित्र", GU "AI ચિત્ર"); real photos are credited
  on photo-credits.html. Keep the fine print true to what is shown.
- Tests of any form must NEVER reach Formspree: test Chrome with its own --user-data-dir and
  --host-resolver-rules="MAP formspree.io 0.0.0.0, MAP *.formspree.io 0.0.0.0", and answer the requests yourself.
- Social automation runs on Claude Sonnet 5.5 (live bd5bb59); its queue is blocked on Airtable's quota until the Redis
  switch-over (social-automation/HANDOVER.md).

PENDING - OWNER
1. DONE 2026-10-06: the owner said "publish" and answered: trips may START up to 20 Nov; the Bangaram stay is IHCL's
   "Coral Pearl, Lakshadweep – IHCL SeleQtions"; meals = "breakfast and other inclusions as per the package"; every
   price is per person (no separate price for 1 traveller, 3 or children was given - the chat says our team confirms);
   the entry permit is "assisted" (page, destination page and chat say our team assists with it). Still open: the
   Agatti resort's exact name ("Sand Bank Beach Resort" as on the flyer) and room types.
2. GitHub secrets CLOUDFLARE_API_TOKEN (the account-wide token - owner's choice "Put it in GitHub anyway") and
   CLOUDFLARE_ACCOUNT_ID are set. Optional hardening from the reviews: a token scoped to Account > Workers Scripts:Edit,
   branch protection on main, and a hard monthly spend cap on the Anthropic key.
3. From 2026-09-30: does the WhatsApp team reply in Gujarati/Hindi; a fluent read of the worker's Hindi/Gujarati
   transliterations and of both Diwali pages; the 4th Bali video; /offers in the main menu; what diwali-bali.html shows
   after departure; rotate the leaked keys (HANDOVER.md, Pending); the owner's personal email in MEMORY.md; Sarthi
   decisions (C:/Automation/clients/skyline-travel/sarthi/PLAN.md); the Cloudflare Workers plan (Free = 10 ms CPU).

PENDING - AGENT
- After the owner's publish: `git -C <checkout> rebase origin/main` (local main keeps only the Redis commits and doc
  commits), watch the Action (test, deploy, health), GET the worker (anthropic-10), check the pages live (desktop and
  390 px, EN/HI/GU, the promo card, /offers, the destination page), confirm Workers Logs and preview URLs are off; then
  remove the worktrees skyline-bali, skyline-laks, skyline-w10, skyline-w10fix and their branches.
- After 2026-11-21 the <script src="diwali-promo.js"> tags can go (the card already hides itself).
- Older: index.html is wider than a 320 px phone in Hindi/Gujarati; Package.dc.html opens Royal Rajasthan for Gujarat
  Darshan, the 3 Sikkim packages and South Temple Trail, and shows wrong photos for two; season conflicts between the
  Destination and Package pages; the Privacy page never mentions the AI chat; Sarthi P0-P5; the social automation's open
  LOW (the digest prints photoDescription uncleaned).

FIRST, BEFORE ANY EDIT:
1. Run `git pull`. This repo is edited from more than one place (Copilot / other agents),
   so always sync before touching anything.
2. Read HANDOVER.md (technical detail, how-to-update, and §10 source-of-truth rules) and
   MEMORY.md (status log of what changed and when). They are the authority; this prompt is
   only a summary.

LIVE / REPO
- Live site: https://skylinetravelplanner.com (was https://piyushm-kk.github.io/Travel/)
- Repo: PiyushM-KK/Travel (public), branch `main`, hosted on GitHub Pages (root, .nojekyll)
- Owner: Piyush Mehta · Business WhatsApp +91 88660 50291 (wa.me/918866050291)

⚠️ SOURCE OF TRUTH — ONLY EDIT THESE:
- `index.html`        = the live homepage.  `Home.dc.html` is a REDIRECT STUB — never add content there.
- `Domestic.dc.html`  = domestic tours (19 packages incl. North-East India).
                        `Domestic Tours.dc.html` is a REDIRECT STUB.
Content added to a stub is invisible to users. The repo previously drifted into duplicates;
this was reconciled on 2026-07-10.

TECH / ARCHITECTURE
Pages are "Design Components": plain .html files (*.dc.html plus index.html) that use INLINE
STYLES ONLY and load a runtime `support.js`, which pulls React + Babel from the unpkg CDN at
runtime and renders client-side. Each file = markup at the top + a `<script type="text/x-dc">`
logic class at the bottom (data arrays, slideshow timers, EN/HI/GU translations). No build step.
Must be served over http(s):// — never file://. Use `live.html` (auto-reloading dev preview) or
`python -m http.server 8000`.
GOTCHA: an inline `@media` inside a style attribute does NOT work in this runtime — use real CSS
classes in the page's `<helmet><style>` block instead.
Because the site is client-rendered, SEO/OG tags are placed in the real <head> (not the helmet).

KEY PAGES
index.html (home) · Domestic.dc.html · International.dc.html · Destination.dc.html (per-destination
detail page, reads ?dest=<slug>) · Customize.dc.html (main lead capture) · Flights / Trains / Buses /
Hotels / Cabs .dc.html (referral + search UIs) · Package.dc.html · Privacy.dc.html ·
AssistantWidget.dc.html (floating AI chat, imported on pages) · live.html (dev preview).
Chatbot.dc.html and WhatsApp.dc.html are orphaned/unused.

DEPLOYING SITE CHANGES
Commit your own files by path (never `git add -A`) on a branch cut from origin/main, then
`git push origin <branch>:main` - see CURRENT STATE. Pushing main deploys the site, and the chat worker when its files
or any root .html page change.
Push auth: a GitHub token lives in the gitignored `.env` (GITHUB_TOKEN=). Pushes use a temporary
tokenized remote, then reset the remote back to the clean URL.
GitHub Pages rebuilds in ~1 min and caches files 10 min (max-age=600) — hard-refresh
(Ctrl+Shift+R) or use a private window to verify.

AI CHAT BACKEND — DEPLOYED BY GITHUB ACTIONS (since 2026-10-06; it was pasted into the dashboard before)
The floating "Ask Skyline AI" widget (AssistantWidget.dc.html, `aiEndpoint`) POSTs {messages:[...]} to the Cloudflare
Worker https://hello-world.skyline-dev.workers.dev running `server/anthropic-chat-worker.js` and receives {reply}.
- A push to main that changes the worker, server/wrangler.toml, its test or any root .html page runs
  .github/workflows/chat-worker.yml: `node server/test-chat-worker.mjs` (offline, a fake Anthropic API; it compares the
  worker's price and offer blocks with the site's pages, so a site price change without the worker turns the run RED and
  nothing deploys), then `wrangler deploy` (4.147.0, the file uploaded unbundled), then a health check (version, model,
  key). Main only; it refuses a VERSION older than the live one.
- ANY price or offer change on the site: update the worker's blocks (PUBLISHED_PRICES, BALI_PACKAGE, the offer blocks)
  and its VERSION in the same push.
- Secrets: ANTHROPIC_API_KEY is a Cloudflare Worker secret, kept by every deploy. CLOUDFLARE_API_TOKEN and
  CLOUDFLARE_ACCOUNT_ID are GitHub repository secrets, copied from social-automation/.env by
  social-automation/sync-gh-secrets.sh, which never prints them.
- Fallback: paste the file into the Cloudflare dashboard → the Worker → Edit code → Deploy.
- Health check: open the Worker URL in a browser (GET) → {ok, version, model, hasKey}.
- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), `thinking: { type: 'between_tools' }`, NO `temperature` (Sonnet 5.5
  returns a 400 for a non-default one), `max_tokens: 1000`. Change all three together.
- Behaviour: replies in the visitor's language (EN/HI/GU); budget optional; only the site's published prices; the price
  note in the reply's language; CORS locked to the site's origins; code backstops replace wrong figures and add notes
  for false inclusions and booking/visa/permit promises.

LEAD CAPTURE
Customize.dc.html submits to Formspree (endpoint in the file) → email, plus a prefilled WhatsApp
button to wa.me/918866050291.

SECRETS — NEVER COMMIT OR PRINT
GitHub token → local `.env` (gitignored). Anthropic API key → Cloudflare Worker secret.

CONTENT RULES (IMPORTANT — apply to site copy and the AI assistant)
- Never claim to confirm tickets or bookings, process payments, guarantee hotel availability,
  guarantee prices, guarantee visa approval, or give official immigration advice.
- Prices are always INR "starting from" estimates, never guaranteed; keep the price-disclaimer note.
- Never ask for card, bank, Aadhaar or passport details.
- Keep the "no payments on this website" disclosure.

DESIGN
Primary sky-blue #0a5fd7 / #0A84D6, accent orange #FF6A3D, fonts Plus Jakarta Sans +
Bricolage Grotesque, warm sky-to-sand gradient page background. Languages: English / Hindi / Gujarati.

PENDING / NEXT UP
1. Update images + page background. Images live in images/ and are referenced by filename — swap a
   photo by overwriting the same filename. Homepage hero = the `heroImages` array in index.html's
   logic class. Background = the `body { background: linear-gradient(...) }` rule in each page's
   <style>.
2. "Live" cycling photos per destination card — generalize the existing Uttarakhand multi-image
   crossfade card to all destination cards (needs 2–4 real photos per destination).
3. DONE (skylinetravelplanner.com is live). Was: custom domain skylinetravelplanner.com — buy on Hostinger, then add GitHub Pages DNS: four A
   records 185.199.108.153 / .109.153 / .110.153 / .111.153 on @, and CNAME www →
   piyushm-kk.github.io. Then add a CNAME file to the repo, set the domain in Pages settings and
   enable Enforce HTTPS.
4. Housekeeping: revoke old GitHub tokens; delete the unused OPENAI_API_KEY Cloudflare secret and
   server/openai-chat-worker.js (superseded by the Anthropic worker).
5. There is an unreviewed remote branch `copilot/travel-repo-link` on GitHub.

Start by running `git pull` and reading HANDOVER.md + MEMORY.md, then help me with:
[DESCRIBE YOUR TASK]
```
