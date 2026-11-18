#!/usr/bin/env python3
"""Print regression for the weekly report's branch checklist-compliance cards.

Run: python3 tools/weekly-report-print.integration.py
Uses synthetic fixtures only, blocks outbound requests, and denies database writes.
"""
from __future__ import annotations

import datetime as dt
import http.server
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION_PATH = ROOT / "tools" / "weekly-report.integration.py"
spec = importlib.util.spec_from_file_location("weekly_report_integration_fixture", INTEGRATION_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load the shared synthetic weekly-report fixture")
fixture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)


def main() -> int:
    data = fixture_module.fixture(dt.date.today())
    # Keep the planned branch out until its owner-confirmed opening date.
    data["branches"][2]["planned_opening_date"] = "2099-01-01"
    for branch_no in range(4, 9):
        data["branches"].append({
            "id": f"10000000-0000-4000-8000-{branch_no:012d}",
            "name": f"فرع اختبار {branch_no}",
            "created_at": "2025-01-01T00:00:00Z",
            "lifecycle_status": "operational",
        })

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/weekly-report/index.html"
    failures: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM", "/usr/bin/chromium"),
            )
            page = browser.new_page(viewport={"width": 1365, "height": 900})
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def network_guard(route):
                request_url = route.request.url
                if fixture_module.request_is_local(request_url, port):
                    route.continue_()
                elif "@supabase/supabase-js" in request_url:
                    route.fulfill(status=200, content_type="application/javascript", body="/* offline mock */")
                else:
                    route.abort()

            page.route("**/*", network_guard)
            init_script = fixture_module.INIT_JS.replace("__FIXTURE__", json.dumps(data, ensure_ascii=False))
            page.add_init_script(init_script)
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_function(
                "document.querySelectorAll('#chartChecks .branch-compliance-card').length === 7",
                timeout=15000,
            )

            # Match the page's print path: prepare the report and render in print media.
            page.emulate_media(media="print")
            page.evaluate("ZamWeeklyReport.preparePrint()")
            metrics = page.evaluate("""() => {
              const box = document.getElementById('chartChecks');
              const bounds = box.getBoundingClientRect();
              const cards = [...box.querySelectorAll('.branch-compliance-card')];
              return {
                cardCount: cards.length,
                maxHeight: getComputedStyle(box).maxHeight,
                overflow: getComputedStyle(box).overflowY,
                allCardsFit: cards.every(card => {
                  const rect = card.getBoundingClientRect();
                  return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
                })
              };
            }""")
            if metrics["cardCount"] != 7:
                failures.append(f"Expected seven operational branch cards, found {metrics['cardCount']}")
            if metrics["maxHeight"] != "none" or metrics["overflow"] != "visible" or not metrics["allCardsFit"]:
                failures.append("Print CSS still clips checklist cards: " + json.dumps(metrics, ensure_ascii=False))

            pdf_bytes = page.pdf(format="A4", print_background=True)
            if not pdf_bytes.startswith(b"%PDF"):
                failures.append("The browser did not generate a printable PDF")
            elif shutil.which("pdftotext"):
                with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf_file:
                    pdf_file.write(pdf_bytes)
                    pdf_file.flush()
                    extracted = subprocess.run(
                        ["pdftotext", pdf_file.name, "-"],
                        check=True,
                        capture_output=True,
                        text=True,
                    ).stdout
                card_label_count = extracted.count("القوائم المسندة")
                if card_label_count != 7:
                    failures.append(f"Expected all seven checklist-compliance cards in the PDF, found {card_label_count}")
            else:
                failures.append("pdftotext is required to verify card text in the generated PDF")

            audit = page.evaluate("window.__zamMockAudit")
            if audit["writes"]:
                failures.append("The test attempted a database write: " + repr(audit["writes"]))
            if errors:
                failures.append("Browser errors: " + " | ".join(errors))
            browser.close()
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()

    if failures:
        for failure in failures:
            print("FAIL: " + failure)
        return 1
    print("PASS: all seven synthetic branch checklist-compliance cards appear in the weekly-report print PDF; no writes or external requests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
