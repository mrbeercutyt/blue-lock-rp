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

It currently exposes read-only helpers for characters, teams, team rosters, player costs, and career stats. It intentionally contains no insert, update, upsert, or delete methods. The adapter is not yet connected to UI components.

## Verified access state

The catalog project has Row Level Security enabled on all seven tables. A read-only inspection of `pg_policies` found **no policies in the public schema** at the time of review. The tables were also empty during the review.

This means the frontend should not yet depend on catalog reads: anonymous/publishable keys do not bypass RLS, and queries will not return data until the database owner defines the intended SELECT policies or provides suitable read-only views. Do not disable RLS just to make the adapter work.

The catalog's Supabase Auth project is separate from the app's existing auth project. A session from the existing project is not automatically a valid session in the catalog project. Therefore, simply adding `TO authenticated` policies to the catalog would not make the current app's signed-in users authorized there. The integration needs a verified identity/authorization bridge (for example, a server-side proxy using the catalog service key stored only as a server secret) before private catalog data can be exposed.

## Performance follow-up

The Supabase performance advisor reported that `offers.buyer_team_id` and `offers.seller_team_id` foreign keys had no covering indexes. Both indexes have now been applied to the separate catalog project using the idempotent migration `catalog_offer_fk_indexes` (version `20261030210925`). The checked-in migration `supabase/migrations/20261031000100_catalog_offer_fk_indexes.sql` documents the same safe `CREATE INDEX IF NOT EXISTS` statements.

These indexes were applied only to the catalog project, not to the existing production match/auth project.

## Current limitations / next steps

1. Establish the catalog authorization bridge and verify Discord identity mapping; do not assume Supabase auth user UUID equals a Discord ID.
2. Decide which catalog fields are public and which are private, especially budgets, player costs, offers, and transfers.
3. Add and test explicit read policies/views after the identity and visibility rules are defined.
4. Connect the adapter to the UI in a controlled feature-by-feature way, starting with character display after read access is confirmed.
5. Determine where match boards, participants, permissions, and live training state will live during and after migration.
6. Keep all catalog writes disabled while the external database is read-only.
