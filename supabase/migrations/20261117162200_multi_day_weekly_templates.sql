-- Adds multi-day weekly recurrence while preserving the legacy day_of_week column and versioning behavior.
BEGIN;

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS days_of_week integer[];

UPDATE public.checklist_templates
   SET days_of_week = '{}'::integer[]
 WHERE days_of_week IS NULL;

-- Backfill existing one-day templates without merging or archiving any task rows.
UPDATE public.checklist_templates
   SET days_of_week = ARRAY[day_of_week]::integer[]
 WHERE frequency = 'weekly'
   AND day_of_week BETWEEN 0 AND 6
   AND cardinality(days_of_week) = 0;

ALTER TABLE public.checklist_templates
  ALTER COLUMN days_of_week SET DEFAULT '{}'::integer[],
  ALTER COLUMN days_of_week SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.checklist_templates'::regclass
       AND conname = 'checklist_templates_days_of_week_valid'
  ) THEN
    ALTER TABLE public.checklist_templates
      ADD CONSTRAINT checklist_templates_days_of_week_valid
      CHECK (
        cardinality(days_of_week) <= 7
        AND days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::integer[]
        AND array_position(days_of_week, NULL::integer) IS NULL
      );
  END IF;
END
$migration$;

-- Keep old clients that write only day_of_week functional. New clients write both columns.
CREATE OR REPLACE FUNCTION public.sync_checklist_template_weekdays()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF pg_catalog.cardinality(NEW.days_of_week) = 0 THEN
      IF NEW.day_of_week BETWEEN 0 AND 6 THEN
        NEW.days_of_week := ARRAY[NEW.day_of_week]::integer[];
      END IF;
    ELSE
      NEW.day_of_week := NEW.days_of_week[1];
    END IF;
  ELSIF NEW.days_of_week IS DISTINCT FROM OLD.days_of_week THEN
    IF pg_catalog.cardinality(NEW.days_of_week) = 0 THEN
      IF NEW.day_of_week BETWEEN 0 AND 6 THEN
        NEW.days_of_week := ARRAY[NEW.day_of_week]::integer[];
      ELSE
        NEW.day_of_week := NULL;
      END IF;
    ELSE
      NEW.day_of_week := NEW.days_of_week[1];
    END IF;
  ELSIF NEW.day_of_week IS DISTINCT FROM OLD.day_of_week THEN
    IF NEW.day_of_week BETWEEN 0 AND 6 THEN
      NEW.days_of_week := ARRAY[NEW.day_of_week]::integer[];
    ELSE
      NEW.days_of_week := '{}'::integer[];
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_checklist_template_weekdays() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS checklist_templates_sync_weekdays ON public.checklist_templates;
CREATE TRIGGER checklist_templates_sync_weekdays
BEFORE INSERT OR UPDATE ON public.checklist_templates
FOR EACH ROW EXECUTE FUNCTION public.sync_checklist_template_weekdays();

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
    target_time, frequency, day_of_week, days_of_week, day_of_month, allows_notes, task_type,
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
    CASE
      WHEN v_payload ? 'days_of_week' AND pg_catalog.jsonb_typeof(v_payload -> 'days_of_week') = 'array'
        THEN ARRAY(SELECT day_value::integer FROM pg_catalog.jsonb_array_elements_text(v_payload -> 'days_of_week') AS item(day_value))
      WHEN v_payload ? 'day_of_week'
        THEN CASE
          WHEN NULLIF(v_payload ->> 'day_of_week', '')::integer BETWEEN 0 AND 6
            THEN ARRAY[NULLIF(v_payload ->> 'day_of_week', '')::integer]
          ELSE '{}'::integer[]
        END
      ELSE v_old.days_of_week
    END,
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

COMMIT;
