-- Allow a shift supervisor to see actions assigned to the supervisor role,
-- but only for the supervisor's own branch and shift. Do not grant write access here.
DROP POLICY IF EXISTS visit_actions_read ON public.visit_action_items;
CREATE POLICY visit_actions_read ON public.visit_action_items FOR SELECT TO authenticated
  USING (
    current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager')
    OR assigned_to = auth.uid()
    OR (
      current_user_role() = 'Supervisor'
      AND branch_id = current_user_branch_id()
      AND assigned_role IN ('مشرف الشفت','Supervisor','Shift Supervisor')
      AND (
        shift_type IS NULL
        OR shift_type = (SELECT p.shift_type FROM public.profiles AS p WHERE p.id = auth.uid())
      )
    )
  );
