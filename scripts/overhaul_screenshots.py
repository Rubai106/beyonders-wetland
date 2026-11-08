"""Overhaul verification screenshots: 1440x900 desktop + 390x844 mobile.
Run: ~/workspace/forest-test-venv/bin/python scripts/overhaul_screenshots.py
Saves PNGs under ~/workspace/beyonders-master-port/audit-2026-11-08/overhaul-screenshots/
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3140"
OUT = Path.home() / "workspace" / "beyonders-master-port" / "audit-2026-11-08" / "overhaul-screenshots"
OUT.mkdir(parents=True, exist_ok=True)

# (slug, path, wait_selector, extra_wait_ms)
PAGES = [
    ("home", "/", ".globe-mount canvas", 4500),
    ("investigations", "/investigations", "main", 2500),
    ("wetland", "/wetland", ".wx-obs", 3000),
    ("wetland-global", "/wetland/global", ".global-map-wrap", 4000),
    ("forest", "/forest/rondonia", "main", 3000),
    ("volcano", "/volcano/hayli-gubbi", "main", 3000),
    ("agriculture", "/agriculture", "main", 3000),
    ("temporal", "/temporal", "main", 3000),
    ("hypotheses", "/hypotheses", "main", 2500),
    ("compare", "/compare", "main", 2500),
    ("observability", "/observability", "main", 3000),
    ("lineage", "/lineage", "main", 2500),
]

VIEWPORTS = [
    ("desktop-1440x900", 1440, 900),
    ("mobile-390x844", 390, 844),
]


def main() -> None:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/home/hatch/.cache/ms-playwright/chromium-1179/chrome-linux/chrome",
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        for vname, w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(f"{vname}: {e}"))
            for slug, path, selector, wait_ms in PAGES:
                try:
                    page.goto(BASE + path, wait_until="domcontentloaded", timeout=30_000)
                    page.wait_for_selector(selector, timeout=25_000)
                    page.wait_for_timeout(wait_ms)
                    page.screenshot(path=str(OUT / f"{slug}-{vname}.png"), full_page=False)
                    print(f"OK {slug} {vname}")
                except Exception as exc:  # noqa: BLE001
                    print(f"FAIL {slug} {vname}: {exc}")
                    errors.append(f"{slug} {vname}: {exc}")
            ctx.close()
        browser.close()
    print(f"page errors: {errors if errors else 'none'}")
    print(f"saved to {OUT}")


if __name__ == "__main__":
    main()
