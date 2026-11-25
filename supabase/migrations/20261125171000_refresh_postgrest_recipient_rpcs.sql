BEGIN;

-- Refresh PostgREST's function cache after the daily-report recipient RPCs
-- are installed. Applying this migration does not modify application data or RLS.
NOTIFY pgrst, 'reload schema';

COMMIT;
