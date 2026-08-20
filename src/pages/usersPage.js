import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listProfiles, setProfileActive, createUser, updateUser, deleteUser } from '../lib/db/users.js';
import { listBranches } from '../lib/db/branches.js';

const ROLE_LABELS = { admin: 'role_admin', manager: 'role_manager', cashier: 'role_cashier', technician: 'role_technician' };

export async function renderUsers(container, currentProfile) {
  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    const [profiles, branches] = await Promise.all([listProfiles(), listBranches({ onlyActive: true })]);
    draw(profiles, branches);
  }

  function draw(profiles, branches) {
    container.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom:18px;">
        <div></div>
        ${window.electronAPI?.users
          ? `<button class="btn btn-primary" id="add-user-btn">${t('add_user_btn')}</button>`
          : `<div class="card card-pad" style="background:var(--color-primary-light); border:none; flex:1;"><p style="font-size:13.5px;">ℹ️ ${t('add_user_hint')}</p></div>`}
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('customer_name')}</th>
              <th>${t('role')}</th>
              <th>${t('assigned_branch')}</th>
              <th>${t('last_login')}</th>
              <th>${t('status')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="users-tbody"></tbody>
        </table>
      </div>
    `;

    container.querySelector('#users-tbody').innerHTML = profiles
      .map(
        (p) => {
          return `
      <tr>
        <td><strong>${p.full_name || '—'}</strong>${p.id === currentProfile.id ? ` <span class="badge badge-muted">${t('welcome_user')}</span>` : ''}</td>
        <td>${t(ROLE_LABELS[p.role] || 'role_cashier')}</td>
        <td>
            ${p.role === 'admin'
            ? `<span class="text-muted">${t('all_branches')}</span>`
            : `<span class="text-muted">${p.branches?.name || t('no_branch_assigned')}</span>`}
        </td>
        <td class="text-muted" style="font-size:12.5px;">
          ${p.last_login_at ? new Date(p.last_login_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : t('never_logged_in')}
        </td>
        <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-danger'}">${p.is_active ? t('active') : t('deactivated')}</span></td>
        <td>
          ${p.id === currentProfile.id ? '' : `<button class="btn btn-sm btn-ghost" data-toggle="${p.id}" data-active="${p.is_active}">${p.is_active ? t('deactivate') : t('activate')}</button>`}
          ${p.id !== currentProfile.id && window.electronAPI?.users ? `<button class="btn btn-sm btn-ghost" data-edit="${p.id}">${t('edit')}</button><button class="btn btn-sm btn-ghost" data-delete="${p.id}" data-name="${p.full_name || p.username || ''}" style="color:var(--color-danger);">🗑️ ${t('delete')}</button>` : ''}
        </td>
      </tr>`;
        }
      )
      .join('');

    const addBtn = container.querySelector('#add-user-btn');
    if (addBtn) addBtn.addEventListener('click', () => openNewUserModal(branches));

    container.querySelectorAll('[data-toggle]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const nowActive = btn.dataset.active === 'true';
        try {
          await setProfileActive(btn.dataset.toggle, !nowActive);
          toast(t('success'), 'success');
          loadData();
        } catch {
          toast(t('error_occurred'), 'error');
        }
      })
    );

    container.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog(`${t('confirm_delete')} (${btn.dataset.name})`);
        if (!ok) return;
        try {
          await deleteUser(btn.dataset.delete);
          toast(t('success'), 'success');
          loadData();
        } catch (err) {
          toast(err.message || t('error_occurred'), 'error');
        }
      })
    );

    container.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const profile = profiles.find((p) => p.id === btn.dataset.edit);
        if (profile) openEditUserModal(profile, branches);
      })
    );
  }

  function openNewUserModal(branches) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${t('new_user_title')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="new-user-form">
            <div class="field">
              <label>${t('customer_name')}</label>
              <input class="input" name="fullName" required />
            </div>
            <div class="field">
              <label>${t('username')}</label>
              <input class="input" name="username" required minlength="3" />
            </div>
            <div class="field">
              <label>${t('password')}</label>
              <input class="input" type="password" name="password" required minlength="6" />
            </div>
            <div class="field">
              <label>${t('role')}</label>
              <select class="input" name="role">
                ${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}">${t(label)}</option>`).join('')}
              </select>
            </div>
            <div class="field" id="new-user-branch-field">
              <label>${t('assigned_branch')}</label>
              <select class="input" name="branchId">
                <option value="">${t('no_branch_assigned')}</option>
                ${branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}
              </select>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-new-user-btn">${t('save')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));

    const form = overlay.querySelector('#new-user-form');
    const roleSelect = form.querySelector('[name="role"]');
    const branchSelect = form.querySelector('[name="branchId"]');
    const branchField = overlay.querySelector('#new-user-branch-field');
    const syncBranchVisibility = () => {
      const isAdmin = roleSelect.value === 'admin';
      branchField.style.display = isAdmin ? 'none' : '';
      branchSelect.required = !isAdmin;
      if (isAdmin) branchSelect.value = '';
    };
    roleSelect.addEventListener('change', syncBranchVisibility);
    syncBranchVisibility();

    overlay.querySelector('#save-new-user-btn').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      try {
        await createUser({
          password: fd.get('password'),
          fullName: fd.get('fullName'),
          username: fd.get('username'),
          role: fd.get('role'),
          branchId: fd.get('branchId') || null
        });
        toast(t('success'), 'success');
        close();
        loadData();
      } catch (err) {
        toast(err.message || t('error_occurred'), 'error');
      }
    });
  }

  function openEditUserModal(profile, branches) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header"><h3>${t('edit')} — ${profile.full_name || profile.username}</h3><button class="btn btn-icon" data-close>✕</button></div>
        <div class="modal-body">
          <form id="edit-user-form">
            <div class="field"><label>${t('customer_name')}</label><input class="input" name="fullName" required value="${profile.full_name || ''}" /></div>
            <div class="field"><label>${t('username')}</label><input class="input" name="username" required minlength="3" value="${profile.username || ''}" /></div>
            <div class="field"><label>${t('password')} <span class="text-muted">(اتركها فارغة بدون تغيير)</span></label><input class="input" type="password" name="password" minlength="6" /></div>
            <div class="field"><label>${t('role')}</label><select class="input" name="role">${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}" ${profile.role === value ? 'selected' : ''}>${t(label)}</option>`).join('')}</select></div>
            <div class="field"><label>${t('assigned_branch')}</label><select class="input" name="branchId"><option value="">${t('no_branch_assigned')}</option>${branches.map((b) => `<option value="${b.id}" ${profile.branch_id === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></div>
            <div class="field"><label><input type="checkbox" name="isActive" ${profile.is_active ? 'checked' : ''} /> ${t('active')}</label></div>
          </form>
        </div>
        <div class="modal-footer"><button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn btn-primary" id="save-edit-user-btn">${t('save')}</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
    const form = overlay.querySelector('#edit-user-form');
    const role = form.querySelector('[name="role"]');
    const branch = form.querySelector('[name="branchId"]');
    const syncBranch = () => {
      const isAdmin = role.value === 'admin';
      branch.disabled = isAdmin;
      branch.required = !isAdmin;
      if (isAdmin) branch.value = '';
    };
    role.addEventListener('change', syncBranch);
    syncBranch();
    overlay.querySelector('#save-edit-user-btn').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      try {
        await updateUser(profile.id, {
          fullName: fd.get('fullName'),
          username: fd.get('username'),
          password: fd.get('password') || undefined,
          role: fd.get('role'),
          branchId: fd.get('branchId') || null,
          isActive: fd.get('isActive') === 'on'
        });
        toast(t('success'), 'success');
        close();
        await loadData();
      } catch (err) { toast(err.message || t('error_occurred'), 'error'); }
    });
  }

  await loadData();
}
