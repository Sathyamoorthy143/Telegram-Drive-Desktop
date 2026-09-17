-- Folder-scoped permission grants — Phase 2 schema.
-- Run in Supabase SQL editor. Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Folders are Telegram channels (numeric channel id); folder_id 0 = drive root.
-- A grant row REPLACES the member's org-wide role for that folder only:
--   view  = list + preview/thumbnail
--   read  = view + download
--   write = read + upload/delete/create-folder/trash ops
--   full  = write + future management ops
-- No row  → the member's org role governs (backward compatible).
-- owner/admin/master bypass grants entirely.

create table if not exists public.org_folder_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  folder_id bigint not null default 0,
  member_id uuid not null references public.org_members(id) on delete cascade,
  level text not null default 'view' check (level in ('view', 'read', 'write', 'full')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, folder_id, member_id)
);
create index if not exists idx_folder_grants_lookup on public.org_folder_grants(org_id, folder_id, member_id);
