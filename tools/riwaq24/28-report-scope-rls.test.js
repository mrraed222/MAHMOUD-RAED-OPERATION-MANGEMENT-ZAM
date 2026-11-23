const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261122190000_riwaq_assignments_scopes_quality.sql'), 'utf8');
const emailMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261122194000_daily_report_scope_and_email_recipients.sql'), 'utf8');
const analyticsPermissionPrerequisite = fs.readFileSync(path.join(root, 'supabase/migrations/20261122193000_manager_analytics_permission_prerequisite.sql'), 'utf8');
const managerAccessMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261123110000_manager_branch_scoped_read_permissions.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const monitor = fs.readFileSync(path.join(root, 'reports-monitor/index.html'), 'utf8');

function policySql(name) {
  const start = migration.indexOf(`CREATE POLICY "${name}"`);
  assert.ok(start >= 0, `policy ${name} should exist`);
  const ends = [migration.indexOf('\nCREATE POLICY ', start + 1), migration.indexOf('\nDROP POLICY ', start + 1)]
    .filter(index => index >= 0);
  return migration.slice(start, ends.length ? Math.min(...ends) : migration.length);
}

const broadPolicies = [
  ['daily_reports', 'daily_reports'],
  ['waste_logs', 'waste_logs'],
  ['shift_issues', 'shift_issues'],
  ['negative_reviews', 'negative_reviews'],
];
const firstScopedRead = migration.indexOf('CREATE POLICY "Manager reads scoped reports"');
assert.ok(firstScopedRead >= 0, 'the replacement scoped SELECT policy must exist');
for (const [table, policy] of broadPolicies) {
  const drop = `DROP POLICY IF EXISTS "allow all ${policy}" ON public.${table};`;
  assert.ok(schema.includes(`create policy "allow all ${policy}" on ${table}`), `schema fixture should expose the existing broad ${table} policy`);
  const dropIndex = migration.indexOf(drop);
  assert.ok(dropIndex >= 0, `migration must explicitly drop broad policy ${policy}`);
  assert.ok(dropIndex < firstScopedRead, `${policy} must be dropped before scoped report reads are installed`);
  assert.doesNotMatch(migration, new RegExp(`CREATE\\s+POLICY\\s+"allow all ${policy}"`, 'i'));
}

// Every report-log role retains a permissive SELECT policy after broad policies are replaced.
assert.match(policySql('Owner reads all reports'), /FOR SELECT TO authenticated[\s\S]*?current_user_role\(\) = 'Owner'/);
assert.match(policySql('Admin reads all reports'), /FOR SELECT TO authenticated[\s\S]*?current_user_role\(\) = 'Admin'/);
assert.match(policySql('Supervisor reads assigned shift reports'), /FOR SELECT TO authenticated[\s\S]*?current_supervisor_can_read_daily_report\(branch_id, shift_type\)/);
assert.doesNotMatch(migration, /DROP POLICY IF EXISTS "Admin manages all reports" ON public\.daily_reports/,
  'existing Admin DML policy is preserved');

const scopeStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.can_read_manager_report_branch(');
const scopeEnd = migration.indexOf('$function$;', scopeStart);
assert.ok(scopeStart >= 0 && scopeEnd > scopeStart, 'manager branch-read scope function should exist');
const scopeSql = migration.slice(scopeStart, scopeEnd);
assert.match(scopeSql, /p\.role\s*=\s*'Manager'/);
assert.match(scopeSql, /ap\.can_view_all_reports\s+IS\s+TRUE/);
assert.match(scopeSql, /NOT EXISTS \([\s\S]*?manager_report_scopes[\s\S]*?\)\s+AND EXISTS \([\s\S]*?public\.admin_permissions AS ap[\s\S]*?ap\.can_view_all_reports IS TRUE/, 'legacy scope must still require the existing report-view permission');
assert.match(scopeSql, /s\.scope_mode\s*=\s*'all'/);
assert.match(scopeSql, /s\.scope_mode\s*=\s*'selected'[\s\S]*?sb\.branch_id\s*=\s*p_branch_id/);
assert.doesNotMatch(scopeSql, /s\.scope_mode\s*=\s*'none'/, 'none must not grant a branch read');
for (const table of ['daily_reports', 'waste_logs', 'shift_issues', 'negative_reviews']) {
  assert.match(migration, new RegExp(`CREATE POLICY "Manager reads scoped [^"\\n]+" ON public\\.${table}[\\s\\S]*?FOR SELECT TO authenticated[\\s\\S]*?can_read_manager_report_branch`));
}
for (const [table, ownerSuffix, supervisorSuffix] of [['waste_logs', 'waste', 'waste'], ['shift_issues', 'shift issues', 'issues'], ['negative_reviews', 'reviews', 'reviews']]) {
  assert.match(policySql(`Owner reads all ${ownerSuffix}`), /FOR SELECT TO authenticated[\s\S]*?current_user_role\(\) = 'Owner'/);
  assert.match(policySql(`Admin reads all ${ownerSuffix}`), /FOR SELECT TO authenticated[\s\S]*?current_user_role\(\) = 'Admin'/);
  const supervisorPolicy = policySql(`Supervisor reads assigned shift ${supervisorSuffix}`);
  assert.match(supervisorPolicy, new RegExp(`FOR SELECT TO authenticated[\\s\\S]*?daily_reports AS r[\\s\\S]*?r\\.id = ${table}\\.report_id[\\s\\S]*?current_supervisor_can_read_daily_report\\(r\\.branch_id, r\\.shift_type\\)`));
}
const shiftScopeStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.current_supervisor_can_read_daily_report(');
const shiftScopeEnd = migration.indexOf('$function$;', shiftScopeStart);
assert.ok(shiftScopeStart >= 0 && shiftScopeEnd > shiftScopeStart, 'server-side Supervisor shift-scope helper should exist');
const shiftScopeSql = migration.slice(shiftScopeStart, shiftScopeEnd);
assert.match(shiftScopeSql, /p\.role\s*=\s*'Supervisor'/);
assert.match(shiftScopeSql, /p\.branch_id\s*=\s*p_branch_id/);
assert.match(shiftScopeSql, /p\.shift_type\s*=\s*'Both'\s+OR\s+p\.shift_type\s*=\s*p_report_shift_type/,
  'Both is explicit and grants both valid shifts only within the assigned branch');

assert.match(policySql('Manager inserts reports'), /WITH CHECK \([\s\S]*?current_user_role\(\) = 'Manager'[\s\S]*?can_read_manager_report_branch\(branch_id\)/);
const reportUpdate = policySql('Manager updates reports');
assert.equal((reportUpdate.match(/can_read_manager_report_branch\(branch_id\)/g) || []).length, 2,
  'report UPDATE must authorize both the old and new branch');
assert.match(policySql('Manager deletes reports'), /USING \([\s\S]*?can_read_manager_report_branch\(branch_id\)/);
assert.match(managerAccessMigration, /CREATE OR REPLACE FUNCTION public\.can_manager_write_daily_report\(p_report_id uuid\)[\s\S]*?ap\.can_manage_reports IS TRUE/,
  'report child writes require explicit can_manage_reports');
assert.match(analyticsPermissionPrerequisite, /ADD COLUMN IF NOT EXISTS can_view_analytics boolean/,
  'the analytics capability column must exist before the recipient migration references it');
assert.match(managerAccessMigration, /CREATE OR REPLACE FUNCTION public\.can_manager_write_daily_report_branch\(p_branch_id uuid\)[\s\S]*?ap\.can_manage_reports IS TRUE/,
  'report parent INSERT also requires explicit can_manage_reports and branch scope');
assert.match(managerAccessMigration, /CREATE POLICY "Manager inserts reports"[\s\S]*?can_manager_write_daily_report_branch\(branch_id\)/);
assert.match(managerAccessMigration, /CREATE POLICY "Manager updates reports"[\s\S]*?can_manager_read_branch\('can_view_analytics', branch_id\)[\s\S]*?WITH CHECK/);
assert.match(managerAccessMigration, /CREATE POLICY "Manager deletes reports"[\s\S]*?can_manager_read_branch\('can_view_analytics', branch_id\)/);
assert.match(managerAccessMigration, /CREATE OR REPLACE FUNCTION public\.can_manager_read_daily_report_details\(p_report_id uuid\)[\s\S]*?can_manager_read_branch\('can_view_analytics'/);
for (const table of ['waste_logs', 'shift_issues', 'negative_reviews']) {
  assert.match(managerAccessMigration, new RegExp(String.raw`CREATE POLICY "Manager updates [^"\n]+" ON public\.${table}[\s\S]*?can_manager_read_daily_report_details\(report_id\)`),
    `Manager UPDATE on ${table} requires detail visibility`);
  assert.match(managerAccessMigration, new RegExp(String.raw`CREATE POLICY "Manager deletes [^"\n]+" ON public\.${table}[\s\S]*?can_manager_read_daily_report_details\(report_id\)`),
    `Manager DELETE on ${table} requires detail visibility`);
}
for (const table of ['waste', 'shift issues', 'reviews']) {
  for (const operation of ['inserts', 'updates', 'deletes']) {
    const policy = policySql(`Manager ${operation} ${table}`);
    assert.match(policy, /daily_reports AS r[\s\S]*?can_read_manager_report_branch\(r\.branch_id\)/,
      `Manager ${operation} ${table} must authorize its parent report branch`);
    if (operation === 'updates') {
      assert.equal((policy.match(/can_read_manager_report_branch\(r\.branch_id\)/g) || []).length, 2,
        `Manager updates ${table} must validate both old and new parent reports`);
    }
  }
  assert.match(migration, new RegExp(`CREATE POLICY "Admin manages ${table}"[\\s\\S]*?FOR ALL`),
    `Admin ${table} policies must remain independent`);
}

const branchListStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.list_manager_report_branches()');
const branchListEnd = migration.indexOf('$function$;', branchListStart);
assert.ok(branchListStart >= 0 && branchListEnd > branchListStart, 'scoped Manager branch-list RPC should exist');
assert.match(migration.slice(branchListStart, branchListEnd), /public\.can_read_manager_report_branch\(b\.id\)/);
assert.match(monitor, /currentUser\.role==='Manager'[\s\S]*?zamClient\.rpc\('list_manager_report_branches'\)/);
assert.match(monitor, /if\(branchesRes\.error\)throw branchesRes\.error/);

function scopeAllows(mode, selectedBranchIds, targetBranchId, canViewAll = true) {
  if (!canViewAll) return false;
  if (mode === 'legacy' || mode === 'all') return true;
  if (mode === 'selected') return selectedBranchIds.includes(targetBranchId);
  return false;
}
assert.equal(scopeAllows('none', ['branch-a'], 'branch-a'), false, 'none scope denies even a previously selected branch');
assert.equal(scopeAllows('legacy', [], 'branch-a', false), false, 'legacy scope cannot bypass a disabled report-view permission');
assert.equal(scopeAllows('legacy', [], 'branch-a', true), true, 'legacy scope preserves an enabled report-view permission');
assert.equal(scopeAllows('selected', ['branch-a'], 'branch-a'), true, 'selected scope allows a selected branch');
assert.equal(scopeAllows('selected', ['branch-a'], 'branch-b'), false, 'selected scope denies an unselected branch');
assert.equal(scopeAllows('all', [], 'branch-b'), true, 'all scope allows any branch');
assert.equal(scopeAllows('selected', ['branch-a'], 'branch-a', false), false, 'selected scope still requires report-view permission');

assert.match(emailMigration, /CREATE POLICY daily_reports_authorized_branch_shift_read[\s\S]*?AS RESTRICTIVE[\s\S]*?current_supervisor_can_read_daily_report\(branch_id, shift_type\)/,
  'a restrictive report policy must prevent older permissive policies from widening Supervisor visibility');
for (const table of ['waste_logs', 'shift_issues', 'negative_reviews']) {
  assert.match(emailMigration, new RegExp(`CREATE POLICY ${table}_authorized_parent_read[\\s\\S]*?AS RESTRICTIVE[\\s\\S]*?daily_reports AS r[\\s\\S]*?r\\.id = ${table}\\.report_id`),
    `${table} detail reads must be scoped to a visible parent report`);
}

function supervisorCanRead(profile, report) {
  return profile?.status === 'active' && profile.role === 'Supervisor'
    && profile.branch_id === report.branch_id
    && ['Morning', 'Evening'].includes(report.shift_type)
    && (profile.shift_type === 'Both' || profile.shift_type === report.shift_type);
}
const supervisor = { role: 'Supervisor', status: 'active', branch_id: 'branch-a', shift_type: 'Morning' };
assert.equal(supervisorCanRead(supervisor, { branch_id: 'branch-a', shift_type: 'Morning' }), true);
assert.equal(supervisorCanRead(supervisor, { branch_id: 'branch-a', shift_type: 'Evening' }), false);
assert.equal(supervisorCanRead(supervisor, { branch_id: 'branch-b', shift_type: 'Morning' }), false);
assert.equal(supervisorCanRead({ ...supervisor, shift_type: 'Both' }, { branch_id: 'branch-a', shift_type: 'Evening' }), true);
assert.equal(supervisorCanRead({ ...supervisor, status: 'inactive' }, { branch_id: 'branch-a', shift_type: 'Morning' }), false);

const recipientScopeStart = emailMigration.indexOf('CREATE OR REPLACE FUNCTION public.can_profile_read_daily_report(');
const recipientScopeEnd = emailMigration.indexOf('$function$;', recipientScopeStart);
assert.ok(recipientScopeStart >= 0 && recipientScopeEnd > recipientScopeStart, 'recipient authorization helper must exist');
const recipientScopeSql = emailMigration.slice(recipientScopeStart, recipientScopeEnd);
assert.match(recipientScopeSql, /p\.role\s*=\s*'Supervisor'/);
assert.match(recipientScopeSql, /p\.branch_id\s*=\s*p_branch_id/);
assert.match(recipientScopeSql, /p\.shift_type\s*=\s*'Both'\s+OR\s+p\.shift_type\s*=\s*p_report_shift_type/);
assert.match(recipientScopeSql, /p_report_shift_type IN \('Morning', 'Evening'\)/, 'invalid report shifts are never authorized');
assert.match(emailMigration, /p\.role IN \('Owner', 'Admin', 'Manager', 'Supervisor'\)/,
  'active Supervisors may be configured as recipients');
assert.match(emailMigration, /v_role NOT IN \('Owner', 'Admin', 'Manager', 'Supervisor'\)/);
const primaryEligibilityStart = emailMigration.indexOf('CREATE OR REPLACE FUNCTION public.can_profile_be_daily_report_primary(');
const primaryEligibilityEnd = emailMigration.indexOf('$function$;', primaryEligibilityStart);
assert.ok(primaryEligibilityStart >= 0 && primaryEligibilityEnd > primaryEligibilityStart,
  'primary recipient eligibility must be defined by an explicit server-side helper');
const primaryEligibilitySql = emailMigration.slice(primaryEligibilityStart, primaryEligibilityEnd);
assert.match(primaryEligibilitySql, /p\.role IN \('Owner', 'Admin', 'Manager'\)/,
  'a shift Supervisor cannot be selected as the primary management recipient');
assert.match(primaryEligibilitySql, /can_profile_read_daily_report_branch\(p\.id, b\.id\)/,
  'a primary Manager may qualify through at least one authorized branch, not every branch');
assert.match(emailMigration, /can_profile_be_daily_report_primary\(p\.id\) AS can_be_primary/,
  'the recipient picker must permit an authorized selected-scope primary');
const saveRecipientsStart = emailMigration.indexOf('CREATE OR REPLACE FUNCTION public.save_daily_report_email_recipients(');
const saveRecipientsEnd = emailMigration.indexOf('$function$;', saveRecipientsStart);
const saveRecipientsSql = emailMigration.slice(saveRecipientsStart, saveRecipientsEnd);
assert.match(saveRecipientsSql, /IF v_profile_id = p_primary_profile_id THEN[\s\S]*?can_profile_be_daily_report_primary\(v_profile_id\)/,
  'server-side save validation must accept an eligible selected-branch primary');
assert.doesNotMatch(saveRecipientsSql, /v_scope_mode <> 'all_authorized'[\s\S]*?can_profile_read_all_daily_report_branches/,
  'selected scope must not be rejected solely because the primary lacks global branch access');
assert.match(saveRecipientsSql, /b\.lifecycle_status = 'planned'[\s\S]*?NOT public\.can_profile_read_daily_report_branch\(v_profile_id, supplied_branch\.branch_id\)/,
  'selected branches are checked against the recipient\'s actual report permission and planned branches are rejected');
const recipientCandidatesStart = emailMigration.indexOf('CREATE OR REPLACE FUNCTION public.list_daily_report_email_recipient_candidates(');
const recipientCandidatesEnd = emailMigration.indexOf('$function$;', recipientCandidatesStart);
const recipientCandidatesSql = emailMigration.slice(recipientCandidatesStart, recipientCandidatesEnd);
assert.match(recipientCandidatesSql, /FROM public\.profiles AS p[\s\S]*?WHERE p\.status = 'active'[\s\S]*?p\.role IN \('Owner', 'Admin', 'Manager', 'Supervisor'\)/,
  'recipient choices come from existing active system profiles, not arbitrary email addresses');
assert.match(recipientCandidatesSql, /public\.can_profile_read_daily_report_branch\(p\.id, b\.id\)/,
  'the picker exposes only branches the account is authorized to read');
assert.match(recipientCandidatesSql, /p\.role <> 'Manager'[\s\S]*?can_view_analytics IS TRUE/,
  'the recipient picker hides Managers without full-report analytics/detail permission');
assert.match(saveRecipientsSql, /v_role = 'Manager'[\s\S]*?can_view_analytics IS TRUE/,
  'server-side recipient configuration rejects summary-only Managers');
const resolverStart = emailMigration.indexOf('CREATE OR REPLACE FUNCTION public.get_daily_report_copy_recipients(');
const resolverEnd = emailMigration.indexOf('$function$;', resolverStart);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'send-time recipient resolver must exist');
const resolverSql = emailMigration.slice(resolverStart, resolverEnd);
assert.match(resolverSql, /SELECT r\.branch_id, r\.shift_type, r\.submitted_by[\s\S]*?INTO v_branch_id, v_report_shift_type, v_report_submitter_id/);
assert.match(resolverSql, /can_profile_read_daily_report\(p\.id, v_branch_id, v_report_shift_type\)/,
  'recipient authorization is rechecked against the report branch and exact shift when sending');
assert.match(resolverSql, /configured\.scope_mode = 'selected'[\s\S]*?primary_branch\.branch_id[\s\S]*?can_profile_read_daily_report_branch\(p\.id, primary_branch\.branch_id\)/,
  'selected primary scope is valid without requiring it to match every report branch');
assert.match(resolverSql, /p\.role <> 'Supervisor' OR p\.id = v_report_submitter_id/,
  'a configured shift Supervisor is returned only for the report they submitted');
assert.match(resolverSql, /configured\.scope_mode = 'selected'[\s\S]*?selected\.branch_id = v_branch_id/,
  'each configured recipient is filtered by their selected branch set at send time');
const fallbackStart = resolverSql.indexOf('IF NOT EXISTS (SELECT 1 FROM public.daily_report_email_recipients)');
const configuredStart = resolverSql.indexOf('-- The primary recipient', fallbackStart);
const fallbackSql = resolverSql.slice(fallbackStart, configuredStart);
assert.match(fallbackSql, /p\.role IN \('Owner', 'Admin'\)/,
  'the unsaved-settings fallback must retain the existing Owner/Admin recipient path');
assert.match(fallbackSql, /p\.role = 'Manager'[\s\S]*?scope_mode = 'all'[\s\S]*?can_view_analytics IS TRUE/,
  'the fallback must require all-branch scope and explicit analytics/detail permission');
assert.match(fallbackSql, /NOT EXISTS \([\s\S]*?manager_report_scopes AS configured_scope[\s\S]*?can_view_all_reports IS TRUE/,
  'the legacy report flag is an all-scope fallback only when no explicit Manager scope exists');
assert.doesNotMatch(fallbackSql, /p\.role = 'Manager' AND public\.can_profile_read_daily_report_branch/,
  'a selected-branch Manager must not be an automatic recipient in the fallback');
assert.doesNotMatch(fallbackSql, /scope_mode = 'selected'/,
  'legacy can_view_all_reports must not bypass an explicit selected-branch scope');
const automaticRecipientsSql = resolverSql.slice(resolverSql.lastIndexOf('UNION ALL'));
assert.match(automaticRecipientsSql, /p\.role IN \('Owner', 'Admin'\)/,
  'saved recipient settings must retain the existing Owner/Admin recipient path');
assert.match(automaticRecipientsSql, /p\.role = 'Manager'[\s\S]*?scope_mode = 'all'[\s\S]*?can_view_analytics IS TRUE/,
  'automatic Manager copies require all-branch scope and explicit analytics/detail permission');
assert.match(automaticRecipientsSql, /NOT EXISTS \([\s\S]*?manager_report_scopes AS configured_scope[\s\S]*?can_view_all_reports IS TRUE/,
  'the legacy report flag is an all-scope fallback only when no explicit Manager scope exists');
assert.doesNotMatch(automaticRecipientsSql, /p\.role = 'Manager' AND public\.can_profile_read_daily_report_branch/,
  'a Manager scoped only to selected branches is never added by the automatic path');
assert.doesNotMatch(automaticRecipientsSql, /scope_mode = 'selected'/,
  'legacy can_view_all_reports must not bypass an explicit selected-branch scope in saved settings');
assert.match(automaticRecipientsSql, /v_report_shift_type IN \('Morning', 'Evening'\)/,
  'automatic Manager delivery rejects invalid report shifts');
assert.match(resolverSql, /bool_or\(eligible\.is_primary\)/,
  'configured and automatic recipients must be deduplicated without losing the primary marker');

function supervisorOwnsReport(profile, report) {
  return profile.role !== 'Supervisor' || profile.id === report.submitted_by;
}
const morningReport = { branch_id: 'branch-a', shift_type: 'Morning', submitted_by: 'supervisor-a' };
assert.equal(supervisorOwnsReport({ role: 'Supervisor', id: 'supervisor-a' }, morningReport), true,
  'the shift supervisor receives their own submitted report');
assert.equal(supervisorOwnsReport({ role: 'Supervisor', id: 'supervisor-b' }, morningReport), false,
  'another Supervisor does not receive a colleague\'s report even within the same shift');
assert.match(emailMigration, /b\.lifecycle_status IS DISTINCT FROM 'planned'[\s\S]*?can_profile_read_daily_report_branch/,
  'planned branches are omitted from the selectable branch list');

console.log('report-scope RLS static/model tests: passed');
