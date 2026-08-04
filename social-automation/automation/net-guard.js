/**
 * net-guard.js — SSRF-safe outbound image fetch (B-23).
 *
 * Image URLs enter the pipeline from vendor emails, WhatsApp notes, and (once wired) an AI
 * provider's result. Any of those could point at an INTERNAL address (cloud metadata, a
 * private service) — and because a fetched image is then hosted PUBLICLY, an unguarded fetch
 * is an SSRF that exfiltrates internal responses. This guard is the single safe sink:
 *   - blocks non-http(s) schemes,
 *   - resolves the host and REJECTS private / loopback / link-local / ULA / metadata IPs
 *     (ALWAYS on, regardless of any allow-list — this is the real protection),
 *   - optionally enforces a host allow-list (SOCIAL_IMAGE_HOSTS etc.),
 *   - caps the response size (streaming) so a huge body can't OOM the runner.
 *
 * Residual risk (documented): DNS rebinding — we resolve-then-check but don't pin the IP for
 * the actual connection. This path is reachable by an emailer, and GMAIL_ALLOWED_SENDERS
 * defaults to ANY sender when unset — so **set GMAIL_ALLOWED_SENDERS in production** and,
 * if the threat model grows, pin the resolved IP for the connection (custom lookup/agent).
 * Redirects ARE re-validated per hop (see safeFetchBytes) so a 302→internal is blocked.
 */

const dns = require("dns").promises;
const { fetchWithTimeout, FETCH_TIMEOUT_MS } = require("./image-host");

const MAX_FETCH_BYTES = 12 * 1024 * 1024;

/** True if an IPv4 literal is in a blocked (non-public) range. Malformed → blocked (fail closed). */
function ipv4Blocked(ip) {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                       // "this" network
  if (a === 10) return true;                      // private
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;        // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                      // multicast / reserved
  return false;
}

// Expand any IPv6 text form (compressed `::`, hex-embedded or dotted IPv4) to 16 bytes, so
// classification works on the CANONICAL address — not a regex over one spelling. `new URL()`
// normalises `[::ffff:127.0.0.1]` to `::ffff:7f00:1` (hex), so a dotted-only regex is a bypass.
function expandIPv6(input) {
  let s = String(input).toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, ""); // strip zone id
  const v4m = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // trailing dotted IPv4
  if (v4m) {
    const p = v4m[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, v4m.index) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups;
  if (halves.length === 2) {
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    const g = parseInt(groups[i] || "0", 16);
    if (Number.isNaN(g) || g < 0 || g > 0xffff) return null;
    buf.writeUInt16BE(g, i * 2);
  }
  return buf;
}

function ipv6Blocked(ip) {
  const b = expandIPv6(ip);
  if (!b) return true;                                                   // unparseable → block
  const zero = (a, n) => b.slice(a, a + n).every((x) => x === 0);
  if (zero(0, 16)) return true;                                          // :: unspecified
  if (zero(0, 15) && b[15] === 1) return true;                          // ::1 loopback
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;             // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true;                             // fc00::/7 ULA
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return ipv4Blocked(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`); // ::ffff:v4 mapped
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 8)) return ipv4Blocked(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`); // 64:ff9b::/96 NAT64
  if (zero(0, 12)) return ipv4Blocked(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`); // ::v4 IPv4-compatible (deprecated)
  return false;
}

function ipBlocked(ip) { return String(ip).includes(":") ? ipv6Blocked(ip) : ipv4Blocked(ip); }

/**
 * Validate a URL is safe to fetch. Throws on a blocked scheme / non-allow-listed host /
 * internal address. `opts.lookup(host) -> [{address}]` is injectable for offline tests.
 */
async function assertSafeUrl(urlStr, opts = {}) {
  let u;
  try { u = new URL(String(urlStr)); } catch { throw new Error("invalid URL"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`blocked URL scheme "${u.protocol}"`);
  const host = u.hostname.replace(/^\[|\]$/g, "");

  const allow = opts.allowHosts && opts.allowHosts.length ? opts.allowHosts : null;
  if (allow) {
    const h = host.toLowerCase();
    if (!allow.some((a) => h === a || h.endsWith("." + a))) throw new Error(`host not allow-listed: ${host}`);
  }

  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
  let ips;
  if (isIpLiteral) {
    ips = [host];
  } else {
    const lookup = opts.lookup || ((h) => dns.lookup(h, { all: true }));
    const recs = await lookup(host);
    ips = (Array.isArray(recs) ? recs : [recs]).map((r) => (r && r.address) || r).filter(Boolean);
    if (!ips.length) throw new Error(`could not resolve host: ${host}`);
  }
  for (const ip of ips) if (ipBlocked(ip)) throw new Error(`blocked internal address (${ip}) for ${host}`);
  return u;
}

/** Read a fetch Response body with a hard byte cap (streaming abort past the cap). */
async function readCapped(res, max) {
  const cl = Number(res.headers && res.headers.get && res.headers.get("content-length"));
  if (cl && cl > max) throw new Error(`response too large (${cl} bytes > ${max})`);
  if (!res.body || typeof res.body.getReader !== "function") {
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > max) throw new Error(`response too large (${b.length} bytes > ${max})`);
    return b;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error(`response too large (> ${max} bytes)`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * SSRF-safe image fetch: validate the URL, fetch with a timeout, cap the body.
 * @returns {Promise<{buffer:Buffer, contentType:string}>}
 */
async function safeFetchBytes(urlStr, opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects != null ? opts.maxRedirects : 3;
  let url = String(urlStr);
  let res;
  // Follow redirects MANUALLY, re-validating EVERY hop — otherwise a safe URL could 302 to
  // http://169.254.169.254/ and the default follow would bypass the IP check + allow-list.
  for (let hop = 0; ; hop++) {
    await assertSafeUrl(url, opts);
    res = await fetchWithTimeout(fetchImpl, url, { redirect: "manual" }, timeoutMs);
    const status = res && res.status;
    if (status >= 300 && status < 400 && res.headers && res.headers.get) {
      if (hop >= maxRedirects) throw new Error("too many redirects");
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`redirect with no location (HTTP ${status})`);
      url = new URL(loc, url).toString(); // re-checked at the top of the next iteration
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
  const buffer = await readCapped(res, opts.maxBytes || MAX_FETCH_BYTES);
  const contentType = (res.headers && res.headers.get && res.headers.get("content-type")) || "image/jpeg";
  return { buffer, contentType: String(contentType).split(";")[0].trim() };
}

/** Parse a comma-list env (e.g. SOCIAL_IMAGE_HOSTS) into a host allow-list, or [] if unset. */
function hostAllowListFromEnv(name) {
  return String(process.env[name] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

module.exports = { assertSafeUrl, safeFetchBytes, readCapped, ipBlocked, hostAllowListFromEnv, MAX_FETCH_BYTES };
