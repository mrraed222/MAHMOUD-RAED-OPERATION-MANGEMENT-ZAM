const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('shared modal focus helper saves/restores inert state and traps forward/reverse Tab', () => {
  const config = read('assets/supabase-config.js');
  assert.match(config, /window\.zamEnableModalFocus\s*=\s*function/);
  assert.match(config, /sibling\.inert = true/);
  assert.match(config, /inertStates\.forEach\(\(\[element, wasInert\]\) => \{ if \(element\.isConnected\) element\.inert = wasInert/);
  assert.match(config, /event\.shiftKey[\s\S]*?last\.focus\(\)/);
  assert.match(config, /!event\.shiftKey[\s\S]*?first\.focus\(\)/);
  assert.match(config, /opener\?\.isConnected\) opener\.focus/);
});

test('every requested page loads helper and wires its assigned dialogs', () => {
 const cases = {
  'branch-detail/index.html': /zamEnableModalFocus\(modal,lastImageTrigger\)/,
  'branch-visits-history/index.html': /zamEnableModalFocus\(mailDialog/ ,
  'branches-checklists/index.html': /zamEnableModalFocus\(\$\('branch-modal'\)\.querySelector/,
  'checklist-logs/index.html': /zamEnableModalFocus\(modal,document\.activeElement\)/,
  'reports-log/index.html': /zamEnableModalFocus\(modal\.querySelector/,
  'staff-management/index.html': /zamEnableModalFocus\(modal\.querySelector/,
  'supervisor-dashboard/index.html': /zamEnableModalFocus\(visitActionModal/,
  'register/index.html': /success-title[^;]*focus\(\)/
 };
 for (const [file, pattern] of Object.entries(cases)) { const html=read(file); assert.match(html,/supabase-config\.js/,`${file} must load helper`); assert.match(html,pattern,`${file} must connect focus behavior`); }
 const visits=read('branch-visits-history/index.html'); assert.match(visits,/zamEnableModalFocus\(actionReviewDialog/);
 const reg=read('register/index.html'); assert.match(reg,/#avatar-input:focus-visible \+ label/);
});
