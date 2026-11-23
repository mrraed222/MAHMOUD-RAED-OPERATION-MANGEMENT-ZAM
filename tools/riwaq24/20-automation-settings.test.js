const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../automation-settings/index.html'), 'utf8');

test('automation settings retains authentication, permission gate, route context, and all five report types', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /ZamAPI\.requireAdminPerm\('can_manage_automations'\)/);
  for (const value of ['checklist_summary', 'manager_reports_summary', 'missed_report_alert', 'employee_task_reminder', 'supervisor_task_reminder']) {
    assert.ok(source.includes(value), `missing report type ${value}`);
  }
  assert.doesNotMatch(source, /main\{margin-right:280px/,
    'the hidden-by-default sidebar must not reserve a desktop gutter');
});

test('instant forwarding and schedule writes preserve table and payload semantics, including null all-scopes', () => {
  assert.match(source, /from\('automation_settings'\)\.select\('\*'\)\.eq\('key','instant_report_forward'\)\.maybeSingle\(\)/);
  assert.match(source, /from\('automation_settings'\)\.upsert\(\{key:'instant_report_forward',is_active:v\}\)/);
  assert.match(source, /branch_id=document\.getElementById\('new-branch'\)\.value\|\|null/);
  assert.match(source, /shift_type=document\.getElementById\('new-shift-type'\)\.value\|\|null/);
  assert.match(source, /from\('automation_schedules'\)\.insert\(\[\{report_type,branch_id,send_time,shift_type,is_active:true\}\]\)/);
  assert.match(source, /from\('automation_schedules'\)\.update\(\{is_active:v\}\)\.eq\('id',s\.id\)/);
  assert.match(source, /from\('automation_schedules'\)\.delete\(\)\.eq\('id',s\.id\)/);
});

test('schedule list has truthful loading, empty, error and retry states; filters and counters are actionable', () => {
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /جارٍ تحميل المواعيد/);
  assert.match(source, /لا توجد مواعيد محفوظة بعد/);
  assert.match(source, /تعذر تحميل المواعيد/);
  assert.match(source, /id="retry-schedules"/);
  assert.match(source, /getElementById\('retry-schedules'\)\.onclick=loadSchedules/);
  assert.match(source, /data-shift-btn="Morning"/);
  assert.match(source, /data-shift-btn="Evening"/);
  assert.match(source, /id="active-count"/);
  assert.match(source, /id="paused-count"/);
  assert.match(source, /if\(error\)throw error/);
});

test('state changes report errors and delete remains confirmed; no bell is declared outside the dashboard', () => {
  assert.match(source, /confirm\('حذف هذا الموعد نهائيًا؟'\)/);
  assert.match(source, /تعذر حفظ الحالة/);
  assert.match(source, /تعذر حفظ الإعداد/);
  assert.match(source, /<form id="schedule-form"/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /notif-bell-slot/);
  assert.doesNotMatch(source, /renderNotificationBell\(\)/);
});

test('recipient settings use only authorized existing profiles and preserve loading, error, empty, retry and save states', () => {
  assert.match(source, /report-recipient-settings\.js\?v=\d+/);
  assert.match(source, /rpc\('list_daily_report_email_recipient_candidates'\)/);
  assert.match(source, /rpc\('save_daily_report_email_recipients'/);
  assert.match(source, /aria-labelledby="recipient-panel-title"/);
  assert.match(source, /id="recipient-list"[^>]*aria-busy="true"/);
  assert.match(source, /id="retry-recipients"/);
  assert.match(source, /id="save-recipients"/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /ZamReportRecipientSettings\.buildPayload/);
  assert.doesNotMatch(source, /<input[^>]+type=["']email["']/i, 'do not accept arbitrary email addresses');
  assert.match(source, /instant-forward-toggle/);
  assert.match(source, /schedule-form/);
});
