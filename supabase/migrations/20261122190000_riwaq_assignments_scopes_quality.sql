-- Riwaq follow-up: individual checklist assignments, manager report read scopes,
-- and future Quality visit assignments. Local migration only; do not apply until
-- the independent review and owner-approved release checks are complete.
BEGIN;

-- -----------------------------------------------------------------------------
-- Individual checklist-template assignments (many templates per employee).
-- Revocations and template-version transfers remain auditable; historical logs
-- retain their original template_id.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_template_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  superseded_by_template_id uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  migrated_at timestamptz,
  CONSTRAINT checklist_template_assignments_audit_state CHECK (
    (is_active AND revoked_at IS NULL AND superseded_by_template_id IS NULL AND migrated_at IS NULL)
    OR (NOT is_active)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_template_assignments_active_unique
  ON public.checklist_template_assignments(profile_id, template_id)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS checklist_template_assignments_profile_active_idx
  ON public.checklist_template_assignments(profile_id, template_id)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS checklist_template_assignments_template_active_idx
  ON public.checklist_template_assignments(template_id, profile_id)
  WHERE is_active;

ALTER TABLE public.checklist_template_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_template_assignments_read ON public.checklist_template_assignments;
CREATE POLICY checklist_template_assignments_read
  ON public.checklist_template_assignments
  FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR public.has_admin_permission('staff'));
GRANT SELECT ON public.checklist_template_assignments TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.checklist_template_assignments FROM PUBLIC, anon, authenticated;

-- Return only active template IDs for active operational employees in one branch.
-- Supervisors are restricted to their own branch; other callers need staff access.
CREATE OR REPLACE FUNCTION public.list_branch_checklist_template_assignments(p_branch_id uuid)
RETURNS TABLE(profile_id uuid, template_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_status text;
  v_branch_id uuid;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'معرّف الفرع غير صالح';
  END IF;

  SELECT p.role, p.status, p.branch_id
    INTO v_role, v_status, v_branch_id
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid());

  IF NOT public.has_admin_permission('staff') AND (
    v_role IS DISTINCT FROM 'Supervisor'
    OR v_status IS DISTINCT FROM 'active'
    OR v_branch_id IS DISTINCT FROM p_branch_id
  ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية قراءة إسنادات هذا الفرع';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS b
    WHERE b.id = p_branch_id AND b.lifecycle_status IS DISTINCT FROM 'planned'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.profile_id, a.template_id
  FROM public.checklist_template_assignments AS a
  JOIN public.profiles AS p ON p.id = a.profile_id
  JOIN public.checklist_templates AS t ON t.id = a.template_id
  WHERE a.is_active IS TRUE
    AND p.status = 'active'
    AND p.branch_id = p_branch_id
    AND p.role IN ('Barista', 'Waiter', 'Kitchen')
    AND t.is_active IS TRUE;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_branch_checklist_template_assignments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_branch_checklist_template_assignments(uuid) TO authenticated;

-- Private transactional helper used only by the template versioning functions.
CREATE OR REPLACE FUNCTION public.transfer_checklist_template_assignments(
  p_source_template_ids uuid[],
  p_target_template_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_moved integer := 0;
BEGIN
  IF p_target_template_id IS NULL THEN
    RAISE EXCEPTION 'القالب الجديد غير صالح';
  END IF;

  INSERT INTO public.checklist_template_assignments (
    profile_id, template_id, assigned_by, created_at, updated_at, is_active
  )
  SELECT DISTINCT ON (a.profile_id)
    a.profile_id,
    p_target_template_id,
    a.assigned_by,
    a.created_at,
    pg_catalog.now(),
    true
  FROM public.checklist_template_assignments AS a
  WHERE a.is_active IS TRUE
    AND a.template_id = ANY (COALESCE(p_source_template_ids, '{}'::uuid[]))
    AND a.template_id <> p_target_template_id
  ORDER BY a.profile_id, a.created_at, a.id
  ON CONFLICT (profile_id, template_id) WHERE is_active DO NOTHING;

  UPDATE public.checklist_template_assignments AS a
     SET is_active = false,
         superseded_by_template_id = p_target_template_id,
         migrated_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   WHERE a.is_active IS TRUE
     AND a.template_id = ANY (COALESCE(p_source_template_ids, '{}'::uuid[]))
     AND a.template_id <> p_target_template_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$function$;
REVOKE ALL ON FUNCTION public.transfer_checklist_template_assignments(uuid[], uuid)
  FROM PUBLIC, anon, authenticated;

-- Replace the existing version routine with the same payload contract plus an
-- atomic transfer before the source version is archived.
CREATE OR REPLACE FUNCTION public.version_checklist_template(
  p_template_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old public.checklist_templates%ROWTYPE;
  v_new_id uuid;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  IF NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;

  SELECT t.* INTO v_old
  FROM public.checklist_templates AS t
  WHERE t.id = p_template_id AND t.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'القالب غير موجود أو مؤرشف بالفعل';
  END IF;

  INSERT INTO public.checklist_templates (
    task_title, category, shift_type, instructions, branch_id, requires_photo,
    target_time, frequency, day_of_week, days_of_week, day_of_month, allows_notes, task_type,
    sort_order, is_active
  ) VALUES (
    COALESCE(NULLIF(v_payload ->> 'task_title', ''), v_old.task_title),
    COALESCE(NULLIF(v_payload ->> 'category', ''), v_old.category),
    COALESCE(NULLIF(v_payload ->> 'shift_type', ''), v_old.shift_type),
    CASE WHEN v_payload ? 'instructions' THEN NULLIF(v_payload ->> 'instructions', '') ELSE v_old.instructions END,
    CASE WHEN v_payload ? 'branch_id' THEN NULLIF(v_payload ->> 'branch_id', '')::uuid ELSE v_old.branch_id END,
    COALESCE((v_payload ->> 'requires_photo')::boolean, v_old.requires_photo),
    CASE WHEN v_payload ? 'target_time' THEN NULLIF(v_payload ->> 'target_time', '')::time ELSE v_old.target_time END,
    COALESCE(NULLIF(v_payload ->> 'frequency', ''), v_old.frequency),
    CASE WHEN v_payload ? 'day_of_week' THEN NULLIF(v_payload ->> 'day_of_week', '')::integer ELSE v_old.day_of_week END,
    CASE
      WHEN v_payload ? 'days_of_week' AND pg_catalog.jsonb_typeof(v_payload -> 'days_of_week') = 'array'
        THEN ARRAY(SELECT day_value::integer FROM pg_catalog.jsonb_array_elements_text(v_payload -> 'days_of_week') AS item(day_value))
      WHEN v_payload ? 'day_of_week'
        THEN CASE
          WHEN NULLIF(v_payload ->> 'day_of_week', '')::integer BETWEEN 0 AND 6
            THEN ARRAY[NULLIF(v_payload ->> 'day_of_week', '')::integer]
          ELSE '{}'::integer[]
        END
      ELSE v_old.days_of_week
    END,
    CASE WHEN v_payload ? 'day_of_month' THEN NULLIF(v_payload ->> 'day_of_month', '')::integer ELSE v_old.day_of_month END,
    COALESCE((v_payload ->> 'allows_notes')::boolean, v_old.allows_notes),
    COALESCE(NULLIF(v_payload ->> 'task_type', ''), v_old.task_type),
    COALESCE(NULLIF(v_payload ->> 'sort_order', '')::integer, v_old.sort_order),
    true
  ) RETURNING id INTO v_new_id;

  UPDATE public.checklist_templates SET is_active = false WHERE id = v_old.id;
  PERFORM public.transfer_checklist_template_assignments(ARRAY[v_old.id]::uuid[], v_new_id);
  RETURN v_new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.version_checklist_template(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.version_checklist_template(uuid, jsonb) TO authenticated;

-- Replace group-version routine so assignments from every source UUID are
-- coalesced to the new UUID in the same transaction; source logs are untouched.
CREATE OR REPLACE FUNCTION public.save_checklist_template_group_with_branches(
  p_template_ids uuid[],
  p_payload jsonb,
  p_branch_ids uuid[],
  p_is_global boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[] := p_template_ids;
  v_primary_id uuid;
  v_new_id uuid;
  v_count integer;
  v_signature_count integer;
  v_archived_count integer;
BEGIN
  IF NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;
  IF v_ids IS NULL OR pg_catalog.cardinality(v_ids) < 2 THEN
    RAISE EXCEPTION 'يتطلب دمج المجموعة قالبين نشطين على الأقل';
  END IF;
  IF pg_catalog.array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'معرّف قالب غير صالح ضمن المجموعة';
  END IF;
  IF p_is_global IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد ما إذا كان القالب عاماً أو محدداً للفروع';
  END IF;
  IF pg_catalog.cardinality(v_ids) <> (
    SELECT pg_catalog.count(DISTINCT item_id)::integer
    FROM pg_catalog.unnest(v_ids) AS supplied(item_id)
  ) THEN
    RAISE EXCEPTION 'تتضمن المجموعة معرّفات قوالب مكررة';
  END IF;

  PERFORM 1 FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids) ORDER BY t.id FOR UPDATE;

  SELECT pg_catalog.count(*)::integer INTO v_count
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids) AND t.is_active IS TRUE;
  IF v_count <> pg_catalog.cardinality(v_ids) THEN
    RAISE EXCEPTION 'تغيّرت المجموعة؛ حدّث الصفحة قبل الحفظ';
  END IF;

  SELECT pg_catalog.count(DISTINCT pg_catalog.jsonb_build_array(
    (t.branch_id IS NULL), t.task_title, t.category, t.shift_type, t.instructions,
    COALESCE(t.requires_photo, false), pg_catalog.left(t.target_time::text, 5),
    COALESCE(t.frequency, 'daily'), t.day_of_week,
    ARRAY(SELECT DISTINCT day_value FROM pg_catalog.unnest(COALESCE(t.days_of_week, '{}'::integer[])) AS days(day_value) ORDER BY day_value),
    t.day_of_month, COALESCE(t.allows_notes, true), COALESCE(t.task_type, 'standard'), COALESCE(t.sort_order, 0)
  ))::integer INTO v_signature_count
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids) AND t.is_active IS TRUE;
  IF v_signature_count <> 1 THEN
    RAISE EXCEPTION 'لا يمكن دمج قوالب تختلف إعداداتها';
  END IF;

  v_primary_id := v_ids[1];
  v_new_id := public.save_checklist_template_with_branches(
    v_primary_id, p_payload, p_branch_ids, p_is_global
  );
  PERFORM public.transfer_checklist_template_assignments(v_ids, v_new_id);

  UPDATE public.checklist_templates AS t
     SET is_active = false
   WHERE t.id = ANY (v_ids[2:pg_catalog.cardinality(v_ids)])
     AND t.is_active IS TRUE;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;
  IF v_archived_count <> pg_catalog.cardinality(v_ids) - 1 THEN
    RAISE EXCEPTION 'تعذرت أرشفة جميع النسخ السابقة؛ أُلغي الحفظ بالكامل';
  END IF;
  RETURN v_new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_checklist_template_group_with_branches(uuid[], jsonb, uuid[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_checklist_template_group_with_branches(uuid[], jsonb, uuid[], boolean)
  TO authenticated;

-- Atomic replace operation: callers can assign several eligible templates to
-- one active operational employee, or revoke them without deleting history.
CREATE OR REPLACE FUNCTION public.replace_checklist_template_assignments(
  p_profile_id uuid,
  p_template_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile record;
  v_count integer;
  v_assigned integer;
  v_ids uuid[] := p_template_ids;
BEGIN
  IF NOT public.has_admin_permission('staff') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إسناد مهام للموظفين';
  END IF;
  IF p_profile_id IS NULL OR v_ids IS NULL OR pg_catalog.array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'بيانات إسناد المهام غير صالحة';
  END IF;
  IF pg_catalog.cardinality(v_ids) > 100 OR pg_catalog.cardinality(v_ids) <> (
    SELECT pg_catalog.count(DISTINCT item_id)::integer
    FROM pg_catalog.unnest(v_ids) AS supplied(item_id)
  ) THEN
    RAISE EXCEPTION 'توجد معرّفات مكررة أو يتجاوز عدد المهام الحد المسموح';
  END IF;

  SELECT p.id, p.role, p.status, p.branch_id, p.shift_type,
         b.name AS branch_name, b.lifecycle_status
    INTO v_profile
  FROM public.profiles AS p
  LEFT JOIN public.branches AS b ON b.id = p.branch_id
  WHERE p.id = p_profile_id
  FOR UPDATE OF p;
  IF v_profile.id IS NULL OR v_profile.status IS DISTINCT FROM 'active'
     OR v_profile.role IS NULL OR v_profile.role NOT IN ('Barista', 'Kitchen', 'Waiter', 'Supervisor')
     OR v_profile.branch_id IS NULL OR v_profile.lifecycle_status = 'planned'
     OR v_profile.shift_type IS NULL OR v_profile.shift_type NOT IN ('Morning', 'Evening', 'Both') THEN
    RAISE EXCEPTION 'لا يمكن إسناد مهام لهذا الحساب أو فرعه غير مؤهل';
  END IF;

  PERFORM 1 FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids) ORDER BY t.id FOR UPDATE;
  SELECT pg_catalog.count(*)::integer INTO v_count
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids) AND t.is_active IS TRUE
    AND COALESCE(t.task_type, 'standard') NOT IN ('inventory_request', 'inventory_count')
    AND COALESCE(t.frequency, 'daily') <> 'hourly'
    AND (v_profile.shift_type = 'Both' OR t.shift_type = 'Both' OR t.shift_type = v_profile.shift_type)
    AND NOT (v_profile.branch_name = 'زام المنح' AND v_profile.role = 'Waiter'
             AND v_profile.shift_type = 'Morning')
    AND NOT (v_profile.branch_name = 'زام الحي' AND t.task_type = 'restroom_check')
    AND NOT (v_profile.branch_id = '41f2dea8-238a-4550-abc8-b1a8a505f3d2'::uuid
             AND t.category = 'الصالة')
    AND (
      EXISTS (
        SELECT 1 FROM public.checklist_template_branches AS s
        WHERE s.template_id = t.id AND s.branch_id = v_profile.branch_id
      )
      OR (
        NOT EXISTS (SELECT 1 FROM public.checklist_template_branches AS s WHERE s.template_id = t.id)
        AND (t.branch_id IS NULL OR t.branch_id = v_profile.branch_id)
      )
    );
  IF v_count <> pg_catalog.cardinality(v_ids) THEN
    RAISE EXCEPTION 'بعض المهام غير نشطة أو لا توافق الفرع أو الوردية أو قيود التنفيذ';
  END IF;

  UPDATE public.checklist_template_assignments AS a
     SET is_active = false,
         revoked_at = pg_catalog.now(),
         revoked_by = auth.uid(),
         updated_at = pg_catalog.now()
   WHERE a.profile_id = p_profile_id
     AND a.is_active IS TRUE
     AND NOT (a.template_id = ANY (v_ids));

  INSERT INTO public.checklist_template_assignments(profile_id, template_id, assigned_by)
  SELECT p_profile_id, supplied.template_id, auth.uid()
  FROM pg_catalog.unnest(v_ids) AS supplied(template_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.checklist_template_assignments AS a
    WHERE a.profile_id = p_profile_id
      AND a.template_id = supplied.template_id
      AND a.is_active IS TRUE
  )
  ON CONFLICT (profile_id, template_id) WHERE is_active DO NOTHING;

  SELECT pg_catalog.count(*)::integer INTO v_assigned
  FROM public.checklist_template_assignments AS a
  WHERE a.profile_id = p_profile_id AND a.is_active IS TRUE;
  RETURN v_assigned;
END;
$function$;
REVOKE ALL ON FUNCTION public.replace_checklist_template_assignments(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_checklist_template_assignments(uuid, uuid[]) TO authenticated;

-- Category assignment is the default eligibility rule; an individual template
-- assignment overrides only category. Branch, shift, active status, protected
-- task types, and branch-specific exceptions continue to apply.
CREATE OR REPLACE FUNCTION public.can_employee_execute_checklist_template(
  p_template_id uuid,
  p_branch_id uuid,
  p_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.checklist_templates AS t
    JOIN public.profiles AS p ON p.id = (SELECT auth.uid()) AND p.status = 'active'
    JOIN public.branches AS b ON b.id = p_branch_id
    WHERE t.id = p_template_id
      AND t.is_active IS TRUE
      AND p.branch_id = p_branch_id
      AND b.lifecycle_status IS DISTINCT FROM 'planned'
      AND p_shift_type IN ('Morning', 'Evening')
      AND (p.shift_type = 'Both' OR p.shift_type = p_shift_type)
      AND (t.shift_type = 'Both' OR t.shift_type = p_shift_type)
      AND NOT (p.role = 'Waiter' AND b.name = 'زام المنح' AND p_shift_type = 'Morning')
      AND NOT (b.name = 'زام الحي' AND t.task_type = 'restroom_check')
      AND NOT (b.id = '41f2dea8-238a-4550-abc8-b1a8a505f3d2'::uuid AND t.category = 'الصالة')
      AND (
        (
          COALESCE(t.task_type, 'standard') = 'inventory_count'
          AND p.role = 'Supervisor'
        )
        OR (
          COALESCE(t.task_type, 'standard') = 'inventory_request'
          AND p.role IN ('Owner', 'Admin', 'Supervisor')
        )
        OR (
          COALESCE(t.task_type, 'standard') NOT IN ('inventory_request', 'inventory_count')
          AND COALESCE(t.frequency, 'daily') <> 'hourly'
          AND (
            EXISTS (
              SELECT 1 FROM public.checklist_template_assignments AS a
              WHERE p.role IN ('Barista', 'Kitchen', 'Waiter', 'Supervisor')
                AND p.shift_type IN ('Morning', 'Evening', 'Both')
                AND a.profile_id = p.id AND a.template_id = t.id AND a.is_active IS TRUE
            )
            OR EXISTS (
              SELECT 1 FROM public.employee_task_categories AS c
              WHERE c.profile_id = p.id AND c.category = t.category
            )
            OR (
              NOT EXISTS (SELECT 1 FROM public.employee_task_categories AS c WHERE c.profile_id = p.id)
              AND CASE p.role
                WHEN 'Barista' THEN t.category = 'البار'
                WHEN 'Waiter' THEN t.category = 'الصالة'
                WHEN 'Kitchen' THEN t.category = 'المطبخ'
                ELSE false
              END
            )
          )
        )
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.checklist_template_branches AS s
          WHERE s.template_id = t.id AND s.branch_id = p_branch_id
        )
        OR (
          NOT EXISTS (SELECT 1 FROM public.checklist_template_branches AS s WHERE s.template_id = t.id)
          AND (t.branch_id IS NULL OR t.branch_id = p_branch_id)
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_employee_execute_checklist_template(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_employee_execute_checklist_template(uuid, uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Users can create own logs" ON public.checklist_logs;
CREATE POLICY "Users can create own logs" ON public.checklist_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    executed_by = (SELECT auth.uid())
    AND branch_id = public.current_user_branch_id()
    AND NOT public.is_hourly_checklist_template(template_id)
    AND public.can_employee_execute_checklist_template(template_id, branch_id, shift_type)
  );

DROP POLICY IF EXISTS "Users can update own logs" ON public.checklist_logs;
CREATE POLICY "Users can update own logs" ON public.checklist_logs
  FOR UPDATE TO authenticated
  USING (
    executed_by = (SELECT auth.uid())
    AND branch_id = public.current_user_branch_id()
    AND NOT public.is_hourly_checklist_template(template_id)
    AND public.can_employee_execute_checklist_template(template_id, branch_id, shift_type)
  )
  WITH CHECK (
    executed_by = (SELECT auth.uid())
    AND branch_id = public.current_user_branch_id()
    AND NOT public.is_hourly_checklist_template(template_id)
    AND public.can_employee_execute_checklist_template(template_id, branch_id, shift_type)
  );

-- -----------------------------------------------------------------------------
-- Explicit Manager report scopes. No scope row means the existing Manager read
-- behavior remains unchanged; report writes follow the same branch scope.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manager_report_scopes (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_mode text NOT NULL CHECK (scope_mode IN ('all', 'selected', 'none')),
  configured_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.manager_report_scope_branches (
  profile_id uuid NOT NULL REFERENCES public.manager_report_scopes(profile_id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  PRIMARY KEY (profile_id, branch_id)
);
ALTER TABLE public.manager_report_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_report_scope_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_report_scopes_admin_read ON public.manager_report_scopes;
CREATE POLICY manager_report_scopes_admin_read ON public.manager_report_scopes
  FOR SELECT TO authenticated USING (public.has_admin_permission('staff'));
DROP POLICY IF EXISTS manager_report_scope_branches_admin_read ON public.manager_report_scope_branches;
CREATE POLICY manager_report_scope_branches_admin_read ON public.manager_report_scope_branches
  FOR SELECT TO authenticated USING (public.has_admin_permission('staff'));
GRANT SELECT ON public.manager_report_scopes, public.manager_report_scope_branches TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.manager_report_scopes, public.manager_report_scope_branches
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_read_manager_report_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.manager_report_scopes AS s WHERE s.profile_id = p.id
        )
        AND EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        OR EXISTS (
          SELECT 1
          FROM public.manager_report_scopes AS s
          JOIN public.admin_permissions AS ap ON ap.profile_id = s.profile_id
          WHERE s.profile_id = p.id
            AND ap.can_view_all_reports IS TRUE
            AND (
              s.scope_mode = 'all'
              OR (s.scope_mode = 'selected' AND EXISTS (
                SELECT 1 FROM public.manager_report_scope_branches AS sb
                WHERE sb.profile_id = s.profile_id AND sb.branch_id = p_branch_id
              ))
            )
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_read_manager_report_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_manager_report_branch(uuid) TO authenticated;

-- Return only Manager-authorized branch metadata; do not enumerate every branch
-- in the browser and filter the names client-side.
CREATE OR REPLACE FUNCTION public.list_manager_report_branches()
RETURNS TABLE(id uuid, name text, lifecycle_status text, planned_opening_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT b.id, b.name, b.lifecycle_status, b.planned_opening_date
  FROM public.branches AS b
  WHERE public.can_read_manager_report_branch(b.id)
  ORDER BY b.name;
$function$;
REVOKE ALL ON FUNCTION public.list_manager_report_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_manager_report_branches() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_manager_report_scope(
  p_profile_id uuid,
  p_scope_mode text,
  p_branch_ids uuid[],
  p_legacy_can_view_all boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_ids uuid[] := COALESCE(p_branch_ids, '{}'::uuid[]);
  v_branch_count integer;
BEGIN
  IF NOT public.has_admin_permission('staff') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل نطاق تقارير المدير';
  END IF;
  IF p_profile_id IS NULL OR p_scope_mode IS NULL OR p_scope_mode NOT IN ('legacy', 'all', 'selected', 'none') THEN
    RAISE EXCEPTION 'نطاق تقارير غير صالح';
  END IF;
  SELECT p.role INTO v_role
  FROM public.profiles AS p WHERE p.id = p_profile_id FOR UPDATE;
  IF v_role IS DISTINCT FROM 'Manager' THEN
    RAISE EXCEPTION 'يمكن ضبط هذا النطاق لحساب مدير فقط';
  END IF;
  IF pg_catalog.array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'قائمة الفروع غير صالحة';
  END IF;
  IF p_scope_mode = 'selected' THEN
    IF pg_catalog.cardinality(v_ids) = 0 OR pg_catalog.cardinality(v_ids) <> (
      SELECT pg_catalog.count(DISTINCT item_id)::integer
      FROM pg_catalog.unnest(v_ids) AS supplied(item_id)
    ) THEN
      RAISE EXCEPTION 'اختر فرعاً واحداً على الأقل دون تكرار';
    END IF;
    SELECT pg_catalog.count(*)::integer INTO v_branch_count
    FROM public.branches AS b WHERE b.id = ANY (v_ids);
    IF v_branch_count <> pg_catalog.cardinality(v_ids) THEN
      RAISE EXCEPTION 'تتضمن القائمة فرعاً غير موجود';
    END IF;
  ELSIF pg_catalog.cardinality(v_ids) <> 0 THEN
    RAISE EXCEPTION 'أرسل الفروع فقط عند اختيار نطاق فروع محددة';
  END IF;

  IF p_scope_mode = 'legacy' THEN
    DELETE FROM public.manager_report_scopes WHERE profile_id = p_profile_id;
    INSERT INTO public.admin_permissions(profile_id, can_view_all_reports)
    VALUES (p_profile_id, COALESCE(p_legacy_can_view_all, false))
    ON CONFLICT (profile_id) DO UPDATE
      SET can_view_all_reports = EXCLUDED.can_view_all_reports;
    RETURN;
  END IF;

  INSERT INTO public.manager_report_scopes(profile_id, scope_mode, configured_by)
  VALUES (p_profile_id, p_scope_mode, auth.uid())
  ON CONFLICT (profile_id) DO UPDATE
    SET scope_mode = EXCLUDED.scope_mode,
        configured_by = EXCLUDED.configured_by,
        updated_at = pg_catalog.now();
  DELETE FROM public.manager_report_scope_branches WHERE profile_id = p_profile_id;
  IF p_scope_mode = 'selected' THEN
    INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
    SELECT p_profile_id, supplied.branch_id
    FROM pg_catalog.unnest(v_ids) AS supplied(branch_id);
  END IF;
  INSERT INTO public.admin_permissions(profile_id, can_view_all_reports)
  VALUES (p_profile_id, p_scope_mode IN ('all', 'selected'))
  ON CONFLICT (profile_id) DO UPDATE
    SET can_view_all_reports = EXCLUDED.can_view_all_reports;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_manager_report_scope(uuid, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manager_report_scope(uuid, text, uuid[], boolean) TO authenticated;

-- Replace the broad Manager SELECT path on daily reports and their detail rows.
-- Separate DML policies preserve the current Manager write behavior.
CREATE OR REPLACE FUNCTION public.current_supervisor_can_read_daily_report(
  p_branch_id uuid,
  p_report_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL
    AND p_report_shift_type IN ('Morning', 'Evening')
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = (SELECT auth.uid())
        AND p.status = 'active'
        AND p.role = 'Supervisor'
        AND p.branch_id = p_branch_id
        AND p.shift_type IN ('Morning', 'Evening', 'Both')
        AND (p.shift_type = 'Both' OR p.shift_type = p_report_shift_type)
    );
$function$;
REVOKE ALL ON FUNCTION public.current_supervisor_can_read_daily_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_supervisor_can_read_daily_report(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "allow all daily_reports" ON public.daily_reports;
DROP POLICY IF EXISTS "allow all waste_logs" ON public.waste_logs;
DROP POLICY IF EXISTS "allow all shift_issues" ON public.shift_issues;
DROP POLICY IF EXISTS "allow all negative_reviews" ON public.negative_reviews;
DROP POLICY IF EXISTS "Manager manages all reports" ON public.daily_reports;
CREATE POLICY "Manager reads scoped reports" ON public.daily_reports
  FOR SELECT TO authenticated
  USING (public.can_read_manager_report_branch(branch_id));
CREATE POLICY "Manager inserts reports" ON public.daily_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'Manager'
    AND public.can_read_manager_report_branch(branch_id)
  );
CREATE POLICY "Manager updates reports" ON public.daily_reports
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'Manager'
    AND public.can_read_manager_report_branch(branch_id)
  )
  WITH CHECK (
    public.current_user_role() = 'Manager'
    AND public.can_read_manager_report_branch(branch_id)
  );
CREATE POLICY "Manager deletes reports" ON public.daily_reports
  FOR DELETE TO authenticated
  USING (
    public.current_user_role() = 'Manager'
    AND public.can_read_manager_report_branch(branch_id)
  );
DROP POLICY IF EXISTS "Owner reads all reports" ON public.daily_reports;
CREATE POLICY "Owner reads all reports" ON public.daily_reports
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Owner');
CREATE POLICY "Admin reads all reports" ON public.daily_reports
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Admin');
CREATE POLICY "Supervisor reads assigned shift reports" ON public.daily_reports
  FOR SELECT TO authenticated
  USING (public.current_supervisor_can_read_daily_report(branch_id, shift_type));

DROP POLICY IF EXISTS "Admin and Manager manage waste" ON public.waste_logs;
CREATE POLICY "Manager reads scoped waste" ON public.waste_logs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.daily_reports AS r
            WHERE r.id = waste_logs.report_id
              AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager inserts waste" ON public.waste_logs
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = waste_logs.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager updates waste" ON public.waste_logs
  FOR UPDATE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = waste_logs.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  ) WITH CHECK (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = waste_logs.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager deletes waste" ON public.waste_logs
  FOR DELETE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = waste_logs.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Admin manages waste" ON public.waste_logs
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'Admin')
  WITH CHECK (public.current_user_role() = 'Admin');
DROP POLICY IF EXISTS "Owner reads all waste" ON public.waste_logs;
CREATE POLICY "Owner reads all waste" ON public.waste_logs
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Owner');
CREATE POLICY "Admin reads all waste" ON public.waste_logs
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Admin');
CREATE POLICY "Supervisor reads assigned shift waste" ON public.waste_logs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.daily_reports AS r
            WHERE r.id = waste_logs.report_id
              AND public.current_supervisor_can_read_daily_report(r.branch_id, r.shift_type))
  );

DROP POLICY IF EXISTS "Admin and Manager manage shift issues" ON public.shift_issues;
CREATE POLICY "Manager reads scoped shift issues" ON public.shift_issues
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.daily_reports AS r
            WHERE r.id = shift_issues.report_id
              AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager inserts shift issues" ON public.shift_issues
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = shift_issues.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager updates shift issues" ON public.shift_issues
  FOR UPDATE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = shift_issues.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  ) WITH CHECK (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = shift_issues.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager deletes shift issues" ON public.shift_issues
  FOR DELETE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = shift_issues.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Admin manages shift issues" ON public.shift_issues
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'Admin')
  WITH CHECK (public.current_user_role() = 'Admin');
DROP POLICY IF EXISTS "Owner reads all shift issues" ON public.shift_issues;
CREATE POLICY "Owner reads all shift issues" ON public.shift_issues
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Owner');
CREATE POLICY "Admin reads all shift issues" ON public.shift_issues
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Admin');
CREATE POLICY "Supervisor reads assigned shift issues" ON public.shift_issues
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.daily_reports AS r
            WHERE r.id = shift_issues.report_id
              AND public.current_supervisor_can_read_daily_report(r.branch_id, r.shift_type))
  );

DROP POLICY IF EXISTS "Admin and Manager manage reviews" ON public.negative_reviews;
CREATE POLICY "Manager reads scoped reviews" ON public.negative_reviews
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.daily_reports AS r
            WHERE r.id = negative_reviews.report_id
              AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager inserts reviews" ON public.negative_reviews
  FOR INSERT TO authenticated WITH CHECK (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = negative_reviews.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager updates reviews" ON public.negative_reviews
  FOR UPDATE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = negative_reviews.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  ) WITH CHECK (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = negative_reviews.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Manager deletes reviews" ON public.negative_reviews
  FOR DELETE TO authenticated USING (
    public.current_user_role() = 'Manager'
    AND EXISTS (SELECT 1 FROM public.daily_reports AS r
                WHERE r.id = negative_reviews.report_id
                  AND public.can_read_manager_report_branch(r.branch_id))
  );
CREATE POLICY "Admin manages reviews" ON public.negative_reviews
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'Admin')
  WITH CHECK (public.current_user_role() = 'Admin');
DROP POLICY IF EXISTS "Owner reads all reviews" ON public.negative_reviews;
CREATE POLICY "Owner reads all reviews" ON public.negative_reviews
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Owner');
CREATE POLICY "Admin reads all reviews" ON public.negative_reviews
  FOR SELECT TO authenticated USING (public.current_user_role() = 'Admin');
CREATE POLICY "Supervisor reads assigned shift reviews" ON public.negative_reviews
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.daily_reports AS r
            WHERE r.id = negative_reviews.report_id
              AND public.current_supervisor_can_read_daily_report(r.branch_id, r.shift_type))
  );

DROP POLICY IF EXISTS "Read technical issues" ON public.technical_issues;
CREATE POLICY "Read technical issues" ON public.technical_issues
  FOR SELECT TO authenticated USING (
    public.current_user_role() IN ('Owner', 'Admin')
    OR (public.current_user_role() = 'Manager' AND public.can_read_manager_report_branch(branch_id))
    OR (public.current_user_role() <> 'Manager' AND branch_id = public.current_user_branch_id())
  );
-- The independent manager UPDATE policy is deliberately retained.

-- -----------------------------------------------------------------------------
-- Future Quality role for cross-branch visit assignments, with a separate
-- false-by-default capability and no manager/reviewer privileges.
-- -----------------------------------------------------------------------------
ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS can_perform_branch_visits boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_manage_branch_visits()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND p.role <> 'Quality'
      AND (p.role = 'Owner' OR COALESCE(ap.can_manage_branch_visits, false))
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_review_branch_visit_actions()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND p.role <> 'Quality'
      AND (p.role = 'Owner' OR COALESCE(ap.can_review_visit_actions, false))
  );
$function$;

CREATE OR REPLACE FUNCTION public.list_branch_visit_supervisors(p_branch_id uuid)
RETURNS TABLE(user_id uuid, full_name text, role text, shift_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p.id, p.full_name, p.role, p.shift_type
  FROM public.profiles AS p
  WHERE public.can_manage_branch_visits()
    AND p.status = 'active'
    AND (
      (p.role = 'Supervisor' AND p.branch_id = p_branch_id)
      OR (p.role = 'Quality' AND EXISTS (
        SELECT 1 FROM public.admin_permissions AS ap
        WHERE ap.profile_id = p.id AND ap.can_perform_branch_visits IS TRUE
      ))
    )
  ORDER BY p.full_name;
$function$;

DROP POLICY IF EXISTS branch_visit_assignments_read ON public.branch_visit_assignments;
CREATE POLICY branch_visit_assignments_read ON public.branch_visit_assignments
  FOR SELECT TO authenticated
  USING (
    public.can_manage_branch_visits()
    OR (
      assigned_to = (SELECT auth.uid())
      AND status = 'assigned'
      AND EXISTS (
        SELECT 1
        FROM public.profiles AS p
        LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
        WHERE p.id = (SELECT auth.uid())
          AND p.status = 'active'
          AND (p.shift_type = 'Both' OR p.shift_type = branch_visit_assignments.shift_type)
          AND (
            (p.role = 'Supervisor' AND p.branch_id = branch_visit_assignments.branch_id)
            OR (p.role = 'Quality' AND ap.can_perform_branch_visits IS TRUE)
          )
      )
    )
  );

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
        AND (target_profile.shift_type = 'Both' OR target_profile.shift_type = branch_visit_assignments.shift_type)
        AND (
          (target_profile.role = 'Supervisor' AND target_profile.branch_id = branch_visit_assignments.branch_id)
          OR (target_profile.role = 'Quality' AND EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            WHERE ap.profile_id = target_profile.id AND ap.can_perform_branch_visits IS TRUE
          ))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.can_submit_assigned_branch_visit(
  p_assignment_id uuid,
  p_branch_id uuid,
  p_visit_date date,
  p_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.can_manage_branch_visits() OR EXISTS (
    SELECT 1
    FROM public.branch_visit_assignments AS a
    JOIN public.profiles AS p ON p.id = auth.uid()
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE a.id = p_assignment_id
      AND a.assigned_to = p.id
      AND p.status = 'active'
      AND a.branch_id = p_branch_id
      AND a.visit_date = p_visit_date
      AND a.shift_type = p_shift_type
      AND a.status = 'assigned'
      AND (p.shift_type = 'Both' OR p.shift_type = a.shift_type)
      AND (
        (p.role = 'Supervisor' AND p.branch_id = a.branch_id)
        OR (p.role = 'Quality' AND ap.can_perform_branch_visits IS TRUE)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_quality_visit_assignment_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_status text;
  v_branch_id uuid;
  v_shift_type text;
  v_enabled boolean;
BEGIN
  IF OLD.status = 'assigned' AND NEW.status = 'completed' THEN
    IF public.can_manage_branch_visits() THEN
      RETURN NEW;
    END IF;
    IF NEW.assigned_to IS DISTINCT FROM (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'إكمال الزيارة يتطلب تكليفاً سارياً للحساب الحالي';
    END IF;
    SELECT p.role, p.status, p.branch_id, p.shift_type,
           COALESCE(ap.can_perform_branch_visits, false)
      INTO v_role, v_status, v_branch_id, v_shift_type, v_enabled
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = NEW.assigned_to;
    IF v_status IS DISTINCT FROM 'active'
       OR (v_shift_type IS DISTINCT FROM 'Both' AND v_shift_type IS DISTINCT FROM NEW.shift_type) THEN
      RAISE EXCEPTION 'الحساب أو الوردية لا يطابقان تكليف الزيارة الحالي';
    END IF;
    IF v_role = 'Supervisor' AND v_branch_id = NEW.branch_id THEN
      RETURN NEW;
    END IF;
    IF v_role = 'Quality' AND v_enabled THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'الدور أو الفرع لا يطابقان تكليف الزيارة الحالي';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_quality_visit_assignment_completion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_quality_visit_assignment_completion ON public.branch_visit_assignments;
CREATE TRIGGER guard_quality_visit_assignment_completion
  BEFORE UPDATE OF status ON public.branch_visit_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_quality_visit_assignment_completion();

NOTIFY pgrst, 'reload schema';
COMMIT;
