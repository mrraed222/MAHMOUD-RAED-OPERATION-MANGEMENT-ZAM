const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../reports-monitor/index.html'), 'utf8');

test('monitor retains exact role and permission guards and report query contract', () => {
  assert.match(source, /\['Owner','Admin','Manager'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /ZamAPI\.requireAdminPerm\('can_view_all_reports'\)/);
  assert.match(source, /select\('branch_id, shift_type, entry_time'\)\.eq\('report_date',date\)/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branch,date\)/);
  assert.match(source, /shift_type==='Morning'/);
  assert.match(source, /shift_type==='Evening'/);
});

test('monitor distinguishes missing records from lateness and exposes report read errors', () => {
  assert.match(source, /لم يُسجّل/);
  assert.match(source, /لا تشير إلى التأخر عن موعد تسليم/);
  assert.match(source, /if\(reportsRes\.error\)throw reportsRes\.error/);
  assert.match(source, /تعذّر تحميل البيانات/);
  assert.match(source, /لا توجد فروع تشغيلية لعرضها/);
});

test('date, refresh and local sorting are actionable with accessible status and responsive list', () => {
  assert.match(source, /id="check-date"/);
  assert.match(source, /id="refresh-monitor"/);
  assert.match(source, /addEventListener\('click',loadMonitor\)/);
  assert.match(source, /id="sort-branches"/);
  assert.match(source, /addEventListener\('change',renderMonitor\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /id="monitor-mobile"/);
  assert.match(source, /escapeHtml\(x\.branch\.name\)/);
});
