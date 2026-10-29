import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function sanitizeArena(value: any) {
  const allowedThemes = ['classic', 'night', 'blue', 'sand', 'stadium'];
  const width = Number(value?.fieldWidth);
  const height = Number(value?.fieldHeight);
  return {
    theme: allowedThemes.includes(value?.theme) ? value.theme : 'classic',
    fieldWidth: Number.isFinite(width) && width >= 20 && width <= 200 ? width : 68,
    fieldHeight: Number.isFinite(height) && height >= 20 && height <= 200 ? height : 105,
  };
}

const DISCORD_PERMISSION_GUILD_ID = '1384014347654926468';
const DISCORD_CHARACTER_EDITOR_ROLE_IDS = new Set([
  '1424085219811786893',
  '1424085327202619523',
]);

async function hasConfiguredDiscordEditorRole(admin: ReturnType<typeof createClient>, userId: string) {
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!botToken) return false;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  const identity = data.user.identities?.find((item: any) => item.provider === 'discord');
  const identityData = (identity as any)?.identity_data ?? {};
  const metadata = data.user.user_metadata ?? {};
  const candidates = [
    identityData.sub, identityData.user_id, identityData.provider_id, identityData.id,
    metadata.sub, metadata.provider_id, metadata.user_id, metadata.discord_id,
  ];
  const discordUserId = String(candidates.find((value) => /^\d{17,20}$/.test(String(value ?? ''))) ?? '');
  if (!discordUserId) return false;
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_PERMISSION_GUILD_ID}/members/${discordUserId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!response.ok) return false;
    const member = await response.json();
    return Array.isArray(member.roles) && member.roles.some((role: string) => DISCORD_CHARACTER_EDITOR_ROLE_IDS.has(role));
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
async function encryptionKey() {
  const raw = Deno.env.get('MATCH_DATA_ENCRYPTION_KEY');
  if (!raw) throw new Error('MATCH_DATA_ENCRYPTION_KEY is not configured');
  const bytes = base64ToBytes(raw);
  if (bytes.length !== 32) throw new Error('MATCH_DATA_ENCRYPTION_KEY must be base64 for exactly 32 random bytes');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encryptJson(value: unknown) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { v: 1, alg: 'A256GCM', iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
}
async function decryptJson(value: {v:number;alg:string;iv:string;data:string}) {
  if (value?.v !== 1 || value?.alg !== 'A256GCM') throw new Error('Unsupported encrypted payload');
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(value.iv) },
    key,
    base64ToBytes(value.data),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Server configuration is incomplete' }, 500);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const authHeader = req.headers.get('Authorization');
  let userId: string | null = null;
  if (authHeader) {
    const authClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.getUser();
    if (!error && data.user) userId = data.user.id;
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const action = body?.action;
  const indicatorId = typeof body?.indicatorId === 'string' ? body.indicatorId.trim() : '';
  if (!indicatorId || indicatorId.length > 128) return json({ error: 'indicatorId is required' }, 400);

  const { data: match, error: matchError } = await admin.from('match_boards')
    .select('indicator_id,owner_id,name').eq('indicator_id', indicatorId).maybeSingle();
  if (matchError) return json({ error: 'Database error' }, 500);

  if (action === 'create_match') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    if (match) return json({ error: 'Match already exists' }, 409);
    const incoming = body?.board;
    if (!incoming || !Array.isArray(incoming.players) || !incoming.ball || !Array.isArray(incoming.paths)) return json({ error: 'Invalid board payload' }, 400);
    const safe = {
      players: incoming.players.map((p: any) => ({ id:p.id, name:p.name, number:p.number, team:p.team, x:p.x, y:p.y, role:p.role })),
      ball: incoming.ball,
      paths: incoming.paths,
      arena: sanitizeArena(incoming.arena),
    };
    const { error: createError } = await admin.from('match_boards').insert({
      indicator_id: indicatorId,
      name: typeof body.name === 'string' ? body.name.slice(0,120) : 'Матч',
      board: safe,
      owner_id: userId,
    });
    if (createError) return json({ error: 'Could not create match' }, 500);
    const { error: publicError } = await admin.from('match_public_boards').upsert({
      indicator_id: indicatorId, board: safe, updated_at: new Date().toISOString(),
    }, { onConflict: 'indicator_id' });
    if (publicError) return json({ error: 'Could not initialize public board' }, 500);
    const { error: participantError } = await admin.from('match_participants').upsert({
      indicator_id: indicatorId, user_id: userId, match_role: 'creator', team: null,
    }, { onConflict: 'indicator_id,user_id' });
    if (participantError) return json({ error: 'Match created but creator membership could not be initialized' }, 500);
    const { error: permissionsError } = await admin.from('match_permissions').upsert({
      indicator_id: indicatorId,
    }, { onConflict: 'indicator_id' });
    if (permissionsError) return json({ error: 'Match created but permissions could not be initialized' }, 500);
    return json({ ok: true, board: safe });
  }

  if (action === 'set_bookmark') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    if (!match) return json({ error: 'Match not found' }, 404);
    const bookmarked = body?.bookmarked === true;
    if (bookmarked) {
      const { error } = await admin.from('match_bookmarks').upsert({ indicator_id: indicatorId, user_id: userId }, { onConflict: 'indicator_id,user_id' });
      if (error) return json({ error: 'Could not bookmark this match' }, 500);
    } else {
      const { error } = await admin.from('match_bookmarks').delete().eq('indicator_id', indicatorId).eq('user_id', userId);
      if (error) return json({ error: 'Could not remove match bookmark' }, 500);
    }
    return json({ ok: true, bookmarked });
  }

  if (action === 'list_bookmarks') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    if (!match) return json({ error: 'Match not found' }, 404);
    const { data: mine, error: mineError } = await admin.from('match_bookmarks').select('user_id')
      .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
    if (mineError) return json({ error: 'Could not load bookmark status' }, 500);
    const { data, error } = await admin.from('match_bookmarks').select('user_id,created_at')
      .eq('indicator_id', indicatorId).order('created_at');
    if (error) return json({ error: 'Could not load bookmarked users' }, 500);
    const users = await Promise.all((data ?? []).map(async (row: any) => {
      const { data: authData } = await admin.auth.admin.getUserById(row.user_id);
      const metadata = authData?.user?.user_metadata ?? {};
      return {
        user_id: row.user_id,
        display_name: metadata.full_name ?? metadata.name ?? metadata.user_name ?? metadata.preferred_username ?? row.user_id,
        avatar_url: metadata.avatar_url ?? metadata.picture ?? null,
        created_at: row.created_at,
      };
    }));
    return json({ bookmarked: !!mine, users });
  }

  if (action === 'get_match_access') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    if (!match) return json({ error: 'Match not found' }, 404);
    const isOwner = match.owner_id === userId;
    const { data: participant, error } = await admin.from('match_participants')
      .select('match_role,team').eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
    if (error) return json({ error: 'Could not load match access' }, 500);
    const { data: legacyMember } = await admin.from('match_members').select('team')
      .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
    return json({
      isOwner,
      role: isOwner ? 'creator' : (participant?.match_role ?? (legacyMember ? 'player' : 'spectator')),
      team: participant?.team ?? legacyMember?.team ?? null,
    });
  }

  if (action === 'sync_participant') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    if (!match) return json({ error: 'Match not found' }, 404);
    const { data: existing } = await admin.from('match_participants')
      .select('match_role,team').eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
    if (match.owner_id === userId || existing?.match_role === 'creator' || existing?.match_role === 'gm') {
      const role = match.owner_id === userId ? 'creator' : existing.match_role;
      await admin.from('match_participants').upsert({ indicator_id: indicatorId, user_id: userId, match_role: role, team: null }, { onConflict: 'indicator_id,user_id' });
      return json({ role, team: null });
    }
    const { data: config } = await admin.from('match_permissions')
      .select('blue_discord_server_id,blue_discord_role_id,red_discord_server_id,red_discord_role_id')
      .eq('indicator_id', indicatorId).maybeSingle();
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
    const { data: authData } = await admin.auth.admin.getUserById(userId);
    const identity = authData?.user?.identities?.find((item: any) => item.provider === 'discord');
    const identityData = (identity as any)?.identity_data ?? {};
    const metadata = authData?.user?.user_metadata ?? {};
    const discordUserId = String([
      identityData.sub, identityData.user_id, identityData.provider_id, identityData.id,
      metadata.sub, metadata.provider_id, metadata.user_id, metadata.discord_id,
    ].find((value) => /^\\d{17,20}$/.test(String(value ?? ''))) ?? '');
    let detectedTeam: 'blue' | 'red' | null = null;
    if (botToken && discordUserId && config) {
      for (const teamName of ['blue', 'red'] as const) {
        const guildId = config[teamName === 'blue' ? 'blue_discord_server_id' : 'red_discord_server_id'];
        const roleId = config[teamName === 'blue' ? 'blue_discord_role_id' : 'red_discord_role_id'];
        if (!guildId || !roleId) continue;
        try {
          const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`, {
            headers: { Authorization: `Bot ${botToken}` },
          });
          if (!response.ok) continue;
          const member = await response.json();
          if (Array.isArray(member.roles) && member.roles.includes(roleId)) {
            detectedTeam = teamName;
            break;
          }
        } catch { /* Treat unavailable Discord membership as spectator. */ }
      }
    }
    const role = detectedTeam ? 'player' : 'spectator';
    const { error: participantError } = await admin.from('match_participants').upsert({
      indicator_id: indicatorId, user_id: userId, match_role: role, team: detectedTeam,
    }, { onConflict: 'indicator_id,user_id' });
    if (participantError) return json({ error: 'Could not sync match participant' }, 500);
    if (detectedTeam) {
      const { error } = await admin.from('match_members').upsert({ indicator_id: indicatorId, user_id: userId, team: detectedTeam }, { onConflict: 'indicator_id,user_id' });
      if (error) return json({ error: 'Could not sync team membership' }, 500);
    } else {
      await admin.from('match_members').delete().eq('indicator_id', indicatorId).eq('user_id', userId);
    }
    return json({ role, team: detectedTeam });
  }

  // Anyone with the link can read only the public tactical positions, never player stats.
  if (action === 'read_public') {
    if (!match) return json({ error: 'Match not found' }, 404);
    const { data, error } = await admin.from('match_public_boards').select('board')
      .eq('indicator_id', indicatorId).maybeSingle();
    if (error) return json({ error: 'Database error' }, 500);
    if (data) return json({ board: { ...data.board, arena: sanitizeArena(data.board?.arena) } });
    // Backward-compatible bootstrap: remove every private stat field from the legacy board.
    const { data: legacy } = await admin.from('match_boards').select('board').eq('indicator_id', indicatorId).maybeSingle();
    const old = legacy?.board;
    if (!old || !Array.isArray(old.players)) return json({ board: { players: [], ball: {x:50,y:62}, paths: [] } });
    const safe = {
      players: old.players.map((p: any) => ({ id:p.id, name:p.name, number:p.number, team:p.team, x:p.x, y:p.y, role:p.role })),
      ball: old.ball ?? {x:50,y:62},
      paths: Array.isArray(old.paths) ? old.paths : [],
      arena: sanitizeArena(old.arena),
    };
    return json({ board: safe });
  }

  if (!userId) return json({ error: 'Sign-in required' }, 401);
  if (!match) return json({ error: 'Match not found' }, 404);
  const isOwner = match.owner_id === userId;
  const { data: membership } = await admin.from('match_members').select('team')
    .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
  const { data: participant } = await admin.from('match_participants').select('match_role,team')
    .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
  const team = (isOwner || participant?.match_role === 'gm') ? 'gm' : (membership?.team ?? participant?.team);
  if (!team) return json({ error: 'You are not a participant in this match' }, 403);

  if (action === 'save_public') {
    if (team !== 'gm') return json({ error: 'Only the match creator or a GM can update the public board' }, 403);
    const board = body?.board;
    if (!board || !Array.isArray(board.players) || !board.ball || !Array.isArray(board.paths)) {
      return json({ error: 'Invalid board payload' }, 400);
    }
    const safe = {
      players: board.players.map((p: any) => ({ id:p.id, name:p.name, number:p.number, team:p.team, x:p.x, y:p.y, role:p.role })),
      ball: board.ball,
      paths: board.paths,
      arena: sanitizeArena(board.arena),
    };
    const { error } = await admin.from('match_public_boards').upsert({
      indicator_id: indicatorId, board: safe, updated_at: new Date().toISOString(),
    }, { onConflict: 'indicator_id' });
    return error ? json({ error: 'Could not save board' }, 500) : json({ ok: true });
  }

  if (action === 'save_player_stats') {
    if (team !== 'gm') return json({ error: 'Only the match creator or a GM can manage player stats' }, 403);
    const playerId = Number(body?.playerId);
    const playerTeam = body?.team;
    if (!Number.isInteger(playerId) || !['blue','red'].includes(playerTeam) || !body?.stats || typeof body.stats !== 'object') {
      return json({ error: 'Invalid player stats payload' }, 400);
    }
    const ciphertext = await encryptJson({ stats: body.stats, weapons: body.weapons ?? [], practice: body.practice ?? 0, training: body.training ?? 0, rating: body.rating ?? 0 });
    const { error } = await admin.from('match_player_secrets').upsert({
      indicator_id: indicatorId, player_id: playerId, team: playerTeam, ciphertext, updated_at: new Date().toISOString(),
    }, { onConflict: 'indicator_id,player_id' });
    return error ? json({ error: 'Could not save player stats' }, 500) : json({ ok: true });
  }

  if (action === 'read_team_stats') {
    const requestedTeam = body?.team;
    if (team !== 'gm' && requestedTeam !== team) return json({ error: 'You may only view your own team stats' }, 403);
    if (!['blue','red'].includes(requestedTeam)) return json({ error: 'Invalid team' }, 400);
    const { data, error } = await admin.from('match_player_secrets').select('player_id,ciphertext')
      .eq('indicator_id', indicatorId).eq('team', requestedTeam);
    if (error) return json({ error: 'Could not load team stats' }, 500);
    try {
      const players = await Promise.all((data ?? []).map(async row => ({
        playerId: row.player_id, ...(await decryptJson(row.ciphertext)),
      })));
      return json({ team: requestedTeam, players });
    } catch { return json({ error: 'Could not decrypt player stats' }, 500); }
  }

  if (action === 'add_member') {
    if (!isOwner) return json({ error: 'Only the match owner can assign participants' }, 403);
    const targetUserId = typeof body?.userId === 'string' ? body.userId : '';
    const targetTeam = body?.team;
    if (!targetUserId || !['blue','red'].includes(targetTeam)) return json({ error: 'Valid userId and team are required' }, 400);
    const { error } = await admin.from('match_members').upsert({
      indicator_id: indicatorId, user_id: targetUserId, team: targetTeam,
    }, { onConflict: 'indicator_id,user_id' });
    return error ? json({ error: 'Could not assign participant' }, 500) : json({ ok: true });
  }

  if (action === 'list_participants') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    const { data: me } = await admin.from('match_participants').select('match_role,team')
      .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
    if (!isOwner && !me) return json({ error: 'You are not a participant in this match' }, 403);
    const { data, error } = await admin.from('match_participants')
      .select('user_id,match_role,team,discord_server_id,discord_role_id,created_at')
      .eq('indicator_id', indicatorId).order('created_at');
    if (error) return json({ error: 'Could not load participants' }, 500);
    const participants = await Promise.all((data ?? []).map(async (row: any) => {
      const { data: authData } = await admin.auth.admin.getUserById(row.user_id);
      const metadata = authData?.user?.user_metadata ?? {};
      return {
        ...row,
        display_name: metadata.full_name ?? metadata.name ?? metadata.user_name ?? metadata.preferred_username ?? row.user_id,
        discord_username: metadata.custom_claims?.global_name ?? metadata.global_name ?? metadata.user_name ?? null,
      };
    }));
    return json({ participants });
  }

  if (action === 'set_participant_role') {
    if (!userId || !isOwner) return json({ error: 'Only the match creator can manage match roles' }, userId ? 403 : 401);
    const targetUserId = typeof body?.userId === 'string' ? body.userId : '';
    const role = body?.matchRole;
    const participantTeam = ['blue','red'].includes(body?.team) ? body.team : null;
    if (!targetUserId || !['gm','player','spectator'].includes(role)) {
      return json({ error: 'Valid userId and matchRole are required' }, 400);
    }
    const { error } = await admin.from('match_participants').upsert({
      indicator_id: indicatorId, user_id: targetUserId, match_role: role,
      team: role === 'player' ? participantTeam : null,
    }, { onConflict: 'indicator_id,user_id' });
    if (error) return json({ error: 'Could not update participant role' }, 500);
    if (role === 'player' && participantTeam) {
      await admin.from('match_members').upsert({ indicator_id: indicatorId, user_id: targetUserId, team: participantTeam }, { onConflict: 'indicator_id,user_id' });
    } else {
      await admin.from('match_members').delete().eq('indicator_id', indicatorId).eq('user_id', targetUserId);
    }
    return json({ ok: true });
  }

  if (action === 'get_match_settings') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    const { data: me } = await admin.from('match_participants').select('match_role')
      .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
    if (!isOwner && !me) return json({ error: 'You are not a participant in this match' }, 403);
    const { data, error } = await admin.from('match_permissions').select('*')
      .eq('indicator_id', indicatorId).maybeSingle();
    if (error) return json({ error: 'Could not load match settings' }, 500);
    return json({ settings: data ?? null });
  }

  if (action === 'save_match_settings') {
    if (!userId || !isOwner) return json({ error: 'Only the match creator can edit match settings' }, userId ? 403 : 401);
    const incoming = body?.settings;
    if (!incoming || typeof incoming !== 'object') return json({ error: 'Settings object is required' }, 400);
    const allowed = ['playersMoveOwn','captainBlue','captainRed','editArena','manageParticipants','editCharacterCards','editMatchStats','viewOwnTeamStats','viewOpponentStats','viewAllStats','editScore','editClock','editPaths','addPlayers'];
    const { data: existing } = await admin.from('match_permissions').select('settings,blue_discord_server_id,blue_discord_role_id,red_discord_server_id,red_discord_role_id')
      .eq('indicator_id', indicatorId).maybeSingle();
    const merged: Record<string, unknown> = { ...(existing?.settings ?? {}) };
    for (const key of allowed) if (typeof incoming[key] === 'boolean') merged[key] = incoming[key];
    const patch = {
      indicator_id: indicatorId, settings: merged,
      blue_discord_server_id: typeof incoming.blueDiscordServerId === 'string' ? incoming.blueDiscordServerId.slice(0,100) : existing?.blue_discord_server_id ?? null,
      blue_discord_role_id: typeof incoming.blueDiscordRoleId === 'string' ? incoming.blueDiscordRoleId.slice(0,100) : existing?.blue_discord_role_id ?? null,
      red_discord_server_id: typeof incoming.redDiscordServerId === 'string' ? incoming.redDiscordServerId.slice(0,100) : existing?.red_discord_server_id ?? null,
      red_discord_role_id: typeof incoming.redDiscordRoleId === 'string' ? incoming.redDiscordRoleId.slice(0,100) : existing?.red_discord_role_id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('match_permissions').upsert(patch, { onConflict: 'indicator_id' });
    return error ? json({ error: 'Could not save match settings' }, 500) : json({ ok: true });
  }

  if (action === 'read_character_profile') {
    const characterId = typeof body?.characterId === 'string' ? body.characterId.slice(0,128) : '';
    if (!characterId) return json({ error: 'characterId is required' }, 400);
    const { data, error } = await admin.from('character_profiles').select('character_id,display_name,current_offer,goals,matches,wins,draws,losses,extra_public_stats,updated_at')
      .eq('character_id', characterId).maybeSingle();
    if (error) return json({ error: 'Could not read character profile' }, 500);
    return json({ profile: data ?? { character_id: characterId, display_name: '', current_offer: '—', goals: 0, matches: 0, wins: 0, draws: 0, losses: 0, extra_public_stats: {} } });
  }

  if (action === 'save_character_profile') {
    if (!userId) return json({ error: 'Sign-in required' }, 401);
    const { data: me } = await admin.from('match_participants').select('match_role')
      .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
    if (!isOwner && me?.match_role !== 'gm') {
      return json({ error: 'Only the match creator or a GM can edit character cards' }, 403);
    }
    const characterId = typeof body?.characterId === 'string' ? body.characterId.slice(0,128) : '';
    const profile = body?.profile;
    if (!characterId || !profile || typeof profile !== 'object') return json({ error: 'Invalid character profile' }, 400);
    const nonNegativeInt = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 ? Number(v) : 0;
    const patch = {
      character_id: characterId,
      display_name: typeof profile.display_name === 'string' ? profile.display_name.slice(0,120) : '',
      current_offer: typeof profile.current_offer === 'string' ? profile.current_offer.slice(0,120) : '—',
      goals: nonNegativeInt(profile.goals), matches: nonNegativeInt(profile.matches),
      wins: nonNegativeInt(profile.wins), draws: nonNegativeInt(profile.draws), losses: nonNegativeInt(profile.losses),
      extra_public_stats: profile.extra_public_stats && typeof profile.extra_public_stats === 'object' ? profile.extra_public_stats : {},
      updated_by: userId, updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('character_profiles').upsert(patch, { onConflict: 'character_id' });
    return error ? json({ error: 'Could not save character profile' }, 500) : json({ ok: true, profile: patch });
  }

  return json({ error: 'Unknown action' }, 400);
});
