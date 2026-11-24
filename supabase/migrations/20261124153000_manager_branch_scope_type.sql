-- Reviewed release migration. Preserve the legacy manager-scope RPC overload
-- during rollout so already-open clients can still save a deny-by-default scope.
BEGIN;

-- Keep the established profile role (`Manager`) so existing role gates remain
-- unchanged; persist the Manager's selected path alongside its explicit scope.
ALTER TABLE public.manager_report_scopes
  ADD COLUMN IF NOT EXISTS manager_type text NOT NULL DEFAULT 'branches';

DO $manager_type_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.manager_report_scopes'::regclass
      AND conname = 'manager_report_scopes_manager_type_check'
  ) THEN
    ALTER TABLE public.manager_report_scopes
      ADD CONSTRAINT manager_report_scopes_manager_type_check
      CHECK (manager_type IN ('branches', 'branch'));
  END IF;
END
$manager_type_constraint$;

COMMENT ON COLUMN public.manager_report_scopes.manager_type IS
  'branches: all or multiple selected operational branches; branch: exactly the profile primary branch';

-- A branch-manager scope must remain one selected primary branch even if a stale
-- client or direct legacy RPC attempts to save a broader scope.
CREATE OR REPLACE FUNCTION public.manager_report_branch_in_scope(
  p_profile_id uuid,
  p_branch_id uuid,
  p_legacy_global boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_profile_id IS NOT NULL
    AND p_branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.manager_report_scopes AS s ON s.profile_id = p.id
      JOIN public.branches AS b ON b.id = p_branch_id
      WHERE p.id = p_profile_id
        AND p.status = 'active'
        AND p.role = 'Manager'
        AND (b.lifecycle_status IS NULL OR b.lifecycle_status = '' OR b.lifecycle_status = 'operational')
        AND (
          s.manager_type = 'branches'
          OR (
            s.manager_type = 'branch'
            AND s.scope_mode = 'selected'
            AND p.branch_id = p_branch_id
            AND (SELECT pg_catalog.count(*) FROM public.manager_report_scope_branches AS sb
                 WHERE sb.profile_id = s.profile_id) = 1
          )
        )
        AND (
          s.scope_mode = 'all'
          OR (s.scope_mode = 'selected' AND EXISTS (
            SELECT 1 FROM public.manager_report_scope_branches AS sb
            WHERE sb.profile_id = s.profile_id AND sb.branch_id = p_branch_id
          ))
        )
    );
$function$;
REVOKE ALL ON FUNCTION public.manager_report_branch_in_scope(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manager_report_scope_allows(
  p_profile_id uuid,
  p_permission text,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_profile_id IS NOT NULL
    AND p_branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.manager_report_scopes AS s ON s.profile_id = p.id
      JOIN public.branches AS b ON b.id = p_branch_id
      WHERE p.id = p_profile_id
        AND p.status = 'active'
        AND p.role = 'Manager'
        AND (b.lifecycle_status IS NULL OR b.lifecycle_status = '' OR b.lifecycle_status = 'operational')
        AND CASE p_permission
          WHEN 'can_view_daily_checklist_summary' THEN s.can_view_daily_checklist_summary IS TRUE
          WHEN 'can_view_checklist_logs' THEN s.can_view_checklist_logs IS TRUE
          WHEN 'can_view_visit_reports' THEN s.can_view_visit_reports IS TRUE
          WHEN 'can_view_analytics' THEN s.can_view_analytics IS TRUE
          ELSE false
        END
        AND (
          s.manager_type = 'branches'
          OR (
            s.manager_type = 'branch'
            AND s.scope_mode = 'selected'
            AND p.branch_id = p_branch_id
            AND (SELECT pg_catalog.count(*) FROM public.manager_report_scope_branches AS sb
                 WHERE sb.profile_id = s.profile_id) = 1
          )
        )
        AND (
          s.scope_mode = 'all'
          OR (s.scope_mode = 'selected' AND EXISTS (
            SELECT 1 FROM public.manager_report_scope_branches AS sb
            WHERE sb.profile_id = s.profile_id AND sb.branch_id = p_branch_id
          ))
        )
    );
$function$;
REVOKE ALL ON FUNCTION public.manager_report_scope_allows(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Owner-only writer. Branch managers are locked to exactly their profile branch;
-- all four independent read capabilities are preserved as explicit booleans.
DROP FUNCTION IF EXISTS public.save_manager_report_scope(uuid, text, uuid[], boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.save_manager_report_scope(uuid, text, uuid[], boolean);
CREATE OR REPLACE FUNCTION public.save_manager_report_scope(
  p_profile_id uuid,
  p_manager_type text,
  p_scope_mode text,
  p_branch_ids uuid[],
  p_can_view_daily_checklist_summary boolean,
  p_can_view_checklist_logs boolean,
  p_can_view_visit_reports boolean,
  p_can_view_analytics boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_branch_ids uuid[] := COALESCE(p_branch_ids, '{}'::uuid[]);
  v_target_status text;
  v_primary_branch_id uuid;
  v_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS actor
    WHERE actor.id = (SELECT auth.uid())
      AND actor.status = 'active' AND actor.role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'يلزم مالك النظام لإعداد نطاق تقارير المدير'
      USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL
     OR p_manager_type IS NULL OR p_manager_type NOT IN ('branches', 'branch')
     OR p_scope_mode IS NULL OR p_scope_mode NOT IN ('all', 'selected')
     OR p_can_view_daily_checklist_summary IS NULL
     OR p_can_view_checklist_logs IS NULL
     OR p_can_view_visit_reports IS NULL
     OR p_can_view_analytics IS NULL
     OR pg_catalog.array_position(v_branch_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'إعداد نطاق تقارير غير صالح' USING ERRCODE = '22023';
  END IF;

  SELECT p.status, p.branch_id
    INTO v_target_status, v_primary_branch_id
  FROM public.profiles AS p WHERE p.id = p_profile_id FOR UPDATE;
  -- Scope can be staged for an active non-Manager before role activation. The
  -- read helpers above still require role='Manager', so staging cannot grant access.
  IF v_target_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'يمكن إعداد النطاق لحساب نشط فقط' USING ERRCODE = '22023';
  END IF;

  IF p_manager_type = 'branch' THEN
    IF p_scope_mode <> 'selected'
       OR pg_catalog.cardinality(v_branch_ids) <> 1
       OR v_primary_branch_id IS NULL
       OR v_branch_ids[1] IS DISTINCT FROM v_primary_branch_id THEN
      RAISE EXCEPTION 'مدير الفرع مقيد بفرعه الأساسي الواحد فقط' USING ERRCODE = '22023';
    END IF;
  ELSIF p_scope_mode = 'all' AND pg_catalog.cardinality(v_branch_ids) <> 0 THEN
    RAISE EXCEPTION 'لا ترسل فروعًا محددة مع نطاق كل الفروع' USING ERRCODE = '22023';
  ELSIF p_scope_mode = 'selected' THEN
    IF pg_catalog.cardinality(v_branch_ids) = 0
       OR pg_catalog.cardinality(v_branch_ids) <> (
         SELECT pg_catalog.count(DISTINCT branch_id)::integer
         FROM pg_catalog.unnest(v_branch_ids) AS supplied(branch_id)
       ) THEN
      RAISE EXCEPTION 'اختر فرعًا تشغيليًا واحدًا على الأقل دون تكرار' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_scope_mode = 'selected' THEN
    SELECT pg_catalog.count(*)::integer INTO v_count
    FROM public.branches AS b
    WHERE b.id = ANY (v_branch_ids)
      AND (b.lifecycle_status IS NULL OR b.lifecycle_status = '' OR b.lifecycle_status = 'operational');
    IF v_count <> pg_catalog.cardinality(v_branch_ids) THEN
      RAISE EXCEPTION 'تتضمن القائمة فرعًا غير موجود أو غير تشغيلي' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.manager_report_scopes (
    profile_id, manager_type, scope_mode,
    can_view_daily_checklist_summary, can_view_checklist_logs,
    can_view_visit_reports, can_view_analytics,
    configured_by, created_at, updated_at
  ) VALUES (
    p_profile_id, p_manager_type, p_scope_mode,
    p_can_view_daily_checklist_summary, p_can_view_checklist_logs,
    p_can_view_visit_reports, p_can_view_analytics,
    (SELECT auth.uid()), pg_catalog.now(), pg_catalog.now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    manager_type = EXCLUDED.manager_type,
    scope_mode = EXCLUDED.scope_mode,
    can_view_daily_checklist_summary = EXCLUDED.can_view_daily_checklist_summary,
    can_view_checklist_logs = EXCLUDED.can_view_checklist_logs,
    can_view_visit_reports = EXCLUDED.can_view_visit_reports,
    can_view_analytics = EXCLUDED.can_view_analytics,
    configured_by = EXCLUDED.configured_by,
    updated_at = pg_catalog.now();

  DELETE FROM public.manager_report_scope_branches WHERE profile_id = p_profile_id;
  IF p_scope_mode = 'selected' THEN
    INSERT INTO public.manager_report_scope_branches(profile_id, branch_id)
    SELECT p_profile_id, supplied.branch_id
    FROM pg_catalog.unnest(v_branch_ids) AS supplied(branch_id);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_manager_report_scope(
  uuid, text, text, uuid[], boolean, boolean, boolean, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_manager_report_scope(
  uuid, text, text, uuid[], boolean, boolean, boolean, boolean
) TO authenticated;

-- Compatibility for the currently deployed seven-argument client. The legacy
-- call can only configure the broad-manager path; Branch Manager remains
-- available through the explicit eight-argument RPC above.
CREATE OR REPLACE FUNCTION public.save_manager_report_scope(
  p_profile_id uuid,
  p_scope_mode text,
  p_branch_ids uuid[],
  p_can_view_daily_checklist_summary boolean,
  p_can_view_checklist_logs boolean,
  p_can_view_visit_reports boolean,
  p_can_view_analytics boolean
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT public.save_manager_report_scope(
    p_profile_id, 'branches', p_scope_mode, p_branch_ids,
    p_can_view_daily_checklist_summary, p_can_view_checklist_logs,
    p_can_view_visit_reports, p_can_view_analytics
  );
$function$;
REVOKE ALL ON FUNCTION public.save_manager_report_scope(
  uuid, text, uuid[], boolean, boolean, boolean, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_manager_report_scope(
  uuid, text, uuid[], boolean, boolean, boolean, boolean
) TO authenticated;

COMMIT;
