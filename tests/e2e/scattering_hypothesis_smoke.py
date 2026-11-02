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

        require(
            panel.get_by_role("heading", name="Scattering hypothesis ledger").count() == 1,
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
        soil.click()
        soil_detail = panel.locator(".wx-scattering__detail").inner_text()
        require(
            "Cannot distinguish with this pair" in soil_detail
            and "No independent soil-moisture measurement" in soil_detail,
            "soil-moisture alternative remains unresolved without independent evidence",
        )

        vegetation = panel.locator(
            ".wx-scattering__choice", has_text="Vegetation, roughness or intercepted water"
        )
        vegetation.click()
        vegetation_detail = panel.locator(".wx-scattering__detail").inner_text()
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
