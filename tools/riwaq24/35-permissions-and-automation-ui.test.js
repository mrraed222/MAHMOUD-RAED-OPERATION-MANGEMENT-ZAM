const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const project = path.resolve(__dirname, '..', '..');
const permissions = fs.readFileSync(path.join(project, 'permissions', 'index.html'), 'utf8');
const automation = fs.readFileSync(path.join(project, 'automation-settings', 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(project, 'supabase', 'migrations', '20261126170000_supervisor_report_scopes.sql'), 'utf8');
const emailFunction = fs.readFileSync(path.join(project, 'supabase', 'functions', 'send-report-copy', 'index.ts'), 'utf8');

test('permission editor exposes scoped supervisor and quality visit controls', () => {
  assert.match(permissions, /id="supervisor-report-scope-panel"/);
  assert.match(permissions, /can_view_checklist_logs/);
  assert.match(permissions, /can_view_daily_reports/);
  assert.match(permissions, /can_view_visit_reports/);
  assert.match(permissions, /roleScopeHelp/);
  assert.doesNotMatch(permissions, /empRole==='Quality'\|\|item\.key!=='can_perform_branch_visits/);
});

test('review migration keeps optional supervisor scope explicit', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.supervisor_report_scopes/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.supervisor_scope_allows/);
  assert.match(migration, /cardinality\(s\.branch_ids\) > 0/);
  assert.match(migration, /cardinality\(s\.shift_types\) > 0/);
  assert.match(migration, /current_user_can_read_daily_report/);
  assert.match(migration, /hourly_checklist_logs_supervisor_scope_guard/);
});

test('automation page presents configuration counters without claiming delivery success', () => {
  assert.match(automation, /id="automation-kpi-active"/);
  assert.match(automation, /id="automation-kpi-summaries"/);
  assert.match(automation, /id="automation-kpi-reminders"/);
  assert.match(automation, /function renderAutomationDashboard\(\)/);
  assert.match(automation, /ليست إثباتًا لوصول البريد/);
});

test('report email is a branded dashboard summary with operational counters', () => {
  assert.match(emailFunction, /لوحة تقرير الوردية/);
  assert.match(emailFunction, /assets\/logo\/zam-logo\.png/);
  assert.match(emailFunction, /إجمالي المبيعات/);
  assert.match(emailFunction, /متوسط الفاتورة/);
  assert.match(emailFunction, /سجلات الهدر/);
  assert.match(emailFunction, /مشاكل الشفت/);
  assert.match(emailFunction, /html: emailHtml\(report, branchName, waste, issues, reviews, technicalIssues\)/);
});

