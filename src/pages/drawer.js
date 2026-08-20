import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { listBranches } from '../lib/db/branches.js';
import { getOpenShift, openShift, closeShift, listShiftHistory, addCashMovement, computeExpectedCash } from '../lib/db/cashShifts.js';
import { openCashDrawer } from '../lib/cashDrawer.js';

const money = (value) => Number(value || 0).toFixed(2);
const dateTime = (value) => new Date(value).toLocaleString('ar-EG');

export async function renderDrawer(container, profile, branchId) {
  let branches = [];
  let selectedBranchId = branchId;
  let shift = null;
  let expected = null;
  let history = [];

  async function load() {
    container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;
    if (!selectedBranchId) {
      branches = await listBranches({ onlyActive: true });
      selectedBranchId = branches[0]?.id || null;
    }
    if (selectedBranchId) {
      shift = await getOpenShift(selectedBranchId);
      expected = shift ? await computeExpectedCash(shift) : null;
      history = await listShiftHistory({ branchId: selectedBranchId, limit: 15 });
    }
    draw();
  }

  function picker() {
    return !branchId ? `<div class="field" style="max-width:260px; margin-bottom:16px;"><label>${t('branch')}</label><select class="input" id="drawer-branch">${branches.map((branch) => `<option value="${branch.id}" ${branch.id === selectedBranchId ? 'selected' : ''}>${branch.name}</option>`).join('')}</select></div>` : '';
  }

  function draw() {
    if (!selectedBranchId) { container.innerHTML = `${picker()}<div class="table-empty">${t('no_data')}</div>`; return; }
    container.innerHTML = `
      ${picker()}
      <div class="flex justify-between items-center" style="margin-bottom:16px; flex-wrap:wrap; gap:12px;"><h3 style="margin:0;">🗄️ درج الكاشير</h3><button class="btn btn-ghost" id="drawer-open-hw">🗄️ ${t('open_cash_drawer')}</button></div>
      ${!shift ? `<div class="card card-pad" style="text-align:center; padding:32px;"><p class="text-muted" style="margin-bottom:16px;">لا يوجد شيفت مفتوح حاليًا لهذا الفرع</p><button class="btn btn-primary" id="start-shift">▶️ فتح شيفت جديد</button></div>` : openMarkup()}
      <h4 style="margin:20px 0 10px;">سجل الشيفتات السابقة</h4>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>فُتح بواسطة</th><th>أُغلق بواسطة</th><th>رصيد افتتاحي</th><th>الرصيد المتوقع</th><th>العدد الفعلي</th><th>الفرق</th></tr></thead><tbody>${history.map((item) => { const difference = Number(item.difference || 0); return `<tr><td>${item.opener?.full_name || '—'}<div class="text-muted" style="font-size:11px;">${dateTime(item.opened_at)}</div></td><td>${item.closer?.full_name || '—'}<div class="text-muted" style="font-size:11px;">${item.closed_at ? dateTime(item.closed_at) : '—'}</div></td><td class="mono-num">${money(item.opening_float)}</td><td class="mono-num">${money(item.expected_cash)}</td><td class="mono-num">${money(item.actual_cash_counted)}</td><td class="mono-num" style="color:${difference === 0 ? 'inherit' : difference > 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${difference > 0 ? '+' : ''}${money(difference)}</td></tr>`; }).join('')}</tbody></table>${history.length ? '' : `<div class="table-empty">${t('no_data')}</div>`}</div>`;
    bind();
  }

  function openMarkup() {
    return `<div class="card card-pad" style="margin-bottom:16px; background:var(--color-surface-2); border:none;"><div class="text-muted" style="font-size:13px;">فُتح بواسطة: <strong>${shift.opener?.full_name || '—'}</strong> — ${dateTime(shift.opened_at)}</div></div>
      <div class="flex gap-16" style="flex-wrap:wrap; margin-bottom:16px;">${stat('🏁', 'رصيد افتتاحي', money(shift.opening_float))}${stat('💵', 'مبيعات نقدي منذ الفتح', `+${money(expected.cashSalesTotal)}`, 'var(--color-success)')}${stat('↩️', 'مرتجعات نقدي منذ الفتح', `-${money(expected.cashRefundsTotal)}`, 'var(--color-danger)')}${stat('🧾', 'عربونات صيانة', `+${money(expected.repairDepositsTotal)}`, 'var(--color-success)')}${stat('➕', 'إيداعات نقدية', `+${money(expected.cashIn)}`, 'var(--color-success)')}${stat('➖', 'سحوبات نقدية', `-${money(expected.cashOut)}`, 'var(--color-danger)')}${stat('🧮', 'الرصيد المتوقع الآن', money(expected.expected))}</div>
      <div class="flex gap-8" style="margin-bottom:20px; flex-wrap:wrap;"><button class="btn btn-accent" id="cash-in">➕ إضافة نقدية</button><button class="btn btn-ghost" id="cash-out">➖ سحب نقدية</button><button class="btn btn-danger" id="close-shift">🔒 إغلاق الشيفت</button></div>
      ${expected.movements.length ? `<h4 style="margin-bottom:10px;">حركات الدرج خلال الشيفت</h4><div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>${t('amount')}</th><th>${t('description')}</th><th>${t('cashier')}</th></tr></thead><tbody>${expected.movements.map((movement) => { const isDeposit = movement.type === 'cash_in' && String(movement.reason || '').startsWith('عربون صيانة'); return `<tr><td>${dateTime(movement.created_at)}</td><td><span class="badge ${movement.type === 'cash_in' ? 'badge-success' : 'badge-danger'}">${isDeposit ? 'عربون صيانة' : (movement.type === 'cash_in' ? 'إيداع' : 'سحب')}</span></td><td class="mono-num">${movement.type === 'cash_in' ? '+' : '-'}${money(movement.amount)}</td><td>${movement.reason || '—'}</td><td>${movement.profiles?.full_name || '—'}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
  }

  function stat(icon, label, value, color = 'inherit') { return `<div class="stat-card" style="flex:1; min-width:155px;"><div class="stat-icon">${icon}</div><div class="stat-label">${label}</div><div class="stat-value mono-num" style="color:${color};">${value}</div></div>`; }

  function bind() {
    container.querySelector('#drawer-branch')?.addEventListener('change', (event) => { selectedBranchId = event.target.value; load(); });
    container.querySelector('#start-shift')?.addEventListener('click', openStartModal);
    container.querySelector('#cash-in')?.addEventListener('click', () => openMovementModal('cash_in'));
    container.querySelector('#cash-out')?.addEventListener('click', () => openMovementModal('cash_out'));
    container.querySelector('#close-shift')?.addEventListener('click', openCloseModal);
    // Manual hardware button — sends the ESC/POS pulse straight away,
    // independent of shift state (opening the physical drawer to make
    // change is a normal action even with no shift running). Always uses
    // the currently selected branch's receipt printer connection.
    container.querySelector('#drawer-open-hw')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const result = await openCashDrawer(selectedBranchId);
        toast(result?.success ? t('success') : t('cash_drawer_error'), result?.success ? 'success' : 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function modal(title, body, action, actionClass = 'btn-primary') {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box"><div class="modal-header"><h3>${title}</h3><button class="btn btn-icon" data-close>✕</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button class="btn btn-ghost" data-close>${t('cancel')}</button><button class="btn ${actionClass}" id="modal-save">${action}</button></div></div>`;
    document.body.appendChild(overlay); overlay.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => overlay.remove())); overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); }); return overlay;
  }

  function openStartModal() {
    const overlay = modal('▶️ فتح شيفت جديد', `<form id="drawer-form"><div class="field"><label>رصيد افتتاحي</label><input class="input" type="number" name="amount" min="0" step="0.01" value="0" required autofocus></div><div class="field"><label>${t('description')}</label><input class="input" name="notes"></div></form>`, 'فتح الشيفت');
    overlay.querySelector('#modal-save').addEventListener('click', async () => { const form = overlay.querySelector('form'); if (!form.reportValidity()) return; const values = new FormData(form); try { await openShift({ branchId: selectedBranchId, openingFloat: values.get('amount'), openedBy: profile.id, notes: values.get('notes').trim() }); overlay.remove(); toast(t('success'), 'success'); load(); } catch { toast(t('error_occurred'), 'error'); } });
  }

  function openMovementModal(type) {
    const overlay = modal(type === 'cash_in' ? 'إضافة نقدية للدرج' : 'سحب نقدية من الدرج', `<form><div class="field"><label>${t('amount')}</label><input class="input" type="number" name="amount" min="0.01" step="0.01" required autofocus></div><div class="field"><label>${t('description')}</label><input class="input" name="reason"></div></form>`, t('save'), type === 'cash_in' ? 'btn-accent' : 'btn-danger');
    overlay.querySelector('#modal-save').addEventListener('click', async () => { const form = overlay.querySelector('form'); if (!form.reportValidity()) return; const values = new FormData(form); try { await addCashMovement({ shiftId: shift.id, branchId: selectedBranchId, type, amount: values.get('amount'), reason: values.get('reason').trim(), createdBy: profile.id }); overlay.remove(); toast(t('success'), 'success'); load(); } catch { toast(t('error_occurred'), 'error'); } });
  }

  function openCloseModal() {
    const total = expected.expected;
    const overlay = modal('🔒 إغلاق الشيفت', `<div class="card card-pad" style="background:var(--color-surface-2); border:none; margin-bottom:14px;">الرصيد المتوقع: <strong class="mono-num">${money(total)}</strong></div><form><div class="field"><label>العدد الفعلي</label><input class="input" type="number" name="actual" min="0" step="0.01" required autofocus></div><div class="field"><label>${t('description')}</label><input class="input" name="notes"></div></form>`, 'إغلاق الشيفت', 'btn-danger');
    overlay.querySelector('#modal-save').addEventListener('click', async () => { const form = overlay.querySelector('form'); if (!form.reportValidity() || !(await confirmDialog('هل أنت متأكد من إغلاق الشيفت؟'))) return; const values = new FormData(form); try { await closeShift(shift.id, { actualCashCounted: values.get('actual'), closedBy: profile.id, notes: values.get('notes').trim(), expectedCash: total }); overlay.remove(); toast(t('success'), 'success'); load(); } catch { toast(t('error_occurred'), 'error'); } });
  }

  await load();
}
