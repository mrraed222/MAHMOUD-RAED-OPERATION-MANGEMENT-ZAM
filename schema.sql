-- ============================================================
-- مخطط قاعدة بيانات نظام "زام" للعمليات (ZAM Operations)
-- نسخة موحدة تجمع بين zam_schema.md (القديم) و readme.md (الأحدث)
-- نفّذ هذا الملف بالكامل في Supabase -> SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- 1. الفروع
create table if not exists branches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  location_url text,
  created_at timestamptz default now()
);

-- 2. الموظفين وصلاحياتهم
create table if not exists profiles (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  email text,
  whatsapp_number text,
  role text default 'Barista' check (role in ('Barista','Supervisor','Manager','Kitchen','Waiter')),
  passcode text unique not null,
  branch_id uuid references branches(id),
  avatar_url text,
  status text default 'pending' check (status in ('pending','active','suspended')),
  created_at timestamptz default now()
);

-- 3. التقارير اليومية
create table if not exists daily_reports (
  id uuid primary key default uuid_generate_v4(),
  branch_id uuid references branches(id),
  supervisor_id uuid references profiles(id),
  total_sales decimal,
  orders_count integer,
  waste_data jsonb,
  google_maps_reviews jsonb,
  shift_type text check (shift_type in ('Morning','Evening')),
  created_at timestamptz default now()
);

-- 4. قوائم التحقق (Checklists)
create table if not exists checklists (
  id uuid primary key default uuid_generate_v4(),
  task_name text not null,
  category text,
  branch_id uuid references branches(id),
  is_completed boolean default false,
  assigned_to uuid references profiles(id),
  evidence_image_url text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- 5. التنبيهات والأتمتة
create table if not exists automations (
  id uuid primary key default uuid_generate_v4(),
  trigger_condition text,
  channel text check (channel in ('WhatsApp','Email','Push')),
  message_template text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security (تفعيل إلزامي قبل النشر الفعلي)
-- ============================================================
alter table branches enable row level security;
alter table profiles enable row level security;
alter table daily_reports enable row level security;
alter table checklists enable row level security;
alter table automations enable row level security;

-- ملاحظة مهمة: السياسات دي أساسية للبدء فقط (تسمح بالقراءة للجميع
-- عبر مفتاح anon اللازم لتسجيل الدخول بالباسكود). لازم تُراجع
-- وتُشدّد الصلاحيات (خصوصاً الكتابة) قبل الإطلاق الفعلي للعملاء.

create policy "allow read profiles for login" on profiles
  for select using (true);

create policy "allow insert profiles for registration" on profiles
  for insert with check (status = 'pending');

create policy "allow read branches" on branches
  for select using (true);

create policy "allow all checklists" on checklists
  for all using (true) with check (true);

create policy "allow all daily_reports" on daily_reports
  for all using (true) with check (true);

create policy "allow read automations" on automations
  for select using (true);

-- ============================================================
-- بيانات أولية تجريبية (اختياري - احذفها لو مش محتاجها)
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
