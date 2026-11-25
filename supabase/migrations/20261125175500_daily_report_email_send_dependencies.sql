-- Reviewed minimal release migration for the live ZAM Operation schema.
-- Adds only report-copy dependencies and exact optional issue/report association; no data backfill/deletion or RLS broadening.
BEGIN;

-- Exact report association; NULL for historical/manual issues. Composite FK prevents cross-branch links.
CREATE UNIQUE INDEX IF NOT EXISTS daily_reports_id_branch_uidx ON public.daily_reports (id, branch_id);
ALTER TABLE public.technical_issues ADD COLUMN IF NOT EXISTS report_id uuid;
DO $migration$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.technical_issues'::regclass AND conname='technical_issues_report_branch_fkey') THEN
  ALTER TABLE public.technical_issues ADD CONSTRAINT technical_issues_report_branch_fkey FOREIGN KEY (report_id, branch_id) REFERENCES public.daily_reports (id, branch_id) ON DELETE SET NULL (report_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.technical_issues'::regclass AND conname='technical_issues_report_manual_source_check') THEN
  ALTER TABLE public.technical_issues ADD CONSTRAINT technical_issues_report_manual_source_check CHECK (report_id IS NULL OR source = 'manual');
 END IF;
END;
$migration$;
CREATE INDEX IF NOT EXISTS technical_issues_report_id_idx ON public.technical_issues (report_id) WHERE report_id IS NOT NULL;
COMMENT ON COLUMN public.technical_issues.report_id IS 'Optional exact daily report association, supplied only when a manual issue is created from a saved report flow; historical issues remain NULL.';

CREATE OR REPLACE FUNCTION public.prevent_technical_issue_report_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.report_id IS DISTINCT FROM OLD.report_id AND NEW.report_id IS NOT NULL THEN
    RAISE EXCEPTION 'technical_issue_report_link_is_creation_only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;REVOKE ALL ON FUNCTION public.prevent_technical_issue_report_reassignment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS technical_issues_report_link_creation_only ON public.technical_issues;
CREATE TRIGGER technical_issues_report_link_creation_only BEFORE UPDATE OF report_id ON public.technical_issues FOR EACH ROW EXECUTE FUNCTION public.prevent_technical_issue_report_reassignment();

-- This restrictive parent check composes with the live branch/role/shift policies.
-- The caller must be able to see the exact parent report before attaching an issue.
DROP POLICY IF EXISTS technical_issues_authorized_report_parent ON public.technical_issues;
CREATE POLICY technical_issues_authorized_report_parent
  ON public.technical_issues
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    report_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.daily_reports AS report
      WHERE report.id = technical_issues.report_id
        AND report.branch_id = technical_issues.branch_id
    )
  )
  WITH CHECK (
    report_id IS NULL OR EXISTS (
      SELECT 1
      FROM public.daily_reports AS report
      WHERE report.id = technical_issues.report_id
        AND report.branch_id = technical_issues.branch_id
    )
  );

CREATE OR REPLACE FUNCTION public.can_generate_daily_report_copy(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_reports AS r
    JOIN public.profiles AS actor ON actor.id = (SELECT auth.uid())
    WHERE r.id = p_report_id
      AND actor.status = 'active'
      AND (
        actor.role IN ('Owner', 'Admin')
        OR (actor.role = 'Manager'
            AND public.can_manager_read_branch('can_view_analytics', r.branch_id))
        OR (actor.role = 'Supervisor'
            AND public.current_supervisor_can_read_daily_report(r.branch_id, r.shift_type))
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_generate_daily_report_copy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_generate_daily_report_copy(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_daily_report_copy_recipients(p_report_id uuid)
RETURNS TABLE (profile_id uuid, email text, is_primary boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_branch_id uuid;
  v_report_shift_type text;
  v_report_submitter_id uuid;
BEGIN
  SELECT r.branch_id, r.shift_type, r.submitted_by
    INTO v_branch_id, v_report_shift_type, v_report_submitter_id
  FROM public.daily_reports AS r
  WHERE r.id = p_report_id;
  IF NOT FOUND OR v_branch_id IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches AS b
    WHERE b.id = v_branch_id AND b.lifecycle_status IS DISTINCT FROM 'planned'
  ) THEN
    RAISE EXCEPTION 'report_branch_not_operational';
  END IF;

  -- Auto-included Managers require an explicit all-branch analytics scope.
  -- Configured selected-scope recipients remain limited to their authorized
  -- branch. The caller's own Supervisor copy is handled by the Edge Function.
  -- An eligible Owner remains the required fallback when settings are empty.
  IF NOT EXISTS (SELECT 1 FROM public.daily_report_email_recipients) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.status = 'active' AND p.role = 'Owner'
        AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        AND public.can_profile_read_all_daily_report_branches(p.id)
        AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
    ) THEN
      RAISE EXCEPTION 'primary_report_recipient_not_configured';
    END IF;
    RETURN QUERY
    SELECT p.id, p.email,
           row_number() OVER (ORDER BY (p.role = 'Owner') DESC, p.created_at, p.id) = 1
    FROM public.profiles AS p
    WHERE p.status = 'active'
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (
        (
          p.role IN ('Owner', 'Admin')
          AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
        )
        OR (
          p.role = 'Manager'
          AND v_report_shift_type IN ('Morning', 'Evening')
          AND public.can_profile_read_all_daily_report_branches(p.id)
          AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
        )
      )
    ORDER BY (p.role = 'Owner') DESC, p.created_at, p.id;
    RETURN;
  END IF;

  -- The primary recipient must remain valid in at least one configured,
  -- currently authorized branch, but a selected-scope primary is intentionally
  -- absent from reports for branches outside that selection. Other eligible
  -- recipients (including the system Owner) may still receive those reports.
  IF NOT EXISTS (
    SELECT 1
    FROM public.daily_report_email_recipients AS configured
    JOIN public.profiles AS p ON p.id = configured.profile_id
    WHERE configured.is_primary IS TRUE
      AND p.status = 'active'
      AND p.role IN ('Owner', 'Admin', 'Manager')
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND public.can_profile_be_daily_report_primary(p.id)
      AND (
        configured.scope_mode = 'all_authorized'
        OR (configured.scope_mode = 'selected' AND EXISTS (
          SELECT 1
          FROM public.daily_report_email_recipient_branches AS primary_branch
          JOIN public.branches AS b ON b.id = primary_branch.branch_id
          WHERE primary_branch.profile_id = configured.profile_id
            AND b.lifecycle_status IS DISTINCT FROM 'planned'
            AND public.can_profile_read_daily_report_branch(p.id, primary_branch.branch_id)
        ))
      )
  ) THEN
    RAISE EXCEPTION 'primary_report_recipient_not_configured';
  END IF;

  RETURN QUERY
  WITH eligible_recipients AS (
    SELECT configured.profile_id, p.email, configured.is_primary, p.full_name
    FROM public.daily_report_email_recipients AS configured
    JOIN public.profiles AS p ON p.id = configured.profile_id
    WHERE p.status = 'active'
      AND p.role IN ('Owner', 'Admin', 'Manager', 'Supervisor')
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (p.role <> 'Supervisor' OR p.id = v_report_submitter_id)
      AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
      AND (
        configured.scope_mode = 'all_authorized'
        OR (configured.scope_mode = 'selected' AND EXISTS (
          SELECT 1
          FROM public.daily_report_email_recipient_branches AS selected
          WHERE selected.profile_id = configured.profile_id
            AND selected.branch_id = v_branch_id
        ))
      )
    UNION ALL
    SELECT p.id, p.email, false, p.full_name
    FROM public.profiles AS p
    WHERE p.status = 'active'
      AND p.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND (
        (
          p.role IN ('Owner', 'Admin')
          AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
        )
        OR (
          p.role = 'Manager'
          AND v_report_shift_type IN ('Morning', 'Evening')
          AND public.can_profile_read_all_daily_report_branches(p.id)
          AND public.can_profile_read_daily_report(p.id, v_branch_id, v_report_shift_type)
        )
      )
  )
  SELECT eligible.profile_id, eligible.email, bool_or(eligible.is_primary)
  FROM eligible_recipients AS eligible
  GROUP BY eligible.profile_id, eligible.email, eligible.full_name
  ORDER BY bool_or(eligible.is_primary) DESC, eligible.full_name, eligible.profile_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_daily_report_copy_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_report_copy_recipients(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.daily_report_email_sends (
  report_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('sending', 'sent', 'unknown', 'rejected')),
  first_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT daily_report_email_sends_sent_requires_provider_receipt
    CHECK (state <> 'sent' OR NULLIF(btrim(provider_message_id), '') IS NOT NULL)
);
COMMENT ON TABLE public.daily_report_email_sends IS
  'Service-role-only one-copy ledger for report email delivery; uncertain sends are retried only with identical payload/key within Resend’s 24-hour window.';
ALTER TABLE public.daily_report_email_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_report_email_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.daily_report_email_sends TO service_role;


CREATE OR REPLACE FUNCTION public.claim_daily_report_email_send(
  p_report_id uuid,
  p_payload_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_send public.daily_report_email_sends%ROWTYPE;
  v_inserted integer;
  v_key text := 'zam-daily-report-copy:' || p_report_id::text;
BEGIN
  IF p_report_id IS NULL OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_report_send_claim';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_reports AS r WHERE r.id = p_report_id) THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;

  INSERT INTO public.daily_report_email_sends(report_id, idempotency_key, payload_sha256, state)
  VALUES (p_report_id, v_key, p_payload_sha256, 'sending')
  ON CONFLICT (report_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'decision', 'send', 'idempotency_key', v_key, 'provider_message_id', NULL
    );
  END IF;

  SELECT s.* INTO v_send
  FROM public.daily_report_email_sends AS s
  WHERE s.report_id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_send_claim_missing'; END IF;
  IF v_send.payload_sha256 <> p_payload_sha256 THEN
    RETURN pg_catalog.jsonb_build_object('decision', 'payload_changed');
  END IF;
  IF v_send.state = 'sent' THEN
    RETURN pg_catalog.jsonb_build_object(
      'decision', 'already_sent', 'idempotency_key', v_send.idempotency_key,
      'provider_message_id', v_send.provider_message_id
    );
  END IF;
  IF v_send.state = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object('decision', 'rejected', 'idempotency_key', v_send.idempotency_key);
  END IF;
  IF v_send.first_attempt_at <= clock_timestamp() - interval '24 hours' THEN
    UPDATE public.daily_report_email_sends
       SET state = 'unknown', updated_at = clock_timestamp()
     WHERE report_id = p_report_id AND state <> 'sent';
    RETURN pg_catalog.jsonb_build_object('decision', 'reconciliation_required', 'idempotency_key', v_send.idempotency_key);
  END IF;
  IF v_send.state = 'sending'
     AND v_send.attempt_started_at > clock_timestamp() - interval '2 minutes' THEN
    RETURN pg_catalog.jsonb_build_object('decision', 'in_progress', 'idempotency_key', v_send.idempotency_key);
  END IF;

  UPDATE public.daily_report_email_sends
     SET state = 'sending', attempt_started_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE report_id = p_report_id;
  RETURN pg_catalog.jsonb_build_object(
    'decision', 'send', 'idempotency_key', v_send.idempotency_key,
    'provider_message_id', v_send.provider_message_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_daily_report_email_send(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_report_email_send(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_daily_report_email_send(
  p_report_id uuid,
  p_payload_sha256 text,
  p_state text,
  p_provider_message_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('sent', 'unknown', 'rejected')
     OR (p_state = 'sent' AND NULLIF(btrim(p_provider_message_id), '') IS NULL) THEN
    RAISE EXCEPTION 'invalid_report_send_state';
  END IF;
  UPDATE public.daily_report_email_sends
     SET state = p_state,
         provider_message_id = CASE WHEN p_state = 'sent' THEN NULLIF(btrim(p_provider_message_id), '') ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE report_id = p_report_id
     AND payload_sha256 = p_payload_sha256
     AND state = 'sending';
  IF NOT FOUND THEN RAISE EXCEPTION 'report_send_claim_not_owned'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.finish_daily_report_email_send(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_daily_report_email_send(uuid, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
