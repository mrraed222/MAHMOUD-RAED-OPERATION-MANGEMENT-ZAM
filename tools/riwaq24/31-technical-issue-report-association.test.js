const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261122231500_technical_issue_report_association.sql'), 'utf8');
const integrityMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261122233700_report_scope_integrity_and_send_idempotency.sql'), 'utf8');
const reportForm = fs.readFileSync(path.join(root, 'daily-report/index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'assets/supabase-config.js'), 'utf8');
const reportLog = fs.readFileSync(path.join(root, 'reports-log/index.html'), 'utf8');
const pagination = fs.readFileSync(path.join(root, 'assets/supabase-pagination.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/send-report-copy/index.ts'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'supabase/functions/send-report-copy/report-pdf.mjs'), 'utf8');

assert.match(migration, /ADD COLUMN IF NOT EXISTS report_id uuid/);
assert.match(migration, /FOREIGN KEY \(report_id, branch_id\)[\s\S]*?REFERENCES public\.daily_reports \(id, branch_id\)[\s\S]*?ON DELETE SET NULL \(report_id\)/,
  'the composite FK must enforce report/branch consistency and null only the association on report deletion');
assert.match(migration, /CHECK \(report_id IS NULL OR source = 'manual'\)/,
  'automatic fridge alerts must remain unlinked');
assert.match(migration, /CREATE POLICY technical_issues_authorized_report_parent[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR ALL TO authenticated[\s\S]*?public\.daily_reports AS report[\s\S]*?report\.id = technical_issues\.report_id/,
  'linked issue reads and writes must inherit authorized parent-report RLS');
assert.match(migration, /prevent_technical_issue_report_reassignment[\s\S]*?NEW\.report_id IS DISTINCT FROM OLD\.report_id AND NEW\.report_id IS NOT NULL/,
  'report association can be set at issue creation, not used to backfill or reassign old rows');
assert.match(integrityMigration, /NEW\.report_id IS DISTINCT FROM OLD\.report_id AND NEW\.report_id IS NOT NULL/,
  'the combined migration must continue to reject reassignment');
assert.match(integrityMigration, /OLD\.report_id IS NOT NULL[\s\S]*?NEW\.report_id IS NULL[\s\S]*?FROM public\.daily_reports AS report[\s\S]*?RAISE EXCEPTION 'technical_issue_report_link_cannot_be_cleared'/,
  'manual unlinking must be rejected while ON DELETE SET NULL remains possible after the parent is gone');
assert.match(migration, /ON DELETE SET NULL \(report_id\)/,
  'the protection must preserve the FK cascade that clears only the association on report deletion');
assert.doesNotMatch(migration, /UPDATE\s+public\.technical_issues/i, 'migration must not backfill historical rows');

const savedIdAssignment = reportForm.indexOf("techReportLink.dataset.reportId = String(report.id)");
const savedReportResult = reportForm.indexOf('const report = await ZamAPI.submitDailyReport');
assert.ok(savedReportResult >= 0 && savedIdAssignment > savedReportResult,
  'the UI must expose association only after submitDailyReport returns the exact saved ID');
assert.match(reportForm, /id="tech-report-link" type="checkbox"[^>]*disabled/,
  'the opt-in checkbox must start disabled before a report has been saved');
assert.match(reportForm, /if \(reportLink\.checked\) issuePayload\.report_id = reportLink\.dataset\.reportId/,
  'the manual issue form must send only its explicit selected report UUID');
assert.match(api, /report_id = null/);
assert.match(api, /issue\.report_id = report_id/);
assert.match(api, /\.from\('technical_issues'\)\s*\.insert\(\[issue\]\)/);
const fridgeInsertStart = api.indexOf(".from('technical_issues').insert(issues)");
assert.ok(fridgeInsertStart > 0, 'automatic fridge issues retain their existing insert path');
const fridgeInsertContext = api.slice(api.indexOf('const issues = problems.map'), fridgeInsertStart);
assert.doesNotMatch(fridgeInsertContext, /report_id/, 'automatic fridge alerts are never assigned to a report by date or branch');

assert.match(reportLog, /fetchAllRows\(zamClient, table, 'report_id', report\.id\)/,
  'report detail children must use the paginated helper with the exact selected report ID');
assert.match(pagination, /\.eq\(filterColumn, filterValue\)[\s\S]*?\.range\(from, to\)/,
  'the report detail helper must query exact-linked child pages');
assert.match(reportLog, /String\(issue\.report_id\)\s*===\s*String\(report\.id\)/,
  'detail rendering input must be filtered again by exact ID');
assert.match(edge, /admin\.from\('technical_issues'\)[\s\S]*?\.eq\('report_id', reportId\)/,
  'the report-copy PDF query must use the same exact saved report UUID');
assert.match(pdf, /String\(row\.report_id\) === reportId/,
  'the PDF builder must reject unlinked historical or different-report rows even if accidentally supplied');

console.log('technical-issue report association static tests: passed');
