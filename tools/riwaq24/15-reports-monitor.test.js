const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../reports-monitor/index.html'), 'utf8');

test('monitor retains exact role and permission guards and report query contract', () => {
  assert.match(source, /\['Owner','Admin','Manager'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /currentUser\.role==='Manager'\?'can_view_daily_checklist_summary':'can_view_all_reports'/);
  assert.match(source, /zamClient\.rpc\('get_daily_checklist_summary',\{p_report_date:date\}\)/);
  assert.doesNotMatch(source, /from\('daily_reports'\)\.select\('branch_id, shift_type, entry_time'\)/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branch,date\)/);
  assert.match(source, /shift_type==='Morning'/);
  assert.match(source, /shift_type==='Evening'/);
});

test('branch and report queries start only after authenticated role permission resolves true', () => {
  const initialization = source.match(/async function initializeMonitor\(\)\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(initialization, 'monitor initialization must gate loading');
  assert.match(initialization, /if\(!currentUser\|\|!\['Owner','Admin','Manager'\]\.includes\(currentUser\.role\)\)return/);
  assert.match(initialization, /const permission=currentUser\.role==='Manager'\?'can_view_daily_checklist_summary':'can_view_all_reports';[\s\S]*?if\(!\(await ZamAPI\.requireAdminPerm\(permission\)\)\)/);
  assert.ok(initialization.indexOf('await ZamAPI.requireAdminPerm') < initialization.indexOf('await loadMonitor()'));
  assert.doesNotMatch(source, /(?<!await )loadMonitor\(\);/);
});

test('manual refresh and date changes cannot bypass the permission check while it is pending', () => {
  const initialization = source.match(/async function initializeMonitor\(\)\{([\s\S]*?)\n\}/)?.[1];
  assert.match(source, /let monitorAuthorized=false/);
  assert.match(source, /dateInput\.disabled=true/);
  assert.match(source, /document\.getElementById\('refresh-monitor'\)\.disabled=true/);
  assert.match(source, /async function loadMonitor\(\)\{\s*if\(!monitorAuthorized\)return;/);
  assert.ok(initialization.indexOf('await ZamAPI.requireAdminPerm') < initialization.indexOf('monitorAuthorized=true'));
  assert.ok(initialization.indexOf('monitorAuthorized=true') < initialization.indexOf('await loadMonitor()'));
});

test('monitor distinguishes missing records from lateness and exposes report read errors', () => {
  assert.match(source, /لم يُسجّل/);
  assert.match(source, /لا تشير إلى التأخر عن موعد تسليم/);
  assert.match(source, /if\(reportsRes\.error\)throw reportsRes\.error/);
  assert.match(source, /currentUser\.role==='Manager'[\s\S]*?zamClient\.rpc\('list_manager_report_branches'\)/);
  assert.match(source, /if\(branchesRes\.error\)throw branchesRes\.error/);
  assert.match(source, /تعذّر تحميل البيانات/);
  assert.match(source, /لا توجد فروع تشغيلية لعرضها/);
});

test('date, refresh and local sorting are actionable with accessible status and responsive list', () => {
  assert.match(source, /id="check-date"/);
  assert.match(source, /id="refresh-monitor"/);
  assert.match(source, /addEventListener\('click',loadMonitor\)/);
  assert.match(source, /id="sort-branches"/);
  assert.match(source, /addEventListener\('change',renderMonitor\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /id="monitor-mobile"/);
  assert.match(source, /escapeHtml\(x\.branch\.name\)/);
});
