const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../supervisor-checklist/index.html'), 'utf8');

test('supervisor checklist presents branch/shift context, summary, urgent receiving, tasks, notes, then report action', () => {
  const positions = [
    source.indexOf('id="page-title"'),
    source.indexOf('class="supervisor-summary"'),
    source.indexOf('id="inventory-receiving-tasks-section"'),
    source.indexOf('id="shift-tasks"'),
    source.indexOf('id="team-notes"'),
    source.indexOf('id="report-action-title"')
  ];
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(source, /id="branch-sub-label"/);
  assert.match(source, /id="summary-shift"/);
});

test('role guard, branch lifecycle, shift semantics and operational destinations are preserved', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Owner', 'Admin'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(currentBranchLifecycle, new Date\(\)\)/);
  assert.match(source, /ZamChecklistSchedule\.getShiftWindow\(currentShift, currentBranchHours, now\)/);
  assert.match(source, /get_open_inventory_receipt_tasks/);
  assert.match(source, /complete_inventory_receipt_item/);
  assert.match(source, /p_item_verified: completion\.itemVerified/);
  assert.match(source, /submitFridgeReadings\(entries,\s*\{\s*branch_id: currentUser\.branch_id,\s*recorded_by: currentUser\.id,\s*shift_type: currentShift/);
  assert.match(source, /checklist-save\.js\?v=\d+/);
  assert.match(source, /ZamChecklistSave\.getLiveProfile\(zamClient, currentUser\)/);
  assert.match(source, /ZamChecklistSave\.submitChecklistExecution\(/);
  assert.match(source, /saveLog: payload => ZamAPI\.submitChecklistLog\(payload\)/);
  assert.match(source, /templateId: cb\.dataset\.id/);
  assert.match(source, /photoFile: file/);
  assert.match(source, /\.from\('team_notes'\)\s*\.select\('id, profile_id, branch_id, shift_type, note, created_at, profiles\(full_name, avatar_url\)'\)/);
  assert.match(source, /window\.location\.href = '\.\.\/daily-report\/index\.html'/);
  assert.match(source, /href=\"\.\.\/inventory-requests\/index\.html\?shift=\$\{currentShift\}\"/);
});

test('empty, loading, error and retry states are accessible and user actions remain real', () => {
  assert.match(source, /جارٍ تحميل مهام الاستلام/);
  assert.match(source, /لا توجد دفعات استلام مفتوحة/);
  assert.match(source, /تعذّر تحميل مهام الاستلام/);
  assert.match(source, /id="retry-checklist-btn"/);
  assert.match(source, /addEventListener\('click', loadChecklist\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /id="save-note-btn"/);
  assert.match(source, /id="send-report-btn"/);
  assert.doesNotMatch(source, /notif-bell-slot/);
});

test('saved checklist logs match execution-date window and shift, not created_at', () => {
  const helperSource = source.match(/function checklistLogMatchesShiftWindow\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helperSource, 'the shift/date matcher must be defined');
  const matchesShift = vm.runInNewContext(`(${helperSource})`);
  const shiftWindow = {
    businessDate: '2026-11-26',
    dateFrom: '2026-11-26',
    dateTo: '2026-11-27',
    startAt: new Date('2026-11-26T12:30:00.000Z'),
    graceEndAt: new Date('2026-11-27T00:30:00.000Z')
  };
  const delayedRecord = {
    execution_date: '2026-11-26',
    shift_type: 'Evening',
    created_at: '2026-11-26T07:00:00.000Z'
  };

  assert.equal(matchesShift(delayedRecord, shiftWindow, 'Evening'), true,
    'a matching saved date/shift remains visible even if created_at falls outside the shift window');
  assert.equal(matchesShift({ ...delayedRecord, shift_type: 'Morning' }, shiftWindow, 'Evening'), false);
  assert.equal(matchesShift({ ...delayedRecord, execution_date: '2026-11-25' }, shiftWindow, 'Evening'), false);
  assert.equal(matchesShift({ ...delayedRecord, shift_type: null }, shiftWindow, 'Evening', 'Evening'), true,
    'legacy rows may resolve their shift from the assigned template');

  const loader = source.match(/async function loadChecklist\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(loader, /checklistLogMatchesShiftWindow/);
  assert.doesNotMatch(loader, /Date\.parse\((?:l|log)\.created_at/);
});

test('save failures tell the supervisor to verify shift and assignment with or without evidence', () => {
  const helperSource = source.match(/function checklistSaveErrorMessage\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helperSource, 'the save error formatter must be defined');
  const messageFor = vm.runInNewContext(`(${helperSource})`);

  const permissionMessage = messageFor({ code: '42501', message: 'row-level security policy rejected insert' });
  assert.match(permissionMessage, /42501/);
  assert.match(permissionMessage, /التكليف/);
  assert.match(permissionMessage, /الوردية/);
  assert.match(permissionMessage, /row-level security policy rejected insert/);
  assert.match(messageFor({
    code: 'CHECKLIST_EXECUTION_SCOPE_DENIED',
    message: 'هذه المهمة ليست مؤهلة لحسابك في الفرع والوردية الحالية؛ لم يتم رفع الصورة أو حفظ السجل.'
  }), /لم يتم رفع الصورة أو حفظ السجل/);
  assert.match(messageFor({ code: '23505' }, true), /تم رفع الصورة، لكن لم يُحفظ سجل التنفيذ/);
  assert.match(messageFor({ code: '23505' }, true), /محفوظة بالفعل/);
  assert.match(source, /statusSpan\.textContent = checklistSaveErrorMessage\(err\);/,
    'no-photo save failures must be visible beside the task');
  assert.match(source, /checklistSaveErrorMessage\(err, Boolean\(err\?\.checklistEvidenceUploaded\)\)/,
    'photo-upload success followed by save failure must be reported as a save failure');
});

test('supervisor sees individually assigned tasks from other categories without widening branch, shift, schedule or save permissions', () => {
  const helperSource = source.match(/function supervisorTemplatesForSubTab\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helperSource, 'the supervisor tab selector must be defined');
  const selectForTab = vm.runInNewContext(`(${helperSource})`, {
    SUPERVISOR_TASK_CATEGORIES: new Set(['المشرف', 'إشراف', 'مهام المشرفين']),
    supervisorAssignedTemplateIds: new Set(['assigned-bar', 'assigned-kitchen']),
    activeSubTab: 'my-tasks'
  });
  const templates = [
    { id: 'supervisor-category', category: 'المشرف' },
    { id: 'assigned-bar', category: 'البار' },
    { id: 'assigned-kitchen', category: 'المطبخ' },
    { id: 'team-bar', category: 'البار' }
  ];
  assert.deepEqual(Array.from(selectForTab(templates, 'my-tasks'), task => task.id), [
    'supervisor-category', 'assigned-bar', 'assigned-kitchen'
  ]);
  assert.deepEqual(Array.from(selectForTab(templates, 'team-tasks'), task => task.id), ['team-bar']);

  const loader = source.match(/async function loadChecklist\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(loader, /ZamAPI\.getTemplates\(categoryFilter, currentShift, currentUser\.branch_id\)/,
    'template lookup remains restricted to the current branch and selected shift');
  assert.match(loader, /ZamAPI\.getMyAssignedTemplateIds\(\)/,
    'the individually assigned IDs are read for this authenticated supervisor');
  assert.match(loader, /loadedTemplates\.filter\(isTaskDueForCurrentShift\)/,
    'existing schedule and branch/shift visibility checks remain in place');
  assert.match(source, /ZamChecklistSave\.submitChecklistExecution\(/,
    'saving continues through the existing RPC/RLS-checked execution path');
  assert.doesNotMatch(source, /filterEligibleTemplates\(/,
    'the client-side eligibility pre-filter must not hide tasks before display');
});
