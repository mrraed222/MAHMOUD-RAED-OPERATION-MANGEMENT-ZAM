import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { sendEmailWithResend } from '../supabase/functions/send-report-copy/email-provider.mjs';
import { sendReportEmailOnce } from '../supabase/functions/send-report-copy/email-send-once.mjs';

const edgePath = new URL('../supabase/functions/send-report-copy/index.ts', import.meta.url);
const rawEdge = fs.readFileSync(edgePath, 'utf8').replace(
  'constructor(readonly status: number, readonly code: string) { super(code) }',
  'constructor(status, code) { super(code); this.status = status; this.code = code }',
);
// Node runs the production handler in-process; only the Deno server, Supabase,
// PDF builder and provider boundary are replaced with local deterministic stubs.
let handlerSource = stripTypeScriptTypes(rawEdge, { mode: 'strip' });
handlerSource = handlerSource.slice(handlerSource.indexOf('const corsHeaders ='))
  .replaceAll('import.meta.url', "'file:///tmp/send-report-copy-recipient-auth.test.ts'");

const branchId = '10000000-0000-4000-8000-000000000001';
const reportId = '30000000-0000-4000-8000-000000000001';
const owner = { id: '60000000-0000-4000-8000-000000000001', email: 'owner@example.test', role: 'Owner', status: 'active' };
const supervisorA = {
  id: '40000000-0000-4000-8000-000000000001', email: 'supervisor-a@example.test',
  role: 'Supervisor', status: 'active', branch_id: branchId, shift_type: 'Evening',
};
const supervisorB = {
  id: '50000000-0000-4000-8000-000000000001', email: 'supervisor-b@example.test',
  role: 'Supervisor', status: 'active', branch_id: branchId, shift_type: 'Evening',
};
const allBranchManager = {
  id: '70000000-0000-4000-8000-000000000001', email: 'all-branches@example.test',
  // Operations Manager is assigned to one branch, while the manager scope is all branches.
  role: 'Manager', status: 'active', branch_id: branchId,
  can_view_all_reports: false, can_view_daily_checklist_summary: true, can_view_analytics: true,
};
const legacyAllBranchManager = {
  id: '70000000-0000-4000-8000-000000000002', email: 'legacy-all-branches@example.test',
  role: 'Manager', status: 'active', branch_id: branchId,
  can_view_all_reports: true, can_view_daily_checklist_summary: true, can_view_analytics: true,
};
const branchManager = {
  id: '80000000-0000-4000-8000-000000000001', email: 'branch-manager@example.test',
  role: 'Manager', status: 'active', branch_id: branchId,
  can_view_all_reports: true, can_view_daily_checklist_summary: true, can_view_analytics: true,
};
const unrelatedBranchManager = {
  id: '90000000-0000-4000-8000-000000000001', email: 'unrelated-manager@example.test',
  role: 'Manager', status: 'active', branch_id: '10000000-0000-4000-8000-000000000002',
  can_view_all_reports: true, can_view_daily_checklist_summary: true, can_view_analytics: true,
};
const summaryOnlyManager = {
  id: 'a0000000-0000-4000-8000-000000000001', email: 'summary-only@example.test',
  role: 'Manager', status: 'active', branch_id: branchId,
  can_view_all_reports: true, can_view_daily_checklist_summary: true, can_view_analytics: false,
};
const analyticsOnlyManager = {
  id: 'c0000000-0000-4000-8000-000000000001', email: 'analytics-only@example.test',
  role: 'Manager', status: 'active', branch_id: branchId,
  can_view_all_reports: true, can_view_daily_checklist_summary: false, can_view_analytics: true,
};
const noneScopeManager = {
  id: 'b0000000-0000-4000-8000-000000000001', email: 'none-scope@example.test',
  role: 'Manager', status: 'active', branch_id: branchId,
  can_view_all_reports: false, can_view_daily_checklist_summary: true, can_view_analytics: true,
};
const branchBId = '10000000-0000-4000-8000-000000000002';
const reportB = {
  id: reportId, branch_id: branchId, submitted_by: supervisorB.id,
  supervisor_name: 'Supervisor B', report_date: '2026-11-22', shift_type: 'Evening',
  total_sales: 100, orders_count: 2, branches: { name: 'Branch A' },
};
const pdfBytes = new TextEncoder().encode('%PDF-mock-local-only');

// The RPC mock follows the clarified all-branches-only recipient rule and uses
// the canonical separate data-permission key. Configured recipients stay separate.
const mockManagerScopes = new Map([
  [allBranchManager.id, { mode: 'all', branchIds: [] }],
  [branchManager.id, { mode: 'selected', branchIds: [branchId] }],
  [unrelatedBranchManager.id, { mode: 'selected', branchIds: [branchBId] }],
  [summaryOnlyManager.id, { mode: 'all', branchIds: [] }],
  [analyticsOnlyManager.id, { mode: 'all', branchIds: [] }],
  [noneScopeManager.id, { mode: 'none', branchIds: [] }],
]);
function resolveMockRecipients(report, configuredRecipients) {
  const automaticManagement = [allBranchManager, legacyAllBranchManager, branchManager, unrelatedBranchManager, summaryOnlyManager, analyticsOnlyManager, noneScopeManager]
    .filter(profile => {
      const scope = mockManagerScopes.get(profile.id);
      const hasAllBranchesScope = scope?.mode === 'all'
        || (!scope && profile.can_view_all_reports === true);
      return profile.status === 'active' && profile.role === 'Manager'
        && profile.can_view_analytics === true
        && hasAllBranchesScope;
    })
    .map(profile => ({ profile_id: profile.id, email: profile.email, is_primary: false }));
  const knownProfiles = [owner, supervisorA, supervisorB, allBranchManager, legacyAllBranchManager,
    branchManager, unrelatedBranchManager, summaryOnlyManager, analyticsOnlyManager, noneScopeManager];
  const authorizedConfigured = configuredRecipients.filter(recipient => {
    const profile = knownProfiles.find(candidate => candidate.id === recipient.profile_id);
    if (!profile || profile.status !== 'active') return false;
    if (profile.role === 'Manager') {
      const scope = mockManagerScopes.get(profile.id);
      const branchAuthorized = scope?.mode === 'all'
        || (scope?.mode === 'selected' && scope.branchIds.includes(report.branch_id))
        || (!scope && profile.can_view_all_reports === true);
      return profile.can_view_analytics === true && branchAuthorized;
    }
    if (profile.role === 'Supervisor') return profile.id === report.submitted_by;
    return profile.role === 'Owner' || profile.role === 'Admin';
  });
  const merged = new Map();
  for (const recipient of [...authorizedConfigured, ...automaticManagement]) {
    const previous = merged.get(recipient.profile_id);
    merged.set(recipient.profile_id, {
      ...recipient,
      is_primary: Boolean(previous?.is_primary || recipient.is_primary),
    });
  }
  return [...merged.values()];
}

async function invoke({ actor, report = reportB, configuredRecipients, visible = true }) {
  const env = {
    SUPABASE_URL: 'https://supabase.mock.invalid',
    SUPABASE_ANON_KEY: 'anon-test-only',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-only',
    RESEND_API_KEY: 'resend-test-only',
  };
  let handler;
  let providerPayload;
  let serviceRoleCreated = false;
  const Deno = {
    env: { get: name => env[name] ?? undefined },
    serve: fn => { handler = fn; },
    readFile: async () => new Uint8Array([1, 2, 3]),
  };
  const userClient = {
    auth: { getUser: async () => ({ data: { user: { id: actor.id } }, error: null }) },
    rpc: async (name, args) => {
      if (name === 'can_generate_daily_report_copy') {
        if (args.p_report_id !== report.id || actor.status !== 'active') return { data: false, error: null };
        if (actor.role === 'Owner' || actor.role === 'Admin') return { data: true, error: null };
        if (actor.role === 'Manager') {
          const scope = mockManagerScopes.get(actor.id);
          const inScope = scope?.mode === 'all'
            || (scope?.mode === 'selected' && scope.branchIds.includes(report.branch_id))
            || (!scope && actor.can_view_all_reports === true);
          return { data: actor.can_view_analytics === true && inScope, error: null };
        }
        if (actor.role === 'Supervisor') {
          const shiftMatches = actor.shift_type === 'Both' || actor.shift_type === report.shift_type;
          return { data: actor.branch_id === report.branch_id && shiftMatches, error: null };
        }
        return { data: false, error: null };
      }
      throw new Error(`unexpected user RPC: ${name}`);
    },
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => table === 'daily_reports' && visible
          ? { data: { id: report.id, branch_id: report.branch_id, shift_type: report.shift_type, submitted_by: report.submitted_by }, error: null }
          : { data: null, error: null },
      };
    },
  };
  let resolvedRecipients = [];
  const adminClient = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        maybeSingle: async () => table === 'profiles'
          ? { data: actor, error: null }
          : table === 'daily_reports' ? { data: report, error: null } : { data: null, error: null },
        range: async () => ({ data: [], error: null }),
      };
    },
    rpc: async name => {
      if (name === 'get_daily_report_copy_recipients') {
        resolvedRecipients = resolveMockRecipients(report, configuredRecipients);
        return { data: resolvedRecipients, error: null };
      }
      if (name === 'claim_daily_report_email_send') {
        return { data: { decision: 'send', idempotency_key: `mock-report-copy:${report.id}` }, error: null };
      }
      if (name === 'finish_daily_report_email_send') return { data: true, error: null };
      throw new Error(`unexpected mock RPC: ${name}`);
    },
  };
  const createClient = (_url, key) => {
    if (key === env.SUPABASE_ANON_KEY) return userClient;
    serviceRoleCreated = true;
    return adminClient;
  };
  const sendEmail = options => sendEmailWithResend({
    ...options,
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails');
      providerPayload = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ id: 'mock-provider-receipt' }) };
    },
  });
  const buildDailyReportPdf = async () => pdfBytes;
  new Function(
    'createClient', 'jsPDF', 'buildDailyReportPdf', 'sendEmailWithResend', 'sendReportEmailOnce', 'Deno', handlerSource,
  )(createClient, function MockJsPdf() {}, buildDailyReportPdf, sendEmail, sendReportEmailOnce, Deno);

  const response = await handler(new Request('https://edge.mock.invalid/send-report-copy', {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic-session', 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_id: report.id }),
  }));
  return { response, result: await response.json(), providerPayload, resolvedRecipients, serviceRoleCreated };
}

assert.equal(supervisorA.status, 'active');
assert.equal(supervisorB.status, 'active');
assert.equal(supervisorA.branch_id, supervisorB.branch_id);
assert.equal(supervisorA.branch_id, reportB.branch_id);
assert.equal(supervisorA.shift_type, supervisorB.shift_type);
assert.equal(supervisorA.shift_type, reportB.shift_type);

const configuredForB = [
  { profile_id: owner.id, email: owner.email, is_primary: true },
  { profile_id: supervisorB.id, email: supervisorB.email, is_primary: false },
];
assert.deepEqual(configuredForB.map(row => row.profile_id).sort(), [owner.id, supervisorB.id].sort(),
  'the configured list contains only the report Owner and Supervisor');
const requestByA = await invoke({ actor: supervisorA, configuredRecipients: configuredForB, visible: true });
assert.equal(requestByA.response.status, 200, 'same-branch, same-shift Supervisor A can request B\'s PDF under current report visibility');
assert.equal(requestByA.result.email_sent, true);
assert.equal(Buffer.from(requestByA.result.pdf_base64, 'base64').toString(), '%PDF-mock-local-only', 'authorized PDF remains available in the app response');
const resolvedIdsForB = requestByA.resolvedRecipients.map(row => row.profile_id);
assert.ok(resolvedIdsForB.includes(allBranchManager.id), 'the resolver adds the all-branch Manager automatically');
assert.ok(resolvedIdsForB.includes(legacyAllBranchManager.id), 'legacy can_view_all_reports may stand in for all scope only when no explicit scope exists and the new data permission is set');
assert.ok(!resolvedIdsForB.includes(branchManager.id), 'the resolver excludes a Manager scoped only to this selected branch');
assert.ok(!resolvedIdsForB.includes(unrelatedBranchManager.id), 'the resolver excludes a Manager scoped only to another selected branch');
assert.ok(!resolvedIdsForB.includes(summaryOnlyManager.id),
  'legacy and all-branches scope cannot qualify a Manager without analytics/detail permission');
assert.ok(!resolvedIdsForB.includes(noneScopeManager.id), 'none branch scope cannot qualify a Manager for the report');
assert.equal(requestByA.providerPayload.to, 'operations@zam.sa', 'the shared To field must not contain the recipient list');
assert.deepEqual(requestByA.providerPayload.bcc.slice().sort(),
  [owner.email, supervisorB.email, allBranchManager.email, legacyAllBranchManager.email, analyticsOnlyManager.email].sort(),
  'only all-branches managers with analytics/detail permission are included in private BCC alongside configured recipients');
assert.ok(!requestByA.providerPayload.bcc.includes(supervisorA.email));
assert.ok(!requestByA.providerPayload.bcc.includes(branchManager.email), 'a same-branch Manager with selected-only scope is not an automatic recipient');
assert.ok(!requestByA.providerPayload.bcc.includes(unrelatedBranchManager.email), 'a manager scoped to another selected branch is excluded');
assert.ok(!requestByA.providerPayload.bcc.includes(summaryOnlyManager.email), 'a Manager role alone does not grant analytics/detail permission');
assert.ok(!requestByA.providerPayload.bcc.includes(noneScopeManager.email), 'none-scope Managers are excluded from daily report copies');

const ownerExcludedByResolver = await invoke({ actor: supervisorB, configuredRecipients: [] });
assert.equal(ownerExcludedByResolver.response.status, 200);
assert.ok(!ownerExcludedByResolver.resolvedRecipients.some(row => row.profile_id === owner.id));
assert.ok(!ownerExcludedByResolver.providerPayload.bcc.includes(owner.email),
  'an active Owner omitted by the report-scoped resolver must not be appended as a global fallback');

const ownReportByB = await invoke({
  actor: supervisorB,
  configuredRecipients: [{ profile_id: owner.id, email: owner.email, is_primary: true }],
});
assert.equal(ownReportByB.response.status, 200);
assert.ok(ownReportByB.providerPayload.bcc.includes(supervisorB.email), 'the report supervisor still receives their own report privately');
assert.ok(!ownReportByB.providerPayload.bcc.includes(supervisorA.email));

const managerRequest = await invoke({ actor: branchManager, configuredRecipients: configuredForB, visible: true });
assert.equal(managerRequest.response.status, 200, 'an authorized branch manager can still retrieve the PDF');
assert.equal(Buffer.from(managerRequest.result.pdf_base64, 'base64').toString(), '%PDF-mock-local-only');
assert.ok(!managerRequest.providerPayload.bcc.includes(branchManager.email), 'selected-branch scope does not make a Manager an automatic copy recipient');
assert.ok(managerRequest.providerPayload.bcc.includes(allBranchManager.email), 'the all-branches Operations Manager remains included despite a one-branch profile assignment');
assert.ok(managerRequest.providerPayload.bcc.includes(legacyAllBranchManager.email));
assert.ok(!managerRequest.providerPayload.bcc.includes(unrelatedBranchManager.email));

const manuallyConfiguredManagers = await invoke({
  actor: supervisorB,
  configuredRecipients: [
    { profile_id: owner.id, email: owner.email, is_primary: true },
    { profile_id: branchManager.id, email: branchManager.email, is_primary: false },
    { profile_id: summaryOnlyManager.id, email: summaryOnlyManager.email, is_primary: false },
  ],
});
assert.ok(manuallyConfiguredManagers.providerPayload.bcc.includes(branchManager.email),
  'a manually selected Manager receives the report only when analytics permission and selected branch scope both pass');
assert.ok(!manuallyConfiguredManagers.providerPayload.bcc.includes(summaryOnlyManager.email),
  'a manually selected summary-only Manager is excluded from the full-detail PDF at send time');

const summaryOnlyManagerRequest = await invoke({
  actor: summaryOnlyManager,
  configuredRecipients: configuredForB,
  visible: true,
});
assert.equal(summaryOnlyManagerRequest.response.status, 404,
  'a summary-only Manager cannot retrieve a full-detail PDF');
assert.equal(summaryOnlyManagerRequest.providerPayload, undefined,
  'the provider is never called when a summary-only Manager requests a full PDF');
assert.equal(summaryOnlyManagerRequest.result.pdf_base64, undefined,
  'no report PDF is returned to a summary-only Manager');
assert.equal(summaryOnlyManagerRequest.serviceRoleCreated, false,
  'the report-copy gate rejects a summary-only Manager before creating a service-role client');

const analyticsOnlyManagerRequest = await invoke({
  actor: analyticsOnlyManager,
  configuredRecipients: configuredForB,
  visible: true,
});
assert.equal(analyticsOnlyManagerRequest.response.status, 200,
  'analytics-only Manager with matching all-branch scope can retrieve the full PDF');
assert.equal(analyticsOnlyManagerRequest.result.email_sent, true);
assert.equal(Buffer.from(analyticsOnlyManagerRequest.result.pdf_base64, 'base64').toString(), '%PDF-mock-local-only');
assert.ok(analyticsOnlyManagerRequest.resolvedRecipients.some(row => row.profile_id === analyticsOnlyManager.id),
  'analytics-only Manager is included in default full-PDF recipients when all-scope applies');

const noneScopeManagerRequest = await invoke({ actor: noneScopeManager, configuredRecipients: configuredForB });
assert.equal(noneScopeManagerRequest.response.status, 404, 'a Manager with none scope cannot retrieve a report copy');
assert.equal(noneScopeManagerRequest.serviceRoleCreated, false,
  'none-scope denial happens before service-role client creation');
assert.equal(noneScopeManagerRequest.providerPayload, undefined);

console.log('send-report-copy recipient authorization tests: configured-vs-automatic recipients, manager analytics/detail gate, and recipient ownership passed (mocked Supabase/PDF/provider; no live email)');
