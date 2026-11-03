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

        primary = page.get_by_role("link", name="Inspect the Chókwè event case")
        primary.wait_for(state="visible", timeout=20_000)
        require(
            primary.get_attribute("href") == "/wetland/global?story=chokwe",
            "the homepage exposes the expected Chókwè deep link",
        )
        preserved = page.get_by_role("link", name="Open the Tanguar Haor case")
        require(preserved.count() == 1, "the existing Tanguar Haor entry remains available")

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
