-- Separate the five government-compliance checks into scored criteria.
-- The new model has 19 scored items (14 existing items + 5 government checks).
-- Keep existing visit results and drafts on their legacy 15-item model.

UPDATE public.visit_checklist_templates
   SET active = false
 WHERE code = 'BRV-GOV-01';

INSERT INTO public.visit_checklist_templates
  (code, category, title, instructions, max_score, sort_order, branch_id, shift_type, active, requires_photo_on_violation)
VALUES
  ('BRV-GOV-FIRE', 'الامتثال الحكومي', 'اشتراطات وسلامة أجهزة الدفاع المدني', 'تحقق من اشتراطات وسلامة أجهزة الدفاع المدني.', 10, 150, NULL, NULL, true, true),
  ('BRV-GOV-EQUIPMENT', 'الامتثال الحكومي', 'سلامة وكفاءة المعدات والإبلاغ عن الأعطال', 'تحقق من سلامة وكفاءة المعدات والإبلاغ عن الأعطال.', 10, 151, NULL, NULL, true, true),
  ('BRV-GOV-MUNICIPAL', 'الامتثال الحكومي', 'الامتثال لاشتراطات البلدية', 'تحقق من الامتثال لاشتراطات البلدية.', 10, 152, NULL, NULL, true, true),
  ('BRV-GOV-FOOD', 'الامتثال الحكومي', 'سلامة الغذاء ومنع التلوث', 'تحقق من سلامة الغذاء ومنع التلوث.', 10, 153, NULL, NULL, true, true),
  ('BRV-GOV-GMP', 'الامتثال الحكومي', 'تطبيق ممارسات التصنيع الجيد GMP', 'تحقق من تطبيق ممارسات التصنيع الجيد GMP.', 10, 154, NULL, NULL, true, true)
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

-- NULL/1 means an existing legacy 15-item visit; the current UI explicitly writes 2.
-- Leave existing rows NULL so no historical visit content or grade is inferred.
ALTER TABLE public.supervisory_visits
  ADD COLUMN IF NOT EXISTS assessment_version smallint,
  ADD COLUMN IF NOT EXISTS quality_status text,
  ADD COLUMN IF NOT EXISTS quality_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_override_reason text,
  ADD COLUMN IF NOT EXISTS quality_override_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quality_override_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.supervisory_visits
    ADD CONSTRAINT supervisory_visits_assessment_version_check
    CHECK (assessment_version IS NULL OR assessment_version IN (1, 2));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.supervisory_visits
    ADD CONSTRAINT supervisory_visits_quality_status_check
    CHECK (quality_status IS NULL OR quality_status IN ('ناجح', 'راسب'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.supervisory_visits
    ADD CONSTRAINT supervisory_visits_quality_override_fields_check
    CHECK (
      (quality_override = false AND quality_override_reason IS NULL AND quality_override_by IS NULL AND quality_override_at IS NULL)
      OR
      (quality_override = true AND length(btrim(COALESCE(quality_override_reason, ''))) >= 3 AND quality_override_by IS NOT NULL AND quality_override_at IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Always derive quality from the unrounded score. An exceptional failure is manager-only,
-- must be reasoned, and requires a completed visit with a written observation.
CREATE OR REPLACE FUNCTION public.derive_supervisory_visit_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  override_changed boolean := false;
  audit_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    override_changed := COALESCE(NEW.quality_override, false);
  ELSE
    override_changed := NEW.quality_override IS DISTINCT FROM OLD.quality_override
      OR NEW.quality_override_reason IS DISTINCT FROM OLD.quality_override_reason;
    audit_changed := NEW.quality_override_by IS DISTINCT FROM OLD.quality_override_by
      OR NEW.quality_override_at IS DISTINCT FROM OLD.quality_override_at;
    IF audit_changed AND NOT override_changed THEN
      RAISE EXCEPTION 'بيانات توثيق الرسوب تُدار آلياً ولا يمكن تعديلها مباشرة';
    END IF;
  END IF;

  IF NEW.quality_override THEN
    IF NEW.status <> 'معتمدة' OR COALESCE(NEW.score_possible, 0) <= 0 OR NEW.score_total IS NULL THEN
      RAISE EXCEPTION 'لا يمكن تسجيل الرسوب الاستثنائي قبل اعتماد الزيارة واكتمال درجتها';
    END IF;
    IF override_changed THEN
      IF NOT public.can_manage_branch_visits() THEN
        RAISE EXCEPTION 'تسجيل الرسوب الاستثنائي يتطلب صلاحية إدارة زيارات الفروع';
      END IF;
      IF length(btrim(COALESCE(NEW.quality_override_reason, ''))) < 3 THEN
        RAISE EXCEPTION 'اكتب سبباً واضحاً لرسوب الجودة الاستثنائي';
      END IF;
      IF length(btrim(COALESCE(NEW.observation, ''))) < 3 THEN
        RAISE EXCEPTION 'سجّل الملاحظة الخطيرة قبل اعتماد الرسوب الاستثنائي';
      END IF;
      NEW.quality_override_by := auth.uid();
      NEW.quality_override_at := now();
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.quality_override_by := OLD.quality_override_by;
      NEW.quality_override_at := OLD.quality_override_at;
    END IF;
    NEW.quality_status := 'راسب';
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.quality_override AND override_changed AND NOT public.can_manage_branch_visits() THEN
      RAISE EXCEPTION 'إلغاء الرسوب الاستثنائي يتطلب صلاحية إدارة زيارات الفروع';
    END IF;
    NEW.quality_override_reason := NULL;
    NEW.quality_override_by := NULL;
    NEW.quality_override_at := NULL;
    IF NEW.status = 'معتمدة' AND COALESCE(NEW.score_possible, 0) > 0 AND NEW.score_total IS NOT NULL THEN
      NEW.quality_status := CASE
        WHEN NEW.score_total * 100 < NEW.score_possible * 70 THEN 'راسب'
        ELSE 'ناجح'
      END;
    ELSE
      NEW.quality_status := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS derive_supervisory_visit_quality_before_write ON public.supervisory_visits;
CREATE TRIGGER derive_supervisory_visit_quality_before_write
  BEFORE INSERT OR UPDATE OF score_total, score_possible, score_percentage, status, observation,
    quality_status, quality_override, quality_override_reason, quality_override_by, quality_override_at
  ON public.supervisory_visits
  FOR EACH ROW EXECUTE FUNCTION public.derive_supervisory_visit_quality();
REVOKE ALL ON FUNCTION public.derive_supervisory_visit_quality() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.derive_supervisory_visit_quality() TO authenticated;

-- Backfill only the derived quality label for completed historical visits with saved grades.
UPDATE public.supervisory_visits
   SET quality_status = CASE
     WHEN score_total * 100 < score_possible * 70 THEN 'راسب'
     ELSE 'ناجح'
   END
 WHERE status = 'معتمدة'
   AND COALESCE(score_possible, 0) > 0
   AND score_total IS NOT NULL
   AND quality_override = false
   AND quality_status IS DISTINCT FROM CASE
     WHEN score_total * 100 < score_possible * 70 THEN 'راسب'
     ELSE 'ناجح'
   END;

-- Accept the new 19-item model and existing legacy 15-item drafts.
CREATE OR REPLACE FUNCTION public.complete_branch_visit_assignment(p_assignment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  assignment_row public.branch_visit_assignments%ROWTYPE;
  visit_row public.supervisory_visits%ROWTYPE;
  performer_role text;
  legacy_mode boolean;
  expected_codes text[];
  expected_count integer;
  criteria_count integer;
  result_count integer;
  calc_score_total numeric;
  calc_score_possible numeric;
  calc_perfect_count integer;
BEGIN
  SELECT * INTO assignment_row
  FROM public.branch_visit_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التكليف غير موجود'; END IF;

  SELECT p.role INTO performer_role
  FROM public.profiles AS p
  WHERE p.id = auth.uid() AND p.status = 'active';
  IF performer_role IS NULL THEN RAISE EXCEPTION 'الحساب غير نشط'; END IF;
  IF NOT public.can_manage_branch_visits() AND assignment_row.assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'لا تملك صلاحية إغلاق هذا التكليف';
  END IF;
  IF assignment_row.status = 'completed' THEN
    IF public.can_manage_branch_visits() OR EXISTS (
      SELECT 1 FROM public.supervisory_visits AS v
      WHERE v.assignment_id = p_assignment_id AND v.signed_by = auth.uid()
    ) THEN RETURN true; END IF;
    RAISE EXCEPTION 'لا تملك صلاحية الاطلاع على هذا التكليف';
  END IF;
  IF assignment_row.status <> 'assigned' THEN RAISE EXCEPTION 'لا يمكن إغلاق تكليف ملغى'; END IF;

  SELECT * INTO visit_row
  FROM public.supervisory_visits AS v
  WHERE v.assignment_id = p_assignment_id
    AND v.branch_id = assignment_row.branch_id
    AND v.visit_date = assignment_row.visit_date
    AND v.shift_type = assignment_row.shift_type
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يمكن إغلاق التكليف قبل حفظ مسودة التقرير'; END IF;
  IF visit_row.status <> 'مسودة' OR visit_row.signed_by IS NOT NULL OR visit_row.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'حالة التقرير لا تسمح بإغلاق التكليف';
  END IF;

  legacy_mode := COALESCE(visit_row.assessment_version, 1) = 1;
  IF legacy_mode THEN
    expected_codes := ARRAY['BRV-CLEAN-01','BRV-CLEAN-02','BRV-CLEAN-03','BRV-CLEAN-04','BRV-CLEAN-05','BRV-CLEAN-06','BRV-HYGIENE-01','BRV-CUSTOMER-01','BRV-CUSTOMER-02','BRV-CUSTOMER-03','BRV-CUSTOMER-04','BRV-INVENTORY-01','BRV-INVENTORY-02','BRV-OPS-01','BRV-GOV-01']::text[];
    expected_count := 15;
  ELSE
    expected_codes := ARRAY['BRV-CLEAN-01','BRV-CLEAN-02','BRV-CLEAN-03','BRV-CLEAN-04','BRV-CLEAN-05','BRV-CLEAN-06','BRV-HYGIENE-01','BRV-CUSTOMER-01','BRV-CUSTOMER-02','BRV-CUSTOMER-03','BRV-CUSTOMER-04','BRV-INVENTORY-01','BRV-INVENTORY-02','BRV-OPS-01','BRV-GOV-FIRE','BRV-GOV-EQUIPMENT','BRV-GOV-MUNICIPAL','BRV-GOV-FOOD','BRV-GOV-GMP']::text[];
    expected_count := 19;
  END IF;

  SELECT count(*) INTO criteria_count
  FROM public.visit_checklist_templates AS t
  WHERE t.code = ANY (expected_codes)
    AND (t.active OR (legacy_mode AND t.code = 'BRV-GOV-01'))
    AND (t.branch_id IS NULL OR t.branch_id = visit_row.branch_id)
    AND (t.shift_type IS NULL OR t.shift_type = visit_row.shift_type);
  IF criteria_count <> expected_count THEN
    RAISE EXCEPTION 'يجب أن يحتوي نموذج الزيارة على % معياراً، الموجود حالياً: %', expected_count, criteria_count;
  END IF;

  SELECT count(*) INTO result_count
  FROM public.supervisory_visit_results AS r
  JOIN public.visit_checklist_templates AS t ON t.id = r.item_id
  WHERE r.visit_id = visit_row.id
    AND t.code = ANY (expected_codes)
    AND (t.active OR (legacy_mode AND t.code = 'BRV-GOV-01'))
    AND (t.branch_id IS NULL OR t.branch_id = visit_row.branch_id)
    AND (t.shift_type IS NULL OR t.shift_type = visit_row.shift_type);
  IF result_count <> criteria_count OR EXISTS (
    SELECT 1 FROM public.visit_checklist_templates AS t
    WHERE t.code = ANY (expected_codes)
      AND (t.active OR (legacy_mode AND t.code = 'BRV-GOV-01'))
      AND (t.branch_id IS NULL OR t.branch_id = visit_row.branch_id)
      AND (t.shift_type IS NULL OR t.shift_type = visit_row.shift_type)
      AND NOT EXISTS (
        SELECT 1 FROM public.supervisory_visit_results AS r
        WHERE r.visit_id = visit_row.id AND r.item_id = t.id
      )
  ) THEN RAISE EXCEPTION 'لا يمكن اعتماد الزيارة قبل تقييم جميع المعايير'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supervisory_visit_results AS r
    JOIN public.visit_checklist_templates AS t ON t.id = r.item_id
    WHERE r.visit_id = visit_row.id
      AND (
        NOT (t.active OR (legacy_mode AND t.code = 'BRV-GOV-01'))
        OR NOT (t.code = ANY (expected_codes))
        OR (t.branch_id IS NOT NULL AND t.branch_id <> visit_row.branch_id)
        OR (t.shift_type IS NOT NULL AND t.shift_type <> visit_row.shift_type)
        OR r.result = 'غير مكتمل'
        OR (r.score IS NULL AND r.result <> 'لا ينطبق')
        OR (r.score IS NOT NULL AND r.result = 'لا ينطبق')
        OR (t.code <> 'BRV-GOV-01' AND r.score IS NOT NULL AND r.score NOT IN (0, 5, 10))
      )
  ) THEN RAISE EXCEPTION 'توجد نتيجة غير مكتملة أو غير مطابقة لمعايير التقييم'; END IF;

  IF legacy_mode AND EXISTS (
    SELECT 1
    FROM public.supervisory_visit_results AS r
    JOIN public.visit_checklist_templates AS t ON t.id = r.item_id
    WHERE r.visit_id = visit_row.id AND t.code = 'BRV-GOV-01'
      AND (
        jsonb_array_length(r.subchecks) <> 5
        OR EXISTS (
          SELECT 1 FROM unnest(ARRAY['GOV-FIRE','GOV-EQUIPMENT','GOV-MUNICIPAL','GOV-FOOD','GOV-GMP']::text[]) AS expected(code)
          WHERE (SELECT count(*) FROM jsonb_array_elements(r.subchecks) AS item(value)
                 WHERE item.value->>'code' = expected.code
                   AND jsonb_typeof(item.value->'score') = 'number'
                   AND item.value->>'score' IN ('0','5','10')) <> 1
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(r.subchecks) AS item(value)
          WHERE jsonb_typeof(item.value) <> 'object'
             OR item.value->>'code' NOT IN ('GOV-FIRE','GOV-EQUIPMENT','GOV-MUNICIPAL','GOV-FOOD','GOV-GMP')
             OR jsonb_typeof(item.value->'score') <> 'number'
             OR item.value->>'score' NOT IN ('0','5','10')
        )
        OR r.score IS DISTINCT FROM (
          SELECT round(avg((item.value->>'score')::numeric))::integer
          FROM jsonb_array_elements(r.subchecks) AS item(value)
        )
      )
  ) THEN RAISE EXCEPTION 'يجب تسجيل النقاط الحكومية الخمس القديمة كلٌّ على حدة وبدرجة صحيحة'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supervisory_visit_results AS r
    WHERE r.visit_id = visit_row.id
      AND r.is_violation = true
      AND NOT EXISTS (
        SELECT 1 FROM public.visit_action_items AS ai
        WHERE ai.visit_id = visit_row.id AND ai.result_id = r.id
          AND ai.item_type IN ('مخالفة','تكليف')
          AND ai.assigned_to IS NOT NULL AND ai.created_by = auth.uid()
      )
  ) THEN RAISE EXCEPTION 'سجّل نوع الإجراء وحدد الموظف المسؤول قبل اعتماد الزيارة'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.supervisory_visit_results AS r
    JOIN public.visit_checklist_templates AS t ON t.id = r.item_id
    JOIN public.visit_action_items AS ai ON ai.visit_id = r.visit_id AND ai.result_id = r.id
    WHERE r.visit_id = visit_row.id
      AND ai.item_type = 'مخالفة'
      AND t.requires_photo_on_violation
      AND NOT EXISTS (
        SELECT 1 FROM public.visit_evidence AS e
        WHERE e.visit_id = r.visit_id AND e.result_id = r.id
          AND e.uploaded_by = auth.uid() AND e.file_path IS NOT NULL
      )
  ) THEN RAISE EXCEPTION 'أرفق صورة لكل مخالفة قبل اعتماد الزيارة'; END IF;

  SELECT COALESCE(sum(r.score), 0), count(r.score) * 10,
         count(*) FILTER (WHERE r.score = 10)
    INTO calc_score_total, calc_score_possible, calc_perfect_count
  FROM public.supervisory_visit_results AS r
  JOIN public.visit_checklist_templates AS t ON t.id = r.item_id
  WHERE r.visit_id = visit_row.id
    AND t.code = ANY (expected_codes)
    AND (t.active OR (legacy_mode AND t.code = 'BRV-GOV-01'));

  UPDATE public.supervisory_visits
     SET status = 'معتمدة',
         score_total = calc_score_total,
         score_possible = calc_score_possible,
         score_percentage = CASE WHEN calc_score_possible > 0 THEN round(calc_score_total / calc_score_possible * 100) ELSE 0 END,
         score = CASE WHEN calc_score_possible > 0 THEN round(calc_score_total / calc_score_possible * 100) ELSE 0 END,
         checklist_total = calc_score_possible,
         checklist_done = calc_perfect_count,
         signed_by = auth.uid(),
         signed_by_role = performer_role,
         signed_at = now(),
         signature_method = 'حساب المستخدم'
   WHERE id = visit_row.id;

  UPDATE public.branch_visit_assignments
     SET status = 'completed', completed_at = now(), updated_at = now()
   WHERE id = p_assignment_id AND status = 'assigned';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_branch_visit_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_branch_visit_assignment(uuid) TO authenticated;
