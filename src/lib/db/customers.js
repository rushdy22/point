import { supabase } from '../supabase.js';

export async function listCustomers({ search = '', branchId = null } = {}) {
  let query = supabase.from('customers').select('*, branches(name)').order('last_visit_at', { ascending: false, nullsFirst: false });
  if (branchId) query = query.eq('branch_id', branchId);
  if (search) query = query.or(`name.ilike.${search}%,phone.ilike.${search}%,vehicle_type.ilike.${search}%,vehicle_number.ilike.${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createCustomer(payload) {
  const { data, error } = await supabase.from('customers').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id, payload) {
  const { data, error } = await supabase.from('customers').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCustomer(id) {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
}

// Embeds each sale's line items so the customer statement can show every
// invoice independently (invoice header + its own items table) without an
// extra round-trip per invoice.
export async function getCustomerPurchaseHistory(customerId) {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const sales = data || [];
  if (!sales.length) return sales;

  // Fetch line items explicitly. The Electron offline query engine does not
  // support one-to-many embeds, so `sale_items(*)` would otherwise arrive
  // empty even though the invoice totals were present.
  const { data: items, error: itemsError } = await supabase
    .from('sale_items')
    .select('*')
    .in('sale_id', sales.map((sale) => sale.id));
  if (itemsError) throw itemsError;
  const itemsBySale = (items || []).reduce((grouped, item) => {
    (grouped[item.sale_id] ||= []).push(item);
    return grouped;
  }, {});
  return sales.map((sale) => ({ ...sale, sale_items: itemsBySale[sale.id] || [] }));
}

// Given a customer's purchase history (as returned by getCustomerPurchaseHistory,
// which is already ordered newest-first), finds the most recent price this
// customer paid for a given product. Pure lookup over already-fetched data —
// no extra query — so callers should fetch the history once (e.g. when the
// customer is selected) and reuse it for every product added afterwards.
export function findLastPurchasedPrice(history, productId) {
  for (const sale of history || []) {
    if (sale.status === 'cancelled') continue;
    const item = (sale.sale_items || []).find((i) => i.product_id === productId);
    if (item) return { price: Number(item.unit_price), date: sale.created_at };
  }
  return null;
}

export async function findCustomerByPhone(phone, branchId) {
  if (!phone) return null;
  let query = supabase.from('customers').select('*').eq('phone', phone);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

// Called during checkout when a phone number is provided: reuses an
// existing customer (within the same branch) by phone, or creates a new one.
export async function findOrCreateCustomer({ name, phone, branchId, vehicleType = null, vehicleNumber = null }) {
  if (!phone) return null;
  const existing = await findCustomerByPhone(phone, branchId);
  if (existing) {
    const patch = {};
    if (name && name !== existing.name) patch.name = name;
    if (vehicleType !== undefined && vehicleType !== null && vehicleType !== '') patch.vehicle_type = vehicleType;
    if (vehicleNumber !== undefined && vehicleNumber !== null && vehicleNumber !== '') patch.vehicle_number = vehicleNumber;
    if (Object.keys(patch).length) {
      const { data, error } = await supabase.from('customers').update(patch).eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    }
    return existing;
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({ name: name || phone, phone, vehicle_type: vehicleType || null, vehicle_number: vehicleNumber || null, branch_id: branchId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Updates running totals after a completed sale.
export async function recordCustomerPurchase(customerId, amount) {
  const { data: customer, error: getErr } = await supabase
    .from('customers')
    .select('total_purchases, balance, visits_count')
    .eq('id', customerId)
    .single();
  if (getErr) throw getErr;

  const { error } = await supabase
    .from('customers')
    .update({
      total_purchases: Number(customer.total_purchases) + Number(amount),
      balance: Number(customer.balance || 0) + Number(amount),
      visits_count: Number(customer.visits_count) + 1,
      last_visit_at: new Date().toISOString()
    })
    .eq('id', customerId);
  if (error) throw error;
}

export function whatsappLink(phone, message = '') {
  let digits = String(phone || '').replace(/\D/g, '');

  // WhatsApp's click-to-chat URL requires a country code. The POS uses
  // Egyptian local mobile numbers (01xxxxxxxxx), so convert those to 20....
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `20${digits.slice(1)}`;

  const params = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${params}`;
}
