const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const project = path.resolve(__dirname, '..', '..');
const api = fs.readFileSync(path.join(project, 'assets', 'supabase-config.js'), 'utf8');
const permissions = fs.readFileSync(path.join(project, 'permissions', 'index.html'), 'utf8');
const supervisor = fs.readFileSync(path.join(project, 'supervisor-checklist', 'index.html'), 'utf8');

test('shared permission reads require a live Supabase session', () => {
  assert.match(api, /async requireLiveAuth\(expectedProfile = ZamSession\.get\(\)\)/);
  assert.match(api, /await ZamAPI\.requireLiveAuth\(me\);\s*const \{ data, error \} = await zamClient\.from\('admin_permissions'/s);
  assert.match(permissions, /await ZamAPI\.requireLiveAuth\(currentUser\);\s*if \(isOwner\) return 'owner';/s);
});

test('supervisors see checklist history without gaining a global report permission', () => {
  assert.match(api, /key: 'checklist-logs'[\s\S]*?supervisorPerm: null/);
  assert.match(api, /role === 'Supervisor' && Object\.prototype\.hasOwnProperty\.call\(i, 'supervisorPerm'\)/);
  assert.match(supervisor, /async function loadChecklist\(\) \{[\s\S]*?await ZamAPI\.requireLiveAuth\(currentUser\);/);
  assert.match(supervisor, /async function loadRecentNotes\(\) \{[\s\S]*?await ZamAPI\.requireLiveAuth\(currentUser\);/);
});

