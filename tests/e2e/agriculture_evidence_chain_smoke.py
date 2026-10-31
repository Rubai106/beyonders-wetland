"""Production-browser smoke test for Agriculture's shared evidence workflow.

Run against a built Next.js public viewer:
    python tests/e2e/agriculture_evidence_chain_smoke.py http://127.0.0.1:3140

This checks the user interface and explicit no-publication state. It does not
claim there are genuine Agriculture SME2 observations or field validation data.
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:3140"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS {message}")


def active_tab(page) -> str:
    return page.locator(".wx-tabs [role='tab'][aria-selected='true']").inner_text().strip()


def select_tab(page, label: str, accessible_name: str) -> None:
    page.get_by_role("tab", name=accessible_name).click()
    page.wait_for_function(
        """expected => document.querySelector(".wx-tabs [role=tab][aria-selected=true]")?.textContent?.trim() === expected""",
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

        page.locator(".agri-drawer-status").wait_for(state="visible", timeout=20_000)
        page.get_by_text("No real Agriculture publication is bundled.", exact=True).wait_for(
            state="visible", timeout=20_000
        )
        require(True, "the workspace explicitly states that no genuine Agriculture publication is bundled")

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
            page.locator(".evidence-chain__header h3").inner_text() == "Agriculture soil-moisture feasibility",
            "the standardized Agriculture evidence chain is rendered",
        )
        require(
            page.locator(".evidence-chain__state").inner_text() == "No published study",
            "the evidence chain does not manufacture a study result",
        )
        reference = page.locator(".evidence-chain__reference").inner_text().lower()
        require("not recorded" in reference, "independent field reference remains explicitly not recorded")
        require(
            "precision" in reference and "not recorded" in reference
            and "recall" in reference and "f1" in reference,
            "precision, recall and F1 remain unavailable without a reference dataset",
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
            "Operator: Configure an AOI and generate the local processing workflow",
        )
        require(active_tab(page) == "Operator", "the existing Operator workflow remains available")
        page.get_by_label("AOI west longitude").wait_for(state="visible")
        require(True, "the original AOI configuration controls remain available")

        page.get_by_role("button", name="Start walkthrough").click()
        page.get_by_role("heading", name="Inspect the SME2 measurements").wait_for()
        require(True, "the guided Agriculture walkthrough opens")
        page.get_by_role("button", name="Next section").click()
        page.wait_for_function(
            "() => document.querySelector('.wx-tabs [role=tab][aria-selected=true]')?.textContent?.trim() === 'Check it'",
            timeout=10_000,
        )
        page.get_by_role("heading", name="Check evidence and provenance").wait_for()
        require(True, "the walkthrough navigates to the Check it evidence tab")
        page.get_by_role("button", name="Next section").click()
        page.wait_for_function(
            "() => document.querySelector('.wx-tabs [role=tab][aria-selected=true]')?.textContent?.trim() === 'Learn'",
            timeout=10_000,
        )
        page.get_by_role("heading", name="Understand the interpretation limits").wait_for()
        require(True, "the walkthrough navigates to the Learn tab")
        page.get_by_role("button", name="Finish").click()

        browser.close()

    require(not errors, "Agriculture workflow produces no browser runtime errors")
    print("All Agriculture evidence-chain production-browser checks passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise
