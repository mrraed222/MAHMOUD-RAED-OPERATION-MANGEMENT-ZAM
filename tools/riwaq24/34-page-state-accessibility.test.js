const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const login = read('index.html');
const analytics = read('analytics/index.html');
const automation = read('automation-settings/index.html');
const dashboard = read('dashboard/index.html');
const permissions = read('permissions/index.html');
const monitor = read('reports-monitor/index.html');
const normalizeSource = login.match(/function normalizePasscode\(value\)\s*\{[\s\S]*?\n\s*\}/)?.[0];
const validationSource = login.match(/function isValidPasscode\(value\)\s*\{[\s\S]*?\n\s*\}/)?.[0];
assert.ok(normalizeSource, 'login normalization helper is present');
assert.ok(validationSource, 'login validation helper is present');
const normalizePasscode = new Function(`${normalizeSource}; return normalizePasscode;`)();
const isValidPasscode = new Function(`${validationSource}; return isValidPasscode;`)();

test('login preserves symbols and accepts 4–20 characters while normalizing Arabic numerals', () => {
  assert.equal(normalizePasscode('١٢٣٤٥٦'), '123456');
  assert.equal(normalizePasscode('۱۲۳۴۵۶'), '123456');
  assert.equal(normalizePasscode('١۲٣۴'), '1234');
  assert.equal(normalizePasscode('١a#۲!'), '1a#2!');
  assert.match(login, /input\.value = normalizePasscode\(input\.value\);/);
  assert.match(login, /const passcode = normalizePasscode\(input\.value\)/);
  assert.match(login, /maxlength="20"/);
  assert.doesNotMatch(login, /inputmode="numeric"/);
  assert.doesNotMatch(login, /replace\(\/\[\^0-9\]\/g/);
  assert.equal(isValidPasscode('aB#1'), true);
  assert.equal(isValidPasscode('12345678901234567890'), true);
  assert.equal(isValidPasscode('1a!'), false);
  assert.equal(isValidPasscode('123456789012345678901'), false);
});

test('pending registration form never offers or approves Owner, and binds labels to selects', () => {
  const pendingRender = permissions.slice(permissions.indexOf('list.innerHTML=pending.map'), permissions.indexOf("list.querySelectorAll('.approve-btn')"));
  assert.match(pendingRender, /emp\.role==='Owner'\?''/);
  assert.match(pendingRender, /replace\(\/<option value="Owner"/);
  assert.match(pendingRender, /label for="pending-role-\$\{escapeHtml\(emp\.id\)\}"/);
  assert.match(pendingRender, /label for="pending-branch-\$\{escapeHtml\(emp\.id\)\}"/);
  assert.match(pendingRender, /label for="pending-shift-\$\{escapeHtml\(emp\.id\)\}"/);
  assert.match(permissions, /if\(!role\|\|role==='Owner'\)throw new Error\('invalid_pending_role'\)/);
  assert.match(permissions, /const opener=document\.activeElement/);
  assert.match(permissions, /if\(opener\?\.isConnected\)opener\.focus\(\)/);
  assert.match(permissions, /roleOptionsHTML\(pathRole,managerScopeAvailable\)/, 'live account role selection remains separate');
});

test('analytics branch-fetch failure replaces all three data tables loading states with errors', () => {
  const catchStart = analytics.indexOf('})().catch(error => {');
  const catchEnd = analytics.indexOf('\n});', catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart, 'analytics startup must expose a branch-load failure handler');
  const failure = analytics.slice(catchStart, catchEnd);
  for (const id of ['sales-branch-tbody', 'waste-tbody', 'issues-tbody', 'waste-branch-ranking-tbody']) {
    assert.match(failure, new RegExp(`getElementById\\('${id}'\\)\\.innerHTML`));
    assert.match(failure, /text-error/);
  }
  assert.match(failure, /getElementById\('waste-summary'\)\.innerHTML/);
  assert.match(failure, /getElementById\('issues-summary'\)\.innerHTML/);
});

test('schedule controls expose each report and shift in their accessible names', () => {
  assert.match(automation, /scheduleName=`\$\{reportName\} — \$\{shiftName\}`/);
  assert.match(automation, /aria-label="\$\{s\.is_active\?'إيقاف':'تفعيل'\} \$\{esc\(scheduleName\)\}"/);
  assert.match(automation, /aria-label="حذف \$\{esc\(scheduleName\)\}"/);
});

test('branch dashboard link does not override its descendant performance indicators', () => {
  assert.doesNotMatch(dashboard, /<a href="\$\{branchHref\}"\s+aria-label=/);
  assert.match(dashboard, /progressLabel/);
  assert.match(dashboard, /مبيعات/);
});

test('report monitor muted text meets WCAG AA contrast on both declared backgrounds', () => {
  const muted = monitor.match(/--rm-muted:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(muted, 'muted text color is declared');
  const backgrounds = ['#f4f6f2', '#ffffff'];
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  for (const background of backgrounds) {
    const values = [luminance(muted), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${muted} contrast on ${background}`);
  }
});
