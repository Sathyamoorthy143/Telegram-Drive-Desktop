create table if not exists public.user_settings (
  user_id bigint primary key,
  lock_pin_hash text,
  lock_interval_ms bigint default 900000,
  notification_mode text default 'hide',
  updated_at timestamptz default now()
);

alter table public.user_settings
  add column if not exists master_password_hash text;

alter table public.organizations
  add column if not exists entry_password_hash text;

alter table public.organizations
  alter column master_admin_id type text using master_admin_id::text;
