const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'assets', 'supabase-config.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'manage-templates', 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'drafts', 'add_checklist_template_branch_scopes.sql'), 'utf8');
const plan = fs.readFileSync(path.join(root, 'supabase', 'drafts', 'checklist-template-branch-scopes-plan.md'), 'utf8');

const helpers = api.match(/function zamTemplateBranchIds\(template\) \{[\s\S]*?\n\}\n\nfunction zamTemplateAppliesToBranch\(template, branchId\) \{[\s\S]*?\n\}/);
assert.ok(helpers, 'branch scope helpers must remain defined in the API file');
const scopeContext = vm.createContext({});
vm.runInContext(`${helpers[0]}\nthis.zamTemplateBranchIds = zamTemplateBranchIds;\nthis.zamTemplateAppliesToBranch = zamTemplateAppliesToBranch;`, scopeContext);

function hostArray(value) {
  return JSON.parse(JSON.stringify(value));
}

test('linked multi-branch scopes are authoritative over the legacy fallback', () => {
  const template = {
    branch_id: 'legacy-branch',
    checklist_template_branches: [{ branch_id: 'branch-a' }, { branch_id: 'branch-b' }, { branch_id: 'branch-a' }]
  };
  assert.deepEqual(hostArray(scopeContext.zamTemplateBranchIds(template)), ['branch-a', 'branch-b']);
  assert.equal(scopeContext.zamTemplateAppliesToBranch(template, 'branch-a'), true);
  assert.equal(scopeContext.zamTemplateAppliesToBranch(template, 'branch-b'), true);
  assert.equal(scopeContext.zamTemplateAppliesToBranch(template, 'legacy-branch'), false);
});

test('legacy single-branch and global templates remain compatible', () => {
  const singleBranch = { branch_id: 'branch-a', checklist_template_branches: [] };
  const globalTemplate = { branch_id: null, checklist_template_branches: [] };
  assert.deepEqual(hostArray(scopeContext.zamTemplateBranchIds(singleBranch)), ['branch-a']);
  assert.equal(scopeContext.zamTemplateAppliesToBranch(singleBranch, 'branch-a'), true);
  assert.equal(scopeContext.zamTemplateAppliesToBranch(singleBranch, 'branch-b'), false);
  assert.deepEqual(hostArray(scopeContext.zamTemplateBranchIds(globalTemplate)), []);
  assert.equal(scopeContext.zamTemplateAppliesToBranch(globalTemplate, 'branch-a'), true);
  assert.equal(scopeContext.zamTemplateAppliesToBranch(globalTemplate, null), true);
});

test('draft UI requires an explicit scope and submits selected branch ids through one atomic RPC', () => {
  assert.match(page, /id="f-scope-all"/);
  assert.match(page, /id="f-scope-selected"/);
  assert.match(page, /class="f-branch-checkbox/);
  assert.match(page, /if \(!allBranches && !selectedBranchIds\.length\)/);
  assert.match(page, /saveTemplateWithBranches\(editingId, payload, selectedBranchIds, allBranches\)/);
  assert.match(api, /save_checklist_template_with_branches/);
  assert.doesNotMatch(page, /index === 0 \? 'open'/);
});

test('draft migration backfills existing non-global versions without editing their rows', () => {
  assert.match(migration, /INSERT INTO public\.checklist_template_branches \(template_id, branch_id\)[\s\S]*?SELECT t\.id, t\.branch_id[\s\S]*?WHERE t\.branch_id IS NOT NULL/i);
  assert.match(migration, /ON DELETE RESTRICT/i);
  assert.match(migration, /has_admin_permission\('templates'\)/i);
  assert.match(migration, /public\.version_checklist_template\(p_template_id, v_payload\)/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.checklist_templates|DELETE\s+FROM\s+public\.checklist_templates|DROP\s+(?:TABLE|COLUMN)\b/i);
  assert.match(plan, /لم يتغير نص أي قالب أو دور أو إسناد موظف/);
  assert.match(plan, /75 رابطًا/);
});
