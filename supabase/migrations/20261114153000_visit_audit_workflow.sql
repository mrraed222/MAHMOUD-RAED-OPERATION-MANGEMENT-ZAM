-- Visit audit workflow: additive, reversible schema for branch visits.
-- Existing supervisory_visits and supervisory_visit_notes rows are preserved.

ALTER TABLE public.supervisory_visits
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'مسودة',
  ADD COLUMN IF NOT EXISTS score_total numeric,
  ADD COLUMN IF NOT EXISTS score_possible numeric,
  ADD COLUMN IF NOT EXISTS score_percentage numeric,
  ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS signed_by_role text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signature_method text,
  ADD COLUMN IF NOT EXISTS pdf_storage_path text;

CREATE TABLE IF NOT EXISTS public.visit_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  category text NOT NULL,
  title text NOT NULL,
  instructions text,
  max_score integer NOT NULL DEFAULT 10 CHECK (max_score = 10),
  sort_order integer NOT NULL DEFAULT 0,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  shift_type text,
  active boolean NOT NULL DEFAULT true,
  requires_photo_on_violation boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supervisory_visit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.supervisory_visits(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.visit_checklist_templates(id) ON DELETE RESTRICT,
  score integer CHECK (score IN (0, 5, 10)),
  result text NOT NULL DEFAULT 'غير مكتمل' CHECK (result IN ('مطابق','جزئي','غير مطابق','لا ينطبق','غير مكتمل')),
  note text,
  is_violation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visit_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.visit_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.supervisory_visits(id) ON DELETE CASCADE,
  result_id uuid REFERENCES public.supervisory_visit_results(id) ON DELETE SET NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  item_type text NOT NULL DEFAULT 'تكليف' CHECK (item_type IN ('ملاحظة','مشكلة','مخالفة','تكليف')),
  priority text NOT NULL DEFAULT 'متوسطة' CHECK (priority IN ('منخفضة','متوسطة','عالية','حرجة')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_role text,
  shift_type text,
  due_date date,
  status text NOT NULL DEFAULT 'مفتوحة' CHECK (status IN ('مفتوحة','قيد المعالجة','بانتظار اعتماد','مغلقة','ملغاة')),
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.visit_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.supervisory_visits(id) ON DELETE CASCADE,
  result_id uuid REFERENCES public.supervisory_visit_results(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text,
  mime_type text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.visit_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.supervisory_visits(id) ON DELETE CASCADE,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipients text[] NOT NULL DEFAULT '{}',
  cc_recipients text[] NOT NULL DEFAULT '{}',
  attachment_path text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visit_results_visit ON public.supervisory_visit_results(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_actions_branch_status ON public.visit_action_items(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_visit_actions_assigned_status ON public.visit_action_items(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_visit_evidence_visit ON public.visit_evidence(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_email_logs_visit ON public.visit_email_logs(visit_id);

ALTER TABLE public.visit_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisory_visit_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visit_templates_read ON public.visit_checklist_templates;
DROP POLICY IF EXISTS visit_templates_manage ON public.visit_checklist_templates;
CREATE POLICY visit_templates_read ON public.visit_checklist_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY visit_templates_manage ON public.visit_checklist_templates FOR ALL TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager'))
  WITH CHECK (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager'));

DROP POLICY IF EXISTS visit_results_read ON public.supervisory_visit_results;
DROP POLICY IF EXISTS visit_results_write ON public.supervisory_visit_results;
CREATE POLICY visit_results_read ON public.supervisory_visit_results FOR SELECT TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager') OR EXISTS (
    SELECT 1 FROM public.supervisory_visits v WHERE v.id = visit_id AND v.signed_by = auth.uid()
  ));
CREATE POLICY visit_results_write ON public.supervisory_visit_results FOR ALL TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager'))
  WITH CHECK (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager'));

DROP POLICY IF EXISTS visit_actions_read ON public.visit_action_items;
DROP POLICY IF EXISTS visit_actions_write ON public.visit_action_items;
CREATE POLICY visit_actions_read ON public.visit_action_items FOR SELECT TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager') OR assigned_to = auth.uid());
CREATE POLICY visit_actions_write ON public.visit_action_items FOR ALL TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager') OR assigned_to = auth.uid())
  WITH CHECK (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager') OR assigned_to = auth.uid());

DROP POLICY IF EXISTS visit_evidence_read ON public.visit_evidence;
DROP POLICY IF EXISTS visit_evidence_write ON public.visit_evidence;
CREATE POLICY visit_evidence_read ON public.visit_evidence FOR SELECT TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager') OR uploaded_by = auth.uid());
CREATE POLICY visit_evidence_write ON public.visit_evidence FOR ALL TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager') OR uploaded_by = auth.uid())
  WITH CHECK (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager') OR uploaded_by = auth.uid());

DROP POLICY IF EXISTS visit_email_logs_owner ON public.visit_email_logs;
CREATE POLICY visit_email_logs_owner ON public.visit_email_logs FOR ALL TO authenticated
  USING (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager'))
  WITH CHECK (current_user_role() IN ('Owner','Admin','Manager','Quality','Quality Manager'));

-- Initial 10-category inspection template, two measurable controls per category.
INSERT INTO public.visit_checklist_templates (code, category, title, instructions, sort_order)
VALUES
('PERSONAL-HYGIENE-01','النظافة الشخصية','الزي والنظافة الشخصية مطابقان','الزي نظيف والمظهر مهني.',10),
('PERSONAL-HYGIENE-02','النظافة الشخصية','غسل وتعقيم اليدين مطبق','توجد ممارسة واضحة لغسل وتعقيم اليدين.',11),
('BAR-01','مهام البار','جاهزية ماكينة الإسبريسو والطاحونة','المعدات جاهزة ونظيفة وتعمل بصورة سليمة.',20),
('BAR-02','مهام البار','نظافة أدوات التحضير والتخزين','الأدوات نظيفة ومخزنة بطريقة صحيحة.',21),
('KITCHEN-01','المطبخ والتجهيز','أسطح التحضير والأدوات نظيفة','لا توجد بقايا أو تلوث ظاهر.',30),
('KITCHEN-02','المطبخ والتجهيز','درجات حرارة الثلاجات والفريزر مسجلة','القراءة مسجلة وضمن الحدود المعتمدة.',31),
('HALL-01','الصالة وتجربة العميل','الطاولات والكراسي والصالة مرتبة','الصالة جاهزة لاستقبال العملاء.',40),
('HALL-02','الصالة وتجربة العميل','دورات المياه بحالة مناسبة','النظافة والمستلزمات متوفرة.',41),
('STORAGE-01','الصلاحية والتخزين','تواريخ الصلاحية مراجعة','لا توجد منتجات منتهية أو غير معرفة.',50),
('STORAGE-02','الصلاحية والتخزين','التخزين والتدوير FIFO/FEFO مطبق','التخزين يمنع التلف والتلوث.',51),
('FOOD-SAFETY-01','سلامة الغذاء','منع التلوث المتبادل مطبق','الفصل بين الخام والجاهز واضح.',60),
('FOOD-SAFETY-02','سلامة الغذاء','التعامل مع الغذاء آمن','الممارسات لا تعرض الغذاء للخطر.',61),
('WASTE-01','الهدر والمخزون','الهدر مسجل بالكمية والسبب','كل هدر موثق في النظام.',70),
('WASTE-02','الهدر والمخزون','الأصناف المتكررة في الهدر تحت متابعة','يوجد إجراء للأصناف المتكررة.',71),
('OPEN-CLOSE-01','الافتتاح والإغلاق','مهام الافتتاح منفذة','الفرع جاهز قبل بدء التشغيل.',80),
('OPEN-CLOSE-02','الافتتاح والإغلاق','مهام الإغلاق وتسليم الشفت منفذة','تم التسليم وإغلاق المعدات حسب الإجراء.',81),
('STAFF-01','الموظفون والانضباط','الحضور والتغطية مكتملان','لا يوجد نقص غير معالج.',90),
('STAFF-02','الموظفون والانضباط','توزيع المهام والالتزام بالشفت واضح','كل عضو يعرف مهمته وشفته.',91),
('MANAGEMENT-01','الإدارة والتوثيق','التشيك ليست والإجراءات السابقة محدثة','الإجراءات المفتوحة تحت متابعة.',100),
('MANAGEMENT-02','الإدارة والتوثيق','الملاحظات التشغيلية موثقة','المشاكل والملاحظات مسجلة بوضوح.',101)
ON CONFLICT (code) DO NOTHING;
