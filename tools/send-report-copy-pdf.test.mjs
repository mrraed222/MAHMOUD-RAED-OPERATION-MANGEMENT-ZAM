import assert from 'node:assert/strict';
import { buildDailyReportPdf } from '../supabase/functions/send-report-copy/report-pdf.mjs';

const drawn = [];
const pages = [];
const embeddedFiles = [];
const registeredFonts = [];
const measured = [];
const fontState = { size: 12 };
const pdfMetadata = { creationDate: null, fileId: null };

class FakeJsPdf {
  constructor(options) {
    this.options = options;
    this.page = this.makePage();
    pages.push(this.page);
  }

  makePage() { return { number: pages.length + 1 }; }
  addFileToVFS(filename, base64) { embeddedFiles.push({ filename, base64 }); }
  addFont(filename, fontName, style) { registeredFonts.push({ filename, fontName, style }); }
  setCreationDate(value) { pdfMetadata.creationDate = value; }
  setFileId(value) { pdfMetadata.fileId = value; }
  setFont() {}
  setFontSize(size) { fontState.size = size; }
  setTextColor() {}
  setFillColor() {}
  rect() {}
  addPage() { this.page = this.makePage(); pages.push(this.page); }
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
const longIssue = 'تأخر صيانة الثلاجة '.repeat(400) + 'App A refrigerator maintenance';
const longReview = `${'x'.repeat(1000)}MARKER_AFTER_900 ${'y'.repeat(12000)}MARKER_AFTER_12000`;
const pdfBytes = await buildDailyReportPdf({
  jsPDF: FakeJsPdf,
  fontBase64,
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
    custom_fields: { 'ملاحظة إضافية': 'متابعة الطلبات عبر App A' },
  },
  branchName: 'زام الرئيسي',
  waste: [{ item_name: 'قهوة', quantity: 0.5, unit: 'كجم', reason: 'تالف' }],
  issues: [{ description: longIssue, priority: 'عالية', action_taken: 'تم فتح بلاغ' }],
  reviews: [{ review_type: 'negative', comment_text: longReview }],
  technicalIssues: [
    { id: 'issue-1', report_id: '30000000-0000-4000-8000-000000000001', title: 'عطل الشاشة', description: 'تحتاج إلى صيانة', source: 'manual', priority: 'high', status: 'open', created_at: 'وقت البلاغ', resolved_at: null, internal_comment: 'INTERNAL_COMMENT_SECRET_MARKER' },
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
assert.ok(measured.length > 5, 'text width should be measured for line wrapping');
assert.ok(measured.includes('المشرف: محمود شريف'), 'the logical Arabic line should be measured without a different shaped string');
assert.ok(drawn.some(item => item.text === 'المشرف: محمود شريف'), 'the same logical Arabic line should be passed to jsPDF for drawing');
assert.ok(drawn.length > 10 && drawn.every(item => item.options.align === 'right'), 'all report text should be right-aligned');
const outputText = drawn.map(item => item.text).join(' ');
for (const expected of ['تقرير الوردية اليومية', 'محمود شريف', 'زام الرئيسي', 'إجمالي المبيعات', 'قهوة', 'تأخر صيانة الثلاجة', 'MARKER_AFTER_900', 'MARKER_AFTER_12000', 'App A', 'المشاكل التقنية', 'عطل الشاشة']) {
  assert.ok(outputText.includes(expected), `PDF should include ${expected}`);
}
assert.ok(!outputText.includes('INTERNAL_COMMENT_SECRET_MARKER'), 'PDF must never expose a technical-issue internal comment');
assert.ok(!outputText.includes('بلاغ تاريخي يجب استبعاده'), 'the PDF must exclude unlinked historical technical issues');
assert.ok(!outputText.includes('بلاغ تقرير آخر يجب استبعاده'), 'the PDF must exclude issues linked to another report');
console.log('send-report-copy PDF builder tests: passed (jsPDF mocks; no email sent)');
