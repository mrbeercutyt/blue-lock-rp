# Catalog access model

## Architecture

The character/team catalog and tactical-match tables now live in the same owned Supabase project, `blsite`. The additive migration `20261031000200_consolidate_catalog_into_blsite.sql` creates the seven catalog tables without changing existing match/auth tables.

The browser calls `supabase/functions/catalog-read/index.ts` through the existing authenticated Supabase client. The function validates the session against the same project, derives the Discord ID only from provider-issued Discord identity data (not editable user metadata), and uses the server-side `SUPABASE_SERVICE_ROLE_KEY` to read explicitly allowlisted fields. The service-role key is never sent to the browser.

## Database safety

Row Level Security remains enabled on all seven catalog tables, with no broad direct browser policies. The website should not query these tables directly; all catalog access goes through the authenticated Edge Function until a reviewed RLS policy model is in place.

The migration is additive and does not delete or modify existing match records. The old separate catalog project was empty during inspection, so there was no catalog data to copy. Keep that project available until the consolidated schema and application behavior are verified.

## API visibility

All API actions require a valid signed-in session and a provider-issued Discord identity. The API has no write actions.

- `list_characters`: returns approved display names and football stats for the caller's Discord guild, without Discord IDs, guild IDs, or training/practice points.
- `my_character`: returns the caller's own character, including their guild ID and training/practice points.
- `list_teams`: returns team ID, display name, and creation time only; budgets, owner IDs, and vice-captain IDs are excluded.
- `my_career_stats`: returns career stats only for the caller's verified Discord ID.
- Player costs, offers, transfers, budgets, and raw rosters are not exposed yet.

## Discord bot

The bot should connect to this same Supabase project using a server-side service-role key stored in the bot host's secret/environment configuration. Its commands must authorize each operation before reading or mutating records. The Discord bot token and Supabase service-role key must never be committed to Git or exposed to the frontend.

## Deployment and verification

1. Apply the catalog migration to `blsite` (completed for the current project).
2. Deploy `catalog-read` to the same project with platform JWT verification enabled.
3. Verify signed-out requests return 401 and sessions without a provider-issued Discord identity return 403.
4. Verify private character/career queries only return the current user's record.
5. Verify the character directory is guild-scoped and no response includes budgets, costs, offers, transfers, or private identifiers.
6. Connect the adapter to visible UI components only after those checks pass.
7. Build the Discord bot against this schema and test it with a development token before running it on the live server.
