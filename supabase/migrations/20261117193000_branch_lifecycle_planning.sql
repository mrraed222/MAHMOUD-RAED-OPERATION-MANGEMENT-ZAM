BEGIN;

-- Existing branches remain NULL so their current behavior is preserved.
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS lifecycle_status text
  CHECK (lifecycle_status IN ('planned', 'operational'));

-- New branches are inactive/planned by default.
ALTER TABLE public.branches
  ALTER COLUMN lifecycle_status SET DEFAULT 'planned';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS planned_opening_date date;

COMMENT ON COLUMN public.branches.lifecycle_status IS
  'planned hides the branch from live task lists and operational counters until its confirmed opening date; operational is explicitly active; NULL preserves legacy behavior pending owner review.';
COMMENT ON COLUMN public.branches.planned_opening_date IS
  'Owner-confirmed local opening date in Asia/Riyadh; NULL means no confirmed date and does not activate a planned branch.';

COMMIT;
