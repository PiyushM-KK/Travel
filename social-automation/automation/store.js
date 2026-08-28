/**
 * store.js — the content queue, and the single source of truth for state.
 *
 * WHY A STORE AT ALL: the automation runs on two independent platforms (GitHub
 * Actions primary, Vercel fallback) for business continuity. If state lived in
 * either platform, losing that platform would lose the queue. It lives here
 * instead — an external store both runners read and write — so either can run
 * the work and neither is a single point of failure.
 *
 * THE SAFETY MODEL (why two runners can't double-post):
 *   1. claim(): a runner atomically moves a row from its expected status into a
 *      "working" status with a claim token. A second runner that tries the same
 *      row sees it's no longer in the expected status and skips it.
 *   2. recorded post IDs: once a platform is posted, the row records that post's
 *      id. A publish never re-posts a platform that already has an id — even if
 *      a claim somehow raced. This is the real duplicate guard; the claim just
 *      avoids wasted work.
 *
 * Two implementations share this interface:
 *   - InMemoryStore  — for tests and local dev (used now).
 *   - AirtableStore  — wired when BLOCKED.md B-15 is done (create()d the same
 *     way; claim() uses read-write-verify since Airtable has no conditional
 *     update — best-effort, backed by the post-id guard above).
 */

const STATUSES = [
  "planned",         // intake created it; no caption yet
  "drafting",        // a generate runner has claimed it and is writing the caption
  "drafted",         // caption written + fact-checked; not yet shown to client
  "pending_approval",// sent to the client in a digest
  "approved",        // client said yes; eligible to publish
  "publishing",      // a runner has claimed it and is posting
  "published",       // all target platforms posted
  "failed",          // a publish attempt errored; will be retried
  "held",            // too many failures / needs a human; alerted
  "rejected",        // client said no
];

function nowIso(clock) {
  return (clock ? clock() : new Date()).toISOString();
}

/**
 * In-memory store. Node is single-threaded, so claim() is genuinely atomic here
 * — perfect for tests. The Airtable adapter mirrors this shape.
 */
class InMemoryStore {
  constructor(opts = {}) {
    this.rows = new Map();
    this.runs = []; // heartbeat / observability log
    this.seq = 0;
    this.clock = opts.clock || (() => new Date());
  }

  async create(row) {
    const id = row.id || `row_${++this.seq}`;
    const rec = {
      id,
      client: row.client || "",
      subject: row.subject || "",
      hint: row.hint || "", // the intake note / photo caption; input to drafting
      photoDescription: row.photoDescription || "", // Claude vision hint (audit)
      caption: row.caption || "",
      hashtags: row.hashtags || [],
      // The fact-check RE-RUNS immediately before publishing (an edited caption
      // is an unvalidated caption), so the row must carry what validatePost needs
      // to check the declarations, not just the display text.
      cta: row.cta || "",
      suggestedItems: row.suggestedItems || [], // intake hint: items to feature
      mentionedItems: row.mentionedItems || [],
      claimedPrices: row.claimedPrices || [],
      language: row.language || "en",
      imageUrl: row.imageUrl || "", // public URL — set ONLY at publish (publish-time-only hosting)
      imageSource: row.imageSource || null, // re-fetchable source ref {kind,...}; the draft-time image
      platforms: row.platforms || ["instagram", "facebook"],
      status: row.status || "planned",
      scheduledAt: row.scheduledAt || null,
      results: row.results || {}, // { instagram: {id, at}, facebook: {id, at} }
      attempts: row.attempts || 0,
      digestedAt: row.digestedAt || null, // last time it went out in an approval digest
      reviewNotes: row.reviewNotes || "", // the Social Media Manager agent's verdict
      lastError: row.lastError || "",
      claimToken: null,
      claimedAt: null,
      source: row.source || "", // client-direct | gmail | calendar | whatsapp
      sourceMessageId: row.sourceMessageId || "", // dedup key (WhatsApp wamid) — B-18
      createdAt: nowIso(this.clock),
      updatedAt: nowIso(this.clock),
    };
    this.rows.set(id, rec);
    return { ...rec };
  }

  async get(id) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  // Idempotency lookup (B-18): first row with this non-empty dedup key, else null.
  async findBySourceMessageId(smid) {
    if (!smid) return null;
    for (const r of this.rows.values()) if (r.sourceMessageId && r.sourceMessageId === smid) return { ...r };
    return null;
  }

  async listByStatus(status) {
    return [...this.rows.values()].filter((r) => r.status === status).map((r) => ({ ...r }));
  }

  async update(id, fields) {
    const r = this.rows.get(id);
    if (!r) throw new Error(`store.update: no row ${id}`);
    Object.assign(r, fields, { updatedAt: nowIso(this.clock) });
    return { ...r };
  }

  // Mirror AirtableStore.delete — used by the card builder's defer path (a no-photo package whose AI
  // scene fails QA drops its empty row). Keep the two store shapes in parity so offline/dry-run behave
  // like production. Idempotent: deleting a missing id is a no-op.
  async delete(id) {
    return this.rows.delete(id);
  }

  /**
   * Atomically claim a row IF it is currently in `fromStatus`. Returns the
   * claimed row, or null if it wasn't claimable (already claimed / wrong status).
   * This is the primitive that makes two runners safe.
   */
  async claim(id, { fromStatus, toStatus = "publishing", runner, staleMs = 15 * 60 * 1000 }) {
    const r = this.rows.get(id);
    if (!r) return null;

    const isStaleClaim =
      r.status === toStatus &&
      r.claimedAt &&
      this.clock().getTime() - new Date(r.claimedAt).getTime() > staleMs;

    // Claimable if it's in the expected prior status, OR a previous claim went
    // stale (a runner died mid-publish) so it can be safely reclaimed.
    if (r.status !== fromStatus && !isStaleClaim) return null;

    const token = `${runner || "runner"}-${++this.seq}-${nowIso(this.clock)}`;
    Object.assign(r, {
      status: toStatus,
      claimToken: token,
      claimedAt: nowIso(this.clock),
      updatedAt: nowIso(this.clock),
    });
    return { ...r };
  }

  /** Observability: record that a job ran, with a compact summary. */
  async heartbeat(job, summary) {
    this.runs.push({ job, at: nowIso(this.clock), ...summary });
    return true;
  }

  async lastHeartbeat(job) {
    const hits = this.runs.filter((r) => r.job === job);
    return hits.length ? hits[hits.length - 1] : null;
  }
}

module.exports = { InMemoryStore, STATUSES };
