import { supabase } from '../supabase.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export async function salesReport({ from, to, branchId = null }) {
  let query = supabase
    .from('sales')
    .select('*')
    .gte('created_at', from)
    .lte('created_at', to)
    .eq('status', 'completed');
  if (branchId) query = query.eq('branch_id', branchId);
  const { data: sales, error } = await query;
  if (error) throw error;

  const grossSales = sales.reduce((s, x) => s + Number(x.total), 0);
  let returns = [];
  let returnsError = null;
  let returnsQuery = supabase.from('sale_returns').select('*').gte('created_at', from).lte('created_at', to).eq('status', 'completed');
  if (branchId) returnsQuery = returnsQuery.eq('branch_id', branchId);
  ({ data: returns, error: returnsError } = await returnsQuery);
  if (returnsError) throw returnsError;
  const totalReturns = (returns || []).reduce((s, x) => s + Number(x.total), 0);
  const totalSales = grossSales - totalReturns;
  const totalOrders = sales.length;
  const avgOrder = totalOrders ? totalSales / totalOrders : 0;

  const byDay = {};
  for (const s of sales) {
    const day = s.created_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + Number(s.total);
  }
  for (const item of returns || []) {
    const day = item.created_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) - Number(item.total);
  }

  return {
    totalSales,
    grossSales,
    totalReturns,
    netSales: totalSales,
    totalOrders,
    avgOrder,
    byDay: Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])),
    sales, returns
  };
}

export async function dailyReport(date = new Date(), branchId = null) {
  return salesReport({ from: startOfDay(date), to: endOfDay(date), branchId });
}

export async function monthlyReport(year, month, branchId = null) {
  const from = new Date(year, month, 1).toISOString();
  const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
  return salesReport({ from, to, branchId });
}

export async function topProducts({ from, to, limit = 10, branchId = null }) {
  let salesQuery = supabase
    .from('sales')
    .select('id')
    .gte('created_at', from)
    .lte('created_at', to)
    .eq('status', 'completed');
  if (branchId) salesQuery = salesQuery.eq('branch_id', branchId);
  const { data: sales, error: sErr } = await salesQuery;
  if (sErr) throw sErr;
  const saleIds = sales.map((s) => s.id);
  if (!saleIds.length) return [];

  const { data: items, error } = await supabase
    .from('sale_items')
    .select('product_name, quantity, total')
    .in('sale_id', saleIds);
  if (error) throw error;

  const grouped = {};
  for (const it of items) {
    if (!grouped[it.product_name]) grouped[it.product_name] = { name: it.product_name, qty: 0, total: 0 };
    grouped[it.product_name].qty += Number(it.quantity);
    grouped[it.product_name].total += Number(it.total);
  }
  return Object.values(grouped).sort((a, b) => b.qty - a.qty).slice(0, limit);
}
