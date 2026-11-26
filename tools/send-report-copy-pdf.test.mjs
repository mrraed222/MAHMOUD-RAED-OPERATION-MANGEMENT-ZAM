import assert from 'node:assert/strict';
import { buildDailyReportPdf } from '../supabase/functions/send-report-copy/report-pdf.mjs';

const drawn = [];
const pages = [];
const embeddedFiles = [];
const registeredFonts = [];
const embeddedImages = [];
const measured = [];
const fontState = { size: 12 };
const pdfMetadata = { creationDate: null, fileId: null };

class FakeJsPdf {
  constructor(options) {
    this.options = options;
    this.pageCount = 1;
    this.page = { number: this.pageCount };
    this.internal = { getNumberOfPages: () => this.pageCount };
    pages.push(this.page);
  }

  addFileToVFS(filename, base64) { embeddedFiles.push({ filename, base64 }); }
  addFont(filename, fontName, style) { registeredFonts.push({ filename, fontName, style }); }
  setCreationDate(value) { pdfMetadata.creationDate = value; }
  setFileId(value) { pdfMetadata.fileId = value; }
  setFont() {}
  setFontSize(size) { fontState.size = size; }
  setTextColor() {}
  setFillColor() {}
  rect() {}
  roundedRect() {}
  addImage(...args) { embeddedImages.push(args); }
  addPage() { this.pageCount += 1; this.page = { number: this.pageCount }; pages.push(this.page); }
  setPage(number) { this.page = { number }; }
  getTextWidth(text) { measured.push(String(text)); return [...String(text)].length * fontState.size * 0.52; }
  text(text, x, y, options) { drawn.push({ text, x, y, options, page: this.page.number }); }
  setDrawColor() {}
  setLineWidth() {}
  line() {}
  output(type) {
    assert.equal(type, 'arraybuffer');
    return new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]).buffer;
  }
}

const fontBase64 = 'VEVTVF9GT05UX0JBU0U2NA==';
const logoDataUri = 'data:image/png;base64,VGVzdExvZ28=';
const longIssue = 'تأخر صيانة الثلاجة '.repeat(400) + 'App A refrigerator maintenance';
const longReview = `${'x'.repeat(1000)}MARKER_AFTER_900 ${'y'.repeat(12000)}MARKER_AFTER_12000`;
const pdfBytes = await buildDailyReportPdf({
  jsPDF: FakeJsPdf,
  fontBase64,
  logoDataUri,
  report: {
    id: '30000000-0000-4000-8000-000000000001',
    created_at: '2026-11-22T20:30:00.000Z',
    supervisor_name: 'محمود شريف',
    report_date: '2026-11-22',
    shift_type: 'Evening',
    total_sales: 1234.5,
    orders_count: 15,
    avg_ticket: 82.3,
    team_status: 'مكتمل',
    positive_reviews: 3,
    custom_fields: { 'ملاحظة إضافية': 'متابعة طلبات App A' },
  },
  branchName: 'زام الرئيسي',
  checklistSummary: {
    nonHourly: { scheduled: 36, completed: 30, incomplete: 6 },
    hourly: { completed: 12, notPerformed: 2 },
  },
  waste: [{ item_name: 'قهوة', quantity: 0.5, unit: 'كجم', reason: 'تالف' }],
  issues: [{ description: longIssue, priority: 'عالية', action_taken: 'تم فتح بلاغ' }],
  reviews: [{ review_type: 'negative', comment_text: longReview }],
  technicalIssues: [
    { id: 'issue-1', report_id: '30000000-0000-4000-8000-000000000001', title: 'عطل الشاشة', description: 'تحتاج إلى صيانة', source: 'manual', priority: 'high', status: 'open', created_at: 'وقت البلاغ', resolved_at: null },
    { id: 'issue-historical', report_id: null, title: 'بلاغ تاريخي يجب استبعاده', description: 'غير مرتبط' },
    { id: 'issue-other-report', report_id: '30000000-0000-4000-8000-000000000002', title: 'بلاغ تقرير آخر يجب استبعاده', description: 'رابط مختلف' },
  ],
});

assert.equal(Buffer.from(pdfBytes).subarray(0, 5).toString('ascii'), '%PDF-', 'builder should return serialized PDF bytes');
assert.ok(pages.length > 1, 'long report details should paginate');
assert.equal(pdfMetadata.creationDate, "D:20261122203000+00'00'", 'PDF metadata should reuse the saved report creation time');
assert.equal(pdfMetadata.fileId, '30000000000040008000000000000001', 'PDF ID should derive deterministically from the saved report ID');
assert.deepEqual(embeddedFiles, [{ filename: 'ZamArabicSans-Regular.ttf', base64: fontBase64 }], 'the unified Arabic/Latin TTF should be embedded once');
assert.deepEqual(registeredFonts, [{ filename: 'ZamArabicSans-Regular.ttf', fontName: 'ZamArabicSans', style: 'normal' }]);
assert.equal(embeddedImages.length, pages.length, 'the ZAM logo should be embedded in the header of every PDF page');
assert.ok(embeddedImages.every(image => image[0] === logoDataUri));
assert.ok(measured.length > 5, 'text width should be measured for line wrapping');
assert.ok(measured.includes('تأخر صيانة الثلاجة'), 'Arabic issue text should be measured for line wrapping');
assert.ok(drawn.some(item => item.text === 'تقرير مشرف الوردية'), 'the report title should be drawn in the document');
assert.ok(drawn.length > 10 && drawn.every(item => ['right', 'center'].includes(item.options.align)), 'report text should be consistently aligned');
const outputText = drawn.map(item => item.text).join(' ');
for (const expected of [
  'ZAM Coffee Operations', 'تقرير مشرف الوردية', 'محمود شريف', 'زام الرئيسي',
  'إجمالي المبيعات', 'متوسط الفاتورة', 'ملخص الهدر', 'قهوة',
  'ملخص التشيك ليست', '36', 'المشاكل والشكاوى', 'تأخر صيانة الثلاجة',
  'MARKER_AFTER_900', 'MARKER_AFTER_12000', 'App A', 'عطل الشاشة',
]) {
  assert.ok(outputText.includes(expected), `PDF should include ${expected}`);
}
const ordered = ['إجمالي المبيعات', 'متوسط الفاتورة', 'ملخص الهدر', 'ملخص التشيك ليست', 'المشاكل والشكاوى']
  .map(marker => outputText.indexOf(marker));
assert.ok(ordered.every((position, index) => position >= 0 && (index === 0 || position > ordered[index - 1])), 'required PDF content should appear in the requested order');
assert.ok(!outputText.includes('ملاحظة إضافية'), 'PDF should not include custom fields not requested for the report');
assert.ok(!outputText.includes('حالة الفريق'), 'PDF should not include extra team-status data');
assert.ok(!outputText.includes('INTERNAL_COMMENT_SECRET_MARKER'), 'PDF must never expose a technical-issue internal comment');
assert.ok(!outputText.includes('بلاغ تاريخي يجب استبعاده'), 'the PDF must exclude unlinked historical technical issues');
assert.ok(!outputText.includes('بلاغ تقرير آخر يجب استبعاده'), 'the PDF must exclude issues linked to another report');
console.log('send-report-copy PDF builder tests: passed (jsPDF mocks; no email sent)');
