#!/usr/bin/env python3
"""Visual viewport regression check for the shared notification bell (mock data only).

Requires the Python Playwright package and a local Chromium/Chrome executable.
No application endpoints are loaded or written to.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "supabase-config.js"
ARTIFACTS = ROOT / "test-artifacts" / "notification-popup"


def fixture_html(notification_js: str, edge: str) -> str:
    return f'''<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
* {{ box-sizing: border-box; }}
body {{ margin: 0; min-height: 1800px; background: #f6f3f2; color: #1b1c1c; font: 14px Arial, sans-serif; }}
header {{ position: fixed; z-index: 40; inset: 0 0 auto; height: 76px; padding: 12px 16px; display: flex; align-items: center; direction: rtl; background: white; border-bottom: 1px solid #d2c4ba; }}
.zam-header-tools {{ display: flex; align-items: center; gap: 8px; direction: rtl; }}
.zam-header-account {{ order: 1; width: 132px; height: 44px; padding: 4px; border: 1px solid #d2c4ba; border-radius: 24px; display: flex; align-items: center; gap: 6px; }}
.zam-sidebar-toggle {{ order: 2; width: 44px; height: 44px; border: 1px solid #d2c4ba; border-radius: 50%; background: white; }}
.zam-header-tools #notif-bell-slot {{ order: 3; flex: 0 0 44px; }}
header.edge-right .zam-header-tools {{ position: absolute; right: 16px; top: 16px; }}
header.edge-left .zam-header-tools {{ position: absolute; left: 16px; top: 16px; }}
#header-avatar {{ width: 30px; height: 30px; border-radius: 50%; object-fit: cover; background: #c8c8b0; }}
.employee-name {{ overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 700; }}
button {{ cursor: pointer; }}
#zam-notif-wrapper {{ position: relative; }}
#zam-notif-btn {{ position: relative; width: 44px; height: 44px; border: 1px solid #d2c4ba; border-radius: 50%; background: white; }}
#zam-notif-btn .material-symbols-outlined {{ display: inline-block; width: 20px; height: 20px; font-size: 0; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%234e453d' d='M12 22c1.1 0 1.99-.9 1.99-2h-3.98c0 1.1.89 2 1.99 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1z'/%3E%3C/svg%3E") center / contain no-repeat; }}
#zam-notif-btn > span[aria-label] {{ position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 4px; display: flex; align-items: center; justify-content: center; border-radius: 99px; color: white; background: #ba1a1a; font-size: 10px; font-weight: 700; }}
#zam-notif-menu {{ position: absolute; top: 100%; left: 0; margin-top: 4px; width: 320px; max-width: calc(100vw - 2rem); z-index: 50; overflow: hidden; border: 1px solid #d2c4ba; border-radius: 12px; background: white; box-shadow: 0 8px 28px #0003; }}
#zam-notif-menu.hidden {{ display: none !important; }}
#zam-notif-menu > .menu-head {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; color: white; background: #285849; }}
#zam-notif-menu #zam-mark-all-notifications {{ border: 0; color: inherit; background: transparent; font: inherit; font-weight: 700; text-decoration: underline; }}
#zam-notif-menu .max-h-80 {{ max-height: 320px; overflow-y: auto; }}
#zam-notif-menu a {{ display: flex; gap: 8px; padding: 12px; color: #222; text-decoration: none; border-bottom: 1px solid #eee; }}
#zam-notif-menu a .material-symbols-outlined {{ display: none; }}
#zam-notif-menu p {{ margin: 0; }}
main {{ padding-top: 110px; }}
</style></head>
<body><header class="edge-{edge}"><div class="zam-header-tools">
<button class="zam-sidebar-toggle" aria-label="إظهار قائمة التنقل">☰</button>
<div id="notif-bell-slot"></div>
<div class="zam-header-account"><img id="header-avatar" alt="صورة الموظف" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23d8d2cb'/%3E%3Ccircle cx='50' cy='37' r='18' fill='%236f6257'/%3E%3Cellipse cx='50' cy='91' rx='30' ry='25' fill='%236f6257'/%3E%3C/svg%3E"><span class="employee-name">محمود شريف</span></div>
</div></header><main>محتوى تجريبي محلي — لا اتصال ببيانات الإنتاج</main>
<script>
const ZamSession = {{ get: () => ({{ id: 'mock-profile', full_name: 'محمود شريف', role: 'Owner' }}) }};
const mockNotifications = Array.from({{length: 8}}, (_, i) => ({{
  id: 'mock-' + i, notification_type: 'new_daily_report', title: 'تنبيه تجريبي ' + (i + 1),
  body: 'بيانات محلية وهمية فقط — لا اتصال بالخادم.', priority: 'normal',
  link_path: '../dashboard/index.html', is_read: i > 2, created_at: new Date(Date.now() - i * 60000).toISOString()
}}));
const zamClient = {{ from() {{ let countQuery = false; return {{
  select(_fields, options) {{ if (options?.head) countQuery = true; return this; }},
  eq() {{ return this; }}, order() {{ return this; }},
  limit() {{ return Promise.resolve({{ data: mockNotifications, error: null }}); }},
  then(resolve, reject) {{ return Promise.resolve({{ count: 3, error: null }}).then(resolve, reject); }}
}}; }}, channel() {{ return {{ on() {{ return this; }}, subscribe() {{ return this; }} }}; }}, removeChannel() {{}} }};
</script>
<script>{notification_js}</script>
</body></html>'''


def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-screenshots", action="store_true", help="check geometry without saving screenshots")
    parser.add_argument("--browser", default=os.environ.get("CHROME_BIN", "/usr/bin/google-chrome"))
    args = parser.parse_args()

    source = SOURCE.read_text(encoding="utf-8")
    start = source.index("// جرس الإشعارات التشغيلي المشترك")
    end = source.index("// قوالب البريد الإلكتروني", start)
    notification_js = source[start:end]
    if not args.no_screenshots:
        ARTIFACTS.mkdir(parents=True, exist_ok=True)

    cases = [(1280, 800), (390, 844), (320, 740)]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True)
        try:
            for width, height in cases:
                for edge in ("right", "left"):
                    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
                    try:
                        page.set_content(fixture_html(notification_js, edge), wait_until="load")
                        page.evaluate("() => refreshNotificationBell()")
                        page.wait_for_selector("#zam-notif-menu", state="attached")
                        page.evaluate("window.scrollTo(0, 640)")
                        page.locator("#zam-notif-btn").click()
                        page.wait_for_function("document.querySelector('#zam-notif-btn')?.getAttribute('aria-expanded') === 'true'")
                        page.evaluate("window.scrollTo(0, 920)")
                        page.wait_for_timeout(40)
                        result = page.locator("#zam-notif-menu").evaluate("""menu => {
                          const r = menu.getBoundingClientRect();
                          const bell = document.querySelector('#zam-notif-btn').getBoundingClientRect();
                          const account = document.querySelector('.zam-header-account').getBoundingClientRect();
                          return {x:r.left, right:r.right, y:r.top, bottom:r.bottom, width:r.width, height:r.height,
                            viewportWidth:innerWidth, viewportHeight:innerHeight, scrollY:scrollY,
                            bellLeft:bell.left, bellRight:bell.right, accountLeft:account.left, accountRight:account.right};
                        }""")
                        assert result["scrollY"] >= 600, f"{width}px/{edge}: page did not scroll: {result}"
                        assert result["x"] >= 8, f"{width}px/{edge}: popup clipped past the left edge: {result}"
                        assert result["right"] <= width - 8, f"{width}px/{edge}: popup clipped past the right edge: {result}"
                        assert result["y"] >= 8, f"{width}px/{edge}: popup clipped past the top edge: {result}"
                        assert result["bottom"] <= height - 8, f"{width}px/{edge}: popup clipped past the bottom edge: {result}"
                        assert result["bellRight"] < result["accountLeft"], f"{width}px/{edge}: bell overlaps or sits beside employee identity: {result}"
                        print(f"PASS {width}x{height} {edge} edge after scroll: popup {result['x']:.0f}..{result['right']:.0f} x {result['y']:.0f}..{result['bottom']:.0f}; bell separated from employee identity")
                        if not args.no_screenshots:
                            image = ARTIFACTS / f"notification-popup-{width}-{edge}.png"
                            page.screenshot(path=str(image), full_page=False)
                        page.locator("#zam-notif-btn").click()
                        page.wait_for_function("document.querySelector('#zam-notif-btn')?.getAttribute('aria-expanded') === 'false'")
                        assert not page.locator("#zam-notif-menu").is_visible(), f"{width}px/{edge}: bell did not close the popup"
                    finally:
                        page.close()
        finally:
            browser.close()


if __name__ == "__main__":
    run()
