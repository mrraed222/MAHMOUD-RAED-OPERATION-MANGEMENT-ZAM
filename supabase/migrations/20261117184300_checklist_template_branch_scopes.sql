-- Approved additive branch-scope migration for ZAM Operation; SQL body matches the reviewed draft.
-- Project: ZAM Operation (uuphgpncmiwyigtqhjmd).
-- This draft is additive: it does not alter existing checklist_templates rows,
-- branch_id values, template IDs, checklist log links, roles, or existing RLS.
BEGIN;

CREATE TABLE IF NOT EXISTS public.checklist_template_branches (
  template_id uuid NOT NULL
    REFERENCES public.checklist_templates(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL
    REFERENCES public.branches(id) ON DELETE RESTRICT,
  CONSTRAINT checklist_template_branches_pkey PRIMARY KEY (template_id, branch_id)
);

CREATE INDEX IF NOT EXISTS checklist_template_branches_branch_id_idx
  ON public.checklist_template_branches (branch_id);

COMMENT ON TABLE public.checklist_template_branches IS
  'Draft-approved use: additional branch scopes for checklist template versions; checklist_templates.branch_id remains the legacy fallback.';
COMMENT ON COLUMN public.checklist_template_branches.template_id IS
  'References the exact checklist template version; archived versions retain their original branch links.';
COMMENT ON COLUMN public.checklist_template_branches.branch_id IS
  'A branch where this exact checklist template version applies.';

-- Preserve all existing template IDs and branch_id values. Backfill one scope row
-- for every existing branch-specific template, including archived versions.
INSERT INTO public.checklist_template_branches (template_id, branch_id)
SELECT t.id, t.branch_id
FROM public.checklist_templates AS t
WHERE t.branch_id IS NOT NULL
ON CONFLICT (template_id, branch_id) DO NOTHING;

ALTER TABLE public.checklist_template_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checklist_template_branches FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.checklist_template_branches TO authenticated;

DROP POLICY IF EXISTS "Users read active checklist template branches"
  ON public.checklist_template_branches;
CREATE POLICY "Users read active checklist template branches"
  ON public.checklist_template_branches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.checklist_templates AS t
      WHERE t.id = checklist_template_branches.template_id
        AND (t.is_active OR public.has_admin_permission('templates'))
    )
  );

-- Writes happen only through the permission-checked SECURITY DEFINER RPC below;
-- direct INSERT/UPDATE/DELETE grants and policies are intentionally absent.

CREATE OR REPLACE FUNCTION public.save_checklist_template_with_branches(
  p_template_id uuid,
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
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_branch_ids uuid[] := '{}'::uuid[];
  v_legacy_branch_id uuid;
  v_new_id uuid;
  v_template public.checklist_templates%ROWTYPE;
BEGIN
  IF NOT public.has_admin_permission('templates') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إدارة قوالب المهام';
  END IF;
  IF pg_catalog.jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'بيانات القالب غير صالحة';
  END IF;
  IF p_is_global IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد ما إذا كان القالب عاماً أو محدداً للفروع';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(d.branch_id ORDER BY d.branch_id), '{}'::uuid[])
    INTO v_branch_ids
    FROM (
      SELECT DISTINCT supplied.branch_id
      FROM pg_catalog.unnest(COALESCE(p_branch_ids, '{}'::uuid[])) AS supplied(branch_id)
      WHERE supplied.branch_id IS NOT NULL
    ) AS d;

  IF p_is_global THEN
    IF pg_catalog.cardinality(v_branch_ids) > 0 THEN
      RAISE EXCEPTION 'القالب العام لا يمكن أن يحتوي فروعاً محددة';
    END IF;
    v_legacy_branch_id := NULL;
  ELSE
    IF pg_catalog.cardinality(v_branch_ids) = 0 THEN
      RAISE EXCEPTION 'اختر فرعاً واحداً على الأقل أو اختر كل الفروع';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(v_branch_ids) AS selected(branch_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.branches AS b WHERE b.id = selected.branch_id
      )
    ) THEN
      RAISE EXCEPTION 'يتضمن الاختيار فرعاً غير موجود';
    END IF;
    -- Keep branch_id populated as a safe, deterministic fallback for older clients.
    -- The new relationship rows below are authoritative for the full multi-branch scope.
    v_legacy_branch_id := v_branch_ids[1];
  END IF;

  v_payload := v_payload || pg_catalog.jsonb_build_object('branch_id', v_legacy_branch_id);

  IF p_template_id IS NULL THEN
    v_template := pg_catalog.jsonb_populate_record(NULL::public.checklist_templates, v_payload);
    INSERT INTO public.checklist_templates (
      task_title, category, shift_type, instructions, branch_id, requires_photo,
      target_time, frequency, day_of_week, days_of_week, day_of_month,
      allows_notes, task_type, sort_order, is_active
    ) VALUES (
      NULLIF(v_template.task_title, ''),
      NULLIF(v_template.category, ''),
      COALESCE(NULLIF(v_template.shift_type, ''), 'Morning'),
      v_template.instructions,
      v_legacy_branch_id,
      COALESCE(v_template.requires_photo, false),
      v_template.target_time,
      COALESCE(NULLIF(v_template.frequency, ''), 'daily'),
      v_template.day_of_week,
      COALESCE(v_template.days_of_week, '{}'::integer[]),
      v_template.day_of_month,
      COALESCE(v_template.allows_notes, true),
      COALESCE(NULLIF(v_template.task_type, ''), 'standard'),
      COALESCE(v_template.sort_order, 0),
      true
    ) RETURNING id INTO v_new_id;
  ELSE
    -- The existing RPC inserts the new version and archives the old version in
    -- this same transaction. A failure inserting the scope rows rolls both back.
    v_new_id := public.version_checklist_template(p_template_id, v_payload);
  END IF;

  IF NOT p_is_global THEN
    INSERT INTO public.checklist_template_branches (template_id, branch_id)
    SELECT v_new_id, selected.branch_id
    FROM pg_catalog.unnest(v_branch_ids) AS selected(branch_id)
    ON CONFLICT (template_id, branch_id) DO NOTHING;
  END IF;

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_checklist_template_with_branches(uuid, jsonb, uuid[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_checklist_template_with_branches(uuid, jsonb, uuid[], boolean)
  TO authenticated;

COMMIT;
