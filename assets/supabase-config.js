// ============================================
// إعدادات الاتصال بـ Supabase - نظام زام للعمليات
// ملف مشترك يتم تحميله في كل الشاشات
// الإصدار: 2.0 (محدّث — فرع codex/operations-wiring)
// ============================================

const SUPABASE_URL = 'https://uuphgpncmiwyigtqhjmd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1cGhncG5jbWl3eWlndHFoam1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MjIzMzEsImV4cCI6MjEwMDM5ODMzMX0.R0ACUbjGYk22VljDl7z8c_kW9Mk7P3MmenbmBXcqWH4';

// The CDN exposes the Supabase library as window.supabase. Some deployments
// may provide an already-created client instead, so support both shapes and
// fail loudly instead of letting every query fail later with .from errors.
const supabaseApi = window.supabase;
if (!supabaseApi) {
    throw new Error('Supabase library is not loaded before supabase-config.js');
}

const zamClient = typeof supabaseApi.from === 'function'
    ? supabaseApi
    : typeof supabaseApi.createClient === 'function'
        ? supabaseApi.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
        : null;

if (!zamClient || typeof zamClient.from !== 'function') {
    throw new Error('Invalid Supabase object: expected a client or createClient library');
}

// Keep an explicit property for diagnostics and modules that access the client
// through window, while preserving the existing global `zamClient` binding.
window.zamClient = zamClient;

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
    { key: 'inventory-requests', label: 'الجرد والطلبيات', icon: 'inventory_2', href: 'inventory-requests/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor', 'Quality', 'Quality Manager', 'Barista', 'Kitchen', 'Waiter'], perm: 'can_manage_inventory' },
    { key: 'supervisor-dashboard', label: 'داشبورد الفرع', icon: 'space_dashboard', href: 'supervisor-dashboard/index.html', roles: ['Supervisor', 'Manager'], perm: null },
    { key: 'manage-templates', label: 'إدارة قوائم التحقق', icon: 'edit_note', href: 'manage-templates/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_manage_templates' },
    { key: 'daily-report', label: 'التقارير اليومية', icon: 'assignment', href: 'daily-report/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: null },
    { key: 'reports-log', label: 'سجل التقارير', icon: 'assessment', href: 'reports-log/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: null, managerPerm: 'can_view_analytics' },
    { key: 'checklist-logs', label: 'سجل التشيك ليست بالصور', icon: 'photo_library', href: 'checklist-logs/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports', managerPerm: 'can_view_checklist_logs' },
    { key: 'reports-monitor', label: 'متابعة التقارير', icon: 'fact_check', href: 'reports-monitor/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports', managerPerm: 'can_view_daily_checklist_summary' },
    { key: 'analytics', label: 'داشبورد التحليلات', icon: 'insights', href: 'analytics/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor'], perm: 'can_view_all_reports', managerPerm: 'can_view_analytics' },
    { key: 'weekly-report', label: 'التقرير الأسبوعي', icon: 'summarize', href: 'weekly-report/index.html', roles: ['Owner'], perm: null },
    { key: 'branch-visits', label: 'زيارات الفروع والتكليفات', icon: 'fact_check', href: 'branch-visits-new/index.html', roles: ['Owner', 'Admin', 'Manager', 'Supervisor', 'Quality', 'Quality Manager', 'Barista', 'Kitchen', 'Waiter'], perm: null },
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
    'daily-report',
    'reports-monitor',
    'analytics',
    'weekly-report',
    'inventory-requests',
    'branch-visits',
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
        if (i.key === 'inventory-requests' && role === 'Supervisor') return true;
        const requiredPerm = role === 'Manager' && i.managerPerm ? i.managerPerm : i.perm;
        if (requiredPerm) {
            return !!(permsRow && permsRow[requiredPerm]);
        }
        return true;
    });

    const links = items.map(i => {
        const active = i.key === activeKey;
        const label = i.key === 'daily-report' && role === 'Supervisor' ? 'تقرير مشرف الشفت' : i.label;
        const cls = active
            ? 'flex items-center gap-sm p-sm rounded-lg text-primary font-bold border-r-4 border-primary bg-surface-container transition-colors'
            : 'flex items-center gap-sm p-sm rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors group';
        return `<a class="${cls}" href="${pathPrefix}${i.href}">
            <span class="material-symbols-outlined">${i.icon}</span>
            <span class="font-body-lg">${label}</span>
        </a>`;
    }).join('');

    return `<aside id="zam-main-sidebar" class="zam-sidebar fixed right-0 top-0 h-full w-[280px] bg-surface border-l border-outline-variant flex flex-col py-lg px-md gap-base z-50" aria-label="التنقل الرئيسي" aria-hidden="true" inert>
        <div class="flex items-center justify-between gap-sm mb-lg px-xs">
          <div class="flex items-center gap-sm">
            <img alt="ZAM Operations System" class="w-14 h-14 rounded-xl object-contain bg-white p-1 zam-logo" src="${pathPrefix}assets/logo/zam-logo.png"/>
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
// سلوك الشريط الجانبي والهوية العلوية المشترك
// ============================================
function installZamSidebarExperience() {
    if (typeof document === 'undefined' || document.getElementById('zam-sidebar-experience-styles')) return;

    const style = document.createElement('style');
    style.id = 'zam-sidebar-experience-styles';
    style.textContent = `
        .zam-sidebar, aside.fixed.right-0[class~="w-[280px]"] {
            position: fixed !important; inset-block: 0 !important; inset-inline-end: 0 !important;
            width: min(280px, 88vw) !important; z-index: 60 !important; display: flex !important;
            flex-direction: column; padding-top: 64px !important; visibility: hidden; transform: translateX(105%); pointer-events: none;
            transition: transform .18s ease;
        }
        body.zam-sidebar-open .zam-sidebar,
        body.zam-sidebar-open aside.fixed.right-0[class~="w-[280px]"] {
            visibility: visible; transform: translateX(0); pointer-events: auto;
        }
        .zam-sidebar-scrim { display: none !important; position: fixed; inset: 0; z-index: 50; border: 0; background: rgba(27,28,28,.48); }
        body.zam-sidebar-open { overflow: hidden; }
        body.zam-sidebar-open .zam-sidebar-scrim { display: block !important; }
        .zam-header-tools { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; direction: rtl; min-width: 0; }
        .zam-header-tools .zam-header-account { order: 1; }
        .zam-header-tools #notif-bell-slot { order: 3; flex: 0 0 auto; }
        .zam-header-tools .zam-sidebar-toggle { order: 2; }
        .zam-sidebar-toggle {
            display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px;
            padding: 0 12px; border: 1px solid #d2c4ba; border-radius: 999px; background: #fff;
            color: #33210d; font: inherit; font-size: 14px; font-weight: 700; white-space: nowrap; cursor: pointer;
        }
        .zam-sidebar .zam-sidebar-toggle { position: absolute; inset-block-start: 8px; inset-inline-end: 8px; z-index: 2; }
        .zam-sidebar-toggle:focus-visible { outline: 3px solid rgba(192,88,58,.55); outline-offset: 2px; }
        .zam-header-account { display: inline-flex; align-items: center; gap: 7px; min-width: 0; max-width: 220px; padding: 4px 8px; border: 1px solid #d2c4ba; border-radius: 999px; background: #f6f3f2; color: #33210d; }
        .zam-header-logo { width: 30px !important; height: 30px !important; flex: 0 0 30px; object-fit: contain; border-radius: 6px; background: #fff; }
        .zam-header-avatar { width: 32px !important; height: 32px !important; flex: 0 0 32px; border-radius: 50%; object-fit: cover; }
        .zam-header-identity-copy { display: flex; flex-direction: column; min-width: 0; text-align: right; }
        .zam-header-employee-name { display: block; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; }
        .zam-header-employee-role { display:block; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; color:#66736d; }
        .zam-sidebar, .zam-sidebar.bg-surface { background-color: var(--riwaq-sidebar, #16392f) !important; color: #f4f6f2 !important; border-color: rgba(255,255,255,.18) !important; }
        .zam-sidebar h1 { color: #f4f6f2 !important; }
        .zam-sidebar { padding-inline: 16px; }
        .zam-sidebar > div:first-of-type { gap: 8px; margin-bottom: 16px; padding-inline: 4px; border-bottom: 1px solid rgba(255,255,255,.16); padding-bottom: 12px; }
        .zam-sidebar > div:first-of-type > div { gap: 8px; }
        .zam-sidebar > div:first-of-type p { color: var(--riwaq-sidebar-muted, #a8beb4) !important; }
        .zam-sidebar nav { gap: 4px; }
        .zam-sidebar nav a { color: #e7f0eb !important; gap: 8px; min-height: 44px; padding: 8px; flex-shrink: 0; border-radius: 8px; }
        .zam-sidebar nav a:hover { background-color: var(--riwaq-sidebar-active, #285849) !important; color: #fff !important; }
        .zam-sidebar nav a.bg-surface-container, .zam-sidebar nav a[aria-current="page"] { background-color: var(--riwaq-sidebar-active, #285849) !important; border-color: var(--riwaq-accent, #bd8150) !important; color: #fff !important; }
        .zam-sidebar > button:not(.zam-sidebar-toggle) { border-top: 1px solid rgba(255,255,255,.16); color: #ffd9d4 !important; }
        header.zam-app-header { height: auto !important; min-height: var(--zam-header-min-height, 64px); flex-wrap: wrap !important; gap: 8px; box-sizing: border-box; }
        header.zam-app-header > :not(.zam-header-tools) { min-width: 0; }
        @media (min-width: 768px) {
            body:not(.zam-sidebar-open) [class~="md:pr-[280px]"], body:not(.zam-sidebar-open) [class~="md:pr-[312px]"] { padding-right: 0 !important; }
            body:not(.zam-sidebar-open) [class~="mr-[280px]"], body:not(.zam-sidebar-open) [class~="md:mr-[280px]"] { margin-right: 0 !important; }
        body.zam-sidebar-open [class~="md:pr-[280px]"] { padding-right: 280px !important; }
        body.zam-sidebar-open [class~="md:pr-[312px]"] { padding-right: 312px !important; }
        body.zam-sidebar-open [class~="mr-[280px]"], body.zam-sidebar-open [class~="md:mr-[280px]"] { margin-right: 280px !important; }
        }
        body:not(.zam-sidebar-open) [class~="mr-[280px]"] { margin-right: 0 !important; }
        @media (max-width: 767px) {
            body [class~="mr-[280px]"], body [class~="md:mr-[280px]"] { margin-right: 0 !important; }
            header.zam-app-header { padding-inline: 16px !important; }
            header.zam-app-header {
                display: grid !important; grid-template-columns: minmax(0, 1fr);
                grid-template-areas: "brand" "tools" "extra"; align-items: center;
                justify-content: initial; gap: 8px; padding-block: 8px !important;
            }
            header.zam-app-header > .zam-header-tools {
                grid-area: tools; justify-self: start; flex: 0 0 auto !important; width: max-content;
            }
            header.zam-app-header > :not(.zam-header-tools):nth-child(2) { grid-area: brand; min-width: 0; }
            header.zam-app-header > :not(.zam-header-tools):nth-child(3) {
                grid-area: extra; justify-self: start; width: max-content; max-width: 100%;
            }
            .zam-header-tools { gap: 6px; }
            .zam-header-account { flex: 0 0 auto; gap: 5px; max-width: 140px; padding: 3px 6px; }
            .zam-sidebar-toggle { width: 44px; min-width: 44px; padding-inline: 0 !important; gap: 0; font-size: 0; }
            .zam-sidebar-toggle-text { display: none; }
            .zam-header-logo { width: 26px !important; height: 26px !important; flex-basis: 26px; }
            .zam-header-avatar { width: 30px !important; height: 30px !important; flex-basis: 30px; }
            .zam-header-employee-name { max-width: clamp(56px, 22vw, 92px); font-size: 12px; }
            .zam-header-employee-role { max-width: clamp(56px, 22vw, 92px); }
        }
        @media (prefers-reduced-motion: reduce) { .zam-sidebar { transition: none !important; } }
    `;
    document.head.appendChild(style);

    const findSidebar = () => document.getElementById('zam-main-sidebar') ||
        Array.from(document.querySelectorAll('aside.fixed.right-0')).find(node =>
            Array.from(node.classList).some(className => className === 'w-[280px]')) || null;

    const initialize = () => {
        const sidebar = findSidebar();
        const header = document.querySelector('header');
        if (!sidebar || !header) return false;
        if (sidebar.dataset.zamSidebarReady === 'true') return true;

        sidebar.classList.add('zam-sidebar');
        sidebar.id = sidebar.id || 'zam-main-sidebar';
        sidebar.setAttribute('aria-label', 'التنقل الرئيسي');
        sidebar.setAttribute('aria-hidden', 'true');
        sidebar.inert = true;
        document.body.classList.remove('zam-sidebar-open');

        const profile = typeof ZamSession !== 'undefined' ? ZamSession.get() : null;
        const employeeName = profile?.full_name || profile?.name || 'حسابي';
        const employeeRole = ({Owner:'مالك ومطور النظام',Admin:'مدير النظام',Manager:'مدير',Supervisor:'مشرف',Barista:'باريستا',Kitchen:'مطبخ',Waiter:'نادل',Quality:'مراقب جودة','Quality Manager':'مدير جودة'})[profile?.role] || profile?.role || '';
        const avatarFallback = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%23e4e2e1'/><circle cx='50' cy='38' r='18' fill='%2380756c'/><ellipse cx='50' cy='88' rx='30' ry='22' fill='%2380756c'/></svg>";

        const hostedTools = header.querySelector('[data-zam-header-tools]');
        const tools = hostedTools || document.createElement('div');
        tools.classList.add('zam-header-tools');
        tools.setAttribute('data-zam-header-tools', '');
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'zam-sidebar-toggle';
        toggle.setAttribute('aria-controls', sidebar.id);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'إظهار قائمة التنقل');
        toggle.title = 'إظهار قائمة التنقل';
        toggle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">menu</span><span class="zam-sidebar-toggle-text">إظهار القائمة</span>';

        const account = document.createElement('div');
        account.className = 'zam-header-account';
        account.setAttribute('aria-label', `الموظف: ${employeeName}`);
        const headerHasLogo = Array.from(header.querySelectorAll('img')).some(image =>
            /zam-logo/i.test(image.currentSrc || image.src) || /zam|زام/i.test(image.alt || ''));
        if (!headerHasLogo) {
            const sidebarLogo = Array.from(sidebar.querySelectorAll('img')).find(image =>
                /zam-logo/i.test(image.currentSrc || image.src) || /zam|زام/i.test(image.alt || ''));
            if (sidebarLogo) {
                const logo = sidebarLogo.cloneNode(false);
                logo.removeAttribute('id');
                logo.className = 'zam-header-logo';
                logo.alt = 'شعار زام';
                account.appendChild(logo);
            }
        }

        let avatar = header.querySelector('#header-avatar');
        if (avatar) {
            const originalParent = avatar.parentElement;
            const avatarWrapper = avatar.closest('a') || avatar;
            account.appendChild(avatarWrapper);
            if (originalParent && originalParent !== header && !originalParent.children.length && !originalParent.textContent.trim()) {
                originalParent.remove();
            }
        } else {
            avatar = document.createElement('img');
            avatar.src = profile?.avatar_url || avatarFallback;
            avatar.alt = `صورة ${employeeName}`;
            account.appendChild(avatar);
        }
        avatar.classList.add('zam-header-avatar');
        if (!avatar.alt || avatar.alt === 'حسابي' || avatar.alt === 'صورتك الشخصية') avatar.alt = `صورة ${employeeName}`;

        const name = document.createElement('span');
        name.className = 'zam-header-employee-name';
        name.textContent = employeeName;
        name.title = employeeName;
        const identityCopy = document.createElement('span');
        identityCopy.className = 'zam-header-identity-copy';
        identityCopy.appendChild(name);
        if (employeeRole) {
            const role = document.createElement('span');
            role.className = 'zam-header-employee-role';
            role.textContent = employeeRole;
            identityCopy.appendChild(role);
        }
        account.appendChild(identityCopy);
        let notificationSlot = document.getElementById('notif-bell-slot');
        if (!notificationSlot) {
            notificationSlot = document.createElement('div');
            notificationSlot.id = 'notif-bell-slot';
        }
        tools.replaceChildren(toggle, notificationSlot, account);
        if (!hostedTools) header.prepend(tools);

        const initialHeaderHeight = Math.round(header.getBoundingClientRect().height) || 64;
        header.style.setProperty('--zam-header-min-height', `${initialHeaderHeight}px`);
        header.classList.add('zam-app-header');
        refreshNotificationBell().catch(err => { console.error('Notification initialization error:', err); showNotificationFailure(err); });
        const main = document.querySelector('main');
        const syncMainOffset = () => {
            if (main && window.getComputedStyle(header).position === 'fixed') {
                main.style.paddingTop = `${Math.ceil(header.getBoundingClientRect().height)}px`;
            }
        };
        syncMainOffset();
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncMainOffset).observe(header);

        let scrim = document.querySelector('.zam-sidebar-scrim');
        if (!scrim) {
            scrim = document.createElement('button');
            scrim.type = 'button';
            scrim.className = 'zam-sidebar-scrim';
            scrim.setAttribute('aria-label', 'إغلاق قائمة التنقل');
            document.body.appendChild(scrim);
        }

        const setOpen = (open, returnFocus = false) => {
            if (open && toggle.parentElement !== sidebar) sidebar.prepend(toggle);
            else if (!open && toggle.parentElement !== tools) tools.prepend(toggle);
            document.body.classList.toggle('zam-sidebar-open', open);
            sidebar.setAttribute('aria-hidden', String(!open));
            sidebar.inert = !open;
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'إخفاء قائمة التنقل' : 'إظهار قائمة التنقل');
            toggle.title = open ? 'إخفاء قائمة التنقل' : 'إظهار قائمة التنقل';
            toggle.querySelector('.material-symbols-outlined').textContent = open ? 'close' : 'menu';
            toggle.querySelector('.zam-sidebar-toggle-text').textContent = open ? 'إخفاء القائمة' : 'إظهار القائمة';
            if (open) sidebar.querySelector('a[href], button:not([disabled])')?.focus();
            else if (returnFocus) toggle.focus();
        };
        toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true', true));
        scrim.addEventListener('click', () => setOpen(false, true));
        document.addEventListener('keydown', event => {
            if (!document.body.classList.contains('zam-sidebar-open')) return;
            if (event.key === 'Escape') {
                setOpen(false, true);
                return;
            }
            if (event.key === 'Tab') {
                const focusable = Array.from(sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && (document.activeElement === first || document.activeElement === toggle)) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });

        sidebar.dataset.zamSidebarReady = 'true';
        return true;
    };

    const startWatching = () => {
        if (initialize()) return;
        const hasSidebarSlot = !!document.getElementById('sidebar-slot');
        const hasLegacySidebar = Array.from(document.querySelectorAll('aside.fixed.right-0')).some(node =>
            Array.from(node.classList).some(className => className === 'w-[280px]'));
        if (!hasSidebarSlot && !hasLegacySidebar) return;
        const observer = new MutationObserver(() => {
            if (initialize()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatching, { once: true });
    else startWatching();
}

installZamSidebarExperience();


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
    const [listResult, countResult] = await Promise.all([
        zamClient.from('notifications')
            .select('id, notification_type, title, body, priority, link_path, is_read, created_at')
            .eq('user_id', profile.id).order('created_at', { ascending: false }).limit(ZAM_NOTIFICATION_PAGE_SIZE),
        zamClient.from('notifications').select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id).eq('is_read', false)
    ]);
    if (listResult.error) throw listResult.error;
    if (countResult.error) throw countResult.error;
    return { notifications: listResult.data || [], unreadCount: countResult.count || 0 };
}
function showNotificationFailure(error) {
    const slot = document.getElementById('notif-bell-slot');
    if (!slot) return;
    console.error('Notification bell fetch error:', error);
    slot.innerHTML = `<div class="relative"><button id="zam-notif-btn" type="button" aria-label="تعذر تحميل الإشعارات" aria-expanded="false" aria-controls="zam-notif-menu" class="w-10 h-10 rounded-full flex items-center justify-center text-error" title="تعذر تحميل الإشعارات"><span class="material-symbols-outlined" aria-hidden="true">notifications_off</span></button><div id="zam-notif-menu" class="hidden absolute left-0 mt-xs w-80 max-w-[calc(100vw-2rem)] bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg z-50 p-md" role="status" aria-live="polite">تعذر تحميل الإشعارات. أعد المحاولة.</div></div>`;
    attachNotificationBellHandlers();
}
async function renderNotificationBell() {
    const profile = ZamSession.get();
    if (!profile) return '';
    const result = await getLiveNotifications(profile);
    const notifications = result.notifications;
    const unreadCount = result.unreadCount;
    const badgeLabel = unreadCount > 99 ? '99+' : unreadCount;
    const badge = unreadCount > 0 ? `<span class="absolute -top-1 -right-1 bg-error text-on-error text-[10px] font-bold rounded-full min-w-5 h-5 px-[3px] flex items-center justify-center" aria-label="${unreadCount} إشعارات غير مقروءة">${badgeLabel}</span>` : '';
    const notificationItems = notifications.map(notification => {
        const unreadStyle = notification.is_read ? '' : 'bg-primary-container/10';
        const titleWeight = notification.is_read ? 'font-body-lg' : 'font-bold';
        const path = safeNotificationPath(notification.link_path);
        return `<a href="${path}" data-notification-link data-notification-id="${escapeNotificationText(notification.id)}" class="flex items-start gap-sm p-sm hover:bg-surface-container border-b border-outline-variant transition-colors ${unreadStyle}"><span class="material-symbols-outlined shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[18px] ${notificationTone(notification.priority)}" aria-hidden="true">${notificationIcon(notification.notification_type)}</span><span class="min-w-0 flex-1"><span class="flex items-center justify-between gap-xs"><span class="${titleWeight} text-body-sm text-on-surface truncate">${escapeNotificationText(notification.title)}</span>${notification.is_read ? '' : '<span class="w-2 h-2 rounded-full bg-primary shrink-0" aria-label="غير مقروء"></span>'}</span><span class="block text-[11px] leading-relaxed text-on-surface-variant mt-[2px]">${escapeNotificationText(notification.body)}</span><span class="block text-[10px] text-on-surface-variant mt-[3px]">${formatNotificationTime(notification.created_at)}</span></span></a>`;
    }).join('');
    const empty = notifications.length === 0 ? '<p class="p-md text-center text-on-surface-variant text-body-sm">لا توجد إشعارات تشغيلية حالياً.</p>' : '';
    return `<div class="relative" id="zam-notif-wrapper"><button id="zam-notif-btn" type="button" aria-label="فتح الإشعارات${unreadCount ? `، ${unreadCount} غير مقروء` : ''}" aria-expanded="false" aria-controls="zam-notif-menu" class="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container active:scale-95 transition-[transform,background-color] text-on-surface-variant relative"><span class="material-symbols-outlined" aria-hidden="true">notifications</span>${badge}</button><div id="zam-notif-menu" class="hidden absolute left-0 mt-xs w-80 max-w-[calc(100vw-2rem)] bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg z-50 overflow-hidden" role="region" aria-label="الإشعارات التشغيلية"><div class="p-sm bg-primary text-on-primary flex items-center justify-between gap-sm"><div><p class="font-bold text-body-sm">الإشعارات التشغيلية</p><p class="text-[10px] opacity-80">${unreadCount ? `${unreadCount} غير مقروء` : 'أنت على اطلاع'}</p></div>${unreadCount ? '<button id="zam-mark-all-notifications" type="button" class="text-[11px] font-bold underline underline-offset-2">تحديد الكل كمقروء</button>' : ''}</div><div class="max-h-80 overflow-y-auto">${notificationItems}${empty}</div></div></div>`;
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
    slot.innerHTML = '<button type="button" class="w-10 h-10 rounded-full text-on-surface-variant" aria-label="تحميل الإشعارات" disabled><span class="material-symbols-outlined" aria-hidden="true">notifications</span></button>';
    try { slot.innerHTML = await renderNotificationBell(); attachNotificationBellHandlers(); }
    catch (err) { showNotificationFailure(err); }
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
        .subscribe((status) => {
            const slot = document.getElementById('notif-bell-slot');
            if (!slot) return;
            slot.querySelector('[data-zam-realtime-status]')?.remove();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                slot.insertAdjacentHTML('beforeend', '<span data-zam-realtime-status role="status" aria-live="polite" class="absolute top-full right-0 mt-1 z-50 rounded bg-error-container p-1 text-error text-[10px] whitespace-nowrap">التحديث الفوري غير متاح؛ أعد فتح الإشعارات للتحديث.</span>');
            }
        });
}

function positionNotificationMenu(btn, menu) {
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const margin = 8;
    const gap = 4;
    const availableWidth = Math.max(0, viewportWidth - margin * 2);
    const availableHeight = Math.max(0, viewportHeight - margin * 2);
    menu.style.position = 'fixed';
    menu.style.maxWidth = '';
    menu.style.maxHeight = `${availableHeight}px`;
    menu.style.overflowY = 'auto';
    menu.style.marginTop = '0';

    const buttonRect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const measuredWidth = menuRect.width || menu.scrollWidth;
    const menuWidth = Math.min(measuredWidth, availableWidth);
    if (measuredWidth > availableWidth) menu.style.maxWidth = `${availableWidth}px`;
    const menuHeight = Math.min(menuRect.height || menu.scrollHeight, availableHeight);
    const left = Math.max(margin, Math.min(buttonRect.left, viewportWidth - menuWidth - margin));
    const spaceBelow = viewportHeight - buttonRect.bottom - gap - margin;
    let top = buttonRect.bottom + gap;
    if (menuHeight > spaceBelow && menuHeight <= buttonRect.top - gap - margin) {
        top = buttonRect.top - gap - menuHeight;
    } else if (menuHeight > spaceBelow) {
        top = Math.max(margin, Math.min(top, viewportHeight - menuHeight - margin));
    }
    menu.style.left = `${left}px`;
    menu.style.right = 'auto';
    menu.style.top = `${top}px`;
}

function attachNotificationBellHandlers() {
    const profile = ZamSession.get();
    const btn = document.getElementById('zam-notif-btn');
    const menu = document.getElementById('zam-notif-menu');
    if (!profile || !btn || !menu) return;
    if (btn.dataset.zamBound === 'true') return;
    btn.dataset.zamBound = 'true';

    if (!window.__zamNotificationPositionBound) {
        const repositionOpenMenu = () => {
            const currentButton = document.getElementById('zam-notif-btn');
            const currentMenu = document.getElementById('zam-notif-menu');
            if (currentButton && currentMenu && !currentMenu.classList.contains('hidden')) {
                positionNotificationMenu(currentButton, currentMenu);
            }
        };
        window.addEventListener('resize', repositionOpenMenu, { passive: true });
        window.addEventListener('scroll', repositionOpenMenu, true);
        window.__zamNotificationPositionBound = true;
    }

    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (btn.getAttribute('aria-label') === 'تعذر تحميل الإشعارات') { refreshNotificationBell(); return; }
        const willOpen = menu.classList.contains('hidden');
        menu.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) positionNotificationMenu(btn, menu);
    });

    document.querySelectorAll('[data-notification-link]').forEach(link => {
        link.addEventListener('click', async (event) => {
            event.preventDefault();
            const destination = link.getAttribute('href') || '../dashboard/index.html';
            try {
                await markNotificationRead(link.dataset.notificationId);
                window.location.href = destination;
            } catch (err) {
                console.error('Notification read update error:', err);
                const menu = document.getElementById('zam-notif-menu');
                if (menu) menu.insertAdjacentHTML('afterbegin', '<p role="alert" class="p-sm text-error text-body-sm">تعذر تحديث حالة القراءة؛ بقيت هنا ولم تُفتح الوجهة. أعد المحاولة.</p>');
            }
        });
    });

    document.getElementById('zam-mark-all-notifications')?.addEventListener('click', async () => {
        try {
            await markAllNotificationsRead();
            await refreshNotificationBell();
        } catch (err) {
            console.error('Mark all notifications read error:', err);
            document.getElementById('zam-notif-menu')?.insertAdjacentHTML('afterbegin', '<p role="alert" class="p-sm text-error text-body-sm">تعذر تحديد الإشعارات كمقروءة. أعد المحاولة.</p>');
        }
    });

    if (!window.__zamNotificationDocumentCloseBound) {
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !document.getElementById('zam-notif-menu')?.classList.contains('hidden')) {
                document.getElementById('zam-notif-menu')?.classList.add('hidden');
                document.getElementById('zam-notif-btn')?.setAttribute('aria-expanded', 'false');
                document.getElementById('zam-notif-btn')?.focus();
            }
        });
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
// Supabase يعيد حداً افتراضياً للصفوف؛ نقرأ الصفحات حتى النهاية بدلاً من إسقاط بقية التحليلات.
async function readAllRows(buildQuery) {
    const pageSize = 1000;
    const maxRows = 100000;
    const rows = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
        const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows;
}

function zamRiyadhDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
}

function zamTemplateBranchIds(template) {
    const linkedIds = Array.isArray(template?.checklist_template_branches)
        ? template.checklist_template_branches.map(link => link?.branch_id).filter(Boolean)
        : [];
    const uniqueIds = [...new Set(linkedIds)];
    return uniqueIds.length ? uniqueIds : (template?.branch_id ? [template.branch_id] : []);
}

function zamTemplateAppliesToBranch(template, branchId) {
    if (!branchId) return true;
    const branchIds = zamTemplateBranchIds(template);
    if (branchIds.length) return branchIds.includes(branchId);
    return template?.branch_id == null;
}

window.zamEnableModalFocus = function(dialog, trigger) {
    if (!dialog) return function() {};
    const opener = trigger || document.activeElement;
    const inertStates = [];
    let node = dialog;
    while (node && node !== document.body) {
        const parent = node.parentElement;
        if (!parent) break;
        for (const sibling of parent.children) {
            if (sibling !== node && !sibling.contains(dialog)) {
                inertStates.push([sibling, sibling.inert]); sibling.inert = true;
            }
        }
        node = parent;
    }
    const focusable = () => Array.from(dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length);
    const onKeydown = event => {
        if (event.key !== 'Tab') return;
        const items = focusable();
        if (!items.length) { event.preventDefault(); dialog.focus?.(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', onKeydown);
    return function cleanup() {
        dialog.removeEventListener('keydown', onKeydown);
        inertStates.forEach(([element, wasInert]) => { if (element.isConnected) element.inert = wasInert; });
        if (opener?.isConnected) opener.focus();
    };
};

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
        const currentCategories = await ZamAPI.getTaskCategories(profileId);
        const nextCategories = Array.from(new Set(categories || []));
        const currentSet = new Set(currentCategories);
        const nextSet = new Set(nextCategories);
        const categoriesToAdd = nextCategories.filter(category => !currentSet.has(category));
        const categoriesToRemove = Array.from(currentSet).filter(category => !nextSet.has(category));

        // Add first: a failed insert must not erase the employee's existing assignments.
        if (categoriesToAdd.length) {
            const rows = categoriesToAdd.map(category => ({ profile_id: profileId, category }));
            const { error } = await zamClient.from('employee_task_categories').insert(rows);
            if (error) throw error;
        }

        // Only remove old rows after all additions succeeded. A failed delete leaves
        // the previous categories intact, so retrying safely completes the diff.
        if (categoriesToRemove.length) {
            const { error } = await zamClient.from('employee_task_categories')
                .delete()
                .eq('profile_id', profileId)
                .in('category', categoriesToRemove);
            if (error) throw error;
        }
    },

    async getChecklistTemplateAssignmentIds(profileId) {
        const { data, error } = await zamClient.from('checklist_template_assignments')
            .select('template_id').eq('profile_id', profileId).eq('is_active', true);
        if (error) throw error;
        return (data || []).map(row => row.template_id);
    },

    async getBranchChecklistTemplateAssignments(branchId) {
        const { data, error } = await zamClient.rpc('list_branch_checklist_template_assignments', {
            p_branch_id: branchId
        });
        if (error) throw error;
        const byProfile = {};
        (data || []).forEach(row => {
            (byProfile[row.profile_id] = byProfile[row.profile_id] || []).push(row.template_id);
        });
        return byProfile;
    },

    async getMyAssignedTemplateIds() {
        const profile = ZamSession.get();
        if (!profile?.id) return [];
        return this.getChecklistTemplateAssignmentIds(profile.id);
    },

    async replaceChecklistTemplateAssignments(profileId, templateIds) {
        const { data, error } = await zamClient.rpc('replace_checklist_template_assignments', {
            p_profile_id: profileId,
            p_template_ids: Array.from(new Set(templateIds || []))
        });
        if (error) throw error;
        return data;
    },

    async getManagerReportScopes() {
        const [scopesResult, branchesResult] = await Promise.all([
            zamClient.from('manager_report_scopes').select('profile_id,scope_mode'),
            zamClient.from('manager_report_scope_branches').select('profile_id,branch_id')
        ]);
        if (scopesResult.error) throw scopesResult.error;
        if (branchesResult.error) throw branchesResult.error;
        const scopes = Object.fromEntries((scopesResult.data || []).map(row => [row.profile_id, {
            mode: row.scope_mode,
            branchIds: []
        }]));
        (branchesResult.data || []).forEach(row => {
            if (scopes[row.profile_id]) scopes[row.profile_id].branchIds.push(row.branch_id);
        });
        return scopes;
    },

    async saveManagerReportScope(profileId, mode, branchIds = [], legacyCanViewAll = false) {
        const { error } = await zamClient.rpc('save_manager_report_scope', {
            p_profile_id: profileId,
            p_scope_mode: mode,
            p_branch_ids: mode === 'selected' ? Array.from(new Set(branchIds || [])) : [],
            p_legacy_can_view_all: !!legacyCanViewAll
        });
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
        const { data: newId, error } = await zamClient.rpc('version_checklist_template', {
            p_template_id: id,
            p_payload: payload
        });
        if (error) throw error;
        const { data, error: readError } = await zamClient.from('checklist_templates').select('*').eq('id', newId).single();
        if (readError) throw readError;
        return data;
    },

    // Draft multi-branch save path; requires the reviewed branch-scope migration/RPC.
    async saveTemplateWithBranches(id, payload, branchIds, allBranches) {
        const { data: newId, error } = await zamClient.rpc('save_checklist_template_with_branches', {
            p_template_id: id || null,
            p_payload: payload,
            p_branch_ids: allBranches ? [] : (branchIds || []),
            p_is_global: !!allBranches
        });
        if (error) throw error;
        const { data, error: readError } = await zamClient.from('checklist_templates')
            .select('*, checklist_template_branches(branch_id)').eq('id', newId).single();
        if (readError) throw readError;
        return data;
    },

    async saveTemplateGroupWithBranches(templateIds, payload, branchIds, allBranches) {
        const { data: newId, error } = await zamClient.rpc('save_checklist_template_group_with_branches', {
            p_template_ids: templateIds || [],
            p_payload: payload,
            p_branch_ids: allBranches ? [] : (branchIds || []),
            p_is_global: !!allBranches
        });
        if (error) throw error;
        const { data, error: readError } = await zamClient.from('checklist_templates')
            .select('*, checklist_template_branches(branch_id)').eq('id', newId).single();
        if (readError) throw readError;
        return data;
    },

    async saveRestroomHourlyTaskWithBranches(id, payload) {
        const { data: newId, error } = await zamClient.rpc('save_restroom_hourly_task_with_branches', {
            p_template_id: id,
            p_payload: payload
        });
        if (error) throw error;
        const { data, error: readError } = await zamClient.from('checklist_templates')
            .select('*, checklist_template_branches(branch_id)').eq('id', newId).single();
        if (readError) throw readError;
        return data;
    },

    async initializeRestroomHourlyTask(templateId) {
        const { data, error } = await zamClient.rpc('initialize_restroom_hourly_task', {
            p_template_id: templateId
        });
        if (error) throw error;
        return data;
    },

    async getRestroomHourlyTaskConfig() {
        const { data, error } = await zamClient.from('restroom_hourly_task_config')
            .select('template_id, active_from, is_active')
            .eq('id', 1).eq('is_active', true).maybeSingle();
        if (error) throw error;
        return data;
    },

    async deleteTemplate(id) {
        // "الحذف" من الواجهة أرشفة غير إتلافية حتى لا تنحذف السجلات التاريخية.
        const { data, error } = await zamClient.from('checklist_templates')
            .update({ is_active: false }).eq('id', id).eq('is_active', true).select().maybeSingle();
        if (error) throw error;
        return data;
    },

    async archiveRestroomHourlyTask(id) {
        const { error } = await zamClient.rpc('archive_restroom_hourly_task', { p_template_id: id });
        if (error) throw error;
    },

    async deleteTemplateGroup(templateIds) {
        const { data, error } = await zamClient.rpc('archive_checklist_template_group', {
            p_template_ids: templateIds || []
        });
        if (error) throw error;
        return data;
    },

    async copyArchivedTemplateAsNewVersion(id) {
        let { data: old, error: readError } = await zamClient.from('checklist_templates')
            .select('*, checklist_template_branches(branch_id)').eq('id', id).eq('is_active', false).single();
        if (readError && /checklist_template_branches|relationship/i.test(`${readError.message || ''} ${readError.details || ''}`)) {
            ({ data: old, error: readError } = await zamClient.from('checklist_templates')
                .select('*').eq('id', id).eq('is_active', false).single());
        }
        if (readError) throw readError;
        const branchIds = zamTemplateBranchIds(old);
        const allBranches = old.branch_id == null && branchIds.length === 0;
        const { id: _oldId, created_at: _createdAt, ...payload } = old;
        delete payload.checklist_template_branches;
        return this.saveTemplateWithBranches(null, { ...payload, is_active: true }, branchIds, allBranches);
    },

    // هل المهمة مستحقة اليوم؟ (يومية دايمًا، أسبوعية في يومها من الأسبوع، شهرية في يومها من الشهر)
    isTaskDueToday(t, date = new Date()) {
        const freq = t.frequency || 'daily';
        if (freq === 'daily' || freq === 'hourly') return true;
        const dateParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date);
        const year = Number(dateParts.find(part => part.type === 'year')?.value);
        const month = Number(dateParts.find(part => part.type === 'month')?.value);
        const day = Number(dateParts.find(part => part.type === 'day')?.value);
        const riyadhDate = new Date(Date.UTC(year, month - 1, day));
        if (freq === 'weekly') {
            const days = Array.isArray(t.days_of_week) ? t.days_of_week : [];
            return days.length
                ? days.some(day => Number(day) === riyadhDate.getUTCDay())
                : Number(t.day_of_week) === riyadhDate.getUTCDay();
        }
        if (freq === 'monthly') {
            // لو الشهر أقصر من اليوم المحدد (31 في شهر 30 يوم) نطبّقه في آخر يوم بالشهر
            const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
            return day === Math.min(Number(t.day_of_month), lastDay);
        }
        return true;
    },

    async getTemplates(category = null, shiftType = null, branchId = null, { includeArchived = false } = {}) {
        const buildQuery = (withBranchScopes) => {
            let query = zamClient.from('checklist_templates').select(
                withBranchScopes ? '*, checklist_template_branches(branch_id)' : '*'
            );
            if (!includeArchived) query = query.eq('is_active', true);
            if (category) query = query.eq('category', category);
            if (shiftType) query = query.in('shift_type', [shiftType, 'Both']);
            if (!withBranchScopes && branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
            return query.order('category');
        };
        let { data, error } = await buildQuery(true);
        if (error && /checklist_template_branches|relationship/i.test(`${error.message || ''} ${error.details || ''}`)) {
            ({ data, error } = await buildQuery(false));
        }
        if (error) throw error;
        const templates = data || [];
        return branchId ? templates.filter(template => zamTemplateAppliesToBranch(template, branchId)) : templates;
    },

    async getChecklistLogs({ branchId = null, date = null, dateFrom = null, dateTo = null, shiftType = null } = {}) {
        return readAllRows(() => {
            let q = zamClient.from('checklist_logs')
              .select('id,template_id,branch_id,executed_by,status,notes,photo_url,execution_date,created_at,shift_type,checklist_templates(task_title,category,shift_type,requires_photo),profiles(full_name,role),branches(name)')
              .order('execution_date', { ascending: false })
              .order('created_at', { ascending: false });
            if (date) q = q.eq('execution_date', date);
            if (dateFrom) q = q.gte('execution_date', dateFrom);
            if (dateTo) q = q.lte('execution_date', dateTo);
            if (branchId) q = q.eq('branch_id', branchId);
            return q;
        }).then(data => shiftType ? data.filter(l => {
            if (l.shift_type) return l.shift_type === shiftType;
            const templateShift = l.checklist_templates?.shift_type;
            return templateShift !== 'Both' && templateShift === shiftType;
        }) : data);
    },

    async getHourlyChecklistLogs({ branchId = null, date = null, dateFrom = null, dateTo = null, shiftType = null } = {}) {
        return readAllRows(() => {
            let q = zamClient.from('hourly_checklist_logs')
                .select('id,template_id,template_title,template_category,branch_id,executed_by,status,notes,photo_url,steps_completed,execution_date,occurrence_hour,shift_type,created_at,checklist_templates(task_title,category,shift_type),profiles(full_name,role),branches(name)')
                .order('execution_date', { ascending: false }).order('occurrence_hour', { ascending: false });
            if (date) q = q.eq('execution_date', date);
            if (dateFrom) q = q.gte('execution_date', dateFrom);
            if (dateTo) q = q.lte('execution_date', dateTo);
            if (branchId) q = q.eq('branch_id', branchId);
            if (shiftType) q = q.eq('shift_type', shiftType);
            return q;
        });
    },

    async submitHourlyChecklistLog({ template_id, shift_type, notes = null, photo_url = null }) {
        const { data, error } = await zamClient.rpc('create_hourly_checklist_log', {
            p_template_id: template_id,
            p_shift_type: shift_type,
            p_notes: notes,
            p_photo_url: photo_url
        });
        if (error) throw error;
        return data;
    },

    async submitRestroomHourlyOccurrence({ template_id, shift_type, steps, notes = null, photo_url = null }) {
        const { data, error } = await zamClient.rpc('complete_restroom_hourly_occurrence', {
            p_template_id: template_id,
            p_shift_type: shift_type,
            p_steps: steps,
            p_notes: notes,
            p_photo_url: photo_url
        });
        if (error) throw error;
        return data;
    },

    // سجلات اليوم لفرع محدد
    async getTodayLogs(branchId) {
        const today = zamRiyadhDateString();
        let query = zamClient.from('checklist_logs').select('*, profiles(full_name)').eq('execution_date', today);
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    async submitChecklistLog({ template_id, branch_id, executed_by, status = 'Completed', notes = null, photo_url = null, shift_type = null }) {
        const { data, error } = await zamClient
            .from('checklist_logs')
            .insert([{ template_id, branch_id, executed_by, status, notes, photo_url, shift_type, execution_date: zamRiyadhDateString() }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteChecklistLog(logId) {
        const { error } = await zamClient.from('checklist_logs').delete().eq('id', logId);
        if (error) throw error;
    },

    async getTeamNotes({ branchId = null, date = null, shiftType = null } = {}) {
        return readAllRows(() => {
            let q = zamClient.from('team_notes')
                .select('id,profile_id,branch_id,shift_type,note,created_at,profiles(full_name,role),branches(name)')
                .order('created_at', { ascending: false });
            if (branchId) q = q.eq('branch_id', branchId);
            if (shiftType) q = q.eq('shift_type', shiftType);
            if (date) {
                const start = new Date(`${date}T00:00:00+03:00`);
                const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
                q = q.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
            }
            return q;
        });
    },

    async getFridgeReadings({ branchId = null, date = null, shiftType = null } = {}) {
        return readAllRows(() => {
            let q = zamClient.from('fridge_readings')
                .select('id,branch_id,fridge_id,recorded_by,temperature,status,note,reading_date,created_at,shift_type,fridges(kind,number,name),profiles(full_name,role),branches(name)')
                .order('created_at', { ascending: false });
            if (branchId) q = q.eq('branch_id', branchId);
            if (date) {
                const start = new Date(`${date}T00:00:00+03:00`);
                const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
                q = q.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
            }
            if (shiftType) q = q.eq('shift_type', shiftType);
            return q;
        });
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

    async getDailyReportMatches({ branchId, reportDate, shiftType }) {
        if (!branchId || !reportDate || !shiftType) throw new Error('بيانات الفرع والتاريخ والوردية مطلوبة للتحقق من التكرار.');
        const { data, error } = await zamClient.from('daily_reports')
            .select('id, branch_id, report_date, shift_type')
            .eq('branch_id', branchId)
            .eq('report_date', reportDate)
            .eq('shift_type', shiftType)
            .limit(2);
        if (error) throw error;
        return data || [];
    },

    async getAnalyticsReports({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        // جدول التقارير في التحليلات يقرأ بيانات التقرير الأصلية نفسها، لا ملخصاً مشتقاً من الهدر.
        return readAllRows(() => {
            let query = zamClient
                .from('daily_reports')
                .select('id, branch_id, supervisor_name, report_date, entry_time, shift_type, total_sales, orders_count, avg_ticket, team_status, positive_reviews, custom_fields, branches(name)')
                .order('report_date', { ascending: false })
                .order('entry_time', { ascending: false });
            if (branchId) query = query.eq('branch_id', branchId);
            if (dateFrom) query = query.gte('report_date', dateFrom);
            if (dateTo) query = query.lte('report_date', dateTo);
            return query;
        });
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
        if (!core?.branch_id || !core?.report_date || !['Morning', 'Evening'].includes(core?.shift_type)) {
            throw new Error('بيانات الفرع والتاريخ والوردية مطلوبة لحفظ التقرير.');
        }
        const me = ZamSession.get();
        const sheetKey = `zam-web-daily-report-v1:${core.branch_id}:${core.report_date}:${core.shift_type}`;
        const { data: report, error } = await zamClient
            .from('daily_reports')
            .insert([{ ...core, sheet_key: sheetKey, custom_fields, submitted_by: me ? me.id : null }])
            .select()
            .single();
        if (error) {
            const errorContext = `${error.constraint || ''} ${error.message || ''} ${error.details || ''}`;
            if (error.code === '23505' && /daily_reports_sheet_key_uidx|sheet_key/i.test(errorContext)) {
                const duplicate = new Error('يوجد تقرير محفوظ لهذا الفرع والتاريخ والوردية.');
                duplicate.duplicateReport = true;
                duplicate.cause = error;
                throw duplicate;
            }
            throw error;
        }

        function partialReportError(cause) {
            const wrapped = new Error(`Report ${report.id} was created, but saving its detail rows failed: ${(cause && cause.message) || cause}`);
            wrapped.reportId = report.id;
            wrapped.partialSave = true;
            wrapped.cause = cause;
            return wrapped;
        }

        if (waste.length) {
            const rows = waste.map(w => ({ ...w, report_id: report.id }));
            const { error: wErr } = await zamClient.from('waste_logs').insert(rows);
            if (wErr) throw partialReportError(wErr);
        }
        if (issues.length) {
            const rows = issues.map(i => ({ ...i, report_id: report.id }));
            const { error: iErr } = await zamClient.from('shift_issues').insert(rows);
            if (iErr) throw partialReportError(iErr);
        }
        return report;
    },

    async getWasteLogs({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        // الربط الداخلي مع daily_reports يجعل الفرع والتاريخ مصدرهما سجل التقرير نفسه.
        return readAllRows(() => {
            let query = zamClient
                .from('waste_logs')
                .select('*, daily_reports!inner(branch_id, report_date, shift_type, branches(name))')
                .order('created_at', { ascending: false });
            if (branchId) query = query.eq('daily_reports.branch_id', branchId);
            if (dateFrom) query = query.gte('daily_reports.report_date', dateFrom);
            if (dateTo) query = query.lte('daily_reports.report_date', dateTo);
            return query;
        });
    },

    async getShiftIssues({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        // لا تعتمد التحليلات على إدخال حر؛ جميع الفلاتر مرتبطة بتاريخ وفرع daily_reports.
        return readAllRows(() => {
            let query = zamClient
                .from('shift_issues')
                .select('*, daily_reports!inner(branch_id, report_date, branches(name))')
                .order('created_at', { ascending: false });
            if (branchId) query = query.eq('daily_reports.branch_id', branchId);
            if (dateFrom) query = query.gte('daily_reports.report_date', dateFrom);
            if (dateTo) query = query.lte('daily_reports.report_date', dateTo);
            return query;
        });
    },

    async getAnalyticsTechnicalIssues({ branchId = null, dateFrom = null, dateTo = null } = {}) {
        // بلاغات الأعطال الفنية مصدر منفصل عن shift_issues ولا تملك حقل وردية.
        return readAllRows(() => {
            let query = zamClient
                .from('technical_issues')
                .select('id,branch_id,title,description,source,priority,status,created_at,resolved_at,branches(name),fridges(name)')
                .order('created_at', { ascending: false });
            if (branchId) query = query.eq('branch_id', branchId);
            if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00+03:00`);
            if (dateTo) {
                const endExclusive = new Date(`${dateTo}T00:00:00+03:00`);
                if (Number.isNaN(endExclusive.getTime())) throw new Error('تاريخ نهاية الفترة غير صالح.');
                endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
                query = query.lt('created_at', endExclusive.toISOString());
            }
            return query;
        });
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
        if (!['Admin', 'Supervisor', 'Manager', 'Quality', 'Quality Manager'].includes(me.role)) return false;
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
    },

    // ============================================
    // الثلاجات والفريزرات + البلاغات التقنية
    // ============================================
    todayDate() {
        return zamRiyadhDateString();
    },

    // حالة القراءة: ok | warning | problem
    fridgeReadingStatus(fridge, temperature) {
        const t = Number(temperature);
        if (t >= Number(fridge.problem_threshold)) return 'problem';
        const aboveMax = t > Number(fridge.target_max);
        const belowMin = fridge.target_min !== null && fridge.target_min !== undefined && t < Number(fridge.target_min);
        return (aboveMax || belowMin) ? 'warning' : 'ok';
    },

    async getFridges(branchId, { includeInactive = false } = {}) {
        let q = zamClient.from('fridges').select('*').eq('branch_id', branchId)
            .order('kind', { ascending: true }).order('number', { ascending: true });
        if (!includeInactive) q = q.eq('active', true);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
    },

    async saveFridge(payload, id = null) {
        const q = id
            ? zamClient.from('fridges').update(payload).eq('id', id)
            : zamClient.from('fridges').insert([payload]);
        const { data, error } = await q.select().single();
        if (error) throw error;
        return data;
    },

    async deleteFridge(id) {
        const { error } = await zamClient.from('fridges').delete().eq('id', id);
        if (error) throw error;
    },

    async getTodayFridgeReadings(branchId, shiftType = null) {
        const today = this.todayDate();
        const start = new Date(`${today}T00:00:00+03:00`);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        let query = zamClient.from('fridge_readings').select('*')
            .eq('branch_id', branchId)
            .gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
        if (shiftType) query = query.eq('shift_type', shiftType);
        const { data, error } = await query.order('created_at', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    // يحفظ القراءات، وينشئ بلاغ مشكلة تقنية تلقائيًا لأي قراءة تتخطى حد المشكلة
    async submitFridgeReadings(entries, { branch_id, recorded_by, shift_type = null }) {
        // entries: [{ fridge, temperature, note }]
        const rows = entries.map(e => ({
            fridge_id: e.fridge.id,
            branch_id,
            recorded_by,
            shift_type,
            reading_date: this.todayDate(),
            temperature: Number(e.temperature),
            status: this.fridgeReadingStatus(e.fridge, e.temperature),
            note: e.note || null
        }));
        const { data, error } = await zamClient.from('fridge_readings').insert(rows).select();
        if (error) throw error;
        const problems = (data || []).filter(r => r.status === 'problem');
        if (problems.length) {
            const issues = problems.map(r => {
                const f = entries.find(e => e.fridge.id === r.fridge_id).fridge;
                const label = (f.kind === 'freezer' ? 'فريزر' : 'ثلاجة') + ' رقم ' + f.number + (f.name ? ' (' + f.name + ')' : '');
                return {
                    branch_id,
                    reported_by: recorded_by,
                    source: 'fridge',
                    fridge_id: f.id,
                    reading_id: r.id,
                    title: 'ارتفاع درجة حرارة ' + label,
                    description: 'القراءة ' + r.temperature + '° وحد المشكلة ' + f.problem_threshold + '°' + (r.note ? ' — ' + r.note : ''),
                    priority: 'high'
                };
            });
            const { error: issueErr } = await zamClient.from('technical_issues').insert(issues);
            if (issueErr) throw issueErr;
        }
        return { readings: data || [], problemCount: problems.length };
    },

    async createTechnicalIssue({ branch_id, reported_by, title, description = null, priority = 'normal', fridge_id = null, report_id = null }) {
        const issue = { branch_id, reported_by, source: 'manual', title, description, priority, fridge_id };
        if (report_id !== null && report_id !== undefined) {
            if (typeof report_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(report_id)) {
                throw new Error('معرّف التقرير غير صالح.');
            }
            issue.report_id = report_id;
        }
        const { data, error } = await zamClient.from('technical_issues')
            .insert([issue])
            .select().single();
        if (error) throw error;
        return data;
    },

    async getTechnicalIssues(branchId, { onlyOpen = true } = {}) {
        let q = zamClient.from('technical_issues').select('*')
            .order('created_at', { ascending: false }).limit(100);
        if (branchId) q = q.eq('branch_id', branchId);
        if (onlyOpen) q = q.eq('status', 'open');
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
    },
    async updateTechnicalIssue(id, { status, internal_comment }) {
        if (!id || !['open', 'resolved'].includes(status)) throw new Error('الحالة غير صالحة.');
        const payload = {
            status,
            resolved_at: status === 'resolved' ? new Date().toISOString() : null
        };
        if (internal_comment !== undefined) {
            const comment = internal_comment == null ? '' : String(internal_comment).trim();
            if (comment.length > 2000) throw new Error('تعليق المتابعة يتجاوز الحد المسموح (2000 حرف).');
            payload.internal_comment = comment || null;
        }
        const { data, error } = await zamClient.from('technical_issues')
            .update(payload).eq('id', id).select('id').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('لم يُحفظ التعديل؛ تحقق من صلاحية تحديث البلاغ.');
        return data;
    }
};
