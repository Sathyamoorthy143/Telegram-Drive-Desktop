-- 004_fix_master_admin_id_text.sql
--
-- Some deployments ran 001_org_platform.sql (master_admin_id uuid) but never
-- the conversion in 003_org_entry_password.sql. Writing a numeric Telegram
-- user id into a uuid column fails with SQLSTATE 22P02:
--   invalid input syntax for type uuid: "8646965285"
--
-- This migration is idempotent: it only alters the column when it is still
-- uuid-typed, so it is safe to run multiple times.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'master_admin_id'
      and data_type = 'uuid'
  ) then
    alter table public.organizations
      alter column master_admin_id type text using master_admin_id::text;
  end if;
end $$;
