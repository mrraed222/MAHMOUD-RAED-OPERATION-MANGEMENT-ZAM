const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const metrics = require('../assets/checklist-log-metrics.js');

const page = fs.readFileSync(path.join(__dirname, '..', 'checklist-logs', 'index.html'), 'utf8');

test('non-completed hourly restroom occurrences do not inflate the completed-task counter', () => {
  const ordinaryLogs = [{ status: 'completed' }];
  const hourlyLogs = Array.from({ length: 9 }, (_, index) => ({
    occurrence_hour: 6 + index,
    status: 'not_performed',
  }));

  assert.equal(metrics.countCompletedExecutionLogs(ordinaryLogs, hourlyLogs), 1,
    'one completed ordinary task plus nine missed hourly checks still means one completed task');
});

test('hourly completed checks count once while missed and pending checks remain incomplete', () => {
  const hourlyLogs = [
    { status: 'Completed' },
    { status: 'غير منفذة' },
    { status: 'pending' },
  ];

  assert.equal(metrics.countCompletedExecutionLogs([], hourlyLogs), 1);
});

test('branch-and-shift counters include completed and explicitly missed records only', () => {
  const branches = [{ id: 'b1', name: 'الفرع الأول' }];
  const logs = [
    { branch_id: 'b1', shift_type: 'Morning', status: 'completed' },
    { branch_id: 'b1', shift_type: 'Morning', status: 'pending' },
    { branch_id: 'b1', shift_type: 'Evening', status: 'غير منفذة' },
    { branch_id: 'b1', shift_type: 'Evening', status: 'NotPerformed' },
    { branch_id: 'b1', shift_type: 'Evening', status: 'done' },
  ];

  assert.deepEqual(metrics.summarizeExecutionCounts(logs, [], branches), [
    { branchId: 'b1', branchName: 'الفرع الأول', shiftType: 'Morning', completed: 1, notPerformed: 0 },
    { branchId: 'b1', branchName: 'الفرع الأول', shiftType: 'Evening', completed: 1, notPerformed: 2 },
  ]);
});

test('hourly counters show one branch row with both shifts and ignore ordinary checklist logs', () => {
  const branches = [
    { id: 'b1', name: 'الفرع الأول' },
    { id: 'b2', name: 'فرع بلا سجلات ساعية' },
  ];
  const hourlyLogs = [
    { branch_id: 'b1', shift_type: 'Morning', status: 'completed' },
    { branch_id: 'b1', shift_type: 'Evening', status: 'غير منفذة' },
    { branch_id: 'b1', shift_type: 'Evening', status: 'pending' },
  ];

  assert.deepEqual(metrics.summarizeHourlyExecutionCounts(hourlyLogs, branches), [
    { branchId: 'b1', branchName: 'الفرع الأول', shifts: {
      Morning: { completed: 1, notPerformed: 0 },
      Evening: { completed: 0, notPerformed: 1 },
    } },
    { branchId: 'b2', branchName: 'فرع بلا سجلات ساعية', shifts: {
      Morning: { completed: 0, notPerformed: 0 },
      Evening: { completed: 0, notPerformed: 0 },
    } },
  ]);
});

test('hourly counters aggregate both shifts independently of the selected-shift detail filter', () => {
  const branches = [{ id: 'b1', name: 'الفرع الأول' }];
  const hourlyLogs = [
    { branch_id: 'b1', shift_type: 'Morning', status: 'completed' },
    { branch_id: 'b1', shift_type: 'Evening', status: 'غير منفذة' },
  ];

  assert.deepEqual(metrics.summarizeHourlyExecutionCounts(hourlyLogs, branches), [
    { branchId: 'b1', branchName: 'الفرع الأول', shifts: {
      Morning: { completed: 1, notPerformed: 0 },
      Evening: { completed: 0, notPerformed: 1 },
    } },
  ]);
});

test('morning hourly counter excludes branch تجربة زام only; evening and other branches remain counted', () => {
  const branches = [{ id: 'trial', name: 'تجربة زام' }, { id: 'other', name: 'الفرع الآخر' }];
  const hourlyLogs = [
    ...Array.from({ length: 7 }, () => ({
      branch_id: 'trial', shift_type: 'Morning', status: 'not_performed', branches: { name: 'تجربة زام' },
    })),
    { branch_id: 'trial', shift_type: 'Morning', status: 'completed', branches: { name: 'تجربة زام' } },
    ...Array.from({ length: 7 }, () => ({
      branch_id: 'trial', shift_type: 'Evening', status: 'not_performed', branches: { name: 'تجربة زام' },
    })),
    { branch_id: 'other', shift_type: 'Morning', status: 'completed', branches: { name: 'الفرع الآخر' } },
  ];

  const rows = metrics.summarizeHourlyExecutionCounts(hourlyLogs, branches);
  assert.deepEqual(rows.find(row => row.branchId === 'trial').shifts, {
    Morning: { completed: 0, notPerformed: 0 },
    Evening: { completed: 0, notPerformed: 7 },
  });
  assert.deepEqual(rows.find(row => row.branchId === 'other').shifts.Morning, { completed: 1, notPerformed: 0 });
  assert.equal(hourlyLogs.length, 16, 'the counter does not modify or delete source records');
});

test('checklist-log view uses the hourly-only counter and a single completed-execution table', () => {
  assert.match(page, /checklist-log-metrics\.js\?v=\d+/);
  assert.match(page, /ZamChecklistLogMetrics\.summarizeHourlyExecutionCounts\(allHourlyLogs, hourlyTaskBranches\)/);
  assert.match(page, /ZamAPI\.getTemplates\(null, null, branch\.id\)/);
  assert.match(page, /isHourlyTemplateApplicableInBranch/);
  assert.match(page, /الوردية الصباحية[\s\S]*?الوردية المسائية/);
  assert.match(page, /const completedLogs = logs\.filter\(ZamChecklistLogMetrics\.isCompleted\)/);
  assert.match(page, /const hourlyCompletedLogs = hourlyLogs\.filter\(ZamChecklistLogMetrics\.isCompleted\)/);
  assert.match(page, /<tbody id="logs-table-tbody"[\s\S]*?<td colspan="9"/);
  assert.doesNotMatch(page, /countCompletedExecutionLogs\(logs, hourlyLogs\)/);
});

test('one failed checklist-log source does not block the other records or show false zero hourly counts', () => {
  const loader = page.match(/async function loadLogs\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(loader, /Promise\.allSettled\(/);
  assert.match(loader, /let logs = readArray\(readResults\[0\], 'logs'\)/);
  assert.match(loader, /let hourlyLogs = readArray\(readResults\[1\], 'hourlyLogs'\)/);
  assert.match(loader, /failedReads\.has\('hourlyLogs'\)[\s\S]*?لم تُعرض أرقام غير مؤكدة/);
  assert.match(loader, /executionReadsFailed[\s\S]*?تعذّر تحميل سجل التنفيذ/);
  assert.match(loader, /showChecklistLogsLoadStatus\([\s\S]*?retry: true/);
});
