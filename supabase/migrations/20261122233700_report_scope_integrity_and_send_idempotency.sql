-- Local-only release follow-up. Apply only after owner-approved review and release checks.
BEGIN;

-- A restrictive INSERT policy composes with every existing permissive policy so
-- a Supervisor cannot submit a report outside their current branch/shift scope.
DROP POLICY IF EXISTS daily_reports_supervisor_insert_current_scope ON public.daily_reports;
CREATE POLICY daily_reports_supervisor_insert_current_scope
  ON public.daily_reports
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IS NOT NULL
    AND (
      public.current_user_role() <> 'Supervisor'
      OR (
        submitted_by = (SELECT auth.uid())
        AND public.current_supervisor_can_read_daily_report(branch_id, shift_type)
      )
    )
  );

-- New assignments snapshot the assignee's role. Legacy assignments are left NULL
-- (there is no safe way to infer their original role); submission/completion fails
-- closed for those rows until an authorized manager reissues the assignment.
ALTER TABLE public.branch_visit_assignments
  ADD COLUMN IF NOT EXISTS assignee_role text;
COMMENT ON COLUMN public.branch_visit_assignments.assignee_role IS
  'Role captured when the visit assignment is created; NULL legacy assignments must be reissued before submission/completion.';

CREATE OR REPLACE FUNCTION public.snapshot_branch_visit_assignee_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_status text;
  v_branch_id uuid;
  v_shift_type text;
  v_quality_enabled boolean;
BEGIN
  SELECT p.role, p.status, p.branch_id, p.shift_type,
         COALESCE(ap.can_perform_branch_visits, false)
    INTO v_role, v_status, v_branch_id, v_shift_type, v_quality_enabled
  FROM public.profiles AS p
  LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
  WHERE p.id = NEW.assigned_to;

  IF v_status IS DISTINCT FROM 'active'
     OR v_shift_type IS NULL
     OR (v_shift_type IS DISTINCT FROM 'Both' AND v_shift_type IS DISTINCT FROM NEW.shift_type)
     OR NOT (
       (v_role = 'Supervisor' AND v_branch_id = NEW.branch_id)
       OR (v_role = 'Quality' AND v_quality_enabled IS TRUE)
     ) THEN
    RAISE EXCEPTION 'الدور أو الفرع أو الوردية لا يطابقان تكليف الزيارة الحالي';
  END IF;

  NEW.assignee_role := v_role;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.snapshot_branch_visit_assignee_role() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS branch_visit_assignment_snapshot_assignee_role ON public.branch_visit_assignments;
CREATE TRIGGER branch_visit_assignment_snapshot_assignee_role
  BEFORE INSERT ON public.branch_visit_assignments
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_branch_visit_assignee_role();

CREATE OR REPLACE FUNCTION public.can_submit_assigned_branch_visit(
  p_assignment_id uuid,
  p_branch_id uuid,
  p_visit_date date,
  p_shift_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (
    public.can_manage_branch_visits()
    AND EXISTS (
      SELECT 1 FROM public.branch_visit_assignments AS manager_assignment
      WHERE manager_assignment.id = p_assignment_id
        AND manager_assignment.assigned_to IS DISTINCT FROM (SELECT auth.uid())
        AND manager_assignment.branch_id = p_branch_id
        AND manager_assignment.visit_date = p_visit_date
        AND manager_assignment.shift_type = p_shift_type
        AND manager_assignment.status = 'assigned'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.branch_visit_assignments AS a
    JOIN public.profiles AS p ON p.id = (SELECT auth.uid())
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE a.id = p_assignment_id
      AND a.assigned_to = p.id
      AND a.assignee_role = p.role
      AND p.status = 'active'
      AND a.branch_id = p_branch_id
      AND a.visit_date = p_visit_date
      AND a.shift_type = p_shift_type
      AND a.status = 'assigned'
      AND (p.shift_type = 'Both' OR p.shift_type = a.shift_type)
      AND (
        (p.role = 'Supervisor' AND p.branch_id = a.branch_id)
        OR (p.role = 'Quality' AND ap.can_perform_branch_visits IS TRUE)
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.can_submit_assigned_branch_visit(uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_submit_assigned_branch_visit(uuid, uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_quality_visit_assignment_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_status text;
  v_branch_id uuid;
  v_shift_type text;
  v_quality_enabled boolean;
BEGIN
  IF OLD.status = 'assigned' AND NEW.status = 'completed' THEN
    -- Preserve the separate manager path, but do not let a changed assignee role
    -- use that path to complete their own stale assignment.
    IF public.can_manage_branch_visits()
       AND NEW.assigned_to IS DISTINCT FROM (SELECT auth.uid()) THEN
      RETURN NEW;
    END IF;

    IF NEW.assigned_to IS DISTINCT FROM (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'إكمال الزيارة يتطلب تكليفاً سارياً للحساب الحالي';
    END IF;

    SELECT p.role, p.status, p.branch_id, p.shift_type,
           COALESCE(ap.can_perform_branch_visits, false)
      INTO v_role, v_status, v_branch_id, v_shift_type, v_quality_enabled
    FROM public.profiles AS p
    LEFT JOIN public.admin_permissions AS ap ON ap.profile_id = p.id
    WHERE p.id = NEW.assigned_to;

    IF v_status IS DISTINCT FROM 'active'
       OR NEW.assignee_role IS NULL
       OR OLD.assignee_role IS DISTINCT FROM v_role
       OR NEW.assignee_role IS DISTINCT FROM v_role
       OR v_shift_type IS NULL
       OR (v_shift_type IS DISTINCT FROM 'Both' AND v_shift_type IS DISTINCT FROM NEW.shift_type) THEN
      RAISE EXCEPTION 'الحساب أو الدور أو الوردية لا يطابقون تكليف الزيارة الحالي';
    END IF;

    IF v_role = 'Supervisor' AND v_branch_id = NEW.branch_id THEN
      RETURN NEW;
    END IF;
    IF v_role = 'Quality' AND v_quality_enabled IS TRUE THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'الدور أو الفرع لا يطابقان تكليف الزيارة الحالي';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_quality_visit_assignment_completion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_quality_visit_assignment_completion ON public.branch_visit_assignments;
CREATE TRIGGER guard_quality_visit_assignment_completion
  BEFORE UPDATE OF status ON public.branch_visit_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_quality_visit_assignment_completion();

-- Keep the pre-existing Owner/Admin capability, while restricting Manager writes
-- to the same current report-branch scope used by report visibility. This applies
-- to linked reports and NULL historical rows alike through branch_id.
DROP POLICY IF EXISTS "Managers resolve technical issues" ON public.technical_issues;
DROP POLICY IF EXISTS technical_issues_manager_scoped_update ON public.technical_issues;
DROP POLICY IF EXISTS technical_issues_owner_admin_update ON public.technical_issues;
CREATE POLICY technical_issues_manager_scoped_update
  ON public.technical_issues
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'Manager'
    AND public.can_read_manager_report_branch(branch_id)
  )
  WITH CHECK (
    public.current_user_role() = 'Manager'
    AND public.can_read_manager_report_branch(branch_id)
  );
CREATE POLICY technical_issues_owner_admin_update
  ON public.technical_issues
  FOR UPDATE TO authenticated
  USING (public.current_user_role() IN ('Owner', 'Admin'))
  WITH CHECK (public.current_user_role() IN ('Owner', 'Admin'));

-- Association is write-once: prevent manual unlinking while allowing the
-- composite FK's ON DELETE SET NULL action after the parent row is deleted.
CREATE OR REPLACE FUNCTION public.prevent_technical_issue_report_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.report_id IS DISTINCT FROM OLD.report_id AND NEW.report_id IS NOT NULL THEN
    RAISE EXCEPTION 'technical_issue_report_link_is_creation_only'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.report_id IS NOT NULL
     AND NEW.report_id IS NULL
     AND EXISTS (
       SELECT 1
       FROM public.daily_reports AS report
       WHERE report.id = OLD.report_id
         AND report.branch_id = OLD.branch_id
     ) THEN
    RAISE EXCEPTION 'technical_issue_report_link_cannot_be_cleared'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.prevent_technical_issue_report_reassignment() FROM PUBLIC, anon, authenticated;

-- One durable logical send per report. The ledger serializes concurrent calls,
-- binds retries to an identical payload and stable Resend key, and refuses to
-- mint a fresh key after Resend's documented 24-hour retention window.
CREATE TABLE IF NOT EXISTS public.daily_report_email_sends (
  report_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('sending', 'sent', 'unknown', 'rejected')),
  first_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
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
  IF p_report_id IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
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
  IF p_state NOT IN ('sent', 'unknown', 'rejected') THEN
    RAISE EXCEPTION 'invalid_report_send_state';
  END IF;
  UPDATE public.daily_report_email_sends
     SET state = p_state,
         provider_message_id = CASE WHEN p_state = 'sent' THEN NULLIF(p_provider_message_id, '') ELSE NULL END,
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
