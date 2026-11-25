BEGIN;

-- Narrow replacement for the missing recipient-settings RPCs and the scheduled
-- worker's secure recipient/secret checks. No existing report RLS policies are
-- changed by this migration.

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
      AND (p.role = 'Owner' OR (p.role = 'Admin' AND ap.can_manage_automations IS TRUE))
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manage_daily_report_email_settings() FROM PUBLIC, anon, authenticated;

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
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      AND (
        p.role NOT IN ('Admin', 'Manager')
        OR EXISTS (
          SELECT 1
          FROM public.branches AS b
          WHERE (b.lifecycle_status IS NULL OR b.lifecycle_status IN ('', 'operational'))
            AND public.can_profile_read_daily_report_branch(p.id, b.id)
        )
      )
      AND (
        p.role <> 'Admin'
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions AS ap
          WHERE ap.profile_id = p.id AND ap.can_view_all_reports IS TRUE
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.branches AS b
        WHERE (b.lifecycle_status IS NULL OR b.lifecycle_status IN ('', 'operational'))
          AND public.can_profile_read_daily_report_branch(p.id, b.id)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_profile_be_daily_report_primary(uuid) FROM PUBLIC, anon, authenticated;

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
    WHERE (b.lifecycle_status IS NULL OR b.lifecycle_status IN ('', 'operational'))
      AND public.can_profile_read_daily_report_branch(p.id, b.id)
      ) AS authorized ON true
  WHERE p.status = 'active'
    AND p.role IN ('Owner', 'Admin', 'Manager', 'Supervisor')
    AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
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
       OR v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       OR NOT EXISTS (
         SELECT 1 FROM public.branches AS b
         WHERE (b.lifecycle_status IS NULL OR b.lifecycle_status IN ('', 'operational'))
           AND public.can_profile_read_daily_report_branch(v_profile_id, b.id)
       ) THEN
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
           OR b.lifecycle_status IS NOT NULL AND b.lifecycle_status NOT IN ('', 'operational')
           OR NOT public.can_profile_read_daily_report_branch(v_profile_id, supplied_branch.branch_id)
      ) THEN
        RAISE EXCEPTION 'تتضمن قائمة المستلم فرعًا غير مصرح به أو غير تشغيلي';
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

  -- Every active Owner remains a fixed recipient; the UI cannot remove this baseline.
  INSERT INTO public.daily_report_email_recipients (
    profile_id, scope_mode, is_primary, configured_by
  )
  SELECT p.id, 'all_authorized', false, (SELECT auth.uid())
  FROM public.profiles AS p
  WHERE p.status = 'active'
    AND p.role = 'Owner'
    AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    AND EXISTS (
      SELECT 1 FROM public.branches AS b
      WHERE (b.lifecycle_status IS NULL OR b.lifecycle_status IN ('', 'operational'))
        AND public.can_profile_read_daily_report_branch(p.id, b.id)
    )
  ON CONFLICT (profile_id) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_daily_report_email_recipients(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_daily_report_email_recipients(jsonb, uuid) TO authenticated;

-- Scheduled summaries are resolved from active profiles and their current
-- permissions at send time. Free-form automation_schedules.recipient_emails is
-- intentionally not consulted by the Edge worker.
CREATE OR REPLACE FUNCTION public.get_scheduled_automation_email_recipients(
  p_report_type text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (profile_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT p.id, p.email
  FROM public.profiles AS p
  LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
  LEFT JOIN public.manager_report_scopes AS s ON s.profile_id = p.id
  WHERE p.status = 'active'
    AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    AND (
      p.role = 'Owner'
      OR (p.role = 'Admin' AND ap.can_view_all_reports IS TRUE)
      OR (
        p.role = 'Manager'
        AND CASE
          WHEN p_report_type = 'checklist_summary' THEN
            s.manager_type = 'branches' AND s.scope_mode = 'all'
            AND s.can_view_daily_checklist_summary IS TRUE
          WHEN p_report_type = 'manager_reports_summary' THEN
            s.manager_type = 'branches' AND s.scope_mode = 'all'
            AND s.can_view_analytics IS TRUE
          WHEN p_report_type = 'missed_report_alert' AND p_branch_id IS NULL THEN
            s.manager_type = 'branches' AND s.scope_mode = 'all'
            AND s.can_view_analytics IS TRUE
          WHEN p_report_type = 'missed_report_alert' AND p_branch_id IS NOT NULL THEN
            s.can_view_analytics IS TRUE
            AND public.can_profile_read_daily_report_branch(p.id, p_branch_id)
          ELSE false
        END
      )
      OR (
        p_report_type = 'missed_report_alert'
        AND p_branch_id IS NOT NULL
        AND p.role = 'Supervisor'
        AND p.branch_id = p_branch_id
        AND p.shift_type IN ('Morning', 'Evening', 'Both')
        AND public.can_profile_read_daily_report_branch(p.id, p_branch_id)
      )
    )
    AND p_report_type IN ('checklist_summary', 'manager_reports_summary', 'missed_report_alert')
    AND (
      p_branch_id IS NULL
      OR p_report_type IN ('checklist_summary', 'manager_reports_summary')
      OR (
        p_report_type = 'missed_report_alert'
        AND public.can_profile_read_daily_report_branch(p.id, p_branch_id)
      )
    );
$function$;
REVOKE ALL ON FUNCTION public.get_scheduled_automation_email_recipients(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduled_automation_email_recipients(text, uuid) TO service_role;

-- The Edge worker calls this verifier with its private service-role key. Only
-- service_role can execute it; the secret value remains in Supabase Vault and
-- is never embedded in the worker source or returned by this function.
CREATE OR REPLACE FUNCTION public.verify_zam_automation_cron_secret(p_candidate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_candidate IS NOT NULL
     AND length(p_candidate) = 64
     AND EXISTS (
       SELECT 1
       FROM vault.decrypted_secrets AS secret
       WHERE secret.name = 'zam_automation_cron_secret'
         AND secret.decrypted_secret = p_candidate
     );
$function$;
REVOKE ALL ON FUNCTION public.verify_zam_automation_cron_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_zam_automation_cron_secret(text) TO service_role;

COMMIT;
