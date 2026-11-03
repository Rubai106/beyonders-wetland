"""Browser checks for the 3D landing page and the global mission-control page
(real showcase, no local run). Complements tests/e2e/wetland_smoke.py.

    python tests/e2e/explore_smoke.py http://localhost:3140
The one tolerated network response is the local-run API answering 404 when no local pipeline run exists.
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3140"
results, errors = [], []
def check(name, ok, detail=""):
    results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.add_init_script("localStorage.setItem('geonexsar_tour_v1','1')")  # suppress the first-run tour in tests
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errors.append(m.text[:140]) if m.type == "error" and not any(x in m.text for x in ("ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "ERR_TUNNEL_CONNECTION_FAILED", "404")) else None)
    pg.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and BASE in r.url and "/api/wetland/nisar-detections" not in r.url else None)

    # ── 3D landing ──
    pg.goto(BASE + "/"); pg.wait_for_timeout(9000); t = pg.inner_text("body")
    check("landing: clear first action", "Open the Tanguar Haor case" in t and "nisar worldwide" in t.lower())
    check("landing: 3D globe canvas renders", pg.locator(".globe-mount canvas").count() == 1)
    check("landing: real-case marker on the globe", pg.locator(".globe-tag--case").count() >= 1)
    check("landing: forest/volcano cards link to briefings", pg.locator(".g3-phen-card a[href='/forest']").count() == 1 and pg.locator(".g3-phen-card a[href='/volcano']").count() == 1)
    check("landing: brand is GeoNexSAR", "geonexsar" in pg.inner_text(".g3-top").lower())
    check("landing: telemetry ticker shows real stats", "radar observations" in pg.inner_text(".g3-ticker").lower())
    chokwe_link = pg.get_by_role("link", name="Inspect the Chókwè event case")
    check("landing: featured Chókwè shortcut", chokwe_link.count() == 1 and chokwe_link.get_attribute("href") == "/wetland/global?story=chokwe")
    chokwe_link.click(); pg.wait_for_url("**/wetland/global?story=chokwe", timeout=20000)
    pg.wait_for_selector("#mozambique-case-title", timeout=20000)
    check("featured deep link opens the Learn tab", pg.locator(".wx-drawer__tabs [role=tab][aria-selected=true]").inner_text() == "Learn")
    chokwe_text = pg.inner_text(".mozambique-case")
    check("Chókwè event evidence remains qualified", "accuracy unverified" in chokwe_text.lower() and "candidates, not a flood map" in chokwe_text.lower() and "1.26%" in chokwe_text and "88.2%" in chokwe_text)
    pg.get_by_role("link", name="Open the Tanguar Haor case").click(); pg.wait_for_url("**/wetland", timeout=20000)
    check("landing -> Tanguar case navigation is preserved", pg.url.rstrip("/").endswith("/wetland"))

    # ── global mission control ──
    pg.goto(BASE + "/wetland/global"); pg.wait_for_selector(".atlas-featured", timeout=20000); pg.wait_for_timeout(2500); t = pg.inner_text("body")
    check("explore: three goals offered", all(x in t for x in ("Explore worldwide observations", "Explore processed cases", "Process another place")))
    check("explore: Tanguar case easy to find", "Tanguar Haor" in pg.inner_text(".atlas-featured") and "24.48" in t and "295" in t)
    check("explore: independent check shown as inconclusive", "inconclusive" in t.lower() and "0.3%" in t)
    check("explore: no Hakaluki describing the active case", "Wetland story: Hakaluki" not in t)
    check("explore: footprints described as observations, not detections", "Satellite coverage only. Nothing is detected here." in t)
    check("explore: processing flagged advanced", "C · Advanced" in t.replace("C · ADVANCED", "C · Advanced"))
    check("explore: Earthdata guidance lives in the processing section", "Earthdata" in pg.locator("#process").inner_text() and "Earthdata" not in pg.locator(".atlas-featured").inner_text())
    check("explore: missing local run is not shown as a red error", "could not load detector output" not in t.lower())
    pg.click("text=Show on the world map"); pg.wait_for_timeout(1500); check("explore: locate case control works (no crash)", pg.locator("#global-nisar-map").count() == 1)
    pg.click(".atlas-featured >> text=Open the case"); pg.wait_for_url("**/wetland"); check("explore -> case navigation", True)
    pg.goto(BASE + "/wetland"); pg.wait_for_selector(".wx-nav", timeout=20000); pg.click("text=Explore NISAR worldwide"); pg.wait_for_url("**/wetland/global"); check("case -> explore navigation", True)
    for w in (1100, 820, 390):
        pg.set_viewport_size({"width": w, "height": 900}); pg.wait_for_timeout(600)
        check(f"explore: no horizontal overflow at {w}px", not pg.evaluate("document.documentElement.scrollWidth > innerWidth"))
    # ── phenomena briefings ──
    pg.set_viewport_size({"width": 1440, "height": 900})
    for route in ("/forest", "/volcano"):
        pg.goto(BASE + route); pg.wait_for_timeout(1500)
        check(f"{route}: briefing loads", "Signal incoming" in pg.inner_text("body") or "SIGNAL INCOMING" in pg.inner_text("body"))
    b.close()
bad = results.count(False)
print(f"\n{len(results) - bad}/{len(results)} checks passed; application errors: {errors or 'none'}")
sys.exit(1 if bad or errors else 0)
