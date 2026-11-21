const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../weekly-report/index.html'), 'utf8');

test('weekly report retains owner-only guard, existing data modules and primary actions', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /renderZamSidebar\('weekly-report',currentUser\.role\)/);
  assert.match(source, /data-zam-header-tools/);
  assert.match(source, /ZAM_WEEKLY_ROLES = \['Owner'\]/);
  assert.match(source, /ZamWeeklyReport\.init\(\{/);
  for (const id of ['reloadBtn', 'saveSnapshotBtn', 'printBtn', 'rangeChips', 'branchChips', 'shiftChips', 'snapshotsList']) {
    assert.match(source, new RegExp(`id="${id}"`));
  }
  assert.match(source, /weekly-report-metrics\.js/);
  assert.match(source, /weekly-report-core\.js/);
});

test('weekly report gives filter scope and page states accessible labels without changing workflows', () => {
  assert.match(source, /id="filtersTitle"/);
  assert.match(source, /id="srcLabel" role="status" aria-live="polite"/);
  assert.match(source, /id="emptyState"/);
  assert.match(source, /id="toast"[^>]*role="status" aria-live="polite"/);
  assert.match(source, /contenteditable="true"/);
  assert.match(source, /aria-labelledby="snapshotsTitle"/);
});

test('both sales trend and branch tables/visuals are explicitly kept whole in print', () => {
  assert.match(source, /#chartTrend, #chartBranch \{ max-height:none !important; height:auto !important; overflow:visible !important; \}/);
  assert.match(source, /#panes \.sales-table thead \{ display:table-header-group !important; \}/);
  assert.match(source, /#panes \.sales-table tr \{ break-inside:avoid !important; page-break-inside:avoid !important; \}/);
  assert.match(source, /#panes \.overflow-x-auto \{ overflow:visible !important; max-height:none !important; \}/);
});

test('all inline JavaScript parses', () => {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of scripts.entries()) {
    if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index + 1}`);
  }
});
