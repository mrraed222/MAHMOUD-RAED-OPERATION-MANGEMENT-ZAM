-- Prevent a Supervisor from submitting a report under a branch other than the branch assigned to the authenticated profile.
DROP POLICY IF EXISTS "Supervisor inserts own reports" ON public.daily_reports;

CREATE POLICY "Supervisor inserts own branch reports"
ON public.daily_reports
FOR INSERT
TO authenticated
WITH CHECK (
  current_user_role() = 'Supervisor'
  AND submitted_by = auth.uid()
  AND branch_id = current_user_branch_id()
);
