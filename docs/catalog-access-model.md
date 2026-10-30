# Catalog access model

## Current state

The incoming catalog project has RLS enabled on all seven tables but has no direct table policies. The current application authenticates users through Discord OAuth in the existing match/auth Supabase project. The catalog is a separate project, so its `authenticated` role does not automatically receive the current project's session.

The new `supabase/functions/catalog-read/index.ts` is a server-side, read-only proxy. It validates the incoming session against the existing auth project, extracts a Discord ID only from the provider-issued Discord identity payload (not editable user metadata), then queries the catalog with a server-side key. The frontend adapter calls this function through the existing authenticated client and no longer needs catalog URL/key variables in the browser.

The function is staged in the repository but is **not deployed**. It will return 503 until these server-side secrets are configured in the existing match/auth Supabase project:

- `CATALOG_SUPABASE_URL` — URL of the separate catalog project.
- `CATALOG_SUPABASE_SERVICE_ROLE_KEY` — service-role key for that catalog project; store only as a Supabase Edge Function secret.

Do not put either value in `VITE_*`, commit it to Git, or send it to the browser. Deploy the function only after the secrets are set. No catalog RLS policies have been disabled or broadened.

## API visibility

All API actions require a valid signed-in session and a verified provider-issued Discord identity. The API has no write actions.

- `list_characters`: returns a limited set of display names and football stats, not Discord IDs, guild IDs, or training/practice points.
- `my_character`: returns the current user's character based on the verified Discord ID, including that character's guild ID and points.
- `list_teams`: returns team ID, display name, and creation time only; budgets, owner IDs, and vice-captain IDs are excluded.
- `my_career_stats`: returns career stats only for the current signed-in user's verified Discord ID.
- Player costs, offers, transfers, and raw rosters are not exposed by the proxy until their visibility rules are explicitly approved.

The character directory and team names are visible only to signed-in users through this proxy; they are not publicly accessible without authentication.

## Security constraints

- Keep RLS enabled on all catalog tables.
- Never use the catalog service-role key in browser code.
- Do not compare `auth.uid()` directly with `characters.discord_id`.
- Do not trust caller-supplied Discord IDs for personal records; the server derives the ID from the verified OAuth identity.
- Do not add broad table policies just to make direct browser queries work.
- Keep all catalog writes disabled while the source catalog is read-only.

## Deployment checklist

1. Add the two secrets above to the existing match/auth Supabase project's Edge Function secrets.
2. Deploy `catalog-read` with JWT verification enabled.
3. Verify a signed-out request returns 401 and a signed-in request with no provider-issued Discord identity returns 403.
4. Verify the character and career-stat actions can only retrieve the caller's own private record.
5. Verify the returned team/character fields do not include budgets, offers, costs, or private IDs.
6. Re-run the frontend build and Supabase Security Advisor before connecting the adapter to visible UI components.
7. Determine where match boards, participants, permissions, and live training state will live during and after the migration.
