# Blue Lock RP — Discord database manager

Python discord.py admin bot for the existing Supabase catalog. It does not implement match gameplay.

## Setup

1. Use Python 3.11+ (recommended 3.12).
2. Install: python -m pip install -r requirements.txt
3. Configure variables from .env.example on the host.
4. Set DISCORD_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and at least one DB_ADMIN_USER_IDS or DB_ADMIN_ROLE_IDS value.
5. Invite with bot and applications.commands scopes. Message content intent is not needed.
6. Run: python main.py

Set DISCORD_GUILD_ID during development to sync commands quickly to one server. Otherwise commands are synced globally and may take a while to appear.

## Features

- /db interactive management panel
- /players search by character name, Discord ID, or row ID
- /team list clubs
- /transfers show recent transfer records
- Create and edit characters, create clubs, set player costs, inspect stats, and delete characters with confirmation

The bot uses the same Supabase project as the site. The service-role key is server-side only and must never be put in frontend variables or committed. Keep the bot on a trusted host and restrict access to its environment.

The schema expected by this bot is defined in supabase/migrations/20261031000200_consolidate_catalog_into_blsite.sql. Existing match tables are not modified.
