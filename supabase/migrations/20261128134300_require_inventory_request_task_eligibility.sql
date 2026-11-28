-- Require the existing server-side checklist eligibility rule before an
-- inventory request can be created and auto-complete an inventory task.
-- This preserves the current RPC ACL and RLS policies.
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

  -- Pick the exact template that the existing authorization function confirms
  -- for this authenticated supervisor, branch, and requested shift. Do this
  -- before inserting either the request or its checklist completion log.
  SELECT t.id
    INTO v_task_template_id
    FROM public.checklist_templates AS t
   WHERE t.category = 'مهام المشرفين'
     AND t.shift_type = p_shift_type
     AND t.task_type = 'inventory_request'
     AND t.branch_id IS NULL
     AND t.is_active IS TRUE
     AND public.can_employee_execute_checklist_template(
       t.id, v_profile.branch_id, p_shift_type
     ) IS TRUE
   ORDER BY t.sort_order
   LIMIT 1;

  IF v_task_template_id IS NULL THEN
    RAISE EXCEPTION 'لا توجد مهمة طلب جرد نشطة ومؤهلة لهذا الفرع والوردية';
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

  RETURN v_request_id;
END;
$function$;
