import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import {
  listRepairOrders, listOverdueRepairs, getRepairOrder, createRepairOrder,
  startRepairInspection, submitRepairDiagnosis, recordRepairApproval, useRepairParts,
  markRepairReady, addRepairPayment, deliverRepair, cancelRepairOrder, createWarrantyClaim,
  listTechnicians, addRepairPhoto, deleteRepairPhoto, logRepairNotification, isUnderWarranty,
  getDeviceHistoryBySerial
} from '../lib/db/repairs.js';
import { listProducts } from '../lib/db/products.js';
import { listCustomers, whatsappLink } from '../lib/db/customers.js';
import { paymentMethodOptions, paymentMethodLabel } from '../lib/paymentMethods.js';
import { fileToResizedDataURL } from '../lib/imageUtils.js';
import { buildRepairReceivingReceiptHTML, buildRepairDeliveryInvoiceHTML, buildRepairWhatsAppReceiptText, openRepairDocumentPreview } from '../lib/repairPrinter.js';
import { canManage } from '../lib/permissions.js';
import { loadBranchSettings } from '../lib/settings.js';
import { fillWhatsAppTemplate, normalizeWhatsAppMessage } from '../lib/whatsapp.js';

const STATUS_LABEL = {
  received: 'repair_status_received',
  inspection: 'repair_status_inspection',
  waiting_approval: 'repair_status_waiting_approval',
  in_repair: 'repair_status_in_repair',
  ready: 'repair_status_ready',
  delivered: 'repair_status_delivered',
  cancelled: 'repair_status_cancelled'
};
const STATUS_BADGE = {
  received: 'badge-muted',
  inspection: 'badge-warning',
  waiting_approval: 'badge-warning',
  in_repair: 'badge-warning',
  ready: 'badge-success',
  delivered: 'badge-success',
  cancelled: 'badge-danger'
};

function fmt(n) { return Number(n || 0).toFixed(2); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('ar-EG') : '—'; }

export async function renderRepairOrders(container, profile, branchId, opts = {}) {
  const { statuses = null, overdueOnly = false, filterLabel } = opts;
  let repairs = [];
  let technicians = [];
  let search = '';
  let statusFilter = statuses?.length === 1 ? statuses[0] : (overdueOnly ? 'overdue' : 'all');
  const canManageRepairs = canManage(profile?.role) || profile?.role === 'technician' || profile?.role === 'cashier';
  const whatsappSettings = branchId ? await loadBranchSettings(branchId).catch(() => null) : null;

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    [repairs, technicians] = await Promise.all([
      overdueOnly ? listOverdueRepairs({ branchId }) : listRepairOrders({ branchId, statuses }),
      listTechnicians({ branchId, activeOnly: true })
    ]);
    draw();
  }

  function filteredRepairs() {
    const today = new Date().toISOString().slice(0, 10);
    let rows = repairs;
    if (statusFilter !== 'all') {
      rows = rows.filter((r) => statusFilter === 'overdue'
        ? r.expected_delivery_date && r.expected_delivery_date < today && !['delivered', 'cancelled'].includes(r.status)
        : r.status === statusFilter);
    }
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (r.repair_number || '').toLowerCase().includes(q) ||
      (r.customer_name || r.customers?.name || '').toLowerCase().includes(q) ||
      (r.customer_phone || r.customers?.phone || '').includes(q) ||
      (r.serial_number || '').toLowerCase().includes(q) ||
      (r.device_type || '').toLowerCase().includes(q) ||
      (r.device_model || '').toLowerCase().includes(q)
    );
  }

  function draw() {
    const rows = filteredRepairs();
    const today = new Date().toISOString().slice(0, 10);
    container.innerHTML = `
      <div class="flex justify-between items-center gap-16" style="margin-bottom:18px; flex-wrap:wrap;">
        <div class="flex items-center gap-12" style="flex-wrap:wrap; flex:1;">
          <div class="input-search" style="max-width:340px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3 4.3"/></svg>
            <input id="repair-search-input" placeholder="${t('search_by_serial')}" value="${search}" />
          </div>
          <select class="input" id="repair-status-filter" style="min-width:190px;">
            <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>${t('repair_filter_all_statuses')}</option>
            <option value="received" ${statusFilter === 'received' ? 'selected' : ''}>${t('repair_status_received')}</option>
            <option value="inspection" ${statusFilter === 'inspection' ? 'selected' : ''}>${t('repair_status_inspection')}</option>
            <option value="waiting_approval" ${statusFilter === 'waiting_approval' ? 'selected' : ''}>${t('repair_status_waiting_approval')}</option>
            <option value="in_repair" ${statusFilter === 'in_repair' ? 'selected' : ''}>${t('repair_status_in_repair')}</option>
            <option value="ready" ${statusFilter === 'ready' ? 'selected' : ''}>${t('repair_status_ready')}</option>
            <option value="delivered" ${statusFilter === 'delivered' ? 'selected' : ''}>${t('repair_status_delivered')}</option>
            <option value="cancelled" ${statusFilter === 'cancelled' ? 'selected' : ''}>${t('repair_status_cancelled')}</option>
            <option value="overdue" ${statusFilter === 'overdue' ? 'selected' : ''}>${t('repair_filter_overdue')}</option>
          </select>
        </div>
        <button class="btn btn-primary" id="add-repair-btn">➕ ${t('new_repair_order')}</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('repair_number')}</th>
              <th>${t('customer_name')}</th>
              <th>السيارة</th>
              <th>رقم العربية</th>
              <th>${t('technician')}</th>
              <th>${t('repair_total')}</th>
              <th>${t('remaining_amount')}</th>
              <th>${t('expected_delivery_date')}</th>
              <th>${t('repair_status_received').replace('تم ', '')}</th>
              <th>${t('actions')}</th>
            </tr>
          </thead>
          <tbody id="repairs-tbody"></tbody>
        </table>
        ${rows.length === 0 ? `<div class="table-empty">${t('no_repairs_found')}</div>` : ''}
      </div>
    `;

    container.querySelector('#repairs-tbody').innerHTML = rows.map((r) => {
      const isOverdue = r.expected_delivery_date && r.expected_delivery_date < today && !['delivered', 'cancelled'].includes(r.status);
      return `
      <tr data-open="${r.id}" style="cursor:pointer;">
        <td><strong>${r.repair_number}</strong>${r.is_warranty_claim ? ` <span class="badge badge-warning" style="font-size:10px;">${t('is_warranty_claim')}</span>` : ''}</td>
        <td>${r.customer_name || r.customers?.name || '—'}</td>
        <td>${r.device_type}${r.device_model ? ' - ' + r.device_model : ''}</td>
        <td class="mono-num">${r.serial_number || '—'}</td>
        <td>${r.technicians?.name || '—'}</td>
        <td class="mono-num">${fmt(r.total)}</td>
        <td class="mono-num">${fmt(r.remaining_amount)}</td>
        <td class="mono-num" style="${isOverdue ? 'color:var(--color-danger); font-weight:700;' : ''}">${fmtDate(r.expected_delivery_date)}</td>
        <td><span class="badge ${STATUS_BADGE[r.status] || 'badge-muted'}">${t(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td><button class="btn btn-icon" data-open-btn="${r.id}" title="${t('actions')}">👁️</button></td>
      </tr>`;
    }).join('');

    container.querySelectorAll('[data-open], [data-open-btn]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.open || el.dataset.openBtn;
        openDetail(id);
      });
    });

    container.querySelector('#repair-search-input').addEventListener('input', (e) => { search = e.target.value; draw(); });
    container.querySelector('#repair-status-filter').addEventListener('change', (e) => { statusFilter = e.target.value; draw(); });
    container.querySelector('#add-repair-btn').addEventListener('click', openCreateModal);
  }

  /* -------------------- Create repair order -------------------- */
  async function openCreateModal() {
    const customers = await listCustomers({ branchId }).catch(() => []);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>${t('new_repair_order')}</h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body">
          <form id="repair-create-form">
            <div class="flex gap-16">
              <div class="field" style="flex:1;">
                <label>${t('customer_name')}</label>
                <input class="input" name="customerName" list="repair-customers-list" required />
                <datalist id="repair-customers-list">${customers.map((c) => `<option value="${c.name}" data-phone="${c.phone || ''}" data-vehicle-type="${c.vehicle_type || ''}" data-vehicle-number="${c.vehicle_number || ''}" data-id="${c.id}">`).join('')}</datalist>
              </div>
              <div class="field" style="flex:1;">
                <label>${t('customer_phone')}</label>
                <input class="input" name="customerPhone" type="tel" required />
              </div>
            </div>
            <div class="flex gap-16">
              <div class="field" style="flex:1;">
                <label>السيارة</label>
                <input class="input" name="deviceType" placeholder="مثال: هيونداي إلنترا" required />
              </div>
              <div class="field" style="flex:1;">
                <label>${t('device_model')}</label>
                <input class="input" name="deviceModel" placeholder="${t('enter_model')}" />
              </div>
            </div>
            <div class="flex gap-16">
              <div class="field" style="flex:1;">
                <label>رقم العربية</label>
                <input class="input" name="serialNumber" id="repair-serial-input" placeholder="مثال: ع م ر 1234" required />
              </div>
              <div class="field" style="flex:1;">
                <label>${t('technician')}</label>
                <select class="input" name="technicianId">
                  <option value="">${t('select_technician')}</option>
                  ${technicians.map((tc) => `<option value="${tc.id}">${tc.name}</option>`).join('')}
                </select>
              </div>
            </div>
            <div id="device-history-hint"></div>
            <div class="field">
              <label>${t('reported_issue')}</label>
              <textarea class="input" name="reportedIssue" rows="2"></textarea>
            </div>
            <div class="flex gap-16">
              <div class="field" style="flex:1;">
                <label>${t('device_condition')}</label>
                <textarea class="input" name="deviceCondition" rows="2"></textarea>
              </div>
              <div class="field" style="flex:1;">
                <label>${t('accessories_received')}</label>
                <textarea class="input" name="accessoriesReceived" rows="2"></textarea>
              </div>
            </div>
            <div class="flex gap-16">
              <div class="field" style="flex:1;">
                <label>${t('expected_delivery_date')}</label>
                <input class="input" name="expectedDeliveryDate" type="date" />
              </div>
              <div class="field" style="flex:1;">
                <label>${t('deposit_amount')}</label>
                <input class="input" name="depositAmount" type="number" min="0" step="0.01" value="0" />
              </div>
              <div class="field" style="flex:1;">
                <label>${t('payment_method')}</label>
                <select class="input" name="paymentMethod">${paymentMethodOptions()}</select>
              </div>
            </div>
            <div class="field">
              <label>${t('repair_notes')}</label>
              <textarea class="input" name="notes" rows="2"></textarea>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-close>${t('cancel')}</button>
          <button class="btn btn-primary" id="save-repair-btn">${t('save')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const nameInput = overlay.querySelector('[name="customerName"]');
    const phoneInput = overlay.querySelector('[name="customerPhone"]');
    const vehicleInput = overlay.querySelector('[name="deviceType"]');
    const vehicleNumberInput = overlay.querySelector('[name="serialNumber"]');
    nameInput.addEventListener('input', () => {
      const opt = [...overlay.querySelectorAll('#repair-customers-list option')].find((o) => o.value === nameInput.value);
      if (opt) {
        phoneInput.value = opt.dataset.phone || '';
        vehicleInput.value = opt.dataset.vehicleType || '';
        vehicleNumberInput.value = opt.dataset.vehicleNumber || '';
      }
    });

    const serialInput = overlay.querySelector('#repair-serial-input');
    const hintBox = overlay.querySelector('#device-history-hint');
    let serialDebounce;
    serialInput.addEventListener('input', () => {
      clearTimeout(serialDebounce);
      const val = serialInput.value.trim();
      if (!val) { hintBox.innerHTML = ''; return; }
      serialDebounce = setTimeout(async () => {
        const history = await getDeviceHistoryBySerial(val, branchId).catch(() => []);
        if (history.length) {
          const lastDelivered = history.find((h) => h.status === 'delivered' && isUnderWarranty(h));
          hintBox.innerHTML = `<div class="box" style="border:1px solid var(--color-accent); border-radius:6px; padding:8px 10px; margin:-6px 0 14px; font-size:12.5px;">
            📋 ${t('device_history')}: ${history.length} ${t('nav_repair_orders')}.
            ${lastDelivered ? ` ⚠️ <b>${t('under_warranty')}</b> (${lastDelivered.repair_number}, ${t('warranty_expiry_date')}: ${lastDelivered.warranty_expiry_date})` : ''}
          </div>`;
        } else hintBox.innerHTML = '';
      }, 400);
    });

    overlay.querySelector('#save-repair-btn').addEventListener('click', async () => {
      const form = overlay.querySelector('#repair-create-form');
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const btn = overlay.querySelector('#save-repair-btn');
      btn.disabled = true;
      try {
        const created = await createRepairOrder({
          branchId,
          customerName: fd.get('customerName')?.trim() || null,
          customerPhone: fd.get('customerPhone')?.trim() || null,
          deviceType: fd.get('deviceType'),
          deviceModel: fd.get('deviceModel')?.trim() || null,
          serialNumber: fd.get('serialNumber')?.trim() || null,
          reportedIssue: fd.get('reportedIssue')?.trim() || null,
          deviceCondition: fd.get('deviceCondition')?.trim() || null,
          accessoriesReceived: fd.get('accessoriesReceived')?.trim() || null,
          technicianId: fd.get('technicianId') || null,
          expectedDeliveryDate: fd.get('expectedDeliveryDate') || null,
          depositAmount: Number(fd.get('depositAmount') || 0),
          paymentMethod: fd.get('paymentMethod'),
          notes: fd.get('notes')?.trim() || null,
          createdBy: profile.id
        });
        toast(t('repair_created_success'), 'success');
        overlay.remove();
        await loadData();
        openDetail(created.id);
      } catch (err) {
        toast(err?.message === 'CASH_DRAWER_CLOSED'
          ? 'لا يمكن تسجيل العربون النقدي قبل فتح شيفت درج الكاشير.'
          : (err.message || t('error_occurred')), 'error', 6000);
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* -------------------- Detail / workflow drawer -------------------- */
  async function openDetail(repairId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box modal-lg"><div class="modal-body"><div class="page-loader"><div class="spinner"></div></div></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    async function refresh() {
      const repair = await getRepairOrder(repairId);
      drawDetail(repair);
    }

    function drawDetail(repair) {
      const under = isUnderWarranty(repair);
      overlay.innerHTML = `
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h3>${repair.repair_number} — ${repair.device_type}${repair.device_model ? ' ' + repair.device_model : ''}
            <span class="badge ${STATUS_BADGE[repair.status]}" style="margin-inline-start:8px;">${t(STATUS_LABEL[repair.status] || repair.status)}</span>
          </h3>
          <button class="btn btn-icon" data-close>✕</button>
        </div>
        <div class="modal-body" style="max-height:70vh; overflow-y:auto;">
          <div class="flex gap-16" style="flex-wrap:wrap; margin-bottom:10px;">
            <div style="flex:1; min-width:220px;">
              <div class="meta-line"><b>${t('customer_name')}:</b> ${repair.customer_name || repair.customers?.name || '—'}
                ${(repair.customer_phone || repair.customers?.phone) ? ` — <a href="${whatsappLink(repair.customer_phone || repair.customers?.phone)}" target="_blank">${repair.customer_phone || repair.customers?.phone}</a>` : ''}</div>
              <div class="meta-line"><b>${t('serial_number')}:</b> ${repair.serial_number || '—'}</div>
              <div class="meta-line"><b>${t('technician')}:</b> ${repair.technicians?.name || '—'}</div>
              ${repair.is_warranty_claim ? `<div class="meta-line">🔗 <b>${t('original_repair')}:</b> ${repair.original_repair?.repair_number || '—'}</div>` : ''}
            </div>
            <div style="flex:1; min-width:220px;">
              <div class="meta-line"><b>${t('repair_total')}:</b> <span class="mono-num">${fmt(repair.total)}</span></div>
              <div class="meta-line"><b>${t('paid_amount')}:</b> <span class="mono-num">${fmt(repair.paid_amount)}</span></div>
              <div class="meta-line"><b>${t('remaining_amount')}:</b> <span class="mono-num">${fmt(repair.remaining_amount)}</span></div>
              ${repair.status === 'delivered' && repair.warranty_days > 0 ? `<div class="meta-line">${under ? `✅ <b>${t('under_warranty')}</b> (${repair.warranty_expiry_date})` : `⛔ ${t('warranty_expired')}`}</div>` : ''}
            </div>
          </div>

          <div class="section-block">
            <div class="section-title-row">${t('reported_issue')}</div>
            <div class="box-text">${repair.reported_issue || '—'}</div>
          </div>

          <div id="workflow-actions"></div>

          ${repair.diagnosis && repair.status !== 'inspection' ? `
          <div class="section-block">
            <div class="section-title-row">${t('diagnosis')}</div>
            <div class="box-text">${repair.diagnosis || '—'}</div>
            ${repair.required_parts_notes ? `<div class="box-text" style="margin-top:6px;"><b>الحل المقترح:</b> ${repair.required_parts_notes}</div>` : ''}
          </div>` : ''}


          <div class="section-block">
            <div class="section-title-row">${t('repair_add_payment')} (${(repair.repair_payments || []).length})</div>
            <table class="data-table" style="font-size:12.5px;">
              <thead><tr><th>${t('payment_amount')}</th><th>النوع</th><th>${t('payment_method')}</th><th>التاريخ</th></tr></thead>
              <tbody>${(repair.repair_payments || []).map((p) => `<tr><td class="mono-num">${fmt(p.amount)}</td><td>${p.payment_type === 'deposit' ? t('payment_type_deposit') : t('payment_type_payment')}</td><td>${paymentMethodLabel(p.payment_method)}</td><td>${fmtDate(p.created_at)}</td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);">—</td></tr>`}</tbody>
            </table>
          </div>

          <div class="section-block">
            <div class="section-title-row">${t('repair_photos')}</div>
            <div id="photos-gallery" class="flex gap-8" style="flex-wrap:wrap;"></div>
            <div class="flex gap-8" style="margin-top:8px; align-items:center;">
              <select class="input" id="photo-stage-select" style="width:auto;">
                <option value="before">${t('photo_stage_before')}</option>
                <option value="during">${t('photo_stage_during')}</option>
                <option value="after">${t('photo_stage_after')}</option>
              </select>
              <input type="file" accept="image/*" id="photo-file-input" style="display:none;" />
              <button class="btn btn-ghost" id="photo-upload-btn">📷 ${t('upload_photo')}</button>
            </div>
          </div>

          <div class="section-block">
            <div class="section-title-row">${t('whatsapp_notify')}</div>
            <div class="flex gap-8" style="flex-wrap:wrap;">
              ${notifyButtons(repair)}
            </div>
          </div>

          <div class="section-block">
            <div class="section-title-row">سجل الحالة</div>
            <div class="timeline">
              ${(repair.repair_status_history || []).map((h) => `<div class="timeline-row"><span class="badge ${STATUS_BADGE[h.status] || 'badge-muted'}">${t(STATUS_LABEL[h.status] || h.status)}</span><span class="text-muted" style="font-size:11.5px;">${fmtDate(h.created_at)} ${h.notes ? '— ' + h.notes : ''}</span></div>`).join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between;">
          <div class="flex gap-8">
            <button class="btn btn-ghost" id="print-receiving-btn">🖨️ ${t('print_receipt')}</button>
            ${['ready', 'delivered'].includes(repair.status) ? `<button class="btn btn-ghost" id="print-invoice-btn">🖨️ ${t('print_invoice')}</button>` : ''}
          </div>
          <div class="flex gap-8">
            ${!['delivered', 'cancelled'].includes(repair.status) ? `<button class="btn btn-danger" id="cancel-repair-btn">${t('repair_cancel')}</button>` : ''}
            <button class="btn btn-ghost" data-close>${t('close')}</button>
          </div>
        </div>
      </div>`;

      overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
      renderWorkflowActions(repair);
      renderPhotos(repair);
      bindFooterActions(repair);
    }

    function notifyButtons(repair) {
      const phone = repair.customer_phone || repair.customers?.phone;
      if (!phone) return `<span class="text-muted">${t('no_phone')}</span>`;
      if (whatsappSettings?.whatsapp?.enabled === false) return `<span class="text-muted">واتساب غير مفعّل من الإعدادات</span>`;
      const wa = whatsappSettings?.whatsapp || {};
      const base = { customer: repair.customer_name || repair.customers?.name || '', repair: repair.repair_number, type: repair.device_type || '', issue: repair.reported_issue || '—', diagnosis: repair.diagnosis || '—', solution: repair.required_parts_notes || '—', total: fmt(repair.total || repair.estimated_total || 0), remaining: fmt(repair.remaining_amount || 0), warranty: repair.warranty_expiry_date || '—' };
      const events = [
        { key: 'device_received', label: t('notify_device_received'), msg: normalizeWhatsAppMessage(fillWhatsAppTemplate(wa.repairReceivedTemplate, base), wa.footer) },
        { key: 'waiting_approval', label: t('notify_waiting_approval'), msg: normalizeWhatsAppMessage(fillWhatsAppTemplate(wa.repairQuoteTemplate, { ...base, parts: '', labor: fmt(repair.labor_cost || 0), discount: fmt(repair.discount || 0) }), wa.footer) },
        { key: 'approved', label: t('notify_approved'), msg: normalizeWhatsAppMessage(fillWhatsAppTemplate(wa.repairApprovedTemplate, base), wa.footer) },
        { key: 'ready', label: t('notify_ready'), msg: normalizeWhatsAppMessage(fillWhatsAppTemplate(wa.repairReadyTemplate, base), wa.footer) },
        { key: 'pickup_reminder', label: t('notify_pickup_reminder'), msg: normalizeWhatsAppMessage(fillWhatsAppTemplate(wa.repairPickupTemplate, base), wa.footer) },
        { key: 'warranty_reminder', label: t('notify_warranty_reminder'), msg: normalizeWhatsAppMessage(fillWhatsAppTemplate(wa.repairWarrantyTemplate, base), wa.footer) }
      ];
      return events.map((ev) => `<a class="btn btn-ghost" style="font-size:12px;" href="${whatsappLink(phone, ev.msg)}" target="_blank" data-notify="${ev.key}">💬 ${ev.label}</a>`).join('');
    }

    function renderPhotos(repair) {
      const gallery = overlay.querySelector('#photos-gallery');
      const photos = repair.repair_photos || [];
      gallery.innerHTML = photos.length ? photos.map((p) => `
        <div style="position:relative;">
          <img src="${p.file_path}" data-zoom="${p.id}" style="width:84px;height:84px;object-fit:cover;border-radius:8px;cursor:zoom-in;border:1px solid var(--color-border);" title="${t('photo_stage_' + p.stage) || p.stage}" />
          <button class="btn btn-icon" data-del-photo="${p.id}" style="position:absolute;top:-6px;left:-6px;width:22px;height:22px;padding:0;font-size:11px;">✕</button>
        </div>`).join('') : `<div class="text-muted" style="font-size:12.5px;">${t('no_photos')}</div>`;

      gallery.querySelectorAll('[data-zoom]').forEach((img) => img.addEventListener('click', () => {
        const zoomOverlay = document.createElement('div');
        zoomOverlay.className = 'modal-overlay';
        zoomOverlay.innerHTML = `<img src="${img.src}" style="max-width:90vw; max-height:90vh; border-radius:8px;" />`;
        zoomOverlay.addEventListener('click', () => zoomOverlay.remove());
        document.body.appendChild(zoomOverlay);
      }));
      gallery.querySelectorAll('[data-del-photo]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!await confirmDialog(t('delete_photo') + '?')) return;
        try { await deleteRepairPhoto(btn.dataset.delPhoto); await refresh(); } catch { toast(t('error_occurred'), 'error'); }
      }));

      overlay.querySelector('#photo-upload-btn').addEventListener('click', () => overlay.querySelector('#photo-file-input').click());
      overlay.querySelector('#photo-file-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const dataUrl = await fileToResizedDataURL(file);
          await addRepairPhoto({ repairId: repair.id, branchId, stage: overlay.querySelector('#photo-stage-select').value, filePath: dataUrl, createdBy: profile.id });
          await refresh();
        } catch { toast(t('error_occurred'), 'error'); }
      });
    }

    // "Awaiting Inspection" screen: diagnosis + required repair + the repair
    // materials/parts builder (from the maintenance inventory only) + labor
    // + discount, with the total recalculated live as
    // Total = Materials + Labor - Discount. Nothing here touches stock yet —
    // materials are only a quotation until the customer approves (spec:
    // "Do NOT deduct inventory when creating the quotation").
    function renderInspectionForm(repair, box) {
      // Prefill from any materials already planned (not yet stock-deducted)
      // on this repair, so reopening the screen doesn't lose earlier work.
      let materials = (repair.repair_parts_used || [])
        .filter((p) => !p.stock_deducted)
        .map((p) => ({ productId: p.product_id, name: p.product_name, qty: Number(p.quantity), unitPrice: Number(p.unit_price) }));
      let maintenanceMaterials = [];

      box.innerHTML = `
        <div class="section-block">
          <div class="section-title-row">${t('repair_submit_diagnosis')}</div>
          <form id="diagnosis-form">
            <div class="field"><label>${t('diagnosis')}</label><textarea class="input" name="diagnosis" rows="2" required>${repair.diagnosis ? repair.diagnosis.replace(/</g, '&lt;') : ''}</textarea></div>
            <div class="field"><label>الحل المقترح</label><textarea class="input" name="requiredPartsNotes" rows="2" placeholder="اكتب الحل المقترح للعميل...">${repair.required_parts_notes ? repair.required_parts_notes.replace(/</g, '&lt;') : ''}</textarea></div>

            <div class="section-title-row" style="margin-top:14px;">🔧 ${t('repair_materials_section')}</div>
            <div class="flex gap-8" style="align-items:flex-end; flex-wrap:wrap;">
              <div class="field" style="flex:2; min-width:200px; margin-bottom:0;"><label>${t('repair_material')}</label>
                <select class="input" id="insp-material-select"><option value="">${t('select_repair_material')}</option></select>
              </div>
              <div class="field" style="width:90px; margin-bottom:0;"><label>${t('quantity')}</label><input class="input" id="insp-material-qty" type="number" min="0.001" step="0.001" value="1" /></div>
              <button type="button" class="btn btn-ghost" id="insp-add-material-btn">➕ ${t('add_material')}</button>
            </div>
            <table class="data-table" style="font-size:12.5px; margin-top:8px;">
              <thead><tr><th>${t('repair_material')}</th><th>${t('quantity')}</th><th>${t('unit_price')}</th><th>${t('line_total')}</th><th></th></tr></thead>
              <tbody id="insp-materials-tbody"></tbody>
            </table>

            <div class="flex gap-16" style="margin-top:14px;">
              <div class="field" style="flex:1;"><label>${t('labor_cost')}</label><input class="input" id="insp-labor-cost" name="laborCost" type="number" min="0" step="0.01" value="${Number(repair.labor_cost || 0)}" /></div>
              <div class="field" style="flex:1;"><label>${t('discount')}</label><input class="input" id="insp-discount" name="discount" type="number" min="0" step="0.01" value="${Number(repair.discount || 0)}" /></div>
            </div>

            <div class="box-text" style="margin:10px 0;">
              <div class="meta-line"><b>${t('materials_subtotal')}:</b> <span class="mono-num" id="insp-materials-subtotal">0.00</span></div>
              <div class="meta-line"><b>${t('labor_cost')}:</b> <span class="mono-num" id="insp-labor-display">0.00</span></div>
              <div class="meta-line"><b>${t('discount')}:</b> <span class="mono-num" id="insp-discount-display">0.00</span></div>
              <div class="meta-line" style="font-size:15px; margin-top:4px;"><b>${t('estimated_total')}:</b> <span class="mono-num" id="insp-final-total" style="font-weight:700;">0.00</span></div>
            </div>

            <button type="submit" class="btn btn-primary">📤 ${t('save_inspection_send_customer')}</button>
          </form>
        </div>`;

      const form = box.querySelector('#diagnosis-form');
      const materialSelect = box.querySelector('#insp-material-select');
      const qtyInput = box.querySelector('#insp-material-qty');
      const tbody = box.querySelector('#insp-materials-tbody');
      const laborInput = box.querySelector('#insp-labor-cost');
      const discountInput = box.querySelector('#insp-discount');

      function recalcTotals() {
        const materialsSubtotal = materials.reduce((sum, m) => sum + m.qty * m.unitPrice, 0);
        const labor = Number(laborInput.value || 0);
        const discount = Number(discountInput.value || 0);
        const total = Math.max(materialsSubtotal + labor - discount, 0);
        box.querySelector('#insp-materials-subtotal').textContent = fmt(materialsSubtotal);
        box.querySelector('#insp-labor-display').textContent = fmt(labor);
        box.querySelector('#insp-discount-display').textContent = fmt(discount);
        box.querySelector('#insp-final-total').textContent = fmt(total);
      }

      function renderMaterialsTable() {
        tbody.innerHTML = materials.length ? materials.map((m, idx) => `
          <tr>
            <td>${m.name}</td>
            <td class="mono-num">${m.qty}</td>
            <td class="mono-num">${fmt(m.unitPrice)}</td>
            <td class="mono-num">${fmt(m.qty * m.unitPrice)}</td>
            <td><button type="button" class="btn btn-icon" data-remove-material="${idx}" title="${t('delete') || 'حذف'}">✕</button></td>
          </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);">—</td></tr>`;
        tbody.querySelectorAll('[data-remove-material]').forEach((btn) => btn.addEventListener('click', () => {
          materials.splice(Number(btn.dataset.removeMaterial), 1);
          renderMaterialsTable();
          recalcTotals();
        }));
        recalcTotals();
      }

      // Materials must come from the maintenance inventory (is_raw_material)
      // — normal sale products never show up here, matching the inventory
      // rule that repair parts cannot be regular products.
      listProducts({ branchId, onlyActive: true }).then((products) => {
        maintenanceMaterials = products.filter((p) => p.is_raw_material);
        materialSelect.innerHTML = `<option value="">${t('select_repair_material')}</option>` +
          maintenanceMaterials.map((p) => `<option value="${p.id}" data-name="${p.name}" data-price="${p.price}">${p.name} — ${t('stock') || 'مخزون'}: ${p.stock_quantity} ${p.unit || ''}</option>`).join('');
        materialSelect.addEventListener('change', () => {});
      });

      box.querySelector('#insp-add-material-btn').addEventListener('click', () => {
        const productId = materialSelect.value;
        if (!productId) { toast(t('select_product'), 'error'); return; }
        const opt = materialSelect.selectedOptions[0];
        const qty = Number(qtyInput.value || 0);
        const unitPrice = Number(opt?.dataset.price || 0);
        if (qty <= 0) { toast(t('invalid_quantity'), 'error'); return; }
        const existing = materials.find((m) => m.productId === productId);
        if (existing) { existing.qty += qty; existing.unitPrice = unitPrice; }
        else materials.push({ productId, name: opt.dataset.name, qty, unitPrice });
        qtyInput.value = 1;
        renderMaterialsTable();
      });

      laborInput.addEventListener('input', recalcTotals);
      discountInput.addEventListener('input', recalcTotals);
      renderMaterialsTable();

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        try {
          await submitRepairDiagnosis({
            repairId: repair.id, branchId,
            diagnosis: fd.get('diagnosis'), requiredPartsNotes: fd.get('requiredPartsNotes'),
            laborCost: Number(fd.get('laborCost') || 0), discount: Number(fd.get('discount') || 0),
            items: materials.map((m) => ({ productId: m.productId, quantity: m.qty, unitPrice: m.unitPrice })),
            userId: profile.id
          });
          toast(t('repair_diagnosis_saved'), 'success');
          await refresh();
        } catch (err) { toast(err.message, 'error'); }
        finally { submitBtn.disabled = false; }
      });
    }

    function renderWorkflowActions(repair) {
      const box = overlay.querySelector('#workflow-actions');
      if (!canManageRepairs) { box.innerHTML = ''; return; }

      if (repair.status === 'received') {
        box.innerHTML = `
          <div class="section-block">
            <button class="btn btn-primary" id="start-inspection-btn">🔍 ${t('repair_start_inspection')}</button>
          </div>`;
        box.querySelector('#start-inspection-btn').addEventListener('click', async () => {
          try { await startRepairInspection({ repairId: repair.id, branchId, userId: profile.id }); await refresh(); }
          catch (err) { toast(err.message, 'error'); }
        });
        return;
      }

      if (repair.status === 'inspection') {
        renderInspectionForm(repair, box);
        return;
      }

      if (repair.status === 'waiting_approval') {
        const parts = (repair.repair_parts_used || []).filter((p) => !p._deleted);
        const partsSubtotal = parts.reduce((sum, p) => sum + Number(p.total || 0), 0);
        const labor = Number(repair.labor_cost || 0);
        const discount = Number(repair.discount || 0);
        const total = Math.max(partsSubtotal + labor - discount, 0);
        const phone = repair.customer_phone || repair.customers?.phone;
        const quoteMessage = `مرحبًا ${repair.customer_name || ''}،\n\nطلب الصيانة ${repair.repair_number}\nالعطل: ${repair.reported_issue || '—'}\nالتشخيص: ${repair.diagnosis || '—'}\nالحل المقترح: ${repair.required_parts_notes || '—'}\n\nقطع الغيار / المواد:\n${parts.length ? parts.map((p) => `- ${p.product_name} × ${p.quantity} = ${fmt(p.total)}`).join('\n') : '- لا توجد مواد'}\nأجرة الصيانة: ${fmt(labor)}\nالخصم: ${fmt(discount)}\nالإجمالي: ${fmt(total)} جنيه\n\nبرجاء تأكيد الموافقة على الإصلاح.`;
        const whatsappUrl = phone ? whatsappLink(phone, quoteMessage) : '';
        box.innerHTML = `
          <div class="section-block">
            <div class="section-title-row">عرض سعر الصيانة</div>
            <div class="box-text" style="margin-bottom:10px;">العطل: ${repair.reported_issue || '—'}<br>التشخيص: ${repair.diagnosis || '—'}<br>الحل المقترح: ${repair.required_parts_notes || '—'}</div>
            <div class="table-wrap">
              <table class="data-table" style="font-size:12.5px;">
                <thead><tr><th>النوع</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                <tbody>
                  ${parts.map((p) => `<tr><td>${p.product_name}</td><td class="mono-num">${p.quantity}</td><td class="mono-num">${fmt(p.unit_price)}</td><td class="mono-num">${fmt(p.total)}</td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);">لا توجد قطع أو مواد</td></tr>`}
                  <tr><td colspan="3"><b>أجرة الصيانة</b></td><td class="mono-num"><b>${fmt(labor)}</b></td></tr>
                  ${discount > 0 ? `<tr><td colspan="3">الخصم</td><td class="mono-num">-${fmt(discount)}</td></tr>` : ''}
                  <tr><td colspan="3"><b>الإجمالي</b></td><td class="mono-num" style="font-size:16px;font-weight:700;">${fmt(total)}</td></tr>
                </tbody>
              </table>
            </div>
            <div class="flex gap-8" style="margin-top:10px; flex-wrap:wrap;">
              ${phone ? `<a class="btn btn-ghost" href="${whatsappUrl}" target="_blank" id="send-quote-whatsapp-btn">💬 إرسال للعميل واتساب</a>` : `<span class="text-muted">لا يوجد رقم واتساب للعميل</span>`}
            </div>
            <div class="flex gap-8" style="margin-top:12px;">
              <button class="btn btn-primary" id="approve-btn">✅ ${t('repair_approve')}</button>
              <button class="btn btn-danger" id="reject-btn">❌ ${t('repair_reject')}</button>
            </div>
          </div>`;
        const waBtn = box.querySelector('#send-quote-whatsapp-btn');
        if (waBtn) waBtn.addEventListener('click', () => {
          logRepairNotification({ repairId: repair.id, branchId, eventType: 'quote_details', channel: 'whatsapp', message: quoteMessage, sentBy: profile.id }).catch(() => {});
        });
        box.querySelector('#approve-btn').addEventListener('click', async () => {
          try { await recordRepairApproval({ repairId: repair.id, branchId, approved: true, userId: profile.id }); toast(t('repair_approved_success'), 'success'); await refresh(); }
          catch (err) {
            const shortage = /^INSUFFICIENT_STOCK_FOR_PART:(.+)$/.exec(err.message || '');
            toast(shortage ? `${t('insufficient_stock_for_part')}: ${shortage[1]}` : err.message, 'error');
          }
        });
        box.querySelector('#reject-btn').addEventListener('click', async () => {
          const reason = prompt(t('cancel_reason'));
          if (reason === null) return;
          try { await recordRepairApproval({ repairId: repair.id, branchId, approved: false, notes: reason, userId: profile.id }); toast(t('repair_rejected_success'), 'success'); await refresh(); }
          catch (err) { toast(err.message, 'error'); }
        });
        return;
      }

      if (repair.status === 'in_repair') {
        box.innerHTML = `
          <div class="section-block">
            <div class="section-title-row">${t('add_part')} (${t('repair_use_parts')})</div>
            <div class="box-text" style="margin-bottom:8px;">قطع إضافية غير مذكورة في عرض السعر الأصلي — تُخصم من المخزون فور إضافتها هنا.</div>
            <form id="parts-form" class="flex gap-8" style="align-items:flex-end; flex-wrap:wrap;">
              <div class="field" style="flex:2; min-width:200px; margin-bottom:0;"><label>${t('repair_material')}</label><select class="input" name="productId" id="parts-product-select"><option value="">${t('select_repair_material')}</option></select></div>
              <div class="field" style="width:90px; margin-bottom:0;"><label>${t('quantity')}</label><input class="input" name="quantity" type="number" min="0.001" step="0.001" value="1" /></div>
              <div class="field" style="width:110px; margin-bottom:0;"><label>${t('unit_price')}</label><input class="input" name="unitPrice" type="number" min="0" step="0.01" required /></div>
              <button type="submit" class="btn btn-ghost">${t('add_part')}</button>
            </form>
            <div style="margin-top:10px;"><button class="btn btn-primary" id="mark-ready-btn">✅ ${t('repair_mark_ready')}</button></div>
          </div>`;
        listProducts({ branchId, onlyActive: true }).then((products) => {
          const materials = products.filter((p) => p.is_raw_material);
          const select = box.querySelector('#parts-product-select');
          select.innerHTML = `<option value="">${t('select_repair_material')}</option>` + materials.map((p) => `<option value="${p.id}" data-price="${p.price}" data-cost="${p.cost}">${p.name} — ${t('stock')}: ${p.stock_quantity} ${p.unit}</option>`).join('');
          select.addEventListener('change', () => {
            const opt = select.selectedOptions[0];
            if (opt?.dataset.price) box.querySelector('[name="unitPrice"]').value = opt.dataset.price;
          });
        });
        box.querySelector('#parts-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const productId = fd.get('productId');
          if (!productId) { toast(t('select_product'), 'error'); return; }
          try {
            await useRepairParts({ repairId: repair.id, branchId, items: [{ productId, quantity: Number(fd.get('quantity') || 1), unitPrice: fd.get('unitPrice') ? Number(fd.get('unitPrice')) : undefined }], userId: profile.id });
            toast(t('repair_parts_saved'), 'success');
            await refresh();
          } catch (err) { toast(err.message === 'INSUFFICIENT_STOCK' ? t('insufficient_stock_for_part') : err.message === 'REPAIR_PART_MUST_BE_MATERIAL' ? 'الصنف ده مش مُسجل كمادة صيانة' : err.message, 'error'); }
        });
        box.querySelector('#mark-ready-btn').addEventListener('click', async () => {
          try { await markRepairReady({ repairId: repair.id, branchId, userId: profile.id }); toast(t('repair_ready_success'), 'success'); await refresh(); }
          catch (err) { toast(err.message, 'error'); }
        });
        return;
      }

      if (repair.status === 'ready') {
        box.innerHTML = `
          <div class="section-block">
            <div class="section-title-row">${t('repair_add_payment')}</div>
            <form id="payment-form" class="flex gap-8" style="align-items:flex-end; flex-wrap:wrap;">
              <div class="field" style="width:130px; margin-bottom:0;"><label>${t('payment_amount')}</label><input class="input" name="amount" type="number" min="0.01" step="0.01" required /></div>
              <div class="field" style="width:150px; margin-bottom:0;"><label>${t('payment_method')}</label><select class="input" name="paymentMethod">${paymentMethodOptions()}</select></div>
              <button type="submit" class="btn btn-ghost">${t('repair_add_payment')}</button>
            </form>
            <div class="flex gap-8" style="margin-top:12px; align-items:flex-end;">
              <div class="field" style="width:120px; margin-bottom:0;"><label>${t('warranty_days')}</label><input class="input" id="warranty-days-input" type="number" min="0" value="90" /></div>
              <button class="btn btn-primary" id="deliver-btn">📦 ${t('repair_deliver')}</button>
            </div>
          </div>`;
        box.querySelector('#payment-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await addRepairPayment({ repairId: repair.id, branchId, amount: Number(fd.get('amount')), paymentMethod: fd.get('paymentMethod'), paymentType: 'payment', userId: profile.id });
            toast(t('repair_payment_saved'), 'success');
            await refresh();
          } catch (err) { toast(err?.message === 'CASH_DRAWER_CLOSED' ? 'لا يمكن تسجيل العربون/الدفعة النقدية قبل فتح شيفت درج الكاشير.' : err.message, 'error', 6000); }
        });
        box.querySelector('#deliver-btn').addEventListener('click', async () => {
          try {
            await deliverRepair({ repairId: repair.id, branchId, warrantyDays: Number(box.querySelector('#warranty-days-input').value || 0), userId: profile.id });
            toast(t('repair_delivered_success'), 'success');
            await refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
        return;
      }

      if (repair.status === 'delivered') {
        box.innerHTML = `<div class="section-block"><button class="btn btn-ghost" id="warranty-claim-btn">🛡️ ${t('create_warranty_claim')}</button></div>`;
        box.querySelector('#warranty-claim-btn').addEventListener('click', async () => {
          try {
            const claim = await createWarrantyClaim({ originalRepairId: repair.id, branchId, createdBy: profile.id });
            toast(t('repair_created_success'), 'success');
            overlay.remove();
            await loadData();
            openDetail(claim.id);
          } catch (err) { toast(err.message === 'WARRANTY_EXPIRED' ? t('warranty_expired') : err.message, 'error'); }
        });
        return;
      }

      box.innerHTML = '';
    }

    function bindFooterActions(repair) {
      overlay.querySelector('#print-receiving-btn').addEventListener('click', () => {
        openRepairDocumentPreview(t('repair_receiving_receipt'), buildRepairReceivingReceiptHTML(repair, branchId), { whatsappPhone: repair.customer_phone || repair.customers?.phone || '', whatsappMessage: buildRepairWhatsAppReceiptText(repair, branchId, 'receiving') });
      });
      const printInvoiceBtn = overlay.querySelector('#print-invoice-btn');
      if (printInvoiceBtn) {
        printInvoiceBtn.addEventListener('click', () => {
          openRepairDocumentPreview(t('repair_delivery_invoice'), buildRepairDeliveryInvoiceHTML(repair, repair.repair_parts_used, repair.repair_payments, branchId), { whatsappPhone: repair.customer_phone || repair.customers?.phone || '', whatsappMessage: buildRepairWhatsAppReceiptText(repair, branchId, 'delivery', repair.repair_parts_used, repair.repair_payments) });
        });
      }
      const cancelBtn = overlay.querySelector('#cancel-repair-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          const reason = prompt(t('cancel_reason'));
          if (reason === null) return;
          try {
            await cancelRepairOrder({ repairId: repair.id, branchId, reason, userId: profile.id });
            toast(t('repair_cancelled_success'), 'success');
            overlay.remove();
            await loadData();
          } catch (err) { toast(err.message, 'error'); }
        });
      }
      overlay.querySelectorAll('[data-notify]').forEach((link) => {
        link.addEventListener('click', () => {
          logRepairNotification({ repairId: repair.id, branchId, eventType: link.dataset.notify, channel: 'whatsapp', sentBy: profile.id }).catch(() => {});
        });
      });
    }

    await refresh();
  }

  await loadData();
}
