import { toast } from '../lib/toast.js';
import { t } from '../i18n/index.js';
import { logout } from '../lib/auth.js';
import { canAccess } from '../lib/permissions.js';
import { isGlobalAdmin, getSelectedBranch, setSelectedBranch, ALL_BRANCHES } from '../lib/branchContext.js';
import { verifyBranchPassword } from '../lib/branchPassword.js';
import { listBranches } from '../lib/db/branches.js';

const brandLogoUrl = new URL('../../assets/rashed-systems-logo.png', import.meta.url).href;


const NAV_ITEMS = [
  { route: 'cashier', icon: '🧾', label: 'nav_cashier' },
  { route: 'dashboard', icon: '📊', label: 'nav_dashboard' },
  { route: 'customers', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>', label: 'nav_customers' },
  { route: 'products', icon: '📦', label: 'nav_products' },
  { route: 'categories', icon: '🗂️', label: 'nav_categories' },
  { route: 'sales-history', icon: '📜', label: 'nav_sales_history' },
  { route: 'reports', icon: '📈', label: 'nav_reports' },
  { route: 'accounts', icon: '💰', label: 'nav_accounts_finance' },
  { route: 'inventory', icon: '📉', label: 'nav_inventory' },
  { route: 'settings', icon: '⚙️', label: 'nav_settings' }
];

const SUPPLIERS_PURCHASES_ITEMS = [
  { route: 'suppliers', label: 'nav_suppliers' },
  { route: 'purchases', label: 'purchases_title' }
];

// Maintenance is grouped in one section; individual statuses are filtered inside repair orders.
const REPAIR_ITEMS = [
  { route: 'repair-dashboard', label: 'nav_repair_dashboard' },
  { route: 'repair-orders', label: 'nav_repair_orders' },
  { route: 'repair-technicians', label: 'nav_repair_technicians' },
  { route: 'repair-warranties', label: 'nav_repair_warranties' }
];

const ADMIN_ITEMS = [
  { route: 'users', label: 'nav_users' },
  { route: 'branches', label: 'nav_branches' }
];

// Connection indicator state is kept at module scope (not inside
// renderAppShell) since the whole shell re-renders on every navigation —
// subscribing once here avoids piling up duplicate IPC listeners.
let latestSyncStatus = { state: 'offline', pendingCount: 0 };
if (window.electronAPI?.sync) {
  window.electronAPI.sync.getStatus().then((s) => {
    latestSyncStatus = s;
    paintSyncIndicator();
  });
  window.electronAPI.sync.onStatusChange((status) => {
    latestSyncStatus = status;
    paintSyncIndicator();
  });
}

function syncIndicatorMarkup(status) {
  const dot = status.state === 'online' ? '🟢' : status.state === 'syncing' ? '🟡' : status.state === 'paused' ? '⏸️' : status.state === 'error' ? '⚠️' : '🔴';
  const label = status.state === 'online' ? 'متصل' : status.state === 'syncing' ? 'جارٍ المزامنة' : status.state === 'paused' ? 'المزامنة موقوفة' : status.state === 'error' ? 'خطأ مزامنة' : 'غير متصل';
  const pending = status.pendingCount > 0 ? ` (${status.pendingCount} بالانتظار)` : '';
  const errorSuffix = status.lastError ? ` — ${status.lastError}` : '';
  return `<span class="badge badge-muted" id="sync-indicator" title="${label}${pending}${errorSuffix}">${dot} ${label}${pending}</span>`;
}

function paintSyncIndicator() {
  const el = document.getElementById('sync-indicator');
  if (el) el.outerHTML = syncIndicatorMarkup(latestSyncStatus);
}

export function renderAppShell(root, { profile, currentRoute, pageTitle, onNavigate, onBranchChange }) {
  const role = profile?.role || 'cashier';
  const visibleItems = NAV_ITEMS.filter((item) =>
    item.matchRoutes ? item.matchRoutes.some((r) => canAccess(r, role)) : canAccess(item.route, role)
  );
  const visibleSuppliersPurchasesItems = SUPPLIERS_PURCHASES_ITEMS.filter((item) => canAccess(item.route, role));
  const visibleRepairItems = REPAIR_ITEMS.filter((item) => canAccess(item.route, role));
  const visibleAdminItems = ADMIN_ITEMS.filter((item) => canAccess(item.route, role));
  const suppliersPurchasesExpanded = visibleSuppliersPurchasesItems.some((item) => item.route === currentRoute);
  const repairExpanded = visibleRepairItems.some((item) => item.route === currentRoute);
  const adminExpanded = visibleAdminItems.some((item) => item.route === currentRoute);
  const globalAdmin = isGlobalAdmin(profile);

  root.innerHTML = `
    <div class="app-shell">
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <aside class="sidebar">
        <div class="sidebar-brand">
          <img class="brand-logo" src="${brandLogoUrl}" alt="الراشد للأنظمة" />
          <div>
            <div class="brand-text">الراشد للأنظمة</div>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${visibleItems.slice(0, 1)
            .map((item) => {
              const isActive = item.matchRoutes ? item.matchRoutes.includes(currentRoute) : item.route === currentRoute;
              return `<button class="nav-item ${isActive ? 'active' : ''}" data-route="${item.route}"><span class="nav-icon">${item.icon}</span><span>${t(item.label)}</span></button>`;
            }).join('')}
          ${visibleRepairItems.length ? `
            <div class="nav-section ${repairExpanded ? 'expanded has-active' : ''}">
              <button class="nav-item nav-section-toggle ${repairExpanded ? 'active' : ''}" type="button" aria-expanded="${repairExpanded}">
                <span class="nav-icon">⚙️</span><span>${t('nav_repair_section')}</span><span class="nav-section-chevron" aria-hidden="true">⌄</span>
              </button>
              <div class="nav-section-items">
                ${visibleRepairItems.map((item) => `<button class="nav-item nav-sub-item ${item.route === currentRoute ? 'active' : ''}" data-route="${item.route}"><span>${t(item.label)}</span></button>`).join('')}
              </div>
            </div>` : ''}
          ${visibleItems.slice(1, 6)
            .map((item) => {
              const isActive = item.matchRoutes ? item.matchRoutes.includes(currentRoute) : item.route === currentRoute;
              return `<button class="nav-item ${isActive ? 'active' : ''}" data-route="${item.route}"><span class="nav-icon">${item.icon}</span><span>${t(item.label)}</span></button>`;
            }).join('')}
          ${visibleSuppliersPurchasesItems.length ? `
            <div class="nav-section ${suppliersPurchasesExpanded ? 'expanded has-active' : ''}">
              <button class="nav-item nav-section-toggle ${suppliersPurchasesExpanded ? 'active' : ''}" type="button" aria-expanded="${suppliersPurchasesExpanded}">
                <span class="nav-icon">🚚</span>
                <span>الموردين وفواتير المشتريات</span>
                <span class="nav-section-chevron" aria-hidden="true">⌄</span>
              </button>
              <div class="nav-section-items">
                ${visibleSuppliersPurchasesItems
                  .map((item) => `
                    <button class="nav-item nav-sub-item ${item.route === currentRoute ? 'active' : ''}" data-route="${item.route}">
                      <span>${t(item.label)}</span>
                    </button>`)
                  .join('')}
              </div>
            </div>` : ''}
          ${visibleItems.slice(6)
            .map((item) => {
              const isActive = item.matchRoutes ? item.matchRoutes.includes(currentRoute) : item.route === currentRoute;
              return `<button class="nav-item ${isActive ? 'active' : ''}" data-route="${item.route}"><span class="nav-icon">${item.icon}</span><span>${t(item.label)}</span></button>`;
            })
            .join('')}
          ${visibleAdminItems.length ? `
            <div class="nav-section ${adminExpanded ? 'expanded has-active' : ''}">
              <button class="nav-item nav-section-toggle ${adminExpanded ? 'active' : ''}" type="button" aria-expanded="${adminExpanded}">
                <span class="nav-icon">🛠️</span>
                <span>إدارة المستخدمين والفروع</span>
                <span class="nav-section-chevron" aria-hidden="true">⌄</span>
              </button>
              <div class="nav-section-items">
                ${visibleAdminItems.map((item) => `<button class="nav-item nav-sub-item ${item.route === currentRoute ? 'active' : ''}" data-route="${item.route}"><span>${t(item.label)}</span></button>`).join('')}
              </div>
            </div>` : ''}
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="avatar">${(profile?.full_name || '؟').charAt(0)}</div>
            <div>
              <div class="u-name">${profile?.full_name || ''}</div>
              <div class="u-role">${role === 'admin' ? t('role_admin') : role === 'manager' ? t('role_manager') : role === 'technician' ? t('role_technician') : t('role_cashier')}</div>
            </div>
          </div>
          <button class="nav-item" id="logout-btn">
            <span class="nav-icon">🚪</span>
            <span>${t('logout')}</span>
          </button>
        </div>
      </aside>
      <div class="main-area">
        <header class="topbar">
          <div class="flex items-center gap-12">
            <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-label="القائمة">☰</button>
            <h1>${pageTitle}</h1>
          </div>
          <div class="flex items-center gap-12">
            ${window.electronAPI?.minimize ? `<button class="btn btn-icon" id="minimize-btn" title="${t('minimize')}">🗕</button>` : ''}
            ${syncIndicatorMarkup(latestSyncStatus)}
            ${globalAdmin
              ? `<select class="input" id="branch-selector" style="padding:6px 10px; width:170px;"><option>${t('loading')}</option></select>`
              : profile?.branches?.name
              ? `<span class="badge badge-muted">🏬 ${profile.branches.name}</span>`
              : ''}
          </div>
        </header>
        <div class="content-scroll" id="page-content"></div>
      </div>
    </div>
  `;

  const shell = root.querySelector('.app-shell');
  const closeSidebar = () => shell.classList.remove('sidebar-open');
  root.querySelector('#sidebar-toggle')?.addEventListener('click', () => shell.classList.toggle('sidebar-open'));
  root.querySelector('#sidebar-backdrop')?.addEventListener('click', closeSidebar);

  root.querySelectorAll('.nav-item[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      onNavigate(btn.dataset.route);
      closeSidebar();
    });
  });

  root.querySelectorAll('.nav-section-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.nav-section');
      if (section.classList.contains('has-active')) return;
      const expanded = section.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', expanded);
    });
  });

  const minimizeBtn = root.querySelector('#minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
  }

  root.querySelector('#logout-btn').addEventListener('click', async () => {
    await logout();
    window.location.hash = '';
    window.location.reload();
  });

  if (globalAdmin) {
    const selector = root.querySelector('#branch-selector');
    listBranches().then((branches) => {
      const current = getSelectedBranch(profile);
      selector.innerHTML = `
        <option value="${ALL_BRANCHES}" ${current === ALL_BRANCHES ? 'selected' : ''}>${t('all_branches')}</option>
        ${branches.map((b) => `<option value="${b.id}" ${current === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
      `;
      selector.addEventListener('change', async () => {
        const nextId = selector.value;
        if (nextId === ALL_BRANCHES) {
          setSelectedBranch(nextId);
          onBranchChange?.();
          return;
        }
        const branch = branches.find((b) => b.id === nextId);
        if (branch?.password_hash) {
          const password = window.prompt(`باسورد الفرع: ${branch.name}`);
          const ok = await verifyBranchPassword(password || '', branch.password_hash);
          if (!ok) {
            toast('باسورد الفرع غير صحيح', 'error');
            selector.value = getSelectedBranch(profile);
            return;
          }
        }
        setSelectedBranch(nextId);
        onBranchChange?.();
      });
    });
  }

  return root.querySelector('#page-content');
}
