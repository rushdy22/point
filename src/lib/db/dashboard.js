import { supabase } from '../supabase.js';

export async function dashboardStats({ from, to, branchId = null }) {
  let query = supabase
    .from('sales')
    .select('id, total, payment_method, status, created_at')
    .gte('created_at', from)
    .lte('created_at', to)
    .eq('status', 'completed');
  if (branchId) query = query.eq('branch_id', branchId);
  const { data: sales, error } = await query;
  if (error) throw error;

  const totalInvoices = sales.length;
  const totalRevenue = sales.reduce((s, x) => s + Number(x.total), 0);
  const cashCount = sales.filter((s) => s.payment_method === 'cash').length;
  const instapayCount = sales.filter((s) => s.payment_method === 'instapay').length;
  const walletCount = sales.filter((s) => s.payment_method === 'wallet').length;
  const visaCount = sales.filter((s) => s.payment_method === 'visa' || s.payment_method === 'card').length;
  const paymentTotals = sales.reduce((m, s) => { const k = (s.payment_method === 'card' ? 'visa' : s.payment_method) || 'other'; m[k] = (m[k] || 0) + Number(s.total || 0); return m; }, {});

  return {
    totalInvoices,
    totalRevenue,
    totalSales: totalRevenue,
    cashCount,
    instapayCount,
    walletCount,
    visaCount,
    paymentTotals
  };
}

// Per-cashier breakdown: how much each user sold in the given range.
export async function salesByCashier({ from, to, branchId = null }) {
  let query = supabase
    .from('sales')
    .select('total, cashier_id, profiles(full_name)')
    .gte('created_at', from)
    .lte('created_at', to)
    .eq('status', 'completed');
  if (branchId) query = query.eq('branch_id', branchId);
  const { data: sales, error } = await query;
  if (error) throw error;

  const grouped = {};
  for (const s of sales) {
    const key = s.cashier_id || 'unknown';
    if (!grouped[key]) {
      grouped[key] = { cashierId: key, name: s.profiles?.full_name || 'غير معروف', invoices: 0, total: 0 };
    }
    grouped[key].invoices += 1;
    grouped[key].total += Number(s.total);
  }

  return Object.values(grouped).sort((a, b) => b.total - a.total);
}

// Per-branch breakdown for the admin dashboard/comparison view.
export async function salesByBranch({ from, to }) {
  const { data: sales, error } = await supabase
    .from('sales')
    .select('total, branch_id, branches(name)')
    .gte('created_at', from)
    .lte('created_at', to)
    .eq('status', 'completed');
  if (error) throw error;

  const grouped = {};
  for (const s of sales) {
    const key = s.branch_id;
    if (!grouped[key]) {
      grouped[key] = { branchId: key, name: s.branches?.name || 'غير معروف', invoices: 0, total: 0 };
    }
    grouped[key].invoices += 1;
    grouped[key].total += Number(s.total);
  }
  return Object.values(grouped).sort((a, b) => b.total - a.total);
}
