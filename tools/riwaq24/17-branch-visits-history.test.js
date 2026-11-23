const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../branch-visits-history/index.html'), 'utf8');

test('branch visit history retains route authentication, permission guards and bounded read contracts', () => {
  assert.match(html, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(html, /renderZamSidebar\('branch-visits',currentUser\.role\)/);
  assert.match(html, /data-zam-header-tools/);
  for (const rpc of ['can_manage_branch_visits', 'can_view_branch_visit_reports', 'can_review_branch_visit_actions']) assert.ok(html.includes(rpc));
  assert.match(html, /\.limit\(1000\)/);
  assert.match(html, /review_branch_visit_action/);
  assert.match(html, /visit-action-evidence/);
});

test('visit history keeps its Riwaq header readable, uses the shared dark-green sidebar color and omits the notification control', () => {
  assert.match(html, /<body class="zam-page">/);
  assert.match(html, /<header class="brand/);
  assert.match(html, /سجل زيارات الفروع/);
  assert.match(html, /body\.zam-page \.brand \.mt-6>div:first-child\{flex:1 1 22rem;min-width:0\}/);
  assert.match(html, /body\.zam-page \.zam-sidebar\{background-color:var\(--riwaq-sidebar,#16392f\)!important\}/);
  assert.match(html, /@media\(max-width:640px\).*header\.brand \.mt-6>\.no-print\{width:100%/);
  assert.doesNotMatch(html, /notif-bell-slot|إشعارات/);
});

test('filters, retry, search, print and visit actions remain reachable', () => {
  for (const id of ['from', 'to', 'branch', 'search', 'apply', 'reload', 'clearFilters', 'print']) assert.match(html, new RegExp(`id="${id}"`));
  for (const action of ['requestVisitPdf', 'printVisit', 'openMailDialog', 'openActionReview', 'changeQualityStatus']) assert.ok(html.includes(action));
  assert.match(html, /search\.oninput=render/);
  assert.match(html, /clearFilters.*load\(\)/);
});

test('visit cards and review dialogs are keyboard and assistive-technology addressable', () => {
  assert.match(html, /<details class="card visit-card/);
  assert.match(html, /<summary aria-label=/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /prefers-reduced-motion/);
});
