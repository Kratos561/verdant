-- Verdant · esquema inicial.
-- La Data API de Neon entra como rol `authenticated` con el JWT de Neon Auth;
-- auth.user_id() devuelve el `sub` del usuario y cada política lo compara con el dueño.

create extension if not exists pg_trgm;

create table if not exists folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default auth.user_id(),
  parent_id   uuid references folders(id) on delete cascade,
  name        text not null check (length(name) between 1 and 200),
  created_at  timestamptz not null default now()
);

create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default auth.user_id(),
  folder_id   uuid references folders(id) on delete set null,
  title       text not null default 'Documento sin título',
  content     jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
  text_plain  text not null default '',
  settings    jsonb not null default '{}',
  starred     boolean not null default false,
  trashed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists documents_owner_updated on documents (owner_id, updated_at desc);
create index if not exists documents_search on documents using gin ((title || ' ' || text_plain) gin_trgm_ops);

create table if not exists doc_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  owner_id     text not null default auth.user_id(),
  label        text,
  title        text not null,
  content      jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists doc_versions_doc on doc_versions (document_id, created_at desc);

create table if not exists comments (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  parent_id    uuid references comments(id) on delete cascade,
  author_id    text not null default auth.user_id(),
  author_name  text not null default '',
  quote        text not null default '',
  body         text not null check (length(body) between 1 and 5000),
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists comments_doc on comments (document_id, created_at);

create table if not exists building_blocks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default auth.user_id(),
  name        text not null,
  content     jsonb not null,
  created_at  timestamptz not null default now()
);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists documents_touch on documents;
create trigger documents_touch before update on documents
  for each row execute function touch_updated_at();

-- Permisos de la Data API.
grant usage on schema public to authenticated;
grant select, insert, update, delete on folders, documents, doc_versions, comments, building_blocks to authenticated;

alter table folders         enable row level security;
alter table documents       enable row level security;
alter table doc_versions    enable row level security;
alter table comments        enable row level security;
alter table building_blocks enable row level security;

drop policy if exists folders_owner on folders;
create policy folders_owner on folders for all to authenticated
  using (owner_id = auth.user_id()) with check (owner_id = auth.user_id());

drop policy if exists documents_owner on documents;
create policy documents_owner on documents for all to authenticated
  using (owner_id = auth.user_id()) with check (owner_id = auth.user_id());

drop policy if exists versions_owner on doc_versions;
create policy versions_owner on doc_versions for all to authenticated
  using (owner_id = auth.user_id())
  with check (owner_id = auth.user_id()
              and exists (select 1 from documents d where d.id = document_id and d.owner_id = auth.user_id()));

-- Comentarios: visibles y creables para el dueño del documento (la colaboración llega en la fase 4).
drop policy if exists comments_doc_owner on comments;
create policy comments_doc_owner on comments for all to authenticated
  using (exists (select 1 from documents d where d.id = document_id and d.owner_id = auth.user_id()))
  with check (author_id = auth.user_id()
              and exists (select 1 from documents d where d.id = document_id and d.owner_id = auth.user_id()));

drop policy if exists blocks_owner on building_blocks;
create policy blocks_owner on building_blocks for all to authenticated
  using (owner_id = auth.user_id()) with check (owner_id = auth.user_id());
