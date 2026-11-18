const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'daily-report', 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261118180500_supervisor_technical_issue_branch_updates.sql'), 'utf8');

test('closed customer complaints are not kept in the supervisor follow-up list', () => {
  assert.match(page, /\.or\('status\.is\.null,status\.neq\.مغلقة'\)/);
  assert.match(page, /\.order\('created_at', \{ ascending: false \}\)\.limit\(50\)/);
});

test('supervisors can edit technical issue status while all-branch visibility stays management-only', () => {
  assert.match(page, /const canResolveTechnicalIssues = \['Owner', 'Supervisor', 'Manager', 'Admin'\]/);
  assert.match(page, /const canViewAllTechnicalIssues = \['Owner', 'Manager', 'Admin'\]/);
});

test('database update policy scopes supervisors to their current branch and preserves existing manager policy', () => {
  assert.match(migration, /FOR UPDATE TO authenticated/);
  assert.match(migration, /current_user_role\(\) = 'Supervisor'/);
  assert.match(migration, /branch_id = public\.current_user_branch_id\(\)/);
  assert.match(migration, /Existing Owner\/Admin\/Manager policy remains unchanged/);
  assert.doesNotMatch(migration, /DROP POLICY IF EXISTS "Managers resolve technical issues"/);
});
