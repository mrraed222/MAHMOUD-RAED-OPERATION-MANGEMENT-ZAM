const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../assets/checklist-schedule.js');
const dashboard = require('../assets/checklist-dashboard.js');
const lifecycle = require('../assets/branch-lifecycle.js');

const now = new Date('2026-11-16T09:00:00+03:00'); // Monday morning, Riyadh
const multiBranchTask = {
  id: 'template-1',
  branch_id: 'branch-a',
  checklist_template_branches: [{ branch_id: 'branch-a' }, { branch_id: 'branch-b' }],
  task_title: 'فحص الطاولات',
  category: 'الصالة',
  shift_type: 'Morning',
  frequency: 'daily',
  is_active: true,
};

 test('template branch links are authoritative for employee scheduling', () => {
  const context = { role: 'Waiter', branchName: 'فرع تجريبي', categories: ['الصالة'], shiftType: 'Morning' };
  assert.equal(schedule.templateAppliesToBranch(multiBranchTask, 'branch-b'), true);
  assert.equal(schedule.isTemplateScheduledForEmployee(multiBranchTask, { ...context, branchId: 'branch-b' }, now), true);
  assert.equal(schedule.isTemplateScheduledForEmployee(multiBranchTask, { ...context, branchId: 'branch-c' }, now), false);
});

test('branch dashboard progress counts a linked template only in selected branches', () => {
  const inScope = dashboard.branchProgress({ templates: [multiBranchTask], branchId: 'branch-b', branchName: 'فرع ب', now });
  const outOfScope = dashboard.branchProgress({ templates: [multiBranchTask], branchId: 'branch-c', branchName: 'فرع ج', now });
  assert.equal(inScope.total, 1);
  assert.equal(outOfScope.total, 0);
});

test('supervisor inventory tasks honor multi-branch links rather than legacy branch_id', () => {
  const inventoryTask = {
    id: 'inventory-1', task_type: 'inventory_request', is_active: true,
    branch_id: 'branch-a', checklist_template_branches: [{ branch_id: 'branch-b' }],
    shift_type: 'Morning', frequency: 'daily',
  };
  assert.equal(dashboard.isSupervisorTaskVisible(inventoryTask, { branchId: 'branch-b', shiftType: 'Morning', now }), true);
  assert.equal(dashboard.isSupervisorTaskVisible(inventoryTask, { branchId: 'branch-c', shiftType: 'Morning', now }), false);
});

test('lifecycle gate excludes planned no-date and future-date branches, includes opening day in Riyadh', () => {
  const noDate = { lifecycle_status: 'planned', planned_opening_date: null };
  const future = { lifecycle_status: 'planned', planned_opening_date: '2026-11-17' };
  const opening = { lifecycle_status: 'planned', planned_opening_date: '2026-11-17' };
  const beforeRiyadhMidnight = new Date('2026-11-16T20:59:59.000Z');
  const atRiyadhMidnight = new Date('2026-11-16T21:00:00.000Z');
  assert.equal(lifecycle.isOperational(noDate, now), false);
  assert.equal(lifecycle.isOperational(future, '2026-11-16'), false);
  assert.equal(lifecycle.isOperational(opening, beforeRiyadhMidnight), false);
  assert.equal(lifecycle.isOperational(opening, atRiyadhMidnight), true);
  assert.equal(lifecycle.isOperational({ lifecycle_status: null }, now), true);
});
