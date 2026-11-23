const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'reports-log', 'index.html'), 'utf8');
const openDetailSource = html.match(/async function openDetail\(id\) \{[\s\S]*?(?=\nfunction closeDetail\()/)?.[0];
const closeDetailSource = html.match(/function closeDetail\(\)\{[^\n]*\}/)?.[0];
assert.ok(openDetailSource && closeDetailSource, 'detail handlers should be extractable for behavioral tests');

function createHarness() {
  const pending = [];
  const modalClasses = new Set();
  const modal = { classList: {
    add(name) { modalClasses.add(name); },
    remove(name) { modalClasses.delete(name); },
    contains(name) { return modalClasses.has(name); },
  }, querySelector(selector) {
    assert.equal(selector, '[role=dialog]');
    return dialog;
  } };
  const body = { innerHTML: '' };
  const title = { textContent: '' };
  const context = { textContent: '' };
  const closeButton = { focus() {} };
  const dialog = { focus() {} };
  const elements = {
    'detail-modal': modal, 'detail-body': body, 'detail-title': title,
    'detail-context': context, 'close-detail': closeButton,
  };
  const sandbox = {
    reportsData: [{ id: 'A', report_date: '2026-11-01' }, { id: 'B', report_date: '2026-11-02' }],
    lastFocused: null,
    detailRequestGeneration: 0,
    activeDetailReportId: null,
    document: {
      activeElement: { focus() {} },
      getElementById(id) { return elements[id]; },
      querySelector() { return dialog; },
    },
    window: {
      zamEnableModalFocus(target, trigger) {
        assert.equal(target, dialog);
        assert.ok(trigger);
        return () => {};
      },
      ZamSupabasePagination: { fetchAllRows(_client, table) {
        return new Promise((resolve, reject) => pending.push({ table, resolve, reject }));
      } },
      ZamReportDetailRenderer: { render(report) { return `rendered:${report.id}`; } },
    },
    zamClient: {},
    console: { error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${openDetailSource}\n${closeDetailSource}`, sandbox);
  return {
    sandbox, pending, body, modal,
    batch() { return pending.splice(0, 4); },
    resolveAll(batch) { for (const item of batch) item.resolve([]); },
    rejectAll(batch) { for (const item of batch) item.reject(new Error('stale query failed')); },
  };
}

test('later report wins when child queries resolve out of order', async () => {
  const h = createHarness();
  const first = h.sandbox.openDetail('A');
  const oldBatch = h.batch();
  const second = h.sandbox.openDetail('B');
  const newBatch = h.batch();
  h.resolveAll(newBatch);
  await second;
  assert.equal(h.body.innerHTML, 'rendered:B');
  h.resolveAll(oldBatch);
  await first;
  assert.equal(h.body.innerHTML, 'rendered:B');
});

test('closing and reopening the same report invalidates the closed request', async () => {
  const h = createHarness();
  const closedOpen = h.sandbox.openDetail('A');
  const staleBatch = h.batch();
  h.sandbox.closeDetail();
  const reopened = h.sandbox.openDetail('A');
  const currentBatch = h.batch();
  h.resolveAll(currentBatch);
  await reopened;
  assert.equal(h.body.innerHTML, 'rendered:A');
  h.resolveAll(staleBatch);
  await closedOpen;
  assert.equal(h.body.innerHTML, 'rendered:A');
});

test('a stale child-query error cannot replace the reopened report contents', async () => {
  const h = createHarness();
  const stale = h.sandbox.openDetail('A');
  const staleBatch = h.batch();
  h.sandbox.closeDetail();
  const current = h.sandbox.openDetail('B');
  const currentBatch = h.batch();
  h.resolveAll(currentBatch);
  await current;
  assert.equal(h.body.innerHTML, 'rendered:B');
  h.rejectAll(staleBatch);
  await stale;
  assert.equal(h.body.innerHTML, 'rendered:B');
});

test('reopening the same report while its earlier load is pending invalidates that load', async () => {
  const h = createHarness();
  const earlier = h.sandbox.openDetail('A');
  const earlierBatch = h.batch();
  const latest = h.sandbox.openDetail('A');
  const latestBatch = h.batch();
  h.resolveAll(latestBatch);
  await latest;
  h.resolveAll(earlierBatch);
  await earlier;
  assert.equal(h.body.innerHTML, 'rendered:A');
});
