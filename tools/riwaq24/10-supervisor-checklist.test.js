const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../supervisor-checklist/index.html'), 'utf8');

test('supervisor checklist presents branch/shift context, summary, urgent receiving, tasks, notes, then report action', () => {
  const positions = [
    source.indexOf('id="page-title"'),
    source.indexOf('class="supervisor-summary"'),
    source.indexOf('id="inventory-receiving-tasks-section"'),
    source.indexOf('id="shift-tasks"'),
    source.indexOf('id="team-notes"'),
    source.indexOf('id="report-action-title"')
  ];
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(source, /id="branch-sub-label"/);
  assert.match(source, /id="summary-shift"/);
});

test('role guard, branch lifecycle, shift semantics and operational destinations are preserved', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Owner', 'Admin'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(currentBranchLifecycle, new Date\(\)\)/);
  assert.match(source, /ZamChecklistSchedule\.getShiftWindow\(currentShift, currentBranchHours, now\)/);
  assert.match(source, /get_open_inventory_receipt_tasks/);
  assert.match(source, /complete_inventory_receipt_item/);
  assert.match(source, /p_item_verified: completion\.itemVerified/);
  assert.match(source, /submitFridgeReadings\(entries,\s*\{\s*branch_id: currentUser\.branch_id,\s*recorded_by: currentUser\.id,\s*shift_type: currentShift/);
  assert.match(source, /submitChecklistLog\(\{[\s\S]*?template_id: cb\.dataset\.id,[\s\S]*?status: 'Completed',[\s\S]*?shift_type: currentShift/);
  assert.match(source, /\.from\('team_notes'\)\s*\.select\('id, profile_id, branch_id, shift_type, note, created_at, profiles\(full_name, avatar_url\)'\)/);
  assert.match(source, /window\.location\.href = '\.\.\/daily-report\/index\.html'/);
  assert.match(source, /href=\"\.\.\/inventory-requests\/index\.html\?shift=\$\{currentShift\}\"/);
});

test('empty, loading, error and retry states are accessible and user actions remain real', () => {
  assert.match(source, /جارٍ تحميل مهام الاستلام/);
  assert.match(source, /لا توجد دفعات استلام مفتوحة/);
  assert.match(source, /تعذّر تحميل مهام الاستلام/);
  assert.match(source, /id="retry-checklist-btn"/);
  assert.match(source, /addEventListener\('click', loadChecklist\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /id="save-note-btn"/);
  assert.match(source, /id="send-report-btn"/);
  assert.doesNotMatch(source, /notif-bell-slot/);
});
