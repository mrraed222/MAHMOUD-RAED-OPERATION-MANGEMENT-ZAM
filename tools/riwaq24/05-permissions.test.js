const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../permissions/index.html'), 'utf8');
const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
const sharedSource = fs.readFileSync(path.join(__dirname, '../../assets/supabase-config.js'), 'utf8');

test('owner-only gate and page-access permissions retain the existing role and key contracts', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /currentUser\.role !== 'Owner'/);
  const keys = [...source.matchAll(/key: '(can_[a-z_]+)'/g)].map(match => match[1]);
  assert.deepEqual(keys, [
    'can_manage_staff', 'can_manage_branches', 'can_manage_templates',
    'can_manage_automations', 'can_manage_reports', 'can_manage_branch_visits',
    'can_review_visit_actions', 'can_manage_inventory', 'can_view_all_reports'
  ]);
  assert.match(script, /zamClient\.from\('admin_permissions'\)\.upsert\(payload\)/);
  assert.match(script, /zamClient\.from\('admin_permissions'\)\.select\('\*'\)/);
});

test('task-category assignment remains an independent employee_task_categories workflow', () => {
  assert.match(script, /ZamAPI\.getTaskCategories\(empId\)/);
  assert.match(script, /ZamAPI\.replaceTaskCategories\(empId,selectedCats\)/);
  assert.match(script, /await zamClient\.from\('admin_permissions'\)\.upsert\(payload\)[\s\S]*?await ZamAPI\.replaceTaskCategories\(empId,selectedCats\)/);
  assert.match(source, /فئات قوائم المهام المسندة/);
  assert.match(source, /الصلاحيات الإدارية/);
});

test('partial task-category saves keep previous assignments when adding a category fails', () => {
  const start = sharedSource.indexOf('async replaceTaskCategories(profileId, categories) {');
  const end = sharedSource.indexOf('\n    },', start);
  const method = sharedSource.slice(start, end);
  assert.match(method, /await ZamAPI\.getTaskCategories\(profileId\)/);
  assert.match(method, /insert\(rows\)[\s\S]*?delete\(\)[\s\S]*?\.in\('category', categoriesToRemove\)/);
  assert.match(script, /الفئات السابقة لم تُحذف/);
});

test('role, branch, shift, reports flag and inventory branch scope keep their existing data semantics', () => {
  assert.match(script, /role:card\.querySelector\('\.role-select'\)\.value/);
  assert.match(script, /branch_id:card\.querySelector\('\.branch-select'\)\.value\|\|null/);
  assert.match(script, /shift_type:card\.querySelector\('\.shift-select'\)\.value/);
  assert.match(script, /receives_branch_reports:card\.querySelector\('\.p-reports-check'\)\.checked/);
  assert.match(script, /payload\.can_view_all_inventory=!!payload\.can_manage_inventory&&scopeMode==='all'/);
  assert.match(script, /payload\.inventory_branch_ids=payload\.can_manage_inventory&&scopeMode==='selected'\?selected:\[\]/);
  assert.match(script, /selected\.length\)/);
});

test('review, account editing and employee editing expose loading, empty, error and success feedback', () => {
  assert.match(source, /جارٍ تحميل طلبات التسجيل/);
  assert.match(script, /لا توجد طلبات تسجيل معلّقة حاليًا/);
  assert.match(script, /تعذّر تحميل بيانات الإدارة/);
  assert.match(script, /تم حفظ بيانات الحساب/);
  assert.match(script, /تم حفظ التغييرات/);
  assert.match(script, /إعادة المحاولة/);
  assert.match(source, /aria-live="polite"/);
});

test('screen is restructured for mobile cards, accessible permission dialog and real actions', () => {
  assert.match(source, /class="pending-card"/);
  assert.match(source, /class="staff-card"/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(script, /e\.key==='Escape'/);
  assert.match(script, /btn\.addEventListener\('click'/);
  assert.match(source, /href="\.\.\/register\/index\.html"/);
  assert.match(source, /@media\(max-width:760px\)/);
  assert.doesNotMatch(source, /id="notif-bell-slot"/);
});
