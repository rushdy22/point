import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listCategories, createCategory, updateCategory, deleteCategory } from '../lib/db/categories.js';

const ICONS = [
  // عام / ماركت وبقالة
  '📦', '🛒', '🛍️', '🧺', '🧴', '🧼', '🧻', '🧂', '🧃', '🥫', '🧀', '🥛',
  '🍞', '🥖', '🍎', '🍌', '🥕', '🥦', '🍗', '🥩', '🐟', '🧊', '💊', '🧸',
  '👕', '🔧', '🌸', '🎁',
  // مطاعم
  '🍔', '🍕', '🌭', '🌮', '🌯', '🍟', '🍝', '🍜', '🍛', '🍲', '🍚', '🥙',
  '🥗', '🍖', '🍤', '🥘',
  // كافيهات وحلويات
  '☕', '🍵', '🧋', '🥤', '🍰', '🧁', '🍩', '🍪', '🥐', '🍫', '🍨', '🍦'
];

export async function renderCategories(container, profile, branchId) {
  let categories = [];

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    categories = await listCategories(branchId);
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom:18px;">
        <div></div>
        <button class="btn btn-primary" id="add-category-btn">${t('new_category')}</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('category_name')}</th>
              <th>${t('products_count')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="cat-tbody"></tbody>
        </table>
        ${categories.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    container.querySelector('#cat-tbody').innerHTML = categories
      .map(
        (c) => `
      <tr>
        <td>
          <span style="display:inline-flex; align-items:center; gap:8px;">
            <span style="width:28px;height:28px;border-radius:8px;background:${c.color}22;display:flex;align-items:center;justify-content:center;">${c.icon}</span>
            <strong>${c.name}</strong>
          </span>
          ${c.name_en ? `<div class="text-muted" style="font-size:11.5px; margin-inline-start:36px;">${c.name_en}</div>` : ''}
        </td>
        <td>${c.products_count}</td>
        <td>
          <button class="btn btn-icon" data-edit="${c.id}">✏️</button>
          <button class="btn btn-icon" data-delete="${c.id}">🗑️</button>
        </td>
      </tr>`
      )
      .join('');

    container.querySelector('#add-category-btn').addEventListener('click', () => {
      if (!branchId) {
        toast('اختر فرعًا محددًا أولًا لإضافة قسم له (الأقسام أصبحت مستقلة لكل فرع)', 'error');
        return;
      }
      openModal(null);
    });
    container.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openModal(categories.find((c) => c.id === btn.dataset.edit)))
    );
    container.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await deleteCategory(btn.dataset.delete);
          toast(t('success'), 'success');
          loadData();
        } catch (err) {
          const isFkError =
            err?.code === '23503' ||
            /foreign key|violates|constraint/i.test(err?.message || '');
          toast(
            isFkError
              ? 'لا يمكن حذف هذا القسم لأنه مرتبط بمنتجات موجودة. عدّل منتجات القسم أولاً أو انقلها لقسم آخر.'
              : t('error_occurred'),
            'error'
          );
        }
      })
    );
  }

  function openModal(category) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${category ? t('edit_category') : t('new_category')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="cat-form">
            <div class="field">
              <label>${t('category_name')}</label>
              <input class="input" name="name" required value="${category?.name || ''}" />
            </div>
            <div class="field">
              <label>${t('category_name_en')}</label>
              <input class="input" name="name_en" value="${category?.name_en || ''}" />
            </div>
            <div class="field">
              <label>${t('category_color')}</label>
              <input class="input" type="color" name="color" value="${category?.color || '#0F766E'}" style="height:42px;" />
            </div>
            <div class="field">
              <label>${t('category_icon')}</label>
              <div class="flex gap-8" style="flex-wrap:wrap; max-height:180px; overflow-y:auto; padding:4px;">
                ${ICONS.map(
                  (icon) => `<button type="button" class="btn btn-ghost icon-choice" data-icon="${icon}" style="font-size:18px; ${category?.icon === icon ? 'background:var(--color-primary-light);' : ''}">${icon}</button>`
                ).join('')}
              </div>
              <input type="hidden" name="icon" value="${category?.icon || '📦'}" />
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-cat-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const iconInput = overlay.querySelector('input[name="icon"]');
    overlay.querySelectorAll('.icon-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        iconInput.value = btn.dataset.icon;
        overlay.querySelectorAll('.icon-choice').forEach((b) => (b.style.background = ''));
        btn.style.background = 'var(--color-primary-light)';
      });
    });

    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-cat-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#cat-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name').trim(),
        name_en: fd.get('name_en').trim() || null,
        color: fd.get('color'),
        icon: fd.get('icon')
      };
      try {
        if (category) await updateCategory(category.id, payload);
        else await createCategory(payload, branchId);
        toast(t('success'), 'success');
        overlay.remove();
        loadData();
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  await loadData();
}
