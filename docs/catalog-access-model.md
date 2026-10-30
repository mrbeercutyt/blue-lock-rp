# Catalog access model

## Current state

The incoming catalog project has RLS enabled on all seven tables but currently has no policies. The current application uses Supabase Auth with Discord OAuth. The existing match project has an `authenticated` SELECT policy for `match_boards`; that does not automatically define access for the separate catalog project.

No policies are applied by this document. It records a conservative target for review before the catalog is connected to the UI.

## Proposed baseline

- Keep RLS enabled on every catalog table.
- Do not grant anonymous access to raw catalog tables by default.
- Require a valid Supabase session (`authenticated`) for personal character profiles, rosters, career statistics, costs, transfers, and offers.
- If unauthenticated visitors need a public directory, expose only explicitly approved public fields through a dedicated view (for example, team display name and public identifier). Do not expose owner/vice-captain IDs, budgets, transfer details, offers, or player costs through a public view unless the project owner explicitly approves them.
- Never use the service-role key in browser code. The frontend may use only the publishable/anon key and authenticated user session.
- Keep catalog writes disabled in the frontend; read access does not imply permission to change records.

## Identity and row scope

The existing app authenticates through Discord OAuth, but the catalog stores Discord IDs separately from Supabase Auth user UUIDs. Do not compare `auth.uid()` directly to `characters.discord_id`, and do not assume a user metadata field is trustworthy without validating its source. Before adding per-user row policies, establish a verified identity mapping or a server-side authorization mechanism.

A broad `TO authenticated USING (true)` policy would allow every signed-in user to read every row in that table. Do not use that policy for personal or commercially sensitive tables unless that exact visibility is intended. Prefer public views for safe public fields and narrowly scoped policies for private records.

## Required review before activation

1. Confirm which columns are public and which require sign-in.
2. Confirm whether all signed-in users may view all player records, or only their own / their team’s records.
3. Verify Discord identity mapping and team membership rules.
4. Add explicit policies or safe views in a separate SQL migration, then test anonymous and authenticated behavior with representative accounts.
5. Re-run Supabase Security Advisor and the frontend build before connecting the catalog UI.
