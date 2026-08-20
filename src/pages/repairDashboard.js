import { t } from '../i18n/index.js';
import { toast } from '../lib/toast.js';
import { listRepairOrders, listOverdueRepairs, listTechnicians, getTechnicianPerformance, repairFinancialSummary } from '../lib/db/repairs.js';
import { subscribeRealtime } from '../lib/realtime.js';

function fmt(n) { return Number(n || 0).toFixed(2); }

function downloadCSV(filename, rows) {
  if (!rows.length) { toast(t('no_repairs_found'), 'info'); return; }
  const headers = Object.keys(rows[0]);
  const escapeCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(','))].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function renderRepairDashboard(container, profile, branchId) {
  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  let range = 'month';
  let customFrom = new Date().toISOString().slice(0, 10);
  let customTo = new Date().toISOString().slice(0, 10);

  function getRangeDates() {
    const now = new Date();
    if (range === 'today') {
      const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const b = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { from: a.toISOString(), to: b.toISOString() };
    }
    if (range === 'month') {
      const a = new Date(now.getFullYear(), now.getMonth(), 1);
      const b = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: a.toISOString(), to: b.toISOString() };
    }
    return { from: new Date(customFrom + 'T00:00:00').toISOString(), to: new Date(customTo + 'T23:59:59').toISOString() };
  }

  async function loadData() {
    const { from, to } = getRangeDates();
    const [all, overdue, technicians, financial] = await Promise.all([
      listRepairOrders({ branchId }),
      listOverdueRepairs({ branchId }),
      listTechnicians({ branchId, activeOnly: true }),
      repairFinancialSummary({ from, to, branchId })
    ]);
    draw(all, overdue, technicians, financial, from, to);
  }

  async function draw(all, overdue, technicians, financial, from, to) {
    const rangeRows = all.filter((r) => r.created_at >= from && r.created_at <= to);
    const delivered = rangeRows.filter((r) => r.status === 'delivered');
    const repairsCount = rangeRows.length;
    const warrantied = delivered.filter((r) => r.warranty_days > 0);

    const faultCounts = {};
    rangeRows.forEach((r) => {
      const key = (r.reported_issue || '').trim().slice(0, 60) || '—';
      if (key === '—') return;
      faultCounts[key] = (faultCounts[key] || 0) + 1;
    });
    const topFaults = Object.entries(faultCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const techPerf = await Promise.all(technicians.map(async (tc) => {
      const perf = await getTechnicianPerformance(tc.id, branchId, from, to);
      const commission = (perf.totalValue * Number(tc.commission_percent || 0)) / 100;
      return { ...tc, ...perf, commission };
    }));

    container.innerHTML = `
      <div class="flex gap-8" style="margin-bottom:16px; flex-wrap:wrap;">
        <button class="pill ${range === 'today' ? 'active' : ''}" data-range="today">اليوم</button>
        <button class="pill ${range === 'month' ? 'active' : ''}" data-range="month">الشهر</button>
        <button class="pill ${range === 'custom' ? 'active' : ''}" data-range="custom">فترة محددة</button>
        ${range === 'custom' ? `<input type="date" class="input" id="dash-from" value="${customFrom}" style="padding:6px 10px;" /><input type="date" class="input" id="dash-to" value="${customTo}" style="padding:6px 10px;" /><button class="btn btn-sm btn-primary" id="dash-apply">تطبيق</button>` : ''}
      </div>

      <div class="flex gap-16" style="flex-wrap:wrap; margin-bottom:20px;">
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">🛠️</div>
          <div class="stat-label">طلبات الصيانة بالفترة</div>
          <div class="stat-value mono-num">${repairsCount}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">📅</div>
          <div class="stat-label">طلبات مكتملة بالفترة</div>
          <div class="stat-value mono-num">${delivered.length}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">💰</div>
          <div class="stat-label">إجمالي إيرادات الصيانة</div>
          <div class="stat-value mono-num">${fmt(financial.repairRevenue)}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">📈</div>
          <div class="stat-label">صافي ربح الصيانة</div>
          <div class="stat-value mono-num">${fmt(financial.repairNetProfit)}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">🔧</div>
          <div class="stat-label">إجمالي المواد المستخدمة في الصيانة</div>
          <div class="stat-value mono-num">${fmt(financial.materialCost)}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">👨‍🔧</div>
          <div class="stat-label">إجمالي العمالة</div>
          <div class="stat-value mono-num">${fmt(financial.laborTotal)}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">⏰</div>
          <div class="stat-label">${t('overdue_devices')}</div>
          <div class="stat-value mono-num" style="color:${overdue.length ? 'var(--color-danger)' : 'inherit'};">${overdue.length}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">🛡️</div>
          <div class="stat-label">${t('warranty_report')}</div>
          <div class="stat-value mono-num">${warrantied.length}</div>
        </div>
      </div>

      <div class="flex gap-16" style="flex-wrap:wrap; align-items:flex-start;">
        <div class="card card-pad" style="flex:1; min-width:340px;">
          <div class="flex justify-between items-center" style="margin-bottom:10px;">
            <h4>${t('technician_performance')}</h4>
            <button class="btn btn-ghost" id="export-tech-csv" style="font-size:12px;">⬇️ ${t('export_csv')}</button>
          </div>
          <table class="data-table" style="font-size:12.5px;">
            <thead><tr><th>${t('technician_name')}</th><th>${t('assigned_repairs')}</th><th>${t('completed_repairs')}</th><th>${t('total_repair_value')}</th><th>${t('commission_total')}</th></tr></thead>
            <tbody>${techPerf.map((tc) => `<tr><td>${tc.name}</td><td>${tc.assigned}</td><td>${tc.completed}</td><td class="mono-num">${fmt(tc.totalValue)}</td><td class="mono-num">${fmt(tc.commission)}</td></tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);">—</td></tr>`}</tbody>
          </table>
        </div>

        <div class="card card-pad" style="flex:1; min-width:280px;">
          <h4 style="margin-bottom:10px;">${t('common_faults')}</h4>
          <table class="data-table" style="font-size:12.5px;">
            <thead><tr><th>${t('reported_issue')}</th><th>#</th></tr></thead>
            <tbody>${topFaults.map(([fault, count]) => `<tr><td>${fault}</td><td class="mono-num">${count}</td></tr>`).join('') || `<tr><td colspan="2" style="text-align:center;color:var(--color-text-muted);">—</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:16px;">
        <div class="flex justify-between items-center" style="margin-bottom:10px;">
          <h4>${t('overdue_devices')}</h4>
          <button class="btn btn-ghost" id="export-overdue-csv" style="font-size:12px;">⬇️ ${t('export_csv')}</button>
        </div>
        <table class="data-table" style="font-size:12.5px;">
          <thead><tr><th>${t('repair_number')}</th><th>${t('customer_name')}</th><th>${t('device_type')}</th><th>${t('expected_delivery_date')}</th></tr></thead>
          <tbody>${overdue.map((r) => `<tr><td>${r.repair_number}</td><td>${r.customer_name || r.customers?.name || '—'}</td><td>${r.device_type}</td><td class="mono-num" style="color:var(--color-danger);">${r.expected_delivery_date}</td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--color-text-muted);">—</td></tr>`}</tbody>
        </table>
      </div>
    `;

    container.querySelectorAll('[data-range]').forEach((btn) => btn.addEventListener('click', () => { range = btn.dataset.range; loadData(); }));
    const apply = container.querySelector('#dash-apply');
    if (apply) apply.addEventListener('click', () => { customFrom = container.querySelector('#dash-from').value; customTo = container.querySelector('#dash-to').value; loadData(); });

    container.querySelector('#export-tech-csv').addEventListener('click', () => downloadCSV('technician_performance.csv', techPerf.map((tc) => ({ name: tc.name, assigned: tc.assigned, completed: tc.completed, total_value: fmt(tc.totalValue), commission: fmt(tc.commission) }))));
    container.querySelector('#export-overdue-csv').addEventListener('click', () => downloadCSV('overdue_repairs.csv', overdue.map((r) => ({ repair_number: r.repair_number, customer: r.customer_name || r.customers?.name || '', device: r.device_type, expected_delivery_date: r.expected_delivery_date }))));
  }

  await loadData();
  subscribeRealtime(['repair_orders'], () => loadData());
}
