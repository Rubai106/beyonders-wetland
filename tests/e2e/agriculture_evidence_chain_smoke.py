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
    return page.locator(".wx-tabs [role='tab'][aria-selected='true'] span:last-child").inner_text().strip()


def select_tab(page, label: str, accessible_name: str) -> None:
    page.get_by_role("tab", name=accessible_name).click()
    page.wait_for_function(
        """expected => document.querySelector(".wx-tabs [role=tab][aria-selected=true] span:last-child")?.textContent?.trim() === expected""",
        arg=label,
        timeout=10_000,
    )


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.add_init_script("localStorage.setItem('geonexsar_tour_v1', '1')")
        page.on("pageerror", lambda error: errors.append(str(error)))

        response = page.goto(BASE + "/agriculture", wait_until="domcontentloaded", timeout=30_000)
        require(response is not None and response.ok, "Agriculture route responds successfully")

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
        page.locator(".agri-map-legend").wait_for(state="visible", timeout=20_000)
        require(
            agriculture_map.locator(".leaflet-image-layer").count() == 1
            and agriculture_map.locator(".agri-map-legend").count() == 1,
            "the checksum-verified SME2 preview overlay and legend render on the map",
        )
        require(
            page.locator(".agri-date-rail button").count() == EXPECTED_DATES,
            "the elapsed-time acquisition rail contains all six valid observation dates",
        )
        require(
            page.locator(".agri-chart .agri-chart-point button").count() == EXPECTED_DATES,
            "the moisture trajectory contains six selectable real acquisition points",
        )
        require(
            "6 / 6" in page.locator(".agri-footer-head").inner_text()
            and "2026-10-23 target" in page.locator(".agri-footer-head").inner_text(),
            "the latest 23 October 2026 acquisition is selected as the target",
        )

        rainfall_empty = page.locator(".agri-rainfall__empty")
        require(
            rainfall_empty.count() == 1 and rainfall_empty.is_visible()
            and page.locator(".agri-rainfall__plot").count() == 0,
            "rainfall is explicitly unavailable rather than fabricated when IMERG context is absent",
        )

        tabs = page.locator(".wx-tabs [role='tab']")
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

        # Keep this regression deterministic and offline: return a small
        # representative CMR payload so the secure Actions handoff can be tested
        # without calling NASA or starting a real cloud job.
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
            "ref=Rubai-dev" in (page.locator(".agri-online-next__launch").get_attribute("href") or "")
            and "qa-eligible-170" in page.locator(".agri-online-next").inner_text()
            and "REMOTE WORKER AVAILABLE" in page.locator(".agri-online-next").inner_text(),
            "an eligible CMR series opens the secure Rubai-dev cloud-processing handoff with its selected inputs",
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
            "() => document.querySelector('.wx-tabs [role=tab][aria-selected=true] span:last-child')?.textContent?.trim() === 'Check it'",
            timeout=10_000,
        )
        page.get_by_role("heading", name="Check evidence and provenance").wait_for()
        require(True, "the walkthrough navigates to the Check it evidence tab")
        page.get_by_role("button", name="Next section").click()
        page.wait_for_function(
            "() => document.querySelector('.wx-tabs [role=tab][aria-selected=true] span:last-child')?.textContent?.trim() === 'Learn'",
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
