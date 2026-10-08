# Sito mappe interattive — Rete UdR 10

Sito statico (HTML + [Leaflet](https://leafletjs.com/)) che mostra su mappa la rete descritta nel GTFS
`GTFS_UdR10_5Ottobre_correzioni.zip`.

## Funzioni

- **Mappa della rete**: tutti i percorsi colorati per linea, con fermate; basemap chiara, scura, OSM o satellite.
- **Tipo di giorno**: Feriale / Sabato / Festivo (calendari `udr10_10`, `udr10_20`, `udr10_30`).
- **Linee**: ricerca, filtro per comune, numero di corse del giorno; scheda linea con km/giorno,
  prima e ultima partenza, direzioni, **quadro orario** completo (clic su un orario per evidenziare la corsa) e
  sequenza fermate.
- **Fermate**: ricerca per nome o codice, “fermate vicino a me” (geolocalizzazione), linee servite e
  tabellone delle partenze (anche “solo da ora”), link alle indicazioni.
- **Mappa frequenze**: spessore e colore dei percorsi in base al numero di corse giornaliere.
- **Rete**: indicatori (linee attive, corse, bus·km), partenze per fascia oraria, corse per comune.
- **Link condivisibili**: l’URL conserva giorno, linea/direzione o fermata (es. `#g=feriale&linea=AN1`).

## Aggiornare i dati

```bash
python3 sito-mappe/build_data.py [percorso/GTFS.zip]
```

Rigenera `sito-mappe/data/rete.js` (solo libreria standard Python). Senza argomento usa lo zip nella radice del repo.

## File unico `index.html`

```bash
python3 sito-mappe/build_index.py
```

Crea `index.html` nella radice del repo con CSS, codice e dati incorporati: si apre con un doppio clic o si
carica su qualsiasi hosting senza altri file (serve solo la connessione per Leaflet e le mappe di sfondo).
Va rigenerato dopo ogni modifica a `sito-mappe/` o ai dati.

## Vedere il sito

- In locale: `cd sito-mappe && python3 -m http.server` e apri <http://localhost:8000>
  (oppure apri direttamente `index.html` nel browser).
- Online: il workflow `.github/workflows/pages-mappe.yml` pubblica la cartella su GitHub Pages ad ogni push su
  `main` (in *Settings → Pages* impostare **Source: GitHub Actions**).
