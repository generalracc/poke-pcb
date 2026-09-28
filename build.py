#!/usr/bin/env python3
"""Build dist/poke-pcb.html: one self-contained file from src/."""
from pathlib import Path
root = Path(__file__).resolve().parent
src = root / "src"
js = "".join((src / f).read_text(encoding="utf-8") + "\n" for f in ["io.js", "gerber.js", "board.js", "app.js"])
if "</script" in js:
    raise SystemExit("A JS file contains '</script'. Escape it as '<\\/script'.")
html = (src / "shell.html").read_text(encoding="utf-8").replace("__SCRIPTS__", "<script data-poke>\n" + js + "</script>")
out = root / "dist" / "poke-pcb.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"Built {out} ({len(html) // 1024} KB)")
