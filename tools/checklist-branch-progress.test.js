const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dashboard = require('../assets/checklist-dashboard.js');
const schedule = require('../assets/checklist-schedule.js');

const branchId = 'branch-1';
const now = new Date('2026-11-16T06:30:00.000Z'); // 09:30 in Riyadh, Monday
const task = (id, shift_type, overrides = {}) => ({
  id, branch_id: branchId, category: 'الصالة', shift_type, task_type: 'standard',
  frequency: 'daily', is_active: true, ...overrides,
});

test('branch progress deduplicates logs, separates Both shifts, and never presents hourly templates as a total percentage', () => {
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
    { template_id: 'morning', branch_id: branchId, execution_date: '2026-11-16', shift_type: 'Morning', status: 'done' },
    { template_id: 'both', branch_id: branchId, execution_date: '2026-11-16', shift_type: 'Morning', status: 'completed' },
    { template_id: 'both', branch_id: branchId, execution_date: '2026-11-16', shift_type: 'Evening', status: 'flagged' },
  ];
  const progress = dashboard.branchProgress({ templates, staff: [], branchId, branchName: 'زام الرئيسي', logs, hourlyLogs: [], now });
  assert.deepEqual(progress, {
    total: 3, done: 2, pct: null, nonHourlyPct: 67,
    hourlyTemplateCount: 1, hourlyShiftPairs: 2, incompleteHourly: true,
    byShift: {
      Morning: { total: 2, done: 2, hourlyTemplates: 1 },
      Evening: { total: 1, done: 0, hourlyTemplates: 1 },
    },
  });
});

test('owner and admin viewers choose the current Riyadh shift independent of profile assignment', () => {
  const morningNow = new Date('2026-11-16T11:00:00.000Z'); // 14:00 in Riyadh
  const eveningNow = new Date('2026-11-16T13:00:00.000Z'); // 16:00 in Riyadh
  const afterMidnight = new Date('2026-11-16T21:30:00.000Z'); // 00:30 in Riyadh, still the prior evening shift
  assert.equal(dashboard.initialDashboardShift({ role: 'Owner', shift_type: 'Morning' }, eveningNow), 'Evening');
  assert.equal(dashboard.initialDashboardShift({ role: 'Admin', shift_type: 'Evening' }, morningNow), 'Morning');
  assert.equal(dashboard.initialDashboardShift({ role: 'Owner' }, afterMidnight), 'Evening');
  assert.equal(dashboard.initialDashboardShift({ role: 'Admin' }, new Date('2026-11-17T01:00:00.000Z')), 'Morning');
  assert.equal(dashboard.canSelectDashboardShift({ role: 'Owner', shift_type: 'Morning' }), true);
  assert.equal(dashboard.canSelectDashboardShift({ role: 'Admin', shift_type: 'Evening' }), true);
  assert.equal(dashboard.canSelectDashboardShift({ role: 'Manager', shift_type: 'Morning' }), true);
  assert.equal(dashboard.canSelectDashboardShift({ role: 'Supervisor', shift_type: 'Both' }), true);
  assert.equal(dashboard.canSelectDashboardShift({ role: 'Supervisor', shift_type: 'Morning' }), false);

  const eveningTasks = dashboard.dashboardTasks({
    templates: [task('morning', 'Morning'), task('evening', 'Evening')],
    staff: [], branchId, branchName: 'زام الرئيسي', shiftType: 'Evening', currentUserRole: 'Owner', now: eveningNow,
  });
  assert.deepEqual(eveningTasks.map(item => item.id), ['evening']);
  assert.equal(dashboard.completedTaskKeys(eveningTasks, [], [], { branchId, shiftType: 'Evening', now: eveningNow }).size, 0,
    'due tasks remain visible and the completion numerator stays zero when there are no execution logs');
  const overnightTask = dashboard.dashboardTasks({
    templates: [task('overnight-evening', 'Evening')], staff: [], branchId, branchName: 'زام الرئيسي',
    branchHours: { opening_time: '05:30:00', closing_time: '02:30:00' }, shiftType: 'Evening',
    currentUserRole: 'Owner', now: afterMidnight,
  });
  assert.deepEqual(overnightTask.map(item => item.id), ['overnight-evening']);
  assert.equal(dashboard.completedTaskKeys(overnightTask, [], [], {
    branchId, branchHours: { opening_time: '05:30:00', closing_time: '02:30:00' }, shiftType: 'Evening', now: afterMidnight,
  }).size, 0);

  const page = fs.readFileSync(path.join(__dirname, '..', 'supervisor-dashboard', 'index.html'), 'utf8');
  assert.match(page, /initialDashboardShift\(currentUser\)/);
  assert.match(page, /canSelectDashboardShift\(currentUser\)/);
  assert.match(page, /!\['Supervisor', 'Manager'\]\.includes\(currentUser\.role\) && !canBrowseRequestedBranch/,
    'the existing branch-view role gate must remain unchanged');
});

test('branch dashboard task totals do not disappear when no active employee profile is present', () => {
  const visible = dashboard.dashboardTasks({
    templates: [
      task('morning', 'Morning'),
      task('both', 'Both'),
      task('not-due-weekly', 'Morning', { frequency: 'weekly', day_of_week: 2 }),
    ],
    staff: [], branchId, branchName: 'زام الرئيسي', shiftType: 'Morning', currentUserRole: 'Manager', now,
  });
  assert.deepEqual(visible.map(item => item.id), ['morning', 'both']);

  const page = fs.readFileSync(path.join(__dirname, '..', 'supervisor-dashboard', 'index.html'), 'utf8');
  assert.match(page, /const shiftTemplates = ZamChecklistDashboard\.dashboardTasks\(/);
  assert.match(page, /const totalTasks = shiftTemplates\.length/);
});

test('branch with no applicable templates reports no percentage instead of a misleading zero', () => {
  const progress = dashboard.branchProgress({
    templates: [task('wrong-branch', 'Morning', { branch_id: 'branch-2' })],
    staff: [], branchId, branchName: 'زام الحي', logs: [], hourlyLogs: [], now,
  });
  assert.deepEqual(progress, {
    total: 0, done: 0, pct: null, nonHourlyPct: null,
    hourlyTemplateCount: 0, hourlyShiftPairs: 0, incompleteHourly: false,
    byShift: {
      Morning: { total: 0, done: 0, hourlyTemplates: 0 },
      Evening: { total: 0, done: 0, hourlyTemplates: 0 },
    },
  });
});

test('branch applicable templates remain visible without employee profiles and branch facility exceptions still apply', () => {
  const progress = dashboard.branchProgress({
    templates: [
      task('lounge', 'Both'),
      task('bar', 'Both', { category: 'البار' }),
      task('restroom-hay', 'Morning', { category: 'الصالة', task_type: 'restroom_check' }),
    ],
    staff: [], // missing profiles do not erase branch-level expected work
    branchId, branchName: 'زام الحي', logs: [], hourlyLogs: [], now,
  });
  assert.equal(progress.byShift.Morning.total, 2); // lounge + bar; Al-Hay restroom tasks are suppressed
  assert.equal(progress.byShift.Evening.total, 2); // both-shift templates remain visible without evening profiles
  assert.equal(progress.total, 4);
  assert.equal(progress.pct, 0);
  assert.equal(progress.incompleteHourly, false);
});

test('evening shift legacy logs without created_at use the prior Riyadh business date after midnight', () => {
  const afterMidnight = new Date('2026-11-16T21:30:00.000Z'); // 00:30 Tuesday in Riyadh
  const window = schedule.getShiftWindow('Evening', {}, afterMidnight);
  assert.equal(window.businessDate, '2026-11-16');
  assert.equal(dashboard.logInsideShift({ execution_date: '2026-11-16' }, 'Evening', {}, afterMidnight), true);
  assert.equal(dashboard.logInsideShift({ execution_date: '2026-11-17' }, 'Evening', {}, afterMidnight), false);
});

test('checklist pages collapse each category and place weekly lists after routine tasks', () => {
  const employeePage = fs.readFileSync(path.join(__dirname, '..', 'my-checklist', 'index.html'), 'utf8');
  const supervisorPage = fs.readFileSync(path.join(__dirname, '..', 'supervisor-checklist', 'index.html'), 'utf8');
  assert.match(employeePage, /<details class="checklist-category/);
  assert.ok(employeePage.indexOf('مهام اليوم والمهام الأخرى') < employeePage.indexOf('القائمة الأسبوعية'));
  assert.match(supervisorPage, /<details class="mb-sm overflow-hidden rounded-2xl/);
  assert.ok(supervisorPage.indexOf('مهام الوردية') < supervisorPage.indexOf('القائمة الأسبوعية'));
});
