(function (global) {
  'use strict';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const countText = (value) => Number(value).toLocaleString('ar-SA');
  const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return 'غير مسجل';
    const amount = Number(value);
    return Number.isFinite(amount)
      ? `${amount.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
      : 'غير مسجل';
  };
  const formatQuantity = (value) => Number(value).toLocaleString('ar-SA', { maximumFractionDigits: 10 });
  const reportShiftLabel = (value) => value === 'Morning' ? 'صباحية' : value === 'Evening' ? 'مسائية' : 'غير محددة';

  function errorSummary() {
    return { wasteStatus: 'error', wasteByUnit: [], issuesStatus: 'error', shiftIssueCount: null, technicalIssueCount: null };
  }

  function safeCount(value) {
    if (value === null || value === undefined || value === '') return null;
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function summarize(report, payload) {
    const reportId = report?.id == null ? '' : String(report.id);
    if (!reportId || !payload || String(payload.report_id) !== reportId || !Array.isArray(payload.waste_rows)) {
      return errorSummary();
    }

    const renderer = global.ZamReportDetailRenderer;
    if (!renderer || typeof renderer.summarizeWasteForReport !== 'function') return errorSummary();
    const waste = renderer.summarizeWasteForReport(report, payload.waste_rows);

    const shiftIssueCount = safeCount(payload.shift_issue_count);
    const technicalIssueCount = safeCount(payload.technical_issue_count);
    const issuesStatus = shiftIssueCount === null || technicalIssueCount === null ? 'error' : 'ready';
    return {
      wasteStatus: waste.status,
      wasteByUnit: waste.byUnit,
      issuesStatus,
      shiftIssueCount,
      technicalIssueCount,
    };
  }

  function wasteText(summary) {
    if (!summary || summary.wasteStatus !== 'ready') return 'تعذّر تحميل ملخص الهدر';
    if (!summary.wasteByUnit?.length) return 'لا يوجد هدر مطابق لهذا التقرير';
    return summary.wasteByUnit.map(({ unit, quantity }) => `${formatQuantity(quantity)} ${unit}`).join(' · ');
  }

  function issueText(summary) {
    if (!summary || summary.issuesStatus !== 'ready') return 'تعذّر تحميل المشاكل المسجلة';
    if (summary.shiftIssueCount === 0 && summary.technicalIssueCount === 0) return 'لا توجد مشاكل مسجلة';
    return `مشاكل الشفت: ${countText(summary.shiftIssueCount)} · بلاغات تقنية: ${countText(summary.technicalIssueCount)}`;
  }

  function issuesHtml(summary) {
    if (!summary || summary.issuesStatus !== 'ready') {
      return '<span class="summary-error">تعذّر تحميل المشاكل المسجلة</span>';
    }
    if (summary.shiftIssueCount === 0 && summary.technicalIssueCount === 0) {
      return '<span>لا توجد مشاكل مسجلة</span>';
    }
    return `<span>مشاكل الشفت: <strong>${countText(summary.shiftIssueCount)}</strong><br>بلاغات تقنية: <strong>${countText(summary.technicalIssueCount)}</strong></span>`;
  }

  function customerText(report) {
    const positive = report?.positive_reviews ?? report?.custom_fields?.positive_reviews;
    const negative = report?.negative_reviews ?? report?.custom_fields?.negative_reviews;
    if (positive === null && negative === null) return 'لا توجد بيانات تعليقات العملاء';
    const parts = [];
    if (positive !== null && positive !== undefined && positive !== '') parts.push(`إيجابية: ${countText(positive)}`);
    if (negative !== null && negative !== undefined && negative !== '') parts.push(`سلبية: ${countText(negative)}`);
    return parts.length ? parts.join(' · ') : 'لا توجد بيانات تعليقات العملاء';
  }

  function wasteHtml(summary) {
    if (!summary || summary.wasteStatus !== 'ready') {
      return '<span class="summary-error">تعذّر تحميل ملخص الهدر</span>';
    }
    if (!summary.wasteByUnit?.length) return '<span>لا يوجد هدر مطابق لهذا التقرير</span>';
    return `<span>${summary.wasteByUnit.map(({ unit, quantity }) => `${formatQuantity(quantity)} ${escapeHtml(unit)}`).join('<br>')}</span>`;
  }

  function renderDesktopRow(report, summary) {
    const shift = reportShiftLabel(report.shift_type);
    return `<tr><td>${escapeHtml(report.supervisor_name || '—')}</td><td>${escapeHtml(shift)}</td><td>${escapeHtml(report.branches?.name || '—')}</td><td>${escapeHtml(report.report_date || '—')}</td><td class="sales">${escapeHtml(formatMoney(report.avg_ticket))}</td><td class="sales">${escapeHtml(formatMoney(report.total_sales))}</td><td class="report-waste-cell">${wasteHtml(summary)}</td><td class="report-issues-cell">${issuesHtml(summary)}</td><td>${escapeHtml(report.team_status || '—')}</td><td><button class="view-btn" type="button" data-detail="${escapeHtml(report.id)}">عرض التفاصيل</button></td></tr>`;
  }

  function renderMobileCard(report, summary) {
    const shift = reportShiftLabel(report.shift_type);
    return `<article class="report-card"><header class="card-top"><div><strong>${escapeHtml(report.supervisor_name || 'بدون اسم مشرف')}</strong><div class="card-identity"><span>${escapeHtml(report.branches?.name || '—')}</span><span>${escapeHtml(report.report_date || '—')}</span><span>${escapeHtml(shift)}</span></div></div><span class="card-label">تقرير يومي</span></header><div class="card-metrics"><div><span>المبيعات</span><b>${escapeHtml(formatMoney(report.total_sales))}</b></div><div><span>عدد الطلبات</span><b>${escapeHtml(countText(report.orders_count ?? '—'))}</b></div><div><span>متوسط الفاتورة</span><b>${escapeHtml(formatMoney(report.avg_ticket))}</b></div></div><div class="card-sections"><section class="card-section"><span>الهدر</span><b>${wasteHtml(summary)}</b></section><section class="card-section"><span>مشاكل الشفت والبلاغات</span><b>${issuesHtml(summary)}</b></section><section class="card-section"><span>تعليقات العملاء</span><b>${escapeHtml(customerText(report))}</b></section><section class="card-section"><span>حالة الفريق</span><b>${escapeHtml(report.team_status || '—')}</b></section></div><button class="view-btn" type="button" data-detail="${escapeHtml(report.id)}">عرض تفاصيل التقرير</button></article>`;
  }

  global.ZamReportLogSummary = {
    errorSummary,
    issueText,
    renderDesktopRow,
    renderMobileCard,
    summarize,
    wasteText,
  };
})(typeof window !== 'undefined' ? window : globalThis);

