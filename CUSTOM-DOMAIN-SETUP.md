# Custom Domain Setup — skylinetravelplanner.com

Step-by-step to move the site from `https://piyushm-kk.github.io/Travel/` to your own
domain. **Do the steps in order.** The site stays live on the github.io URL the whole time
until the final switch, so there's no downtime risk if you follow the sequence.

> ⚠️ Do NOT add the `CNAME` file to the repo until **after** DNS is set (Step 2). Adding it
> early tells GitHub Pages to serve only the custom domain, which would break the live
> github.io URL before DNS is ready. The correct order is below.

---

## Step 1 — Buy the domain
Buy `skylinetravelplanner.com` on Hostinger (or any registrar). Nothing else to do here.

## Step 2 — Add DNS records (at the registrar / Hostinger DNS zone)
Add these **four A records** and **one CNAME record**. Delete any default "parking"
A record Hostinger auto-adds for `@` first.

| Type  | Name (Host) | Value / Points to        | TTL     |
|-------|-------------|--------------------------|---------|
| A     | `@`         | `185.199.108.153`        | default |
| A     | `@`         | `185.199.109.153`        | default |
| A     | `@`         | `185.199.110.153`        | default |
| A     | `@`         | `185.199.111.153`        | default |
| CNAME | `www`       | `piyushm-kk.github.io.`  | default |

(The four A records are GitHub Pages' fixed anycast IPs. The `www` CNAME must point to the
**user** subdomain `piyushm-kk.github.io`, NOT to the `/Travel/` path.)

DNS can take from a few minutes up to 24 hours to propagate. Check with:
```
nslookup skylinetravelplanner.com
```
You want it to return the four `185.199.*` IPs.

## Step 3 — Add the CNAME file to the repo
Once Step 2's DNS resolves, create a file named exactly `CNAME` (no extension) in the repo
root containing one line:
```
skylinetravelplanner.com
```
Then commit + push (see HANDOVER.md §4). Ready-to-use command:
```
printf 'skylinetravelplanner.com\n' > CNAME && git add CNAME && git commit -m "chore: add custom domain CNAME" && git push
```

## Step 4 — Set the domain in GitHub Pages settings
GitHub repo → **Settings → Pages → Custom domain** → enter `skylinetravelplanner.com` → Save.
GitHub will re-check DNS (green check when good).

## Step 5 — Enforce HTTPS
Same Pages settings page → tick **Enforce HTTPS** (may take a few minutes to become
available while GitHub issues the TLS certificate). Done — the site now serves securely at
`https://skylinetravelplanner.com`.

---

## After the domain is live — don't forget
1. **AI worker CORS is already ready.** `server/anthropic-chat-worker.js` already allows
   `https://skylinetravelplanner.com` and `https://www.skylinetravelplanner.com`, so the
   chat widget keeps working. No worker change needed.
2. **Update absolute URLs** if any: the SEO/OG `og:url` / canonical tags in the page
   `<head>`s currently point at the github.io URL. Search for `piyushm-kk.github.io` across
   the `.html` files and update to the custom domain for correct social-share previews and
   canonical SEO.
   ```
   grep -rn "piyushm-kk.github.io" --include="*.html" .
   ```
3. The old `https://piyushm-kk.github.io/Travel/` URL will now **redirect** to the custom
   domain automatically — existing links keep working.
