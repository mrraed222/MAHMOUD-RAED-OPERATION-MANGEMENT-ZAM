-- Local candidate only. Requires 20261122190000_riwaq_assignments_scopes_quality.sql.
-- Do not apply to production without independent review and explicit release approval.
BEGIN;

-- Share the permissions-page Manager branch scope with server-side email settings.
CREATE OR REPLACE FUNCTION public.profile_can_read_manager_report_branch(
  p_profile_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND p.role = 'Manager'
      AND (
        (
          NOT EXISTS (
            SELECT 1 FROM public.manager_report_scopes AS s WHERE s.profile_id = p.id
          )
          AND EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
          )
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
REVOKE ALL ON FUNCTION public.profile_can_read_manager_report_branch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_read_manager_report_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.profile_can_read_manager_report_branch((SELECT auth.uid()), p_branch_id);
$function$;
REVOKE ALL ON FUNCTION public.can_read_manager_report_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_manager_report_branch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_profile_read_daily_report_branch(
  p_profile_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND (
        p.role IN ('Owner', 'Admin')
        OR (p.role = 'Manager' AND public.profile_can_read_manager_report_branch(p.id, p_branch_id))
        OR (p.role = 'Supervisor' AND p.branch_id = p_branch_id
            AND p.shift_type IN ('Morning', 'Evening', 'Both'))
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_daily_report_branch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_profile_read_daily_report(
  p_profile_id uuid,
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
      WHERE p.id = p_profile_id
        AND p.status = 'active'
        AND (
          p.role IN ('Owner', 'Admin')
          OR (p.role = 'Manager' AND public.profile_can_read_manager_report_branch(p.id, p_branch_id))
          OR (p.role = 'Supervisor' AND p.branch_id = p_branch_id
              AND p.shift_type IN ('Morning', 'Evening', 'Both')
              AND (p.shift_type = 'Both' OR p.shift_type = p_report_shift_type))
        )
    );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_daily_report(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_profile_read_all_daily_report_branches(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND (
        p.role IN ('Owner', 'Admin')
        OR (
          p.role = 'Manager'
          AND ap.can_view_all_reports IS TRUE
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.manager_report_scopes AS s WHERE s.profile_id = p.id
            )
            OR EXISTS (
              SELECT 1 FROM public.manager_report_scopes AS s
              WHERE s.profile_id = p.id AND s.scope_mode = 'all'
            )
          )
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_read_all_daily_report_branches(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_profile_be_daily_report_primary(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_profile_id
      AND p.status = 'active'
      AND p.role IN ('Owner', 'Admin', 'Manager')
      AND (
        p.role <> 'Manager'
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_analytics IS TRUE
        )
      )
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND EXISTS (
        SELECT 1
        FROM public.branches AS b
        WHERE b.lifecycle_status IS DISTINCT FROM 'planned'
          AND public.can_profile_read_daily_report_branch(p.id, b.id)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_be_daily_report_primary(uuid)
  FROM PUBLIC, anon, authenticated;

-- Restrictive Supervisor check also runs in the report read policy. Both means
-- explicitly assigned to both shifts; Morning/Evening can read only their own.
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

DROP POLICY IF EXISTS daily_reports_authorized_branch_shift_read ON public.daily_reports;
CREATE POLICY daily_reports_authorized_branch_shift_read
  ON public.daily_reports
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    CASE public.current_user_role()
      WHEN 'Owner' THEN true
      WHEN 'Admin' THEN true
      WHEN 'Manager' THEN public.can_read_manager_report_branch(branch_id)
      WHEN 'Supervisor' THEN public.current_supervisor_can_read_daily_report(branch_id, shift_type)
      ELSE false
    END
  );

-- Child rows inherit the parent's authorized branch and shift. No write policy
-- is changed here.
DROP POLICY IF EXISTS waste_logs_authorized_parent_read ON public.waste_logs;
CREATE POLICY waste_logs_authorized_parent_read
  ON public.waste_logs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_reports AS r WHERE r.id = waste_logs.report_id));
DROP POLICY IF EXISTS shift_issues_authorized_parent_read ON public.shift_issues;
CREATE POLICY shift_issues_authorized_parent_read
  ON public.shift_issues AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_reports AS r WHERE r.id = shift_issues.report_id));
DROP POLICY IF EXISTS negative_reviews_authorized_parent_read ON public.negative_reviews;
CREATE POLICY negative_reviews_authorized_parent_read
  ON public.negative_reviews AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.daily_reports AS r WHERE r.id = negative_reviews.report_id));

-- Report-copy configuration references existing system accounts only. The
-- selected scope can never exceed each profile's canonical report permission.
CREATE TABLE IF NOT EXISTS public.daily_report_email_recipients (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_mode text NOT NULL CHECK (scope_mode IN ('all_authorized', 'selected')),
  is_primary boolean NOT NULL DEFAULT false,
  configured_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_report_email_one_primary_recipient
  ON public.daily_report_email_recipients(is_primary)
  WHERE is_primary IS TRUE;

CREATE TABLE IF NOT EXISTS public.daily_report_email_recipient_branches (
  profile_id uuid NOT NULL REFERENCES public.daily_report_email_recipients(profile_id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  PRIMARY KEY (profile_id, branch_id)
);

ALTER TABLE public.daily_report_email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_email_recipient_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_report_email_recipients, public.daily_report_email_recipient_branches
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_report_email_recipients,
  public.daily_report_email_recipient_branches TO service_role;

CREATE OR REPLACE FUNCTION public.can_manage_daily_report_email_settings()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = (SELECT auth.uid())
      AND p.status = 'active'
      AND (p.role = 'Owner' OR COALESCE(ap.can_manage_automations, false) IS TRUE)
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manage_daily_report_email_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_daily_report_email_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_daily_report_email_recipient_candidates()
RETURNS TABLE (
  profile_id uuid,
  full_name text,
  email text,
  role text,
  is_selected boolean,
  is_primary boolean,
  scope_mode text,
  selected_branch_ids uuid[],
  authorized_branches jsonb,
  can_be_primary boolean,
  is_configured boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.can_manage_daily_report_email_settings() THEN
    RAISE EXCEPTION 'لا تملك صلاحية إعداد مستلمي التقارير';
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.full_name,
         p.email,
         p.role,
         (p.role = 'Owner' OR r.profile_id IS NOT NULL) AS is_selected,
         COALESCE(r.is_primary, false) AS is_primary,
         CASE WHEN p.role = 'Owner' THEN 'all_authorized'
              ELSE COALESCE(r.scope_mode, 'all_authorized') END AS scope_mode,
         CASE WHEN p.role = 'Owner' THEN '{}'::uuid[]
              ELSE COALESCE(selected.branch_ids, '{}'::uuid[]) END AS selected_branch_ids,
         COALESCE(authorized.branch_list, '[]'::jsonb) AS authorized_branches,
         public.can_profile_be_daily_report_primary(p.id) AS can_be_primary,
         EXISTS (SELECT 1 FROM public.daily_report_email_recipients AS existing) AS is_configured
  FROM public.profiles AS p
  LEFT JOIN public.daily_report_email_recipients AS r ON r.profile_id = p.id
  LEFT JOIN LATERAL (
    SELECT array_agg(rb.branch_id ORDER BY rb.branch_id) AS branch_ids
    FROM public.daily_report_email_recipient_branches AS rb
    WHERE rb.profile_id = p.id
  ) AS selected ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'lifecycle_status', b.lifecycle_status,
        'planned_opening_date', b.planned_opening_date
      ) ORDER BY b.name
    ) AS branch_list
    FROM public.branches AS b
    WHERE b.lifecycle_status IS DISTINCT FROM 'planned'
      AND public.can_profile_read_daily_report_branch(p.id, b.id)
      AND (
        p.role <> 'Manager'
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_analytics IS TRUE
        )
      )
  ) AS authorized ON true
  WHERE p.status = 'active'
    AND p.role IN ('Owner', 'Admin', 'Manager', 'Supervisor')
    AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND jsonb_array_length(COALESCE(authorized.branch_list, '[]'::jsonb)) > 0
  ORDER BY (p.role = 'Owner') DESC, p.full_name, p.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_daily_report_email_recipient_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_daily_report_email_recipient_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_daily_report_email_recipients(
  p_recipients jsonb,
  p_primary_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_profile_id uuid;
  v_role text;
  v_email text;
  v_scope_mode text;
  v_branch_ids uuid[];
  v_seen_ids uuid[] := '{}'::uuid[];
  v_primary_found boolean := false;
BEGIN
  IF NOT public.can_manage_daily_report_email_settings() THEN
    RAISE EXCEPTION 'لا تملك صلاحية إعداد مستلمي التقارير';
  END IF;
  IF p_recipients IS NULL OR jsonb_typeof(p_recipients) IS DISTINCT FROM 'array'
     OR p_primary_profile_id IS NULL THEN
    RAISE EXCEPTION 'قائمة المستلمين أو مستلم التشغيل الإلزامي غير صالحة';
  END IF;
  IF jsonb_array_length(p_recipients) = 0 OR jsonb_array_length(p_recipients) > 100 THEN
    RAISE EXCEPTION 'عدد المستلمين خارج النطاق المسموح';
  END IF;

  LOCK TABLE public.daily_report_email_recipients,
             public.daily_report_email_recipient_branches IN EXCLUSIVE MODE;

  FOR v_item IN
    SELECT item FROM jsonb_array_elements(p_recipients) AS supplied(item)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'بيانات أحد المستلمين غير صالحة';
    END IF;
    BEGIN
      v_profile_id := NULLIF(v_item ->> 'profile_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'معرّف أحد المستلمين غير صالح';
    END;
    IF v_profile_id IS NULL OR v_profile_id = ANY (v_seen_ids) THEN
      RAISE EXCEPTION 'توجد حسابات مكررة أو معرّف مستلم فارغ';
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_profile_id);

    v_scope_mode := v_item ->> 'scope_mode';
    IF v_scope_mode IS NULL OR v_scope_mode NOT IN ('all_authorized', 'selected') THEN
      RAISE EXCEPTION 'نطاق أحد المستلمين غير صالح';
    END IF;

    SELECT p.role, p.email
      INTO v_role, v_email
    FROM public.profiles AS p
    WHERE p.id = v_profile_id AND p.status = 'active';
    IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('Owner', 'Admin', 'Manager', 'Supervisor')
       OR v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR NOT EXISTS (
         SELECT 1 FROM public.branches AS b
         WHERE public.can_profile_read_daily_report_branch(v_profile_id, b.id)
       )
       OR (v_role = 'Manager' AND NOT EXISTS (
         SELECT 1 FROM public.admin_permissions AS ap
         WHERE ap.profile_id = v_profile_id AND ap.can_view_analytics IS TRUE
       )) THEN
      RAISE EXCEPTION 'الحساب غير نشط أو لا يملك بريدًا أو صلاحية تقارير';
    END IF;
    IF v_role = 'Owner' AND v_scope_mode <> 'all_authorized' THEN
      RAISE EXCEPTION 'يستلم مالك النظام تقارير جميع الفروع المصرح بها';
    END IF;

    IF jsonb_typeof(v_item -> 'branch_ids') IS NULL THEN
      v_branch_ids := '{}'::uuid[];
    ELSIF jsonb_typeof(v_item -> 'branch_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'قائمة الفروع لأحد المستلمين غير صالحة';
    ELSE
      BEGIN
        SELECT COALESCE(array_agg(branch_value::uuid), '{}'::uuid[])
          INTO v_branch_ids
        FROM jsonb_array_elements_text(v_item -> 'branch_ids') AS branch_values(branch_value);
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'معرّف فرع ضمن قائمة المستلمين غير صالح';
      END;
    END IF;

    IF v_scope_mode = 'all_authorized' THEN
      IF cardinality(v_branch_ids) <> 0 THEN
        RAISE EXCEPTION 'لا تُرسل فروعًا محددة مع نطاق كل الفروع المصرح بها';
      END IF;
    ELSE
      IF cardinality(v_branch_ids) = 0 OR cardinality(v_branch_ids) <> (
        SELECT count(DISTINCT branch_id)::integer
        FROM unnest(v_branch_ids) AS supplied_branch(branch_id)
      ) THEN
        RAISE EXCEPTION 'اختر فروعًا محددة دون تكرار';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM unnest(v_branch_ids) AS supplied_branch(branch_id)
        LEFT JOIN public.branches AS b ON b.id = supplied_branch.branch_id
        WHERE b.id IS NULL
           OR b.lifecycle_status = 'planned'
           OR NOT public.can_profile_read_daily_report_branch(v_profile_id, supplied_branch.branch_id)
      ) THEN
        RAISE EXCEPTION 'تتضمن قائمة المستلم فرعًا غير مصرح به';
      END IF;
    END IF;

    IF v_profile_id = p_primary_profile_id THEN
      v_primary_found := true;
      IF NOT public.can_profile_be_daily_report_primary(v_profile_id) THEN
        RAISE EXCEPTION 'مستلم التشغيل الإلزامي غير مخول ضمن نطاق التقارير';
      END IF;
    END IF;
  END LOOP;

  IF NOT v_primary_found THEN
    RAISE EXCEPTION 'اختر مستلم التشغيل الإلزامي من الحسابات المحددة';
  END IF;

  DELETE FROM public.daily_report_email_recipients;
  INSERT INTO public.daily_report_email_recipients (
    profile_id, scope_mode, is_primary, configured_by
  )
  SELECT (item ->> 'profile_id')::uuid,
         item ->> 'scope_mode',
         (item ->> 'profile_id')::uuid = p_primary_profile_id,
         (SELECT auth.uid())
  FROM jsonb_array_elements(p_recipients) AS supplied(item);

  INSERT INTO public.daily_report_email_recipient_branches(profile_id, branch_id)
  SELECT (item ->> 'profile_id')::uuid, branch_value::uuid
  FROM jsonb_array_elements(p_recipients) AS supplied(item)
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(item -> 'branch_ids', '[]'::jsonb)) AS selected_branch(branch_value)
  WHERE item ->> 'scope_mode' = 'selected';

  -- Keep every active Owner as a required system recipient, even if the client
  -- omits an Owner row. Additional selections remain profile-based and scoped.
  INSERT INTO public.daily_report_email_recipients (
    profile_id, scope_mode, is_primary, configured_by
  )
  SELECT p.id, 'all_authorized', false, (SELECT auth.uid())
  FROM public.profiles AS p
  WHERE p.status = 'active'
    AND p.role = 'Owner'
    AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ON CONFLICT (profile_id) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_daily_report_email_recipients(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_daily_report_email_recipients(jsonb, uuid) TO authenticated;

-- Service-role-only resolver rechecks report access at send time. The caller's
-- own report copy is added separately by the authenticated Edge Function.
CREATE OR REPLACE FUNCTION public.get_daily_report_copy_recipients(p_report_id uuid)
RETURNS TABLE (profile_id uuid, email text, is_primary boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_branch_id uuid;
  v_report_shift_type text;
  v_report_submitter_id uuid;
BEGIN
  SELECT r.branch_id, r.shift_type, r.submitted_by
    INTO v_branch_id, v_report_shift_type, v_report_submitter_id
  FROM public.daily_reports AS r
  WHERE r.id = p_report_id;
  IF NOT FOUND OR v_branch_id IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS b
    WHERE b.id = v_branch_id AND b.lifecycle_status IS DISTINCT FROM 'planned'
  ) THEN
    RAISE EXCEPTION 'report_branch_not_operational';
  END IF;

  -- Owner/Admin behavior remains unchanged. Auto-included Managers must have
  -- analytics/detail permission and all-branches scope; selected-branch scope
  -- never qualifies. can_view_all_reports is only a legacy
  -- all-scope fallback when no explicit Manager scope row exists.
  -- The caller's own Supervisor copy is added separately by the Edge Function.
  -- Settings may add configured scoped recipients, but cannot replace this baseline.
  IF NOT EXISTS (SELECT 1 FROM public.daily_report_email_recipients) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.status = 'active' AND p.role = 'Owner'
        AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        AND public.can_profile_read_all_daily_report_branches(p.id)
        AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
    ) THEN
      RAISE EXCEPTION 'primary_report_recipient_not_configured';
    END IF;
    RETURN QUERY
    SELECT p.id, p.email,
           row_number() OVER (ORDER BY (p.role = 'Owner') DESC, p.created_at, p.id) = 1
    FROM public.profiles AS p
    WHERE p.status = 'active'
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (
        (
          p.role IN ('Owner', 'Admin')
          AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
        )
        OR (
          p.role = 'Manager'
          AND v_report_shift_type IN ('Morning', 'Evening')
          AND (
            EXISTS (
              SELECT 1 FROM public.manager_report_scopes AS all_scope
              WHERE all_scope.profile_id = p.id AND all_scope.scope_mode = 'all'
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM public.manager_report_scopes AS configured_scope
                WHERE configured_scope.profile_id = p.id
              )
              AND EXISTS (
                SELECT 1 FROM public.admin_permissions AS legacy_scope
                WHERE legacy_scope.profile_id = p.id
                  AND legacy_scope.can_view_all_reports IS TRUE
              )
            )
          )
          AND EXISTS (
            SELECT 1 FROM public.admin_permissions AS analytics_permission
            WHERE analytics_permission.profile_id = p.id
              AND analytics_permission.can_view_analytics IS TRUE
          )
        )
      )
    ORDER BY (p.role = 'Owner') DESC, p.created_at, p.id;
    RETURN;
  END IF;

  -- The primary recipient must remain valid in at least one configured,
  -- currently authorized branch, but a selected-scope primary is intentionally
  -- absent from reports for branches outside that selection. Other eligible
  -- recipients (including the system Owner) may still receive those reports.
  IF NOT EXISTS (
    SELECT 1
    FROM public.daily_report_email_recipients AS configured
    JOIN public.profiles AS p ON p.id = configured.profile_id
    WHERE configured.is_primary IS TRUE
      AND p.status = 'active'
      AND p.role IN ('Owner', 'Admin', 'Manager')
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND public.can_profile_be_daily_report_primary(p.id)
      AND (
        configured.scope_mode = 'all_authorized'
        OR (configured.scope_mode = 'selected' AND EXISTS (
          SELECT 1
          FROM public.daily_report_email_recipient_branches AS primary_branch
          JOIN public.branches AS b ON b.id = primary_branch.branch_id
          WHERE primary_branch.profile_id = configured.profile_id
            AND b.lifecycle_status IS DISTINCT FROM 'planned'
            AND public.can_profile_read_daily_report_branch(p.id, primary_branch.branch_id)
        ))
      )
  ) THEN
    RAISE EXCEPTION 'primary_report_recipient_not_configured';
  END IF;

  RETURN QUERY
  WITH eligible_recipients AS (
    SELECT configured.profile_id, p.email, configured.is_primary, p.full_name
    FROM public.daily_report_email_recipients AS configured
    JOIN public.profiles AS p ON p.id = configured.profile_id
    WHERE p.status = 'active'
      AND p.role IN ('Owner', 'Admin', 'Manager', 'Supervisor')
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (p.role <> 'Supervisor' OR p.id = v_report_submitter_id)
      AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
      AND (
        p.role <> 'Manager'
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions AS analytics_permission
          WHERE analytics_permission.profile_id = p.id
            AND analytics_permission.can_view_analytics IS TRUE
        )
      )
      AND (
        configured.scope_mode = 'all_authorized'
        OR (configured.scope_mode = 'selected' AND EXISTS (
          SELECT 1
          FROM public.daily_report_email_recipient_branches AS selected
          WHERE selected.profile_id = configured.profile_id
            AND selected.branch_id = v_branch_id
        ))
      )
    UNION ALL
    SELECT p.id, p.email, false, p.full_name
    FROM public.profiles AS p
    WHERE p.status = 'active'
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (
        (
          p.role IN ('Owner', 'Admin')
          AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
        )
        OR (
          p.role = 'Manager'
          AND v_report_shift_type IN ('Morning', 'Evening')
          AND (
            EXISTS (
              SELECT 1 FROM public.manager_report_scopes AS all_scope
              WHERE all_scope.profile_id = p.id AND all_scope.scope_mode = 'all'
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM public.manager_report_scopes AS configured_scope
                WHERE configured_scope.profile_id = p.id
              )
              AND EXISTS (
                SELECT 1 FROM public.admin_permissions AS legacy_scope
                WHERE legacy_scope.profile_id = p.id
                  AND legacy_scope.can_view_all_reports IS TRUE
              )
            )
          )
          AND EXISTS (
            SELECT 1 FROM public.admin_permissions AS analytics_permission
            WHERE analytics_permission.profile_id = p.id
              AND analytics_permission.can_view_analytics IS TRUE
          )
        )
      )
  )
  SELECT eligible.profile_id, eligible.email, bool_or(eligible.is_primary)
  FROM eligible_recipients AS eligible
  GROUP BY eligible.profile_id, eligible.email, eligible.full_name
  ORDER BY bool_or(eligible.is_primary) DESC, eligible.full_name, eligible.profile_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_daily_report_copy_recipients(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_report_copy_recipients(uuid) TO service_role;

COMMIT;
