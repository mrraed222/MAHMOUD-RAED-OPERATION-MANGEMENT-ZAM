-- Apply only verified ZAM Operation checklist changes while preserving existing rows and log history.
-- Global templates are versioned; Al-Burj lounge and old recurring receiving templates are archived.
-- All branch scopes are checked before any write. No roles, permissions, assignments, or Sheets data change.
BEGIN;

CREATE TEMP TABLE zam_checklist_version_updates (
  source_id uuid PRIMARY KEY,
  expected_title text NOT NULL,
  expected_category text NOT NULL,
  expected_shift text NOT NULL,
  expected_frequency text NOT NULL,
  expected_day_of_week integer,
  expected_days_of_week integer[] NOT NULL,
  expected_requires_photo boolean NOT NULL,
  expected_instructions text,
  next_title text,
  next_shift text,
  next_instructions text
) ON COMMIT DROP;

INSERT INTO zam_checklist_version_updates (
  source_id, expected_title, expected_category, expected_shift, expected_frequency,
  expected_day_of_week, expected_days_of_week, expected_requires_photo, expected_instructions,
  next_title, next_shift, next_instructions
) VALUES
  (
    '8fa8b5d3-7d1b-4848-9477-d72e74cc2c69',
    'فحص جاهزية البار ودفعات اليوم', 'البار', 'Morning', 'daily', NULL, '{}'::integer[], false,
    'الماكينة تعمل مسبقاً؛ تحقق من التعبئة والجاهزية. راجع دفعات البن المطلوبة لليوم بالكميات الموصى بها، الوصفات والخلطات، الجودة والصلاحية. دوّن أي مشكلة أو نقص في الملاحظات، وارفع الأعطال والنواقص للمشرف. نفّذ الجرد حسب تعليماته.',
    'تشغيل ماكينة الإسبريسو وتجهيز دفعات اليوم', 'Morning',
    'في بداية الشفت، شغّل ماكينة الإسبريسو والمعدات وتحقق من التعبئة والجاهزية وفق تعليمات التشغيل. حضّر دفعات القهوة المطلوبة لليوم بالكميات الموصى بها من الإدارة، وراجع الوصفات والخلطات والجودة والصلاحية. دوّن أي مشكلة أو نقص وارفع الأعطال والنواقص للمشرف.'
  ),
  (
    '3d5d4b69-bfa3-4faa-afd0-6cb8b95ac7f4',
    'تنظيف ماكينة الإسبريسو وعصا البخار بالماء والفرشاة', 'البار', 'Both', 'weekly', 1, ARRAY[1]::integer[], false,
    'في هذا اليوم غير الكيميائي: نظّف الأجزاء المحددة من ماكينة الإسبريسو وعصا البخار بالماء والفرشاة المخصصة وفق تعليمات الشركة المصنّعة. لا تستخدم مادة كيميائية في هذا الإجراء، وأبلغ المشرف عن أي خلل.',
    NULL, 'Evening', NULL
  ),
  (
    'e13163ba-0456-4eb4-a3df-6e3398f2f113',
    'تنظيف ماكينة الإسبريسو وعصا البخار بالماء والفرشاة', 'البار', 'Both', 'weekly', 3, ARRAY[3]::integer[], false,
    'في هذا اليوم غير الكيميائي: نظّف الأجزاء المحددة من ماكينة الإسبريسو وعصا البخار بالماء والفرشاة المخصصة وفق تعليمات الشركة المصنّعة. لا تستخدم مادة كيميائية في هذا الإجراء، وأبلغ المشرف عن أي خلل.',
    NULL, 'Evening', NULL
  ),
  (
    'dee28cc6-0b71-425d-880c-da71c532e0d3',
    'تنظيف ماكينة الإسبريسو وعصا البخار بالماء والفرشاة', 'البار', 'Both', 'weekly', 5, ARRAY[5]::integer[], false,
    'في هذا اليوم غير الكيميائي: نظّف الأجزاء المحددة من ماكينة الإسبريسو وعصا البخار بالماء والفرشاة المخصصة وفق تعليمات الشركة المصنّعة. لا تستخدم مادة كيميائية في هذا الإجراء، وأبلغ المشرف عن أي خلل.',
    NULL, 'Evening', NULL
  ),
  (
    'e228e4a2-41f7-49d8-be3e-7c1805aa25b5',
    'تنظيف ماكينة الإسبريسو وعصا البخار بالماء والفرشاة', 'البار', 'Both', 'weekly', 6, ARRAY[6]::integer[], false,
    'في هذا اليوم غير الكيميائي: نظّف الأجزاء المحددة من ماكينة الإسبريسو وعصا البخار بالماء والفرشاة المخصصة وفق تعليمات الشركة المصنّعة. لا تستخدم مادة كيميائية في هذا الإجراء، وأبلغ المشرف عن أي خلل.',
    NULL, 'Evening', NULL
  ),
  (
    'c1be4246-5188-405b-9b85-868743a0dbc6',
    'التنظيف الكيميائي لماكينة الإسبريسو', 'البار', 'Evening', 'weekly', 0, ARRAY[0]::integer[], false,
    'تنظيف كيميائي في هذا اليوم فقط. استخدم المادة والجرعة والطريقة المحددة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة والأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.',
    'التنظيف الكيميائي لماكينة الإسبريسو وعصا البخار', 'Evening',
    'نظّف ماكينة الإسبريسو وعصا البخار كيميائياً في هذا اليوم فقط، باستخدام المادة والجرعة والطريقة المعتمدة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة وعصا البخار وجميع الأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.'
  ),
  (
    'b7d39580-0ffa-4d41-8ea0-f3aa3b863f2c',
    'التنظيف الكيميائي لماكينة الإسبريسو', 'البار', 'Evening', 'weekly', 2, ARRAY[2]::integer[], false,
    'تنظيف كيميائي في هذا اليوم فقط. استخدم المادة والجرعة والطريقة المحددة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة والأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.',
    'التنظيف الكيميائي لماكينة الإسبريسو وعصا البخار', 'Evening',
    'نظّف ماكينة الإسبريسو وعصا البخار كيميائياً في هذا اليوم فقط، باستخدام المادة والجرعة والطريقة المعتمدة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة وعصا البخار وجميع الأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.'
  ),
  (
    '64d373a0-3bab-4ec7-9d23-b31a0f311d45',
    'التنظيف الكيميائي لماكينة الإسبريسو', 'البار', 'Evening', 'weekly', 4, ARRAY[4]::integer[], false,
    'تنظيف كيميائي في هذا اليوم فقط. استخدم المادة والجرعة والطريقة المحددة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة والأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.',
    'التنظيف الكيميائي لماكينة الإسبريسو وعصا البخار', 'Evening',
    'نظّف ماكينة الإسبريسو وعصا البخار كيميائياً في هذا اليوم فقط، باستخدام المادة والجرعة والطريقة المعتمدة من الشركة المصنّعة للمادة والمعدة، مع معدات الوقاية اللازمة. اشطف الماكينة وعصا البخار وجميع الأجزاء الملامسة للمشروب جيداً قبل إعادتها للخدمة.'
  );

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM zam_checklist_version_updates) <> 8 THEN
    RAISE EXCEPTION 'Checklist version preflight failed: expected eight explicitly mapped templates';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM zam_checklist_version_updates AS expected
    LEFT JOIN public.checklist_templates AS actual ON actual.id = expected.source_id
    WHERE actual.id IS NULL
       OR actual.is_active IS DISTINCT FROM true
       OR actual.task_title IS DISTINCT FROM expected.expected_title
       OR actual.category IS DISTINCT FROM expected.expected_category
       OR actual.shift_type IS DISTINCT FROM expected.expected_shift
       OR actual.frequency IS DISTINCT FROM expected.expected_frequency
       OR actual.day_of_week IS DISTINCT FROM expected.expected_day_of_week
       OR actual.days_of_week IS DISTINCT FROM expected.expected_days_of_week
       OR actual.requires_photo IS DISTINCT FROM expected.expected_requires_photo
       OR actual.instructions IS DISTINCT FROM expected.expected_instructions
       OR actual.branch_id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.checklist_template_branches AS scope
         WHERE scope.template_id = expected.source_id
       )
  ) THEN
    RAISE EXCEPTION 'Checklist version preflight failed: an active Barista template or its global scope no longer matches the verified source';
  END IF;

  IF (
    SELECT count(*)
    FROM (VALUES
      ('3f564320-154c-47f0-9fd0-addaf86c6c63'::uuid, 'استلام طلبيات المخبوزات ومطابقتها بالفاتورة'),
      ('35292519-ac74-4b51-a13d-15f14dc1ea23'::uuid, 'مطابقة التوريدات وتخزينها خلال 20 دقيقة')
    ) AS expected(id, title)
    JOIN public.checklist_templates AS t ON t.id = expected.id
    WHERE t.is_active = true
      AND t.task_title = expected.title
      AND t.category = 'المطبخ'
      AND t.task_type = 'standard'
      AND t.frequency = 'daily'
      AND t.branch_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.checklist_template_branches AS scope WHERE scope.template_id = t.id)
  ) <> 2 THEN
    RAISE EXCEPTION 'Receiving-template archival preflight failed: the two verified daily templates, titles, or global scopes changed';
  END IF;

  IF (
    SELECT count(*)
    FROM public.checklist_templates AS t
    WHERE t.id IN (
      'bf6289a4-3a9a-4544-be7c-7dfa96663990'::uuid,
      '87b247e5-19c4-4bca-a0d1-0d1a46aa713d'::uuid,
      'aab7c88b-8d1a-46a4-a8e2-4b2834e33358'::uuid,
      '6482b9fd-0a0b-49ba-a716-b76b837270e4'::uuid,
      '32a101da-4e06-4480-a7bb-980a332c862b'::uuid,
      'be3e4e4e-436e-483c-a2cc-775d31dd6050'::uuid,
      '2a2c19d4-4e51-4a80-b245-20c5c37c872a'::uuid,
      '74f2a992-3393-4f1b-ae2c-20f1ac5b7e9b'::uuid,
      '022f4ba4-acb8-40aa-a1a0-7c9f13398fe9'::uuid,
      '2dbd246b-e215-4b54-9f4a-62431b681e69'::uuid,
      'eec47f75-e2a2-47e6-9cfe-5c4a0607d44e'::uuid
    )
      AND t.is_active = true
      AND t.category = 'الصالة'
      AND t.branch_id = '41f2dea8-238a-4550-abc8-b1a8a505f3d2'::uuid
      AND EXISTS (
        SELECT 1 FROM public.checklist_template_branches AS scope
        WHERE scope.template_id = t.id
          AND scope.branch_id = '41f2dea8-238a-4550-abc8-b1a8a505f3d2'::uuid
      )
      AND 1 = (SELECT count(*) FROM public.checklist_template_branches AS scope WHERE scope.template_id = t.id)
  ) <> 11 THEN
    RAISE EXCEPTION 'Al-Burj lounge archival preflight failed: expected exactly the eleven current active lounge templates linked only to Al-Burj';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.checklist_templates AS t
    WHERE t.is_active = true
      AND t.category = 'الصالة'
      AND (t.branch_id = '41f2dea8-238a-4550-abc8-b1a8a505f3d2'::uuid
        OR EXISTS (
          SELECT 1 FROM public.checklist_template_branches AS scope
          WHERE scope.template_id = t.id
            AND scope.branch_id = '41f2dea8-238a-4550-abc8-b1a8a505f3d2'::uuid
        ))
      AND t.id NOT IN (
        'bf6289a4-3a9a-4544-be7c-7dfa96663990'::uuid,
        '87b247e5-19c4-4bca-a0d1-0d1a46aa713d'::uuid,
        'aab7c88b-8d1a-46a4-a8e2-4b2834e33358'::uuid,
        '6482b9fd-0a0b-49ba-a716-b76b837270e4'::uuid,
        '32a101da-4e06-4480-a7bb-980a332c862b'::uuid,
        'be3e4e4e-436e-483c-a2cc-775d31dd6050'::uuid,
        '2a2c19d4-4e51-4a80-b245-20c5c37c872a'::uuid,
        '74f2a992-3393-4f1b-ae2c-20f1ac5b7e9b'::uuid,
        '022f4ba4-acb8-40aa-a1a0-7c9f13398fe9'::uuid,
        '2dbd246b-e215-4b54-9f4a-62431b681e69'::uuid,
        'eec47f75-e2a2-47e6-9cfe-5c4a0607d44e'::uuid
      )
  ) THEN
    RAISE EXCEPTION 'Al-Burj lounge archival preflight failed: an additional active lounge template now targets the bar-only branch';
  END IF;
END;
$preflight$;

DO $version$
DECLARE
  v_update record;
  v_old public.checklist_templates%ROWTYPE;
  v_new_id uuid;
BEGIN
  FOR v_update IN SELECT * FROM zam_checklist_version_updates ORDER BY source_id LOOP
    SELECT * INTO STRICT v_old
      FROM public.checklist_templates AS t
     WHERE t.id = v_update.source_id
       AND t.is_active = true
     FOR UPDATE;

    INSERT INTO public.checklist_templates (
      task_title, category, shift_type, instructions, branch_id, requires_photo,
      target_time, frequency, day_of_week, days_of_week, day_of_month,
      allows_notes, task_type, sort_order, is_active
    ) VALUES (
      COALESCE(v_update.next_title, v_old.task_title),
      v_old.category,
      COALESCE(v_update.next_shift, v_old.shift_type),
      COALESCE(v_update.next_instructions, v_old.instructions),
      v_old.branch_id,
      v_old.requires_photo,
      v_old.target_time,
      v_old.frequency,
      v_old.day_of_week,
      v_old.days_of_week,
      v_old.day_of_month,
      v_old.allows_notes,
      v_old.task_type,
      v_old.sort_order,
      true
    ) RETURNING id INTO v_new_id;

    UPDATE public.checklist_templates
       SET is_active = false
     WHERE id = v_old.id;
  END LOOP;

  -- Preserve historical IDs and logs while removing old repeating delivery tasks;
  -- event-based receipt tasks are created from actual receipt events instead.
  UPDATE public.checklist_templates
     SET is_active = false
   WHERE id IN (
     '3f564320-154c-47f0-9fd0-addaf86c6c63'::uuid,
     '35292519-ac74-4b51-a13d-15f14dc1ea23'::uuid
   )
     AND is_active = true;

  -- Al-Burj is bar-only. Archive only its current lounge templates; preserve all other categories.
  UPDATE public.checklist_templates
     SET is_active = false
   WHERE id IN (
     'bf6289a4-3a9a-4544-be7c-7dfa96663990'::uuid,
     '87b247e5-19c4-4bca-a0d1-0d1a46aa713d'::uuid,
     'aab7c88b-8d1a-46a4-a8e2-4b2834e33358'::uuid,
     '6482b9fd-0a0b-49ba-a716-b76b837270e4'::uuid,
     '32a101da-4e06-4480-a7bb-980a332c862b'::uuid,
     'be3e4e4e-436e-483c-a2cc-775d31dd6050'::uuid,
     '2a2c19d4-4e51-4a80-b245-20c5c37c872a'::uuid,
     '74f2a992-3393-4f1b-ae2c-20f1ac5b7e9b'::uuid,
     '022f4ba4-acb8-40aa-a1a0-7c9f13398fe9'::uuid,
     '2dbd246b-e215-4b54-9f4a-62431b681e69'::uuid,
     'eec47f75-e2a2-47e6-9cfe-5c4a0607d44e'::uuid
   )
     AND is_active = true;
END;
$version$;

COMMIT;
