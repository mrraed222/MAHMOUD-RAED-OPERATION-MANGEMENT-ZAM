-- Add a separate editable follow-up comment for technical issues.
-- The original technical_issues.description remains unchanged.
-- No existing data, IDs, relations, RLS policies, grants, or role scope are modified.

BEGIN;

ALTER TABLE public.technical_issues
  ADD COLUMN IF NOT EXISTS internal_comment text;

COMMENT ON COLUMN public.technical_issues.internal_comment IS
  'Mutable internal follow-up comment. The original report remains in description.';

COMMIT;
