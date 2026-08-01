# Tour Package Updates — drop PDFs here

Put the tour-package PDF files in **this folder**, then tell the assistant "added" (or list
the filenames). The assistant will:

1. Read each PDF and extract package details (name, destination/region, nights, "from ₹"
   price, highlights, inclusions, itinerary notes).
2. Show a summary of what it parsed for you to confirm.
3. **ADD** the packages to the correct site files based on each package's **destination**
   — **never replacing or deleting** any existing package:
   - Domestic destinations → `Domestic.dc.html`
   - International destinations → `International.dc.html`
   - New homepage cards / detail pages → `index.html` + `Destination.dc.html` (where relevant)
4. Wire a compact package catalog into the AI chat agent's system prompt
   (`server/anthropic-chat-worker.js`) so it can recommend them and quote "from" prices.
   *(Remember: the Worker must be redeployed manually in the Cloudflare dashboard — git does
   not deploy it.)*

## Notes
- The PDFs themselves are **git-ignored** (see `.gitignore` in this folder) so they are NOT
  committed to the public repo. If you WANT them tracked in the repo, tell the assistant and
  it will remove that ignore.
- Any file format the PDFs use is fine — clear tables or plain text both work. If a package
  is missing a field (e.g. price), the assistant will flag it rather than guess.
