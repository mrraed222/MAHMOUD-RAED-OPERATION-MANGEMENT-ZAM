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

  function isEmployeeOnShift(employee, shiftType) {
    return !employee.shift_type || employee.shift_type === 'Both' || employee.shift_type === shiftType;
  }

  function tasksForEmployee(templates, employee, {
    branchId,
    branchName,
    categoriesBy = {},
    shiftType,
    now = new Date()
  } = {}) {
    if (!employee || !shiftType) return [];
    const context = {
      role: employee.role,
      branchId,
      branchName,
      categories: assignedCategories(employee, categoriesBy),
      shiftType
    };
    return (templates || []).filter(task =>
      task && task.is_active !== false &&
      schedule.isTemplateVisibleForEmployee(task, context, now)
    );
  }

  function isSupervisorTaskVisible(task, { branchId, shiftType, now = new Date() } = {}) {
    return task && task.is_active !== false && task.task_type === 'inventory_request' &&
      (!task.branch_id || task.branch_id === branchId) &&
      [shiftType, 'Both'].includes(task.shift_type) &&
      schedule.isTaskDueToday(task, now) &&
      schedule.isInventoryTaskVisible(task, now);
  }

  function dashboardTasks({
    templates,
    staff,
    categoriesBy = {},
    branchId,
    branchName,
    shiftType,
    currentUserRole,
    now = new Date()
  } = {}) {
    const tasksById = new Map();
    (staff || []).filter(employee => isEmployeeOnShift(employee, shiftType)).forEach(employee => {
      tasksForEmployee(templates, employee, { branchId, branchName, categoriesBy, shiftType, now })
        .forEach(task => tasksById.set(task.id, task));
    });

    // Only an active Supervisor can complete inventory requests through the guarded RPC.
    if (currentUserRole === 'Supervisor') {
      (templates || []).filter(task => isSupervisorTaskVisible(task, { branchId, shiftType, now }))
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
    // A legacy no-shift log is attributable only to a single-shift template;
    // never let it mark a Both-shifts task complete in both shifts.
    return task.shift_type !== 'Both' && task.shift_type === shiftType;
  }

  function completedTaskKeys(tasks, logs, hourlyLogs, {
    branchId,
    shiftType,
    now = new Date(),
    executedBy = null
  } = {}) {
    const riyadhDate = schedule.riyadhDateString(now);
    const currentHour = schedule.riyadhParts(now).hour;
    const completed = new Set();

    (tasks || []).forEach(task => {
      const key = taskKey(task, now);
      if (task.frequency === 'hourly') {
        const found = (hourlyLogs || []).some(log =>
          log.template_id === task.id && log.branch_id === branchId &&
          String(log.execution_date).slice(0, 10) === riyadhDate &&
          Number(log.occurrence_hour) === currentHour && log.shift_type === shiftType &&
          (!executedBy || log.executed_by === executedBy) && isCompleted(log)
        );
        if (found) completed.add(key);
        return;
      }

      const found = (logs || []).some(log =>
        log.template_id === task.id && log.branch_id === branchId &&
        String(log.execution_date).slice(0, 10) === riyadhDate &&
        logMatchesShift(log, task, shiftType) &&
        (!executedBy || log.executed_by === executedBy) && isCompleted(log)
      );
      if (found) completed.add(key);
    });
    return completed;
  }

  function branchProgress({
    templates, staff, categoriesBy = {}, branchId, branchName = '', logs = [], hourlyLogs = [], now = new Date()
  } = {}) {
    const result = { total: 0, done: 0, pct: null, byShift: {} };
    if (!branchId) return result;
    ['Morning', 'Evening'].forEach(shiftType => {
      const shiftStaff = (staff || []).filter(employee => employee.branch_id === branchId && isEmployeeOnShift(employee, shiftType));
      const tasks = dashboardTasks({
        templates, staff: shiftStaff, categoriesBy, branchId, branchName, shiftType,
        currentUserRole: 'Manager', now
      });
      const completed = completedTaskKeys(tasks, logs, hourlyLogs, { branchId, shiftType, now });
      const done = tasks.filter(task => completed.has(taskKey(task, now))).length;
      result.byShift[shiftType] = { total: tasks.length, done };
      result.total += tasks.length;
      result.done += done;
    });
    result.pct = result.total ? Math.round(result.done / result.total * 100) : null;
    return result;
  }

  return {
    assignedCategories,
    isEmployeeOnShift,
    tasksForEmployee,
    isSupervisorTaskVisible,
    dashboardTasks,
    taskKey,
    completedTaskKeys,
    branchProgress
  };
});
