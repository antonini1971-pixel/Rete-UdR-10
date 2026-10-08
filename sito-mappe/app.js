/* Mappa interattiva Rete UdR 10 — dati generati da build_data.py (window.RETE) */
(function () {
  "use strict";

  const D = window.RETE;
  // trip: [route, service, dir, headsign, shape, t0, stops[], deltas[], shortName]
  const T_ROUTE = 0, T_SERV = 1, T_DIR = 2, T_HEAD = 3, T_SHAPE = 4, T_T0 = 5, T_STOPS = 6, T_DT = 7;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // orari in secondi dalla mezzanotte; i secondi si mostrano solo se diversi da zero (es. 06:54:30)
  const p2 = (n) => String(n).padStart(2, "0");
  const hhmm = (t) => p2(Math.floor(t / 3600) % 24) + ":" + p2(Math.floor(t / 60) % 60) + (t % 60 ? ":" + p2(t % 60) : "");
  const stopTime = (t, i) => t[T_T0] + t[T_DT][i];
  const nowSec = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60; };
  const fmtKm = (v) => v.toLocaleString("it-IT", { maximumFractionDigits: 0 });
  const textOn = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? "#111" : "#fff";
  };
  const badge = (ri, cls = "") => {
    const r = D.routes[ri];
    return `<span class="badge ${cls}" style="background:${r.c};color:${textOn(r.c)}" data-route="${ri}">${esc(r.s)}</span>`;
  };

  // ---------- indici
  const tripsByRoute = D.routes.map(() => []);
  const tripsByStop = D.stops.map(() => []); // [tripIdx, pos]
  const routesByStop = D.stops.map(() => new Set());
  const shapeRoute = new Array(D.shapes.length).fill(-1);
  D.trips.forEach((t, ti) => {
    tripsByRoute[t[T_ROUTE]].push(ti);
    shapeRoute[t[T_SHAPE]] = t[T_ROUTE];
    t[T_STOPS].forEach((s, pos) => { tripsByStop[s].push([ti, pos]); routesByStop[s].add(t[T_ROUTE]); });
  });
  const codeToStop = new Map(D.stops.map((s, i) => [s[1], i]));
  const nameToRoute = new Map(D.routes.map((r, i) => [r.s, i]));
  const comuni = [...new Set(D.routes.map((r) => r.g))];

  // ---------- stato
  const state = {
    day: 0,
    route: null,
    dir: 0,
    trip: null,
    stop: null,
    comune: null,
    freq: false,
    fromNow: false,
  };

  // ---------- mappa
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([41.55, 12.8], 10);
  // Mappe di base ESRI (ArcGIS Online)
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const esri = (svc, attribution, nativeZoom = 19) =>
    L.tileLayer(ESRI + svc + "/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles &copy; Esri — " + attribution, maxZoom: 19, maxNativeZoom: nativeZoom });
  const srcEsri = "Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community";
  const esriLabels = (svc) => L.tileLayer(ESRI + svc + "/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 16 });
  const bases = {
    "Esri Grigio chiaro": L.layerGroup([esri("Canvas/World_Light_Gray_Base", srcEsri, 16), esriLabels("Canvas/World_Light_Gray_Reference")]),
    "Esri Grigio scuro": L.layerGroup([esri("Canvas/World_Dark_Gray_Base", srcEsri, 16), esriLabels("Canvas/World_Dark_Gray_Reference")]),
    "Esri Stradale": esri("World_Street_Map", srcEsri),
    "Esri Topografica": esri("World_Topo_Map", srcEsri),
    "Esri Satellite": L.layerGroup([
      esri("World_Imagery", "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"),
      L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
    ]),
  };
  (prefersDark ? bases["Esri Grigio scuro"] : bases["Esri Grigio chiaro"]).addTo(map);
  L.control.layers(bases, null, { position: "bottomright" }).addTo(map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

  // Ogni renderer canvas copre tutta la mappa e intercetta il mouse: per questo tutti gli
  // elementi cliccabili (percorsi e fermate) stanno in UN SOLO canvas ("net"), mentre i livelli
  // grafici sovrapposti (evidenziazione, frecce, fermate della linea) sono trasparenti al mouse.
  const pane = (name, z, passThrough) => {
    const el = map.createPane(name);
    el.style.zIndex = z;
    if (passThrough) el.style.pointerEvents = "none";
  };
  pane("net", 400, false);
  pane("sel", 410, true);
  pane("arrows", 415, true);
  pane("selStops", 430, true);
  const rNet = L.canvas({ pane: "net", tolerance: 5 });
  const rSel = L.canvas({ pane: "sel" });
  const rArrows = L.canvas({ pane: "arrows" });
  const rSelStops = L.canvas({ pane: "selStops" });

  // rete: una polilinea per percorso
  const shapeLayers = D.shapes.map((sh, si) => {
    const ri = shapeRoute[si];
    const r = D.routes[ri];
    const pl = L.polyline(sh.pts, { renderer: rNet, color: r.c, weight: 3, opacity: 0.85, lineCap: "round", lineJoin: "round" });
    pl.bindTooltip(() => `<b>${esc(r.s)}</b> · ${esc(r.n)}`, { sticky: true });
    pl.on("click", (e) => { L.DomEvent.stop(e); selectRoute(ri); });
    pl.on("mouseover", () => { if (state.route === null && !state.freq) pl.setStyle({ weight: 6 }); });
    pl.on("mouseout", () => { if (state.route === null) styleNetwork(); });
    return pl;
  });
  const networkLayer = L.layerGroup(shapeLayers).addTo(map);
  const netBounds = L.latLngBounds(D.shapes.flatMap((s) => s.pts));
  map.fitBounds(netBounds, { padding: [20, 20] });

  // fermate
  const stopLayers = D.stops.map((s, i) => {
    const m = L.circleMarker([s[2], s[3]], { renderer: rNet, radius: 3, weight: 1.5, color: "#33415c", fillColor: "#fff", fillOpacity: 1 });
    m.bindTooltip(() => esc(s[0]) + (stopTimeHint.has(i) ? ` · <b>${hhmm(stopTimeHint.get(i))}</b>` : ""), { direction: "top", offset: [0, -4] });
    m.on("click", (e) => { L.DomEvent.stop(e); selectStop(i, true); });
    return m;
  });
  L.layerGroup(stopLayers).addTo(map); // aggiunte dopo i percorsi: nel canvas stanno sopra
  let routeStops = new Set(); // fermate della linea selezionata: restano cliccabili anche se nascoste
  let stopTimeHint = new Map(); // orari della corsa evidenziata, mostrati nel tooltip della fermata

  const selLayer = L.layerGroup().addTo(map);

  // ---------- frecce di direzione lungo i percorsi (ordine dei punti dello shape = verso di marcia)
  const arrowLayer = L.layerGroup().addTo(map);
  let arrowShapes = []; // [[shapeIdx, colore, dimensione]] per la selezione corrente
  const ARROW_ZOOM_NET = 14; // da questo zoom le frecce compaiono anche sulla rete intera
  function arrowsAlong(pts, color, size, spacing, view) {
    const P = pts.map((p) => map.latLngToLayerPoint(p));
    let next = spacing / 2, acc = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (!len) continue;
      while (acc + len >= next) {
        const t = (next - acc) / len;
        const c = L.point(a.x + dx * t, a.y + dy * t);
        next += spacing;
        if (view && !view.contains(c)) continue;
        const ux = dx / len, uy = dy / len, px = -uy, py = ux;
        const tip = L.point(c.x + ux * size, c.y + uy * size);
        const l = L.point(c.x - ux * size + px * size * 0.85, c.y - uy * size + py * size * 0.85);
        const r = L.point(c.x - ux * size - px * size * 0.85, c.y - uy * size - py * size * 0.85);
        const back = L.point(c.x - ux * size * 0.35, c.y - uy * size * 0.35);
        L.polygon([tip, l, back, r].map((q) => map.layerPointToLatLng(q)), {
          renderer: rArrows, color, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false,
        }).addTo(arrowLayer);
      }
      acc += len;
    }
  }
  function drawArrows() {
    arrowLayer.clearLayers();
    const pb = map.getPixelBounds(), o = map.getPixelOrigin();
    const view = L.bounds(pb.min.subtract(o).subtract([40, 40]), pb.max.subtract(o).add([40, 40]));
    const vb = map.getBounds().pad(0.1);
    if (arrowShapes.length) {
      arrowShapes.forEach(([si, color, size]) => arrowsAlong(D.shapes[si].pts, color, size, 110, view));
    } else if (map.getZoom() >= ARROW_ZOOM_NET && !state.freq) {
      D.shapes.forEach((sh, si) => {
        const r = D.routes[shapeRoute[si]];
        if (state.comune !== null && r.g !== state.comune) return;
        if (!vb.intersects(L.latLngBounds(sh.pts))) return;
        arrowsAlong(sh.pts, r.c, 7, 150, view);
      });
    }
  }
  map.on("zoomend moveend", drawArrows);
  let youMarker = null;

  function stopRadius() {
    const z = map.getZoom();
    return z < 11 ? 2 : z < 13 ? 3 : z < 15 ? 4.5 : 6;
  }
  function refreshStopsVisibility() {
    const show = $("#showStops").checked && map.getZoom() >= 10;
    const r = stopRadius();
    const dim = state.route !== null;
    stopLayers.forEach((m, i) => {
      if (routeStops.has(i)) {
        // disegnata dal livello della linea: qui solo area cliccabile invisibile
        m.options.interactive = true;
        m.setStyle({ radius: Math.max(r, 5), opacity: 0, fillOpacity: 0 });
      } else if (!show) {
        m.options.interactive = false;
        m.setStyle({ opacity: 0, fillOpacity: 0 });
      } else {
        m.options.interactive = true;
        m.setStyle({ radius: r, opacity: dim ? 0.35 : 1, fillOpacity: dim ? 0.35 : 1 });
      }
    });
  }
  map.on("zoomend", refreshStopsVisibility);
  $("#showStops").addEventListener("change", refreshStopsVisibility);

  // ---------- frequenze
  function shapeCounts() {
    const c = new Array(D.shapes.length).fill(0);
    D.trips.forEach((t) => { if (t[T_SERV] === state.day) c[t[T_SHAPE]]++; });
    return c;
  }
  function heat(v, max) {
    const stops = [[253, 230, 138], [245, 158, 11], [220, 38, 38], [127, 29, 29]];
    const x = max <= 1 ? 1 : Math.min(1, Math.log(v) / Math.log(max)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
    return `rgb(${c.join(",")})`;
  }

  function styleNetwork() {
    const counts = state.freq ? shapeCounts() : null;
    const max = counts ? Math.max(1, ...counts) : 1;
    if (counts) $("#freqMax").textContent = max;
    $("#freqLegend").classList.toggle("hidden", !state.freq);
    drawArrows();
    shapeLayers.forEach((pl, si) => {
      const ri = shapeRoute[si];
      const inComune = state.comune === null || D.routes[ri].g === state.comune;
      if (state.freq) {
        const n = counts[si];
        pl.setStyle({ color: n ? heat(n, max) : "#9aa5b4", weight: n ? 1.5 + 8 * Math.sqrt(n / max) : 1, opacity: n ? (inComune ? 0.9 : 0.15) : 0.3, dashArray: n ? null : "4 6" });
      } else {
        const sel = state.route !== null;
        pl.setStyle({ color: D.routes[ri].c, weight: 3, dashArray: null, opacity: sel ? 0.12 : inComune ? 0.85 : 0.12 });
      }
    });
  }
  $("#freqMode").addEventListener("change", (e) => { state.freq = e.target.checked; styleNetwork(); });

  // ---------- giorno
  const daySwitch = $("#daySwitch");
  D.services.forEach((s, i) => {
    const b = document.createElement("button");
    b.textContent = s.label;
    b.setAttribute("role", "radio");
    b.title = s.date ? `Calendario ${s.id} (es. ${s.date.slice(6)}/${s.date.slice(4, 6)}/${s.date.slice(0, 4)})` : s.id;
    b.onclick = () => setDay(i);
    daySwitch.appendChild(b);
  });
  function setDay(i) {
    state.day = i;
    [...daySwitch.children].forEach((b, k) => { b.classList.toggle("active", k === i); b.setAttribute("aria-checked", k === i); });
    renderLineList();
    renderInfo();
    styleNetwork();
    if (state.route !== null) renderRouteDetail();
    else if (state.stop !== null) renderStopDetail();
    writeHash();
  }

  // ---------- pannello: tab
  const panel = $("#panel");
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  function showTab(name) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-body").forEach((s) => s.classList.toggle("hidden", s.dataset.body !== name));
  }
  $("#grip").addEventListener("click", () => {
    if (panel.classList.contains("collapsed")) panel.classList.remove("collapsed");
    else if (panel.classList.contains("expanded")) { panel.classList.remove("expanded"); panel.classList.add("collapsed"); }
    else panel.classList.add("expanded");
    setTimeout(() => map.invalidateSize(), 250);
  });
  function openPanel() { panel.classList.remove("collapsed"); }

  // ---------- lista linee
  const chipsEl = $("#comuneChips");
  function renderChips() {
    chipsEl.innerHTML = [`<button class="chip ${state.comune === null ? "active" : ""}" data-c="">Tutti</button>`]
      .concat(comuni.map((c) => `<button class="chip ${state.comune === c ? "active" : ""}" data-c="${esc(c)}">${esc(c)}</button>`)).join("");
  }
  chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.comune = b.dataset.c || null;
    renderChips(); renderLineList(); styleNetwork();
    if (state.comune) {
      const bb = L.latLngBounds([]);
      D.shapes.forEach((s, si) => { if (D.routes[shapeRoute[si]].g === state.comune) bb.extend(L.latLngBounds(s.pts)); });
      if (bb.isValid()) map.fitBounds(bb, { padding: [30, 30] });
    } else map.fitBounds(netBounds, { padding: [20, 20] });
  });

  function tripsOnDay(ri) { return tripsByRoute[ri].filter((ti) => D.trips[ti][T_SERV] === state.day).length; }

  function renderLineList() {
    const q = $("#lineSearch").value.trim().toLowerCase();
    let html = "", last = null;
    D.routes.forEach((r, ri) => {
      if (state.comune && r.g !== state.comune) return;
      if (q && !(r.s.toLowerCase().includes(q) || r.n.toLowerCase().includes(q) || r.g.toLowerCase().includes(q))) return;
      if (r.g !== last) { html += `<div class="group-title">${esc(r.g)}</div>`; last = r.g; }
      const n = tripsOnDay(ri);
      html += `<button class="row ${n ? "" : "dim"}" data-route="${ri}">${badge(ri)}<span class="name">${esc(r.n)}</span><span class="meta">${n ? n + " corse" : "non attiva"}</span></button>`;
    });
    $("#lineList").innerHTML = html || `<div class="empty-msg">Nessuna linea trovata.</div>`;
  }
  $("#lineSearch").addEventListener("input", renderLineList);
  $("#lineList").addEventListener("click", (e) => { const b = e.target.closest("[data-route]"); if (b) selectRoute(+b.dataset.route); });

  // ---------- lista fermate
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const stopNorm = D.stops.map((s) => norm(s[0] + " " + s[1]));
  function stopRow(i, extra = "") {
    const s = D.stops[i];
    const lines = [...routesByStop[i]].slice(0, 5).map((ri) => badge(ri, "sm")).join(" ");
    return `<button class="row" data-stop="${i}"><span class="stop-dot"></span><span class="name" title="${esc(s[0])}">${esc(s[0])}<br><small style="color:var(--muted)">${esc(s[1])} ${extra}</small></span><span class="meta">${lines}</span></button>`;
  }
  function renderStopList(list) {
    const q = norm($("#stopSearch").value.trim());
    let idx = list;
    if (!idx) {
      idx = [];
      for (let i = 0; i < D.stops.length && idx.length < 150; i++) if (!q || stopNorm[i].includes(q)) idx.push(i);
    }
    $("#stopList").innerHTML = idx.length
      ? idx.map((x) => Array.isArray(x) ? stopRow(x[0], "· " + x[1]) : stopRow(x)).join("") + (!list && idx.length === 150 ? `<div class="empty-msg">Mostrate le prime 150 fermate: affina la ricerca.</div>` : "")
      : `<div class="empty-msg">Nessuna fermata trovata.</div>`;
  }
  $("#stopSearch").addEventListener("input", () => renderStopList());
  $("#stopList").addEventListener("click", (e) => { const b = e.target.closest("[data-stop]"); if (b) selectStop(+b.dataset.stop, true); });

  $("#locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Geolocalizzazione non disponibile.");
    $("#stopList").innerHTML = `<div class="empty-msg">Ricerca posizione…</div>`;
    navigator.geolocation.getCurrentPosition((p) => {
      const ll = L.latLng(p.coords.latitude, p.coords.longitude);
      if (youMarker) map.removeLayer(youMarker);
      youMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#0b6bcb", fillOpacity: 1, renderer: rSelStops, interactive: false }).addTo(map);
      const near = D.stops.map((s, i) => [i, ll.distanceTo([s[2], s[3]])]).sort((a, b) => a[1] - b[1]).slice(0, 15);
      renderStopList(near.map(([i, d]) => [i, d < 1000 ? Math.round(d) + " m" : (d / 1000).toFixed(1) + " km"]));
      map.setView(ll, Math.max(map.getZoom(), 15));
    }, () => { $("#stopList").innerHTML = `<div class="empty-msg">Impossibile ottenere la posizione.</div>`; });
  });

  // ---------- dettaglio
  const detail = $("#detail");
  function closeDetail() {
    detail.classList.add("hidden");
    state.route = null; state.stop = null; state.trip = null;
    selLayer.clearLayers();
    arrowShapes = [];
    routeStops = new Set(); stopTimeHint = new Map();
    styleNetwork();
    refreshStopsVisibility();
    writeHash();
  }
  detail.addEventListener("click", (e) => {
    if (e.target.closest(".back")) return closeDetail();
    const dep = e.target.closest(".dep[data-trip]");
    if (dep) { const ti = +dep.dataset.trip; return selectRoute(D.trips[ti][T_ROUTE], ti); }
    const th = e.target.closest("th[data-trip]");
    if (th) { const ti = +th.dataset.trip; state.trip = state.trip === ti ? null : ti; return renderRouteDetail(false); }
    const rb = e.target.closest("[data-route]");
    if (rb) return selectRoute(+rb.dataset.route);
    const db = e.target.closest("[data-dir]");
    if (db) { state.dir = +db.dataset.dir; state.trip = null; renderRouteDetail(); return writeHash(); }
    const sb = e.target.closest("[data-stop]");
    if (sb) return selectStop(+sb.dataset.stop, true);
    if (e.target.closest("#fromNow")) { state.fromNow = !state.fromNow; renderStopDetail(); }
  });

  // pattern più frequente + unione ordinata delle fermate di tutte le corse di una direzione
  function buildRows(trips) {
    const keyed = trips.map((ti) => {
      const seen = new Map();
      return D.trips[ti][T_STOPS].map((s) => { const k = (seen.get(s) || 0); seen.set(s, k + 1); return s + ":" + k; });
    });
    const freq = new Map();
    keyed.forEach((k) => { const j = k.join(","); freq.set(j, (freq.get(j) || 0) + 1); });
    const main = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0].split(",");
    const rows = main.slice();
    keyed.forEach((ks) => {
      let prev = -1;
      ks.forEach((k) => {
        const at = rows.indexOf(k);
        if (at === -1) { rows.splice(prev + 1, 0, k); prev = prev + 1; } else if (at > prev) prev = at;
      });
    });
    return { rows, main, keyed };
  }

  function routeDirs(ri) {
    const dirs = new Map();
    tripsByRoute[ri].forEach((ti) => {
      const t = D.trips[ti];
      if (!dirs.has(t[T_DIR])) dirs.set(t[T_DIR], new Map());
      const head = t[T_HEAD] || D.stops[t[T_STOPS][t[T_STOPS].length - 1]][0];
      const h = dirs.get(t[T_DIR]); h.set(head, (h.get(head) || 0) + 1);
    });
    return [...dirs.entries()].sort((a, b) => a[0] - b[0]).map(([d, h]) => [d, [...h.entries()].sort((a, b) => b[1] - a[1])[0][0]]);
  }

  function selectRoute(ri, tripIdx) {
    const changed = state.route !== ri;
    state.route = ri; state.stop = null;
    if (changed) {
      const dirs = routeDirs(ri);
      const active = tripsByRoute[ri].find((ti) => D.trips[ti][T_SERV] === state.day);
      state.dir = active !== undefined ? D.trips[active][T_DIR] : dirs.length ? dirs[0][0] : 0;
    }
    state.trip = null;
    if (tripIdx !== undefined) { state.trip = tripIdx; state.dir = D.trips[tripIdx][T_DIR]; state.day = D.trips[tripIdx][T_SERV]; setDayButtons(); renderLineList(); renderInfo(); }
    openPanel();
    renderRouteDetail(true);
    writeHash();
  }
  function setDayButtons() { [...daySwitch.children].forEach((b, k) => b.classList.toggle("active", k === state.day)); }

  function renderRouteDetail(fit = true) {
    const ri = state.route, r = D.routes[ri];
    const all = tripsByRoute[ri];
    const dirs = routeDirs(ri);
    const dayTrips = all.filter((ti) => D.trips[ti][T_SERV] === state.day);
    const dirTrips = dayTrips.filter((ti) => D.trips[ti][T_DIR] === state.dir).sort((a, b) => D.trips[a][T_T0] - D.trips[b][T_T0]);
    const km = dayTrips.reduce((s, ti) => s + D.shapes[D.trips[ti][T_SHAPE]].km, 0);
    const first = dayTrips.length ? Math.min(...dayTrips.map((ti) => D.trips[ti][T_T0])) : null;
    const last = dayTrips.length ? Math.max(...dayTrips.map((ti) => D.trips[ti][T_T0])) : null;

    let html = `<div class="detail-head"><button class="back">‹ Indietro</button>
      <div class="detail-title">${badge(ri)}<h2>${esc(r.n)}</h2></div>
      <div class="detail-sub">${esc(r.g)} · ${esc(D.services[state.day].label)}</div></div><div class="detail-body">`;
    html += `<div class="stats"><div class="stat"><b>${dayTrips.length}</b><span>corse</span></div>
      <div class="stat"><b>${fmtKm(km)}</b><span>km/giorno</span></div>
      <div class="stat"><b>${first !== null ? hhmm(first) + "–" + hhmm(last) : "—"}</b><span>prima–ultima partenza</span></div></div>`;
    if (dirs.length) {
      html += `<div class="seg">` + dirs.map(([d, h]) => `<button data-dir="${d}" class="${d === state.dir ? "active" : ""}">→ ${esc(h)}</button>`).join("") + `</div>`;
    }

    // percorsi da evidenziare
    selLayer.clearLayers();
    const dirAll = all.filter((ti) => D.trips[ti][T_DIR] === state.dir);
    const shapesDir = new Set((dirTrips.length ? dirTrips : dirAll).map((ti) => D.trips[ti][T_SHAPE]));
    const shapesOther = new Set(all.map((ti) => D.trips[ti][T_SHAPE]).filter((s) => !shapesDir.has(s)));
    shapesOther.forEach((si) => L.polyline(D.shapes[si].pts, { renderer: rSel, color: r.c, weight: 3, opacity: 0.35, dashArray: "6 6", interactive: false }).addTo(selLayer));
    const bounds = L.latLngBounds([]);
    arrowShapes = [...shapesDir].map((si) => [si, r.c, 10]);
    shapesDir.forEach((si) => {
      const isTrip = state.trip !== null && D.trips[state.trip][T_SHAPE] === si;
      L.polyline(D.shapes[si].pts, { renderer: rSel, color: "#fff", weight: 9, opacity: 0.9, interactive: false }).addTo(selLayer);
      L.polyline(D.shapes[si].pts, { renderer: rSel, color: r.c, weight: isTrip ? 7 : 5.5, opacity: 1, interactive: false }).addTo(selLayer);
      bounds.extend(L.latLngBounds(D.shapes[si].pts));
    });

    if (!dirTrips.length) {
      html += `<div class="empty-msg">Nessuna corsa in questa direzione per il giorno <b>${esc(D.services[state.day].label)}</b>. Prova un altro tipo di giorno.</div>`;
      drawRouteStops(dirAll.length ? D.trips[dirAll[0]][T_STOPS] : [], r, null);
    } else {
      const { rows, main, keyed } = buildRows(dirTrips);
      const rowStop = rows.map((k) => +k.split(":")[0]);
      const pos = keyed.map((ks) => new Map(ks.map((k, i) => [k, i])));
      const tripTimes = state.trip !== null && dirTrips.includes(state.trip) ? new Map(D.trips[state.trip][T_STOPS].map((s, i) => [s, stopTime(D.trips[state.trip], i)])) : null;
      drawRouteStops([...new Set(rowStop)], r, tripTimes);

      html += `<h3 class="sec">Orario${state.trip !== null ? " — corsa evidenziata" : ""}</h3><div class="tt-wrap"><table class="tt"><thead><tr><th>Fermata</th>`;
      html += dirTrips.map((ti) => `<th data-trip="${ti}" class="${ti === state.trip ? "hl" : ""}" style="cursor:pointer" title="Mostra corsa ${esc(D.trips[ti][8] || "")}">${hhmm(D.trips[ti][T_T0])}</th>`).join("");
      html += `</tr></thead><tbody>`;
      rows.forEach((k, ri2) => {
        html += `<tr><th data-stop="${rowStop[ri2]}" style="cursor:pointer" title="${esc(D.stops[rowStop[ri2]][0])}">${esc(D.stops[rowStop[ri2]][0])}</th>`;
        dirTrips.forEach((ti, c) => {
          const p = pos[c].get(k);
          const hl = ti === state.trip ? " hl" : "";
          html += p === undefined ? `<td class="empty${hl}">·</td>` : `<td class="${hl.trim()}">${hhmm(stopTime(D.trips[ti], p))}</td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody></table></div>`;

      html += `<h3 class="sec">Percorso principale (${main.length} fermate)</h3><ul class="seq" style="--line:${r.c}">`;
      html += main.map((k) => { const s = +k.split(":")[0]; return `<li data-stop="${s}">${esc(D.stops[s][0])}${tripTimes && tripTimes.has(s) ? `<span class="t">${hhmm(tripTimes.get(s))}</span>` : ""}</li>`; }).join("");
      html += `</ul>`;
    }
    html += `</div>`;
    detail.innerHTML = html;
    detail.classList.remove("hidden");
    styleNetwork();
    refreshStopsVisibility();
    if (fit && bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  function drawRouteStops(stops, r, times) {
    routeStops = new Set(stops);
    stopTimeHint = times || new Map();
    stops.forEach((s) => {
      const st = D.stops[s];
      L.circleMarker([st[2], st[3]], { renderer: rSelStops, radius: 5, weight: 2.5, color: r.c, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(selLayer);
    });
  }

  function selectStop(i, fly) {
    state.stop = i; state.route = null; state.trip = null;
    openPanel();
    renderStopDetail();
    const s = D.stops[i];
    if (fly) map.setView([s[2], s[3]], Math.max(map.getZoom(), 16));
    writeHash();
  }

  function renderStopDetail() {
    const i = state.stop, s = D.stops[i];
    selLayer.clearLayers();
    const routes = [...routesByStop[i]];
    routes.forEach((ri) => {
      const sh = new Set(tripsByRoute[ri].filter((ti) => D.trips[ti][T_STOPS].includes(i)).map((ti) => D.trips[ti][T_SHAPE]));
      sh.forEach((si) => L.polyline(D.shapes[si].pts, { renderer: rSel, color: D.routes[ri].c, weight: 4.5, opacity: 0.9, interactive: false }).addTo(selLayer));
    });
    arrowShapes = routes.flatMap((ri) => [...new Set(tripsByRoute[ri].filter((ti) => D.trips[ti][T_STOPS].includes(i)).map((ti) => D.trips[ti][T_SHAPE]))].map((si) => [si, D.routes[ri].c, 8]));
    routeStops = new Set(); stopTimeHint = new Map();
    L.circleMarker([s[2], s[3]], { renderer: rSelStops, radius: 10, weight: 4, color: "#0b6bcb", fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(selLayer);

    const deps = tripsByStop[i]
      .filter(([ti, pos]) => D.trips[ti][T_SERV] === state.day && pos < D.trips[ti][T_STOPS].length - 1)
      .map(([ti, pos]) => [ti, stopTime(D.trips[ti], pos)])
      .sort((a, b) => a[1] - b[1]);
    const now = nowSec();
    const shown = state.fromNow ? deps.filter((d) => d[1] >= now) : deps;

    let html = `<div class="detail-head"><button class="back">‹ Indietro</button>
      <div class="detail-title"><span class="stop-dot" style="width:18px;height:18px;border-width:4px"></span><h2>${esc(s[0])}</h2></div>
      <div class="detail-sub">Codice ${esc(s[1])} · ${s[2].toFixed(5)}, ${s[3].toFixed(5)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${s[2]},${s[3]}" target="_blank" rel="noopener">Indicazioni</a></div></div>
      <div class="detail-body"><h3 class="sec">Linee che fermano qui</h3><div class="line-chips">${routes.map((ri) => badge(ri)).join("")}</div>
      <h3 class="sec" style="display:flex;align-items:center;justify-content:space-between">Partenze · ${esc(D.services[state.day].label)} (${deps.length})
      <button class="small-btn" id="fromNow">${state.fromNow ? "Tutto il giorno" : "Solo da ora (" + hhmm(now) + ")"}</button></h3>`;
    html += shown.length
      ? shown.map(([ti, m]) => {
        const t = D.trips[ti];
        return `<div class="dep" data-trip="${ti}"><span class="time">${hhmm(m)}</span>${badge(t[T_ROUTE], "sm")}<span class="to">→ ${esc(t[T_HEAD] || D.stops[t[T_STOPS][t[T_STOPS].length - 1]][0])}</span></div>`;
      }).join("")
      : `<div class="empty-msg">Nessuna partenza ${state.fromNow ? "da ora in poi " : ""}per questo tipo di giorno.</div>`;
    html += `</div>`;
    detail.innerHTML = html;
    detail.classList.remove("hidden");
    styleNetwork();
    refreshStopsVisibility();
  }

  // ---------- info rete
  function renderInfo() {
    const day = D.trips.filter((t) => t[T_SERV] === state.day);
    const km = day.reduce((s, t) => s + D.shapes[t[T_SHAPE]].km, 0);
    const active = new Set(day.map((t) => t[T_ROUTE])).size;
    const byComune = new Map();
    day.forEach((t) => { const g = D.routes[t[T_ROUTE]].g; byComune.set(g, (byComune.get(g) || 0) + 1); });
    const rows = [...byComune.entries()].sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    const hours = new Array(24).fill(0);
    day.forEach((t) => hours[Math.floor(t[T_T0] / 3600) % 24]++);
    const hmax = Math.max(1, ...hours);
    const svc = D.services[state.day];

    $("#netInfo").innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${active}</b><span>linee attive (${D.routes.length} totali)</span></div>
        <div class="kpi"><b>${D.stops.length}</b><span>fermate</span></div>
        <div class="kpi"><b>${day.length.toLocaleString("it-IT")}</b><span>corse · ${esc(svc.label)}</span></div>
        <div class="kpi"><b>${fmtKm(km)}</b><span>bus·km · ${esc(svc.label)}</span></div>
      </div>
      <h3 class="sec">Partenze per fascia oraria</h3>
      <div class="hours">${hours.map((h, k) => `<div style="height:${(h / hmax) * 100}%" title="${k}:00–${k}:59 · ${h} corse"></div>`).join("")}</div>
      <div class="hours-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
      <h3 class="sec">Corse per comune</h3>
      <div class="bars">${rows.map(([g, n]) => `<div class="bar-row" data-comune="${esc(g)}"><span>${esc(g)}</span><div class="track"><div class="fill" style="width:${(n / max) * 100}%"></div></div><span class="v">${n}</span></div>`).join("")}</div>
      <p class="note">Esercente: <a href="${esc(D.agency.url)}" target="_blank" rel="noopener">${esc(D.agency.name)}</a><br>
      Fonte dati: <code>${esc(D.source)}</code><br>
      Tipi di giorno: ${D.services.map((s) => `${esc(s.label)} (${esc(s.id)}${s.date ? ", " + s.date.slice(6) + "/" + s.date.slice(4, 6) + "/" + s.date.slice(0, 4) : ""})`).join(", ")}.<br>
      Usa il selettore in alto per cambiare tipo di giorno; attiva “Spessore = n. corse” per vedere la frequenza sulla mappa.</p>`;
  }
  $("#netInfo").addEventListener("click", (e) => {
    const b = e.target.closest("[data-comune]"); if (!b) return;
    state.comune = b.dataset.comune; showTab("linee"); renderChips();
    chipsEl.querySelector(".chip.active").dispatchEvent(new Event("click", { bubbles: true }));
  });

  // ---------- hash (link condivisibili)
  let writingHash = false;
  function writeHash() {
    const p = new URLSearchParams();
    p.set("g", D.services[state.day].label.toLowerCase());
    if (state.route !== null) { p.set("linea", D.routes[state.route].s); p.set("dir", state.dir); }
    else if (state.stop !== null) p.set("fermata", D.stops[state.stop][1]);
    writingHash = true;
    history.replaceState(null, "", "#" + p.toString());
    writingHash = false;
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const g = p.get("g");
    const di = D.services.findIndex((s) => s.label.toLowerCase() === g);
    state.day = di >= 0 ? di : 0;
    setDay(state.day);
    if (p.has("linea") && nameToRoute.has(p.get("linea"))) {
      selectRoute(nameToRoute.get(p.get("linea")));
      if (p.has("dir")) { state.dir = +p.get("dir"); renderRouteDetail(true); writeHash(); }
    } else if (p.has("fermata") && codeToStop.has(p.get("fermata"))) {
      showTab("fermate");
      selectStop(codeToStop.get(p.get("fermata")), true);
    }
  }
  window.addEventListener("hashchange", () => { if (!writingHash) readHash(); });
  map.on("click", () => { if (state.route !== null || state.stop !== null) closeDetail(); });

  // ---------- avvio
  $("#agency").textContent = `${D.agency.name} · mappa interattiva di linee, fermate e orari`;
  renderChips();
  renderStopList();
  readHash();
  refreshStopsVisibility();
})();
