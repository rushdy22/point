import { supabase } from '../supabase.js';
import { getSupplierLedgerSummary } from './suppliers.js';
import { repairFinancialSummary } from './repairs.js';

// =====================================================================
// Unified finance statement: sales + maintenance + manual entries are
// calculated together, while supplier payments remain balance settlements
// and repair payments remain cash collections rather than extra profit.
// =====================================================================

// Period metrics: how much came in and went out between `from` and `to`.
// - totalSales: revenue from completed sales in the period.
// - totalExpenses: cost of the goods actually sold (COGS) from those sales.
//   Supplier payments are not included: they settle a supplier balance and
//   must never be counted as an expense a second time.
// - netProfit: totalSales − totalExpenses.
export async function financeSummary({ from, to, branchId = null }) {
  let salesQuery = supabase
    .from('sales')
    .select('id, total, created_at')
    .eq('status', 'completed')
    .gte('created_at', from)
    .lte('created_at', to);
  if (branchId) salesQuery = salesQuery.eq('branch_id', branchId);
  const { data: sales, error: salesErr } = await salesQuery;
  if (salesErr) throw salesErr;

  const grossSales = (sales || []).reduce((sum, s) => sum + Number(s.total || 0), 0);
  const saleIds = (sales || []).map((s) => s.id);

  let returnsQuery = supabase.from('sale_returns').select('*').eq('status', 'completed').gte('created_at', from).lte('created_at', to);
  if (branchId) returnsQuery = returnsQuery.eq('branch_id', branchId);
  const { data: returnRows, error: returnsErr } = await returnsQuery;
  if (returnsErr) throw returnsErr;
  const activeSaleIds = new Set(saleIds);
  const returns = (returnRows || []).filter((item) => activeSaleIds.has(item.original_sale_id));
  const totalReturns = returns.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalSales = grossSales - totalReturns;

  let costOfGoodsSold = 0;
  if (saleIds.length) {
    const { data: items, error: itemsErr } = await supabase
      .from('sale_items')
      .select('quantity, unit_cost, sale_id')
      .in('sale_id', saleIds);
    if (itemsErr) throw itemsErr;
    costOfGoodsSold = (items || []).reduce((sum, i) => sum + Number(i.unit_cost || 0) * Number(i.quantity || 0), 0);
  }

  let cogsReversal = 0;
  if (returns.length) {
    const { data: returnItems, error: returnItemsErr } = await supabase.from('sale_return_items').select('unit_cost, quantity').in('return_id', returns.map((item) => item.id));
    if (returnItemsErr) throw returnItemsErr;
    cogsReversal = (returnItems || []).reduce((sum, item) => sum + Number(item.unit_cost || 0) * Number(item.quantity || 0), 0);
  }
  const netCogs = Math.max(costOfGoodsSold - cogsReversal, 0);

  const repair = await repairFinancialSummary({ from, to, branchId });

  // Manual transactions are the only entries that belong to the manual
  // accounts ledger. Repair payments are already represented by the repair
  // module and must not be counted again as profit/income.
  let txnQuery = supabase
    .from('transactions')
    .select('type, amount, category, txn_date')
    .gte('txn_date', from.slice(0, 10))
    .lte('txn_date', to.slice(0, 10));
  if (branchId) txnQuery = txnQuery.eq('branch_id', branchId);
  const { data: txns, error: txnErr } = await txnQuery;
  if (txnErr) throw txnErr;
  const manualRows = (txns || []).filter((x) => !['repair_revenue', 'repair_deposit'].includes(x.category));
  const manualIncome = manualRows.filter((x) => x.type === 'income').reduce((s, x) => s + Number(x.amount || 0), 0);
  const manualExpense = manualRows.filter((x) => x.type === 'expense').reduce((s, x) => s + Number(x.amount || 0), 0);

  // Operational revenue excludes manual ledger income so the dashboard can
  // show the real daily business revenue separately from manual entries.
  const operatingRevenue = totalSales + repair.repairRevenue;
  const totalRevenue = operatingRevenue + manualIncome;
  const totalExpenses = netCogs + repair.materialCost + manualExpense;
  const netProfit = operatingRevenue + manualIncome - netCogs - repair.materialCost - manualExpense;

  return {
    totalSales,
    operatingRevenue,
    grossSales,
    totalReturns,
    netSales: totalSales,
    costOfGoodsSold: netCogs,
    cogsReversal,
    repairCount: repair.repairCount,
    repairPartsRevenue: repair.partsRevenue,
    repairLabor: repair.laborTotal,
    repairDiscounts: repair.discounts,
    repairRevenue: repair.repairRevenue,
    repairMaterialsCost: repair.materialCost,
    repairNetProfit: repair.repairNetProfit,
    repairPaymentsCollected: repair.paymentsCollected,
    manualIncome,
    manualExpense,
    totalRevenue,
    totalExpenses,
    netProfit,
    salesCount: (sales || []).length
  };
}

// Snapshot metrics: the store's current state right now (not tied to a
// date range) — what's on the shelf and what's owed to suppliers today.
export async function financeSnapshot({ branchId = null } = {}) {
  let prodQuery = supabase
    .from('products')
    .select('stock_quantity, cost')
    .eq('is_active', true);
  if (branchId) prodQuery = prodQuery.eq('branch_id', branchId);
  const { data: products, error: prodErr } = await prodQuery;
  if (prodErr) throw prodErr;

  const inventoryValue = products.reduce((sum, p) => sum + Number(p.stock_quantity) * Number(p.cost), 0);

  let supQuery = supabase.from('suppliers').select('balance');
  if (branchId) supQuery = supQuery.eq('branch_id', branchId);
  const { data: suppliers, error: supErr } = await supQuery;
  if (supErr) throw supErr;
  const supplierOutstandingBalance = suppliers.reduce((sum, s) => sum + Number(s.balance), 0);

  return { inventoryValue, supplierOutstandingBalance };
}

export async function supplierBalancesSummary({ branchId = null } = {}) {
  let supQuery = supabase.from('suppliers').select('id, name, branch_id, branches(name)').order('name');
  if (branchId) supQuery = supQuery.eq('branch_id', branchId);
  const { data: suppliers, error: supErr } = await supQuery;
  if (supErr) throw supErr;
  if (!suppliers.length) return [];
  return Promise.all(suppliers.map(async (s) => {
    const summary = await getSupplierLedgerSummary(s.id);
    return { id: s.id, name: s.name, branchName: s.branches?.name || null, totalInvoices: summary.purchases, totalReturns: summary.returns, totalPaid: summary.totalPaid, remaining: summary.balance };
  }));
}
