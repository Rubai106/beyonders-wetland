"""Production-browser checks for the worldwide NISAR investigation and scene catalogue.

Run against the built public viewer:
    python tests/e2e/explore_smoke.py http://127.0.0.1:3140

The suite checks map controls and evidence navigation without treating missing
global coverage or external tile-service failures as detector failures.
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
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(
            viewport={"width": 1440, "height": 900},
            reduced_motion="reduce",
        )
        page.add_init_script("localStorage.setItem('geonexsar_tour_v1', '1')")
        page.on("pageerror", lambda error: errors.append(str(error)))

        page.goto(BASE + "/wetland/global", wait_until="domcontentloaded", timeout=30_000)
        page.locator("#global-nisar-map").wait_for(state="visible", timeout=30_000)
        page.locator(".wx-drawer__tabs").wait_for(state="visible", timeout=15_000)

        require(
            "Explore NISAR across the world" in page.inner_text(".wx-quest"),
            "global investigation opens with its purpose and scope",
        )
        require(
            page.locator("#global-nisar-map[role='region']").count() == 1
            and page.locator("#global-nisar-map").get_attribute("aria-label")
            == "Worldwide NISAR backscatter mosaic with processed candidate overlay",
            "world map has a descriptive accessible region name",
        )
        require(
            page.locator("#global-nisar-map .leaflet-container").count() == 1,
            "worldwide observation map initializes",
        )

        tabs = page.locator(".wx-drawer__tabs button[role='tab']")
        require(
            tabs.count() == 3
            and [tabs.nth(i).inner_text() for i in range(3)] == ["Explore", "Check it", "Learn"]
            and tabs.nth(0).get_attribute("aria-selected") == "true",
            "global evidence drawer exposes three correctly labelled sections",
        )
        tabs.nth(0).focus()
        tabs.nth(0).press("ArrowRight")
        require(
            tabs.nth(1).get_attribute("aria-selected") == "true"
            and tabs.nth(1).evaluate("(element) => element === document.activeElement"),
            "global evidence tabs support arrow-key navigation and visible focus",
        )
        tabs.nth(1).press("End")
        require(
            tabs.nth(2).get_attribute("aria-selected") == "true",
            "End selects the final global evidence tab",
        )
        tabs.nth(2).press("Home")
        require(
            tabs.nth(0).get_attribute("aria-selected") == "true",
            "Home returns to the Explore tab",
        )

        coordinate_disclosure = page.locator("details.map-coordinate-disclosure")
        coordinate_disclosure.locator("summary").click()
        latitude = page.locator("#map-coordinate-latitude")
        longitude = page.locator("#map-coordinate-longitude")
        latitude.fill("90")
        longitude.fill("20")
        page.locator(".map-coordinate-search-button").click()
        error = page.locator("#map-coordinate-error")
        require(
            error.is_visible()
            and "Latitude must be within the map range" in error.inner_text()
            and latitude.get_attribute("aria-invalid") == "true"
            and longitude.get_attribute("aria-invalid") == "true",
            "coordinate search rejects out-of-range latitude and announces the error",
        )

        latitude.fill("25.1500")
        longitude.fill("91.0667")
        page.locator(".map-coordinate-search-button").click()
        result = page.locator(".map-coordinate-result")
        require(
            result.is_visible()
            and "25.15000°" in result.inner_text()
            and "91.06670°" in result.inner_text()
            and latitude.get_attribute("aria-invalid") == "false",
            "valid coordinate search centers the map and confirms the selected point",
        )

        layer_disclosure = page.locator("details.map-layer-settings")
        layer_disclosure.locator("summary").click()
        layer_toggles = layer_disclosure.locator(".detection-layer-toggles input[type='checkbox']")
        require(layer_toggles.count() == 2, "map layer panel exposes mosaic and scene-footprint switches")
        layer_toggles.nth(0).check()
        layer_toggles.nth(1).check()
        require(
            layer_toggles.nth(0).is_checked() and layer_toggles.nth(1).is_checked(),
            "global mosaic and acquisition-footprint switches retain their selected state",
        )

        catalog_link = page.get_by_role("link", name="Browse worldwide scene records ↗")
        require(
            catalog_link.count() == 1
            and catalog_link.get_attribute("href") == "/wetland/global/scenes",
            "global investigation links to the dedicated NASA scene catalogue",
        )
        page.goto(BASE + "/wetland/global/scenes", wait_until="domcontentloaded", timeout=30_000)
        page.locator(".global-map-wrap").wait_for(state="visible", timeout=30_000)
        require(
            "WORLDWIDE COVERAGE" in page.inner_text("body")
            and "Coverage only" in page.inner_text("body")
            and "no wetland detections" in page.inner_text("body").lower(),
            "scene catalogue distinguishes acquired coverage from detections",
        )
        require(
            page.get_by_role("link", name="Open science file").count() <= 1,
            "catalogue does not fabricate a science-file link when a scene is not selected",
        )

        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(BASE + "/wetland/global", wait_until="domcontentloaded", timeout=30_000)
        page.locator("#global-nisar-map").wait_for(state="visible", timeout=30_000)
        map_height = page.locator("#global-nisar-map").evaluate(
            "(element) => element.getBoundingClientRect().height"
        )
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
            and map_height >= 200,
            f"global investigation remains usable at phone width (map height {round(map_height)}px)",
        )

        browser.close()

    require(not errors, "global exploration has no browser runtime errors: " + " | ".join(errors))
    print("All worldwide mission-control and scene-catalogue browser checks passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise
