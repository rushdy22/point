import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listSales, getSaleDetails, refundSale, markInvoicePrinted } from '../lib/db/sales.js';
import { openReceiptPreview } from '../lib/printer.js';
import { loadBranchSettings } from '../lib/settings.js';
import { canManage } from '../lib/permissions.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { listProfiles } from '../lib/db/users.js';
import { paymentMethodLabel } from '../lib/paymentMethods.js';

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23,59,59,999); return x; }

const STATUS_LABEL = { completed: 'completed', refunded: 'refunded', cancelled: 'cancelled' };
const STATUS_BADGE = { completed: 'badge-success', refunded: 'badge-danger', cancelled: 'badge-muted' };

export async function renderSalesHistory(container, profile, branchId) {
  let range = 'today';
  let cashierFilter = '';
  let sales = [];
  let cashiers = [];
  const showBranchColumn = !branchId;

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  try {
    cashiers = await listProfiles();
  } catch {
    cashiers = [];
  }

  function getRangeDates() {
    const now = new Date();
    if (range === 'today') return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    if (range === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      return { from: first.toISOString(), to: last.toISOString() };
    }
    return { from: null, to: null };
  }

  async function loadData() {
    const { from, to } = getRangeDates();
    sales = await listSales({ from, to, cashierId: cashierFilter || null, branchId });
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom:18px; flex-wrap:wrap; gap:12px;">
        <div class="flex gap-8">
          <button class="pill ${range === 'today' ? 'active' : ''}" data-range="today">${t('today')}</button>
          <button class="pill ${range === 'month' ? 'active' : ''}" data-range="month">${t('this_month')}</button>
          <button class="pill ${range === 'all' ? 'active' : ''}" data-range="all">${t('all')}</button>
        </div>
        <select class="input" id="cashier-filter" style="max-width:220px;">
          <option value="">${t('all_cashiers')}</option>
          ${cashiers.map((c) => `<option value="${c.id}" ${cashierFilter === c.id ? 'selected' : ''}>${c.full_name || '—'}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('invoice_number')}</th>
              ${showBranchColumn ? `<th>${t('branch')}</th>` : ''}
              <th>${t('sale_date')}</th>
              <th>${t('cashier')}</th>
              <th>${t('total')}</th>
              <th>${t('payment_method')}</th>
              <th>${t('status')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="sales-tbody"></tbody>
        </table>
        ${sales.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    container.querySelectorAll('[data-range]').forEach((btn) =>
      btn.addEventListener('click', () => { range = btn.dataset.range; loadData(); })
    );
    container.querySelector('#cashier-filter').addEventListener('change', (e) => {
      cashierFilter = e.target.value;
      loadData();
    });

    container.querySelector('#sales-tbody').innerHTML = sales
      .map(
        (s) => `
      <tr>
        <td class="mono-num"><strong>${s.invoice_number}</strong></td>
        ${showBranchColumn ? `<td>${s.branches?.name || '—'}</td>` : ''}
        <td class="mono-num">${new Date(s.created_at).toLocaleString('ar-EG')}</td>
        <td>${s.profiles?.full_name || '—'}</td>
        <td class="mono-num">${Number(s.total).toFixed(2)}</td>
        <td>${paymentMethodLabel(s.payment_method)}</td>
        <td><span class="badge ${STATUS_BADGE[s.status]}">${t(STATUS_LABEL[s.status])}</span></td>
        <td>
          <button class="btn btn-icon" data-view="${s.id}" title="${t('view_details')}">👁️</button>
        </td>
      </tr>`
      )
      .join('');

    container.querySelectorAll('[data-view]').forEach((btn) =>
      btn.addEventListener('click', () => openDetails(btn.dataset.view))
    );
  }

  async function openDetails(saleId) {
    const { sale, items } = await getSaleDetails(saleId);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>${t('sale_details')} - ${sale.invoice_number}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="flex justify-between" style="margin-bottom:14px;">
            <div class="text-muted">${t('sale_date')}: ${new Date(sale.created_at).toLocaleString('ar-EG')}</div>
            <span class="badge ${STATUS_BADGE[sale.status]}">${t(STATUS_LABEL[sale.status])}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>${t('item')}</th><th>${t('quantity')}</th><th>${t('unit_price')}</th><th>${t('line_total')}</th></tr></thead>
              <tbody>
                ${items.map((i) => `<tr><td>${i.product_name}</td><td class="mono-num">${i.quantity}</td><td class="mono-num">${Number(i.unit_price).toFixed(2)}</td><td class="mono-num">${Number(i.total).toFixed(2)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="card card-pad" style="margin-top:14px; background:var(--color-surface-2);">
            <div class="summary-row"><span>${t('subtotal')}</span><span class="mono-num">${Number(sale.subtotal).toFixed(2)}</span></div>
            <div class="summary-row"><span>${t('discount')}</span><span class="mono-num">${Number(sale.discount).toFixed(2)}</span></div>
            <div class="summary-row"><span>${t('tax')}</span><span class="mono-num">${Number(sale.tax).toFixed(2)}</span></div>
            <div class="summary-row"><span>${t('payment_method')}</span><span>${paymentMethodLabel(sale.payment_method)}</span></div>
            <div class="summary-row total-row"><span>${t('total')}</span><span class="mono-num">${Number(sale.total).toFixed(2)}</span></div>
          </div>
        </div>
        <div class="modal-footer">
          ${sale.status === 'completed' && canManage(profile.role) ? `<button class="btn btn-danger" id="refund-btn">${t('refund')}</button>` : ''}
          <button class="btn btn-ghost" id="reprint-btn">🖨️ ${t('reprint')}</button>
          <button class="btn btn-primary" data-close>${t('close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));

    overlay.querySelector('#reprint-btn').addEventListener('click', async () => {
      // Reprint always uses the settings of the branch the sale itself
      // belongs to (sale.branch_id) — not whichever branch is currently
      // selected, which matters for an admin browsing "all branches".
      const settings = await loadBranchSettings(sale.branch_id);
      openReceiptPreview(sale, items, async () => {
        await markInvoicePrinted(sale.id);
        toast(t('success'), 'success');
      }, settings);
    });

    const refundBtn = overlay.querySelector('#refund-btn');
    if (refundBtn) {
      refundBtn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await refundSale(sale.id);
          toast(t('success'), 'success');
          overlay.remove();
          loadData();
        } catch {
          toast(t('error_occurred'), 'error');
        }
      });
    }
  }

  await loadData();

  let reloadTimer;
  const unsubscribe = subscribeRealtime(['sales'], () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (document.body.contains(container)) loadData();
    }, 500);
  });
  return unsubscribe;
}
