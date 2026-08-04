/**
 * clients.js — Skyline's client registry (vendored from the firm platform,
 * then adapted to THIS repo).
 *
 * REPO-SPLIT RULE: this is Skyline's OWN instance. It registers only Skyline —
 * it does NOT carry the firm's fictional restaurant demo (that stays in the
 * FullFirm repo). Skyline's facts/voice live one level up in `../facts.js` and
 * `../profile.js`; its creds come from env (SKYLINE_* / META_*), never code.
 *
 * SAFETY: publishing needs ALL of SOCIAL_LIVE=true + this client's live:true +
 * a real page token (see run.js). Marking Skyline live:true does NOT publish on
 * its own — with no token, or SOCIAL_LIVE unset, run.js only ever dry-runs.
 */

const { buildFactBase } = require("../engine/kb-adapter");

/** Read a client's Meta creds from env by prefix, so tokens never live in code. */
function credsFromEnv(prefix) {
  return {
    igUserId: process.env[`${prefix}_IG_USER_ID`],
    pageId: process.env[`${prefix}_PAGE_ID`],
    pageToken: process.env[`${prefix}_PAGE_TOKEN`],
  };
}

const REGISTRY = {
  // Skyline Travel Planner — the real client this repo belongs to. Its facts and
  // brand voice are the SINGLE SOURCE beside this framework; the vendored engine
  // reads them. live:true means "allowed to publish" — but the triple-gate in
  // run.js still holds it to a dry run until SOCIAL_LIVE=true AND a real
  // SKYLINE_PAGE_TOKEN exist. Prefer SKYLINE_* creds; fall back to bare META_*
  // (the firm site currently publishes Skyline via META_* — same account).
  skyline: {
    label: "Skyline Travel Planner",
    live: true,
    language: "en",
    load() {
      const { BUSINESS } = require("../facts");
      const { PROFILE } = require("../profile"); // travel vertical + price-hedge on
      const facts = buildFactBase(BUSINESS);
      const creds = credsFromEnv("SKYLINE");
      // Fall back to the plain META_* creds if SKYLINE_* aren't set (the firm
      // site publishes Skyline under META_* today — same IG/Page).
      if (!creds.pageToken) {
        creds.igUserId = creds.igUserId || process.env.META_IG_USER_ID;
        creds.pageId = creds.pageId || process.env.META_PAGE_ID;
        creds.pageToken = process.env.META_PAGE_TOKEN;
      }
      return { facts, profile: PROFILE, creds };
    },
  },
};

/**
 * Resolve a client id to { id, label, live, language, facts, profile, creds }.
 * Throws a clear error if the id is unknown or its data can't be loaded.
 */
function loadClient(clientId) {
  const entry = REGISTRY[clientId];
  if (!entry) throw new Error(`unknown client "${clientId}" (registered: ${Object.keys(REGISTRY).join(", ")})`);
  const loaded = entry.load();
  return {
    id: clientId,
    label: entry.label,
    live: !!entry.live,
    language: entry.language || "en",
    facts: loaded.facts,
    profile: loaded.profile,
    creds: loaded.creds || {},
  };
}

module.exports = { loadClient, credsFromEnv, REGISTRY };
