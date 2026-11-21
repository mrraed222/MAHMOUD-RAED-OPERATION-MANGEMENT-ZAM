const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const restroom = require('../assets/restroom-hourly.js');
const schedule = require('../assets/checklist-schedule.js');
const branchLifecycle = require('../assets/branch-lifecycle.js');

const at = value => new Date(value);
const config = { id: 'restroom-parent', task_title: 'النظافة الدورية لدورات المياه', category: 'الصالة', shift_type: 'Both', task_type: 'restroom_check', frequency: 'hourly', branch_id: null, is_active: true, requires_photo: true };
const branch = (id, name) => ({ branchId: id, branchName: name, shiftType: 'Morning' });
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261121160000_restroom_hourly_task_occurrences.sql'), 'utf8');
const employeePage = fs.readFileSync(path.join(root, 'my-checklist/index.html'), 'utf8');
const managerPage = fs.readFileSync(path.join(root, 'manage-templates/index.html'), 'utf8');
const ownerDashboardPage = fs.readFileSync(path.join(root, 'dashboard/index.html'), 'utf8');
const supervisorPage = fs.readFileSync(path.join(root, 'supervisor-dashboard/index.html'), 'utf8');
const logPage = fs.readFileSync(path.join(root, 'checklist-logs/index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'assets/supabase-config.js'), 'utf8');

function occurrence(shiftType, hour, businessDate, now, overrides = {}) {
  return restroom.getOccurrence({ shiftType, hour, businessDate, now: at(now), ...overrides });
}

test('تضم كل وردية عشرة مواعيد بالضبط وتظل الساعة 01:00 ضمن الوردية المسائية لليوم السابق', () => {
  assert.deepEqual(restroom.hoursForShift('Morning'), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(restroom.hoursForShift('Evening'), [16, 17, 18, 19, 20, 21, 22, 23, 0, 1]);
  assert.equal(restroom.hoursForShift('Morning').length, 10);
  assert.equal(restroom.hoursForShift('Evening').length, 10);
  assert.equal(restroom.isRestroomHourlyTask(config), true);
  assert.equal(restroom.isRestroomHourlyTask({ ...config, task_title: 'تنظيف وفحص دورة المياه كل ساعة', branch_id: 'main' }), false);
  assert.equal(restroom.executionDateForHour('Evening', 1, '2026-11-16'), '2026-11-17');
  assert.equal(restroom.occurrenceStartAt('2026-11-17', 1).toISOString(), '2026-11-16T22:00:00.000Z');
});

test('المهلة تنتهي عند 06:20 و15:20 و01:20 بتوقيت الرياض شاملةً لحظة الانتهاء', () => {
  for (const [shift, hour, date, before, deadline] of [
    ['Morning', 6, '2026-11-16', '2026-11-16T06:19:59+03:00', '2026-11-16T06:20:00+03:00'],
    ['Morning', 15, '2026-11-16', '2026-11-16T15:19:59+03:00', '2026-11-16T15:20:00+03:00'],
    ['Evening', 1, '2026-11-16', '2026-11-17T01:19:59+03:00', '2026-11-17T01:20:00+03:00']
  ]) {
    assert.equal(occurrence(shift, hour, date, before).status, 'open', `${shift} ${hour} قبل الحد`);
    const missed = occurrence(shift, hour, date, deadline);
    assert.equal(missed.status, 'missed', `${shift} ${hour} عند الحد`);
    assert.equal(missed.deadlineAt.toISOString(), at(deadline).toISOString());
  }
});

test('فوات موعد لا يغلق الموعد التالي ولا يغير حالته المستقلة', () => {
  const at0620 = restroom.getShiftOccurrences({ shiftType: 'Morning', businessDate: '2026-11-16', templateId: config.id, now: at('2026-11-16T06:20:00+03:00') });
  assert.equal(at0620[0].status, 'missed');
  assert.equal(at0620[1].status, 'upcoming');
  const at0710 = restroom.getShiftOccurrences({ shiftType: 'Morning', businessDate: '2026-11-16', templateId: config.id, now: at('2026-11-16T07:10:00+03:00') });
  assert.equal(at0710[0].status, 'missed');
  assert.equal(at0710[1].status, 'open');
  const at0720 = restroom.getShiftOccurrences({ shiftType: 'Morning', businessDate: '2026-11-16', templateId: config.id, now: at('2026-11-16T07:20:00+03:00') });
  assert.equal(at0720[0].status, 'missed');
  assert.equal(at0720[1].status, 'missed');
  assert.notEqual(restroom.occurrenceKey(config.id, at0720[0].executionDate, at0720[0].hour), restroom.occurrenceKey(config.id, at0720[1].executionDate, at0720[1].hour));
});

test('لا يسمح بمنح الإكمال بعد المهلة أو قبل تحديد الخطوات الأربع كاملة', () => {
  const all = restroom.stepsObjectFromKeys(restroom.STEP_KEYS);
  const partial = restroom.stepsObjectFromKeys(restroom.STEP_KEYS.slice(0, 3));
  const beforeDeadline = occurrence('Morning', 6, '2026-11-16', '2026-11-16T06:19:59+03:00');
  const atDeadline = occurrence('Morning', 6, '2026-11-16', '2026-11-16T06:20:00+03:00');
  assert.equal(restroom.canCompleteOccurrence(beforeDeadline, all, '2026-11-16T06:19:59+03:00'), true);
  assert.equal(restroom.canCompleteOccurrence(beforeDeadline, partial, '2026-11-16T06:19:59+03:00'), false);
  assert.equal(restroom.canCompleteOccurrence(atDeadline, all, '2026-11-16T06:20:00+03:00'), false);
  assert.match(sql, /IF v_now >= v_occurrence_start \+ INTERVAL '20 minutes' THEN[\s\S]*?انتهت مهلة العشرين دقيقة/);
  assert.match(sql, /IF p_steps IS DISTINCT FROM v_required_steps THEN/);
});

test('تشمل النطاقات التشغيلية وتفعّل الفرع المخطط فقط من تاريخ افتتاحه المؤكد بالرياض', () => {
  const active = [
    ['dcec5c36-94ab-42a2-92c9-f949eb5557b9', 'تجربة زام'],
    ['61a89d45-2bc3-4a28-9519-8dfc7fc23f37', 'زام البلد'],
    ['93f53332-73d0-4742-a9c0-ab15dd828acb', 'زام الرئيسي'],
    ['30956dd5-4eb1-408b-94b6-a29498b14b2e', 'زام المنح']
  ];
  for (const [id, name] of active) assert.equal(schedule.isTemplateVisibleInBranch(config, { ...branch(id, name), shiftType: 'Morning' }, at('2026-11-16T07:00:00+03:00')), true, name);
  assert.equal(schedule.isTemplateVisibleInBranch(config, branch('5da7b89d-089b-46a9-bc8e-3ad2582f9616', 'زام الحي'), at('2026-11-16T07:00:00+03:00')), false);
  assert.equal(schedule.isTemplateVisibleInBranch(config, branch('41f2dea8-238a-4550-abc8-b1a8a505f3d2', 'زام البرج'), at('2026-11-16T07:00:00+03:00')), false);
  const riyadhToday = '2026-11-16';
  assert.equal(branchLifecycle.isOperational({ lifecycle_status: 'planned', planned_opening_date: null }, at(`${riyadhToday}T07:00:00+03:00`)), false, 'planned without an opening date');
  assert.equal(branchLifecycle.isOperational({ lifecycle_status: 'planned', planned_opening_date: '2026-11-17' }, at(`${riyadhToday}T07:00:00+03:00`)), false, 'future opening date');
  assert.equal(branchLifecycle.isOperational({ lifecycle_status: 'planned', planned_opening_date: riyadhToday }, at(`${riyadhToday}T07:00:00+03:00`)), true, 'confirmed opening date has arrived');
  assert.match(sql, /v_branch\.lifecycle_status = 'planned'[\s\S]*?v_branch\.planned_opening_date IS NOT NULL[\s\S]*?v_branch\.planned_opening_date <= pg_catalog\.timezone\('Asia\/Riyadh', v_now\)::date/);
  assert.match(sql, /b\.lifecycle_status = 'planned'[\s\S]*?b\.planned_opening_date IS NOT NULL[\s\S]*?b\.planned_opening_date <= v_local_now::date/);
  assert.match(employeePage, /restroomBranchOperational = ZamBranchLifecycle\.isOperational\(branch, new Date\(\)\)/);
  assert.match(employeePage, /restroomBranchOperational &&[\s\S]*?زام الحي', 'زام البرج/);
  assert.match(supervisorPage, /!ZamBranchLifecycle\.isOperational\(cache\.branchHours, now\)/);
});

test('واجهة الموظف والإدارة تعرض المهمة الأم ومواعيدها وحالات الفوات والخطوات', () => {
  assert.match(employeePage, /renderRestroomParent\(task\)/);
  assert.match(employeePage, /تنبيه: فات الموعد وأُغلق بعد 20 دقيقة/);
  assert.match(employeePage, /class="restroom-photo/);
  assert.match(employeePage, /await uploadEvidence\(photoFile\)/);
  assert.match(employeePage, /submitRestroomHourlyOccurrence/);
  assert.match(api, /p_photo_url: photo_url/);
  assert.match(sql, /v_template\.requires_photo IS DISTINCT FROM true/);
  assert.match(sql, /o\.bucket_id = 'task-evidence'[\s\S]*?o\.name = v_object_name[\s\S]*?o\.owner = v_user_id/);
  assert.match(managerPage, /requiresPhoto\.disabled = isConfiguredRestroomTask/);
  assert.match(managerPage, /الجدول المخصص: 20 موعدًا بسجل مستقل/);
  assert.match(supervisorPage, /restroom-hourly-alert/);
  assert.match(supervisorPage, /غير منفذة/);
  assert.match(logPage, /خطوات/);
  assert.match(logPage, /steps_completed/);
});

test('لا يضيف migration الخاص بالمواعيد أي تغيير للجرد أو جدولة عامة', () => {
  assert.doesNotMatch(sql, /inventory_count/i);
  assert.doesNotMatch(sql, /cron\.schedule|zam-run-automations|run-scheduled-automations/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.branches|INSERT\s+INTO\s+public\.branches/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.mark_restroom_hourly_occurrences_not_performed/);
});

test('التهيئة تحول قالبًا ساعيًا واحدًا فقط وتبدأ عند الساعة الكاملة التالية', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.initialize_restroom_hourly_task\(p_template_id uuid\)/);
  assert.match(sql, /v_active_hourly_count <> 1/);
  assert.match(sql, /date_trunc\('hour',[\s\S]*?INTERVAL '1 hour'[\s\S]*?AT TIME ZONE 'Asia\/Riyadh'/);
  assert.match(sql, /NULL, true, NULL, 'hourly'/);
  assert.match(sql, /UPDATE public\.checklist_templates[\s\S]*?SET is_active = false[\s\S]*?WHERE id = v_old\.id/);
  assert.match(managerPage, /تهيئة الجدول المعتمد/);
  assert.match(managerPage, /initializeRestroomHourlyTask\(candidate\.id\)/);
});

test('لوحة المالك لا تحتسب المهمة الساعية على الفروع غير النشطة أو المستثناة أو دون إعداد نشط', () => {
  assert.match(ownerDashboardPage, /ZamBranchLifecycle\.isOperational\(branch, now\)/);
  assert.match(ownerDashboardPage, /الحي\|البرج/);
  assert.match(ownerDashboardPage, /restroomConfig\?\.is_active/);
  assert.match(ownerDashboardPage, /restroomConfig\.template_id === template\.id/);
});
