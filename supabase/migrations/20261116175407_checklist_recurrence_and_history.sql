-- Additive checklist versioning and history. Historic template content and logs are preserved.
-- Old system rows are archived by changing only is_active; new instructions are new template rows.

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_frequency_check;
ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'monthly', 'hourly'));

ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_task_type_check;
ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_task_type_check
  CHECK (task_type IN ('standard', 'fridge_temps', 'inventory_request', 'restroom_check'));

ALTER TABLE public.checklist_logs
  ADD COLUMN IF NOT EXISTS shift_type text;
ALTER TABLE public.checklist_logs
  DROP CONSTRAINT IF EXISTS checklist_logs_shift_type_check;
ALTER TABLE public.checklist_logs
  ADD CONSTRAINT checklist_logs_shift_type_check
  CHECK (shift_type IS NULL OR shift_type IN ('Morning', 'Evening', 'Both'));
CREATE INDEX IF NOT EXISTS checklist_logs_branch_shift_date_idx
  ON public.checklist_logs (branch_id, shift_type, execution_date DESC);

-- Permit separate morning/evening executions of a Both-shifts task while preserving legacy NULL-shift uniqueness.
ALTER TABLE public.checklist_logs
  DROP CONSTRAINT IF EXISTS one_log_per_task_day_branch;
CREATE UNIQUE INDEX IF NOT EXISTS checklist_logs_legacy_no_shift_uidx
  ON public.checklist_logs (template_id, execution_date, branch_id)
  WHERE shift_type IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS checklist_logs_shift_occurrence_uidx
  ON public.checklist_logs (template_id, execution_date, branch_id, shift_type)
  WHERE shift_type IS NOT NULL;

-- Preserve the existing inventory-request RPC while recording the selected shift.
-- Its previous ON CONFLICT target referred to the removed legacy unique constraint.
CREATE OR REPLACE FUNCTION public.create_inventory_request(
  p_supplier text,
  p_shift_type text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile record;
  v_request_id uuid;
  v_item jsonb;
  v_line_number integer := 0;
  v_product_name text;
  v_unit text;
  v_current_quantity numeric;
  v_requested_quantity numeric;
  v_urgency text;
  v_task_template_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لإنشاء طلب جرد';
  END IF;

  SELECT p.id, p.branch_id, p.role, p.status
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = (SELECT auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'إنشاء الطلب متاح للمشرفين النشطين فقط';
  END IF;
  IF v_profile.status IS DISTINCT FROM 'active'
     OR v_profile.role IS DISTINCT FROM 'Supervisor' THEN
    RAISE EXCEPTION 'إنشاء الطلب متاح للمشرفين النشطين فقط';
  END IF;
  IF v_profile.branch_id IS NULL THEN
    RAISE EXCEPTION 'يجب ربط حساب المشرف بفرع قبل إنشاء الطلب';
  END IF;
  IF p_supplier IS NULL OR p_supplier NOT IN ('المعمل', 'المستودع', 'مشتريات مباشرة') THEN
    RAISE EXCEPTION 'المورد المحدد غير صالح';
  END IF;
  IF p_shift_type IS NULL OR p_shift_type NOT IN ('Morning', 'Evening') THEN
    RAISE EXCEPTION 'الوردية المحددة غير صالحة';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'بيانات الأصناف غير صالحة';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items) < 1 OR pg_catalog.jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'يجب إضافة صنف واحد على الأقل، وبحد أقصى 50 صنفاً';
  END IF;

  INSERT INTO public.inventory_requests (branch_id, created_by, shift_type, supplier)
  VALUES (v_profile.branch_id, v_profile.id, p_shift_type, p_supplier)
  RETURNING id INTO v_request_id;

  FOR v_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_items) AS rows(value)
  LOOP
    v_line_number := v_line_number + 1;
    IF pg_catalog.jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'بيانات أحد الأصناف غير صالحة';
    END IF;

    v_product_name := NULLIF(pg_catalog.btrim(v_item ->> 'product_name'), '');
    v_unit := NULLIF(pg_catalog.btrim(v_item ->> 'unit'), '');
    v_current_quantity := NULLIF(pg_catalog.btrim(v_item ->> 'current_quantity'), '')::numeric;
    v_requested_quantity := NULLIF(pg_catalog.btrim(v_item ->> 'requested_quantity'), '')::numeric;
    v_urgency := v_item ->> 'urgency';

    IF v_product_name IS NULL OR v_unit IS NULL
       OR v_current_quantity IS NULL OR v_current_quantity < 0
       OR v_requested_quantity IS NULL OR v_requested_quantity <= 0
       OR v_urgency IS NULL OR v_urgency NOT IN ('عاجل', 'غير عاجل') THEN
      RAISE EXCEPTION 'أكمل اسم الصنف والكميات والوحدة ودرجة الاحتياج لكل سطر';
    END IF;

    INSERT INTO public.inventory_request_items (
      request_id, line_number, product_name, current_quantity,
      requested_quantity, unit, urgency
    ) VALUES (
      v_request_id, v_line_number, v_product_name, v_current_quantity,
      v_requested_quantity, v_unit, v_urgency
    );
  END LOOP;

  SELECT t.id
    INTO v_task_template_id
    FROM public.checklist_templates AS t
   WHERE t.category = 'مهام المشرفين'
     AND t.shift_type = p_shift_type
     AND t.task_type = 'inventory_request'
     AND t.branch_id IS NULL
     AND t.is_active
   ORDER BY t.sort_order
   LIMIT 1;

  IF v_task_template_id IS NOT NULL THEN
    INSERT INTO public.checklist_logs (
      template_id, branch_id, executed_by, status, notes, shift_type, execution_date
    ) VALUES (
      v_task_template_id,
      v_profile.branch_id,
      v_profile.id,
      'Completed',
      'تم إنشاء طلب جرد لدى ' || p_supplier,
      p_shift_type,
      (pg_catalog.timezone('Asia/Riyadh', now()))::date
    )
    ON CONFLICT (template_id, execution_date, branch_id, shift_type)
      WHERE shift_type IS NOT NULL
      DO NOTHING;
  END IF;

  RETURN v_request_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_inventory_request(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_request(text, text, jsonb) TO authenticated;

ALTER TABLE public.team_notes
  ADD COLUMN IF NOT EXISTS shift_type text;
ALTER TABLE public.team_notes
  DROP CONSTRAINT IF EXISTS team_notes_shift_type_check;
ALTER TABLE public.team_notes
  ADD CONSTRAINT team_notes_shift_type_check
  CHECK (shift_type IS NULL OR shift_type IN ('Morning', 'Evening', 'Both'));

-- Preserve checklist history even if an old template is deleted outside the app.
ALTER TABLE public.checklist_logs
  DROP CONSTRAINT IF EXISTS checklist_logs_template_id_fkey;
ALTER TABLE public.checklist_logs
  ADD CONSTRAINT checklist_logs_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.checklist_templates(id) ON DELETE RESTRICT;

-- One independent record for each Riyadh-local hour, with a title snapshot so the log
-- remains readable if its template is later archived or removed from the active set.
CREATE TABLE IF NOT EXISTS public.hourly_checklist_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  template_title text NOT NULL,
  template_category text NOT NULL DEFAULT 'الصالة',
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  executed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'Completed',
  notes text,
  photo_url text,
  execution_date date NOT NULL DEFAULT (pg_catalog.timezone('Asia/Riyadh', now()))::date,
  occurrence_hour smallint NOT NULL CHECK (occurrence_hour BETWEEN 0 AND 23),
  shift_type text NOT NULL CHECK (shift_type IN ('Morning', 'Evening')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hourly_checklist_logs_occurrence_uidx
  ON public.hourly_checklist_logs (template_id, branch_id, execution_date, occurrence_hour)
  WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hourly_checklist_logs_branch_date_idx
  ON public.hourly_checklist_logs (branch_id, execution_date DESC, occurrence_hour DESC);
ALTER TABLE public.hourly_checklist_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.hourly_checklist_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hourly_checklist_logs TO authenticated;

DROP POLICY IF EXISTS "Admin roles read all hourly checklist logs" ON public.hourly_checklist_logs;
CREATE POLICY "Admin roles read all hourly checklist logs" ON public.hourly_checklist_logs
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('Owner', 'Admin', 'Manager'));
DROP POLICY IF EXISTS "Supervisors read own branch hourly checklist logs" ON public.hourly_checklist_logs;
CREATE POLICY "Supervisors read own branch hourly checklist logs" ON public.hourly_checklist_logs
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'Supervisor' AND branch_id = public.current_user_branch_id());
DROP POLICY IF EXISTS "Users read own hourly checklist logs" ON public.hourly_checklist_logs;
CREATE POLICY "Users read own hourly checklist logs" ON public.hourly_checklist_logs
  FOR SELECT TO authenticated
  USING (executed_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users create own hourly checklist logs" ON public.hourly_checklist_logs;
DROP POLICY IF EXISTS "Waiters read own branch hourly checklist logs" ON public.hourly_checklist_logs;
CREATE POLICY "Waiters read own branch hourly checklist logs" ON public.hourly_checklist_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.profiles AS p
       WHERE p.id = (SELECT auth.uid())
         AND p.status = 'active'
         AND p.role = 'Waiter'
         AND p.branch_id = hourly_checklist_logs.branch_id
    )
  );

-- A waiter cannot supply identity, branch, date or hour from the browser. The RPC
-- derives them from auth.uid() and the current Riyadh-local server clock.
CREATE OR REPLACE FUNCTION public.create_hourly_checklist_log(
  p_template_id uuid,
  p_shift_type text,
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
  v_template record;
  v_main_branch_id uuid;
  v_local_now timestamp without time zone;
  v_expected_shift text;
  v_photo_url text := NULLIF(pg_catalog.btrim(p_photo_url), '');
  v_photo_prefix text := 'https://uuphgpncmiwyigtqhjmd.supabase.co/storage/v1/object/public/task-evidence/';
  v_object_name text;
  v_log_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لتسجيل جولة الحمام';
  END IF;

  SELECT p.id, p.branch_id, p.role, p.status, p.shift_type
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تسجيل الجولة متاح لموظفي الصالة النشطين فقط';
  END IF;
  IF v_profile.status IS DISTINCT FROM 'active'
     OR v_profile.role IS DISTINCT FROM 'Waiter' THEN
    RAISE EXCEPTION 'تسجيل الجولة متاح لموظفي الصالة النشطين فقط';
  END IF;

  SELECT b.id
    INTO STRICT v_main_branch_id
    FROM public.branches AS b
   WHERE b.name = 'زام الرئيسي';
  IF v_profile.branch_id IS DISTINCT FROM v_main_branch_id THEN
    RAISE EXCEPTION 'مهمة الجولة الساعية متاحة لفرع زام الرئيسي فقط';
  END IF;

  IF p_shift_type IS NULL OR p_shift_type NOT IN ('Morning', 'Evening') THEN
    RAISE EXCEPTION 'الوردية المحددة غير صالحة';
  END IF;
  v_local_now := pg_catalog.timezone('Asia/Riyadh', pg_catalog.now());
  v_expected_shift := CASE
    WHEN v_profile.shift_type IN ('Morning', 'Evening') THEN v_profile.shift_type
    ELSE CASE WHEN EXTRACT(HOUR FROM v_local_now) >= 16 THEN 'Evening' ELSE 'Morning' END
  END;
  IF p_shift_type IS DISTINCT FROM v_expected_shift THEN
    RAISE EXCEPTION 'الوردية لا تطابق وردية حسابك';
  END IF;

  SELECT t.id, t.task_title, t.category, t.task_type, t.frequency,
         t.branch_id, t.shift_type, t.is_active, t.requires_photo
    INTO v_template
    FROM public.checklist_templates AS t
   WHERE t.id = p_template_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'قالب الجولة الساعية غير نشط أو غير صالح لهذا الفرع';
  END IF;
  IF v_template.is_active IS DISTINCT FROM true
     OR v_template.task_type IS DISTINCT FROM 'restroom_check'
     OR v_template.frequency IS DISTINCT FROM 'hourly'
     OR v_template.category IS DISTINCT FROM 'الصالة'
     OR v_template.shift_type IS DISTINCT FROM 'Both'
     OR v_template.branch_id IS DISTINCT FROM v_main_branch_id
     OR v_template.requires_photo IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'قالب الجولة الساعية غير نشط أو غير صالح لهذا الفرع';
  END IF;

  IF v_photo_url IS NULL OR pg_catalog.length(v_photo_url) > 2048 THEN
    RAISE EXCEPTION 'أرفق صورة إثبات صالحة قبل تسجيل الجولة';
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
  IF p_notes IS NOT NULL AND pg_catalog.length(p_notes) > 4000 THEN
    RAISE EXCEPTION 'الملاحظات تتجاوز الحد المسموح';
  END IF;

  INSERT INTO public.hourly_checklist_logs (
    template_id, template_title, template_category, branch_id, executed_by,
    status, notes, photo_url, execution_date, occurrence_hour, shift_type
  ) VALUES (
    v_template.id, v_template.task_title, v_template.category, v_main_branch_id, v_user_id,
    'Completed', NULLIF(pg_catalog.btrim(p_notes), ''), v_photo_url,
    v_local_now::date, EXTRACT(HOUR FROM v_local_now)::smallint, p_shift_type
  )
  ON CONFLICT (template_id, branch_id, execution_date, occurrence_hour)
    WHERE template_id IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_log_id;

  IF v_log_id IS NULL THEN
    SELECT l.id
      INTO v_log_id
      FROM public.hourly_checklist_logs AS l
     WHERE l.template_id = v_template.id
       AND l.branch_id = v_main_branch_id
       AND l.execution_date = v_local_now::date
       AND l.occurrence_hour = EXTRACT(HOUR FROM v_local_now)::smallint;
  END IF;
  RETURN v_log_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_hourly_checklist_log(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_hourly_checklist_log(uuid, text, text, text) TO authenticated;

-- Keep hourly templates out of the browser-writable daily log path, including archived templates.
CREATE OR REPLACE FUNCTION public.is_hourly_checklist_template(p_template_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.checklist_templates AS t
     WHERE t.id = p_template_id AND t.frequency = 'hourly'
  );
$function$;
REVOKE ALL ON FUNCTION public.is_hourly_checklist_template(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hourly_checklist_template(uuid) TO authenticated;

-- The checklist history page already authorizes Owner, Admin, Manager, and branch-scoped Supervisor.
-- Add Manager at the same global scope already shown by that UI; staff retain own-row access only.
DROP POLICY IF EXISTS "Owner and Admin read all checklist logs" ON public.checklist_logs;
CREATE POLICY "Admin roles read all checklist logs" ON public.checklist_logs
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('Owner', 'Admin', 'Manager'));
DROP POLICY IF EXISTS "Users can create own logs" ON public.checklist_logs;
CREATE POLICY "Users can create own logs" ON public.checklist_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    executed_by = (SELECT auth.uid())
    AND branch_id = public.current_user_branch_id()
    AND NOT public.is_hourly_checklist_template(template_id)
  );
DROP POLICY IF EXISTS "Users can update own logs" ON public.checklist_logs;
CREATE POLICY "Users can update own logs" ON public.checklist_logs
  FOR UPDATE TO authenticated
  USING (executed_by = (SELECT auth.uid()) AND branch_id = public.current_user_branch_id())
  WITH CHECK (
    executed_by = (SELECT auth.uid())
    AND branch_id = public.current_user_branch_id()
    AND NOT public.is_hourly_checklist_template(template_id)
  );

-- Employees can query active templates only; template managers can still review the archive.
DROP POLICY IF EXISTS "Allow all read templates" ON public.checklist_templates;
CREATE POLICY "Users read active checklist templates" ON public.checklist_templates
  FOR SELECT TO authenticated
  USING (is_active OR public.has_admin_permission('templates'));

-- Restrict the existing all-authenticated notes read policy to intended administrative roles
-- and preserve supervisors' existing branch-context view. No note rows are changed.
DROP POLICY IF EXISTS "Owner Admin read all notes" ON public.team_notes;
CREATE POLICY "Admin roles read all team notes" ON public.team_notes
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('Owner', 'Admin', 'Manager'));
DROP POLICY IF EXISTS "Supervisors read own branch team notes" ON public.team_notes;
CREATE POLICY "Supervisors read own branch team notes" ON public.team_notes
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'Supervisor' AND branch_id = public.current_user_branch_id());

-- Version edits atomically: insert a new row and archive the old one without changing its
-- historic title, instructions, branch, schedule, or checklist log references.
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

  SELECT t.*
    INTO v_old
    FROM public.checklist_templates AS t
   WHERE t.id = p_template_id
     AND t.is_active
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'القالب غير موجود أو مؤرشف بالفعل';
  END IF;

  INSERT INTO public.checklist_templates (
    task_title, category, shift_type, instructions, branch_id, requires_photo,
    target_time, frequency, day_of_week, day_of_month, allows_notes, task_type,
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
    CASE WHEN v_payload ? 'day_of_month' THEN NULLIF(v_payload ->> 'day_of_month', '')::integer ELSE v_old.day_of_month END,
    COALESCE((v_payload ->> 'allows_notes')::boolean, v_old.allows_notes),
    COALESCE(NULLIF(v_payload ->> 'task_type', ''), v_old.task_type),
    COALESCE(NULLIF(v_payload ->> 'sort_order', '')::integer, v_old.sort_order),
    true
  ) RETURNING id INTO v_new_id;

  UPDATE public.checklist_templates
     SET is_active = false
   WHERE id = v_old.id;

  RETURN v_new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.version_checklist_template(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.version_checklist_template(uuid, jsonb) TO authenticated;

-- Riyadh-local defaults for new temperature observations; existing readings remain unchanged.
ALTER TABLE public.checklist_logs
  ALTER COLUMN execution_date SET DEFAULT (pg_catalog.timezone('Asia/Riyadh', now()))::date;
ALTER TABLE public.fridge_readings
  ALTER COLUMN reading_date SET DEFAULT (pg_catalog.timezone('Asia/Riyadh', now()))::date;

-- Archive only the specific prior system versions that are replaced below.
-- This update changes lifecycle status only; no historic template content or execution logs change.
UPDATE public.checklist_templates
   SET is_active = false
 WHERE is_active
   AND branch_id IS NULL
   AND (
     (category = 'البار' AND task_title = 'التأكد من جاهزية ماكينة الإسبريسو ومعايرة الضغط' AND shift_type = 'Morning')
     OR (category = 'البار' AND task_title = 'التنظيف الكيميائي لماكينة الإسبريسو' AND shift_type = 'Both' AND frequency = 'weekly' AND day_of_week IN (0, 1, 4))
     OR (category = 'البار' AND task_title = 'تنظيف ماكينة الإسبريسو بعد الإغلاق' AND shift_type = 'Evening')
     OR (category = 'المطبخ' AND task_title = 'تنظيف محطة العمل ومعدات المطبخ' AND shift_type = 'Evening')
     OR (category = 'المطبخ' AND task_title = 'تنظيف الجريل بمادة كيميائية معتمدة' AND shift_type = 'Evening')
     OR (category = 'الصالة' AND task_title = 'ترتيب الطاولات والكراسي قبل الفتح' AND shift_type = 'Morning')
     OR (category = 'الصالة' AND task_title = 'مراجعة قائمة الطعام المعروضة وتحديثها' AND shift_type = 'Morning')
     OR (category = 'الصالة' AND task_title = 'التأكد من نظافة دورات المياه' AND shift_type = 'Morning')
     OR (category = 'الصالة' AND task_title = 'تنظيف محطة العمل ومعدات الصالة' AND shift_type IN ('Morning', 'Evening'))
     OR (category = 'الصالة' AND task_title = 'تنظيف عميق للصالة والمعدات' AND shift_type = 'Both' AND frequency = 'weekly' AND day_of_week = 6)
     OR (category = 'الصالة' AND task_title = 'تنظيف الصالة الشامل بعد الإغلاق' AND shift_type = 'Evening')
     OR (category = 'الصالة' AND task_title = 'التأكد من إغلاق كافة الأجهزة الكهربائية' AND shift_type = 'Evening')
   );

-- Barista shift checklists and espresso-machine care.
WITH new_tasks (
  task_title, shift_type, instructions, requires_photo, allows_notes,
  task_type, frequency, day_of_week, target_time, sort_order
) AS (
  VALUES
    ('فحص جاهزية البار ودفعات اليوم', 'Morning',
     'الماكينة تعمل مسبقاً؛ تحقق من التعبئة والجاهزية. راجع دفعات البن المطلوبة لليوم بالكميات الموصى بها، الوصفات والخلطات، الجودة والصلاحية. دوّن أي مشكلة أو نقص في الملاحظات، وارفع الأعطال والنواقص للمشرف. نفّذ الجرد حسب تعليماته.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 301),
    ('معايرة الإسبريسو وتوثيق نتيجة الشوت', 'Morning',
     'عاير الإسبريسو حسب الوصفة المعتمدة. أرفق صورة يظهر فيها زمن الاستخلاص، واكتب زمن الاستخلاص ووزن الشوت بوضوح في خانة الملاحظات. أبلغ المشرف عند تعذر الوصول للجودة المطلوبة.',
     true, true, 'standard', 'daily', NULL::integer, NULL::time, 302),
    ('تجهيز أكواب وأطباق التقديم', 'Morning',
     'تحقق من نظافة وتوفر أكواب وأطباق وأدوات التقديم، ورتبها في أماكنها وارفع أي نقص للمشرف.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 303),
    ('استلام حالة البار من الوردية السابقة', 'Evening',
     'استلم حالة الماكينة والضبط والوصفات والدفعات، كميات البن والمكونات، ثلاجات المياه، النواقص والأعطال والطلبات المفتوحة. دوّن الملاحظات المهمة قبل بدء الخدمة.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 304),
    ('تسليم حالة البار إلى الوردية التالية', 'Morning',
     'قبل التسليم، أعد تعبئة ثلاجات المياه، وسلّم حالة الماكينة والمعايرة والدفعات والمخزون والطلبات المفتوحة والنواقص والأعطال لباريستا الليل.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 305),
    ('تسليم حالة البار إلى الصباح', 'Evening',
     'سلّم حالة الماكينة والمعايرة والدفعات والمخزون وثلاجات المياه والطلبات المفتوحة والنواقص والأعطال لباريستا الصباح، وسجّل ما يلزم متابعته.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 306),
    ('فحص جاهزية الميزان وشحنه', 'Morning',
     'تحقق في بداية الوردية من جاهزية الميزان ودقته وشحنه. أبلغ المشرف إذا احتاج إلى شحن أو صيانة.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 308),
    ('فحص جاهزية الميزان وشحنه', 'Evening',
     'تحقق في بداية الوردية من جاهزية الميزان ودقته وشحنه. أبلغ المشرف إذا احتاج إلى شحن أو صيانة.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 309),
    ('تعبئة ثلاجات المياه أثناء الوردية وقبل التسليم', 'Morning',
     'تابع ثلاجات المياه خلال الوردية، وأعد تعبئتها عند الحاجة وقبل التسليم. دوّن أي نقص أو خلل وارفعه للمشرف.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 310),
    ('تعبئة ثلاجات المياه أثناء الوردية وقبل التسليم', 'Evening',
     'تابع ثلاجات المياه خلال الوردية، وأعد تعبئتها عند الحاجة وقبل التسليم. دوّن أي نقص أو خلل وارفعه للمشرف.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 311),
    ('مراجعة جودة وسرعة طلبات البار', 'Morning',
     'طابق المشروبات مع الوصفات والكميات والتقديم المعتمد، وحافظ على سرعة ودقة الطلبات. سجّل تكرار الخطأ أو التأخير وارفعه للمشرف.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 312),
    ('مراجعة جودة وسرعة طلبات البار', 'Evening',
     'طابق المشروبات مع الوصفات والكميات والتقديم المعتمد، وحافظ على سرعة ودقة الطلبات. سجّل تكرار الخطأ أو التأخير وارفعه للمشرف.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 313),
    ('جرد البار حسب تعليمات المشرف', 'Morning',
     'نفّذ الجرد أو العدّ الذي يطلبه المشرف بالكميات والوحدات المعتمدة، وبلّغه بالنواقص. لا ترسل طلب شراء من حساب الموظف.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 314),
    ('جرد البار حسب تعليمات المشرف', 'Evening',
     'نفّذ الجرد أو العدّ الذي يطلبه المشرف بالكميات والوحدات المعتمدة، وبلّغه بالنواقص. لا ترسل طلب شراء من حساب الموظف.',
     false, true, 'standard', 'daily', NULL::integer, NULL::time, 315),
    ('التنظيف الكيميائي لماكينة الإسبريسو', 'Both',
     'تنظيف كيميائي في هذا اليوم فقط. استخدم المادة والجرعة والطريقة المحددة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة والأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.',
     false, true, 'standard', 'weekly', 0, NULL::time, 320),
    ('التنظيف الكيميائي لماكينة الإسبريسو', 'Both',
     'تنظيف كيميائي في هذا اليوم فقط. استخدم المادة والجرعة والطريقة المحددة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة والأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.',
     false, true, 'standard', 'weekly', 2, NULL::time, 321),
    ('التنظيف الكيميائي لماكينة الإسبريسو', 'Both',
     'تنظيف كيميائي في هذا اليوم فقط. استخدم المادة والجرعة والطريقة المحددة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة والأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.',
     false, true, 'standard', 'weekly', 4, NULL::time, 322)
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  target_time, frequency, day_of_week, allows_notes, task_type, sort_order, is_active
)
SELECT nt.task_title, 'البار', nt.shift_type, nt.instructions, NULL, nt.requires_photo,
       nt.target_time, nt.frequency, nt.day_of_week, nt.allows_notes, nt.task_type,
       nt.sort_order, true
FROM new_tasks AS nt
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active
     AND existing.task_title = nt.task_title
     AND existing.category = 'البار'
     AND existing.shift_type = nt.shift_type
     AND existing.branch_id IS NULL
     AND existing.task_type = nt.task_type
     AND existing.frequency = nt.frequency
     AND existing.day_of_week IS NOT DISTINCT FROM nt.day_of_week
     AND existing.target_time IS NOT DISTINCT FROM nt.target_time
);

-- On the four non-chemical days, both shifts clean the espresso machine and steam wand with water and a brush.
WITH brush_care (day_of_week, sort_order) AS (
  VALUES (1, 323), (3, 324), (5, 325), (6, 326)
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, day_of_week, allows_notes, task_type, sort_order, is_active
)
SELECT
  'تنظيف ماكينة الإسبريسو وعصا البخار بالماء والفرشاة', 'البار', 'Both',
  'في هذا اليوم غير الكيميائي: نظّف الأجزاء المحددة من ماكينة الإسبريسو وعصا البخار بالماء والفرشاة المخصصة وفق تعليمات الشركة المصنّعة. لا تستخدم مادة كيميائية في هذا الإجراء، وأبلغ المشرف عن أي خلل.',
  NULL, false, 'weekly', bc.day_of_week, true, 'standard', bc.sort_order, true
FROM brush_care AS bc
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active
     AND existing.task_title = 'تنظيف ماكينة الإسبريسو وعصا البخار بالماء والفرشاة'
     AND existing.category = 'البار'
     AND existing.shift_type = 'Both'
     AND existing.branch_id IS NULL
     AND existing.task_type = 'standard'
     AND existing.frequency = 'weekly'
     AND existing.day_of_week = bc.day_of_week
);

-- Workstation/equipment cleaning is daily in both bar shifts; Saturday deep cleaning is explicit.
WITH new_bar_care (task_title, shift_type, instructions, frequency, day_of_week, sort_order) AS (
  VALUES
    ('تنظيف محطة البار والمعدات', 'Morning', 'نظّف وعقّم سطح العمل والأدوات والمعدات المستخدمة، وأعد ترتيب محطة البار قبل استقبال الطلبات. دوّن أي عطل وارفعه للمشرف.', 'daily', NULL::integer, 316),
    ('تنظيف محطة البار والمعدات', 'Evening', 'نظّف وعقّم سطح العمل والأدوات والمعدات المستخدمة، وأعد ترتيب محطة البار خلال الوردية وبعد الخدمة. دوّن أي عطل وارفعه للمشرف.', 'daily', NULL::integer, 317),
    ('تنظيف عميق للبار والمعدات', 'Both', 'كل يوم سبت: نفّذ تنظيفاً عميقاً لمحطة البار والمعدات، بما في ذلك الأسطح والزوايا والأجزاء القابلة للتنظيف وفق تعليمات الشركة المصنّعة. لا تخلط مواد التنظيف.', 'weekly', 6, 318)
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, day_of_week, allows_notes, task_type, sort_order, is_active
)
SELECT nt.task_title, 'البار', nt.shift_type, nt.instructions, NULL, false,
       nt.frequency, nt.day_of_week, true, 'standard', nt.sort_order, true
FROM new_bar_care AS nt
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active AND existing.task_title = nt.task_title
     AND existing.category = 'البار' AND existing.shift_type = nt.shift_type
     AND existing.branch_id IS NULL AND existing.task_type = 'standard'
     AND existing.frequency = nt.frequency
     AND existing.day_of_week IS NOT DISTINCT FROM nt.day_of_week
);

-- Evening kitchen checklist: preserve existing morning templates and add reviewed evening versions/tasks.
WITH new_tasks (
  task_title, instructions, requires_photo, allows_notes, frequency, day_of_week, sort_order
) AS (
  VALUES
    ('استلام حالة المطبخ وتجهيز الوردية',
     'استلم حالة المطبخ والنواقص والأعطال والمكونات المحضرة من الوردية السابقة. وزّع المحطات حسب عدد الفريق، وجهّز المعدات والمكونات قبل ضغط الطلبات.',
     false, true, 'daily', NULL::integer, 401),
    ('فحص جودة وصلاحية المخزون والخلطات وحرارة التخزين',
     'افحص جودة وصلاحية الحلويات والمخزون والخلطات، وتحقق من درجات حرارة التخزين. اعزل أي منتج غير مطابق ودوّن المشكلة والإجراء وأبلغ المشرف.',
     false, true, 'daily', NULL::integer, 402),
    ('توثيق المشاكل وتجهيز قائمة النواقص و86',
     'دوّن الأعطال والمشاكل والكميات الناقصة، وحدّث قائمة 86 أو الأصناف غير المتاحة وارفعها للمشرف قبل نفادها.',
     false, true, 'daily', NULL::integer, 403),
    ('تنفيذ الجرد حسب تعليمات المشرف',
     'نفّذ الجرد أو طلب النواقص حسب توجيه المشرف والوحدات المحددة، وأبلغه بالنتيجة. لا تعتمد شراءً خارج الصلاحية.',
     false, true, 'daily', NULL::integer, 404),
    ('سلامة الغذاء وممارسات GMP',
     'اغسل يديك في الأوقات المطلوبة، ولا تستخدم الهاتف أثناء العمل. لا تخلط ألواح التقطيع أو السكاكين بين المواد، وافصل النيء عن الجاهز واتبع إجراءات سلامة الغذاء.',
     false, true, 'daily', NULL::integer, 405),
    ('مطابقة التوريدات وتخزينها خلال 20 دقيقة',
     'طابق الصنف والكمية والصلاحية وسلامة العبوة مع الفاتورة أو نموذج الاستلام، وأرفق صورة للنموذج والتوريد. أدخل المواد إلى التخزين خلال 20 دقيقة وفق FIFO/FEFO، وسجّل أي فرق للمشرف.',
     true, true, 'daily', NULL::integer, 406),
    ('جودة الطلبات وسرعة دوران المخزون وتقليل الهدر',
     'طابق جودة الطلبات ودقتها وسرعتها، ودوّر المخزون حسب FIFO/FEFO، واستخدم الكميات المحضرة قبل فتح دفعات جديدة لتقليل الهدر. سجّل الهدر غير المعتاد.',
     false, true, 'daily', NULL::integer, 407),
    ('تنظيف محطة العمل وأسطح وأرضيات ومعدات المطبخ',
     'نظّف وعقّم أسطح التحضير والأرضيات والمعدات المستخدمة يومياً وفق تعليمات مواد التنظيف وسلامة الغذاء. أبلغ المشرف فوراً عن أي عطل أو خطر.',
     false, true, 'daily', NULL::integer, 408),
    ('تنظيف الجريل بمادة كيميائية معتمدة',
     'لوردية المساء فقط: استخدم منظف الجريل المعتمد وبالطريقة والجرعة المحددة من الشركة المصنّعة، مع معدات الوقاية. أزل بقايا المادة تماماً قبل ملامسة الطعام.',
     false, true, 'daily', NULL::integer, 409),
    ('تسليم حالة المطبخ للوردية الصباحية',
     'قبل التسليم، دوّن حالة المطبخ والمكونات المحضرة والمخزون والنواقص وقائمة 86 والأعطال والمشاكل وطلبات المتابعة، وسلّمها للمطبخ الصباحي والمشرف.',
     false, true, 'daily', NULL::integer, 410)
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT nt.task_title, 'المطبخ', 'Evening', nt.instructions, NULL, nt.requires_photo,
       nt.frequency, nt.allows_notes, 'standard', nt.sort_order, true
FROM new_tasks AS nt
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active
     AND existing.task_title = nt.task_title
     AND existing.category = 'المطبخ'
     AND existing.shift_type = 'Evening'
     AND existing.branch_id IS NULL
     AND existing.task_type = 'standard'
     AND existing.frequency = nt.frequency
     AND existing.day_of_week IS NOT DISTINCT FROM nt.day_of_week
);

-- Keep existing morning kitchen tasks; add the explicitly agreed daily station cleaning and Saturday deep clean.
WITH kitchen_care (task_title, shift_type, instructions, frequency, day_of_week, sort_order) AS (
  VALUES
    ('تنظيف محطة العمل ومعدات المطبخ', 'Morning', 'نظّف وعقّم أسطح التحضير والمعدات المستخدمة قبل وأثناء الوردية وفق تعليمات مواد التنظيف وسلامة الغذاء. أبلغ المشرف فوراً عن أي عطل أو خطر.', 'daily', NULL::integer, 411),
    ('تنظيف عميق للمطبخ والمعدات', 'Both', 'كل يوم سبت: نفّذ تنظيفاً عميقاً للمطبخ والمعدات، بما يشمل الأسطح والأرضيات والحواف والزوايا والمناطق أسفل المعدات، مع الالتزام بتعليمات مواد التنظيف وسلامة الغذاء.', 'weekly', 6, 412)
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, day_of_week, allows_notes, task_type, sort_order, is_active
)
SELECT kc.task_title, 'المطبخ', kc.shift_type, kc.instructions, NULL, false,
       kc.frequency, kc.day_of_week, true, 'standard', kc.sort_order, true
FROM kitchen_care AS kc
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active AND existing.task_title = kc.task_title
     AND existing.category = 'المطبخ' AND existing.shift_type = kc.shift_type
     AND existing.branch_id IS NULL AND existing.task_type = 'standard'
     AND existing.frequency = kc.frequency
     AND existing.day_of_week IS NOT DISTINCT FROM kc.day_of_week
);

-- Waiter morning tasks are explicitly branch-scoped and never seeded for ZAM Al-Manah.
WITH new_tasks (task_title, instructions, requires_photo, allows_notes, sort_order) AS (
  VALUES
    ('ترتيب الطاولات والكراسي قبل الفتح',
     'نظّف الطاولات والكراسي والأرجل بمنظف وخرق زرقاء. اكنس وامسح الداخل. إذا كانت الجلسات الخارجية مفتوحة فنظّفها، واكنس وامسح الخارج حتى إن كانت الجلسات مغلقة. اضبط المكيف على 22° ولا تغيّره إلا بطلب المشرف أو العميل. افتح الأنوار حسب تعليمات المشرف واسأله إذا لم تتضح، وشغّل البخور.',
     false, true, 501),
    ('مراجعة قائمة الطعام المعروضة وتحديثها',
     'تأكد من أن القائمة المعروضة واضحة ومطابقة للأصناف المتاحة، وارفع أي صنف ناقص أو غير متاح للمشرف لتحديث قائمة 86.',
     false, true, 502),
    ('تجهيز الصالة ومرافقها قبل استقبال العملاء',
     'تفقد نظافة الصالة والممرات والطاولات والكراسي، وارفع الأعطال أو النواقص للمشرف ودوّنها.',
     false, true, 503),
    ('إقفال وتنظيف الصالة نهاية الوردية الصباحية',
     'نظّف ورتّب منطقة الخدمة عند إغلاق الوردية، وسلّم حالة الصالة والأعطال والنواقص والطلبات المفتوحة للمشرف والوردية التالية.',
     false, true, 504)
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT nt.task_title, 'الصالة', 'Morning', nt.instructions, b.id, nt.requires_photo,
       'daily', nt.allows_notes, 'standard', nt.sort_order, true
FROM public.branches AS b
CROSS JOIN new_tasks AS nt
WHERE b.name <> 'زام المنح'
  AND NOT EXISTS (
    SELECT 1 FROM public.checklist_templates AS existing
     WHERE existing.is_active
       AND existing.task_title = nt.task_title
       AND existing.category = 'الصالة'
       AND existing.shift_type = 'Morning'
       AND existing.branch_id = b.id
       AND existing.task_type = 'standard'
       AND existing.frequency = 'daily'
  );

-- Restroom-specific morning tasks are available only at branches that actually have a restroom.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT
  'التأكد من نظافة دورات المياه', 'الصالة', 'Morning',
  'نظّف دورة المياه وتحقق من نظافة المغسلة والمرايا والأرضية والأسطح وتوفر الصابون والمناديل. أرفق صورة بعد التنظيف، ودوّن أي عطل أو نقص وارفعه للمشرف.',
  b.id, true, 'daily', true, 'standard', 505, true
FROM public.branches AS b
WHERE b.name NOT IN ('زام الحي', 'زام المنح')
  AND NOT EXISTS (
    SELECT 1 FROM public.checklist_templates AS existing
     WHERE existing.is_active
       AND existing.task_title = 'التأكد من نظافة دورات المياه'
       AND existing.category = 'الصالة'
       AND existing.shift_type = 'Morning'
       AND existing.branch_id = b.id
       AND existing.task_type = 'standard'
  );

-- The lounge daily station task is scoped to branches and shifts; Al-Manah has evening only.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT
  'تنظيف محطة العمل ومعدات الصالة', 'الصالة', desired.shift_type,
  desired.instructions, b.id, false, 'daily', true, 'standard', desired.sort_order, true
FROM public.branches AS b
CROSS JOIN LATERAL (
  VALUES
    ('Morning'::text, 'نظّف وعقّم محطات الخدمة والمعدات والأسطح المستخدمة، وأعد ترتيبها قبل استقبال الضيوف. استخدم الخرق الزرقاء لتنظيف الطاولات والكراسي وأرجلها.', 510),
    ('Evening'::text, 'نظّف وعقّم محطات الخدمة والمعدات والأسطح المستخدمة بعد الخدمة، وأعد ترتيبها. دوّن أي عطل وارفعه للمشرف.', 511)
) AS desired(shift_type, instructions, sort_order)
WHERE NOT (b.name = 'زام المنح' AND desired.shift_type = 'Morning')
  AND NOT EXISTS (
    SELECT 1 FROM public.checklist_templates AS existing
     WHERE existing.is_active
       AND existing.task_title = 'تنظيف محطة العمل ومعدات الصالة'
       AND existing.category = 'الصالة'
       AND existing.shift_type = desired.shift_type
       AND existing.branch_id = b.id
       AND existing.task_type = 'standard'
       AND existing.frequency = 'daily'
  );

-- A table is cleaned immediately after each customer leaves; no photo is requested.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT
  'تنظيف الطاولة فور مغادرة العميل', 'الصالة',
  CASE WHEN b.name = 'زام المنح' THEN 'Evening' ELSE 'Both' END,
  'نظّف الطاولة فور مغادرة العميل وأعد ترتيبها للضيف التالي. لا حاجة إلى صورة. بلّغ المشرف عن أي تلف أو نقص.',
  b.id, false, 'daily', true, 'standard', 512, true
FROM public.branches AS b
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active
     AND existing.task_title = 'تنظيف الطاولة فور مغادرة العميل'
     AND existing.category = 'الصالة'
     AND existing.branch_id = b.id
     AND existing.task_type = 'standard'
     AND existing.frequency = 'daily'
);

-- Light exterior seating one hour before local sunset; branch-specific evening assignment.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT
  'تشغيل إنارة الجلسات قبل الغروب المحلي بساعة', 'الصالة', 'Evening',
  'شغّل إنارة الجلسات الخارجية قبل الغروب المحلي بساعة. اتبع تعليمات المشرف بشأن الأنوار الداخلية، واسأله إذا لم تكن التعليمات واضحة.',
  b.id, false, 'daily', true, 'standard', 513, true
FROM public.branches AS b
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active
     AND existing.task_title = 'تشغيل إنارة الجلسات قبل الغروب المحلي بساعة'
     AND existing.category = 'الصالة'
     AND existing.shift_type = 'Evening'
     AND existing.branch_id = b.id
     AND existing.task_type = 'standard'
     AND existing.frequency = 'daily'
);

-- Evening close instructions differ for ZAM Al-Hay so it has no restroom duty.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT
  'تنظيف الصالة الشامل بعد الإغلاق', 'الصالة', 'Evening',
  CASE WHEN b.name = 'زام الحي'
       THEN 'نظّف الطاولات والكراسي ومحطات الخدمة والأرضيات والجلسات الخارجية، وأعد ترتيب المكان وأطفئ الأجهزة غير اللازمة فقط. لا توجد مهام دورة مياه لهذا الفرع. ارفع الأعطال والنواقص للمشرف.'
       ELSE 'نظّف الطاولات والكراسي ومحطات الخدمة والأرضيات والجلسات الخارجية ودورة المياه، وأعد ترتيب المكان وأطفئ الأجهزة غير اللازمة فقط. ارفع الأعطال والنواقص للمشرف.'
  END,
  b.id, false, 'daily', true, 'standard', 514, true
FROM public.branches AS b
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active
     AND existing.task_title = 'تنظيف الصالة الشامل بعد الإغلاق'
     AND existing.category = 'الصالة'
     AND existing.shift_type = 'Evening'
     AND existing.branch_id = b.id
     AND existing.task_type = 'standard'
     AND existing.frequency = 'daily'
);

-- Weekly Saturday deep clean is retained for every lounge shift except that Al-Manah has evening only.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, day_of_week, allows_notes, task_type, sort_order, is_active
)
SELECT
  'تنظيف عميق للصالة والمعدات', 'الصالة',
  CASE WHEN b.name = 'زام المنح' THEN 'Evening' ELSE 'Both' END,
  'كل يوم سبت: نظّف أسفل وخلف الطاولات والكراسي ومحطات الخدمة والحواف والزوايا والأرضيات والمعدات المستخدمة. أعد ترتيب الأثاث وتحقق من سلامة المكان.',
  b.id, false, 'weekly', 6, true, 'standard', 515, true
FROM public.branches AS b
WHERE NOT EXISTS (
  SELECT 1 FROM public.checklist_templates AS existing
   WHERE existing.is_active
     AND existing.task_title = 'تنظيف عميق للصالة والمعدات'
     AND existing.category = 'الصالة'
     AND existing.branch_id = b.id
     AND existing.task_type = 'standard'
     AND existing.frequency = 'weekly'
     AND existing.day_of_week = 6
);

-- Hourly restroom cleaning and timed administration-restroom checks at ZAM Main only.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  frequency, allows_notes, task_type, sort_order, is_active
)
SELECT
  'تنظيف وفحص دورة المياه كل ساعة', 'الصالة', 'Both',
  'نفّذ جولة تنظيف وفحص مرة واحدة في كل ساعة، وأرفق صورة بعد كل جولة. سجّل الملاحظات أو النواقص. هذا التكليف لفرع زام الرئيسي فقط.',
  b.id, true, 'hourly', true, 'restroom_check', 520, true
FROM public.branches AS b
WHERE b.name = 'زام الرئيسي'
  AND NOT EXISTS (
    SELECT 1 FROM public.checklist_templates AS existing
     WHERE existing.is_active
       AND existing.task_title = 'تنظيف وفحص دورة المياه كل ساعة'
       AND existing.category = 'الصالة'
       AND existing.shift_type = 'Both'
       AND existing.branch_id = b.id
       AND existing.task_type = 'restroom_check'
       AND existing.frequency = 'hourly'
  );

INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  target_time, frequency, allows_notes, task_type, sort_order, is_active
)
SELECT desired.task_title, 'الصالة', 'Morning', desired.instructions, b.id, true,
       desired.target_time, 'daily', true, 'restroom_check', desired.sort_order, true
FROM public.branches AS b
CROSS JOIN LATERAL (
  VALUES
    ('تنظيف دورة مياه الإدارة — 09:00'::text,
     'نفّذ تنظيف وفحص دورة مياه الإدارة عند الساعة 09:00 صباحاً، وأرفق صورة بعد التنفيذ. سجّل أي نقص أو عطل وارفعه للمشرف.',
     '09:00'::time, 521),
    ('تنظيف دورة مياه الإدارة — 12:00'::text,
     'نفّذ تنظيف وفحص دورة مياه الإدارة عند الساعة 12:00 ظهراً، وأرفق صورة بعد التنفيذ. سجّل أي نقص أو عطل وارفعه للمشرف.',
     '12:00'::time, 522)
) AS desired(task_title, instructions, target_time, sort_order)
WHERE b.name = 'زام الرئيسي'
  AND NOT EXISTS (
    SELECT 1 FROM public.checklist_templates AS existing
     WHERE existing.is_active
       AND existing.task_title = desired.task_title
       AND existing.category = 'الصالة'
       AND existing.shift_type = 'Morning'
       AND existing.branch_id = b.id
       AND existing.target_time = desired.target_time
       AND existing.task_type = 'restroom_check'
  );

-- Keep calendar and PostgREST metadata in sync after the additive schema change.
NOTIFY pgrst, 'reload schema';
