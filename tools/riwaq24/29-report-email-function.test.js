const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const functionDir = path.join(root, 'supabase/functions/send-report-copy');
const edge = fs.readFileSync(path.join(functionDir, 'index.ts'), 'utf8');
const pdf = fs.readFileSync(path.join(functionDir, 'report-pdf.mjs'), 'utf8');
const provider = fs.readFileSync(path.join(functionDir, 'email-provider.mjs'), 'utf8');
const sendOnce = fs.readFileSync(path.join(functionDir, 'email-send-once.mjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'daily-report/index.html'), 'utf8');

assert.match(edge, /auth\.getUser\(\)/, 'the Edge Function must verify the caller session');
assert.match(edge, /\.select\('id,email,status,role'\)/, 'the caller role must distinguish own-report supervisor copies from readers');
assert.match(edge, /rpc\('can_generate_daily_report_copy', \{\s*p_report_id: reportId,?\s*\}\)/,
  'one authenticated RPC must authorize the exact report and the Manager analytics/detail capability');
assert.match(edge, /if \(canGenerateCopy !== true\)[\s\S]*?404/,
  'revoked or out-of-scope report access must not return a PDF');
assert.doesNotMatch(edge, /userClient\.from\('daily_reports'\)/,
  'do not leave a second, weaker preflight path beside the unified permission RPC');
const copyPermissionGate = edge.indexOf("rpc('can_generate_daily_report_copy'");
const serviceClientCreate = edge.indexOf('const admin = createClient');
const serviceProfileRead = edge.indexOf("admin.from('profiles')");
const serviceReportRead = edge.indexOf("admin.from('daily_reports')");
assert.ok(copyPermissionGate >= 0 && copyPermissionGate < serviceClientCreate
  && copyPermissionGate < serviceProfileRead && copyPermissionGate < serviceReportRead,
  'the report-copy permission RPC must run before service-role creation and every privileged read');
assert.match(edge, /rpc\('get_daily_report_copy_recipients', \{ p_report_id: reportId \}\)/, 'recipients must come from the report-scoped server resolver');
assert.match(edge, /if \(recipientsError\) throw new FunctionError\(422, 'report_recipient_authorization_failed'\)/);
assert.ok(edge.indexOf('if (recipientsError) throw') < edge.indexOf('sendEmailWithResend({'), 'authorization failure must occur before any mail provider call');
assert.match(edge, /const FROM = 'ZAM Operations <operations@zam\.sa>'/);
assert.match(edge, /const ownReportSupervisorEmail = actor\.role === 'Supervisor'[\s\S]*?actor\.id === report\.submitted_by[\s\S]*?isValidEmail\(actor\.email\)/,
  'only a supervisor submitting their own report may receive an automatic caller copy');
assert.match(edge, /const recipients = \[\.\.\.new Set\(\[[\s\S]*?\.\.\.managementEmails,[\s\S]*?\]\)\]/,
  'all other recipients must come from the report-scoped authorized resolver');
assert.doesNotMatch(edge, /submitter_email_missing/, 'a reader must not need an email address just to retrieve an authorized PDF');
assert.match(edge, /if \(!recipientRows\.length\)\s*\{/, 'send-time delivery needs at least one recipient authorized for this report');
assert.doesNotMatch(edge, /!recipientRows\.some\(\(row\) => row\.is_primary === true\)/,
  'a selected-scope primary need not be in scope for every other report');
assert.doesNotMatch(edge, /\.in\('role', managementRoles\)/, 'do not send to every account with a broad role');
assert.match(edge, /import \{ jsPDF \} from 'npm:jspdf@4\.2\.1'/);
assert.doesNotMatch(edge, /bidi-shaper|pdf-lib|fontkit/, 'the Edge Function must not retain the failed PDF/fontkit shaping paths');
assert.match(edge, /Deno\.readFile\(new URL\('\.\/assets\/ZamArabicSans-Regular\.ttf'/);
assert.match(edge, /fontBase64: base64\(arabicLatinFontBytes\)/);
assert.match(edge, /if \(pdfBytes\.length > 15 \* 1024 \* 1024\)/, 'the generated attachment must be size-limited');
assert.match(edge, /\.select\('\*,branches\(name\)'\)/, 'the report row and branch name should be loaded for the PDF');
assert.ok((edge.match(/fetchAllPages\(/g) || []).length >= 4, 'every report-child table must be paginated');
assert.ok((edge.match(/\.range\(from, to\)/g) || []).length >= 4, 'each report-child page must use an explicit range');
assert.equal((edge.match(/admin\.from\('daily_reports'\)/g) || []).length, 1,
  'the report detail row must be read once with the service client after authenticated visibility succeeds');
assert.match(edge, /DETAIL_PAGE_SIZE = 1000/, 'detail pagination must cover the full Supabase page size');
assert.match(edge, /admin\.from\('technical_issues'\)[\s\S]*?\.eq\('report_id',\s*reportId\)/,
  'dedicated technical issues must be fetched only by the exact saved report ID');
assert.match(edge, /technicalIssues,\s*\n\s*\}\)/, 'the exact-linked technical issues must reach the PDF builder');
assert.match(edge, /claim_daily_report_email_send/);
assert.match(edge, /finish_daily_report_email_send/);
assert.match(edge, /sendEmail: \(\{ payload: outgoingPayload, idempotencyKey \}: \{[\s\S]*?sendEmailWithResend\([\s\S]*?idempotencyKey,/,
  'the provider call must reuse the durable database idempotency key');
assert.match(edge, /payloadSha256 = await sha256Hex\(JSON\.stringify\(payload\)\)/,
  'the durable ledger must bind retries to an unchanged payload');
assert.match(edge, /delivery\.decision === 'reconciliation_required'/,
  'an expired uncertain send must require reconciliation instead of a fresh key');
assert.match(edge, /pdf_base64: pdfBase64/);
assert.match(edge, /pdf_filename: pdfFilename/);
assert.match(edge, /email_sent: true/);
assert.match(edge, /email_sent: false/);
assert.match(pdf, /doc\.addFileToVFS\(FONT_FILE, fontBase64\)/);
assert.match(pdf, /doc\.addFont\(FONT_FILE, FONT_NAME, 'normal'\)/);
assert.match(pdf, /function measure\(logicalText, size\)[\s\S]*?return doc\.getTextWidth\(logicalText\)/, 'measure with the same logical text sent to jsPDF');
assert.match(pdf, /doc\.text\(logicalText, PAGE_WIDTH - MARGIN, y, \{ align: 'right' \}\)/);
assert.match(pdf, /addSection\('المشاكل التقنية'\)[\s\S]*?for \(const row of linkedTechnicalIssues\)/,
  'the PDF must render the report-linked technical issue section');
assert.match(provider, /if \(!response\.ok\)[\s\S]*?response\.status === 409 \|\| response\.status >= 500 \? 'unknown' : 'rejected'[\s\S]*?EmailProviderError\('provider_rejected', response\.status, outcome\)/,
  'provider 409/5xx responses must be treated as uncertain, not as a safe new-send opportunity');
assert.match(provider, /provider_receipt_missing/);
assert.match(provider, /Idempotency-Key/);
assert.match(sendOnce, /PROVIDER_KEY_MAX_LENGTH = 256/);
assert.match(sendOnce, /finishSend\(\{ state, providerMessageId: null \}\)/,
  'accepted-but-response-lost outcomes must be recorded as uncertain and retried with the same key');
for (const filename of ['ZamArabicSans-Regular.ttf', 'OFL-Noto.txt']) {
  assert.ok(fs.statSync(path.join(functionDir, 'assets', filename)).size > 0, `${filename} must be present`);
}
assert.match(ui, /await zamClient\.functions\.invoke\('send-report-copy'/);
assert.match(ui, /mailResult\.email_sent !== true/);
assert.match(ui, /تم حفظ التقرير، لكن تعذر تأكيد البريد/);
assert.match(ui, /id="print-saved-report"/);
assert.match(ui, /id="download-saved-report"/);
assert.match(ui, /attachSavedReportPdf\(mailResult\.pdf_base64, mailResult\.pdf_filename\)/);
assert.match(ui, /download\.click\(\)/, 'a generated report PDF must start downloading immediately, with the visible link as fallback');
assert.match(ui, /بدأ تنزيل PDF تلقائيًا/, 'the completion message must tell the supervisor that automatic PDF download was started');
assert.match(ui, /savedReportPrintSnapshot = printSnapshot/);

console.log('send-report-copy function integration static checks: passed');
