/*
 * Skyline Travel Planner — ONE combined data proxy (Cloudflare Worker)
 * ---------------------------------------------------------------------------
 * The website uses a SINGLE base URL (window.SKYLINE_TRAIN_API) for BOTH flights
 * and trains, so both must be served by ONE worker. This is that worker.
 *
 *   Flights (Sky-Scrapper / Skyscanner data, host sky-scrapper.p.rapidapi.com):
 *     GET /api/flights?from=DEL&to=BOM&date=YYYY-MM-DD[&return=...]&cabin=Economy
 *     GET /api/flight-calendar?from=DEL&to=BOM&months=YYYY-MM,YYYY-MM
 *   Trains (IRCTC1, host irctc1.p.rapidapi.com):
 *     GET /api/stations?q=delh
 *     GET /api/trains?from=NDLS&to=BCT&date=YYYY-MM-DD
 *   GET /health
 *   GET /api/seat -> 501 (live availability not built yet)
 *
 * ONE RapidAPI key covers both products — subscribe to BOTH "Sky-Scrapper" and
 * "IRCTC1" on the same RapidAPI account, then set the key as the RAPIDAPI_KEY secret.
 * A product you haven't subscribed to simply returns an upstream error for its
 * routes; the others keep working.
 *
 * FREE-TIER NOTE: Sky-Scrapper free ~100 req/mo; a flight search costs ~3 calls.
 * Airport lookups (24h) and search/calendar results (30 min) are cached in isolate
 * memory to stretch it. For real traffic use a paid tier and/or a Cloudflare KV cache.
 *
 * DEPLOY: Workers & Pages → Create → Worker → paste → Deploy. Then Settings →
 * Variables and Secrets → RAPIDAPI_KEY (secret). Give it a URL, and set
 *   <script>window.SKYLINE_TRAIN_API='https://<worker-url>';</script>
 * in the <head> of BOTH Flights.dc.html and Trains.dc.html (before support.js).
 * ─────────────────────────────────────────────────────────────────────────── */

const FLIGHT_HOST = 'sky-scrapper.p.rapidapi.com';
const TRAIN_HOST = 'irctc1.p.rapidapi.com';

const ALLOWED_ORIGINS = [
  'https://skylinetravelplanner.com',
  'https://www.skylinetravelplanner.com',
  'https://piyushm-kk.github.io',
];
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const isAllowedOrigin = (o) => ALLOWED_ORIGINS.includes(o) || LOCAL_ORIGIN_RE.test(o);
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// ── Tiny TTL cache (per isolate) ───────────────────────────────────────────────
const CACHE = new Map();
function cacheGet(k) { const e = CACHE.get(k); if (e && e.exp > Date.now()) return e.val; if (e) CACHE.delete(k); return null; }
function cacheSet(k, val, ttlMs) { CACHE.set(k, { exp: Date.now() + ttlMs, val }); if (CACHE.size > 3000) { for (const [kk, v] of CACHE) if (v.exp <= Date.now()) CACHE.delete(kk); } }

async function rapid(env, host, path) {
  const res = await fetch(`https://${host}${path}`, {
    headers: { 'x-rapidapi-key': env.RAPIDAPI_KEY, 'x-rapidapi-host': host },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* leave null */ }
  return { ok: res.ok, status: res.status, json, text };
}

// ── FLIGHTS (Sky-Scrapper) ─────────────────────────────────────────────────────
async function resolveAirport(env, code) {
  const key = 'air:' + code.toUpperCase();
  const hit = cacheGet(key);
  if (hit) return hit;
  const out = await rapid(env, FLIGHT_HOST, `/api/v1/flights/searchAirport?query=${encodeURIComponent(code)}&locale=en-US`);
  const first = out.ok && out.json && Array.isArray(out.json.data) ? out.json.data[0] : null;
  if (!first || !first.skyId || !first.entityId) return null;
  const val = { skyId: first.skyId, entityId: first.entityId };
  cacheSet(key, val, 24 * 60 * 60 * 1000);
  return val;
}
const CABIN_MAP = { economy: 'economy', 'premium economy': 'premium_economy', business: 'business', first: 'first' };
const cabinParam = (c) => CABIN_MAP[String(c || '').toLowerCase()] || 'economy';

function normFlights(json, from, to, date) {
  const its = (json && json.data && json.data.itineraries) || [];
  const ymd = String(date || '').replace(/-/g, '').slice(2);
  return its.map((it) => {
    const leg = (it.legs && it.legs[0]) || {};
    const mk = (leg.carriers && leg.carriers.marketing && leg.carriers.marketing[0]) || {};
    const seg = (leg.segments && leg.segments[0]) || {};
    const fromCode = (leg.origin && (leg.origin.displayCode || leg.origin.id)) || from;
    const toCode = (leg.destination && (leg.destination.displayCode || leg.destination.id)) || to;
    return {
      price: Math.round((it.price && it.price.raw) || 0),
      durationMin: leg.durationInMinutes || 0,
      stops: leg.stopCount || 0,
      airline: mk.name || '',
      airlineCode: mk.alternateId || '',
      flightNumber: seg.flightNumber ? ((mk.alternateId || '') + ' ' + seg.flightNumber).trim() : '',
      depAt: leg.departure || '',
      arrAt: leg.arrival || '',
      fromCode, toCode,
      book: ymd ? `https://www.skyscanner.co.in/transport/flights/${fromCode.toLowerCase()}/${toCode.toLowerCase()}/${ymd}/` : '',
    };
  }).filter((f) => f.price > 0);
}
function collectCalendar(json, into) {
  const days = (json && json.data && json.data.flights && json.data.flights.days) || [];
  for (const d of days) if (d && d.day && d.price) into[d.day] = Math.round(d.price);
}

// ── TRAINS (IRCTC1) ────────────────────────────────────────────────────────────
const STATION_PATH = '/api/v1/searchStation?query={q}';
const TRAINS_PATH = '/api/v3/trainBetweenStations?fromStationCode={from}&toStationCode={to}&dateOfJourney={date}';
const fill = (tpl, vals) => tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vals[k] ?? ''));
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
    number: t.train_number || t.trainNumber || t.number || '',
    name: t.train_name || t.trainName || t.name || '',
    fromCode: t.from_station_code || t.fromStationCode || t.train_src || t.from || '',
    from: t.from_station_name || t.fromStationName || t.source || t.train_src || '',
    toCode: t.to_station_code || t.toStationCode || t.train_dstn || t.to || '',
    to: t.to_station_name || t.toStationName || t.destination || t.train_dstn || '',
    depTime: t.from_std || t.fromStd || t.departure_time || t.departureTime || t.dep_time || '',
    arrTime: t.to_sta || t.toSta || t.arrival_time || t.arrivalTime || t.arr_time || '',
    duration: t.duration || t.travel_time || t.travelTime || '',
    runsOn: t.run_days || t.runningDays || t.runDays || t.running_days || '',
    classes: t.class_type || t.classType || t.classes || t.available_classes || [],
  })).filter((t) => t.number);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json(405, { error: 'method not allowed' });

    const url = new URL(request.url);
    const p = url.pathname;
    const qp = url.searchParams;

    if (p === '/health') return json(200, { ok: true, hasKey: !!env.RAPIDAPI_KEY, flightHost: FLIGHT_HOST, trainHost: TRAIN_HOST });
    if (!env.RAPIDAPI_KEY) return json(500, { error: 'flights_not_configured', detail: 'RAPIDAPI_KEY not set on the worker' });

    try {
      // ---- FLIGHTS ----
      if (p === '/api/flights') {
        const from = (qp.get('from') || '').trim().toUpperCase();
        const to = (qp.get('to') || '').trim().toUpperCase();
        const date = (qp.get('date') || '').trim();
        const cabin = cabinParam(qp.get('cabin'));
        if (!from || !to || !date) return json(400, { error: 'from, to and date are required' });
        const ckey = `flt:${from}:${to}:${date}:${cabin}`;
        const cached = cacheGet(ckey);
        if (cached) return json(200, { flights: cached, source: 'skyscanner', cached: true });
        const [o, d] = await Promise.all([resolveAirport(env, from), resolveAirport(env, to)]);
        if (!o || !d) return json(200, { flights: [], detail: 'could not resolve one of the airports' });
        const q = `originSkyId=${encodeURIComponent(o.skyId)}&destinationSkyId=${encodeURIComponent(d.skyId)}`
          + `&originEntityId=${encodeURIComponent(o.entityId)}&destinationEntityId=${encodeURIComponent(d.entityId)}`
          + `&date=${encodeURIComponent(date)}&adults=1&currency=INR&market=en-US&countryCode=IN&cabinClass=${cabin}`;
        const out = await rapid(env, FLIGHT_HOST, `/api/v1/flights/searchFlights?${q}`);
        if (!out.ok) return json(502, { error: 'upstream', status: out.status, detail: (out.text || '').slice(0, 300) });
        const flights = normFlights(out.json, from, to, date);
        cacheSet(ckey, flights, 30 * 60 * 1000);
        return json(200, { flights, source: 'skyscanner' });
      }

      if (p === '/api/flight-calendar') {
        const from = (qp.get('from') || '').trim().toUpperCase();
        const to = (qp.get('to') || '').trim().toUpperCase();
        const months = (qp.get('months') || '').split(',').map((m) => m.trim()).filter(Boolean);
        if (!from || !to || !months.length) return json(400, { error: 'from, to and months are required' });
        const ckey = `cal:${from}:${to}:${months.join(',')}`;
        const cached = cacheGet(ckey);
        if (cached) return json(200, { prices: cached, cached: true });
        const [o, d] = await Promise.all([resolveAirport(env, from), resolveAirport(env, to)]);
        if (!o || !d) return json(200, { prices: {} });
        const prices = {};
        for (const m of months) {
          const ym = /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : m;
          const q = `originSkyId=${encodeURIComponent(o.skyId)}&destinationSkyId=${encodeURIComponent(d.skyId)}`
            + `&originEntityId=${encodeURIComponent(o.entityId)}&destinationEntityId=${encodeURIComponent(d.entityId)}`
            + `&yearMonth=${encodeURIComponent(ym)}&currency=INR`;
          const out = await rapid(env, FLIGHT_HOST, `/api/v1/flights/getPriceCalendar?${q}`);
          if (out.ok) collectCalendar(out.json, prices);
        }
        cacheSet(ckey, prices, 30 * 60 * 1000);
        return json(200, { prices });
      }

      // ---- TRAINS ----
      if (p === '/api/stations') {
        const q = (qp.get('q') || '').trim();
        if (q.length < 2) return json(200, { stations: [] });
        const out = await rapid(env, TRAIN_HOST, fill(STATION_PATH, { q }));
        if (!out.ok) return json(502, { error: 'upstream', status: out.status, detail: (out.text || '').slice(0, 300) });
        return json(200, { stations: normStations(out.json) });
      }
      if (p === '/api/trains') {
        const from = (qp.get('from') || '').trim().toUpperCase();
        const to = (qp.get('to') || '').trim().toUpperCase();
        const date = (qp.get('date') || '').trim();
        if (!from || !to || !date) return json(400, { error: 'from, to and date are required' });
        const out = await rapid(env, TRAIN_HOST, fill(TRAINS_PATH, { from, to, date }));
        if (!out.ok) return json(502, { error: 'upstream', status: out.status, detail: (out.text || '').slice(0, 300) });
        return json(200, { trains: normTrains(out.json) });
      }

      if (p === '/api/seat') return json(501, { error: 'not implemented', endpoint: p });
      return json(404, { error: 'not found' });
    } catch (err) {
      return json(500, { error: 'server error', detail: String((err && err.message) || err) });
    }
  },
};
