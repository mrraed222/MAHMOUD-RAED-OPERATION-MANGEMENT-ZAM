(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZamChecklistLogMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMPLETED_STATUSES = new Set(['completed', 'done', 'مكتمل', 'منجز']);

  function isCompleted(log) {
    return COMPLETED_STATUSES.has(String(log?.status ?? '').trim().toLowerCase());
  }

  function countCompletedExecutionLogs(logs = [], hourlyLogs = []) {
    return [...(logs || []), ...(hourlyLogs || [])].filter(isCompleted).length;
  }

  return Object.freeze({ isCompleted, countCompletedExecutionLogs });
});
