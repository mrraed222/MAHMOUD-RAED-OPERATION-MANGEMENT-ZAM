-- ZAM · إضافة عمود الشفت (shift_type) إلى جدول الهدر.
-- السبب: خطأ PGRST204 أثناء مزامنة Google Sheet ← waste_logs لا يدعم عمود shift_type،
--        وتقرير مدير التشغيل يقسّم الهدر حسب: الفرع + الشفت + الوحدة.
-- ترقية إضافية فقط (لا تُشغَّل supabase-v2-schema.sql مرة أخرى) — آمنة للإعادة التنفيذ
-- ولا تحذف أو تعدّل أي بيانات.
ALTER TABLE public.waste_logs
    ADD COLUMN IF NOT EXISTS shift_type text;

COMMENT ON COLUMN public.waste_logs.shift_type IS
    'الشفت الذي سُجّل فيه الهدر: Morning / Evening';

CREATE INDEX IF NOT EXISTS idx_waste_logs_shift_type
    ON public.waste_logs (shift_type);
