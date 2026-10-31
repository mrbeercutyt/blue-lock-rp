import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function discordIdFromUser(user: any): string | null {
  const identity = user?.identities?.find((item: any) => item.provider === 'discord');
  // Only accept provider-issued identity data; never trust editable user metadata.
  const identityData = identity?.identity_data ?? {};
  const candidates = [identityData.sub, identityData.user_id, identityData.provider_id, identityData.id];
  const value = candidates.find((candidate) => /^\d{17,20}$/.test(String(candidate ?? '')));
  return value === undefined ? null : String(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server configuration is incomplete' }, 503);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Sign-in required' }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

  const discordId = discordIdFromUser(authData.user);
  if (!discordId) return json({ error: 'Discord identity could not be verified' }, 403);

  // Service role is only used server-side. All returned fields and records are
  // explicitly constrained below; the browser never receives this key.
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const action = body?.action;

  if (action === 'list_characters') {
    const { data: ownCharacter, error: ownError } = await db.from('characters')
      .select('guild_id').eq('discord_id', discordId).maybeSingle();
    if (ownError) return json({ error: 'Could not verify character server' }, 500);
    if (ownCharacter?.guild_id == null) return json({ characters: [] });
    const { data, error } = await db.from('characters')
      .select('id,name,character_name,shot_acc,shot_power,passing,weak_foot,dribble,control,header,tackle,steal,strength,jump,stamina,speed,game_read,vision')
      .eq('guild_id', ownCharacter.guild_id)
      .order('character_name', { ascending: true }).limit(200);
    if (error) return json({ error: 'Could not load character directory' }, 500);
    return json({ characters: data ?? [] });
  }

  if (action === 'my_character') {
    const { data, error } = await db.from('characters')
      .select('id,name,character_name,guild_id,shot_acc,shot_power,passing,weak_foot,dribble,control,header,tackle,steal,strength,jump,stamina,speed,game_read,vision,points_train,points_practice,created_at')
      .eq('discord_id', discordId).maybeSingle();
    if (error) return json({ error: 'Could not load your character' }, 500);
    return json({ character: data ?? null });
  }

  if (action === 'list_teams') {
    const { data, error } = await db.from('teams')
      .select('id,name,created_at').order('name', { ascending: true }).limit(100);
    if (error) return json({ error: 'Could not load teams' }, 500);
    return json({ teams: data ?? [] });
  }

  if (action === 'my_career_stats') {
    const { data, error } = await db.from('career_stats')
      .select('goals,assists,saves,pushkas,forward_of_season,midfielder_of_season,defender_of_season,golden_glove,league_cup,mvp_season,mvp_match,goals_outside_box,penalties_scored,updated_at,created_at')
      .eq('discord_id', discordId).maybeSingle();
    if (error) return json({ error: 'Could not load your career statistics' }, 500);
    return json({ stats: data ?? null });
  }

  // No writes, costs, offers, transfers, budgets, or raw rosters are exposed yet.
  return json({ error: 'Unsupported action' }, 400);
});
