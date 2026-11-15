-- Keep checklist day boundaries consistent with the Riyadh-based task schedule.
-- Existing execution_date values are deliberately left unchanged.
ALTER TABLE public.checklist_logs
  ALTER COLUMN execution_date SET DEFAULT (pg_catalog.timezone('Asia/Riyadh', now()))::date;

-- Avoid repeated auth.uid() evaluation for every row while retaining branch scoping.
DROP POLICY IF EXISTS inventory_requests_read ON public.inventory_requests;
CREATE POLICY inventory_requests_read ON public.inventory_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = (SELECT auth.uid())
        AND p.status = 'active'
        AND (
          p.role IN ('Owner', 'Admin', 'Manager')
          OR (p.role = 'Supervisor' AND p.branch_id = inventory_requests.branch_id)
        )
    )
  );

CREATE INDEX IF NOT EXISTS inventory_requests_created_by_idx
  ON public.inventory_requests (created_by);
