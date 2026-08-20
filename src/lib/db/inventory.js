import { supabase } from '../supabase.js';

export async function listMovements({ productId = null, branchId = null, limit = 200 } = {}) {
  let query = supabase
    .from('inventory_movements')
    .select('*, products(name), profiles(full_name), branches(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (productId) query = query.eq('product_id', productId);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getStockLedger({ productId, branchId }) {
  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('stock:ledger', { productId, branchId });
    if (result?.error) throw new Error(result.error.message);
    return result.data || [];
  }
  return listMovements({ productId, branchId, limit: 1000 });
}

export async function adjustStock({ productId, type, quantity, reason, userId, branchId }) {
  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('stock:adjust', { productId, type, quantity, reason, userId, branchId });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }
  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('stock_quantity, branch_id')
    .eq('id', productId)
    .single();
  if (pErr) throw pErr;

  let delta = Number(quantity);
  if (type === 'out') delta = -Math.abs(delta);
  if (type === 'in') delta = Math.abs(delta);
  // 'adjustment' uses delta as given (can be positive or negative)

  const newStock = Number(product.stock_quantity) + delta;

  const { error: updateErr } = await supabase
    .from('products')
    .update({ stock_quantity: newStock })
    .eq('id', productId);
  if (updateErr) throw updateErr;

  const { error: moveErr } = await supabase.from('inventory_movements').insert({
    product_id: productId,
    type,
    quantity: delta,
    reason,
    created_by: userId,
    branch_id: branchId || product.branch_id
  });
  if (moveErr) throw moveErr;

  return newStock;
}

/* ---------------------- Stock transfers between branches ---------------------- */

export async function listTransfers({ branchId = null, limit = 100 } = {}) {
  let query = supabase
    .from('stock_transfers')
    .select('*, from_branch:from_branch_id(name), to_branch:to_branch_id(name), profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (branchId) query = query.or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Moves stock from a product in one branch to the matching product
// (by barcode, falling back to name) in another branch, creating the
// destination product record if it doesn't exist yet there.
export async function transferStock({ fromProductId, toBranchId, quantity, note, userId }) {
  const qty = Number(quantity);
  if (!(qty > 0)) throw new Error('invalid_quantity');

  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('stock:transfer', { fromProductId, toBranchId, quantity: qty, note, userId });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }

  const { data: fromProduct, error: fpErr } = await supabase
    .from('products')
    .select('*')
    .eq('id', fromProductId)
    .single();
  if (fpErr) throw fpErr;

  if (fromProduct.branch_id === toBranchId) throw new Error('same_branch');
  if (Number(fromProduct.stock_quantity) < qty) throw new Error('insufficient_stock');

  let toProduct = null;
  if (fromProduct.barcode) {
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('branch_id', toBranchId)
      .eq('barcode', fromProduct.barcode)
      .maybeSingle();
    toProduct = data;
  }
  if (!toProduct) {
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('branch_id', toBranchId)
      .eq('name', fromProduct.name)
      .maybeSingle();
    toProduct = data;
  }

  if (toProduct) {
    const { error } = await supabase
      .from('products')
      .update({ stock_quantity: Number(toProduct.stock_quantity) + qty })
      .eq('id', toProduct.id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('products')
      .insert({
        branch_id: toBranchId,
        name: fromProduct.name,
        name_en: fromProduct.name_en,
        barcode: fromProduct.barcode,
        category_id: fromProduct.category_id,
        price: fromProduct.price,
        cost: fromProduct.cost,
        stock_quantity: qty,
        low_stock_threshold: fromProduct.low_stock_threshold,
        unit: fromProduct.unit,
        is_active: true
      })
      .select()
      .single();
    if (error) throw error;
    toProduct = data;
  }

  await supabase
    .from('products')
    .update({ stock_quantity: Number(fromProduct.stock_quantity) - qty })
    .eq('id', fromProduct.id);

  await supabase.from('inventory_movements').insert([
    {
      product_id: fromProduct.id,
      type: 'out',
      quantity: -qty,
      reason: 'نقل إلى فرع آخر',
      created_by: userId,
      branch_id: fromProduct.branch_id
    },
    {
      product_id: toProduct.id,
      type: 'in',
      quantity: qty,
      reason: 'نقل من فرع آخر',
      created_by: userId,
      branch_id: toBranchId
    }
  ]);

  const { error: transferErr } = await supabase.from('stock_transfers').insert({
    from_branch_id: fromProduct.branch_id,
    to_branch_id: toBranchId,
    from_product_id: fromProduct.id,
    to_product_id: toProduct.id,
    product_name: fromProduct.name,
    quantity: qty,
    note: note || null,
    created_by: userId
  });
  if (transferErr) throw transferErr;

  return toProduct;
}
