-- Compatibility fix for PostgREST versions that expose JWT claims as JSON.
-- Keep the existing SECURITY DEFINER owner, authorization checks, and ACLs:
-- CREATE OR REPLACE preserves these, so this migration intentionally has no
-- ALTER OWNER, REVOKE, or GRANT statements.

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
  v_uid uuid;
  v_jwt_sub text;
  v_jwt_claims jsonb;
  v_role text;
  v_status text;
  v_has_permission boolean := false;
BEGIN
  -- Prefer the legacy scalar setting. If absent, read only `sub` from the
  -- server-provided request.jwt.claims object; no RPC argument is trusted.
  v_jwt_sub := NULLIF(current_setting('request.jwt.claim.sub', true), '');
  IF v_jwt_sub IS NULL THEN
    BEGIN
      v_jwt_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
      v_jwt_sub := NULLIF(v_jwt_claims ->> 'sub', '');
    EXCEPTION WHEN invalid_text_representation THEN
      v_jwt_sub := NULL;
    END;
  END IF;
  v_uid := v_jwt_sub::uuid;

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
    AND (
      v_role <> 'Manager'
      OR EXISTS (
        SELECT 1
        FROM public.manager_report_scopes AS s
        WHERE s.profile_id = v_uid
          AND s.can_view_daily_checklist_summary IS TRUE
          AND (
            s.scope_mode = 'all'
            OR (
              s.scope_mode = 'selected'
              AND EXISTS (
                SELECT 1
                FROM public.manager_report_scope_branches AS sb
                WHERE sb.profile_id = s.profile_id
                  AND sb.branch_id = r.branch_id
              )
            )
          )
      )
    )
  ORDER BY r.report_date, b.name, r.shift_type;
END;
$function$;
