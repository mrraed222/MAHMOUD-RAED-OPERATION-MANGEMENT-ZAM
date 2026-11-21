const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../checklist-logs/index.html'), 'utf8');

test('checklist log preserves auth/role guards and existing read sources and filters', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Owner','Admin','Manager','Supervisor'\]\.includes\(currentUser\.role\)/);
  for (const api of ['getBranches', 'getChecklistLogs', 'getHourlyChecklistLogs', 'getTeamNotes', 'getFridgeReadings']) {
    assert.match(source, new RegExp(`ZamAPI\\.${api}\\(`));
  }
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branch, row\.execution_date/);
  assert.match(source, /currentUser\.role === 'Supervisor'/);
  for (const id of ['f-branch', 'f-date', 'f-shift']) assert.match(source, new RegExp(`id="${id}"`));
});

test('record gallery/table, secure image URLs, image dialog and status states are accessible', () => {
  assert.match(source, /function safeImageUrl\(/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /aria-pressed="true"/);
  assert.match(source, /إعادة المحاولة/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /إجمالي المهام لا يعني تحقق حالة الإنجاز/);
});

test('all inline JavaScript parses', () => {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of scripts.entries()) {
    if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index + 1}`);
  }
});
