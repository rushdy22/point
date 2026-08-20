import { getSettings, loadBranchSettings } from './settings.js';

// Cash Drawer: opening it means sending the cashier receipt printer an
// ESC/POS "pulse" command out its RJ11 drawer-kick port — the drawer has no
// connection of its own. All of that byte-level work happens in the
// Electron main process via PrinterService (see
  // electron/printing/printerService.js); this module is just the thin
  // renderer-side entry point, following the same pattern as printReceipt()
  // in printer.js to talk to the main
// process (only the main process can talk to Windows/USB/Network/Serial
// devices).
//
// Deliberately reuses the SAME printer connection already configured for
// cashier receipts (settings.printer) for the given branch — the drawer is
// wired straight into that printer, not a separate device.
//
// Always resolves (never throws) with { success, reason }, so callers can
// treat this as a safe, best-effort action:
//   - the manual "Open Cash Drawer" button can show a clear success/error
//     toast either way
//   - an automatic open-after-sale could fire-and-forget without ever
//     blocking or failing a sale that already completed successfully
export async function openCashDrawer(branchId) {
  if (!window.electronAPI?.printer?.openCashDrawer) {
    // Browser/dev-preview fallback — no real printer/drawer to talk to
    // outside Electron, so no-op instead of throwing.
    return { success: false, reason: 'not-electron' };
  }
  if (!branchId) {
    return { success: false, reason: 'no-branch-selected' };
  }

  // getSettings(branchId) only reflects what's already been loaded for this
  // branch; loadBranchSettings() guarantees a fresh read even if the
  // calling page never warmed the cache (e.g. opened straight to Drawer).
  await loadBranchSettings(branchId);
  const settings = getSettings(branchId);
  if (!settings.printer?.type) {
    return { success: false, reason: 'no-printer-configured' };
  }

  try {
    return await window.electronAPI.printer.openCashDrawer(settings.printer);
  } catch (err) {
    return { success: false, reason: err?.message || String(err) };
  }
}
