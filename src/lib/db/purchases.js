import { supabase } from '../supabase.js';
import { adjustSupplierBalance } from './suppliers.js';
import { normalizePaymentMethod } from '../paymentMethods.js';

// Creates the purchase invoice header + its line items, increases stock
// (via DB trigger on purchase_items insert — see sql/migration_v8.sql),
// and adds the unpaid portion to the supplier's running balance.
export async function createPurchase({
  branchId,
  supplierId,
  items, // [{ productId, productName, quantity, unitCost }]
  paidAmount = 0,
  paymentMethod = 'cash',
  notes,
  createdBy
}) {
  if (!items || items.length === 0) throw new Error('empty_items');

  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);

  const { data: purchase, error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      supplier_id: supplierId,
      branch_id: branchId,
      subtotal: total,
      total,
      paid_amount: Number(paidAmount) || 0,
      payment_method: normalizePaymentMethod(paymentMethod),
      notes: notes || null,
      created_by: createdBy
    })
    .select()
    .single();
  if (purchaseError) throw purchaseError;

  const rows = items.map((item) => ({
    purchase_id: purchase.id,
    branch_id: branchId,
    product_id: item.productId,
    product_name: item.productName,
    quantity: Number(item.quantity),
    unit_cost: Number(item.unitCost),
    total: Number(item.quantity) * Number(item.unitCost)
  }));

  const { error: itemsError } = await supabase.from('purchase_items').insert(rows);
  if (itemsError) throw itemsError;

  const remaining = total - (Number(paidAmount) || 0);
  if (remaining !== 0) {
    await adjustSupplierBalance(supplierId, remaining);
  }

  return purchase;
}

export async function listPurchases({ supplierId = null, branchId = null } = {}) {
  let query = supabase
    .from('purchases')
    .select('*, suppliers(name), branches(name), profiles(full_name)')
    .order('created_at', { ascending: false });
  if (supplierId) query = query.eq('supplier_id', supplierId);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Cancels a completed purchase invoice: restores the stock its items had
// added, then reverses exactly what createPurchase() had added to the
// supplier's balance (the unpaid remainder of this invoice). Mirrors
// refundSale() in sales.js. The purchase and its items are kept (status
// changed, not deleted) so it stays visible in purchase history.
export async function cancelPurchase(purchaseId) {
  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('purchase:cancel', { purchaseId });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }
  const { data: purchase, error: purchaseErr } = await supabase
    .from('purchases')
    .select('*')
    .eq('id', purchaseId)
    .single();
  if (purchaseErr) throw purchaseErr;
  if (purchase.status === 'cancelled') throw new Error('PURCHASE_NOT_ACTIVE');

  const { data: items, error: itemsErr } = await supabase
    .from('purchase_items')
    .select('*')
    .eq('purchase_id', purchaseId);
  if (itemsErr) throw itemsErr;

  for (const item of items || []) {
    if (!item.product_id) continue;
    const { data: product } = await supabase
      .from('products')
      .select('stock_quantity')
      .eq('id', item.product_id)
      .single();
    if (product) {
      await supabase
        .from('products')
        .update({ stock_quantity: Math.max(Number(product.stock_quantity) - Number(item.quantity), 0) })
        .eq('id', item.product_id);
    }
    await supabase.from('inventory_movements').insert({
      product_id: item.product_id,
      type: 'out',
      quantity: -Number(item.quantity),
      reason: 'إلغاء فاتورة مشتريات',
      branch_id: item.branch_id
    });
  }

  const remaining = Number(purchase.total) - Number(purchase.paid_amount);
  if (remaining !== 0) {
    await adjustSupplierBalance(purchase.supplier_id, -remaining);
  }

  const { error } = await supabase.from('purchases').update({ status: 'cancelled' }).eq('id', purchaseId);
  if (error) throw error;
}

export async function createPurchaseReturn({ purchaseId, branchId, items, createdBy, notes }) {
  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('purchase-return:create', { purchaseId, branchId, items, createdBy, notes });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }
  throw new Error('PURCHASE_RETURN_REQUIRES_ELECTRON_TRANSACTION');
}

export async function getPurchaseDetails(purchaseId) {
  const { data: purchase, error: purchaseErr } = await supabase
    .from('purchases')
    .select('*, suppliers(name, phone), branches(name), profiles(full_name)')
    .eq('id', purchaseId)
    .single();
  if (purchaseErr) throw purchaseErr;

  const { data: items, error: itemsErr } = await supabase
    .from('purchase_items')
    .select('*')
    .eq('purchase_id', purchaseId);
  if (itemsErr) throw itemsErr;

  return { purchase, items: items || [] };
}
