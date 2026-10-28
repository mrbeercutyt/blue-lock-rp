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
    return json({ ok: true, board: safe });
  }

  // Anyone with the link can read only the public tactical positions, never player stats.
  if (action === 'read_public') {
    if (!match) return json({ error: 'Match not found' }, 404);
    const { data, error } = await admin.from('match_public_boards').select('board')
      .eq('indicator_id', indicatorId).maybeSingle();
    if (error) return json({ error: 'Database error' }, 500);
    if (data) return json({ board: data.board });
    // Backward-compatible bootstrap: remove every private stat field from the legacy board.
    const { data: legacy } = await admin.from('match_boards').select('board').eq('indicator_id', indicatorId).maybeSingle();
    const old = legacy?.board;
    if (!old || !Array.isArray(old.players)) return json({ board: { players: [], ball: {x:50,y:62}, paths: [] } });
    const safe = {
      players: old.players.map((p: any) => ({ id:p.id, name:p.name, number:p.number, team:p.team, x:p.x, y:p.y, role:p.role })),
      ball: old.ball ?? {x:50,y:62},
      paths: Array.isArray(old.paths) ? old.paths : [],
    };
    return json({ board: safe });
  }

  if (!userId) return json({ error: 'Sign-in required' }, 401);
  if (!match) return json({ error: 'Match not found' }, 404);
  const isOwner = match.owner_id === userId;
  const { data: membership } = await admin.from('match_members').select('team')
    .eq('indicator_id', indicatorId).eq('user_id', userId).maybeSingle();
  const team = isOwner ? 'gm' : membership?.team;
  if (!team) return json({ error: 'You are not a participant in this match' }, 403);

  if (action === 'save_public') {
    if (!isOwner) return json({ error: 'Only the match owner can update the public board' }, 403);
    const board = body?.board;
    if (!board || !Array.isArray(board.players) || !board.ball || !Array.isArray(board.paths)) {
      return json({ error: 'Invalid board payload' }, 400);
    }
    const safe = {
      players: board.players.map((p: any) => ({ id:p.id, name:p.name, number:p.number, team:p.team, x:p.x, y:p.y, role:p.role })),
      ball: board.ball,
      paths: board.paths,
    };
    const { error } = await admin.from('match_public_boards').upsert({
      indicator_id: indicatorId, board: safe, updated_at: new Date().toISOString(),
    }, { onConflict: 'indicator_id' });
    return error ? json({ error: 'Could not save board' }, 500) : json({ ok: true });
  }

  if (action === 'save_player_stats') {
    if (!isOwner) return json({ error: 'Only the match owner can manage player stats' }, 403);
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

  return json({ error: 'Unknown action' }, 400);
});
