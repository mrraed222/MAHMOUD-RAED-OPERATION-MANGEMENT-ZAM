const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../branches-checklists/index.html'), 'utf8');

test('branch directory keeps auth/permission guards, routes and existing data operations', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /ZamAPI\.requireAdminPerm\('can_manage_branches'\)/);
  assert.match(source, /\['Owner','Admin','Supervisor'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /ZamAPI\.getBranches\(\)/);
  assert.match(source, /ZamAPI\.getStaff\(\)/);
  assert.match(source, /\.from\('branches'\)\.update\(payload\)\.eq\('id', editingBranchId\)/);
  assert.match(source, /\.from\('branches'\)\.insert\(\[\{ \.\.\.payload, lifecycle_status: lifecycleStatus \|\| 'planned' \}\]\)/);
  assert.match(source, /\.from\('branches'\)\.delete\(\)\.eq\('id', id\)/);
  assert.match(source, /lifecycle_status: lifecycleStatus, planned_opening_date: openingDate/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(b\)/);
  assert.match(source, /href="\.\.\/dashboard\/index\.html"/);
  assert.match(source, /href="\.\.\/manage-templates\/index\.html"/);
  assert.match(source, /href="\.\.\/staff-management\/index\.html"/);
});

test('directory offers local search/status filters, summaries, mobile-friendly cards and truthful data states', () => {
  for (const marker of ['id="branch-search"', 'id="branch-status-filter"', 'id="branch-total"', 'id="branch-operational"', 'id="branch-staff-total"']) assert.ok(source.includes(marker));
  assert.match(source, /addEventListener\('input', renderBranches\)/);
  assert.match(source, /addEventListener\('change', renderBranches\)/);
  assert.match(source, /لا توجد فروع في الدليل بعد/);
  assert.match(source, /لا توجد نتائج مطابقة/);
  assert.match(source, /تعذّر تحميل دليل الفروع أو بيانات الطاقم/);
  assert.match(source, /id="retry-branches-btn"/);
  assert.match(source, /جارٍ تحميل دليل الفروع/);
  assert.match(source, /تمت إضافة الفرع إلى الدليل/);
  assert.match(source, /if \(result\.error\) throw result\.error/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-invalid/);
  assert.match(source, /Escape/);
});

test('planned opening date is not represented as proof of actual opening', () => {
  assert.match(source, /تاريخ الافتتاح المخطط لا يثبت وحده تأكيد افتتاح فعلي/);
  assert.match(source, /ليس تأكيدًا لافتتاح فعلي/);
});
