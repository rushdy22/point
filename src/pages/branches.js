import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listBranches, createBranch, updateBranch, deleteBranch } from '../lib/db/branches.js';
import { subscribeRealtime } from '../lib/realtime.js';
import { hashBranchPassword } from '../lib/branchPassword.js';

export async function renderBranches(container) {
  let branches = [];

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    branches = await listBranches();
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="card card-pad" style="margin-bottom:18px; background:var(--color-primary-light); border:none;">
        <p style="font-size:13.5px;">ℹ️ ${t('admin_all_branches_note')}</p>
      </div>
      <div class="flex justify-between items-center" style="margin-bottom:18px;">
        <div></div>
        <button class="btn btn-primary" id="add-branch-btn">${t('new_branch')}</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('branch_name')}</th>
              <th>${t('branch_code')}</th>
              <th>${t('branch_phone')}</th>
              <th>${t('status')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="branch-tbody"></tbody>
        </table>
        ${branches.length === 0 ? `<div class="table-empty">${t('no_data')}</div>` : ''}
      </div>
    `;

    container.querySelector('#branch-tbody').innerHTML = branches
      .map(
        (b) => `
      <tr>
        <td><strong>${b.name}</strong>${b.address ? `<div class="text-muted" style="font-size:11.5px;">${b.address}</div>` : ''}</td>
        <td class="mono-num">${b.code}</td>
        <td class="mono-num">${b.phone || '—'}</td>
        <td><span class="badge ${b.is_active ? 'badge-success' : 'badge-muted'}">${b.is_active ? t('active') : t('inactive')}</span></td>
        <td>
          <button class="btn btn-icon" data-edit="${b.id}">✏️</button>
          <button class="btn btn-icon" data-delete="${b.id}">🗑️</button>
        </td>
      </tr>`
      )
      .join('');

    container.querySelector('#add-branch-btn').addEventListener('click', () => openModal(null));
    container.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openModal(branches.find((b) => b.id === btn.dataset.edit)))
    );
    container.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(t('confirm_delete'));
        if (!ok) return;
        try {
          await deleteBranch(btn.dataset.delete);
          toast(t('success'), 'success');
          loadData();
        } catch {
          toast('لا يمكن حذف فرع مرتبط ببيانات موجودة (منتجات/فواتير)، يمكنك إيقافه بدلاً من ذلك', 'error');
        }
      })
    );
  }

  function openModal(branch) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${branch ? t('edit_branch') : t('new_branch')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="branch-form">
            <div class="field">
              <label>${t('branch_name')}</label>
              <input class="input" name="name" required value="${branch?.name || ''}" />
            </div>
            <div class="field">
              <label>${t('branch_code')}</label>
              <input class="input" name="code" required value="${branch?.code || ''}" ${branch ? 'readonly style="background:var(--color-surface-2);"' : ''} />
            </div>
            <div class="field">
              <label>${t('branch_phone')}</label>
              <input class="input" name="phone" value="${branch?.phone || ''}" />
            </div>
            <div class="field">
              <label>باسورد الفرع</label>
              <input class="input" type="password" name="password" minlength="8" ${branch ? '' : 'required'} value="" placeholder="${branch ? 'اتركه فارغًا بدون تغيير' : 'karim123++'}" autocomplete="new-password" />
              ${!branch ? '<div class="text-muted" style="font-size:11px;margin-top:4px;">سيتم تعيينه افتراضيًا على karim123++ ويمكن تغييره قبل الحفظ.</div>' : ''}
            </div>
            <div class="field">
              <label>${t('branch_address')}</label>
              <input class="input" name="address" value="${branch?.address || ''}" />
            </div>
            <div class="field">
              <label>${t('status')}</label>
              <select class="input" name="is_active">
                <option value="true" ${branch?.is_active !== false ? 'selected' : ''}>${t('active')}</option>
                <option value="false" ${branch?.is_active === false ? 'selected' : ''}>${t('inactive')}</option>
              </select>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-branch-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-branch-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#branch-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name').trim(),
        code: fd.get('code').trim().toUpperCase(),
        phone: fd.get('phone').trim() || null,
        address: fd.get('address').trim() || null,
        is_active: fd.get('is_active') === 'true'
      };
      try {
        const password = String(fd.get('password') || '').trim();
        if (password) payload.password_hash = await hashBranchPassword(password);
        if (branch) await updateBranch(branch.id, payload);
        else {
          if (!password) throw new Error('branch-password-required');
          await createBranch(payload);
        }
        toast(t('success'), 'success');
        overlay.remove();
        loadData();
      } catch (err) {
        toast(err.message?.includes('duplicate') ? 'كود الفرع مستخدم بالفعل' : t('error_occurred'), 'error');
      }
    });
  }

  await loadData();

  const unsubscribe = subscribeRealtime(['branches'], () => {
    if (document.body.contains(container)) loadData();
  });
  return unsubscribe;
}
