const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const pages = {
  forgot: read('forgot-passcode/index.html'),
  employeeProfile: read('employee-profile/index.html'),
  permissions: read('permissions/index.html'),
  supervisorDashboard: read('supervisor-dashboard/index.html'),
  supervisorChecklist: read('supervisor-checklist/index.html'),
  branches: read('branches-checklists/index.html'),
  dashboard: read('dashboard/index.html'),
  reportsLog: read('reports-log/index.html'),
  reportsMonitor: read('reports-monitor/index.html'),
  branchDetail: read('branch-detail/index.html'),
  automation: read('automation-settings/index.html'),
  analytics: read('analytics/index.html'),
  checklistLogs: read('checklist-logs/index.html'),
  branchVisits: read('branch-visits-new/index.html'),
  shared: read('assets/supabase-config.js')
};
const managerWriteMigration = read('supabase/migrations/20261124160000_manager_write_scope_guards.sql');

test('password-reset UI reports success only after a successful function result', () => {
  assert.match(pages.forgot, /const \{ error \} = await zamClient\.functions\.invoke\('request-passcode-reset'/);
  assert.match(pages.forgot, /if \(error\) throw error/);
  assert.match(pages.forgot, /catch \(err\) \{\s*console\.error\(err\);\s*showStatus\('error'/);
  assert.match(pages.forgot, /btn\.disabled = false/);
});

test('employee report cards escape branch, date, sales and team-status values', () => {
  for (const field of ['r.branches?.name', 'r.report_date', 'r.total_sales', 'r.team_status']) {
    assert.ok(pages.employeeProfile.includes(`escapeReportValue(${field}`), `must escape ${field}`);
  }
  assert.doesNotMatch(pages.employeeProfile, /\$\{r\.branches\?\.name\s*\|\|/);
});

test('employee role selector cannot assign Owner to non-owner accounts', () => {
  assert.match(pages.permissions, /ROLES\.filter\(role=>\(role!=='Owner'\|\|currentRole==='Owner'\)\)/);
  assert.match(pages.permissions, /roleOptionsHTML\(emp\.role==='Owner'\?'':emp\.role,managerScopeAvailable\)\.replace/);
  assert.match(pages.permissions, /if\(!role\|\|role==='Owner'\)throw new Error\('invalid_pending_role'\)/);
});

test('manager report writes require can_manage_reports independently of saved branch scope', () => {
  assert.match(managerWriteMigration, /current_user_manager_can_manage_reports\(\)[\s\S]*?ap\.can_manage_reports IS TRUE/);
  assert.match(managerWriteMigration, /FOR INSERT TO authenticated[\s\S]*?current_user_manager_can_manage_reports/);
  assert.match(managerWriteMigration, /FOR UPDATE TO authenticated[\s\S]*?current_user_manager_can_manage_reports/);
  assert.match(managerWriteMigration, /FOR DELETE TO authenticated[\s\S]*?current_user_manager_can_manage_reports/);
  assert.match(managerWriteMigration, /TG_TABLE_NAME IN \('daily_reports', 'waste_logs', 'shift_issues', 'technical_issues'\)[\s\S]*?current_user_manager_can_manage_reports/);
});

test('manager write migration remains compatible with the current production visit schema', () => {
  assert.match(managerWriteMigration, /ADD COLUMN IF NOT EXISTS can_perform_branch_visits boolean NOT NULL DEFAULT false/);
  assert.match(managerWriteMigration, /current_user_manager_branch_in_scope\(a\.branch_id\)/);
  assert.doesNotMatch(managerWriteMigration, /\b(?:a|NEW|OLD)\.assignee_role\b/);
});

test('supervisor dashboard container has a complete class attribute', () => {
  assert.match(pages.supervisorDashboard, /<div class="max-w-6xl mx-auto p-margin-desktop">/);
  assert.doesNotMatch(pages.supervisorDashboard, /<div class="max-w-6xl mx-auto p-margin-desktop>/);
});

test('supervisor receiving section has one class attribute and remains initially hidden', () => {
  const section = pages.supervisorChecklist.match(/<section id="inventory-receiving-tasks-section"([^>]*)>/)?.[1] || '';
  assert.equal((section.match(/\bclass=/g) || []).length, 1);
  assert.match(section, /class="workflow-anchor hidden rounded-xl/);
});

test('shared bell installer waits for sidebars and removes bell slots from non-dashboard pages', () => {
  assert.match(pages.shared, /const startWatching = \(\) => \{\s*if \(initialize\(\)\) return;[\s\S]*new MutationObserver/);
  assert.match(pages.shared, /window\.__zamActiveSidebarKey === 'dashboard'/);
  assert.match(pages.shared, /if \(!showNotifications\) notificationSlot\?\.remove\(\)/);
  assert.match(pages.shared, /if \(showNotifications\) refreshNotificationBell\(\)\.catch/);
  for (const page of ['supervisor-checklist']) {
    const html = read(`${page}/index.html`);
    assert.match(html, /id="sidebar-slot"/, `${page} needs the shared sidebar lifecycle hook`);
    assert.match(html, /renderZamSidebar\('/, `${page} must provide its active key to the shared header`);
  }
  assert.match(pages.dashboard, /renderZamSidebar\('dashboard'/);
});

test('legacy staff route redirects to the unified permissions page without loading staff data', () => {
  const legacy = read('staff-management/index.html');
  assert.match(legacy, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(legacy, /window\.location\.replace\('\.\.\/permissions\/index\.html#staff-section'\)/);
  assert.doesNotMatch(legacy, /getStaffForManagement|\.from\('profiles'\)|\.from\('admin_permissions'\)/);
});

test('shared sidebar uses the approved Riwaq background, active and readable text colors', () => {
  const theme = read('assets/riwaq-theme.css');
  assert.match(theme, /--riwaq-sidebar:\s*#16392f/);
  assert.match(theme, /--riwaq-sidebar-active:\s*#285849/);
  assert.match(pages.shared, /\.zam-sidebar, \.zam-sidebar\.bg-surface \{ background-color: var\(--riwaq-sidebar, #16392f\) !important;/);
  assert.match(pages.shared, /\.zam-sidebar nav a\.bg-surface-container[\s\S]*?background-color: var\(--riwaq-sidebar-active, #285849\) !important/);
  assert.match(pages.shared, /\.zam-sidebar nav a \{ color: #e7f0eb !important;/);
});

test('shared notification bell sits away from the user identity and branch visit heading remains in its branded header', () => {
  assert.match(pages.shared, /\.zam-header-tools \.zam-header-account \{ order: 1; \}[\s\S]*?\.zam-header-tools #notif-bell-slot \{ order: 3;[\s\S]*?\.zam-header-tools \.zam-sidebar-toggle \{ order: 2; \}/);
  assert.match(pages.branchVisits, /<header class="brand p-6">[\s\S]*?<h1 class="text-3xl font-black">تسجيل زيارة فرع<\/h1>[\s\S]*?<div data-zam-header-tools aria-label="أدوات المستخدم"><\/div>[\s\S]*?<\/header>/);
});

test('planned opening date does not activate a branch without owner confirmation', () => {
  assert.match(pages.branches, /تاريخ الافتتاح المخطط/);
  assert.match(pages.branches, /التاريخ لا يفعّل الفرع تشغيليًا، ويلزم تأكيد المالك للافتتاح/);
});

test('branch dashboard preserves cached rows and reports the latest refresh failure', () => {
  const catchBlock = pages.dashboard.split('} catch (err) {')[1]?.split('} finally {')[0] || '';
  assert.ok(catchBlock, 'dashboard needs a refresh failure handler');
  assert.match(catchBlock, /if \(generation !== dashboardLoadGeneration\) return;/);
  assert.doesNotMatch(catchBlock, /dashboardRows\s*=\s*\[\]/);
  assert.match(catchBlock, /stateEl\.textContent = 'تعذّر تحميل بيانات اللوحة\. تحقق من الاتصال ثم أعد المحاولة\.'/);
  assert.match(catchBlock, /role="alert"/);
  assert.match(catchBlock, /cardsEl\.setAttribute\('aria-busy', 'false'\)/);
});

test('starting a report-log refresh clears the exportable prior result set', () => {
  assert.match(pages.reportsLog, /function setStatus\(message,error=false\)\{if\(message==='جارٍ تحميل التقارير…'\)reportsData=\[\]/);
  const loadReports = pages.reportsLog.match(/async function loadReports\(\)\{([\s\S]*?)\}\s*async function openDetail/)?.[1] || '';
  assert.match(loadReports, /if\(currentUser\.role==='Manager'\)\{[^}]*return;\}/);
  assert.ok(loadReports.indexOf("setStatus('جارٍ تحميل التقارير…')") < loadReports.indexOf("zamClient.from('daily_reports')"));
});

test('report monitor ignores stale date responses and only unlocks the latest request', () => {
  assert.match(pages.reportsMonitor, /let monitorLoadGeneration=0/);
  assert.match(pages.reportsMonitor, /if\(generation!==monitorLoadGeneration\|\|date!==dateInput\.value\)return/);
  assert.match(pages.reportsMonitor, /if\(generation!==monitorLoadGeneration\)return;[\s\S]*?finally\{if\(generation===monitorLoadGeneration\)refreshButton\.disabled=false/);
});

test('branch image modal restores focus to the exact opener or a safe fallback', () => {
  assert.match(pages.branchDetail, /lastImageTrigger=trigger\|\|document\.activeElement/);
  assert.match(pages.branchDetail, /if\(trigger\?\.isConnected\)trigger\.focus\(\);else document\.getElementById\('refresh-btn'\)\?\.focus\(\)/);
  assert.doesNotMatch(pages.branchDetail, /document\.querySelector\('\[data-image-index\]'\)\?\.focus\(\)/);
});

test('automation schedule creation is blocked when branch options did not load', () => {
  assert.match(pages.automation, /branchOptionsReady=false/);
  assert.match(pages.automation, /branchOptionsReady=true/);
  const guard = pages.automation.indexOf('if(!branchOptionsReady)');
  const insert = pages.automation.indexOf("from('automation_schedules').insert(");
  assert.ok(guard >= 0 && insert > guard, 'branch-load guard must run before schedule insertion');
});

test('custom analytics period requires both endpoints and focuses the missing field', () => {
  assert.match(pages.analytics, /if \(!fromValue \|\| !toValue \|\| fromValue > toValue\)/);
  assert.match(pages.analytics, /!fromValue \? document\.getElementById\('f-from'\) : !toValue \? document\.getElementById\('f-to'\)/);
});

test('decorative zoom layer does not intercept checklist photo clicks', () => {
  assert.match(pages.checklistLogs, /class="pointer-events-none absolute inset-0 bg-primary\/20/);
});

test('inline scripts on all changed screens remain syntactically valid', () => {
  const changedPages = [
    'forgot-passcode/index.html', 'employee-profile/index.html', 'permissions/index.html',
    'supervisor-dashboard/index.html', 'supervisor-checklist/index.html', 'branches-checklists/index.html',
    'dashboard/index.html', 'reports-log/index.html', 'reports-monitor/index.html',
    'branch-detail/index.html', 'automation-settings/index.html', 'analytics/index.html',
    'checklist-logs/index.html'
  ];
  for (const page of changedPages) {
    const html = read(page);
    for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (script.trim()) assert.doesNotThrow(() => new Function(script), `${page} inline script should parse`);
    }
  }
});
