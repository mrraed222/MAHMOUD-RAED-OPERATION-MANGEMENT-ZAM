-- Review-only draft: optional extra branch/shift read scope for Supervisors.
-- The profile's own branch and shift remain the baseline scope. This migration
-- must be reviewed and applied by the database owner; it is not applied here.

CREATE TABLE IF NOT EXISTS public.supervisor_report_scopes (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  shift_types text[] NOT NULL DEFAULT '{}'::text[],
  can_view_checklist_logs boolean NOT NULL DEFAULT false,
  can_view_daily_reports boolean NOT NULL DEFAULT false,
  can_view_visit_reports boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supervisor_report_scopes_shift_types_check
    CHECK (shift_types <@ ARRAY['Morning','Evening']::text[]),
  CONSTRAINT supervisor_report_scopes_no_null_branch_check
    CHECK (array_position(branch_ids, NULL) IS NULL)
);

ALTER TABLE public.supervisor_report_scopes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner reads supervisor report scopes" ON public.supervisor_report_scopes;
CREATE POLICY "Owner reads supervisor report scopes" ON public.supervisor_report_scopes
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'Owner');
REVOKE ALL ON TABLE public.supervisor_report_scopes FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.supervisor_report_scopes TO authenticated;

CREATE OR REPLACE FUNCTION public.supervisor_scope_allows(
  p_profile_id uuid,
  p_branch_id uuid,
  p_shift_type text,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.supervisor_report_scopes AS s ON s.profile_id = p.id
    JOIN public.branches AS b ON b.id = p_branch_id
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND p.role = 'Supervisor'
      AND b.lifecycle_status IS DISTINCT FROM 'planned'
      AND (
        (p.branch_id = p_branch_id
         AND p.shift_type IN ('Morning','Evening','Both')
         AND p_shift_type IN ('Morning','Evening')
         AND (p.shift_type = 'Both' OR p.shift_type = p_shift_type))
        OR (
          s.profile_id IS NOT NULL
          AND CASE p_permission
            WHEN 'can_view_checklist_logs' THEN s.can_view_checklist_logs
            WHEN 'can_view_daily_reports' THEN s.can_view_daily_reports
            WHEN 'can_view_visit_reports' THEN s.can_view_visit_reports
            ELSE false
          END
          AND cardinality(s.branch_ids) > 0
          AND p_branch_id = ANY(s.branch_ids)
          AND cardinality(s.shift_types) > 0
          AND p_shift_type = ANY(s.shift_types)
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.supervisor_scope_allows(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.supervisor_scope_allows(uuid, uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_can_read_checklist_log(
  p_branch_id uuid,
  p_executed_by uuid,
  p_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT p.status = 'active'
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN public.manager_report_scope_allows(
          p.id, 'can_view_checklist_logs', p_branch_id
        )
        WHEN 'Supervisor' THEN public.supervisor_scope_allows(
          p.id, p_branch_id, p_shift_type, 'can_view_checklist_logs'
        )
        ELSE p_executed_by = p.id
      END
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.current_user_can_read_checklist_log(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_checklist_log(uuid, uuid, text)
  TO authenticated;

ALTER TABLE public.checklist_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_logs_read_scope_guard ON public.checklist_logs;
DROP POLICY IF EXISTS manager_checklist_logs_read_capability ON public.checklist_logs;
DROP POLICY IF EXISTS checklist_logs_supervisor_scope_guard ON public.checklist_logs;
CREATE POLICY checklist_logs_supervisor_scope_guard ON public.checklist_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_can_read_checklist_log(branch_id, executed_by, shift_type));

CREATE OR REPLACE FUNCTION public.current_user_can_read_daily_report(
  p_branch_id uuid,
  p_report_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT p.status = 'active'
      AND p_branch_id IS NOT NULL
      AND CASE p.role
        WHEN 'Owner' THEN true
        WHEN 'Admin' THEN EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
        WHEN 'Manager' THEN public.manager_report_scope_allows(
          p.id, 'can_view_analytics', p_branch_id
        )
        WHEN 'Supervisor' THEN public.supervisor_scope_allows(
          p.id, p_branch_id, p_report_shift_type, 'can_view_daily_reports'
        )
        ELSE false
      END
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.current_user_can_read_daily_report(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_daily_report(uuid, text)
  TO authenticated;

ALTER TABLE public.hourly_checklist_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hourly_checklist_logs_read_scope_guard ON public.hourly_checklist_logs;
DROP POLICY IF EXISTS manager_hourly_checklist_logs_read_capability ON public.hourly_checklist_logs;
CREATE POLICY hourly_checklist_logs_supervisor_scope_guard ON public.hourly_checklist_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_can_read_checklist_log(branch_id, executed_by, shift_type));

DROP POLICY IF EXISTS supervisor_visit_scope_guard ON public.supervisory_visits;
CREATE POLICY supervisor_visit_scope_guard ON public.supervisory_visits
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'Supervisor'
    OR public.supervisor_scope_allows(auth.uid(), branch_id, shift_type, 'can_view_visit_reports')
  );

CREATE OR REPLACE FUNCTION public.save_supervisor_report_scope(
  p_profile_id uuid,
  p_branch_ids uuid[],
  p_shift_types text[],
  p_can_view_checklist_logs boolean,
  p_can_view_daily_reports boolean,
  p_can_view_visit_reports boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_branch_ids uuid[] := COALESCE(p_branch_ids, '{}'::uuid[]);
  v_shift_types text[] := COALESCE(p_shift_types, '{}'::text[]);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND status = 'active' AND role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'يلزم مالك النظام لإعداد نطاق المشرف' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id AND status = 'active' AND role = 'Supervisor'
  ) THEN
    RAISE EXCEPTION 'يمكن إعداد نطاق لحساب مشرف نشط فقط' USING ERRCODE = '22023';
  END IF;
  IF array_position(v_branch_ids, NULL) IS NOT NULL
     OR array_position(v_shift_types, NULL) IS NOT NULL
     OR NOT (v_shift_types <@ ARRAY['Morning','Evening']::text[]) THEN
    RAISE EXCEPTION 'نطاق المشرف غير صالح' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_branch_ids) > 0 AND (
    SELECT count(*) FROM public.branches AS b
    WHERE b.id = ANY(v_branch_ids)
      AND b.lifecycle_status IS DISTINCT FROM 'planned'
  ) <> cardinality(v_branch_ids) THEN
    RAISE EXCEPTION 'يتضمن النطاق فرعًا غير تشغيلي' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.supervisor_report_scopes (
    profile_id, branch_ids, shift_types,
    can_view_checklist_logs, can_view_daily_reports, can_view_visit_reports,
    updated_at
  ) VALUES (
    p_profile_id, v_branch_ids, v_shift_types,
    p_can_view_checklist_logs, p_can_view_daily_reports, p_can_view_visit_reports,
    now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    branch_ids = EXCLUDED.branch_ids,
    shift_types = EXCLUDED.shift_types,
    can_view_checklist_logs = EXCLUDED.can_view_checklist_logs,
    can_view_daily_reports = EXCLUDED.can_view_daily_reports,
    can_view_visit_reports = EXCLUDED.can_view_visit_reports,
    updated_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.save_supervisor_report_scope(uuid, uuid[], text[], boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_supervisor_report_scope(uuid, uuid[], text[], boolean, boolean, boolean)
  TO authenticated;

