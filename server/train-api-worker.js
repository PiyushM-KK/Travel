/*
 * Skyline Travel Planner — Train data proxy, as a CLOUDFLARE WORKER
 * ---------------------------------------------------------------------------
 * Cloudflare-Worker port of train-api.js. The website (Trains page) calls THIS
 * worker; the worker adds the secret RapidAPI key and calls RapidAPI, so the key
 * never reaches the browser. Runs on HTTPS at the edge — the fix for the
 * "localhost / mixed-content" problem that broke live train search.
 *
 * ── DEPLOY (Cloudflare dashboard, no wrangler needed) ───────────────────────
 *   1. Cloudflare dashboard → Workers & Pages → Create → Worker. Name it e.g.
 *      "skyline-train-api". Paste this whole file into the editor → Deploy.
 *   2. Worker → Settings → Variables and Secrets → add a SECRET:
 *          RAPIDAPI_KEY = <your RapidAPI key>
 *      (optional plain vars if your product differs from IRCTC1:
 *          RAPIDAPI_HOST, RAPIDAPI_STATION_PATH, RAPIDAPI_TRAINS_PATH)
 *   3. Give it a stable URL: Worker → Settings → Domains & Routes → add a
 *      Custom Domain like  api.skylinetravelplanner.com  (recommended), or use
 *      the *.workers.dev URL.
 *   4. On the website, add this ONE line in the <head> of Trains.dc.html
 *      (and Flights.dc.html once a flights backend exists), BEFORE support.js:
 *          <script>window.SKYLINE_TRAIN_API='https://api.skylinetravelplanner.com';</script>
 *
 * ── wrangler alternative ────────────────────────────────────────────────────
 *   wrangler deploy  with a wrangler.toml:
 *     name = "skyline-train-api"
 *     main = "train-api-worker.js"
 *     compatibility_date = "2026-01-01"
 *   then:  wrangler secret put RAPIDAPI_KEY
 *
 * Endpoints served:  GET /health · GET /api/stations?q=delh
 *                    GET /api/trains?from=NDLS&to=BCT&date=YYYY-MM-DD
 * NOT yet implemented (return 501 so the page degrades gracefully):
 *   /api/seat  (live availability) · /api/flights · /api/flight-calendar
 *   — those need a separate provider (Travelpayouts for flights); build later.
 * ─────────────────────────────────────────────────────────────────────────── */

// Lock CORS to the site's own origins (the Node version used '*'; that would let
// anyone drain your RapidAPI quota). Add origins here if the site moves.
const ALLOWED_ORIGINS = [
  'https://skylinetravelplanner.com',
  'https://www.skylinetravelplanner.com',
  'https://piyushm-kk.github.io',
];
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin);
}
function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function fill(tpl, vals) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vals[k] ?? ''));
}

async function rapid(env, host, path) {
  const res = await fetch(`https://${host}${path}`, {
    headers: { 'x-rapidapi-key': env.RAPIDAPI_KEY, 'x-rapidapi-host': host },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* leave null */ }
  return { ok: res.ok, status: res.status, json, text };
}

// Map varied RapidAPI shapes to a stable shape for the website (unchanged from train-api.js).
function normStations(json) {
  const arr = Array.isArray(json) ? json : (json && (json.data || json.stations || json.result)) || [];
  return arr.map((s) => {
    if (typeof s === 'string') {
      const m = s.match(/^\s*([A-Z0-9]+)\s*[-–—]\s*(.+)$/);
      return m ? { code: m[1], name: m[2].trim() } : { code: s.trim(), name: s.trim() };
    }
    return {
      code: s.code || s.stationCode || s.station_code || s.StationCode || s.value || '',
      name: s.name || s.stationName || s.station_name || s.StationName || s.englishName || s.label || '',
    };
  }).filter((s) => s.code);
}
function normTrains(json) {
  const arr = Array.isArray(json) ? json : (json && (json.data || json.trains || json.result)) || [];
  return arr.map((t) => ({
    number:   t.train_number || t.trainNumber || t.number || '',
    name:     t.train_name || t.trainName || t.name || '',
    fromCode: t.from_station_code || t.fromStationCode || t.train_src || t.from || '',
    from:     t.from_station_name || t.fromStationName || t.source || t.train_src || '',
    toCode:   t.to_station_code || t.toStationCode || t.train_dstn || t.to || '',
    to:       t.to_station_name || t.toStationName || t.destination || t.train_dstn || '',
    depTime:  t.from_std || t.fromStd || t.departure_time || t.departureTime || t.dep_time || '',
    arrTime:  t.to_sta || t.toSta || t.arrival_time || t.arrivalTime || t.arr_time || '',
    duration: t.duration || t.travel_time || t.travelTime || '',
    runsOn:   t.run_days || t.runningDays || t.runDays || t.running_days || '',
    classes:  t.class_type || t.classType || t.classes || t.available_classes || [],
  })).filter((t) => t.number);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    const json = (status, obj) => new Response(JSON.stringify(obj), {
      status, headers: { 'Content-Type': 'application/json', ...cors },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json(405, { error: 'method not allowed' });

    const host = env.RAPIDAPI_HOST || 'irctc1.p.rapidapi.com';
    const STATION_PATH = env.RAPIDAPI_STATION_PATH || '/api/v1/searchStation?query={q}';
    const TRAINS_PATH = env.RAPIDAPI_TRAINS_PATH || '/api/v3/trainBetweenStations?fromStationCode={from}&toStationCode={to}&dateOfJourney={date}';

    const url = new URL(request.url);
    const p = url.pathname;

    try {
      if (p === '/health') return json(200, { ok: true, host, hasKey: !!env.RAPIDAPI_KEY });
      if (!env.RAPIDAPI_KEY) return json(500, { error: 'RAPIDAPI_KEY not configured on the worker' });

      if (p === '/api/stations') {
        const q = (url.searchParams.get('q') || '').trim();
        if (q.length < 2) return json(200, { stations: [] });
        const out = await rapid(env, host, fill(STATION_PATH, { q }));
        if (!out.ok) return json(502, { error: 'upstream', status: out.status, detail: out.text.slice(0, 300) });
        return json(200, { stations: normStations(out.json) });
      }

      if (p === '/api/trains') {
        const from = (url.searchParams.get('from') || '').trim().toUpperCase();
        const to = (url.searchParams.get('to') || '').trim().toUpperCase();
        const date = (url.searchParams.get('date') || '').trim();
        if (!from || !to || !date) return json(400, { error: 'from, to and date are required' });
        const out = await rapid(env, host, fill(TRAINS_PATH, { from, to, date }));
        if (!out.ok) return json(502, { error: 'upstream', status: out.status, detail: out.text.slice(0, 300) });
        return json(200, { trains: normTrains(out.json) });
      }

      // Endpoints the frontend calls but that have no backend yet — respond
      // predictably so the page shows its graceful "coming soon" message.
      if (p === '/api/seat' || p === '/api/flights' || p === '/api/flight-calendar') {
        return json(501, { error: 'not implemented', endpoint: p });
      }

      return json(404, { error: 'not found' });
    } catch (err) {
      return json(500, { error: 'server error', detail: String((err && err.message) || err) });
    }
  },
};
