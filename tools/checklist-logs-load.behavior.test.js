const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schedule = require('../assets/checklist-schedule.js');
const metrics = require('../assets/checklist-log-metrics.js');

const source = fs.readFileSync(path.join(__dirname, '../checklist-logs/index.html'), 'utf8');
const start = source.indexOf('async function loadLogs() {');
const end = source.indexOf('\nfunction closeImageModal()', start);
assert.ok(start >= 0 && end > start, 'loadLogs is extractable for an isolated behavioral test');
const loadLogsSource = source.slice(start, end);

const branches = [
  { id: 'branch-a', name: 'زام الرئيسي', lifecycle_status: 'open' },
  { id: 'branch-b', name: 'زام الحي', lifecycle_status: 'open' }
];
const fixtures = {
  logs: branches.map((branch, i) => ({
    id: `normal-${i}`, branch_id: branch.id, execution_date: '2026-11-28',
    created_at: '2026-11-28T08:00:00Z', shift_type: 'Morning', status: 'Completed',
    checklist_templates: { task_title: `مهمة عادية ${i}`, category: 'الصالة', shift_type: 'Morning' },
    profiles: { full_name: `موظف ${i}`, role: 'Waiter' }, notes: 'اكتمل'
  })),
  hourlyLogs: [{
    id: 'hourly-a', branch_id: 'branch-a', execution_date: '2026-11-28', occurrence_hour: 10,
    created_at: '2026-11-28T10:00:00Z', shift_type: 'Morning', status: 'Completed',
    checklist_templates: { task_title: 'قراءة ساعية', shift_type: 'Morning' },
    steps_completed: { clean: true }, profiles: { full_name: 'مشرف', role: 'Supervisor' }
  }],
  teamNotes: [{
    id: 'note-a', branch_id: 'branch-a', execution_date: '2026-11-28',
    created_at: '2026-11-28T11:00:00Z', shift_type: 'Morning', note: 'ملاحظة مستقلة',
    profiles: { full_name: 'مشرف', role: 'Supervisor' }
  }],
  fridgeReadings: [{
    id: 'fridge-a', branch_id: 'branch-a', created_at: '2026-11-28T12:00:00Z',
    temperature: 3.5, status: 'normal', shift_type: 'Morning', note: 'طبيعي',
    fridges: { kind: 'fridge', number: 1, name: 'التحضير' },
    profiles: { full_name: 'مشرف', role: 'Supervisor' }, branches: { name: 'زام الرئيسي' }
  }]
};

class ElementMock {
  constructor(id) {
    this.id = id; this.value = ''; this.innerHTML = ''; this.disabled = false;
    this.attributes = new Map(); this.classList = { add() {}, remove() {} };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
}

async function runLoad({ role, branchId = 'branch-a', failSource = null, taskType = 'all' }) {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, new ElementMock(id));
    return elements.get(id);
  };
  const calls = [];
  const status = [];
  const scopedRows = key => (fixtures[key] || []).filter(row => {
    const requested = calls.at(-1)?.args?.branchId;
    return !requested || row.branch_id === requested;
  });
  const api = {};
  for (const sourceName of ['logs', 'hourlyLogs', 'teamNotes', 'fridgeReadings']) {
    const method = ({ logs: 'getChecklistLogs', hourlyLogs: 'getHourlyChecklistLogs', teamNotes: 'getTeamNotes', fridgeReadings: 'getFridgeReadings' })[sourceName];
    api[method] = async args => {
      calls.push({ source: sourceName, args });
      if (sourceName === failSource) throw new Error(`mock ${sourceName} failure`);
      const requested = args.branchId;
      return (fixtures[sourceName] || []).filter(row => !requested || row.branch_id === requested);
    };
  }
  api.getTemplates = async (_category, _shift, requestedBranch) => {
    calls.push({ source: 'templates', args: { branchId: requestedBranch } });
    return [{ id: `hourly-${requestedBranch}`, branch_id: requestedBranch, frequency: 'hourly', task_type: 'restroom_check', shift_type: 'Both', is_active: true }];
  };
  const currentUser = { role, branch_id: branchId };
  const elementsForFilter = getElementById('f-branch');
  elementsForFilter.value = role === 'Owner' ? '' : branchId;
  getElementById('f-date').value = '2026-11-28';
  getElementById('f-shift').value = '';
  getElementById('f-task-type').value = taskType;

  const context = {
    currentUser,
    branchesCache: branches,
    tableView: getElementById('table-view'),
    checklistStatus: getElementById('checklist-status'),
    document: {
      getElementById,
      querySelectorAll: () => []
    },
    ZamAPI: api,
    ZamBranchLifecycle: { isOperational: () => true },
    ZamChecklistLogMetrics: metrics,
    ZamChecklistSchedule: schedule,
    ZamRestroomHourly: {
      STEPS: [{ key: 'clean', label: 'تنظيف' }],
      isRestroomHourlyTask: task => task?.frequency === 'hourly' && task?.task_type === 'restroom_check'
    },
    escHtml: value => String(value ?? ''),
    safeImageUrl: value => value ? String(value) : '',
    riyadhDateTime: value => String(value || '—'),
    shiftLabel: value => value === 'Morning' ? 'صباحي' : value === 'Evening' ? 'مسائي' : '—',
    showChecklistLogsLoadStatus: (message, options) => status.push({ message, options }),
    console: { error() {} },
    Promise,
    Set,
    Date,
    String,
    Number,
    Array,
    URL,
    location: { origin: 'https://example.test' }
  };
  vm.createContext(context);
  await vm.runInContext(`${loadLogsSource}\nloadLogs();`, context);
  return { elements, calls, status };
}

test('loadLogs renders task, hourly, independent team-note and fridge rows for Owner, Manager and branch-scoped Supervisor', async () => {
  for (const role of ['Owner', 'Manager', 'Supervisor']) {
    const { elements, calls } = await runLoad({ role });
    const table = elements.get('logs-table-tbody').innerHTML;
    const summary = elements.get('branch-shift-summary').innerHTML;
    const readings = elements.get('fridge-readings-tbody').innerHTML;
    assert.match(table, /مهمة عادية 0/);
    assert.match(table, /مهمة ساعية مكتملة/);
    assert.match(table, /ملاحظة مستقلة/);
    assert.doesNotMatch(table, /undefined/);
    assert.match(summary, /زام الرئيسي/);
    assert.match(summary, /الصباحية/);
    assert.match(summary, /المسائية/);
    assert.match(readings, /3\.5°/);
    const logCall = calls.find(call => call.source === 'logs');
    assert.equal(logCall.args.branchId, role === 'Owner' ? null : 'branch-a');
    if (role === 'Supervisor') assert.equal(logCall.args.branchId, 'branch-a');
    const templateBranches = calls.filter(call => call.source === 'templates').map(call => call.args.branchId);
    assert.ok(templateBranches.every(id => id === 'branch-a' || role === 'Owner' && id === 'branch-b'));
  }
});

test('task-type filter separates hourly and ordinary tasks while leaving hourly counters and fridge readings intact', async () => {
  const hourly = await runLoad({ role: 'Owner', taskType: 'hourly' });
  const hourlyTable = hourly.elements.get('logs-table-tbody').innerHTML;
  assert.match(hourlyTable, /قراءة ساعية/);
  assert.doesNotMatch(hourlyTable, /مهمة عادية|ملاحظة مستقلة/);
  assert.match(hourly.elements.get('branch-shift-summary').innerHTML, /الصباحية[\s\S]*المسائية/);
  assert.match(hourly.elements.get('fridge-readings-tbody').innerHTML, /3\.5°/);

  const ordinary = await runLoad({ role: 'Owner', taskType: 'non-hourly' });
  const ordinaryTable = ordinary.elements.get('logs-table-tbody').innerHTML;
  assert.match(ordinaryTable, /مهمة عادية 0/);
  assert.doesNotMatch(ordinaryTable, /قراءة ساعية|ملاحظة مستقلة/);
  assert.match(ordinary.elements.get('branch-shift-summary').innerHTML, /الصباحية[\s\S]*المسائية/);

  const both = await runLoad({ role: 'Owner', taskType: 'all' });
  const allRows = both.elements.get('logs-table-tbody').innerHTML;
  assert.match(allRows, /مهمة عادية 0/);
  assert.match(allRows, /قراءة ساعية/);
  assert.match(allRows, /ملاحظة مستقلة/);
});

test('a partial team-note read failure preserves other log rows and displays an explicit partial-results warning', async () => {
  const { elements, status } = await runLoad({ role: 'Owner', failSource: 'teamNotes' });
  const table = elements.get('logs-table-tbody').innerHTML;
  assert.match(table, /مهمة عادية 0/);
  assert.doesNotMatch(table, /ملاحظة مستقلة/);
  assert.ok(status.some(entry => entry.options?.isError && /ملاحظات الفريق/.test(entry.message)));
});

test('a failed hourly source does not report confident counters', async () => {
  const { elements } = await runLoad({ role: 'Owner', failSource: 'hourlyLogs' });
  assert.match(elements.get('branch-shift-summary').innerHTML, /تعذّر التحقق من سجلات أو قوالب المهام الساعية/);
});
