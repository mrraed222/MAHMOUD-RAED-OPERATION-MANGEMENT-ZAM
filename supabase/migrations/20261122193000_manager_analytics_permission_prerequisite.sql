-- The recipient migration immediately after this one filters Manager recipients
-- by analytics permission. Add the nullable compatibility column first; the
-- later Manager permission migration backfills values and makes it NOT NULL.
BEGIN;

ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS can_view_analytics boolean;

COMMIT;
