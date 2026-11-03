"""End-to-end browser checks for the real Tanguar Haor showcase. No new npm dependency: uses Python Playwright.

    npm run build && npx next start -p 3140 &        # in one shell
    python tests/e2e/wetland_smoke.py http://localhost:3140

Exits non-zero if any check fails. Network failures for remote map tiles are ignored (offline CI),
every other console/page error fails the run.
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3140"
results, errors = [], []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

with sync_playwright() as p:
    browser = p.chromium.launch(); page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script("localStorage.setItem('geonexsar_tour_v1','1')")  # suppress the first-run tour in tests
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append(m.text[:160]) if m.type == "error" and not any(s in m.text for s in ("ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "ERR_TUNNEL_CONNECTION_FAILED", "404 (Not Found)")) else None)
    # /api/wetland/runs and /api/wetland/nisar-detections 404 gracefully when no local pipeline run exists — expected here.
    page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 400 and BASE in r.url and not (r.status == 404 and any(s in r.url for s in ("/api/wetland/runs", "/api/wetland/nisar-detections"))) else None)

    page.goto(BASE + "/wetland"); page.wait_for_selector(".wx-obs", timeout=20000); page.wait_for_timeout(2500)
    text = page.inner_text("body")
    check("real showcase badge", "Real NISAR showcase" in text and page.get_attribute(".wx-root", "data-tier") == "SHOWCASE")
    check("Tanguar Haor remains the default case", "Tanguar Haor" in page.inner_text(".wx-rail") and page.locator(".wx-casepick").input_value() == "featured")
    check("seven real acquisition dates", page.locator(".wx-obs").count() == 7, str(page.locator(".wx-obs").count()))
    check("24-day gap labelled, nothing between dates", "24-day gap" in text)
    check("295 regions drawn at the peak", page.locator("path.wx-patch").count() == 295, str(page.locator("path.wx-patch").count()))
    page.click(".wx-play"); page.wait_for_timeout(300)  # pause the autoplay that starts on load
    page.click(".wx-obs >> nth=4"); page.wait_for_timeout(600)  # the Aug-29 peak observation
    check("peak 24.48 km2 shown", "24.48" in page.inner_text(".wx-rail"))
    check("no 'confirmed flood' claim", "confirmed flood" not in text.lower() or "not confirmed flood" in text.lower())

    # timeline + playback only through real dates
    seen = []
    page.click(".wx-obs >> nth=0"); page.wait_for_timeout(900); seen.append(page.inner_text(".wx-now strong"))
    page.click(".wx-play"); 
    for _ in range(14):
        page.wait_for_timeout(800); d = page.inner_text(".wx-now strong")
        if not seen or d != seen[-1]: seen.append(d)
    page.click(".wx-play") if page.locator(".wx-play[aria-pressed=true]").count() else None
    real = {"Jun 30, 2026", "Jul 12, 2026", "Jul 24, 2026", "Aug 17, 2026", "Aug 29, 2026", "Sep 10, 2026", "Sep 22, 2026"}
    check("playback visits only real acquisition dates", set(seen) <= real and len(seen) >= 4, " > ".join(seen))
    page.click(".wx-obs >> nth=4"); page.wait_for_timeout(1200)
    check("scrubbing syncs date and region count", "Aug 29, 2026" in page.inner_text(".wx-now") and "295" in page.inner_text(".wx-now"))

    # modes
    for mode in ("Radar", "Detection", "Explain", "Motion"):
        page.click(f".wx-modes button[data-mode='{mode.upper()}']"); page.wait_for_timeout(500)
        check(f"mode {mode} selectable", page.get_attribute(f".wx-modes button[data-mode='{mode.upper()}']", "aria-checked") == "true")
    page.click(".wx-modes button[data-mode='RADAR']"); page.wait_for_timeout(1500)
    check("radar view states which layer is shown", "HH" in page.inner_text(".wx-radar__now") and "2026-08-29" in page.inner_text(".wx-radar__now"))
    check("radar image overlay loaded", page.locator(".leaflet-wxRadar-pane img").count() == 1)
    page.click(".wx-radar__row >> nth=1 >> button >> nth=2"); page.wait_for_timeout(800)
    check("HV change layer selectable", "HV" in page.inner_text(".wx-radar__now") and "Change" in page.inner_text(".wx-radar__now"))
    page.click(".wx-modes button[data-mode='MOTION']")

    # investigate a region + challenge
    page.locator("path.wx-patch").nth(40).click(force=True); page.wait_for_timeout(700)
    drawer = page.inner_text(".wx-drawer").lower()
    check("Why this region? opens with evidence", "why this region?" in drawer and "what do we actually know?" in drawer and "limitation" in drawer)
    check("evidence uses pipeline semantics", "previous date" in drawer and "compact footprint" in drawer)
    page.evaluate("document.querySelector('.wx-drawer__body').scrollTop = 99999"); page.click("text=Challenge this detection"); page.wait_for_timeout(400)
    d2 = page.inner_text(".wx-drawer")
    check("challenge lists real checks + no field truth", "Can we trust this change?" in d2 and "No field truth" in d2 and "threshold" in d2.lower())
    check("no confidence score invented", "%" not in "".join(page.locator(".wx-status").all_inner_texts()) and "confidence" not in d2.lower())

    def open_tab(label):
        tab = page.locator(".wx-tab", has_text=label)
        if tab.get_attribute("aria-selected") != "true":
            tab.click(); page.wait_for_timeout(500)
        return page.inner_text(".wx-drawer")
    t = open_tab("Check it")
    check("sensitivity shows stored sweep + SENSITIVE verdict", "Sensitive to the cutoff" in t and "10.9" in t and "53.7" in t and "not re-run" in t, t[:0])
    check("sensitivity does not claim recompute", "recomputes" not in t.lower())
    check("independent check inconclusive, coverage visible", "Inconclusive" in t and "0.3%" in t and "20.0%" in t)
    check("zero scores not emphasised", "Raw comparison numbers (not meaningful at this coverage)" in t and page.locator("details.wx-raw[open]").count() == 0)
    check("optical evidence images present", page.locator(".wx-optical-imgs img").count() >= 4, str(page.locator(".wx-optical-imgs img").count()))
    t = open_tab("Explore"); check("story from loaded values", "295 candidate regions covering 24.48" in t and "rather than confirmed flooding" in t)
    t = open_tab("Learn"); check("data chain has six steps", page.locator(".wx-chain li").count() == 6)
    page.click(".wx-chain li button >> nth=3"); check("data chain step expands", page.locator(".wx-chain__tech").count() == 1)
    check("why radar explains clouds", "Cloud" in t)
    tl = t.lower(); check("provenance separates observed/derived/context", "observed" in tl and "derived" in tl and "context" in tl and "nisar_l2_gcov_provisional_v1" in tl)
    # SAR Detective now lives inside the Explore tab
    open_tab("Explore"); page.click(".wx-detective"); page.wait_for_timeout(300)
    page.mouse.click(760, 400); page.wait_for_timeout(500); t = page.inner_text(".wx-drawer")
    check("SAR Detective labels region averages", "Region average" in t or "No detector result" in t)
    check("detective never claims per-pixel", "single raster cell" not in t.lower())
    page.click(".wx-detective"); page.wait_for_timeout(300)
    # lock comparison section inside Explore
    page.evaluate("document.querySelector('.wx-drawer__body').scrollTop = 99999")
    page.select_option(".wx-form label:nth-child(1) select", index=0); page.select_option(".wx-form label:nth-child(2) select", index=4)
    page.click("text=Lock these two dates"); page.wait_for_timeout(1500)
    check("lock comparison shows two labelled dates", page.locator(".wx-split").count() == 1 and "Jun 30" in page.inner_text(".wx-split-label--l") and "Aug 29" in page.inner_text(".wx-split-label--r"))
    page.focus(".wx-split"); page.keyboard.press("ArrowRight"); check("split divider keyboard accessible", int(page.get_attribute(".wx-split", "aria-valuenow")) > 50)
    page.click("text=Reset comparison"); check("comparison resets", page.locator(".wx-split").count() == 0)
    page.click(".wx-drawer__bar button"); check("drawer closes", page.locator(".wx-drawer").count() == 0)
    page.click("text=Return to overview"); page.wait_for_timeout(800); check("return to overview clears state", page.locator(".wx-drawer").count() == 0 and "Aug 29, 2026" in page.inner_text(".wx-now"))

    # keyboard: regions are not Tab stops, and a keyboard path to investigate a region exists
    page.click("text=Return to overview"); page.wait_for_timeout(500)
    check("map regions are not keyboard tab stops", page.evaluate("[...document.querySelectorAll('path.wx-patch')].every(p => p.getAttribute('tabindex') === '-1')"))
    page.locator(".wx-tab", has_text="Explore").focus(); page.keyboard.press("Enter"); page.wait_for_timeout(400)
    page.locator(".wx-regions button").first.focus(); page.keyboard.press("Enter"); page.wait_for_timeout(500)
    check("keyboard user can investigate a region from the list", "can we trust" in page.inner_text(".wx-drawer").lower() or "what do we actually know" in page.inner_text(".wx-drawer").lower())
    page.keyboard.press("Escape"); page.wait_for_timeout(300)
    # keyboard focus + accessible names
    nameless = page.evaluate("[...document.querySelectorAll('.wx-root button')].filter(b => !(b.innerText || '').trim() && !b.getAttribute('aria-label')).length")
    check("every icon-only control has an accessible name", nameless == 0, str(nameless))

    # narrower viewports
    for w, h in ((1100, 760), (820, 900), (390, 800)):
        page.set_viewport_size({"width": w, "height": h}); page.wait_for_timeout(700)
        over = page.evaluate("document.documentElement.scrollWidth > innerWidth")
        check(f"no horizontal overflow at {w}px", not over)
        page.screenshot(path=f"/tmp/e2e_wetland_{w}.png")
    page.set_viewport_size({"width": 1440, "height": 900})
    page.screenshot(path="/tmp/e2e_wetland_1440.png")

    # ── 3D landing ──
    norm = lambda s: " ".join(s.split()).lower()
    page.goto(BASE + "/"); page.wait_for_selector(".globe-mount canvas", timeout=25000); page.wait_for_timeout(4500)
    check("landing globe renders", page.locator(".globe-mount canvas").count() == 1)
    check("landing title", "watch earth breathe" in norm(page.inner_text(".g3-title")))
    check("telemetry ticker", "radar observations" in norm(page.inner_text(".g3-ticker")))
    page.wait_for_selector(".hydro-val", timeout=15000)
    pulse_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "showcase", "featured", "pulse.json")
    saved = json.load(open(pulse_path))
    expected_vals = [f"{d['area_km2']:.1f}" for d in saved["dates"]]
    rendered_vals = page.eval_on_selector_all(".hydro-val", "els => els.map(e => e.textContent.trim())")
    check("hydrograph matches saved pulse", rendered_vals == expected_vals, f"rendered={rendered_vals} saved={expected_vals}")
    check("hydrograph label is honest", "radar-change candidate area" in page.inner_text(".hydro-meta"))
    page.get_by_role("button", name="Drop a pin anywhere").click(); page.wait_for_timeout(400)
    check("pin mode arms", "Pin mode armed" in page.inner_text(".g3-pinbar"))
    page.mouse.click(900, 420); page.wait_for_timeout(800)  # click the globe, right of the title block
    check("globe click drops a pin", "Grow the wetland at" in page.inner_text("body"))
    href = page.get_attribute(".g3-pinbar a", "href") or ""
    check("pin links to a located sandbox", href.startswith("/wetland?sandbox=1&lat=") and "lng=" in href, href)
    check("preset pins exist", page.locator(".g3-preset").count() == 3)
    page.screenshot(path="/tmp/e2e_landing.png")

    # ── anywhere-on-earth sandbox (Amazon) ──
    page.goto(BASE + "/wetland?sandbox=1&lat=-2.60&lng=-62.10")
    page.wait_for_selector(".wx-obs", timeout=20000); page.wait_for_timeout(2500)
    check("located sandbox tier", page.get_attribute(".wx-root", "data-tier") == "SANDBOX")
    check("located sandbox names its coordinates", "2.60°S" in page.inner_text(".wx-rail") and "62.10°W" in page.inner_text(".wx-rail"))
    check("located sandbox grows regions", page.locator("path.wx-patch").count() > 0, str(page.locator("path.wx-patch").count()))
    page.screenshot(path="/tmp/e2e_sandbox_amazon.png")

    # ── global mission control ──
    page.goto(BASE + "/wetland/global"); page.wait_for_selector(".global-map-wrap", timeout=25000); page.wait_for_timeout(4000)
    check("mission-control header", "Mission control" in page.inner_text(".global-header"))
    bg = page.evaluate("getComputedStyle(document.querySelector('.detection-page')).backgroundColor")
    check("global page uses the dark radar-room skin", bg in ("rgb(7, 9, 13)", "rgb(7,9,13)"), bg)
    check("featured case present", "Tanguar Haor" in page.inner_text(".atlas-featured"))
    check("global header is GeoNexSAR", "GeoNexSAR" in page.inner_text(".global-header") and "Beyonders" not in page.inner_text(".global-header"))
    page.screenshot(path="/tmp/e2e_global.png")

    # ── multi-case showcase plumbing ──
    idx = page.evaluate("fetch('/showcase/index.json').then(r => r.json())")
    check("case index lists Tanguar and Hakaluki", isinstance(idx.get("cases"), list) and {"featured", "hakaluki"}.issubset({c.get("id") for c in idx["cases"]}), str([c.get("id") for c in idx.get("cases", [])]))
    page.goto(BASE + "/wetland?case=featured"); page.wait_for_selector(".wx-obs", timeout=20000); page.wait_for_timeout(2500)
    check("case deep link loads the showcase tier", page.get_attribute(".wx-root", "data-tier") == "SHOWCASE")
    # Two independently published seven-date cases share the same real-data interaction.
    picker = page.locator(".wx-casepick")
    check("case selector offers both real wetland studies", picker.count() == 1 and picker.locator("option").count() == 2)
    picker.select_option("hakaluki")
    page.wait_for_function("() => document.querySelector('.wx-rail h1')?.textContent?.includes('Hakaluki Haor')", timeout=20000)
    page.wait_for_function("() => document.querySelectorAll('path.wx-patch').length === 213", timeout=20000)
    check("Hakaluki loads its own seven-date NISAR series", page.locator(".wx-obs").count() == 7 and "Hakaluki Haor" in page.inner_text(".wx-rail"))
    check("Hakaluki peak and candidate regions match its published study", "2.57" in page.inner_text(".wx-rail") and page.locator("path.wx-patch").count() == 213)
    picker.select_option("featured")
    page.wait_for_function("() => document.querySelector('.wx-rail h1')?.textContent?.includes('Tanguar Haor')", timeout=20000)
    page.wait_for_function("() => document.querySelectorAll('path.wx-patch').length === 295", timeout=20000)
    check("switching back restores the Tanguar observation and geometry", page.locator(".wx-obs").count() == 7 and page.locator("path.wx-patch").count() == 295)
    chokwe_nav = page.get_by_role("link", name="Open the Chókwè flood-event investigation")
    check("Chókwè is directly discoverable from the wetland workspace", chokwe_nav.get_attribute("href") == "/wetland/global?story=chokwe")

    # ── landing: real-case globe marker ──
    page.goto(BASE + "/"); page.wait_for_timeout(9000)
    check("globe renders a real-case marker label", page.locator(".globe-tag--case").count() >= 1, str(page.locator(".globe-tag--case").count()))
    check("marker names Tanguar Haor", "TANGUAR HAOR" in page.inner_text(".globe-tag--case"))
    check("home brand is GeoNexSAR only", "geonexsar" in page.inner_text(".g3-top").lower() and "beyonders" not in page.inner_text("body").lower())
    page.screenshot(path="/tmp/e2e_landing_marker.png")

    # ── Forest and Volcano module routes open their published interactive cases ──
    page.goto(BASE + "/forest"); page.wait_for_selector(".forest-comparison", timeout=25000); page.wait_for_timeout(1500)
    check("Forest opens the published Rondônia case", "What changed in the forest?" in page.inner_text(".wx-quest"))
    check("Forest exposes paired radar/optical maps", page.locator(".forest-comparison-map").count() == 2)
    check("Forest exposes selectable observation dates", page.locator(".forest-date-ribbon button").count() >= 4)
    page.goto(BASE + "/volcano"); page.wait_for_selector(".deformation-map-hint", timeout=25000); page.wait_for_timeout(1500)
    check("Volcano opens the published Hayli Gubbi case", "What moved beneath Erta Ale?" in page.inner_text(".wx-quest"))
    check("Volcano exposes selectable NISAR intervals", page.locator(".deformation-timeline button").count() >= 3)
    check("Hayli Gubbi links to the Kīlauea episode study", page.get_by_role("link", name="Explore the Kīlauea · Episode 36 case ↗").count() == 1)
    browser.close()

bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)}/{len(results)} checks passed; application errors: {errors or 'none'}")
sys.exit(1 if bad or errors else 0)
