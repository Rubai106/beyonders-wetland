"""Production-browser smoke test for the featured Chókwè deep link.

Run against a built Next.js public viewer:
    python tests/e2e/chokwe_deep_link_smoke.py http://127.0.0.1:3140

The test checks navigation and visible, already-published case text only. It does
not call NASA services, recompute scientific results, or treat candidates as truth.
"""
from __future__ import annotations

import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:3140"
EXPECTED_PATH = "/wetland/global"
EXPECTED_QUERY = "story=chokwe"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS {message}")


def verify_case(page) -> None:
    page.locator(".wx-drawer__tabs [role='tab'][aria-selected='true']").wait_for(
        state="visible", timeout=20_000
    )
    active_tab = page.locator(
        ".wx-drawer__tabs [role='tab'][aria-selected='true']"
    ).inner_text()
    require(active_tab.strip() == "Learn", "the deep link selects the Learn drawer tab")

    heading = page.locator("#mozambique-case-title")
    heading.wait_for(state="visible", timeout=20_000)
    require(heading.inner_text().startswith("Chókwè:"), "the Chókwè case heading is visible")

    case = page.locator(".mozambique-case")
    case.wait_for(state="visible")
    text = case.inner_text().lower()
    require("accuracy unverified" in text, "the case retains its unverified evidence status")
    require("candidates, not a flood map" in text, "the candidate disclaimer is visible")
    require("1.26%" in text and "88.2%" in text and "89.1%" in text,
            "the HLS coverage limit and later UNOSAT overlaps are visible")

    native = page.locator(".mozambique-case__native")
    native.wait_for(state="visible", timeout=20_000)
    native_text = native.inner_text()
    require("39.4%" in native_text and "57,997 of 147,151" in native_text,
            "the native-grid GFM positive-support fraction and eligible denominator are visible")
    require("5.80 km²" in native_text and "not field validation" in native_text.lower(),
            "the positive-overlap area and validation limit are visible")

    recovery_response = page.request.get(
        BASE + "/evidence/chokwe-native-recovery-2026-11-10.json"
    )
    require(recovery_response.ok, "the public native-recovery provenance JSON is reachable")
    recovery_record = recovery_response.json()
    require(
        recovery_record["recovery_run_id"] == "6cbe03836ada44b09188b9aee2b94bc3"
        and recovery_record["recovery_is_reprocessing_not_original_binary_restoration"] is True,
        "the public recovery record identifies reprocessing and the exact run",
    )

    comparison_response = page.request.get(
        BASE + "/evidence/chokwe-native-gfm-comparison-2026-11-10.json"
    )
    require(comparison_response.ok, "the public native-grid GFM comparison JSON is reachable")
    comparison_record = comparison_response.json()
    open_water = comparison_record["open_water_candidates"]
    require(
        open_water["gfm_flood_positive_overlap_pixels"] == 57997
        and open_water["eligible_candidate_pixels_after_gfm_masks"] == 147151,
        "the published comparison JSON preserves its overlap and denominator counts",
    )

    # The target should be brought into view by the workspace's deep-link handler.
    page.wait_for_function(
        """() => {
          const el = document.querySelector('#mozambique-case-title');
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.top >= -4 && rect.top < window.innerHeight;
        }""",
        timeout=10_000,
    )
    require(True, "the deep link scrolls the featured case heading into view")


def main() -> int:
    browser_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        # The app deliberately uses smooth scrolling unless the user asks
        # for reduced motion. Emulate that accessibility preference so this
        # layout assertion measures the deep-link destination, not animation
        # duration or CI frame scheduling.
        page = browser.new_page(
            viewport={"width": 1440, "height": 900},
            reduced_motion="reduce",
        )
        page.add_init_script(
            "localStorage.setItem('geonexsar_tour_v1', '1')"
        )
        page.on("pageerror", lambda error: browser_errors.append(str(error)))

        response = page.goto(BASE + "/", wait_until="domcontentloaded", timeout=30_000)
        require(response is not None and response.ok, "the production homepage responds successfully")

        primary = page.get_by_role("link", name="Open the Chókwè investigation")
        primary.wait_for(state="visible", timeout=20_000)
        require(
            primary.get_attribute("href") == "/wetland/global?story=chokwe",
            "the homepage exposes the expected Chókwè deep link",
        )
        preserved = page.locator(".g3-domain-card[data-domain='wetland'] a[href='/wetland']")
        require(preserved.count() == 1, "the Tanguar Haor investigation remains available from the Wetlands card")

        primary.click()
        page.wait_for_url("**/wetland/global?story=chokwe", timeout=20_000)
        parsed = urlparse(page.url)
        require(
            parsed.path == EXPECTED_PATH and parsed.query == EXPECTED_QUERY,
            "clicking the homepage link opens the correct route and query",
        )
        verify_case(page)

        # A fresh page load verifies that the URL is independently shareable.
        direct = browser.new_page(
            viewport={"width": 1440, "height": 900},
            reduced_motion="reduce",
        )
        direct.add_init_script(
            "localStorage.setItem('geonexsar_tour_v1', '1')"
        )
        direct.on("pageerror", lambda error: browser_errors.append(str(error)))
        direct.goto(BASE + EXPECTED_PATH + "?" + EXPECTED_QUERY,
                    wait_until="domcontentloaded", timeout=30_000)
        verify_case(direct)

        browser.close()

    require(not browser_errors, "the featured-case navigation produces no browser runtime errors")
    print("All Chókwè production-browser checks passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise
