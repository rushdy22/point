import { supabase } from '../supabase.js';

export async function getOpenShift(branchId) {
  const { data, error } = await supabase.from('cash_shifts')
    .select('*, branches(name), opener:opened_by(full_name)')
    .eq('branch_id', branchId).eq('status', 'open').maybeSingle();
  if (error) throw error;
  return data;
}

export async function openShift({ branchId, openingFloat, openedBy, notes }) {
  const { data, error } = await supabase.from('cash_shifts').insert({
    branch_id: branchId, opening_float: Number(openingFloat) || 0, opened_by: openedBy,
    opened_at: new Date().toISOString(), status: 'open', notes: notes || null
  }).select().single();
  if (error) throw error;
  return data;
}

export async function closeShift(shiftId, { actualCashCounted, closedBy, notes, expectedCash }) {
  const actual = Number(actualCashCounted);
  const { data, error } = await supabase.from('cash_shifts').update({
    status: 'closed', closed_by: closedBy, closed_at: new Date().toISOString(),
    actual_cash_counted: actual, expected_cash: Number(expectedCash),
    difference: actual - Number(expectedCash), notes: notes || null
  }).eq('id', shiftId).select().single();
  if (error) throw error;
  return data;
}

export async function listShiftHistory({ branchId = null, limit = 50 } = {}) {
  let query = supabase.from('cash_shifts')
    .select('*, branches(name), opener:opened_by(full_name), closer:closed_by(full_name)')
    .eq('status', 'closed').order('closed_at', { ascending: false }).limit(limit);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listShiftMovements(shiftId) {
  const { data, error } = await supabase.from('cash_movements')
    .select('*, profiles(full_name)').eq('shift_id', shiftId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addCashMovement({ shiftId, branchId, type, amount, reason, createdBy }) {
  const { data, error } = await supabase.from('cash_movements').insert({
    shift_id: shiftId, branch_id: branchId, type, amount: Number(amount),
    reason: reason || null, created_by: createdBy
  }).select().single();
  if (error) throw error;
  return data;
}

export async function computeExpectedCash(shift, { until } = {}) {
  const from = shift.opened_at;
  const to = until || new Date().toISOString();
  const [salesResult, refundsResult, movements] = await Promise.all([
    supabase.from('sales').select('total').eq('branch_id', shift.branch_id)
      .eq('payment_method', 'cash').eq('status', 'completed').gte('created_at', from).lte('created_at', to),
    supabase.from('sales').select('total').eq('branch_id', shift.branch_id)
      .eq('payment_method', 'cash').eq('status', 'refunded').gte('updated_at', from).lte('updated_at', to),
    listShiftMovements(shift.id)
  ]);
  if (salesResult.error) throw salesResult.error;
  if (refundsResult.error) throw refundsResult.error;
  const cashSalesTotal = (salesResult.data || []).reduce((sum, sale) => sum + Number(sale.total), 0);
  const cashRefundsTotal = (refundsResult.data || []).reduce((sum, sale) => sum + Number(sale.total), 0);
  const cashIn = movements.filter((movement) => movement.type === 'cash_in').reduce((sum, movement) => sum + Number(movement.amount), 0);
  const cashOut = movements.filter((movement) => movement.type === 'cash_out').reduce((sum, movement) => sum + Number(movement.amount), 0);
  const repairDepositsTotal = movements.filter((movement) => movement.type === 'cash_in' && String(movement.reason || '').startsWith('عربون صيانة'))
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  return { expected: Number(shift.opening_float) + cashSalesTotal - cashRefundsTotal + cashIn - cashOut, cashSalesTotal, cashRefundsTotal, cashIn, cashOut, repairDepositsTotal, movements };
}
