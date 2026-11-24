const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../permissions/index.html'), 'utf8');
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const script = scripts.join('\n');
const sharedSource = fs.readFileSync(path.join(__dirname, '../../assets/supabase-config.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261124153000_manager_branch_scope_type.sql'), 'utf8');
const writeScopeMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261124160000_manager_write_scope_guards.sql'), 'utf8');
const readPermissionsMigration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261123160000_manager_report_scopes_hardening.sql'), 'utf8');

test('inline scripts parse independently', () => {
  assert.ok(scripts.length >= 3);
  for (const inlineScript of scripts) assert.doesNotThrow(() => new vm.Script(inlineScript));
});

test('permissions page keeps Owner access and grants staff mode only after can_manage_staff succeeds', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /const isOwner = currentUser\?\.role === 'Owner'/);
  assert.match(source, /await ZamAPI\.requireAdminPerm\('can_manage_staff'\)/);
  assert.match(script, /const mode=await permissionsPageAccess/);
  assert.match(script, /document\.querySelectorAll\('\[data-owner-only\]'\)/);
  assert.match(script, /mode!=='owner'&&mode!=='staff'/);
  assert.match(script, /dataset\.permissionsAccessReady='true'/);
  assert.match(source, /data-owner-only hidden/);
});

test('permission keys and admin editor retain their established data contract', () => {
  const permsBlock = source.match(/const PERMS = \[([\s\S]*?)\];/)[1];
  const keys = [...permsBlock.matchAll(/key: '(can_[a-z_]+)'/g)].map(match => match[1]);
  assert.deepEqual(keys, [
    'can_manage_staff', 'can_manage_branches', 'can_manage_templates',
    'can_manage_automations', 'can_manage_reports', 'can_manage_branch_visits',
    'can_perform_branch_visits', 'can_review_visit_actions', 'can_manage_inventory', 'can_view_all_reports'
  ]);
  assert.match(script, /zamClient\.from\('admin_permissions'\)\.upsert\(payload\)/);
  assert.match(script, /permissionDataAvailable=isOwner&&!permissionError/);
});

test('staff-only mode uses a least-data directory and does not request admin permissions or passcodes', () => {
  assert.match(script, /isOwner\?ZamAPI\.getStaffForManagement\(\{signal:controller\.signal\}\):ZamAPI\.getStaffDirectory\(\{signal:controller\.signal\}\)/);
  assert.match(sharedSource, /async getStaffDirectory\([\s\S]*?select\('id, full_name, email, employee_number, status, role, branch_id, shift_type, avatar_url, whatsapp_number, branches\(name\)'\)/);
  assert.doesNotMatch(sharedSource.match(/async getStaffDirectory\([\s\S]*?\n    },/)[0], /passcode/);
  assert.match(script, /includePermissionStats:isOwner/);
  const statsMethod = sharedSource.match(/async getStaffStats\([\s\S]*?\n    },/)[0];
  assert.match(statsMethod, /includePermissionStats = false/);
  assert.match(statsMethod, /includePermissionStats \? zamClient\.from\('admin_permissions'\)/);
});

test('staff-management tools are wired after authorization: directory, contact/photo editing, search, branch filter, export, stats, and gallery', () => {
  for (const id of ['staff-search', 'staff-branch-filter', 'export-staff-csv', 'employee-photos-row', 'staff-profile-modal', 'stat-last-login', 'stat-last-perm', 'stat-reset']) assert.match(source, new RegExp(`id="${id}"`));
  assert.match(script, /staff-search'\)\.addEventListener\('input',renderStaff\)/);
  assert.match(script, /staff-branch-filter'\)\.addEventListener\('change',renderStaff\)/);
  assert.match(script, /export-staff-csv'\)\.addEventListener\('click',exportFilteredStaffCSV\)/);
  assert.match(script, /cancel-staff-profile'\)\.addEventListener\('click',closeStaffProfileModal\)/);
  assert.match(script, /save-staff-profile'\)\.addEventListener\('click',saveStaffProfile\)/);
  assert.match(script, /openStaffProfileModal\(button\.dataset\.profileId\)/);
  assert.match(script, /getStaffStats\(\{includePermissionStats:isOwner\}\)/);
  assert.match(script, /function exportFilteredStaffCSV\(\)/);
  assert.match(script, /passcode_reset_requested=false/);
});

test('CSV is filtered, excludes passcodes, quotes cells, and protects against formula injection', () => {
  const exporter = script.match(/function exportFilteredStaffCSV\(\)\{([\s\S]*?)\n\}/)[0];
  assert.match(exporter, /const rows=filteredStaff\(\)/);
  assert.doesNotMatch(exporter, /passcode/);
  assert.match(exporter, /safeCell=value=>/);
  assert.match(exporter, /replace\(\/"\/g,'""'\)/);
});

test('task-category assignment remains an independent employee_task_categories workflow', () => {
  assert.match(script, /ZamAPI\.getTaskCategories\(empId\)/);
  assert.match(script, /ZamAPI\.replaceTaskCategories\(empId,selectedCats\)/);
  assert.match(script, /await zamClient\.from\('admin_permissions'\)\.upsert\(payload\)[\s\S]*?await ZamAPI\.replaceTaskCategories\(empId,selectedCats\)/);
  assert.match(source, /فئات قوائم المهام المسندة/);
  assert.match(source, /الصلاحيات الإدارية/);
});

test('partial task-category saves keep previous assignments when adding a category fails', () => {
  const start = sharedSource.indexOf('async replaceTaskCategories(profileId, categories) {');
  const end = sharedSource.indexOf('\n    },', start);
  const method = sharedSource.slice(start, end);
  assert.match(method, /await ZamAPI\.getTaskCategories\(profileId\)/);
  assert.match(method, /insert\(rows\)[\s\S]*?delete\(\)[\s\S]*?\.in\('category', categoriesToRemove\)/);
  assert.match(script, /الفئات السابقة لم تُحذف/);
});

test('owner account and employee editing preserve existing branch, shift, status, and reporting semantics', () => {
  assert.match(script, /const profilePayload=\{role:profileRole,branch_id:branchId,shift_type:shiftType\}/);
  assert.match(script, /receives_branch_reports:receives/);
  assert.match(script, /payload\.can_view_all_inventory=!!payload\.can_manage_inventory&&scopeMode==='all'/);
  assert.match(script, /payload\.inventory_branch_ids=payload\.can_manage_inventory&&scopeMode==='selected'\?selected:\[\]/);
  assert.match(script, /selected\.length\)/);
  assert.match(script, /rolePath==='BranchManager'&&\(!branchId\|\|!branchOperational\)/);
});

test('registration review requests remain on the permissions page and Manager activation stages an explicit deny-by-default scope', () => {
  assert.match(source, /id="pending-section"[^>]*data-owner-only hidden/);
  assert.match(script, /const managerType=rolePath==='BranchManager'\?'branch':'branches'/);
  assert.match(script, /status:'active',role:'Barista',branch_id:branchId/);
  assert.match(script, /saveManagerReportScope\(card\.dataset\.id,managerType,'selected',\[branchId\],false,false,false,false\)/);
  assert.match(script, /status:'pending',role:employee\?\.role\|\|'Barista'/);
  assert.match(script, /لم يُفعّل الحساب كمدير/);
});

test('Manager and Branch Manager remain distinct UI paths over profile role Manager', () => {
  assert.match(source, /Manager: 'مدير فروع', BranchManager: 'مدير فرع'/);
  assert.match(script, /profileRoleFor = role => role === 'BranchManager' \? 'Manager' : role/);
  assert.match(script, /const managerRoleFor = employee =>[\s\S]*?managerReportScopeCache\[employee\.id\]\?\.manager_type === 'branch'/);
  assert.match(script, /const targetManager=isManagerRole\(rolePath\),managerType=rolePath==='BranchManager'\?'branch':'branches'/);
  assert.match(script, /scopeMode=managerType==='branch'\?'selected'/);
  assert.match(script, /scopeBranchIds=managerType==='branch'\?\[branchId\]/);
  assert.match(script, /roleOptionsHTML\(pathRole,managerScopeAvailable\)/);
});

test('Manager path is prepared before role activation, read grants start off, and branch moves never temporarily widen access', () => {
  assert.match(script, /await saveScope\(managerType,scopeMode,scopeBranchIds,noReadFlags\);[\s\S]*?update\(\{role:'Manager'\}\)/);
  assert.match(script, /const broadToBranchMove=branchManagerMove&&oldScope\?\.manager_type==='branches'/);
  assert.match(script, /await saveScope\('branches','selected',\[branchId\],noReadFlags\)/);
  assert.match(script, /scopeMustFollowProfile=needsScopeWrite&&isExistingManager&&managerType==='branch'&&branchId!==employee\.branch_id&&!broadToBranchMove/);
  assert.match(script, /manager_must_be_active/);
  assert.match(script, /readFlags=Object\.fromEntries\(MANAGER_READ_PERMS\.map\(item=>\[item\.key,oldScope\?\.\[item\.key\]===true\]\)\)/);
});

test('Manager scope migration stores an explicit path and strictly validates Branch Manager scope', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS manager_type text NOT NULL DEFAULT 'branches'/);
  assert.match(migration, /CHECK \(manager_type IN \('branches', 'branch'\)\)/);
  assert.match(migration, /s\.manager_type = 'branch'[\s\S]*?s\.scope_mode = 'selected'[\s\S]*?p\.branch_id = p_branch_id[\s\S]*?count\(\*\)[\s\S]*?= 1/);
  assert.match(migration, /p_scope_mode IS NULL/);
  assert.match(migration, /p_manager_type IS NULL/);
  assert.match(migration, /p_can_view_analytics IS NULL/);
  assert.match(migration, /p_manager_type = 'branch'[\s\S]*?cardinality\(v_branch_ids\) <> 1[\s\S]*?v_branch_ids\[1\] IS DISTINCT FROM v_primary_branch_id/);
  assert.match(migration, /b\.lifecycle_status IS NULL OR b\.lifecycle_status = '' OR b\.lifecycle_status = 'operational'/);
  assert.doesNotMatch(migration, /lifecycle_status IS DISTINCT FROM 'planned'/);
  assert.match(migration, /Compatibility for the currently deployed seven-argument client/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_manager_report_scope\([\s\S]*?p_profile_id uuid,[\s\S]*?p_scope_mode text,[\s\S]*?p_can_view_analytics boolean[\s\S]*?SELECT public\.save_manager_report_scope\([\s\S]*?p_profile_id, 'branches', p_scope_mode/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_manager_report_scope\([\s\S]*?uuid, text, uuid\[\], boolean, boolean, boolean, boolean\n\) TO authenticated/);
  assert.match(source, /branch-lifecycle\.js/);
  assert.match(script, /managerBranches=branchesCache\.filter\(isOperationalBranch\)/);
  assert.match(script, /scope\.branchIds\[0\]!==emp\.branch_id\|\|!isOperationalBranch\(branch\)/);
  assert.match(sharedSource, /MANAGER_SCOPE_INVALID/);
  assert.match(sharedSource, /row\.manager_type/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.save_manager_report_scope/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_manager_report_scope/);
});

test('Manager scope API passes the separate manager type and four independent read flags', () => {
  assert.match(script, /saveManagerReportScope\(empId,managerType,managerReportMode,managerReportBranchIds,managerReadFlags\.can_view_daily_checklist_summary,managerReadFlags\.can_view_checklist_logs,managerReadFlags\.can_view_visit_reports,managerReadFlags\.can_view_analytics\)/);
  assert.match(sharedSource, /async saveManagerReportScope\(profileId, managerType, mode, branchIds = \[\], canViewDailySummary = false, canViewChecklistLogs = false, canViewVisitReports = false, canViewAnalytics = false\)/);
  assert.match(sharedSource, /p_manager_type: managerType === 'branch' \? 'branch' : 'branches'/);
  assert.match(sharedSource, /p_can_view_daily_checklist_summary: canViewDailySummary === true/);
  assert.match(sharedSource, /p_can_view_checklist_logs: canViewChecklistLogs === true/);
  assert.match(sharedSource, /p_can_view_visit_reports: canViewVisitReports === true/);
  assert.match(sharedSource, /p_can_view_analytics: canViewAnalytics === true/);
});

test('all editable passcode forms enforce the same 4–20 character boundary', () => {
  assert.match(source, /id="my-passcode"[^>]*minlength="4" maxlength="20"/);
  assert.match(source, /id="staff-edit-passcode"[^>]*minlength="4" maxlength="20"/);
  assert.match(source, /class="passcode-input"[^>]*minlength="4" maxlength="20"/);
  assert.match(script, /isValidEditablePasscode = passcode => !passcode \|\| \(passcode\.length >= 4 && passcode\.length <= 20\)/);
  assert.match(script, /if\(!isValidEditablePasscode\(passcode\)\)/);
  assert.match(script, /if \(!isValidEditablePasscode\(pass\)\)/);
  assert.match(script, /if\(isOwner&&!isValidEditablePasscode\(passcode\)\)/);
});

test('Manager write guards restrict report and visit writes to explicit operational branch scope', () => {
  assert.match(writeScopeMigration, /CREATE OR REPLACE FUNCTION public\.current_user_manager_branch_in_scope\(p_branch_id uuid\)/);
  assert.match(writeScopeMigration, /CREATE POLICY %I ON public\.%I AS RESTRICTIVE FOR ALL TO authenticated/);
  assert.match(writeScopeMigration, /manager_report_id_in_scope\(report_id\)/);
  assert.match(writeScopeMigration, /manager_visit_row_branch_in_scope\(%L, %s\)/);
  assert.match(writeScopeMigration, /CREATE TRIGGER manager_branch_write_scope_guard BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(writeScopeMigration, /USING ERRCODE = '42501'/);
  assert.match(writeScopeMigration, /public\.can_manage_branch_visit_in_scope\(p_branch_id\)/);
  assert.match(writeScopeMigration, /public\.current_user_manager_branch_in_scope\(p_branch_id\)/);
  assert.match(writeScopeMigration, /public\.manager_report_branch_in_scope\(p\.id, p_branch_id, false\)/);
});

test('visit-read RPC visibility remains independent from assignment-management writes', () => {
  const readFunction = readPermissionsMigration.match(/CREATE OR REPLACE FUNCTION public\.current_user_can_read_visit_branch\(p_branch_id uuid\)([\s\S]*?)\$function\$;/)[0];
  const managementFunction = writeScopeMigration.match(/CREATE OR REPLACE FUNCTION public\.can_manage_branch_visit_in_scope\(p_branch_id uuid\)([\s\S]*?)\$function\$;/)[0];
  assert.match(readFunction, /'can_view_visit_reports'/);
  assert.doesNotMatch(readFunction, /can_manage_branch_visits/);
  assert.match(managementFunction, /can_manage_branch_visits/);
  assert.match(managementFunction, /p\.role <> 'Manager'\s+OR public\.manager_report_branch_in_scope/);
  assert.match(writeScopeMigration, /CREATE OR REPLACE FUNCTION public\.list_branch_visit_supervisors/);
  assert.match(writeScopeMigration, /public\.can_manage_branch_visit_in_scope\(p_branch_id\)/);
});

test('SECURITY DEFINER write backstop validates old and new visit-linked row scope', () => {
  const guard = writeScopeMigration.match(/CREATE OR REPLACE FUNCTION public\.guard_manager_branch_write_scope\(\)([\s\S]*?)\$function\$;/)[0];
  assert.match(guard, /IF TG_OP <> 'INSERT'[\s\S]*?to_jsonb\(OLD\)[\s\S]*?manager_visit_row_branch_in_scope/);
  assert.match(guard, /IF TG_OP <> 'DELETE'[\s\S]*?to_jsonb\(NEW\)[\s\S]*?manager_visit_row_branch_in_scope/);
  assert.match(guard, /current_user_role\(\).*?IS DISTINCT FROM 'Manager'/);
  assert.match(source, /id="manager-scope-status"/);
});

test('Manager read permissions remain independent, default off, and separate from write capabilities', () => {
  const readKeys = [...source.matchAll(/\{ key: '(can_view_(?:daily_checklist_summary|checklist_logs|visit_reports|analytics))', label:/g)].map(match => match[1]);
  assert.deepEqual(readKeys, [
    'can_view_daily_checklist_summary', 'can_view_checklist_logs',
    'can_view_visit_reports', 'can_view_analytics'
  ]);
  assert.match(script, /const managerReadPanel=isManagerRole\(empRole\)/);
  assert.match(script, /manager-read-checkbox" data-key="\$\{item\.key\}" \$\{reportScope\?\.\[item\.key\]===true\?'checked':''\}/);
  assert.match(script, /managerReadFlags=Object\.fromEntries\(MANAGER_READ_PERMS\.map/);
  assert.match(script, /const noReadFlags=Object\.fromEntries\(MANAGER_READ_PERMS\.map\(item=>\[item\.key,false\]\)\)/);
  assert.match(source, /لا يمنح صلاحية إضافة البيانات أو تعديلها أو حذفها/);
  assert.match(source, /can_manage_reports', label: 'إضافة تقارير؛ تعديل\/حذف التقارير المقروءة'/);
});

test('Manager and task-scope load failures remain visible and fail closed without defaulting to all branches', () => {
  assert.match(script, /managerScopeAvailable=false/);
  assert.match(script, /managerScopeErrorText\(managerScopeLoadError\)/);
  assert.match(script, /reportScope\?\.scope_mode\|\|'selected'/);
  assert.match(script, /managerScopeAvailable\?`<section id="manager-report-scope-panel"/);
  assert.match(script, /scopeMode==='selected'&&!scopeBranchIds\.length/);
  assert.match(script, /if\(!permissionDataAvailable\)\{alert\(/);
  assert.match(script, /ستظل طلبات التسجيل ظاهرة، وتعطّل محررات الصلاحيات/);
});

test('staff and registration views retain loading, empty, error, and success feedback', () => {
  assert.match(script, /جارٍ تحميل الحسابات والطلبات/);
  assert.match(script, /لا توجد طلبات تسجيل معلّقة حاليًا/);
  assert.match(script, /تعذّر تحميل الموظفين أو الصلاحيات/);
  assert.match(script, /تم حفظ التغييرات/);
  assert.match(script, /إعادة المحاولة/);
  assert.match(source, /aria-live="polite"/);
  assert.match(script, /coreDeadline=new Promise/);
});
