import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listProducts, createProduct, updateProduct, deleteProduct } from '../lib/db/products.js';
import { listCategories } from '../lib/db/categories.js';
import { listBranches } from '../lib/db/branches.js';
import { subscribeRealtime } from '../lib/realtime.js';

function fileToResizedDataURL(file, maxSize = 500, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('invalid_image'));
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function renderProducts(container, profile, branchId) {
  let products = [];
  let categories = [];
  let branches = [];
  let search = '';
  let categoryFilter = '';
  let materialFilter = '';
  const showBranchColumn = !branchId;

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    [products, categories, branches] = await Promise.all([
      listProducts({ search, categoryId: categoryFilter || null, branchId }),
      listCategories(branchId),
      showBranchColumn ? listBranches({ onlyActive: true }) : Promise.resolve([])
    ]);
    if (materialFilter === 'material') products = products.filter((p) => p.is_raw_material);
    if (materialFilter === 'product') products = products.filter((p) => !p.is_raw_material);
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="flex justify-between items-center gap-16" style="margin-bottom:18px;">
        <div class="input-search" style="max-width:340px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="search-input" placeholder="${t('search_placeholder')}" value="${search}" />
        </div>
        <div class="flex gap-12 items-center">
          <select class="input" id="category-filter">
            <option value="">${t('all')} - ${t('category')}</option>
            ${categories.map((c) => `<option value="${c.id}" ${categoryFilter === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
          </select>
          <select class="input" id="material-filter">
            <option value="">نوع الصنف: الكل</option>
            <option value="material" ${materialFilter === 'material' ? 'selected' : ''}>مواد صيانة</option>
            <option value="product" ${materialFilter === 'product' ? 'selected' : ''}>أصناف بيع</option>
          </select>
          <button class="btn btn-primary" id="add-product-btn">${t('new_product')}</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th></th>
              <th>${t('product_name')}</th>
              ${showBranchColumn ? `<th>${t('branch')}</th>` : ''}
              <th>${t('category')}</th>
              <th>${t('barcode')}</th>
              <th>${t('price')}</th>
              <th>${t('stock')}</th>
              <th>${t('status')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="products-tbody"></tbody>
        </table>
        ${products.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    const tbody = container.querySelector('#products-tbody');
    tbody.innerHTML = products
      .map((p) => {
        const low = Number(p.stock_quantity) <= Number(p.low_stock_threshold);
        const out = Number(p.stock_quantity) <= 0;
        return `
        <tr>
          <td>
            <div style="width:38px;height:38px;border-radius:8px;overflow:hidden;background:var(--color-surface-2);display:flex;align-items:center;justify-content:center;">
              ${p.image_url ? `<img src="${p.image_url}" style="width:100%;height:100%;object-fit:cover;" />` : `<span style="font-size:16px;">${p.categories?.icon || '📦'}</span>`}
            </div>
          </td>
          <td><strong>${p.name}</strong>${p.is_raw_material ? `<div><span class="badge badge-warning" style="margin-top:4px;">🔧 مادة صيانة</span></div>` : ''}${p.name_en ? `<div class="text-muted" style="font-size:11.5px">${p.name_en}</div>` : ''}</td>
          ${showBranchColumn ? `<td>${p.branches?.name || '—'}</td>` : ''}
          <td>${p.categories ? `${p.categories.icon || ''} ${p.categories.name}` : `<span class="text-muted">${t('no_category')}</span>`}</td>
          <td class="mono-num">${p.barcode || '—'}</td>
          <td class="mono-num">${Number(p.price).toFixed(2)}</td>
          <td>
            <span class="mono-num">${Number(p.stock_quantity)} ${p.unit}</span>
            ${out ? `<span class="badge badge-danger">${t('out_of_stock')}</span>` : low ? `<span class="badge badge-warning">${t('low_stock')}</span>` : ''}
          </td>
          <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-muted'}">${p.is_active ? t('active') : t('inactive')}</span></td>
          <td>
            <button class="btn btn-icon" data-edit="${p.id}" title="${t('edit')}">✏️</button>
            <button class="btn btn-icon" data-delete="${p.id}" title="${t('delete')}">🗑️</button>
          </td>
        </tr>`;
      })
      .join('');

    container.querySelector('#search-input').addEventListener('input', (e) => {
      search = e.target.value;
      debounceLoad();
    });
    container.querySelector('#category-filter').addEventListener('change', (e) => {
      categoryFilter = e.target.value;
      loadData();
    });
    container.querySelector('#material-filter').addEventListener('change', (e) => {
      materialFilter = e.target.value;
      loadData();
    });
    container.querySelector('#add-product-btn').addEventListener('click', () => openModal(null));

    tbody.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openModal(products.find((p) => p.id === btn.dataset.edit)))
    );
    tbody.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', () => handleDelete(products.find((p) => p.id === btn.dataset.delete)))
    );
  }

  let debounceTimer;
  function debounceLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadData, 350);
  }

  async function handleDelete(product) {
    if (!product) return;
    const ok = await confirmDialog(t('confirm_delete'));
    if (!ok) return;
    try {
      await deleteProduct(product.id);
      toast(t('success'), 'success');
      loadData();
    } catch (err) {
      // Deleting fails when the product is referenced elsewhere (sale items,
      // stock movements, transfers...) because of a foreign key constraint.
      // Instead of a generic error, offer to deactivate it instead.
      const isFkError =
        err?.code === '23503' ||
        /foreign key|violates|constraint/i.test(err?.message || '');

      if (!isFkError) {
        toast(t('error_occurred'), 'error');
        return;
      }

      const wantsDeactivate = await confirmDialog(
        'لا يمكن حذف هذا المنتج لأنه مرتبط ببيانات موجودة (فواتير بيع أو حركات مخزون سابقة). هل تريد إيقافه بدلاً من حذفه؟ (سيختفي من شاشة الكاشير وتبقى سجلاته محفوظة)'
      );
      if (!wantsDeactivate) return;
      try {
        await updateProduct(product.id, { is_active: false });
        toast(t('success'), 'success');
        loadData();
      } catch {
        toast(t('error_occurred'), 'error');
      }
    }
  }

  function openModal(product) {
    let pendingImage = product?.image_url || '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${product ? t('edit_product') : t('new_product')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="product-form">
            <div class="field">
              <label>صورة المنتج</label>
              <div class="flex items-center gap-16">
                <div id="image-preview" style="width:72px;height:72px;border-radius:12px;border:1px dashed var(--color-border-strong);display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--color-surface-2);">
                  ${pendingImage ? `<img src="${pendingImage}" style="width:100%;height:100%;object-fit:cover;" />` : `<span style="font-size:24px;">📦</span>`}
                </div>
                <div class="flex gap-8">
                  <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
                    رفع صورة
                    <input type="file" accept="image/*" id="product-image-input" style="display:none;" />
                  </label>
                  <button type="button" class="btn btn-ghost btn-sm" id="remove-image-btn" style="${pendingImage ? '' : 'display:none;'}">إزالة</button>
                </div>
              </div>
            </div>
            ${showBranchColumn ? `
            <div class="field">
              <label>${t('branch')}</label>
              <select class="input" name="branch_id" required>
                ${branches.map((b) => `<option value="${b.id}" ${product?.branch_id === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="field">
              <label>${t('product_name')}</label>
              <input class="input" name="name" required value="${product?.name || ''}" />
            </div>
            <div class="field">
              <label>${t('product_name_en')}</label>
              <input class="input" name="name_en" value="${product?.name_en || ''}" />
            </div>
            <div class="field">
              <label>${t('barcode')}</label>
              <input class="input" name="barcode" value="${product?.barcode || ''}" />
            </div>
            <div class="field">
              <label>نوع الصنف</label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" name="is_raw_material" ${product?.is_raw_material ? 'checked' : ''} />
                <span>🔧 مادة صيانة (تُخصم من مخزن مواد الصيانة عند استخدامها)</span>
              </label>
            </div>
            <div class="field">
              <label>${t('category')}</label>
              <select class="input" name="category_id">
                <option value="">${t('no_category')}</option>
                ${categories.map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>${t('price')}</label>
                <input class="input" type="number" step="0.01" name="price" required value="${product?.price ?? 0}" />
              </div>
              <div class="field" style="flex:1">
                <label>${t('cost')}</label>
                <input class="input" type="number" step="0.01" name="cost" value="${product?.cost ?? 0}" />
              </div>
            </div>
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>${t('stock')}</label>
            <input class="input" type="number" step="0.001" min="0" name="stock_quantity" value="${product?.stock_quantity ?? 0}" />
              </div>
              <div class="field" style="flex:1">
                <label>${t('low_stock_threshold')}</label>
            <input class="input" type="number" step="0.001" min="0" name="low_stock_threshold" value="${product?.low_stock_threshold ?? 5}" />
              </div>
            </div>
            <div class="flex gap-12">
              <div class="field" style="flex:1">
                <label>${t('unit')}</label>
                <input class="input" name="unit" value="${product?.unit || 'قطعة'}" />
              </div>
              <div class="field" style="flex:1">
                <label>${t('status')}</label>
                <select class="input" name="is_active">
                  <option value="true" ${product?.is_active !== false ? 'selected' : ''}>${t('active')}</option>
                  <option value="false" ${product?.is_active === false ? 'selected' : ''}>${t('inactive')}</option>
                </select>
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-product-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const imageInput = overlay.querySelector('#product-image-input');
    const imagePreview = overlay.querySelector('#image-preview');
    const removeImageBtn = overlay.querySelector('#remove-image-btn');

    imageInput.addEventListener('change', async () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      try {
        pendingImage = await fileToResizedDataURL(file);
        imagePreview.innerHTML = `<img src="${pendingImage}" style="width:100%;height:100%;object-fit:cover;" />`;
        removeImageBtn.style.display = '';
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });

    removeImageBtn.addEventListener('click', () => {
      pendingImage = '';
      imagePreview.innerHTML = `<span style="font-size:24px;">📦</span>`;
      removeImageBtn.style.display = 'none';
    });

    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-product-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#product-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name').trim(),
        name_en: fd.get('name_en').trim() || null,
        barcode: fd.get('barcode').trim() || null,
        category_id: fd.get('category_id') || null,
        price: Number(fd.get('price')),
        cost: Number(fd.get('cost') || 0),
        stock_quantity: Number(fd.get('stock_quantity') || 0),
        low_stock_threshold: Number(fd.get('low_stock_threshold') || 5),
        unit: fd.get('unit').trim() || 'قطعة',
        is_active: fd.get('is_active') === 'true',
        is_raw_material: fd.get('is_raw_material') === 'on',
        image_url: pendingImage || null
      };
      if (!product) payload.branch_id = showBranchColumn ? fd.get('branch_id') : branchId;
      try {
        if (product) await updateProduct(product.id, payload);
        else await createProduct(payload);
        toast(t('success'), 'success');
        overlay.remove();
        loadData();
      } catch (err) {
        toast(err.message?.includes('duplicate') ? 'الباركود مستخدم بالفعل في هذا الفرع' : t('error_occurred'), 'error');
      }
    });
  }

  await loadData();

  let reloadTimer;
  const unsubscribe = subscribeRealtime(['products'], () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (document.body.contains(container)) loadData();
    }, 400);
  });
  return unsubscribe;
}
