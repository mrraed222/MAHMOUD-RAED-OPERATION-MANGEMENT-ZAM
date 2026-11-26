(function (global) {
  'use strict';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const valueText = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return '[قيمة غير قابلة للعرض]'; }
    }
    return String(value);
  };
  const money = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? `${amount.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
      : '—';
  };
  const reportDate = (value) => {
    const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return valueText(value);
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`);
    return Number.isNaN(date.getTime()) ? valueText(value) : date.toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const dateTime = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? valueText(value) : date.toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const shiftLabel = (value) => value === 'Morning' ? 'صباحية' : value === 'Evening' ? 'مسائية' : value === 'Both' ? 'الورديتان' : value;
  const normalizeShift = (value) => {
    const shift = String(value ?? '').trim().toLowerCase();
    if (shift === 'morning' || /صباح/.test(shift)) return 'Morning';
    if (shift === 'evening' || /مسائ|ليلي/.test(shift)) return 'Evening';
    return '';
  };
  const field = (label, value, formatter = valueText) =>
    `<div class="detail-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatter(value))}</dd></div>`;
  const section = (title, content) =>
    `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${content}</section>`;
  const detailRows = (title, rows, renderRow, error, emptyMessage) => {
    if (error) return section(title, `<p class="note" role="status">تعذّر تحميل ${escapeHtml(title)}.</p>`);
    if (!rows.length) return section(title, `<p class="note">${escapeHtml(emptyMessage)}</p>`);
    const count = rows.length.toLocaleString('ar-SA');
    return section(`${title} (${count})`, rows.map(renderRow).join(''));
  };
  const reportSheetKey = (report) => {
    const key = report?.sheet_key || report?.custom_fields?.sheet_key;
    return typeof key === 'string' && key.trim() ? key.trim() : '';
  };
  const wasteParentSheetKey = (row) => {
    const key = typeof row?.sheet_key === 'string' ? row.sheet_key : '';
    const marker = key.indexOf('|W|');
    return marker < 0 ? '' : key.slice(0, marker);
  };

  function filterWasteForReport(report, rows = []) {
    const parentKey = reportSheetKey(report);
    const reportShift = normalizeShift(report?.shift_type);
    const importedReport = !!(report?.custom_fields?.sheet_row != null || parentKey.includes('|'));
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const rowKey = typeof row?.sheet_key === 'string' ? row.sheet_key.trim() : '';
      const childParentKey = wasteParentSheetKey(row);
      if (childParentKey) {
        if (parentKey) return childParentKey === parentKey;
        // A child key encodes branch/date/shift in its parent prefix; without
        // the report key that full historical association cannot be verified.
        return false;
      }
      // A present but malformed/unmatched imported key is not legacy data.
      // Never weaken it to a shift-only match.
      if (rowKey && importedReport) return false;
      const childShift = normalizeShift(row?.shift_type);
      if (childShift) return childShift === reportShift;
      // For migrated sheet reports, do not guess when old rows lack verifiable shift metadata.
      return !importedReport;
    });
  }

  function summarizeWasteForReport(report, rows = []) {
    const reportId = report?.id == null ? '' : String(report.id);
    if (!reportId || !Array.isArray(rows)) return { status: 'error', byUnit: [] };
    const totals = new Map();
    for (const row of filterWasteForReport(report, rows)) {
      if (String(row?.report_id) !== reportId) continue;
      if (typeof row.unit !== 'string' || row.unit.length === 0 || row.quantity === null || row.quantity === undefined || row.quantity === '') {
        return { status: 'error', byUnit: [] };
      }
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity)) return { status: 'error', byUnit: [] };
      const total = (totals.get(row.unit) || 0) + quantity;
      if (!Number.isFinite(total)) return { status: 'error', byUnit: [] };
      totals.set(row.unit, total);
    }
    return {
      status: 'ready',
      byUnit: Array.from(totals, ([unit, quantity]) => ({ unit, quantity }))
        .sort((left, right) => left.unit.localeCompare(right.unit)),
    };
  }

  function render(report, { branchName = '—', waste = [], issues = [], reviews = [], technicalIssues = [], errors = {} } = {}) {
    const reportId = report?.id == null ? null : String(report.id);
    const linkedTechnicalIssues = reportId
      ? (Array.isArray(technicalIssues) ? technicalIssues : []).filter((row) => String(row.report_id) === reportId)
      : [];
    const customFields = report.custom_fields && typeof report.custom_fields === 'object' && !Array.isArray(report.custom_fields)
      ? Object.entries(report.custom_fields).filter(([key]) => !['technical_parent', 'sheet_key', 'sheet_row', 'entry_time'].includes(key))
      : [];
    const metrics = [
      ['إجمالي المبيعات', report.total_sales, money],
      ['عدد الطلبات', report.orders_count, valueText],
      ['متوسط الفاتورة', report.avg_ticket, money],
    ];
    const metricsHtml = metrics.map(([label, value, formatter]) =>
      `<article class="detail-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatter(value))}</strong></article>`
    ).join('');
    const metadata = [
      ['الفرع', branchName],
      ['المشرف', report.supervisor_name],
      ['التاريخ', report.report_date, reportDate],
      ['وقت التسجيل', report.entry_time || report.custom_fields?.entry_time],
      ['الوردية', shiftLabel(report.shift_type)],
      ['حالة الفريق', report.team_status],
      ['التقييمات الإيجابية المسجلة', report.positive_reviews],
      ['تاريخ إنشاء التقرير', report.created_at, dateTime],
    ];
    const headerIdentityHtml = [
      ['الفرع', branchName],
      ['التاريخ', report.report_date, reportDate],
      ['الوردية', shiftLabel(report.shift_type)],
      ['المشرف', report.supervisor_name],
    ].map(([label, value, formatter]) => `<span><b>${escapeHtml(label)}</b>${escapeHtml((formatter || valueText)(value))}</span>`).join('');
    const metadataHtml = [metadata[3], metadata[5], metadata[6], metadata[7]]
      .map(([label, value, formatter]) => field(label, value, formatter)).join('');
    const customHtml = customFields.length
      ? section('حقول التقرير الإضافية', `<dl class="detail-facts">${customFields.map(([key, value]) => field(key, value)).join('')}</dl>`)
      : '';
    const wasteTotals = errors.waste ? { status: 'error', byUnit: [] } : summarizeWasteForReport(report, waste);
    const wasteSummary = wasteTotals.status !== 'ready'
      ? 'تعذّر التحقق من ملخص الهدر المرتبط بهذا التقرير.'
      : wasteTotals.byUnit.length
        ? wasteTotals.byUnit.map(({ unit, quantity }) => `${Number(quantity).toLocaleString('ar-SA', { maximumFractionDigits: 10 })} ${unit}`).join(' · ')
        : 'لا توجد كميات هدر مطابقة لهذا التقرير.';
    const wasteSection = section('ملخص الهدر بالكميات حسب الوحدة', `<p class="safe-waste-summary" role="status"><span class="sr-only">عدد السجلات المرتبطة بهذا التقرير</span>${escapeHtml(wasteSummary)}</p>`);
    const issuesSection = detailRows('مشاكل الشفت', issues, (row) => {
      const fields = [
        field('نوع المشكلة', row.issue_type),
        field('الوصف', row.description),
        field('الأولوية', row.priority),
        field('الإجراء المتخذ', row.action_taken),
        field('وقت التسجيل', row.created_at),
      ].join('');
      return `<article class="detail-entry"><dl class="detail-facts">${fields}</dl></article>`;
    }, errors.issues, 'لا توجد مشاكل مسجلة لهذا التقرير.');
    const technicalIssuesSection = detailRows('المشاكل التقنية', linkedTechnicalIssues, (row) => {
      const fields = [
        field('العنوان', row.title),
        field('الوصف الأصلي', row.description),
        field('المصدر', row.source === 'fridge' ? 'تلقائي من الثلاجات' : row.source === 'manual' ? 'بلاغ يدوي' : row.source),
        field('الأولوية', row.priority),
        field('الحالة', row.status === 'resolved' ? 'تم الحل' : row.status === 'open' ? 'مفتوح' : row.status),
        field('وقت التسجيل', row.created_at),
        field('وقت الحل', row.resolved_at),
        field('تعليق المتابعة', row.internal_comment),
      ].join('');
      return `<article class="detail-entry"><dl class="detail-facts">${fields}</dl></article>`;
    }, errors.technicalIssues, 'لا توجد بلاغات تقنية مرتبطة بهذا التقرير.');
    const reviewLabel = (value) => value === 'positive' ? 'إيجابي' : value === 'negative' ? 'سلبي' : value;
    const reviewsSection = detailRows('تقييمات العملاء وGoogle Maps', reviews, (row) => {
      const fields = [
        field('نوع التقييم', reviewLabel(row.review_type)),
        field('التعليق', row.comment_text),
        field('الحالة', row.status),
        field('المسؤول', row.owner),
        field('إجراء المعالجة', row.action_taken),
        field('تقييم العميل', row.customer_rating),
        field('تاريخ الإغلاق', row.closed_at),
        field('وقت التسجيل', row.created_at),
      ].join('');
      return `<article class="detail-entry"><dl class="detail-facts">${fields}</dl></article>`;
    }, errors.reviews, 'لا توجد تقييمات مرتبطة بهذا التقرير.');

    return `<div class="report-detail"><section class="detail-hero"><div><span class="detail-kicker">ZAM Operations · التقرير اليومي</span><h3>تقرير أداء الوردية</h3><div class="detail-identity">${headerIdentityHtml}</div></div></section><section class="detail-section detail-overview"><h3>مؤشرات التقرير</h3><div class="detail-metrics">${metricsHtml}</div></section><section class="detail-section detail-operational"><h3>بيانات التشغيل</h3><dl class="detail-facts detail-facts-compact">${metadataHtml}</dl></section>${customHtml}${wasteSection}${issuesSection}${technicalIssuesSection}${reviewsSection}</div>`;
  }

  global.ZamReportDetailRenderer = { render, filterWasteForReport, summarizeWasteForReport };
})(typeof window !== 'undefined' ? window : globalThis);

