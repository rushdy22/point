import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listPurchases, getPurchaseDetails, createPurchase, cancelPurchase } from '../lib/db/purchases.js';
import { listSuppliers } from '../lib/db/suppliers.js';
import { listProducts } from '../lib/db/products.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { paymentMethodLabel, paymentMethodOptions } from '../lib/paymentMethods.js';

export async function renderPurchases(container, profile, branchId) {
  if (!branchId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏬</div>
        <div style="font-weight:700; font-size:15px;">${t('select_branch')}</div>
      </div>`;
    return;
  }

  let purchases = [];
  let suppliers = [];
  let products = [];

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    [purchases, suppliers, products] = await Promise.all([
      listPurchases({ branchId }),
      listSuppliers({ branchId }),
      listProducts({ onlyActive: true, branchId })
    ]);
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="flex justify-between items-center gap-16" style="margin-bottom:18px;">
        <h3 style="font-size:15px;">${t('purchases_title')}</h3>
        <button class="btn btn-primary" id="add-purchase-btn" ${suppliers.length === 0 ? 'disabled title="' + t('new_supplier') + '"' : ''}>${t('new_purchase')}</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('invoice_number')}</th>
              <th>${t('supplier')}</th>
              <th>${t('sale_date')}</th>
              <th>${t('total')}</th>
              <th>${t('paid_amount')}</th>
              <th>${t('payment_method')}</th>
              <th>${t('remaining_balance')}</th>
              <th>${t('purchase_status')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="purch-tbody"></tbody>
        </table>
        ${purchases.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    container.querySelector('#purch-tbody').innerHTML = purchases
      .map((p) => {
        const remaining = Number(p.total) - Number(p.paid_amount);
        const isCancelled = p.status === 'cancelled';
        return `
      <tr>
        <td class="mono-num"><strong>${p.invoice_number}</strong></td>
        <td>${p.suppliers?.name || '—'}</td>
        <td class="mono-num">${new Date(p.created_at).toLocaleString('ar-EG')}</td>
        <td class="mono-num">${Number(p.total).toFixed(2)}</td>
        <td class="mono-num">${Number(p.paid_amount).toFixed(2)}</td>
        <td>${paymentMethodLabel(p.payment_method)}</td>
        <td class="mono-num">
          ${remaining > 0 ? `<span class="badge badge-warning">${remaining.toFixed(2)}</span>` : `<span class="badge badge-success">${t('fully_paid')}</span>`}
        </td>
        <td><span class="badge ${isCancelled ? 'badge-muted' : 'badge-success'}">${isCancelled ? t('cancelled') : t('completed')}</span></td>
        <td>
          <button class="btn btn-icon" data-view="${p.id}" title="${t('view_details')}">👁️</button>
          ${!isCancelled ? `<button class="btn btn-icon" data-cancel="${p.id}" title="${t('cancel_purchase')}">🗑️</button>` : ''}
        </td>
      </tr>`;
      })
      .join('');

    container.querySelector('#add-purchase-btn')?.addEventListener('click', () => openPurchaseModal());
    container.querySelectorAll('[data-view]').forEach((btn) =>
      btn.addEventListener('click', () => openDetails(btn.dataset.view))
    );
    container.querySelectorAll('[data-cancel]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await cancelPurchase(btn.dataset.cancel);
          toast(t('purchase_cancelled'), 'success');
          loadData();
        } catch {
          toast(t('error_occurred'), 'error');
        }
      })
    );
  }

  function openPurchaseModal() {
    let items = []; // { productId, productName, unitCost, quantity }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-xl">
        <div class="modal-header">
          <h3>${t('new_purchase')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="purchase-form">
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>${t('supplier')}</label>
                <select class="input" name="supplier_id" required>
                  ${suppliers.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
                </select>
              </div>
              <div class="field" style="flex:1">
                <label>${t('supplier_notes')}</label>
                <input class="input" name="notes" />
              </div>
            </div>
            <div class="table-wrap" style="margin-bottom:14px;">
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width:34%">${t('item')}</th>
                    <th>${t('quantity')}</th>
                    <th>${t('purchase_price')}</th>
                    <th>${t('line_total')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="items-tbody"></tbody>
              </table>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="add-line-btn">+ ${t('add_line')}</button>

            <div class="card card-pad" style="background:var(--color-primary-light); border:none; margin-top:16px;">
              <div class="summary-row total-row"><span>${t('total')}</span><span class="mono-num" id="purchase-total">0.00</span></div>
              <div class="field" style="margin-top:10px;">
                <label>${t('paid_amount')}</label>
                <input class="input" type="number" step="0.01" min="0" name="paid_amount" id="paid-amount-input" value="0" />
              </div>
              <div class="field">
                <label>${t('payment_method')}</label>
                <select class="input" name="payment_method">${paymentMethodOptions()}</select>
              </div>
              <div class="summary-row" id="purchase-remaining"><span>${t('remaining_balance')}</span><span class="mono-num">0.00</span></div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-purchase-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const itemsTbody = overlay.querySelector('#items-tbody');
    const totalEl = overlay.querySelector('#purchase-total');
    const remainingEl = overlay.querySelector('#purchase-remaining span:last-child');
    const paidInput = overlay.querySelector('#paid-amount-input');

    function computeTotal() {
      return items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unitCost || 0), 0);
    }

    function recalc() {
      const total = computeTotal();
      totalEl.textContent = total.toFixed(2);
      const remaining = Math.max(total - Number(paidInput.value || 0), 0);
      remainingEl.textContent = remaining.toFixed(2);
    }

    // Updates just the line-total cell for one row in place, without
    // rebuilding the row's inputs — rebuilding on every keystroke was
    // wiping the qty/price fields and kicking the cursor out, making it
    // impossible to type a multi-digit number like 100.
    function updateLineTotal(inp) {
      const idx = Number(inp.dataset.qty ?? inp.dataset.cost);
      const it = items[idx];
      if (!it) return;
      const row = inp.closest('tr');
      const totalCell = row?.querySelector('td.mono-num');
      if (totalCell) totalCell.textContent = (Number(it.quantity || 0) * Number(it.unitCost || 0)).toFixed(2);
    }

    function renderRows() {
      if (items.length === 0) {
        itemsTbody.innerHTML = `<tr><td colspan="5" class="table-empty">${t('no_items_added')}</td></tr>`;
      } else {
        itemsTbody.innerHTML = items
          .map(
            (it, idx) => `
          <tr>
            <td>
              <button type="button" class="input purchase-product-picker" data-product="${idx}">${it.productName || t('select_product')}</button>
            </td>
                <td><input class="input" type="number" step="0.001" min="0.001" data-qty="${idx}" value="${it.quantity}" style="width:90px;" /></td>
            <td><input class="input" type="number" step="0.01" min="0" data-cost="${idx}" value="${it.unitCost}" style="width:100px;" /></td>
            <td class="mono-num">${(Number(it.quantity || 0) * Number(it.unitCost || 0)).toFixed(2)}</td>
            <td><button type="button" class="btn btn-icon" data-remove-line="${idx}">✕</button></td>
          </tr>`
          )
          .join('');
      }

      itemsTbody.querySelectorAll('[data-product]').forEach((button) =>
        button.addEventListener('click', () => openProductPicker(Number(button.dataset.product)))
      );
      itemsTbody.querySelectorAll('[data-qty]').forEach((inp) =>
        inp.addEventListener('input', () => {
          items[Number(inp.dataset.qty)].quantity = Number(inp.value || 0);
          updateLineTotal(inp);
          recalc();
        })
      );
      itemsTbody.querySelectorAll('[data-cost]').forEach((inp) =>
        inp.addEventListener('input', () => {
          items[Number(inp.dataset.cost)].unitCost = Number(inp.value || 0);
          updateLineTotal(inp);
          recalc();
        })
      );
      itemsTbody.querySelectorAll('[data-remove-line]').forEach((btn) =>
        btn.addEventListener('click', () => {
          items.splice(Number(btn.dataset.removeLine), 1);
          renderRows();
          recalc();
        })
      );
    }

    overlay.querySelector('#add-line-btn').addEventListener('click', () => {
      items.push({ productId: null, productName: '', unitCost: 0, quantity: 1 });
      renderRows();
      recalc();
    });
    paidInput.addEventListener('input', recalc);

    renderRows();
    recalc();

    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-purchase-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#purchase-form');
      if (!form.reportValidity()) return;

      const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
      if (validItems.length === 0) {
        toast(t('no_items_added'), 'error');
        return;
      }

      const fd = new FormData(form);
      const btn = overlay.querySelector('#save-purchase-btn');
      btn.disabled = true;
      try {
        await createPurchase({
          branchId,
          supplierId: fd.get('supplier_id'),
          items: validItems,
          paidAmount: Number(paidInput.value || 0),
          paymentMethod: fd.get('payment_method'),
          notes: fd.get('notes').trim() || null,
          createdBy: profile.id
        });
        toast(t('purchase_completed'), 'success');
        overlay.remove();
        loadData();
      } catch (error) {
        const message = error?.message || t('error_occurred');
        toast(`${t('error_occurred')}: ${message}`, 'error');
        btn.disabled = false;
      }
    });

    function openProductPicker(itemIndex) {
      let search = '';
      const picker = document.createElement('div');
      picker.className = 'modal-overlay';
      picker.innerHTML = `
        <div class="modal-box modal-lg">
          <div class="modal-header"><h3>${t('select_product')}</h3><button class="btn btn-icon" data-close>✕</button></div>
          <div class="modal-body">
            <div class="input-search" style="margin-bottom:14px;"><input id="product-picker-search" placeholder="ابحث باسم المنتج أو الباركود" autofocus autocomplete="off" /></div>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>${t('item')}</th><th>${t('stock')}</th><th>${t('purchase_price')}</th></tr></thead><tbody id="product-picker-list"></tbody></table></div>
          </div>
          <div class="modal-footer"><button class="btn btn-ghost" data-close>${t('cancel')}</button></div>
        </div>`;
      document.body.appendChild(picker);
      const list = picker.querySelector('#product-picker-list');
      const renderProducts = () => {
        const term = search.toLowerCase();
        const matches = products.filter((product) => !term || product.name.toLowerCase().includes(term) || (product.barcode || '').includes(search));
        list.innerHTML = matches.map((product) => `<tr class="product-picker-row" data-picker-product="${product.id}"><td><strong>${product.name}</strong>${product.barcode ? `<div class="text-muted" style="font-size:11px;">${product.barcode}</div>` : ''}</td><td class="mono-num">${Number(product.stock_quantity || 0)}</td><td class="mono-num">${Number(product.cost || 0).toFixed(2)}</td></tr>`).join('') || `<tr><td colspan="3" class="table-empty">${t('no_data')}</td></tr>`;
        list.querySelectorAll('[data-picker-product]').forEach((row) => row.addEventListener('click', () => {
          const product = products.find((candidate) => candidate.id === row.dataset.pickerProduct);
          if (!product || !items[itemIndex]) return;
          items[itemIndex].productId = product.id;
          items[itemIndex].productName = product.name;
          items[itemIndex].unitCost = Number(product.cost || 0);
          picker.remove(); renderRows(); recalc();
        }));
      };
      picker.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => picker.remove()));
      picker.querySelector('#product-picker-search').addEventListener('input', (event) => { search = event.target.value.trim(); renderProducts(); });
      renderProducts();
    }
  }

  async function openDetails(purchaseId) {
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
          <div class="flex justify-between" style="margin-bottom:14px;">
            <div class="text-muted">${t('supplier')}: <strong>${purchase.suppliers?.name || '—'}</strong></div>
            <div class="text-muted">${new Date(purchase.created_at).toLocaleString('ar-EG')}</div>
          </div>
          <div class="flex justify-between" style="margin-bottom:14px;">
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

  let reloadTimer;
  const unsubscribe = subscribeRealtime(['purchases', 'suppliers'], () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (document.body.contains(container)) loadData();
    }, 500);
  });
  return unsubscribe;
}
