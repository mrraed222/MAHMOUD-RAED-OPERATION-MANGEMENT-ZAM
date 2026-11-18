const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'branch-visits-history', 'index.html'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'assets', 'branch-visit-pdf.js'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'supabase', 'functions', 'visit-report-pdf', 'index.ts'), 'utf8');

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

test('PDF assembler embeds each rendered page and only appends authorized server-loaded evidence', () => {
  assert.match(endpoint, /for \(const bytes of renderedPages\)[\s\S]*?doc\.embedJpg\(bytes\)[\s\S]*?doc\.addPage\(\[595, 842\]\)/);
  assert.match(endpoint, /action_item_id && !canReviewActionProof && !actionIdsVisibleToActor\.has\(item\.action_item_id\)/);
  assert.match(endpoint, /const pdfBytes = await buildPdf\(renderedPages, evidence\)/);
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
