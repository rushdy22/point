import { supabase } from '../supabase.js';
import { normalizePaymentMethod } from '../paymentMethods.js';
import { getOpenShift } from './cashShifts.js';

export async function listTransactions({ from, to, type = null, branchId = null } = {}) {
  let query = supabase
    .from('transactions')
    .select('*, profiles(full_name), branches(name)')
    .order('txn_date', { ascending: false });
  if (from) query = query.gte('txn_date', from);
  if (to) query = query.lte('txn_date', to);
  if (type) query = query.eq('type', type);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createTransaction(payload) {
  if (normalizePaymentMethod(payload.payment_method) === 'cash' && !await getOpenShift(payload.branch_id)) {
    throw new Error('CASH_DRAWER_CLOSED');
  }
  const { data, error } = await supabase
    .from('transactions')
    .insert({ ...payload, payment_method: normalizePaymentMethod(payload.payment_method) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

// Accounts is for general/manual money movements only (manual income and
// manual expense entries) — it never mixes in sales revenue or supplier
// invoices/payments. The full picture (sales, cost of goods, inventory,
// supplier balances) lives on the Finance dashboard — see
// src/lib/db/finance.js — which is calculated automatically from that
// data instead of being entered here.
export async function accountsSummary({ from, to, branchId = null }) {
  let txnQuery = supabase
    .from('transactions')
    .select('type, amount')
    .gte('txn_date', from.slice(0, 10))
    .lte('txn_date', to.slice(0, 10));
  if (branchId) txnQuery = txnQuery.eq('branch_id', branchId);
  const { data: txns, error: txnErr } = await txnQuery;
  if (txnErr) throw txnErr;

  const manualRows = txns.filter((t) => !['repair_revenue', 'repair_deposit'].includes(t.category));
  const manualIncome = manualRows.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const manualExpense = manualRows.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const netProfit = manualIncome - manualExpense;

  return { manualIncome, manualExpense, netProfit };
}
