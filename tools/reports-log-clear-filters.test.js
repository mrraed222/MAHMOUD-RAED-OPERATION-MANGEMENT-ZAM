const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'reports-log', 'index.html'), 'utf8');
const clearFiltersSource = html.match(/function clearFilters\(\)\{[^\n]*\}/)?.[0];
assert.ok(clearFiltersSource, 'the production clearFilters handler must exist');

for (const role of ['Owner', 'Supervisor']) {
  test(`clearing an invalid date resets validity and preserves ${role} branch scope`, () => {
    const elements = {
      'f-branch': { value: 'branch-1' },
      'f-from': { value: '2026-11-22' },
      'f-to': {
        value: '2026-11-21',
        validationMessage: 'invalid date range',
        setCustomValidity(message) { this.validationMessage = message; },
      },
    };
    let loads = 0;
    const context = {
      currentUser: { role },
      document: { getElementById(id) { return elements[id]; } },
      loadReports() { loads += 1; },
    };
    vm.createContext(context);
    vm.runInContext(`${clearFiltersSource}\nclearFilters();`, context);
    assert.equal(elements['f-branch'].value, role === 'Supervisor' ? 'branch-1' : '');
    assert.equal(elements['f-from'].value, '');
    assert.equal(elements['f-to'].value, '');
    assert.equal(elements['f-to'].validationMessage, '');
    assert.equal(loads, 1);
  });
}
