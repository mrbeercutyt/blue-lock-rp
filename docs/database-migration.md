# Database migration notes

## Current architecture

The owned Supabase project `blsite` is the single database for the website, tactical match board, and Blue Lock RP catalog. It already contains the match tables (`match_boards`, `match_public_boards`, `match_permissions`, `match_participants`, and related tables).

The additive migration `supabase/migrations/20261031000200_consolidate_catalog_into_blsite.sql` adds the catalog tables to that same project:

- `characters`
- `teams`
- `team_players`
- `transfers`
- `player_costs`
- `offers`
- `career_stats`

The migration has been applied to `blsite`. It does not drop or rewrite existing match/auth tables. Catalog tables keep RLS enabled and have no broad browser policies.

## Catalog API

`src/lib/catalog.ts` calls the authenticated `catalog-read` Edge Function using the existing Supabase client. The function validates the session in the same project, verifies the Discord identity from provider-issued identity data, and performs explicit allowlisted reads with the server-side service-role key. The browser never receives the service-role key.

The API currently supports read-only actions for guild-scoped character listing, the caller's own character, basic team names, and the caller's own career stats. It does not expose costs, offers, transfers, budgets, raw rosters, or write actions.

## Discord bot

The Discord bot should use the same `blsite` project. Its Supabase service-role key and Discord bot token must exist only in the bot host's secret/environment configuration. All commands that mutate records must validate the invoking Discord user, server, and required roles before writing. The website and bot should share the same schema and rules rather than keeping independent copies of player/team data.

## Remaining work

1. Deploy `catalog-read` to `blsite` with JWT verification enabled and test signed-out, invalid-session, missing-Discord-identity, and own-record paths.
2. Connect the catalog adapter to visible website UI after those tests pass.
3. Integrate the Discord bot with the same schema and replace its SQLite data path only after its existing commands and data needs have been reviewed.
4. Define explicit authorization rules for club budgets, costs, offers, transfers, and team rosters before exposing them.
5. Keep match persistence and the existing match/auth tables intact while adding future features.
