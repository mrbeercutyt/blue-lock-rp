import { supabase, supabaseConfigured } from './supabase';

/**
 * Browser adapter for the read-only catalog API.
 *
 * All requests go through the existing authenticated Supabase project and its
 * catalog-read Edge Function. Never query the catalog project directly from
 * the browser: its service key must remain server-side and private fields must
 * be filtered by the API.
 */

export const catalogSupabaseConfigured = supabaseConfigured;

export type CatalogCharacter = {
  id: number;
  name: string;
  character_name: string;
  guild_id?: number | string;
  shot_acc?: number;
  shot_power?: number;
  passing?: number;
  weak_foot?: number;
  dribble?: number;
  control?: number;
  header?: number;
  tackle?: number;
  steal?: number;
  strength?: number;
  jump?: number;
  stamina?: number;
  speed?: number;
  game_read?: number;
  vision?: number;
  points_train?: number;
  points_practice?: number;
  created_at?: string;
};

export type CatalogTeam = {
  id: number;
  name: string;
  created_at?: string;
};

export type CatalogCareerStats = {
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
  updated_at?: string;
  created_at?: string;
};

export type CatalogReadResult<T> = {
  data: T | null;
  error: Error | null;
};

async function invokeCatalog<T>(action: string): Promise<CatalogReadResult<T>> {
  if (!supabase) {
    return { data: null, error: new Error('Сначала настрой переменные основного Supabase-проекта.') };
  }
  const { data, error } = await supabase.functions.invoke('catalog-read', { body: { action } });
  if (error) return { data: null, error };
  if (data?.error) return { data: null, error: new Error(String(data.error)) };
  return { data: data as T, error: null };
}

/** Requires a valid Discord-authenticated session; returns only approved public fields. */
export async function listCatalogCharacters(
  _guildId?: string | number,
): Promise<CatalogReadResult<CatalogCharacter[]>> {
  const result = await invokeCatalog<{ characters: CatalogCharacter[] }>('list_characters');
  return { data: result.data?.characters ?? null, error: result.error };
}

/** The server derives the Discord ID from the verified session; caller IDs are never trusted. */
export async function getCatalogCharacter(
  _discordId?: string | number,
): Promise<CatalogReadResult<CatalogCharacter>> {
  const result = await invokeCatalog<{ character: CatalogCharacter | null }>('my_character');
  return { data: result.data?.character ?? null, error: result.error };
}

export async function listCatalogTeams(): Promise<CatalogReadResult<CatalogTeam[]>> {
  const result = await invokeCatalog<{ teams: CatalogTeam[] }>('list_teams');
  return { data: result.data?.teams ?? null, error: result.error };
}

export async function getCatalogCareerStats(
  _discordId?: string | number,
): Promise<CatalogReadResult<CatalogCareerStats>> {
  const result = await invokeCatalog<{ stats: CatalogCareerStats | null }>('my_career_stats');
  return { data: result.data?.stats ?? null, error: result.error };
}

/**
 * Costs, transfers, offers and raw rosters are deliberately not exposed until
 * an explicit visibility policy and authorization rule have been approved.
 */
export async function getCatalogPlayerCost(
  _discordId?: string | number,
): Promise<CatalogReadResult<never>> {
  return {
    data: null,
    error: new Error('Стоимость игрока пока недоступна через публичный каталог API.'),
  };
}

export async function getCatalogTeamRoster(
  _teamId: number,
): Promise<CatalogReadResult<never>> {
  return {
    data: null,
    error: new Error('Составы команд пока не открыты до настройки правил доступа.'),
  };
}
