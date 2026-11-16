const test = require('node:test');
const assert = require('node:assert/strict');
const dashboard = require('../assets/checklist-dashboard.js');

const branchId = 'branch-1';
const now = new Date('2026-11-16T06:30:00.000Z'); // 09:30 in Riyadh, Monday
const staff = [
  { id: 'waiter-m', branch_id: branchId, role: 'Waiter', shift_type: 'Morning' },
  { id: 'waiter-e', branch_id: branchId, role: 'Waiter', shift_type: 'Evening' },
];
const task = (id, shift_type, overrides = {}) => ({
  id, branch_id: branchId, category: 'الصالة', shift_type, task_type: 'standard',
  frequency: 'daily', is_active: true, ...overrides,
});

test('branch progress counts due staff tasks once per shift and counts only completed matching logs', () => {
  const templates = [
    task('morning', 'Morning'),
    task('both', 'Both'),
    task('hourly', 'Both', { task_type: 'restroom_check', frequency: 'hourly' }),
    task('not-due-weekly', 'Both', { frequency: 'weekly', day_of_week: 2 }),
    task('archived', 'Both', { is_active: false }),
    task('other-branch', 'Both', { branch_id: 'branch-2' }),
  ];
  const logs = [
    { template_id: 'morning', branch_id: branchId, execution_date: '2026-11-16', shift_type: 'Morning', status: 'Completed' },
    { template_id: 'both', branch_id: branchId, execution_date: '2026-11-16', shift_type: 'Morning', status: 'completed' },
    { template_id: 'both', branch_id: branchId, execution_date: '2026-11-16', shift_type: 'Evening', status: 'flagged' },
  ];
  const hourlyLogs = [
    { template_id: 'hourly', branch_id: branchId, execution_date: '2026-11-16', occurrence_hour: 9, shift_type: 'Morning', status: 'completed' },
  ];
  const progress = dashboard.branchProgress({ templates, staff, branchId, branchName: 'زام الرئيسي', logs, hourlyLogs, now });
  assert.deepEqual(progress, {
    total: 5, done: 3, pct: 60,
    byShift: { Morning: { total: 3, done: 3 }, Evening: { total: 2, done: 0 } },
  });
});

test('branch with no tasks reports no percentage instead of a misleading zero', () => {
  const progress = dashboard.branchProgress({
    templates: [task('wrong-branch', 'Morning', { branch_id: 'branch-2' })],
    staff, branchId, branchName: 'زام الحي', logs: [], hourlyLogs: [], now,
  });
  assert.deepEqual(progress, {
    total: 0, done: 0, pct: null,
    byShift: { Morning: { total: 0, done: 0 }, Evening: { total: 0, done: 0 } },
  });
});

test('branch progress includes only assigned categories and respects branch staffing rules', () => {
  const progress = dashboard.branchProgress({
    templates: [
      task('lounge', 'Both'),
      task('bar', 'Both', { category: 'البار' }),
      task('restroom-hay', 'Morning', { category: 'الصالة', task_type: 'restroom_check' }),
    ],
    staff: [
      { id: 'waiter', branch_id: branchId, role: 'Waiter', shift_type: 'Morning' },
      { id: 'barista', branch_id: branchId, role: 'Barista', shift_type: 'Morning' },
    ],
    branchId, branchName: 'زام الحي', logs: [], hourlyLogs: [], now,
  });
  assert.equal(progress.byShift.Morning.total, 2); // lounge + bar; Al-Hay restroom tasks are suppressed
  assert.equal(progress.byShift.Evening.total, 0); // no evening staffing
});
