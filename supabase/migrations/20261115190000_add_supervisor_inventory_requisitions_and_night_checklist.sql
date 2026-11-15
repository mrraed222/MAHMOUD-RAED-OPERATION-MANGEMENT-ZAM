-- Add a branch-scoped supervisor requisition workflow and the separate evening supervisor checklist.
-- Existing checklist templates, checklist logs, fridge readings, and account assignments are preserved.

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_shift_type_check;
ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_shift_type_check
  CHECK (shift_type IN ('Morning', 'Evening', 'Both'));
ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_task_type_check;
ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_task_type_check
  CHECK (task_type IN ('standard', 'fridge_temps', 'inventory_request'));

-- Tag new readings by shift; old readings stay NULL and are not relabeled.
ALTER TABLE public.fridge_readings
  ADD COLUMN IF NOT EXISTS shift_type text;
ALTER TABLE public.fridge_readings
  DROP CONSTRAINT IF EXISTS fridge_readings_shift_type_check;
ALTER TABLE public.fridge_readings
  ADD CONSTRAINT fridge_readings_shift_type_check
  CHECK (shift_type IS NULL OR shift_type IN ('Morning', 'Evening'));

CREATE TABLE IF NOT EXISTS public.inventory_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  shift_type text NOT NULL CHECK (shift_type IN ('Morning', 'Evening')),
  supplier text NOT NULL CHECK (supplier IN ('المعمل', 'المستودع', 'مشتريات مباشرة')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.inventory_requests(id) ON DELETE CASCADE,
  line_number smallint NOT NULL CHECK (line_number > 0),
  product_name text NOT NULL CHECK (length(btrim(product_name)) > 0),
  current_quantity numeric NOT NULL CHECK (current_quantity >= 0),
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  unit text NOT NULL CHECK (length(btrim(unit)) > 0),
  urgency text NOT NULL CHECK (urgency IN ('عاجل', 'غير عاجل')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, line_number)
);

CREATE INDEX IF NOT EXISTS inventory_requests_branch_created_idx
  ON public.inventory_requests (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_request_items_request_idx
  ON public.inventory_request_items (request_id, line_number);

ALTER TABLE public.inventory_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_requests_read ON public.inventory_requests;
CREATE POLICY inventory_requests_read ON public.inventory_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND (
          p.role IN ('Owner', 'Admin', 'Manager')
          OR (p.role = 'Supervisor' AND p.branch_id = inventory_requests.branch_id)
        )
    )
  );

DROP POLICY IF EXISTS inventory_request_items_read ON public.inventory_request_items;
CREATE POLICY inventory_request_items_read ON public.inventory_request_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.inventory_requests AS r
      WHERE r.id = inventory_request_items.request_id
    )
  );

REVOKE ALL PRIVILEGES ON public.inventory_requests, public.inventory_request_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_requests, public.inventory_request_items TO authenticated;

-- One RPC keeps a request header and all lines atomic, and completes the matching supervisor task.
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لإنشاء طلب جرد';
  END IF;

  SELECT p.id, p.branch_id, p.role, p.status
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = auth.uid();

  IF NOT FOUND OR v_profile.status <> 'active' OR v_profile.role <> 'Supervisor' THEN
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
   ORDER BY t.sort_order
   LIMIT 1;

  IF v_task_template_id IS NOT NULL THEN
    INSERT INTO public.checklist_logs (template_id, branch_id, executed_by, status, notes)
    VALUES (
      v_task_template_id,
      v_profile.branch_id,
      v_profile.id,
      'Completed',
      'تم إنشاء طلب جرد لدى ' || p_supplier
    )
    ON CONFLICT (template_id, execution_date, branch_id) DO NOTHING;
  END IF;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_inventory_request(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_request(text, text, jsonb) TO authenticated;

-- Night supervisor tasks from the approved editable workbook; morning templates are untouched.
WITH night_tasks (sort_order, task_title, phase, instructions, target_time, requires_photo, task_type) AS (
  VALUES
    (1,  'استلام الشفت من المشرف السابق', '16:00 — الاستلام', 'استلم ملخص المبيعات والنقد إن وجد، النواقص والسولد أوت، الشكاوى، الهدر، الأعطال، الطلبات المعلقة والمهام غير المكتملة. سجّل المستلم والوقت.', '16:00'::time, false, 'standard'),
    (2,  'الحضور والهندام وتوزيع المسؤوليات', '16:00–16:15', 'تحقق من حضور الطاقم والزي والبطاقات، عيّن مسؤول البار والمطبخ والصالة والمرافق، وحدد بديلاً عند الغياب.', '16:00'::time, false, 'standard'),
    (3,  'جولة بداية الشفت على المحطات والمرافق', '16:00–16:30', 'افحص البار والمطبخ والصالة ودورات المياه والجلسات والكاشير؛ سجّل النواقص أو النظافة غير المقبولة قبل ضغط المساء.', '16:00'::time, false, 'standard'),
    (4,  'النظام والكاشير وتطبيقات التوصيل', 'بعد الاستلام مباشرة', 'تأكد أن نقاط البيع والتطبيقات تعمل، وأن الأصناف غير المتاحة محدثة كسولد أوت، وأن الطلبات الواردة تظهر بشكل صحيح.', NULL::time, false, 'standard'),
    (5,  'اجتماع سريع وأهداف الشفت والعروض', 'قبل ذروة المساء', 'وضّح هدف المبيعات والكاشير، المنتجات والعروض، قائمة البوش، وأي تعليمات خاصة أو بدائل للأصناف الناقصة.', NULL::time, false, 'standard'),
    (6,  'جاهزية البار ومعايرة الإسبريسو', 'قبل الخدمة / عند الاستلام', 'تحقق من جاهزية الماكينة والأدوات، وتوفر الحبوب والحليب والمكونات، ونظافة أدوات التحضير؛ سجّل إعداد الشوت عند الحاجة.', NULL::time, false, 'standard'),
    (7,  'قراءة حرارة كل الثلاجات والفريزرات', 'بداية الشفت ثم قبل التسليم', 'سجّل قراءة كل وحدة في سجل النظام لهذه الوردية، وأبلغ عن القراءة غير الطبيعية واتبع إجراء التصحيح أو النقل المعتمد. لا تترك وحدة بلا قراءة.', '16:00'::time, false, 'fridge_temps'),
    (8,  'سلامة وتجهيز المطبخ', 'بداية الشفت', 'تحقق من نظافة أسطح التحضير والأدوات، وسلامة التخزين والملصقات والتواريخ، وفصل المواد حسب إجراءات الفرع.', NULL::time, false, 'standard'),
    (9,  'نظافة الصالة والمرافق ودورات المياه', 'بداية الشفت وخلاله', 'ابدأ بحالة نظيفة ومجهزة، وتأكد من توفر الصابون والمناديل وأدوات التنظيف، وسجّل أي نقص أو مشكلة صيانة.', NULL::time, false, 'standard'),
    (10, 'جدولة البريكات وتغطية الخدمة', 'خلال الشفت', 'حدّد أوقات البريكات بحيث لا يخرج أكثر من موظف في الوقت نفسه، مع بقاء تغطية البار والمطبخ والصالة.', NULL::time, false, 'standard'),
    (11, 'متابعة الأداء وجودة الطلبات وسرعة الخدمة', 'أثناء الخدمة / الذروة', 'تابع الأهداف وتوزيع الأدوار، وطابق الطلبات والمكونات والتقديم، وسجّل الشكاوى أو الإجراء المتخذ والمسؤول والوقت.', NULL::time, false, 'standard'),
    (12, 'مراجعة التشيك ليست على أرض الواقع', 'خلال الشفت', 'تحقق من تنفيذ البنود عملياً، وصحح أي تأشير غير مطابق، وسجّل المهمة غير المكتملة واسم المسؤول وموعد الإغلاق.', NULL::time, false, 'standard'),
    (13, 'جولات نظافة المرافق أثناء التشغيل', 'بداية الشفت وبعد الذروة وقبل الإغلاق', 'افحص الطاولات والأرضيات ودورات المياه والمغاسل وسلال النفايات في الجولات الثلاث؛ يمكن اعتماد جولة كل ساعة إذا ناسبت حركة الفرع. سجّل النقص أو الصيانة.', NULL::time, false, 'standard'),
    (14, 'إعادة تعبئة المحطات والمواد', 'بعد الذروة وعند الحاجة', 'أعد تعبئة محطات البار والمطبخ والفاترينة والكاشير، وارفع النواقص للمشرف قبل نفاد المخزون؛ حدّث السولد أوت عند الحاجة.', NULL::time, false, 'standard'),
    (15, 'جرد البار', 'يومياً قبل موعد طلب المورد', 'عدّ البن والحليب والشرابات والمكونات والمواد الاستهلاكية الخاصة بالبار بالوحدة المتفق عليها، وسجّل الكمية الحالية في صفحة الجرد والطلبيات.', NULL::time, false, 'standard'),
    (16, 'جرد المطبخ والمواد الغذائية والتغليف', 'يومياً قبل موعد طلب المورد', 'عدّ الأصناف والمواد ومستلزمات التغليف؛ سجّل الكمية الحالية والوحدة والصلاحية أو النواقص في صفحة الجرد والطلبيات.', NULL::time, false, 'standard'),
    (17, 'جرد مستلزمات النظافة والضيافة', 'يومياً ليلاً', 'احصر المناديل والصابون وأكياس النفايات ومواد التنظيف والمواد الاستهلاكية الخاصة بالصالة؛ ارفع النقص في صفحة الجرد والطلبيات.', NULL::time, false, 'standard'),
    (18, 'مراجعة الفروقات وتجميع طلب المورد', 'بعد استلام الجرد', 'قارن العدّ الفعلي برصيد النظام وحد الطلب أو الكمية المستهدفة. راجع اختلاف الوحدة والصلاحية والاستهلاك غير المعتاد وكمية الطلب قبل إرساله.', NULL::time, false, 'standard'),
    (19, 'إرسال الطلب اليومي وحفظ التأكيد', '00:00 — موعد طلب الوردية الليلية', 'سجّل الطلب في صفحة الجرد والطلبيات، واحتفظ برقم أو تأكيد الطلب وموعد التسليم المتوقع. لا تعتمد شراءً خارج صلاحيتك؛ صعّد للمخول عند الحاجة.', '00:00'::time, false, 'inventory_request'),
    (20, 'مراجعة وتوثيق الهدر اليومي', 'خلال الشفت وقبل الإغلاق', 'تحقق من تسجيل الصنف والكمية والوحدة وسبب الهدر والإجراء التصحيحي، وراجع الهدر غير المعتاد قبل إغلاق التقرير.', NULL::time, false, 'standard'),
    (21, 'تفريغ وتنظيف صواني القطارة', 'قبل إغلاق البار', 'فرّغ الصواني ونظفها وأعدها إلى مكانها؛ تحقّق من عدم وجود بقايا أو روائح.', NULL::time, false, 'standard'),
    (22, 'تنظيف ماكينة الإسبريسو بعد الإغلاق', 'بعد آخر طلب / إغلاق البار', 'نفّذ تنظيف الماكينة والغسيل العكسي وعصا البخار والأدوات وفق تعليمات الجهاز والفرع، وأرفق صورة الإثبات.', NULL::time, true, 'standard'),
    (23, 'مراجعة صلاحية الحليب والمنتجات الطازجة', 'قبل التسليم', 'افحص التاريخ والوسم وطريقة الحفظ؛ اعزل المنتهي أو المشكوك فيه واتبع الإجراء، وأرفق صورة الإثبات.', NULL::time, true, 'standard'),
    (24, 'تخزين المكونات المتبقية وتاريخها', 'قبل إغلاق المطبخ', 'غطِّ المكونات واحفظها في المكان والحرارة المحددين، وضع بطاقة تعريف وتاريخ حسب إجراء الفرع، ولا تترك طعاماً مكشوفاً. أرفق صورة الإثبات.', NULL::time, true, 'standard'),
    (25, 'تنظيف أسطح التحضير والأدوات', 'قبل إغلاق المطبخ', 'نظف وعقّم الأسطح والسكاكين والأدوات وفق الإجراء، وافصل النظيف عن المستخدم.', NULL::time, false, 'standard'),
    (26, 'تنظيف الصالة والمرافق بعد الإغلاق', 'قبل الإغلاق', 'نظف الطاولات والكراسي والأرضيات ودورات المياه والجلسات وسلال النفايات؛ أرفق صورة الإثبات.', NULL::time, true, 'standard'),
    (27, 'إيقاف الأجهزة غير اللازمة وفحص السلامة', 'إغلاق الفرع', 'أطفئ الأجهزة الكهربائية غير اللازمة فقط، واترك الثلاجات والفريزرات ومعدات التبريد الضرورية موصولة. افحص الغاز والمياه والأبواب والإنذار إن كان ضمن إجراء الفرع.', NULL::time, false, 'standard'),
    (28, 'مطابقة وإقفال النقد والكاشير', 'قبل مغادرة الشفت', 'طابق درج النقد ووسائل الدفع مع تقرير نقطة البيع، وثّق الفروقات حسب إجراء الشركة، واحفظ التسليم أو الإيداع لدى المسؤول.', NULL::time, false, 'standard'),
    (29, 'تسليم حالة الفرع للوردية التالية وإرسال التقرير', 'قبل مغادرة الشفت', 'لخّص الجرد والطلبات المرسلة والتسليم المتوقع والنواقص والهدر والشكاوى والأعطال والمهام المفتوحة، ثم أرسل التقرير اليومي.', NULL::time, false, 'standard'),
    (30, 'الإقفال الأمني النهائي', 'بعد إقفال الفرع', 'تحقق من إخلاء مناطق الخدمة وإغلاق الأبواب والنوافذ وتفعيل نظام الأمان حسب سياسة الفرع، وسجّل من أغلق والوقت.', NULL::time, false, 'standard')
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id,
  requires_photo, target_time, frequency, allows_notes, task_type, sort_order
)
SELECT
  nt.task_title,
  'مهام المشرفين',
  'Evening',
  'الوقت / المرحلة: ' || nt.phase || chr(10) || nt.instructions,
  NULL,
  nt.requires_photo,
  nt.target_time,
  'daily',
  true,
  nt.task_type,
  nt.sort_order
FROM night_tasks AS nt
WHERE NOT EXISTS (
  SELECT 1
  FROM public.checklist_templates AS existing
  WHERE existing.task_title = nt.task_title
    AND existing.category = 'مهام المشرفين'
    AND existing.shift_type = 'Evening'
    AND existing.branch_id IS NULL
);

-- Midday supervisor inventory reminder, visible to supervisors only through the supervisor task page.
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id,
  requires_photo, target_time, frequency, allows_notes, task_type, sort_order
)
SELECT
  'جرد المخزون وإنشاء طلبات النواقص',
  'مهام المشرفين',
  'Morning',
  'الوقت / المرحلة: 12:00 ظهراً. راجع الكميات الحالية، وافتح صفحة الجرد والطلبيات لإنشاء طلب مستقل لكل جهة توريد، ثم احفظ الطلب واطبعه أو جهّز نصه للمشاركة عبر واتساب.',
  NULL,
  false,
  '12:00'::time,
  'daily',
  true,
  'inventory_request',
  17
WHERE NOT EXISTS (
  SELECT 1
  FROM public.checklist_templates AS existing
  WHERE existing.task_title = 'جرد المخزون وإنشاء طلبات النواقص'
    AND existing.category = 'مهام المشرفين'
    AND existing.shift_type = 'Morning'
    AND existing.branch_id IS NULL
);

-- Cleaning plan: shared Saturday deep-clean tasks, daily workstation care for both shifts,
-- espresso-machine chemical cleaning on Sunday/Monday/Thursday, and grill chemical cleaning at night.
WITH cleaning_tasks (
  task_title, category, shift_type, instructions, frequency, day_of_week, sort_order
) AS (
  VALUES
    ('تنظيف محطة العمل ومعدات البار', 'البار', 'Morning', 'نظّف وعقّم محطة العمل والأدوات والمعدات المستخدمة، وأعد ترتيبها وجفّف الأسطح قبل التشغيل.', 'daily', NULL::integer, 101),
    ('تنظيف محطة العمل ومعدات البار', 'البار', 'Evening', 'نظّف وعقّم محطة العمل والأدوات والمعدات المستخدمة، وأعد ترتيبها وجفّف الأسطح بعد الخدمة.', 'daily', NULL::integer, 102),
    ('تنظيف محطة العمل ومعدات المطبخ', 'المطبخ', 'Morning', 'نظّف وعقّم محطة العمل والأدوات والمعدات المستخدمة، مع إبقاء الطعام بعيداً عن مواد التنظيف.', 'daily', NULL::integer, 103),
    ('تنظيف محطة العمل ومعدات المطبخ', 'المطبخ', 'Evening', 'نظّف وعقّم محطة العمل والأدوات والمعدات المستخدمة، مع إبقاء الطعام بعيداً عن مواد التنظيف.', 'daily', NULL::integer, 104),
    ('تنظيف محطة العمل ومعدات الصالة', 'الصالة', 'Morning', 'نظّف وعقّم محطات الخدمة والمعدات والأسطح المستخدمة، وأعد ترتيبها قبل استقبال الضيوف.', 'daily', NULL::integer, 105),
    ('تنظيف محطة العمل ومعدات الصالة', 'الصالة', 'Evening', 'نظّف وعقّم محطات الخدمة والمعدات والأسطح المستخدمة، وأعد ترتيبها بعد الخدمة.', 'daily', NULL::integer, 106),
    ('التنظيف الكيميائي لماكينة الإسبريسو', 'البار', 'Both', 'نفّذ التنظيف بمادة وطريقة وجرعة الشركة المصنّعة فقط. اشطف الأجزاء الملامسة للمشروب جيداً، وتأكد من زوال بقايا المادة قبل إعادة الاستخدام.', 'weekly', 0, 107),
    ('التنظيف الكيميائي لماكينة الإسبريسو', 'البار', 'Both', 'نفّذ التنظيف بمادة وطريقة وجرعة الشركة المصنّعة فقط. اشطف الأجزاء الملامسة للمشروب جيداً، وتأكد من زوال بقايا المادة قبل إعادة الاستخدام.', 'weekly', 1, 108),
    ('التنظيف الكيميائي لماكينة الإسبريسو', 'البار', 'Both', 'نفّذ التنظيف بمادة وطريقة وجرعة الشركة المصنّعة فقط. اشطف الأجزاء الملامسة للمشروب جيداً، وتأكد من زوال بقايا المادة قبل إعادة الاستخدام.', 'weekly', 4, 109),
    ('تنظيف الجريل بمادة كيميائية معتمدة', 'المطبخ', 'Evening', 'لوردية الليل فقط: استخدم منظفاً معتمداً للجريل وبحسب تعليمات الشركة المصنّعة، مع معدات الوقاية. اشطف أو امسح السطح حتى تزول البقايا قبل ملامسة الطعام.', 'daily', NULL::integer, 110),
    ('تنظيف عميق لمحطات وأدوات البار', 'البار', 'Both', 'نظّف أسفل وخلف محطات البار والمعدات حيث يمكن الوصول بأمان، وأزل التراكمات من الأدوات والخزائن والأسطح والأرضية. لا تحرّك معدات ثقيلة أو تفك أجزاء كهربائية.', 'weekly', 6, 201),
    ('تنظيف خلف وتحت ثلاجات المطبخ', 'المطبخ', 'Both', 'أخرج المواد إلى حفظ مبرد مناسب، ولا تتركها خارج التبريد. نظّف الأرضية والمناطق المتاحة خلف وتحت الثلاجات بأمان، وأعد المواد مع التحقق من درجات الحرارة.', 'weekly', 6, 202),
    ('تنظيف عميق لأرضية المطبخ', 'المطبخ', 'Both', 'نظّف الأرضية والزوايا والحواف وتحت المعدات الممكن تحريكها بأمان، واستخدم لافتة أرضية مبللة وأعد المكان جافاً وآمناً.', 'weekly', 6, 203),
    ('تنظيف الأفران والميكرويف تنظيفاً عميقاً', 'المطبخ', 'Both', 'أطفئ الأجهزة واتبع تعليمات الشركة المصنّعة للتنظيف. لا تستخدم مادة كيميائية غير معتمدة، وأزل بقايا المنظف وجفّف الأسطح قبل التشغيل.', 'weekly', 6, 204),
    ('غسيل الثلاجات من الداخل', 'المطبخ', 'Both', 'أخرج المواد إلى حفظ مبرد مناسب، ونظّف الرفوف والجدران الداخلية بمادة آمنة للأسطح الملامسة للغذاء. اشطف وجفّف، ثم أعد المواد وتحقق من الحرارة.', 'weekly', 6, 205),
    ('تنظيف وتعقيم أسطح عمل المطبخ', 'المطبخ', 'Both', 'أزل بقايا الطعام، ثم نظّف وعقّم أسطح العمل بمادة معتمدة للأسطح الملامسة للغذاء وبحسب زمن التلامس المحدد، واتركها تجف.', 'weekly', 6, 206),
    ('تنظيف عميق للصالة والمعدات', 'الصالة', 'Both', 'نظّف أسفل وخلف الطاولات والكراسي ومحطات الخدمة، والحواف والزوايا والأرضيات والمعدات المستخدمة. أعد ترتيب الأثاث وتحقق من سلامة المكان.', 'weekly', 6, 207),
    ('مراجعة إتمام التنظيف العميق الأسبوعي للفئات', 'مهام المشرفين', 'Both', 'تحقق يوم السبت من إتمام مهام البار والمطبخ والصالة، وسجّل النواقص والمسؤول وموعد المعالجة. لا تعتمد المهمة قبل التحقق من التنفيذ.', 'weekly', 6, 208)
)
INSERT INTO public.checklist_templates (
  task_title, category, shift_type, instructions, branch_id, requires_photo,
  target_time, frequency, day_of_week, allows_notes, task_type, sort_order
)
SELECT
  ct.task_title, ct.category, ct.shift_type, ct.instructions, NULL, false,
  NULL, ct.frequency, ct.day_of_week, true, 'standard', ct.sort_order
FROM cleaning_tasks AS ct
WHERE NOT EXISTS (
  SELECT 1
  FROM public.checklist_templates AS existing
  WHERE existing.task_title = ct.task_title
    AND existing.category = ct.category
    AND existing.shift_type = ct.shift_type
    AND existing.branch_id IS NULL
    AND existing.frequency = ct.frequency
    AND existing.day_of_week IS NOT DISTINCT FROM ct.day_of_week
);
