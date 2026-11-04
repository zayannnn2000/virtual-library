-- Virtual Library — one-time setup. Paste into Supabase → SQL Editor → Run.
-- Safe to run again.

-- 1. One table holds books, annotations and settings as JSON, private per user.
create table if not exists public.records (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text    not null check (kind in ('book', 'annotation', 'setting')),
  id         text    not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,          -- client edit time (ms), used for last-edit-wins
  seq        bigint,                    -- server change counter, used to pull only what changed
  primary key (user_id, kind, id)
);

create sequence if not exists public.records_seq;

create or replace function public.records_bump_seq()
returns trigger language plpgsql as $$
begin
  new.seq := nextval('public.records_seq');
  return new;
end $$;

drop trigger if exists records_bump_seq on public.records;
create trigger records_bump_seq
  before insert or update on public.records
  for each row execute function public.records_bump_seq();

create index if not exists records_user_seq on public.records (user_id, seq);

alter table public.records enable row level security;

drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2. Private storage for ebook files and uploaded covers: <user id>/<book id>/file|cover
insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', false, 209715200)
on conflict (id) do nothing;

drop policy if exists "own library files" on storage.objects;
create policy "own library files" on storage.objects
  for all to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
