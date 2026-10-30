import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Read-only adapter for the incoming FIFA-style Supabase schema.
 *
 * This client is deliberately separate from the existing match/auth project:
 * the new schema does not contain match_boards, match_permissions, or the
 * other tables used by the tactical board. Do not replace the main client
 * with this one during the migration.
 *
 * Only SELECT-based helpers are exposed here. Do not add insert/update/upsert
 * operations while the upstream database is read-only.
 */

const url = import.meta.env.VITE_CATALOG_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_CATALOG_SUPABASE_ANON_KEY as string | undefined;

export const catalogSupabaseConfigured = Boolean(url && anonKey);

export const catalogSupabase: SupabaseClient | null = catalogSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

export type CatalogCharacter = {
  id: number;
  discord_id: number | string;
  guild_id: number | string;
  name: string;
  character_name: string;
  shot_acc: number;
  shot_power: number;
  passing: number;
  weak_foot: number;
  dribble: number;
  control: number;
  header: number;
  tackle: number;
  steal: number;
  strength: number;
  jump: number;
  stamina: number;
  speed: number;
  game_read: number;
  vision: number;
  points_train: number;
  points_practice: number;
  created_at: string;
};

export type CatalogTeam = {
  id: number;
  name: string;
  owner_id: number | string;
  vice_captain_id: number | string | null;
  budget: number | string;
  created_at: string;
};

export type CatalogTeamPlayer = {
  id: number;
  discord_id: number | string;
  team_id: number;
  joined_at: string;
};

export type CatalogPlayerCost = {
  id: number;
  discord_id: number | string;
  cost: number | string;
  updated_at: string;
};

export type CatalogCareerStats = {
  id: number;
  discord_id: number | string;
  goals: number;
  assists: number;
  saves: number;
  pushkas: number;
  forward_of_season: number;
  midfielder_of_season: number;
  defender_of_season: number;
  golden_glove: number;
  league_cup: number;
  mvp_season: number;
  mvp_match: number;
  goals_outside_box: number;
  penalties_scored: number;
  updated_at: string;
  created_at: string;
};

export type CatalogReadResult<T> = {
  data: T | null;
  error: Error | null;
};

function unavailable<T>(): CatalogReadResult<T> {
  return {
    data: null,
    error: new Error(
      'Каталог не настроен. Укажи VITE_CATALOG_SUPABASE_URL и VITE_CATALOG_SUPABASE_ANON_KEY.',
    ),
  };
}

/** Read characters; optional guildId limits the result to one Discord server. */
export async function listCatalogCharacters(
  guildId?: string | number,
): Promise<CatalogReadResult<CatalogCharacter[]>> {
  if (!catalogSupabase) return unavailable<CatalogCharacter[]>();

  let query = catalogSupabase
    .from('characters')
    .select('*')
    .order('character_name', { ascending: true });

  if (guildId !== undefined && String(guildId).trim()) {
    query = query.eq('guild_id', String(guildId));
  }

  const { data, error } = await query;
  return { data: data as CatalogCharacter[] | null, error };
}

export async function getCatalogCharacter(
  discordId: string | number,
): Promise<CatalogReadResult<CatalogCharacter>> {
  if (!catalogSupabase) return unavailable<CatalogCharacter>();

  const { data, error } = await catalogSupabase
    .from('characters')
    .select('*')
    .eq('discord_id', String(discordId))
    .maybeSingle();

  return { data: data as CatalogCharacter | null, error };
}

export async function listCatalogTeams(): Promise<CatalogReadResult<CatalogTeam[]>> {
  if (!catalogSupabase) return unavailable<CatalogTeam[]>();

  const { data, error } = await catalogSupabase
    .from('teams')
    .select('*')
    .order('name', { ascending: true });

  return { data: data as CatalogTeam[] | null, error };
}

export async function getCatalogTeamRoster(
  teamId: number,
): Promise<CatalogReadResult<CatalogTeamPlayer[]>> {
  if (!catalogSupabase) return unavailable<CatalogTeamPlayer[]>();

  const { data, error } = await catalogSupabase
    .from('team_players')
    .select('*')
    .eq('team_id', teamId)
    .order('joined_at', { ascending: true });

  return { data: data as CatalogTeamPlayer[] | null, error };
}

export async function getCatalogPlayerCost(
  discordId: string | number,
): Promise<CatalogReadResult<CatalogPlayerCost>> {
  if (!catalogSupabase) return unavailable<CatalogPlayerCost>();

  const { data, error } = await catalogSupabase
    .from('player_costs')
    .select('*')
    .eq('discord_id', String(discordId))
    .maybeSingle();

  return { data: data as CatalogPlayerCost | null, error };
}

export async function getCatalogCareerStats(
  discordId: string | number,
): Promise<CatalogReadResult<CatalogCareerStats>> {
  if (!catalogSupabase) return unavailable<CatalogCareerStats>();

  const { data, error } = await catalogSupabase
    .from('career_stats')
    .select('*')
    .eq('discord_id', String(discordId))
    .maybeSingle();

  return { data: data as CatalogCareerStats | null, error };
}
