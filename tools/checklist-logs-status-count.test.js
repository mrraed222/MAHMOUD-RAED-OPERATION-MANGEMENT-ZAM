const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const metrics = require('../assets/checklist-log-metrics.js');
const schedule = require('../assets/checklist-schedule.js');
const TRIAL_BRANCH_ID = 'dcec5c36-e55f-4b4f-9498-ff4651d9e1ff';

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
    { id: 'b2', name: 'فرع لديه مهام ساعية بلا سجلات' },
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
    { branchId: 'b2', branchName: 'فرع لديه مهام ساعية بلا سجلات', shifts: {
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

test('morning hourly counter excludes تجربة زام by branch id only; evening and same-name branches remain counted', () => {
  const branches = [
    { id: TRIAL_BRANCH_ID, name: 'تجربة زام' },
    { id: 'other', name: 'الفرع الآخر' },
    { id: 'renamed-trial', name: 'تجربة زام' },
  ];
  const hourlyLogs = [
    ...Array.from({ length: 7 }, () => ({
      branch_id: TRIAL_BRANCH_ID, shift_type: 'Morning', status: 'not_performed', branches: { name: 'تجربة زام' },
    })),
    { branch_id: TRIAL_BRANCH_ID, shift_type: 'Morning', status: 'completed', branches: { name: 'تجربة زام' } },
    ...Array.from({ length: 7 }, () => ({
      branch_id: TRIAL_BRANCH_ID, shift_type: 'Evening', status: 'not_performed', branches: { name: 'تجربة زام' },
    })),
    { branch_id: 'other', shift_type: 'Morning', status: 'completed', branches: { name: 'الفرع الآخر' } },
    { branch_id: 'renamed-trial', shift_type: 'Morning', status: 'completed', branches: { name: 'تجربة زام' } },
  ];

  const rows = metrics.summarizeHourlyExecutionCounts(hourlyLogs, branches);
  assert.deepEqual(rows.find(row => row.branchId === TRIAL_BRANCH_ID).shifts, {
    Morning: { completed: 0, notPerformed: 0 },
    Evening: { completed: 0, notPerformed: 7 },
  });
  assert.deepEqual(rows.find(row => row.branchId === 'other').shifts.Morning, { completed: 1, notPerformed: 0 });
  assert.deepEqual(rows.find(row => row.branchId === 'renamed-trial').shifts.Morning, { completed: 1, notPerformed: 0 },
    'a different branch with the same displayed name is not excluded');
  assert.equal(hourlyLogs.length, 17, 'the counter does not modify or delete source records');
});

test('morning hourly counter resolves تجربة زام from branch_id when the joined branch name is absent', () => {
  const branches = [{ id: TRIAL_BRANCH_ID, name: 'تجربة زام' }, { id: 'other', name: 'الفرع الآخر' }];
  const hourlyLogs = [
    ...Array.from({ length: 8 }, () => ({ branch_id: TRIAL_BRANCH_ID, shift_type: 'Morning', status: 'not_performed' })),
    ...Array.from({ length: 8 }, () => ({ branch_id: TRIAL_BRANCH_ID, shift_type: 'Evening', status: 'not_performed' })),
    { branch_id: 'other', shift_type: 'Morning', status: 'not_performed' },
  ];
  const originalHourlyLogs = JSON.parse(JSON.stringify(hourlyLogs));
  const rows = metrics.summarizeHourlyExecutionCounts(hourlyLogs, branches);
  assert.deepEqual(rows.find(row => row.branchId === TRIAL_BRANCH_ID).shifts, {
    Morning: { completed: 0, notPerformed: 0 },
    Evening: { completed: 0, notPerformed: 8 },
  });
  assert.deepEqual(rows.find(row => row.branchId === 'other').shifts.Morning, { completed: 0, notPerformed: 1 });
  assert.deepEqual(hourlyLogs, originalHourlyLogs, 'counting does not modify execution records');
});

test('branches without an applicable hourly template do not get a summary card', () => {
  const branches = [{ id: 'ordinary-only', name: 'فرع بلا مهام ساعية' }];
  const templatesByBranch = new Map([['ordinary-only', [{ id: 'cleaning', frequency: 'daily', task_type: 'cleaning' }]]]);
  const hourlyTaskBranches = branches.filter(branch => (templatesByBranch.get(branch.id) || []).some(task =>
    schedule.isHourlyTemplateApplicableInBranch(task, { branchId: branch.id, branchName: branch.name })
  ));

  assert.deepEqual(hourlyTaskBranches, []);
  assert.deepEqual(metrics.summarizeHourlyExecutionCounts([], hourlyTaskBranches), []);
  assert.match(page, /summarizeHourlyExecutionCounts\(allHourlyLogs, hourlyTaskBranches\)/,
    'the UI passes only branches with an applicable hourly template to the counter');
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

test('checklist-log view exposes a three-way task filter and accessible colored table headers', () => {
  assert.match(page, /<label for="f-task-type"[^>]*>نوع المهام في الجدول<\/label>/);
  assert.match(page, /<option value="hourly">المهام الساعية فقط<\/option>/);
  assert.match(page, /<option value="non-hourly">المهام غير الساعية فقط<\/option>/);
  assert.match(page, /<option value="all">كلا النوعين<\/option>/);
  assert.match(page, /checklist-task-type-header" scope="col">نوع السجل/);
  assert.match(page, /background:#16392f!important;color:#fff!important/);
  assert.match(page, /@container \(max-width:620px\)/);
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
