// ============================================
// إعدادات الاتصال بـ Supabase - نظام زام للعمليات
// ملف مشترك يتم تحميله في كل الشاشات
// ============================================

const SUPABASE_URL = 'https://uuphgpncmiwyigtqhjmd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1cGhncG5jbWl3eWlndHFoam1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MjIzMzEsImV4cCI6MjEwMDM5ODMzMX0.R0ACUbjGYk22VljDl7z8c_kW9Mk7P3MmenbmBXcqWH4';

const zamClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// إدارة جلسة المستخدم المسجل دخوله (محلياً في المتصفح)
// ============================================
// ============================================
// توجيه المستخدم لصفحته الرئيسية المناسبة حسب دوره الوظيفي
// ============================================
function zamRoleHomePath(role) {
    if (role === 'Owner' || role === 'Admin' || role === 'Manager') {
        return 'dashboard/index.html'; // داشبورد متابعة التشغيل (الإدارة/المالك)
    }
    if (role === 'Supervisor') {
        return 'supervisor-checklist/index.html'; // داشبورد مشرف الشفت
    }
    // Barista, Waiter, Kitchen وأي دور تشغيلي عادي
    return 'my-checklist/index.html'; // شاشة تشيك ليست الموظف الخاصة به فقط (حسب فرعه ووردياته)
}

// ============================================
// القائمة الجانبية الموحدة (نفس تصميم وألوان القالب الأصلي) — تُستخدم في كل الشاشات
// ============================================
const ZAM_NAV_ITEMS = [
    { key: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard', href: 'dashboard/index.html', roles: ['Owner', 'Admin'] },
    { key: 'branches', label: 'الفروع', icon: 'storefront', href: 'branches-checklists/index.html', roles: ['Owner', 'Admin', 'Supervisor'] },
    { key: 'my-checklist', label: 'مهامي اليومية', icon: 'task_alt', href: 'my-checklist/index.html', roles: ['Barista', 'Kitchen', 'Waiter'] },
    { key: 'supervisor-checklist', label: 'قوائم المهام', icon: 'checklist', href: 'supervisor-checklist/index.html', roles: ['Owner', 'Admin', 'Supervisor'] },
    { key: 'manage-templates', label: 'إدارة قوائم التحقق', icon: 'edit_note', href: 'manage-templates/index.html', roles: ['Owner', 'Admin'] },
    { key: 'daily-report', label: 'التقارير اليومية', icon: 'assignment', href: 'daily-report/index.html', roles: ['Owner', 'Admin', 'Supervisor'] },
    { key: 'reports-log', label: 'سجل التقارير', icon: 'assessment', href: 'reports-log/index.html', roles: ['Owner', 'Admin', 'Supervisor'] },
    { key: 'checklist-logs', label: 'سجل التشيك ليست بالصور', icon: 'photo_library', href: 'checklist-logs/index.html', roles: ['Owner', 'Admin', 'Supervisor'] },
    { key: 'reports-monitor', label: 'متابعة التقارير', icon: 'fact_check', href: 'reports-monitor/index.html', roles: ['Owner', 'Admin'] },
    { key: 'analytics', label: 'داشبورد التحليلات', icon: 'insights', href: 'analytics/index.html', roles: ['Owner', 'Admin'] },
    { key: 'staff-management', label: 'إدارة الطاقم', icon: 'groups', href: 'staff-management/index.html', roles: ['Owner', 'Admin'] },
    { key: 'automation-settings', label: 'إعدادات الأتمتة', icon: 'settings', href: 'automation-settings/index.html', roles: ['Owner', 'Admin'] },
    { key: 'permissions', label: 'الأذونات والصلاحيات', icon: 'admin_panel_settings', href: 'permissions/index.html', roles: ['Owner'] },
    { key: 'employee-profile', label: 'الملف الشخصي', icon: 'person', href: 'employee-profile/index.html', roles: ['Owner', 'Admin', 'Supervisor', 'Barista', 'Kitchen', 'Waiter'] },
];

function renderZamSidebar(activeKey, role, pathPrefix = '../') {
    const sessionProfile = ZamSession.get();
    const avatarFallback = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%23e4e2e1'/><circle cx='50' cy='38' r='18' fill='%2380756c'/><ellipse cx='50' cy='88' rx='30' ry='22' fill='%2380756c'/></svg>";
    const userAvatar = sessionProfile?.avatar_url || avatarFallback;
    const items = ZAM_NAV_ITEMS.filter(i => i.roles.includes(role));
    const links = items.map(i => {
        const active = i.key === activeKey;
        const cls = active
            ? 'flex items-center gap-sm p-sm rounded-lg text-primary font-bold border-r-4 border-primary bg-surface-container transition-colors'
            : 'flex items-center gap-sm p-sm rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors group';
        return `<a class="${cls}" href="${pathPrefix}${i.href}">
            <span class="material-symbols-outlined">${i.icon}</span>
            <span class="font-body-lg">${i.label}</span>
        </a>`;
    }).join('');

    return `<aside class="fixed right-0 top-0 h-full w-[280px] bg-surface border-l border-outline-variant flex flex-col py-lg px-md gap-base z-50 hidden md:flex">
        <div class="flex items-center justify-between gap-sm mb-lg px-xs">
          <div class="flex items-center gap-sm">
            <img alt="ZAM Logo" class="w-12 h-12 rounded-lg object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB_zDG_2qTlgZVrmyvFCMa_dD5IoGrqsvbVTI6mxsY-OnPweUq0gZvzixXP3Zse-FdcbiNYODy_CxAbLQ9IadjolG5w9SSKCfjBqMNm_P23DjLPfnDXp6cKGNt3TbBvcMgQTeqkeI8SSdyXNhJe5L7MkTJVZRcACevAO-l4VTW24xTNj4ggA29CzBAhy5DvsT60jNbq4XKknpI7C9AEUPh5sBIF2UDfGqJMPsZ_H8BGCtApm83PY7XxoFrSDxWCCQUc-g"/>
            <div>
                <h1 class="font-display-lg text-[24px] font-bold text-primary leading-none">ZAM Cafe</h1>
                <p class="font-body-sm text-on-surface-variant">إدارة العمليات</p>
            </div>
          </div>
          <img src="${userAvatar}" alt="صورتك الشخصية" class="w-10 h-10 rounded-full object-cover border-2 border-outline-variant"/>
        </div>
        <nav class="flex flex-col gap-xs flex-1 overflow-y-auto">${links}</nav>
        <button onclick="ZamSession.clear(); zamClient.auth.signOut(); window.location.href='${pathPrefix}index.html';" class="flex items-center gap-sm p-sm rounded-lg text-error hover:bg-error-container/30 transition-colors">
            <span class="material-symbols-outlined">logout</span>
            <span class="font-body-lg">تسجيل الخروج</span>
        </button>
    </aside>`;
}

const ZamSession = {
    KEY: 'zam_session_profile',

    save(profile) {
        sessionStorage.setItem(this.KEY, JSON.stringify(profile));
    },

    get() {
        const raw = sessionStorage.getItem(this.KEY);
        return raw ? JSON.parse(raw) : null;
    },

    clear() {
        sessionStorage.removeItem(this.KEY);
    },

    // يستخدم في بداية كل شاشة داخلية للتأكد إن فيه مستخدم مسجل دخوله
    // وإلا يرجعه لصفحة الدخول
    requireAuth(loginPath = '../index.html') {
        const profile = this.get();
        if (!profile) {
            window.location.href = loginPath;
            return null;
        }
        return profile;
    }
};

// ============================================
// دوال مساعدة عامة تستخدم في أكثر من شاشة
// ============================================
const ZamAPI = {
    // تسجيل الدخول برمز المرور عبر Edge Function آمنة (تنشئ جلسة Auth حقيقية)
    async login(passcode) {
        const { data, error } = await zamClient.functions.invoke('login-with-passcode', {
            body: { passcode }
        });

        if (error) {
            // استخراج رسالة الخطأ الحقيقية من جسم الاستجابة لو موجودة
            let msg = 'رمز المرور غير صحيح';
            try {
                const ctx = await error.context?.json?.();
                if (ctx?.error) msg = ctx.error;
            } catch (_) {}
            const e = new Error(msg);
            e.friendly = true;
            throw e;
        }

        // إنشاء جلسة Auth حقيقية على المتصفح باستخدام التوكن اللي رجعته الدالة
        const { error: otpError } = await zamClient.auth.verifyOtp({
            token_hash: data.token_hash,
            type: 'magiclink'
        });
        if (otpError) throw otpError;

        return data.profile;
    },

    // تسجيل موظف جديد عبر Edge Function آمنة (تتجاوز قيود RLS بأمان من السيرفر)
    async registerEmployee(payload) {
        const { data, error } = await zamClient.functions.invoke('register-employee', {
            body: payload
        });
        if (error) {
            let msg = 'حدث خطأ أثناء التسجيل';
            try {
                const ctx = await error.context?.json?.();
                if (ctx?.error) msg = ctx.error;
            } catch (_) {}
            const e = new Error(msg);
            e.friendly = true;
            throw e;
        }
        return data.profile;
    },

    // جلب كل الفروع
    async getBranches() {
        const { data, error } = await zamClient.from('branches').select('*').order('name');
        if (error) throw error;
        return data;
    },

    async getChecklistLogs({ branchId = null, date = null, shiftType = null } = {}) {
        let q = zamClient.from('checklist_logs')
          .select('*, checklist_templates(task_title, category, shift_type, requires_photo), profiles(full_name), branches(name)');
        if (date) q = q.eq('execution_date', date);
        if (branchId) q = q.eq('branch_id', branchId);
        const { data, error } = await q.order('created_at', { ascending: false });
        if (error) throw error;
        return shiftType ? data.filter(l => l.checklist_templates?.shift_type === shiftType) : data;
    },

    // جلب موظفي فرع معين
    async getStaff(branchId = null) {
        let query = zamClient.from('profiles').select('*, branches(name)');
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query.order('full_name');
        if (error) throw error;
        return data;
    },

    async getTaskCategories(profileId) {
        const { data, error } = await zamClient.from('employee_task_categories').select('category').eq('profile_id', profileId);
        if (error) throw error;
        return data.map(row => row.category);
    },

    async replaceTaskCategories(profileId, categories) {
        const { error: deleteError } = await zamClient.from('employee_task_categories').delete().eq('profile_id', profileId);
        if (deleteError) throw deleteError;
        if (!categories.length) return;
        const { error } = await zamClient.from('employee_task_categories').insert(categories.map(category => ({ profile_id: profileId, category })));
        if (error) throw error;
    },

    // إضافة قالب مهمة جديد لقائمة التحقق
    async createTemplate(payload) {
        const { data, error } = await zamClient.from('checklist_templates').insert([payload]).select().single();
        if (error) throw error;
        return data;
    },

    // تعديل قالب مهمة موجود
    async updateTemplate(id, payload) {
        const { data, error } = await zamClient.from('checklist_templates').update(payload).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },

    // حذف قالب مهمة
    async deleteTemplate(id) {
        const { error } = await zamClient.from('checklist_templates').delete().eq('id', id);
        if (error) throw error;
    },
    // جلب قوالب المهام (فلترة اختيارية بالفئة والوردية والفرع)
    // تُرجع القوالب العامة (بدون فرع محدد) + قوالب الفرع المحدد لو تم تمريره
    async getTemplates(category = null, shiftType = null, branchId = null) {
        let query = zamClient.from('checklist_templates').select('*');
        if (category) query = query.eq('category', category);
        if (shiftType) query = query.eq('shift_type', shiftType);
        const { data, error } = await query.order('category');
        if (error) throw error;
        if (!branchId) return data;
        return data.filter(t => !t.branch_id || t.branch_id === branchId);
    },

    // جلب سجلات التنفيذ الفعلية لليوم الحالي لفرع معين
    async getTodayLogs(branchId) {
        const today = new Date().toISOString().split('T')[0];
        let query = zamClient.from('checklist_logs').select('*, profiles(full_name)').eq('execution_date', today);
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    // تسجيل تنفيذ مهمة (بمجرد وجود السجل = تم تنفيذها)
    async submitChecklistLog({ template_id, branch_id, executed_by, status = 'Completed', notes = null, photo_url = null }) {
        const { data, error } = await zamClient
            .from('checklist_logs')
            .insert([{ template_id, branch_id, executed_by, status, notes, photo_url }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    // حذف سجل تنفيذ (لإلغاء تأشير مهمة بالخطأ)
    async deleteChecklistLog(logId) {
        const { error } = await zamClient.from('checklist_logs').delete().eq('id', logId);
        if (error) throw error;
    },

    // إضافة تقرير يومي
    async addDailyReport(payload) {
        const { data, error } = await zamClient.from('daily_reports').insert([payload]).select().single();
        if (error) throw error;
        return data;
    },

    // جلب التقارير اليومية
    async getDailyReports(branchId = null) {
        let query = zamClient.from('daily_reports').select('*, branches(name), profiles(full_name)');
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    // جلب تعريفات حقول قالب التقرير (النشطة فقط، مرتبة)
    async getReportFields(activeOnly = true) {
        let q = zamClient.from('report_field_definitions').select('*').order('display_order');
        if (activeOnly) q = q.eq('is_active', true);
        const { data, error } = await q;
        if (error) throw error;
        return data;
    },

    async createReportField(payload) {
        const { data, error } = await zamClient.from('report_field_definitions').insert([payload]).select().single();
        if (error) throw error;
        return data;
    },

    async updateReportField(id, payload) {
        const { data, error } = await zamClient.from('report_field_definitions').update(payload).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },

    async deleteReportField(id) {
        const { error } = await zamClient.from('report_field_definitions').delete().eq('id', id);
        if (error) throw error;
    },

    // إرسال تقرير يومي كامل: البيانات الأساسية + الهدر + المشاكل
    async submitDailyReport({ core, custom_fields = {}, waste = [], issues = [] }) {
        const { data: report, error } = await zamClient
            .from('daily_reports')
            .insert([{ ...core, custom_fields }])
            .select()
            .single();
        if (error) throw error;

        if (waste.length) {
            const rows = waste.map(w => ({ ...w, report_id: report.id }));
            const { error: wErr } = await zamClient.from('waste_logs').insert(rows);
            if (wErr) throw wErr;
        }
        if (issues.length) {
            const rows = issues.map(i => ({ ...i, report_id: report.id }));
            const { error: iErr } = await zamClient.from('shift_issues').insert(rows);
            if (iErr) throw iErr;
        }
        // التقرير الصادر يرسل فوراً للمالك والمدير عبر Edge Function، ولا يمنع حفظ التقرير عند تعذّر البريد.
        zamClient.functions.invoke('send-report-copy', { body: { report_id: report.id } })
          .catch(err => console.warn('Immediate report email failed:', err));
        return report;
    },

    // جلب الهدر مع فلاتر (فرع/تاريخ من-إلى)
    async getWasteLogs({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        const { data, error } = await zamClient.from('waste_logs').select('*, daily_reports(branch_id, report_date, branches(name))');
        if (error) throw error;
        let rows = data;
        if (branchId) rows = rows.filter(r => r.daily_reports?.branch_id === branchId);
        if (dateFrom) rows = rows.filter(r => r.daily_reports?.report_date >= dateFrom);
        if (dateTo) rows = rows.filter(r => r.daily_reports?.report_date <= dateTo);
        return rows;
    },

    // جلب مشاكل الشفت مع فلاتر
    async getShiftIssues({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        const { data, error } = await zamClient.from('shift_issues').select('*, daily_reports(branch_id, report_date, branches(name))');
        if (error) throw error;
        let rows = data;
        if (branchId) rows = rows.filter(r => r.daily_reports?.branch_id === branchId);
        if (dateFrom) rows = rows.filter(r => r.daily_reports?.report_date >= dateFrom);
        if (dateTo) rows = rows.filter(r => r.daily_reports?.report_date <= dateTo);
        return rows;
    },

    // إرسال بريد إلكتروني تلقائيًا عبر Resend باستخدام الدومين الموثق zam.sa
    async sendResendEmail({ to, subject, html }) {
        let logEntry = null;
        try {
            const { data, error } = await zamClient
                .from('email_logs')
                .insert([{ recipient_email: Array.isArray(to) ? to.join(',') : to, subject, body_html: html, status: 'Pending' }])
                .select()
                .single();
            if (!error) logEntry = data;
        } catch (e) {
            console.error('Error logging email attempt:', e);
        }

        try {
            // محاولة استدعاء الـ Edge Function
            const { data, error } = await zamClient.functions.invoke('send-resend-email', {
                body: {
                    from: 'ZAM Operations <operations@zam.sa>',
                    to: Array.isArray(to) ? to : [to],
                    subject: subject,
                    html: html
                }
            });

            if (error) throw error;

            if (logEntry) {
                await zamClient.from('email_logs').update({ status: 'Sent' }).eq('id', logEntry.id);
            }
            return data;
        } catch (err) {
            console.warn('Edge Function send-resend-email failed, trying direct REST API...', err);
            try {
                const res = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer sb_publishable_YVOWppMk0W3Lyr925S0YYg_Kwk7U-f4',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'ZAM Operations <operations@zam.sa>',
                        to: Array.isArray(to) ? to : [to],
                        subject: subject,
                        html: html
                    })
                });

                if (res.ok) {
                    if (logEntry) {
                        await zamClient.from('email_logs').update({ status: 'Sent' }).eq('id', logEntry.id);
                    }
                    return await res.json();
                } else {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(errJson.message || 'Resend REST API error');
                }
            } catch (restErr) {
                console.error('Direct Resend REST API failed:', restErr);
                if (logEntry) {
                    await zamClient.from('email_logs').update({ status: 'Failed', error_message: restErr.message }).eq('id', logEntry.id);
                }
                throw restErr;
            }
        }
    }
};
