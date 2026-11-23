\set ON_ERROR_STOP on
\echo 'Running existing isolated report-association RLS suite and the local Manager-scope hardening candidate'
\ir technical-issues-report-association-rls.sql
\ir ../supabase/migrations/20261123160000_manager_report_scopes_hardening.sql

BEGIN;
INSERT INTO public.branches(id, name, lifecycle_status) VALUES
  ('81000000-0000-4000-8000-000000000001', 'Hardening Branch A', 'open'),
  ('81000000-0000-4000-8000-000000000002', 'Hardening Branch B', 'open'),
  ('81000000-0000-4000-8000-000000000003', 'Hardening Planned C', 'planned');

INSERT INTO public.profiles(id, full_name, email, passcode, role, status, branch_id, shift_type) VALUES
  ('82000000-0000-4000-8000-000000000001', 'Hardening Owner', 'owner-hardening@example.test', 'owner-hardening', 'Owner', 'active', '81000000-0000-4000-8000-000000000001', 'Both'),
  ('82000000-0000-4000-8000-000000000002', 'All Scope Manager', 'manager-all@example.test', 'manager-all', 'Manager', 'active', '81000000-0000-4000-8000-000000000001', 'Both'),
  ('82000000-0000-4000-8000-000000000003', 'Selected Scope Manager', 'manager-selected@example.test', 'manager-selected', 'Manager', 'active', '81000000-0000-4000-8000-000000000001', 'Both'),
  ('82000000-0000-4000-8000-000000000004', 'Unconfigured Manager', 'manager-none@example.test', 'manager-none', 'Manager', 'active', '81000000-0000-4000-8000-000000000001', 'Both'),
  ('82000000-0000-4000-8000-000000000005', 'Summary Only Manager', 'manager-summary@example.test', 'manager-summary', 'Manager', 'active', '81000000-0000-4000-8000-000000000001', 'Both'),
  ('82000000-0000-4000-8000-000000000006', 'Branch A Morning Supervisor', 'supervisor-a@example.test', 'supervisor-a', 'Supervisor', 'active', '81000000-0000-4000-8000-000000000001', 'Morning'),
  ('82000000-0000-4000-8000-000000000007', 'Branch B Morning Supervisor', 'supervisor-b@example.test', 'supervisor-b', 'Supervisor', 'active', '81000000-0000-4000-8000-000000000002', 'Morning'),
  ('82000000-0000-4000-8000-000000000008', 'Ordinary Branch A Barista', 'barista-a@example.test', 'barista-a', 'Barista', 'active', '81000000-0000-4000-8000-000000000001', 'Morning'),
  ('82000000-0000-4000-8000-000000000009', 'Action Reviewer', 'reviewer@example.test', 'reviewer', 'Admin', 'active', '81000000-0000-4000-8000-000000000001', 'Both');
INSERT INTO auth.users(id) VALUES
  ('82000000-0000-4000-8000-000000000001'), ('82000000-0000-4000-8000-000000000002'),
  ('82000000-0000-4000-8000-000000000003'), ('82000000-0000-4000-8000-000000000004'),
  ('82000000-0000-4000-8000-000000000005'), ('82000000-0000-4000-8000-000000000006'),
  ('82000000-0000-4000-8000-000000000007'), ('82000000-0000-4000-8000-000000000008'),
  ('82000000-0000-4000-8000-000000000009');
INSERT INTO public.admin_permissions(profile_id, can_manage_reports, can_view_all_reports) VALUES
  ('82000000-0000-4000-8000-000000000002', true, false),
  ('82000000-0000-4000-8000-000000000003', true, false),
  ('82000000-0000-4000-8000-000000000005', false, false);
INSERT INTO public.admin_permissions(profile_id, can_review_visit_actions)
VALUES ('82000000-0000-4000-8000-000000000009', true);
INSERT INTO public.manager_report_scopes(
  profile_id, scope_mode, can_view_daily_checklist_summary, can_view_checklist_logs,
  can_view_visit_reports, can_view_analytics, configured_by
) VALUES
  ('82000000-0000-4000-8000-000000000002', 'all', true, true, true, true, '82000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000003', 'selected', true, true, true, true, '82000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000005', 'all', true, false, false, false, '82000000-0000-4000-8000-000000000001');
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id) VALUES
  ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002');

INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by, supervisor_name, total_sales, entry_time) VALUES
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '2026-11-21', 'Morning', '82000000-0000-4000-8000-000000000006', 'Supervisor A', 100, '11:00'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '2026-11-21', 'Evening', '82000000-0000-4000-8000-000000000006', 'Supervisor A', 200, '23:00'),
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', '2026-11-21', 'Morning', '82000000-0000-4000-8000-000000000007', 'Supervisor B', 300, '12:00'),
  ('83000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000003', '2026-11-21', 'Morning', '82000000-0000-4000-8000-000000000001', 'Planned branch Owner', 400, '12:00');
INSERT INTO public.waste_logs(id, report_id, item_name, quantity, unit) VALUES
  ('84000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'A morning waste', 1, 'kg'),
  ('84000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', 'A evening waste', 2, 'kg'),
  ('84000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000003', 'B morning waste', 3, 'kg'),
  ('84000000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000004', 'Planned waste', 4, 'kg');
INSERT INTO public.shift_issues(id, report_id, description, priority) VALUES
  ('85000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'A morning issue', 'normal'),
  ('85000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', 'A evening issue', 'normal'),
  ('85000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000003', 'B morning issue', 'normal'),
  ('85000000-0000-4000-8000-000000000004', '83000000-0000-4000-8000-000000000004', 'Planned issue', 'normal');

INSERT INTO public.checklist_templates(id, task_title, category, shift_type, branch_id) VALUES
  ('86000000-0000-4000-8000-000000000001', 'Branch A checklist', 'Fixture', 'Morning', '81000000-0000-4000-8000-000000000001'),
  ('86000000-0000-4000-8000-000000000002', 'Branch B checklist', 'Fixture', 'Morning', '81000000-0000-4000-8000-000000000002');
INSERT INTO public.checklist_logs(id, template_id, branch_id, executed_by, shift_type, execution_date) VALUES
  ('87000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000006', 'Morning', '2026-11-21'),
  ('87000000-0000-4000-8000-000000000002', '86000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000007', 'Morning', '2026-11-21');
INSERT INTO public.technical_issues(id, branch_id, reported_by, source, title, report_id) VALUES
  ('88000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000006', 'manual', 'A technical issue', '83000000-0000-4000-8000-000000000001'),
  ('88000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000007', 'manual', 'B technical issue', '83000000-0000-4000-8000-000000000003'),
  ('88000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', 'manual', 'Planned technical issue', '83000000-0000-4000-8000-000000000004');
INSERT INTO public.supervisory_visits(id, branch_id, visit_date, shift_type, supervisor_name) VALUES
  ('89000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '2026-11-21', 'Morning', 'Supervisor A'),
  ('89000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '2026-11-21', 'Morning', 'Supervisor B');
INSERT INTO public.visit_checklist_templates(id, code, category, title) VALUES
  ('8a000000-0000-4000-8000-000000000001', 'manager-scope-storage', 'Fixture', 'Storage scope fixture');
INSERT INTO public.supervisory_visit_results(id, visit_id, item_id, score, result, is_violation) VALUES
  ('8b000000-0000-4000-8000-000000000001', '89000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001', 5, 'جزئي', true),
  ('8b000000-0000-4000-8000-000000000002', '89000000-0000-4000-8000-000000000002', '8a000000-0000-4000-8000-000000000001', 5, 'جزئي', true);
INSERT INTO public.visit_action_items(id, visit_id, result_id, branch_id, title, assigned_to, assigned_role, shift_type, status, created_by) VALUES
  ('8c000000-0000-4000-8000-000000000001', '89000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Branch A evidence', NULL, 'Supervisor', 'Morning', 'مفتوحة', '82000000-0000-4000-8000-000000000001'),
  ('8c000000-0000-4000-8000-000000000002', '89000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Branch B evidence', NULL, 'Supervisor', 'Morning', 'مفتوحة', '82000000-0000-4000-8000-000000000001');
SELECT set_config('app.visit_action_transition', 'submit', true);
UPDATE public.visit_action_items
SET status='بانتظار اعتماد الإدارة', completion_note='Isolated RLS fixture',
    completion_submitted_at=now(), completion_submitted_by='82000000-0000-4000-8000-000000000007'
WHERE id='8c000000-0000-4000-8000-000000000002';
SELECT set_config('app.visit_action_transition', '', true);
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('visit-action-evidence', '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000001/branch-a.png'),
  ('visit-action-evidence', '8c000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000001/branch-b.png');

DO $test$
DECLARE v_reader_oid oid;
BEGIN
  SELECT oid INTO v_reader_oid FROM pg_catalog.pg_roles WHERE rolname = 'zam_daily_summary_reader' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin;
  IF v_reader_oid IS NULL THEN RAISE EXCEPTION 'FAIL summary reader must be NOLOGIN and NOBYPASSRLS'; END IF;
  IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = 'public.get_daily_checklist_summary(date,date)'::regprocedure) <> v_reader_oid THEN
    RAISE EXCEPTION 'FAIL summary RPC is not owned by the restricted reader role';
  END IF;
  IF pg_catalog.has_table_privilege('zam_daily_summary_reader', 'public.daily_reports', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL summary reader has whole-table SELECT on daily_reports';
  END IF;
  IF NOT pg_catalog.has_column_privilege('zam_daily_summary_reader', 'public.daily_reports', 'entry_time', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL summary reader lacks the projection column grant';
  END IF;
  IF pg_catalog.has_schema_privilege(v_reader_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'FAIL summary reader role has unnecessary CREATE on public schema';
  END IF;
  RAISE NOTICE 'PASS summary RPC runs as a NOLOGIN/NOBYPASSRLS role with column-only source access';
  RAISE NOTICE 'PASS summary reader role has no CREATE privilege on public schema';
END;
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id::text LIKE '83000000-0000-4000-8000-00000000000%';
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL Owner expected all four reports including the planned branch, got %', n; END IF;
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary('2026-11-21', '2026-11-21');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL Owner summary should include three operational reports and exclude planned branch, got %', n; END IF;
  IF NOT public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL Owner lost automatic cross-branch visit-read authorization';
  END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL Owner expected both action evidence objects, got %', n; END IF;
  RAISE NOTICE 'PASS Owner sees all reports automatically; the projection omits planned branches';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000009', true);
DO $test$
DECLARE n integer;
BEGIN
  IF NOT public.can_review_branch_visit_actions() THEN
    RAISE EXCEPTION 'FAIL Admin fixture does not have the action-review permission';
  END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence';
  IF n <> 1 OR NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id='visit-action-evidence'
      AND name='8c000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000001/branch-b.png'
  ) OR EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id='visit-action-evidence'
      AND name='8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000001/branch-a.png'
  ) THEN
    RAISE EXCEPTION 'FAIL action reviewer must read only pending evidence, not unrelated open evidence';
  END IF;
  RAISE NOTICE 'PASS non-Manager reviewer: pending action evidence allowed; unrelated open-action evidence denied';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id::text LIKE '83000000-0000-4000-8000-00000000000%';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL all-scope Manager expected three operational reports, got %', n; END IF;
  SELECT count(*) INTO n FROM public.list_manager_daily_summary_branches()
  WHERE id IN (
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000003'
  );
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL all-scope Manager summary branch list expected two operational branches, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.list_manager_daily_summary_branches() WHERE id='81000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'FAIL summary branch list included a planned branch';
  END IF;
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary('2026-11-21', '2026-11-21');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL all-scope Manager summary expected three rows, got %', n; END IF;
  SELECT count(*) INTO n FROM public.checklist_logs WHERE id::text LIKE '87000000-0000-4000-8000-00000000000%';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL all-scope Manager expected both checklist logs, got %', n; END IF;
  SELECT count(*) INTO n FROM public.waste_logs WHERE id::text LIKE '84000000-0000-4000-8000-00000000000%';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL all-scope Manager expected three operational waste rows, got %', n; END IF;
  SELECT count(*) INTO n FROM public.shift_issues WHERE id::text LIKE '85000000-0000-4000-8000-00000000000%';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL all-scope Manager expected three report-linked shift issues, got %', n; END IF;
  SELECT count(*) INTO n FROM public.technical_issues WHERE id::text LIKE '88000000-0000-4000-8000-00000000000%';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL analytics should expose only two operational technical-issue rows, got %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id::text LIKE '89000000-0000-4000-8000-00000000000%';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL weekly-report visit source expected both branches for all scope, got %', n; END IF;
  IF NOT public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL all-scope Manager visit authorization did not follow visit capability';
  END IF;
  RAISE NOTICE 'PASS all-scope Manager: summary, analytics, weekly-report visits, reports-log details, and checklist logs';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000003', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id::text LIKE '83000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.daily_reports WHERE id='83000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'FAIL selected Manager must see Branch B only';
  END IF;
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary('2026-11-21', '2026-11-21');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected Manager summary expected one Branch B row, got %', n; END IF;
  SELECT count(*) INTO n FROM public.waste_logs WHERE id::text LIKE '84000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.waste_logs WHERE id='84000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'FAIL reports-log waste details escaped or failed selected Branch B scope';
  END IF;
  SELECT count(*) INTO n FROM public.shift_issues WHERE id::text LIKE '85000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.shift_issues WHERE id='85000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'FAIL report_id-linked shift issues escaped or failed selected Branch B scope';
  END IF;
  SELECT count(*) INTO n FROM public.technical_issues WHERE id::text LIKE '88000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.technical_issues WHERE id='88000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL analytics escaped or failed selected Branch B scope';
  END IF;
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id::text LIKE '89000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.supervisory_visits WHERE id='89000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL weekly-report visits escaped or failed selected Branch B scope';
  END IF;
  SELECT count(*) INTO n FROM public.list_manager_daily_summary_branches();
  IF n <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.list_manager_daily_summary_branches() WHERE id='81000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'FAIL selected Manager summary branch list escaped or failed Branch B scope';
  END IF;
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id='visit-action-evidence'
    AND name IN (
      '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000001/branch-a.png',
      '8c000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000001/branch-b.png'
    );
  IF n <> 1 OR EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='visit-action-evidence'
      AND name='8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000001/branch-a.png'
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='visit-action-evidence'
      AND name='8c000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000001/branch-b.png'
  ) THEN
    RAISE EXCEPTION 'FAIL visit evidence storage objects were not constrained to selected Branch B';
  END IF;
  IF public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL selected Manager visit helper allowed Branch A outside scope';
  END IF;
  RAISE NOTICE 'PASS selected Manager: summary branch list, report data, visits, and evidence storage stay in Branch B';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000004', true);
DO $test$
DECLARE n integer; denied boolean := false;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id::text LIKE '83000000-0000-4000-8000-00000000000%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL unconfigured Manager read % reports', n; END IF;
  SELECT count(*) INTO n FROM public.checklist_logs WHERE id::text LIKE '87000000-0000-4000-8000-00000000000%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL unconfigured Manager read % checklist logs', n; END IF;
  SELECT count(*) INTO n FROM public.technical_issues WHERE id::text LIKE '88000000-0000-4000-8000-00000000000%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL unconfigured Manager read % analytics rows', n; END IF;
  SELECT count(*) INTO n FROM public.list_manager_daily_summary_branches();
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL unconfigured Manager received % summary branches', n; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL unconfigured Manager read % visit evidence objects', n; END IF;
  BEGIN
    SELECT count(*) INTO n FROM public.get_daily_checklist_summary('2026-11-21', '2026-11-21');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL summary RPC accepted Manager with no scope row'; END IF;
  IF public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL no-scope Manager visit helper fell back to branch access';
  END IF;
  RAISE NOTICE 'PASS Manager with no scope: default-deny for raw reports, analytics, checklist logs, visits, and summary RPC';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000005', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id::text LIKE '83000000-0000-4000-8000-00000000000%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read raw reports'; END IF;
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary('2026-11-21', '2026-11-21');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL summary-only Manager expected three projection rows, got %', n; END IF;
  SELECT count(*) INTO n FROM public.waste_logs WHERE id::text LIKE '84000000-0000-4000-8000-00000000000%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read waste details'; END IF;
  SELECT count(*) INTO n FROM public.shift_issues WHERE id::text LIKE '85000000-0000-4000-8000-00000000000%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read shift issue details'; END IF;
  SELECT count(*) INTO n FROM public.technical_issues WHERE id::text LIKE '88000000-0000-4000-8000-00000000000%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read analytics rows'; END IF;
  SELECT count(*) INTO n FROM public.list_manager_daily_summary_branches()
  WHERE id IN (
    '81000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000003'
  );
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL summary-only Manager should list summary-authorized branches independently of analytics, got %', n; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read % visit evidence objects without visit permission', n; END IF;
  RAISE NOTICE 'PASS summary-only Manager: projection allowed; raw reports, details, analytics denied';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000006', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id::text LIKE '83000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.daily_reports WHERE id='83000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL Branch A Supervisor must read own-branch morning report only';
  END IF;
  SELECT count(*) INTO n FROM public.waste_logs WHERE id::text LIKE '84000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.waste_logs WHERE id='84000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL Branch A Supervisor waste-log read crossed branch or shift';
  END IF;
  SELECT count(*) INTO n FROM public.shift_issues WHERE id::text LIKE '85000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.shift_issues WHERE id='85000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL Branch A Supervisor report_id-linked issue read crossed branch or shift';
  END IF;
  SELECT count(*) INTO n FROM public.checklist_logs WHERE id::text LIKE '87000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.checklist_logs WHERE id='87000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL Branch A Supervisor checklist log read crossed branch';
  END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence';
  IF n <> 1 OR NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id='visit-action-evidence'
      AND name='8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000001/branch-a.png'
  ) THEN
    RAISE EXCEPTION 'FAIL Branch A Supervisor must see only its assigned action evidence';
  END IF;
  IF public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL Branch A Supervisor visit helper allowed Branch B';
  END IF;
  RAISE NOTICE 'PASS Supervisor inside assigned branch/shift; outside branch and other shift denied';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000007', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id::text LIKE '83000000-0000-4000-8000-00000000000%';
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.daily_reports WHERE id='83000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'FAIL Branch B Supervisor must read only own branch morning report';
  END IF;
  IF EXISTS (SELECT 1 FROM public.daily_reports WHERE id='83000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL Branch B Supervisor read Branch A report';
  END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence';
  IF n <> 1 OR NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id='visit-action-evidence'
      AND name='8c000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000001/branch-b.png'
  ) THEN
    RAISE EXCEPTION 'FAIL Branch B Supervisor must see only its assigned action evidence';
  END IF;
  IF public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL Branch B Supervisor visit helper allowed Branch A';
  END IF;
  RAISE NOTICE 'PASS Supervisor outside another branch: reports and visit branch helper deny cross-branch reads';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000008', true);
DO $test$
BEGIN
  IF public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000001')
     OR public.current_user_can_read_visit_branch('81000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL non-Owner/Admin/Manager/Supervisor inherited visit branch access';
  END IF;
  RAISE NOTICE 'PASS unrecognized ordinary role defaults to deny on visit branch authorization';
END;
$test$;
RESET ROLE;

-- Verify report saving and child-detail writes are independently enforced by report_id/branch scope.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000003', true);
DO $test$
DECLARE n integer; denied boolean := false;
BEGIN
  INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by, supervisor_name, entry_time)
  VALUES ('83000000-0000-4000-8000-000000000011', '81000000-0000-4000-8000-000000000002', '2026-11-22', 'Morning', '82000000-0000-4000-8000-000000000003', 'Selected Manager', '12:00');
  INSERT INTO public.waste_logs(report_id, item_name, quantity, unit)
  VALUES ('83000000-0000-4000-8000-000000000011', 'Manager saved waste', 1, 'kg');
  INSERT INTO public.shift_issues(report_id, description, priority)
  VALUES ('83000000-0000-4000-8000-000000000011', 'Manager saved shift issue', 'normal');
  SELECT count(*) INTO n FROM public.shift_issues si
  JOIN public.daily_reports r ON r.id = si.report_id
  WHERE si.description = 'Manager saved shift issue' AND r.branch_id = '81000000-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Manager saved shift issue did not remain linked through report_id'; END IF;
  BEGIN
    INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by)
    VALUES ('83000000-0000-4000-8000-000000000012', '81000000-0000-4000-8000-000000000001', '2026-11-22', 'Morning', '82000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL selected Manager inserted daily report outside selected branch';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected selected Manager report insert denial'; END IF;
  denied := false;
  BEGIN
    INSERT INTO public.waste_logs(report_id, item_name, quantity)
    VALUES ('83000000-0000-4000-8000-000000000001', 'Out-of-scope Manager waste', 1);
    RAISE EXCEPTION 'FAIL selected Manager inserted waste for an out-of-scope report';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected out-of-scope Manager waste insert denial'; END IF;
  RAISE NOTICE 'PASS selected Manager cannot insert waste for an out-of-scope report';
  denied := false;
  BEGIN
    INSERT INTO public.shift_issues(report_id, description)
    VALUES ('83000000-0000-4000-8000-000000000001', 'Out-of-scope Manager issue');
    RAISE EXCEPTION 'FAIL selected Manager inserted shift issue for an out-of-scope report';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected out-of-scope Manager shift issue insert denial'; END IF;
  RAISE NOTICE 'PASS selected Manager cannot insert shift_issues for an out-of-scope report';
  UPDATE public.waste_logs SET reason='must remain hidden'
  WHERE id='84000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL selected Manager updated out-of-scope waste row'; END IF;
  RAISE NOTICE 'PASS selected Manager cannot update an out-of-scope waste row';
  DELETE FROM public.shift_issues WHERE id='85000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL selected Manager deleted out-of-scope shift issue'; END IF;
  RAISE NOTICE 'PASS selected Manager cannot delete an out-of-scope shift issue';
  RAISE NOTICE 'PASS daily_reports save and waste/shift_issues writes succeed in scope; out-of-scope report/detail inserts, update and delete are denied';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000006', true);
DO $test$
DECLARE denied boolean := false;
BEGIN
  INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by, supervisor_name)
  VALUES ('83000000-0000-4000-8000-000000000013', '81000000-0000-4000-8000-000000000001', '2026-11-22', 'Morning', '82000000-0000-4000-8000-000000000006', 'Supervisor A');
  INSERT INTO public.waste_logs(report_id, item_name, quantity, unit)
  VALUES ('83000000-0000-4000-8000-000000000013', 'Supervisor saved waste', 1, 'kg');
  INSERT INTO public.shift_issues(report_id, description, priority)
  VALUES ('83000000-0000-4000-8000-000000000013', 'Supervisor saved issue', 'normal');
  BEGIN
    INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by)
    VALUES ('83000000-0000-4000-8000-000000000014', '81000000-0000-4000-8000-000000000002', '2026-11-22', 'Morning', '82000000-0000-4000-8000-000000000006');
    RAISE EXCEPTION 'FAIL Supervisor inserted report outside assigned branch';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected Supervisor out-of-branch report insert denial'; END IF;
  RAISE NOTICE 'PASS daily_reports save and report_id-linked detail writes work for Supervisor in branch; cross-branch save denied';
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shift_issues' AND column_name='branch_id'
  ) THEN RAISE EXCEPTION 'FAIL shift_issues unexpectedly has branch_id'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shift_issues' AND column_name='report_id'
  ) THEN RAISE EXCEPTION 'FAIL shift_issues.report_id is missing'; END IF;
  RAISE NOTICE 'PASS shift_issues is associated by report_id only (no branch_id column)';
END;
$test$;

DO $test$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.get_daily_checklist_summary('2026-11-22', '2026-11-21');
    RAISE EXCEPTION 'FAIL summary accepted an inverted date range';
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL invalid summary date range was not rejected'; END IF;
  denied := false;
  BEGIN
    PERFORM 1 FROM public.get_daily_checklist_summary('2024-01-01', '2026-11-21');
    RAISE EXCEPTION 'FAIL summary accepted a range longer than 366 days';
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL excessive summary date range was not rejected'; END IF;
  RAISE NOTICE 'PASS summary RPC rejects inverted and oversized date ranges';
END;
$test$;

ROLLBACK;
