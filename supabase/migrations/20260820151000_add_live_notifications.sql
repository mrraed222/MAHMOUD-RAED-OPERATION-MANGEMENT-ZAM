-- نظام إشعارات ZAM التشغيلي: صفوف موجهة للمستلم مع حالة قراءة.
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
    link_path text,
    branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
    source_table text,
    source_id uuid,
    is_read boolean NOT NULL DEFAULT false,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
    ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_source_idx
    ON public.notifications (source_table, source_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- تنشئ هذه الدالة صفاً مستقلاً لكل مستلم؛ لا تُمنح للأدوار العميلة.
CREATE OR REPLACE FUNCTION public.zam_enqueue_role_notifications(
    p_notification_type text,
    p_title text,
    p_body text,
    p_priority text,
    p_link_path text,
    p_branch_id uuid,
    p_source_table text,
    p_source_id uuid,
    p_roles text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notifications (
        user_id, notification_type, title, body, priority,
        link_path, branch_id, source_table, source_id
    )
    SELECT
        profile.id, p_notification_type, p_title, p_body, p_priority,
        p_link_path, p_branch_id, p_source_table, p_source_id
    FROM public.profiles AS profile
    WHERE profile.status = 'active'
      AND profile.role = ANY (p_roles);
END;
$$;

CREATE OR REPLACE FUNCTION public.zam_notify_new_daily_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.zam_enqueue_role_notifications(
        'new_daily_report',
        'تم استلام تقرير وردية',
        'تم إرسال تقرير جديد من فرع ' || COALESCE((SELECT name FROM public.branches WHERE id = NEW.branch_id), 'غير محدد') || '.',
        'normal',
        '../reports-log/index.html',
        NEW.branch_id,
        'daily_reports',
        NEW.id,
        ARRAY['Owner', 'Admin', 'Manager']
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zam_notify_new_shift_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    report_branch_id uuid;
BEGIN
    SELECT branch_id INTO report_branch_id FROM public.daily_reports WHERE id = NEW.report_id;
    PERFORM public.zam_enqueue_role_notifications(
        'new_shift_issue',
        'مشكلة شفت تحتاج متابعة',
        COALESCE(NEW.description, 'تم تسجيل مشكلة شفت جديدة.') || ' — راجع تقرير الشفت.',
        CASE WHEN COALESCE(NEW.priority, '') IN ('عاجل', 'عالية', 'High', 'Urgent') THEN 'high' ELSE 'normal' END,
        '../reports-monitor/index.html',
        report_branch_id,
        'shift_issues',
        NEW.id,
        ARRAY['Owner', 'Admin', 'Manager']
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zam_notify_negative_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    report_branch_id uuid;
BEGIN
    SELECT branch_id INTO report_branch_id FROM public.daily_reports WHERE id = NEW.report_id;
    PERFORM public.zam_enqueue_role_notifications(
        'negative_review',
        'مراجعة سلبية جديدة',
        COALESCE(NEW.comment_text, 'تم تسجيل مراجعة سلبية جديدة.') || ' — تحتاج متابعة.',
        'high',
        '../reports-monitor/index.html',
        report_branch_id,
        'negative_reviews',
        NEW.id,
        ARRAY['Owner', 'Admin', 'Manager']
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zam_notify_pending_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'pending' AND NEW.role NOT IN ('Owner', 'Admin', 'Manager') THEN
        PERFORM public.zam_enqueue_role_notifications(
            'pending_registration',
            'طلب تسجيل جديد بانتظار الموافقة',
            'طلب ' || COALESCE(NEW.full_name, 'موظف جديد') || ' يحتاج مراجعة الصلاحيات.',
            'normal',
            '../permissions/index.html',
            NEW.branch_id,
            'profiles',
            NEW.id,
            ARRAY['Owner', 'Admin', 'Manager']
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zam_notifications_after_daily_report ON public.daily_reports;
CREATE TRIGGER zam_notifications_after_daily_report
AFTER INSERT ON public.daily_reports
FOR EACH ROW EXECUTE FUNCTION public.zam_notify_new_daily_report();

DROP TRIGGER IF EXISTS zam_notifications_after_shift_issue ON public.shift_issues;
CREATE TRIGGER zam_notifications_after_shift_issue
AFTER INSERT ON public.shift_issues
FOR EACH ROW EXECUTE FUNCTION public.zam_notify_new_shift_issue();

DROP TRIGGER IF EXISTS zam_notifications_after_negative_review ON public.negative_reviews;
CREATE TRIGGER zam_notifications_after_negative_review
AFTER INSERT ON public.negative_reviews
FOR EACH ROW EXECUTE FUNCTION public.zam_notify_negative_review();

DROP TRIGGER IF EXISTS zam_notifications_after_pending_profile ON public.profiles;
CREATE TRIGGER zam_notifications_after_pending_profile
AFTER INSERT OR UPDATE OF status ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.zam_notify_pending_registration();

-- هذه الدوال للاستخدام الداخلي بواسطة المشغلات فقط، وليست RPC للعملاء.
REVOKE ALL ON FUNCTION public.zam_enqueue_role_notifications(text, text, text, text, text, uuid, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zam_notify_new_daily_report() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zam_notify_new_shift_issue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zam_notify_negative_review() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zam_notify_pending_registration() FROM PUBLIC, anon, authenticated;

-- مزامنة فورية للعميل بعد وصول إشعار جديد أو تغيير حالة القراءة.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1
           FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'notifications'
       ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
    END IF;
END;
$$;
