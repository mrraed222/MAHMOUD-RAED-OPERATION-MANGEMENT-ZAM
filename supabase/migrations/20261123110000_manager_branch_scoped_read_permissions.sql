-- Local Riwaq candidate only. Do not apply to production without independent review
-- and explicit release approval. Depends on the existing manager report-scope and
-- daily-report authorization migrations.
BEGIN;

-- Add independent Manager read capabilities. NULL is used only during the
-- compatibility backfill; the columns become NOT NULL before commit.
ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS can_view_daily_checklist_summary boolean,
  ADD COLUMN IF NOT EXISTS can_view_checklist_logs boolean,
  ADD COLUMN IF NOT EXISTS can_view_visit_reports boolean,
  ADD COLUMN IF NOT EXISTS can_view_analytics boolean;

-- Preserve the old UI-visible report capability. Visit management previously
-- also implied visit-report visibility, so preserve that existing access once.
UPDATE public.admin_permissions AS ap
SET can_view_daily_checklist_summary = COALESCE(ap.can_view_daily_checklist_summary, CASE WHEN p.role = 'Manager' THEN COALESCE(ap.can_view_all_reports, false) ELSE false END),
    can_view_checklist_logs = COALESCE(ap.can_view_checklist_logs, CASE WHEN p.role = 'Manager' THEN COALESCE(ap.can_view_all_reports, false) ELSE false END),
    can_view_visit_reports = COALESCE(ap.can_view_visit_reports, CASE WHEN p.role = 'Manager' THEN COALESCE(ap.can_view_all_reports, false) OR COALESCE(ap.can_manage_branch_visits, false) ELSE false END),
    can_view_analytics = COALESCE(ap.can_view_analytics, CASE WHEN p.role = 'Manager' THEN COALESCE(ap.can_view_all_reports, false) ELSE false END)
FROM public.profiles AS p
WHERE p.id = ap.profile_id;

ALTER TABLE public.admin_permissions
  ALTER COLUMN can_view_daily_checklist_summary SET DEFAULT false,
  ALTER COLUMN can_view_daily_checklist_summary SET NOT NULL,
  ALTER COLUMN can_view_checklist_logs SET DEFAULT false,
  ALTER COLUMN can_view_checklist_logs SET NOT NULL,
  ALTER COLUMN can_view_visit_reports SET DEFAULT false,
  ALTER COLUMN can_view_visit_reports SET NOT NULL,
  ALTER COLUMN can_view_analytics SET DEFAULT false,
  ALTER COLUMN can_view_analytics SET NOT NULL;

-- The branch scope is independent of a data/page permission. Explicit scope rows
-- take precedence; when no row exists, p_legacy_global preserves the old model.
CREATE OR REPLACE FUNCTION public.manager_report_branch_in_scope(
  p_profile_id uuid,
  p_branch_id uuid,
  p_legacy_global boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND EXISTS (
        SELECT 1 FROM public.branches AS b
        WHERE b.id = p_branch_id
          AND b.lifecycle_status IS DISTINCT FROM 'planned'
      )
      AND (
        (NOT EXISTS (
          SELECT 1 FROM public.manager_report_scopes AS s WHERE s.profile_id = p.id
        ) AND COALESCE(p_legacy_global, false))
        OR EXISTS (
          SELECT 1
          FROM public.manager_report_scopes AS s
          WHERE s.profile_id = p.id
            AND (
              s.scope_mode = 'all'
              OR (s.scope_mode = 'selected' AND EXISTS (
                SELECT 1 FROM public.manager_report_scope_branches AS sb
                WHERE sb.profile_id = s.profile_id AND sb.branch_id = p_branch_id
              ))
            )
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.manager_report_branch_in_scope(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- Selected-scope writes must never be configured for a planned branch, even if
-- a caller bypasses the permissions UI and invokes the scope RPC directly.
CREATE OR REPLACE FUNCTION public.reject_planned_manager_report_scope_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS b
    WHERE b.id = NEW.branch_id
      AND b.lifecycle_status IS DISTINCT FROM 'planned'
  ) THEN
    RAISE EXCEPTION 'لا يمكن تحديد فرع مخطط ضمن نطاق التقارير'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.reject_planned_manager_report_scope_branch()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reject_planned_manager_report_scope_branch
  ON public.manager_report_scope_branches;
CREATE TRIGGER reject_planned_manager_report_scope_branch
  BEFORE INSERT OR UPDATE OF branch_id ON public.manager_report_scope_branches
  FOR EACH ROW EXECUTE FUNCTION public.reject_planned_manager_report_scope_branch();

-- Page/data read gate for Managers. The named capability and branch scope must
-- both pass; can_view_all_reports is used only for an unconfigured legacy scope.
CREATE OR REPLACE FUNCTION public.can_manager_read_branch(
  p_permission text,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND CASE p_permission
        WHEN 'can_view_daily_checklist_summary' THEN
          ap.can_view_daily_checklist_summary IS TRUE
          AND public.manager_report_branch_in_scope(
            p.id, p_branch_id, COALESCE(ap.can_view_all_reports, false)
          )
        WHEN 'can_view_checklist_logs' THEN
          ap.can_view_checklist_logs IS TRUE
          AND public.manager_report_branch_in_scope(
            p.id, p_branch_id, COALESCE(ap.can_view_all_reports, false)
          )
        WHEN 'can_view_visit_reports' THEN
          ap.can_view_visit_reports IS TRUE
          AND public.manager_report_branch_in_scope(
            p.id, p_branch_id,
            COALESCE(ap.can_view_all_reports, false) OR COALESCE(ap.can_manage_branch_visits, false)
          )
        WHEN 'can_view_analytics' THEN
          ap.can_view_analytics IS TRUE
          AND public.manager_report_branch_in_scope(
            p.id, p_branch_id, COALESCE(ap.can_view_all_reports, false)
          )
        ELSE false
      END
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_branch(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_branch(text, uuid) TO authenticated;

-- Keep the existing report helper as a pure scope check; read permissions are
-- applied separately by restrictive SELECT policies below.
CREATE OR REPLACE FUNCTION public.can_read_manager_report_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.manager_report_branch_in_scope(
    (SELECT auth.uid()), p_branch_id,
    EXISTS (
      SELECT 1 FROM public.admin_permissions AS ap
      WHERE ap.profile_id = (SELECT auth.uid()) AND ap.can_view_all_reports IS TRUE
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_read_manager_report_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_manager_report_branch(uuid) TO authenticated;

-- Write-side parent/scope authorization ignores the four read capabilities.
-- PostgreSQL still applies SELECT visibility to row-targeted UPDATE/DELETE.
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
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE r.id = p_report_id
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND ap.can_manage_reports IS TRUE
      AND public.manager_report_branch_in_scope(
        p.id, r.branch_id, COALESCE(ap.can_view_all_reports, false)
      )
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
    SELECT 1
    FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND ap.can_manage_reports IS TRUE
      AND public.manager_report_branch_in_scope(
        p.id, p_branch_id, COALESCE(ap.can_view_all_reports, false)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_write_daily_report_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_write_daily_report_branch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_read_daily_report_details(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.daily_reports AS r
    WHERE r.id = p_report_id
      AND public.can_manager_read_branch('can_view_analytics', r.branch_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_daily_report_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_daily_report_details(uuid) TO authenticated;

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
    SELECT 1
    FROM public.daily_reports AS r
    JOIN public.profiles AS p ON p.id = (SELECT auth.uid())
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE r.id = p_report_id
      AND r.branch_id = p_branch_id
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND public.manager_report_branch_in_scope(
        p.id, r.branch_id, COALESCE(ap.can_view_all_reports, false)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_write_technical_issue_report(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_write_technical_issue_report(uuid, uuid)
  TO authenticated;

-- The email recipient helper needs the same branch scope, but not a page grant.
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
  SELECT public.manager_report_branch_in_scope(
    p_profile_id, p_branch_id,
    EXISTS (
      SELECT 1 FROM public.admin_permissions AS ap
      WHERE ap.profile_id = p_profile_id AND ap.can_view_all_reports IS TRUE
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.profile_can_read_manager_report_branch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Report-copy eligibility is narrower than the summary projection: the endpoint
-- returns a full-detail PDF, so Managers need analytics/detail access and scope.
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
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND (
        p.role IN ('Owner', 'Admin')
        OR (
          p.role = 'Manager'
          AND ap.can_view_analytics IS TRUE
          AND public.profile_can_read_manager_report_branch(p.id, p_branch_id)
        )
        OR (p.role = 'Supervisor' AND p.branch_id = p_branch_id
            AND p.shift_type IN ('Morning', 'Evening', 'Both'))
      )
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
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = p_profile_id
        AND p.status = 'active'
        AND (
          p.role IN ('Owner', 'Admin')
          OR (p.role = 'Manager'
              AND public.can_profile_read_daily_report_branch(p.id, p_branch_id))
          OR (p.role = 'Supervisor' AND p.branch_id = p_branch_id
              AND p.shift_type IN ('Morning', 'Evening', 'Both')
              AND (p.shift_type = 'Both' OR p.shift_type = p_report_shift_type))
        )
    );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_daily_report(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- The report-copy Edge Function returns a full-detail PDF from a service-role
-- client. Managers need analytics/detail access plus their branch scope.
CREATE OR REPLACE FUNCTION public.can_generate_daily_report_copy(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_reports AS r
    JOIN public.profiles AS actor ON actor.id = (SELECT auth.uid())
    WHERE r.id = p_report_id
      AND actor.status = 'active'
      AND (
        actor.role IN ('Owner', 'Admin')
        OR (actor.role = 'Manager'
            AND public.can_manager_read_branch('can_view_analytics', r.branch_id))
        OR (actor.role = 'Supervisor'
            AND public.current_supervisor_can_read_daily_report(r.branch_id, r.shift_type))
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_generate_daily_report_copy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_generate_daily_report_copy(uuid) TO authenticated;

-- Report DML requires an explicit write grant plus branch scope. UPDATE/DELETE
-- additionally require detail visibility because PostgreSQL targets only rows
-- visible through SELECT RLS; write-only Managers can create, not edit hidden rows.
DROP POLICY IF EXISTS "Manager inserts reports" ON public.daily_reports;
CREATE POLICY "Manager inserts reports" ON public.daily_reports
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_role() = 'Manager'
    AND public.can_manager_write_daily_report_branch(branch_id)
  );
DROP POLICY IF EXISTS "Manager updates reports" ON public.daily_reports;
CREATE POLICY "Manager updates reports" ON public.daily_reports
  FOR UPDATE TO authenticated
  USING (
    public.can_manager_write_daily_report_branch(branch_id)
    AND public.can_manager_read_branch('can_view_analytics', branch_id)
  )
  WITH CHECK (
    public.can_manager_write_daily_report_branch(branch_id)
    AND public.can_manager_read_branch('can_view_analytics', branch_id)
  );
DROP POLICY IF EXISTS "Manager deletes reports" ON public.daily_reports;
CREATE POLICY "Manager deletes reports" ON public.daily_reports
  FOR DELETE TO authenticated USING (
    public.can_manager_write_daily_report_branch(branch_id)
    AND public.can_manager_read_branch('can_view_analytics', branch_id)
  );

CREATE OR REPLACE FUNCTION public.can_profile_read_all_daily_report_branches(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND (
        p.role IN ('Owner', 'Admin')
        OR (
          p.role = 'Manager'
          AND (
            (NOT EXISTS (
              SELECT 1 FROM public.manager_report_scopes AS s WHERE s.profile_id = p.id
            ) AND ap.can_view_all_reports IS TRUE)
            OR EXISTS (
              SELECT 1 FROM public.manager_report_scopes AS s
              WHERE s.profile_id = p.id AND s.scope_mode = 'all'
            )
          )
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_all_daily_report_branches(uuid)
  FROM PUBLIC, anon, authenticated;

-- Checklist execution history: replace the role-wide Manager policies and add
-- a restrictive gate so own-row and other permissive policies cannot bypass it.
DROP POLICY IF EXISTS "Admin roles read all checklist logs" ON public.checklist_logs;
CREATE POLICY "Admin roles read all checklist logs" ON public.checklist_logs
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('Owner', 'Admin')
    OR (public.current_user_role() = 'Manager'
        AND public.can_manager_read_branch('can_view_checklist_logs', branch_id))
  );
DROP POLICY IF EXISTS manager_checklist_logs_read_capability ON public.checklist_logs;
CREATE POLICY manager_checklist_logs_read_capability ON public.checklist_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_branch('can_view_checklist_logs', branch_id)
  );

DROP POLICY IF EXISTS "Admin roles read all hourly checklist logs" ON public.hourly_checklist_logs;
CREATE POLICY "Admin roles read all hourly checklist logs" ON public.hourly_checklist_logs
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('Owner', 'Admin')
    OR (public.current_user_role() = 'Manager'
        AND public.can_manager_read_branch('can_view_checklist_logs', branch_id))
  );
DROP POLICY IF EXISTS manager_hourly_checklist_logs_read_capability ON public.hourly_checklist_logs;
CREATE POLICY manager_hourly_checklist_logs_read_capability ON public.hourly_checklist_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_branch('can_view_checklist_logs', branch_id)
  );

-- Daily reports share a source table between the daily summary and analytics.
-- Either explicit read capability permits this source; page routes stay separate.
DROP POLICY IF EXISTS manager_daily_reports_read_capability ON public.daily_reports;
CREATE POLICY manager_daily_reports_read_capability ON public.daily_reports
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_branch('can_view_daily_checklist_summary', branch_id)
    OR public.can_manager_read_branch('can_view_analytics', branch_id)
  );

-- The analytics dashboard reads these report children directly, so each child
-- needs the same permission gate as its visible parent report.
DROP POLICY IF EXISTS manager_waste_logs_read_capability ON public.waste_logs;
CREATE POLICY manager_waste_logs_read_capability ON public.waste_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.daily_reports AS r
      WHERE r.id = waste_logs.report_id
        AND (public.can_manager_read_branch('can_view_daily_checklist_summary', r.branch_id)
             OR public.can_manager_read_branch('can_view_analytics', r.branch_id))
    )
  );
DROP POLICY IF EXISTS manager_shift_issues_read_capability ON public.shift_issues;
CREATE POLICY manager_shift_issues_read_capability ON public.shift_issues
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.daily_reports AS r
      WHERE r.id = shift_issues.report_id
        AND (public.can_manager_read_branch('can_view_daily_checklist_summary', r.branch_id)
             OR public.can_manager_read_branch('can_view_analytics', r.branch_id))
    )
  );
DROP POLICY IF EXISTS manager_negative_reviews_read_capability ON public.negative_reviews;
CREATE POLICY manager_negative_reviews_read_capability ON public.negative_reviews
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.daily_reports AS r
      WHERE r.id = negative_reviews.report_id
        AND (public.can_manager_read_branch('can_view_daily_checklist_summary', r.branch_id)
             OR public.can_manager_read_branch('can_view_analytics', r.branch_id))
    )
  );

-- Keep Manager INSERT independent of SELECT capabilities. UPDATE/DELETE policies
-- retain branch scope, while PostgreSQL still requires SELECT-visible target rows.
DROP POLICY IF EXISTS "Manager inserts waste" ON public.waste_logs;
CREATE POLICY "Manager inserts waste" ON public.waste_logs
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_role() = 'Manager'
    AND public.can_manager_write_daily_report(report_id)
  );
DROP POLICY IF EXISTS "Manager updates waste" ON public.waste_logs;
CREATE POLICY "Manager updates waste" ON public.waste_logs
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'Manager' AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id))
  WITH CHECK (public.current_user_role() = 'Manager' AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id));
DROP POLICY IF EXISTS "Manager deletes waste" ON public.waste_logs;
CREATE POLICY "Manager deletes waste" ON public.waste_logs
  FOR DELETE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id)
  );

DROP POLICY IF EXISTS "Manager inserts shift issues" ON public.shift_issues;
CREATE POLICY "Manager inserts shift issues" ON public.shift_issues
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_role() = 'Manager'
    AND public.can_manager_write_daily_report(report_id)
  );
DROP POLICY IF EXISTS "Manager updates shift issues" ON public.shift_issues;
CREATE POLICY "Manager updates shift issues" ON public.shift_issues
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'Manager' AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id))
  WITH CHECK (public.current_user_role() = 'Manager' AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id));
DROP POLICY IF EXISTS "Manager deletes shift issues" ON public.shift_issues;
CREATE POLICY "Manager deletes shift issues" ON public.shift_issues
  FOR DELETE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id)
  );

DROP POLICY IF EXISTS "Manager inserts reviews" ON public.negative_reviews;
CREATE POLICY "Manager inserts reviews" ON public.negative_reviews
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_role() = 'Manager'
    AND public.can_manager_write_daily_report(report_id)
  );
DROP POLICY IF EXISTS "Manager updates reviews" ON public.negative_reviews;
CREATE POLICY "Manager updates reviews" ON public.negative_reviews
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'Manager' AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id))
  WITH CHECK (public.current_user_role() = 'Manager' AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id));
DROP POLICY IF EXISTS "Manager deletes reviews" ON public.negative_reviews;
CREATE POLICY "Manager deletes reviews" ON public.negative_reviews
  FOR DELETE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND public.can_manager_write_daily_report(report_id)
    AND public.can_manager_read_daily_report_details(report_id)
  );

-- The linked issue parent constraint must also avoid consulting the Manager's
-- report SELECT path; retain same-report/branch validation for other roles.
DROP POLICY IF EXISTS technical_issues_authorized_report_parent ON public.technical_issues;
CREATE POLICY technical_issues_authorized_report_parent
  ON public.technical_issues AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    report_id IS NULL
    OR (public.current_user_role() = 'Manager'
        AND public.can_manager_write_technical_issue_report(report_id, branch_id))
    OR (public.current_user_role() <> 'Manager'
        AND EXISTS (
          SELECT 1 FROM public.daily_reports AS r
          WHERE r.id = technical_issues.report_id AND r.branch_id = technical_issues.branch_id
        ))
  )
  WITH CHECK (
    report_id IS NULL
    OR (public.current_user_role() = 'Manager'
        AND public.can_manager_write_technical_issue_report(report_id, branch_id))
    OR (public.current_user_role() <> 'Manager'
        AND EXISTS (
          SELECT 1 FROM public.daily_reports AS r
          WHERE r.id = technical_issues.report_id AND r.branch_id = technical_issues.branch_id
        ))
  );

-- Analytics technical-issue reads must be scoped and explicitly enabled. Preserve
-- the existing Owner/Admin and non-manager same-branch paths.
DROP POLICY IF EXISTS "Read technical issues" ON public.technical_issues;
CREATE POLICY "Read technical issues" ON public.technical_issues
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('Owner', 'Admin')
    OR (public.current_user_role() = 'Manager'
        AND public.can_manager_read_branch('can_view_analytics', branch_id))
    OR (public.current_user_role() NOT IN ('Owner', 'Admin', 'Manager')
        AND branch_id = public.current_user_branch_id())
  );

-- Assignment-based visit visibility must refer to the same branch, date, and
-- shift as its parent visit; otherwise a mismatched assignment could cross scope.
CREATE OR REPLACE FUNCTION public.can_access_branch_visit(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.can_view_branch_visit_reports()
    OR (
      public.can_review_branch_visit_actions()
      AND EXISTS (
        SELECT 1 FROM public.visit_action_items AS ai
        JOIN public.supervisory_visits AS v ON v.id = ai.visit_id
        WHERE v.id = p_visit_id
          AND ai.branch_id = v.branch_id
          AND (ai.status = 'بانتظار اعتماد الإدارة' OR ai.reviewed_by = (SELECT auth.uid()))
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.supervisory_visits AS v
      WHERE v.id = p_visit_id
        AND EXISTS (
          SELECT 1 FROM public.profiles AS actor
          WHERE actor.id = (SELECT auth.uid()) AND actor.status = 'active'
        )
        AND (
          v.signed_by = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.branch_visit_assignments AS a
            WHERE a.id = v.assignment_id
              AND a.branch_id = v.branch_id
              AND a.visit_date = v.visit_date
              AND a.shift_type = v.shift_type
              AND a.assigned_to = (SELECT auth.uid())
              AND a.status <> 'cancelled'
          )
          OR EXISTS (
            SELECT 1 FROM public.visit_action_items AS ai
            WHERE ai.visit_id = v.id
              AND ai.branch_id = v.branch_id
              AND ai.assigned_to = (SELECT auth.uid())
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles AS supervisor
            JOIN public.visit_action_items AS ai
              ON ai.branch_id = supervisor.branch_id
             AND ai.visit_id = v.id
            WHERE supervisor.id = (SELECT auth.uid())
              AND supervisor.status = 'active'
              AND supervisor.role = 'Supervisor'
              AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
              AND (ai.shift_type IS NULL OR ai.shift_type = supervisor.shift_type)
          )
        )
    );
$function$;
GRANT EXECUTE ON FUNCTION public.can_access_branch_visit(uuid) TO authenticated;

-- Visit helpers enforce branch scope for reports while preserving only the
-- manager's own assignment and current action-review paths when report access
-- is not enabled. These exceptions never grant branch-wide reads.
CREATE OR REPLACE FUNCTION public.can_manager_read_visit(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = (SELECT auth.uid())
      AND actor.status = 'active'
      AND actor.role = 'Manager'
  )
  AND EXISTS (
    SELECT 1 FROM public.supervisory_visits AS v
    WHERE v.id = p_visit_id
      AND EXISTS (
        SELECT 1 FROM public.branches AS b
        WHERE b.id = v.branch_id AND b.lifecycle_status IS DISTINCT FROM 'planned'
      )
      AND (
        public.can_manager_read_branch('can_view_visit_reports', v.branch_id)
        OR v.signed_by = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.branch_visit_assignments AS a
          WHERE a.id = v.assignment_id
            AND a.branch_id = v.branch_id
            AND a.visit_date = v.visit_date
            AND a.shift_type = v.shift_type
            AND a.assigned_to = (SELECT auth.uid())
            AND a.status <> 'cancelled'
        )
        OR EXISTS (
          SELECT 1 FROM public.visit_action_items AS ai
          WHERE ai.visit_id = v.id
            AND ai.branch_id = v.branch_id
            AND ai.assigned_to = (SELECT auth.uid())
        )
        OR (
          public.can_review_branch_visit_actions()
          AND EXISTS (
            SELECT 1 FROM public.visit_action_items AS ai
            WHERE ai.visit_id = v.id
              AND ai.branch_id = v.branch_id
              AND (ai.status = 'بانتظار اعتماد الإدارة' OR ai.reviewed_by = (SELECT auth.uid()))
          )
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_visit(uuid) TO authenticated;

-- Full visit details are available only for the Manager's scoped branch or a
-- visit specifically signed/assigned to them; action review remains narrower.
CREATE OR REPLACE FUNCTION public.can_manager_read_visit_report(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = (SELECT auth.uid())
      AND actor.status = 'active'
      AND actor.role = 'Manager'
  )
  AND EXISTS (
    SELECT 1 FROM public.supervisory_visits AS v
    WHERE v.id = p_visit_id
      AND EXISTS (
        SELECT 1 FROM public.branches AS b
        WHERE b.id = v.branch_id AND b.lifecycle_status IS DISTINCT FROM 'planned'
      )
      AND (
        public.can_manager_read_branch('can_view_visit_reports', v.branch_id)
        OR v.signed_by = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.branch_visit_assignments AS a
          WHERE a.id = v.assignment_id
            AND a.branch_id = v.branch_id
            AND a.visit_date = v.visit_date
            AND a.shift_type = v.shift_type
            AND a.assigned_to = (SELECT auth.uid())
            AND a.status <> 'cancelled'
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_visit_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_visit_report(uuid) TO authenticated;

-- Manager email recipients must have the same dedicated visit-report flag and
-- branch scope as a full-report reader; action/review exceptions are not enough.
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
    SELECT 1
    FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    JOIN public.supervisory_visits AS v ON v.id = p_visit_id
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND ap.can_view_visit_reports IS TRUE
      AND public.manager_report_branch_in_scope(
        p.id,
        v.branch_id,
        COALESCE(ap.can_view_all_reports, false)
          OR COALESCE(ap.can_manage_branch_visits, false)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.profile_can_read_manager_visit_report(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Keep the existing management-role set, but filter Managers by the full report
-- permission for this visit before attaching its PDF to email.
CREATE OR REPLACE FUNCTION public.get_branch_visit_report_email_recipients(p_visit_id uuid)
RETURNS TABLE (profile_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.email
  FROM public.profiles AS p
  JOIN public.supervisory_visits AS v ON v.id = p_visit_id
  WHERE p.status = 'active'
    AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND (
      p.role IN ('Owner', 'Admin', 'Quality', 'Quality Manager')
      OR (p.role = 'Manager'
          AND public.profile_can_read_manager_visit_report(p.id, p_visit_id))
    )
  ORDER BY (p.role = 'Owner') DESC, p.created_at, p.id;
$function$;
REVOKE ALL ON FUNCTION public.get_branch_visit_report_email_recipients(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_visit_report_email_recipients(uuid) TO service_role;

-- A full PDF may be generated for a full-report reader, a visit signer, or the
-- employee assigned to the visit itself; action-only access stays row-limited.
CREATE OR REPLACE FUNCTION public.can_access_branch_visit_report(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = (SELECT auth.uid())
      AND actor.status = 'active'
      AND actor.role <> 'Manager'
  )
  AND EXISTS (
    SELECT 1 FROM public.supervisory_visits AS v
    WHERE v.id = p_visit_id
      AND (
        public.can_view_branch_visit_reports()
        OR v.signed_by = (SELECT auth.uid())
        OR (
          v.assignment_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.branch_visit_assignments AS a
            WHERE a.id = v.assignment_id
              AND a.branch_id = v.branch_id
              AND a.visit_date = v.visit_date
              AND a.shift_type = v.shift_type
              AND a.assigned_to = (SELECT auth.uid())
              AND a.status <> 'cancelled'
          )
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_access_branch_visit_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_branch_visit_report(uuid) TO authenticated;

-- The Edge Function can enforce this combined gate before creating or reading
-- through a service-role client, without loading a profile to choose a path.
CREATE OR REPLACE FUNCTION public.can_generate_branch_visit_report_pdf(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN public.current_user_role() = 'Manager'
      THEN public.can_manager_read_visit_report(p_visit_id)
    ELSE public.can_access_branch_visit_report(p_visit_id)
  END;
$function$;
REVOKE ALL ON FUNCTION public.can_generate_branch_visit_report_pdf(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_generate_branch_visit_report_pdf(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_read_visit_action(p_action_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.visit_action_items AS ai
    JOIN public.supervisory_visits AS v
      ON v.id = ai.visit_id AND v.branch_id = ai.branch_id
    WHERE ai.id = p_action_id
      AND EXISTS (
        SELECT 1 FROM public.profiles AS actor
        WHERE actor.id = (SELECT auth.uid())
          AND actor.status = 'active'
          AND actor.role = 'Manager'
      )
      AND EXISTS (
        SELECT 1 FROM public.branches AS b
        WHERE b.id = v.branch_id AND b.lifecycle_status IS DISTINCT FROM 'planned'
      )
      AND (
        public.can_manager_read_branch('can_view_visit_reports', v.branch_id)
        OR public.can_manager_read_visit_report(v.id)
        OR ai.assigned_to = (SELECT auth.uid())
        OR (
          public.can_review_branch_visit_actions()
          AND (ai.status = 'بانتظار اعتماد الإدارة' OR ai.reviewed_by = (SELECT auth.uid()))
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_visit_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_visit_action(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manager_read_visit_action_path(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_action_id uuid;
BEGIN
  IF p_path IS NULL OR split_part(p_path, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_action_id := split_part(p_path, '/', 1)::uuid;
  RETURN public.can_manager_read_visit_action(v_action_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.can_manager_read_visit_action_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manager_read_visit_action_path(text) TO authenticated;

-- A restrictive policy can only narrow access; give the new Manager read flag
-- an explicit, equally scoped permissive path on tables whose old policy only
-- admitted visit managers, assignees, or reviewers.
DROP POLICY IF EXISTS manager_visit_assignments_read_scope ON public.branch_visit_assignments;
CREATE POLICY manager_visit_assignments_read_scope ON public.branch_visit_assignments
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'Manager'
    AND (public.can_manager_read_branch('can_view_visit_reports', branch_id)
         OR assigned_to = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS manager_visit_assignments_read_capability ON public.branch_visit_assignments;
CREATE POLICY manager_visit_assignments_read_capability ON public.branch_visit_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_branch('can_view_visit_reports', branch_id)
    OR assigned_to = (SELECT auth.uid())
  );

ALTER TABLE public.supervisory_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_supervisory_visits_read_scope ON public.supervisory_visits;
CREATE POLICY manager_supervisory_visits_read_scope ON public.supervisory_visits
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'Manager'
    AND public.can_manager_read_visit(id)
  );
DROP POLICY IF EXISTS manager_supervisory_visits_read_capability ON public.supervisory_visits;
CREATE POLICY manager_supervisory_visits_read_capability ON public.supervisory_visits
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_visit(id)
  );

DROP POLICY IF EXISTS manager_supervisory_visit_results_read_capability ON public.supervisory_visit_results;
CREATE POLICY manager_supervisory_visit_results_read_capability ON public.supervisory_visit_results
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_visit_report(supervisory_visit_results.visit_id)
    OR EXISTS (
      SELECT 1 FROM public.visit_action_items AS ai
      WHERE ai.visit_id = supervisory_visit_results.visit_id
        AND ai.result_id = supervisory_visit_results.id
        AND public.can_manager_read_visit_action(ai.id)
    )
  );

DROP POLICY IF EXISTS manager_visit_action_items_read_scope ON public.visit_action_items;
CREATE POLICY manager_visit_action_items_read_scope ON public.visit_action_items
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'Manager'
    AND public.can_manager_read_visit_action(id)
  );
DROP POLICY IF EXISTS manager_visit_action_items_read_capability ON public.visit_action_items;
CREATE POLICY manager_visit_action_items_read_capability ON public.visit_action_items
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_visit_action(id)
  );

DROP POLICY IF EXISTS manager_visit_evidence_read_capability ON public.visit_evidence;
CREATE POLICY manager_visit_evidence_read_capability ON public.visit_evidence
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_visit_report(visit_evidence.visit_id)
    OR EXISTS (
      SELECT 1 FROM public.visit_action_items AS ai
      WHERE ai.visit_id = visit_evidence.visit_id
        AND (ai.id = visit_evidence.action_item_id OR ai.result_id = visit_evidence.result_id)
        AND public.can_manager_read_visit_action(ai.id)
    )
  );

DROP POLICY IF EXISTS manager_visit_email_logs_read_capability ON public.visit_email_logs;
CREATE POLICY manager_visit_email_logs_read_capability ON public.visit_email_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_branch(
      'can_view_visit_reports',
      (SELECT v.branch_id FROM public.supervisory_visits AS v WHERE v.id = visit_email_logs.visit_id)
    )
  );

DROP POLICY IF EXISTS manager_visit_action_review_events_read_scope ON public.visit_action_review_events;
CREATE POLICY manager_visit_action_review_events_read_scope ON public.visit_action_review_events
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'Manager'
    AND public.can_manager_read_visit_action(action_item_id)
  );
DROP POLICY IF EXISTS manager_visit_action_review_events_read_capability ON public.visit_action_review_events;
CREATE POLICY manager_visit_action_review_events_read_capability ON public.visit_action_review_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_visit_action(action_item_id)
  );

-- The dedicated private evidence bucket also follows the visit's branch scope.
DROP POLICY IF EXISTS manager_visit_action_evidence_read_scope ON storage.objects;
CREATE POLICY manager_visit_action_evidence_read_scope ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'visit-action-evidence'
    AND public.current_user_role() = 'Manager'
    AND public.can_manager_read_visit_action_path(name)
  );
DROP POLICY IF EXISTS manager_visit_action_evidence_read_capability ON storage.objects;
CREATE POLICY manager_visit_action_evidence_read_capability ON storage.objects
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket_id <> 'visit-action-evidence'
    OR public.current_user_role() <> 'Manager'
    OR public.can_manager_read_visit_action_path(name)
  );


-- The weekly report reads these notes directly; guard their parent-visit scope too.
ALTER TABLE public.supervisory_visit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_supervisory_visit_notes_read_scope ON public.supervisory_visit_notes;
CREATE POLICY manager_supervisory_visit_notes_read_scope ON public.supervisory_visit_notes
  FOR SELECT TO authenticated
  USING (
    (
      public.current_user_role() = 'Manager'
      AND public.can_manager_read_visit_report(visit_id)
    )
    OR (
      public.current_user_role() IN ('Owner', 'Admin')
      AND EXISTS (
        SELECT 1 FROM public.profiles AS actor
        WHERE actor.id = (SELECT auth.uid()) AND actor.status = 'active'
      )
    )
    OR (
      public.current_user_role() NOT IN ('Owner', 'Admin', 'Manager')
      AND public.can_access_branch_visit_report(visit_id)
    )
  );
DROP POLICY IF EXISTS manager_supervisory_visit_notes_read_capability ON public.supervisory_visit_notes;
CREATE POLICY manager_supervisory_visit_notes_read_capability ON public.supervisory_visit_notes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    CASE public.current_user_role()
      WHEN 'Manager' THEN public.can_manager_read_visit_report(supervisory_visit_notes.visit_id)
      WHEN 'Owner' THEN EXISTS (
        SELECT 1 FROM public.profiles AS actor
        WHERE actor.id = (SELECT auth.uid()) AND actor.status = 'active'
      )
      WHEN 'Admin' THEN EXISTS (
        SELECT 1 FROM public.profiles AS actor
        WHERE actor.id = (SELECT auth.uid()) AND actor.status = 'active'
      )
      ELSE public.can_access_branch_visit_report(supervisory_visit_notes.visit_id)
    END
  );

COMMIT;
