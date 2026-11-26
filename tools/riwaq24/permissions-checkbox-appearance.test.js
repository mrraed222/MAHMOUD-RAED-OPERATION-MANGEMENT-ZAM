const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const project = path.resolve(__dirname, '..', '..');
const permissions = fs.readFileSync(path.join(project, 'permissions', 'index.html'), 'utf8');
const styles = [...permissions.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');

test('general white field background excludes permission checkboxes', () => {
  assert.ok(styles, 'permissions page should contain inline styles');

  const fieldRule = styles.match(/input:not\(\[type=checkbox\]\)\s*,\s*select\s*\{[^}]*background\s*:\s*#fff\s*!important[^}]*\}/i);
  assert.ok(fieldRule, 'shared white field style should apply to non-checkbox inputs and selects');
  assert.doesNotMatch(styles, /(?:^|[,{])\s*input\s*,\s*select\s*\{/i, 'unqualified input selector must not override checkbox appearance');
  assert.match(styles, /input\[type=checkbox\]\s*\{[^}]*accent-color\s*:/i, 'checkbox-specific styling should remain');
});
