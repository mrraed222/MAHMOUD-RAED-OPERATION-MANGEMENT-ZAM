const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shared = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'supabase-config.js'), 'utf8');
const setOpenSource = shared.match(/const setOpen = \(open, returnFocus = false\) => \{[\s\S]*?\n        \};/)?.[0];
const clickBinding = shared.match(/toggle\.addEventListener\('click', \(\) => setOpen\(toggle\.getAttribute\('aria-expanded'\) !== 'true', true\)\);/)?.[0];
const scrimBinding = shared.match(/scrim\.addEventListener\('click', \(\) => setOpen\(false, true\)\);/)?.[0];
const keyboardBinding = shared.match(/document\.addEventListener\('keydown', event => \{[\s\S]*?\n        \}\);/)?.[0];

function makeElement(className = '') {
  return {
    className,
    children: [],
    attributes: new Map(),
    listeners: {},
    parentElement: null,
    ownerDocument: null,
    inert: false,
    focused: false,
    prepend(child) {
      if (child.parentElement) {
        const oldIndex = child.parentElement.children.indexOf(child);
        if (oldIndex >= 0) child.parentElement.children.splice(oldIndex, 1);
      }
      this.children.unshift(child);
      child.parentElement = this;
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    focus() {
      this.focused = true;
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
    },
  };
}

function simulateToggle() {
  const tools = makeElement('zam-header-tools');
  const sidebar = makeElement('zam-sidebar');
  const toggle = makeElement('zam-sidebar-toggle');
  const notification = makeElement('notif-bell-slot');
  const account = makeElement('zam-header-account');
  const scrim = makeElement('zam-sidebar-scrim');
  const sidebarLink = makeElement('nav-link');
  const icon = { textContent: 'menu' };
  const text = { textContent: 'إظهار القائمة' };
  const classes = new Set();
  const document = {
    activeElement: null,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    body: { classList: {
      contains: name => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    } },
  };
  for (const element of [tools, sidebar, toggle, notification, account, scrim, sidebarLink]) {
    element.ownerDocument = document;
  }
  toggle.icon = icon;
  toggle.text = text;
  toggle.querySelector = selector => selector.includes('material-symbols-outlined') ? icon : text;
  sidebar.querySelector = () => toggle.parentElement === sidebar ? toggle : sidebarLink;
  sidebar.querySelectorAll = () => [toggle, sidebarLink];
  sidebar.prepend(sidebarLink);
  tools.prepend(account);
  tools.prepend(notification);
  tools.prepend(toggle);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'إظهار قائمة التنقل');
  sidebar.setAttribute('aria-hidden', 'true');
  sidebar.inert = true;

  assert.ok(setOpenSource, 'production open/close state handler must remain defined');
  assert.ok(clickBinding, 'production toggle button must invoke the shared state handler');
  assert.ok(scrimBinding, 'production scrim must close the sidebar');
  assert.ok(keyboardBinding, 'production keyboard handler must remain defined');
  const handlers = new Function('document', 'sidebar', 'toggle', 'tools', 'scrim', `${setOpenSource}\n${clickBinding}\n${scrimBinding}\n${keyboardBinding}\nreturn { click: toggle.listeners.click, scrimClick: scrim.listeners.click, keydown: document.listeners.keydown };`)(document, sidebar, toggle, tools, scrim);
  return { ...handlers, tools, sidebar, toggle, document, classes, icon, text, scrim, sidebarLink };
}

test('one shared sidebar toggle opens and closes with correct focus and ARIA state at desktop and mobile breakpoints', () => {
  assert.match(shared, /@media \(min-width: 768px\)/);
  assert.match(shared, /@media \(max-width: 767px\)/);
  assert.match(shared, /visibility: hidden; transform: translateX\(105%\)/);
  assert.match(shared, /body\.zam-sidebar-open \.zam-sidebar[\s\S]*?visibility: visible/);
  assert.match(shared, /body\.zam-sidebar-open \.zam-sidebar-scrim \{ display: block !important; \}/);
  assert.match(shared, /inset-inline-start: 0 !important; inset-inline-end: auto !important;/,
    'the RTL sidebar must open from the right-hand inline start');
  assert.match(shared, /\.zam-sidebar nav \{[^}]*display: flex;[^}]*flex-direction: column;/,
    'navigation layout must not depend on page-specific Tailwind imports');
  assert.match(shared, /\.zam-sidebar nav a \{[^}]*display: flex;[^}]*align-items: center;/,
    'menu links must remain visible and usable without page utility CSS');
  assert.match(shared, /Material\+Symbols\+Outlined:wght,FILL/,
    'shared navigation must load its icon font on pages that do not import it themselves');
  assert.doesNotMatch(shared, /zam-sidebar-close|const closeButton/);
  const globalStyles = shared.slice(shared.indexOf('.zam-sidebar-scrim {'), shared.indexOf('@media (min-width: 768px)'));
  assert.match(globalStyles, /body\.zam-sidebar-open \{ overflow: hidden; \}/, 'background scrolling is locked at every viewport width');
  assert.match(globalStyles, /body\.zam-sidebar-open \.zam-sidebar-scrim \{ display: block !important; \}/, 'scrim is available at every viewport width');
  assert.match(globalStyles, /\.zam-sidebar > button:not\(\.zam-sidebar-toggle\) \{[^}]*color: #ffd9d4 !important/, 'logout color must not override the toggle on its white background');
  assert.match(globalStyles, /\.zam-sidebar nav a \{[^}]*min-height: 44px; padding: 8px;/, 'navigation remains usable without custom utility spacing');
  assert.match(globalStyles, /\.zam-sidebar nav a \{[^}]*flex-shrink: 0;/, 'wrapped navigation labels must fit within their links');
  assert.match(shared, /if \(open && toggle\.parentElement !== sidebar\) sidebar\.prepend\(toggle\)/);
  assert.match(shared, /else if \(!open && toggle\.parentElement !== tools\) tools\.prepend\(toggle\)/);

  for (const viewport of [{ label: 'desktop', width: 1280 }, { label: 'mobile', width: 390 }]) {
    assert.ok(viewport.width >= 768 || /@media \(max-width: 767px\)/.test(shared), `${viewport.label} layout contract exists`);
    const ui = simulateToggle();

    ui.click();
    assert.equal(ui.document.body.classList.contains('zam-sidebar-open'), true, `${viewport.label}: opens`);
    assert.equal(ui.sidebar.getAttribute('aria-hidden'), 'false');
    assert.equal(ui.sidebar.inert, false);
    assert.equal(ui.toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(ui.toggle.getAttribute('aria-label'), 'إخفاء قائمة التنقل');
    assert.equal(ui.icon.textContent, 'close');
    assert.equal(ui.text.textContent, 'إخفاء القائمة');
    assert.equal(ui.toggle.parentElement, ui.sidebar, `${viewport.label}: the same toggle moves into the open sidebar`);
    assert.equal(ui.sidebar.children.filter(child => child.className === 'zam-sidebar-toggle').length, 1);
    assert.equal(ui.tools.children.some(child => child.className === 'zam-sidebar-toggle'), false);

    ui.click();
    assert.equal(ui.document.body.classList.contains('zam-sidebar-open'), false, `${viewport.label}: closes`);
    assert.equal(ui.sidebar.getAttribute('aria-hidden'), 'true');
    assert.equal(ui.sidebar.inert, true);
    assert.equal(ui.toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(ui.toggle.getAttribute('aria-label'), 'إظهار قائمة التنقل');
    assert.equal(ui.icon.textContent, 'menu');
    assert.equal(ui.text.textContent, 'إظهار القائمة');
    assert.equal(ui.toggle.parentElement, ui.tools, `${viewport.label}: the same toggle returns to the header`);
    assert.equal(ui.tools.children.filter(child => child.className === 'zam-sidebar-toggle').length, 1);
    assert.equal(ui.toggle.focused, true, `${viewport.label}: focus returns to the toggle`);
  }
});

test('Escape and scrim close the sidebar and return focus; Tab and Shift+Tab stay inside it', () => {
  const ui = simulateToggle();
  ui.click();

  let tabPrevented = false;
  ui.document.activeElement = ui.sidebarLink;
  ui.keydown({ key: 'Tab', shiftKey: false, preventDefault() { tabPrevented = true; } });
  assert.equal(tabPrevented, true);
  assert.equal(ui.document.activeElement, ui.toggle, 'Tab from the last item wraps to the first');

  let reverseTabPrevented = false;
  ui.keydown({ key: 'Tab', shiftKey: true, preventDefault() { reverseTabPrevented = true; } });
  assert.equal(reverseTabPrevented, true);
  assert.equal(ui.document.activeElement, ui.sidebarLink, 'Shift+Tab from the first item wraps to the last');

  ui.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(ui.document.body.classList.contains('zam-sidebar-open'), false);
  assert.equal(ui.toggle.parentElement, ui.tools);
  assert.equal(ui.document.activeElement, ui.toggle, 'Escape returns focus to the toggle');

  ui.click();
  ui.scrimClick();
  assert.equal(ui.document.body.classList.contains('zam-sidebar-open'), false);
  assert.equal(ui.sidebar.getAttribute('aria-hidden'), 'true');
  assert.equal(ui.document.activeElement, ui.toggle, 'the scrim returns focus to the toggle');
});
