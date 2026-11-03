"""Production-browser smoke test for the candidate-level scattering hypothesis ledger.

Run against a built public viewer:
    python tests/e2e/scattering_hypothesis_smoke.py http://127.0.0.1:3140

This verifies the interactive explanation panel using the existing Wetland showcase.
It does not recompute detections or claim any physical mechanism is confirmed.
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright
from urllib.parse import parse_qs, urlparse

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:3140"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS {message}")


def main() -> int:
    browser_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.add_init_script("localStorage.setItem('geonexsar_tour_v1', '1')")
        page.on("pageerror", lambda error: browser_errors.append(str(error)))

        cmr_requests: list[tuple[str, str]] = []

        def mock_cmr(route):
            request_url = route.request.url
            method = route.request.method.upper()
            cmr_requests.append((method, request_url))
            cors_headers = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Accept, Content-Type",
                "Vary": "Origin",
            }
            if method == "OPTIONS":
                route.fulfill(status=204, headers=cors_headers)
                return

            query = parse_qs(urlparse(request_url).query)
            short_name = query.get("short_name", ["UNKNOWN"])[0]
            temporal_filter = query.get("temporal[]", [""])[0]
            window_start = temporal_filter.split(",", 1)[0][:10]
            if not window_start:
                route.fulfill(
                    status=400, content_type="application/json", headers=cors_headers,
                    body=json.dumps({"error": "The test CMR request omitted temporal[]"}),
                )
                return
            candidate_date = (date.fromisoformat(window_start) + timedelta(days=3)).isoformat()
            granule_ur = f"{short_name}_{candidate_date.replace('-', '')}T102000_TEST"
            payload = {
                "hits": 1,
                "items": [{
                    "meta": {"concept-id": f"G1234567890-{short_name[:12]}"},
                    "umm": {
                        "GranuleUR": granule_ur,
                        "TemporalExtent": {"SingleDateTime": f"{candidate_date}T10:20:00Z"},
                        "CloudCover": 12,
                        "SpatialExtent": {"HorizontalSpatialDomain": {"Geometry": {"BoundingRectangles": [{
                            "WestBoundingCoordinate": 89.0, "SouthBoundingCoordinate": 24.0,
                            "EastBoundingCoordinate": 90.0, "NorthBoundingCoordinate": 25.0,
                        }]}}},
                        "RelatedUrls": [
                            {"URL": "https://data.example.nasa.gov/granule.h5", "Type": "GET DATA", "Description": "Mock direct access"},
                            {"URL": "https://data.example.nasa.gov/browse.png", "Type": "GET RELATED VISUALIZATION", "Description": "Mock browse image"},
                        ],
                    },
                }],
            }
            route.fulfill(
                status=200, content_type="application/json", headers=cors_headers,
                body=json.dumps(payload),
            )

        # Intercept only the versioned UMM granule endpoint used by this
        # inspector. A host-wide route would also mock unrelated CMR resources
        # used elsewhere in the Wetland drawer.
        page.route(
            lambda request_url: request_url.startswith(
                "https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_18_6"
            ),
            mock_cmr,
        )

        page.goto(BASE + "/wetland", wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector(".wx-obs", timeout=20_000)
        page.wait_for_selector("path.wx-patch", timeout=20_000)

        # The packaged showcase starts its introductory date animation once
        # per browser session. Pause it before selecting a candidate: a
        # playback tick changes the selected date and intentionally clears
        # challengeOpen, which would race this multi-step interaction test.
        play_button = page.locator(".wx-play")
        play_button.wait_for(state="visible", timeout=10_000)
        if play_button.get_attribute("aria-pressed") == "true":
            play_button.evaluate("(button) => button.click()")
        for _ in range(30):
            if play_button.get_attribute("aria-pressed") == "false":
                break
            page.wait_for_timeout(100)
        else:
            raise AssertionError("The Wetland showcase autoplay did not pause before candidate selection.")

        # Open a real candidate from the packaged Tanguar Haor showcase.
        page.locator("path.wx-patch").nth(40).click(force=True)
        page.wait_for_selector(".wx-drawer", timeout=10_000)
        page.locator(".wx-drawer__body").evaluate("(element) => { element.scrollTop = element.scrollHeight; }")
        challenge_button = page.locator(".wx-drawer").get_by_role("button", name="Challenge this detection")
        if challenge_button.count() == 0:
            # Leaflet polygons can be present in the SVG but not have a
            # selected WetlandPatch yet (for example, when the map layer is
            # still finishing its interaction setup). The existing region
            # register provides a deterministic, real candidate-selection
            # path inside the same drawer; use it rather than assuming the
            # polygon click succeeded.
            region_choice = page.locator(".wx-drawer .wx-regions button").first
            region_choice.wait_for(state="visible", timeout=10_000)
            region_choice.scroll_into_view_if_needed()
            region_choice.click()
            page.wait_for_selector(".wx-drawer .wx-facts", timeout=10_000)
            page.locator(".wx-drawer__body").evaluate("(element) => { element.scrollTop = element.scrollHeight; }")
        challenge_button.wait_for(state="visible", timeout=10_000)
        challenge_button.wait_for(state="attached", timeout=10_000)
        # The drawer is layered above the map and can be reflowing while the
        # nested scroll container settles. A DOM evaluate can lose its element
        # handle during a React re-render; a forced locator click retries the
        # live element while bypassing only the flaky pointer hit-test.
        # The action button lives inside a nested, animated drawer. Dispatch
        # the native button click on the live element, then assert the actual
        # disclosure content is mounted; this avoids a flaky pointer hit-test
        # and does not treat the click itself as proof that React updated.
        challenge_button.evaluate("(button) => button.click()")
        challenge_panel = page.locator(".wx-drawer .wx-challenge")
        challenge_panel.wait_for(state="visible", timeout=20_000)
        for _ in range(30):
            if challenge_button.get_attribute("aria-expanded") == "true":
                break
            page.wait_for_timeout(100)
        else:
            raise AssertionError("The Challenge this detection disclosure did not remain expanded.")
        panel = page.locator(".wx-drawer .wx-challenge .wx-scattering")
        panel.wait_for(state="visible", timeout=20_000)
        ledger_heading = panel.locator("#wx-scattering-title")
        try:
            ledger_heading.wait_for(state="attached", timeout=20_000)
        except Exception:
            print("DEBUG challenge expanded:", page.evaluate("() => document.querySelector('.wx-tool__action button[aria-expanded]')?.getAttribute('aria-expanded') ?? 'missing'"))
            print("DEBUG scattering panel count:", panel.count())
            print("DEBUG scattering panel HTML:", panel.first.evaluate("(element) => element.outerHTML.slice(0, 5000)") if panel.count() else "missing")
            raise
        ledger_heading.scroll_into_view_if_needed(timeout=10_000)
        ledger_heading.wait_for(state="visible", timeout=10_000)
        require(
            ledger_heading.inner_text().strip() == "Scattering hypothesis ledger",
            "candidate drawer exposes the Scattering hypothesis ledger",
        )
        require(
            panel.locator(".wx-scattering__choice").count() == 4,
            "four physical explanations are available",
        )
        require(
            panel.locator(".wx-scattering__choice[aria-pressed='true']").count() == 1,
            "exactly one hypothesis is selected at a time",
        )
        require(
            "MEASURED RESPONSE ≠ PHYSICAL CAUSE" in panel.inner_text(),
            "panel distinguishes measured response from physical cause",
        )

        soil = panel.locator('.wx-scattering__choice[data-hypothesis-id="soil-moisture"]')
        soil.scroll_into_view_if_needed()
        soil.focus()
        soil.press("Enter")
        page.wait_for_function(
            """() => document.querySelector('.wx-scattering__choice[data-hypothesis-id="soil-moisture"][aria-pressed="true"]') !== null""",
            timeout=10_000,
        )
        soil_detail_locator = panel.locator('.wx-scattering__detail[aria-label="Soil-moisture variation"]')
        soil_detail_locator.wait_for(state="visible", timeout=10_000)
        require(
            panel.locator('.wx-scattering__choice[data-hypothesis-id="soil-moisture"][aria-pressed="true"]').count() == 1,
            "soil-moisture hypothesis becomes the active choice",
        )
        soil_detail = soil_detail_locator.inner_text()
        require(
            "Cannot distinguish with this pair" in soil_detail
            and "No independent soil-moisture measurement" in soil_detail,
            "soil-moisture alternative remains unresolved without independent evidence",
        )

        vegetation = panel.locator('.wx-scattering__choice[data-hypothesis-id="vegetation-surface"]')
        vegetation.scroll_into_view_if_needed()
        vegetation.focus()
        vegetation.press("Enter")
        try:
            page.wait_for_function(
                """() => document.querySelector('.wx-scattering__choice[data-hypothesis-id="vegetation-surface"][aria-pressed="true"]') !== null""",
                timeout=10_000,
            )
        except Exception:
            print(
                "DEBUG hypothesis pressed states:",
                page.locator(".wx-scattering__choice").evaluate_all(
                    "(buttons) => buttons.map((button) => ({id: button.getAttribute('data-hypothesis-id'), pressed: button.getAttribute('aria-pressed')}))"
                ),
                flush=True,
            )
            print("DEBUG browser errors:", json.dumps(browser_errors), flush=True)
            raise
        vegetation_detail_locator = panel.locator(
            '.wx-scattering__detail[aria-label="Vegetation, roughness or intercepted water"]'
        )
        vegetation_detail_locator.wait_for(state="visible", timeout=10_000)
        require(
            panel.locator('.wx-scattering__choice[data-hypothesis-id="vegetation-surface"][aria-pressed="true"]').count() == 1,
            "vegetation and surface hypothesis becomes the active choice",
        )
        vegetation_detail = vegetation_detail_locator.inner_text()
        require(
            "Cannot distinguish with this pair" in vegetation_detail
            and "do not separate these effects" in vegetation_detail,
            "vegetation and surface alternatives remain explicitly unresolved",
        )

        require(
            "No probability, confidence score, precision or accuracy value is calculated here."
            in panel.inner_text(),
            "scientific guardrails prohibit invented confidence or accuracy",
        )

        # Step 2: build a real, selected-hypothesis CMR request and export its manifest.
        open_water = panel.locator('.wx-scattering__choice[data-hypothesis-id="open-water"]')
        open_water.scroll_into_view_if_needed()
        open_water.focus()
        open_water.press("Enter")
        page.wait_for_function(
            """() => document.querySelector('.wx-scattering__choice[data-hypothesis-id="open-water"][aria-pressed="true"]') !== null""",
            timeout=10_000,
        )
        open_water_detail = panel.locator(".wx-scattering__detail")
        page.wait_for_function(
            """() => document.querySelector(".wx-scattering__detail")?.textContent?.includes(
              "Relatively smooth, exposed water can reflect radar energy away from a side-looking sensor"
            ) === true""",
            timeout=10_000,
        )
        open_water_detail.wait_for(state="visible", timeout=10_000)
        require(
            panel.locator('.wx-scattering__choice[data-hypothesis-id="open-water"][aria-pressed="true"]').count() == 1,
            "open-water hypothesis becomes selected",
        )
        require(
            "Relatively smooth, exposed water can reflect radar energy away from a side-looking sensor"
            in open_water_detail.inner_text(),
            "open-water detail panel renders the selected physical mechanism",
        )
        request_panel = panel.locator(".wx-evidence-request")
        require(
            request_panel.get_by_role("heading", name="Hypothesis-to-evidence request").count() == 1,
            "selected hypothesis opens its evidence-request builder",
        )
        require(
            request_panel.locator(".wx-evidence-request__archive").count() == 2,
            "open-water request offers two product-specific archive searches",
        )
        cmr_link = request_panel.locator("a", has_text="Search CMR").first
        cmr_url = cmr_link.get_attribute("href") or ""
        query = parse_qs(urlparse(cmr_url).query)
        require(
            urlparse(cmr_url).netloc == "cmr.earthdata.nasa.gov"
            and query.get("short_name") == ["OPERA_L3_DSWX-HLS_V1"]
            and query.get("version") == ["1.0"],
            "CMR query targets the verified OPERA DSWx-HLS collection and version",
        )
        spatial_filters = sum(key in query for key in ("polygon", "polygon[]", "bounding_box", "point"))
        require(
            spatial_filters == 1,
            "archive query uses one candidate polygon, bounding box or explicitly centroid-only point filter",
        )
        page.locator("[data-testid='evidence-window']").select_option("3")
        expanded_query = parse_qs(urlparse(cmr_link.get_attribute("href") or "").query)
        temporal = expanded_query.get("temporal[]", [""])[0].split(",")
        require(
            len(temporal) == 2 and temporal[0].endswith("T00:00:00Z") and temporal[1].endswith("T23:59:59Z"),
            "adjusting the date window regenerates an explicit UTC granule-search range",
        )
        search_button = request_panel.get_by_role("button", name="Search NASA CMR granules")
        search_button.click(force=True, timeout=10_000)
        try:
            page.wait_for_function(
                """() => {
                  const status = document.querySelector(".wx-cmr-inspector__status")?.textContent ?? "";
                  return status.startsWith("CMR search completed")
                    || status.startsWith("Some collection searches completed")
                    || status.startsWith("CMR could not be reached");
                }""",
                timeout=20_000,
            )
        except Exception:
            print("DEBUG intercepted CMR requests:", json.dumps(cmr_requests), flush=True)
            print(
                "DEBUG visible CMR status:",
                page.locator(".wx-cmr-inspector__status").all_inner_texts(),
                flush=True,
            )
            print("DEBUG browser errors:", json.dumps(browser_errors), flush=True)
            raise
        cmr_gets = [url for method, url in cmr_requests if method == "GET"]
        require(
            len(cmr_gets) == 2,
            "both product-specific archive requests reach the deterministic CMR fixture",
        )
        require(
            "CMR search completed" in request_panel.locator(".wx-cmr-inspector__status").inner_text(),
            "both mocked CMR searches complete successfully",
        )
        page.wait_for_selector("[data-testid='cmr-granule-card']", timeout=10_000)
        try:
            # The inspector receives the two collection responses together,
            # but wait for both collection sections rather than treating the
            # first granule card as proof that the whole result list has settled.
            page.wait_for_function(
                "() => document.querySelectorAll(\"[data-testid='cmr-result-group']\").length === 2",
                timeout=10_000,
            )
        except Exception:
            print(
                "DEBUG CMR result-group count:",
                request_panel.locator("[data-testid='cmr-result-group']").count(),
                flush=True,
            )
            print(
                "DEBUG CMR inspector HTML:",
                request_panel.locator(".wx-cmr-inspector").evaluate("(element) => element.outerHTML.slice(0, 12000)"),
                flush=True,
            )
            print("DEBUG intercepted CMR requests:", json.dumps(cmr_requests), flush=True)
            print("DEBUG browser errors:", json.dumps(browser_errors), flush=True)
            raise
        require(
            request_panel.locator("[data-testid='cmr-result-group']").count() == 2,
            "live CMR inspector shows a separate result group for each selected collection",
        )
        first_granule = request_panel.locator("[data-testid='cmr-granule-card']").first
        require(
            "OPERA_L3_DSWX-HLS_V1_" in first_granule.inner_text() and "T102000_TEST" in first_granule.inner_text(),
            "inspector renders the returned collection granule identifier",
        )
        granule_text = first_granule.inner_text()
        print("CMR MOCK GRANULE CARD:", granule_text, flush=True)
        require(
            any(label in granule_text for label in (
                "Same UTC date as candidate",
                "day before candidate date",
                "days before candidate date",
                "day after candidate date",
                "days after candidate date",
            )),
            "inspector reports the granule acquisition-date offset from the candidate",
        )
        require(
            "12.0% (not candidate-local)" in granule_text,
            "inspector labels cloud-cover metadata as granule-level rather than candidate-local",
        )
        first_shortlist = request_panel.locator("[data-testid='cmr-shortlist-checkbox']").first
        # The cards update as the controlled React shortlist state changes.
        # Dispatch the native input click directly instead of relying on a
        # geometry-stability click during the surrounding drawer animation.
        first_shortlist.click(force=True, timeout=10_000)
        page.wait_for_function(
            """() => {
              const checkbox = document.querySelector("[data-testid='cmr-shortlist-checkbox']");
              return checkbox instanceof HTMLInputElement && checkbox.checked;
            }""",
            timeout=10_000,
        )
        require(
            request_panel.locator("[data-testid='cmr-shortlist-checkbox']").first.is_checked(),
            "analyst can shortlist a granule for further review",
        )
        request_panel.locator("[data-testid='cmr-shortlist-checkbox']").first.evaluate(
            "(checkbox) => checkbox.click()"
        )
        page.wait_for_function(
            """() => {
              const checkbox = document.querySelector("[data-testid='cmr-shortlist-checkbox']");
              return checkbox instanceof HTMLInputElement && !checkbox.checked;
            }""",
            timeout=10_000,
        )
        require(not first_shortlist.is_checked(), "analyst can remove a granule from the shortlist")

        with page.expect_download() as empty_download_info:
            request_panel.get_by_role("button", name="Download evidence request JSON").click(force=True, timeout=10_000)
        empty_download = empty_download_info.value
        with open(empty_download.path(), encoding="utf-8") as empty_file:
            empty_export = json.load(empty_file)
        require(
            empty_export.get("discovery", {}).get("shortlistedGranules") == [],
            "unchecking a granule removes it from the exported shortlist",
        )

        first_shortlist.click(force=True, timeout=10_000)
        require(first_shortlist.is_checked(), "analyst can restore a granule to the review shortlist")
        with page.expect_download() as download_info:
            request_panel.get_by_role("button", name="Download evidence request JSON").click(force=True, timeout=10_000)
        download = download_info.value
        request_path = download.path()
        with open(request_path, encoding="utf-8") as request_file:
            exported = json.load(request_file)
        require(
            exported.get("schemaVersion") == "beyonders.evidence-request/1.1"
            and exported.get("hypothesis", {}).get("id") == "open-water"
            and len(exported.get("archiveSearches", [])) == 2,
            "downloaded JSON preserves the selected hypothesis, query links and request schema",
        )
        require(
            any("not a validation result" in warning for warning in exported.get("warnings", [])),
            "exported request warns that archive matches are not validation",
        )
        require(
            exported.get("discovery", {}).get("status") == "success"
            and len(exported.get("discovery", {}).get("resultGroups", [])) == 2
            and len(exported.get("discovery", {}).get("shortlistedGranules", [])) == 1,
            "downloaded manifest includes CMR result groups and only the analyst-shortlisted granule",
        )
        require(
            "does not mean the record supports or challenges" in exported.get("discovery", {}).get("interpretation", ""),
            "shortlist export explicitly avoids treating analyst selection as evidence support",
        )
        require(not browser_errors, "hypothesis interaction produces no browser runtime errors")

        browser.close()
    print("All scattering-hypothesis browser checks passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise
