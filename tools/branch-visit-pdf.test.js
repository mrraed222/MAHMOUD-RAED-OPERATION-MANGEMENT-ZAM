const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'branch-visits-history', 'index.html'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'assets', 'branch-visit-pdf.js'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'supabase', 'functions', 'visit-report-pdf', 'index.ts'), 'utf8');

test('visit history page loads the shared PDF generator and print uses its HTML and asset wait', () => {
  assert.match(page, /assets\/branch-visit-pdf\.js\?v=\d+/);
  assert.match(page, /async function printVisit\(id\)[\s\S]*?await ZamVisitPdf\.buildHtml\(v\)[\s\S]*?await ZamVisitPdf\.waitForAssets\(w\.document\)[\s\S]*?w\.print\(\)/);
});

test('local download and email use PDF bytes generated from the same shared visit template', () => {
  assert.match(page, /async function requestVisitPdf\(id,send\)[\s\S]*?await ZamVisitPdf\.downloadPdf\(v\)/);
  assert.doesNotMatch(page.match(/async function requestVisitPdf\(id,send\)[\s\S]*?\}\}async function sendVisitEmail/)[0], /functions\.invoke/);
  assert.match(page, /async function sendVisitEmail\(\)[\s\S]*?ZamVisitPdf\.generatePdfBase64\(visit\)[\s\S]*?send_email:true[\s\S]*?pdf_base64/);
  assert.match(pdf, /async function generatePdfBlob\(visit\)[\s\S]*?const html = await buildHtml\(visit\)/);
  assert.match(pdf, /async function downloadPdf\(visit\)[\s\S]*?generatePdfBlob\(visit\)/);
  assert.match(pdf, /async function generatePdfBase64\(visit\)[\s\S]*?generatePdfBlob\(visit\)/);
  assert.match(pdf, /\.from\(sheet\)\.outputPdf\('blob'\)/);
});

test('PDF endpoint caps request size and restricts custom PDFs to authorized email sends', () => {
  assert.match(endpoint, /readJsonBody\(req, 8 \* 1024 \* 1024\)/);
  assert.match(endpoint, /suppliedPdf\.length > 6 \* 1024 \* 1024/);
  assert.match(endpoint, /suppliedPdfBytes && \(!sendEmail \|\| !canManageVisits\)/);
  assert.match(endpoint, /new TextDecoder\(\)\.decode\(suppliedPdfBytes\.subarray\(0, 5\)\) !== '%PDF-'/);
});

test('custom emailed attachment is stored separately from the server-generated official visit PDF', () => {
  assert.match(endpoint, /const pdfBytes = await buildPdf\(/);
  assert.match(endpoint, /upload\(path, pdfBytes, \{ contentType: 'application\/pdf', upsert: true \}\)/);
  assert.match(endpoint, /const attachmentPath = suppliedPdfBytes[\s\S]*?email-/);
  assert.match(endpoint, /upload\(attachmentPath, suppliedPdfBytes, \{ contentType: 'application\/pdf', upsert: false \}\)/);
  assert.match(endpoint, /attachments: \[\{ filename:[\s\S]*?content: base64\(suppliedPdfBytes \|\| pdfBytes\)/);
});
