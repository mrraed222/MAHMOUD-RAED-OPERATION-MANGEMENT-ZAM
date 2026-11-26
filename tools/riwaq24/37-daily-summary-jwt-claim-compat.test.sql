-- Run only in a disposable PostgreSQL database as a superuser:
-- psql -v ON_ERROR_STOP=1 -f tools/riwaq24/37-daily-summary-jwt-claim-compat.test.sql
\set ON_ERROR_STOP on

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, status text);
CREATE TABLE public.admin_permissions (profile_id uuid, can_view_all_reports boolean);
CREATE TABLE public.manager_report_scopes (
  profile_id uuid, can_view_daily_checklist_summary boolean, scope_mode text
);
CREATE TABLE public.manager_report_scope_branches (profile_id uuid, branch_id uuid);
CREATE TABLE public.branches (id uuid PRIMARY KEY, name text, lifecycle_status text);
CREATE TABLE public.daily_reports (
  branch_id uuid, report_date date, shift_type text, entry_time time
);

\ir ../../supabase/migrations/20261126180000_daily_summary_without_auth_schema_dependency.sql

-- Match the live owner/execute grants observed before the proposed migration.
ALTER FUNCTION public.get_daily_checklist_summary_v2(date, date) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.get_daily_checklist_summary_v2(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_checklist_summary_v2(date, date) TO authenticated, service_role;
CREATE TEMP TABLE expected_function_acl AS
SELECT p.proowner AS expected_owner, p.proacl AS expected_acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_daily_checklist_summary_v2';

\ir ../../supabase/migrations/20261126220000_daily_summary_jwt_claim_compat.sql

DO $test$
DECLARE actual_owner oid; actual_acl aclitem[]; expected_owner oid; expected_acl aclitem[];
BEGIN
  SELECT e.expected_owner, e.expected_acl INTO expected_owner, expected_acl FROM expected_function_acl e;
  SELECT p.proowner, p.proacl INTO actual_owner, actual_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_daily_checklist_summary_v2';
  IF actual_owner IS DISTINCT FROM expected_owner OR actual_acl IS DISTINCT FROM expected_acl THEN
    RAISE EXCEPTION 'function owner or ACL changed';
  END IF;
END
$test$;

INSERT INTO public.profiles VALUES
 ('00000000-0000-0000-0000-000000000001','Owner','active'),
 ('00000000-0000-0000-0000-000000000002','Admin','active'),
 ('00000000-0000-0000-0000-000000000003','Manager','active'),
 ('00000000-0000-0000-0000-000000000004','Manager','active'),
 ('00000000-0000-0000-0000-000000000005','Manager','active'),
 ('00000000-0000-0000-0000-000000000006','Staff','active'),
 ('00000000-0000-0000-0000-000000000007','Owner','inactive'),
 ('00000000-0000-0000-0000-000000000008','Manager','active');
INSERT INTO public.admin_permissions VALUES ('00000000-0000-0000-0000-000000000002', true);
INSERT INTO public.manager_report_scopes VALUES
 ('00000000-0000-0000-0000-000000000003',true,'selected'),
 ('00000000-0000-0000-0000-000000000004',true,'all'),
 ('00000000-0000-0000-0000-000000000005',false,'all');
INSERT INTO public.manager_report_scope_branches VALUES
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001');
INSERT INTO public.branches VALUES
 ('10000000-0000-0000-0000-000000000001','A','open'),
 ('10000000-0000-0000-0000-000000000002','B','open'),
 ('10000000-0000-0000-0000-000000000003','Planned','planned');
INSERT INTO public.daily_reports VALUES
 ('10000000-0000-0000-0000-000000000001','2026-11-26','Morning','08:00'),
 ('10000000-0000-0000-0000-000000000002','2026-11-26','Morning','09:00'),
 ('10000000-0000-0000-0000-000000000003','2026-11-26','Morning','10:00');

DO $test$
DECLARE n integer;
BEGIN
  -- Modern JSON claim: selected Manager gets only branch A.
  PERFORM set_config('request.jwt.claim.sub','',false);
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003"}',false);
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
  IF n <> 1 THEN RAISE EXCEPTION 'selected Manager should see exactly one selected branch; got %', n; END IF;

  -- Manager with all scope gets both operational branches, never planned.
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004"}',false);
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
  IF n <> 2 THEN RAISE EXCEPTION 'all-scope Manager should see two operational branches; got %', n; END IF;

  -- Owner and permitted Admin retain all operational branch rows.
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001"}',false);
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
  IF n <> 2 THEN RAISE EXCEPTION 'Owner should see two operational branches; got %', n; END IF;
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002"}',false);
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
  IF n <> 2 THEN RAISE EXCEPTION 'permitted Admin should see two operational branches; got %', n; END IF;

  -- Scalar sub takes precedence over a conflicting JSON sub.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001"}',false);
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
  IF n <> 1 THEN RAISE EXCEPTION 'legacy scalar sub must take precedence; got %', n; END IF;

  -- Active Manager without an authorized scope, or with summary permission off, is denied.
  PERFORM set_config('request.jwt.claim.sub','',false);
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000005"}',false);
  BEGIN
    PERFORM * FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
    RAISE EXCEPTION 'Manager lacking summary permission unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000008"}',false);
  BEGIN
    PERFORM * FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
    RAISE EXCEPTION 'Manager with no configured scope unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Unauthorized role, inactive user, and invalid/missing JWT are denied.
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000006"}',false);
  BEGIN PERFORM * FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
    RAISE EXCEPTION 'unauthorized role unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000007"}',false);
  BEGIN PERFORM * FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
    RAISE EXCEPTION 'inactive Owner unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims','not-json',false);
  BEGIN PERFORM * FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
    RAISE EXCEPTION 'invalid JWT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{}',false);
  BEGIN PERFORM * FROM public.get_daily_checklist_summary_v2('2026-11-26','2026-11-26');
    RAISE EXCEPTION 'missing sub unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$test$;

\echo 'daily summary JWT compatibility integration tests: passed'
