const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
  assert.match(source, /upsert: false/);
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

test('employee shift state distinguishes an upcoming evening from the previous evening grace expiry in Riyadh time', () => {
  const schedule = require('../../assets/checklist-schedule.js');
  const helperSource = source.match(/function employeeShiftState\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helperSource, 'employeeShiftState must be defined');
  const state = vm.runInNewContext(`(${helperSource})`, { ZamChecklistSchedule: schedule });
  const atRiyadh = (isoUtc) => new Date(isoUtc);
  const hours = { opening_time: '05:30', closing_time: '02:30' };
  const eveningWindow = date => schedule.getShiftWindow('Evening', hours, date);
  const morningWindow = date => schedule.getShiftWindow('Morning', hours, date);

  const beforeEvening = atRiyadh('2026-11-28T10:55:00.000Z'); // 13:55 Asia/Riyadh
  assert.equal(eveningWindow(beforeEvening).businessDate, '2026-11-27');
  assert.equal(state('Evening', eveningWindow(beforeEvening), beforeEvening), 'upcoming');
  assert.equal(state('Evening', eveningWindow(atRiyadh('2026-11-28T12:29:00.000Z')), atRiyadh('2026-11-28T12:29:00.000Z')), 'upcoming');
  const eveningOpening = atRiyadh('2026-11-28T12:30:00.000Z'); // 15:30
  assert.equal(eveningWindow(eveningOpening).businessDate, '2026-11-28');
  assert.equal(state('Evening', eveningWindow(eveningOpening), eveningOpening), 'open');

  const beforeMorning = atRiyadh('2026-11-28T01:00:00.000Z'); // 04:00
  assert.equal(state('Morning', morningWindow(beforeMorning), beforeMorning), 'upcoming');
  const morningOpening = atRiyadh('2026-11-28T02:30:00.000Z'); // 05:30
  assert.equal(state('Morning', morningWindow(morningOpening), morningOpening), 'open');

  const afterMidnight = atRiyadh('2026-11-27T21:30:00.000Z'); // Nov 28 00:30 Riyadh
  assert.equal(eveningWindow(afterMidnight).businessDate, '2026-11-27');
  assert.equal(state('Evening', eveningWindow(afterMidnight), afterMidnight), 'open');
  const closing = atRiyadh('2026-11-27T23:30:00.000Z'); // Nov 28 02:30
  assert.equal(state('Evening', eveningWindow(closing), closing), 'open');
  const graceEnd = atRiyadh('2026-11-28T00:30:00.000Z'); // 03:30, next day's evening is upcoming
  assert.equal(state('Evening', eveningWindow(graceEnd), graceEnd), 'upcoming');
  const morningGraceEnd = atRiyadh('2026-11-28T13:30:00.000Z'); // 16:30
  assert.equal(state('Morning', morningWindow(morningGraceEnd), morningGraceEnd), 'expired');
  assert.match(source, /shiftState === 'open' \|\| shiftState === 'expired'/,
    'an upcoming shift must not show the previous shift summary or expiry message');
});
