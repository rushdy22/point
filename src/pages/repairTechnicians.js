import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listTechnicians, createTechnician, updateTechnician, deleteTechnician, getTechnicianPerformance } from '../lib/db/repairs.js';
import { canManage } from '../lib/permissions.js';

function fmt(n) { return Number(n || 0).toFixed(2); }

export async function renderRepairTechnicians(container, profile, branchId) {
  let technicians = [];
  const canEdit = canManage(profile?.role);

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    technicians = await listTechnicians({ branchId });
    await draw();
  }

  async function draw() {
    const withPerf = await Promise.all(technicians.map(async (tc) => {
      const perf = await getTechnicianPerformance(tc.id, branchId);
      return { ...tc, ...perf, commission: (perf.totalValue * Number(tc.commission_percent || 0)) / 100 };
    }));

    container.innerHTML = `
      <div class="flex justify-between items-center" style="margin-bottom:18px;">
        <div></div>
        ${canEdit ? `<button class="btn btn-primary" id="add-tech-btn">➕ ${t('new_technician')}</button>` : ''}
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('technician_name')}</th>
              <th>${t('technician_phone')}</th>
              <th>${t('technician_specialty')}</th>
              <th>${t('commission_percent')}</th>
              <th>${t('assigned_repairs')}</th>
              <th>${t('completed_repairs')}</th>
              <th>${t('total_repair_value')}</th>
              <th>${t('commission_total')}</th>
              ${canEdit ? `<th>${t('actions')}</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${withPerf.map((tc) => `
              <tr>
                <td><strong>${tc.name}</strong>${!tc.is_active ? ` <span class="badge badge-muted" style="font-size:10px;">${t('inactive') || 'غير نشط'}</span>` : ''}</td>
                <td>${tc.phone || '—'}</td>
                <td>${tc.specialty || '—'}</td>
                <td class="mono-num">${Number(tc.commission_percent || 0)}%</td>
                <td class="mono-num">${tc.assigned}</td>
                <td class="mono-num">${tc.completed}</td>
                <td class="mono-num">${fmt(tc.totalValue)}</td>
                <td class="mono-num">${fmt(tc.commission)}</td>
                ${canEdit ? `<td>
                  <button class="btn btn-icon" data-edit="${tc.id}">✏️</button>
                  <button class="btn btn-icon" data-del="${tc.id}">🗑️</button>
                </td>` : ''}
              </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--color-text-muted);">—</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    if (canEdit) {
      container.querySelector('#add-tech-btn').addEventListener('click', () => openModal(null));
      container.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openModal(technicians.find((tc) => tc.id === btn.dataset.edit))));
      container.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!await confirmDialog(t('confirm_delete') || 'تأكيد الحذف؟')) return;
        try { await deleteTechnician(btn.dataset.del); toast(t('success'), 'success'); await loadData(); }
        catch { toast(t('error_occurred'), 'error'); }
      }));
    }
  }

  function openModal(technician) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3>${technician ? t('edit_technician') : t('new_technician')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="tech-form">
            <div class="field"><label>${t('technician_name')}</label><input class="input" name="name" required value="${technician?.name || ''}" /></div>
            <div class="field"><label>${t('technician_phone')}</label><input class="input" name="phone" type="tel" value="${technician?.phone || ''}" /></div>
            <div class="field"><label>${t('technician_specialty')}</label><input class="input" name="specialty" value="${technician?.specialty || ''}" /></div>
            <div class="field"><label>${t('commission_percent')}</label><input class="input" name="commissionPercent" type="number" min="0" max="100" step="0.1" value="${technician?.commission_percent || 0}" /></div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-tech-btn">${t('save')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#save-tech-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#tech-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = { name: fd.get('name').trim(), phone: fd.get('phone').trim() || null, specialty: fd.get('specialty').trim() || null, commissionPercent: Number(fd.get('commissionPercent') || 0) };
      try {
        if (technician) await updateTechnician(technician.id, { name: payload.name, phone: payload.phone, specialty: payload.specialty, commission_percent: payload.commissionPercent });
        else await createTechnician({ ...payload, branchId });
        toast(t('success'), 'success');
        overlay.remove();
        await loadData();
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });
  }

  await loadData();
}
