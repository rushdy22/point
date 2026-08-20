import { supabase } from '../supabase.js';

// branchId: a specific branch uuid, or null to mean "all branches" (admin only —
// enforced by RLS regardless, this is just the app-level query shape).
export async function listProducts({ search = '', categoryId = null, onlyActive = false, branchId = null } = {}) {
  let query = supabase
    .from('products')
    .select('*, categories(id, name, color, icon), branches(name)')
    .order('created_at', { ascending: false });

  if (branchId) query = query.eq('branch_id', branchId);
  if (search) {
    query = query.or(`name.ilike.%${search}%,barcode.ilike.%${search}%,name_en.ilike.%${search}%`);
  }
  if (categoryId) query = query.eq('category_id', categoryId);
  if (onlyActive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getProductByBarcode(barcode, branchId) {
  let query = supabase
    .from('products')
    .select('*, categories(id, name, color, icon)')
    .eq('barcode', barcode);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function createProduct(payload) {
  const { data, error } = await supabase.from('products').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, payload) {
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

export async function lowStockProducts({ branchId = null } = {}) {
  let query = supabase
    .from('products')
    .select('*, categories(name), branches(name)')
    .eq('is_active', true)
    .order('stock_quantity', { ascending: true });
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter((p) => Number(p.stock_quantity) <= Number(p.low_stock_threshold));
}
