-- Reviewed release migration: apply after the manager branch-scope migration.
BEGIN;

-- Scope checks are deliberately independent of read permissions. Existing
-- permissive policies and RPC permission checks still decide whether an actor
-- can write; these helpers only constrain Manager-role writes to saved branches.
-- The permissions page already exposes this dormant capability; default false
-- keeps existing access unchanged while making the current UI schema-compatible.
ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS can_perform_branch_visits boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.admin_permissions.can_perform_branch_visits IS
  'Allows an explicitly authorized Quality user to perform assigned branch visits; disabled by default.';

CREATE OR REPLACE FUNCTION public.current_user_manager_branch_in_scope(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.manager_report_branch_in_scope((SELECT auth.uid()), p_branch_id, false);
$function$;
REVOKE ALL ON FUNCTION public.current_user_manager_branch_in_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_manager_branch_in_scope(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_manager_can_manage_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND ap.can_manage_reports IS TRUE
  );
$function$;
REVOKE ALL ON FUNCTION public.current_user_manager_can_manage_reports()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_manager_can_manage_reports() TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_report_id_in_scope(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_reports AS r
    JOIN public.profiles AS actor ON actor.id = (SELECT auth.uid())
    WHERE r.id = p_report_id
      AND actor.status = 'active'
      AND actor.role = 'Manager'
      AND public.manager_report_branch_in_scope(actor.id, r.branch_id, false)
  );
$function$;
REVOKE ALL ON FUNCTION public.manager_report_id_in_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_report_id_in_scope(uuid) TO authenticated;

-- This row resolver is SECURITY DEFINER so report/visit association checks work
-- even when called from RLS or a SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION public.manager_report_row_in_scope(p_table_name text, p_row jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_branch_id uuid;
BEGIN
  IF p_row IS NULL THEN RETURN false; END IF;
  CASE p_table_name
    WHEN 'daily_reports', 'technical_issues' THEN
      v_branch_id := NULLIF(p_row ->> 'branch_id', '')::uuid;
    WHEN 'waste_logs', 'shift_issues' THEN
      RETURN public.manager_report_id_in_scope(NULLIF(p_row ->> 'report_id', '')::uuid);
    ELSE
      RETURN false;
  END CASE;
  RETURN v_branch_id IS NOT NULL
    AND public.manager_report_branch_in_scope((SELECT auth.uid()), v_branch_id, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.manager_report_row_in_scope(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_report_row_in_scope(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.manager_visit_row_branch_in_scope(p_table_name text, p_row jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_branch_id uuid;
  v_parent_branch_id uuid;
BEGIN
  IF p_row IS NULL THEN RETURN false; END IF;
  CASE p_table_name
    WHEN 'branch_visit_assignments', 'supervisory_visits' THEN
      v_branch_id := NULLIF(p_row ->> 'branch_id', '')::uuid;
    WHEN 'supervisory_visit_results', 'visit_evidence', 'visit_email_logs', 'supervisory_visit_notes' THEN
      SELECT v.branch_id INTO v_branch_id
      FROM public.supervisory_visits AS v
      WHERE v.id = NULLIF(p_row ->> 'visit_id', '')::uuid;
    WHEN 'visit_action_items' THEN
      v_branch_id := NULLIF(p_row ->> 'branch_id', '')::uuid;
      SELECT v.branch_id INTO v_parent_branch_id
      FROM public.supervisory_visits AS v
      WHERE v.id = NULLIF(p_row ->> 'visit_id', '')::uuid;
      IF v_branch_id IS DISTINCT FROM v_parent_branch_id THEN RETURN false; END IF;
    WHEN 'visit_action_review_events' THEN
      SELECT v.branch_id INTO v_branch_id
      FROM public.visit_action_items AS ai
      JOIN public.supervisory_visits AS v ON v.id = ai.visit_id AND v.branch_id = ai.branch_id
      WHERE ai.id = NULLIF(p_row ->> 'action_item_id', '')::uuid;
    ELSE
      RETURN false;
  END CASE;
  RETURN v_branch_id IS NOT NULL
    AND public.manager_report_branch_in_scope((SELECT auth.uid()), v_branch_id, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.manager_visit_row_branch_in_scope(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_visit_row_branch_in_scope(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_branch_visit_in_scope(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND p.role <> 'Quality'
      AND (p.role = 'Owner' OR COALESCE(ap.can_manage_branch_visits, false) IS TRUE)
      AND (
        p.role <> 'Manager'
        OR public.manager_report_branch_in_scope(p.id, p_branch_id, false)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manage_branch_visit_in_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_branch_visit_in_scope(uuid) TO authenticated;

-- Restrictive policies preserve the original permission model while denying any
-- Manager write whose direct branch or parent report is outside the saved scope.
DO $report_write_scope_policies$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('daily_reports', 'current_user_manager_branch_in_scope(branch_id)'),
      ('waste_logs', 'manager_report_id_in_scope(report_id)'),
      ('shift_issues', 'manager_report_id_in_scope(report_id)'),
      ('technical_issues', 'current_user_manager_branch_in_scope(branch_id)')
    ) AS rules(table_name, scope_expression)
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON public.%I',
      'manager_' || r.table_name || '_write_scope_guard', r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_role() <> ''Manager'' OR public.%s) WITH CHECK (public.current_user_role() <> ''Manager'' OR public.%s)',
      'manager_' || r.table_name || '_write_scope_guard', r.table_name,
      r.scope_expression, r.scope_expression
    );
  END LOOP;
END
$report_write_scope_policies$;

-- Branch scope is not a write grant: require the independent can_manage_reports
-- permission for every Manager INSERT, UPDATE, and DELETE.
DO $report_write_permission_policies$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('daily_reports'), ('waste_logs'), ('shift_issues'), ('technical_issues')
    ) AS tables(table_name)
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'manager_' || r.table_name || '_write_permission_insert_guard', r.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.current_user_role() <> ''Manager'' OR public.current_user_manager_can_manage_reports())',
      'manager_' || r.table_name || '_write_permission_insert_guard', r.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'manager_' || r.table_name || '_write_permission_update_guard', r.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.current_user_role() <> ''Manager'' OR public.current_user_manager_can_manage_reports()) WITH CHECK (public.current_user_role() <> ''Manager'' OR public.current_user_manager_can_manage_reports())',
      'manager_' || r.table_name || '_write_permission_update_guard', r.table_name
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'manager_' || r.table_name || '_write_permission_delete_guard', r.table_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.current_user_role() <> ''Manager'' OR public.current_user_manager_can_manage_reports())',
      'manager_' || r.table_name || '_write_permission_delete_guard', r.table_name
    );
  END LOOP;
END
$report_write_permission_policies$;

-- Apply the same branch boundary to visit rows and every visit-linked child.
DO $visit_write_scope_policies$
DECLARE r record; v_policy_name text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('branch_visit_assignments', 'pg_catalog.jsonb_build_object(''branch_id'', branch_id)'),
      ('supervisory_visits', 'pg_catalog.jsonb_build_object(''branch_id'', branch_id)'),
      ('supervisory_visit_results', 'pg_catalog.jsonb_build_object(''visit_id'', visit_id)'),
      ('visit_action_items', 'pg_catalog.jsonb_build_object(''branch_id'', branch_id, ''visit_id'', visit_id)'),
      ('visit_evidence', 'pg_catalog.jsonb_build_object(''visit_id'', visit_id)'),
      ('visit_action_review_events', 'pg_catalog.jsonb_build_object(''action_item_id'', action_item_id)'),
      ('visit_email_logs', 'pg_catalog.jsonb_build_object(''visit_id'', visit_id)'),
      ('supervisory_visit_notes', 'pg_catalog.jsonb_build_object(''visit_id'', visit_id)')
    ) AS rules(table_name, row_expression)
  LOOP
    v_policy_name := 'manager_' || r.table_name || '_write_scope_guard';
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON public.%I', v_policy_name, r.table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_role() <> ''Manager'' OR public.manager_visit_row_branch_in_scope(%L, %s)) WITH CHECK (public.current_user_role() <> ''Manager'' OR public.manager_visit_row_branch_in_scope(%L, %s))',
      v_policy_name, r.table_name, r.table_name, r.row_expression, r.table_name, r.row_expression
    );
  END LOOP;
END
$visit_write_scope_policies$;

-- Storage access policies continue to control who may upload/read evidence; this
-- restrictive guard adds a Manager scope boundary across all operations.
DROP POLICY IF EXISTS manager_visit_action_evidence_write_scope_guard ON storage.objects;
CREATE POLICY manager_visit_action_evidence_write_scope_guard ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    bucket_id <> 'visit-action-evidence'
    OR public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.visit_action_items AS ai
      WHERE ai.id::text = pg_catalog.split_part(storage.objects.name, '/', 1)
        AND public.manager_visit_row_branch_in_scope(
          'visit_action_items', pg_catalog.jsonb_build_object('branch_id', ai.branch_id, 'visit_id', ai.visit_id)
        )
    )
  )
  WITH CHECK (
    bucket_id <> 'visit-action-evidence'
    OR public.current_user_role() <> 'Manager'
    OR EXISTS (
      SELECT 1 FROM public.visit_action_items AS ai
      WHERE ai.id::text = pg_catalog.split_part(storage.objects.name, '/', 1)
        AND public.manager_visit_row_branch_in_scope(
          'visit_action_items', pg_catalog.jsonb_build_object('branch_id', ai.branch_id, 'visit_id', ai.visit_id)
        )
    )
  );

-- Backstop for SECURITY DEFINER RPCs which bypass RLS. Validate both the old and
-- new parent branch on UPDATE to prevent moving a row across the boundary.
CREATE OR REPLACE FUNCTION public.guard_manager_branch_write_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_row jsonb;
BEGIN
  IF (SELECT public.current_user_role()) IS DISTINCT FROM 'Manager' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('daily_reports', 'waste_logs', 'shift_issues', 'technical_issues')
     AND NOT public.current_user_manager_can_manage_reports() THEN
    RAISE EXCEPTION 'كتابة تقارير المدير تتطلب صلاحية إدارة التقارير' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_row := pg_catalog.to_jsonb(OLD);
    IF TG_TABLE_NAME IN ('daily_reports', 'waste_logs', 'shift_issues', 'technical_issues') THEN
      IF NOT public.manager_report_row_in_scope(TG_TABLE_NAME, v_row) THEN
        RAISE EXCEPTION 'كتابة مدير الفروع خارج نطاق فروعه غير مسموحة' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT public.manager_visit_row_branch_in_scope(TG_TABLE_NAME, v_row) THEN
        RAISE EXCEPTION 'كتابة مدير الفروع خارج نطاق فروعه غير مسموحة' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_row := pg_catalog.to_jsonb(NEW);
    IF TG_TABLE_NAME IN ('daily_reports', 'waste_logs', 'shift_issues', 'technical_issues') THEN
      IF NOT public.manager_report_row_in_scope(TG_TABLE_NAME, v_row) THEN
        RAISE EXCEPTION 'كتابة مدير الفروع خارج نطاق فروعه غير مسموحة' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT public.manager_visit_row_branch_in_scope(TG_TABLE_NAME, v_row) THEN
        RAISE EXCEPTION 'كتابة مدير الفروع خارج نطاق فروعه غير مسموحة' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_manager_branch_write_scope() FROM PUBLIC, anon, authenticated, service_role;

DO $manager_branch_write_triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'daily_reports', 'waste_logs', 'shift_issues', 'technical_issues',
    'branch_visit_assignments', 'supervisory_visits', 'supervisory_visit_results',
    'visit_action_items', 'visit_evidence', 'visit_action_review_events',
    'visit_email_logs', 'supervisory_visit_notes'
  ] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS manager_branch_write_scope_guard ON public.%I', v_table);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER manager_branch_write_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_manager_branch_write_scope()',
      v_table
    );
  END LOOP;
END
$manager_branch_write_triggers$;

-- Scope-aware RPCs: preserve the existing write/review permission requirements,
-- but never return cross-scope candidates or authorize cross-scope submissions.
CREATE OR REPLACE FUNCTION public.list_branch_visit_assignees(p_branch_id uuid)
RETURNS TABLE(user_id uuid, full_name text, role text, shift_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.full_name, p.role, p.shift_type
  FROM public.profiles AS p
  WHERE p.branch_id = p_branch_id
    AND p.status = 'active'
    AND (
      public.can_manage_branch_visit_in_scope(p_branch_id)
      OR (public.current_user_role() <> 'Manager' AND public.can_manage_branch_visits())
      OR EXISTS (
        SELECT 1
        FROM public.branch_visit_assignments AS a
        JOIN public.profiles AS actor ON actor.id = (SELECT auth.uid()) AND actor.status = 'active'
        WHERE a.assigned_to = actor.id
          AND a.branch_id = p_branch_id
          AND a.status = 'assigned'
          AND (actor.role <> 'Manager' OR public.current_user_manager_branch_in_scope(p_branch_id))
      )
    )
  ORDER BY p.full_name;
$function$;
REVOKE ALL ON FUNCTION public.list_branch_visit_assignees(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_branch_visit_assignees(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_branch_visit_supervisors(p_branch_id uuid)
RETURNS TABLE(user_id uuid, full_name text, role text, shift_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.full_name, p.role, p.shift_type
  FROM public.profiles AS p
  WHERE (
      public.can_manage_branch_visit_in_scope(p_branch_id)
      OR (public.current_user_role() <> 'Manager' AND public.can_manage_branch_visits())
    )
    AND p.status = 'active'
    AND p.role = 'Supervisor'
    AND p.branch_id = p_branch_id
  ORDER BY p.full_name;
$function$;
REVOKE ALL ON FUNCTION public.list_branch_visit_supervisors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_branch_visit_supervisors(uuid) TO authenticated;

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
SET search_path = ''
AS $function$
  SELECT (
    public.can_manage_branch_visit_in_scope(p_branch_id)
    AND EXISTS (
      SELECT 1 FROM public.branch_visit_assignments AS manager_assignment
      WHERE manager_assignment.id = p_assignment_id
        AND manager_assignment.assigned_to IS DISTINCT FROM (SELECT auth.uid())
        AND manager_assignment.branch_id = p_branch_id
        AND manager_assignment.visit_date = p_visit_date
        AND manager_assignment.shift_type = p_shift_type
        AND manager_assignment.status = 'assigned'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.branch_visit_assignments AS a
    JOIN public.profiles AS p ON p.id = (SELECT auth.uid())
    WHERE a.id = p_assignment_id
      AND a.assigned_to = p.id
      AND p.status = 'active'
      AND a.branch_id = p_branch_id
      AND a.visit_date = p_visit_date
      AND a.shift_type = p_shift_type
      AND a.status = 'assigned'
      AND (p.role IS DISTINCT FROM 'Manager'
        OR public.current_user_manager_branch_in_scope(a.branch_id))
  );
$function$;
REVOKE ALL ON FUNCTION public.can_submit_assigned_branch_visit(uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_submit_assigned_branch_visit(uuid, uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.derive_supervisory_visit_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  override_changed boolean := false;
  audit_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    override_changed := COALESCE(NEW.quality_override, false);
  ELSE
    override_changed := NEW.quality_override IS DISTINCT FROM OLD.quality_override
      OR NEW.quality_override_reason IS DISTINCT FROM OLD.quality_override_reason;
    audit_changed := NEW.quality_override_by IS DISTINCT FROM OLD.quality_override_by
      OR NEW.quality_override_at IS DISTINCT FROM OLD.quality_override_at;
    IF audit_changed AND NOT override_changed THEN
      RAISE EXCEPTION 'بيانات توثيق الرسوب تُدار آلياً ولا يمكن تعديلها مباشرة';
    END IF;
  END IF;
  IF NEW.quality_override THEN
    IF NEW.status <> 'معتمدة' OR COALESCE(NEW.score_possible, 0) <= 0 OR NEW.score_total IS NULL THEN
      RAISE EXCEPTION 'لا يمكن تسجيل الرسوب الاستثنائي قبل اعتماد الزيارة واكتمال درجتها';
    END IF;
    IF override_changed THEN
      IF NOT public.can_manage_branch_visit_in_scope(NEW.branch_id) THEN
        RAISE EXCEPTION 'تسجيل الرسوب الاستثنائي يتطلب صلاحية إدارة زيارات الفرع ضمن النطاق';
      END IF;
      IF length(btrim(COALESCE(NEW.quality_override_reason, ''))) < 3 THEN
        RAISE EXCEPTION 'اكتب سبباً واضحاً لرسوب الجودة الاستثنائي';
      END IF;
      IF length(btrim(COALESCE(NEW.observation, ''))) < 3 THEN
        RAISE EXCEPTION 'سجّل الملاحظة الخطيرة قبل اعتماد الرسوب الاستثنائي';
      END IF;
      NEW.quality_override_by := (SELECT auth.uid());
      NEW.quality_override_at := pg_catalog.now();
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.quality_override_by := OLD.quality_override_by;
      NEW.quality_override_at := OLD.quality_override_at;
    END IF;
    NEW.quality_status := 'راسب';
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.quality_override AND override_changed
       AND NOT public.can_manage_branch_visit_in_scope(NEW.branch_id) THEN
      RAISE EXCEPTION 'إلغاء الرسوب الاستثنائي يتطلب صلاحية إدارة زيارات الفرع ضمن النطاق';
    END IF;
    NEW.quality_override_reason := NULL;
    NEW.quality_override_by := NULL;
    NEW.quality_override_at := NULL;
    IF NEW.status = 'معتمدة' AND COALESCE(NEW.score_possible, 0) > 0 AND NEW.score_total IS NOT NULL THEN
      NEW.quality_status := CASE
        WHEN NEW.score_total * 100 < NEW.score_possible * 70 THEN 'راسب'
        ELSE 'ناجح'
      END;
    ELSE
      NEW.quality_status := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.derive_supervisory_visit_quality() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.derive_supervisory_visit_quality() TO authenticated;

COMMIT;
