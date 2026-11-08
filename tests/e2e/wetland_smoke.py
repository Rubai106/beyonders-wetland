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
    page.click(".wx-play"); page.wait_for_timeout(300)  # pause the autoplay that starts on load
    page.click(".wx-obs >> nth=4")  # the Aug-29 peak observation
    # Payloads are SHA-256-verified as they load; wait for the selected date's regions instead of a fixed sleep.
    try:
        page.wait_for_function("() => document.querySelector('.wx-count')?.textContent.includes('295 regions')", timeout=15000)
    except Exception:
        pass
    check("295 regions drawn at the peak", page.locator("path.wx-patch").count() == 295, str(page.locator("path.wx-patch").count()))
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

    # modes (live UI has MOTION / RADAR / DETECTION only; no EXPLAIN mode)
    for mode in ("Radar", "Detection", "Motion"):
        page.click(f".wx-modes button[data-mode='{mode.upper()}']"); page.wait_for_timeout(500)
        check(f"mode {mode} selectable", page.get_attribute(f".wx-modes button[data-mode='{mode.upper()}']", "aria-checked") == "true")
    page.click(".wx-modes button[data-mode='RADAR']"); page.wait_for_timeout(1500)
    # Live radar UI is a picker: open it, then check the layer trigger states HH + date.
    page.click(".wx-radar-trigger"); page.wait_for_timeout(500)
    check("radar view states which layer is shown", "HH" in page.inner_text(".wx-radar-trigger") and "2026-08-29" in page.inner_text(".wx-radar__head"))
    check("radar image overlay loaded", page.locator(".leaflet-wxRadar-pane img").count() == 1)
    page.click(".wx-radar__row >> nth=1 >> button >> nth=2"); page.wait_for_timeout(800)
    check("HV change layer selectable", "HV" in page.inner_text(".wx-radar-trigger") and "Change" in page.inner_text(".wx-radar-trigger"))
    page.click(".wx-modes button[data-mode='MOTION']")

    # investigate a region + challenge
    page.locator("path.wx-patch").nth(40).click(force=True); page.wait_for_timeout(700)
    drawer = page.inner_text(".wx-drawer").lower()
    check("Why this region? opens with evidence", "why this region?" in drawer and "what do we actually know?" in drawer and "limitation" in drawer)
    check("evidence uses pipeline semantics", "previous date" in drawer and "compact footprint" in drawer)
    page.evaluate("document.querySelector('.wx-drawer__body').scrollTop = 99999"); page.click("text=Challenge this detection"); page.wait_for_timeout(400)
    d2 = page.inner_text(".wx-drawer")
    check("challenge lists real checks + no field truth", "Can we trust this change?" in d2 and "No field truth" in d2 and "threshold" in d2.lower())
    check("no confidence score invented", "%" not in "".join(page.locator(".wx-status").all_inner_texts()) and "no probability, confidence score" in d2.lower())

    def open_tab(label):
        tab = page.get_by_role("tab", name=label)
        if tab.get_attribute("aria-selected") != "true":
            tab.click(); page.wait_for_timeout(500)
        return page.inner_text(".wx-drawer")
    t = open_tab("Check it")
    check("sensitivity shows stored sweep + SENSITIVE verdict", "Sensitive to the cutoff" in t and "10.9" in t and "53.7" in t and "does not rerun the detector" in t, t[:0])
    check("sensitivity does not claim recompute", "recomputes" not in t.lower())
    check("independent check inconclusive, coverage visible", "Inconclusive" in t and "0.3%" in t and "20.0%" in t)
    check("zero scores not emphasised", "Raw comparison numbers (not meaningful at this coverage)" in t and page.locator("details.wx-raw[open]").count() == 0)
    check("optical evidence images present", page.locator(".wx-optical-imgs img").count() >= 4, str(page.locator(".wx-optical-imgs img").count()))
    t = open_tab("Explore"); check("story from loaded values", "295 candidate regions covering 24.48" in t and "rather than confirmed flooding" in t)
    t = open_tab("Learn"); check("data chain has six steps", page.locator(".wx-chain li").count() == 6)
    page.click(".wx-chain li button >> nth=3"); check("data chain step expands", page.locator(".wx-chain__tech").count() == 1)
    check("why radar explains clouds", "cloud" in t.lower())
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
    page.get_by_role("button", name="Close panel").click(); page.wait_for_timeout(400)
    check("drawer closes", page.locator(".wx-drawer").count() == 0)
    page.click("text=Return to overview"); page.wait_for_timeout(800); check("return to overview clears state", page.locator(".wx-drawer").count() == 0 and "Aug 29, 2026" in page.inner_text(".wx-now"))

    # keyboard: regions are not Tab stops, and a keyboard path to investigate a region exists
    page.click("text=Return to overview"); page.wait_for_timeout(500)
    check("map regions are not keyboard tab stops", page.evaluate("[...document.querySelectorAll('path.wx-patch')].every(p => p.getAttribute('tabindex') === '-1')"))
    page.click(".wx-drawer-reopen"); page.wait_for_timeout(400)  # reopen the drawer after returning to overview
    page.get_by_role("tab", name="Explore").focus(); page.keyboard.press("Enter"); page.wait_for_timeout(400)
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
    check("landing title states the evidence-first proposition", "earth change" in norm(page.inner_text(".g3-title")) and "under scrutiny" in norm(page.inner_text(".g3-title")))
    check("telemetry ticker reports the real Tanguar series", "tanguar comparison dates" in norm(page.inner_text(".g3-ticker")) and norm(page.inner_text(".g3-ticker"))[0] != "0")
    page.wait_for_selector(".hydro-val", timeout=15000)
    pulse_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "showcase", "featured", "pulse.json")
    saved = json.load(open(pulse_path))
    expected_vals = [f"{d['area_km2']:.1f}" for d in saved["dates"]]
    rendered_vals = page.eval_on_selector_all(".hydro-val", "els => els.map(e => e.textContent.trim())")
    check("hydrograph matches saved pulse", rendered_vals == expected_vals, f"rendered={rendered_vals} saved={expected_vals}")
    check("hydrograph label is honest", "radar-change candidate area" in page.inner_text(".hydro-meta"))
    page.locator(".hydro").scroll_into_view_if_needed()
    live_values_match = True
    live_samples = []
    for _ in range(8):
        page.wait_for_timeout(220)
        current_text = page.locator("[data-testid='hydro-current-value']").inner_text().strip()
        active_text = page.locator(".hydro-bar.is-active .hydro-val").inner_text().strip()
        live_samples.append(current_text)
        try:
            live_values_match = live_values_match and current_text == active_text and float(current_text) >= 0
        except ValueError:
            live_values_match = False
    check(
        "hydrograph live value matches the active published date and is non-negative",
        live_values_match,
        f"samples={live_samples}",
    )
    page.get_by_role("button", name="Drop a pin anywhere").click(); page.wait_for_timeout(400)
    check("pin mode arms", "Choose a study location" in page.inner_text(".g3-pinbar"))
    page.mouse.click(900, 420); page.wait_for_timeout(800)  # click the globe, right of the title block
    check("globe click drops a pin", "Check real observations at" in page.inner_text("body"))
    href = page.get_attribute(".g3-pinbar a", "href") or ""
    check("pin links to the global investigator", href.startswith("/wetland/global?latitude=") and "longitude=" in href and "analyze=1" in href, href)
    domain_cards = page.locator(".g3-domain-card")
    check("four concise scientific workspace entries exist", domain_cards.count() == 4)
    check("all four domain entries have a working primary route", all(
        domain_cards.nth(i).locator(".g3-domain-card__actions a").count() >= 1
        for i in range(4)
    ))
    page.screenshot(path="/tmp/e2e_landing.png")

    # ── pin link follow-through: the pinned area opens in the global investigator ──
    page.goto(BASE + href)
    page.wait_for_selector(".global-map-wrap", timeout=25000); page.wait_for_timeout(4000)
    check("pinned area loads in the global investigator", "Pinned study area" in page.inner_text("body"))
    lat = href.split("latitude=")[1].split("&")[0][:5]
    check("pinned coordinates are shown", lat in page.inner_text("body"), lat)
    page.screenshot(path="/tmp/e2e_pinned_area.png")

    # ── global mission control (live UI: FIELD ASSIGNMENT explorer, honest empty state) ──
    page.goto(BASE + "/wetland/global"); page.wait_for_selector(".global-map-wrap", timeout=25000); page.wait_for_timeout(4000)
    # The overhaul removed the duplicate brand link from the workspace
    # masthead (the shared primary nav now carries the brand on every page),
    # so the brand is read from the nav, not from the first <header>.
    brand_text = page.inner_text(".hazard-nav__brand")
    body_text = page.inner_text("body")
    check("global header is the field assignment explorer", "FIELD ASSIGNMENT" in body_text and "Explore NISAR across the world" in body_text)
    check("global page is honest about no selected study", "No processed study selected" in body_text)
    check("global page shows real scene footprints", "scene footprints" in body_text)
    check("global header shows the BEYONDERS brand", "BEYONDERS" in brand_text or "Beyonders" in brand_text or "GeoNexSAR" in brand_text)
    page.screenshot(path="/tmp/e2e_global.png")

    # ── multi-case showcase plumbing ──
    idx = page.evaluate("fetch('/showcase/index.json').then(r => r.json())")
    check("case index lists the packaged case", isinstance(idx.get("cases"), list) and any(c.get("id") == "featured" for c in idx["cases"]), str([c.get("id") for c in idx.get("cases", [])]))
    page.goto(BASE + "/wetland?case=featured"); page.wait_for_selector(".wx-obs", timeout=20000); page.wait_for_timeout(2500)
    check("case deep link loads the showcase tier", page.get_attribute(".wx-root", "data-tier") == "SHOWCASE")
    # master ships two packaged cases: the picker is present and defaults to Tanguar
    check("two-case picker defaults to Tanguar", page.query_selector(".wx-casepick") is not None and page.locator(".wx-casepick").input_value() == "featured" and "Tanguar Haor" in page.inner_text("body"))

    # ── landing: real-case globe marker ──
    page.goto(BASE + "/"); page.wait_for_timeout(9000)
    check("globe renders a real-case marker label", page.locator(".globe-tag--case").count() >= 1, str(page.locator(".globe-tag--case").count()))
    check("marker names Tanguar Haor", "Tanguar Haor" in " | ".join(page.locator(".globe-tag--case").all_inner_texts()))
    # The landing header (.g3-top) was removed by the overhaul redesign; the
    # brand now lives in the shared primary nav on every page.
    check("home brand present", "geonexsar" in page.inner_text(".hazard-nav__brand").lower() or "beyonders" in page.inner_text("body").lower())
    page.screenshot(path="/tmp/e2e_landing_marker.png")

    # ── forest + volcano workspaces (real pages, not retired briefing screens) ──
    page.goto(BASE + "/forest"); page.wait_for_timeout(1500)
    body = page.inner_text("body")
    check("/forest renders the workspace", "What changed in the forest?" in body and "Rondônia" in body)
    check("/forest is honest about change results", "not confirmed clearing" in body and "not a forest-loss estimate" in body)
    page.goto(BASE + "/volcano"); page.wait_for_timeout(1500)
    body = page.inner_text("body")
    check("/volcano renders the workspace", "What moved beneath Erta Ale?" in body and "Hayli Gubbi" in body)
    check("/volcano is honest about interferogram availability", "not an eruption prediction" in body and "apparent LOS change" in body)
    browser.close()

bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)}/{len(results)} checks passed; application errors: {errors or 'none'}")
sys.exit(1 if bad or errors else 0)
