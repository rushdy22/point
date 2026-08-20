import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerPurchaseHistory,
  whatsappLink
} from '../lib/db/customers.js';
import { createSale, updateSaleItems, refundSale } from '../lib/db/sales.js';
import { listProducts } from '../lib/db/products.js';
import { paymentMethodOptions, paymentMethodLabel } from '../lib/paymentMethods.js';
import { getInvoicePaymentSummary, paymentStatus, recordCustomerPayment, getCustomerLedger } from '../lib/db/customerPayments.js';
import { canManage } from '../lib/permissions.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { listBranches } from '../lib/db/branches.js';

const STATUS_LABEL = { completed: 'completed', refunded: 'refunded', cancelled: 'cancelled' };
const STATUS_BADGE = { completed: 'badge-success', refunded: 'badge-danger', cancelled: 'badge-muted' };

const CUSTOMER_ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A11.9 11.9 0 0 0 12 0a12 12 0 0 0-10.4 18L0 24l6.2-1.6A12 12 0 1 0 20.5 3.5Z"/><path d="M8.2 6.7c.3-.3.7-.4 1.1-.2l1.4 1.2c.4.3.5.8.2 1.2l-.7.9c.7 1.4 1.8 2.5 3.2 3.2l.9-.7c.4-.3.9-.2 1.2.2l1.2 1.4c.2.3.2.8-.1 1.1-.7.8-1.8 1.1-2.8.7-2.8-1.1-5.5-3.8-6.6-6.6-.4-1-.1-2.1.7-2.8Z"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3Z"/><path d="M5 18a3 3 0 0 0 3 3M9 7h6M9 11h6M9 15h4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>'
};


export async function renderCustomers(container, profile, branchId) {
  let customers = [];
  let branches = [];
  let search = '';
  const showBranchColumn = !branchId;

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    [customers, branches] = await Promise.all([
      listCustomers({ search, branchId }),
      showBranchColumn ? listBranches({ onlyActive: true }) : Promise.resolve([])
    ]);
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="card card-pad" style="margin-bottom:14px; border:1px solid var(--color-warning); background:var(--color-warning-light);">
        <div class="flex justify-between items-center gap-12" style="flex-wrap:wrap;">
          <div>
            <strong>📞 عملاء غير نشطين 3 شهور فأكثر</strong>
            <div class="text-muted" style="font-size:12px; margin-top:3px;">العملاء الذين لم يزوروا المكان منذ 3 أشهر أو أكثر، بما في ذلك من لم يسجل لهم تاريخ زيارة بعد مرور 3 أشهر على تسجيلهم.</div>
          </div>
          <button class="btn btn-primary" id="inactive-customers-btn">💬 واتساب للعملاء غير النشطين</button>
        </div>
      </div>
      <div class="flex justify-between items-center gap-16" style="margin-bottom:18px;">
        <div class="input-search" style="max-width:340px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="search-input" placeholder="${t('search_placeholder')}" value="${search}" />
        </div>
        <button class="btn btn-primary" id="add-customer-btn">${t('new_customer')}</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('customer_name')}</th>
              ${showBranchColumn ? `<th>${t('branch')}</th>` : ''}
              <th>${t('customer_phone')}</th>
              <th>السيارة</th>
              <th>رقم العربية</th>
              <th>${t('total_purchases')}</th>
              <th>${t('visits_count')}</th>
              <th>${t('last_visit')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="cust-tbody"></tbody>
        </table>
        ${customers.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    container.querySelector('#cust-tbody').innerHTML = customers
      .map(
        (c) => `
      <tr>
        <td><strong>${c.name}</strong></td>
        ${showBranchColumn ? `<td>${c.branches?.name || '—'}</td>` : ''}
        <td class="mono-num">${c.phone || `<span class="text-muted">${t('no_phone')}</span>`}</td>
        <td>${c.vehicle_type || `<span class="text-muted">—</span>`}</td>
        <td class="mono-num">${c.vehicle_number || `<span class="text-muted">—</span>`}</td>
        <td class="mono-num">${Number(c.total_purchases).toFixed(2)}</td>
        <td class="mono-num">${c.visits_count}</td>
        <td class="mono-num">${c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString('ar-EG') : t('never_visited')}</td>
        <td>
          ${c.phone ? `<a class="btn btn-icon" href="${whatsappLink(c.phone)}" target="_blank" title="${t('whatsapp')}">${CUSTOMER_ICONS.whatsapp}</a>` : ''}
          <button class="btn btn-icon" data-history="${c.id}" title="${t('purchase_history')}">${CUSTOMER_ICONS.history}</button>
          <button class="btn btn-icon" data-ledger="${c.id}" title="${t('customer_ledger')}">${CUSTOMER_ICONS.ledger}</button>
          <button class="btn btn-icon" data-edit="${c.id}" title="${t('edit')}">${CUSTOMER_ICONS.edit}</button>
          <button class="btn btn-icon" data-delete="${c.id}" title="${t('delete')}">${CUSTOMER_ICONS.delete}</button>
        </td>
      </tr>`
      )
      .join('');

    container.querySelector('#search-input').addEventListener('input', (e) => {
      search = e.target.value;
      debounceLoad();
    });
    container.querySelector('#add-customer-btn').addEventListener('click', () => openModal(null));
    container.querySelector('#inactive-customers-btn').addEventListener('click', () => openInactiveCustomers());

    container.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openModal(customers.find((c) => c.id === btn.dataset.edit)))
    );
    container.querySelectorAll('[data-history]').forEach((btn) =>
      btn.addEventListener('click', () => openStatement(customers.find((c) => c.id === btn.dataset.history)))
    );
    container.querySelectorAll('[data-ledger]').forEach((btn) =>
      btn.addEventListener('click', () => openLedger(customers.find((c) => c.id === btn.dataset.ledger)))
    );
    container.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await deleteCustomer(btn.dataset.delete);
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

  function openModal(customer) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${customer ? t('edit_customer') : t('new_customer')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="cust-form">
            ${showBranchColumn ? `
            <div class="field">
              <label>${t('branch')}</label>
              <select class="input" name="branch_id" required>
                ${branches.map((b) => `<option value="${b.id}" ${customer?.branch_id === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="field">
              <label>${t('customer_name')}</label>
              <input class="input" name="name" required value="${customer?.name || ''}" />
            </div>
            <div class="field">
              <label>${t('customer_phone')}</label>
              <input class="input" name="phone" type="tel" required value="${customer?.phone || ''}" />
            </div>
            <div class="flex gap-16">
              <div class="field" style="flex:1;">
                <label>السيارة</label>
                <input class="input" name="vehicle_type" required value="${customer?.vehicle_type || ''}" placeholder="مثال: هيونداي إلنترا" />
              </div>
              <div class="field" style="flex:1;">
                <label>رقم العربية</label>
                <input class="input" name="vehicle_number" required value="${customer?.vehicle_number || ''}" placeholder="مثال: ع م ر 1234" />
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-cust-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-cust-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#cust-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name').trim(),
        phone: fd.get('phone').trim() || null,
        vehicle_type: fd.get('vehicle_type')?.trim() || null,
        vehicle_number: fd.get('vehicle_number')?.trim() || null
      };
      if (!customer) payload.branch_id = showBranchColumn ? fd.get('branch_id') : branchId;
      try {
        if (customer) await updateCustomer(customer.id, payload);
        else await createCustomer(payload);
        toast(t('success'), 'success');
        overlay.remove();
        loadData();
      } catch (err) {
        toast(err.message?.includes('duplicate') ? 'رقم الهاتف مستخدم بالفعل' : t('error_occurred'), 'error');
      }
    });
  }

  function getInactiveCustomers() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    return customers.filter((c) => {
      if (!c.phone) return false;
      const referenceDate = c.last_visit_at ? new Date(c.last_visit_at) : new Date(c.created_at || 0);
      return referenceDate <= cutoff;
    });
  }

  function openInactiveCustomers() {
    const inactive = getInactiveCustomers();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const waText = 'مرحبًا {customer} 👋\nاشتقنا لزيارتكم في POINT. نحب نطمن عليكم ونشوف العربية ونساعدكم في أي صيانة أو خدمة تحتاجوها.\nيسعدنا تشريفكم مرة أخرى ❤️';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>عملاء غير نشطين 3 شهور فأكثر (${inactive.length})</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="card card-pad" style="margin-bottom:12px; background:var(--color-surface-2);">فتح واتساب لا يرسل الرسالة تلقائيًا؛ يفتح المحادثة برسالة جاهزة لكل عميل لتراجعها وترسلها.</div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>العميل</th><th>الهاتف</th><th>السيارة</th><th>آخر زيارة</th><th>واتساب</th></tr></thead>
              <tbody>
                ${inactive.map((c) => {
                  const label = c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString('ar-EG') : 'لم يزر بعد';
                  const msg = waText.replace('{customer}', c.name || 'عميلنا العزيز');
                  return `<tr><td><strong>${c.name || '—'}</strong></td><td class="mono-num">${c.phone}</td><td>${c.vehicle_type || '—'}${c.vehicle_number ? ` — ${c.vehicle_number}` : ''}</td><td>${label}</td><td><a class="btn btn-ghost btn-sm" href="${whatsappLink(c.phone, msg)}" target="_blank">💬 إرسال</a></td></tr>`;
                }).join('') || `<tr><td colspan="5" style="text-align:center;">لا يوجد عملاء تنطبق عليهم الفلاتر.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="open-all-inactive-wa" ${inactive.length ? '' : 'disabled'}>💬 فتح واتساب للجميع</button>
          <button class="btn btn-ghost" data-close>${t('close')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#open-all-inactive-wa')?.addEventListener('click', () => {
      inactive.forEach((c) => {
        const msg = waText.replace('{customer}', c.name || 'عميلنا العزيز');
        window.open(whatsappLink(c.phone, msg), '_blank');
      });
    });
  }

  // Clear financial ledger: every completed invoice (debit) and every
  // payment (credit), merged chronologically with a running balance — the
  // same shape as the supplier statement in suppliers.js. This is separate
  // from openStatement() below, which stays focused on browsing/editing
  // individual invoices; this view is purely the money trail.
  async function openLedger(customer) {
    const entries = await getCustomerLedger(customer.id);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>${t('customer_ledger')} - ${customer.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="card card-pad" style="background:var(--color-surface-2); margin-bottom:14px;">
            <div class="summary-row total-row"><span>${t('remaining_balance')}</span><span class="mono-num">${Number(customer.balance || 0).toFixed(2)}</span></div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>${t('sale_date')}</th><th>${t('invoice_number')}</th><th>${t('debit')}</th><th>${t('credit')}</th><th>${t('payment_method')}</th><th>${t('running_balance')}</th></tr></thead>
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
        <div class="modal-footer">
          <button class="btn btn-primary" data-close>${t('close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // Shows every invoice for this customer independently — each with its own
  // items table — plus the ability to add a new invoice or edit an existing
  // one directly from here.
  async function openStatement(customer) {
    let sales = await getCustomerPurchaseHistory(customer.id);
    let paidBySale = await getInvoicePaymentSummary(sales.map((sale) => sale.id));
    let ledger = await getCustomerLedger(customer.id);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-xl">
        <div class="modal-header">
          <h3>${t('customer_statement')} - ${customer.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="flex justify-between items-center" style="margin-bottom:14px; flex-wrap:wrap; gap:10px;">
            <div class="flex gap-12" style="flex-wrap:wrap;"><div class="text-muted">${t('total_purchases')}: <strong class="mono-num" id="statement-total">0.00</strong></div><div class="text-muted">إجمالي المرتجعات: <strong class="mono-num" id="statement-returns">0.00</strong></div><div class="text-muted">إجمالي المدفوع: <strong class="mono-num" id="statement-paid">0.00</strong></div><div class="text-muted"><span id="statement-balance-label">الرصيد المستحق</span>: <strong class="mono-num" id="statement-balance">0.00</strong></div></div>
            <div class="flex gap-8" style="flex-wrap:wrap;"><button class="btn btn-ghost" id="add-payment-btn">💵 تسجيل دفعة</button><button class="btn btn-ghost" id="apply-credit-btn">💳 تسديد مستحقات العميل</button><button class="btn btn-primary" id="add-invoice-btn">➕ ${t('add_invoice')}</button></div>
            <div class="text-muted" style="font-size:12px; width:100%;">زر تسديد المستحقات يخصم تلقائيًا من الرصيد المتاح للعميل.</div>
          </div>
          <div class="card card-pad" style="margin-bottom:14px;"><button class="btn btn-ghost" id="toggle-customer-ledger" aria-expanded="false">${CUSTOMER_ICONS.ledger} كشف الحساب الكامل <span>▾</span></button><div id="customer-ledger" hidden></div></div>
          <div id="invoices-list"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" data-close>${t('close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function invoiceCardHtml(sale) {
      const items = sale.sale_items || [];
      const paid = Number(paidBySale[sale.id] || 0);
      const remaining = Math.max(Number(sale.total) - paid, 0);
      const currentPaymentStatus = paymentStatus(sale.total, paid);
      const canEdit = sale.status === 'completed' && canManage(profile.role);
      return `
        <div class="card card-pad" style="margin-bottom:14px;">
          <button class="btn btn-ghost" data-toggle-invoice aria-expanded="false" style="width:100%; text-align:inherit;">
          <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:6px;">
            <div>
              <strong class="mono-num">${sale.invoice_number}</strong>
              <span class="badge ${STATUS_BADGE[sale.status] || 'badge-muted'}" style="margin-inline-start:8px;">${t(STATUS_LABEL[sale.status] || sale.status)}</span>
              <span class="badge ${currentPaymentStatus === 'paid' ? 'badge-success' : currentPaymentStatus === 'partial' ? 'badge-warning' : 'badge-danger'}" style="margin-inline-start:4px;">${currentPaymentStatus === 'paid' ? 'مدفوعة' : currentPaymentStatus === 'partial' ? 'مدفوعة جزئيًا' : 'غير مدفوعة'}</span>
            </div>
            <div class="text-muted mono-num">${new Date(sale.created_at).toLocaleString('ar-EG')}</div>
          </div><span>▾</span></button>
          <div data-invoice-body hidden>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>${t('item')}</th><th>${t('quantity')}</th><th>${t('unit_price')}</th><th>${t('line_total')}</th></tr></thead>
              <tbody>
                ${items.length
                  ? items.map((i) => `<tr><td>${i.product_name}</td><td class="mono-num">${i.quantity}</td><td class="mono-num">${Number(i.unit_price).toFixed(2)}</td><td class="mono-num">${Number(i.total).toFixed(2)}</td></tr>`).join('')
                  : `<tr><td colspan="4" class="text-muted">${t('no_items_added')}</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="flex justify-between items-center" style="margin-top:8px; flex-wrap:wrap; gap:6px;">
            <div class="text-muted">${t('payment_method')}: ${paymentMethodLabel(sale.payment_method)}</div>
            <div class="mono-num" style="font-weight:800; font-size:15px;">${t('total')}: ${Number(sale.total).toFixed(2)} · المدفوع: ${paid.toFixed(2)} · المتبقي: ${remaining.toFixed(2)}</div>
          </div>
          ${canEdit ? `
          <div class="flex" style="gap:8px; margin-top:10px; justify-content:flex-end;">
            <button class="btn btn-ghost btn-sm" data-edit-invoice="${sale.id}">✏️ ${t('edit_invoice')}</button>
            <button class="btn btn-danger btn-sm" data-cancel-invoice="${sale.id}">🗑️ ${t('cancel_invoice')}</button>
          </div>` : ''}
          </div>
        </div>`;
    }

    function renderList() {
      const total = sales.filter((sale) => sale.status === 'completed').reduce((sum, sale) => sum + Number(sale.total), 0);
      const paid = sales.reduce((sum, sale) => sum + Number(paidBySale[sale.id] || 0), 0);
      const totalReturns = ledger.filter((entry) => entry.type === 'return').reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
      overlay.querySelector('#statement-total').textContent = total.toFixed(2);
      overlay.querySelector('#statement-returns').textContent = totalReturns.toFixed(2);
      overlay.querySelector('#statement-paid').textContent = paid.toFixed(2);
      const currentBalance = Number(ledger[0]?.balance || 0);
      overlay.querySelector('#statement-balance-label').textContent = currentBalance < 0 ? 'رصيد متاح للعميل' : 'الرصيد المستحق';
      overlay.querySelector('#statement-balance').textContent = Math.abs(currentBalance).toFixed(2);
      overlay.querySelector('#customer-ledger').innerHTML = ledger.length
        ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد بعد</th><th>طريقة الدفع</th><th>البيان</th></tr></thead><tbody>${ledger.map((entry) => `<tr><td class="mono-num">${new Date(entry.date).toLocaleString('ar-EG')}</td><td>${entry.type === 'sale' ? 'فاتورة' : entry.type === 'return' ? 'مرتجع' : 'دفعة'}</td><td>${entry.ref || '—'}</td><td class="mono-num">${entry.debit ? entry.debit.toFixed(2) : '—'}</td><td class="mono-num">${entry.credit ? entry.credit.toFixed(2) : '—'}</td><td class="mono-num"><strong>${entry.balance.toFixed(2)}</strong></td><td>${entry.paymentMethod ? paymentMethodLabel(entry.paymentMethod) : '—'}</td><td>${entry.note || '—'}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="table-empty">${t('no_data')}</div>`;
      const listEl = overlay.querySelector('#invoices-list');
      listEl.innerHTML = sales.length
        ? sales.map((s) => invoiceCardHtml(s)).join('')
        : `<div class="table-empty">${t('no_data')}</div>`;
      listEl.querySelectorAll('[data-edit-invoice]').forEach((btn) =>
        btn.addEventListener('click', () => openInvoiceForm(sales.find((s) => s.id === btn.dataset.editInvoice)))
      );
      listEl.querySelectorAll('[data-cancel-invoice]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog(t('confirm_delete'));
          if (!ok) return;
          try {
            await refundSale(btn.dataset.cancelInvoice);
            toast(t('success'), 'success');
            sales = await getCustomerPurchaseHistory(customer.id);
            paidBySale = await getInvoicePaymentSummary(sales.map((sale) => sale.id));
            ledger = await getCustomerLedger(customer.id);
            renderList();
            loadData();
          } catch (err) {
            toast(err?.message === 'CASH_DRAWER_CLOSED'
              ? 'لا يمكن الإلغاء قبل فتح شيفت الدرج (فاتورة نقدية).'
              : t('error_occurred'), 'error');
          }
        })
      );
      listEl.querySelectorAll('[data-toggle-invoice]').forEach((btn) => btn.addEventListener('click', (event) => {
        const body = event.currentTarget.parentElement.querySelector('[data-invoice-body]');
        body.hidden = !body.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
        event.currentTarget.querySelector('span').textContent = body.hidden ? '▾' : '▴';
      }));
    }
    renderList();

    overlay.querySelector('#add-invoice-btn').addEventListener('click', () => openInvoiceForm(null));
    overlay.querySelector('#add-payment-btn').addEventListener('click', openPaymentModal);
    overlay.querySelector('#apply-credit-btn').addEventListener('click', async () => {
      const customerBranchId = customer.branch_id || branchId;
      if (!customerBranchId) {
        toast('اختر فرعًا محددًا لتسديد المستحقات.', 'error');
        return;
      }
      try {
        const result = await window.electronAPI?.business?.execute('customer:apply-credit', { customerId: customer.id, branchId: customerBranchId });
        if (result?.error) throw new Error(result.error.message);
        const applied = Number(result?.data?.applied || 0);
        const available = Number(result?.data?.availableCredit || 0);
        toast(applied > 0 ? `تم تسديد ${applied.toFixed(2)} من الرصيد المتاح.${available > 0 ? ` المتبقي المتاح: ${available.toFixed(2)}.` : ''}` : 'لا يوجد رصيد متاح قابل للتسديد.', applied > 0 ? 'success' : 'info');
        sales = await getCustomerPurchaseHistory(customer.id);
        paidBySale = await getInvoicePaymentSummary(sales.map((sale) => sale.id));
        ledger = await getCustomerLedger(customer.id);
        renderList();
        loadData();
      } catch (error) {
        toast(error.message || t('error_occurred'), 'error');
      }
    });
    overlay.querySelector('#toggle-customer-ledger').addEventListener('click', (event) => {
      const body = overlay.querySelector('#customer-ledger');
      body.hidden = !body.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
      event.currentTarget.querySelector('span').textContent = body.hidden ? '▾' : '▴';
    });
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    function openPaymentModal() {
      const outstanding = sales.filter((sale) => sale.status === 'completed').reduce((sum, sale) => sum + Math.max(Number(sale.total) - Number(paidBySale[sale.id] || 0), 0), 0);
      const paymentOverlay = document.createElement('div');
      paymentOverlay.className = 'modal-overlay';
      paymentOverlay.innerHTML = `<div class="modal-box"><div class="modal-header"><h3>تسجيل دفعة عميل</h3><button class="btn btn-icon" data-close>✕</button></div><div class="modal-body"><div class="text-muted" style="margin-bottom:12px;">الرصيد المستحق: <strong class="mono-num">${outstanding.toFixed(2)}</strong></div><form><div class="field"><label>${t('amount')}</label><input class="input" type="number" name="amount" min="0.001" max="${outstanding}" step="0.001" value="${outstanding.toFixed(2)}" required></div><div class="field"><label>${t('payment_method')}</label><select class="input" name="method">${paymentMethodOptions()}</select></div><div class="field"><label>${t('description')}</label><input class="input" name="notes"></div></form></div><div class="modal-footer"><button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="save-payment">${t('save')}</button></div></div>`;
      document.body.appendChild(paymentOverlay);
      paymentOverlay.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => paymentOverlay.remove()));
      paymentOverlay.querySelector('#save-payment').addEventListener('click', async () => {
        const form = paymentOverlay.querySelector('form'); if (!form.reportValidity()) return;
        const values = new FormData(form);
        try {
          await recordCustomerPayment({ customerId: customer.id, branchId: customer.branch_id || branchId, amount: Number(values.get('amount')), paymentMethod: values.get('method'), receivedBy: profile.id, notes: values.get('notes').trim() || null });
          paymentOverlay.remove(); sales = await getCustomerPurchaseHistory(customer.id); paidBySale = await getInvoicePaymentSummary(sales.map((sale) => sale.id)); ledger = await getCustomerLedger(customer.id); renderList(); loadData(); toast(t('success'), 'success');
        } catch (error) { toast(error?.message === 'PAYMENT_EXCEEDS_OUTSTANDING' ? 'المبلغ أكبر من الرصيد المستحق.' : t('error_occurred'), 'error'); }
      });
    }

    // Add (existingSale = null) or edit (existingSale set) a single invoice's
    // items, discount and payment method.
    async function openInvoiceForm(existingSale) {
      const isEdit = !!existingSale;
      let products = [];
      try {
        products = await listProducts({ onlyActive: true, branchId: customer.branch_id || branchId });
      } catch {
        products = [];
      }

      let items = isEdit
        ? (existingSale.sale_items || []).map((i) => ({
            productId: i.product_id,
            productName: i.product_name,
            unitPrice: Number(i.unit_price),
            originalUnitPrice: Number(i.original_unit_price ?? i.unit_price),
            unitCost: Number(i.unit_cost || 0),
            quantity: Number(i.quantity)
          }))
        : [];

      const formOverlay = document.createElement('div');
      formOverlay.className = 'modal-overlay';
      formOverlay.innerHTML = `
        <div class="modal-box modal-xl">
          <div class="modal-header">
            <h3>${isEdit ? `${t('edit_invoice')} - ${existingSale.invoice_number}` : t('add_invoice')}</h3>
            <button class="btn btn-icon" data-close>✕</button>
          </div>
          <div class="modal-body">
            <form id="invoice-form">
              <div class="table-wrap" style="margin-bottom:14px;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width:34%">${t('item')}</th>
                      <th>${t('quantity')}</th>
                      <th>${t('unit_price')}</th>
                      <th>${t('line_total')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody id="inv-items-tbody"></tbody>
                </table>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="add-line-btn">+ ${t('add_line')}</button>

              <div class="flex gap-12" style="margin-top:16px;">
                <div class="field" style="flex:1">
                  <label>${t('discount_percent')}</label>
                  <input class="input" type="number" min="0" max="100" step="0.01" name="discountPercent" value="0" />
                </div>
                <div class="field" style="flex:1">
                  <label>${t('payment_method')}</label>
                  <select class="input" name="payment_method">${paymentMethodOptions(existingSale?.payment_method || 'cash')}</select>
                </div>
              </div>
              <div class="card card-pad" style="background:var(--color-primary-light); border:none; margin-top:10px;">
                <div class="summary-row"><span>${t('subtotal')}</span><span class="mono-num" id="inv-subtotal">0.00</span></div>
                <div class="summary-row total-row"><span>${t('total')}</span><span class="mono-num" id="inv-total">0.00</span></div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" data-close>${t('cancel')}</button>
            <button class="btn btn-primary" id="save-invoice-btn">${t('save')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(formOverlay);

      const tbody = formOverlay.querySelector('#inv-items-tbody');
      const subtotalEl = formOverlay.querySelector('#inv-subtotal');
      const totalEl = formOverlay.querySelector('#inv-total');
      const discountInput = formOverlay.querySelector('[name="discountPercent"]');

      if (isEdit && Number(existingSale.subtotal) > 0) {
        discountInput.value = ((Number(existingSale.discount) / Number(existingSale.subtotal)) * 100).toFixed(2);
      }

      function computeSubtotal() {
        return items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
      }
      function recalc() {
        const subtotal = computeSubtotal();
        const discountPercent = Math.min(Math.max(Number(discountInput.value || 0), 0), 100);
        const total = Math.max(subtotal - subtotal * (discountPercent / 100), 0);
        subtotalEl.textContent = subtotal.toFixed(2);
        totalEl.textContent = total.toFixed(2);
      }

      function renderRows() {
        if (items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${t('no_items_added')}</td></tr>`;
        } else {
          tbody.innerHTML = items
            .map(
              (it, idx) => `
            <tr>
              <td>
                <button type="button" class="input purchase-product-picker" data-product="${idx}">${it.productName || t('select_product')}</button>
              </td>
              <td><input class="input" type="number" step="1" min="1" data-qty="${idx}" value="${it.quantity}" style="width:80px;" /></td>
              <td><input class="input" type="number" step="0.01" min="0" data-price="${idx}" value="${it.unitPrice}" style="width:100px;" /></td>
              <td class="mono-num">${(Number(it.quantity || 0) * Number(it.unitPrice || 0)).toFixed(2)}</td>
              <td><button type="button" class="btn btn-icon" data-remove-line="${idx}">✕</button></td>
            </tr>`
            )
            .join('');
        }

        tbody.querySelectorAll('[data-product]').forEach((button) =>
          button.addEventListener('click', () => openProductPicker(Number(button.dataset.product)))
        );
        tbody.querySelectorAll('[data-qty]').forEach((inp) =>
          inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.qty);
            items[idx].quantity = Number(inp.value || 0);
            inp.closest('tr').querySelector('td.mono-num').textContent =
              (Number(items[idx].quantity || 0) * Number(items[idx].unitPrice || 0)).toFixed(2);
            recalc();
          })
        );
        tbody.querySelectorAll('[data-price]').forEach((inp) =>
          inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.price);
            items[idx].unitPrice = Number(inp.value || 0);
            inp.closest('tr').querySelector('td.mono-num').textContent =
              (Number(items[idx].quantity || 0) * Number(items[idx].unitPrice || 0)).toFixed(2);
            recalc();
          })
        );
        tbody.querySelectorAll('[data-remove-line]').forEach((btn) =>
          btn.addEventListener('click', () => {
            items.splice(Number(btn.dataset.removeLine), 1);
            renderRows();
            recalc();
          })
        );
      }

      formOverlay.querySelector('#add-line-btn').addEventListener('click', () => {
        items.push({ productId: null, productName: '', unitPrice: 0, unitCost: 0, quantity: 1 });
        renderRows();
        recalc();
      });

      function openProductPicker(itemIndex) {
        let search = '';
        const picker = document.createElement('div');
        picker.className = 'modal-overlay';
        picker.innerHTML = `
          <div class="modal-box modal-lg">
            <div class="modal-header"><h3>${t('select_product')}</h3><button class="btn btn-icon" data-close>✕</button></div>
            <div class="modal-body">
              <div class="input-search" style="margin-bottom:14px;"><input id="customer-product-search" placeholder="ابحث باسم المنتج أو الباركود" autofocus autocomplete="off" /></div>
              <div class="table-wrap"><table class="data-table"><thead><tr><th>${t('item')}</th><th>${t('stock')}</th><th>${t('unit_price')}</th></tr></thead><tbody id="customer-product-list"></tbody></table></div>
            </div>
            <div class="modal-footer"><button class="btn btn-ghost" data-close>${t('cancel')}</button></div>
          </div>`;
        document.body.appendChild(picker);
        const list = picker.querySelector('#customer-product-list');
        const renderProducts = () => {
          const term = search.toLowerCase();
          const matches = products.filter((product) => !term || product.name.toLowerCase().includes(term) || (product.barcode || '').includes(search));
          list.innerHTML = matches.map((product) => `<tr class="product-picker-row" data-picker-product="${product.id}"><td><strong>${product.name}</strong>${product.barcode ? `<div class="text-muted" style="font-size:11px;">${product.barcode}</div>` : ''}</td><td class="mono-num">${Number(product.stock_quantity || 0)}</td><td class="mono-num">${Number(product.price || 0).toFixed(2)}</td></tr>`).join('') || `<tr><td colspan="3" class="table-empty">${t('no_data')}</td></tr>`;
          list.querySelectorAll('[data-picker-product]').forEach((row) => row.addEventListener('click', () => {
            const product = products.find((candidate) => candidate.id === row.dataset.pickerProduct);
            if (!product || !items[itemIndex]) return;
            items[itemIndex].productId = product.id;
            items[itemIndex].productName = product.name;
            items[itemIndex].unitCost = Number(product.cost || 0);
            items[itemIndex].unitPrice = Number(product.price || 0);
            items[itemIndex].originalUnitPrice = Number(product.price || 0);
            picker.remove(); renderRows(); recalc();
          }));
        };
        picker.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => picker.remove()));
        picker.querySelector('#customer-product-search').addEventListener('input', (event) => { search = event.target.value.trim(); renderProducts(); });
        renderProducts();
      }

      discountInput.addEventListener('input', recalc);
      renderRows();
      recalc();

      formOverlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => formOverlay.remove()));
      formOverlay.addEventListener('click', (e) => { if (e.target === formOverlay) formOverlay.remove(); });

      formOverlay.querySelector('#save-invoice-btn').addEventListener('click', async () => {
        const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
        if (validItems.length === 0) {
          toast(t('no_items_added'), 'error');
          return;
        }
        const fd = new FormData(formOverlay.querySelector('#invoice-form'));
        const subtotal = computeSubtotal();
        const discountPercent = Math.min(Math.max(Number(fd.get('discountPercent') || 0), 0), 100);
        const discount = subtotal * (discountPercent / 100);
        const btn = formOverlay.querySelector('#save-invoice-btn');
        btn.disabled = true;
        try {
          if (isEdit) {
            await updateSaleItems({
              saleId: existingSale.id,
              branchId: existingSale.branch_id,
              items: validItems.map((it) => ({
                product_id: it.productId,
                product_name: it.productName,
                quantity: it.quantity,
                unit_price: it.unitPrice,
                original_unit_price: it.originalUnitPrice ?? it.unitPrice,
                unit_cost: it.unitCost
              })),
              discount,
              tax: Number(existingSale.tax || 0),
              paymentMethod: fd.get('payment_method')
            });
          } else {
            await createSale({
              branchId: customer.branch_id || branchId,
              cashierId: profile.id,
              cart: validItems.map((it) => ({ id: it.productId, name: it.productName, price: it.unitPrice, defaultPrice: it.originalUnitPrice ?? it.unitPrice, cost: it.unitCost, qty: it.quantity })),
              discount,
              tax: 0,
              paymentMethod: fd.get('payment_method'),
              customerId: customer.id,
              customerName: customer.name,
              customerPhone: customer.phone,
              customerVehicleType: customer.vehicle_type,
              customerVehicleNumber: customer.vehicle_number
            });
          }
          toast(t('success'), 'success');
          formOverlay.remove();
          sales = await getCustomerPurchaseHistory(customer.id);
          paidBySale = await getInvoicePaymentSummary(sales.map((sale) => sale.id));
          ledger = await getCustomerLedger(customer.id);
          renderList();
          loadData();
        } catch {
          toast(t('error_occurred'), 'error');
          btn.disabled = false;
        }
      });
    }
  }

  await loadData();

  const unsubscribe = subscribeRealtime(['customers'], () => {
    if (document.body.contains(container)) loadData();
  });
  return unsubscribe;
}
