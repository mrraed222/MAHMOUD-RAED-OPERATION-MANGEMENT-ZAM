-- Dedicated 20-minute, per-occurrence workflow for the restroom task only.
-- The generic automation scheduler and inventory tasks are intentionally untouched.

ALTER TABLE public.hourly_checklist_logs
  ADD COLUMN IF NOT EXISTS steps_completed jsonb;

CREATE TABLE IF NOT EXISTS public.restroom_hourly_task_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  template_id uuid NOT NULL UNIQUE REFERENCES public.checklist_templates(id) ON DELETE RESTRICT,
  active_from timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restroom_hourly_task_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.restroom_hourly_task_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.restroom_hourly_task_config TO authenticated;
DROP POLICY IF EXISTS "Authenticated read active restroom hourly config" ON public.restroom_hourly_task_config;
CREATE POLICY "Authenticated read active restroom hourly config"
  ON public.restroom_hourly_task_config
  FOR SELECT TO authenticated
  USING (is_active);

-- This guarded RPC accepts only the single configured task and derives branch,
-- date, hour, deadline, and identity from the authenticated server-side context.
CREATE OR REPLACE FUNCTION public.complete_restroom_hourly_occurrence(
  p_template_id uuid,
  p_shift_type text,
  p_steps jsonb,
  p_notes text DEFAULT NULL,
  p_photo_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_profile record;
  v_branch record;
  v_template record;
  v_local_now timestamp without time zone;
  v_now timestamptz := pg_catalog.now();
  v_occurrence_start timestamptz;
  v_expected_shift text;
  v_hour integer;
  v_log_id uuid;
  v_existing_status text;
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
  v_photo_url text := NULLIF(pg_catalog.btrim(p_photo_url), '');
  v_photo_prefix text := 'https://uuphgpncmiwyigtqhjmd.supabase.co/storage/v1/object/public/task-evidence/';
  v_object_name text;
  v_required_steps jsonb := '{"tissues": true, "sink": true, "toilet_seat": true, "floor": true}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لتسجيل الموعد';
  END IF;

  SELECT p.id, p.branch_id, p.role, p.status, p.shift_type
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = v_user_id;
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'active' OR v_profile.role IS DISTINCT FROM 'Waiter' THEN
    RAISE EXCEPTION 'تسجيل الموعد متاح لموظفي الصالة النشطين فقط';
  END IF;

  SELECT c.active_from, t.id, t.task_title, t.category, t.task_type,
         t.frequency, t.branch_id, t.shift_type, t.is_active, t.requires_photo
    INTO v_template
    FROM public.restroom_hourly_task_config AS c
    JOIN public.checklist_templates AS t ON t.id = c.template_id
   WHERE c.id = 1
     AND c.is_active
     AND c.template_id = p_template_id
   FOR SHARE OF c, t;
  IF NOT FOUND OR v_template.is_active IS DISTINCT FROM true
     OR v_template.task_title IS DISTINCT FROM 'النظافة الدورية لدورات المياه'
     OR v_template.category IS DISTINCT FROM 'الصالة'
     OR v_template.task_type IS DISTINCT FROM 'restroom_check'
     OR v_template.frequency IS DISTINCT FROM 'hourly'
     OR v_template.shift_type IS DISTINCT FROM 'Both'
     OR v_template.branch_id IS NOT NULL
     OR v_template.requires_photo IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'قالب المهمة الساعية غير نشط أو غير صالح';
  END IF;

  SELECT b.id, b.name, b.lifecycle_status, b.planned_opening_date
    INTO v_branch
    FROM public.branches AS b
   WHERE b.id = v_profile.branch_id;
  IF NOT FOUND
     OR v_branch.name IN ('زام الحي', 'زام البرج')
     OR NOT (
       v_branch.lifecycle_status IS NULL
       OR v_branch.lifecycle_status = ''
       OR v_branch.lifecycle_status = 'operational'
       OR (
         v_branch.lifecycle_status = 'planned'
         AND v_branch.planned_opening_date IS NOT NULL
         AND v_branch.planned_opening_date <= pg_catalog.timezone('Asia/Riyadh', v_now)::date
       )
   ) THEN
    RAISE EXCEPTION 'المهمة غير متاحة لهذا الفرع قبل تأكيد تشغيله';
  END IF;

  IF p_shift_type IS NULL OR p_shift_type NOT IN ('Morning', 'Evening') THEN
    RAISE EXCEPTION 'الوردية المحددة غير صالحة';
  END IF;

  v_local_now := pg_catalog.timezone('Asia/Riyadh', v_now);
  v_hour := EXTRACT(HOUR FROM v_local_now)::integer;
  v_expected_shift := CASE
    WHEN v_hour BETWEEN 6 AND 15 THEN 'Morning'
    WHEN v_hour BETWEEN 16 AND 23 OR v_hour IN (0, 1) THEN 'Evening'
    ELSE NULL
  END;
  IF v_expected_shift IS NULL OR p_shift_type IS DISTINCT FROM v_expected_shift THEN
    RAISE EXCEPTION 'لا يوجد موعد دورة مياه مستحق في هذا الوقت';
  END IF;
  IF v_profile.shift_type IN ('Morning', 'Evening') AND v_profile.shift_type IS DISTINCT FROM p_shift_type THEN
    RAISE EXCEPTION 'الوردية لا تطابق وردية حسابك';
  END IF;

  v_occurrence_start := pg_catalog.date_trunc('hour', v_local_now) AT TIME ZONE 'Asia/Riyadh';
  IF v_occurrence_start < v_template.active_from THEN
    RAISE EXCEPTION 'لم يبدأ جدول المهمة لهذا الموعد بعد';
  END IF;
  IF v_now >= v_occurrence_start + INTERVAL '20 minutes' THEN
    RAISE EXCEPTION 'انتهت مهلة العشرين دقيقة؛ سُجّل الموعد غير منفذ';
  END IF;
  IF p_steps IS DISTINCT FROM v_required_steps THEN
    RAISE EXCEPTION 'أكمل الخطوات الأربع قبل تسجيل الموعد';
  END IF;
  IF v_notes IS NOT NULL AND pg_catalog.length(v_notes) > 4000 THEN
    RAISE EXCEPTION 'الملاحظات تتجاوز الحد المسموح';
  END IF;
  IF v_photo_url IS NULL OR pg_catalog.length(v_photo_url) > 2048 THEN
    RAISE EXCEPTION 'أرفق صورة إثبات صالحة قبل تسجيل الموعد';
  END IF;
  IF pg_catalog.left(v_photo_url, pg_catalog.length(v_photo_prefix)) <> v_photo_prefix THEN
    RAISE EXCEPTION 'صورة الإثبات يجب أن تكون من مخزن مهام زام';
  END IF;
  v_object_name := pg_catalog.substr(v_photo_url, pg_catalog.length(v_photo_prefix) + 1);
  IF v_object_name !~ ('^' || v_user_id::text || '/[^/?#]+$') THEN
    RAISE EXCEPTION 'مسار صورة الإثبات غير صالح';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM storage.objects AS o
     WHERE o.bucket_id = 'task-evidence'
       AND o.name = v_object_name
       AND (o.owner = v_user_id OR o.owner_id = v_user_id::text)
       AND (o.metadata ->> 'mimetype') LIKE 'image/%'
  ) THEN
    RAISE EXCEPTION 'تعذر التحقق من صورة الإثبات المرفوعة لهذا الحساب';
  END IF;

  INSERT INTO public.hourly_checklist_logs (
    template_id, template_title, template_category, branch_id, executed_by,
    status, notes, photo_url, execution_date, occurrence_hour, shift_type, steps_completed
  ) VALUES (
    v_template.id, v_template.task_title, v_template.category, v_profile.branch_id, v_user_id,
    'Completed', v_notes, v_photo_url, v_local_now::date, v_hour::smallint, p_shift_type, p_steps
  )
  ON CONFLICT (template_id, branch_id, execution_date, occurrence_hour)
    WHERE template_id IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_log_id;

  IF v_log_id IS NOT NULL THEN
    RETURN v_log_id;
  END IF;

  SELECT l.id, l.status
    INTO v_log_id, v_existing_status
    FROM public.hourly_checklist_logs AS l
   WHERE l.template_id = v_template.id
     AND l.branch_id = v_profile.branch_id
     AND l.execution_date = v_local_now::date
     AND l.occurrence_hour = v_hour::smallint;
  IF v_existing_status = 'Completed' THEN
    RETURN v_log_id;
  END IF;
  RAISE EXCEPTION 'هذا الموعد غير قابل للتعديل؛ انتهت مهلته أو سُجلت له حالة أخرى';
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_restroom_hourly_occurrence(uuid, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_restroom_hourly_occurrence(uuid, text, jsonb, text, text) TO authenticated;

-- Idempotent minute-level worker. It inserts only expired occurrences belonging
-- to the one configured restroom template and skips inactive/pre-opening branches.
CREATE OR REPLACE FUNCTION public.mark_restroom_hourly_occurrences_not_performed()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_local_now timestamp without time zone := pg_catalog.timezone('Asia/Riyadh', pg_catalog.now());
  v_inserted integer := 0;
  v_task record;
BEGIN
  SELECT c.template_id, c.active_from, c.last_processed_at
    INTO v_task
    FROM public.restroom_hourly_task_config AS c
    JOIN public.checklist_templates AS t ON t.id = c.template_id
   WHERE c.id = 1
     AND c.is_active
     AND t.is_active
     AND t.task_title = 'النظافة الدورية لدورات المياه'
     AND t.category = 'الصالة'
     AND t.task_type = 'restroom_check'
     AND t.frequency = 'hourly'
     AND t.shift_type = 'Both'
     AND t.branch_id IS NULL
     AND t.requires_photo = true
   FOR UPDATE OF c;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  WITH configured_task AS (
    SELECT c.template_id, c.active_from, c.last_processed_at, t.task_title, t.category
      FROM public.restroom_hourly_task_config AS c
      JOIN public.checklist_templates AS t ON t.id = c.template_id
     WHERE c.id = 1
       AND c.is_active
       AND t.is_active
       AND t.task_title = 'النظافة الدورية لدورات المياه'
       AND t.category = 'الصالة'
       AND t.task_type = 'restroom_check'
       AND t.frequency = 'hourly'
       AND t.shift_type = 'Both'
       AND t.branch_id IS NULL
       AND t.requires_photo = true
  ), business_dates AS (
    SELECT c.template_id, c.active_from, c.task_title, c.category, g.business_date::date AS business_date
      FROM configured_task AS c
      CROSS JOIN LATERAL pg_catalog.generate_series(
        GREATEST(
          (pg_catalog.timezone('Asia/Riyadh', c.active_from))::date - 1,
          (pg_catalog.timezone('Asia/Riyadh', COALESCE(c.last_processed_at, c.active_from)))::date - 1
        )::timestamp,
        v_local_now::date::timestamp,
        INTERVAL '1 day'
      ) AS g(business_date)
  ), schedule_slots AS (
    SELECT slot.hour, slot.shift_type
      FROM (VALUES
        (6, 'Morning'), (7, 'Morning'), (8, 'Morning'), (9, 'Morning'), (10, 'Morning'),
        (11, 'Morning'), (12, 'Morning'), (13, 'Morning'), (14, 'Morning'), (15, 'Morning'),
        (16, 'Evening'), (17, 'Evening'), (18, 'Evening'), (19, 'Evening'), (20, 'Evening'),
        (21, 'Evening'), (22, 'Evening'), (23, 'Evening'), (0, 'Evening'), (1, 'Evening')
      ) AS slot(hour, shift_type)
  ), due_occurrences AS (
    SELECT d.template_id, d.task_title, d.category, b.id AS branch_id,
           CASE WHEN s.shift_type = 'Evening' AND s.hour < 16 THEN d.business_date + 1 ELSE d.business_date END AS execution_date,
           s.hour::smallint AS occurrence_hour,
           s.shift_type,
           ((CASE WHEN s.shift_type = 'Evening' AND s.hour < 16 THEN d.business_date + 1 ELSE d.business_date END)
             + pg_catalog.make_time(s.hour, 0, 0)) AT TIME ZONE 'Asia/Riyadh' AS occurrence_start
      FROM business_dates AS d
      CROSS JOIN schedule_slots AS s
      CROSS JOIN public.branches AS b
     WHERE b.name NOT IN ('زام الحي', 'زام البرج')
       AND (
         b.lifecycle_status IS NULL
         OR b.lifecycle_status = ''
         OR b.lifecycle_status = 'operational'
         OR (
           b.lifecycle_status = 'planned'
           AND b.planned_opening_date IS NOT NULL
           AND b.planned_opening_date <= v_local_now::date
         )
       )
  )
  INSERT INTO public.hourly_checklist_logs (
    template_id, template_title, template_category, branch_id, executed_by,
    status, notes, photo_url, execution_date, occurrence_hour, shift_type, steps_completed
  )
  SELECT d.template_id, d.task_title, d.category, d.branch_id, NULL,
         'NotPerformed', NULL, NULL, d.execution_date, d.occurrence_hour, d.shift_type, NULL
    FROM due_occurrences AS d
   WHERE d.occurrence_start >= (SELECT active_from FROM public.restroom_hourly_task_config WHERE id = 1 AND is_active)
     AND d.occurrence_start + INTERVAL '20 minutes' <= v_now
  ON CONFLICT (template_id, branch_id, execution_date, occurrence_hour)
    WHERE template_id IS NOT NULL
    DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.restroom_hourly_task_config
     SET last_processed_at = v_now, updated_at = v_now
   WHERE id = 1 AND is_active AND template_id = v_task.template_id;
  RETURN v_inserted;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_restroom_hourly_occurrences_not_performed() FROM PUBLIC, anon, authenticated;

-- Keep the standard template editor safe: edits to the configured parent are
-- versioned atomically and move the task-specific config to the new version.
CREATE OR REPLACE FUNCTION public.save_restroom_hourly_task_with_branches(
  p_template_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_new_id uuid;
BEGIN
  IF NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
     OR p_payload ->> 'task_title' IS DISTINCT FROM 'النظافة الدورية لدورات المياه'
     OR p_payload ->> 'category' IS DISTINCT FROM 'الصالة'
     OR p_payload ->> 'shift_type' IS DISTINCT FROM 'Both'
     OR p_payload ->> 'task_type' IS DISTINCT FROM 'restroom_check'
     OR p_payload ->> 'frequency' IS DISTINCT FROM 'hourly'
     OR p_payload ->> 'requires_photo' IS DISTINCT FROM 'true'
     OR NULLIF(p_payload ->> 'target_time', '') IS NOT NULL
     OR NULLIF(p_payload ->> 'branch_id', '') IS NOT NULL THEN
    RAISE EXCEPTION 'هذا القالب مرتبط بجدول ساعي ثابت ولا يمكن تغيير اسمه أو نطاقه أو نوعه';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restroom_hourly_task_config AS c
     WHERE c.id = 1 AND c.is_active AND c.template_id = p_template_id
  ) THEN
    RAISE EXCEPTION 'القالب غير مرتبط بجدول دورة المياه النشط';
  END IF;

  v_new_id := public.save_checklist_template_with_branches(
    p_template_id, p_payload, '{}'::uuid[], true
  );
  UPDATE public.restroom_hourly_task_config
     SET template_id = v_new_id, updated_at = pg_catalog.now()
   WHERE id = 1 AND is_active AND template_id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذّر تحديث ارتباط المجدول بالمهمة الجديدة';
  END IF;
  RETURN v_new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_restroom_hourly_task_with_branches(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_restroom_hourly_task_with_branches(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_restroom_hourly_task(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;
  UPDATE public.restroom_hourly_task_config
     SET is_active = false, updated_at = pg_catalog.now()
   WHERE id = 1 AND is_active AND template_id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'القالب غير مرتبط بجدول دورة المياه النشط';
  END IF;
  UPDATE public.checklist_templates
     SET is_active = false
   WHERE id = p_template_id AND is_active;
END;
$function$;
REVOKE ALL ON FUNCTION public.archive_restroom_hourly_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_restroom_hourly_task(uuid) TO authenticated;

-- One-time initialization: version the single existing hourly restroom template
-- into the approved global parent, archive its old version, and start at the next
-- full Riyadh hour. Later edits use save_restroom_hourly_task_with_branches.
CREATE OR REPLACE FUNCTION public.initialize_restroom_hourly_task(p_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old public.checklist_templates%ROWTYPE;
  v_new_id uuid;
  v_active_from timestamptz;
  v_active_hourly_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.restroom_hourly_task_config AS c WHERE c.id = 1
  ) THEN
    RAISE EXCEPTION 'جدول مهمة دورات المياه مهيأ بالفعل';
  END IF;

  SELECT t.*
    INTO v_old
    FROM public.checklist_templates AS t
   WHERE t.id = p_template_id
     AND t.is_active
   FOR UPDATE;
  IF NOT FOUND
     OR v_old.task_type IS DISTINCT FROM 'restroom_check'
     OR v_old.frequency IS DISTINCT FROM 'hourly'
     OR v_old.category IS DISTINCT FROM 'الصالة' THEN
    RAISE EXCEPTION 'القالب الحالي ليس مهمة دورات مياه ساعية نشطة صالحة للترقية';
  END IF;

  SELECT count(*)::integer
    INTO v_active_hourly_count
    FROM public.checklist_templates AS t
   WHERE t.is_active
     AND t.task_type = 'restroom_check'
     AND t.frequency = 'hourly';
  IF v_active_hourly_count <> 1 THEN
    RAISE EXCEPTION 'يلزم وجود قالب ساعي نشط واحد فقط قبل التهيئة؛ لم يتغير أي قالب';
  END IF;

  v_active_from := (
    pg_catalog.date_trunc('hour', pg_catalog.timezone('Asia/Riyadh', pg_catalog.clock_timestamp()))
      + INTERVAL '1 hour'
  ) AT TIME ZONE 'Asia/Riyadh';

  INSERT INTO public.checklist_templates (
    task_title, category, shift_type, instructions, branch_id, requires_photo,
    target_time, frequency, day_of_week, days_of_week, day_of_month,
    allows_notes, task_type, sort_order, is_active
  ) VALUES (
    'النظافة الدورية لدورات المياه', 'الصالة', 'Both',
    'نفّذ الخطوات الأربع وارفق صورة إثبات في كل موعد مستقل. تنتهي المهلة بعد 20 دقيقة من بداية الساعة.',
    NULL, true, NULL, 'hourly', NULL, '{}'::integer[], NULL,
    true, 'restroom_check', v_old.sort_order, true
  ) RETURNING id INTO v_new_id;

  UPDATE public.checklist_templates
     SET is_active = false
   WHERE id = v_old.id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذّر أرشفة إصدار المهمة الساعي القديم';
  END IF;

  INSERT INTO public.restroom_hourly_task_config (id, template_id, active_from, is_active)
  VALUES (1, v_new_id, v_active_from, true);
  RETURN v_new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.initialize_restroom_hourly_task(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_restroom_hourly_task(uuid) TO authenticated;
