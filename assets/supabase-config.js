// ============================================
// إعدادات الاتصال بـ Supabase - نظام زام للعمليات
// ملف مشترك يتم تحميله في كل الشاشات
// الإصدار: 2.0 (محدّث — فرع codex/operations-wiring)
// ============================================

const SUPABASE_URL = 'https://uuphgpncmiwyigtqhjmd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1cGhncG5jbWl3eWlndHFoam1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MjIzMzEsImV4cCI6MjEwMDM5ODMzMX0.R0ACUbjGYk22VljDl7z8c_kW9Mk7P3MmenbmBXcqWH4';

const zamClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// إدارة جلسة المستخدم المسجل دخوله
// ============================================
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
// توجيه المستخدم لصفحته الرئيسية المناسبة حسب دوره
// ============================================
function zamRoleHomePath(role) {
    if (role === 'Owner' || role === 'Admin' || role === 'Manager') {
        return 'dashboard/index.html';
    }
    if (role === 'Supervisor') {
        return 'supervisor-dashboard/index.html';
    }
    return 'my-checklist/index.html';
}

// ============================================
// مساعد فحص الصلاحيات في بداية كل صفحة
// ============================================
function requireRole(allowedRoles, redirectPath) {
    const profile = ZamSession.get();
    if (!profile) {
        window.location.href = '../index.html';
        return false;
    }
    if (!allowedRoles.includes(profile.role)) {
        window.location.href = redirectPath || zamRoleHomePath(profile.role);
        return false;
    }
    return true;
}

// ============================================
// القائمة الجانبية الموحدة
// ============================================
// perm: مفتاح الصلاحية المطلوب من admin_permissions (null = صفحة أساسية دائماً ظاهرة)
const ZAM_NAV_ITEMS = [
    { key: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard', href: 'dashboard/index.html', roles: ['Owner', 'Admin', 'Manager'], perm: null },
    { key: 'branches', label: 'الفروع', icon: 'storefront', href: 'branches-checklists/index.html', roles: ['Owner', 'Admin', 'Supervisor'], perm: 'can_manage_branches' },
    { key: 'my-checklist', label: 'مهامي اليومية', icon: 'task_alt', href: 'my-checklist/index.html', roles: ['Barista', 'Kitchen', 'Waiter'], perm: null },
    { key: 'supervisor-checklist', label: 'قوائم المهام', icon: 'checklist', href: 'supervisor-checklist/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: null },
    { key: 'supervisor-dashboard', label: 'داشبورد الفرع', icon: 'space_dashboard', href: 'supervisor-dashboard/index.html', roles: ['Supervisor', 'Manager'], perm: null },
    { key: 'manage-templates', label: 'إدارة قوائم التحقق', icon: 'edit_note', href: 'manage-templates/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: 'can_manage_templates' },
    { key: 'daily-report', label: 'التقارير اليومية', icon: 'assignment', href: 'daily-report/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: null },
    { key: 'reports-log', label: 'سجل التقارير', icon: 'assessment', href: 'reports-log/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: null },
    { key: 'checklist-logs', label: 'سجل التشيك ليست بالصور', icon: 'photo_library', href: 'checklist-logs/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports' },
    { key: 'reports-monitor', label: 'متابعة التقارير', icon: 'fact_check', href: 'reports-monitor/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports' },
    { key: 'analytics', label: 'داشبورد التحليلات', icon: 'insights', href: 'analytics/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports' },
    { key: 'staff-management', label: 'إدارة الطاقم', icon: 'groups', href: 'staff-management/index.html', roles: ['Admin', 'Supervisor'], perm: 'can_manage_staff' },
    { key: 'automation-settings', label: 'إعدادات الأتمتة', icon: 'settings', href: 'automation-settings/index.html', roles: ['Admin', 'Manager', 'Supervisor'], perm: 'can_manage_automations' },
    { key: 'permissions', label: 'الأذونات والصلاحيات', icon: 'admin_panel_settings', href: 'permissions/index.html', roles: ['Owner'], perm: null },
    { key: 'employee-profile', label: 'الملف الشخصي', icon: 'person', href: 'employee-profile/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor', 'Barista', 'Kitchen', 'Waiter'], perm: null },
];

async function renderZamSidebar(activeKey, role, pathPrefix = '../') {
    const sessionProfile = ZamSession.get();
    const avatarFallback = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%23e4e2e1'/><circle cx='50' cy='38' r='18' fill='%2380756c'/><ellipse cx='50' cy='88' rx='30' ry='22' fill='%2380756c'/></svg>";
    const userAvatar = sessionProfile?.avatar_url || avatarFallback;

    // جلب صلاحيات المستخدم لمرة واحدة لفلترة القائمة الجانبية
    let permsRow = null;
    if (role !== 'Owner') {
        await zamClient.auth.getSession();
        const { data } = await zamClient.from('admin_permissions').select('*').eq('profile_id', sessionProfile.id).maybeSingle();
        permsRow = data || {};
    }

    // فلترة: المالك يرى كل شيء، غيره يفحص الدور + الصلاحية المطلوبة
    const items = ZAM_NAV_ITEMS.filter(i => {
        if (!i.roles.includes(role)) return false;
        if (i.perm && role !== 'Owner') {
            return !!(permsRow && permsRow[i.perm]);
        }
        return true;
    });

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

// ============================================
// جرس الإشعارات المشترك
// ============================================
async function renderNotificationBell() {
    const profile = ZamSession.get();
    if (!profile) return '';

    let pendingCount = 0;
    let overdueReportsCount = 0;
    let pendingChecklistCount = 0;

    try {
        if (['Owner', 'Admin', 'Manager'].includes(profile.role)) {
            const { count: pending } = await zamClient
                .from('profiles')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'pending');
            pendingCount = pending || 0;
        }

        const today = new Date().toISOString().split('T')[0];
        const { count: overdue } = await zamClient
            .from('daily_reports')
            .select('id', { count: 'exact', head: true })
            .neq('report_date', today);
        overdueReportsCount = overdue || 0;

        if (profile.branch_id) {
            const { count: pendingTasks } = await zamClient
                .from('checklist_logs')
                .select('id, checklist_templates!inner(branch_id)', { count: 'exact', head: true })
                .eq('execution_date', today)
                .is('id', null);
            pendingChecklistCount = pendingTasks || 0;
        }
    } catch (err) {
        console.error('Notification bell fetch error:', err);
    }

    const totalCount = pendingCount + overdueReportsCount + pendingChecklistCount;
    const badge = totalCount > 0
        ? `<span class="absolute -top-1 -right-1 bg-error text-on-error text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">${totalCount}</span>`
        : '';

    return `
        <div class="relative" id="zam-notif-wrapper">
            <button id="zam-notif-btn" class="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors text-on-surface-variant relative">
                <span class="material-symbols-outlined">notifications</span>
                ${badge}
            </button>
            <div id="zam-notif-menu" class="hidden absolute left-0 mt-xs w-72 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg z-50 overflow-hidden">
                <div class="p-sm bg-primary text-on-primary font-bold">الإشعارات</div>
                <div class="max-h-80 overflow-y-auto">
                    ${pendingCount > 0 ? `
                        <a href="../permissions/index.html" class="flex items-start gap-sm p-sm hover:bg-surface-container border-b border-outline-variant">
                            <span class="material-symbols-outlined text-error">person_add</span>
                            <div>
                                <p class="font-bold text-body-sm">${pendingCount} طلب تسجيل بانتظار الموافقة</p>
                                <p class="text-[11px] text-on-surface-variant">راجعهم في شاشة الأذونات والصلاحيات</p>
                            </div>
                        </a>
                    ` : ''}
                    ${overdueReportsCount > 0 ? `
                        <a href="../reports-monitor/index.html" class="flex items-start gap-sm p-sm hover:bg-surface-container border-b border-outline-variant">
                            <span class="material-symbols-outlined text-primary">fact_check</span>
                            <div>
                                <p class="font-bold text-body-sm">${overdueReportsCount} تقرير من أيام سابقة</p>
                                <p class="text-[11px] text-on-surface-variant">تابعها في متابعة التقارير</p>
                            </div>
                        </a>
                    ` : ''}
                    ${pendingChecklistCount > 0 ? `
                        <a href="../my-checklist/index.html" class="flex items-start gap-sm p-sm hover:bg-surface-container">
                            <span class="material-symbols-outlined text-tertiary">task_alt</span>
                            <div>
                                <p class="font-bold text-body-sm">مهام تشيك ليست لم تكتمل اليوم</p>
                                <p class="text-[11px] text-on-surface-variant">سجّلها قبل نهاية الوردية</p>
                            </div>
                        </a>
                    ` : ''}
                    ${totalCount === 0 ? `
                        <p class="p-md text-center text-on-surface-variant text-body-sm">لا توجد إشعارات جديدة 🎉</p>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

function attachNotificationBellHandlers() {
    const btn = document.getElementById('zam-notif-btn');
    const menu = document.getElementById('zam-notif-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!document.getElementById('zam-notif-wrapper')?.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });
}

// ============================================
// قوالب البريد الإلكتروني
// ============================================
function buildChecklistSummaryEmail({ employeeName, branchName, shiftLabel, completedCount, totalCount, tasks, categories }) {
    const tasksHtml = tasks.map(t => `
        <tr style="border-bottom: 1px solid #e0e0e0;">
            <td style="padding: 10px; font-weight: bold; color: #1c1b1f; text-align: right;">${t.task_title}</td>
            <td style="padding: 10px; color: #49454f; text-align: right;">${t.category}</td>
            <td style="padding: 10px; color: ${t.completed ? '#2e7d32' : '#c62828'}; font-weight: bold; text-align: right;">
                ${t.completed ? '✅ مكتمل' : '❌ غير مكتمل'}
            </td>
            <td style="padding: 10px; font-size: 11px; text-align: right;">
                ${t.photo_url ? `<a href="${t.photo_url}" target="_blank" style="color: #6750a4; font-weight: bold; text-decoration: none;">🖼️ عرض الإثبات</a>` : '—'}
            </td>
        </tr>
    `).join('');

    return `
        <div dir="rtl" style="font-family: Arial, sans-serif; text-align: right; background-color: #fcf8f2; padding: 20px; border-radius: 12px; border: 1px solid #e6dbcb; max-width: 600px; margin: auto;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #6750a4; margin-top: 10px; font-size: 22px;">ZAM Speciality Coffee</h2>
                <h3 style="color: #49454f; font-size: 16px;">ملخص إنجاز المهام والتشيك ليست اليومية</h3>
            </div>
            <div style="background-color: #ffffff; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 20px; text-align: right;">
                <p style="margin: 5px 0;"><strong>👤 الموظف:</strong> ${employeeName}</p>
                <p style="margin: 5px 0;"><strong>📍 الفرع:</strong> ${branchName}</p>
                <p style="margin: 5px 0;"><strong>⏰ الوردية:</strong> ${shiftLabel}</p>
                <p style="margin: 5px 0;"><strong>📂 الفئات:</strong> ${categories.join(' + ')}</p>
                <p style="margin: 5px 0;"><strong>📊 نسبة الإنجاز:</strong> تم إنجاز ${completedCount} من أصل ${totalCount} مهام</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0; text-align: right;">
                <thead>
                    <tr style="background-color: #6750a4; color: #ffffff;">
                        <th style="padding: 10px; text-align: right;">المهمة</th>
                        <th style="padding: 10px; text-align: right;">الفئة</th>
                        <th style="padding: 10px; text-align: right;">الحالة</th>
                        <th style="padding: 10px; text-align: right;">الإثبات</th>
                    </tr>
                </thead>
                <tbody>${tasksHtml}</tbody>
            </table>
            <p style="text-align: center; color: #7a7a7a; font-size: 11px; margin-top: 30px;">
                هذا البريد تم إرساله تلقائياً من نظام زام للعمليات عبر الدومين المعتمد zam.sa باستخدام Resend.
            </p>
        </div>
    `;
}

// ============================================
// دوال API مشتركة
// ============================================
const ZamAPI = {
    // تسجيل الدخول برمز المرور عبر Edge Function
    async login(passcode) {
        const { data, error } = await zamClient.functions.invoke('login-with-passcode', {
            body: { passcode }
        });

        if (error) {
            let msg = 'رمز المرور غير صحيح';
            try {
                const ctx = await error.context?.json?.();
                if (ctx?.error) msg = ctx.error;
            } catch (_) {}
            const e = new Error(msg);
            e.friendly = true;
            throw e;
        }

        const { error: otpError } = await zamClient.auth.verifyOtp({
            token_hash: data.token_hash,
            type: 'magiclink'
        });
        if (otpError) throw otpError;

        // تسجيل وقت آخر دخول حقيقي (إن فشل — مثلاً لغياب العمود — لا نوقف الدخول)
        try {
            await zamClient.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.profile.id);
        } catch (_) {}

        return data.profile;
    },

    // تسجيل موظف جديد عبر Edge Function
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

    async getBranches() {
        const { data, error } = await zamClient.from('branches').select('*').order('name');
        if (error) throw error;
        return data;
    },

    async getStaff(branchId = null) {
        let query = zamClient.from('profiles').select('*, branches(name)');
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query.order('full_name');
        if (error) throw error;
        return data;
    },

    // ============================================
    // فئات المهام (مصدر الحقيقة = employee_task_categories)
    // ============================================
    async getTaskCategories(profileId) {
        const { data, error } = await zamClient
            .from('employee_task_categories')
            .select('category')
            .eq('profile_id', profileId);
        if (error) throw error;
        return (data || []).map(row => row.category);
    },

    async replaceTaskCategories(profileId, categories) {
        const { error: deleteError } = await zamClient
            .from('employee_task_categories')
            .delete()
            .eq('profile_id', profileId);
        if (deleteError) throw deleteError;
        if (!categories || !categories.length) return;
        const rows = categories.map(category => ({ profile_id: profileId, category }));
        const { error } = await zamClient.from('employee_task_categories').insert(rows);
        if (error) throw error;
    },

    // ============================================
    // قوالب قوائم التحقق
    // ============================================
    async createTemplate(payload) {
        const { data, error } = await zamClient.from('checklist_templates').insert([payload]).select().single();
        if (error) throw error;
        return data;
    },

    async updateTemplate(id, payload) {
        const { data, error } = await zamClient.from('checklist_templates').update(payload).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },

    async deleteTemplate(id) {
        const { error } = await zamClient.from('checklist_templates').delete().eq('id', id);
        if (error) throw error;
    },

    // هل المهمة مستحقة اليوم؟ (يومية دايمًا، أسبوعية في يومها من الأسبوع، شهرية في يومها من الشهر)
    isTaskDueToday(t, date = new Date()) {
        const freq = t.frequency || 'daily';
        if (freq === 'daily') return true;
        if (freq === 'weekly') return t.day_of_week === date.getDay();
        if (freq === 'monthly') {
            // لو الشهر أقصر من اليوم المحدد (31 في شهر 30 يوم) نطبّقه في آخر يوم بالشهر
            const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
            return date.getDate() === Math.min(t.day_of_month, lastDay);
        }
        return true;
    },

    async getTemplates(category = null, shiftType = null, branchId = null) {
        let query = zamClient.from('checklist_templates').select('*');
        if (category) query = query.eq('category', category);
        if (shiftType) query = query.eq('shift_type', shiftType);
        if (branchId) {
            // استخدم or() للفلترة على مستوى DB بدل JS
            query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
        }
        query = query.order('category');
        const { data, error } = await query;
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

    // سجلات اليوم لفرع محدد
    async getTodayLogs(branchId) {
        const today = new Date().toISOString().split('T')[0];
        let query = zamClient.from('checklist_logs').select('*, profiles(full_name)').eq('execution_date', today);
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    async submitChecklistLog({ template_id, branch_id, executed_by, status = 'Completed', notes = null, photo_url = null }) {
        const { data, error } = await zamClient
            .from('checklist_logs')
            .insert([{ template_id, branch_id, executed_by, status, notes, photo_url }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteChecklistLog(logId) {
        const { error } = await zamClient.from('checklist_logs').delete().eq('id', logId);
        if (error) throw error;
    },

    // ============================================
    // التقارير اليومية
    // ============================================
    async addDailyReport(payload) {
        const { data, error } = await zamClient.from('daily_reports').insert([payload]).select().single();
        if (error) throw error;
        return data;
    },

    async getDailyReports(branchId = null) {
        let query = zamClient.from('daily_reports').select('*, branches(name), profiles(full_name)');
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

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

    async submitDailyReport({ core, custom_fields = {}, waste = [], issues = [] }) {
        // submitted_by يربط التقرير بمقدّمه الفعلي — عليه يقوم تقييد رؤية المشرف لتقاريره فقط
        const me = ZamSession.get();
        const { data: report, error } = await zamClient
            .from('daily_reports')
            .insert([{ ...core, custom_fields, submitted_by: me ? me.id : null }])
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
        // إرسال نسخة فورية للمالك والأدمن — لا يوقف العملية لو فشل
        zamClient.functions.invoke('send-report-copy', { body: { report_id: report.id } })
          .catch(err => console.warn('Immediate report email failed:', err));
        return report;
    },

    async getWasteLogs({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        const { data, error } = await zamClient.from('waste_logs').select('*, daily_reports(branch_id, report_date, branches(name))');
        if (error) throw error;
        let rows = data;
        if (branchId) rows = rows.filter(r => r.daily_reports?.branch_id === branchId);
        if (dateFrom) rows = rows.filter(r => r.daily_reports?.report_date >= dateFrom);
        if (dateTo) rows = rows.filter(r => r.daily_reports?.report_date <= dateTo);
        return rows;
    },

    async getShiftIssues({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        const { data, error } = await zamClient.from('shift_issues').select('*, daily_reports(branch_id, report_date, branches(name))');
        if (error) throw error;
        let rows = data;
        if (branchId) rows = rows.filter(r => r.daily_reports?.branch_id === branchId);
        if (dateFrom) rows = rows.filter(r => r.daily_reports?.report_date >= dateFrom);
        if (dateTo) rows = rows.filter(r => r.daily_reports?.report_date <= dateTo);
        return rows;
    },

    // ============================================
    // إحصائيات سريعة لـ staff-management
    // ============================================
    // ============================================
    // تفعيل صلاحيات الأدمن الفعلية: تفحص admin_permissions قبل فتح الصفحة
    // المالك له كل شيء، الأدمن حسب ما حُدد له، وباقي الأدوار تُدار ببوابات كل صفحة
    // ============================================
    async requireAdminPerm(permKey) {
        const me = ZamSession.get();
        if (!me) return false;
        // المالك دايمًا له كل الصلاحيات
        if (me.role === 'Owner') return true;
        // الأدوار التشغيلية (Barista, Kitchen, Waiter) ليست لهم صلاحيات أدمن أصلًا
        if (!['Admin', 'Supervisor', 'Manager'].includes(me.role)) return false;
        // الأدمن والمشرف والمدير: نفحص الجدول فعليًا
        await zamClient.auth.getSession();
        const { data, error } = await zamClient.from('admin_permissions').select(permKey).eq('profile_id', me.id).maybeSingle();
        if (error) { console.error('perm check failed:', error); return false; }
        return !!(data && data[permKey]);
    },

    async getStaffStats() {
        // آخر تسجيل دخول حقيقي من عمود last_login_at (وليس created_at)
        const lastLogin = await zamClient.from('profiles')
            .select('full_name, last_login_at')
            .not('last_login_at', 'is', null)
            .order('last_login_at', { ascending: false }).limit(1).maybeSingle()
            .catch(() => null);
        const lastPermUpdate = await zamClient.from('admin_permissions')
            .select('profile_id, updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle()
            .catch(() => null);
        // قد لا يكون العمود مضافاً بعد في قاعدة البيانات — نُرجع null بدل رقم مضلل
        const pendingReset = await zamClient.from('profiles')
            .select('id', { count: 'exact', head: true }).eq('passcode_reset_requested', true)
            .catch(() => null);
        return {
            lastLogin,
            lastPermUpdate,
            pendingResetCount: pendingReset?.count,
            resetTrackingAvailable: pendingReset !== null
        };
    },

    // ============================================
    // تصدير بيانات الطاقم إلى CSV
    // ============================================
    async exportStaffToCSV() {
        const staff = await this.getStaff();
        const headers = ['الاسم', 'البريد', 'الرقم الوظيفي', 'الدور', 'الفرع', 'الوردية', 'الحالة', 'الواتساب'];
        const rows = staff.map(emp => [
            emp.full_name || '',
            emp.email || '',
            emp.employee_number || '',
            emp.role || '',
            emp.branches?.name || '',
            emp.shift_type || '',
            emp.status || '',
            emp.whatsapp_number || ''
        ]);
        const csvContent = '\ufeff' + [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `zam-staff-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    },

    // ============================================
    // إرسال بريد إلكتروني عبر Edge Function فقط
    // (لا تستدعي Resend REST مباشرة من الواجهة لأسباب أمنية)
    // ============================================
    async sendResendEmail({ to, subject, html }) {
        let logEntry = null;
        try {
            const { data, error } = await zamClient
                .from('email_logs')
                .insert([{
                    recipient_email: Array.isArray(to) ? to.join(',') : to,
                    subject,
                    body_html: html,
                    status: 'Pending'
                }])
                .select()
                .single();
            if (!error) logEntry = data;
        } catch (e) {
            console.error('Error logging email attempt:', e);
        }

        try {
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
            console.error('Edge Function send-resend-email failed:', err);
            if (logEntry) {
                await zamClient.from('email_logs').update({
                    status: 'Failed',
                    error_message: err.message || 'unknown'
                }).eq('id', logEntry.id);
            }
            throw err;
        }
    }
};
