-- Local-only candidate: explicitly associate a manually created technical issue
-- with the exact saved report ID. Never infer or backfill historical membership.
BEGIN;

-- The composite FK below enforces that the issue and its report always share a branch.
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_id_branch_uidx
  ON public.daily_reports (id, branch_id);

ALTER TABLE public.technical_issues
  ADD COLUMN IF NOT EXISTS report_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.technical_issues'::regclass
      AND conname = 'technical_issues_report_branch_fkey'
  ) THEN
    ALTER TABLE public.technical_issues
      ADD CONSTRAINT technical_issues_report_branch_fkey
      FOREIGN KEY (report_id, branch_id)
      REFERENCES public.daily_reports (id, branch_id)
      ON DELETE SET NULL (report_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.technical_issues'::regclass
      AND conname = 'technical_issues_report_manual_source_check'
  ) THEN
    ALTER TABLE public.technical_issues
      ADD CONSTRAINT technical_issues_report_manual_source_check
      CHECK (report_id IS NULL OR source = 'manual');
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS technical_issues_report_id_idx
  ON public.technical_issues (report_id)
  WHERE report_id IS NOT NULL;

COMMENT ON COLUMN public.technical_issues.report_id IS
  'Optional exact daily report association, supplied only when a manual issue is created from a saved report flow; historical issues remain NULL.';

-- A report link is write-once at issue creation. Existing unlinked rows cannot
-- later be attached by date/branch/reporter matching or an UPDATE.
CREATE OR REPLACE FUNCTION public.prevent_technical_issue_report_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.report_id IS DISTINCT FROM OLD.report_id AND NEW.report_id IS NOT NULL THEN
    RAISE EXCEPTION 'technical_issue_report_link_is_creation_only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.prevent_technical_issue_report_reassignment()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS technical_issues_report_link_creation_only ON public.technical_issues;
CREATE TRIGGER technical_issues_report_link_creation_only
  BEFORE UPDATE OF report_id ON public.technical_issues
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_technical_issue_report_reassignment();

-- This restrictive parent check composes with the existing permissive technical
-- issue policies. RLS on daily_reports supplies the caller's existing role,
-- branch, manager-scope, and Supervisor-shift authorization.
DROP POLICY IF EXISTS technical_issues_authorized_report_parent ON public.technical_issues;
CREATE POLICY technical_issues_authorized_report_parent
  ON public.technical_issues
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    report_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.daily_reports AS report
      WHERE report.id = technical_issues.report_id
        AND report.branch_id = technical_issues.branch_id
    )
  )
  WITH CHECK (
    report_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.daily_reports AS report
      WHERE report.id = technical_issues.report_id
        AND report.branch_id = technical_issues.branch_id
    )
  );

COMMIT;
