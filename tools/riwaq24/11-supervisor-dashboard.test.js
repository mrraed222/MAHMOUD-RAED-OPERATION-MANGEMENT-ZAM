const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../supervisor-dashboard/index.html'), 'utf8');

test('dashboard prioritizes follow-up and explains branch/shift and read-only metrics context', () => {
  const positions = [source.indexOf('id="dashboard-title"'), source.indexOf('id="visit-actions-heading"'), source.indexOf('id="report-status"'), source.indexOf('id="stat-team"'), source.indexOf('id="team-grid"'), source.indexOf('id="restroom-hourly-panel"'), source.indexOf('id="category-grid"'), source.indexOf('id="notes-list"')];
  assert.ok(positions.every(p => p >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(source, /متابعة القراءة فقط/);
  assert.match(source, /id="dashboard-shift-context"/);
  assert.match(source, /id="refresh-dashboard"/);
});

test('role guards, branch/shift APIs, query limits and action payloads remain unchanged', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Supervisor', 'Manager'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branchRes\.data, now\)/);
  assert.match(source, /\.limit\(100\)/);
  assert.match(source, /\.limit\(30\)/);
  assert.match(source, /initialDashboardShift\(currentUser\)/);
  assert.match(source, /submit_visit_action_for_review/);
  assert.match(source, /p_action_id: activeVisitAction\.id,[\s\S]*p_completion_note: note/);
  assert.match(source, /href="\.\.\/daily-report\/index\.html"/);
  assert.match(source, /href="\.\.\/supervisor-checklist\/index\.html"/);
});

test('refresh, retry, accessible visit modal, and independent empty states are available', () => {
  assert.match(source, /refreshButton\?\.addEventListener\('click', refreshDashboard\)/);
  assert.match(source, /\.retry-dashboard/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /لا توجد مخالفات أو تكليفات مفتوحة/);
  assert.match(source, /لا توجد ملاحظات من الفريق حتى الآن/);
  assert.match(source, /لا توجد مهام مستحقة في هذه الوردية اليوم/);
  assert.match(source, /id="notif-bell-slot"/);
});
