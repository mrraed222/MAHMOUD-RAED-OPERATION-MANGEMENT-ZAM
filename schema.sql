-- ============================================================
-- مخطط قاعدة بيانات نظام "زام" للعمليات (ZAM Operations)
-- نسخة محدّثة — فرع codex/operations-wiring
-- يضيف: جدول employee_task_categories لإسناد فئات مهام متعددة
--        لكل موظف (البار + المطبخ + الصالة + مشرف) بشكل نظيف.
-- نفّذ هذا الملف بالكامل في Supabase -> SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- 1. الفروع (Branches)
create table if not exists branches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  opening_time time not null default time '05:30',
  closing_time time not null default time '02:30',
  location_url text,
  created_at timestamptz default now()
);

-- 2. الموظفين وصلاحياتهم (Profiles)
create table if not exists profiles (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  email text,
  whatsapp_number text,
  role text default 'Barista' check (role in ('Owner','Admin','Supervisor','Manager','Kitchen','Waiter')),
  passcode text unique not null,
  branch_id uuid references branches(id) on delete set null,
  avatar_url text,
  status text default 'pending' check (status in ('pending','active','suspended','rejected')),
  receives_branch_reports boolean default false,
  employee_number text,
  shift_type text default 'Morning' check (shift_type in ('Morning','Evening','Both')),
  assigned_categories text default '',
  last_login_at timestamptz,
  passcode_reset_requested boolean default false,
  created_at timestamptz default now()
);

-- ترقية قواعد موجودة مسبقاً: أعمدة تتبع تسجيل الدخول وطلبات تغيير الرمز
alter table profiles add column if not exists last_login_at timestamptz;
alter table profiles add column if not exists passcode_reset_requested boolean default false;

-- 13. فئات المهام المتعددة لكل موظف (Employee Task Categories)
-- جدول منفصل يتيح إسناد أكثر من فئة (البار، المطبخ، الصالة، مشرف) لنفس الموظف
-- مع منع التكرار عبر القيد unique.
create table if not exists employee_task_categories (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  category text not null,
  created_at timestamptz default now(),
  unique (profile_id, category)
);

-- 3. صلاحيات الأدمن المتقدمة (Admin Permissions)
create table if not exists admin_permissions (
  profile_id uuid primary key references profiles(id) on delete cascade,
  can_manage_staff boolean default false,
  can_manage_branches boolean default false,
  can_manage_templates boolean default false,
  can_manage_automations boolean default false,
  can_manage_reports boolean default false,
  can_view_all_reports boolean default false,
  can_perform_branch_visits boolean not null default false
);

-- 4. قوالب قوائم التحقق (Checklist Templates)
create table if not exists checklist_templates (
  id uuid primary key default uuid_generate_v4(),
  task_title text not null,
  category text not null,
  shift_type text not null check (shift_type in ('Morning', 'Evening', 'Both')),
  instructions text,
  branch_id uuid references branches(id) on delete cascade,
  requires_photo boolean default false,
  target_time time,
  frequency text default 'daily' check (frequency in ('daily','weekly','monthly','hourly')),
  day_of_week int check (day_of_week between 0 and 6),
  days_of_week integer[] not null default '{}'::integer[] check (
    cardinality(days_of_week) <= 7
    and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::integer[]
    and array_position(days_of_week, null::integer) is null
  ),
  day_of_month int check (day_of_month between 1 and 31),
  allows_notes boolean not null default false,
  task_type text not null default 'standard' check (task_type in ('standard','fridge_temps','inventory_request','restroom_check')),
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  is_active boolean not null default true
);

-- 5. سجلات تنفيذ المهام اليومية (Checklist Logs)
create table if not exists checklist_logs (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid references checklist_templates(id) on delete restrict,
  branch_id uuid references branches(id) on delete cascade,
  executed_by uuid references profiles(id) on delete cascade,
  status text default 'Completed',
  shift_type text check (shift_type in ('Morning','Evening','Both')),
  notes text,
  photo_url text,
  execution_date date default (timezone('Asia/Riyadh', now()))::date,
  created_at timestamptz default now()
);
create unique index if not exists checklist_logs_legacy_no_shift_uidx
  on checklist_logs (template_id, execution_date, branch_id) where shift_type is null;
create unique index if not exists checklist_logs_shift_occurrence_uidx
  on checklist_logs (template_id, execution_date, branch_id, shift_type) where shift_type is not null;

-- سجل مستقل لتنفيذ كل فترة ساعة بالتوقيت المحلي للرياض.
create table if not exists hourly_checklist_logs (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid references checklist_templates(id) on delete set null,
  template_title text not null,
  template_category text not null default 'الصالة',
  branch_id uuid not null references branches(id) on delete restrict,
  executed_by uuid references profiles(id) on delete set null,
  status text not null default 'Completed',
  notes text,
  photo_url text,
  execution_date date not null default (timezone('Asia/Riyadh', now()))::date,
  occurrence_hour smallint not null check (occurrence_hour between 0 and 23),
  shift_type text not null check (shift_type in ('Morning','Evening')),
  created_at timestamptz not null default now()
);
create unique index if not exists hourly_checklist_logs_occurrence_uidx
  on hourly_checklist_logs (template_id, branch_id, execution_date, occurrence_hour)
  where template_id is not null;
create index if not exists hourly_checklist_logs_branch_date_idx
  on hourly_checklist_logs (branch_id, execution_date desc, occurrence_hour desc);

-- The server derives the waiter, branch, date and hour; the browser cannot insert log rows.
create or replace function public.create_hourly_checklist_log(
  p_template_id uuid,
  p_shift_type text,
  p_notes text default null,
  p_photo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_profile record;
  v_template record;
  v_main_branch_id uuid;
  v_local_now timestamp without time zone;
  v_expected_shift text;
  v_photo_url text := nullif(pg_catalog.btrim(p_photo_url), '');
  v_photo_prefix text := 'https://uuphgpncmiwyigtqhjmd.supabase.co/storage/v1/object/public/task-evidence/';
  v_object_name text;
  v_log_id uuid;
begin
  if v_user_id is null then
    raise exception 'يلزم تسجيل الدخول لتسجيل جولة الحمام';
  end if;

  select p.id, p.branch_id, p.role, p.status, p.shift_type
    into v_profile
    from public.profiles as p
   where p.id = v_user_id;
  if not found then
    raise exception 'تسجيل الجولة متاح لموظفي الصالة النشطين فقط';
  end if;
  if v_profile.status is distinct from 'active'
     or v_profile.role is distinct from 'Waiter' then
    raise exception 'تسجيل الجولة متاح لموظفي الصالة النشطين فقط';
  end if;

  select b.id
    into strict v_main_branch_id
    from public.branches as b
   where b.name = 'زام الرئيسي';
  if v_profile.branch_id is distinct from v_main_branch_id then
    raise exception 'مهمة الجولة الساعية متاحة لفرع زام الرئيسي فقط';
  end if;

  if p_shift_type is null or p_shift_type not in ('Morning', 'Evening') then
    raise exception 'الوردية المحددة غير صالحة';
  end if;
  v_local_now := pg_catalog.timezone('Asia/Riyadh', pg_catalog.now());
  v_expected_shift := case
    when v_profile.shift_type in ('Morning', 'Evening') then v_profile.shift_type
    else case when (extract(hour from v_local_now)::int * 60 + extract(minute from v_local_now)::int) >= 930 then 'Evening' else 'Morning' end
  end;
  if p_shift_type is distinct from v_expected_shift then
    raise exception 'الوردية لا تطابق وردية حسابك';
  end if;

  select t.id, t.task_title, t.category, t.task_type, t.frequency,
         t.branch_id, t.shift_type, t.is_active, t.requires_photo
    into v_template
    from public.checklist_templates as t
   where t.id = p_template_id
   for share;
  if not found then
    raise exception 'قالب الجولة الساعية غير نشط أو غير صالح لهذا الفرع';
  end if;
  if v_template.is_active is distinct from true
     or v_template.task_type is distinct from 'restroom_check'
     or v_template.frequency is distinct from 'hourly'
     or v_template.category is distinct from 'الصالة'
     or v_template.shift_type is distinct from 'Both'
     or v_template.branch_id is distinct from v_main_branch_id
     or v_template.requires_photo is distinct from true then
    raise exception 'قالب الجولة الساعية غير نشط أو غير صالح لهذا الفرع';
  end if;

  if v_photo_url is null or pg_catalog.length(v_photo_url) > 2048 then
    raise exception 'أرفق صورة إثبات صالحة قبل تسجيل الجولة';
  end if;
  if pg_catalog.left(v_photo_url, pg_catalog.length(v_photo_prefix)) <> v_photo_prefix then
    raise exception 'صورة الإثبات يجب أن تكون من مخزن مهام زام';
  end if;
  v_object_name := pg_catalog.substr(v_photo_url, pg_catalog.length(v_photo_prefix) + 1);
  if v_object_name !~ ('^' || v_user_id::text || '/[^/?#]+$') then
    raise exception 'مسار صورة الإثبات غير صالح';
  end if;
  if not exists (
    select 1
      from storage.objects as o
     where o.bucket_id = 'task-evidence'
       and o.name = v_object_name
       and (o.owner = v_user_id or o.owner_id = v_user_id::text)
       and (o.metadata ->> 'mimetype') like 'image/%'
  ) then
    raise exception 'تعذر التحقق من صورة الإثبات المرفوعة لهذا الحساب';
  end if;
  if p_notes is not null and pg_catalog.length(p_notes) > 4000 then
    raise exception 'الملاحظات تتجاوز الحد المسموح';
  end if;

  insert into public.hourly_checklist_logs (
    template_id, template_title, template_category, branch_id, executed_by,
    status, notes, photo_url, execution_date, occurrence_hour, shift_type
  ) values (
    v_template.id, v_template.task_title, v_template.category, v_main_branch_id, v_user_id,
    'Completed', nullif(pg_catalog.btrim(p_notes), ''), v_photo_url,
    v_local_now::date, extract(hour from v_local_now)::smallint, p_shift_type
  )
  on conflict (template_id, branch_id, execution_date, occurrence_hour)
    where template_id is not null
    do nothing
  returning id into v_log_id;

  if v_log_id is null then
    select l.id
      into v_log_id
      from public.hourly_checklist_logs as l
     where l.template_id = v_template.id
       and l.branch_id = v_main_branch_id
       and l.execution_date = v_local_now::date
       and l.occurrence_hour = extract(hour from v_local_now)::smallint;
  end if;
  return v_log_id;
end;
$function$;
revoke all on function public.create_hourly_checklist_log(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_hourly_checklist_log(uuid, text, text, text) to authenticated;

-- 6. التقارير اليومية (Daily Reports)
create table if not exists daily_reports (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid references branches(id) on delete cascade,
  supervisor_name text,
  report_date date default current_date,
  shift_type text check (shift_type in ('Morning', 'Evening')),
  total_sales decimal,
  orders_count integer,
  avg_ticket decimal,
  team_status text,
  positive_reviews integer default 0,
  custom_fields jsonb default '{}'::jsonb,
  sheet_key text,
  created_at timestamptz default now()
);
create unique index if not exists daily_reports_sheet_key_uidx
  on daily_reports (sheet_key)
  where sheet_key is not null and sheet_key <> '';

-- 7. سجلات الهدر (Waste Logs)
create table if not exists waste_logs (
  id uuid primary key default uuid_generate_v4(),
  report_id uuid references daily_reports(id) on delete cascade,
  item_name text not null,
  quantity decimal not null,
  unit text,
  reason text,
  created_at timestamptz default now()
);

-- 8. مشاكل الشفت (Shift Issues)
create table if not exists shift_issues (
  id uuid primary key default uuid_generate_v4(),
  report_id uuid references daily_reports(id) on delete cascade,
  description text not null,
  action_taken text,
  priority text,
  created_at timestamptz default now()
);

-- 9. تقييمات جوجل المضافة بالتقارير (Reviews)
create table if not exists negative_reviews (
  id uuid primary key default uuid_generate_v4(),
  report_id uuid references daily_reports(id) on delete cascade,
  comment_text text not null,
  review_type text,
  created_at timestamptz default now()
);

-- 10. إعدادات الأتمتة (Automation Settings)
create table if not exists automation_settings (
  key text primary key,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 11. جداول أتمتة التقارير (Automation Schedules)
create table if not exists automation_schedules (
  id uuid primary key default uuid_generate_v4(),
  report_type text not null,
  branch_id uuid references branches(id) on delete cascade,
  send_time time not null,
  shift_type text check (shift_type in ('Morning','Evening')),
  is_active boolean default true,
  last_run_date date,
  created_at timestamptz default now()
);

alter table automation_schedules add column if not exists shift_type text check (shift_type in ('Morning','Evening'));
alter table public.automation_schedules add column if not exists last_run_date date;

-- 12. تعريفات حقول التقارير الإضافية (Report Field Definitions)
create table if not exists report_field_definitions (
  id uuid primary key default uuid_generate_v4(),
  field_name text not null,
  field_type text not null,
  is_active boolean default true,
  display_order integer default 0,
  created_at timestamptz default now()
);

-- 14. سجلات إرسال البريد الإلكتروني (Email Logs)
create table if not exists email_logs (
  id uuid primary key default uuid_generate_v4(),
  recipient_email text not null,
  subject text not null,
  body_html text not null,
  status text default 'Pending' check (status in ('Pending', 'Sent', 'Failed')),
  error_message text,
  created_at timestamptz default now()
);

-- دوال سياق المستخدم المستخدمة في سياسات RLS (بلا search_path ضمني لدوال SECURITY DEFINER).
create or replace function public.current_user_role() returns text
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles as p where p.id = (select auth.uid()) limit 1 $$;

create or replace function public.current_user_branch_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select p.branch_id from public.profiles as p where p.id = (select auth.uid()) limit 1 $$;

create or replace function public.has_admin_permission(perm text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when public.current_user_role() = 'Owner' then true
    when public.current_user_role() <> 'Admin' then false
    else coalesce((
      select case perm
        when 'staff' then ap.can_manage_staff
        when 'branches' then ap.can_manage_branches
        when 'templates' then ap.can_manage_templates
        when 'automations' then ap.can_manage_automations
        when 'reports' then ap.can_manage_reports
        else false
      end
      from public.admin_permissions as ap where ap.profile_id = (select auth.uid())
    ), false)
  end;
$$;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_user_branch_id() from public, anon;
revoke all on function public.has_admin_permission(text) from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_branch_id() to authenticated;
grant execute on function public.has_admin_permission(text) to authenticated;

-- ============================================================
-- Row Level Security (تفعيل إلزامي قبل النشر الفعلي)
-- ملاحظة: السياسات دي أساسية للبدء فقط. قبل الإنتاج الحقيقي
-- لازم تشدد صلاحيات الكتابة (خاصة على storage) كما هو موضح
-- في نهاية الملف.
-- ============================================================
alter table branches enable row level security;
alter table profiles enable row level security;
alter table admin_permissions enable row level security;
alter table checklist_templates enable row level security;
alter table checklist_logs enable row level security;
alter table hourly_checklist_logs enable row level security;
alter table daily_reports enable row level security;
alter table waste_logs enable row level security;
alter table shift_issues enable row level security;
alter table negative_reviews enable row level security;
alter table automation_settings enable row level security;
alter table automation_schedules enable row level security;
alter table report_field_definitions enable row level security;
alter table employee_task_categories enable row level security;
alter table email_logs enable row level security;

create policy "allow all branches" on branches for all using (true) with check (true);
create policy "allow all profiles" on profiles for all using (true) with check (true);
create policy "allow all admin_permissions" on admin_permissions for all using (true) with check (true);
drop policy if exists "allow all checklist_templates" on checklist_templates;
create policy "Users read active checklist templates" on checklist_templates for select to authenticated
  using (is_active or public.has_admin_permission('templates'));
create policy "Owner or permitted admin manage templates" on checklist_templates for all to authenticated
  using (public.has_admin_permission('templates')) with check (public.has_admin_permission('templates'));
drop policy if exists "allow all checklist_logs" on checklist_logs;
create policy "Admin roles read all checklist logs" on checklist_logs for select to authenticated
  using (public.current_user_role() in ('Owner','Admin','Manager'));
create policy "Supervisors read own branch checklist logs" on checklist_logs for select to authenticated
  using (public.current_user_role() = 'Supervisor' and branch_id = public.current_user_branch_id());
create policy "Users can read own logs" on checklist_logs for select to authenticated
  using (executed_by = (select auth.uid()));
create or replace function public.is_hourly_checklist_template(p_template_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from public.checklist_templates as t
     where t.id = p_template_id and t.frequency = 'hourly'
  );
$function$;
revoke all on function public.is_hourly_checklist_template(uuid) from public, anon;
grant execute on function public.is_hourly_checklist_template(uuid) to authenticated;
drop policy if exists "Users can create own logs" on checklist_logs;
create policy "Users can create own logs" on checklist_logs for insert to authenticated
  with check (executed_by = (select auth.uid()) and branch_id = public.current_user_branch_id()
    and not public.is_hourly_checklist_template(template_id));
drop policy if exists "Users can update own logs" on checklist_logs;
create policy "Users can update own logs" on checklist_logs for update to authenticated
  using (executed_by = (select auth.uid()) and branch_id = public.current_user_branch_id())
  with check (executed_by = (select auth.uid()) and branch_id = public.current_user_branch_id()
    and not public.is_hourly_checklist_template(template_id));
revoke all privileges on hourly_checklist_logs from public, anon, authenticated;
grant select on hourly_checklist_logs to authenticated;
create policy "Admin roles read all hourly checklist logs" on hourly_checklist_logs for select to authenticated
  using (public.current_user_role() in ('Owner','Admin','Manager'));
create policy "Supervisors read own branch hourly checklist logs" on hourly_checklist_logs for select to authenticated
  using (public.current_user_role() = 'Supervisor' and branch_id = public.current_user_branch_id());
create policy "Users read own hourly checklist logs" on hourly_checklist_logs for select to authenticated
  using (executed_by = (select auth.uid()));
create policy "Waiters read own branch hourly checklist logs" on hourly_checklist_logs for select to authenticated
  using (
    exists (
      select 1 from profiles as p
       where p.id = (select auth.uid())
         and p.status = 'active'
         and p.role = 'Waiter'
         and p.branch_id = hourly_checklist_logs.branch_id
    )
  );
create policy "allow all daily_reports" on daily_reports for all using (true) with check (true);
create policy "allow all waste_logs" on waste_logs for all using (true) with check (true);
create policy "allow all shift_issues" on shift_issues for all using (true) with check (true);
create policy "allow all negative_reviews" on negative_reviews for all using (true) with check (true);
create policy "allow all automation_settings" on automation_settings for all using (true) with check (true);
create policy "allow all automation_schedules" on automation_schedules for all using (true) with check (true);
create policy "allow all report_field_definitions" on report_field_definitions for all using (true) with check (true);
create policy "allow all employee_task_categories" on employee_task_categories for all using (true) with check (true);
create policy "Allow all users full access to email_logs" on email_logs for all using (true) with check (true);

-- ============================================================
-- بيانات أولية تجريبية (يمكن تعديلها أو حذفها لاحقاً)
-- ============================================================
insert into branches (name, location_url) values
  ('زام 1 - العليا', null),
  ('زام 2', null),
  ('زام 3', null),
  ('زام 4', null),
  ('زام 5', null),
  ('زام 6', null)
on conflict do nothing;

-- مستخدم مدير افتراضي (رمز الدخول 1234) لأول دخول للنظام فقط
-- غيّر الرمز فوراً بعد أول تسجيل دخول حقيقي
insert into profiles (full_name, role, passcode, status)
values ('مدير النظام', 'Manager', '1234', 'active')
on conflict (passcode) do nothing;

-- ============================================================
-- إعداد مخازن الملفات (Storage Buckets) وصلاحياتها في Supabase
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('task-evidence', 'task-evidence', true),
  ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- مسح أي سياسات قديمة مكررة
drop policy if exists "Allow public access to task-evidence" on storage.objects;
drop policy if exists "Allow public access to avatars" on storage.objects;
drop policy if exists "Allow public select on task-evidence" on storage.objects;
drop policy if exists "Allow public insert on task-evidence" on storage.objects;
drop policy if exists "Allow public update on task-evidence" on storage.objects;
drop policy if exists "Allow public delete on task-evidence" on storage.objects;
drop policy if exists "Allow public select on avatars" on storage.objects;
drop policy if exists "Allow public insert on avatars" on storage.objects;
drop policy if exists "Allow public update on avatars" on storage.objects;
drop policy if exists "Allow public delete on avatars" on storage.objects;

-- سياسات مرنة للتجريب (تسمح للجميع). للإنتاج، استبدلها بالسياسات
-- المقيّدة في الأسفل (Users upload their own evidence) وقم بإلغاء
-- تفعيل الـ public policies أدناه.

-- SELECT
create policy "Allow public select on task-evidence" on storage.objects
  for select using (bucket_id = 'task-evidence');
create policy "Allow public select on avatars" on storage.objects
  for select using (bucket_id = 'avatars');

-- INSERT
create policy "Allow public insert on task-evidence" on storage.objects
  for insert with check (bucket_id = 'task-evidence');
create policy "Allow public insert on avatars" on storage.objects
  for insert with check (bucket_id = 'avatars');

-- UPDATE
create policy "Allow public update on task-evidence" on storage.objects
  for update using (bucket_id = 'task-evidence') with check (bucket_id = 'task-evidence');
create policy "Allow public update on avatars" on storage.objects
  for update using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

-- DELETE
create policy "Allow public delete on task-evidence" on storage.objects
  for delete using (bucket_id = 'task-evidence');
create policy "Allow public delete on avatars" on storage.objects
  for delete using (bucket_id = 'avatars');

-- ============================================================
-- (اختياري) سياسات Storage أكثر صرامة — للإنتاج الحقيقي
-- ============================================================
-- قبل النشر، فعّل هذه السياسات وألّق تعليق على الـ public policies
-- أعلاه. الـ public policies تسمح لأي مستخدم (حتى بدون تسجيل دخول)
-- برفع/حذف أي ملف، وهذا غير آمن في الإنتاج.
--
-- create policy "Users upload their own evidence" on storage.objects
--   for insert with check (
--     bucket_id = 'task-evidence'
--     AND (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- create policy "Users update their own evidence" on storage.objects
--   for update using (
--     bucket_id = 'task-evidence'
--     AND (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- create policy "Users delete their own evidence" on storage.objects
--   for delete using (
--     bucket_id = 'task-evidence'
--     AND (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- create policy "Users upload their own avatar" on storage.objects
--   for insert with check (
--     bucket_id = 'avatars'
--     AND (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- create policy "Users update their own avatar" on storage.objects
--   for update using (
--     bucket_id = 'avatars'
--     AND (storage.foldername(name))[1] = auth.uid()::text
--   );

-- ============================================================
-- (اختياري) أمثلة لإعداد cron jobs لـ Resend / الأتمتة
-- ============================================================
-- 1. إعداد تذكير يومي يحاكي الفكرة المطلوبة (نفّذه يدوياً في SQL Editor):
-- SELECT cron.schedule('zam-daily-reminders', '0 9 * * *',
--   $$SELECT net.http_post(
--     url := 'https://<project-ref>.functions.supabase.co/send-daily-reminders',
--     headers := '{"Authorization":"Bearer <ANON_KEY>"}'::jsonb
--   )$$);

-- 14. وقت تنفيذ المهام والتذكير اللحظي
alter table checklist_templates add column if not exists target_time time;
create table if not exists task_reminder_logs (
  template_id uuid references checklist_templates(id) on delete cascade,
  log_date date not null,
  sent_at timestamptz default now(),
  primary key (template_id, log_date)
);
alter table task_reminder_logs enable row level security;
create policy "allow all task_reminder_logs" on task_reminder_logs for all using (true) with check (true);

-- 15. تكرار المهام: يومي / أسبوعي (أيام متعددة مع بقاء day_of_week القديم) / شهري
alter table checklist_templates add column if not exists frequency text default 'daily' check (frequency in ('daily','weekly','monthly','hourly'));
alter table checklist_templates add column if not exists day_of_week int check (day_of_week between 0 and 6); -- 0=الأحد .. 6=السبت
alter table checklist_templates add column if not exists days_of_week integer[] not null default '{}'::integer[];
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.checklist_templates'::regclass
       and conname = 'checklist_templates_days_of_week_valid'
  ) then
    alter table public.checklist_templates
      add constraint checklist_templates_days_of_week_valid
      check (
        cardinality(days_of_week) <= 7
        and days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::integer[]
        and array_position(days_of_week, null::integer) is null
      );
  end if;
end
$$;
alter table checklist_templates add column if not exists day_of_month int check (day_of_month between 1 and 31);
alter table checklist_templates add column if not exists is_active boolean not null default true;

-- 16. ملاحظات الفريق أثناء التشغيل (تُعرض في داشبورد الفرع)
create table if not exists team_notes (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  shift_type text check (shift_type in ('Morning','Evening','Both')),
  note text not null,
  created_at timestamptz default now()
);
alter table team_notes enable row level security;
drop policy if exists "Owner Admin read all notes" on team_notes;
create policy "Admin roles read all notes" on team_notes for select to authenticated
  using (current_user_role() in ('Owner','Admin','Manager'));
create policy "Supervisors read own branch team notes" on team_notes for select to authenticated
  using (current_user_role() = 'Supervisor' and branch_id = current_user_branch_id());
create policy "Supervisors and managers insert notes" on team_notes for insert to authenticated with check (true);
