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
    tanguar_card = pg.locator(".g3-domain-card[data-domain='wetland']")
    check(
        "landing: clear first action and Tanguar case entry",
        pg.get_by_role("link", name="Explore observations").count() == 1
        and pg.get_by_role("button", name="Drop a pin anywhere").count() == 1
        and tanguar_card.locator("a[href='/wetland']").count() == 1,
    )
    check("landing: 3D globe canvas renders", pg.locator(".globe-mount canvas").count() == 1)
    check("landing: real-case marker on the globe", pg.locator(".globe-tag--case").count() >= 1)
    check(
        "landing: forest/volcano cards link to global briefings",
        pg.locator(".g3-domain-card[data-domain='forest'] a[href='/forest/global']").count() == 1
        and pg.locator(".g3-domain-card[data-domain='volcano'] a[href='/volcano/global']").count() == 1,
    )
    check(
        "landing: agriculture card links to the SME2 workspace",
        pg.locator(".g3-domain-card[data-domain='agriculture'] a[href='/agriculture']").count() == 1,
    )
    check("landing: brand is GeoNexSAR", "geonexsar" in pg.inner_text("body").lower())
    ticker = pg.inner_text(".g3-ticker").lower()
    check(
        "landing: ticker reports the real Tanguar comparison series",
        "tanguar comparison dates" in ticker
        and "km² peak radar-change candidate area" in ticker
        and ticker.strip()[0] != "0",
    )
    pg.locator(".hydro").scroll_into_view_if_needed()
    hydro_values_match = True
    hydro_samples = []
    for _ in range(8):
        pg.wait_for_timeout(220)
        current_value = pg.locator("[data-testid='hydro-current-value']").inner_text().strip()
        active_value = pg.locator(".hydro-bar.is-active .hydro-val").inner_text().strip()
        hydro_samples.append(current_value)
        try:
            hydro_values_match = hydro_values_match and current_value == active_value and float(current_value) >= 0
        except ValueError:
            hydro_values_match = False
    check(
        "landing: animated hydrograph value matches its active date and never becomes negative",
        hydro_values_match,
        f"samples={hydro_samples}",
    )
    tanguar_card.locator("a[href='/wetland']").click(); pg.wait_for_url("**/wetland", timeout=20000)
    check("landing -> Tanguar case navigation", pg.url.rstrip("/").endswith("/wetland"))

    # ── global mission control (live UI: FIELD ASSIGNMENT explorer) ──
    pg.goto(BASE + "/wetland/global"); pg.wait_for_selector(".global-map-wrap", timeout=25000); pg.wait_for_timeout(5000); t = pg.inner_text("body")
    check("explore: field assignment explorer loads", "FIELD ASSIGNMENT" in t and "Explore NISAR across the world" in t)
    check("explore: honest empty state, no selected study", "No processed study selected" in t)
    check("explore: empty state surfaces the featured Tanguar case", "explore the featured Tanguar Haor case" in t and pg.locator('.global-quest-empty a[href="/wetland"]').count() == 1)
    check("explore: real scene footprints counted", "scene footprints" in t)
    check("explore: footprints described as acquisitions, not detections", "Worldwide footprints show acquisitions, not detections" in t)
    check("explore: backscatter is not a flood classification", "it is not a flood classification" in t)
    check("explore: blank map areas are not classified", "A blank map area has no processed result" in t)
    check("explore: process-another-place entry exists", "Process another place" in t)
    check("explore: case walkthrough entry exists", "Start case walkthrough" in t)
    check("explore: map renders", pg.locator("#global-nisar-map").count() == 1)
    # The homepage's primary CTA opens the global observation explorer.
    pg.goto(BASE + "/"); pg.wait_for_timeout(3000)
    pg.get_by_role("link", name="Explore observations").click()
    pg.wait_for_url("**/wetland/global")
    check("homepage -> global observation explorer navigation", True)
    for w in (1100, 820, 390):
        pg.set_viewport_size({"width": w, "height": 900}); pg.wait_for_timeout(600)
        check(f"explore: no horizontal overflow at {w}px", not pg.evaluate("document.documentElement.scrollWidth > innerWidth"))
    # ── phenomena briefings ──
    pg.set_viewport_size({"width": 1440, "height": 900})
    for route, framing in (("/forest", ("exploratory", "candidate", "limited")), ("/volcano", ("interferogram", "published", "check whether"))):
        pg.goto(BASE + route); pg.wait_for_timeout(1500)
        body = pg.inner_text("body")
        check(f"{route}: workspace loads with honest framing",
              route.strip("/") in body.lower() and any(word in body.lower() for word in framing))
    b.close()
bad = results.count(False)
print(f"\n{len(results) - bad}/{len(results)} checks passed; application errors: {errors or 'none'}")
sys.exit(1 if bad or errors else 0)
