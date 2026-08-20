import { supabase } from '../supabase.js';
import { normalizePaymentMethod } from '../paymentMethods.js';

export async function listSuppliers({ search = '', branchId = null } = {}) {
  let query = supabase.from('suppliers').select('*, branches(name)').order('created_at', { ascending: false });
  if (branchId) query = query.eq('branch_id', branchId);
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getSupplier(id) {
  const { data, error } = await supabase.from('suppliers').select('*, branches(name)').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createSupplier(payload) {
  const { data, error } = await supabase.from('suppliers').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(id, payload) {
  const { data, error } = await supabase.from('suppliers').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSupplier(id) {
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if (error) throw error;
}

// Adjusts the supplier's running balance by `delta` (positive = store owes
// more, negative = store owes less). Used by both purchase creation
// (unpaid portion increases the debt) and payments (reduces the debt).
export async function adjustSupplierBalance(supplierId, delta) {
  const { data: supplier, error: getErr } = await supabase
    .from('suppliers')
    .select('balance')
    .eq('id', supplierId)
    .single();
  if (getErr) throw getErr;

  const { error } = await supabase
    .from('suppliers')
    .update({ balance: Number(supplier.balance) + Number(delta) })
    .eq('id', supplierId);
  if (error) throw error;
}

export async function listSupplierPayments(supplierId) {
  const { data, error } = await supabase
    .from('supplier_payments')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Records a payment toward a supplier's balance and immediately reflects
// it on the supplier's running balance.
export async function addSupplierPayment({ supplierId, branchId, amount, paymentMethod = 'cash', note, createdBy }) {
  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('supplier-payment:create', { supplierId, branchId, amount, paymentMethod: normalizePaymentMethod(paymentMethod), note, createdBy });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }
  const { data: payment, error } = await supabase
    .from('supplier_payments')
    .insert({
      supplier_id: supplierId,
      branch_id: branchId,
      amount: Number(amount),
      payment_method: normalizePaymentMethod(paymentMethod),
      note: note || null,
      created_by: createdBy
    })
    .select()
    .single();
  if (error) throw error;

  await adjustSupplierBalance(supplierId, -Number(amount));

  return payment;
}

async function loadSupplierLedgerData(supplierId) {
  const [{ data: supplier, error: sErr }, { data: purchases, error: pErr }, { data: payments, error: payErr }, { data: returns, error: rErr }] = await Promise.all([
    supabase.from('suppliers').select('*').eq('id', supplierId).single(),
    supabase.from('purchases').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: true }),
    supabase.from('supplier_payments').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: true }),
    supabase.from('purchase_returns').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: true })
  ]);
  if (sErr) throw sErr;
  if (pErr) throw pErr;
  if (payErr) throw payErr;
  if (rErr) throw rErr;
  return { supplier, purchases: purchases || [], payments: payments || [], returns: returns || [] };
}

export function calculateSupplierLedger({ supplier, purchases = [], payments = [], returns = [] }) {
  const activePurchases = purchases.filter((p) => p.status !== 'cancelled');
  const completedReturns = returns.filter((r) => r.status === 'completed');
  const opening = Number(supplier?.opening_balance || 0);
  const totalPurchases = activePurchases.reduce((sum, p) => sum + Number(p.total || 0), 0);
  const totalReturns = completedReturns.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const paidAtPurchase = activePurchases.reduce((sum, p) => sum + Number(p.paid_amount || 0), 0);
  const laterPayments = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const entries = [
    ...(opening ? [{ type: 'opening_balance', date: supplier?.created_at || new Date(0).toISOString(), ref: null, debit: opening > 0 ? opening : 0, credit: opening < 0 ? Math.abs(opening) : 0, note: 'رصيد افتتاحي' }] : []),
    ...activePurchases.map((p) => ({ type: 'purchase', date: p.created_at, ref: p.invoice_number, debit: Number(p.total || 0), credit: 0, note: null })),
    ...activePurchases.filter((p) => Number(p.paid_amount || 0) > 0).map((p) => ({ type: 'payment', date: p.created_at, ref: p.invoice_number, debit: 0, credit: Number(p.paid_amount), note: 'دفعة عند الشراء', paymentMethod: p.payment_method || p.method })),
    ...completedReturns.map((r) => ({ type: 'purchase_return', date: r.created_at, ref: r.original_purchase_id || r.id, debit: 0, credit: Number(r.total || 0), note: r.notes || 'مرتجع مشتريات' })),
    ...payments.map((p) => ({ type: 'payment', date: p.created_at || p.paid_at || p.txn_date, ref: p.id, debit: 0, credit: Number(p.amount || 0), note: p.note, paymentMethod: p.payment_method || p.method }))
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  for (const entry of entries) {
    entry.balance = running + entry.debit - entry.credit;
    running = entry.balance;
  }
  const balance = opening + totalPurchases - totalReturns - paidAtPurchase - laterPayments;
  return {
    entries,
    summary: { opening, purchases: totalPurchases, returns: totalReturns, paidAtPurchase, payments: laterPayments, totalPaid: paidAtPurchase + laterPayments, balance }
  };
}

export async function getSupplierLedgerSummary(supplierId) {
  const data = await loadSupplierLedgerData(supplierId);
  return calculateSupplierLedger(data).summary;
}

export async function getSupplierStatement(supplierId) {
  const data = await loadSupplierLedgerData(supplierId);
  const ledger = calculateSupplierLedger(data);
  const result = ledger.entries.slice().reverse();
  result.summary = ledger.summary;
  return result;
}
