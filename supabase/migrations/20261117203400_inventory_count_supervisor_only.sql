BEGIN;

ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_task_type_check;

ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_task_type_check
  CHECK (task_type IN ('standard', 'fridge_temps', 'inventory_request', 'inventory_count', 'restroom_check'));

-- Keep the three existing global chemical espresso-cleaning templates on the night shift only.
UPDATE public.checklist_templates AS t
SET shift_type = 'Evening'
WHERE t.id IN (
    '64d373a0-3bab-4ec7-9d23-b31a0f311d45',
    'b7d39580-0ffa-4d41-8ea0-f3aa3b863f2c',
    'c1be4246-5188-405b-9b85-868743a0dbc6'
  )
  AND t.task_title = 'التنظيف الكيميائي لماكينة الإسبريسو'
  AND t.category = 'البار'
  AND t.frequency = 'weekly'
  AND t.branch_id IS NULL
  AND t.shift_type = 'Both';

-- Inventory-count tasks belong on the supervisor task page only: noon for Morning,
-- midnight for Evening. Preserve template IDs, instructions, days, active state, and branch scopes.
WITH approved_targets(id, expected_shift, scheduled_time) AS (
  VALUES
    ('1358cd34-524d-4afb-93fc-c1be55c52e88'::uuid, 'Morning'::text, '12:00:00'::time),
    ('d509f6e0-0529-4eb7-87ef-93c0807285e9'::uuid, 'Morning'::text, '12:00:00'::time),
    ('249f03e8-b822-4771-a56c-3239e9abda01'::uuid, 'Evening'::text, '00:00:00'::time),
    ('175f2437-f2fa-4259-a2b7-0a8c5c783371'::uuid, 'Evening'::text, '00:00:00'::time),
    ('eac7da7c-4218-4c8c-bfe2-2b7c97026ffd'::uuid, 'Evening'::text, '00:00:00'::time),
    ('530d8f87-0ed8-449e-9b91-0ca07bf55856'::uuid, 'Evening'::text, '00:00:00'::time),
    ('4265d8ba-e70b-488e-823d-5167565e1ce2'::uuid, 'Evening'::text, '00:00:00'::time)
)
UPDATE public.checklist_templates AS t
SET category = 'مهام المشرفين',
    task_type = 'inventory_count',
    target_time = approved_targets.scheduled_time
FROM approved_targets
WHERE t.id = approved_targets.id
  AND t.branch_id IS NULL
  AND t.shift_type = approved_targets.expected_shift
  AND t.task_type IN ('standard', 'inventory_count')
  AND t.category IN ('البار', 'المطبخ', 'مهام المشرفين')
  AND NOT EXISTS (
    SELECT 1
    FROM public.checklist_template_branches AS link
    WHERE link.template_id = t.id
  );

COMMIT;
