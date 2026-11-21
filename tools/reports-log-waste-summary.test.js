const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'reports-log', 'index.html'), 'utf8');

assert.match(
  html,
  /from\('waste_logs'\)\.select\('id',\s*\{\s*count:\s*'exact',\s*head:\s*true\s*\}\)\.eq\('report_id', id\)/,
  'fetch only an exact count for waste records; do not fetch raw waste rows'
);
assert.match(html, /const wasteCount = Number\(wasteRes\.count \|\| 0\)/);
assert.match(html, /wasteRes\.error \? 'تعذّر تحميل الملخص' : wasteCount\.toLocaleString\('ar-SA'\) \+ ' سجل'/);
assert.match(html, /if \(wasteRes\.error\) console\.warn/);
assert.doesNotMatch(html, /if \(wasteRes\.error\) throw/);
assert.match(html, /issues\.map\(i =>/);
assert.match(html, /reviews\.map\(r =>/);
assert.match(html, /!wasteRes\.error && !issuesRes\.error && !reviewsRes\.error/);
assert.doesNotMatch(html, /waste\.map|w\.item_name|w\.quantity|w\.unit|w\.reason/);

console.log('reports-log waste summary test: passed');
