import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildChecklistShiftSummary,
  buildPendingEmployeeTasks,
  escapeHtml,
  isChecklistComplete,
  isBranchOperational,
  isScheduledChecklistTask,
  scheduledDateForTime,
  templateAppliesToBranch,
  timeMatches,
} from '../supabase-functions/run-scheduled-automations/automation-helpers.mjs';

const branchId = 'branch-1';
const date = '2026-11-16'; // Monday
const baseTask = (overrides = {}) => ({
  id: 'task-1',
  category: 'الصالة',
  task_title: 'فحص الطاولات',
  branch_id: branchId,
  shift_type: 'Morning',
  frequency: 'daily',
  is_active: true,
  ...overrides,
});

test('daily, archived, hourly and inventory-request templates are classified safely', () => {
  assert.equal(isScheduledChecklistTask(baseTask(), new Date('2026-11-16T09:00:00+03:00')), true);
  assert.equal(isScheduledChecklistTask(baseTask({ is_active: false })), false);
  assert.equal(isScheduledChecklistTask(baseTask({ active: false })), false);
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'hourly' })), false);
  assert.equal(isScheduledChecklistTask(baseTask({ task_type: 'inventory_request' })), false);
  assert.equal(isScheduledChecklistTask(baseTask({ task_type: 'inventory_count' })), false);
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'unknown' })), false);
});

test('weekly and monthly due dates use Riyadh calendar days, including month-end clamping', () => {
  const mondayEarlyRiyadh = new Date('2026-11-15T21:30:00.000Z');
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'weekly', day_of_week: 1 }), mondayEarlyRiyadh), true);
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'weekly', day_of_week: 0 }), mondayEarlyRiyadh), false);
  const november30Riyadh = new Date('2026-11-29T21:30:00.000Z');
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'monthly', day_of_month: 31 }), november30Riyadh), true);
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'monthly', day_of_month: 30 }), november30Riyadh), true);
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'monthly', day_of_month: 29 }), november30Riyadh), false);
});

test('weekly recurrence supports multiple selected days and falls back to legacy day_of_week', () => {
  const mondayRiyadh = new Date('2026-11-15T21:30:00.000Z');
  const wednesdayRiyadh = new Date('2026-11-17T21:30:00.000Z');
  const tuesdayRiyadh = new Date('2026-11-16T21:30:00.000Z');
  const multiDay = baseTask({ frequency: 'weekly', days_of_week: [1, 3], day_of_week: 6 });

  assert.equal(isScheduledChecklistTask(multiDay, mondayRiyadh), true);
  assert.equal(isScheduledChecklistTask(multiDay, wednesdayRiyadh), true);
  assert.equal(isScheduledChecklistTask(multiDay, tuesdayRiyadh), false);
  assert.equal(isScheduledChecklistTask(baseTask({ frequency: 'weekly', days_of_week: [], day_of_week: 1 }), mondayRiyadh), true);
});

test('scheduled time matching handles post-midnight grace without running next-day schedules early', () => {
  const atLocalTime = (hour, minute) => {
    const current = new Date(0);
    current.setHours(hour, minute, 0, 0);
    return current;
  };

  assert.equal(timeMatches('23:58:00', atLocalTime(0, 3)), true);
  assert.equal(timeMatches('00:05', atLocalTime(0, 0)), true);
  assert.equal(timeMatches('00:05', atLocalTime(23, 59)), false);
  assert.equal(timeMatches('23:45', atLocalTime(0, 1)), false);
  assert.equal(timeMatches('25:00', atLocalTime(1, 0)), false);
  assert.equal(scheduledDateForTime('23:58', atLocalTime(0, 3), '2026-11-25'), '2026-11-24');
  assert.equal(scheduledDateForTime('00:05', atLocalTime(0, 3), '2026-11-25'), '2026-11-25');

  const firstRunOccurrence = scheduledDateForTime('23:58', atLocalTime(23, 58), '2026-11-24');
  const retryOccurrence = scheduledDateForTime('23:58', atLocalTime(0, 3), '2026-11-25');
  assert.equal(firstRunOccurrence, '2026-11-24');
  assert.equal(retryOccurrence, firstRunOccurrence, 'the 00:03 retry must reuse the prior date as its dedupe key');
});

test('summary splits Both tasks by shift and counts only matching completed logs', () => {
  const tasks = [
    baseTask({ id: 'morning', frequency: 'daily' }),
    baseTask({ id: 'both', category: 'البار', shift_type: 'Both' }),
    baseTask({ id: 'hourly', category: 'الصالة', frequency: 'hourly' }),
    baseTask({ id: 'archived', category: 'الصالة', is_active: false }),
  ];
  const logs = [
    { template_id: 'morning', branch_id: branchId, execution_date: date, shift_type: 'Morning', status: 'Completed' },
    { template_id: 'both', branch_id: branchId, execution_date: date, shift_type: 'Morning', status: 'مكتمل' },
    { template_id: 'both', branch_id: branchId, execution_date: date, shift_type: 'Evening', status: 'flagged' },
    { template_id: 'morning', branch_id: branchId, execution_date: date, shift_type: 'Evening', status: 'Completed' },
  ];
  assert.deepEqual(buildChecklistShiftSummary(tasks, logs, { branchId, shiftType: 'Morning', date }), [
    { category: 'البار', total: 1, done: 1 },
    { category: 'الصالة', total: 1, done: 1 },
  ]);
  assert.deepEqual(buildChecklistShiftSummary(tasks, logs, { branchId, shiftType: 'Evening', date }), [
    { category: 'البار', total: 1, done: 0 },
  ]);
});

test('pending tasks require the employee, branch, shift, category and a completed matching occurrence', () => {
  const tasks = [
    baseTask({ id: 'done' }),
    baseTask({ id: 'pending' }),
    baseTask({ id: 'evening', shift_type: 'Evening' }),
    baseTask({ id: 'hourly', frequency: 'hourly' }),
    baseTask({ id: 'other-branch', branch_id: 'branch-2' }),
    baseTask({ id: 'other-category', category: 'البار' }),
  ];
  const employee = { id: 'waiter-1', role: 'Waiter', shift_type: 'Morning' };
  const logs = [
    { template_id: 'done', branch_id: branchId, execution_date: date, shift_type: 'Morning', executed_by: employee.id, status: 'done' },
    { template_id: 'pending', branch_id: branchId, execution_date: date, shift_type: 'Morning', executed_by: employee.id, status: 'flagged' },
    { template_id: 'pending', branch_id: branchId, execution_date: date, shift_type: 'Morning', executed_by: 'someone-else', status: 'completed' },
  ];
  const pending = buildPendingEmployeeTasks(tasks, logs, employee, { branchId, date });
  assert.deepEqual(pending.map(row => row.task.id), ['pending']);
  assert.equal(pending[0].shiftType, 'Morning');
  assert.deepEqual(buildPendingEmployeeTasks([tasks.find(task => task.id === 'other-branch')], logs, employee, { branchId, date }), []);
});

test('Both-shift employees see separate occurrences; a morning completion does not close evening', () => {
  const task = baseTask({ shift_type: 'Both' });
  const employee = { id: 'waiter-2', role: 'Waiter', shift_type: 'Both' };
  const logs = [{ template_id: task.id, branch_id: branchId, execution_date: date, shift_type: 'Morning', executed_by: employee.id, status: 'completed' }];
  assert.deepEqual(buildPendingEmployeeTasks([task], logs, employee, { branchId, date }).map(row => row.shiftType), ['Evening']);
});

test('legacy no-shift logs do not close a Both-shift task twice', () => {
  const task = baseTask({ shift_type: 'Both' });
  const employee = { id: 'waiter-3', role: 'Waiter', shift_type: 'Both' };
  const legacyLog = { template_id: task.id, branch_id: branchId, execution_date: date, shift_type: null, executed_by: employee.id, status: 'completed' };
  assert.deepEqual(buildPendingEmployeeTasks([task], [legacyLog], employee, { branchId, date }).map(row => row.shiftType), ['Morning', 'Evening']);
});

test('status matching is case-insensitive and HTML output escapes untrusted text', () => {
  assert.equal(isChecklistComplete('Completed'), true);
  assert.equal(isChecklistComplete('flagged'), false);
  assert.equal(escapeHtml(`<a title="x">O'Reilly & Co</a>`), '&lt;a title=&quot;x&quot;&gt;O&#39;Reilly &amp; Co&lt;/a&gt;');
});

test('scheduled email escapes supervisor names and target times before HTML interpolation', () => {
  const source = readFileSync(new URL('../supabase-functions/run-scheduled-automations/index.ts', import.meta.url), 'utf8');
  assert.match(source, /escapeHtml\(sup\.full_name \|\| ''\)/);
  assert.match(source, /escapeHtml\(String\(t\.target_time\)\.slice\(0, 5\)\)/);
  assert.match(source, /escapeHtml\(String\(t\)\.slice\(0, 5\)\)/);
});

test('planned branches stay out of automation until lifecycle status is explicitly operational', () => {
  const planned = { lifecycle_status: 'planned', planned_opening_date: null };
  assert.equal(isBranchOperational(planned, date), false);
  planned.planned_opening_date = '2026-11-18';
  assert.equal(isBranchOperational(planned, '2026-11-17'), false);
  assert.equal(isBranchOperational(planned, '2026-11-18'), false);
  assert.equal(isBranchOperational({ lifecycle_status: 'planned', planned_opening_date: '2020-01-01' }, date), false);
  assert.equal(isBranchOperational({ lifecycle_status: null }, date), true);
  assert.equal(isBranchOperational({ lifecycle_status: 'operational' }, date), true);
});

test('scheduled worker applies lifecycle gating to task reminders, reports and branch-scoped schedules', () => {
  const source = readFileSync(new URL('../supabase-functions/run-scheduled-automations/index.ts', import.meta.url), 'utf8');
  assert.match(source, /import\s+\{[^}]*isBranchOperational[^}]*\}/s);
  assert.match(source, /const isBranchActive = \(branchId: string \| null\) => isBranchOperational\(branchById\.get\(branchId\), today\)/);
  assert.match(source, /const operationalBranches = branches\.filter\(\(branch: any\) => isBranchOperational\(branch, today\)\)/);
  assert.match(source, /operationalBranchIds\.has\(report\.branch_id\)/);
  assert.match(source, /if \(sch\.branch_id && !isBranchActive\(sch\.branch_id\)\) continue/);
  assert.match(source, /isBranchActive\(p\.branch_id\)/);
});

test('multi-branch template links override legacy branch_id; unlinked templates remain global', () => {
  const linked = baseTask({
    branch_id: 'branch-1',
    checklist_template_branches: [{ branch_id: 'branch-1' }, { branch_id: 'branch-2' }],
  });
  const global = baseTask({ id: 'global', branch_id: null, checklist_template_branches: [] });
  assert.equal(templateAppliesToBranch(linked, 'branch-1'), true);
  assert.equal(templateAppliesToBranch(linked, 'branch-2'), true);
  assert.equal(templateAppliesToBranch(linked, 'branch-3'), false);
  assert.equal(templateAppliesToBranch(global, 'branch-2'), true);
  assert.equal(buildPendingEmployeeTasks([linked], [], { id: 'waiter-2', role: 'Waiter', shift_type: 'Morning' }, { branchId: 'branch-2', date })[0].task.id, linked.id);
});
