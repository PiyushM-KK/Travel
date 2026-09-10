#!/usr/bin/env bash
# sync-gh-secrets.sh — push the secrets the scheduled workflows need from the local
# .env into GitHub *repository secrets*.
#
# The GitHub Actions (package-post, video-post) cannot read .env — they read repo
# secrets. This copies the values across WITHOUT printing them: each value is piped
# to `gh secret set` on stdin, so it never appears in the terminal, in your shell
# history, or in the process list.
#
#   bash social-automation/sync-gh-secrets.sh          # sync everything below
#   bash social-automation/sync-gh-secrets.sh --dry    # just show what WOULD sync
#
# Safe to re-run: setting an existing secret simply overwrites it.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "no .env here"; exit 1; }
command -v gh >/dev/null || { echo "gh CLI not found"; exit 1; }

KEYS=(
  HF_CREDENTIALS HF_API_KEY_ID HF_API_KEY_SECRET
  BLOB_READ_WRITE_TOKEN ANTHROPIC_API_KEY OPENAI_API_KEY
  META_PAGE_TOKEN META_PAGE_ID META_IG_USER_ID
  AIRTABLE_API_KEY AIRTABLE_BASE_ID
  WHATSAPP_PHONE_NUMBER_ID WHATSAPP_TOKEN WHATSAPP_TO
  CRON_SECRET
)
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
set +e
for k in "${KEYS[@]}"; do
  # take the last non-comment definition; strip surrounding quotes
  v=$(grep -E "^${k}=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  if [ -z "$v" ]; then printf '  %-28s SKIP (empty in .env)\n' "$k"; continue; fi
  if [ "$DRY" = "1" ]; then printf '  %-28s would sync (%d chars)\n' "$k" "${#v}"; continue; fi
  if printf '%s' "$v" | gh secret set "$k" >/dev/null 2>&1; then
    printf '  %-28s synced\n' "$k"
  else
    printf '  %-28s FAILED\n' "$k"
  fi
done
set -e
echo
echo "Repo secrets now set:"
gh secret list
echo
echo "Optional: to AUTO-POST reels instead of holding them for approval, run:"
echo "  gh variable set SOCIAL_VIDEO_LIVE --body true"
