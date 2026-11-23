const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'assets/supabase-config.js'), 'utf8');
const analytics = fs.readFileSync(path.join(root, 'analytics/index.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'dashboard/index.html'), 'utf8');

function method(name) {
  const start = config.indexOf(`    async ${name}(`);
  const end = config.indexOf('\n    },', start);
  assert.ok(start >= 0 && end > start, `method ${name} is present`);
  return config.slice(start, end + 6).trim();
}

test('shift issue filters use the parent report branch and report date', async () => {
  const calls = [];
  const query = {};
  for (const name of ['select', 'order', 'eq', 'gte', 'lte']) {
    query[name] = (...args) => { calls.push([name, ...args]); return query; };
  }
  const api = vm.runInNewContext(`({${method('getShiftIssues')}})`, {
    zamClient: { from: table => { calls.push(['from', table]); return query; } },
    readAllRows: fn => fn(),
  });
  await api.getShiftIssues({ branchId: 'branch-1', dateFrom: '2026-11-01', dateTo: '2026-11-23' });
  assert.deepEqual(calls[0], ['from', 'shift_issues']);
  assert.match(calls.find(call => call[0] === 'select')[1], /daily_reports!inner\(branch_id, report_date, shift_type, branches\(name\)\)/);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'daily_reports.branch_id' && call[2] === 'branch-1'));
  assert.ok(calls.some(call => call[0] === 'gte' && call[1] === 'daily_reports.report_date' && call[2] === '2026-11-01'));
  assert.ok(calls.some(call => call[0] === 'lte' && call[1] === 'daily_reports.report_date' && call[2] === '2026-11-23'));
  assert.ok(!calls.some(call => ['eq', 'gte', 'lte'].includes(call[0]) && call[1] === 'branch_id'));
});

test('unconfigured Manager scope throws and sends no read or write requests', async () => {
  let requests = 0;
  const api = vm.runInNewContext(`({${method('getManagerReportScopes')},${method('saveManagerReportScope')}})`, {
    zamClient: { from() { requests++; }, rpc() { requests++; } },
  });
  for (const run of [() => api.getManagerReportScopes(), () => api.saveManagerReportScope('p', 'all')]) {
    await assert.rejects(run(), error => error.code === 'MANAGER_SCOPE_UNCONFIGURED' && /غير مهيأة/.test(error.message));
  }
  assert.equal(requests, 0);
});

test('analytics prevents Manager requests without configured scope and waits for authorization', () => {
  assert.match(analytics, /let analyticsAuthorized = false/);
  assert.match(analytics, /async function applyFilters\(\) \{\s*if \(!analyticsAuthorized\) return/);
  assert.match(analytics, /await ZamAPI\.requireAdminPerm\(permission\)[\s\S]*?currentUser\.role === 'Manager'[\s\S]*?MANAGER_SCOPE_UNCONFIGURED[\s\S]*?await loadBranches\(\)/);
  assert.match(analytics, /error\?\.code === 'MANAGER_SCOPE_UNCONFIGURED' \? error\.message/);
  assert.match(dashboard, /from\('shift_issues'\)\.select\('id, created_at, daily_reports!inner\(branch_id\)'\)/);
  assert.doesNotMatch(dashboard, /from\('shift_issues'\)\.select\('id, branch_id'\)/);
});
