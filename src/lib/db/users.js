import { supabase } from '../supabase.js';

export async function listProfiles() {
  const { data, error } = await supabase.from('profiles').select('*, branches(name)').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateProfileRole(id, role) {
  return updateUser(id, { role });
}

export async function updateProfileBranch(id, branchId) {
  return updateUser(id, { branchId });
}

export async function setProfileActive(id, isActive) {
  return updateUser(id, { isActive });
}

// User changes are committed to local SQLite and handed to the background
// provisioning outbox. No privileged Supabase key is present in the client.
export async function createUser({ password, fullName, username, role, branchId }) {
  const result = await window.electronAPI?.users?.create({ password, fullName, username, role, branchId });
  if (!result || result.error) throw new Error(result?.error?.message || 'electron-only');
  return result.data;
}

export async function deleteUser(id) {
  const result = await window.electronAPI?.users?.delete(id);
  if (!result || result.error) throw new Error(result?.error?.message || 'electron-only');
}

export async function updateUser(id, payload) {
  const result = await window.electronAPI?.users?.update(id, payload);
  if (!result || result.error) throw new Error(result?.error?.message || 'electron-only');
  return result.data;
}
