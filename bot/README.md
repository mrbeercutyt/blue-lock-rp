# Blue Lock RP — Discord database manager

Python 3.12+ / discord.py manager for the catalog in the existing `blsite` Supabase project. It manages database records; it does not implement match gameplay.

## Setup

1. Use Python 3.12 (recommended).
2. Install dependencies: `python -m pip install -r requirements.txt`.
3. Configure the environment variables shown in `.env.example` on the host.
4. Set `DISCORD_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and at least one `DB_ADMIN_USER_IDS` or `DB_ADMIN_ROLE_IDS` value.
5. Invite the bot using the `bot` and `applications.commands` scopes. Message Content Intent is not required.
6. Run from this directory: `python main.py`.

Set `DISCORD_GUILD_ID` while developing to sync commands quickly to one server. Without it, commands sync globally and Discord may take a while to display them.

## Commands

- `/db` — interactive panel for players, clubs, player costs, transfers, and database counts.
- `/players query:` — search by character name, Discord ID, or row ID.
- `/team` — list clubs and open the create-club form.
- `/team-budget` — set a club's budget through a modal.
- `/roster team_id:` — list the Discord IDs currently registered in a club.
- `/roster-add team_id: discord_id:` — add an existing registered character to a club.
- `/roster-remove discord_id:` — remove a player from a club.
- `/stat-set` — edit any one of the character's football attributes.
- `/points-set` — edit training or practice points.
- `/career discord_id:` — view career statistics.
- `/career-set` — update one career statistic or award.
- `/transfers` — view recent transfer history.

Character creation/editing, team changes, cost/stat updates, and destructive actions are restricted to configured admin user IDs and/or role IDs. Deleting a character requires confirmation.

## Security and deployment

- Use a trusted host and keep the Discord token and Supabase service-role key in environment variables or the host's secret manager. Never commit real secrets or expose the service-role key in frontend variables.
- Give database management access only to trusted Discord user IDs or roles.
- The bot uses the same Supabase project as the website. Existing match tables are not modified by the bot.
- The catalog schema expected by this bot is documented in `supabase/migrations/20261031000200_consolidate_catalog_into_blsite.sql`.
- Do not run multiple copies with the same token unless you intentionally configure sharding or duplicate workers.

## Current launch status

The source and CI syntax check are in GitHub, but the bot is not running yet. It still needs valid host-side environment variables and a persistent host process. Configure the variables on the chosen host before starting it.
