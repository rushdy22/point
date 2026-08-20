import { t } from '../i18n/index.js';

import { paymentMethodOptions } from '../lib/paymentMethods.js';
import { paymentMethodLabel } from '../lib/paymentMethods.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listTransactions, createTransaction, deleteTransaction } from '../lib/db/accounts.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { listBranches } from '../lib/db/branches.js';
import { canManage } from '../lib/permissions.js';
import { renderFinance } from './finance.js';
import { financeSummary } from '../lib/db/finance.js';
import { renderSuppliers } from './suppliers.js';
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

const TXN_TYPE_LABEL = {
  deduction: 'خصم',
  advance: 'سلفة',
  commission_manual: 'عمولة يدوية',
  commission_auto: 'عمولة تلقائية (فاتورة)'
};
const TXN_TYPE_BADGE = {
  deduction: 'badge-danger',
  advance: 'badge-warning',
  commission_manual: 'badge-success',
  commission_auto: 'badge-success'
};

export async function renderAccounts(container, profile, branchId) {
  let mainTab = 'finance'; // 'finance' | 'suppliers'
  let accountsTab = 'accounts'; // 'accounts' | 'employees' | 'drawer'
  let activeSectionCleanup = null;
  const showEmployeesTab = canManage(profile.role);

  // ----- state for the "الحسابات" tab -----
  let range = 'today';
  let customFrom = isoDate(new Date());
  let customTo = isoDate(new Date());
  let branches = [];
  const showBranchColumn = !branchId;

  // ----- state for the "الموظفين" tab -----
  let empRange = 'month';
  let empCustomFrom = isoDate(new Date());
  let empCustomTo = isoDate(new Date());
  let employeesData = [];
  let allBranches = [];
  let empSearch = '';

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  function getRangeDates(r, from, to) {
    const now = new Date();
    if (r === 'today') return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    if (r === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      return { from: first.toISOString(), to: last.toISOString() };
    }
    if (r === 'all') return { from: new Date('2000-01-01T00:00:00').toISOString(), to: endOfDay(now).toISOString() };
    return { from: new Date(from + 'T00:00:00').toISOString(), to: new Date(to + 'T23:59:59').toISOString() };
  }

  // =========================================================
  // Main section tabs: المالية / الحسابات / الموردون
  // =========================================================
  function drawShell() {
    if (typeof activeSectionCleanup === 'function') {
      try { activeSectionCleanup(); } catch { /* ignore */ }
      activeSectionCleanup = null;
    }

    container.innerHTML = `
      <div class="flex justify-between items-center gap-8" style="margin-bottom:18px; flex-wrap:wrap;">
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <button class="pill ${mainTab === 'finance' ? 'active' : ''}" data-main-tab="finance">${t('finance_section_tab')}</button>
          <button class="pill ${mainTab === 'suppliers' ? 'active' : ''}" data-main-tab="suppliers">${t('suppliers_section_tab')}</button>
        </div>
        <button class="btn btn-ghost btn-sm" id="accounts-guide-btn">ⓘ ${t('accounts_guide')}</button>
      </div>
      <div id="accounts-body"></div>
    `;

    container.querySelectorAll('[data-main-tab]').forEach((btn) =>
      btn.addEventListener('click', () => {
        mainTab = btn.dataset.mainTab;
        drawShell();
      })
    );
    container.querySelector('#accounts-guide-btn').addEventListener('click', openAccountsGuide);

    const body = container.querySelector('#accounts-body');

    if (mainTab === 'finance') {
      Promise.resolve(renderFinance(body, profile, branchId)).then((cleanup) => {
        activeSectionCleanup = cleanup;
      });
    } else if (mainTab === 'suppliers') {
      Promise.resolve(renderSuppliers(body, profile, branchId)).then((cleanup) => {
        activeSectionCleanup = cleanup;
      });
    }
  }

  function openAccountsGuide() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg" dir="rtl">
        <div class="modal-header">
          <h3>${t('accounts_guide_title')}</h3>
          <button class="btn btn-icon" data-close aria-label="إغلاق">✕</button>
        </div>
        <div class="modal-body">
          <div class="card card-pad" style="background:var(--color-primary-light); border:none; margin-bottom:16px;">
            <p style="font-size:13px;">ⓘ ${t('accounts_guide_intro')}</p>
          </div>
          <div class="flex flex-col gap-10" style="font-size:14px; line-height:1.8;">
            <div><strong>•</strong> ${t('accounts_guide_sales')}</div>
            <div><strong>•</strong> ${t('accounts_guide_cost')}</div>
            <div><strong>•</strong> ${t('accounts_guide_expenses')}</div>
            <div><strong>•</strong> ${t('accounts_guide_profit')}</div>
            <div><strong>•</strong> ${t('accounts_guide_inventory')}</div>
            <div><strong>•</strong> ${t('accounts_guide_suppliers')}</div>
            <div><strong>•</strong> ${t('accounts_guide_supplier_payment')}</div>
            <div><strong>•</strong> ${t('accounts_guide_purchase')}</div>
            <div><strong>•</strong> ${t('accounts_guide_manual_expense')}</div>
          </div>
          <div class="card card-pad" style="margin-top:18px;">
            <h4 style="margin-bottom:8px;">${t('accounts_guide_example')}</h4>
            <p style="line-height:1.8;">${t('accounts_guide_example_text')}</p>
            <h4 style="margin:14px 0 8px;">${t('accounts_guide_result')}</h4>
            <div class="flex flex-col gap-6 mono-num" style="font-size:14px;">
              <div>${t('accounts_guide_result_sales')}</div>
              <div>${t('accounts_guide_result_cost')}</div>
              <div>${t('accounts_guide_result_manual_expense')}</div>
              <div>${t('accounts_guide_result_total_expenses')}</div>
              <div><strong>${t('accounts_guide_result_profit')}</strong></div>
            </div>
          </div>
        </div>
        <div class="modal-footer"><button class="btn btn-primary" data-close>${t('close')}</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }

  function drawAccountsSection(body) {
    body.innerHTML = `
      ${showEmployeesTab ? `
      <div class="flex gap-8" style="margin-bottom:18px;">
        <button class="pill ${accountsTab === 'accounts' ? 'active' : ''}" data-account-tab="accounts">${t('accounts')}</button>
        <button class="pill ${accountsTab === 'employees' ? 'active' : ''}" data-account-tab="employees">👥 ${t('employees')}</button>
        <button class="pill ${accountsTab === 'drawer' ? 'active' : ''}" data-account-tab="drawer">🗄️ درج الكاشير</button>
      </div>` : ''}
      <div id="accounts-section-body"></div>
    `;

    body.querySelectorAll('[data-account-tab]').forEach((btn) =>
      btn.addEventListener('click', () => {
        accountsTab = btn.dataset.accountTab;
        drawAccountsSection(body);
      })
    );

    const inner = body.querySelector('#accounts-section-body');
    if (accountsTab === 'accounts') loadAccountsTab(inner);
    else if (accountsTab === 'employees') loadEmployeesTab(inner);
    else renderDrawer(inner, profile, branchId);
  }

  // =========================================================
  // TAB 1: الحسابات (unchanged behaviour from before)
  // =========================================================
  async function loadAccountsTab(body) {
    body.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;
    const { from, to } = getRangeDates(range, customFrom, customTo);
    const [summary, txns] = await Promise.all([
      financeSummary({ from, to, branchId }),
      listTransactions({ from: from.slice(0, 10), to: to.slice(0, 10), branchId }),
      showBranchColumn ? listBranches({ onlyActive: true }).then((b) => { branches = b; }) : Promise.resolve()
    ]);
    drawAccountsTab(body, summary, (txns || []).filter((x) => !['repair_revenue', 'repair_deposit'].includes(x.category)));
  }

  function drawAccountsTab(body, summary, txns) {
    const isLoss = summary.netProfit < 0;

    body.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom:18px; flex-wrap:wrap; gap:12px;">
        <div class="flex gap-8">
          <button class="pill ${range === 'today' ? 'active' : ''}" data-range="today">${t('today')}</button>
          <button class="pill ${range === 'month' ? 'active' : ''}" data-range="month">${t('this_month')}</button>
          <button class="pill ${range === 'custom' ? 'active' : ''}" data-range="custom">${t('custom_range')}</button>
          ${range === 'custom' ? `
            <input type="date" class="input" id="from-date" value="${customFrom}" style="padding:6px 10px;" />
            <input type="date" class="input" id="to-date" value="${customTo}" style="padding:6px 10px;" />
            <button class="btn btn-sm btn-primary" id="apply-range-btn">${t('apply')}</button>
          ` : ''}
        </div>
        <div class="flex gap-8">
          <button class="btn btn-ghost" id="add-expense-btn">➖ ${t('add_expense')}</button>
          <button class="btn btn-accent" id="add-income-btn">➕ ${t('add_income')}</button>
        </div>
      </div>

      <div class="flex gap-16" style="flex-wrap:wrap; margin-bottom:16px;">
        <div class="stat-card" style="flex:1; min-width:180px;"><div class="stat-icon">💰</div><div class="stat-label">إجمالي الإيرادات</div><div class="stat-value mono-num">${summary.totalRevenue.toFixed(2)}</div></div>
        <div class="stat-card" style="flex:1; min-width:180px;"><div class="stat-icon">📦</div><div class="stat-label">إجمالي التكاليف والمصروفات</div><div class="stat-value mono-num">${summary.totalExpenses.toFixed(2)}</div></div>
        <div class="stat-card" style="flex:1; min-width:180px; background:${isLoss ? 'var(--color-danger-light)' : 'var(--color-success-light)'};"><div class="stat-icon">${isLoss ? '📉' : '📈'}</div><div class="stat-label">${isLoss ? 'صافي الخسارة' : 'صافي الربح'}</div><div class="stat-value mono-num">${summary.netProfit.toFixed(2)}</div></div>
        <div class="stat-card" style="flex:1; min-width:180px;"><div class="stat-icon">🛠️</div><div class="stat-label">إيرادات الصيانة</div><div class="stat-value mono-num">${summary.repairRevenue.toFixed(2)}</div></div>
        <div class="stat-card" style="flex:1; min-width:180px;"><div class="stat-icon">👨‍🔧</div><div class="stat-label">إجمالي العمالة</div><div class="stat-value mono-num">${summary.repairLabor.toFixed(2)}</div></div>
        <div class="stat-card" style="flex:1; min-width:180px;"><div class="stat-icon">🔧</div><div class="stat-label">مواد الصيانة المستخدمة</div><div class="stat-value mono-num">${summary.repairMaterialsCost.toFixed(2)}</div></div>
      </div>

      <div class="card card-pad" style="margin-bottom:16px; background:var(--color-primary-light); border:none;">
        <p style="font-size:13px;">ℹ️ الحسابات موحدة: المبيعات والصيانة والإيرادات اليدوية تدخل في الإيرادات، وتكاليف البضاعة ومواد الصيانة والمصروفات اليدوية تدخل في التكاليف، ثم يظهر صافي الربح النهائي. سجل الحركات بالأسفل مخصص للحركات اليدوية فقط.</p>
      </div>

      <h3 style="margin-bottom:12px;">${t('transactions_log')}</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('txn_date')}</th>
              ${showBranchColumn ? `<th>${t('branch')}</th>` : ''}
              <th>${t('income')}/${t('expense')}</th>
              <th>${t('txn_category')}</th>
              <th>${t('description')}</th>
              <th>${t('payment_method')}</th>
              <th>${t('amount')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${txns
              .map(
                (tx) => `
              <tr>
                <td class="mono-num">${tx.txn_date}</td>
                ${showBranchColumn ? `<td>${tx.branches?.name || '—'}</td>` : ''}
                <td><span class="badge ${tx.type === 'income' ? 'badge-success' : 'badge-danger'}">${t(tx.type)}</span></td>
                <td>${tx.category || '—'}</td>
                <td>${tx.description || '—'}</td>
                <td>${paymentMethodLabel(tx.payment_method)}</td>
                <td class="mono-num">${tx.type === 'income' ? '+' : '-'}${Number(tx.amount).toFixed(2)}</td>
                <td><button class="btn btn-icon" data-delete-txn="${tx.id}">🗑️</button></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        ${txns.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    body.querySelectorAll('[data-range]').forEach((btn) =>
      btn.addEventListener('click', () => { range = btn.dataset.range; loadAccountsTab(body); })
    );
    const applyBtn = body.querySelector('#apply-range-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        customFrom = body.querySelector('#from-date').value;
        customTo = body.querySelector('#to-date').value;
        loadAccountsTab(body);
      });
    }

    body.querySelector('#add-income-btn').addEventListener('click', () => openTxnModal('income', body));
    body.querySelector('#add-expense-btn').addEventListener('click', () => openTxnModal('expense', body));

    body.querySelectorAll('[data-delete-txn]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await deleteTransaction(btn.dataset.deleteTxn);
          toast(t('success'), 'success');
          loadAccountsTab(body);
        } catch {
          toast(t('error_occurred'), 'error');
        }
      })
    );
  }

  function openTxnModal(type, body) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${type === 'income' ? t('add_income') : t('add_expense')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="txn-form">
            ${showBranchColumn ? `
            <div class="field">
              <label>${t('branch')}</label>
              <select class="input" name="branch_id" required>
                ${branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="field">
              <label>${t('amount')}</label>
              <input class="input" type="number" step="0.01" min="0" name="amount" required />
            </div>
            <div class="field">
              <label>${t('txn_category')}</label>
              <input class="input" name="category" placeholder="${type === 'income' ? 'مثال: إيراد إضافي' : 'مثال: إيجار، فواتير، رواتب'}" />
            </div>
            <div class="field">
              <label>${t('description')}</label>
              <input class="input" name="description" />
            </div>
            <div class="field">
              <label>${t('txn_date')}</label>
              <input class="input" type="date" name="txn_date" value="${isoDate(new Date())}" required />
            </div>
            <div class="field">
              <label>${t('payment_method')}</label>
              <select class="input" name="payment_method">${paymentMethodOptions()}</select>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn ${type === 'income' ? 'btn-accent' : 'btn-danger'}" id="save-txn-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-txn-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#txn-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      try {
        await createTransaction({
          type,
          branch_id: showBranchColumn ? fd.get('branch_id') : branchId,
          amount: Number(fd.get('amount')),
          category: fd.get('category').trim() || null,
          description: fd.get('description').trim() || null,
          txn_date: fd.get('txn_date'),
          payment_method: fd.get('payment_method'),
          created_by: profile.id
        });
        toast(t('success'), 'success');
        overlay.remove();
        loadAccountsTab(body);
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  // =========================================================
  // TAB 2: الموظفين
  // =========================================================
  async function loadEmployeesTab(body) {
    body.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;
    const { from, to } = getRangeDates(empRange, empCustomFrom, empCustomTo);
    [employeesData, allBranches] = await Promise.all([
      employeesSummary({ from, to, branchId }),
      listBranches({ onlyActive: true })
    ]);
    drawEmployeesTab(body);
  }

  function drawEmployeesTab(body) {
    const filtered = employeesData.filter((e) => !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()));

    body.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom:18px; flex-wrap:wrap; gap:12px;">
        <div class="flex gap-8">
          <button class="pill ${empRange === 'month' ? 'active' : ''}" data-emp-range="month">${t('this_month')}</button>
          <button class="pill ${empRange === 'today' ? 'active' : ''}" data-emp-range="today">${t('today')}</button>
          <button class="pill ${empRange === 'all' ? 'active' : ''}" data-emp-range="all">${t('all')}</button>
          <button class="pill ${empRange === 'custom' ? 'active' : ''}" data-emp-range="custom">${t('custom_range')}</button>
          ${empRange === 'custom' ? `
            <input type="date" class="input" id="emp-from-date" value="${empCustomFrom}" style="padding:6px 10px;" />
            <input type="date" class="input" id="emp-to-date" value="${empCustomTo}" style="padding:6px 10px;" />
            <button class="btn btn-sm btn-primary" id="emp-apply-range-btn">${t('apply')}</button>
          ` : ''}
        </div>
        <button class="btn btn-primary" id="add-employee-btn">➕ إضافة موظف</button>
      </div>

      <div class="input-search" style="max-width:300px; margin-bottom:14px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="emp-search-input" placeholder="${t('search_placeholder')}" value="${empSearch}" />
      </div>

      <div class="card card-pad" style="margin-bottom:16px; background:var(--color-primary-light); border:none;">
        <p style="font-size:13px;">ℹ️ الصافي المستحق = الراتب الأساسي + العمولات (يدوية وتلقائية) − الخصومات − السلف، عن الفترة المختارة أعلى الصفحة.</p>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الهاتف</th>
              <th>الراتب الأساسي</th>
              <th>نسبة العمولة الافتراضية</th>
              <th>العمولات</th>
              <th>الخصومات</th>
              <th>السلف</th>
              <th>الصافي المستحق</th>
              <th>${t('status')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="emp-tbody"></tbody>
        </table>
        ${filtered.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    body.querySelector('#emp-tbody').innerHTML = filtered
      .map(
        (e) => `
      <tr>
        <td><strong>${e.name}</strong></td>
        <td class="mono-num">${e.phone || '—'}</td>
        <td class="mono-num">${Number(e.salary).toFixed(2)}</td>
        <td class="mono-num">${Number(e.default_commission_percent).toFixed(2)}%</td>
        <td class="mono-num" style="color:var(--color-success);">+${e.commissions.toFixed(2)}</td>
        <td class="mono-num" style="color:var(--color-danger);">-${e.deductions.toFixed(2)}</td>
        <td class="mono-num" style="color:var(--color-danger);">-${e.advances.toFixed(2)}</td>
        <td class="mono-num"><strong>${e.net.toFixed(2)}</strong></td>
        <td><span class="badge ${e.is_active ? 'badge-success' : 'badge-muted'}">${e.is_active ? t('active') : t('inactive')}</span></td>
        <td>
          <button class="btn btn-icon" data-emp-edit="${e.id}" title="${t('edit')}">✏️</button>
          <button class="btn btn-icon" data-emp-advance="${e.id}" title="سلفة">💵</button>
          <button class="btn btn-icon" data-emp-deduct="${e.id}" title="خصم">➖</button>
          <button class="btn btn-icon" data-emp-commission="${e.id}" title="عمولة يدوية">➕</button>
          <button class="btn btn-icon" data-emp-ledger="${e.id}" title="سجل الحركات">🧾</button>
          <button class="btn btn-icon" data-emp-delete="${e.id}" title="${t('delete')}">🗑️</button>
        </td>
      </tr>`
      )
      .join('');

    body.querySelectorAll('[data-emp-range]').forEach((btn) =>
      btn.addEventListener('click', () => { empRange = btn.dataset.empRange; loadEmployeesTab(body); })
    );
    const empApplyBtn = body.querySelector('#emp-apply-range-btn');
    if (empApplyBtn) {
      empApplyBtn.addEventListener('click', () => {
        empCustomFrom = body.querySelector('#emp-from-date').value;
        empCustomTo = body.querySelector('#emp-to-date').value;
        loadEmployeesTab(body);
      });
    }

    body.querySelector('#emp-search-input').addEventListener('input', (e) => {
      empSearch = e.target.value;
      drawEmployeesTab(body);
    });

    body.querySelector('#add-employee-btn').addEventListener('click', () => openEmployeeModal(null, body));
    body.querySelectorAll('[data-emp-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openEmployeeModal(employeesData.find((e) => e.id === btn.dataset.empEdit), body))
    );
    body.querySelectorAll('[data-emp-advance]').forEach((btn) =>
      btn.addEventListener('click', () => openTxnEmployeeModal('advance', btn.dataset.empAdvance, body))
    );
    body.querySelectorAll('[data-emp-deduct]').forEach((btn) =>
      btn.addEventListener('click', () => openTxnEmployeeModal('deduction', btn.dataset.empDeduct, body))
    );
    body.querySelectorAll('[data-emp-commission]').forEach((btn) =>
      btn.addEventListener('click', () => openTxnEmployeeModal('commission_manual', btn.dataset.empCommission, body))
    );
    body.querySelectorAll('[data-emp-ledger]').forEach((btn) =>
      btn.addEventListener('click', () => openLedgerModal(employeesData.find((e) => e.id === btn.dataset.empLedger), body))
    );
    body.querySelectorAll('[data-emp-delete]').forEach((btn) =>
      btn.addEventListener('click', () => handleDeleteEmployee(employeesData.find((e) => e.id === btn.dataset.empDelete), body))
    );
  }

  async function handleDeleteEmployee(employee, body) {
    if (!employee) return;
    const ok = await confirmDialog(t('confirm_delete'));
    if (!ok) return;
    try {
      await deleteEmployee(employee.id);
      toast(t('success'), 'success');
      loadEmployeesTab(body);
    } catch (err) {
      const isFkError = err?.code === '23503' || /foreign key|violates|constraint/i.test(err?.message || '');
      if (!isFkError) {
        toast(t('error_occurred'), 'error');
        return;
      }
      const wantsDeactivate = await confirmDialog(
        'لا يمكن حذف هذا الموظف لأنه مرتبط بحركات أو فواتير سابقة. هل تريد إيقافه بدلاً من حذفه؟'
      );
      if (!wantsDeactivate) return;
      try {
        await updateEmployee(employee.id, { is_active: false });
        toast(t('success'), 'success');
        loadEmployeesTab(body);
      } catch {
        toast(t('error_occurred'), 'error');
      }
    }
  }

  function openEmployeeModal(employee, body) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${employee ? 'تعديل موظف' : 'إضافة موظف'}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="emp-form">
            <div class="field">
              <label>اسم الموظف</label>
              <input class="input" name="name" required value="${employee?.name || ''}" />
            </div>
            <div class="field">
              <label>${t('customer_phone') || 'رقم الهاتف'}</label>
              <input class="input" name="phone" type="tel" value="${employee?.phone || ''}" />
            </div>
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>الراتب الأساسي</label>
                <input class="input" type="number" step="0.01" min="0" name="salary" value="${employee?.salary ?? 0}" />
              </div>
              <div class="field" style="flex:1">
                <label>نسبة العمولة الافتراضية %</label>
                <input class="input" type="number" step="0.01" min="0" max="100" name="default_commission_percent" value="${employee?.default_commission_percent ?? 0}" />
              </div>
            </div>
            <div class="field">
              <label>${t('status')}</label>
              <select class="input" name="is_active">
                <option value="true" ${employee?.is_active !== false ? 'selected' : ''}>${t('active')}</option>
                <option value="false" ${employee?.is_active === false ? 'selected' : ''}>${t('inactive')}</option>
              </select>
            </div>
            <div class="field">
              <label>ملاحظات</label>
              <input class="input" name="notes" value="${employee?.notes || ''}" />
            </div>
          </form>

          ${employee ? `
          <div style="margin-top:18px; border-top:1px solid var(--color-border); padding-top:14px;">
            <h4 style="margin-bottom:10px; font-size:13.5px;">نسب عمولة خاصة بفروع معينة (اختياري)</h4>
            <div class="text-muted" style="font-size:12px; margin-bottom:10px;">
              لو الموظف بيشتغل في أكتر من فرع وبنسبة عمولة مختلفة، حدد الفرع والنسبة هنا. أي فرع مش موجود هنا هياخد النسبة الافتراضية.
            </div>
            <div id="branch-rates-list"></div>
            <div class="flex gap-8" style="margin-top:10px;">
              <select class="input" id="new-rate-branch" style="flex:1;">
                ${allBranches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
              <input class="input" id="new-rate-percent" type="number" step="0.01" min="0" max="100" placeholder="النسبة %" style="width:110px;" />
              <button type="button" class="btn btn-ghost btn-sm" id="add-rate-btn">إضافة</button>
            </div>
          </div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-emp-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    if (employee) {
      loadBranchRates();
    }

    async function loadBranchRates() {
      const rates = await listEmployeeBranchRates(employee.id);
      const listEl = overlay.querySelector('#branch-rates-list');
      listEl.innerHTML = rates.length === 0
        ? `<div class="text-muted" style="font-size:12.5px;">لا توجد نسب مخصصة، كل الفروع بتاخد النسبة الافتراضية.</div>`
        : rates.map((r) => `
          <div class="flex justify-between items-center" style="padding:6px 0; border-bottom:1px solid var(--color-border);">
            <span>${r.branches?.name || '—'}</span>
            <span class="flex items-center gap-8">
              <strong class="mono-num">${Number(r.commission_percent).toFixed(2)}%</strong>
              <button type="button" class="btn btn-icon" data-remove-rate="${r.id}">🗑️</button>
            </span>
          </div>`).join('');

      listEl.querySelectorAll('[data-remove-rate]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            await deleteEmployeeBranchRate(btn.dataset.removeRate);
            loadBranchRates();
          } catch {
            toast(t('error_occurred'), 'error');
          }
        })
      );
    }

    const addRateBtn = overlay.querySelector('#add-rate-btn');
    if (addRateBtn) {
      addRateBtn.addEventListener('click', async () => {
        const branchSel = overlay.querySelector('#new-rate-branch');
        const percentInput = overlay.querySelector('#new-rate-percent');
        const percent = Number(percentInput.value);
        if (!branchSel.value || !percentInput.value || percent < 0 || percent > 100) {
          toast('اختر فرع وأدخل نسبة صحيحة بين 0 و 100', 'error');
          return;
        }
        try {
          await upsertEmployeeBranchRate(employee.id, branchSel.value, percent);
          percentInput.value = '';
          loadBranchRates();
        } catch {
          toast(t('error_occurred'), 'error');
        }
      });
    }

    overlay.querySelector('#save-emp-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#emp-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name').trim(),
        phone: fd.get('phone').trim() || null,
        salary: Number(fd.get('salary') || 0),
        default_commission_percent: Number(fd.get('default_commission_percent') || 0),
        is_active: fd.get('is_active') === 'true',
        notes: fd.get('notes').trim() || null
      };
      try {
        if (employee) await updateEmployee(employee.id, payload);
        else await createEmployee(payload);
        toast(t('success'), 'success');
        overlay.remove();
        loadEmployeesTab(body);
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  function openTxnEmployeeModal(type, employeeId, body) {
    const employee = employeesData.find((e) => e.id === employeeId);
    if (!employee) return;
    const titles = { advance: 'إضافة سلفة', deduction: 'إضافة خصم', commission_manual: 'إضافة عمولة يدوية' };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${titles[type]} - ${employee.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="emp-txn-form">
            <div class="field">
              <label>${t('amount')}</label>
              <input class="input" type="number" step="0.01" min="0.01" name="amount" required />
            </div>
            <div class="field">
              <label>${t('branch') || 'الفرع'} (اختياري)</label>
              <select class="input" name="branch_id">
                <option value="">— بدون —</option>
                ${allBranches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>${t('description')}</label>
              <input class="input" name="description" />
            </div>
            <div class="field">
              <label>${t('txn_date')}</label>
              <input class="input" type="date" name="txn_date" value="${isoDate(new Date())}" required />
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-emp-txn-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-emp-txn-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#emp-txn-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      try {
        await createEmployeeTransaction({
          employee_id: employee.id,
          type,
          amount: Number(fd.get('amount')),
          branch_id: fd.get('branch_id') || null,
          description: fd.get('description').trim() || null,
          txn_date: fd.get('txn_date'),
          created_by: profile.id
        });
        toast(t('success'), 'success');
        overlay.remove();
        loadEmployeesTab(body);
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  async function openLedgerModal(employee, body) {
    if (!employee) return;
    const txns = await listEmployeeTransactions({ employeeId: employee.id });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>سجل حركات - ${employee.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${t('txn_date')}</th>
                  <th>النوع</th>
                  <th>${t('branch') || 'الفرع'}</th>
                  <th>${t('description')}</th>
                  <th>${t('amount')}</th>
                  <th>${t('actions')}</th>
                </tr>
              </thead>
              <tbody id="ledger-tbody">
                ${txns.map((tx) => `
                  <tr>
                    <td class="mono-num">${tx.txn_date}</td>
                    <td><span class="badge ${TXN_TYPE_BADGE[tx.type] || 'badge-muted'}">${TXN_TYPE_LABEL[tx.type] || tx.type}</span></td>
                    <td>${tx.branches?.name || '—'}</td>
                    <td>${tx.description || '—'}</td>
                    <td class="mono-num">${Number(tx.amount).toFixed(2)}</td>
                    <td><button class="btn btn-icon" data-remove-txn="${tx.id}">🗑️</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
            ${txns.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" data-close>${t('close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));

    overlay.querySelectorAll('[data-remove-txn]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await deleteEmployeeTransaction(btn.dataset.removeTxn);
          overlay.remove();
          openLedgerModal(employee, body);
          loadEmployeesTab(body);
        } catch {
          toast(t('error_occurred'), 'error');
        }
      })
    );
  }

  // =========================================================
  drawShell();

  let reloadTimer;
  const unsubscribe = subscribeRealtime(['transactions', 'sales', 'employee_transactions', 'cash_shifts', 'cash_movements'], () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (document.body.contains(container)) drawShell();
    }, 500);
  });
  return () => {
    if (typeof activeSectionCleanup === 'function') {
      try { activeSectionCleanup(); } catch { /* ignore */ }
      activeSectionCleanup = null;
    }
    unsubscribe?.();
  };
}
