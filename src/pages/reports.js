import { t } from '../i18n/index.js';
import { dailyReport, monthlyReport, topProducts } from '../lib/db/reports.js';

export async function renderReports(container, profile, branchId) {
  let mode = 'daily';

  container.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

  async function loadData() {
    const now = new Date();
    const report = mode === 'daily' ? await dailyReport(now, branchId) : await monthlyReport(now.getFullYear(), now.getMonth(), branchId);
    const from = mode === 'daily' ? new Date(now.setHours(0,0,0,0)).toISOString() : new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date().toISOString();
    const top = await topProducts({ from, to, limit: 8, branchId });
    draw(report, top);
  }

  function draw(report, top) {
    const maxDay = Math.max(...report.byDay.map(([, v]) => v), 1);

    container.innerHTML = `
      <div class="flex gap-8" style="margin-bottom:18px;">
        <button class="pill ${mode === 'daily' ? 'active' : ''}" data-mode="daily">${t('daily_report')}</button>
        <button class="pill ${mode === 'monthly' ? 'active' : ''}" data-mode="monthly">${t('monthly_report')}</button>
      </div>

      <div class="flex gap-16" style="margin-bottom:20px; flex-wrap:wrap;">
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">💰</div>
          <div class="stat-label">${t('total_sales')}</div>
          <div class="stat-value mono-num">${report.totalSales.toFixed(2)}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">🧾</div>
          <div class="stat-label">${t('total_orders')}</div>
          <div class="stat-value mono-num">${report.totalOrders}</div>
        </div>
        <div class="stat-card" style="flex:1; min-width:180px;">
          <div class="stat-icon">📈</div>
          <div class="stat-label">${t('avg_order')}</div>
          <div class="stat-value mono-num">${report.avgOrder.toFixed(2)}</div>
        </div>
      </div>

      <div class="flex gap-16" style="align-items:flex-start; flex-wrap:wrap;">
        <div class="card card-pad" style="flex:1.4; min-width:340px;">
          <h3 style="margin-bottom:16px;">${t('sales_by_day')}</h3>
          <div class="flex flex-col gap-8">
            ${report.byDay.length === 0 ? `<div class="text-muted">${t('no_data')}</div>` : report.byDay.map(([day, val]) => `
              <div class="flex items-center gap-12">
                <div style="width:90px; font-size:12px;" class="text-muted mono-num">${day}</div>
                <div style="flex:1; background:var(--color-surface-2); border-radius:6px; overflow:hidden; height:18px;">
                  <div style="width:${(val / maxDay) * 100}%; background:var(--color-primary); height:100%;"></div>
                </div>
                <div style="width:80px; text-align:end;" class="mono-num">${val.toFixed(2)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="card card-pad" style="flex:1; min-width:280px;">
          <h3 style="margin-bottom:16px;">${t('top_products')}</h3>
          <div class="flex flex-col gap-10">
            ${top.length === 0 ? `<div class="text-muted">${t('no_data')}</div>` : top.map((p, i) => `
              <div class="flex justify-between items-center">
                <div class="flex items-center gap-8">
                  <span class="badge badge-muted">${i + 1}</span>
                  <span>${p.name}</span>
                </div>
                <div class="mono-num text-muted">${p.qty} × </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-mode]').forEach((btn) =>
      btn.addEventListener('click', () => { mode = btn.dataset.mode; loadData(); })
    );
  }

  await loadData();
}
