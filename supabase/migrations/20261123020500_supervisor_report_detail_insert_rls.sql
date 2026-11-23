-- Local review candidate: allow a Supervisor to add report details only to the
-- exact daily report they submitted in their currently authorized branch/shift.
BEGIN;

DROP POLICY IF EXISTS waste_logs_supervisor_insert_own_report ON public.waste_logs;
CREATE POLICY waste_logs_supervisor_insert_own_report
  ON public.waste_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'Supervisor'
    AND EXISTS (
      SELECT 1
      FROM public.daily_reports AS report
      WHERE report.id = waste_logs.report_id
        AND report.submitted_by = (SELECT auth.uid())
        AND public.current_supervisor_can_read_daily_report(report.branch_id, report.shift_type)
    )
  );

DROP POLICY IF EXISTS shift_issues_supervisor_insert_own_report ON public.shift_issues;
CREATE POLICY shift_issues_supervisor_insert_own_report
  ON public.shift_issues
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'Supervisor'
    AND EXISTS (
      SELECT 1
      FROM public.daily_reports AS report
      WHERE report.id = shift_issues.report_id
        AND report.submitted_by = (SELECT auth.uid())
        AND public.current_supervisor_can_read_daily_report(report.branch_id, report.shift_type)
    )
  );

DROP POLICY IF EXISTS negative_reviews_supervisor_insert_own_report ON public.negative_reviews;
CREATE POLICY negative_reviews_supervisor_insert_own_report
  ON public.negative_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'Supervisor'
    AND EXISTS (
      SELECT 1
      FROM public.daily_reports AS report
      WHERE report.id = negative_reviews.report_id
        AND report.submitted_by = (SELECT auth.uid())
        AND public.current_supervisor_can_read_daily_report(report.branch_id, report.shift_type)
    )
  );

COMMIT;
