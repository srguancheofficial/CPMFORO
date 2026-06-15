// ============================================================
//  supabase.js  —  AutoForo · Capa de integración Supabase
//  Incluir ANTES del <script> principal del HTML:
//    <script src="supabase.js"></script>
// ============================================================

// ──────────────────────────────────────────────────────────
// 0. CONFIGURACIÓN  ←  CAMBIA ESTOS DOS VALORES
// ──────────────────────────────────────────────────────────
const SUPABASE_URL    = 'https://gffximqugdxsbeajzmod.supabase.co';
const SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmZnhpbXF1Z2R4c2JlYWp6bW9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDU2MDcsImV4cCI6MjA5NjgyMTYwN30.XP-X2-5mCeeQ3e-3VHQZ_O-uA_stKHT8OEsGC91HHTA';

// ──────────────────────────────────────────────────────────
// 1. CLIENTE SUPABASE  (usa el CDN cargado en el HTML)
// ──────────────────────────────────────────────────────────
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ──────────────────────────────────────────────────────────
// 2. SESIÓN PERSONALIZADA
//    Guardamos solo  { id, username }  en sessionStorage
//    (se borra al cerrar la pestaña, más seguro que localStorage)
// ──────────────────────────────────────────────────────────
const SESSION_KEY = 'autoforo_session';

function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}
function saveSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// ──────────────────────────────────────────────────────────
// 3. AVATAR — helpers de Storage
// ──────────────────────────────────────────────────────────
const AVATAR_BUCKET  = 'avatars';
const AVATAR_MAX_PX  = 480;

/** Redimensiona un File a máx 480×480 y devuelve un Blob JPEG */
async function processAvatarBlob(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ev => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const side   = Math.min(Math.min(img.width, img.height), AVATAR_MAX_PX);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = side;
        const ctx    = canvas.getContext('2d');
        const src    = Math.min(img.width, img.height);
        ctx.drawImage(
          img,
          (img.width  - src) / 2,
          (img.height - src) / 2,
          src, src, 0, 0, side, side
        );
        canvas.toBlob(resolve, 'image/jpeg', 0.88);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Sube un nuevo avatar, borra el anterior y devuelve la URL pública.
 * @param {string}  userId     — UUID del usuario
 * @param {File}    file       — archivo de imagen elegido
 * @param {string|null} oldUrl — URL pública del avatar anterior (o null)
 */
async function uploadAvatar(userId, file, oldUrl) {
  // Validar tipo
  const allowed = ['image/jpeg','image/png','image/webp','image/jpg'];
  if (!allowed.includes(file.type)) {
    throw new Error('Formato no permitido. Usa JPG, PNG o WebP.');
  }

  // Borrar avatar anterior si existe
  if (oldUrl) {
    try {
      const path = oldUrl.split(`/${AVATAR_BUCKET}/`)[1];  // extrae la ruta interna
      if (path) await sb.storage.from(AVATAR_BUCKET).remove([path]);
    } catch (_) { /* ignorar si no existe */ }
  }

  // Procesar imagen → Blob 480×480
  const blob     = await processAvatarBlob(file);
  const filePath = `${userId}/avatar_${Date.now()}.jpg`;

  // Subir
  const { error: upErr } = await sb.storage
    .from(AVATAR_BUCKET)
    .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw upErr;

  // URL pública
  const { data } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

// ──────────────────────────────────────────────────────────
// 4. AUTH  — registro, login, logout
// ──────────────────────────────────────────────────────────

/**
 * Registra un nuevo usuario.
 * Llama a la función RPC register_user (bcrypt en servidor).
 * @returns {Object} perfil del usuario creado
 */
async function registerUser(username, password, rango = '') {
  const { data, error } = await sb.rpc('register_user', {
    p_username: username.trim(),
    p_password: password,
    p_rango:    rango
  });
  if (error) {
    // Mapeamos los errores del servidor a mensajes amigables
    const msg = error.message || '';
    if (msg.includes('USERNAME_TAKEN'))   throw new Error('Ese nombre de usuario ya existe.');
    if (msg.includes('USERNAME_TOO_SHORT')) throw new Error('El nombre debe tener al menos 3 caracteres.');
    if (msg.includes('PASSWORD_TOO_SHORT')) throw new Error('La contraseña debe tener al menos 4 caracteres.');
    throw new Error('Error al registrar: ' + msg);
  }
  if (!data || data.length === 0) throw new Error('Error inesperado al registrar.');
  const user = data[0];
  saveSession({ id: user.id, username: user.username });
  return user;
}

/**
 * Inicia sesión.
 * Llama a la función RPC login_user (bcrypt en servidor).
 * @returns {Object} perfil del usuario
 */
async function loginUser(username, password) {
  const { data, error } = await sb.rpc('login_user', {
    p_username: username.trim(),
    p_password: password
  });
  if (error) throw new Error('Error de conexión: ' + (error.message || ''));
  if (!data || data.length === 0) throw new Error('Usuario o contraseña incorrectos.');
  const user = data[0];
  saveSession({ id: user.id, username: user.username });
  return user;
}

/** Cierra la sesión local */
function logoutUser() {
  clearSession();
}

// ──────────────────────────────────────────────────────────
// 5. MENSAJES
// ──────────────────────────────────────────────────────────

/** Carga los últimos 100 mensajes (orden ascendente para el chat) */
async function loadMessages() {
  const { data, error } = await sb
    .from('messages')
    .select('id, username, avatar_url, level, rango, message, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []).reverse();   // mostramos del más antiguo al más nuevo
}

/**
 * Publica un mensaje. Usa la RPC post_message (security definer)
 * para saltarse RLS y actualizar XP en el mismo paso.
 */
async function postMessage(userId, text) {
  const { data, error } = await sb.rpc('post_message', {
    p_user_id: userId,
    p_message: text.trim()
  });
  if (error) {
    if (error.message.includes('EMPTY_MESSAGE')) throw new Error('El mensaje no puede estar vacío.');
    throw error;
  }
  return data[0];
}

// ──────────────────────────────────────────────────────────
// 6. PERFIL
// ──────────────────────────────────────────────────────────

/** Actualiza username y rango via RPC (incluye cooldown en servidor) */
async function updateProfile(userId, username, rango) {
  const { data, error } = await sb.rpc('update_profile', {
    p_user_id:  userId,
    p_username: username.trim(),
    p_rango:    rango
  });
  if (error) {
    const msg = error.message || '';
    if (msg.includes('USERNAME_COOLDOWN')) throw new Error('cooldown_username');
    if (msg.includes('RANGO_COOLDOWN'))    throw new Error('cooldown_rango');
    if (msg.includes('USERNAME_TAKEN'))    throw new Error('Ese nombre ya está en uso.');
    throw new Error('Error al guardar: ' + msg);
  }
  return data[0];
}

/** Guarda la URL del avatar en el perfil */
async function saveAvatarUrl(userId, url) {
  const { error } = await sb.rpc('update_avatar_url', {
    p_user_id:    userId,
    p_avatar_url: url
  });
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// 7. REALTIME
// ──────────────────────────────────────────────────────────

let _realtimeChannel = null;

/**
 * Suscribe al canal de mensajes y usuarios en tiempo real.
 * @param {Function} onNewMessage   — cb({ type:'INSERT', record })
 * @param {Function} onDeleteMessage — cb({ type:'DELETE', old_record })
 * @param {Function} onUserUpdate   — cb(record) con perfil actualizado
 */
function subscribeRealtime(onNewMessage, onDeleteMessage, onUserUpdate) {
  if (_realtimeChannel) {
    sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }

  _realtimeChannel = sb
    .channel('autoforo-public')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      payload => onNewMessage && onNewMessage(payload.new)
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      payload => onDeleteMessage && onDeleteMessage(payload.old)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'users' },
      payload => onUserUpdate && onUserUpdate(payload.new)
    )
    .subscribe();

  return _realtimeChannel;
}

function unsubscribeRealtime() {
  if (_realtimeChannel) {
    sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

// ──────────────────────────────────────────────────────────
// 8. EXPONER GLOBALMENTE (lo usa index.html)
// ──────────────────────────────────────────────────────────
window.SupaForo = {
  getSession,
  saveSession,
  clearSession,
  registerUser,
  loginUser,
  logoutUser,
  loadMessages,
  postMessage,
  uploadAvatar,
  saveAvatarUrl,
  updateProfile,
  subscribeRealtime,
  unsubscribeRealtime
};
