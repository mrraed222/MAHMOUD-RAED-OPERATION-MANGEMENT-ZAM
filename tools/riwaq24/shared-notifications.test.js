const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../assets/supabase-config.js'), 'utf8');

test('shared header mounts the live bell only on the main dashboard and preserves role context', () => {
  assert.match(source, /window\.__zamActiveSidebarKey = activeKey/);
  assert.match(source, /const showNotifications = window\.__zamActiveSidebarKey === 'dashboard'/);
  assert.match(source, /if \(showNotifications && !notificationSlot\)/);
  assert.match(source, /if \(!showNotifications\) notificationSlot\?\.remove\(\)/);
  assert.match(source, /tools\.replaceChildren\(\.\.\.\(showNotifications \? \[toggle, notificationSlot, account\] : \[toggle, account\]\)\)/);
  assert.match(source, /if \(showNotifications\) refreshNotificationBell\(\)\.catch/);
  assert.match(source, /\.zam-header-tools \.zam-header-account \{ order: 1; \}/);
  assert.match(source, /\.zam-header-tools #notif-bell-slot \{ order: 3;/);
  assert.match(source, /\.zam-header-tools \.zam-sidebar-toggle \{ order: 2; \}/);
  assert.match(source, /header\.querySelector\('\[data-zam-header-tools\]'\)/);
  assert.match(source, /if \(!hostedTools\) header\.prepend\(tools\)/);
  assert.match(source, /zam-header-employee-role/);
  assert.match(source, /profile\?\.role/);
  assert.match(source, /document\.getElementById\('notif-bell-slot'\)/);
});

test('notification popup stays within viewport bounds and repositions after resize or scroll', () => {
  assert.match(source, /function positionNotificationMenu\(btn, menu\)/);
  assert.match(source, /menu\.style\.position = 'fixed'/);
  assert.match(source, /Math\.max\(margin, Math\.min\(buttonRect\.left, viewportWidth - menuWidth - margin\)\)/);
  assert.match(source, /window\.addEventListener\('resize', repositionOpenMenu, \{ passive: true \}\)/);
  assert.match(source, /window\.addEventListener\('scroll', repositionOpenMenu, true\)/);
  assert.match(source, /if \(willOpen\) positionNotificationMenu\(btn, menu\)/);
});

test('notification reads remain scoped to the authenticated profile and use exact unread count', () => {
  assert.match(source, /\.eq\('user_id', profile\.id\)\.order\('created_at'/);
  assert.match(source, /select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(source, /\.eq\('user_id', profile\.id\)\.eq\('is_read', false\)/);
  assert.match(source, /\.eq\('id', notificationId\)\s*\.eq\('user_id', profile\.id\)/);
  assert.match(source, /\.update\(\{ is_read: true, read_at:/);
  assert.match(source, /\.limit\(ZAM_NOTIFICATION_PAGE_SIZE\)/);
});

test('loading, empty, fetch failure, read failure, and realtime updates are visible', () => {
  assert.match(source, /aria-label=\\?"تحميل الإشعارات/);
  assert.match(source, /لا توجد إشعارات تشغيلية حالياً/);
  assert.match(source, /تعذر تحميل الإشعارات/);
  assert.match(source, /تعذر تحديث حالة القراءة/);
  assert.match(source, /تعذر تحديد الإشعارات كمقروءة/);
  assert.match(source, /postgres_changes/);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
});

test('bell and menu controls expose labels, expanded state and keyboard-native buttons', () => {
  assert.match(source, /aria-expanded="false" aria-controls="zam-notif-menu"/);
  assert.match(source, /role="region" aria-label="الإشعارات التشغيلية"/);
  assert.match(source, /id="zam-mark-all-notifications" type="button"/);
  assert.match(source, /btn\.dataset\.zamBound === 'true'/);
});

test('mobile header stacks brand, controls and shift context without shrinking the identity', () => {
  assert.match(source, /grid-template-areas: "brand" "tools" "extra"/);
  assert.match(source, /grid-area: tools; justify-self: start; flex: 0 0 auto !important; width: max-content/);
  assert.match(source, /grid-area: extra; justify-self: start; width: max-content; max-width: 100%/);
  assert.match(source, /\.zam-header-account \{ flex: 0 0 auto; gap: 5px; max-width: 140px/);
  assert.match(source, /\.zam-sidebar-toggle \{ width: 44px; min-width: 44px/);
  assert.match(source, /\.zam-sidebar-toggle-text \{ display: none; \}/);
  assert.match(source, /setAttribute\('aria-label', 'إظهار قائمة التنقل'\)/);
});

test('pages rely on the shared header instead of issuing duplicate bell reads or handlers', () => {
  for (const page of ['supervisor-checklist', 'supervisor-dashboard', 'branch-detail']) {
    const html = fs.readFileSync(path.join(__dirname, `../../${page}/index.html`), 'utf8');
    assert.doesNotMatch(html, /renderNotificationBell\s*\(/, `${page} must not perform a second bell fetch`);
    assert.doesNotMatch(html, /attachNotificationBellHandlers\s*\(/, `${page} must not rebind shared bell handlers`);
  }
  for (const page of ['permissions', 'automation-settings', 'my-checklist', 'inventory-requests']) {
    const html = fs.readFileSync(path.join(__dirname, `../../${page}/index.html`), 'utf8');
    assert.doesNotMatch(html, /renderNotificationBell\s*\(|attachNotificationBellHandlers\s*\(/, `${page} must rely on shared notification wiring`);
  }
  const dashboard = fs.readFileSync(path.join(__dirname, '../../dashboard/index.html'), 'utf8');
  assert.match(dashboard, /renderZamSidebar\('dashboard'/, 'the main dashboard must remain the sole bell page');
});
