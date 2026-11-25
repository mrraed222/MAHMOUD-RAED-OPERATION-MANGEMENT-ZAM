const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const weeklyMetrics = require('../../assets/weekly-report-metrics.js');

const page = fs.readFileSync(path.join(__dirname, '../../daily-report/index.html'), 'utf8');
const checklistFn = page.slice(page.indexOf('async function getSavedReportChecklistSummary'), page.indexOf('async function printSavedReport()'));
const printFn = page.slice(page.indexOf('async function printSavedReport()'), page.indexOf('function attachSavedReportPdf'));
const saveFn = page.slice(page.indexOf("const wasteInputRows ="), page.indexOf("const reviewRows = collectRows('google-table'"));

test('saved shift report print leads with ZAM branding and requested identity then sales order', () => {
  assert.match(printFn, /<img src="\$\{esc\(logoUrl\)\}" alt="شعار ZAM">/);
  const ordered = [
    '<b>الفرع</b>', '<b>الوردية</b>', '<b>المشرف</b>', '<b>التاريخ</b>',
    '<b>إجمالي المبيعات</b>', '<b>متوسط الفاتورة</b>'
  ].map(token => printFn.indexOf(token));
  assert.ok(ordered.every(index => index >= 0));
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
  assert.match(printFn, /ملخص الهدر[\s\S]*مشكلات الوردية والإجراءات[\s\S]*تقييمات العملاء والشكاوى/);
  assert.match(printFn, /حصيلة تنفيذ قائمة التحقق/);
  assert.match(printFn, /escapeReportPrintText|const esc = escapeReportPrintText/);
});

test('saved shift print includes a permission-scoped checklist summary for the exact branch/date/shift', () => {
  assert.match(checklistFn, /scope\?\.can_view_checklist_logs/);
  assert.match(checklistFn, /scope\?\.scope_mode === 'selected'[\s\S]*branchId/);
  assert.match(checklistFn, /currentUser\.shift_type === shiftType/);
  assert.match(checklistFn, /ZamAPI\.getChecklistLogs\(\{ branchId, date: reportDate, shiftType \}\)/);
  assert.match(checklistFn, /ZamAPI\.getHourlyChecklistLogs\(\{ branchId, date: reportDate, shiftType \}\)/);
  assert.match(checklistFn, /ZamWeeklyMetrics\.calculateCompliance/);
  assert.match(checklistFn, /ZamChecklistLogMetrics\.summarizeHourlyExecutionCounts/);
  assert.match(printFn, /ملخص التشيك ليست/);
  assert.match(printFn, /المهام المجدولة غير الساعية المنفذة/);
  assert.match(printFn, /المهام غير الساعية غير المنفذة/);
  assert.match(printFn, /المهام الساعية المسجلة صراحةً/);
  assert.match(printFn, /لا يُفترض أن غياب سجل يعني عدم التنفيذ/);
});

test('single-shift checklist counts respect recurrence and keep hourly templates out of the base denominator', () => {
  const branchId = 'branch-a';
  const date = '2026-11-25';
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const templates = [
    { id: 'daily', branch_id: branchId, shift_type: 'Evening', frequency: 'daily', is_active: true },
    { id: 'weekly', branch_id: branchId, shift_type: 'Evening', frequency: 'weekly', days_of_week: [weekday], is_active: true },
    { id: 'not-due', branch_id: branchId, shift_type: 'Evening', frequency: 'weekly', days_of_week: [(weekday + 1) % 7], is_active: true },
    { id: 'hourly', branch_id: branchId, shift_type: 'Evening', frequency: 'hourly', is_active: true },
  ];
  const result = weeklyMetrics.calculateCompliance(templates, [
    { date, branch: branchId, shift: 'Evening' },
  ], [
    { template_id: 'daily', branch_id: branchId, execution_date: date, shift_type: 'Evening', status: 'Completed' },
  ], { branchFilter: branchId, branches: [branchId], shiftFilter: 'Evening' });

  assert.equal(result.nonHourlyExpected, 2);
  assert.equal(result.nonHourlyDone, 1);
  assert.equal(result.nonHourlyPending, 1);
  assert.equal(result.hourlyTemplateCount, 1);
});

test('waste reason options include all requested categories and detail input is conditional/required', () => {
  for (const label of ['الصلاحية', 'المعايرة', 'قهوة الموظف اليومية', 'التلف بسبب خطأ بشري', 'أخرى']) {
    assert.ok(page.includes(label), `missing reason ${label}`);
  }
  assert.match(page, /const needsDetail = \['human_error', 'other'\]\.includes\(wasteReason\.value\)/);
  assert.match(page, /detail\.required = needsDetail/);
  assert.match(saveFn, /missingWasteReason[\s\S]*اختر سببًا لكل سجل هدر/);
  assert.match(saveFn, /missingWasteDetail[\s\S]*أدخل تفصيلًا مختصرًا/);
  assert.match(saveFn, /reason: `\$\{reasonLabel\}\$\{w\.detail \? ` — \$\{w\.detail\}` : ''\}`/);
});

test('waste reasons keep using the existing reason column; no database or unrelated page edits', () => {
  assert.match(page, /waste: wasteRows/);
  assert.match(page, /reason: `\$\{reasonLabel\}/);
  assert.match(page, /zamClient\.from\('negative_reviews'\)/);
});
