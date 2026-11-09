"""End-to-end browser checks for the real Tanguar Haor showcase. No new npm dependency: uses Python Playwright.

    npm run build && npx next start -p 3140 &        # in one shell
    python tests/e2e/wetland_smoke.py http://localhost:3140

Exits non-zero if any check fails. Network failures for remote map tiles are ignored (offline CI),
every other console/page error fails the run.
"""
import json
import os
import sys
from datetime import datetime
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

    # map view (MOTION / RADAR / DETECTION) and the four real radar raster comparison modes
    for mode in ("Radar", "Detection", "Motion"):
        page.click(f".wx-modes button[data-mode='{mode.upper()}']"); page.wait_for_timeout(500)
        check(f"mode {mode} selectable", page.get_attribute(f".wx-modes button[data-mode='{mode.upper()}']", "aria-checked") == "true")
    for map_mode in ("BEFORE", "AFTER", "DIFFERENCE", "SPLIT"):
        page.click(f".wx-mapmodes button[data-map-mode='{map_mode}']")
        page.wait_for_function("(mode) => document.querySelector('.wx-root')?.dataset.mapMode === mode", arg=map_mode, timeout=5000)
        page.wait_for_function("document.querySelector('.wx-modes button[data-mode=RADAR]')?.getAttribute('aria-checked') === 'true'", timeout=5000)
        if map_mode == "SPLIT":
            page.wait_for_function("""() => {
                const before = document.querySelector('.leaflet-wxRadarBefore-pane img');
                const afterPane = document.querySelector('.leaflet-wxRadarAfter-pane');
                const after = afterPane?.querySelector('img');
                return !!before && !!after && Boolean(afterPane.style.clipPath);
            }""", timeout=10000)
            split_slider = page.locator(".wx-stage .wx-radar-split[role='slider']")
            split_before = split_slider.get_attribute("aria-valuenow")
            split_slider.focus()
            page.keyboard.press("ArrowRight")
            page.wait_for_function("(before) => document.querySelector('.wx-stage .wx-radar-split')?.getAttribute('aria-valuenow') !== before", arg=split_before, timeout=3000)
            check("split mode renders baseline and after images with an adjustable divider",
                  page.locator(".leaflet-wxRadarBefore-pane img").count() == 1
                  and page.locator(".leaflet-wxRadarAfter-pane img").count() == 1
                  and page.locator(".leaflet-wxRadarAfter-pane").evaluate("(el) => Boolean(el.style.clipPath)")
                  and split_slider.get_attribute("aria-valuenow") != split_before)
        else:
            page.wait_for_function("document.querySelectorAll('.leaflet-wxRadar-pane img').length === 1", timeout=10000)
            check(f"map mode {map_mode} selects the correct single raster view",
                  page.get_attribute(".wx-root", "data-map-mode") == map_mode
                  and page.get_attribute(f".wx-mapmodes button[data-map-mode='{map_mode}']", "aria-checked") == "true"
                  and page.locator(".leaflet-wxRadar-pane img").count() == 1)
    page.click(".wx-mapmodes button[data-map-mode='DIFFERENCE']")
    page.wait_for_timeout(500)
    # Polarization is independent of the comparison mode.
    page.click(".wx-radar-trigger"); page.wait_for_timeout(500)
    check("radar controls identify polarization, comparison mode and acquisition date",
          "HH" in page.inner_text(".wx-radar-trigger")
          and "Difference" in page.inner_text(".wx-radar-trigger")
          and "2026-08-29" in page.inner_text(".wx-radar__head"))
    check("radar difference overlay loaded", page.locator(".leaflet-wxRadar-pane img").count() == 1)
    page.locator(".wx-radar__row button[data-channel='HV']").click(); page.wait_for_timeout(800)
    check("HV polarization selectable without changing the comparison mode",
          "HV" in page.inner_text(".wx-radar-trigger")
          and "Difference" in page.inner_text(".wx-radar-trigger")
          and page.get_attribute(".wx-root", "data-map-mode") == "DIFFERENCE")
    page.click(".wx-modes button[data-mode='MOTION']")

    # investigate a region + challenge
    page.locator("path.wx-patch").nth(40).click(force=True); page.wait_for_timeout(700)
    drawer = page.inner_text(".wx-drawer").lower()
    check("Why this region? opens with evidence", "why this region?" in drawer and "what do we actually know?" in drawer and "limitation" in drawer)
    check("evidence uses pipeline semantics", "previous date" in drawer and "compact footprint" in drawer)
    region_nav = page.locator(".wx-region-nav")
    initial_region_id = region_nav.get_attribute("data-region-id")
    next_region = region_nav.get_by_role("button", name="Next region")
    previous_region = region_nav.get_by_role("button", name="Previous region")
    navigated_forward = next_region.is_enabled()
    returned_to_original = False
    if navigated_forward:
        next_region.click()
        page.wait_for_function("(id) => document.querySelector('.wx-region-nav')?.dataset.regionId !== id", arg=initial_region_id)
        previous_region.click()
        page.wait_for_function("(id) => document.querySelector('.wx-region-nav')?.dataset.regionId === id", arg=initial_region_id)
        returned_to_original = region_nav.get_attribute("data-region-id") == initial_region_id
    check(
        "next and previous region controls navigate within the investigation drawer",
        navigated_forward and returned_to_original
        and "Largest area first" in region_nav.inner_text()
        and int(region_nav.get_attribute("data-total") or "0") > 1,
        f"initial={initial_region_id}, current={region_nav.get_attribute('data-region-id')}",
    )
    region_context = page.locator(".wx-region-context")
    region_context_data = region_context.evaluate("""el => ({
        regionId: el.dataset.regionId,
        total: Number(el.dataset.total),
        areaRank: Number(el.dataset.areaRank),
        deltaRank: Number(el.dataset.deltaRank),
        text: el.innerText
    })""")
    check(
        "candidate context is scoped to the selected acquisition and not a confidence score",
        region_context_data["regionId"] == region_nav.get_attribute("data-region-id")
        and region_context_data["total"] == int(region_nav.get_attribute("data-total") or "0")
        and region_context_data["areaRank"] == int(region_nav.get_attribute("data-position") or "0")
        and 1 <= region_context_data["deltaRank"] <= region_context_data["total"]
        and "Median candidate area" in region_context_data["text"]
        and "Median |ΔHH|" in region_context_data["text"]
        and "not detection confidence" in region_context_data["text"].lower(),
        str(region_context_data),
    )
    with page.expect_download() as evidence_download:
        page.get_by_role("button", name="Download this region's evidence brief").click()
    download = evidence_download.value
    brief_path = download.path()
    with open(brief_path, encoding="utf-8") as brief_file:
        region_brief = json.load(brief_file)
    check(
        "selected-region evidence export preserves provenance, checks and scientific caveats",
        download.suggested_filename.endswith("-evidence.json")
        and region_brief.get("record_type") == "beyonders.wetland.region-evidence"
        and region_brief.get("source", {}).get("data_source") == "NISAR"
        and region_brief.get("candidate_region", {}).get("id") == region_context_data["regionId"]
        and region_brief.get("observation", {}).get("date") == "2026-08-29"
        and len(region_brief.get("evidence_checks", [])) == 8
        and any("not a confirmed flood" in item for item in region_brief.get("limitations", []))
        and any("not field validation" in item for item in region_brief.get("limitations", []))
        and "confidence_score" not in region_brief,
        str(brief_path),
    )
    page.evaluate("""() => Object.defineProperty(navigator, 'clipboard', {
        configurable: true, value: { writeText: async () => { throw new Error('Clipboard unavailable in test'); } }
    })""")
    page.click(".wx-mapmodes button[data-map-mode='SPLIT']")
    page.wait_for_function("document.querySelector('.wx-root')?.dataset.mapMode === 'SPLIT'")
    page.get_by_role("button", name="Copy direct region link").click()
    fallback_link = page.locator(".wx-share-fallback input").input_value()
    link_parts = page.evaluate("""(value) => {
        const url = new URL(value);
        return {
            path: url.pathname, date: url.searchParams.get('date'),
            filter: url.searchParams.get('filter'), mode: url.searchParams.get('mode'),
            mapMode: url.searchParams.get('mapMode'), region: url.searchParams.get('region'),
            caseId: url.searchParams.get('case')
        };
    }""", fallback_link)
    check(
        "direct region link preserves acquisition, candidate and view state",
        link_parts["path"] == "/wetland"
        and link_parts["date"].isdigit()
        and link_parts["filter"] == "ALL"
        and link_parts["mode"] in ("MOTION", "RADAR", "DETECTION")
        and link_parts["mapMode"] == "SPLIT"
        and link_parts["mode"] == "RADAR"
        and link_parts["region"] == region_context_data["regionId"]
        and bool(link_parts["caseId"]),
        str(link_parts),
    )
    check(
        "direct-link clipboard fallback is visible and selectable",
        "copy the link below" in page.inner_text(".wx-region-context__share-message").lower()
        and page.locator(".wx-share-fallback input").count() == 1,
    )
    # A share URL must survive a fresh page load, not merely contain the right
    # parameters. The selected acquisition loads asynchronously before its region.
    expected_region = region_context_data["regionId"]
    expected_date = region_brief.get("observation", {}).get("date")
    page.goto(fallback_link)
    page.wait_for_function(
        """({region, date}) => {
            const nav = document.querySelector('.wx-region-nav');
            return nav?.dataset.regionId === region && nav?.dataset.acquisitionDate === date;
        }""",
        arg={"region": expected_region, "date": expected_date},
        timeout=30000,
    )
    page.wait_for_function("""() => {
        const before = document.querySelector('.leaflet-wxRadarBefore-pane img');
        const afterPane = document.querySelector('.leaflet-wxRadarAfter-pane');
        return !!before && !!afterPane?.querySelector('img') && Boolean(afterPane.style.clipPath);
    }""", timeout=12000)
    check("shared view reload remains paused at its selected acquisition",
          page.locator(".wx-play[aria-pressed='true']").count() == 0)
    restored_state = page.locator(".wx-region-nav").evaluate("""el => ({
        region: el.dataset.regionId,
        date: el.dataset.acquisitionDate,
        filter: el.dataset.classFilter,
        mode: el.dataset.viewMode,
        mapMode: el.dataset.mapMode
    })""")
    restored_drawer_open = page.locator("#wetland-investigation-drawer").is_visible()
    explore_tab_selected = page.get_by_role("tab", name="Explore").get_attribute("aria-selected") == "true"
    restored_split_layers = (
        page.locator(".leaflet-wxRadarBefore-pane img").count() == 1
        and page.locator(".leaflet-wxRadarAfter-pane img").count() == 1
    )
    check(
        "direct region link restores the same acquisition, candidate, split map and open investigator after reload",
        restored_state["region"] == expected_region
        and restored_state["date"] == expected_date
        and restored_state["filter"] == link_parts["filter"]
        and restored_state["mode"] == link_parts["mode"]
        and restored_state["mapMode"] == link_parts["mapMode"] == "SPLIT"
        and restored_drawer_open and explore_tab_selected and restored_split_layers,
        str({"state": restored_state, "drawer_open": restored_drawer_open, "explore_selected": explore_tab_selected}),
    )
    evidence_overview = page.locator(".wx-evidence-overview")
    evidence_counts = evidence_overview.evaluate("""el => ({
        passed: Number(el.dataset.passed),
        partial: Number(el.dataset.partial),
        failed: Number(el.dataset.failed),
        unavailable: Number(el.dataset.unavailable),
        grouped: [...el.querySelectorAll('.wx-evidence-overview__groups li')].length,
        cards: el.querySelectorAll('.wx-evidence-overview__count').length,
        note: el.querySelector('.wx-evidence-overview__note')?.innerText ?? ''
    })""")
    check(
        "evidence overview accounts for every recorded status group",
        evidence_counts["cards"] == 4
        and evidence_counts["grouped"] == sum(evidence_counts[k] for k in ("passed", "partial", "failed", "unavailable"))
        and evidence_counts["grouped"] == 8
        and "not a probability" in evidence_counts["note"].lower()
        and "confidence score" in evidence_counts["note"].lower(),
        str(evidence_counts),
    )
    evidence_details = page.locator(".wx-evidence-details")
    evidence_details.locator("summary").click()
    detailed_rows = evidence_details.locator(".wx-stack > li:not(.wx-stack__note)")
    check(
        "individual evidence measurements remain available on demand",
        evidence_details.get_attribute("open") is not None
        and detailed_rows.count() == 8
        and "radar bars show the size" in evidence_details.inner_text().lower(),
        str(detailed_rows.count()),
    )
    temporal_panel = page.locator(".wx-temporal-evidence")
    temporal_text = temporal_panel.inner_text()
    temporal_metrics = temporal_panel.evaluate("""el => {
        const meter = el.querySelector('[role="meter"]');
        return {
            currentDate: el.dataset.currentDate,
            previousDate: el.dataset.previousDate,
            overlap: el.dataset.overlapFraction === "" ? null : Number(el.dataset.overlapFraction),
            threshold: Number(el.dataset.thresholdPercent),
            status: el.dataset.status,
            meterValue: meter ? Number(meter.getAttribute("aria-valuenow")) : null
        };
    }""")
    check(
        "selected region names the actual preceding acquisition and elapsed interval",
        temporal_metrics["currentDate"] == "2026-08-29"
        and temporal_metrics["previousDate"] == "2026-08-17"
        and "August 17, 2026" in temporal_text
        and "August 29, 2026" in temporal_text
        and "12 days earlier" in temporal_text,
        str(temporal_metrics),
    )
    check(
        "same-class overlap gauge matches its stored fraction and 50% pipeline threshold",
        temporal_metrics["overlap"] is not None
        and 0 <= temporal_metrics["overlap"] <= 1
        and temporal_metrics["threshold"] == 50
        and temporal_metrics["meterValue"] is not None
        and abs(temporal_metrics["meterValue"] - temporal_metrics["overlap"] * 100) < 0.01
        and temporal_metrics["status"] == ("PASS" if temporal_metrics["overlap"] >= 0.5 else "PARTIAL"),
        str(temporal_metrics),
    )
    check(
        "temporal panel discloses pixel-overlap limits and does not imply persistent region identity",
        "directional pixel overlap" in temporal_text
        and "not a persistent region match" in temporal_text
        and "No values are interpolated" in temporal_text,
    )
    inspector_box = page.get_by_role("heading", name="Why this region?").bounding_box()
    chart_box = page.locator(".wx-pulse-chart").bounding_box()
    check(
        "selected-region evidence appears before the temporal chart",
        inspector_box is not None and chart_box is not None and inspector_box["y"] < chart_box["y"],
    )
    check("all seven real acquisition dates remain selectable in the chart", page.locator(".wx-pulse-chart__hit[role='button']").count() == 7)

    # The register must let visitors browse beyond its first 100 rows and recover
    # cleanly when a search has no matches. Exports continue to use all filtered rows.
    register_rows = page.locator(".wx-region-table tbody tr")
    check(
        "region register starts with an explicit first page and remaining-result count",
        register_rows.count() == 100
        and "Showing 100 of 295 matching regions" in page.inner_text(".wx-region-summary")
        and page.locator(".wx-region-pagination button").count() == 1,
        f"visible={register_rows.count()}",
    )
    page.locator(".wx-region-pagination button").click()
    page.wait_for_function("document.querySelectorAll('.wx-region-table tbody tr').length === 200", timeout=5000)
    check(
        "region register loads the next 100 rows without changing the full result",
        register_rows.count() == 200
        and "Showing 200 of 295 matching regions" in page.inner_text(".wx-region-summary"),
    )
    page.locator(".wx-region-pagination button").click()
    page.wait_for_function("document.querySelectorAll('.wx-region-table tbody tr').length === 295", timeout=5000)
    last_sorted_region = page.locator(".wx-region-cards li").last
    last_sorted_region_id = last_sorted_region.get_attribute("data-region-id")
    last_sorted_region.locator("button").click()
    page.wait_for_function(
        """(id) => {
            const nav = document.querySelector(".wx-region-nav");
            return nav?.dataset.regionId === id
                && Number(nav.dataset.position) === Number(nav.dataset.total);
        }""",
        arg=last_sorted_region_id,
        timeout=5000,
    )
    check(
        "register area sort shares the inspector navigation ID tie-break",
        page.locator(".wx-region-nav").get_attribute("data-region-id") == last_sorted_region_id
        and page.locator(".wx-region-nav").get_attribute("data-position")
            == page.locator(".wx-region-nav").get_attribute("data-total"),
        f"last_id={last_sorted_region_id}, position={page.locator('.wx-region-nav').get_attribute('data-position')}, total={page.locator('.wx-region-nav').get_attribute('data-total')}",
    )
    page.get_by_label("Search candidate regions").fill("no-match-region-000")
    check(
        "region register shows a useful empty-search state",
        register_rows.count() == 0
        and "No candidate regions match those criteria." in page.inner_text(".wx-region-empty")
        and page.locator(".wx-region-summary button").count() == 1,
    )
    page.locator(".wx-region-summary button").click()
    check(
        "clearing register filters restores the first page",
        page.get_by_label("Search candidate regions").input_value() == ""
        and page.get_by_label("Filter candidate class").input_value() == "ALL"
        and register_rows.count() == 100
        and page.locator(".wx-region-pagination button").count() == 1,
    )
    register_width = page.locator(".wx-region-register").evaluate("(el) => el.clientWidth")
    compact_cards = page.locator(".wx-region-cards")
    table_wrap = page.locator(".wx-region-table-wrap")
    check(
        "narrow desktop drawer uses compact region cards instead of a wide table",
        register_width <= 420 and compact_cards.is_visible() and not table_wrap.is_visible()
        and compact_cards.locator("li").count() == 100,
        f"register={register_width}px cards={compact_cards.locator('li').count()}",
    )
    compact_target = compact_cards.locator("li").first
    compact_target_id = compact_target.get_attribute("data-region-id")
    compact_target.locator("button").click()
    try:
        page.wait_for_function(
            """(id) => document.querySelector(".wx-root")?.dataset.selectedRegionId === id
                && document.querySelector(".wx-region-nav")?.dataset.regionId === id""",
            arg=compact_target_id,
            timeout=8000,
        )
    except Exception as error:
        debug_state = page.evaluate("""(id) => {
            const root = document.querySelector(".wx-root");
            const nav = document.querySelector(".wx-region-nav");
            const drawer = document.querySelector("#wetland-investigation-drawer");
            const card = [...document.querySelectorAll(".wx-region-cards li")]
                .find((item) => item.dataset.regionId === id);
            const button = card?.querySelector("button");
            return {
                expected: id,
                selectedRegionId: root?.dataset.selectedRegionId ?? null,
                navRegionId: nav?.dataset.regionId ?? null,
                drawerOpen: !!drawer,
                cardFound: !!card,
                cardClass: card?.className ?? null,
                cardPressed: button?.getAttribute("aria-pressed") ?? null,
                viewMode: root?.dataset.mapMode ?? null,
            };
        }""", compact_target_id)
        raise AssertionError(f"Compact region click did not update selection: {debug_state}") from error
    compact_selection_state = page.evaluate("""() => {
        const nav = document.querySelector(".wx-region-nav");
        const firstCard = document.querySelector(".wx-region-cards li:first-child button");
        return {
            navRegionId: nav?.dataset.regionId ?? null,
            cardPressed: firstCard?.getAttribute("aria-pressed") ?? null,
            investigatorOpen: document.querySelector("#wetland-investigation-drawer") !== null,
            titleCount: [...document.querySelectorAll("h1,h2,h3")].filter(el => el.textContent?.trim() === "Why this region?").length
        };
    }""")
    check(
        "compact region card opens the selected region inspector without URL override",
        compact_selection_state["navRegionId"] == compact_target_id
        and compact_selection_state["cardPressed"] == "true"
        and compact_selection_state["investigatorOpen"]
        and compact_selection_state["investigatorOpen"]
        and compact_selection_state["titleCount"] == 1,
        str({"expected": compact_target_id, **compact_selection_state}),
    )

    # Audit the chart against the exact published pulse manifest, including its
    # date labels, candidate-area values, marker geometry and keyboard controls.
    pulse_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "showcase", "featured", "pulse.json")
    saved_pulse = json.load(open(pulse_path))
    pulse_dates = saved_pulse["dates"]
    chart_targets = page.locator(".wx-pulse-chart__hit[role='button']")
    rendered_chart_labels = chart_targets.evaluate_all("els => els.map(el => el.getAttribute('aria-label') || '')")
    expected_chart_dates = []
    for row in pulse_dates:
        date_value = datetime.strptime(row["date"], "%Y-%m-%d")
        long_date = f"{date_value.strftime('%B')} {date_value.day}, {date_value.year}"
        short_date = f"{date_value.strftime('%b')} {date_value.day}, {date_value.year}"
        expected_chart_dates.append((long_date, short_date, row["area_km2"], row["patches"]))
    labels_match = len(rendered_chart_labels) == len(expected_chart_dates) and all(
        long_date in label and f"{area:.2f} square kilometres" in label
        for label, (long_date, _short_date, area, _patches) in zip(rendered_chart_labels, expected_chart_dates)
    )
    check("all chart dates and candidate-area labels match pulse.json", labels_match, str(rendered_chart_labels))

    marker_bounds = page.locator(".wx-pulse-chart__marker text").evaluate_all(
        "(els) => els.map(el => { const b = el.getBBox(); return {label: el.textContent, x: b.x, y: b.y, width: b.width, height: b.height}; })"
    )
    marker_overlap = any(
        a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"]
        and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]
        for i, a in enumerate(marker_bounds) for b in marker_bounds[i + 1:]
    )
    check("onset, peak and recession labels do not overlap", len(marker_bounds) == 3 and not marker_overlap, str(marker_bounds))

    grid_lines = page.locator(".wx-pulse-chart__grid").evaluate_all(
        "els => els.map(el => [Number(el.getAttribute('x1')), Number(el.getAttribute('x2'))])"
    )
    baseline_span = page.locator(".wx-pulse-chart__baseline").evaluate(
        "el => [Number(el.getAttribute('x1')), Number(el.getAttribute('x2'))]"
    )
    check("chart grid lines and baseline share the same plot span", len(grid_lines) == 3 and all(line == baseline_span for line in grid_lines), str(grid_lines))

    focusable_chart_targets = chart_targets.evaluate_all(
        "els => els.filter(el => el.getAttribute('tabindex') === '0' && el.getAttribute('aria-disabled') !== 'true').length"
    )
    check("all seven chart dates are keyboard-operable", focusable_chart_targets == 7, str(focusable_chart_targets))
    if focusable_chart_targets == 7 and len(expected_chart_dates) == 7:
        for index, (long_date, short_date, area, patch_count) in enumerate(expected_chart_dates):
            target = chart_targets.nth(index)
            target.focus()
            page.keyboard.press("Enter")
            page.wait_for_function(
                "(i) => document.querySelectorAll('.wx-pulse-chart__hit')[i]?.getAttribute('aria-pressed') === 'true'",
                arg=index, timeout=3000,
            )
            page.wait_for_function(
                "(count) => document.querySelectorAll('path.wx-patch').length === count",
                arg=patch_count, timeout=10000,
            )
            selected_value = f"{area:.0f}" if area >= 10 else f"{area:.1f}"
            expected_summary = f"{selected_value} km² · {patch_count} regions"
            enter_synced = (
                page.inner_text(".wx-pulse-chart__summary strong").strip() == short_date
                and page.inner_text(".wx-now strong").strip() == short_date
                and page.inner_text(".wx-pulse-chart__summary span:last-child").strip() == expected_summary
                and page.locator("path.wx-patch").count() == patch_count
            )
            check(f"{short_date} selects and syncs chart, timeline and map with Enter", enter_synced)

            target.focus()
            page.keyboard.press("Space")
            page.wait_for_function(
                "(i) => document.querySelectorAll('.wx-pulse-chart__hit')[i]?.getAttribute('aria-pressed') === 'true'",
                arg=index, timeout=3000,
            )
            space_synced = (
                page.inner_text(".wx-pulse-chart__summary strong").strip() == short_date
                and page.inner_text(".wx-now strong").strip() == short_date
                and page.inner_text(".wx-pulse-chart__summary span:last-child").strip() == expected_summary
                and page.locator("path.wx-patch").count() == patch_count
            )
            check(f"{short_date} selects and syncs chart, timeline and map with Space", space_synced)

    original_viewport = page.viewport_size
    for width, height in ((1440, 900), (1100, 760), (820, 900), (390, 800)):
        page.set_viewport_size({"width": width, "height": height})
        page.locator(".wx-pulse-chart").scroll_into_view_if_needed()
        page.wait_for_timeout(180)
        chart_dimensions = page.locator(".wx-pulse-chart__scroll").evaluate(
            "(el) => ({client: el.clientWidth, scroll: el.scrollWidth})"
        )
        check(
            f"temporal chart fits without horizontal scrolling at {width}px",
            chart_dimensions["scroll"] <= chart_dimensions["client"] + 1,
            str(chart_dimensions),
        )
        page.screenshot(path=f"/tmp/e2e_wetland_chart_{width}.png")
    page.set_viewport_size(original_viewport)
    page.wait_for_timeout(250)
    # Selecting a different date intentionally clears the prior region selection.
    # Re-select a region on the final date before opening its challenge controls.
    page.locator("path.wx-patch").nth(40).click(force=True)
    challenge_button = page.get_by_role("button", name="Challenge this detection")
    challenge_button.scroll_into_view_if_needed()
    challenge_button.click()
    page.wait_for_timeout(400)
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
    story_snapshot = page.inner_text(".wx-story-snapshot")
    check(
        "date-aware story follows the selected September 22 acquisition",
        "September 22, 2026" in story_snapshot and "8.42 km²" in story_snapshot
        and "452" in story_snapshot and "7.2%" in story_snapshot,
        story_snapshot[:240],
    )
    story_snapshot_normalized = story_snapshot.casefold()
    check(
        "date-aware story compares the previous snapshot without implying a daily rate",
        "change from september 10, 2026" in story_snapshot_normalized
        and "−12.56 km²" in story_snapshot and "+6 candidate regions" in story_snapshot
        and "12 days between acquisitions" in story_snapshot and "not a daily rate" in story_snapshot,
        story_snapshot[-260:],
    )
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
    # Escape closes the keyboard-inspection drawer; reopen Explore before testing
    # the optional 3D disclosure, which lives inside that panel.
    if page.locator(".wx-drawer").count() == 0:
        page.locator(".wx-drawer-reopen").click()
        page.wait_for_timeout(300)
    page.get_by_role("tab", name="Explore").click()
    page.wait_for_selector(".wx-pulse-chart", timeout=10000)
    check("Explore panel is available again after keyboard dismissal", page.locator(".wx-pulse-chart").count() == 1)
    page.locator(".wx-pulse-chart").scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    page.screenshot(path="/tmp/e2e_wetland_chart_1440.png")
    page.screenshot(path="/tmp/e2e_wetland_1440.png")

    # The optional 3D disclosure must open independently and retain the same
    # seven dated observations; WebGL may render a canvas or a documented fallback.
    disclosure = page.locator(".field-volume-disclosure")
    disclosure.scroll_into_view_if_needed()
    page.get_by_role("button", name="Explore in 3D").click()
    page.wait_for_selector(".field-volume-disclosure__panel", timeout=10000)
    page.wait_for_function(
        "() => Boolean(document.querySelector('.field-volume-scene__canvas canvas, .field-volume-scene__fallback'))",
        timeout=12000,
    )
    scene_dates = page.locator(".field-volume-scene__dates button")
    check(
        "optional 3D disclosure opens with its scene or fallback and seven dated observations",
        scene_dates.count() == 7
        and page.locator(".field-volume-scene__canvas canvas, .field-volume-scene__fallback").count() >= 1,
        str(scene_dates.count()),
    )
    if scene_dates.count() == 7:
        scene_dates.nth(6).click()
        page.wait_for_function(
            "() => document.querySelectorAll('path.wx-patch').length === 452",
            timeout=10000,
        )
        check(
            "3D date selection stays synchronized with chart and timeline",
            scene_dates.nth(6).get_attribute("aria-pressed") == "true"
            and page.inner_text(".wx-pulse-chart__summary strong").strip() == "Sep 22, 2026"
            and page.inner_text(".wx-now strong").strip() == "Sep 22, 2026"
            and page.locator("path.wx-patch").count() == 452,
        )
    page.get_by_role("button", name="Close 3D view").click()
    check(
        "3D disclosure closes and removes its scene panel",
        page.locator(".field-volume-disclosure__panel").count() == 0,
    )

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
        # Read both values in one browser task so autoplay cannot advance
        # between separate Playwright round-trips and create a false mismatch.
        sample = page.evaluate("""() => {
            const current = document.querySelector("[data-testid='hydro-current-value']");
            const active = document.querySelector(".hydro-bar.is-active .hydro-val");
            return {
                current: current?.textContent?.trim() ?? "",
                active: active?.textContent?.trim() ?? "",
            };
        }""")
        current_text = sample["current"]
        active_text = sample["active"]
        live_samples.append(f"{current_text}/{active_text}")
        try:
            numeric_value = float(current_text)
            live_values_match = (
                live_values_match
                and current_text == active_text
                and numeric_value >= 0
            )
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
