-- Local Riwaq candidate only. Do not apply to production without independent review
-- and explicit release approval.
BEGIN;

-- Managers with the summary capability may see only branch/shift submission
-- coverage. Do not expose report identifiers, sales, child rows, or analytics
-- through the shared daily_reports source table.
CREATE OR REPLACE FUNCTION public.get_daily_checklist_summary(p_report_date date)
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  report_date date,
  shift_type text,
  entry_time text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT r.branch_id, b.name, r.report_date, r.shift_type, r.entry_time::text
  FROM public.daily_reports AS r
  JOIN public.branches AS b ON b.id = r.branch_id
  WHERE p_report_date IS NOT NULL
    AND r.report_date = p_report_date
    AND b.lifecycle_status IS DISTINCT FROM 'planned'
    AND EXISTS (
      SELECT 1 FROM public.profiles AS actor
      WHERE actor.id = (SELECT auth.uid())
        AND actor.status = 'active'
        AND (
          actor.role IN ('Owner', 'Admin')
          OR (actor.role = 'Manager'
              AND public.can_manager_read_branch('can_view_daily_checklist_summary', r.branch_id))
        )
    )
  ORDER BY b.name, r.shift_type;
$function$;
REVOKE ALL ON FUNCTION public.get_daily_checklist_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_checklist_summary(date) TO authenticated;

-- The Manager summary is served only by the projection RPC. The shared source
-- table and its analytics details require the independent analytics grant.
DROP POLICY IF EXISTS manager_daily_reports_read_capability ON public.daily_reports;
CREATE POLICY manager_daily_reports_read_capability ON public.daily_reports
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_branch('can_view_analytics', branch_id)
  );

DROP POLICY IF EXISTS manager_waste_logs_read_capability ON public.waste_logs;
CREATE POLICY manager_waste_logs_read_capability ON public.waste_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.daily_reports AS r
      WHERE r.id = waste_logs.report_id
        AND public.can_manager_read_branch('can_view_analytics', r.branch_id)
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
        AND public.can_manager_read_branch('can_view_analytics', r.branch_id)
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
        AND public.can_manager_read_branch('can_view_analytics', r.branch_id)
    )
  );

DROP POLICY IF EXISTS manager_technical_issues_read_capability ON public.technical_issues;
CREATE POLICY manager_technical_issues_read_capability ON public.technical_issues
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Manager'
    OR public.can_manager_read_branch('can_view_analytics', branch_id)
  );

COMMIT;
