export const ROLES = ['admin', 'manager', 'cashier', 'technician'];

// which roles can open which route
const PAGE_ACCESS = {
  cashier: ['admin', 'manager', 'cashier'],
  customers: ['admin', 'manager', 'cashier'],
  products: ['admin', 'manager'],
  categories: ['admin', 'manager'],
  'sales-history': ['admin', 'manager', 'cashier'],
  dashboard: ['admin', 'manager'],
  reports: ['admin', 'manager'],
  accounts: ['admin'],
  finance: ['admin'],
  inventory: ['admin', 'manager'],
  suppliers: ['admin', 'manager'],
  purchases: ['admin', 'manager'],
  users: ['admin'],
  branches: ['admin'],
  settings: ['admin', 'manager'],

  // PlayStation Repair module — admin sees everything; technician handles
  // diagnosis/repair work; cashier handles receiving/payment/delivery;
  // manager gets full repair visibility plus reports/profits.
  'repair-dashboard': ['admin', 'manager', 'technician', 'cashier'],
  'repair-orders': ['admin', 'manager', 'technician', 'cashier'],
  'repair-received': ['admin', 'manager', 'technician', 'cashier'],
  'repair-waiting-inspection': ['admin', 'manager', 'technician'],
  'repair-waiting-approval': ['admin', 'manager', 'technician', 'cashier'],
  'repair-in-repair': ['admin', 'manager', 'technician'],
  'repair-ready': ['admin', 'manager', 'technician', 'cashier'],
  'repair-delivered': ['admin', 'manager', 'cashier'],
  'repair-overdue': ['admin', 'manager', 'technician'],
  'repair-warranties': ['admin', 'manager', 'cashier'],
  'repair-technicians': ['admin', 'manager']
};

// A technician's landing page isn't the cashier till — it's the repair
// dashboard. Used by main.js's guardRoute() as a role-aware fallback
// instead of always bouncing to DEFAULT_ROUTE.
const DEFAULT_ROUTE_BY_ROLE = {
  technician: 'repair-dashboard'
};

export function defaultRouteFor(role) {
  return DEFAULT_ROUTE_BY_ROLE[role] || DEFAULT_ROUTE;
}

export function canAccess(route, role) {
  return (PAGE_ACCESS[route] || []).includes(role);
}

// can this role refund a sale / delete records
export function canManage(role) {
  return role === 'admin' || role === 'manager';
}

export function isAdmin(role) {
  return role === 'admin';
}

export const DEFAULT_ROUTE = 'cashier';
