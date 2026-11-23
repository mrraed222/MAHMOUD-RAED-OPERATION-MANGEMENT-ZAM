const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../my-checklist/index.html'), 'utf8');

test('employee task page prioritizes branch/shift context, progress and accessible task states', () => {
  assert.match(source, /id="user-branch-label"/);
  assert.match(source, /id="checklist-heading"/);
  assert.match(source, /id="progress-label"[^>]*aria-live="polite"/);
  assert.match(source, /id="checklist-container"[^>]*aria-busy="true"/);
  assert.match(source, /تعذّر تحميل المهام/);
  assert.match(source, /id="retry-checklist-btn"/);
  assert.match(source, /لا توجد مهام مستحقة أو متاحة لهذه الوردية الآن/);
  assert.doesNotMatch(source, /notif-bell-slot/);
});

test('existing auth, role, shift, branch, evidence, restroom and email contracts remain unchanged', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /currentUser\.role === 'Owner'/);
  assert.match(source, /ZamChecklistSchedule\.getShiftWindow\(currentShift, currentBranchHours, now\)/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branch, new Date\(\)\)/);
  assert.match(source, /ZamAPI\.getTemplates\(null, currentShift, currentUser\.branch_id\)/);
  assert.match(source, /ZamAPI\.submitHourlyChecklistLog\(base\)/);
  assert.match(source, /ZamAPI\.submitChecklistLog\(base\)/);
  assert.match(source, /ZamAPI\.submitRestroomHourlyOccurrence\(/);
  assert.match(source, /ZamAPI\.sendResendEmail\(/);
  assert.match(source, /upsert: true/);
  assert.match(source, /مهلة 20 دقيقة/);
});

test('shift controls, retry and recurring refresh remain functional', () => {
  assert.match(source, /btn\.addEventListener\('click', \(\) =>/);
  assert.match(source, /addEventListener\("click", loadMyChecklist\)/);
  assert.match(source, /scheduleChecklistRefresh\(\)/);
});

test('employee checklist merges multiple individual assignments without bypassing schedule checks', () => {
  assert.match(source, /ZamAPI\.getMyAssignedTemplateIds\(\)/);
  assert.match(source, /assignedTemplateIds: myAssignedTemplateIds/);
  assert.match(source, /ZamChecklistSchedule\.isTemplateScheduledForEmployee\(t, visibility, now\)/);
  assert.match(source, /ZamChecklistSchedule\.isTemplateVisibleForEmployee\(task, visibility, new Date\(\)\)/);
  assert.match(source, /ZamAPI\.submitChecklistLog\(base\)/);
});
