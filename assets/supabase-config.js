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
    { key: 'manage-templates', label: 'إدارة قوائم التحقق', icon: 'edit_note', href: 'manage-templates/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_manage_templates' },
    { key: 'daily-report', label: 'التقارير اليومية', icon: 'assignment', href: 'daily-report/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: null },
    { key: 'reports-log', label: 'سجل التقارير', icon: 'assessment', href: 'reports-log/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: null },
    { key: 'checklist-logs', label: 'سجل التشيك ليست بالصور', icon: 'photo_library', href: 'checklist-logs/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports' },
    { key: 'reports-monitor', label: 'متابعة التقارير', icon: 'fact_check', href: 'reports-monitor/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports' },
    { key: 'analytics', label: 'داشبورد التحليلات', icon: 'insights', href: 'analytics/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports' },
    { key: 'staff-management', label: 'إدارة الطاقم', icon: 'groups', href: 'staff-management/index.html', roles: ['Owner', 'Admin', 'Supervisor'], perm: 'can_manage_staff' },
    { key: 'automation-settings', label: 'إعدادات الأتمتة', icon: 'settings', href: 'automation-settings/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_manage_automations' },
    { key: 'permissions', label: 'الأذونات والصلاحيات', icon: 'admin_panel_settings', href: 'permissions/index.html', roles: ['Owner'], perm: null },
    { key: 'employee-profile', label: 'الملف الشخصي', icon: 'person', href: 'employee-profile/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor', 'Barista', 'Kitchen', 'Waiter'], perm: null },
];

// قائمة المالك النهائية: متابعة وإدارة فقط، بلا مهام تشغيل يومية أو تنفيذ مباشر.
const ZAM_OWNER_NAV_KEYS = new Set([
    'dashboard',
    'branches',
    'checklist-logs',
    'reports-log',
    'reports-monitor',
    'analytics',
    'staff-management',
    'automation-settings',
    'manage-templates',
    'permissions',
    'employee-profile',
]);

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
        if (role === 'Owner') return ZAM_OWNER_NAV_KEYS.has(i.key);
        if (!i.roles.includes(role)) return false;
        if (i.perm) {
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
            <img alt="ZAM Operations System" class="w-12 h-12 rounded-lg object-cover zam-logo" src="${pathPrefix}assets/logo/zam-logo.png"/>
            <div>
                <h1 class="font-display-lg text-[24px] font-bold text-primary leading-none">ZAM Operations System</h1>
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
// جرس الإشعارات التشغيلي المشترك
// ============================================
const ZAM_NOTIFICATION_PAGE_SIZE = 12;

function escapeNotificationText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function notificationIcon(notificationType) {
    const icons = {
        new_daily_report: 'assignment_turned_in',
        new_shift_issue: 'warning',
        negative_review: 'rate_review',
        pending_registration: 'person_add',
    };
    return icons[notificationType] || 'notifications';
}

function notificationTone(priority) {
    if (priority === 'critical') return 'text-error bg-error-container';
    if (priority === 'high') return 'text-primary bg-primary-container/30';
    return 'text-tertiary bg-tertiary-fixed/40';
}

function formatNotificationTime(value) {
    const date = new Date(value);
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (elapsedMinutes < 1) return 'الآن';
    if (elapsedMinutes < 60) return `منذ ${elapsedMinutes} د`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `منذ ${elapsedHours} س`;
    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays <= 7) return `منذ ${elapsedDays} ي`;
    return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(date);
}

function safeNotificationPath(path) {
    return typeof path === 'string' && path.startsWith('../') ? path : '../dashboard/index.html';
}

async function getLiveNotifications(profile) {
    const { data, error } = await zamClient
        .from('notifications')
        .select('id, notification_type, title, body, priority, link_path, is_read, created_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(ZAM_NOTIFICATION_PAGE_SIZE);
    if (error) throw error;
    return data || [];
}

async function renderNotificationBell() {
    const profile = ZamSession.get();
    if (!profile) return '';

    let notifications = [];
    try {
        notifications = await getLiveNotifications(profile);
    } catch (err) {
        console.error('Notification bell fetch error:', err);
    }

    const unreadCount = notifications.filter(notification => !notification.is_read).length;
    const badgeLabel = unreadCount > 99 ? '99+' : unreadCount;
    const badge = unreadCount > 0
        ? `<span class="absolute -top-1 -right-1 bg-error text-on-error text-[10px] font-bold rounded-full min-w-5 h-5 px-[3px] flex items-center justify-center">${badgeLabel}</span>`
        : '';
    const notificationItems = notifications.map(notification => {
        const unreadStyle = notification.is_read ? '' : 'bg-primary-container/10';
        const titleWeight = notification.is_read ? 'font-body-lg' : 'font-bold';
        const path = safeNotificationPath(notification.link_path);
        return `
            <a href="${path}" data-notification-link data-notification-id="${notification.id}"
               class="flex items-start gap-sm p-sm hover:bg-surface-container border-b border-outline-variant transition-colors ${unreadStyle}">
                <span class="material-symbols-outlined shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[18px] ${notificationTone(notification.priority)}">${notificationIcon(notification.notification_type)}</span>
                <span class="min-w-0 flex-1">
                    <span class="flex items-center justify-between gap-xs">
                        <span class="${titleWeight} text-body-sm text-on-surface truncate">${escapeNotificationText(notification.title)}</span>
                        ${notification.is_read ? '' : '<span class="w-2 h-2 rounded-full bg-primary shrink-0" aria-label="غير مقروء"></span>'}
                    </span>
                    <span class="block text-[11px] leading-relaxed text-on-surface-variant mt-[2px]">${escapeNotificationText(notification.body)}</span>
                    <span class="block text-[10px] text-on-surface-variant mt-[3px]">${formatNotificationTime(notification.created_at)}</span>
                </span>
            </a>`;
    }).join('');

    return `
        <div class="relative" id="zam-notif-wrapper">
            <button id="zam-notif-btn" type="button" aria-label="فتح الإشعارات" aria-expanded="false"
                class="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container active:scale-95 transition-[transform,background-color] text-on-surface-variant relative">
                <span class="material-symbols-outlined">notifications</span>
                ${badge}
            </button>
            <div id="zam-notif-menu" class="hidden absolute left-0 mt-xs w-80 max-w-[calc(100vw-2rem)] bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg z-50 overflow-hidden" role="menu">
                <div class="p-sm bg-primary text-on-primary flex items-center justify-between gap-sm">
                    <div>
                        <p class="font-bold text-body-sm">الإشعارات التشغيلية</p>
                        <p class="text-[10px] opacity-80">${unreadCount ? `${unreadCount} غير مقروء` : 'أنت على اطلاع'}</p>
                    </div>
                    ${unreadCount ? '<button id="zam-mark-all-notifications" type="button" class="text-[11px] font-bold underline underline-offset-2">تحديد الكل كمقروء</button>' : ''}
                </div>
                <div class="max-h-80 overflow-y-auto">
                    ${notificationItems || '<p class="p-md text-center text-on-surface-variant text-body-sm">لا توجد إشعارات تشغيلية حالياً.</p>'}
                </div>
            </div>
        </div>
    `;
}

async function markNotificationRead(notificationId) {
    const profile = ZamSession.get();
    if (!profile || !notificationId) return;
    const { error } = await zamClient
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .eq('user_id', profile.id)
        .eq('is_read', false);
    if (error) throw error;
}

async function markAllNotificationsRead() {
    const profile = ZamSession.get();
    if (!profile) return;
    const { error } = await zamClient
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', profile.id)
        .eq('is_read', false);
    if (error) throw error;
}

async function refreshNotificationBell() {
    const slot = document.getElementById('notif-bell-slot');
    if (!slot) return;
    slot.innerHTML = await renderNotificationBell();
    attachNotificationBellHandlers();
}

function subscribeNotificationBell(profile) {
    if (window.__zamNotificationProfileId === profile.id && window.__zamNotificationChannel) return;
    if (window.__zamNotificationChannel) zamClient.removeChannel(window.__zamNotificationChannel);

    window.__zamNotificationProfileId = profile.id;
    window.__zamNotificationChannel = zamClient
        .channel(`zam-notifications-${profile.id}`)
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}`
        }, () => {
            window.clearTimeout(window.__zamNotificationRefreshTimer);
            window.__zamNotificationRefreshTimer = window.setTimeout(() => {
                refreshNotificationBell().catch(err => console.error('Notification refresh error:', err));
            }, 120);
        })
        .subscribe();
}

function attachNotificationBellHandlers() {
    const profile = ZamSession.get();
    const btn = document.getElementById('zam-notif-btn');
    const menu = document.getElementById('zam-notif-menu');
    if (!profile || !btn || !menu) return;

    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = menu.classList.contains('hidden');
        menu.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', String(willOpen));
    });

    document.querySelectorAll('[data-notification-link]').forEach(link => {
        link.addEventListener('click', async (event) => {
            event.preventDefault();
            const destination = link.getAttribute('href') || '../dashboard/index.html';
            try {
                await markNotificationRead(link.dataset.notificationId);
            } catch (err) {
                console.error('Notification read update error:', err);
            }
            window.location.href = destination;
        });
    });

    document.getElementById('zam-mark-all-notifications')?.addEventListener('click', async () => {
        try {
            await markAllNotificationsRead();
            await refreshNotificationBell();
        } catch (err) {
            console.error('Mark all notifications read error:', err);
        }
    });

    if (!window.__zamNotificationDocumentCloseBound) {
        document.addEventListener('click', (event) => {
            if (!document.getElementById('zam-notif-wrapper')?.contains(event.target)) {
                document.getElementById('zam-notif-menu')?.classList.add('hidden');
                document.getElementById('zam-notif-btn')?.setAttribute('aria-expanded', 'false');
            }
        });
        window.__zamNotificationDocumentCloseBound = true;
    }
    subscribeNotificationBell(profile);
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
                <h2 style="color: #6750a4; margin-top: 10px; font-size: 22px;">ZAM Operations System</h2>
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

    async getAnalyticsReports({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        // جدول التقارير في التحليلات يقرأ بيانات التقرير الأصلية نفسها، لا ملخصاً مشتقاً من الهدر.
        let query = zamClient
            .from('daily_reports')
            .select('id, branch_id, supervisor_name, report_date, entry_time, shift_type, total_sales, orders_count, avg_ticket, team_status, positive_reviews, custom_fields, branches(name)')
            .order('report_date', { ascending: false })
            .order('entry_time', { ascending: false });
        if (branchId) query = query.eq('branch_id', branchId);
        if (dateFrom) query = query.gte('report_date', dateFrom);
        if (dateTo) query = query.lte('report_date', dateTo);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
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
        // الربط الداخلي مع daily_reports يجعل الفرع والتاريخ مصدرهما سجل التقرير نفسه.
        let query = zamClient
            .from('waste_logs')
            .select('*, daily_reports!inner(branch_id, report_date, branches(name))')
            .order('created_at', { ascending: false });
        if (branchId) query = query.eq('daily_reports.branch_id', branchId);
        if (dateFrom) query = query.gte('daily_reports.report_date', dateFrom);
        if (dateTo) query = query.lte('daily_reports.report_date', dateTo);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    },

    async getShiftIssues({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        // لا تعتمد التحليلات على إدخال حر؛ جميع الفلاتر مرتبطة بتاريخ وفرع daily_reports.
        let query = zamClient
            .from('shift_issues')
            .select('*, daily_reports!inner(branch_id, report_date, branches(name))')
            .order('created_at', { ascending: false });
        if (branchId) query = query.eq('daily_reports.branch_id', branchId);
        if (dateFrom) query = query.gte('daily_reports.report_date', dateFrom);
        if (dateTo) query = query.lte('daily_reports.report_date', dateTo);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
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
