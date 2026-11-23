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
  assert.match(script, /role:requestedRole/);
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
  assert.match(script, /تعذّر تحميل الموظفين أو الصلاحيات/);
  assert.match(script, /ميزة نطاق فروع المدير غير مهيأة على قاعدة البيانات الحالية/);
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
  assert.match(script, /coreDeadline=new Promise/);
  assert.match(script, /loadTimeout=setTimeout\(\(\)=>\{loadTimedOut=true;controller\.abort\(\);reject\(new Error\('staff_permission_load_timeout'\)\);\},20000\)/);
  assert.match(script, /abortSignal\(controller\.signal\)/);
});

test('Manager stays visible for existing accounts but cannot be newly granted while its scope RPC is unavailable', () => {
  assert.match(source, /'Owner', 'Admin', 'Manager', 'Supervisor'/);
  assert.match(source, /Manager: 'مدير'/);
  assert.match(script, /roleOptionsHTML\(currentRole, allowManager = currentRole === 'Manager'\)/);
  assert.match(script, /role!=='Manager'\|\|allowManager/);
  assert.match(script, /roleOptionsHTML\(emp\.role==='Owner'\?'':emp\.role,false\)/);
  assert.match(script, /role==='Manager'&&!allowManager\?'disabled':''/);
  assert.match(script, /requestedRole==='Manager'\)throw new Error\('manager_scope_unavailable'\)/);
  assert.match(script, /requestedRole==='Manager'&&employee\?\.role!=='Manager'/);
  assert.match(script, /ROLE_LABELS\[role\]\|\|role/);
  assert.match(script, /ROLE_LABELS\[emp\.role\]\|\|emp\.role/);
  assert.match(script, /role:requestedRole/);
});

test('individual assignments remain separate while Manager report scope loads explicitly and saves through its RPC', () => {
  assert.match(source, /إسنادات مهام فردية/);
  assert.match(script, /ZamAPI\.getChecklistTemplateAssignmentIds\(empId\)/);
  assert.match(script, /ZamAPI\.replaceChecklistTemplateAssignments\(empId,selectedTemplateIds\)/);
  assert.match(script, /ZamChecklistSchedule\.isTemplateAssignableToEmployee/);
  assert.match(script, /ZamAPI\.getManagerReportScopes\(managerIds/);
  assert.match(script, /ZamAPI\.saveManagerReportScope\(empId,managerReportMode,managerReportBranchIds,managerReadFlags\.can_view_daily_checklist_summary,managerReadFlags\.can_view_checklist_logs,managerReadFlags\.can_view_visit_reports,managerReadFlags\.can_view_analytics\)/);
  assert.match(script, /reportScope\?\.scope_mode\|\|'selected'/, 'a missing scope must never default to all branches');
  assert.match(script, /branchesCache\.filter\(branch=>branch\.lifecycle_status!=='planned'\)/);
  assert.match(script, /لم يُحفظ نطاق المدير أو صلاحيات قراءته/);
  assert.match(script, /الفئات السابقة لم تُحذف/);
  assert.match(script, /الإسنادات السابقة كما هي/);
});

test('Manager read permissions are independent, saved through the scope RPC, and separate from writes', () => {
  const readKeys = [...source.matchAll(/\{ key: '(can_view_(?:daily_checklist_summary|checklist_logs|visit_reports|analytics))', label:/g)].map(match => match[1]);
  assert.deepEqual(readKeys, [
    'can_view_daily_checklist_summary', 'can_view_checklist_logs',
    'can_view_visit_reports', 'can_view_analytics'
  ]);
  assert.match(script, /const managerReadPanel=empRole==='Manager'/);
  assert.match(script, /MANAGER_READ_PERMS\.map\(item=>`<label class="check-row"><input type="checkbox" class="perm-checkbox manager-read-checkbox" data-key="\$\{item\.key\}"/);
  assert.match(script, /modal\.querySelectorAll\('\.perm-checkbox:not\(\.manager-read-checkbox\)'\)\.forEach\(cb=>payload\[cb\.dataset\.key\]=cb\.checked\)/);
  assert.match(script, /zamClient\.from\('admin_permissions'\)\.upsert\(payload\)/);
  assert.match(script, /managerReadFlags=Object\.fromEntries\(MANAGER_READ_PERMS\.map/);
  assert.match(sharedSource, /p_can_view_daily_checklist_summary:[\s\S]*?p_can_view_checklist_logs:[\s\S]*?p_can_view_visit_reports:[\s\S]*?p_can_view_analytics:/);
  assert.match(source, /id="manager-read-permissions"/);
  assert.match(source, /id="admin-permissions-panel"/);
  assert.match(source, /لا يمنح صلاحية إضافة البيانات أو تعديلها أو حذفها/);
  assert.match(source, /can_manage_reports', label: 'إضافة تقارير؛ تعديل\/حذف التقارير المقروءة'/, 'the write grant must not claim edit/delete access to unread details');
});

test('Manager scope UI fails closed when storage is unavailable and exposes all/selected operational branches when ready', () => {
  assert.match(source, /id="manager-report-scope-mode"/);
  assert.match(source, /class="manager-report-branch-checkbox"/);
  assert.match(source, /managerScopeAvailable\?`<section id="manager-report-scope-panel"/);
  assert.match(script, /managerScopeErrorText\(managerScopeLoadError\)/);
  assert.match(script, /managerScopeAvailable=false/);
  assert.match(script, /MANAGER_SCOPE_UNCONFIGURED/);
  assert.match(sharedSource, /async saveManagerReportScope\(profileId, mode, branchIds = \[\], canViewDailySummary = false, canViewChecklistLogs = false, canViewVisitReports = false, canViewAnalytics = false\)/);
});

test('Quality visit execution is separate and its editor omits management and review toggles', () => {
  assert.match(source, /Quality: 'مراقب جودة'/);
  assert.match(source, /key: 'can_perform_branch_visits'/);
  assert.match(script, /empRole!=='Quality'\|\|!\['can_manage_branch_visits','can_review_visit_actions'\]\.includes\(item\.key\)/);
});
