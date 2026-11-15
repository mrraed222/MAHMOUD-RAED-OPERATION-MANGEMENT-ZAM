-- Fridge / freezer temperature tracking, task notes, and technical issue reports.
-- Additive only: existing tables and rows are preserved.

-- 1) Template options: optional note field, and a task type for the fridge temperature task.
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS allows_notes boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'standard';

ALTER TABLE public.checklist_templates
  DROP CONSTRAINT IF EXISTS checklist_templates_task_type_check;
ALTER TABLE public.checklist_templates
  ADD CONSTRAINT checklist_templates_task_type_check CHECK (task_type IN ('standard', 'fridge_temps'));

-- 2) Fridges and freezers (any number per branch).
CREATE TABLE IF NOT EXISTS public.fridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'fridge' CHECK (kind IN ('fridge', 'freezer')),
  number integer NOT NULL CHECK (number > 0),
  name text,
  target_min numeric,                 -- NULL = no lower bound (freezer)
  target_max numeric NOT NULL,        -- fridge: 4, freezer: -18
  problem_threshold numeric NOT NULL, -- reading at or above this value is a problem (fridge: 9, freezer: -14)
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, kind, number)
);

-- 3) Readings.
CREATE TABLE IF NOT EXISTS public.fridge_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fridge_id uuid NOT NULL REFERENCES public.fridges(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  recorded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  temperature numeric NOT NULL,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warning', 'problem')),
  note text,
  reading_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fridge_readings_branch_date_idx ON public.fridge_readings (branch_id, reading_date);

-- 4) Technical issues (manual reports and automatic fridge problems).
CREATE TABLE IF NOT EXISTS public.technical_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'fridge')),
  fridge_id uuid REFERENCES public.fridges(id) ON DELETE SET NULL,
  reading_id uuid REFERENCES public.fridge_readings(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS technical_issues_branch_status_idx ON public.technical_issues (branch_id, status, created_at DESC);

-- 5) Row level security.
ALTER TABLE public.fridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fridge_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read fridges" ON public.fridges;
CREATE POLICY "Read fridges" ON public.fridges FOR SELECT TO authenticated
  USING (current_user_role() IN ('Owner', 'Admin', 'Manager') OR branch_id = current_user_branch_id());

DROP POLICY IF EXISTS "Manage fridges" ON public.fridges;
CREATE POLICY "Manage fridges" ON public.fridges FOR ALL TO authenticated
  USING (has_admin_permission('templates'))
  WITH CHECK (has_admin_permission('templates'));

DROP POLICY IF EXISTS "Read fridge readings" ON public.fridge_readings;
CREATE POLICY "Read fridge readings" ON public.fridge_readings FOR SELECT TO authenticated
  USING (current_user_role() IN ('Owner', 'Admin', 'Manager') OR branch_id = current_user_branch_id());

DROP POLICY IF EXISTS "Supervisors add own branch readings" ON public.fridge_readings;
CREATE POLICY "Supervisors add own branch readings" ON public.fridge_readings FOR INSERT TO authenticated
  WITH CHECK (recorded_by = auth.uid() AND branch_id = current_user_branch_id());

DROP POLICY IF EXISTS "Read technical issues" ON public.technical_issues;
CREATE POLICY "Read technical issues" ON public.technical_issues FOR SELECT TO authenticated
  USING (current_user_role() IN ('Owner', 'Admin', 'Manager') OR branch_id = current_user_branch_id());

DROP POLICY IF EXISTS "Report technical issue for own branch" ON public.technical_issues;
CREATE POLICY "Report technical issue for own branch" ON public.technical_issues FOR INSERT TO authenticated
  WITH CHECK (reported_by = auth.uid() AND branch_id = current_user_branch_id());

DROP POLICY IF EXISTS "Managers resolve technical issues" ON public.technical_issues;
CREATE POLICY "Managers resolve technical issues" ON public.technical_issues FOR UPDATE TO authenticated
  USING (current_user_role() IN ('Owner', 'Admin', 'Manager'))
  WITH CHECK (current_user_role() IN ('Owner', 'Admin', 'Manager'));
