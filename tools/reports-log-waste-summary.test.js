const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'reports-log', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'assets', 'report-detail-renderer.js'), 'utf8');

assert.match(html, /fetchAllRows\(zamClient,'waste_logs','report_id',report\.id,\{columns:attempt\.columns,orderBy:null,tieBreaker:null\}\)/,
  'waste rows must be paginated under the exact report ID and only safe association columns selected');
assert.match(html, /columns:'id,report_id,shift_type,sheet_key'/,
  'the preferred association query should include the imported sheet key and shift only');
assert.match(html, /columns:'id,report_id,shift_type'/,
  'older schemas may safely fall back to shift metadata');
assert.match(html, /isImportedSheetReport\(report\)&&!attempt\.hasShift/,
  'migrated rows without shift metadata must not be guessed into a report');
assert.match(html, /ZamReportDetailRenderer\.filterWasteForReport\(report,\s*wasteRes\.data\s*\|\|\s*\[\]\)/,
  'the display must verify imported key/shift before counting waste');
assert.match(renderer, /عدد السجلات المرتبطة بهذا التقرير/);
assert.doesNotMatch(renderer, /row\.item_name|row\.quantity|row\.reason|row\.root_cause|row\.corrective_action/,
  'the report detail renderer must never read or display raw waste item/reason fields');
assert.doesNotMatch(html, /loadChildren\('waste_logs'\)/,
  'the page must not request complete raw waste rows');
assert.match(html, /waste: !!wasteRes\.error/,
  'an unavailable association query must be reported instead of presenting a false zero');

console.log('reports-log safe waste summary test: passed');
