-- Fix the SECURITY DEFINER checklist-summary owner access without widening row visibility.
GRANT USAGE ON SCHEMA auth TO zam_daily_summary_reader;
REVOKE ALL ON FUNCTION public.get_daily_checklist_summary(date, date)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_checklist_summary(date, date)
  TO authenticated;

-- Return only the metadata needed for the report-log summary. This is an invoker
-- function: the existing table grants and RLS policies remain authoritative.
CREATE OR REPLACE FUNCTION public.get_daily_report_log_summaries(p_report_ids uuid[])
RETURNS TABLE (
  report_id uuid,
  waste_rows jsonb,
  shift_issue_count bigint,
  technical_issue_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH requested_reports AS (
    SELECT report.id
    FROM public.daily_reports AS report
    WHERE cardinality(COALESCE(p_report_ids, '{}'::uuid[])) <= 10000
      AND report.id = ANY(COALESCE(p_report_ids, '{}'::uuid[]))
  ),
  waste_associations AS (
    SELECT waste.report_id,
      jsonb_agg(
        jsonb_build_object(
          'report_id', waste.report_id,
          'shift_type', waste.shift_type,
          'sheet_key', waste.sheet_key,
          'quantity', waste.quantity,
          'unit', waste.unit
        ) ORDER BY waste.id
      ) AS waste_rows
    FROM public.waste_logs AS waste
    JOIN requested_reports AS report ON report.id = waste.report_id
    GROUP BY waste.report_id
  ),
  shift_issue_counts AS (
    SELECT issue.report_id, count(*)::bigint AS issue_count
    FROM public.shift_issues AS issue
    JOIN requested_reports AS report ON report.id = issue.report_id
    GROUP BY issue.report_id
  ),
  technical_issue_counts AS (
    SELECT issue.report_id, count(*)::bigint AS issue_count
    FROM public.technical_issues AS issue
    JOIN requested_reports AS report ON report.id = issue.report_id
    GROUP BY issue.report_id
  )
  SELECT report.id AS report_id,
    COALESCE(waste.waste_rows, '[]'::jsonb) AS waste_rows,
    COALESCE(shift_issues.issue_count, 0)::bigint AS shift_issue_count,
    COALESCE(technical_issues.issue_count, 0)::bigint AS technical_issue_count
  FROM requested_reports AS report
  LEFT JOIN waste_associations AS waste ON waste.report_id = report.id
  LEFT JOIN shift_issue_counts AS shift_issues ON shift_issues.report_id = report.id
  LEFT JOIN technical_issue_counts AS technical_issues ON technical_issues.report_id = report.id;
$function$;

REVOKE ALL ON FUNCTION public.get_daily_report_log_summaries(uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_report_log_summaries(uuid[])
  TO authenticated;
