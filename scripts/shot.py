"""Capture de Trame. Usage : python3 scripts/shot.py <port> [dark|light] [sortie.png] [largeur] [hauteur]"""
import sys
from playwright.sync_api import sync_playwright
port = sys.argv[1]; theme = sys.argv[2] if len(sys.argv) > 2 else "dark"; out = sys.argv[3] if len(sys.argv) > 3 else "/tmp/trame.png"
w = int(sys.argv[4]) if len(sys.argv) > 4 else 1440; h = int(sys.argv[5]) if len(sys.argv) > 5 else 900
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": w, "height": h})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(f"http://localhost:{port}"); pg.evaluate("t=>{localStorage.clear();}", theme); pg.reload()
    pg.evaluate("t=>{document.documentElement.setAttribute('data-theme',t)}", theme)
    pg.wait_for_timeout(1500); pg.screenshot(path=out); print("erreurs:", errs); b.close()
