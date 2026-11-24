import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('automation_schedules exposes nullable last_run_date required by the worker', () => {
  const schema = read('../schema.sql');
  const migration = read('../supabase/migrations/20261124152000_add_automation_schedule_last_run_date.sql');
  const worker = read('../supabase-functions/run-scheduled-automations/index.ts');

  assert.match(schema, /create table if not exists automation_schedules\s*\([\s\S]*?last_run_date\s+date\s*,?[\s\S]*?\);/i);
  assert.match(schema, /alter table public\.automation_schedules add column if not exists last_run_date date;/i);
  assert.match(migration, /^alter table public\.automation_schedules\s+add column if not exists last_run_date date;\s*$/i);
  assert.match(worker, /last_run_date/);
});
