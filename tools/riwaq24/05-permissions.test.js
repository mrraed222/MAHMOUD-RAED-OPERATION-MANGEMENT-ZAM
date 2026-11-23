const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../permissions/index.html'), 'utf8');
const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
const sharedSource = fs.readFileSync(path.join(__dirname, '../../assets/supabase-config.js'), 'utf8');

test('owner-only gate and page-access permissions retain the existing role and key contracts', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /currentUser\.role !== 'Owner'/);
  const permsBlock = source.match(/const PERMS = \[([\s\S]*?)\];/)[1];
  const keys = [...permsBlock.matchAll(/key: '(can_[a-z_]+)'/g)].map(match => match[1]);
  assert.deepEqual(keys, [
    'can_manage_staff', 'can_manage_branches', 'can_manage_templates',
    'can_manage_automations', 'can_manage_reports', 'can_manage_branch_visits',
    'can_perform_branch_visits', 'can_review_visit_actions', 'can_manage_inventory', 'can_view_all_reports'
  ]);
  assert.match(script, /zamClient\.from\('admin_permissions'\)\.upsert\(payload\)/);
  assert.match(script, /zamClient\.from\('admin_permissions'\)\.select\('\*'\)/);
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

test('role, branch, shift, reports flag and inventory branch scope keep their existing data semantics', () => {
  assert.match(script, /role:card\.querySelector\('\.role-select'\)\.value/);
  assert.match(script, /branch_id:card\.querySelector\('\.branch-select'\)\.value\|\|null/);
  assert.match(script, /shift_type:card\.querySelector\('\.shift-select'\)\.value/);
  assert.match(script, /receives_branch_reports:card\.querySelector\('\.p-reports-check'\)\.checked/);
  assert.match(script, /payload\.can_view_all_inventory=!!payload\.can_manage_inventory&&scopeMode==='all'/);
  assert.match(script, /payload\.inventory_branch_ids=payload\.can_manage_inventory&&scopeMode==='selected'\?selected:\[\]/);
  assert.match(script, /selected\.length\)/);
});

test('review, account editing and employee editing expose loading, empty, error and success feedback', () => {
  assert.match(source, /جارٍ تحميل طلبات التسجيل/);
  assert.match(script, /لا توجد طلبات تسجيل معلّقة حاليًا/);
  assert.match(script, /تعذّر تحميل بيانات الإدارة/);
  assert.match(script, /تم حفظ بيانات الحساب/);
  assert.match(script, /تم حفظ التغييرات/);
  assert.match(script, /إعادة المحاولة/);
  assert.match(source, /aria-live="polite"/);
});

test('active employee accounts use an accessible responsive table and preserve real actions', () => {
  assert.match(source, /class="pending-card"/);
  assert.match(source, /class="staff-table"/);
  assert.match(source, /\.field \{ display:grid; grid-template-columns:minmax\(0,1fr\);/, 'fields must shrink within narrow mobile grids');
  assert.match(source, /<tbody>\$\{others\.map\(emp=>`<tr class="staff-row"/);
  assert.match(source, /<th scope="col">الموظف<\/th>/);
  assert.match(source, /data-label="الفرع والوردية ورمز المرور"/);
  assert.match(source, /data-label="الصلاحيات والحفظ"/);
  assert.match(source, /staff-table thead[\s\S]*?position:absolute/);
  assert.match(source, /\.staff-row td::before \{ content:attr\(data-label\)/);
  assert.match(source, /class="branch-select"/);
  assert.match(source, /class="shift-select"/);
  assert.match(source, /class="passcode-input"/);
  assert.match(source, /class="edit-perms-btn quiet-action"/);
  assert.match(source, /class="save-row-btn primary-action"/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(script, /e\.key==='Escape'/);
  assert.match(script, /btn\.addEventListener\('click'/);
  assert.match(source, /href="\.\.\/register\/index\.html"/);
  assert.match(source, /@media\(max-width:760px\)/);
  assert.doesNotMatch(source, /id="notif-bell-slot"/);
});

test('Manager is selectable and existing unknown roles remain selected and visible', () => {
  assert.match(source, /'Owner', 'Admin', 'Manager', 'Supervisor'/);
  assert.match(source, /Manager: 'مدير'/);
  assert.match(script, /if\(currentRole&&!roles\.includes\(currentRole\)\) roles\.push\(currentRole\)/);
  assert.match(script, /ROLE_LABELS\[role\]\|\|role/);
  assert.match(script, /ROLE_LABELS\[emp\.role\]\|\|emp\.role/);
  assert.match(script, /role:card\.querySelector\('\.role-select'\)\.value/);
});

test('individual template assignments and Manager report scopes load and save separately', () => {
  assert.match(source, /إسنادات مهام فردية/);
  assert.match(script, /ZamAPI\.getChecklistTemplateAssignmentIds\(empId\)/);
  assert.match(script, /ZamAPI\.replaceChecklistTemplateAssignments\(empId,selectedTemplateIds\)/);
  assert.match(script, /ZamChecklistSchedule\.isTemplateAssignableToEmployee/);
  assert.match(script, /ZamAPI\.getManagerReportScopes\(\)/);
  assert.match(script, /ZamAPI\.saveManagerReportScope\(empId,reportModeSelect\.value/);
  assert.match(script, /reportModeSelect\?\.value==='selected'&&!selectedReportIds\.length/);
  assert.match(script, /الفئات السابقة لم تُحذف/);
  assert.match(script, /الإسنادات السابقة كما هي/);
});

test('Manager read permissions are independent, saved through admin_permissions, and separate from writes', () => {
  const readKeys = [...source.matchAll(/\{ key: '(can_view_(?:daily_checklist_summary|checklist_logs|visit_reports|analytics))', label:/g)].map(match => match[1]);
  assert.deepEqual(readKeys, [
    'can_view_daily_checklist_summary', 'can_view_checklist_logs',
    'can_view_visit_reports', 'can_view_analytics'
  ]);
  assert.match(script, /const managerReadPanel=empRole==='Manager'/);
  assert.match(script, /MANAGER_READ_PERMS\.map\(item=>`<label class="check-row"><input type="checkbox" class="perm-checkbox manager-read-checkbox" data-key="\$\{item\.key\}"/);
  assert.match(script, /modal\.querySelectorAll\('\.perm-checkbox'\)\.forEach\(cb=>payload\[cb\.dataset\.key\]=cb\.checked\)/);
  assert.match(script, /zamClient\.from\('admin_permissions'\)\.upsert\(payload\)/);
  assert.match(source, /id="manager-read-permissions"/);
  assert.match(source, /id="admin-permissions-panel"/);
  assert.match(source, /لا يمنح صلاحية إضافة البيانات أو تعديلها أو حذفها/);
  assert.match(source, /can_manage_reports', label: 'إضافة تقارير؛ تعديل\/حذف التقارير المقروءة'/, 'the write grant must not claim edit/delete access to unread details');
});

test('Manager branch-scope choices exclude planned branches without changing other branch selectors', () => {
  assert.match(script, /branchesCache\.filter\(branch=>branch\.lifecycle_status!=='planned'\)\.map\(branch=>`<label class="check-row"><input type="checkbox" class="manager-report-branch-checkbox"/);
  assert.match(source, /لا تظهر الفروع المخططة قبل تأكيد افتتاحها تشغيليًا/);
  assert.match(script, /ZamAPI\.saveManagerReportScope\(empId,reportModeSelect\.value,selectedReportIds/);
});

test('Quality visit execution is separate and its editor omits management and review toggles', () => {
  assert.match(source, /Quality: 'مراقب جودة'/);
  assert.match(source, /key: 'can_perform_branch_visits'/);
  assert.match(script, /empRole!=='Quality'\|\|!\['can_manage_branch_visits','can_review_visit_actions'\]\.includes\(item\.key\)/);
});
