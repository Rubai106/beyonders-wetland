"""Production-browser smoke test for the published Naogaon Agriculture study.

Run against a built Next.js public viewer:
    python tests/e2e/agriculture_evidence_chain_smoke.py http://127.0.0.1:3140

This verifies the checksum-gated study renders, its real acquisition and
quality-exclusion evidence remains visible, and absent rainfall/field-reference
evidence is not fabricated.
"""
from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:3140"
EXPECTED_STUDY_ID = "agri-41647231453"
EXPECTED_DATES = 6
EXPECTED_EXCLUSIONS = 4


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS {message}")


def active_tab(page) -> str:
    return page.locator(".wx-drawer__tabs [role='tab'][aria-selected='true']").inner_text().strip()


def select_tab(page, label: str, accessible_name: str) -> None:
    page.get_by_role("tab", name=accessible_name).click()
    page.wait_for_function(
        """expected => document.querySelector(".wx-drawer__tabs [role=tab][aria-selected=true]")?.textContent?.trim() === expected""",
        arg=label,
        timeout=10_000,
    )


def main() -> int:
    errors: list[str] = []
    publication_asset_requests: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.add_init_script("localStorage.setItem('geonexsar_tour_v1', '1')")
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: publication_asset_requests.append(request.url)
               if "/agriculture/current/" in request.url else None)

        response = page.goto(BASE + "/agriculture", wait_until="domcontentloaded", timeout=30_000)
        require(response is not None and response.ok, "Agriculture route responds successfully")

        unsupported_date = page.request.post(
            BASE + "/api/agriculture/catalogue",
            data={
                "west": 91.3867,
                "south": 24.3533,
                "east": 91.4467,
                "north": 24.4133,
                "startDate": "2026-06-16",
                "endDate": "2026-08-22",
            },
        )
        unsupported_date_body = unsupported_date.json()
        require(
            unsupported_date.status == 400
            and "2026-06-17" in unsupported_date_body.get("error", ""),
            "the public catalogue API rejects dates older than the cloud worker's supported SME2 boundary",
        )

        status = page.locator(".agri-drawer-status")
        status.wait_for(state="visible", timeout=20_000)
        page.wait_for_function(
            """() => document.querySelector(".agri-drawer-status")?.textContent?.includes("SHA-256 checked")""",
            timeout=20_000,
        )
        require(
            "SHA-256 checked" in status.inner_text() and "EXPLORATORY" in status.inner_text(),
            "the published SME2 study is checksum-verified and explicitly labelled exploratory",
        )
        versioned_study_requests = [url for url in publication_asset_requests if "/study.json" in url]
        versioned_checksum_requests = [url for url in publication_asset_requests if "web-checksums.json" in url]
        require(
            versioned_study_requests and versioned_checksum_requests
            and all("v=" in url and "/current/releases/" in url for url in versioned_study_requests + versioned_checksum_requests),
            "study and checksum assets share one immutable release path and publication-version cache key",
        )
        require(
            page.get_by_text(EXPECTED_STUDY_ID, exact=True).count() >= 1,
            "the published Naogaon study ID is visible in the workspace",
        )
        require(
            page.get_by_text("DSG algorithm candidate", exact=False).count() >= 1,
            "the selected DSG algorithm stream is explicitly labelled",
        )
        require(
            page.locator(".agri-cohort-audit").count() == 1,
            "the same-pixel comparability audit renders from the real study",
        )
        require(
            page.locator(".agri-flag-atlas").count() == 1,
            "the surface-flag overlap atlas renders from the real study",
        )

        agriculture_map = page.locator(".agri-map")
        require(agriculture_map.count() == 1 and agriculture_map.is_visible(), "the Agriculture map renders")
        require(
            agriculture_map.locator(".agri-map-integrity button").count() == 0
            and page.get_by_role("button", name="Retry publication verification").count() == 0,
            "publication integrity errors do not expose a misleading map retry button",
        )
        page.wait_for_function(
            """() => [...document.querySelectorAll('.agri-map .leaflet-tile-pane img.leaflet-tile')].some(tile => tile.src.includes('tile.openstreetmap.org'))""",
            timeout=10_000,
        )
        base_tile_urls = agriculture_map.locator(".leaflet-tile-pane img.leaflet-tile").evaluate_all("(tiles) => tiles.map(tile => tile.src)")
        require(
            any("tile.openstreetmap.org" in url for url in base_tile_urls)
            and all("basemaps.cartocdn.com" not in url for url in base_tile_urls),
            "the default basemap uses keyless OpenStreetMap tiles, not CARTO's keyed endpoint",
        )
        page.locator(".agri-map-legend").wait_for(state="visible", timeout=20_000)
        require(
            agriculture_map.locator(".leaflet-image-layer").count() == 1
            and agriculture_map.locator(".agri-map-legend").count() == 1,
            "the checksum-verified SME2 preview overlay and legend render on the map",
        )
        readout = agriculture_map.locator(".agri-map-readout")
        require(
            readout.count() == 1 and readout.is_visible()
            and "FIELD OBSERVABILITY" in readout.inner_text()
            and "57.9%" in readout.inner_text()
            and "21.3%" in readout.inner_text(),
            "the map displays real soil-moisture, valid-footprint and same-pixel evidence",
        )
        map_trend_points = readout.locator(".agri-map-readout__signal svg polyline").get_attribute("points") or ""
        try:
            actual_trend_positions = [
                float(point.split(",", 1)[0]) for point in map_trend_points.split()
            ]
        except (TypeError, ValueError, IndexError):
            actual_trend_positions = []
        expected_trend_positions = [
            0.0, 100.0 / 6.0, 50.0, 200.0 / 3.0, 250.0 / 3.0, 100.0,
        ]
        require(
            len(actual_trend_positions) == EXPECTED_DATES
            and all(
                abs(actual - expected) <= 0.1
                for actual, expected in zip(actual_trend_positions, expected_trend_positions)
            ),
            "the map readout sparkline spaces acquisitions by real elapsed time (12/24/12/12/12 days), not equal index steps",
        )
        change_action = readout.get_by_role("button", name="View change layer")
        same_pixels_action = readout.get_by_role("button", name="Inspect same pixels")
        require(
            not change_action.is_disabled() and not same_pixels_action.is_disabled(),
            "change and same-pixel map actions are enabled for a verified study",
        )
        change_action.click()
        page.locator(".agri-map-legend__decrease").wait_for(state="visible", timeout=10_000)
        require(
            change_action.get_attribute("aria-pressed") == "true"
            and "MEDIAN SOIL-MOISTURE CHANGE" in readout.inner_text()
            and "0.033" in readout.inner_text()
            and "TARGET-VERSUS-BASELINE CHANGE" in readout.inner_text(),
            "the change layer readout reports the actual change statistics and target date",
        )
        same_pixels_action.click()
        page.locator(".agri-map-legend__matched").wait_for(state="visible", timeout=10_000)
        require(
            same_pixels_action.get_attribute("aria-pressed") == "true"
            and "SAME-PIXEL MEDIAN SOIL MOISTURE" in readout.inner_text()
            and "21.3%" in readout.inner_text(),
            "the same-pixel map readout switches to the fixed-cohort moisture and coverage",
        )
        page.locator(".agri-map-toolbar").get_by_role("button", name="Soil moisture").click()
        crop_button = page.locator(".agri-map-toolbar").get_by_role("button", name="Crop area")
        require(
            crop_button.count() == 0
            and "no independent crop-area mask" in readout.inner_text().lower(),
            "unavailable crop-mask layers are kept out of the live toolbar and explained in the readout",
        )
        require(
            page.locator(".agri-date-rail").count() == 0
            and page.locator(".agri-chart .agri-chart-point button").count() == EXPECTED_DATES,
            "one elapsed-time moisture chart exposes all six selectable acquisition dates without a duplicate rail",
        )
        require(
            page.locator(".agri-chart .agri-chart-point button").count() == EXPECTED_DATES,
            "the moisture trajectory contains six selectable real acquisition points",
        )
        date_valid_drift_points = page.locator(".agri-support-drift__point-hit--valid")
        same_pixel_drift_points = page.locator(".agri-support-drift__point-hit--fixed")
        require(
            date_valid_drift_points.count() == EXPECTED_DATES
            and same_pixel_drift_points.count() == EXPECTED_DATES,
            "the spatial-support comparison exposes both selectable series at all six real dates",
        )
        same_pixel_drift_points.nth(2).click()
        page.locator(".agri-map-legend__matched").wait_for(state="visible", timeout=10_000)
        require(
            "3 / 6" in page.locator(".agri-footer-head").inner_text()
            and page.locator(".agri-support-switch button").nth(1).get_attribute("aria-pressed") == "true"
            and same_pixel_drift_points.nth(2).get_attribute("aria-pressed") == "true",
            "selecting a fixed-cohort drift point syncs the third acquisition, chart and map",
        )
        date_valid_drift_points.nth(4).focus()
        page.keyboard.press("Enter")
        page.locator(".agri-map-legend__low").wait_for(state="visible", timeout=10_000)
        require(
            "5 / 6" in page.locator(".agri-footer-head").inner_text()
            and page.locator(".agri-support-switch button").nth(0).get_attribute("aria-pressed") == "true"
            and date_valid_drift_points.nth(4).get_attribute("aria-pressed") == "true",
            "keyboard activation selects the fifth date and restores its date-valid footprint",
        )
        page.locator(".agri-chart .agri-chart-point button").nth(EXPECTED_DATES - 1).click()
        require(
            "6 / 6" in page.locator(".agri-footer-head").inner_text()
            and "2026-10-23 target" in page.locator(".agri-footer-head").inner_text(),
            "the latest 23 October 2026 acquisition can be restored as the target after inspecting earlier dates",
        )

        rainfall_empty = page.locator(".agri-rainfall__empty")
        require(
            rainfall_empty.count() == 1 and rainfall_empty.is_visible()
            and page.locator(".agri-rainfall__plot").count() == 0,
            "rainfall is explicitly unavailable rather than fabricated when IMERG context is absent",
        )

        tabs = page.locator(".wx-drawer__tabs [role='tab']")
        require(tabs.count() == 5, "Explore, Operator, Evidence, Check it and Learn tabs are all present")

        select_tab(
            page,
            "Check it",
            "Check it: Follow the soil-moisture measurement, reference status and uncertainty",
        )
        require(active_tab(page) == "Check it", "Check it opens as a first-class investigation tab")
        page.locator(".evidence-chain__header h3").wait_for(state="visible", timeout=10_000)
        require(
            page.locator(".evidence-chain__header h3").inner_text() == "SME2 soil-moisture feasibility",
            "the standardized Agriculture evidence chain is rendered",
        )
        require(
            page.locator(".evidence-chain__state").inner_text() == "Exploratory",
            "the evidence chain reports exploratory evidence, not independent validation",
        )
        require(
            page.locator(".evidence-chain__observations li").count() == EXPECTED_DATES,
            "the evidence chain lists all six valid source observations",
        )

        select_tab(
            page,
            "Evidence",
            "Evidence: Review product maturity, quality flags, coverage and provenance",
        )
        require(active_tab(page) == "Evidence", "the Evidence tab opens for source and quality review")
        exclusions = page.get_by_text(
            f"Excluded acquisition dates ({EXPECTED_EXCLUSIONS})", exact=True
        )
        require(exclusions.count() == 1, "the four quality-excluded acquisition dates are disclosed")
        exclusions.click()
        exclusion_details = page.locator(".agri-details").filter(
            has=page.get_by_text(f"Excluded acquisition dates ({EXPECTED_EXCLUSIONS})", exact=True)
        )
        require(
            exclusion_details.locator(".agri-granule-list li").count() == EXPECTED_EXCLUSIONS,
            "each excluded acquisition has a dated, source-specific audit entry",
        )

        select_tab(
            page,
            "Check it",
            "Check it: Follow the soil-moisture measurement, reference status and uncertainty",
        )
        require(active_tab(page) == "Check it", "the Check it tab remains available for field-reference metrics")
        for metric in ("Precision", "Recall", "F1"):
            row = page.locator(".evidence-chain__reference-metrics > div").filter(
                has=page.get_by_text(metric, exact=True)
            )
            require(
                row.count() >= 1 and row.first.locator("dd").inner_text() == "Not recorded",
                f"{metric} remains unavailable without an independent field reference",
            )

        reference = page.locator(".evidence-chain__reference").inner_text().lower()
        require(
            "not recorded" in reference,
            "independent field reference remains explicitly not recorded",
        )

        select_tab(
            page,
            "Learn",
            "Learn: Understand SME2 measurements, quality flags and interpretation limits",
        )
        require(active_tab(page) == "Learn", "the Learn tab opens")
        page.get_by_text("Volumetric soil-moisture estimate · m³/m³", exact=True).wait_for()
        page.get_by_text("Independent field or matched crop/soil observations", exact=True).wait_for()
        require(True, "the Learn tab explains the measured variable and validation requirements")

        select_tab(
            page,
            "Operator",
            "Operator: Discover and select NISAR SME2 observations online",
        )
        require(active_tab(page) == "Operator", "the existing Operator workflow remains available")
        page.get_by_label("AOI west longitude").wait_for(state="visible")
        require(True, "the original AOI configuration controls remain available")
        require(
            page.get_by_label("Start date").input_value() == "2026-06-17",
            "the cloud-processing date window starts at the worker's supported SME2 collection date",
        )

        # Deterministic offline fixture: exercise the handoff without calling
        # NASA CMR or starting an authenticated cloud processing run.
        request_aoi = {
            "west": float(page.get_by_label("AOI west longitude").input_value()),
            "south": float(page.get_by_label("AOI south latitude").input_value()),
            "east": float(page.get_by_label("AOI east longitude").input_value()),
            "north": float(page.get_by_label("AOI north latitude").input_value()),
        }
        request_dates = {
            "start": page.get_by_label("Start date").input_value(),
            "end": page.get_by_label("End date").input_value(),
        }
        catalogue_fixture = {
            "schema_version": 1,
            "collection": "NISAR_L3_SME2_PROVISIONAL_V1",
            "date_range": request_dates,
            "aoi": request_aoi,
            "catalogue_granules": 11,
            "preflight_gate": {
                "minimum_unique_acquisitions": 6,
                "minimum_temporal_span_days": 60,
                "meaning": "Catalogue feasibility only.",
            },
            "series": [
                {
                    "series_id": "qa-eligible-170",
                    "signature": {
                        "release": "P05023", "track": "170", "direction": "A",
                        "frame": "014", "bandwidth": "4005", "polarization": "DHDH", "frequency": "A",
                    },
                    "observation_count": 6,
                    "dates": ["2026-06-17", "2026-06-29", "2026-07-11", "2026-08-04", "2026-08-16", "2026-08-28"],
                    "span_days": 72,
                    "median_revisit_days": 12,
                    "maximum_gap_days": 24,
                    "meets_preflight_gate": True,
                    "granules": [],
                },
                {
                    "series_id": "qa-below-gate",
                    "signature": {
                        "release": "P05023", "track": "069", "direction": "A",
                        "frame": "014", "bandwidth": "4005", "polarization": "DHDH", "frequency": "A",
                    },
                    "observation_count": 5,
                    "dates": ["2026-06-17", "2026-06-29", "2026-07-11", "2026-07-23", "2026-08-04"],
                    "span_days": 48,
                    "median_revisit_days": 12,
                    "maximum_gap_days": 12,
                    "meets_preflight_gate": False,
                    "granules": [],
                },
            ],
            "recommended_series_id": "qa-eligible-170",
            "status": "ELIGIBLE_FOR_OPERATOR_REVIEW",
            "interpretation_limits": ["Catalogue preflight is not HDF5 quality verification."],
        }
        page.route(
            "**/api/agriculture/catalogue",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(catalogue_fixture),
            ),
        )
        page.get_by_role("button", name="Discover SME2 observations").click()
        page.locator(".agri-online-next__launch").wait_for(state="visible", timeout=10_000)
        require(
            "ref=master" in (page.locator(".agri-online-next__launch").get_attribute("href") or "")
            and "qa-eligible-170" in page.locator(".agri-online-next").inner_text()
            and "REMOTE WORKER AVAILABLE" in page.locator(".agri-online-next").inner_text(),
            "an eligible CMR series opens the secure master cloud-processing handoff with its selected inputs",
        )
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        page.get_by_role("button", name="Copy workflow inputs").click()
        page.wait_for_function(
            "() => document.querySelector('.agri-online-next__feedback')?.textContent?.includes('Inputs copied')",
            timeout=5_000,
        )
        copied_inputs = page.evaluate("navigator.clipboard.readText()")
        require(
            "series_id=qa-eligible-170" in copied_inputs
            and "algorithm=baseline" in copied_inputs
            and "allow_missing_imerg=true" in copied_inputs,
            "the workflow handoff copies the selected series and all required cloud inputs",
        )

        page.locator(".agri-online-series").nth(1).click()
        page.locator(".agri-online-next--blocked").wait_for(state="visible", timeout=10_000)
        require(
            page.locator(".agri-online-next__launch").count() == 0,
            "a catalogue series below the minimum date/span gate cannot be sent to cloud processing",
        )

        page.get_by_label("End date").fill("2026-10-31")
        page.locator(".agri-online-stale").wait_for(state="visible", timeout=10_000)
        require(
            page.locator(".agri-online-next__launch").count() == 0,
            "changing the AOI/date form invalidates old catalogue results until discovery runs again",
        )

        page.get_by_role("button", name="Start walkthrough").click()
        page.get_by_role("heading", name="Inspect the SME2 measurements").wait_for()
        require(True, "the guided Agriculture walkthrough opens")
        page.get_by_role("button", name="Next section").click()
        page.wait_for_function(
            "() => document.querySelector('.wx-drawer__tabs [role=tab][aria-selected=true]')?.textContent?.trim() === 'Check it'",
            timeout=10_000,
        )
        page.get_by_role("heading", name="Check evidence and provenance").wait_for()
        require(True, "the walkthrough navigates to the Check it evidence tab")
        page.get_by_role("button", name="Next section").click()
        page.wait_for_function(
            "() => document.querySelector('.wx-drawer__tabs [role=tab][aria-selected=true]')?.textContent?.trim() === 'Learn'",
            timeout=10_000,
        )
        page.get_by_role("heading", name="Understand the interpretation limits").wait_for()
        require(True, "the walkthrough navigates to the Learn tab")
        page.get_by_role("button", name="Finish").click()

        browser.close()

    require(
        not errors,
        "Agriculture workflow produces no browser runtime errors: " + " | ".join(errors),
    )
    print("All published Agriculture production-browser checks passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise
