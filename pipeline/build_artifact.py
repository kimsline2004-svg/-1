#!/usr/bin/env python3
"""Fold the app into a single self-contained page.

Two outputs:
  dist/fng-calculator.html   standalone page (open it directly in a browser)
  dist/artifact.html         same page without the <!doctype>/<html>/<head>/<body>
                             wrapper, for publishing as a Claude Artifact

Both inline the stylesheet, the script and the statistics JSON, so neither
needs a same-origin fetch.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
DIST = ROOT / "dist"

html = (APP / "index.html").read_text()
css = (APP / "styles.css").read_text()
js = (APP / "app.js").read_text()
data = (APP / "data" / "fng_stats.json").read_text()

FONTS = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=IBM+Plex+Sans+KR:wght@400;500;600;700&'
         'family=IBM+Plex+Mono:wght@400;500;600&display=swap">')
STYLE = "<style>\n" + css + "\n</style>"
SCRIPTS = ('<script type="application/json" id="fng-data">'
           + data.replace("</", "<\\/") + "</script>\n<script>\n" + js + "\n</script>")

standalone = html.replace('<link rel="stylesheet" href="styles.css">', STYLE)
standalone = standalone.replace('<script src="app.js"></script>', SCRIPTS)

body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = body.replace('<script src="app.js"></script>', SCRIPTS)
artifact = ("<title>공포탐욕 수익률 계산기</title>\n"
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            + FONTS + "\n" + STYLE + "\n" + body)

DIST.mkdir(parents=True, exist_ok=True)
for name, text in (("fng-calculator.html", standalone), ("artifact.html", artifact)):
    out = DIST / name
    out.write_text(text)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB)")
