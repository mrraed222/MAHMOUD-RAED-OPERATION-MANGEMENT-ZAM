const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../reports-log/index.html'), 'utf8');

test('the Supabase SDK loads before the shared configuration', () => {
  const sdk = source.indexOf('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
  const config = source.indexOf('../assets/supabase-config.js');
  assert.ok(sdk >= 0 && config > sdk, 'the SDK must be present and precede shared configuration');
});

test('reports log preserves auth, scoped branch options, operational filtering, and Supervisor branch/shift scope', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /renderZamSidebar\('reports-log',currentUser\.role\)/);
  assert.match(source, /select\('\*, branches\(name\)'\)\.order\('report_date',\{ascending:false\}\)\.range\(0,9999\)/);
  assert.doesNotMatch(source, /rpc\('list_manager_report_branches'\)/);
  assert.match(source, /currentUser\.role==='Manager'[\s\S]*?MANAGER_SCOPE_UNCONFIGURED/);
  assert.match(source, /async function loadReports\(\)\{if\(currentUser\.role==='Manager'\)\{setStatus\([\s\S]*?return;\}/,
    'manual filtering and retry must not fall back to all Manager branches');
  assert.match(source, /currentUser\.role==='Supervisor'[\s\S]*?branchId=currentUser\.branch_id/);
  assert.match(source, /query\.eq\('shift_type',currentUser\.shift_type\)/,
    'Morning/Evening Supervisors must filter to their assigned shift');
  assert.match(source, /query\.in\('shift_type',\['Morning','Evening'\]\)/,
    'Both Supervisors may see both valid shift types');
  assert.match(source, /!report\.custom_fields\?\.technical_parent/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branchesById\.get/);
});

test('filters, retry, empty state and export operate on the currently loaded result set', () => {
  assert.match(source, /id="f-branch"/);
  assert.match(source, /id="f-from"/);
  assert.match(source, /id="f-to"/);
  assert.match(source, /addEventListener\('click',\(\)=>\{const from=/);
  assert.match(source, /addEventListener\('click',clearFilters\)/);
  assert.match(source, /id="retry-load"/);
  assert.match(source, /لا توجد تقارير مطابقة/);
  assert.match(source, /XLSX\.utils\.json_to_sheet\(rows\)/);
  assert.match(source, /id="result-count"/);
});

test('detail modal is accessible, scopes child data to the selected report, and prints only that report', () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="detail-title"/);
  assert.match(source, /Escape/);
  assert.match(source, /fetchAllRows\(zamClient,\s*table,\s*'report_id',\s*report\.id\)/,
    'non-waste child queries must paginate while filtering on the exact selected report ID');
  assert.match(source, /columns:'id,report_id,shift_type,sheet_key'/,
    'waste loading should select only metadata needed to verify report and shift association');
  assert.match(source, /ZamReportDetailRenderer\.filterWasteForReport\(report,\s*wasteRes\.data\s*\|\|\s*\[\]\)/);
  for (const table of ['shift_issues', 'negative_reviews', 'technical_issues']) {
    assert.match(source, new RegExp(`loadChildren\\('${table}'\\)`),
      `${table} must be loaded through the paginated, report-scoped helper`);
  }
  assert.match(source, /technicalIssues: \(technicalIssuesRes\.data \|\| \[\]\)\.filter\(issue => String\(issue\.report_id\) === String\(report\.id\)\)/,
    'technical issue rows must be exact-ID filtered again before rendering');
  assert.match(source, /ZamReportDetailRenderer\.render\(report/);
  assert.match(source, /branchName: report\.branches\?\.name/);
  assert.match(source, /id="print-detail"/);
  assert.match(source, /@media print[\s\S]*?body \*\{visibility:hidden!important\}[\s\S]*?#detail-modal,#detail-modal \*\{visibility:visible!important\}/);
});

test('desktop table and mobile cards are semantic, responsive, and escape database text', () => {
  assert.match(source, /<table class="desktop-table"><caption/);
  assert.match(source, /<div id="mobile-list" class="mobile-list" hidden>/);
  assert.match(source, /@media\(max-width:680px\)/);
  assert.match(source, /@media\(max-width:420px\)\{\.filter-grid\{grid-template-columns:minmax\(0,1fr\)\}\}/,
    'narrow screens must stack date filters to avoid clipping browser-native date inputs');
  assert.doesNotMatch(source, /calc\(312px\s*\+\s*24px\)/,
    'the hidden-by-default sidebar must not reserve a permanent desktop gutter');
  assert.match(source, /escapeHtml\(r\.supervisor_name/);
  assert.match(source, /aria-live="polite"/);
});
