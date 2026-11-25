const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'assets', 'report-detail-renderer.js'), 'utf8');
const summarySource = fs.readFileSync(path.join(root, 'assets', 'report-log-summary.js'), 'utf8');
const window = {};
const context = { window, globalThis: window, Number, String, Array, JSON, Date };
vm.runInNewContext(rendererSource, context);
vm.runInNewContext(summarySource, context);

const report = {
  id: 'report-1',
  report_date: '2026-11-24',
  shift_type: 'Evening',
  sheet_key: 'فرع-1|2026-11-24|Evening|مشرف|42',
  custom_fields: { sheet_row: 42 },
  supervisor_name: 'مشرف',
  branches: { name: 'فرع-1' },
  avg_ticket: 15,
  total_sales: 150,
  team_status: 'مكتمل',
};
const parentKey = report.sheet_key;
const wasteRows = [
  { report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|x|1|kg|reason`, quantity: '2', unit: 'kg', item_name: 'اسم صنف خام' },
  { report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|y|2|kg|reason`, quantity: 1, unit: 'kg', reason: 'سبب خام' },
  { report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|z|3|L|reason`, quantity: '0.5', unit: 'L', corrective_action: 'إجراء خام' },
  { report_id: 'another-report', shift_type: 'Evening', sheet_key: `${parentKey}|W|elsewhere|4|kg|reason`, quantity: 900, unit: 'kg' },
  { report_id: 'report-1', shift_type: 'Evening', sheet_key: 'فرع-2|2026-11-24|Evening|مشرف|7|W|wrong|1|kg', quantity: 700, unit: 'kg' },
];

function summarize(rows = wasteRows, overrides = {}) {
  return window.ZamReportLogSummary.summarize(report, {
    report_id: report.id,
    waste_rows: rows,
    shift_issue_count: 2,
    technical_issue_count: 1,
    ...overrides,
  });
}

test('aggregates only rows attached to the selected report and verified imported parent key, grouped by stored unit', () => {
  const result = summarize();
  assert.equal(result.wasteStatus, 'ready');
  assert.equal(result.wasteByUnit.find((item) => item.unit === 'kg').quantity, 3);
  assert.equal(result.wasteByUnit.find((item) => item.unit === 'L').quantity, 0.5);
  assert.equal(result.wasteByUnit.length, 2);
  assert.equal(result.shiftIssueCount, 2);
  assert.equal(result.technicalIssueCount, 1);
});

test('desktop row keeps identity, shift, branch, date, average, sales, waste, and issue summaries in order', () => {
  const html = window.ZamReportLogSummary.renderDesktopRow(report, summarize());
  const cells = Array.from(html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (match) => match[1]);
  assert.equal(cells.length, 10);
  assert.match(cells[0], /مشرف/);
  assert.match(cells[1], /مسائية/);
  assert.match(cells[2], /فرع-1/);
  assert.match(cells[3], /2026-11-24/);
  assert.match(cells[4], /ر\.س/);
  assert.match(cells[5], /ر\.س/);
  assert.match(cells[6], /kg|L/);
  assert.match(cells[7], /مشاكل الشفت/);
  assert.doesNotMatch(html, /اسم صنف خام|سبب خام|إجراء خام|another-report|wrong/);
});

test('mobile card escapes unit text and does not expose item or cause details', () => {
  const rows = [{ report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|x|1|<img src=x onerror=alert(1)>`, quantity: 1, unit: '<img src=x onerror=alert(1)>', item_name: 'secret item' }];
  const html = window.ZamReportLogSummary.renderMobileCard(report, summarize(rows));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x|secret item/);
});

test('zero waste and failed summary are visibly distinct', () => {
  const zero = summarize([]);
  const zeroHtml = window.ZamReportLogSummary.renderDesktopRow(report, zero);
  assert.match(zeroHtml, /لا يوجد هدر مطابق لهذا التقرير/);
  const failedHtml = window.ZamReportLogSummary.renderDesktopRow(report, window.ZamReportLogSummary.errorSummary());
  assert.match(failedHtml, /تعذّر تحميل ملخص الهدر/);
  assert.match(failedHtml, /تعذّر تحميل المشاكل المسجلة/);
});

test('malformed quantities or unit metadata fail closed rather than displaying a partial total', () => {
  const malformed = [{ report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|x|1|kg`, quantity: 'NaN', unit: 'kg' }];
  assert.equal(summarize(malformed).wasteStatus, 'error');
  const missingUnit = [{ report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|x|1|kg`, quantity: 1 }];
  assert.equal(summarize(missingUnit).wasteStatus, 'error');
  const overflow = [
    { report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|x|1|kg`, quantity: Number.MAX_VALUE, unit: 'kg' },
    { report_id: 'report-1', shift_type: 'Evening', sheet_key: `${parentKey}|W|y|2|kg`, quantity: Number.MAX_VALUE, unit: 'kg' },
  ];
  assert.equal(summarize(overflow).wasteStatus, 'error');
  assert.equal(summarize(wasteRows, { report_id: 'different-report' }).wasteStatus, 'error');
});
