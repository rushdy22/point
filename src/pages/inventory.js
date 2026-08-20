import { t } from '../i18n/index.js';
import { toast } from '../lib/toast.js';
import { listProducts } from '../lib/db/products.js';
import { listMovements, adjustStock, listTransfers, transferStock, getStockLedger } from '../lib/db/inventory.js';
import { listBranches } from '../lib/db/branches.js';
import { isGlobalAdmin } from '../lib/branchContext.js';
import { formatQuantity } from '../lib/decimal.js';

export async function renderInventory(container, profile, branchId) {
  let products = [];
  let movements = [];
  let transfers = [];
  let branches = [];
  let tab = 'stock';
  let stockFilter = 'all';
  let materialFilter = 'all';
  const showBranchColumn = !branchId;
  const canTransfer = isGlobalAdmin(profile);

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    [products, movements, branches] = await Promise.all([
      listProducts({ branchId }),
      listMovements({ limit: 100, branchId }),
      listBranches({ onlyActive: true })
    ]);
    if (canTransfer) transfers = await listTransfers({ branchId, limit: 100 });
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="flex gap-8" style="margin-bottom:18px;">
        <button class="pill ${tab === 'stock' ? 'active' : ''}" data-tab="stock">${t('current_stock')}</button>
        <button class="pill ${tab === 'history' ? 'active' : ''}" data-tab="history">${t('movement_history')}</button>
        ${canTransfer ? `<button class="pill ${tab === 'transfer' ? 'active' : ''}" data-tab="transfer">${t('transfer_between_branches')}</button>` : ''}
      </div>
      <div id="inventory-body"></div>
    `;

    container.querySelectorAll('[data-tab]').forEach((btn) =>
      btn.addEventListener('click', () => { tab = btn.dataset.tab; draw(); })
    );

    const body = container.querySelector('#inventory-body');
    if (tab === 'stock') drawStockTab(body);
    else if (tab === 'history') drawHistoryTab(body);
    else drawTransferTab(body);
  }

  function drawStockTab(body) {
    const inventoryValue = products.reduce((sum, product) => sum + (Math.max(Number(product.stock_quantity) || 0, 0) * (Number(product.cost) || 0)), 0);
    const visibleProducts = products.filter((p) => {
      const stock = Number(p.stock_quantity);
      const low = stock <= Number(p.low_stock_threshold);
      if (materialFilter === 'materials' && !p.is_raw_material) return false;
      if (materialFilter === 'products' && p.is_raw_material) return false;
      if (stockFilter === 'out') return stock <= 0;
      if (stockFilter === 'low') return stock > 0 && low;
      return true;
    });
    body.innerHTML = `
      <div class="flex gap-8" style="margin-bottom:14px; flex-wrap:wrap;">
        <div class="stat-card" style="flex:1; min-width:180px;" title="قيمة المخزون = مجموع (الكمية الحالية × تكلفة الصنف)"><div class="stat-icon">💰</div><div class="stat-label">${t('inventory_value')}</div><div class="stat-value mono-num">${inventoryValue.toFixed(2)}</div></div>
        <button class="stat-card" data-stock-filter="all" style="flex:1; min-width:150px; text-align:inherit; cursor:pointer; ${stockFilter === 'all' ? 'outline:2px solid var(--color-primary);' : ''}"><div class="stat-icon">📦</div><div class="stat-label">كل الأصناف</div><div class="stat-value mono-num">${products.length}</div></button>
        <button class="stat-card" data-material-filter="materials" style="flex:1; min-width:150px; text-align:inherit; cursor:pointer; ${materialFilter === 'materials' ? 'outline:2px solid var(--color-primary);' : ''}"><div class="stat-icon">🔧</div><div class="stat-label">مواد الصيانة</div><div class="stat-value mono-num">${products.filter((p) => p.is_raw_material).length}</div></button>
        <button class="stat-card" data-material-filter="products" style="flex:1; min-width:150px; text-align:inherit; cursor:pointer; ${materialFilter === 'products' ? 'outline:2px solid var(--color-primary);' : ''}"><div class="stat-icon">🛒</div><div class="stat-label">أصناف البيع</div><div class="stat-value mono-num">${products.filter((p) => !p.is_raw_material).length}</div></button>
        <button class="stat-card" data-stock-filter="out" style="flex:1; min-width:150px; text-align:inherit; cursor:pointer; ${stockFilter === 'out' ? 'outline:2px solid var(--color-danger);' : ''}"><div class="stat-icon">⛔</div><div class="stat-label">نفد المخزون</div><div class="stat-value mono-num">${products.filter((p) => Number(p.stock_quantity) <= 0).length}</div></button>
        <button class="stat-card" data-stock-filter="low" style="flex:1; min-width:150px; text-align:inherit; cursor:pointer; ${stockFilter === 'low' ? 'outline:2px solid var(--color-warning);' : ''}"><div class="stat-icon">⚠️</div><div class="stat-label">مخزون منخفض</div><div class="stat-value mono-num">${products.filter((p) => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.low_stock_threshold)).length}</div></button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('product_name')}</th>
              ${showBranchColumn ? `<th>${t('branch')}</th>` : ''}
              <th>${t('current_stock')}</th>
              <th>${t('low_stock_threshold')}</th>
              <th>${t('status')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${visibleProducts
              .map((p) => {
                const low = Number(p.stock_quantity) <= Number(p.low_stock_threshold);
                const out = Number(p.stock_quantity) <= 0;
                return `
              <tr data-ledger-row="${p.id}" style="cursor:pointer;">
                <td><strong>${p.name}</strong>${p.is_raw_material ? `<div><span class="badge badge-warning">🔧 مادة صيانة</span></div>` : ''}</td>
                ${showBranchColumn ? `<td>${p.branches?.name || '—'}</td>` : ''}
                <td class="mono-num">${formatQuantity(p.stock_quantity)} ${p.unit}</td>
                <td class="mono-num">${formatQuantity(p.low_stock_threshold)}</td>
                <td>${out ? `<span class="badge badge-danger">${t('out_of_stock')}</span>` : low ? `<span class="badge badge-warning">${t('low_stock')}</span>` : `<span class="badge badge-success">${t('active')}</span>`}</td>
                <td><button class="btn btn-sm btn-ghost" data-ledger="${p.id}">📒 حركة الصنف</button> <button class="btn btn-sm btn-ghost" data-adjust="${p.id}">${t('adjust_stock')}</button></td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
        ${visibleProducts.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;
    body.querySelectorAll('[data-stock-filter]').forEach((button) => button.addEventListener('click', () => { stockFilter = button.dataset.stockFilter; drawStockTab(body); }));
    body.querySelectorAll('[data-material-filter]').forEach((button) => button.addEventListener('click', () => { materialFilter = button.dataset.materialFilter; drawStockTab(body); }));
    body.querySelectorAll('[data-adjust]').forEach((btn) =>
      btn.addEventListener('click', () => openAdjustModal(products.find((p) => p.id === btn.dataset.adjust)))
    );
    body.querySelectorAll('[data-ledger]').forEach((btn) =>
      btn.addEventListener('click', () => openLedgerModal(products.find((p) => p.id === btn.dataset.ledger)))
    );
    body.querySelectorAll('[data-ledger-row]').forEach((row) => row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      openLedgerModal(products.find((p) => p.id === row.dataset.ledgerRow));
    }));
  }

  async function openLedgerModal(product) {
    if (!product) return;
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box" style="max-width:920px;"><div class="modal-header"><h3>📒 حركة الصنف — ${product.name}</h3><button class="btn btn-icon" data-close>✕</button></div><div class="modal-body"><div class="card card-pad" style="margin-bottom:12px;"><div class="summary-row"><span>الرصيد الحالي</span><strong class="mono-num">${Number(product.stock_quantity).toFixed(3).replace(/\.?0+$/, '')} ${product.unit || ''}</strong></div><div class="summary-row"><span>التكلفة</span><strong class="mono-num">${Number(product.cost || 0).toFixed(2)}</strong></div></div><div id="ledger-content"><div class="page-loader"><div class="spinner"></div></div></div></div><div class="modal-footer"><button class="btn btn-ghost" data-close>${t('close')}</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    try {
      const ledger = await getStockLedger({ productId: product.id, branchId: product.branch_id || branchId });
      overlay.querySelector('#ledger-content').innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع/البيان</th><th>داخل</th><th>خارج</th><th>الرصيد بعد</th><th>التكلفة</th></tr></thead><tbody>${ledger.map((m) => { const qty = Number(m.quantity || 0); return `<tr><td>${new Date(m.created_at).toLocaleString('ar-EG')}</td><td>${movementLabel(m.type)}</td><td>${m.reason || '—'}</td><td class="mono-num">${qty > 0 ? qty.toFixed(3).replace(/\.?0+$/, '') : '—'}</td><td class="mono-num">${qty < 0 ? Math.abs(qty).toFixed(3).replace(/\.?0+$/, '') : '—'}</td><td class="mono-num"><strong>${Number(m.balance_after).toFixed(3).replace(/\.?0+$/, '')}</strong></td><td class="mono-num">${Number(product.cost || 0).toFixed(2)}</td></tr>`; }).join('')}</tbody></table>${ledger.length ? '' : `<div class="table-empty">${t('no_data')}</div>`}</div>`;
    } catch (error) { overlay.querySelector('#ledger-content').innerHTML = `<div class="empty-state">${error.message || t('error_occurred')}</div>`; }
  }

  function drawHistoryTab(body) {
    body.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('product_name')}</th>
              ${showBranchColumn ? `<th>${t('branch')}</th>` : ''}
              <th>${t('movement_type')}</th>
              <th>${t('quantity')}</th>
              <th>${t('reason')}</th>
              <th>${t('performed_by')}</th>
              <th>${t('sale_date')}</th>
            </tr>
          </thead>
          <tbody>
            ${movements
              .map(
                (m) => `
              <tr>
                <td>${m.products?.name || '—'}</td>
                ${showBranchColumn ? `<td>${m.branches?.name || '—'}</td>` : ''}
                <td><span class="badge ${m.quantity >= 0 ? 'badge-success' : 'badge-danger'}">${t(movementLabel(m.type))}</span></td>
                <td class="mono-num">${m.quantity > 0 ? '+' : ''}${Number(m.quantity)}</td>
                <td>${m.reason || '—'}</td>
                <td>${m.profiles?.full_name || '—'}</td>
                <td class="mono-num">${new Date(m.created_at).toLocaleString('ar-EG')}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        ${movements.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;
  }

  function drawTransferTab(body) {
    body.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom:16px;">
        <div></div>
        <button class="btn btn-primary" id="new-transfer-btn">${t('transfer_stock')}</button>
      </div>
      <h3 style="margin-bottom:12px;">${t('transfer_history')}</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('product_name')}</th>
              <th>${t('from_branch')}</th>
              <th>${t('to_branch')}</th>
              <th>${t('quantity')}</th>
              <th>${t('performed_by')}</th>
              <th>${t('sale_date')}</th>
            </tr>
          </thead>
          <tbody>
            ${transfers
              .map(
                (tr) => `
              <tr>
                <td><strong>${tr.product_name}</strong>${tr.note ? `<div class="text-muted" style="font-size:11.5px;">${tr.note}</div>` : ''}</td>
                <td>${tr.from_branch?.name || '—'}</td>
                <td>${tr.to_branch?.name || '—'}</td>
                <td class="mono-num">${Number(tr.quantity)}</td>
                <td>${tr.profiles?.full_name || '—'}</td>
                <td class="mono-num">${new Date(tr.created_at).toLocaleString('ar-EG')}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        ${transfers.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;
    body.querySelector('#new-transfer-btn').addEventListener('click', openTransferModal);
  }

  function movementLabel(type) {
    return { in: 'stock_in', out: 'stock_out', adjustment: 'adjustment', stock_count: 'adjustment', sale: 'nav_cashier', refund: 'refund', purchase: 'stock_in', purchase_return: 'stock_out', transfer_in: 'stock_in', transfer_out: 'stock_out', opening_balance: 'opening_balance' }[type] || type;
  }

  function openAdjustModal(product) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${t('adjust_stock')} - ${product.name}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted">${t('current_stock')}: <strong class="mono-num">${Number(product.stock_quantity)} ${product.unit}</strong></p>
          <form id="adjust-form">
            <div class="field">
              <label>${t('movement_type')}</label>
              <select class="input" name="type">
                <option value="in">${t('stock_in')}</option>
                <option value="out">${t('stock_out')}</option>
                <option value="adjustment">${t('adjustment')}</option>
              </select>
            </div>
            <div class="field">
              <label>${t('quantity')}</label>
              <input class="input" type="number" step="0.001" min="0.001" name="quantity" required />
            </div>
            <div class="field">
              <label>${t('reason')}</label>
              <input class="input" name="reason" />
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-adjust-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-adjust-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#adjust-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      try {
        await adjustStock({
          productId: product.id,
          type: fd.get('type'),
          quantity: Number(fd.get('quantity')),
          reason: fd.get('reason') || null,
          userId: profile.id,
          branchId: product.branch_id
        });
        toast(t('success'), 'success');
        overlay.remove();
        loadData();
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  function openTransferModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${t('transfer_stock')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="transfer-form">
            <div class="field">
              <label>${t('select_product_to_transfer')}</label>
              <select class="input" name="from_product_id" required>
                ${products.map((p) => `<option value="${p.id}">${p.name} — ${p.branches?.name || ''} (${Number(p.stock_quantity)} ${p.unit})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>${t('to_branch')}</label>
              <select class="input" name="to_branch_id" required>
                ${branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>${t('quantity')}</label>
              <input class="input" type="number" step="0.001" min="0.001" name="quantity" required />
            </div>
            <div class="field">
              <label>${t('transfer_note')}</label>
              <input class="input" name="note" />
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-transfer-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-transfer-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#transfer-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      try {
        await transferStock({
          fromProductId: fd.get('from_product_id'),
          toBranchId: fd.get('to_branch_id'),
          quantity: Number(fd.get('quantity')),
          note: fd.get('note') || null,
          userId: profile.id
        });
        toast(t('transfer_success'), 'success');
        overlay.remove();
        loadData();
      } catch (err) {
        const messages = {
          same_branch: t('transfer_same_branch_error'),
          insufficient_stock: t('transfer_insufficient_stock'),
          invalid_quantity: t('transfer_insufficient_stock')
        };
        toast(messages[err.message] || t('error_occurred'), 'error');
      }
    });
  }

  await loadData();
}
