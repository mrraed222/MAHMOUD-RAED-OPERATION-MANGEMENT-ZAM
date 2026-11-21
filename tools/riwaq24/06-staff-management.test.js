const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../staff-management/index.html'), 'utf8');

test('staff page keeps authentication and permission gate with searchable branch-scoped data', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /requireAdminPerm\('can_manage_staff'\)/);
  assert.match(source, /ZamAPI\.getBranches\(\)/);
  assert.match(source, /ZamAPI\.getStaff\(\)/);
  assert.match(source, /employee_number/);
  assert.match(source, /branch-filter/);
});

test('responsive staff list exposes loading, empty, error/retry and edit states', () => {
  assert.match(source, /id="staff-list"[\s\S]*?aria-busy="true"/);
  assert.match(source, /لا يوجد موظفون بعد/);
  assert.match(source, /لا توجد نتائج مطابقة/);
  assert.match(source, /role="alert"/);
  assert.match(source, /retry-staff-btn/);
  assert.match(source, /role="listitem"/);
  assert.match(source, /aria-modal="true"/);
});

test('staff edits preserve payload semantics and surface Supabase returned errors', () => {
  assert.match(source, /full_name: document\.getElementById\('edit-name'\)\.value\.trim\(\)/);
  assert.match(source, /email: document\.getElementById\('edit-email'\)\.value\.trim\(\)/);
  assert.match(source, /passcode: document\.getElementById\('edit-passcode'\)\.value\.trim\(\)/);
  assert.match(source, /whatsapp_number: document\.getElementById\('edit-whatsapp'\)\.value\.trim\(\)/);
  assert.match(source, /passcode_reset_requested: false/);
  assert.match(source, /const \{ error \} = await zamClient\.from\('profiles'\)\.update\(payload\)\.eq\('id', id\)/);
  assert.match(source, /if \(error\) throw error/);
});

test('export remains full-staff CSV and passcodes are masked in listing', () => {
  assert.match(source, /ZamAPI\.exportStaffToCSV\(\)/);
  assert.match(source, /•••• \$\{String\(emp\.passcode \|\| ''\)\.slice\(-3\)\}/);
  assert.match(source, /إضافة موظف/);
});
