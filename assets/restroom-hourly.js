(function (root, factory) {
  const schedule = typeof module !== 'undefined' && module.exports
    ? require('./checklist-schedule.js')
    : root.ZamChecklistSchedule;
  const api = factory(schedule);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZamRestroomHourly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schedule) {
  'use strict';

  const WINDOW_MINUTES = 20;
  const MORNING_HOURS = Object.freeze([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const EVENING_HOURS = Object.freeze([16, 17, 18, 19, 20, 21, 22, 23, 0, 1]);
  const STEPS = Object.freeze([
    { key: 'tissues', label: 'فحص توفر المناديل' },
    { key: 'sink', label: 'مسح المغسلة بمنديل ومعقم' },
    { key: 'toilet_seat', label: 'تنظيف مقعد المرحاض' },
    { key: 'floor', label: 'مسح الأرضية بالممسحة' }
  ]);
  const STEP_KEYS = Object.freeze(STEPS.map(step => step.key));
  const STATUS_LABELS = Object.freeze({
    upcoming: 'قادم',
    open: 'متاحة للتنفيذ',
    completed: 'مكتملة',
    missed: 'غير منفذة',
    beforeActivation: 'قبل بدء الجدول'
  });

  function hoursForShift(shiftType) {
    if (shiftType === 'Morning') return MORNING_HOURS.slice();
    if (shiftType === 'Evening') return EVENING_HOURS.slice();
    return [];
  }

  function addDays(dateString, offset) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset, 12));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function executionDateForHour(shiftType, hour, businessDate) {
    return shiftType === 'Evening' && Number(hour) < 16 ? addDays(businessDate, 1) : businessDate;
  }

  function occurrenceStartAt(executionDate, hour) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(executionDate || ''));
    if (!match || !Number.isInteger(Number(hour)) || Number(hour) < 0 || Number(hour) > 23) return null;
    // Riyadh is UTC+03:00 year-round; the stored timestamps are absolute instants.
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(hour) - 3, 0, 0, 0));
  }

  function occurrenceKey(templateId, executionDate, hour) {
    return `${String(templateId || '')}:${String(executionDate || '')}:${String(Number(hour)).padStart(2, '0')}`;
  }

  function getOccurrence({ shiftType, hour, businessDate, activeFrom = null, now = new Date(), log = null } = {}) {
    const executionDate = executionDateForHour(shiftType, Number(hour), businessDate);
    const startAt = occurrenceStartAt(executionDate, Number(hour));
    if (!startAt) return null;
    const deadlineAt = new Date(startAt.getTime() + WINDOW_MINUTES * 60 * 1000);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const activeAt = activeFrom ? new Date(activeFrom).getTime() : Number.NEGATIVE_INFINITY;
    let status;
    const loggedStatus = String(log?.status || '').trim().toLowerCase();

    if (startAt.getTime() < activeAt) status = 'beforeActivation';
    else if (loggedStatus === 'completed' || loggedStatus === 'done' || loggedStatus === 'مكتمل' || loggedStatus === 'منجز') status = 'completed';
    else if (loggedStatus === 'notperformed' || loggedStatus === 'not_performed' || loggedStatus === 'غير منفذة') status = 'missed';
    else if (nowMs < startAt.getTime()) status = 'upcoming';
    else if (nowMs < deadlineAt.getTime()) status = 'open';
    else status = 'missed';

    return {
      shiftType,
      hour: Number(hour),
      executionDate,
      startAt,
      deadlineAt,
      status,
      statusLabel: STATUS_LABELS[status],
      log: log || null
    };
  }

  function getShiftOccurrences({ shiftType, businessDate, activeFrom = null, logs = [], templateId = null, now = new Date() } = {}) {
    const byKey = new Map((logs || []).map(log => [
      occurrenceKey(log.template_id, log.execution_date, log.occurrence_hour), log
    ]));
    return hoursForShift(shiftType).map(hour => {
      const executionDate = executionDateForHour(shiftType, hour, businessDate);
      const log = byKey.get(occurrenceKey(templateId, executionDate, hour)) || null;
      return getOccurrence({ shiftType, hour, businessDate, activeFrom, now, log });
    }).filter(Boolean);
  }

  function riyadhTimeLabel(hour) {
    return `${String(Number(hour)).padStart(2, '0')}:00`;
  }

  function millisecondsUntilNextChange(shiftType, { businessDate, activeFrom = null, now = new Date() } = {}) {
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const candidates = [];
    hoursForShift(shiftType).forEach(hour => {
      const date = executionDateForHour(shiftType, hour, businessDate);
      const start = occurrenceStartAt(date, hour);
      if (!start) return;
      const deadline = new Date(start.getTime() + WINDOW_MINUTES * 60 * 1000);
      if (activeFrom && start.getTime() < new Date(activeFrom).getTime()) return;
      [start, deadline].forEach(instant => {
        if (instant.getTime() > nowMs) candidates.push(instant.getTime());
      });
    });
    return candidates.length ? Math.max(250, Math.min(...candidates) - nowMs + 250) : null;
  }

  function stepsObjectFromKeys(keys = []) {
    const selected = new Set((keys || []).map(String));
    return Object.fromEntries(STEP_KEYS.map(key => [key, selected.has(key)]));
  }

  function allStepsComplete(steps) {
    return !!steps && typeof steps === 'object' && !Array.isArray(steps) &&
      STEP_KEYS.every(key => steps[key] === true) &&
      Object.keys(steps).length === STEP_KEYS.length;
  }

  function canCompleteOccurrence(occurrence, steps, now = new Date()) {
    if (!occurrence || !occurrence.deadlineAt || occurrence.status !== 'open' || !allStepsComplete(steps)) return false;
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    return Number.isFinite(nowMs) && nowMs < new Date(occurrence.deadlineAt).getTime();
  }

  function isRestroomHourlyTask(task) {
    return task?.task_title === 'النظافة الدورية لدورات المياه' &&
      task?.category === 'الصالة' &&
      task?.shift_type === 'Both' &&
      task?.frequency === 'hourly' &&
      task?.task_type === 'restroom_check' &&
      task?.branch_id == null &&
      task?.requires_photo === true;
  }

  return Object.freeze({
    WINDOW_MINUTES,
    MORNING_HOURS,
    EVENING_HOURS,
    STEPS,
    STEP_KEYS,
    STATUS_LABELS,
    hoursForShift,
    addDays,
    executionDateForHour,
    occurrenceStartAt,
    occurrenceKey,
    getOccurrence,
    getShiftOccurrences,
    riyadhTimeLabel,
    millisecondsUntilNextChange,
    stepsObjectFromKeys,
    allStepsComplete,
    canCompleteOccurrence,
    isRestroomHourlyTask
  });
});
