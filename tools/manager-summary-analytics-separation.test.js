const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const monitor = read('reports-monitor/index.html');
const analytics = read('analytics/index.html');
const reportsLog = read('reports-log/index.html');
const checklistLogs = read('checklist-logs/index.html');
const sidebar = read('assets/supabase-config.js');
const migration = read('supabase/migrations/20261123120000_manager_summary_projection_and_read_separation.sql');
const hardening = read('supabase/migrations/20261123160000_manager_report_scopes_hardening.sql');

test('daily summary uses its date-range projection and separate Manager summary branch permission', () => {
  assert.match(monitor, /currentUser\.role==='Manager'\?'can_view_daily_checklist_summary':'can_view_all_reports'/);
  assert.match(monitor, /rpc\('get_daily_checklist_summary',\{p_date_from:date,p_date_to:date\}\)/);
  assert.match(monitor, /rpc\('list_manager_daily_summary_branches'\)/);
  assert.doesNotMatch(monitor, /rpc\('list_manager_report_branches'\)/);
  assert.doesNotMatch(monitor, /from\('daily_reports'\)/);
  const branchList = hardening.match(/CREATE OR REPLACE FUNCTION public\.list_manager_daily_summary_branches\(\)[\s\S]*?\$function\$;/)?.[0] || '';
  assert.ok(branchList, 'Migration B must provide a dedicated summary branch list');
  assert.match(branchList, /current_user_manager_scope_allows\([\s\S]*?can_view_daily_checklist_summary/);
  assert.doesNotMatch(branchList, /can_read_manager_report_branch/);
});

test('analytics and report details require the independent analytics permission for Managers', () => {
  assert.match(analytics, /currentUser\.role === 'Manager' \? 'can_view_analytics' : 'can_view_all_reports'/);
  assert.match(reportsLog, /currentUser\.role==='Manager'&&\!\(await ZamAPI\.requireAdminPerm\('can_view_analytics'\)\)/);
  assert.match(checklistLogs, /currentUser\.role === 'Manager' && !\(await ZamAPI\.requireAdminPerm\('can_view_checklist_logs'\)\)/);
});

test('Manager sidebar links use distinct summary, analytics, and checklist-log capabilities', () => {
  assert.match(sidebar, /key: 'reports-monitor'[\s\S]*?managerPerm: 'can_view_daily_checklist_summary'/);
  assert.match(sidebar, /key: 'analytics'[\s\S]*?managerPerm: 'can_view_analytics'/);
  assert.match(sidebar, /key: 'reports-log'[\s\S]*?managerPerm: 'can_view_analytics'/);
  assert.match(sidebar, /key: 'checklist-logs'[\s\S]*?managerPerm: 'can_view_checklist_logs'/);
  assert.match(sidebar, /role === 'Manager' && i\.managerPerm \? i\.managerPerm : i\.perm/);
});

test('summary RPC is a minimal projection and underlying report analytics rows require analytics capability', () => {
  const rpc = migration.match(/CREATE OR REPLACE FUNCTION public\.get_daily_checklist_summary\([\s\S]*?\$function\$;/)?.[0] || '';
  assert.ok(rpc, 'summary RPC must exist');
  assert.match(rpc, /RETURNS TABLE \([\s\S]*?branch_id uuid,[\s\S]*?branch_name text,[\s\S]*?report_date date,[\s\S]*?shift_type text,[\s\S]*?entry_time text/);
  assert.doesNotMatch(rpc, /\breport_id\b|\bsales\b|\btotal_sales\b|custom_fields/);
  assert.match(rpc, /can_view_daily_checklist_summary/);
  for (const table of ['daily_reports', 'waste_logs', 'shift_issues', 'negative_reviews', 'technical_issues']) {
    const policy = migration.match(new RegExp(`CREATE POLICY manager_${table === 'daily_reports' ? 'daily_reports' : table}_read_capability[\\s\\S]*?ON public\\.${table}[\\s\\S]*?;`))?.[0] || '';
    assert.ok(policy, `Manager restrictive read policy must exist for ${table}`);
    assert.match(policy, /can_view_analytics/);
  }
});
