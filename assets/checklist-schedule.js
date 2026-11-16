(function (root, factory) {
  const schedule = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = schedule;
  if (root) root.ZamChecklistSchedule = schedule;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROLE_CATEGORY = { Barista: 'البار', Waiter: 'الصالة', Kitchen: 'المطبخ' };

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

  function isTaskDueToday(task, date = new Date()) {
    const frequency = task?.frequency || 'daily';
    if (frequency === 'daily' || frequency === 'hourly') return true;
    const p = riyadhParts(date);
    const localDay = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    if (frequency === 'weekly') return Number(task.day_of_week) === localDay;
    if (frequency === 'monthly') {
      const lastDay = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
      return p.day === Math.min(Number(task.day_of_month), lastDay);
    }
    return true;
  }

  function isInventoryTaskVisible(task, date = new Date()) {
    if (task?.task_type !== 'inventory_request') return true;
    const raw = String(task.target_time || '00:00').slice(0, 5);
    const [hour, minute] = raw.split(':').map(Number);
    const targetMinute = (hour || 0) * 60 + (minute || 0);
    const nowMinute = riyadhMinuteOfDay(date);
    const nowParts = riyadhParts(date);
    // A 00:00 evening-shift task is due at the coming midnight, not at 16:00.
    if (task.shift_type === 'Evening' && targetMinute === 0 && nowParts.hour >= 16) return false;
    return nowMinute >= targetMinute;
  }

  function isTaskTimeVisible(task, date = new Date()) {
    if (task?.task_type === 'inventory_request') return isInventoryTaskVisible(task, date);
    if (task?.task_type !== 'restroom_check' || !task.target_time) return true;
    const [hour, minute] = String(task.target_time).slice(0, 5).split(':').map(Number);
    return riyadhMinuteOfDay(date) >= (hour || 0) * 60 + (minute || 0);
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

  function isTemplateVisibleForEmployee(task, { role, branchId, branchName, categories, shiftType } = {}, date = new Date()) {
    if (!task || task.task_type === 'inventory_request') return false;
    if (task.frequency === 'hourly' && role !== 'Waiter') return false;
    if (task.branch_id && task.branch_id !== branchId) return false;
    if (role === 'Waiter' && branchName === 'زام المنح' && shiftType === 'Morning') return false;
    if (branchName === 'زام الحي' && task.task_type === 'restroom_check') return false;
    if (task.frequency === 'hourly' && branchName && branchName !== 'زام الرئيسي') return false;
    const allowedCategories = Array.isArray(categories) && categories.length
      ? categories
      : (ROLE_CATEGORY[role] ? [ROLE_CATEGORY[role]] : null);
    if (allowedCategories && !allowedCategories.includes(task.category)) return false;
    if (shiftType && ![shiftType, 'Both'].includes(task.shift_type)) return false;
    if (!isTaskDueToday(task, date) || !isTaskTimeVisible(task, date)) return false;
    if (task.frequency === 'hourly' && (task.task_type !== 'restroom_check' || !task.branch_id)) return false;
    return true;
  }

  return {
    ROLE_CATEGORY,
    riyadhParts,
    riyadhDateString,
    riyadhMinuteOfDay,
    isTaskDueToday,
    isInventoryTaskVisible,
    isTaskTimeVisible,
    hourlyOccurrenceKey,
    millisecondsUntilNextRiyadhHour,
    isTemplateVisibleForEmployee
  };
});
