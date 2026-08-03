/**
 * social-playbook.js — the firm's shared SOCIAL-MEDIA EXPERTISE.
 *
 * This is how the agents are "trained": we can't fine-tune the model, but injecting
 * a strong, specific best-practices base into every agent's system prompt makes their
 * judgement expert instead of generic. ONE source of truth so the caption writer, the
 * Social Media Manager, the creative review and the QA agent all reason from the same
 * playbook — and improving it improves every agent at once.
 *
 * Kept deliberately dense (it rides inside a system prompt). Grounded in what works for
 * small LOCAL hospitality/travel businesses on Instagram + Facebook, incl. the GTA
 * South-Asian + India market this firm serves.
 */

const SOCIAL_PLAYBOOK = `SOCIAL-MEDIA PLAYBOOK (Instagram + Facebook, small local business)

CRAFT
- HOOK: the first line must stop the scroll — lead with the benefit, a vivid image, a real question, or the offer itself. Never open with "We are excited to announce".
- ONE CTA: exactly one clear next step (Call, Book, Order, DM "BOOK", Visit, Link in bio). Two CTAs read as none.
- SCANNABLE: front-load the point — Instagram hides caption text after ~125 characters. Short lines, a break between thoughts, no wall of text.
- VALUE OVER SELL: give something — a tip, a story, behind-the-scenes, why it matters — not just "buy now". Aim ~80% value, ~20% ask.
- SPECIFIC BEATS GENERIC: "hand-rolled at 6am" beats "made with love"; "3 nights, airport pickup included" beats "amazing package". Concrete detail earns trust.

HASHTAGS
- INSTAGRAM: 3-8 RELEVANT tags — mix niche + LOCAL (e.g. #BramptonEats, #GTAFood, #HimachalTourism) + one branded. Not 30 generic tags, not #followforfollow.
- FACEBOOK: 1-3 at most; hashtags do little there.

PLATFORM DIFFERENCE
- INSTAGRAM: visual-first, aspirational, aesthetic; emoji ok but sparing; the image/Reel carries it.
- FACEBOOK: community + detail; links work; events and longer text are fine; skews local/older.

EMOJI: purposeful, 1-4, to punctuate — never to replace words or decorate every line.

TRUST + ACCURACY (non-negotiable)
- Every price, date, set of hours and offer must be EXACTLY right — "close" is a liability, and wrong info erodes the client's trust.
- Honest imagery only — real products/places, never faked or misrepresented.
- No fake urgency, no clickbait that misleads, no ALL-CAPS shouting.

REGIONAL / CULTURAL (GTA + India)
- Festivals are prime moments — Diwali, Holi, Navratri, Eid, Christmas, New Year — tie a post to the season only when it's genuine to the business.
- Regional language (Hindi / Gujarati / a natural mix) resonates strongly with the South-Asian community; keep it natural and idiomatic, not translated-sounding, and get the cultural detail right.

ACCESSIBILITY
- Don't bury the key info in the image alone — some people won't see it; state the offer/date/CTA in the caption too. Favour readable contrast.

ANTI-PATTERNS (avoid): walls of text, 20+ hashtags, "link in bio" with no link, engagement-bait ("tag 5 friends"), stock-photo clichés, and promising anything the business can't actually deliver.`;

/** A short platform-specific nudge to append when the platform is known. */
function playbookFor(platform) {
  const p = String(platform || "").toLowerCase();
  if (p === "instagram") return SOCIAL_PLAYBOOK + `\n\nTHIS POST IS FOR INSTAGRAM: visual-first, front-loaded caption, 3-8 niche+local hashtags, sparing emoji.`;
  if (p === "facebook") return SOCIAL_PLAYBOOK + `\n\nTHIS POST IS FOR FACEBOOK: community tone, detail + a link are fine, 0-3 hashtags.`;
  return SOCIAL_PLAYBOOK;
}

module.exports = { SOCIAL_PLAYBOOK, playbookFor };
