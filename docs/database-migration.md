# Database migration notes

## Current architecture

The app currently uses `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` for authentication and the tactical-match backend. The existing Edge Function expects match-related tables such as `match_boards`, `match_public_boards`, `match_permissions`, and `match_participants`.

The incoming FIFA-style schema is a separate catalog and currently contains:

- `characters`
- `teams`
- `team_players`
- `transfers`
- `player_costs`
- `offers`
- `career_stats`

It does not define the tactical-match tables above. Do not point the primary Supabase client at the catalog project until match persistence and authentication are separately addressed.

## Read-only adapter

`src/lib/catalog.ts` provides a separate optional client controlled by:

- `VITE_CATALOG_SUPABASE_URL`
- `VITE_CATALOG_SUPABASE_ANON_KEY`

It currently exposes read-only helpers for characters, teams, team rosters, player costs, and career stats. It intentionally contains no insert, update, upsert, or delete methods.

## Verified access state

The catalog project has Row Level Security enabled on all seven tables. A read-only inspection of `pg_policies` found **no policies in the public schema** at the time of review. The tables are also currently empty.

This means the frontend should not yet depend on catalog reads: anonymous/publishable keys do not bypass RLS, and queries will not return data until the database owner defines the intended SELECT policies or provides suitable read-only views. Do not disable RLS just to make the adapter work.

## Performance follow-up

The Supabase performance advisor reported that `offers.buyer_team_id` and `offers.seller_team_id` foreign keys have no covering indexes. The optional SQL migration `supabase/migrations/20261031000100_catalog_offer_fk_indexes.sql` adds indexes for those two columns using `CREATE INDEX IF NOT EXISTS`.

This migration is intentionally not auto-applied. Review and apply it only to the separate catalog project after confirming that its `public.offers` table matches the expected schema. Do not run it against the existing match/auth project just because it is the current production project.

## Current limitations / next steps

1. Add and test explicit read policies with the database owner before pointing any UI at the catalog.
2. Connect the adapter to the UI in a controlled feature-by-feature way, starting with profile/character display after read access is confirmed.
3. Decide how Discord OAuth identity maps to the catalog's `characters.discord_id`; do not assume Supabase auth user UUID equals a Discord ID.
4. Determine where match boards, participants, permissions, and live training state will live during and after migration.
5. Keep all writes disabled for the catalog while the external database is read-only.
