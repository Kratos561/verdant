-- Verdant · acceso privado y colaboración en tiempo real.
-- 1) Solo las cuentas de app_members pueden leer o escribir (aunque alguien lograra registrarse).
--    Los miembros comparten un mismo espacio: todos ven todos los documentos.
-- 2) Los cambios del editor viajan como actualizaciones Yjs por doc_updates (cada cliente sondea
--    la Data API) y la presencia (cursores, quién está) por doc_presence.

create table if not exists app_members (
  user_id     text primary key,
  note        text not null default '',
  created_at  timestamptz not null default now()
);
-- Sin políticas ni permisos: la Data API no puede verla. Se gestiona con scripts/access.mjs.
alter table app_members enable row level security;
revoke all on app_members from authenticated;

create or replace function public.is_member() returns boolean
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select exists (select 1 from public.app_members where user_id = auth.user_id())
$$;
revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- Estado Yjs compactado del documento y hasta qué actualización incluye.
alter table documents add column if not exists ydoc text;
alter table documents add column if not exists ydoc_seq bigint not null default 0;

create table if not exists doc_updates (
  id          bigserial primary key,
  doc_id      uuid not null references documents(id) on delete cascade,
  client_id   bigint not null,
  data        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists doc_updates_doc_id on doc_updates (doc_id, id);

create table if not exists doc_presence (
  doc_id      uuid not null references documents(id) on delete cascade,
  client_id   bigint not null,
  user_id     text not null default auth.user_id(),
  state       text not null,
  updated_at  timestamptz not null default now(),
  primary key (doc_id, client_id)
);

drop trigger if exists doc_presence_touch on doc_presence;
create trigger doc_presence_touch before update on doc_presence
  for each row execute function touch_updated_at();

-- Presencia viva: solo lo actualizado en los últimos 30 s, con el reloj del servidor.
create or replace view doc_presence_live with (security_invoker = true) as
  select doc_id, client_id, user_id, state, updated_at
  from doc_presence
  where updated_at > now() - interval '30 seconds';

grant select, insert, delete on doc_updates to authenticated;
grant usage, select on sequence doc_updates_id_seq to authenticated;
grant select, insert, update, delete on doc_presence to authenticated;
grant select on doc_presence_live to authenticated;

alter table doc_updates  enable row level security;
alter table doc_presence enable row level security;

-- Políticas: espacio compartido de miembros.
drop policy if exists folders_owner on folders;
drop policy if exists folders_members on folders;
create policy folders_members on folders for all to authenticated
  using (is_member()) with check (is_member());

drop policy if exists documents_owner on documents;
drop policy if exists documents_members on documents;
create policy documents_members on documents for all to authenticated
  using (is_member()) with check (is_member());

drop policy if exists versions_owner on doc_versions;
drop policy if exists versions_members on doc_versions;
create policy versions_members on doc_versions for all to authenticated
  using (is_member()) with check (is_member());

drop policy if exists comments_doc_owner on comments;
-- Cualquier miembro puede leer, resolver o borrar comentarios; solo se crean con la propia autoría.
drop policy if exists comments_members on comments;
drop policy if exists comments_members_insert on comments;
create policy comments_members on comments for all to authenticated
  using (is_member()) with check (is_member());
create policy comments_members_insert on comments as restrictive for insert to authenticated
  with check (author_id = auth.user_id());

drop policy if exists blocks_owner on building_blocks;
drop policy if exists blocks_members on building_blocks;
create policy blocks_members on building_blocks for all to authenticated
  using (is_member()) with check (is_member());

drop policy if exists updates_members on doc_updates;
create policy updates_members on doc_updates for all to authenticated
  using (is_member()) with check (is_member());

drop policy if exists presence_members on doc_presence;
create policy presence_members on doc_presence for all to authenticated
  using (is_member()) with check (is_member() and user_id = auth.user_id());
