import { supabase } from '../supabase.js';
import { findOrCreateCustomer, recordCustomerPurchase } from './customers.js';
import { normalizePaymentMethod } from '../paymentMethods.js';
import { getOpenShift } from './cashShifts.js';
import { paymentStatus, recordCustomerPayment, reverseSaleAllocations } from './customerPayments.js';
import { addScaled, fromScaled, toScaled } from '../decimal.js';

// Creates the sale header, its line items, and an invoice record — all
// scoped to a single branch. Stock decrement + inventory movement logging
// happens via DB trigger on sale_items insert (see sql/schema.sql + migrations).
export async function createSale({
  branchId,
  cashierId,
  cart,
  discount = 0,
  tax = 0,
  paidAmount,
  paymentMethod,
  customerName,
  customerPhone,
  customerVehicleType,
  customerVehicleNumber,
  customerId = null,
  notes
}) {
  if (normalizePaymentMethod(paymentMethod) === 'cash' && Number(paidAmount) > 0 && !await getOpenShift(branchId)) {
    throw new Error('CASH_DRAWER_CLOSED');
  }
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = Math.max(subtotal - discount + tax, 0);
  const change = Math.max((paidAmount ?? total) - total, 0);
  const appliedPaidAmount = Math.min(Number(paidAmount ?? total), total);

  // When the caller already knows which customer this belongs to (e.g. adding
  // an invoice from that customer's own statement), link directly by id
  // instead of the phone-lookup below — this also covers customers with no
  // phone on file, who would otherwise end up unlinked.
  let customer = null;
  if (customerId) {
    customer = { id: customerId };
  } else if (customerPhone) {
    customer = await findOrCreateCustomer({ name: customerName, phone: customerPhone, branchId, vehicleType: customerVehicleType, vehicleNumber: customerVehicleNumber });
  }
  if (appliedPaidAmount < total && !customer) throw new Error('CUSTOMER_REQUIRED_FOR_CREDIT');

  // Electron uses one SQLite transaction for the invoice, lines, stock
  // validation, movement and customer accounting. The browser fallback below
  // remains for development only and keeps the existing remote API shape.
  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('sale:create', {
      branchId, cashierId, cart, discount, tax, paidAmount: appliedPaidAmount,
      paymentMethod: normalizePaymentMethod(paymentMethod), customerName, customerPhone,
      customerVehicleType, customerVehicleNumber, customerId: customer?.id || null, notes
    });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      branch_id: branchId,
      cashier_id: cashierId,
      customer_id: customer?.id || null,
      subtotal,
      discount,
      tax,
      total,
      paid_amount: customer ? 0 : appliedPaidAmount,
      change_amount: change,
      payment_method: normalizePaymentMethod(paymentMethod),
      payment_status: paymentStatus(total, appliedPaidAmount),
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      customer_vehicle_type: customerVehicleType || null,
      customer_vehicle_number: customerVehicleNumber || null,
      notes: notes || null
    })
    .select()
    .single();
  if (saleError) throw saleError;

  const items = cart.map((item) => ({
    sale_id: sale.id,
    branch_id: branchId,
    product_id: item.id,
    product_name: item.name,
    quantity: item.qty,
    unit_price: item.price,
    original_unit_price: item.defaultPrice ?? item.price,
    unit_cost: item.cost || 0,
    discount: item.discount || 0,
    total: item.price * item.qty - (item.discount || 0)
  }));

  const { error: itemsError } = await supabase.from('sale_items').insert(items);
  if (itemsError) throw itemsError;

  if (customer) {
    try {
      await recordCustomerPurchase(customer.id, total);
      if (appliedPaidAmount > 0) {
        await recordCustomerPayment({
          customerId: customer.id, branchId, amount: appliedPaidAmount,
          paymentMethod: normalizePaymentMethod(paymentMethod), receivedBy: cashierId,
          allocations: [{ saleId: sale.id, amount: appliedPaidAmount }]
        });
      }
    } catch {
      /* non-fatal: sale already succeeded, customer stats can be reconciled later */
    }
  }

  // The phone is not persisted on the sales row; retain it on this immediate
  // result so the completed-sale dialog can send the receipt through WhatsApp.
  return { ...sale, customer_phone: customerPhone || '', customer_vehicle_type: customerVehicleType || '', customer_vehicle_number: customerVehicleNumber || '' };
}

export async function createSaleReturn({ saleId, branchId, items, refundMethod = 'cash', createdBy, notes }) {
  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('return:create', { saleId, branchId, items, refundMethod, createdBy, notes });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }
  throw new Error('RETURN_REQUIRES_ELECTRON_TRANSACTION');
}

export async function listSales({ from, to, status = null, cashierId = null, branchId = null } = {}) {
  let query = supabase
    .from('sales')
    .select('*, profiles(full_name), branches(name)')
    .order('created_at', { ascending: false });

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (status) query = query.eq('status', status);
  if (cashierId) query = query.eq('cashier_id', cashierId);
  if (branchId) query = query.eq('branch_id', branchId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getSaleDetails(saleId) {
  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .select('*, profiles(full_name), branches(name)')
    .eq('id', saleId)
    .single();
  if (saleErr) throw saleErr;

  const { data: items, error: itemsErr } = await supabase
    .from('sale_items')
    .select('*')
    .eq('sale_id', saleId);
  if (itemsErr) throw itemsErr;

  return { sale, items: items || [] };
}

// Replaces an existing invoice's line items (used to add/remove/edit items
// on an already-completed sale, e.g. from the customer statement). Stock for
// the previous items is restored first, then the new items are inserted —
// the insert trigger (trg_sale_item_stock) decrements stock for the new
// quantities automatically, the same way a fresh sale does.
export async function updateSaleItems({
  saleId,
  branchId,
  items,
  discount = 0,
  tax = 0,
  paymentMethod,
  notes
}) {
  const { data: oldItems, error: oldErr } = await supabase.from('sale_items').select('*').eq('sale_id', saleId);
  if (oldErr) throw oldErr;

  for (const oldItem of oldItems || []) {
    if (!oldItem.product_id) continue;
    const { data: product } = await supabase
      .from('products')
      .select('stock_quantity')
      .eq('id', oldItem.product_id)
      .single();
    if (product) {
      await supabase
        .from('products')
        .update({ stock_quantity: Number(product.stock_quantity) + Number(oldItem.quantity) })
        .eq('id', oldItem.product_id);
    }
  }

  const { error: delErr } = await supabase.from('sale_items').delete().eq('sale_id', saleId);
  if (delErr) throw delErr;

  const subtotal = items.reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
  const total = Math.max(subtotal - discount + tax, 0);

  const newItems = items.map((item) => ({
    sale_id: saleId,
    branch_id: branchId,
    product_id: item.product_id || null,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    original_unit_price: item.original_unit_price ?? item.unit_price,
    unit_cost: item.unit_cost || 0,
    discount: item.discount || 0,
    total: item.unit_price * item.quantity - (item.discount || 0)
  }));
  const { error: insErr } = await supabase.from('sale_items').insert(newItems);
  if (insErr) throw insErr;

  const updatePayload = { subtotal, discount, tax, total };
  if (paymentMethod) updatePayload.payment_method = normalizePaymentMethod(paymentMethod);
  if (notes !== undefined) updatePayload.notes = notes || null;

  const { data: sale, error: updErr } = await supabase
    .from('sales')
    .update(updatePayload)
    .eq('id', saleId)
    .select()
    .single();
  if (updErr) throw updErr;
  return sale;
}

// Cancels/refunds a completed sale: restores every line item's quantity
// back to stock, then reverses exactly what that sale had added to the
// customer's ledger — undoing recordCustomerPurchase()'s debit and giving
// back whatever portion of it had already been paid (any customer_payment
// allocations tied to this sale no longer apply to a voided invoice, so
// they're released — see reverseSaleAllocations()). The sale row itself is
// kept (status changed, not deleted) so it stays visible in history.
export async function refundSale(saleId) {
  const { data: sale, error: saleErr } = await supabase.from('sales').select('*').eq('id', saleId).single();
  if (saleErr) throw saleErr;
  if (sale.status !== 'completed') throw new Error('SALE_NOT_ACTIVE');
  if (normalizePaymentMethod(sale.payment_method) === 'cash' && !await getOpenShift(sale.branch_id)) {
    throw new Error('CASH_DRAWER_CLOSED');
  }
  const { data: items, error: itemsErr } = await supabase
    .from('sale_items')
    .select('*')
    .eq('sale_id', saleId);
  if (itemsErr) throw itemsErr;

  if (window.electronAPI?.business?.execute) {
    const result = await window.electronAPI.business.execute('return:create', {
      saleId,
      branchId: sale.branch_id,
      createdBy: sale.cashier_id,
      refundMethod: sale.payment_method || 'cash',
      items: (items || []).map((item) => ({ saleItemId: item.id, quantity: item.quantity }))
    });
    if (result?.error) throw new Error(result.error.message);
    return result.data;
  }

  for (const item of items) {
    if (!item.product_id) continue;
    const { data: product } = await supabase
      .from('products')
      .select('stock_quantity')
      .eq('id', item.product_id)
      .single();
    if (product) {
      await supabase
        .from('products')
        .update({ stock_quantity: Math.max(Number(product.stock_quantity) + Number(item.quantity), 0) })
        .eq('id', item.product_id);
    }
    await supabase.from('inventory_movements').insert({
      product_id: item.product_id,
      type: 'refund',
      quantity: item.quantity,
      reason: 'استرجاع فاتورة',
      branch_id: item.branch_id
    });
  }

  if (sale.customer_id) {
    const paidForSale = await reverseSaleAllocations(saleId);
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .select('balance, total_purchases')
      .eq('id', sale.customer_id)
      .single();
    if (!custErr && customer) {
      await supabase
        .from('customers')
        .update({
          // Undo recordCustomerPurchase()'s full debit, then give back
          // whatever had already been paid toward it — net effect is
          // removing just the outstanding portion this sale contributed.
          balance: Math.max(Number(customer.balance) - Number(sale.total) + paidForSale, 0),
          total_purchases: Math.max(Number(customer.total_purchases) - Number(sale.total), 0)
        })
        .eq('id', sale.customer_id);
    }
    await supabase.from('sales').update({ paid_amount: 0, payment_status: 'unpaid' }).eq('id', saleId);
  }

  const { error } = await supabase.from('sales').update({ status: 'refunded' }).eq('id', saleId);
  if (error) throw error;
}

export async function markInvoicePrinted(saleId) {
  const { data: inv } = await supabase.from('invoices').select('printed_count').eq('sale_id', saleId).single();
  await supabase
    .from('invoices')
    .update({ printed_count: (inv?.printed_count || 0) + 1, last_printed_at: new Date().toISOString() })
    .eq('sale_id', saleId);
}
