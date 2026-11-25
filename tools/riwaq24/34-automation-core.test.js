const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const worker = fs.readFileSync(path.join(root, 'supabase-functions/run-scheduled-automations/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261125164500_daily_report_recipients_and_automation_guard.sql'), 'utf8');
const postgrestRefreshMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261125171000_refresh_postgrest_recipient_rpcs.sql'), 'utf8');

let helpersPromise;
function helpers() {
  helpersPromise ||= import('../../supabase-functions/run-scheduled-automations/automation-helpers.mjs');
  return helpersPromise;
}

test('automation requests require POST and a Vault-verifiable 64-character secret; failures fail closed', async () => {
  const { authorizeAutomationRequest } = await helpers();
  const candidate = 'a'.repeat(64);
  let checks = 0;
  const verifier = async value => { checks += 1; return value === candidate; };
  const makeRequest = (method, secret) => new Request('https://example.test/functions/v1/run-scheduled-automations', {
    method,
    headers: secret ? { 'x-zam-automation-secret': secret } : {},
  });

  assert.equal(await authorizeAutomationRequest(makeRequest('GET', candidate), verifier), false);
  assert.equal(checks, 0, 'non-POST requests must not invoke the secret verifier');
  assert.equal(await authorizeAutomationRequest(makeRequest('POST', ''), verifier), false);
  assert.equal(await authorizeAutomationRequest(makeRequest('POST', 'short'), verifier), false);
  assert.equal(await authorizeAutomationRequest(makeRequest('POST', candidate), async () => false), false);
  assert.equal(await authorizeAutomationRequest(makeRequest('POST', candidate), async () => { throw new Error('unavailable'); }), false);
  assert.equal(await authorizeAutomationRequest(makeRequest('POST', candidate), verifier), true);
});

test('planned branches do not trigger scheduled work based only on a past planned opening date', async () => {
  const { isBranchOperational } = await helpers();
  assert.equal(isBranchOperational({ lifecycle_status: 'planned', planned_opening_date: '2020-01-01' }, '2026-11-25'), false);
  assert.equal(isBranchOperational({ lifecycle_status: 'operational', planned_opening_date: '2099-01-01' }, '2026-11-25'), true);
  assert.equal(isBranchOperational({ lifecycle_status: null }, '2026-11-25'), true, 'legacy unclassified branches retain existing behavior');
  assert.equal(isBranchOperational({ lifecycle_status: 'archived' }, '2026-11-25'), false);
});

test('the worker authenticates before reading schedules and never trusts free-form recipient addresses', () => {
  const gate = worker.indexOf('const authorized = await authorizeAutomationRequest');
  const scheduleRead = worker.indexOf("sbGetFiltered('automation_schedules'");
  assert.ok(gate >= 0 && scheduleRead > gate, 'the secret gate must run before schedule/database work');
  assert.match(worker, /sbRpc\('verify_zam_automation_cron_secret'/);
  assert.match(worker, /get_scheduled_automation_email_recipients/);
  assert.doesNotMatch(worker, /sch\.recipient_emails/);
  assert.doesNotMatch(worker, /ownerAdminEmails/);
});

test('worker profile, report, template, and log reads select only fields used by automation', () => {
  assert.match(worker, /'profiles', 'status=eq\.active', 'id,full_name,email,role,branch_id,shift_type,status,receives_branch_reports'/);
  assert.doesNotMatch(worker, /'profiles', 'status=eq\.active'\)/, 'do not fetch every profile column');
  assert.doesNotMatch(worker, /'passcode'|passcode_reset_requested/);
  assert.match(worker, /frequency,day_of_week,days_of_week,day_of_month/);
  assert.equal((worker.match(/body_html: html/g) || []).length, 2, 'both success and failure email-log rows must satisfy body_html NOT NULL');
  assert.match(worker, /'daily_reports', `report_date=\$\{occurrenceDateFilter\}`, 'id,branch_id,report_date,shift_type,total_sales,orders_count,team_status'/);
  assert.match(worker, /'waste_logs', `report_id=in\.\(\$\{reportIds\.join\(','\)\}\)`, 'id,report_id'/);
  assert.match(worker, /'shift_issues', `report_id=in\.\(\$\{reportIds\.join\(','\)\}\)`, 'id,report_id'/);
});

test('midnight grace uses the original occurrence date for reads and deduplication', () => {
  assert.match(worker, /execution_date=\$\{occurrenceDateFilter\}/);
  assert.match(worker, /report_date=\$\{occurrenceDateFilter\}/);
  assert.match(worker, /const reminderDate = scheduledDateForTime\(t\.target_time, now, today\)/);
  assert.match(worker, /log_date=\$\{reminderDateFilter\}/);
  assert.match(worker, /task_reminder_logs', \{ template_id: t\.id, log_date: reminderDate \}/);
  assert.match(worker, /const scheduleDate = scheduledDateForTime\(sch\.send_time, now, today\)/);
  assert.match(worker, /sch\.last_run_date === scheduleDate/);
  assert.match(worker, /\{ last_run_date: scheduleDate \}/);
  assert.doesNotMatch(worker, /if \(!schedules\.length\)\s*\{\s*return/,
    'task-time reminders must not be skipped when there are no email schedule rows');
});

test('recipient-RPC cache refresh migration only notifies PostgREST to reload its schema', () => {
  assert.match(postgrestRefreshMigration, /NOTIFY pgrst, 'reload schema';/i);
  assert.doesNotMatch(postgrestRefreshMigration, /INSERT|UPDATE|DELETE|CREATE POLICY|DROP POLICY/i);
});

test('recipient migration implements the frontend RPC contract without unrelated report RLS edits', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.daily_report_email_recipients/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.daily_report_email_recipient_branches/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.list_daily_report_email_recipient_candidates\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_daily_report_email_recipients\(\s*p_recipients jsonb,\s*p_primary_profile_id uuid/s);
  for (const field of ['profile_id', 'full_name', 'email', 'role', 'is_selected', 'is_primary', 'scope_mode', 'selected_branch_ids', 'authorized_branches', 'can_be_primary', 'is_configured']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
  assert.match(migration, /public\.can_profile_read_daily_report_branch\(/);
  assert.match(migration, /IF v_scope_mode = 'all_authorized' THEN[\s\S]*?ELSE[\s\S]*?OR NOT public\.can_profile_read_daily_report_branch\(v_profile_id, supplied_branch\.branch_id\)/);
  assert.match(migration, /b\.lifecycle_status IS NOT NULL AND b\.lifecycle_status NOT IN \('', 'operational'\)/);
  assert.match(migration, /p\.role = 'Owner' OR \(p\.role = 'Admin' AND ap\.can_manage_automations IS TRUE\)/);
  assert.doesNotMatch(migration, /DROP POLICY|CREATE POLICY|ALTER TABLE public\.(daily_reports|waste_logs|shift_issues)/);
});

test('scheduled summaries require all-branch scope plus the relevant independent permission', () => {
  assert.match(migration, /p_report_type = 'checklist_summary' THEN\s+s\.manager_type = 'branches' AND s\.scope_mode = 'all'\s+AND s\.can_view_daily_checklist_summary IS TRUE/);
  const checklistCase = migration.match(/WHEN p_report_type = 'checklist_summary' THEN([\s\S]*?)WHEN p_report_type = 'manager_reports_summary'/)?.[1] || '';
  assert.doesNotMatch(checklistCase, /can_view_analytics/);
  assert.match(migration, /p_report_type = 'manager_reports_summary' THEN\s+s\.manager_type = 'branches' AND s\.scope_mode = 'all'\s+AND s\.can_view_analytics IS TRUE/);
  assert.match(migration, /p_report_type = 'missed_report_alert' AND p_branch_id IS NOT NULL[\s\S]*?public\.can_profile_read_daily_report_branch\(p\.id, p_branch_id\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_scheduled_automation_email_recipients\(text, uuid\) TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.verify_zam_automation_cron_secret\(text\) TO service_role/);
  assert.match(migration, /secret\.name = 'zam_automation_cron_secret'[\s\S]*?secret\.decrypted_secret = p_candidate/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.(get_scheduled_automation_email_recipients|verify_zam_automation_cron_secret)[^;]*TO authenticated/);
});
