(function (root, factory) {
  const schedule = typeof module !== 'undefined' && module.exports
    ? require('./checklist-schedule.js')
    : root.ZamChecklistSchedule;
  const dashboard = factory(schedule);
  if (typeof module !== 'undefined' && module.exports) module.exports = dashboard;
  if (root) root.ZamChecklistDashboard = dashboard;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schedule) {
  'use strict';

  const ROLE_CATEGORY = schedule.ROLE_CATEGORY || { Barista: 'البار', Waiter: 'الصالة', Kitchen: 'المطبخ' };
  const COMPLETED_STATUSES = new Set(['completed', 'done', 'مكتمل', 'منجز']);

  function initialDashboardShift(user, now = new Date(), branchHours = {}) {
    const profileShift = user?.shift_type;
    if (!['Owner', 'Admin'].includes(user?.role) && ['Morning', 'Evening'].includes(profileShift)) {
      return profileShift;
    }
    return schedule.isWithinShiftTaskWindow('Evening', branchHours, now) ? 'Evening' : 'Morning';
  }

  function canSelectDashboardShift(user) {
    return ['Owner', 'Admin', 'Manager'].includes(user?.role) || user?.shift_type === 'Both';
  }

  function isCompleted(log) {
    if (!log) return false;
    const status = String(log.status || 'Completed').trim().toLowerCase();
    return COMPLETED_STATUSES.has(status);
  }

  function assignedCategories(employee, categoriesBy = {}) {
    const assigned = categoriesBy[employee.id];
    if (Array.isArray(assigned) && assigned.length) return assigned;
    return ROLE_CATEGORY[employee.role] ? [ROLE_CATEGORY[employee.role]] : [];
  }

  function assignedTemplateIds(employee, assignmentsByProfile = {}) {
    const assigned = assignmentsByProfile[employee.id];
    return Array.isArray(assigned) ? assigned.map(String) : [];
  }

  function isEmployeeOnShift(employee, shiftType) {
    return !employee.shift_type || employee.shift_type === 'Both' || employee.shift_type === shiftType;
  }

  function tasksForEmployee(templates, employee, {
    branchId,
    branchName,
    branchHours,
    categoriesBy = {},
    assignmentsByProfile = {},
    shiftType,
    includeExpired = false,
    now = new Date()
  } = {}) {
    if (!employee || !shiftType) return [];
    const context = {
      role: employee.role,
      branchId,
      branchName,
      branchHours,
      categories: assignedCategories(employee, categoriesBy),
      assignedTemplateIds: assignedTemplateIds(employee, assignmentsByProfile),
      shiftType
    };
    const isVisible = includeExpired
      ? schedule.isTemplateScheduledForEmployee
      : schedule.isTemplateVisibleForEmployee;
    return (templates || []).filter(task =>
      task && task.is_active !== false && isVisible(task, context, now)
    );
  }

  function isSupervisorTaskVisible(task, { branchId, branchHours, shiftType, includeExpired = false, now = new Date() } = {}) {
    if (!task || task.is_active === false || !schedule.isSupervisorOnlyTask(task)) return false;
    if (!schedule.templateAppliesToBranch(task, branchId)) return false;
    if (!shiftType || ![shiftType, 'Both'].includes(task.shift_type)) return false;
    return includeExpired
      ? schedule.isInventoryTaskScheduled(task, now, branchHours, shiftType)
      : schedule.isInventoryTaskVisible(task, now, branchHours, shiftType);
  }

  function dashboardTasks({
    templates,
    staff,
    categoriesBy = {},
    assignmentsByProfile = {},
    branchId,
    branchName,
    branchHours,
    shiftType,
    currentUserRole,
    now = new Date()
  } = {}) {
    const tasksById = new Map();
    // Branch totals represent due work, not only categories with an active employee profile.
    (templates || []).filter(task =>
      schedule.isTemplateVisibleInBranch(task, { branchId, branchName, branchHours, shiftType }, now)
    ).forEach(task => tasksById.set(task.id, task));

    (staff || []).filter(employee => isEmployeeOnShift(employee, shiftType)).forEach(employee => {
      // Manager summaries retain due tasks after the employee-facing deadline.
      tasksForEmployee(templates, employee, { branchId, branchName, branchHours, categoriesBy, assignmentsByProfile, shiftType, includeExpired: true, now })
        .forEach(task => tasksById.set(task.id, task));
    });

    // Only an active Supervisor can complete inventory requests through the guarded RPC.
    if (currentUserRole === 'Supervisor') {
      (templates || []).filter(task => isSupervisorTaskVisible(task, { branchId, branchHours, shiftType, includeExpired: true, now }))
        .forEach(task => tasksById.set(task.id, task));
    }
    return [...tasksById.values()];
  }

  function taskKey(task, now = new Date()) {
    if (task?.frequency !== 'hourly') return String(task?.id ?? '');
    return `${task.id}:hour:${schedule.riyadhParts(now).hour}`;
  }

  function logMatchesShift(log, task, shiftType) {
    if (log.shift_type) return log.shift_type === shiftType;
    return task.shift_type !== 'Both' && task.shift_type === shiftType;
  }

  function logInsideShift(log, shiftType, branchHours, now, { includeLateCompletions = false } = {}) {
    const window = schedule.getShiftWindow(shiftType, branchHours, now);
    if (!window.valid) return false;
    if (!log?.created_at) return String(log?.execution_date).slice(0, 10) === window.businessDate;
    const createdAt = Date.parse(log.created_at);
    if (!Number.isFinite(createdAt)) return false;
    if (createdAt >= window.startAt.getTime() && createdAt < window.graceEndAt.getTime()) return true;
    if (!includeLateCompletions || createdAt < window.graceEndAt.getTime()) return false;
    const executionDate = String(log.execution_date || '').slice(0, 10);
    return executionDate === window.businessDate || (shiftType === 'Evening' && executionDate === window.dateTo);
  }

  function completedTaskKeys(tasks, logs, hourlyLogs, {
    branchId,
    branchHours,
    shiftType,
    now = new Date(),
    executedBy = null
  } = {}) {
    const currentHour = schedule.riyadhParts(now).hour;
    const completed = new Set();

    (tasks || []).forEach(task => {
      const key = taskKey(task, now);
      if (task.frequency === 'hourly') {
        const found = (hourlyLogs || []).some(log =>
          String(log.template_id) === String(task.id) && log.branch_id === branchId &&
          Number(log.occurrence_hour) === currentHour && log.shift_type === shiftType &&
          logInsideShift(log, shiftType, branchHours, now) &&
          (!executedBy || log.executed_by === executedBy) && isCompleted(log)
        );
        if (found) completed.add(key);
        return;
      }

      const found = (logs || []).some(log =>
        String(log.template_id) === String(task.id) && log.branch_id === branchId &&
        logMatchesShift(log, task, shiftType) && logInsideShift(log, shiftType, branchHours, now, { includeLateCompletions: true }) &&
        (!executedBy || log.executed_by === executedBy) && isCompleted(log)
      );
      if (found) completed.add(key);
    });
    return completed;
  }

  function branchProgress({
    templates, staff, categoriesBy = {}, branchId, branchName = '', branchHours = {}, logs = [], hourlyLogs = [], now = new Date()
  } = {}) {
    const result = {
      total: 0, done: 0, pct: null, nonHourlyPct: null,
      hourlyTemplateCount: 0, hourlyShiftPairs: 0, incompleteHourly: false, byShift: {}
    };
    if (!branchId) return result;
    ['Morning', 'Evening'].forEach(shiftType => {
      const context = { branchId, branchName, branchHours, shiftType };
      const applicable = (templates || []).filter(task =>
        schedule.isTemplateVisibleInBranch(task, context, now)
      );
      const hourly = applicable.filter(task => String(task.frequency || '').toLowerCase() === 'hourly');
      const ordinary = applicable.filter(task => String(task.frequency || '').toLowerCase() !== 'hourly');
      const completed = completedTaskKeys(ordinary, logs, [], { branchId, branchHours, shiftType, now });
      const done = ordinary.filter(task => completed.has(taskKey(task, now))).length;
      result.byShift[shiftType] = { total: ordinary.length, done, hourlyTemplates: hourly.length };
      result.total += ordinary.length;
      result.done += done;
      result.hourlyShiftPairs += hourly.length;
      hourly.forEach(task => { result._hourlyIds = result._hourlyIds || new Set(); result._hourlyIds.add(String(task.id)); });
    });
    result.hourlyTemplateCount = result._hourlyIds ? result._hourlyIds.size : 0;
    delete result._hourlyIds;
    result.incompleteHourly = result.hourlyTemplateCount > 0;
    result.nonHourlyPct = result.total ? Math.round(result.done / result.total * 100) : null;
    result.pct = result.incompleteHourly ? null : result.nonHourlyPct;
    return result;
  }

  return {
    assignedCategories,
    isEmployeeOnShift,
    initialDashboardShift,
    canSelectDashboardShift,
    tasksForEmployee,
    isSupervisorTaskVisible,
    dashboardTasks,
    taskKey,
    logMatchesShift,
    logInsideShift,
    completedTaskKeys,
    branchProgress
  };
});
