const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../daily-report/index.html'), 'utf8');

test('daily report organizes completion from identity through review and submission', () => {
  const positions = [
    source.indexOf('id="page-title"'),
    source.indexOf('class="report-step-nav"'),
    source.indexOf('id="report-context"'),
    source.indexOf('id="financial-section"'),
    source.indexOf('id="waste-section"'),
    source.indexOf('id="customer-section"'),
    source.indexOf('id="report-submit"')
  ];
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(source, /id="report-log-link"|سجل التقارير/);
  assert.match(source, /مراجعة التقرير/);
  assert.match(source, /role="status" aria-live="polite"/);
});

test('auth, owner redirect, branch lifecycle, duplicate guard, payload and saved-report actions remain correct', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /currentUser\.role === 'Owner'[\s\S]*?\.\.\/dashboard\/index\.html/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branch, submissionDate\)/);
  assert.match(source, /ZamAPI\.getDailyReportMatches\(\{[\s\S]*?branchId: currentUser\.branch_id,[\s\S]*?reportDate: submissionDate,[\s\S]*?shiftType: submissionShift/);
  assert.match(source, /ZamAPI\.submitDailyReport\(\{[\s\S]*?core:[\s\S]*?custom_fields: \{\},[\s\S]*?waste: wasteRows,[\s\S]*?issues: issueRows/);
  assert.match(source, /zamDailyReportPartial:/);
  assert.match(source, /duplicateReport/);
  assert.match(source, /partialSubmission = \{ key: submissionKey, reportId: String\(partialReportId\) \}/);
  assert.match(source, /savedReportPrintSnapshot = printSnapshot/);
  assert.match(source, /id="saved-report-actions"/);
  assert.match(source, /تم حفظ التقرير، لكن تعذر تأكيد البريد/);
});

test('row editing, complaint and technical workflows remain present and the shared bell is not duplicated', () => {
  assert.match(source, /function addRow\(tableId\)/);
  assert.match(source, /function collectRows\(tableId, cols\)/);
  assert.match(source, /id="tech-toggle-btn"/);
  assert.match(source, /ZamAPI\.createTechnicalIssue\(/);
  assert.match(source, /ZamAPI\.updateTechnicalIssue\(/);
  assert.match(source, /id="complaint-list"/);
  assert.match(source, /\.from\('negative_reviews'\)\.update\(payload\)/);
  assert.doesNotMatch(source, /id="notif-bell-slot"/);
  assert.match(source, /renderZamSidebar\('daily-report', currentUser\.role\)/);
});

test('waste table scrolls horizontally in a keyboard-accessible region without changing row bindings', () => {
  assert.match(source, /<div class="overflow-x-auto rounded-lg border border-outline-variant" role="region" aria-label="جدول الهدر، قابل للتمرير أفقيًا" tabindex="0">\s*<table class="w-full text-right" id="waste-table">/);
  assert.match(source, /onclick="addRow\('waste-table'\)"/);
  assert.match(source, /<tbody id="waste-tbody"><\/tbody>/);
});

test('mobile layout and keyboard focus styles are provided without changing the data semantics', () => {
  assert.match(source, /@media\(max-width:767px\)/);
  assert.match(source, /:focus-visible/);
  assert.match(source, /prefers-reduced-motion:reduce/);
  assert.match(source, /لا يوجد استيراد تلقائي من Google Maps/);
  assert.match(source, /تعذّر حفظ تقييمات العميل بعد إنشاء التقرير/);
});
