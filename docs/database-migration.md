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

The new project has Row Level Security enabled. The read helpers will only work once the database owner has configured SELECT policies (or suitable read-only views) for the intended roles. A configured URL/key does not bypass RLS.

## Current limitations / next steps

1. Connect the adapter to the UI in a controlled feature-by-feature way, starting with profile/character display.
2. Decide how Discord OAuth identity maps to the catalog's `characters.discord_id`; do not assume Supabase auth user UUID equals a Discord ID.
3. Determine where match boards, participants, permissions, and live training state will live during and after migration.
4. Add and test explicit read policies before pointing any production UI at the external database.
5. Keep all writes disabled for the catalog while the external database is read-only.
