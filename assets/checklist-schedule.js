(function (root, factory) {
  const schedule = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = schedule;
  if (root) root.ZamChecklistSchedule = schedule;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROLE_CATEGORY = { Barista: 'البار', Waiter: 'الصالة', Kitchen: 'المطبخ' };
  const SUPERVISOR_ONLY_TASK_TYPES = new Set(['inventory_request', 'inventory_count']);
  const SHIFT_OPENING_MINUTE = 5 * 60 + 30;
  const SHIFT_CLOSING_MINUTE = 2 * 60 + 30;
  const EVENING_START_MINUTE = 15 * 60 + 30;
  const EMPLOYEE_GRACE_MINUTES = 60;
  const RIYADH_UTC_OFFSET_HOURS = 3;

  function riyadhParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const value = type => Number(parts.find(part => part.type === type)?.value || 0);
    return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
  }

  function riyadhDateString(date = new Date()) {
    const p = riyadhParts(date);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  function riyadhMinuteOfDay(date = new Date()) {
    const p = riyadhParts(date);
    return p.hour * 60 + p.minute;
  }

  function parseTimeMinutes(value, fallback) {
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : fallback;
  }

  function shiftRiyadhDateParts(parts, offsetDays) {
    const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays, 12));
    return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
  }

  function dateStringFromParts(parts) {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }

  function riyadhInstant(parts, minuteOfBusinessDay) {
    const hour = Math.floor(minuteOfBusinessDay / 60);
    const minute = minuteOfBusinessDay % 60;
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - RIYADH_UTC_OFFSET_HOURS, minute));
  }

  function buildShiftWindow(shiftType, branchHours = {}, businessDateParts = riyadhParts()) {
    const opening = parseTimeMinutes(branchHours?.opening_time, SHIFT_OPENING_MINUTE);
    const closing = parseTimeMinutes(branchHours?.closing_time, SHIFT_CLOSING_MINUTE);
    const closingOffset = closing <= opening ? 1440 : 0;
    const closeOnTimeline = closing + closingOffset;
    let startMinute;
    let endMinute;
    if (shiftType === 'Morning') {
      startMinute = opening;
      endMinute = Math.min(EVENING_START_MINUTE, closeOnTimeline);
    } else if (shiftType === 'Evening') {
      startMinute = Math.max(EVENING_START_MINUTE, opening);
      endMinute = closeOnTimeline;
    } else {
      return { valid: false, shiftType, businessDate: dateStringFromParts(businessDateParts) };
    }
    const startAt = riyadhInstant(businessDateParts, startMinute);
    const endAt = riyadhInstant(businessDateParts, endMinute);
    const graceEndAt = new Date(endAt.getTime() + EMPLOYEE_GRACE_MINUTES * 60 * 1000);
    return {
      valid: startMinute < endMinute,
      shiftType,
      businessDate: dateStringFromParts(businessDateParts),
      startMinute,
      endMinute,
      startAt,
      endAt,
      graceEndAt,
      dateFrom: dateStringFromParts(businessDateParts),
      dateTo: riyadhDateString(endAt)
    };
  }

  function getShiftWindow(shiftType, branchHours = {}, date = new Date()) {
    const today = riyadhParts(date);
    const dayOffset = shiftType === 'Evening' && riyadhMinuteOfDay(date) < EVENING_START_MINUTE ? -1 : 0;
    return buildShiftWindow(shiftType, branchHours, shiftRiyadhDateParts(today, dayOffset));
  }

  function isWithinShiftTaskWindow(shiftType, branchHours = {}, date = new Date()) {
    const window = getShiftWindow(shiftType, branchHours, date);
    const nowMs = date.getTime();
    return window.valid && nowMs >= window.startAt.getTime() && nowMs < window.graceEndAt.getTime();
  }

  function isTaskDueToday(task, date = new Date()) {
    const frequency = task?.frequency || 'daily';
    if (frequency === 'daily' || frequency === 'hourly') return true;
    const p = riyadhParts(date);
    const localDay = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    if (frequency === 'weekly') {
      const days = Array.isArray(task?.days_of_week) ? task.days_of_week : [];
      return days.length
        ? days.some(day => Number(day) === localDay)
        : Number(task?.day_of_week) === localDay;
    }
    if (frequency === 'monthly') {
      const lastDay = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
      return p.day === Math.min(Number(task.day_of_month), lastDay);
    }
    return true;
  }

  function isTaskDueForShift(task, shiftType, date = new Date(), branchHours = {}) {
    const window = getShiftWindow(shiftType, branchHours, date);
    if (!window.valid) return false;
    const occurrenceDate = new Date(`${window.businessDate}T12:00:00+03:00`);
    return isTaskDueToday(task, occurrenceDate);
  }

  function taskTargetMinute(task) {
    if (!task?.target_time) return null;
    return parseTimeMinutes(String(task.target_time).slice(0, 5), null);
  }

  function isSupervisorOnlyTask(task) {
    return SUPERVISOR_ONLY_TASK_TYPES.has(task?.task_type);
  }

  function isTaskTimeVisible(task, date = new Date(), shiftType = null) {
    if (!isSupervisorOnlyTask(task) && !(task?.task_type === 'restroom_check' && task.target_time)) return true;
    const targetMinute = taskTargetMinute(task);
    if (targetMinute === null) return true;
    const nowMinute = riyadhMinuteOfDay(date);
    if (shiftType === 'Evening') {
      // Evening tasks before 15:30 are due after midnight in the same shift;
      // tasks at/after 15:30 belong to the preceding evening while it is after midnight.
      if (nowMinute >= EVENING_START_MINUTE) return targetMinute >= EVENING_START_MINUTE && nowMinute >= targetMinute;
      return targetMinute >= EVENING_START_MINUTE || nowMinute >= targetMinute;
    }
    return nowMinute >= targetMinute;
  }

  function isInventoryTaskScheduled(task, date = new Date(), branchHours = {}, shiftType = task?.shift_type) {
    if (!isSupervisorOnlyTask(task)) return true;
    if (shiftType && !isTaskDueForShift(task, shiftType, date, branchHours)) return false;
    return isTaskTimeVisible(task, date, shiftType);
  }

  function isInventoryTaskVisible(task, date = new Date(), branchHours = {}, shiftType = task?.shift_type) {
    if (!isInventoryTaskScheduled(task, date, branchHours, shiftType)) return false;
    return !shiftType || isWithinShiftTaskWindow(shiftType, branchHours, date);
  }

  function templateAppliesToBranch(task, branchId) {
    const links = Array.isArray(task?.checklist_template_branches) ? task.checklist_template_branches : [];
    const linkedIds = [...new Set(links.map(link => link?.branch_id).filter(Boolean).map(String))];
    if (linkedIds.length) return branchId != null && linkedIds.includes(String(branchId));
    return !task?.branch_id || String(task.branch_id) === String(branchId);
  }

  function isTemplateScheduledForEmployee(task, { role, branchId, branchName, categories, shiftType, branchHours } = {}, date = new Date()) {
    if (!task || isSupervisorOnlyTask(task)) return false;
    if (task.frequency === 'hourly' && role !== 'Waiter') return false;
    if (!templateAppliesToBranch(task, branchId)) return false;
    if (role === 'Waiter' && branchName === 'زام المنح' && shiftType === 'Morning') return false;
    if (branchName === 'زام الحي' && task.task_type === 'restroom_check') return false;
    if (task.frequency === 'hourly' && branchName && branchName !== 'زام الرئيسي') return false;
    const allowedCategories = Array.isArray(categories) && categories.length
      ? categories
      : (ROLE_CATEGORY[role] ? [ROLE_CATEGORY[role]] : null);
    if (allowedCategories && !allowedCategories.includes(task.category)) return false;
    if (shiftType && ![shiftType, 'Both'].includes(task.shift_type)) return false;
    if (shiftType ? !isTaskDueForShift(task, shiftType, date, branchHours) : !isTaskDueToday(task, date)) return false;
    if (!isTaskTimeVisible(task, date, shiftType)) return false;
    if (task.frequency === 'hourly' && (task.task_type !== 'restroom_check' || !task.branch_id)) return false;
    return true;
  }

  function isTemplateVisibleForEmployee(task, context = {}, date = new Date()) {
    return isTemplateScheduledForEmployee(task, context, date) &&
      (!context.shiftType || isWithinShiftTaskWindow(context.shiftType, context.branchHours, date));
  }

  // Branch/manager views keep scheduled tasks in the denominator after the employee window closes.
  function isTemplateVisibleInBranch(task, { branchId, branchName, shiftType, branchHours } = {}, date = new Date()) {
    if (!task || task.is_active === false || task.active === false || isSupervisorOnlyTask(task)) return false;
    if (!templateAppliesToBranch(task, branchId)) return false;
    if (shiftType && ![shiftType, 'Both'].includes(task.shift_type)) return false;
    if (branchName === 'زام الحي' && task.task_type === 'restroom_check') return false;
    if (task.frequency === 'hourly' && (branchName !== 'زام الرئيسي' || task.task_type !== 'restroom_check' || !task.branch_id)) return false;
    if (shiftType ? !isTaskDueForShift(task, shiftType, date, branchHours) : !isTaskDueToday(task, date)) return false;
    if (!isTaskTimeVisible(task, date, shiftType)) return false;
    return true;
  }

  function millisecondsUntilNextVisibilityChange(shiftType, branchHours = {}, date = new Date()) {
    const nowMs = date.getTime();
    const currentWindow = getShiftWindow(shiftType, branchHours, date);
    let candidate = null;
    if (currentWindow.valid && nowMs < currentWindow.startAt.getTime()) candidate = currentWindow.startAt;
    else if (currentWindow.valid && nowMs < currentWindow.graceEndAt.getTime()) candidate = currentWindow.graceEndAt;
    else {
      const today = riyadhParts(date);
      const minute = riyadhMinuteOfDay(date);
      const nextBusinessDate = shiftType === 'Evening' && minute < EVENING_START_MINUTE
        ? today
        : shiftRiyadhDateParts(today, 1);
      const nextWindow = buildShiftWindow(shiftType, branchHours, nextBusinessDate);
      if (nextWindow.valid) candidate = nextWindow.startAt;
    }
    return candidate ? Math.max(250, candidate.getTime() - nowMs) : 60 * 60 * 1000;
  }

  function hourlyOccurrenceKey(date = new Date()) {
    const p = riyadhParts(date);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}-${String(p.hour).padStart(2, '0')}`;
  }

  function millisecondsUntilNextRiyadhHour(date = new Date()) {
    const p = riyadhParts(date);
    const remainder = (p.minute * 60 + p.second) * 1000 + date.getMilliseconds();
    return Math.max(250, 60 * 60 * 1000 - remainder + 250);
  }

  return {
    ROLE_CATEGORY,
    EVENING_START_MINUTE,
    EMPLOYEE_GRACE_MINUTES,
    riyadhParts,
    riyadhDateString,
    riyadhMinuteOfDay,
    parseTimeMinutes,
    getShiftWindow,
    isWithinShiftTaskWindow,
    isTaskDueToday,
    isTaskDueForShift,
    isSupervisorOnlyTask,
    isInventoryTaskScheduled,
    isInventoryTaskVisible,
    templateAppliesToBranch,
    isTaskTimeVisible,
    hourlyOccurrenceKey,
    millisecondsUntilNextRiyadhHour,
    millisecondsUntilNextVisibilityChange,
    isTemplateScheduledForEmployee,
    isTemplateVisibleForEmployee,
    isTemplateVisibleInBranch
  };
});
