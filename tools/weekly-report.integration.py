#!/usr/bin/env python3
"""Local browser integration test for weekly-report/index.html.

Run: python3 tools/weekly-report.integration.py
No real Supabase, outbound HTTP, or data mutations are permitted. The fixture
uses schema-backed synthetic rows. The first browser pass intentionally records
whether the known pre-fix complianceByTemplate shadowing TypeError reproduces;
the second pass is the regression suite and must pass once fixed.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import http.server
import json
import os
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def fixture(today: dt.date) -> dict[str, list[dict]]:
    # Use this week's Saturday-through-Friday to make period selection stable.
    start = today - dt.timedelta(days=(today.weekday() + 2) % 7)
    d1 = start + dt.timedelta(days=1)
    d2 = start + dt.timedelta(days=2)
    prev = start - dt.timedelta(days=1)
    b1, b2 = "10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"
    r1, r2, r3 = "20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"
    return {
        "branches": [
            {"id": b1, "name": "زام الرئيسي", "created_at": "2025-01-01T00:00:00Z", "lifecycle_status": "operational"},
            {"id": b2, "name": "زام البلد", "created_at": "2025-01-01T00:00:00Z", "lifecycle_status": "operational"},
            {"id": "10000000-0000-4000-8000-000000000003", "name": "زام المخطط", "created_at": "2025-01-01T00:00:00Z", "lifecycle_status": "planned", "planned_opening_date": (d1 + dt.timedelta(days=2)).isoformat()},
        ],
        "daily_reports": [
            {"id": r1, "branch_id": b1, "report_date": d1.isoformat(), "shift_type": "Morning", "supervisor_name": "مشرف اختبار", "total_sales": 1250, "orders_count": 50, "avg_ticket": 25, "team_status": "كامل", "positive_reviews": 3, "custom_fields": {}, "sheet_key": "synthetic-current-a"},
            {"id": r2, "branch_id": b2, "report_date": d2.isoformat(), "shift_type": "Evening", "supervisor_name": "مشرف اختبار", "total_sales": 750, "orders_count": 30, "avg_ticket": 25, "team_status": "نقص", "positive_reviews": 1, "custom_fields": {}, "sheet_key": "synthetic-current-b"},
            {"id": r3, "branch_id": b1, "report_date": prev.isoformat(), "shift_type": "Morning", "supervisor_name": "مشرف اختبار", "total_sales": 600, "orders_count": 24, "avg_ticket": 25, "team_status": "كامل", "positive_reviews": 1, "custom_fields": {}, "sheet_key": "synthetic-prior"},
        ],
        "waste_logs": [
            {"id": "waste-fixture-1", "report_id": r1, "item_name": "حليب", "quantity": 2, "unit": "لتر", "reason": "انتهاء صلاحية", "root_cause": "تخزين", "corrective_action": "مراجعة يومية", "owner": "مدير الفرع", "unit_cost": 8},
            {"id": "waste-fixture-2", "report_id": r2, "item_name": "قهوة", "quantity": 1, "unit": "كجم", "reason": "خطأ تحضير", "root_cause": "تدريب", "corrective_action": "إعادة تدريب", "owner": "مشرف", "unit_cost": 40},
        ],
        "shift_issues": [{"id": "issue-fixture-1", "report_id": r2, "description": "نقص موظف في الوردية المسائية", "action_taken": "استدعاء بديل", "priority": "عالية", "issue_type": "موظف"}],
        "negative_reviews": [{"id": "complaint-fixture-1", "report_id": r1, "comment_text": "تأخر الطلب", "review_type": "negative", "status": "معلقة", "owner": "مدير الفرع", "action_taken": "متابعة العميل", "customer_rating": 2}],
        "supervisory_visits": [
            {"id": "visit-fixture-1", "visit_date": d1.isoformat(), "branch_id": b1, "shift_type": "Morning", "visitor_name": "مدير الاختبار", "score_percentage": 70, "checklist_total": 1, "checklist_done": 0, "observation": "بند يحتاج متابعة", "corrective_action": "تصحيح الإجراء", "owner": "مدير الفرع", "due_date": today.isoformat(), "status": "مفتوحة"},
            {"id": "visit-planned-fixture", "visit_date": d1.isoformat(), "branch_id": "10000000-0000-4000-8000-000000000003", "shift_type": "Morning", "visitor_name": "زيارة قبل الافتتاح", "score_percentage": 10, "checklist_total": 1, "checklist_done": 0, "observation": "يجب استبعادها", "status": "مفتوحة"},
        ],
        "weekly_plans": [], "weekly_report_notes": [], "weekly_reports": [],
        "checklist_templates": [
            {"id": f"template-fixture-{i+1}", "task_title": f"مهمة تركيبية غير مكتملة {i+1}", "category": "الصالة", "shift_type": "Both", "branch_id": None, "requires_photo": False, "frequency": "daily", "day_of_week": None, "days_of_week": [], "day_of_month": None, "is_active": True, "checklist_template_branches": []}
            for i in range(8)
        ],
        "checklist_logs": [{"id": "log-fixture-1", "template_id": "template-fixture-1", "branch_id": b1, "execution_date": d1.isoformat(), "status": "Completed", "shift_type": "Morning"}],
        "supervisory_visit_notes": [],
        "supervisory_visit_results": [{"id": "visit-result-fixture-1", "visit_id": "visit-fixture-1", "item_id": "visit-template-fixture-1", "score": 2, "result": "غير مطابق", "note": "ملاحظة اختبار", "is_violation": True}],
        "visit_action_items": [{"id": "visit-action-fixture-1", "visit_id": "visit-fixture-1", "result_id": "visit-result-fixture-1", "branch_id": b1, "title": "إجراء تصحيحي اختباري", "description": "معالجة البند", "item_type": "corrective", "priority": "عالية", "assigned_role": "مدير", "shift_type": "Morning", "due_date": today.isoformat(), "status": "مفتوحة", "created_at": today.isoformat() + "T09:00:00Z"}],
        "visit_checklist_templates": [{"id": "visit-template-fixture-1", "title": "نظافة الطاولة", "category": "الصالة", "sort_order": 1}],
        "profiles": [], "technical_issues": [],
    }


INIT_JS = r"""
(() => {
  const rows = __FIXTURE__;
  const writes = [];
  window.__zamMockAudit = { writes, external: [], reads: [] };
  const denied = name => { writes.push(name); throw new Error('FORBIDDEN_WRITE:' + name); };
  window.supabase = {
    from(table) {
      return {
        select(columns) {
          window.__zamMockAudit.reads.push({table, columns});
          const query = {
            order() { return this; }, eq() { return this; }, limit() { return this; }, range(from, to) {
              const list = rows[table] || [];
              return Promise.resolve({data: list.slice(from, to + 1), error: null});
            },
            then(resolve, reject) { return Promise.resolve({data: rows[table] || [], error: null}).then(resolve, reject); },
            insert() { return denied(table + '.insert'); }, update() { return denied(table + '.update'); },
            upsert() { return denied(table + '.upsert'); }, delete() { return denied(table + '.delete'); }
          };
          return query;
        },
        insert() { return denied(table + '.insert'); }, update() { return denied(table + '.update'); },
        upsert() { return denied(table + '.upsert'); }, delete() { return denied(table + '.delete'); }
      };
    },
    channel() { return { on() { return this; }, subscribe(callback) { if (callback) callback('SUBSCRIBED'); return this; } }; },
    removeChannel() { return Promise.resolve('ok'); },
    createClient() { return this; }
  };
  sessionStorage.setItem('zam_session_profile', JSON.stringify({id:'30000000-0000-4000-8000-000000000001', role:'Owner', full_name:'مالك اختبار', email:'test@example.invalid'}));
})();
"""


@contextlib.contextmanager
def local_server():
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)
        def log_message(self, *_args):
            pass
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()


def main() -> int:
    data = fixture(dt.date.today())
    failures: list[str] = []
    with local_server() as port, sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM", "/usr/bin/chromium"))
        errors: list[str] = []
        buggy_source = (ROOT / "assets/weekly-report-core.js").read_text(encoding="utf-8")
        fn_start = buggy_source.index("function complianceByTemplate(")
        fn_end = buggy_source.index("\n  /**\n   * بطاقة التزام مستقلة", fn_start)
        fn = buggy_source[fn_start:fn_end]
        fn = fn.replace("var selectedBranches =", "var branchesForPeriod =").replace("selectedBranches", "branchesForPeriod")
        buggy_source = buggy_source[:fn_start] + fn + buggy_source[fn_end:]
        def network_guard(route, reproduce_bug=False):
            request_url = route.request.url
            if reproduce_bug and "/assets/weekly-report-core.js" in request_url:
                route.fulfill(status=200, content_type="application/javascript", body=buggy_source)
            elif request_is_local(request_url, port):
                route.continue_()
            elif "@supabase/supabase-js" in request_url:
                # The page's vendor script normally replaces window.supabase;
                # the test injects the deterministic local mock before scripts.
                route.fulfill(status=200, content_type="application/javascript", body="/* offline Supabase stub; mock is in add_init_script */")
            else:
                route.abort()
        url = f"http://127.0.0.1:{port}/weekly-report/index.html"
        init_script = INIT_JS.replace("__FIXTURE__", json.dumps(data, ensure_ascii=False))
        print("TEST FIXTURE: synthetic schema-backed rows only; browser network limited to local server; writes forbidden")
        print("BASELINE REPRODUCTION: replaying pre-fix local-variable shadowing with active checklist_templates")
        page = browser.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: network_guard(route, reproduce_bug=True))
        page.add_init_script(init_script)
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(900)
        matched = next((e for e in errors if "branchesForPeriod is not a function" in e), None)
        if matched:
            print("BASELINE EXPECTED FAILURE reproduced: " + matched)
        else:
            print("BASELINE EXPECTED FAILURE not observed: " + json.dumps(errors, ensure_ascii=False))
            failures.append("Expected pre-fix TypeError was not reproduced")

        # Verify absence of side effects in the baseline replay.
        audit = page.evaluate("window.__zamMockAudit")
        if audit["writes"]:
            failures.append("Mock observed forbidden writes: " + repr(audit["writes"]))
        if not any(x.get("table") == "checklist_templates" for x in audit["reads"]):
            failures.append("Active checklist_templates fixture was not queried")
        if errors and not matched:
            failures.append("Unexpected browser exception(s): " + " | ".join(errors))
        if not matched:
            failures.append("Pre-fix shadowing replay did not raise the expected TypeError")
        page.close()
        # Run the regression suite against the actual, current local source.
        errors.clear()
        page = browser.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: network_guard(route, reproduce_bug=False))
        page.add_init_script(init_script)
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(900)
        if any("branchesForPeriod is not a function" in e for e in errors):
            failures.append("Current source still raises the branchesForPeriod shadowing TypeError")
        run_regressions(page, failures, errors)
        page.close()
        # A malformed source row must surface a diagnostic instead of looking like an empty database.
        broken_data = fixture(dt.date.today())
        broken_data["branches"][0]["name"] = None
        broken_page = browser.new_page()
        broken_page.route("**/*", lambda route: network_guard(route, reproduce_bug=False))
        broken_page.add_init_script(INIT_JS.replace("__FIXTURE__", json.dumps(broken_data, ensure_ascii=False)))
        broken_page.goto(url, wait_until="domcontentloaded")
        broken_page.wait_for_timeout(900)
        if "تعذّر تحميل بيانات التقرير" not in broken_page.locator("#kpis").inner_text():
            failures.append("A transformation failure was not disclosed in the KPI area")
        if "CLIENT_ERROR" not in (broken_page.locator("#diagPanel").text_content() or ""):
            failures.append("A transformation failure was silently hidden from diagnostics")
        if broken_page.evaluate("window.__zamMockAudit.writes"): failures.append("Unexpected write on failure path")
        broken_page.close()
        browser.close()
    if failures:
        for item in failures:
            print("FAIL: " + item)
        return 1
    print("PASS: weekly report browser integration assertions passed; no writes or external requests")
    return 0


def request_is_local(url: str, port: int) -> bool:
    return url.startswith(f"http://127.0.0.1:{port}/") or url.startswith(f"http://localhost:{port}/")


def run_regressions(page, failures: list[str], errors: list[str]) -> None:
    try:
        page.wait_for_function("document.querySelectorAll('#weekly-tab-1').length === 1", timeout=5000)
        # KPI labels and values use the current semantic card/value classes.
        kpis = page.locator("#kpis").inner_text()
        for label in ("إجمالي المبيعات", "عدد الشكاوى", "سجلات الهدر", "الزيارات الإشرافية", "بلاغات نقص الكادر"):
            if label not in kpis: failures.append("Missing KPI: " + label)
        for label, expected in (("إجمالي المبيعات", "2,000 ر.س"), ("عدد الشكاوى", "1"), ("سجلات الهدر", "2 سجل"),
                                ("الزيارات الإشرافية", "1"), ("بلاغات نقص الكادر", "1")):
            card = page.locator("#kpis .weekly-kpi-card").filter(has_text=label)
            if card.count() != 1 or card.locator(".weekly-kpi-value").inner_text().strip() != expected:
                failures.append(f"Unexpected KPI value for {label}: expected {expected}")
        # Branch and shift slicers can be independently selected.
        if page.locator("#branchChips button").count() < 2: failures.append("Branch slicer did not render both synthetic branches")
        if page.locator("#shiftChips button").count() < 2: failures.append("Shift slicer did not render morning/evening choices")
        page.locator("#shiftChips button").filter(has_text="مسائي").click()
        page.wait_for_timeout(250)
        if "750 ر.س" not in page.locator("#kpis").inner_text(): failures.append("Evening shift selection did not scope sales KPI")
        page.locator("#weekly-tab-2").click()
        if "نقص موظف في الوردية المسائية" not in page.locator("#panes").inner_text():
            failures.append("Evening shift issue disappeared: report issue rows must carry parent report shiftType")
        page.locator('#shiftChips button[data-shift="all"]').click()
        # All branches start selected, so toggling branch one off isolates branch two.
        page.locator('#branchChips button[data-b="10000000-0000-4000-8000-000000000001"]').click()
        page.wait_for_timeout(250)
        if "750 ر.س" not in page.locator("#kpis").inner_text(): failures.append("Branch selection did not scope sales KPI")
        page.locator("#allBranches").click()
        page.wait_for_timeout(150)
        # Open all six actual tabs. Tab 2 summarizes visits, open actions, notes and shift issues.
        for tab in range(1, 7):
            button = page.locator(f"#weekly-tab-{tab}")
            button.click()
            if button.get_attribute("aria-selected") != "true": failures.append(f"Tab {tab} did not become active")
            if not page.locator("#panes").inner_text().strip(): failures.append(f"Tab {tab} rendered an empty pane")
            if tab == 2:
                content = page.locator("#panes").inner_text()
                for text in ("ملخص الزيارات الإشرافية", "التكليفات المفتوحة / المخالفات", "إجراء تصحيحي اختباري", "ملاحظة بند نظافة الطاولة: ملاحظة اختبار", "نقص موظف في الوردية المسائية"):
                    if text not in content: failures.append("Missing visit/shift issue evidence: " + text)
                if "زيارة قبل الافتتاح" in content or "يجب استبعادها" in content:
                    failures.append("A supervisory visit for a planned branch before its opening date was included")
                task_count = page.locator("#panes .check-row").count()
                if task_count or page.locator("#panes #paneChecks").count():
                    failures.append("The current weekly-report contract must not add a separate incomplete-task list")
                visit_row = page.locator("#panes tr").filter(has_text="مدير الاختبار").first
                visit_links = visit_row.locator("a[href]").evaluate_all("els => els.map(a => a.getAttribute('href'))") if visit_row.count() else []
                if not any("supervisor-dashboard" in str(href) for href in visit_links):
                    failures.append("Missing supervisor branch dashboard link adjacent to the visit row")
                if "إجراء تصحيحي اختباري" not in content: failures.append("Visit action not surfaced in supervisor report")
            if tab == 3 and "تأخر الطلب" not in page.locator("#panes").inner_text():
                failures.append("Synthetic complaint did not render")
            if tab == 4:
                content = page.locator("#panes").inner_text()
                for text in ("حليب", "قهوة", "انتهاء صلاحية", "خطأ تحضير", "2 لتر", "1 كجم"):
                    if text not in content: failures.append("Missing waste evidence: " + text)
            if tab == 5 and "نقص موظف في الوردية المسائية" not in page.locator("#panes").inner_text():
                failures.append("Synthetic shift issue did not render in the team pane")
        audit = page.evaluate("window.__zamMockAudit")
        if audit["writes"]: failures.append("Forbidden writes attempted: " + repr(audit["writes"]))
    except Exception as exc:
        failures.append("Post-fix browser regression assertions could not complete: " + str(exc))
    if errors:
        failures.append("Browser errors: " + " | ".join(errors))


if __name__ == "__main__":
    raise SystemExit(main())
