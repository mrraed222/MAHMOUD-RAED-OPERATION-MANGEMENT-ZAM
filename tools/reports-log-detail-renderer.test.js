const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'assets/report-detail-renderer.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'reports-log/index.html'), 'utf8');
const paginationSource = fs.readFileSync(path.join(root, 'assets/supabase-pagination.js'), 'utf8');
const window = {};
vm.runInNewContext(rendererSource, { window, globalThis: window, JSON, String, Number, Array });
vm.runInNewContext(paginationSource, { window, globalThis: window, Array, Number, TypeError, Object });

const markup = window.ZamReportDetailRenderer.render({
  id: 'report-1',
  supervisor_name: 'مشرف <script>alert(1)</script>',
  report_date: '2026-11-22',
  entry_time: '23:15',
  shift_type: 'Evening',
  total_sales: 1234.5,
  orders_count: 12,
  avg_ticket: 102.875,
  team_status: 'كامل & ملتزم',
  positive_reviews: 3,
  created_at: '2026-11-22T20:15:00Z',
  custom_fields: { note: 'قيمة إضافية', technical_parent: 'internal-only' },
}, {
  branchName: 'البرج',
  waste: [{ item_name: 'حليب', quantity: 2, unit: 'لتر', reason: 'منتهي', root_cause: 'تخزين', corrective_action: 'FIFO', owner: 'سارة', unit_cost: 8.5, shift_type: 'Evening', created_at: 'وقت الهدر' }],
  issues: [{ issue_type: 'تقنية', description: 'تعطل <آلة>', priority: 'عالية', action_taken: 'تم الإصلاح', created_at: 'وقت المشكلة' }],
  technicalIssues: [
    { id: 'technical-1', report_id: 'report-1', title: 'عطل <ماكينة>', description: 'تحتاج فحصًا', source: 'manual', priority: 'high', status: 'open', created_at: 'وقت البلاغ', internal_comment: 'تم فتح طلب صيانة' },
    { id: 'technical-historical', report_id: null, title: 'بلاغ قديم غير مرتبط', description: 'لا يملك معرّف تقرير' },
    { id: 'technical-other-report', report_id: 'report-2', title: 'بلاغ لتقرير آخر', description: 'يجب استبعاده' },
  ],
  reviews: [{ review_type: 'negative', comment_text: 'خرائط Google <تعليق>', status: 'قيد المعالجة', owner: 'عمر', action_taken: 'اتصال', customer_rating: 2, closed_at: '2026-11-23', created_at: 'وقت التقييم' }],
});

for (const expected of [
  'البرج', 'مشرف &lt;script&gt;alert(1)&lt;/script&gt;', '23:15', 'مسائية',
  'حالة الفريق', 'كامل &amp; ملتزم', 'إجمالي المبيعات', 'عدد الطلبات',
  'متوسط الفاتورة', 'التقييمات الإيجابية المسجلة', 'قيمة إضافية',
  'الصنف', 'السبب الجذري', 'الإجراء التصحيحي', 'المسؤول', 'تكلفة الوحدة',
  'الوردية', 'نوع المشكلة', 'الأولوية', 'الإجراء المتخذ',
  'الحالة', 'تاريخ الإغلاق', 'تقييم العميل', 'خرائط Google &lt;تعليق&gt;',
  'المشاكل التقنية', 'عطل &lt;ماكينة&gt;', 'الوصف الأصلي', 'تعليق المتابعة', 'تم فتح طلب صيانة',
]) assert.ok(markup.includes(expected), `full report details should include ${expected}`);
assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/, 'untrusted text must never render as executable HTML');
assert.doesNotMatch(markup, /internal-only/, 'internal technical-parent marker is not a user report field');
assert.doesNotMatch(markup, /بلاغ قديم غير مرتبط|بلاغ لتقرير آخر/, 'unlinked historical issues and issues belonging to another report must never render here');
assert.match(pageSource, /window\.ZamSupabasePagination[\s\S]*?fetchAllRows\(zamClient, table, 'report_id', report\.id\)/,
  'all report child tables must use the complete-page API helper');
assert.match(pageSource, /loadChildren\('waste_logs'\)[\s\S]*?loadChildren\('technical_issues'\)/,
  'the report detail view must load every child table through the paged helper');
assert.ok(window.ZamSupabasePagination, 'the shared page helper is loaded for the report view');
assert.match(pageSource, /String\(issue\.report_id\)\s*===\s*String\(report\.id\)/,
  'the renderer input must be defense-in-depth filtered by exact report ID');

console.log('reports-log complete detail renderer tests: passed');
