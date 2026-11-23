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
  const shiftLabel = (value) => value === 'Morning' ? 'صباحية' : value === 'Evening' ? 'مسائية' : value === 'Both' ? 'الورديتان' : value;
  const reviewLabel = (value) => value === 'positive' ? 'إيجابي' : value === 'negative' ? 'سلبي' : value;
  const field = (label, value, formatter = valueText) =>
    `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(formatter(value))}</li>`;
  const section = (title, rows, renderRow, error, emptyMessage) => {
    if (error) return `<section class="detail-section"><h3>${escapeHtml(title)}</h3><p class="note" role="status">تعذّر تحميل ${escapeHtml(title)}.</p></section>`;
    if (!rows.length) return `<section class="detail-section"><h3>${escapeHtml(title)} (0)</h3><p class="note">${escapeHtml(emptyMessage)}</p></section>`;
    return `<section class="detail-section"><h3>${escapeHtml(title)} (${rows.length.toLocaleString('ar-SA')})</h3>${rows.map(renderRow).join('')}</section>`;
  };

  function render(report, { branchName = '—', waste = [], issues = [], reviews = [], technicalIssues = [], errors = {} } = {}) {
    const reportId = report?.id == null ? null : String(report.id);
    const linkedTechnicalIssues = reportId
      ? (Array.isArray(technicalIssues) ? technicalIssues : []).filter((row) => String(row.report_id) === reportId)
      : [];
    const metadata = [
      ['الفرع', branchName],
      ['المشرف', report.supervisor_name],
      ['التاريخ', report.report_date],
      ['وقت التسجيل', report.entry_time],
      ['الوردية', shiftLabel(report.shift_type)],
      ['حالة الفريق', report.team_status],
      ['إجمالي المبيعات', report.total_sales, money],
      ['عدد الطلبات', report.orders_count],
      ['متوسط الفاتورة', report.avg_ticket, money],
      ['التقييمات الإيجابية المسجلة', report.positive_reviews],
      ['تاريخ إنشاء التقرير', report.created_at],
    ];
    const metadataHtml = metadata.map(([label, value, formatter]) => field(label, value, formatter)).join('');
    const customFields = report.custom_fields && typeof report.custom_fields === 'object' && !Array.isArray(report.custom_fields)
      ? Object.entries(report.custom_fields).filter(([key]) => key !== 'technical_parent')
      : [];
    const customHtml = customFields.length
      ? `<section class="detail-section"><h3>حقول التقرير الإضافية</h3><ul class="detail-list">${customFields.map(([key, value]) => field(key, value)).join('')}</ul></section>`
      : '';

    const wasteSection = section('سجلات الهدر', waste, (row) => {
      const fields = [
        field('الصنف', row.item_name),
        field('الكمية', row.quantity),
        field('الوحدة', row.unit),
        field('السبب', row.reason),
        field('السبب الجذري', row.root_cause),
        field('الإجراء التصحيحي', row.corrective_action),
        field('المسؤول', row.owner),
        field('تكلفة الوحدة', row.unit_cost, money),
        field('الوردية', shiftLabel(row.shift_type)),
        field('وقت التسجيل', row.created_at),
      ].join('');
      return `<article class="detail-entry"><ul class="detail-list">${fields}</ul></article>`;
    }, errors.waste, 'لا توجد سجلات هدر لهذا التقرير.');

    const issuesSection = section('مشاكل الشفت', issues, (row) => {
      const fields = [
        field('نوع المشكلة', row.issue_type),
        field('الوصف', row.description),
        field('الأولوية', row.priority),
        field('الإجراء المتخذ', row.action_taken),
        field('وقت التسجيل', row.created_at),
      ].join('');
      return `<article class="detail-entry"><ul class="detail-list">${fields}</ul></article>`;
    }, errors.issues, 'لا توجد مشاكل مسجلة لهذا التقرير.');

    const technicalIssuesSection = section('المشاكل التقنية', linkedTechnicalIssues, (row) => {
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
      return `<article class="detail-entry"><ul class="detail-list">${fields}</ul></article>`;
    }, errors.technicalIssues, 'لا توجد بلاغات تقنية مرتبطة بهذا التقرير.');

    const reviewsSection = section('تقييمات العملاء وGoogle Maps', reviews, (row) => {
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
      return `<article class="detail-entry"><ul class="detail-list">${fields}</ul></article>`;
    }, errors.reviews, 'لا توجد تقييمات مرتبطة بهذا التقرير.');

    return `<div class="detail-section"><h3>بيانات التقرير والمبيعات</h3><ul class="detail-list">${metadataHtml}</ul></div>${customHtml}${wasteSection}${issuesSection}${technicalIssuesSection}${reviewsSection}`;
  }

  global.ZamReportDetailRenderer = { render };
})(typeof window !== 'undefined' ? window : globalThis);
