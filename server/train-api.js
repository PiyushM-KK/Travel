/*
 * Skyline Travel Planner — Train data proxy (RapidAPI → website)
 * ---------------------------------------------------------------------------
 * This is a SERVER file. It must run on a server / your machine — NEVER in the
 * browser — because it holds the secret RapidAPI key. The website calls THIS
 * proxy; the proxy adds the key and calls RapidAPI. The key never reaches the
 * browser, and CORS is handled here.
 *
 * Zero dependencies: uses Node's built-in http module and the global fetch
 * (Node 18+). No `npm install` required.
 *
 * ── SETUP ──────────────────────────────────────────────────────────────────
 *   1. Install Node.js 18 or newer.
 *   2. Put your key in an environment variable (never hard-code it here).
 *      Easiest: create a file  server/.env  containing:
 *
 *          RAPIDAPI_KEY=your_rapidapi_key_here
 *          # optional — only change if your RapidAPI product differs from IRCTC1:
 *          # RAPIDAPI_HOST=irctc1.p.rapidapi.com
 *
 *      (See server/.env.example.)  Load it with:  node --env-file=.env train-api.js
 *      or just export the variable in your shell before starting.
 *   3. Start it (from the /server folder):
 *
 *          node --env-file=.env train-api.js
 *          # or, if you exported the vars:  node train-api.js
 *
 *   4. It listens on http://localhost:3001 by default and exposes:
 *          GET /api/stations?q=delh
 *          GET /api/trains?from=NDLS&to=BCT&date=2026-07-12
 *          GET /health
 *
 *   5. The website (Trains page) calls these. In production, host this behind
 *      HTTPS on your domain and set SKYLINE_TRAIN_API on the page to its URL.
 * ─────────────────────────────────────────────────────────────────────────── */

const http = require('http');

// ── Config (all from environment) ────────────────────────────────────────────
const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'irctc1.p.rapidapi.com';
const PORT          = process.env.TRAIN_API_PORT || 3001;

// Endpoint path templates for the RapidAPI product. Defaults match "IRCTC1".
// If your product uses different paths, override via env — {q}/{from}/{to}/{date}
// are substituted (URL-encoded).
const STATION_PATH = process.env.RAPIDAPI_STATION_PATH
  || '/api/v1/searchStation?query={q}';
const TRAINS_PATH  = process.env.RAPIDAPI_TRAINS_PATH
  || '/api/v3/trainBetweenStations?fromStationCode={from}&toStationCode={to}&dateOfJourney={date}';

if (!RAPIDAPI_KEY) {
  console.error('\n[train-api] RAPIDAPI_KEY is not set.');
  console.error('Create server/.env with RAPIDAPI_KEY=... and run: node --env-file=.env train-api.js\n');
  process.exit(1);
}

// ── Call RapidAPI ─────────────────────────────────────────────────────────────
async function rapid(path) {
  const url = `https://${RAPIDAPI_HOST}${path}`;
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* leave null */ }
  return { ok: res.ok, status: res.status, json, text };
}

// ── Normalisers: map varied RapidAPI shapes to a stable shape for the website ──
function normStations(json) {
  const arr = Array.isArray(json) ? json
    : (json && (json.data || json.stations || json.result)) || [];
  return arr.map((s) => {
    if (typeof s === 'string') {
      // e.g. "NDLS - NEW DELHI"
      const m = s.match(/^\s*([A-Z0-9]+)\s*[-–—]\s*(.+)$/);
      return m ? { code: m[1], name: m[2].trim() } : { code: s.trim(), name: s.trim() };
    }
    return {
      code: s.code || s.stationCode || s.station_code || s.StationCode || s.value || '',
      name: s.name || s.stationName || s.station_name || s.StationName
            || s.englishName || s.label || '',
    };
  }).filter((s) => s.code);
}

function normTrains(json) {
  const arr = Array.isArray(json) ? json
    : (json && (json.data || json.trains || json.result)) || [];
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJSON(res, status, obj) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function fill(tpl, vals) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vals[k] ?? ''));
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/health') {
      return sendJSON(res, 200, { ok: true, host: RAPIDAPI_HOST });
    }

    if (p === '/api/stations') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return sendJSON(res, 200, { stations: [] });
      const out = await rapid(fill(STATION_PATH, { q }));
      if (!out.ok) return sendJSON(res, 502, { error: 'upstream', status: out.status, detail: out.text.slice(0, 300) });
      return sendJSON(res, 200, { stations: normStations(out.json) });
    }

    if (p === '/api/trains') {
      const from = (url.searchParams.get('from') || '').trim().toUpperCase();
      const to   = (url.searchParams.get('to') || '').trim().toUpperCase();
      const date = (url.searchParams.get('date') || '').trim(); // YYYY-MM-DD
      if (!from || !to || !date) return sendJSON(res, 400, { error: 'from, to and date are required' });
      const out = await rapid(fill(TRAINS_PATH, { from, to, date }));
      if (!out.ok) return sendJSON(res, 502, { error: 'upstream', status: out.status, detail: out.text.slice(0, 300) });
      return sendJSON(res, 200, { trains: normTrains(out.json) });
    }

    return sendJSON(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[train-api] error:', err);
    return sendJSON(res, 500, { error: 'server error', detail: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[train-api] running on http://localhost:${PORT}  (upstream: ${RAPIDAPI_HOST})`);
  console.log(`[train-api] try: http://localhost:${PORT}/api/stations?q=delhi`);
});
