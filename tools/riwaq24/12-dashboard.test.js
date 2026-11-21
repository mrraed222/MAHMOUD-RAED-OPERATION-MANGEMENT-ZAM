const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../dashboard/index.html'), 'utf8');

test('dashboard preserves authorization and source contracts', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Owner','Admin','Manager'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /ZamAPI\.getBranches\(\)/);
  assert.match(source, /ZamAPI\.getTemplates\(\)/);
  assert.match(source, /from\('checklist_logs'\)/);
  assert.match(source, /from\('daily_reports'\)/);
  assert.match(source, /from\('shift_issues'\)/);
  assert.match(source, /const branchPage = '\.\.\/supervisor-dashboard\/index\.html'/);
});

test('dashboard provides usable search, sort, refresh and accessible state feedback', () => {
  assert.match(source, /id="branch-search" type="search"/);
  assert.match(source, /id="branch-sort"/);
  assert.match(source, /id="dashboard-refresh" type="button"/);
  assert.match(source, /addEventListener\('input', renderBranchCards\)/);
  assert.match(source, /addEventListener\('change', renderBranchCards\)/);
  assert.match(source, /addEventListener\('click', loadDashboard\)/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /بعض البيانات غير متاحة/);
  assert.match(source, /تعذّر تحميل بيانات اللوحة/);
  assert.match(source, /لا توجد فروع تطابق البحث/);
});
