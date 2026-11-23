-- Forward-only correction. Do not edit the historical restroom migration;
-- a planned date is not owner confirmation that the branch is operational.
BEGIN;

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

  SELECT b.id, b.name, b.lifecycle_status
    INTO v_branch
    FROM public.branches AS b
   WHERE b.id = v_profile.branch_id;
  IF NOT FOUND
     OR v_branch.name IN ('زام الحي', 'زام البرج')
     OR NOT (
       v_branch.lifecycle_status IS NULL
       OR v_branch.lifecycle_status = ''
       OR v_branch.lifecycle_status = 'operational'
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

COMMIT;
