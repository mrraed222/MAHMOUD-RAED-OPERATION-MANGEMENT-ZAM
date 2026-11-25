const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'report-detail-renderer.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, globalThis: window, JSON, String, Number, Array, Date });
const filter = window.ZamReportDetailRenderer.filterWasteForReport;

const morningKey = 'زام الرئيسي|2026-11-24|Morning|مشرف الصباح|31';
const eveningKey = 'زام الرئيسي|2026-11-24|Evening|مشرف المساء|32';
const importedReport = {
  id: 'report-evening', report_date: '2026-11-24', shift_type: 'Evening',
  sheet_key: eveningKey, custom_fields: { sheet_row: 32 },
};
const rows = [
  { id: 'right', sheet_key: `${eveningKey}|W|milk|1|L|expired`, shift_type: 'Evening' },
  { id: 'wrong-date', sheet_key: 'زام الرئيسي|2026-11-23|Evening|مشرف المساء|30|W|milk|1|L|expired', shift_type: 'Evening' },
  { id: 'wrong-branch', sheet_key: 'زام 2|2026-11-24|Evening|مشرف المساء|30|W|milk|1|L|expired', shift_type: 'Evening' },
  { id: 'wrong-shift-key', sheet_key: `${morningKey}|W|juice|1|L|damaged`, shift_type: 'Evening' },
  { id: 'malformed-key', sheet_key: 'legacy-unparseable-key', shift_type: 'Evening' },
  { id: 'unkeyed-right-shift', shift_type: 'Evening' },
  { id: 'unkeyed-wrong-shift', shift_type: 'Morning' },
  { id: 'unverifiable', item_name: 'must not leak' },
];
assert.deepEqual(Array.from(filter(importedReport, rows), (row) => row.id), ['right', 'unkeyed-right-shift']);

const importedWithoutReportKey = {
  id: 'legacy-import', report_date: '2026-11-24', shift_type: 'Evening',
  custom_fields: { sheet_row: 32 },
};
assert.deepEqual(Array.from(filter(importedWithoutReportKey, [
  { id: 'key-cannot-prove-branch-date', sheet_key: `${eveningKey}|W|milk` },
  { id: 'verified-by-parent-id-and-shift', shift_type: 'Evening' },
]), (row) => row.id), ['verified-by-parent-id-and-shift']);

const rendered = window.ZamReportDetailRenderer.render(importedReport, {
  branchName: 'زام الرئيسي', waste: filter(importedReport, rows),
});
assert.match(rendered, /عدد السجلات المرتبطة بهذا التقرير/);
assert.doesNotMatch(rendered, /milk|expired|must not leak|wrong-date|wrong-branch/);
console.log('reports-log exact waste association unit test: passed');
