const test = require('node:test');
const assert = require('node:assert/strict');
const checklistSave = require('../assets/checklist-save.js');

const liveProfile = {
  id: 'user-1',
  role: 'Supervisor',
  status: 'active',
  branch_id: 'branch-live',
  shift_type: 'Morning',
};

function createClient({ profile = liveProfile, eligible = true, eligibilityError = null } = {}) {
  const events = [];
  const rpcCalls = [];
  const client = {
    auth: {
      async getUser() {
        events.push('auth');
        return { data: { user: { id: 'user-1' } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select(columns) {
          events.push(`profile-select:${columns}`);
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, 'user-1');
              return {
                async maybeSingle() {
                  events.push('profile-read');
                  return { data: profile, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      events.push('eligibility');
      rpcCalls.push({ name, args });
      return { data: eligible, error: eligibilityError };
    },
  };
  return { client, events, rpcCalls };
}

test('saves a checklist completion without a photo using the live user, branch and assigned shift', async () => {
  const { client, events, rpcCalls } = createClient({
    profile: { ...liveProfile, branch_id: 'branch-live', shift_type: 'Morning' },
  });
  let saved;
  const result = await checklistSave.submitChecklistExecution({
    client,
    sessionProfile: { id: 'user-1', branch_id: 'branch-stale', shift_type: 'Evening' },
    templateId: 'template-1',
    shiftType: 'Morning',
    notes: '  تم التنظيف  ',
    saveLog: async payload => {
      events.push('insert');
      saved = payload;
      return { id: 'log-1' };
    },
  });
  assert.deepEqual(events.slice(0, 4), ['auth', 'profile-select:id,role,status,branch_id,shift_type', 'profile-read', 'eligibility']);
  assert.equal(events.at(-1), 'insert');
  assert.deepEqual(rpcCalls[0], {
    name: 'can_employee_execute_checklist_template',
    args: { p_template_id: 'template-1', p_branch_id: 'branch-live', p_shift_type: 'Morning' },
  });
  assert.deepEqual(saved, {
    template_id: 'template-1',
    branch_id: 'branch-live',
    executed_by: 'user-1',
    status: 'Completed',
    notes: 'تم التنظيف',
    shift_type: 'Morning',
  });
  assert.equal(result.result.id, 'log-1');
  assert.equal(result.evidence, null);
});

test('checks eligibility before uploading a photo and includes the uploaded URL in the saved log', async () => {
  const { client, events } = createClient();
  const file = { name: 'proof.jpg' };
  let saved;
  const result = await checklistSave.submitChecklistExecution({
    client,
    sessionProfile: { id: 'user-1' },
    templateId: 'template-photo',
    shiftType: 'Morning',
    photoFile: file,
    uploadEvidence: async (receivedFile, userId) => {
      events.push('upload');
      assert.equal(receivedFile, file);
      assert.equal(userId, 'user-1');
      return { url: 'https://storage.invalid/proof.jpg', path: 'user-1/proof.jpg' };
    },
    saveLog: async payload => {
      events.push('insert');
      saved = payload;
      return { id: 'log-photo' };
    },
  });
  assert.ok(events.indexOf('eligibility') < events.indexOf('upload'));
  assert.ok(events.indexOf('upload') < events.indexOf('insert'));
  assert.equal(saved.photo_url, 'https://storage.invalid/proof.jpg');
  assert.equal(result.evidence.path, 'user-1/proof.jpg');
});

test('denied task eligibility stops both photo upload and log insertion', async () => {
  const { client, events } = createClient({ eligible: false });
  let uploadCalls = 0;
  let saveCalls = 0;
  await assert.rejects(
    checklistSave.submitChecklistExecution({
      client,
      sessionProfile: { id: 'user-1' },
      templateId: 'unassigned-template',
      shiftType: 'Morning',
      photoFile: { name: 'proof.jpg' },
      uploadEvidence: async () => { uploadCalls += 1; return { url: 'https://storage.invalid/proof.jpg' }; },
      saveLog: async () => { saveCalls += 1; },
    }),
    error => error.code === 'CHECKLIST_EXECUTION_SCOPE_DENIED',
  );
  assert.equal(uploadCalls, 0);
  assert.equal(saveCalls, 0);
  assert.equal(events.includes('insert'), false);
});

test('a genuine RLS insert rejection remains visible and marks an already-uploaded photo', async () => {
  const { client, events } = createClient();
  await assert.rejects(
    checklistSave.submitChecklistExecution({
      client,
      sessionProfile: { id: 'user-1' },
      templateId: 'template-photo',
      shiftType: 'Morning',
      photoFile: { name: 'proof.jpg' },
      uploadEvidence: async () => ({ url: 'https://storage.invalid/proof.jpg', path: 'user-1/proof.jpg' }),
      saveLog: async () => { events.push('insert'); throw Object.assign(new Error('row-level security policy rejected insert'), { code: '42501' }); },
    }),
    error => error.code === '42501' && error.checklistEvidenceUploaded === true && error.checklistEvidencePath === 'user-1/proof.jpg',
  );
  assert.ok(events.indexOf('eligibility') < events.indexOf('insert'));
});

test('single-shift profiles cannot submit under the other shift', async () => {
  const { client, events } = createClient();
  let saveCalls = 0;
  await assert.rejects(
    checklistSave.submitChecklistExecution({
      client,
      sessionProfile: { id: 'user-1' },
      templateId: 'template-1',
      shiftType: 'Evening',
      saveLog: async () => { saveCalls += 1; },
    }),
    error => error.code === 'ZAM_SHIFT_SCOPE_MISMATCH',
  );
  assert.equal(events.includes('eligibility'), false);
  assert.equal(saveCalls, 0);
});

test('template filtering hides only explicitly ineligible tasks and fails closed on RPC errors', async () => {
  const { client } = createClient({ eligible: true });
  const results = await checklistSave.filterEligibleTemplates({
    client,
    profile: liveProfile,
    templates: [{ id: 't1' }, { id: 't2' }],
    shiftType: 'Morning',
  });
  assert.deepEqual(results, [{ id: 't1' }, { id: 't2' }]);

  const denied = createClient({ eligible: false });
  const hidden = await checklistSave.filterEligibleTemplates({
    client: denied.client,
    profile: liveProfile,
    templates: [{ id: 't1' }, { id: 't2' }],
    shiftType: 'Morning',
  });
  assert.deepEqual(hidden, []);

  const failed = createClient({ eligibilityError: Object.assign(new Error('RPC unavailable'), { code: '503' }) });
  await assert.rejects(checklistSave.filterEligibleTemplates({
    client: failed.client,
    profile: liveProfile,
    templates: [{ id: 't1' }],
    shiftType: 'Morning',
  }), error => error.code === '503');
});
