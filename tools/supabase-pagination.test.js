const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets/supabase-pagination.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, globalThis: window, Array, Number, TypeError, Object });
const { fetchAllPages, fetchAllRows } = window.ZamSupabasePagination;

test('fetchAllPages returns every row beyond the Supabase default page size', async () => {
  const rows = Array.from({ length: 2055 }, (_, index) => ({ id: `row-${index}` }));
  const ranges = [];
  const client = {
    from(table) {
      assert.equal(table, 'waste_logs');
      const query = {
        select(columns) { assert.equal(columns, '*'); return query; },
        eq(column, value) { assert.deepEqual([column, value], ['report_id', 'report-1']); return query; },
        order(column, options) { assert.ok(['created_at', 'id'].includes(column)); assert.equal(options.ascending, true); return query; },
        range(from, to) {
          ranges.push([from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return query;
    },
  };

  const result = await fetchAllRows(client, 'waste_logs', 'report_id', 'report-1');
  assert.equal(result.length, 2055);
  assert.equal(result[0].id, 'row-0');
  assert.equal(result.at(-1).id, 'row-2054');
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('fetchAllPages propagates a page error instead of returning partial details', async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchAllPages(async () => {
      calls += 1;
      return calls === 1
        ? { data: Array.from({ length: 1000 }, (_, index) => index), error: null }
        : { data: null, error: new Error('page 2 unavailable') };
    }),
    /page 2 unavailable/,
  );
  assert.equal(calls, 2);
});
