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


def ensure_drawer_open(page) -> None:
    drawer = page.locator(".wx-drawer")
    if drawer.count() and drawer.is_visible():
        return

    reopen = page.locator(".wx-drawer-reopen")
    if reopen.count() and reopen.first.is_visible():
        reopen.first.click()
    else:
        map_tabs = page.locator(".wx-tabs .wx-tab")
        if map_tabs.count() and map_tabs.first.is_visible():
            map_tabs.first.click()

    drawer.wait_for(state="visible", timeout=10_000)


def verify_field_volume(page, selector: str, label: str, minimum_dates: int = 1) -> None:
    disclosure = page.locator(selector)
    disclosure.wait_for(state="visible", timeout=20_000)
    toggle = disclosure.get_by_role("button", name="Explore in 3D")
    require(
        toggle.is_visible() and toggle.get_attribute("aria-expanded") == "false",
        f"{label} keeps the optional 3D view collapsed until requested",
    )
    toggle.click()
    canvas = disclosure.locator("canvas.field-volume-canvas")
    canvas.wait_for(state="visible", timeout=20_000)
    date_list = disclosure.locator(".field-volume-scene__dates")
    dates = date_list.locator("button")
    require(
        canvas.is_visible() and dates.count() >= minimum_dates,
        f"{label} opens its data-bound 3D scene and exposes {minimum_dates}+ selectable observations",
    )
    initial_index = dates.evaluate_all(
        "(buttons) => buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true')"
    )
    require(initial_index >= 0, f"{label} starts with one real observation selected")
    selectable = date_list.locator("button:not([disabled])")
    if selectable.count() > 1:
        target = selectable.nth(1)
        target.click()
        require(
            target.get_attribute("aria-pressed") == "true"
            and date_list.locator("button[aria-pressed='true']").count() == 1,
            f"{label} synchronizes a selected 3D observation with its module state",
        )
        if selectable.count() > 2:
            previous_label = target.inner_text()
            canvas.focus()
            canvas.press("ArrowRight")
            page.wait_for_function(
                """({selector, previous}) => {
                    const root = document.querySelector(selector);
                    const active = root?.querySelector(".field-volume-scene__dates button[aria-pressed='true']");
                    return Boolean(active && active.textContent.trim() !== previous);
                }""",
                arg={"selector": selector, "previous": previous_label},
                timeout=5_000,
            )
            require(
                date_list.locator("button[aria-pressed='true']").count() == 1,
                f"{label} supports keyboard date navigation inside the 3D scene",
            )
        dates.nth(initial_index).click()
        require(
            dates.nth(initial_index).get_attribute("aria-pressed") == "true"
            and date_list.locator("button[aria-pressed='true']").count() == 1,
            f"{label} restores the original selected observation after the 3D interaction check",
        )
    disclosure.get_by_role("button", name="Close 3D view").click()
    require(
        disclosure.locator("canvas.field-volume-canvas").count() == 0,
        f"{label} releases the 3D canvas when the panel is closed",
    )


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

        # The landing page must expose all four workspaces from both navigation
        # locations; Agriculture is a workspace but not a globe marker layer.
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=30_000)
        primary_nav = page.get_by_role("navigation", name="Primary")
        require(
            primary_nav.get_by_role("link", name="Agriculture").get_attribute("href") == "/agriculture"
            and all(primary_nav.get_by_role("link", name=name).count() == 1 for name in ("Wetlands", "Forests", "Volcanoes", "Agriculture")),
            "the desktop landing navigation exposes every published workspace",
        )
        footer_nav = page.get_by_role("navigation", name="Footer")
        require(
            footer_nav.get_by_role("link", name="Agriculture").get_attribute("href") == "/agriculture"
            and all(footer_nav.get_by_role("link", name=name).count() == 1 for name in ("Wetlands", "Forests", "Volcanoes", "Agriculture")),
            "the landing footer provides a direct route to all four workspaces",
        )
        globe_canvas = page.locator(".globe-mount canvas")
        globe_canvas.wait_for(state="visible", timeout=30_000)
        require(
            globe_canvas.get_attribute("tabindex") == "0"
            and "arrow keys" in (globe_canvas.get_attribute("aria-label") or "").lower(),
            "the 3D globe exposes keyboard rotation and zoom instructions",
        )
        require(
            page.locator(".g3-chapter").first.evaluate("(element) => getComputedStyle(element).opacity") == "1",
            "reduced-motion preference keeps landing content visible without scroll-reveal animation",
        )
        globe_canvas.focus()
        globe_canvas.press("ArrowLeft")
        globe_controls = page.get_by_role("group", name="Globe movement controls")
        require(
            all(globe_controls.get_by_role("button", name=name).count() == 1 for name in (
                "Rotate globe left", "Tilt globe up", "Rotate globe right",
                "Tilt globe down", "Zoom globe out", "Zoom globe in",
            )),
            "globe rotation and zoom also have single-click controls for pointer users",
        )
        globe_controls.get_by_role("button", name="Rotate globe left").click()
        globe_controls.get_by_role("button", name="Zoom globe in").click()

        # Pin selection supports exact coordinate entry as well as globe taps.
        page.get_by_role("button", name="Drop a pin anywhere").click()
        pin_form = page.locator(".g3-pinbar__form")
        pin_form.get_by_label("Latitude").fill("23.8103")
        pin_form.get_by_label("Longitude").fill("90.4125")
        pin_form.get_by_role("button", name="Use coordinates").click()
        pin_href = page.locator(".g3-pinbar a.g3-btn").get_attribute("href") or ""
        require(
            "latitude=23.81030" in pin_href and "longitude=90.41250" in pin_href,
            "keyboard and touch users can set an exact study location without dragging or tapping the globe",
        )
        require(
            page.get_by_role("button", name="Cancel pin mode").count() == 0,
            "the overlapping hero action is removed while pin mode is active",
        )
        page.locator(".g3-pinbar").get_by_role("button", name="Cancel location selection").click()
        require(
            page.locator(".g3-pinbar").count() == 0,
            "the in-panel cancel action closes pin mode cleanly",
        )

        # Both seven-date wetland publications must use the same genuine
        # observation/timeline/map interaction, while keeping Tanguar default.
        page.goto(BASE + "/wetland", wait_until="domcontentloaded", timeout=30_000)
        case_picker = page.locator(".wx-casepick")
        case_picker.wait_for(state="visible", timeout=30_000)
        require(
            page.locator(".wx-nav a[href='/wetland']").get_attribute("aria-current") == "page",
            "Wetlands is identified as the current workspace in shared navigation",
        )
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
        ensure_drawer_open(page)
        page.locator(".wx-drawer__tabs button[role='tab']").filter(has_text="Explore").click()
        verify_field_volume(page, ".field-volume-disclosure--wetland", "Wetlands", minimum_dates=7)

        wetland_modes = page.locator(".wx-modes button[role='radio']")
        require(
            wetland_modes.count() == 3
            and wetland_modes.nth(0).get_attribute("aria-checked") == "true"
            and wetland_modes.nth(0).get_attribute("type") == "button",
            "Wetlands exposes a three-option radio mode selector with one selected mode",
        )
        wetland_modes.first.focus()
        wetland_modes.first.press("ArrowRight")
        require(
            wetland_modes.nth(1).get_attribute("aria-checked") == "true"
            and wetland_modes.nth(1).evaluate("(element) => element === document.activeElement"),
            "right arrow changes and focuses the next Wetland map mode",
        )
        wetland_modes.nth(1).press("End")
        require(
            wetland_modes.nth(2).get_attribute("aria-checked") == "true",
            "End selects Detection in the Wetland map-mode radio group",
        )
        wetland_modes.nth(2).press("Home")
        require(
            wetland_modes.nth(0).get_attribute("aria-checked") == "true",
            "Home restores Motion in the Wetland map-mode radio group",
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
            page.locator(".wx-nav a[href='/forest/rondonia']").get_attribute("aria-current") == "page",
            "Forests is identified as the current workspace in shared navigation",
        )
        forest_tabs = page.locator(".wx-drawer__tabs button[role='tab']")
        require(
            forest_tabs.count() == 3 and forest_tabs.nth(0).get_attribute("aria-selected") == "true",
            "Forest drawer starts with one selected tab and exposes its tab panel",
        )
        forest_tabs.first.focus()
        forest_tabs.first.press("ArrowRight")
        require(
            forest_tabs.nth(1).get_attribute("aria-selected") == "true"
            and forest_tabs.nth(1).evaluate("(element) => element === document.activeElement"),
            "right arrow selects and focuses the next Forest investigation tab",
        )
        forest_tabs.nth(1).press("End")
        require(
            forest_tabs.nth(2).get_attribute("aria-selected") == "true",
            "End moves to the last Forest investigation tab",
        )
        forest_tabs.nth(2).press("Home")
        require(
            forest_tabs.nth(0).get_attribute("aria-selected") == "true",
            "Home returns to the first Forest investigation tab",
        )
        require(
            "What changed in the forest?" in page.inner_text(".wx-quest")
            and page.locator(".forest-comparison-map").count() == 2
            and page.locator(".forest-date-ribbon button").count() >= 4,
            "Forest opens the interactive Rondônia case with paired maps and selectable dates",
        )
        verify_field_volume(page, ".field-volume-disclosure--forest", "Forests", minimum_dates=4)

        page.goto(BASE + "/volcano", wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_url("**/volcano/hayli-gubbi", timeout=20_000)
        page.locator(".deformation-map-hint").wait_for(state="visible", timeout=30_000)
        require(
            page.locator(".wx-nav a[href='/volcano/hayli-gubbi']").get_attribute("aria-current") == "page",
            "Volcanoes is identified as the current workspace in shared navigation",
        )
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
        verify_field_volume(page, ".field-volume-disclosure--volcano", "Volcanoes", minimum_dates=3)

        volcano_tabs = page.locator(".wx-drawer__tabs button[role='tab']")
        volcano_tabs.nth(1).click()
        coordinate_form = page.locator(".deformation-inspector form")
        coordinate_form.wait_for(state="visible", timeout=15_000)
        latitude_input = coordinate_form.get_by_label("Latitude")
        longitude_input = coordinate_form.get_by_label("Longitude")
        latitude_input.fill("91")
        longitude_input.fill("40.665")
        coordinate_form.get_by_role("button", name="Inspect coordinates").click()
        coordinate_error = coordinate_form.locator("#deformation-coordinate-error")
        require(
            coordinate_error.is_visible()
            and "latitude from" in coordinate_error.inner_text().lower()
            and latitude_input.get_attribute("aria-invalid") == "true"
            and longitude_input.get_attribute("aria-invalid") == "true"
            and "Select a point on either map" in page.locator(".deformation-pixel").first.inner_text(),
            "Volcano coordinate inspection rejects invalid latitude with an announced error and does not move the sample",
        )
        latitude_input.fill("13.606")
        longitude_input.fill("40.665")
        coordinate_form.get_by_role("button", name="Inspect coordinates").click()
        require(
            coordinate_form.locator("#deformation-coordinate-error").count() == 0
            and latitude_input.get_attribute("aria-invalid") == "false"
            and longitude_input.get_attribute("aria-invalid") == "false",
            "valid Volcano coordinates clear the validation error and can be inspected",
        )

        # Kīlauea is deliberately a single-observation 3D view: one interval
        # must not be presented as a fabricated time series.
        page.goto(BASE + "/volcano/kilauea", wait_until="domcontentloaded", timeout=30_000)
        page.locator(".kilauea-map-surface").wait_for(state="visible", timeout=30_000)
        verify_field_volume(page, ".field-volume-disclosure--volcano", "Kīlauea", minimum_dates=1)

        # Agriculture must explain an integrity failure without an inert retry
        # button floating on the map.
        page.goto(BASE + "/agriculture", wait_until="domcontentloaded", timeout=30_000)
        agriculture_map = page.locator(".agri-map")
        agriculture_map.wait_for(state="visible", timeout=30_000)
        require(
            page.locator(".wx-nav a[href='/agriculture']").get_attribute("aria-current") == "page",
            "Agriculture is identified as the current workspace in shared navigation",
        )
        require(
            agriculture_map.locator(".agri-map-integrity button").count() == 0
            and page.get_by_role("button", name="Retry publication verification").count() == 0,
            "Agriculture integrity status has no ineffective Retry button",
        )

        # Responsive acceptance: selectors and the active map must remain
        # available without horizontal page overflow on a phone viewport.
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=30_000)
        mobile_menu = page.locator(".g3-mobile-nav")
        require(
            mobile_menu.is_visible() and not page.locator(".g3-top > nav").is_visible(),
            "the landing page switches to a compact mobile navigation instead of squeezing desktop links",
        )
        mobile_menu.locator("summary").click()
        mobile_nav = page.get_by_role("navigation", name="Mobile primary")
        require(
            mobile_nav.get_by_role("link", name="Agriculture").get_attribute("href") == "/agriculture"
            and all(mobile_nav.get_by_role("link", name=name).count() == 1 for name in ("Wetlands", "Forests", "Volcanoes", "Agriculture")),
            "the mobile navigation exposes every workspace with full-size touch targets",
        )
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
            "the landing page has no horizontal overflow at phone width",
        )
        mobile_nav.get_by_role("link", name="Agriculture").click()
        page.wait_for_url("**/agriculture", timeout=30_000)
        require(True, "the mobile Agriculture navigation opens the published workspace")

        page.goto(BASE + "/wetland", wait_until="domcontentloaded", timeout=30_000)
        ensure_drawer_open(page)
        page.locator(".wx-drawer__tabs button[role='tab']").filter(has_text="Explore").click()
        verify_field_volume(page, ".field-volume-disclosure--wetland", "Wetlands mobile", minimum_dates=7)
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
            "opening the optional Wetland 3D view does not introduce phone-width overflow",
        )
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
        agriculture_status = page.locator(".agri-status-pill")
        agriculture_status.wait_for(state="visible", timeout=30_000)
        page.wait_for_function(
            "() => { const status = document.querySelector('.agri-status-pill'); "
            "return status && status.textContent?.trim() !== 'Checking published study'; }",
            timeout=30_000,
        )
        agriculture_state = (agriculture_status.evaluate("(el) => el.textContent?.trim()") or "").strip()
        agriculture_timeline = page.locator(".agri-chart .agri-chart-point button")
        agriculture_toolbar = page.locator(".agri-map-toolbar")
        agriculture_map_height = page.locator(".agri-map").evaluate(
            "(el) => el.getBoundingClientRect().height"
        )

        if agriculture_state == "Checksum verified":
            footer_summary = page.locator(".agri-footer-head > span:last-child").inner_text()
            try:
                expected_dates = int(footer_summary.split("/", 1)[1].split("·", 1)[0].strip())
            except (IndexError, ValueError) as error:
                raise AssertionError(
                    f"Could not read the published Agriculture date count from {footer_summary!r}"
                ) from error
            require(
                expected_dates >= 4
                and agriculture_timeline.count() == expected_dates
                and agriculture_toolbar.is_visible()
                and agriculture_map_height >= 200,
                "Agriculture keeps every checksum-verified date, map control and timeline point usable on a phone",
            )
        elif agriculture_state == "No local publication":
            require(
                agriculture_timeline.count() == 0
                and page.locator(".agri-footer-empty").is_visible()
                and page.locator(".agri-map-empty").is_visible()
                and agriculture_toolbar.is_visible()
                and page.locator(".agri-map-toolbar button").evaluate_all(
                    "(nodes) => nodes.every((button) => button.disabled)"
                )
                and agriculture_map_height >= 200,
                "Agriculture shows a clean no-publication state without fabricated dates or enabled data controls",
            )
        elif agriculture_state == "Publication unavailable":
            require(
                agriculture_timeline.count() == 0
                and page.locator(".agri-map-integrity").is_visible()
                and page.locator(".agri-footer-empty").is_visible()
                and agriculture_toolbar.is_visible()
                and agriculture_map_height >= 200,
                "Agriculture withholds unverified measurements while retaining a usable map and integrity explanation",
            )
        else:
            require(
                False,
                f"Agriculture reaches a recognized stable publication state (received {agriculture_state!r})",
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
        require(
            forest_maps.count() == 2
            and all(height >= 240 for height in forest_maps.evaluate_all("(nodes) => nodes.map(el => el.getBoundingClientRect().height)"))
            and page.locator(".wx-drawer").evaluate("(el) => getComputedStyle(el).position !== 'fixed'"),
            f"Forest stacks two usable map panels and keeps evidence in page flow on a phone (map heights: {[round(h) for h in forest_maps.evaluate_all('(nodes) => nodes.map(el => el.getBoundingClientRect().height)')]})",
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
        require(
            volcano_maps.count() == 2
            and all(height >= 240 for height in volcano_maps.evaluate_all("(nodes) => nodes.map(el => el.getBoundingClientRect().height)"))
            and page.locator(".wx-drawer").evaluate("(el) => getComputedStyle(el).position !== 'fixed'"),
            f"Volcano stacks two usable radar maps and keeps evidence in page flow on a phone (map heights: {[round(h) for h in volcano_maps.evaluate_all('(nodes) => nodes.map(el => el.getBoundingClientRect().height)')]})",
        )
        require(
            page.locator(".deformation-timeline").count() == 1,
            "Volcano exposes one interval selector rather than repeating it inside Explore",
        )
        require(
            page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
            "the Volcano mobile workspace has no horizontal page overflow",
        )

        # Tablet acceptance: the same single-column investigation flow should
        # remain usable at 1024px rather than squeezing the map between rails.
        page.set_viewport_size({"width": 1024, "height": 768})
        tablet_routes = [
            ("/wetland", ".wx-map .leaflet-container", "Wetlands"),
            ("/agriculture", ".agri-map", "Agriculture"),
            ("/forest", ".forest-comparison", "Forest"),
            ("/volcano", ".deformation-map-hint", "Volcano"),
        ]
        for route, map_selector, label in tablet_routes:
            page.goto(BASE + route, wait_until="domcontentloaded", timeout=30_000)
            page.locator(map_selector).wait_for(state="visible", timeout=30_000)
            ensure_drawer_open(page)
            root_position = page.locator(".wx-root").evaluate("(el) => getComputedStyle(el).position")
            drawer_position = page.locator(".wx-drawer").evaluate("(el) => getComputedStyle(el).position")
            map_height = page.locator(".wx-map").evaluate("(el) => el.getBoundingClientRect().height")
            require(
                root_position != "fixed" and drawer_position != "fixed" and map_height >= 380,
                f"{label} keeps a 380px+ map and an in-flow evidence panel at tablet width (map {round(map_height)}px)",
            )
            require(
                page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
                f"{label} has no horizontal page overflow at tablet width",
            )
        page.goto(BASE + "/forest", wait_until="domcontentloaded", timeout=30_000)
        forest_tablet_maps = page.locator(".forest-comparison-map")
        forest_tablet_maps.first.wait_for(state="visible", timeout=30_000)
        forest_tablet_heights = forest_tablet_maps.evaluate_all(
            "(nodes) => nodes.map(el => el.getBoundingClientRect().height)"
        )
        require(
            forest_tablet_maps.count() == 2
            and all(height >= 220 for height in forest_tablet_heights),
            f"Forest keeps two readable side-by-side maps at tablet width (heights: {[round(height) for height in forest_tablet_heights]})",
        )

        page.goto(BASE + "/volcano", wait_until="domcontentloaded", timeout=30_000)
        volcano_tablet_maps = page.locator(".deformation-map")
        volcano_tablet_maps.first.wait_for(state="visible", timeout=30_000)
        volcano_tablet_heights = volcano_tablet_maps.evaluate_all(
            "(nodes) => nodes.map(el => el.getBoundingClientRect().height)"
        )
        require(
            volcano_tablet_maps.count() == 2
            and all(height >= 220 for height in volcano_tablet_heights),
            f"Volcano keeps two readable side-by-side maps at tablet width (heights: {[round(height) for height in volcano_tablet_heights]})",
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
