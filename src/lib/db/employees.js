import { supabase } from '../supabase.js';

// ---------- Employees (master records) ----------

export async function listEmployees({ search = '' } = {}) {
  let query = supabase.from('employees').select('*').order('created_at', { ascending: false });
  if (search) query = query.ilike('name', `%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getEmployee(id) {
  const { data, error } = await supabase.from('employees').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createEmployee(payload) {
  const { data, error } = await supabase.from('employees').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateEmployee(id, payload) {
  const { data, error } = await supabase.from('employees').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteEmployee(id) {
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Per-branch commission overrides ----------
// An employee has one default_commission_percent (on the employees row).
// employee_branch_rates optionally overrides that percent for a specific branch.

export async function listEmployeeBranchRates(employeeId) {
  const { data, error } = await supabase
    .from('employee_branch_rates')
    .select('*, branches(name)')
    .eq('employee_id', employeeId);
  if (error) throw error;
  return data || [];
}

export async function upsertEmployeeBranchRate(employeeId, branchId, percent) {
  const { data, error } = await supabase
    .from('employee_branch_rates')
    .upsert(
      { employee_id: employeeId, branch_id: branchId, commission_percent: percent },
      { onConflict: 'employee_id,branch_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEmployeeBranchRate(id) {
  const { error } = await supabase.from('employee_branch_rates').delete().eq('id', id);
  if (error) throw error;
}

// Resolves the commission percent to use for an employee at a specific branch:
// a per-branch override if one exists, otherwise the employee's default rate.
export async function getEffectiveCommissionRate(employeeId, branchId) {
  if (branchId) {
    const { data } = await supabase
      .from('employee_branch_rates')
      .select('commission_percent')
      .eq('employee_id', employeeId)
      .eq('branch_id', branchId)
      .maybeSingle();
    if (data) return Number(data.commission_percent);
  }
  const { data: emp, error } = await supabase
    .from('employees')
    .select('default_commission_percent')
    .eq('id', employeeId)
    .single();
  if (error) throw error;
  return Number(emp?.default_commission_percent || 0);
}

// ---------- Employee ledger: deductions / advances / commissions ----------

export async function listEmployeeTransactions({ employeeId, from = null, to = null } = {}) {
  let query = supabase
    .from('employee_transactions')
    .select('*, branches(name)')
    .eq('employee_id', employeeId)
    .order('txn_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (from) query = query.gte('txn_date', from);
  if (to) query = query.lte('txn_date', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createEmployeeTransaction(payload) {
  const { data, error } = await supabase.from('employee_transactions').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function deleteEmployeeTransaction(id) {
  const { error } = await supabase.from('employee_transactions').delete().eq('id', id);
  if (error) throw error;
}

// Aggregated totals per employee for a given period (used by the Employees tab).
// branchId, if given, only counts commissions tied to that branch (deductions
// and manual advances are treated as global regardless of branch).
export async function employeesSummary({ from = null, to = null, branchId = null } = {}) {
  const employees = await listEmployees({});

  let txnQuery = supabase.from('employee_transactions').select('*');
  if (from) txnQuery = txnQuery.gte('txn_date', from);
  if (to) txnQuery = txnQuery.lte('txn_date', to);
  const { data: txns, error } = await txnQuery;
  if (error) throw error;

  return employees.map((emp) => {
    const empTxns = (txns || []).filter(
      (tx) => tx.employee_id === emp.id && (!branchId || !tx.branch_id || tx.branch_id === branchId)
    );
    const commissions = empTxns
      .filter((tx) => tx.type === 'commission_manual' || tx.type === 'commission_auto')
      .reduce((s, tx) => s + Number(tx.amount), 0);
    const deductions = empTxns.filter((tx) => tx.type === 'deduction').reduce((s, tx) => s + Number(tx.amount), 0);
    const advances = empTxns.filter((tx) => tx.type === 'advance').reduce((s, tx) => s + Number(tx.amount), 0);
    const salary = Number(emp.salary || 0);
    const net = salary + commissions - deductions - advances;
    return { ...emp, commissions, deductions, advances, net };
  });
}

// ---------- Integration with the cashier / sales flow ----------

// Records which employee performed the service for a completed sale.
// Called from the cashier screen right after a sale is created successfully.
export async function linkSaleToEmployee(saleId, employeeId) {
  const { error } = await supabase.from('sales').update({ employee_id: employeeId }).eq('id', saleId);
  if (error) throw error;
}

// Automatically computes and logs the employee's commission for a sale,
// based on the sale's final total (after discount and tax) and the
// employee's effective commission percent for that branch.
export async function recordAutoCommission({ employeeId, branchId, saleId, saleTotal, createdBy }) {
  const rate = await getEffectiveCommissionRate(employeeId, branchId);
  if (!rate) return null;
  const amount = (Number(saleTotal) * rate) / 100;
  if (amount <= 0) return null;
  return createEmployeeTransaction({
    employee_id: employeeId,
    type: 'commission_auto',
    amount,
    description: 'عمولة تلقائية عن فاتورة بيع',
    branch_id: branchId,
    sale_id: saleId,
    txn_date: new Date().toISOString().slice(0, 10),
    created_by: createdBy
  });
}
