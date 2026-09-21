-- Legacy single-user tables (Phase 0) — missing from 001/002, required by
-- `PUT /api/settings/lock` (`supabase.rs: upsert_user_settings` -> `POST /rest/v1/user_settings`)
-- and the entry-password unlock endpoints (`set_master_password_hash` ->
-- `master_password_hash` on the same table, `entry_password_hash` on organizations).
-- Without the table, PostgREST returns:
--   PGRST205 "Could not find the table 'public.user_settings' in the schema cache"
--   (hint suggests `org_settings` because that is the only similar table present).
-- With the table but an old schema (created before the entry-password feature),
-- PostgREST returns:
--   PGRST204 "Could not find the 'master_password_hash' column of 'user_settings' in the schema cache"
-- Both are fixed by (re-)running this file: every statement is idempotent, so
-- re-running only adds what is missing.
--
-- Run in Supabase SQL editor. Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS). Safe to re-run. After running, PostgREST picks up the
-- new tables/columns automatically
-- (self-hosted: `NOTIFY pgrst, 'reload schema';` if it still 404s).
--
-- NOTE: origin/main also ships `003_org_entry_password.sql` with the same base
-- table + master/entry password columns. The two files overlap deliberately:
-- whichever one runs (or both, in any order), the schema converges.

-- Session blob store (created fire-and-forget on sign-in; user_settings no
-- longer references it — see FK note below).
create table if not exists public.telegram_sessions (
  user_id bigint primary key,
  session_blob text not null,
  api_id int,
  updated_at timestamptz default now()
);

create table if not exists public.user_settings (
  -- Deliberately NO foreign key to telegram_sessions: settings/master-password
  -- writes are keyed off the live Telegram identity (get_me) and can precede
  -- (or outlive) the session row, which is only created fire-and-forget on
  -- sign-in. An FK here turns that normal ordering into a 23503 violation.
  -- (Matches 003_org_entry_password.sql on main, which is also FK-free.)
  user_id bigint primary key,
  lock_pin_hash text,
  lock_interval_ms bigint default 900000,
  notification_mode text default 'hide' check (notification_mode in ('suppress','hide','allow')),
  master_password_hash text, -- entry-password unlock (see 003_org_entry_password.sql on main)
  updated_at timestamptz default now()
);

-- Drop the FK on tables created by the earlier revision of this file (fixes 23503).
-- Auto-generated name for the inline REFERENCES was user_settings_user_id_fkey
-- (as seen in the "violates foreign key constraint" error detail).
alter table public.user_settings
  drop constraint if exists user_settings_user_id_fkey;

-- Backfill for tables created before the entry-password feature (fixes PGRST204).
alter table public.user_settings
  add column if not exists master_password_hash text;

-- Deployed unlock endpoints also read organizations.entry_password_hash.
-- Guarded so this file still runs standalone on a fresh DB where 001 was
-- never applied (plain ALTER would abort the script otherwise).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'organizations') then
    alter table public.organizations
      add column if not exists entry_password_hash text;
  end if;
end $$;

-- Backend uses the service-role key (bypasses RLS).
alter table public.telegram_sessions enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "service_role all" on public.telegram_sessions;
drop policy if exists "service_role user_settings all" on public.user_settings;
create policy "service_role all" on public.telegram_sessions for all using (true) with check (true);
create policy "service_role user_settings all" on public.user_settings for all using (true) with check (true);

-- Auto updated_at
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists t_sessions on public.telegram_sessions;
drop trigger if exists t_user_settings on public.user_settings;
create trigger t_sessions before update on public.telegram_sessions for each row execute procedure public.touch_updated_at();
create trigger t_user_settings before update on public.user_settings for each row execute procedure public.touch_updated_at();
