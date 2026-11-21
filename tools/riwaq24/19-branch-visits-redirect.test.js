const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../branch-visits/index.html'), 'utf8');
const destination = '../branch-visits-history/index.html';

test('redirect page preserves the relative destination and both redirect mechanisms', () => {
  assert.match(source, new RegExp(`<meta\\s+http-equiv="refresh"\\s+content="0;url=${destination.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"`, 'i'));
  assert.match(source, /location\.replace\('\.\.\/branch-visits-history\/index\.html'\)/);
  assert.match(source, /جارٍ تحويلك إلى سجل زيارات الفروع/);
});
