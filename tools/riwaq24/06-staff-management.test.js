const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../staff-management/index.html'), 'utf8');
test('legacy staff route redirects to the unified permissions page without loading staff data', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /window\.location\.replace\('\.\.\/permissions\/index\.html#staff-section'\)/);
  assert.match(source, /href="\.\.\/permissions\/index\.html#staff-section"/);
  assert.doesNotMatch(source, /requireAdminPerm|getStaffForManagement|\.from\('profiles'\)|\.from\('admin_permissions'\)/);
});
