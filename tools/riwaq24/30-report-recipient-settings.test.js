const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helperPath = path.join(__dirname, '../../assets/report-recipient-settings.js');
const source = fs.readFileSync(helperPath, 'utf8');
const context = { globalThis: {} };
vm.runInNewContext(source, context, { filename: helperPath });
const recipients = context.globalThis.ZamReportRecipientSettings;

const branches = [
  { id: 'branch-a', name: 'الفرع الأول', lifecycle_status: 'operational' },
  { id: 'branch-b', name: 'الفرع الثاني', lifecycle_status: 'operational' },
  { id: 'branch-planned', name: 'فرع مخطط', lifecycle_status: 'planned' },
];
const supervisorBranches = [branches[0], branches[2]];
const accounts = [
  { profile_id: 'owner-1', full_name: 'Owner', email: 'owner@example.test', role: 'Owner', is_selected: true, can_be_primary: true, authorized_branches: branches },
  { profile_id: 'manager-1', full_name: 'Scoped manager', email: 'manager@example.test', role: 'Manager', is_selected: false, can_be_primary: true, scope_mode: 'selected', authorized_branches: branches },
  { profile_id: 'supervisor-1', full_name: '<img src=x>', email: 'sup@example.test', role: 'Supervisor', is_selected: false, can_be_primary: false, scope_mode: 'selected', authorized_branches: supervisorBranches },
];

test('recipient UI exposes loading, error and empty states and escapes account-provided text', () => {
  assert.match(recipients.render({ status: 'loading' }), /role="status"/);
  assert.match(recipients.render({ status: 'error' }), /role="alert"/);
  assert.match(recipients.render({ accounts: [] }), /لا توجد حسابات نشطة/);
  const html = recipients.render({ accounts });
  assert.match(html, /مالك النظام — مستلم ثابت/);
  assert.match(html, /disabled aria-label="مالك النظام/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /مشرف الوردية يتلقى التقرير الذي سجّله بنفسه فقط/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /data-recipient-branch="branch-planned"/);
  assert.doesNotMatch(html, /type="email"|email-input|إضافة بريد/);
});

test('payload is limited to existing candidates and the candidate authorization set', () => {
  const payload = recipients.buildPayload(accounts, {
    selectedIds: ['supervisor-1'],
    primaryId: 'owner-1',
    scopes: { 'supervisor-1': { scope_mode: 'selected', branch_ids: ['branch-a'] } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    recipients: [
      { profile_id: 'owner-1', scope_mode: 'all_authorized', branch_ids: [] },
      { profile_id: 'supervisor-1', scope_mode: 'selected', branch_ids: ['branch-a'] },
    ],
    p_primary_profile_id: 'owner-1',
  });
  assert.throws(() => recipients.buildPayload(accounts, {
    selectedIds: ['invented-id'], primaryId: 'owner-1', scopes: {},
  }), /unknown_recipient/);
  assert.throws(() => recipients.buildPayload(accounts, {
    selectedIds: [], primaryId: 'supervisor-1', scopes: {},
  }), /primary_recipient_required/);
  assert.throws(() => recipients.buildPayload(accounts, {
    selectedIds: ['supervisor-1'], primaryId: 'owner-1',
    scopes: { 'supervisor-1': { scope_mode: 'selected', branch_ids: ['branch-planned'] } },
  }), /branch_outside_authorized_scope/);
  assert.throws(() => recipients.buildPayload(accounts, {
    selectedIds: ['supervisor-1'], primaryId: 'supervisor-1',
    scopes: { 'supervisor-1': { scope_mode: 'all_authorized', branch_ids: [] } },
  }), /primary_not_authorized/);
  assert.throws(() => recipients.buildPayload(accounts, {
    selectedIds: ['supervisor-1'], primaryId: 'owner-1',
    scopes: { 'supervisor-1': { scope_mode: 'selected', branch_ids: [] } },
  }), /selected_branches_required/);
  const scopedPrimary = recipients.buildPayload(accounts, {
    selectedIds: ['manager-1'], primaryId: 'manager-1',
    scopes: { 'manager-1': { scope_mode: 'selected', branch_ids: ['branch-b'] } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(scopedPrimary)), {
    recipients: [
      { profile_id: 'owner-1', scope_mode: 'all_authorized', branch_ids: [] },
      { profile_id: 'manager-1', scope_mode: 'selected', branch_ids: ['branch-b'] },
    ],
    p_primary_profile_id: 'manager-1',
  });
  assert.throws(() => recipients.buildPayload(accounts, {
    selectedIds: ['manager-1'], primaryId: 'manager-1',
    scopes: { 'manager-1': { scope_mode: 'selected', branch_ids: ['branch-planned'] } },
  }), /branch_outside_authorized_scope/);
});
