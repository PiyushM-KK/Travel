# Owner setup — the 3 things only you can do (unblocks chatbot Phase 2 / B-CHATBOT)

You do these 4 account tasks (grouped as 3 items); you hand me the **non-secret** values; the **secrets**
go into Vercel and never into chat or the repo. Then I build + wire the rest.

**Golden rule:** never paste a secret (client secret, token, API key) into the chat or a repo file.
Put secrets straight into the Vercel dashboard. Give me only: the **Client ID**, the **allow-list
usernames**, the chosen **project name / URL**. Everything here is on the repo **`PiyushM-KK/Travel`**.

Rough time: ~10–12 minutes total.

---

## ITEM 1 — GitHub OAuth App  (decides WHO can open the console)

1. Go to **https://github.com/settings/developers** (or: your avatar top-right → **Settings** →
   **Developer settings** in the far-left sidebar).
2. Click **OAuth Apps** → **New OAuth App** (button top-right; may say "Register a new application").
3. Fill in:
   - **Application name:** `Skyline Owner Console`
   - **Homepage URL:** `https://skyline-chatbot.vercel.app`
   - **Application description:** (optional) `Owner-only tool to update Skyline prices/packages/hotels`
   - **Authorization callback URL:** `https://skyline-chatbot.vercel.app/api/auth/callback`
   - **Enable Device Flow:** leave **unchecked**.
4. Click **Register application**.
5. On the app page, copy the **Client ID** → this is safe to send me.
6. Click **Generate a new client secret** → copy the **Client Secret** now (shown once). **Save it in a
   safe place; do NOT send it to me.** You'll paste it into Vercel in Item 3.

> If the deployed URL ends up different from `skyline-chatbot.vercel.app`, just come back to this page
> and edit **Homepage URL** + **Authorization callback URL** (keep the `/api/auth/callback` ending).

**Decide the allow-list** while you're here: the exact GitHub usernames allowed to log in — yours and the
Skyline owner's, e.g. `PiyushM-KK, skylineowner`. Send me these (they're not secret).

---

## ITEM 2 — the commit bot  (how approved edits reach the repo)

Recommended: a **fine-grained Personal Access Token** scoped to the one repo (simplest; secure).

1. Go to **https://github.com/settings/tokens?type=beta** (or: **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens**).
2. Click **Generate new token**.
3. Fill in:
   - **Token name:** `skyline-chatbot-commit-bot`
   - **Expiration:** `90 days` (set a calendar reminder to regenerate; or pick a longer custom date).
   - **Resource owner:** the account that owns the repo — **PiyushM-KK**.
   - **Repository access:** choose **Only select repositories** → in the dropdown pick **Travel** only.
4. **Permissions** → expand **Repository permissions** → set **Contents** to **Read and write**.
   (Leave every other permission at **No access**. "Metadata: Read-only" will auto-enable — that's fine.)
5. Click **Generate token** → copy the token (`github_pat_…`), shown once. **Save it safely; do NOT send
   it to me.** It goes into Vercel in Item 3 as `GH_BOT_TOKEN`.

> Sturdier alternative (no expiry, if you'd rather): a **GitHub App** installed on `PiyushM-KK/Travel`
> with **Contents: Read & write** → gives an App ID + Installation ID + a private key. More steps; ask me
> and I'll write them out. The fine-grained PAT above is perfectly fine to start.

---

## ITEM 3 — Anthropic API key + the Vercel project

### 3a. Anthropic API key (the AI brain)
1. Go to **https://console.anthropic.com** → sign in.
2. Left sidebar → **API Keys** → **Create Key** → name it `skyline-chatbot` → **Create**.
3. Copy the key (`sk-ant-…`). **Save it safely; do NOT send it to me.**
4. Recommended: **Settings → Limits** (or Billing) → set a small **monthly spend cap** (e.g. $10–20) so
   the bot can never run up a surprise bill.

### 3b. Vercel project (gives the chatbot its URL + holds the secrets)
1. Go to **https://vercel.com** → **Log in** → **Continue with GitHub**.
2. **Add New…** (top-right) → **Project**.
3. Find **PiyushM-KK/Travel** in the list → **Import**. (If the repo isn't listed, click **Adjust GitHub
   App Permissions** / **Configure GitHub App** and grant Vercel access to the `Travel` repo.)
4. In **Configure Project**:
   - **Project Name:** `skyline-chatbot`  (this makes the URL `https://skyline-chatbot.vercel.app`).
   - **Framework Preset:** **Other**.
   - **Root Directory:** click **Edit** → select **`pricing-portal`**.  ← important
   - Leave Build/Output commands default (I add the config in Phase 2).
5. Expand **Environment Variables** and add these (scope: **Production**; you can also tick Preview):

   | Name | Value |
   |---|---|
   | `GITHUB_OAUTH_CLIENT_ID` | Client ID from Item 1 |
   | `GITHUB_OAUTH_CLIENT_SECRET` | Client Secret from Item 1 |
   | `PORTAL_ALLOWED_LOGINS` | your allow-list, e.g. `PiyushM-KK,skylineowner` |
   | `GH_BOT_TOKEN` | the fine-grained PAT from Item 2 |
   | `ANTHROPIC_API_KEY` | the key from Item 3a |

6. Click **Deploy**. (This first deploy will be mostly empty / may 404 — that's expected; the code lands
   in Phase 2. We just need the project + URL to exist.)
7. After it finishes, note the **Production URL** at the top (should be `https://skyline-chatbot.vercel.app`).
   If it's different, go back to **Item 1** and update the OAuth App's Homepage + callback to match.

---

## Then send me (all non-secret)
- The **Client ID** (Item 1).
- The **allow-list usernames** (Item 1).
- The **final chatbot URL** (Item 3b step 7).

Keep the three secrets (**Client Secret, PAT, Anthropic key**) in the Vercel dashboard only — I don't
need to see them. With those, I build Phase 2: `lib/commit.js` (the bot), `api/auth/*` (GitHub login +
allow-list check), `agent/chatbot.js` (the Claude tool-use loop + PDF-vision ingestion), and the secured
`Chatbot.dc.html` console — then we do one real deploy and test it end-to-end.
