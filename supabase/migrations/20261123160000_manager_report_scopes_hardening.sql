-- Local candidate only. Apply only after isolated PostgreSQL/RLS review and owner approval.
-- This migration intentionally removes legacy/global fallback for Manager report access.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.branches') IS NULL
     OR to_regclass('public.admin_permissions') IS NULL
     OR to_regclass('public.daily_reports') IS NULL
     OR to_regclass('public.checklist_logs') IS NULL
     OR to_regclass('public.hourly_checklist_logs') IS NULL
     OR to_regclass('public.waste_logs') IS NULL
     OR to_regclass('public.shift_issues') IS NULL
     OR to_regclass('public.negative_reviews') IS NULL
     OR to_regclass('public.supervisory_visits') IS NULL
     OR to_regclass('public.visit_action_items') IS NULL THEN
    RAISE EXCEPTION 'Manager report-scope migration prerequisites are missing';
  END IF;
END;
$preflight$;

-- A non-login, non-owner, NOBYPASSRLS function owner confines the summary RPC
-- to the granted projection columns and the RLS policy below. It is not service_role.
DO $role$
DECLARE
  v_role record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
         rolreplication, rolbypassrls
    INTO v_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'zam_daily_summary_reader';
  IF NOT FOUND THEN
    EXECUTE 'CREATE ROLE zam_daily_summary_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
  ELSIF v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolcreatedb
     OR v_role.rolcreaterole OR v_role.rolinherit OR v_role.rolreplication
     OR v_role.rolbypassrls THEN
    RAISE EXCEPTION 'Existing zam_daily_summary_reader role has unsafe privileges';
  END IF;
END;
$role$;

CREATE TABLE IF NOT EXISTS public.manager_report_scopes (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_mode text NOT NULL,
  can_view_daily_checklist_summary boolean NOT NULL DEFAULT false,
  can_view_checklist_logs boolean NOT NULL DEFAULT false,
  can_view_visit_reports boolean NOT NULL DEFAULT false,
  can_view_analytics boolean NOT NULL DEFAULT false,
  configured_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.manager_report_scope_branches (
  profile_id uuid NOT NULL REFERENCES public.manager_report_scopes(profile_id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT
);

ALTER TABLE public.manager_report_scopes
  ADD COLUMN IF NOT EXISTS can_view_daily_checklist_summary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_checklist_logs boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_visit_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_analytics boolean NOT NULL DEFAULT false;

-- Preserve an old explicit `none` scope as an empty selected scope (still deny-all).
UPDATE public.manager_report_scopes SET scope_mode = 'selected' WHERE scope_mode = 'none';
DO $scope_constraints$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.manager_report_scopes'::regclass
      AND contype = 'c'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%scope_mode%'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.manager_report_scopes DROP CONSTRAINT %I', c.conname
    );
  END LOOP;
  ALTER TABLE public.manager_report_scopes
    ADD CONSTRAINT manager_report_scopes_scope_mode_check
    CHECK (scope_mode IN ('all', 'selected'));
END;
$scope_constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS manager_report_scope_branches_profile_branch_uidx
  ON public.manager_report_scope_branches(profile_id, branch_id);
CREATE INDEX IF NOT EXISTS manager_report_scope_branches_branch_profile_idx
  ON public.manager_report_scope_branches(branch_id, profile_id);

-- Scope configuration is readable/writable only through Owner-gated controls.
ALTER TABLE public.manager_report_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_report_scope_branches ENABLE ROW LEVEL SECURITY;
DO $drop_scope_policies$
DECLARE p record;
BEGIN
  FOR p IN SELECT polname FROM pg_catalog.pg_policy
           WHERE polrelid = 'public.manager_report_scopes'::regclass
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY %I ON public.manager_report_scopes', p.polname);
  END LOOP;
  FOR p IN SELECT polname FROM pg_catalog.pg_policy
           WHERE polrelid = 'public.manager_report_scope_branches'::regclass
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY %I ON public.manager_report_scope_branches', p.polname);
  END LOOP;
END;
$drop_scope_policies$;
CREATE POLICY manager_report_scopes_owner_read
  ON public.manager_report_scopes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid()) AND p.status = 'active' AND p.role = 'Owner'
  ));
CREATE POLICY manager_report_scopes_summary_reader_read
  ON public.manager_report_scopes FOR SELECT TO zam_daily_summary_reader
  USING (profile_id = (SELECT auth.uid()));
CREATE POLICY manager_report_scope_branches_owner_read
  ON public.manager_report_scope_branches FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid()) AND p.status = 'active' AND p.role = 'Owner'
  ));
CREATE POLICY manager_report_scope_branches_summary_reader_read
  ON public.manager_report_scope_branches FOR SELECT TO zam_daily_summary_reader
  USING (profile_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS manager_summary_reader_profile_self ON public.profiles;
CREATE POLICY manager_summary_reader_profile_self ON public.profiles
  AS RESTRICTIVE FOR SELECT TO zam_daily_summary_reader
  USING (id = (SELECT auth.uid()));
REVOKE ALL ON public.manager_report_scopes, public.manager_report_scope_branches
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.manager_report_scopes, public.manager_report_scope_branches TO authenticated;
GRANT SELECT ON public.manager_report_scopes, public.manager_report_scope_branches
  TO zam_daily_summary_reader;
GRANT SELECT (id, role, status) ON public.profiles TO zam_daily_summary_reader;

-- Internal scope predicate. No legacy permission or missing-row fallback is accepted.
CREATE OR REPLACE FUNCTION public.manager_report_branch_in_scope(
  p_profile_id uuid,
  p_branch_id uuid,
  p_legacy_global boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_profile_id IS NOT NULL
    AND p_branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.manager_report_scopes AS s ON s.profile_id = p.id
      JOIN public.branches AS b ON b.id = p_branch_id
      WHERE p.id = p_profile_id
        AND p.status = 'active'
        AND p.role = 'Manager'
        AND b.lifecycle_status IS DISTINCT FROM 'planned'
        AND (
          s.scope_mode = 'all'
          OR (s.scope_mode = 'selected' AND EXISTS (
            SELECT 1 FROM public.manager_report_scope_branches AS sb
            WHERE sb.profile_id = s.profile_id AND sb.branch_id = p_branch_id
          ))
        )
    );
$function$;
REVOKE ALL ON FUNCTION public.manager_report_branch_in_scope(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manager_report_scope_allows(
  p_profile_id uuid,
  p_permission text,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_profile_id IS NOT NULL
    AND p_branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.manager_report_scopes AS s ON s.profile_id = p.id
      JOIN public.branches AS b ON b.id = p_branch_id
      WHERE p.id = p_profile_id
        AND p.status = 'active'
        AND p.role = 'Manager'
        AND b.lifecycle_status IS DISTINCT FROM 'planned'
        AND CASE p_permission
          WHEN 'can_view_daily_checklist_summary' THEN s.can_view_daily_checklist_summary IS TRUE
          WHEN 'can_view_checklist_logs' THEN s.can_view_checklist_logs IS TRUE
          WHEN 'can_view_visit_reports' THEN s.can_view_visit_reports IS TRUE
          WHEN 'can_view_analytics' THEN s.can_view_analytics IS TRUE
          ELSE false
        END
        AND (
          s.scope_mode = 'all'
          OR (s.scope_mode = 'selected' AND EXISTS (
            SELECT 1 FROM public.manager_report_scope_branches AS sb
            WHERE sb.profile_id = s.profile_id AND sb.branch_id = p_branch_id
          ))
        )
    );
$function$;
REVOKE ALL ON FUNCTION public.manager_report_scope_allows(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_manager_scope_allows(
  p_permission text,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND public.manager_report_scope_allows((SELECT auth.uid()), p_permission, p_branch_id);
$function$;
REVOKE ALL ON FUNCTION public.current_user_manager_scope_allows(text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_manager_scope_allows(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_admin_can_view_all_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND p.role = 'Admin'
      AND ap.can_view_all_reports IS TRUE
  );
$function$;
REVOKE ALL ON FUNCTION public.current_user_admin_can_view_all_reports()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_admin_can_view_all_reports() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_read_daily_report(
  p_branch_id uuid,
  p_report_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT p.status = 'active'
      AND p_branch_id IS NOT NULL
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN public.manager_report_scope_allows(
          p.id, 'can_view_analytics', p_branch_id
        )
        WHEN 'Supervisor' THEN p.branch_id = p_branch_id
          AND p.shift_type IN ('Morning', 'Evening', 'Both')
          AND p_report_shift_type IN ('Morning', 'Evening')
          AND (p.shift_type = 'Both' OR p.shift_type = p_report_shift_type)
        ELSE false
      END
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.current_user_can_read_daily_report(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_daily_report(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_read_report_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT p.status = 'active'
      AND p_branch_id IS NOT NULL
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN public.manager_report_scope_allows(
          p.id, 'can_view_analytics', p_branch_id
        )
        WHEN 'Supervisor' THEN p.branch_id = p_branch_id
        ELSE p.branch_id = p_branch_id
      END
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.current_user_can_read_report_branch(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_report_branch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_read_checklist_log(
  p_branch_id uuid,
  p_executed_by uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT p.status = 'active'
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN public.manager_report_scope_allows(
          p.id, 'can_view_checklist_logs', p_branch_id
        )
        WHEN 'Supervisor' THEN p.branch_id = p_branch_id
        ELSE p_executed_by = p.id
      END
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.current_user_can_read_checklist_log(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_checklist_log(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_read_visit_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT p.status = 'active'
      AND p_branch_id IS NOT NULL
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN public.manager_report_scope_allows(
          p.id, 'can_view_visit_reports', p_branch_id
        )
        WHEN 'Supervisor' THEN p.branch_id = p_branch_id
        ELSE false
      END
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.current_user_can_read_visit_branch(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_visit_branch(uuid) TO authenticated;

-- Keep legacy function signatures used by RLS, but every Manager path now needs
-- an explicit scope row. The legacy boolean argument is intentionally ignored.
CREATE OR REPLACE FUNCTION public.can_manager_read_branch(p_permission text, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.current_user_manager_scope_allows(p_permission, p_branch_id);
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_branch(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_branch(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_manager_report_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.current_user_manager_scope_allows('can_view_analytics', p_branch_id);
$function$;
REVOKE ALL ON FUNCTION public.can_read_manager_report_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_manager_report_branch(uuid) TO authenticated;

-- The daily summary has a separate capability from analytics. Return only
-- operational branches explicitly authorized for that summary projection.
CREATE OR REPLACE FUNCTION public.list_manager_daily_summary_branches()
RETURNS TABLE(id uuid, name text, lifecycle_status text, planned_opening_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT b.id, b.name, b.lifecycle_status, b.planned_opening_date
  FROM public.branches AS b
  WHERE b.lifecycle_status IS DISTINCT FROM 'planned'
    AND public.current_user_manager_scope_allows(
      'can_view_daily_checklist_summary', b.id
    )
  ORDER BY b.name;
$function$;
REVOKE ALL ON FUNCTION public.list_manager_daily_summary_branches()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_manager_daily_summary_branches()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.profile_can_read_manager_report_branch(
  p_profile_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.manager_report_scope_allows(
    p_profile_id, 'can_view_analytics', p_branch_id
  );
$function$;
REVOKE ALL ON FUNCTION public.profile_can_read_manager_report_branch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_profile_read_daily_report_branch(
  p_profile_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = p_profile_id AND p.status = 'active'
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN public.manager_report_scope_allows(
          p.id, 'can_view_analytics', p_branch_id
        )
        WHEN 'Supervisor' THEN p.branch_id = p_branch_id
          AND p.shift_type IN ('Morning', 'Evening', 'Both')
        ELSE false
      END
  );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_daily_report_branch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_profile_read_daily_report(
  p_profile_id uuid,
  p_branch_id uuid,
  p_report_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL
    AND p_report_shift_type IN ('Morning', 'Evening')
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = p_profile_id AND p.status = 'active'
        AND CASE p.role
          WHEN 'Owner' THEN true
          WHEN 'Admin' THEN EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
          )
          WHEN 'Manager' THEN public.manager_report_scope_allows(
            p.id, 'can_view_analytics', p_branch_id
          )
          WHEN 'Supervisor' THEN p.branch_id = p_branch_id
            AND p.shift_type IN ('Morning', 'Evening', 'Both')
            AND (p.shift_type = 'Both' OR p.shift_type = p_report_shift_type)
          ELSE false
        END
    );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_daily_report(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_profile_read_all_daily_report_branches(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = p_profile_id AND p.status = 'active'
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN EXISTS (
          SELECT 1 FROM public.manager_report_scopes AS s
          WHERE s.profile_id = p.id
            AND s.scope_mode = 'all'
            AND s.can_view_analytics IS TRUE
        )
        ELSE false
      END
  );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_all_daily_report_branches(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_write_daily_report(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_reports AS r
    JOIN public.profiles AS p ON p.id = (SELECT auth.uid())
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE r.id = p_report_id
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND ap.can_manage_reports IS TRUE
      AND public.manager_report_branch_in_scope(p.id, r.branch_id, false)
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_write_daily_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_write_daily_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_write_daily_report_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND ap.can_manage_reports IS TRUE
      AND public.manager_report_branch_in_scope(p.id, p_branch_id, false)
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_write_daily_report_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_write_daily_report_branch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_write_technical_issue_report(
  p_report_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.daily_reports AS r
    JOIN public.profiles AS p ON p.id = (SELECT auth.uid())
    WHERE r.id = p_report_id AND r.branch_id = p_branch_id
      AND p.status = 'active' AND p.role = 'Manager'
      AND public.manager_report_branch_in_scope(p.id, r.branch_id, false)
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_write_technical_issue_report(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_write_technical_issue_report(uuid, uuid)
  TO authenticated;

-- Manager visit access no longer inherits assignment/reviewer exceptions across branches.
CREATE OR REPLACE FUNCTION public.can_manager_read_visit(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    JOIN public.supervisory_visits AS v ON v.id = p_visit_id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active' AND p.role = 'Manager'
      AND public.manager_report_scope_allows(p.id, 'can_view_visit_reports', v.branch_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_visit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_read_visit_report(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.can_manager_read_visit(p_visit_id);
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_visit_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_visit_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_read_visit_action(p_action_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    JOIN public.visit_action_items AS ai ON ai.id = p_action_id
    JOIN public.supervisory_visits AS v ON v.id = ai.visit_id AND v.branch_id = ai.branch_id
    WHERE actor.id = (SELECT auth.uid())
      AND actor.status = 'active'
      AND actor.role = 'Manager'
      AND public.manager_report_scope_allows(
        actor.id, 'can_view_visit_reports', v.branch_id
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_visit_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_visit_action(uuid) TO authenticated;

-- A reviewer permission is not a bucket-wide grant: constrain every evidence
-- read to its action while preserving Owner, scoped Manager, reviewer and assignee paths.
DROP POLICY IF EXISTS visit_action_evidence_path_scope_guard ON storage.objects;
CREATE POLICY visit_action_evidence_path_scope_guard ON storage.objects
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket_id <> 'visit-action-evidence'
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.visit_action_items AS ai
        ON ai.id::text = split_part(storage.objects.name, '/', 1)
      JOIN public.supervisory_visits AS v
        ON v.id = ai.visit_id AND v.branch_id = ai.branch_id
      WHERE p.id = (SELECT auth.uid())
        AND p.status = 'active'
        AND split_part(storage.objects.name, '/', 2) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND split_part(storage.objects.name, '/', 3) <> ''
        AND (
          p.role = 'Owner'
          OR (p.role = 'Manager' AND public.can_manager_read_visit_action(ai.id))
          OR (
            p.role <> 'Manager'
            AND public.can_review_branch_visit_actions()
            AND (ai.status = 'بانتظار اعتماد الإدارة' OR ai.reviewed_by = (SELECT auth.uid()))
          )
          OR (
            p.role <> 'Manager'
            AND (
              ai.assigned_to = (SELECT auth.uid())
              OR (
                ai.assigned_to IS NULL
                AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
                AND p.role = 'Supervisor'
                AND p.branch_id = ai.branch_id
                AND (ai.shift_type IS NULL OR p.shift_type = 'Both' OR ai.shift_type = p.shift_type)
              )
            )
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION public.profile_can_read_manager_visit_report(
  p_profile_id uuid,
  p_visit_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    JOIN public.supervisory_visits AS v ON v.id = p_visit_id
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND public.manager_report_scope_allows(
        p.id, 'can_view_visit_reports', v.branch_id
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.profile_can_read_manager_visit_report(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Owner-only scope writer; Manager read capabilities and branch scope are saved atomically.
DROP FUNCTION IF EXISTS public.save_manager_report_scope(uuid, text, uuid[], boolean);
CREATE OR REPLACE FUNCTION public.save_manager_report_scope(
  p_profile_id uuid,
  p_scope_mode text,
  p_branch_ids uuid[],
  p_can_view_daily_checklist_summary boolean,
  p_can_view_checklist_logs boolean,
  p_can_view_visit_reports boolean,
  p_can_view_analytics boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_branch_ids uuid[] := COALESCE(p_branch_ids, '{}'::uuid[]);
  v_target_role text;
  v_target_status text;
  v_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = (SELECT auth.uid())
      AND actor.status = 'active' AND actor.role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'يلزم مالك النظام لإعداد نطاق تقارير المدير'
      USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL OR p_scope_mode NOT IN ('all', 'selected')
     OR p_can_view_daily_checklist_summary IS NULL
     OR p_can_view_checklist_logs IS NULL
     OR p_can_view_visit_reports IS NULL
     OR p_can_view_analytics IS NULL
     OR pg_catalog.array_position(v_branch_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'إعداد نطاق تقارير غير صالح' USING ERRCODE = '22023';
  END IF;
  SELECT p.role, p.status INTO v_target_role, v_target_status
  FROM public.profiles AS p WHERE p.id = p_profile_id FOR UPDATE;
  IF v_target_role IS DISTINCT FROM 'Manager' OR v_target_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'يمكن إعداد نطاق لحساب مدير نشط فقط' USING ERRCODE = '22023';
  END IF;
  IF p_scope_mode = 'all' AND pg_catalog.cardinality(v_branch_ids) <> 0 THEN
    RAISE EXCEPTION 'لا ترسل فروعًا محددة مع نطاق كل الفروع' USING ERRCODE = '22023';
  END IF;
  IF p_scope_mode = 'selected' THEN
    IF pg_catalog.cardinality(v_branch_ids) = 0
       OR pg_catalog.cardinality(v_branch_ids) <> (
         SELECT pg_catalog.count(DISTINCT branch_id)::integer
         FROM pg_catalog.unnest(v_branch_ids) AS supplied(branch_id)
       ) THEN
      RAISE EXCEPTION 'اختر فرعًا تشغيليًا واحدًا على الأقل دون تكرار' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.count(*)::integer INTO v_count
    FROM public.branches AS b
    WHERE b.id = ANY (v_branch_ids)
      AND b.lifecycle_status IS DISTINCT FROM 'planned';
    IF v_count <> pg_catalog.cardinality(v_branch_ids) THEN
      RAISE EXCEPTION 'تتضمن القائمة فرعًا غير موجود أو مخططًا' USING ERRCODE = '22023';
    END IF;
  ELSIF pg_catalog.cardinality(v_branch_ids) <> 0 THEN
    RAISE EXCEPTION 'أرسل الفروع فقط عند اختيار نطاق محدد' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.manager_report_scopes (
    profile_id, scope_mode, can_view_daily_checklist_summary,
    can_view_checklist_logs, can_view_visit_reports, can_view_analytics,
    configured_by, created_at, updated_at
  ) VALUES (
    p_profile_id, p_scope_mode, p_can_view_daily_checklist_summary,
    p_can_view_checklist_logs, p_can_view_visit_reports, p_can_view_analytics,
    (SELECT auth.uid()), pg_catalog.now(), pg_catalog.now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    scope_mode = EXCLUDED.scope_mode,
    can_view_daily_checklist_summary = EXCLUDED.can_view_daily_checklist_summary,
    can_view_checklist_logs = EXCLUDED.can_view_checklist_logs,
    can_view_visit_reports = EXCLUDED.can_view_visit_reports,
    can_view_analytics = EXCLUDED.can_view_analytics,
    configured_by = EXCLUDED.configured_by,
    updated_at = pg_catalog.now();

  DELETE FROM public.manager_report_scope_branches WHERE profile_id = p_profile_id;
  IF p_scope_mode = 'selected' THEN
    INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
    SELECT p_profile_id, supplied.branch_id
    FROM pg_catalog.unnest(v_branch_ids) AS supplied(branch_id);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_manager_report_scope(
  uuid, text, uuid[], boolean, boolean, boolean, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_manager_report_scope(
  uuid, text, uuid[], boolean, boolean, boolean, boolean
) TO authenticated;

-- Admins no longer receive report visibility merely from role. Owner remains the
-- sole automatic all-branch reader; Admin requires can_view_all_reports.
CREATE OR REPLACE FUNCTION public.current_user_can_read_visit_action_path(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_action_id uuid;
BEGIN
  IF p_path IS NULL OR pg_catalog.split_part(p_path, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_action_id := pg_catalog.split_part(p_path, '/', 1)::uuid;
  RETURN EXISTS (
    SELECT 1 FROM public.visit_action_items AS ai
    JOIN public.supervisory_visits AS v ON v.id = ai.visit_id AND v.branch_id = ai.branch_id
    WHERE ai.id = v_action_id
      AND (
        public.current_user_can_read_visit_branch(v.branch_id)
        OR (public.current_user_role() = 'Manager'
            AND public.can_manager_read_visit_action(v_action_id))
      )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.current_user_can_read_visit_action_path(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_visit_action_path(text) TO authenticated;

-- Row-level read guards. Restrictive policies prevent older permissive policies
-- from widening a Manager beyond the explicit capability and branch scope.
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_reports_authorized_branch_shift_read ON public.daily_reports;
DROP POLICY IF EXISTS manager_daily_reports_read_capability ON public.daily_reports;
DROP POLICY IF EXISTS daily_reports_read_scope_guard ON public.daily_reports;
CREATE POLICY daily_reports_read_scope_guard ON public.daily_reports
  AS RESTRICTIVE FOR SELECT TO authenticated, zam_daily_summary_reader
  USING (
    public.current_user_can_read_daily_report(branch_id, shift_type)
    OR (
      current_user::text = 'zam_daily_summary_reader'
      AND public.current_user_manager_scope_allows(
        'can_view_daily_checklist_summary', branch_id
      )
    )
  );
CREATE POLICY daily_reports_summary_rpc_read ON public.daily_reports
  FOR SELECT TO zam_daily_summary_reader
  USING (
    public.current_user_can_read_daily_report(branch_id, shift_type)
    OR public.current_user_manager_scope_allows(
      'can_view_daily_checklist_summary', branch_id
    )
  );

ALTER TABLE public.checklist_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_checklist_logs_read_capability ON public.checklist_logs;
CREATE POLICY checklist_logs_read_scope_guard ON public.checklist_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_can_read_checklist_log(branch_id, executed_by));
ALTER TABLE public.hourly_checklist_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_hourly_checklist_logs_read_capability ON public.hourly_checklist_logs;
CREATE POLICY hourly_checklist_logs_read_scope_guard ON public.hourly_checklist_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_can_read_checklist_log(branch_id, executed_by));

ALTER TABLE public.waste_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_waste_logs_read_capability ON public.waste_logs;
CREATE POLICY waste_logs_report_scope_guard ON public.waste_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.daily_reports AS r
    WHERE r.id = waste_logs.report_id
      AND public.current_user_can_read_daily_report(r.branch_id, r.shift_type)
  ));
ALTER TABLE public.shift_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_shift_issues_read_capability ON public.shift_issues;
CREATE POLICY shift_issues_report_scope_guard ON public.shift_issues
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.daily_reports AS r
    WHERE r.id = shift_issues.report_id
      AND public.current_user_can_read_daily_report(r.branch_id, r.shift_type)
  ));
ALTER TABLE public.negative_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_negative_reviews_read_capability ON public.negative_reviews;
CREATE POLICY negative_reviews_report_scope_guard ON public.negative_reviews
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.daily_reports AS r
    WHERE r.id = negative_reviews.report_id
      AND public.current_user_can_read_daily_report(r.branch_id, r.shift_type)
  ));
ALTER TABLE public.technical_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_technical_issues_read_capability ON public.technical_issues;
CREATE POLICY technical_issues_report_scope_guard ON public.technical_issues
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_can_read_report_branch(branch_id));

ALTER TABLE public.branch_visit_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_visit_assignments_read_capability ON public.branch_visit_assignments;
CREATE POLICY visit_assignments_branch_scope_guard ON public.branch_visit_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.current_user_manager_scope_allows('can_view_visit_reports', branch_id)
  );
ALTER TABLE public.supervisory_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_supervisory_visits_read_capability ON public.supervisory_visits;
CREATE POLICY supervisory_visits_branch_scope_guard ON public.supervisory_visits
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.current_user_manager_scope_allows('can_view_visit_reports', branch_id)
  );
ALTER TABLE public.supervisory_visit_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_supervisory_visit_results_read_capability ON public.supervisory_visit_results;
CREATE POLICY supervisory_visit_results_branch_scope_guard ON public.supervisory_visit_results
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.supervisory_visits AS v
      WHERE v.id = supervisory_visit_results.visit_id
        AND public.current_user_manager_scope_allows('can_view_visit_reports', v.branch_id)
    )
  );
ALTER TABLE public.visit_action_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_visit_action_items_read_capability ON public.visit_action_items;
CREATE POLICY visit_action_items_branch_scope_guard ON public.visit_action_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.current_user_manager_scope_allows('can_view_visit_reports', branch_id)
  );
ALTER TABLE public.visit_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_visit_evidence_read_capability ON public.visit_evidence;
CREATE POLICY visit_evidence_branch_scope_guard ON public.visit_evidence
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.supervisory_visits AS v
      WHERE v.id = visit_evidence.visit_id
        AND public.current_user_manager_scope_allows('can_view_visit_reports', v.branch_id)
    )
  );
ALTER TABLE public.visit_email_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_visit_email_logs_read_capability ON public.visit_email_logs;
CREATE POLICY visit_email_logs_branch_scope_guard ON public.visit_email_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.supervisory_visits AS v
      WHERE v.id = visit_email_logs.visit_id
        AND public.current_user_manager_scope_allows('can_view_visit_reports', v.branch_id)
    )
  );
ALTER TABLE public.visit_action_review_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_visit_action_review_events_read_capability ON public.visit_action_review_events;
CREATE POLICY visit_action_review_events_branch_scope_guard ON public.visit_action_review_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.visit_action_items AS ai
      JOIN public.supervisory_visits AS v ON v.id = ai.visit_id AND v.branch_id = ai.branch_id
      WHERE ai.id = visit_action_review_events.action_item_id
        AND public.current_user_manager_scope_allows('can_view_visit_reports', v.branch_id)
    )
  );
ALTER TABLE public.supervisory_visit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_supervisory_visit_notes_read_capability ON public.supervisory_visit_notes;
CREATE POLICY supervisory_visit_notes_branch_scope_guard ON public.supervisory_visit_notes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.supervisory_visits AS v
      WHERE v.id = supervisory_visit_notes.visit_id
        AND public.current_user_manager_scope_allows('can_view_visit_reports', v.branch_id)
    )
  );

-- RLS on the summary source still applies inside this RPC: its owner is not the
-- table owner, has no BYPASSRLS, and can select only the projection columns.
GRANT USAGE ON SCHEMA public, auth TO zam_daily_summary_reader;
GRANT EXECUTE ON FUNCTION auth.uid() TO zam_daily_summary_reader;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_daily_report(uuid, text)
  TO zam_daily_summary_reader;
GRANT EXECUTE ON FUNCTION public.current_user_manager_scope_allows(text, uuid)
  TO zam_daily_summary_reader;
GRANT EXECUTE ON FUNCTION public.current_user_admin_can_view_all_reports()
  TO zam_daily_summary_reader;
GRANT SELECT (branch_id, report_date, shift_type, entry_time)
  ON public.daily_reports TO zam_daily_summary_reader;
GRANT SELECT (id, name, lifecycle_status) ON public.branches TO zam_daily_summary_reader;

CREATE OR REPLACE FUNCTION public.get_daily_checklist_summary(
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  report_date date,
  shift_type text,
  entry_time text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_status text;
  v_has_permission boolean := false;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لقراءة الملخص' USING ERRCODE = '42501';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from
     OR (p_date_to - p_date_from) > 365 THEN
    RAISE EXCEPTION 'نطاق تاريخ الملخص غير صالح أو يتجاوز 366 يومًا'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.role, p.status INTO v_role, v_status
  FROM public.profiles AS p WHERE p.id = (SELECT auth.uid());
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'الحساب غير نشط أو غير مخول' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'Owner' THEN
    v_has_permission := true;
  ELSIF v_role = 'Admin' THEN
    v_has_permission := public.current_user_admin_can_view_all_reports();
  ELSIF v_role = 'Manager' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.manager_report_scopes AS s
      WHERE s.profile_id = (SELECT auth.uid())
        AND s.can_view_daily_checklist_summary IS TRUE
        AND (
          s.scope_mode = 'all'
          OR (s.scope_mode = 'selected' AND EXISTS (
            SELECT 1 FROM public.manager_report_scope_branches AS sb
            WHERE sb.profile_id = s.profile_id
          ))
        )
    ) INTO v_has_permission;
  END IF;
  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'لا تملك صلاحية قراءة ملخص التقارير' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.branch_id, b.name, r.report_date, r.shift_type, r.entry_time::text
  FROM public.daily_reports AS r
  JOIN public.branches AS b ON b.id = r.branch_id
  WHERE r.report_date BETWEEN p_date_from AND p_date_to
    AND b.lifecycle_status IS DISTINCT FROM 'planned'
  ORDER BY r.report_date, b.name, r.shift_type;
END;
$function$;
-- The Supabase migration connection is CREATEROLE but not SUPERUSER. Grant it
-- temporary membership so PostgreSQL can transfer function ownership safely.
DO $reader_membership$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT zam_daily_summary_reader TO %I', CURRENT_USER
  );
END;
$reader_membership$;
-- PostgreSQL requires CREATE on the target schema during ownership transfer.
-- This grant is transaction-local in effect: revoke it before COMMIT.
GRANT CREATE ON SCHEMA public TO zam_daily_summary_reader;
ALTER FUNCTION public.get_daily_checklist_summary(date, date)
  OWNER TO zam_daily_summary_reader;
REVOKE CREATE ON SCHEMA public FROM zam_daily_summary_reader;
DO $reader_membership_cleanup$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE zam_daily_summary_reader FROM %I', CURRENT_USER
  );
END;
$reader_membership_cleanup$;
REVOKE ALL ON FUNCTION public.get_daily_checklist_summary(date, date)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_checklist_summary(date, date) TO authenticated;

-- Remove the old single-date contract; callers must use an explicitly bounded range.
DROP FUNCTION IF EXISTS public.get_daily_checklist_summary(date);

-- Manager read permissions on the scopes table are represented by their explicit
-- scope capabilities. No default/legacy grant is created by this migration.
NOTIFY pgrst, 'reload schema';
COMMIT;
