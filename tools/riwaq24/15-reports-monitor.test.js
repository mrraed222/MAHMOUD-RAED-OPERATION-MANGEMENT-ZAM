const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../reports-monitor/index.html'), 'utf8');
const shared = fs.readFileSync(path.join(__dirname, '../../assets/supabase-config.js'), 'utf8');
const inlineScripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const monitorScript = inlineScripts.at(-1)?.[1].replace(/\ninitializeMonitor\(\);\s*$/, '');

function createMonitorHarness({
  role = 'Owner',
  hasReportsPermission = true,
  branches = [],
  managerBranchResponse = { data: [], error: null },
  rangeSummaryResponse = { data: [], error: null },
  legacySummaryResponse = { data: [], error: null },
  deferredBranches,
  deferredRangeSummary,
} = {}) {
  const elements = new Map();
  const rpcCalls = [];
  const permissionsChecked = [];
  let branchLoads = 0;
  const getElementById = id => {
    if (!elements.has(id)) {
      const element = {
        id,
        value: '',
        disabled: false,
        innerHTML: '',
        listeners: {},
        addEventListener(name, handler) { this.listeners[name] = handler; },
      };
      let textContent = '';
      Object.defineProperty(element, 'textContent', {
        get() { return textContent; },
        set(value) { textContent = String(value); },
      });
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const context = {
    currentUser: { role },
    document: { getElementById },
    ZamBranchLifecycle: {
      riyadhDateString: () => '2026-11-23',
      isOperational: branch => branch.isOperational !== false,
    },
    ZamAPI: {
      async requireAdminPerm(permission) {
        permissionsChecked.push(permission);
        return hasReportsPermission;
      },
      async getBranches() {
        branchLoads += 1;
        if (deferredBranches) return deferredBranches.promise;
        return branches;
      },
    },
    zamClient: {
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        if (name === 'list_manager_daily_summary_branches') return managerBranchResponse;
        if (name === 'get_daily_checklist_summary') {
          if (args.p_date_from && deferredRangeSummary) return deferredRangeSummary.promise;
          return args.p_date_from
            ? rangeSummaryResponse
            : legacySummaryResponse;
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    },
    window: { location: {} },
    zamRoleHomePath: role => `/${role}`,
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(monitorScript, context);
  return {
    context,
    elements,
    rpcCalls,
    permissionsChecked,
    get branchLoads() { return branchLoads; },
    start: () => vm.runInContext('initializeMonitor()', context),
  };
}

test('monitor loads branches and date-range summary together and falls back only for non-Managers', () => {
  assert.match(source, /\['Owner','Admin','Manager'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /async function loadDailyChecklistSummary\(date\)/);
  assert.match(source, /rpc\('get_daily_checklist_summary',\{p_date_from:date,p_date_to:date\}\)/);
  assert.match(source, /if\(currentUser\.role==='Manager'\|\|rangeRes\.error\.code!=='PGRST202'\)throw rangeRes\.error/);
  assert.match(source, /rpc\('get_daily_checklist_summary',\{p_report_date:date\}\)/);
  assert.match(source, /const \[branches,reports\]=await Promise\.all\(/);
  assert.match(source, /staged\(loadDailyChecklistSummary\(date\),'ملخص التقارير'\)/);
  assert.match(source, /رمز الخطأ:/);
  assert.doesNotMatch(source, /from\('daily_reports'\)\.select\('branch_id, shift_type, entry_time'\)/);
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branch,date\)/);
});

test('branch request and summary RPC both start before either deferred response resolves', async () => {
  let resolveBranches;
  let resolveSummary;
  const deferredBranches = {
    promise: new Promise(resolve => { resolveBranches = resolve; }),
  };
  const deferredRangeSummary = {
    promise: new Promise(resolve => { resolveSummary = resolve; }),
  };
  const harness = createMonitorHarness({
    role: 'Manager',
    managerBranchResponse: deferredBranches.promise,
    deferredRangeSummary,
  });

  const loading = harness.start();
  // The Manager path has no permission await, so both RPC starters run before
  // initializeMonitor reaches its first wait on the deliberately pending gates.
  assert.equal(harness.branchLoads, 0, 'Managers must not enumerate all branches');
  assert.deepEqual(harness.rpcCalls.map(call => call.name), [
    'list_manager_daily_summary_branches',
    'get_daily_checklist_summary',
  ]);

  resolveBranches([{ id: 'branch-1', name: 'فرع الاختبار' }]);
  resolveSummary({ data: [], error: null });
  await loading;
});

test('Owner and Admin use their all-reports permission; Managers are authorized by scoped server RPCs', () => {
  const initialization = source.match(/async function initializeMonitor\(\)\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(initialization, 'monitor initialization must gate loading');
  assert.match(initialization, /if\(!currentUser\|\|!\['Owner','Admin','Manager'\]\.includes\(currentUser\.role\)\)return/);
  assert.match(initialization, /currentUser\.role!=='Manager'&&!\(await ZamAPI\.requireAdminPerm\('can_view_all_reports'\)\)/);
  const managerPath = source.match(/const branchPromise=currentUser\.role==='Manager'\s*\?([\s\S]*?):\s*ZamAPI\.getBranches\(\)/)?.[1];
  assert.match(managerPath || '', /rpc\('list_manager_daily_summary_branches'\)/);
  assert.doesNotMatch(managerPath || '', /ZamAPI\.getBranches\(\)/);
  assert.ok(initialization.indexOf('monitorAuthorized=true') < initialization.indexOf('await loadMonitor()'));
  assert.match(source, /async function loadMonitor\(\)\{\s*if\(!monitorAuthorized\)return;/);
});

test('manual refresh, date changes and local sorting stay disabled until authorization and data load', () => {
  assert.match(source, /let monitorAuthorized=false/);
  assert.match(source, /dateInput\.disabled=true/);
  assert.match(source, /refreshButton\.disabled=true/);
  assert.match(source, /sortSelect\.disabled=true/);
  assert.match(source, /dateInput\.addEventListener\('change',loadMonitor\)/);
  assert.match(source, /refreshButton\.addEventListener\('click',loadMonitor\)/);
  assert.match(source, /sortSelect\.addEventListener\('change',renderMonitor\)/);
});

test('stale empty Manager-scope responses cannot replace the selected date result', () => {
  const loadMonitor = source.match(/async function loadMonitor\(\)\{([\s\S]*?)\n\}/)?.[1] || '';
  const staleGuard = loadMonitor.indexOf('if(generation!==monitorLoadGeneration||date!==dateInput.value)return;');
  const emptyScopeMessage = loadMonitor.indexOf("if(currentUser.role==='Manager'&&!branches.length)");
  assert.ok(staleGuard >= 0 && emptyScopeMessage > staleGuard);
});

test('Manager with no configured branch scope receives no fabricated counts and never enumerates all branches', async () => {
  const harness = createMonitorHarness({ role: 'Manager', managerBranchResponse: { data: [], error: null } });
  await harness.start();

  assert.deepEqual(harness.permissionsChecked, [], 'Manager access must not depend on the legacy admin_permissions row');
  assert.deepEqual(harness.rpcCalls.map(call => call.name), [
    'list_manager_daily_summary_branches',
    'get_daily_checklist_summary',
  ]);
  assert.equal(harness.branchLoads, 0, 'Manager must never fall back to all branches');
  assert.equal(harness.elements.get('c-morning-done').textContent, '—');
  assert.equal(harness.elements.get('c-morning-missing').textContent, '—');
  assert.match(harness.elements.get('monitor-feedback').textContent, /نطاق فروع المدير غير مهيأ/);
  assert.equal(harness.elements.get('sort-branches').disabled, true);
});

test('Manager with an authorized scope uses only the summary-scoped branch RPC and range summary', async () => {
  const branch = { id: 'branch-1', name: 'فرع الاختبار' };
  const harness = createMonitorHarness({
    role: 'Manager',
    managerBranchResponse: { data: [branch], error: null },
    rangeSummaryResponse: { data: [{ branch_id: branch.id, shift_type: 'Morning', entry_time: '08:10:00' }], error: null },
  });
  await harness.start();

  assert.deepEqual(harness.rpcCalls.map(call => call.name), [
    'list_manager_daily_summary_branches',
    'get_daily_checklist_summary',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.rpcCalls[1].args)), { p_date_from: '2026-11-23', p_date_to: '2026-11-23' });
  assert.equal(harness.branchLoads, 0);
  assert.equal(harness.elements.get('c-morning-done').textContent, '1');
  assert.equal(harness.elements.get('c-morning-missing').textContent, '0');
  assert.match(harness.elements.get('monitor-feedback').textContent, /اكتمل التحديث/);
});

test('Owner recovers from an unavailable range signature using the tracked single-date RPC', async () => {
  const branch = { id: 'branch-1', name: 'فرع الاختبار' };
  const harness = createMonitorHarness({
    role: 'Owner',
    branches: [branch],
    rangeSummaryResponse: { data: null, error: { code: 'PGRST202', message: 'Function signature not found' } },
    legacySummaryResponse: { data: [{ branch_id: branch.id, shift_type: 'Morning', entry_time: '08:10:00' }], error: null },
  });
  await harness.start();

  assert.deepEqual(harness.permissionsChecked, ['can_view_all_reports']);
  assert.deepEqual(harness.rpcCalls.map(call => call.name), [
    'get_daily_checklist_summary',
    'get_daily_checklist_summary',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.rpcCalls[0].args)), { p_date_from: '2026-11-23', p_date_to: '2026-11-23' });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.rpcCalls[1].args)), { p_report_date: '2026-11-23' });
  assert.equal(harness.elements.get('c-morning-done').textContent, '1');
  assert.equal(harness.elements.get('c-evening-missing').textContent, '1');
});

test('Managers do not fall back to the legacy summary or branch APIs when a scoped RPC is missing', async () => {
  const branch = { id: 'branch-1', name: 'فرع الاختبار' };
  const harness = createMonitorHarness({
    role: 'Manager',
    managerBranchResponse: { data: [branch], error: null },
    rangeSummaryResponse: { data: null, error: { code: 'PGRST202', message: 'Function signature not found' } },
  });
  await harness.start();

  assert.deepEqual(harness.rpcCalls.map(call => call.name), [
    'list_manager_daily_summary_branches',
    'get_daily_checklist_summary',
  ]);
  assert.equal(harness.branchLoads, 0);
  assert.equal(harness.elements.get('c-morning-done').textContent, '—');
  assert.match(harness.elements.get('monitor-feedback').textContent, /لم تُعرض أرقام/);
});

test('monitor error copy identifies the failing stage without exposing raw server messages', () => {
  assert.match(source, /const stage=failure\?\.stage\|\|'تحميل البيانات'/);
  assert.match(source, /const code=String\(err\?\.code\|\|''\)\.match/);
  assert.doesNotMatch(source, /showMonitorMessage\(err\.message/);
});

test('date, refresh and sorting are actionable with accessible responsive output', () => {
  assert.match(source, /id="check-date"/);
  assert.match(source, /id="refresh-monitor"/);
  assert.match(source, /id="sort-branches"/);
  assert.match(source, /sortSelect\.disabled=false/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /id="monitor-mobile"/);
  assert.match(source, /escapeHtml\(x\.branch\.name\)/);
});

test('only the main dashboard is marked as the page allowed to mount the notification bell', () => {
  assert.match(shared, /window\.__zamActiveSidebarKey = activeKey/);
  assert.match(shared, /window\.__zamActiveSidebarKey === 'dashboard'/);
  assert.match(shared, /if \(!showNotifications\) notificationSlot\?\.remove\(\)/);
  assert.match(shared, /if \(showNotifications\) refreshNotificationBell\(\)\.catch/);
  assert.match(source, /renderZamSidebar\('reports-monitor'/);
  assert.doesNotMatch(source, /id="notif-bell-slot"/);
});
