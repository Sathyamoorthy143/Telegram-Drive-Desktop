-- Multi-Organization Telegram Storage Platform — Phase 1 schema
-- Run in Supabase SQL editor. Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).

-- Enable pgcrypto for gen_random_uuid() on older projects
create extension if not exists "pgcrypto";

-- ============ organizations ============
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subdomain text unique not null,
  master_admin_id uuid,
  created_at timestamptz not null default now(),
  active boolean not null default true
);

-- ============ org_settings ============
create table if not exists public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  channel_id bigint,
  backup_channel_id bigint,
  lock_pin_hash text,
  lock_interval_ms bigint,
  notification_mode text
);

-- ============ org_members ============
create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  username text not null,
  password_hash text not null,
  role text not null default 'viewer' check (role in ('viewer','editor','admin','owner')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, username)
);
create index if not exists idx_org_members_org on public.org_members(org_id);

-- ============ org_trash ============
create table if not exists public.org_trash (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  message_id bigint not null,
  folder_id bigint not null default 0,
  name text not null default '',
  size bigint not null default 0,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists idx_org_trash_org on public.org_trash(org_id);
create index if not exists idx_org_trash_msg on public.org_trash(org_id, message_id);

-- ============ org_audit_logs ============
create table if not exists public.org_audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_org_audit_org_time on public.org_audit_logs(org_id, created_at desc);

-- ============ RLS ============
alter table public.organizations enable row level security;
alter table public.org_settings enable row level security;
alter table public.org_members enable row level security;
alter table public.org_trash enable row level security;
alter table public.org_audit_logs enable row level security;

-- Backend uses the service-role key (bypasses RLS). These policies are for
-- anon/authenticated keys: subdomain lookup is publicly readable so the
-- frontend can resolve org context from the Host header; everything else
-- denies by default and is accessed via the service key.
drop policy if exists "org_public_read_subdomain" on public.organizations;
create policy "org_public_read_subdomain" on public.organizations
  for select using (true);

drop policy if exists "org_no_write_anon" on public.organizations;
create policy "org_no_write_anon" on public.organizations
  for all using (false) with check (false);

drop policy if exists "org_settings_no_anon" on public.org_settings;
create policy "org_settings_no_anon" on public.org_settings
  for all using (false) with check (false);

drop policy if exists "org_members_no_anon" on public.org_members;
create policy "org_members_no_anon" on public.org_members
  for all using (false) with check (false);

drop policy if exists "org_trash_no_anon" on public.org_trash;
create policy "org_trash_no_anon" on public.org_trash
  for all using (false) with check (false);

drop policy if exists "org_audit_no_anon" on public.org_audit_logs;
create policy "org_audit_no_anon" on public.org_audit_logs
  for all using (false) with check (false);
