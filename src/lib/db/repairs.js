import { supabase } from '../supabase.js';
import { findOrCreateCustomer } from './customers.js';

const REPAIR_SELECT = '*, customers(name,phone), technicians(name,phone), profiles(full_name), original_repair:original_repair_id(repair_number)';

function requireElectronBusiness() {
  if (!window.electronAPI?.business?.execute) throw new Error('REPAIR_REQUIRES_ELECTRON_TRANSACTION');
  return window.electronAPI.business.execute;
}

async function runBusiness(action, payload) {
  const execute = requireElectronBusiness();
  const result = await execute(action, payload);
  if (result?.error) throw new Error(result.error.message);
  return result.data;
}

export async function createRepairOrder({
  branchId, customerName, customerPhone, customerId = null,
  deviceType, deviceModel, serialNumber, reportedIssue, deviceCondition,
  accessoriesReceived, technicianId, expectedDeliveryDate, notes,
  depositAmount = 0, paymentMethod = 'cash', createdBy
}) {
  let customer = null;
  if (customerId) customer = { id: customerId };
  else if (customerPhone) customer = await findOrCreateCustomer({ name: customerName, phone: customerPhone, branchId, vehicleType: deviceType, vehicleNumber: serialNumber });

  return runBusiness('repair:create', {
    branchId, customerId: customer?.id || null, customerName, customerPhone,
    deviceType, deviceModel, serialNumber, reportedIssue, deviceCondition,
    accessoriesReceived, technicianId: technicianId || null, expectedDeliveryDate: expectedDeliveryDate || null,
    notes, depositAmount, paymentMethod, createdBy
  });
}

export async function startRepairInspection({ repairId, branchId, technicianId, notes, userId }) {
  return runBusiness('repair:start-inspection', { repairId, branchId, technicianId, notes, userId });
}

export async function submitRepairDiagnosis({ repairId, branchId, diagnosis, requiredPartsNotes, laborCost, discount, items = [], userId }) {
  return runBusiness('repair:submit-diagnosis', { repairId, branchId, diagnosis, requiredPartsNotes, laborCost, discount, items, userId });
}

export async function recordRepairApproval({ repairId, branchId, approved, notes, userId }) {
  return runBusiness('repair:record-approval', { repairId, branchId, approved, notes, userId });
}

export async function useRepairParts({ repairId, branchId, items, userId }) {
  return runBusiness('repair:use-parts', { repairId, branchId, items, userId });
}

export async function markRepairReady({ repairId, branchId, notes, userId }) {
  return runBusiness('repair:mark-ready', { repairId, branchId, notes, userId });
}

export async function addRepairPayment({ repairId, branchId, amount, paymentMethod, paymentType, notes, userId }) {
  return runBusiness('repair:add-payment', { repairId, branchId, amount, paymentMethod, paymentType, notes, userId });
}

export async function deliverRepair({ repairId, branchId, warrantyDays, notes, userId }) {
  return runBusiness('repair:deliver', { repairId, branchId, warrantyDays, notes, userId });
}

export async function cancelRepairOrder({ repairId, branchId, reason, userId }) {
  return runBusiness('repair:cancel', { repairId, branchId, reason, userId });
}

export async function createWarrantyClaim({ originalRepairId, branchId, reportedIssue, deviceCondition, accessoriesReceived, technicianId, notes, createdBy }) {
  return runBusiness('repair:warranty-claim', { originalRepairId, branchId, reportedIssue, deviceCondition, accessoriesReceived, technicianId, notes, createdBy });
}



export async function repairFinancialSummary({ from = null, to = null, branchId = null } = {}) {
  let query = supabase
    .from('repair_orders')
    .select('id, total, parts_cost, labor_cost, discount, paid_amount, created_at, status, deleted_at')
    .eq('status', 'delivered')
    .order('created_at', { ascending: false });
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data: repairs, error } = await query;
  if (error) throw error;

  const rows = (repairs || []).filter((r) => !r.deleted_at);
  const ids = rows.map((r) => r.id);
  let parts = [];
  if (ids.length) {
    const { data, error: partsErr } = await supabase
      .from('repair_parts_used')
      .select('repair_id, quantity, unit_cost, unit_price, total, stock_deducted, deleted_at')
      .in('repair_id', ids);
    if (partsErr) throw partsErr;
    parts = (data || []).filter((p) => !p.deleted_at && (p.stock_deducted === true || p.stock_deducted === 1));
  }

  const partsRevenue = parts.reduce((sum, p) => sum + Number(p.total || 0), 0);
  const materialCost = parts.reduce((sum, p) => sum + Number(p.unit_cost || 0) * Number(p.quantity || 0), 0);
  const laborTotal = rows.reduce((sum, r) => sum + Number(r.labor_cost || 0), 0);
  const discounts = rows.reduce((sum, r) => sum + Number(r.discount || 0), 0);
  const repairRevenue = Math.max(partsRevenue + laborTotal - discounts, 0);
  const repairNetProfit = repairRevenue - materialCost;

  let paymentsQuery = supabase.from('repair_payments').select('amount, created_at').order('created_at', { ascending: false });
  if (from) paymentsQuery = paymentsQuery.gte('created_at', from);
  if (to) paymentsQuery = paymentsQuery.lte('created_at', to);
  if (branchId) paymentsQuery = paymentsQuery.eq('branch_id', branchId);
  const { data: payments, error: paymentsErr } = await paymentsQuery;
  if (paymentsErr) throw paymentsErr;
  const paymentsCollected = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    repairCount: rows.length,
    partsRevenue,
    materialCost,
    laborTotal,
    discounts,
    repairRevenue,
    repairNetProfit,
    paymentsCollected
  };
}

export async function listRepairOrders({ branchId = null, statuses = null } = {}) {
  let query = supabase.from('repair_orders').select(REPAIR_SELECT).order('created_at', { ascending: false });
  if (branchId) query = query.eq('branch_id', branchId);
  if (statuses && statuses.length) {
    query = statuses.length === 1 ? query.eq('status', statuses[0]) : query.in('status', statuses);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getRepairOrder(repairId) {
  const { data, error } = await supabase
    .from('repair_orders')
    .select(`${REPAIR_SELECT}, repair_status_history(*), repair_parts_used(*), repair_payments(*), repair_photos(*)`)
    .eq('id', repairId)
    .single();
  if (error) throw error;
  return data;
}

// Device history by serial number — every repair this exact device has ever
// had, across customers/technicians/payments/warranty claims (spec section 7).
export async function getDeviceHistoryBySerial(serialNumber, branchId = null) {
  if (!serialNumber) return [];
  let query = supabase.from('repair_orders').select(`${REPAIR_SELECT}, repair_payments(*)`).eq('serial_number', serialNumber).order('created_at', { ascending: false });
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listOverdueRepairs({ branchId = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  // The local query shim has no NOT/IS operators — express "not delivered,
  // not cancelled" as two AND'd neq() calls instead, and filter the
  // null-vs-set expected_delivery_date check client-side.
  let query = supabase
    .from('repair_orders')
    .select(REPAIR_SELECT)
    .neq('status', 'delivered')
    .neq('status', 'cancelled')
    .order('expected_delivery_date', { ascending: true });
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter((r) => r.expected_delivery_date && r.expected_delivery_date < today);
}

export async function listWarrantiedRepairs({ branchId = null } = {}) {
  let query = supabase
    .from('repair_orders')
    .select(REPAIR_SELECT)
    .eq('status', 'delivered')
    .order('warranty_expiry_date', { ascending: false });
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter((r) => !!r.warranty_expiry_date);
}

export function isUnderWarranty(repair) {
  if (!repair?.warranty_expiry_date) return false;
  return new Date().toISOString().slice(0, 10) <= repair.warranty_expiry_date;
}

/* -------------------- Technicians -------------------- */

export async function listTechnicians({ branchId = null, activeOnly = false } = {}) {
  let query = supabase.from('technicians').select('*, repair_orders(count)').order('name', { ascending: true });
  if (branchId) query = query.eq('branch_id', branchId);
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createTechnician({ name, phone, specialty, commissionPercent = 0, branchId, notes }) {
  const { data, error } = await supabase
    .from('technicians')
    .insert({ name, phone: phone || null, specialty: specialty || null, commission_percent: commissionPercent, branch_id: branchId, notes: notes || null, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTechnician(technicianId, patch) {
  const { data, error } = await supabase.from('technicians').update(patch).eq('id', technicianId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTechnician(technicianId) {
  const { error } = await supabase.from('technicians').delete().eq('id', technicianId);
  if (error) throw error;
}

// Performance summary for a single technician: assigned/completed counts,
// total repair value, and commission earned on delivered repairs (spec 9).
export async function getTechnicianPerformance(technicianId, branchId = null, from = null, to = null) {
  let query = supabase.from('repair_orders').select('status, total').eq('technician_id', technicianId);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const assigned = rows.length;
  const completed = rows.filter((r) => r.status === 'delivered').length;
  const totalValue = rows.filter((r) => r.status === 'delivered').reduce((sum, r) => sum + Number(r.total || 0), 0);
  return { assigned, completed, totalValue };
}

/* -------------------- Parts / photos / notifications -------------------- */

export async function addRepairPhoto({ repairId, branchId, stage, filePath, caption, createdBy }) {
  const { data, error } = await supabase
    .from('repair_photos')
    .insert({ repair_id: repairId, branch_id: branchId, stage, file_path: filePath, caption: caption || null, created_by: createdBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRepairPhoto(photoId) {
  const { error } = await supabase.from('repair_photos').delete().eq('id', photoId);
  if (error) throw error;
}

export async function logRepairNotification({ repairId, branchId, eventType, channel = 'whatsapp', message, sentBy }) {
  const { data, error } = await supabase
    .from('repair_notifications')
    .insert({ repair_id: repairId, branch_id: branchId, event_type: eventType, channel, message: message || null, sent_by: sentBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}
