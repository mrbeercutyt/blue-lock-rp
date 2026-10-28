-- Blue Lock RP: shared match boards and profile linking
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  discord_id text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_boards (
  indicator_id text primary key,
  name text not null default 'Матч',
  board jsonb not null default '{"players":[],"ball":{"x":50,"y":62},"paths":[]}'::jsonb,
  owner_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.match_boards enable row level security;

-- A signed-in user may read profiles; only their own profile can be changed.
create policy "Authenticated users can read profiles" on public.profiles
  for select to authenticated using (true);
create policy "Users can insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Initial safe default: only board owner can read/write it. Shared team access should
-- be granted through membership tables after Discord guild/role validation is deployed.
create policy "Owners can read match boards" on public.match_boards
  for select to authenticated using (auth.uid() = owner_id);
create policy "Owners can create match boards" on public.match_boards
  for insert to authenticated with check (auth.uid() = owner_id);
create policy "Owners can update match boards" on public.match_boards
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Owners can delete match boards" on public.match_boards
  for delete to authenticated using (auth.uid() = owner_id);

-- Enable realtime updates for board rows.
do $$ begin
  alter publication supabase_realtime add table public.match_boards;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, discord_id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'provider_id',
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    discord_id = coalesce(excluded.discord_id, public.profiles.discord_id),
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_user_meta_data on auth.users
  for each row execute procedure public.handle_new_user();
