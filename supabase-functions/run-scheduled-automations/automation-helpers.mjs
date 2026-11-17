const ROLE_CATEGORY = { Barista: 'البار', Waiter: 'الصالة', Kitchen: 'المطبخ' };
const SHIFTS = ['Morning', 'Evening'];

function riyadhDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short'
  }).formatToParts(date);
  const out = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[out.weekday]
  };
}

export function isScheduledChecklistTask(task, date = new Date()) {
  if (!task || task.is_active === false || task.active === false) return false;
  if (task.task_type === 'inventory_request') return false;
  const frequency = String(task.frequency || 'daily').trim().toLowerCase();
  if (frequency === 'hourly') return false;
  const today = riyadhDateParts(date);
  if (frequency === 'daily') return true;
  if (frequency === 'weekly') return Number(task.day_of_week) === today.weekday;
  if (frequency === 'monthly') {
    const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
    const requestedDay = Number(task.day_of_month);
    return Number.isFinite(requestedDay) && today.day === Math.min(requestedDay, lastDay);
  }
  return false;
}

export function isBranchOperational(branch, asOf = new Date()) {
  if (!branch || typeof branch !== 'object') return false;
  const status = branch.lifecycle_status;
  if (status == null || status === '') return true;
  if (status === 'operational') return true;
  if (status !== 'planned') return false;
  const openingDate = String(branch.planned_opening_date || '').slice(0, 10);
  const current = typeof asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? asOf
    : (() => {
      const parts = riyadhDateParts(asOf);
      return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    })();
  return /^\d{4}-\d{2}-\d{2}$/.test(openingDate) && openingDate <= current;
}

export function templateBranchIds(task) {
  const linkedIds = Array.isArray(task?.checklist_template_branches)
    ? task.checklist_template_branches.map(link => link?.branch_id).filter(Boolean)
    : [];
  const uniqueIds = [...new Set(linkedIds.map(String))];
  return uniqueIds.length ? uniqueIds : (task?.branch_id ? [String(task.branch_id)] : []);
}

export function templateAppliesToBranch(task, branchId) {
  const branchIds = templateBranchIds(task);
  if (branchIds.length) return branchId != null && branchIds.includes(String(branchId));
  return task?.branch_id == null;
}

export function isChecklistComplete(status) {
  return ['completed', 'complete', 'done', 'finished', 'مكتمل', 'منفذ', 'منجز']
    .includes(String(status || '').trim().toLowerCase());
}

function taskMatchesBranchAndShift(task, branchId, shiftType, date) {
  if (!isScheduledChecklistTask(task, date)) return false;
  if (!templateAppliesToBranch(task, branchId)) return false;
  return task.shift_type === 'Both' || task.shift_type === shiftType;
}

function logMatchesTaskOccurrence(log, task, { branchId, shiftType, date, executedBy = null }) {
  if (!log || String(log.template_id) !== String(task.id) || log.branch_id !== branchId) return false;
  if (String(log.execution_date || '').slice(0, 10) !== String(date).slice(0, 10)) return false;
  if (executedBy && log.executed_by !== executedBy) return false;
  if (log.shift_type) return log.shift_type === shiftType;
  // سجلات Both القديمة بلا وردية لا تنسب إلى أي وردية حتى لا تحتسب مرتين.
  return task.shift_type !== 'Both' && task.shift_type === shiftType;
}

export function buildChecklistShiftSummary(templates, logs, { branchId, shiftType, date }) {
  const tasks = (templates || []).filter(task => taskMatchesBranchAndShift(task, branchId, shiftType, date));
  const categories = new Map();
  for (const task of tasks) {
    const category = task.category || 'غير مصنف';
    const row = categories.get(category) || { category, total: 0, done: 0 };
    row.total += 1;
    if ((logs || []).some(log => logMatchesTaskOccurrence(log, task, { branchId, shiftType, date }) && isChecklistComplete(log.status))) row.done += 1;
    categories.set(category, row);
  }
  return [...categories.values()].sort((a, b) => a.category.localeCompare(b.category, 'ar'));
}

/**
 * @param {Array<any>} templates
 * @param {Array<any>} logs
 * @param {any} employee
 * @param {{branchId?: string|null, shiftType?: string|null, date?: Date|string|number, categories?: string[]|null}} [options]
 */
export function buildPendingEmployeeTasks(templates, logs, employee, {
  branchId, shiftType = null, date, categories = null
} = {}) {
  if (!employee || !branchId) return [];
  const employeeShift = employee.shift_type === 'Morning' || employee.shift_type === 'Evening'
    ? [employee.shift_type]
    : SHIFTS;
  const shifts = shiftType ? [shiftType] : employeeShift;
  const assignedCategories = Array.isArray(categories) && categories.length
    ? categories
    : (ROLE_CATEGORY[employee.role] ? [ROLE_CATEGORY[employee.role]] : []);
  const pending = [];
  for (const shift of shifts) {
    for (const task of templates || []) {
      if (!taskMatchesBranchAndShift(task, branchId, shift, date)) continue;
      if (!assignedCategories.includes(task.category)) continue;
      const complete = (logs || []).some(log =>
        logMatchesTaskOccurrence(log, task, { branchId, shiftType: shift, date, executedBy: employee.id }) &&
        isChecklistComplete(log.status)
      );
      if (!complete) pending.push({ task, shiftType: shift });
    }
  }
  return pending;
}

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
