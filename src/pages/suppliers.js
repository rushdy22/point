import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierStatement,
  getSupplierLedgerSummary,
  addSupplierPayment
} from '../lib/db/suppliers.js';
import { listPurchases, getPurchaseDetails, cancelPurchase } from '../lib/db/purchases.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { listBranches } from '../lib/db/branches.js';
import { paymentMethodLabel, paymentMethodOptions } from '../lib/paymentMethods.js';

export async function renderSuppliers(container, profile, branchId) {
  let suppliers = [];
  let branches = [];
  let search = '';
  const showBranchColumn = !branchId;

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    [suppliers, branches] = await Promise.all([
      listSuppliers({ search, branchId }),
      showBranchColumn ? listBranches({ onlyActive: true }) : Promise.resolve([])
    ]);
    const summaries = await Promise.all(suppliers.map(async (supplier) => [supplier.id, await getSupplierLedgerSummary(supplier.id)]));
    const byId = new Map(summaries);
    suppliers = suppliers.map((supplier) => ({ ...supplier, _ledgerSummary: byId.get(supplier.id) }));
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="flex justify-between items-center gap-16" style="margin-bottom:18px;">
        <div class="input-search" style="max-width:340px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="search-input" placeholder="${t('search_placeholder')}" value="${search}" />
        </div>
        <button class="btn btn-primary" id="add-supplier-btn">${t('new_supplier')}</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('supplier_name')}</th>
              ${showBranchColumn ? `<th>${t('branch')}</th>` : ''}
              <th>${t('supplier_phone')}</th>
              <th>${t('supplier_balance')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="supp-tbody"></tbody>
        </table>
        ${suppliers.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    container.querySelector('#supp-tbody').innerHTML = suppliers
      .map((s) => {
        const summary = s._ledgerSummary || { balance: 0 };
        const balance = Number(summary.balance || 0);
        return `
      <tr>
        <td><strong>${s.name}</strong></td>
        ${showBranchColumn ? `<td>${s.branches?.name || '—'}</td>` : ''}
        <td class="mono-num">${s.phone || `<span class="text-muted">${t('no_phone')}</span>`}</td>
        <td class="mono-num">
          ${balance > 0 ? `<span class="badge badge-warning">مستحق ${balance.toFixed(2)}</span>` : balance < 0 ? `<span class="badge badge-info">رصيد متاح ${Math.abs(balance).toFixed(2)}</span>` : `<span class="badge badge-success">${t('no_balance_due')}</span>`}
        </td>
        <td>
          <button class="btn btn-icon" data-purchases="${s.id}" title="${t('purchase_history')}">📦</button>
          <button class="btn btn-icon" data-payment="${s.id}" title="${t('add_payment')}">💵</button>
          <button class="btn btn-icon" data-statement="${s.id}" title="${t('supplier_statement')}">🧾</button>
          <button class="btn btn-icon" data-edit="${s.id}" title="${t('edit')}">✏️</button>
          <button class="btn btn-icon" data-delete="${s.id}" title="${t('delete')}">🗑️</button>
        </td>
      </tr>`;
      })
      .join('');

    container.querySelector('#search-input').addEventListener('input', (e) => {
      search = e.target.value;
      debounceLoad();
    });
    container.querySelector('#add-supplier-btn').addEventListener('click', () => openModal(null));

    container.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openModal(suppliers.find((s) => s.id === btn.dataset.edit)))
    );
    container.querySelectorAll('[data-statement]').forEach((btn) =>
      btn.addEventListener('click', () => openStatement(suppliers.find((s) => s.id === btn.dataset.statement)))
    );
    container.querySelectorAll('[data-purchases]').forEach((btn) =>
      btn.addEventListener('click', () => openPurchases(suppliers.find((s) => s.id === btn.dataset.purchases)))
    );
    container.querySelectorAll('[data-payment]').forEach((btn) =>
      btn.addEventListener('click', () => openPaymentModal(suppliers.find((s) => s.id === btn.dataset.payment)))
    );
    container.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await deleteSupplier(btn.dataset.delete);
          toast(t('success'), 'success');
          loadData();
        } catch {
          toast(t('error_occurred'), 'error');
        }
      })
    );
  }

  let debounceTimer;
  function debounceLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadData, 350);
  }

  function openModal(supplier) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${supplier ? t('edit_supplier') : t('new_supplier')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="supp-form">
            ${showBranchColumn ? `
            <div class="field">
              <label>${t('branch')}</label>
              <select class="input" name="branch_id" required>
                ${branches.map((b) => `<option value="${b.id}" ${supplier?.branch_id === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="field">
              <label>${t('supplier_name')}</label>
              <input class="input" name="name" required value="${supplier?.name || ''}" />
            </div>
            <div class="field">
              <label>${t('supplier_phone')}</label>
              <input class="input" name="phone" type="tel" value="${supplier?.phone || ''}" />
            </div>
            <div class="field">
              <label>${t('supplier_address')}</label>
              <input class="input" name="address" value="${supplier?.address || ''}" />
            </div>
            <div class="field">
              <label>${t('supplier_notes')}</label>
              <input class="input" name="notes" value="${supplier?.notes || ''}" />
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-supp-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-supp-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#supp-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name').trim(),
        phone: fd.get('phone').trim() || null,
        address: fd.get('address').trim() || null,
        notes: fd.get('notes').trim() || null
      };
      if (!supplier) payload.branch_id = showBranchColumn ? fd.get('branch_id') : branchId;
      try {
        if (supplier) await updateSupplier(supplier.id, payload);
        else await createSupplier(payload);
        toast(t('success'), 'success');
        overlay.remove();
        loadData();
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  function openPaymentModal(supplier) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${t('add_payment')} - ${supplier.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="text-muted" style="margin-bottom:14px;">${t('supplier_balance')}: <span class="mono-num">${Number(supplier._ledgerSummary?.balance || 0).toFixed(2)}</span></div>
          <form id="pay-form">
            <div class="field">
              <label>${t('payment_amount')}</label>
              <input class="input" type="number" step="0.001" min="0.001" name="amount" required value="${Math.max(Number(supplier.balance), 0).toFixed(2)}" />
            </div>
            <div class="field">
              <label>${t('payment_method')}</label>
              <select class="input" name="payment_method">${paymentMethodOptions()}</select>
            </div>
            <div class="field">
              <label>${t('payment_note')}</label>
              <input class="input" name="note" />
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-pay-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-pay-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#pay-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const amount = Number(fd.get('amount'));
      if (!(amount > 0)) {
        toast(t('error_occurred'), 'error');
        return;
      }
      try {
        await addSupplierPayment({
          supplierId: supplier.id,
          branchId: supplier.branch_id,
          amount,
          paymentMethod: fd.get('payment_method'),
          note: fd.get('note').trim() || null,
          createdBy: profile.id
        });
        toast(t('success'), 'success');
        overlay.remove();
        loadData();
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  async function openStatement(supplier) {
    const entries = await getSupplierStatement(supplier.id);
    const summary = entries.summary || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>${t('supplier_statement')} - ${supplier.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="card card-pad" style="background:var(--color-surface-2); margin-bottom:14px;">
            <div class="summary-row"><span>إجمالي المشتريات</span><span class="mono-num">${Number(summary.purchases || 0).toFixed(2)}</span></div>
            <div class="summary-row"><span>إجمالي مرتجعات المشتريات</span><span class="mono-num">${Number(summary.returns || 0).toFixed(2)}</span></div>
            <div class="summary-row"><span>إجمالي المدفوع</span><span class="mono-num">${Number(summary.totalPaid || 0).toFixed(2)}</span></div>
            <div class="summary-row total-row"><span>${Number(summary.balance || 0) < 0 ? 'رصيد متاح للمورد' : t('supplier_balance')}</span><span class="mono-num">${Math.abs(Number(summary.balance || 0)).toFixed(2)}</span></div>
          </div>
          <div class="flex gap-8" style="margin-bottom:10px; flex-wrap:wrap;"><button class="btn btn-ghost btn-sm" id="apply-supplier-credit-btn">💳 تسديد مستحقات المورد</button><span class="text-muted" style="font-size:12px; align-self:center;">يخصم من الرصيد المتاح للمورد.</span></div>
          <button class="btn btn-ghost" id="toggle-supplier-ledger" aria-expanded="false">📒 كشف الحساب الكامل <span>▾</span></button>
          <div id="supplier-ledger-body" hidden>
          <div class="table-wrap" style="margin-top:10px;">
            <table class="data-table">
              <thead><tr><th>${t('purchase_date')}</th><th>${t('invoice_number')}</th><th>${t('debit')}</th><th>${t('credit')}</th><th>${t('payment_method')}</th><th>${t('running_balance')}</th></tr></thead>
              <tbody>
                ${entries.map((e) => `
                  <tr>
                    <td class="mono-num">${new Date(e.date).toLocaleString('ar-EG')}</td>
                    <td>${e.ref || (e.note ? e.note : (e.type === 'payment' ? t('add_payment') : '—'))}</td>
                    <td class="mono-num">${e.debit ? e.debit.toFixed(2) : '—'}</td>
                    <td class="mono-num">${e.credit ? e.credit.toFixed(2) : '—'}</td>
                    <td>${e.paymentMethod ? paymentMethodLabel(e.paymentMethod) : '—'}</td>
                    <td class="mono-num"><strong>${e.balance.toFixed(2)}</strong></td>
                  </tr>`).join('')}
              </tbody>
            </table>
            ${entries.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
          </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" data-close>${t('close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.querySelector('#toggle-supplier-ledger').addEventListener('click', (event) => {
      const body = overlay.querySelector('#supplier-ledger-body');
      body.hidden = !body.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
      event.currentTarget.querySelector('span').textContent = body.hidden ? '▾' : '▴';
    });
    overlay.querySelector('#apply-supplier-credit-btn').addEventListener('click', async () => {
      try {
        const result = await window.electronAPI?.business?.execute('supplier:apply-credit', { supplierId: supplier.id, branchId: supplier.branch_id || branchId });
        if (result?.error) throw new Error(result.error.message);
        const applied = Number(result?.data?.applied || 0);
        const available = Number(result?.data?.availableCredit || 0);
        toast(applied > 0 ? `تم تسديد ${applied.toFixed(2)} من الرصيد المتاح.${available > 0 ? ` المتبقي: ${available.toFixed(2)}.` : ''}` : 'لا يوجد رصيد متاح قابل للتسديد.', applied > 0 ? 'success' : 'info');
        overlay.remove();
        await loadData();
      } catch (error) { toast(error.message || t('error_occurred'), 'error'); }
    });
  }

  async function openPurchases(supplier) {
    const purchases = await listPurchases({ supplierId: supplier.id });
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>${t('purchase_history')} - ${supplier.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>${t('invoice_number')}</th>
                  <th>${t('purchase_date')}</th>
                  <th>${t('total')}</th>
                  <th>${t('paid_amount')}</th>
                  <th>${t('payment_method')}</th>
                  <th>${t('remaining_balance')}</th>
                  <th>${t('purchase_status')}</th>
                  <th>${t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                ${purchases.map((p) => {
                  const remaining = Number(p.total) - Number(p.paid_amount);
                  const isCancelled = p.status === 'cancelled';
                  return `
                  <tr>
                    <td class="mono-num"><strong>${p.invoice_number}</strong></td>
                    <td class="mono-num">${new Date(p.created_at).toLocaleString('ar-EG')}</td>
                    <td class="mono-num">${Number(p.total).toFixed(2)}</td>
                    <td class="mono-num">${Number(p.paid_amount).toFixed(2)}</td>
                    <td>${paymentMethodLabel(p.payment_method)}</td>
                    <td class="mono-num">
                      ${remaining > 0 ? `<span class="badge badge-warning">${remaining.toFixed(2)}</span>` : `<span class="badge badge-success">${t('fully_paid')}</span>`}
                    </td>
                    <td><span class="badge ${isCancelled ? 'badge-muted' : 'badge-success'}">${isCancelled ? t('cancelled') : t('completed')}</span></td>
                    <td>
                      <button class="btn btn-icon" data-view-purchase="${p.id}" title="${t('view_details')}">👁️</button>
                      ${!isCancelled ? `<button class="btn btn-icon" data-cancel-purchase="${p.id}" title="${t('cancel_purchase')}">🗑️</button>` : ''}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
            ${purchases.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" data-close>${t('close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('[data-view-purchase]').forEach((btn) =>
      btn.addEventListener('click', () => openPurchaseDetails(btn.dataset.viewPurchase))
    );
    overlay.querySelectorAll('[data-cancel-purchase]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await cancelPurchase(btn.dataset.cancelPurchase);
          toast(t('purchase_cancelled'), 'success');
          overlay.remove();
          openPurchases(supplier);
          loadData();
        } catch {
          toast(t('error_occurred'), 'error');
        }
      })
    );
  }

  async function openPurchaseDetails(purchaseId) {
    const { purchase, items } = await getPurchaseDetails(purchaseId);
    const remaining = Number(purchase.total) - Number(purchase.paid_amount);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>${t('purchase_details')} - ${purchase.invoice_number}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="flex justify-between" style="margin-bottom:10px;">
            <span class="badge ${purchase.status === 'cancelled' ? 'badge-muted' : 'badge-success'}">${purchase.status === 'cancelled' ? t('cancelled') : t('completed')}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>${t('item')}</th><th>${t('quantity')}</th><th>${t('purchase_price')}</th><th>${t('line_total')}</th></tr></thead>
              <tbody>
                ${items.map((i) => `<tr><td>${i.product_name}</td><td class="mono-num">${i.quantity}</td><td class="mono-num">${Number(i.unit_cost).toFixed(2)}</td><td class="mono-num">${Number(i.total).toFixed(2)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="card card-pad" style="margin-top:14px; background:var(--color-surface-2);">
            <div class="summary-row"><span>${t('paid_amount')}</span><span class="mono-num">${Number(purchase.paid_amount).toFixed(2)}</span></div>
            <div class="summary-row"><span>${t('payment_method')}</span><span>${paymentMethodLabel(purchase.payment_method)}</span></div>
            <div class="summary-row"><span>${t('remaining_balance')}</span><span class="mono-num">${remaining.toFixed(2)}</span></div>
            <div class="summary-row total-row"><span>${t('total')}</span><span class="mono-num">${Number(purchase.total).toFixed(2)}</span></div>
          </div>
          ${purchase.notes ? `<div class="text-muted" style="margin-top:10px;">${purchase.notes}</div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" data-close>${t('close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
  }

  await loadData();

  const unsubscribe = subscribeRealtime(['suppliers', 'supplier_payments'], () => {
    if (document.body.contains(container)) loadData();
  });
  return unsubscribe;
}
