const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedule = require('../assets/checklist-schedule.js');
const dashboard = require('../assets/checklist-dashboard.js');

const atRiyadh = value => new Date(value);
const MAIN_ID = '93f53332-73d0-4742-a9c0-ab15dd828acb';
const HAY_ID = '5da7b89d-089b-46a9-bc8e-3ad2582f9616';
const MANAH_ID = '30956dd5-4eb1-408b-94b6-a29498b14b2e';
const BURJ_ID = '41f2dea8-238a-4550-abc8-b1a8a505f3d2';
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261116175407_checklist_recurrence_and_history.sql'), 'utf8');
const multiDayMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261117162200_multi_day_weekly_templates.sql'), 'utf8');
const branchHoursMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261117150330_branch_opening_closing_times.sql'), 'utf8');
const operationalMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261117220000_zam_checklist_operational_updates.sql'), 'utf8');
const supervisorPage = fs.readFileSync(path.join(__dirname, '..', 'supervisor-checklist', 'index.html'), 'utf8');
const employeePage = fs.readFileSync(path.join(__dirname, '..', 'my-checklist', 'index.html'), 'utf8');
const adminLogPage = fs.readFileSync(path.join(__dirname, '..', 'checklist-logs', 'index.html'), 'utf8');
const templateAdminPage = fs.readFileSync(path.join(__dirname, '..', 'manage-templates', 'index.html'), 'utf8');
const dashboardPage = fs.readFileSync(path.join(__dirname, '..', 'supervisor-dashboard', 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'assets', 'supabase-config.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function waiter(branchId, branchName, shiftType = 'Morning') {
  return { role: 'Waiter', branchId, branchName, categories: ['الصالة'], shiftType };
}

test('تاريخ اليوم يُحسب بتوقيت الرياض حتى عندما يتغير اليوم UTC قبل الرياض', () => {
  assert.equal(schedule.riyadhDateString(atRiyadh('2026-11-15T21:30:00.000Z')), '2026-11-16');
  assert.equal(schedule.riyadhDateString(atRiyadh('2026-11-16T20:59:00.000Z')), '2026-11-16');
  assert.equal(schedule.riyadhDateString(atRiyadh('2026-11-16T21:00:00.000Z')), '2026-11-17');
});

test('ساعات الفروع تبدأ 05:30 وتنهي الوردية المسائية 02:30 في اليوم التالي بتوقيت الرياض', () => {
  const branchHours = { opening_time: '05:30:00', closing_time: '02:30:00' };
  const beforeOpen = atRiyadh('2026-11-16T05:29:00+03:00');
  const opening = atRiyadh('2026-11-16T05:30:00+03:00');
  const eveningStart = atRiyadh('2026-11-16T15:30:00+03:00');
  const afterMidnight = atRiyadh('2026-11-17T00:30:00+03:00');
  const morningWindow = schedule.getShiftWindow('Morning', branchHours, opening);
  const eveningWindow = schedule.getShiftWindow('Evening', branchHours, eveningStart);
  assert.equal(morningWindow.startMinute, 5 * 60 + 30);
  assert.equal(morningWindow.endMinute, 15 * 60 + 30);
  assert.equal(schedule.isWithinShiftTaskWindow('Morning', branchHours, beforeOpen), false);
  assert.equal(schedule.isWithinShiftTaskWindow('Morning', branchHours, opening), true);
  assert.equal(eveningWindow.startMinute, 15 * 60 + 30);
  assert.equal(eveningWindow.endMinute, 24 * 60 + 2 * 60 + 30);
  assert.equal(eveningWindow.businessDate, '2026-11-16');
  assert.equal(eveningWindow.dateTo, '2026-11-17');
  assert.equal(eveningWindow.endAt.toISOString(), '2026-11-16T23:30:00.000Z');
  assert.equal(schedule.getShiftWindow('Evening', branchHours, afterMidnight).businessDate, '2026-11-16');
  assert.equal(schedule.isWithinShiftTaskWindow('Evening', branchHours, afterMidnight), true);
  assert.equal(dashboard.initialDashboardShift({ role: 'Owner' }, afterMidnight), 'Evening');
  assert.equal(dashboard.initialDashboardShift({ role: 'Admin' }, atRiyadh('2026-11-17T04:00:00+03:00')), 'Morning');
  const addedColumns = [...branchHoursMigration.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/gi)].map(match => match[1]);
  assert.deepEqual(addedColumns, ['opening_time', 'closing_time']);
  assert.match(branchHoursMigration, /opening_time time NOT NULL DEFAULT TIME '05:30'/i);
  assert.match(branchHoursMigration, /closing_time time NOT NULL DEFAULT TIME '02:30'/i);
  assert.doesNotMatch(branchHoursMigration, /UPDATE\s+public\.branches|DROP\b|CREATE\s+POLICY|cron\.schedule|GRANT\b/i);
  assert.match(schema, /opening_time time not null default time '05:30'/i);
  assert.match(schema, /closing_time time not null default time '02:30'/i);
});

test('التنظيف الكيميائي للإسبريسو مستحق الأحد والثلاثاء والخميس فقط', () => {
  const task = { frequency: 'weekly', day_of_week: 0 };
  assert.equal(schedule.isTaskDueToday(task, atRiyadh('2026-11-15T09:00:00+03:00')), true);
  task.day_of_week = 2;
  assert.equal(schedule.isTaskDueToday(task, atRiyadh('2026-11-17T09:00:00+03:00')), true);
  task.day_of_week = 4;
  assert.equal(schedule.isTaskDueToday(task, atRiyadh('2026-11-19T09:00:00+03:00')), true);
  task.day_of_week = 0;
  assert.equal(schedule.isTaskDueToday(task, atRiyadh('2026-11-16T09:00:00+03:00')), false, 'الاثنين مستبعد');
  assert.match(migration, /'التنظيف الكيميائي لماكينة الإسبريسو',[\s\S]*?weekly', 0[\s\S]*?weekly', 2[\s\S]*?weekly', 4/);
  const brushDates = [
    ['2026-11-16T09:00:00+03:00', 1], ['2026-11-18T09:00:00+03:00', 3],
    ['2026-11-20T09:00:00+03:00', 5], ['2026-11-21T09:00:00+03:00', 6]
  ];
  for (const [date, day] of brushDates) assert.equal(schedule.isTaskDueToday({ frequency: 'weekly', day_of_week: day }, atRiyadh(date)), true);
  assert.match(migration, /VALUES \(1, 323\), \(3, 324\), \(5, 325\), \(6, 326\)/);
  assert.match(migration, /'تنظيف ماكينة الإسبريسو وعصا البخار بالماء والفرشاة', 'البار', 'Both'/);
});

test('الأيام الأسبوعية المتعددة تعمل مع أولوية المصفوفة والتوافق مع اليوم القديم', () => {
  const multiDay = { frequency: 'weekly', days_of_week: [0, 2, 4], day_of_week: 6 };
  for (const [date, expected] of [
    ['2026-11-15T09:00:00+03:00', true],
    ['2026-11-17T09:00:00+03:00', true],
    ['2026-11-19T09:00:00+03:00', true],
    ['2026-11-16T09:00:00+03:00', false],
    ['2026-11-21T09:00:00+03:00', false]
  ]) assert.equal(schedule.isTaskDueToday(multiDay, atRiyadh(date)), expected, date);
  assert.equal(schedule.isTaskDueToday({ frequency: 'weekly', days_of_week: [], day_of_week: 2 }, atRiyadh('2026-11-17T09:00:00+03:00')), true);
  assert.equal(schedule.isTaskDueToday({ frequency: 'weekly', day_of_week: 4 }, atRiyadh('2026-11-19T09:00:00+03:00')), true);
  assert.match(templateAdminPage, /days_of_week: frequency === 'weekly' \? selectedWeekdays : \[\]/);
  assert.match(api, /days\.some\(day => Number\(day\) === riyadhDate\.getUTCDay\(\)\)/);
  assert.match(multiDayMigration, /ADD COLUMN IF NOT EXISTS days_of_week integer\[\]/i);
  assert.match(multiDayMigration, /WHEN v_payload \? 'days_of_week' AND pg_catalog\.jsonb_typeof/);
  assert.match(multiDayMigration, /WHEN v_payload \? 'day_of_week'[\s\S]*?ARRAY\[NULLIF\(v_payload ->> 'day_of_week'/);
  assert.match(multiDayMigration, /ELSE v_old\.days_of_week/);
  assert.doesNotMatch(multiDayMigration, /DELETE\s+FROM\b|DROP\s+(?:TABLE|COLUMN)\b|(?:CREATE|DROP)\s+POLICY\b|cron\.schedule/i);
  assert.match(schema, /days_of_week integer\[\] not null default '\{\}'::integer\[\]/i);
  assert.match(schema, /checklist_templates_days_of_week_valid/);
});

test('صفحات قوائم التحقق تحمل نسخ cache المحدثة للمجدول وAPI', () => {
  const schedulePages = ['checklist-logs', 'dashboard', 'manage-templates', 'my-checklist', 'supervisor-checklist', 'supervisor-dashboard'];
  const restroomPages = ['checklist-logs', 'dashboard', 'manage-templates', 'my-checklist', 'supervisor-dashboard'];
  for (const page of schedulePages) {
    const html = fs.readFileSync(path.join(__dirname, '..', page, 'index.html'), 'utf8');
    const scheduleVersion = page === 'checklist-logs' ? '20261126202700' : '20261121164000';
    assert.match(html, new RegExp(`checklist-schedule\\.js\\?v=${scheduleVersion}`), `${page} must load the updated schedule helper`);
  }
  for (const page of restroomPages) {
    const html = fs.readFileSync(path.join(__dirname, '..', page, 'index.html'), 'utf8');
    assert.match(html, /restroom-hourly\.js\?v=20261121170500/, `${page} must load the current restroom task helper`);
  }
  assert.match(employeePage, /supabase-config\.js\?v=20261124203300/);
  assert.match(supervisorPage, /supabase-config\.js\?v=20261124203300/);
  assert.match(templateAdminPage, /supabase-config\.js\?v=20261124203300/);
  assert.match(adminLogPage, /checklist-log-metrics\.js\?v=20261126220452/);
  assert.match(templateAdminPage, /id="f-scope-all"/);
  assert.match(templateAdminPage, /class="f-branch-checkbox/);
  assert.match(templateAdminPage, /saveTemplateWithBranches/);
  assert.match(api, /function zamTemplateBranchIds/);
  assert.match(api, /save_checklist_template_with_branches/);
});

test('التنظيف العميق لكل الفئات التشغيلية مستحق السبت بتقويم الرياض', () => {
  const saturday = atRiyadh('2026-11-21T10:00:00+03:00');
  for (const category of ['البار', 'المطبخ', 'الصالة']) {
    assert.equal(schedule.isTaskDueToday({ category, frequency: 'weekly', day_of_week: 6 }, saturday), true, category);
  }
  assert.equal(schedule.isTaskDueToday({ frequency: 'weekly', day_of_week: 6 }, atRiyadh('2026-11-20T23:59:00+03:00')), false);
  for (const title of ['تنظيف عميق للبار والمعدات', 'تنظيف عميق للمطبخ والمعدات', 'تنظيف عميق للصالة والمعدات']) {
    assert.ok(migration.includes(title), `migration includes ${title}`);
  }
});

test('مهمة جرد الصباح تظهر عند 12:00 بتوقيت الرياض', () => {
  const task = { task_type: 'inventory_request', shift_type: 'Morning', target_time: '12:00:00' };
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-16T11:59:00+03:00')), false);
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-16T12:00:00+03:00')), true);
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-16T16:00:00+03:00')), true);
});

test('مهمة جرد الليل لا تظهر قبل منتصف الليل وتُتاح عند 00:00 في الوردية المسائية', () => {
  const task = { task_type: 'inventory_request', shift_type: 'Evening', target_time: '00:00:00' };
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-15T23:59:00+03:00')), false);
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-16T00:00:00+03:00')), true);
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-16T15:29:00+03:00')), false);
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-16T15:30:00+03:00')), false);
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-16T23:59:00+03:00')), false);
  assert.equal(schedule.isInventoryTaskVisible(task, atRiyadh('2026-11-17T00:00:00+03:00')), true);
  assert.match(supervisorPage, /currentShift === 'Evening'\) targetMinute = nowMinute < ZamChecklistSchedule\.EVENING_START_MINUTE \? ZamChecklistSchedule\.EVENING_START_MINUTE : 24 \* 60/);
  assert.match(supervisorPage, /currentUser\.role === 'Supervisor'/);
});

test('حدود الوردية ثابتة عند 15:30 بتوقيت الرياض', () => {
  const before = atRiyadh('2026-11-16T15:29:00+03:00');
  const atStart = atRiyadh('2026-11-16T15:30:00+03:00');
  assert.equal(schedule.riyadhMinuteOfDay(before) < schedule.EVENING_START_MINUTE, true);
  assert.equal(schedule.riyadhMinuteOfDay(atStart) < schedule.EVENING_START_MINUTE, false);
  assert.equal(schedule.getShiftWindow('Morning', {}, before).endMinute, 15 * 60 + 30);
  assert.equal(schedule.getShiftWindow('Evening', {}, atStart).startMinute, 15 * 60 + 30);
  assert.match(employeePage, /defaultShiftByRiyadhTime = \(date = new Date\(\)\) =>[\s\S]*?isWithinShiftTaskWindow\('Evening', currentBranchHours, date\)/);
  assert.match(supervisorPage, /defaultShiftByRiyadhTime = \(\) => ZamChecklistSchedule\.isWithinShiftTaskWindow\('Evening', currentBranchHours\)/);
  assert.match(dashboardPage, /initialDashboardShift\(currentUser\)/);
});

test('مهام حمامات الإدارة في الفرع الرئيسي تظهر عند 09:00 و12:00 فقط من موعدها', () => {
  const task = { task_type: 'restroom_check', category: 'الصالة', shift_type: 'Morning', branch_id: MAIN_ID, frequency: 'daily', target_time: '09:00:00' };
  const context = waiter(MAIN_ID, 'زام الرئيسي');
  assert.equal(schedule.isTemplateVisibleForEmployee(task, context, atRiyadh('2026-11-16T08:59:00+03:00')), false);
  assert.equal(schedule.isTemplateVisibleForEmployee(task, context, atRiyadh('2026-11-16T09:00:00+03:00')), true);
  task.target_time = '12:00:00';
  assert.equal(schedule.isTemplateVisibleForEmployee(task, context, atRiyadh('2026-11-16T11:59:00+03:00')), false);
  assert.equal(schedule.isTemplateVisibleForEmployee(task, context, atRiyadh('2026-11-16T12:00:00+03:00')), true);
  assert.match(migration, /'تنظيف دورة مياه الإدارة — 09:00'/);
  assert.match(migration, /'تنظيف دورة مياه الإدارة — 12:00'/);
});

test('جولة الحمام كل ساعة خاصة بزام الرئيسي وموظفي الصالة وتطلب صورة', () => {
  const hourly = { task_type: 'restroom_check', category: 'الصالة', shift_type: 'Both', branch_id: MAIN_ID, frequency: 'hourly' };
  assert.equal(schedule.isTemplateVisibleForEmployee(hourly, waiter(MAIN_ID, 'زام الرئيسي', 'Evening')), true);
  assert.equal(schedule.isTemplateVisibleForEmployee(hourly, waiter(HAY_ID, 'زام الحي', 'Evening')), false);
  assert.equal(schedule.isTemplateVisibleForEmployee(hourly, { role: 'Barista', branchId: MAIN_ID, categories: ['البار'], shiftType: 'Morning' }), false);
  assert.equal(schedule.isTemplateVisibleForEmployee(hourly, { role: 'Supervisor', branchId: MAIN_ID, branchName: 'زام الرئيسي', categories: ['الصالة'], shiftType: 'Morning' }), false);
  assert.match(migration, /'تنظيف وفحص دورة المياه كل ساعة'[\s\S]*?b\.id, true, 'hourly'/);
  assert.match(migration, /WHERE b\.name = 'زام الرئيسي'/);
});

test('زام الحي لا تظهر له مهام حمامات، لكن تبقى مهام الصالة العادية ظاهرة', () => {
  const now = atRiyadh('2026-11-16T10:00:00+03:00');
  const restroom = { task_type: 'restroom_check', category: 'الصالة', shift_type: 'Morning', branch_id: HAY_ID, frequency: 'daily' };
  assert.equal(schedule.isTemplateVisibleForEmployee(restroom, waiter(HAY_ID, 'زام الحي'), now), false);
  const lounge = { task_type: 'standard', category: 'الصالة', shift_type: 'Morning', branch_id: HAY_ID, frequency: 'daily' };
  assert.equal(schedule.isTemplateVisibleForEmployee(lounge, waiter(HAY_ID, 'زام الحي'), now), true);
  assert.match(migration, /'زام الحي'[\s\S]*?لا توجد مهام دورة مياه لهذا الفرع/);
});

test('عدادات الفروع الساعية لا تشمل الحي أو البرج عند غياب قالب ساعي قابل للتطبيق', () => {
  const hourlyRestroom = {
    task_type: 'restroom_check', category: 'الصالة', shift_type: 'Both',
    branch_id: null, frequency: 'hourly', is_active: true,
  };
  assert.equal(schedule.isHourlyTemplateApplicableInBranch(hourlyRestroom, { branchId: MAIN_ID, branchName: 'زام الرئيسي' }), true);
  assert.equal(schedule.isHourlyTemplateApplicableInBranch(hourlyRestroom, { branchId: HAY_ID, branchName: 'زام الحي' }), false);
  assert.equal(schedule.isHourlyTemplateApplicableInBranch(hourlyRestroom, { branchId: BURJ_ID, branchName: 'زام البرج' }), false);
  assert.equal(schedule.isHourlyTemplateApplicableInBranch({ ...hourlyRestroom, is_active: false }, { branchId: MAIN_ID }), false);
});

test('زام المنح بلا ويتر صباحي، وتُتاح قائمة الوردية المسائية فقط', () => {
  const morning = { task_type: 'standard', category: 'الصالة', shift_type: 'Morning', branch_id: MANAH_ID, frequency: 'daily' };
  assert.equal(schedule.isTemplateVisibleForEmployee(morning, waiter(MANAH_ID, 'زام المنح', 'Morning')), false);
  const evening = { ...morning, shift_type: 'Evening' };
  assert.equal(schedule.isTemplateVisibleForEmployee(evening, waiter(MANAH_ID, 'زام المنح', 'Evening')), true);
  assert.match(migration, /b\.name <> 'زام المنح'/);
});

test('تُفصل إنجازات الصباح والليل، مع إظهار مهام الورديتين في كليهما', () => {
  const morning = { category: 'الصالة', shift_type: 'Morning', branch_id: HAY_ID, frequency: 'daily', task_type: 'standard' };
  const both = { ...morning, shift_type: 'Both' };
  const eveningContext = waiter(HAY_ID, 'زام الحي', 'Evening');
  assert.equal(schedule.isTemplateVisibleForEmployee(morning, eveningContext), false);
  assert.equal(schedule.isTemplateVisibleForEmployee(both, eveningContext), true);
  assert.match(migration, /checklist_logs_shift_occurrence_uidx[\s\S]*?branch_id, shift_type/);
});

test('طلبات الجرد لا تُعرض في واجهة الموظف العادية، وتُحصر بصفحة المشرف', () => {
  const inventory = { task_type: 'inventory_request', category: 'مهام المشرفين', shift_type: 'Morning', target_time: '12:00:00', frequency: 'daily' };
  assert.equal(schedule.isTemplateVisibleForEmployee(inventory, { role: 'Supervisor', branchId: MAIN_ID, categories: ['مهام المشرفين'], shiftType: 'Morning' }, atRiyadh('2026-11-16T13:00:00+03:00')), false);
  assert.match(supervisorPage, /currentUser\.role === 'Supervisor' && ZamChecklistSchedule\.isInventoryTaskVisible/);
  assert.match(supervisorPage, /getHourlyChecklistLogs\(\{ branchId: currentUser\.branch_id, dateFrom: shiftWindow\.dateFrom, dateTo: shiftWindow\.dateTo, shiftType: currentShift \}\)/);
  assert.match(migration, /v_profile\.role IS DISTINCT FROM 'Supervisor'/);
});

test('مفتاح تنفيذ الساعة ثابت خلال الساعة ويتغير عند بدايتها التالية', () => {
  const first = schedule.hourlyOccurrenceKey(atRiyadh('2026-11-16T10:05:00+03:00'));
  const sameHour = schedule.hourlyOccurrenceKey(atRiyadh('2026-11-16T10:59:59+03:00'));
  const nextHour = schedule.hourlyOccurrenceKey(atRiyadh('2026-11-16T11:00:00+03:00'));
  assert.equal(first, sameHour);
  assert.notEqual(first, nextHour);
  assert.equal(first, '2026-11-16-10');
});

test('ترحيل السجل الساعي والإصدارات إضافي ويحافظ على سجلات وتفاصيل الطلبات', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.hourly_checklist_logs/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS shift_type/i);
  assert.match(migration, /frequency[^;]*hourly/is);
  assert.match(migration, /FOREIGN KEY \(template_id\) REFERENCES public\.checklist_templates\(id\) ON DELETE RESTRICT/i);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS one_log_per_task_day_branch/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(checklist_logs|team_notes|inventory_requests)/i);
  assert.doesNotMatch(migration, /DROP\s+TABLE\s+public\.(checklist_logs|team_notes|inventory_requests|daily_reports|inventory_request_items)/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.checklist_templates/i);
});

test('الأرشيف يظل محفوظاً ويظهر للمخولين فقط وتحديث القالب ينشئ إصداراً جديداً', () => {
  assert.match(migration, /Users read active checklist templates[\s\S]*?USING \(is_active OR public\.has_admin_permission\('templates'\)\)/);
  assert.match(migration, /INSERT INTO public\.checklist_templates[\s\S]*?UPDATE public\.checklist_templates[\s\S]*?SET is_active = false/);
  assert.match(migration, /CREATE POLICY "Admin roles read all checklist logs"[\s\S]*?current_user_role\(\) IN \('Owner', 'Admin', 'Manager'\)/);
  assert.doesNotMatch(migration, /DROP POLICY IF EXISTS "Supervisors read own branch checklist logs"/);
  assert.match(api, /if \(!includeArchived\) query = query\.eq\('is_active', true\)/);
  assert.match(templateAdminPage, /getTemplates\(null, null, null, \{ includeArchived: true \}\)/);
  assert.match(templateAdminPage, /copyArchivedTemplateAsNewVersion/);
  assert.match(templateAdminPage, /groupedCount > 1 \? 'أرشفة المجموعة' : 'أرشفة'/);
  assert.doesNotMatch(api, /from\('checklist_templates'\)\.delete\(/);
});

test('إنشاء طلب الجرد يسجل الوردية ويستخدم قيد التكرار الجديد', () => {
  assert.match(migration, /INSERT INTO public\.checklist_logs \([\s\S]*?shift_type,\s*execution_date\s*\)/);
  assert.match(migration, /p_shift_type,[\s\S]*?\(pg_catalog\.timezone\('Asia\/Riyadh', now\(\)\)\)::date/);
  assert.match(migration, /ON CONFLICT \(template_id, execution_date, branch_id, shift_type\)[\s\S]*?WHERE shift_type IS NOT NULL/);
  assert.match(migration, /AND t\.is_active/);
});

test('سياسات الإدارة والسجل الساعي والملاحظات ليست عامة', () => {
  assert.match(migration, /FOR SELECT TO authenticated[\s\S]*?USING \(public\.current_user_role\(\) IN \('Owner', 'Admin', 'Manager'\)\)/);
  assert.match(migration, /CREATE POLICY "Supervisors read own branch team notes"[\s\S]*?TO authenticated[\s\S]*?branch_id = public\.current_user_branch_id\(\)/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON public\.hourly_checklist_logs FROM PUBLIC, anon, authenticated/);
});

test('تواريخ قراءات الحرارة وسجلات التنفيذ تُضبط على يوم الرياض وتُعرض أوقاتها محلياً', () => {
  assert.match(migration, /ALTER COLUMN execution_date SET DEFAULT \(pg_catalog\.timezone\('Asia\/Riyadh', now\(\)\)\)::date/);
  assert.match(migration, /ALTER COLUMN reading_date SET DEFAULT \(pg_catalog\.timezone\('Asia\/Riyadh', now\(\)\)\)::date/);
  assert.match(api, /getFridgeReadings\([\s\S]*?created_at', start\.toISOString\(\)[\s\S]*?created_at', end\.toISOString\(\)/);
  assert.match(adminLogPage, /timeZone: 'Asia\/Riyadh'/);
  assert.match(supervisorPage, /timeZone: 'Asia\/Riyadh'/);
});

test('عدادات Both تعرض المهمة في الورديتين ولا تنقل سجل الوردية أو السجل القديم بينهما', () => {
  const task = { id: 'both-task', category: 'الصالة', shift_type: 'Both', branch_id: HAY_ID, frequency: 'daily', task_type: 'standard' };
  const employee = { id: 'waiter-1', role: 'Waiter', shift_type: 'Both' };
  const opts = { templates: [task], staff: [employee], branchId: HAY_ID, branchName: 'زام الحي', now: atRiyadh('2026-11-16T10:00:00+03:00') };
  const morning = dashboard.dashboardTasks({ ...opts, shiftType: 'Morning' });
  const evening = dashboard.dashboardTasks({ ...opts, shiftType: 'Evening' });
  assert.deepEqual(morning.map(t => t.id), ['both-task']);
  assert.deepEqual(evening.map(t => t.id), ['both-task']);
  const morningLog = { template_id: task.id, branch_id: HAY_ID, execution_date: '2026-11-16', shift_type: 'Morning', executed_by: 'waiter-1', status: 'Completed' };
  assert.equal(dashboard.completedTaskKeys(morning, [morningLog], [], { branchId: HAY_ID, shiftType: 'Morning', now: opts.now }).has(task.id), true);
  assert.equal(dashboard.completedTaskKeys(evening, [morningLog], [], { branchId: HAY_ID, shiftType: 'Evening', now: opts.now }).has(task.id), false);
  assert.equal(dashboard.completedTaskKeys(morning, [morningLog], [], { branchId: HAY_ID, shiftType: 'Morning', now: opts.now, executedBy: 'waiter-1' }).has(task.id), true);
  assert.equal(dashboard.completedTaskKeys(morning, [morningLog], [], { branchId: HAY_ID, shiftType: 'Morning', now: opts.now, executedBy: 'waiter-2' }).has(task.id), false);
  const legacyLog = { ...morningLog, shift_type: null };
  assert.equal(dashboard.completedTaskKeys(evening, [legacyLog], [], { branchId: HAY_ID, shiftType: 'Evening', now: opts.now }).has(task.id), false);
  assert.match(employeePage, /\['Morning', 'Evening'\]\.includes\(currentUser\.shift_type\)/);
  assert.match(employeePage, /task\.shift_type !== 'Both' && task\.shift_type === currentShift/);
  assert.match(employeePage, /Number\(l\.occurrence_hour\) === currentHour && l\.shift_type === currentShift/);
  assert.match(supervisorPage, /ZamChecklistSchedule\.isTaskDueForShift\(task, currentShift, new Date\(\), currentBranchHours\)/);
  assert.match(api, /if \(l\.shift_type\) return l\.shift_type === shiftType;[\s\S]*?templateShift !== 'Both' && templateShift === shiftType/);
});

test('العدادات لا تُدخل المهام قبل موعدها وتراعي الاستحقاق الأسبوعي والشهري', () => {
  const base = { category: 'الصالة', shift_type: 'Morning', branch_id: MAIN_ID, task_type: 'restroom_check', frequency: 'daily' };
  const employee = { id: 'waiter-1', role: 'Waiter', shift_type: 'Morning' };
  const atTime = { ...base, id: 'at-noon', target_time: '12:00:00' };
  const context = { templates: [atTime], staff: [employee], branchId: MAIN_ID, branchName: 'زام الرئيسي', shiftType: 'Morning' };
  assert.equal(dashboard.dashboardTasks({ ...context, now: atRiyadh('2026-11-16T11:59:00+03:00') }).length, 0);
  assert.equal(dashboard.dashboardTasks({ ...context, now: atRiyadh('2026-11-16T12:00:00+03:00') }).length, 1);
  const weekly = { ...base, id: 'weekly-saturday', task_type: 'standard', frequency: 'weekly', day_of_week: 6 };
  const monthly = { ...base, id: 'monthly-31', task_type: 'standard', frequency: 'monthly', day_of_month: 31 };
  const recurring = { ...context, templates: [weekly, monthly], now: atRiyadh('2027-02-28T10:00:00+03:00') };
  assert.deepEqual(dashboard.dashboardTasks(recurring).map(t => t.id), ['monthly-31'], '31st-day monthly task is due on February’s last day; Saturday task is not');
  assert.equal(dashboard.dashboardTasks({ ...recurring, now: atRiyadh('2026-11-21T10:00:00+03:00') }).some(t => t.id === 'weekly-saturday'), true);
});

test('المهام وبطاقات الموظفين تحترم الإسناد الإضافي للفئات', () => {
  const templates = [
    { id: 'bar-task', category: 'البار', shift_type: 'Morning', branch_id: MAIN_ID, task_type: 'standard', frequency: 'daily' },
    { id: 'kitchen-task', category: 'المطبخ', shift_type: 'Morning', branch_id: MAIN_ID, task_type: 'standard', frequency: 'daily' }
  ];
  const employee = { id: 'multi-role-1', role: 'Barista', shift_type: 'Morning' };
  const now = atRiyadh('2026-11-16T10:00:00+03:00');
  assert.deepEqual(dashboard.tasksForEmployee(templates, employee, { branchId: MAIN_ID, branchName: 'زام الرئيسي', categoriesBy: { [employee.id]: ['المطبخ'] }, shiftType: 'Morning', now }).map(t => t.id), ['kitchen-task']);
});

test('السجل الساعي يحسب الساعة والوردية الحالية فقط، والمجموع العام يختلف عن بطاقة الموظف', () => {
  const now = atRiyadh('2026-11-16T10:30:00+03:00');
  const task = { id: 'hourly-restroom', category: 'الصالة', shift_type: 'Both', branch_id: MAIN_ID, frequency: 'hourly', task_type: 'restroom_check' };
  const logs = [
    { template_id: task.id, branch_id: MAIN_ID, execution_date: '2026-11-16', occurrence_hour: 10, shift_type: 'Morning', executed_by: 'waiter-1', status: 'Completed' },
    { template_id: task.id, branch_id: MAIN_ID, execution_date: '2026-11-16', occurrence_hour: 9, shift_type: 'Morning', executed_by: 'waiter-2', status: 'Completed' },
    { template_id: task.id, branch_id: MAIN_ID, execution_date: '2026-11-16', occurrence_hour: 10, shift_type: 'Evening', executed_by: 'waiter-2', status: 'Completed' },
    { template_id: task.id, branch_id: MAIN_ID, execution_date: '2026-11-15', occurrence_hour: 10, shift_type: 'Morning', executed_by: 'waiter-2', status: 'Completed' }
  ];
  assert.equal(dashboard.taskKey(task, now), 'hourly-restroom:hour:10');
  assert.equal(dashboard.completedTaskKeys([task], [], logs, { branchId: MAIN_ID, shiftType: 'Morning', now }).has(dashboard.taskKey(task, now)), true);
  assert.equal(dashboard.completedTaskKeys([task], [], logs, { branchId: MAIN_ID, shiftType: 'Morning', now, executedBy: 'waiter-1' }).size, 1);
  assert.equal(dashboard.completedTaskKeys([task], [], logs, { branchId: MAIN_ID, shiftType: 'Morning', now, executedBy: 'waiter-2' }).size, 0);
  const afterMidnight = atRiyadh('2026-11-17T00:30:00+03:00');
  const eveningLogs = [
    { template_id: task.id, branch_id: MAIN_ID, execution_date: '2026-11-16', occurrence_hour: 0, shift_type: 'Evening', executed_by: 'waiter-1', status: 'Completed' },
    { template_id: task.id, branch_id: MAIN_ID, execution_date: '2026-11-16', occurrence_hour: 23, shift_type: 'Evening', executed_by: 'waiter-2', status: 'Completed' },
    { template_id: task.id, branch_id: MAIN_ID, execution_date: '2026-11-15', occurrence_hour: 0, shift_type: 'Evening', executed_by: 'waiter-2', status: 'Completed' }
  ];
  assert.equal(dashboard.taskKey(task, afterMidnight), 'hourly-restroom:hour:0');
  assert.equal(dashboard.completedTaskKeys([task], [], eveningLogs, { branchId: MAIN_ID, shiftType: 'Evening', now: afterMidnight }).size, 1, 'only the current-hour evening entry on the prior business date counts after midnight');
});

test('عدادات الجرد تظهر للمشرف فقط وبعد موعد الورديّة وفي الفرع المحدد', () => {
  const task = { id: 'inventory', category: 'مهام المشرفين', shift_type: 'Morning', branch_id: null, task_type: 'inventory_request', frequency: 'daily', target_time: '12:00:00' };
  const staff = [{ id: 'waiter', role: 'Waiter', shift_type: 'Morning' }];
  const common = { templates: [task], staff, branchId: MAIN_ID, branchName: 'زام الرئيسي', shiftType: 'Morning' };
  const before = atRiyadh('2026-11-16T11:59:00+03:00');
  const due = atRiyadh('2026-11-16T12:00:00+03:00');
  assert.equal(dashboard.dashboardTasks({ ...common, currentUserRole: 'Supervisor', now: before }).length, 0);
  assert.deepEqual(dashboard.dashboardTasks({ ...common, currentUserRole: 'Supervisor', now: due }).map(t => t.id), ['inventory']);
  assert.equal(dashboard.dashboardTasks({ ...common, currentUserRole: 'Manager', now: due }).length, 0);
  assert.equal(dashboard.dashboardTasks({ ...common, currentUserRole: 'Supervisor', branchId: HAY_ID, now: due }).length, 1, 'unscoped shared task may be available at each branch');
  assert.equal(dashboard.dashboardTasks({ ...common, currentUserRole: 'Supervisor', templates: [{ ...task, branch_id: HAY_ID }], now: due }).length, 0);
});

test('لوحة الفرع تربط السجلات الفعلية وتعرض عداداتًا محدثة دوريًا', () => {
  assert.match(dashboardPage, /ZamChecklistDashboard\.dashboardTasks/);
  assert.match(dashboardPage, /ZamChecklistDashboard\.completedTaskKeys/);
  assert.match(dashboardPage, /getHourlyChecklistLogs\(\{ branchId, dateFrom: yesterday, dateTo: today \}\)/);
  assert.match(dashboardPage, /window\.setInterval\(refreshDashboard,\s*60000\)/);
  assert.match(dashboardPage, /if \(refreshRunning \|\| document\.hidden\) return/);
  assert.match(dashboardPage, /const today = ZamChecklistSchedule\.riyadhDateString\(now\)/);
  assert.match(dashboardPage, /select\('template_id, branch_id, executed_by, status, execution_date, created_at, shift_type'\)/);
  assert.match(dashboardPage, /dateFrom: yesterday, dateTo: today/);
});

test('سجلات ما بعد منتصف الليل تُنسب لسياق الوردية المسائية وتبقى المتأخرات ظاهرة للإدارة', () => {
  const task = { id: 'evening-task', category: 'الصالة', shift_type: 'Evening', branch_id: MAIN_ID, frequency: 'daily', task_type: 'standard' };
  const staff = { id: 'waiter-evening', role: 'Waiter', shift_type: 'Evening' };
  const atOneAm = atRiyadh('2026-11-17T01:00:00+03:00');
  assert.equal(dashboard.logInsideShift({ created_at: '2026-11-17T01:15:00+03:00' }, 'Evening', {}, atOneAm), true);
  assert.equal(dashboard.logInsideShift({ created_at: '2026-11-17T14:00:00+03:00' }, 'Evening', {}, atOneAm), false);
  const context = { branchId: MAIN_ID, branchName: 'زام الرئيسي', shiftType: 'Evening', now: atRiyadh('2026-11-17T04:00:00+03:00') };
  assert.equal(dashboard.tasksForEmployee([task], staff, context).length, 0, 'employee checklist is hidden after the one-hour grace');
  assert.equal(dashboard.dashboardTasks({ ...context, templates: [task], staff: [staff], currentUserRole: 'Manager' }).length, 1, 'manager still sees the unfinished shift task');
});

test('بار فقط في زام البرج يخفي مهام الصالة للموظف والفرع ويحافظ على البار والمطبخ', () => {
  const now = atRiyadh('2026-11-16T10:00:00+03:00');
  const lounge = { task_type: 'standard', category: 'الصالة', shift_type: 'Morning', branch_id: BURJ_ID, frequency: 'daily' };
  assert.equal(schedule.isTemplateVisibleForEmployee(lounge, waiter(BURJ_ID, 'زام البرج'), now), false);
  assert.equal(schedule.isTemplateVisibleInBranch(lounge, { branchId: BURJ_ID, branchName: 'زام البرج', shiftType: 'Morning' }, now), false);
  const bar = { ...lounge, category: 'البار' };
  assert.equal(schedule.isTemplateVisibleForEmployee(bar, { role: 'Barista', branchId: BURJ_ID, branchName: 'زام البرج', categories: ['البار'], shiftType: 'Morning' }, now), true);
  assert.equal(schedule.isTemplateVisibleInBranch(bar, { branchId: BURJ_ID, branchName: 'زام البرج', shiftType: 'Morning' }, now), true);
  const kitchen = { ...lounge, category: 'المطبخ', branch_id: null };
  assert.equal(schedule.isTemplateVisibleForEmployee(kitchen, { role: 'Kitchen', branchId: BURJ_ID, branchName: 'زام البرج', categories: ['المطبخ'], shiftType: 'Morning' }, now), true);
});

test('ترحيل التحديثات محدود إلى القوالب العامة الثمانية ودفعتَي الاستلام وقوالب الصالة المحددة للبرج', () => {
  const versionBlock = operationalMigration.split('DO $preflight$')[0];
  const mappedIds = [...versionBlock.matchAll(/^\s*\(\s*'([0-9a-f-]{36})',/gm)].map(match => match[1]).sort();
  assert.deepEqual(mappedIds, [
    '3d5d4b69-bfa3-4faa-afd0-6cb8b95ac7f4',
    '64d373a0-3bab-4ec7-9d23-b31a0f311d45',
    '8fa8b5d3-7d1b-4848-9477-d72e74cc2c69',
    'b7d39580-0ffa-4d41-8ea0-f3aa3b863f2c',
    'c1be4246-5188-405b-9b85-868743a0dbc6',
    'dee28cc6-0b71-425d-880c-da71c532e0d3',
    'e13163ba-0456-4eb4-a3df-6e3398f2f113',
    'e228e4a2-41f7-49d8-be3e-7c1805aa25b5'
  ].sort());
  assert.match(operationalMigration, /expected eight explicitly mapped templates/);
  assert.match(operationalMigration, /'استلام طلبيات المخبوزات ومطابقتها بالفاتورة'/);
  assert.match(operationalMigration, /'مطابقة التوريدات وتخزينها خلال 20 دقيقة'/);
  assert.match(operationalMigration, /expected exactly the eleven current active lounge templates linked only to Al-Burj/);
  assert.match(operationalMigration, /an additional active lounge template now targets the bar-only branch/);
  assert.match(operationalMigration, /v_old\.branch_id,[\s\S]*?v_old\.target_time,[\s\S]*?v_old\.days_of_week/);
  for (const untouchedId of [
    'a9fc60b0-6cf7-4fee-8968-8cc006a08d51',
    '28c0ce84-b26d-458d-8f4e-3818ca0eec8b',
    '148c8616-14bd-47cd-972c-dcdd9f6c3c22',
    'c85f8cfe-a1d1-439d-bec4-e3c71b5abdcf',
    '807f0bdf-c84b-4cae-84fa-5d7c24adad11',
    'a6ee97d5-9be7-43bb-bba6-a43dba358b69',
    '2c299e4b-7e8e-4ede-969b-2540fa699fcc',
    '8fc74362-9e0c-4826-9ca1-b43466d7c27f',
    'e679d89f-3aa3-416b-bb6f-caafa3142b92',
    'd5008ccd-6ddb-46d5-be72-f0e6d9315d0e',
    'be2ecc76-8655-4c12-b8e4-ded62e74b6f6'
  ]) assert.equal(operationalMigration.includes(untouchedId), false, `must preserve unrelated template ${untouchedId}`);
  assert.doesNotMatch(operationalMigration, /public\.(profiles|admin_permissions|employee_task_categories)|GRANT\s|REVOKE\s|cron\.schedule|DELETE\s+FROM/i);
});

test('إنشاء الجولة الساعية خادمي فقط: لا يقبل هوية أو فرعًا أو ساعة من المتصفح ويتحقق من صورة المالك', () => {
  assert.match(api, /rpc\('create_hourly_checklist_log'/);
  assert.doesNotMatch(api, /from\('hourly_checklist_logs'\)\.insert/);
  assert.match(api, /p_template_id: template_id,[\s\S]*?p_shift_type: shift_type,[\s\S]*?p_notes: notes,[\s\S]*?p_photo_url: photo_url/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = ''[\s\S]*?auth\.uid\(\)/i);
  assert.match(migration, /v_profile\.status IS DISTINCT FROM 'active'[\s\S]*?v_profile\.role IS DISTINCT FROM 'Waiter'/);
  assert.match(migration, /WHERE b\.name = 'زام الرئيسي'/);
  assert.match(migration, /INTO STRICT v_main_branch_id/);
  assert.match(migration, /v_local_now := pg_catalog\.timezone\('Asia\/Riyadh'/);
  assert.match(migration, /v_expected_shift := CASE[\s\S]*?WHEN v_profile\.shift_type IN \('Morning', 'Evening'\)[\s\S]*?EXTRACT\(HOUR FROM v_local_now\) >= 16/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_inventory_request\(text, text, jsonb\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_inventory_request\(text, text, jsonb\) TO authenticated/i);
  assert.match(migration, /o\.owner = v_user_id OR o\.owner_id = v_user_id::text/);
  assert.match(migration, /o\.metadata ->> 'mimetype'\) LIKE 'image\/%'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_hourly_checklist_log\(uuid, text, text, text\) TO authenticated/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON public\.hourly_checklist_logs FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /CREATE POLICY "Waiters read own branch hourly checklist logs"[\s\S]*?p\.role = 'Waiter'[\s\S]*?p\.branch_id = hourly_checklist_logs\.branch_id/);
  assert.doesNotMatch(migration, /CREATE POLICY "Users create own hourly checklist logs"/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_hourly_checklist_template[\s\S]*?SECURITY DEFINER[\s\S]*?frequency = 'hourly'/i);
  assert.match(migration, /CREATE POLICY "Users can create own logs"[\s\S]*?NOT public\.is_hourly_checklist_template\(template_id\)/i);
  assert.match(migration, /CREATE POLICY "Users can update own logs"[\s\S]*?USING \(executed_by = \(SELECT auth\.uid\(\)\) AND branch_id = public\.current_user_branch_id\(\)\)[\s\S]*?WITH CHECK \([\s\S]*?branch_id = public\.current_user_branch_id\(\)[\s\S]*?NOT public\.is_hourly_checklist_template\(template_id\)/i);
  assert.match(schema, /create or replace function public\.create_hourly_checklist_log\([\s\S]*?set search_path = ''/i);
  assert.match(schema, /not public\.is_hourly_checklist_template\(template_id\)/i);
  assert.match(schema, /v_expected_shift := case[\s\S]*?when v_profile\.shift_type in \('Morning', 'Evening'\)[\s\S]*?\) >= 930 then 'Evening'/i);
  assert.match(schema, /grant select on hourly_checklist_logs to authenticated/i);
  assert.doesNotMatch(schema, /grant select, insert on hourly_checklist_logs/i);
});
