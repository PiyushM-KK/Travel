# Handover Prompt

Paste the block below into a new Claude Code / AI session to bring it fully up to speed on this project.

---

```
I'm continuing work on "Skyline Travel Planner" — an India-focused travel discovery,
affiliate-referral and customized-tour enquiry website. NO payments, checkout, or ticket
issuance happen on the site; it refers users to official providers (Air India, IndiGo,
IRCTC, redBus, Booking.com) and captures enquiries via a form + WhatsApp.

FIRST, BEFORE ANY EDIT:
1. Run `git pull`. This repo is edited from more than one place (Copilot / other agents),
   so always sync before touching anything.
2. Read HANDOVER.md (technical detail, how-to-update, and §10 source-of-truth rules) and
   MEMORY.md (status log of what changed and when). They are the authority; this prompt is
   only a summary.

LIVE / REPO
- Live site: https://piyushm-kk.github.io/Travel/
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
Edit files → `git add -A && git commit -m "..." && git push`.
Push auth: a GitHub token lives in the gitignored `.env` (GITHUB_TOKEN=). Pushes use a temporary
tokenized remote, then reset the remote back to the clean URL.
GitHub Pages rebuilds in ~1 min and caches files 10 min (max-age=600) — hard-refresh
(Ctrl+Shift+R) or use a private window to verify.

AI CHAT BACKEND — NOT DEPLOYED BY GIT
The floating "Ask Skyline AI" widget (AssistantWidget.dc.html, `aiEndpoint`) POSTs {messages:[...]}
to a Cloudflare Worker at https://hello-world.skyline-dev.workers.dev running
`server/anthropic-chat-worker.js` (Claude model `claude-haiku-4-5`) and receives {reply}.
- ANTHROPIC_API_KEY is an encrypted Cloudflare Worker secret (never in the repo).
- ⚠️ To change the AI model/prompt/logic you MUST paste the file into the Cloudflare dashboard →
  the Worker → Edit code → Deploy. `git push` does NOT update the Worker.
- Health check: open the Worker URL in a browser (GET) → {version, model, hasKey}.
- Behavior already baked in: replies in the user's language (EN/HI/GU); budget is OPTIONAL (never
  pushes for money); a price-disclaimer note is auto-appended whenever a reply quotes ₹/Rs/INR;
  CORS locked to the site's origins.
- Higher quality: change `const MODEL = 'claude-haiku-4-5'` → `'claude-sonnet-5'` and redeploy.

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
3. Custom domain skylinetravelplanner.com — buy on Hostinger, then add GitHub Pages DNS: four A
   records 185.199.108.153 / .109.153 / .110.153 / .111.153 on @, and CNAME www →
   piyushm-kk.github.io. Then add a CNAME file to the repo, set the domain in Pages settings and
   enable Enforce HTTPS.
4. Housekeeping: revoke old GitHub tokens; delete the unused OPENAI_API_KEY Cloudflare secret and
   server/openai-chat-worker.js (superseded by the Anthropic worker).
5. There is an unreviewed remote branch `copilot/travel-repo-link` on GitHub.

Start by running `git pull` and reading HANDOVER.md + MEMORY.md, then help me with:
[DESCRIBE YOUR TASK]
```
