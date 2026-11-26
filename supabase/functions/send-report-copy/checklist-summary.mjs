const COMPLETED_STATUSES = new Set(['completed', 'done', 'مكتمل', 'منجز']);
const NOT_PERFORMED_STATUSES = new Set(['notperformed', 'not_performed', 'not-performed', 'missed', 'غير منفذة', 'غير منفذ']);
const SUPERVISOR_ONLY_TASK_TYPES = new Set(['inventory_request', 'inventory_count']);
const BAR_ONLY_BRANCH_ID = '41f2dea8-238a-4550-abc8-b1a8a505f3d2';
const TRIAL_BRANCH_NAME = 'تجربة زام';
const RIYADH_OFFSET_MINUTES = 180;
const EVENING_START_MINUTE = 15 * 60 + 30;
const GRACE_MINUTES = 60;

function parseTimeMinutes(value, fallback) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function dateString(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function nextDate(parts, offset) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function riyadhInstant(parts, minuteOfBusinessDay) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, minuteOfBusinessDay - RIYADH_OFFSET_MINUTES));
}

function buildShiftWindow(reportDate, shiftType, branchHours = {}) {
  const parts = dateParts(reportDate);
  if (!parts || !['Morning', 'Evening'].includes(shiftType)) return null;
  const opening = parseTimeMinutes(branchHours.opening_time, 5 * 60 + 30);
  const closing = parseTimeMinutes(branchHours.closing_time, 2 * 60 + 30);
  const closeOnTimeline = closing + (closing <= opening ? 1440 : 0);
  const startMinute = shiftType === 'Morning' ? opening : Math.max(EVENING_START_MINUTE, opening);
  const endMinute = shiftType === 'Morning' ? Math.min(EVENING_START_MINUTE, closeOnTimeline) : closeOnTimeline;
  if (startMinute >= endMinute) return null;
  const startAt = riyadhInstant(parts, startMinute);
  const endAt = riyadhInstant(parts, endMinute);
  const graceEndAt = new Date(endAt.getTime() + GRACE_MINUTES * 60 * 1000);
  const lastLocalDate = new Date(endAt.getTime() + RIYADH_OFFSET_MINUTES * 60_000);
  const dateTo = dateString({ year: lastLocalDate.getUTCFullYear(), month: lastLocalDate.getUTCMonth() + 1, day: lastLocalDate.getUTCDate() });
  return { startAt, endAt, graceEndAt, dateFrom: dateString(parts), dateTo, shiftType };
}

function isDueOnBusinessDate(task, reportDate) {
  const parts = dateParts(reportDate);
  if (!parts) return false;
  const frequency = String(task?.frequency || 'daily').toLowerCase();
  if (frequency === 'daily' || frequency === 'hourly') return true;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  if (frequency === 'weekly') {
    const days = Array.isArray(task?.days_of_week) ? task.days_of_week : [];
    return days.length ? days.some((day) => Number(day) === weekday) : Number(task?.day_of_week) === weekday;
  }
  if (frequency === 'monthly') {
    const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
    return parts.day === Math.min(Number(task?.day_of_month), lastDay);
  }
  return true;
}

function appliesToBranch(task, branchId) {
  const links = Array.isArray(task?.checklist_template_branches) ? task.checklist_template_branches : [];
  const linkedIds = [...new Set(links.map((link) => link?.branch_id).filter(Boolean).map(String))];
  if (linkedIds.length) return branchId != null && linkedIds.includes(String(branchId));
  return !task?.branch_id || String(task.branch_id) === String(branchId);
}

function isApplicableTemplate(task, { branchId, branchName, shiftType, reportDate }) {
  if (!task || task.is_active === false || SUPERVISOR_ONLY_TASK_TYPES.has(task.task_type)) return false;
  if (!appliesToBranch(task, branchId)) return false;
  if (String(branchId || '') === BAR_ONLY_BRANCH_ID && task.category === 'الصالة') return false;
  if (branchName === 'زام الحي' && task.task_type === 'restroom_check') return false;
  if (shiftType && ![shiftType, 'Both'].includes(task.shift_type)) return false;
  if (String(task.frequency || '').toLowerCase() === 'hourly' && task.task_type !== 'restroom_check') return false;
  return isDueOnBusinessDate(task, reportDate);
}

function normalizedStatus(log) {
  return String(log?.status || 'Completed').trim().toLowerCase();
}

function isCompleted(log) {
  return COMPLETED_STATUSES.has(normalizedStatus(log));
}

function isNotPerformed(log) {
  return NOT_PERFORMED_STATUSES.has(normalizedStatus(log));
}

function logMatchesShift(log, task, shiftType) {
  if (log?.shift_type) return log.shift_type === shiftType;
  return task?.shift_type !== 'Both' && task?.shift_type === shiftType;
}

function logInsideWindow(log, window) {
  if (!log?.created_at) {
    const date = String(log?.execution_date || '').slice(0, 10);
    return date >= window.dateFrom && date <= window.dateTo;
  }
  const created = Date.parse(log.created_at);
  return Number.isFinite(created) && created >= window.startAt.getTime() && created < window.graceEndAt.getTime();
}

/** @typedef {{ id: string; category?: string|null; task_type?: string|null; branch_id?: string|null; shift_type?: string|null; frequency?: string|null; days_of_week?: number[]; day_of_week?: number|null; day_of_month?: number|null; is_active?: boolean; checklist_template_branches?: Array<{ branch_id?: string|null }> }} ChecklistTemplateRow */
/** @typedef {{ template_id?: string|null; branch_id?: string|null; status?: string|null; execution_date?: string|null; shift_type?: string|null; created_at?: string|null }} ChecklistLogRow */
/**
 * Match the branch checklist dashboard's branch-progress rules for one saved
 * shift report. Missing non-hourly completions remain incomplete; hourly counts
 * include only explicitly recorded completed/not-performed rows.
 * @param {{ templates?: ChecklistTemplateRow[]; logs?: ChecklistLogRow[]; hourlyLogs?: ChecklistLogRow[]; branchId?: string|null; branchName?: string; reportDate?: string; shiftType?: string; branchHours?: { opening_time?: string|null; closing_time?: string|null } }} input
 */
export function buildChecklistSummary({
  templates = [],
  logs = [],
  hourlyLogs = [],
  branchId,
  branchName = '',
  reportDate,
  shiftType,
  branchHours = {},
} = {}) {
  const window = buildShiftWindow(reportDate, shiftType, branchHours);
  if (!window || !branchId) return null;
  const context = { branchId, branchName, shiftType, reportDate };
  const applicable = (Array.isArray(templates) ? templates : [])
    .filter((task) => isApplicableTemplate(task, context));
  const hourlyTemplates = applicable.filter((task) => String(task.frequency || '').toLowerCase() === 'hourly');
  const routineTemplates = applicable.filter((task) => String(task.frequency || '').toLowerCase() !== 'hourly');
  const hourlyIds = new Set(hourlyTemplates.map((task) => String(task.id)));
  const completedIds = new Set();

  for (const task of routineTemplates) {
    const completed = (Array.isArray(logs) ? logs : []).some((log) =>
      String(log?.template_id) === String(task.id)
      && String(log?.branch_id) === String(branchId)
      && logMatchesShift(log, task, shiftType)
      && logInsideWindow(log, window)
      && isCompleted(log));
    if (completed) completedIds.add(String(task.id));
  }

  let hourlyCompleted = 0;
  let hourlyNotPerformed = 0;
  const countableHourlyLogs = branchName === TRIAL_BRANCH_NAME && shiftType === 'Morning' ? [] : hourlyLogs;
  for (const log of Array.isArray(countableHourlyLogs) ? countableHourlyLogs : []) {
    if (String(log?.branch_id) !== String(branchId) || log?.shift_type !== shiftType || !logInsideWindow(log, window)) continue;
    const templateId = String(log?.template_id || '');
    if (templateId && !hourlyIds.has(templateId)) continue;
    if (isCompleted(log)) hourlyCompleted += 1;
    else if (isNotPerformed(log)) hourlyNotPerformed += 1;
  }

  const scheduled = routineTemplates.length;
  const completed = completedIds.size;
  return {
    nonHourly: { scheduled, completed, incomplete: Math.max(0, scheduled - completed) },
    hourly: { completed: hourlyCompleted, notPerformed: hourlyNotPerformed },
  };
}

export { buildShiftWindow };
