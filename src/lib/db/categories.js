import { supabase } from '../supabase.js';

// branchId: a specific branch uuid, or null to mean "all branches" (admin
// only — same pattern as listProducts in products.js).
export async function listCategories(branchId = null) {
  let query = supabase
    .from('categories')
    .select('*, products(count)')
    .order('created_at', { ascending: true });
  if (branchId) query = query.eq('branch_id', branchId);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((c) => ({ ...c, products_count: c.products?.[0]?.count ?? 0 }));
}

export async function createCategory(payload, branchId) {
  const { data, error } = await supabase.from('categories').insert({ ...payload, branch_id: branchId }).select().single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, payload) {
  const { data, error } = await supabase.from('categories').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}
