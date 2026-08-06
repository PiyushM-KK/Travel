/**
 * ops-status.js — READ-ONLY operational health JSON for this client's automation (the /ops data source).
 *
 * The firm's monitoring dashboard (buildwise-digital.com/ops) fetches this per client and renders it.
 * It NEVER mutates anything — it only reads the Queue + Runs heartbeats + config + (optionally) the
 * Meta token. Fails closed: without an ops key configured (OPS_KEY, or the existing CRON_SECRET) it
 * refuses. CORS is restricted to the firm dashboard origins so a browser page can call it with a key.
 *
 * GET /api/ops-status            → the health snapshot
 * GET /api/ops-status?tokens=1   → also live-check the Meta Page token (slower; do it occasionally)
 * Auth: Authorization: Bearer <OPS_KEY|CRON_SECRET>
 */

const crypto = require("crypto");
const { makeStore } = require("../automation/run");
const { buildOpsStatus } = require("../automation/ops-status");
const { loadClient } = require("../automation/clients");
const { redact } = require("../engine/publish");

const ALLOWED_ORIGINS = [
  "https://buildwise-digital.com",
  "https://www.buildwise-digital.com",
  "http://localhost:3000",
];

function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  setCors(req, res);

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "method not allowed" }); return; }

  // Fail closed: an ops key must be configured, and the caller must present it.
  const key = process.env.OPS_KEY || process.env.CRON_SECRET;
  if (!key) { res.status(503).json({ error: "ops not configured — set OPS_KEY (or CRON_SECRET)" }); return; }
  if (!safeEqual(req.headers["authorization"], `Bearer ${key}`)) { res.status(403).json({ error: "forbidden" }); return; }

  try {
    const clientId = process.env.SOCIAL_CLIENT || "skyline";
    let label = clientId;
    try { const c = loadClient(clientId); label = c.label || c.id || clientId; } catch { /* label falls back to id */ }
    const { store } = makeStore();
    const checkTokens = /(?:[?&])tokens=1/.test(req.url || "");
    const status = await buildOpsStatus(store, {
      client: clientId,
      label,
      checkTokens,
      metaPageToken: process.env.META_PAGE_TOKEN,
    });
    res.status(200).json(status);
  } catch (e) {
    res.status(500).json({ error: redact(String((e && e.message) || e)) });
  }
};
