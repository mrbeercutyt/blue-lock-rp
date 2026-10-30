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

It exposes read-only helpers for approved character/team display data and the signed-in user's own character/career stats. The browser calls the existing project's `catalog-read` Edge Function; it does not connect directly to the catalog project. The adapter intentionally contains no insert, update, upsert, or delete methods. Player costs, offers, transfers, and raw rosters are not exposed. The Edge Function is staged in the repository but is not deployed until the required server-side secrets are configured.

## Verified access state

The catalog project has Row Level Security enabled on all seven tables. A read-only inspection of `pg_policies` found **no policies in the public schema** at the time of review. The tables were also empty during the review.

This means the frontend should not yet depend on catalog reads: anonymous/publishable keys do not bypass RLS, and queries will not return data until the database owner defines the intended SELECT policies or provides suitable read-only views. Do not disable RLS just to make the adapter work.

The catalog's Supabase Auth project is separate from the app's existing auth project. A session from the existing project is not automatically a valid session in the catalog project. Therefore, simply adding `TO authenticated` policies to the catalog would not make the current app's signed-in users authorized there. The integration needs a verified identity/authorization bridge (for example, a server-side proxy using the catalog service key stored only as a server secret) before private catalog data can be exposed.

## Performance follow-up

The Supabase performance advisor reported that `offers.buyer_team_id` and `offers.seller_team_id` foreign keys had no covering indexes. Both indexes have now been applied to the separate catalog project using the idempotent migration `catalog_offer_fk_indexes` (version `20261030210925`). The checked-in migration `supabase/migrations/20261031000100_catalog_offer_fk_indexes.sql` documents the same safe `CREATE INDEX IF NOT EXISTS` statements.

These indexes were applied only to the catalog project, not to the existing production match/auth project.

## Current limitations / next steps

1. Configure `CATALOG_SUPABASE_URL` and `CATALOG_SUPABASE_SERVICE_ROLE_KEY` as secrets in the existing match/auth Supabase project, then deploy `catalog-read` with JWT verification enabled.
2. Test the API's signed-out, missing-Discord-identity, own-profile, and career-stat paths before exposing it in UI.
3. Decide which additional catalog fields are visible to all signed-in users versus private, especially budgets, player costs, offers, and transfers.
4. Connect the adapter to UI components only after the server function is deployed and tested.
5. Determine where match boards, participants, permissions, and live training state will live during and after migration.
6. Keep all catalog writes disabled while the external database is read-only.
