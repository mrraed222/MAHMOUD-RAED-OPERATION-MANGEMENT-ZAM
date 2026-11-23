const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'branch-visits-history', 'index.html'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'assets', 'branch-visit-pdf.js'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'supabase', 'functions', 'visit-report-pdf', 'index.ts'), 'utf8');
const evidenceScope = import(path.join(root, 'supabase', 'functions', 'visit-report-pdf', 'scope-evidence.mjs'));

test('visit history page loads the shared report renderer and native print waits for HTML assets', () => {
  assert.match(page, /assets\/branch-visit-pdf\.js\?v=\d+/);
  assert.match(page, /async function printVisit\(id\)[\s\S]*?await ZamVisitPdf\.buildHtml\(v\)[\s\S]*?await ZamVisitPdf\.waitForAssets\(w\.document\)[\s\S]*?w\.print\(\)/);
  assert.doesNotMatch(page, /html2pdf/i);
});

test('downloads and email request the same rendered-page PDF from the server', () => {
  assert.match(page, /async function requestVisitPdf\(id,send\)[\s\S]*?await ZamVisitPdf\.downloadPdf\(v\)/);
  assert.match(page, /async function sendVisitEmail\(\)[\s\S]*?ZamVisitPdf\.requestPdf\(visit,\{send_email:true,recipient_modes:modes\}\)/);
  assert.match(pdf, /async function renderPageImages\(visit\)/);
  assert.match(pdf, /page\.canvas\.toDataURL\('image\/jpeg', 0\.9\)/);
  assert.match(pdf, /async function requestPdf\(visit, options = \{\}\)[\s\S]*?rendered_pages/);
  assert.match(pdf, /async function downloadPdf\(visit\)[\s\S]*?requestPdf\(visit\)[\s\S]*?fetch\(data\.signed_url\)/);
});

test('PDF endpoint validates JPEG pages and uses the exact assembled PDF for storage and email', () => {
  assert.match(endpoint, /readJsonBody\(req, 12 \* 1024 \* 1024\)/);
  assert.match(endpoint, /function decodeRenderedPages\(value: unknown\)/);
  assert.match(endpoint, /value\.length < 1 \|\| value\.length > 20/);
  assert.match(endpoint, /bytes\[0\] !== 0xff \|\| bytes\[1\] !== 0xd8 \|\| bytes\[2\] !== 0xff/);
  assert.match(endpoint, /const renderedPages = decodeRenderedPages\(body\.rendered_pages\)/);
  assert.match(endpoint, /const pdfBytes = await buildPdf\(renderedPages, evidence\)/);
  assert.match(endpoint, /upload\(path, pdfBytes, \{ contentType: 'application\/pdf', upsert: true \}\)/);
  assert.match(endpoint, /attachments: \[\{ filename:[\s\S]*?content: base64\(pdfBytes\)/);
  assert.doesNotMatch(endpoint, /suppliedPdfBytes|pdf_base64|suppliedPdf/);
});

test('Full-report permission is checked before the service-role visit read', () => {
  const accessCheck = endpoint.indexOf("rpc('can_access_branch_visit',");
  const fullReportGate = endpoint.indexOf("rpc('can_generate_branch_visit_report_pdf',");
  const serviceClientCreate = endpoint.indexOf('supabaseAdmin = createClient');
  const serviceProfileRead = endpoint.indexOf("supabaseAdmin.from('profiles')");
  const serviceVisitRead = endpoint.indexOf("supabaseAdmin.from('supervisory_visits')");
  assert.ok(accessCheck < 0 && fullReportGate >= 0 && serviceClientCreate > fullReportGate
      && serviceProfileRead > fullReportGate && serviceVisitRead > fullReportGate,
    'the full-report gate must precede service-client creation and every service-role read');
  assert.doesNotMatch(endpoint, /can_review_branch_visit_actions/);
  const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261123110000_manager_branch_scoped_read_permissions.sql'), 'utf8');
  assert.match(migration, /public\.can_review_branch_visit_actions\(\)[\s\S]*?ai\.status = 'بانتظار اعتماد الإدارة'[\s\S]*?ai\.reviewed_by/);
  assert.match(migration, /FUNCTION public\.can_access_branch_visit_report\(p_visit_id uuid\)[\s\S]*?public\.can_view_branch_visit_reports\(\)[\s\S]*?public\.branch_visit_assignments/);
  assert.match(migration, /FUNCTION public\.can_generate_branch_visit_report_pdf\(p_visit_id uuid\)[\s\S]*?public\.current_user_role\(\)[\s\S]*?can_manager_read_visit_report[\s\S]*?can_access_branch_visit_report/);
  assert.doesNotMatch(migration.match(/FUNCTION public\.can_access_branch_visit_report\(p_visit_id uuid\)[\s\S]*?\$function\$;/)[0], /visit_action_items/);
  assert.match(migration, /manager_supervisory_visit_notes_read_capability[\s\S]*?can_manager_read_visit_report/);
  assert.match(endpoint, /rpc\('get_branch_visit_report_email_recipients', \{ p_visit_id: visitId \}\)/);
  assert.doesNotMatch(endpoint, /from\('profiles'\)\.select\('email'\)\.in\('role', managementRoles\)/);
  assert.match(migration, /FUNCTION public\.profile_can_read_manager_visit_report\(\s*p_profile_id uuid,\s*p_visit_id uuid\s*\)[\s\S]*?p\.role = 'Manager'[\s\S]*?ap\.can_view_visit_reports IS TRUE[\s\S]*?manager_report_branch_in_scope/);
  assert.match(migration, /FUNCTION public\.get_branch_visit_report_email_recipients\(p_visit_id uuid\)[\s\S]*?public\.profile_can_read_manager_visit_report\(p\.id, p_visit_id\)/);
});

test('PDF assembler embeds rendered pages and downloads evidence only after RLS-scoped row selection', () => {
  assert.match(endpoint, /for \(const bytes of renderedPages\)[\s\S]*?doc\.embedJpg\(bytes\)[\s\S]*?doc\.addPage\(\[595, 842\]\)/);
  assert.match(endpoint, /userClient\.from\('visit_action_items'\)/);
  assert.match(endpoint, /userClient\.from\('visit_evidence'\)/);
  assert.doesNotMatch(endpoint, /supabaseAdmin\.from\('visit_evidence'\)/,
    'the service role must not enumerate all visit evidence');
  assert.match(endpoint, /scopeVisitPdfRows\([\s\S]*?visibleActions[\s\S]*?visibleEvidenceRows[\s\S]*?fullReportVisible/);
  assert.match(endpoint, /storage\.from\(evidenceBucket\)\.download\(item\.file_path\)/);
  assert.match(endpoint, /const pdfBytes = await buildPdf\(renderedPages, evidence\)/);
});

test('an action-only PDF excludes evidence linked to another action', async () => {
  const { scopeVisitPdfRows } = await evidenceScope;
  const result = scopeVisitPdfRows({
    actions: [{ id: 'assigned-action' }],
    evidenceRows: [
      { id: 'assigned-proof', action_item_id: 'assigned-action', file_path: 'assigned/photo.jpg' },
      { id: 'other-proof', action_item_id: 'other-action', file_path: 'other/photo.jpg' },
      { id: 'result-proof', result_id: 'other-result', action_item_id: null, file_path: 'result/photo.jpg' },
    ],
  });
  assert.deepEqual(result.evidenceRows.map(row => row.id), ['assigned-proof']);
});

test('visit-report emails conceal recipient addresses in BCC and in the message body', () => {
  assert.match(endpoint, /to: 'operation@zam\.sa', bcc: recipients\.filter/);
  const emailHtml = endpoint.match(/function emailHtml\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(emailHtml);
  assert.doesNotMatch(emailHtml, /recipients|المستلمون/);
});

test('report shows quality outcome, contact address and approval stamp', () => {
  assert.match(pdf, /operation@zam\.sa/);
  assert.match(pdf, /اعتماد إلكتروني — محمود شريف — إدارة التشغيل/);
  assert.match(endpoint, /operation@zam\.sa/);
  assert.match(pdf, /حالة الجودة/);
  assert.match(endpoint, /حالة الجودة/);
});

test('new visits separate government items and keep old drafts on the legacy template', () => {
  const form = fs.readFileSync(path.join(root, 'branch-visits-new', 'index.html'), 'utf8');
  const codes = form.match(/const NEW_BRANCH_VISIT_CODES = \[([\s\S]*?)\];/);
  assert.ok(codes, 'new assessment code list should exist');
  assert.equal((codes[1].match(/'BRV-[A-Z0-9-]+'/g) || []).length, 19);
  for (const code of ['BRV-GOV-FIRE','BRV-GOV-EQUIPMENT','BRV-GOV-MUNICIPAL','BRV-GOV-FOOD','BRV-GOV-GMP']) {
    assert.match(form, new RegExp(code));
  }
  assert.match(form, /assessment_version: activeAssessmentVersion/);
  assert.match(form, /draft\.assessment_version === 2 \? 2 : 1/);
  assert.match(form, /legacyMode \? \(template\.active \|\| template\.code === 'BRV-GOV-01'/);
  assert.match(form, /item_type: actionType/);
  assert.match(form, /file && actionType === 'مخالفة'/);
});

test('quality outcome uses an unrounded 70% threshold and supports documented exceptional failure', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261118191000_branch_visit_quality_and_government_items.sql'), 'utf8');
  assert.match(migration, /score_total \* 100 < NEW\.score_possible \* 70/);
  assert.match(migration, /NEW\.status = 'معتمدة'/);
  assert.match(migration, /length\(btrim\(COALESCE\(NEW\.observation, ''\)\)\) < 3/);
  assert.match(migration, /ai\.item_type = 'مخالفة'[\s\S]*?t\.requires_photo_on_violation/);
  assert.match(migration, /UPDATE public\.supervisory_visits[\s\S]*?SET quality_status[\s\S]*?WHERE status = 'معتمدة'[\s\S]*?AND quality_override = false/);
  assert.doesNotMatch(migration.match(/UPDATE public\.supervisory_visits[\s\S]*?-- Accept the new 19-item model/)[0], /SET\s+[^;]*\b(score_total|score_possible|observation|role|permission)\s*=/i);
});

test('history page limits exceptional overrides to visit managers and preserves the reason', () => {
  assert.match(page, /quality_override_reason,quality_override_by,quality_override_at/);
  assert.match(page, /canManageVisits&&v\.status==='معتمدة'/);
  assert.match(page, /سبب الرسوب الاستثنائي/);
  assert.match(page, /دوّن الملاحظة الخطيرة التي تبرر الرسوب/);
  assert.match(page, /update\(payload\)\.eq\('id',id\)/);
});
