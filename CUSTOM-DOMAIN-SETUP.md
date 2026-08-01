# Custom Domain Setup — skylinetravelplanner.com

How to point `skylinetravelplanner.com` at the site (currently live at
`https://piyushm-kk.github.io/Travel/`). The site stays reachable on the github.io URL the
whole time until the final switch, so there's no downtime if you follow the order.

---

## Current state (checked 2026-08-01, via Verisign RDAP)

- ✅ Domain **is registered** — registrar **Squarespace Domains II LLC** (IANA ID 895), the
  former **Google Domains**. Manage/renew it at **Squarespace** (`account.squarespace.com` →
  Domains). Registered 2017-11-09, **expires 2026-11-09** (renew soon).
- ⚠️ Nameservers are **Google Cloud DNS** (`ns-cloud-d1…d4.googledomains.com`) — DNS is **not
  on Cloudflare** yet.
- ⚠️ Domain status is **`clientTransferProhibited` (transfer-locked)**. A *nameserver change*
  (Route A) does NOT require unlocking; a *full registrar transfer* (A3) does — unlock it and
  get the EPP code at Squarespace first.
- ⚠️ **No GitHub Pages records** are set yet, and the domain does **not serve the site**
  (`https://skylinetravelplanner.com` returns no response).

## Choose a route

| Route | What it is | Pick this if |
|-------|-----------|--------------|
| **A — via Cloudflare** *(recommended)* | Move DNS to Cloudflare, then add GitHub Pages records there | You want DNS + SSL + your AI **Worker** all in one dashboard (the Worker already lives in Cloudflare) |
| **B — stay on current registrar** | Just add GitHub Pages records in the existing Google/Squarespace DNS | You want the site live fastest with no nameserver change |

Both routes end at the **same shared steps** (CNAME file → Pages settings → HTTPS).

> ⚠️ **Order matters:** do NOT add the `CNAME` file to the repo until **after** DNS resolves
> (the shared steps say when). Adding it early makes GitHub Pages serve only the custom
> domain and can break the github.io URL before DNS is ready.

The GitHub Pages DNS records are identical in both routes:

| Type  | Name (Host) | Value / Points to        |
|-------|-------------|--------------------------|
| A     | `@`         | `185.199.108.153`        |
| A     | `@`         | `185.199.109.153`        |
| A     | `@`         | `185.199.110.153`        |
| A     | `@`         | `185.199.111.153`        |
| CNAME | `www`       | `piyushm-kk.github.io`   |

(The four A records are GitHub Pages' fixed anycast IPs. The `www` CNAME points to the
**user** subdomain `piyushm-kk.github.io`, NOT the `/Travel/` path.)

---

## Route A — via Cloudflare (recommended)

Use the **same Cloudflare account** your AI Worker already lives in.

### A1. Move the domain's DNS to Cloudflare
1. Cloudflare dashboard → **Add a site** → enter `skylinetravelplanner.com` → **Free** plan.
2. Cloudflare **scans existing DNS** and imports records. Review → **Continue**.
3. Cloudflare shows **two nameservers** (e.g. `xxx.ns.cloudflare.com`). Copy both.
4. Go to your current registrar (**Google Domains / Squarespace**) → domain → **Nameservers**
   → replace Google's `ns-cloud-*` with Cloudflare's two.
5. Back in Cloudflare → **Done, check nameservers**. Propagation takes minutes–24h;
   Cloudflare emails you when the site is **Active**.

### A2. Add the GitHub Pages records
In Cloudflare **DNS → Records**, add the five records from the table above.

⚠️ **The #1 gotcha — keep them "DNS only" (grey ☁, not orange).** GitHub Pages must see the
real DNS to issue its HTTPS certificate. Proxying (orange cloud) too early, or setting
**SSL/TLS = Flexible**, causes a redirect loop or cert error. Leave the records on **DNS
only** and let GitHub handle HTTPS. *Later* you may switch to proxied **only if** you also
set **SSL/TLS → Full** (never *Flexible*).

### A3. (Optional, later) Full registrar transfer to Cloudflare
Only if you also want billing/registration at Cloudflare. Requirements: domain **60+ days**
old, already on Cloudflare DNS (A1 done), and **unlocked** with its **EPP / Auth code** from
the current registrar. Then Cloudflare → the domain → **Registrar / Transfer** → paste EPP
code → confirm contacts → pay the at-cost fee → approve the email (old registrar can take up
to 5 days).

Then continue to **Shared steps** below.

---

## Route B — stay on the current registrar (no Cloudflare)

1. Sign in to **Google Domains / Squarespace** (wherever the domain is managed).
2. Open the **DNS** settings for `skylinetravelplanner.com`.
3. Delete any default "parking" record on `@`, then add the five records from the table above.
4. Check propagation:
   ```
   nslookup skylinetravelplanner.com
   ```
   You want it to return the four `185.199.*` IPs.

Then continue to **Shared steps** below.

---

## Shared steps (both routes)

### S1. Add the CNAME file to the repo
Once the DNS above resolves, create a file named exactly `CNAME` (no extension) in the repo
root containing one line, then commit + push (see HANDOVER.md §4):
```
printf 'skylinetravelplanner.com\n' > CNAME && git add CNAME && git commit -m "chore: add custom domain CNAME" && git push
```

### S2. Set the domain in GitHub Pages
GitHub repo → **Settings → Pages → Custom domain** → enter `skylinetravelplanner.com` → Save.
GitHub re-checks DNS (green check when good).

### S3. Enforce HTTPS
Same Pages settings page → tick **Enforce HTTPS** (appears once GitHub has issued the TLS
certificate). Done — the site serves securely at `https://skylinetravelplanner.com`.

---

## After the domain is live — don't forget
1. **AI worker CORS is already ready.** `server/anthropic-chat-worker.js` already allows
   `https://skylinetravelplanner.com` and `https://www.skylinetravelplanner.com`, so the chat
   widget keeps working. No worker change needed.
   - *(Route A bonus, optional):* with DNS on Cloudflare you could later expose the Worker at
     e.g. `api.skylinetravelplanner.com` (Workers → Triggers → Custom domain) and point the
     widget's `aiEndpoint` there instead of the `.workers.dev` URL. Not required.
2. **Update absolute URLs.** The SEO/OG `og:url` / canonical tags in the page `<head>`s point
   at the github.io URL. Update them to the custom domain for correct social previews + SEO:
   ```
   grep -rn "piyushm-kk.github.io" --include="*.html" .
   ```
3. The old `https://piyushm-kk.github.io/Travel/` URL will **redirect** to the custom domain
   automatically — existing links keep working.
