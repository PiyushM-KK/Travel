/**
 * airtable-store.js — the persistent queue, interface-compatible with
 * InMemoryStore, backed by an Airtable base. This is what the scheduled runners
 * (GitHub Actions + Vercel) read and write, so the queue survives losing either
 * platform (AUTOMATION-PLAN: "if state lived in either platform, losing that
 * platform would lose the queue").
 *
 * DORMANT UNTIL CONFIGURED. With no AIRTABLE_API_KEY / AIRTABLE_BASE_ID it is
 * never constructed — run.js falls back to a dry-run InMemoryStore. Owner setup
 * (the base + the exact column names below + an API token) is BLOCKED.md B-15.
 *
 * claim() HONESTY: Airtable has no atomic conditional update, so claim() is
 * read-verify-write and has a small race window. That is acceptable because the
 * REAL duplicate guard is the recorded post-id (a platform with an id is never
 * re-posted) — the claim only avoids wasted work. This mirrors the note in
 * store.js. In-memory stays the atomic reference implementation for tests.
 *
 * COMPLEX FIELDS are JSON-encoded into Airtable long-text columns (Airtable
 * cells are scalars): hashtags, platforms, mentionedItems, claimedPrices,
 * results. They are parsed back on read. Dates are ISO strings in text columns
 * to avoid Airtable date-format coupling.
 */

const API = "https://api.airtable.com/v0";

// The Airtable column names. Kept in one place so the owner can create columns
// with these exact names (documented in BLOCKED.md B-15).
const FIELDS = {
  client: "Client",
  subject: "Subject",
  hint: "Hint",
  photoDescription: "PhotoDescription",
  caption: "Caption",
  hashtags: "Hashtags",           // JSON
  cta: "Cta",
  suggestedItems: "SuggestedItems", // JSON
  mentionedItems: "MentionedItems", // JSON
  claimedPrices: "ClaimedPrices",   // JSON
  language: "Language",
  imageUrl: "ImageUrl",
  imageSource: "ImageSource",     // JSON — re-fetchable source ref (publish-time-only hosting)
  platforms: "Platforms",         // JSON
  status: "Status",
  scheduledAt: "ScheduledAt",     // ISO text
  results: "Results",             // JSON
  attempts: "Attempts",           // number
  digestedAt: "DigestedAt",       // ISO text
  reviewNotes: "ReviewNotes",     // the SMM agent's verdict
  lastError: "LastError",
  claimToken: "ClaimToken",
  claimedAt: "ClaimedAt",         // ISO text
  source: "Source",
  sourceMessageId: "SourceMessageId", // dedup key (e.g. WhatsApp wamid) — B-18
  createdAt: "CreatedAt",         // ISO text
  updatedAt: "UpdatedAt",         // ISO text
};

const JSON_FIELDS = ["hashtags", "platforms", "suggestedItems", "mentionedItems", "claimedPrices", "results", "imageSource"];

function nowIso(clock) {
  return (clock ? clock() : new Date()).toISOString();
}

function encodeFields(row) {
  const f = {};
  for (const [key, col] of Object.entries(FIELDS)) {
    if (row[key] === undefined) continue;
    if (JSON_FIELDS.includes(key)) f[col] = JSON.stringify(row[key] || (key === "results" ? {} : []));
    else f[col] = row[key];
  }
  return f;
}

function decodeRecord(rec) {
  const f = rec.fields || {};
  const row = { id: rec.id };
  for (const [key, col] of Object.entries(FIELDS)) {
    const v = f[col];
    if (JSON_FIELDS.includes(key)) {
      try { row[key] = v ? JSON.parse(v) : (key === "results" ? {} : []); }
      catch { row[key] = key === "results" ? {} : []; }
    } else {
      row[key] = v !== undefined ? v : defaultFor(key);
    }
  }
  return row;
}

function defaultFor(key) {
  if (key === "attempts") return 0;
  if (["client", "subject", "hint", "photoDescription", "caption", "cta", "language", "imageUrl", "status", "reviewNotes", "lastError", "claimToken", "source", "sourceMessageId", "createdAt", "updatedAt"].includes(key)) return "";
  if (["scheduledAt", "claimedAt", "digestedAt"].includes(key)) return null;
  return "";
}

/** Airtable formula string-escape — backslash first, then single quotes (so a
 *  value can't break out of the quoted string in filterByFormula). Inputs today
 *  are hardcoded status/job constants; this is defense-in-depth for the future. */
function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

class AirtableStore {
  /**
   * @param {object} opts
   *   apiKey, baseId       — Airtable creds (default from env)
   *   table                — queue table name (default "Queue")
   *   runsTable            — heartbeat table name (default "Runs")
   *   fetchImpl            — injectable fetch (default global fetch) for tests
   *   clock                — injectable clock (Date factory)
   */
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || process.env.AIRTABLE_API_KEY;
    this.baseId = opts.baseId || process.env.AIRTABLE_BASE_ID;
    this.table = opts.table || process.env.AIRTABLE_QUEUE_TABLE || "Queue";
    this.runsTable = opts.runsTable || process.env.AIRTABLE_RUNS_TABLE || "Runs";
    this.fetch = opts.fetchImpl || ((...a) => fetch(...a));
    this.clock = opts.clock || (() => new Date());
    this.timeoutMs = opts.timeoutMs || Number(process.env.AIRTABLE_TIMEOUT_MS) || 20000;
    if (!this.apiKey || !this.baseId) {
      throw new Error("AirtableStore needs AIRTABLE_API_KEY and AIRTABLE_BASE_ID");
    }
  }

  async _req(method, tableAndPath, { query, body } = {}) {
    const url = new URL(`${API}/${this.baseId}/${tableAndPath}`);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    // Bound the request so a hung Airtable socket can't stall a run past the
    // publish stale window (which would risk the other runner reclaiming a row).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Airtable errors come in two shapes: {error:"NOT_FOUND"} (string) and
      // {error:{type,message}} (object). The string form was being dropped.
      const e = json && json.error;
      const msg = (typeof e === "string" ? e : e && (e.message || e.type)) || `HTTP ${res.status}`;
      const err = new Error(`airtable ${method} ${tableAndPath}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async create(row) {
    const rec = {
      client: row.client || "",
      subject: row.subject || "",
      hint: row.hint || "",
      photoDescription: row.photoDescription || "",
      caption: row.caption || "",
      hashtags: row.hashtags || [],
      cta: row.cta || "",
      suggestedItems: row.suggestedItems || [],
      mentionedItems: row.mentionedItems || [],
      claimedPrices: row.claimedPrices || [],
      language: row.language || "en",
      imageUrl: row.imageUrl || "",
      imageSource: row.imageSource || null, // publish-time-only hosting: re-fetchable image ref (was dropped)
      platforms: row.platforms || ["instagram", "facebook"],
      status: row.status || "planned",
      scheduledAt: row.scheduledAt || null,
      results: row.results || {},
      attempts: row.attempts || 0,
      digestedAt: row.digestedAt || null,
      reviewNotes: row.reviewNotes || "",
      lastError: row.lastError || "",
      claimToken: null,
      claimedAt: null,
      source: row.source || "",
      sourceMessageId: row.sourceMessageId || "", // dedup key (WhatsApp wamid) — B-18 (was dropped)
      createdAt: nowIso(this.clock),
      updatedAt: nowIso(this.clock),
    };
    const out = await this._req("POST", encodeURIComponent(this.table), { body: { fields: encodeFields(rec) } });
    return decodeRecord(out);
  }

  async get(id) {
    try {
      const out = await this._req("GET", `${encodeURIComponent(this.table)}/${id}`);
      return decodeRecord(out);
    } catch (e) {
      if (e.status === 404 || /NOT_FOUND/i.test(e.message)) return null;
      throw e;
    }
  }

  // Idempotency lookup (B-18): find a row by its dedup key in ONE filtered query.
  // Empty key -> null (blank ids never collide).
  async findBySourceMessageId(smid) {
    if (!smid) return null;
    const out = await this._req("GET", encodeURIComponent(this.table), {
      query: { filterByFormula: `{${FIELDS.sourceMessageId}}='${esc(smid)}'`, maxRecords: "1" },
    });
    const rec = (out.records || [])[0];
    return rec ? decodeRecord(rec) : null;
  }

  async listByStatus(status) {
    // Airtable returns at most pageSize records plus an `offset` cursor for the next
    // page. Follow the cursor to the end — otherwise everything built on this (the
    // calendar/Gmail dedup, the approve scan, queue-peek) silently sees only the
    // first 100 rows and mis-counts / re-queues once a status exceeds that.
    const records = [];
    let offset;
    do {
      const query = { filterByFormula: `{${FIELDS.status}}='${esc(status)}'`, pageSize: "100" };
      if (offset) query.offset = offset;
      const out = await this._req("GET", encodeURIComponent(this.table), { query });
      for (const r of out.records || []) records.push(decodeRecord(r));
      offset = out.offset;
    } while (offset);
    return records;
  }

  async update(id, fields) {
    const patch = encodeFields({ ...fields, updatedAt: nowIso(this.clock) });
    const out = await this._req("PATCH", `${encodeURIComponent(this.table)}/${id}`, { body: { fields: patch } });
    return decodeRecord(out);
  }

  /**
   * Best-effort claim (read-verify-write). Not atomic — the recorded post-id is
   * the real duplicate guard. Returns the claimed row or null.
   */
  async claim(id, { fromStatus, toStatus = "publishing", runner, staleMs = 15 * 60 * 1000 }) {
    const r = await this.get(id);
    if (!r) return null;

    const isStaleClaim =
      r.status === toStatus &&
      r.claimedAt &&
      this.clock().getTime() - new Date(r.claimedAt).getTime() > staleMs;

    if (r.status !== fromStatus && !isStaleClaim) return null;

    const token = `${runner || "runner"}-${nowIso(this.clock)}-${Math.round(this.clock().getTime())}`;
    await this.update(id, {
      status: toStatus,
      claimToken: token,
      claimedAt: nowIso(this.clock),
    });
    // Airtable has no atomic compare-and-set. RE-READ (not the PATCH echo, which
    // always shows our own write) to arbitrate a concurrent claim: last writer
    // wins, so an earlier writer's re-read sees the newer token and backs off.
    // This narrows — does not fully close — the race; the recorded post-id guard
    // is the real double-post backstop.
    const check = await this.get(id);
    if (!check || check.claimToken !== token) return null;
    return check;
  }

  /** Delete a record (used by the go-live verifier to clean up its test row). */
  async delete(id) {
    await this._req("DELETE", `${encodeURIComponent(this.table)}/${id}`);
    return true;
  }

  async heartbeat(job, summary) {
    await this._req("POST", encodeURIComponent(this.runsTable), {
      body: {
        fields: {
          Job: job,
          At: nowIso(this.clock),
          Runner: summary.runner || "",
          Considered: summary.considered || 0,
          Published: summary.published || 0,
          Failed: summary.failed || 0,
          Held: summary.held || 0,
          Skipped: summary.skipped || 0,
        },
      },
    });
    return true;
  }

  async lastHeartbeat(job) {
    const out = await this._req("GET", encodeURIComponent(this.runsTable), {
      query: {
        filterByFormula: `{Job}='${esc(job)}'`,
        pageSize: "1",
        "sort[0][field]": "At",
        "sort[0][direction]": "desc",
      },
    });
    const rec = (out.records || [])[0];
    return rec ? { job, ...rec.fields } : null;
  }
}

module.exports = { AirtableStore, FIELDS };
