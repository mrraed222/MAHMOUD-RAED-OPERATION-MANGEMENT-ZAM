-- Local Riwaq candidate only. Do not apply to production without independent review
-- and explicit release approval. Requires branch lifecycle and template-scope migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.reject_planned_checklist_template_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.branches AS b
    WHERE b.id = NEW.branch_id
      AND b.lifecycle_status = 'planned'
  ) THEN
    RAISE EXCEPTION 'لا يمكن إسناد قالب تحقق إلى فرع مخطط قبل تأكيد افتتاحه'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.reject_planned_checklist_template_branch()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reject_planned_checklist_template_branch
  ON public.checklist_template_branches;
CREATE TRIGGER reject_planned_checklist_template_branch
  BEFORE INSERT OR UPDATE OF branch_id ON public.checklist_template_branches
  FOR EACH ROW EXECUTE FUNCTION public.reject_planned_checklist_template_branch();

-- Older callers and the template-version RPC still write the legacy column.
-- This trigger protects those direct INSERT/UPDATE paths as well as RPC inserts.
DROP TRIGGER IF EXISTS reject_planned_checklist_template_legacy_branch
  ON public.checklist_templates;
CREATE TRIGGER reject_planned_checklist_template_legacy_branch
  BEFORE INSERT OR UPDATE OF branch_id ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.reject_planned_checklist_template_branch();

COMMIT;
