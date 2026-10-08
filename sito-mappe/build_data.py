#!/usr/bin/env python3
"""Converte il GTFS della Rete UdR 10 in un file dati compatto per il sito.

Uso:
    python3 sito-mappe/build_data.py [percorso_gtfs.zip]

Senza argomento usa lo zip GTFS nella radice del repo; se ce n'è più di uno,
quello aggiunto/modificato per ultimo (secondo git, altrimenti per data file).

Genera sito-mappe/data/rete.js (window.RETE = {...}).
"""
import csv
import datetime
import glob
import io
import json
import math
import os
import subprocess
import sys
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))

def find_gtfs():
    zips = glob.glob(os.path.join(ROOT, "*.zip"))
    if not zips:
        raise SystemExit("Nessun file .zip GTFS trovato nella radice del repo.")

    def committed(path):
        try:
            out = subprocess.run(["git", "log", "-1", "--format=%ct", "--", os.path.basename(path)],
                                 cwd=ROOT, capture_output=True, text=True).stdout.strip()
            return int(out) if out else float("inf")  # non ancora in git: è il più recente
        except OSError:
            return 0

    return max(zips, key=lambda z: (committed(z), os.path.getmtime(z)))


def service_label(weekdays):
    """Feriale / Sabato / Festivo in base ai giorni della settimana in cui il calendario è attivo."""
    if not weekdays:
        return None
    parts = []
    if weekdays & {0, 1, 2, 3, 4}:
        parts.append("Feriale")
    if 5 in weekdays:
        parts.append("Sabato")
    if 6 in weekdays:
        parts.append("Festivo")
    return " + ".join(parts)


COMUNI = {
    "AN": "Anzio", "AP": "Aprilia", "AR": "Ardea", "AZ": "Anzio-Nettuno",
    "BS": "Bassiano-Sezze", "CI": "Cisterna di Latina", "CO": "Cori",
    "CR": "Cori", "MA": "Maenza", "NE": "Nettuno", "PO": "Pomezia",
    "PR": "Priverno", "PRO": "Prossedi", "RC": "Roccasecca dei Volsci",
    "RO": "Roccagorga", "SE": "Sezze", "SR": "Sermoneta",
}
# linee intercomunali
EXTRA = {
    "AZNT": "Intercomunali", "BSZ": "Intercomunali", "CRCS": "Intercomunali",
    "CRMS": "Intercomunali", "PRFS": "Intercomunali", "RCFS": "Intercomunali",
    "SERC": "Intercomunali", "SERN": "Intercomunali",
}


def read(zf, name):
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def comune_of(short):
    if short in EXTRA:
        return EXTRA[short]
    for k in sorted(COMUNI, key=len, reverse=True):
        if short.startswith(k):
            return COMUNI[k]
    return "Altro"


def to_min(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 60 + m


# Douglas-Peucker su coordinate proiettate localmente (metri)
def simplify(points, tol_m=6.0):
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][0])
    kx = 111320 * math.cos(lat0)
    ky = 110540
    xy = [(p[1] * kx, p[0] * ky) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if L == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, idx = d, i
        if best > tol_m:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def palette(n):
    # colori ben distinguibili, saturi, leggibili su mappa chiara
    out = []
    for i in range(n):
        h = (i * 137.508) % 360
        out.append(h)
    return out


def hsl_to_hex(h, s, l):
    s /= 100
    l /= 100
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    r, g, b = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][int(h // 60) % 6]
    return "#%02x%02x%02x" % tuple(round((v + m) * 255) for v in (r, g, b))


def main():
    zpath = sys.argv[1] if len(sys.argv) > 1 else find_gtfs()
    print(f"GTFS: {os.path.basename(zpath)}")
    zf = zipfile.ZipFile(zpath)
    agency = read(zf, "agency.txt")[0]
    routes = read(zf, "routes.txt")
    stops = read(zf, "stops.txt")
    trips = read(zf, "trips.txt")
    stop_times = read(zf, "stop_times.txt")
    shapes_raw = read(zf, "shapes.txt")
    names = set(zf.namelist())
    calendar = read(zf, "calendar.txt") if "calendar.txt" in names else []
    cal_dates = read(zf, "calendar_dates.txt") if "calendar_dates.txt" in names else []

    # --- fermate
    stop_index = {}
    stops_out = []
    for s in sorted(stops, key=lambda s: s["stop_name"]):
        stop_index[s["stop_id"]] = len(stops_out)
        stops_out.append([
            s["stop_name"],
            s["stop_code"],
            round(float(s["stop_lat"]), 6),
            round(float(s["stop_lon"]), 6),
        ])

    # --- percorsi (shapes)
    pts = defaultdict(list)
    for r in shapes_raw:
        pts[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"]),
                                   float(r["shape_dist_traveled"] or 0)))
    used_shapes = sorted({t["shape_id"] for t in trips})
    shape_index = {}
    shapes_out = []
    for sid in used_shapes:
        seq = sorted(pts.get(sid, []))
        line = [(p[1], p[2]) for p in seq]
        line = simplify(line)
        shape_index[sid] = len(shapes_out)
        length_km = round(seq[-1][3] / 1000, 2) if seq else 0
        shapes_out.append({
            "id": sid,
            "km": length_km,
            "pts": [[round(a, 5), round(b, 5)] for a, b in line],
        })

    # --- linee
    route_index = {}
    routes_sorted = sorted(routes, key=lambda r: (comune_of(r["route_short_name"]), r["route_short_name"]))
    hues = palette(len(routes_sorted))
    routes_out = []
    for i, r in enumerate(routes_sorted):
        route_index[r["route_id"]] = len(routes_out)
        color = r["route_color"].strip()
        color = "#" + color if color else hsl_to_hex(hues[i], 72, 42)
        routes_out.append({
            "s": r["route_short_name"],
            "n": r["route_long_name"],
            "c": color,
            "g": comune_of(r["route_short_name"]),
        })

    # --- corse
    st_by_trip = defaultdict(list)
    for r in stop_times:
        st_by_trip[r["trip_id"]].append((int(r["stop_sequence"]), stop_index[r["stop_id"]],
                                         to_min(r["departure_time"] or r["arrival_time"])))
    services = sorted({t["service_id"] for t in trips})
    service_dates = {}
    weekdays = defaultdict(set)
    for c in calendar:
        for k, g in enumerate(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]):
            if c.get(g) == "1":
                weekdays[c["service_id"]].add(k)
    for d in sorted(cal_dates, key=lambda d: d["date"]):
        if d["exception_type"] == "1":
            service_dates.setdefault(d["service_id"], d["date"])
            weekdays[d["service_id"]].add(datetime.datetime.strptime(d["date"], "%Y%m%d").weekday())
    labels = {s: service_label(weekdays[s]) or s for s in services}
    # etichette uguali (es. due calendari feriali): si distinguono con il codice
    dup = {l for l in labels.values() if list(labels.values()).count(l) > 1}
    labels = {s: f"{l} ({s})" if l in dup else l for s, l in labels.items()}
    # ordine: Feriale, Sabato, Festivo
    order = {"Feriale": 0, "Sabato": 1, "Festivo": 2}
    services.sort(key=lambda s: (order.get(labels[s].split(" ")[0], 9), s))
    service_index = {s: i for i, s in enumerate(services)}

    trips_out = []
    for t in trips:
        seq = sorted(st_by_trip[t["trip_id"]])
        if not seq:
            continue
        # tempi codificati come delta dal primo per compattezza
        t0 = seq[0][2]
        trips_out.append([
            route_index[t["route_id"]],
            service_index[t["service_id"]],
            int(t["direction_id"] or 0),
            t["trip_headsign"],
            shape_index[t["shape_id"]],
            t0,
            [s[1] for s in seq],
            [s[2] - t0 for s in seq],
            t["trip_short_name"],
        ])
    trips_out.sort(key=lambda x: (x[0], x[1], x[2], x[5]))

    data = {
        "agency": {"name": agency["agency_name"], "url": agency["agency_url"]},
        "source": os.path.basename(zpath),
        "services": [{"id": s, "label": labels[s], "date": service_dates.get(s, "")}
                     for s in services],
        "routes": routes_out,
        "stops": stops_out,
        "shapes": shapes_out,
        "trips": trips_out,
    }
    out_dir = os.path.join(HERE, "data")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "rete.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("window.RETE=")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"{out}: {os.path.getsize(out)/1024:.0f} KB — {len(routes_out)} linee, {len(stops_out)} fermate, "
          f"{len(shapes_out)} percorsi, {len(trips_out)} corse")


if __name__ == "__main__":
    main()
