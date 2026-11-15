-- Add an auditable, two-step corrective-action workflow without rewriting historical records.
-- Assignment permission and evidence-review permission are intentionally separate.

ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS can_review_visit_actions boolean NOT NULL DEFAULT false;

ALTER TABLE public.visit_action_items
  ADD COLUMN IF NOT EXISTS completion_note text,
  ADD COLUMN IF NOT EXISTS completion_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.visit_evidence
  ADD COLUMN IF NOT EXISTS action_item_id uuid REFERENCES public.visit_action_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS visit_evidence_action_item_created_idx
  ON public.visit_evidence(action_item_id, created_at);

ALTER TABLE public.visit_action_items
  DROP CONSTRAINT IF EXISTS visit_action_items_status_check;
ALTER TABLE public.visit_action_items
  ADD CONSTRAINT visit_action_items_status_check
  CHECK (status = ANY (ARRAY['مفتوحة','قيد المعالجة','بانتظار اعتماد','بانتظار اعتماد الإدارة','مغلقة','ملغاة']::text[]));

CREATE OR REPLACE FUNCTION public.can_review_branch_visit_actions()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND (p.role = 'Owner' OR COALESCE(ap.can_review_visit_actions, false))
  );
$$;

-- A reviewer may see reports that contain a pending review, but this does not
-- grant general access to every branch report.
CREATE OR REPLACE FUNCTION public.can_access_branch_visit(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_view_branch_visit_reports()
    OR (
      public.can_review_branch_visit_actions()
      AND EXISTS (
        SELECT 1 FROM public.visit_action_items AS ai
        WHERE ai.visit_id = p_visit_id
          AND (ai.status = 'بانتظار اعتماد الإدارة' OR ai.reviewed_by = auth.uid())
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.supervisory_visits AS v
      WHERE v.id = p_visit_id
        AND EXISTS (
          SELECT 1 FROM public.profiles AS actor
          WHERE actor.id = auth.uid() AND actor.status = 'active'
        )
        AND (
          v.signed_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.branch_visit_assignments AS a
            WHERE a.id = v.assignment_id
              AND a.assigned_to = auth.uid()
              AND a.status <> 'cancelled'
          )
          OR EXISTS (
            SELECT 1 FROM public.visit_action_items AS ai
            WHERE ai.visit_id = v.id AND ai.assigned_to = auth.uid()
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles AS p
            JOIN public.visit_action_items AS ai
              ON ai.branch_id = p.branch_id AND ai.visit_id = v.id
            WHERE p.id = auth.uid()
              AND p.role = 'Supervisor'
              AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
              AND (ai.shift_type IS NULL OR p.shift_type = 'Both' OR ai.shift_type = p.shift_type)
          )
        )
    );
$$;

-- Supervisory visit assignments in this flow are for an active Supervisor of
-- the selected branch, not an arbitrary employee. Keep the separate assignee
-- list unchanged so corrective tasks may still be routed to any active employee.
CREATE OR REPLACE FUNCTION public.list_branch_visit_supervisors(p_branch_id uuid)
RETURNS TABLE(user_id uuid, full_name text, role text, shift_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.full_name, p.role, p.shift_type
  FROM public.profiles AS p
  WHERE public.can_manage_branch_visits()
    AND p.branch_id = p_branch_id
    AND p.status = 'active'
    AND p.role = 'Supervisor'
  ORDER BY p.full_name;
$$;

DROP POLICY IF EXISTS branch_visit_assignments_insert ON public.branch_visit_assignments;
CREATE POLICY branch_visit_assignments_insert ON public.branch_visit_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_branch_visits()
    AND assigned_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS target_profile
      WHERE target_profile.id = assigned_to
        AND target_profile.status = 'active'
        AND target_profile.branch_id = branch_visit_assignments.branch_id
        AND target_profile.role = 'Supervisor'
        AND (target_profile.shift_type = 'Both' OR target_profile.shift_type = branch_visit_assignments.shift_type)
    )
  );

-- Private, dedicated storage for corrective-action evidence. Existing public
-- task-evidence objects and historical evidence are not moved or altered.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'visit-action-evidence',
  'visit-action-evidence',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS visit_action_evidence_upload ON storage.objects;
CREATE POLICY visit_action_evidence_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'visit-action-evidence'
    AND split_part(name, '/', 2) = auth.uid()::text
    AND EXISTS (
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
        AND ai.status IN ('مفتوحة', 'قيد المعالجة')
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
    )
  );

-- Evidence rows for a follow-up must point to the assigned action and to a
-- private bucket path. Preserve the existing draft-visit evidence path.
DROP POLICY IF EXISTS visit_evidence_write ON public.visit_evidence;
CREATE POLICY visit_evidence_insert ON public.visit_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    (action_item_id IS NULL AND public.can_manage_branch_visits())
    OR (
      action_item_id IS NULL
      AND uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visits AS v
        WHERE v.id = visit_evidence.visit_id
          AND v.status = 'مسودة'
          AND v.assignment_id IS NOT NULL
          AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
      )
    )
    OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.visit_action_items AS ai
        JOIN public.profiles AS p ON p.id = auth.uid() AND p.status = 'active'
        WHERE ai.id = visit_evidence.action_item_id
          AND ai.visit_id = visit_evidence.visit_id
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
          AND ai.status IN ('مفتوحة', 'قيد المعالجة')
          AND visit_evidence.file_path LIKE ai.id::text || '/%'
      )
    )
  );

-- Draft visit evidence may still be retried or removed before the visit is signed.
-- Corrective-action proof is append-only once uploaded; there are no UPDATE/DELETE
-- policies for rows with action_item_id set.
CREATE POLICY visit_evidence_update_draft ON public.visit_evidence
  FOR UPDATE TO authenticated
  USING (
    action_item_id IS NULL
    AND (public.can_manage_branch_visits() OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visits AS v
        WHERE v.id = visit_evidence.visit_id
          AND v.status = 'مسودة'
          AND v.assignment_id IS NOT NULL
          AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
      )
    ))
  )
  WITH CHECK (
    action_item_id IS NULL
    AND (public.can_manage_branch_visits() OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visits AS v
        WHERE v.id = visit_evidence.visit_id
          AND v.status = 'مسودة'
          AND v.assignment_id IS NOT NULL
          AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
      )
    ))
  );

CREATE POLICY visit_evidence_delete_draft ON public.visit_evidence
  FOR DELETE TO authenticated
  USING (
    action_item_id IS NULL
    AND (public.can_manage_branch_visits() OR (
      uploaded_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visits AS v
        WHERE v.id = visit_evidence.visit_id
          AND v.status = 'مسودة'
          AND v.assignment_id IS NOT NULL
          AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
      )
    ))
  );

-- Direct edits by task assignees are intentionally removed. Only the guarded
-- RPCs below can submit or review a corrective-action completion.
DROP POLICY IF EXISTS visit_actions_write ON public.visit_action_items;
CREATE POLICY visit_actions_write ON public.visit_action_items
  FOR ALL TO authenticated
  USING (
    public.can_manage_branch_visits()
    OR (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visits AS v
        WHERE v.id = visit_action_items.visit_id
          AND v.status = 'مسودة'
          AND v.assignment_id IS NOT NULL
          AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
      )
    )
  )
  WITH CHECK (
    public.can_manage_branch_visits()
    OR (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visits AS v
        WHERE v.id = visit_action_items.visit_id
          AND v.status = 'مسودة'
          AND v.assignment_id IS NOT NULL
          AND v.branch_id = visit_action_items.branch_id
          AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
      )
    )
  );

DROP POLICY IF EXISTS visit_actions_read ON public.visit_action_items;
CREATE POLICY visit_actions_read ON public.visit_action_items
  FOR SELECT TO authenticated
  USING (
    public.can_view_branch_visit_reports()
    OR (assigned_to = auth.uid() AND EXISTS (
      SELECT 1 FROM public.profiles AS actor WHERE actor.id = auth.uid() AND actor.status = 'active'
    ))
    OR public.can_access_branch_visit(visit_id)
    OR (
      public.can_review_branch_visit_actions()
      AND (status = 'بانتظار اعتماد الإدارة' OR reviewed_by = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role = 'Supervisor'
        AND p.branch_id = visit_action_items.branch_id
        AND visit_action_items.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
        AND (visit_action_items.shift_type IS NULL OR p.shift_type = 'Both' OR visit_action_items.shift_type = p.shift_type)
    )
  );

-- Status transitions must pass through the audited RPCs below, even for users
-- who have permission to manage visit assignments or edit draft reports.
CREATE OR REPLACE FUNCTION public.guard_visit_action_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed_transition text := COALESCE(current_setting('app.visit_action_transition', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'مفتوحة'
       OR NEW.completion_note IS NOT NULL
       OR NEW.completion_submitted_at IS NOT NULL
       OR NEW.completion_submitted_by IS NOT NULL
       OR NEW.review_note IS NOT NULL
       OR NEW.reviewed_at IS NOT NULL
       OR NEW.reviewed_by IS NOT NULL
       OR NEW.closed_at IS NOT NULL
       OR NEW.closed_by IS NOT NULL THEN
      RAISE EXCEPTION 'الإجراء الجديد يجب أن يبدأ مفتوحاً ومن دون إفادة أو اعتماد';
    END IF;
    RETURN NEW;
  END IF;

  IF allowed_transition NOT IN ('submit', 'review') AND (
       OLD.status IS DISTINCT FROM NEW.status
       OR OLD.completion_note IS DISTINCT FROM NEW.completion_note
       OR OLD.completion_submitted_at IS DISTINCT FROM NEW.completion_submitted_at
       OR OLD.completion_submitted_by IS DISTINCT FROM NEW.completion_submitted_by
       OR OLD.review_note IS DISTINCT FROM NEW.review_note
       OR OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at
       OR OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by
       OR OLD.closed_at IS DISTINCT FROM NEW.closed_at
       OR OLD.closed_by IS DISTINCT FROM NEW.closed_by
     ) THEN
    RAISE EXCEPTION 'تغيير حالة الإجراء أو سجل مراجعته يجب أن يمر عبر سير الإفادة والمراجعة';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_visit_action_status_transition ON public.visit_action_items;
CREATE TRIGGER guard_visit_action_status_transition
  BEFORE INSERT OR UPDATE ON public.visit_action_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_visit_action_status_transition();

CREATE TABLE IF NOT EXISTS public.visit_action_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id uuid NOT NULL REFERENCES public.visit_action_items(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('completion_submitted','review_approved','review_returned')),
  note text,
  evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.visit_action_review_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visit_action_review_events_read ON public.visit_action_review_events;
CREATE POLICY visit_action_review_events_read ON public.visit_action_review_events
  FOR SELECT TO authenticated
  USING (
    public.can_review_branch_visit_actions()
    OR EXISTS (
      SELECT 1 FROM public.visit_action_items AS ai
      WHERE ai.id = visit_action_review_events.action_item_id
        AND ai.assigned_to = auth.uid()
    )
  );
GRANT SELECT ON public.visit_action_review_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.visit_action_review_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_visit_action_for_review(
  p_action_id uuid,
  p_completion_note text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  action_row public.visit_action_items%ROWTYPE;
  proof_ids uuid[];
  note_text text := btrim(COALESCE(p_completion_note, ''));
BEGIN
  SELECT * INTO action_row
  FROM public.visit_action_items
  WHERE id = p_action_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التكليف غير موجود'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND (
        action_row.assigned_to = p.id
        OR (
          action_row.assigned_to IS NULL
          AND action_row.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
          AND p.role = 'Supervisor'
          AND p.branch_id = action_row.branch_id
          AND (action_row.shift_type IS NULL OR p.shift_type = 'Both' OR action_row.shift_type = p.shift_type)
        )
      )
  ) THEN
    RAISE EXCEPTION 'إرسال إفادة التنفيذ متاح للمكلف أو لمشرف الفرع والشفت المحدد فقط';
  END IF;

  IF action_row.status = 'بانتظار اعتماد الإدارة'
     AND action_row.completion_submitted_by = auth.uid() THEN
    RETURN true;
  END IF;
  IF action_row.status NOT IN ('مفتوحة', 'قيد المعالجة') THEN
    RAISE EXCEPTION 'حالة التكليف الحالية لا تسمح بإرسال إفادة جديدة';
  END IF;
  IF length(note_text) < 2 OR length(note_text) > 4000 THEN
    RAISE EXCEPTION 'اكتب إفادة تنفيذ من حرفين إلى 4000 حرف';
  END IF;

  SELECT array_agg(e.id ORDER BY e.created_at)
    INTO proof_ids
  FROM public.visit_evidence AS e
  WHERE e.action_item_id = p_action_id
    AND e.uploaded_by = auth.uid()
    AND e.file_path LIKE p_action_id::text || '/%';
  IF COALESCE(array_length(proof_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'أرفق صورة أو ملف إثبات قبل إرسال الإفادة';
  END IF;

  PERFORM set_config('app.visit_action_transition', 'submit', true);
  UPDATE public.visit_action_items
     SET status = 'بانتظار اعتماد الإدارة',
         completion_note = note_text,
         completion_submitted_at = now(),
         completion_submitted_by = auth.uid(),
         review_note = NULL,
         reviewed_at = NULL,
         reviewed_by = NULL,
         closed_at = NULL,
         closed_by = NULL,
         updated_at = now()
   WHERE id = p_action_id;

  INSERT INTO public.visit_action_review_events(action_item_id, actor_id, event_type, note, evidence_ids)
  VALUES (p_action_id, auth.uid(), 'completion_submitted', note_text, proof_ids);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_branch_visit_action(
  p_action_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  action_row public.visit_action_items%ROWTYPE;
  evidence_ids uuid[];
  decision_note text := btrim(COALESCE(p_note, ''));
  review_time timestamptz := now();
BEGIN
  IF NOT public.can_review_branch_visit_actions() THEN
    RAISE EXCEPTION 'لا تملك صلاحية مراجعة إثباتات الزيارات';
  END IF;
  SELECT * INTO action_row
  FROM public.visit_action_items
  WHERE id = p_action_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التكليف غير موجود'; END IF;
  IF action_row.status <> 'بانتظار اعتماد الإدارة' THEN
    RAISE EXCEPTION 'لا يمكن مراجعة هذا التكليف قبل إرسال إفادة التنفيذ';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve','return') THEN
    RAISE EXCEPTION 'قرار المراجعة غير صالح';
  END IF;
  IF length(decision_note) > 2000 THEN
    RAISE EXCEPTION 'ملاحظة المراجعة لا تتجاوز 2000 حرف';
  END IF;
  IF p_decision = 'return' AND length(decision_note) < 2 THEN
    RAISE EXCEPTION 'اكتب سبب إعادة الإجراء للمكلف';
  END IF;

  SELECT array_agg(e.id ORDER BY e.created_at)
    INTO evidence_ids
  FROM public.visit_evidence AS e
  WHERE e.action_item_id = p_action_id
    AND e.file_path LIKE p_action_id::text || '/%';
  IF COALESCE(array_length(evidence_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'لا يوجد إثبات مرتبط بهذا التكليف';
  END IF;

  IF action_row.completion_submitted_by = auth.uid() THEN
    RAISE EXCEPTION 'لا يجوز اعتماد أو إعادة إفادة أرسلتها بنفسك';
  END IF;

  PERFORM set_config('app.visit_action_transition', 'review', true);
  UPDATE public.visit_action_items
     SET status = CASE WHEN p_decision = 'approve' THEN 'مغلقة' ELSE 'قيد المعالجة' END,
         closed_at = CASE WHEN p_decision = 'approve' THEN review_time ELSE NULL END,
         closed_by = CASE WHEN p_decision = 'approve' THEN auth.uid() ELSE NULL END,
         review_note = NULLIF(decision_note, ''),
         reviewed_at = review_time,
         reviewed_by = auth.uid(),
         updated_at = review_time
   WHERE id = p_action_id;

  INSERT INTO public.visit_action_review_events(action_item_id, actor_id, event_type, note, evidence_ids)
  VALUES (
    p_action_id,
    auth.uid(),
    CASE WHEN p_decision = 'approve' THEN 'review_approved' ELSE 'review_returned' END,
    NULLIF(decision_note, ''),
    evidence_ids
  );
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_review_branch_visit_actions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_branch_visit_supervisors(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_visit_action_for_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_branch_visit_action(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.can_review_branch_visit_actions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_branch_visit_supervisors(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_visit_action_for_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_branch_visit_action(uuid, text, text) FROM PUBLIC, anon;
