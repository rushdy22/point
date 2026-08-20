import { supabase, supabaseRemote } from './supabase.js';

const LOCAL_SESSION_KEY = 'pos-local-auth-session';
const INTERNAL_DOMAIN = 'internal.pos';

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function internalEmail(username) {
  return `${normalizeUsername(username)}@${INTERNAL_DOMAIN}`;
}

function setLocalSession(profile) {
  localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
    userId: profile.id,
    username: profile.username,
    authEmail: profile.auth_email || internalEmail(profile.username)
  }));
}

function readLocalSession() {
  try { return JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || 'null'); } catch { return null; }
}

async function forwardSessionToMain(session) {
  if (window.electronAPI?.sync?.setSession) {
    try { await window.electronAPI.sync.setSession(session || null); } catch { /* background-only failure */ }
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

function isNetworkFailure(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  return !status || status >= 500 || /fetch|network|offline|timeout|aborted|failed to connect/.test(message);
}

function reportAuthError(error, { username, userId } = {}) {
  try {
    window.electronAPI?.sync?.reportAuthError?.({
      endpoint: '/auth/v1/token?grant_type=password',
      httpCode: error?.status || null,
      errorCode: error?.code || error?.error_code || null,
      message: error?.message || String(error),
      username,
      userId
    });
  } catch { /* diagnostics must never break authentication */ }
}

async function loadRemoteProfile(userId) {
  const { data, error } = await supabaseRemote
    .from('profiles')
    .select('id,full_name,username,auth_email,role,branch_id,is_active,is_owner_admin,created_at,updated_at,deleted_at,branches(name)')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function ensureSynced(session) {
  await forwardSessionToMain(session);
  if (window.electronAPI?.sync?.forceSync) await withTimeout(window.electronAPI.sync.forceSync(), 10000);
}

supabase.auth.onAuthStateChange((_event, session) => forwardSessionToMain(session));

export async function login(username, password) {
  const normalized = normalizeUsername(username);
  const localResult = await window.electronAPI?.auth?.loginLocal?.({ username: normalized, password });
  if (localResult?.data && !localResult.error) {
    setLocalSession(localResult.data);
    // Validate the same credentials against Auth when possible. A real
    // network/auth rejection must not be hidden as a successful Online login;
    // a genuine network failure still falls back to Local Auth.
    const email = localResult.data.auth_email || (normalized.includes('@') ? normalized : internalEmail(normalized));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { user: { id: localResult.data.id, user_metadata: localResult.data }, session: null, local: true };
    }
    const remote = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 8000);
    if (remote?.data?.session) {
      try {
        const remoteProfile = await loadRemoteProfile(remote.data.user.id);
        await ensureSynced(remote.data.session);
        const cached = await window.electronAPI?.auth?.cacheCredentials?.({
          userId: remote.data.user.id,
          username: normalized,
          authEmail: remote.data.user.email,
          password,
          profile: remoteProfile || remote.data.user.user_metadata || {}
        });
        if (cached?.data) setLocalSession(cached.data);
      } catch (error) {
        reportAuthError(error, { username: normalized, userId: remote.data.user.id });
      }
      return { ...remote.data, local: true };
    }
    if (remote?.error) {
      reportAuthError(remote.error, { username: normalized, userId: localResult.data.id });
      if (!isNetworkFailure(remote.error)) throw remote.error;
    }
    return { user: { id: localResult.data.id, user_metadata: localResult.data }, session: null, local: true };
  }

  // Supabase Auth still uses an email internally. The cashier only sees a
  // username; newly provisioned accounts use a deterministic hidden address.
  let email = normalized.includes('@') ? normalized : null;
  if (!normalized.includes('@')) {
    try {
      const resolved = await supabaseRemote.rpc('resolve_pos_login_email', { p_username: normalized });
      if (!resolved.error && resolved.data) email = resolved.data;
    } catch (error) {
      reportAuthError(error, { username: normalized });
    }
  }
  if (!email) throw new Error('username-email-not-found');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    reportAuthError(error, { username: normalized });
    throw error;
  }
  await ensureSynced(data.session);

  let remoteProfile = null;
  try { remoteProfile = await loadRemoteProfile(data.user.id); } catch (profileError) {
    reportAuthError(profileError, { username: normalized, userId: data.user.id });
  }

  const cached = await window.electronAPI?.auth?.cacheCredentials?.({
    userId: data.user.id,
    username: normalized,
    authEmail: data.user.email,
    password,
    profile: remoteProfile || data.user.user_metadata || {}
  });
  if (cached?.data) setLocalSession(cached.data);
  return data;
}

export async function logout() {
  localStorage.removeItem(LOCAL_SESSION_KEY);
  await window.electronAPI?.auth?.logoutLocal?.();
  try { await supabase.auth.signOut(); } catch { /* offline logout is local */ }
}

export async function getSession() {
  const local = readLocalSession();
  if (local) return { user: { id: local.userId, email: local.authEmail, user_metadata: { username: local.username } }, local: true };
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getCurrentProfile() {
  const local = readLocalSession();
  if (local && window.electronAPI?.auth?.getLocalProfile) {
    const result = await window.electronAPI.auth.getLocalProfile(local.userId);
    if (result?.data) return result.data;
    return { id: local.userId, username: local.username, role: 'cashier', _profileLoadFailed: true };
  }

  const session = await supabaseRemote.auth.getSession().then((r) => r.data.session);
  if (!session) return null;

  await ensureSynced(session);
  const localResult = await window.electronAPI?.auth?.getLocalProfile?.(session.user.id);
  if (localResult?.data) return localResult.data;

  // Plain web build (no Electron local cache available): fetch the
  // profile straight from Supabase instead of giving up.
  if (!window.electronAPI) {
    try {
      const remoteProfile = await loadRemoteProfile(session.user.id);
      if (remoteProfile) return remoteProfile;
    } catch (error) {
      reportAuthError(error, { userId: session.user.id });
    }
  }

  return { id: session.user.id, full_name: session.user.email, username: session.user.email, role: 'cashier', _profileLoadFailed: true };
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return data.subscription;
}
