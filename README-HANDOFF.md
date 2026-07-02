# Skyline Travel Planner — Developer Handoff

This package contains the full Skyline Travel Planner website prototype. Follow this
guide to run it in VS Code and to hand the work off to another developer / AI assistant.

---

## 1. What's inside

| File / folder | What it is |
|---|---|
| `Home.dc.html` | Homepage — hero slideshow, search categories, destination cards, Uttarakhand slideshow, package styles, footer, cookie banner |
| `Domestic Tours.dc.html` | Domestic tours listing |
| `Flights.dc.html` / `Trains.dc.html` / `Buses.dc.html` | Referral pages that link out to official providers (no payments) |
| `Hotels.dc.html` | 3/4/5-star hotel category page |
| `Package.dc.html` | Individual package page template |
| `Customize.dc.html` | Customized-package enquiry form (main lead capture) |
| `Privacy.dc.html` | Privacy & Cookie policy |
| `WhatsApp.dc.html` | WhatsApp-style AI chat bot (uses the account profile picture) |
| `AssistantWidget.dc.html` / `Chatbot.dc.html` | Floating "Ask Skyline AI" assistant |
| `Home-standalone.html` | Single self-contained file (all images baked in) — opens offline, good for quick sharing |
| `support.js` | Runtime that powers the `.dc.html` Design Components — **required**, do not delete |
| `image-slot.js` | Drag-and-drop image placeholder web component |
| `images/` | All destination photos + header banner (permanent, baked into the site) |
| `server/` | Node.js WhatsApp bot server code (ChatGPT and Claude versions) |

> The `.dc.html` files are **Design Components**. Each is a normal HTML file that loads
> `support.js`. They must be served over **http://** (a local web server) — opening them
> with `file://` (double-click) will show a blank page because the browser blocks the
> component scripts.

---

## 2. Run it in VS Code

1. Open the folder in VS Code (`File → Open Folder…`).
2. **Easiest:** install the **Live Server** extension (by Ritwick Dey). Right-click
   `Home.dc.html` → **"Open with Live Server"**. It opens at something like
   `http://127.0.0.1:5500/Home.dc.html`.
3. **Or use a terminal** (no extension needed) — in the project folder run one of:
   ```bash
   # Python (built into macOS)
   python3 -m http.server 8000
   ```
   Then open **http://localhost:8000/Home.dc.html** in your browser.
   ```bash
   # or Node, if you prefer
   npx serve .
   ```

The homepage links to every other page, so start from `Home.dc.html`.

---

## 3. Editing

- Everything is **plain HTML with inline styles** — no build step, no npm install for the
  website itself. Edit a `.dc.html` file, save, refresh the browser.
- Each `.dc.html` has two parts: the markup (top) and a `<script type="text/x-dc">` logic
  class at the bottom (holds the data arrays, slideshow timers, language translations).
- **Images are permanent** — they live in `images/` and are referenced directly. To swap a
  photo, replace the file in `images/` (keep the same filename) or add a new one and update
  the path in the relevant `.dc.html`.
- **Languages:** English / Hindi / Gujarati strings live in the `translations` object inside
  `Home.dc.html`'s logic class.

---

## 4. The AI chatbots (important)

The chatbots reply using a built-in AI engine that only works **inside the design preview
environment**. On your own server / domain they will load and look correct, but **the AI
replies will not work until you connect a real AI backend.**

The `server/` folder has ready-to-deploy Node.js code for that:
- `whatsapp-claude-bot.js` — runs on Claude (Anthropic)
- (ChatGPT version if present) — runs on OpenAI

Each file's header comment has full setup steps (Meta WhatsApp Business Platform + API key).
The API key must live on the server, never in the website code.

---

## 5. Going live

1. Buy your domain (e.g. on Hostinger) — `skylinetravelplanner.com`.
2. Upload all files (keep the folder structure) to `public_html`.
3. Rename `Home.dc.html` → `index.html` (or set it as the default document) so the domain
   opens on the homepage. Update the header logo link and inter-page links accordingly.
4. Deploy the `server/` bot separately (Node host) and point the WhatsApp buttons at your
   real number once it's live.

Free alternatives for a permanent link while you set up the domain: **Netlify** or
**Cloudflare Pages** (drag-and-drop the folder).

---

## 6. Handoff prompt (paste this into Claude Code / another AI in VS Code)

```
I'm continuing work on the "Skyline Travel Planner" website — an India-focused travel
discovery, affiliate-referral and customized-tour-enquiry site. NO payments, checkout, or
ticket issuance happen on the site; it refers users to official providers (Air India,
IndiGo, IRCTC, redBus, Booking.com, etc.) and captures customized-package enquiries via a
form and WhatsApp.

TECH: The pages are "Design Components" — plain .html files (named *.dc.html) that load a
runtime called support.js and use INLINE STYLES ONLY (no CSS classes, no stylesheets, no
build step). Each file has markup at the top and a <script type="text/x-dc"> logic class
at the bottom holding data arrays, slideshow timers, and English/Hindi/Gujarati
translations. Serve over http:// (Live Server or `python3 -m http.server`), never file://.

DESIGN: Fresh & modern — clean layout, sky-blue (#0a5fd7) primary, warm sky-to-sand
gradient body background, Plus Jakarta Sans + Bricolage Grotesque fonts. Images live in
images/ and are permanent (referenced directly). The homepage has a crossfading hero photo
slideshow, a header banner (ocean/beach panorama), and an Uttarakhand card that cycles 4
photos with a transparent place-name label.

RULES: The AI chatbots must never confirm tickets, process payments, guarantee availability
/prices/visas, or give immigration advice, and must never ask for card/bank/Aadhaar/passport
details. Prices are always INR "starting from" estimates, never guaranteed. Keep the
"no payments on this website" disclosure.

Start by opening Home.dc.html to understand the structure, then help me with: [DESCRIBE
YOUR TASK].
```

---

Questions or a specific next feature (e.g. the International Tours page, or wiring the
chatbot to a live server)? Just ask.
