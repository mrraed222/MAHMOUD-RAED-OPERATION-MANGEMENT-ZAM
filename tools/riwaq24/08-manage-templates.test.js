const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '../../manage-templates/index.html');
const html = fs.readFileSync(pagePath, 'utf8');

test('manage templates keeps authorization, API contracts, and task-specific workflows', () => {
  assert.match(html, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(html, /data-zam-header-tools/);
  assert.match(html, /renderZamSidebar\('manage-templates', currentUser\.role\)/);
  assert.match(html, /requireAdminPerm\('can_manage_templates'\)/);
  assert.match(html, /getTemplates\(null, null, null, \{ includeArchived: true \}\)/);
  for (const contract of ['saveTemplateWithBranches', 'saveTemplateGroupWithBranches', 'saveRestroomHourlyTaskWithBranches', 'deleteTemplateGroup', 'archiveRestroomHourlyTask', 'copyArchivedTemplateAsNewVersion', 'initializeRestroomHourlyTask', 'getFridges', 'saveFridge', 'deleteFridge']) {
    assert.ok(html.includes(`ZamAPI.${contract}`), `missing preserved API ${contract}`);
  }
  assert.match(html, /20 موعدًا بسجل مستقل/);
  assert.match(html, /STEPS\.map/);
});

test('search/filter are functional, accessible, and include loaded archives without changing data', () => {
  assert.match(html, /id="template-search" type="search"/);
  assert.match(html, /id="template-frequency-filter"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /function applyTemplateFilters\(\)/);
  assert.match(html, /data-template-card data-frequency=/);
  assert.match(html, /copy-archived-btn/);
  assert.match(html, /إعادة المحاولة/);
  assert.match(html, /includeArchived: true/);
});
