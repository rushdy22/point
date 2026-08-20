const STORAGE_KEY = 'pos-admin-selected-branch'; // only meaningful for admins (branch_id === null)
export const ALL_BRANCHES = '__all__';

// Managers/cashiers are locked to their assigned branch (profiles.branch_id).
// Admins (branch_id === null) can switch between a specific branch or "all".
export function isGlobalAdmin(profile) {
  return profile?.role === 'admin' && !profile?.branch_id;
}

export function getSelectedBranch(profile) {
  if (!isGlobalAdmin(profile)) return profile?.branch_id || null;
  return localStorage.getItem(STORAGE_KEY) || ALL_BRANCHES;
}

export function setSelectedBranch(branchId) {
  localStorage.setItem(STORAGE_KEY, branchId);
}

// Returns the branch_id to filter by, or null when the effective scope is
// "all branches" (only ever true for a global admin).
export function effectiveBranchFilter(profile) {
  const selected = getSelectedBranch(profile);
  if (!isGlobalAdmin(profile)) return selected;
  return selected === ALL_BRANCHES ? null : selected;
}
