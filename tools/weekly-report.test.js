const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const metrics = require('../assets/weekly-report-metrics.js');

function testScheduleRules() {
  assert.equal(metrics.normalizeShift('Both'), 'All');
  assert.equal(metrics.normalizeShift('مسائي'), 'Evening');
  assert.equal(metrics.normalizeShift('Morning'), 'Morning');
  assert.equal(metrics.isTaskScheduled({ frequency: 'weekly', day_of_week: 1 }, '2026-01-19'), true);
  assert.equal(metrics.isTaskScheduled({ frequency: 'weekly', day_of_week: 2 }, '2026-01-19'), false);
  assert.equal(metrics.isTaskScheduled({ frequency: 'monthly', day_of_month: 31 }, '2026-02-28'), true);
  assert.equal(metrics.isTaskScheduled({ frequency: 'monthly', day_of_month: 31 }, '2026-02-27'), false);
}

function testComplianceByActualShiftSessions() {
  const templates = [
    { id: 1, task_title: 'صباح يومي', frequency: 'daily', shift_type: 'Morning', is_active: true },
    { id: 2, task_title: 'مساء يومي', frequency: 'daily', shift_type: 'Evening', is_active: true },
    { id: 3, task_title: 'مهمة Both', frequency: 'daily', shift_type: 'Both', is_active: true },
    { id: 4, task_title: 'أسبوعي الاثنين', frequency: 'weekly', day_of_week: 1, shift_type: 'Both', is_active: true },
    { id: 5, task_title: 'شهري 31', frequency: 'monthly', day_of_month: 31, shift_type: 'Morning', is_active: true },
    { id: 6, task_title: 'ساعي مستبعد', frequency: 'hourly', shift_type: 'Both', is_active: true },
    { id: 7, task_title: 'غير نشط', frequency: 'daily', shift_type: 'Both', is_active: false }
  ];
  const sessions = [
    { date: '2026-01-19', branch: 'b1', shift: 'Morning' },
    { date: '2026-01-19', branch: 'b1', shift: 'Evening' },
    { date: '2026-01-20', branch: 'b1', shift: 'Morning' },
    { date: '2026-01-19', branch: 'b2', shift: 'Morning' }
  ];
  const logs = [
    { template_id: 1, execution_date: '2026-01-19', branch_id: 'b1', shift_type: 'Morning', status: 'completed' },
    { template_id: 1, execution_date: '2026-01-19', branch_id: 'b1', shift_type: 'Morning', status: 'flagged' },
    { template_id: 2, execution_date: '2026-01-19', branch_id: 'b1', shift_type: 'Morning', status: 'completed' }, // wrong shift: ignored
    { template_id: 3, execution_date: '2026-01-19', branch_id: 'b1', shift_type: 'Morning', status: 'done' },
    { template_id: 3, execution_date: '2026-01-20', branch_id: 'b1', status: 'completed' }, // Both without explicit shift: not attributed
    { template_id: 4, execution_date: '2026-01-19', branch_id: 'b1', shift_type: 'Evening', status: 'flagged' },
    { template_id: 4, execution_date: '2026-01-20', branch_id: 'b1', shift_type: 'Morning', status: 'completed' } // weekly task not scheduled Tuesday
  ];
  const result = metrics.calculateCompliance(templates, sessions, logs, { branches: ['b1'], shiftFilter: 'all' });
  assert.equal(result.hourlyExcluded, 1, 'hourly templates must be disclosed rather than guessed');
  assert.equal(result.stats.reduce((n, x) => n + x.total, 0), 8, 'Both tasks should be due separately in morning/evening sessions');
  assert.equal(result.stats.reduce((n, x) => n + x.done, 0), 2, 'duplicate and wrong-shift logs must not inflate completion');
  assert.equal(result.stats.reduce((n, x) => n + x.flagged, 0), 1);
  assert.equal(result.stats.reduce((n, x) => n + x.pending, 0), 6);
  assert.equal(result.stats.some(x => x.title === 'شهري 31'), false, 'monthly task is not due in January on days 19/20');

  const evening = metrics.calculateCompliance(templates, sessions, logs, { branches: ['b1'], shiftFilter: 'Evening' });
  assert.equal(evening.stats.reduce((n, x) => n + x.total, 0), 3);
  assert.equal(evening.stats.reduce((n, x) => n + x.done, 0), 0);
  assert.equal(evening.stats.reduce((n, x) => n + x.flagged, 0), 1);
}

function testTopIncompleteCap() {
  const stats = Array.from({ length: 9 }, (_, i) => ({ title: `مهمة ${i}`, total: 10, done: i, pending: 10 - i }));
  assert.equal(metrics.topIncomplete(stats, 5).length, 5);
  assert.equal(metrics.topIncomplete(stats, 50).length, 5, 'limit must never exceed five');
  assert.equal(metrics.topIncomplete(stats, 3)[0].pending, 10);
  assert.equal(metrics.topIncomplete([{ title: 'مكتمل', pending: 0 }], 5).length, 0);
}

function testAppsScriptMappingsWithoutNetwork() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script-supabase-sync.js'), 'utf8');
  const context = { console, Logger: { log() {} }, Utilities: { formatDate() { return '2026-11-16'; } }, Session: { getScriptTimeZone() { return 'Asia/Riyadh'; } } };
  vm.runInNewContext(source, context, { filename: 'apps-script-supabase-sync.js' });
  const report = context.toReportRow({
    __row: 2, 'التاريخ': '2026-11-16', 'الفرع': 'الفرع الرئسي', 'الشفت': 'مسائي',
    'إجمالي المبيعات': '100.5', 'عدد الطلبات': '3', 'المسؤول': 'مشرف'
  }, { 'زام الرئيسي': 'branch-main' });
  assert.ok(report, 'report row should map known branch typo');
  assert.equal(report.row.branch_id, 'branch-main');
  assert.equal(report.row.shift_type, 'Evening', 'current sheet header is الشفت');
  assert.equal(report.row.total_sales, 100.5);

  const issue = context.toIssueRow({
    __row: 3, 'نوع المشكلة': 'تقنية', 'الوصف': 'عطل جهاز', 'الإجراء المتخذ': 'تم الإصلاح', 'الأولوية': 'عالية'
  });
  assert.equal(issue.type, 'تقنية');
  assert.equal(issue.action_taken, 'تم الإصلاح');
  assert.equal(issue.description, 'عطل جهاز');
}

function testReportWiringAndPrintSafety() {
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'weekly-report', 'index.html'), 'utf8');
  assert.match(core, /METRICS\.topIncomplete\(tpl, 5\)/);
  assert.match(core, /غير مكتمل '\+pending/);
  assert.match(core, /comp\.hourlyExcluded/);
  assert.match(core, /var visits = filterRows\(SRC\.visits, r, true, true\)/, 'visit KPIs and the report must honor the selected shift');
  assert.match(core, /el\.textContent = String\(v\)/, 'restored note values must be text, not HTML');
  assert.doesNotMatch(core, /stockImpact|أثر نفاد المنتجات على التشغيل/);
  assert.match(core, /لا يتضمن قياس نفاد المنتجات أو تقدير المبيعات الفائتة/);
  assert.match(core, /var PANES = \{ 1: pane1, 2: pane2, 3: pane3, 4: pane4, 5: pane5, 6: pane6 \}/);
  const metricsIndex = html.indexOf('weekly-report-metrics.js');
  const coreIndex = html.indexOf('weekly-report-core.js');
  assert.ok(metricsIndex >= 0 && coreIndex > metricsIndex, 'metrics script must load before core');
  assert.match(html, /#overviewCharts, #overviewBranchCharts, #dashboardNotes, #snapshotsSection/);
  assert.doesNotMatch(html, /#overviewKpis[^}]*display:none/);
  assert.match(html, /\.plan-save \{ display:none !important; \}/);
  assert.match(core, /container\.classList\.toggle\('print-edit-empty'/);
  assert.match(html, /\.print-edit-empty \{ display:none !important; \}/);
  assert.match(core, /complaint-log-table/);
  assert.match(html, /\.complaint-log-table th, \.complaint-log-table td/);
  assert.match(core, /waste-log-table/);
  assert.match(core, /سجلات الهدر بالتفصيل/);
  assert.match(html, /\.waste-log-table th, \.waste-log-table td/);
  assert.match(html, /\.print-pane \.grid\[class\*="md:grid-cols-4"\]/);
  assert.match(html, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
}

function testSalesTableMobileAndPrint() {
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'weekly-report', 'index.html'), 'utf8');
  const tableStart = core.indexOf('sales-table">');
  const tableEnd = core.indexOf('</table></div>', tableStart);
  assert.ok(tableStart >= 0 && tableEnd > tableStart, 'branch sales table markup should be present');
  const tableMarkup = core.slice(tableStart, tableEnd);
  assert.equal((tableMarkup.match(/<th\b/g) || []).length, 6, 'branch sales table should use six readable columns');
  assert.match(core, /compareLine\(b\.salesPerShift, pb\.salesPerShift/);
  assert.match(tableMarkup, /colspan="6"/);
  assert.match(core, /متوسط اليوم المسجل/);
  assert.match(core, /mobile-table-hint no-print/);
  assert.match(core, /role="region" tabindex="0" aria-label="جدول أداء الفروع/);
  assert.match(html, /#panes \.sales-table \{ min-width:720px; \}/);
  assert.match(html, /#panes \.sales-table \{ min-width:560px; \}/);
  assert.match(html, /\.sales-table \{ table-layout:fixed !important; width:100% !important; min-width:0 !important; font-size:8pt !important; \}/);
  assert.match(html, /\.sales-table th:nth-child\(6\)/);
}

function testVisitWiringFiltersAndTableShape() {
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  assert.match(core, /q\('supervisory_visit_results', '\*'\)/);
  assert.match(core, /q\('visit_action_items', '\*'\)/);
  assert.match(core, /visitResults: visitResults\.map/);
  assert.match(core, /visitActions: visitActions\.map/);
  assert.match(core, /var visits = filterRows\(SRC\.visits, r, true, true\)/);
  assert.match(core, /visitResults = \(SRC\.visitResults \|\| \[\]\)\.filter\(function \(row\) \{ return !!visitById\[String\(row\.visitId\)\]; \}\)/);
  assert.match(core, /visitActions = \(SRC\.visitActions \|\| \[\]\)\.filter\(function \(row\) \{ return !!visitById\[String\(row\.visitId\)\]; \}\)/);
  assert.match(core, /METRICS\.topIncomplete\(tpl, 5\)/);

  const headerStart = core.indexOf('نتائج الزيارات الإشرافية');
  const headerEnd = core.indexOf('تفاصيل بنود الزيارات التي تحتاج متابعة', headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart, 'visit table markup should be present');
  const headerMarkup = core.slice(headerStart, headerEnd);
  assert.equal((headerMarkup.match(/<th\b/g) || []).length, 10, 'visit table must have ten headers including shift');
  assert.match(headerMarkup, /colspan="10"/);
  const rowsStart = core.indexOf('var visitRows');
  const rowsEnd = core.indexOf('var visitById', rowsStart);
  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart, 'visit row templates should be present');
  const rowMarkup = core.slice(rowsStart, rowsEnd);
  assert.equal((rowMarkup.match(/<td class=/g) || []).length, 20, 'both visit row variants must match the ten-column header');
  assert.match(rowMarkup, /v\.score != null \? v\.score \+ '%' : '—'/, 'a legitimate zero score should print as 0%');
  const detailStart = core.indexOf('var attentionRows = attentionResults.slice(0, 60)');
  assert.ok(detailStart >= 0, 'visit follow-up details should be included');
  const detailEnd = core.indexOf('function isActionClosed', detailStart);
  const detailMarkup = core.slice(detailStart, detailEnd);
  assert.match(detailMarkup, /row\.score != null/);
  assert.match(detailMarkup, /row\.violation/);
  assert.match(detailMarkup, /row\.title/);
  assert.match(core, /completed\|complete\|done\|resolved/);
}

function testPrintPeriodAndAccessibleSixTabs() {
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'weekly-report', 'index.html'), 'utf8');
  assert.match(core, /printRange\.textContent = r\.from \+ ' ← ' \+ r\.to/);
  assert.match(core, /for \(var tab = 1; tab <= 6; tab\+\+\)/);
  assert.match(core, /role="tab" aria-label=/);
  assert.match(core, /aria-selected="' \+ active/);
  assert.match(core, /aria-controls="panes"/);
  assert.match(core, /event\.key === 'ArrowLeft'/);
  assert.match(core, /event\.key === 'ArrowRight'/);
  assert.match(core, /event\.key === 'Home'/);
  assert.match(core, /event\.key === 'End'/);
  assert.match(core, /if \(focusTarget\) focusTarget\.focus\(\)/);
  assert.match(core, /aria-labelledby', 'weekly-tab-' \+ state\.tab/);
  assert.match(core, /function renderSectionContext\(\)/);
  assert.match(core, /function selectTab\(tab, focusTab\)/);
  assert.match(core, /pane-footer-nav no-print/);
  assert.match(core, /aria-valuenow="' \+ \(index \+ 1\)/);
  assert.match(core, /data-branch="' \+ esc\(b\.id\) \+ '" aria-expanded=/, 'branch drill-down must be keyboard-focusable button');
  assert.match(html, /id="tabs" role="tablist" aria-label="محاور التقرير الأسبوعي"/);
  assert.match(html, /id="sectionContext" class="section-context no-print/);
  assert.match(html, /id="panes" role="tabpanel" tabindex="0"/);
  assert.match(html, /\.tabbtn:focus-visible/);
  assert.match(html, /id="zam-design-system"/);
  assert.match(html, /class="zam-page bg-background/);
}

testScheduleRules();
testComplianceByActualShiftSessions();
testTopIncompleteCap();
testAppsScriptMappingsWithoutNetwork();
testReportWiringAndPrintSafety();
testSalesTableMobileAndPrint();
testVisitWiringFiltersAndTableShape();
testPrintPeriodAndAccessibleSixTabs();
console.log('weekly-report tests: all checks passed');
