-- Match-level Discord-linked identities, permissions, and character-card data.
-- Apply after 202610280002_secure_match_data.sql. Access is through match-data only.
create table if not exists public.match_participants (
  indicator_id text not null references public.match_boards(indicator_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  match_role text not null check (match_role in ('creator','gm','player','spectator')),
  team text check (team in ('blue','red') or team is null),
  discord_server_id text,
  discord_role_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (indicator_id, user_id)
);

create table if not exists public.match_permissions (
  indicator_id text primary key references public.match_boards(indicator_id) on delete cascade,
  settings jsonb not null default '{
    "playersMoveOwn": true,
    "captainBlue": false,
    "captainRed": false,
    "editArena": true,
    "manageParticipants": true,
    "editCharacterCards": false,
    "editMatchStats": true,
    "viewOwnTeamStats": true,
    "viewOpponentStats": false,
    "viewAllStats": false,
    "editScore": true,
    "editClock": true,
    "editPaths": true,
    "addPlayers": true
  }'::jsonb,
  blue_discord_server_id text,
  blue_discord_role_id text,
  red_discord_server_id text,
  red_discord_role_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.character_profiles (
  character_id text primary key,
  display_name text not null default '',
  current_offer text not null default '—',
  goals integer not null default 0 check (goals >= 0),
  matches integer not null default 0 check (matches >= 0),
  wins integer not null default 0 check (wins >= 0),
  draws integer not null default 0 check (draws >= 0),
  losses integer not null default 0 check (losses >= 0),
  extra_public_stats jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.match_participants enable row level security;
alter table public.match_permissions enable row level security;
alter table public.character_profiles enable row level security;

revoke all on public.match_participants from anon, authenticated;
revoke all on public.match_permissions from anon, authenticated;
revoke all on public.character_profiles from anon, authenticated;

grant select, insert, update, delete on public.match_participants to service_role;
grant select, insert, update, delete on public.match_permissions to service_role;
grant select, insert, update, delete on public.character_profiles to service_role;
