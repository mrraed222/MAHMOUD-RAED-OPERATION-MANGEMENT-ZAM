const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'assets/report-detail-renderer.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'reports-log/index.html'), 'utf8');
const paginationSource = fs.readFileSync(path.join(root, 'assets/supabase-pagination.js'), 'utf8');
const window = {};
vm.runInNewContext(rendererSource, { window, globalThis: window, JSON, String, Number, Array, Date });
vm.runInNewContext(paginationSource, { window, globalThis: window, Array, Number, TypeError, Object });

const reportKey = 'زام الرئيسي|2026-11-22|Evening|مشرف المساء|18';
const report = {
  id: 'report-1', sheet_key: reportKey, report_date: '2026-11-22', supervisor_name: 'مشرف <script>alert(1)</script>',
  entry_time: '23:15', shift_type: 'Evening', total_sales: 1234.5, orders_count: 12,
  avg_ticket: 102.875, team_status: 'كامل & ملتزم', positive_reviews: 3,
  created_at: '2026-11-22T20:15:00Z',
  custom_fields: { note: 'قيمة إضافية', sheet_key: reportKey, sheet_row: 18, technical_parent: 'internal-only' },
};
const wasteRows = [
  { id: 'waste-evening-key', sheet_key: `${reportKey}|W|حليب|2|لتر|منتهي`, shift_type: 'Evening', item_name: 'حليب', quantity: 2, unit: 'لتر', reason: 'منتهي' },
  { id: 'waste-morning-key', sheet_key: 'زام الرئيسي|2026-11-22|Morning|مشرف الصباح|12|W|عصير|1|علبة|تالف', shift_type: 'Morning', item_name: 'عصير' },
  { id: 'waste-morning-shift', shift_type: 'Morning', item_name: 'قهوة' },
  { id: 'waste-evening-shift', shift_type: 'مسائي', item_name: 'سكر' },
  { id: 'waste-unverified', item_name: 'غير معروف' },
];
const filteredWaste = window.ZamReportDetailRenderer.filterWasteForReport(report, wasteRows);
assert.deepEqual(Array.from(filteredWaste, row => row.id), ['waste-evening-key', 'waste-evening-shift']);

const markup = window.ZamReportDetailRenderer.render(report, {
  branchName: 'البرج',
  waste: filteredWaste,
  issues: [{ issue_type: 'تقنية', description: 'تعطل <آلة>', priority: 'عالية', action_taken: 'تم الإصلاح', created_at: 'وقت المشكلة' }],
  technicalIssues: [
    { id: 'technical-1', report_id: 'report-1', title: 'عطل <ماكينة>', description: 'تحتاج فحصًا', source: 'manual', priority: 'high', status: 'open', created_at: 'وقت البلاغ', internal_comment: 'تم فتح طلب صيانة' },
    { id: 'technical-historical', report_id: null, title: 'بلاغ قديم غير مرتبط' },
    { id: 'technical-other-report', report_id: 'report-2', title: 'بلاغ لتقرير آخر' },
  ],
  reviews: [{ review_type: 'negative', comment_text: 'خرائط Google <تعليق>', status: 'قيد المعالجة', owner: 'عمر', action_taken: 'اتصال', customer_rating: 2, closed_at: '2026-11-23', created_at: 'وقت التقييم' }],
});

for (const expected of [
  'البرج', 'مشرف &lt;script&gt;alert(1)&lt;/script&gt;', '23:15', 'مسائية',
  'حالة الفريق', 'كامل &amp; ملتزم', 'إجمالي المبيعات', 'عدد الطلبات', 'متوسط الفاتورة',
  'التقييمات الإيجابية المسجلة', 'قيمة إضافية', 'ملخص الهدر', 'عدد السجلات المرتبطة بهذا التقرير',
  'نوع المشكلة', 'الأولوية', 'الإجراء المتخذ', 'الحالة', 'تاريخ الإغلاق', 'تقييم العميل',
  'خرائط Google &lt;تعليق&gt;', 'المشاكل التقنية', 'عطل &lt;ماكينة&gt;', 'الوصف الأصلي',
  'تعليق المتابعة', 'تم فتح طلب صيانة',
]) assert.ok(markup.includes(expected), `report details should include ${expected}`);
assert.doesNotMatch(markup, /2026-11-22T20:15:00Z/, 'timestamps should be formatted for readers');
assert.doesNotMatch(markup, /حليب|منتهي|عصير|تالف|قهوة|سكر|2 لتر/, 'raw waste item, quantity and reason rows must never be rendered');
assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/, 'untrusted text must never render as executable HTML');
assert.doesNotMatch(markup, /internal-only|sheet_row|sheet_key/, 'internal migration metadata must never render');
assert.doesNotMatch(markup, /بلاغ قديم غير مرتبط|بلاغ لتقرير آخر/, 'unlinked and cross-report technical issues must never render here');
assert.match(pageSource, /fetchAllRows\(zamClient,'waste_logs','report_id',report\.id,\{columns:attempt\.columns,orderBy:null,tieBreaker:null\}\)/,
  'the report detail must request only the safe association fields for waste');
assert.match(pageSource, /ZamReportDetailRenderer\.filterWasteForReport\(report,\s*wasteRes\.data\s*\|\|\s*\[\]\)/,
  'waste summary rows must be filtered to the report key and shift before rendering');
assert.match(pageSource, /@media print\{[\s\S]*?body \*\{visibility:hidden!important\}[\s\S]*?#detail-modal,#detail-modal \*\{visibility:visible!important\}/,
  'printing should show the selected report modal only');
assert.match(pageSource, /id="print-detail"[\s\S]*?window\.print\(\)/,
  'the selected report can be printed from its detail modal');
assert.ok(window.ZamSupabasePagination, 'the shared pagination helper is loaded for report details');

console.log('reports-log detail formatting, safe waste summary, association and print tests: passed');
