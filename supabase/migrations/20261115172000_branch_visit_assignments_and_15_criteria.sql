-- Branch visits become explicit, assignable work rather than a hard-coded role.
-- This migration is additive: it preserves historical visits/results and deactivates
-- the old assessment templates instead of deleting rows referenced by past reports.

ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS can_manage_branch_visits boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_manage_branch_visits()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND (p.role = 'Owner' OR COALESCE(ap.can_manage_branch_visits, false))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_branch_visit_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_manage_branch_visits() OR EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.status = 'active'
      AND ap.can_view_all_reports
  );
$$;

CREATE TABLE IF NOT EXISTS public.branch_visit_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  visit_date date NOT NULL,
  shift_type text NOT NULL CHECK (shift_type IN ('Morning', 'Evening')),
  visit_type text NOT NULL DEFAULT 'زيارة دورية',
  notes text,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supervisory_visits
  ADD COLUMN IF NOT EXISTS assignment_id uuid;

DO $$ BEGIN
  ALTER TABLE public.supervisory_visits
    ADD CONSTRAINT supervisory_visits_assignment_id_fkey
    FOREIGN KEY (assignment_id) REFERENCES public.branch_visit_assignments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS supervisory_visits_assignment_id_unique
  ON public.supervisory_visits(assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS branch_visit_assignments_assignee_status_idx
  ON public.branch_visit_assignments(assigned_to, status, visit_date);
CREATE INDEX IF NOT EXISTS branch_visit_assignments_branch_date_idx
  ON public.branch_visit_assignments(branch_id, visit_date, shift_type);

ALTER TABLE public.branch_visit_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.list_branch_visit_assignees(p_branch_id uuid)
RETURNS TABLE(user_id uuid, full_name text, role text, shift_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.full_name, p.role, p.shift_type
  FROM public.profiles AS p
  WHERE p.branch_id = p_branch_id
    AND p.status = 'active'
    AND (
      public.can_manage_branch_visits()
      OR EXISTS (
        SELECT 1 FROM public.branch_visit_assignments AS a
        WHERE a.assigned_to = auth.uid()
          AND a.branch_id = p_branch_id
          AND a.status = 'assigned'
      )
    )
  ORDER BY p.full_name;
$$;

CREATE OR REPLACE FUNCTION public.can_access_branch_visit(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_view_branch_visit_reports() OR EXISTS (
    SELECT 1
    FROM public.supervisory_visits AS v
    WHERE v.id = p_visit_id
      AND (
        v.signed_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.branch_visit_assignments AS a
          WHERE a.id = v.assignment_id
            AND a.assigned_to = auth.uid()
            AND a.status <> 'cancelled'
        )
        OR EXISTS (
          SELECT 1 FROM public.visit_action_items AS ai
          WHERE ai.visit_id = v.id
            AND ai.assigned_to = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.profiles AS p
          JOIN public.visit_action_items AS ai
            ON ai.branch_id = p.branch_id
           AND ai.visit_id = v.id
          WHERE p.id = auth.uid()
            AND p.role = 'Supervisor'
            AND ai.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
            AND (ai.shift_type IS NULL OR ai.shift_type = p.shift_type)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_submit_assigned_branch_visit(
  p_assignment_id uuid,
  p_branch_id uuid,
  p_visit_date date,
  p_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_manage_branch_visits() OR EXISTS (
    SELECT 1
    FROM public.branch_visit_assignments AS a
    WHERE a.id = p_assignment_id
      AND a.assigned_to = auth.uid()
      AND a.branch_id = p_branch_id
      AND a.visit_date = p_visit_date
      AND a.shift_type = p_shift_type
      AND a.status = 'assigned'
  );
$$;

DROP TRIGGER IF EXISTS complete_branch_visit_assignment_after_insert ON public.supervisory_visits;
DROP FUNCTION IF EXISTS public.complete_branch_visit_assignment();

CREATE OR REPLACE FUNCTION public.complete_branch_visit_assignment(p_assignment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  assignment_row public.branch_visit_assignments%ROWTYPE;
BEGIN
  SELECT * INTO assignment_row
  FROM public.branch_visit_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'التكليف غير موجود';
  END IF;

  IF NOT public.can_manage_branch_visits() AND NOT (
    assignment_row.assigned_to = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية إغلاق هذا التكليف';
  END IF;

  IF assignment_row.status = 'completed' THEN
    RETURN true;
  END IF;
  IF assignment_row.status <> 'assigned' THEN
    RAISE EXCEPTION 'لا يمكن إغلاق تكليف ملغى';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.supervisory_visits AS v
    WHERE v.assignment_id = p_assignment_id
      AND v.branch_id = assignment_row.branch_id
      AND v.visit_date = assignment_row.visit_date
      AND v.shift_type = assignment_row.shift_type
      AND (public.can_manage_branch_visits() OR v.signed_by = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visit_results AS r
        WHERE r.visit_id = v.id
      )
  ) THEN
    RAISE EXCEPTION 'لا يمكن إغلاق التكليف قبل حفظ تقرير الزيارة ونتائجه';
  END IF;

  UPDATE public.branch_visit_assignments
     SET status = 'completed', completed_at = now(), updated_at = now()
   WHERE id = p_assignment_id AND status = 'assigned';
  RETURN true;
END;
$$;

DROP POLICY IF EXISTS branch_visit_assignments_read ON public.branch_visit_assignments;
DROP POLICY IF EXISTS branch_visit_assignments_insert ON public.branch_visit_assignments;
DROP POLICY IF EXISTS branch_visit_assignments_update ON public.branch_visit_assignments;
DROP POLICY IF EXISTS branch_visit_assignments_delete ON public.branch_visit_assignments;
CREATE POLICY branch_visit_assignments_read ON public.branch_visit_assignments
  FOR SELECT TO authenticated
  USING (public.can_manage_branch_visits() OR assigned_to = auth.uid());
CREATE POLICY branch_visit_assignments_insert ON public.branch_visit_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_branch_visits()
    AND assigned_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = assigned_to
        AND p.status = 'active'
        AND p.branch_id = branch_id
        AND (p.shift_type = 'Both' OR p.shift_type = branch_visit_assignments.shift_type)
    )
  );
CREATE POLICY branch_visit_assignments_update ON public.branch_visit_assignments
  FOR UPDATE TO authenticated
  USING (public.can_manage_branch_visits())
  WITH CHECK (public.can_manage_branch_visits());
CREATE POLICY branch_visit_assignments_delete ON public.branch_visit_assignments
  FOR DELETE TO authenticated
  USING (public.can_manage_branch_visits());

DROP POLICY IF EXISTS supervisory_visits_owner_insert ON public.supervisory_visits;
DROP POLICY IF EXISTS supervisory_visits_owner_select ON public.supervisory_visits;
DROP POLICY IF EXISTS supervisory_visits_owner_update ON public.supervisory_visits;
DROP POLICY IF EXISTS supervisory_visits_read ON public.supervisory_visits;
DROP POLICY IF EXISTS supervisory_visits_insert ON public.supervisory_visits;
DROP POLICY IF EXISTS supervisory_visits_update ON public.supervisory_visits;
CREATE POLICY supervisory_visits_read ON public.supervisory_visits
  FOR SELECT TO authenticated
  USING (public.can_access_branch_visit(id));
CREATE POLICY supervisory_visits_insert ON public.supervisory_visits
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_branch_visits()
    OR (
      signed_by = auth.uid()
      AND assignment_id IS NOT NULL
      AND public.can_submit_assigned_branch_visit(assignment_id, branch_id, visit_date, shift_type)
    )
  );
CREATE POLICY supervisory_visits_update ON public.supervisory_visits
  FOR UPDATE TO authenticated
  USING (public.can_manage_branch_visits())
  WITH CHECK (public.can_manage_branch_visits());

DROP POLICY IF EXISTS visit_results_read ON public.supervisory_visit_results;
DROP POLICY IF EXISTS visit_results_write ON public.supervisory_visit_results;
CREATE POLICY visit_results_read ON public.supervisory_visit_results
  FOR SELECT TO authenticated
  USING (public.can_access_branch_visit(visit_id));
CREATE POLICY visit_results_write ON public.supervisory_visit_results
  FOR ALL TO authenticated
  USING (
    public.can_manage_branch_visits()
    OR EXISTS (
      SELECT 1 FROM public.supervisory_visits AS v
      WHERE v.id = visit_id
        AND v.assignment_id IS NOT NULL
        AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
    )
  )
  WITH CHECK (
    public.can_manage_branch_visits()
    OR EXISTS (
      SELECT 1 FROM public.supervisory_visits AS v
      WHERE v.id = visit_id
        AND v.assignment_id IS NOT NULL
        AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
    )
  );

DROP POLICY IF EXISTS visit_actions_read ON public.visit_action_items;
DROP POLICY IF EXISTS visit_actions_write ON public.visit_action_items;
CREATE POLICY visit_actions_read ON public.visit_action_items
  FOR SELECT TO authenticated
  USING (
    public.can_view_branch_visit_reports()
    OR assigned_to = auth.uid()
    OR public.can_access_branch_visit(visit_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'Supervisor'
        AND p.branch_id = visit_action_items.branch_id
        AND visit_action_items.assigned_role IN ('مشرف الشفت', 'Supervisor', 'Shift Supervisor')
        AND (visit_action_items.shift_type IS NULL OR visit_action_items.shift_type = p.shift_type)
    )
  );
CREATE POLICY visit_actions_write ON public.visit_action_items
  FOR ALL TO authenticated
  USING (
    public.can_manage_branch_visits()
    OR (assigned_to = auth.uid() AND branch_id = (SELECT p.branch_id FROM public.profiles AS p WHERE p.id = auth.uid()))
  )
  WITH CHECK (
    public.can_manage_branch_visits()
    OR (
      assigned_to = auth.uid()
      AND branch_id = (SELECT p.branch_id FROM public.profiles AS p WHERE p.id = auth.uid())
    )
    OR (
      created_by = auth.uid()
      AND branch_id = (SELECT a.branch_id FROM public.branch_visit_assignments AS a WHERE a.id = (SELECT v.assignment_id FROM public.supervisory_visits AS v WHERE v.id = visit_id))
      AND EXISTS (
        SELECT 1 FROM public.supervisory_visits AS v
        WHERE v.id = visit_action_items.visit_id
          AND v.assignment_id IS NOT NULL
          AND public.can_submit_assigned_branch_visit(v.assignment_id, v.branch_id, v.visit_date, v.shift_type)
      )
    )
  );

DROP POLICY IF EXISTS visit_evidence_read ON public.visit_evidence;
DROP POLICY IF EXISTS visit_evidence_write ON public.visit_evidence;
CREATE POLICY visit_evidence_read ON public.visit_evidence
  FOR SELECT TO authenticated
  USING (public.can_access_branch_visit(visit_id) OR uploaded_by = auth.uid());
CREATE POLICY visit_evidence_write ON public.visit_evidence
  FOR ALL TO authenticated
  USING (public.can_manage_branch_visits() OR uploaded_by = auth.uid())
  WITH CHECK (
    public.can_manage_branch_visits()
    OR (
      uploaded_by = auth.uid()
      AND public.can_access_branch_visit(visit_id)
    )
  );

GRANT EXECUTE ON FUNCTION public.can_manage_branch_visits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_branch_visit_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_branch_visit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_submit_assigned_branch_visit(uuid, uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_branch_visit_assignees(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_branch_visit_assignment(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_branch_visit_assignment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_branch_visits() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_branch_visit_reports() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_branch_visit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_submit_assigned_branch_visit(uuid, uuid, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_branch_visit_assignees(uuid) FROM PUBLIC, anon;

-- Keep all assessment checks while making them 15 scorable criteria.
-- Old rows are retained (inactive) so existing visit_results continue to render unchanged.
UPDATE public.visit_checklist_templates SET active = false WHERE active = true;

INSERT INTO public.visit_checklist_templates (code, category, title, instructions, max_score, sort_order, branch_id, shift_type, active, requires_photo_on_violation)
VALUES
('BRV-CLEAN-01', 'النظافة العامة', 'نظافة الجلسات الداخلية والخارجية', 'تحقق من نظافة وترتيب الكراسي والطاولات داخل الفرع وخارجه، وخلوّها من البقع وآثار الاستخدام، وجاهزيتها لاستقبال العملاء. التقييم: 10 = جميع الجلسات نظيفة ومرتبة؛ 5 = ملاحظة بسيطة غير مؤثرة؛ 0 = اتساخ أو عدم جاهزية واضح.', 10, 10, NULL, NULL, true, true),
('BRV-CLEAN-02', 'النظافة العامة', 'نظافة الأرضيات الداخلية والخارجية', 'تحقق من نظافة الأرضيات داخل الفرع وخارجه، وخلوّها من الأتربة والانسكابات والمخلفات ومخاطر الانزلاق. التقييم: 10 = نظيفة وآمنة؛ 5 = بقعة بسيطة تُعالج فوراً؛ 0 = اتساخ مؤثر أو خطر سلامة.', 10, 20, NULL, NULL, true, true),
('BRV-CLEAN-03', 'النظافة العامة', 'رائحة المكان والأجواء وحرارة المكيف', 'قيّم خلوّ المكان من الروائح غير المقبولة، وراحة الأجواء للعميل، وكفاءة التهوية ودرجة حرارة المكيف المناسبة طوال الزيارة. التقييم: 10 = أجواء مريحة بلا روائح؛ 5 = ملاحظة محدودة؛ 0 = رائحة أو حرارة/تهوية تؤثر بوضوح على العميل.', 10, 30, NULL, NULL, true, true),
('BRV-CLEAN-04', 'النظافة العامة', 'نظافة المرافق', 'تحقق من نظافة المرافق والأحواض ودورات المياه، وتوفر مستلزماتها، وجفاف الأرضيات، وعدم وجود روائح أو أعطال ظاهرة.', 10, 40, NULL, NULL, true, true),
('BRV-CLEAN-05', 'النظافة العامة', 'نظافة البار', 'تحقق من نظافة أسطح البار وماكينات القهوة والأدوات ومناطق التحضير والتخزين، وخلوّها من بقايا المشروبات أو التلوث.', 10, 50, NULL, NULL, true, true),
('BRV-CLEAN-06', 'النظافة العامة', 'نظافة المطبخ', 'تحقق من نظافة أسطح وأدوات المطبخ، والفصل بين النيئ والجاهز، ونظافة مناطق الغسيل والتجهيز، وعدم وجود بقايا أو تلوث ظاهر.', 10, 60, NULL, NULL, true, true),
('BRV-HYGIENE-01', 'النظافة الشخصية', 'هندام الموظفين والنظافة الشخصية', 'تحقق من الترتيب والمظهر المهني والنظافة الشخصية، والالتزام بالزي الرسمي النظيف والمكتمل، وظهور بطاقات العمل، ونظافة الأيدي والأظافر وغطاء الرأس عند تحضير الغذاء. التقييم: 10 = التزام كامل؛ 5 = نقص بسيط؛ 0 = مخالفة مؤثرة أو خطر صحي.', 10, 70, NULL, NULL, true, true),
('BRV-CUSTOMER-01', 'تجربة العميل', 'استعداد الكاشير والطاقم لاستقبال العميل', 'تحقق من جاهزية الكاشير والطاقم، والانتباه للعميل عند وصوله، وتوفر معرفة كافية بالمنيو والقدرة على أخذ الطلب بوضوح.', 10, 80, NULL, NULL, true, true),
('BRV-CUSTOMER-02', 'تجربة العميل', 'تطبيق بروتوكول احترام العملاء', 'تحقق من الترحيب واللباقة والإنصات واحترام العميل، والتعامل المهني مع الاستفسار أو الشكوى دون جدال أو تجاهل.', 10, 90, NULL, NULL, true, true),
('BRV-CUSTOMER-03', 'تجربة العميل', 'تطبيق استراتيجيات رفع المبيعات والتعريف بالولاء', 'تحقق من عرض الإضافات أو البدائل الملائمة دون ضغط، وشرح المنتجات، والتعريف بنظام الولاء وطريقة الاستفادة منه.', 10, 100, NULL, NULL, true, true),
('BRV-CUSTOMER-04', 'تجربة العميل', 'سرعة الخدمة وجودة تسليم الطلب المحلي', 'تحقق من سرعة تجهيز الطلب، ومطابقته لما طلبه العميل، واكتمال مكوناته، وجودة تقديمه للعميل المحلي من حيث العرض والحرارة والنظافة.', 10, 110, NULL, NULL, true, true),
('BRV-INVENTORY-01', 'إدارة المخزون', 'توفر المخزون واستمرارية التشغيل', 'تحقق من عدم وجود انقطاعات في الأصناف أو المواد تؤثر على التشغيل أو تمنع تقديم عناصر المنيو، ومراجعة الإبلاغ والتصرف عند وجود نقص.', 10, 120, NULL, NULL, true, true),
('BRV-INVENTORY-02', 'إدارة المخزون', 'جودة التخزين وتطبيق FIFO وFEFO وسلامة الصلاحية', 'تحقق من ملاءمة التخزين لنوع المادة، ونظافة وترتيب مناطق التخزين، ووضع الملصقات والتواريخ، وتطبيق FIFO (الأول دخولاً يخرج أولاً) وFEFO (الأقرب انتهاءً يخرج أولاً)، وعدم وجود منتجات منتهية أو مجهولة الصلاحية.', 10, 130, NULL, NULL, true, true),
('BRV-OPS-01', 'الامتثال التشغيلي', 'الالتزام بالمنيو والمعايير والمهام الإدارية', 'تحقق من الالتزام بالمنيو والوصفات والمعايير وتعليمات التشغيل المعتمدة، وتنفيذ التعليمات والمهام الإدارية في موعدها وتوثيقها عند الحاجة.', 10, 140, NULL, NULL, true, true),
('BRV-GOV-01', 'الامتثال الحكومي', 'السلامة والامتثال الحكومي وسلامة الغذاء وGMP', 'تحقق من جميع النقاط الفرعية: (1) اشتراطات الدفاع المدني وسلامة أجهزة الإنذار والإطفاء وسهولة الوصول إليها؛ (2) سلامة وكفاءة المعدات والإبلاغ فوراً عن أي عطل فني؛ (3) الامتثال لاشتراطات البلدية؛ (4) سلامة الغذاء ومنع التلوث؛ (5) تطبيق ممارسات التصنيع الجيد GMP. سجّل مخالفة فورية عند وجود خطر على الأشخاص أو الغذاء.', 10, 150, NULL, NULL, true, true)
ON CONFLICT (code) DO UPDATE SET
  category = EXCLUDED.category,
  title = EXCLUDED.title,
  instructions = EXCLUDED.instructions,
  max_score = EXCLUDED.max_score,
  sort_order = EXCLUDED.sort_order,
  branch_id = NULL,
  shift_type = NULL,
  active = true,
  requires_photo_on_violation = EXCLUDED.requires_photo_on_violation;
