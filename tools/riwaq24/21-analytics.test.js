const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../analytics/index.html'), 'utf8');

test('analytics preserves local role and permission guards and existing sources', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Owner','Admin','Manager'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /ZamAPI\.requireAdminPerm\('can_view_all_reports'\)/);
  for (const api of ['getBranches', 'getAnalyticsReports', 'getWasteLogs', 'getShiftIssues', 'getAnalyticsTechnicalIssues']) {
    assert.match(source, new RegExp(`ZamAPI\\.${api}\\(`));
  }
  assert.match(source, /Promise\.allSettled\(/);
  assert.match(source, /ZamAnalyticsCore\.summarizeSales/);
  assert.match(source, /ZamAnalyticsCore\.combineIssueSources/);
  assert.match(source, /XLSX\.writeFile/);
});

test('analytics provides labelled date filters, independent status and input validation', () => {
  for (const id of ['f-branch', 'f-preset', 'f-month', 'f-from', 'f-to']) {
    assert.match(source, new RegExp(`<label for="${id}"`));
  }
  assert.match(source, /id="analytics-status"[^>]*role="status" aria-live="polite"/);
  assert.match(source, /fromValue > toValue/);
  assert.match(source, /اكتمل التحديث مع تعذّر قراءة/);
  assert.match(source, /aria-busy/);
  assert.match(source, /تعذّر تحميل قائمة الفروع/);
});

test('all inline JavaScript parses', () => {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of scripts.entries()) {
    if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index + 1}`);
  }
});
