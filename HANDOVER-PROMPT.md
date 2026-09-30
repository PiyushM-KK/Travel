# Handover Prompt

Paste the block below into a new Claude Code / AI session to bring it fully up to speed on this project.

---

```
I'm continuing work on "Skyline Travel Planner" — an India-focused travel discovery,
affiliate-referral and customized-tour enquiry website. NO payments, checkout, or ticket
issuance happen on the site; it refers users to official providers (Air India, IndiGo,
IRCTC, redBus, Booking.com) and captures enquiries via a form + WhatsApp.

CURRENT STATE - 2026-09-30 (newest; where it differs from anything below, this wins)
- Live site: https://skylinetravelplanner.com (custom domain on GitHub Pages).
- The owner's local `main` is AHEAD of origin ON PURPOSE: the 3 social-queue Redis commits (held until the owner's
  Upstash/Vercel click) plus the chat-worker commits of 2026-09-30 (server/ only; the worker is deployed by paste,
  so they are the source of what is LIVE). NEVER push `main` plainly - it would ship those. Ship website work from a
  branch cut from origin/main: `git worktree add <dir> -b <branch> origin/main`, commit there,
  `git push origin <branch>:main` (fast-forward only), then `git -C <checkout> rebase origin/main`.
  Pushing main auto-deploys GitHub Pages and the Vercel projects.
- Diwali in Bali offer (trip departs Tue 3 Nov 2026): `diwali-bali.html` in EN / हिं / ગુ, `offers.html` = /offers
  (festival tabs from its FESTIVALS list, offers hide after departure, no prices), `diwali-promo.js` (card on
  index.html + International.dc.html, follows the visitor's language, hides at departure). These two pages are
  standalone, NOT .dc.html: normal CSS and @media work there. Their languages: LANG-FIX-SPEC.md section 7.
  TRAP: those pages re-apply `data-en` on every load - change data-en / data-hi / data-gu together with the
  words, or your edit is silently undone.
- Every AI picture/video carries an "Illustrative" label (HI "AI से बना चित्र", GU "AI ચિત્ર"); the real
  parasailing photo is credited (Christophe95, CC BY-SA 4.0). Keep the fine print true to what is shown.
- Tests of any form must NEVER reach Formspree: start test Chrome with
  --host-resolver-rules="MAP formspree.io 0.0.0.0, MAP *.formspree.io 0.0.0.0" and answer the requests yourself.
- 2026-09-30 (session with the FullFirm agent):
  - CHAT ASSISTANT LIVE = "anthropic-8" (GET the worker: version + model). Claude Sonnet 5.5 (`thinking:
    between_tools`, NO temperature - Sonnet 5.5 returns a 400 for a non-default one, max_tokens 1000, prompt caching).
    It quotes ONLY the site's published prices (extracted from the page data; the owner's Shimla & Manali "from
    Rs 10,999, up to Rs 15,000+"; destination "from" prices set by the owner: Kashmir 12,900, Sikkim 20,900,
    Uttarakhand 15,900, the six North-East states 20,500 - packages keep their own prices), names only site
    destinations/seasons, knows the Diwali offer until departure, never states flight times or the WhatsApp team's
    languages, and CODE backstops replace a wrong or unpublished figure (also a destination figure given for a
    package, across sentences and in Hindi/Gujarati names), false inclusions and booking/visa promises, strip markdown,
    add the price note in the reply's language, and retry once on garbled Indic text. Offline test:
    `node server/test-chat-worker.mjs` (344 checks, reads the site files - it fails if a site price changes without the
    worker). ANY price change on the site needs the worker updated + the owner's paste. Two live accuracy tests
    passed (transcripts in the FullFirm session scratchpad, summarised in FullFirm HANDOVER).
  - The chat window is bigger (AssistantWidget.dc.html, min() sizes, live a50c098); prices live cfaf2f3.
  - Social automation now uses Claude Sonnet 5.5 for its reply model (live bd5bb59; engine/model-compat.js: auto +
    strict tools instead of forced tool_choice, one retry, deadlines in the 60 s webhook, cleaned model text in owner
    messages, visible "QA/SMM did not run", fail-closed foreign-brand check; no MODEL env var on Vercel skyline-social).
  - The Cloudflare editor's Preview pane shows "Error 1031 Invalid Workers Preview configuration": the preview tool
    only; the live worker is fine. Do not redeploy an old version to clear it.

PENDING - OWNER (time-limited: the trip departs Tue 3 Nov 2026)
1. DONE 2026-09-30 (anthropic-8 live). Still open: does the WhatsApp team reply in Gujarati/Hindi (then the assistant
   may say so); a fluent read of the worker's Hindi/Gujarati transliterations of package names; the Cloudflare
   Workers plan (Free = 10 ms CPU); "Sarthi" decisions (the plan: C:/Automation/clients/skyline-travel/sarthi/PLAN.md).
2. A fluent Hindi reader and a fluent Gujarati reader skim diwali-bali.html?lang=hi / ?lang=gu and offers.html
   once (AI-translated, then checked twice by independent AI native editors).
3. The 4th video, "garland welcome on Diwali evening": retry in Higgsfield with the reworded prompt in MEMORY.md
   (Diwali entry), or give the agent a free Hugging Face token (HF_TOKEN) to make it with Wan 2.1 image-to-video.
4. Decide: add /offers to the site's main menu (the header is copied into 11 pages); keep the Day 7 jungle
   picture (Jimbaran is on the coast); give the Diwali-nights plane Singapore Airlines colours; swap the soft
   Uluwatu clifftop for a real 4K Commons photo (cloud.shepherd, CC BY 2.0); what diwali-bali.html shows after
   departure (it still shows the price and the booking form).
5. Rotate the leaked keys (HANDOVER.md, Pending), and decide whether MEMORY.md should keep the owner's personal
   email (this repo is public).

PENDING - AGENT
- index.html is wider than a 320px phone in Hindi/Gujarati (its language menu + burger) - fix when asked.
- Add the next festival to offers.html FESTIVALS (with _hi/_gu fields) when the owner gives an offer.
- After 2026-11-09 the two <script src="diwali-promo.js"> tags can go (the card already hides itself).
- 2026-09-30: watch the social automation's first Sonnet 5.5 runs (400 invalid_request_error, a high "did not run"
  rate); LOW open: the approval digest prints the vision photoDescription uncleaned (use cleanModelText).
- Site data found broken: Package.dc.html opens Royal Rajasthan for Gujarat Darshan, the 3 Sikkim packages and South
  Temple Trail; Gujarat Darshan and South Temple Trail show the wrong photos; season conflicts between Destination and
  Package pages; the Privacy page never mentions the AI chat. Fix with the owner (Sarthi P0/P1).
- "Sarthi" (the assistant's new name, owner 2026-09-30) v1: streaming with per-sentence checks, chips, package cards,
  trip brief -> WhatsApp/Customize prefill, voice, page-aware greetings - plan in the private clients repo
  (C:/Automation/clients/skyline-travel/sarthi/PLAN.md), phases P0-P5, owner decisions pending.

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
Edit files → `git add -A && git commit -m "..." && git push` - BUT while local main holds unpushed commits,
use the branch method in CURRENT STATE instead of a plain push.
Push auth: a GitHub token lives in the gitignored `.env` (GITHUB_TOKEN=). Pushes use a temporary
tokenized remote, then reset the remote back to the clean URL.
GitHub Pages rebuilds in ~1 min and caches files 10 min (max-age=600) — hard-refresh
(Ctrl+Shift+R) or use a private window to verify.

AI CHAT BACKEND — NOT DEPLOYED BY GIT
The floating "Ask Skyline AI" widget (AssistantWidget.dc.html, `aiEndpoint`) POSTs {messages:[...]}
to a Cloudflare Worker at https://hello-world.skyline-dev.workers.dev running
`server/anthropic-chat-worker.js` (Claude model `claude-sonnet-5-5` since 2026-09-30; was `claude-haiku-4-5`) and receives {reply}.
- ANTHROPIC_API_KEY is an encrypted Cloudflare Worker secret (never in the repo).
- ⚠️ To change the AI model/prompt/logic you MUST paste the file into the Cloudflare dashboard →
  the Worker → Edit code → Deploy. `git push` does NOT update the Worker.
- Health check: open the Worker URL in a browser (GET) → {version, model, hasKey}.
- Behavior already baked in: replies in the user's language (EN/HI/GU); budget is OPTIONAL (never
  pushes for money); a price-disclaimer note is auto-appended whenever a reply quotes ₹/Rs/INR;
  CORS locked to the site's origins.
- Model (2026-09-30): Claude Sonnet 5.5 (`claude-sonnet-5-5`), with `thinking: { type: 'between_tools' }`, no
  `temperature` (Sonnet 5.5 returns a 400 for a non-default one) and `max_tokens: 1000`. Change all three together.

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
