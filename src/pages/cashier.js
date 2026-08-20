import { t } from '../i18n/index.js';
import { toast } from '../lib/toast.js';
import { listProducts, getProductByBarcode } from '../lib/db/products.js';
import { listCategories } from '../lib/db/categories.js';
import { createSale, markInvoicePrinted } from '../lib/db/sales.js';
import { findCustomerByPhone, listCustomers, whatsappLink, getCustomerPurchaseHistory, findLastPurchasedPrice } from '../lib/db/customers.js';
import { buildWhatsAppInvoiceText, openReceiptPreview } from '../lib/printer.js';
import { getSettings, loadBranchSettings } from '../lib/settings.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { listEmployees, linkSaleToEmployee, recordAutoCommission } from '../lib/db/employees.js';
import { paymentMethodOptions } from '../lib/paymentMethods.js';
import { canManage } from '../lib/permissions.js';
import { formatQuantity } from '../lib/decimal.js';

export async function renderCashier(container, profile, branchId) {
  if (!branchId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏬</div>
        <div style="font-weight:700; font-size:15px;">${t('select_branch')}</div>
        <div class="text-muted" style="margin-top:6px;">اختر فرعًا محددًا من أعلى الصفحة لبدء عمليات البيع</div>
      </div>`;
    return;
  }
  let products = [];
  let categories = [];
  let employees = [];
  let activeCategory = '';
  let cart = []; // { id, name, price, qty, stock }
  const canOverridePrice = canManage(profile.role);
  // The customer picked for this sale (optional). Selecting one loads their
  // full purchase history once, up front, so looking up "did they buy this
  // product before, and at what price" for every item added afterwards is
  // just a local lookup — see findLastPurchasedPrice() — not a new query.
  let selectedCustomer = null;
  let customerHistory = [];
  await loadBranchSettings(branchId); // warms getSettings(branchId) for this branch only

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    const [productsRes, categoriesRes, employeesRes] = await Promise.all([
      listProducts({ onlyActive: true, branchId }),
      listCategories(branchId),
      listEmployees({}).catch(() => [])
    ]);
    products = productsRes;
    categories = categoriesRes;
    employees = (employeesRes || []).filter((e) => e.is_active);
    draw();
  }

  function filteredProducts(search = '') {
    return products.filter((p) => {
      const matchCat = !activeCategory || p.category_id === activeCategory;
      const matchSearch =
        !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode || '').includes(search);
      return matchCat && matchSearch;
    });
  }

  function draw() {
    container.innerHTML = `
      <div class="cashier-layout">
        <div class="cashier-products">
          <div class="mobile-cart-trigger-wrap">
            <button class="mobile-cart-trigger" id="mobile-cart-trigger" type="button">🛒 <span>عرض السلة</span><b id="mobile-cart-count">0</b></button>
          </div>
          <div id="customer-bar"></div>
          <div class="input-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="cashier-search" placeholder="${t('scan_or_search')}" autofocus />
          </div>
          <div class="category-pills" id="category-pills">
            <button class="pill ${activeCategory === '' ? 'active' : ''}" data-cat="">${t('all')}</button>
            ${categories.map((c) => `<button class="pill ${activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join('')}
          </div>
          <div class="product-grid" id="product-grid"></div>
        </div>
        <div class="cart-panel">
          <div class="cart-header">
            <h3>${t('cart_title')}</h3>
            <div class="cart-header-actions">
              <button class="btn btn-icon mobile-cart-close" id="mobile-cart-close" type="button" title="إغلاق السلة">✕</button>
              <button class="btn btn-icon" id="clear-cart-btn" title="${t('clear_cart')}">🗑️</button>
            </div>
          </div>
          <div class="cart-items" id="cart-items"></div>
          <div class="cart-summary" id="cart-summary"></div>
          <div class="cart-footer">
            <button class="btn btn-primary btn-lg btn-block" id="checkout-btn">${t('checkout')}</button>
          </div>
        </div>
      </div>
    `;

    renderCustomerBar();
    renderProductGrid();
    renderCart();

    const mobileCartTrigger = container.querySelector('#mobile-cart-trigger');
    mobileCartTrigger?.addEventListener('click', () => {
      container.querySelector('.cart-panel')?.classList.add('mobile-cart-open');
    });

    container.querySelector('.cart-panel')?.addEventListener('click', (e) => {
      if (e.target.closest('#mobile-cart-close')) {
        container.querySelector('.cart-panel')?.classList.remove('mobile-cart-open');
      }
    });

    const searchInput = container.querySelector('#cashier-search');
    searchInput.addEventListener('input', (e) => renderProductGrid(e.target.value));
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const value = searchInput.value.trim();
        if (!value) return;
        try {
          const product = await getProductByBarcode(value, branchId);
          if (product) {
            addToCart(product);
            searchInput.value = '';
            renderProductGrid();
          } else {
            toast('لم يتم العثور على منتج بهذا الباركود', 'error');
          }
        } catch {
          toast(t('error_occurred'), 'error');
        }
      }
    });

    container.querySelectorAll('#category-pills .pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat;
        renderProductGrid(searchInput.value);
        container.querySelectorAll('#category-pills .pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    container.querySelector('#clear-cart-btn').addEventListener('click', () => {
      cart = [];
      renderCart();
    });

    container.querySelector('#checkout-btn').addEventListener('click', openCheckoutModal);
  }

  function renderCustomerBar() {
    const bar = container.querySelector('#customer-bar');
    if (!bar) return;

    if (selectedCustomer) {
      bar.innerHTML = `
        <div class="card card-pad" style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; padding:8px 14px; background:var(--color-success-light); border:none;">
          <div style="font-size:13px; min-width:0;">
            <strong>👤 ${selectedCustomer.name || selectedCustomer.phone || ''}</strong>
            ${selectedCustomer.phone ? ` <span class="text-muted" dir="ltr">${selectedCustomer.phone}</span>` : ''}
            ${selectedCustomer.vehicle_type ? ` <span class="text-muted">🚗 ${selectedCustomer.vehicle_type}${selectedCustomer.vehicle_number ? ` — ${selectedCustomer.vehicle_number}` : ''}</span>` : ''}
            ${Number(selectedCustomer.balance || 0) < 0 ? ` <span class="badge badge-success">رصيد متاح: ${Math.abs(Number(selectedCustomer.balance)).toFixed(2)}</span>` : ''}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="clear-customer-btn">${t('clear_customer')}</button>
        </div>`;
      bar.querySelector('#clear-customer-btn').addEventListener('click', () => {
        selectedCustomer = null;
        customerHistory = [];
        renderCustomerBar();
        renderCart();
      });
      return;
    }

    bar.innerHTML = `
      <div class="input-search" style="margin-bottom:0;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <input id="customer-bar-search" placeholder="${t('select_customer_placeholder')}" autocomplete="off" />
      </div>
      <div id="customer-bar-suggestions" class="customer-suggestions"></div>
    `;

    const input = bar.querySelector('#customer-bar-search');
    const suggestions = bar.querySelector('#customer-bar-suggestions');
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const search = input.value.trim();
      if (search.length < 1) {
        suggestions.innerHTML = '';
        return;
      }
      debounce = setTimeout(async () => {
        try {
          const results = await listCustomers({ search, branchId });
          suggestions.innerHTML = results.slice(0, 6)
            .map((c) => `<button type="button" class="customer-suggestion" data-id="${c.id}"><strong>${c.name || '—'}</strong><span dir="ltr">${c.phone || ''}</span></button>`)
            .join('');
          suggestions.querySelectorAll('[data-id]').forEach((btn) =>
            btn.addEventListener('click', () => selectCustomerForSale(results.find((c) => c.id === btn.dataset.id)))
          );
        } catch {
          suggestions.innerHTML = '';
        }
      }, 250);
    });
  }

  async function selectCustomerForSale(customer) {
    if (!customer) return;
    selectedCustomer = customer;
    customerHistory = [];
    renderCustomerBar();
    renderCart(); // clears any stale last-price hints immediately while history loads
    try {
      customerHistory = await getCustomerPurchaseHistory(customer.id);
    } catch {
      customerHistory = [];
    }
    renderCart();
  }

  function renderProductGrid(search = '') {
    const grid = container.querySelector('#product-grid');
    const list = filteredProducts(search);
    grid.innerHTML = list
      .map((p) => {
        const disabled = Number(p.stock_quantity) <= 0;
        return `
        <button class="product-tile" data-id="${p.id}" ${disabled ? 'disabled' : ''}>
          <div class="p-icon">${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />` : (p.categories?.icon || '📦')}</div>
          <div class="p-name">${p.name}</div>
          <div class="p-price">${Number(p.price).toFixed(2)}</div>
          <div class="p-stock">${t('stock')}: ${formatQuantity(p.stock_quantity)} ${p.unit}</div>
        </button>`;
      })
      .join('') || `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔍</div><div>${t('no_data')}</div></div>`;

    grid.querySelectorAll('.product-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        const product = products.find((p) => p.id === tile.dataset.id);
        if (product) addToCart(product);
      });
    });
  }

  function addToCart(product) {
    const existing = cart.find((c) => c.id === product.id);
    const stock = Number(product.stock_quantity);
    if (existing) {
      if (existing.qty + 1 > stock) {
        toast(t('insufficient_stock'), 'error');
        return;
      }
      existing.qty += 1;
    } else {
      if (stock <= 0) {
        toast(t('insufficient_stock'), 'error');
        return;
      }
      cart.push({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        defaultPrice: Number(product.price),
        cost: Number(product.cost || 0),
        qty: 1,
        stock,
        unit: product.unit,
        image_url: product.image_url || null,
        icon: product.categories?.icon || '📦'
      });
    }
    renderCart();
  }

  function renderCart() {
    const countEl = container.querySelector('#mobile-cart-count');
    if (countEl) countEl.textContent = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const itemsEl = container.querySelector('#cart-items');
    const summaryEl = container.querySelector('#cart-summary');

    if (cart.length === 0) {
      itemsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><div>${t('cart_empty')}</div></div>`;
    } else {
      itemsEl.innerHTML = cart
        .map((item, idx) => {
          const lastPurchase = selectedCustomer ? findLastPurchasedPrice(customerHistory, item.id) : null;
          const lastPurchaseHtml = lastPurchase
            ? `<div class="ci-last-price text-muted" style="font-size:11.5px; margin-top:3px;">
                🕘 ${t('last_price_paid')}: <span class="mono-num">${lastPurchase.price.toFixed(2)}</span> — ${new Date(lastPurchase.date).toLocaleDateString('ar-EG')}
                ${canOverridePrice && lastPurchase.price !== item.price ? ` · <button type="button" class="text-link-btn" data-use-last-price="${idx}">${t('use_last_price')}</button>` : ''}
              </div>`
            : '';
          return `
        <div class="cart-item">
          <div class="ci-thumb" style="width:34px;height:34px;border-radius:7px;overflow:hidden;background:var(--color-surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${item.image_url ? `<img src="${item.image_url}" style="width:100%;height:100%;object-fit:cover;" />` : `<span style="font-size:15px;">${item.icon || '📦'}</span>`}
          </div>
          <div class="ci-info">
            <div class="ci-name">${item.name}</div>
            <div class="ci-price">${canOverridePrice
              ? `سعر البيع: <input class="cart-price-input" type="number" step="0.01" min="0" data-price-input="${idx}" value="${item.price.toFixed(2)}" /> <span class="text-muted">(الأصلي: ${item.defaultPrice.toFixed(2)})</span>`
              : `${item.price.toFixed(2)} × ${item.qty} = <strong>${(item.price * item.qty).toFixed(2)}</strong>`}</div>
            ${lastPurchaseHtml}
          </div>
          <div class="qty-control">
            <button data-dec="${idx}">−</button>
            <input type="number" class="qty-input" data-qty-input="${idx}" value="${formatQuantity(item.qty)}" min="0.001" step="0.001" inputmode="decimal" />
            <button data-inc="${idx}">+</button>
          </div>
          <button class="btn btn-icon" data-remove="${idx}">✕</button>
        </div>`;
        })
        .join('');

      itemsEl.querySelectorAll('[data-inc]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.inc);
          if (cart[idx].qty + 1 > cart[idx].stock) {
            toast(t('insufficient_stock'), 'error');
            return;
          }
          cart[idx].qty += 1;
          renderCart();
        })
      );
      itemsEl.querySelectorAll('[data-dec]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.dec);
          cart[idx].qty -= 1;
          if (cart[idx].qty <= 0) cart.splice(idx, 1);
          renderCart();
        })
      );
      // Lets the cashier type an exact quantity instead of only tapping +/−.
      itemsEl.querySelectorAll('[data-qty-input]').forEach((input) => {
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', () => {
          const idx = Number(input.dataset.qtyInput);
          const item = cart[idx];
          if (!item) return;
          let newQty = Number(input.value);
          if (!newQty || newQty <= 0) {
            cart.splice(idx, 1);
            renderCart();
            return;
          }
          if (newQty > item.stock) {
            toast(t('insufficient_stock'), 'error');
            newQty = item.stock;
          }
          item.qty = newQty;
          renderCart();
        });
      });
      itemsEl.querySelectorAll('[data-price-input]').forEach((input) => {
        input.addEventListener('change', () => {
          const item = cart[Number(input.dataset.priceInput)];
          const price = Number(input.value);
          if (!item || Number.isNaN(price) || price < 0) { renderCart(); return; }
          item.price = price;
          renderCart();
        });
      });
      itemsEl.querySelectorAll('[data-use-last-price]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.useLastPrice);
          const item = cart[idx];
          if (!item || !selectedCustomer) return;
          const lastPurchase = findLastPurchasedPrice(customerHistory, item.id);
          if (!lastPurchase) return;
          item.price = lastPurchase.price;
          renderCart();
        });
      });
      itemsEl.querySelectorAll('[data-remove]').forEach((btn) =>
        btn.addEventListener('click', () => {
          cart.splice(Number(btn.dataset.remove), 1);
          renderCart();
        })
      );
    }

    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const settings = getSettings(branchId);
    const tax = subtotal * (Number(settings.taxRate || 0) / 100);
    const total = subtotal + tax;

    summaryEl.innerHTML = `
      <div class="summary-row"><span>${t('subtotal')}</span><span class="mono-num">${subtotal.toFixed(2)}</span></div>
      <div class="summary-row"><span>${t('tax')}</span><span class="mono-num">${tax.toFixed(2)}</span></div>
      <div class="summary-row total-row"><span>${t('total')}</span><span class="mono-num">${total.toFixed(2)}</span></div>
    `;
  }

  function openCheckoutModal() {
    if (cart.length === 0) {
      toast(t('cart_empty'), 'error');
      return;
    }
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const settings = getSettings(branchId);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${t('checkout')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="checkout-form">
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>${t('customer_name')}</label>
                <input class="input" name="customer_name" />
              </div>
              <div class="field" style="flex:1">
                <label>${t('customer_phone')}</label>
                <input class="input" name="customer_phone" type="tel" placeholder="01xxxxxxxxx" autocomplete="off" />
              </div>
            </div>
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>السيارة</label>
                <input class="input" name="customer_vehicle_type" placeholder="مثال: هيونداي إلنترا" />
              </div>
              <div class="field" style="flex:1">
                <label>رقم العربية</label>
                <input class="input" name="customer_vehicle_number" placeholder="مثال: ع م ر 1234" />
              </div>
            </div>
            <div class="flex justify-between items-center" style="margin-top:-6px; margin-bottom:10px; gap:8px;">
              <div class="text-muted" style="font-size:12px;">بيانات العميل والسيارة اختيارية. يمكنك إتمام البيع مباشرة بدون عميل أو رقم سيارة.</div>
            </div>
            <div id="customer-suggestions" class="customer-suggestions"></div>
            <div id="known-customer-box"></div>
            ${employees.length > 0 ? `
            <div class="field">
              <label>الموظف الذي قام بالخدمة (اختياري)</label>
              <select class="input" name="employee_id">
                <option value="">— بدون —</option>
                ${employees.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>${t('discount_percent')}</label>
                <input class="input" type="number" min="0" max="100" step="0.01" name="discountPercent" value="0" />
              </div>
              <div class="field" style="flex:1">
                <label>${t('tax_percent')}</label>
                <input class="input" type="number" min="0" max="100" step="0.01" name="taxPercent" value="${Number(settings.taxRate || 0)}" />
              </div>
            </div>
            <div class="field">
              <label>${t('payment_method')}</label>
              <select class="input" name="payment_method" id="payment-method">
                ${paymentMethodOptions()}
              </select>
            </div>
            <div class="field">
              <label>${t('paid_amount')}</label>
              <input class="input" type="number" step="0.01" name="paid_amount" id="paid-amount" />
            </div>
            <div class="card card-pad" style="background:var(--color-primary-light); border:none;">
              <div class="summary-row"><span>${t('subtotal')}</span><span class="mono-num">${subtotal.toFixed(2)}</span></div>
              <div class="summary-row total-row" id="modal-total"><span>${t('total')}</span><span class="mono-num">0.00</span></div>
              <div class="summary-row" id="modal-credit"><span>الرصيد المتاح المستخدم</span><span class="mono-num">0.00</span></div>
              <div class="summary-row" id="modal-change"><span>${t('remaining_balance')}</span><span class="mono-num">0.00</span></div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="confirm-checkout-btn">${t('checkout')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('#checkout-form');
    const totalEl = overlay.querySelector('#modal-total span:last-child');
    const creditEl = overlay.querySelector('#modal-credit span:last-child');
    const changeEl = overlay.querySelector('#modal-change span:last-child');
    const paidInput = overlay.querySelector('#paid-amount');
    let selectedCustomerId = null;
    let selectedCustomerCredit = 0;

    function recalc() {
      const discountPercent = Math.min(Math.max(Number(form.discountPercent.value || 0), 0), 100);
      const taxPercent = Math.min(Math.max(Number(form.taxPercent.value || 0), 0), 100);
      const discount = subtotal * (discountPercent / 100);
      const tax = (subtotal - discount) * (taxPercent / 100);
      const total = Math.max(subtotal - discount + tax, 0);
      totalEl.textContent = total.toFixed(2);
      const creditUsed = selectedCustomerId ? Math.min(selectedCustomerCredit, total) : 0;
      creditEl.textContent = creditUsed.toFixed(2);
      const remaining = Math.max(total - creditUsed - Number(paidInput.value || 0), 0);
      changeEl.textContent = remaining.toFixed(2);
      return total;
    }
    form.discountPercent.addEventListener('input', recalc);
    form.taxPercent.addEventListener('input', recalc);
    paidInput.addEventListener('input', recalc);
    const initialTotal = recalc();
    paidInput.value = initialTotal.toFixed(2);
    recalc();

    const phoneInput = form.customer_phone;
    const nameInput = form.customer_name;
    const customerSuggestions = overlay.querySelector('#customer-suggestions');
    const knownBox = overlay.querySelector('#known-customer-box');
    let customerDebounce;

    function selectCustomer(customer) {
      nameInput.value = customer.name || '';
      phoneInput.value = customer.phone || '';
      form.customer_vehicle_type.value = customer.vehicle_type || '';
      form.customer_vehicle_number.value = customer.vehicle_number || '';
      selectedCustomerId = customer.id;
      selectedCustomerCredit = Math.max(-Number(customer.balance || 0), 0);
      customerSuggestions.innerHTML = '';
      knownBox.innerHTML = `<div class="card card-pad" style="background:var(--color-success-light); border:none; margin-bottom:14px; padding:10px 14px;"><div style="font-weight:700; font-size:13.5px;">👤 ${t('welcome_user')} ${customer.name}</div><div class="text-muted" style="font-size:12px; margin-top:2px;">${t('total_purchases')}: <span class="mono-num">${Number(customer.total_purchases).toFixed(2)}</span>&nbsp;·&nbsp; ${t('visits_count')}: <span class="mono-num">${customer.visits_count}</span>${selectedCustomerCredit > 0 ? `&nbsp;·&nbsp; <strong style="color:var(--color-success);">رصيد متاح: ${selectedCustomerCredit.toFixed(2)}</strong>` : ''}</div></div>`;
      const total = recalc();
      paidInput.value = Math.max(total - selectedCustomerCredit, 0).toFixed(2);
      recalc();
    }

    async function searchCustomers() {
      const search = (nameInput.value.trim() || phoneInput.value.trim());
      if (search.length < 1) {
        customerSuggestions.innerHTML = '';
        if (!search) knownBox.innerHTML = '';
        return;
      }
      try {
        const customers = await listCustomers({ search, branchId });
        customerSuggestions.innerHTML = customers.slice(0, 6).map((customer) => `<button type="button" class="customer-suggestion" data-customer-id="${customer.id}"><strong>${customer.name || '—'}</strong><span dir="ltr">${customer.phone || ''}</span></button>`).join('');
        customerSuggestions.querySelectorAll('[data-customer-id]').forEach((button) => button.addEventListener('click', () => selectCustomer(customers.find((customer) => customer.id === button.dataset.customerId))));
        if (!customers.length) knownBox.innerHTML = `<div class="card card-pad" style="background:var(--color-surface-2); border:none; margin-bottom:14px; padding:8px 14px;"><div class="text-muted" style="font-size:12px;">🆕 ${t('new_customer')}</div></div>`;
      } catch { customerSuggestions.innerHTML = ''; }
    }
    [nameInput, phoneInput].forEach((input) => input.addEventListener('input', () => {
      selectedCustomerId = null;
      selectedCustomerCredit = 0;
      clearTimeout(customerDebounce);
      customerDebounce = setTimeout(searchCustomers, 250);
    }));

    // Carry over the customer picked earlier on the POS screen so the cashier
    // doesn't have to search for them again at checkout.
    if (selectedCustomer) selectCustomer(selectedCustomer);

    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#confirm-checkout-btn').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      const discountPercent = Math.min(Math.max(Number(form.discountPercent.value || 0), 0), 100);
      const taxPercent = Math.min(Math.max(Number(form.taxPercent.value || 0), 0), 100);
      const discount = subtotal * (discountPercent / 100);
      const tax = (subtotal - discount) * (taxPercent / 100);
      const total = Math.max(subtotal - discount + tax, 0);
      const paidAmount = Number(paidInput.value || 0);

      const creditUsed = selectedCustomerId ? Math.min(selectedCustomerCredit, total) : 0;
      if (paidAmount < 0 || paidAmount > total - creditUsed) {
        toast('أدخل مبلغًا مدفوعًا صحيحًا لا يتجاوز المتبقي بعد الرصيد المتاح.', 'error');
        return;
      }
      if (paidAmount + creditUsed < total && !(selectedCustomerId || form.customer_phone.value.trim())) {
        toast('للفواتير الآجلة أو الدفعة الجزئية يجب اختيار عميل أو إدخال رقم هاتفه.', 'error');
        return;
      }

      const btn = overlay.querySelector('#confirm-checkout-btn');
      btn.disabled = true;
      try {
        const sale = await createSale({
          branchId,
          cashierId: profile.id,
          cart,
          discount,
          tax,
          paidAmount,
          paymentMethod: form.payment_method.value,
          customerName: form.customer_name.value.trim(),
          customerPhone: form.customer_phone.value.trim(),
          customerVehicleType: form.customer_vehicle_type.value.trim(),
          customerVehicleNumber: form.customer_vehicle_number.value.trim(),
          customerId: selectedCustomerId
        });
        toast(t('sale_completed'), 'success');

        const selectedEmployeeId = form.employee_id ? form.employee_id.value : '';
        if (selectedEmployeeId) {
          // Best-effort: link the sale to the employee and record their
          // commission automatically. This should never block or fail the
          // sale itself, which already completed successfully above.
          try {
            await linkSaleToEmployee(sale.id, selectedEmployeeId);
            await recordAutoCommission({
              employeeId: selectedEmployeeId,
              branchId,
              saleId: sale.id,
              saleTotal: total,
              createdBy: profile.id
            });
          } catch {
            toast('تم البيع بنجاح، لكن حدث خطأ أثناء تسجيل عمولة الموظف', 'error');
          }
        }

        overlay.remove();
        const soldItems = cart.map((c) => ({ product_name: c.name, quantity: c.qty, unit_price: c.price, total: c.price * c.qty }));
        cart = [];
        selectedCustomer = null;
        customerHistory = [];
        renderCustomerBar();
        renderCart();
        await loadData();
        openInvoiceModal(sale, soldItems);
      } catch (err) {
        if (err?.message === 'CASH_DRAWER_CLOSED') {
          toast('لا يمكن إتمام عملية نقدية قبل فتح شيفت الدرج. افتح الشيفت من الحسابات ← الدرج، أو اختر وسيلة دفع غير نقدية.', 'error', 7000);
        } else {
          toast(t('error_occurred'), 'error');
        }
        btn.disabled = false;
      }
    });
  }

  async function openInvoiceModal(sale, items) {
    // Use the same wa.me link mechanism already used on the Customers page.
    // The receipt details are added as WhatsApp's prefilled message text.
    const whatsappUrl = sale.customer_phone
      ? whatsappLink(sale.customer_phone, buildWhatsAppInvoiceText(sale, items, getSettings(branchId)))
      : '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${t('invoice_title')} - ${sale.invoice_number}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <div class="empty-state">
            <div class="empty-icon">✅</div>
            <div style="font-weight:700; font-size:16px;">${t('sale_completed')}</div>
            <div class="text-muted" style="margin-top:6px;">${t('total')}: ${Number(sale.total).toFixed(2)}</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('close')}</button>
          ${sale.customer_phone && getSettings(branchId).whatsapp?.enabled !== false
            ? `<a class="btn btn-ghost" href="${whatsappUrl}" target="_blank">💬 ${t('send_whatsapp')}</a>`
            : `<button class="btn btn-ghost" disabled title="لا يوجد رقم هاتف للعميل">💬 ${t('send_whatsapp')}</button>`}
          <button class="btn btn-primary" id="print-btn">🖨️ معاينة وطباعة A4</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));

    overlay.querySelector('#print-btn').addEventListener('click', () => {
      openReceiptPreview(sale, items, async () => {
        await markInvoicePrinted(sale.id);
        toast(t('success'), 'success');
      }, getSettings(branchId));
    });

  }

  await loadData();

  let reloadTimer;
  const unsubscribe = subscribeRealtime(['products'], () => {
    // debounce: multiple rapid stock changes should only trigger one refresh
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (document.body.contains(container)) loadData();
    }, 400);
  });

  return unsubscribe;
}
