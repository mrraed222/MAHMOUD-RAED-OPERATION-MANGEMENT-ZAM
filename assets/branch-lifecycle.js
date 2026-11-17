(function (root) {
  'use strict';

  function riyadhDateString(value = new Date()) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function isOperational(branch, asOf = new Date()) {
    if (!branch || typeof branch !== 'object') return false;
    const status = branch.lifecycle_status;
    // Existing branches stay on their pre-migration behavior until the owner classifies them.
    if (status == null || status === '') return true;
    if (status === 'operational') return true;
    if (status !== 'planned') return false;
    const startDate = String(branch.planned_opening_date || '').slice(0, 10);
    const currentDate = riyadhDateString(asOf);
    return /^\d{4}-\d{2}-\d{2}$/.test(startDate) && !!currentDate && startDate <= currentDate;
  }

  function label(branch, asOf = new Date()) {
    if (!branch || typeof branch !== 'object') return 'غير معروف';
    const status = branch.lifecycle_status;
    if (status == null || status === '') return 'حالة غير مصنفة — السلوك الحالي';
    if (status === 'operational') return 'نشط';
    if (status === 'planned') {
      const startDate = String(branch.planned_opening_date || '').slice(0, 10);
      if (isOperational(branch, asOf)) return `نشط تلقائيًا منذ ${startDate}`;
      return startDate ? `غير نشط — يبدأ ${startDate}` : 'غير نشط — بلا تاريخ افتتاح';
    }
    return 'غير نشط';
  }

  const api = Object.freeze({ riyadhDateString, isOperational, label });
  root.ZamBranchLifecycle = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
