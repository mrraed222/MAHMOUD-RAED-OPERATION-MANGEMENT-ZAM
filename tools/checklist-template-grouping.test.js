const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'assets', 'supabase-config.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'manage-templates', 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261118182000_consolidate_checklist_template_groups.sql'), 'utf8');

const branchHelper = api.match(/function zamTemplateBranchIds\(template\) \{[\s\S]*?\n\}/);
assert.ok(branchHelper, 'template branch helper must remain available');
const functionStart = page.indexOf('function collapseActiveTemplateGroups(templates) {');
const functionEnd = page.indexOf('\n\nasync function loadTemplates()', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'active-template grouping helper must be present');
const groupingFunction = page.slice(functionStart, functionEnd);
const context = vm.createContext({});
vm.runInContext(`${branchHelper[0]}\n${groupingFunction}\nthis.collapseActiveTemplateGroups = collapseActiveTemplateGroups;`, context);

function host(value) {
  return JSON.parse(JSON.stringify(value));
}

const base = {
  task_title: 'فحص الطاولات', category: 'الصالة', shift_type: 'Morning',
  instructions: 'فحص وتنظيف', requires_photo: true, target_time: '08:00:00',
  frequency: 'weekly', day_of_week: 1, days_of_week: [1, 3], day_of_month: null,
  allows_notes: true, task_type: 'standard', sort_order: 4, is_active: true,
};

test('exact active definitions across branches render as one grouped card with unioned scope', () => {
  const grouped = host(context.collapseActiveTemplateGroups([
    { ...base, id: 'b', branch_id: 'branch-b', created_at: '2026-11-02', checklist_template_branches: [] },
    { ...base, id: 'a', branch_id: 'branch-a', created_at: '2026-11-01', checklist_template_branches: [] },
  ]));
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].groupTemplateIds, ['a', 'b']);
  assert.deepEqual(grouped[0].groupBranchIds, ['branch-a', 'branch-b']);
  assert.equal(grouped[0].id, 'a', 'primary id selection must be deterministic');
});

test('different recurrence, instructions, shift, or global scope are not merged', () => {
  const variants = [
    { ...base, id: 'base', branch_id: 'branch-a' },
    { ...base, id: 'frequency', branch_id: 'branch-b', frequency: 'daily' },
    { ...base, id: 'instructions', branch_id: 'branch-c', instructions: 'ملاحظة مختلفة' },
    { ...base, id: 'shift', branch_id: 'branch-d', shift_type: 'Evening' },
    { ...base, id: 'global', branch_id: null, checklist_template_branches: [] },
  ];
  const grouped = host(context.collapseActiveTemplateGroups(variants));
  assert.equal(grouped.length, 5);
});

test('branch-specific equipment templates remain separate for their existing single-branch controls', () => {
  const templates = [
    { ...base, id: 'fridge-a', branch_id: 'branch-a', task_type: 'fridge_temps' },
    { ...base, id: 'fridge-b', branch_id: 'branch-b', task_type: 'fridge_temps' },
  ];
  assert.equal(context.collapseActiveTemplateGroups(templates).length, 2);
});

test('group editing and archiving use atomic RPCs without deleting historical template rows or logs', () => {
  assert.match(page, /saveTemplateGroupWithBranches\(editingTemplateIds, payload, selectedBranchIds, allBranches\)/);
  assert.match(page, /deleteTemplateGroup\(templateIds\)/);
  assert.match(api, /save_checklist_template_group_with_branches/);
  assert.match(api, /archive_checklist_template_group/);
  assert.match(migration, /public\.save_checklist_template_with_branches\(/);
  assert.match(migration, /SET is_active = false/);
  assert.match(migration, /has_admin_permission\('templates'\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.checklist_templates|DELETE\s+FROM\s+public\.checklist_logs|TRUNCATE/i);
  assert.match(migration, /لا يمكن دمج قوالب تختلف إعداداتها/);
});
