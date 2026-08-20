import { supabase } from '../supabase.js';

const sum = (rows, key = 'amount') => (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);

export function paymentStatus(total, paid) {
  if (Number(paid) <= 0) return 'unpaid';
  if (Number(paid) + 0.005 < Number(total)) return 'partial';
  return 'paid';
}

export async function getInvoicePaymentSummary(saleIds) {
  if (!saleIds?.length) return {};
  const { data, error } = await supabase.from('customer_payment_allocations').select('sale_id, amount').in('sale_id', saleIds);
  if (error) throw error;
  return (data || []).reduce((summary, allocation) => {
    summary[allocation.sale_id] = Number(summary[allocation.sale_id] || 0) + Number(allocation.amount || 0);
    return summary;
  }, {});
}

export async function recordCustomerPayment({ customerId, branchId, amount, paymentMethod, receivedBy, notes = null, allocations = null }) {
  const paymentAmount = Number(amount);
  if (!(paymentAmount > 0)) throw new Error('INVALID_PAYMENT_AMOUNT');
  if (window.electronAPI?.business?.execute && !allocations) {
    const result = await window.electronAPI.business.execute('customer-payment:create', { customerId, branchId, amount: paymentAmount, paymentMethod, receivedBy, notes });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }
  let invoiceAllocations = allocations;
  if (!invoiceAllocations) {
    const { data: sales, error } = await supabase.from('sales').select('*').eq('customer_id', customerId).eq('branch_id', branchId).eq('status', 'completed').order('created_at', { ascending: true });
    if (error) throw error;
    const paidBySale = await getInvoicePaymentSummary((sales || []).map((sale) => sale.id));
    let remainingToAllocate = paymentAmount;
    invoiceAllocations = (sales || []).map((sale) => {
      const remaining = Math.max(Number(sale.total) - Number(paidBySale[sale.id] || 0), 0);
      const allocated = Math.min(remaining, remainingToAllocate);
      remainingToAllocate -= allocated;
      return { saleId: sale.id, amount: allocated };
    }).filter((allocation) => allocation.amount > 0);
    if (remainingToAllocate > 0.005) throw new Error('PAYMENT_EXCEEDS_OUTSTANDING');
  }
  const allocatedTotal = sum(invoiceAllocations);
  if (Math.abs(allocatedTotal - paymentAmount) > 0.005) throw new Error('PAYMENT_ALLOCATION_MISMATCH');

  const { data: payment, error: paymentError } = await supabase.from('customer_payments').insert({
    customer_id: customerId, branch_id: branchId, amount: paymentAmount, payment_method: paymentMethod,
    paid_at: new Date().toISOString(), received_by: receivedBy, notes
  }).select().single();
  if (paymentError) throw paymentError;

  const { error: allocationError } = await supabase.from('customer_payment_allocations').insert(invoiceAllocations.map((allocation) => ({
    payment_id: payment.id, sale_id: allocation.saleId, amount: allocation.amount
  })));
  if (allocationError) throw allocationError;

  const saleIds = invoiceAllocations.map((allocation) => allocation.saleId);
  const { data: sales, error: salesError } = await supabase.from('sales').select('*').in('id', saleIds);
  if (salesError) throw salesError;
  const paidBySale = await getInvoicePaymentSummary(saleIds);
  for (const sale of sales || []) {
    const paid = Number(paidBySale[sale.id] || 0);
    const { error } = await supabase.from('sales').update({ paid_amount: paid, payment_status: paymentStatus(sale.total, paid) }).eq('id', sale.id);
    if (error) throw error;
  }
  const { data: customer, error: customerError } = await supabase.from('customers').select('balance').eq('id', customerId).single();
  if (customerError) throw customerError;
  const { error: balanceError } = await supabase.from('customers').update({ balance: Math.max(Number(customer.balance || 0) - paymentAmount, 0) }).eq('id', customerId);
  if (balanceError) throw balanceError;
  return payment;
}

// Un-allocates any customer payments that had been applied to a sale (used
// when that sale is cancelled/refunded — see refundSale() in sales.js) and
// returns how much had been allocated, so the caller can restore that
// portion to the customer's balance. The underlying customer_payments row
// (the money actually received) is left untouched; it simply becomes
// unallocated credit the customer can be given against a future invoice.
export async function reverseSaleAllocations(saleId) {
  const { data: allocations, error } = await supabase
    .from('customer_payment_allocations')
    .select('amount')
    .eq('sale_id', saleId);
  if (error) throw error;
  const total = sum(allocations);
  if (allocations && allocations.length) {
    const { error: delErr } = await supabase.from('customer_payment_allocations').delete().eq('sale_id', saleId);
    if (delErr) throw delErr;
  }
  return total;
}

// A single merged, chronological financial ledger for one customer: every
// completed sale is a debit (they owe more), every payment is a credit
// (they owe less), each row carries a running balance. Cancelled/refunded
// sales are excluded — their effect on the balance was already reversed
// at cancellation time, same as this ledger would show if it recomputed
// from scratch. Mirrors getSupplierStatement() in suppliers.js on purpose,
// so both ledgers render with the same shape.
export async function getCustomerLedger(customerId) {
  const [{ data: sales, error: salesError }, { data: payments, error: paymentsError }, { data: returns, error: returnsError }] = await Promise.all([
    supabase.from('sales').select('*').eq('customer_id', customerId).order('created_at', { ascending: true }),
    supabase.from('customer_payments').select('*, profiles(full_name)').eq('customer_id', customerId).order('paid_at', { ascending: true }),
    supabase.from('sale_returns').select('*').eq('customer_id', customerId).order('created_at', { ascending: true })
  ]);
  if (salesError) throw salesError;
  if (paymentsError) throw paymentsError;
  if (returnsError) throw returnsError;

  const entries = [
    ...(sales || [])
      .filter((sale) => sale.status === 'completed')
      .map((sale) => ({
        type: 'sale',
        date: sale.created_at,
        ref: sale.invoice_number,
        debit: Number(sale.total),
        credit: 0,
        note: null
      })),
    ...(payments || []).map((payment) => ({
      type: 'payment',
      date: payment.paid_at,
      ref: null,
      debit: 0,
      credit: Number(payment.amount),
      note: payment.notes,
      paymentMethod: payment.payment_method
    })),
    ...(returns || []).filter((item) => item.status === 'completed' && (sales || []).some((sale) => sale.id === item.original_sale_id && sale.status === 'completed')).map((item) => ({
      type: 'return', date: item.created_at, ref: item.id, debit: 0, credit: Number(item.total),
      note: 'مرتجع فاتورة', paymentMethod: item.refund_method
    }))
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  for (const entry of entries) {
    running += entry.debit - entry.credit;
    entry.balance = running;
  }

  return entries.reverse();
}
