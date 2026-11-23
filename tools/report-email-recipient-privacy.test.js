const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dailyReportEmail = fs.readFileSync(path.join(root, 'supabase/functions/send-report-copy/index.ts'), 'utf8');
const visitReportEmail = fs.readFileSync(path.join(root, 'supabase/functions/visit-report-pdf/index.ts'), 'utf8');

test('daily report copy puts individual recipients in BCC, not a shared To list', () => {
  assert.match(dailyReportEmail, /to: 'operations@zam\.sa',\s*bcc: recipients\.filter\(\(email\) => email !== 'operations@zam\.sa'\)/);
  const payload = dailyReportEmail.match(/const payload = \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.ok(payload);
  assert.doesNotMatch(payload, /to:\s*recipients/);
});

test('visit report copy uses BCC and the message body does not disclose recipient addresses', () => {
  assert.match(visitReportEmail, /to: 'operation@zam\.sa', bcc: recipients\.filter/);
  const html = visitReportEmail.match(/function emailHtml\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(html);
  assert.doesNotMatch(html, /recipients|المستلمون/);
});
