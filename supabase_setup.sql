-- SwamiJet v4.8.2 Supabase setup
-- Keeps backward-compatible app_data JSON sync and adds safer performance helpers.

create table if not exists public.app_data (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

drop policy if exists "swamijet anon read" on public.app_data;
drop policy if exists "swamijet anon insert" on public.app_data;
drop policy if exists "swamijet anon update" on public.app_data;

create policy "swamijet anon read" on public.app_data
for select to anon using (true);

create policy "swamijet anon insert" on public.app_data
for insert to anon with check (true);

create policy "swamijet anon update" on public.app_data
for update to anon using (true) with check (true);

create index if not exists app_data_updated_at_idx on public.app_data (updated_at desc);
create index if not exists app_data_value_gin_idx on public.app_data using gin (value jsonb_path_ops);

-- Optional normalized tables for future scaling. The v4.8.2 single-file app remains compatible with app_data.
create table if not exists public.team_members (
  id bigint primary key,
  name text,
  mobile text,
  role text,
  username text unique,
  password_hash text,
  active boolean default true,
  updated_at timestamptz default now()
);

create table if not exists public.tasks (
  id bigint primary key,
  group_id bigint,
  title text not null,
  description text,
  due_date date,
  priority text,
  status text,
  assigned_ids jsonb default '[]'::jsonb,
  completion jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.payments (
  id bigint primary key,
  party text,
  whatsapp_no text,
  invoice_no text,
  type text,
  amount numeric,
  due_date date,
  status text,
  updated_at timestamptz default now()
);

create table if not exists public.jobcards (
  id bigint primary key,
  jc_no text,
  customer text,
  contact text,
  work_type text,
  date date,
  status text,
  assigned_ids jsonb default '[]'::jsonb,
  completion jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.site_reports (
  id bigint primary key,
  customer text,
  site_name text,
  work_type text,
  date date,
  status text,
  assigned_ids jsonb default '[]'::jsonb,
  completion jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.activity_logs (
  id bigint primary key,
  iso timestamptz,
  user_name text,
  module text,
  action text,
  details text
);

create table if not exists public.admin_notes (
  id bigint primary key,
  category text,
  title text,
  body text,
  updated_at timestamptz default now()
);

create index if not exists tasks_group_id_idx on public.tasks(group_id);
create index if not exists tasks_status_due_idx on public.tasks(status, due_date);
create index if not exists payments_status_due_idx on public.payments(status, due_date);
create index if not exists jobcards_status_date_idx on public.jobcards(status, date);
create index if not exists site_reports_status_date_idx on public.site_reports(status, date);
create index if not exists activity_logs_iso_idx on public.activity_logs(iso desc);


-- v4.8.2 performance helper indexes for future normalized migration
create index if not exists team_members_role_active_idx on public.team_members(role, active);
create index if not exists tasks_assigned_ids_gin_idx on public.tasks using gin (assigned_ids jsonb_path_ops);
create index if not exists jobcards_assigned_ids_gin_idx on public.jobcards using gin (assigned_ids jsonb_path_ops);
create index if not exists site_reports_assigned_ids_gin_idx on public.site_reports using gin (assigned_ids jsonb_path_ops);
create index if not exists activity_logs_cleanup_idx on public.activity_logs(iso);

-- Security note: this single-file app still needs app_data anon policies for backward compatibility.
-- For strict production RLS, migrate login to Supabase Auth and then replace anon policies with role/user policies.
