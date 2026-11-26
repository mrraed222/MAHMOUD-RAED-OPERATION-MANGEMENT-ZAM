import assert from 'node:assert/strict';
import { buildChecklistSummary } from '../supabase/functions/send-report-copy/checklist-summary.mjs';

const branchId = 'branch-a';
const templates = [
  { id: 'daily-morning', branch_id: branchId, task_type: 'routine', shift_type: 'Morning', frequency: 'daily', is_active: true },
  { id: 'both-daily', branch_id: null, task_type: 'routine', shift_type: 'Both', frequency: 'daily', is_active: true },
  { id: 'weekly-due', branch_id: branchId, task_type: 'routine', shift_type: 'Morning', frequency: 'weekly', days_of_week: [4], is_active: true },
  { id: 'weekly-not-due', branch_id: branchId, task_type: 'routine', shift_type: 'Morning', frequency: 'weekly', days_of_week: [5], is_active: true },
  { id: 'hourly-restroom', branch_id: branchId, task_type: 'restroom_check', shift_type: 'Morning', frequency: 'hourly', is_active: true },
  { id: 'other-branch', branch_id: 'branch-b', task_type: 'routine', shift_type: 'Morning', frequency: 'daily', is_active: true },
  { id: 'inactive', branch_id: branchId, task_type: 'routine', shift_type: 'Morning', frequency: 'daily', is_active: false },
  { id: 'inventory', branch_id: branchId, task_type: 'inventory_count', shift_type: 'Morning', frequency: 'daily', is_active: true },
  { id: 'linked-a', branch_id: 'branch-b', task_type: 'routine', shift_type: 'Morning', frequency: 'daily', is_active: true, checklist_template_branches: [{ branch_id: branchId }] },
];

const summary = buildChecklistSummary({
  templates,
  logs: [
    { template_id: 'daily-morning', branch_id: branchId, shift_type: 'Morning', execution_date: '2026-11-26', status: 'completed' },
    { template_id: 'daily-morning', branch_id: branchId, shift_type: 'Morning', execution_date: '2026-11-26', status: 'completed' },
    { template_id: 'both-daily', branch_id: branchId, shift_type: 'Evening', execution_date: '2026-11-26', status: 'completed' },
    { template_id: 'linked-a', branch_id: branchId, shift_type: 'Morning', execution_date: '2026-11-26', status: 'completed' },
  ],
  hourlyLogs: [
    { template_id: 'hourly-restroom', branch_id: branchId, shift_type: 'Morning', execution_date: '2026-11-26', status: 'completed' },
    { template_id: 'hourly-restroom', branch_id: branchId, shift_type: 'Morning', execution_date: '2026-11-26', status: 'not_performed' },
    { template_id: 'hourly-restroom', branch_id: 'branch-b', shift_type: 'Morning', execution_date: '2026-11-26', status: 'completed' },
    { template_id: 'hourly-restroom', branch_id: branchId, shift_type: 'Evening', execution_date: '2026-11-26', status: 'completed' },
  ],
  branchId,
  branchName: 'فرع اختبار',
  reportDate: '2026-11-26',
  shiftType: 'Morning',
  branchHours: { opening_time: '05:30:00', closing_time: '02:30:00' },
});
assert.deepEqual(summary, {
  nonHourly: { scheduled: 4, completed: 2, incomplete: 2 },
  hourly: { completed: 1, notPerformed: 1 },
}, 'summary should count due templates only and deduplicate completion by task');

const withoutApplicableHourlyTemplate = buildChecklistSummary({
  templates: [{ id: 'routine-only', branch_id: branchId, task_type: 'routine', shift_type: 'Morning', frequency: 'daily', is_active: true }],
  hourlyLogs: [
    { template_id: 'stale-hourly', branch_id: branchId, shift_type: 'Morning', execution_date: '2026-11-26', status: 'completed' },
    { template_id: null, branch_id: branchId, shift_type: 'Morning', execution_date: '2026-11-26', status: 'completed' },
  ],
  branchId,
  reportDate: '2026-11-26',
  shiftType: 'Morning',
});
assert.deepEqual(withoutApplicableHourlyTemplate, {
  nonHourly: { scheduled: 1, completed: 0, incomplete: 1 },
  hourly: { completed: 1, notPerformed: 0 },
}, 'logs tied to unmatched hourly templates should be excluded, but legacy logs without a template id remain countable');

const evening = buildChecklistSummary({
  templates: [{ id: 'night', branch_id: branchId, task_type: 'routine', shift_type: 'Evening', frequency: 'daily', is_active: true }],
  logs: [{ template_id: 'night', branch_id: branchId, shift_type: 'Evening', execution_date: '2026-11-27', created_at: '2026-11-27T00:15:00.000Z', status: 'done' }],
  branchId,
  reportDate: '2026-11-26',
  shiftType: 'Evening',
});
assert.deepEqual(evening, {
  nonHourly: { scheduled: 1, completed: 1, incomplete: 0 },
  hourly: { completed: 0, notPerformed: 0 },
}, 'evening logs after midnight in Riyadh should map to the report business date');

const trialBranchTemplate = [{ id: 'trial-hourly', branch_id: 'trial-branch', task_type: 'restroom_check', shift_type: 'Both', frequency: 'hourly', is_active: true }];
const trialBranchLogs = [
  { template_id: 'trial-hourly', branch_id: 'trial-branch', shift_type: 'Morning', execution_date: '2026-11-26', status: 'not_performed' },
  { template_id: 'trial-hourly', branch_id: 'trial-branch', shift_type: 'Evening', execution_date: '2026-11-27', created_at: '2026-11-27T00:15:00.000Z', status: 'completed' },
];
const trialMorning = buildChecklistSummary({ templates: trialBranchTemplate, hourlyLogs: trialBranchLogs, branchId: 'trial-branch', branchName: 'تجربة زام', reportDate: '2026-11-26', shiftType: 'Morning' });
const trialEvening = buildChecklistSummary({ templates: trialBranchTemplate, hourlyLogs: trialBranchLogs, branchId: 'trial-branch', branchName: 'تجربة زام', reportDate: '2026-11-26', shiftType: 'Evening' });
assert.deepEqual(trialMorning.hourly, { completed: 0, notPerformed: 0 }, 'the morning hourly count for تجربة زام follows the current checklist metrics rule');
assert.deepEqual(trialEvening.hourly, { completed: 1, notPerformed: 0 }, 'the evening hourly count for تجربة زام remains enabled');

const barOnly = buildChecklistSummary({
  templates: [
    { id: 'bar', branch_id: '41f2dea8-238a-4550-abc8-b1a8a505f3d2', category: 'البار', task_type: 'routine', shift_type: 'Morning', frequency: 'daily', is_active: true },
    { id: 'lounge', branch_id: '41f2dea8-238a-4550-abc8-b1a8a505f3d2', category: 'الصالة', task_type: 'routine', shift_type: 'Morning', frequency: 'daily', is_active: true },
  ],
  branchId: '41f2dea8-238a-4550-abc8-b1a8a505f3d2',
  reportDate: '2026-11-26',
  shiftType: 'Morning',
});
assert.equal(barOnly.nonHourly.scheduled, 1, 'bar-only branch lounge template must be excluded');

const hayBranch = buildChecklistSummary({
  templates: [{ id: 'restroom', branch_id: branchId, task_type: 'restroom_check', shift_type: 'Morning', frequency: 'hourly', is_active: true }],
  branchId,
  branchName: 'زام الحي',
  reportDate: '2026-11-26',
  shiftType: 'Morning',
});
assert.deepEqual(hayBranch, {
  nonHourly: { scheduled: 0, completed: 0, incomplete: 0 },
  hourly: { completed: 0, notPerformed: 0 },
}, 'restroom tasks for ZAM Al-Hay branch must remain excluded');

assert.equal(buildChecklistSummary({ branchId, reportDate: 'invalid', shiftType: 'Morning' }), null);
console.log('send-report-copy checklist summary tests: passed (synthetic branch/shift fixtures)');
