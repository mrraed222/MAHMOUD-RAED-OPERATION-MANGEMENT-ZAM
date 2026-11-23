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

test('dashboard removes search, sorting and the full tools rectangle while preserving data loading and accessible feedback', () => {
  for (const removed of ['branch-search', 'branch-sort', 'dashboard-refresh', 'dashboard-tools', 'ابحث عن فرع', 'ترتيب الفروع', 'إعادة تحميل']) {
    assert.equal(source.includes(removed), false, `Removed dashboard control remains: ${removed}`);
  }
  assert.match(source, /loadDashboard\(\);/);
  assert.match(source, /عرض \$\{rows\.length\} من \$\{dashboardRows\.length\} فرعًا/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /بعض البيانات غير متاحة/);
  assert.match(source, /تعذّر تحميل بيانات اللوحة/);
  assert.match(source, /لم نتمكن من تحميل قائمة الفروع أو القوالب/);
  assert.doesNotMatch(source, /aria-label="فتح تفاصيل \$\{branchName\}"/,
    'branch link must not mask its descendant performance labels with a generic accessible name');
  assert.match(source, /لا توجد فروع عاملة لعرضها وفق البيانات الحالية/);
});
