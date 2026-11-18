-- Allow a supervisor to update technical issues only for their own branch.
-- Existing Owner/Admin/Manager policy remains unchanged; no roles or assignments change.
BEGIN;

DROP POLICY IF EXISTS "Supervisors resolve technical issues in their branch"
  ON public.technical_issues;

CREATE POLICY "Supervisors resolve technical issues in their branch"
  ON public.technical_issues
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'Supervisor'
    AND branch_id = public.current_user_branch_id()
  )
  WITH CHECK (
    public.current_user_role() = 'Supervisor'
    AND branch_id = public.current_user_branch_id()
  );

COMMIT;
