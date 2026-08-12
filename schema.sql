-- ============================================================
-- مخطط قاعدة بيانات نظام "زام" للعمليات (ZAM Operations)
-- نسخة موحدة ومحدثة بالكامل لضمان تشغيل كافة وظائف النظام
-- نفّذ هذا الملف بالكامل في Supabase -> SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- 1. الفروع (Branches)
create table if not exists branches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
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
  created_at timestamptz default now()
);

-- 3. صلاحيات الأدمن المتقدمة (Admin Permissions)
create table if not exists admin_permissions (
  profile_id uuid primary key references profiles(id) on delete cascade,
  can_manage_staff boolean default false,
  can_manage_branches boolean default false,
  can_manage_templates boolean default false,
  can_manage_automations boolean default false,
  can_manage_reports boolean default false,
  can_view_all_reports boolean default false
);

-- 4. قوالب قوائم التحقق (Checklist Templates)
create table if not exists checklist_templates (
  id uuid primary key default uuid_generate_v4(),
  task_title text not null,
  category text not null,
  shift_type text not null check (shift_type in ('Morning', 'Evening')),
  instructions text,
  branch_id uuid references branches(id) on delete cascade,
  requires_photo boolean default false,
  target_time time,
  created_at timestamptz default now()
);

-- 5. سجلات تنفيذ المهام اليومية (Checklist Logs)
create table if not exists checklist_logs (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid references checklist_templates(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  executed_by uuid references profiles(id) on delete cascade,
  status text default 'Completed',
  notes text,
  photo_url text,
  execution_date date default current_date,
  created_at timestamptz default now(),
  unique (template_id, execution_date, branch_id)
);

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
  created_at timestamptz default now()
);

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

-- 9. تقييمات جوجل المضافة بالتقارير (Negative Reviews)
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
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 12. تعريفات حقول التقارير الإضافية (Report Field Definitions)
create table if not exists report_field_definitions (
  id uuid primary key default uuid_generate_v4(),
  field_name text not null,
  field_type text not null,
  is_active boolean default true,
  display_order integer default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security (تفعيل إلزامي قبل النشر الفعلي)
-- ============================================================
alter table branches enable row level security;
alter table profiles enable row level security;
alter table admin_permissions enable row level security;
alter table checklist_templates enable row level security;
alter table checklist_logs enable row level security;
alter table daily_reports enable row level security;
alter table waste_logs enable row level security;
alter table shift_issues enable row level security;
alter table negative_reviews enable row level security;
alter table automation_settings enable row level security;
alter table automation_schedules enable row level security;
alter table report_field_definitions enable row level security;

-- ملاحظة مهمة: السياسات دي أساسية للبدء فقط (تسمح بالقراءة للجميع
-- عبر مفتاح anon اللازم لتسجيل الدخول بالباسكود). لازم تُراجع
-- وتُشدّد الصلاحيات (خصوصاً الكتابة) قبل الإطلاق الفعلي للعملاء.

create policy "allow all branches" on branches for all using (true) with check (true);
create policy "allow all profiles" on profiles for all using (true) with check (true);
create policy "allow all admin_permissions" on admin_permissions for all using (true) with check (true);
create policy "allow all checklist_templates" on checklist_templates for all using (true) with check (true);
create policy "allow all checklist_logs" on checklist_logs for all using (true) with check (true);
create policy "allow all daily_reports" on daily_reports for all using (true) with check (true);
create policy "allow all waste_logs" on waste_logs for all using (true) with check (true);
create policy "allow all shift_issues" on shift_issues for all using (true) with check (true);
create policy "allow all negative_reviews" on negative_reviews for all using (true) with check (true);
create policy "allow all automation_settings" on automation_settings for all using (true) with check (true);
create policy "allow all automation_schedules" on automation_schedules for all using (true) with check (true);
create policy "allow all report_field_definitions" on report_field_definitions for all using (true) with check (true);

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
-- عمليات تنظيف وجدولة التذكيرات (أمثلة وتعليمات إضافية)
-- ============================================================
-- 1. حذف النماذج التجريبية غير المرتبطة بفرع
-- DELETE FROM checklist_templates WHERE branch_id IS NULL AND task_title ILIKE '%تجريبي%';

-- 2. إعداد التذكيرات وتفعيل cron (نفذه يدويًا في SQL Editor بـ Supabase بعد استبدال المعاملات)
-- SELECT cron.schedule('zam-reminders','* * * * *',
--   $$SELECT net.http_post(
--     url := 'https://<project-ref>.functions.supabase.co/send-reminders',
--     headers := '{"Authorization":"Bearer <ANON_KEY>"}'::jsonb
--   )$$);

-- ============================================================
-- إعداد مخازن الملفات (Storage Buckets) وصلاحياتها في Supabase
-- ============================================================
-- 1. إنشاء باكيت task-evidence وصور الآفاتار
insert into storage.buckets (id, name, public)
values
  ('task-evidence', 'task-evidence', true),
  ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 2. السماح بالرفع والوصول العام لكافة الملفات والصور في الباكيتس بمرونة تامة
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

-- 13. سجلات إرسال البريد الإلكتروني (Email Logs)
create table if not exists email_logs (
  id uuid primary key default uuid_generate_v4(),
  recipient_email text not null,
  subject text not null,
  body_html text not null,
  status text default 'Pending' check (status in ('Pending', 'Sent', 'Failed')),
  error_message text,
  created_at timestamptz default now()
);
alter table email_logs enable row level security;
create policy "Allow all users full access to email_logs" on email_logs for all using (true) with check (true);
