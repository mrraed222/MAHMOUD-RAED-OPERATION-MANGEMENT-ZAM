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

test('checklist-log summary uses the shared status-aware counter', () => {
  assert.match(page, /checklist-log-metrics\.js\?v=\d+/);
  assert.match(page, /ZamChecklistLogMetrics\.countCompletedExecutionLogs\(logs, hourlyLogs\)/);
  assert.doesNotMatch(page, /stat-total-executed'\)\.textContent\s*=\s*logs\.length\s*\+\s*hourlyLogs\.length/);
});
