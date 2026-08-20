import { t } from '../i18n/index.js';
import { financeSummary, financeSnapshot } from '../lib/db/finance.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { listTransactions, createTransaction, deleteTransaction } from '../lib/db/accounts.js';
import { paymentMethodLabel, paymentMethodOptions } from '../lib/paymentMethods.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listBranches } from '../lib/db/branches.js';
import { canManage } from '../lib/permissions.js';
import { renderDrawer } from './drawer.js';
import {
  employeesSummary,
  listEmployeeBranchRates,
  upsertEmployeeBranchRate,
  deleteEmployeeBranchRate,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  listEmployeeTransactions,
  createEmployeeTransaction,
  deleteEmployeeTransaction
} from '../lib/db/employees.js';

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmt(n) { return Number(n || 0).toFixed(2); }

const TXN_TYPE_LABEL = { deduction: 'خصم', advance: 'سلفة', commission_manual: 'عمولة يدوية', commission_auto: 'عمولة تلقائية (فاتورة)' };
const TXN_TYPE_BADGE = { deduction: 'badge-danger', advance: 'badge-warning', commission_manual: 'badge-success', commission_auto: 'badge-success' };

export async function renderFinance(container, profile, branchId) {
  let range = 'today';
  let customFrom = isoDate(new Date());
  let customTo = isoDate(new Date());
  let managementTab = 'transactions';
  let empRange = 'month';
  let empCustomFrom = isoDate(new Date());
  let empCustomTo = isoDate(new Date());
  let employeesData = [];
  let allBranches = [];
  let empSearch = '';
  const showBranchColumn = !branchId;

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  function getRangeDates() {
    const now = new Date();
    if (range === 'today') return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    if (range === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)).toISOString() };
    return { from: new Date(customFrom + 'T00:00:00').toISOString(), to: new Date(customTo + 'T23:59:59').toISOString() };
  }

  function getEmpRangeDates() {
    const now = new Date();
    if (empRange === 'today') return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    if (empRange === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)).toISOString() };
    return { from: new Date(empCustomFrom + 'T00:00:00').toISOString(), to: new Date(empCustomTo + 'T23:59:59').toISOString() };
  }

  async function load() {
    const { from, to } = getRangeDates();
    const [summary, snapshot] = await Promise.all([financeSummary({ from, to, branchId }), financeSnapshot({ branchId })]);
    draw(summary, snapshot);
  }

  function draw(summary, snapshot) {
    const loss = summary.netProfit < 0;
    container.innerHTML = `
      <div class="card card-pad" style="margin-bottom:14px;">
        <div class="flex justify-between items-center gap-10" style="flex-wrap:wrap;">
          <div>
            <h3 style="margin-bottom:3px;">المالية الموحدة</h3>
            <div class="text-muted" style="font-size:11px;">المنتجات + الصيانة + العمالة + الحركات اليدوية في كشف مالي واحد</div>
          </div>
          <div class="flex gap-5" style="align-items:center;">
            <button class="btn btn-sm ${range === 'today' ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 9px; font-size:11px;" data-range="today">اليوم</button>
            <button class="btn btn-sm ${range === 'month' ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 9px; font-size:11px;" data-range="month">الشهر</button>
            <button class="btn btn-sm ${range === 'custom' ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 9px; font-size:11px;" data-range="custom">فترة محددة</button>
            ${range === 'custom' ? `<input type="date" class="input" id="finance-from" value="${customFrom}" style="padding:4px 7px; height:30px; font-size:11px; width:125px;" /><input type="date" class="input" id="finance-to" value="${customTo}" style="padding:4px 7px; height:30px; font-size:11px; width:125px;" /><button class="btn btn-sm btn-primary" id="finance-apply" style="padding:4px 9px; font-size:11px;">تطبيق</button>` : ''}
          </div>
        </div>
      </div>

      <div class="flex gap-12" style="flex-wrap:wrap; margin-bottom:14px;">
        <div class="stat-card" style="flex:1; min-width:190px;"><div class="stat-icon">💰</div><div class="stat-label">توتال إجمالي إيرادات اليوم</div><div class="stat-value mono-num">${fmt(summary.operatingRevenue)}</div><div class="text-muted" style="font-size:10px; margin-top:3px;">المنتجات + الصيانة + العمالة</div></div>
        <div class="stat-card" style="flex:1; min-width:190px;"><div class="stat-icon">📦</div><div class="stat-label">تكلفة المنتجات للبيع + منتجات الصيانة</div><div class="stat-value mono-num">${fmt(summary.costOfGoodsSold + summary.repairMaterialsCost)}</div></div>
        <div class="stat-card" style="flex:1; min-width:190px;"><div class="stat-icon">🧾</div><div class="stat-label">المصروفات اليدوية / الإيرادات اليدوية</div><div class="stat-value mono-num">${fmt(summary.manualIncome - summary.manualExpense)}</div><div class="text-muted" style="font-size:10px; margin-top:3px;">إيراد +${fmt(summary.manualIncome)} / مصروف -${fmt(summary.manualExpense)}</div></div>
        <div class="stat-card" style="flex:1; min-width:190px; background:${loss ? 'var(--color-danger-light)' : 'var(--color-success-light)'};"><div class="stat-icon">${loss ? '📉' : '📈'}</div><div class="stat-label">صافي الربح</div><div class="stat-value mono-num" style="color:${loss ? 'var(--color-danger)' : 'var(--color-success)'};">${fmt(summary.netProfit)}</div><div class="text-muted" style="font-size:10px; margin-top:3px;">إيرادات + اليدوي − تكلفة المنتجات − تكلفة الصيانة − المصروفات</div></div>
      </div>

      <div id="finance-management"></div>

      <div class="flex gap-12" style="flex-wrap:wrap; margin-top:14px;">
        <div class="stat-card" style="flex:1; min-width:220px;"><div class="stat-icon">📦</div><div class="stat-label">قيمة المخزون الحالية</div><div class="stat-value mono-num">${fmt(snapshot.inventoryValue)}</div></div>
        <div class="stat-card" style="flex:1; min-width:220px;"><div class="stat-icon">🏭</div><div class="stat-label">مستحقات الموردين الحالية</div><div class="stat-value mono-num">${fmt(snapshot.supplierOutstandingBalance)}</div></div>
      </div>
    `;

    container.querySelectorAll('[data-range]').forEach((btn) => btn.addEventListener('click', () => { range = btn.dataset.range; load(); }));
    const apply = container.querySelector('#finance-apply');
    if (apply) apply.addEventListener('click', () => { customFrom = container.querySelector('#finance-from').value; customTo = container.querySelector('#finance-to').value; load(); });
    drawManagement();
  }

  function drawManagement() {
    const host = container.querySelector('#finance-management');
    if (!host) return;
    host.innerHTML = `
      <div class="card card-pad">
        <div class="flex justify-between items-center gap-10" style="flex-wrap:wrap; margin-bottom:12px;">
          <h3>💼 إدارة المالية</h3>
          <div class="flex gap-6" style="flex-wrap:wrap;">
            <button class="btn btn-sm btn-accent" id="finance-add-income">➕ إضافة إيراد</button>
            <button class="btn btn-sm btn-ghost" id="finance-add-expense">➖ إضافة مصروف</button>
            ${canManage(profile.role) ? `<button class="btn btn-sm ${managementTab === 'employees' ? 'btn-primary' : 'btn-ghost'}" data-management-tab="employees">👥 الموظفين</button><button class="btn btn-sm ${managementTab === 'drawer' ? 'btn-primary' : 'btn-ghost'}" data-management-tab="drawer">🗄️ درج الكاشير</button>` : ''}
            <button class="btn btn-sm ${managementTab === 'transactions' ? 'btn-primary' : 'btn-ghost'}" data-management-tab="transactions">🧾 الحركات اليدوية</button>
          </div>
        </div>
        <div id="finance-management-body"></div>
      </div>
    `;
    host.querySelector('#finance-add-income').addEventListener('click', () => openTxnModal('income'));
    host.querySelector('#finance-add-expense').addEventListener('click', () => openTxnModal('expense'));
    host.querySelectorAll('[data-management-tab]').forEach((btn) => btn.addEventListener('click', () => { managementTab = btn.dataset.managementTab; drawManagement(); }));
    const body = host.querySelector('#finance-management-body');
    if (managementTab === 'employees' && canManage(profile.role)) loadEmployeesTab(body);
    else if (managementTab === 'drawer' && canManage(profile.role)) renderDrawer(body, profile, branchId);
    else loadTransactionsTab(body);
  }

  async function loadTransactionsTab(body) {
    body.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;
    const { from, to } = getRangeDates();
    let branches = [];
    const [txns] = await Promise.all([
      listTransactions({ from: from.slice(0, 10), to: to.slice(0, 10), branchId }),
      showBranchColumn ? listBranches({ onlyActive: true }).then((b) => { branches = b; }) : Promise.resolve()
    ]);
    const rows = (txns || []).filter((x) => !['repair_revenue', 'repair_deposit'].includes(x.category));
    body.innerHTML = `
      <div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th>${showBranchColumn ? '<th>الفرع</th>' : ''}<th>النوع</th><th>التصنيف</th><th>البيان</th><th>طريقة الدفع</th><th>المبلغ</th><th>الإجراءات</th></tr></thead><tbody>
      ${rows.map((tx) => `<tr><td class="mono-num">${tx.txn_date}</td>${showBranchColumn ? `<td>${tx.branches?.name || '—'}</td>` : ''}<td><span class="badge ${tx.type === 'income' ? 'badge-success' : 'badge-danger'}">${tx.type === 'income' ? 'إيراد' : 'مصروف'}</span></td><td>${tx.category || '—'}</td><td>${tx.description || '—'}</td><td>${paymentMethodLabel(tx.payment_method)}</td><td class="mono-num">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</td><td><button class="btn btn-icon" data-delete-txn="${tx.id}">🗑️</button></td></tr>`).join('')}
      </tbody></table>${rows.length === 0 ? `<div class="table-empty">لا توجد حركات يدوية في الفترة المحددة.</div>` : ''}</div>
    `;
    body.querySelectorAll('[data-delete-txn]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await confirmDialog(t('confirm_delete')))) return;
      try { await deleteTransaction(btn.dataset.deleteTxn); toast(t('success'), 'success'); loadTransactionsTab(body); } catch { toast(t('error_occurred'), 'error'); }
    }));
  }

  function openTxnModal(type) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box"><div class="modal-header"><h3>${type === 'income' ? 'إضافة إيراد' : 'إضافة مصروف'}</h3><button class="btn btn-icon" data-close>✕</button></div><div class="modal-body"><form id="finance-txn-form">
      ${showBranchColumn ? `<div class="field"><label>الفرع</label><select class="input" name="branch_id"><option value="">— اختر —</option>${(awaitBranches || []).map(() => '').join('')}</select></div>` : ''}
      <div class="field"><label>المبلغ</label><input class="input" type="number" step="0.01" min="0.01" name="amount" required /></div>
      <div class="field"><label>التصنيف</label><input class="input" name="category" /></div>
      <div class="field"><label>البيان</label><input class="input" name="description" /></div>
      <div class="field"><label>طريقة الدفع</label><select class="input" name="payment_method">${paymentMethodOptions()}</select></div>
      <div class="field"><label>التاريخ</label><input class="input" type="date" name="txn_date" value="${isoDate(new Date())}" required /></div>
    </form></div><div class="modal-footer"><button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="save-finance-txn">حفظ</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#save-finance-txn').addEventListener('click', async () => {
      const form = overlay.querySelector('#finance-txn-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      try {
        await createTransaction({ type, branch_id: showBranchColumn ? (fd.get('branch_id') || null) : branchId, amount: Number(fd.get('amount')), category: fd.get('category').trim() || null, description: fd.get('description').trim() || null, txn_date: fd.get('txn_date'), payment_method: fd.get('payment_method'), created_by: profile.id });
        toast(t('success'), 'success'); overlay.remove(); load();
      } catch { toast(t('error_occurred'), 'error'); }
    });
  }

  // Branch options are loaded lazily only when multi-branch mode is active.
  let awaitBranches = [];
  if (showBranchColumn) { try { awaitBranches = await listBranches({ onlyActive: true }); } catch { awaitBranches = []; } }

  async function loadEmployeesTab(body) {
    body.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;
    const { from, to } = getEmpRangeDates();
    [employeesData, allBranches] = await Promise.all([employeesSummary({ from, to, branchId }), listBranches({ onlyActive: true })]);
    drawEmployeesTab(body);
  }

  function drawEmployeesTab(body) {
    const filtered = employeesData.filter((e) => !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()));
    body.innerHTML = `<div class="flex justify-between items-center" style="margin-bottom:12px; flex-wrap:wrap; gap:10px;"><div class="flex gap-5"><button class="btn btn-sm ${empRange === 'month' ? 'btn-primary' : 'btn-ghost'}" data-emp-range="month">الشهر</button><button class="btn btn-sm ${empRange === 'today' ? 'btn-primary' : 'btn-ghost'}" data-emp-range="today">اليوم</button><button class="btn btn-sm ${empRange === 'custom' ? 'btn-primary' : 'btn-ghost'}" data-emp-range="custom">فترة محددة</button>${empRange === 'custom' ? `<input type="date" class="input" id="emp-from-date" value="${empCustomFrom}" style="padding:4px 7px;height:30px;font-size:11px;width:125px;"/><input type="date" class="input" id="emp-to-date" value="${empCustomTo}" style="padding:4px 7px;height:30px;font-size:11px;width:125px;"/><button class="btn btn-sm btn-primary" id="emp-apply">تطبيق</button>` : ''}</div><button class="btn btn-sm btn-primary" id="add-employee-btn">➕ إضافة موظف</button></div><div class="input-search" style="max-width:300px;margin-bottom:12px;"><input id="emp-search-input" placeholder="بحث" value="${empSearch}"/></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الاسم</th><th>الهاتف</th><th>الراتب</th><th>العمولات</th><th>الخصومات</th><th>السلف</th><th>الصافي</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>${filtered.map((e) => `<tr><td><strong>${e.name}</strong></td><td>${e.phone || '—'}</td><td class="mono-num">${fmt(e.salary)}</td><td class="mono-num" style="color:var(--color-success);">+${fmt(e.commissions)}</td><td class="mono-num" style="color:var(--color-danger);">-${fmt(e.deductions)}</td><td class="mono-num" style="color:var(--color-danger);">-${fmt(e.advances)}</td><td class="mono-num"><strong>${fmt(e.net)}</strong></td><td><span class="badge ${e.is_active ? 'badge-success' : 'badge-muted'}">${e.is_active ? 'نشط' : 'متوقف'}</span></td><td><button class="btn btn-icon" data-emp-edit="${e.id}">✏️</button><button class="btn btn-icon" data-emp-advance="${e.id}">💵</button><button class="btn btn-icon" data-emp-deduct="${e.id}">➖</button><button class="btn btn-icon" data-emp-commission="${e.id}">➕</button><button class="btn btn-icon" data-emp-ledger="${e.id}">🧾</button><button class="btn btn-icon" data-emp-delete="${e.id}">🗑️</button></td></tr>`).join('')}</tbody></table>${filtered.length === 0 ? '<div class="table-empty">لا توجد بيانات.</div>' : ''}</div>`;
    body.querySelectorAll('[data-emp-range]').forEach((b) => b.addEventListener('click', () => { empRange = b.dataset.empRange; loadEmployeesTab(body); }));
    body.querySelector('#emp-apply')?.addEventListener('click', () => { empCustomFrom = body.querySelector('#emp-from-date').value; empCustomTo = body.querySelector('#emp-to-date').value; loadEmployeesTab(body); });
    body.querySelector('#emp-search-input').addEventListener('input', (e) => { empSearch = e.target.value; drawEmployeesTab(body); });
    body.querySelector('#add-employee-btn').addEventListener('click', () => openEmployeeModal(null, body));
    body.querySelectorAll('[data-emp-edit]').forEach((b) => b.addEventListener('click', () => openEmployeeModal(employeesData.find((e) => e.id === b.dataset.empEdit), body)));
    body.querySelectorAll('[data-emp-advance]').forEach((b) => b.addEventListener('click', () => openTxnEmployeeModal('advance', b.dataset.empAdvance, body)));
    body.querySelectorAll('[data-emp-deduct]').forEach((b) => b.addEventListener('click', () => openTxnEmployeeModal('deduction', b.dataset.empDeduct, body)));
    body.querySelectorAll('[data-emp-commission]').forEach((b) => b.addEventListener('click', () => openTxnEmployeeModal('commission_manual', b.dataset.empCommission, body)));
    body.querySelectorAll('[data-emp-ledger]').forEach((b) => b.addEventListener('click', () => openLedgerModal(employeesData.find((e) => e.id === b.dataset.empLedger), body)));
    body.querySelectorAll('[data-emp-delete]').forEach((b) => b.addEventListener('click', () => handleDeleteEmployee(employeesData.find((e) => e.id === b.dataset.empDelete), body)));
  }

  async function handleDeleteEmployee(employee, body) {
    if (!employee) return;
    if (!(await confirmDialog(t('confirm_delete')))) return;
    try { await deleteEmployee(employee.id); toast(t('success'), 'success'); loadEmployeesTab(body); }
    catch (err) {
      if (!(err?.code === '23503' || /foreign key|violates|constraint/i.test(err?.message || ''))) { toast(t('error_occurred'), 'error'); return; }
      if (!(await confirmDialog('لا يمكن حذف هذا الموظف لأنه مرتبط بحركات سابقة. هل تريد إيقافه؟'))) return;
      try { await updateEmployee(employee.id, { is_active: false }); toast(t('success'), 'success'); loadEmployeesTab(body); } catch { toast(t('error_occurred'), 'error'); }
    }
  }

  function openEmployeeModal(employee, body) {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box"><div class="modal-header"><h3>${employee ? 'تعديل موظف' : 'إضافة موظف'}</h3><button class="btn btn-icon" data-close>✕</button></div><div class="modal-body"><form id="emp-form"><div class="field"><label>اسم الموظف</label><input class="input" name="name" required value="${employee?.name || ''}"/></div><div class="field"><label>رقم الهاتف</label><input class="input" name="phone" value="${employee?.phone || ''}"/></div><div class="flex gap-12"><div class="field" style="flex:1"><label>الراتب الأساسي</label><input class="input" type="number" step="0.01" min="0" name="salary" value="${employee?.salary ?? 0}"/></div><div class="field" style="flex:1"><label>نسبة العمولة %</label><input class="input" type="number" step="0.01" min="0" max="100" name="default_commission_percent" value="${employee?.default_commission_percent ?? 0}"/></div></div><div class="field"><label>الحالة</label><select class="input" name="is_active"><option value="true" ${employee?.is_active !== false ? 'selected' : ''}>نشط</option><option value="false" ${employee?.is_active === false ? 'selected' : ''}>متوقف</option></select></div><div class="field"><label>ملاحظات</label><input class="input" name="notes" value="${employee?.notes || ''}"/></div></form>${employee ? `<div style="margin-top:16px;border-top:1px solid var(--color-border);padding-top:12px;"><h4>نسب الفروع الخاصة</h4><div id="branch-rates-list"></div><div class="flex gap-8" style="margin-top:8px;"><select class="input" id="new-rate-branch" style="flex:1">${allBranches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}</select><input class="input" id="new-rate-percent" type="number" step="0.01" min="0" max="100" placeholder="النسبة %" style="width:110px"/><button type="button" class="btn btn-sm btn-ghost" id="add-rate-btn">إضافة</button></div></div>` : ''}</div><div class="modal-footer"><button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="save-emp-btn">حفظ</button></div></div>`;
    document.body.appendChild(overlay); overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove())); overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    if (employee) loadBranchRates();
    async function loadBranchRates() { const rates = await listEmployeeBranchRates(employee.id); const el = overlay.querySelector('#branch-rates-list'); el.innerHTML = rates.length ? rates.map((r) => `<div class="flex justify-between" style="padding:5px 0"><span>${r.branches?.name || '—'}</span><span><strong>${fmt(r.commission_percent)}%</strong> <button class="btn btn-icon" data-remove-rate="${r.id}">🗑️</button></span></div>`).join('') : '<div class="text-muted">لا توجد نسب مخصصة.</div>'; el.querySelectorAll('[data-remove-rate]').forEach((b) => b.addEventListener('click', async () => { try { await deleteEmployeeBranchRate(b.dataset.removeRate); loadBranchRates(); } catch { toast(t('error_occurred'), 'error'); } })); }
    overlay.querySelector('#add-rate-btn')?.addEventListener('click', async () => { try { await upsertEmployeeBranchRate(employee.id, overlay.querySelector('#new-rate-branch').value, Number(overlay.querySelector('#new-rate-percent').value || 0)); loadBranchRates(); } catch { toast(t('error_occurred'), 'error'); } });
    overlay.querySelector('#save-emp-btn').addEventListener('click', async () => { const form = overlay.querySelector('#emp-form'); if (!form.reportValidity()) return; const fd = new FormData(form); const payload = { name: fd.get('name').trim(), phone: fd.get('phone').trim() || null, salary: Number(fd.get('salary') || 0), default_commission_percent: Number(fd.get('default_commission_percent') || 0), is_active: fd.get('is_active') === 'true', notes: fd.get('notes').trim() || null }; try { if (employee) await updateEmployee(employee.id, payload); else await createEmployee(payload); toast(t('success'), 'success'); overlay.remove(); loadEmployeesTab(body); } catch { toast(t('error_occurred'), 'error'); } });
  }

  function openTxnEmployeeModal(type, employeeId, body) {
    const employee = employeesData.find((e) => e.id === employeeId); if (!employee) return;
    const titles = { advance: 'إضافة سلفة', deduction: 'إضافة خصم', commission_manual: 'إضافة عمولة يدوية' };
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.innerHTML = `<div class="modal-box"><div class="modal-header"><h3>${titles[type]} - ${employee.name}</h3><button class="btn btn-icon" data-close>✕</button></div><div class="modal-body"><form id="emp-txn-form"><div class="field"><label>المبلغ</label><input class="input" type="number" step="0.01" min="0.01" name="amount" required/></div><div class="field"><label>الفرع</label><select class="input" name="branch_id"><option value="">— بدون —</option>${allBranches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}</select></div><div class="field"><label>البيان</label><input class="input" name="description"/></div><div class="field"><label>التاريخ</label><input class="input" type="date" name="txn_date" value="${isoDate(new Date())}" required/></div></form></div><div class="modal-footer"><button class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary" id="save-emp-txn">حفظ</button></div></div>`; document.body.appendChild(overlay); overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove())); overlay.querySelector('#save-emp-txn').addEventListener('click', async () => { const form = overlay.querySelector('#emp-txn-form'); if (!form.reportValidity()) return; const fd = new FormData(form); try { await createEmployeeTransaction({ employee_id: employee.id, type, amount: Number(fd.get('amount')), branch_id: fd.get('branch_id') || null, description: fd.get('description').trim() || null, txn_date: fd.get('txn_date'), created_by: profile.id }); toast(t('success'), 'success'); overlay.remove(); loadEmployeesTab(body); } catch { toast(t('error_occurred'), 'error'); } });
  }

  async function openLedgerModal(employee, body) {
    const txns = await listEmployeeTransactions({ employeeId: employee.id }); const overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.innerHTML = `<div class="modal-box modal-lg"><div class="modal-header"><h3>سجل حركات - ${employee.name}</h3><button class="btn btn-icon" data-close>✕</button></div><div class="modal-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>الفرع</th><th>البيان</th><th>المبلغ</th><th></th></tr></thead><tbody>${txns.map((tx) => `<tr><td>${tx.txn_date}</td><td><span class="badge ${TXN_TYPE_BADGE[tx.type] || 'badge-muted'}">${TXN_TYPE_LABEL[tx.type] || tx.type}</span></td><td>${tx.branches?.name || '—'}</td><td>${tx.description || '—'}</td><td class="mono-num">${fmt(tx.amount)}</td><td><button class="btn btn-icon" data-remove-txn="${tx.id}">🗑️</button></td></tr>`).join('')}</tbody></table>${txns.length ? '' : '<div class="table-empty">لا توجد حركات.</div>'}</div></div><div class="modal-footer"><button class="btn btn-primary" data-close>إغلاق</button></div></div>`; document.body.appendChild(overlay); overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove())); overlay.querySelectorAll('[data-remove-txn]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmDialog(t('confirm_delete')))) return; try { await deleteEmployeeTransaction(b.dataset.removeTxn); overlay.remove(); openLedgerModal(employee, body); loadEmployeesTab(body); } catch { toast(t('error_occurred'), 'error'); } }));
  }

  await load();
  let reloadTimer;
  const unsubscribe = subscribeRealtime(['sales', 'sale_items', 'sale_returns', 'sale_return_items', 'products', 'suppliers', 'purchases', 'supplier_payments', 'transactions', 'employee_transactions', 'cash_shifts', 'cash_movements', 'repair_orders', 'repair_parts_used', 'repair_payments'], () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { if (document.body.contains(container)) load(); }, 500); });
  return unsubscribe;
}
