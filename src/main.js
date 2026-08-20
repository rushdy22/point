import './i18n/index.js';
import { t } from './i18n/index.js';
import { getSession, getCurrentProfile, logout } from './lib/auth.js';
import { canAccess, DEFAULT_ROUTE, defaultRouteFor } from './lib/permissions.js';
import { effectiveBranchFilter } from './lib/branchContext.js';
import { toast } from './lib/toast.js';
import { renderLogin } from './pages/login.js';
import { renderAppShell } from './components/appShell.js';
import { renderCashier } from './pages/cashier.js';
import { renderProducts } from './pages/products.js';
import { renderCategories } from './pages/categories.js';
import { renderSalesHistory } from './pages/salesHistory.js';
import { renderReports } from './pages/reports.js';
import { renderInventory } from './pages/inventory.js';
import { renderSettings } from './pages/settingsPage.js';
import { renderCustomers } from './pages/customers.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderAccounts } from './pages/accounts.js';
import { renderFinance } from './pages/finance.js';
import { renderUsers } from './pages/usersPage.js';
import { renderBranches } from './pages/branches.js';
import { renderSuppliers } from './pages/suppliers.js';
import { renderPurchases } from './pages/purchases.js';
import { renderRepairDashboard } from './pages/repairDashboard.js';
import { renderRepairOrders } from './pages/repairOrders.js';
import { renderRepairTechnicians } from './pages/repairTechnicians.js';
import { renderRepairWarranties } from './pages/repairWarranties.js';

const PAGE_TITLES = {
  cashier: 'cashier_title',
  dashboard: 'dashboard_title',
  customers: 'customers_title',
  products: 'products_title',
  categories: 'categories_title',
  'sales-history': 'sales_history_title',
  reports: 'reports_title',
  accounts: 'accounts_finance_title',
  finance: 'finance_title',
  inventory: 'inventory_title',
  suppliers: 'suppliers_title',
  purchases: 'purchases_title',
  users: 'users_title',
  branches: 'branches_title',
  settings: 'settings_title',
  'repair-dashboard': 'repair_dashboard_title',
  'repair-orders': 'nav_repair_orders',
  'repair-received': 'nav_repair_received',
  'repair-waiting-inspection': 'nav_repair_waiting_inspection',
  'repair-waiting-approval': 'nav_repair_waiting_approval',
  'repair-in-repair': 'nav_repair_in_repair',
  'repair-ready': 'nav_repair_ready',
  'repair-delivered': 'nav_repair_delivered',
  'repair-overdue': 'nav_repair_overdue',
  'repair-warranties': 'nav_repair_warranties',
  'repair-technicians': 'technicians_title'
};

// Pages that operate within a single branch context receive (el, profile, branchId).
const PAGE_RENDERERS = {
  cashier: (el, profile, branchId) => renderCashier(el, profile, branchId),
  dashboard: (el, profile, branchId) => renderDashboard(el, profile, branchId),
  customers: (el, profile, branchId) => renderCustomers(el, profile, branchId),
  products: (el, profile, branchId) => renderProducts(el, profile, branchId),
  categories: (el, profile, branchId) => renderCategories(el, profile, branchId),
  'sales-history': (el, profile, branchId) => renderSalesHistory(el, profile, branchId),
  reports: (el, profile, branchId) => renderReports(el, profile, branchId),
  accounts: (el, profile, branchId) => renderAccounts(el, profile, branchId),
  finance: (el, profile, branchId) => renderFinance(el, profile, branchId),
  inventory: (el, profile, branchId) => renderInventory(el, profile, branchId),
  suppliers: (el, profile, branchId) => renderSuppliersPurchasesTabs('suppliers', el, profile, branchId),
  purchases: (el, profile, branchId) => renderSuppliersPurchasesTabs('purchases', el, profile, branchId),
  users: (el, profile) => renderUsers(el, profile),
  branches: (el) => renderBranches(el),
  settings: (el, profile, branchId) => renderSettings(el, profile, branchId),
  'repair-dashboard': (el, profile, branchId) => renderRepairDashboard(el, profile, branchId),
  'repair-orders': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { statuses: null, filterLabel: 'nav_repair_orders' }),
  // Two distinct, real statuses (not a shared filter): a device sits in
  // 'received' the moment it's dropped off, and only moves into
  // 'inspection' once a technician explicitly starts the inspection.
  'repair-received': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { statuses: ['received'], filterLabel: 'nav_repair_received' }),
  'repair-waiting-inspection': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { statuses: ['inspection'], filterLabel: 'nav_repair_waiting_inspection' }),
  'repair-waiting-approval': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { statuses: ['waiting_approval'], filterLabel: 'nav_repair_waiting_approval' }),
  'repair-in-repair': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { statuses: ['in_repair'], filterLabel: 'nav_repair_in_repair' }),
  'repair-ready': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { statuses: ['ready'], filterLabel: 'nav_repair_ready' }),
  'repair-delivered': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { statuses: ['delivered'], filterLabel: 'nav_repair_delivered' }),
  'repair-overdue': (el, profile, branchId) => renderRepairOrders(el, profile, branchId, { overdueOnly: true, filterLabel: 'nav_repair_overdue' }),
  'repair-warranties': (el, profile, branchId) => renderRepairWarranties(el, profile, branchId),
  'repair-technicians': (el, profile, branchId) => renderRepairTechnicians(el, profile, branchId)
};

// Suppliers and Purchases live under one sidebar entry ("موردون ومشتريات").
// This renders a small tab strip above the page so the user can flip
// between the two without leaving the section.
async function renderSuppliersPurchasesTabs(activeRoute, el, profile, branchId) {
  el.innerHTML = `
    <div class="page-tabs">
      <button class="page-tab ${activeRoute === 'suppliers' ? 'active' : ''}" data-tab-route="suppliers">${t('nav_suppliers_sub')}</button>
      <button class="page-tab ${activeRoute === 'purchases' ? 'active' : ''}" data-tab-route="purchases">${t('nav_purchases_sub')}</button>
    </div>
    <div id="tab-page-content"></div>
  `;
  el.querySelectorAll('[data-tab-route]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.tabRoute));
  });
  const inner = el.querySelector('#tab-page-content');
  return activeRoute === 'suppliers'
    ? renderSuppliers(inner, profile, branchId)
    : renderPurchases(inner, profile, branchId);
}

const app = document.getElementById('app');
// Modals are deliberately closed only with their explicit close/cancel controls.
document.addEventListener('click', (event) => {
  if (event.target.classList?.contains('modal-overlay')) event.stopImmediatePropagation();
}, true);
let currentProfile = null;
let currentPageCleanup = null;
function getRouteFromHash() {
  const route = window.location.hash.replace('#/', '') || DEFAULT_ROUTE;
  return PAGE_RENDERERS[route] ? route : DEFAULT_ROUTE;
}

function navigate(route) {
  window.location.hash = `#/${route}`;
}

function guardRoute(route, role) {
  return canAccess(route, role) ? route : defaultRouteFor(role);
}

async function mountApp() {
  if (typeof currentPageCleanup === 'function') {
    try { currentPageCleanup(); } catch { /* ignore */ }
    currentPageCleanup = null;
  }

  const route = guardRoute(getRouteFromHash(), currentProfile.role);
  const branchId = effectiveBranchFilter(currentProfile);
  const pageEl = renderAppShell(app, {
    profile: currentProfile,
    currentRoute: route,
    pageTitle: t(PAGE_TITLES[route]),
    onNavigate: (r) => navigate(r),
    onBranchChange: () => mountApp()
  });
  currentPageCleanup = await PAGE_RENDERERS[route](pageEl, currentProfile, branchId);
}

window.addEventListener('hashchange', async () => {
  if (!currentProfile) return;
  await mountApp();
});

async function startSession() {
  currentProfile = await getCurrentProfile();
  if (currentProfile && currentProfile._profileLoadFailed) {
    let detail = '';
    try {
      const status = await window.electronAPI?.sync?.getStatus();
      if (status?.lastError) detail = ` (${status.lastError})`;
    } catch { /* ignore */ }
    toast(`تعذر تحميل بيانات الحساب من قاعدة البيانات المحلية.${detail} تأكد من الاتصال بالإنترنت أول مرة وحاول تسجيل الدخول مرة أخرى.`, 'error', 8000);
    await logout();
    currentProfile = null;
    renderLogin(app, startSession);
    return;
  }
  if (currentProfile && currentProfile.is_active === false) {
    toast(t('account_inactive'), 'error', 5000);
    await logout();
    currentProfile = null;
    renderLogin(app, startSession);
    return;
  }
  if (currentProfile && currentProfile.role !== 'admin' && !currentProfile.branch_id) {
    toast('هذا الحساب غير مخصص لأي فرع، يرجى التواصل مع المدير', 'error', 5000);
    await logout();
    currentProfile = null;
    renderLogin(app, startSession);
    return;
  }
  // Keep the complete POS application in the same immersive F11-style view
  // right after logging in — but only here, once, not on every navigation
  // (mountApp used to re-force this on every page change, which meant a
  // manual minimize/restore never stuck).
  if (window.electronAPI?.setFullscreen) {
    await window.electronAPI.setFullscreen(true);
  }
  await mountApp();
}

async function bootstrap() {
  const session = await getSession();
  if (!session) {
    renderLogin(app, startSession);
    return;
  }
  await startSession();
}

bootstrap();
