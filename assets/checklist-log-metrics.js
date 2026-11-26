(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZamChecklistLogMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMPLETED_STATUSES = new Set(['completed', 'done', 'مكتمل', 'منجز']);
  const NOT_PERFORMED_STATUSES = new Set(['notperformed', 'not_performed', 'not-performed', 'missed', 'غير منفذة', 'غير منفذ']);
  const SHIFTS = ['Morning', 'Evening'];

  function normalizedStatus(log) {
    return String(log?.status ?? '').trim().toLowerCase();
  }

  function isCompleted(log) {
    return COMPLETED_STATUSES.has(normalizedStatus(log));
  }

  function isNotPerformed(log) {
    return NOT_PERFORMED_STATUSES.has(normalizedStatus(log));
  }

  function normalizeShift(log) {
    const shift = String(log?.shift_type ?? log?.checklist_templates?.shift_type ?? '').trim();
    if (shift === 'Morning' || shift === 'صباحي' || shift === 'الصباحية') return 'Morning';
    if (shift === 'Evening' || shift === 'مسائي' || shift === 'المسائية') return 'Evening';
    return null;
  }

  function summarizeExecutionCounts(logs = [], hourlyLogs = [], branches = []) {
    const rows = new Map();
    const keyFor = (branchId, shift) => `${String(branchId)}\u0000${shift}`;
    const ensureRow = (branchId, shift, branchName = '') => {
      if (branchId == null || !SHIFTS.includes(shift)) return null;
      const key = keyFor(branchId, shift);
      if (!rows.has(key)) rows.set(key, {
        branchId: String(branchId), branchName: String(branchName || 'فرع غير معروف'),
        shiftType: shift, completed: 0, notPerformed: 0,
      });
      const row = rows.get(key);
      if (branchName) row.branchName = String(branchName);
      return row;
    };

    (branches || []).forEach(branch => {
      if (branch?.id == null) return;
      SHIFTS.forEach(shift => ensureRow(branch.id, shift, branch.name));
    });

    [...(logs || []), ...(hourlyLogs || [])].forEach(log => {
      const shift = normalizeShift(log);
      const branchId = log?.branch_id ?? log?.branches?.id;
      const branchName = log?.branches?.name || log?.branch_name || '';
      const row = ensureRow(branchId, shift, branchName);
      if (!row) return;
      if (isCompleted(log)) row.completed += 1;
      else if (isNotPerformed(log)) row.notPerformed += 1;
    });

    return [...rows.values()].sort((a, b) =>
      a.branchName.localeCompare(b.branchName, 'ar') || SHIFTS.indexOf(a.shiftType) - SHIFTS.indexOf(b.shiftType));
  }

  function summarizeHourlyExecutionCounts(hourlyLogs = [], branches = []) {
    const rows = new Map();
    const ensureBranch = (branchId, branchName = '') => {
      if (branchId == null) return null;
      const key = String(branchId);
      if (!rows.has(key)) rows.set(key, {
        branchId: key,
        branchName: String(branchName || 'فرع غير معروف'),
        shifts: {
          Morning: { completed: 0, notPerformed: 0 },
          Evening: { completed: 0, notPerformed: 0 },
        },
      });
      const row = rows.get(key);
      if (branchName) row.branchName = String(branchName);
      return row;
    };

    (branches || []).forEach(branch => {
      if (branch?.id != null) ensureBranch(branch.id, branch.name);
    });

    (hourlyLogs || []).forEach(log => {
      const shift = normalizeShift(log);
      const branchName = String(log?.branches?.name ?? log?.branch_name ?? '').trim();
      if (shift === 'Morning' && branchName === 'تجربة زام') return;
      const branchId = log?.branch_id ?? log?.branches?.id;
      const row = branchId == null ? null : rows.get(String(branchId));
      if (!row || !SHIFTS.includes(shift)) return;
      if (log?.branches?.name || log?.branch_name) row.branchName = String(log.branches?.name || log.branch_name);
      if (isCompleted(log)) row.shifts[shift].completed += 1;
      else if (isNotPerformed(log)) row.shifts[shift].notPerformed += 1;
    });

    return [...rows.values()].sort((a, b) => a.branchName.localeCompare(b.branchName, 'ar'));
  }

  function countCompletedExecutionLogs(logs = [], hourlyLogs = []) {
    return [...(logs || []), ...(hourlyLogs || [])].filter(isCompleted).length;
  }

  return Object.freeze({
    isCompleted,
    isNotPerformed,
    normalizeShift,
    summarizeExecutionCounts,
    summarizeHourlyExecutionCounts,
    countCompletedExecutionLogs,
  });
});
