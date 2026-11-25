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
  const multiDay = { frequency: 'weekly', days_of_week: [1, 3], day_of_week: 6 };
  assert.equal(metrics.isTaskScheduled(multiDay, '2026-01-19'), true, 'Monday is included in the array');
  assert.equal(metrics.isTaskScheduled(multiDay, '2026-01-21'), true, 'Wednesday is included in the array');
  assert.equal(metrics.isTaskScheduled(multiDay, '2026-01-24'), false, 'the legacy Saturday value does not override a non-empty array');
  assert.equal(metrics.isTaskScheduled({ frequency: 'weekly', days_of_week: [], day_of_week: 3 }, '2026-01-21'), true, 'empty arrays fall back to legacy data');
  assert.equal(metrics.isTaskScheduled({ frequency: 'monthly', day_of_month: 31 }, '2026-02-28'), true);
  assert.equal(metrics.isTaskScheduled({ frequency: 'monthly', day_of_month: 31 }, '2026-02-27'), false);
}

function testCalendarSessionsWithoutReportsAndFilters() {
  const range = { from: '2026-01-19', to: '2026-01-20' };
  const branches = [
    { id: 'b1', created_at: '2026-01-19T00:00:00Z' },
    { id: 'b2', created_at: '2026-01-19T00:00:00Z' },
  ];
  const all = metrics.expectedSessions(range, branches, { today: '2026-01-20', shiftFilter: 'Both' });
  assert.equal(all.sessions.length, 8, 'expected sessions come from branch calendar even when no shift report exists');
  assert.equal(all.sessions.filter(s => s.branch === 'b1' && s.date === '2026-01-19').length, 2, 'Both creates distinct morning and evening sessions');

  const filtered = metrics.expectedSessions(range, branches, {
    today: '2026-01-20', shiftFilter: 'Evening', branchFilter: 'b2',
  });
  assert.deepEqual(filtered.sessions, [
    { date: '2026-01-19', branch: 'b2', shift: 'Evening' },
    { date: '2026-01-20', branch: 'b2', shift: 'Evening' },
  ], 'branch and shift filters must scope expected sessions');

  const missingCreatedAt = metrics.expectedSessions(range, [{ id: 'b3' }], { today: '2026-01-20', shiftFilter: 'All' });
  const coverage = metrics.calculateCompliance(
    [{ id: 'global', shift_type: 'Both', frequency: 'daily' }], missingCreatedAt.sessions, [],
    { unknownBranchIds: missingCreatedAt.unknownBranches }
  );
  assert.equal(coverage.coverageIncomplete, true, 'unknown branch start dates must make coverage explicitly incomplete');
  assert.equal(coverage.pct, null, 'do not publish a total ratio when coverage is incomplete');
  assert.ok(coverage.reasons.includes('branch_creation_date_missing'));
}

function testComplianceByActualShiftSessions() {
  const templates = [
    { id: 1, task_title: 'صباح يومي', frequency: 'daily', shift_type: 'Morning', is_active: true },
    { id: 2, task_title: 'مساء يومي', frequency: 'daily', shift_type: 'Evening', is_active: true },
    { id: 3, task_title: 'مهمة Both', frequency: 'daily', shift_type: 'Both', is_active: true },
    { id: 4, task_title: 'أسبوعي الاثنين والأربعاء', frequency: 'weekly', days_of_week: [1, 3], day_of_week: 1, shift_type: 'Both', is_active: true },
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
  assert.equal(result.coverageIncomplete, true, 'hourly templates make the total compliance coverage incomplete');
  assert.equal(result.pct, null, 'the non-hourly ratio must not be presented as an overall percentage');
  assert.equal(result.nonHourlyPct, 25, 'the available non-hourly segment remains measurable');
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

function testWeeklyComplianceHonorsMultiBranchScopes() {
  const linked = {
    id: 'linked-template', branch_id: 'branch-a',
    checklist_template_branches: [{ branch_id: 'branch-a' }, { branch_id: 'branch-b' }],
    frequency: 'daily', shift_type: 'Morning', is_active: true,
  };
  const sessions = [
    { date: '2026-11-16', branch: 'branch-a', shift: 'Morning' },
    { date: '2026-11-16', branch: 'branch-b', shift: 'Morning' },
    { date: '2026-11-16', branch: 'branch-c', shift: 'Morning' },
  ];
  const all = metrics.calculateCompliance([linked], sessions, [], { branches: ['branch-a', 'branch-b', 'branch-c'] });
  assert.equal(all.stats.reduce((n, item) => n + item.total, 0), 2, 'linked branch scopes override the legacy branch_id');
  const branchB = metrics.calculateCompliance([linked], sessions, [], { branchFilter: 'branch-b', branches: ['branch-b'] });
  assert.equal(branchB.stats.reduce((n, item) => n + item.total, 0), 1);
  const branchC = metrics.calculateCompliance([linked], sessions, [], { branchFilter: 'branch-c', branches: ['branch-c'] });
  assert.equal(branchC.stats.reduce((n, item) => n + item.total, 0), 0, 'unlinked branches do not inherit a multi-branch template');

  const legacy = metrics.calculateCompliance([{ ...linked, checklist_template_branches: [] }], sessions, [], { branches: ['branch-a', 'branch-b', 'branch-c'] });
  assert.equal(legacy.stats.reduce((n, item) => n + item.total, 0), 1, 'legacy single-branch templates retain branch_id behavior');
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
  const pane2Start = core.indexOf('function pane2()');
  const pane2End = core.indexOf('/* ───────── محور 3 ───────── */', pane2Start);
  assert.ok(pane2Start >= 0 && pane2End > pane2Start, 'operational control pane should be present');
  const pane2 = core.slice(pane2Start, pane2End);
  assert.doesNotMatch(pane2, /topIncomplete|المهام غير المكتملة|غير مكتمل/);
  assert.match(pane2, /الزيارات الإشرافية حسب الفرع/);
  assert.match(pane2, /visitCountList[\s\S]*?visits\.length/);
  assert.match(pane2, /openActions\.length[\s\S]*?violationCount/);
  assert.match(core, /comp\.coverageIncomplete/);
  assert.match(core, /comp\.hourlyTemplateCount/);
  assert.match(core, /إجمالي التغطية غير مكتمل؛ المهام المقاسة/);
  assert.match(core, /q\('checklist_templates', '\*,checklist_template_branches\(branch_id\)'\)/);
  assert.match(core, /غياب أرشيف تاريخي للقوالب/);
  assert.match(core, /complianceNonHourlyExpected/);
  assert.match(core, /complianceHourlyTemplateCount/);
  assert.match(core, /complianceReasons/);
  assert.match(core, /تفاصيل التغطية/);
  assert.match(core, /تتكرر خلال الوردية/);
  assert.match(core, /المهام المنفذة/);
  assert.doesNotMatch(core, /غير ساعية|قالب ساعي/);
  assert.match(core, /v: comp && comp\.pct != null \? comp\.pct \+ '%' : '—'/,
    'the compliance card should not show the unwanted incomplete-coverage phrase');
  assert.match(core, /function compliance\(r, branchFilter\)/, 'the existing compliance calculation must remain in place');
  assert.match(core, /var visits = filterRows\(SRC\.visits, r, true, true\)/, 'visit KPIs and the report must honor the selected shift');
  assert.match(core, /el\.textContent = String\(v\)/, 'restored note values must be text, not HTML');
  assert.doesNotMatch(core, /stockImpact|أثر نفاد المنتجات على التشغيل/);
  assert.match(core, /لا يتضمن قياس نفاد المنتجات أو تقدير المبيعات الفائتة/);
  assert.match(core, /ملاحظة مدير التشغيل لهذا المحور/);
  assert.doesNotMatch(html, /id="dashboardNotes"/, 'separate notes beneath the KPI area should be removed');
  assert.match(html, /class="print-attribution">إعداد وتقديم محمود شريف — إدارة التشغيل والجودة<\/p>/, 'the exact approved attribution must appear in the print header');
  assert.doesNotMatch(core, /محمود رائد|print-signature/, 'the outdated footer attribution must not be generated');
  assert.match(core, /var PANES = \{ 1: pane1, 2: pane2, 3: pane3, 4: pane4, 5: pane5, 6: pane6 \}/);
  const metricsIndex = html.indexOf('weekly-report-metrics.js');
  const coreIndex = html.indexOf('weekly-report-core.js');
  assert.ok(metricsIndex >= 0 && coreIndex > metricsIndex, 'metrics script must load before core');
  assert.match(html, /weekly-report-metrics\.js\?v=20261117194500/, 'weekly report must load the multi-day recurrence and branch-scope helper');
  assert.match(html, /weekly-report-core\.js\?v=20261125161700/, 'weekly report must load the header and signature update');
  assert.match(html, /#overviewCharts \{ display:grid !important/);
  assert.match(html, /#overviewBranchCharts \{ display:grid !important/);
  assert.match(html, /\.print-brand \{[^}]*background:linear-gradient\(125deg,#24170c,#76583d\)[^}]*print-color-adjust:exact/s);
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

function testWasteAndPlanDisplayChangesPreserveStoredData() {
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  const pane4Start = core.indexOf('function pane4()');
  const pane4End = core.indexOf('/* ───────── محور 5 ───────── */', pane4Start);
  const pane6Start = core.indexOf('function pane6()');
  const pane6End = core.indexOf('var PANES', pane6Start);
  assert.ok(pane4Start >= 0 && pane4End > pane4Start);
  assert.ok(pane6Start >= 0 && pane6End > pane6Start);
  const pane4 = core.slice(pane4Start, pane4End);
  const pane6 = core.slice(pane6Start, pane6End);
  assert.doesNotMatch(pane4, /root_cause|corrective_action|قيمة الهدر|الأسباب الجذرية|الإجراء التصحيحي/);
  const wasteHeaderStart = pane4.indexOf('سجلات الهدر بالتفصيل');
  const wasteHeaderEnd = pane4.indexOf('</thead>', wasteHeaderStart);
  assert.ok(wasteHeaderStart >= 0 && wasteHeaderEnd > wasteHeaderStart);
  assert.equal((pane4.slice(wasteHeaderStart, wasteHeaderEnd).match(/<th\b/g) || []).length, 5);
  assert.match(pane6, /<select data-plan="scope"/);
  assert.match(pane6, /<input type="hidden" data-plan="kpi"/);
  assert.doesNotMatch(pane6, /<th[^>]*>[^<]*مؤشر القياس/);
  assert.match(core, /p_kpi: get\('kpi'\)/, 'the hidden existing KPI value must still be saved');
}

function testKpiRangeFallbackRequiresDailyReports() {
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  const start = core.indexOf('function computeAutoRange()');
  const end = core.indexOf('\n  function resolveRange()', start);
  assert.ok(start >= 0 && end > start, 'weekly auto-range implementation should be present');
  const autoRange = core.slice(start, end);
  assert.match(autoRange, /filterRows\(SRC\.reports, want, true, false\)/,
    'recent checklist activity must not count as a substitute for daily reports in the KPI range');
  assert.match(autoRange, /reportSpan/,
    'the fallback period should be based on the most recent selected-branch daily report');
  assert.doesNotMatch(autoRange, /SRC\.logs/,
    'checklist-only activity must not suppress the daily-report fallback');
  assert.match(core, /cur\.count \? nf\(cur\.sales\) \+ ' ر\.س' : '—'/,
    'missing daily reports should not be shown as zero sales');
  assert.match(core, /لا توجد تقارير يومية في الفترة المحددة/,
    'the sales KPI should explain when the chosen period has no daily reports');
}

function testIssuesComplaintsAndSupervisorForm() {
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  const form = fs.readFileSync(path.join(__dirname, '..', 'daily-report', 'index.html'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'assets', 'supabase-config.js'), 'utf8');
  assert.doesNotMatch(core, /attendance_records|SRC\.attendance|Jisr|بصمة/);
  assert.match(core, /q\('technical_issues', 'id,branch_id,title,description,priority,status,created_at,source'\)/);
  assert.match(core, /filterRows\(SRC\.technicalIssues \|\| \[\], r, true, false\)/, 'technical reports have no shift filter field');
  assert.match(core, /isStaffShortageIssue\(issue\)/);
  assert.match(core, /isIssueType\(issue, 'موظف'\)/, 'staff shortage classification must use issue_type=موظف');
  assert.match(core, /norm\(x\.review_type\)\.toLowerCase\(\)/, 'normalize review type before isolating complaints');
  assert.match(form, /issue_type: 'issue-type'/);
  assert.match(form, /option value="موظف">موظف \/ نقص كادر/);
  assert.match(form, /تقييمات Google Maps وشكاوى العملاء/);
  assert.match(form, /شكوى العميل مباشرة/);
  assert.match(form, /Google Maps/);
  assert.match(form, /اختر نوع كل مشكلة قبل إرسال التقرير/);
  assert.match(form, /review-status/);
  assert.match(form, /review-owner/);
  assert.match(form, /review-action/);
  assert.match(form, /reviewType\.value === 'negative'/, 'complaint fields must not appear active for positive reviews');
  assert.match(form, /status: r\.review_type === 'negative'/);
  assert.match(form, /owner: r\.review_type === 'negative'/);
  assert.match(form, /action_taken: r\.review_type === 'negative'/);
  const copyCallCount = (form.match(/functions\.invoke\('send-report-copy'/g) || []).length;
  assert.equal(copyCallCount, 1, 'the report copy must be requested exactly once');
  assert.doesNotMatch(api, /functions\.invoke\('send-report-copy'/, 'the save API must not send before reviews are saved');
  assert.ok(form.indexOf("await zamClient.functions.invoke('send-report-copy'") > form.indexOf("from('negative_reviews').insert"), 'await the report copy only after reviews are saved');
  assert.match(form, /mailResult\.email_sent !== true/, 'do not present a successful save as a successful email send');
  assert.match(form, /تم حفظ التقرير، لكن تعذر تأكيد البريد/);
  assert.match(form, /تم حفظ التقرير وإرسال نسخ البريد؛ بدأ تنزيل PDF تلقائيًا/);
  assert.match(form, /existingReportGuards\.set\(submissionKey, String\(report\.id\)\)/,
    'an email failure must retain the duplicate-report guard for the saved report');
  assert.match(form, /const \{ error: reviewError \}/, 'review insert errors must not be silently ignored');
  assert.match(form, /sessionStorage\.setItem\(submissionKey/);
  assert.match(form, /لتجنب التكرار/);
  assert.match(form, /await ZamAPI\.getDailyReportMatches\(\{/);
  assert.match(form, /تعذّر التحقق من وجود تقرير سابق؛ لم يتم الإرسال/);
  assert.match(form, /existingReportGuards\.set\(submissionKey, existingId\)/);
  assert.match(form, /if \(reportSubmitting\) return/);
  assert.ok(form.indexOf('await ZamAPI.getDailyReportMatches') < form.indexOf('await ZamAPI.submitDailyReport'), 'duplicate lookup must complete before any report insert');
  assert.match(form, /const canEditComplaints = \['Owner', 'Supervisor', 'Manager', 'Admin'\]/);
  assert.match(form, /const canResolveTechnicalIssues = \['Owner', 'Supervisor', 'Manager', 'Admin'\]/);
  assert.match(form, /const branchId = canViewAllTechnicalIssues \? null : currentUser\.branch_id/);
  assert.match(form, /action_taken: row\.querySelector\('\.complaint-action'\)/);
  assert.match(form, /ZamAPI\.updateTechnicalIssue\(btn\.dataset\.id/);
  assert.match(api, /async getDailyReportMatches\(\{ branchId, reportDate, shiftType \}\)/);
  assert.match(api, /const sheetKey = `zam-web-daily-report-v1:/);
  assert.match(api, /sheet_key: sheetKey/);
  assert.match(api, /duplicate\.duplicateReport = true/);
  assert.match(form, /if \(err && err\.duplicateReport\)/);
  assert.match(api, /async updateTechnicalIssue\(id, \{ status, internal_comment \}\)/);
  assert.match(api, /payload\.internal_comment = comment \|\| null/);
  assert.match(form, /technical-comment/);
  assert.match(form, /حفظ الحالة والتعليق/);
  assert.match(form, /الوصف الأصلي/);
  assert.doesNotMatch(api, /description: String\(description \|\| ''\)/, 'technical status updates must preserve the original description');
  assert.doesNotMatch(api.slice(api.indexOf('async updateTechnicalIssue(')), /description\s*:/, 'technical follow-up updates must never overwrite the original description');
  assert.doesNotMatch(form, /technical-description/, 'technical issue descriptions are not editable in follow-up');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261117144417_add_technical_issue_internal_comment.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE public\.technical_issues\s+ADD COLUMN IF NOT EXISTS internal_comment text/i);
  assert.match(migration, /COMMENT ON COLUMN public\.technical_issues\.internal_comment/i);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE|TRUNCATE|DROP|CREATE POLICY|ALTER POLICY|GRANT|REVOKE)\b/im, 'migration must not change data or policies');
  assert.match(form, /حفظ الحالة/);
  assert.match(form, /min-w-\[760px\]/);
  assert.match(form, /min-w-\[660px\]/);
  assert.match(api, /wrapped\.reportId = report\.id/);
  assert.match(api, /wrapped\.partialSave = true/);
}

function testReportFormRestoresAfterIssueTypeRejection() {
  const form = fs.readFileSync(path.join(__dirname, '..', 'daily-report', 'index.html'), 'utf8');
  const helperStart = form.indexOf('function restoreReportSubmissionForm(');
  const helperEnd = form.indexOf('\n        }', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'the shared form-restoration helper should exist');
  const helperSource = form.slice(helperStart, helperEnd + '\n        }'.length);

  function runRestore(knownId) {
    const button = {
      disabled: true,
      textContent: 'جارِ التحقق...',
      title: 'مؤقت',
      removeAttribute(name) { if (name === 'title') this.title = ''; }
    };
    const dateInput = { disabled: true, value: '2026-11-17' };
    const shiftInput = { disabled: true, value: 'Morning' };
    const context = {
      reportSubmitting: true,
      button,
      dateInput,
      shiftInput,
      document: { getElementById(id) { return ({ submitReportBtn: button, reportDate: dateInput, shiftType: shiftInput })[id]; } },
      partialSubmissionKey: () => 'branch:date:shift',
      partialSubmissionId: () => '',
      existingReportId: () => knownId,
      syncPartialSubmissionGuard() {
        button.disabled = !!knownId;
        button.textContent = knownId ? 'يوجد تقرير محفوظ — الإرسال متوقف' : 'إرسال التقرير';
      }
    };
    vm.runInNewContext(`${helperSource}\nrestoreReportSubmissionForm(button, dateInput, shiftInput);`, context);
    return { button, dateInput, shiftInput, reportSubmitting: context.reportSubmitting };
  }

  const rejected = runRestore('');
  assert.equal(rejected.reportSubmitting, false, 'a rejected issue type must clear the submitting lock');
  assert.equal(rejected.dateInput.disabled, false, 'report date must be editable again');
  assert.equal(rejected.shiftInput.disabled, false, 'shift must be editable again');
  assert.equal(rejected.button.disabled, false, 'the submit button must be available for correction');
  assert.equal(rejected.button.textContent, 'إرسال التقرير');

  const duplicate = runRestore('existing-report-id');
  assert.equal(duplicate.dateInput.disabled, false);
  assert.equal(duplicate.shiftInput.disabled, false);
  assert.equal(duplicate.button.disabled, true, 'restoration must preserve the duplicate-report guard');
  assert.match(duplicate.button.textContent, /يوجد تقرير محفوظ/);

  const invalidBlockStart = form.indexOf('if (rawIssueRows.some(i => i.description && !i.issue_type))');
  const invalidBlockEnd = form.indexOf('const issueRows =', invalidBlockStart);
  assert.ok(invalidBlockStart >= 0 && invalidBlockEnd > invalidBlockStart);
  assert.match(form.slice(invalidBlockStart, invalidBlockEnd), /restoreReportSubmissionForm\(btn, dateInput, shiftInput\)/,
    'rejecting a missing issue type must use the tested restoration path');
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

function testNarrowDateFiltersStayWithinViewport() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'weekly-report', 'index.html'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, '..', 'assets', 'weekly-report-core.js'), 'utf8');
  const narrowRules = html.match(/@media \(max-width:360px\) \{([\s\S]*?)\n  \}/);
  assert.ok(narrowRules, 'the narrow-phone filter layout should be scoped to the confirmed 320px case');
  assert.match(narrowRules[1], /#reportFilters \.px-margin-desktop \{ padding-inline:16px; \}/);
  assert.match(narrowRules[1], /#reportFilters \.flex\.items-center\.gap-xs \{ display:grid; grid-template-columns:minmax\(0,1fr\); width:100%; min-width:0; gap:4px; \}/);
  assert.match(narrowRules[1], /#reportFilters \.flex\.items-center\.gap-xs > label \{ position:static;[^}]*font-size:13px/);
  assert.match(narrowRules[1], /#reportFilters \.flex\.items-center\.gap-xs > span \{ display:none; \}/);
  assert.match(narrowRules[1], /#reportFilters input\[type="date"\] \{ box-sizing:border-box; min-width:0; width:100%; max-width:100%; min-height:44px; padding-inline:8px; \}/);

  const helperMatch = core.match(/function customDateRange\(fromValue, toValue, currentRange\) \{[\s\S]*?\n  \}/);
  assert.ok(helperMatch, 'custom date selection should preserve the current value of the untouched field');
  const context = {};
  vm.runInNewContext(`${helperMatch[0]}\nthis.result = customDateRange('2026-11-20', '', { from: '2026-11-18', to: '2026-11-24' });`, context);
  assert.equal(context.result.from, '2026-11-20');
  assert.equal(context.result.to, '2026-11-24');
  vm.runInNewContext(`${helperMatch[0]}\nthis.result = customDateRange('', '2026-11-26', { from: '2026-11-18', to: '2026-11-24' });`, context);
  assert.equal(context.result.from, '2026-11-18');
  assert.equal(context.result.to, '2026-11-26');
  const initStart = core.indexOf('function init(opts)');
  const initEnd = core.indexOf('\n  function notify(', initStart);
  assert.ok(initStart >= 0 && initEnd > initStart);
  assert.match(core.slice(initStart, initEnd), /df\.addEventListener\('change', applyCustomDateRange\)/);
  assert.match(core.slice(initStart, initEnd), /dt\.addEventListener\('change', applyCustomDateRange\)/);
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
  const paneStart = core.indexOf('function pane2()');
  const paneEnd = core.indexOf('/* ───────── محور 3 ───────── */', paneStart);
  assert.ok(paneStart >= 0 && paneEnd > paneStart);
  const pane = core.slice(paneStart, paneEnd);
  assert.match(pane, /الزيارات الإشرافية حسب الفرع/);
  assert.match(pane, /الإجمالي[\s\S]*?visits\.length/);
  assert.match(pane, /التكليفات المفتوحة \/ المخالفات/);
  assert.match(pane, /متأخرة عن الموعد/);
  const summaryStart = pane.indexOf('ملخص الزيارات الإشرافية');
  const summaryEnd = pane.indexOf('</thead>', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  const summaryHeader = pane.slice(summaryStart, summaryEnd);
  assert.equal((summaryHeader.match(/<th\b/g) || []).length, 6, 'the unified visit table has six requested fields');
  assert.match(summaryHeader, /التاريخ[\s\S]*?الشفت[\s\S]*?المقيّم[\s\S]*?الفرع[\s\S]*?الدرجة/);
  assert.match(pane, /المخالفات \/ التكليفات/);
  const branchStart = pane.indexOf('var branchVisitTables');
  const branchEnd = pane.indexOf('var issueRowsAll', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart, 'per-branch average and commentary tables should be present');
  const branchTables = pane.slice(branchStart, branchEnd);
  assert.match(branchTables, /متوسط الدرجة/);
  assert.match(branchTables, /التكليفات المفتوحة/);
  assert.match(branchTables, /أبرز الملاحظات والتكليفات/);
  assert.match(branchTables, /visit\.action/, 'include the visit-level corrective action');
  assert.match(branchTables, /visitResults\.filter[\s\S]*?row\.note/, 'include notes attached to checklist results');
  assert.match(branchTables, /visitActions\.filter[\s\S]*?action\.title/, 'include recorded action-item titles');
  assert.match(branchTables, /action\.description/, 'include action-item descriptions');
  assert.match(branchTables, /comments\.slice\(0, 4\)/);
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
testCalendarSessionsWithoutReportsAndFilters();
testComplianceByActualShiftSessions();
testWeeklyComplianceHonorsMultiBranchScopes();
testTopIncompleteCap();
testAppsScriptMappingsWithoutNetwork();
testReportWiringAndPrintSafety();
testWasteAndPlanDisplayChangesPreserveStoredData();
testKpiRangeFallbackRequiresDailyReports();
testSalesTableMobileAndPrint();
testNarrowDateFiltersStayWithinViewport();
testVisitWiringFiltersAndTableShape();
testPrintPeriodAndAccessibleSixTabs();
testIssuesComplaintsAndSupervisorForm();
testReportFormRestoresAfterIssueTypeRejection();
console.log('weekly-report tests: all checks passed');
