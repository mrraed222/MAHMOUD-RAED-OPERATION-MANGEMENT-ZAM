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
import re
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


def full_sales_fixture(today: dt.date) -> tuple[dict[str, list[dict]], dt.date]:
    data = fixture_module.fixture(today)
    start = today - dt.timedelta(days=24)
    branches = []
    reports = []
    for branch_no in range(1, 36):
        branch_id = f"10000000-0000-4000-8000-{branch_no:012d}"
        branches.append({
            "id": branch_id,
            "name": f"فرع اختبار {branch_no:02d}",
            "created_at": "2025-01-01T00:00:00Z",
            "lifecycle_status": "operational",
        })
        for day_no in range(25):
            report_date = start + dt.timedelta(days=day_no)
            reports.append({
                "id": f"sales-fixture-{branch_no:02d}-{day_no:02d}",
                "branch_id": branch_id,
                "report_date": report_date.isoformat(),
                "shift_type": "Morning" if day_no % 2 == 0 else "Evening",
                "supervisor_name": "مشرف اختبار",
                "total_sales": 100000 + branch_no * 1000 + day_no,
                "orders_count": 100 + branch_no,
                "avg_ticket": 1000 + branch_no,
                "team_status": "كامل",
                "positive_reviews": 0,
                "custom_fields": {},
                "sheet_key": f"sales-fixture-{branch_no}-{day_no}",
            })
    planned_id = "10000000-0000-4000-8000-999999999999"
    branches.append({
        "id": planned_id,
        "name": "فرع مخطط لا يظهر",
        "created_at": "2025-01-01T00:00:00Z",
        "lifecycle_status": "planned",
        "planned_opening_date": "2099-01-01",
    })
    reports.append({
        "id": "planned-sales-fixture",
        "branch_id": planned_id,
        "report_date": today.isoformat(),
        "shift_type": "Morning",
        "supervisor_name": "مشرف اختبار",
        "total_sales": 99999999,
        "orders_count": 999999,
        "avg_ticket": 999999,
        "team_status": "كامل",
        "positive_reviews": 0,
        "custom_fields": {},
        "sheet_key": "planned-sales-fixture",
    })
    data["branches"] = branches
    data["daily_reports"] = reports
    return data, start


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

            # Stress the two sales sections at the requested 25-day / 35-branch scale.
            full_data, start = full_sales_fixture(dt.date.today())
            page2 = browser.new_page(viewport={"width": 1365, "height": 900})
            page2.on("pageerror", lambda error: errors.append(str(error)))
            page2.route("**/*", network_guard)
            full_init_script = fixture_module.INIT_JS.replace("__FIXTURE__", json.dumps(full_data, ensure_ascii=False))
            page2.add_init_script(full_init_script)
            page2.goto(url, wait_until="domcontentloaded")
            page2.wait_for_function("document.querySelector('#dFrom') && document.querySelector('#chartTrend .trend-row')", timeout=20000)
            start_date = start.isoformat()
            end_date = dt.date.today().isoformat()
            page2.evaluate("""range => {
              const from = document.getElementById('dFrom');
              from.value = range.from; from.dispatchEvent(new Event('change', {bubbles:true}));
              const to = document.getElementById('dTo');
              to.value = range.to; to.dispatchEvent(new Event('change', {bubbles:true}));
            }""", {"from": start_date, "to": end_date})
            page2.wait_for_function("document.querySelectorAll('#chartTrend .trend-row').length === 25 && document.querySelectorAll('#chartBranch .branch-row').length === 35 && document.querySelectorAll('#panes .sales-table tbody tr').length === 35", timeout=20000)
            expected = page2.evaluate("""() => ({
              trend: [...document.querySelectorAll('#chartTrend .trend-row')].map(row => ({
                date: row.querySelector('.trend-label small')?.textContent.trim(),
                value: row.querySelector('.trend-values b')?.textContent.trim()
              })),
              chartBranches: [...document.querySelectorAll('#chartBranch .branch-row')].map(row => ({
                name: row.querySelector('.branch-name')?.textContent.trim(),
                sales: row.querySelector('.branch-values b')?.textContent.trim()
              })),
              tableBranches: [...document.querySelectorAll('#panes .sales-table tbody tr')].map(row => {
                const cells = [...row.cells];
                return {
                  name: cells[0]?.querySelector('.branch-drill b')?.textContent.trim(),
                  sales: cells[2]?.querySelector('b')?.textContent.trim(),
                  otherValues: [1, 3, 4].map(index => cells[index]?.querySelector('b')?.textContent.trim()).concat(cells[5]?.querySelector('span')?.textContent.trim())
                };
              }),
              counts: {
                trend: document.querySelectorAll('#chartTrend .trend-row').length,
                chartBranches: document.querySelectorAll('#chartBranch .branch-row').length,
                tableBranches: document.querySelectorAll('#panes .sales-table tbody tr').length
              }
            })""")
            page2.emulate_media(media="print")
            page2.evaluate("ZamWeeklyReport.preparePrint()")
            full_pdf = page2.pdf(format="A4", print_background=True)
            if not full_pdf.startswith(b"%PDF"):
                failures.append("The full 25-day / 35-branch scenario did not produce a valid PDF")
            elif not shutil.which("pdftotext") or not shutil.which("pdfinfo"):
                failures.append("pdftotext and pdfinfo are required to verify the full synthetic sales PDF")
            else:
                with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf_file:
                    pdf_file.write(full_pdf)
                    pdf_file.flush()
                    full_text = subprocess.run(
                        ["pdftotext", "-layout", pdf_file.name, "-"],
                        check=True,
                        capture_output=True,
                        text=True,
                    ).stdout
                    info = subprocess.run(["pdfinfo", pdf_file.name], check=True, capture_output=True, text=True).stdout
                full_text = re.sub(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]", "", full_text)
                flat_text = re.sub(r"\s+", " ", full_text)
                page_count_match = re.search(r"^Pages:\s+(\d+)", info, re.M)
                page_count = int(page_count_match.group(1)) if page_count_match else 0
                def numeric_text(value: str | None) -> str:
                    match = re.search(r"\d[\d,]*(?:\.\d+)?%?", value or "")
                    return match.group(0) if match else ""
                if expected["counts"] != {"trend": 25, "chartBranches": 35, "tableBranches": 35}:
                    failures.append("Unexpected live DOM row counts in full print fixture: " + repr(expected["counts"]))
                missing_trend = [row for row in expected["trend"] if not row["date"] or row["date"] not in flat_text or not row["value"] or row["value"] not in flat_text]
                if missing_trend:
                    failures.append("PDF is missing one or more daily sales trend dates/values: " + repr(missing_trend))
                missing_branch_names = [row["name"] for row in expected["tableBranches"] if not row["name"] or flat_text.count(row["name"]) < 2]
                missing_branch_sales = [row for row in expected["tableBranches"] if not numeric_text(row["sales"]) or flat_text.count(numeric_text(row["sales"])) < 2]
                if missing_branch_names:
                    failures.append("PDF does not show every branch in both the chart and table: " + repr(missing_branch_names))
                if missing_branch_sales:
                    failures.append("PDF does not show every branch sales value in both the chart and table: " + repr(missing_branch_sales))
                missing_other_values = [
                    {"branch": row["name"], "value": value}
                    for row in expected["tableBranches"] for value in row["otherValues"]
                    if value and value != "—" and numeric_text(value) not in flat_text
                ]
                if missing_other_values:
                    failures.append("PDF omits one or more current branch-table values: " + repr(missing_other_values[:10]))
                if "فرع مخطط لا يظهر" in flat_text or "99,999,999" in flat_text:
                    failures.append("Planned-branch sales leaked into the full sales print fixture")
                if page_count < 5:
                    failures.append(f"Expected multi-page full sales print, found {page_count} pages")
                print(f"FULL SALES PRINT: synthetic {start}..{end_date}; trend={len(expected['trend'])}/25; branches={len(expected['chartBranches'])}/35 chart + {len(expected['tableBranches'])}/35 table; all trend dates/current totals present={not missing_trend}; all branch labels/sales repeated in chart and table={not missing_branch_names and not missing_branch_sales}; other table values present={not missing_other_values}; planned branch excluded={'فرع مخطط لا يظهر' not in flat_text}; PDF pages={page_count}")
            full_audit = page2.evaluate("window.__zamMockAudit")
            if full_audit["writes"]:
                failures.append("The full sales print fixture attempted a database write: " + repr(full_audit["writes"]))
            page2.close()

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
