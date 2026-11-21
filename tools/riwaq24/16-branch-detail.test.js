const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../branch-detail/index.html'), 'utf8');

test('branch detail preserves auth/role and supervisor branch guards', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Owner','Admin','Manager','Supervisor'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /zamRoleHomePath\(currentUser\.role\)/);
  assert.match(source, /currentUser\.role === 'Supervisor' && branchId !== currentUser\.branch_id/);
  assert.match(source, /branch=\$\{currentUser\.branch_id\}/);
});

test('branch detail keeps the original read APIs, fields, filters and lifecycle semantics', () => {
  for (const contract of [
    "ZamBranchLifecycle.riyadhDateString(new Date())",
    'ZamBranchLifecycle.isOperational(branchRes.data,date)',
    "from('branches').select('name, lifecycle_status, planned_opening_date')",
    "from('checklist_logs').select('*')",
    "eq('branch_id',branchId).eq('execution_date',date)",
    'ZamAPI.getTemplates(null,null,branchId)',
    "from('daily_reports').select('total_sales')",
    "eq('branch_id',branchId).eq('report_date',date)",
    "from('profiles').select('id, full_name')",
    "select('id, full_name').in('id',executorIds)",
    "r.status==='Flagged'",
    'log.photo_url',
    'log.notes'
  ]) assert.ok(source.includes(contract), `missing preserved contract: ${contract}`);
  assert.match(source, /\.order\('created_at',\{ascending:false\}\)/);
  assert.match(source, /new Set\(logs\.map\(l=>l\.template_id\)\)/);
});

test('page offers working date refresh, local search/status/photo filters and retry', () => {
  for (const id of ['date-filter','refresh-btn','search-filter','status-filter','photo-filter','clear-filters','retry-load']) assert.ok(source.includes(`id="${id}"`) || source.includes(`getElementById('${id}')`), `missing interaction: ${id}`);
  assert.match(source, /addEventListener\('change',loadBranchDetail\)/);
  assert.match(source, /function applyFilters\(\)/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /aria-busy/);
  assert.match(source, /البيانات المعروضة قد تكون جزئية/);
});

test('untrusted log values are escaped and image viewer supports keyboard dismissal', () => {
  assert.match(source, /function esc\(value\)/);
  assert.match(source, /esc\(r\.notes\)/);
  assert.match(source, /esc\(r\.executor\|\|'—'\)/);
  assert.match(source, /e\.key==='Escape'/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /aria-live="polite"/);
});

test('inline scripts parse and the shared header is the only notification bell owner', () => {
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
  assert.doesNotMatch(source, /renderNotificationBell\s*\(/);
  assert.doesNotMatch(source, /attachNotificationBellHandlers\s*\(/);
});
