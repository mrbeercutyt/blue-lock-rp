-- Link each authenticated match participant to a character/player on the tactical board.
alter table public.match_participants
  add column if not exists character_id text;
