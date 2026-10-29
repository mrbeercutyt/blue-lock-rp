-- Shared bookmarks for match boards. A user appears in the match roster while the board is bookmarked.
create table if not exists public.match_bookmarks (
  indicator_id text not null references public.match_boards(indicator_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (indicator_id, user_id)
);
alter table public.match_bookmarks enable row level security;
revoke all on public.match_bookmarks from anon, authenticated;
grant select, insert, delete on public.match_bookmarks to service_role;
