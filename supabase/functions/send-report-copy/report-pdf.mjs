const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEADER_HEIGHT = 96;
const FOOTER_RESERVE = 54;
const FONT_FILE = 'ZamArabicSans-Regular.ttf';
const FONT_NAME = 'ZamArabicSans';
const COLORS = {
  ink: [0.12, 0.15, 0.13],
  muted: [0.38, 0.42, 0.39],
  green: [0.08, 0.32, 0.23],
  greenLight: [0.93, 0.96, 0.94],
  greenBorder: [0.82, 0.88, 0.84],
  rule: [0.84, 0.87, 0.85],
  white: [1, 1, 1],
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

function shiftLabel(value) {
  if (value === 'Morning') return 'صباحية';
  if (value === 'Evening') return 'مسائية';
  return cleanText(value) || '—';
}

/** @param {import('./report-types.ts').BuildDailyReportPdfInput} input */
export async function buildDailyReportPdf({
  jsPDF,
  fontBase64,
  logoDataUri,
  report,
  branchName,
  checklistSummary = null,
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

  let y = HEADER_HEIGHT + 22;

  function setTextStyle(size, color = COLORS.ink) {
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color.map((channel) => Math.round(channel * 255)));
  }

  function measure(text, size) {
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(size);
    return doc.getTextWidth(text);
  }

  function drawAt(text, x, baseline, size, color = COLORS.ink, align = 'right') {
    setTextStyle(size, color);
    doc.text(String(text), x, baseline, { align });
  }

  function roundedBox(x, top, width, height, fill, border = COLORS.greenBorder, radius = 8) {
    doc.setFillColor(...fill.map((channel) => Math.round(channel * 255)));
    doc.setDrawColor(...border.map((channel) => Math.round(channel * 255)));
    if (typeof doc.roundedRect === 'function') doc.roundedRect(x, top, width, height, radius, radius, 'FD');
    else doc.rect(x, top, width, height, 'FD');
  }

  function drawPageHeader() {
    doc.setFillColor(...COLORS.green.map((channel) => Math.round(channel * 255)));
    doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT, 'F');
    if (logoDataUri && typeof doc.addImage === 'function') {
      try {
        if (typeof doc.getImageProperties === 'function') doc.getImageProperties(logoDataUri);
        roundedBox(MARGIN, 17, 48, 62, COLORS.white, COLORS.white, 6);
        doc.addImage(logoDataUri, 'PNG', MARGIN + 3, 19, 42, 58, undefined, 'FAST');
      } catch {
        // The logo is optional; a bad image must not prevent the report PDF from being sent.
      }
    }
    drawAt('ZAM Coffee Operations', PAGE_WIDTH - MARGIN, 37, 9, [0.83, 0.91, 0.86]);
    drawAt('تقرير مشرف الوردية', PAGE_WIDTH - MARGIN, 63, 19, COLORS.white);
    drawAt(`${cleanText(branchName) || 'الفرع'} · ${cleanText(report.report_date) || '—'} · وردية ${shiftLabel(report.shift_type)}`,
      PAGE_WIDTH - MARGIN, 82, 8.5, [0.88, 0.94, 0.9]);
  }

  function addPage() {
    doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageHeader();
    y = HEADER_HEIGHT + 22;
  }

  function ensureSpace(height) {
    if (y + height > PAGE_HEIGHT - FOOTER_RESERVE) addPage();
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
    const lines = [];
    let current = '';
    for (const word of text.split(' ')) {
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
        current = pieces.at(-1) || '';
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : ['—'];
  }

  function addWrapped(value, { size = 9.5, color = COLORS.ink, maxWidth = CONTENT_WIDTH, indent = 0 } = {}) {
    const lines = wrapText(value, size, maxWidth);
    const lineHeight = size * 1.58;
    for (const line of lines) {
      ensureSpace(lineHeight + 2);
      y += lineHeight;
      drawAt(line, PAGE_WIDTH - MARGIN - indent, y, size, color);
    }
    return lines.length;
  }

  function addSection(title) {
    ensureSpace(38);
    y += 8;
    drawAt(title, PAGE_WIDTH - MARGIN, y, 12, COLORS.green);
    y += 9;
    doc.setDrawColor(...COLORS.rule.map((channel) => Math.round(channel * 255)));
    doc.setLineWidth(0.7);
    doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
    y += 14;
  }

  function drawMetadataCard(label, value, x, top, width, height) {
    roundedBox(x, top, width, height, COLORS.white, COLORS.greenBorder, 7);
    drawAt(label, x + width - 10, top + 16, 7.5, COLORS.muted);
    const lines = wrapText(cleanText(value) || '—', 9.5, width - 20).slice(0, 2);
    lines.forEach((line, index) => drawAt(line, x + width - 10, top + 34 + index * 12, 9.5, COLORS.ink));
  }

  function drawMetadata() {
    const gap = 9;
    const width = (CONTENT_WIDTH - gap) / 2;
    const height = 47;
    const firstRow = y;
    const rightX = MARGIN + width + gap;
    drawMetadataCard('الفرع', branchName, rightX, firstRow, width, height);
    drawMetadataCard('الوردية', shiftLabel(report.shift_type), MARGIN, firstRow, width, height);
    const secondRow = firstRow + height + 8;
    drawMetadataCard('المشرف', report.supervisor_name, rightX, secondRow, width, height);
    drawMetadataCard('التاريخ', report.report_date, MARGIN, secondRow, width, height);
    y = secondRow + height + 9;
  }

  function drawSalesCards() {
    const gap = 10;
    const width = (CONTENT_WIDTH - gap) / 2;
    const height = 61;
    const rightX = MARGIN + width + gap;
    const top = y;
    const cards = [
      { x: rightX, label: 'إجمالي المبيعات', value: `${amount(report.total_sales)} ر.س` },
      { x: MARGIN, label: 'متوسط الفاتورة', value: `${amount(report.avg_ticket)} ر.س` },
    ];
    for (const card of cards) {
      roundedBox(card.x, top, width, height, COLORS.greenLight, COLORS.greenBorder, 8);
      drawAt(card.label, card.x + width - 12, top + 20, 8, COLORS.muted);
      drawAt(card.value, card.x + width - 12, top + 45, 15, COLORS.green);
    }
    y = top + height + 7;
  }

  function drawWasteHeader() {
    const right = PAGE_WIDTH - MARGIN;
    const itemWidth = CONTENT_WIDTH * 0.27;
    const quantityWidth = CONTENT_WIDTH * 0.2;
    const reasonWidth = CONTENT_WIDTH - itemWidth - quantityWidth;
    const top = y;
    doc.setFillColor(...COLORS.greenLight.map((channel) => Math.round(channel * 255)));
    doc.rect(MARGIN, top, CONTENT_WIDTH, 24, 'F');
    drawAt('الصنف', right - 9, top + 16, 8, COLORS.green);
    drawAt('الكمية', right - itemWidth - 9, top + 16, 8, COLORS.green);
    drawAt('السبب والتفصيل', MARGIN + reasonWidth - 9, top + 16, 8, COLORS.green);
    y = top + 24;
    return { itemWidth, quantityWidth, reasonWidth };
  }

  function drawWasteTable(rows) {
    if (!rows.length) {
      addWrapped('لا توجد سجلات هدر لهذا التقرير.', { color: COLORS.muted });
      return;
    }
    const columns = drawWasteHeader();
    const lineHeight = 12;
    const right = PAGE_WIDTH - MARGIN;
    const itemX = right - 8;
    const quantityX = right - columns.itemWidth - columns.quantityWidth / 2;
    const reasonX = MARGIN + columns.reasonWidth - 8;
    for (const row of rows) {
      const item = cleanText(row.item_name) || '—';
      const quantity = `${row.quantity ?? '—'} ${cleanText(row.unit)}`.trim();
      const reason = [row.reason, row.root_cause, row.corrective_action].map(cleanText).filter(Boolean).join(' · ') || '—';
      const itemLines = wrapText(item, 8.5, columns.itemWidth - 16);
      const quantityLines = wrapText(quantity, 8.5, columns.quantityWidth - 12);
      const reasonLines = wrapText(reason, 8.5, columns.reasonWidth - 16);
      const lineCount = Math.max(itemLines.length, quantityLines.length, reasonLines.length);
      let offset = 0;
      while (offset < lineCount) {
        let available = Math.floor((PAGE_HEIGHT - FOOTER_RESERVE - y - 12) / lineHeight);
        if (available < 1) {
          addPage();
          drawWasteHeader();
          available = Math.floor((PAGE_HEIGHT - FOOTER_RESERVE - y - 12) / lineHeight);
        }
        const take = Math.min(lineCount - offset, Math.max(1, available));
        const top = y;
        for (let index = 0; index < take; index += 1) {
          const lineTop = top + 9 + index * lineHeight;
          if (itemLines[offset + index]) drawAt(itemLines[offset + index], itemX, lineTop, 8.5, COLORS.ink);
          if (quantityLines[offset + index]) drawAt(quantityLines[offset + index], quantityX, lineTop, 8.5, COLORS.ink, 'center');
          if (reasonLines[offset + index]) drawAt(reasonLines[offset + index], reasonX, lineTop, 8.5, COLORS.ink);
        }
        y += take * lineHeight + 7;
        doc.setDrawColor(...COLORS.rule.map((channel) => Math.round(channel * 255)));
        doc.line(MARGIN, y, right, y);
        y += 5;
        offset += take;
        if (offset < lineCount) {
          addPage();
          drawWasteHeader();
        }
      }
    }
    y += 2;
  }

  function drawChecklistCards() {
    if (!checklistSummary) {
      addWrapped('لا يتوفر ملخص مطابق لبيانات الفرع والوردية.', { color: COLORS.muted });
      return;
    }
    const gap = 10;
    const width = (CONTENT_WIDTH - gap) / 2;
    const height = 73;
    const rightX = MARGIN + width + gap;
    const top = y;
    const cards = [
      {
        x: rightX,
        title: 'المهام غير الساعية',
        primary: `${amount(checklistSummary.nonHourly.completed)} من ${amount(checklistSummary.nonHourly.scheduled)} منفذة`,
        secondary: `غير منفذة: ${amount(checklistSummary.nonHourly.incomplete)}`,
      },
      {
        x: MARGIN,
        title: 'المهام الساعية المسجلة',
        primary: `منفذة: ${amount(checklistSummary.hourly.completed)}`,
        secondary: `غير منفذة: ${amount(checklistSummary.hourly.notPerformed)}`,
      },
    ];
    for (const card of cards) {
      roundedBox(card.x, top, width, height, COLORS.greenLight, COLORS.greenBorder, 8);
      drawAt(card.title, card.x + width - 11, top + 18, 8, COLORS.muted);
      drawAt(card.primary, card.x + width - 11, top + 42, 11, COLORS.green);
      drawAt(card.secondary, card.x + width - 11, top + 60, 8.5, COLORS.ink);
    }
    y = top + height + 5;
  }

  function drawProblemEntry(title, description, details = '') {
    ensureSpace(28);
    y += 2;
    drawAt(title, PAGE_WIDTH - MARGIN, y + 10, 9, COLORS.green);
    y += 14;
    if (description) addWrapped(description, { size: 9, color: COLORS.ink, indent: 4 });
    if (details) addWrapped(details, { size: 8, color: COLORS.muted, indent: 4 });
    y += 5;
  }

  function drawProblems() {
    const entries = [];
    for (const row of issues) {
      entries.push({
        title: cleanText(row.issue_type) || 'مشكلة في الوردية',
        description: row.description,
        details: [row.priority ? `الأولوية: ${row.priority}` : '', row.action_taken ? `الإجراء: ${row.action_taken}` : ''].filter(Boolean).join(' · '),
      });
    }
    for (const row of linkedTechnicalIssues) {
      entries.push({
        title: cleanText(row.title) || 'مشكلة تقنية',
        description: row.description,
        details: [row.priority ? `الأولوية: ${row.priority}` : '', row.status ? `الحالة: ${row.status === 'resolved' ? 'تم الحل' : row.status === 'open' ? 'مفتوح' : row.status}` : ''].filter(Boolean).join(' · '),
      });
    }
    for (const row of reviews) {
      if (row.review_type && row.review_type !== 'negative') continue;
      entries.push({
        title: 'شكوى عميل',
        description: row.comment_text,
        details: [row.status ? `الحالة: ${row.status}` : '', row.action_taken ? `الإجراء: ${row.action_taken}` : ''].filter(Boolean).join(' · '),
      });
    }
    if (!entries.length) {
      addWrapped('لا توجد مشاكل أو شكاوى مسجلة لهذا التقرير.', { color: COLORS.muted });
      return;
    }
    entries.forEach((entry) => drawProblemEntry(entry.title, entry.description, entry.details));
  }

  drawPageHeader();
  drawMetadata();
  addSection('المبيعات');
  drawSalesCards();
  addSection('ملخص الهدر');
  drawWasteTable(Array.isArray(waste) ? waste : []);
  addSection('ملخص التشيك ليست');
  drawChecklistCards();
  addSection('المشاكل والشكاوى');
  drawProblems();

  const pageCount = typeof doc.internal?.getNumberOfPages === 'function' ? doc.internal.getNumberOfPages() : 1;
  if (typeof doc.setPage === 'function') {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      doc.setPage(pageNumber);
      const footerY = PAGE_HEIGHT - 19;
      doc.setDrawColor(...COLORS.rule.map((channel) => Math.round(channel * 255)));
      doc.setLineWidth(0.6);
      doc.line(MARGIN, PAGE_HEIGHT - 34, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 34);
      drawAt(`ZAM Coffee Operations · ${pageNumber} / ${pageCount}`, PAGE_WIDTH - MARGIN, footerY, 7, COLORS.muted);
    }
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
