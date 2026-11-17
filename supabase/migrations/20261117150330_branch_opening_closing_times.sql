-- Add the approved shared opening and closing times to every existing branch.
-- Defaults populate existing rows and apply to future branches; no IDs, relations, or other data are changed.
BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS opening_time time NOT NULL DEFAULT TIME '05:30',
  ADD COLUMN IF NOT EXISTS closing_time time NOT NULL DEFAULT TIME '02:30';

COMMIT;
