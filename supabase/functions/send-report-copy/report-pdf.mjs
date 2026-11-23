const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const FONT_FILE = 'ZamArabicSans-Regular.ttf';
const FONT_NAME = 'ZamArabicSans';
const COLORS = {
  ink: [0.12, 0.15, 0.13],
  muted: [0.38, 0.42, 0.39],
  green: [0.08, 0.32, 0.23],
  rule: [0.82, 0.86, 0.83],
};

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return cleanText(value) || '—';
  return number.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function stableCreationDate(value) {
  const date = new Date(value ?? '');
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1970 || year > 2037) return "D:20000101000000+00'00'";
  return `D:${date.toISOString().slice(0, 19).replace(/[-:T]/g, '')}+00'00'`;
}

/** @param {import('./report-types.ts').BuildDailyReportPdfInput} input */
export async function buildDailyReportPdf({
  jsPDF,
  fontBase64,
  report,
  branchName,
  waste = [],
  issues = [],
  reviews = [],
  technicalIssues = [],
}) {
  const reportId = report?.id == null ? null : String(report.id);
  const linkedTechnicalIssues = reportId
    ? (Array.isArray(technicalIssues) ? technicalIssues : []).filter((row) => String(row.report_id) === reportId)
    : [];
  const doc = new jsPDF({
    unit: 'pt',
    format: [PAGE_WIDTH, PAGE_HEIGHT],
    compress: true,
    putOnlyUsedFonts: true,
  });
  const fileId = reportId?.replace(/-/g, '');
  doc.setCreationDate(stableCreationDate(report?.created_at));
  doc.setFileId(/^[a-f0-9]{32}$/i.test(fileId || '') ? fileId : '00000000000000000000000000000000');
  doc.addFileToVFS(FONT_FILE, fontBase64);
  doc.addFont(FONT_FILE, FONT_NAME, 'normal');
  doc.setFont(FONT_NAME, 'normal');

  let y = 0;

  function setTextStyle(size, color) {
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color.map((channel) => Math.round(channel * 255)));
  }

  function measure(logicalText, size) {
    doc.setFontSize(size);
    return doc.getTextWidth(logicalText);
  }

  function drawVisual(logicalText, size, color = COLORS.ink) {
    setTextStyle(size, color);
    doc.text(logicalText, PAGE_WIDTH - MARGIN, y, { align: 'right' });
  }

  function drawPageHeader() {
    doc.setFillColor(...COLORS.green.map((channel) => Math.round(channel * 255)));
    doc.rect(0, 0, PAGE_WIDTH, 13, 'F');
    y = 52;
    drawVisual('تقرير الوردية اليومية', 20, COLORS.green);
    y += 29;
    const shift = report.shift_type === 'Morning' ? 'صباحية' : report.shift_type === 'Evening' ? 'مسائية' : cleanText(report.shift_type);
    drawVisual(`${cleanText(branchName) || 'الفرع'} | ${cleanText(report.report_date) || '—'} | ${shift || '—'}`, 9, COLORS.muted);
    y += 36;
  }

  function addPage() {
    doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageHeader();
  }

  function ensureSpace(height) {
    if (y + height > PAGE_HEIGHT - MARGIN) addPage();
  }

  function splitLongWord(word, size, maxWidth) {
    const lines = [];
    let chunk = '';
    for (const char of word) {
      const next = chunk + char;
      if (chunk && measure(next, size) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else chunk = next;
    }
    if (chunk) lines.push(chunk);
    return lines;
  }

  function wrapText(value, size, maxWidth) {
    const text = cleanText(value) || '—';
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = '';
      if (measure(word, size) <= maxWidth) current = word;
      else {
        const pieces = splitLongWord(word, size, maxWidth);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] || '';
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : ['—'];
  }

  function addWrapped(value, { size = 10, color = COLORS.ink, maxWidth = PAGE_WIDTH - 2 * MARGIN } = {}) {
    for (const line of wrapText(value, size, maxWidth)) {
      const lineHeight = size * 1.55;
      ensureSpace(lineHeight);
      y += lineHeight;
      drawVisual(line, size, color);
    }
  }

  function addSection(title) {
    ensureSpace(42);
    y += 20;
    drawVisual(title, 13, COLORS.green);
    y += 9;
    doc.setDrawColor(...COLORS.rule.map((channel) => Math.round(channel * 255)));
    doc.setLineWidth(0.7);
    doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
    y += 15;
  }

  function addEntry(label, value) {
    addWrapped(`${cleanText(label)}: ${cleanText(value) || '—'}`);
  }

  drawPageHeader();
  addSection('بيانات الوردية');
  addEntry('المشرف', report.supervisor_name);
  addEntry('الفرع', branchName);
  addEntry('التاريخ', report.report_date);
  addEntry('وقت التسجيل', report.entry_time);
  addEntry('الوردية', report.shift_type === 'Morning' ? 'صباحية' : report.shift_type === 'Evening' ? 'مسائية' : report.shift_type);
  addEntry('حالة الفريق', report.team_status);
  addEntry('تاريخ إنشاء التقرير', report.created_at);

  addSection('ملخص المبيعات');
  addEntry('إجمالي المبيعات (ر.س)', amount(report.total_sales));
  addEntry('عدد الطلبات', report.orders_count);
  addEntry('متوسط قيمة الطلب (ر.س)', amount(report.avg_ticket));
  addEntry('التقييمات الإيجابية المسجلة', report.positive_reviews);

  const customFields = report.custom_fields && typeof report.custom_fields === 'object' && !Array.isArray(report.custom_fields)
    ? Object.entries(report.custom_fields).filter(([key]) => key !== 'technical_parent')
    : [];
  if (customFields.length) {
    addSection('حقول التقرير الإضافية');
    for (const [key, value] of customFields) addEntry(key, typeof value === 'object' ? JSON.stringify(value) : value);
  }

  addSection('سجلات الهدر');
  if (!waste.length) addWrapped('لا توجد سجلات هدر.');
  for (const row of waste) {
    addEntry('الصنف', row.item_name);
    addEntry('الكمية', `${row.quantity ?? '—'} ${row.unit || ''}`);
    addEntry('السبب', row.reason);
    addEntry('السبب الجذري', row.root_cause);
    addEntry('الإجراء التصحيحي', row.corrective_action);
    addEntry('المسؤول', row.owner);
    addEntry('تكلفة الوحدة (ر.س)', amount(row.unit_cost));
    addEntry('الوردية', row.shift_type);
    addEntry('وقت التسجيل', row.created_at);
    y += 5;
  }

  addSection('مشكلات الوردية والإجراءات');
  if (!issues.length) addWrapped('لا توجد مشكلات مسجلة.');
  for (const row of issues) {
    addEntry('نوع المشكلة', row.issue_type);
    addEntry('الوصف', row.description);
    addEntry('الأولوية', row.priority);
    addEntry('الإجراء المتخذ', row.action_taken);
    addEntry('وقت التسجيل', row.created_at);
    y += 5;
  }

  addSection('المشاكل التقنية');
  if (!linkedTechnicalIssues.length) addWrapped('لا توجد بلاغات تقنية مرتبطة بهذا التقرير.');
  for (const row of linkedTechnicalIssues) {
    addEntry('العنوان', row.title);
    addEntry('الوصف الأصلي', row.description);
    addEntry('المصدر', row.source === 'fridge' ? 'تلقائي من الثلاجات' : row.source === 'manual' ? 'بلاغ يدوي' : row.source);
    addEntry('الأولوية', row.priority);
    addEntry('الحالة', row.status === 'resolved' ? 'تم الحل' : row.status === 'open' ? 'مفتوح' : row.status);
    addEntry('وقت التسجيل', row.created_at);
    addEntry('وقت الحل', row.resolved_at);
    y += 5;
  }

  addSection('تقييمات العملاء');
  if (!reviews.length) addWrapped('لا توجد تقييمات عملاء مضافة.');
  for (const row of reviews) {
    const kind = row.review_type === 'positive' ? 'إيجابي' : row.review_type === 'negative' ? 'سلبي' : cleanText(row.review_type);
    addEntry('نوع التقييم', kind || 'تقييم');
    addEntry('التعليق', row.comment_text);
    addEntry('الحالة', row.status);
    addEntry('المسؤول', row.owner);
    addEntry('إجراء المعالجة', row.action_taken);
    addEntry('تقييم العميل', row.customer_rating);
    addEntry('تاريخ الإغلاق', row.closed_at);
    addEntry('وقت التسجيل', row.created_at);
    y += 5;
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
