#!/usr/bin/env python3
"""앱을 한 파일로 접는다.

  dist/ust10y-calculator.html   브라우저로 바로 여는 단독 페이지
  dist/artifact.html            같은 페이지에서 <!doctype>/<html>/<head>/<body>
                                껍데기를 뺀 것 (Claude Artifact 게시용)

스타일·스크립트·데이터를 모두 인라인하므로 같은 출처 fetch가 필요 없다.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
DIST = ROOT / "dist"

html = (APP / "index.html").read_text()
css = (APP / "styles.css").read_text()
js = (APP / "app.js").read_text()
data = (APP / "data" / "ust10y_panel.json").read_text()

FONTS = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=IBM+Plex+Sans+KR:wght@400;500;600;700&'
         'family=IBM+Plex+Mono:wght@400;500;600&display=swap">')
STYLE = "<style>\n" + css + "\n</style>"
SCRIPTS = ('<script type="application/json" id="ust10y-data">'
           + data.replace("</", "<\\/") + "</script>\n<script>\n" + js + "\n</script>")

standalone = html.replace('<link rel="stylesheet" href="styles.css">', STYLE)
standalone = standalone.replace('<script src="app.js"></script>', SCRIPTS)

body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = body.replace('<script src="app.js"></script>', SCRIPTS)
artifact = ("<title>국채금리 수익률 계산기</title>\n"
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            + FONTS + "\n" + STYLE + "\n" + body)

DIST.mkdir(parents=True, exist_ok=True)
for name, text in (("ust10y-calculator.html", standalone), ("artifact.html", artifact)):
    out = DIST / name
    out.write_text(text)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB)")
