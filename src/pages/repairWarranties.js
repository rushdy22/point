import { t } from '../i18n/index.js';
import { listWarrantiedRepairs, isUnderWarranty, getDeviceHistoryBySerial } from '../lib/db/repairs.js';

function fmt(n) { return Number(n || 0).toFixed(2); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('ar-EG') : '—'; }

export async function renderRepairWarranties(container, profile, branchId) {
  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  let search = '';
  let repairs = await listWarrantiedRepairs({ branchId });

  function draw() {
    const q = search.trim().toLowerCase();
    const rows = q ? repairs.filter((r) =>
      (r.repair_number || '').toLowerCase().includes(q) ||
      (r.serial_number || '').toLowerCase().includes(q) ||
      (r.customer_name || r.customers?.name || '').toLowerCase().includes(q)
    ) : repairs;

    container.innerHTML = `
      <div class="input-search" style="max-width:340px; margin-bottom:18px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="warranty-search-input" placeholder="${t('search_by_serial')}" value="${search}" />
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('repair_number')}</th>
              <th>${t('customer_name')}</th>
              <th>${t('device_type')}</th>
              <th>${t('serial_number')}</th>
              <th>${t('warranty_start_date')}</th>
              <th>${t('warranty_expiry_date')}</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const under = isUnderWarranty(r);
              return `<tr>
                <td><strong>${r.repair_number}</strong></td>
                <td>${r.customer_name || r.customers?.name || '—'}</td>
                <td>${r.device_type}${r.device_model ? ' - ' + r.device_model : ''}</td>
                <td class="mono-num">${r.serial_number || '—'}</td>
                <td class="mono-num">${fmtDate(r.warranty_start_date)}</td>
                <td class="mono-num">${fmtDate(r.warranty_expiry_date)}</td>
                <td><span class="badge ${under ? 'badge-success' : 'badge-muted'}">${under ? t('under_warranty') : t('warranty_expired')}</span></td>
              </tr>`;
            }).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted);">—</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    container.querySelector('#warranty-search-input').addEventListener('input', (e) => { search = e.target.value; draw(); });
  }

  draw();
}
