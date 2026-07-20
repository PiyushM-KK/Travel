# Skyline Travel Planner — Technical Handover

_Last updated: 2026-07-02. This supersedes the original `README-HANDOFF.md` for current state, deployment, and how-to-update instructions._

---

## 1. What this site is

An India-focused **travel discovery + affiliate-referral + customized-tour enquiry** website.
**No payments, checkout, or ticket issuance happen on the site.** It refers users to official
providers (Air India, IndiGo, IRCTC, redBus, Booking.com, etc.) and captures "Customize My Trip"
enquiries via a form + WhatsApp.

- **Live URL:** https://piyushm-kk.github.io/Travel/
- **GitHub repo:** `PiyushM-KK/Travel` (public), branch `main`
- **Hosting:** GitHub Pages (branch `main`, root `/`, `.nojekyll` present)
- **Languages:** English / Hindi / Gujarati
- **Brand:** primary sky-blue `#0a5fd7` / `#0A84D6`, accent orange `#FF6A3D`; fonts Plus Jakarta Sans + Bricolage Grotesque; warm sky-to-sand gradient page background.

---

## 2. Tech / architecture (important)

The pages are **"Design Components"** — plain `.html` files (named `*.dc.html`, plus `index.html`)
that use **inline styles only** and load a runtime called **`support.js`**. `support.js` pulls
**React + Babel from the unpkg CDN at runtime** and renders the page client-side. Each file has
markup at the top and a `<script type="text/x-dc">` logic class at the bottom (data arrays,
slideshow timers, translations). Must be served over **http(s)://**, never `file://`.

Implication: the site is client-rendered. That's why SEO/social tags were added to the real
`<head>` (crawlers that don't run JS can still read them).

---

## 3. Pages

| File | Purpose |
|---|---|
| `index.html` | Homepage (renamed from `Home.dc.html` for GitHub Pages). Hero slideshow, categories, destinations, responsive nav + mobile hamburger, footer, cookie banner |
| `Domestic.dc.html` | Domestic tours (renamed from `Domestic Tours.dc.html` — space removed) |
| `International.dc.html` | International tours — **created this project** (Thailand, Bali, Maldives) |
| `Destination.dc.html` | **Created this project** — per-destination detail page. Reads `?dest=<slug>`; homepage cards link here. Content data for all 12 destinations lives in its `data()` method (top places, best time, duration, "from ₹X", highlights, hotel tiers, CTA) |
| `Customize.dc.html` | Customized-package enquiry form — **main lead capture** (Formspree + WhatsApp) |
| `Flights / Trains / Buses / Hotels.dc.html` | Referral pages linking to official providers |
| `Package.dc.html` | Individual package template |
| `Privacy.dc.html` | Privacy & Cookie policy |
| `AssistantWidget.dc.html` | Floating "Ask Skyline AI" chat bot (imported on pages) — wired to live Claude backend |
| `Chatbot.dc.html`, `WhatsApp.dc.html` | Older simulated chat pages — **now unused/unlinked** (all chat buttons go to real `wa.me`) |
| `Home-standalone.html` | Single self-contained homepage (offline sharing) |
| `support.js`, `image-slot.js` | Runtime (required) + drag-drop image placeholder component |
| `images/` | All photos + logo + header banner |
| `server/` | Backend code (see §6) |

---

## 4. How to update the SITE (content, text, pages)

1. Edit the relevant `.dc.html` / `index.html` file (markup at top, logic class at bottom).
2. Commit and push:
   ```
   git add -A
   git commit -m "your message"
   git push
   ```
   Auth for push: the GitHub token lives in the gitignored **`.env`** (`GITHUB_TOKEN=`). Pushes use a
   temporary tokenized remote, then reset to the clean URL. (If `.env` is empty, put a valid GitHub
   token with `repo` scope back in it first.)
3. GitHub Pages auto-rebuilds in ~1 minute.
4. **Pages caches files for 10 min** (`max-age=600`). To see changes immediately, hard-refresh
   (**Ctrl+Shift+R**) or use a private window.

---

## 5. How to update IMAGES & BACKGROUND (tomorrow's task)

**Images** live in `images/` and are referenced directly by filename.

- **Swap a photo:** replace the file in `images/` keeping the same filename (e.g. overwrite
  `images/dest-goa.jpg`) — no code change needed. Or add a new file and update its path in the
  relevant `.dc.html`.
- **Homepage hero slideshow:** the `heroImages` array inside `index.html`'s logic class
  (`state = { heroImages: [ 'images/dest-maldives.webp', ... ] }`). Add/remove/reorder paths there.
- **Header banner** (translucent photo behind the top bar): `images/header-banner.jpg`, set in the
  `<header>` `background-image` on `index.html`.
- **Uttarakhand card** cycles `images/uttarakhand-pine.jpg | -ridge.jpg | -waterfall.jpg` +
  `dest-uttarakhand.jpg`.
- **Destination cards:** `images/dest-*.jpg/.webp/.avif` (rajasthan, himachal, kashmir, kerala, goa,
  ooty, mysuru, agra, thailand, bali, maldives, uttarakhand).
- **Domestic package cards** currently reuse real `dest-*`/`uttarakhand-*` images as stand-ins for a
  few destinations without a dedicated photo (Gujarat, the 3 Sikkim/Darjeeling packages, South Temple
  Trail). Add real photos by dropping files in `images/` and updating the `img:` paths in
  `Domestic.dc.html`'s `collections` data.
- **Logo:** `images/logo.png` (used via `image-slot`) and `images/logo.jpeg` (used as `<img>` on some
  headers). Header logo height standardized to `48px`.

**Background:** the page background is a CSS gradient in each file's `<style>` block:
```css
body { background: linear-gradient(180deg, #e9f2fb 0%, #f5efe6 45%, #f3ede3 100%); background-attachment: fixed; }
```
To change it, edit that `body { background: ... }` rule. It appears once per page file — update each
page (or at least `index.html`) for a consistent look. To use a background **image** instead of a
gradient, replace with e.g. `background: url('images/your-bg.jpg') center/cover fixed;`.

After any image/background change: commit + push (§4), then hard-refresh.

---

## 6. Backends (`server/`)

### AI chat — LIVE (Cloudflare Worker + Claude)
- **File:** `server/anthropic-chat-worker.js` (Anthropic/Claude, model `claude-haiku-4-5`).
- **Deployed to:** a Cloudflare Worker at **`https://hello-world.skyline-dev.workers.dev`**.
- The website's floating "Ask Skyline AI" widget (`AssistantWidget.dc.html`, `aiEndpoint`) POSTs
  `{messages:[...]}` to that Worker and gets `{reply}` back. If the Worker is unreachable, the widget
  falls back to a "Chat on WhatsApp" button.
- **Secret:** `ANTHROPIC_API_KEY` is stored as an **encrypted Worker secret in Cloudflare** — never in
  the repo. Get/rotate keys at console.anthropic.com.
- **Behavior baked into the Worker prompt/code:** replies in the user's language; INR "starting from"
  estimates only; **budget is optional** (never pushes for money); a **price-disclaimer note** is
  appended automatically whenever a reply quotes ₹/Rs/INR; never confirms bookings/payments/visas;
  never asks for card/bank/Aadhaar/passport.
- **CORS** is locked to the site origins (github.io + the future custom domain).
- **⚠️ Updating the Worker is NOT git-based.** To change the AI model, prompt, or logic: edit
  `server/anthropic-chat-worker.js`, then in the Cloudflare dashboard open the Worker → **Edit code**
  → paste the whole file → **Deploy**. Health check: open the Worker URL in a browser (GET) → returns
  `{version, model, hasKey}`.
- To use a higher-quality model: change `const MODEL = 'claude-haiku-4-5'` → `'claude-sonnet-5'` and redeploy.

### WhatsApp bots (not deployed)
- `server/whatsapp-claude-bot.js` / `server/whatsapp-chatgpt-bot.js` — ready-to-deploy WhatsApp
  Business webhook bots (optional; only if you want automated WhatsApp replies). Not currently used.
- `server/openai-chat-worker.js` — an earlier OpenAI version of the web-chat Worker; **superseded by
  the Anthropic one, unused.** Can be deleted.

---

## 7. Lead capture (Customize form)
- `Customize.dc.html` submits to **Formspree** (endpoint is in the file, `formEndpoint`) → enquiries
  arrive by email. It also offers a **WhatsApp** button that opens `wa.me/918866050291` with the trip
  details prefilled. Basic validation requires name + phone/email.
- WhatsApp number used site-wide: **+91 88660 50291** (`wa.me/918866050291`).

---

## 8. Secrets — where they live (NEVER commit these)
| Secret | Location |
|---|---|
| GitHub push token | local `.env` → `GITHUB_TOKEN=` (gitignored) |
| Anthropic API key | Cloudflare Worker secret `ANTHROPIC_API_KEY` |
| Formspree form ID | in `Customize.dc.html` (not sensitive; public by design) |

---

## 9. Pending / next steps
- **Tomorrow:** update images / background (see §5).
- **Custom domain** `skylinetravelplanner.com`: buy on Hostinger → add DNS: four A records
  `185.199.108.153 / .109.153 / .110.153 / .111.153` on `@`, and a `CNAME` `www` →
  `piyushm-kk.github.io`. Then add a `CNAME` file to the repo + set the domain in GitHub Pages
  settings + enable "Enforce HTTPS".
- **Housekeeping:** revoke the old GitHub tokens created earlier (fine-grained + classic); delete the
  unused `OPENAI_API_KEY` Cloudflare secret; optionally delete `server/openai-chat-worker.js`; you may
  delete local `.env` when not actively deploying.
- **Optional polish:** add real Domestic package photos; add `sitemap.xml`/`robots.txt`; pre-compile
  the site to drop the runtime unpkg/Babel dependency (needs the `dc-runtime` build tool, not in this
  repo); wire `Chatbot.dc.html`/`WhatsApp.dc.html` to the Worker if you want to use them.

---

## 10. ⚠️ Single source of truth (added 2026-07-10)

The repo previously drifted into duplicate pages. **Only edit the files marked SOURCE OF TRUTH:**

| Edit this ✅ | Do NOT edit 🔁 (redirect stub) |
|---|---|
| `index.html` — the live homepage GitHub Pages serves | `Home.dc.html` |
| `Domestic.dc.html` — 19 tour packages incl. North-East India | `Domestic Tours.dc.html` |

The stubs redirect (meta-refresh + `location.replace` + `rel=canonical` + `noindex`) so old links keep working. If you add content to a stub it will be invisible to users — put it in the source-of-truth file instead.

Other pages added by later work: `Cabs.dc.html` (cab/taxi section) and `live.html` (local auto-reloading dev preview). Backend helpers: `server/train-api.js` / `server/train-api.py` (live train search), `server/.env.example`.

**Before editing after any gap, always run `git pull` first** — this project is worked on from more than one place.
