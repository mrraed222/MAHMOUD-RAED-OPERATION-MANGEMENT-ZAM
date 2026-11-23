const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'reports-log', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'assets', 'report-detail-renderer.js'), 'utf8');

assert.match(html, /fetchAllRows\(zamClient,\s*table,\s*'report_id',\s*report\.id\)/,
  'child rows must be paginated and scoped to the exact selected report ID');
for (const table of ['waste_logs', 'shift_issues', 'negative_reviews']) {
  assert.match(html, new RegExp(`loadChildren\\('${table}'\\)`),
    `${table} must use the shared paginated report-child loader`);
}
assert.match(html, /ZamReportDetailRenderer\.render\(report/);
assert.match(renderer, /root_cause/);
assert.match(renderer, /corrective_action/);
assert.match(renderer, /issue_type/);
assert.match(renderer, /customer_rating/);
assert.match(renderer, /closed_at/);
assert.match(renderer, /reviewLabel\(row\.review_type\)/);
assert.match(renderer, /escapeHtml\(label\)/);
assert.match(renderer, /escapeHtml\(formatter\(value\)\)/);
assert.match(renderer, /technical_parent/);
assert.match(html, /loadChildren\('technical_issues'\)/,
  'technical issues must use the paginated exact-report loader and exclude unlinked history');

console.log('reports-log full detail loading test: passed');
