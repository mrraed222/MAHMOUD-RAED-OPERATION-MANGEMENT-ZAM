const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../assets/checklist-schedule.js');
const dashboard = require('../assets/checklist-dashboard.js');
const fs = require('node:fs');
const path = require('node:path');

const branchHours = { opening_time: '05:30:00', closing_time: '02:30:00' };
const morningCount = {
  id: 'morning-count', task_type: 'inventory_count', category: 'مهام المشرفين',
  branch_id: null, checklist_template_branches: [], shift_type: 'Morning',
  frequency: 'daily', target_time: '12:00:00', is_active: true,
};
const eveningCount = {
  ...morningCount, id: 'evening-count', shift_type: 'Evening', target_time: '00:00:00',
};

test('morning inventory count is hidden until noon Riyadh time and supervisor-only', () => {
  const beforeNoon = new Date('2026-11-16T08:59:00.000Z'); // 11:59 in Riyadh
  const atNoon = new Date('2026-11-16T09:00:00.000Z'); // 12:00 in Riyadh
  const employee = {
    role: 'Barista', branchId: 'branch-a', branchName: 'زام الرئيسي',
    categories: ['البار'], shiftType: 'Morning', branchHours,
  };

  assert.equal(schedule.isSupervisorOnlyTask(morningCount), true);
  assert.equal(schedule.isTemplateVisibleForEmployee(morningCount, employee, atNoon), false);
  assert.equal(schedule.isTemplateVisibleInBranch(morningCount, {
    branchId: 'branch-a', branchName: 'زام الرئيسي', shiftType: 'Morning', branchHours,
  }, atNoon), false);
  assert.equal(schedule.isInventoryTaskVisible(morningCount, beforeNoon, branchHours, 'Morning'), false);
  assert.equal(schedule.isInventoryTaskVisible(morningCount, atNoon, branchHours, 'Morning'), true);
  assert.equal(dashboard.dashboardTasks({
    templates: [morningCount], staff: [], branchId: 'branch-a', branchName: 'زام الرئيسي',
    branchHours, shiftType: 'Morning', currentUserRole: 'Supervisor', now: atNoon,
  }).some(task => task.id === morningCount.id), true);
  assert.equal(dashboard.dashboardTasks({
    templates: [morningCount], staff: [], branchId: 'branch-a', branchName: 'زام الرئيسي',
    branchHours, shiftType: 'Morning', currentUserRole: 'Manager', now: atNoon,
  }).some(task => task.id === morningCount.id), false);
});

test('evening inventory count appears at midnight in the cross-midnight Riyadh shift', () => {
  const beforeMidnight = new Date('2026-11-16T20:59:00.000Z'); // 23:59 in Riyadh
  const atMidnight = new Date('2026-11-16T21:00:00.000Z'); // 00:00 in Riyadh
  const supervisorContext = {
    branchId: 'branch-a', branchHours, shiftType: 'Evening',
  };

  assert.equal(schedule.isInventoryTaskVisible(eveningCount, beforeMidnight, branchHours, 'Evening'), false);
  assert.equal(schedule.isInventoryTaskVisible(eveningCount, atMidnight, branchHours, 'Evening'), true);
  assert.equal(dashboard.isSupervisorTaskVisible(eveningCount, { ...supervisorContext, now: atMidnight }), true);
  assert.equal(dashboard.dashboardTasks({
    templates: [eveningCount], staff: [], branchId: 'branch-a', branchName: 'زام الرئيسي',
    branchHours, shiftType: 'Evening', currentUserRole: 'Supervisor', now: atMidnight,
  }).some(task => task.id === eveningCount.id), true);
});

test('migration is scoped to the seven reviewed count templates and the three espresso shifts', () => {
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261117203400_inventory_count_supervisor_only.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const expectedIds = [
    '1358cd34-524d-4afb-93fc-c1be55c52e88',
    'd509f6e0-0529-4eb7-87ef-93c0807285e9',
    '249f03e8-b822-4771-a56c-3239e9abda01',
    '175f2437-f2fa-4259-a2b7-0a8c5c783371',
    'eac7da7c-4218-4c8c-bfe2-2b7c97026ffd',
    '530d8f87-0ed8-449e-9b91-0ca07bf55856',
    '4265d8ba-e70b-488e-823d-5167565e1ce2',
    '64d373a0-3bab-4ec7-9d23-b31a0f311d45',
    'b7d39580-0ffa-4d41-8ea0-f3aa3b863f2c',
    'c1be4246-5188-405b-9b85-868743a0dbc6',
  ];
  for (const id of expectedIds) assert.ok(migration.includes(id), `missing expected ID ${id}`);
  assert.match(migration, /task_type\s*=\s*'inventory_count'/);
  assert.match(migration, /category\s*=\s*'مهام المشرفين'/);
  assert.match(migration, /12:00/);
  assert.match(migration, /00:00/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS checklist_templates_task_type_check/);
  assert.doesNotMatch(migration, /DELETE FROM|UPDATE public\.branches|UPDATE public\.checklist_template_branches/);
});

test('server-side RLS keeps inventory counts Supervisor-only and preserves inventory-request roles', () => {
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261122190000_riwaq_assignments_scopes_quality.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.can_employee_execute_checklist_template(');
  assert.notEqual(functionStart, -1, 'server-side checklist execution function should exist');
  const nextFunction = migration.indexOf('\nCREATE OR REPLACE FUNCTION public.', functionStart + 1);
  const execution = migration.slice(functionStart, nextFunction < 0 ? undefined : nextFunction);

  const countRuleStart = execution.indexOf("COALESCE(t.task_type, 'standard') = 'inventory_count'");
  const requestRuleStart = execution.indexOf("COALESCE(t.task_type, 'standard') = 'inventory_request'");
  const standardRuleStart = execution.indexOf("COALESCE(t.task_type, 'standard') NOT IN ('inventory_request', 'inventory_count')");
  assert.ok(countRuleStart >= 0, 'inventory_count must have its own server-side role rule');
  assert.ok(requestRuleStart > countRuleStart, 'inventory_request must remain a separate rule');
  assert.ok(standardRuleStart > requestRuleStart, 'standard tasks must remain a separate rule');

  const countRule = execution.slice(countRuleStart, requestRuleStart);
  assert.match(countRule, /p\.role = 'Supervisor'/);
  assert.doesNotMatch(countRule, /p\.role\s+IN\s*\(/, 'inventory_count must not accept a multi-role allowlist');
  assert.doesNotMatch(countRule, /'Owner'|'Admin'/, 'Owner and Admin must be denied inventory_count');
  const requestRule = execution.slice(requestRuleStart, standardRuleStart);
  assert.match(requestRule, /p\.role IN \('Owner', 'Admin', 'Supervisor'\)/);

  const policyStart = migration.indexOf('CREATE POLICY "Users can create own logs"');
  const policyEnd = migration.indexOf('\n-- Explicit Manager report scopes', policyStart);
  assert.ok(policyStart >= 0 && policyEnd > policyStart, 'checklist-log INSERT policy should exist');
  const insertPolicy = migration.slice(policyStart, policyEnd);
  assert.match(insertPolicy, /FOR INSERT TO authenticated/);
  assert.match(insertPolicy, /public\.can_employee_execute_checklist_template\(template_id, branch_id, shift_type\)/);

  const updateStart = migration.indexOf('CREATE POLICY "Users can update own logs"');
  assert.ok(updateStart >= 0, 'checklist-log UPDATE policy should be recreated with server authorization');
  const updatePolicy = migration.slice(updateStart, policyEnd);
  assert.match(updatePolicy, /FOR UPDATE TO authenticated/);
  assert.match(updatePolicy, /USING \([\s\S]*?public\.can_employee_execute_checklist_template\(template_id, branch_id, shift_type\)/);
  assert.match(updatePolicy, /WITH CHECK \([\s\S]*?public\.can_employee_execute_checklist_template\(template_id, branch_id, shift_type\)/);
  assert.equal((updatePolicy.match(/public\.can_employee_execute_checklist_template\(template_id, branch_id, shift_type\)/g) || []).length, 2,
    'both the existing row and updated row must remain executable by the current role');
});
