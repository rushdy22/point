import { t } from '../i18n/index.js';
import { dashboardStats, salesByCashier, salesByBranch } from '../lib/db/dashboard.js';
import { listSales } from '../lib/db/sales.js';
import { paymentMethodLabel } from '../lib/paymentMethods.js';
import { subscribeRealtime } from '../lib/realtime.js';

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

export async function renderDashboard(container, profile, branchId) {
  let range = 'today';
  let invoiceRows = [];
  const showBranchBreakdown = !branchId;

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  function getRangeDates() {
    const now = new Date();
    if (range === 'today') return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    if (range === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      return { from: first.toISOString(), to: last.toISOString() };
    }
    return { from: new Date('2000-01-01').toISOString(), to: endOfDay(now).toISOString() };
  }

  async function loadData() {
    const { from, to } = getRangeDates();
    const [stats, cashierStats, branchStats, invoices] = await Promise.all([
      dashboardStats({ from, to, branchId }),
      salesByCashier({ from, to, branchId }),
      showBranchBreakdown ? salesByBranch({ from, to }) : Promise.resolve([]),
      listSales({ from, to, branchId })
    ]);
    invoiceRows = (invoices || []).slice(0, 30);
    draw(stats, cashierStats, branchStats);
  }

  function draw(stats, cashierStats, branchStats) {
    const maxTotal = Math.max(...cashierStats.map((c) => c.total), 1);
    const maxBranchTotal = Math.max(...branchStats.map((b) => b.total), 1);

    container.innerHTML = `
      <div class="dashboard-range flex gap-8" style="margin-bottom:20px;">
        <button class="pill ${range === 'today' ? 'active' : ''}" data-range="today">${t('today')}</button>
        <button class="pill ${range === 'month' ? 'active' : ''}" data-range="month">${t('this_month')}</button>
        <button class="pill ${range === 'all' ? 'active' : ''}" data-range="all">${t('all')}</button>
      </div>

      <div class="dashboard-stats flex gap-16" style="flex-wrap:wrap;">
        <div class="stat-card" style="flex:1; min-width:200px;">
          <div class="stat-icon">💵</div>
          <div class="stat-label">${t('total_revenue')}</div>
          <div class="stat-value mono-num">${stats.totalRevenue.toFixed(2)}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:200px;">
          <div class="stat-icon">🧾</div>
          <div class="stat-label">${t('total_invoices')}</div>
          <div class="stat-value mono-num">${stats.totalInvoices}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:200px;">
          <div class="stat-icon">💵</div>
          <div class="stat-label">${t('cash_invoices')}</div>
          <div class="stat-value mono-num">${stats.cashCount}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:200px;">
          <div class="stat-icon">📱</div>
          <div class="stat-label">${t('instapay_invoices')}</div>
          <div class="stat-value mono-num">${stats.instapayCount}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:200px;">
          <div class="stat-icon">👛</div>
          <div class="stat-label">${t('wallet_invoices')}</div>
          <div class="stat-value mono-num">${stats.walletCount}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:200px;">
          <div class="stat-icon">💳</div>
          <div class="stat-label">${t('visa_invoices')}</div>
          <div class="stat-value mono-num">${stats.visaCount}</div>
        </div>
      </div>
      <div class="dashboard-payment-stats flex gap-12" style="flex-wrap:wrap; margin-top:10px;">
        ${[['cash','نقدي','💵'],['instapay','إنستا باي','📱'],['wallet','محفظة','👛'],['visa','بطاقة','💳']].map(([k,l,i]) => `<div class="card card-pad" style="flex:1;min-width:170px;"><div class="text-muted">${i} ${l} — إجمالي الفواتير</div><strong class="mono-num">${Number(stats.paymentTotals?.[k] || 0).toFixed(2)}</strong></div>`).join('')}
      </div>

      <div class="dashboard-card card card-pad" style="margin-top:20px;">
        <h3 style="margin-bottom:12px;">🧾 فواتير الفترة</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>الكاشير</th><th>الإجمالي</th><th>طريقة الدفع</th></tr></thead><tbody>
        ${invoiceRows.length ? invoiceRows.map((s) => `<tr><td>${s.invoice_number || '—'}</td><td>${new Date(s.created_at).toLocaleString('ar-EG')}</td><td>${s.profiles?.full_name || '—'}</td><td class="mono-num">${Number(s.total || 0).toFixed(2)}</td><td>${paymentMethodLabel(s.payment_method)}</td></tr>`).join('') : `<tr><td colspan="5" style="text-align:center;">لا توجد فواتير</td></tr>`}</tbody></table></div>
      </div>

      <div class="dashboard-card card card-pad" style="margin-top:20px;">
        <h3 style="margin-bottom:16px;">${t('sales_by_cashier')}</h3>
        <div class="flex flex-col gap-10">
          ${cashierStats.length === 0 ? `<div class="text-muted">${t('no_data')}</div>` : cashierStats.map((c) => `
            <div class="dashboard-bar-row flex items-center gap-12">
              <div class="dashboard-bar-label" style="width:140px; font-size:13.5px; font-weight:700;">${c.name}</div>
              <div style="flex:1; background:var(--color-surface-2); border-radius:6px; overflow:hidden; height:20px;">
                <div style="width:${(c.total / maxTotal) * 100}%; background:var(--color-primary); height:100%;"></div>
              </div>
              <div style="width:70px; text-align:end;" class="mono-num text-muted">${c.invoices} ${t('invoices_word')}</div>
              <div style="width:90px; text-align:end;" class="mono-num"><strong>${c.total.toFixed(2)}</strong></div>
            </div>
          `).join('')}
        </div>
      </div>

      ${showBranchBreakdown ? `
      <div class="dashboard-card card card-pad" style="margin-top:16px;">
        <h3 style="margin-bottom:16px;">${t('sales_by_branch')}</h3>
        <div class="flex flex-col gap-10">
          ${branchStats.length === 0 ? `<div class="text-muted">${t('no_data')}</div>` : branchStats.map((b) => `
            <div class="dashboard-bar-row flex items-center gap-12">
              <div class="dashboard-bar-label" style="width:140px; font-size:13.5px; font-weight:700;">${b.name}</div>
              <div style="flex:1; background:var(--color-surface-2); border-radius:6px; overflow:hidden; height:20px;">
                <div style="width:${(b.total / maxBranchTotal) * 100}%; background:var(--color-accent); height:100%;"></div>
              </div>
              <div style="width:70px; text-align:end;" class="mono-num text-muted">${b.invoices} ${t('invoices_word')}</div>
              <div style="width:90px; text-align:end;" class="mono-num"><strong>${b.total.toFixed(2)}</strong></div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
    `;

    container.querySelectorAll('[data-range]').forEach((btn) =>
      btn.addEventListener('click', () => { range = btn.dataset.range; loadData(); })
    );
  }

  await loadData();

  let reloadTimer;
  const unsubscribe = subscribeRealtime(['sales'], () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (document.body.contains(container)) loadData();
    }, 500);
  });
  return unsubscribe;
}
