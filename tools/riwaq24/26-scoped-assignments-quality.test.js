const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedule = require('../../assets/checklist-schedule.js');
const dashboard = require('../../assets/checklist-dashboard.js');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20261122190000_riwaq_assignments_scopes_quality.sql');
const permissions = read('permissions/index.html');
const visitPage = read('branch-visits-new/index.html');
const supervisorDashboard = read('supervisor-dashboard/index.html');
const api = read('assets/supabase-config.js');
const profilePage = read('employee-profile/index.html');
const now = new Date('2026-11-22T09:00:00+03:00');

function functionSql(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} function should exist`);
  const next = migration.indexOf('\nCREATE OR REPLACE FUNCTION public.', start + 1);
  return migration.slice(start, next < 0 ? undefined : next);
}

const task = overrides => ({
  id: 'task-kitchen-1',
  branch_id: 'branch-a',
  category: 'المطبخ',
  shift_type: 'Morning',
  frequency: 'daily',
  task_type: 'standard',
  is_active: true,
  ...overrides,
});
const employee = overrides => ({
  role: 'Barista',
  branchId: 'branch-a',
  branchName: 'فرع اختباري',
  categories: ['البار'],
  assignedTemplateIds: ['task-kitchen-1'],
  shiftType: 'Morning',
  branchHours: { opening_time: '05:30', closing_time: '02:30' },
  ...overrides,
});

test('an individual template assignment overrides only category membership', () => {
  assert.equal(schedule.isTemplateScheduledForEmployee(task(), employee(), now), true);
  assert.equal(schedule.isTemplateScheduledForEmployee(task(), employee({ assignedTemplateIds: [] }), now), false);
  assert.equal(schedule.isTemplateScheduledForEmployee(task(), employee({ branchId: 'branch-b' }), now), false);
  assert.equal(schedule.isTemplateScheduledForEmployee(task(), employee({ shiftType: 'Evening' }), now), false);
  assert.equal(schedule.isTemplateScheduledForEmployee(task({ shift_type: 'Evening' }), employee(), now), false);
  assert.equal(schedule.isTemplateScheduledForEmployee(task(), employee({ role: 'Manager' }), now), false);
});

test('individual assignment candidates preserve protected tasks and branch exceptions', () => {
  assert.equal(schedule.isTemplateAssignableToEmployee(task(), employee()), true);
  assert.equal(schedule.isTemplateAssignableToEmployee(task({ frequency: 'hourly' }), employee()), false);
  assert.equal(schedule.isTemplateAssignableToEmployee(task({ task_type: 'inventory_count' }), employee()), false);
  assert.equal(schedule.isTemplateAssignableToEmployee(task(), employee({ role: 'Quality' })), false);
  assert.equal(schedule.isTemplateAssignableToEmployee(task(), employee({ branchId: 'branch-b' })), false);
  assert.equal(schedule.isTemplateAssignableToEmployee(task({ category: 'الصالة' }), employee({ branchId: '41f2dea8-238a-4550-abc8-b1a8a505f3d2' })), false);
  assert.equal(schedule.isTemplateAssignableToEmployee(task({ task_type: 'restroom_check' }), employee({ branchName: 'زام الحي' })), false);
  assert.equal(schedule.isTemplateAssignableToEmployee(task(), employee({ role: 'Waiter', branchName: 'زام المنح', shiftType: 'Morning' })), false);
});

test('branch employee progress includes individual tasks through a branch-scoped read', () => {
  const assigned = dashboard.tasksForEmployee([task()], employee({ id: 'profile-a' }), {
    branchId: 'branch-a',
    branchName: 'فرع اختباري',
    branchHours: { opening_time: '05:30', closing_time: '02:30' },
    categoriesBy: { 'profile-a': ['البار'] },
    assignmentsByProfile: { 'profile-a': ['task-kitchen-1'], 'profile-b': ['other-task'] },
    shiftType: 'Morning',
    includeExpired: true,
    now
  });
  assert.deepEqual(assigned.map(item => item.id), ['task-kitchen-1']);
  assert.deepEqual(dashboard.tasksForEmployee([task()], employee({ id: 'profile-a' }), {
    branchId: 'branch-b', branchName: 'فرع اختباري',
    assignmentsByProfile: { 'profile-a': ['task-kitchen-1'] }, shiftType: 'Morning', now
  }), []);
  assert.deepEqual(dashboard.tasksForEmployee([task()], employee({ id: 'profile-a' }), {
    branchId: 'branch-a', branchName: 'فرع اختباري',
    assignmentsByProfile: { 'profile-a': ['task-kitchen-1'] }, shiftType: 'Evening', now
  }), []);

  const reader = functionSql('list_branch_checklist_template_assignments');
  assert.match(reader, /public\.has_admin_permission\('staff'\)/);
  assert.match(reader, /v_role IS DISTINCT FROM 'Supervisor'[\s\S]*v_status IS DISTINCT FROM 'active'[\s\S]*v_branch_id IS DISTINCT FROM p_branch_id/);
  assert.match(reader, /b\.lifecycle_status IS DISTINCT FROM 'planned'/);
  assert.match(reader, /a\.is_active IS TRUE[\s\S]*p\.status = 'active'[\s\S]*p\.branch_id = p_branch_id[\s\S]*p\.role IN \('Barista', 'Waiter', 'Kitchen'\)/);
  assert.match(api, /list_branch_checklist_template_assignments/);
  assert.match(supervisorDashboard, /getBranchChecklistTemplateAssignments\(branchId\)/);
  assert.match(supervisorDashboard, /assignmentsByProfile: cache\.assignmentsByProfile/);
  assert.match(supervisorDashboard, /cache\.assignmentDataAvailable \? `\$\{myDone\}\/\$\{mine\.length\}` : 'غير متاح'/);
});

test('server validates multi-assignment eligibility and retains category-only override', () => {
  const replace = functionSql('replace_checklist_template_assignments');
  const execution = functionSql('can_employee_execute_checklist_template');
  assert.match(replace, /p_template_ids uuid\[\]/);
  assert.match(replace, /pg_catalog\.cardinality\(v_ids\) > 100/);
  assert.match(replace, /pg_catalog\.count\(DISTINCT item_id\)/);
  assert.match(replace, /v_profile\.role IS NULL OR v_profile\.role NOT IN \('Barista', 'Kitchen', 'Waiter', 'Supervisor'\)/);
  assert.match(replace, /v_profile\.shift_type IS NULL OR v_profile\.shift_type NOT IN \('Morning', 'Evening', 'Both'\)/);
  assert.match(replace, /v_profile\.lifecycle_status = 'planned'/);
  assert.match(replace, /inventory_request', 'inventory_count/);
  assert.match(replace, /COALESCE\(t\.frequency, 'daily'\) <> 'hourly'/);
  assert.match(replace, /'زام المنح'/);
  assert.match(replace, /'زام الحي'/);
  assert.match(replace, /41f2dea8-238a-4550-abc8-b1a8a505f3d2/);
  assert.match(execution, /p\.role IN \('Barista', 'Kitchen', 'Waiter', 'Supervisor'\)[\s\S]*?a\.profile_id = p\.id/);
  assert.match(execution, /p\.shift_type IN \('Morning', 'Evening', 'Both'\)/);
  assert.match(execution, /EXISTS \([\s\S]*?checklist_template_assignments[\s\S]*?\)\s*OR EXISTS \([\s\S]*?employee_task_categories/);
  assert.match(execution, /b\.lifecycle_status IS DISTINCT FROM 'planned'/);
  assert.match(migration, /public\.can_employee_execute_checklist_template\(template_id, branch_id, shift_type\)/);
});

test('template version and group merge move active assignments without rewriting history', () => {
  const transfer = functionSql('transfer_checklist_template_assignments');
  const version = functionSql('version_checklist_template');
  const merge = functionSql('save_checklist_template_group_with_branches');
  assert.match(transfer, /INSERT INTO public\.checklist_template_assignments/);
  assert.match(transfer, /UPDATE public\.checklist_template_assignments[\s\S]*?is_active = false/);
  assert.match(version, /transfer_checklist_template_assignments\(ARRAY\[v_old\.id\]::uuid\[\], v_new_id\)/);
  assert.match(merge, /transfer_checklist_template_assignments\(v_ids, v_new_id\)/);
  assert.doesNotMatch(transfer, /UPDATE public\.checklist_logs/);
});

test('Manager report scope covers reads while preserving independent write policies and legacy behavior', () => {
  const canRead = functionSql('can_read_manager_report_branch');
  const save = functionSql('save_manager_report_scope');
  assert.match(save, /p_scope_mode IS NULL/);
  assert.match(save, /v_role IS DISTINCT FROM 'Manager'/);
  assert.match(save, /'legacy', 'all', 'selected', 'none'/);
  assert.match(save, /IF p_scope_mode = 'selected'[\s\S]*?cardinality\(v_ids\) = 0/);
  assert.match(canRead, /NOT EXISTS \(\s*SELECT 1 FROM public\.manager_report_scopes AS s WHERE s\.profile_id = p\.id\s*\)\s+AND EXISTS \([\s\S]*?public\.admin_permissions AS ap[\s\S]*?ap\.can_view_all_reports IS TRUE/, 'legacy reads must continue to honor the saved report-view permission');
  assert.match(canRead, /s\.scope_mode = 'all'/);
  assert.match(canRead, /s\.scope_mode = 'selected'[\s\S]*?manager_report_scope_branches/);
  assert.match(canRead, /ap\.can_view_all_reports IS TRUE/);
  assert.match(migration, /DROP POLICY IF EXISTS "Manager manages all reports" ON public\.daily_reports/);
  assert.match(migration, /CREATE POLICY "Manager reads scoped reports" ON public\.daily_reports\s+FOR SELECT/);
  assert.match(migration, /CREATE POLICY "Manager inserts reports"[\s\S]*?FOR INSERT/);
  for (const table of ['waste', 'shift issues', 'reviews']) {
    assert.match(migration, new RegExp(`CREATE POLICY "Admin manages ${table}"[\\s\\S]*?FOR ALL`));
  }
  for (const table of ['waste', 'shift issues', 'reviews']) {
    assert.match(migration, new RegExp(`Manager reads scoped ${table}`));
  }
  assert.match(migration, /public\.can_read_manager_report_branch\(branch_id\)/);
});

test('Quality assignment is opt-in, cross-branch, and cannot become visit management or evidence review', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS can_perform_branch_visits boolean NOT NULL DEFAULT false/);
  const list = functionSql('list_branch_visit_supervisors');
  const insertPolicy = migration.slice(migration.indexOf('CREATE POLICY branch_visit_assignments_insert'), migration.indexOf('CREATE OR REPLACE FUNCTION public.can_submit_assigned_branch_visit'));
  assert.match(list, /public\.can_manage_branch_visits\(\)/);
  assert.match(list, /\(p\.role = 'Supervisor' AND p\.branch_id = p_branch_id\)\s+OR \(p\.role = 'Quality'[\s\S]*?can_perform_branch_visits IS TRUE/);
  assert.match(insertPolicy, /target_profile\.role = 'Quality'[\s\S]*?can_perform_branch_visits IS TRUE/);
  assert.match(functionSql('can_manage_branch_visits'), /p\.role <> 'Quality'/);
  assert.match(functionSql('can_review_branch_visit_actions'), /p\.role <> 'Quality'/);
  const assignmentReadStart = migration.indexOf('CREATE POLICY branch_visit_assignments_read');
  const assignmentReadEnd = migration.indexOf('\nDROP POLICY IF EXISTS branch_visit_assignments_insert', assignmentReadStart);
  assert.ok(assignmentReadStart >= 0 && assignmentReadEnd > assignmentReadStart);
  const assignmentRead = migration.slice(assignmentReadStart, assignmentReadEnd);
  assert.match(assignmentRead, /assigned_to = \(SELECT auth\.uid\(\)\)/);
  assert.match(assignmentRead, /status = 'assigned'/);
  assert.match(assignmentRead, /p\.status = 'active'/);
  assert.match(assignmentRead, /p\.role = 'Supervisor' AND p\.branch_id = branch_visit_assignments\.branch_id/);
  assert.match(assignmentRead, /p\.role = 'Quality' AND ap\.can_perform_branch_visits IS TRUE/);
  const submit = functionSql('can_submit_assigned_branch_visit');
  assert.match(submit, /a\.assigned_to = p\.id[\s\S]*p\.status = 'active'[\s\S]*a\.status = 'assigned'/);
  assert.match(submit, /p\.shift_type = 'Both' OR p\.shift_type = a\.shift_type/);
  assert.match(submit, /p\.role = 'Supervisor' AND p\.branch_id = a\.branch_id/);
  assert.match(submit, /p\.role = 'Quality' AND ap\.can_perform_branch_visits IS TRUE/);
  assert.doesNotMatch(submit, /p\.role <> 'Quality' OR/, 'any non-Quality role must not pass as a current assignee');
  const completion = functionSql('guard_quality_visit_assignment_completion');
  assert.match(completion, /public\.can_manage_branch_visits\(\)/, 'the existing manager permission path must remain available');
  assert.match(completion, /NEW\.assigned_to IS DISTINCT FROM \(SELECT auth\.uid\(\)\)/);
  assert.match(completion, /v_status IS DISTINCT FROM 'active'/);
  assert.match(completion, /v_role = 'Supervisor' AND v_branch_id = NEW\.branch_id/);
  assert.match(completion, /v_role = 'Quality' AND v_enabled/);
  assert.match(completion, /v_shift_type IS DISTINCT FROM NEW\.shift_type/);
  assert.match(permissions, /empRole!=='Quality'\|\|!\['can_manage_branch_visits','can_review_visit_actions'\]\.includes\(item\.key\)/);
  assert.match(visitPage, /person\.role==='Quality'\?'مراقب جودة · عبر الفروع':'مشرف'/);
  assert.match(visitPage, /scheduleShift\.addEventListener\('change'/);
});

test('Owner title is consistent and the visit approval stamp remains unchanged', () => {
  assert.match(permissions, /Owner: 'مالك ومطور النظام'/);
  assert.match(profilePage, /Owner: 'مالك ومطور النظام'/);
  assert.match(permissions, /Owner: 'مالك ومطور النظام'/);
  assert.match(visitPage, /اعتماد إلكتروني — محمود شريف — إدارة التشغيل/);
});
