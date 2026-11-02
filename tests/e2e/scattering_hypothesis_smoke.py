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
            "https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_18_6*",
            mock_cmr,
        )

        page.goto(BASE + "/wetland", wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector(".wx-obs", timeout=20_000)
        page.wait_for_selector("path.wx-patch", timeout=20_000)

        # Open a real candidate from the packaged Tanguar Haor showcase.
        page.locator("path.wx-patch").nth(40).click(force=True)
        page.wait_for_selector(".wx-drawer", timeout=10_000)
        page.locator(".wx-drawer__body").evaluate("(element) => { element.scrollTop = element.scrollHeight; }")
        challenge_button = page.locator(".wx-drawer").get_by_role("button", name="Challenge this detection")
        challenge_button.wait_for(state="visible", timeout=10_000)
        challenge_button.scroll_into_view_if_needed()
        challenge_button.click(timeout=10_000)
        panel = page.locator(".wx-drawer .wx-challenge .wx-scattering")
        panel.wait_for(state="visible", timeout=20_000)
        ledger_heading = panel.locator("#wx-scattering-title")
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
        soil.evaluate("(button) => button.click()")
        soil.wait_for(state="attached", timeout=10_000)
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
        vegetation.evaluate("(button) => button.click()")
        page.wait_for_function(
            """() => document.querySelector('.wx-scattering__choice[data-hypothesis-id="vegetation-surface"][aria-pressed="true"]') !== null""",
            timeout=10_000,
        )
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
        open_water.evaluate("(button) => button.click()")
        page.wait_for_function(
            """() => document.querySelector('.wx-scattering__choice[data-hypothesis-id="open-water"][aria-pressed="true"]') !== null""",
            timeout=10_000,
        )
        open_water_detail = panel.locator('.wx-scattering__detail[aria-label="Open-water surface scattering"]')
        open_water_detail.wait_for(state="visible", timeout=10_000)
        require(
            panel.locator('.wx-scattering__choice[data-hypothesis-id="open-water"][aria-pressed="true"]').count() == 1,
            "open-water hypothesis becomes selected",
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
        from urllib.parse import parse_qs, urlparse
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
        search_button.evaluate("(button) => button.click()")
        page.wait_for_function(
            """() => {
              const status = document.querySelector(".wx-cmr-inspector__status")?.textContent ?? "";
              return status.startsWith("CMR search completed")
                || status.startsWith("Some collection searches completed")
                || status.startsWith("CMR could not be reached");
            }""",
            timeout=20_000,
        )
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
        first_shortlist.evaluate("(checkbox) => checkbox.click()")
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
            request_panel.get_by_role("button", name="Download evidence request JSON").click()
        empty_download = empty_download_info.value
        with open(empty_download.path(), encoding="utf-8") as empty_file:
            empty_export = json.load(empty_file)
        require(
            empty_export.get("discovery", {}).get("shortlistedGranules") == [],
            "unchecking a granule removes it from the exported shortlist",
        )

        first_shortlist.evaluate("(checkbox) => checkbox.click()")
        require(first_shortlist.is_checked(), "analyst can restore a granule to the review shortlist")
        with page.expect_download() as download_info:
            request_panel.get_by_role("button", name="Download evidence request JSON").click()
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
