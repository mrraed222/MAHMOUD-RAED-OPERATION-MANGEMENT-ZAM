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
assert.ok(normalizeSource, 'login normalization helper is present');
const normalizePasscode = new Function(`${normalizeSource}; return normalizePasscode;`)();

test('login converts Arabic-Indic and Eastern Arabic-Indic numerals before filtering and validation', () => {
  assert.equal(normalizePasscode('١٢٣٤٥٦'), '123456');
  assert.equal(normalizePasscode('۱۲۳۴۵۶'), '123456');
  assert.equal(normalizePasscode('١۲٣۴'), '1234');
  assert.match(login, /normalizePasscode\(input\.value\)\.replace\(\/\[\^0-9\]\/g/);
  assert.match(login, /const passcode = normalizePasscode\(input\.value\.trim\(\)\)/);
  assert.match(login, /maxlength="6"/);
});

test('pending registration form never offers or approves Owner, and binds labels to selects', () => {
  const pendingRender = permissions.slice(permissions.indexOf('list.innerHTML=pending.map'), permissions.indexOf("list.querySelectorAll('.approve-btn')"));
  assert.match(pendingRender, /emp\.role==='Owner'\?''/);
  assert.match(pendingRender, /replace\(\/<option value="Owner"/);
  assert.match(pendingRender, /label for="pending-role-\$\{escapeHtml\(emp\.id\)\}"/);
  assert.match(pendingRender, /label for="pending-branch-\$\{escapeHtml\(emp\.id\)\}"/);
  assert.match(pendingRender, /label for="pending-shift-\$\{escapeHtml\(emp\.id\)\}"/);
  assert.match(permissions, /requestedRole==='Owner'\)throw new Error\('invalid_pending_role'\)/);
  assert.match(permissions, /const opener=document\.activeElement/);
  assert.match(permissions, /if\(opener\?\.isConnected\)opener\.focus\(\)/);
  assert.match(permissions, /roleOptionsHTML\(emp\.role\)/, 'live account role selection remains separate');
});

test('analytics branch-fetch failure replaces all three data tables loading states with errors', () => {
  const failure = analytics.slice(analytics.indexOf('loadBranches().then(applyFilters).catch'), analytics.indexOf('</script>', analytics.indexOf('loadBranches().then(applyFilters).catch')));
  for (const id of ['sales-branch-tbody', 'waste-tbody', 'issues-tbody']) {
    assert.match(failure, new RegExp(`getElementById\\('${id}'\\)\\.innerHTML`));
    assert.match(failure, /text-error/);
  }
  assert.match(failure, /waste-branch-ranking-tbody/);
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
