import { supabase } from '../supabase.js';

export async function listBranches({ onlyActive = false } = {}) {
  let query = supabase.from('branches').select('*').order('created_at', { ascending: true });
  if (onlyActive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getBranch(id) {
  const { data, error } = await supabase.from('branches').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function createBranch(payload) {
  const { data, error } = await supabase.from('branches').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateBranch(id, payload) {
  const { data, error } = await supabase.from('branches').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBranch(id) {
  const { error } = await supabase.from('branches').delete().eq('id', id);
  if (error) throw error;
}
