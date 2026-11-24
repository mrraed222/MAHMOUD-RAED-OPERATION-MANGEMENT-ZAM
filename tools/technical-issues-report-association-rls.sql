\set ON_ERROR_STOP on

-- This test builds a disposable schema from the repository's base schema.sql,
-- applies the actual prerequisite and Riwaq migration files, then exercises the
-- combined RLS/trigger/RPC behavior. It never connects to a hosted project.
DO $roles$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
DO $roles$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
DO $roles$
BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, aud text, role text);
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(
  id text PRIMARY KEY, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE storage.objects(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth, storage TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

\ir ../schema.sql

-- The live schema has daily_reports.submitted_by; the checked-in base schema is
-- older, so reproduce the confirmed live column in this isolated fixture.
ALTER TABLE public.daily_reports
  ADD COLUMN submitted_by uuid REFERENCES public.profiles(id),
  ADD COLUMN entry_time time;
ALTER TABLE public.daily_reports ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.daily_reports ALTER COLUMN report_date SET NOT NULL;
ALTER TABLE public.daily_reports ALTER COLUMN shift_type SET NOT NULL;

-- Reproduce prerequisites added by earlier deployed migrations but absent from
-- the old base schema, without changing any migration under test.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (
  role IN ('Owner','Admin','Supervisor','Manager','Kitchen','Waiter','Barista','Quality')
);
ALTER TABLE public.branches
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'open',
  ADD COLUMN planned_opening_date date;
ALTER TABLE public.admin_permissions
  ADD COLUMN can_perform_branch_visits boolean NOT NULL DEFAULT false;
CREATE TABLE public.checklist_template_branches (
  template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, branch_id)
);
CREATE TABLE public.supervisory_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  visit_date date NOT NULL,
  shift_type text NOT NULL,
  supervisor_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.supervisory_visits ENABLE ROW LEVEL SECURITY;
-- The historical live table is not present in the checked-in base schema.
-- Model the columns consumed by the weekly report and start with a broad policy
-- so the candidate restrictive policy must enforce the parent visit's scope.
CREATE TABLE public.supervisory_visit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.supervisory_visits(id) ON DELETE CASCADE,
  note_text text,
  corrective_action text,
  owner text,
  due_date date,
  status text NOT NULL DEFAULT 'مفتوحة'
);
ALTER TABLE public.supervisory_visit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY supervisory_visit_notes_read ON public.supervisory_visit_notes
  FOR SELECT TO authenticated USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.branches, public.admin_permissions TO authenticated;

-- Actual prerequisite migrations needed to create the report and visit contracts.
\ir ../supabase/migrations/20260820115933_enforce_supervisor_report_insert_branch.sql
\ir ../supabase/migrations/20261114153000_visit_audit_workflow.sql
\ir ../supabase/migrations/20261114170000_fridge_temperature_tracking.sql
\ir ../supabase/migrations/20261114203000_refine_visit_checklist_items.sql
\ir ../supabase/migrations/20261115135000_visit_pdf_and_operational_items.sql
\ir ../supabase/migrations/20261115143000_add_visit_type.sql
\ir ../supabase/migrations/20261115160000_supervisor_visit_action_read.sql
\ir ../supabase/migrations/20261115172000_branch_visit_assignments_and_15_criteria.sql
\ir ../supabase/migrations/20261115181500_visit_action_review_workflow.sql
\ir ../supabase/migrations/20261117144417_add_technical_issue_internal_comment.sql
\ir ../supabase/migrations/20261118180500_supervisor_technical_issue_branch_updates.sql

-- The actual combined Riwaq report, recipient, explicit-link and final-integrity migrations.
\ir ../supabase/migrations/20261122190000_riwaq_assignments_scopes_quality.sql
\ir ../supabase/migrations/20261122193000_manager_analytics_permission_prerequisite.sql
\ir ../supabase/migrations/20261122194000_daily_report_scope_and_email_recipients.sql
\ir ../supabase/migrations/20261122231500_technical_issue_report_association.sql
\ir ../supabase/migrations/20261122233700_report_scope_integrity_and_send_idempotency.sql
\ir ../supabase/migrations/20261123020500_supervisor_report_detail_insert_rls.sql

-- Seed legacy permissions before applying the candidate migration so its
-- compatibility backfill is exercised against real pre-migration rows.
INSERT INTO public.branches(id, name, lifecycle_status) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Fixture Branch A', 'open'),
  ('10000000-0000-4000-8000-000000000002', 'Fixture Branch B', 'open'),
  ('10000000-0000-4000-8000-000000000003', 'Planned Branch C', 'planned');

INSERT INTO public.checklist_templates(id, task_title, category, shift_type, branch_id)
VALUES ('11000000-0000-4000-8000-000000000001', 'Fixture template', 'Fixture', 'Morning', NULL);
INSERT INTO public.checklist_template_branches(template_id, branch_id)
VALUES ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');

INSERT INTO public.profiles(id, full_name, email, passcode, role, status, branch_id, shift_type) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Fixture Owner', 'owner@example.test', 'fixture-owner', 'Owner', 'active', '10000000-0000-4000-8000-000000000001', 'Both'),
  ('20000000-0000-4000-8000-000000000002', 'Fixture Manager', 'manager@example.test', 'fixture-manager', 'Manager', 'active', '10000000-0000-4000-8000-000000000001', 'Both'),
  ('20000000-0000-4000-8000-000000000003', 'Morning Supervisor', 'morning@example.test', 'fixture-morning', 'Supervisor', 'active', '10000000-0000-4000-8000-000000000001', 'Morning'),
  ('20000000-0000-4000-8000-000000000004', 'Evening Supervisor', 'evening@example.test', 'fixture-evening', 'Supervisor', 'active', '10000000-0000-4000-8000-000000000001', 'Evening'),
  ('20000000-0000-4000-8000-000000000005', 'Branch B Supervisor', 'branchb@example.test', 'fixture-branchb', 'Supervisor', 'active', '10000000-0000-4000-8000-000000000002', 'Morning'),
  ('20000000-0000-4000-8000-000000000006', 'Quality Inspector', 'quality@example.test', 'fixture-quality', 'Quality', 'active', '10000000-0000-4000-8000-000000000001', 'Both'),
  ('20000000-0000-4000-8000-000000000007', 'Fixture Admin', 'admin@example.test', 'fixture-admin', 'Admin', 'active', '10000000-0000-4000-8000-000000000001', 'Both'),
  ('20000000-0000-4000-8000-000000000008', 'Fixture Barista', 'barista@example.test', 'fixture-barista', 'Barista', 'active', '10000000-0000-4000-8000-000000000001', 'Morning');
INSERT INTO auth.users(id) VALUES
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000004'),
  ('20000000-0000-4000-8000-000000000005'),
  ('20000000-0000-4000-8000-000000000006'),
  ('20000000-0000-4000-8000-000000000007'),
  ('20000000-0000-4000-8000-000000000008');
INSERT INTO public.admin_permissions(
  profile_id, can_manage_automations, can_view_all_reports,
  can_manage_branch_visits, can_perform_branch_visits
) VALUES
  ('20000000-0000-4000-8000-000000000001', true, true, true, true),
  ('20000000-0000-4000-8000-000000000002', false, true, true, false),
  ('20000000-0000-4000-8000-000000000006', false, false, false, true),
  ('20000000-0000-4000-8000-000000000007', false, false, false, false);

\ir ../supabase/migrations/20261123110000_manager_branch_scoped_read_permissions.sql
\ir ../supabase/migrations/20261123120000_manager_summary_projection_and_read_separation.sql
\ir ../supabase/migrations/20261123121500_reject_planned_checklist_template_branches.sql

GRANT SELECT, INSERT, UPDATE ON public.checklist_templates TO authenticated;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
DO $test$
DECLARE rejected boolean;
BEGIN
  BEGIN
    INSERT INTO public.checklist_templates(task_title, category, shift_type, branch_id)
    VALUES ('Direct planned template', 'Fixture', 'Morning', '10000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL direct checklist_templates INSERT accepted a planned legacy branch';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS direct checklist_templates INSERT rejects planned legacy branch';
  END;
  BEGIN
    UPDATE public.checklist_templates SET branch_id = '10000000-0000-4000-8000-000000000003'
    WHERE id = '11000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL direct checklist_templates UPDATE accepted a planned legacy branch';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS direct checklist_templates UPDATE rejects planned legacy branch';
  END;
  BEGIN
    PERFORM public.version_checklist_template(
      '11000000-0000-4000-8000-000000000001',
      '{"branch_id":"10000000-0000-4000-8000-000000000003"}'::jsonb
    );
    RAISE EXCEPTION 'FAIL version_checklist_template accepted a planned legacy branch';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS version_checklist_template rejects planned legacy branch';
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.checklist_templates
    WHERE id = '11000000-0000-4000-8000-000000000001' AND is_active AND branch_id IS NULL
  ) THEN RAISE EXCEPTION 'FAIL rejected legacy branch writes changed the original template'; END IF;
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  BEGIN
    INSERT INTO public.checklist_template_branches(template_id, branch_id)
    VALUES ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL template branch trigger accepted a planned branch INSERT';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS template branch trigger rejects planned branch INSERT';
  END;
  BEGIN
    UPDATE public.checklist_template_branches
    SET branch_id = '10000000-0000-4000-8000-000000000003'
    WHERE template_id = '11000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL template branch trigger accepted a planned branch UPDATE';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS template branch trigger rejects planned branch UPDATE';
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.checklist_template_branches
    WHERE template_id = '11000000-0000-4000-8000-000000000001'
      AND branch_id = '10000000-0000-4000-8000-000000000001'
  ) THEN RAISE EXCEPTION 'FAIL rejected template scope update did not preserve existing open-branch scope'; END IF;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
    VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL planned branch was accepted into a Manager selected scope';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS selected Manager scope rejects a planned branch';
  END;
END;
$test$;

ROLLBACK;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_reports, public.technical_issues,
  public.branch_visit_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.waste_logs, public.shift_issues,
  public.negative_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_logs, public.hourly_checklist_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supervisory_visits,
  public.supervisory_visit_results, public.visit_action_items, public.visit_evidence,
  public.visit_email_logs TO authenticated;
GRANT SELECT ON public.supervisory_visit_notes TO authenticated;
GRANT SELECT ON public.visit_action_review_events TO authenticated;
GRANT SELECT, INSERT ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT ON public.daily_reports, public.technical_issues,
  public.branch_visit_assignments TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

BEGIN;

INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by, supervisor_name) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-11-21', 'Morning', '20000000-0000-4000-8000-000000000003', 'Morning Supervisor'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '2026-11-21', 'Evening', '20000000-0000-4000-8000-000000000004', 'Evening Supervisor'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '2026-11-21', 'Morning', '20000000-0000-4000-8000-000000000005', 'Branch B Supervisor'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', '2026-11-21', 'Morning', '20000000-0000-4000-8000-000000000001', 'Planned Branch Owner');

INSERT INTO public.technical_issues(id, branch_id, reported_by, source, title, report_id) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'manual', 'Linked A morning', '30000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'manual', 'Linked A evening', '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'manual', 'Historical unlinked A', NULL),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'manual', 'Linked B morning', '30000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'manual', 'Historical unlinked B', NULL);

-- Manager scope: selected branch A, then all, then none. Both linked and
-- historical unlinked issues must follow branch_id scope.
INSERT INTO public.manager_report_scopes(profile_id, scope_mode, configured_by)
VALUES ('20000000-0000-4000-8000-000000000002', 'selected', '20000000-0000-4000-8000-000000000001');
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id IN (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003'
  );
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL supervisor read expected own branch+shift only, got %', n; END IF;

  INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by)
  VALUES ('30000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '2026-11-22', 'Morning', '20000000-0000-4000-8000-000000000003');

  BEGIN
    INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by)
    VALUES ('30000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '2026-11-22', 'Evening', '20000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL Supervisor inserted a report for another shift';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS Supervisor INSERT denied for another shift';
  END;

  BEGIN
    INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by)
    VALUES ('30000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000002', '2026-11-22', 'Morning', '20000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL Supervisor inserted a report for another branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS Supervisor INSERT denied for another branch';
  END;
END;
$test$;

-- Exact report association, historical exclusion, cross-shift denial and
-- same-branch read scoping for a Supervisor.
DO $test$
DECLARE n integer;
BEGIN
  INSERT INTO public.technical_issues(id, branch_id, reported_by, source, title, report_id)
  VALUES ('40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000003', 'manual', 'Linked during current report flow',
    '30000000-0000-4000-8000-000000000001');

  SELECT count(*) INTO n FROM public.technical_issues
  WHERE report_id = '30000000-0000-4000-8000-000000000001';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL exact report ID expected two linked issues, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.technical_issues WHERE id IN (
    '40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000004'
  )) THEN RAISE EXCEPTION 'FAIL linked issue leaked across shift or branch'; END IF;

  SELECT count(*) INTO n FROM public.technical_issues;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL Supervisor expected own-shift link plus unlinked history, got %', n; END IF;

  UPDATE public.technical_issues SET title = 'Supervisor branch update'
  WHERE id = '40000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Supervisor could not update their branch issue'; END IF;
  UPDATE public.technical_issues SET title = 'Supervisor cross-branch update'
  WHERE id = '40000000-0000-4000-8000-000000000004';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL Supervisor updated an issue outside their branch'; END IF;

  BEGIN
    INSERT INTO public.technical_issues(id, branch_id, reported_by, source, title, report_id)
    VALUES ('40000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000003', 'manual', 'Unauthorized evening link',
      '30000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'FAIL Supervisor linked issue to another shift report';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS RLS rejects link to another shift report';
  END;

  BEGIN
    INSERT INTO public.technical_issues(id, branch_id, reported_by, source, title, report_id)
    VALUES ('40000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003', 'manual', 'Unauthorized other-branch link',
      '30000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'FAIL Supervisor inserted issue for another branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS RLS rejects issue creation outside Supervisor branch';
  END;
END;
$test$;
RESET ROLE;

-- Supervisor detail inserts must reference the exact report submitted by the
-- current user and still within their present branch/shift authorization.
INSERT INTO public.daily_reports(id, branch_id, report_date, shift_type, submitted_by, supervisor_name) VALUES
  ('30000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', '2026-11-21', 'Morning', '20000000-0000-4000-8000-000000000001', 'Owner-created fixture');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
DO $test$
BEGIN
  INSERT INTO public.waste_logs(report_id, item_name, quantity, unit, reason)
  VALUES ('30000000-0000-4000-8000-000000000001', 'Fixture coffee', 1, 'kg', 'authorized report');
  INSERT INTO public.shift_issues(report_id, description, action_taken, priority)
  VALUES ('30000000-0000-4000-8000-000000000001', 'Fixture issue', 'Fixture action', 'normal');
  INSERT INTO public.negative_reviews(report_id, comment_text, review_type)
  VALUES ('30000000-0000-4000-8000-000000000001', 'Fixture review', 'negative');
  RAISE NOTICE 'PASS Supervisor inserts all three detail types for their authorized report';

  BEGIN
    INSERT INTO public.waste_logs(report_id, item_name, quantity)
    VALUES ('30000000-0000-4000-8000-000000000002', 'Other shift', 1);
    RAISE EXCEPTION 'FAIL Supervisor inserted waste linked to another shift';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS waste INSERT rejects another shift';
  END;
  BEGIN
    INSERT INTO public.shift_issues(report_id, description)
    VALUES ('30000000-0000-4000-8000-000000000002', 'Other shift');
    RAISE EXCEPTION 'FAIL Supervisor inserted shift issue linked to another shift';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS shift issue INSERT rejects another shift';
  END;
  BEGIN
    INSERT INTO public.negative_reviews(report_id, comment_text)
    VALUES ('30000000-0000-4000-8000-000000000002', 'Other shift');
    RAISE EXCEPTION 'FAIL Supervisor inserted review linked to another shift';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS review INSERT rejects another shift';
  END;

  BEGIN
    INSERT INTO public.waste_logs(report_id, item_name, quantity)
    VALUES ('30000000-0000-4000-8000-000000000003', 'Other branch', 1);
    RAISE EXCEPTION 'FAIL Supervisor inserted waste linked to another branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS waste INSERT rejects another branch';
  END;
  BEGIN
    INSERT INTO public.shift_issues(report_id, description)
    VALUES ('30000000-0000-4000-8000-000000000003', 'Other branch');
    RAISE EXCEPTION 'FAIL Supervisor inserted shift issue linked to another branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS shift issue INSERT rejects another branch';
  END;
  BEGIN
    INSERT INTO public.negative_reviews(report_id, comment_text)
    VALUES ('30000000-0000-4000-8000-000000000003', 'Other branch');
    RAISE EXCEPTION 'FAIL Supervisor inserted review linked to another branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS review INSERT rejects another branch';
  END;

  BEGIN
    INSERT INTO public.waste_logs(report_id, item_name, quantity)
    VALUES ('30000000-0000-4000-8000-000000000014', 'Not my report', 1);
    RAISE EXCEPTION 'FAIL Supervisor inserted waste linked to another submitter report';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS waste INSERT rejects another submitter report';
  END;
  BEGIN
    INSERT INTO public.shift_issues(report_id, description)
    VALUES ('30000000-0000-4000-8000-000000000014', 'Not my report');
    RAISE EXCEPTION 'FAIL Supervisor inserted shift issue linked to another submitter report';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS shift issue INSERT rejects another submitter report';
  END;
  BEGIN
    INSERT INTO public.negative_reviews(report_id, comment_text)
    VALUES ('30000000-0000-4000-8000-000000000014', 'Not my report');
    RAISE EXCEPTION 'FAIL Supervisor inserted review linked to another submitter report';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS review INSERT rejects another submitter report';
  END;
END;
$test$;
RESET ROLE;
DELETE FROM public.daily_reports WHERE id = '30000000-0000-4000-8000-000000000014';

-- Explicit cross-branch association must also fail at the composite foreign key.
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.technical_issues(id, branch_id, reported_by, source, title, report_id)
    VALUES ('40000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000005', 'manual', 'Mismatched branch association',
      '30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL mismatched report and issue branches were accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS composite FK rejects cross-branch association';
  END;

  BEGIN
    UPDATE public.technical_issues SET report_id = NULL
    WHERE id = '40000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL manual clearing of report_id was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS manual report_id clearing is rejected';
  END;
END;
$test$;

-- The Edge Function performs its current authenticated daily_reports SELECT
-- before any service-role read. These assertions model changes to the sender's
-- live shift, branch, or role between saving a report and requesting its copy.
UPDATE public.profiles SET shift_type='Evening'
WHERE id='20000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id='30000000-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL changed Supervisor shift retained access to old-shift report'; END IF;
  SELECT count(*) INTO n FROM public.daily_reports WHERE id='30000000-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL changed Supervisor shift did not follow current shift'; END IF;
  RAISE NOTICE 'PASS current report visibility follows changed Supervisor shift';
END;
$test$;
RESET ROLE;
UPDATE public.profiles SET shift_type='Morning', branch_id='10000000-0000-4000-8000-000000000002'
WHERE id='20000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports WHERE id='30000000-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL changed Supervisor branch retained access to old-branch report'; END IF;
  SELECT count(*) INTO n FROM public.daily_reports WHERE id='30000000-0000-4000-8000-000000000003';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL changed Supervisor branch did not follow current branch'; END IF;
  RAISE NOTICE 'PASS current report visibility follows changed Supervisor branch';
END;
$test$;
RESET ROLE;
UPDATE public.profiles SET role='Barista', branch_id='10000000-0000-4000-8000-000000000001'
WHERE id='20000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL changed report-sender role retained Supervisor report visibility'; END IF;
  RAISE NOTICE 'PASS current report visibility is revoked after role change';
END;
$test$;
RESET ROLE;
UPDATE public.profiles SET role='Supervisor', shift_type='Morning', branch_id='10000000-0000-4000-8000-000000000001'
WHERE id='20000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
DO $test$
BEGIN
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL Supervisor lost report-copy permission for their current branch and shift';
  END IF;
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000002') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL Supervisor report-copy permission crossed to another shift';
  END IF;
  RAISE NOTICE 'PASS daily report-copy RPC preserves Supervisor branch/shift scope';
END;
$test$;
RESET ROLE;

-- Manager issue updates must follow selected/all/none report scope, including
-- historical unlinked issues, which are scoped by their own branch_id.
UPDATE public.manager_report_scopes SET scope_mode = 'selected'
WHERE profile_id = '20000000-0000-4000-8000-000000000002';
DELETE FROM public.manager_report_scope_branches WHERE profile_id = '20000000-0000-4000-8000-000000000002';
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL selected Manager report reads expected two original branch-A reports and one new own-branch report, got %', n; END IF;
  UPDATE public.technical_issues SET title = 'manager-selected'
  WHERE id IN (
    '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000005'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL selected Manager update expected 3 branch-A rows including history, got %', n; END IF;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
  IF (SELECT title FROM public.technical_issues WHERE id='40000000-0000-4000-8000-000000000003') <> 'manager-selected'
     OR (SELECT title FROM public.technical_issues WHERE id='40000000-0000-4000-8000-000000000005') <> 'Historical unlinked B' THEN
    RAISE EXCEPTION 'FAIL selected Manager scope mishandled historical issue rows';
  END IF;
END;
$test$;

-- The full-detail copy endpoint's RPC requires a Manager's branch scope and
-- analytics permission; daily-summary permission alone is not sufficient.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
BEGIN
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL selected Manager cannot generate a copy in the selected branch';
  END IF;
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000003') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL selected Manager generated a copy outside selected branches';
  END IF;
END;
$test$;
RESET ROLE;
UPDATE public.manager_report_scopes SET scope_mode='all'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
DELETE FROM public.manager_report_scope_branches WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
BEGIN
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000003') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL all-scope Manager cannot generate a copy for another branch';
  END IF;
  RAISE NOTICE 'PASS daily report-copy RPC follows all-branch scope';
END;
$test$;
RESET ROLE;
UPDATE public.manager_report_scopes SET scope_mode='none'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
BEGIN
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL none-scope Manager retained daily report-copy permission';
  END IF;
END;
$test$;
RESET ROLE;
UPDATE public.manager_report_scopes SET scope_mode='all'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
UPDATE public.admin_permissions SET
  can_view_daily_checklist_summary=true,
  can_view_analytics=false
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
BEGIN
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL summary-only Manager generated a full-detail daily report copy';
  END IF;
  RAISE NOTICE 'PASS full-detail daily report-copy RPC rejects summary-only Manager';
END;
$test$;
RESET ROLE;
UPDATE public.admin_permissions SET
  can_view_daily_checklist_summary=true,
  can_view_analytics=true
WHERE profile_id='20000000-0000-4000-8000-000000000002';
UPDATE public.manager_report_scopes SET scope_mode='selected'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');

UPDATE public.manager_report_scopes SET scope_mode = 'all'
WHERE profile_id = '20000000-0000-4000-8000-000000000002';
DELETE FROM public.manager_report_scope_branches WHERE profile_id = '20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL all-scope Manager should see all four reports, got %', n; END IF;
  UPDATE public.technical_issues SET title = 'manager-all'
  WHERE id IN (
    '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000005'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL all-branch Manager update expected five rows, got %', n; END IF;
  RAISE NOTICE 'PASS Manager all scope reads every report and updates issues across all branches';
END;
$test$;
RESET ROLE;

UPDATE public.manager_report_scopes SET scope_mode = 'none'
WHERE profile_id = '20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL none-scope Manager retained report visibility'; END IF;
  UPDATE public.technical_issues SET title = 'manager-none'
  WHERE id IN (
    '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000005'
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL none-scope Manager updated % rows', n; END IF;
  RAISE NOTICE 'PASS Manager none scope cannot read reports or update linked/historical issues';
END;
$test$;
RESET ROLE;

-- Summary visibility alone cannot write; write permission is explicit and separate.
UPDATE public.manager_report_scopes SET scope_mode = 'all'
WHERE profile_id = '20000000-0000-4000-8000-000000000002';
UPDATE public.admin_permissions SET
  can_manage_reports = false,
  can_view_all_reports = false,
  can_view_daily_checklist_summary = true,
  can_view_checklist_logs = false,
  can_view_analytics = false
WHERE profile_id = '20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE rejected boolean := false;
BEGIN
  IF public.can_manager_write_daily_report('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL Manager without can_manage_reports retained the report write helper';
  END IF;
  BEGIN
    INSERT INTO public.waste_logs(report_id, item_name, quantity, unit, reason)
    VALUES ('30000000-0000-4000-8000-000000000001', 'no-write-permission', 1, 'unit', 'permission test');
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL Manager without can_manage_reports inserted a report child'; END IF;
  RAISE NOTICE 'PASS Manager without can_manage_reports cannot write report details';
END;
$test$;
RESET ROLE;
UPDATE public.admin_permissions SET can_manage_reports = true
WHERE profile_id = '20000000-0000-4000-8000-000000000002';

-- The daily-summary capability is projection-only: even with all branch scope,
-- it cannot SELECT source reports, report details, or technical analytics.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read % raw daily reports', n; END IF;
  SELECT count(*) INTO n FROM public.waste_logs;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read % waste details', n; END IF;
  SELECT count(*) INTO n FROM public.shift_issues;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read % shift issue details', n; END IF;
  SELECT count(*) INTO n FROM public.negative_reviews;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read % review details', n; END IF;
  SELECT count(*) INTO n FROM public.technical_issues;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager read % technical analytics rows', n; END IF;
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary('2026-11-21');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL summary projection expected three operational branch/shift rows, got %', n; END IF;
  IF public.can_manager_write_daily_report('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL fixture Manager lacks the explicit scoped report write grant';
  END IF;
  IF public.can_manager_read_daily_report_details('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL summary-only Manager unexpectedly has report detail visibility';
  END IF;
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL summary-only Manager generated a full-detail PDF';
  END IF;
  INSERT INTO public.waste_logs(report_id, item_name, quantity, unit, reason)
  VALUES ('30000000-0000-4000-8000-000000000001', 'RLS write-only fixture', 1, 'unit', 'permission test');
  UPDATE public.waste_logs SET reason = 'must remain hidden'
  WHERE report_id = '30000000-0000-4000-8000-000000000001'
    AND item_name = 'RLS write-only fixture';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL write-only Manager updated a row hidden by SELECT RLS'; END IF;
  DELETE FROM public.waste_logs
  WHERE report_id = '30000000-0000-4000-8000-000000000001'
    AND item_name = 'RLS write-only fixture';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL write-only Manager deleted a row hidden by SELECT RLS'; END IF;
  UPDATE public.daily_reports SET total_sales = total_sales + 1
  WHERE id = '30000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager updated a hidden parent report'; END IF;
  DELETE FROM public.daily_reports WHERE id = '30000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary-only Manager deleted a hidden parent report'; END IF;
  RAISE NOTICE 'PASS write-only Manager can INSERT but UPDATE/DELETE of SELECT-hidden rows affect zero rows';
  RAISE NOTICE 'PASS summary-only Manager sees only the limited operational daily-summary projection';
END;
$test$;
RESET ROLE;
DELETE FROM public.waste_logs WHERE item_name = 'RLS write-only fixture';
SET LOCAL ROLE service_role;
DO $test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.get_daily_report_copy_recipients('30000000-0000-4000-8000-000000000001')
    WHERE profile_id = '20000000-0000-4000-8000-000000000002'
  ) THEN RAISE EXCEPTION 'FAIL default full-PDF recipient resolver included a summary-only Manager'; END IF;
  RAISE NOTICE 'PASS default full-PDF recipient resolver excludes summary-only Manager';
END;
$test$;
RESET ROLE;

-- The analytics capability is independent: analytics-only Managers can read
-- scoped source rows, but cannot use the daily-summary RPC.
UPDATE public.admin_permissions SET
  can_view_daily_checklist_summary = false,
  can_view_analytics = true
WHERE profile_id = '20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.daily_reports;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL analytics-only Manager expected four scoped operational reports, got %', n; END IF;
  SELECT count(*) INTO n FROM public.get_daily_checklist_summary('2026-11-21');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL analytics-only Manager accessed the daily-summary projection'; END IF;
  IF public.can_generate_daily_report_copy('30000000-0000-4000-8000-000000000001') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL analytics-only Manager could not generate a full-detail PDF';
  END IF;
  RAISE NOTICE 'PASS analytics-only Manager access is independent from daily-summary access';
END;
$test$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.get_daily_report_copy_recipients('30000000-0000-4000-8000-000000000001')
    WHERE profile_id = '20000000-0000-4000-8000-000000000002'
  ) THEN RAISE EXCEPTION 'FAIL default full-PDF recipient resolver omitted scoped analytics-only Manager'; END IF;
  RAISE NOTICE 'PASS default full-PDF recipient resolver includes analytics-only Manager with all-branch scope';
END;
$test$;
RESET ROLE;
UPDATE public.admin_permissions SET
  can_view_all_reports = true,
  can_view_daily_checklist_summary = true,
  can_view_analytics = true
WHERE profile_id = '20000000-0000-4000-8000-000000000002';

-- A configured selected-scope primary is valid for its selected branch only;
-- reports for other branches still resolve to the Owner and omit that Manager.
UPDATE public.manager_report_scopes SET scope_mode = 'selected'
WHERE profile_id = '20000000-0000-4000-8000-000000000002';
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
SELECT public.save_daily_report_email_recipients(
  '[{"profile_id":"20000000-0000-4000-8000-000000000001","scope_mode":"all_authorized","branch_ids":[]},{"profile_id":"20000000-0000-4000-8000-000000000002","scope_mode":"selected","branch_ids":["10000000-0000-4000-8000-000000000001"]},{"profile_id":"20000000-0000-4000-8000-000000000003","scope_mode":"all_authorized","branch_ids":[]}]'::jsonb,
  '20000000-0000-4000-8000-000000000002'
);
RESET ROLE;
SET LOCAL ROLE service_role;
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_daily_report_copy_recipients('30000000-0000-4000-8000-000000000001')
  WHERE profile_id IN ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL branch-A recipient resolver expected Owner, selected Manager, and current shift Supervisor, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.get_daily_report_copy_recipients('30000000-0000-4000-8000-000000000002') WHERE profile_id='20000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'FAIL shift Supervisor received another Supervisor report';
  END IF;
  SELECT count(*) INTO n FROM public.get_daily_report_copy_recipients('30000000-0000-4000-8000-000000000003')
  WHERE profile_id='20000000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Owner should receive report outside selected primary Manager scope'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_daily_report_copy_recipients('30000000-0000-4000-8000-000000000003') WHERE profile_id='20000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL selected primary Manager received a report outside configured branch scope';
  END IF;
  RAISE NOTICE 'PASS recipients respect active user, selected Manager scope, Owner fallback, and own-report Supervisor rule';
END;
$test$;
RESET ROLE;

-- One logical send per report: stable key for unknown outcomes, reject changed
-- payloads, suppress sends after success, and require reconciliation after 24h.
SET LOCAL ROLE service_role;
DO $test$
DECLARE first_claim jsonb; retry_claim jsonb; changed_claim jsonb; sent_claim jsonb; expired_claim jsonb; key1 text;
BEGIN
  first_claim := public.claim_daily_report_email_send('30000000-0000-4000-8000-000000000001', repeat('a',64));
  IF first_claim->>'decision' <> 'send' THEN RAISE EXCEPTION 'FAIL initial send claim: %', first_claim; END IF;
  key1 := first_claim->>'idempotency_key';
  PERFORM public.finish_daily_report_email_send('30000000-0000-4000-8000-000000000001', repeat('a',64), 'unknown', NULL);
  retry_claim := public.claim_daily_report_email_send('30000000-0000-4000-8000-000000000001', repeat('a',64));
  IF retry_claim->>'decision' <> 'send' OR retry_claim->>'idempotency_key' <> key1 THEN
    RAISE EXCEPTION 'FAIL uncertain retry did not reuse same key: %', retry_claim;
  END IF;
  changed_claim := public.claim_daily_report_email_send('30000000-0000-4000-8000-000000000001', repeat('b',64));
  IF changed_claim->>'decision' <> 'payload_changed' THEN RAISE EXCEPTION 'FAIL payload changed: %', changed_claim; END IF;
  PERFORM public.finish_daily_report_email_send('30000000-0000-4000-8000-000000000001', repeat('a',64), 'sent', 'mock-resend-id');
  sent_claim := public.claim_daily_report_email_send('30000000-0000-4000-8000-000000000001', repeat('a',64));
  IF sent_claim->>'decision' <> 'already_sent' THEN RAISE EXCEPTION 'FAIL duplicate send not suppressed: %', sent_claim; END IF;

  first_claim := public.claim_daily_report_email_send('30000000-0000-4000-8000-000000000002', repeat('c',64));
  PERFORM public.finish_daily_report_email_send('30000000-0000-4000-8000-000000000002', repeat('c',64), 'unknown', NULL);
  RESET ROLE;
  UPDATE public.daily_report_email_sends SET first_attempt_at = clock_timestamp() - interval '25 hours'
  WHERE report_id = '30000000-0000-4000-8000-000000000002';
  SET LOCAL ROLE service_role;
  expired_claim := public.claim_daily_report_email_send('30000000-0000-4000-8000-000000000002', repeat('c',64));
  IF expired_claim->>'decision' <> 'reconciliation_required' THEN RAISE EXCEPTION 'FAIL expired uncertain send: %', expired_claim; END IF;
  RAISE NOTICE 'PASS email ledger reuses idempotency key, rejects changed payload, suppresses confirmed duplicate, and requires reconciliation after expiry';
END;
$test$;
RESET ROLE;

-- Visit-assignment snapshot and live revalidation. Stale Quality role or
-- capability must fail both the submit helper and completion trigger, while the
-- separate Manager path can still complete a delegated assignment.
INSERT INTO public.branch_visit_assignments(
  id, branch_id, assigned_to, assigned_by, visit_date, shift_type, visit_type
) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '2026-11-22', 'Morning', 'Quality cross-branch'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '2026-11-22', 'Morning', 'Manager-path check');
UPDATE public.profiles SET role='Barista' WHERE id='20000000-0000-4000-8000-000000000006';
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000006', true);
DO $test$
DECLARE err text; succeeded boolean := false;
BEGIN
  IF public.can_submit_assigned_branch_visit('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','2026-11-22','Morning') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL stale Quality assignment remained submittable after role change';
  END IF;
  BEGIN
    UPDATE public.branch_visit_assignments SET status='completed', completed_at=now()
    WHERE id='50000000-0000-4000-8000-000000000001';
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  IF succeeded OR err NOT LIKE '%تكليف الزيارة الحالي%' THEN
    RAISE EXCEPTION 'FAIL completion did not reject stale Quality role; result=%', COALESCE(err,'updated');
  END IF;
  RAISE NOTICE 'PASS visit submit/completion reject stale Quality role';
END;
$test$;

UPDATE public.profiles SET role='Quality' WHERE id='20000000-0000-4000-8000-000000000006';
UPDATE public.admin_permissions SET can_perform_branch_visits=true WHERE profile_id='20000000-0000-4000-8000-000000000006';
INSERT INTO public.branch_visit_assignments(
  id, branch_id, assigned_to, assigned_by, visit_date, shift_type, visit_type
) VALUES (
  '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001',
  '2026-11-22', 'Evening', 'Quality eligibility revoked'
);
UPDATE public.admin_permissions SET can_perform_branch_visits=false WHERE profile_id='20000000-0000-4000-8000-000000000006';
DO $test$
DECLARE err text; succeeded boolean := false;
BEGIN
  IF public.can_submit_assigned_branch_visit('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','2026-11-22','Evening') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL disabled Quality assignment remained submittable';
  END IF;
  BEGIN
    UPDATE public.branch_visit_assignments SET status='completed', completed_at=now()
    WHERE id='50000000-0000-4000-8000-000000000002';
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  IF succeeded OR err NOT LIKE '%تكليف الزيارة الحالي%' THEN
    RAISE EXCEPTION 'FAIL completion did not reject disabled Quality assignment; result=%', COALESCE(err,'updated');
  END IF;
  RAISE NOTICE 'PASS visit submit/completion reject revoked Quality eligibility';
END;
$test$;

SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
BEGIN
  IF public.can_submit_assigned_branch_visit('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','2026-11-22','Morning') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL Manager authorized path denied';
  END IF;
  UPDATE public.branch_visit_assignments SET status='completed', completed_at=now()
  WHERE id='50000000-0000-4000-8000-000000000003';
  RAISE NOTICE 'PASS authorized Manager visit path remains available';
END;
$test$;

-- The FK's ON DELETE SET NULL must work through the protection trigger, while
-- manual clearing above remains rejected.
DELETE FROM public.daily_reports WHERE id='30000000-0000-4000-8000-000000000001';
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.technical_issues WHERE id IN (
    '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000006'
  ) AND report_id IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL ON DELETE SET NULL did not clear association';
  END IF;
  IF (SELECT report_id FROM public.technical_issues WHERE id='40000000-0000-4000-8000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL historical unlinked issue unexpectedly changed';
  END IF;
  RAISE NOTICE 'PASS ON DELETE SET NULL clears report association but preserves issue and historical rows';
END;
$test$;


-- Isolated visit-read fixtures cover a branch-scoped Manager, an action-review
-- Manager, a direct action assignee, and specifically assigned branch visits.
INSERT INTO public.branch_visit_assignments(id, branch_id, assigned_to, assigned_by, visit_date, shift_type) VALUES
  ('77000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '2026-11-23', 'Morning'),
  ('77000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '2026-11-23', 'Morning'),
  ('77000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '2026-11-23', 'Morning'),
  ('77000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '2026-11-23', 'Morning');
INSERT INTO public.supervisory_visits(id, branch_id, visit_date, shift_type, supervisor_name, assignment_id) VALUES
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-11-23', 'Morning', 'Morning Supervisor', '77000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '2026-11-23', 'Morning', 'Branch B Supervisor', NULL),
  ('70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '2026-11-23', 'Evening', 'Branch B Supervisor', NULL),
  ('70000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '2026-11-23', 'Morning', 'Mismatched branch assignment', '77000000-0000-4000-8000-000000000002'),
  ('70000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '2026-11-24', 'Morning', 'Mismatched date assignment', '77000000-0000-4000-8000-000000000003'),
  ('70000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '2026-11-23', 'Evening', 'Mismatched shift assignment', '77000000-0000-4000-8000-000000000004'),
  ('70000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', '2026-11-23', 'Morning', 'Planned Branch C Supervisor', NULL);

INSERT INTO public.supervisory_visit_results(id, visit_id, item_id, score, result, is_violation) VALUES
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', (SELECT id FROM public.visit_checklist_templates ORDER BY sort_order, id LIMIT 1), 10, 'مطابق', false),
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', (SELECT id FROM public.visit_checklist_templates ORDER BY sort_order, id OFFSET 1 LIMIT 1), 5, 'جزئي', true),
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', (SELECT id FROM public.visit_checklist_templates ORDER BY sort_order, id OFFSET 2 LIMIT 1), 0, 'غير مطابق', true),
  ('71000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000002', (SELECT id FROM public.visit_checklist_templates ORDER BY sort_order, id OFFSET 3 LIMIT 1), 7, 'لا ينطبق', true);

INSERT INTO public.visit_action_items(id, visit_id, result_id, branch_id, title, assigned_to, shift_type, created_by) VALUES
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Branch A authorized task', '20000000-0000-4000-8000-000000000003', 'Morning', '20000000-0000-4000-8000-000000000003'),
  ('72000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Pending review task', '20000000-0000-4000-8000-000000000005', 'Morning', '20000000-0000-4000-8000-000000000005'),
  ('72000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Unrelated open task', '20000000-0000-4000-8000-000000000005', 'Evening', '20000000-0000-4000-8000-000000000005');
SELECT set_config('app.visit_action_transition', 'submit', true);
UPDATE public.visit_action_items
SET status='بانتظار اعتماد الإدارة', completion_note='Fixture submission',
    completion_submitted_at=now(), completion_submitted_by='20000000-0000-4000-8000-000000000005'
WHERE id='72000000-0000-4000-8000-000000000002';
SELECT set_config('app.visit_action_transition', '', true);

INSERT INTO public.visit_evidence(id, visit_id, result_id, action_item_id, file_path, file_name, mime_type, uploaded_by) VALUES
  ('73000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000003/proof.png', 'proof.png', 'image/png', '20000000-0000-4000-8000-000000000003'),
  ('73000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000005/proof.png', 'proof.png', 'image/png', '20000000-0000-4000-8000-000000000005'),
  ('73000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000003/20000000-0000-4000-8000-000000000005/proof.png', 'proof.png', 'image/png', '20000000-0000-4000-8000-000000000005');
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('visit-action-evidence', '72000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000003/proof.png'),
  ('visit-action-evidence', '72000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000005/proof.png'),
  ('visit-action-evidence', '72000000-0000-4000-8000-000000000003/20000000-0000-4000-8000-000000000005/proof.png');
INSERT INTO public.visit_email_logs(id, visit_id, sent_by, recipients, status) VALUES
  ('74000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', ARRAY['owner@example.test'], 'sent'),
  ('74000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', ARRAY['owner@example.test'], 'sent'),
  ('74000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', ARRAY['owner@example.test'], 'sent');
INSERT INTO public.visit_action_review_events(id, action_item_id, actor_id, event_type, note) VALUES
  ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'completion_submitted', 'Fixture A'),
  ('75000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'completion_submitted', 'Fixture pending review'),
  ('75000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005', 'completion_submitted', 'Fixture unrelated');
INSERT INTO public.supervisory_visit_notes(id, visit_id, note_text, corrective_action, owner, status) VALUES
  ('76000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Branch A note', 'Branch A action', 'Morning Supervisor', 'مفتوحة'),
  ('76000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', 'Pending review note', 'Review-only detail', 'Branch B Supervisor', 'مفتوحة'),
  ('76000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'Unrelated note', 'No review access', 'Branch B Supervisor', 'مفتوحة'),
  ('76000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000007', 'Planned branch note', 'Must remain hidden', 'Planned Supervisor', 'مفتوحة');

-- Selected/all/none branch scope for visit reports, including every child data
-- path consumed by the weekly report and visit PDF workflow.
UPDATE public.manager_report_scopes SET scope_mode='selected'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
DELETE FROM public.manager_report_scope_branches WHERE profile_id='20000000-0000-4000-8000-000000000002';
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
UPDATE public.admin_permissions SET
  can_view_daily_checklist_summary=false,
  can_view_checklist_logs=false,
  can_view_visit_reports=true,
  can_view_analytics=false,
  can_review_visit_actions=false
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_branch_visit_report_email_recipients('70000000-0000-4000-8000-000000000001')
  WHERE profile_id='20000000-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected Manager with visit-report grant was omitted for selected branch'; END IF;
  SELECT count(*) INTO n FROM public.get_branch_visit_report_email_recipients('70000000-0000-4000-8000-000000000002')
  WHERE profile_id='20000000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL selected Manager was included for an unselected branch'; END IF;
END;
$test$;
RESET ROLE;
UPDATE public.manager_report_scopes SET scope_mode='all'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
DELETE FROM public.manager_report_scope_branches WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_branch_visit_report_email_recipients('70000000-0000-4000-8000-000000000002')
  WHERE profile_id='20000000-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL all-scope Manager with visit-report grant was omitted'; END IF;
  RAISE NOTICE 'PASS visit PDF management recipients respect selected and all Manager branch scope';
END;
$test$;
RESET ROLE;
UPDATE public.manager_report_scopes SET scope_mode='none'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_branch_visit_report_email_recipients('70000000-0000-4000-8000-000000000001')
  WHERE profile_id='20000000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL none-scope Manager received visit PDF email'; END IF;
END;
$test$;
RESET ROLE;
UPDATE public.manager_report_scopes SET scope_mode='selected'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
UPDATE public.admin_permissions SET can_view_visit_reports=false
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.get_branch_visit_report_email_recipients('70000000-0000-4000-8000-000000000001')
  WHERE profile_id='20000000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL Manager without visit-report permission received visit PDF email'; END IF;
  RAISE NOTICE 'PASS visit PDF management recipients require can_view_visit_reports';
END;
$test$;
RESET ROLE;
UPDATE public.admin_permissions SET can_view_visit_reports=true
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id IN ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope expected only branch A, got %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_results WHERE id IN ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope did not restrict results, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_action_items WHERE id IN ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope did not restrict actions, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_evidence WHERE id IN ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope did not restrict evidence, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_email_logs WHERE id IN ('74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope did not restrict email logs, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_action_review_events WHERE id IN ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope did not restrict review events, got %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_notes WHERE id IN ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope did not restrict supervisory notes, got %', n; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence' AND name LIKE '72000000-0000-4000-8000-00000000000%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected visit scope did not restrict private evidence objects, got %', n; END IF;
  RAISE NOTICE 'PASS selected visit scope constrains parents, results, actions, evidence, email logs, review events, notes, and storage';
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE b boolean;
BEGIN
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000001') INTO b;
  IF NOT b THEN RAISE EXCEPTION 'FAIL selected Manager report scope blocked full PDF for its branch'; END IF;
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000002') INTO b;
  IF b THEN RAISE EXCEPTION 'FAIL selected Manager report scope allowed full PDF for an unselected branch'; END IF;
  RAISE NOTICE 'PASS selected report scope gates full-visit PDF by branch';
END;
$test$;
RESET ROLE;

UPDATE public.manager_report_scopes SET scope_mode='all'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id IN ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL all-branch visit scope expected three visits, got %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_notes WHERE id IN ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000003');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL all-branch visit scope expected three note rows, got %', n; END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE b boolean;
BEGIN
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000003') INTO b;
  IF NOT b THEN RAISE EXCEPTION 'FAIL all-branch Manager report scope blocked full PDF'; END IF;
  RAISE NOTICE 'PASS all-branch report scope permits full-visit PDF';
END;
$test$;
RESET ROLE;

-- Even with the visit-report flag and all-branch scope, planned branches stay
-- outside Manager visit, note, and PDF access.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer; allowed boolean;
BEGIN
  SELECT public.can_manager_read_branch('can_view_visit_reports', '10000000-0000-4000-8000-000000000003') INTO allowed;
  IF allowed THEN RAISE EXCEPTION 'FAIL planned branch passed the Manager visit-read scope helper'; END IF;
  SELECT public.can_manager_read_visit_report('70000000-0000-4000-8000-000000000007') INTO allowed;
  IF allowed THEN RAISE EXCEPTION 'FAIL planned-branch visit passed Manager report authorization'; END IF;
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000007') INTO allowed;
  IF allowed THEN RAISE EXCEPTION 'FAIL planned-branch visit passed Manager PDF authorization'; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id='70000000-0000-4000-8000-000000000007';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL planned-branch visit leaked through RLS'; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_notes WHERE id='76000000-0000-4000-8000-000000000004';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL planned-branch note leaked through RLS'; END IF;
  RAISE NOTICE 'PASS planned-branch visit, notes, and PDF stay unavailable even with all-branch visit scope';
END;
$test$;
RESET ROLE;

UPDATE public.manager_report_scopes SET scope_mode='none'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id IN ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL no-branch visit scope exposed % visits', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_notes WHERE id IN ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000003');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL no-branch visit scope exposed % notes', n; END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE b boolean;
BEGIN
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000001') INTO b;
  IF b THEN RAISE EXCEPTION 'FAIL no-branch Manager report scope allowed full PDF'; END IF;
  RAISE NOTICE 'PASS no-branch report scope denies full-visit PDF';
END;
$test$;
RESET ROLE;

-- The three other read flags must not imply visit-report access.
UPDATE public.admin_permissions SET
  can_view_daily_checklist_summary=true,
  can_view_checklist_logs=true,
  can_view_visit_reports=false,
  can_view_analytics=true,
  can_review_visit_actions=false
WHERE profile_id='20000000-0000-4000-8000-000000000002';
UPDATE public.manager_report_scopes SET scope_mode='all'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id IN ('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL summary/checklist-log/analytics flags implied visit access, got %', n; END IF;
  RAISE NOTICE 'PASS daily summary, checklist logs, and analytics flags remain independent from visit reports';
END;
$test$;
RESET ROLE;

-- Manager data writes retain their selected/all/none branch scope even when
-- every read capability is disabled; the report parent is authorized by a
-- SECURITY DEFINER write helper rather than its Manager SELECT policy.
UPDATE public.manager_report_scopes SET scope_mode='selected'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
DELETE FROM public.manager_report_scope_branches
WHERE profile_id='20000000-0000-4000-8000-000000000002';
INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
UPDATE public.admin_permissions SET
  can_view_all_reports=false,
  can_view_daily_checklist_summary=false,
  can_view_checklist_logs=false,
  can_view_visit_reports=false,
  can_view_analytics=false,
  can_review_visit_actions=false
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  IF NOT public.can_manager_write_daily_report('30000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'FAIL selected Manager write-scope helper rejected the in-scope report';
  END IF;
  SELECT count(*) INTO n FROM public.daily_reports WHERE id='30000000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL read-disabled Manager can read the selected report'; END IF;
  SELECT count(*) INTO n FROM public.technical_issues WHERE id='40000000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL read-disabled Manager can read an issue without analytics access'; END IF;

  INSERT INTO public.waste_logs(report_id, item_name, quantity, reason)
  VALUES ('30000000-0000-4000-8000-000000000002', 'Manager write no read waste', 1, 'before');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected Manager could not insert waste with all read flags off'; END IF;
  INSERT INTO public.shift_issues(report_id, description, action_taken)
  VALUES ('30000000-0000-4000-8000-000000000002', 'Manager write no read shift', 'before');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected Manager could not insert shift issues with all read flags off'; END IF;
  INSERT INTO public.negative_reviews(report_id, comment_text)
  VALUES ('30000000-0000-4000-8000-000000000002', 'Manager write no read review');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL selected Manager could not insert reviews with all read flags off'; END IF;

  UPDATE public.technical_issues SET title='Manager issue write with all read flags off'
  WHERE id='40000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL read-disabled Manager updated an analytics-only issue'; END IF;

  BEGIN
    INSERT INTO public.waste_logs(report_id, item_name, quantity)
    VALUES ('30000000-0000-4000-8000-000000000003', 'Manager outside selected scope', 1);
    RAISE EXCEPTION 'FAIL selected Manager wrote to another branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS Manager selected-scope detail writes stay in scope with all read flags off';
  END;
END;
$test$;
RESET ROLE;

UPDATE public.manager_report_scopes SET scope_mode='all'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
DELETE FROM public.manager_report_scope_branches
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  INSERT INTO public.shift_issues(report_id, description)
  VALUES ('30000000-0000-4000-8000-000000000003', 'Manager all-scope no-read issue');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL all-scope Manager could not insert into another operational branch'; END IF;
  UPDATE public.technical_issues SET title='Manager all-scope write with no read flags'
  WHERE id='40000000-0000-4000-8000-000000000004';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL all-scope Manager bypassed the disabled analytics read grant'; END IF;
  BEGIN
    INSERT INTO public.shift_issues(report_id, description)
    VALUES ('30000000-0000-4000-8000-000000000004', 'Manager write into planned branch');
    RAISE EXCEPTION 'FAIL all-scope Manager wrote into a planned branch';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS Manager all-scope writes include operational branches only';
  END;
END;
$test$;
RESET ROLE;

UPDATE public.manager_report_scopes SET scope_mode='none'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  BEGIN
    INSERT INTO public.waste_logs(report_id, item_name, quantity)
    VALUES ('30000000-0000-4000-8000-000000000002', 'Manager none-scope write', 1);
    RAISE EXCEPTION 'FAIL none-scope Manager inserted waste';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS Manager none scope denies report-detail writes';
  END;
  UPDATE public.technical_issues SET title='Manager none-scope write'
  WHERE id='40000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL none-scope Manager updated a linked technical issue'; END IF;
END;
$test$;
RESET ROLE;

-- Reviewer-only permission must not be promoted to a full-visit PDF grant.
UPDATE public.admin_permissions SET can_review_visit_actions=true
WHERE profile_id='20000000-0000-4000-8000-000000000007';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000007', true);
DO $test$
DECLARE can_review boolean; can_read_pdf boolean;
BEGIN
  SELECT public.can_access_branch_visit('70000000-0000-4000-8000-000000000002') INTO can_review;
  IF NOT can_review THEN RAISE EXCEPTION 'FAIL non-Manager reviewer lost pending-action review visibility'; END IF;
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000002') INTO can_read_pdf;
  IF can_read_pdf THEN RAISE EXCEPTION 'FAIL reviewer-only non-Manager received full-visit PDF permission'; END IF;
  RAISE NOTICE 'PASS reviewer-only visibility does not authorize full-visit PDF for non-Managers';
END;
$test$;
RESET ROLE;
UPDATE public.admin_permissions SET can_review_visit_actions=false
WHERE profile_id='20000000-0000-4000-8000-000000000007';

-- A Manager with review permission sees only the specific pending action and
-- related result/evidence/events, not its sibling action, notes, or email logs.
UPDATE public.admin_permissions SET
  can_view_daily_checklist_summary=false,
  can_view_checklist_logs=false,
  can_view_visit_reports=false,
  can_view_analytics=false,
  can_review_visit_actions=true
WHERE profile_id='20000000-0000-4000-8000-000000000002';
UPDATE public.manager_report_scopes SET scope_mode='none'
WHERE profile_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id IN ('70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL review-only Manager expected exactly the visit with pending review, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_action_items WHERE id IN ('72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL reviewer read pending action plus unrelated sibling, count %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_results WHERE id IN ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL reviewer read unrelated result, count %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_results WHERE id='71000000-0000-4000-8000-000000000004';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL reviewer read an unassociated result on the reviewed visit'; END IF;
  SELECT count(*) INTO n FROM public.visit_evidence WHERE id IN ('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL reviewer read unrelated evidence, count %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_action_review_events WHERE id IN ('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL reviewer read unrelated review event, count %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_email_logs WHERE id IN ('74000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL review-only Manager read email logs, count %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_notes WHERE id IN ('76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000003');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL review-only Manager read supervisory visit notes, count %', n; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence' AND name LIKE '72000000-0000-4000-8000-000000000002/%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL reviewer could not read evidence for pending action, got %', n; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence' AND name LIKE '72000000-0000-4000-8000-000000000003/%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL reviewer read evidence for unrelated action'; END IF;
  RAISE NOTICE 'PASS reviewer access is limited to pending action and associated result/evidence/event';
END;
$test$;
DO $test$
DECLARE can_read_pdf boolean;
BEGIN
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000002') INTO can_read_pdf;
  IF can_read_pdf THEN RAISE EXCEPTION 'FAIL review-only Manager received full-visit PDF permission'; END IF;
  RAISE NOTICE 'PASS review-only Manager cannot export the full visit PDF';
END;
$test$;
RESET ROLE;

-- Preserve a Manager's direct assignee path for one action without granting
-- report-wide notes or email logs for that branch.
UPDATE public.admin_permissions SET can_review_visit_actions=false
WHERE profile_id='20000000-0000-4000-8000-000000000002';
UPDATE public.visit_action_items SET assigned_to='20000000-0000-4000-8000-000000000002'
WHERE id='72000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id IN ('70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Manager assignee did not see only the visit with assigned action, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_action_items WHERE id IN ('72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Manager assignee read an action not assigned to them, got %', n; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_results WHERE id IN ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Manager assignee did not see only the related result, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_evidence WHERE id IN ('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Manager assignee did not see only the assigned action evidence, got %', n; END IF;
  SELECT count(*) INTO n FROM public.visit_action_review_events WHERE id IN ('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000003');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL Manager assignee did not see only the assigned action event, got %', n; END IF;
  RAISE NOTICE 'PASS a directly assigned Manager sees only the visit, action, result, evidence, and event linked to that assignment';
END;
$test$;
DO $test$
DECLARE can_read_pdf boolean;
BEGIN
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000003') INTO can_read_pdf;
  IF can_read_pdf THEN RAISE EXCEPTION 'FAIL Manager assigned only to an action received full-visit PDF permission'; END IF;
  RAISE NOTICE 'PASS action-only Manager assignment cannot export the full visit PDF';
END;
$test$;
RESET ROLE;

-- Manager branch-visit assignments are intentionally disallowed by the existing
-- assignee-role trigger; the direct action-assignee path is tested above.
UPDATE public.visit_action_items SET assigned_to='20000000-0000-4000-8000-000000000005'
WHERE id='72000000-0000-4000-8000-000000000003';

-- Existing Supervisor assignment and private-proof reads remain intact.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id='70000000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL assigned Supervisor lost access to the parent visit'; END IF;
  SELECT count(*) INTO n FROM public.visit_action_items WHERE id='72000000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL assigned Supervisor lost access to their action'; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visit_notes WHERE id='76000000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL assigned Supervisor lost full-report note access'; END IF;
  SELECT count(*) INTO n FROM public.visit_evidence WHERE id='73000000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL assigned Supervisor lost access to their evidence row'; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='visit-action-evidence' AND name LIKE '72000000-0000-4000-8000-000000000001/%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL assigned Supervisor lost access to their private proof object'; END IF;
  RAISE NOTICE 'PASS Supervisor assignment, action, evidence row, and private object reads remain available';
END;
$test$;
DO $test$
DECLARE can_read_pdf boolean;
BEGIN
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000001') INTO can_read_pdf;
  IF NOT can_read_pdf THEN RAISE EXCEPTION 'FAIL assigned Supervisor lost full-report PDF access'; END IF;
  RAISE NOTICE 'PASS assigned Supervisor retains full-report PDF access';
END;
$test$;
DO $test$
DECLARE can_read_visit boolean; can_read_pdf boolean; n integer; visit_id uuid;
BEGIN
  FOREACH visit_id IN ARRAY ARRAY[
    '70000000-0000-4000-8000-000000000004'::uuid,
    '70000000-0000-4000-8000-000000000005'::uuid,
    '70000000-0000-4000-8000-000000000006'::uuid
  ] LOOP
    SELECT public.can_access_branch_visit(visit_id) INTO can_read_visit;
    IF can_read_visit THEN RAISE EXCEPTION 'FAIL mismatched assignment granted visit RLS for %', visit_id; END IF;
    SELECT public.can_generate_branch_visit_report_pdf(visit_id) INTO can_read_pdf;
    IF can_read_pdf THEN RAISE EXCEPTION 'FAIL mismatched assignment granted full PDF for %', visit_id; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.supervisory_visits
  WHERE id IN (
    '70000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000006'
  );
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL Supervisor RLS exposed % visits with mismatched assignments', n; END IF;
  RAISE NOTICE 'PASS mismatched branch/date/shift assignments grant neither visit RLS nor full PDF';
END;
$test$;
RESET ROLE;

-- RLS activation preserves direct Owner and Admin access to visit notes.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visit_notes
  WHERE id IN ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL system Owner lost visit-note access'; END IF;
END;
$test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000007', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.supervisory_visit_notes
  WHERE id IN ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL Admin lost visit-note access'; END IF;
  RAISE NOTICE 'PASS system Owner and Admin retain visit-note access';
END;
$test$;
RESET ROLE;

-- Action assignment keeps its existing RLS access but is not a full-visit PDF grant.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000005', true);
DO $test$
DECLARE can_read_visit boolean; can_read_pdf boolean; n integer;
BEGIN
  SELECT public.can_access_branch_visit('70000000-0000-4000-8000-000000000003') INTO can_read_visit;
  IF NOT can_read_visit THEN RAISE EXCEPTION 'FAIL action-assigned Supervisor lost visit RLS access'; END IF;
  SELECT count(*) INTO n FROM public.supervisory_visits WHERE id='70000000-0000-4000-8000-000000000003';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL action-assigned Supervisor lost parent-row RLS access'; END IF;
  SELECT public.can_generate_branch_visit_report_pdf('70000000-0000-4000-8000-000000000003') INTO can_read_pdf;
  IF can_read_pdf THEN RAISE EXCEPTION 'FAIL action-only Supervisor received full-visit PDF permission'; END IF;
  RAISE NOTICE 'PASS action-assigned Supervisor retains RLS access but cannot export a full-visit PDF';
END;
$test$;
RESET ROLE;

ROLLBACK;
