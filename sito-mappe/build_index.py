#!/usr/bin/env python3
"""Crea un index.html unico e autonomo (CSS, JS e dati incorporati) nella radice del repo.

Uso:
    python3 sito-mappe/build_data.py   # se il GTFS è cambiato
    python3 sito-mappe/build_index.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "index.html")


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def main():
    html = read("index.html")
    css = read("style.css")
    data = read("data/rete.js").replace("</script", "<\\/script")
    app = read("app.js")
    parts = [
        ('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "</style>"),
        ('<script src="data/rete.js"></script>', "<script>" + data + "</script>"),
        ('<script src="app.js"></script>', "<script>\n" + app + "</script>"),
    ]
    for old, new in parts:
        if old not in html:
            raise SystemExit(f"Riferimento non trovato in index.html: {old}")
        html = html.replace(old, new)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{os.path.normpath(OUT)}: {os.path.getsize(OUT) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
