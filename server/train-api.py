#!/usr/bin/env python3
"""
Skyline Travel Planner — Train data proxy (RapidAPI -> website), Python edition.
---------------------------------------------------------------------------
Same job as train-api.js, but runs on Python 3 (no Node.js needed) and has
ZERO third-party dependencies — only the standard library.

This is a SERVER file. It must run on your machine / server — NEVER in the
browser — because it holds the secret RapidAPI key. The website calls THIS
proxy; the proxy adds the key and calls RapidAPI. The key never reaches the
browser, and CORS is handled here.

── SETUP ────────────────────────────────────────────────────────────────────
  1. Put your key in  server/.env :

         RAPIDAPI_KEY=your_rapidapi_key_here
         # optional, only if your product isn't IRCTC1:
         # RAPIDAPI_HOST=irctc1.p.rapidapi.com

  2. Start it (from the /server folder):

         python3 train-api.py

  3. It listens on http://localhost:3001 and exposes:
         GET /api/stations?q=delhi
         GET /api/trains?from=NDLS&to=MMCT&date=2026-07-12
         GET /health
────────────────────────────────────────────────────────────────────────────
"""
import os, re, json, time, datetime, urllib.request, urllib.parse, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def daygap(d1, d2):
    try:
        return (datetime.date.fromisoformat(d2) - datetime.date.fromisoformat(d1)).days
    except Exception:
        return None

HERE = os.path.dirname(os.path.abspath(__file__))

def load_env(path):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

load_env(os.path.join(HERE, ".env"))

RAPIDAPI_KEY  = os.environ.get("RAPIDAPI_KEY")
RAPIDAPI_HOST = os.environ.get("RAPIDAPI_HOST", "irctc1.p.rapidapi.com")
PORT          = int(os.environ.get("TRAIN_API_PORT", "3001"))
STATION_PATH  = os.environ.get("RAPIDAPI_STATION_PATH", "/api/v1/searchStation?query={q}")
TRAINS_PATH   = os.environ.get("RAPIDAPI_TRAINS_PATH",
                 "/api/v3/trainBetweenStations?fromStationCode={from}&toStationCode={to}&dateOfJourney={date}")
SEAT_PATH     = os.environ.get("RAPIDAPI_SEAT_PATH",
                 "/api/v1/checkSeatAvailability?classType={cls}&fromStationCode={from}&toStationCode={to}&trainNo={train}&date={date}&quota={quota}")

if not RAPIDAPI_KEY or RAPIDAPI_KEY == "PASTE_YOUR_RAPIDAPI_KEY_HERE":
    raise SystemExit("[train-api] RAPIDAPI_KEY is not set. Edit server/.env and add your key.")

# ── Travelpayouts (Aviasales flight data + affiliate) config ──────────────────
TP_TOKEN  = os.environ.get("TRAVELPAYOUTS_TOKEN")
TP_MARKER = os.environ.get("TRAVELPAYOUTS_MARKER", "")

def tp_get(url):
    req = urllib.request.Request(url, headers={
        "X-Access-Token": TP_TOKEN or "",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read().decode("utf-8")), ""
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body), body
        except Exception:
            return e.code, None, body

# Travelpayouts returns IATA carrier codes only; map common ones to friendly names.
AIRLINE_NAMES = {
    "6E": "IndiGo", "AI": "Air India", "UK": "Vistara", "SG": "SpiceJet",
    "QP": "Akasa Air", "IX": "Air India Express", "9I": "Alliance Air", "G8": "Go First",
    "EK": "Emirates", "EY": "Etihad", "QR": "Qatar Airways", "SQ": "Singapore Airlines",
    "TG": "Thai Airways", "MH": "Malaysia Airlines", "AK": "AirAsia", "FD": "Thai AirAsia",
    "UL": "SriLankan", "WY": "Oman Air", "GF": "Gulf Air", "KU": "Kuwait Airways",
    "SV": "Saudia", "LH": "Lufthansa", "BA": "British Airways", "AF": "Air France",
    "KL": "KLM", "TK": "Turkish Airlines", "CX": "Cathay Pacific", "VS": "Virgin Atlantic",
}


def fill(tpl, vals):
    return re.sub(r"\{(\w+)\}", lambda m: urllib.parse.quote(str(vals.get(m.group(1), ""))), tpl)


def rapid(path):
    url = "https://%s%s" % (RAPIDAPI_HOST, path)
    req = urllib.request.Request(url, headers={
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": RAPIDAPI_HOST,
    })
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            text = r.read().decode("utf-8", "replace")
            status = r.status
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        status = e.code
    try:
        data = json.loads(text)
    except Exception:
        data = None
    return status, data, text


def norm_stations(j):
    arr = j if isinstance(j, list) else (j.get("data") or j.get("stations") or j.get("result") or []) if isinstance(j, dict) else []
    out = []
    for s in arr:
        if isinstance(s, str):
            m = re.match(r"^\s*([A-Z0-9]+)\s*[-–—]\s*(.+)$", s)
            if m:
                out.append({"code": m.group(1), "name": m.group(2).strip()})
            continue
        code = s.get("code") or s.get("stationCode") or s.get("station_code") or ""
        name = s.get("name") or s.get("eng_name") or s.get("stationName") or s.get("station_name") or ""
        state = s.get("state_name") or s.get("state") or ""
        if code:
            out.append({"code": code, "name": name, "state": state})
    return out


def norm_trains(j):
    arr = j if isinstance(j, list) else (j.get("data") or j.get("trains") or j.get("result") or []) if isinstance(j, dict) else []
    out = []
    for t in arr:
        if not isinstance(t, dict):
            continue
        num = t.get("train_number") or t.get("trainNumber") or t.get("number") or ""
        if not num:
            continue
        out.append({
            "number":   num,
            "name":     t.get("train_name") or t.get("trainName") or t.get("name") or "",
            "fromCode": t.get("from") or t.get("from_station_code") or t.get("train_src") or "",
            "from":     t.get("from_station_name") or t.get("fromStationName") or t.get("train_src") or "",
            "toCode":   t.get("to") or t.get("to_station_code") or t.get("train_dstn") or "",
            "to":       t.get("to_station_name") or t.get("toStationName") or t.get("train_dstn") or "",
            "depTime":  t.get("from_std") or t.get("from_sta") or t.get("departure_time") or "",
            "arrTime":  t.get("to_sta") or t.get("to_std") or t.get("arrival_time") or "",
            "duration": t.get("duration") or t.get("travel_time") or "",
            "runsOn":   t.get("run_days") or t.get("running_days") or t.get("runDays") or "",
            "distance": t.get("distance") or "",
            "hasPantry": bool(t.get("has_pantry")),
            "classes":  t.get("class_type") or t.get("classType") or t.get("classes") or [],
        })
    return out


def norm_seat(j, cls):
    arr = j.get("data") if isinstance(j, dict) else []
    if not arr:
        return None
    d = arr[0] if isinstance(arr[0], dict) else {}
    return {
        "classType": cls,
        "status":    d.get("seat_avl_text") or "",
        "statusRaw": d.get("current_status") or d.get("availablity_status") or "",
        "fare":      d.get("total_fare") or d.get("ticket_fare") or "",
        "prob":      d.get("confirm_probability_percent") or d.get("cp_percentage") or "",
        "probLabel": d.get("confirm_probability") or d.get("cp_prob") or "",
    }


def norm_tp(data):
    out = []
    for t in (data or []):
        if not isinstance(t, dict):
            continue
        code = t.get("airline") or ""
        link = t.get("link") or ""
        book = ("https://www.aviasales.com" + link) if link else ""
        if book and TP_MARKER:
            book += ("&" if "?" in book else "?") + "marker=" + TP_MARKER
        fn = t.get("flight_number")
        out.append({
            "price": t.get("price"),
            "currency": "INR",
            "airlineCode": code,
            "airline": AIRLINE_NAMES.get(code, code),
            "flightNumber": (code + "-" + str(fn)) if fn else code,
            "fromCode": t.get("origin_airport") or t.get("origin"),
            "toCode": t.get("destination_airport") or t.get("destination"),
            "depAt": t.get("departure_at"),
            "retAt": t.get("return_at"),
            "durationMin": t.get("duration") or t.get("duration_to"),
            "stops": t.get("transfers"),
            "returnStops": t.get("return_transfers"),
            "book": book,
        })
    return out


def av_link(o, d, dep, ret):
    """Build an Aviasales search URL (with affiliate marker) when the API item has no link."""
    def ddmm(s):
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s or "")
        return (m.group(3) + m.group(2)) if m else ""
    if not (o and d and ddmm(dep)):
        return ""
    seg = o + ddmm(dep) + d + (ddmm(ret) if ret else "") + "1"
    url = "https://www.aviasales.com/search/" + seg
    if TP_MARKER:
        url += "?marker=" + TP_MARKER
    return url


def norm_latest(items, frm, to):
    out = []
    for t in items or []:
        if not isinstance(t, dict):
            continue
        out.append({
            "price": t.get("value"),
            "currency": "INR",
            "airlineCode": "", "airline": "",
            "flightNumber": "",
            "fromCode": frm, "toCode": to,
            "depAt": t.get("depart_date"),
            "retAt": t.get("return_date") or "",
            "durationMin": t.get("duration"),
            "stops": t.get("number_of_changes"),
            "returnStops": None,
            "agency": t.get("gate") or "",
            "book": av_link(frm, to, t.get("depart_date"), t.get("return_date")),
        })
    return out


def norm_cheap(data, frm, to):
    out = []
    if not isinstance(data, dict):
        return out
    for dest, offers in data.items():
        if not isinstance(offers, dict):
            continue
        for _, t in offers.items():
            if not isinstance(t, dict):
                continue
            code = t.get("airline") or ""
            fn = t.get("flight_number")
            out.append({
                "price": t.get("price"),
                "currency": "INR",
                "airlineCode": code,
                "airline": AIRLINE_NAMES.get(code, code),
                "flightNumber": (code + "-" + str(fn)) if fn else code,
                "fromCode": frm, "toCode": dest,
                "depAt": t.get("departure_at"),
                "retAt": t.get("return_at") or "",
                "durationMin": t.get("duration") or t.get("duration_to"),
                "stops": t.get("number_of_changes") or 0,
                "returnStops": None,
                "book": av_link(frm, dest, t.get("departure_at"), t.get("return_at")),
            })
    return out


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def log_message(self, fmt, *args):
        print("[train-api] " + (fmt % args))

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        try:
            if u.path == "/health":
                return self._json(200, {"ok": True, "host": RAPIDAPI_HOST})

            if u.path == "/api/stations":
                q = (qs.get("q", [""])[0]).strip()
                if len(q) < 2:
                    return self._json(200, {"stations": []})
                status, data, text = rapid(fill(STATION_PATH, {"q": q}))
                if status != 200:
                    return self._json(502, {"error": "upstream", "status": status, "detail": text[:300]})
                return self._json(200, {"stations": norm_stations(data)})

            if u.path == "/api/trains":
                frm = (qs.get("from", [""])[0]).strip().upper()
                to  = (qs.get("to", [""])[0]).strip().upper()
                date = (qs.get("date", [""])[0]).strip()
                if not frm or not to or not date:
                    return self._json(400, {"error": "from, to and date are required"})
                status, data, text = rapid(fill(TRAINS_PATH, {"from": frm, "to": to, "date": date}))
                if status != 200:
                    return self._json(502, {"error": "upstream", "status": status, "detail": text[:300]})
                return self._json(200, {"trains": norm_trains(data)})

            if u.path == "/api/seat":
                frm = (qs.get("from", [""])[0]).strip().upper()
                to  = (qs.get("to", [""])[0]).strip().upper()
                train = (qs.get("train", [""])[0]).strip()
                date = (qs.get("date", [""])[0]).strip()
                cls = (qs.get("class", [""])[0]).strip().upper()
                quota = (qs.get("quota", ["GN"])[0]).strip().upper() or "GN"
                if not (frm and to and train and date and cls):
                    return self._json(400, {"error": "from, to, train, date and class are required"})
                status, data, text = rapid(fill(SEAT_PATH, {
                    "from": frm, "to": to, "train": train, "date": date, "cls": cls, "quota": quota}))
                if status != 200:
                    return self._json(502, {"error": "upstream", "status": status, "detail": text[:300]})
                return self._json(200, {"availability": norm_seat(data, cls)})

            if u.path == "/api/flights":
                if not TP_TOKEN or TP_TOKEN.startswith("PASTE_"):
                    return self._json(400, {"error": "flights_not_configured",
                        "detail": "Set TRAVELPAYOUTS_TOKEN in server/.env, then restart the proxy."})
                frm  = (qs.get("from", [""])[0]).strip().upper()
                to   = (qs.get("to", [""])[0]).strip().upper()
                date = (qs.get("date", [""])[0]).strip()
                ret  = (qs.get("return", [""])[0]).strip()
                cabin = (qs.get("cabin", ["Economy"])[0]).strip()
                tc = "1" if cabin in ("Business", "First") else "0"
                if not (frm and to and date):
                    return self._json(400, {"error": "from, to and date are required"})
                # Round-trip supports at most a 30-day gap; if exceeded, search one-way.
                trimmed = False
                if ret:
                    g = daygap(date, ret)
                    if g is None or g < 0 or g > 30:
                        ret = ""
                        trimmed = True

                def pfd(dep, rt):
                    p = {"origin": frm, "destination": to, "departure_at": dep,
                         "currency": "inr", "sorting": "price", "unique": "false",
                         "limit": "30", "token": TP_TOKEN, "trip_class": tc,
                         "one_way": "false" if rt else "true"}
                    if rt:
                        p["return_at"] = rt
                    st, d, _ = tp_get("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?"
                                      + urllib.parse.urlencode(p))
                    if st == 200 and isinstance(d, dict) and d.get("success") is not False:
                        return d.get("data") or []
                    return []

                def tp_data(path, params):
                    params["token"] = TP_TOKEN
                    st, d, _ = tp_get("https://api.travelpayouts.com" + path + "?" + urllib.parse.urlencode(params))
                    if st == 200 and isinstance(d, dict) and d.get("success") is not False:
                        return d.get("data")
                    return None

                def dedup(lst):
                    seen, out = set(), []
                    for f in lst:
                        try:
                            pr = round(float(f.get("price") or 0))
                        except Exception:
                            pr = 0
                        key = ((f.get("depAt") or "")[:10], pr, f.get("stops"))
                        if key in seen:
                            continue
                        seen.add(key)
                        out.append(f)
                    return out

                flights, source, fallback, enriched = [], "", False, False
                # Multi-source chain (all Travelpayouts, same token):
                try:                                           # 1) exact date
                    items = pfd(date, ret)
                except Exception:
                    items = []
                if items:
                    flights, source = norm_tp(items), "exact"
                if not flights and re.match(r"^\d{4}-\d{2}-\d{2}$", date):   # 2) whole month
                    try:
                        items = pfd(date[:7], "")
                    except Exception:
                        items = []
                    if items:
                        flights, source, fallback = norm_tp(items), "month", True
                if len(flights) < 6:                           # 3) enrich thin routes from broad caches
                    extra = []
                    d = tp_data("/v2/prices/latest", {"origin": frm, "destination": to,
                        "currency": "inr", "period_type": "year", "one_way": "true",
                        "limit": "30", "show_to_affiliates": "true"})
                    if d:
                        extra += norm_latest(d, frm, to)
                    d = tp_data("/v1/prices/cheap", {"origin": frm, "destination": to, "currency": "inr"})
                    if d:
                        extra += norm_cheap(d, frm, to)
                    if extra:
                        before = len(flights)
                        flights = dedup(flights + extra)
                        if len(flights) > before:
                            enriched = True
                            if not source:
                                source = "latest"

                return self._json(200, {"flights": flights, "currency": "INR", "source": source,
                                        "fallbackMonth": fallback, "enriched": enriched,
                                        "month": date[:7], "roundTripTrimmed": trimmed})

            if u.path == "/api/flight-calendar":
                # Cheapest price per departure date, for a fare-heatmap calendar.
                if not TP_TOKEN or TP_TOKEN.startswith("PASTE_"):
                    return self._json(400, {"error": "flights_not_configured"})
                frm = (qs.get("from", [""])[0]).strip().upper()
                to  = (qs.get("to", [""])[0]).strip().upper()
                months = [m.strip() for m in (qs.get("months", [""])[0]).split(",") if m.strip()]
                if not (frm and to and months):
                    return self._json(400, {"error": "from, to and months are required"})
                prices = {}
                for mo in months[:3]:
                    p = {"origin": frm, "destination": to, "departure_at": mo,
                         "currency": "inr", "one_way": "true", "sorting": "price",
                         "unique": "false", "limit": "500", "token": TP_TOKEN}
                    st, d, _ = tp_get("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?"
                                      + urllib.parse.urlencode(p))
                    if st == 200 and isinstance(d, dict) and d.get("data"):
                        for it in d["data"]:
                            day = (it.get("departure_at") or "")[:10]
                            pr = it.get("price")
                            if day and pr is not None and (day not in prices or pr < prices[day]):
                                prices[day] = pr
                return self._json(200, {"prices": prices, "currency": "INR"})

            return self._json(404, {"error": "not found"})
        except Exception as e:
            return self._json(500, {"error": "server error", "detail": str(e)})


if __name__ == "__main__":
    print("[train-api] running on http://localhost:%d  (upstream: %s)" % (PORT, RAPIDAPI_HOST))
    print("[train-api] try: http://localhost:%d/api/stations?q=delhi" % PORT)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
