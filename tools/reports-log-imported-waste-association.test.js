const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script-supabase-sync.js'), 'utf8');
const input = {
  reports: [
    { __row: 10, 'التاريخ': '2026-11-20', 'الفرع': 'الفرع الرئيسي', 'الشفت': 'صباحي', 'المسؤول': 'مشرف الصباح' },
    { __row: 20, 'التاريخ': '2026-11-20', 'الفرع': 'الفرع الرئيسي', 'الشفت': 'مسائي', 'المسؤول': 'مشرف المساء' },
  ],
  waste: [
    { __row: 3, 'التاريخ': '2026-11-20', 'الفرع': 'الفرع الرئيسي', 'الشفت': 'صباحي', 'الصنف': 'عنصر صباحي', 'الكمية': 1 },
    { __row: 4, 'التاريخ': '2026-11-20', 'الفرع': 'الفرع الرئيسي', 'الشفت': 'مسائي', 'الصنف': 'عنصر مسائي', 'الكمية': 2 },
    { __row: 5, 'التاريخ': '2026-11-20', 'الفرع': 'الفرع الرئيسي', 'الصنف': 'عنصر بلا وردية', 'الكمية': 3 },
  ],
  issues: [],
  negatives: [],
};
const wasteWrites = [];
const context = {
  console: { log() {} },
  Logger: { log() {} },
  Date,
};
vm.runInNewContext(source, context, { filename: 'apps-script-supabase-sync.js' });
context.readSheet = () => input;
context.hasColumn = () => true;
context.supa = (method, url, body) => {
  if (method === 'GET' && url === '/rest/v1/branches?select=id,name') return [{ id: 'branch-main', name: 'زام الرئيسي' }];
  if (method === 'GET' && url === '/rest/v1/daily_reports?select=id,sheet_key,custom_fields') return [];
  if (method === 'POST' && url === '/rest/v1/daily_reports') {
    return body.map((row) => ({
      id: row.shift_type === 'Morning' ? 'report-morning' : 'report-evening',
      custom_fields: row.custom_fields,
    }));
  }
  if (method === 'POST' && url.startsWith('/rest/v1/waste_logs')) {
    wasteWrites.push(...body);
    return body;
  }
  throw new Error(`Unexpected stub call: ${method} ${url}`);
};

const result = context.syncToSupabase();
assert.equal(result.ok, true);
assert.equal(result.skipped, 1, 'a row with no shift must be skipped when the same date/branch has both shifts');
assert.equal(wasteWrites.length, 2);
assert.equal(wasteWrites.find((row) => row.item_name === 'عنصر صباحي').report_id, 'report-morning');
assert.equal(wasteWrites.find((row) => row.item_name === 'عنصر مسائي').report_id, 'report-evening');
assert.match(source, /function findReport\(date, branchRaw, sheetRow, shiftType\)/);
assert.match(source, /var rep = findReport\(w\.date, w\.branchRaw, w\.sheet_row, w\.shift_type\)/);

console.log('imported waste shift-association unit test: passed');
