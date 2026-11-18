-- Atomic consolidation of identical active checklist template versions.
-- Project: ZAM Operation (uuphgpncmiwyigtqhjmd).
-- Existing template IDs and checklist log references are retained as archived history.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_checklist_template_group_with_branches(
  p_template_ids uuid[],
  p_payload jsonb,
  p_branch_ids uuid[],
  p_is_global boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[] := p_template_ids;
  v_primary_id uuid;
  v_new_id uuid;
  v_count integer;
  v_signature_count integer;
  v_archived_count integer;
BEGIN
  IF NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;
  IF v_ids IS NULL OR pg_catalog.cardinality(v_ids) < 2 THEN
    RAISE EXCEPTION 'يتطلب دمج المجموعة قالبين نشطين على الأقل';
  END IF;
  IF pg_catalog.array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'معرّف قالب غير صالح ضمن المجموعة';
  END IF;
  IF p_is_global IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد ما إذا كان القالب عاماً أو محدداً للفروع';
  END IF;
  IF pg_catalog.cardinality(v_ids) <> (
    SELECT pg_catalog.count(DISTINCT item_id)::integer
    FROM pg_catalog.unnest(v_ids) AS supplied(item_id)
  ) THEN
    RAISE EXCEPTION 'تتضمن المجموعة معرّفات قوالب مكررة';
  END IF;

  PERFORM 1
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids)
  ORDER BY t.id
  FOR UPDATE;

  SELECT pg_catalog.count(*)::integer
  INTO v_count
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids)
    AND t.is_active IS TRUE;
  IF v_count <> pg_catalog.cardinality(v_ids) THEN
    RAISE EXCEPTION 'تغيّرت المجموعة؛ حدّث الصفحة قبل الحفظ';
  END IF;

  SELECT pg_catalog.count(DISTINCT pg_catalog.jsonb_build_array(
    (t.branch_id IS NULL),
    t.task_title,
    t.category,
    t.shift_type,
    t.instructions,
    COALESCE(t.requires_photo, false),
    pg_catalog.left(t.target_time::text, 5),
    COALESCE(t.frequency, 'daily'),
    t.day_of_week,
    ARRAY(
      SELECT DISTINCT day_value
      FROM pg_catalog.unnest(COALESCE(t.days_of_week, '{}'::integer[])) AS days(day_value)
      ORDER BY day_value
    ),
    t.day_of_month,
    COALESCE(t.allows_notes, true),
    COALESCE(t.task_type, 'standard'),
    COALESCE(t.sort_order, 0)
  ))::integer
  INTO v_signature_count
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids)
    AND t.is_active IS TRUE;
  IF v_signature_count <> 1 THEN
    RAISE EXCEPTION 'لا يمكن دمج قوالب تختلف إعداداتها';
  END IF;

  v_primary_id := v_ids[1];
  v_new_id := public.save_checklist_template_with_branches(
    v_primary_id,
    p_payload,
    p_branch_ids,
    p_is_global
  );

  UPDATE public.checklist_templates AS t
  SET is_active = false
  WHERE t.id = ANY (v_ids[2:pg_catalog.cardinality(v_ids)])
    AND t.is_active IS TRUE;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;
  IF v_archived_count <> pg_catalog.cardinality(v_ids) - 1 THEN
    RAISE EXCEPTION 'تعذرت أرشفة جميع النسخ السابقة؛ أُلغي الحفظ بالكامل';
  END IF;

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_checklist_template_group_with_branches(uuid[], jsonb, uuid[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_checklist_template_group_with_branches(uuid[], jsonb, uuid[], boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_checklist_template_group(
  p_template_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[] := p_template_ids;
  v_count integer;
  v_signature_count integer;
  v_archived_count integer;
BEGIN
  IF NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;
  IF v_ids IS NULL OR pg_catalog.cardinality(v_ids) < 2
     OR pg_catalog.array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'مجموعة القوالب غير صالحة';
  END IF;
  IF pg_catalog.cardinality(v_ids) <> (
    SELECT pg_catalog.count(DISTINCT item_id)::integer
    FROM pg_catalog.unnest(v_ids) AS supplied(item_id)
  ) THEN
    RAISE EXCEPTION 'تتضمن المجموعة معرّفات قوالب مكررة';
  END IF;

  PERFORM 1
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids)
  ORDER BY t.id
  FOR UPDATE;

  SELECT pg_catalog.count(*)::integer
  INTO v_count
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids)
    AND t.is_active IS TRUE;
  IF v_count <> pg_catalog.cardinality(v_ids) THEN
    RAISE EXCEPTION 'تغيّرت المجموعة؛ حدّث الصفحة قبل الأرشفة';
  END IF;

  SELECT pg_catalog.count(DISTINCT pg_catalog.jsonb_build_array(
    (t.branch_id IS NULL),
    t.task_title,
    t.category,
    t.shift_type,
    t.instructions,
    COALESCE(t.requires_photo, false),
    pg_catalog.left(t.target_time::text, 5),
    COALESCE(t.frequency, 'daily'),
    t.day_of_week,
    ARRAY(
      SELECT DISTINCT day_value
      FROM pg_catalog.unnest(COALESCE(t.days_of_week, '{}'::integer[])) AS days(day_value)
      ORDER BY day_value
    ),
    t.day_of_month,
    COALESCE(t.allows_notes, true),
    COALESCE(t.task_type, 'standard'),
    COALESCE(t.sort_order, 0)
  ))::integer
  INTO v_signature_count
  FROM public.checklist_templates AS t
  WHERE t.id = ANY (v_ids)
    AND t.is_active IS TRUE;
  IF v_signature_count <> 1 THEN
    RAISE EXCEPTION 'لا يمكن أرشفة قوالب مختلفة كأنها مجموعة واحدة';
  END IF;

  UPDATE public.checklist_templates AS t
  SET is_active = false
  WHERE t.id = ANY (v_ids)
    AND t.is_active IS TRUE;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;
  IF v_archived_count <> pg_catalog.cardinality(v_ids) THEN
    RAISE EXCEPTION 'تعذرت أرشفة كل النسخ؛ أُلغي التغيير بالكامل';
  END IF;
  RETURN v_archived_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_checklist_template_group(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_checklist_template_group(uuid[])
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
