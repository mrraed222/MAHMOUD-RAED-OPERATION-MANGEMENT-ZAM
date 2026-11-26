-- Avoid requiring auth-schema USAGE for the summary reader role.
-- The original function is owned by zam_daily_summary_reader, so this safe
-- compatibility RPC is created without changing ownership or auth ACLs.

CREATE OR REPLACE FUNCTION public.get_daily_checklist_summary_v2(
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
  report_date date,
  shift_type text,
  entry_time text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_role text;
  v_status text;
  v_has_permission boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لقراءة الملخص' USING ERRCODE = '42501';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from
     OR (p_date_to - p_date_from) > 365 THEN
    RAISE EXCEPTION 'نطاق تاريخ الملخص غير صالح أو يتجاوز 366 يومًا'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.role, p.status INTO v_role, v_status
  FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'الحساب غير نشط أو غير مخول' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'Owner' THEN
    v_has_permission := true;
  ELSIF v_role = 'Admin' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.admin_permissions AS ap
      WHERE ap.profile_id = v_uid AND ap.can_view_all_reports IS TRUE
    ) INTO v_has_permission;
  ELSIF v_role = 'Manager' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.manager_report_scopes AS s
      WHERE s.profile_id = v_uid
        AND s.can_view_daily_checklist_summary IS TRUE
        AND (
          s.scope_mode = 'all'
          OR (s.scope_mode = 'selected' AND EXISTS (
            SELECT 1 FROM public.manager_report_scope_branches AS sb
            WHERE sb.profile_id = s.profile_id
          ))
        )
    ) INTO v_has_permission;
  END IF;
  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'لا تملك صلاحية قراءة ملخص التقارير' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.branch_id, b.name, r.report_date, r.shift_type, r.entry_time::text
  FROM public.daily_reports AS r
  JOIN public.branches AS b ON b.id = r.branch_id
  WHERE r.report_date BETWEEN p_date_from AND p_date_to
    AND b.lifecycle_status IS DISTINCT FROM 'planned'
  ORDER BY r.report_date, b.name, r.shift_type;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_daily_checklist_summary_v2(date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_checklist_summary_v2(date, date)
  TO authenticated;

