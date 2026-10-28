import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  const guildId = Deno.env.get('DISCORD_GUILD_ID');
  const allowedRoleIds = (Deno.env.get('DISCORD_ALLOWED_ROLE_IDS') ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (!supabaseUrl || !anonKey || !botToken || !guildId) {
    return Response.json({ error: 'Server configuration is incomplete' }, { status: 500, headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return Response.json({ error: 'Authorization required' }, { status: 401, headers: corsHeaders });
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: corsHeaders });

  const discordId = String(user.user_metadata?.provider_id ?? user.user_metadata?.sub ?? '');
  if (!/^\d{17,20}$/.test(discordId)) {
    return Response.json({ error: 'Discord account ID was not found in the signed-in profile' }, { status: 400, headers: corsHeaders });
  }

  const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (memberResponse.status === 404) {
    return Response.json({ isMember: false, hasAllowedRole: false, roles: [] }, { headers: corsHeaders });
  }
  if (!memberResponse.ok) {
    return Response.json({ error: 'Discord API request failed', status: memberResponse.status }, { status: 502, headers: corsHeaders });
  }

  const member = await memberResponse.json();
  const roles: string[] = Array.isArray(member.roles) ? member.roles : [];
  const matchedRoleIds = roles.filter(roleId => allowedRoleIds.includes(roleId));
  return Response.json({
    isMember: true,
    hasAllowedRole: matchedRoleIds.length > 0,
    matchedRoleIds,
    roles,
    discordId,
  }, { headers: corsHeaders });
});
