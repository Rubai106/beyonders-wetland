"""Production-browser smoke test for the candidate-level scattering hypothesis ledger.

Run against a built public viewer:
    python tests/e2e/scattering_hypothesis_smoke.py http://127.0.0.1:3140

This verifies the interactive explanation panel using the existing Wetland showcase.
It does not recompute detections or claim any physical mechanism is confirmed.
"""
from __future__ import annotations

import sys
from playwright.sync_api import sync_playwright

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

        page.goto(BASE + "/wetland", wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector(".wx-obs", timeout=20_000)
        page.wait_for_selector("path.wx-patch", timeout=20_000)

        # Open a real candidate from the packaged Tanguar Haor showcase.
        page.locator("path.wx-patch").nth(40).click(force=True)
        page.wait_for_selector(".wx-drawer", timeout=10_000)
        page.locator(".wx-drawer__body").evaluate("(element) => { element.scrollTop = element.scrollHeight; }")
        page.get_by_role("button", name="Challenge this detection").click()
        panel = page.locator(".wx-scattering")
        panel.wait_for(state="visible", timeout=10_000)
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

        soil = panel.locator(".wx-scattering__choice", has_text="Soil-moisture variation")
        soil.evaluate("(button) => button.click()")
        soil_detail_locator = panel.locator('.wx-scattering__detail[aria-label="Soil-moisture variation"]')
        soil_detail_locator.wait_for(state="visible", timeout=10_000)
        require(soil.get_attribute("aria-pressed") == "true", "soil-moisture hypothesis becomes selected")
        soil_detail = soil_detail_locator.inner_text()
        require(
            "Cannot distinguish with this pair" in soil_detail
            and "No independent soil-moisture measurement" in soil_detail,
            "soil-moisture alternative remains unresolved without independent evidence",
        )

        vegetation = panel.locator(
            ".wx-scattering__choice", has_text="Vegetation, roughness or intercepted water"
        )
        vegetation.evaluate("(button) => button.click()")
        vegetation_detail_locator = panel.locator(
            '.wx-scattering__detail[aria-label="Vegetation, roughness or intercepted water"]'
        )
        vegetation_detail_locator.wait_for(state="visible", timeout=10_000)
        require(
            vegetation.get_attribute("aria-pressed") == "true",
            "vegetation and surface hypothesis becomes selected",
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
        open_water = panel.locator(".wx-scattering__choice", has_text="Open-water surface scattering")
        open_water.evaluate("(button) => button.click()")
        open_water_detail = panel.locator('.wx-scattering__detail[aria-label="Open-water surface scattering"]')
        open_water_detail.wait_for(state="visible", timeout=10_000)
        require(open_water.get_attribute("aria-pressed") == "true", "open-water hypothesis becomes selected")
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
        require(
            ("bounding_box" in query) != ("point" in query),
            "archive query uses either candidate bounds or an explicitly centroid-only point",
        )
        page.locator("[data-testid='evidence-window']").select_option("3")
        expanded_query = parse_qs(urlparse(cmr_link.get_attribute("href") or "").query)
        temporal = expanded_query.get("temporal[]", [""])[0].split(",")
        require(
            len(temporal) == 2 and temporal[0].endswith("T00:00:00Z") and temporal[1].endswith("T23:59:59Z"),
            "adjusting the date window regenerates an explicit UTC granule-search range",
        )
        with page.expect_download() as download_info:
            request_panel.get_by_role("button", name="Download evidence request JSON").click()
        download = download_info.value
        request_path = download.path()
        import json
        with open(request_path, encoding="utf-8") as request_file:
            exported = json.load(request_file)
        require(
            exported.get("schemaVersion") == "beyonders.evidence-request/1.0"
            and exported.get("hypothesis", {}).get("id") == "open-water"
            and len(exported.get("archiveSearches", [])) == 2,
            "downloaded JSON preserves the selected hypothesis, query links and request schema",
        )
        require(
            any("not a validation result" in warning for warning in exported.get("warnings", [])),
            "exported request warns that archive matches are not validation",
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
