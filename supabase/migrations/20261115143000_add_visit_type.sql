-- Preserve the selected visit type instead of dropping it from the visit payload.
ALTER TABLE public.supervisory_visits
  ADD COLUMN IF NOT EXISTS visit_type text;

COMMENT ON COLUMN public.supervisory_visits.visit_type IS
  'نوع الزيارة: زيارة دورية، زيارة مفاجئة، زيارة متابعة، أو بسبب شكوى أو مشكلة';
