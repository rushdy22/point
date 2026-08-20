// Branch settings (receipt/logo/tax rate/printers) are stored on the
// branches table itself — one row per branch, same as its name/address/
// phone — so they are always scoped to a single branch_id like the rest
// of the app's data, and stay in sync across every device signed into
// that branch. Nothing here is kept in localStorage anymore: a setting
// saved while signed into one branch can never leak into another branch.
import { getBranch, updateBranch } from './db/branches.js';
import { DEFAULT_PAPER_SIZE, charsPerLineFor } from './paperSizes.js';
import { DEFAULT_PRINT_BRANDING } from './documentBranding.js';

// Thermal (ESC/POS) receipt-printer connection descriptor. `type` is
// 'windows' | 'usb' | 'network' | 'serial' | '' (unconfigured). Only the
// fields relevant to `type` are used — see electron/printing/adapters.js.
// 'windows' targets a printer already installed as a normal Windows
// printer queue (selected by `printerName`, sent as a RAW spooler job —
// see electron/printing/winRawPrint.js); 'usb' is the separate direct/
// libusb transport, for a printer with no Windows driver bound to it.
// `charsPerLine` is derived from `paperSize` automatically on every save
// (see saveSettings below) — it isn't independently editable.
function emptyPrinterConfig() {
  return {
    type: '',
    printerName: '',
    vendorId: '',
    productId: '',
    host: '',
    port: 9100,
    path: '',
    baudRate: 9600,
    paperSize: DEFAULT_PAPER_SIZE,
    charsPerLine: charsPerLineFor(DEFAULT_PAPER_SIZE)
  };
}

const defaults = {
  storeName: 'POINT',
  storePhone: '01284285202 / 01009613516',
  storeAddress: 'بورسعيد محطة موبيل (عتمان) امام الجبانات',
  storeLogo: '',
  taxRate: 0,
  printBranding: { ...DEFAULT_PRINT_BRANDING },
  printer: emptyPrinterConfig(), // cashier receipt printer (ESC/POS, Windows/USB/Network/Serial)
  reportPrinterName: '', // A4 reports — a regular Windows/CUPS printer
  whatsapp: {
    enabled: true,
    countryCode: '20',
    invoiceTemplate: '*{store}*\n\nفاتورة مبيعات رقم {invoice}\nالتاريخ: {date}\nالعميل: {customer}\nرقم الهاتف: {phone}\nالسيارة: {vehicle}\nرقم العربية: {vehicle_number}\n\nالأصناف:\n{items}\n\nالإجمالي: {total} ج.م\nالمدفوع: {paid} ج.م\nطريقة الدفع: {payment}',
    repairReceivedTemplate: 'مرحبًا {customer}، تم استلام طلب الصيانة رقم {repair}\nالنوع: {type}\nالعطل: {issue}',
    repairQuoteTemplate: 'طلب الصيانة رقم {repair}\nالعطل: {issue}\nالتشخيص: {diagnosis}\nالحل: {solution}\nالتكلفة: {total} ج.م\nبرجاء تأكيد الموافقة.',
    repairApprovedTemplate: 'تمت الموافقة على طلب الصيانة {repair}، وجارٍ تنفيذ الصيانة.',
    repairReadyTemplate: 'طلب الصيانة {repair} جاهز للاستلام. المتبقي: {remaining} ج.م.',
    repairPickupTemplate: 'تذكير: طلب الصيانة {repair} جاهز للاستلام.',
    repairWarrantyTemplate: 'ضمان طلب الصيانة {repair} ينتهي بتاريخ {warranty}',
    repairReceivingReceiptTemplate: 'مرحبًا {customer}، تم استلام سيارتك في POINT ✅\nرقم الصيانة: {repair}\nالسيارة: {type}\nرقم العربية: {serial}\nالحالة عند الاستلام: {condition}',
    repairDeliveryReceiptTemplate: 'مرحبًا {customer}، تم تجهيز فاتورة صيانة سيارتك رقم {repair} ✅\nالسيارة: {type}\nرقم العربية: {serial}\nالإجمالي: {total} ج.م\nالمدفوع: {paid} ج.م\nالمتبقي: {remaining} ج.م',
    footer: ''
  }
};

// In-memory cache keyed by branch_id, populated by loadBranchSettings().
// Lets call sites that must stay synchronous (building a receipt on every
// keystroke of the cart, etc.) read the already-loaded value for the
// branch they're working with instead of awaiting a query every time.
const cache = new Map();

// printer_config is stored as JSON text on the branch row (see
// sql/migration_v14_thermal_printing.sql) — parsed back
// into an object here, falling back to an empty config on missing/invalid
// JSON (e.g. a branch created before this migration) rather than throwing.
function parsePrinterConfig(json) {
  if (!json) return emptyPrinterConfig();
  try {
    const parsed = JSON.parse(json);
    return { ...emptyPrinterConfig(), ...parsed };
  } catch {
    return emptyPrinterConfig();
  }
}

function mapRowToSettings(row) {
  if (!row) return { ...defaults };
  return {
    storeName: row.name || defaults.storeName,
    storePhone: row.phone || '',
    storeAddress: row.address || '',
    storeLogo: row.logo || '',
    taxRate: row.tax_rate != null ? Number(row.tax_rate) : 0,
    printBranding: (() => { try { return { ...DEFAULT_PRINT_BRANDING, ...(row.whatsapp_settings ? (JSON.parse(row.whatsapp_settings)?.printBranding || {}) : {}) }; } catch { return { ...DEFAULT_PRINT_BRANDING }; } })(),
    printer: parsePrinterConfig(row.printer_config),
    // `printer_name` predates thermal printing (migration_v13) and is kept
    // as-is rather than renamed — see migration_v14's comment.
    reportPrinterName: row.printer_name || '',
    whatsapp: (() => { try { return { ...defaults.whatsapp, ...(row.whatsapp_settings ? JSON.parse(row.whatsapp_settings) : {}) }; } catch { return { ...defaults.whatsapp }; } })()
  };
}

// Fetches this branch's settings from the branches table and caches them.
// Call this once when a branch-scoped page loads (before relying on the
// synchronous getSettings() below for that same branchId).
export async function loadBranchSettings(branchId) {
  if (!branchId) return { ...defaults };
  const row = await getBranch(branchId);
  const settings = mapRowToSettings(row);
  cache.set(branchId, settings);
  return settings;
}

// Synchronous read of the last value loaded (or saved) for this branch.
// Returns defaults if loadBranchSettings(branchId) hasn't resolved yet.
export function getSettings(branchId) {
  if (!branchId) return { ...defaults };
  return cache.get(branchId) || { ...defaults };
}

// Persists a partial update to this branch's row only, and refreshes the
// cache so every other place reading getSettings(branchId) immediately
// sees the new values. `printer` partials are shallow-merged onto the
// existing saved config (so e.g. changing just paperSize
// doesn't require resending host/port/etc), and charsPerLine is always
// re-derived from the resulting paperSize.
export async function saveSettings(branchId, partial) {
  if (!branchId) throw new Error('BRANCH_REQUIRED');
  const current = getSettings(branchId);
  const payload = {};
  if ('storeName' in partial) payload.name = partial.storeName;
  if ('storePhone' in partial) payload.phone = partial.storePhone;
  if ('storeAddress' in partial) payload.address = partial.storeAddress;
  if ('storeLogo' in partial) payload.logo = partial.storeLogo;
  if ('taxRate' in partial) payload.tax_rate = Number(partial.taxRate) || 0;
  if ('reportPrinterName' in partial) payload.printer_name = partial.reportPrinterName;
  if ('whatsapp' in partial || 'printBranding' in partial) {
    payload.whatsapp_settings = JSON.stringify({
      ...current.whatsapp,
      ...(partial.whatsapp || {}),
      printBranding: { ...current.printBranding, ...(partial.printBranding || {}) }
    });
  }
  if ('printer' in partial) {
    const merged = { ...current.printer, ...partial.printer };
    merged.charsPerLine = charsPerLineFor(merged.paperSize);
    payload.printer_config = JSON.stringify(merged);
  }
  const row = await updateBranch(branchId, payload);
  const settings = mapRowToSettings(row);
  cache.set(branchId, settings);
  return settings;
}
