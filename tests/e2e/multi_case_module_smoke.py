"""Production-browser integration checks for published module case navigation.

Run against the built public viewer:
    python tests/e2e/multi_case_module_smoke.py http://127.0.0.1:3140

The test loads only committed public evidence packages. It does not fabricate
results, call Earthdata, or substitute a demo series for a missing publication.
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
            viewport={"width": 1440, "height": 960},
            reduced_motion="reduce",
        )
        page.add_init_script("localStorage.setItem('geonexsar_tour_v1', '1')")
        page.on("pageerror", lambda error: errors.append(str(error)))

        # Both seven-date wetland publications must use the same genuine
        # observation/timeline/map interaction, while keeping Tanguar default.
        page.goto(BASE + "/wetland", wait_until="domcontentloaded", timeout=30_000)
        case_picker = page.locator(".wx-casepick")
        case_picker.wait_for(state="visible", timeout=30_000)
        require(
            case_picker.locator("option").count() == 3
            and case_picker.locator("option[value='featured']").count() == 1
            and case_picker.locator("option[value='hakaluki']").count() == 1
            and case_picker.locator("option[value='chokwe']").count() == 1,
            "the Wetlands selector lists Tanguar Haor and Hakaluki Haor",
        )
        require(
            case_picker.input_value() == "featured"
            and "Tanguar Haor" in page.inner_text(".wx-rail"),
            "Tanguar Haor remains the original default case",
        )
        play = page.locator(".wx-play")
        if play.count() and play.get_attribute("aria-pressed") == "true":
            play.click()
        case_picker.select_option("hakaluki")
        page.wait_for_function(
            "() => document.querySelector('.wx-rail h1')?.textContent?.includes('Hakaluki Haor')",
            timeout=30_000,
        )
        page.wait_for_function(
            "() => document.querySelectorAll('path.wx-patch').length === 213",
            timeout=30_000,
        )
        require(
            page.locator(".wx-obs").count() == 7,
            "Hakaluki loads seven discrete, real NISAR observation dates",
        )
        require(
            "2.57" in page.inner_text(".wx-rail")
            and page.locator("path.wx-patch").count() == 213,
            "Hakaluki's 17 July peak shows the published 2.57 km² and 213 candidates",
        )
        if page.locator(".wx-drawer-reopen").count():
            page.locator(".wx-drawer-reopen").click()
        page.get_by_role("tab", name="Check it").click()
        page.locator(".wx-callout").wait_for(state="visible", timeout=10_000)
        require(
            "Inconclusive" in page.locator(".wx-callout").inner_text()
            and "<0.1%" in page.locator(".wx-drawer").inner_text(),
            "Hakaluki's extremely limited HLS overlap is shown as less than 0.1%, not rounded to zero",
        )
        page.locator(".wx-modes button[data-mode='RADAR']").click()
        page.wait_for_function(
            "() => document.querySelectorAll('.leaflet-wxRadar-pane img').length > 0",
            timeout=20_000,
        )
        require(True, "Hakaluki loads its actual date-matched HH/HV radar preview")

        case_picker = page.locator(".wx-casepick")
        case_picker.select_option("featured")
        page.wait_for_function(
            "() => document.querySelector('.wx-rail h1')?.textContent?.includes('Tanguar Haor')",
            timeout=30_000,
        )
        page.wait_for_function(
            "() => document.querySelectorAll('path.wx-patch').length === 295",
            timeout=30_000,
        )
        require(
            page.locator(".wx-obs").count() == 7
            and page.locator("path.wx-patch").count() == 295,
            "switching back restores Tanguar's own observations and peak geometry",
        )

        page.locator(".wx-casepick").select_option("chokwe")
        page.wait_for_url("**/wetland/global?story=chokwe", timeout=30_000)
        require(True, "Chókwè is directly discoverable from the Wetlands case picker")
        page.locator("#mozambique-case-title").wait_for(
            state="visible", timeout=30_000
        )
        require(
            page.locator(".mozambique-case").is_visible(),
            "the Chókwè navigation opens its dedicated event investigation",
        )

        # Forests and Volcanoes should open published case workspaces rather
        # than the global discovery catalogue or a generic planned-status page.
        page.goto(BASE + "/forest", wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_url("**/forest/rondonia", timeout=20_000)
        page.locator(".forest-comparison").wait_for(state="visible", timeout=30_000)
        require(
            "What changed in the forest?" in page.inner_text(".wx-quest")
            and page.locator(".forest-comparison-map").count() == 2
            and page.locator(".forest-date-ribbon button").count() >= 4,
            "Forest opens the interactive Rondônia case with paired maps and selectable dates",
        )

        page.goto(BASE + "/volcano", wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_url("**/volcano/hayli-gubbi", timeout=20_000)
        page.locator(".deformation-map-hint").wait_for(state="visible", timeout=30_000)
        require(
            "What moved beneath Erta Ale?" in page.inner_text(".wx-quest")
            and page.locator(".deformation-timeline button").count() >= 3,
            "Volcano opens the interactive Hayli Gubbi case with selectable NISAR intervals",
        )
        require(
            page.get_by_role(
                "link", name="Explore the Kīlauea · Episode 36 case ↗"
            ).count() == 1,
            "Hayli Gubbi links to the separate Kīlauea Episode 36 investigation",
        )

        # Agriculture must explain an integrity failure without an inert retry
        # button floating on the map.
        page.goto(BASE + "/agriculture", wait_until="domcontentloaded", timeout=30_000)
        agriculture_map = page.locator(".agri-map")
        agriculture_map.wait_for(state="visible", timeout=30_000)
        require(
            agriculture_map.locator(".agri-map-integrity button").count() == 0
            and page.get_by_role("button", name="Retry publication verification").count() == 0,
            "Agriculture integrity status has no ineffective Retry button",
        )

        # Responsive acceptance: selectors and the active map must remain
        # available without horizontal page overflow on a phone viewport.
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(BASE + "/wetland", wait_until="domcontentloaded", timeout=30_000)
        mobile_case_picker = page.locator(".wx-casepick")
        mobile_case_picker.wait_for(state="visible", timeout=30_000)
        require(
            mobile_case_picker.is_visible()
            and mobile_case_picker.locator("option").count() == 3,
            "the Tanguar, Hakaluki and Chókwè case picker remains visible on a phone",
        )
        require(
            page.locator(".wx-map .leaflet-container").is_visible()
            and page.locator(".wx-map .leaflet-container").evaluate("(el) => el.getBoundingClientRect().height >= 200"),
            "the wetland map retains a usable touch viewport on a phone",
        )
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
            "the Wetlands mobile workspace has no horizontal page overflow",
        )

        page.goto(BASE + "/agriculture", wait_until="domcontentloaded", timeout=30_000)
        page.locator(".agri-map").wait_for(state="visible", timeout=30_000)
        page.locator(".agri-chart .agri-chart-point button").first.wait_for(state="visible", timeout=30_000)
        require(
            page.locator(".agri-chart .agri-chart-point button").count() == 6
            and page.locator(".agri-map-toolbar").is_visible()
            and page.locator(".agri-map").evaluate("(el) => el.getBoundingClientRect().height >= 200"),
            "Agriculture keeps its map controls and six-date timeline usable on a phone",
        )
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
            "the Agriculture mobile workspace has no horizontal page overflow",
        )

        require(
            page.locator(".wx-root").evaluate("(el) => getComputedStyle(el).position !== 'fixed'")
            and page.locator(".wx-drawer").evaluate("(el) => getComputedStyle(el).position !== 'fixed'"),
            "Agriculture uses normal page flow instead of a fixed canvas or a drawer over the map",
        )

        page.goto(BASE + "/forest", wait_until="domcontentloaded", timeout=30_000)
        page.locator(".forest-comparison").wait_for(state="visible", timeout=30_000)
        forest_maps = page.locator(".forest-comparison-map")
        forest_metrics = page.locator(".forest-comparison").evaluate(
            "(el) => ({map: el.getBoundingClientRect().toJSON(), gridRows: getComputedStyle(el).gridTemplateRows, panels: [...el.querySelectorAll('.forest-comparison-map')].map(node => ({rect: node.getBoundingClientRect().toJSON(), position: getComputedStyle(node).position, minHeight: getComputedStyle(node).minHeight})), rootPosition: getComputedStyle(document.querySelector('.wx-root')).position, drawerPosition: getComputedStyle(document.querySelector('.wx-drawer')).position})"
        )
        print("FOREST_PHONE_LAYOUT", forest_metrics)
        require(
            forest_maps.count() == 2
            and all(height >= 240 for height in forest_maps.evaluate_all("(nodes) => nodes.map(el => el.getBoundingClientRect().height)"))
            and page.locator(".wx-drawer").evaluate("(el) => getComputedStyle(el).position !== 'fixed'"),
            "Forest stacks two usable map panels and keeps evidence in page flow on a phone",
        )
        require(
            page.get_by_label("Processed observation date").count() == 0
            and page.locator(".forest-date-ribbon button").count() >= 4,
            "Forest has one date selector, not duplicated date controls",
        )
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
            "the Forest mobile workspace has no horizontal page overflow",
        )

        page.goto(BASE + "/volcano", wait_until="domcontentloaded", timeout=30_000)
        page.locator(".deformation-map-hint").wait_for(state="visible", timeout=30_000)
        volcano_maps = page.locator(".deformation-map")
        volcano_metrics = page.locator(".deformation-maps").evaluate(
            "(el) => ({map: el.getBoundingClientRect().toJSON(), gridRows: getComputedStyle(el).gridTemplateRows, panels: [...el.querySelectorAll('.deformation-map')].map(node => ({rect: node.getBoundingClientRect().toJSON(), position: getComputedStyle(node).position, minHeight: getComputedStyle(node).minHeight})), rootPosition: getComputedStyle(document.querySelector('.wx-root')).position, drawerPosition: getComputedStyle(document.querySelector('.wx-drawer')).position})"
        )
        print("VOLCANO_PHONE_LAYOUT", volcano_metrics)
        require(
            volcano_maps.count() == 2
            and all(height >= 240 for height in volcano_maps.evaluate_all("(nodes) => nodes.map(el => el.getBoundingClientRect().height)"))
            and page.locator(".wx-drawer").evaluate("(el) => getComputedStyle(el).position !== 'fixed'"),
            "Volcano stacks two usable radar maps and keeps evidence in page flow on a phone",
        )
        require(
            page.locator(".deformation-timeline").count() == 1,
            "Volcano exposes one interval selector rather than repeating it inside Explore",
        )
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
            "the Volcano mobile workspace has no horizontal page overflow",
        )

        browser.close()

    require(not errors, "module navigation has no browser runtime errors: " + " | ".join(errors))
    print("All multi-case and module-navigation production-browser checks passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise
