const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../reports-log/index.html'), 'utf8');

test('reports log preserves auth, query range, operational filtering and supervisor branch scope', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /renderZamSidebar\('reports-log',currentUser\.role\)/);
  assert.match(source, /select\('\*, branches\(name\)'\)\.order\('report_date',\{ascending:false\}\)\.range\(0,9999\)/);
  assert.match(source, /if\(currentUser\.role==='Supervisor'\)branchId=currentUser\.branch_id/);
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

test('detail modal is accessible and waste uses count-only without exposing raw waste data', () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="detail-title"/);
  assert.match(source, /Escape/);
  assert.match(source, /select\('id',\{count:'exact',head:true\}\)\.eq\('report_id',id\)/);
  assert.doesNotMatch(source, /waste_logs\)\.select\('\*'/);
  assert.doesNotMatch(source, /wasteRes\.data/);
  assert.doesNotMatch(source, /wasteRes\.count[^\n]*quantity|wasteRes\.count[^\n]*reason/i);
  assert.match(source, /عدد سجلات الهدر/);
});

test('desktop table and mobile cards are semantic, responsive, and escape database text', () => {
  assert.match(source, /<table class="desktop-table"><caption/);
  assert.match(source, /<div id="mobile-list" class="mobile-list" hidden>/);
  assert.match(source, /@media\(max-width:680px\)/);
  assert.match(source, /escapeHtml\(r\.supervisor_name/);
  assert.match(source, /aria-live="polite"/);
});
