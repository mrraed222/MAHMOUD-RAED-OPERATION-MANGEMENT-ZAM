alter table public.automation_schedules
  add column if not exists last_run_date date;
