-- Reviewed release migration. Preserve historical task-evidence rows while allowing
-- new action-linked private evidence to coexist with legacy evidence per checklist item.
BEGIN;

DROP INDEX IF EXISTS public.visit_evidence_visit_client_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS visit_evidence_legacy_visit_client_key_unique
  ON public.visit_evidence (visit_id, client_key)
  WHERE action_item_id IS NULL AND client_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS visit_evidence_action_file_path_unique
  ON public.visit_evidence (visit_id, action_item_id, file_path);

-- A visit submitter or in-scope visit manager may attach the initial violation
-- photo, even when the corrective action is assigned to another employee.
DROP POLICY IF EXISTS visit_action_evidence_upload ON storage.objects;
CREATE POLICY visit_action_evidence_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'visit-action-evidence'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND split_part(name, '/', 3) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.visit_action_items AS ai
      JOIN public.profiles AS p ON p.id = auth.uid() AND p.status = 'active'
      WHERE ai.id::text = split_part(name, '/', 1)
        AND ai.status IN ('مفتوحة', 'قيد المعالجة')
        AND (
          ai.assigned_to = auth.uid()
          OR (
            ai.assigned_to IS NULL
            AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
            AND p.role = 'Supervisor'
            AND p.branch_id = ai.branch_id
            AND (ai.shift_type IS NULL OR p.shift_type = 'Both' OR ai.shift_type = p.shift_type)
          )
          OR public.can_manage_branch_visit_in_scope(ai.branch_id)
          OR EXISTS (
            SELECT 1
            FROM public.supervisory_visits AS v
            WHERE v.id = ai.visit_id
              AND v.status = 'مسودة'
              AND v.assignment_id IS NOT NULL
              AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
          )
        )
    )
  );

DROP POLICY IF EXISTS visit_action_evidence_read ON storage.objects;
CREATE POLICY visit_action_evidence_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'visit-action-evidence'
    AND (
      public.can_review_branch_visit_actions()
      OR EXISTS (
        SELECT 1
        FROM public.visit_action_items AS ai
        JOIN public.profiles AS p ON p.id = auth.uid() AND p.status = 'active'
        WHERE ai.id::text = split_part(name, '/', 1)
          AND (
            ai.assigned_to = auth.uid()
            OR (
              ai.assigned_to IS NULL
              AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
              AND p.role = 'Supervisor'
              AND p.branch_id = ai.branch_id
              AND (ai.shift_type IS NULL OR p.shift_type = 'Both' OR ai.shift_type = p.shift_type)
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.visit_action_items AS ai
        JOIN public.profiles AS p ON p.id = auth.uid() AND p.status = 'active'
        WHERE ai.id::text = split_part(name, '/', 1)
          AND ai.created_by = auth.uid()
          AND split_part(name, '/', 2) = auth.uid()::text
          AND public.current_user_can_read_visit_branch(ai.branch_id)
      )
    )
  );

-- The 2026-11-23 restrictive guard narrows reviewer and assignee access to the
-- exact action path. Preserve it and add only the creator's own in-scope object.
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
      WHERE p.id = auth.uid()
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
            AND (ai.status = 'بانتظار اعتماد الإدارة' OR ai.reviewed_by = auth.uid())
          )
          OR (
            p.role <> 'Manager'
            AND (
              ai.assigned_to = auth.uid()
              OR (
                ai.assigned_to IS NULL
                AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
                AND p.role = 'Supervisor'
                AND p.branch_id = ai.branch_id
                AND (ai.shift_type IS NULL OR p.shift_type = 'Both' OR ai.shift_type = p.shift_type)
              )
            )
          )
          OR (
            p.role <> 'Manager'
            AND ai.created_by = auth.uid()
            AND split_part(storage.objects.name, '/', 2) = auth.uid()::text
            AND public.current_user_can_read_visit_branch(ai.branch_id)
          )
        )
    )
  );

-- RLS for the metadata row mirrors the storage-path uploader and scope checks.
DROP POLICY IF EXISTS visit_evidence_action_scoped_upload ON public.visit_evidence;
CREATE POLICY visit_evidence_action_scoped_upload ON public.visit_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    action_item_id IS NOT NULL
    AND uploaded_by = auth.uid()
    AND split_part(file_path, '/', 2) = auth.uid()::text
    AND split_part(file_path, '/', 3) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.visit_action_items AS ai
      JOIN public.profiles AS p ON p.id = auth.uid() AND p.status = 'active'
      WHERE ai.id = visit_evidence.action_item_id
        AND ai.visit_id = visit_evidence.visit_id
        AND ai.status IN ('مفتوحة', 'قيد المعالجة')
        AND (
          ai.assigned_to = auth.uid()
          OR (
            ai.assigned_to IS NULL
            AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
            AND p.role = 'Supervisor'
            AND p.branch_id = ai.branch_id
            AND (ai.shift_type IS NULL OR p.shift_type = 'Both' OR ai.shift_type = p.shift_type)
          )
          OR public.can_manage_branch_visit_in_scope(ai.branch_id)
          OR EXISTS (
            SELECT 1
            FROM public.supervisory_visits AS v
            WHERE v.id = ai.visit_id
              AND v.status = 'مسودة'
              AND v.assignment_id IS NOT NULL
              AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
          )
        )
    )
  );

COMMIT;
