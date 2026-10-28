/**
 * publish-report.js — after a manual publish run (.github/workflows/publish-now.yml), tell the owner on WhatsApp
 * which posts were held or failed in the last few hours and WHY (owner 2026-10-28: a run said "failed 1, held 1"
 * and the reasons were only in the store). The reasons go to the owner's WhatsApp, never to the public Actions log,
 * which gets counts only. Read-only on the queue; one text message.
 *
 *   node automation/publish-report.js [hours=3]
 */

const WINDOW_H = Number(process.argv[2]) || 3;

async function report(o = {}) {
  const { makeStore } = require("./run");
  const { redact } = require("../engine/publish");
  const store = o.store || makeStore().store;
  const now = o.now ? o.now() : Date.now();
  const since = now - WINDOW_H * 3600 * 1000;
  const rows = [];
  for (const status of ["failed", "held"]) {
    for (const r of (await store.listByStatus(status)) || []) {
      if (Date.parse(r.updatedAt || r.createdAt || 0) >= since) rows.push(r);
    }
  }
  if (!rows.length) return { count: 0 };
  const { shortCode } = o.wa || require("./whatsapp");
  const lines = rows.map((r) => `• ${shortCode(r.id)} ${String(r.subject || r.hint || "").slice(0, 50)} [${r.status}]: ${redact(String(r.lastError || "no reason recorded")).slice(0, 220)}`);
  const text = `📋 Publish run: ${rows.length} post(s) did not go out:\n${lines.join("\n")}\n\nFailed posts retry on the next run; held ones need a look.`;
  const wa = o.wa || require("./whatsapp");
  await wa.sendText((o.env || process.env).WHATSAPP_TO, text.slice(0, 3900));
  // the public log gets the error CLASS only: no subject or caption; long digit runs (account / media ids) masked
  const reasons = rows.map((r) => `${r.status}: ${redact(String(r.lastError || "")).replace(/\d{6,}/g, "#").replace(/(proj|org|act)_\w+/g, "$1_...").slice(0, 160)}`);
  return { count: rows.length, failed: rows.filter((r) => r.status === "failed").length, held: rows.filter((r) => r.status === "held").length, reasons };
}

module.exports = { report };

if (require.main === module) {
  report().then((r) => { console.log(JSON.stringify({ evt: "publish_report", ...r })); })
    .catch((e) => { console.error(JSON.stringify({ evt: "publish_report_error", error: require("../engine/publish").redact(String((e && e.message) || e)).slice(0, 200) })); process.exit(1); });
}
