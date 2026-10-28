-- Secure data model for shared tactical matches.
-- Apply after 202610280001_initial_schema.sql.
create table if not exists public.match_members (
  indicator_id text not null references public.match_boards(indicator_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team text not null check (team in ('blue','red','gm')),
  created_at timestamptz not null default now(),
  primary key (indicator_id, user_id)
);

create table if not exists public.match_public_boards (
  indicator_id text primary key references public.match_boards(indicator_id) on delete cascade,
  board jsonb not null default '{"players":[],"ball":{"x":50,"y":62},"paths":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One encrypted record per player. Plaintext stats must never be placed in the public board.
create table if not exists public.match_player_secrets (
  indicator_id text not null references public.match_boards(indicator_id) on delete cascade,
  player_id integer not null,
  team text not null check (team in ('blue','red')),
  ciphertext jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (indicator_id, player_id)
);

alter table public.match_members enable row level security;
alter table public.match_public_boards enable row level security;
alter table public.match_player_secrets enable row level security;

revoke all on public.match_members from anon, authenticated;
revoke all on public.match_public_boards from anon, authenticated;
revoke all on public.match_player_secrets from anon, authenticated;

-- Clients access these tables only through the authenticated Edge Function.
-- Do not add direct SELECT/INSERT/UPDATE grants to anon or authenticated.
grant select, insert, update, delete on public.match_members to service_role;
grant select, insert, update, delete on public.match_public_boards to service_role;
grant select, insert, update, delete on public.match_player_secrets to service_role;

-- Keep legacy board rows inaccessible to non-owners; the Edge Function uses server-side
-- service credentials after verifying the caller and applying membership rules.
