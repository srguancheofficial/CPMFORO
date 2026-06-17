// ══════════════════════════════════════════════════════════
//  supabase.js  —  CPMFORO  (Supabase Auth)
// ══════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://gffximqugdxsbeajzmod.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmZnhpbXF1Z2R4c2JlYWp6bW9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDU2MDcsImV4cCI6MjA5NjgyMTYwN30.XP-X2-5mCeeQ3e-3VHQZ_O-uA_stKHT8OEsGC91HHTA';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storage: sessionStorage }
});

async function getSession()     { const { data } = await sb.auth.getSession(); return data?.session ?? null; }
async function getCurrentUser() { const { data } = await sb.auth.getUser();    return data?.user    ?? null; }

async function registerUser(email, password, username, rango) {
  const { data: authData, error: authError } = await sb.auth.signUp({ email, password });
  if (authError) {
    if (authError.message.includes('already registered')) throw new Error('Este email ya está registrado.');
    throw new Error(authError.message);
  }
  const userId = authData.user?.id;
  if (!userId) throw new Error('No se pudo crear la cuenta.');
  const { data, error } = await sb.rpc('create_profile', {
    p_user_id: userId, p_username: username, p_email: email, p_rango: rango || ''
  });
  if (error) {
    if (error.message.includes('USERNAME_TOO_SHORT')) throw new Error('El nombre debe tener al menos 3 caracteres.');
    if (error.message.includes('USERNAME_TAKEN'))     throw new Error('Ese nombre de usuario ya está en uso.');
    throw new Error(error.message);
  }
  return data[0];
}

async function loginUser(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.includes('Invalid login')) throw new Error('Email o contraseña incorrectos.');
    throw new Error(error.message);
  }
  const { data: profileData, error: pErr } = await sb.rpc('get_profile', { p_user_id: data.user.id });
  if (pErr)  throw new Error(pErr.message);
  if (!profileData?.length) throw new Error('Perfil no encontrado.');
  return profileData[0];
}

async function logoutUser() { await sb.auth.signOut(); }

async function getProfile(userId) {
  const { data, error } = await sb.rpc('get_profile', { p_user_id: userId });
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Perfil no encontrado.');
  return data[0];
}

async function updateProfile(userId, username, rango) {
  const { data, error } = await sb.rpc('update_profile', { p_user_id: userId, p_username: username, p_rango: rango });
  if (error) {
    const m = error.message;
    if (m.includes('USERNAME_COOLDOWN')) throw new Error('cooldown_username');
    if (m.includes('RANGO_COOLDOWN'))    throw new Error('cooldown_rango');
    if (m.includes('USERNAME_TAKEN'))    throw new Error('Ese nombre ya está en uso.');
    throw new Error(m);
  }
  return data[0];
}

async function saveAvatarUrl(userId, avatarUrl) {
  const { error } = await sb.rpc('update_avatar_url', { p_user_id: userId, p_avatar_url: avatarUrl });
  if (error) throw new Error(error.message);
}

async function uploadAvatar(userId, file, oldUrl) {
  if (oldUrl) {
    const parts = oldUrl.split('/avatars/');
    if (parts[1]) await sb.storage.from('avatars').remove([parts[1]]);
  }
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

async function loadMessages() {
  const { data, error } = await sb.from('messages')
    .select('id, user_id, username, avatar_url, level, rango, message, created_at')
    .order('created_at', { ascending: true }).limit(100);
  if (error) throw new Error(error.message);
  return data || [];
}

async function postMessage(userId, message) {
  const { data, error } = await sb.rpc('post_message', { p_user_id: userId, p_message: message });
  if (error) throw new Error(error.message);
  return data[0];
}

let _ch = null;
function subscribeRealtime(onInsert, onDelete, onUserUpdate) {
  if (_ch) sb.removeChannel(_ch);
  _ch = sb.channel('cpmforo-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onInsert && onInsert(p.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => onDelete && onDelete(p.old))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users'    }, p => onUserUpdate && onUserUpdate(p.new))
    .subscribe();
}
function unsubscribeRealtime() { if (_ch) { sb.removeChannel(_ch); _ch = null; } }

window.SupaForo = {
  getSession, getCurrentUser, registerUser, loginUser, logoutUser,
  getProfile, updateProfile, saveAvatarUrl, uploadAvatar,
  loadMessages, postMessage, subscribeRealtime, unsubscribeRealtime
};
