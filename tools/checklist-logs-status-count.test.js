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
    { branch_id: 'b1', shift_type: 'Evening', status: 'done' },
  ];

  assert.deepEqual(metrics.summarizeExecutionCounts(logs, [], branches), [
    { branchId: 'b1', branchName: 'الفرع الأول', shiftType: 'Morning', completed: 1, notPerformed: 0 },
    { branchId: 'b1', branchName: 'الفرع الأول', shiftType: 'Evening', completed: 1, notPerformed: 1 },
  ]);
});

test('checklist-log view uses the shared status-aware counter and completed-only hourly rows', () => {
  assert.match(page, /checklist-log-metrics\.js\?v=\d+/);
  assert.match(page, /ZamChecklistLogMetrics\.countCompletedExecutionLogs\(logs, hourlyLogs\)/);
  assert.match(page, /summarizeExecutionCounts/);
  assert.match(page, /hourlyCompletedLogs/);
  assert.doesNotMatch(page, /stat-total-executed'\)\.textContent\s*=\s*logs\.length\s*\+\s*hourlyLogs\.length/);
});
